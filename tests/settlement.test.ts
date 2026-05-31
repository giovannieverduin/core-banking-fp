import { describe, expect, it } from 'vitest';
import {
  createAccount,
  depositMoney,
} from '../src/domain/commands.js';
import { Money } from '../src/domain/money.js';
import { SqliteEventStore } from '../src/events/sqlite-event-store.js';
import { balanceOf } from '../src/ledger/balance-projection.js';
import {
  balanceFor,
  projectLedgerFromStore,
} from '../src/ledger/ledger-projection.js';
import {
  customerRef,
  externalRef,
  systemRef,
} from '../src/ledger/account-ref.js';
import { assertBooksBalance } from '../src/ledger/trial-balance.js';
import {
  SettlementInputError,
  requestSettlement,
} from '../src/settlement/commands.js';
import { MockSettlementAdapter } from '../src/settlement/mock-adapter.js';
import { reconcile } from '../src/reconciliation/reconcile.js';

async function seed(): Promise<{
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
    amount: Money.of('500', 'USD'),
    reference: 'seed',
  });
  return { store, accountId };
}

describe('requestSettlement - outbound happy path', () => {
  it('settles funds to the external rail and balances books', async () => {
    const { store, accountId } = await seed();
    const adapter = new MockSettlementAdapter();
    const outcome = await requestSettlement(store, adapter, {
      accountId,
      externalAccount: { rail: 'MOCK', identifier: 'iban:GB29-test' },
      amount: Money.of('120.50', 'USD'),
      direction: 'outbound',
      cycle: 'T+0',
    });
    expect(outcome.status).toBe('settled');
    expect((await balanceOf(store, accountId)).equals(Money.of('379.50', 'USD'))).toBe(
      true,
    );

    const ledger = await projectLedgerFromStore(store);
    assertBooksBalance(ledger);
    expect(
      balanceFor(ledger, systemRef('settlement-pending', 'USD'))!.isZero(),
    ).toBe(true);
    // external rail is debit-normal (asset); outbound credits it,
    // so the balance is negative - we've sent funds out of our position.
    expect(
      balanceFor(ledger, externalRef('MOCK', 'USD'))!.equals(Money.of('-120.50', 'USD')),
    ).toBe(true);
    expect(adapter.submissionCount()).toBe(1);
  });

  it('writes Initiated then Settled events on the account stream', async () => {
    const { store, accountId } = await seed();
    const adapter = new MockSettlementAdapter();
    await requestSettlement(store, adapter, {
      accountId,
      externalAccount: { rail: 'MOCK', identifier: 'iban:bob' },
      amount: Money.of('10', 'USD'),
      direction: 'outbound',
      cycle: 'T+0',
    });
    const events = await store.readStream(accountId);
    expect(events.map((e) => e.payload.type)).toEqual([
      'AccountCreated',
      'MoneyDeposited',
      'SettlementInitiated',
      'SettlementSettled',
    ]);
  });
});

describe('requestSettlement - outbound failure compensates', () => {
  it('credits the source back when the adapter rejects', async () => {
    const { store, accountId } = await seed();
    const adapter = new MockSettlementAdapter({
      failureIdentifiers: new Set(['blocked-account']),
    });
    const outcome = await requestSettlement(store, adapter, {
      accountId,
      externalAccount: { rail: 'MOCK', identifier: 'blocked-account' },
      amount: Money.of('80', 'USD'),
      direction: 'outbound',
      cycle: 'T+0',
    });
    expect(outcome.status).toBe('failed');
    // Customer balance restored
    expect((await balanceOf(store, accountId)).equals(Money.of('500', 'USD'))).toBe(
      true,
    );
    const ledger = await projectLedgerFromStore(store);
    assertBooksBalance(ledger);
    expect(
      balanceFor(ledger, systemRef('settlement-pending', 'USD'))!.isZero(),
    ).toBe(true);
    // No external balance because the failed leg compensates Initiated.
    const external = balanceFor(ledger, externalRef('MOCK', 'USD'));
    expect(external === null || external.isZero()).toBe(true);
  });

  it('event stream is Initiated then Failed (no Settled)', async () => {
    const { store, accountId } = await seed();
    const adapter = new MockSettlementAdapter({
      failureIdentifiers: new Set(['blocked']),
    });
    await requestSettlement(store, adapter, {
      accountId,
      externalAccount: { rail: 'MOCK', identifier: 'blocked' },
      amount: Money.of('10', 'USD'),
      direction: 'outbound',
      cycle: 'T+0',
    });
    const events = await store.readStream(accountId);
    expect(events.map((e) => e.payload.type)).toEqual([
      'AccountCreated',
      'MoneyDeposited',
      'SettlementInitiated',
      'SettlementFailed',
    ]);
  });
});

