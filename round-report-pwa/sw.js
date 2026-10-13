// BBB Round Report PWA service worker
const CACHE_NAME = 'bbb-round-report-v1';
const STATIC_FILES = [
  '/bbb-scorer/round-report-pwa/',
  '/bbb-scorer/round-report-pwa/index.html',
  '/bbb-scorer/round-report-pwa/manifest.json',
  '/bbb-scorer/round-report-pwa/sw.js'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(STATIC_FILES))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.map(key => key !== CACHE_NAME && caches.delete(key)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = e.request.url;
  const isStatic = STATIC_FILES.some(s => url.startsWith(s));
  if (!isStatic) return; // API calls go straight to network
  e.respondWith(
    fetch(e.request)
      .then(response => {
        if (response?.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(e.request))
  );
});