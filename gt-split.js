// ============================================================
//  gt-split.js  —  Farm boundary split tool (Full working version)
//  Includes: divider sliders with angle, grid mode, reshape
// ============================================================
'use strict';

// ── State ─────────────────────────────────────────────────────
const AS = {
    map: null,
    drawn: null,
    drawControl: null,
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

    _refreshTimer: null
};

const AS_COLORS = [
    '#2d6a4f', '#52b788', '#40916c', '#74c69d', '#1b4332', '#34a0a4',
    '#0077b6', '#7b2d8b', '#d97706', '#dc2626', '#0891b2', '#059669',
    '#7c3aed', '#db2777', '#b45309', '#374151', '#16a34a', '#ca8a04',
    '#9333ea', '#e11d48', '#0369a1', '#15803d', '#b91c1c', '#7e22ce'
];

// ── Open / close ──────────────────────────────────────────────
function openAutoSplit() {
    Object.assign(AS, {
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
        drawControl: null,
        _refreshTimer: null
    });

    openModal('modalAutoSplit');

    // Clear static panel content so _asRenderPanel can populate it
    const panel = document.getElementById('asPanel');
    if (panel) panel.innerHTML = '';

    _asRenderPanel();
    setTimeout(_asInitMap, 150);
}

function closeAutoSplit() {
    if (AS._refreshTimer) {
        clearTimeout(AS._refreshTimer);
        AS._refreshTimer = null;
    }
    _asFinishReshape(false);
    closeModal('modalAutoSplit');
    _asDestroyMap();
}

function asDestroyMap() { _asDestroyMap(); }

