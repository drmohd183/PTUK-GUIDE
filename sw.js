/* يعمل التطبيق بدون إنترنت: ملفات التطبيق من الذاكرة، والبيانات من الشبكة أولاً ثم من آخر نسخة محفوظة. */
const CACHE = "guide-v4";
const SHELL = ["./", "index.html", "style.css", "app.js", "manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png",
  "vendor/leaflet/leaflet.js", "vendor/leaflet/leaflet.css", "vendor/fonts/fonts.css"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== "GET") return;
  if (/tile\.openstreetmap\.org$|basemaps\.cartocdn\.com$|arcgisonline\.com$/.test(url.hostname)) return;  // صور الخريطة: من الإنترنت فقط
  const own = url.origin === location.origin;
  // ملفات التطبيق والبيانات: من الشبكة أولاً (حتى يصل كل تحديث)، وعند انقطاع الإنترنت من الذاكرة
  if (own && !(url.pathname.includes("/photos/") || url.pathname.includes("/vendor/"))) {
    e.respondWith(fetch(req).then(r => {
      if (r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      return r;
    }).catch(() => caches.match(req, { ignoreSearch: true }).then(r => r || caches.match("index.html"))));
    return;
  }
  // الصور والخطوط ومكتبة الخريطة: من الذاكرة أولاً
  e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(r => {
    if (r.ok || r.type === "opaque") { const copy = r.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
    return r;
  })));
});
