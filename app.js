// ============================================================
//  GrazingTrack v4.0 — app.js
//  New: auto-split in main map, field editing modal,
//       improved GUI wiring, colour picker
// ============================================================
'use strict';
const DB_VERSION = 4;

// ── STORAGE ───────────────────────────────────────────────────
function load(k) { try { const r = localStorage.getItem(k); return r ? JSON.parse(r) : [] } catch (e) { localStorage.removeItem(k); return [] } }

function save(k, v) {
    try {
        localStorage.setItem(k, JSON.stringify(v));
        updateStorageBar();
        checkStorageWarn()
    } catch (e) { if (e.name === 'QuotaExceededError') alert('Storage full! Export a backup first.'); }
}
const loadFields = () => load('gt_fields');
const loadEvents = () => load('gt_events');
const loadMoisture = () => load('gt_moisture');
const saveFields = f => save('gt_fields', f);
const saveEvents = e => save('gt_events', e);
const saveMoisture = m => save('gt_moisture', m);

function getStorageUsage() {
    let t = 0;
    ['gt_fields', 'gt_events', 'gt_moisture'].forEach(k => { const v = localStorage.getItem(k); if (v) t += v.length * 2; });
    return { used: t, max: 5 * 1024 * 1024, pct: Math.min(100, t / (5 * 1024 * 1024) * 100) };
}

function updateStorageBar() {
    const { used, max, pct } = getStorageUsage();
    const b = document.getElementById('storageBar');
    const l = document.getElementById('storageLabel');
    if (!b) return;
    b.style.width = pct.toFixed(1) + '%';
    b.style.background = pct > 80 ? '#f87171' : pct > 50 ? '#facc15' : '#4ade80';
    l.textContent = `Storage: ${(used/1024).toFixed(1)} KB / ${(max/1024).toFixed(0)} KB`;
}

function checkStorageWarn() {
    const { pct } = getStorageUsage();
    if (pct > 80 && !sessionStorage.getItem('gt_sw')) {
        sessionStorage.setItem('gt_sw', '1');
        alert(`Storage is ${pct.toFixed(0)}% full. Export a backup.`);
    }
}

// ── COLORS ────────────────────────────────────────────────────
const COLORS = ['#2d6a4f', '#52b788', '#40916c', '#74c69d', '#1b4332', '#34a0a4', '#0077b6', '#7b2d8b', '#d97706', '#dc2626', '#0891b2', '#059669', '#7c3aed', '#db2777', '#b45309'];
let colorIdx = 0;

function nextColor() { return COLORS[colorIdx++ % COLORS.length]; }

// ── MAP STATE ─────────────────────────────────────────────────
let map, drawnItems, drawControl;
let pendingLayer = null,
    selectedFieldId = null,
    currentTool = 'select',
    vertexCount = 0;

// ── MAP INIT ──────────────────────────────────────────────────
function initMap() {
    map = L.map('map', { zoomControl: false }).setView([-29, 25], 6);
    const sat = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { attribution: 'Tiles © Esri', maxZoom: 19 });
    const osm = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap', maxZoom: 19 });
    const hyb = L.layerGroup([sat, L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, opacity: .8 })]);
    sat.addTo(map);
    L.control.layers({ 'Satellite': sat, 'Satellite + Labels': hyb, 'Street map': osm }, {}, { position: 'topright' }).addTo(map);
    L.control.zoom({ position: 'topright' }).addTo(map);
    drawnItems = new L.FeatureGroup().addTo(map);
    drawControl = new L.Control.Draw({
        position: 'topright',
        draw: {
            polygon: { allowIntersection: false, showArea: true, shapeOptions: { color: '#52b788', fillColor: '#52b788', fillOpacity: .25, weight: 2.5, dashArray: '6 4' } },
            rectangle: false,
            circle: false,
            circlemarker: false,
            marker: false,
            polyline: false
        },
        edit: { featureGroup: drawnItems, remove: false }
    });
    map.on(L.Draw.Event.CREATED, e => {
        pendingLayer = e.layer;
        drawnItems.addLayer(pendingLayer);
        vertexCount = 0;
        updateUndoBtn();
        openModal('modalName');
        setTimeout(() => document.getElementById('inName').focus(), 80);
    });
    map.on('draw:drawvertex', e => {
        let pts = [];
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
            setStatus(`Drawing — ${pts.length} point${pts.length!==1?'s':''} placed · need at least 3`);
        }
    });
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
    map.on('click', () => { if (currentTool === 'select') deselectField(); });
    restoreFieldsOnMap();
    renderFieldList();
    updateStats();
    updateStorageBar();
}

