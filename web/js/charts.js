import { MONTHS_ES, THIS_YEAR, THIS_MONTH, CAT_COLORS, CAT_ICONS, esc } from './config.js';
import { dashYear, allMonths, mk } from './db.js';
import { setupCanvas, computeMonthByYM, fmtShort } from './compute.js';
import { getDeferralsForMonth } from './deferrals.js';

// Read CSS variable colors at render time so charts adapt to theme
function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

// Returns the last 6 months ending at the current/last month of dashYear
export function getLast6Months() {
  const endM = dashYear === THIS_YEAR ? THIS_MONTH : 11;
  const result = [];
  for (let i = 5; i >= 0; i--) {
    let m = endM - i, y = dashYear;
    if (m < 0) { m += 12; y--; }
    result.push({ y, m });
  }
  return result;
}

// ── TREND BAR CHART ──
export function renderTrendChart() {
  const canvas = document.getElementById('trendChart');
  const W = canvas.parentElement.clientWidth - 48;
  const ctx = setupCanvas(canvas, W, 200);

  const slots6 = getLast6Months();
  const months = slots6.map(({ y, m }) => {
    const c = computeMonthByYM(y, m);
    return { label: MONTHS_ES[m].slice(0, 3), y, m, ...c };
  });

  const slots = 6;
  const maxVal = Math.max(...months.map(d => Math.max(d.totalIn, d.tG + d.tT, 1)));
  const pad = { top: 20, right: 20, bottom: 36, left: 50 };
  const cW = W - pad.left - pad.right;
  const cH = 200 - pad.top - pad.bottom;
  const grp = 3, bW = Math.max(6, (cW / slots - 10) / grp), gap = 2, grpW = bW * grp + gap * (grp - 1);

  ctx.strokeStyle = cssVar('--border'); ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const yp = pad.top + cH * (1 - i / 4);
    ctx.beginPath(); ctx.moveTo(pad.left, yp); ctx.lineTo(pad.left + cW, yp); ctx.stroke();
    ctx.fillStyle = cssVar('--text3'); ctx.font = '10px DM Mono'; ctx.textAlign = 'right';
    ctx.fillText(fmtShort(maxVal * (i / 4)), pad.left - 6, yp + 4);
  }

  months.forEach((d, i) => {
    const slotW = cW / slots;
    const x0 = pad.left + i * slotW + (slotW - grpW) / 2;
    const isCurrentMonth = d.y === THIS_YEAR && d.m === THIS_MONTH;

    const bars = [
      { val: d.totalIn,             color: 'rgba(61,255,160,.7)' },
      { val: d.tG + d.tT,           color: 'rgba(255,92,122,.7)' },
      { val: Math.max(0, d.saving), color: 'rgba(108,99,255,.7)' },
    ];
    bars.forEach((b, j) => {
      const bH = maxVal > 0 ? (b.val / maxVal) * cH : 0;
      const bX = x0 + j * (bW + gap), bY = pad.top + cH - bH;
      const grad = ctx.createLinearGradient(0, bY, 0, pad.top + cH);
      grad.addColorStop(0, b.color); grad.addColorStop(1, b.color.replace('.7', '.2'));
      ctx.fillStyle = grad;
      ctx.beginPath(); ctx.roundRect(bX, bY, bW, bH, 3); ctx.fill();
    });

    ctx.fillStyle = isCurrentMonth ? 'rgba(108,99,255,.9)' : cssVar('--text2');
    ctx.font = isCurrentMonth ? 'bold 10px Cabinet Grotesk' : '10px Cabinet Grotesk';
    ctx.textAlign = 'center';
    ctx.fillText(d.label, pad.left + i * slotW + slotW / 2, 200 - pad.bottom + 16);
  });

  const leg = [{ label: 'Ingreso', color: '#3dffa0' }, { label: 'Gasto', color: '#ff5c7a' }, { label: 'Ahorro', color: '#6c63ff' }];
  leg.forEach((l, i) => {
    ctx.fillStyle = l.color;
    ctx.fillRect(pad.left + i * 90, 200 - 10, 10, 8);
    ctx.fillStyle = cssVar('--text2'); ctx.font = '10px Cabinet Grotesk'; ctx.textAlign = 'left';
    ctx.fillText(l.label, pad.left + i * 90 + 14, 200 - 3);
  });
}

// ── DONUT DASHBOARD ──
export function renderDonutDash() {
  const bycat = {};
  for (let m = 0; m < 12; m++) {
    const md = allMonths[mk(dashYear, m)];
    (md?.transactions || []).filter(t => t.type === 'gasto').forEach(t => {
      bycat[t.cat] = (bycat[t.cat] || 0) + t.amount;
    });
    getDeferralsForMonth(dashYear, m).forEach(({ d, cuotaAmt }) => {
      bycat[d.cat] = (bycat[d.cat] || 0) + cuotaAmt;
    });
  }
  const cats = Object.entries(bycat).sort((a, b) => b[1] - a[1]);
  const total = cats.reduce((s, [, v]) => s + v, 0);
  document.getElementById('donutDashTotal').textContent = fmtShort(total);
  drawDonut('donutDash', cats, total, 80, 54);
  const leg = document.getElementById('donutDashLegend');
  leg.innerHTML = cats.slice(0, 6).map(([cat, val]) => {
    const pct = total > 0 ? Math.round(val / total * 100) : 0;
    const col = CAT_COLORS[cat] || '#6070a0';
    return `<div class="legend-row"><div class="legend-left"><div class="legend-dot" style="background:${col}"></div><span class="legend-name">${CAT_ICONS[cat] || ''} ${esc(cat)}</span></div><div class="legend-right"><div class="legend-pct" style="color:${col}">${pct}%</div><div class="legend-amt">${fmtShort(val)}</div></div></div>`;
  }).join('');
}

