// ============================================================
//  gt-dashboard.js  —  Dashboard, rainfall/weather, rotation,
//                       reports, PDF generation, export/import
// ============================================================
'use strict';

// ── Dashboard ─────────────────────────────────────────────────
function renderDashboard() {
    const fields = loadFields();
    const events = loadEvents();
    const moisture = loadMoisture();
    const today = todayStr();
    const thisMonth = today.slice(0, 7);
    const totalHa = fields.reduce((s, f) => s + f.areaHa, 0);
    const statuses = fields.map(f => getStatus(f));
    const nG = statuses.filter(s => s.cls === 'grazing').length;
    const nR = statuses.filter(s => s.cls === 'ready').length;
    const nRe = statuses.filter(s => s.cls === 'resting').length;
    const nD = statuses.filter(s => s.cls === 'danger').length;
    const evM = events.filter(e => e.startDate.startsWith(thisMonth)).length;

    document.getElementById('dashGrid').innerHTML = [
        { label: 'Total fields', val: fields.length, sub: totalHa.toFixed(1) + ' ha' },
        { label: 'Grazing now', val: nG, sub: nG ? 'fields active' : 'none active' },
        { label: 'Ready to graze', val: nR, sub: 'rest target met' },
        { label: 'Events this month', val: evM, sub: thisMonth },
        { label: 'Resting', val: nRe, sub: 'building up' },
        { label: 'Need rest', val: nD, sub: nD ? '⚠ check these' : 'all ok' }
    ].map(c => `<div class="kpi">
        <div class="kpi-lbl">${c.label}</div>
        <div class="kpi-val">${c.val}</div>
        <div class="kpi-sub">${c.sub}</div>
    </div>`).join('');

    document.getElementById('dashFieldStatus').innerHTML = `
        <div class="card-title">Field status overview</div>
        ${fields.length
            ? `<div class="status-grid">${fields.map(f => {
                const s  = getStatus(f);
                const bg = statusFillColor(f);
                return `<div class="status-tile" style="background:${bg}"
                    onclick="switchTab('map');setTimeout(()=>selectField('${f.id}'),100)">
                    <div class="status-tile-name">${f.name}</div>
                    <div class="status-tile-sub">${f.areaHa.toFixed(1)} ha · ${s.label}</div>
                </div>`;
              }).join('')}</div>`
            : '<p style="color:#9ca3af;font-size:12px">No fields yet.</p>'}`;

    const recent = events.slice().sort((a, b) => b.startDate.localeCompare(a.startDate)).slice(0, 8);
    document.getElementById('dashRecentEvents').innerHTML = `
        <div class="card-title">Recent grazing events</div>
        ${recent.length
            ? `<table class="htbl"><thead><tr><th>Field</th><th>Start</th><th>Animals</th><th>Days</th></tr></thead>
               <tbody>${recent.map(e => {
                   const f = fields.find(x => x.id === e.fieldId);
                   return `<tr>
                       <td>${f ? f.name : '—'}</td>
                       <td>${fmtDate(e.startDate)}</td>
                       <td>${e.animalCount} ${e.animalType}</td>
                       <td>${daysBetween(e.startDate, e.endDate)}</td>
                   </tr>`;
               }).join('')}</tbody></table>`
            : '<p class="no-history">No events logged yet.</p>'}`;

    const si = fields.map(f => {
        const fe = events.filter(e => e.fieldId === f.id).sort((a, b) => b.startDate.localeCompare(a.startDate));
        if (!fe.length) return null;
        const last = fe[0];
        const auHa = (last.animalCount / f.areaHa).toFixed(1);
        const over = f.maxAUperHa && (last.animalCount / f.areaHa) > f.maxAUperHa;
        return `<div class="detail-row">
            <span class="detail-key">${f.name}</span>
            <span class="detail-val" style="color:${over ? '#dc2626' : '#166534'}">${auHa} AU/ha ${over ? '⚠' : ''}</span>
        </div>`;
    }).filter(Boolean);
    document.getElementById('dashStocking').innerHTML =
        `<div class="card-title">Stocking rates</div>` +
        (si.length ? si.join('') : '<p style="color:#9ca3af;font-size:12px">No events yet.</p>');

    const mByF = {};
    moisture.forEach(r => { if (!mByF[r.fieldId] || r.date > mByF[r.fieldId].date) mByF[r.fieldId] = r; });
    const mRows = fields.map(f => {
        const r = mByF[f.id];
        if (!r) return `<tr><td>${f.name}</td><td colspan="3" style="color:#9ca3af">No readings</td></tr>`;
        const bar = `<div style="height:5px;background:#f0ede7;border-radius:4px;overflow:hidden;margin-top:2px">
            <div style="width:${r.moisture_pct}%;height:100%;background:#60a5fa;border-radius:4px"></div>
        </div>`;
        return `<tr><td>${f.name}</td><td>${r.moisture_pct}%${bar}</td><td>${r.depth_cm}cm</td><td>${fmtDate(r.date)}</td></tr>`;
    });
    document.getElementById('dashSoilMoisture').innerHTML = `
        <div class="card-title">Soil moisture — latest readings
            <button class="detail-btn" style="float:right;padding:3px 8px;font-size:10px"
                onclick="openMoistureModal(null)">+ Add</button>
        </div>
        ${fields.length
            ? `<table class="htbl"><thead><tr><th>Field</th><th>Moisture</th><th>Depth</th><th>Date</th></tr></thead>
               <tbody>${mRows.join('')}</tbody></table>`
            : '<p style="color:#9ca3af;font-size:12px">No fields yet.</p>'}`;

    fetchRainfall();
}

