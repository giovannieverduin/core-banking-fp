import type { Currency } from '../domain/currency.js';
import { Money } from '../domain/money.js';
import type { AccountEvent } from '../events/types.js';
import {
  customerRef,
  systemRef,
  type LedgerAccountRef,
} from './account-ref.js';
import {
  UnbalancedJournalError,
  type JournalEntry,
  type LedgerEntry,
} from './entry.js';

function entry(
  side: LedgerEntry['side'],
  amount: Money,
  account: LedgerAccountRef,
  sourceEventId: string,
  sourceVersion: number,
): LedgerEntry {
  return { side, amount, account, sourceEventId, sourceVersion };
}

export function eventToJournal(event: AccountEvent): JournalEntry {
  const { eventId, version } = event.metadata;
  const entries = derive(event, eventId, version);
  assertBalanced(entries, eventId);
  return { sourceEventId: eventId, entries };
}

function derive(
  event: AccountEvent,
  eventId: string,
  version: number,
): readonly LedgerEntry[] {
  switch (event.payload.type) {
    case 'AccountCreated':
      return [];
    case 'MoneyDeposited': {
      const amount = parseAmount(event.payload.amount, event.payload.currency);
      return [
        entry('debit', amount, systemRef('cash-in', amount.currency), eventId, version),
        entry('credit', amount, customerRef(event.payload.accountId), eventId, version),
      ];
    }
    case 'MoneyWithdrawn': {
      const amount = parseAmount(event.payload.amount, event.payload.currency);
      return [
        entry('debit', amount, customerRef(event.payload.accountId), eventId, version),
        entry('credit', amount, systemRef('cash-out', amount.currency), eventId, version),
      ];
    }
    case 'TransferInitiated': {
      const amount = parseAmount(event.payload.amount, event.payload.currency);
      return [
        entry('debit', amount, customerRef(event.payload.accountId), eventId, version),
        entry('credit', amount, systemRef('suspense', amount.currency), eventId, version),
      ];
    }
    case 'TransferReceived': {
      const amount = parseAmount(event.payload.amount, event.payload.currency);
      return [
        entry('debit', amount, systemRef('suspense', amount.currency), eventId, version),
        entry('credit', amount, customerRef(event.payload.accountId), eventId, version),
      ];
    }
    case 'TransferCompleted':
      return [];
    case 'TransferFailed': {
      const amount = parseAmount(event.payload.amount, event.payload.currency);
      return [
        entry('debit', amount, systemRef('suspense', amount.currency), eventId, version),
        entry('credit', amount, customerRef(event.payload.accountId), eventId, version),
      ];
    }
    case 'TransferRejected':
      return [];
  }
}

function parseAmount(raw: string, currency: Currency): Money {
  return Money.of(raw, currency);
}

function assertBalanced(
  entries: readonly LedgerEntry[],
  sourceEventId: string,
): void {
  if (entries.length === 0) return;
  const byCurrency = new Map<Currency, { debit: Money; credit: Money }>();
  for (const e of entries) {
    const ccy = e.amount.currency;
    const bucket =
      byCurrency.get(ccy) ?? {
        debit: Money.zero(ccy),
        credit: Money.zero(ccy),
      };
    if (e.side === 'debit') bucket.debit = bucket.debit.add(e.amount);
    else bucket.credit = bucket.credit.add(e.amount);
    byCurrency.set(ccy, bucket);
  }
  for (const [ccy, { debit, credit }] of byCurrency) {
    if (!debit.equals(credit)) {
      throw new UnbalancedJournalError(
        sourceEventId,
        `${ccy}: debits ${debit.toString()} != credits ${credit.toString()}`,
      );
    }
  }
}
