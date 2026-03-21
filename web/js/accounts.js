import { THIS_YEAR, THIS_MONTH, MONTHS_ES, CAT_COLORS, CAT_ICONS, esc } from './config.js';
import { allMonths, allDeferrals, allAccounts, mk } from './db.js';
import { fmt, fmtShort } from './compute.js';
import { getDeferralsForMonth, getAccount, ACCT_TYPE_ICONS, ACCT_TYPE_LABELS } from './deferrals.js';
import { drawDonutColors } from './charts.js';

// ── SKELETON HELPERS ─────────────────────────────────────────────────────────
function _skelAccountCards(n) {
  return Array.from({ length: n }, () =>
    `<div class="skel-acct-card">
       <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:4px">
         <div style="display:flex;flex-direction:column;gap:8px;flex:1">
           <div class="skel" style="height:14px;width:55%"></div>
           <div class="skel" style="height:10px;width:35%"></div>
         </div>
         <div class="skel" style="height:20px;width:60px;border-radius:20px"></div>
       </div>
       <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:10px">
         <div class="skel" style="height:42px;border-radius:8px"></div>
         <div class="skel" style="height:42px;border-radius:8px"></div>
       </div>
     </div>`
  ).join('');
}

function _skelTxnRows(n) {
  const widths = ['60%','45%','70%','50%','65%'];
  return Array.from({ length: n }, (_, i) =>
    `<div class="skel-txn-row">
       <div class="skel" style="width:36px;height:36px;border-radius:10px;flex-shrink:0"></div>
       <div style="flex:1;display:flex;flex-direction:column;gap:6px">
         <div class="skel" style="height:12px;width:${widths[i % widths.length]}"></div>
         <div class="skel" style="height:10px;width:${widths[(i + 2) % widths.length]}"></div>
       </div>
       <div class="skel" style="height:14px;width:64px;flex-shrink:0"></div>
     </div>`
  ).join('');
}

// ── ACCOUNTS VIEW RENDERING ──
export function renderAccountsView() {
  renderAccountCards();
  renderAccountBreakdown();
  renderAccountHistory();
}

