import { createHash } from 'node:crypto';
import type { AccountEvent, EventPayload } from '../events/types.js';

export const GENESIS_HASH = '0'.repeat(64);

export interface ChainMetadata {
  readonly hash: string;
  readonly previousHash: string;
}

export interface StoredEvent extends AccountEvent {
  readonly chain: ChainMetadata;
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(',')}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const parts = keys.map((k) => `${JSON.stringify(k)}:${canonicalize(obj[k])}`);
  return `{${parts.join(',')}}`;
}

export interface HashableEvent {
  readonly metadata: {
    readonly eventId: string;
    readonly aggregateId: string;
    readonly version: number;
    readonly occurredAt: string;
  };
  readonly payload: EventPayload;
}

export function computeEventHash(
  event: HashableEvent,
  previousHash: string,
): string {
  const canonicalPayload = canonicalize(event.payload);
  const material = [
    event.metadata.eventId,
    event.metadata.aggregateId,
    String(event.metadata.version),
    event.metadata.occurredAt,
    event.payload.type,
    canonicalPayload,
    previousHash,
  ].join('|');
  return createHash('sha256').update(material).digest('hex');
}
