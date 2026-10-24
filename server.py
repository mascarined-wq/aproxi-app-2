"""
Servidor do Aproxi (app de celular).

Ele faz três coisas:
  1. Entrega o app (a pasta "static") para o navegador do celular.
  2. Guarda a chave de API, para que ela nunca fique dentro do app.
  3. Recebe as perguntas do app, repassa ao serviço gratuito (Gemini ou Groq)
     e devolve a resposta aos poucos.

Rodar no seu computador:
    pip install -r requirements.txt
    python server.py

Configuração (variáveis de ambiente ou arquivo .env ao lado deste arquivo):
    GEMINI_API_KEY   chave do Google Gemini  (ou GROQ_API_KEY para o Groq)
    APROXI_PROVEDOR  "gemini" (padrão) ou "groq"
    APROXI_SENHA     senha de acesso ao app (recomendado se publicar na internet)
    APROXI_MODELO    troca o modelo, se o padrão deixar de existir
    APROXI_MAX_TOKENS          tamanho máximo da resposta (padrão 1500)
    APROXI_REASONING_EFFORT    "low", "medium" ou "high" (só para modelos que raciocinam)
    APROXI_BASE_URL  usa outro serviço compatível com a API da OpenAI
"""

import hmac
import json
import mimetypes
import os
import socket
import sys
import threading
import time
import urllib.error
import urllib.request
from collections import defaultdict, deque
from pathlib import Path

from flask import Flask, Response, jsonify, request, send_from_directory

PASTA = Path(__file__).resolve().parent


def carregar_env():
    """Lê o arquivo .env (se existir) sem precisar de bibliotecas extras."""
    arquivo = PASTA / ".env"
    if not arquivo.exists():
        return
    for linha in arquivo.read_text(encoding="utf-8").splitlines():
        linha = linha.strip()
        if not linha or linha.startswith("#") or "=" not in linha:
            continue
        nome, valor = linha.split("=", 1)
        os.environ.setdefault(nome.strip(), valor.strip().strip('"').strip("'"))


carregar_env()

# ---------------------------------------------------------------
# CONFIGURAÇÃO
# ---------------------------------------------------------------

PROVEDORES = {
    "gemini": {
        "base_url": "https://generativelanguage.googleapis.com/v1beta/openai/",
        "modelo": "gemini-2.5-flash",
        "variavel_chave": "GEMINI_API_KEY",
    },
    "groq": {
        "base_url": "https://api.groq.com/openai/v1",
        "modelo": "openai/gpt-oss-120b",
        "variavel_chave": "GROQ_API_KEY",
    },
}

PROVEDOR = os.environ.get("APROXI_PROVEDOR", "gemini").lower()
if PROVEDOR not in PROVEDORES:
    sys.exit(f"APROXI_PROVEDOR inválido: '{PROVEDOR}'. Use: {', '.join(PROVEDORES)}.")

CONFIG = PROVEDORES[PROVEDOR]
BASE_URL = os.environ.get("APROXI_BASE_URL") or CONFIG["base_url"]
MODELO = os.environ.get("APROXI_MODELO") or CONFIG["modelo"]
CHAVE = os.environ.get(CONFIG["variavel_chave"], "")
SENHA = os.environ.get("APROXI_SENHA", "")

def _inteiro(nome, padrao):
    try:
        return int(os.environ.get(nome, padrao))
    except ValueError:
        return padrao


# Modelos que "pensam" antes de responder (como o gpt-oss) gastam parte deste
# limite no raciocínio, então vale deixá-lo mais folgado para eles.
MAX_TOKENS = _inteiro("APROXI_MAX_TOKENS", 1500)
# Opcional: "low", "medium" ou "high". Só é enviado se você definir.
ESFORCO = os.environ.get("APROXI_REASONING_EFFORT", "").strip().lower()
MAX_MENSAGENS = 20         # quantas mensagens recentes o Aproxi "lembra"
MAX_CARACTERES = 6000       # tamanho máximo de cada mensagem
LIMITE_POR_MINUTO = 20      # pedidos por minuto, por endereço

