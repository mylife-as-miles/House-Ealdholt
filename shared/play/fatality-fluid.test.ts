import assert from "node:assert/strict";
import test from "node:test";
import { FLUID, fluidLanding, fluidLaunch, fluidLevel, fluidMarks, pressure, type FluidWound } from "../../web/src/scene/fatality/fluidPlan";
import { flightPosition, GORE_GRAVITY } from "../../web/src/scene/gore/ballistics";
import { goreBudget } from "../../web/src/scene/gore/goreTiers";

const H = 0.78;
/** A spear thrust into a Pawn's chest from in front (+z), going in along -z, through the body. */
const WOUND: FluidWound = { entry: { x: 0.4, y: H * 0.62, z: 1.1 }, direction: { x: 0, y: 0, z: -1 }, depth: H * 0.22, height: H, seed: 4242 };
const COUNT = goreBudget(3, "medium").fluid;
const pour = (wound = WOUND, count = COUNT) => Array.from({ length: count }, (_, i) => fluidLaunch(wound, i, count));

test("the pour: seeded, front-loaded, on the heart's beat, out of the far wound and back out of the entry", () => {
  assert.ok(COUNT > 0, "the medium preset affords a fluid");
  assert.equal(goreBudget(3, "low").fluid, 0, "Low has none: the plain sprays stand in");
  const a = pour(), b = pour();
  assert.deepEqual(a.slice(0, 50), b.slice(0, 50), "the same game pours the same way");
  assert.notDeepEqual(a.slice(0, 50), pour({ ...WOUND, seed: 7 }).slice(0, 50));
  const births = a.map(l => l.birth).sort((x, y) => x - y);
  assert.ok(births[0] >= 0 && births[births.length - 1] <= FLUID.pour + 1e-9);
  assert.ok(births[Math.floor(births.length / 2)] < FLUID.pour * 0.45, "most of it in the first moments");
  const exit = { x: WOUND.entry.x, y: WOUND.entry.y, z: WOUND.entry.z - WOUND.depth };
  const near = (p: { x: number; y: number; z: number }, q: typeof p) => Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z) < H * 0.02;
  const back = a.filter(l => near(l.origin, WOUND.entry)), front = a.filter(l => near(l.origin, exit));
  assert.equal(back.length + front.length, a.length, "every drop leaves one wound or the other");
  assert.ok(Math.abs(back.length / a.length - FLUID.back) < 0.04, `${back.length} of ${a.length} back out of the entry`);
  // Out of the far wound it goes on along the blow, out of the entry back against it; nearly all of it lifted so it arcs.
  assert.ok(front.filter(l => l.velocity.z < 0).length > front.length * 0.9);
  assert.ok(back.filter(l => l.velocity.z > 0).length > back.length * 0.9);
  assert.ok(a.filter(l => l.velocity.y > 0).length > a.length * 0.7);
  for (const l of a) {
    const speed = Math.hypot(l.velocity.x, l.velocity.y, l.velocity.z);
    assert.ok(speed > H * FLUID.slowest * 0.2 && speed < H * FLUID.fastest * 1.01, `speed ${speed}`);
    assert.ok(l.size > 0 && l.size < H * FLUID.radius * 1.4 && l.drag === FLUID.drag);
  }
  // It spurts: harder on each beat, weaker as the wound empties.
  assert.ok(pressure(0) > pressure(FLUID.beat / 2));
  assert.ok(pressure(FLUID.beat) > pressure(FLUID.beat * 1.5));
  assert.ok(pressure(0) > pressure(FLUID.beat * 2) && pressure(FLUID.beat * 2) > 0);
});

test("each drop lands where the closed-form flight says, on the stone, a square or so away, in time with the slow motion", () => {
  const top = 0;
  const landings = pour().map(l => ({ launch: l, landing: fluidLanding(l, top)! }));
  assert.ok(landings.every(item => item.landing), "everything that leaves the wound comes down");
  for (const { launch, landing } of landings.slice(0, 400)) {
    const p = flightPosition(launch, landing.time - launch.birth, { x: 0, y: 0, z: 0 }, GORE_GRAVITY);
    assert.ok(Math.abs(p.y - (top + launch.size * 0.5)) < 1e-6, "on the stone");
    assert.ok(Math.abs(p.x - landing.at.x) < 1e-9 && Math.abs(p.z - landing.at.z) < 1e-9);
    assert.ok(landing.time > launch.birth);
    const away = Math.hypot(landing.at.x - WOUND.entry.x, landing.at.z - (WOUND.entry.z - WOUND.depth / 2));
    assert.ok(away < 1.02 * 2.5, `${away.toFixed(2)} from the body`);
  }
  // The first of it lands within about half a second of scene time: two seconds of the player's, in the slow motion.
  const first = Math.min(...landings.map(item => item.landing.time));
  assert.ok(first > 0.1 && first < 0.6, `first lands at ${first.toFixed(3)}`);
});

test("the marks: the fullest places as stains, and a pool where most of it came down, each when its blood lands", () => {
  const launches = pour();
  const marks = fluidMarks(launches, 0, H, WOUND.seed);
  assert.ok(marks.stains.length > 2 && marks.stains.length <= FLUID.stains, `${marks.stains.length} stains`);
  const landings = launches.map(l => fluidLanding(l, 0)!);
  const first = Math.min(...landings.map(l => l.time)), last = Math.max(...landings.map(l => l.time));
  for (const stain of marks.stains) {
    assert.ok(stain.at >= first - 1e-9 && stain.at <= last + 1e-9);
    assert.ok(stain.radius >= H * 0.035 - 1e-9 && stain.radius <= H * 0.16 + 1e-9);
    // Each lies where drops came down.
    assert.ok(landings.some(l => Math.hypot(l.at.x - stain.x, l.at.z - stain.z) < H * FLUID.cell), "where drops landed");
  }
  assert.ok(marks.pool, "a full pour pools");
  const pool = marks.pool!;
  assert.ok(pool.at > first && pool.at < last, "it spreads once the bulk of it is down");
  assert.ok(pool.maxRadius >= H * 0.18 - 1e-9 && pool.maxRadius <= H * 0.55 + 1e-9);
  // Most of what lands is near the pool.
  const nearPool = landings.filter(l => Math.hypot(l.at.x - pool.x, l.at.z - pool.z) < pool.maxRadius * 2.5).length;
  assert.ok(nearPool > landings.length * 0.25, `${nearPool} of ${landings.length} near the pool`);
  // Each mark knows when its drops left the wound (a wound carried off as it pours moves them, and their marks).
  for (const stain of marks.stains) assert.ok(stain.born >= 0 && stain.born <= FLUID.pour && stain.born < stain.at);
  assert.ok(pool.born >= 0 && pool.born <= FLUID.pour && pool.born < pool.at);
  // The same game leaves the same marks; a trickle leaves stains and no pool.
  assert.deepEqual(fluidMarks(launches, 0, H, WOUND.seed), marks);
  assert.equal(fluidMarks(launches.slice(0, 6), 0, H, WOUND.seed).pool, null);
});

test("the fluid thins away once it has run, leaving the marks", () => {
  assert.equal(fluidLevel(0), 1);
  assert.equal(fluidLevel(FLUID.thin), 1);
  assert.ok(fluidLevel((FLUID.thin + FLUID.gone) / 2) > 0 && fluidLevel((FLUID.thin + FLUID.gone) / 2) < 1);
  assert.equal(fluidLevel(FLUID.gone), 0);
  assert.ok(FLUID.gone > FLUID.pour + 1.5, "long enough to land and run");
});
