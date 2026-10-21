/* Come Through service worker: an app shell that opens offline, the Android share target,
   and push notifications. Hand-written so it stays small and readable. */
const SHELL = 'ct-shell-v2';
const RUNTIME = 'ct-runtime-v1';
const SHARE = 'ct-share';

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL);
    // Cache the page and every hashed asset it references.
    const res = await fetch('/', { cache: 'reload' });
    const html = await res.clone().text();
    await cache.put('/', res);
    const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1]);
    // The font is referenced from the stylesheet, not the page, so read the CSS for it too.
    for (const css of assets.filter((a) => a.endsWith('.css'))) {
      const text = await (await fetch(css)).text();
      for (const m of text.matchAll(/url\((\/assets\/[^)]+)\)/g)) assets.push(m[1]);
    }
    await cache.addAll([...new Set([...assets, '/manifest.webmanifest', '/icons/icon.svg', '/icons/icon-192.png'])]);
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keep = [SHELL, RUNTIME, SHARE];
    for (const k of await caches.keys()) if (!keep.includes(k)) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Android share sheet: stash what was shared, then open the page that handles it.
  if (req.method === 'POST' && url.origin === location.origin && url.pathname === '/share') {
    event.respondWith((async () => {
      const form = await req.formData();
      const cache = await caches.open(SHARE);
      const image = form.get('image');
      const meta = { title: form.get('title') || '', text: form.get('text') || '', url: form.get('url') || '', image: !!(image && image.size) };
      await cache.put('/share/meta', new Response(JSON.stringify(meta), { headers: { 'Content-Type': 'application/json' } }));
      if (meta.image) await cache.put('/share/image', new Response(image, { headers: { 'Content-Type': image.type || 'image/jpeg' } }));
      else await cache.delete('/share/image');
      return Response.redirect('/share?received=1', 303);
    })());
    return;
  }

  if (req.method !== 'GET' || url.origin !== location.origin) return;

  // The API and calendar feeds always go to the network.
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/cal/')) return;

  // Pages: network first so the app is fresh, the cached shell when offline.
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const res = await fetch(req);
        const cache = await caches.open(SHELL);
        cache.put('/', res.clone());
        return res;
      } catch {
        return (await caches.match('/')) || Response.error();
      }
    })());
    return;
  }

  // Hashed assets never change: cache first.
  if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/') || url.pathname.startsWith('/mock/')) {
    event.respondWith((async () => {
      const hit = await caches.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) (await caches.open(RUNTIME)).put(req, res.clone());
      return res;
    })());
  }
});

// Push: the server sends { title, body, url }.
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { body: event.data && event.data.text() }; }
  event.waitUntil(self.registration.showNotification(data.title || 'Come Through', {
    body: data.body || 'A new plan just dropped.',
    icon: '/icons/icon-192.png',
    badge: '/icons/badge-96.png',
    data: { url: data.url || '/' },
    tag: data.tag,
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || '/', location.origin).href;
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const w of wins) {
      if (w.url === target && 'focus' in w) return w.focus();
    }
    return self.clients.openWindow(target);
  })());
});
