// ============================================================
//  gt-data.js  —  Storage, constants, colour palette
//  Everything that touches localStorage lives here.
// ============================================================
'use strict';

const DB_VERSION = 4;

// ── Raw key/value helpers ────────────────────────────────────
function load(k) {
    try {
        const r = localStorage.getItem(k);
        return r ? JSON.parse(r) : [];
    } catch (e) {
        localStorage.removeItem(k);
        return [];
    }
}

function save(k, v) {
    try {
        localStorage.setItem(k, JSON.stringify(v));
        if (typeof updateStorageBar === 'function') updateStorageBar();
        if (typeof checkStorageWarn === 'function') checkStorageWarn();
    } catch (e) {
        if (e.name === 'QuotaExceededError') alert('Storage full! Export a backup first.');
    }
}

// ── Typed loaders / savers ───────────────────────────────────
const loadFields = () => load('gt_fields');
const loadEvents = () => load('gt_events');
const saveFields = f => save('gt_fields', f);
const saveEvents = e => save('gt_events', e);

// Soil moisture
const loadMoisture = () => load('gt_moisture');
const saveMoisture = m => save('gt_moisture', m);

// Animal groups
function loadGroups() {
    const direct = load('gt_groups');
    if (direct.length) return direct;
    try {
        const cfg = JSON.parse(localStorage.getItem('gt_config') || '{}');
        const legacy = cfg.animalGroups || cfg.groups || [];
        if (legacy.length) {
            const migrated = legacy.map((g, i) => ({
                id: g.id || ('grp-' + Date.now().toString(36) + '-' + i),
                name: g.name || `Group ${i + 1}`,
                type: g.type || 'cattle',
                count: Number(g.count) || 0,
                herd: g.herd || ''
            }));
            localStorage.setItem('gt_groups', JSON.stringify(migrated));
            return migrated;
        }
    } catch (e) {}
    return [];
}

function saveGroups(groups) {
    try {
        localStorage.setItem('gt_groups', JSON.stringify(groups));
        const cfg = JSON.parse(localStorage.getItem('gt_config') || '{}');
        cfg.animalGroups = groups;
        localStorage.setItem('gt_config', JSON.stringify(cfg));
        if (typeof updateStorageBar === 'function') updateStorageBar();
    } catch (e) {}
    window._animalGroups = groups;
    if (typeof renderAnimalGroupsCard === 'function') renderAnimalGroupsCard();
}

// ── Storage usage meter ──────────────────────────────────────
function getStorageUsage() {
    let t = 0;
    ['gt_fields', 'gt_events', 'gt_groups', 'gt_moisture'].forEach(k => {
        const v = localStorage.getItem(k);
        if (v) t += v.length * 2;
    });
    return { used: t, max: 5 * 1024 * 1024, pct: Math.min(100, t / (5 * 1024 * 1024) * 100) };
}

function updateStorageBar() {
    const { used, max, pct } = getStorageUsage();
    const b = document.getElementById('storageBar');
    const l = document.getElementById('storageLabel');
    if (!b) return;
    b.style.width = pct.toFixed(1) + '%';
    b.style.background = pct > 80 ? '#f87171' : pct > 50 ? '#facc15' : '#4ade80';
    l.textContent = `Storage: ${(used / 1024).toFixed(1)} KB / ${(max / 1024).toFixed(0)} KB`;
}

function checkStorageWarn() {
    const { pct } = getStorageUsage();
    if (pct > 80 && !sessionStorage.getItem('gt_sw')) {
        sessionStorage.setItem('gt_sw', '1');
        alert(`Storage is ${pct.toFixed(0)}% full. Export a backup.`);
    }
}

// ── Sensor JSON import ───────────────────────────────────────
function importSensorJSON(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = e => {
        try {
            const data = JSON.parse(e.target.result);
            const readings = data.readings || (Array.isArray(data) ? data : []);
            if (!readings.length) { alert('No readings found in file.'); return; }
            const existing = loadMoisture();
            const ids = new Set(existing.map(r => r.id));
            const added = readings.filter(r => !ids.has(r.id)).map(r => ({ ...r, id: r.id || uid() }));
            saveMoisture([...existing, ...added]);
            alert(`Imported ${added.length} new sensor reading(s).`);
            if (typeof setStatus === 'function') setStatus(`Imported ${added.length} moisture readings.`);
        } catch (err) {
            alert('Invalid sensor JSON file. Expected { readings: [...] }');
        }
    };
    reader.readAsText(file);
    event.target.value = '';
}

// ── Field colour palette ─────────────────────────────────────
const COLORS = [
    '#2d6a4f', '#52b788', '#40916c', '#74c69d', '#1b4332',
    '#34a0a4', '#0077b6', '#7b2d8b', '#d97706', '#dc2626',
    '#0891b2', '#059669', '#7c3aed', '#db2777', '#b45309'
];
let colorIdx = 0;

function nextColor() { return COLORS[colorIdx++ % COLORS.length]; }