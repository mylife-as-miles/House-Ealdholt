import assert from "node:assert/strict";
import { test } from "node:test";
import { AIR_IMPULSES, AIR_POWER, AIR_RISE, AIR_SLOTS, AIR_WIND, airEnvelope, airWind, createAirDisturbance, type AirImpulseKind } from "./air-disturbance";

const at = (kind: AirImpulseKind, x = 0, z = 0, power?: number, delay?: number) => ({ kind, x, y: 0, z, power, delay });

test("an impulse comes on over a few frames and dies away with no step at either end", () => {
  assert.equal(airEnvelope(0, 2), 0);
  assert.equal(airEnvelope(-1, 2), 0);
  assert.equal(airEnvelope(2, 2), 0);
  assert.equal(airEnvelope(3, 2), 0);
  assert.equal(airEnvelope(1, 0), 0);
  // nothing in one frame, nearly all of it once it has come on, less and less after
  assert.ok(airEnvelope(1 / 60, 2) < 0.06);
  assert.ok(airEnvelope(AIR_RISE, 2) > 0.85);
  let last = airEnvelope(AIR_RISE, 2);
  for (let age = AIR_RISE + 0.05; age < 2; age += 0.05) { const now = airEnvelope(age, 2); assert.ok(now < last, `still falling at ${age}`); last = now; }
  // the end is reached at rest: a frame before it there is next to nothing left, and the fall is slowing
  assert.ok(airEnvelope(2 - 1 / 60, 2) < 1e-4);
  assert.ok(airEnvelope(1.9, 2) - airEnvelope(1.95, 2) < airEnvelope(1.5, 2) - airEnvelope(1.55, 2));
});

test("a spell or a rite pushes harder and further than a blow, a blow than a step", () => {
  for (const key of ["push", "radius", "throw", "lift"] as const) {
    assert.ok(AIR_IMPULSES.step[key] < AIR_IMPULSES.blow[key], `step < blow in ${key}`);
    assert.ok(AIR_IMPULSES.blow[key] < AIR_IMPULSES.spell[key], `blow < spell in ${key}`);
    assert.ok(AIR_IMPULSES.spell[key] <= AIR_IMPULSES.rite[key], `spell <= rite in ${key}`);
  }
  // a body puffs the dust up more than out; a blow throws it out more than up
  assert.ok(AIR_IMPULSES.fall.lift / AIR_IMPULSES.fall.throw > AIR_IMPULSES.blow.lift / AIR_IMPULSES.blow.throw);
  // the hotter the event, the more of what it raises leaves glowing
  assert.ok(AIR_IMPULSES.step.heat < AIR_IMPULSES.blow.heat && AIR_IMPULSES.blow.heat < AIR_IMPULSES.spell.heat);
  assert.ok(AIR_IMPULSES.fall.heat < AIR_IMPULSES.clash.heat, "a body raises dust, steel on steel sparks");
  // only what is heavy enough to roll off the board reaches the mist on the dais floor
  assert.equal(AIR_IMPULSES.step.mist + AIR_IMPULSES.land.mist + AIR_IMPULSES.clash.mist + AIR_IMPULSES.blow.mist, 0);
  assert.ok(AIR_IMPULSES.spell.mist > 0 && AIR_IMPULSES.rite.mist > 0);
  for (const shape of Object.values(AIR_IMPULSES)) {
    assert.ok(shape.life > AIR_RISE * 4 && shape.life <= 4, "every impulse is over within four seconds");
    assert.ok(shape.flakes > 0 && shape.flakes <= 1 && shape.heat >= 0 && shape.heat <= 1);
  }
});