// ── Rainfall & 7-day forecast ─────────────────────────────────
function getFarmCenter() {
    const fields = loadFields();
    if (!fields.length) return null;
    const lats = [], lngs = [];
    fields.forEach(f => f.geometry.coordinates[0].forEach(([lng, lat]) => { lats.push(lat); lngs.push(lng); }));
    return { lat: (Math.min(...lats) + Math.max(...lats)) / 2, lng: (Math.min(...lngs) + Math.max(...lngs)) / 2 };
}

// Map WMO weather interpretation codes to a display emoji + label.
function wmoInfo(code) {
    if (code === 0)  return { icon: '☀️',  desc: 'Clear' };
    if (code <= 2)   return { icon: '🌤',  desc: 'Partly cloudy' };
    if (code === 3)  return { icon: '☁️',  desc: 'Overcast' };
    if (code <= 48)  return { icon: '🌫️', desc: 'Foggy' };
    if (code <= 55)  return { icon: '🌦️', desc: 'Drizzle' };
    if (code <= 65)  return { icon: '🌧️', desc: 'Rain' };
    if (code <= 75)  return { icon: '❄️',  desc: 'Snow' };
    if (code === 77) return { icon: '🌨️', desc: 'Snow grains' };
    if (code <= 82)  return { icon: '🌧️', desc: 'Showers' };
    if (code <= 86)  return { icon: '🌨️', desc: 'Snow showers' };
    if (code === 95) return { icon: '⛈️', desc: 'Thunderstorm' };
    return { icon: '⛈️', desc: 'Severe storm' };
}

function dayAbbr(dateStr) {
    return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(dateStr + 'T12:00:00').getDay()];
}

