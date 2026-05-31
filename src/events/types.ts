import type { AccountId } from '../domain/account-id.js';
import type { Currency } from '../domain/currency.js';

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

export type EventPayload =
  | AccountCreatedPayload
  | MoneyDepositedPayload
  | MoneyWithdrawnPayload
  | TransferInitiatedPayload
  | TransferReceivedPayload
  | TransferCompletedPayload
  | TransferFailedPayload
  | TransferRejectedPayload;

export type EventType = EventPayload['type'];

export interface DomainEvent<P extends EventPayload = EventPayload> {
  readonly metadata: EventMetadata;
  readonly payload: P;
}

export type AccountEvent = DomainEvent<EventPayload>;