describe('requestSettlement - inbound', () => {
  it('credits the customer on successful settlement', async () => {
    const { store, accountId } = await seed();
    const adapter = new MockSettlementAdapter();
    const outcome = await requestSettlement(store, adapter, {
      accountId,
      externalAccount: { rail: 'MOCK', identifier: 'iban:from-payer' },
      amount: Money.of('250', 'USD'),
      direction: 'inbound',
      cycle: 'T+0',
    });
    expect(outcome.status).toBe('settled');
    expect((await balanceOf(store, accountId)).equals(Money.of('750', 'USD'))).toBe(
      true,
    );
    const ledger = await projectLedgerFromStore(store);
    assertBooksBalance(ledger);
    // External rail debited - inbound increases our nostro position.
    expect(
      balanceFor(ledger, externalRef('MOCK', 'USD'))!.equals(Money.of('250', 'USD')),
    ).toBe(true);
  });
});

describe('requestSettlement - input validation', () => {
  it('rejects amounts that are zero or negative', async () => {
    const { store, accountId } = await seed();
    const adapter = new MockSettlementAdapter();
    await expect(
      requestSettlement(store, adapter, {
        accountId,
        externalAccount: { rail: 'MOCK', identifier: 'x' },
        amount: Money.of('0', 'USD'),
        direction: 'outbound',
        cycle: 'T+0',
      }),
    ).rejects.toBeInstanceOf(SettlementInputError);
  });

  it('rejects when adapter rail does not match instruction', async () => {
    const { store, accountId } = await seed();
    const adapter = new MockSettlementAdapter({ rail: 'EVM' });
    await expect(
      requestSettlement(store, adapter, {
        accountId,
        externalAccount: { rail: 'MOCK', identifier: 'x' },
        amount: Money.of('10', 'USD'),
        direction: 'outbound',
        cycle: 'T+0',
      }),
    ).rejects.toBeInstanceOf(SettlementInputError);
  });

  it('rejects outbound when hard-reject overdraft would block', async () => {
    const { store, accountId } = await seed();
    const adapter = new MockSettlementAdapter();
    await expect(
      requestSettlement(store, adapter, {
        accountId,
        externalAccount: { rail: 'MOCK', identifier: 'x' },
        amount: Money.of('1000', 'USD'),
        direction: 'outbound',
        cycle: 'T+0',
      }),
    ).rejects.toBeInstanceOf(SettlementInputError);
    // No event on the stream
    const events = await store.readStream(accountId);
    expect(events.every((e) => !e.payload.type.startsWith('Settlement'))).toBe(true);
  });
});

describe('reconcile after settlement', () => {
  it('returns ok=true with chain intact across mixed activity', async () => {
    const { store, accountId } = await seed();
    const adapter = new MockSettlementAdapter();
    await requestSettlement(store, adapter, {
      accountId,
      externalAccount: { rail: 'MOCK', identifier: 'iban:a' },
      amount: Money.of('120', 'USD'),
      direction: 'outbound',
      cycle: 'T+0',
    });
    await requestSettlement(store, adapter, {
      accountId,
      externalAccount: { rail: 'MOCK', identifier: 'iban:b' },
      amount: Money.of('15.25', 'USD'),
      direction: 'inbound',
      cycle: 'T+1',
    });
    const failAdapter = new MockSettlementAdapter({
      failureIdentifiers: new Set(['will-fail']),
    });
    await requestSettlement(store, failAdapter, {
      accountId,
      externalAccount: { rail: 'MOCK', identifier: 'will-fail' },
      amount: Money.of('30', 'USD'),
      direction: 'outbound',
      cycle: 'T+0',
    });
    const report = await reconcile(store);
    expect(report.ok).toBe(true);
    expect(report.integrity.ok).toBe(true);
    expect(report.findings).toEqual([]);
  });
});