// ── TOOLS ─────────────────────────────────────────────────────
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
        setStatus('Click to place corners · double-click (or click first point) to close · Esc to cancel');
        document.getElementById('toolHint').textContent = 'Each click adds a corner. ↩ Undo removes the last point. Double-click to finish and name the field.';
        if (eb) eb.style.display = 'none';
    } else if (tool === 'edit') {
        document.getElementById('btnEdit').classList.add('active');
        try { map.addControl(drawControl); } catch (e) {}
        setTimeout(() => { const b = document.querySelector('.leaflet-draw-edit-edit'); if (b) b.click(); }, 60);
        setStatus('Drag handles to reshape · click Save in map toolbar when done');
        if (ub) ub.style.display = 'none';
    } else {
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

function updateUndoBtn() { const b = document.getElementById('btnUndo'); if (b) b.style.display = (currentTool === 'draw' && vertexCount > 0) ? 'flex' : 'none'; }

function undoLastVertex() {
    document.dispatchEvent(new KeyboardEvent('keydown', { keyCode: 90, ctrlKey: true, bubbles: true }));
    if (vertexCount > 0) vertexCount--;
    updateUndoBtn();
}

function setStatus(msg) { const el = document.getElementById('statusMsg'); if (el) el.textContent = msg; }

// ── FIELD CREATION ────────────────────────────────────────────
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

// ── FIELD EDIT MODAL ──────────────────────────────────────────
function openEditFieldModal(fieldId) {
    const field = loadFields().find(f => f.id === fieldId);
    if (!field) return;
    document.getElementById('editFieldId').value = field.id;
    document.getElementById('editName').value = field.name;
    document.getElementById('editType').value = field.type;
    document.getElementById('editRest').value = field.restTarget;
    document.getElementById('editMaxAU').value = field.maxAUperHa || '';
    // Render colour picker
    const picker = document.getElementById('editColorPicker');
    picker.innerHTML = COLORS.map(c => `
    <div class="color-swatch${c===field.color?' chosen':''}"
      style="background:${c}"
      onclick="document.querySelectorAll('.color-swatch').forEach(s=>s.classList.remove('chosen'));this.classList.add('chosen')"
      title="${c}"></div>`).join('');
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

    // Get chosen colour
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

    // Update map layer
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

// ── FIELD STYLING ─────────────────────────────────────────────
function styleLayer(layer, field) {
    const c = statusFillColor(field);
    layer.setStyle({ color: c, fillColor: c, fillOpacity: .38, weight: 2.5 });
}

function bindFieldLayer(layer, field) {
    layer.options.fieldId = field.id;
    layer.off('click');
    layer.on('click', e => {
        L.DomEvent.stopPropagation(e);
        selectField(field.id);
    });
    layer.unbindTooltip();
    layer.bindTooltip(`<strong>${field.name}</strong><br>${field.areaHa.toFixed(1)} ha`, { permanent: true, direction: 'center', className: 'field-label' });
}

// ── FIELD DELETION ────────────────────────────────────────────
function deleteSelected() {
    if (!selectedFieldId) return;
    const field = loadFields().find(f => f.id === selectedFieldId);
    if (!field || !confirm(`Delete "${field.name}"?\nAll grazing events and moisture readings will also be deleted.`)) return;
    drawnItems.eachLayer(l => { if (l.options.fieldId === selectedFieldId) drawnItems.removeLayer(l); });
    saveFields(loadFields().filter(f => f.id !== selectedFieldId));
    saveEvents(loadEvents().filter(e => e.fieldId !== selectedFieldId));
    saveMoisture(loadMoisture().filter(m => m.fieldId !== selectedFieldId));
    deselectField();
    renderFieldList();
    updateStats();
    setStatus('Field deleted.');
}

// ── FIELD SELECTION ───────────────────────────────────────────
function selectField(fieldId) {
    selectedFieldId = fieldId;
    const field = loadFields().find(f => f.id === fieldId);
    if (!field) return;
    document.querySelectorAll('.field-item').forEach(el => el.classList.toggle('selected', el.dataset.id === fieldId));
    const events = loadEvents().filter(e => e.fieldId === fieldId).sort((a, b) => b.endDate.localeCompare(a.endDate));
    const last = events[0];
    const restDays = last ? daysSince(last.endDate) : null;
    const status = getStatus(field);
    let stockHTML = '';
    if (last && field.maxAUperHa) {
        const auHa = last.animalCount / field.areaHa;
        if (auHa > field.maxAUperHa)
            stockHTML = `<div class="warn-box alert" style="margin:8px 0;font-size:11px">⚠ Last event: ${auHa.toFixed(1)} AU/ha exceeds limit of ${field.maxAUperHa} AU/ha</div>`;
    }
    document.getElementById('detailSection').style.display = 'block';
    document.getElementById('fieldDetail').innerHTML = `
    <div class="detail-row"><span class="detail-key">Name</span><span class="detail-val">${field.name}</span></div>
    <div class="detail-row"><span class="detail-key">Type</span><span class="detail-val">${cap(field.type)}</span></div>
    <div class="detail-row"><span class="detail-key">Area</span><span class="detail-val">${field.areaHa.toFixed(2)} ha</span></div>
    <div class="detail-row"><span class="detail-key">Status</span><span class="detail-val"><span class="pill pill-${status.cls}">${status.label}</span></span></div>
    <div class="detail-row"><span class="detail-key">Rest target</span><span class="detail-val">${field.restTarget} days</span></div>
    <div class="detail-row"><span class="detail-key">Days resting</span><span class="detail-val">${restDays!==null?restDays+' days':'No events yet'}</span></div>
    <div class="detail-row"><span class="detail-key">Max AU/ha</span><span class="detail-val">${field.maxAUperHa||'—'}</span></div>
    <div class="detail-row"><span class="detail-key">Events logged</span><span class="detail-val">${events.length}</span></div>
    ${stockHTML}
    <div class="detail-actions">
      <button class="detail-btn edit" onclick="openEditFieldModal('${fieldId}')">✎ Edit</button>
      <button class="detail-btn" onclick="openHistoryModal('${fieldId}')">History</button>
      <button class="detail-btn" onclick="openMoistureModal('${fieldId}')">💧</button>
      <button class="detail-btn primary" onclick="openGrazingModal('${fieldId}')">+ Graze</button>
    </div>`;
    document.getElementById('btnDelete').style.display = 'flex';
    const eb = document.getElementById('btnEdit');
    if (eb) eb.style.display = 'flex';
    drawnItems.eachLayer(l => { if (l.options.fieldId === fieldId) map.fitBounds(l.getBounds(), { padding: [60, 60], maxZoom: 17 }); });
    setStatus(`${field.name} — ${field.areaHa.toFixed(2)} ha`);
}

function deselectField() {
    selectedFieldId = null;
    document.querySelectorAll('.field-item').forEach(el => el.classList.remove('selected'));
    document.getElementById('detailSection').style.display = 'none';
    document.getElementById('btnDelete').style.display = 'none';
    const eb = document.getElementById('btnEdit');
    if (eb) eb.style.display = 'none';
}

// ── AUTO-SPLIT (main map) ─────────────────────────────────────
let asMap = null,
    asBoundaryLayer = null,
    asCampLayers = [],
    asDrawnGroup = null,
    asFenceLayers = [];
let asCampCount = 4,
    asSplitDir = 'auto', // 'auto' uses PCA orientation detection
    asCamps = [];

// ── PCA: detect dominant axis of a polygon ────────────────────
// Returns angle in degrees (0=east, 90=north) of the farm's longest axis
function detectFarmOrientation(coords) {
    // Centroid
    const n = coords.length - 1; // last = first for closed ring
    let cx = 0,
        cy = 0;
    for (let i = 0; i < n; i++) {
        cx += coords[i][0];
        cy += coords[i][1];
    }
    cx /= n;
    cy /= n;

    // Covariance matrix
    let cxx = 0,
        cxy = 0,
        cyy = 0;
    for (let i = 0; i < n; i++) {
        const dx = coords[i][0] - cx,
            dy = coords[i][1] - cy;
        cxx += dx * dx;
        cxy += dx * dy;
        cyy += dy * dy;
    }
    cxx /= n;
    cxy /= n;
    cyy /= n;

    // Eigenvector of largest eigenvalue (principal axis)
    const diff = cxx - cyy;
    const disc = Math.sqrt(diff * diff + 4 * cxy * cxy);
    const l1 = (cxx + cyy + disc) / 2;
    // Eigenvector direction
    const ex = l1 - cyy,
        ey = cxy;
    const angle = Math.atan2(ey, ex) * 180 / Math.PI; // degrees from east
    return angle; // positive = tilted north-east
}

// Build a rotated strip box for clipping, given rotation angle
function rotatedStrip(coords, fraction0, fraction1, angle) {
    const rad = angle * Math.PI / 180;
    const cos = Math.cos(rad),
        sin = Math.sin(rad);

    // Project all coords onto principal axis
    const projections = coords.map(c => c[0] * cos + c[1] * sin);
    const minP = Math.min(...projections),
        maxP = Math.max(...projections);

    // Perpendicular projections
    const perp = coords.map(c => -c[0] * sin + c[1] * cos);
    const minPerp = Math.min(...perp) - 0.001;
    const maxPerp = Math.max(...perp) + 0.001;

    const s = minP + fraction0 * (maxP - minP) - 0.00001;
    const e = minP + fraction1 * (maxP - minP) + 0.00001;

    // Four corners of strip in rotated space, back to lat/lng
    const corners = [
        [s, minPerp],
        [e, minPerp],
        [e, maxPerp],
        [s, maxPerp]
    ].map(([p, q]) => {
        // inverse rotation: lng = p*cos - q*sin, lat = p*sin + q*cos
        return [p * cos - q * sin, p * sin + q * cos];
    });

    // Return as [lat, lng] clip polygon
    return corners.map(c => [c[1], c[0]]);
}

function openAutoSplit() {
    asCampCount = 4;
    asSplitDir = 'auto';
    asCamps = [];
    asBoundaryLayer = null;
    asFenceLayers = [];
    // Update UI
    const slider = document.getElementById('asCampSlider');
    const numEl = document.getElementById('asCampNum');
    if (slider) { slider.value = 4; }
    if (numEl) { numEl.textContent = '4'; }
    const dirEl = document.getElementById('asSplitDir');
    if (dirEl) dirEl.value = 'auto';
    document.getElementById('asControls').style.display = 'none';
    document.getElementById('asCampNamesWrap').style.display = 'none';
    document.getElementById('asSaveBtn').disabled = true;
    document.getElementById('asCampCount').textContent = '';
    document.getElementById('asHint').innerHTML = 'Click <strong>Farm boundary</strong> then trace the outer fence of your farm. Double-click to close.';
    openModal('modalAutoSplit');
    setTimeout(asInitMap, 150);
}

function closeAutoSplit() {
    closeModal('modalAutoSplit');
    asDestroyMap();
}

function asInitMap() {
    if (asMap) {
        try { asMap.remove(); } catch (e) {}
        asMap = null;
    }
    // Centre on existing fields or default
    let center = [-29, 25],
        zoom = 6;
    const fields = loadFields();
    if (fields.length) {
        const lats = [],
            lngs = [];
        fields.forEach(f => f.geometry.coordinates[0].forEach(([lng, lat]) => {
            lats.push(lat);
            lngs.push(lng);
        }));
        center = [(Math.min(...lats) + Math.max(...lats)) / 2, (Math.min(...lngs) + Math.max(...lngs)) / 2];
        zoom = 13;
    } else {
        try {
            const cfg = JSON.parse(localStorage.getItem('gt_config') || '{}');
            if (cfg.lat) {
                center = [cfg.lat, cfg.lng];
                zoom = 14;
            }
        } catch (e) {}
    }
    asMap = L.map('asMap', { zoomControl: true }).setView(center, zoom);
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { attribution: '© Esri', maxZoom: 19 }).addTo(asMap);
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, opacity: .7 }).addTo(asMap);
    asDrawnGroup = new L.FeatureGroup().addTo(asMap);
    const dc = new L.Control.Draw({
        position: 'topright',
        draw: {
            polygon: { allowIntersection: false, showArea: true, shapeOptions: { color: '#2d6a4f', fillColor: '#2d6a4f', fillOpacity: .12, weight: 3, dashArray: '6 3' } },
            polyline: { shapeOptions: { color: '#f97316', weight: 2.5, dashArray: '8 4' } },
            rectangle: false,
            circle: false,
            circlemarker: false,
            marker: false
        },
        edit: { featureGroup: asDrawnGroup, remove: false }
    });
    asMap.addControl(dc);
    asMap.on(L.Draw.Event.CREATED, asOnDrawn);
    asMode('boundary');
}

