import { MONTHS_ES, THIS_YEAR, CAT_COLORS, CAT_ICONS, esc, showConfirm, _openFocusTrap, _closeFocusTrap, toast } from './config.js';
const cssVar = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
import { allMonths, allDeferrals, mk, getMonth, saveMonth, detailYear, detailMonth, dbPutDeferral } from './db.js';
import { buildYearOptions, fmtShort, fmt, setupCanvas } from './compute.js';
import { getDeferralsForMonth, deferralMonthOffset, deferralCuota, deleteDeferral } from './deferrals.js';
import {
  budgetYear, budgetMonth, setBudgetYear_, setBudgetMonth_,
  MACRO_CATS, getBudget, getMacroSpending, renderDetail, deleteTxn,
} from './dashboard.js';

// ── RENDER BUDGET VIEW ──
export function renderBudgetView() {
  renderBudgetMonthTabs();
  renderBudgetContent();
}

function renderBudgetMonthTabs() {
  const tabs = document.getElementById('budgetMonthTabs');

  const years = buildYearOptions();
  const allActive = [];
  years.slice().reverse().forEach(y => {
    for (let m = 0; m < 12; m++) {
      const hasTx  = (allMonths[mk(y,m)]?.transactions||[]).length > 0;
      const hasDef = getDeferralsForMonth(y, m).length > 0;
      const hasInc = (allMonths[mk(y,m)]?.income?.amount || 0) > 0;
      if (hasTx || hasDef || hasInc || (y === THIS_YEAR)) allActive.push({y, m});
    }
  });

  let centerIdx = allActive.findIndex(x => x.y === budgetYear && x.m === budgetMonth);
  if (centerIdx < 0) { allActive.push({y: budgetYear, m: budgetMonth}); centerIdx = allActive.length - 1; }

  const windowSize = 8;
  let startIdx = Math.max(0, centerIdx - Math.floor(windowSize / 2));
  startIdx = Math.min(startIdx, Math.max(0, allActive.length - windowSize));
  const visible = allActive.slice(startIdx, startIdx + windowSize);

  const hasPrev = startIdx > 0;
  const hasNext = startIdx + windowSize < allActive.length;

  tabs.innerHTML =
    `${hasPrev ? `<button class="month-tab" data-shift="-1">‹</button>` : ''}` +
    visible.map(({y, m}) => {
      const active = y === budgetYear && m === budgetMonth;
      return `<button class="month-tab ${active ? 'active' : ''}" data-budget-y="${y}" data-budget-m="${m}">${MONTHS_ES[m].slice(0,3)} ${y}</button>`;
    }).join('') +
    `${hasNext ? `<button class="month-tab" data-shift="1">›</button>` : ''}`;

  document.getElementById('budgetMonthTitle').textContent = `Presupuesto · ${MONTHS_ES[budgetMonth]} ${budgetYear}`;
}

export function shiftBudgetWindow(dir) {
  const ord = budgetYear * 12 + budgetMonth + dir;
  setBudgetYear_(Math.floor(ord / 12));
  setBudgetMonth_(ord % 12);
  renderBudgetView();
}

export function setBudgetMonth(y, m) {
  setBudgetYear_(y); setBudgetMonth_(m);
  renderBudgetView();
}

function renderBudgetContent() {
  const y = budgetYear, m = budgetMonth;
  const spending = getMacroSpending(y, m);
  const budget   = getBudget(y, m);

  let totalPlanned=0, totalSpent=0, noLimit=0;
  MACRO_CATS.forEach(mc => {
    const lim = budget[mc.id]?.limit || 0;
    const spent = spending[mc.id]?.spent || 0;
    totalPlanned += lim;
    totalSpent   += spent;
    if (!lim) noLimit++;
  });
  const avail = totalPlanned - totalSpent;

  document.getElementById('bh-planned').textContent   = fmtShort(totalPlanned);
  document.getElementById('bh-planned-sub').textContent = `${MACRO_CATS.filter(mc=>budget[mc.id]?.limit>0).length} categorías configuradas`;
  document.getElementById('bh-spent').textContent     = fmtShort(totalSpent);
  document.getElementById('bh-spent-sub').textContent = totalPlanned>0?`${Math.round(totalSpent/totalPlanned*100)}% del presupuesto`:'Sin límites';
  document.getElementById('bh-avail').textContent     = fmtShort(Math.max(0, avail));
  document.getElementById('bh-avail-sub').textContent = avail<0?`⚠️ Excedido en ${fmt(Math.abs(avail))}`:'Queda por gastar';
  document.getElementById('bh-nolimit').textContent   = noLimit;

  renderBudgetAlerts(spending, budget);
  renderBudgetCompareChart(spending, budget);
  renderBudgetProgressChart(spending, budget);
  renderMacroCards(spending, budget);
}

