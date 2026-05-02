// ============================================================
//  gt-dashboard.js  —  Dashboard, weather, rotation, reports,
//                       PDF generation, export/import, groups
// ============================================================
'use strict';

// ── Helpers ───────────────────────────────────────────────────
function _cardHdr(title, actionHtml = '') {
    return `<div class="card-hdr"><span class="card-title">${title}</span>${actionHtml}</div>`;
}

// ── Dashboard ─────────────────────────────────────────────────
function renderDashboard() {
    const fields = loadFields();
    const events = loadEvents();
    const today = todayStr();
    const totalHa = fields.reduce((s, f) => s + (f.areaHa || 0), 0);
    const statuses = fields.map(f => getStatus(f));
    const nGrazing = statuses.filter(s => s.cls === 'grazing').length;
    const nReady = statuses.filter(s => s.cls === 'ready').length;
    const nResting = statuses.filter(s => s.cls === 'resting').length;

    // ── KPI tiles ────────────────────────────────────────────
    const kpiEl = document.getElementById('dashGrid');
    if (kpiEl) {
        kpiEl.innerHTML = [
            { label: '🌾 Total fields', val: fields.length, bg: '#2d6a4f' },
            { label: '📐 Total area', val: totalHa.toFixed(1) + ' ha', bg: '#40916c' },
            { label: '🐄 Grazing now', val: nGrazing || '—', bg: '#16a34a' },
            { label: '✅ Ready to graze', val: nReady, bg: '#059669' },
            { label: '💤 Resting', val: nResting, bg: '#ca8a04' },
            { label: '📋 Events logged', val: events.length, bg: '#0891b2' },
        ].map(k => `
            <div class="kpi-tile" style="background:${k.bg}">
                <div class="kpi-val">${k.val}</div>
                <div class="kpi-lbl">${k.label}</div>
            </div>`).join('');
    }

    // ── Field status tiles ───────────────────────────────────
    const fsEl = document.getElementById('dashFieldStatus');
    if (fsEl) {
        if (!fields.length) {
            fsEl.innerHTML = _cardHdr('📊 Field Status') +
                '<p class="dash-empty">No fields yet — draw or auto-split to get started.</p>';
        } else {
            const CLR = { grazing: '#16a34a', ready: '#059669', resting: '#ca8a04', danger: '#dc2626', none: '#6b7280' };
            const tiles = fields.map(f => {
                const s = getStatus(f);
                const pct = getReadinessPct(f);
                return `<div class="status-tile" style="background:${CLR[s.cls]||'#6b7280'}"
                              onclick="switchTab('map');setTimeout(()=>selectField('${f.id}'),80)">
                    <div class="status-tile-name">${f.name}</div>
                    <div class="status-tile-sub">${s.label} · ${f.areaHa.toFixed(1)} ha</div>
                    <div class="st-bar-wrap"><div class="st-bar" style="width:${pct}%"></div></div>
                </div>`;
            }).join('');
            fsEl.innerHTML = _cardHdr('📊 Field Status') +
                `<div class="status-grid">${tiles}</div>`;
        }
    }

    // ── Animal groups ────────────────────────────────────────
    _renderGroupsCard();

    // ── Recent events ────────────────────────────────────────
    const reEl = document.getElementById('dashRecentEvents');
    if (reEl) {
        const recent = [...events]
            .sort((a, b) => b.loggedAt.localeCompare(a.loggedAt))
            .slice(0, 6);
        const rows = recent.length ?
            recent.map(e => {
                const f = fields.find(f => f.id === e.fieldId);
                const herdTag = e.herd ? ` <span class="ev-herd">${e.herd}</span>` : '';
                return `<div class="ev-row">
                    <span class="ev-dot" style="background:${f?.color||'#9ca3af'}"></span>
                    <div class="ev-info">
                        <div class="ev-main">${f?.name||'Unknown'} — ${e.animalCount} ${cap(e.animalType)}${herdTag}</div>
                        <div class="ev-sub">${fmtDate(e.startDate)} → ${fmtDate(e.endDate)} · ${daysBetween(e.startDate,e.endDate)} days</div>
                    </div>
                </div>`;
            }).join('') :
            '<p class="dash-empty">No grazing events logged yet.</p>';

        reEl.innerHTML = _cardHdr('📋 Recent Events',
            `<button class="card-act" onclick="openGrazingModal(null)">+ Log</button>`) + rows;
    }

    // ── Stocking summary ─────────────────────────────────────
    const stEl = document.getElementById('dashStocking');
    if (stEl) {
        const rows = fields
            .filter(f => f.maxAUperHa)
            .map(f => {
                const last = events.filter(e => e.fieldId === f.id)
                    .sort((a, b) => b.startDate.localeCompare(a.startDate))[0];
                if (!last) return null;
                const auHa = (last.animalCount / f.areaHa).toFixed(1);
                const over = last.animalCount / f.areaHa > f.maxAUperHa;
                return `<div class="stock-row${over?' over':''}">
                    <span class="stock-name">${f.name}</span>
                    <span class="stock-val">${auHa} AU/ha ${over?'⚠':'✓'}</span>
                    <span class="stock-lim">/ ${f.maxAUperHa}</span>
                </div>`;
            }).filter(Boolean);

        stEl.innerHTML = _cardHdr('🐾 Stocking Rates') +
            (rows.length ?
                rows.join('') :
                '<p class="dash-empty">Set a Max AU/ha on a field to see stocking alerts here.</p>');
    }

    // ── Weather / rainfall ───────────────────────────────────
    _renderWeatherCard();
}