// ── Map setup ─────────────────────────────────────────────────
function _asInitMap() {
    if (AS.map) {
        try { AS.map.remove(); } catch (e) {}
        AS.map = null;
    }

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
        center = [(Math.min(...lats) + Math.max(...lats)) / 2,
            (Math.min(...lngs) + Math.max(...lngs)) / 2
        ];
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

    AS.map = L.map('asMap', { zoomControl: true }).setView(center, zoom);
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { attribution: '© Esri', maxZoom: 19 }).addTo(AS.map);
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, opacity: 0.7 }).addTo(AS.map);

    AS.drawn = new L.FeatureGroup().addTo(AS.map);

    AS.drawControl = new L.Control.Draw({
        position: 'topright',
        draw: {
            polygon: { allowIntersection: false, showArea: true, shapeOptions: { color: '#2d6a4f', fillColor: '#2d6a4f', fillOpacity: 0.12, weight: 3, dashArray: '6 3' } },
            polyline: false,
            rectangle: false,
            circle: false,
            circlemarker: false,
            marker: false
        },
        edit: { featureGroup: AS.drawn, remove: false }
    });
    AS.map.addControl(AS.drawControl);

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

        // Update hint
        const hint = document.getElementById('asHint');
        if (hint) hint.innerHTML = '✅ Boundary drawn! Adjust camps below.';

        // Show camp list
        const campWrap = document.getElementById('asCampNamesWrap');
        if (campWrap) campWrap.style.display = 'block';
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
    const panel = document.getElementById('asPanel');
    if (!panel) return;

    if (AS.reshapeIdx !== null) {
        const camp = AS.camps[AS.reshapeIdx];
        panel.innerHTML = `
            <div class="as-steps">
                <div class="as-step"><span class="as-num">✎</span>Drag the white handles on the map to move corners. Click on a boundary line to add a new corner.</div>
            </div>
            <div class="as-ctrls" style="text-align:center">
                <p style="font-weight:700;margin-bottom:12px">Reshaping: ${camp.name}</p>
                <button class="btn-primary" onclick="_asFinishReshape(true)" style="width:100%;margin-bottom:8px">✓ Save shape</button>
                <button class="btn-ghost" onclick="_asFinishReshape(false)" style="width:100%">✕ Cancel</button>
                <p class="as-hint" style="margin-top:12px">Changing count or direction will reset reshaping.</p>
            </div>`;
        document.getElementById('asSaveBtn').disabled = true;
        return;
    }

    if (!AS.boundary) {
        panel.innerHTML = `
            <div class="as-steps">
                <div class="as-step"><span class="as-num">1</span>Click the polygon button on the map and trace your farm's outer boundary. Double-click to close.</div>
                <div class="as-step"><span class="as-num">2</span>Adjust the number of camps and split direction — the preview updates instantly.</div>
                <div class="as-step"><span class="as-num">3</span>Edit camp names in the list below, then click <strong>Create camps</strong>.</div>
            </div>
            <div id="asHint" class="as-hint">
                👆 Click the <strong>polygon button</strong> in the top-right of the map, then click around your farm's outer boundary. Double-click to finish.
            </div>`;
        document.getElementById('asSaveBtn').disabled = true;
        return;
    }

    const totalHa = AS.camps.reduce((s, c) => s + c.areaHa, 0);
    panel.innerHTML = `
        <div class="as-steps">
            <div class="as-step"><span class="as-num">✓</span>Boundary drawn! Adjust settings below.</div>
        </div>
        
        <div class="as-ctrls">
            <div class="as-count-ctrl">
                <button class="as-count-adj" onclick="asAdjCount(-1)">−</button>
                <span class="as-count-num" id="asCampNum">${AS.count}</span>
                <button class="as-count-adj" onclick="asAdjCount(1)">+</button>
            </div>
            <input type="range" class="as-count-slider" id="asCampSlider" min="1" max="50" value="${AS.count}" oninput="asSetCount(parseInt(this.value))">
            <div style="display:flex;justify-content:space-between;font-size:9px;color:var(--faint);margin-bottom:10px">
                <span>1</span><span>10</span><span>25</span><span>50</span>
            </div>

            <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--faint);margin-bottom:6px">Split direction</div>
            <div class="as-dir-btns">
                <button class="as-dir-btn ${AS.dir==='vertical'?'active':''}" onclick="asSetDir('vertical')">↕ Vertical</button>
                <button class="as-dir-btn ${AS.dir==='horizontal'?'active':''}" onclick="asSetDir('horizontal')">↔ Horizontal</button>
                <button class="as-dir-btn ${AS.dir==='grid'?'active':''}" onclick="asSetDir('grid')">⊞ Grid</button>
            </div>

            <div class="as-angle-wrap">
                <div class="as-angle-hdr">
                    <span class="as-angle-lbl">🔄 Rotation angle</span>
                    <span class="as-angle-val" id="asAngleDisplay">${AS.dividers[0]?.angle || 0}°</span>
                </div>
                <input type="range" class="as-count-slider" id="asAngleSlider" min="-90" max="90" value="${AS.dividers[0]?.angle || 0}" step="1" oninput="asSetAngle(parseInt(this.value))">
                <div class="as-angle-marks">
                    <span>−90°</span><span>−45°</span><span>0°</span><span>+45°</span><span>+90°</span>
                </div>
                <div class="as-angle-presets">
                    <button class="as-ang-pre" onclick="asSetAngle(-45)">−45°</button>
                    <button class="as-ang-pre" onclick="asSetAngle(-30)">−30°</button>
                    <button class="as-ang-pre" onclick="asSetAngle(0)">↺ Reset</button>
                    <button class="as-ang-pre" onclick="asSetAngle(30)">+30°</button>
                    <button class="as-ang-pre" onclick="asSetAngle(45)">+45°</button>
                </div>
                <p class="as-angle-tip">Rotates cut lines — useful for diagonal fences or irregular farm shapes.</p>
            </div>
        </div>

        <div id="asCampNamesWrap" style="display:block;margin-top:14px">
            <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--faint);margin-bottom:8px">Camp names</div>
            ${AS.camps.map((c,i) => `
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
                <span style="width:12px;height:12px;border-radius:50%;background:${c.color};flex-shrink:0"></span>
                <input type="text" value="${c.name}" onchange="AS.camps[${i}].name=this.value" style="flex:1;padding:6px 8px;border:1px solid var(--border);border-radius:6px;font-size:12px">
                <span style="font-size:11px;color:var(--faint);min-width:50px;text-align:right">${c.areaHa.toFixed(1)} ha</span>
                <button onclick="asReshapeCamp(${i})" style="background:none;border:1px solid var(--border);border-radius:4px;cursor:pointer;padding:4px 8px;font-size:11px" title="Reshape">✎</button>
            </div>`).join('')}
        </div>

        <div style="text-align:center;margin-top:12px;font-weight:700;font-size:13px;color:var(--green-dark)">
            ${AS.camps.length} camp${AS.camps.length!==1?'s':''} · ${totalHa.toFixed(1)} ha total
        </div>`;

    document.getElementById('asSaveBtn').disabled = AS.camps.length === 0;
}