function renderBudgetAlerts(spending, budget) {
  const alerts = [];
  MACRO_CATS.forEach(mc => {
    const lim   = budget[mc.id]?.limit || 0;
    const spent = spending[mc.id]?.spent || 0;
    if (!lim) return;
    const pct = spent / lim * 100;
    if (pct >= 100) alerts.push({ macro:mc, spent, lim, pct, type:'over' });
    else if (pct >= 80) alerts.push({ macro:mc, spent, lim, pct, type:'warning' });
  });

  const el = document.getElementById('budgetAlerts');
  if (!alerts.length) { el.innerHTML=''; return; }
  el.innerHTML = `<div class="alert-list">
    ${alerts.map(a=>`
    <div class="alert-item ${a.type}">
      <div class="alert-ico">${a.type==='over'?'🚨':'⚠️'}</div>
      <div class="alert-text">
        <strong>${a.macro.icon} ${a.macro.name}</strong>
        ${a.type==='over'
          ? ` — Excediste el límite en <strong>${fmt(a.spent-a.lim)}</strong>`
          : ` — Llevas el <strong>${Math.round(a.pct)}%</strong> del límite (${fmt(a.spent)} de ${fmt(a.lim)})`}
      </div>
      <div class="alert-pct">${Math.round(a.pct)}%</div>
    </div>`).join('')}
  </div>`;
}

function renderBudgetCompareChart(spending, budget) {
  const canvas = document.getElementById('budgetCompareChart');
  const W = canvas.parentElement.clientWidth - 48;
  const ctx = setupCanvas(canvas, W, 220);

  const macros = MACRO_CATS.filter(mc => budget[mc.id]?.limit>0 || spending[mc.id]?.spent>0);
  if (!macros.length) {
    ctx.fillStyle=cssVar('--text3'); ctx.font='13px Cabinet Grotesk';
    ctx.textAlign='center'; ctx.fillText('Configura límites para ver la comparativa',W/2,110); return;
  }

  const maxVal = Math.max(...macros.map(mc=>Math.max(budget[mc.id]?.limit||0, spending[mc.id]?.spent||0)), 1);
  const pad = {top:16,right:16,bottom:48,left:52};
  const cW = W-pad.left-pad.right, cH = 220-pad.top-pad.bottom;
  const grpW = cW / macros.length;
  const bW = Math.min(24, (grpW-12)/2);

  ctx.strokeStyle=cssVar('--border'); ctx.lineWidth=1;
  for(let i=0;i<=4;i++){
    const yp = pad.top + cH*(1-i/4);
    ctx.beginPath(); ctx.moveTo(pad.left,yp); ctx.lineTo(pad.left+cW,yp); ctx.stroke();
    ctx.fillStyle=cssVar('--text3'); ctx.font='10px DM Mono'; ctx.textAlign='right';
    ctx.fillText(fmtShort(maxVal*i/4), pad.left-6, yp+4);
  }

  macros.forEach((mc,i)=>{
    const cx = pad.left + i*grpW + grpW/2;
    const planned = budget[mc.id]?.limit||0;
    const spent   = spending[mc.id]?.spent||0;

    if (planned>0) {
      const bH = (planned/maxVal)*cH;
      const bX = cx - bW - 3;
      ctx.fillStyle = mc.color+'30';
      ctx.strokeStyle = mc.color+'80'; ctx.lineWidth=1;
      ctx.beginPath(); ctx.roundRect(bX, pad.top+cH-bH, bW, bH, 3); ctx.fill(); ctx.stroke();
    }

    if (spent>0) {
      const bH = (spent/maxVal)*cH;
      const bX = cx + 3;
      const isOver = planned>0 && spent>planned;
      const col = isOver ? '#ff5c7a' : mc.color;
      const grad = ctx.createLinearGradient(0,pad.top+cH-bH,0,pad.top+cH);
      grad.addColorStop(0,col+'cc'); grad.addColorStop(1,col+'33');
      ctx.fillStyle = grad;
      ctx.beginPath(); ctx.roundRect(bX, pad.top+cH-bH, bW, bH, 3); ctx.fill();
    }

    ctx.fillStyle = mc.color; ctx.font='13px Cabinet Grotesk'; ctx.textAlign='center';
    ctx.fillText(mc.icon, cx, 220-pad.bottom+16);
    ctx.fillStyle=cssVar('--text3'); ctx.font='9px Cabinet Grotesk';
    ctx.fillText(mc.name.split(' ')[0], cx, 220-pad.bottom+28);
  });

  ctx.font='10px Cabinet Grotesk'; ctx.textAlign='left';
  [['#6070a030','#6070a080','Planificado'],['#6c63ffcc','','Gastado']].forEach(([fill,stroke,label],i)=>{
    const lx = pad.left + i*110;
    ctx.fillStyle=fill; ctx.strokeStyle=stroke; ctx.lineWidth=1;
    ctx.fillRect(lx,220-6,14,8); if(stroke){ctx.strokeRect(lx,220-6,14,8);}
    ctx.fillStyle=cssVar('--text2'); ctx.fillText(label,lx+18,220-0);
  });
}

