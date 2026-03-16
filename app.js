// ============================================================
//  GrazingTrack — app.js  v2.0
//  Improvements: live area while drawing, undo vertex,
//  edit/reshape fields, storage usage, integrity checks,
//  versioning, auto-backup warning.
// ============================================================

const DB_VERSION = 2;

// ── STORAGE ───────────────────────────────────────────────────
function loadFields() {
    try {
        const raw = localStorage.getItem('gt_fields');
        if (!raw) return [];
        const data = JSON.parse(raw);
        return Array.isArray(data) ? data : [];
    } catch (e) {
        console.warn('gt_fields corrupted, resetting.', e);
        localStorage.removeItem('gt_fields');
        return [];
    }
}

function loadEvents() {
    try {
        const raw = localStorage.getItem('gt_events');
        if (!raw) return [];
        const data = JSON.parse(raw);
        return Array.isArray(data) ? data : [];
    } catch (e) {
        console.warn('gt_events corrupted, resetting.', e);
        localStorage.removeItem('gt_events');
        return [];
    }
}

function saveFields(fields) {
    try {
        localStorage.setItem('gt_fields', JSON.stringify(fields));
        updateStorageBar();
        checkStorageWarning();
    } catch (e) {
        if (e.name === 'QuotaExceededError') {
            alert('Storage is full! Please export a backup and delete old data.');
        }
    }
}

function saveEvents(events) {
    try {
        localStorage.setItem('gt_events', JSON.stringify(events));
        updateStorageBar();
        checkStorageWarning();
    } catch (e) {
        if (e.name === 'QuotaExceededError') {
            alert('Storage is full! Please export a backup and delete old data.');
        }
    }
}

// ── STORAGE USAGE ─────────────────────────────────────────────
function getStorageUsage() {
    let total = 0;
    for (const key of['gt_fields', 'gt_events']) {
        const val = localStorage.getItem(key);
        if (val) total += val.length * 2; // UTF-16 = 2 bytes per char
    }
    const maxBytes = 5 * 1024 * 1024; // 5MB typical localStorage limit
    return { usedBytes: total, maxBytes, pct: Math.min(100, (total / maxBytes) * 100) };
}

function updateStorageBar() {
    const bar = document.getElementById('storageBar');
    const lbl = document.getElementById('storageLabel');
    if (!bar || !lbl) return;
    const { usedBytes, maxBytes, pct } = getStorageUsage();
    bar.style.width = pct.toFixed(1) + '%';
    bar.style.background = pct > 80 ? '#f87171' : pct > 50 ? '#facc15' : '#4ade80';
    const usedKB = (usedBytes / 1024).toFixed(1);
    const maxKB = (maxBytes / 1024).toFixed(0);
    lbl.textContent = `Storage: ${usedKB} KB / ${maxKB} KB`;
}

function checkStorageWarning() {
    const { pct } = getStorageUsage();
    if (pct > 80) {
        const warned = sessionStorage.getItem('gt_storage_warned');
        if (!warned) {
            sessionStorage.setItem('gt_storage_warned', '1');
            alert(`Storage is ${pct.toFixed(0)}% full. Consider exporting a backup via Export / Backup.`);
        }
    }
}

// ── COLORS ────────────────────────────────────────────────────
const COLORS = [
    '#2d6a4f', '#52b788', '#40916c', '#74c69d', '#1b4332',
    '#34a0a4', '#0077b6', '#023e8a', '#7b2d8b', '#c77dff'
];
let colorIdx = 0;

function nextColor() { return COLORS[colorIdx++ % COLORS.length]; }

// ── MAP STATE ─────────────────────────────────────────────────
let map, drawnItems, drawControl;
let pendingLayer = null;
let selectedFieldId = null;
let currentTool = 'select';
let drawingHandler = null; // active L.Draw.Polygon instance
let liveMarker = null; // tooltip showing live area while drawing
let vertexCount = 0;

