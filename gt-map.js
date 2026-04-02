// ============================================================
//  gt-map.js  —  Map, field management, tools, tabs, boot
//  Owns the main Leaflet map and everything related to fields:
//  drawing, editing, selecting, deleting, styling, listing.
//  Also owns tab switching and the app boot sequence.
// ============================================================
'use strict';

// ── Map state ─────────────────────────────────────────────────
let map, drawnItems, drawControl;
let pendingLayer = null;
let selectedFieldId = null;
let currentTool = 'select';
let vertexCount = 0;

// ── Map initialisation ───────────────────────────────────────
function initMap() {
    map = L.map('map', { zoomControl: false }).setView([-29, 25], 6);

    const sat = L.tileLayer(
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { attribution: 'Tiles © Esri', maxZoom: 19 }
    );
    const osm = L.tileLayer(
        'https://tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap', maxZoom: 19 }
    );
    const hyb = L.layerGroup([
        sat,
        L.tileLayer(
            'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, opacity: 0.8 }
        )
    ]);
    sat.addTo(map);
    L.control.layers({ 'Satellite': sat, 'Satellite + Labels': hyb, 'Street map': osm }, {}, { position: 'topright' }).addTo(map);
    L.control.zoom({ position: 'topright' }).addTo(map);

    drawnItems = new L.FeatureGroup().addTo(map);
    drawControl = new L.Control.Draw({
        position: 'topright',
        draw: {
            polygon: { allowIntersection: false, showArea: true, shapeOptions: { color: '#52b788', fillColor: '#52b788', fillOpacity: 0.25, weight: 2.5, dashArray: '6 4' } },
            rectangle: false,
            circle: false,
            circlemarker: false,
            marker: false,
            polyline: false
        },
        edit: { featureGroup: drawnItems, remove: false }
    });

    // A new polygon was drawn — ask for its name before saving.
    map.on(L.Draw.Event.CREATED, e => {
        pendingLayer = e.layer;
        drawnItems.addLayer(pendingLayer);
        vertexCount = 0;
        updateUndoBtn();
        openModal('modalName');
        setTimeout(() => document.getElementById('inName').focus(), 80);
    });

    // Live area feedback while drawing.
    map.on('draw:drawvertex', e => {
        const pts = [];
        e.layers.eachLayer(l => pts.push(l.getLatLng()));
        vertexCount = pts.length;
        updateUndoBtn();
        if (pts.length >= 3) {
            const geo = {
                type: 'Polygon',
                coordinates: [
                    [...pts, pts[0]].map(p => [p.lng, p.lat])
                ]
            };
            setStatus(`Drawing — ${pts.length} points · ~${calcAreaHa(geo).toFixed(1)} ha · double-click to finish`);
        } else {
            setStatus(`Drawing — ${pts.length} point${pts.length !== 1 ? 's' : ''} placed · need at least 3`);
        }
    });

    // Vertex reshape finished — save the updated geometries.
    map.on(L.Draw.Event.EDITED, e => {
        e.layers.eachLayer(layer => {
            const fields = loadFields();
            const field = fields.find(f => f.id === layer.options.fieldId);
            if (!field) return;
            field.geometry = layer.toGeoJSON().geometry;
            field.areaHa = calcAreaHa(field.geometry);
            saveFields(fields);
            layer.setTooltipContent(`<strong>${field.name}</strong><br>${field.areaHa.toFixed(1)} ha`);
        });
        renderFieldList();
        updateStats();
        if (selectedFieldId) selectField(selectedFieldId);
        setStatus('Field shapes updated.');
        setTool('select');
    });

    map.on(L.Draw.Event.EDITSTOP, () => setTool('select'));
    // Clicking the empty map deselects any selected field.
    map.on('click', () => { if (currentTool === 'select') deselectField(); });

    restoreFieldsOnMap();
    renderFieldList();
    updateStats();
    updateStorageBar();
}

