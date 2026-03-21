// src/validators.js
// Pure validation functions — no DB or Express dependencies.
// Imported by routes.js at runtime and by tests directly.

export const VALID_TXN_TYPES  = new Set(['gasto', 'tarjeta']);
export const VALID_CATS       = new Set(['Vivienda','Alimentación','Transporte','Salud','Entretenimiento','Educación','Ropa','Servicios','Suscripciones','Restaurantes','Viajes','Otros']);
export const VALID_ACCT_TYPES = new Set(['debito','credito','efectivo','ahorro']);
export const DATE_RE          = /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/;
export const COLOR_RE         = /^#[0-9a-fA-F]{6}$/;

export function isPositiveFinite(n) {
  return typeof n === 'number' && Number.isFinite(n) && n > 0;
}

// ── Month body (used for PUT /months/:key and as part of import) ──────────────
export function validateMonthBody(body) {
  if (!Number.isInteger(body.year) || body.year < 2000 || body.year > 2100)
    return 'year must be an integer between 2000 and 2100';
  if (!Number.isInteger(body.month) || body.month < 0 || body.month > 11)
    return 'month must be an integer between 0 and 11';
  if (body.transactions !== undefined) {
    if (!Array.isArray(body.transactions))
      return 'transactions must be an array';
    if (body.transactions.length > 500)
      return 'too many transactions (max 500)';
    for (const t of body.transactions) {
      if (typeof t.id !== 'number')                              return 'transaction id must be a number';
      if (typeof t.name !== 'string' || t.name.length > 200)    return 'transaction name must be a string ≤200 chars';
      if (typeof t.amount !== 'number' || t.amount <= 0)        return 'transaction amount must be a positive number';
      if (t.type  !== undefined && typeof t.type  !== 'string') return 'transaction type must be a string';
      if (t.cat   !== undefined && typeof t.cat   !== 'string') return 'transaction cat must be a string';
      if (t.date  !== undefined && typeof t.date  !== 'string') return 'transaction date must be a string';
    }
  }
  if (body.budgets !== undefined) {
    if (typeof body.budgets !== 'object' || Array.isArray(body.budgets) || body.budgets === null)
      return 'budgets must be a plain object';
    for (const [k, v] of Object.entries(body.budgets)) {
      if (typeof v !== 'object' || v === null || Array.isArray(v))
        return `budgets.${k} must be an object`;
      if (v.limit !== undefined && (typeof v.limit !== 'number' || !Number.isFinite(v.limit) || v.limit < 0))
        return `budgets.${k}.limit must be a non-negative finite number`;
    }
  }
  if (body.income !== undefined) {
    if (typeof body.income !== 'object' || body.income === null) return 'income must be an object';
    if (body.income.amount !== undefined && (typeof body.income.amount !== 'number' || body.income.amount < 0))
      return 'income.amount must be a non-negative number';
  }
  return null;
}

