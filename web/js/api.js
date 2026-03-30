import {
  db, USE_API, API_TOKEN,
  setDb, setUseApi, setApiToken, setCurrentUser, setCurrentRole,
} from './config.js';

// ── AUTH ──────────────────────────────────────────────────
export function authHeaders() {
  return API_TOKEN
    ? { 'Content-Type': 'application/json', 'X-Flujo-Token': API_TOKEN }
    : { 'Content-Type': 'application/json' };
}

export async function doLogin(username, password) {
  try {
    const r = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return null;
    const { token } = await r.json();
    return token || null;
  } catch { return null; }
}

export function showLoginScreen() {
  return new Promise(resolve => {
    document.getElementById('loginOverlay').style.display = 'flex';
    const userInput = document.getElementById('loginUser');
    const passInput = document.getElementById('loginPass');
    const err       = document.getElementById('loginError');
    userInput.value = '';
    passInput.value = '';
    err.textContent = '';
    userInput.focus();

    const tryLogin = async () => {
      const username = userInput.value.trim();
      const password = passInput.value;
      if (!username || !password) {
        err.textContent = 'Ingresa usuario y contraseña';
        return;
      }
      err.textContent = '';
      const btn = document.getElementById('loginSubmit');
      btn.disabled = true;
      btn.textContent = 'Verificando…';

      const token = await doLogin(username, password);

      btn.disabled = false;
      btn.textContent = 'Entrar →';

      if (token) {
        setApiToken(token);
        sessionStorage.setItem('flujo_token', token);
        document.getElementById('loginOverlay').style.display = 'none';
        resolve(token);
      } else {
        err.textContent = 'Credenciales incorrectas, intenta de nuevo';
        passInput.value = '';
        passInput.focus();
      }
    };

    document.getElementById('loginSubmit').onclick = tryLogin;
    passInput.onkeydown = e => { if (e.key === 'Enter') tryLogin(); };
    userInput.onkeydown = e => { if (e.key === 'Enter') passInput.focus(); };
  });
}

export async function doSetup(setupToken, username, password) {
  try {
    const r = await fetch('/api/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ setupToken, username, password }),
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) return null;
    const { token } = await r.json();
    return token || null;
  } catch { return null; }
}

export function showSetupScreen() {
  return new Promise(resolve => {
    document.getElementById('setupOverlay').style.display = 'flex';
    const tokenInput = document.getElementById('setupToken');
    const userInput  = document.getElementById('setupUser');
    const passInput  = document.getElementById('setupPass');
    const err        = document.getElementById('setupError');
    err.textContent  = '';
    tokenInput.focus();

    const trySetup = async () => {
      const setupToken = tokenInput.value.trim();
      const username   = userInput.value.trim();
      const password   = passInput.value;
      if (!setupToken || !username || !password) {
        err.textContent = 'Completa todos los campos';
        return;
      }
      err.textContent = '';
      const btn = document.getElementById('setupSubmit');
      btn.disabled = true;
      btn.textContent = 'Creando cuenta…';

      const token = await doSetup(setupToken, username, password);

      btn.disabled = false;
      btn.textContent = 'Crear cuenta →';

      if (token) {
        setApiToken(token);
        sessionStorage.setItem('flujo_token', token);
        document.getElementById('setupOverlay').style.display = 'none';
        resolve(token);
      } else {
        err.textContent = 'Token incorrecto o expirado';
        tokenInput.value = '';
        tokenInput.focus();
      }
    };

    document.getElementById('setupSubmit').onclick = trySetup;
    passInput.onkeydown  = e => { if (e.key === 'Enter') trySetup(); };
    userInput.onkeydown  = e => { if (e.key === 'Enter') passInput.focus(); };
    tokenInput.onkeydown = e => { if (e.key === 'Enter') userInput.focus(); };
  });
}

export async function detectBackend() {
  try {
    const r = await fetch('/api/health?_=' + Date.now(), {
      signal: AbortSignal.timeout(6000)
    });
    document.title = 'Flujo — Dashboard Financiero';
    if (r.ok) {
      const data = await r.json();
      if (data.setupRequired) {
        await showSetupScreen();
        await fetchCurrentUser();
      } else if (data.loginRequired) {
        const saved = sessionStorage.getItem('flujo_token');
        if (saved) {
          setApiToken(saved);
          await fetchCurrentUser();
          if (!_currentUserResolved()) {
            sessionStorage.removeItem('flujo_token');
            setApiToken('');
            await showLoginScreen();
            await fetchCurrentUser();
          }
        } else {
          await showLoginScreen();
          await fetchCurrentUser();
        }
      }
      setUseApi(true);
    } else {
      setUseApi(false);
    }
  } catch {
    setUseApi(false);
  }

  const pill = document.getElementById('dbPill');
  if (pill) {
    if (USE_API) {
      pill.innerHTML = '<div class="db-dot" style="background:var(--green)"></div>SQLite · Sync';
      pill.style.color = 'var(--green)';
    } else {
      pill.innerHTML = '<div class="db-dot"></div>IndexedDB · Offline';
      pill.style.color = '';
    }
  }
}

// Helper: check if fetchCurrentUser succeeded (CURRENT_USER was set)
function _currentUserResolved() {
  // import CURRENT_USER as live binding — check it via module import
  return !!API_TOKEN && _lastFetchedUser !== '';
}
let _lastFetchedUser = '';

