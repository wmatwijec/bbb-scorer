// sw.js — FINAL BULLETPROOF VERSION (November 21, 2025)
const CACHE_NAME = 'bbb-golf-20251121-v4-STOPSPINNER';

const FILES_TO_CACHE = [
  '/',                          // root
  '/bbb-scorer/',               // GitHub Pages sometimes needs the subfolder
  '/bbb-scorer/index.html',
  '/bbb-scorer/app-v23.js',     // ← YOUR CURRENT JS FILE
  '/bbb-scorer/manifest.json',
  //'/bbb-scorer/icon.png',
  '/bbb-scorer/sw.js'           // cache itself so updates work smoothly
];

// INSTALL — cache everything fresh
self.addEventListener('install', (e) => {
  console.log('SW: Installing', CACHE_NAME);
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(FILES_TO_CACHE);
    }).then(() => self.skipWaiting())
  );
});

// ACTIVATE — delete ALL old caches instantly
self.addEventListener('activate', (e) => {
  console.log('SW: Activating', CACHE_NAME);
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            console.log('SW: Deleting old cache', key);
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// FETCH — always try network first, fall back to cache, update cache in background
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;  // ignore POSTs etc.

  e.respondWith(
    fetch(e.request)
      .then((response) => {
        // If network works, update the cache with the fresh file
        if (response && response.status === 200) {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(e.request, responseClone);
          });
        }
        return response;
      })
      .catch(() => {
        // Offline → serve from cache
        return caches.match(e.request);
      })
  );
});