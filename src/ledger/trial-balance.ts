import type { Currency } from '../domain/currency.js';
import { Money } from '../domain/money.js';
import type { LedgerState } from './ledger-projection.js';

export interface TrialBalanceRow {
  readonly currency: Currency;
  readonly debit: Money;
  readonly credit: Money;
  readonly difference: Money;
}

export class BooksUnbalancedError extends Error {
  constructor(rows: readonly TrialBalanceRow[]) {
    const detail = rows
      .map(
        (r) =>
          `${r.currency}: debits=${r.debit.toString()} credits=${r.credit.toString()} diff=${r.difference.toString()}`,
      )
      .join('; ');
    super(`Books unbalanced: ${detail}`);
    this.name = 'BooksUnbalancedError';
  }
}

export function trialBalance(state: LedgerState): readonly TrialBalanceRow[] {
  const totals = new Map<Currency, { debit: Money; credit: Money }>();
  for (const journal of state.journals) {
    for (const entry of journal.entries) {
      const ccy = entry.amount.currency;
      const bucket =
        totals.get(ccy) ?? {
          debit: Money.zero(ccy),
          credit: Money.zero(ccy),
        };
      if (entry.side === 'debit') bucket.debit = bucket.debit.add(entry.amount);
      else bucket.credit = bucket.credit.add(entry.amount);
      totals.set(ccy, bucket);
    }
  }
  const rows: TrialBalanceRow[] = [];
  for (const [currency, { debit, credit }] of totals) {
    rows.push({ currency, debit, credit, difference: debit.subtract(credit) });
  }
  return rows;
}

export function assertBooksBalance(state: LedgerState): void {
  const rows = trialBalance(state);
  const unbalanced = rows.filter((r) => !r.difference.isZero());
  if (unbalanced.length > 0) {
    throw new BooksUnbalancedError(unbalanced);
  }
}
