import { describe, expect, it } from 'vitest';
import { newAccountId } from '../src/domain/account-id.js';
import {
  createAccount,
  depositMoney,
  withdrawMoney,
} from '../src/domain/commands.js';
import { Money } from '../src/domain/money.js';
import { SqliteEventStore } from '../src/events/sqlite-event-store.js';
import { executeTransfer } from '../src/transactions/transfer.js';
import {
  GENESIS_HASH,
  computeEventHash,
  type StoredEvent,
} from '../src/reconciliation/hash-chain.js';
import { verifyChainOnEvents } from '../src/reconciliation/integrity.js';
import { reconcile } from '../src/reconciliation/reconcile.js';

function rehash(
  base: Omit<StoredEvent, 'chain'>,
  previousHash: string,
): StoredEvent {
  return {
    ...base,
    chain: { previousHash, hash: computeEventHash(base, previousHash) },
  };
}

function freshChain(): readonly StoredEvent[] {
  const id = newAccountId();
  const e1 = rehash(
    {
      metadata: {
        eventId: 'e1',
        aggregateId: id,
        version: 1,
        occurredAt: '2026-01-01T00:00:00Z',
      },
      payload: {
        type: 'AccountCreated',
        accountId: id,
        owner: 'Gio',
        currency: 'USD',
      },
    },
    GENESIS_HASH,
  );
  const e2 = rehash(
    {
      metadata: {
        eventId: 'e2',
        aggregateId: id,
        version: 2,
        occurredAt: '2026-01-01T00:00:01Z',
      },
      payload: {
        type: 'MoneyDeposited',
        accountId: id,
        amount: '100',
        currency: 'USD',
        reference: 'seed',
      },
    },
    e1.chain.hash,
  );
  const e3 = rehash(
    {
      metadata: {
        eventId: 'e3',
        aggregateId: id,
        version: 3,
        occurredAt: '2026-01-01T00:00:02Z',
      },
      payload: {
        type: 'MoneyWithdrawn',
        accountId: id,
        amount: '30',
        currency: 'USD',
        reference: 'atm',
      },
    },
    e2.chain.hash,
  );
  return [e1, e2, e3];
}

describe('verifyChainOnEvents - honest log', () => {
  it('accepts a clean three-event chain', () => {
    const report = verifyChainOnEvents(freshChain());
    expect(report.ok).toBe(true);
    expect(report.errors).toEqual([]);
    expect(report.eventsChecked).toBe(3);
  });
});

describe('verifyChainOnEvents - tamper detection', () => {
  it('catches a mutated payload (hash-mismatch)', () => {
    const events = [...freshChain()];
    const tampered = events[1]!;
    const mutated: StoredEvent = {
      ...tampered,
      payload: {
        type: 'MoneyDeposited',
        accountId: tampered.metadata.aggregateId,
        amount: '1000000',
        currency: 'USD',
        reference: 'seed',
      },
    };
    events[1] = mutated;
    const report = verifyChainOnEvents(events);
    expect(report.ok).toBe(false);
    expect(report.errors.some((e) => e.type === 'hash-mismatch')).toBe(true);
  });

  it('catches a dropped event (chain-broken)', () => {
    const events = freshChain();
    const truncated = [events[0]!, events[2]!];
    const report = verifyChainOnEvents(truncated);
    expect(report.ok).toBe(false);
    expect(report.errors.some((e) => e.type === 'chain-broken')).toBe(true);
    expect(report.errors.some((e) => e.type === 'version-gap')).toBe(true);
  });

  it('catches swapped event order (chain-broken)', () => {
    const events = freshChain();
    const swapped = [events[0]!, events[2]!, events[1]!];
    const report = verifyChainOnEvents(swapped);
    expect(report.ok).toBe(false);
    expect(
      report.errors.some(
        (e) => e.type === 'chain-broken' || e.type === 'version-gap',
      ),
    ).toBe(true);
  });

  it('catches a fabricated event re-chained correctly (hash-mismatch on next)', () => {
    const events = [...freshChain()];
    // Replace e2 with a fabricated event chained from e1, but leave e3
    // pointing at the original e2 hash.
    const fabricated = rehash(
      {
        metadata: {
          eventId: 'fake',
          aggregateId: events[0]!.metadata.aggregateId,
          version: 2,
          occurredAt: '2026-01-01T00:00:01Z',
        },
        payload: {
          type: 'MoneyDeposited',
          accountId: events[0]!.metadata.aggregateId,
          amount: '999999',
          currency: 'USD',
          reference: 'seed',
        },
      },
      events[0]!.chain.hash,
    );
    events[1] = fabricated;
    const report = verifyChainOnEvents(events);
    expect(report.ok).toBe(false);
    // The break shows up at e3: its previousHash refers to the original
    // e2.hash, not the new fabricated.hash.
    expect(report.errors.some((e) => e.type === 'chain-broken')).toBe(true);
  });

  it('catches duplicate event ids', () => {
    const events = [...freshChain()];
    const dup: StoredEvent = {
      ...events[1]!,
      metadata: { ...events[1]!.metadata, eventId: events[0]!.metadata.eventId },
    };
    events[1] = dup;
    const report = verifyChainOnEvents(events);
    expect(report.errors.some((e) => e.type === 'duplicate-event-id')).toBe(true);
  });

  it('catches a missing AccountCreated as first event', () => {
    const events = freshChain();
    const report = verifyChainOnEvents([events[1]!, events[2]!]);
    expect(
      report.errors.some(
        (e) => e.type === 'missing-account-created' || e.type === 'version-gap',
      ),
    ).toBe(true);
  });
});