// ── Drawing tools ─────────────────────────────────────────────
function setTool(tool) {
    currentTool = tool;
    document.querySelectorAll('.tcrd').forEach(b => b.classList.remove('active'));
    const ub = document.getElementById('btnUndo');
    const eb = document.getElementById('btnEdit');
    const db = document.getElementById('btnDelete');

    if (tool === 'draw') {
        document.getElementById('btnDraw').classList.add('active');
        vertexCount = 0;
        map.addControl(drawControl);
        setTimeout(() => { const b = document.querySelector('.leaflet-draw-draw-polygon'); if (b) b.click(); }, 60);
        setStatus('Click to place corners · double-click (or first point) to close · Esc to cancel');
        document.getElementById('toolHint').textContent = 'Each click adds a corner. ↩ Undo removes the last point. Double-click to finish.';
        if (eb) eb.style.display = 'none';

    } else if (tool === 'edit') {
        document.getElementById('btnEdit').classList.add('active');
        try { map.addControl(drawControl); } catch (e) {}
        setTimeout(() => { const b = document.querySelector('.leaflet-draw-edit-edit'); if (b) b.click(); }, 60);
        setStatus('Drag handles to reshape · click Save in the map toolbar when done');
        if (ub) ub.style.display = 'none';

    } else {
        // select mode (default)
        document.getElementById('btnSelect').classList.add('active');
        vertexCount = 0;
        try { map.removeControl(drawControl); } catch (e) {}
        setStatus('Ready — select a field or use the drawing tools');
        document.getElementById('toolHint').textContent = 'Click a field on the map or in the list to select it.';
        if (ub) ub.style.display = 'none';
        if (eb) eb.style.display = selectedFieldId ? 'flex' : 'none';
        if (db) db.style.display = selectedFieldId ? 'flex' : 'none';
    }
}

function updateUndoBtn() {
    const b = document.getElementById('btnUndo');
    if (b) b.style.display = (currentTool === 'draw' && vertexCount > 0) ? 'flex' : 'none';
}

// Modern browsers make keyCode read-only on synthetic events — override with
// Object.defineProperty so Leaflet Draw's _onKeyDown sees keyCode 90.
function undoLastVertex() {
    const evt = new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', ctrlKey: true, bubbles: true, cancelable: true });
    Object.defineProperty(evt, 'keyCode', { get: () => 90 });
    document.dispatchEvent(evt);
    if (vertexCount > 0) vertexCount--;
    updateUndoBtn();
}

// ── Field creation ────────────────────────────────────────────
function cancelDraw() {
    if (pendingLayer) {
        drawnItems.removeLayer(pendingLayer);
        pendingLayer = null;
    }
    vertexCount = 0;
    updateUndoBtn();
    closeModal('modalName');
    setTool('select');
}

function saveNewField() {
    const name = document.getElementById('inName').value.trim();
    if (!name) { alert('Please enter a field name.'); return; }
    if (!pendingLayer) return;
    const geo = pendingLayer.toGeoJSON().geometry;
    const area = calcAreaHa(geo);
    const color = nextColor();
    const maxAU = parseFloat(document.getElementById('inMaxAU').value) || null;
    const field = {
        id: uid(),
        name,
        type: document.getElementById('inType').value,
        restTarget: parseInt(document.getElementById('inRest').value) || 42,
        maxAUperHa: maxAU,
        geometry: geo,
        areaHa: area,
        color,
        createdAt: new Date().toISOString(),
        version: DB_VERSION
    };
    styleLayer(pendingLayer, field);
    pendingLayer.options.fieldId = field.id;
    bindFieldLayer(pendingLayer, field);
    const fields = loadFields();
    fields.push(field);
    saveFields(fields);
    pendingLayer = null;
    vertexCount = 0;
    updateUndoBtn();
    closeModal('modalName');
    setTool('select');
    renderFieldList();
    updateStats();
    selectField(field.id);
    setStatus(`"${name}" saved — ${area.toFixed(1)} ha`);
}

// ── Field edit modal ──────────────────────────────────────────
function openEditFieldModal(fieldId) {
    const field = loadFields().find(f => f.id === fieldId);
    if (!field) return;
    document.getElementById('editFieldId').value = field.id;
    document.getElementById('editName').value = field.name;
    document.getElementById('editType').value = field.type;
    document.getElementById('editRest').value = field.restTarget;
    document.getElementById('editMaxAU').value = field.maxAUperHa || '';
    // Build colour swatches
    const picker = document.getElementById('editColorPicker');
    picker.innerHTML = COLORS.map(c => `
        <div class="color-swatch${c === field.color ? ' chosen' : ''}"
             style="background:${c}"
             onclick="document.querySelectorAll('.color-swatch').forEach(s=>s.classList.remove('chosen'));this.classList.add('chosen')"
             title="${c}"></div>
    `).join('');
    openModal('modalEditField');
    setTimeout(() => document.getElementById('editName').focus(), 80);
}

