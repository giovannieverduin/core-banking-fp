import { describe, expect, it } from 'vitest';
import { AccountReplayError, replayAccount } from '../src/domain/account.js';
import { newAccountId } from '../src/domain/account-id.js';
import { Money } from '../src/domain/money.js';
import type { AccountEvent } from '../src/events/types.js';

function event(
  accountId: ReturnType<typeof newAccountId>,
  version: number,
  payload: AccountEvent['payload'],
): AccountEvent {
  return {
    metadata: {
      eventId: `evt-${version}`,
      aggregateId: accountId,
      version,
      occurredAt: new Date(version * 1000).toISOString(),
    },
    payload,
  };
}

describe('replayAccount', () => {
  it('returns null for empty event stream', () => {
    expect(replayAccount([])).toBeNull();
  });

  it('rejects streams that do not start with AccountCreated', () => {
    const id = newAccountId();
    expect(() =>
      replayAccount([
        event(id, 1, {
          type: 'MoneyDeposited',
          accountId: id,
          amount: '10',
          currency: 'USD',
          reference: 'x',
        }),
      ]),
    ).toThrow(AccountReplayError);
  });

  it('derives balance after deposit + withdrawal', () => {
    const id = newAccountId();
    const events: AccountEvent[] = [
      event(id, 1, {
        type: 'AccountCreated',
        accountId: id,
        owner: 'Gio',
        currency: 'USD',
      }),
      event(id, 2, {
        type: 'MoneyDeposited',
        accountId: id,
        amount: '500',
        currency: 'USD',
        reference: 'seed',
      }),
      event(id, 3, {
        type: 'MoneyWithdrawn',
        accountId: id,
        amount: '120.50',
        currency: 'USD',
        reference: 'atm',
      }),
    ];
    const state = replayAccount(events);
    expect(state).not.toBeNull();
    expect(state!.balance.equals(Money.of('379.50', 'USD'))).toBe(true);
    expect(state!.version).toBe(3);
  });

  it('handles TransferInitiated and TransferFailed compensation', () => {
    const id = newAccountId();
    const peer = newAccountId();
    const events: AccountEvent[] = [
      event(id, 1, {
        type: 'AccountCreated',
        accountId: id,
        owner: 'Gio',
        currency: 'USD',
      }),
      event(id, 2, {
        type: 'MoneyDeposited',
        accountId: id,
        amount: '100',
        currency: 'USD',
        reference: 'seed',
      }),
      event(id, 3, {
        type: 'TransferInitiated',
        accountId: id,
        // any non-empty string-cast is fine for type purposes
        transferId: 't-1' as unknown as never,
        counterpartyAccountId: peer,
        amount: '40',
        currency: 'USD',
      }),
      event(id, 4, {
        type: 'TransferFailed',
        accountId: id,
        transferId: 't-1' as unknown as never,
        counterpartyAccountId: peer,
        amount: '40',
        currency: 'USD',
        reason: 'peer rejected',
      }),
    ];
    const state = replayAccount(events);
    expect(state!.balance.equals(Money.of('100', 'USD'))).toBe(true);
  });

  it('rejects non-contiguous versions', () => {
    const id = newAccountId();
    expect(() =>
      replayAccount([
        event(id, 1, {
          type: 'AccountCreated',
          accountId: id,
          owner: 'Gio',
          currency: 'USD',
        }),
        event(id, 3, {
          type: 'MoneyDeposited',
          accountId: id,
          amount: '10',
          currency: 'USD',
          reference: 'x',
        }),
      ]),
    ).toThrow(AccountReplayError);
  });
});
