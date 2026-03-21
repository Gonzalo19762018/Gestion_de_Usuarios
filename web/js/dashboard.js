import { MONTHS_ES, THIS_YEAR, THIS_MONTH, CAT_COLORS, CAT_ICONS, esc, genId, showConfirm, _openFocusTrap, _closeFocusTrap, toast } from './config.js';
const cssVar = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
import {
  allMonths, detailYear, detailMonth, curFilter, modalType, quickType, dashYear,
  mk, getMonth, saveMonth, setCurFilter, setModalType_, setQuickType_,
} from './db.js';
import { computeMonthByYM, computeMonth, fmt, fmtShort, buildYearOptions, setupCanvas, getPrevSaving, applyRollovers } from './compute.js';
import { getDeferralsForMonth, deferralCuota, accountBadgeHtml, saveDeferral } from './deferrals.js';
import { drawDonut } from './charts.js';

// ════════════════════════════════════════════════════════
// BUDGET STATE (owned here; budget.js uses setters)
// ════════════════════════════════════════════════════════
export let budgetYear  = THIS_YEAR;
export let budgetMonth = THIS_MONTH;
export function setBudgetYear_(v)  { budgetYear = v; }
export function setBudgetMonth_(v) { budgetMonth = v; }

// ── SKELETON HELPERS ─────────────────────────────────────────────────────────
function _skelMonthCards(n) {
  return Array.from({ length: n }, () =>
    `<div class="skel-month-card">
       <div class="skel" style="height:12px;width:50%"></div>
       <div class="skel" style="height:22px;width:65%"></div>
       <div class="skel" style="height:10px;width:40%"></div>
       <div class="skel" style="height:6px;border-radius:3px"></div>
     </div>`
  ).join('');
}

// ── MONTH CARDS ──
export function renderDashMonthCards() {
  const grid = document.getElementById('dashMonthsGrid');
  grid.innerHTML = _skelMonthCards(12);
  requestAnimationFrame(() => {
    const cards = [];
    for (let m = 0; m < 12; m++) cards.push(monthCardHTML(dashYear, m, 'dashboard'));
    grid.innerHTML = cards.join('');
  });
}

export function renderMesesView() {
  const yearSel = document.getElementById('yearFilter');
  const currentVal = parseInt(yearSel.value) || THIS_YEAR;
  const years = buildYearOptions();
  yearSel.innerHTML = '';
  years.forEach(y => {
    const o = document.createElement('option');
    o.value = y; o.textContent = y;
    if (y === currentVal) o.selected = true;
    yearSel.appendChild(o);
  });
  const year = parseInt(yearSel.value) || THIS_YEAR;
  const grid = document.getElementById('allMonthsGrid');
  const cards = [];
  for (let m = 11; m >= 0; m--) { cards.push(monthCardHTML(year, m, 'meses')); }
  grid.innerHTML = cards.join('');
  renderYearBarChart(year);
  document.getElementById('yearSummarySub').textContent = `Todos los meses de ${year}`;
}

export function monthCardHTML(y, m, from) {
  const md = allMonths[mk(y, m)];
  const c = computeMonthByYM(y, m);
  const directTx = (md?.transactions || []).filter(t => t.type === 'gasto').length;
  const deferTx  = getDeferralsForMonth(y, m).length;
  const txCount  = directTx + deferTx;
  const isNow = y === THIS_YEAR && m === THIS_MONTH;
  const pct = c.totalIn > 0 ? Math.min(100, Math.max(0, (c.saving / c.totalIn) * 100)) : 0;
  const savClass = c.saving >= 0 ? 'pos' : 'neg';
  return `<div class="month-card" data-y="${y}" data-m="${m}" data-from="${from}" tabindex="0" role="button" aria-label="${MONTHS_ES[m]} ${y}">
    <div class="month-card-header">
      <div>
        <div class="month-card-name">${MONTHS_ES[m]}${isNow ? ' <span style="font-size:10px;color:var(--accent);font-family:DM Mono">HOY</span>' : ''}</div>
        <div class="month-card-year">${y}</div>
      </div>
      <div style="font-size:20px">${m < 4 ? '❄️' : m < 7 ? '🌱' : m < 10 ? '☀️' : '🍂'}</div>
    </div>
    <div class="month-card-saving ${savClass}">${fmt(c.saving)}</div>
    <div class="month-card-sub">${txCount} transacciones · ${Math.round(pct)}% ahorro</div>
    <div class="month-mini-bar"><div class="month-mini-fill" style="width:${pct}%"></div></div>
    <div class="month-card-stats">
      <div class="mcs"><div class="mcs-label">Ingreso</div><div class="mcs-val" style="color:var(--green)">${fmtShort(c.totalIn)}</div></div>
      <div class="mcs"><div class="mcs-label">Gasto</div><div class="mcs-val" style="color:var(--red)">${fmtShort(c.tE)}</div></div>
    </div>
  </div>`;
}

