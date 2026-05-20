// ============================================================
//  gt-analytics.js  —  Advanced Farm Analytics & Graphs
// ============================================================
'use strict';

// Average Daily Gain (ADG) estimates in kg per animal type
const ADG_RATES = { cattle: 1.1, sheep: 0.25, goats: 0.20, horses: 0, pigs: 0.6, mixed: 0.5 };

function renderAnalytics() {
    const container = document.getElementById('analyticsContent');
    if (!container) return;

    const fields = loadFields();
    const events = loadEvents();

    if (fields.length === 0) {
        container.innerHTML = `
            <div class="warn-box" style="margin-top: 20px;">
                <strong>No data available.</strong> Please draw fields and log grazing events to see analytics.
            </div>`;
        return;
    }

    let html = `<div class="analytics-grid">`;

    // 1. Top Level KPIs
    html += _buildAnalyticsKPIs(fields, events);

    // 2. Field Rest Readiness (Where to move next?)
    html += _buildRestChart(fields, events);

    // 3. Grazing Pressure / Utilization (Are we overgrazing?)
    html += _buildUtilizationChart(fields, events);

    // 4. Herd Growth Estimator (Biomass Gain)
    html += _buildHerdGrowthWidget(events);

    // 5. Field Inspector Dropdown
    html += _buildFieldInspector(fields);

    html += `</div>`;
    container.innerHTML = html;

    // Initialize dropdown listener
    const selectEl = document.getElementById('anFieldSelect');
    if (selectEl) {
        selectEl.addEventListener('change', (e) => _updateFieldDetails(e.target.value));
        if (fields.length > 0) _updateFieldDetails(selectEl.value);
    }
}

// ── KPI Dashboard ─────────────────────────────────────────────
function _buildAnalyticsKPIs(fields, events) {
    const totalHa = fields.reduce((sum, f) => sum + (f.areaHa || 0), 0);
    const activeEvents = events.filter(e => new Date(e.endDate) >= new Date() && new Date(e.startDate) <= new Date());
    const totalAnimals = activeEvents.reduce((sum, e) => sum + parseInt(e.animalCount || 0), 0);

    let totalGrazingDays = 0;
    events.forEach(e => {
        const days = Math.max(1, Math.ceil((new Date(e.endDate) - new Date(e.startDate)) / 86400000));
        totalGrazingDays += days;
    });

    return `
        <div class="analytics-card" style="grid-column: 1 / -1; display: flex; gap: 20px; flex-wrap: wrap;">
            <div style="flex:1; min-width: 200px; padding: 15px; background: #f8fafc; border-radius: 12px; border: 1px solid #e2e8f0;">
                <div style="font-size: 12px; color: #64748b; text-transform: uppercase; font-weight: 700;">Total Farm Area</div>
                <div style="font-size: 28px; font-weight: 800; color: #0f172a;">${totalHa.toFixed(1)} <span style="font-size: 16px; color: #64748b;">ha</span></div>
            </div>
            <div style="flex:1; min-width: 200px; padding: 15px; background: #f0fdf4; border-radius: 12px; border: 1px solid #bbf7d0;">
                <div style="font-size: 12px; color: #166534; text-transform: uppercase; font-weight: 700;">Active on Pasture</div>
                <div style="font-size: 28px; font-weight: 800; color: #15803d;">${totalAnimals} <span style="font-size: 16px; color: #166534;">head</span></div>
            </div>
            <div style="flex:1; min-width: 200px; padding: 15px; background: #fefce8; border-radius: 12px; border: 1px solid #fef08a;">
                <div style="font-size: 12px; color: #854d0e; text-transform: uppercase; font-weight: 700;">Total Days Logged</div>
                <div style="font-size: 28px; font-weight: 800; color: #a16207;">${totalGrazingDays} <span style="font-size: 16px; color: #854d0e;">days</span></div>
            </div>
        </div>
    `;
}