// ── SAVING RATE CHART ──
export function renderSavingRateChart() {
  const canvas = document.getElementById('savingRateChart');
  const W = canvas.parentElement.clientWidth - 48;
  const ctx = setupCanvas(canvas, W, 160);

  const slots6 = getLast6Months();
  const data = slots6.map(({ y, m }, i) => {
    const c = computeMonthByYM(y, m);
    if (!c.totalIn && !c.tT) return null;
    return { x: i, v: c.totalIn > 0 ? Math.max(0, c.saving / c.totalIn) * 100 : 0, label: MONTHS_ES[m].slice(0, 3) };
  }).filter(Boolean);

  const pts = data;
  if (!pts.length) {
    ctx.fillStyle = cssVar('--text3'); ctx.font = '12px Cabinet Grotesk'; ctx.textAlign = 'center';
    ctx.fillText('Sin datos aún', W / 2, 80); return;
  }

  const pad = { top: 10, right: 16, bottom: 28, left: 36 };
  const cW = W - pad.left - pad.right, cH = 160 - pad.top - pad.bottom;

  const grad = ctx.createLinearGradient(0, pad.top, 0, pad.top + cH);
  grad.addColorStop(0, 'rgba(108,99,255,.4)'); grad.addColorStop(1, 'rgba(108,99,255,0)');

  ctx.beginPath();
  pts.forEach((p, i) => {
    const x = pad.left + p.x * (cW / 5), y = pad.top + cH * (1 - p.v / 100);
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.lineTo(pad.left + pts[pts.length - 1].x * (cW / 5), pad.top + cH);
  ctx.lineTo(pad.left + pts[0].x * (cW / 5), pad.top + cH);
  ctx.closePath(); ctx.fillStyle = grad; ctx.fill();

  ctx.beginPath(); ctx.strokeStyle = '#6c63ff'; ctx.lineWidth = 2;
  pts.forEach((p, i) => {
    const x = pad.left + p.x * (cW / 5), y = pad.top + cH * (1 - p.v / 100);
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.stroke();

  pts.forEach(p => {
    const x = pad.left + p.x * (cW / 5), y = pad.top + cH * (1 - p.v / 100);
    ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fillStyle = '#6c63ff'; ctx.fill();
    ctx.fillStyle = cssVar('--text2'); ctx.font = '9px DM Mono'; ctx.textAlign = 'center';
    ctx.fillText(Math.round(p.v) + '%', x, y - 8);
    ctx.fillStyle = cssVar('--text3'); ctx.font = '9px Cabinet Grotesk';
    ctx.fillText(p.label, x, pad.top + cH + 16);
  });
}

// ════════════════════════════════════════════════════════
// DONUT HELPERS (shared by dashboard.js and accounts.js)
// Moved here from dashboard.js to centralise chart utilities.
// ════════════════════════════════════════════════════════
export function drawDonut(canvasId, cats, total, R, r) {
  const cv = document.getElementById(canvasId);
  if (!cv) return;
  const W = cv.offsetWidth || R * 2, H = cv.offsetHeight || R * 2;
  const ctx = setupCanvas(cv, W, H);
  const cx = W / 2, cy = H / 2;
  if (!cats.length || total === 0) {
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.arc(cx, cy, r, 0, Math.PI * 2, true);
    ctx.fillStyle = cssVar('--surface3'); ctx.fill('evenodd'); return;
  }
  let ang = -Math.PI / 2;
  cats.forEach(([cat, val]) => {
    const sl = (val / total) * Math.PI * 2 - 0.04;
    ctx.beginPath(); ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, R, ang, ang + sl); ctx.arc(cx, cy, r, ang + sl, ang, true);
    ctx.closePath(); ctx.fillStyle = CAT_COLORS[cat] || '#6070a0'; ctx.fill();
    ang += sl + 0.04;
  });
}

// drawDonut variant — each entry is [label, value, color]
export function drawDonutColors(canvasId, cats, total, R, r) {
  const cv = document.getElementById(canvasId);
  if (!cv) return;
  const W = cv.offsetWidth || R * 2, H = cv.offsetHeight || R * 2;
  const ctx = setupCanvas(cv, W, H);
  const cx = W / 2, cy = H / 2;
  if (!cats.length || total === 0) {
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.arc(cx, cy, r, 0, Math.PI * 2, true);
    ctx.fillStyle = cssVar('--surface3');
    ctx.fill('evenodd'); return;
  }
  let ang = -Math.PI / 2;
  cats.forEach(([, val, color]) => {
    const sl = (val / total) * Math.PI * 2 - 0.04;
    ctx.beginPath(); ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, R, ang, ang + sl); ctx.arc(cx, cy, r, ang + sl, ang, true);
    ctx.closePath(); ctx.fillStyle = color || '#6070a0'; ctx.fill();
    ang += sl + 0.04;
  });
}