function asMode(mode) {
    document.querySelectorAll('.as-tbtn').forEach(b => b.classList.remove('active'));
    document.getElementById(mode === 'fence' ? 'asBtnFence' : 'asBtnBound').classList.add('active');
    document.getElementById('asHint').innerHTML = mode === 'fence' ?
        'Click to draw fence lines across your farm. Double-click to finish each line. Lines split camps where they cross.' :
        'Click around the outer edge of your farm. Double-click to close the boundary.';
    setTimeout(() => {
        const btn = document.querySelector(mode === 'fence' ? '.leaflet-draw-draw-polyline' : '.leaflet-draw-draw-polygon');
        if (btn) btn.click();
    }, 60);
}

function asOnDrawn(e) {
    if (e.layerType === 'polygon') {
        if (asBoundaryLayer) asDrawnGroup.removeLayer(asBoundaryLayer);
        asClearCamps();
        asFenceLayers = [];
        asBoundaryLayer = e.layer;
        e.layer.setStyle({ color: '#2d6a4f', fillColor: '#2d6a4f', fillOpacity: .12, weight: 3 });
        asDrawnGroup.addLayer(e.layer);
        asBoundaryLayer._geo = e.layer.toGeoJSON().geometry;
        document.getElementById('asHint').textContent = '✓ Boundary drawn! Camps auto-detected. Adjust count or add fence lines to refine.';
        document.getElementById('asControls').style.display = 'block';
        asDrawCamps();
        document.getElementById('asCampNamesWrap').style.display = 'block';
        asFillNames();
        document.getElementById('asSaveBtn').disabled = false;
    } else if (e.layerType === 'polyline') {
        e.layer.setStyle({ color: '#f97316', weight: 2.5, dashArray: '8 4' });
        asDrawnGroup.addLayer(e.layer);
        asFenceLayers.push(e.layer);
        asDrawCamps();
        asFillNames();
    }
}

function asAdjCamps(d) {
    asCampCount = Math.max(1, Math.min(100, asCampCount + d));
    const slider = document.getElementById('asCampSlider');
    const numEl = document.getElementById('asCampNum');
    if (slider) slider.value = asCampCount;
    if (numEl) numEl.textContent = asCampCount;
    if (asBoundaryLayer) {
        asDrawCamps();
        asFillNames();
    }
}

function asSliderChange(val) {
    asCampCount = parseInt(val);
    document.getElementById('asCampNum').textContent = asCampCount;
    if (asBoundaryLayer) {
        asDrawCamps();
        asFillNames();
    }
}

function asRebuild() {
    asSplitDir = document.getElementById('asSplitDir').value;
    if (asBoundaryLayer) {
        asDrawCamps();
        asFillNames();
    }
}

function asClearAll() {
    asClearCamps();
    if (asBoundaryLayer) {
        try { asDrawnGroup.removeLayer(asBoundaryLayer); } catch (e) {}
        asBoundaryLayer = null;
    }
    asFenceLayers.forEach(l => { try { asDrawnGroup.removeLayer(l); } catch (e) {} });
    asFenceLayers = [];
    document.getElementById('asControls').style.display = 'none';
    document.getElementById('asCampNamesWrap').style.display = 'none';
    document.getElementById('asSaveBtn').disabled = true;
    document.getElementById('asCampCount').textContent = '';
    document.getElementById('asHint').innerHTML = 'Click <strong>Farm boundary</strong> then trace the outer edge of your farm on the map.';
}

// CAMP SPLITTING — orientation-aware with Sutherland-Hodgman clipping
function asDrawCamps() {
    asClearCamps();
    if (!asBoundaryLayer || !asMap) return;
    const geo = asBoundaryLayer._geo;
    const coords = geo.coordinates[0]; // [lng, lat]
    const lats = coords.map(c => c[1]),
        lngs = coords.map(c => c[0]);
    const minLat = Math.min(...lats),
        maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs),
        maxLng = Math.max(...lngs);
    const n = asCampCount;
    const dir = asSplitDir;

    // Detect orientation for 'auto' mode
    let orientAngle = 0;
    if (dir === 'auto') {
        orientAngle = detectFarmOrientation(coords);
    }

    // Extra splits from fence lines
    let extras = [];
    asFenceLayers.forEach(fl => {
        fl.getLatLngs().forEach(p => {
            let v;
            if (dir === 'auto') {
                // Project fence points onto principal axis
                const rad = orientAngle * Math.PI / 180;
                const cos = Math.cos(rad),
                    sin = Math.sin(rad);
                const projections = coords.map(c => c[0] * cos + c[1] * sin);
                const minP = Math.min(...projections),
                    maxP = Math.max(...projections);
                const pv = p.lng * cos + p.lat * sin;
                v = (pv - minP) / (maxP - minP);
            } else if (dir === 'horizontal') {
                v = (p.lat - minLat) / (maxLat - minLat);
            } else {
                v = (p.lng - minLng) / (maxLng - minLng);
            }
            if (v > 0.02 && v < 0.98) extras.push(Math.round(v * 100) / 100);
        });
    });
    extras = [...new Set(extras)].sort((a, b) => a - b);

    let dividers = [];
    for (let i = 1; i < n; i++) dividers.push(i / n);
    dividers = [...new Set([...dividers, ...extras])].sort((a, b) => a - b);
    const offsets = [0, ...dividers, 1];

    const pad = 0.00005;
    let polys = [];

    if (dir === 'grid') {
        const cols = Math.ceil(Math.sqrt(n)),
            rows = Math.ceil(n / cols);
        let ct = 0;
        for (let r = 0; r < rows && ct < n; r++) {
            for (let c = 0; c < cols && ct < n; c++) {
                const sL = minLat + r * (maxLat - minLat) / rows - pad,
                    eL = minLat + (r + 1) * (maxLat - minLat) / rows + pad;
                const sG = minLng + c * (maxLng - minLng) / cols - pad,
                    eG = minLng + (c + 1) * (maxLng - minLng) / cols + pad;
                polys.push(asClip(coords, [
                    [sL, sG],
                    [eL, sG],
                    [eL, eG],
                    [sL, eG]
                ]));
                ct++;
            }
        }
    } else if (dir === 'auto') {
        // Split along principal axis of the farm
        for (let i = 0; i < offsets.length - 1; i++) {
            const strip = rotatedStrip(coords, offsets[i], offsets[i + 1], orientAngle);
            polys.push(asClip(coords, strip));
        }
    } else {
        for (let i = 0; i < offsets.length - 1; i++) {
            let strip;
            if (dir === 'vertical') {
                const s = minLng + offsets[i] * (maxLng - minLng) - pad,
                    e = minLng + offsets[i + 1] * (maxLng - minLng) + pad;
                strip = [
                    [minLat - pad, s],
                    [maxLat + pad, s],
                    [maxLat + pad, e],
                    [minLat - pad, e]
                ];
            } else {
                const s = minLat + offsets[i] * (maxLat - minLat) - pad,
                    e = minLat + offsets[i + 1] * (maxLat - minLat) + pad;
                strip = [
                    [s, minLng - pad],
                    [e, minLng - pad],
                    [e, maxLng + pad],
                    [s, maxLng + pad]
                ];
            }
            polys.push(asClip(coords, strip));
        }
    }
    polys = polys.filter(p => p && p.length >= 3);

    // Extended colour palette for up to 100 camps
    const campColors = [
        '#2d6a4f', '#52b788', '#40916c', '#74c69d', '#1b4332', '#34a0a4', '#0077b6', '#7b2d8b',
        '#d97706', '#dc2626', '#0891b2', '#059669', '#7c3aed', '#db2777', '#b45309', '#374151',
        '#16a34a', '#ca8a04', '#9333ea', '#e11d48', '#0369a1', '#15803d', '#b91c1c', '#7e22ce',
        '#c2410c', '#0f766e', '#1d4ed8', '#a16207', '#be123c', '#4f46e5', '#065f46', '#9f1239',
        '#1e40af', '#166534', '#86198f', '#92400e', '#064e3b', '#1e3a8a', '#701a75', '#78350f',
    ];

    asCamps = polys.map((poly, i) => {
        const color = campColors[i % campColors.length];
        const geoC = {
            type: 'Polygon',
            coordinates: [
                [...poly.map(p => [p[1], p[0]]), [poly[0][1], poly[0][0]]]
            ]
        };
        return { id: uid(), name: `Camp ${i+1}`, geometry: geoC, color, areaHa: calcAreaHa(geoC) };
    });

    asCamps.forEach(camp => {
        const lls = camp.geometry.coordinates[0].map(c => [c[1], c[0]]);
        const layer = L.polygon(lls, { color: camp.color, fillColor: camp.color, fillOpacity: .4, weight: 2, interactive: false }).addTo(asMap);
        const cLat = lls.reduce((s, p) => s + p[0], 0) / lls.length;
        const cLng = lls.reduce((s, p) => s + p[1], 0) / lls.length;
        const icon = L.divIcon({ className: '', html: `<div class="camp-lbl">${camp.name}</div>`, iconAnchor: [30, 10] });
        const m = L.marker([cLat, cLng], { icon, interactive: false }).addTo(asMap);
        asCampLayers.push(layer, m);
    });

    document.getElementById('asCampCount').textContent = `${asCamps.length} camp${asCamps.length!==1?'s':''} detected`;
}


