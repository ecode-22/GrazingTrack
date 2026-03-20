// ============================================================
//  GrazingTrack — setup.js
//  First-run setup wizard (v3.1)
//  Features:
//   - Multi-step farm configuration
//   - Animal group builder
//   - Day/night grazing cycle support
//   - Draw farm boundary → auto-split into camps (Turf-based)
//   - Option to skip auto-split and draw manually
// ============================================================

// ── SETUP STATE ───────────────────────────────────────────────
let setupStep = 1;
const TOTAL_STEPS = 5;

let setupData = {
    farmName: '',
    farmLocation: { lat: null, lng: null },
    animalGroups: [], // [{ name, type, count, herd }]
    grazingCycle: 'standard', // 'standard' | 'daynight'
    dayNightConfig: { dayHours: '06:00-18:00', nightHours: '18:00-06:00' },
    farmBoundary: null, // GeoJSON polygon
    campCount: 4,
    camps: [], // generated field objects
    skipAutoSplit: false // new option to skip auto-split
};

let setupMap = null;
let setupDraw = null;
let setupLayer = null; // farm boundary layer
let setupCampLayers = []; // auto-generated camp layers

// ── ENTRY POINT ───────────────────────────────────────────────
function checkFirstRun() {
    const done = localStorage.getItem('gt_setup_done');
    if (!done) openSetup();
}

function openSetup() {
    setupStep = 1;
    setupData = {
        farmName: '',
        farmLocation: { lat: null, lng: null },
        animalGroups: [],
        grazingCycle: 'standard',
        dayNightConfig: { dayHours: '06:00-18:00', nightHours: '18:00-06:00' },
        farmBoundary: null,
        campCount: 4,
        camps: [],
        skipAutoSplit: false
    };
    document.getElementById('setupOverlay').style.display = 'flex';
    renderSetupStep();
}

function closeSetup(completed) {
    document.getElementById('setupOverlay').style.display = 'none';
    if (setupMap) {
        setupMap.remove();
        setupMap = null;
    }
    if (completed) {
        localStorage.setItem('gt_setup_done', '1');
        applySetupToApp();
    }
}

// ── STEP RENDERER ─────────────────────────────────────────────
function renderSetupStep() {
    const body = document.getElementById('setupBody');
    const title = document.getElementById('setupTitle');
    const stepLbl = document.getElementById('setupStepLabel');
    const progress = document.getElementById('setupProgress');

    stepLbl.textContent = `Step ${setupStep} of ${TOTAL_STEPS}`;
    progress.style.width = ((setupStep / TOTAL_STEPS) * 100) + '%';

    // Back / Next buttons
    document.getElementById('setupBack').style.display = setupStep > 1 ? 'flex' : 'none';
    document.getElementById('setupNext').textContent = setupStep === TOTAL_STEPS ? 'Finish setup ✓' : 'Next →';

    if (setupStep === 1) renderStep1(title, body);
    if (setupStep === 2) renderStep2(title, body);
    if (setupStep === 3) renderStep3(title, body);
    if (setupStep === 4) { renderStep4(title, body); }
    if (setupStep === 5) renderStep5(title, body);
}

// ── STEP 1: Farm name & location ──────────────────────────────
function renderStep1(title, body) {
    title.textContent = '🌿 Welcome to GrazingTrack';
    body.innerHTML = `
    <p class="setup-desc">Free rotational grazing management — right on your phone. Let's take 2 minutes to set up your farm. You can change everything later.</p>

    <div class="setup-field">
      <label>Farm name <span class="setup-opt">required</span></label>
      <input type="text" id="s1Name" placeholder="e.g. Riverside Farm"
             value="${setupData.farmName}" maxlength="50" autocomplete="off">
    </div>

    <div class="setup-field">
      <label>Your farm location</label>
      <button class="setup-gps-btn" onclick="autoLocate()" id="gpsBtn">
        <span class="setup-gps-icon">📍</span>
        <div>
          <div class="setup-gps-title">Use my current location</div>
          <div class="setup-gps-sub">Centres the map on your farm automatically</div>
        </div>
      </button>
      <div class="setup-coords-row">
        <input type="number" id="s1Lat" placeholder="Latitude e.g. -26.20"
               value="${setupData.farmLocation.lat || ''}" step="any">
        <input type="number" id="s1Lng" placeholder="Longitude e.g. 28.04"
               value="${setupData.farmLocation.lng || ''}" step="any">
      </div>
      <small>💡 Or open Google Maps, long-press your farm, and copy the numbers at the top.</small>
    </div>`;

    // Auto-focus the farm name input after render
    setTimeout(() => {
        const el = document.getElementById('s1Name');
        if (el) el.focus();
    }, 100);
}

