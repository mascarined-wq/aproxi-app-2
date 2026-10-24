# Aproxi, o app de celular

O Aproxi é um app de chat de estudos que você instala no celular como qualquer outro. Por dentro ele é um site (um PWA), e um pequeno servidor guarda a sua chave de API, então a chave nunca fica dentro do celular.

```
celular (app Aproxi)  →  servidor (guarda a chave)  →  Gemini ou Groq
```

## O que tem na pasta

| Arquivo | Para que serve |
|---|---|
| `server.py` | O servidor: entrega o app, guarda a chave, pede a resposta à IA |
| `static/` | O app em si (telas, estilo, ícones) |
| `personalidade.txt` | O jeito do Aproxi: edite o texto e reinicie o servidor |
| `.env.exemplo` | Modelo do arquivo de configuração (chave e senha) |
| `render.yaml` | Configuração pronta para publicar na Render |
| `requirements.txt` | As dependências (Flask e gunicorn) |
| `ferramentas/gerar_icones.py` | Opcional: refaz os ícones do app |

## Passo 1: testar no computador

1. Tenha o Python 3.9 ou mais novo (`python --version` no terminal).
2. Abra o terminal dentro desta pasta e instale as dependências:
   ```
   pip install -r requirements.txt
   ```
3. Crie uma chave gratuita em https://aistudio.google.com/apikey (Gemini).
4. Copie o arquivo `.env.exemplo` e dê ao novo arquivo o nome `.env`. Abra o `.env` e preencha:
   ```
   GEMINI_API_KEY=cole-sua-chave-aqui
   APROXI_SENHA=escolha-uma-senha
   ```
   No Windows, se o sistema esconder a extensão ou não deixar criar um arquivo que começa com ponto, abra o Bloco de Notas, use **Salvar como**, escolha **Todos os arquivos** e digite `.env` como nome.
5. Inicie:
   ```
   python server.py
   ```
6. Abra http://localhost:8000 no navegador. O servidor também mostra um endereço para usar no celular, na mesma rede Wi-Fi.

Para usar o Groq no lugar do Gemini, ponha `GROQ_API_KEY=...` e `APROXI_PROVEDOR=groq` no `.env`. Para escolher o modelo, use `APROXI_MODELO=nome-do-modelo`. Modelos que raciocinam antes de responder, como o `openai/gpt-oss-120b`, gastam parte do limite de resposta pensando: use `APROXI_MAX_TOKENS=4000` e, se quiser respostas mais rápidas, `APROXI_REASONING_EFFORT=low`. Se o Groq recusar essa última linha, apague-a.

Na Render, o `render.yaml` já vem preenchido para o Groq com o `openai/gpt-oss-120b`. Falta só cadastrar `GROQ_API_KEY` e `APROXI_SENHA` no painel.

## Passo 2: ver no celular, na mesma rede Wi-Fi

Com o servidor rodando, abra no navegador do celular o endereço que aparece no terminal (algo como `http://192.168.0.10:8000`). Serve para conferir como ficou. Como esse endereço não usa HTTPS, o celular não instala o app de verdade, só deixa criar um atalho. Para instalar de verdade, siga o passo 3.

## Passo 3: colocar na internet de graça (Render)

Assim o app funciona de qualquer lugar, sem o seu computador ligado.

1. Crie uma conta no GitHub e um repositório novo (pode ser privado).
2. Envie para ele o conteúdo desta pasta. O arquivo `.gitignore` já impede que o `.env` com a sua chave suba. **Confira que o `.env` não apareceu no repositório.**
3. Crie uma conta em https://render.com e escolha **New** → **Blueprint**, apontando para o seu repositório. A Render lê o `render.yaml` e monta tudo. Se preferir fazer à mão, escolha **New** → **Web Service** e preencha:
   - Build command: `pip install -r requirements.txt`
   - Start command: `gunicorn server:app --workers 1 --threads 8 --timeout 120`
   - Plano: Free