// ── Count & Direction ─────────────────────────────────────────
function asSetCount(n) {
    AS.count = Math.max(1, Math.min(50, n));
    _asResetDividers();
    _asRebuildCamps();
    _asClearCampLayers();
    _asDrawCampLayers();
    _asRenderPanel();
}

function asAdjCount(delta) {
    asSetCount(AS.count + delta);
}

function asSetDir(dir) {
    AS.dir = dir;
    _asResetDividers();
    _asRebuildCamps();
    _asClearCampLayers();
    _asDrawCampLayers();
    _asRenderPanel();
}

function asSetAngle(angle) {
    AS.dividers.forEach(d => d.angle = angle);
    _asRebuildCamps();
    _asClearCampLayers();
    _asDrawCampLayers();
    _asRenderPanel();
}

// ── Slider handlers ───────────────────────────────────────────
function asOnDiv(idx, rawVal) {
    AS.dividers[idx].pos = parseInt(rawVal)/100;
    _asScheduleRefresh();
}

function asOnDivAngle(idx, rawVal) {
    AS.dividers[idx].angle = parseInt(rawVal);
    _asScheduleRefresh();
}

function asOnColDiv(idx, rawVal) {
    AS.colDividers[idx] = parseInt(rawVal)/100;
    _asScheduleRefresh();
}

function asOnRowDiv(idx, rawVal) {
    AS.rowDividers[idx] = parseInt(rawVal)/100;
    _asScheduleRefresh();
}

// Debounce — 80ms after the last slider move before recomputing.
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
    _asRenderPanel();
}

// ── Split algorithm ───────────────────────────────────────────
function _asRebuildCamps() {
    if (!AS.boundary) { AS.camps = []; return; }

    try {
        // Ensure CCW winding on the farm boundary before any cutting
        const farmPoly = turf.rewind(turf.polygon(AS.boundary.coordinates), { reverse: false, mutate: false });
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
        console.error("Split error:", err);
        AS.camps = [];
    }
}

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

function _asCutWithLine(poly, linePts) {
    try {
        const [p1, p2] = linePts;
        const dx = p2[0]-p1[0], dy = p2[1]-p1[1];
        const len = Math.sqrt(dx*dx+dy*dy) || 1;
        const nx = -dy/len, ny = dx/len;  // left-hand normal
        const ext = len * 2;               // generous extension

        // Both halves must be CCW (GeoJSON exterior ring convention).
        // lc (left half): p1 → p2 → p2+normal → p1+normal → p1  [CCW ✓]
        const lc = [p1, p2,
                    [p2[0]+nx*ext, p2[1]+ny*ext],
                    [p1[0]+nx*ext, p1[1]+ny*ext],
                    [p1[0], p1[1]]];

        // rc (right half): p1 → p1−normal → p2−normal → p2 → p1  [CCW ✓]
        // (original code had p1→p2→p2−n→p1−n which is CW — that was the bug)
        const rc = [p1,
                    [p1[0]-nx*ext, p1[1]-ny*ext],
                    [p2[0]-nx*ext, p2[1]-ny*ext],
                    p2,
                    [p1[0], p1[1]]];

        const inputPoly = (poly.geometry && poly.geometry.type === 'MultiPolygon')
            ? _asLargestPolygon(poly)
            : poly;

        // turf.rewind ensures CCW outer / CW inner winding before intersect
        const lPoly = turf.rewind(turf.polygon([lc]), { reverse: false, mutate: false });
        const rPoly = turf.rewind(turf.polygon([rc]), { reverse: false, mutate: false });

        const left  = turf.intersect(inputPoly, lPoly);
        const right = turf.intersect(inputPoly, rPoly);
        const result = [];
        if (left)  result.push(left);
        if (right) result.push(right);
        return result.length === 2 ? result : [poly];
    } catch(e) {
        console.warn('[AutoSplit] cut failed:', e.message);
        return [poly];
    }
}