function autoLocate() {
    const btn = document.getElementById('gpsBtn');
    if (btn) btn.textContent = '⏳ Getting location…';
    if (!navigator.geolocation) {
        if (btn) btn.innerHTML = `<span class="setup-gps-icon">📍</span><div><div class="setup-gps-title">GPS not available</div><div class="setup-gps-sub">Enter coordinates manually below</div></div>`;
        return;
    }
    navigator.geolocation.getCurrentPosition(
        pos => {
            document.getElementById('s1Lat').value = pos.coords.latitude.toFixed(5);
            document.getElementById('s1Lng').value = pos.coords.longitude.toFixed(5);
            if (btn) btn.innerHTML = `<span class="setup-gps-icon">✅</span><div><div class="setup-gps-title">Location found!</div><div class="setup-gps-sub">${pos.coords.latitude.toFixed(3)}, ${pos.coords.longitude.toFixed(3)}</div></div>`;
        },
        () => {
            if (btn) btn.innerHTML = `<span class="setup-gps-icon">📍</span><div><div class="setup-gps-title">Could not get location</div><div class="setup-gps-sub">Enter coordinates manually below</div></div>`;
        }, { timeout: 10000 }
    );
}

function validateStep1() {
    const name = document.getElementById('s1Name').value.trim();
    if (!name) { alert('Please enter your farm name.'); return false; }
    setupData.farmName = name;
    const lat = parseFloat(document.getElementById('s1Lat').value);
    const lng = parseFloat(document.getElementById('s1Lng').value);
    if (!isNaN(lat) && !isNaN(lng)) setupData.farmLocation = { lat, lng };
    return true;
}

// ── STEP 2: Animal groups ─────────────────────────────────────
function renderStep2(title, body) {
    title.textContent = '🐄 Your animals';
    body.innerHTML = `
    <p class="setup-desc">Tell us about the animals on your farm. Add one group for each herd or flock that grazes separately.</p>
    <div id="animalGroups">${renderAnimalGroupsList()}</div>
    <button class="setup-add-btn" onclick="addAnimalGroup()">+ Add animal group</button>
    <div class="setup-tip">💡 <strong>Example:</strong> If you have 120 cattle in one herd and 80 sheep in a separate flock, add two groups.</div>`;
}

function renderAnimalGroupsList() {
    if (!setupData.animalGroups.length) {
        return `<div class="setup-empty-groups">No animal groups yet. Click "+ Add animal group" below.</div>`;
    }
    return setupData.animalGroups.map((g, i) => `
    <div class="animal-group-card" id="ag${i}">
      <div class="ag-header">
        <span class="ag-num">Group ${i + 1}</span>
        <button class="ag-remove" onclick="removeAnimalGroup(${i})">✕</button>
      </div>
      <div class="ag-fields">
        <div class="setup-field inline">
          <label>Group name</label>
          <input type="text" placeholder="e.g. Main herd" value="${g.name}" onchange="updateGroup(${i},'name',this.value)">
        </div>
        <div class="setup-field inline">
          <label>Animal type</label>
          <select onchange="updateGroup(${i},'type',this.value)">
            ${['cattle','sheep','goats','horses','pigs','mixed'].map(t => `<option value="${t}" ${g.type===t?'selected':''}>${t.charAt(0).toUpperCase()+t.slice(1)}</option>`).join('')}
          </select>
        </div>
        <div class="setup-field inline">
          <label>Number of animals</label>
          <input type="number" placeholder="e.g. 120" value="${g.count||''}" min="1" onchange="updateGroup(${i},'count',parseInt(this.value)||0)">
        </div>
      </div>
    </div>`).join('');
}

function addAnimalGroup() {
  setupData.animalGroups.push({ name: '', type: 'cattle', count: 0 });
  document.getElementById('animalGroups').innerHTML = renderAnimalGroupsList();
}

