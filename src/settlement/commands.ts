import type { AccountId } from '../domain/account-id.js';
import { replayAccount, type AccountState } from '../domain/account.js';
import { Money } from '../domain/money.js';
import type { EventStore } from '../events/event-store.js';
import type {
  SettlementFailedPayload,
  SettlementInitiatedPayload,
  SettlementSettledPayload,
} from '../events/types.js';
import {
  HardRejectPolicy,
  type OverdraftPolicy,
} from '../ledger/overdraft-policy.js';
import type { SettlementAdapter } from './adapter.js';
import { newSettlementId } from './settlement-id.js';
import type {
  ExternalAccountRef,
  SettlementCycle,
  SettlementDirection,
  SettlementId,
  SettlementInstruction,
  SettlementResult,
} from './types.js';

export class SettlementInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SettlementInputError';
  }
}

export interface SettlementInput {
  readonly accountId: AccountId;
  readonly externalAccount: ExternalAccountRef;
  readonly amount: Money;
  readonly direction: SettlementDirection;
  readonly cycle: SettlementCycle;
  readonly settlementId?: SettlementId;
  readonly overdraftPolicy?: OverdraftPolicy;
}

export type SettlementOutcome =
  | {
      readonly status: 'settled';
      readonly settlementId: SettlementId;
      readonly externalRef: string;
      readonly settledAt: string;
    }
  | {
      readonly status: 'failed';
      readonly settlementId: SettlementId;
      readonly reason: string;
      readonly settledAt: string;
    };

export async function requestSettlement(
  store: EventStore,
  adapter: SettlementAdapter,
  input: SettlementInput,
): Promise<SettlementOutcome> {
  if (!input.amount.isPositive()) {
    throw new SettlementInputError('Settlement amount must be positive');
  }
  if (adapter.rail !== input.externalAccount.rail) {
    throw new SettlementInputError(
      `Adapter rail ${adapter.rail} does not match instruction rail ${input.externalAccount.rail}`,
    );
  }

  const events = await store.readStream(input.accountId);
  const state = replayAccount(events);
  if (!state) {
    throw new SettlementInputError(`Unknown account: ${input.accountId}`);
  }
  if (state.currency !== input.amount.currency) {
    throw new SettlementInputError(
      `Account currency ${state.currency} does not match settlement currency ${input.amount.currency}`,
    );
  }

  const settlementId = input.settlementId ?? newSettlementId();

  if (input.direction === 'outbound') {
    return outbound(store, adapter, input, state, settlementId);
  }
  return inbound(store, adapter, input, state, settlementId);
}

async function outbound(
  store: EventStore,
  adapter: SettlementAdapter,
  input: SettlementInput,
  state: AccountState,
  settlementId: SettlementId,
): Promise<SettlementOutcome> {
  const policy = input.overdraftPolicy ?? HardRejectPolicy;
  const decision = policy.authorize(state, input.amount);
  if (!decision.ok) {
    throw new SettlementInputError(
      `Outbound settlement rejected by ${policy.name}: ${decision.reason}`,
    );
  }

  const amountStr = input.amount.amount.toFixed();
  const initiated: SettlementInitiatedPayload = {
    type: 'SettlementInitiated',
    accountId: input.accountId,
    settlementId,
    rail: input.externalAccount.rail,
    externalIdentifier: input.externalAccount.identifier,
    direction: 'outbound',
    cycle: input.cycle,
    amount: amountStr,
    currency: input.amount.currency,
  };
  const initiatedWritten = await store.append([
    {
      aggregateId: input.accountId,
      expectedVersion: state.version,
      payload: initiated,
    },
  ]);
  const initiatedVersion = initiatedWritten[0]!.metadata.version;

  const instruction = buildInstruction(input, settlementId);
  let result: SettlementResult;
  try {
    result = await adapter.submit(instruction);
  } catch (err) {
    result = {
      status: 'failed',
      settledAt: new Date().toISOString(),
      reason: `adapter threw: ${(err as Error).message}`,
    };
  }

  if (result.status === 'settled') {
    const settled: SettlementSettledPayload = {
      type: 'SettlementSettled',
      accountId: input.accountId,
      settlementId,
      rail: input.externalAccount.rail,
      externalIdentifier: input.externalAccount.identifier,
      externalRef: result.externalRef,
      direction: 'outbound',
      amount: amountStr,
      currency: input.amount.currency,
      settledAt: result.settledAt,
    };
    await store.append([
      {
        aggregateId: input.accountId,
        expectedVersion: initiatedVersion,
        payload: settled,
      },
    ]);
    return {
      status: 'settled',
      settlementId,
      externalRef: result.externalRef,
      settledAt: result.settledAt,
    };
  }

  const failed: SettlementFailedPayload = {
    type: 'SettlementFailed',
    accountId: input.accountId,
    settlementId,
    rail: input.externalAccount.rail,
    externalIdentifier: input.externalAccount.identifier,
    direction: 'outbound',
    amount: amountStr,
    currency: input.amount.currency,
    reason: result.reason,
    settledAt: result.settledAt,
  };
  await store.append([
    {
      aggregateId: input.accountId,
      expectedVersion: initiatedVersion,
      payload: failed,
    },
  ]);
  return {
    status: 'failed',
    settlementId,
    reason: result.reason,
    settledAt: result.settledAt,
  };
}

async function inbound(
  store: EventStore,
  adapter: SettlementAdapter,
  input: SettlementInput,
  state: AccountState,
  settlementId: SettlementId,
): Promise<SettlementOutcome> {
  const instruction = buildInstruction(input, settlementId);
  const result = await adapter.submit(instruction);

  if (result.status === 'settled') {
    const settled: SettlementSettledPayload = {
      type: 'SettlementSettled',
      accountId: input.accountId,
      settlementId,
      rail: input.externalAccount.rail,
      externalIdentifier: input.externalAccount.identifier,
      externalRef: result.externalRef,
      direction: 'inbound',
      amount: input.amount.amount.toFixed(),
      currency: input.amount.currency,
      settledAt: result.settledAt,
    };
    await store.append([
      {
        aggregateId: input.accountId,
        expectedVersion: state.version,
        payload: settled,
      },
    ]);
    return {
      status: 'settled',
      settlementId,
      externalRef: result.externalRef,
      settledAt: result.settledAt,
    };
  }

  const failed: SettlementFailedPayload = {
    type: 'SettlementFailed',
    accountId: input.accountId,
    settlementId,
    rail: input.externalAccount.rail,
    externalIdentifier: input.externalAccount.identifier,
    direction: 'inbound',
    amount: input.amount.amount.toFixed(),
    currency: input.amount.currency,
    reason: result.reason,
    settledAt: result.settledAt,
  };
  await store.append([
    {
      aggregateId: input.accountId,
      expectedVersion: state.version,
      payload: failed,
    },
  ]);
  return {
    status: 'failed',
    settlementId,
    reason: result.reason,
    settledAt: result.settledAt,
  };
}

function buildInstruction(
  input: SettlementInput,
  settlementId: SettlementId,
): SettlementInstruction {
  return {
    instructionId: settlementId,
    internalAccountId: input.accountId,
    externalAccount: input.externalAccount,
    amount: input.amount,
    direction: input.direction,
    cycle: input.cycle,
  };
}