function saveFieldEdit() {
    const id = document.getElementById('editFieldId').value;
    const name = document.getElementById('editName').value.trim();
    if (!name) { alert('Please enter a field name.'); return; }
    const fields = loadFields();
    const idx = fields.findIndex(f => f.id === id);
    if (idx === -1) return;
    const chosenSwatch = document.querySelector('.color-swatch.chosen');
    const color = chosenSwatch ? chosenSwatch.title : fields[idx].color;
    fields[idx] = {
        ...fields[idx],
        name,
        type: document.getElementById('editType').value,
        restTarget: parseInt(document.getElementById('editRest').value) || 42,
        maxAUperHa: parseFloat(document.getElementById('editMaxAU').value) || null,
        color
    };
    saveFields(fields);
    drawnItems.eachLayer(layer => {
        if (layer.options.fieldId === id) {
            styleLayer(layer, fields[idx]);
            bindFieldLayer(layer, fields[idx]);
        }
    });
    closeModal('modalEditField');
    renderFieldList();
    if (selectedFieldId === id) selectField(id);
    setStatus(`"${name}" updated.`);
}

// ── Field styling ─────────────────────────────────────────────
function styleLayer(layer, field) {
    const c = statusFillColor(field);
    layer.setStyle({ color: c, fillColor: c, fillOpacity: 0.38, weight: 2.5 });
}

function bindFieldLayer(layer, field) {
    layer.options.fieldId = field.id;
    layer.off('click');
    layer.on('click', e => {
        L.DomEvent.stopPropagation(e);
        selectField(field.id);
    });
    layer.unbindTooltip();
    layer.bindTooltip(
        `<strong>${field.name}</strong><br>${field.areaHa.toFixed(1)} ha`, { permanent: true, direction: 'center', className: 'field-label' }
    );
}

// ── Field deletion ────────────────────────────────────────────
function deleteSelected() {
    if (!selectedFieldId) return;
    const field = loadFields().find(f => f.id === selectedFieldId);
    if (!field || !confirm(`Delete "${field.name}"?\nAll grazing events will also be deleted.`)) return;
    drawnItems.eachLayer(l => { if (l.options.fieldId === selectedFieldId) drawnItems.removeLayer(l); });
    saveFields(loadFields().filter(f => f.id !== selectedFieldId));
    saveEvents(loadEvents().filter(e => e.fieldId !== selectedFieldId));
    deselectField();
    renderFieldList();
    updateStats();
    setStatus('Field deleted.');
}

// ── Field selection ───────────────────────────────────────────
function selectField(fieldId) {
    selectedFieldId = fieldId;
    const field = loadFields().find(f => f.id === fieldId);
    if (!field) return;
    document.querySelectorAll('.field-item').forEach(el =>
        el.classList.toggle('selected', el.dataset.id === fieldId)
    );
    const events = loadEvents().filter(e => e.fieldId === fieldId).sort((a, b) => b.endDate.localeCompare(a.endDate));
    const last = events[0];
    const restDays = last ? daysSince(last.endDate) : null;
    const status = getStatus(field);

    // Find the active grazing event if any (startDate <= today <= endDate)
    const today = todayStr();
    const activeEvent = events.find(e => e.startDate <= today && e.endDate >= today);

    let stockHTML = '';
    if (last && field.maxAUperHa) {
        const auHa = last.animalCount / field.areaHa;
        if (auHa > field.maxAUperHa)
            stockHTML = `<div class="warn-box alert" style="margin:8px 0;font-size:11px">⚠ Last event: ${auHa.toFixed(1)} AU/ha exceeds limit of ${field.maxAUperHa} AU/ha</div>`;
    }

    // Show "End Grazing" only when there is an active event
    const endBtn = activeEvent ?
        `<button class="detail-btn end-graze" onclick="endGrazingToday('${activeEvent.id}','${fieldId}')">⏹ End Grazing</button>` :
        '';

    document.getElementById('detailSection').style.display = 'block';
    document.getElementById('fieldDetail').innerHTML = `
        <div class="detail-row"><span class="detail-key">Name</span><span class="detail-val">${field.name}</span></div>
        <div class="detail-row"><span class="detail-key">Type</span><span class="detail-val">${cap(field.type)}</span></div>
        <div class="detail-row"><span class="detail-key">Area</span><span class="detail-val">${field.areaHa.toFixed(2)} ha</span></div>
        <div class="detail-row"><span class="detail-key">Status</span><span class="detail-val"><span class="pill pill-${status.cls}">${status.label}</span></span></div>
        <div class="detail-row"><span class="detail-key">Rest target</span><span class="detail-val">${field.restTarget} days</span></div>
        <div class="detail-row"><span class="detail-key">Days resting</span><span class="detail-val">${restDays !== null ? restDays + ' days' : 'No events yet'}</span></div>
        <div class="detail-row"><span class="detail-key">Max AU/ha</span><span class="detail-val">${field.maxAUperHa || '—'}</span></div>
        <div class="detail-row"><span class="detail-key">Events logged</span><span class="detail-val">${events.length}</span></div>
        ${stockHTML}
        <div class="detail-actions">
            <button class="detail-btn edit"   onclick="openEditFieldModal('${fieldId}')">✎ Edit</button>
            <button class="detail-btn"         onclick="openHistoryModal('${fieldId}')">📋 History</button>
            ${endBtn}
            <button class="detail-btn primary" onclick="openGrazingModal('${fieldId}')">+ Graze</button>
        </div>`;
    document.getElementById('btnDelete').style.display = 'flex';
    const eb = document.getElementById('btnEdit');
    if (eb) eb.style.display = 'flex';
    drawnItems.eachLayer(l => {
        if (l.options.fieldId === fieldId)
            map.fitBounds(l.getBounds(), { padding: [60, 60], maxZoom: 17 });
    });
    setStatus(`${field.name} — ${field.areaHa.toFixed(2)} ha`);
}

