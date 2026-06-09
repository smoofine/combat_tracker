const CACHE  = 'combat-tracker-v1';
const SHARED = 'share-v1';
const FILES  = ['./', './manifest.json', './icon.svg'];

// Install: cache app files
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(FILES).catch(() => {}))
      .then(() => self.skipWaiting())
  );
});

// Activate: claim clients immediately
self.addEventListener('activate', e => {
  e.waitUntil(self.clients.claim());
});

// Fetch: handle share target POST + cache-first for app files
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Handle the share target POST from FC5e
  if (url.searchParams.has('from-share') && e.request.method === 'POST') {
    e.respondWith(handleShare(e.request));
    return;
  }

  // Cache-first strategy for app shell
  e.respondWith(
    caches.match(e.request)
      .then(r => r || fetch(e.request).then(res => {
        // Cache new app resources
        if (url.origin === location.origin) {
          caches.open(CACHE).then(c => c.put(e.request, res.clone())).catch(() => {});
        }
        return res;
      }))
      .catch(() => caches.match('./').then(r => r || new Response('Offline', {status: 503})))
  );
});

// Save shared XML file, redirect to app
async function handleShare(request) {
  try {
    const formData = await request.formData();
    const file = formData.get('character');
    if (file && file.size > 0) {
      const text  = await file.text();
      const cache = await caches.open(SHARED);
      await cache.put('pending', new Response(text, {
        headers: { 'Content-Type': 'text/xml; charset=utf-8' }
      }));
    }
  } catch(e) {
    // If anything fails, still redirect to the app
  }
  return Response.redirect('./?from-share', 303);
}