// ── Deep import validators ────────────────────────────────────────────────────
export function validateImportMonth(m, idx) {
  if (!m || typeof m !== 'object' || Array.isArray(m))
    return `months[${idx}]: must be an object`;
  if (typeof m.key !== 'string' || !/^\d{4}_\d{1,2}$/.test(m.key))
    return `months[${idx}]: key must be "YYYY_M" string`;
  const err = validateMonthBody(m);
  if (err) return `months[${idx}]: ${err}`;
  for (const [ti, t] of (m.transactions || []).entries()) {
    if (!isPositiveFinite(t.id))
      return `months[${idx}].transactions[${ti}]: id must be a positive number`;
    if (!t.name || typeof t.name !== 'string' || t.name.trim().length === 0)
      return `months[${idx}].transactions[${ti}]: name must be a non-empty string`;
    if (!isPositiveFinite(t.amount))
      return `months[${idx}].transactions[${ti}]: amount must be a positive finite number`;
    if (t.type !== undefined && !VALID_TXN_TYPES.has(t.type))
      return `months[${idx}].transactions[${ti}]: type must be one of ${[...VALID_TXN_TYPES].join(', ')}`;
    if (t.cat !== undefined && !VALID_CATS.has(t.cat))
      return `months[${idx}].transactions[${ti}]: unknown category "${t.cat}"`;
    if (t.date !== undefined && !DATE_RE.test(t.date))
      return `months[${idx}].transactions[${ti}]: date must be YYYY-MM-DD`;
    if (t.cuotas !== undefined && (!Number.isInteger(t.cuotas) || t.cuotas < 1 || t.cuotas > 60))
      return `months[${idx}].transactions[${ti}]: cuotas must be integer 1–60`;
    if (t.accountId !== undefined && t.accountId !== null && typeof t.accountId !== 'number')
      return `months[${idx}].transactions[${ti}]: accountId must be a number or null`;
  }
  if (m.budgets) {
    for (const [k, v] of Object.entries(m.budgets)) {
      if (!v || typeof v !== 'object' || Array.isArray(v))
        return `months[${idx}].budgets.${k}: must be an object`;
      if (v.limit !== undefined && (typeof v.limit !== 'number' || !Number.isFinite(v.limit) || v.limit < 0))
        return `months[${idx}].budgets.${k}.limit: must be a non-negative finite number`;
    }
  }
  return null;
}

export function validateImportDeferral(d, idx) {
  if (!d || typeof d !== 'object' || Array.isArray(d))
    return `deferrals[${idx}]: must be an object`;
  if (!isPositiveFinite(d.id))
    return `deferrals[${idx}]: id must be a positive number`;
  if (!d.name || typeof d.name !== 'string' || d.name.trim().length === 0 || d.name.length > 200)
    return `deferrals[${idx}]: name must be a non-empty string ≤200 chars`;
  if (!isPositiveFinite(d.amount))
    return `deferrals[${idx}]: amount must be a positive finite number`;
  if (!Number.isInteger(d.cuotas) || d.cuotas < 1 || d.cuotas > 120)
    return `deferrals[${idx}]: cuotas must be an integer 1–120`;
  if (!Number.isInteger(d.originYear) || d.originYear < 2000 || d.originYear > 2100)
    return `deferrals[${idx}]: originYear must be an integer 2000–2100`;
  if (!Number.isInteger(d.originMonth) || d.originMonth < 0 || d.originMonth > 11)
    return `deferrals[${idx}]: originMonth must be an integer 0–11`;
  if (!d.date || !DATE_RE.test(d.date))
    return `deferrals[${idx}]: date must be YYYY-MM-DD`;
  if (d.cat !== undefined && !VALID_CATS.has(d.cat))
    return `deferrals[${idx}]: unknown category "${d.cat}"`;
  if (d.accountId !== undefined && d.accountId !== null && typeof d.accountId !== 'number')
    return `deferrals[${idx}]: accountId must be a number or null`;
  return null;
}

export const IMPORT_MAX = 500;

export function validateImportAccount(a, idx) {
  if (!a || typeof a !== 'object' || Array.isArray(a))
    return `accounts[${idx}]: must be an object`;
  if (!isPositiveFinite(a.id))
    return `accounts[${idx}]: id must be a positive number`;
  if (!a.name || typeof a.name !== 'string' || a.name.trim().length === 0 || a.name.length > 100)
    return `accounts[${idx}]: name must be a non-empty string ≤100 chars`;
  if (a.type !== undefined && !VALID_ACCT_TYPES.has(a.type))
    return `accounts[${idx}]: type must be one of ${[...VALID_ACCT_TYPES].join(', ')}`;
  if (a.color !== undefined && !COLOR_RE.test(a.color))
    return `accounts[${idx}]: color must be a hex color string like #rrggbb`;
  if (a.bank !== undefined && (typeof a.bank !== 'string' || a.bank.length > 100))
    return `accounts[${idx}]: bank must be a string ≤100 chars`;
  return null;
}
