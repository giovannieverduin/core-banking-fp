import { describe, expect, it } from 'vitest';
import { newAccountId } from '../src/domain/account-id.js';
import {
  createAccount,
  depositMoney,
} from '../src/domain/commands.js';
import { Money } from '../src/domain/money.js';
import { SqliteEventStore } from '../src/events/sqlite-event-store.js';
import { balanceOf } from '../src/ledger/balance-projection.js';
import {
  projectLedgerFromStore,
  balanceFor,
} from '../src/ledger/ledger-projection.js';
import { assertBooksBalance } from '../src/ledger/trial-balance.js';
import { customerRef, systemRef } from '../src/ledger/account-ref.js';
import {
  TransferInputError,
  executeTransfer,
} from '../src/transactions/transfer.js';
import { newTransferId } from '../src/transactions/transfer-id.js';
import { fixedLimitPolicy } from '../src/ledger/overdraft-policy.js';

async function seedTwoAccounts(
  fromBalance: string,
  toBalance: string,
): Promise<{
  store: SqliteEventStore;
  from: Awaited<ReturnType<typeof createAccount>>;
  to: Awaited<ReturnType<typeof createAccount>>;
}> {
  const store = await SqliteEventStore.open();
  const from = await createAccount(store, { owner: 'Alice', currency: 'USD' });
  const to = await createAccount(store, { owner: 'Bob', currency: 'USD' });
  await depositMoney(store, {
    accountId: from,
    amount: Money.of(fromBalance, 'USD'),
    reference: 'a-seed',
  });
  if (toBalance !== '0') {
    await depositMoney(store, {
      accountId: to,
      amount: Money.of(toBalance, 'USD'),
      reference: 'b-seed',
    });
  }
  return { store, from, to };
}

describe('executeTransfer - happy path', () => {
  it('moves money from source to destination and balances books', async () => {
    const { store, from, to } = await seedTwoAccounts('500', '100');

    const outcome = await executeTransfer(store, {
      fromAccountId: from,
      toAccountId: to,
      amount: Money.of('200', 'USD'),
    });

    expect(outcome.status).toBe('completed');
    expect(outcome.idempotent).toBe(false);

    const fromBalance = await balanceOf(store, from);
    const toBalance = await balanceOf(store, to);
    expect(fromBalance.equals(Money.of('300', 'USD'))).toBe(true);
    expect(toBalance.equals(Money.of('300', 'USD'))).toBe(true);

    const ledger = await projectLedgerFromStore(store);
    assertBooksBalance(ledger);
    // Suspense nets to zero on a completed transfer.
    const suspense = balanceFor(ledger, systemRef('suspense', 'USD'));
    expect(suspense!.isZero()).toBe(true);
    // Ledger balances agree with Layer-1.
    expect(balanceFor(ledger, customerRef(from))!.equals(fromBalance)).toBe(true);
    expect(balanceFor(ledger, customerRef(to))!.equals(toBalance)).toBe(true);
  });

  it('writes three events (Initiated, Received, Completed) atomically', async () => {
    const { store, from, to } = await seedTwoAccounts('100', '0');
    await executeTransfer(store, {
      fromAccountId: from,
      toAccountId: to,
      amount: Money.of('40', 'USD'),
    });
    const fromEvents = await store.readStream(from);
    const toEvents = await store.readStream(to);
    const fromTypes = fromEvents.map((e) => e.payload.type);
    const toTypes = toEvents.map((e) => e.payload.type);
    expect(fromTypes).toEqual([
      'AccountCreated',
      'MoneyDeposited',
      'TransferInitiated',
      'TransferCompleted',
    ]);
    expect(toTypes).toEqual(['AccountCreated', 'TransferReceived']);
  });

  it('preserves global sequence order: Initiated -> Received -> Completed', async () => {
    const { store, from, to } = await seedTwoAccounts('100', '0');
    await executeTransfer(store, {
      fromAccountId: from,
      toAccountId: to,
      amount: Money.of('20', 'USD'),
    });
    const all = await store.readAll();
    const transferEvents = all.filter((e) =>
      ['TransferInitiated', 'TransferReceived', 'TransferCompleted'].includes(
        e.payload.type,
      ),
    );
    expect(transferEvents.map((e) => e.payload.type)).toEqual([
      'TransferInitiated',
      'TransferReceived',
      'TransferCompleted',
    ]);
  });
});

