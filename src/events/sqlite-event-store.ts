import { randomUUID } from 'node:crypto';
import initSqlJs, { type Database, type SqlValue } from 'sql.js';
import type { AccountId } from '../domain/account-id.js';
import {
  ConcurrencyError,
  EventStoreError,
  type AppendCandidate,
  type EventStore,
} from './event-store.js';
import type { AccountEvent, EventPayload } from './types.js';
import {
  GENESIS_HASH,
  computeEventHash,
  type StoredEvent,
} from '../reconciliation/hash-chain.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS events (
  event_id      TEXT PRIMARY KEY,
  aggregate_id  TEXT NOT NULL,
  version       INTEGER NOT NULL,
  occurred_at   TEXT NOT NULL,
  event_type    TEXT NOT NULL,
  payload       TEXT NOT NULL,
  global_seq    INTEGER NOT NULL,
  previous_hash TEXT NOT NULL,
  hash          TEXT NOT NULL UNIQUE,
  UNIQUE(aggregate_id, version)
);
CREATE INDEX IF NOT EXISTS idx_events_aggregate ON events(aggregate_id, version);
CREATE INDEX IF NOT EXISTS idx_events_global ON events(global_seq);
`;

interface EventRow {
  event_id: string;
  aggregate_id: string;
  version: number;
  occurred_at: string;
  event_type: string;
  payload: string;
  previous_hash: string;
  hash: string;
}

function toEventRow(value: Record<string, SqlValue>): EventRow {
  return {
    event_id: String(value['event_id']),
    aggregate_id: String(value['aggregate_id']),
    version: Number(value['version']),
    occurred_at: String(value['occurred_at']),
    event_type: String(value['event_type']),
    payload: String(value['payload']),
    previous_hash: String(value['previous_hash']),
    hash: String(value['hash']),
  };
}

function rowToEvent(row: EventRow): StoredEvent {
  const payload = JSON.parse(row.payload) as EventPayload;
  return {
    metadata: {
      eventId: row.event_id,
      aggregateId: row.aggregate_id as AccountId,
      version: row.version,
      occurredAt: row.occurred_at,
    },
    payload,
    chain: {
      hash: row.hash,
      previousHash: row.previous_hash,
    },
  };
}

export class SqliteEventStore implements EventStore {
  private constructor(private readonly db: Database) {}

  static async open(): Promise<SqliteEventStore> {
    const SQL = await initSqlJs();
    const db = new SQL.Database();
    db.exec(SCHEMA);
    return new SqliteEventStore(db);
  }

  async append(
    candidates: readonly AppendCandidate[],
  ): Promise<readonly StoredEvent[]> {
    if (candidates.length === 0) return [];

    this.db.run('BEGIN');
    try {
      const versionCursor = new Map<AccountId, number>();
      const written: StoredEvent[] = [];
      let previousHash = this.latestHashSync();
      for (const candidate of candidates) {
        const aggregateId = candidate.aggregateId;
        let actual = versionCursor.get(aggregateId);
        if (actual === undefined) {
          actual = this.currentVersionSync(aggregateId);
          if (candidate.expectedVersion !== actual) {
            throw new ConcurrencyError(
              aggregateId,
              candidate.expectedVersion,
              actual,
            );
          }
        }
        const nextVersion = actual + 1;
        const base: AccountEvent = {
          metadata: {
            eventId: randomUUID(),
            aggregateId,
            version: nextVersion,
            occurredAt: new Date().toISOString(),
          },
          payload: candidate.payload,
        };
        const hash = computeEventHash(base, previousHash);
        const stored: StoredEvent = {
          ...base,
          chain: { hash, previousHash },
        };
        this.insert(stored);
        written.push(stored);
        versionCursor.set(aggregateId, nextVersion);
        previousHash = hash;
      }
      this.db.run('COMMIT');
      return written;
    } catch (err) {
      this.db.run('ROLLBACK');
      throw err;
    }
  }

  async readStream(aggregateId: AccountId): Promise<readonly StoredEvent[]> {
    const stmt = this.db.prepare(
      'SELECT event_id, aggregate_id, version, occurred_at, event_type, payload, previous_hash, hash FROM events WHERE aggregate_id = ? ORDER BY version ASC',
    );
    try {
      stmt.bind([aggregateId]);
      const events: StoredEvent[] = [];
      while (stmt.step()) {
        events.push(rowToEvent(toEventRow(stmt.getAsObject())));
      }
      return events;
    } finally {
      stmt.free();
    }
  }

  async readAll(): Promise<readonly StoredEvent[]> {
    const stmt = this.db.prepare(
      'SELECT event_id, aggregate_id, version, occurred_at, event_type, payload, previous_hash, hash FROM events ORDER BY global_seq ASC',
    );
    try {
      const events: StoredEvent[] = [];
      while (stmt.step()) {
        events.push(rowToEvent(toEventRow(stmt.getAsObject())));
      }
      return events;
    } finally {
      stmt.free();
    }
  }

  async currentVersion(aggregateId: AccountId): Promise<number> {
    return this.currentVersionSync(aggregateId);
  }

  close(): void {
    this.db.close();
  }

  private currentVersionSync(aggregateId: AccountId): number {
    const stmt = this.db.prepare(
      'SELECT COALESCE(MAX(version), 0) AS v FROM events WHERE aggregate_id = ?',
    );
    try {
      stmt.bind([aggregateId]);
      if (!stmt.step()) return 0;
      const row = stmt.getAsObject();
      const v = row['v'];
      return typeof v === 'number' ? v : Number(v ?? 0);
    } finally {
      stmt.free();
    }
  }

  private insert(event: StoredEvent): void {
    const nextSeq = this.nextGlobalSeq();
    const stmt = this.db.prepare(
      `INSERT INTO events
        (event_id, aggregate_id, version, occurred_at, event_type, payload, global_seq, previous_hash, hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    try {
      stmt.run([
        event.metadata.eventId,
        event.metadata.aggregateId,
        event.metadata.version,
        event.metadata.occurredAt,
        event.payload.type,
        JSON.stringify(event.payload),
        nextSeq,
        event.chain.previousHash,
        event.chain.hash,
      ]);
    } catch (err) {
      throw new EventStoreError(
        `Failed to insert event ${event.metadata.eventId}: ${(err as Error).message}`,
      );
    } finally {
      stmt.free();
    }
  }

  private latestHashSync(): string {
    const stmt = this.db.prepare(
      'SELECT hash FROM events ORDER BY global_seq DESC LIMIT 1',
    );
    try {
      if (!stmt.step()) return GENESIS_HASH;
      const row = stmt.getAsObject();
      const h = row['hash'];
      return typeof h === 'string' && h.length > 0 ? h : GENESIS_HASH;
    } finally {
      stmt.free();
    }
  }

  private nextGlobalSeq(): number {
    const stmt = this.db.prepare(
      'SELECT COALESCE(MAX(global_seq), 0) + 1 AS next FROM events',
    );
    try {
      stmt.step();
      const row = stmt.getAsObject();
      const v = row['next'];
      return typeof v === 'number' ? v : Number(v ?? 1);
    } finally {
      stmt.free();
    }
  }
}
