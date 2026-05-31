import { replayAccount } from '../domain/account.js';
import type { AccountId } from '../domain/account-id.js';
import { Money } from '../domain/money.js';
import type { EventStore } from '../events/event-store.js';

export class UnknownAccountError extends Error {
  constructor(accountId: AccountId) {
    super(`Unknown account: ${accountId}`);
    this.name = 'UnknownAccountError';
  }
}

export async function balanceOf(
  store: EventStore,
  accountId: AccountId,
): Promise<Money> {
  const events = await store.readStream(accountId);
  const state = replayAccount(events);
  if (!state) throw new UnknownAccountError(accountId);
  return state.balance;
}