// Sutherland-Hodgman clipping
function asClip(sub, clip) {
    let out = sub.map(c => [c[1], c[0]]);
    for (let i = 0; i < clip.length; i++) {
        if (!out.length) return [];
        const inp = out;
        out = [];
        const a = clip[i],
            b = clip[(i + 1) % clip.length];
        for (let j = 0; j < inp.length; j++) {
            const cur = inp[j],
                prev = inp[(j + inp.length - 1) % inp.length];
            const ci = asInside(cur, a, b),
                pi = asInside(prev, a, b);
            if (ci) {
                if (!pi) out.push(asIsect(prev, cur, a, b));
                out.push(cur);
            } else if (pi) out.push(asIsect(prev, cur, a, b));
        }
    }
    return out;
}

function asInside(p, a, b) { return (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]) >= 0; }

function asIsect(p1, p2, p3, p4) {
    const d1 = [p2[0] - p1[0], p2[1] - p1[1]],
        d2 = [p4[0] - p3[0], p4[1] - p3[1]];
    const x = d1[0] * d2[1] - d1[1] * d2[0];
    if (Math.abs(x) < 1e-10) return p1;
    const t = ((p3[0] - p1[0]) * d2[1] - (p3[1] - p1[1]) * d2[0]) / x;
    return [p1[0] + t * d1[0], p1[1] + t * d1[1]];
}

function asClearCamps() {
    asCampLayers.forEach(l => { try { asMap && asMap.removeLayer(l); } catch (e) {} });
    asCampLayers = [];
    asCamps = [];
}

function asFillNames() {
    const ta = document.getElementById('asCampNames');
    if (ta) ta.value = asCamps.map((c, i) => c.name || `Camp ${i+1}`).join('\n');
}

function asReadNames() {
    const ta = document.getElementById('asCampNames');
    if (!ta || !ta.value.trim()) return;
    ta.value.split('\n').map(s => s.trim()).filter(Boolean).forEach((n, i) => { if (asCamps[i]) asCamps[i].name = n; });
}

function asCreateCamps() {
    if (!asCamps.length) { alert('Draw a farm boundary first to auto-detect camps.'); return; }
    asReadNames();
    const existing = loadFields();
    const newFields = asCamps.map(c => ({
        id: c.id,
        name: c.name,
        type: 'pasture',
        restTarget: 42,
        maxAUperHa: null,
        geometry: c.geometry,
        areaHa: c.areaHa,
        color: c.color,
        createdAt: new Date().toISOString(),
        version: DB_VERSION
    }));
    saveFields([...existing, ...newFields]);
    // Refresh main map
    if (typeof drawnItems !== 'undefined' && drawnItems) {
        drawnItems.clearLayers();
        restoreFieldsOnMap();
    }
    renderFieldList();
    updateStats();
    closeAutoSplit();
    setStatus(`${newFields.length} camps created and added to your farm.`);
    // Select first
    if (newFields.length) setTimeout(() => selectField(newFields[0].id), 300);
}

function asDestroyMap() {
    if (asMap) {
        try { asMap.remove(); } catch (e) {}
        asMap = null;
    }
    asBoundaryLayer = null;
    asCampLayers = [];
    asFenceLayers = [];
}

// ── GRAZING EVENTS ────────────────────────────────────────────
function openGrazingModal(preFieldId) {
    const fields = loadFields();
    if (!fields.length) { alert('Add a field first.'); return; }
    document.getElementById('gField').innerHTML = fields.map(f => `<option value="${f.id}"${f.id===preFieldId?' selected':''}>${f.name}</option>`).join('');
    const groups = window._animalGroups || [];
    if (groups.length) {
        document.getElementById('gAnimalType').innerHTML = groups.map(g => `<option value="${g.type}">${g.name||cap(g.type)} (${g.count})</option>`).join('') + '<option value="other">Other</option>';
    }
    const today = todayStr();
    document.getElementById('gStart').value = today;
    document.getElementById('gEnd').value = addDays(today, 7);
    document.getElementById('gCount').value = '';
    document.getElementById('gNotes').value = '';
    document.getElementById('stockingWarning').style.display = 'none';
    const isDN = localStorage.getItem('gt_daynight') === '1';
    const sr = document.getElementById('gShiftRow');
    if (sr) sr.style.display = isDN ? 'grid' : 'none';
    openModal('modalGrazing');
    ['gCount', 'gField'].forEach(id => document.getElementById(id).addEventListener('input', checkStockingLive));
}

function checkStockingLive() {
    const fieldId = document.getElementById('gField').value;
    const count = parseInt(document.getElementById('gCount').value);
    const field = loadFields().find(f => f.id === fieldId);
    const warn = document.getElementById('stockingWarning');
    if (!field || !count || !field.maxAUperHa) { warn.style.display = 'none'; return; }
    const auHa = count / field.areaHa;
    if (auHa > field.maxAUperHa) {
        warn.className = 'warn-box alert';
        warn.textContent = `⚠ ${auHa.toFixed(1)} AU/ha exceeds limit of ${field.maxAUperHa} AU/ha for this field.`;
        warn.style.display = 'block';
    } else if (auHa > field.maxAUperHa * 0.85) {
        warn.className = 'warn-box';
        warn.style.background = '#fef9c3';
        warn.style.border = '1.5px solid #fde68a';
        warn.style.color = '#854d0e';
        warn.textContent = `Note: ${auHa.toFixed(1)} AU/ha — approaching limit of ${field.maxAUperHa} AU/ha.`;
        warn.style.display = 'block';
    } else { warn.style.display = 'none'; }
}

function saveGrazingEvent() {
    const fieldId = document.getElementById('gField').value;
    const start = document.getElementById('gStart').value;
    const end = document.getElementById('gEnd').value;
    const type = document.getElementById('gAnimalType').value;
    const count = parseInt(document.getElementById('gCount').value);
    const notes = document.getElementById('gNotes').value.trim();
    if (!start || !end) { alert('Enter start and end dates.'); return; }
    if (end < start) { alert('End date must be on or after start date.'); return; }
    if (!count || count < 1) { alert('Enter the number of animals.'); return; }
    const events = loadEvents();
    events.push({ id: uid(), fieldId, startDate: start, endDate: end, animalType: type, animalCount: count, notes, loggedAt: new Date().toISOString() });
    saveEvents(events);
    closeModal('modalGrazing');
    refreshMapColors();
    renderFieldList();
    updateStats();
    if (selectedFieldId === fieldId) selectField(fieldId);
    const field = loadFields().find(f => f.id === fieldId);
    setStatus(`Logged: ${count} ${type} on "${field.name}" — ${daysBetween(start,end)} days`);
}