// ── MAP INIT ──────────────────────────────────────────────────
function initMap() {
    map = L.map('map', { zoomControl: false }).setView([-29.0, 25.0], 6);

    const osm = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© <a href="https://openstreetmap.org">OpenStreetMap</a> contributors',
        maxZoom: 19
    });

    const satellite = L.tileLayer(
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { attribution: 'Tiles © Esri', maxZoom: 19 }
    );

    const hybrid = L.layerGroup([
        L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19 }),
        L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, opacity: 0.8 })
    ]);

    satellite.addTo(map);

    L.control.layers({
        'Satellite': satellite,
        'Satellite + Labels': hybrid,
        'Street map': osm
    }, {}, { position: 'topright' }).addTo(map);

    L.control.zoom({ position: 'topright' }).addTo(map);

    drawnItems = new L.FeatureGroup().addTo(map);

    drawControl = new L.Control.Draw({
        position: 'topright',
        draw: {
            polygon: {
                allowIntersection: false,
                showArea: true,
                shapeOptions: {
                    color: '#52b788',
                    fillColor: '#52b788',
                    fillOpacity: 0.25,
                    weight: 2.5,
                    dashArray: '6 4'
                },
                icon: new L.DivIcon({
                    iconSize: new L.Point(10, 10),
                    className: 'leaflet-div-icon leaflet-editing-icon'
                })
            },
            rectangle: false,
            circle: false,
            circlemarker: false,
            marker: false,
            polyline: false
        },
        edit: { featureGroup: drawnItems, remove: false }
    });

    // Polygon finished
    map.on(L.Draw.Event.CREATED, (e) => {
        clearLiveArea();
        pendingLayer = e.layer;
        drawnItems.addLayer(pendingLayer);
        openModal('modalName');
        setTimeout(() => document.getElementById('inName').focus(), 80);
    });

    // Track vertices while drawing for live area
    map.on('draw:drawvertex', (e) => {
        const layers = e.layers;
        let pts = [];
        layers.eachLayer(l => pts.push(l.getLatLng()));
        vertexCount = pts.length;
        updateDrawingHUD(pts);
        updateUndoBtn();
    });

    // Live cursor movement — update area estimate
    map.on('mousemove', (e) => {
        if (currentTool !== 'draw' || vertexCount < 2) return;
        // We can't easily get the in-progress latlngs from Leaflet.draw,
        // so just update the vertex count display in status
        setStatus(`Drawing field — ${vertexCount} point${vertexCount !== 1 ? 's' : ''} placed. Double-click to finish.`);
    });

    // Edited existing field shapes
    map.on(L.Draw.Event.EDITED, (e) => {
        e.layers.eachLayer(layer => {
            const fields = loadFields();
            const field = fields.find(f => f.id === layer.options.fieldId);
            if (!field) return;
            field.geometry = layer.toGeoJSON().geometry;
            field.areaHa = calcAreaHa(field.geometry);
            saveFields(fields);
            // Update tooltip
            layer.setTooltipContent(`${field.name}\n${field.areaHa.toFixed(1)} ha`);
        });
        renderFieldList();
        updateStats();
        if (selectedFieldId) selectField(selectedFieldId);
        setStatus('Field shapes updated and saved.');
        setTool('select');
    });

    map.on(L.Draw.Event.EDITSTOP, () => {
        setTool('select');
    });

    // Draw cancelled
    map.on('draw:deletestop', () => setTool('select'));

    map.on('click', () => {
        if (currentTool === 'select') deselectField();
    });

    restoreFieldsOnMap();
    renderFieldList();
    updateStats();
    updateStorageBar();
}

// ── DRAWING HUD ───────────────────────────────────────────────
function updateDrawingHUD(pts) {
    if (pts.length < 3) {
        setStatus(`Drawing field — ${pts.length} point${pts.length !== 1 ? 's' : ''} placed. Need at least 3.`);
        return;
    }
    // Estimate area from current points (close the polygon)
    const closed = [...pts, pts[0]];
    const geo = {
        type: 'Polygon',
        coordinates: [closed.map(p => [p.lng, p.lat])]
    };
    const area = calcAreaHa(geo);
    setStatus(`Drawing — ${pts.length} points · ~${area.toFixed(1)} ha so far. Double-click to finish.`);
}

