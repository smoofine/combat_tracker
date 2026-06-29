// ── Bump this version whenever you change any cached file ──────────────
// IMPORTANT: changing CACHE forces the browser to install the new SW,
// which is the ONLY way Android re-reads the manifest share_target
// registration. Without a version bump the old SW (and old registration)
// stays active even after you push a new manifest to GitHub Pages.
const CACHE  = 'combat-tracker-v3';
const SHARED = 'share-v1';
const FILES  = ['./', './manifest.json', './icon.svg'];

// ── Install: cache app shell ────────────────────────────────────────────
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(FILES).catch(() => {}))
      .then(() => self.skipWaiting())   // activate immediately, don't wait
  );
});

// ── Activate: take control of all open tabs right away ─────────────────
self.addEventListener('activate', e => {
  // Delete stale caches from previous versions
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(k => k !== CACHE && k !== SHARED)
          .map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// ── Fetch: share target POST + cache-first for everything else ──────────
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Handle the share target POST from FC5e / any file-sharing app.
  // FC5e's "Create Fight Club File" sends a .dnd5e file (which is XML
  // internally) with MIME type application/octet-stream — that's why the
  // manifest now lists "*/*" and "application/octet-stream" in addition
  // to the XML types, so Android includes this PWA in the share sheet.
  if (url.searchParams.has('from-share') && e.request.method === 'POST') {
    e.respondWith(handleShare(e.request));
    return;
  }

  // Cache-first for the app shell
  e.respondWith(
    caches.match(e.request)
      .then(r => r || fetch(e.request).then(res => {
        if (url.origin === location.origin) {
          caches.open(CACHE)
            .then(c => c.put(e.request, res.clone()))
            .catch(() => {});
        }
        return res;
      }))
      .catch(() =>
        caches.match('./').then(r => r || new Response('Offline', { status: 503 }))
      )
  );
});

// ── handleShare: extract XML, save to cache, redirect to app ───────────
// FC5e exports both .xml and .dnd5e files — both are plain XML inside.
// We accept any file from the share sheet, read it as text, and if it
// looks like a FC5e character XML we store it for the app to consume.
async function handleShare(request) {
  try {
    const formData = await request.formData();

    // The field name in params.files[0].name is "character"
    const file = formData.get('character');

    if (file && (file.size > 0 || typeof file === 'string')) {
      const text = typeof file === 'string' ? file : await file.text();

      // Basic sanity check: must look like a FC5e XML
      if (text.includes('<character>') || text.includes('<?xml')) {
        const cache = await caches.open(SHARED);
        await cache.put('pending', new Response(text, {
          headers: { 'Content-Type': 'text/xml; charset=utf-8' }
        }));
      }
    }
  } catch (err) {
    // Even if extraction fails, redirect the user to the app
    // so they at least see it open (better than a blank screen)
  }

  // 303 See Other → GET redirect to the app, clearing the POST
  return Response.redirect('./?from-share', 303);
}