export function renderYearBarChart(year) {
  const canvas = document.getElementById('yearBarChart');
  const W = canvas.parentElement.clientWidth - 48;
  const ctx = setupCanvas(canvas, W, 180);
  const months = [], maxV = [0];
  for (let m = 0; m < 12; m++) {
    const c = computeMonthByYM(year, m);
    months.push({ ...c, label: MONTHS_ES[m].slice(0, 3) });
    maxV.push(c.totalIn, c.tE, Math.abs(c.saving));
  }
  const maxVal = Math.max(...maxV, 1);
  const pad = { top:16, right:16, bottom:32, left:50 };
  const cW = W - pad.left - pad.right, cH = 180 - pad.top - pad.bottom;
  ctx.strokeStyle = cssVar('--border'); ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const yp = pad.top + cH * (1 - i / 4);
    ctx.beginPath(); ctx.moveTo(pad.left, yp); ctx.lineTo(pad.left + cW, yp); ctx.stroke();
    ctx.fillStyle = cssVar('--text3'); ctx.font = '10px DM Mono'; ctx.textAlign = 'right';
    ctx.fillText(fmtShort(maxVal * i / 4), pad.left - 6, yp + 4);
  }
  const cols = ['rgba(61,255,160,.7)', 'rgba(255,92,122,.7)', 'rgba(108,99,255,.7)'];
  months.forEach((d, i) => {
    const slotW = cW / 12, x0 = pad.left + i * slotW + 4;
    const bW = (slotW - 12) / 3;
    [d.totalIn, d.tE, Math.max(0, d.saving)].forEach((v, j) => {
      const bH = maxVal > 0 ? (v / maxVal) * cH : 0;
      const bX = x0 + j * (bW + 2), bY = pad.top + cH - bH;
      ctx.fillStyle = cols[j];
      ctx.beginPath(); ctx.roundRect(bX, bY, bW, bH, 2); ctx.fill();
    });
    ctx.fillStyle = cssVar('--text3'); ctx.font = '9px Cabinet Grotesk'; ctx.textAlign = 'center';
    ctx.fillText(d.label, pad.left + i * slotW + slotW / 2, 180 - pad.bottom + 16);
  });
}

export function renderSidebarMonths() {
  const el = document.getElementById('sidebarMonths');
  const nowOrd = THIS_YEAR * 12 + THIS_MONTH;
  const shown = new Set();
  const list = [];

  for (let i = 3; i >= 0; i--) {
    const ord = nowOrd - i;
    shown.add(ord);
    list.push({ y: Math.floor(ord / 12), m: ord % 12 });
  }

  for (let i = 1; i <= 12; i++) {
    const ord = nowOrd + i;
    const y = Math.floor(ord / 12), m = ord % 12;
    if (!shown.has(ord) && getDeferralsForMonth(y, m).length > 0) {
      shown.add(ord);
      list.push({ y, m });
      if (list.length >= 10) break;
    }
  }

  el.innerHTML = list.map(({ y, m }) => {
    const c = computeMonthByYM(y, m);
    const isD = y === detailYear && m === detailMonth;
    const isFuture = y * 12 + m > nowOrd;
    return `<div class="month-chip ${isD ? 'active' : ''}" data-y="${y}" data-m="${m}" data-from="dashboard" tabindex="0" role="button" aria-label="${MONTHS_ES[m]} ${y}">
      <span>${MONTHS_ES[m].slice(0, 3)} ${y}${isFuture ? ' <span style="font-size:9px;color:var(--yellow);opacity:.8">fut</span>' : ''}</span>
      <span class="month-chip-saving ${c.saving >= 0 ? 'pos' : 'neg'}">${fmtShort(c.saving)}</span>
    </div>`;
  }).join('');
}