export function renderAccountCards() {
  const grid = document.getElementById('accountsGrid');
  grid.innerHTML = _skelAccountCards(Math.max(allAccounts.length, 3));
  requestAnimationFrame(() => {
    if (!allAccounts.length) {
      grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:40px;color:var(--text3)">
        <div style="font-size:36px;margin-bottom:10px">🏦</div>
        <div style="font-size:14px">No hay cuentas todavía</div>
        <div style="font-size:12px;margin-top:4px">Crea una cuenta para clasificar tus gastos</div>
      </div>`;
      return;
    }
    grid.innerHTML = allAccounts.map(a => {
      const md = allMonths[mk(THIS_YEAR, THIS_MONTH)];
      const monthSpend = (md?.transactions || [])
        .filter(t => t.type === 'gasto' && t.accountId === a.id)
        .reduce((s, t) => s + t.amount, 0);
      let totalSpend = 0;
      Object.values(allMonths).forEach(m => {
        (m.transactions || []).filter(t => t.type === 'gasto' && t.accountId === a.id)
          .forEach(t => { totalSpend += t.amount; });
      });
      const deferSpend = getDeferralsForMonth(THIS_YEAR, THIS_MONTH)
        .filter(({ d }) => d.accountId === a.id)
        .reduce((s, { cuotaAmt }) => s + cuotaAmt, 0);

      return `<div class="account-card" style="--ac-color:${a.color};--ac-color-dim:${a.color}18" data-account-id="${a.id}" tabindex="0" role="button" aria-label="${esc(a.name)}">
        <div class="ac-header">
          <div>
            <div class="ac-name">${esc(a.name)}</div>
            <div class="ac-bank">${esc(a.bank || '—')}</div>
          </div>
          <div class="ac-type-badge">${ACCT_TYPE_ICONS[a.type]} ${ACCT_TYPE_LABELS[a.type]}</div>
        </div>
        <div class="ac-stats">
          <div class="ac-stat">
            <div class="ac-stat-label">Este mes</div>
            <div class="ac-stat-value" style="color:${a.color}">${fmt(monthSpend + deferSpend)}</div>
          </div>
          <div class="ac-stat">
            <div class="ac-stat-label">Historial total</div>
            <div class="ac-stat-value">${fmtShort(totalSpend)}</div>
          </div>
        </div>
      </div>`;
    }).join('');
  }); // end requestAnimationFrame
}

export function renderAccountBreakdown() {
  document.getElementById('acctBreakMonthLabel').textContent = `${MONTHS_ES[THIS_MONTH]} ${THIS_YEAR}`;
  const md = allMonths[mk(THIS_YEAR, THIS_MONTH)];
  const byAccount = {};

  (md?.transactions || []).filter(t => t.type === 'gasto').forEach(t => {
    const key = t.accountId || 'sin-cuenta';
    byAccount[key] = (byAccount[key] || 0) + t.amount;
  });
  getDeferralsForMonth(THIS_YEAR, THIS_MONTH).forEach(({ d, cuotaAmt }) => {
    const key = d.accountId || 'sin-cuenta';
    byAccount[key] = (byAccount[key] || 0) + cuotaAmt;
  });

  const entries = Object.entries(byAccount).sort((a, b) => b[1] - a[1]);
  const total   = entries.reduce((s, [, v]) => s + v, 0);

  const list = document.getElementById('acctBreakList');
  if (!entries.length) { list.innerHTML = `<div class="empty-msg" style="padding:20px 0">Sin gastos este mes</div>`; return; }

  list.innerHTML = entries.map(([id, amt]) => {
    const a = id === 'sin-cuenta' ? { name:'Sin cuenta', color:'#6070a0', type:'efectivo' } : getAccount(parseInt(id));
    if (!a) return '';
    const pct = total > 0 ? Math.round(amt / total * 100) : 0;
    return `<div class="acct-break-row">
      <div class="acct-break-left">
        <div class="acct-break-dot" style="background:${a.color}"></div>
        <div>
          <div class="acct-break-name">${ACCT_TYPE_ICONS[a.type] || ''} ${esc(a.name)}</div>
          <div class="acct-break-sub">${pct}% del gasto del mes</div>
        </div>
      </div>
      <div class="acct-break-amt">${fmt(amt)}</div>
    </div>`;
  }).join('');

  const cats = entries.map(([id, v]) => {
    const a = id === 'sin-cuenta' ? { name:'Sin cuenta', color:'#6070a0' } : (getAccount(parseInt(id)) || { name:'?', color:'#6070a0' });
    return [a.name, v, a.color];
  });
  document.getElementById('acctDonutTotal').textContent = fmtShort(total);
  drawDonutColors('acctDonut', cats, total, 80, 54);

  const leg = document.getElementById('acctDonutLegend');
  leg.innerHTML = cats.map(([name, val, col]) => {
    const pct = total > 0 ? Math.round(val / total * 100) : 0;
    return `<div class="legend-row"><div class="legend-left"><div class="legend-dot" style="background:${col}"></div><span class="legend-name">${esc(name)}</span></div><div class="legend-right"><div class="legend-pct" style="color:${col}">${pct}%</div><div class="legend-amt">${fmt(val)}</div></div></div>`;
  }).join('');
}

const HIST_PAGE_SIZE = 30;
let _acctHistItems = [];
let _acctHistPage  = 0;

export function renderAccountHistory() {
  const wrap = document.getElementById('acctHistList');
  if (wrap) wrap.innerHTML = _skelTxnRows(5);

  const filterVal = document.getElementById('acctHistFilter')?.value || 'all';
  const filterId  = filterVal === 'all' ? null : parseInt(filterVal);

  _acctHistItems = [];
  Object.values(allMonths).forEach(md => {
    (md.transactions || []).filter(t => t.type === 'gasto').forEach(t => {
      if (filterId && t.accountId !== filterId) return;
      _acctHistItems.push({ ...t, year:md.year, month:md.month, kind:'gasto' });
    });
  });
  allDeferrals.forEach(d => {
    if (filterId && d.accountId !== filterId) return;
    _acctHistItems.push({ ...d, id:d.id, kind:'diferido', amount:d.amount,
      year:d.originYear, month:d.originMonth });
  });
  _acctHistItems.sort((a, b) => b.date.localeCompare(a.date));

  _acctHistPage = 0;
  requestAnimationFrame(_renderHistPage);
}

function _histItemHtml(item) {
  const col = CAT_COLORS[item.cat] || '#6070a0';
  const ico = CAT_ICONS[item.cat]  || '📦';
  const a   = item.accountId ? getAccount(item.accountId) : null;
  const ds  = new Date(item.date + 'T12:00:00').toLocaleDateString('es-MX', { day:'numeric', month:'short', year:'numeric' });
  const isD = item.kind === 'diferido';
  return `<div class="txn-row" style="cursor:default">
    <div class="txn-ico" style="background:${col}18">${ico}</div>
    <div class="txn-info">
      <div class="txn-name">${esc(item.name)}${isD ? ' <span style="font-size:10px;color:var(--yellow)">💳 diferido</span>' : ''}</div>
      <div class="txn-meta">
        <span class="txn-date">${ds}</span>
        <span class="txn-cat-badge" style="background:${col}18;color:${col}">${item.cat}</span>
        ${a ? `<span class="txn-acct-badge" style="background:${a.color}18;color:${a.color}">${ACCT_TYPE_ICONS[a.type]} ${esc(a.name)}</span>` : ''}
      </div>
    </div>
    <div class="txn-amount-col">
      <div class="txn-amount" style="color:var(--red)">${isD ? fmt(item.amount) + ' total' : fmt(item.amount)}</div>
    </div>
  </div>`;
}

function _renderHistPage() {
  const wrap = document.getElementById('acctHistList');
  if (!_acctHistItems.length) {
    wrap.innerHTML = `<div class="empty-msg" style="padding:20px">Sin transacciones</div>`;
    return;
  }

  const end       = (_acctHistPage + 1) * HIST_PAGE_SIZE;
  const visible   = _acctHistItems.slice(0, end);
  const remaining = _acctHistItems.length - end;

  wrap.innerHTML = visible.map(_histItemHtml).join('') + (remaining > 0
    ? `<button class="btn btn-ghost" id="btnLoadMoreHist"
         style="width:100%;margin-top:12px;font-size:12px">
         Cargar más · ${remaining} restante${remaining !== 1 ? 's' : ''}
       </button>`
    : _acctHistItems.length > HIST_PAGE_SIZE
      ? `<div style="text-align:center;font-size:11px;color:var(--text3);padding:10px 0">
           — ${_acctHistItems.length} transacciones en total —
         </div>`
      : '');

  document.getElementById('btnLoadMoreHist')?.addEventListener('click', _loadMoreHistory);
}

function _loadMoreHistory() {
  _acctHistPage++;
  _renderHistPage();
}