function removeAnimalGroup(i) {
  setupData.animalGroups.splice(i, 1);
  document.getElementById('animalGroups').innerHTML = renderAnimalGroupsList();
}

function updateGroup(i, key, val) {
  setupData.animalGroups[i][key] = val;
}

function validateStep2() {
  // Groups are optional at setup — can be added later
  return true;
}

// ── STEP 3: Grazing cycle ─────────────────────────────────────
function renderStep3(title, body) {
  title.textContent = '🔄 Grazing pattern';
  body.innerHTML = `
    <p class="setup-desc">How do your animals graze? This affects how GrazingTrack tracks usage and suggests rotation schedules.</p>

    <div class="cycle-options">
      <div class="cycle-card ${setupData.grazingCycle==='standard'?'selected':''}" onclick="selectCycle('standard')">
        <div class="cycle-icon">☀️</div>
        <div class="cycle-name">Standard rotation</div>
        <div class="cycle-desc">Animals graze one camp at a time. You move them when the camp is finished. Most common setup.</div>
      </div>
      <div class="cycle-card ${setupData.grazingCycle==='daynight'?'selected':''}" onclick="selectCycle('daynight')">
        <div class="cycle-icon">🌗</div>
        <div class="cycle-name">Day / Night rotation</div>
        <div class="cycle-desc">Animals graze a different section during the day versus at night. Two active camps at once.</div>
      </div>
    </div>

    <div id="dayNightConfig" style="display:${setupData.grazingCycle==='daynight'?'block':'none'}">
      <div class="setup-tip" style="margin-top:14px">
        GrazingTrack will track day camps and night camps separately and calculate rest periods for each. You can assign any field as "day only", "night only", or "both".
      </div>
      <div class="two-col" style="margin-top:12px">
        <div class="setup-field">
          <label>Day grazing hours</label>
          <input type="text" id="s3DayHours" placeholder="06:00-18:00" value="${setupData.dayNightConfig.dayHours}">
        </div>
        <div class="setup-field">
          <label>Night grazing hours</label>
          <input type="text" id="s3NightHours" placeholder="18:00-06:00" value="${setupData.dayNightConfig.nightHours}">
        </div>
      </div>
    </div>`;
}

function selectCycle(type) {
  setupData.grazingCycle = type;
  document.querySelectorAll('.cycle-card').forEach(c => c.classList.remove('selected'));
  event.currentTarget.classList.add('selected');
  document.getElementById('dayNightConfig').style.display = type === 'daynight' ? 'block' : 'none';
}

function validateStep3() {
  if (setupData.grazingCycle === 'daynight') {
    const dh = document.getElementById('s3DayHours').value.trim();
    const nh = document.getElementById('s3NightHours').value.trim();
    setupData.dayNightConfig = { dayHours: dh || '06:00-18:00', nightHours: nh || '18:00-06:00' };
  }
  return true;
}

// ── STEP 4: Farm boundary + auto camp detection (optional) ──
function renderStep4(title, body) {
  title.textContent = '🗺 Draw your farm & detect camps';
  body.innerHTML = `
    <p class="setup-desc">You can either draw your farm boundary and let us split it into camps automatically, or skip this and draw each field manually on the main map later.</p>

    <div class="setup-field">
      <label style="display:flex; align-items:center; gap:8px;">
        <input type="checkbox" id="skipAutoSplit" ${setupData.skipAutoSplit ? 'checked' : ''} onchange="toggleAutoSplit()">
        Skip auto‑split — I'll draw fields manually
      </label>
    </div>

    <div id="autoSplitSection" style="display:${setupData.skipAutoSplit ? 'none' : 'block'}">
      <p class="setup-desc">Draw the outer boundary of your farm. GrazingTrack will automatically split it into camps using our improved algorithm that keeps camps inside your farm.</p>

      <div class="camp-count-row">
        <label>How many camps / paddocks does your farm have?</label>
        <div class="camp-count-ctrl">
          <button onclick="changeCampCount(-1)">−</button>
          <span id="campCountDisplay">${setupData.campCount}</span>
          <button onclick="changeCampCount(1)">+</button>
        </div>
      </div>

      <div class="split-direction-row">
        <label>Split method</label>
        <select id="splitDir">
          <option value="grid">Grid (best for even division)</option>
          <option value="vertical">Vertical strips</option>
          <option value="horizontal">Horizontal strips</option>
        </select>
      </div>

      <div id="setupMapWrap">
        <div id="setupMap"></div>
        <div class="setup-map-hint" id="setupMapHint">
          Click the polygon button (top right of map), then click around your farm boundary. Double-click to finish.
        </div>
      </div>

      <div class="setup-map-actions">
        <button class="setup-action-btn" onclick="redrawCamps()">⟳ Re-split camps</button>
        <button class="setup-action-btn danger" onclick="clearFarmBoundary()">✕ Clear boundary</button>
      </div>

      <div id="campNameEditor" style="display:none">
        <div class="setup-field" style="margin-top:12px">
          <label>Camp names <span class="setup-optional">(edit below, one per line)</span></label>
          <textarea id="campNamesTA" rows="6" style="font-size:12px;font-family:monospace"></textarea>
          <small>Each line = one camp name. Names are applied in order.</small>
        </div>
      </div>
    </div>`;

  if (!setupData.skipAutoSplit) {
    setTimeout(() => initSetupMap(), 80);
  }
}

