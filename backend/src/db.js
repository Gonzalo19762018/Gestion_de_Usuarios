// src/db.js
import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../data/flujo.db');

let db;
export const getDb = () => db;

export function initDb() {
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('synchronous = NORMAL');

  // ── CREATE tables (fresh install) ───────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      username   TEXT    NOT NULL UNIQUE,
      password   TEXT    NOT NULL,
      role       TEXT    NOT NULL DEFAULT 'user',
      created_at TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS months (
      user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      key              TEXT    NOT NULL,
      year             INTEGER NOT NULL,
      month            INTEGER NOT NULL,
      income_amount    REAL    NOT NULL DEFAULT 0,
      income_desc      TEXT    NOT NULL DEFAULT 'Ingreso mensual',
      include_rollover INTEGER NOT NULL DEFAULT 0,
      rollover_applied REAL    NOT NULL DEFAULT 0,
      transactions     TEXT    NOT NULL DEFAULT '[]',
      budgets          TEXT    NOT NULL DEFAULT '{}',
      updated_at       TEXT    NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, key)
    );

    CREATE TABLE IF NOT EXISTS deferrals (
      user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      id           INTEGER NOT NULL,
      name         TEXT    NOT NULL,
      amount       REAL    NOT NULL,
      cat          TEXT    NOT NULL DEFAULT 'Otros',
      date         TEXT    NOT NULL,
      cuotas       INTEGER NOT NULL DEFAULT 1,
      account_id   INTEGER,
      origin_year  INTEGER NOT NULL,
      origin_month INTEGER NOT NULL,
      created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, id)
    );

    CREATE TABLE IF NOT EXISTS accounts (
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      id         INTEGER NOT NULL,
      name       TEXT    NOT NULL,
      type       TEXT    NOT NULL DEFAULT 'debito',
      color      TEXT    NOT NULL DEFAULT '#6c63ff',
      bank       TEXT    NOT NULL DEFAULT '',
      created_at TEXT    NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, id)
    );
  `);

  // Run migrations in order — each is idempotent
  _migrateIfNeeded(); // adds user_id column to pre-existing single-user tables
  _addFkConstraints(); // adds FOREIGN KEY + ON DELETE CASCADE (DB-3)
  _migrateToNumericUserId(); // converts user_id TEXT(username) → INTEGER(id) (DB-1)

  console.log(`[db] ${DB_PATH}`);
  return db;
}

// ── MIGRATION 1: add user_id to pre-existing single-user tables ─────────────
function _migrateIfNeeded() {
  const monthsCols = db.prepare('PRAGMA table_info(months)').all();
  if (monthsCols.length === 0) return; // fresh install — tables just created above
  if (monthsCols.some((c) => c.name === 'user_id')) return; // already migrated

  console.log('[db] migrating to multi-user schema…');
  db.exec(`
    BEGIN;

    -- months
    CREATE TABLE months_new (
      user_id          TEXT    NOT NULL DEFAULT '',
      key              TEXT    NOT NULL,
      year             INTEGER NOT NULL,
      month            INTEGER NOT NULL,
      income_amount    REAL    NOT NULL DEFAULT 0,
      income_desc      TEXT    NOT NULL DEFAULT 'Ingreso mensual',
      include_rollover INTEGER NOT NULL DEFAULT 0,
      rollover_applied REAL    NOT NULL DEFAULT 0,
      transactions     TEXT    NOT NULL DEFAULT '[]',
      budgets          TEXT    NOT NULL DEFAULT '{}',
      updated_at       TEXT    NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, key)
    );
    INSERT INTO months_new
      SELECT '', key, year, month, income_amount, income_desc,
             include_rollover, rollover_applied, transactions, budgets, updated_at
      FROM months;
    DROP TABLE months;
    ALTER TABLE months_new RENAME TO months;

    -- deferrals
    CREATE TABLE deferrals_new (
      user_id      TEXT    NOT NULL DEFAULT '',
      id           INTEGER NOT NULL,
      name         TEXT    NOT NULL,
      amount       REAL    NOT NULL,
      cat          TEXT    NOT NULL DEFAULT 'Otros',
      date         TEXT    NOT NULL,
      cuotas       INTEGER NOT NULL DEFAULT 1,
      account_id   INTEGER,
      origin_year  INTEGER NOT NULL,
      origin_month INTEGER NOT NULL,
      created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, id)
    );
    INSERT INTO deferrals_new
      SELECT '', id, name, amount, cat, date, cuotas, account_id,
             origin_year, origin_month, created_at
      FROM deferrals;
    DROP TABLE deferrals;
    ALTER TABLE deferrals_new RENAME TO deferrals;

    -- accounts
    CREATE TABLE accounts_new (
      user_id    TEXT    NOT NULL DEFAULT '',
      id         INTEGER NOT NULL,
      name       TEXT    NOT NULL,
      type       TEXT    NOT NULL DEFAULT 'debito',
      color      TEXT    NOT NULL DEFAULT '#6c63ff',
      bank       TEXT    NOT NULL DEFAULT '',
      created_at TEXT    NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, id)
    );
    INSERT INTO accounts_new
      SELECT '', id, name, type, color, bank, created_at FROM accounts;
    DROP TABLE accounts;
    ALTER TABLE accounts_new RENAME TO accounts;

    COMMIT;
  `);
  console.log('[db] migration 1 complete — existing data assigned to user ""');
}

// ── MIGRATION 2: add FOREIGN KEY ON DELETE CASCADE (DB-3) ──────────────────
// Detects via PRAGMA foreign_key_list. Reassigns legacy user_id='' rows to the
// first (admin) user before rebuilding tables with proper FK constraints.
function _addFkConstraints() {
  // Already done if months table has any FK defined
  if (db.prepare('PRAGMA foreign_key_list(months)').all().length > 0) return;

  // Reassign legacy '' user_id to the oldest user (admin) so FK won't reject them
  const hasLegacy = !!(
    db.prepare("SELECT 1 FROM months    WHERE user_id='' LIMIT 1").get() ||
    db.prepare("SELECT 1 FROM deferrals WHERE user_id='' LIMIT 1").get() ||
    db.prepare("SELECT 1 FROM accounts  WHERE user_id='' LIMIT 1").get()
  );

  if (hasLegacy) {
    const firstUser = db.prepare('SELECT username FROM users ORDER BY id LIMIT 1').get();
    if (!firstUser) {
      // Edge case: legacy data but no users yet — skip to avoid data loss
      console.warn('[db] FK migration skipped: unowned data exists but no users found');
      return;
    }
    console.log(`[db] reassigning legacy data to user "${firstUser.username}"…`);
    ['months', 'deferrals', 'accounts'].forEach((t) =>
      db.prepare(`UPDATE ${t} SET user_id=? WHERE user_id=''`).run(firstUser.username)
    );
  }

  console.log('[db] adding FK constraints + CASCADE DELETE to data tables…');

  // Disable FK enforcement while we rebuild (re-enabled after)
  db.pragma('foreign_keys = OFF');
  db.exec(`
    BEGIN;

    CREATE TABLE months_fk (
      user_id          TEXT    NOT NULL REFERENCES users(username) ON DELETE CASCADE,
      key              TEXT    NOT NULL,
      year             INTEGER NOT NULL,
      month            INTEGER NOT NULL,
      income_amount    REAL    NOT NULL DEFAULT 0,
      income_desc      TEXT    NOT NULL DEFAULT 'Ingreso mensual',
      include_rollover INTEGER NOT NULL DEFAULT 0,
      rollover_applied REAL    NOT NULL DEFAULT 0,
      transactions     TEXT    NOT NULL DEFAULT '[]',
      budgets          TEXT    NOT NULL DEFAULT '{}',
      updated_at       TEXT    NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, key)
    );
    INSERT INTO months_fk    SELECT * FROM months;
    DROP TABLE months;
    ALTER TABLE months_fk    RENAME TO months;

    CREATE TABLE deferrals_fk (
      user_id      TEXT    NOT NULL REFERENCES users(username) ON DELETE CASCADE,
      id           INTEGER NOT NULL,
      name         TEXT    NOT NULL,
      amount       REAL    NOT NULL,
      cat          TEXT    NOT NULL DEFAULT 'Otros',
      date         TEXT    NOT NULL,
      cuotas       INTEGER NOT NULL DEFAULT 1,
      account_id   INTEGER,
      origin_year  INTEGER NOT NULL,
      origin_month INTEGER NOT NULL,
      created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, id)
    );
    INSERT INTO deferrals_fk SELECT * FROM deferrals;
    DROP TABLE deferrals;
    ALTER TABLE deferrals_fk RENAME TO deferrals;

    CREATE TABLE accounts_fk (
      user_id    TEXT    NOT NULL REFERENCES users(username) ON DELETE CASCADE,
      id         INTEGER NOT NULL,
      name       TEXT    NOT NULL,
      type       TEXT    NOT NULL DEFAULT 'debito',
      color      TEXT    NOT NULL DEFAULT '#6c63ff',
      bank       TEXT    NOT NULL DEFAULT '',
      created_at TEXT    NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, id)
    );
    INSERT INTO accounts_fk  SELECT * FROM accounts;
    DROP TABLE accounts;
    ALTER TABLE accounts_fk  RENAME TO accounts;

    COMMIT;
  `);
  db.pragma('foreign_keys = ON');
  console.log('[db] FK migration complete');
}

// ── MIGRATION 3: user_id TEXT(username) → INTEGER(users.id) ────────────────
// Safe to re-run: skipped when user_id column is already INTEGER.
// Existing sessions are dropped — users simply re-login after the upgrade.
function _migrateToNumericUserId() {
  const cols = db.prepare('PRAGMA table_info(months)').all();
  if (!cols.length) return; // fresh install — CREATE TABLE already uses INTEGER
  const uidCol = cols.find((c) => c.name === 'user_id');
  if (!uidCol || uidCol.type === 'INTEGER') return; // already migrated

  console.log('[db] migrating user_id to numeric INTEGER…');

  // Drop stale sessions — initSessions() will recreate with the new schema
  db.prepare('DROP TABLE IF EXISTS sessions').run();

  db.pragma('foreign_keys = OFF');
  db.exec(`
    BEGIN;

    CREATE TABLE months_uid (
      user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      key              TEXT    NOT NULL,
      year             INTEGER NOT NULL,
      month            INTEGER NOT NULL,
      income_amount    REAL    NOT NULL DEFAULT 0,
      income_desc      TEXT    NOT NULL DEFAULT 'Ingreso mensual',
      include_rollover INTEGER NOT NULL DEFAULT 0,
      rollover_applied REAL    NOT NULL DEFAULT 0,
      transactions     TEXT    NOT NULL DEFAULT '[]',
      budgets          TEXT    NOT NULL DEFAULT '{}',
      updated_at       TEXT    NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, key)
    );
    INSERT INTO months_uid
      SELECT u.id, m.key, m.year, m.month, m.income_amount, m.income_desc,
             m.include_rollover, m.rollover_applied, m.transactions, m.budgets, m.updated_at
      FROM months m
      JOIN users u ON u.username = m.user_id;
    DROP TABLE months;
    ALTER TABLE months_uid RENAME TO months;

    CREATE TABLE deferrals_uid (
      user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      id           INTEGER NOT NULL,
      name         TEXT    NOT NULL,
      amount       REAL    NOT NULL,
      cat          TEXT    NOT NULL DEFAULT 'Otros',
      date         TEXT    NOT NULL,
      cuotas       INTEGER NOT NULL DEFAULT 1,
      account_id   INTEGER,
      origin_year  INTEGER NOT NULL,
      origin_month INTEGER NOT NULL,
      created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, id)
    );
    INSERT INTO deferrals_uid
      SELECT u.id, d.id, d.name, d.amount, d.cat, d.date, d.cuotas, d.account_id,
             d.origin_year, d.origin_month, d.created_at
      FROM deferrals d
      JOIN users u ON u.username = d.user_id;
    DROP TABLE deferrals;
    ALTER TABLE deferrals_uid RENAME TO deferrals;

    CREATE TABLE accounts_uid (
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      id         INTEGER NOT NULL,
      name       TEXT    NOT NULL,
      type       TEXT    NOT NULL DEFAULT 'debito',
      color      TEXT    NOT NULL DEFAULT '#6c63ff',
      bank       TEXT    NOT NULL DEFAULT '',
      created_at TEXT    NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, id)
    );
    INSERT INTO accounts_uid
      SELECT u.id, a.id, a.name, a.type, a.color, a.bank, a.created_at
      FROM accounts a
      JOIN users u ON u.username = a.user_id;
    DROP TABLE accounts;
    ALTER TABLE accounts_uid RENAME TO accounts;

    COMMIT;
  `);
  db.pragma('foreign_keys = ON');
  console.log('[db] migration 3 (numeric user_id) complete — users must re-login');
}

// ── USERS ─────────────────────────────────────────────────
export const users = {
  count() {
    return db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  },
  // Full row including password hash — only use for auth (login / password change)
  getByUsername(u) {
    return db.prepare('SELECT * FROM users WHERE username=?').get(u) || null;
  },
  getById(id) {
    return db.prepare('SELECT * FROM users WHERE id=?').get(id) || null;
  },
  // Safe projection — never includes the password hash
  getByUsernamePublic(u) {
    return (
      db.prepare('SELECT id, username, role, created_at FROM users WHERE username=?').get(u) || null
    );
  },
  getByIdPublic(id) {
    return (
      db.prepare('SELECT id, username, role, created_at FROM users WHERE id=?').get(id) || null
    );
  },
  // Returns all users without the password hash
  getAll() {
    return db.prepare('SELECT id, username, role, created_at FROM users ORDER BY created_at').all();
  },
  create(username, passwordHash, role = 'user') {
    db.prepare('INSERT INTO users(username,password,role) VALUES(?,?,?)').run(
      username,
      passwordHash,
      role
    );
    return this.getByUsername(username);
  },
  updatePassword(id, newHash) {
    return db.prepare('UPDATE users SET password=? WHERE id=?').run(newHash, id).changes > 0;
  },
  // DB-2: delete user data in all tables atomically before removing the user.
  // The FK ON DELETE CASCADE also enforces this at the DB level (DB-3).
  delete(id) {
    return db.transaction(() => {
      db.prepare('DELETE FROM months    WHERE user_id=?').run(id);
      db.prepare('DELETE FROM deferrals WHERE user_id=?').run(id);
      db.prepare('DELETE FROM accounts  WHERE user_id=?').run(id);
      return db.prepare('DELETE FROM users WHERE id=?').run(id).changes > 0;
    })();
  },
};

// ── MONTHS ────────────────────────────────────────────────
export const months = {
  getAll(userId) {
    return db
      .prepare('SELECT * FROM months WHERE user_id=? ORDER BY year, month')
      .all(userId)
      .map(toMonth);
  },
  get(userId, key) {
    const r = db.prepare('SELECT * FROM months WHERE user_id=? AND key=?').get(userId, key);
    return r ? toMonth(r) : null;
  },
  upsert(userId, md) {
    const inc = md.income || {};
    db.prepare(
      `
      INSERT INTO months(user_id,key,year,month,income_amount,income_desc,include_rollover,rollover_applied,transactions,budgets,updated_at)
      VALUES(@uid,@key,@year,@month,@ia,@id,@ir,@ra,@tx,@bud,datetime('now'))
      ON CONFLICT(user_id,key) DO UPDATE SET
        income_amount=excluded.income_amount, income_desc=excluded.income_desc,
        include_rollover=excluded.include_rollover, rollover_applied=excluded.rollover_applied,
        transactions=excluded.transactions, budgets=excluded.budgets, updated_at=excluded.updated_at
    `
    ).run({
      uid: userId,
      key: md.key,
      year: md.year,
      month: md.month,
      ia: inc.amount || 0,
      id: inc.desc || 'Ingreso mensual',
      ir: inc.includeRollover ? 1 : 0,
      ra: md.rolloverApplied || 0,
      tx: JSON.stringify(md.transactions || []),
      bud: JSON.stringify(md.budgets || {}),
    });
    return this.get(userId, md.key);
  },
  delete(userId, key) {
    db.prepare('DELETE FROM months WHERE user_id=? AND key=?').run(userId, key);
  },
};

// DB-4: JSON.parse wrapped in try/catch — corrupted rows return empty defaults
// instead of crashing the request.
function toMonth(r) {
  let transactions = [];
  let budgets = {};
  try {
    transactions = JSON.parse(r.transactions || '[]');
  } catch {
    /* use default */
  }
  try {
    budgets = JSON.parse(r.budgets || '{}');
  } catch {
    /* use default */
  }
  return {
    key: r.key,
    year: r.year,
    month: r.month,
    income: {
      amount: r.income_amount,
      desc: r.income_desc,
      includeRollover: r.include_rollover === 1,
    },
    rolloverApplied: r.rollover_applied,
    transactions,
    budgets,
    updatedAt: r.updated_at,
  };
}

// ── DEFERRALS ─────────────────────────────────────────────
export const deferrals = {
  getAll(userId) {
    return db
      .prepare('SELECT * FROM deferrals WHERE user_id=? ORDER BY origin_year,origin_month')
      .all(userId)
      .map(toDeferral);
  },
  get(userId, id) {
    const r = db.prepare('SELECT * FROM deferrals WHERE user_id=? AND id=?').get(userId, id);
    return r ? toDeferral(r) : null;
  },
  upsert(userId, d) {
    db.prepare(
      `
      INSERT INTO deferrals(user_id,id,name,amount,cat,date,cuotas,account_id,origin_year,origin_month)
      VALUES(@uid,@id,@name,@amount,@cat,@date,@cuotas,@aid,@oy,@om)
      ON CONFLICT(user_id,id) DO UPDATE SET
        name=excluded.name, amount=excluded.amount, cat=excluded.cat, date=excluded.date,
        cuotas=excluded.cuotas, account_id=excluded.account_id,
        origin_year=excluded.origin_year, origin_month=excluded.origin_month
    `
    ).run({
      uid: userId,
      id: d.id,
      name: d.name,
      amount: d.amount,
      cat: d.cat || 'Otros',
      date: d.date,
      cuotas: d.cuotas || 1,
      aid: d.accountId || null,
      oy: d.originYear,
      om: d.originMonth,
    });
    return this.get(userId, d.id);
  },
  delete(userId, id) {
    return db.prepare('DELETE FROM deferrals WHERE user_id=? AND id=?').run(userId, id).changes > 0;
  },
};

function toDeferral(r) {
  return {
    id: r.id,
    name: r.name,
    amount: r.amount,
    cat: r.cat,
    date: r.date,
    cuotas: r.cuotas,
    accountId: r.account_id,
    originYear: r.origin_year,
    originMonth: r.origin_month,
  };
}

// ── ACCOUNTS ──────────────────────────────────────────────
export const accounts = {
  getAll(userId) {
    return db
      .prepare('SELECT * FROM accounts WHERE user_id=? ORDER BY created_at')
      .all(userId)
      .map(toAccount);
  },
  get(userId, id) {
    const r = db.prepare('SELECT * FROM accounts WHERE user_id=? AND id=?').get(userId, id);
    return r ? toAccount(r) : null;
  },
  upsert(userId, a) {
    db.prepare(
      `
      INSERT INTO accounts(user_id,id,name,type,color,bank)
      VALUES(@uid,@id,@name,@type,@color,@bank)
      ON CONFLICT(user_id,id) DO UPDATE SET
        name=excluded.name, type=excluded.type, color=excluded.color, bank=excluded.bank
    `
    ).run({
      uid: userId,
      id: a.id,
      name: a.name,
      type: a.type,
      color: a.color,
      bank: a.bank || '',
    });
    return this.get(userId, a.id);
  },
  delete(userId, id) {
    return db.prepare('DELETE FROM accounts WHERE user_id=? AND id=?').run(userId, id).changes > 0;
  },
};

function toAccount(r) {
  return { id: r.id, name: r.name, type: r.type, color: r.color, bank: r.bank };
}
