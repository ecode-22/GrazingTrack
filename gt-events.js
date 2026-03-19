// ============================================================
//  gt-events.js  —  Grazing events, history, soil moisture
//
//  BUG FIX: The "Log Grazing" button was completely broken
//  because gStart and gEnd date inputs were missing from the
//  HTML.  openGrazingModal() did:
//      document.getElementById('gStart').value = today;
//  which threw TypeError: null.value and silently exited
//  before openModal() was ever reached — so the modal never
//  appeared.  The date inputs are now added to the HTML and
//  this JS is updated to match.
//
//  Second fix: gAnimalType was never reset when the modal
//  opened, so the previous animal type persisted across opens.
// ============================================================
'use strict';

// ── Grazing modal ─────────────────────────────────────────────
function openGrazingModal(preFieldId) {
    const fields = loadFields();
    if (!fields.length) { alert('Add a field first.'); return; }

    // Field dropdown
    document.getElementById('gField').innerHTML = fields.map(f =>
        `<option value="${f.id}"${f.id === preFieldId ? ' selected' : ''}>${f.name}</option>`
    ).join('');

    // Animal group dropdown — populated from setup config.
    // Falls back gracefully if no groups are configured.
    const groups = window._animalGroups || [];
    const groupSelect = document.getElementById('gGroup');
    if (groupSelect) {
        groupSelect.innerHTML =
            groups.map(g => `<option value="${g.name}|${g.type}|${g.count}">${g.name} (${g.count} ${g.type})</option>`).join('') +
            '<option value="custom">Other (enter manually)</option>';

        groupSelect.onchange = function() {
            if (this.value === 'custom') {
                document.getElementById('gAnimalType').value = '';
                document.getElementById('gCount').value = '';
            } else {
                const [, type, count] = this.value.split('|');
                document.getElementById('gAnimalType').value = type;
                document.getElementById('gCount').value = count;
            }
        };
    }

    // Reset all fields to a clean state for each new open.
    const today = todayStr();
    document.getElementById('gStart').value = today; // ← was missing from HTML
    document.getElementById('gEnd').value = addDays(today, 7); // ← was missing from HTML
    document.getElementById('gAnimalType').value = ''; // ← was never reset
    document.getElementById('gCount').value = '';
    document.getElementById('gNotes').value = '';
    document.getElementById('stockingWarning').style.display = 'none';

    // Show the day/night shift row only when that mode is active.
    const isDN = localStorage.getItem('gt_daynight') === '1';
    const sr = document.getElementById('gShiftRow');
    if (sr) sr.style.display = isDN ? 'grid' : 'none';

    openModal('modalGrazing');

    // Remove stale listeners before attaching fresh ones — without this,
    // each modal open stacks another copy of checkStockingLive on the same
    // element and the warning fires multiple times per keystroke.
    const gCount = document.getElementById('gCount');
    const gField = document.getElementById('gField');
    gCount.removeEventListener('input', checkStockingLive);
    gField.removeEventListener('change', checkStockingLive);
    gCount.addEventListener('input', checkStockingLive);
    gField.addEventListener('change', checkStockingLive);
}

// Live stocking rate warning shown while the farmer is filling in the form.
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
    } else {
        warn.style.display = 'none';
    }
}

function saveGrazingEvent() {
    const fieldId = document.getElementById('gField').value;
    const start = document.getElementById('gStart').value;
    const end = document.getElementById('gEnd').value;
    const type = document.getElementById('gAnimalType').value.trim();
    const count = parseInt(document.getElementById('gCount').value);
    const notes = document.getElementById('gNotes').value.trim();

    if (!start || !end) { alert('Enter start and end dates.'); return; }
    if (end < start) { alert('End date must be on or after start date.'); return; }
    if (!type) { alert('Enter an animal type (e.g. cattle, sheep).'); return; }
    if (!count || count < 1) { alert('Enter the number of animals.'); return; }

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
    setStatus(`Logged: ${count} ${type} on "${field ? field.name : '?'}" — ${daysBetween(start, end)} days`);
}

// ── Grazing history modal ─────────────────────────────────────
let historyFieldId = null;

function openHistoryModal(fieldId) {
    historyFieldId = fieldId;
    const field = loadFields().find(f => f.id === fieldId);
    const events = loadEvents().filter(e => e.fieldId === fieldId)
        .sort((a, b) => b.startDate.localeCompare(a.startDate));

    document.getElementById('historyTitle').textContent = `${field.name} — Grazing History`;
    document.getElementById('historyBody').innerHTML = !events.length ?
        `<p class="no-history">No events yet.</p>` :
        `<table class="htbl">
               <thead><tr><th>Start</th><th>End</th><th>Days</th><th>Type</th><th>Animals</th><th>AU/ha</th><th>Notes</th><th></th></tr></thead>
               <tbody>${events.map(e => {
                   const auHa = field.areaHa > 0 ? (e.animalCount / field.areaHa).toFixed(1) : '—';
                   const warn = field.maxAUperHa && (e.animalCount / field.areaHa) > field.maxAUperHa ? '⚠' : '';
                   return `<tr>
                       <td>${fmtDate(e.startDate)}</td>
                       <td>${fmtDate(e.endDate)}</td>
                       <td>${daysBetween(e.startDate, e.endDate)}</td>
                       <td>${cap(e.animalType)}</td>
                       <td>${e.animalCount}</td>
                       <td>${warn}${auHa}</td>
                       <td style="color:#6b7280;font-size:11px;max-width:100px">${e.notes || '—'}</td>
                       <td><button class="del-ev-btn" onclick="deleteEvent('${e.id}','${fieldId}')">✕</button></td>
                   </tr>`;
               }).join('')}</tbody>
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

// ── Soil moisture modal ───────────────────────────────────────
function openMoistureModal(preFieldId) {
    const fields = loadFields();
    if (!fields.length) { alert('Add a field first.'); return; }
    document.getElementById('mField').innerHTML = fields.map(f =>
        `<option value="${f.id}"${f.id === preFieldId ? ' selected' : ''}>${f.name}</option>`
    ).join('');
    document.getElementById('mDate').value   = todayStr();
    document.getElementById('mPct').value    = '';
    document.getElementById('mDepth').value  = '20';
    document.getElementById('mSensor').value = '';
    document.getElementById('mNotes').value  = '';
    openModal('modalMoisture');
}

function saveMoistureReading() {
    const fieldId = document.getElementById('mField').value;
    const pct     = parseFloat(document.getElementById('mPct').value);
    const date    = document.getElementById('mDate').value;
    const depth   = parseFloat(document.getElementById('mDepth').value) || 20;
    const sensor  = document.getElementById('mSensor').value.trim();
    const notes   = document.getElementById('mNotes').value.trim();
    if (!date || isNaN(pct) || pct < 0 || pct > 100) {
        alert('Enter a valid date and moisture % (0–100).');
        return;
    }
    const readings = loadMoisture();
    readings.push({
        id:           uid(),
        fieldId,
        date,
        time:         new Date().toTimeString().slice(0, 5),
        moisture_pct: pct,
        depth_cm:     depth,
        sensor_id:    sensor,
        notes,
        loggedAt:     new Date().toISOString()
    });
    saveMoisture(readings);
    closeModal('modalMoisture');
    const field = loadFields().find(f => f.id === fieldId);
    setStatus(`Moisture logged: ${pct}% at ${depth}cm — ${field ? field.name : '?'}`);
}