// ── HISTORY ───────────────────────────────────────────────────
let historyFieldId = null;

function openHistoryModal(fieldId) {
    historyFieldId = fieldId;
    const field = loadFields().find(f => f.id === fieldId);
    const events = loadEvents().filter(e => e.fieldId === fieldId).sort((a, b) => b.startDate.localeCompare(a.startDate));
    document.getElementById('historyTitle').textContent = `${field.name} — Grazing History`;
    document.getElementById('historyBody').innerHTML = !events.length ?
        `<p class="no-history">No events yet.</p>` :
        `<table class="htbl"><thead><tr><th>Start</th><th>End</th><th>Days</th><th>Type</th><th>Animals</th><th>AU/ha</th><th>Notes</th><th></th></tr></thead><tbody>
    ${events.map(e=>{
      const auHa=field.areaHa>0?(e.animalCount/field.areaHa).toFixed(1):'—';
      const warn=field.maxAUperHa&&(e.animalCount/field.areaHa)>field.maxAUperHa?'⚠':'';
      return`<tr>
        <td>${fmtDate(e.startDate)}</td><td>${fmtDate(e.endDate)}</td>
        <td>${daysBetween(e.startDate,e.endDate)}</td><td>${cap(e.animalType)}</td>
        <td>${e.animalCount}</td><td>${warn}${auHa}</td>
        <td style="color:#6b7280;font-size:11px;max-width:100px">${e.notes||'—'}</td>
        <td><button class="del-ev-btn" onclick="deleteEvent('${e.id}','${fieldId}')">✕</button></td>
      </tr>`;
    }).join('')}</tbody></table>`;
  openModal('modalHistory');
}
function deleteEvent(eventId,fieldId){
  if(!confirm('Delete this grazing event?'))return;
  saveEvents(loadEvents().filter(e=>e.id!==eventId));
  refreshMapColors();renderFieldList();updateStats();
  openHistoryModal(fieldId);
  if(selectedFieldId===fieldId)selectField(fieldId);
}
function historyAddEvent(){closeModal('modalHistory');openGrazingModal(historyFieldId);}

// ── MOISTURE ─────────────────────────────────────────────────
function openMoistureModal(preFieldId){
  const fields=loadFields();if(!fields.length){alert('Add a field first.');return;}
  document.getElementById('mField').innerHTML=fields.map(f=>`<option value="${f.id}"${f.id===preFieldId?' selected':''}>${f.name}</option>`).join('');
  document.getElementById('mDate').value=todayStr();
  document.getElementById('mPct').value='';
  document.getElementById('mDepth').value='20';
  document.getElementById('mSensor').value='';
  document.getElementById('mNotes').value='';
  openModal('modalMoisture');
}
function saveMoistureReading(){
  const fieldId=document.getElementById('mField').value;
  const pct=parseFloat(document.getElementById('mPct').value);
  const date=document.getElementById('mDate').value;
  const depth=parseFloat(document.getElementById('mDepth').value)||20;
  const sensor=document.getElementById('mSensor').value.trim();
  const notes=document.getElementById('mNotes').value.trim();
  if(!date||isNaN(pct)||pct<0||pct>100){alert('Enter a valid date and moisture % (0–100).');return;}
  const readings=loadMoisture();
  readings.push({id:uid(),fieldId,date,time:new Date().toTimeString().slice(0,5),moisture_pct:pct,depth_cm:depth,sensor_id:sensor,notes,loggedAt:new Date().toISOString()});
  saveMoisture(readings);
  closeModal('modalMoisture');
  const field=loadFields().find(f=>f.id===fieldId);
  setStatus(`Moisture logged: ${pct}% at ${depth}cm — ${field.name}`);
}
function importSensorJSON(event){
  const file=event.target.files[0];if(!file)return;
  const reader=new FileReader();
  reader.onload=e=>{
    try{
      const data=JSON.parse(e.target.result);
      const readings=Array.isArray(data)?data:(data.readings||[]);
      if(!readings.length)throw new Error('No readings');
      const existing=loadMoisture();
      const ids=new Set(existing.map(r=>r.id));
      const added=readings.filter(r=>!ids.has(r.id)).map(r=>({...r,id:r.id||uid()}));
      saveMoisture([...existing,...added]);
      closeModal('modalExport');alert(`Imported ${added.length} new sensor readings.`);
    }catch(err){alert('Could not read sensor file.');}
  };
  reader.readAsText(file);event.target.value='';
}

// ── FIELD LIST ────────────────────────────────────────────────
function renderFieldList(){
  const fields=loadFields();
  document.getElementById('fieldCount').textContent=fields.length;
  const el=document.getElementById('fieldList');
  if(!fields.length){
    el.innerHTML=`<div class="empty-state"><div class="empty-icon">🌾</div><p class="empty-msg">No fields yet</p><p class="empty-sub">Use Draw or Auto-split to add paddocks</p></div>`;
    return;
  }
  el.innerHTML=fields.map(f=>{
    const s=getStatus(f);
    return`<div class="field-item" data-id="${f.id}" onclick="selectField('${f.id}')">
      <span class="field-dot" style="background:${f.color}"></span>
      <div class="field-item-info">
        <div class="field-item-name">${f.name}</div>
        <div class="field-item-meta">${f.areaHa.toFixed(1)} ha · ${cap(f.type)}</div>
      </div>
      <span class="pill pill-${s.cls}">${s.label}</span>
    </div>`;
  }).join('');
  if(selectedFieldId)document.querySelectorAll('.field-item').forEach(el=>el.classList.toggle('selected',el.dataset.id===selectedFieldId));
}

// ── STATS ─────────────────────────────────────────────────────
function updateStats(){
  const fields=loadFields();
  const totalHa=fields.reduce((s,f)=>s+f.areaHa,0);
  const statuses=fields.map(f=>getStatus(f));
  document.getElementById('sFields').textContent=fields.length;
  document.getElementById('sHa').textContent=totalHa.toFixed(1)+' ha';
  document.getElementById('sGrazing').textContent=statuses.filter(s=>s.cls==='grazing').length||'—';
  document.getElementById('sReady').textContent=statuses.filter(s=>s.cls==='ready').length;
}

// ── STATUS LOGIC ──────────────────────────────────────────────
function getStatus(field){
  const events=loadEvents().filter(e=>e.fieldId===field.id).sort((a,b)=>b.startDate.localeCompare(a.startDate));
  if(!events.length)return{label:'Never grazed',cls:'none'};
  const latest=events[0],today=todayStr();
  if(latest.startDate<=today&&latest.endDate>=today)return{label:'Grazing now',cls:'grazing'};
  const rest=daysSince(latest.endDate);
  if(rest<0)return{label:'Planned',cls:'resting'};
  if(rest>=field.restTarget)return{label:'Ready',cls:'ready'};
  if(rest>=field.restTarget*.6)return{label:`${rest}d rest`,cls:'resting'};
  return{label:'Needs rest',cls:'danger'};
}
function getReadinessPct(field){
  const events=loadEvents().filter(e=>e.fieldId===field.id).sort((a,b)=>b.startDate.localeCompare(a.startDate));
  if(!events.length)return 100;
  const latest=events[0],today=todayStr();
  if(latest.startDate<=today&&latest.endDate>=today)return 0;
  return Math.min(100,Math.round(Math.max(0,daysSince(latest.endDate))/field.restTarget*100));
}
function statusFillColor(field){
  const s=getStatus(field);
  if(s.cls==='grazing')return'#22c55e';
  if(s.cls==='ready')return'#4ade80';
  if(s.cls==='resting')return'#facc15';
  if(s.cls==='danger')return'#f87171';
  return field.color;
}

// ── MAP RESTORE ───────────────────────────────────────────────
function restoreFieldsOnMap(){
  const fields=loadFields();if(!fields.length)return;
  const bounds=[];
  fields.forEach(field=>{
    const layer=L.geoJSON(field.geometry).getLayers()[0];
    styleLayer(layer,field);bindFieldLayer(layer,field);
    drawnItems.addLayer(layer);
    layer.getLatLngs()[0].forEach(ll=>bounds.push(ll));
  });
  if(bounds.length)map.fitBounds(L.latLngBounds(bounds),{padding:[50,50],maxZoom:16});
}
function refreshMapColors(){
  const fields=loadFields();
  drawnItems.eachLayer(layer=>{
    if(!layer.options.fieldId)return;
    const field=fields.find(f=>f.id===layer.options.fieldId);
    if(field)styleLayer(layer,field);
  });
}

