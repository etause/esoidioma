/* Notas - Service Worker (يشتغل بدون إنترنت)
   - غيّر رقم VERSION كلما غيّرت قائمة ملفات SHELL حتى يتحدّث الكاش القديم.
   - تحديث index.html نفسه ما يحتاج تغيير الرقم: يُجلب من النت أولًا كلما توفر. */
const VERSION = 'notas-v1';
const SHELL_CACHE = VERSION + '-shell';
const RUNTIME_CACHE = VERSION + '-runtime';

/* مسارات نسبية: تشتغل على گيتهوب سواء كان الموقع في الجذر أو داخل مجلد المستودع */
const BASE = new URL('./', self.registration.scope).href;
const INDEX = new URL('index.html', BASE).href;
const SHELL = [
  './',
  'index.html',
  'manifest.webmanifest',
  'icon.svg',
  'icon-192.png',
  'icon-512.png',
  'apple-touch-icon.png'
].map(p => new URL(p, BASE).href);

/* مواقع خارجية يُخزَّن ما يُحمَّل منها (خطوط + مكتبات القراءة) */
const CDN_HOSTS = [
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'cdn.jsdelivr.net',
  'cdnjs.cloudflare.com'
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    /* إذا ملف ناقص (مثلًا icon-512.png) ما يفشل التثبيت كله */
    await Promise.allSettled(SHELL.map(u => cache.add(new Request(u, { cache: 'reload' }))));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keep = [SHELL_CACHE, RUNTIME_CACHE];
    const names = await caches.keys();
    await Promise.all(names.filter(n => keep.indexOf(n) < 0).map(n => caches.delete(n)));
    await self.clients.claim();
  })());
});

function isIndex(url) {
  return url.pathname.endsWith('/') || url.pathname.endsWith('/index.html');
}

function offlineResponse() {
  return new Response('Offline', { status: 503, statusText: 'Offline', headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}

/* الصفحة الرئيسية: النت أولًا (لتصل التحديثات)، وإذا انقطع أو تأخر يُفتح من الكاش */
async function networkFirst(req) {
  const cache = await caches.open(SHELL_CACHE);
  const p = fetch(req);
  p.catch(() => {});
  try {
    const res = await Promise.race([
      p,
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 4500))
    ]);
    if (res && res.status === 200) cache.put(INDEX, res.clone());
    return res;
  } catch (e) {
    const hit = (await cache.match(INDEX)) || (await cache.match(BASE));
    if (hit) return hit;
    return p.catch(() => offlineResponse());
  }
}

/* باقي الملفات: من الكاش فورًا، وتتحدّث بالخلفية */
async function staleWhileRevalidate(event, name) {
  const req = event.request;
  const cache = await caches.open(name);
  const hit = await cache.match(req);
  const net = fetch(req).then(res => {
    if (res && (res.status === 200 || res.type === 'opaque')) cache.put(req, res.clone());
    return res;
  }).catch(() => null);
  if (hit) {
    event.waitUntil(net);
    return hit;
  }
  return (await net) || offlineResponse();
}

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.origin === self.location.origin) {
    if (req.mode === 'navigate' || isIndex(url)) {
      event.respondWith(networkFirst(req));
    } else {
      event.respondWith(staleWhileRevalidate(event, SHELL_CACHE));
    }
    return;
  }

  if (CDN_HOSTS.indexOf(url.hostname) > -1) {
    event.respondWith(staleWhileRevalidate(event, RUNTIME_CACHE));
  }
  /* أي شيء ثاني (Google Drive وتسجيل الدخول والترجمة والمصحّح...) يمرّ للنت كالمعتاد */
});
