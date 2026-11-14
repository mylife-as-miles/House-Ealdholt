import { describe, expect, it } from "vitest";
import { MatchOpeningTimeline, musterReveal, type OpeningRest, type OpeningShot } from "./matchOpening";

const REST: OpeningRest = { position: [0, 6.4, 8.6], target: [0, 0.35, 0], fov: 46 };
const SHOTS: OpeningShot[] = [
  { from: { position: [0, 5, 20], target: [0, 3, -8], fov: 44 }, to: { position: [0, 3, 13], target: [0, 2, -5], fov: 44 }, seconds: 2, ease: "linear" },
  { from: { position: [5, 1, 0], target: [1, 1, 3] }, to: { position: [1, 1, 0], target: [0, 1, 3] }, seconds: 2, ease: "linear", muster: { side: "w", from: "flanks", start: 0, end: 1 }, focus: 4 },
  { from: { position: [8, 2, 0], target: [0, 0.5, 0], fov: 52 }, to: "rest", seconds: 2, ease: "linear", path: "orbit" },
];

describe("the match opening on the render clock", () => {
  it("cuts to each shot's first pose, moves to its last and ends at rest", () => {
    const timeline = new MatchOpeningTimeline(SHOTS, REST);
    expect(timeline.duration).toBe(6);
    expect(timeline.update(0)).toMatchObject({ shot: 0, position: [0, 5, 20], fov: 44, done: false });
    expect(timeline.update(1).position).toEqual([0, 4, 16.5]);
    // The cut: the second shot starts on its own first pose, with the lens the match is played with.
    expect(timeline.update(1)).toMatchObject({ shot: 1, position: [5, 1, 0], target: [1, 1, 3], fov: 46, focus: 4 });
    expect(timeline.update(2).shot).toBe(2);
    const end = timeline.update(2);
    expect(end).toMatchObject({ done: true, position: [0, 6.4, 8.6], target: [0, 0.35, 0], fov: 46, focus: null, muster: { w: 1, b: 1 } });
    expect(timeline.done).toBe(true);
  });

  it("does not advance on a delta that is not a forward step", () => {
    const timeline = new MatchOpeningTimeline(SHOTS, REST);
    for (const delta of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) timeline.update(delta);
    expect(timeline.time).toBe(0);
  });

  it("keeps an army off the field until its shot, brings it on during it and leaves it standing after", () => {
    const timeline = new MatchOpeningTimeline(SHOTS, REST);
    expect(timeline.update(1).muster).toEqual({ w: 0, b: 1 });
    expect(timeline.update(2).muster.w).toBeCloseTo(0.5);
    expect(timeline.sample().musterFrom.w).toBe("flanks");
    expect(timeline.update(2).muster).toEqual({ w: 1, b: 1 });
  });

  it("skips to the end: the camera at rest, both armies standing", () => {
    const timeline = new MatchOpeningTimeline(SHOTS, REST);
    timeline.update(0.4);
    expect(timeline.skip()).toMatchObject({ done: true, position: [0, 6.4, 8.6], muster: { w: 1, b: 1 } });
  });

  it("swings round the target by the shorter way on an orbit, changing distance and height evenly", () => {
    const timeline = new MatchOpeningTimeline([{ from: { position: [-8, 2, 0], target: [0, 0, 0] }, to: { position: [0, 2, -8], target: [0, 0, 0] }, seconds: 1, ease: "linear", path: "orbit" }], REST);
    const half = timeline.update(0.5).position;
    // From the -x side to the -z side is a quarter turn through the corner between them, not three quarters round.
    expect(half[0]).toBeLessThan(0);
    expect(half[2]).toBeLessThan(0);
    expect(Math.hypot(half[0], half[1], half[2])).toBeCloseTo(Math.hypot(8, 2));
    expect(half[1]).toBeCloseTo(2);
  });

  it("is done at once when there is nothing to play", () => {
    expect(new MatchOpeningTimeline([], REST).sample()).toMatchObject({ done: true, position: [0, 6.4, 8.6] });
  });
});

describe("an army taking the field", () => {
  it("stands not at all before the wave and wholly after it, whichever way it runs", () => {
    for (const from of ["a", "h", "flanks"] as const) for (let file = 0; file < 8; file++) for (const pawn of [true, false]) {
      expect(musterReveal(0, file, pawn, from)).toBe(0);
      expect(musterReveal(1, file, pawn, from)).toBe(1);
    }
  });

  it("crosses from one flank, each Pawn a beat behind its officer", () => {
    expect(musterReveal(0.3, 0, false, "a")).toBeGreaterThan(musterReveal(0.3, 4, false, "a"));
    expect(musterReveal(0.3, 7, false, "h")).toBeGreaterThan(musterReveal(0.3, 3, false, "h"));
    expect(musterReveal(0.2, 0, false, "a")).toBeGreaterThan(musterReveal(0.2, 0, true, "a"));
  });

  it("closes from both flanks on the King and Queen, who stand last", () => {
    const at = (wave: number, file: number, pawn = false) => musterReveal(wave, file, pawn, "flanks");
    expect(at(0.3, 0)).toBeGreaterThan(at(0.3, 2));
    expect(at(0.3, 7)).toBe(at(0.3, 0));
    // The Rooks are whole while the King and Queen have not begun; the royal Pawns are ahead of the royals.
    expect(at(0.45, 0)).toBe(1);
    expect(at(0.45, 3)).toBe(0);
    expect(at(0.45, 4)).toBe(0);
    expect(at(0.8, 3, true)).toBeGreaterThan(at(0.8, 3));
  });
});
