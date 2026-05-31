import type { StoredEvent } from '../reconciliation/hash-chain.js';

export type EventBusListener = (event: StoredEvent) => void;

export class EventBus {
  private readonly listeners = new Set<EventBusListener>();

  subscribe(listener: EventBusListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  publish(event: StoredEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // Subscriber failures must not affect the publisher or other subscribers.
      }
    }
  }

  listenerCount(): number {
    return this.listeners.size;
  }
}
