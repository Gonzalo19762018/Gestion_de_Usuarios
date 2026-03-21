// tests/sessions.test.js
// Tests for the SQLite-backed session store.
// Requires DB_PATH=:memory: in the environment (set by "npm test").
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { initDb, getDb } from '../src/db.js';
import {
  initSessions,
  SESSION_TTL,
  sessionCreate,
  sessionGet,
  sessionTouch,
  sessionDelete,
  sessionDeleteUser,
} from '../src/sessions.js';

// ── One-time setup: initialise in-memory DB ───────────────────────────────────
let aliceId, bobId;

before(() => {
  initDb();
  initSessions();
  // Insert test users (FK constraint: sessions.user_id → users.id)
  getDb()
    .prepare("INSERT OR IGNORE INTO users(username,password,role) VALUES(?,?,?)")
    .run('alice', 'salt:hash', 'user');
  getDb()
    .prepare("INSERT OR IGNORE INTO users(username,password,role) VALUES(?,?,?)")
    .run('bob', 'salt:hash', 'user');
  aliceId = getDb().prepare("SELECT id FROM users WHERE username='alice'").get().id;
  bobId   = getDb().prepare("SELECT id FROM users WHERE username='bob'").get().id;
});

after(() => {
  // Clean slate so test ordering doesn't matter
  getDb().prepare('DELETE FROM sessions').run();
});

// ── Helpers ───────────────────────────────────────────────────────────────────
let _tokCounter = 0;
function freshToken() { return `tok_${++_tokCounter}_${Date.now()}`; }

// ── Tests ─────────────────────────────────────────────────────────────────────
describe('sessionCreate / sessionGet', () => {
  test('created session is retrievable', () => {
    const tok = freshToken();
    const exp = Date.now() + SESSION_TTL;
    sessionCreate(tok, aliceId, exp);
    const row = sessionGet(tok);
    assert.ok(row, 'session should exist');
    assert.equal(row.user_id, aliceId);
    assert.ok(row.expires_at >= exp - 5, 'expires_at should be near the requested value');
  });

  test('non-existent token returns null', () => {
    assert.equal(sessionGet('does_not_exist'), null);
  });
});

describe('sessionTouch', () => {
  test('updates expires_at', () => {
    const tok = freshToken();
    const exp1 = Date.now() + 1000;
    sessionCreate(tok, aliceId, exp1);
    const exp2 = Date.now() + SESSION_TTL;
    sessionTouch(tok, exp2);
    const row = sessionGet(tok);
    assert.ok(row.expires_at >= exp2 - 5, 'expires_at should be updated');
  });
});

describe('sessionDelete', () => {
  test('removes the token', () => {
    const tok = freshToken();
    sessionCreate(tok, aliceId, Date.now() + SESSION_TTL);
    sessionDelete(tok);
    assert.equal(sessionGet(tok), null);
  });
});

describe('sessionDeleteUser', () => {
  test('removes all tokens for that user and leaves others intact', () => {
    const t1 = freshToken();
    const t2 = freshToken();
    const t3 = freshToken();
    sessionCreate(t1, aliceId, Date.now() + SESSION_TTL);
    sessionCreate(t2, aliceId, Date.now() + SESSION_TTL);
    sessionCreate(t3, bobId,   Date.now() + SESSION_TTL);

    sessionDeleteUser(aliceId);

    assert.equal(sessionGet(t1), null, 'alice token 1 should be gone');
    assert.equal(sessionGet(t2), null, 'alice token 2 should be gone');
    assert.ok(sessionGet(t3),         'bob token should still exist');
  });
});

describe('per-user session cap (MAX_SESSIONS_PER_USER = 5)', () => {
  test('6th session evicts the oldest', () => {
    // Clear alice's sessions first
    sessionDeleteUser(aliceId);

    const tokens = [];
    for (let i = 0; i < 5; i++) {
      const tok = freshToken();
      tokens.push(tok);
      // Space out expires_at so "oldest" is deterministic
      sessionCreate(tok, aliceId, Date.now() + (i + 1) * 1000);
    }
    // All 5 should exist
    tokens.forEach(tok => assert.ok(sessionGet(tok), `token ${tok} should exist`));

    // Add a 6th — must evict the one with the lowest expires_at (tokens[0])
    const tok6 = freshToken();
    sessionCreate(tok6, aliceId, Date.now() + SESSION_TTL);

    assert.equal(sessionGet(tokens[0]), null, 'oldest token should have been evicted');
    assert.ok(sessionGet(tok6), '6th token should exist');
  });
});