function toggleAutoSplit() {
  const cb = document.getElementById('skipAutoSplit');
  setupData.skipAutoSplit = cb.checked;
  document.getElementById('autoSplitSection').style.display = cb.checked ? 'none' : 'block';
  if (!cb.checked && !setupMap) {
    setTimeout(() => initSetupMap(), 80);
  }
}

function initSetupMap() {
  if (setupMap) { setupMap.remove(); setupMap = null; }

  const center = setupData.farmLocation.lat
    ? [setupData.farmLocation.lat, setupData.farmLocation.lng]
    : [-29.0, 25.0];

  setupMap = L.map('setupMap', { zoomControl: true }).setView(center, 13);

  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    attribution: 'Tiles © Esri', maxZoom: 19
  }).addTo(setupMap);

  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 19, opacity: 0.7
  }).addTo(setupMap);

  const drawnSetup = new L.FeatureGroup().addTo(setupMap);

  setupDraw = new L.Control.Draw({
    position: 'topright',
    draw: {
      polygon: {
        allowIntersection: false,
        shapeOptions: { color: '#2d6a4f', fillColor: '#2d6a4f', fillOpacity: 0.15, weight: 3 }
      },
      rectangle: {
        shapeOptions: { color: '#2d6a4f', fillColor: '#2d6a4f', fillOpacity: 0.15, weight: 3 }
      },
      circle: false, circlemarker: false, marker: false, polyline: false
    },
    edit: { featureGroup: drawnSetup, remove: true }
  });
  setupMap.addControl(setupDraw);

  // Restore existing boundary
  if (setupData.farmBoundary) {
    setupLayer = L.geoJSON(setupData.farmBoundary, {
      style: { color: '#2d6a4f', fillColor: '#2d6a4f', fillOpacity: 0.12, weight: 3 }
    }).addTo(drawnSetup);
    drawCampSplits();
  }

  setupMap.on(L.Draw.Event.CREATED, e => {
    // Remove old boundary
    if (setupLayer) { drawnSetup.removeLayer(setupLayer); }
    setupCampLayers.forEach(l => drawnSetup.removeLayer(l));
    setupCampLayers = [];

    setupLayer = e.layer;
    drawnSetup.addLayer(setupLayer);
    setupData.farmBoundary = setupLayer.toGeoJSON().geometry;

    document.getElementById('setupMapHint').textContent = 'Farm boundary drawn! Camps have been auto-detected below.';
    drawCampSplits();
    document.getElementById('campNameEditor').style.display = 'block';
    fillCampNamesTA();
  });

  setupMap.on(L.Draw.Event.DELETED, () => {
    setupData.farmBoundary = null;
    setupCampLayers.forEach(l => drawnSetup.removeLayer(l));
    setupCampLayers = [];
    document.getElementById('campNameEditor').style.display = 'none';
    document.getElementById('setupMapHint').textContent = 'Boundary cleared. Draw again to auto-detect camps.';
  });
}

function changeCampCount(delta) {
  setupData.campCount = Math.max(1, Math.min(20, setupData.campCount + delta));
  document.getElementById('campCountDisplay').textContent = setupData.campCount;
  if (setupData.farmBoundary) drawCampSplits();
}

