// src/auth.js
// DB-backed multi-user auth with scrypt password hashing.
// Session persistence is delegated to sessions.js (SQLite-backed).
//
// First-run flow:
//   1. No users in DB → generate a one-time SETUP_TOKEN printed to the console.
//   2. Admin visits the app → sees the Setup screen → enters setup token + new credentials.
//   3. POST /api/setup creates the admin user and invalidates the setup token.
//   4. Normal login from that point on.

import { scryptSync, randomBytes, timingSafeEqual } from 'crypto';
import { users } from './db.js';
import {
  initSessions, SESSION_TTL,
  sessionGet, sessionTouch, sessionCreate, sessionDelete, sessionDeleteUser,
} from './sessions.js';

// ── Setup token (one-time, in-memory) ─────────────────────
let setupToken = null;

/** Call once after initDb(). Initialises the session store and prints the
 *  setup token if no users exist yet. */
export function initAuth() {
  initSessions(); // creates sessions table, purges expired rows
  if (users.count() === 0) {
    setupToken = randomBytes(24).toString('hex'); // 48 hex chars
    console.log('');
    console.log('╔══════════════════════════════════════════════════╗');
    console.log('║          FLUJO — PRIMERA CONFIGURACIÓN           ║');
    console.log('║                                                  ║');
    console.log(`║  Token de setup: ${setupToken}  ║`);
    console.log('║                                                  ║');
    console.log('║  Abre la app y usa este token para crear         ║');
    console.log('║  el usuario administrador.                       ║');
    console.log('╚══════════════════════════════════════════════════╝');
    console.log('');
  }
}

export const needsSetup = () => setupToken !== null;

// ── Password hashing (scrypt, no external deps) ───────────
const SCRYPT_PARAMS = { N: 32768, r: 8, p: 1, maxmem: 67108864 }; // 64 MB
const KEY_LEN = 64;

export function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, KEY_LEN, SCRYPT_PARAMS).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password, stored) {
  const [salt, storedHash] = stored.split(':');
  const storedBuf = Buffer.from(storedHash, 'hex');
  const attempt   = scryptSync(password, salt, KEY_LEN, SCRYPT_PARAMS);
  return storedBuf.length === attempt.length && timingSafeEqual(storedBuf, attempt);
}

// ── Public API ─────────────────────────────────────────────

/**
 * Create the initial admin user.
 * Returns the session token on success, null if the setup token is wrong
 * or setup has already been completed.
 */
export function setup(token, username, password) {
  if (!setupToken) return null;
  try {
    const a = Buffer.from(setupToken, 'utf8');
    const b = Buffer.alloc(a.length);
    Buffer.from(token ?? '', 'utf8').copy(b);
    if (!timingSafeEqual(a, b)) return null;
  } catch { return null; }
  if (!username || !password) return null;

  const hash    = hashPassword(password);
  const newUser = users.create(username.trim(), hash, 'admin');
  setupToken = null; // invalidate — setup can only happen once per run

  return _createSession(newUser.id);
}

/** Verify credentials. Returns a session token, or null on failure. */
export function login(username, password) {
  const row = users.getByUsername(username);
  if (!row) return null;
  if (!verifyPassword(password, row.password)) return null;
  return _createSession(row.id);
}

/** Returns the user_id (integer) if the token is valid (and slides the TTL), else null. */
export function validateToken(token) {
  if (!token) return null;
  const row = sessionGet(token);
  if (!row) return null;
  if (row.expires_at < Date.now()) { sessionDelete(token); return null; }
  sessionTouch(token, Date.now() + SESSION_TTL); // sliding window
  return row.user_id;
}

/** Invalidate a token (logout). */
export function logout(token) {
  sessionDelete(token);
}

/** Invalidate all sessions for a given user (called on account deletion). */
export function revokeUserSessions(userId) {
  sessionDeleteUser(userId);
}

function _createSession(userId) {
  const token = randomBytes(32).toString('hex');
  sessionCreate(token, userId, Date.now() + SESSION_TTL);
  return token;
}