# O jeito do Aproxi fica no arquivo personalidade.txt: edite à vontade.
try:
    PERSONALIDADE = (PASTA / "personalidade.txt").read_text(encoding="utf-8").strip()
except OSError:
    PERSONALIDADE = "Você é o Aproxi, um assistente de estudos. Responda em português do Brasil."

# Instruções de formato: o app mostra o negrito como marca-texto e não
# entende fórmulas em LaTeX.
FORMATO = (
    "Formato das respostas (a tela é de celular): use markdown simples. "
    "Use **negrito** só nos termos-chave, porque o app os destaca como marca-texto. "
    "Não use LaTeX nem cifrões para fórmulas: escreva em texto simples, "
    "como x^2, raiz(x) ou a/b."
)

mimetypes.add_type("application/manifest+json", ".webmanifest")

app = Flask(__name__, static_folder=str(PASTA / "static"), static_url_path="")


# ---------------------------------------------------------------
# PROTEÇÕES SIMPLES
# ---------------------------------------------------------------

_pedidos = defaultdict(deque)
_trava = threading.Lock()


def endereco_do_cliente():
    # Atrás de um serviço de hospedagem, o endereço real vem neste cabeçalho.
    encaminhado = request.headers.get("X-Forwarded-For", "")
    return encaminhado.split(",")[0].strip() or request.remote_addr or "?"


def passou_do_limite(endereco):
    agora = time.monotonic()
    with _trava:
        fila = _pedidos[endereco]
        while fila and agora - fila[0] > 60:
            fila.popleft()
        if len(fila) >= LIMITE_POR_MINUTO:
            return True
        fila.append(agora)
        if len(_pedidos) > 5000:  # evita crescer sem fim
            _pedidos.clear()
        return False


def senha_correta():
    if not SENHA:
        return True
    enviada = request.headers.get("X-Aproxi-Senha", "")
    return hmac.compare_digest(enviada.encode("utf-8"), SENHA.encode("utf-8"))


def erro(texto, status):
    return jsonify({"erro": texto}), status


def limpar_mensagens(bruto):
    """Aceita só o formato esperado e corta o excesso."""
    if not isinstance(bruto, list):
        return []
    limpas = []
    for item in bruto[-MAX_MENSAGENS:]:
        if not isinstance(item, dict):
            continue
        papel, texto = item.get("role"), item.get("content")
        if papel in ("user", "assistant") and isinstance(texto, str) and texto.strip():
            limpas.append({"role": papel, "content": texto[:MAX_CARACTERES]})
    # A conversa precisa terminar com uma pergunta do usuário.
    while limpas and limpas[-1]["role"] != "user":
        limpas.pop()
    return limpas


# ---------------------------------------------------------------
# CONVERSA COM O MODELO (API compatível com a da OpenAI, em streaming)
# ---------------------------------------------------------------


def abrir_conexao(mensagens):
    dados = {
        "model": MODELO,
        "messages": [{"role": "system", "content": PERSONALIDADE + "\n\n" + FORMATO}] + mensagens,
        "max_tokens": MAX_TOKENS,
        "stream": True,
    }
    if ESFORCO:
        dados["reasoning_effort"] = ESFORCO
    corpo = json.dumps(dados).encode("utf-8")
    pedido = urllib.request.Request(
        BASE_URL.rstrip("/") + "/chat/completions",
        data=corpo,
        method="POST",
        headers={"Content-Type": "application/json", "Authorization": "Bearer " + CHAVE},
    )
    return urllib.request.urlopen(pedido, timeout=60)


def pedacos_de_texto(conexao):
    """Lê o fluxo do modelo e entrega só o texto novo de cada pedaço."""
    for bruta in conexao:
        linha = bruta.decode("utf-8", errors="replace").strip()
        if not linha.startswith("data:"):
            continue
        dados = linha[5:].strip()
        if dados == "[DONE]":
            break
        try:
            escolhas = json.loads(dados).get("choices") or []
        except ValueError:
            continue
        if escolhas:
            texto = (escolhas[0].get("delta") or {}).get("content")
            if texto:
                yield texto