// ── Map layer helpers ─────────────────────────────────────────
function _asClearCampLayers() {
    AS.campLayers.forEach(l => { try { AS.map && AS.map.removeLayer(l); } catch(e){} });
    AS.campLayers = [];
}

function _asDrawCampLayers() {
    if (!AS.map) return;
    AS.camps.forEach(camp => {
        try {
            const layer = L.geoJSON(
                { type:'Feature', geometry:camp.geometry, properties:{} },
                { style:{ color:camp.color, fillColor:camp.color, fillOpacity:0.4, weight:2 } }
            ).addTo(AS.map);

            let cLat, cLng;
            try {
                const c = turf.centroid({ type:'Feature', geometry:camp.geometry, properties:{} });
                [cLng, cLat] = c.geometry.coordinates;
            } catch(e) {
                const ring = camp.geometry.type==='Polygon'
                    ? camp.geometry.coordinates[0]
                    : camp.geometry.coordinates[0][0];
                cLng = ring.reduce((s,p)=>s+p[0],0)/ring.length;
                cLat = ring.reduce((s,p)=>s+p[1],0)/ring.length;
            }

            const icon = L.divIcon({
                className:'',
                html:`<div class="camp-lbl">${camp.name}</div>`,
                iconAnchor:[30,10]
            });
            const m = L.marker([cLat,cLng], { icon, interactive:false }).addTo(AS.map);
            AS.campLayers.push(layer, m);
        } catch(e) {}
    });
}

// ── Reshape ───────────────────────────────────────────────────
function asReshapeCamp(idx) {
    if (AS.reshapeIdx !== null) return;
    AS.reshapeIdx = idx;

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

    if (AS.drawControl && AS.map) {
        try { AS.map.addControl(AS.drawControl); } catch(e) {}
    }

    _asClearCampLayers();
    _asDrawCampLayers();
    _asRenderPanel();
}

// ── Save to main map ──────────────────────────────────────────
function saveAutoSplitCamps() {
    if (!AS.camps.length) { alert('No camps to save — draw a boundary first.'); return; }
    
    // Sync names from inputs
    document.querySelectorAll('#asCampNamesWrap input[type="text"]').forEach((inp, i) => {
        if (AS.camps[i]) AS.camps[i].name = inp.value.trim() || AS.camps[i].name;
    });
    
    const existing  = loadFields();
    const newFields = AS.camps.map(c => ({
        id:         c.id,
        name:       c.name,
        type:       'pasture',
        restTarget: 42,
        maxAUperHa: null,
        geometry:   c.geometry,
        areaHa:     c.areaHa,
        color:      c.color,
        createdAt:  new Date().toISOString(),
        version:    DB_VERSION
    }));
    saveFields([...existing, ...newFields]);
    drawnItems.clearLayers();
    restoreFieldsOnMap();
    renderFieldList();
    updateStats();
    closeAutoSplit();
    setStatus(`${newFields.length} camp${newFields.length!==1?'s':''} created.`);
    if (newFields.length) setTimeout(() => selectField(newFields[0].id), 300);
}