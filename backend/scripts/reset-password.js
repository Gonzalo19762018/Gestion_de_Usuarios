#!/usr/bin/env node
// One-time utility: reset a user's password directly in the SQLite DB.
// Usage (inside the container or on the host with node):
//   node scripts/reset-password.js <username> <new-password>
//
// Example:
//   docker compose exec api node scripts/reset-password.js admin MiNuevaPass1!

import { scryptSync, randomBytes } from 'crypto';
import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH   = process.env.DB_PATH || path.join(__dirname, '../data/flujo.db');

const [,, username, password] = process.argv;

if (!username || !password) {
  console.error('Usage: node scripts/reset-password.js <username> <new-password>');
  process.exit(1);
}

if (password.length < 8) {
  console.error('Error: password must be at least 8 characters');
  process.exit(1);
}

// Same params as auth.js
const SCRYPT_PARAMS = { N: 32768, r: 8, p: 1, maxmem: 67108864 }; // 64 MB
const KEY_LEN = 64;

function hashPassword(pw) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(pw, salt, KEY_LEN, SCRYPT_PARAMS).toString('hex');
  return `${salt}:${hash}`;
}

const db = new Database(DB_PATH);
const row = db.prepare('SELECT id FROM users WHERE username=?').get(username);

if (!row) {
  console.error(`Error: user "${username}" not found`);
  db.close();
  process.exit(1);
}

const newHash = hashPassword(password);
const changes = db.prepare('UPDATE users SET password=? WHERE username=?').run(newHash, username).changes;
db.close();

if (changes > 0) {
  console.log(`✅ Password updated for user "${username}"`);
} else {
  console.error('Error: update failed');
  process.exit(1);
}