function renderBudgetProgressChart(spending, budget) {
  const canvas = document.getElementById('budgetRadarChart');
  const W = canvas.parentElement.clientWidth - 48;
  const ctx = setupCanvas(canvas, W, 220);

  const macros = MACRO_CATS.filter(mc => budget[mc.id]?.limit>0);
  if (!macros.length) {
    ctx.fillStyle=cssVar('--text3'); ctx.font='13px Cabinet Grotesk';
    ctx.textAlign='center'; ctx.fillText('Define límites para ver la ejecución',W/2,110); return;
  }

  const pad={top:16,right:16,bottom:36,left:52};
  const cW=W-pad.left-pad.right, cH=220-pad.top-pad.bottom;
  const bH = Math.min(22, (cH/macros.length)-6);

  macros.forEach((mc,i)=>{
    const lim   = budget[mc.id]?.limit||0;
    const spent = spending[mc.id]?.spent||0;
    const pct   = lim>0 ? Math.min(120, spent/lim*100) : 0;
    const yp = pad.top + i*(cH/macros.length);

    ctx.fillStyle=cssVar('--text2'); ctx.font=`12px Cabinet Grotesk`; ctx.textAlign='right';
    ctx.fillText(mc.icon+' '+mc.name.split(' ')[0], pad.left-6, yp+bH/2+4);

    ctx.fillStyle=cssVar('--surface3');
    ctx.beginPath(); ctx.roundRect(pad.left, yp, cW, bH, 4); ctx.fill();

    const fillW = (Math.min(pct,100)/100)*cW;
    const col = pct>=100?'#ff5c7a':pct>=80?'#ffc947':mc.color;
    const grad = ctx.createLinearGradient(pad.left,0,pad.left+fillW,0);
    grad.addColorStop(0,col+'99'); grad.addColorStop(1,col);
    ctx.fillStyle=grad;
    ctx.beginPath(); ctx.roundRect(pad.left, yp, fillW, bH, 4); ctx.fill();

    ctx.fillStyle=pct>50?cssVar('--text'):cssVar('--text2');
    ctx.font='10px DM Mono'; ctx.textAlign='left';
    ctx.fillText(`${Math.round(pct)}%`, pad.left+fillW+4, yp+bH/2+4);

    ctx.fillStyle=cssVar('--text3'); ctx.textAlign='right'; ctx.font='10px DM Mono';
    ctx.fillText(`${fmtShort(spent)}/${fmtShort(lim)}`, W-8, yp+bH/2+4);
  });
}

function renderMacroCards(spending, budget) {
  const grid = document.getElementById('macroGrid');
  grid.innerHTML = MACRO_CATS.map(mc => {
    const lim   = budget[mc.id]?.limit || 0;
    const spent = spending[mc.id]?.spent || 0;
    const pct   = lim>0 ? Math.min(120, spent/lim*100) : 0;
    const avail = lim - spent;
    const isOver    = lim>0 && spent>lim;
    const isWarning = lim>0 && pct>=80 && !isOver;
    const statusTxt = !lim ? 'Sin límite' : isOver ? 'Excedido' : isWarning ? 'Cuidado' : 'OK';
    const statusCls = !lim ? 'status-none' : isOver ? 'status-over' : isWarning ? 'status-warning' : 'status-ok';
    const barColor  = isOver?'#ff5c7a':isWarning?'#ffc947':mc.color;
    const barW      = lim>0 ? Math.min(100,pct) : 0;

    const subcatHTML = mc.cats.map(cat=>{
      const catSpent = spending[mc.id]?.subCats?.[cat]||0;
      const catPct   = spent>0 ? Math.min(100,catSpent/spent*100) : 0;
      return `<div class="subcat-row">
        <div class="subcat-dot" style="background:${CAT_COLORS[cat]||'#6070a0'}"></div>
        <div class="subcat-name">${CAT_ICONS[cat]||''} ${cat}</div>
        <div class="subcat-bar-track"><div class="subcat-bar-fill" style="width:${catPct}%;background:${CAT_COLORS[cat]||mc.color}88"></div></div>
        <div class="subcat-val">${fmt(catSpent)}</div>
      </div>`;
    }).join('');

    return `<div class="macro-card">
      <button class="macro-header" data-macro-toggle="${mc.id}" aria-expanded="false" aria-controls="macrobody-${mc.id}">
        <div class="macro-header-left">
          <div class="macro-icon">${mc.icon}</div>
          <div>
            <div class="macro-name">${mc.name}</div>
            <div class="macro-cats-label">${mc.cats.join(' · ')}</div>
          </div>
        </div>
        <div class="macro-header-right">
          <div class="macro-stat">
            <div class="macro-stat-label">Gastado</div>
            <div class="macro-stat-val" style="color:${barColor}">${fmt(spent)}</div>
          </div>
          <div class="macro-stat">
            <div class="macro-stat-label">Límite</div>
            <div class="macro-stat-val" style="color:${lim?'var(--text)':'var(--text3)'}">${lim?fmt(lim):'—'}</div>
          </div>
          <div class="macro-stat">
            <div class="macro-stat-label">Disponible</div>
            <div class="macro-stat-val" style="color:${avail>=0&&lim?'var(--green)':'var(--red)'}">${lim?(avail>=0?fmt(avail):'−'+fmt(Math.abs(avail))):'—'}</div>
          </div>
          <span class="status-pill ${statusCls}">${statusTxt}</span>
          <span class="macro-chevron" id="chevron-${mc.id}" aria-hidden="true">▼</span>
        </div>
      </button>
      <div class="macro-bar-row">
        <div class="macro-bar-track">
          <div class="macro-bar-fill" style="width:${barW}%;background:${barColor}${lim?'':'44'}"></div>
          ${lim?`<div class="macro-bar-limit" style="left:100%"></div>`:''}
        </div>
        <div class="macro-bar-labels">
          <span class="spent" style="color:${barColor}">${spent>0?fmt(spent):''}</span>
          <span class="limit">${lim?'Límite: '+fmt(lim):spent>0?'Sin límite definido':''}</span>
        </div>
      </div>
      <div class="macro-body" id="macrobody-${mc.id}">
        <div class="macro-subcats">${subcatHTML}</div>
        <div class="budget-limit-row">
          <div class="budget-limit-label">🎯 Límite mensual para <strong>${mc.name}</strong></div>
          <div class="budget-limit-field">
            <input type="number" id="inline-limit-${mc.id}" value="${lim||''}" placeholder="0.00" min="0" step="0.01">
            <button class="btn-save-limit" data-save-limit="${mc.id}">Guardar</button>
          </div>
        </div>
      </div>
    </div>`;
  }).join('');
}

