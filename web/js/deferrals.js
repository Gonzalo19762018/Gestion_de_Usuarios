import { CAT_COLORS, CAT_ICONS, esc, genId, showConfirm, _openFocusTrap, _closeFocusTrap, toast } from './config.js';
import { allDeferrals, allAccounts, setAllDeferrals, setAllAccounts, dbPutDeferral, dbDeleteDeferral, dbPutAccount, dbDeleteAccount } from './db.js';

// ── DEFERRAL MODEL ──
// A deferral record:
// { id, name, amount, cat, date, cuotas, originYear, originMonth }
// cuotaBase  = floor(amount / cuotas)           ← regular monthly payment
// cuotaLast  = amount - cuotaBase*(cuotas-1)    ← last month (absorbs rounding)
// Active in months: origin, origin+1, ... origin+cuotas-1

export function deferralCuota(d, cuotaIdx) {
  const base = Math.floor(d.amount * 100 / d.cuotas) / 100;
  const last = Math.round((d.amount - base * (d.cuotas - 1)) * 100) / 100;
  return cuotaIdx === d.cuotas - 1 ? last : base;
}

export function deferralMonthOffset(d, y, m) {
  const originTotal = d.originYear * 12 + d.originMonth;
  const targetTotal = y * 12 + m;
  const offset = targetTotal - originTotal;
  if (offset < 0 || offset >= d.cuotas) return -1;
  return offset;
}

export function getDeferralsForMonth(y, m) {
  return allDeferrals
    .map(d => {
      const idx = deferralMonthOffset(d, y, m);
      if (idx < 0) return null;
      return { d, cuotaIdx: idx, cuotaAmt: deferralCuota(d, idx) };
    })
    .filter(Boolean);
}

export async function saveDeferral(d) {
  setAllDeferrals(allDeferrals.filter(x => x.id !== d.id).concat(d));
  await dbPutDeferral(d);
}

export async function deleteDeferral(id) {
  setAllDeferrals(allDeferrals.filter(x => x.id !== id));
  await dbDeleteDeferral(id);
}

// ════════════════════════════════════════════════════════
// ACCOUNTS
// ════════════════════════════════════════════════════════
export const ACCT_TYPE_LABELS = { debito:'Débito', credito:'Crédito', efectivo:'Efectivo', ahorro:'Ahorro' };
export const ACCT_TYPE_ICONS  = { debito:'💳', credito:'💎', efectivo:'💵', ahorro:'🏦' };

function isAccountFormValid() {
  const name = document.getElementById('ac-name')?.value.trim();
  return Boolean(name);
}

export function updateSaveAccountButton() {
  const btn = document.getElementById('btnSaveAccount');
  if (!btn) return;
  btn.disabled = !isAccountFormValid();
}

export async function saveAccount(rec) {
  if (!rec) {
    const name  = document.getElementById('ac-name').value.trim();
    const type  = document.getElementById('ac-type').value;
    const color = document.getElementById('ac-color').value;
    const bank  = document.getElementById('ac-bank').value.trim();
    const editId= document.getElementById('ac-edit-id').value;
    if (!name) { toast('⚠️ Escribe un nombre'); return; }
    rec = { id: editId ? parseInt(editId) : genId(), name, type, color, bank };
  }
  setAllAccounts(allAccounts.filter(a => a.id !== rec.id).concat(rec));
  await dbPutAccount(rec);
  closeAccountModal();
  populateAccountSelects();
  const { renderAccountsView } = await import('./accounts.js');
  renderAccountsView();
  toast(`✅ Cuenta "${rec.name}" guardada`);
}

export function deleteAccount() {
  const id = parseInt(document.getElementById('ac-edit-id').value);
  if (!id) return;
  const acct = allAccounts.find(a => a.id === id);
  const name = acct ? acct.name : 'esta cuenta';
  showConfirm(`¿Eliminar cuenta "${esc(name)}"?`, async () => {
    setAllAccounts(allAccounts.filter(a => a.id !== id));
    await dbDeleteAccount(id);
    closeAccountModal();
    populateAccountSelects();
    const { renderAccountsView } = await import('./accounts.js');
    renderAccountsView();
    toast('🗑️ Cuenta eliminada');
  });
}

export function getAccount(id) { return allAccounts.find(a => a.id === id); }

export function accountBadgeHtml(accountId) {
  const a = getAccount(accountId);
  if (!a) return '';
  return `<span class="txn-acct-badge" style="background:${a.color}18;color:${a.color}">${ACCT_TYPE_ICONS[a.type]} ${esc(a.name)}</span>`;
}

export function populateAccountSelects() {
  const opts = allAccounts.length
    ? allAccounts.map(a => `<option value="${a.id}">${ACCT_TYPE_ICONS[a.type]} ${esc(a.name)}</option>`).join('')
    : '<option value="">Sin cuentas — agregar en Cuentas</option>';
  ['q-account','m-account','edit-account'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = opts;
  });
  const hf = document.getElementById('acctHistFilter');
  if (hf) {
    hf.innerHTML = '<option value="all">Todas las cuentas</option>' +
      allAccounts.map(a => `<option value="${a.id}">${ACCT_TYPE_ICONS[a.type]} ${esc(a.name)}</option>`).join('');
  }
}

export function openAccountModal(id) {
  const overlay = document.getElementById('accountModalOverlay');
  const delBtn  = document.getElementById('ac-delete-btn');
  document.getElementById('ac-edit-id').value = '';
  document.getElementById('ac-name').value    = '';
  document.getElementById('ac-bank').value    = '';
  document.getElementById('ac-type').value    = 'debito';
  document.getElementById('ac-color').value   = '#6c63ff';
  document.getElementById('accountModalTitle').textContent = 'Nueva cuenta';
  delBtn.style.display = 'none';
  if (id) {
    const a = getAccount(id);
    if (a) {
      document.getElementById('ac-edit-id').value = a.id;
      document.getElementById('ac-name').value    = a.name;
      document.getElementById('ac-bank').value    = a.bank || '';
      document.getElementById('ac-type').value    = a.type;
      document.getElementById('ac-color').value   = a.color;
      document.getElementById('accountModalTitle').textContent = 'Editar cuenta';
      delBtn.style.display = 'block';
    }
  }
  updateSaveAccountButton();
  overlay.classList.add('open');
  _openFocusTrap(overlay.querySelector('.modal'));
}

// Safety: ensure the button is enabled when name is present.
// This is also useful if there is a race condition with initial binding.
export function initAccountModalValidation() {
  const nameInput = document.getElementById('ac-name');
  const typeInput = document.getElementById('ac-type');
  const colorInput = document.getElementById('ac-color');
  const bankInput = document.getElementById('ac-bank');

  [nameInput, typeInput, colorInput, bankInput].forEach(el => {
    if (el) el.addEventListener('input', updateSaveAccountButton);
  });
}


export function closeAccountModal() {
  document.getElementById('accountModalOverlay').classList.remove('open');
  _closeFocusTrap();
}