describe('executeTransfer - rejections', () => {
  it('rejects same-account transfer with a TransferRejected event', async () => {
    const { store, from } = await seedTwoAccounts('100', '0');
    const outcome = await executeTransfer(store, {
      fromAccountId: from,
      toAccountId: from,
      amount: Money.of('10', 'USD'),
    });
    expect(outcome.status).toBe('rejected');
    if (outcome.status === 'rejected') {
      expect(outcome.reason).toMatch(/differ/i);
    }
    const events = await store.readStream(from);
    expect(events.at(-1)!.payload.type).toBe('TransferRejected');
    // Balance unchanged
    expect((await balanceOf(store, from)).equals(Money.of('100', 'USD'))).toBe(true);
  });

  it('rejects when destination does not exist', async () => {
    const { store, from } = await seedTwoAccounts('100', '0');
    const outcome = await executeTransfer(store, {
      fromAccountId: from,
      toAccountId: newAccountId(),
      amount: Money.of('10', 'USD'),
    });
    expect(outcome.status).toBe('rejected');
    if (outcome.status === 'rejected') {
      expect(outcome.reason).toMatch(/destination/i);
    }
    // Source untouched
    expect((await balanceOf(store, from)).equals(Money.of('100', 'USD'))).toBe(true);
  });

  it('rejects when currencies differ between accounts', async () => {
    const store = await SqliteEventStore.open();
    const from = await createAccount(store, { owner: 'A', currency: 'USD' });
    const to = await createAccount(store, { owner: 'B', currency: 'EUR' });
    await depositMoney(store, {
      accountId: from,
      amount: Money.of('100', 'USD'),
      reference: 'seed',
    });
    const outcome = await executeTransfer(store, {
      fromAccountId: from,
      toAccountId: to,
      amount: Money.of('10', 'USD'),
    });
    expect(outcome.status).toBe('rejected');
  });

  it('rejects when overdraft policy blocks', async () => {
    const { store, from, to } = await seedTwoAccounts('10', '0');
    const outcome = await executeTransfer(store, {
      fromAccountId: from,
      toAccountId: to,
      amount: Money.of('100', 'USD'),
    });
    expect(outcome.status).toBe('rejected');
    if (outcome.status === 'rejected') {
      expect(outcome.reason).toMatch(/hard-reject|insufficient/i);
    }
    // Books still balance after a rejection
    const ledger = await projectLedgerFromStore(store);
    assertBooksBalance(ledger);
  });

  it('allows overdraft with FixedLimit policy', async () => {
    const { store, from, to } = await seedTwoAccounts('10', '0');
    const outcome = await executeTransfer(store, {
      fromAccountId: from,
      toAccountId: to,
      amount: Money.of('40', 'USD'),
      overdraftPolicy: fixedLimitPolicy(Money.of('50', 'USD')),
    });
    expect(outcome.status).toBe('completed');
    expect((await balanceOf(store, from)).equals(Money.of('-30', 'USD'))).toBe(true);
    expect((await balanceOf(store, to)).equals(Money.of('40', 'USD'))).toBe(true);
  });

  it('throws on zero or negative amount', async () => {
    const { store, from, to } = await seedTwoAccounts('100', '0');
    await expect(
      executeTransfer(store, {
        fromAccountId: from,
        toAccountId: to,
        amount: Money.of('0', 'USD'),
      }),
    ).rejects.toBeInstanceOf(TransferInputError);
    await expect(
      executeTransfer(store, {
        fromAccountId: from,
        toAccountId: to,
        amount: Money.of('-5', 'USD'),
      }),
    ).rejects.toBeInstanceOf(TransferInputError);
  });

  it('throws on unknown source account', async () => {
    const store = await SqliteEventStore.open();
    const to = await createAccount(store, { owner: 'B', currency: 'USD' });
    await expect(
      executeTransfer(store, {
        fromAccountId: newAccountId(),
        toAccountId: to,
        amount: Money.of('1', 'USD'),
      }),
    ).rejects.toBeInstanceOf(TransferInputError);
  });
});

