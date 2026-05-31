import type { AccountId } from '../domain/account-id.js';
import type { Currency } from '../domain/currency.js';
import type {
  SettlementCycle,
  SettlementDirection,
  SettlementId,
  SettlementRail,
} from '../settlement/types.js';

declare const transferIdBrand: unique symbol;
export type TransferId = string & { readonly [transferIdBrand]: true };

export interface EventMetadata {
  readonly eventId: string;
  readonly aggregateId: AccountId;
  readonly version: number;
  readonly occurredAt: string;
}

export interface AccountCreatedPayload {
  readonly type: 'AccountCreated';
  readonly accountId: AccountId;
  readonly owner: string;
  readonly currency: Currency;
}

export interface MoneyDepositedPayload {
  readonly type: 'MoneyDeposited';
  readonly accountId: AccountId;
  readonly amount: string;
  readonly currency: Currency;
  readonly reference: string;
}

export interface MoneyWithdrawnPayload {
  readonly type: 'MoneyWithdrawn';
  readonly accountId: AccountId;
  readonly amount: string;
  readonly currency: Currency;
  readonly reference: string;
}

export interface TransferInitiatedPayload {
  readonly type: 'TransferInitiated';
  readonly accountId: AccountId;
  readonly transferId: TransferId;
  readonly counterpartyAccountId: AccountId;
  readonly amount: string;
  readonly currency: Currency;
}

export interface TransferReceivedPayload {
  readonly type: 'TransferReceived';
  readonly accountId: AccountId;
  readonly transferId: TransferId;
  readonly counterpartyAccountId: AccountId;
  readonly amount: string;
  readonly currency: Currency;
}

export interface TransferCompletedPayload {
  readonly type: 'TransferCompleted';
  readonly accountId: AccountId;
  readonly transferId: TransferId;
  readonly counterpartyAccountId: AccountId;
  readonly amount: string;
  readonly currency: Currency;
}

export interface TransferFailedPayload {
  readonly type: 'TransferFailed';
  readonly accountId: AccountId;
  readonly transferId: TransferId;
  readonly counterpartyAccountId: AccountId;
  readonly amount: string;
  readonly currency: Currency;
  readonly reason: string;
}

export interface TransferRejectedPayload {
  readonly type: 'TransferRejected';
  readonly accountId: AccountId;
  readonly transferId: TransferId;
  readonly counterpartyAccountId: AccountId;
  readonly amount: string;
  readonly currency: Currency;
  readonly reason: string;
}

export interface SettlementInitiatedPayload {
  readonly type: 'SettlementInitiated';
  readonly accountId: AccountId;
  readonly settlementId: SettlementId;
  readonly rail: SettlementRail;
  readonly externalIdentifier: string;
  readonly direction: SettlementDirection;
  readonly cycle: SettlementCycle;
  readonly amount: string;
  readonly currency: Currency;
}

export interface SettlementSettledPayload {
  readonly type: 'SettlementSettled';
  readonly accountId: AccountId;
  readonly settlementId: SettlementId;
  readonly rail: SettlementRail;
  readonly externalIdentifier: string;
  readonly externalRef: string;
  readonly direction: SettlementDirection;
  readonly amount: string;
  readonly currency: Currency;
  readonly settledAt: string;
}

export interface SettlementFailedPayload {
  readonly type: 'SettlementFailed';
  readonly accountId: AccountId;
  readonly settlementId: SettlementId;
  readonly rail: SettlementRail;
  readonly externalIdentifier: string;
  readonly direction: SettlementDirection;
  readonly amount: string;
  readonly currency: Currency;
  readonly reason: string;
  readonly settledAt: string;
}

export type EventPayload =
  | AccountCreatedPayload
  | MoneyDepositedPayload
  | MoneyWithdrawnPayload
  | TransferInitiatedPayload
  | TransferReceivedPayload
  | TransferCompletedPayload
  | TransferFailedPayload
  | TransferRejectedPayload
  | SettlementInitiatedPayload
  | SettlementSettledPayload
  | SettlementFailedPayload;

export type EventType = EventPayload['type'];

export interface DomainEvent<P extends EventPayload = EventPayload> {
  readonly metadata: EventMetadata;
  readonly payload: P;
}

export type AccountEvent = DomainEvent<EventPayload>;
