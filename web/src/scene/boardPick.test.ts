import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { squareToWorld } from "./board";
import { BODY_RADIUS, rayOnBody, resolvePick, type FigureHit } from "./boardPick";
import { PIECE_HEIGHT } from "./pieces";

const pick = (figures: FigureHit[], tile: string | null, wanted: string[] = [], own: string[] = []) =>
  resolvePick({ figures, tile, wanted: (square) => wanted.includes(square), own: (square) => own.includes(square) });

describe("which square a press is meant for", () => {
  it("gives a lit destination to the press, not to the box of the figure standing in front of it", () => {
    // The Knight on g1 is in hand; the pointer is on f3, inside the box of the Pawn on f2 but not on the Pawn.
    expect(pick([{ square: "f2", body: false }], "f3", ["f3", "h3"], ["f2", "g2"])).toBe("f3");
  });

  it("still picks up the figure the pointer is on, whatever lies behind it", () => {
    expect(pick([{ square: "f2", body: true }], "f3", ["f3", "h3"], ["f2", "g2"])).toBe("f2");
    // With nothing in hand the box alone is enough: a figure is easy to pick up.
    expect(pick([{ square: "f2", body: false }], "f3", [], ["f2"])).toBe("f2");
  });

  it("takes the piece the pointer is on rather than the one whose box it crosses first", () => {
    // Past the edge of the box on d4 (a piece of the mover's own), the pointer is on the enemy on d5.
    expect(pick([{ square: "d4", body: false }, { square: "d5", body: true }], "d6", ["d5"], ["d4"])).toBe("d5");
    // Near both and on neither: the capture, before another piece to pick up.
    expect(pick([{ square: "d4", body: false }, { square: "d5", body: false }], "d6", ["d5"], ["d4"])).toBe("d5");
  });

  it("goes to the open tile seen beside a figure that could be taken, and to the figure when the pointer is on it", () => {
    const beside: FigureHit[] = [{ square: "e5", body: false }];
    expect(pick(beside, "e6", ["e5", "e6"], [])).toBe("e6");
    expect(pick([{ square: "e5", body: true }], "e6", ["e5", "e6"], [])).toBe("e5");
    // The tile behind is not a destination: the box is as good as the figure.
    expect(pick(beside, "e6", ["e5"], [])).toBe("e5");
  });

  it("looks past a figure that cannot be played to one that can", () => {
    // An enemy in front, one of the mover's pieces behind it, nothing in hand.
    expect(pick([{ square: "c6", body: true }, { square: "c7", body: true }], "c8", [], ["c7"])).toBe("c7");
  });

  it("falls back to what is nearest, as it always did", () => {
    expect(pick([{ square: "a7", body: true }], "a8")).toBe("a7");
    expect(pick([], "c4")).toBe("c4");
    expect(pick([], null)).toBeNull();
    // A piece in hand and a press on a square it cannot go to: that square is reported, and the press is refused.
    expect(pick([], "c4", ["c3"], ["c2"])).toBe("c4");
  });
});

describe("whether the pointer is on a figure", () => {
  const camera = new THREE.Vector3(0, 6.4, 8.6);
  const rayTo = (point: THREE.Vector3) => new THREE.Ray(camera.clone(), point.clone().sub(camera).normalize());

  it("is, through its body from feet to head", () => {
    const at = squareToWorld("f2");
    for (const height of [0.05, 0.4, PIECE_HEIGHT.p - 0.02]) expect(rayOnBody(rayTo(at.clone().setY(height)), at, "p")).toBe(true);
  });

  it("is not, on the middle of the tile behind it: the box covers that, the figure does not", () => {
    const pawn = squareToWorld("f2");
    const ray = rayTo(squareToWorld("f3"));
    // The ray does cross the Pawn's box (0.86 wide, 1.1 times its height)...
    const box = new THREE.Box3().setFromCenterAndSize(pawn.clone().setY(PIECE_HEIGHT.p * 0.55), new THREE.Vector3(0.86, PIECE_HEIGHT.p * 1.1, 0.86));
    expect(ray.intersectsBox(box)).toBe(true);
    // ...and misses the Pawn.
    expect(rayOnBody(ray, pawn, "p")).toBe(false);
  });

  it("ends at the top of the head, so a figure seen over it can be pointed at", () => {
    const king = squareToWorld("e1");
    // Just under the crown, and just over it.
    expect(rayOnBody(rayTo(king.clone().setY(PIECE_HEIGHT.k - 0.03)), king, "k")).toBe(true);
    const over = new THREE.Ray(new THREE.Vector3(0, PIECE_HEIGHT.k + 0.04, 9), new THREE.Vector3(0, 0, -1));
    expect(rayOnBody(over, king.clone().setX(0), "k")).toBe(false);
  });

  it("takes every rank to be narrower than half its box", () => {
    for (const radius of Object.values(BODY_RADIUS)) {
      expect(radius).toBeGreaterThan(0.1);
      expect(radius).toBeLessThan(0.43 / 1.5);
    }
  });
});
