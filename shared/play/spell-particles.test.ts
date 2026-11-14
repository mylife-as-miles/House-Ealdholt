import { test } from "node:test";
import assert from "node:assert/strict";
import { PARTICLE_KIND, between, byPower, hangingFade, flightPoint, flightTravel, flightVelocity, packParticles, particleFade, scatter, sequence, type Particle } from "../../web/src/scene/vfx/spells/shared/particlePlan";

const near = (a: number, b: number, by = 1e-6) => Math.abs(a - b) <= by;

test("the dice are seeded: the same seed gives the same cast, and every roll is in 0..1", () => {
  const a = sequence(77), b = sequence(77), c = sequence(78);
  const rolls = Array.from({ length: 400 }, () => a());
  assert.deepEqual(rolls, Array.from({ length: 400 }, () => b()));
  assert.notDeepEqual(rolls.slice(0, 8), Array.from({ length: 8 }, () => c()));
  for (const roll of rolls) assert.ok(roll >= 0 && roll < 1);
  const mean = rolls.reduce((sum, roll) => sum + roll, 0) / rolls.length;
  assert.ok(Math.abs(mean - 0.5) < 0.06, `the rolls are spread (${mean.toFixed(3)})`);
  const dice = sequence(3);
  for (let i = 0; i < 50; i += 1) { const v = between(dice, 2, 5); assert.ok(v >= 2 && v < 5); }
});

test("with no drag a particle flies the schoolbook parabola", () => {
  const p = flightPoint({ x: 1, y: 2, z: 3 }, { x: 2, y: 4, z: -1 }, 9, 0, 0.5);
  assert.ok(near(p.x, 2) && near(p.y, 2 + 2 - 0.5 * 9 * 0.25) && near(p.z, 2.5));
  const v = flightVelocity({ x: 2, y: 4, z: -1 }, 9, 0, 0.5);
  assert.ok(near(v.x, 2) && near(v.y, 4 - 4.5) && near(v.z, -1));
});

test("the closed form is the path a step-by-step flight would take", () => {
  for (const [drag, gravity] of [[0.6, 9], [2.5, 1.2], [4, -1.5]] as const) {
    const origin = { x: 0, y: 1, z: 0 }, launch = { x: 3, y: 2, z: -1.5 };
    let at = { ...origin }, speed = { ...launch };
    const step = 1 / 4000;
    for (let t = 0; t < 1.2; t += step) {
      speed = { x: speed.x - drag * speed.x * step, y: speed.y - (drag * speed.y + gravity) * step, z: speed.z - drag * speed.z * step };
      at = { x: at.x + speed.x * step, y: at.y + speed.y * step, z: at.z + speed.z * step };
    }
    const exact = flightPoint(origin, launch, gravity, drag, 1.2), going = flightVelocity(launch, gravity, drag, 1.2);
    assert.ok(Math.hypot(exact.x - at.x, exact.y - at.y, exact.z - at.z) < 4e-3, `drag ${drag}`);
    assert.ok(Math.hypot(going.x - speed.x, going.y - speed.y, going.z - speed.z) < 4e-3, `drag ${drag}`);
  }
});

