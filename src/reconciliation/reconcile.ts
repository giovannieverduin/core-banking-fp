import type { AccountId } from '../domain/account-id.js';
import { replayAccount } from '../domain/account.js';
import { Money } from '../domain/money.js';
import type { EventStore } from '../events/event-store.js';
import type { StoredEvent } from './hash-chain.js';
import { customerRef } from '../ledger/account-ref.js';
import {
  balanceFor,
  projectLedger,
  type LedgerState,
} from '../ledger/ledger-projection.js';
import {
  trialBalance,
  type TrialBalanceRow,
} from '../ledger/trial-balance.js';
import {
  verifyChainOnEvents,
  type IntegrityReport,
} from './integrity.js';

export type ReconciliationFinding =
  | {
      readonly kind: 'projection-mismatch';
      readonly accountId: AccountId;
      readonly aggregateBalance: string;
      readonly ledgerBalance: string;
    }
  | {
      readonly kind: 'trial-balance-broken';
      readonly currency: TrialBalanceRow['currency'];
      readonly difference: string;
    };

export interface ReconciliationReport {
  readonly ok: boolean;
  readonly integrity: IntegrityReport;
  readonly trialBalance: readonly TrialBalanceRow[];
  readonly findings: readonly ReconciliationFinding[];
}

export async function reconcile(store: EventStore): Promise<ReconciliationReport> {
  const events = await store.readAll();
  const integrity = verifyChainOnEvents(events);
  const ledger: LedgerState = projectLedger(events);
  const tb = trialBalance(ledger);

  const findings: ReconciliationFinding[] = [];

  for (const row of tb) {
    if (!row.difference.isZero()) {
      findings.push({
        kind: 'trial-balance-broken',
        currency: row.currency,
        difference: row.difference.toString(),
      });
    }
  }

  const eventsByAggregate = new Map<AccountId, StoredEvent[]>();
  for (const event of events) {
    const list = eventsByAggregate.get(event.metadata.aggregateId) ?? [];
    list.push(event);
    eventsByAggregate.set(event.metadata.aggregateId, list);
  }

  for (const [aggregateId, aggregateEvents] of eventsByAggregate) {
    const state = replayAccount(aggregateEvents);
    if (!state) continue;
    const ledgerBalance =
      balanceFor(ledger, customerRef(aggregateId)) ??
      Money.zero(state.currency);
    if (!ledgerBalance.equals(state.balance)) {
      findings.push({
        kind: 'projection-mismatch',
        accountId: aggregateId,
        aggregateBalance: state.balance.toString(),
        ledgerBalance: ledgerBalance.toString(),
      });
    }
  }

  return {
    ok: integrity.ok && findings.length === 0,
    integrity,
    trialBalance: tb,
    findings,
  };
}