// ── TABS ──────────────────────────────────────────────────────
function switchTab(name){
  document.querySelectorAll('.tab').forEach(b=>b.classList.toggle('active',b.id==='tab-'+name));
  document.querySelectorAll('.tab-panel').forEach(p=>p.classList.toggle('active',p.id==='panel-'+name));
  if(name==='map')setTimeout(()=>map.invalidateSize(),50);
  if(name==='dashboard')renderDashboard();
  if(name==='rotation')renderRotation();
  if(name==='reports')renderReports();
}

// ── DASHBOARD ─────────────────────────────────────────────────
function renderDashboard(){
  const fields=loadFields(),events=loadEvents(),moisture=loadMoisture();
  const today=todayStr(),thisMonth=today.slice(0,7);
  const totalHa=fields.reduce((s,f)=>s+f.areaHa,0);
  const statuses=fields.map(f=>getStatus(f));
  const nG=statuses.filter(s=>s.cls==='grazing').length;
  const nR=statuses.filter(s=>s.cls==='ready').length;
  const nRe=statuses.filter(s=>s.cls==='resting').length;
  const nD=statuses.filter(s=>s.cls==='danger').length;
  const evM=events.filter(e=>e.startDate.startsWith(thisMonth)).length;

  document.getElementById('dashGrid').innerHTML=[
    {label:'Total fields',val:fields.length,sub:totalHa.toFixed(1)+' ha'},
    {label:'Grazing now',val:nG,sub:nG?'fields active':'none active'},
    {label:'Ready to graze',val:nR,sub:'rest target met'},
    {label:'Events this month',val:evM,sub:thisMonth},
    {label:'Resting',val:nRe,sub:'building up'},
    {label:'Need rest',val:nD,sub:nD?'⚠ check these':'all ok'}
  ].map(c=>`<div class="kpi"><div class="kpi-lbl">${c.label}</div><div class="kpi-val">${c.val}</div><div class="kpi-sub">${c.sub}</div></div>`).join('');

  document.getElementById('dashFieldStatus').innerHTML=`
    <div class="card-title">Field status overview</div>
    ${fields.length?`<div class="status-grid">${fields.map(f=>{
      const s=getStatus(f),bg=statusFillColor(f);
      return`<div class="status-tile" style="background:${bg}" onclick="switchTab('map');setTimeout(()=>selectField('${f.id}'),100)">
        <div class="status-tile-name">${f.name}</div>
        <div class="status-tile-sub">${f.areaHa.toFixed(1)} ha · ${s.label}</div>
      </div>`;
    }).join('')}</div>`:'<p style="color:#9ca3af;font-size:12px">No fields yet.</p>'}`;

  const recent=events.slice().sort((a,b)=>b.startDate.localeCompare(a.startDate)).slice(0,8);
  document.getElementById('dashRecentEvents').innerHTML=`
    <div class="card-title">Recent grazing events</div>
    ${recent.length?`<table class="htbl"><thead><tr><th>Field</th><th>Start</th><th>Animals</th><th>Days</th></tr></thead><tbody>
    ${recent.map(e=>{const f=fields.find(x=>x.id===e.fieldId);return`<tr><td>${f?f.name:'—'}</td><td>${fmtDate(e.startDate)}</td><td>${e.animalCount} ${e.animalType}</td><td>${daysBetween(e.startDate,e.endDate)}</td></tr>`;}).join('')}</tbody></table>`:'<p class="no-history">No events logged yet.</p>'}`;

  const si=fields.map(f=>{
    const fe=events.filter(e=>e.fieldId===f.id).sort((a,b)=>b.startDate.localeCompare(a.startDate));
    if(!fe.length)return null;
    const last=fe[0],auHa=(last.animalCount/f.areaHa).toFixed(1);
    const over=f.maxAUperHa&&(last.animalCount/f.areaHa)>f.maxAUperHa;
    return`<div class="detail-row"><span class="detail-key">${f.name}</span><span class="detail-val" style="color:${over?'#dc2626':'#166534'}">${auHa} AU/ha ${over?'⚠':''}</span></div>`;
  }).filter(Boolean);
  document.getElementById('dashStocking').innerHTML=`<div class="card-title">Stocking rates</div>${si.length?si.join(''):'<p style="color:#9ca3af;font-size:12px">No events yet.</p>'}`;

  const mByF={};moisture.forEach(r=>{if(!mByF[r.fieldId]||r.date>mByF[r.fieldId].date)mByF[r.fieldId]=r;});
  const mRows=fields.map(f=>{
    const r=mByF[f.id];
    if(!r)return`<tr><td>${f.name}</td><td colspan="3" style="color:#9ca3af">No readings</td></tr>`;
    const bar=`<div style="height:5px;background:#f0ede7;border-radius:4px;overflow:hidden;margin-top:2px"><div style="width:${r.moisture_pct}%;height:100%;background:#60a5fa;border-radius:4px"></div></div>`;
    return`<tr><td>${f.name}</td><td>${r.moisture_pct}%${bar}</td><td>${r.depth_cm}cm</td><td>${fmtDate(r.date)}</td></tr>`;
  });
  document.getElementById('dashSoilMoisture').innerHTML=`
    <div class="card-title">Soil moisture — latest readings <button class="detail-btn" style="float:right;padding:3px 8px;font-size:10px" onclick="openMoistureModal(null)">+ Add</button></div>
    ${fields.length?`<table class="htbl"><thead><tr><th>Field</th><th>Moisture</th><th>Depth</th><th>Date</th></tr></thead><tbody>${mRows.join('')}</tbody></table>`:'<p style="color:#9ca3af;font-size:12px">No fields yet.</p>'}`;

  fetchRainfall();
}

// ── RAINFALL ─────────────────────────────────────────────────
function getFarmCenter(){
  const fields=loadFields();if(!fields.length)return null;
  let lats=[],lngs=[];
  fields.forEach(f=>f.geometry.coordinates[0].forEach(([lng,lat])=>{lats.push(lat);lngs.push(lng);}));
  return{lat:(Math.min(...lats)+Math.max(...lats))/2,lng:(Math.min(...lngs)+Math.max(...lngs))/2};
}
async function fetchRainfall(){
  const el=document.getElementById('dashRainfall');if(!el)return;
  el.innerHTML='<div class="card-title">Rainfall</div><p style="color:#9ca3af;font-size:12px">Loading...</p>';
  const center=getFarmCenter();
  if(!center){el.innerHTML='<div class="card-title">Rainfall</div><p style="color:#9ca3af;font-size:12px">Add fields to see rainfall for your farm location.</p>';return;}
  try{
    const url=`https://api.open-meteo.com/v1/forecast?latitude=${center.lat.toFixed(4)}&longitude=${center.lng.toFixed(4)}&daily=precipitation_sum&past_days=14&forecast_days=3&timezone=auto`;
    const res=await fetch(url);if(!res.ok)throw new Error();
    const data=await res.json();
    const dates=data.daily.time,rain=data.daily.precipitation_sum;
    const total14=rain.slice(0,14).reduce((s,v)=>s+(v||0),0);
    const maxR=Math.max(...rain,1),today=todayStr();
    const bars=dates.map((d,i)=>{
      const iF=d>today;const h=Math.max(2,Math.round((rain[i]||0)/maxR*55));
      const label=d.slice(5).replace('-','/');
      return`<div class="rain-bar-wrap"><div class="rain-bar${iF?' forecast':''}" style="height:${h}px" title="${d}: ${(rain[i]||0).toFixed(1)}mm"></div><div class="rain-lbl">${i%3===0?label:''}</div></div>`;
    }).join('');
    el.innerHTML=`<div class="card-title">Rainfall — 14d history + 3d forecast</div><div class="rain-bars">${bars}</div><div class="rain-total">14-day total: <strong>${total14.toFixed(1)} mm</strong></div><div style="font-size:10px;color:#9ca3af;margin-top:4px">Data: Open-Meteo.com (free &amp; open source)</div>`;
  }catch(err){
    el.innerHTML='<div class="card-title">Rainfall</div><p style="color:#9ca3af;font-size:12px">Could not load — check internet connection.</p>';
  }
}

