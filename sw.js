// GrazingTrack Service Worker v3
// Caches app shell for offline use + map tiles as you browse

const CACHE_APP = 'gt-app-v3';
const CACHE_TILES = 'gt-tiles-v1';

const APP_SHELL = [
    '/',
    '/index.html',
    '/style.css',
    '/app.js',
    '/manifest.json',
    'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
    'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
    'https://unpkg.com/leaflet-draw@1.0.4/dist/leaflet.draw.css',
    'https://unpkg.com/leaflet-draw@1.0.4/dist/leaflet.draw.js',
    'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js'
];

// Install — cache app shell
self.addEventListener('install', e => {
    e.waitUntil(
        caches.open(CACHE_APP).then(cache => cache.addAll(APP_SHELL))
    );
    self.skipWaiting();
});

// Activate — clean old caches
self.addEventListener('activate', e => {
    e.waitUntil(
        caches.keys().then(keys =>
            Promise.all(keys
                .filter(k => k !== CACHE_APP && k !== CACHE_TILES)
                .map(k => caches.delete(k))
            )
        )
    );
    self.clients.claim();
});

// Fetch strategy:
// - Map tiles: cache as you go (so areas you've visited work offline)
// - App shell: cache first
// - API calls (Open-Meteo): network first, fail silently offline
self.addEventListener('fetch', e => {
    const url = e.request.url;

    // Map tiles — cache as you browse
    if (url.includes('tile.openstreetmap.org') ||
        url.includes('arcgisonline.com') ||
        url.includes('arcgis.com/ArcGIS')) {
        e.respondWith(
            caches.open(CACHE_TILES).then(cache =>
                cache.match(e.request).then(cached => {
                    if (cached) return cached;
                    return fetch(e.request).then(response => {
                        if (response.ok) cache.put(e.request, response.clone());
                        return response;
                    }).catch(() => cached || new Response('', { status: 503 }));
                })
            )
        );
        return;
    }

    // Weather API — network only, skip cache
    if (url.includes('open-meteo.com')) {
        e.respondWith(fetch(e.request).catch(() => new Response('{}', { status: 503 })));
        return;
    }

    // App shell — cache first, fallback to network
    e.respondWith(
        caches.match(e.request).then(cached =>
            cached || fetch(e.request).catch(() => caches.match('/index.html'))
        )
    );
});