import { describe, expect, it } from 'vitest';
import { newAccountId } from '../src/domain/account-id.js';
import {
  GENESIS_HASH,
  computeEventHash,
  type StoredEvent,
} from '../src/reconciliation/hash-chain.js';

function makeEvent(
  aggregateId: ReturnType<typeof newAccountId>,
  version: number,
  amount: string,
): Omit<StoredEvent, 'chain'> {
  return {
    metadata: {
      eventId: `evt-${aggregateId}-${version}`,
      aggregateId,
      version,
      occurredAt: `2026-01-01T00:00:0${version}Z`,
    },
    payload: {
      type: 'MoneyDeposited',
      accountId: aggregateId,
      amount,
      currency: 'USD',
      reference: 'r',
    },
  };
}

describe('computeEventHash', () => {
  it('is deterministic for identical input', () => {
    const id = newAccountId();
    const e = makeEvent(id, 1, '100');
    expect(computeEventHash(e, GENESIS_HASH)).toBe(
      computeEventHash(e, GENESIS_HASH),
    );
  });

  it('changes when any payload field changes', () => {
    const id = newAccountId();
    const base = makeEvent(id, 1, '100');
    const mutated = makeEvent(id, 1, '100.01');
    expect(computeEventHash(base, GENESIS_HASH)).not.toBe(
      computeEventHash(mutated, GENESIS_HASH),
    );
  });

  it('changes when the previous hash changes', () => {
    const id = newAccountId();
    const e = makeEvent(id, 1, '100');
    const otherPrev = '1'.repeat(64);
    expect(computeEventHash(e, GENESIS_HASH)).not.toBe(
      computeEventHash(e, otherPrev),
    );
  });

  it('is insensitive to JS property insertion order (canonicalization)', () => {
    const id = newAccountId();
    const a = {
      metadata: {
        eventId: 'x',
        aggregateId: id,
        version: 1,
        occurredAt: 't',
      },
      payload: {
        type: 'MoneyDeposited' as const,
        accountId: id,
        amount: '1',
        currency: 'USD' as const,
        reference: 'r',
      },
    };
    const b = {
      metadata: {
        eventId: 'x',
        aggregateId: id,
        version: 1,
        occurredAt: 't',
      },
      payload: {
        reference: 'r',
        currency: 'USD' as const,
        amount: '1',
        accountId: id,
        type: 'MoneyDeposited' as const,
      },
    };
    expect(computeEventHash(a, GENESIS_HASH)).toBe(
      computeEventHash(b, GENESIS_HASH),
    );
  });
});
