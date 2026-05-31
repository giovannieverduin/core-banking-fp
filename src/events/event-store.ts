import type { AccountId } from '../domain/account-id.js';
import type { AccountEvent, EventPayload } from './types.js';

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
  append(candidates: readonly AppendCandidate[]): Promise<readonly AccountEvent[]>;
  readStream(aggregateId: AccountId): Promise<readonly AccountEvent[]>;
  readAll(): Promise<readonly AccountEvent[]>;
  currentVersion(aggregateId: AccountId): Promise<number>;
}
