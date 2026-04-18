// ============================================================
//  gt-utils.js  —  Pure utilities, geometry, modals, PWA
//  Single source of truth for all helper functions.
// ============================================================
'use strict';

// ── ID & date helpers ────────────────────────────────────────
function uid() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return Date.now().toString(36) + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
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

function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : ''; }

// ── Geometry (handles Polygon and MultiPolygon) ───────────────
function calcAreaHa(geometry) {
    if (!geometry) return 0;
    if (geometry.type === 'MultiPolygon') {
        return geometry.coordinates.reduce(
            (sum, ring) => sum + calcAreaHa({ type: 'Polygon', coordinates: ring }), 0
        );
    }
    if (geometry.type !== 'Polygon') return 0;
    const coords = geometry.coordinates[0];
    const R = 6371000;
    let area = 0;
    for (let i = 0; i < coords.length - 1; i++) {
        const [lng1, lat1] = coords[i];
        const [lng2, lat2] = coords[i + 1];
        const x1 = lng1 * Math.PI / 180 * R * Math.cos(lat1 * Math.PI / 180);
        const y1 = lat1 * Math.PI / 180 * R;
        const x2 = lng2 * Math.PI / 180 * R * Math.cos(lat2 * Math.PI / 180);
        const y2 = lat2 * Math.PI / 180 * R;
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
    console.log('[Status]', msg);
}

// ── Toast notification ───────────────────────────────────────
function showToast(msg, duration = 3000) {
    const toast = document.createElement('div');
    toast.className = 'gt-toast';
    toast.textContent = msg;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), duration);
}

// ── Modal helpers ────────────────────────────────────────────
function openModal(id) {
    const el = document.getElementById(id);
    if (el) el.style.display = 'flex';
}

function closeModal(id) {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
}

// Close modals on backdrop click
document.addEventListener('click', e => {
    if (e.target.classList && e.target.classList.contains('overlay')) {
        e.target.style.display = 'none';
        if (e.target.id === 'modalName' && typeof cancelDraw === 'function') cancelDraw();
        if (e.target.id === 'modalAutoSplit' && typeof asDestroyMap === 'function') asDestroyMap();
    }
});

// Escape key closes modals
document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
        document.querySelectorAll('.overlay').forEach(el => el.style.display = 'none');
        if (typeof currentTool !== 'undefined' && currentTool === 'draw' && typeof cancelDraw === 'function') cancelDraw();
        if (typeof asDestroyMap === 'function') asDestroyMap();
    }
});

// ── PWA install ──────────────────────────────────────────────
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(err => console.log('SW error:', err));
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

// ── Farm centre (for weather) ────────────────────────────────
function getFarmCenter() {
    if (typeof loadFields === 'undefined') return null;
    const fields = loadFields();
    if (!fields.length) return null;
    const lats = [], lngs = [];
    fields.forEach(f => {
        if (f.geometry && f.geometry.coordinates) {
            f.geometry.coordinates[0].forEach(([lng, lat]) => {
                lats.push(lat);
                lngs.push(lng);
            });
        }
    });
    if (!lats.length) return null;
    return {
        lat: (Math.min(...lats) + Math.max(...lats)) / 2,
        lng: (Math.min(...lngs) + Math.max(...lngs)) / 2
    };
}