import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CROWD_BUDGET, MARCH_THEN_CHARGE, MUSTER_LIMIT, STEADY, assignSlots, bearing, crowdBudget, findPath, lineClear, marchState, pathLength,
  planCharge, planMarch, planSlots, planSpawns, pointOnPath, segmentDistance, shapeArea, shapeTravel, type ChargeInput, type Flat,
} from "../../web/src/scene/rites/armies/crowdPlan";
import { clearFrame, sightClearance } from "../../web/src/scene/rites/armies/shotPlan";
import { riteShot } from "../../web/src/scene/rites/riteShot";

const TILE = 1.02, HALF = 4 * TILE;
const tiers = ["low", "medium", "high", "ultra"] as const;
const FILES = "abcdefgh";
const sq = (name: string): Flat => ({ x: (FILES.indexOf(name[0]) - 3.5) * TILE, z: (3.5 - (Number(name[1]) - 1)) * TILE });
const distance = (a: Flat, b: Flat) => Math.hypot(a.x - b.x, a.z - b.z);
const OPENING = ["a1", "b1", "c1", "d1", "e1", "f1", "g1", "h1", "a2", "b2", "c2", "d2", "e2", "f2", "g2", "h2", "a7", "b7", "c7", "d7", "e7", "f7", "g7", "h7", "a8", "b8", "c8", "d8", "e8", "f8", "g8", "h8"];
/** The lead's take: after e2e4 g8f6 e4e5 f6e4 d1g4 a7a6 the white Queen on g4 takes the Knight on e4. */
const TAKE = ["a1", "b1", "c1", "e1", "f1", "g1", "h1", "a2", "b2", "c2", "d2", "f2", "g2", "h2", "e5", "g4", "a6", "b7", "c7", "d7", "e7", "f7", "g7", "h7", "a8", "b8", "c8", "d8", "e8", "f8", "h8"].map(sq);
const WHITE_EYE: Flat = { x: 0, z: 8.6 };
const CLEAR = 0.42;

/** Every point of a way is at least `clearance` from every obstacle, but for one the way's own end was already near. */
function wayClear(path: readonly Flat[], obstacles: readonly Flat[], clearance: number): string | null {
  for (let i = 1; i < path.length; i += 1) for (const o of obstacles) {
    const a = path[i - 1], b = path[i];
    const near = Math.min(distance(o, path[0]), distance(o, path[path.length - 1]));
    const allowed = Math.min(clearance, near) - 1e-6;
    if (segmentDistance(o, a, b) < allowed) return `leg ${i} passes ${segmentDistance(o, a, b).toFixed(3)} from ${JSON.stringify(o)}`;
  }
  return null;
}

const charge = (over: Partial<ChargeInput> = {}): ChargeInput => ({
  victim: sq("e4"), standing: TAKE, viewer: WHITE_EYE, count: 12, seed: 4242, half: HALF,
  spawn: { inner: 1.5, outer: 2.8 }, ring: { radii: [0.62, 0.98], spacing: 0.4 }, clearance: CLEAR, spacing: 0.45,
  rise: { from: 0.35, spread: 0.7, length: 0.55 }, arrive: { first: 1.55, spread: 0.45 }, gait: { top: 2.8, shape: MARCH_THEN_CHARGE, least: 0.5, most: 2.2 },
  ...over,
});

test("the crowd shrinks with the tier and never asks for more than the match lends", () => {
  for (let i = 1; i < tiers.length; i += 1) {
    assert.ok(CROWD_BUDGET[tiers[i]].troops > CROWD_BUDGET[tiers[i - 1]].troops, `troops at ${tiers[i]}`);
    assert.ok(CROWD_BUDGET[tiers[i]].extras > CROWD_BUDGET[tiers[i - 1]].extras, `extras at ${tiers[i]}`);
  }
  assert.ok(CROWD_BUDGET.low.troops * 3 <= CROWD_BUDGET.ultra.troops + 2, "the lowest tier has about a third of the soldiers");
  assert.ok(CROWD_BUDGET.low.troops >= 4, "still an army on the lowest tier");
  for (const tier of tiers) {
    assert.ok(CROWD_BUDGET[tier].troops + 1 <= MUSTER_LIMIT, "room for a colossus besides");
    assert.equal(crowdBudget(tier).troops, CROWD_BUDGET[tier].troops);
    assert.ok(crowdBudget(tier, 20).troops <= MUSTER_LIMIT - 20);
  }
});

