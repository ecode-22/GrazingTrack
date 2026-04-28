// ============================================================
//  gt-split.js  —  Farm boundary split tool
//
//  Crash fixes in this version:
//   1. querySelector scoped to #asMap so it never clicks the
//      main map's draw button by accident.
//   2. Top-level try/catch in _asRebuildCamps — a Turf error
//      never corrupts the panel or map state.
//   3. MultiPolygon-safe sequential cuts — when a cut produces
//      a MultiPolygon remainder, extract the largest piece so
//      the next turf.intersect call doesn't throw.
//   4. Only ONE Leaflet Draw control at a time — the boundary
//      draw control is removed before the reshape control is
//      added, and restored afterwards.
//   5. Slider debounce (80 ms) so rapid dragging doesn't pile
//      up Turf geometry operations and freeze the browser.
//   6. Safe centroid fallback in _asDrawCampLayers.
//   7. "Redraw boundary" button lets the farmer restart without
//      closing the modal and losing all their work.
// ============================================================
'use strict';

// ── State ─────────────────────────────────────────────────────
const AS = {
    map: null,
    drawn: null,
    drawControl: null, // the boundary-draw control (removed during reshape)
    boundary: null,
    boundaryLayer: null,
    campLayers: [],

    count: 4,
    dir: 'vertical',
    dividers: [{ pos: 0.25, angle: 0 }, { pos: 0.50, angle: 0 }, { pos: 0.75, angle: 0 }],
    colDividers: [0.50],
    rowDividers: [0.50],

    camps: [],

    reshapeIdx: null,
    reshapeGroup: null,
    reshapeControl: null,

    _refreshTimer: null // debounce handle
};

const SPLIT_COLORS = [
    '#2d6a4f', '#52b788', '#40916c', '#74c69d', '#1b4332', '#34a0a4',
    '#0077b6', '#7b2d8b', '#d97706', '#dc2626', '#0891b2', '#059669',
    '#7c3aed', '#db2777', '#b45309', '#374151', '#16a34a', '#ca8a04',
    '#9333ea', '#e11d48'
];

function openAutoSplit() {
    asCampCount = 4;
    asSplitDir = 'grid';
    asCamps = [];
    asBoundaryLayer = null;
    asCampLayers = [];
    openModal('modalAutoSplit');
    setTimeout(initSplitMap, 150);
}

function closeAutoSplit() {
    closeModal('modalAutoSplit');
    destroySplitMap();
}

function initSplitMap() {
    if (asMap) {
        try { asMap.remove(); } catch (e) {}
        asMap = null;
    }

    let center = [-29, 25];
    let zoom = 6;
    const fields = loadFields();
    if (fields.length) {
        const lats = [], lngs = [];
        fields.forEach(f => {
            if (f.geometry && f.geometry.coordinates) {
                f.geometry.coordinates[0].forEach(([lng, lat]) => {
                    lats.push(lat);
                    lngs.push(lng);
                });
            }
        });
        if (lats.length) {
            center = [(Math.min(...lats) + Math.max(...lats)) / 2, (Math.min(...lngs) + Math.max(...lngs)) / 2];
            zoom = 13;
        }
    }

    asMap = L.map('asMap', { zoomControl: true }).setView(center, zoom);
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        attribution: '© Esri', maxZoom: 19
    }).addTo(asMap);
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', {
        maxZoom: 19, opacity: 0.7
    }).addTo(asMap);

    asDrawnGroup = new L.FeatureGroup().addTo(asMap);
    const drawControl = new L.Control.Draw({
        position: 'topright',
        draw: {
            polygon: {
                allowIntersection: false,
                showArea: true,
                shapeOptions: { color: '#2d6a4f', fillColor: '#2d6a4f', fillOpacity: 0.12, weight: 3 }
            },
            polyline: false,
            rectangle: false,
            circle: false,
            circlemarker: false,
            marker: false
        },
        edit: { featureGroup: asDrawnGroup, remove: false }
    });
    AS.map.addControl(AS.drawControl);

    // FIX 1: Scope to #asMap so we never click the main map's draw button.
    setTimeout(() => {
        const mapEl = document.getElementById('asMap');
        if (mapEl) {
            const btn = mapEl.querySelector('.leaflet-draw-draw-polygon');
            if (btn) btn.click();
        }
    }, 300);

    AS.map.on(L.Draw.Event.CREATED, e => {
        if (AS.boundaryLayer) AS.drawn.removeLayer(AS.boundaryLayer);
        _asClearCampLayers();
        AS.boundaryLayer = e.layer;
        AS.boundaryLayer.setStyle({ color: '#2d6a4f', fillColor: '#2d6a4f', fillOpacity: 0.12, weight: 3 });
        AS.drawn.addLayer(AS.boundaryLayer);
        AS.boundary = AS.boundaryLayer.toGeoJSON().geometry;
        _asResetDividers();
        _asRebuildCamps();
        _asDrawCampLayers();
        _asRenderPanel();
    });
}