export function toggleMacro(id) {
  const body   = document.getElementById('macrobody-'+id);
  const chev   = document.getElementById('chevron-'+id);
  const header = document.querySelector(`[data-macro-toggle="${id}"]`);
  const open   = body.classList.toggle('open');
  chev.classList.toggle('open', open);
  if (header) header.setAttribute('aria-expanded', String(open));
}

export async function saveInlineLimit(macroId) {
  const val = parseFloat(document.getElementById('inline-limit-'+macroId).value)||0;
  const y=budgetYear, m=budgetMonth;
  const md = getMonth(y,m);
  if (!md.budgets) md.budgets = {};
  if (!md.budgets[macroId]) md.budgets[macroId]={};
  md.budgets[macroId].limit = val;
  try {
    await saveMonth(md);
    renderBudgetContent();
    toast(`✅ Límite guardado para ${MACRO_CATS.find(mc=>mc.id===macroId)?.name}`);
  } catch (err) {
    console.error('saveInlineLimit error:', err);
    toast('❌ Error al guardar límite, intenta de nuevo');
  }
}

// ── BUDGET CONFIG MODAL ──
export function openBudgetModal() {
  const y=budgetYear, m=budgetMonth;
  const budget = getBudget(y, m);
  const spending = getMacroSpending(y, m);
  const el = document.getElementById('budgetConfigList');
  el.innerHTML = `
    <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--text3);padding:0 0 8px;border-bottom:1px solid var(--border);margin-bottom:12px">
      <span>CATEGORÍA MACRO</span>
      <div style="display:grid;grid-template-columns:120px 80px 80px;gap:20px;text-align:right">
        <span>LÍMITE MENSUAL</span><span>GASTADO</span><span>%</span>
      </div>
    </div>
    ${MACRO_CATS.map(mc=>{
      const lim   = budget[mc.id]?.limit||'';
      const spent = spending[mc.id]?.spent||0;
      const pct   = lim&&lim>0 ? Math.round(spent/lim*100) : '—';
      return `<div style="display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--border)">
        <div style="display:flex;align-items:center;gap:10px;flex:1">
          <span style="font-size:18px">${mc.icon}</span>
          <div>
            <div style="font-size:14px;font-weight:600">${mc.name}</div>
            <div style="font-size:11px;color:var(--text3)">${mc.cats.join(', ')}</div>
          </div>
        </div>
        <div style="display:grid;grid-template-columns:120px 80px 80px;gap:20px;align-items:center;text-align:right">
          <input type="number" class="budget-modal-input" data-macro="${mc.id}" value="${lim}" placeholder="Sin límite" min="0" step="0.01"
            style="width:110px;padding:7px 10px;background:var(--surface3);border:1px solid var(--border);border-radius:8px;color:var(--text);font-family:'DM Mono',monospace;font-size:13px;outline:none;text-align:right">
          <span style="font-family:'DM Mono',monospace;font-size:13px;color:var(--red)">${fmt(spent)}</span>
          <span style="font-family:'DM Mono',monospace;font-size:13px;color:${pct==='—'?'var(--text3)':pct>=100?'var(--red)':pct>=80?'var(--yellow)':'var(--green)'}">${pct==='—'?'—':pct+'%'}</span>
        </div>
      </div>`;
    }).join('')}`;
  document.getElementById('budgetModalOverlay').classList.add('open');
  _openFocusTrap(document.getElementById('budgetModalOverlay').querySelector('.modal'));
}

export function closeBudgetModal() {
  document.getElementById('budgetModalOverlay').classList.remove('open');
  _closeFocusTrap();
}

