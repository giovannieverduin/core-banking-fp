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
  HardRejectPolicy,
  fixedLimitPolicy,
} from '../src/ledger/overdraft-policy.js';
import { balanceOf } from '../src/ledger/balance-projection.js';

async function seedAccount(): Promise<{
  store: SqliteEventStore;
  accountId: Awaited<ReturnType<typeof createAccount>>;
}> {
  const store = await SqliteEventStore.open();
  const accountId = await createAccount(store, {
    owner: 'Gio',
    currency: 'USD',
  });
  await depositMoney(store, {
    accountId,
    amount: Money.of('100', 'USD'),
    reference: 'seed',
  });
  return { store, accountId };
}

describe('OverdraftPolicy', () => {
  it('HardReject (default) blocks any negative balance', async () => {
    const { store, accountId } = await seedAccount();
    await expect(
      withdrawMoney(store, {
        accountId,
        amount: Money.of('150', 'USD'),
        reference: 'over',
      }),
    ).rejects.toBeInstanceOf(CommandError);
    const balance = await balanceOf(store, accountId);
    expect(balance.equals(Money.of('100', 'USD'))).toBe(true);
  });

  it('FixedLimit allows withdrawal into the granted overdraft', async () => {
    const { store, accountId } = await seedAccount();
    await withdrawMoney(store, {
      accountId,
      amount: Money.of('150', 'USD'),
      reference: 'lit',
      overdraftPolicy: fixedLimitPolicy(Money.of('200', 'USD')),
    });
    const balance = await balanceOf(store, accountId);
    expect(balance.equals(Money.of('-50', 'USD'))).toBe(true);
  });

  it('FixedLimit rejects when projected balance crosses the floor', async () => {
    const { store, accountId } = await seedAccount();
    await expect(
      withdrawMoney(store, {
        accountId,
        amount: Money.of('400', 'USD'),
        reference: 'too-much',
        overdraftPolicy: fixedLimitPolicy(Money.of('200', 'USD')),
      }),
    ).rejects.toBeInstanceOf(CommandError);
  });

  it('FixedLimit refuses construction with a negative limit', () => {
    expect(() => fixedLimitPolicy(Money.of('-1', 'USD'))).toThrow();
  });

  it('FixedLimit refuses to authorize when policy currency differs', async () => {
    const { store, accountId } = await seedAccount();
    await expect(
      withdrawMoney(store, {
        accountId,
        amount: Money.of('150', 'USD'),
        reference: 'wrong-ccy',
        overdraftPolicy: fixedLimitPolicy(Money.of('200', 'EUR')),
      }),
    ).rejects.toBeInstanceOf(CommandError);
  });

  it('HardReject rejects mismatched-currency withdrawal explicitly', async () => {
    const { store, accountId } = await seedAccount();
    // We bypass the prior currency guard by going through the policy directly.
    const policy = HardRejectPolicy;
    const decision = policy.authorize(
      {
        id: accountId,
        owner: 'Gio',
        currency: 'USD',
        balance: Money.of('100', 'USD'),
        version: 1,
        exists: true,
      },
      Money.of('1', 'EUR'),
    );
    expect(decision.ok).toBe(false);
  });
});
