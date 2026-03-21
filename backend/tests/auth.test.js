// tests/auth.test.js
// Tests for pure crypto functions in auth.js.
// No DB required — hashPassword / verifyPassword use only node:crypto.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

// auth.js transitively imports sessions.js → db.js.
// db.js sets DB_PATH at parse time (process.env.DB_PATH must be set by test runner).
// getDb() returns undefined until initDb() is called, but hashPassword/verifyPassword
// never call getDb(), so the import is safe without an initialised DB.
import { hashPassword, verifyPassword } from '../src/auth.js';

describe('hashPassword', () => {
  test('returns a "salt:hash" string', () => {
    const h = hashPassword('Password1!');
    const parts = h.split(':');
    assert.equal(parts.length, 2, 'must contain exactly one colon');
    assert.match(parts[0], /^[0-9a-f]{32}$/, 'salt must be 32 hex chars (16 bytes)');
    assert.match(parts[1], /^[0-9a-f]+$/, 'hash must be hex');
  });

  test('two calls with the same password produce different hashes (different salts)', () => {
    const h1 = hashPassword('same_password9');
    const h2 = hashPassword('same_password9');
    assert.notEqual(h1, h2, 'salts must be unique');
  });
});

describe('verifyPassword', () => {
  test('accepts the correct password', () => {
    const stored = hashPassword('Correct!Pass3');
    assert.ok(verifyPassword('Correct!Pass3', stored));
  });

  test('rejects a wrong password', () => {
    const stored = hashPassword('Correct!Pass3');
    assert.ok(!verifyPassword('Wrong_Pass3!', stored));
  });

  test('is case-sensitive', () => {
    const stored = hashPassword('Abc123!xyz');
    assert.ok(!verifyPassword('abc123!xyz', stored));
  });
});
