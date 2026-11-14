import { describe, expect, it } from "vitest";

import { BADGE_SCALE, crestPresence } from "./rankBadges";

/**
 * The height on screen of one board square stood on end, as a fraction of the picture's height, for a figure
 * `distance` from a camera with a vertical field of view of `fov` degrees (what PieceView measures as it is drawn).
 */
const screenUnit = (distance: number, fov = 46) => 0.5 / Math.tan((fov * Math.PI) / 360) / distance;

/** Distance from the play camera (0, 6.4, 8.6) to the middle of a rank, for the side sitting behind rank 1. */
const toRank = (rank: number) => Math.hypot(6.4, 8.6 - (3.5 - (rank - 1)) * 1.02);

describe("rank crests", () => {
  it("shows a crest in full over a small figure and not at all over a large one", () => {
    expect(crestPresence(0.05)).toBe(1);
    expect(crestPresence(0.095)).toBe(1);
    expect(crestPresence(0.125)).toBe(0);
    expect(crestPresence(0.3)).toBe(0);
  });

  it("fades steadily between the two, never the wrong way", () => {
    let last = 1;
    for (let unit = 0.09; unit <= 0.13; unit += 0.001) {
      const now = crestPresence(unit);
      expect(now).toBeLessThanOrEqual(last + 1e-9);
      expect(now).toBeGreaterThanOrEqual(0);
      last = now;
    }
  });

  it("labels the far side of the board from where a game is played, and leaves the player's own figures clear", () => {
    // The opponent's back two ranks: a few dozen pixels tall, the figures a crest is for.
    expect(crestPresence(screenUnit(toRank(8)))).toBe(1);
    expect(crestPresence(screenUnit(toRank(7)))).toBe(1);
    // The player's own two ranks: large enough to know by their shape.
    expect(crestPresence(screenUnit(toRank(2)))).toBe(0);
    expect(crestPresence(screenUnit(toRank(1)))).toBe(0);
    // In between a crest is part-way: it fades as a figure advances, it does not blink.
    const middle = crestPresence(screenUnit(toRank(5)));
    expect(middle).toBeGreaterThan(0);
    expect(middle).toBeLessThan(1);
  });

  it("comes back when the camera pulls away and goes when it closes in", () => {
    expect(crestPresence(screenUnit(19))).toBe(1);
    expect(crestPresence(screenUnit(4))).toBe(0);
  });

  it("keeps a pawn's crest smallest and the king's largest", () => {
    expect(BADGE_SCALE.p).toBeLessThan(BADGE_SCALE.n);
    expect(BADGE_SCALE.k).toBeGreaterThan(BADGE_SCALE.q);
  });
});
