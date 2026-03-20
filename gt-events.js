// ============================================================
//  gt-events.js  —  Grazing events & history
// ============================================================
'use strict';

function _groupEmoji(type) {
    const map = { cattle: '🐄', sheep: '🐑', goats: '🐐', horses: '🐎', pigs: '🐷', mixed: '🐾' };
    return map[(type || '').toLowerCase()] || '🐾';
}

// ── Grazing modal ─────────────────────────────────────────────
function openGrazingModal(preFieldId) {
    const fields = loadFields();
    if (!fields.length) { alert('Add a field first.'); return; }

    // Field dropdown
    document.getElementById('gField').innerHTML = fields.map(f =>
        `<option value="${f.id}"${f.id === preFieldId ? ' selected' : ''}>${f.name}</option>`
    ).join('');

    // Reset all inputs to clean state
    const today = todayStr();
    document.getElementById('gStart').value = today;
    document.getElementById('gEnd').value = addDays(today, 7);
    document.getElementById('gAnimalType').value = '';
    document.getElementById('gCount').value = '';
    document.getElementById('gHerd').value = '';
    document.getElementById('gNotes').value = '';
    document.getElementById('stockingWarning').style.display = 'none';

    // Render group cards then open
    _renderGroupPicker();
    openModal('modalGrazing');

    // Stale-listener guard
    const gCount = document.getElementById('gCount');
    const gField = document.getElementById('gField');
    gCount.removeEventListener('input', checkStockingLive);
    gField.removeEventListener('change', checkStockingLive);
    gCount.addEventListener('input', checkStockingLive);
    gField.addEventListener('change', checkStockingLive);
}

// ── Group picker inside the grazing modal ─────────────────────
// Shows one card per group. Tapping a card fills type/count/herd.
// When no groups exist, shows a big "Add group" button right there
// — no need to leave the modal.
function _renderGroupPicker() {
    const groups = loadGroups();
    const wrap = document.getElementById('gGroupPicker');
    if (!wrap) return;

    if (!groups.length) {
        wrap.innerHTML = `
            <div class="grp-none">
                <p class="grp-none-msg">You have no animal groups yet.</p>
                <button class="grp-none-add" onclick="openGroupModalFromGrazing()">
                    + Create your first group
                </button>
                <p class="grp-none-or">or fill in manually below</p>
            </div>`;
        // Always show manual inputs so the farmer isn't blocked
        document.getElementById('gManualInputs').style.display = 'block';
        return;
    }

    wrap.innerHTML = `
        <div class="grp-cards" id="gGroupCards">
            ${groups.map(g => `
            <button class="grp-card" data-id="${g.id}" onclick="_selectGroup('${g.id}')">
                <div class="grp-card-icon">${_groupEmoji(g.type)}</div>
                <div class="grp-card-name">${g.name}</div>
                <div class="grp-card-sub">${g.count} ${g.type}${g.herd ? ' · ' + g.herd : ''}</div>
            </button>`).join('')}
            <button class="grp-card grp-card-manual" onclick="_selectManual()">
                <div class="grp-card-icon">✎</div>
                <div class="grp-card-name">Manual</div>
                <div class="grp-card-sub">Enter yourself</div>
            </button>
        </div>`;

    // Hide manual inputs until a group or manual is chosen
    document.getElementById('gManualInputs').style.display = 'none';
}

// Opens the group add modal while keeping the grazing modal open.
// After the group is saved, _groupSavedFromGrazing() refreshes the picker
// and auto-selects the new group.
function openGroupModalFromGrazing() {
    window._addingGroupFromGrazing = true;
    openGroupModal(null);
}

// Called by saveGroup() when a group was added from within the grazing modal.
function _groupSavedFromGrazing(newGroupId) {
    window._addingGroupFromGrazing = false;
    _renderGroupPicker();                    // refresh the cards
    if (newGroupId) _selectGroup(newGroupId); // auto-select the new group
}

function _selectGroup(groupId) {
    const g = loadGroups().find(g => g.id === groupId);
    if (!g) return;

    // Highlight the selected card
    document.querySelectorAll('#gGroupCards .grp-card').forEach(c =>
        c.classList.toggle('selected', c.dataset.id === groupId)
    );

    // Auto-fill everything from the group
    document.getElementById('gAnimalType').value = g.type  || '';
    document.getElementById('gCount').value      = g.count || '';
    document.getElementById('gHerd').value       = g.herd  || '';

    document.getElementById('gManualInputs').style.display = 'block';
    checkStockingLive();
}

function _selectManual() {
    document.querySelectorAll('#gGroupCards .grp-card').forEach(c => c.classList.remove('selected'));
    const manualCard = document.querySelector('#gGroupCards .grp-card-manual');
    if (manualCard) manualCard.classList.add('selected');

    document.getElementById('gAnimalType').value = '';
    document.getElementById('gCount').value      = '';
    document.getElementById('gHerd').value       = '';
    document.getElementById('gManualInputs').style.display = 'block';
    document.getElementById('gAnimalType').focus();
}

