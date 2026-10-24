/* Aproxi: lógica do app (conversas, envio, respostas aos poucos, menu). */
(() => {
  'use strict';

  const $ = (seletor) => document.querySelector(seletor);
  const el = {
    chat: $('#chat'),
    vazio: $('#empty'),
    aviso: $('#aviso'),
    msgs: $('#messages'),
    form: $('#composer'),
    input: $('#input'),
    enviar: $('#send'),
    menu: $('#btnMenu'),
    nova: $('#btnNew'),
    novaMenu: $('#btnNewDrawer'),
    fechar: $('#btnClose'),
    drawer: $('#drawer'),
    scrim: $('#scrim'),
    lista: $('#chatList'),
    senhaBloco: $('#senhaWrap'),
    senha: $('#senhaInput'),
    apagarTudo: $('#btnClear'),
    instalar: $('#btnInstall'),
    dicaIos: $('#iosHint'),
    toast: $('#toast'),
    meta: $('#metaTheme'),
    temas: document.querySelectorAll('[data-tema]'),
  };

  /* ---------- armazenamento no aparelho ---------- */

  const guardado = {
    ler(chave, padrao) {
      try {
        const valor = localStorage.getItem(chave);
        return valor === null ? padrao : JSON.parse(valor);
      } catch { return padrao; }
    },
    gravar(chave, valor) {
      try { localStorage.setItem(chave, JSON.stringify(valor)); } catch { /* sem armazenamento: segue sem salvar */ }
    },
  };

  const novoId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  let conversas = guardado.ler('aproxi:conversas', []);
  if (!Array.isArray(conversas)) conversas = [];
  conversas = conversas.filter((c) => c && typeof c.id === 'string' && Array.isArray(c.messages));
  let atualId = guardado.ler('aproxi:atual', null);
  if (!conversas.some((c) => c.id === atualId)) atualId = null;
  let senha = guardado.ler('aproxi:senha', '');
  let tema = guardado.ler('aproxi:tema', 'auto');

  let ocupado = false;
  let controle = null;
  let servidor = { senha: false, configurado: true };
  let convitePwa = null;

  const atual = () => conversas.find((c) => c.id === atualId) || null;

  function salvar() {
    conversas.sort((a, b) => b.updated - a.updated);
    conversas = conversas.slice(0, 50);
    guardado.gravar('aproxi:conversas', conversas);
    guardado.gravar('aproxi:atual', atualId);
  }

  /* ---------- markdown seguro ---------- */

  const esc = (s) => s
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  function emLinha(texto) {
    const codigos = [];
    let s = esc(texto);
    s = s.replace(/`([^`\n]+)`/g, (_, c) => { codigos.push(c); return `\u0000${codigos.length - 1}\u0000`; });
    s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/(^|[^*\w])\*([^*\n]+)\*(?!\w)/g, '$1<em>$2</em>');
    s = s.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g,
      '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
    return s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codigos[i]}</code>`);
  }

  const RE_FENCE = /^\s*```(\w*)\s*$/;
  const RE_LISTA = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
  const RE_TITULO = /^(#{1,6})\s+(.*)$/;
  const RE_HR = /^\s*([-*_])(\s*\1){2,}\s*$/;
  const RE_SEP_TABELA = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

  const celulas = (linha) => linha.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());

  function iniciaTabela(linhas, i) {
    return linhas[i].includes('|') && i + 1 < linhas.length && RE_SEP_TABELA.test(linhas[i + 1]) && linhas[i + 1].includes('-');
  }

  function iniciaBloco(linhas, i) {
    const l = linhas[i];
    return RE_FENCE.test(l) || RE_TITULO.test(l) || RE_LISTA.test(l) || RE_HR.test(l)
      || /^\s*>/.test(l) || iniciaTabela(linhas, i);
  }

  function blocoCodigo(codigo, linguagem) {
    return '<div class="code"><div class="code-head"><span>' + esc(linguagem || 'código')
      + '</span><button type="button" data-copiar-codigo>Copiar</button></div><pre><code>'
      + esc(codigo) + '</code></pre></div>';
  }

  function md(texto) {
    const linhas = texto.replace(/\r/g, '').split('\n');
    const saida = [];
    let i = 0;
    while (i < linhas.length) {
      const linha = linhas[i];
      let m;

      if ((m = linha.match(RE_FENCE))) {
        const buf = [];
        i++;
        while (i < linhas.length && !/^\s*```\s*$/.test(linhas[i])) buf.push(linhas[i++]);
        i++;
        saida.push(blocoCodigo(buf.join('\n'), m[1]));
        continue;
      }
      if (/^\s*$/.test(linha)) { i++; continue; }

      if ((m = linha.match(RE_TITULO))) {
        const nivel = Math.min(m[1].length + 2, 5);
        saida.push(`<h${nivel}>${emLinha(m[2])}</h${nivel}>`);
        i++;
        continue;
      }
      if (RE_HR.test(linha)) { saida.push('<hr>'); i++; continue; }

      if (iniciaTabela(linhas, i)) {
        const cab = celulas(linha);
        i += 2;
        const corpo = [];
        while (i < linhas.length && linhas[i].includes('|') && !/^\s*$/.test(linhas[i])) corpo.push(celulas(linhas[i++]));
        saida.push('<div class="tabela"><table><thead><tr>'
          + cab.map((c) => `<th>${emLinha(c)}</th>`).join('') + '</tr></thead><tbody>'
          + corpo.map((r) => '<tr>' + r.map((c) => `<td>${emLinha(c)}</td>`).join('') + '</tr>').join('')
          + '</tbody></table></div>');
        continue;
      }

      if (/^\s*>/.test(linha)) {
        const buf = [];
        while (i < linhas.length && /^\s*>/.test(linhas[i])) buf.push(linhas[i++].replace(/^\s*>\s?/, ''));
        saida.push(`<blockquote>${buf.map(emLinha).join('<br>')}</blockquote>`);
        continue;
      }

      if ((m = linha.match(RE_LISTA))) {
        const ordenada = /\d/.test(m[2]);
        const itens = [];
        while (i < linhas.length && (m = linhas[i].match(RE_LISTA))) {
          itens.push(`<li${m[1].length >= 2 ? ' class="n2"' : ''}>${emLinha(m[3])}</li>`);
          i++;
        }
        saida.push(`<${ordenada ? 'ol' : 'ul'}>${itens.join('')}</${ordenada ? 'ol' : 'ul'}>`);
        continue;
      }

      const buf = [];
      while (i < linhas.length && !/^\s*$/.test(linhas[i]) && (buf.length === 0 || !iniciaBloco(linhas, i))) {
        buf.push(linhas[i++]);
      }
      saida.push(`<p>${buf.map(emLinha).join('<br>')}</p>`);
    }
    return saida.join('');
  }

  /* ---------- mensagens na tela ---------- */

  const MARCA = '<svg class="avatar" viewBox="0 0 64 64" aria-hidden="true"><use href="#mark"/></svg>';
  const BOTAO_COPIAR = '<div class="acoes"><button type="button" data-copiar-msg>Copiar resposta</button></div>';

  function criarUsuario(texto) {
    const raiz = document.createElement('div');
    raiz.className = 'msg user';
    const balao = document.createElement('div');
    balao.className = 'bubble';
    balao.textContent = texto;
    raiz.append(balao);
    return raiz;
  }

  function criarAssistente(texto, comAcoes) {
    const raiz = document.createElement('div');
    raiz.className = 'msg bot';
    raiz.innerHTML = MARCA + '<div class="conteudo"><div class="corpo"></div></div>';
    const corpo = raiz.querySelector('.corpo');
    if (texto) corpo.innerHTML = md(texto);
    raiz._texto = texto || '';
    if (comAcoes) raiz.querySelector('.conteudo').insertAdjacentHTML('beforeend', BOTAO_COPIAR);
    return { raiz, corpo };
  }

  const pertoDoFim = () => el.chat.scrollHeight - el.chat.scrollTop - el.chat.clientHeight < 90;
  const irParaOFim = () => { el.chat.scrollTop = el.chat.scrollHeight; };

  function desenharTudo() {
    el.msgs.textContent = '';
    const c = atual();
    el.vazio.hidden = !!(c && c.messages.length);
    if (c) {
      c.messages.forEach((m) => {
        el.msgs.append(m.role === 'user' ? criarUsuario(m.content) : criarAssistente(m.content, true).raiz);
      });
    }
    irParaOFim();
  }

  function aviso(texto) {
    el.toast.textContent = texto;
    el.toast.classList.add('on');
    clearTimeout(aviso.t);
    aviso.t = setTimeout(() => el.toast.classList.remove('on'), 2200);
  }

  async function copiar(texto) {
    try {
      await navigator.clipboard.writeText(texto);
    } catch {
      const area = document.createElement('textarea');
      area.value = texto;
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.append(area);
      area.select();
      try { document.execCommand('copy'); } catch { /* sem permissão */ }
      area.remove();
    }
    aviso('Copiado');
  }

  /* ---------- envio e resposta ---------- */

  class ErroDoApp extends Error {}

  function mostrarErro(bot, texto) {
    bot.raiz.classList.add('erro');
    bot.corpo.innerHTML = '<p></p><button type="button" class="retry" data-tentar>Tentar de novo</button>';
    bot.corpo.querySelector('p').textContent = texto;
  }

  function atualizarBotao() {
    el.enviar.dataset.state = ocupado ? 'stop' : 'send';
    el.enviar.disabled = !ocupado && !el.input.value.trim();
    el.enviar.setAttribute('aria-label', ocupado ? 'Parar resposta' : 'Enviar');
  }

  function ajustarCampo() {
    el.input.style.height = 'auto';
    el.input.style.height = Math.min(el.input.scrollHeight, 160) + 'px';
  }

  async function responder() {
    const conversa = atual();
    if (!conversa || ocupado) return;
    ocupado = true;
    atualizarBotao();

    const bot = criarAssistente('', false);
    bot.corpo.innerHTML = '<span class="digitando" aria-label="Aproxi está escrevendo"><i></i><i></i><i></i></span>';
    el.msgs.append(bot.raiz);
    irParaOFim();

    controle = new AbortController();
    let acumulado = '';
    let falhou = false;

    try {
      const resp = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Aproxi-Senha': senha },
        body: JSON.stringify({ messages: conversa.messages.slice(-20) }),
        signal: controle.signal,
      });

      if (!resp.ok) {
        let texto = 'Algo deu errado. Tente de novo.';
        try { texto = (await resp.json()).erro || texto; } catch { /* resposta sem JSON */ }
        if (resp.status === 401) { servidor.senha = true; mostrarSenha(); abrirMenu(); el.senha.focus(); }
        throw new ErroDoApp(texto);
      }

      const leitor = resp.body.getReader();
      const decodificador = new TextDecoder();
      let quadro = 0;
      const pintar = () => {
        quadro = 0;
        const seguir = pertoDoFim();
        bot.corpo.innerHTML = md(acumulado);
        if (seguir) irParaOFim();
      };

      for (;;) {
        const { done, value } = await leitor.read();
        if (done) break;
        acumulado += decodificador.decode(value, { stream: true });
        if (!quadro) quadro = requestAnimationFrame(pintar);
      }
      acumulado += decodificador.decode();
      cancelAnimationFrame(quadro);
      bot.corpo.innerHTML = md(acumulado);
    } catch (e) {
      if (e.name !== 'AbortError') {
        falhou = true;
        mostrarErro(bot, e instanceof ErroDoApp
          ? e.message
          : 'Sem conexão com o servidor do Aproxi. Confira a internet e tente de novo.');
      }
    }

    if (acumulado.trim()) {
      bot.raiz._texto = acumulado;
      bot.raiz.querySelector('.conteudo').insertAdjacentHTML('beforeend', BOTAO_COPIAR);
      conversa.messages.push({ role: 'assistant', content: acumulado });
      conversa.updated = Date.now();
      salvar();
    } else if (!falhou) {
      bot.raiz.remove();
      if (controle && !controle.signal.aborted) aviso('O Aproxi não devolveu texto. Tente reformular a pergunta.');
    }

    ocupado = false;
    controle = null;
    atualizarBotao();
    desenharLista();
    irParaOFim();
  }

  function enviar(texto) {
    if (ocupado) return;
    let c = atual();
    if (!c) {
      c = { id: novoId(), title: '', updated: Date.now(), messages: [] };
      conversas.unshift(c);
      atualId = c.id;
    }
    c.messages.push({ role: 'user', content: texto });
    if (!c.title) c.title = texto.length > 42 ? texto.slice(0, 42).trimEnd() + '…' : texto;
    c.updated = Date.now();
    salvar();
    desenharLista();

    el.vazio.hidden = true;
    el.msgs.append(criarUsuario(texto));
    el.input.value = '';
    ajustarCampo();
    responder();
  }

  /* ---------- menu lateral ---------- */

  function desenharLista() {
    el.lista.textContent = '';
    if (!conversas.length) {
      const p = document.createElement('li');
      p.className = 'lista-vazia';
      p.textContent = 'As conversas salvas aparecem aqui.';
      el.lista.append(p);
      return;
    }
    [...conversas].sort((a, b) => b.updated - a.updated).forEach((c) => {
      const li = document.createElement('li');
      if (c.id === atualId) li.className = 'atual';
      li.dataset.id = c.id;
      const abrir = document.createElement('button');
      abrir.type = 'button';
      abrir.className = 'abrir';
      abrir.textContent = c.title || 'Conversa sem título';
      const apagar = document.createElement('button');
      apagar.type = 'button';
      apagar.className = 'apagar';
      apagar.setAttribute('aria-label', 'Apagar conversa: ' + (c.title || 'sem título'));
      apagar.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>';
      li.append(abrir, apagar);
      el.lista.append(li);
    });
  }

  function abrirMenu() {
    el.drawer.classList.add('on');
    el.scrim.classList.add('on');
    el.drawer.setAttribute('aria-hidden', 'false');
    el.fechar.focus();
  }

  function fecharMenu() {
    el.drawer.classList.remove('on');
    el.scrim.classList.remove('on');
    el.drawer.setAttribute('aria-hidden', 'true');
  }

  function novaConversa() {
    if (ocupado && controle) controle.abort();
    atualId = null;
    salvar();
    desenharTudo();
    desenharLista();
    fecharMenu();
    el.input.focus();
  }

  function mostrarSenha() { el.senhaBloco.hidden = !servidor.senha; }

  /* ---------- tema ---------- */

  function aplicarTema() {
    const raiz = document.documentElement;
    if (tema === 'auto') raiz.removeAttribute('data-tema'); else raiz.setAttribute('data-tema', tema);
    el.temas.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tema === tema)));
    requestAnimationFrame(() => {
      const fundo = getComputedStyle(raiz).getPropertyValue('--bg').trim();
      if (fundo) el.meta.setAttribute('content', fundo);
    });
  }

  /* ---------- eventos ---------- */

  const telaDeToque = matchMedia('(pointer: coarse)').matches;

  el.input.addEventListener('input', () => { ajustarCampo(); atualizarBotao(); });
  el.input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !telaDeToque && !e.isComposing) {
      e.preventDefault();
      el.form.requestSubmit();
    }
  });

  el.form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (ocupado) { if (controle) controle.abort(); return; }
    const texto = el.input.value.trim();
    if (texto) enviar(texto);
  });

  el.vazio.addEventListener('click', (e) => {
    const botao = e.target.closest('[data-prompt]');
    if (botao) enviar(botao.dataset.prompt);
  });

  el.msgs.addEventListener('click', (e) => {
    const codigo = e.target.closest('[data-copiar-codigo]');
    if (codigo) { copiar(codigo.closest('.code').querySelector('pre').textContent); return; }

    const mensagem = e.target.closest('[data-copiar-msg]');
    if (mensagem) { copiar(mensagem.closest('.msg')._texto || ''); return; }

    if (e.target.closest('[data-tentar]')) {
      e.target.closest('.msg').remove();
      responder();
    }
  });

  el.menu.addEventListener('click', abrirMenu);
  el.fechar.addEventListener('click', fecharMenu);
  el.scrim.addEventListener('click', fecharMenu);
  el.nova.addEventListener('click', novaConversa);
  el.novaMenu.addEventListener('click', novaConversa);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') fecharMenu(); });

  el.lista.addEventListener('click', (e) => {
    const item = e.target.closest('li[data-id]');
    if (!item) return;
    const id = item.dataset.id;
    if (e.target.closest('.apagar')) {
      if (!confirm('Apagar esta conversa?')) return;
      conversas = conversas.filter((c) => c.id !== id);
      if (atualId === id) atualId = null;
      salvar();
      desenharLista();
      desenharTudo();
      return;
    }
    if (ocupado && controle) controle.abort();
    atualId = id;
    salvar();
    desenharTudo();
    desenharLista();
    fecharMenu();
  });

  el.apagarTudo.addEventListener('click', () => {
    if (!confirm('Apagar todas as conversas deste aparelho?')) return;
    conversas = [];
    atualId = null;
    salvar();
    desenharLista();
    desenharTudo();
    fecharMenu();
    aviso('Conversas apagadas');
  });

  el.senha.value = senha;
  el.senha.addEventListener('change', () => {
    senha = el.senha.value;
    guardado.gravar('aproxi:senha', senha);
    aviso('Senha salva neste aparelho');
  });

  el.temas.forEach((b) => b.addEventListener('click', () => {
    tema = b.dataset.tema;
    guardado.gravar('aproxi:tema', tema);
    aplicarTema();
  }));
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', aplicarTema);

  /* instalar como app */
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    convitePwa = e;
    el.instalar.hidden = false;
  });
  el.instalar.addEventListener('click', async () => {
    if (!convitePwa) return;
    convitePwa.prompt();
    await convitePwa.userChoice;
    convitePwa = null;
    el.instalar.hidden = true;
  });
  window.addEventListener('appinstalled', () => { el.instalar.hidden = true; aviso('Aproxi instalado'); });

  const noIphone = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const instalado = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  if (noIphone && !instalado) el.dicaIos.hidden = false;

  /* a tela acompanha o teclado do celular */
  if (window.visualViewport) {
    const ajustar = () => {
      document.documentElement.style.setProperty('--vh', window.visualViewport.height + 'px');
      if (window.visualViewport.offsetTop) window.scrollTo(0, 0);
    };
    window.visualViewport.addEventListener('resize', ajustar);
    window.visualViewport.addEventListener('scroll', ajustar);
    ajustar();
  }

  /* ---------- início ---------- */

  aplicarTema();
  desenharLista();
  desenharTudo();
  atualizarBotao();

  fetch('/api/status')
    .then((r) => r.json())
    .then((s) => {
      servidor = s;
      mostrarSenha();
      if (!s.configurado) {
        el.aviso.hidden = false;
        el.aviso.textContent = 'O servidor ainda não tem a chave de API. Siga o passo 3 do LEIA-ME para configurá-la.';
      } else if (s.senha && !senha) {
        abrirMenu();
        aviso('Digite a senha de acesso');
        el.senha.focus();
      }
    })
    .catch(() => { /* offline: a tela abre, mas conversar exige internet */ });

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => { /* sem service worker: funciona igual */ });
  }
})();