// ── ROTATION ─────────────────────────────────────────────────
function renderRotation(){
  const fields=loadFields();
  const hero=document.getElementById('rotationHero');
  const list=document.getElementById('rotationList');
  if(!fields.length){hero.innerHTML='<div class="rh-label">No fields yet</div><div class="rh-sub">Add fields to see rotation recommendations.</div>';list.innerHTML='';return;}
  const scored=fields.map(f=>{
    const pct=getReadinessPct(f),status=getStatus(f);
    const events=loadEvents().filter(e=>e.fieldId===f.id).sort((a,b)=>b.startDate.localeCompare(a.startDate));
    const last=events[0];
    const restDays=last?Math.max(0,daysSince(last.endDate)):null;
    const daysToReady=last&&restDays<f.restTarget?f.restTarget-restDays:0;
    return{field:f,pct,status,restDays,daysToReady};
  }).sort((a,b)=>b.pct-a.pct);
  const best=scored.find(s=>s.status.cls==='ready'||s.status.cls==='none');
  if(best){
    hero.innerHTML=`<div class="rh-label">Recommended next field</div><div class="rh-name">${best.field.name}</div><div class="rh-sub">${best.field.areaHa.toFixed(1)} ha · ${best.pct}% rest complete · ${cap(best.field.type)}</div>`;
  }else{
    const soonest=scored.filter(s=>s.daysToReady>0).sort((a,b)=>a.daysToReady-b.daysToReady)[0];
    hero.innerHTML=`<div class="rh-label" style="color:#854d0e">No fields ready yet</div><div class="rh-name" style="color:#92400e;font-size:18px">${soonest?soonest.field.name+' ready in '+soonest.daysToReady+' days':'All fields need more rest'}</div><div class="rh-sub">Allow fields to complete their rest period.</div>`;
  }
  list.innerHTML=scored.map(({field,pct,status,restDays,daysToReady})=>{
    const bc=pct>=100?'#22c55e':pct>=60?'#facc15':'#f87171';
    return`<div class="rot-item" onclick="switchTab('map');setTimeout(()=>selectField('${field.id}'),100)">
      <div class="rot-top"><div><div class="rot-name">${field.name}</div><div class="rot-meta">${field.areaHa.toFixed(1)} ha · ${restDays!==null?restDays+'d resting':'never grazed'} · target ${field.restTarget}d</div></div><span class="pill pill-${status.cls}">${status.label}</span></div>
      <div class="prog-wrap"><div class="prog-fill" style="width:${pct}%;background:${bc}"></div></div>
      <div class="prog-labels"><span>Rest: ${pct}%</span><span>${daysToReady>0?'Ready in '+daysToReady+'d':pct>=100?'✓ Ready now':'Grazing'}</span></div>
    </div>`;
  }).join('');
}

// ── REPORTS ───────────────────────────────────────────────────
function renderReports(){
  document.getElementById('reportsPage').innerHTML=`
    <div class="rep-section"><div class="rep-title">PDF Farm Report</div>
      <p style="font-size:12px;color:#6b7280;margin-bottom:12px;line-height:1.6">Generate a printable PDF with field summaries, grazing history, and stocking rates.</p>
      <div class="rep-actions"><button class="rep-btn" onclick="generatePDF()">⬇ Download PDF report</button></div></div>
    <div class="rep-section"><div class="rep-title">Data Export</div>
      <div class="rep-actions">
        <button class="rep-btn" onclick="exportJSON()">⬇ JSON backup</button>
        <button class="rep-btn" onclick="exportGeoJSON()">⬇ GeoJSON fields</button>
        <button class="rep-btn" onclick="exportCSV()">⬇ Events CSV</button>
        <button class="rep-btn" onclick="exportSensorCSV()">⬇ Sensor CSV</button>
      </div></div>
    <div class="rep-section"><div class="rep-title">DIY Soil Sensor Format</div>
      <p style="font-size:12px;color:#6b7280;margin-bottom:8px;line-height:1.6">Your Arduino / Raspberry Pi sensor can push data in this JSON format:</p>
      <div class="sensor-fmt">{\n  "readings": [\n    {\n      "id": "reading-unique-id",\n      "fieldId": "your-field-id",\n      "date": "2026-03-18",\n      "time": "08:30",\n      "moisture_pct": 42.5,\n      "depth_cm": 20,\n      "sensor_id": "sensor-01",\n      "notes": "after rain"\n    }\n  ]\n}</div>
      <p style="font-size:11px;color:#9ca3af;margin-top:8px">Import via: Export &amp; Backup → Import sensor JSON</p></div>
    <div class="rep-section"><div class="rep-title">Interoperability</div>
      <p style="font-size:12px;color:#6b7280;line-height:1.7">
        GrazingTrack uses open standards — your data is never locked in.<br>
        • <strong>GeoJSON</strong> — field boundaries open in QGIS, ArcGIS, Google Earth<br>
        • <strong>CSV</strong> — events open in Excel, LibreOffice, Google Sheets<br>
        • <strong>JSON backup</strong> — full restore to any GrazingTrack instance<br>
        • <strong>Sensor JSON</strong> — open format for DIY soil monitoring kits
      </p></div>`;
}

// ── PDF ───────────────────────────────────────────────────────
function generatePDF(){
  if(typeof window.jspdf==='undefined'){alert('PDF library loading, try again in a moment.');return;}
  const{jsPDF}=window.jspdf;const doc=new jsPDF();
  const fields=loadFields(),events=loadEvents();
  
  // Header
  doc.setFillColor(45,106,79);doc.rect(0,0,210,24,'F');
  doc.setTextColor(255,255,255);doc.setFontSize(18);doc.setFont('helvetica','bold');
  doc.text('GrazingTrack — Monthly Report',14,16);
  doc.setFontSize(9);doc.setFont('helvetica','normal');doc.text(`Generated: ${new Date().toLocaleDateString()}`,140,16);
  
  // Calculate monthly grazing days per field
  const monthlyData = {};
  const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  
  // Initialize data structure
  fields.forEach(f => {
    monthlyData[f.id] = {name: f.name, months: {}};
    monthNames.forEach(m => monthlyData[f.id].months[m] = 0);
  });
  
  // Calculate days per month for each field
  events.forEach(e => {
    if (!monthlyData[e.fieldId]) return;
    const start = new Date(e.startDate);
    const end = new Date(e.endDate);
    
    // Iterate through each day of the event
    let current = new Date(start);
    while (current <= end) {
      const monthName = monthNames[current.getMonth()];
      monthlyData[e.fieldId].months[monthName]++;
      current.setDate(current.getDate() + 1);
    }
  });
  
  // Generate table
  let y = 34;
  doc.setTextColor(0,0,0);
  doc.setFontSize(13);doc.setFont('helvetica','bold');
  doc.text('Monthly Grazing Days',14,y);y+=8;
  
  // Table dimensions
  const colWidth = 15;
  const rowHeight = 8;
  const startX = 14;
  const headerCols = monthNames.slice(0, 12); // All 12 months
  
  // Render multiple pages if needed (3 months per page)
  const monthsPerPage = 6;
  let pageCount = Math.ceil(12 / monthsPerPage);
  
  for (let page = 0; page < pageCount; page++) {
    if (page > 0) { doc.addPage(); y = 20; }
    
    const startMonth = page * monthsPerPage;
    const endMonth = Math.min(startMonth + monthsPerPage, 12);
    const displayMonths = monthNames.slice(startMonth, endMonth);
    
    // Header row - Month names
    doc.setFillColor(45,106,79);
    doc.rect(startX, y, 40, rowHeight, 'F'); // Field name column
    doc.setTextColor(255,255,255);
    doc.setFontSize(9);doc.setFont('helvetica','bold');
    doc.text('Field', startX + 2, y + 5.5);
    
    displayMonths.forEach((month, i) => {
      const x = startX + 40 + (i * colWidth);
      doc.setFillColor(45,106,79);
      doc.rect(x, y, colWidth, rowHeight, 'F');
      doc.setTextColor(255,255,255);
      doc.text(month.substring(0,3), x + 2, y + 5.5);
    });
    
    y += rowHeight;
    
    // Data rows
    doc.setFont('helvetica','normal');
    fields.forEach((field, idx) => {
      if (y > 270) { doc.addPage(); y = 20; }
      
      // Alternate row colors
      if (idx % 2 === 0) {
        doc.setFillColor(245,245,245);
        doc.rect(startX, y, 40 + (displayMonths.length * colWidth), rowHeight, 'F');
      }
      
      // Field name
      doc.setFillColor(255,255,255);
      doc.rect(startX, y, 40, rowHeight, 'S');
      doc.setTextColor(0,0,0);
      doc.setFontSize(8);
      let name = field.name;
      if (name.length > 18) name = name.slice(0, 15) + '…';
      doc.text(name, startX + 2, y + 5.5);
      
      // Monthly values
      displayMonths.forEach((month, i) => {
        const x = startX + 40 + (i * colWidth);
        doc.rect(x, y, colWidth, rowHeight, 'S');
        const days = monthlyData[field.id].months[month];
        if (days > 0) {
          doc.setFontSize(8);
          doc.text(`${days} d`, x + 2, y + 5.5);
        }
      });
      
      y += rowHeight;
    });
    
    y += 10;
  }
  
  // Footer
  doc.setFontSize(7);doc.setTextColor(150,150,150);
  doc.text('GrazingTrack — Free & Open Source — MIT License',14,290);
  doc.save(`grazingtrack-monthly-${todayStr()}.pdf`);
  setStatus('PDF downloaded — monthly grazing days by field');
}