describe('executeTransfer - idempotency', () => {
  it('replaying the same completed transferId returns the same outcome without side effects', async () => {
    const { store, from, to } = await seedTwoAccounts('500', '0');
    const transferId = newTransferId();
    const first = await executeTransfer(store, {
      fromAccountId: from,
      toAccountId: to,
      amount: Money.of('100', 'USD'),
      transferId,
    });
    expect(first.status).toBe('completed');
    expect(first.idempotent).toBe(false);

    const fromAfterFirst = await balanceOf(store, from);
    const toAfterFirst = await balanceOf(store, to);

    const second = await executeTransfer(store, {
      fromAccountId: from,
      toAccountId: to,
      amount: Money.of('100', 'USD'),
      transferId,
    });
    expect(second.status).toBe('completed');
    expect(second.idempotent).toBe(true);
    expect(second.transferId).toBe(transferId);

    // No double-debit
    expect((await balanceOf(store, from)).equals(fromAfterFirst)).toBe(true);
    expect((await balanceOf(store, to)).equals(toAfterFirst)).toBe(true);
  });

  it('replaying a rejected transferId returns the same rejection', async () => {
    const { store, from, to } = await seedTwoAccounts('5', '0');
    const transferId = newTransferId();
    const first = await executeTransfer(store, {
      fromAccountId: from,
      toAccountId: to,
      amount: Money.of('999', 'USD'),
      transferId,
    });
    expect(first.status).toBe('rejected');

    const second = await executeTransfer(store, {
      fromAccountId: from,
      toAccountId: to,
      amount: Money.of('999', 'USD'),
      transferId,
    });
    expect(second.status).toBe('rejected');
    expect(second.idempotent).toBe(true);
    if (first.status === 'rejected' && second.status === 'rejected') {
      expect(second.reason).toBe(first.reason);
    }
  });

  it('different transferIds for identical payloads execute independently', async () => {
    const { store, from, to } = await seedTwoAccounts('500', '0');
    await executeTransfer(store, {
      fromAccountId: from,
      toAccountId: to,
      amount: Money.of('100', 'USD'),
    });
    await executeTransfer(store, {
      fromAccountId: from,
      toAccountId: to,
      amount: Money.of('100', 'USD'),
    });
    expect((await balanceOf(store, from)).equals(Money.of('300', 'USD'))).toBe(true);
    expect((await balanceOf(store, to)).equals(Money.of('200', 'USD'))).toBe(true);
  });
});

describe('executeTransfer - invariants', () => {
  it('books balance globally after a mixed sequence', async () => {
    const { store, from, to } = await seedTwoAccounts('500', '50');
    await executeTransfer(store, {
      fromAccountId: from,
      toAccountId: to,
      amount: Money.of('120.50', 'USD'),
    });
    await executeTransfer(store, {
      fromAccountId: to,
      toAccountId: from,
      amount: Money.of('15.25', 'USD'),
    });
    // A rejected attempt
    await executeTransfer(store, {
      fromAccountId: from,
      toAccountId: to,
      amount: Money.of('9999', 'USD'),
    });

    const ledger = await projectLedgerFromStore(store);
    assertBooksBalance(ledger);
    const suspense = balanceFor(ledger, systemRef('suspense', 'USD'));
    expect(suspense!.isZero()).toBe(true);

    // Source: 500 - 120.50 + 15.25 = 394.75
    // Dest:    50 + 120.50 - 15.25 = 155.25
    expect((await balanceOf(store, from)).equals(Money.of('394.75', 'USD'))).toBe(
      true,
    );
    expect((await balanceOf(store, to)).equals(Money.of('155.25', 'USD'))).toBe(
      true,
    );
  });
});
