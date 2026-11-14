import assert from "node:assert/strict";
import test from "node:test";
import { FATALITY_SECONDS, sceneSecondsAt } from "../../web/src/scene/fatality/fatalityPlan";
import { FLUID, fluidLanding, fluidMarks, type Point } from "../../web/src/scene/fatality/fluidPlan";
import { STUMP, pourShares, stumpLaunch, stumpStart, stumpWound, type StumpChance, type StumpWound } from "../../web/src/scene/fatality/stumpPlan";
import { goreShow, type KillMoment, type TierSettings } from "../../web/src/scene/gore/goreTiers";
import { wyvernBeats } from "../../web/src/scene/rites/wyvern-path";

const FULL: TierSettings = { violence: "full", reducedMotion: false, captureCinematics: true };
const QUEENS: KillMoment = { attacker: "q", victim: "q", style: "summon" };
const QUALITIES = ["low", "medium", "high", "ultra"] as const;
const CHANCES: readonly StumpChance[] = ["none", "off", "may"];

/** A Queen (1.32 tall) standing at the stone's middle with her left arm off at the shoulder: the stump looks out to her side. */
const H = 1.32;
const SHOULDER: StumpWound = stumpWound({ joint: { x: 0.18, y: H * 0.78, z: 0.4 }, axis: { x: 1, y: -0.25, z: 0 }, radius: 0.05 }, H, 4242);
/** Her head off: the neck's stump looks up. */
const NECK: StumpWound = stumpWound({ joint: { x: 0, y: H * 0.86, z: 0.4 }, axis: { x: 0, y: 1, z: 0.1 }, radius: 0.06 }, H, 977);
const COUNT = pourShares(goreShow(QUEENS, FULL, "medium"), "off").stump;
const pour = (stump: StumpWound = SHOULDER, count = COUNT) => Array.from({ length: count }, (_, i) => stumpLaunch(stump, i, count));
const dot = (a: Point, b: Point) => a.x * b.x + a.y * b.y + a.z * b.z;
const minus = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const norm = (a: Point) => Math.hypot(a.x, a.y, a.z);

test("the budget: shared between the wound and a stump, never doubled; nothing without a fatality, or on Low", () => {
  for (const quality of QUALITIES) {
    const show = goreShow(QUEENS, FULL, quality), budget = show.fluid ? show.budget.fluid : 0;
    for (const chance of CHANCES) {
      const shares = pourShares(show, chance);
      assert.equal(shares.wound + shares.stump, budget, `${quality} ${chance}: the two pour the budget, no more`);
      assert.ok(shares.wound >= shares.stump, "the wound pours the larger share");
    }
    // No stump, nor any to come: the wound keeps it all, as it did before stumps poured.
    assert.deepEqual(pourShares(show, "none"), { wound: budget, stump: 0 });
    if (!budget) continue;
    for (const chance of ["off", "may"] as const) {
      const { stump } = pourShares(show, chance);
      assert.equal(stump, Math.floor(budget * STUMP.share), `${quality}: the stump's share is kept`);
    }
  }
  // Low affords no fluid: the plain sprays stand in for both.
  assert.deepEqual(pourShares(goreShow(QUEENS, FULL, "low"), "off"), { wound: 0, stump: 0 });
  // A limb off in an execution (tier 2, a Knight's cleaver) plays the cut, with no fatality: nothing pours from its stump.
  const cut = goreShow({ attacker: "n", victim: "n", style: "melee", weapon: "axe" }, FULL, "ultra");
  assert.equal(cut.sever && !cut.fatality, true);
  assert.deepEqual(pourShares(cut, "off"), { wound: 0, stump: 0 });
  // At Cinematic a Queen's fall is no fatality: nothing pours.
  assert.deepEqual(pourShares(goreShow(QUEENS, { ...FULL, violence: "cinematic" }, "ultra"), "off"), { wound: 0, stump: 0 });
  // Too small a budget to share: the wound keeps it all.
  assert.deepEqual(pourShares({ fatality: true, fluid: true, budget: { fluid: 500 } }, "off"), { wound: 500, stump: 0 });
});

test("when: with the wound when its limb came off first, as it comes off while the wound's blood runs, never later", () => {
  const kept = COUNT;
  assert.ok(kept >= STUMP.least);
  // A duel's blow and the dead's killing tearing take the limb on the frame the fatality begins: it pours with the wound.
  assert.equal(stumpStart(0, kept), 0);
  assert.equal(stumpStart(-0.02, kept), 0);
  // The wyvern tears a limb off as it feeds, well after its strike: after the fatality's own sequence is over (its slow
  // motion and its close shot), while the wound's blood still runs. The share kept for it pours then.
  const beats = wyvernBeats("eat"), tear = beats.tears[0] - beats.strike;
  assert.ok(tear > sceneSecondsAt(FATALITY_SECONDS), `the first tear (${tear}s) comes after the sequence (${sceneSecondsAt(FATALITY_SECONDS).toFixed(2)} scene s)`);
  assert.equal(stumpStart(tear, kept), tear);
  // Later than the wound's blood runs, or with nothing kept, the stump keeps its ordinary spurts alone.
  assert.equal(stumpStart(STUMP.within + 0.01, kept), null);
  assert.ok(STUMP.within < FLUID.gone);
  assert.equal(stumpStart(0.5, 0), null);
  assert.equal(stumpStart(0.5, STUMP.least - 1), null);
  assert.equal(stumpStart(Number.NaN, kept), null);
});