// ── Live stocking rate warning ────────────────────────────────
function checkStockingLive() {
    const fieldId = document.getElementById('gField').value;
    const count   = parseInt(document.getElementById('gCount').value);
    const field   = loadFields().find(f => f.id === fieldId);
    const warn    = document.getElementById('stockingWarning');
    if (!field || !count || !field.maxAUperHa) { warn.style.display = 'none'; return; }
    const auHa = count / field.areaHa;
    if (auHa > field.maxAUperHa) {
        warn.className   = 'warn-box alert';
        warn.textContent = `⚠ ${auHa.toFixed(1)} AU/ha exceeds limit of ${field.maxAUperHa} AU/ha.`;
        warn.style.display = 'block';
    } else if (auHa > field.maxAUperHa * 0.85) {
        warn.className        = 'warn-box';
        warn.style.background = '#fef9c3';
        warn.style.border     = '1.5px solid #fde68a';
        warn.style.color      = '#854d0e';
        warn.textContent      = `Note: ${auHa.toFixed(1)} AU/ha — approaching limit of ${field.maxAUperHa} AU/ha.`;
        warn.style.display    = 'block';
    } else {
        warn.style.display = 'none';
    }
}

// ── Save grazing event ────────────────────────────────────────
function saveGrazingEvent() {
    const fieldId = document.getElementById('gField').value;
    const start   = document.getElementById('gStart').value;
    const end     = document.getElementById('gEnd').value;
    const type    = document.getElementById('gAnimalType').value.trim();
    const count   = parseInt(document.getElementById('gCount').value);
    const herd    = document.getElementById('gHerd').value.trim();
    const notes   = document.getElementById('gNotes').value.trim();

    if (!start || !end)      { alert('Enter start and end dates.'); return; }
    if (end < start)         { alert('End date must be on or after start date.'); return; }
    if (!type)               { alert('Select a group or enter an animal type.'); return; }
    if (!count || count < 1) { alert('Enter the number of animals.'); return; }

    const events = loadEvents();
    events.push({ id:uid(), fieldId, startDate:start, endDate:end,
        animalType:type, animalCount:count, herd, notes,
        loggedAt:new Date().toISOString() });
    saveEvents(events);
    closeModal('modalGrazing');
    refreshMapColors();
    renderFieldList();
    updateStats();
    if (selectedFieldId === fieldId) selectField(fieldId);
    const field = loadFields().find(f => f.id === fieldId);
    setStatus(`Logged: ${count} ${type}${herd?' ('+herd+')':''} on "${field?field.name:'?'}" — ${daysBetween(start,end)} days`);
}

// ── Grazing history modal ─────────────────────────────────────
let historyFieldId = null;

function openHistoryModal(fieldId) {
    historyFieldId = fieldId;
    const field  = loadFields().find(f => f.id === fieldId);
    const events = loadEvents().filter(e => e.fieldId === fieldId)
        .sort((a, b) => b.startDate.localeCompare(a.startDate));

    document.getElementById('historyTitle').textContent = `${field.name} — Grazing History`;
    document.getElementById('historyBody').innerHTML = !events.length
        ? `<p class="no-history">No events yet.</p>`
        : `<table class="htbl">
               <thead><tr><th>Start</th><th>End</th><th>Days</th><th>Animals</th><th>AU/ha</th><th>Notes</th><th></th></tr></thead>
               <tbody>${events.map(e => {
                   const auHa = field.areaHa > 0 ? (e.animalCount / field.areaHa).toFixed(1) : '—';
                   const warn = field.maxAUperHa && (e.animalCount / field.areaHa) > field.maxAUperHa ? '⚠' : '';
                   const herdTag = e.herd ? ` <span class="ev-herd">${e.herd}</span>` : '';
                   return `<tr>
                       <td>${fmtDate(e.startDate)}</td>
                       <td>${fmtDate(e.endDate)}</td>
                       <td>${daysBetween(e.startDate,e.endDate)}</td>
                       <td>${e.animalCount} ${cap(e.animalType)}${herdTag}</td>
                       <td>${warn}${auHa}</td>
                       <td style="color:#6b7280;font-size:11px">${e.notes||'—'}</td>
                       <td><button class="del-ev-btn" onclick="deleteEvent('${e.id}','${fieldId}')">✕</button></td>
                   </tr>`;
               }).join('')}</tbody>
           </table>`;
    openModal('modalHistory');
}

function deleteEvent(eventId, fieldId) {
    if (!confirm('Delete this grazing event?')) return;
    saveEvents(loadEvents().filter(e => e.id !== eventId));
    refreshMapColors(); renderFieldList(); updateStats();
    openHistoryModal(fieldId);
    if (selectedFieldId === fieldId) selectField(fieldId);
}

function historyAddEvent() {
    closeModal('modalHistory');
    openGrazingModal(historyFieldId);
}