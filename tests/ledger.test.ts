import { describe, expect, it } from 'vitest';
import { newAccountId } from '../src/domain/account-id.js';
import {
  createAccount,
  depositMoney,
  withdrawMoney,
} from '../src/domain/commands.js';
import { Money } from '../src/domain/money.js';
import { balanceOf } from '../src/ledger/balance-projection.js';
import { SqliteEventStore } from '../src/events/sqlite-event-store.js';
import {
  customerRef,
  systemRef,
} from '../src/ledger/account-ref.js';
import {
  balanceFor,
  projectLedger,
  projectLedgerFromStore,
} from '../src/ledger/ledger-projection.js';
import { eventToJournal } from '../src/ledger/posting-rules.js';
import { assertBooksBalance, trialBalance } from '../src/ledger/trial-balance.js';
import type { AccountEvent } from '../src/events/types.js';

describe('Layer 2: double-entry ledger', () => {
  it('every deposit produces matched debit + credit entries', async () => {
    const store = await SqliteEventStore.open();
    const id = await createAccount(store, { owner: 'Gio', currency: 'USD' });
    await depositMoney(store, {
      accountId: id,
      amount: Money.of('100', 'USD'),
      reference: 'seed',
    });

    const state = await projectLedgerFromStore(store);
    expect(state.journals).toHaveLength(1);
    const journal = state.journals[0]!;
    expect(journal.entries.map((e) => e.side).sort()).toEqual(['credit', 'debit']);
    expect(() => assertBooksBalance(state)).not.toThrow();
  });

  it('books balance after a mixed series of operations', async () => {
    const store = await SqliteEventStore.open();
    const a = await createAccount(store, { owner: 'Alice', currency: 'USD' });
    const b = await createAccount(store, { owner: 'Bob', currency: 'EUR' });

    await depositMoney(store, {
      accountId: a,
      amount: Money.of('500', 'USD'),
      reference: 'a-seed',
    });
    await depositMoney(store, {
      accountId: b,
      amount: Money.of('300', 'EUR'),
      reference: 'b-seed',
    });
    await withdrawMoney(store, {
      accountId: a,
      amount: Money.of('120.50', 'USD'),
      reference: 'a-out',
    });

    const state = await projectLedgerFromStore(store);
    assertBooksBalance(state);
    const rows = trialBalance(state);
    for (const row of rows) expect(row.difference.isZero()).toBe(true);
  });

  it('customer-account balance matches Layer-1 balance projection', async () => {
    const store = await SqliteEventStore.open();
    const id = await createAccount(store, { owner: 'Gio', currency: 'USD' });
    await depositMoney(store, {
      accountId: id,
      amount: Money.of('1000', 'USD'),
      reference: 'opening',
    });
    await depositMoney(store, {
      accountId: id,
      amount: Money.of('250.25', 'USD'),
      reference: 'salary',
    });
    await withdrawMoney(store, {
      accountId: id,
      amount: Money.of('100.10', 'USD'),
      reference: 'rent',
    });

    const layer1Balance = await balanceOf(store, id);
    const ledger = await projectLedgerFromStore(store);
    const ledgerBalance = balanceFor(ledger, customerRef(id));
    expect(ledgerBalance).not.toBeNull();
    expect(ledgerBalance!.equals(layer1Balance)).toBe(true);
    expect(ledgerBalance!.equals(Money.of('1150.15', 'USD'))).toBe(true);
  });

  it('cash-in system account accumulates the source side', async () => {
    const store = await SqliteEventStore.open();
    const id = await createAccount(store, { owner: 'Gio', currency: 'USD' });
    await depositMoney(store, {
      accountId: id,
      amount: Money.of('40', 'USD'),
      reference: 'r1',
    });
    await depositMoney(store, {
      accountId: id,
      amount: Money.of('60', 'USD'),
      reference: 'r2',
    });
    const ledger = await projectLedgerFromStore(store);
    const cashIn = balanceFor(ledger, systemRef('cash-in', 'USD'));
    expect(cashIn).not.toBeNull();
    expect(cashIn!.equals(Money.of('100', 'USD'))).toBe(true);
  });

  it('every event-derived journal is internally balanced', () => {
    const a = newAccountId();
    const b = newAccountId();
    const events: AccountEvent[] = [
      {
        metadata: { eventId: 'e1', aggregateId: a, version: 1, occurredAt: '' },
        payload: { type: 'AccountCreated', accountId: a, owner: 'A', currency: 'USD' },
      },
      {
        metadata: { eventId: 'e2', aggregateId: a, version: 2, occurredAt: '' },
        payload: {
          type: 'MoneyDeposited',
          accountId: a,
          amount: '50',
          currency: 'USD',
          reference: 'r',
        },
      },
      {
        metadata: { eventId: 'e3', aggregateId: a, version: 3, occurredAt: '' },
        payload: {
          type: 'TransferInitiated',
          accountId: a,
          transferId: 't1' as never,
          counterpartyAccountId: b,
          amount: '20',
          currency: 'USD',
        },
      },
      {
        metadata: { eventId: 'e4', aggregateId: a, version: 4, occurredAt: '' },
        payload: {
          type: 'TransferCompleted',
          accountId: a,
          transferId: 't1' as never,
          counterpartyAccountId: b,
          amount: '20',
          currency: 'USD',
        },
      },
    ];
    for (const e of events) {
      const journal = eventToJournal(e);
      if (journal.entries.length === 0) continue;
      const debit = journal.entries
        .filter((x) => x.side === 'debit')
        .reduce((acc, x) => acc.add(x.amount), Money.zero('USD'));
      const credit = journal.entries
        .filter((x) => x.side === 'credit')
        .reduce((acc, x) => acc.add(x.amount), Money.zero('USD'));
      expect(debit.equals(credit)).toBe(true);
    }
  });

  it('books balance globally across the full stream', () => {
    const a = newAccountId();
    const events: AccountEvent[] = [
      {
        metadata: { eventId: 'x1', aggregateId: a, version: 1, occurredAt: '' },
        payload: { type: 'AccountCreated', accountId: a, owner: 'A', currency: 'USD' },
      },
      {
        metadata: { eventId: 'x2', aggregateId: a, version: 2, occurredAt: '' },
        payload: {
          type: 'MoneyDeposited',
          accountId: a,
          amount: '100',
          currency: 'USD',
          reference: 'r',
        },
      },
    ];
    const state = projectLedger(events);
    assertBooksBalance(state);
    expect(trialBalance(state).every((r) => r.difference.isZero())).toBe(true);
  });
});