test("soldiers rise in the band round the victim, clear of every piece and of each other, and lean toward the player", () => {
  const victim = sq("e4");
  for (const seed of [1, 2, 3, 99, 2026]) {
    const spawns = planSpawns({ centre: victim, standing: TAKE, count: 12, inner: 1.5, outer: 2.8, clearance: CLEAR, spacing: 0.45, bounds: HALF - 0.25, seed, favour: { x: 0 - victim.x, z: 8.6 - victim.z }, favourWeight: 0.5 });
    assert.ok(spawns.length >= 8, `seed ${seed}: only ${spawns.length} rose`);
    let lean = 0;
    for (const at of spawns) {
      const r = distance(at, victim);
      assert.ok(r >= 1.5 - 1e-9 && r <= 2.8 + 1e-9, `radius ${r}`);
      assert.ok(Math.abs(at.x) <= HALF - 0.25 && Math.abs(at.z) <= HALF - 0.25, "on the board");
      for (const piece of TAKE) assert.ok(distance(at, piece) >= CLEAR, `${JSON.stringify(at)} on a piece`);
      lean += (at.z - victim.z) / r;
    }
    for (let i = 0; i < spawns.length; i += 1) for (let j = i + 1; j < spawns.length; j += 1) assert.ok(distance(spawns[i], spawns[j]) >= 0.45 * 0.6 - 1e-9);
    assert.ok(lean / spawns.length > 0, `seed ${seed}: they should lean toward the player's side`);
    assert.deepEqual(planSpawns({ centre: victim, standing: TAKE, count: 12, inner: 1.5, outer: 2.8, clearance: CLEAR, spacing: 0.45, bounds: HALF - 0.25, seed, favour: { x: 0, z: 1 }, favourWeight: 0.5 }),
      planSpawns({ centre: victim, standing: TAKE, count: 12, inner: 1.5, outer: 2.8, clearance: CLEAR, spacing: 0.45, bounds: HALF - 0.25, seed, favour: { x: 0, z: 1 }, favourWeight: 0.5 }), "the same seed calls the same army");
  }
  // a crowded board leaves fewer places, never a soldier inside a piece
  const packed = planSpawns({ centre: sq("d4"), standing: OPENING.map(sq), count: 24, inner: 0.8, outer: 3.5, clearance: CLEAR, spacing: 0.45, bounds: HALF - 0.25, seed: 5 });
  for (const at of packed) for (const piece of OPENING.map(sq)) assert.ok(distance(at, piece) >= CLEAR);
  // and nobody rises where the rite keeps clear
  const zone = { at: sq("e6"), radius: 1.1 };
  for (const at of planSpawns({ centre: sq("e4"), standing: TAKE, count: 12, inner: 1.5, outer: 2.8, clearance: CLEAR, spacing: 0.45, bounds: HALF - 0.25, seed: 7, avoid: [zone] })) assert.ok(distance(at, zone.at) >= zone.radius);
});

test("the ring is a weapon's reach round the victim, all the way round, clear of the pieces beside it", () => {
  const victim = sq("e4");
  const open = planSlots({ centre: victim, standing: [], count: 8, radii: [0.62, 0.98], clearance: CLEAR, spacing: 0.4, bounds: HALF, seed: 3 });
  assert.equal(open.length, 8);
  const turns = open.map((slot) => bearing(victim, slot.at)).sort((a, b) => a - b);
  let gap = 0;
  for (let i = 0; i < turns.length; i += 1) gap = Math.max(gap, ((turns[(i + 1) % turns.length] - turns[i]) + Math.PI * 2) % (Math.PI * 2) || Math.PI * 2);
  assert.ok(gap < Math.PI * 0.75, `the victim is met from all sides (widest gap ${gap.toFixed(2)})`);
  for (const slot of open) {
    assert.ok(Math.abs(distance(slot.at, victim) - 0.62) < 1e-9 || Math.abs(distance(slot.at, victim) - 0.98) < 1e-9);
    const toward = { x: victim.x - slot.at.x, z: victim.z - slot.at.z }, d = Math.hypot(toward.x, toward.z);
    assert.ok(Math.abs(slot.facing.x - toward.x / d) < 1e-9 && Math.abs(slot.facing.z - toward.z / d) < 1e-9, "faces the victim");
  }
  const crowded = planSlots({ centre: victim, standing: TAKE, count: 14, radii: [0.62, 0.98], clearance: CLEAR * 0.92, spacing: 0.4, bounds: HALF, seed: 3 });
  assert.ok(crowded.length >= 8);
  for (const slot of crowded) for (const piece of TAKE) assert.ok(distance(slot.at, piece) >= CLEAR * 0.92 - 1e-9);
  for (let i = 0; i < crowded.length; i += 1) for (let j = i + 1; j < crowded.length; j += 1) assert.ok(distance(crowded[i].at, crowded[j].at) >= 0.4 * 0.98 - 1e-9);
});