// ════════════════════════════════════════════════════════
// DETAIL VIEW
// ════════════════════════════════════════════════════════
export function renderDetail() {
  applyRollovers();
  const y = detailYear, m = detailMonth;
  const md = getMonth(y, m);
  const c = computeMonth(md);

  const directCount = (md.transactions || []).filter(t => t.type === 'gasto').length;
  const deferCount  = c.defCuotas.length;
  document.getElementById('detailTitle').textContent = `${MONTHS_ES[m]} ${y}`;
  document.getElementById('detailSub').textContent   = `${directCount + deferCount} movimientos · ${fmt(c.saving)} de ahorro`;

  const rolloverEl = document.getElementById('detailRollover');
  if (md.rolloverApplied > 0) {
    rolloverEl.classList.remove('hidden');
    document.getElementById('detailRolloverAmt').textContent = fmt(md.rolloverApplied);
    let pm = m - 1, py = y; if (pm < 0) { pm = 11; py--; }
    document.getElementById('detailRolloverSub').textContent = `Del ahorro de ${MONTHS_ES[pm]} ${py} · Total disponible: ${fmt(c.totalIn)}`;
  } else { rolloverEl.classList.add('hidden'); }

  document.getElementById('dsc-income').textContent       = fmt(c.base);
  document.getElementById('dsc-income-desc').textContent  = md.income?.desc || '—';
  document.getElementById('dsc-rollover').textContent     = fmt(c.rollover);
  document.getElementById('dsc-rollover-lbl').textContent = c.rollover > 0 ? 'Incluido' : 'No incluido';
  document.getElementById('dsc-expense').textContent      = fmt(c.tE);
  document.getElementById('dsc-expense-count').textContent = `${directCount} gastos · ${deferCount} diferidos`;
  document.getElementById('dsc-defer').textContent        = fmt(c.tT);
  document.getElementById('dsc-defer-count').textContent  = `${deferCount} diferido${deferCount !== 1 ? 's' : ''} activo${deferCount !== 1 ? 's' : ''}`;
  document.getElementById('dsc-saving').textContent       = fmt(Math.max(0, c.saving));
  const pct = c.totalIn > 0 ? Math.round(c.saving / c.totalIn * 100) : 0;
  document.getElementById('dsc-saving-pct').textContent   = `${Math.max(0, pct)}% del total`;

  document.getElementById('d-income').value           = c.base || '';
  document.getElementById('d-income-desc').value      = md.income?.desc || '';
  document.getElementById('d-include-rollover').value = md.income?.includeRollover ? '1' : '0';

  document.getElementById('savBigDetail').textContent = fmt(Math.max(0, c.saving));
  document.getElementById('savPctDetail').textContent = `${Math.max(0, pct)}% guardado`;
  const barW = c.totalIn > 0 ? Math.min(100, Math.max(0, (c.saving / c.totalIn) * 100)) : 0;
  document.getElementById('savBarDetail').style.width = barW + '%';
  document.getElementById('savMetaL').textContent     = fmt(c.tE) + ' gastado';
  document.getElementById('savMetaR').textContent     = fmt(c.totalIn) + ' total';

  document.getElementById('savBreakdown').innerHTML = `
    <div class="bk-row"><span style="color:var(--text3)">Ingreso base</span><span class="bk-val" style="color:var(--green)">+${fmt(c.base)}</span></div>
    ${c.rollover > 0 ? `<div class="bk-row"><span style="color:var(--text3)">Ahorro anterior</span><span class="bk-val" style="color:var(--blue)">+${fmt(c.rollover)}</span></div>` : ''}
    <div class="bk-row"><span style="color:var(--text3)">Gastos directos</span><span class="bk-val" style="color:var(--red)">−${fmt(c.tG)}</span></div>
    <div class="bk-row"><span style="color:var(--text3)">Cuotas tarjeta</span><span class="bk-val" style="color:var(--yellow)">−${fmt(c.tT)}</span></div>
    <div class="bk-divider"></div>
    <div class="bk-row"><strong>Ahorro neto</strong><strong class="bk-val" style="color:${c.saving >= 0 ? 'var(--green)' : 'var(--red)'}">${fmt(c.saving)}</strong></div>
    ${c.saving < 0 ? `<div style="font-size:11px;color:var(--red);margin-top:4px">⚠️ Déficit de ${fmt(Math.abs(c.saving))}</div>` : ''}
  `;

  renderDetailCharts(md, c);
  renderTxnList(md);
  renderDeferreds(md);
  renderSidebarMonths();
}

