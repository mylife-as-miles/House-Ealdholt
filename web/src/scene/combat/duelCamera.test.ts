import { describe, expect, it } from "vitest";
import {
  DUEL_SHOT, DUEL_TIMING, DuelCameraTimeline, killVisible, lineNormal, planDuelShot, projectToFrame, rankDuelShots, segmentDistance, sightBlocked,
  type CameraPose, type DuelKill, type DuelObstacle, type DuelShotInput, type Vec3,
} from "./duelCamera";

const TILE = 1.02, PAWN = 0.78;
/** Board square (file 0..7 from a, rank 0..7 from 1) to world, as board.ts lays it out. */
const square = (file: number, rank: number): Vec3 => ({ x: (file - 3.5) * TILE, y: 0, z: (3.5 - rank) * TILE });
const WHITE_VIEW = { position: { x: 0, y: 8.6, z: 9.4 }, target: { x: 0, y: 0, z: 0 } };
const BLACK_VIEW = { position: { x: 0, y: 8.6, z: -9.4 }, target: { x: 0, y: 0, z: 0 } };
const DIRECTIONS: [number, number][] = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];

/** A capture from one square to a neighbour, `df`/`dr` in files and ranks. */
function capture(file: number, rank: number, df: number, dr: number, extra: Partial<DuelShotInput> = {}): DuelShotInput {
  const from = square(file - df, rank - dr), victim = square(file, rank);
  const blow = { x: victim.x - from.x, z: victim.z - from.z }, length = Math.hypot(blow.x, blow.z);
  const reach = 0.52 * TILE;
  return {
    attackerStart: from, victim, blow,
    standoff: { x: victim.x - blow.x / length * reach, y: 0, z: victim.z - blow.z / length * reach },
    attackerHeight: PAWN, victimHeight: PAWN, fov: 46, aspect: 16 / 9,
    camera: WHITE_VIEW, bounds: { floor: 0, radius: 10.6 }, obstacles: [], ...extra,
  };
}

/** Every point a viewer must see: both fighters head to foot, and where the body lands. */
function subjects(input: DuelShotInput): Vec3[] {
  const length = Math.hypot(input.blow.x, input.blow.z);
  return [
    input.standoff, { ...input.standoff, y: input.attackerHeight },
    input.victim, { ...input.victim, y: input.victimHeight },
    { x: input.victim.x + input.blow.x / length * input.victimHeight * 0.9, y: 0, z: input.victim.z + input.blow.z / length * input.victimHeight * 0.9 },
  ];
}

function expectFramed(input: DuelShotInput, view: CameraPose, edge: number): void {
  for (const point of subjects(input)) {
    const seen = projectToFrame(view, input.aspect, point);
    expect(seen.depth).toBeGreaterThan(0.2);
    expect(Math.abs(seen.x)).toBeLessThanOrEqual(edge);
    expect(Math.abs(seen.y)).toBeLessThanOrEqual(edge);
  }
}

const sideOf = (input: DuelShotInput, point: Vec3): number => {
  const normal = lineNormal(input.blow);
  const midX = (input.standoff.x + input.victim.x) / 2, midZ = (input.standoff.z + input.victim.z) / 2;
  return (point.x - midX) * normal.x + (point.z - midZ) * normal.z;
};