async function fetchRainfall() {
    const el = document.getElementById('dashRainfall');
    if (!el) return;
    el.innerHTML = '<div class="card-title">🌧 Rainfall &amp; Forecast</div><p style="color:#9ca3af;font-size:12px;padding:8px 0">Loading weather data…</p>';

    const center = getFarmCenter();
    if (!center) {
        el.innerHTML = '<div class="card-title">🌧 Rainfall &amp; Forecast</div><p style="color:#9ca3af;font-size:12px">Add fields to see rainfall for your farm location.</p>';
        return;
    }

    try {
        // Single call: 14 days history + 7 days forecast.
        // weathercode, temp max/min, precipitation, and rain probability.
        const url =
            `https://api.open-meteo.com/v1/forecast` +
            `?latitude=${center.lat.toFixed(4)}&longitude=${center.lng.toFixed(4)}` +
            `&daily=weathercode,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max` +
            `&past_days=14&forecast_days=7&timezone=auto`;

        const res  = await fetch(url);
        if (!res.ok) throw new Error();
        const data = await res.json();
        const { time: dates, weathercode: codes, temperature_2m_max: tMax, temperature_2m_min: tMin,
                precipitation_sum: rain, precipitation_probability_max: rainProb } = data.daily;

        const today   = todayStr();
        const histIdx = dates.reduce((acc, d, i) => { if (d < today)  acc.push(i); return acc; }, []);
        const fcIdx   = dates.reduce((acc, d, i) => { if (d >= today) acc.push(i); return acc; }, []);

        const total14 = histIdx.reduce((s, i) => s + (rain[i] || 0), 0);
        const maxR    = Math.max(...histIdx.map(i => rain[i] || 0), 1);

        // History bars
        const histBars = histIdx.map(i => {
            const h       = Math.max(3, Math.round((rain[i] || 0) / maxR * 52));
            const label   = dates[i].slice(5).replace('-', '/');
            const showLbl = histIdx.indexOf(i) % 3 === 0;
            return `<div class="rain-bar-wrap" title="${dates[i]}: ${(rain[i] || 0).toFixed(1)} mm">
                <div class="rain-bar" style="height:${h}px"></div>
                <div class="rain-lbl">${showLbl ? label : ''}</div>
            </div>`;
        }).join('');

        // Forecast cards
        const fcCards = fcIdx.map(i => {
            const w       = wmoInfo(codes[i] || 0);
            const isToday = dates[i] === today;
            const rAmt    = (rain[i] || 0).toFixed(1);
            const prob    = rainProb[i] != null ? rainProb[i] + '%' : '—';
            const maxT    = tMax[i] != null ? Math.round(tMax[i]) + '°' : '—';
            const minT    = tMin[i] != null ? Math.round(tMin[i]) + '°' : '—';
            return `<div class="fc-card${isToday ? ' fc-today' : ''}">
                <div class="fc-day">${isToday ? 'Today' : dayAbbr(dates[i])}</div>
                <div class="fc-icon" title="${w.desc}">${w.icon}</div>
                <div class="fc-temp">${maxT}<span class="fc-tmin"> / ${minT}</span></div>
                <div class="fc-rain">${rAmt}<span class="fc-unit">mm</span></div>
                <div class="fc-prob" title="Rain probability">${prob} 💧</div>
            </div>`;
        }).join('');

        el.innerHTML = `
            <div class="card-title">🌧 Rainfall &amp; 7-Day Forecast</div>
            <div class="rain-section-lbl">Past 14 days</div>
            <div class="rain-bars">${histBars}</div>
            <div class="rain-total">14-day total: <strong>${total14.toFixed(1)} mm</strong></div>
            <div class="rain-section-lbl" style="margin-top:14px">Forecast</div>
            <div class="fc-row">${fcCards}</div>
            <div style="font-size:10px;color:#9ca3af;margin-top:8px">
                Weather: <a href="https://open-meteo.com" target="_blank" style="color:#9ca3af">Open-Meteo.com</a> (free &amp; open source)
            </div>`;
    } catch (err) {
        el.innerHTML = '<div class="card-title">🌧 Rainfall &amp; Forecast</div><p style="color:#9ca3af;font-size:12px">Could not load — check internet connection.</p>';
    }
}

