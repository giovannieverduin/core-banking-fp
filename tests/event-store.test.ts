import { describe, expect, it } from 'vitest';
import { newAccountId } from '../src/domain/account-id.js';
import { ConcurrencyError } from '../src/events/event-store.js';
import { SqliteEventStore } from '../src/events/sqlite-event-store.js';

describe('SqliteEventStore', () => {
  it('appends and reads back events in version order', async () => {
    const store = await SqliteEventStore.open();
    const accountId = newAccountId();
    await store.append([
      {
        aggregateId: accountId,
        expectedVersion: 0,
        payload: {
          type: 'AccountCreated',
          accountId,
          owner: 'Gio',
          currency: 'USD',
        },
      },
    ]);
    await store.append([
      {
        aggregateId: accountId,
        expectedVersion: 1,
        payload: {
          type: 'MoneyDeposited',
          accountId,
          amount: '100',
          currency: 'USD',
          reference: 'seed',
        },
      },
    ]);

    const events = await store.readStream(accountId);
    expect(events.map((e) => e.metadata.version)).toEqual([1, 2]);
    expect(events.map((e) => e.payload.type)).toEqual([
      'AccountCreated',
      'MoneyDeposited',
    ]);
  });

  it('rejects append with stale expected version', async () => {
    const store = await SqliteEventStore.open();
    const accountId = newAccountId();
    await store.append([
      {
        aggregateId: accountId,
        expectedVersion: 0,
        payload: {
          type: 'AccountCreated',
          accountId,
          owner: 'Gio',
          currency: 'USD',
        },
      },
    ]);

    await expect(
      store.append([
        {
          aggregateId: accountId,
          expectedVersion: 0,
          payload: {
            type: 'MoneyDeposited',
            accountId,
            amount: '50',
            currency: 'USD',
            reference: 'x',
          },
        },
      ]),
    ).rejects.toBeInstanceOf(ConcurrencyError);
  });

  it('readAll returns events in global insertion order', async () => {
    const store = await SqliteEventStore.open();
    const a = newAccountId();
    const b = newAccountId();
    await store.append([
      {
        aggregateId: a,
        expectedVersion: 0,
        payload: { type: 'AccountCreated', accountId: a, owner: 'A', currency: 'USD' },
      },
    ]);
    await store.append([
      {
        aggregateId: b,
        expectedVersion: 0,
        payload: { type: 'AccountCreated', accountId: b, owner: 'B', currency: 'EUR' },
      },
    ]);
    await store.append([
      {
        aggregateId: a,
        expectedVersion: 1,
        payload: {
          type: 'MoneyDeposited',
          accountId: a,
          amount: '10',
          currency: 'USD',
          reference: 'r',
        },
      },
    ]);

    const all = await store.readAll();
    expect(all.map((e) => e.metadata.aggregateId)).toEqual([a, b, a]);
  });

  it('currentVersion returns 0 for unknown aggregate', async () => {
    const store = await SqliteEventStore.open();
    const v = await store.currentVersion(newAccountId());
    expect(v).toBe(0);
  });
});