function _asDestroyMap() {
    if (AS.map) {
        try { AS.map.remove(); } catch (e) {}
        AS.map = null;
    }
    AS.drawn = null;
    AS.boundaryLayer = null;
    AS.drawControl = null;
    AS.campLayers = [];
}

// ── Divider reset ─────────────────────────────────────────────
function _asResetDividers() {
    const n = AS.count;
    AS.dividers = Array.from({ length: n - 1 }, (_, i) => ({ pos: (i + 1) / n, angle: 0 }));
    const cols = Math.ceil(Math.sqrt(n));
    const rows = Math.ceil(n / cols);
    AS.colDividers = Array.from({ length: cols - 1 }, (_, i) => (i + 1) / cols);
    AS.rowDividers = Array.from({ length: rows - 1 }, (_, i) => (i + 1) / rows);
}

// ── Panel renderer ────────────────────────────────────────────
function _asRenderPanel() {
    const panel = document.getElementById('asControlPanel');
    if (!panel) return;

    if (!asBoundaryLayer) {
        panel.innerHTML = `
            <div class="as-welcome">
                <div class="as-welcome-icon">⬡</div>
                <p class="as-welcome-title">Draw your farm boundary</p>
                <p class="as-welcome-sub">Click the polygon tool on the map, trace the outer edge of your farm, then double-click to close.</p>
            </div>`;
        document.getElementById('asSaveBtn').disabled = true;
        return;
    }

    const totalHa = asCamps.reduce((s, c) => s + c.areaHa, 0);
    panel.innerHTML = `
        <div class="as-section">
            <div class="as-section-title">Number of camps</div>
            <div class="as-count-row">
                <button class="as-count-btn" onclick="adjustCampCount(-1)">−</button>
                <span class="as-count-num" id="asCampNum">${asCampCount}</span>
                <button class="as-count-btn" onclick="adjustCampCount(1)">+</button>
            </div>
            <input type="range" class="as-slider" min="1" max="30" value="${asCampCount}" oninput="adjustCampCountSlider(this.value)">
        </div>
        <div class="as-section">
            <div class="as-section-title">Split direction</div>
            <div class="as-dir-row">
                <button class="as-dir-btn${asSplitDir === 'grid' ? ' active' : ''}" onclick="setSplitDir('grid')">⊞ Grid</button>
                <button class="as-dir-btn${asSplitDir === 'vertical' ? ' active' : ''}" onclick="setSplitDir('vertical')">↕ Vertical strips</button>
                <button class="as-dir-btn${asSplitDir === 'horizontal' ? ' active' : ''}" onclick="setSplitDir('horizontal')">↔ Horizontal strips</button>
            </div>
        </div>
        <div class="as-section">
            <div class="as-section-title">Camp names</div>
            <div id="campNamesList">
                ${asCamps.map((c, i) => `
                    <div class="as-name-row">
                        <span class="as-camp-dot" style="background:${c.color}"></span>
                        <input class="as-name-input" type="text" value="${c.name}" data-index="${i}" onchange="updateCampName(${i}, this.value)">
                        <span class="as-size-lbl">${c.areaHa.toFixed(1)} ha</span>
                    </div>
                `).join('')}
            </div>
        </div>
        <div class="as-total-badge">
            ${asCamps.length} camp${asCamps.length !== 1 ? 's' : ''} · ${totalHa.toFixed(1)} ha total
        </div>`;
    document.getElementById('asSaveBtn').disabled = asCamps.length === 0;
}

function adjustCampCount(delta) {
    asCampCount = Math.max(1, Math.min(30, asCampCount + delta));
    document.getElementById('asCampNum').textContent = asCampCount;
    generateCamps();
    renderSplitPanel();
}

function adjustCampCountSlider(val) {
    asCampCount = parseInt(val);
    document.getElementById('asCampNum').textContent = asCampCount;
    generateCamps();
    renderSplitPanel();
}

function setSplitDir(dir) {
    asSplitDir = dir;
    generateCamps();
    renderSplitPanel();
}