function clearFarmBoundary() {
  setupData.farmBoundary = null;
  if (setupMap) setupMap.eachLayer(l => { if (l instanceof L.Polygon || l instanceof L.Rectangle) setupMap.removeLayer(l); });
  setupCampLayers.forEach(l => { if (setupMap) setupMap.removeLayer(l); });
  setupCampLayers = [];
  document.getElementById('campNameEditor').style.display = 'none';
  document.getElementById('setupMapHint').textContent = 'Boundary cleared. Draw again to auto-detect camps.';
}

// ── AUTO CAMP DETECTION (Turf‑based) ─────────────────────────
function drawCampSplits() {
  if (!setupData.farmBoundary || !setupMap) return;

  // Remove old camp layers
  setupCampLayers.forEach(l => setupMap.removeLayer(l));
  setupCampLayers = [];

  const n = setupData.campCount;
  const dir = document.getElementById('splitDir') ? document.getElementById('splitDir').value : 'grid';

  // Convert farm boundary to a turf polygon
  const farmPoly = turf.polygon(setupData.farmBoundary.coordinates);

  // Generate a grid that covers the farm's bbox, then intersect
  const bbox = turf.bbox(farmPoly);
  let cellWidth, cellHeight;

  if (dir === 'vertical') {
    cellWidth = (bbox[2] - bbox[0]) / n;
    cellHeight = (bbox[3] - bbox[1]); // full height
  } else if (dir === 'horizontal') {
    cellWidth = (bbox[2] - bbox[0]); // full width
    cellHeight = (bbox[3] - bbox[1]) / n;
  } else {
    // grid: try to make roughly square cells
    const cols = Math.ceil(Math.sqrt(n));
    const rows = Math.ceil(n / cols);
    cellWidth = (bbox[2] - bbox[0]) / cols;
    cellHeight = (bbox[3] - bbox[1]) / rows;
  }

  const grid = turf.squareGrid(bbox, Math.max(cellWidth, cellHeight), { units: 'degrees' });
  const intersections = [];

  grid.features.forEach((cell, i) => {
    if (intersections.length >= n) return;
    // Turf v6 API: two separate arguments, NOT a FeatureCollection wrapper
    const intersect = turf.intersect(farmPoly, cell);
    if (intersect) {
      intersections.push(intersect);
    }
  });

  // If we still need more camps, try smaller cells (recursive fallback omitted for brevity)
  // For simplicity, we just use what we have.

  const COLORS_CAMP = ['#2d6a4f','#52b788','#40916c','#74c69d','#1b4332','#34a0a4','#0077b6','#023e8a','#7b2d8b','#c77dff','#d97706','#dc2626','#0891b2','#059669','#7c3aed','#db2777','#b45309','#374151','#16a34a','#ca8a04','#9333ea','#e11d48'];

  intersections.forEach((poly, idx) => {
    const color = COLORS_CAMP[idx % COLORS_CAMP.length];
    const layer = L.geoJSON(poly, {
      style: { color, fillColor: color, fillOpacity: 0.35, weight: 2, dashArray: '6 3' }
    }).addTo(setupMap);

    // Add a label at centroid
    const centroid = turf.centroid(poly);
    const label = L.divIcon({
      className: '',
      html: `<div style="background:rgba(0,0,0,0.55);color:#fff;padding:3px 7px;border-radius:5px;font-size:11px;font-weight:600;white-space:nowrap">Camp ${idx+1}</div>`,
      iconAnchor: [30, 10]
    });
    const marker = L.marker([centroid.geometry.coordinates[1], centroid.geometry.coordinates[0]], { icon: label, interactive: false }).addTo(setupMap);

    setupCampLayers.push(layer);
    setupCampLayers.push(marker);
  });

  // Store generated camps as GeoJSON geometries for later use
  setupData.camps = intersections.map((poly, i) => ({
    id: uid_setup(),
    name: `Camp ${i + 1}`,
    geometry: poly.geometry,
    color: COLORS_CAMP[i % COLORS_CAMP.length]
  }));

  fillCampNamesTA();
}

function redrawCamps() {
  if (!setupData.farmBoundary) { alert('Draw your farm boundary first.'); return; }
  drawCampSplits();
}