// ── Animal Groups Card ─────────────────────────────────────────
function _renderGroupsCard() {
    const el = document.getElementById('dashAnimalGroups');
    if (!el) return;
    const groups = loadGroups();
    const addBtn = `<button class="card-act" onclick="openGroupModal(null)">+ Add</button>`;
    if (!groups.length) {
        el.innerHTML = _cardHdr('🐄 Animal Groups', addBtn) +
            `<div class="grp-empty-card">No groups yet — add a herd or flock to quickly log grazing events.</div>`;
        return;
    }
    const rows = groups.map(g => `
        <div class="grp-row">
            <div class="grp-row-icon">${_groupEmoji(g.type)}</div>
            <div class="grp-row-info">
                <div class="grp-row-name">${g.name}</div>
                <div class="grp-row-sub">${g.count} ${cap(g.type)}${g.herd?' · '+g.herd:''}</div>
            </div>
            <div class="grp-row-actions">
                <button class="grp-btn" title="Log grazing" onclick="openGrazingModalForGroup('${g.id}')">🐄</button>
                <button class="grp-btn" title="Edit" onclick="openGroupModal('${g.id}')">✎</button>
                <button class="grp-btn red" title="Delete" onclick="deleteGroup('${g.id}')">✕</button>
            </div>
        </div>`).join('');
    el.innerHTML = _cardHdr('🐄 Animal Groups', addBtn) + `<div class="grp-list">${rows}</div>`;
}

// ── Group Modal ───────────────────────────────────────────────
function openGroupModal(groupId) {
    const groups = loadGroups();
    const g = groupId ? groups.find(g => g.id === groupId) : null;
    document.getElementById('groupModalTitle').textContent = g ? '✎ Edit animal group' : '🐄 Add animal group';
    document.getElementById('groupEditId').value = g ? g.id : '';
    document.getElementById('groupName').value = g ? g.name : '';
    document.getElementById('groupType').value = g ? g.type : 'cattle';
    document.getElementById('groupCount').value = g ? g.count : '';
    document.getElementById('groupHerd').value = g ? (g.herd || '') : '';
    openModal('modalGroup');
    setTimeout(() => document.getElementById('groupName').focus(), 80);
}

function saveGroup() {
    const name = document.getElementById('groupName').value.trim();
    const type = document.getElementById('groupType').value;
    const count = parseInt(document.getElementById('groupCount').value);
    const herd = document.getElementById('groupHerd').value.trim();
    const editId = document.getElementById('groupEditId').value;

    if (!name) { alert('Please enter a group name.'); return; }
    if (!count || count < 1) { alert('Enter a valid number of animals.'); return; }

    const groups = loadGroups();
    let newId = editId;
    if (editId) {
        const idx = groups.findIndex(g => g.id === editId);
        if (idx !== -1) groups[idx] = {...groups[idx], name, type, count, herd };
    } else {
        newId = 'grp-' + Date.now().toString(36);
        groups.push({ id: newId, name, type, count, herd });
    }
    saveGroups(groups);
    closeModal('modalGroup');
    _renderGroupsCard();

    if (window._addingGroupFromGrazing) {
        _groupSavedFromGrazing(newId);
    }
}

