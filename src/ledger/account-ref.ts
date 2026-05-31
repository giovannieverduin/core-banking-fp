import type { AccountId } from '../domain/account-id.js';
import type { Currency } from '../domain/currency.js';

export type SystemAccountKind = 'cash-in' | 'cash-out' | 'suspense';

export type NormalSide = 'debit' | 'credit';

export type LedgerAccountRef =
  | { readonly kind: 'customer'; readonly accountId: AccountId }
  | {
      readonly kind: 'system';
      readonly system: SystemAccountKind;
      readonly currency: Currency;
    };

export function refKey(ref: LedgerAccountRef): string {
  return ref.kind === 'customer'
    ? `customer:${ref.accountId}`
    : `system:${ref.system}:${ref.currency}`;
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

export function normalSideOf(ref: LedgerAccountRef): NormalSide {
  if (ref.kind === 'customer') return 'credit';
  switch (ref.system) {
    case 'cash-in':
      return 'debit';
    case 'cash-out':
      return 'debit';
    case 'suspense':
      return 'credit';
  }
}

export function currencyOf(ref: LedgerAccountRef): Currency | null {
  return ref.kind === 'system' ? ref.currency : null;
}