function updateCampName(index, name) {
    if (asCamps[index]) asCamps[index].name = name.trim() || `Camp ${index + 1}`;
}

function asOnDivAngle(idx, rawVal) {
    AS.dividers[idx].angle = parseInt(rawVal);
    const aEl = document.getElementById(`as-div-ang-pct-${idx}`);
    const v = parseInt(rawVal);
    if (aEl) aEl.textContent = (v>0?'+':'')+v+'°';
    _asScheduleRefresh();
}

function asOnColDiv(idx, rawVal) {
    AS.colDividers[idx] = parseInt(rawVal)/100;
    const pEl = document.getElementById(`as-cdiv-pct-${idx}`); if(pEl) pEl.textContent = rawVal+'%';
    const prev = document.getElementById(`as-cdiv-${idx-1}`); if(prev) prev.max = parseInt(rawVal)-5;
    const next = document.getElementById(`as-cdiv-${idx+1}`); if(next) next.min = parseInt(rawVal)+5;
    _asScheduleRefresh();
}

function asOnRowDiv(idx, rawVal) {
    AS.rowDividers[idx] = parseInt(rawVal)/100;
    const pEl = document.getElementById(`as-rdiv-pct-${idx}`); if(pEl) pEl.textContent = rawVal+'%';
    const prev = document.getElementById(`as-rdiv-${idx-1}`); if(prev) prev.max = parseInt(rawVal)-5;
    const next = document.getElementById(`as-rdiv-${idx+1}`); if(next) next.min = parseInt(rawVal)+5;
    _asScheduleRefresh();
}

// FIX 5: Debounce — 80ms after the last slider move before recomputing.
function _asScheduleRefresh() {
    if (AS._refreshTimer) clearTimeout(AS._refreshTimer);
    AS._refreshTimer = setTimeout(() => {
        AS._refreshTimer = null;
        _asRebuildAndRefresh();
    }, 80);
}

function _asRebuildAndRefresh() {
    _asRebuildCamps();
    _asClearCampLayers();
    _asDrawCampLayers();
    AS.camps.forEach((c,i) => {
        const el = document.getElementById(`as-size-${i}`);
        if (el) el.textContent = c.areaHa.toFixed(1)+' ha';
    });
    const badge = document.getElementById('asTotalBadge');
    if (badge) {
        const total = AS.camps.reduce((s,c) => s+c.areaHa, 0);
        badge.textContent = `${AS.camps.length} camp${AS.camps.length!==1?'s':''} · ${total.toFixed(1)} ha total`;
    }
    if (AS.camps.length === 0) _asRenderPanel();
    const saveBtn = document.getElementById('asSaveBtn');
    if (saveBtn) saveBtn.disabled = AS.camps.length === 0;
}

// ── Split algorithm ───────────────────────────────────────────
function _asRebuildCamps() {
    if (!AS.boundary) { AS.camps = []; return; }

    // FIX 2: Top-level try/catch — any Turf error leaves camps empty
    // rather than crashing the page or corrupting the UI.
    try {
        const farmPoly = turf.polygon(AS.boundary.coordinates);
        const bbox     = turf.bbox(farmPoly);
        const oldNames = AS.camps.map(c => c.name);
        let polys      = [];

        if (AS.dir === 'grid') {
            const [minLng,minLat,maxLng,maxLat] = bbox;
            const colBreaks = [0,...AS.colDividers,1];
            const rowBreaks = [0,...AS.rowDividers,1];
            let idx = 0;
            outer: for (let r=0; r<rowBreaks.length-1; r++) {
                for (let c=0; c<colBreaks.length-1; c++) {
                    if (idx++ >= AS.count) break outer;
                    const sLng = minLng + colBreaks[c]  *(maxLng-minLng);
                    const eLng = minLng + colBreaks[c+1]*(maxLng-minLng);
                    const sLat = minLat + rowBreaks[r]  *(maxLat-minLat);
                    const eLat = minLat + rowBreaks[r+1]*(maxLat-minLat);
                    const ix = turf.intersect(farmPoly, turf.bboxPolygon([sLng,sLat,eLng,eLat]));
                    if (ix) polys.push(ix);
                }
            }
        } else {
            let remaining = farmPoly;
            for (const div of AS.dividers) {
                const line = _asDividerLine(div, bbox);
                const cuts = _asCutWithLine(remaining, line);
                if (cuts.length === 2) {
                    const ci = AS.dir==='vertical' ? 0 : 1;
                    const c0 = turf.centroid(cuts[0]).geometry.coordinates[ci];
                    const c1 = turf.centroid(cuts[1]).geometry.coordinates[ci];
                    const [before, after] = c0<c1 ? [cuts[0],cuts[1]] : [cuts[1],cuts[0]];
                    polys.push(before);
                    // FIX 3: Extract largest polygon from MultiPolygon so the next
                    // turf.intersect call doesn't receive an unsupported geometry type.
                    remaining = _asLargestPolygon(after);
                }
            }
            polys.push(remaining);
        }

        const valid = polys.filter(p => calcAreaHa(p.geometry) > 0.01);
        AS.camps = valid.map((p,i) => ({
            id:       uid(),
            name:     oldNames[i] || `Camp ${i+1}`,
            geometry: p.geometry,
            color:    AS_COLORS[i % AS_COLORS.length],
            areaHa:   calcAreaHa(p.geometry)
        }));

    } catch(err) {
        AS.camps = [];
    }
}

