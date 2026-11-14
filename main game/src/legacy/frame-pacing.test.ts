import assert from "node:assert/strict";
import test from "node:test";
import { ADAPTIVE_QUALITY, adaptivePresetFor } from "./adaptive-quality";
import { FRAME_PACING_SAMPLES, FRAME_STALL_MS, FramePacing } from "./frame-pacing";

test("a GPU-bound loop reports its real frame interval, not its small submission time", () => {
  const pacing = new FramePacing();
  // 15 frames a second while JavaScript submits each frame in 3 ms.
  for (let frame = 0; frame < 100; frame++) pacing.rendered(1000 + frame * 66.7, 3);
  const intervals = pacing.frameIntervals();
  assert.equal(intervals.length, 99, "the first frame of a run has no interval");
  assert.ok(intervals.every((ms) => Math.abs(ms - 66.7) < 0.01));
  assert.ok(pacing.submissionTimes().every((ms) => ms === 3));
  // The step-down sees the slow card: medium steps down to low.
  assert.equal(adaptivePresetFor({ preset: "medium", renderScale: 100, frameLimit: 0 }, intervals), "low");
  // The old measure, submission time alone, never would.
  assert.equal(adaptivePresetFor({ preset: "medium", renderScale: 100, frameLimit: 0 }, pacing.submissionTimes()), null);
});

test("pauses, idle gaps and stalls are not frame intervals", () => {
  const pacing = new FramePacing();
  pacing.rendered(1000, 2);
  pacing.rendered(1016, 2);
  pacing.interrupt(); // paused, hidden or idle
  pacing.rendered(1400, 2); // 384 ms later, but it starts a new run
  pacing.rendered(1416, 2);
  pacing.rendered(1416 + FRAME_STALL_MS, 2); // a stall inside a run
  pacing.rendered(1432 + FRAME_STALL_MS, 2);
  assert.deepEqual(pacing.frameIntervals(), [16, 16, 16]);
  assert.equal(pacing.submissionTimes().length, 6);
});

test("a frame limit's skipped animation frames still count as one run", () => {
  const pacing = new FramePacing();
  // A 30 fps cap on a 60 Hz display renders every other animation frame; nothing interrupts the run.
  for (let frame = 0; frame < 2 * ADAPTIVE_QUALITY.minSamples + 2; frame += 2) pacing.rendered(frame * 16.667, 1);
  const intervals = pacing.frameIntervals();
  assert.ok(intervals.length >= ADAPTIVE_QUALITY.minSamples);
  assert.ok(intervals.every((ms) => Math.abs(ms - 33.33) < 0.01));
  // 33 ms is on budget for a 30 fps cap, so the preset stays.
  assert.equal(adaptivePresetFor({ preset: "high", renderScale: 100, frameLimit: 30 }, intervals), null);
});

test("the series are bounded rings, returned oldest first", () => {
  const pacing = new FramePacing(4);
  [100, 111, 123, 136, 150, 165, 181].forEach((now, frame) => pacing.rendered(now, frame));
  assert.deepEqual(pacing.frameIntervals(), [13, 14, 15, 16]);
  assert.deepEqual(pacing.submissionTimes(), [3, 4, 5, 6]);
  assert.equal(new FramePacing().frameIntervals().length, 0);
  assert.equal(FRAME_PACING_SAMPLES >= ADAPTIVE_QUALITY.minSamples, true);
});
