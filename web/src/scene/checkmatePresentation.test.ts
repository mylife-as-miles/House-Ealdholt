import { describe, expect, it } from "vitest";
import { CheckmatePresentation, TABLEAU, type CheckmateSample } from "./checkmatePresentation";
import { DOWNFALL_TIMELINES, downfallBeat } from "./downfall/downfallPlan";

const DOWNFALL = { duration: DOWNFALL_TIMELINES.checkmate.end, phaseAt: (time: number) => downfallBeat(DOWNFALL_TIMELINES.checkmate, time) };

describe("checkmate framing on the render clock", () => {
  it("moves from realization to a held King and final wide shot in six rendered seconds (the plain tableau)", async () => {
    const director = new CheckmatePresentation(), samples: CheckmateSample[] = [];
    const result = director.start(1, frame => samples.push(frame));
    expect(samples[samples.length-1]!.phase).toBe("realization");
    director.update(1.35, 1); expect(samples[samples.length-1]).toEqual({ time: 1.35, progress: 1.35/6, phase: "hold" });
    director.update(3.1, 1); expect(samples[samples.length-1]!.phase).toBe("final-shot");
    director.update(1.55, 1); expect(await result).toBe(true); expect(director.active).toBe(false);
    expect(samples[samples.length-1]).toEqual({ time: 6, progress: 1, phase: "final-shot" });
    expect(TABLEAU.duration).toBe(6);
  });
  it("carries the downfall's beats: the King realizes, his army collapses, he is alone, breaks, kneels, and the long hold ends on the board", async () => {
    const director = new CheckmatePresentation(), phases: string[] = [];
    const result = director.start(1, frame => { if (phases[phases.length-1] !== frame.phase) phases.push(frame.phase); }, DOWNFALL);
    for (let i = 0; i < DOWNFALL.duration*30 + 5; i++) director.update(1/30, 1);
    expect(await result).toBe(true);
    expect(phases).toEqual(["realize", "collapse", "alone", "breaks", "falls", "kneels", "hold", "final-shot"]);
  });
  it("does not advance on wall time, invalid deltas or a paused render loop", async () => {
    const director = new CheckmatePresentation(), samples: CheckmateSample[] = [];
    const result = director.start(1, frame => samples.push(frame), DOWNFALL);
    await Promise.resolve(); for (const delta of [0, -1, NaN, Infinity]) director.update(delta, 1);
    expect(samples).toHaveLength(1); expect(director.elapsed).toBe(0); director.cancel(); expect(await result).toBe(false);
  });
  it("skips to the final view once without changing game state", async () => {
    const director = new CheckmatePresentation(), samples: CheckmateSample[] = [];
    const result = director.start(1, frame => samples.push(frame), DOWNFALL); director.skip();
    expect(await result).toBe(true); const count = samples.length;
    director.skip(); director.update(10, 1); expect(samples).toHaveLength(count);
    expect(samples[samples.length-1]).toEqual({ time: DOWNFALL.duration, progress: 1, phase: "final-shot" });
  });
  it("cancels an old board or replaced conclusion without applying its final camera", async () => {
    const director = new CheckmatePresentation(), samples: CheckmateSample[] = [];
    const first = director.start(1, frame => samples.push(frame), DOWNFALL); director.update(1, 2);
    expect(await first).toBe(false); expect(samples).toHaveLength(1);
    const second = director.start(2, () => {}), third = director.start(3, () => {});
    expect(await second).toBe(false); director.cancel(); expect(await third).toBe(false);
  });
  it("releases a failed presentation instead of stranding the results panel", async () => {
    const director = new CheckmatePresentation();
    expect(await director.start(1, () => { throw new Error("renderer failed"); }, DOWNFALL)).toBe(false);
    expect(director.active).toBe(false);
  });
});