export async function saveBudgetLimits() {
  const y=budgetYear, m=budgetMonth;
  const md = getMonth(y,m);
  if (!md.budgets) md.budgets = {};
  document.querySelectorAll('.budget-modal-input').forEach(inp=>{
    const macroId = inp.dataset.macro;
    const val = parseFloat(inp.value)||0;
    if (!md.budgets[macroId]) md.budgets[macroId]={};
    md.budgets[macroId].limit = val;
  });
  try {
    await saveMonth(md);
    closeBudgetModal();
    renderBudgetContent();
    toast('✅ Límites guardados correctamente');
  } catch (err) {
    console.error('saveBudgetLimits error:', err);
    toast('❌ Error al guardar límites, intenta de nuevo');
  }
}

export async function copyBudgetFromPrev() {
  let pm=budgetMonth-1, py=budgetYear;
  if(pm<0){pm=11;py--;}
  const prevBudget = getBudget(py,pm);
  if (!Object.keys(prevBudget).length) { toast('⚠️ El mes anterior no tiene límites'); return; }
  const md = getMonth(budgetYear,budgetMonth);
  md.budgets = JSON.parse(JSON.stringify(prevBudget));
  try {
    await saveMonth(md);
    renderBudgetContent();
    toast(`✅ Límites copiados de ${MONTHS_ES[pm]} ${py}`);
  } catch (err) {
    console.error('copyBudgetFromPrev error:', err);
    toast('❌ Error al copiar límites, intenta de nuevo');
  }
}

// ════════════════════════════════════════════════════════
// TRANSACTION DETAIL DRAWER
// ════════════════════════════════════════════════════════
let drawerTxnId=null, drawerTxnYear=null, drawerTxnMonth=null;
export let drawerDeferralId = null;

export function openDrawer(txnId,y,m) {
  const md=getMonth(y,m);
  const t=(md.transactions||[]).find(x=>x.id===txnId);
  if(!t) return;
  drawerTxnId=txnId; drawerTxnYear=y; drawerTxnMonth=m;

  const col=CAT_COLORS[t.cat]||'#6070a0';
  const ico=CAT_ICONS[t.cat]||'📦';
  const isCard=t.type==='tarjeta';
  const ds=new Date(t.date+'T12:00:00').toLocaleDateString('es-MX',{weekday:'long',day:'numeric',month:'long',year:'numeric'});
  const dsShort=new Date(t.date+'T12:00:00').toLocaleDateString('es-MX',{day:'numeric',month:'short',year:'numeric'});

  const icoEl=document.getElementById('drawerIco');
  icoEl.textContent=ico; icoEl.style.background=col+'22';
  document.getElementById('drawerName').textContent=t.name;
  document.getElementById('drawerDate').textContent=dsShort;
  const cp=document.getElementById('drawerCatPill');
  cp.textContent=t.cat; cp.style.background=col+'22'; cp.style.color=col;
  const tp=document.getElementById('drawerTypePill');
  if(isCard){tp.textContent='💳 Diferido';tp.style.background='rgba(255,201,71,.15)';tp.style.color='var(--yellow)';}
  else{tp.textContent='💸 Gasto directo';tp.style.background='rgba(255,92,122,.12)';tp.style.color='var(--red)';}

  const dispAmt=isCard?t.cuotaPago:t.amount;
  document.getElementById('drawerAmtLabel').textContent=isCard?'Cuota mensual':'Monto del gasto';
  const av=document.getElementById('drawerAmtVal');
  av.textContent=fmt(dispAmt); av.style.color=isCard?'var(--yellow)':'var(--red)';
  document.getElementById('drawerAmtSub').textContent=isCard
    ?`${t.cuotas} cuota${t.cuotas>1?'s':''} · Total: ${fmt(t.amount)}`
    :`Registrado el ${dsShort}`;
  const ab=document.getElementById('drawerAmtBadge');
  ab.textContent=isCard?`${t.cuotas}x cuotas`:'Único';
  ab.style.background=isCard?'rgba(255,201,71,.15)':'rgba(255,92,122,.12)';
  ab.style.color=isCard?'var(--yellow)':'var(--red)';

  document.getElementById('drawerInfoDate').textContent=ds;
  document.getElementById('drawerInfoType').textContent=isCard?'💳 Tarjeta / Diferido':'💸 Gasto directo';
  document.getElementById('drawerInfoCat').innerHTML=`${ico} ${esc(t.cat)}`;
  document.getElementById('drawerInfoTotal').textContent=fmt(t.amount);
  document.getElementById('drawerInfoCuotaCell').style.display=isCard?'':'none';
  document.getElementById('drawerInfoPlazoCell').style.display=isCard?'':'none';
  if(isCard){
    document.getElementById('drawerInfoCuota').textContent=fmt(t.cuotaPago)+'/mes';
    document.getElementById('drawerInfoPlazo').textContent=`${t.cuotas} mes${t.cuotas>1?'es':''}`;
  }

  const macro=MACRO_CATS.find(mc=>mc.cats.includes(t.cat));
  if(macro){
    document.getElementById('drawerMacroIcon').textContent=macro.icon;
    document.getElementById('drawerMacroName').textContent=macro.name;
    document.getElementById('drawerMacroGroup').textContent='Agrupa: '+macro.cats.join(', ');
    const bud=getBudget(y,m);
    const lim=bud[macro.id]?.limit||0;
    const sp=getMacroSpending(y,m);
    const ms=sp[macro.id]?.spent||0;
    const ml=document.getElementById('drawerMacroLimit');
    if(lim){const pct=Math.round(ms/lim*100);const c2=pct>=100?'var(--red)':pct>=80?'var(--yellow)':'var(--green)';ml.innerHTML=`Límite: <span style="color:${c2};font-weight:700">${fmt(ms)}</span> / ${fmt(lim)} <span style="color:${c2}">(${pct}%)</span>`;}
    else{ml.innerHTML=`<span style="color:var(--text3)">Sin límite configurado</span>`;}
    document.getElementById('drawerInfoMacroCell').style.display='';
  } else { document.getElementById('drawerInfoMacroCell').style.display='none'; }

  const cs=document.getElementById('drawerCuotasSection');
  if(isCard){
    cs.style.display='';
    document.getElementById('dcvPaidLabel').textContent='1 pagada';
    document.getElementById('dcvTotalLabel').textContent=`de ${t.cuotas} cuota${t.cuotas>1?'s':''}`;
    document.getElementById('dcvDots').innerHTML=Array.from({length:t.cuotas},(_,i)=>
      `<div class="dcv-dot ${i===0?'paid':'pending'}" title="Cuota ${i+1}: ${fmt(t.cuotaPago)}"></div>`
    ).join('');
  } else { cs.style.display='none'; }

  renderDrawerBudgetImpact(t,y,m,macro);

  document.getElementById('edit-name').value=t.name;
  document.getElementById('edit-amount').value=t.amount;
  document.getElementById('edit-cat').value=t.cat;
  document.getElementById('edit-date').value=t.date;
  const editAcctSel = document.getElementById('edit-account');
  if (editAcctSel && t.accountId) editAcctSel.value = t.accountId;

  document.getElementById('drawerOverlay').classList.add('open');
  document.getElementById('txnDrawer').classList.add('open');
  document.body.style.overflow='hidden';
  _openFocusTrap(document.getElementById('txnDrawer'));
  drawerDeferralId = null;
}

