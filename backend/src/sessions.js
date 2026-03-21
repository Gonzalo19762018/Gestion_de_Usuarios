// src/sessions.js
// SQLite-backed persistent session store.
// Sessions survive server restarts; expired rows are swept on startup and hourly.
// The sessions table has an FK → users(id) ON DELETE CASCADE so all tokens
// for a deleted user are removed atomically by the DB.

import { getDb } from './db.js';

export const SESSION_TTL = 24 * 60 * 60 * 1000; // 24 h sliding window
export const MAX_SESSIONS_PER_USER = 5;

// ── Schema ─────────────────────────────────────────────────
export function initSessions() {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      token      TEXT    NOT NULL PRIMARY KEY,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_expires  ON sessions(expires_at);
  `);

  // Purge any tokens that expired while the server was down
  _purgeExpired();

  // Hourly sweep — a single DELETE is cheap in SQLite
  const timer = setInterval(_purgeExpired, 60 * 60 * 1000);
  timer.unref?.(); // don't block process exit in test environments
}

function _purgeExpired() {
  try {
    getDb().prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
  } catch {
    /* db may not be initialised during unit tests */
  }
}

// ── CRUD ───────────────────────────────────────────────────

/** Returns { user_id, expires_at } or null. Does NOT extend the TTL. */
export function sessionGet(token) {
  return (
    getDb().prepare('SELECT user_id, expires_at FROM sessions WHERE token=?').get(token) || null
  );
}

/** Slide the expiry window forward. */
export function sessionTouch(token, newExpiry) {
  getDb().prepare('UPDATE sessions SET expires_at=? WHERE token=?').run(newExpiry, token);
}

/**
 * Persist a new session.
 * Evicts the oldest session for the user when the per-user cap is reached.
 */
export function sessionCreate(token, userId, expiresAt) {
  const db = getDb();
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE user_id=?').get(userId);
  if (n >= MAX_SESSIONS_PER_USER) {
    const oldest = db
      .prepare('SELECT token FROM sessions WHERE user_id=? ORDER BY expires_at ASC LIMIT 1')
      .get(userId);
    if (oldest) db.prepare('DELETE FROM sessions WHERE token=?').run(oldest.token);
  }
  db.prepare('INSERT INTO sessions(token,user_id,expires_at) VALUES(?,?,?)').run(
    token,
    userId,
    expiresAt
  );
}

/** Remove one token (logout). */
export function sessionDelete(token) {
  getDb().prepare('DELETE FROM sessions WHERE token=?').run(token);
}

/** Remove every token for a user (account deletion / forced sign-out). */
export function sessionDeleteUser(userId) {
  getDb().prepare('DELETE FROM sessions WHERE user_id=?').run(userId);
}
