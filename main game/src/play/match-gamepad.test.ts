import assert from "node:assert/strict";
import test from "node:test";
import { stickAmount } from "./useMatchGamepad";

test("the view stick does nothing inside its dead zone and starts from nothing at its edge", () => {
  assert.equal(stickAmount(0), 0);
  assert.equal(stickAmount(0.2), 0);
  assert.equal(stickAmount(-0.19), 0);
  assert.ok(stickAmount(0.21) > 0 && stickAmount(0.21) < 0.02);
  assert.equal(stickAmount(1), 1);
  assert.equal(stickAmount(-1), -1);
  // Evenly in between, and the same either way.
  assert.ok(Math.abs(stickAmount(0.6) - 0.5) < 1e-9);
  assert.equal(stickAmount(-0.6), -stickAmount(0.6));
  // A trigger is read the same way: a resting one does not creep the view.
  assert.equal(stickAmount(0.1), 0);
});
