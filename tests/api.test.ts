import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/api/server.js';
import { SqliteEventStore } from '../src/events/sqlite-event-store.js';

const ADMIN_KEY = 'admin-test-key-do-not-use-in-prod';

interface Harness {
  app: FastifyInstance;
}

let harness: Harness;

beforeEach(async () => {
  const store = await SqliteEventStore.open();
  const { app } = buildApp({ store, adminApiKeys: [ADMIN_KEY] });
  harness = { app };
});

afterEach(async () => {
  await harness.app.close();
});

async function createAccountViaApi(
  owner: string,
  currency: string,
): Promise<{ accountId: string; apiKey: string }> {
  const res = await harness.app.inject({
    method: 'POST',
    url: '/accounts',
    payload: { owner, currency },
  });
  expect(res.statusCode).toBe(201);
  const body = res.json() as { accountId: string; apiKey: string };
  return body;
}

describe('POST /accounts', () => {
  it('creates an account and returns an API key', async () => {
    const { accountId, apiKey } = await createAccountViaApi('Gio', 'USD');
    expect(accountId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(apiKey).toMatch(/^[0-9a-f]{64}$/);
  });

  it('rejects empty owner', async () => {
    const res = await harness.app.inject({
      method: 'POST',
      url: '/accounts',
      payload: { owner: '', currency: 'USD' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'validation_error' });
  });

  it('rejects unknown currency', async () => {
    const res = await harness.app.inject({
      method: 'POST',
      url: '/accounts',
      payload: { owner: 'Gio', currency: 'XYZ' },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('GET /accounts/:id/balance', () => {
  it('returns 401 with no auth header', async () => {
    const { accountId } = await createAccountViaApi('Gio', 'USD');
    const res = await harness.app.inject({
      method: 'GET',
      url: `/accounts/${accountId}/balance`,
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 403 when API key belongs to another account', async () => {
    const a = await createAccountViaApi('A', 'USD');
    const b = await createAccountViaApi('B', 'USD');
    const res = await harness.app.inject({
      method: 'GET',
      url: `/accounts/${a.accountId}/balance`,
      headers: { authorization: `Bearer ${b.apiKey}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it('returns zero balance immediately after account creation', async () => {
    const { accountId, apiKey } = await createAccountViaApi('Gio', 'USD');
    const res = await harness.app.inject({
      method: 'GET',
      url: `/accounts/${accountId}/balance`,
      headers: { authorization: `Bearer ${apiKey}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      accountId,
      balance: { amount: '0', currency: 'USD' },
    });
  });
});

describe('POST /accounts/:id/deposits and /withdrawals', () => {
  it('deposits move balance and return the new balance', async () => {
    const { accountId, apiKey } = await createAccountViaApi('Gio', 'USD');
    const res = await harness.app.inject({
      method: 'POST',
      url: `/accounts/${accountId}/deposits`,
      headers: { authorization: `Bearer ${apiKey}` },
      payload: { amount: '500.25', currency: 'USD', reference: 'opening' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      balance: { amount: '500.25', currency: 'USD' },
    });
  });

  it('withdrawals respect the default hard-reject overdraft policy', async () => {
    const { accountId, apiKey } = await createAccountViaApi('Gio', 'USD');
    await harness.app.inject({
      method: 'POST',
      url: `/accounts/${accountId}/deposits`,
      headers: { authorization: `Bearer ${apiKey}` },
      payload: { amount: '10', currency: 'USD', reference: 'r' },
    });
    const res = await harness.app.inject({
      method: 'POST',
      url: `/accounts/${accountId}/withdrawals`,
      headers: { authorization: `Bearer ${apiKey}` },
      payload: { amount: '50', currency: 'USD', reference: 'too-much' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'command_error' });
  });

  it('honors overdraftLimit when supplied', async () => {
    const { accountId, apiKey } = await createAccountViaApi('Gio', 'USD');
    await harness.app.inject({
      method: 'POST',
      url: `/accounts/${accountId}/deposits`,
      headers: { authorization: `Bearer ${apiKey}` },
      payload: { amount: '10', currency: 'USD', reference: 'r' },
    });
    const res = await harness.app.inject({
      method: 'POST',
      url: `/accounts/${accountId}/withdrawals`,
      headers: { authorization: `Bearer ${apiKey}` },
      payload: {
        amount: '40',
        currency: 'USD',
        reference: 'with-overdraft',
        overdraftLimit: '100',
      },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      balance: { amount: '-30', currency: 'USD' },
    });
  });

  it('rejects deposit with malformed amount', async () => {
    const { accountId, apiKey } = await createAccountViaApi('Gio', 'USD');
    const res = await harness.app.inject({
      method: 'POST',
      url: `/accounts/${accountId}/deposits`,
      headers: { authorization: `Bearer ${apiKey}` },
      payload: { amount: 'not-a-number', currency: 'USD', reference: 'x' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'validation_error' });
  });
});

describe('POST /transfers', () => {
  it('moves money atomically and returns 201 with completed status', async () => {
    const a = await createAccountViaApi('A', 'USD');
    const b = await createAccountViaApi('B', 'USD');
    await harness.app.inject({
      method: 'POST',
      url: `/accounts/${a.accountId}/deposits`,
      headers: { authorization: `Bearer ${a.apiKey}` },
      payload: { amount: '500', currency: 'USD', reference: 'seed' },
    });
    const res = await harness.app.inject({
      method: 'POST',
      url: '/transfers',
      headers: { authorization: `Bearer ${a.apiKey}` },
      payload: {
        fromAccountId: a.accountId,
        toAccountId: b.accountId,
        amount: '120.50',
        currency: 'USD',
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as { status: string };
    expect(body.status).toBe('completed');

    const aBal = await harness.app.inject({
      method: 'GET',
      url: `/accounts/${a.accountId}/balance`,
      headers: { authorization: `Bearer ${a.apiKey}` },
    });
    const bBal = await harness.app.inject({
      method: 'GET',
      url: `/accounts/${b.accountId}/balance`,
      headers: { authorization: `Bearer ${b.apiKey}` },
    });
    expect(aBal.json()).toMatchObject({
      balance: { amount: '379.5', currency: 'USD' },
    });
    expect(bBal.json()).toMatchObject({
      balance: { amount: '120.5', currency: 'USD' },
    });
  });

  it('rejects with 403 when API key does not match source account', async () => {
    const a = await createAccountViaApi('A', 'USD');
    const b = await createAccountViaApi('B', 'USD');
    const res = await harness.app.inject({
      method: 'POST',
      url: '/transfers',
      headers: { authorization: `Bearer ${b.apiKey}` },
      payload: {
        fromAccountId: a.accountId,
        toAccountId: b.accountId,
        amount: '10',
        currency: 'USD',
      },
    });
    expect(res.statusCode).toBe(403);
  });

  it('returns 422 for a domain rejection (insufficient funds)', async () => {
    const a = await createAccountViaApi('A', 'USD');
    const b = await createAccountViaApi('B', 'USD');
    const res = await harness.app.inject({
      method: 'POST',
      url: '/transfers',
      headers: { authorization: `Bearer ${a.apiKey}` },
      payload: {
        fromAccountId: a.accountId,
        toAccountId: b.accountId,
        amount: '999',
        currency: 'USD',
      },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({ status: 'rejected' });
  });

  it('replaying the same transferId returns idempotent outcome', async () => {
    const a = await createAccountViaApi('A', 'USD');
    const b = await createAccountViaApi('B', 'USD');
    await harness.app.inject({
      method: 'POST',
      url: `/accounts/${a.accountId}/deposits`,
      headers: { authorization: `Bearer ${a.apiKey}` },
      payload: { amount: '500', currency: 'USD', reference: 'seed' },
    });
    const transferId = '11111111-2222-4333-8444-555555555555';
    const payload = {
      fromAccountId: a.accountId,
      toAccountId: b.accountId,
      amount: '100',
      currency: 'USD',
      transferId,
    };
    const first = await harness.app.inject({
      method: 'POST',
      url: '/transfers',
      headers: { authorization: `Bearer ${a.apiKey}` },
      payload,
    });
    const second = await harness.app.inject({
      method: 'POST',
      url: '/transfers',
      headers: { authorization: `Bearer ${a.apiKey}` },
      payload,
    });
    expect(first.json()).toMatchObject({ status: 'completed', idempotent: false });
    expect(second.json()).toMatchObject({ status: 'completed', idempotent: true });

    const aBal = await harness.app.inject({
      method: 'GET',
      url: `/accounts/${a.accountId}/balance`,
      headers: { authorization: `Bearer ${a.apiKey}` },
    });
    expect(aBal.json()).toMatchObject({
      balance: { amount: '400', currency: 'USD' },
    });
  });
});

describe('GET /transfers/:transferId', () => {
  it('returns transfer status for the caller’s account', async () => {
    const a = await createAccountViaApi('A', 'USD');
    const b = await createAccountViaApi('B', 'USD');
    await harness.app.inject({
      method: 'POST',
      url: `/accounts/${a.accountId}/deposits`,
      headers: { authorization: `Bearer ${a.apiKey}` },
      payload: { amount: '500', currency: 'USD', reference: 'seed' },
    });
    const transferId = '22222222-3333-4444-8555-666666666666';
    await harness.app.inject({
      method: 'POST',
      url: '/transfers',
      headers: { authorization: `Bearer ${a.apiKey}` },
      payload: {
        fromAccountId: a.accountId,
        toAccountId: b.accountId,
        amount: '50',
        currency: 'USD',
        transferId,
      },
    });
    const res = await harness.app.inject({
      method: 'GET',
      url: `/transfers/${transferId}`,
      headers: { authorization: `Bearer ${a.apiKey}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ transferId, status: 'completed' });
  });

  it('returns 404 when transferId is unknown to the caller', async () => {
    const a = await createAccountViaApi('A', 'USD');
    const res = await harness.app.inject({
      method: 'GET',
      url: '/transfers/77777777-8888-4999-baaa-bbbbbbbbbbbb',
      headers: { authorization: `Bearer ${a.apiKey}` },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('GET /admin/reconcile', () => {
  it('requires admin key', async () => {
    const res = await harness.app.inject({
      method: 'GET',
      url: '/admin/reconcile',
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects a non-admin account key', async () => {
    const a = await createAccountViaApi('A', 'USD');
    const res = await harness.app.inject({
      method: 'GET',
      url: '/admin/reconcile',
      headers: { authorization: `Bearer ${a.apiKey}` },
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns ok=true after honest activity', async () => {
    const a = await createAccountViaApi('A', 'USD');
    const b = await createAccountViaApi('B', 'USD');
    await harness.app.inject({
      method: 'POST',
      url: `/accounts/${a.accountId}/deposits`,
      headers: { authorization: `Bearer ${a.apiKey}` },
      payload: { amount: '500', currency: 'USD', reference: 'seed' },
    });
    await harness.app.inject({
      method: 'POST',
      url: '/transfers',
      headers: { authorization: `Bearer ${a.apiKey}` },
      payload: {
        fromAccountId: a.accountId,
        toAccountId: b.accountId,
        amount: '120',
        currency: 'USD',
      },
    });
    const res = await harness.app.inject({
      method: 'GET',
      url: '/admin/reconcile',
      headers: { authorization: `Bearer ${ADMIN_KEY}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      ok: boolean;
      integrity: { ok: boolean };
      findings: unknown[];
    };
    expect(body.ok).toBe(true);
    expect(body.integrity.ok).toBe(true);
    expect(body.findings).toEqual([]);
  });
});
