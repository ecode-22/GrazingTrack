// ============================================================
//  gt-split.js  —  Farm boundary split tool
//
//  Workflow:
//    1. Draw the outer farm boundary on the mini-map.
//    2. Set number of camps + split direction.
//    3. "Camp sizes" section: N-1 divider blocks, each with:
//         Size  — moves the boundary line (position 5–95%)
//         Angle — tilts the boundary line (-45° to +45°)
//    4. Click ✎ on any camp to reshape it by dragging corners.
//    5. Rename camps, then click "Create camps".
//
//  All state lives in the AS object — no scattered globals.
//  One authoritative copy of every function — the duplicates
//  from earlier editing sessions have been removed.
// ============================================================
'use strict';

// ── State ─────────────────────────────────────────────────────
const AS = {
    map: null,
    drawn: null, // L.FeatureGroup holding the boundary layer
    boundary: null, // GeoJSON Polygon geometry
    boundaryLayer: null, // the Leaflet polygon layer
    campLayers: [], // all preview layers (cleared before each redraw)

    count: 4,
    dir: 'vertical', // 'vertical' | 'horizontal' | 'grid'

    // Strip dividers — one per boundary between adjacent camps.
    // { pos: 0..1, angle: -45..45 }
    dividers: [{ pos: 0.25, angle: 0 }, { pos: 0.50, angle: 0 }, { pos: 0.75, angle: 0 }],

    // Grid uses separate position-only arrays for columns and rows.
    colDividers: [0.50],
    rowDividers: [0.50],

    camps: [], // generated camp objects, ready to save

    // Reshape state — one camp in vertex-edit mode at a time.
    reshapeIdx: null,
    reshapeGroup: null,
    reshapeControl: null
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
        reshapeControl: null
    });
    openModal('modalAutoSplit');
    _asRenderPanel();
    setTimeout(_asInitMap, 150);
}

function closeAutoSplit() {
    _asFinishReshape(false); // clean up any open reshape session
    closeModal('modalAutoSplit');
    _asDestroyMap();
}

// Alias kept for the Escape-key handler in gt-utils.js which still calls this.
function asDestroyMap() { _asDestroyMap(); }

