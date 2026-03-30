import { TODAY, THIS_YEAR, THIS_MONTH, CURRENT_ROLE, applyStoredTheme, execConfirm, closeConfirm } from './config.js';
import { openDB, detectBackend, startSSE } from './api.js';
import { loadAll, setDashYear_, migrateToBackend, exportBackup } from './db.js';
import { applyRollovers, renderDashboard, showView, openDetail, goBack, navigateDetailMonth, setDashYear } from './compute.js';
import { renderTrendChart, renderDonutDash, renderSavingRateChart } from './charts.js';
import {
  renderSidebarMonths, renderMesesView, renderDetail, saveIncome,
  setFilter, setQuickType, quickAdd, syncModalDateRange,
  openAddModal, closeModal, setModalType, modalAdd, confirmDeleteTxn,
  setBudgetYear_, setBudgetMonth_,
} from './dashboard.js';
import { populateAccountSelects, openAccountModal, closeAccountModal, saveAccount, deleteAccount, initAccountModalValidation } from './deferrals.js';
import { renderAccountHistory } from './accounts.js';
import {
  renderBudgetView, openBudgetModal, closeBudgetModal, saveBudgetLimits, copyBudgetFromPrev,
  openDrawer, closeDrawer, saveEditTxn, deleteFromDrawer,
  openDeferralDrawer, saveDeferralEdit, confirmDeleteDeferral,
  toggleMacro, saveInlineLimit, shiftBudgetWindow, setBudgetMonth,
  drawerDeferralId,
} from './budget.js';
import { renderUsersView, submitCreateUser, openChangePwModal, closeChangePwModal, submitChangePw, doLogout } from './users.js';

// ── THEME ─────────────────────────────────────────────────
function toggleTheme(isLight) {
  document.documentElement.classList.toggle('light', isLight);
  document.getElementById('themeLabel').textContent = isLight ? '☀️ Claro' : '🌙 Oscuro';
  document.getElementById('themeToggle').checked = isLight;
  const mob = document.getElementById('themeToggleMobile');
  if (mob) mob.checked = isLight;
  localStorage.setItem('flujo_theme', isLight ? 'light' : 'dark');
  const cur = document.querySelector('.view.active')?.id.replace('view-','');
  if      (cur === 'dashboard')   { renderTrendChart(); renderDonutDash(); renderSavingRateChart(); }
  else if (cur === 'detail')      renderDetail();
  else if (cur === 'presupuesto') renderBudgetView();
  else if (cur === 'meses')       renderMesesView();
}