function renderDetailCharts(md, c) {
  const bycat = {};
  (md.transactions || []).filter(t => t.type === 'gasto').forEach(t => {
    bycat[t.cat] = (bycat[t.cat] || 0) + t.amount;
  });
  c.defCuotas.forEach(({ d, cuotaAmt }) => {
    bycat[d.cat] = (bycat[d.cat] || 0) + cuotaAmt;
  });
  const cats = Object.entries(bycat).sort((a, b) => b[1] - a[1]);
  const total = cats.reduce((s, [, v]) => s + v, 0);
  document.getElementById('detailDonutTotal').textContent = fmt(total);
  drawDonut('detailDonut', cats, total, 80, 52);
  document.getElementById('detailDonutLegend').innerHTML = cats.map(([cat, val]) => {
    const pct = total > 0 ? Math.round(val / total * 100) : 0;
    const col = CAT_COLORS[cat] || '#6070a0';
    return `<div class="legend-row"><div class="legend-left"><div class="legend-dot" style="background:${col}"></div><span class="legend-name">${CAT_ICONS[cat] || ''} ${esc(cat)}</span></div><div class="legend-right"><div class="legend-pct" style="color:${col}">${pct}%</div><div class="legend-amt">${fmt(val)}</div></div></div>`;
  }).join('');

  const canvas = document.getElementById('detailBarChart');
  const W = canvas.parentElement.clientWidth - 48;
  const ctx = setupCanvas(canvas, W, 160);
  const bars = [
    { label:'Ingreso', val:c.totalIn,           color:'rgba(61,255,160,.8)' },
    { label:'Gastos',  val:c.tG,                color:'rgba(255,92,122,.8)' },
    { label:'Tarjeta', val:c.tT,                color:'rgba(255,201,71,.8)' },
    { label:'Ahorro',  val:Math.max(0, c.saving),color:'rgba(108,99,255,.8)' },
  ];
  const maxVal = Math.max(...bars.map(b => b.val), 1);
  const pad = { top:10, right:10, bottom:32, left:10 };
  const cW = W - pad.left - pad.right, cH = 160 - pad.top - pad.bottom;
  const bW = (cW / 4) - 16;
  bars.forEach((b, i) => {
    const bH = maxVal > 0 ? (b.val / maxVal) * cH : 0;
    const bX = pad.left + i * (cW / 4) + 8;
    const bY = pad.top + cH - bH;
    const grad = ctx.createLinearGradient(0, bY, 0, pad.top + cH);
    grad.addColorStop(0, b.color); grad.addColorStop(1, b.color.replace('.8', '.15'));
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.roundRect(bX, bY, bW, bH, 4); ctx.fill();
    ctx.fillStyle = cssVar('--text2'); ctx.font = '10px DM Mono'; ctx.textAlign = 'center';
    if (b.val > 0) ctx.fillText(fmtShort(b.val), bX + bW / 2, bY - 5);
    ctx.fillStyle = cssVar('--text3'); ctx.font = '10px Cabinet Grotesk';
    ctx.fillText(b.label, bX + bW / 2, 160 - pad.bottom + 16);
  });
}