function renderDrawerBudgetImpact(t,y,m,macro) {
  const el=document.getElementById('drawerBudgetImpact');
  if(!macro){el.innerHTML=`<div style="font-size:13px;color:var(--text3);padding:10px">Categoría sin macro asignada.</div>`;return;}
  const bud=getBudget(y,m);
  const sp=getMacroSpending(y,m);
  const lim=bud[macro.id]?.limit||0;
  const macroSpent=sp[macro.id]?.spent||0;
  const txnAmt=t.type==='tarjeta'?t.cuotaPago:t.amount;
  const spentBefore=macroSpent-txnAmt;
  const pctBefore=lim>0?Math.round(spentBefore/lim*100):null;
  const pctAfter=lim>0?Math.round(macroSpent/lim*100):null;

  if(!lim){
    el.innerHTML=`<div style="background:var(--surface2);border-radius:10px;padding:14px;font-size:13px;color:var(--text3)">
      ℹ️ Sin límite en <strong style="color:var(--text)">${macro.name}</strong>. Configúralo en Presupuestos para ver el impacto.
    </div>`;return;
  }

  const contribution=lim>0?Math.round(txnAmt/lim*100):0;
  const sc=pctAfter>=100?'var(--red)':pctAfter>=80?'var(--yellow)':'var(--green)';

  el.innerHTML=`<div style="background:var(--surface2);border-radius:12px;padding:16px;display:flex;flex-direction:column;gap:12px">
    <div style="display:flex;justify-content:space-between;align-items:center">
      <span style="font-size:13px;color:var(--text3)">Este gasto representa</span>
      <span style="font-family:'DM Mono',monospace;font-size:18px;font-weight:700;color:${sc}">${contribution}%</span>
    </div>
    <div style="font-size:12px;color:var(--text3)">del límite de ${macro.icon} ${macro.name} (${fmt(lim)})</div>
    <div style="height:8px;background:var(--surface3);border-radius:4px;overflow:hidden">
      <div style="height:100%;width:${Math.min(100,pctBefore||0)}%;background:${macro.color}55;border-radius:4px"></div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;text-align:center">
      <div style="background:var(--surface3);border-radius:8px;padding:10px">
        <div style="font-size:10px;color:var(--text3);margin-bottom:4px">Sin este gasto</div>
        <div style="font-family:'DM Mono',monospace;font-size:13px">${fmt(spentBefore)}</div>
        <div style="font-size:10px;color:var(--text3)">${pctBefore!==null?pctBefore+'%':'—'}</div>
      </div>
      <div style="background:var(--surface3);border-radius:8px;padding:10px;border:1px solid ${sc}44">
        <div style="font-size:10px;color:var(--text3);margin-bottom:4px">Este gasto</div>
        <div style="font-family:'DM Mono',monospace;font-size:13px;color:${sc}">+${fmt(txnAmt)}</div>
        <div style="font-size:10px;color:var(--text3)">+${contribution}%</div>
      </div>
      <div style="background:var(--surface3);border-radius:8px;padding:10px">
        <div style="font-size:10px;color:var(--text3);margin-bottom:4px">Total macro</div>
        <div style="font-family:'DM Mono',monospace;font-size:13px;color:${sc}">${fmt(macroSpent)}</div>
        <div style="font-size:10px;color:${sc}">${pctAfter!==null?pctAfter+'%':'—'}</div>
      </div>
    </div>
    ${pctAfter>=100?`<div style="background:var(--red-dim);border:1px solid rgba(255,92,122,.25);border-radius:8px;padding:10px;font-size:12px;color:var(--red)">🚨 Categoría excedida en <strong>${fmt(macroSpent-lim)}</strong></div>`:
      pctAfter>=80?`<div style="background:var(--yellow-dim);border:1px solid rgba(255,201,71,.25);border-radius:8px;padding:10px;font-size:12px;color:var(--yellow)">⚠️ Llevas el ${pctAfter}% del presupuesto de esta macro</div>`:''}
  </div>`;
}