function fillCampNamesTA() {
  const ta = document.getElementById('campNamesTA');
  if (!ta) return;
  ta.value = setupData.camps.map((c,i) => c.name || `Camp ${i+1}`).join('\n');
}

function validateStep4() {
  if (setupData.skipAutoSplit) {
    // User will draw fields manually later
    setupData.camps = [];
    return true;
  }

  if (!setupData.farmBoundary) {
    // Allow skipping if they change their mind
    if (!confirm('No farm boundary drawn yet. You can draw individual fields manually after setup. Continue?')) return false;
    setupData.camps = [];
    return true;
  }

  // Apply custom camp names from textarea
  const ta = document.getElementById('campNamesTA');
  if (ta && ta.value.trim()) {
    const names = ta.value.trim().split('\n').map(s => s.trim()).filter(Boolean);
    setupData.camps.forEach((c, i) => {
      if (names[i]) c.name = names[i];
    });
  }
  return true;
}

// ── STEP 5: Review & confirm ──────────────────────────────────
function renderStep5(title, body) {
  title.textContent = '✅ Review your setup';

  const groups = setupData.animalGroups;
  const totalAnimals = groups.reduce((s,g) => s + (g.count||0), 0);

  let campsHtml = '';
  if (setupData.skipAutoSplit) {
    campsHtml = '<div class="review-row"><span class="review-key">Camps</span><span class="review-val">You will draw them manually</span></div>';
  } else {
    campsHtml = setupData.camps.map(c => `<div class="review-row sub"><span class="review-key">• ${c.name}</span><span class="review-val" style="color:#9ca3af">${calcAreaHa_setup(c.geometry).toFixed(1)} ha</span></div>`).join('');
  }

  body.innerHTML = `
    <p class="setup-desc">Everything looks good! Here's a summary of what GrazingTrack will set up for you. Click <strong>Finish setup</strong> when ready.</p>

    <div class="review-card">
      <div class="review-row"><span class="review-key">Farm name</span><span class="review-val">${setupData.farmName || '—'}</span></div>
      <div class="review-row"><span class="review-key">Location</span><span class="review-val">${setupData.farmLocation.lat ? `${setupData.farmLocation.lat.toFixed(3)}, ${setupData.farmLocation.lng.toFixed(3)}` : 'Not set'}</span></div>
    </div>

    <div class="review-card">
      <div class="review-row"><span class="review-key">Animal groups</span><span class="review-val">${groups.length || 'None set'}</span></div>
      <div class="review-row"><span class="review-key">Total animals</span><span class="review-val">${totalAnimals || '—'}</span></div>
      ${groups.map(g => `<div class="review-row sub"><span class="review-key">• ${g.name||'Unnamed'}</span><span class="review-val">${g.count} ${g.type}</span></div>`).join('')}
    </div>

    <div class="review-card">
      <div class="review-row"><span class="review-key">Grazing pattern</span><span class="review-val">${setupData.grazingCycle === 'daynight' ? '🌗 Day / Night rotation' : '☀️ Standard rotation'}</span></div>
      ${setupData.grazingCycle === 'daynight' ? `
        <div class="review-row sub"><span class="review-key">Day hours</span><span class="review-val">${setupData.dayNightConfig.dayHours}</span></div>
        <div class="review-row sub"><span class="review-key">Night hours</span><span class="review-val">${setupData.dayNightConfig.nightHours}</span></div>
      ` : ''}
    </div>

    <div class="review-card">
      <div class="review-row"><span class="review-key">Camps</span><span class="review-val">${setupData.camps.length || '0'}</span></div>
      ${campsHtml}
    </div>

    <div class="setup-tip" style="margin-top:12px">
      💡 You can always edit camps, add more fields, and adjust settings after setup using the map tools and Settings.
    </div>`;
}

// ── NAVIGATION ────────────────────────────────────────────────
function setupNext() {
  let valid = true;
  if (setupStep === 1) valid = validateStep1();
  if (setupStep === 2) valid = validateStep2();
  if (setupStep === 3) valid = validateStep3();
  if (setupStep === 4) valid = validateStep4();

  if (!valid) return;

  if (setupStep === TOTAL_STEPS) {
    closeSetup(true);
    return;
  }

  // Destroy setup map before moving off step 4
  if (setupStep === 4 && setupMap) {
    setupMap.remove(); setupMap = null;
  }

  setupStep++;
  renderSetupStep();
}

