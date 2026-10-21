// KIBY service worker — bikin web bisa diinstal (PWA) & shell tetap bisa
// dibuka saat koneksi putus. Data API SELALU dari jaringan (tidak di-cache)
// supaya angka keuangan tidak basi.
const CACHE = "kiby-shell-v1";
const SHELL = [
  "/",
  "/index.html",
  "/styles.css",
  "/app.js",
  "/logo.png",
  "/sapaan.mp3",
  "/icon-192.png",
  "/icon-512.png",
  "/manifest.webmanifest",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  // API & foto dokumen: selalu jaringan, jangan pernah sajikan dari cache.
  if (url.pathname.startsWith("/api/")) return;
  // Aset lain: network-first (selalu segar saat online), cache jadi cadangan offline.
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});