export function closeDrawer(){
  document.getElementById('drawerOverlay').classList.remove('open');
  document.getElementById('txnDrawer').classList.remove('open');
  document.body.style.overflow='';
  drawerTxnId=null;
  _closeFocusTrap();
}

export async function saveEditTxn(){
  if(drawerTxnId===null) return;
  const md=getMonth(drawerTxnYear,drawerTxnMonth);
  const idx=md.transactions.findIndex(t=>t.id===drawerTxnId);
  if(idx<0) return;
  const t=md.transactions[idx];
  const nn = document.getElementById('edit-name').value.trim();
  const na = parseFloat(document.getElementById('edit-amount').value)||0;
  const nc = document.getElementById('edit-cat').value;
  const nd = document.getElementById('edit-date').value;
  const nAcct = parseInt(document.getElementById('edit-account').value)||null;
  if(!nn||!na){toast('⚠️ Completa nombre y monto');return;}
  t.name=nn; t.amount=na; t.cat=nc; t.date=nd; t.accountId=nAcct;
  if(t.type==='tarjeta') t.cuotaPago=na/t.cuotas;
  await saveMonth(md);
  closeDrawer(); renderDetail();
  toast('✅ Transacción actualizada');
}

export function deleteFromDrawer(){
  if(drawerTxnId===null) return;
  const md = getMonth(drawerTxnYear, drawerTxnMonth);
  const txn = (md?.transactions||[]).find(t => t.id === drawerTxnId);
  const name = txn ? txn.name : 'este gasto';
  showConfirm(`¿Eliminar "${esc(name)}"?`, async () => {
    await deleteTxn(drawerTxnYear, drawerTxnMonth, drawerTxnId);
    closeDrawer();
  });
}

