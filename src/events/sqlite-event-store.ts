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

const SCHEMA = `
CREATE TABLE IF NOT EXISTS events (
  event_id     TEXT PRIMARY KEY,
  aggregate_id TEXT NOT NULL,
  version      INTEGER NOT NULL,
  occurred_at  TEXT NOT NULL,
  event_type   TEXT NOT NULL,
  payload      TEXT NOT NULL,
  global_seq   INTEGER NOT NULL,
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
}

function toEventRow(value: Record<string, SqlValue>): EventRow {
  return {
    event_id: String(value['event_id']),
    aggregate_id: String(value['aggregate_id']),
    version: Number(value['version']),
    occurred_at: String(value['occurred_at']),
    event_type: String(value['event_type']),
    payload: String(value['payload']),
  };
}

function rowToEvent(row: EventRow): AccountEvent {
  const payload = JSON.parse(row.payload) as EventPayload;
  return {
    metadata: {
      eventId: row.event_id,
      aggregateId: row.aggregate_id as AccountId,
      version: row.version,
      occurredAt: row.occurred_at,
    },
    payload,
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
  ): Promise<readonly AccountEvent[]> {
    if (candidates.length === 0) return [];

    const grouped = new Map<AccountId, AppendCandidate[]>();
    for (const c of candidates) {
      const list = grouped.get(c.aggregateId) ?? [];
      list.push(c);
      grouped.set(c.aggregateId, list);
    }

    this.db.run('BEGIN');
    try {
      const written: AccountEvent[] = [];
      for (const [aggregateId, group] of grouped) {
        const actual = this.currentVersionSync(aggregateId);
        const first = group[0];
        if (!first) continue;
        if (first.expectedVersion !== actual) {
          throw new ConcurrencyError(aggregateId, first.expectedVersion, actual);
        }
        let version = actual;
        for (const candidate of group) {
          version += 1;
          const event: AccountEvent = {
            metadata: {
              eventId: randomUUID(),
              aggregateId,
              version,
              occurredAt: new Date().toISOString(),
            },
            payload: candidate.payload,
          };
          this.insert(event);
          written.push(event);
        }
      }
      this.db.run('COMMIT');
      return written;
    } catch (err) {
      this.db.run('ROLLBACK');
      throw err;
    }
  }

  async readStream(aggregateId: AccountId): Promise<readonly AccountEvent[]> {
    const stmt = this.db.prepare(
      'SELECT event_id, aggregate_id, version, occurred_at, event_type, payload FROM events WHERE aggregate_id = ? ORDER BY version ASC',
    );
    try {
      stmt.bind([aggregateId]);
      const events: AccountEvent[] = [];
      while (stmt.step()) {
        events.push(rowToEvent(toEventRow(stmt.getAsObject())));
      }
      return events;
    } finally {
      stmt.free();
    }
  }

  async readAll(): Promise<readonly AccountEvent[]> {
    const stmt = this.db.prepare(
      'SELECT event_id, aggregate_id, version, occurred_at, event_type, payload FROM events ORDER BY global_seq ASC',
    );
    try {
      const events: AccountEvent[] = [];
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

  private insert(event: AccountEvent): void {
    const nextSeq = this.nextGlobalSeq();
    const stmt = this.db.prepare(
      `INSERT INTO events
        (event_id, aggregate_id, version, occurred_at, event_type, payload, global_seq)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
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
      ]);
    } catch (err) {
      throw new EventStoreError(
        `Failed to insert event ${event.metadata.eventId}: ${(err as Error).message}`,
      );
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
