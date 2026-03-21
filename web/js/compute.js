import { MONTHS_ES, THIS_YEAR, THIS_MONTH } from './config.js';
import {
  allMonths, allDeferrals, detailYear, detailMonth, dashYear, prevView,
  setDetailYear, setDetailMonth, setDashYear_, setPrevView,
  mk, getMonth,
} from './db.js';
import { getDeferralsForMonth, deferralCuota } from './deferrals.js';

// ── HIDPI CANVAS HELPER ──
export function setupCanvas(canvas, W, H) {
  const dpr = window.devicePixelRatio || 1;
  canvas.width  = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  canvas.style.width  = W + 'px';
  canvas.style.height = H + 'px';
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  return ctx;
}

// ── COMPUTE CACHE ────────────────────────────────────────
const _computeCache = new Map();
export function invalidateComputeCache() { _computeCache.clear(); }

export function computeMonthByYM(y, m) {
  const key = y * 12 + m;
  if (_computeCache.has(key)) return _computeCache.get(key);
  const md = allMonths[mk(y, m)];
  const result = computeMonth(md || { year:y, month:m, income:{amount:0}, transactions:[], rolloverApplied:0 });
  _computeCache.set(key, result);
  return result;
}

export function computeMonth(md) {
  const y = md.year, m = md.month;
  const inc      = md.income || { amount:0 };
  const base     = inc.amount || 0;
  const rollover = md.rolloverApplied || 0;
  const totalIn  = base + rollover;

  const txns = md.transactions || [];
  const tG   = txns.filter(t => t.type === 'gasto').reduce((s, t) => s + t.amount, 0);

  const defCuotas = getDeferralsForMonth(y, m);
  const tT = defCuotas.reduce((s, dc) => s + dc.cuotaAmt, 0);

  const tE    = tG + tT;
  const saving = totalIn - tE;
  return { base, rollover, totalIn, tG, tT, tE, saving, txns, defCuotas };
}

// ════════════════════════════════════════════════════════
// ROLLOVER COMPUTATION
// ════════════════════════════════════════════════════════
export function getPrevSaving(y, m) {
  let pm = m - 1, py = y;
  if (pm < 0) { pm = 11; py--; }
  const prev = allMonths[mk(py, pm)];
  if (!prev) return 0;
  const { saving } = computeMonth(prev);
  return Math.max(0, saving);
}

export function applyRollovers() {
  _computeCache.clear();
  const sorted = Object.values(allMonths).sort((a, b) => a.year !== b.year ? a.year - b.year : a.month - b.month);
  sorted.forEach(md => {
    if (md.income?.includeRollover) {
      md.rolloverApplied = getPrevSaving(md.year, md.month);
    } else {
      md.rolloverApplied = 0;
    }
  });
}

// ════════════════════════════════════════════════════════
// NAVIGATION
// ════════════════════════════════════════════════════════
export function showView(name, fromView) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById('view-' + name).classList.add('active');
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.querySelectorAll('.bn-item').forEach(b => b.classList.remove('active'));
  const bnMap = { dashboard:'bn-dashboard', meses:'bn-meses', presupuesto:'bn-presupuesto', cuentas:'bn-cuentas' };
  if (bnMap[name]) document.getElementById(bnMap[name])?.classList.add('active');
  const titles = { dashboard:'Dashboard', meses:'Todos los meses', presupuesto:'Presupuestos', cuentas:'Cuentas', usuarios:'Usuarios', detail: `${MONTHS_ES[detailMonth]} ${detailYear}` };
  document.getElementById('topbarTitle').textContent = titles[name] || name;

  // Use dynamic imports to avoid circular deps at evaluation time
  if (name === 'dashboard')   { document.querySelectorAll('.nav-item')[0].classList.add('active'); renderDashboard(); }
  if (name === 'meses')       { document.querySelectorAll('.nav-item')[1].classList.add('active'); import('./dashboard.js').then(m => m.renderMesesView()); }
  if (name === 'presupuesto') { document.querySelectorAll('.nav-item')[2].classList.add('active'); import('./budget.js').then(m => m.renderBudgetView()); }
  if (name === 'cuentas')     { document.querySelectorAll('.nav-item')[3].classList.add('active'); import('./accounts.js').then(m => m.renderAccountsView()); }
  if (name === 'usuarios')    { document.getElementById('navUsuarios')?.classList.add('active'); import('./users.js').then(m => m.renderUsersView()); }
  if (name === 'detail')      { setPrevView(fromView || 'dashboard'); import('./dashboard.js').then(m => m.renderDetail()); }
  if (fromView) setPrevView(fromView);
}

export function goBack() { showView(prevView); }

