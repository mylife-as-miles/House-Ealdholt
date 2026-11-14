import assert from "node:assert/strict";
import test from "node:test";
import { connectedGamepads } from "../gamepads";

test("a refused Gamepad API reads as no pads instead of throwing (U-02)", () => {
  const navigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  try {
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: { getGamepads() { throw new DOMException("Use of the Gamepad API is disallowed", "SecurityError"); } } });
    assert.deepEqual(connectedGamepads(), []);
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: {} });
    assert.deepEqual(connectedGamepads(), [], "a browser without the API");
    const pad = { connected: true } as Gamepad;
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: { getGamepads: () => [null, pad] } });
    assert.deepEqual(connectedGamepads(), [null, pad]);
  } finally {
    if (navigator) Object.defineProperty(globalThis, "navigator", navigator);
  }
});
