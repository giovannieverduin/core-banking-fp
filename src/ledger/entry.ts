import type { Money } from '../domain/money.js';
import type { LedgerAccountRef, NormalSide } from './account-ref.js';

export type EntrySide = NormalSide;

export interface LedgerEntry {
  readonly side: EntrySide;
  readonly amount: Money;
  readonly account: LedgerAccountRef;
  readonly sourceEventId: string;
  readonly sourceVersion: number;
}

export interface JournalEntry {
  readonly sourceEventId: string;
  readonly entries: readonly LedgerEntry[];
}

export class UnbalancedJournalError extends Error {
  constructor(sourceEventId: string, message: string) {
    super(`Unbalanced journal for event ${sourceEventId}: ${message}`);
    this.name = 'UnbalancedJournalError';
  }
}