// ── Rotation recommendations ──────────────────────────────────
function renderRotation() {
    const fields = loadFields();
    const hero   = document.getElementById('rotationHero');
    const list   = document.getElementById('rotationList');

    if (!fields.length) {
        hero.innerHTML = '<div class="rh-label">No fields yet</div><div class="rh-sub">Add fields to see rotation recommendations.</div>';
        list.innerHTML = '';
        return;
    }

    const scored = fields.map(f => {
        const pct    = getReadinessPct(f);
        const status = getStatus(f);
        const evs    = loadEvents().filter(e => e.fieldId === f.id).sort((a, b) => b.startDate.localeCompare(a.startDate));
        const last   = evs[0];
        const restDays    = last ? Math.max(0, daysSince(last.endDate)) : null;
        const daysToReady = last && restDays < f.restTarget ? f.restTarget - restDays : 0;
        return { field: f, pct, status, restDays, daysToReady };
    }).sort((a, b) => b.pct - a.pct);

    const best = scored.find(s => s.status.cls === 'ready' || s.status.cls === 'none');
    if (best) {
        hero.innerHTML = `
            <div class="rh-label">Recommended next field</div>
            <div class="rh-name">${best.field.name}</div>
            <div class="rh-sub">${best.field.areaHa.toFixed(1)} ha · ${best.pct}% rest complete · ${cap(best.field.type)}</div>`;
    } else {
        const soonest = scored.filter(s => s.daysToReady > 0).sort((a, b) => a.daysToReady - b.daysToReady)[0];
        hero.innerHTML = `
            <div class="rh-label" style="color:#854d0e">No fields ready yet</div>
            <div class="rh-name" style="color:#92400e;font-size:18px">
                ${soonest ? soonest.field.name + ' ready in ' + soonest.daysToReady + ' days' : 'All fields need more rest'}
            </div>
            <div class="rh-sub">Allow fields to complete their rest period.</div>`;
    }

    list.innerHTML = scored.map(({ field, pct, status, restDays, daysToReady }) => {
        const bc = pct >= 100 ? '#22c55e' : pct >= 60 ? '#facc15' : '#f87171';
        return `<div class="rot-item" onclick="switchTab('map');setTimeout(()=>selectField('${field.id}'),100)">
            <div class="rot-top">
                <div>
                    <div class="rot-name">${field.name}</div>
                    <div class="rot-meta">${field.areaHa.toFixed(1)} ha · ${restDays !== null ? restDays + 'd resting' : 'never grazed'} · target ${field.restTarget}d</div>
                </div>
                <span class="pill pill-${status.cls}">${status.label}</span>
            </div>
            <div class="prog-wrap"><div class="prog-fill" style="width:${pct}%;background:${bc}"></div></div>
            <div class="prog-labels">
                <span>Rest: ${pct}%</span>
                <span>${daysToReady > 0 ? 'Ready in ' + daysToReady + 'd' : pct >= 100 ? '✓ Ready now' : 'Grazing'}</span>
            </div>
        </div>`;
    }).join('');
}

// ── Reports page ──────────────────────────────────────────────
function renderReports() {
    document.getElementById('reportsPage').innerHTML = `
        <div class="rep-section">
            <div class="rep-title">PDF Farm Report</div>
            <p style="font-size:12px;color:#6b7280;margin-bottom:12px;line-height:1.6">Generate a printable PDF with field summaries, grazing history, and stocking rates.</p>
            <div class="rep-actions"><button class="rep-btn" onclick="generatePDF()">⬇ Download PDF report</button></div>
        </div>
        <div class="rep-section">
            <div class="rep-title">Data Export</div>
            <p style="font-size:12px;color:#6b7280;margin-bottom:10px;line-height:1.6">All your data stays on your device. Export at any time to back up or use with other tools.</p>
            <div class="rep-actions">
                <button class="rep-btn" onclick="exportJSON()">⬇ JSON backup</button>
                <button class="rep-btn" onclick="exportGeoJSON()">⬇ GeoJSON fields</button>
                <button class="rep-btn" onclick="exportCSV()">⬇ Events CSV</button>
                <button class="rep-btn" onclick="exportSensorCSV()">⬇ Soil moisture CSV</button>
            </div>
        </div>
        <div class="rep-section">
            <div class="rep-title">Interoperability</div>
            <p style="font-size:12px;color:#6b7280;line-height:1.7">
                GrazingTrack uses open standards — your data is never locked in.<br>
                • <strong>GeoJSON</strong> — field boundaries open in QGIS, ArcGIS, Google Earth<br>
                • <strong>Events CSV</strong> — grazing history opens in Excel, LibreOffice, Google Sheets<br>
                • <strong>Soil moisture CSV</strong> — moisture readings in a spreadsheet-ready format<br>
                • <strong>JSON backup</strong> — full restore to any GrazingTrack instance
            </p>
        </div>`;
}