function clearLiveArea() {
    vertexCount = 0;
    if (liveMarker) {
        map.removeLayer(liveMarker);
        liveMarker = null;
    }
    updateUndoBtn();
}

function updateUndoBtn() {
    const btn = document.getElementById('btnUndo');
    if (!btn) return;
    btn.style.display = (currentTool === 'draw' && vertexCount > 0) ? 'flex' : 'none';
}

function undoLastVertex() {
    // Trigger Leaflet.draw's built-in undo (Delete key)
    document.dispatchEvent(new KeyboardEvent('keydown', { keyCode: 90, ctrlKey: true, bubbles: true }));
    if (vertexCount > 0) vertexCount--;
    updateUndoBtn();
}

// ── TOOL MANAGEMENT ───────────────────────────────────────────
function setTool(tool) {
    currentTool = tool;
    document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));

    const undoBtn = document.getElementById('btnUndo');
    const editBtn = document.getElementById('btnEdit');
    const deleteBtn = document.getElementById('btnDelete');

    if (tool === 'draw') {
        document.getElementById('btnDraw').classList.add('active');
        vertexCount = 0;
        if (undoBtn) undoBtn.style.display = 'none';
        map.addControl(drawControl);
        setTimeout(() => {
            const btn = document.querySelector('.leaflet-draw-draw-polygon');
            if (btn) btn.click();
        }, 60);
        setStatus('Click to place corners. Double-click to finish the field boundary.');
        document.getElementById('toolHint').textContent = 'Click to add points. Press ↩ Undo to remove the last point. Double-click to close.';
        if (editBtn) editBtn.style.display = 'none';

    } else if (tool === 'edit') {
        document.getElementById('btnEdit').classList.add('active');
        // Activate Leaflet.draw edit mode
        try { map.addControl(drawControl); } catch (e) {}
        setTimeout(() => {
            const btn = document.querySelector('.leaflet-draw-edit-edit');
            if (btn) btn.click();
        }, 60);
        setStatus('Drag the white handles to reshape a field. Click Save when done.');
        document.getElementById('toolHint').textContent = 'Drag corner handles to reshape. Click the save button in the toolbar when finished.';
        if (undoBtn) undoBtn.style.display = 'none';

    } else {
        // select
        document.getElementById('btnSelect').classList.add('active');
        clearLiveArea();
        try { map.removeControl(drawControl); } catch (e) {}
        setStatus('Select a field or draw a new one.');
        document.getElementById('toolHint').textContent = 'Click a field on the map or in the list to select it.';
        if (undoBtn) undoBtn.style.display = 'none';
        if (editBtn) {
            editBtn.style.display = selectedFieldId ? 'flex' : 'none';
        }
        if (deleteBtn) {
            deleteBtn.style.display = selectedFieldId ? 'flex' : 'none';
        }
    }
}

function setStatus(msg) {
    const el = document.getElementById('statusMsg');
    if (el) el.textContent = msg;
}