// Return the largest simple Polygon from a Feature<Polygon|MultiPolygon>.
function _asLargestPolygon(feature) {
    if (!feature || !feature.geometry) return feature;
    if (feature.geometry.type !== 'MultiPolygon') return feature;
    let bestArea = -1, bestCoords = null;
    for (const ring of feature.geometry.coordinates) {
        const area = calcAreaHa({ type:'Polygon', coordinates:ring });
        if (area > bestArea) { bestArea = area; bestCoords = ring; }
    }
    return bestCoords ? turf.polygon(bestCoords) : feature;
}

// Build the divider line for a {pos, angle} divider.
function _asDividerLine(div, bbox) {
    const [minLng,minLat,maxLng,maxLat] = bbox;
    const ang = (div.angle||0) * Math.PI/180;
    const L   = 3 * Math.max(maxLng-minLng, maxLat-minLat);
    let baseX, baseY, dx, dy;
    if (AS.dir === 'vertical') {
        baseX = minLng + div.pos*(maxLng-minLng);
        baseY = (minLat+maxLat)/2;
        dx = Math.sin(ang); dy = Math.cos(ang);
    } else {
        baseX = (minLng+maxLng)/2;
        baseY = minLat + div.pos*(maxLat-minLat);
        dx = Math.cos(ang); dy = Math.sin(ang);
    }
    return [[baseX-L*dx, baseY-L*dy],[baseX+L*dx, baseY+L*dy]];
}

// Cut a Turf polygon with a two-point line. Returns [left,right] or [poly].
function _asCutWithLine(poly, linePts) {
    try {
        const [p1, p2] = linePts;
        const dx = p2[0]-p1[0], dy = p2[1]-p1[1];
        const len = Math.sqrt(dx*dx+dy*dy) || 1;
        const nx = -dy/len, ny = dx/len;
        const ext = len;

        // Explicitly close both rings (copy p1 values, not the reference).
        const lc = [p1, p2, [p2[0]+nx*ext,p2[1]+ny*ext], [p1[0]+nx*ext,p1[1]+ny*ext], [p1[0],p1[1]]];
        const rc = [p1, p2, [p2[0]-nx*ext,p2[1]-ny*ext], [p1[0]-nx*ext,p1[1]-ny*ext], [p1[0],p1[1]]];

        // Ensure input is a simple Polygon for Turf v6 compatibility.
        const inputPoly = (poly.geometry && poly.geometry.type==='MultiPolygon')
            ? _asLargestPolygon(poly)
            : poly;

        const left  = turf.intersect(inputPoly, turf.polygon([lc]));
        const right = turf.intersect(inputPoly, turf.polygon([rc]));
        const result = [];
        if (left)  result.push(left);
        if (right) result.push(right);
        return result.length === 2 ? result : [poly];
    } catch(e) {
        return [poly];
    }
}

// ── Map layer helpers ─────────────────────────────────────────
function _asClearCampLayers() {
    AS.campLayers.forEach(l => { try { AS.map && AS.map.removeLayer(l); } catch(e){} });
    AS.campLayers = [];
}