// ── EVENT DELEGATION ──────────────────────────────────────
function bindStaticHandlers() {
  // Navigation (data-view delegation)
  document.querySelectorAll('[data-view]').forEach(el => {
    el.addEventListener('click', () => showView(el.dataset.view));
  });

  // Sidebar / topbar
  document.getElementById('btnSidebarAdd')?.addEventListener('click', openAddModal);
  document.getElementById('btnChangePw')?.addEventListener('click', openChangePwModal);
  document.getElementById('btnSidebarLogout')?.addEventListener('click', doLogout);
  document.getElementById('mobileLogoutBtn')?.addEventListener('click', doLogout);
  document.getElementById('btnMobileAdd')?.addEventListener('click', openAddModal);
  document.getElementById('btnTopbarAdd')?.addEventListener('click', openAddModal);
  document.getElementById('btnAdminLogout')?.addEventListener('click', doLogout);

  // Theme toggles
  document.getElementById('themeToggle')?.addEventListener('change', e => toggleTheme(e.target.checked));
  document.getElementById('themeToggleMobile')?.addEventListener('change', e => toggleTheme(e.target.checked));

  // Dashboard
  document.getElementById('dashYearSel')?.addEventListener('change', e => setDashYear(e.target.value));
  document.getElementById('btnViewAllMonths')?.addEventListener('click', () => showView('meses'));

  // Meses view
  document.getElementById('yearFilter')?.addEventListener('change', renderMesesView);

  // Budget view
  document.getElementById('btnCopyBudget')?.addEventListener('click', copyBudgetFromPrev);
  document.getElementById('btnOpenBudgetModal')?.addEventListener('click', openBudgetModal);
  document.getElementById('budgetModalOverlay')?.addEventListener('click', e => { if (e.target === e.currentTarget) closeBudgetModal(); });
  document.getElementById('btnCloseBudgetModal')?.addEventListener('click', closeBudgetModal);
  document.getElementById('btnSaveBudgetLimits')?.addEventListener('click', saveBudgetLimits);

  // Detail view
  document.getElementById('btnGoBack')?.addEventListener('click', goBack);
  document.getElementById('btnPrevMonth')?.addEventListener('click', () => navigateDetailMonth(-1));
  document.getElementById('btnNextMonth')?.addEventListener('click', () => navigateDetailMonth(1));
  document.getElementById('btnRolloverDismiss')?.addEventListener('click', e => e.currentTarget.parentElement.classList.add('hidden'));
  document.getElementById('btnSaveIncome')?.addEventListener('click', saveIncome);

  // Filter pills (delegation)
  document.querySelector('.filter-pills')?.addEventListener('click', e => {
    const pill = e.target.closest('.filter-pill');
    if (pill) setFilter(pill.dataset.filter, pill);
  });

  // Quick type tabs (delegation)
  document.getElementById('quickTypeTabs')?.addEventListener('click', e => {
    const tab = e.target.closest('.type-tab');
    if (tab) setQuickType(tab.dataset.quickType, tab);
  });
  document.getElementById('btnQuickAdd')?.addEventListener('click', quickAdd);

  // Accounts view
  document.getElementById('btnNewAccount')?.addEventListener('click', openAccountModal);
  document.getElementById('acctHistFilter')?.addEventListener('change', renderAccountHistory);
  document.getElementById('btnMigrate')?.addEventListener('click', migrateToBackend);
  document.getElementById('btnExportBackup')?.addEventListener('click', exportBackup);

  // Users view
  document.getElementById('nu-submit')?.addEventListener('click', submitCreateUser);

  // Transaction drawer
  document.getElementById('drawerOverlay')?.addEventListener('click', closeDrawer);
  document.getElementById('btnDrawerClose')?.addEventListener('click', closeDrawer);
  document.querySelector('.btn-save-edit')?.addEventListener('click', () => {
    if (drawerDeferralId !== null) saveDeferralEdit();
    else saveEditTxn();
  });
  document.querySelector('.btn-delete-txn')?.addEventListener('click', () => {
    if (drawerDeferralId !== null) confirmDeleteDeferral(drawerDeferralId);
    else deleteFromDrawer();
  });

  // Confirm dialog
  document.getElementById('confirmOverlay')?.addEventListener('click', e => { if (e.target === e.currentTarget) closeConfirm(); });
  document.getElementById('btnConfirmCancel')?.addEventListener('click', closeConfirm);
  document.getElementById('btnConfirmExec')?.addEventListener('click', execConfirm);

  // Change password modal
  document.getElementById('changePwOverlay')?.addEventListener('click', e => { if (e.target === e.currentTarget) closeChangePwModal(); });
  document.getElementById('btnChangePwClose')?.addEventListener('click', closeChangePwModal);
  document.getElementById('btnSubmitChangePw')?.addEventListener('click', submitChangePw);

  // Add transaction modal
  document.getElementById('modalOverlay')?.addEventListener('click', e => { if (e.target === e.currentTarget) closeModal(); });
  document.getElementById('btnModalClose')?.addEventListener('click', closeModal);
  document.getElementById('modalTypeTabs')?.addEventListener('click', e => {
    const tab = e.target.closest('.type-tab');
    if (tab) setModalType(tab.dataset.modalType, tab);
  });
  document.getElementById('m-month')?.addEventListener('change', syncModalDateRange);
  document.getElementById('btnModalAdd')?.addEventListener('click', modalAdd);

  // Account modal
  document.getElementById('accountModalOverlay')?.addEventListener('click', e => { if (e.target === e.currentTarget) closeAccountModal(); });
  document.getElementById('btnAccountModalClose')?.addEventListener('click', closeAccountModal);
  document.getElementById('btnSaveAccount')?.addEventListener('click', saveAccount);
  document.getElementById('ac-delete-btn')?.addEventListener('click', deleteAccount);
  initAccountModalValidation();

  // Month cards (dashboard grid + all-months grid)
  ['dashMonthsGrid', 'allMonthsGrid'].forEach(id => {
    document.getElementById(id)?.addEventListener('click', e => {
      const card = e.target.closest('[data-y]');
      if (card) openDetail(parseInt(card.dataset.y), parseInt(card.dataset.m), card.dataset.from);
    });
  });

  // Sidebar month chips
  document.getElementById('sidebarMonths')?.addEventListener('click', e => {
    const chip = e.target.closest('[data-y]');
    if (chip) openDetail(parseInt(chip.dataset.y), parseInt(chip.dataset.m), chip.dataset.from);
  });

  // Deferred list in detail view
  document.getElementById('deferListDetail')?.addEventListener('click', e => {
    const row = e.target.closest('[data-deferral-id]');
    if (row) openDeferralDrawer(parseInt(row.dataset.deferralId));
  });

  // Transaction list (handles row click + delete buttons)
  document.getElementById('txnListWrap')?.addEventListener('click', e => {
    const delDef = e.target.closest('[data-del-deferral]');
    if (delDef) { e.stopPropagation(); confirmDeleteDeferral(parseInt(delDef.dataset.delDeferral)); return; }
    const delTxn = e.target.closest('[data-del-txn]');
    if (delTxn) { e.stopPropagation(); confirmDeleteTxn(parseInt(delTxn.dataset.delY), parseInt(delTxn.dataset.delM), parseInt(delTxn.dataset.delTxn)); return; }
    const defRow = e.target.closest('[data-deferral-id]');
    if (defRow) { openDeferralDrawer(parseInt(defRow.dataset.deferralId)); return; }
    const txnRow = e.target.closest('[data-txn-id]');
    if (txnRow) openDrawer(parseInt(txnRow.dataset.txnId), parseInt(txnRow.dataset.y), parseInt(txnRow.dataset.m));
  });

  // Budget month tabs
  document.getElementById('budgetMonthTabs')?.addEventListener('click', e => {
    const btn = e.target.closest('button');
    if (!btn) return;
    if (btn.dataset.shift !== undefined) { shiftBudgetWindow(parseInt(btn.dataset.shift)); return; }
    if (btn.dataset.budgetY !== undefined) setBudgetMonth(parseInt(btn.dataset.budgetY), parseInt(btn.dataset.budgetM));
  });

  // Macro grid (toggle expand + save inline limit)
  document.getElementById('macroGrid')?.addEventListener('click', e => {
    const saveBtn = e.target.closest('[data-save-limit]');
    if (saveBtn) { saveInlineLimit(saveBtn.dataset.saveLimit); return; }
    const header = e.target.closest('[data-macro-toggle]');
    if (header) toggleMacro(header.dataset.macroToggle);
  });

  // Account cards
  document.getElementById('accountsGrid')?.addEventListener('click', e => {
    const card = e.target.closest('[data-account-id]');
    if (card) openAccountModal(parseInt(card.dataset.accountId));
  });

  // Escape key — closes topmost open modal/drawer
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if (document.getElementById('confirmOverlay')?.classList.contains('open'))     { closeConfirm(); return; }
    if (document.getElementById('txnDrawer')?.classList.contains('open'))          { closeDrawer(); return; }
    if (document.getElementById('budgetModalOverlay')?.classList.contains('open')) { closeBudgetModal(); return; }
    if (document.getElementById('changePwOverlay')?.classList.contains('open'))    { closeChangePwModal(); return; }
    if (document.getElementById('modalOverlay')?.classList.contains('open'))       { closeModal(); return; }
    if (document.getElementById('accountModalOverlay')?.classList.contains('open')){ closeAccountModal(); return; }
  });

  // Keyboard navigation — txnListWrap
  document.getElementById('txnListWrap')?.addEventListener('keydown', e => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    if (e.target.closest('.btn-del')) return;
    const defRow = e.target.closest('[data-deferral-id]');
    if (defRow) { e.preventDefault(); openDeferralDrawer(parseInt(defRow.dataset.deferralId)); return; }
    const txnRow = e.target.closest('[data-txn-id]');
    if (txnRow) { e.preventDefault(); openDrawer(parseInt(txnRow.dataset.txnId), parseInt(txnRow.dataset.y), parseInt(txnRow.dataset.m)); }
  });

  // Keyboard navigation — deferListDetail
  document.getElementById('deferListDetail')?.addEventListener('keydown', e => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const row = e.target.closest('[data-deferral-id]');
    if (row) { e.preventDefault(); openDeferralDrawer(parseInt(row.dataset.deferralId)); }
  });

  // Keyboard navigation — month grids
  ['dashMonthsGrid', 'allMonthsGrid'].forEach(id => {
    document.getElementById(id)?.addEventListener('keydown', e => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const card = e.target.closest('[data-y]');
      if (card) { e.preventDefault(); openDetail(parseInt(card.dataset.y), parseInt(card.dataset.m), card.dataset.from); }
    });
  });

  // Keyboard navigation — sidebar months
  document.getElementById('sidebarMonths')?.addEventListener('keydown', e => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const chip = e.target.closest('[data-y]');
    if (chip) { e.preventDefault(); openDetail(parseInt(chip.dataset.y), parseInt(chip.dataset.m), chip.dataset.from); }
  });

  // Keyboard navigation — macro grid
  document.getElementById('macroGrid')?.addEventListener('keydown', e => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const header = e.target.closest('[data-macro-toggle]');
    if (header) { e.preventDefault(); toggleMacro(header.dataset.macroToggle); }
  });

  // Keyboard navigation — account cards
  document.getElementById('accountsGrid')?.addEventListener('keydown', e => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const card = e.target.closest('[data-account-id]');
    if (card) { e.preventDefault(); openAccountModal(parseInt(card.dataset.accountId)); }
  });
}

