import { esc, showConfirm, _openFocusTrap, _closeFocusTrap, toast, CURRENT_USER, CURRENT_ROLE, API_TOKEN } from './config.js';
import { apiReq, apiPost, apiDelete } from './api.js';

let _usersListDelegated = false;
function _initUsersDelegation() {
  if (_usersListDelegated) return;
  const list = document.getElementById('usersList');
  if (!list) return;
  list.addEventListener('click', e => {
    const btn = e.target.closest('[data-delete-user]');
    if (btn) confirmDeleteUser(btn.dataset.deleteUser);
  });
  _usersListDelegated = true;
}

export async function renderUsersView() {
  const list = document.getElementById('usersList');
  if (!list) return;
  _initUsersDelegation();

  if (CURRENT_ROLE !== 'admin') {
    list.innerHTML = '<div style="color:var(--red);font-size:13px">Sin permiso de administrador.</div>';
    return;
  }

  list.innerHTML = '<div style="color:var(--text3);font-size:13px">Cargando…</div>';

  try {
    const timeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Timeout al conectar con el servidor')), 10_000));
    const users = await Promise.race([apiReq('GET', '/admin/users'), timeout]);

    if (!users) {
      list.innerHTML = '<div style="color:var(--red);font-size:13px">Sesión expirada — cierra sesión y vuelve a entrar.</div>';
      return;
    }

    if (users.length === 0) {
      list.innerHTML = '<div style="color:var(--text3);font-size:13px">No hay usuarios.</div>';
      return;
    }

    list.innerHTML = users.map(u => `
      <div style="display:flex;align-items:center;gap:12px;padding:12px 14px;background:var(--surface2);border-radius:12px;margin-bottom:8px">
        <div style="width:36px;height:36px;border-radius:10px;background:${u.role === 'admin' ? 'rgba(108,99,247,.2)' : 'var(--surface3)'};display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0">
          ${u.role === 'admin' ? '👑' : '👤'}
        </div>
        <div style="flex:1;min-width:0">
          <div style="font-size:14px;font-weight:700">${esc(u.username)}${u.username === CURRENT_USER ? ' <span style="font-size:10px;color:var(--accent);background:rgba(108,99,247,.15);padding:2px 6px;border-radius:6px;font-weight:600">tú</span>' : ''}</div>
          <div style="font-size:11px;color:var(--text3);font-family:'DM Mono',monospace">${u.role} · desde ${new Date(u.created_at).toLocaleDateString('es')}</div>
        </div>
        ${u.username !== CURRENT_USER
          ? `<button class="btn btn-ghost" style="font-size:11px;padding:6px 10px;color:var(--red);border-color:rgba(255,92,122,.4);flex-shrink:0"
               data-delete-user="${esc(u.username)}">🗑 Eliminar</button>`
          : ''}
      </div>
    `).join('');
  } catch (e) {
    list.innerHTML = `<div style="color:var(--red);font-size:13px">⚠️ ${esc(e.message)}</div>`;
  }
}

export function confirmDeleteUser(username) {
  showConfirm(
    `¿Eliminar usuario "${username}"? Se eliminarán todos sus datos (meses, diferidos, cuentas). Esta acción no se puede deshacer.`,
    async () => {
      try {
        await apiDelete(`/admin/users/${encodeURIComponent(username)}`);
        toast(`🗑️ Usuario ${username} eliminado`);
        renderUsersView();
      } catch {
        toast('⚠️ Error al eliminar usuario');
      }
    }
  );
}

export async function submitCreateUser() {
  const username = document.getElementById('nu-username').value.trim();
  const password = document.getElementById('nu-password').value;
  const err      = document.getElementById('nu-error');
  err.textContent = '';

  if (!username || !password) { err.textContent = 'Completa todos los campos'; return; }
  if (username.length < 2)    { err.textContent = 'El usuario debe tener mínimo 2 caracteres'; return; }
  if (password.length < 8)    { err.textContent = 'La contraseña debe tener mínimo 8 caracteres'; return; }

  const btn = document.getElementById('nu-submit');
  btn.disabled    = true;
  btn.textContent = 'Creando…';

  try {
    await apiPost('/admin/users', { username, password });
    document.getElementById('nu-username').value = '';
    document.getElementById('nu-password').value = '';
    toast(`✅ Usuario ${username} creado`);
    renderUsersView();
  } catch (e) {
    err.textContent = e.message.includes('409') ? 'El nombre de usuario ya existe' : 'Error al crear usuario';
  } finally {
    btn.disabled    = false;
    btn.textContent = '+ Crear usuario';
  }
}

export function openChangePwModal() {
  document.getElementById('cpCurrent').value = '';
  document.getElementById('cpNew').value = '';
  document.getElementById('cpConfirm').value = '';
  document.getElementById('cpError').style.display = 'none';
  document.getElementById('changePwOverlay').classList.add('open');
  _openFocusTrap(document.getElementById('changePwOverlay').querySelector('.modal'));
}

export function closeChangePwModal() {
  document.getElementById('changePwOverlay').classList.remove('open');
  _closeFocusTrap();
}

export async function submitChangePw() {
  const current  = document.getElementById('cpCurrent').value;
  const newPw    = document.getElementById('cpNew').value;
  const confirm  = document.getElementById('cpConfirm').value;
  const errEl    = document.getElementById('cpError');
  errEl.style.display = 'none';

  if (!current || !newPw || !confirm) { errEl.textContent = 'Completa todos los campos'; errEl.style.display = 'block'; return; }
  if (newPw !== confirm)              { errEl.textContent = 'Las contraseñas no coinciden'; errEl.style.display = 'block'; return; }
  if (newPw.length < 8)              { errEl.textContent = 'Mínimo 8 caracteres'; errEl.style.display = 'block'; return; }

  try {
    const res = await apiReq('POST', '/user/password', { currentPassword: current, newPassword: newPw });
    if (!res) { errEl.textContent = 'Sesión expirada'; errEl.style.display = 'block'; return; }
    closeChangePwModal();
    toast('✅ Contraseña actualizada');
  } catch (e) {
    errEl.textContent = e.message || 'Error al cambiar contraseña';
    errEl.style.display = 'block';
  }
}

export async function doLogout() {
  try {
    await fetch('/api/auth/logout', {
      method:  'POST',
      headers: { 'X-Flujo-Token': API_TOKEN },
    });
  } catch {}
  sessionStorage.removeItem('flujo_token');
  location.reload();
}
