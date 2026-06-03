import type { EventBus } from "@unfurl/ui-contracts";

export type EventEnvelope = {
  readonly eventName: string;
  readonly payload: unknown;
};

export type EventBusObserver = (event: EventEnvelope) => void;

export function createInMemoryEventBus(observer?: EventBusObserver): EventBus {
  const handlers = new Map<string, Set<(payload: unknown) => void>>();

  return {
    publish(eventName, payload) {
      observer?.({ eventName, payload });
      const currentHandlers = handlers.get(eventName);
      if (!currentHandlers) {
        return;
      }
      for (const handler of [...currentHandlers]) {
        handler(payload);
      }
    },
    subscribe(eventName, handler) {
      const currentHandlers = handlers.get(eventName) ?? new Set<(payload: unknown) => void>();
      currentHandlers.add(handler);
      handlers.set(eventName, currentHandlers);

      let subscribed = true;
      return () => {
        if (!subscribed) {
          return;
        }
        subscribed = false;
        currentHandlers.delete(handler);
        if (currentHandlers.size === 0) {
          handlers.delete(eventName);
        }
      };
    }
  };
}