def explicar_erro_http(status):
    if status in (400, 401, 403):
        return (
            "O serviço recusou a chave de API do servidor. "
            "Confira se a chave está certa e se o modelo existe.",
            502,
        )
    if status == 404:
        return "O modelo não foi encontrado. Troque o modelo na variável APROXI_MODELO.", 502
    if status == 429:
        return "Você atingiu o limite gratuito por agora. Espere um minuto e tente de novo.", 429
    return "O serviço de IA está com problema agora. Tente de novo em instantes.", 502


@app.post("/api/chat")
def conversar():
    if passou_do_limite(endereco_do_cliente()):
        return erro("Muitas mensagens em pouco tempo. Espere um instante.", 429)
    if not senha_correta():
        return erro("Senha incorreta ou ausente. Digite a senha de acesso no menu.", 401)
    if not CHAVE:
        return erro(f"O servidor ainda não tem a chave {CONFIG['variavel_chave']} configurada.", 500)

    dados = request.get_json(silent=True) or {}
    mensagens = limpar_mensagens(dados.get("messages"))
    if not mensagens:
        return erro("Escreva uma mensagem para o Aproxi.", 400)

    try:
        conexao = abrir_conexao(mensagens)
    except urllib.error.HTTPError as falha:
        detalhe = falha.read(300).decode("utf-8", errors="replace")
        print(f"[aproxi] o serviço respondeu {falha.code}: {detalhe}", file=sys.stderr)
        texto, status = explicar_erro_http(falha.code)
        return erro(texto, status)
    except (urllib.error.URLError, TimeoutError, OSError) as falha:
        print(f"[aproxi] falha de conexão com o serviço: {falha}", file=sys.stderr)
        return erro("O servidor não conseguiu falar com o serviço de IA. Tente de novo.", 502)

    def gerar():
        try:
            yield from pedacos_de_texto(conexao)
        except (OSError, ValueError) as falha:
            print(f"[aproxi] resposta interrompida: {falha}", file=sys.stderr)
            yield "\n\n⚠️ A resposta foi interrompida. Tente de novo."
        finally:
            conexao.close()

    return Response(
        gerar(),
        mimetype="text/plain; charset=utf-8",
        headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"},
    )


@app.get("/api/status")
def status():
    return jsonify({"ok": True, "senha": bool(SENHA), "configurado": bool(CHAVE), "provedor": PROVEDOR})


# ---------------------------------------------------------------
# ENTREGA DO APP
# ---------------------------------------------------------------


@app.get("/")
def pagina_inicial():
    return send_from_directory(app.static_folder, "index.html")


@app.after_request
def cabecalhos(resposta):
    # O navegador sempre confere se há versão nova do app e do service worker.
    if request.path in ("/", "/sw.js", "/app.js", "/style.css", "/manifest.webmanifest"):
        resposta.headers["Cache-Control"] = "no-cache"
    resposta.headers.setdefault("X-Content-Type-Options", "nosniff")
    return resposta


def endereco_na_rede():
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("10.255.255.255", 1))
            return s.getsockname()[0]
    except OSError:
        return None


if __name__ == "__main__":
    porta = int(os.environ.get("PORT", 8000))
    print("\n  Aproxi rodando.")
    print(f"  No computador:  http://localhost:{porta}")
    rede = endereco_na_rede()
    if rede:
        print(f"  No celular (mesmo Wi-Fi):  http://{rede}:{porta}")
    if not CHAVE:
        print(f"\n  Atenção: falta a chave {CONFIG['variavel_chave']}. Veja o LEIA-ME.md.")
    if not SENHA:
        print("  Dica: defina APROXI_SENHA para que só você use o app.")
    print()
    app.run(host="0.0.0.0", port=porta, threaded=True)
