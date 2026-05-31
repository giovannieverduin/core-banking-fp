import type { AccountId } from '../domain/account-id.js';
import { replayAccount, type AccountState } from '../domain/account.js';
import type { Currency } from '../domain/currency.js';
import type { EventStore } from '../events/event-store.js';
import type { StoredEvent } from '../reconciliation/hash-chain.js';
import {
  refKey,
  type LedgerAccountRef,
} from '../ledger/account-ref.js';
import {
  projectLedger,
  type LedgerState,
} from '../ledger/ledger-projection.js';
import {
  trialBalance,
  type TrialBalanceRow,
} from '../ledger/trial-balance.js';
import { verifyChainOnEvents } from '../reconciliation/integrity.js';

export interface AccountSummary {
  readonly accountId: AccountId;
  readonly owner: string;
  readonly currency: Currency;
  readonly balance: { amount: string; currency: Currency };
  readonly version: number;
}

export interface LedgerAccountSummary {
  readonly key: string;
  readonly ref: LedgerAccountRef;
  readonly balance: { amount: string; currency: Currency };
  readonly debit: { amount: string; currency: Currency };
  readonly credit: { amount: string; currency: Currency };
}

export interface SnapshotResponse {
  readonly generatedAt: string;
  readonly integrity: { ok: boolean; eventsChecked: number; errorCount: number };
  readonly customerAccounts: readonly AccountSummary[];
  readonly systemAccounts: readonly LedgerAccountSummary[];
  readonly externalAccounts: readonly LedgerAccountSummary[];
  readonly trialBalance: readonly {
    currency: Currency;
    debit: string;
    credit: string;
    difference: string;
  }[];
  readonly recentEvents: readonly StoredEvent[];
}

export interface BuildSnapshotOptions {
  readonly recentEventLimit?: number;
}

export async function buildSnapshot(
  store: EventStore,
  options: BuildSnapshotOptions = {},
): Promise<SnapshotResponse> {
  const events = await store.readAll();
  const integrity = verifyChainOnEvents(events);
  const ledger: LedgerState = projectLedger(events);
  const tb: readonly TrialBalanceRow[] = trialBalance(ledger);

  const customerAccounts = collectCustomerAccounts(events);
  const { systemAccounts, externalAccounts } = splitLedgerAccounts(ledger);

  const limit = options.recentEventLimit ?? 50;
  const recentEvents = events.slice(-limit);

  return {
    generatedAt: new Date().toISOString(),
    integrity: {
      ok: integrity.ok,
      eventsChecked: integrity.eventsChecked,
      errorCount: integrity.errors.length,
    },
    customerAccounts,
    systemAccounts,
    externalAccounts,
    trialBalance: tb.map((row) => ({
      currency: row.currency,
      debit: row.debit.toJSON().amount,
      credit: row.credit.toJSON().amount,
      difference: row.difference.toJSON().amount,
    })),
    recentEvents,
  };
}

function collectCustomerAccounts(
  events: readonly StoredEvent[],
): readonly AccountSummary[] {
  const byAggregate = new Map<AccountId, StoredEvent[]>();
  for (const event of events) {
    const list = byAggregate.get(event.metadata.aggregateId) ?? [];
    list.push(event);
    byAggregate.set(event.metadata.aggregateId, list);
  }
  const summaries: AccountSummary[] = [];
  for (const [accountId, stream] of byAggregate) {
    const state: AccountState | null = replayAccount(stream);
    if (!state) continue;
    summaries.push({
      accountId,
      owner: state.owner,
      currency: state.currency,
      balance: state.balance.toJSON(),
      version: state.version,
    });
  }
  summaries.sort((a, b) => a.accountId.localeCompare(b.accountId));
  return summaries;
}

function splitLedgerAccounts(state: LedgerState): {
  systemAccounts: LedgerAccountSummary[];
  externalAccounts: LedgerAccountSummary[];
} {
  const systemAccounts: LedgerAccountSummary[] = [];
  const externalAccounts: LedgerAccountSummary[] = [];
  for (const balance of state.accounts.values()) {
    if (balance.ref.kind === 'customer') continue;
    const summary: LedgerAccountSummary = {
      key: refKey(balance.ref),
      ref: balance.ref,
      balance: balance.balance.toJSON(),
      debit: balance.debitTotal.toJSON(),
      credit: balance.creditTotal.toJSON(),
    };
    if (balance.ref.kind === 'system') {
      systemAccounts.push(summary);
    } else if (balance.ref.kind === 'external') {
      externalAccounts.push(summary);
    }
  }
  systemAccounts.sort((a, b) => a.key.localeCompare(b.key));
  externalAccounts.sort((a, b) => a.key.localeCompare(b.key));
  return { systemAccounts, externalAccounts };
}
