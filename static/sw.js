/* Service worker do Aproxi: faz o app abrir mesmo sem internet.
   Só a tela fica disponível offline; conversar com a IA exige conexão. */

const VERSAO = 'aproxi-v1';
const TELA = [
  '/',
  '/style.css',
  '/app.js',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

self.addEventListener('install', (evento) => {
  evento.waitUntil(
    caches.open(VERSAO).then((cache) => cache.addAll(TELA)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (evento) => {
  evento.waitUntil(
    caches.keys()
      .then((nomes) => Promise.all(nomes.filter((n) => n !== VERSAO).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

// Rede primeiro (o app sempre atualiza); se estiver offline, usa a cópia guardada.
self.addEventListener('fetch', (evento) => {
  const pedido = evento.request;
  const url = new URL(pedido.url);
  if (pedido.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  evento.respondWith(
    fetch(pedido)
      .then((resposta) => {
        if (resposta.ok) {
          const copia = resposta.clone();
          caches.open(VERSAO).then((cache) => cache.put(pedido, copia));
        }
        return resposta;
      })
      .catch(() =>
        caches.match(pedido).then((guardada) =>
          guardada || (pedido.mode === 'navigate' ? caches.match('/') : Response.error())
        )
      )
  );
});
