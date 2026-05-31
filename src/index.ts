import { randomBytes } from 'node:crypto';
import { buildApp } from './api/server.js';
import { EventBus } from './events/event-bus.js';
import { SqliteEventStore } from './events/sqlite-event-store.js';
import { MockSettlementAdapter } from './settlement/mock-adapter.js';
import type { SettlementAdapter } from './settlement/adapter.js';
import type { SettlementRail } from './settlement/types.js';

async function main(): Promise<void> {
  const host = process.env['HOST'] ?? '127.0.0.1';
  const port = Number.parseInt(process.env['PORT'] ?? '3000', 10);
  const adminKey =
    process.env['ADMIN_API_KEY'] ?? randomBytes(32).toString('hex');

  const bus = new EventBus();
  const store = await SqliteEventStore.open({ bus });

  const settlementAdapters = new Map<SettlementRail, SettlementAdapter>([
    ['MOCK', new MockSettlementAdapter()],
  ]);

  const { app } = buildApp({
    store,
    adminApiKeys: [adminKey],
    settlementAdapters,
    eventBus: bus,
    logger: true,
  });

  await app.listen({ host, port });
  const base = `http://${host}:${port}`;
  console.log('');
  console.log('Core banking server listening.');
  console.log(`  API:        ${base}`);
  console.log(`  Dashboard:  ${base}/dashboard?key=${adminKey}`);
  console.log(`  Admin key:  ${adminKey}`);
  console.log('');
  console.log('Try:');
  console.log(
    `  curl -sX POST ${base}/accounts -H 'content-type: application/json' -d '{"owner":"Gio","currency":"USD"}'`,
  );
  console.log('');
}

main().catch((err: unknown) => {
  console.error('Failed to start:', err);
  process.exit(1);
});
