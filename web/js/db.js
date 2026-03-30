import { THIS_YEAR, THIS_MONTH, toast, USE_API } from './config.js';
import { apiGet, apiPut, apiDelete, idbGetAll, idbPut, idbDelete, authHeaders } from './api.js';
import { invalidateComputeCache } from './compute.js';

// ── UNIFIED STORAGE — all app code calls these ────────────
export async function dbGetAll()          { return USE_API ? apiGet('/months')    : idbGetAll('months'); }
export async function dbGetAllDeferrals() { return USE_API ? apiGet('/deferrals') : idbGetAll('deferrals'); }
export async function dbGetAllAccounts()  { return USE_API ? apiGet('/accounts')  : idbGetAll('accounts'); }

export async function dbPut(rec) {
  if (USE_API) await apiPut(`/months/${rec.key}`, rec);
  else         await idbPut('months', rec);
}
export async function dbPutDeferral(rec) {
  if (USE_API) await apiPut(`/deferrals/${rec.id}`, rec);
  else         await idbPut('deferrals', rec);
}
export async function dbPutAccount(rec) {
  if (!rec || rec.id === undefined || rec.id === null) {
    console.warn('dbPutAccount: id missing, generating a new one', rec);
    rec = { ...rec, id: genId() };
  }
  if (USE_API) await apiPut(`/accounts/${rec.id}`, rec);
  else         await idbPut('accounts', rec);
}
export async function dbDeleteDeferral(id) {
  if (USE_API) await apiDelete(`/deferrals/${id}`);
  else         await idbDelete('deferrals', id);
}
export async function dbDeleteAccount(id) {
  if (USE_API) await apiDelete(`/accounts/${id}`);
  else         await idbDelete('accounts', id);
}

// ── MIGRATION & BACKUP ───────────────────────────────────
export async function migrateToBackend() {
  const [ms, ds, as] = await Promise.all([idbGetAll('months'), idbGetAll('deferrals'), idbGetAll('accounts')]);
  if (!ms.length && !ds.length && !as.length) { toast('ℹ️ No hay datos en IndexedDB para migrar'); return; }
  const r = await fetch('/api/import', { method:'POST', headers: authHeaders(), body: JSON.stringify({ months:ms, deferrals:ds, accounts:as }) });
  if (!r.ok) { toast('❌ Error al migrar'); return; }
  const { imported } = await r.json();
  toast(`✅ Migración: ${imported.months} meses · ${imported.deferrals} diferidos · ${imported.accounts} cuentas`);
  await loadAll();
  const { renderDashboard } = await import('./compute.js');
  renderDashboard();
}

export async function exportBackup() {
  let data;
  if (USE_API) {
    data = await apiGet('/export');
  } else {
    const [ms, ds, as] = await Promise.all([idbGetAll('months'), idbGetAll('deferrals'), idbGetAll('accounts')]);
    data = { exportedAt: new Date().toISOString(), months:ms, deferrals:ds, accounts:as };
  }
  const blob = new Blob([JSON.stringify(data, null, 2)], { type:'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = Object.assign(document.createElement('a'), { href:url, download:`flujo-backup-${new Date().toISOString().split('T')[0]}.json` });
  a.click(); URL.revokeObjectURL(url);
  toast('✅ Backup descargado');
}

// ════════════════════════════════════════════════════════
// STATE
// ════════════════════════════════════════════════════════
export let allMonths   = {};
export let allDeferrals = [];
export let allAccounts  = [];
export let detailYear  = THIS_YEAR, detailMonth = THIS_MONTH;
export let dashYear    = THIS_YEAR;
export let prevView    = 'dashboard';
export let curFilter   = 'todos';
export let modalType   = 'gasto', quickType = 'gasto';

// Setters for mutations from other modules (ES modules can't reassign foreign bindings)
export function setAllDeferrals(v) { allDeferrals = v; }
export function setAllAccounts(v)  { allAccounts = v; }
export function setDetailYear(v)   { detailYear = v; }
export function setDetailMonth(v)  { detailMonth = v; }
export function setDashYear_(v)    { dashYear = v; }
export function setPrevView(v)     { prevView = v; }
export function setCurFilter(v)    { curFilter = v; }
export function setModalType_(v)   { modalType = v; }
export function setQuickType_(v)   { quickType = v; }

export function mk(y, m) { return `${y}_${m}`; }
export function emptyMonth(y, m) {
  return { key:mk(y,m), year:y, month:m, income:{amount:0,desc:'',includeRollover:true}, transactions:[], rolloverApplied:0 };
}
export function getMonth(y, m) {
  const k = mk(y, m);
  if (!allMonths[k]) allMonths[k] = emptyMonth(y, m);
  return allMonths[k];
}

export async function loadAll() {
  const [recs, defs, accts] = await Promise.all([dbGetAll(), dbGetAllDeferrals(), dbGetAllAccounts()]);
  allMonths = {};
  (recs   || []).forEach(r => { allMonths[r.key] = r; });
  allDeferrals = defs   || [];
  allAccounts  = accts  || [];
  invalidateComputeCache();
}

export async function saveMonth(md) {
  allMonths[md.key] = md;
  invalidateComputeCache();
  await dbPut(md);
}
