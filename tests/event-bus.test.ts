import { describe, expect, it } from 'vitest';
import {
  createAccount,
  depositMoney,
} from '../src/domain/commands.js';
import { Money } from '../src/domain/money.js';
import { EventBus } from '../src/events/event-bus.js';
import { SqliteEventStore } from '../src/events/sqlite-event-store.js';
import type { StoredEvent } from '../src/reconciliation/hash-chain.js';

describe('EventBus', () => {
  it('publishes to subscribed listeners', () => {
    const bus = new EventBus();
    const received: StoredEvent[] = [];
    bus.subscribe((e) => received.push(e));
    const fake: StoredEvent = {
      metadata: {
        eventId: 'e1',
        aggregateId: 'a' as unknown as never,
        version: 1,
        occurredAt: '',
      },
      payload: {
        type: 'AccountCreated',
        accountId: 'a' as unknown as never,
        owner: 'A',
        currency: 'USD',
      },
      chain: { previousHash: '0'.repeat(64), hash: 'x'.repeat(64) },
    };
    bus.publish(fake);
    expect(received).toHaveLength(1);
    expect(received[0]).toBe(fake);
  });

  it('unsubscribe removes the listener', () => {
    const bus = new EventBus();
    let count = 0;
    const off = bus.subscribe(() => {
      count += 1;
    });
    off();
    bus.publish({
      metadata: {
        eventId: 'e',
        aggregateId: 'a' as unknown as never,
        version: 1,
        occurredAt: '',
      },
      payload: {
        type: 'AccountCreated',
        accountId: 'a' as unknown as never,
        owner: 'A',
        currency: 'USD',
      },
      chain: { previousHash: '0'.repeat(64), hash: 'x'.repeat(64) },
    });
    expect(count).toBe(0);
    expect(bus.listenerCount()).toBe(0);
  });

  it('a throwing listener does not break the publisher or peers', () => {
    const bus = new EventBus();
    bus.subscribe(() => {
      throw new Error('boom');
    });
    let peerCalled = false;
    bus.subscribe(() => {
      peerCalled = true;
    });
    expect(() =>
      bus.publish({
        metadata: {
          eventId: 'e',
          aggregateId: 'a' as unknown as never,
          version: 1,
          occurredAt: '',
        },
        payload: {
          type: 'AccountCreated',
          accountId: 'a' as unknown as never,
          owner: 'A',
          currency: 'USD',
        },
        chain: { previousHash: '0'.repeat(64), hash: 'x'.repeat(64) },
      }),
    ).not.toThrow();
    expect(peerCalled).toBe(true);
  });

  it('store publishes every appended event when a bus is provided', async () => {
    const bus = new EventBus();
    const received: StoredEvent[] = [];
    bus.subscribe((e) => received.push(e));
    const store = await SqliteEventStore.open({ bus });
    const accountId = await createAccount(store, {
      owner: 'Gio',
      currency: 'USD',
    });
    await depositMoney(store, {
      accountId,
      amount: Money.of('100', 'USD'),
      reference: 'seed',
    });
    expect(received.map((e) => e.payload.type)).toEqual([
      'AccountCreated',
      'MoneyDeposited',
    ]);
  });

  it('store with no bus does not error and emits no events', async () => {
    const store = await SqliteEventStore.open();
    const accountId = await createAccount(store, {
      owner: 'Gio',
      currency: 'USD',
    });
    expect(typeof accountId).toBe('string');
  });
});
