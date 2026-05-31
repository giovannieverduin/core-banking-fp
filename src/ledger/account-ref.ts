import type { AccountId } from '../domain/account-id.js';
import type { Currency } from '../domain/currency.js';
import type { SettlementRail } from '../settlement/types.js';

export type SystemAccountKind =
  | 'cash-in'
  | 'cash-out'
  | 'suspense'
  | 'settlement-pending';

export type NormalSide = 'debit' | 'credit';

export type LedgerAccountRef =
  | { readonly kind: 'customer'; readonly accountId: AccountId }
  | {
      readonly kind: 'system';
      readonly system: SystemAccountKind;
      readonly currency: Currency;
    }
  | {
      readonly kind: 'external';
      readonly rail: SettlementRail;
      readonly currency: Currency;
    };

export function refKey(ref: LedgerAccountRef): string {
  switch (ref.kind) {
    case 'customer':
      return `customer:${ref.accountId}`;
    case 'system':
      return `system:${ref.system}:${ref.currency}`;
    case 'external':
      return `external:${ref.rail}:${ref.currency}`;
  }
}

export function customerRef(accountId: AccountId): LedgerAccountRef {
  return { kind: 'customer', accountId };
}

export function systemRef(
  system: SystemAccountKind,
  currency: Currency,
): LedgerAccountRef {
  return { kind: 'system', system, currency };
}

export function externalRef(
  rail: SettlementRail,
  currency: Currency,
): LedgerAccountRef {
  return { kind: 'external', rail, currency };
}

export function normalSideOf(ref: LedgerAccountRef): NormalSide {
  if (ref.kind === 'customer') return 'credit';
  if (ref.kind === 'external') return 'debit';
  switch (ref.system) {
    case 'cash-in':
      return 'debit';
    case 'cash-out':
      return 'debit';
    case 'suspense':
      return 'credit';
    case 'settlement-pending':
      return 'credit';
  }
}

export function currencyOf(ref: LedgerAccountRef): Currency | null {
  if (ref.kind === 'system') return ref.currency;
  if (ref.kind === 'external') return ref.currency;
  return null;
}
