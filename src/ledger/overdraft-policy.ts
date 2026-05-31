import type { AccountState } from '../domain/account.js';
import { Money } from '../domain/money.js';

export type OverdraftDecision =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string };

export interface OverdraftPolicy {
  readonly name: string;
  authorize(account: AccountState, amount: Money): OverdraftDecision;
}

export const HardRejectPolicy: OverdraftPolicy = {
  name: 'hard-reject',
  authorize(account, amount) {
    if (amount.currency !== account.currency) {
      return {
        ok: false,
        reason: `Currency mismatch: account ${account.currency}, withdrawal ${amount.currency}`,
      };
    }
    if (account.balance.lt(amount)) {
      return {
        ok: false,
        reason: `Insufficient funds: balance ${account.balance.toString()} < withdrawal ${amount.toString()}`,
      };
    }
    return { ok: true };
  },
};

export function fixedLimitPolicy(limit: Money): OverdraftPolicy {
  if (limit.isNegative()) {
    throw new Error(
      `fixedLimitPolicy limit must be non-negative, got ${limit.toString()}`,
    );
  }
  return {
    name: `fixed-limit:${limit.toString()}`,
    authorize(account, amount) {
      if (amount.currency !== account.currency) {
        return {
          ok: false,
          reason: `Currency mismatch: account ${account.currency}, withdrawal ${amount.currency}`,
        };
      }
      if (limit.currency !== account.currency) {
        return {
          ok: false,
          reason: `Policy limit currency ${limit.currency} does not match account currency ${account.currency}`,
        };
      }
      const projected = account.balance.subtract(amount);
      const floor = Money.zero(account.currency).subtract(limit);
      if (projected.lt(floor)) {
        return {
          ok: false,
          reason: `Overdraft limit exceeded: projected ${projected.toString()} < floor ${floor.toString()}`,
        };
      }
      return { ok: true };
    },
  };
}