// ── INIT ──────────────────────────────────────────────────
async function init() {
  try {
    bindStaticHandlers();
    await openDB();
    await detectBackend();
    await loadAll();
    applyRollovers();
    applyStoredTheme();

    document.getElementById('q-date').value = TODAY.toISOString().split('T')[0];
    setBudgetYear_(THIS_YEAR); setBudgetMonth_(THIS_MONTH);
    setDashYear_(THIS_YEAR);

    // Show dashboard for all users (including admin), while admin keeps access to user management.
    showView('dashboard');
    renderSidebarMonths();
    populateAccountSelects();

    if (CURRENT_ROLE === 'admin') {
      const adminNav = document.getElementById('adminNav');
      if (adminNav) adminNav.style.display = 'block';
      const bnUsuarios = document.getElementById('bn-usuarios');
      if (bnUsuarios) bnUsuarios.style.display = 'flex';
    }
  } finally {
    const overlay = document.getElementById('initOverlay');
    if (overlay) overlay.style.display = 'none';
  }

  startSSE();

  window.addEventListener('resize', () => {
    const view = document.querySelector('.view.active');
    if (!view) return;
    const cur = view.id.replace('view-','');
    if (cur === 'dashboard') renderDashboard();
    else if (cur === 'detail') renderDetail();
  });
}

// ── ERROR BOUNDARY ────────────────────────────────────────
window.addEventListener('error', e => {
  console.error('Uncaught error:', e.error || e.message);
  const overlay = document.getElementById('initOverlay');
  if (overlay) overlay.style.display = 'none';
});
window.addEventListener('unhandledrejection', e => {
  console.error('Unhandled promise rejection:', e.reason);
});

// Safety net: hide the loading overlay after 12s no matter what
setTimeout(() => {
  const overlay = document.getElementById('initOverlay');
  if (overlay) overlay.style.display = 'none';
}, 12000);

init();
