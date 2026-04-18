// ============================================================
//  gt-utils.js  —  Pure utilities, geometry, modals, PWA
//  No application logic here — only generic helpers that
//  every other module can safely depend on.
// ============================================================
'use strict';

// ── ID & date helpers ────────────────────────────────────────
function uid() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

function todayStr() { return new Date().toISOString().slice(0, 10); }

function addDays(d, n) {
    const dt = new Date(d);
    dt.setDate(dt.getDate() + n);
    return dt.toISOString().slice(0, 10);
}

function daysBetween(a, b) { return Math.max(0, Math.round((new Date(b) - new Date(a)) / 86400000)); }

function daysSince(d) { return daysBetween(d, todayStr()); }

function fmtDate(s) { const [y, m, d] = s.split('-'); return `${d}/${m}/${y}`; }

function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

// ── Geometry ─────────────────────────────────────────────────
// Handles both Polygon and MultiPolygon (turf.intersect can return
// MultiPolygon when a farm boundary clips a grid cell into disconnected
// pieces — summing all sub-polygons prevents valid camps being filtered out).
function calcAreaHa(geometry) {
    if (!geometry) return 0;
    if (geometry.type === 'MultiPolygon') {
        return geometry.coordinates.reduce(
            (sum, ring) => sum + calcAreaHa({ type: 'Polygon', coordinates: ring }), 0
        );
    }
    if (geometry.type !== 'Polygon') return 0;
    const coords = geometry.coordinates[0],
        R = 6371000;
    let area = 0;
    for (let i = 0; i < coords.length - 1; i++) {
        const [lng1, lat1] = coords[i], [lng2, lat2] = coords[i + 1];
        const x1 = lng1 * Math.PI / 180 * R * Math.cos(lat1 * Math.PI / 180),
            y1 = lat1 * Math.PI / 180 * R;
        const x2 = lng2 * Math.PI / 180 * R * Math.cos(lat2 * Math.PI / 180),
            y2 = lat2 * Math.PI / 180 * R;
        area += x1 * y2 - x2 * y1;
    }
    return Math.abs(area / 2) / 10000;
}

// ── File download helper ─────────────────────────────────────
function download(filename, content, type) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([content], { type }));
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
}

// ── Status bar ───────────────────────────────────────────────
function setStatus(msg) {
    const el = document.getElementById('statusMsg');
    if (el) el.textContent = msg;
}

// ── Modal helpers ─────────────────────────────────────────────
// Simple show/hide wrappers used throughout the app.
function openModal(id) { document.getElementById(id).style.display = 'flex'; }

function closeModal(id) { document.getElementById(id).style.display = 'none'; }

// Close any modal by clicking its backdrop, with special cleanup for
// the draw and auto-split modals (those need their state reset too).
document.querySelectorAll('.overlay').forEach(el => {
    el.addEventListener('click', e => {
        if (e.target !== el) return;
        el.style.display = 'none';
        if (el.id === 'modalName') cancelDraw();
        if (el.id === 'modalAutoSplit') asDestroyMap();
    });
});

// Escape key closes everything.
document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    document.querySelectorAll('.overlay').forEach(el => el.style.display = 'none');
    if (typeof currentTool !== 'undefined' && currentTool === 'draw') cancelDraw();
    if (typeof asDestroyMap !== 'undefined') asDestroyMap();
});

// ── PWA install ──────────────────────────────────────────────
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
}
let deferredInstall = null;
window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    deferredInstall = e;
    const b = document.getElementById('installBanner');
    if (b) b.classList.add('show');
});

function installApp() {
    if (!deferredInstall) return;
    deferredInstall.prompt();
    deferredInstall.userChoice.then(() => {
        deferredInstall = null;
        const b = document.getElementById('installBanner');
        if (b) b.classList.remove('show');
    });
}