// ── PDF generation ────────────────────────────────────────────
function generatePDF() {
    if (typeof window.jspdf === 'undefined') { alert('PDF library loading, try again in a moment.'); return; }
    const { jsPDF } = window.jspdf;
    const doc    = new jsPDF();
    const fields = loadFields();
    const events = loadEvents();

    doc.setFillColor(45, 106, 79);
    doc.rect(0, 0, 210, 24, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(18);
    doc.setFont('helvetica', 'bold');
    doc.text('GrazingTrack — Farm Report', 14, 16);
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.text(`Generated: ${new Date().toLocaleDateString()}`, 150, 16);

    let y = 34;
    doc.setTextColor(0, 0, 0);
    doc.setFontSize(13);
    doc.setFont('helvetica', 'bold');
    doc.text('Farm Summary', 14, y);
    y += 6;
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(80, 80, 80);
    const totalHa = fields.reduce((s, f) => s + f.areaHa, 0);
    doc.text(`Fields: ${fields.length}   Area: ${totalHa.toFixed(1)} ha   Events: ${events.length}`, 14, y);
    y += 10;

    doc.setTextColor(0, 0, 0);
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.text('Fields', 14, y);
    y += 5;
    doc.setFillColor(240, 253, 244);
    doc.rect(14, y, 182, 7, 'F');
    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(22, 101, 52);
    doc.text('Name', 16, y + 5);
    doc.text('Area (ha)', 70, y + 5);
    doc.text('Type', 100, y + 5);
    doc.text('Status', 130, y + 5);
    doc.text('Rest', 162, y + 5);
    y += 9;
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(0, 0, 0);
    fields.forEach((f, i) => {
        if (y > 270) { doc.addPage(); y = 20; }
        if (i % 2 === 0) { doc.setFillColor(250, 250, 248); doc.rect(14, y - 1, 182, 8, 'F'); }
        const s = getStatus(f);
        doc.setFontSize(8);
        let name = f.name;
        if (name.length > 25) name = name.slice(0, 22) + '…';
        doc.text(name, 16, y + 4);
        doc.text(f.areaHa.toFixed(1), 70, y + 4);
        doc.text(cap(f.type), 100, y + 4);
        doc.text(s.label, 130, y + 4);
        doc.text(f.restTarget + 'd', 162, y + 4);
        y += 8;
    });

    y += 6;
    if (y > 240) { doc.addPage(); y = 20; }
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(0, 0, 0);
    doc.text('Grazing Events', 14, y);
    y += 5;
    doc.setFillColor(240, 253, 244);
    doc.rect(14, y, 182, 7, 'F');
    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(22, 101, 52);
    doc.text('Field', 16, y + 5);
    doc.text('Start', 60, y + 5);
    doc.text('End', 90, y + 5);
    doc.text('Days', 118, y + 5);
    doc.text('Animals', 136, y + 5);
    doc.text('AU/ha', 170, y + 5);
    y += 9;
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(0, 0, 0);
    [...events].sort((a, b) => b.startDate.localeCompare(a.startDate)).forEach((e, i) => {
        if (y > 270) { doc.addPage(); y = 20; }
        const field = fields.find(f => f.id === e.fieldId);
        const auHa  = field ? (e.animalCount / field.areaHa).toFixed(1) : '—';
        if (i % 2 === 0) { doc.setFillColor(250, 250, 248); doc.rect(14, y - 1, 182, 8, 'F'); }
        doc.setFontSize(8);
        let fn = field ? field.name : 'Unknown';
        if (fn.length > 18) fn = fn.slice(0, 15) + '…';
        doc.text(fn, 16, y + 4);
        doc.text(fmtDate(e.startDate), 60, y + 4);
        doc.text(fmtDate(e.endDate), 90, y + 4);
        doc.text(String(daysBetween(e.startDate, e.endDate)), 118, y + 4);
        doc.text(`${e.animalCount} ${e.animalType}`, 136, y + 4);
        doc.text(auHa, 170, y + 4);
        y += 8;
    });

    doc.setFontSize(7);
    doc.setTextColor(150, 150, 150);
    doc.text('GrazingTrack — Free & Open Source — MIT License', 14, 290);
    doc.save(`grazingtrack-report-${todayStr()}.pdf`);
}

// ── Export / Import ───────────────────────────────────────────
function exportJSON() {
    download('grazingtrack-backup.json', JSON.stringify({
        version:    DB_VERSION,
        exportedAt: new Date().toISOString(),
        fields:     loadFields(),
        events:     loadEvents(),
        moisture:   loadMoisture()
    }, null, 2), 'application/json');
}

function exportGeoJSON() {
    const fc = {
        type: 'FeatureCollection',
        features: loadFields().map(f => ({
            type: 'Feature',
            properties: { id: f.id, name: f.name, type: f.type, area_ha: f.areaHa, rest_target_days: f.restTarget, max_au_per_ha: f.maxAUperHa || null, color: f.color },
            geometry: f.geometry
        }))
    };
    download('grazingtrack-fields.geojson', JSON.stringify(fc, null, 2), 'application/geo+json');
}

function exportCSV() {
    const fields = loadFields();
    const events = loadEvents();
    const rows   = [['Field', 'Start date', 'End date', 'Days', 'Animal type', 'Count', 'AU/ha', 'Notes']];
    events.sort((a, b) => a.startDate.localeCompare(b.startDate)).forEach(e => {
        const f    = fields.find(x => x.id === e.fieldId);
        const auHa = f ? (e.animalCount / f.areaHa).toFixed(2) : '';
        rows.push([f ? f.name : 'Unknown', e.startDate, e.endDate, daysBetween(e.startDate, e.endDate), e.animalType, e.animalCount, auHa, `"${(e.notes || '').replace(/"/g, '""')}"`]);
    });
    download('grazingtrack-events.csv', rows.map(r => r.join(',')).join('\n'), 'text/csv');
}

function exportSensorCSV() {
    const fields   = loadFields();
    const readings = loadMoisture();
    const rows     = [['Field', 'Date', 'Time', 'Moisture %', 'Depth cm', 'Sensor ID', 'Notes']];
    readings.sort((a, b) => a.date.localeCompare(b.date)).forEach(r => {
        const f = fields.find(x => x.id === r.fieldId);
        rows.push([f ? f.name : 'Unknown', r.date, r.time || '', r.moisture_pct, r.depth_cm || '', r.sensor_id || '', `"${(r.notes || '').replace(/"/g, '""')}"`]);
    });
    download('grazingtrack-moisture.csv', rows.map(r => r.join(',')).join('\n'), 'text/csv');
}

function importJSON(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = e => {
        try {
            const data = JSON.parse(e.target.result);
            if (!Array.isArray(data.fields) || !Array.isArray(data.events)) throw new Error();
            if (!confirm(`Import ${data.fields.length} fields, ${data.events.length} events, ${(data.moisture || []).length} moisture readings?\nThis replaces all current data.`)) return;
            saveFields(data.fields);
            saveEvents(data.events);
            saveMoisture(data.moisture || []);
            colorIdx = data.fields.length % COLORS.length;
            drawnItems.clearLayers();
            restoreFieldsOnMap();
            renderFieldList();
            updateStats();
            updateStorageBar();
            deselectField();
            closeModal('modalExport');
            setStatus(`Imported ${data.fields.length} fields.`);
        } catch (err) {
            alert('Invalid backup file.');
        }
    };
    reader.readAsText(file);
    event.target.value = '';
}

function clearAllData() {
    if (!confirm('Delete ALL data? Export a backup first!\nThis cannot be undone.')) return;
    ['gt_fields', 'gt_events', 'gt_moisture'].forEach(k => localStorage.removeItem(k));
    drawnItems.clearLayers();
    colorIdx = 0;
    renderFieldList();
    updateStats();
    updateStorageBar();
    deselectField();
    closeModal('modalExport');
    setStatus('All data cleared.');
}