// ── Graph 1: Field Rest Readiness ─────────────────────────────
function _buildRestChart(fields, events) {
    const now = new Date();

    // Calculate rest days for each field
    let restData = fields.map(f => {
        const fEvents = events.filter(e => e.fieldId === f.id);
        if (fEvents.length === 0) return { name: f.name, days: 60, status: 'Fresh', actualDays: '99+' };

        const lastEvent = fEvents.sort((a, b) => new Date(b.endDate) - new Date(a.endDate))[0];
        const endDate = new Date(lastEvent.endDate);
        const startDate = new Date(lastEvent.startDate);

        if (now >= startDate && now <= endDate) return { name: f.name, days: 0, status: 'Grazing', actualDays: 'Active' };

        const daysResting = Math.floor((now - endDate) / 86400000);
        return { name: f.name, days: Math.max(0, daysResting), status: 'Resting', actualDays: daysResting };
    });

    // Sort by most rested first
    restData.sort((a, b) => b.days - a.days);

    // Cap visual bar at 60 days to keep the graph scaled
    const maxGraphDays = 60;

    let rowsHtml = restData.map(d => {
        let color = '#ef4444'; // Red (Under 20 days)
        if (d.status === 'Grazing') color = '#3b82f6'; // Blue
        else if (d.days >= 40) color = '#10b981'; // Green (Fully rested)
        else if (d.days >= 20) color = '#f59e0b'; // Yellow (Partial rest)

        let pct = Math.min(100, (d.days / maxGraphDays) * 100);
        if (d.status === 'Grazing') pct = 100; // Fill bar for active grazing

        return `
            <div style="margin-bottom: 12px;">
                <div style="display: flex; justify-content: space-between; font-size: 13px; margin-bottom: 4px; font-weight:600;">
                    <span>${escapeHtml(d.name)}</span>
                    <span style="color:${color}">${d.actualDays} ${d.status === 'Grazing' ? '' : 'days'}</span>
                </div>
                <div style="width: 100%; background: #f1f5f9; border-radius: 6px; height: 16px; overflow: hidden;">
                    <div style="width: ${pct}%; background: ${color}; height: 100%; border-radius: 6px; ${d.status === 'Grazing' ? 'background-image: repeating-linear-gradient(45deg, rgba(255,255,255,0.2) 0, rgba(255,255,255,0.2) 10px, transparent 10px, transparent 20px);' : ''}"></div>
                </div>
            </div>
        `;
    }).join('');

    return `
        <div class="analytics-card">
            <div class="analytics-card-title">🌱 Rest Readiness (Where to next?)</div>
            <p style="font-size: 12px; color: #64748b; margin-bottom: 15px;">Days since last grazing event. Target is 40+ days (Green) for optimal recovery.</p>
            <div style="max-height: 250px; overflow-y: auto; padding-right: 5px;">
                ${rowsHtml}
            </div>
        </div>
    `;
}

// ── Graph 2: Grazing Pressure (AUD/ha) ────────────────────────
function _buildUtilizationChart(fields, events) {
    let utilData = fields.map(f => {
        const fEvents = events.filter(e => e.fieldId === f.id);
        let aud = 0; // Animal Unit Days
        fEvents.forEach(e => {
            const days = Math.max(1, Math.ceil((new Date(e.endDate) - new Date(e.startDate)) / 86400000));
            aud += days * (parseInt(e.animalCount) || 0);
        });

        const audHa = f.areaHa > 0 ? (aud / f.areaHa) : 0;
        return { name: f.name, audHa: audHa, area: f.areaHa };
    });

    // Sort by heaviest utilized first
    utilData.sort((a, b) => b.audHa - a.audHa);
    const maxAud = Math.max(...utilData.map(d => d.audHa), 1);

    let rowsHtml = utilData.map(d => {
        const pct = Math.min(100, (d.audHa / maxAud) * 100);
        // Gradient from Green (low use) to Red (heavy use)
        const hue = 120 - (pct * 1.2);
        const color = `hsl(${hue}, 70%, 45%)`;

        return `
            <div style="margin-bottom: 12px;">
                <div style="display: flex; justify-content: space-between; font-size: 13px; margin-bottom: 4px; font-weight:600;">
                    <span>${escapeHtml(d.name)}</span>
                    <span style="color:${color}">${Math.round(d.audHa).toLocaleString()} AUD/ha</span>
                </div>
                <div style="width: 100%; background: #f1f5f9; border-radius: 6px; height: 16px; overflow: hidden;">
                    <div style="width: ${pct}%; background: ${color}; height: 100%; border-radius: 6px;"></div>
                </div>
            </div>
        `;
    }).join('');

    return `
        <div class="analytics-card">
            <div class="analytics-card-title">⚠️ Grazing Pressure (AUD/ha)</div>
            <p style="font-size: 12px; color: #64748b; margin-bottom: 15px;">Animal Unit Days per Hectare. Identifies which fields are bearing the heaviest loads relative to their size.</p>
            <div style="max-height: 250px; overflow-y: auto; padding-right: 5px;">
                ${rowsHtml}
            </div>
        </div>
    `;
}