test("each soldier takes the slot that keeps the ways from crossing", () => {
  const victim = sq("d5");
  const slots = planSlots({ centre: victim, standing: [], count: 8, radii: [0.62], clearance: CLEAR, spacing: 0.4, bounds: HALF, seed: 11 });
  const spawns = Array.from({ length: 8 }, (_, i) => ({ x: victim.x + Math.cos(i * 0.785 + 0.3) * 2.4, z: victim.z + Math.sin(i * 0.785 + 0.3) * 2.4 }));
  const assigned = assignSlots(spawns, slots, victim);
  assert.equal(new Set(assigned).size, 8, "one soldier a slot");
  const cross = (a: Flat, b: Flat, c: Flat, d: Flat) => {
    const o = (p: Flat, q: Flat, r: Flat) => Math.sign((q.x - p.x) * (r.z - p.z) - (q.z - p.z) * (r.x - p.x));
    return o(a, b, c) !== o(a, b, d) && o(c, d, a) !== o(c, d, b);
  };
  for (let i = 0; i < 8; i += 1) for (let j = i + 1; j < 8; j += 1) assert.ok(!cross(spawns[i], slots[assigned[i]].at, spawns[j], slots[assigned[j]].at), `ways ${i} and ${j} cross`);
  // more soldiers than slots: the extra ones hold
  const fewer = assignSlots(spawns, slots.slice(0, 5), victim);
  assert.equal(fewer.filter((k) => k >= 0).length, 5);
  assert.equal(new Set(fewer.filter((k) => k >= 0)).size, 5);
});

test("the way goes round the pieces, never through one, and is a straight line where it can be", () => {
  const obstacles = OPENING.map(sq).filter((p) => p.z < 0).concat([sq("d4"), sq("e4"), sq("d5")]);
  const straight = findPath(sq("a4"), sq("a5"), { obstacles, clearance: CLEAR, bounds: HALF - 0.2 });
  assert.equal(straight.length, 2);
  for (const [from, to] of [["c3", "f6"], ["a4", "h5"], ["d3", "d6"], ["b6", "g3"]] as const) {
    const path = findPath(sq(from), sq(to), { obstacles, clearance: CLEAR, bounds: HALF - 0.2 });
    assert.deepEqual(path[0], sq(from)); assert.deepEqual(path[path.length - 1], sq(to));
    const why = wayClear(path, obstacles, CLEAR);
    assert.equal(why, null, `${from} to ${to}: ${why}`);
    assert.ok(pathLength(path) < distance(sq(from), sq(to)) * 1.9, `${from} to ${to} is no long detour`);
    for (let i = 1; i < path.length - 1; i += 1) assert.ok(!lineClear(path[i - 1], path[i + 1], obstacles, CLEAR), "every corner is one it had to turn");
  }
  const half = pointOnPath([{ x: 0, z: 0 }, { x: 2, z: 0 }, { x: 2, z: 2 }], 3);
  assert.ok(Math.abs(half.at.x - 2) < 1e-9 && Math.abs(half.at.z - 1) < 1e-9 && half.heading.z === 1);
});

test("a march walks, then charges, and arrives on time from a standstill to a standstill", () => {
  assert.ok(Math.abs(shapeTravel(MARCH_THEN_CHARGE, 1).covered - 1) < 1e-9 && shapeTravel(MARCH_THEN_CHARGE, 0).covered === 0);
  assert.ok(shapeArea(STEADY) > shapeArea(MARCH_THEN_CHARGE));
  const path = [{ x: -2, z: 0 }, { x: 0, z: 0.5 }, { x: 0.4, z: 2 }];
  const march = planMarch(path, { riseAt: 0.3, riseFor: 0.5, settle: 0.1, arriveAt: 3, top: 2.8, least: 0.5, most: 2.2 });
  assert.ok(march.departAt >= 0.3 + 0.5 + 0.1 - 1e-9 && Math.abs(march.arriveAt - 3) < 1e-9);
  assert.ok(Math.abs(march.top - 2.8) < 1e-9, "a way it has time for is run at the gait's own top speed");
  let last = marchState(march, 0), phases: string[] = [last.phase];
  for (let t = 0; t <= 3.6; t += 1 / 120) {
    const now = marchState(march, t);
    assert.ok(distance(now.at, last.at) <= march.top / 120 * 1.05 + 1e-9, `no jump at ${t.toFixed(3)}`);
    assert.ok(now.speed <= march.top + 1e-9);
    if (phases[phases.length - 1] !== now.phase) phases.push(now.phase);
    last = now;
  }
  assert.deepEqual(phases, ["hidden", "rising", "waiting", "walking", "running", "arrived"]);
  assert.deepEqual(marchState(march, 3.0001).at, path[2]);
  // a soldier who rises late arrives late, but never sets off half-risen
  const late = planMarch(path, { riseAt: 1.8, riseFor: 0.5, arriveAt: 2, top: 2.8 });
  assert.ok(late.departAt >= 2.3 - 1e-9 && late.arriveAt > 2);
});

