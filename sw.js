const CACHE = 'bug-reporter-v4';
const ASSETS = [
  './index.html',
  './css/app.css',
  './js/config.js',
  './js/auth.js',
  './js/drive.js',
  './js/sheets.js',
  './js/capture.js',
  './js/speech.js',
  './js/app.js',
  './icon.svg',
  './manifest.json'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  const url = e.request.url;
  // Never cache Google API calls
  if (url.includes('googleapis.com') || url.includes('accounts.google.com')) return;
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});