export function renderDeferreds(md) {
  const card = document.getElementById('deferCard');
  const list = document.getElementById('deferListDetail');
  const y = md.year, m = md.month;
  const active = getDeferralsForMonth(y, m);
  if (!active.length) { card.style.display = 'none'; return; }
  card.style.display = 'block';

  list.innerHTML = active.map(({ d, cuotaIdx, cuotaAmt }) => {
    const pct     = Math.round(((cuotaIdx + 1) / d.cuotas) * 100);
    const isLast  = cuotaIdx === d.cuotas - 1;
    const base    = Math.floor(d.amount * 100 / d.cuotas) / 100;
    const endY    = Math.floor((d.originYear * 12 + d.originMonth + d.cuotas - 1) / 12);
    const endM    = (d.originMonth + d.cuotas - 1) % 12;
    const pendAmt = d.amount - base * cuotaIdx;

    return `<div style="padding:12px 0;border-bottom:1px solid var(--border);cursor:pointer"
        data-deferral-id="${d.id}" tabindex="0" role="button" aria-label="${esc(d.name)}">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px">
        <div style="flex:1;min-width:0">
          <div style="font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(d.name)}</div>
          <div style="font-size:11px;color:var(--text3);margin-top:2px">
            Cuota <strong>${cuotaIdx + 1}</strong> de ${d.cuotas}
            ${isLast ? ' <span style="color:var(--green);font-weight:700">· Última ✓</span>' : ''}
            · vence ${MONTHS_ES[endM].slice(0, 3)} ${endY}
          </div>
        </div>
        <div style="text-align:right;flex-shrink:0;margin-left:12px">
          <div style="font-family:'DM Mono',monospace;font-size:14px;font-weight:600;color:${isLast ? 'var(--green)' : 'var(--yellow)'}">${fmt(cuotaAmt)}</div>
          <div style="font-size:10px;color:var(--text3)">${fmt(pendAmt)} pendiente</div>
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:8px">
        <div style="flex:1;height:5px;background:var(--surface3);border-radius:3px;overflow:hidden">
          <div style="height:100%;width:${pct}%;background:${isLast ? 'var(--green)' : 'var(--yellow)'};border-radius:3px;transition:width .5s"></div>
        </div>
        <span style="font-family:'DM Mono',monospace;font-size:10px;color:var(--text3);flex-shrink:0">${pct}%</span>
      </div>
    </div>`;
  }).join('');
}

export function renderTxnList(md) {
  const y = md.year, m = md.month;
  let items = [];

  (md.transactions || []).filter(t => t.type === 'gasto').forEach(t => {
    items.push({ kind:'gasto', id:t.id, name:t.name, cat:t.cat, date:t.date, amount:t.amount, txn:t });
  });

  getDeferralsForMonth(y, m).forEach(({ d, cuotaIdx, cuotaAmt }) => {
    items.push({ kind:'tarjeta', id:d.id, name:d.name, cat:d.cat, date:d.date, amount:cuotaAmt,
      cuotaIdx, cuotas:d.cuotas, totalAmount:d.amount, deferral:d });
  });

  if (curFilter === 'gasto')   items = items.filter(i => i.kind === 'gasto');
  if (curFilter === 'tarjeta') items = items.filter(i => i.kind === 'tarjeta');

  items.sort((a, b) => b.date.localeCompare(a.date));

  const wrap = document.getElementById('txnListWrap');
  if (!items.length) { wrap.innerHTML = `<div class="empty-msg"><div class="e-ico">📭</div>Sin movimientos este mes</div>`; return; }

  wrap.innerHTML = items.map(item => {
    const col  = CAT_COLORS[item.cat] || '#6070a0';
    const ico  = CAT_ICONS[item.cat]  || '📦';
    const isC  = item.kind === 'tarjeta';
    const clr  = isC ? 'var(--yellow)' : 'var(--red)';
    const ds   = new Date(item.date + 'T12:00:00').toLocaleDateString('es-MX', { day:'numeric', month:'short' });
    const isLast = isC && item.cuotaIdx === item.cuotas - 1;

    const rowData = isC
      ? `data-deferral-id="${item.id}"`
      : `data-txn-id="${item.id}" data-y="${y}" data-m="${m}"`;

    const delBtn = isC
      ? `<button class="btn-del" data-del-deferral="${item.id}" title="Eliminar diferido completo" aria-label="Eliminar diferido: ${esc(item.name)}">×</button>`
      : `<button class="btn-del" data-del-txn="${item.id}" data-del-y="${y}" data-del-m="${m}" aria-label="Eliminar: ${esc(item.name)}">×</button>`;

    return `<div class="txn-row" ${rowData} tabindex="0" role="button" aria-label="${esc(item.name)}, ${fmt(item.amount)}">
      <div class="txn-ico" style="background:${col}18">${ico}</div>
      <div class="txn-info">
        <div class="txn-name">${esc(item.name)}</div>
        <div class="txn-meta">
          <span class="txn-date">${ds}</span>
          <span class="txn-cat-badge" style="background:${col}18;color:${col}">${item.cat}</span>
          ${isC ? `<span class="txn-card-badge">💳 ${item.cuotaIdx + 1}/${item.cuotas}${isLast ? ' ✓' : ''}</span>` : ''}
          ${accountBadgeHtml(isC ? item.deferral?.accountId : item.txn?.accountId)}
        </div>
      </div>
      <div class="txn-amount-col">
        <div class="txn-amt" style="color:${clr}">−${fmt(item.amount)}</div>
        ${isC ? `<div class="txn-sub">${fmt(item.totalAmount)} total</div>` : ''}
      </div>
      ${delBtn}
    </div>`;
  }).join('');
}

