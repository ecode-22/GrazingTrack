// ============================================================
//  gt-split.js  —  Farm boundary split tool
//  Uses Turf.js for accurate polygon clipping
// ============================================================
'use strict';

let asMap = null;
let asBoundaryLayer = null;
let asCampLayers = [];
let asCamps = [];
let asCampCount = 4;
let asSplitDir = 'grid';
let asDrawnGroup = null;

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
    asMap.addControl(drawControl);
    asMap.on(L.Draw.Event.CREATED, onBoundaryDrawn);
    renderSplitPanel();
}

function destroySplitMap() {
    if (asMap) {
        try { asMap.remove(); } catch (e) {}
        asMap = null;
    }
    asBoundaryLayer = null;
    asCampLayers = [];
}

function onBoundaryDrawn(e) {
    if (e.layerType !== 'polygon') return;
    if (asBoundaryLayer) asDrawnGroup.removeLayer(asBoundaryLayer);
    clearCampLayers();
    asBoundaryLayer = e.layer;
    asBoundaryLayer.setStyle({ color: '#2d6a4f', fillColor: '#2d6a4f', fillOpacity: 0.12, weight: 3 });
    asDrawnGroup.addLayer(asBoundaryLayer);
    generateCamps();
    renderSplitPanel();
}

function renderSplitPanel() {
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

function generateCamps() {
    clearCampLayers();
    if (!asBoundaryLayer) return;

    const geo = asBoundaryLayer.toGeoJSON().geometry;
    const farmPoly = turf.polygon(geo.coordinates);
    const bbox = turf.bbox(farmPoly);
    const [minLng, minLat, maxLng, maxLat] = bbox;
    const n = asCampCount;

    let cells = [];

    if (asSplitDir === 'grid') {
        const cols = Math.ceil(Math.sqrt(n));
        const rows = Math.ceil(n / cols);
        const cellW = (maxLng - minLng) / cols;
        const cellH = (maxLat - minLat) / rows;
        for (let r = 0; r < rows && cells.length < n; r++) {
            for (let c = 0; c < cols && cells.length < n; c++) {
                const cell = turf.bboxPolygon([
                    minLng + c * cellW,
                    minLat + r * cellH,
                    minLng + (c + 1) * cellW,
                    minLat + (r + 1) * cellH
                ]);
                const intersect = turf.intersect(farmPoly, cell);
                if (intersect && calcAreaHa(intersect.geometry) > 0.01) {
                    cells.push(intersect);
                }
            }
        }
    } else if (asSplitDir === 'vertical') {
        const step = (maxLng - minLng) / n;
        for (let i = 0; i < n; i++) {
            const cell = turf.bboxPolygon([
                minLng + i * step,
                minLat,
                minLng + (i + 1) * step,
                maxLat
            ]);
            const intersect = turf.intersect(farmPoly, cell);
            if (intersect && calcAreaHa(intersect.geometry) > 0.01) {
                cells.push(intersect);
            }
        }
    } else if (asSplitDir === 'horizontal') {
        const step = (maxLat - minLat) / n;
        for (let i = 0; i < n; i++) {
            const cell = turf.bboxPolygon([
                minLng,
                minLat + i * step,
                maxLng,
                minLat + (i + 1) * step
            ]);
            const intersect = turf.intersect(farmPoly, cell);
            if (intersect && calcAreaHa(intersect.geometry) > 0.01) {
                cells.push(intersect);
            }
        }
    }

    asCamps = cells.map((cell, i) => ({
        id: uid(),
        name: `Camp ${i + 1}`,
        geometry: cell.geometry,
        color: SPLIT_COLORS[i % SPLIT_COLORS.length],
        areaHa: calcAreaHa(cell.geometry)
    }));

    drawCampLayers();
}

function drawCampLayers() {
    if (!asMap) return;
    asCamps.forEach(camp => {
        try {
            const layer = L.geoJSON(camp.geometry, {
                style: { color: camp.color, fillColor: camp.color, fillOpacity: 0.4, weight: 2 }
            }).addTo(asMap);
            // Add label at centroid
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
            const marker = L.marker([cLat, cLng], { icon, interactive: false }).addTo(asMap);
            asCampLayers.push(layer, marker);
        } catch (e) {}
    });
}

function clearCampLayers() {
    asCampLayers.forEach(l => { try { asMap && asMap.removeLayer(l); } catch (e) {} });
    asCampLayers = [];
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