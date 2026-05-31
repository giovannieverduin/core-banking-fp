import type { AccountId } from './account-id.js';
import { Money } from './money.js';
import type { Currency } from './currency.js';
import type { AccountEvent } from '../events/types.js';

export interface AccountState {
  readonly id: AccountId;
  readonly owner: string;
  readonly currency: Currency;
  readonly balance: Money;
  readonly version: number;
  readonly exists: boolean;
}

export class AccountReplayError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AccountReplayError';
  }
}

export function replayAccount(
  events: readonly AccountEvent[],
): AccountState | null {
  if (events.length === 0) return null;

  const first = events[0];
  if (!first || first.payload.type !== 'AccountCreated') {
    throw new AccountReplayError(
      'Event stream must begin with AccountCreated',
    );
  }

  const { accountId, owner, currency } = first.payload;
  let balance = Money.zero(currency);
  let version = first.metadata.version;

  for (let i = 1; i < events.length; i += 1) {
    const event = events[i];
    if (!event) continue;
    if (event.metadata.aggregateId !== accountId) {
      throw new AccountReplayError(
        `Event aggregate mismatch: expected ${accountId}, got ${event.metadata.aggregateId}`,
      );
    }
    if (event.metadata.version !== version + 1) {
      throw new AccountReplayError(
        `Non-contiguous version on ${accountId}: expected ${version + 1}, got ${event.metadata.version}`,
      );
    }
    version = event.metadata.version;
    balance = applyEvent(balance, currency, event);
  }

  return {
    id: accountId,
    owner,
    currency,
    balance,
    version,
    exists: true,
  };
}

function applyEvent(
  balance: Money,
  currency: Currency,
  event: AccountEvent,
): Money {
  switch (event.payload.type) {
    case 'AccountCreated':
      throw new AccountReplayError(
        'AccountCreated may only appear as the first event',
      );
    case 'MoneyDeposited': {
      assertCurrency(event.payload.currency, currency);
      return balance.add(Money.of(event.payload.amount, currency));
    }
    case 'MoneyWithdrawn': {
      assertCurrency(event.payload.currency, currency);
      return balance.subtract(Money.of(event.payload.amount, currency));
    }
    case 'TransferInitiated': {
      assertCurrency(event.payload.currency, currency);
      return balance.subtract(Money.of(event.payload.amount, currency));
    }
    case 'TransferReceived': {
      assertCurrency(event.payload.currency, currency);
      return balance.add(Money.of(event.payload.amount, currency));
    }
    case 'TransferCompleted':
      return balance;
    case 'TransferFailed': {
      assertCurrency(event.payload.currency, currency);
      return balance.add(Money.of(event.payload.amount, currency));
    }
    case 'TransferRejected':
      return balance;
  }
}

function assertCurrency(actual: Currency, expected: Currency): void {
  if (actual !== expected) {
    throw new AccountReplayError(
      `Event currency ${actual} does not match account currency ${expected}`,
    );
  }
}
