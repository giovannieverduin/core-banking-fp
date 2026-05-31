import type { AccountId } from '../domain/account-id.js';
import type { EventPayload } from './types.js';
import type { StoredEvent } from '../reconciliation/hash-chain.js';

export interface AppendCandidate {
  readonly aggregateId: AccountId;
  readonly expectedVersion: number;
  readonly payload: EventPayload;
}

export class ConcurrencyError extends Error {
  constructor(
    aggregateId: AccountId,
    expectedVersion: number,
    actualVersion: number,
  ) {
    super(
      `Concurrency conflict for ${aggregateId}: expected version ${expectedVersion}, store at ${actualVersion}`,
    );
    this.name = 'ConcurrencyError';
  }
}

export class EventStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EventStoreError';
  }
}

export interface EventStore {
  append(candidates: readonly AppendCandidate[]): Promise<readonly StoredEvent[]>;
  readStream(aggregateId: AccountId): Promise<readonly StoredEvent[]>;
  readAll(): Promise<readonly StoredEvent[]>;
  currentVersion(aggregateId: AccountId): Promise<number>;
}