export function openDetail(y, m, from) {
  setDetailYear(y); setDetailMonth(m);
  document.getElementById('q-date').value = `${y}-${String(m + 1).padStart(2, '0')}-01`;
  showView('detail', from || 'dashboard');
  document.getElementById('topbarTitle').textContent = `${MONTHS_ES[m]} ${y}`;
}

export function navigateDetailMonth(dir) {
  const ord = detailYear * 12 + detailMonth + dir;
  setDetailYear(Math.floor(ord / 12));
  setDetailMonth(ord % 12);
  if (detailYear !== dashYear) setDashYear_(detailYear);
  document.getElementById('q-date').value = `${detailYear}-${String(detailMonth + 1).padStart(2, '0')}-01`;
  import('./dashboard.js').then(m => { m.renderDetail(); m.renderSidebarMonths(); });
  document.getElementById('topbarTitle').textContent = `${MONTHS_ES[detailMonth]} ${detailYear}`;
}

// ════════════════════════════════════════════════════════
// FORMAT
// ════════════════════════════════════════════════════════
export function fmt(n) { return '$' + (n || 0).toLocaleString('es-MX', { minimumFractionDigits:2, maximumFractionDigits:2 }); }
export function fmtShort(n) {
  const v = Math.abs(n || 0);
  if (v >= 1000000) return '$' + (v / 1000000).toFixed(1) + 'M';
  if (v >= 1000)    return '$' + (v / 1000).toFixed(1) + 'k';
  return fmt(n);
}

// ════════════════════════════════════════════════════════
// DASHBOARD
// ════════════════════════════════════════════════════════
export function buildYearOptions() {
  const ySet = new Set();
  for (let y = THIS_YEAR - 3; y <= THIS_YEAR + 10; y++) ySet.add(y);
  Object.values(allMonths).forEach(md => ySet.add(md.year));
  allDeferrals.forEach(d => {
    const endY = Math.floor((d.originYear * 12 + d.originMonth + d.cuotas - 1) / 12);
    for (let y = d.originYear; y <= endY; y++) ySet.add(y);
  });
  return [...ySet].sort((a, b) => b - a);
}

export function setDashYear(val) {
  setDashYear_(parseInt(val));
  renderDashboard();
}

export function renderDashboard() {
  applyRollovers();

  const sel = document.getElementById('dashYearSel');
  const years = buildYearOptions();
  sel.innerHTML = '';
  years.forEach(y => {
    const o = document.createElement('option');
    o.value = y; o.textContent = y;
    if (y === dashYear) o.selected = true;
    sel.appendChild(o);
  });

  const year = dashYear;
  let totalIn=0, totalEx=0, totalDef=0, totalSav=0, txCount=0, defCount=0, savMonths=0, savSum=0;
  for (let m = 0; m < 12; m++) {
    const c  = computeMonthByYM(year, m);
    const md = allMonths[mk(year, m)];
    if (!c.totalIn && !c.tT && !c.tG) continue;
    totalIn  += c.totalIn;
    totalEx  += c.tG;
    totalDef += c.tT;
    txCount  += (md?.transactions || []).filter(t => t.type === 'gasto').length;
    defCount += getDeferralsForMonth(year, m).length;
    if (c.totalIn > 0) { savSum += c.saving / c.totalIn; savMonths++; }
  }
  totalSav = totalIn - totalEx - totalDef;
  const avgSavPct = savMonths > 0 ? Math.round((savSum / savMonths) * 100) : 0;

  document.getElementById('ds-income').textContent      = fmtShort(totalIn);
  document.getElementById('ds-income-sub').textContent  = `${year} · Ingreso total`;
  document.getElementById('ds-expense').textContent     = fmtShort(totalEx + totalDef);
  document.getElementById('ds-expense-sub').textContent = `${txCount} transacciones`;
  document.getElementById('ds-defer').textContent       = fmtShort(totalDef);
  document.getElementById('ds-defer-sub').textContent   = `${defCount} diferidos`;
  document.getElementById('ds-saving').textContent      = fmtShort(Math.max(0, totalSav));
  document.getElementById('ds-saving-sub').textContent  = `${Math.max(0, avgSavPct)}% tasa promedio`;
  const badge = document.getElementById('ds-saving-badge');
  badge.textContent = totalSav >= 0 ? `↑ ${avgSavPct}%` : `↓ déficit`;
  badge.className   = 'stat-badge ' + (totalSav >= 0 ? 'badge-up' : 'badge-down');

  import('./charts.js').then(m => { m.renderTrendChart(); m.renderDonutDash(); m.renderSavingRateChart(); });
  import('./dashboard.js').then(m => { m.renderDashMonthCards(); m.renderSidebarMonths(); });
}