function drawCampLayers() {
    if (!asMap) return;
    asCamps.forEach(camp => {
        try {
            const layer = L.geoJSON(
                { type:'Feature', geometry:camp.geometry, properties:{} },
                { style:{ color:camp.color, fillColor:camp.color, fillOpacity:0.4, weight:2 } }
            ).addTo(AS.map);

            // FIX 6: Safe centroid with coordinate-average fallback.
            let cLat, cLng;
            try {
                const centroid = turf.centroid(camp.geometry);
                [cLng, cLat] = centroid.geometry.coordinates;
            } catch (e) {
                const ring = camp.geometry.coordinates[0];
                cLng = ring.reduce((s, p) => s + p[0], 0) / ring.length;
                cLat = ring.reduce((s, p) => s + p[1], 0) / ring.length;
            }
            const icon = L.divIcon({
                className: '',
                html: `<div class="camp-lbl">${camp.name}</div>`,
                iconAnchor: [30, 10]
            });
            const m = L.marker([cLat,cLng], { icon, interactive:false }).addTo(AS.map);
            AS.campLayers.push(layer, m);
        } catch(e) {
            // Skip this camp layer if rendering fails — don't crash the rest.
        }
    });
}

// ── Reshape ───────────────────────────────────────────────────
function asReshapeCamp(idx) {
    if (AS.reshapeIdx !== null) return;
    AS.reshapeIdx = idx;

    // FIX 4: Remove boundary draw control BEFORE adding reshape control
    // so there is never more than one Leaflet Draw control at once.
    if (AS.drawControl) {
        try { AS.map.removeControl(AS.drawControl); } catch(e) {}
    }

    _asClearCampLayers();
    AS.camps.forEach((camp,i) => {
        if (i === idx) return;
        try {
            const layer = L.geoJSON(
                { type:'Feature', geometry:camp.geometry, properties:{} },
                { style:{ color:camp.color, fillColor:camp.color, fillOpacity:0.12, weight:1.5, dashArray:'4 3' } }
            ).addTo(AS.map);
            AS.campLayers.push(layer);
        } catch(e) {}
    });

    AS.reshapeGroup = new L.FeatureGroup().addTo(AS.map);
    try {
        L.geoJSON(
            { type:'Feature', geometry:AS.camps[idx].geometry, properties:{} },
            { style:{ color:AS.camps[idx].color, fillColor:AS.camps[idx].color, fillOpacity:0.55, weight:3 } }
        ).eachLayer(l => AS.reshapeGroup.addLayer(l));
    } catch(e) {}

    AS.reshapeControl = new L.Control.Draw({
        position:'topright', draw:false,
        edit:{ featureGroup:AS.reshapeGroup, remove:false }
    });
    AS.map.addControl(AS.reshapeControl);

    setTimeout(() => {
        const mapEl = document.getElementById('asMap');
        if (mapEl) {
            const btn = mapEl.querySelector('.leaflet-draw-edit-edit');
            if (btn) btn.click();
        }
    }, 80);

    _asRenderPanel();
}

function _asFinishReshape(save) {
    if (AS.reshapeIdx === null) return;

    if (save && AS.reshapeGroup) {
        AS.reshapeGroup.eachLayer(l => {
            try {
                const geo = l.toGeoJSON().geometry;
                if (geo) {
                    AS.camps[AS.reshapeIdx].geometry = geo;
                    AS.camps[AS.reshapeIdx].areaHa   = calcAreaHa(geo);
                }
            } catch(e) {}
        });
    }

    if (AS.reshapeControl) {
        try {
            const mapEl = document.getElementById('asMap');
            const saveBtn = mapEl && mapEl.querySelector('.leaflet-draw-edit-save');
            if (saveBtn) saveBtn.click();
            AS.map.removeControl(AS.reshapeControl);
        } catch(e) {}
        AS.reshapeControl = null;
    }
    if (AS.reshapeGroup) {
        try { AS.map.removeLayer(AS.reshapeGroup); } catch(e) {}
        AS.reshapeGroup = null;
    }

    AS.reshapeIdx = null;

    // FIX 4 continued: restore the boundary draw control.
    if (AS.drawControl && AS.map) {
        try { AS.map.addControl(AS.drawControl); } catch(e) {}
    }

    _asClearCampLayers();
    _asDrawCampLayers();
    _asRenderPanel();
}

function asSave() {
    if (!asCamps.length) {
        alert('Draw a farm boundary first.');
        return;
    }
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
    if (typeof drawnItems !== 'undefined' && drawnItems) {
        drawnItems.clearLayers();
        if (typeof restoreFieldsOnMap === 'function') restoreFieldsOnMap();
    }
    if (typeof renderFieldList === 'function') renderFieldList();
    if (typeof updateStats === 'function') updateStats();
    closeAutoSplit();
    setStatus(`${newFields.length} camp${newFields.length !== 1 ? 's' : ''} created.`);
    if (newFields.length && typeof selectField === 'function') {
        setTimeout(() => selectField(newFields[0].id), 300);
    }
}