test("drag stops a particle within its launch speed over the drag, and a weightless one never falls", () => {
  assert.ok(near(flightTravel(100, 4), 0.25, 1e-9));
  assert.ok(flightTravel(0.2, 4) < flightTravel(0.4, 4));
  assert.equal(flightTravel(0.3, 0), 0.3);
  const still = flightPoint({ x: 0, y: 0.4, z: 0 }, { x: 1, y: 0, z: 0 }, 0, 3, 5);
  assert.equal(still.y, 0.4);
  // negative gravity is hot air: it climbs
  assert.ok(flightPoint({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, -2, 1.5, 1).y > 0);
});

test("a particle appears and is gone inside its life, with nothing at either end", () => {
  assert.equal(particleFade(0), 0); assert.equal(particleFade(1), 0); assert.equal(particleFade(1.2), 0); assert.equal(particleFade(-0.1), 0);
  let peak = 0;
  for (let u = 0.01; u < 1; u += 0.01) { const f = particleFade(u, 0.1); assert.ok(f > 0 && f <= 1); peak = Math.max(peak, f); }
  assert.ok(peak > 0.8, "it reaches nearly its full brightness");
  assert.ok(particleFade(0.02, 0.5) < particleFade(0.02, 0.05), "a long fade-in is slower to appear");
});

test("what hangs in the air stays for half its life before it thins", () => {
  assert.equal(hangingFade(0), 0); assert.equal(hangingFade(1), 0);
  assert.equal(hangingFade(0.3, 0.2), 1); assert.equal(hangingFade(0.5, 0.2), 1);
  assert.ok(Math.abs(hangingFade(0.75, 0.2) - 0.5) < 1e-9);
  assert.ok(hangingFade(0.1, 0.2) > 0 && hangingFade(0.1, 0.2) < 1 && hangingFade(0.95, 0.2) < 0.03);
  assert.ok(hangingFade(0.6) > particleFade(0.6), "longer than a spark does");
});

test("scatter gives unit directions inside the asked climb", () => {
  const dice = sequence(9);
  for (let i = 0; i < 200; i += 1) {
    const v = scatter(dice, 0.2, 0.9);
    assert.ok(near(Math.hypot(v.x, v.y, v.z), 1, 1e-9));
    assert.ok(v.y >= 0.2 && v.y <= 0.9);
  }
});

const mote = (birth: number, life: number): Particle => ({ kind: PARTICLE_KIND.mote, origin: { x: birth, y: 0, z: 0 }, velocity: { x: 0, y: 1, z: 0 }, birth, life, size: 0.05 });

test("a pool is written once: one row each, defaults filled, and the moment the last one dies known", () => {
  const packed = packParticles([mote(0, 1), { ...mote(2, 1.5), kind: PARTICLE_KIND.puff, drag: 2, gravity: -1, tone: 0.9, grow: 3, anchored: true, fadeIn: 0.4, wander: 0.2 }], 10, 5);
  assert.equal(packed.count, 2);
  assert.equal(packed.spent, 3.5);
  assert.deepEqual([...packed.times.slice(0, 4)], [0, 1, 0, 0]);
  assert.deepEqual([...packed.times.slice(4, 8)], [2, 1.5, 2, -1]);
  assert.equal(packed.look[6], PARTICLE_KIND.puff);
  assert.ok(near(packed.look[7], 0.9)); assert.equal(packed.look[3], 0.5);
  assert.deepEqual([...packed.extra.slice(0, 4)].map((v) => +v.toFixed(3)), [1, 0, 0.08, 0]);
  assert.deepEqual([...packed.extra.slice(4, 8)].map((v) => +v.toFixed(3)), [3, 1, 0.4, 0.2]);
  assert.deepEqual([...packParticles([mote(0, 1)], 4, 5).look], [...packParticles([mote(0, 1)], 4, 5).look], "the same seed packs the same pool");
});

test("a smaller budget thins the whole spell instead of cutting off its end", () => {
  const all = Array.from({ length: 100 }, (_, i) => mote(i, 1));
  const packed = packParticles(all, 25);
  assert.equal(packed.count, 25);
  const births = Array.from({ length: 25 }, (_, i) => packed.times[i * 4]);
  assert.equal(births[0], 0);
  assert.ok(births[24] >= 90, "the last moments of the spell still have particles");
  for (let i = 1; i < births.length; i += 1) assert.ok(births[i] - births[i - 1] >= 3 && births[i] - births[i - 1] <= 5);
  assert.equal(packParticles(all, 0).count, 0);
});

test("a Queen's count is larger than a Bishop's", () => {
  assert.equal(byPower(100, 1), 100);
  assert.ok(byPower(100, 1.75) > 125 && byPower(100, 1.75) < 140);
  assert.equal(byPower(0, 1.75), 0);
});