test("the whole charge: every soldier clear of the pieces at every moment, the ring closing raggedly, the nearest first", () => {
  for (const seed of [4242, 7, 31337]) {
    const plan = planCharge(charge({ seed }));
    assert.ok(plan.length >= 8, `seed ${seed}: ${plan.length} soldiers`);
    for (let i = 1; i < plan.length; i += 1) assert.ok(plan[i].near >= plan[i - 1].near, "nearest the player first");
    const arrivals = plan.map((c) => c.march.arriveAt);
    assert.ok(Math.min(...arrivals) >= 1.55 - 1e-9 && Math.max(...arrivals) - Math.min(...arrivals) > 0.15, "the ring closes over a beat, not on one frame");
    for (const c of plan) {
      assert.ok(c.slot, "this board has a slot for everyone");
      assert.ok(c.march.departAt >= c.march.riseAt + c.march.riseFor, "it has risen before it sets off");
      for (let t = 0; t <= 3; t += 1 / 30) {
        const at = marchState(c.march, t).at;
        for (const piece of TAKE) {
          const allowed = Math.min(CLEAR, distance(piece, c.slot!.at), distance(piece, c.spawn)) - 1e-6;
          assert.ok(distance(at, piece) >= allowed, `seed ${seed}: through a piece at ${t.toFixed(2)}`);
        }
        assert.ok(distance(at, sq("e4")) >= 0.62 - 0.03 - 1e-6, "round the victim, outside the ring, never through it");
      }
      const end = marchState(c.march, 3);
      assert.equal(end.phase, "arrived"); assert.deepEqual(end.at, c.slot!.at);
    }
  }
  assert.deepEqual(planCharge(charge()), planCharge(charge()), "the same capture calls the same charge");
  // a corner victim on a packed board: fewer soldiers, still none inside a piece
  const corner = planCharge(charge({ victim: sq("a8"), standing: OPENING.map(sq).filter((p) => distance(p, sq("a8")) > 0.1), count: 16 }));
  for (const c of corner) for (const piece of OPENING.map(sq).filter((p) => distance(p, sq("a8")) > 0.1)) assert.ok(distance(c.spawn, piece) >= CLEAR);
});

test("a shot is slid off the victim's file when a piece stands in line with it, and left alone when nothing does", () => {
  const victim = sq("e4"), eye = { x: 0, y: 6.4, z: 8.6 };
  const frame = [{ x: victim.x, y: 0, z: victim.z }, { x: victim.x, y: 1.35, z: victim.z }, { x: victim.x + 1.15, y: 0.2, z: victim.z }, { x: victim.x - 1.15, y: 0.2, z: victim.z }, { x: victim.x, y: 0.2, z: victim.z + 1.15 }, { x: victim.x, y: 0.2, z: victim.z - 1.15 }, { x: victim.x, y: 3.2, z: victim.z }];
  const input = { home: { position: eye, target: { x: victim.x, y: 0, z: victim.z } }, boardTop: 0, aspect: 16 / 9, fov: 46, radius: 10.6 };
  const inLine = [sq("e1"), sq("e2")];
  const knee = { x: victim.x, y: 0.35, z: victim.z };
  const before = riteShot(frame, input), slid = clearFrame(frame, { standing: inLine, viewer: eye, boardTop: 0, subject: [knee] }), after = riteShot(slid, input);
  assert.ok(sightClearance(before.position, knee, inLine, 0) < 0.2, "in line, the King's head and badge stand in front of the victim's legs");
  assert.ok(sightClearance(after.position, knee, inLine, 0) > 0.35, "slid, the victim is seen past them");
  assert.ok(Math.abs(slid[0].x - frame[0].x) <= 0.8 + 1e-9 && Math.abs(slid[0].z - frame[0].z) < 0.1, "slid sideways, a file at most");
  assert.deepEqual(clearFrame(frame, { standing: [sq("a8")], viewer: eye, boardTop: 0, subject: [knee] }), frame, "nothing in the way: unchanged");
  for (let i = 1; i < frame.length; i += 1) assert.ok(Math.abs((slid[i].x - frame[i].x) - (slid[0].x - frame[0].x)) < 1e-9 && slid[i].y === frame[i].y, "the whole frame moves together");
});