// ── Graph 3: Estimated Herd Growth ────────────────────────────
function _buildHerdGrowthWidget(events) {
    if (events.length === 0) return '';
    const herdStats = {};

    events.forEach(e => {
        const herdName = e.herd || 'Unnamed Herd';
        if (!herdStats[herdName]) herdStats[herdName] = { type: e.animalType, totalDays: 0, headCount: parseInt(e.animalCount) || 0, gainKg: 0 };

        const days = Math.max(1, Math.ceil((new Date(e.endDate) - new Date(e.startDate)) / 86400000));
        herdStats[herdName].totalDays += days;
        herdStats[herdName].gainKg += (days * herdStats[herdName].headCount * (ADG_RATES[e.animalType] || 0.5));
    });

    const maxGain = Math.max(...Object.values(herdStats).map(h => h.gainKg), 1);

    let rowsHtml = Object.keys(herdStats).map(herd => {
        const stats = herdStats[herd];
        const pct = Math.min(100, (stats.gainKg / maxGain) * 100);
        const emoji = { cattle: '🐄', sheep: '🐑', goats: '🐐', horses: '🐎', pigs: '🐷', mixed: '🐾' }[stats.type] || '🐄';

        return `
            <div style="margin-bottom: 16px;">
                <div style="display: flex; justify-content: space-between; font-size: 14px; margin-bottom: 4px;">
                    <span style="font-weight: 600;">${emoji} ${escapeHtml(herd)} <span style="color:#64748b; font-size: 11px;">(${stats.headCount} head)</span></span>
                    <span style="font-weight: 700; color: #8b5cf6;">+${Math.round(stats.gainKg).toLocaleString()} kg</span>
                </div>
                <div style="width: 100%; background: #f1f5f9; border-radius: 6px; height: 16px; overflow: hidden;">
                    <div style="width: ${pct}%; background: linear-gradient(90deg, #a78bfa, #8b5cf6); height: 100%; border-radius: 6px;"></div>
                </div>
            </div>
        `;
    }).join('');

    return `
        <div class="analytics-card">
            <div class="analytics-card-title">📈 Estimated Biomass Gain</div>
            <p style="font-size: 12px; color: #64748b; margin-bottom: 15px;">Calculated using Average Daily Gain (ADG) metrics × head count × days on pasture.</p>
            ${rowsHtml}
        </div>
    `;
}

// ── Dropdown Field Inspector ──────────────────────────────────
function _buildFieldInspector(fields) {
    const options = fields.map(f => `<option value="${f.id}">${escapeHtml(f.name)} (${f.areaHa.toFixed(1)} ha)</option>`).join('');

    return `
        <div class="analytics-card" style="grid-column: 1 / -1;">
            <div class="analytics-card-title">🔍 Deep Dive: Field Inspector</div>
            <div class="fg" style="max-width: 400px; margin-bottom:15px;">
                <select id="anFieldSelect" style="width: 100%; padding: 10px; border-radius: 8px; border: 1px solid #cbd5e1; font-weight: 600;">
                    ${options}
                </select>
            </div>
            <div id="anFieldDetails" style="border-top: 1px solid #e2e8f0; padding-top: 15px;"></div>
        </div>
    `;
}

function _updateFieldDetails(fieldId) {
    const container = document.getElementById('anFieldDetails');
    if (!container) return;

    const fields = loadFields();
    const events = loadEvents();
    const field = fields.find(f => f.id === fieldId);
    if (!field) return;

    const fieldEvents = events.filter(e => e.fieldId === fieldId).sort((a, b) => new Date(b.startDate) - new Date(a.startDate));

    let totalDays = 0,
        totalAnimals = 0;
    fieldEvents.forEach(e => {
        totalDays += Math.max(1, Math.ceil((new Date(e.endDate) - new Date(e.startDate)) / 86400000));
        totalAnimals += parseInt(e.animalCount) || 0;
    });

    const stockDensity = field.areaHa > 0 ? (totalAnimals / field.areaHa).toFixed(1) : 0;

    let historyHtml = '<div style="font-size: 13px; color: #64748b;">No grazing history.</div>';
    if (fieldEvents.length > 0) {
        historyHtml = fieldEvents.map(e => {
            const s = new Date(e.startDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
            const ed = new Date(e.endDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
            const emoji = { cattle: '🐄', sheep: '🐑', goats: '🐐', horses: '🐎', pigs: '🐷', mixed: '🐾' }[e.animalType] || '🐄';
            return `
                <div style="display: flex; justify-content: space-between; padding: 10px; background: #f8fafc; border-radius: 8px; margin-bottom: 8px; border: 1px solid #f1f5f9;">
                    <div>
                        <div style="font-weight: 600; font-size: 13px;">${emoji} ${escapeHtml(e.herd)}</div>
                        <div style="font-size: 11px; color: #64748b;">${s} - ${ed}</div>
                    </div>
                    <div style="font-weight: 700; color: #0f172a; font-size: 13px;">${e.animalCount} head</div>
                </div>
            `;
        }).join('');
    }

    container.innerHTML = `
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; margin-bottom: 20px;">
            <div style="background: #eff6ff; padding: 15px; border-radius: 12px;">
                <div style="font-size: 11px; font-weight: 700; text-transform: uppercase; color: #1d4ed8;">Stocking Density</div>
                <div style="font-size: 24px; font-weight: 800; color: #1e3a8a;">${stockDensity} <span style="font-size: 14px;">head/ha</span></div>
            </div>
            <div style="background: #fdf4ff; padding: 15px; border-radius: 12px;">
                <div style="font-size: 11px; font-weight: 700; text-transform: uppercase; color: #a21caf;">Cumulative Days</div>
                <div style="font-size: 24px; font-weight: 800; color: #701a75;">${totalDays} <span style="font-size: 14px;">days</span></div>
            </div>
        </div>
        <h4 style="font-size: 14px; font-weight: 700; margin-bottom: 12px;">History Log</h4>
        <div style="max-height: 200px; overflow-y: auto; padding-right: 5px;">${historyHtml}</div>
    `;
}