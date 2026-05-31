import type { AccountId } from '../domain/account-id.js';
import type { EventStore } from '../events/event-store.js';
import {
  GENESIS_HASH,
  computeEventHash,
  type StoredEvent,
} from './hash-chain.js';

export type IntegrityError =
  | {
      readonly type: 'hash-mismatch';
      readonly eventId: string;
      readonly expected: string;
      readonly actual: string;
    }
  | {
      readonly type: 'chain-broken';
      readonly eventId: string;
      readonly expectedPreviousHash: string;
      readonly actualPreviousHash: string;
    }
  | {
      readonly type: 'duplicate-event-id';
      readonly eventId: string;
    }
  | {
      readonly type: 'version-gap';
      readonly aggregateId: AccountId;
      readonly expectedVersion: number;
      readonly actualVersion: number;
    }
  | {
      readonly type: 'missing-account-created';
      readonly aggregateId: AccountId;
      readonly firstEventType: string;
    };

export interface IntegrityReport {
  readonly ok: boolean;
  readonly eventsChecked: number;
  readonly errors: readonly IntegrityError[];
}

export function verifyChainOnEvents(
  events: readonly StoredEvent[],
): IntegrityReport {
  const errors: IntegrityError[] = [];
  const seenEventIds = new Set<string>();
  const versionCursor = new Map<AccountId, number>();
  let expectedPrevious = GENESIS_HASH;

  for (const event of events) {
    const { metadata, chain } = event;

    if (seenEventIds.has(metadata.eventId)) {
      errors.push({ type: 'duplicate-event-id', eventId: metadata.eventId });
    } else {
      seenEventIds.add(metadata.eventId);
    }

    if (chain.previousHash !== expectedPrevious) {
      errors.push({
        type: 'chain-broken',
        eventId: metadata.eventId,
        expectedPreviousHash: expectedPrevious,
        actualPreviousHash: chain.previousHash,
      });
    }

    const recomputed = computeEventHash(event, chain.previousHash);
    if (recomputed !== chain.hash) {
      errors.push({
        type: 'hash-mismatch',
        eventId: metadata.eventId,
        expected: recomputed,
        actual: chain.hash,
      });
    }

    const lastVersion = versionCursor.get(metadata.aggregateId);
    if (lastVersion === undefined) {
      if (metadata.version !== 1) {
        errors.push({
          type: 'version-gap',
          aggregateId: metadata.aggregateId,
          expectedVersion: 1,
          actualVersion: metadata.version,
        });
      }
      if (event.payload.type !== 'AccountCreated') {
        errors.push({
          type: 'missing-account-created',
          aggregateId: metadata.aggregateId,
          firstEventType: event.payload.type,
        });
      }
    } else if (metadata.version !== lastVersion + 1) {
      errors.push({
        type: 'version-gap',
        aggregateId: metadata.aggregateId,
        expectedVersion: lastVersion + 1,
        actualVersion: metadata.version,
      });
    }
    versionCursor.set(metadata.aggregateId, metadata.version);

    expectedPrevious = chain.hash;
  }

  return {
    ok: errors.length === 0,
    eventsChecked: events.length,
    errors,
  };
}

export async function verifyChain(store: EventStore): Promise<IntegrityReport> {
  const events = await store.readAll();
  return verifyChainOnEvents(events);
}
