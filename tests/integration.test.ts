import { describe, expect, it } from 'vitest';
import {
  CommandError,
  createAccount,
  depositMoney,
  withdrawMoney,
} from '../src/domain/commands.js';
import { Money } from '../src/domain/money.js';
import { SqliteEventStore } from '../src/events/sqlite-event-store.js';
import {
  UnknownAccountError,
  balanceOf,
} from '../src/ledger/balance-projection.js';
import { newAccountId } from '../src/domain/account-id.js';

describe('Layer 1 integration: create account, deposit, read balance', () => {
  it('derives balance purely from the event log', async () => {
    const store = await SqliteEventStore.open();

    const accountId = await createAccount(store, {
      owner: 'Giovanni Everduin',
      currency: 'USD',
    });

    await depositMoney(store, {
      accountId,
      amount: Money.of('1000.00', 'USD'),
      reference: 'opening',
    });
    await depositMoney(store, {
      accountId,
      amount: Money.of('250.25', 'USD'),
      reference: 'salary',
    });
    await withdrawMoney(store, {
      accountId,
      amount: Money.of('100.10', 'USD'),
      reference: 'rent',
    });

    const balance = await balanceOf(store, accountId);
    expect(balance.equals(Money.of('1150.15', 'USD'))).toBe(true);

    const events = await store.readStream(accountId);
    expect(events.map((e) => e.payload.type)).toEqual([
      'AccountCreated',
      'MoneyDeposited',
      'MoneyDeposited',
      'MoneyWithdrawn',
    ]);
    // Versions are contiguous, starting at 1.
    expect(events.map((e) => e.metadata.version)).toEqual([1, 2, 3, 4]);
  });

  it('refuses to deposit on an unknown account', async () => {
    const store = await SqliteEventStore.open();
    await expect(
      depositMoney(store, {
        accountId: newAccountId(),
        amount: Money.of(1, 'USD'),
        reference: 'x',
      }),
    ).rejects.toBeInstanceOf(CommandError);
  });

  it('refuses zero and negative deposits', async () => {
    const store = await SqliteEventStore.open();
    const accountId = await createAccount(store, { owner: 'Gio', currency: 'USD' });
    await expect(
      depositMoney(store, {
        accountId,
        amount: Money.of(0, 'USD'),
        reference: 'x',
      }),
    ).rejects.toBeInstanceOf(CommandError);
    await expect(
      depositMoney(store, {
        accountId,
        amount: Money.of(-5, 'USD'),
        reference: 'x',
      }),
    ).rejects.toBeInstanceOf(CommandError);
  });

  it('refuses withdrawals beyond the balance (default hard-reject)', async () => {
    const store = await SqliteEventStore.open();
    const accountId = await createAccount(store, { owner: 'Gio', currency: 'USD' });
    await depositMoney(store, {
      accountId,
      amount: Money.of(10, 'USD'),
      reference: 'seed',
    });
    await expect(
      withdrawMoney(store, {
        accountId,
        amount: Money.of(20, 'USD'),
        reference: 'oops',
      }),
    ).rejects.toBeInstanceOf(CommandError);
    const balance = await balanceOf(store, accountId);
    expect(balance.equals(Money.of(10, 'USD'))).toBe(true);
  });

  it('refuses deposits in the wrong currency', async () => {
    const store = await SqliteEventStore.open();
    const accountId = await createAccount(store, { owner: 'Gio', currency: 'USD' });
    await expect(
      depositMoney(store, {
        accountId,
        amount: Money.of(10, 'EUR'),
        reference: 'x',
      }),
    ).rejects.toBeInstanceOf(CommandError);
  });

  it('balanceOf throws UnknownAccountError for unknown account', async () => {
    const store = await SqliteEventStore.open();
    await expect(balanceOf(store, newAccountId())).rejects.toBeInstanceOf(
      UnknownAccountError,
    );
  });
});