test("an impulse is one write to the arrays, and its place, reach and strength are what a shader reads", () => {
  const field = createAirDisturbance();
  assert.equal(field.slots, AIR_SLOTS);
  assert.equal(field.a.length, AIR_SLOTS * 4);
  assert.equal(field.live(0), 0);
  const version = field.version;
  assert.equal(field.push({ kind: "blow", x: 2, y: 1.2, z: -3 }, 10), 0);
  assert.equal(field.version, version + 1);
  assert.deepEqual([...field.a.subarray(0, 4)].map((value) => +value.toFixed(3)), [2, 1.2, -3, AIR_IMPULSES.blow.radius]);
  assert.deepEqual([...field.b.subarray(0, 4)].map((value) => +value.toFixed(3)), [10, AIR_IMPULSES.blow.push, AIR_IMPULSES.blow.life, AIR_IMPULSES.blow.throw]);
  assert.deepEqual([...field.c.subarray(0, 4)].map((value) => +value.toFixed(3)), [AIR_IMPULSES.blow.lift, AIR_IMPULSES.blow.flakes, AIR_IMPULSES.blow.heat, 0]);
  // time passing writes nothing
  for (let now = 10; now < 14; now += 0.1) { field.live(now); field.pushAt(2.5, 1, -3, now); field.mistAt(now); }
  assert.equal(field.version, version + 1);
});

test("power scales how hard and how far, within bounds; a place or power that is not a number is dropped", () => {
  const field = createAirDisturbance();
  field.push(at("blow", 0, 0, 0.5), 0);
  field.push(at("blow", 20, 0, 99), 0);
  field.push(at("blow", 40, 0, 0.0001), 0);
  assert.ok(Math.abs(field.b[1] - AIR_IMPULSES.blow.push * 0.5) < 1e-6);
  assert.ok(Math.abs(field.b[4 + 1] - AIR_IMPULSES.blow.push * AIR_POWER.max) < 1e-6);
  assert.ok(Math.abs(field.b[8 + 1] - AIR_IMPULSES.blow.push * AIR_POWER.min) < 1e-6);
  assert.ok(field.a[3] < AIR_IMPULSES.blow.radius && field.a[4 + 3] > AIR_IMPULSES.blow.radius);
  const version = field.version;
  assert.equal(field.push(at("blow", NaN), 0), -1);
  assert.equal(field.push(at("blow", 0, 0, 0), 0), -1);
  assert.equal(field.push(at("blow", 0, 0, -1), 0), -1);
  assert.equal(field.push(at("blow", 0, 0, 1, Infinity), 0), -1);
  assert.equal(field.push({ kind: "gust" as AirImpulseKind, x: 0, y: 0, z: 0 }, 0), -1);
  assert.equal(field.push(at("blow"), NaN), -1);
  assert.equal(field.version, version);
});

test("the air is pushed outward and up round an impulse, most at its centre, and settles by itself", () => {
  const field = createAirDisturbance();
  field.push(at("blow"), 0);
  const life = AIR_IMPULSES.blow.life;
  assert.deepEqual(field.pushAt(1, 0, 0, 0), [0, 0, 0], "nothing on the frame it lands");
  const near = field.pushAt(1, 0, 0, 0.2), far = field.pushAt(6, 0, 0, 0.2);
  assert.ok(near[0] > 0.3 && near[1] > 0 && Math.abs(near[2]) < 1e-9, "outward along x, and lifted");
  assert.ok(field.pushAt(-1, 0, 0, 0.2)[0] < -0.3, "outward on the other side too");
  assert.ok(Math.hypot(...far) < Math.hypot(...near) * 0.05, "next to nothing two radii out");
  assert.ok(Math.hypot(...near) <= AIR_IMPULSES.blow.push, "never further than its push");
  // decays smoothly: each tenth of a second moves a flake by a little, never by a jump
  let last = Math.hypot(...field.pushAt(1, 0, 0, 0.2));
  for (let now = 0.3; now <= life + 0.1; now += 0.1) {
    const amount = Math.hypot(...field.pushAt(1, 0, 0, now));
    assert.ok(amount <= last && last - amount < 0.12, `settling at ${now.toFixed(1)}`);
    last = amount;
  }
  assert.ok(last < 1e-9);
  assert.deepEqual(field.pushAt(1, 0, 0, life + 0.001), [0, 0, 0]);
  assert.equal(field.live(life + 0.01), 0, "and the shaders' loop is empty again");
});

