// src/routes.js
import { Router } from 'express';
import { months, deferrals, accounts, getDb } from './db.js';
import { addClient, removeClient, broadcast } from './sse.js';
import {
  validateMonthBody,
  validateImportMonth,
  validateImportDeferral,
  validateImportAccount,
  IMPORT_MAX,
} from './validators.js';

const router = Router();

// ── SSE — real-time sync endpoint (per-user) ──────────────
router.get('/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  res.write(`event: connected\ndata: {"ok":true}\n\n`);

  const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 30_000);

  addClient(res, req.user);
  req.on('close', () => {
    clearInterval(heartbeat);
    removeClient(res, req.user);
  });
});

// ── MONTHS ────────────────────────────────────────────────
router.get('/months', (req, res) => res.json(months.getAll(req.user)));

router.get('/months/:key', (req, res) => {
  const m = months.get(req.user, req.params.key);
  if (!m) return res.status(404).json({ error: 'Not found' });
  res.json(m);
});

router.put('/months/:key', (req, res) => {
  const body = req.body;
  if (!body || body.key !== req.params.key) return res.status(400).json({ error: 'key mismatch' });
  const err = validateMonthBody(body);
  if (err) return res.status(400).json({ error: err });
  const saved = months.upsert(req.user, body);
  res.json(saved);
  broadcast('sync', { store: 'months', key: saved.key }, req.user);
});

router.delete('/months/:key', (req, res) => {
  months.delete(req.user, req.params.key);
  res.json({ ok: true });
  broadcast('sync', { store: 'months', key: req.params.key, deleted: true }, req.user);
});

// ── DEFERRALS ─────────────────────────────────────────────
router.get('/deferrals', (req, res) => res.json(deferrals.getAll(req.user)));

router.get('/deferrals/:id', (req, res) => {
  const d = deferrals.get(req.user, +req.params.id);
  if (!d) return res.status(404).json({ error: 'Not found' });
  res.json(d);
});

router.put('/deferrals/:id', (req, res) => {
  const body = req.body;
  if (!body?.id || !body?.name || body.amount == null)
    return res.status(400).json({ error: 'id, name, amount required' });
  if (typeof body.amount !== 'number' || body.amount <= 0)
    return res.status(400).json({ error: 'amount must be a positive number' });
  if (typeof body.name !== 'string' || body.name.length > 200)
    return res.status(400).json({ error: 'name must be a string under 200 chars' });
  if (
    body.cuotas !== undefined &&
    (!Number.isInteger(body.cuotas) || body.cuotas < 1 || body.cuotas > 120)
  )
    return res.status(400).json({ error: 'cuotas must be an integer 1–120' });
  const saved = deferrals.upsert(req.user, body);
  res.json(saved);
  broadcast('sync', { store: 'deferrals', id: saved.id }, req.user);
});

router.delete('/deferrals/:id', (req, res) => {
  const ok = deferrals.delete(req.user, +req.params.id);
  if (!ok) return res.status(404).json({ error: 'Not found' });
  res.json({ ok: true });
  broadcast('sync', { store: 'deferrals', id: +req.params.id, deleted: true }, req.user);
});

// ── ACCOUNTS ──────────────────────────────────────────────
router.get('/accounts', (req, res) => res.json(accounts.getAll(req.user)));

router.put('/accounts/:id', (req, res) => {
  const body = req.body;
  if (!body?.id || !body?.name) return res.status(400).json({ error: 'id and name required' });
  if (typeof body.name !== 'string' || body.name.length > 100)
    return res.status(400).json({ error: 'name must be a string under 100 chars' });
  if (body.bank !== undefined && (typeof body.bank !== 'string' || body.bank.length > 100))
    return res.status(400).json({ error: 'bank must be a string under 100 chars' });
  const saved = accounts.upsert(req.user, body);
  res.json(saved);
  broadcast('sync', { store: 'accounts', id: saved.id }, req.user);
});

router.delete('/accounts/:id', (req, res) => {
  const ok = accounts.delete(req.user, +req.params.id);
  if (!ok) return res.status(404).json({ error: 'Not found' });
  res.json({ ok: true });
  broadcast('sync', { store: 'accounts', id: +req.params.id, deleted: true }, req.user);
});

// ── EXPORT / IMPORT ───────────────────────────────────────
router.get('/export', (req, res) => {
  res.json({
    exportedAt: new Date().toISOString(),
    months: months.getAll(req.user),
    deferrals: deferrals.getAll(req.user),
    accounts: accounts.getAll(req.user),
  });
});

router.post('/import', (req, res) => {
  const { months: ms, deferrals: ds, accounts: as } = req.body ?? {};

  if (ms?.length > IMPORT_MAX || ds?.length > IMPORT_MAX || as?.length > IMPORT_MAX)
    return res
      .status(400)
      .json({ error: `Import arrays must not exceed ${IMPORT_MAX} items each` });

  // Deep validation — return the first specific error found
  if (Array.isArray(ms)) {
    for (const [i, m] of ms.entries()) {
      const err = validateImportMonth(m, i);
      if (err) return res.status(400).json({ error: err });
    }
    const ids = ms.map((m) => m.key);
    if (new Set(ids).size !== ids.length)
      return res.status(400).json({ error: 'months: duplicate keys in import payload' });
  }
  if (Array.isArray(ds)) {
    for (const [i, d] of ds.entries()) {
      const err = validateImportDeferral(d, i);
      if (err) return res.status(400).json({ error: err });
    }
    const ids = ds.map((d) => d.id);
    if (new Set(ids).size !== ids.length)
      return res.status(400).json({ error: 'deferrals: duplicate ids in import payload' });
  }
  if (Array.isArray(as)) {
    for (const [i, a] of as.entries()) {
      const err = validateImportAccount(a, i);
      if (err) return res.status(400).json({ error: err });
    }
    const ids = as.map((a) => a.id);
    if (new Set(ids).size !== ids.length)
      return res.status(400).json({ error: 'accounts: duplicate ids in import payload' });
  }

  // DB-5: wrap all upserts in a single transaction — partial failures roll back
  const run = getDb().transaction(() => {
    const imported = { months: 0, deferrals: 0, accounts: 0 };
    if (Array.isArray(ms))
      ms.forEach((m) => {
        months.upsert(req.user, m);
        imported.months++;
      });
    if (Array.isArray(ds))
      ds.forEach((d) => {
        deferrals.upsert(req.user, d);
        imported.deferrals++;
      });
    if (Array.isArray(as))
      as.forEach((a) => {
        accounts.upsert(req.user, a);
        imported.accounts++;
      });
    return imported;
  });
  const imported = run();
  res.json({ ok: true, imported });
  broadcast('sync', { store: 'all' }, req.user);
});

export default router;