4. Na parte de **Environment** (variáveis), cadastre `GEMINI_API_KEY` (a sua chave) e `APROXI_SENHA` (a senha do app). É aqui que a chave fica guardada, e não no código.
5. Quando terminar, a Render mostra o endereço do seu app, no formato `https://aproxi-xxxx.onrender.com`.

Como funciona o plano gratuito da Render, segundo a página oficial deles hoje:
- Depois de 15 minutos sem uso o serviço "dorme", e a próxima abertura demora cerca de 1 minuto para acordar.
- São 750 horas gratuitas por mês.
- A própria Render diz que o plano gratuito não é para produção.

As regras mudam, então confira em https://render.com/docs/free antes de depender delas.

## Passo 4: instalar no celular

Abra o endereço do app (o `https://...onrender.com`) no celular.

- **Android (Chrome):** toque em **Instalar o Aproxi neste aparelho** no menu do app, ou no menu ⋮ do Chrome e em **Instalar app** (ou **Adicionar à tela inicial**).
- **iPhone (Safari):** toque no botão de compartilhar e escolha **Adicionar à Tela de Início**.

O ícone do Aproxi aparece com os seus outros apps e abre em tela cheia. Na primeira vez, digite a senha no menu do app (o ícone de três linhas); ela fica salva no aparelho.

## Personalizar

- **Jeito do Aproxi:** edite o `personalidade.txt`. Ideias: professor de matemática paciente, tutor de inglês que corrige seus erros, parceiro que te testa como numa prova.
- **Cores:** estão no começo do `static/style.css`. O azul é `--pen` e o amarelo do marca-texto é `--hl`.
- **Nome:** troque "Aproxi" no `static/index.html` e no `static/manifest.webmanifest`.
- **Modelo:** se aparecer erro de modelo não encontrado, escolha outro na lista do serviço e coloque o nome em `APROXI_MODELO`.

Depois de mudar algo no app, reinicie o servidor. No celular, feche o app e abra de novo para ele pegar a versão nova.

## Segurança e privacidade

- A chave fica só no servidor. Nunca coloque a chave no `static/` nem no GitHub.
- Sem `APROXI_SENHA`, qualquer pessoa com o link gasta o seu limite gratuito. Use sempre uma senha ao publicar.
- As conversas ficam guardadas só no navegador do aparelho. Apagar os dados do navegador apaga as conversas, e elas não passam para outro aparelho.
- No plano gratuito do Gemini, o Google pode usar o que você escreve para melhorar os produtos dele. Não envie senhas nem dados pessoais.

## Se algo der errado

| O que aparece | O que fazer |
|---|---|
| "O servidor ainda não tem a chave de API" | Falta `GEMINI_API_KEY` (ou `GROQ_API_KEY`). No `.env` ou nas variáveis da Render. |
| "Senha incorreta ou ausente" | Digite a senha no menu do app. Ela precisa ser igual à `APROXI_SENHA`. |
| "O serviço recusou a chave" | A chave foi copiada incompleta ou o modelo não existe. Gere outra chave e confira `APROXI_MODELO`. |
| "Você atingiu o limite gratuito" | Espere um minuto. Se repetir todo dia, o limite diário do plano gratuito acabou. |
| O app demora para abrir | A Render estava dormindo. Espere cerca de 1 minuto. |
| Erro dizendo que `pip` ou `python` não existe | Instale o Python marcando "Add Python to PATH". Tente `py` ou `python3` no lugar de `python`. |

## Próximo passo: virar app da loja

O app já se instala e se comporta como um app. Para publicar na Play Store ou na App Store, é preciso empacotá-lo e pagar a taxa de desenvolvedor de cada loja. Existem ferramentas que empacotam um PWA para Android (como o PWABuilder). Vale conferir o passo a passo atual no site delas quando chegar essa hora.