// ── Map setup ─────────────────────────────────────────────────
function _asInitMap() {
    if (AS.map) { try { AS.map.remove(); } catch (e) {}
        AS.map = null; }

    // Default to existing fields → saved config → South Africa centre
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
            if (cfg.lat) { center = [cfg.lat, cfg.lng];
                zoom = 14; }
        } catch (e) {}
    }

    AS.map = L.map('asMap', { zoomControl: true }).setView(center, zoom);
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { attribution: '© Esri', maxZoom: 19 }).addTo(AS.map);
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, opacity: 0.7 }).addTo(AS.map);

    AS.drawn = new L.FeatureGroup().addTo(AS.map);

    // Polygon draw only — no polyline, no fence tool.
    const dc = new L.Control.Draw({
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
    AS.map.addControl(dc);

    // Auto-click the polygon tool so the farmer can start drawing immediately.
    setTimeout(() => { const b = document.querySelector('.leaflet-draw-draw-polygon'); if (b) b.click(); }, 200);

    AS.map.on(L.Draw.Event.CREATED, e => {
        if (AS.boundaryLayer) AS.drawn.removeLayer(AS.boundaryLayer);
        _asClearCampLayers();
        AS.boundaryLayer = e.layer;
        AS.boundaryLayer.setStyle({ color: '#2d6a4f', fillColor: '#2d6a4f', fillOpacity: 0.12, weight: 3 });
        AS.drawn.addLayer(AS.boundaryLayer);
        AS.boundary = AS.boundaryLayer.toGeoJSON().geometry;
        _asResetDividers(); // equal spacing, zero angles when a new boundary is drawn
        _asRebuildCamps();
        _asDrawCampLayers();
        _asRenderPanel();
    });
}

function _asDestroyMap() {
    if (AS.map) { try { AS.map.remove(); } catch (e) {}
        AS.map = null; }
    AS.drawn = null;
    AS.boundaryLayer = null;
    AS.campLayers = [];
}

// ── Divider reset ─────────────────────────────────────────────
// Called whenever count or direction changes.
// Produces {pos, angle} objects — NOT plain numbers.
function _asResetDividers() {
    const n = AS.count;
    AS.dividers = Array.from({ length: n - 1 }, (_, i) => ({ pos: (i + 1) / n, angle: 0 }));
    const cols = Math.ceil(Math.sqrt(n));
    const rows = Math.ceil(n / cols);
    AS.colDividers = Array.from({ length: cols - 1 }, (_, i) => (i + 1) / cols);
    AS.rowDividers = Array.from({ length: rows - 1 }, (_, i) => (i + 1) / rows);
}

// ── Panel renderer ────────────────────────────────────────────
// Re-renders the entire left panel.  Called on boundary drawn, count/direction
// changes, and reshape start/end.  Never called during slider drag (that would
// destroy the focused <input>) — only the live labels update on each tick.
function _asRenderPanel() {
    const panel = document.getElementById('asControlPanel');
    if (!panel) return;

    // ── Reshape mode ──
    if (AS.reshapeIdx !== null) {
        const camp = AS.camps[AS.reshapeIdx];
        panel.innerHTML = `
            <div class="as-reshape-state">
                <div class="as-reshape-icon" style="background:${camp.color}">✎</div>
                <p class="as-reshape-title">Reshaping: ${camp.name}</p>
                <p class="as-reshape-sub">
                    Drag the white handles on the map to move corners.<br>
                    Click on any boundary line to add a new corner.<br>
                    When you're happy, click <strong>Save shape</strong>.
                </p>
                <div class="as-reshape-actions">
                    <button class="btn-primary" onclick="_asFinishReshape(true)">✓ Save shape</button>
                    <button class="btn-ghost"   onclick="_asFinishReshape(false)">✕ Cancel</button>
                </div>
                <p class="as-reshape-note">
                    Changing the count or direction later will recalculate all camps
                    and reset any manual reshaping.
                </p>
            </div>`;
        document.getElementById('asSaveBtn').disabled = true;
        return;
    }

    // ── Waiting for boundary ──
    if (!AS.boundary) {
        panel.innerHTML = `
            <div class="as-welcome">
                <div class="as-welcome-icon">⬡</div>
                <p class="as-welcome-title">Draw your farm boundary</p>
                <p class="as-welcome-sub">Click the polygon tool on the map, click around the outer edge of your farm, then double-click the last point to close the shape.</p>
            </div>`;
        document.getElementById('asSaveBtn').disabled = true;
        return;
    }

    // ── Main panel ──
    const totalHa = AS.camps.reduce((s, c) => s + c.areaHa, 0);
    panel.innerHTML = `
        <div class="as-section">
            <div class="as-section-title">Number of camps</div>
            <div class="as-count-row">
                <button class="as-count-btn" onclick="asSetCount(AS.count-1)">−</button>
                <span class="as-count-num" id="asCampNum">${AS.count}</span>
                <button class="as-count-btn" onclick="asSetCount(AS.count+1)">+</button>
                <input type="range" class="as-slider" min="1" max="50" value="${AS.count}"
                    oninput="asSetCount(parseInt(this.value))">
            </div>
            <div class="as-section-title" style="margin-top:10px">Split direction</div>
            <div class="as-dir-row">
                <button class="as-dir-btn${AS.dir === 'vertical'   ? ' active' : ''}" onclick="asSetDir('vertical')">↕ Vertical</button>
                <button class="as-dir-btn${AS.dir === 'horizontal' ? ' active' : ''}" onclick="asSetDir('horizontal')">↔ Horizontal</button>
                <button class="as-dir-btn${AS.dir === 'grid'       ? ' active' : ''}" onclick="asSetDir('grid')">⊞ Grid</button>
            </div>
        </div>

        <div class="as-section">
            <div class="as-section-title">Camp sizes <span class="as-section-hint">— move boundaries between camps</span></div>
            ${_asBuildDividerHTML()}
        </div>

        <div class="as-section">
            <div class="as-section-title">Camps <span class="as-section-hint">— rename or reshape individually</span></div>
            <div class="as-name-list">
                ${AS.camps.map((c, i) => `
                <div class="as-name-row">
                    <span class="as-camp-dot" style="background:${c.color}"></span>
                    <input class="as-name-input" type="text" value="${c.name}"
                        oninput="AS.camps[${i}].name=this.value">
                    <span class="as-size-lbl" id="as-size-${i}">${c.areaHa.toFixed(1)} ha</span>
                    <button class="as-reshape-btn" title="Reshape this camp by dragging corners"
                        onclick="asReshapeCamp(${i})">✎</button>
                </div>`).join('')}
            </div>
        </div>

        <div class="as-total-badge" id="asTotalBadge">
            ${AS.camps.length} camp${AS.camps.length !== 1 ? 's' : ''} · ${totalHa.toFixed(1)} ha total
        </div>`;

    document.getElementById('asSaveBtn').disabled = AS.camps.length === 0;
}

// ── Divider HTML builder ──────────────────────────────────────
// Vertical/horizontal: each divider gets a Size slider and an Angle slider.
// Grid: position-only sliders for columns and rows.
function _asBuildDividerHTML() {
    if (AS.camps.length <= 1)
        return '<p class="as-no-dividers">Only one camp — add more to adjust sizes.</p>';

    if (AS.dir === 'grid') {
        let html = '';
        if (AS.colDividers.length) {
            html += '<div class="as-div-group-lbl">Column widths</div>';
            html += AS.colDividers.map((v, i) => {
                const pct = Math.round(v * 100);
                const lo  = i === 0 ? 5 : Math.round(AS.colDividers[i - 1] * 100) + 5;
                const hi  = i === AS.colDividers.length - 1 ? 95 : Math.round(AS.colDividers[i + 1] * 100) - 5;
                return `<div class="as-div-row">
                    <span class="as-div-lbl">Col ${i + 1}|${i + 2}</span>
                    <input type="range" id="as-cdiv-${i}" class="as-div-slider" min="${lo}" max="${hi}" value="${pct}"
                        oninput="asOnColDiv(${i},this.value)">
                    <span class="as-div-pct" id="as-cdiv-pct-${i}">${pct}%</span>
                </div>`;
            }).join('');
        }
        if (AS.rowDividers.length) {
            html += '<div class="as-div-group-lbl" style="margin-top:8px">Row heights</div>';
            html += AS.rowDividers.map((v, i) => {
                const pct = Math.round(v * 100);
                const lo  = i === 0 ? 5 : Math.round(AS.rowDividers[i - 1] * 100) + 5;
                const hi  = i === AS.rowDividers.length - 1 ? 95 : Math.round(AS.rowDividers[i + 1] * 100) - 5;
                return `<div class="as-div-row">
                    <span class="as-div-lbl">Row ${i + 1}|${i + 2}</span>
                    <input type="range" id="as-rdiv-${i}" class="as-div-slider" min="${lo}" max="${hi}" value="${pct}"
                        oninput="asOnRowDiv(${i},this.value)">
                    <span class="as-div-pct" id="as-rdiv-pct-${i}">${pct}%</span>
                </div>`;
            }).join('');
        }
        return html;
    }

    // Vertical / horizontal: Size + Angle per divider
    return `<p class="as-div-legend"><strong>Size</strong> moves the boundary line. <strong>Angle</strong> tilts it.</p>` +
        AS.dividers.map((div, i) => {
            const pct = Math.round(div.pos * 100);
            const ang = div.angle || 0;
            const lo  = i === 0 ? 5 : Math.round(AS.dividers[i - 1].pos * 100) + 5;
            const hi  = i === AS.dividers.length - 1 ? 95 : Math.round(AS.dividers[i + 1].pos * 100) - 5;
            return `<div class="as-div-block">
                <div class="as-div-header">Camp ${i + 1} | Camp ${i + 2}</div>
                <div class="as-div-row">
                    <span class="as-div-lbl">Size</span>
                    <input type="range" id="as-div-${i}" class="as-div-slider" min="${lo}" max="${hi}" value="${pct}"
                        oninput="asOnDiv(${i},this.value)">
                    <span class="as-div-pct" id="as-div-pct-${i}">${pct}%</span>
                </div>
                <div class="as-div-row">
                    <span class="as-div-lbl">Angle</span>
                    <input type="range" id="as-div-ang-${i}" class="as-div-slider as-ang-slider" min="-45" max="45" value="${ang}"
                        oninput="asOnDivAngle(${i},this.value)">
                    <span class="as-div-pct" id="as-div-ang-pct-${i}">${ang > 0 ? '+' : ''}${ang}°</span>
                </div>
            </div>`;
        }).join('');
}

// ── Public slider handlers ────────────────────────────────────
// asSetCount / asSetDir: user clicked a button → safe to re-render the whole panel.
// asOnDiv / asOnDivAngle / asOnColDiv / asOnRowDiv: called on every oninput tick
//   → only patch labels and the map preview, never destroy the focused <input>.

function asSetCount(n) {
    AS.count = Math.max(1, Math.min(50, n));
    _asResetDividers();
    _asRebuildCamps();
    _asClearCampLayers();
    _asDrawCampLayers();
    _asRenderPanel();
}

function asSetDir(dir) {
    AS.dir = dir;
    _asResetDividers();
    _asRebuildCamps();
    _asClearCampLayers();
    _asDrawCampLayers();
    _asRenderPanel();
}

function asOnDiv(idx, rawVal) {
    AS.dividers[idx].pos = parseInt(rawVal) / 100;
    const pEl = document.getElementById(`as-div-pct-${idx}`);
    if (pEl) pEl.textContent = rawVal + '%';
    // Clamp adjacent sliders so dividers can never cross each other.
    const prev = document.getElementById(`as-div-${idx - 1}`);
    if (prev) prev.max = parseInt(rawVal) - 5;
    const next = document.getElementById(`as-div-${idx + 1}`);
    if (next) next.min = parseInt(rawVal) + 5;
    _asRebuildAndRefresh();
}

function asOnDivAngle(idx, rawVal) {
    AS.dividers[idx].angle = parseInt(rawVal);
    const aEl = document.getElementById(`as-div-ang-pct-${idx}`);
    const v   = parseInt(rawVal);
    if (aEl) aEl.textContent = (v > 0 ? '+' : '') + v + '°';
    _asRebuildAndRefresh();
}

function asOnColDiv(idx, rawVal) {
    AS.colDividers[idx] = parseInt(rawVal) / 100;
    const pEl = document.getElementById(`as-cdiv-pct-${idx}`);
    if (pEl) pEl.textContent = rawVal + '%';
    const prev = document.getElementById(`as-cdiv-${idx - 1}`); if (prev) prev.max = parseInt(rawVal) - 5;
    const next = document.getElementById(`as-cdiv-${idx + 1}`); if (next) next.min = parseInt(rawVal) + 5;
    _asRebuildAndRefresh();
}

function asOnRowDiv(idx, rawVal) {
    AS.rowDividers[idx] = parseInt(rawVal) / 100;
    const pEl = document.getElementById(`as-rdiv-pct-${idx}`);
    if (pEl) pEl.textContent = rawVal + '%';
    const prev = document.getElementById(`as-rdiv-${idx - 1}`); if (prev) prev.max = parseInt(rawVal) - 5;
    const next = document.getElementById(`as-rdiv-${idx + 1}`); if (next) next.min = parseInt(rawVal) + 5;
    _asRebuildAndRefresh();
}

// Lightweight refresh: recalculate → redraw map → patch ha labels only.
// Does NOT call _asRenderPanel so the slider the farmer is dragging stays focused.
function _asRebuildAndRefresh() {
    _asRebuildCamps();
    _asClearCampLayers();
    _asDrawCampLayers();
    AS.camps.forEach((c, i) => {
        const el = document.getElementById(`as-size-${i}`);
        if (el) el.textContent = c.areaHa.toFixed(1) + ' ha';
    });
    const badge = document.getElementById('asTotalBadge');
    if (badge) {
        const total = AS.camps.reduce((s, c) => s + c.areaHa, 0);
        badge.textContent = `${AS.camps.length} camp${AS.camps.length !== 1 ? 's' : ''} · ${total.toFixed(1)} ha total`;
    }
}

// ── Split algorithm ───────────────────────────────────────────
// Vertical / horizontal: sequential line-cuts.
//   Starting from the full farm polygon, each divider cuts off one camp.
//   The boundary line is placed at div.pos (fraction of the bbox extent)
//   and tilted by div.angle degrees.  The "before" piece is the one with
//   the smaller longitude (vertical) or latitude (horizontal) centroid.
//
// Grid: independent column + row position sliders → simple bbox intersection.
//   Angle is not meaningful for grid cells.
function _asRebuildCamps() {
    if (!AS.boundary) { AS.camps = []; return; }
    const farmPoly = turf.polygon(AS.boundary.coordinates);
    const bbox     = turf.bbox(farmPoly);
    const oldNames = AS.camps.map(c => c.name); // preserve user-typed names
    let polys      = [];

    if (AS.dir === 'grid') {
        const [minLng, minLat, maxLng, maxLat] = bbox;
        const colBreaks = [0, ...AS.colDividers, 1];
        const rowBreaks = [0, ...AS.rowDividers, 1];
        let idx = 0;
        outer: for (let r = 0; r < rowBreaks.length - 1; r++) {
            for (let c = 0; c < colBreaks.length - 1; c++) {
                if (idx++ >= AS.count) break outer;
                const sLng = minLng + colBreaks[c]     * (maxLng - minLng);
                const eLng = minLng + colBreaks[c + 1] * (maxLng - minLng);
                const sLat = minLat + rowBreaks[r]     * (maxLat - minLat);
                const eLat = minLat + rowBreaks[r + 1] * (maxLat - minLat);
                // Turf v6: two arguments (not a FeatureCollection)
                const ix = turf.intersect(farmPoly, turf.bboxPolygon([sLng, sLat, eLng, eLat]));
                if (ix) polys.push(ix);
            }
        }
    } else {
        // Sequential line-cut for vertical / horizontal
        let remaining = farmPoly;
        for (const div of AS.dividers) {
            const line = _asDividerLine(div, bbox);
            const cuts = _asCutWithLine(remaining, line);
            if (cuts.length === 2) {
                // Decide which cut is "before" by centroid position.
                const ci = AS.dir === 'vertical' ? 0 : 1; // 0=lng, 1=lat
                const c0 = turf.centroid(cuts[0]).geometry.coordinates[ci];
                const c1 = turf.centroid(cuts[1]).geometry.coordinates[ci];
                const [before, after] = c0 < c1 ? [cuts[0], cuts[1]] : [cuts[1], cuts[0]];
                polys.push(before);
                remaining = after;
            }
            // If the line misses the polygon, skip gracefully (remaining unchanged)
        }
        polys.push(remaining); // the last remaining piece is the final camp
    }

    const valid = polys.filter(p => calcAreaHa(p.geometry) > 0.01);
    AS.camps = valid.map((p, i) => ({
        id:      uid(),
        name:    oldNames[i] || `Camp ${i + 1}`,
        geometry:p.geometry,
        color:   AS_COLORS[i % AS_COLORS.length],
        areaHa:  calcAreaHa(p.geometry)
    }));
}

// Build the divider line for a {pos, angle} object.
// Returns [[lng1,lat1],[lng2,lat2]] — extended 3× the bbox diagonal so it
// always exits the farm boundary regardless of tilt angle.
//
// For vertical splits: nominal line is north–south at the given longitude.
//   Positive angle rotates the top eastward (clockwise from above).
// For horizontal splits: nominal line is east–west at the given latitude.
//   Positive angle rotates the right end northward.
function _asDividerLine(div, bbox) {
    const [minLng, minLat, maxLng, maxLat] = bbox;
    const ang  = (div.angle || 0) * Math.PI / 180;
    const L    = 3 * Math.max(maxLng - minLng, maxLat - minLat); // safe extension
    let baseX, baseY, dx, dy;

    if (AS.dir === 'vertical') {
        baseX = minLng + div.pos * (maxLng - minLng);
        baseY = (minLat + maxLat) / 2;
        dx    = Math.sin(ang);  // default: straight north (dx=0, dy=1)
        dy    = Math.cos(ang);
    } else {
        baseX = (minLng + maxLng) / 2;
        baseY = minLat + div.pos * (maxLat - minLat);
        dx    = Math.cos(ang);  // default: straight east (dx=1, dy=0)
        dy    = Math.sin(ang);
    }
    return [
        [baseX - L * dx, baseY - L * dy],
        [baseX + L * dx, baseY + L * dy]
    ];
}

// Cut a Turf polygon along a two-point line using the half-plane method.
// Returns [left, right] if the line crosses, otherwise [original].
// "Left" = the side where the +90° perpendicular points.
function _asCutWithLine(poly, linePts) {
    try {
        const [p1, p2] = linePts;
        const dx  = p2[0] - p1[0], dy = p2[1] - p1[1];
        const len = Math.sqrt(dx * dx + dy * dy) || 1;
        // Perpendicular unit vector (+90° from the line direction)
        const nx = -dy / len, ny = dx / len;
        const ext = len; // already 3× the bbox diagonal

        // Build each half-plane as: line + heavily offset parallel copy.
        const leftCoords  = [p1, p2, [p2[0] + nx * ext, p2[1] + ny * ext], [p1[0] + nx * ext, p1[1] + ny * ext], p1];
        const rightCoords = [p1, p2, [p2[0] - nx * ext, p2[1] - ny * ext], [p1[0] - nx * ext, p1[1] - ny * ext], p1];

        // Turf v6: two arguments
        const left  = turf.intersect(poly, turf.polygon([leftCoords]));
        const right = turf.intersect(poly, turf.polygon([rightCoords]));
        const result = [];
        if (left)  result.push(left);
        if (right) result.push(right);
        return result.length === 2 ? result : [poly];
    } catch (e) {
        return [poly]; // geometry error — keep the original piece intact
    }
}

// ── Map layer helpers ─────────────────────────────────────────
function _asClearCampLayers() {
    AS.campLayers.forEach(l => { try { AS.map && AS.map.removeLayer(l); } catch (e) {} });
    AS.campLayers = [];
}

function _asDrawCampLayers() {
    if (!AS.map) return;
    AS.camps.forEach(camp => {
        // L.geoJSON handles Polygon and MultiPolygon correctly.
        const layer = L.geoJSON(
            { type: 'Feature', geometry: camp.geometry, properties: {} },
            { style: { color: camp.color, fillColor: camp.color, fillOpacity: 0.4, weight: 2 } }
        ).addTo(AS.map);
        // turf.centroid works for both geometry types.
        const c = turf.centroid({ type: 'Feature', geometry: camp.geometry, properties: {} });
        const [cLng, cLat] = c.geometry.coordinates;
        const icon = L.divIcon({ className: '', html: `<div class="camp-lbl">${camp.name}</div>`, iconAnchor: [30, 10] });
        const m = L.marker([cLat, cLng], { icon, interactive: false }).addTo(AS.map);
        AS.campLayers.push(layer, m);
    });
}

// ── Reshape — per-camp vertex editing ─────────────────────────
// Dims all other camps, places the target camp in an isolated FeatureGroup,
// adds a temporary Draw control with only the Edit tool, and auto-clicks it.
function asReshapeCamp(idx) {
    if (AS.reshapeIdx !== null) return; // prevent re-entry
    AS.reshapeIdx = idx;

    // Redraw non-edited camps at reduced opacity for spatial context.
    _asClearCampLayers();
    AS.camps.forEach((camp, i) => {
        if (i === idx) return;
        const layer = L.geoJSON(
            { type: 'Feature', geometry: camp.geometry, properties: {} },
            { style: { color: camp.color, fillColor: camp.color, fillOpacity: 0.12, weight: 1.5, dashArray: '4 3' } }
        ).addTo(AS.map);
        AS.campLayers.push(layer);
    });

    // Isolated FeatureGroup — required by Leaflet Draw's edit system.
    AS.reshapeGroup = new L.FeatureGroup().addTo(AS.map);
    L.geoJSON(
        { type: 'Feature', geometry: AS.camps[idx].geometry, properties: {} },
        { style: { color: AS.camps[idx].color, fillColor: AS.camps[idx].color, fillOpacity: 0.55, weight: 3 } }
    ).eachLayer(l => AS.reshapeGroup.addLayer(l));

    AS.reshapeControl = new L.Control.Draw({
        position: 'topright',
        draw:     false,
        edit:     { featureGroup: AS.reshapeGroup, remove: false }
    });
    AS.map.addControl(AS.reshapeControl);

    // Auto-click the edit pencil so editing starts immediately.
    setTimeout(() => { const btn = document.querySelector('.leaflet-draw-edit-edit'); if (btn) btn.click(); }, 80);

    _asRenderPanel(); // switch to "Reshaping…" mode
}

function _asFinishReshape(save) {
    if (AS.reshapeIdx === null) return;

    if (save && AS.reshapeGroup) {
        AS.reshapeGroup.eachLayer(l => {
            const geo = l.toGeoJSON().geometry;
            if (geo) {
                AS.camps[AS.reshapeIdx].geometry = geo;
                AS.camps[AS.reshapeIdx].areaHa   = calcAreaHa(geo);
            }
        });
    }

    // Gracefully exit Leaflet Draw's edit mode via its own Save button.
    if (AS.reshapeControl) {
        const saveBtn = document.querySelector('.leaflet-draw-edit-save');
        if (saveBtn) saveBtn.click();
        try { AS.map.removeControl(AS.reshapeControl); } catch (e) {}
        AS.reshapeControl = null;
    }
    if (AS.reshapeGroup) {
        try { AS.map.removeLayer(AS.reshapeGroup); } catch (e) {}
        AS.reshapeGroup = null;
    }

    AS.reshapeIdx = null;
    _asClearCampLayers();
    _asDrawCampLayers();
    _asRenderPanel();
}

// ── Save to main map ──────────────────────────────────────────
function asSave() {
    if (!AS.camps.length) { alert('Draw a boundary first.'); return; }
    // Read any last-second name edits directly from the inputs.
    document.querySelectorAll('.as-name-input').forEach((inp, i) => {
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
    setStatus(`${newFields.length} camp${newFields.length !== 1 ? 's' : ''} created.`);
    if (newFields.length) setTimeout(() => selectField(newFields[0].id), 300);
}