function deleteGroup(groupId) {
    if (!confirm('Delete this animal group?')) return;
    saveGroups(loadGroups().filter(g => g.id !== groupId));
    _renderGroupsCard();
}

// ── Weather ───────────────────────────────────────────────────
const _WX = {
    0: '☀️',
    1: '🌤',
    2: '⛅',
    3: '☁️',
    45: '🌫',
    48: '🌫',
    51: '🌦',
    53: '🌧',
    55: '🌧',
    61: '🌧',
    63: '🌧',
    65: '🌧',
    71: '❄️',
    73: '❄️',
    75: '❄️',
    80: '🌦',
    81: '🌧',
    82: '⛈',
    95: '⛈',
    96: '⛈',
    99: '⛈'
};

function _wxIcon(c) { return _WX[c] || '🌡'; }

function _renderWeatherCard() {
    const el = document.getElementById('dashRainfall');
    if (!el) return;
    let lat, lng;
    try {
        const cfg = JSON.parse(localStorage.getItem('gt_config') || '{}');
        lat = cfg.lat || cfg.farmLocation?.lat;
        lng = cfg.lng || cfg.farmLocation?.lng;
    } catch (e) {}

    if (!lat || !lng) {
        el.innerHTML = _cardHdr('🌦 Rainfall & Weather') +
            '<p class="dash-empty">Set your farm location in Setup (⚙️) to see weather data.</p>';
        return;
    }

    el.innerHTML = _cardHdr('🌦 Rainfall & Weather') +
        '<p class="dash-empty" id="wxLoading">Loading weather…</p>';

    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}` +
        `&daily=precipitation_sum,weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max` +
        `&past_days=7&forecast_days=7&timezone=auto`;

    fetch(url).then(r => r.json()).then(data => {
                if (!data.daily) throw new Error('no data');
                const {
                    time,
                    precipitation_sum: rain,
                    weather_code: wc,
                    temperature_2m_max: tmax,
                    temperature_2m_min: tmin,
                    precipitation_probability_max: prob
                } = data.daily;
                const today = todayStr();
                const pastIdx = time.map((t, i) => t < today ? i : null).filter(i => i !== null);
                const todayIdx = time.indexOf(today);
                const futureIdx = time.map((t, i) => t > today ? i : null).filter(i => i !== null);
                const maxR = Math.max(...pastIdx.map(i => rain[i] || 0), 1);

                const rainBars = pastIdx.map(i => {
                    const h = Math.round(((rain[i] || 0) / maxR) * 52);
                    const lbl = new Date(time[i]).toLocaleDateString('en', { weekday: 'short' }).slice(0, 2);
                    return `<div class="rain-bar-wrap" title="${(rain[i]||0).toFixed(1)} mm">
                <div class="rain-bar" style="height:${h}px"></div>
                <div class="rain-lbl">${lbl}</div>
            </div>`;
                }).join('');
                const totalPast = pastIdx.reduce((s, i) => s + (rain[i] || 0), 0);

                const fcDays = [todayIdx, ...futureIdx.slice(0, 6)].filter(i => i !== null && i >= 0);
                const fcCards = fcDays.map((i, fi) => {
                            const day = fi === 0 ? 'Today' : new Date(time[i]).toLocaleDateString('en', { weekday: 'short' });
                            const r = (rain[i] || 0).toFixed(1);
                            const p = prob[i] != null ? prob[i] + '%' : '';
                            return `<div class="fc-card ${fi===0?'fc-today':''}">
                <div class="fc-day">${day}</div>
                <div class="fc-icon">${_wxIcon(wc[i])}</div>
                <div class="fc-temp">${Math.round(tmax[i]||0)}°</div>
                <div class="fc-tmin">${Math.round(tmin[i]||0)}°</div>
                ${+r>0?`<div class="fc-rain">${r}<span class="fc-unit">mm</span></div>`:''}
                ${p?`<div class="fc-prob">${p}</div>`:''}
            </div>`;
        }).join('');

        el.innerHTML = _cardHdr('🌦 Rainfall & Weather') + `
            <div class="rain-section-lbl">Past 7 days</div>
            <div class="rain-bars">${rainBars}</div>
            <div class="rain-total">${totalPast.toFixed(1)} mm total</div>
            <div class="rain-section-lbl" style="margin-top:12px">Forecast</div>
            <div class="fc-row">${fcCards}</div>`;
    }).catch(() => {
        const lEl = el.querySelector('#wxLoading');
        if (lEl) lEl.textContent = 'Weather unavailable — check your connection or set your location in Setup.';
    });
}

// ── Rotation Planner ──────────────────────────────────────────
function renderRotation() {
    const fields = loadFields();
    const heroEl = document.getElementById('rotationHero');
    const listEl = document.getElementById('rotationList');

    if (!fields.length) {
        if (heroEl) heroEl.innerHTML = '<p class="dash-empty" style="padding:24px">No fields yet. Draw paddocks on the Map tab to start planning rotations.</p>';
        if (listEl) listEl.innerHTML = '';
        return;
    }

    const CLR = { grazing:'#16a34a', ready:'#059669', resting:'#ca8a04', danger:'#dc2626', none:'#6b7280' };
    const sorted = [...fields].map(f => ({
        f, pct: getReadinessPct(f), s: getStatus(f)
    })).sort((a,b) => b.pct - a.pct);

    const best = sorted[0];
    if (heroEl) {
        const evts   = loadEvents().filter(e=>e.fieldId===best.f.id).sort((a,b)=>b.endDate.localeCompare(a.endDate));
        const last   = evts[0];
        const restDays = last ? daysSince(last.endDate) : null;
        const c = CLR[best.s.cls]||'#6b7280';
        heroEl.innerHTML = `
            <div class="rot-hero-card" style="border-left:4px solid ${c}">
                <div class="rot-hero-lbl">🏆 Next recommended camp</div>
                <div class="rot-hero-name">${best.f.name}</div>
                <div class="rot-hero-meta">${best.f.areaHa.toFixed(1)} ha · ${best.s.label}${restDays!==null?' · '+restDays+' days resting':''}</div>
                <div class="rot-hero-bar-wrap"><div class="rot-hero-bar" style="width:${best.pct}%;background:${c}"></div></div>
                <div class="rot-hero-pct">${best.pct}% ready</div>
                <button class="btn-primary" style="margin-top:12px" onclick="openGrazingModal('${best.f.id}')">🐄 Graze this camp</button>
            </div>`;
    }

    if (listEl) {
        listEl.innerHTML = sorted.map(({f, pct, s}) => {
            const evts = loadEvents().filter(e=>e.fieldId===f.id).sort((a,b)=>b.endDate.localeCompare(a.endDate));
            const last = evts[0];
            const restDays = last ? daysSince(last.endDate) : null;
            const c = CLR[s.cls]||'#6b7280';
            return `<div class="rot-row" onclick="switchTab('map');setTimeout(()=>selectField('${f.id}'),80)">
                <span class="rot-dot" style="background:${f.color}"></span>
                <div class="rot-info">
                    <div class="rot-name">${f.name}</div>
                    <div class="rot-meta">${f.areaHa.toFixed(1)} ha${restDays!==null?' · '+restDays+'d rest':''}</div>
                    <div class="rot-bar-wrap"><div class="rot-bar" style="width:${pct}%;background:${c}"></div></div>
                </div>
                <div class="rot-right">
                    <span class="pill pill-${s.cls}">${s.label}</span>
                    <div class="rot-pct" style="color:${c}">${pct}%</div>
                    <button class="grp-btn" title="Graze now" onclick="event.stopPropagation();openGrazingModal('${f.id}')">🐄</button>
                </div>
            </div>`;
        }).join('');
    }
}

// ── Reports Page ──────────────────────────────────────────────
function renderReports() {
    const el = document.getElementById('reportsPage');
    if (!el) return;
    el.innerHTML = `
        <div class="sv">
            <div class="card">
                ${_cardHdr('📊 Farm Reports')}
                <div class="rep-section">
                    <div class="rep-title">Generate PDF Reports</div>
                    <div class="rep-actions">
                        <button class="rep-btn" onclick="exportPDF('summary')">📄 Farm Summary</button>
                        <button class="rep-btn" onclick="exportPDF('fields')">🌾 Fields Report</button>
                        <button class="rep-btn" onclick="exportPDF('events')">📋 Grazing History</button>
                        <button class="rep-btn" onclick="exportPDF('stocking')">🐾 Stocking Rates</button>
                    </div>
                </div>
                <div class="rep-section">
                    <div class="rep-title">Export Data</div>
                    <button class="exp-row" onclick="exportJSON()">💾 JSON backup (full restore)</button>
                    <button class="exp-row" onclick="exportGeoJSON()">🗺️ GeoJSON fields</button>
                    <button class="exp-row" onclick="exportCSV()">📊 Events CSV</button>
                </div>
                <div class="rep-section">
                    <div class="rep-title">Import</div>
                    <label class="exp-row">⬆️ Import JSON backup<input type="file" accept=".json" onchange="importJSON(event)" style="display:none"></label>
                </div>
                <div class="rep-section">
                    <div class="rep-title">Danger Zone</div>
                    <button class="danger-btn" onclick="clearAllData()">⚠️ Clear all data</button>
                </div>
            </div>
        </div>`;
}

// ── PDF Export ────────────────────────────────────────────────
function exportPDF(type) {
    if (!window.jspdf || !window.jspdf.jsPDF) { alert('PDF library not loaded yet. Try again in a moment.'); return; }
    const { jsPDF } = window.jspdf;
    const doc    = new jsPDF();
    const fields = loadFields();
    const events = loadEvents();
    const today  = todayStr();
    let cfg = {};
    try { cfg = JSON.parse(localStorage.getItem('gt_config') || '{}'); } catch(e) {}

    doc.setFont('helvetica','bold');
    doc.setFontSize(18);
    doc.setTextColor(45,106,79);
    doc.text('GrazingTrack Report', 14, 20);
    doc.setFont('helvetica','normal');
    doc.setFontSize(10);
    doc.setTextColor(107,114,128);
    doc.text(`Farm: ${cfg.farmName||'—'}  |  Date: ${fmtDate(today)}  |  Fields: ${fields.length}`, 14, 28);

    let y = 38;
    const _newline = (n=6) => { y += n; if (y>275) { doc.addPage(); y=20; } };
    const _hdr = txt => { doc.setFont('helvetica','bold'); doc.setFontSize(13); doc.setTextColor(45,106,79); doc.text(txt,14,y); _newline(8); };
    const _row = (label, val) => { doc.setFont('helvetica','normal'); doc.setFontSize(9); doc.setTextColor(100,100,100); doc.text(label,18,y); doc.setTextColor(30,30,30); doc.text(String(val||''),80,y); _newline(6); };

    if (type==='summary'||type==='fields') {
        _hdr('Fields');
        fields.forEach(f => _row(f.name, `${f.areaHa.toFixed(2)} ha — ${getStatus(f).label} — Target: ${f.restTarget}d`));
        _newline(4);
    }
    if (type==='summary'||type==='events') {
        _hdr('Grazing Events (last 30)');
        [...events].sort((a,b)=>b.startDate.localeCompare(a.startDate)).slice(0,30).forEach(e => {
            const f = fields.find(f=>f.id===e.fieldId);
            _row(f?.name||'?', `${fmtDate(e.startDate)} → ${fmtDate(e.endDate)} | ${e.animalCount} ${e.animalType}${e.herd?' ('+e.herd+')':''}`);
        });
        _newline(4);
    }
    if (type==='stocking') {
        _hdr('Stocking Rates');
        fields.forEach(f => {
            const last = events.filter(e=>e.fieldId===f.id).sort((a,b)=>b.startDate.localeCompare(a.startDate))[0];
            _row(f.name, last ? `${(last.animalCount/f.areaHa).toFixed(2)} AU/ha${f.maxAUperHa?' / '+f.maxAUperHa+' limit':''}` : 'No events');
        });
    }

    doc.setFont('helvetica','italic'); doc.setFontSize(8); doc.setTextColor(160,160,160);
    doc.text('Generated by GrazingTrack — free & open source', 14, 290);
    doc.save(`GrazingTrack_${type}_${today}.pdf`);
}

// ── Export / Import ───────────────────────────────────────────
function exportJSON() {
    let cfg = {};
    try { cfg = JSON.parse(localStorage.getItem('gt_config') || '{}'); } catch(e) {}
    const data = { version: DB_VERSION, exportedAt: new Date().toISOString(),
                   config: cfg, fields: loadFields(), events: loadEvents(), groups: loadGroups() };
    download(`GrazingTrack_backup_${todayStr()}.json`, JSON.stringify(data, null, 2), 'application/json');
    setStatus('Backup exported.');
}

function exportGeoJSON() {
    const fc = { type:'FeatureCollection', features: loadFields().map(f => ({
        type:'Feature', geometry: f.geometry,
        properties:{ id:f.id, name:f.name, type:f.type, areaHa:f.areaHa, restTarget:f.restTarget, color:f.color }
    }))};
    download(`GrazingTrack_fields_${todayStr()}.geojson`, JSON.stringify(fc, null, 2), 'application/geo+json');
    setStatus('GeoJSON exported.');
}

function exportCSV() {
    const fields = loadFields();
    const events = loadEvents();
    const header = 'Field,Start,End,Days,AnimalType,Count,Herd,AU_per_ha,Notes,LoggedAt';
    const rows = [...events].sort((a,b)=>b.startDate.localeCompare(a.startDate)).map(e => {
        const f   = fields.find(f=>f.id===e.fieldId);
        const auHa = f ? (e.animalCount/f.areaHa).toFixed(2) : '';
        const q   = s => `"${String(s||'').replace(/"/g,'""')}"`;
        return [q(f?.name||''),e.startDate,e.endDate,daysBetween(e.startDate,e.endDate),
                e.animalType,e.animalCount,q(e.herd||''),auHa,q(e.notes||''),e.loggedAt].join(',');
    });
    download(`GrazingTrack_events_${todayStr()}.csv`, [header,...rows].join('\n'), 'text/csv');
    setStatus('CSV exported.');
}