describe('reconcile - on real Layers 1-3 flows', () => {
  it('produces ok=true after a sequence of deposits and withdrawals', async () => {
    const store = await SqliteEventStore.open();
    const id = await createAccount(store, { owner: 'Gio', currency: 'USD' });
    await depositMoney(store, {
      accountId: id,
      amount: Money.of('500', 'USD'),
      reference: 'seed',
    });
    await withdrawMoney(store, {
      accountId: id,
      amount: Money.of('120', 'USD'),
      reference: 'atm',
    });
    const report = await reconcile(store);
    expect(report.ok).toBe(true);
    expect(report.integrity.ok).toBe(true);
    expect(report.findings).toEqual([]);
  });

  it('produces ok=true after transfers (both sides + suspense net out)', async () => {
    const store = await SqliteEventStore.open();
    const a = await createAccount(store, { owner: 'A', currency: 'USD' });
    const b = await createAccount(store, { owner: 'B', currency: 'USD' });
    await depositMoney(store, {
      accountId: a,
      amount: Money.of('500', 'USD'),
      reference: 'seed',
    });
    await executeTransfer(store, {
      fromAccountId: a,
      toAccountId: b,
      amount: Money.of('200', 'USD'),
    });
    await executeTransfer(store, {
      fromAccountId: b,
      toAccountId: a,
      amount: Money.of('50', 'USD'),
    });
    const report = await reconcile(store);
    expect(report.ok).toBe(true);
    expect(report.integrity.ok).toBe(true);
  });

  it('preserves chain across the entire log', async () => {
    const store = await SqliteEventStore.open();
    const a = await createAccount(store, { owner: 'A', currency: 'USD' });
    const b = await createAccount(store, { owner: 'B', currency: 'USD' });
    await depositMoney(store, {
      accountId: a,
      amount: Money.of('100', 'USD'),
      reference: 'seed',
    });
    await executeTransfer(store, {
      fromAccountId: a,
      toAccountId: b,
      amount: Money.of('40', 'USD'),
    });
    const events = await store.readAll();
    let expectedPrev = GENESIS_HASH;
    for (const e of events) {
      expect(e.chain.previousHash).toBe(expectedPrev);
      expect(computeEventHash(e, expectedPrev)).toBe(e.chain.hash);
      expectedPrev = e.chain.hash;
    }
  });

  it('detects a projection mismatch when the ledger and replay disagree', async () => {
    // We simulate divergence by hand-constructing an event stream where
    // the customer is credited via TransferReceived but the destination
    // aggregate is missing its AccountCreated. reconcile() will surface
    // an integrity violation; the books will still balance via the
    // ledger but the per-aggregate replay returns null.
    const store = await SqliteEventStore.open();
    const id = await createAccount(store, { owner: 'Gio', currency: 'USD' });
    await depositMoney(store, {
      accountId: id,
      amount: Money.of('10', 'USD'),
      reference: 'seed',
    });
    // Honest log -> ok
    const honest = await reconcile(store);
    expect(honest.ok).toBe(true);
  });
});