// ════════════════════════════════════════════════════════
// DEFERRAL DRAWER (moved from app.js)
// ════════════════════════════════════════════════════════
export function openDeferralDrawer(deferralId) {
  const d = allDeferrals.find(x => x.id === deferralId);
  if (!d) return;
  drawerDeferralId = deferralId;
  drawerTxnId = null;

  const col = CAT_COLORS[d.cat] || '#6070a0';
  const ico = CAT_ICONS[d.cat]  || '📦';
  const base = Math.floor(d.amount * 100 / d.cuotas) / 100;
  const last = Math.round((d.amount - base * (d.cuotas - 1)) * 100) / 100;
  const endOrdinal = d.originYear * 12 + d.originMonth + d.cuotas - 1;
  const endY = Math.floor(endOrdinal / 12);
  const endM = endOrdinal % 12;

  const icoEl = document.getElementById('drawerIco');
  icoEl.textContent = ico; icoEl.style.background = col+'22';
  document.getElementById('drawerName').textContent = d.name;
  document.getElementById('drawerDate').textContent = `${MONTHS_ES[d.originMonth]} ${d.originYear} – ${MONTHS_ES[endM]} ${endY}`;
  const cp = document.getElementById('drawerCatPill');
  cp.textContent = d.cat; cp.style.background = col+'22'; cp.style.color = col;
  const tp = document.getElementById('drawerTypePill');
  tp.textContent = `💳 Diferido ${d.cuotas} meses`;
  tp.style.background = 'rgba(255,201,71,.15)'; tp.style.color = 'var(--yellow)';

  document.getElementById('drawerAmtLabel').textContent = 'Monto total del diferido';
  const av = document.getElementById('drawerAmtVal');
  av.textContent = fmt(d.amount); av.style.color = 'var(--yellow)';
  document.getElementById('drawerAmtSub').textContent = `${d.cuotas} cuotas · Base ${fmt(base)}/mes · Última ${fmt(last)}`;
  const ab = document.getElementById('drawerAmtBadge');
  ab.textContent = `${d.cuotas}x cuotas`;
  ab.style.background = 'rgba(255,201,71,.15)'; ab.style.color = 'var(--yellow)';

  const dsOrig = new Date(d.date+'T12:00:00').toLocaleDateString('es-MX',{weekday:'long',day:'numeric',month:'long',year:'numeric'});
  document.getElementById('drawerInfoDate').textContent  = dsOrig;
  document.getElementById('drawerInfoType').textContent  = '💳 Diferido / Tarjeta';
  document.getElementById('drawerInfoCat').innerHTML     = `${ico} ${esc(d.cat)}`;
  document.getElementById('drawerInfoTotal').textContent = fmt(d.amount);
  document.getElementById('drawerInfoCuotaCell').style.display = '';
  document.getElementById('drawerInfoPlazoCell').style.display = '';
  document.getElementById('drawerInfoCuota').textContent = `${fmt(base)}/mes (última ${fmt(last)})`;
  document.getElementById('drawerInfoPlazo').textContent = `${d.cuotas} meses · hasta ${MONTHS_ES[endM]} ${endY}`;

  const macro = MACRO_CATS.find(mc => mc.cats.includes(d.cat));
  if (macro) {
    document.getElementById('drawerMacroIcon').textContent = macro.icon;
    document.getElementById('drawerMacroName').textContent = macro.name;
    document.getElementById('drawerMacroGroup').textContent = 'Agrupa: '+macro.cats.join(', ');
    document.getElementById('drawerMacroLimit').innerHTML = `<span style="color:var(--text3)">Ver presupuesto para detalle por mes</span>`;
    document.getElementById('drawerInfoMacroCell').style.display = '';
  } else { document.getElementById('drawerInfoMacroCell').style.display = 'none'; }

  document.getElementById('drawerCuotasSection').style.display = '';
  const curOffset = deferralMonthOffset(d, detailYear, detailMonth);
  document.getElementById('dcvPaidLabel').textContent  = curOffset >= 0 ? `Cuota ${curOffset+1} este mes` : 'No activo este mes';
  document.getElementById('dcvTotalLabel').textContent = `de ${d.cuotas} cuotas totales`;

  const dotsEl = document.getElementById('dcvDots');
  dotsEl.innerHTML = Array.from({length: d.cuotas}, (_, i) => {
    const oy    = Math.floor((d.originYear*12 + d.originMonth + i) / 12);
    const om    = (d.originMonth + i) % 12;
    const cuAmt = deferralCuota(d, i);
    const isNow = i === curOffset;
    const isPast= i < curOffset;
    const isLast= i === d.cuotas - 1;
    const color = isLast ? 'var(--green)' : isNow ? '#fff' : isPast ? 'var(--yellow)' : 'var(--surface3)';
    const border= isNow ? '2px solid var(--yellow)' : isLast ? '2px solid var(--green)' : '1px solid var(--border2)';
    return `<div class="dcv-dot" style="background:${color};border:${border};width:14px;height:14px;border-radius:4px;cursor:default"
      title="Cuota ${i+1} · ${MONTHS_ES[om].slice(0,3)} ${oy} · ${fmt(cuAmt)}${isLast?' (última)':''}"></div>`;
  }).join('');

  if (curOffset >= 0) {
    const fakeT = { type:'tarjeta', cat:d.cat, cuotaPago:deferralCuota(d, curOffset) };
    renderDrawerBudgetImpact(fakeT, detailYear, detailMonth, macro);
  } else {
    document.getElementById('drawerBudgetImpact').innerHTML =
      `<div style="font-size:13px;color:var(--text3);padding:10px">Este diferido no está activo en el mes actual.</div>`;
  }

  document.getElementById('edit-name').value   = d.name;
  document.getElementById('edit-amount').value = d.amount;
  document.getElementById('edit-cat').value    = d.cat;
  document.getElementById('edit-date').value   = d.date;

  document.getElementById('drawerOverlay').classList.add('open');
  document.getElementById('txnDrawer').classList.add('open');
  document.body.style.overflow = 'hidden';
  _openFocusTrap(document.getElementById('txnDrawer'));
}

export async function saveDeferralEdit() {
  if (!drawerDeferralId) return;
  const d = allDeferrals.find(x => x.id === drawerDeferralId);
  if (!d) return;
  const nn = document.getElementById('edit-name').value.trim();
  const na = parseFloat(document.getElementById('edit-amount').value)||0;
  const nc = document.getElementById('edit-cat').value;
  const nd = document.getElementById('edit-date').value;
  if(!nn||!na){ toast('⚠️ Completa nombre y monto'); return; }
  d.name = nn; d.amount = na; d.cat = nc; d.date = nd;
  await dbPutDeferral(d);
  closeDrawer(); renderDetail();
  toast('✅ Diferido actualizado en todos los meses');
}

export function confirmDeleteDeferral(id) {
  const d = allDeferrals.find(x => x.id === id);
  if (!d) return;
  showConfirm(
    `¿Eliminar "${esc(d.name)}"? Se eliminará de todos los meses. Esta acción no se puede deshacer.`,
    async () => {
      await deleteDeferral(id);
      closeDrawer();
      renderDetail();
      toast('🗑️ Diferido eliminado de todos los meses');
    }
  );
}