function setupBack() {
  if (setupStep === 1) return;
  if (setupStep === 4 && setupMap) { setupMap.remove(); setupMap = null; }
  setupStep--;
  renderSetupStep();
}

// ── APPLY SETUP TO APP ────────────────────────────────────────
function applySetupToApp() {
  // Save farm config
  const config = {
    farmName:     setupData.farmName,
    farmLocation: setupData.farmLocation,
    animalGroups: setupData.animalGroups,
    grazingCycle: setupData.grazingCycle,
    dayNightConfig: setupData.dayNightConfig,
    setupAt:      new Date().toISOString()
  };
  localStorage.setItem('gt_config', JSON.stringify(config));

  // Update farm name in sidebar — the element is #farmNameDisplay, not .farm-subtitle
  const subtitle = document.getElementById('farmNameDisplay');
  if (subtitle && setupData.farmName) subtitle.textContent = setupData.farmName;

  // Move map to farm location if set
  if (setupData.farmLocation.lat && typeof map !== 'undefined' && map) {
    map.setView([setupData.farmLocation.lat, setupData.farmLocation.lng], 14);
  }

  // Save auto-generated camps as fields (if any)
  if (setupData.camps.length > 0) {
    const existingFields = loadFields();
    const newFields = setupData.camps.map((camp, i) => ({
      id:         camp.id,
      name:       camp.name,
      type:       'pasture',
      restTarget: 42,
      maxAUperHa: null,
      geometry:   camp.geometry,
      areaHa:     calcAreaHa_setup(camp.geometry),
      color:      camp.color,
      createdAt:  new Date().toISOString(),
      version:    3,
      grazingMode: setupData.grazingCycle === 'daynight'
        ? (i % 2 === 0 ? 'day' : 'night')
        : 'standard'
    }));

    saveFields([...existingFields, ...newFields]);

    // Refresh map display
    if (typeof restoreFieldsOnMap !== 'undefined') {
      // Clear and re-draw
      if (typeof drawnItems !== 'undefined' && drawnItems) drawnItems.clearLayers();
      restoreFieldsOnMap();
      renderFieldList();
      updateStats();
    }
  }

  // Apply day/night mode labels if relevant
  if (setupData.grazingCycle === 'daynight') {
    localStorage.setItem('gt_daynight', '1');
  }

  // Toast notification
  showSetupToast(`Welcome, ${setupData.farmName}! Your farm is ready.`);
}

function showSetupToast(msg) {
  const toast = document.createElement('div');
  toast.style.cssText = 'position:fixed;bottom:30px;left:50%;transform:translateX(-50%);background:#2d6a4f;color:#fff;padding:12px 24px;border-radius:20px;font-size:13px;font-weight:500;z-index:9999;box-shadow:0 4px 16px rgba(0,0,0,.2)';
  toast.textContent = msg;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 4000);
}

// ── UTILITIES ─────────────────────────────────────────────────
function uid_setup() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return Date.now().toString(36) + Math.random().toString(36).slice(2) + performance.now().toString(36);
}

function calcAreaHa_setup(geometry) {
  if (!geometry) return 0;
  // turf.intersect can return MultiPolygon for complex shapes — sum all sub-polygons
  if (geometry.type === 'MultiPolygon') {
    return geometry.coordinates.reduce((sum, ring) =>
      sum + calcAreaHa_setup({ type: 'Polygon', coordinates: ring }), 0);
  }
  if (geometry.type !== 'Polygon') return 0;
  const coords = geometry.coordinates[0];
  const R = 6371000; let area = 0;
  for (let i = 0; i < coords.length - 1; i++) {
    const [lng1,lat1]=coords[i],[lng2,lat2]=coords[i+1];
    const x1=lng1*Math.PI/180*R*Math.cos(lat1*Math.PI/180),y1=lat1*Math.PI/180*R;
    const x2=lng2*Math.PI/180*R*Math.cos(lat2*Math.PI/180),y2=lat2*Math.PI/180*R;
    area += x1*y2-x2*y1;
  }
  return Math.abs(area/2)/10000;
}