describe("planDuelShot", () => {
  it("frames both fighters with margin for a blow in each of the 8 directions, before and after the push-in", () => {
    for (const [df, dr] of DIRECTIONS) for (const camera of [WHITE_VIEW, BLACK_VIEW]) {
      const input = capture(3, 4, df, dr, { camera });
      const shot = planDuelShot(input);
      expectFramed(input, shot, 1 - DUEL_SHOT.margin + 1e-6);
      expectFramed(input, { ...shot, position: shot.push }, 1 - DUEL_SHOT.margin + 1e-6);
    }
  });

  it("fills about half to 60% of the frame height with the fighters on a wide screen, and never more", () => {
    for (const [df, dr] of DIRECTIONS) {
      const shot = planDuelShot(capture(3, 4, df, dr));
      expect(shot.fill).toBeGreaterThanOrEqual(0.45);
      expect(shot.fill).toBeLessThanOrEqual(0.6);
      // The push-in closes 8% of the distance: still inside 60% or so.
      expect(shot.fill / (1 - DUEL_SHOT.push)).toBeLessThanOrEqual(0.66);
    }
    // A phone held upright has to stand further back to fit the pair across: smaller, never cropped.
    const tall = capture(3, 4, 1, 1, { aspect: 9 / 19.5, fov: 62 });
    const shot = planDuelShot(tall);
    expect(shot.fov).toBe(DUEL_SHOT.maxFov);
    expect(shot.fill).toBeGreaterThan(0.2);
    expectFramed(tall, shot, 1 - DUEL_SHOT.margin + 1e-6);
  });

  it("frames fights on every edge and in every corner, inside the arena and above the board", () => {
    const spots: [number, number][] = [[0, 0], [7, 0], [0, 7], [7, 7], [0, 3], [7, 4], [3, 0], [4, 7]];
    for (const [file, rank] of spots) for (const [df, dr] of DIRECTIONS) {
      if (file - df < 0 || file - df > 7 || rank - dr < 0 || rank - dr > 7) continue;
      for (const camera of [WHITE_VIEW, BLACK_VIEW]) {
        const input = capture(file, rank, df, dr, { camera });
        const shot = planDuelShot(input);
        expectFramed(input, shot, 1 - DUEL_SHOT.margin + 1e-6);
        expect(shot.confined).toBe(false);
        expect(Math.hypot(shot.position.x, shot.position.z)).toBeLessThanOrEqual(input.bounds.radius + 1e-9);
        expect(shot.position.y).toBeGreaterThanOrEqual(DUEL_SHOT.clearance);
        expect(shot.push.y).toBeGreaterThanOrEqual(DUEL_SHOT.clearance);
      }
    }
  });

  it("looks slightly down from a three-quarter angle", () => {
    for (const [df, dr] of DIRECTIONS) {
      const shot = planDuelShot(capture(3, 4, df, dr));
      const drop = shot.position.y - shot.target.y, flat = Math.hypot(shot.position.x - shot.target.x, shot.position.z - shot.target.z);
      const pitch = Math.atan2(drop, flat) * 180 / Math.PI;
      expect(pitch).toBeGreaterThanOrEqual(20);
      expect(pitch).toBeLessThanOrEqual(35);
      expect(pitch).toBeCloseTo(shot.pitch, 6);
      expect(Math.abs(shot.lean)).toBeGreaterThanOrEqual(25);
      expect(Math.abs(shot.lean)).toBeLessThanOrEqual(55);
    }
  });

  it("stays on the player's side of the blow line", () => {
    const views = [WHITE_VIEW, BLACK_VIEW, { position: { x: 9, y: 6, z: 3 }, target: { x: 0, y: 0, z: 0 } }, { position: { x: -7, y: 4, z: -6 }, target: { x: 1, y: 0, z: 1 } }];
    let checked = 0;
    for (const camera of views) for (const [file, rank] of [[3, 4], [0, 0], [7, 6], [5, 1]]) for (const [df, dr] of DIRECTIONS) {
      if (file - df < 0 || file - df > 7 || rank - dr < 0 || rank - dr > 7) continue;
      const input = capture(file, rank, df, dr, { camera });
      const player = sideOf(input, camera.position);
      if (Math.abs(player) < 0.05) continue; // looking straight down the line: neither side is across it
      const shot = planDuelShot(input);
      expect(Math.sign(sideOf(input, shot.position))).toBe(Math.sign(player));
      expect(Math.sign(sideOf(input, shot.push))).toBe(Math.sign(player));
      expect(shot.side).toBe(Math.sign(player));
      checked += 1;
    }
    expect(checked).toBeGreaterThan(80);
  });

  it("keeps to the player's side even when a piece blocks the view from there", () => {
    const open = capture(3, 4, 1, 1);
    const clear = planDuelShot(open);
    const wall: DuelObstacle[] = [0.35, 0.6, 0.85].map(t => ({
      x: clear.target.x + (clear.position.x - clear.target.x) * t, z: clear.target.z + (clear.position.z - clear.target.z) * t, radius: 0.3, height: 1.1,
    }));
    const shot = planDuelShot({ ...open, obstacles: wall });
    expect(shot.side).toBe(clear.side);
  });

  it("takes the least blocked of its angles", () => {
    const open = capture(3, 4, 1, 1);
    const clear = planDuelShot(open);
    expect(clear.occlusion).toBe(0);
    expect(clear.lean).toBe(DUEL_SHOT.leans[0] * Math.sign(clear.lean));
    // A tall piece standing right on the preferred sight line.
    const blocker: DuelObstacle = {
      x: clear.target.x + (clear.position.x - clear.target.x) * 0.7, z: clear.target.z + (clear.position.z - clear.target.z) * 0.7, radius: 0.2, height: 1.12,
    };
    const blockedBefore = { ...open, obstacles: [blocker] };
    expect(sightBlocked(clear.position, { ...open.victim, y: PAWN * 0.55 }, blocker) || sightBlocked(clear.position, { ...open.standoff, y: PAWN * 0.55 }, blocker)).toBe(true);
    const shot = planDuelShot(blockedBefore);
    expect(shot.occlusion).toBe(0);
    expect([shot.lean, shot.pitch]).not.toEqual([clear.lean, clear.pitch]);
    expect(shot.side).toBe(clear.side);
    expectFramed(blockedBefore, shot, 1 - DUEL_SHOT.margin + 1e-6);
    // The opening position: sixteen pieces a side around an e4xd5 fight; nothing may stand in the way.
    const ranks: DuelObstacle[] = [];
    for (let file = 0; file < 8; file++) for (const rank of [0, 1, 6, 7]) {
      if ((file === 4 && rank === 1) || (file === 3 && rank === 6)) continue;
      const at = square(file, rank);
      ranks.push({ x: at.x, z: at.z, radius: 0.27 * TILE, height: rank === 1 || rank === 6 ? PAWN : 1 });
    }
    for (const camera of [WHITE_VIEW, BLACK_VIEW]) expect(planDuelShot(capture(3, 4, -1, 1, { camera, obstacles: ranks })).occlusion).toBe(0);
  });

  it("stays inside a small arena rather than backing through its wall", () => {
    const input = capture(7, 7, 1, 1, { bounds: { floor: 0, radius: 5.2 }, camera: { position: { x: 9, y: 5, z: -9 }, target: { x: 0, y: 0, z: 0 } } });
    const shot = planDuelShot(input);
    expect(Math.hypot(shot.position.x, shot.position.z)).toBeLessThanOrEqual(5.2 + 1e-9);
    expect(shot.position.y).toBeGreaterThan(0.3);
    // A raised floor lifts the whole shot with it.
    const level = planDuelShot(capture(3, 4, 1, 1));
    const raised = planDuelShot(capture(3, 4, 1, 1, { bounds: { floor: 2, radius: 10.6 }, camera: { position: { ...WHITE_VIEW.position, y: 10.6 }, target: { x: 0, y: 2, z: 0 } } }));
    expect(raised.position.y).toBeCloseTo(level.position.y + 2, 9);
    expect(raised.target.y).toBeCloseTo(level.target.y + 2, 9);
  });

  it("is deterministic and does not touch its input", () => {
    for (const [df, dr] of DIRECTIONS) {
      const input = capture(2, 5, df, dr, { obstacles: [{ x: 0.3, z: -1, radius: 0.28, height: 1 }, { x: -1.2, z: -2.1, radius: 0.28, height: 0.78 }] });
      const frozen = JSON.stringify(input);
      const first = planDuelShot(input), second = planDuelShot(JSON.parse(frozen) as DuelShotInput);
      expect(second).toEqual(first);
      expect(JSON.stringify(input)).toBe(frozen);
      for (const value of [first.position.x, first.position.y, first.position.z, first.fov, first.distance]) expect(Number.isFinite(value)).toBe(true);
    }
  });

  it("frames taller fighters and a blow with no direction", () => {
    const input = capture(3, 4, 1, 0, { attackerHeight: 1.12, victimHeight: 1.0 });
    expectFramed(input, planDuelShot(input), 1 - DUEL_SHOT.margin + 1e-6);
    const still = planDuelShot({ ...capture(3, 4, 1, 0), blow: { x: 0, z: 0 } });
    expect(Number.isFinite(still.position.x + still.position.y + still.position.z)).toBe(true);
  });
});