test("an impulse told ahead of time waits for its moment", () => {
  const field = createAirDisturbance();
  field.push(at("fall", 0, 0, 1, 0.5), 2);
  assert.equal(field.b[0], 2.5);
  assert.equal(field.live(2.1), 1, "it holds its slot while it waits");
  assert.deepEqual(field.pushAt(0.5, 0, 0, 2.4), [0, 0, 0]);
  assert.ok(Math.hypot(...field.pushAt(0.5, 0, 0, 2.8)) > 0.2);
});

test("the same event told twice is one impulse, the stronger; a different place or moment is another", () => {
  const field = createAirDisturbance();
  assert.equal(field.push(at("fall", 1, 1, 0.5), 5), 0);
  assert.equal(field.push(at("fall", 1.2, 1.1, 1), 5.05), 0, "the fall's second report joins the first");
  assert.ok(Math.abs(field.b[1] - AIR_IMPULSES.fall.push) < 1e-6, "at the stronger of the two");
  assert.equal(field.b[0], 5, "and from the first one's moment");
  assert.equal(field.push(at("fall", 1.2, 1.1, 0.4), 5.06), 0);
  assert.ok(Math.abs(field.b[1] - AIR_IMPULSES.fall.push) < 1e-6, "a weaker report changes nothing");
  assert.equal(field.push(at("fall", 4, 1), 5.05), 1, "another body, another impulse");
  assert.equal(field.push(at("fall", 1, 1), 5.5), 2, "the same place later is a new one");
  assert.equal(field.push(at("slam", 1, 1), 5.5), 3, "and another kind is never merged");
});

test("spent slots are used again, lowest first, so the list stays short", () => {
  const field = createAirDisturbance();
  for (let i = 0; i < 4; i++) field.push(at("step", i * 3), 0);
  field.push(at("spell", 20), 0);
  assert.equal(field.live(0.5), 5);
  // the steps are over; the spell is not
  const later = AIR_IMPULSES.step.life + 0.1;
  assert.equal(field.live(later), 5, "the spell still holds slot 4");
  assert.equal(field.push(at("blow", 9), later), 0);
  assert.equal(field.push(at("blow", 12), later), 1);
  assert.equal(field.live(AIR_IMPULSES.spell.life + 0.1), 2, "once the spell is over only the blows are read");
});

test("a full list gives up what has least left, and only to something stronger", () => {
  const field = createAirDisturbance();
  for (let slot = 0; slot < AIR_SLOTS; slot++) field.push(at(slot === 3 ? "step" : "spell", slot * 10), 0);
  assert.equal(field.live(0.3), AIR_SLOTS);
  // a light step may not end a spell's wave early, nor the step already there while that has more left than it brings
  assert.equal(field.push(at("step", 500, 0, 0.3), 0.3), -1);
  // a blow is stronger than what the step has left: it takes that slot
  assert.equal(field.push(at("blow", 600), 0.3), 3);
  // every slot now holds something stronger than a step has to give
  assert.equal(field.push(at("step", 700), 0.35), -1);
  // ... until one of them is nearly over: then even a step is more than it has left
  assert.notEqual(field.push(at("step", 800), 0.3 + AIR_IMPULSES.blow.life - 0.05), -1);
  // one that has not begun yet counts at its full strength: it is not the one given up
  const waiting = createAirDisturbance(2);
  waiting.push(at("slam", 0, 0, 1, 1), 0);
  waiting.push(at("blow", 10), 0);
  assert.equal(waiting.push(at("spell", 20), 0.5), 1, "the blow that is fading, not the slam still to come");
});

