// ════════════════════════════════════════════════════════
// CONSTANTS
// ════════════════════════════════════════════════════════
export const MONTHS_ES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
export const CAT_COLORS = {
  'Vivienda':'#7c6af7','Alimentación':'#ff5c7a','Transporte':'#ffc947',
  'Salud':'#3dffa0','Entretenimiento':'#ff6ec7','Educación':'#47c8ff',
  'Ropa':'#c26af7','Servicios':'#ff9547','Suscripciones':'#6af7a0',
  'Restaurantes':'#ff7a9a','Viajes':'#6af0f7','Otros':'#6070a0',
};
export const CAT_ICONS = {
  'Vivienda':'🏠','Alimentación':'🍔','Transporte':'🚗','Salud':'💊',
  'Entretenimiento':'🎬','Educación':'📚','Ropa':'👕','Servicios':'⚡',
  'Suscripciones':'📱','Restaurantes':'🍽️','Viajes':'✈️','Otros':'📦',
};
export const TODAY = new Date();
export const THIS_YEAR  = TODAY.getFullYear();
export const THIS_MONTH = TODAY.getMonth();

// ════════════════════════════════════════════════════════
// MUTABLE SESSION STATE
// ─ Exported as live bindings; mutations go through setters
//   so that importing modules always read the current value.
// ════════════════════════════════════════════════════════
export let db           = null;   // IndexedDB handle (offline fallback)
export let USE_API      = false;  // true when the backend responds
export let API_TOKEN    = '';     // current session token
export let CURRENT_USER = '';     // authenticated username
export let CURRENT_ROLE = '';     // role: 'admin' | 'user'

export function setDb(v)          { db = v; }
export function setUseApi(v)      { USE_API = v; }
export function setApiToken(v)    { API_TOKEN = v; }
export function setCurrentUser(v) { CURRENT_USER = v; }
export function setCurrentRole(v) { CURRENT_ROLE = v; }

// ── ID GENERATION ────────────────────────────────────────
export const genId = () => Date.now() * 1000 + Math.floor(Math.random() * 1000);

// ── XSS PROTECTION ───────────────────────────────────────
export function escapeHtml(s) {
  return String(s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
export const esc = escapeHtml;

// ── TOAST ─────────────────────────────────────────────────
export function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2600);
}

// ── CONFIRM DIALOG ────────────────────────────────────────
let _confirmCallback = null;

export function showConfirm(msg, onConfirm) {
  _confirmCallback = onConfirm;
  document.getElementById('confirmMsg').textContent = msg;
  document.getElementById('confirmOverlay').classList.add('open');
  _openFocusTrap(document.getElementById('confirmOverlay').querySelector('.modal'));
}

export function execConfirm() {
  const cb = _confirmCallback;
  closeConfirm();
  if (cb) cb();
}

export function closeConfirm() {
  _confirmCallback = null;
  document.getElementById('confirmOverlay').classList.remove('open');
  _closeFocusTrap();
}

// ════════════════════════════════════════════════════════
// FOCUS MANAGEMENT
// ════════════════════════════════════════════════════════
let _focusTrapActive = null;
let _focusTrapReturn = null;

export function _openFocusTrap(dialogEl) {
  const SEL = 'button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),a[href],[tabindex]:not([tabindex="-1"])';
  _closeFocusTrap();
  _focusTrapReturn = document.activeElement;
  function handler(e) {
    if (e.key !== 'Tab') return;
    const focusable = [...dialogEl.querySelectorAll(SEL)];
    if (!focusable.length) return;
    const first = focusable[0], last = focusable[focusable.length - 1];
    if (e.shiftKey) {
      if (document.activeElement === first) { e.preventDefault(); last.focus(); }
    } else {
      if (document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  }
  dialogEl.addEventListener('keydown', handler);
  _focusTrapActive = { el: dialogEl, handler };
  const first = dialogEl.querySelector(SEL);
  if (first) setTimeout(() => first.focus(), 50);
}

export function _closeFocusTrap() {
  if (_focusTrapActive) {
    _focusTrapActive.el.removeEventListener('keydown', _focusTrapActive.handler);
    _focusTrapActive = null;
  }
  if (_focusTrapReturn) {
    try { _focusTrapReturn.focus(); } catch {}
    _focusTrapReturn = null;
  }
}

// ── THEME (apply only — toggleTheme lives in app.js) ─────
export function applyStoredTheme() {
  const stored  = localStorage.getItem('flujo_theme');
  const isLight = stored === 'light';
  document.documentElement.classList.toggle('light', isLight);
  document.getElementById('themeToggle').checked = isLight;
  const mob = document.getElementById('themeToggleMobile');
  if (mob) mob.checked = isLight;
  document.getElementById('themeLabel').textContent = isLight ? '☀️ Claro' : '🌙 Oscuro';
}
