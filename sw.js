// GrazingTrack Service Worker v4
const CACHE_APP = 'gt-app-v4';
const CACHE_TILES = 'gt-tiles-v1';

const APP_SHELL = [
    '/',
    '/index.html',
    '/style.css',
    '/manifest.json',
    '/gt-utils.js',
    '/gt-data.js',
    '/gt-map.js',
    '/gt-split.js',
    '/gt-events.js',
    '/gt-dashboard.js',
    '/gt-offline.js',
    '/setup.js',
    'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
    'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
    'https://unpkg.com/leaflet-draw@1.0.4/dist/leaflet.draw.css',
    'https://unpkg.com/leaflet-draw@1.0.4/dist/leaflet.draw.js',
    'https://unpkg.com/@turf/turf@6/turf.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js'
];

self.addEventListener('install', e => {
    e.waitUntil(caches.open(CACHE_APP).then(cache => cache.addAll(APP_SHELL)));
    self.skipWaiting();
});

self.addEventListener('activate', e => {
    e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE_APP && k !== CACHE_TILES).map(k => caches.delete(k)))));
    self.clients.claim();
});

self.addEventListener('fetch', e => {
    const url = e.request.url;

    if (url.includes('tile.openstreetmap.org')) {
        e.respondWith(caches.open(CACHE_TILES).then(async cache => {
            const cached = await cache.match(e.request);
            if (cached) return cached;
            try {
                const resp = await fetch(e.request);
                if (resp.ok) cache.put(e.request, resp.clone());
                return resp;
            } catch {
                return new Response(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='), { status: 200, headers: { 'Content-Type': 'image/png' } });
            }
        }));
        return;
    }

    if (url.includes('arcgisonline.com') || url.includes('arcgis.com')) {
        e.respondWith(caches.open(CACHE_TILES).then(async cache => {
            const cached = await cache.match(e.request);
            if (cached) return cached;
            try {
                const resp = await fetch(e.request);
                if (resp.ok) cache.put(e.request, resp.clone());
                return resp;
            } catch { return cached || new Response('', { status: 503 }); }
        }));
        return;
    }

    if (url.includes('open-meteo.com')) {
        e.respondWith(fetch(e.request).catch(() => new Response('{}', { status: 503, headers: { 'Content-Type': 'application/json' } })));
        return;
    }

    e.respondWith(caches.match(e.request).then(cached => cached || fetch(e.request).catch(() => caches.match('/index.html'))));
});