// ── EXPORT / IMPORT ──────────────────────────────────────────
function exportJSON(){download('grazingtrack-backup.json',JSON.stringify({version:DB_VERSION,exportedAt:new Date().toISOString(),fields:loadFields(),events:loadEvents(),moisture:loadMoisture()},null,2),'application/json');}
function exportGeoJSON(){
  const fc={type:'FeatureCollection',features:loadFields().map(f=>({type:'Feature',properties:{id:f.id,name:f.name,type:f.type,area_ha:f.areaHa,rest_target_days:f.restTarget,max_au_per_ha:f.maxAUperHa||null,color:f.color},geometry:f.geometry}))};
  download('grazingtrack-fields.geojson',JSON.stringify(fc,null,2),'application/geo+json');
}
function exportCSV(){
  const fields=loadFields(),events=loadEvents();
  const rows=[['Field','Start date','End date','Days','Animal type','Count','AU/ha','Notes']];
  events.sort((a,b)=>a.startDate.localeCompare(b.startDate)).forEach(e=>{
    const f=fields.find(x=>x.id===e.fieldId);
    const auHa=f?(e.animalCount/f.areaHa).toFixed(2):'';
    rows.push([f?f.name:'Unknown',e.startDate,e.endDate,daysBetween(e.startDate,e.endDate),e.animalType,e.animalCount,auHa,`"${(e.notes||'').replace(/"/g,'""')}"`]);
  });
  download('grazingtrack-events.csv',rows.map(r=>r.join(',')).join('\n'),'text/csv');
}
function exportSensorCSV(){
  const fields=loadFields(),readings=loadMoisture();
  const rows=[['Field','Date','Time','Moisture %','Depth cm','Sensor ID','Notes']];
  readings.sort((a,b)=>a.date.localeCompare(b.date)).forEach(r=>{
    const f=fields.find(x=>x.id===r.fieldId);
    rows.push([f?f.name:'Unknown',r.date,r.time||'',r.moisture_pct,r.depth_cm||'',r.sensor_id||'',`"${(r.notes||'').replace(/"/g,'""')}"`]);
  });
  download('grazingtrack-moisture.csv',rows.map(r=>r.join(',')).join('\n'),'text/csv');
}
function importJSON(event){
  const file=event.target.files[0];if(!file)return;
  const reader=new FileReader();
  reader.onload=e=>{
    try{
      const data=JSON.parse(e.target.result);
      if(!Array.isArray(data.fields)||!Array.isArray(data.events))throw new Error();
      if(!confirm(`Import ${data.fields.length} fields, ${data.events.length} events, ${(data.moisture||[]).length} moisture readings?\nThis replaces all current data.`))return;
      saveFields(data.fields);saveEvents(data.events);saveMoisture(data.moisture||[]);
      colorIdx=data.fields.length%COLORS.length;
      drawnItems.clearLayers();restoreFieldsOnMap();renderFieldList();updateStats();updateStorageBar();deselectField();
      closeModal('modalExport');setStatus(`Imported ${data.fields.length} fields.`);
    }catch(err){alert('Invalid backup file.');}
  };
  reader.readAsText(file);event.target.value='';
}
function clearAllData(){
  if(!confirm('Delete ALL data? Export a backup first!\nThis cannot be undone.'))return;
  ['gt_fields','gt_events','gt_moisture'].forEach(k=>localStorage.removeItem(k));
  drawnItems.clearLayers();colorIdx=0;
  renderFieldList();updateStats();updateStorageBar();deselectField();
  closeModal('modalExport');setStatus('All data cleared.');
}
function download(filename,content,type){
  const a=document.createElement('a');
  a.href=URL.createObjectURL(new Blob([content],{type}));
  a.download=filename;a.click();URL.revokeObjectURL(a.href);
}

// ── MODAL HELPERS ─────────────────────────────────────────────
function openModal(id){document.getElementById(id).style.display='flex';}
function closeModal(id){document.getElementById(id).style.display='none';}
document.querySelectorAll('.overlay').forEach(el=>{
  el.addEventListener('click',e=>{
    if(e.target===el){el.style.display='none';if(el.id==='modalName')cancelDraw();if(el.id==='modalAutoSplit')asDestroyMap();}
  });
});
document.addEventListener('keydown',e=>{
  if(e.key==='Escape'){
    document.querySelectorAll('.overlay').forEach(el=>el.style.display='none');
    if(currentTool==='draw')cancelDraw();asDestroyMap();
  }
});

// ── PWA ───────────────────────────────────────────────────────
if('serviceWorker'in navigator){navigator.serviceWorker.register('/sw.js').catch(()=>{});}
let deferredInstall=null;
window.addEventListener('beforeinstallprompt',e=>{
  e.preventDefault();deferredInstall=e;
  const b=document.getElementById('installBanner');if(b)b.classList.add('show');
});
function installApp(){
  if(!deferredInstall)return;
  deferredInstall.prompt();
  deferredInstall.userChoice.then(()=>{deferredInstall=null;const b=document.getElementById('installBanner');if(b)b.classList.remove('show');});
}

// ── UTILITIES ─────────────────────────────────────────────────
function uid(){if(typeof crypto!=='undefined'&&crypto.randomUUID)return crypto.randomUUID();return Date.now().toString(36)+Math.random().toString(36).slice(2);}
function todayStr(){return new Date().toISOString().slice(0,10);}
function addDays(d,n){const dt=new Date(d);dt.setDate(dt.getDate()+n);return dt.toISOString().slice(0,10);}
function daysBetween(a,b){return Math.max(0,Math.round((new Date(b)-new Date(a))/86400000));}
function daysSince(d){return daysBetween(d,todayStr());}
function fmtDate(s){const[y,m,d]=s.split('-');return`${d}/${m}/${y}`;}
function cap(s){return s.charAt(0).toUpperCase()+s.slice(1);}
function calcAreaHa(geometry){
  if(geometry.type!=='Polygon')return 0;
  const coords=geometry.coordinates[0],R=6371000;let area=0;
  for(let i=0;i<coords.length-1;i++){
    const[lng1,lat1]=coords[i],[lng2,lat2]=coords[i+1];
    const x1=lng1*Math.PI/180*R*Math.cos(lat1*Math.PI/180),y1=lat1*Math.PI/180*R;
    const x2=lng2*Math.PI/180*R*Math.cos(lat2*Math.PI/180),y2=lat2*Math.PI/180*R;
    area+=x1*y2-x2*y1;
  }
  return Math.abs(area/2)/10000;
}

// ── BOOT ──────────────────────────────────────────────────────
initMap();
loadFarmConfig();
setTimeout(checkFirstRun,400);

function loadFarmConfig(){
  try{
    const cfg=JSON.parse(localStorage.getItem('gt_config')||'{}');
    if(cfg.farmName){const el=document.getElementById('farmNameDisplay');if(el)el.textContent=cfg.farmName;}
    if(cfg.lat&&cfg.lng&&map)map.setView([cfg.lat,cfg.lng],14);
    if(cfg.cycle==='daynight')localStorage.setItem('gt_daynight','1');
    if(cfg.groups&&cfg.groups.length)window._animalGroups=cfg.groups;
  }catch(e){}
}