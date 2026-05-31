import type { AccountId } from '../domain/account-id.js';
import { replayAccount, type AccountState } from '../domain/account.js';
import { Money } from '../domain/money.js';
import type { EventStore, AppendCandidate } from '../events/event-store.js';
import type {
  AccountEvent,
  TransferId,
  TransferInitiatedPayload,
  TransferReceivedPayload,
  TransferCompletedPayload,
  TransferRejectedPayload,
} from '../events/types.js';
import {
  HardRejectPolicy,
  type OverdraftPolicy,
} from '../ledger/overdraft-policy.js';
import { newTransferId } from './transfer-id.js';

export interface TransferInput {
  readonly fromAccountId: AccountId;
  readonly toAccountId: AccountId;
  readonly amount: Money;
  readonly transferId?: TransferId;
  readonly overdraftPolicy?: OverdraftPolicy;
}

export type TransferOutcome =
  | {
      readonly status: 'completed';
      readonly transferId: TransferId;
      readonly idempotent: boolean;
    }
  | {
      readonly status: 'rejected';
      readonly transferId: TransferId;
      readonly reason: string;
      readonly idempotent: boolean;
    };

export class TransferInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TransferInputError';
  }
}

function payloadTransferId(event: AccountEvent): TransferId | null {
  const { payload } = event;
  switch (payload.type) {
    case 'TransferInitiated':
    case 'TransferReceived':
    case 'TransferCompleted':
    case 'TransferFailed':
    case 'TransferRejected':
      return payload.transferId;
    default:
      return null;
  }
}

function findPriorOutcome(
  events: readonly AccountEvent[],
  transferId: TransferId,
): TransferOutcome | null {
  const matches = events.filter((e) => payloadTransferId(e) === transferId);
  if (matches.length === 0) return null;
  const terminal = matches.find(
    (e) =>
      e.payload.type === 'TransferCompleted' ||
      e.payload.type === 'TransferRejected' ||
      e.payload.type === 'TransferFailed',
  );
  if (!terminal) {
    throw new TransferInputError(
      `Transfer ${transferId} is in flight without a terminal event - cannot replay`,
    );
  }
  if (terminal.payload.type === 'TransferCompleted') {
    return { status: 'completed', transferId, idempotent: true };
  }
  if (
    terminal.payload.type === 'TransferRejected' ||
    terminal.payload.type === 'TransferFailed'
  ) {
    return {
      status: 'rejected',
      transferId,
      reason: terminal.payload.reason,
      idempotent: true,
    };
  }
  return null;
}

async function rejectAndRecord(
  store: EventStore,
  source: AccountState,
  toAccountId: AccountId,
  amount: Money,
  transferId: TransferId,
  reason: string,
): Promise<TransferOutcome> {
  const payload: TransferRejectedPayload = {
    type: 'TransferRejected',
    accountId: source.id,
    transferId,
    counterpartyAccountId: toAccountId,
    amount: amount.amount.toFixed(),
    currency: amount.currency,
    reason,
  };
  await store.append([
    {
      aggregateId: source.id,
      expectedVersion: source.version,
      payload,
    },
  ]);
  return { status: 'rejected', transferId, reason, idempotent: false };
}

export async function executeTransfer(
  store: EventStore,
  input: TransferInput,
): Promise<TransferOutcome> {
  const transferId = input.transferId ?? newTransferId();
  const { fromAccountId, toAccountId, amount } = input;

  if (!amount.isPositive()) {
    throw new TransferInputError('Transfer amount must be positive');
  }

  const sourceEvents = await store.readStream(fromAccountId);
  const prior = findPriorOutcome(sourceEvents, transferId);
  if (prior) return prior;

  const source = replayAccount(sourceEvents);
  if (!source) {
    throw new TransferInputError(`Unknown source account: ${fromAccountId}`);
  }

  if (fromAccountId === toAccountId) {
    return rejectAndRecord(
      store,
      source,
      toAccountId,
      amount,
      transferId,
      'Source and destination accounts must differ',
    );
  }

  if (source.currency !== amount.currency) {
    return rejectAndRecord(
      store,
      source,
      toAccountId,
      amount,
      transferId,
      `Source currency ${source.currency} does not match transfer currency ${amount.currency}`,
    );
  }

  const destEvents = await store.readStream(toAccountId);
  const destination = replayAccount(destEvents);
  if (!destination) {
    return rejectAndRecord(
      store,
      source,
      toAccountId,
      amount,
      transferId,
      `Unknown destination account: ${toAccountId}`,
    );
  }

  if (destination.currency !== amount.currency) {
    return rejectAndRecord(
      store,
      source,
      toAccountId,
      amount,
      transferId,
      `Destination currency ${destination.currency} does not match transfer currency ${amount.currency}`,
    );
  }

  const policy = input.overdraftPolicy ?? HardRejectPolicy;
  const decision = policy.authorize(source, amount);
  if (!decision.ok) {
    return rejectAndRecord(
      store,
      source,
      toAccountId,
      amount,
      transferId,
      `${policy.name}: ${decision.reason}`,
    );
  }

  const amountStr = amount.amount.toFixed();
  const initiated: TransferInitiatedPayload = {
    type: 'TransferInitiated',
    accountId: source.id,
    transferId,
    counterpartyAccountId: destination.id,
    amount: amountStr,
    currency: amount.currency,
  };
  const received: TransferReceivedPayload = {
    type: 'TransferReceived',
    accountId: destination.id,
    transferId,
    counterpartyAccountId: source.id,
    amount: amountStr,
    currency: amount.currency,
  };
  const completed: TransferCompletedPayload = {
    type: 'TransferCompleted',
    accountId: source.id,
    transferId,
    counterpartyAccountId: destination.id,
    amount: amountStr,
    currency: amount.currency,
  };

  const candidates: AppendCandidate[] = [
    {
      aggregateId: source.id,
      expectedVersion: source.version,
      payload: initiated,
    },
    {
      aggregateId: destination.id,
      expectedVersion: destination.version,
      payload: received,
    },
    {
      aggregateId: source.id,
      expectedVersion: source.version + 1,
      payload: completed,
    },
  ];
  await store.append(candidates);

  return { status: 'completed', transferId, idempotent: false };
}
