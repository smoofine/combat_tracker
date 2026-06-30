// ═══════════════════════════════════════════════════════════════════════
//  Combat Tracker — Service Worker
//  Para actualizar la app para todos:
//    1. Sube los archivos cambiados a GitHub Pages
//    2. Incrementa CACHE_VERSION (v1 → v2, etc.)
//    3. Commit y push — los usuarios verán la notificación al recargar
// ═══════════════════════════════════════════════════════════════════════
const CACHE_VERSION = 'combat-tracker-v4';
const SHARE_CACHE   = 'share-v1';           // caché aparte para el archivo pendiente
const SHELL_FILES   = [
  '/combat_tracker/',
  '/combat_tracker/manifest.json',
  '/combat_tracker/icon.svg'
];

// ── INSTALL: precachear el shell y activar inmediatamente ──────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then(cache => cache.addAll(SHELL_FILES).catch(() => {}))
      .then(() => self.skipWaiting())   // no esperar a que cierren otras pestañas
  );
});

// ── ACTIVATE: borrar cachés viejas y tomar control de todos los clientes
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          // Borrar cualquier caché de versión anterior; SHARE_CACHE se preserva
          .filter(k => k !== CACHE_VERSION && k !== SHARE_CACHE)
          .map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// ── FETCH: Network-First + share target POST ───────────────────────────
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // ── 1. Share target: POST desde FC5e / cualquier app de archivos ──
  //    Android envía el archivo aquí cuando el usuario elige este tracker
  //    en el cajón de compartir. El SW extrae el XML, lo guarda en caché
  //    y redirige con ?from-share para que el index.html lo consuma.
  if (url.searchParams.has('from-share') && event.request.method === 'POST') {
    event.respondWith(handleSharePost(event.request));
    return;
  }

  // ── 2. Network-First para todos los demás recursos ────────────────
  //    Intenta la red primero; si falla (offline), usa caché.
  //    Si la red trae algo nuevo, avisa a la app para que ofrezca recargar.
  event.respondWith(networkFirst(event.request));
});

// ── Network-First con notificación de actualización ───────────────────
async function networkFirst(request) {
  const cache = await caches.open(CACHE_VERSION);
  const cachedResponse = await cache.match(request);

  try {
    const networkResponse = await fetch(request);

    if (networkResponse && networkResponse.ok) {
      const url = new URL(request.url);
      const isShellFile = SHELL_FILES.some(f => url.pathname.endsWith(f) || url.pathname === f);

      // Solo avisar si es un archivo del shell Y su contenido cambió de
      // verdad respecto a lo que ya teníamos cacheado — evita el falso
      // positivo de mostrar "actualización disponible" en la primerísima
      // carga (cuando no había nada cacheado todavía) o en cada recarga
      // normal cuando el archivo es idéntico byte a byte.
      if (isShellFile && cachedResponse) {
        const [newText, oldText] = await Promise.all([
          networkResponse.clone().text().catch(() => null),
          cachedResponse.clone().text().catch(() => null)
        ]);
        if (newText !== null && oldText !== null && newText !== oldText) {
          notifyClientsOfUpdate();
        }
      }

      cache.put(request, networkResponse.clone()).catch(() => {});
    }
    return networkResponse;
  } catch {
    // Sin red — usar caché
    return cachedResponse || new Response('Sin conexión', { status: 503 });
  }
}

// Notificar a los clientes abiertos que hay una actualización disponible
async function notifyClientsOfUpdate() {
  const clientsList = await self.clients.matchAll({ type: 'window' });
  clientsList.forEach(client => client.postMessage({ type: 'UPDATE_AVAILABLE' }));
}

// ── handleSharePost: procesar el archivo compartido ───────────────────
//    FC5e envía un archivo .dnd5e (XML por dentro) como multipart/form-data.
//    No validamos el MIME type — lo aceptamos todo y dejamos que el parser
//    del index.html decida si es un XML de personaje válido.
async function handleSharePost(request) {
  let text = null;
  try {
    const formData = await request.formData();

    // El campo se llama "character" según manifest.json params.files[0].name
    const file = formData.get('character');

    if (file) {
      text = typeof file === 'string' ? file : await file.text();

      // Guardar el texto en caché para que processSharedFile() lo lea
      // tras la navegación/recarga que el Share Target siempre dispara.
      const shareCache = await caches.open(SHARE_CACHE);
      await shareCache.put('pending', new Response(text, {
        headers: { 'Content-Type': 'text/plain; charset=utf-8' }
      }));

      // Respaldo: si ya hay una ventana de la app abierta, avisarle de
      // inmediato por postMessage. La navegación que dispara el Share
      // Target API destruye ese contexto de todas formas, así que esto
      // es solo un best-effort — la fuente de verdad sigue siendo la
      // caché que processSharedFile() lee tras la recarga.
      const clientsList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      clientsList.forEach(client => {
        client.postMessage({ type: 'SHARED_FILE', payload: text });
      });
    }
  } catch (err) {
    // Si algo falla, redirigir igual — la app mostrará su pantalla de carga
    // y el usuario puede cargar el archivo manualmente
  }

  // 303 para convertir el POST en GET y evitar reenvíos al recargar
  return Response.redirect('/combat_tracker/?from-share', 303);
}