// ════════════════════════════════════════════════════════
// INCOME / TXN ACTIONS
// ════════════════════════════════════════════════════════
export async function saveIncome() {
  const btn = document.getElementById('btnSaveIncome');
  const origText = btn?.textContent;
  if (btn) { btn.disabled = true; btn.textContent = 'Guardando…'; }
  try {
    const y = detailYear, m = detailMonth;
    const md = getMonth(y, m);
    md.income = {
      amount: parseFloat(document.getElementById('d-income').value) || 0,
      desc:   document.getElementById('d-income-desc').value.trim() || 'Ingreso mensual',
      includeRollover: document.getElementById('d-include-rollover').value === '1',
    };
    md.rolloverApplied = md.income.includeRollover ? getPrevSaving(y, m) : 0;
    await saveMonth(md);
    applyRollovers();
    renderDetail();
    toast('✅ Ingreso guardado');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = origText; }
  }
}

export function setFilter(f, btn) {
  setCurFilter(f);
  btn.closest('.filter-pills').querySelectorAll('.filter-pill').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderTxnList(getMonth(detailYear, detailMonth));
}

export function setQuickType(t, btn) {
  setQuickType_(t);
  btn.closest('.type-tabs').querySelectorAll('.type-tab').forEach(b => b.className = 'type-tab');
  btn.className = `type-tab t-${t}`;
  document.getElementById('q-cuotas-field').style.display = t === 'tarjeta' ? 'block' : 'none';
}

export async function quickAdd() {
  const name      = document.getElementById('q-name').value.trim();
  const amount    = parseFloat(document.getElementById('q-amount').value);
  const cat       = document.getElementById('q-cat').value;
  const date      = document.getElementById('q-date').value;
  const cuotas    = parseInt(document.getElementById('q-cuotas').value) || 1;
  const accountId = parseInt(document.getElementById('q-account').value) || null;
  if (!name || !amount || amount <= 0) { toast('⚠️ Completa nombre y monto'); return; }
  if (!date) { toast('⚠️ Selecciona fecha'); return; }

  try {
    if (quickType === 'tarjeta') {
      const d = { id:genId(), name, amount, cat, date, cuotas, accountId,
                  originYear:detailYear, originMonth:detailMonth };
      await saveDeferral(d);
      toast(`✅ Diferido en ${cuotas} cuota${cuotas > 1 ? 's' : ''} · ${fmt(deferralCuota(d, 0))}/mes`);
    } else {
      const md = getMonth(detailYear, detailMonth);
      md.transactions.push({ id:genId(), type:'gasto', name, amount, cat, date, accountId, cuotas:1, cuotaPago:amount });
      await saveMonth(md);
      toast('✅ Gasto guardado');
    }
    renderDetail();
    document.getElementById('q-name').value   = '';
    document.getElementById('q-amount').value = '';
  } catch (err) {
    console.error('quickAdd error:', err);
    toast('❌ Error al guardar, intenta de nuevo');
  }
}