test("the low mist is thinned by the heaviest live impulse, in a patch that widens as it fills", () => {
  const field = createAirDisturbance();
  field.push(at("blow", 1, 1), 0);
  assert.equal(field.mistAt(0.5)[3], 0, "a blow does not reach the dais floor");
  field.push(at("spell", 3, -2), 0);
  const early = [...field.mistAt(0.6)], late = [...field.mistAt(2.4)];
  assert.deepEqual(early.slice(0, 2), [3, -2]);
  assert.ok(early[3] > 0.3 && early[3] <= 0.85);
  assert.ok(late[3] < early[3] && late[3] > 0, "filling in");
  assert.ok(late[2] > early[2] && early[2] > AIR_IMPULSES.spell.radius, "and rolling outward");
  assert.equal(field.mistAt(AIR_IMPULSES.spell.life + 0.1)[3], 0);
  // amounts never jump: the patch comes on and goes off through 0
  let last = 0;
  for (let now = 0; now <= AIR_IMPULSES.spell.life + 0.1; now += 1 / 30) { const amount = field.mistAt(now)[3]; assert.ok(Math.abs(amount - last) < 0.1); last = amount; }
});

test("clearing empties the field at once, and an empty field is not written again", () => {
  const field = createAirDisturbance();
  field.push(at("rite"), 0);
  const version = field.version;
  field.clear();
  assert.equal(field.live(0.5), 0);
  assert.deepEqual(field.pushAt(1, 0, 0, 0.5), [0, 0, 0]);
  assert.equal(field.version, version + 1);
  field.clear();
  assert.equal(field.version, version + 1);
});

test("the wind is one signal of the arena's clock: still at 0, the same at the same moment, never blowing backwards", () => {
  const start = airWind(0);
  assert.deepEqual([start.driftX, start.driftZ, start.gustX, start.gustZ], [0, 0, 0, 0], "reduced motion holds the clock at 0: nothing has drifted");
  assert.equal(start.speedX, AIR_WIND.along);
  assert.deepEqual(airWind(37.5), airWind(37.5));
  assert.deepEqual(airWind(NaN), airWind(0));
  let least = Infinity, most = -Infinity, reach = 0;
  for (let t = 0; t < 600; t += 0.25) {
    const wind = airWind(t);
    least = Math.min(least, wind.speedX); most = Math.max(most, wind.speedX);
    reach = Math.max(reach, Math.hypot(wind.gustX, wind.gustZ));
  }
  assert.ok(least > 0, "the gusts ease the wind, they never turn it round");
  assert.ok(most > AIR_WIND.along * 1.5 && least < AIR_WIND.along * 0.5, "and they are gusts: it more than halves and rises by half");
  assert.ok(reach > 0.5 && reach < 3, `the gusts' share of the drift stays within a couple of metres (${reach.toFixed(2)})`);
});

test("what the wind has carried the air by is its speed added up, so everything that follows it moves together", () => {
  const step = 1 / 240;
  let x = 0, z = 0;
  for (let t = 0; t < 90; t += step) { const wind = airWind(t + step / 2); x += wind.speedX * step; z += wind.speedZ * step; }
  const wind = airWind(90);
  assert.ok(Math.abs(wind.driftX - x) < 1e-3, `along: ${wind.driftX} against ${x}`);
  assert.ok(Math.abs(wind.driftZ - z) < 1e-3, `across: ${wind.driftZ} against ${z}`);
  // the steady share is what the ash always drifted at
  assert.ok(Math.abs(wind.driftX - wind.gustX - AIR_WIND.along * 90) < 1e-9);
  // a clock held (the pause menu passes no time) holds the wind; a slowed one slows it
  assert.deepEqual(airWind(12), airWind(12));
  assert.ok(airWind(12.01).driftX - airWind(12).driftX < (airWind(12.04).driftX - airWind(12).driftX));
});