// ── FIELD CREATION ────────────────────────────────────────────
function cancelDraw() {
    if (pendingLayer) {
        drawnItems.removeLayer(pendingLayer);
        pendingLayer = null;
    }
    clearLiveArea();
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

    const field = {
        id: uid(),
        name,
        type: document.getElementById('inType').value,
        restTarget: parseInt(document.getElementById('inRest').value) || 42,
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
    clearLiveArea();
    closeModal('modalName');
    setTool('select');
    renderFieldList();
    updateStats();
    selectField(field.id);
    setStatus(`"${name}" saved — ${area.toFixed(1)} ha`);
}

// ── FIELD STYLING ─────────────────────────────────────────────
function styleLayer(layer, field) {
    const color = statusFillColor(field);
    layer.setStyle({ color, fillColor: color, fillOpacity: 0.38, weight: 2.5 });
}

function bindFieldLayer(layer, field) {
    layer.options.fieldId = field.id;
    layer.off('click');
    layer.on('click', (e) => {
        L.DomEvent.stopPropagation(e);
        selectField(field.id);
    });
    layer.unbindTooltip();
    layer.bindTooltip(
        `<strong>${field.name}</strong><br>${field.areaHa.toFixed(1)} ha`, { permanent: true, direction: 'center', className: 'field-label' }
    );
}

// ── FIELD DELETION ────────────────────────────────────────────
function deleteSelected() {
    if (!selectedFieldId) return;
    const fields = loadFields();
    const field = fields.find(f => f.id === selectedFieldId);
    if (!field) return;
    if (!confirm(`Delete "${field.name}"?\nThis will also delete all its grazing events.`)) return;

    drawnItems.eachLayer(layer => {
        if (layer.options.fieldId === selectedFieldId) drawnItems.removeLayer(layer);
    });

    saveFields(fields.filter(f => f.id !== selectedFieldId));
    saveEvents(loadEvents().filter(e => e.fieldId !== selectedFieldId));

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

    document.querySelectorAll('.field-item').forEach(el =>
        el.classList.toggle('selected', el.dataset.id === fieldId)
    );

    const events = loadEvents().filter(e => e.fieldId === fieldId)
        .sort((a, b) => b.endDate.localeCompare(a.endDate));
    const last = events[0];
    const restDays = last ? daysSince(last.endDate) : null;
    const status = getStatus(field);

    document.getElementById('detailSection').style.display = 'block';
    document.getElementById('fieldDetail').innerHTML = `
    <div class="detail-row"><span class="detail-key">Name</span><span class="detail-val">${field.name}</span></div>
    <div class="detail-row"><span class="detail-key">Type</span><span class="detail-val">${cap(field.type)}</span></div>
    <div class="detail-row"><span class="detail-key">Area</span><span class="detail-val">${field.areaHa.toFixed(2)} ha</span></div>
    <div class="detail-row"><span class="detail-key">Status</span><span class="detail-val">
      <span class="pill pill-${status.cls}">${status.label}</span>
    </span></div>
    <div class="detail-row"><span class="detail-key">Rest target</span><span class="detail-val">${field.restTarget} days</span></div>
    <div class="detail-row"><span class="detail-key">Days resting</span><span class="detail-val">${restDays !== null ? restDays + ' days' : 'No events yet'}</span></div>
    <div class="detail-row"><span class="detail-key">Total events</span><span class="detail-val">${events.length}</span></div>
    <div class="detail-actions">
      <button class="detail-btn" onclick="openHistoryModal('${fieldId}')">History</button>
      <button class="detail-btn primary" onclick="openGrazingModal('${fieldId}')">+ Log grazing</button>
    </div>`;

    document.getElementById('btnDelete').style.display = 'flex';
    const editBtn = document.getElementById('btnEdit');
    if (editBtn) editBtn.style.display = 'flex';

    // Zoom to field
    drawnItems.eachLayer(layer => {
        if (layer.options.fieldId === fieldId) {
            map.fitBounds(layer.getBounds(), { padding: [60, 60], maxZoom: 17 });
        }
    });

    setStatus(`${field.name} — ${field.areaHa.toFixed(2)} ha`);
}

function deselectField() {
    selectedFieldId = null;
    document.querySelectorAll('.field-item').forEach(el => el.classList.remove('selected'));
    document.getElementById('detailSection').style.display = 'none';
    document.getElementById('btnDelete').style.display = 'none';
    const editBtn = document.getElementById('btnEdit');
    if (editBtn) editBtn.style.display = 'none';
}

// ── GRAZING EVENTS ────────────────────────────────────────────
function openGrazingModal(preFieldId) {
    const fields = loadFields();
    if (fields.length === 0) { alert('Add a field first before logging a grazing event.'); return; }

    document.getElementById('gField').innerHTML = fields.map(f =>
        `<option value="${f.id}" ${f.id === preFieldId ? 'selected' : ''}>${f.name}</option>`
    ).join('');

    const today = todayStr();
    document.getElementById('gStart').value = today;
    document.getElementById('gEnd').value = addDays(today, 7);
    document.getElementById('gAnimalType').value = 'cattle';
    document.getElementById('gCount').value = '';
    document.getElementById('gNotes').value = '';
    openModal('modalGrazing');
}

function saveGrazingEvent() {
    const fieldId = document.getElementById('gField').value;
    const start = document.getElementById('gStart').value;
    const end = document.getElementById('gEnd').value;
    const type = document.getElementById('gAnimalType').value;
    const count = parseInt(document.getElementById('gCount').value);
    const notes = document.getElementById('gNotes').value.trim();

    if (!start || !end) { alert('Please enter start and end dates.'); return; }
    if (end < start) { alert('End date must be on or after the start date.'); return; }
    if (!count || count < 1) { alert('Please enter the number of animals.'); return; }

    const events = loadEvents();
    events.push({
        id: uid(),
        fieldId,
        startDate: start,
        endDate: end,
        animalType: type,
        animalCount: count,
        notes,
        loggedAt: new Date().toISOString()
    });
    saveEvents(events);

    closeModal('modalGrazing');
    refreshMapColors();
    renderFieldList();
    updateStats();
    if (selectedFieldId === fieldId) selectField(fieldId);

    const field = loadFields().find(f => f.id === fieldId);
    setStatus(`Logged: ${count} ${type} on "${field.name}" — ${daysBetween(start, end)} days`);
}

// ── HISTORY MODAL ─────────────────────────────────────────────
let historyFieldId = null;

function openHistoryModal(fieldId) {
    historyFieldId = fieldId;
    const field = loadFields().find(f => f.id === fieldId);
    const events = loadEvents().filter(e => e.fieldId === fieldId)
        .sort((a, b) => b.startDate.localeCompare(a.startDate));

    document.getElementById('historyTitle').textContent = `${field.name} — Grazing History`;
    document.getElementById('historyBody').innerHTML = events.length === 0 ?
        `<p class="no-history">No grazing events logged yet.</p>` :
        `<table class="history-table">
        <thead><tr><th>Start</th><th>End</th><th>Days</th><th>Type</th><th>Animals</th><th>AU/ha</th><th>Notes</th><th></th></tr></thead>
        <tbody>${events.map(e => {
          const days  = daysBetween(e.startDate, e.endDate);
          const auHa  = field.areaHa > 0 ? (e.animalCount / field.areaHa).toFixed(1) : '—';
          return `<tr>
            <td>${fmtDate(e.startDate)}</td>
            <td>${fmtDate(e.endDate)}</td>
            <td>${days}</td>
            <td>${cap(e.animalType)}</td>
            <td>${e.animalCount}</td>
            <td>${auHa}</td>
            <td style="color:#6b7280;font-size:12px;max-width:120px">${e.notes || '—'}</td>
            <td><button class="delete-event-btn" onclick="deleteEvent('${e.id}','${fieldId}')">✕</button></td>
          </tr>`;
        }).join('')}
        </tbody>
      </table>`;
  openModal('modalHistory');
}

function deleteEvent(eventId, fieldId) {
  if (!confirm('Delete this grazing event?')) return;
  saveEvents(loadEvents().filter(e => e.id !== eventId));
  refreshMapColors();
  renderFieldList();
  updateStats();
  openHistoryModal(fieldId);
  if (selectedFieldId === fieldId) selectField(fieldId);
}

function historyAddEvent() {
  closeModal('modalHistory');
  openGrazingModal(historyFieldId);
}

// ── FIELD LIST ────────────────────────────────────────────────
function renderFieldList() {
  const fields = loadFields();
  document.getElementById('fieldCount').textContent = fields.length;
  const el = document.getElementById('fieldList');

  if (fields.length === 0) {
    el.innerHTML = '<p class="empty-msg">No fields yet. Use ⬡ Draw Field to add your first paddock.</p>';
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

  if (selectedFieldId) {
    document.querySelectorAll('.field-item').forEach(el =>
      el.classList.toggle('selected', el.dataset.id === selectedFieldId)
    );
  }
}

// ── STATS BAR ─────────────────────────────────────────────────
function updateStats() {
  const fields   = loadFields();
  const totalHa  = fields.reduce((s,f) => s + f.areaHa, 0);
  const statuses = fields.map(f => getStatus(f));
  const grazing  = statuses.filter(s => s.cls === 'grazing').length;
  const ready    = statuses.filter(s => s.cls === 'ready').length;

  document.getElementById('sFields').textContent  = fields.length;
  document.getElementById('sHa').textContent      = totalHa.toFixed(1) + ' ha';
  document.getElementById('sGrazing').textContent = grazing > 0 ? grazing + ' field' + (grazing > 1 ? 's' : '') : '—';
  document.getElementById('sReady').textContent   = ready;
}

// ── STATUS LOGIC ──────────────────────────────────────────────
function getStatus(field) {
  const events = loadEvents()
    .filter(e => e.fieldId === field.id)
    .sort((a,b) => b.startDate.localeCompare(a.startDate));

  if (events.length === 0) return { label: 'Never grazed', cls: 'none' };

  const latest = events[0];
  const today  = todayStr();

  if (latest.startDate <= today && latest.endDate >= today)
    return { label: 'Grazing now', cls: 'grazing' };

  const rest = daysSince(latest.endDate);
  if (rest < 0)                         return { label: 'Planned',      cls: 'resting' };
  if (rest >= field.restTarget)         return { label: 'Ready',        cls: 'ready'   };
  if (rest >= field.restTarget * 0.6)   return { label: `${rest}d rest`,cls: 'resting' };
  return { label: 'Needs rest', cls: 'danger' };
}

function statusFillColor(field) {
  const s = getStatus(field);
  if (s.cls === 'grazing') return '#22c55e';
  if (s.cls === 'ready')   return '#4ade80';
  if (s.cls === 'resting') return '#facc15';
  if (s.cls === 'danger')  return '#f87171';
  return field.color;
}

// ── MAP RESTORE & REFRESH ─────────────────────────────────────
function restoreFieldsOnMap() {
  const fields = loadFields();
  if (fields.length === 0) return;

  const bounds = [];
  fields.forEach(field => {
    const layer = L.geoJSON(field.geometry).getLayers()[0];
    styleLayer(layer, field);
    bindFieldLayer(layer, field);
    drawnItems.addLayer(layer);
    layer.getLatLngs()[0].forEach(ll => bounds.push(ll));
  });

  if (bounds.length > 0) {
    map.fitBounds(L.latLngBounds(bounds), { padding: [50, 50], maxZoom: 16 });
  }
}

function refreshMapColors() {
  const fields = loadFields();
  drawnItems.eachLayer(layer => {
    if (!layer.options.fieldId) return;
    const field = fields.find(f => f.id === layer.options.fieldId);
    if (!field) return;
    styleLayer(layer, field);
  });
}

// ── EXPORT / IMPORT ───────────────────────────────────────────
function exportJSON() {
  const data = {
    version: DB_VERSION,
    exportedAt: new Date().toISOString(),
    fields: loadFields(),
    events: loadEvents()
  };
  download('grazingtrack-backup.json', JSON.stringify(data, null, 2), 'application/json');
}

function exportCSV() {
  const fields = loadFields();
  const events = loadEvents();
  const rows   = [['Field','Start date','End date','Days','Animal type','Count','AU/ha','Notes']];
  events.sort((a,b) => a.startDate.localeCompare(b.startDate)).forEach(e => {
    const field = fields.find(f => f.id === e.fieldId);
    const auHa  = field && field.areaHa > 0 ? (e.animalCount / field.areaHa).toFixed(2) : '';
    rows.push([
      field ? field.name : 'Unknown',
      e.startDate, e.endDate,
      daysBetween(e.startDate, e.endDate),
      e.animalType, e.animalCount, auHa,
      '"' + (e.notes || '').replace(/"/g, '""') + '"'
    ]);
  });
  download('grazingtrack-events.csv', rows.map(r => r.join(',')).join('\n'), 'text/csv');
}

function importJSON(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = JSON.parse(e.target.result);
      if (!Array.isArray(data.fields) || !Array.isArray(data.events))
        throw new Error('Invalid structure');
      if (!confirm(`Import ${data.fields.length} fields and ${data.events.length} events?\nThis will replace your current data.`)) return;
      saveFields(data.fields);
      saveEvents(data.events);
      colorIdx = data.fields.length % COLORS.length;
      drawnItems.clearLayers();
      restoreFieldsOnMap();
      renderFieldList();
      updateStats();
      updateStorageBar();
      deselectField();
      closeModal('modalExport');
      setStatus(`Imported ${data.fields.length} fields and ${data.events.length} events.`);
    } catch(err) {
      alert('Could not read file. Please use a valid GrazingTrack JSON backup.');
    }
  };
  reader.readAsText(file);
  event.target.value = '';
}

function clearAllData() {
  if (!confirm('Delete ALL fields and events? This cannot be undone.\nExport a backup first if you want to keep your data.')) return;
  localStorage.removeItem('gt_fields');
  localStorage.removeItem('gt_events');
  drawnItems.clearLayers();
  colorIdx = 0;
  renderFieldList();
  updateStats();
  updateStorageBar();
  deselectField();
  closeModal('modalExport');
  setStatus('All data cleared.');
}

function download(filename, content, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content], { type }));
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