// End the active grazing event today — sets its endDate to today so
// the field immediately transitions to "resting" status.
function endGrazingToday(eventId, fieldId) {
    const events = loadEvents();
    const ev = events.find(e => e.id === eventId);
    if (!ev) return;

    const today = todayStr();
    const days = daysBetween(ev.startDate, today);
    const field = loadFields().find(f => f.id === fieldId);
    const name = field ? field.name : 'this field';

    if (!confirm(`End grazing on ${name} today?\n\n${ev.animalCount} ${ev.animalType} · ${days} day${days !== 1 ? 's' : ''} (${fmtDate(ev.startDate)} → ${fmtDate(today)})\n\nThe rest period will start from today.`)) return;

    ev.endDate = today;
    saveEvents(events);

    refreshMapColors();
    renderFieldList();
    updateStats();
    selectField(fieldId); // re-render the detail panel with updated status
    setStatus(`Grazing ended on "${name}" — rest period started today.`);
}

function deselectField() {
    selectedFieldId = null;
    document.querySelectorAll('.field-item').forEach(el => el.classList.remove('selected'));
    document.getElementById('detailSection').style.display = 'none';
    document.getElementById('btnDelete').style.display = 'none';
    const eb = document.getElementById('btnEdit');
    if (eb) eb.style.display = 'none';
}

// ── Field list (sidebar) ──────────────────────────────────────
function renderFieldList() {
    const fields = loadFields();
    document.getElementById('fieldCount').textContent = fields.length;
    const el = document.getElementById('fieldList');
    if (!fields.length) {
        el.innerHTML = `<div class="empty-state">
            <div class="empty-icon">🌾</div>
            <p class="empty-msg">No fields yet</p>
            <p class="empty-sub">Use Draw or Auto-split to add paddocks</p>
        </div>`;
        return;
    }
    el.innerHTML = fields.map(f => {
        const s = getStatus(f);
        return `<div class="field-item" data-id="${f.id}" onclick="selectField('${f.id}')">
            <span class="field-dot" style="background:${f.color}"></span>
            <div class="field-item-info">
                <div class="field-item-name">${f.name}</div>
                <div class="field-item-meta">${f.areaHa.toFixed(1)} ha · ${cap(f.type)}</div>
            </div>
            <span class="pill pill-${s.cls}">${s.label}</span>
        </div>`;
    }).join('');
    if (selectedFieldId)
        document.querySelectorAll('.field-item').forEach(el =>
            el.classList.toggle('selected', el.dataset.id === selectedFieldId)
        );
}

// ── Stats strip ───────────────────────────────────────────────
function updateStats() {
    const fields = loadFields();
    const totalHa = fields.reduce((s, f) => s + f.areaHa, 0);
    const statuses = fields.map(f => getStatus(f));
    document.getElementById('sFields').textContent = fields.length;
    document.getElementById('sHa').textContent = totalHa.toFixed(1) + ' ha';
    document.getElementById('sGrazing').textContent = statuses.filter(s => s.cls === 'grazing').length || '—';
    document.getElementById('sReady').textContent = statuses.filter(s => s.cls === 'ready').length;
}