function importJSON(evt) {
    const file = evt.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = e => {
        try {
            const data = JSON.parse(e.target.result);
            if (!data.fields && !data.events) throw new Error('Unrecognised file format.');
            if (!confirm(`Import backup?\n\nThis will MERGE with your existing data. No data will be deleted.`)) return;
            const _merge = (loader, saver, key) => {
                if (!data[key]?.length) return;
                const existing = loader();
                const ids = new Set(existing.map(x=>x.id));
                saver([...existing, ...data[key].filter(x=>!ids.has(x.id))]);
            };
            _merge(loadFields,  saveFields,  'fields');
            _merge(loadEvents,  saveEvents,  'events');
            _merge(loadGroups,  saveGroups,  'groups');
            if (data.config) try { localStorage.setItem('gt_config', JSON.stringify(data.config)); } catch(e) {}
            if (typeof restoreFieldsOnMap !== 'undefined') {
                drawnItems.clearLayers(); restoreFieldsOnMap(); renderFieldList(); updateStats();
            }
            renderDashboard();
            setStatus('Import successful.');
            alert('Import complete! Check your fields on the Map tab.');
        } catch(err) { alert('Import failed: ' + err.message); }
    };
    reader.readAsText(file);
    evt.target.value = '';
}

function clearAllData() {
    if (!confirm('Delete ALL data?\n\nThis cannot be undone. Export a backup first.')) return;
    if (!confirm('Second confirmation: permanently delete all fields, events and groups?')) return;
    ['gt_fields','gt_events','gt_groups','gt_config','gt_setup_done'].forEach(k => localStorage.removeItem(k));
    if (typeof drawnItems!=='undefined' && drawnItems) drawnItems.clearLayers();
    if (typeof renderFieldList!=='undefined') { renderFieldList(); updateStats(); }
    renderDashboard();
    setStatus('All data cleared.');
    closeModal('modalExport');
}