// ── MODAL HELPERS ─────────────────────────────────────────────
function openModal(id)  { document.getElementById(id).style.display = 'flex'; }
function closeModal(id) { document.getElementById(id).style.display = 'none'; }

document.querySelectorAll('.overlay').forEach(el => {
  el.addEventListener('click', (e) => {
    if (e.target === el) {
      el.style.display = 'none';
      if (el.id === 'modalName') cancelDraw();
    }
  });
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    document.querySelectorAll('.overlay').forEach(el => el.style.display = 'none');
    if (currentTool === 'draw') cancelDraw();
  }
});

// ── UTILITIES ─────────────────────────────────────────────────
function uid()        { return Date.now().toString(36) + Math.random().toString(36).slice(2); }
function todayStr()   { return new Date().toISOString().slice(0,10); }
function addDays(d,n) { const dt=new Date(d); dt.setDate(dt.getDate()+n); return dt.toISOString().slice(0,10); }
function daysBetween(a,b) { return Math.max(0, Math.round((new Date(b)-new Date(a))/86400000)); }
function daysSince(d) { return daysBetween(d, todayStr()); }
function fmtDate(s)   { const [y,m,d]=s.split('-'); return `${d}/${m}/${y}`; }
function cap(s)       { return s.charAt(0).toUpperCase()+s.slice(1); }

function calcAreaHa(geometry) {
  if (geometry.type !== 'Polygon') return 0;
  const coords = geometry.coordinates[0];
  const R = 6371000;
  let area = 0;
  for (let i = 0; i < coords.length - 1; i++) {
    const [lng1,lat1] = coords[i];
    const [lng2,lat2] = coords[i+1];
    const x1 = lng1*Math.PI/180*R*Math.cos(lat1*Math.PI/180);
    const y1 = lat1*Math.PI/180*R;
    const x2 = lng2*Math.PI/180*R*Math.cos(lat2*Math.PI/180);
    const y2 = lat2*Math.PI/180*R;
    area += x1*y2 - x2*y1;
  }
  return Math.abs(area/2)/10000;
}

// ── BOOT ──────────────────────────────────────────────────────
initMap()