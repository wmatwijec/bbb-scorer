// sw.js — FORCE FRESH PWA LOAD
const CACHE_NAME = 'bbb-golf-v21.1-clean';

self.addEventListener('install', (e) => {
  console.log('SW: Installing new version');
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  console.log('SW: Activating new version');
  e.waitUntil(
    caches.keys().then((names) => {
      return Promise.all(
        names.map((name) => {
          if (name !== CACHE_NAME) {
            console.log('SW: Deleting old cache', name);
            return caches.delete(name);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request))
  );
});