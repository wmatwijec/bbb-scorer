// sw.js — FINAL OPTIMIZED (Dec 2025)
const CACHE_NAME = 'bbb-golf-20251203-v1';
const STATIC_FILES = [
  '/',
  '/bbb-scorer/',
  '/bbb-scorer/index.html',
  '/bbb-scorer/manifest.json',
  '/bbb-scorer/sw.js'
];

// Only cache these exact URLs
const STATIC_URLS = STATIC_FILES.map(f => new URL(f, self.location).href);

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
  const isStatic = STATIC_URLS.some(s => url.startsWith(s));

  if (!isStatic) {
    // Let API calls go straight to network (no caching)
    return;
  }

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