export async function deleteTxn(y, m, id) {
  const md = getMonth(y, m);
  md.transactions = md.transactions.filter(t => t.id !== id);
  await saveMonth(md);
  const cur = document.querySelector('.view.active').id.replace('view-', '');
  if (cur === 'detail')        renderDetail();
  else if (cur === 'dashboard') { const { renderDashboard } = await import('./compute.js'); renderDashboard(); }
  else if (cur === 'presupuesto') { const { renderBudgetView } = await import('./budget.js'); renderBudgetView(); }
  else renderMesesView();
  toast('🗑️ Eliminado');
}

export function confirmDeleteTxn(y, m, id) {
  const md = getMonth(y, m);
  const txn = (md?.transactions || []).find(t => t.id === id);
  const name = txn ? txn.name : 'este gasto';
  showConfirm(`¿Eliminar "${esc(name)}"?`, () => deleteTxn(y, m, id));
}

// ════════════════════════════════════════════════════════
// MODAL
// ════════════════════════════════════════════════════════
export function syncModalDateRange() {
  const monthVal = document.getElementById('m-month').value;
  if (!monthVal) return;
  const [y, m] = monthVal.split('_').map(Number);
  const pad  = n => String(n).padStart(2, '0');
  const first = `${y}-${pad(m + 1)}-01`;
  const last  = `${y}-${pad(m + 1)}-${pad(new Date(y, m + 1, 0).getDate())}`;
  const dateEl = document.getElementById('m-date');
  dateEl.min = first; dateEl.max = last;
  if (!dateEl.value || dateEl.value < first || dateEl.value > last) dateEl.value = first;
}

export function openAddModal() {
  const sel = document.getElementById('m-month');
  sel.innerHTML = '';
  const nowOrdinal = THIS_YEAR * 12 + THIS_MONTH;
  for (let ord = nowOrdinal + 24; ord >= nowOrdinal - 12; ord--) {
    const y = Math.floor(ord / 12), m = ord % 12;
    const o = document.createElement('option');
    o.value = `${y}_${m}`; o.textContent = `${MONTHS_ES[m]} ${y}`;
    if (ord === nowOrdinal) o.selected = true;
    sel.appendChild(o);
  }
  if (document.getElementById('view-detail').classList.contains('active')) {
    const target = `${detailYear}_${detailMonth}`;
    const found  = [...sel.options].find(o => o.value === target);
    if (found) found.selected = true;
  }
  syncModalDateRange();
  const overlay = document.getElementById('modalOverlay');
  overlay.querySelectorAll('.type-tab').forEach(b => b.className = 'type-tab');
  overlay.querySelector('.type-tab').className = 'type-tab t-gasto';
  setModalType_('gasto');
  document.getElementById('m-cuotas-wrap').style.display = 'none';
  overlay.classList.add('open');
  _openFocusTrap(overlay.querySelector('.modal'));
}

export function closeModal() { document.getElementById('modalOverlay').classList.remove('open'); _closeFocusTrap(); }

export function setModalType(t, btn) {
  setModalType_(t);
  document.querySelectorAll('#modalOverlay .type-tab').forEach(b => b.className = 'type-tab');
  btn.className = `type-tab t-${t}`;
  document.getElementById('m-cuotas-wrap').style.display = t === 'tarjeta' ? 'block' : 'none';
}