describe("DuelCameraTimeline", () => {
  const home: CameraPose = { position: { x: 0.1, y: 8.6, z: 9.4 }, target: { x: 0.2, y: 0.3, z: -0.1 }, fov: 46.5 };
  const shot = planDuelShot(capture(3, 4, 1, 1));
  const run = (timeline: DuelCameraTimeline, seconds: number, step: number) => {
    let pose = timeline.current;
    for (let left = seconds; left > 1e-9; left -= step) pose = timeline.update(Math.min(step, left));
    return pose;
  };

  it("eases in, holds, pushes in on the blow, holds, and ends on the home pose exactly", () => {
    const timeline = new DuelCameraTimeline(home, shot);
    expect(timeline.current).toEqual(home);
    const half = run(timeline, DUEL_TIMING.easeIn / 2, 1 / 60);
    expect(timeline.phase).toBe("in");
    expect(half.position.y).toBeLessThan(home.position.y);
    expect(half.position.y).toBeGreaterThan(shot.position.y);
    const held = run(timeline, DUEL_TIMING.easeIn / 2 + 0.5, 1 / 60);
    expect(timeline.phase).toBe("hold");
    expect(held.position).toEqual(shot.position);
    expect(held.target).toEqual(shot.target);
    expect(run(timeline, 1, 1 / 60)).toEqual(held);
    timeline.push();
    const pushed = run(timeline, DUEL_TIMING.push + 0.1, 1 / 60);
    expect(pushed.position).toEqual(shot.push);
    expect(run(timeline, 1.5, 1 / 60)).toEqual(pushed);
    timeline.release();
    expect(timeline.leaving).toBe(true);
    const leaving = run(timeline, DUEL_TIMING.easeOut / 2, 1 / 60);
    expect(leaving.position.y).toBeGreaterThan(shot.position.y);
    expect(timeline.done).toBe(false);
    expect(run(timeline, DUEL_TIMING.easeOut / 2 + 0.05, 1 / 60)).toEqual(home);
    expect(timeline.done).toBe(true);
    expect(timeline.update(5)).toEqual(home);
  });

  it("is at the same place at the same time whatever the frame rate", () => {
    const at = (step: number) => {
      const timeline = new DuelCameraTimeline(home, shot);
      run(timeline, 1.2, step); timeline.push(); run(timeline, 0.6, step); timeline.release();
      return run(timeline, 0.4, step);
    };
    const smooth = at(1 / 120), rough = at(1 / 10);
    for (const axis of ["x", "y", "z"] as const) {
      expect(rough.position[axis]).toBeCloseTo(smooth.position[axis], 6);
      expect(rough.target[axis]).toBeCloseTo(smooth.target[axis], 6);
    }
  });

  it("snaps home from any phase and then stays there", () => {
    for (const lead of [0.2, 1.1, 2]) {
      const timeline = new DuelCameraTimeline(home, shot);
      run(timeline, lead, 1 / 60); if (lead > 1.5) timeline.push();
      timeline.snap();
      expect(timeline.update(0)).toEqual(home);
      timeline.push(); timeline.release();
      expect(timeline.update(1)).toEqual(home);
    }
  });

  it("cuts straight to a beat moved to in no time: the next frame is on it, with nothing in between (the phoenix's close beat)", () => {
    const timeline = new DuelCameraTimeline(home, shot);
    run(timeline, 1.5, 1 / 60);
    const close: CameraPose = { position: { x: 2, y: 1.4, z: -3 }, target: { x: 2.5, y: 2.2, z: -4 }, fov: 30 };
    timeline.moveTo(close, 0);
    expect(timeline.update(1 / 60)).toEqual(close);
    expect(timeline.phase).toBe("hold");
    expect(run(timeline, 1, 1 / 60)).toEqual(close);
    // The next beat still moves: half way there it is between the two.
    timeline.moveTo(shot, 0.95);
    const midway = run(timeline, 0.45, 1 / 60);
    const gap = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z), whole = gap(close.position, shot.position);
    expect(gap(midway.position, close.position)).toBeGreaterThan(0.2 * whole);
    expect(gap(midway.position, shot.position)).toBeGreaterThan(0.2 * whole);
  });

  it("starts from where a returning shot left the camera but remembers the real home", () => {
    const first = new DuelCameraTimeline(home, shot);
    run(first, 1.5, 1 / 60); first.release();
    const midway = run(first, 0.3, 1 / 60);
    const second = new DuelCameraTimeline(first.home, shot, { from: midway });
    expect(second.current).toEqual(midway);
    run(second, 1.5, 1 / 60); second.release();
    expect(run(second, 1, 1 / 60)).toEqual(home);
  });
});

