// Offline: keeps a copy of the app itself so it opens with no signal (Data Entry on the course).
// The page and the app's files: fresh when online, the saved copy when not. The Firebase libraries
// (versioned, never change): the saved copy first. Data goes through Firebase, not here.
const CACHE = "tour-analytics-v126";
self.addEventListener("install", (e) => { self.skipWaiting(); e.waitUntil(caches.open(CACHE).then((c) => c.addAll(["./", "./index.html", "./css/style.css", "./config.js"]).catch(() => {}))); });
self.addEventListener("activate", (e) => e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener("fetch", (e) => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== "GET") return;
  const sameOrigin = url.origin === self.location.origin;
  const sdk = url.hostname === "www.gstatic.com" && url.pathname.includes("/firebasejs/");
  if (!sameOrigin && !sdk) return; // Firestore, sign-in and other services: leave alone
  if (req.mode === "navigate") { // the page: fresh when online, the saved copy when not
    e.respondWith(fetch(req, { cache: "no-cache" }).then((r) => { caches.open(CACHE).then((c) => c.put("./index.html", r.clone())); return r; }).catch(() => caches.match("./index.html")));
    return;
  }
  if (sdk) { // versioned library files never change: the saved copy first
    e.respondWith(caches.open(CACHE).then(async (c) => (await c.match(req)) || fetch(req).then((r) => { c.put(req, r.clone()); return r; })));
    return;
  }
  // the app's own files: always fresh when online (so an update never mixes old and new files); saved copy offline
  // ("no-cache": always check with the server, so an update never pairs new files with old ones)
  e.respondWith(fetch(req, { cache: "no-cache" }).then((r) => { if (r && r.ok) caches.open(CACHE).then((c) => c.put(req, r.clone())); return r; })
    .catch(() => caches.match(req, { ignoreSearch: true })));
});
