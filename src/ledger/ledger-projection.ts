import type { Currency } from '../domain/currency.js';
import { Money } from '../domain/money.js';
import type { EventStore } from '../events/event-store.js';
import type { AccountEvent } from '../events/types.js';
import {
  currencyOf,
  normalSideOf,
  refKey,
  type LedgerAccountRef,
} from './account-ref.js';
import {
  type JournalEntry,
  type LedgerEntry,
} from './entry.js';
import { eventToJournal } from './posting-rules.js';

export interface LedgerAccountBalance {
  readonly ref: LedgerAccountRef;
  readonly balance: Money;
  readonly debitTotal: Money;
  readonly creditTotal: Money;
}

export interface LedgerState {
  readonly journals: readonly JournalEntry[];
  readonly accounts: ReadonlyMap<string, LedgerAccountBalance>;
}

class AccountAccumulator {
  private debit: Money | null = null;
  private credit: Money | null = null;

  constructor(readonly ref: LedgerAccountRef) {}

  apply(entry: LedgerEntry): void {
    const ccy = entry.amount.currency;
    if (this.debit === null) this.debit = Money.zero(ccy);
    if (this.credit === null) this.credit = Money.zero(ccy);
    if (entry.side === 'debit') this.debit = this.debit.add(entry.amount);
    else this.credit = this.credit.add(entry.amount);
  }

  finalize(fallback: Currency | null): LedgerAccountBalance {
    const ccy = currencyOf(this.ref) ?? fallback;
    if (!ccy) {
      throw new Error(
        `Cannot finalize account ${refKey(this.ref)}: no currency observed`,
      );
    }
    const debit = this.debit ?? Money.zero(ccy);
    const credit = this.credit ?? Money.zero(ccy);
    const normal = normalSideOf(this.ref);
    const balance = normal === 'debit' ? debit.subtract(credit) : credit.subtract(debit);
    return { ref: this.ref, balance, debitTotal: debit, creditTotal: credit };
  }
}

export function projectLedger(events: readonly AccountEvent[]): LedgerState {
  const journals: JournalEntry[] = [];
  const accounts = new Map<string, AccountAccumulator>();
  const observedCurrency = new Map<string, Currency>();

  for (const event of events) {
    const journal = eventToJournal(event);
    if (journal.entries.length === 0) continue;
    journals.push(journal);
    for (const entry of journal.entries) {
      const key = refKey(entry.account);
      const accumulator =
        accounts.get(key) ?? new AccountAccumulator(entry.account);
      accumulator.apply(entry);
      accounts.set(key, accumulator);
      observedCurrency.set(key, entry.amount.currency);
    }
  }

  const finalized = new Map<string, LedgerAccountBalance>();
  for (const [key, acc] of accounts) {
    finalized.set(key, acc.finalize(observedCurrency.get(key) ?? null));
  }
  return { journals, accounts: finalized };
}

export async function projectLedgerFromStore(
  store: EventStore,
): Promise<LedgerState> {
  const events = await store.readAll();
  return projectLedger(events);
}

export function balanceFor(
  state: LedgerState,
  ref: LedgerAccountRef,
): Money | null {
  return state.accounts.get(refKey(ref))?.balance ?? null;
}