export async function modalAdd() {
  const name      = document.getElementById('m-name').value.trim();
  const amount    = parseFloat(document.getElementById('m-amount').value);
  const cat       = document.getElementById('m-cat').value;
  const date      = document.getElementById('m-date').value;
  const monthVal  = document.getElementById('m-month').value;
  const cuotas    = parseInt(document.getElementById('m-cuotas').value) || 1;
  const accountId = parseInt(document.getElementById('m-account').value) || null;
  if (!name || !amount || amount <= 0) { toast('⚠️ Completa nombre y monto'); return; }
  if (!date)     { toast('⚠️ Selecciona una fecha'); return; }
  if (!monthVal) { toast('⚠️ Selecciona el mes'); return; }

  const [my, mm] = monthVal.split('_').map(Number);

  try {
    if (modalType === 'tarjeta') {
      const d = { id:genId(), name, amount, cat, date, cuotas, accountId, originYear:my, originMonth:mm };
      await saveDeferral(d);
      toast(`✅ Diferido ${MONTHS_ES[mm]} ${my} · ${cuotas} cuota${cuotas > 1 ? 's' : ''} · ${fmt(deferralCuota(d, 0))}/mes`);
    } else {
      const md = getMonth(my, mm);
      md.transactions.push({ id:genId(), type:'gasto', name, amount, cat, date, accountId, cuotas:1, cuotaPago:amount });
      await saveMonth(md);
      toast(`✅ Gasto agregado en ${MONTHS_ES[mm]} ${my}`);
    }
    closeModal();
    const cur = document.querySelector('.view.active').id.replace('view-', '');
    if (cur === 'detail')           renderDetail();
    else if (cur === 'dashboard')   { const { renderDashboard } = await import('./compute.js'); renderDashboard(); }
    else if (cur === 'presupuesto') { const { renderBudgetView } = await import('./budget.js'); renderBudgetView(); }
    else renderMesesView();
    document.getElementById('m-name').value   = '';
    document.getElementById('m-amount').value = '';
  } catch (err) {
    console.error('modalAdd error:', err);
    toast('❌ Error al guardar, intenta de nuevo');
  }
}

// ════════════════════════════════════════════════════════
// BUDGET MODEL (data layer for budget.js views)
// ════════════════════════════════════════════════════════
export const MACRO_CATS = [
  { id:'vivienda',    name:'Vivienda & Hogar',       icon:'🏠', color:'#7c6af7', cats:['Vivienda','Servicios'] },
  { id:'alimentacion',name:'Alimentación',           icon:'🍽️', color:'#ff5c7a', cats:['Alimentación','Restaurantes'] },
  { id:'transporte',  name:'Transporte',             icon:'🚗', color:'#ffc947', cats:['Transporte'] },
  { id:'salud',       name:'Salud & Bienestar',      icon:'💊', color:'#3dffa0', cats:['Salud'] },
  { id:'ocio',        name:'Ocio & Entretenimiento', icon:'🎬', color:'#ff6ec7', cats:['Entretenimiento','Suscripciones','Viajes'] },
  { id:'personal',    name:'Personal & Educación',   icon:'📚', color:'#47c8ff', cats:['Educación','Ropa'] },
  { id:'otros',       name:'Otros',                  icon:'📦', color:'#6070a0', cats:['Otros'] },
];

export function getBudget(y, m) {
  const md = allMonths[mk(y, m)];
  return (md && md.budgets) ? md.budgets : {};
}

export async function setBudget(y, m, budgetObj) {
  const md = getMonth(y, m);
  md.budgets = budgetObj;
  await saveMonth(md);
}

export function getMacroSpending(y, m) {
  const result = {};
  MACRO_CATS.forEach(macro => {
    result[macro.id] = { spent: 0, subCats: {} };
    macro.cats.forEach(cat => { result[macro.id].subCats[cat] = 0; });
  });

  const md = allMonths[mk(y, m)];
  (md?.transactions || []).filter(t => t.type === 'gasto').forEach(t => {
    const macro = MACRO_CATS.find(mc => mc.cats.includes(t.cat));
    if (macro) {
      result[macro.id].spent += t.amount;
      result[macro.id].subCats[t.cat] = (result[macro.id].subCats[t.cat] || 0) + t.amount;
    }
  });

  getDeferralsForMonth(y, m).forEach(({ d, cuotaAmt }) => {
    const macro = MACRO_CATS.find(mc => mc.cats.includes(d.cat));
    if (macro) {
      result[macro.id].spent += cuotaAmt;
      result[macro.id].subCats[d.cat] = (result[macro.id].subCats[d.cat] || 0) + cuotaAmt;
    }
  });

  return result;
}