// ── Field status logic ────────────────────────────────────────
function getStatus(field) {
    const events = loadEvents().filter(e => e.fieldId === field.id)
        .sort((a, b) => b.startDate.localeCompare(a.startDate));
    if (!events.length) return { label: 'Never grazed', cls: 'none' };
    const latest = events[0],
        today = todayStr();
    if (latest.startDate <= today && latest.endDate >= today) return { label: 'Grazing now', cls: 'grazing' };
    const rest = daysSince(latest.endDate);
    if (rest < 0) return { label: 'Planned', cls: 'resting' };
    if (rest >= field.restTarget) return { label: 'Ready', cls: 'ready' };
    if (rest >= field.restTarget * 0.6) return { label: `${rest}d rest`, cls: 'resting' };
    return { label: 'Needs rest', cls: 'danger' };
}

function getReadinessPct(field) {
    const events = loadEvents().filter(e => e.fieldId === field.id)
        .sort((a, b) => b.startDate.localeCompare(a.startDate));
    if (!events.length) return 100;
    const latest = events[0],
        today = todayStr();
    if (latest.startDate <= today && latest.endDate >= today) return 0;
    return Math.min(100, Math.round(Math.max(0, daysSince(latest.endDate)) / field.restTarget * 100));
}

function statusFillColor(field) {
    const s = getStatus(field);
    if (s.cls === 'grazing') return '#22c55e';
    if (s.cls === 'ready') return '#4ade80';
    if (s.cls === 'resting') return '#facc15';
    if (s.cls === 'danger') return '#f87171';
    return field.color;
}

// ── Map restore & refresh ─────────────────────────────────────
function restoreFieldsOnMap() {
    const fields = loadFields();
    if (!fields.length) return;
    const bounds = [];
    fields.forEach(field => {
        const layer = L.geoJSON(field.geometry).getLayers()[0];
        styleLayer(layer, field);
        bindFieldLayer(layer, field);
        drawnItems.addLayer(layer);
        layer.getLatLngs()[0].forEach(ll => bounds.push(ll));
    });
    if (bounds.length) map.fitBounds(L.latLngBounds(bounds), { padding: [50, 50], maxZoom: 16 });
}

function refreshMapColors() {
    const fields = loadFields();
    drawnItems.eachLayer(layer => {
        if (!layer.options.fieldId) return;
        const field = fields.find(f => f.id === layer.options.fieldId);
        if (field) styleLayer(layer, field);
    });
}

// ── Tab switching ─────────────────────────────────────────────
function switchTab(name) {
    document.querySelectorAll('.tab').forEach(b =>
        b.classList.toggle('active', b.id === 'tab-' + name)
    );
    document.querySelectorAll('.tab-panel').forEach(p =>
        p.classList.toggle('active', p.id === 'panel-' + name)
    );
    if (name === 'map') setTimeout(() => map.invalidateSize(), 50);
    if (name === 'dashboard') renderDashboard();
    if (name === 'rotation') renderRotation();
    if (name === 'reports') renderReports();
}

// ── Farm config ───────────────────────────────────────────────
function loadFarmConfig() {
    try {
        const cfg = JSON.parse(localStorage.getItem('gt_config') || '{}');
        if (cfg.farmName) {
            const el = document.getElementById('farmNameDisplay');
            if (el) el.textContent = cfg.farmName;
        }
        if (cfg.lat && cfg.lng && map) map.setView([cfg.lat, cfg.lng], 14);
        if (cfg.cycle === 'daynight' || cfg.grazingCycle === 'daynight')
            localStorage.setItem('gt_daynight', '1');
        // Load animal groups via loadGroups() which handles both the new
        // gt_groups key and the legacy gt_config.animalGroups fallback.
        window._animalGroups = loadGroups();
    } catch (e) {}
}

// ── Boot ──────────────────────────────────────────────────────
// gt-map.js executes before setup.js is parsed, so checkFirstRun()
// is not yet defined at this line. Wrapping it in an arrow function
// defers the name lookup until the timer fires — by which time every
// script including setup.js has fully loaded.
initMap();
loadFarmConfig();
setTimeout(() => checkFirstRun(), 600);