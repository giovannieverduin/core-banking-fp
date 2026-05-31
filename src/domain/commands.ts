import { newAccountId, type AccountId } from './account-id.js';
import type { Currency } from './currency.js';
import { Money } from './money.js';
import type { EventStore } from '../events/event-store.js';
import { replayAccount } from './account.js';
import type {
  AccountCreatedPayload,
  MoneyDepositedPayload,
  MoneyWithdrawnPayload,
} from '../events/types.js';

export class CommandError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CommandError';
  }
}

export interface CreateAccountInput {
  readonly owner: string;
  readonly currency: Currency;
  readonly accountId?: AccountId;
}

export async function createAccount(
  store: EventStore,
  input: CreateAccountInput,
): Promise<AccountId> {
  if (input.owner.trim().length === 0) {
    throw new CommandError('Owner must not be empty');
  }
  const accountId = input.accountId ?? newAccountId();
  const payload: AccountCreatedPayload = {
    type: 'AccountCreated',
    accountId,
    owner: input.owner,
    currency: input.currency,
  };
  await store.append([{ aggregateId: accountId, expectedVersion: 0, payload }]);
  return accountId;
}

export interface DepositInput {
  readonly accountId: AccountId;
  readonly amount: Money;
  readonly reference: string;
}

export async function depositMoney(
  store: EventStore,
  input: DepositInput,
): Promise<void> {
  if (!input.amount.isPositive()) {
    throw new CommandError('Deposit amount must be positive');
  }
  const events = await store.readStream(input.accountId);
  const state = replayAccount(events);
  if (!state) throw new CommandError(`Unknown account: ${input.accountId}`);
  if (state.currency !== input.amount.currency) {
    throw new CommandError(
      `Deposit currency ${input.amount.currency} does not match account currency ${state.currency}`,
    );
  }
  const payload: MoneyDepositedPayload = {
    type: 'MoneyDeposited',
    accountId: input.accountId,
    amount: input.amount.amount.toFixed(),
    currency: input.amount.currency,
    reference: input.reference,
  };
  await store.append([
    {
      aggregateId: input.accountId,
      expectedVersion: state.version,
      payload,
    },
  ]);
}

export interface WithdrawInput {
  readonly accountId: AccountId;
  readonly amount: Money;
  readonly reference: string;
}

export async function withdrawMoney(
  store: EventStore,
  input: WithdrawInput,
): Promise<void> {
  if (!input.amount.isPositive()) {
    throw new CommandError('Withdrawal amount must be positive');
  }
  const events = await store.readStream(input.accountId);
  const state = replayAccount(events);
  if (!state) throw new CommandError(`Unknown account: ${input.accountId}`);
  if (state.currency !== input.amount.currency) {
    throw new CommandError(
      `Withdrawal currency ${input.amount.currency} does not match account currency ${state.currency}`,
    );
  }
  if (state.balance.lt(input.amount)) {
    throw new CommandError(
      `Insufficient funds: balance ${state.balance.toString()} < withdrawal ${input.amount.toString()}`,
    );
  }
  const payload: MoneyWithdrawnPayload = {
    type: 'MoneyWithdrawn',
    accountId: input.accountId,
    amount: input.amount.amount.toFixed(),
    currency: input.amount.currency,
    reference: input.reference,
  };
  await store.append([
    {
      aggregateId: input.accountId,
      expectedVersion: state.version,
      payload,
    },
  ]);
}
