// Offline-Betrieb (Wunsch Mathias 26.11.: «App offline fähig»): Seiten, Bibliotheken und Daten-Dateien der 3D-Werkstatt im Gerät zwischenspeichern.
// Gleiche Herkunft: zuerst Netz (max. 4 s), Kopie in den Zwischenspeicher; ohne Netz die gespeicherte Kopie (Schlüssel ohne ?…, damit ?nr= und ?t= passen).
// Schriften/three.js von CDNs: gespeicherte Kopie sofort, im Hintergrund auffrischen. api.github.com wird nie angefasst (Speichern/Upload läuft wie bisher).
const CACHE = 'werkstatt-v4';
const KERN = ['./', 'index.html', 'planaufmass.html', 'tueren.html', 'glm.js', 'scanner.js', 'kontrolle.js', 'ar.js', 'manifest.webmanifest',
  'icon-180.png', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'lib/pdf.min.js', 'lib/pdf.worker.min.js', 'lib/pdf-lib.min.js',
  'lib/zxing-reader.js', 'lib/zxing_reader.wasm'];
const FREMD = ['fonts.googleapis.com', 'fonts.gstatic.com', 'cdn.jsdelivr.net', 'cdnjs.cloudflare.com', 'unpkg.com'];
self.addEventListener('install', ev => {
  ev.waitUntil(caches.open(CACHE).then(c => Promise.all(KERN.map(u => fetch(u, {cache: 'no-cache'}).then(r => r.ok && c.put(schluessel(new URL(u, self.registration.scope)), r)).catch(() => {}))))
    .then(() => self.skipWaiting()));
});
self.addEventListener('activate', ev => {
  ev.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
function schluessel(url){ const u = new URL(url); u.search = ''; u.hash = ''; return u.href; }
function mitZeitlimit(p, ms){ return new Promise((ok, nein) => { const t = setTimeout(() => nein(new Error('Zeitlimit')), ms); p.then(r => { clearTimeout(t); ok(r); }, e => { clearTimeout(t); nein(e); }); }); }
self.addEventListener('fetch', ev => {
  const req = ev.request; if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) {
    const k = schluessel(req.url);
    ev.respondWith((async () => {
      const c = await caches.open(CACHE);
      try {
        const netz = fetch(req);
        const r = await mitZeitlimit(netz, 4000);
        if (r && r.ok) c.put(k, r.clone()).catch(() => {});
        else netz.catch(() => {});
        return r;
      } catch(e) {
        const alt = await c.match(k) || (req.mode === 'navigate' ? await c.match(schluessel(new URL('./', self.registration.scope))) : null);
        if (alt) return alt;
        throw e;
      }
    })());
    return;
  }
  if (FREMD.includes(url.hostname)) {
    ev.respondWith((async () => {
      const c = await caches.open(CACHE), alt = await c.match(req);
      const netz = fetch(req).then(r => { if (r && (r.ok || r.type === 'opaque')) c.put(req, r.clone()).catch(() => {}); return r; });
      if (alt) { netz.catch(() => {}); return alt; }
      return netz;
    })());
  }
});
