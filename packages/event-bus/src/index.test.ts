import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createInMemoryEventBus } from "./index.js";

describe("in-memory event bus", () => {
  it("publishes to subscribers in registration order and supports unsubscribe", () => {
    const observed: string[] = [];
    const bus = createInMemoryEventBus(event => observed.push(`observer:${event.eventName}`));
    const received: string[] = [];

    const unsubscribeA = bus.subscribe("theme:changed", payload => received.push(`a:${String(payload)}`));
    bus.subscribe("theme:changed", payload => received.push(`b:${String(payload)}`));

    bus.publish("theme:changed", "dark");
    unsubscribeA();
    unsubscribeA();
    bus.publish("theme:changed", "light");

    assert.deepEqual(received, ["a:dark", "b:dark", "b:light"]);
    assert.deepEqual(observed, ["observer:theme:changed", "observer:theme:changed"]);
  });
});
