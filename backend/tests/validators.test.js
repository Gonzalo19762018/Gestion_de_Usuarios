// tests/validators.test.js
// Tests for pure validation functions in validators.js.
// No DB, no HTTP — fast unit tests.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateMonthBody,
  validateImportMonth,
  validateImportDeferral,
  validateImportAccount,
} from '../src/validators.js';

// ── validateMonthBody ─────────────────────────────────────────────────────────
describe('validateMonthBody', () => {
  const valid = { year: 2024, month: 0 };

  test('accepts a minimal valid body', () => {
    assert.equal(validateMonthBody(valid), null);
  });

  test('rejects year below 2000', () => {
    assert.ok(validateMonthBody({ year: 1999, month: 0 }));
  });

  test('rejects year above 2100', () => {
    assert.ok(validateMonthBody({ year: 2101, month: 0 }));
  });

  test('rejects non-integer year', () => {
    assert.ok(validateMonthBody({ year: 2024.5, month: 0 }));
  });

  test('rejects month below 0', () => {
    assert.ok(validateMonthBody({ year: 2024, month: -1 }));
  });

  test('rejects month above 11', () => {
    assert.ok(validateMonthBody({ year: 2024, month: 12 }));
  });

  test('accepts body with valid transaction array', () => {
    const body = {
      ...valid,
      transactions: [{ id: 1, name: 'Coffee', amount: 50, type: 'gasto' }],
    };
    assert.equal(validateMonthBody(body), null);
  });

  test('rejects transactions that is not an array', () => {
    assert.ok(validateMonthBody({ ...valid, transactions: 'nope' }));
  });

  test('rejects a transaction with non-positive amount', () => {
    const body = {
      ...valid,
      transactions: [{ id: 1, name: 'Bad', amount: 0 }],
    };
    assert.ok(validateMonthBody(body));
  });

  test('rejects negative income.amount', () => {
    assert.ok(validateMonthBody({ ...valid, income: { amount: -1 } }));
  });

  test('accepts budgets with object values', () => {
    assert.equal(
      validateMonthBody({
        ...valid,
        budgets: { Vivienda: { limit: 5000 }, Alimentación: { limit: 3000 } },
      }),
      null
    );
  });

  test('accepts budgets with undefined limit', () => {
    assert.equal(validateMonthBody({ ...valid, budgets: { Vivienda: {} } }), null);
  });

  test('rejects budget value that is a plain number', () => {
    assert.ok(validateMonthBody({ ...valid, budgets: { Vivienda: 5000 } }));
  });

  test('rejects budget value with negative limit', () => {
    assert.ok(validateMonthBody({ ...valid, budgets: { Vivienda: { limit: -100 } } }));
  });
});

// ── validateImportMonth ───────────────────────────────────────────────────────
describe('validateImportMonth', () => {
  const validMonth = { key: '2024_0', year: 2024, month: 0, transactions: [] };

  test('accepts a valid month object', () => {
    assert.equal(validateImportMonth(validMonth, 0), null);
  });

  test('rejects non-object input', () => {
    assert.ok(validateImportMonth(null, 0));
    assert.ok(validateImportMonth('string', 0));
    assert.ok(validateImportMonth([], 0));
  });

  test('rejects invalid key format', () => {
    assert.ok(validateImportMonth({ ...validMonth, key: 'bad-key' }, 0));
  });

  test('rejects transaction with unknown category', () => {
    const m = {
      ...validMonth,
      transactions: [{ id: 1, name: 'X', amount: 10, cat: 'UNKNOWN' }],
    };
    assert.ok(validateImportMonth(m, 0));
  });

  test('rejects transaction with invalid date format', () => {
    const m = {
      ...validMonth,
      transactions: [{ id: 1, name: 'X', amount: 10, date: '24-01-01' }],
    };
    assert.ok(validateImportMonth(m, 0));
  });

  test('error message includes array index', () => {
    const err = validateImportMonth(null, 3);
    assert.ok(err.includes('[3]'), `Expected index in error: ${err}`);
  });
});

// ── validateImportDeferral ────────────────────────────────────────────────────
describe('validateImportDeferral', () => {
  const validDeferral = {
    id: 1,
    name: 'Laptop',
    amount: 12000,
    cuotas: 12,
    originYear: 2024,
    originMonth: 0,
    date: '2024-01-15',
  };

  test('accepts a valid deferral object', () => {
    assert.equal(validateImportDeferral(validDeferral, 0), null);
  });

  test('rejects cuotas outside 1–120 range', () => {
    assert.ok(validateImportDeferral({ ...validDeferral, cuotas: 0 }, 0));
    assert.ok(validateImportDeferral({ ...validDeferral, cuotas: 121 }, 0));
  });

  test('rejects malformed date', () => {
    assert.ok(validateImportDeferral({ ...validDeferral, date: '2024/01/15' }, 0));
  });

  test('rejects unknown category', () => {
    assert.ok(validateImportDeferral({ ...validDeferral, cat: 'Gadgets' }, 0));
  });

  test('accepts valid known category', () => {
    assert.equal(
      validateImportDeferral(
        { ...validDeferral, cat: 'Electrónica' === 'Electrónica' ? 'Educación' : 'Educación' },
        0
      ),
      null
    );
  });

  test('error message includes array index', () => {
    const err = validateImportDeferral(null, 5);
    assert.ok(err.includes('[5]'), `Expected index in error: ${err}`);
  });
});

// ── validateImportAccount ─────────────────────────────────────────────────────
describe('validateImportAccount', () => {
  const validAccount = { id: 1, name: 'BBVA Débito', type: 'debito', color: '#6c63ff' };

  test('accepts a valid account object', () => {
    assert.equal(validateImportAccount(validAccount, 0), null);
  });

  test('rejects unknown account type', () => {
    assert.ok(validateImportAccount({ ...validAccount, type: 'crypto' }, 0));
  });

  test('rejects malformed color', () => {
    assert.ok(validateImportAccount({ ...validAccount, color: 'red' }, 0));
    assert.ok(validateImportAccount({ ...validAccount, color: '#GGGGGG' }, 0));
  });

  test('accepts a valid 6-digit hex color', () => {
    assert.equal(validateImportAccount({ ...validAccount, color: '#aAbBcC' }, 0), null);
  });

  test('rejects empty name', () => {
    assert.ok(validateImportAccount({ ...validAccount, name: '' }, 0));
    assert.ok(validateImportAccount({ ...validAccount, name: '   ' }, 0));
  });

  test('error message includes array index', () => {
    const err = validateImportAccount(null, 7);
    assert.ok(err.includes('[7]'), `Expected index in error: ${err}`);
  });
});