describe("seeing the killing blow", () => {
  /** The two fighters at the kill, as the engine forecasts them: the killer's trunk, spear arm and shield, the victim's trunk; the spear enters the near face of the chest. */
  function kill(input: DuelShotInput): DuelKill {
    const length = Math.hypot(input.blow.x, input.blow.z), ax = input.blow.x / length, az = input.blow.z / length;
    // The left of a figure facing along (x, z) is (z, -x): the shield is on that arm.
    const at = (base: Vec3, along: number, left: number, y: number): Vec3 => ({ x: base.x + ax * along + az * left, y, z: base.z + az * along - ax * left });
    const k = input.standoff, v = input.victim;
    return {
      contact: at(v, -0.09, 0, 0.45),
      bodies: [
        { a: at(k, 0, 0, 0.12), b: at(k, 0, 0, 0.74), radius: 0.16 },
        { a: at(k, 0.05, -0.12, 0.55), b: at(k, 0.25, -0.1, 0.5), radius: 0.07 },
        { a: at(k, 0.2, 0.15, 0.48), b: at(k, 0.2, 0.15, 0.48), radius: 0.2, normal: { x: ax, y: 0, z: az } },
        { a: at(v, 0, 0, 0.12), b: at(v, 0, 0, 0.74), radius: 0.08 },
      ],
    };
  }

  it("measures the gap between two segments", () => {
    expect(segmentDistance({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 0.5, y: 1, z: -1 }, { x: 0.5, y: 1, z: 1 })).toBeCloseTo(1);
    expect(segmentDistance({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }, { x: 3, y: 0, z: 0 })).toBeCloseTo(1);
    expect(segmentDistance({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 2, z: 0 }, { x: 0, y: 2, z: 0 })).toBeCloseTo(2);
  });

  it("knows an eye behind the killer cannot see where his spear goes in", () => {
    const input = capture(3, 4, 0, 1), k = kill(input);
    const behind = { x: input.standoff.x, y: 0.6, z: input.standoff.z + 2.5 };   // straight behind him, at chest height
    const beside = { x: input.standoff.x + 2.5, y: 0.9, z: (input.standoff.z + input.victim.z) / 2 };
    expect(killVisible(behind, k)).toBe(false);
    expect(killVisible(beside, k)).toBe(true);
    // A shield is a disc, not a ball: looking along its face it hides nothing, looking through it it hides the blow.
    const disc: DuelKill = { contact: k.contact, bodies: [{ a: { x: k.contact.x + 0.3, y: k.contact.y, z: k.contact.z }, b: k.contact, radius: 0.2, normal: { x: 1, y: 0, z: 0 } }] };
    expect(killVisible({ x: k.contact.x + 2, y: k.contact.y, z: k.contact.z }, disc)).toBe(false);
    expect(killVisible({ x: k.contact.x + 0.3, y: k.contact.y, z: k.contact.z + 2 }, disc)).toBe(true);
    // From behind the victim his own body covers the wound.
    expect(killVisible({ x: input.victim.x, y: 0.6, z: input.victim.z - 2.5 }, k)).toBe(false);
  });

  it("takes a shot the contact point is seen from, in every direction and from either player's seat", () => {
    for (const [df, dr] of DIRECTIONS) for (const camera of [WHITE_VIEW, BLACK_VIEW]) {
      const base = capture(3, 4, df, dr, { camera }), input = { ...base, kill: kill(base) };
      const shot = planDuelShot(input);
      expect(shot.killSeen).toBe(true);
      expect(killVisible(shot.position, input.kill)).toBe(true); expect(killVisible(shot.push, input.kill)).toBe(true);
      expectFramed(input, shot, 1 - DUEL_SHOT.margin + 1e-6);
    }
  });

  it("stays on the player's side of the line when the kill can be seen from there, and crosses it only when it cannot", () => {
    const base = capture(3, 4, 1, 1), own = Math.sign(sideOf(base, WHITE_VIEW.position));
    const seen = planDuelShot({ ...base, kill: kill(base) });
    expect(Math.sign(sideOf(base, seen.position))).toBe(own);
    // A wall of a body all along the player's side of the contact: nothing on that side shows it.
    const normal = lineNormal(base.blow), k = kill(base);
    const wall = { a: { x: k.contact.x + normal.x * own * 0.3 - base.blow.x, y: 0.45, z: k.contact.z + normal.z * own * 0.3 - base.blow.z }, b: { x: k.contact.x + normal.x * own * 0.3 + base.blow.x, y: 0.45, z: k.contact.z + normal.z * own * 0.3 + base.blow.z }, radius: 0.28 };
    const blocked = { ...base, kill: { contact: k.contact, bodies: [...k.bodies, wall] } };
    const crossed = planDuelShot(blocked);
    expect(crossed.killSeen).toBe(true);
    expect(Math.sign(sideOf(base, crossed.position))).toBe(-own);
    // Crossing costs more than any angle on the player's side that shows the blow.
    const ranked = rankDuelShots({ ...base, kill: kill(base) });
    const firstFar = ranked.findIndex(item => item.shot.side !== seen.side);
    expect(ranked.slice(0, firstFar).every(item => item.shot.side === seen.side)).toBe(true);
    expect(ranked[0].shot).toEqual(seen);
  });

  it("keeps the fall in frame when the victim is struck off his square", () => {
    for (const [df, dr] of DIRECTIONS) {
      const base = capture(3, 4, df, dr), length = Math.hypot(base.blow.x, base.blow.z);
      // Knocked back a quarter of a square along the blow before the spear comes.
      const victimAt = { x: base.victim.x + base.blow.x / length * 0.27 * TILE, y: 0, z: base.victim.z + base.blow.z / length * 0.27 * TILE };
      const shot = planDuelShot({ ...base, kill: { ...kill(base), victimAt } });
      const landed = { x: victimAt.x + base.blow.x / length * PAWN * 0.9, y: 0, z: victimAt.z + base.blow.z / length * PAWN * 0.9 };
      for (const view of [shot, { ...shot, position: shot.push }]) {
        const seen = projectToFrame(view, base.aspect, landed);
        expect(Math.abs(seen.x)).toBeLessThanOrEqual(1 - DUEL_SHOT.margin + 1e-6); expect(Math.abs(seen.y)).toBeLessThanOrEqual(1 - DUEL_SHOT.margin + 1e-6);
      }
    }
  });

  it("is the shot it always was when no kill is forecast", () => {
    for (const [df, dr] of DIRECTIONS) {
      const input = capture(3, 4, df, dr), shot = planDuelShot(input);
      expect(shot.killSeen).toBe(true);
      expect(Math.sign(sideOf(input, shot.position)) === Math.sign(sideOf(input, WHITE_VIEW.position)) || Math.abs(sideOf(input, WHITE_VIEW.position)) < 0.06).toBe(true);
      expect(Math.abs(shot.lean)).toBe(DUEL_SHOT.leans[0]);
    }
  });
});