// ── SSE — real-time sync ──────────────────────────────────

export function startSSE() {
  if (!USE_API) return;
  if (window._sseSource) return;

  const es = new EventSource('/api/events');
  window._sseSource = es;
  let firstConnect = true;

  es.addEventListener('connected', async () => {
    if (firstConnect) { firstConnect = false; return; }
    try {
      const { loadAll } = await import('./db.js');
      const { applyRollovers } = await import('./compute.js');
      await loadAll(); applyRollovers(); _sseRerender();
    } catch {}
  });

  es.addEventListener('sync', async () => {
    try {
      const { loadAll } = await import('./db.js');
      const { applyRollovers } = await import('./compute.js');
      await loadAll(); applyRollovers(); _sseRerender(); showSyncBadge();
    } catch {}
  });

  es.onerror = () => {
    if (es.readyState === EventSource.CLOSED) {
      window._sseSource = null;
      setTimeout(startSSE, 15_000);
    }
  };
}

async function _sseRerender() {
  const cur = document.querySelector('.view.active')?.id.replace('view-', '');
  if (!cur) return;
  const { renderDashboard } = await import('./compute.js');
  const { renderDetail, renderMesesView } = await import('./dashboard.js');
  const { renderBudgetView } = await import('./budget.js');
  const { renderAccountsView } = await import('./accounts.js');
  const { renderUsersView } = await import('./users.js');
  if      (cur === 'dashboard')   renderDashboard();
  else if (cur === 'detail')      renderDetail();
  else if (cur === 'meses')       renderMesesView();
  else if (cur === 'presupuesto') renderBudgetView();
  else if (cur === 'cuentas')     renderAccountsView();
  else if (cur === 'usuarios')    renderUsersView();
}

export function showSyncBadge() {
  const badge = document.getElementById('syncBadge');
  if (!badge) return;
  badge.style.opacity = '1';
  clearTimeout(badge._t);
  badge._t = setTimeout(() => { badge.style.opacity = '0'; }, 2500);
}

// ── API HELPERS ──────────────────────────────────────────
export async function apiReq(method, path, body) {
  const opts = { method, headers: authHeaders(), signal: AbortSignal.timeout(15000) };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const r = await fetch(`/api${path}`, opts);
  if (!r.ok) {
    if (r.status === 401) {
      sessionStorage.removeItem('flujo_token');
      setUseApi(false);
      return null;
    }
    throw new Error(`API ${method} ${path} → ${r.status}`);
  }
  return r.json();
}
export const apiGet    = (path)       => apiReq('GET',    path);
export const apiPut    = (path, body) => apiReq('PUT',    path, body);
export const apiPost   = (path, body) => apiReq('POST',   path, body);
export const apiDelete = (path)       => apiReq('DELETE', path);

// ── CURRENT USER ─────────────────────────────────────────
export async function fetchCurrentUser() {
  try {
    const data = await apiReq('GET', '/me');
    if (!data) return;
    setCurrentUser(data.username);
    setCurrentRole(data.role);
    _lastFetchedUser = data.username;
    const el = document.getElementById('sidebarUser');
    const nm = document.getElementById('suName');
    const rl = document.getElementById('suRole');
    const av = document.getElementById('suAvatar');
    if (el) el.style.display = 'flex';
    if (nm) nm.textContent = data.username;
    if (rl) rl.textContent = data.role === 'admin' ? '👑 Admin' : '👤 Usuario';
    if (av) av.textContent = data.role === 'admin' ? '👑' : '👤';
    const mob = document.getElementById('mobileLogoutBtn');
    if (mob) mob.style.display = 'flex';
    if (data.role === 'admin') {
      const adminNav = document.getElementById('adminNav');
      if (adminNav) adminNav.style.display = 'block';
      const bnUsuarios = document.getElementById('bn-usuarios');
      if (bnUsuarios) bnUsuarios.style.display = 'flex';
      // Admin keeps full access to financial functionality too;
      // just expose the admin menu without hiding the dashboard controls.
      ['financialNav', 'quickAccessNav', 'monthNavBtn', 'bottomNav'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = '';
      });
    }
  } catch {}
}

// ── INDEXEDDB (offline fallback) ─────────────────────────
export function openDB() {
  return new Promise((res, rej) => {
    const req = indexedDB.open('flujo_db_v5', 1);
    req.onupgradeneeded = e => {
      const d = e.target.result;
      ['months','deferrals','accounts'].forEach(s => {
        if (!d.objectStoreNames.contains(s))
          d.createObjectStore(s, { keyPath: s === 'months' ? 'key' : 'id' });
      });
    };
    req.onsuccess = e => { setDb(e.target.result); res(); };
    req.onerror   = e => rej(e.target.error);
  });
}
export const idbOp = (store, mode, fn) => new Promise((res, rej) => {
  const r = fn(db.transaction(store, mode).objectStore(store));
  r.onsuccess = e => res(e.target.result ?? null);
  r.onerror   = e => rej(e.target.error);
});
export const idbGet    = (store, key) => idbOp(store, 'readonly',  os => os.get(key));
export const idbPut    = (store, rec) => idbOp(store, 'readwrite', os => os.put(rec));
export const idbDelete = (store, key) => idbOp(store, 'readwrite', os => os.delete(key));
export const idbGetAll = store        => idbOp(store, 'readonly',  os => os.getAll()).then(r => r || []);