test("where: out of the cut's face, past the cap, along the stump's own bone", () => {
  const joint = { x: 0.18, y: H * 0.78, z: 0.4 }, axis = { x: 2, y: -0.5, z: 0 };
  const stump = stumpWound({ joint, axis, radius: 0.05 }, H, 4242);
  assert.ok(Math.abs(norm(stump.direction) - 1) < 1e-12, "the way out is a unit");
  const out = minus(stump.entry, joint);
  assert.ok(Math.abs(norm(out) - 0.05 * STUMP.out) < 1e-12 && dot(out, stump.direction) > 0, "a little out along it");
  assert.equal(stump.radius, 0.05);
  assert.equal(stump.height, H);
  assert.notEqual(stump.seed, 4242, "its own dice: its marks are not the wound's");
  assert.deepEqual(stumpWound({ joint, axis, radius: 0.05 }, H, 4242), stump);
});

test("how: the arteries' jets out along the axis on the heart's beat, a spill over the rim, nothing back into the body", () => {
  const a = pour(), b = pour();
  assert.deepEqual(a.slice(0, 60), b.slice(0, 60), "the same game pours the same way");
  assert.notDeepEqual(a.slice(0, 60), pour({ ...SHOULDER, seed: 7 }).slice(0, 60));
  const births = a.map(l => l.birth).sort((x, y) => x - y);
  assert.ok(births[0] >= 0 && births[births.length - 1] <= FLUID.pour + 1e-9, "it pours as long as the wound does");
  assert.ok(births[Math.floor(births.length / 2)] < FLUID.pour * 0.45, "most of it in the first moments");
  const axis = SHOULDER.direction;
  const angles = a.map(l => Math.acos(Math.min(1, dot(l.velocity, axis) / norm(l.velocity))));
  for (const [i, l] of a.entries()) {
    // Out of the cut's face: within its rim, across the cut, never inside the body.
    const off = minus(l.origin, SHOULDER.entry);
    assert.ok(Math.abs(dot(off, axis)) <= H * 0.0021, "on the face of the cut");
    assert.ok(norm(off) <= SHOULDER.radius * 1.01 + H * 0.0021, "within its rim");
    assert.ok(angles[i] < Math.PI / 2, "out of the stump, never back into the body");
    const speed = norm(l.velocity);
    assert.ok(speed > 0 && speed <= H * STUMP.fastest * (1 + FLUID.even) + 1e-9, `speed ${speed}`);
    assert.ok(l.size > 0 && l.size < H * FLUID.radius * 1.4 && l.drag === FLUID.drag);
  }
  // Most of it in ropes close round the axis; the spill wells wider, but no wider than it may.
  const close = angles.filter(angle => angle < 0.45).length;
  assert.ok(close > a.length * (1 - STUMP.spill - FLUID.loose), `${close} of ${a.length} close round the axis`);
  assert.ok(angles.some(angle => angle > 0.6), "some wells over the rim");
  assert.ok(Math.max(...angles) <= STUMP.spillSpread + 1e-9);
  // Two ropes, not a fan: round the axis, the jets' drops keep to their arteries' sides. Of twelve sectors round it, the
  // two fullest hold most of them (a fan would put a sixth there).
  const across = { x: 0, y: 0, z: 1 }, over = { x: -axis.y, y: axis.x, z: 0 };
  assert.ok(Math.abs(dot(across, axis)) < 1e-9);
  const sectors = new Array(12).fill(0);
  const ropes = a.filter((_, i) => angles[i] < 0.45);
  for (const l of ropes) sectors[Math.floor(((Math.atan2(dot(l.velocity, over), dot(l.velocity, across)) + Math.PI) / (Math.PI * 2)) * 12) % 12] += 1;
  const fullest = [...sectors].sort((x, y) => y - x);
  assert.ok(fullest[0] + fullest[1] > ropes.length * 0.45, `the two fullest sectors hold ${fullest[0] + fullest[1]} of ${ropes.length}`);
});

test("where it lands: a shoulder's stump throws its blood out beside the body, a neck's falls round it, and both leave marks", () => {
  for (const [name, stump] of [["shoulder", SHOULDER], ["neck", NECK]] as const) {
    const launches = pour(stump);
    const landings = launches.map(l => fluidLanding(l, 0));
    assert.ok(landings.every(Boolean), `${name}: everything that leaves the stump comes down`);
    for (const landing of landings) {
      const away = Math.hypot(landing!.at.x - stump.entry.x, landing!.at.z - stump.entry.z);
      assert.ok(away < 1.02 * 2.2, `${name}: ${away.toFixed(2)} from the stump`);
    }
    const marks = fluidMarks(launches, 0, H, stump.seed);
    assert.ok(marks.stains.length > 0 && marks.stains.length <= FLUID.stains, `${name}: ${marks.stains.length} stains`);
    assert.ok(marks.pool, `${name}: it pools`);
    for (const stain of marks.stains) assert.ok(stain.born >= 0 && stain.born <= FLUID.pour && stain.born < stain.at);
  }
  // The shoulder's goes out to her side, the way the arm went.
  const side = pour(SHOULDER).map(l => fluidLanding(l, 0)!).filter(l => l.at.x > SHOULDER.entry.x).length;
  assert.ok(side > COUNT * 0.6, `${side} of ${COUNT} out to the side`);
});
