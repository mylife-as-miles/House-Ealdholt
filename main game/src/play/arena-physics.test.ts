import assert from "node:assert/strict";
import { test } from "node:test";
import * as THREE from "three";
import { AIR_IMPULSES, AIR_SLOTS, airWind } from "../../../shared/play/air-disturbance";
import { createArenaAir, type ArenaAirLight } from "./arena-air";
import type { ArenaContext, ArenaQuality } from "./arena-kit";
import { AIR_MOTION_GLSL, ARENA_METRES, RAISED_PER_SLOT, RAISED_WARM_FRAMES, arenaPhysics, mistParts } from "./arena-physics";

const tier = (name: ArenaQuality["name"], area = name !== "low"): ArenaQuality => ({ name, scale: 1, msaa: 0, bloom: false, shadow: 1024, area, embers: 0, dpr: 1 });
const light: ArenaAirLight = { up: [0.2, 0.2, 0.3], horizon: [0.3, 0.2, 0.2], lava: [1, 0.4, 0.1], sun: new THREE.Vector3(0, 0.4, -1).normalize(), sunColor: [1, 0.7, 0.4] };

function arena(quality: ArenaQuality, setting: 1 | 2 = 1) {
  const state = { quality, still: false };
  const context = {
    setting, world: new THREE.Group(), camera: new THREE.PerspectiveCamera(40), quality: () => state.quality, reducedMotion: () => state.still,
    renderer: { getDrawingBufferSize: (size: THREE.Vector2) => size.set(1280, 720) }, shared: { emitters: [] },
  } as unknown as ArenaContext;
  return { context, state };
}

test("one arena has one air: the ash, the raised ash, the mist and the look's embers read the same uniforms", () => {
  const { context } = arena(tier("high"));
  const physics = arenaPhysics(context);
  assert.equal(arenaPhysics(context), physics);
  assert.notEqual(arenaPhysics(arena(tier("high")).context), physics, "another arena has its own");
  const air = createArenaAir(context, light);
  assert.equal(air.physics, physics);
  for (const name of ["uCfAirA", "uCfAirB", "uCfAirNow", "uCfAirLive", "uCfAirWind", "uCfAirGust"] as const) {
    assert.equal(air.ashUniforms[name], physics.uniforms[name], `the drifting ash's ${name}`);
    assert.equal(air.raised.uniforms[name], physics.uniforms[name], `the raised ash's ${name}`);
  }
  assert.equal(air.grade.uniforms!.uCfAirWind, physics.uniforms.uCfAirWind, "the mist's wisps go with the same wind");
  assert.equal(air.grade.uniforms!.uCfMistPart, physics.mist);
  // the arrays a shader reads are the field's own: an impulse is uploaded with no copy made
  assert.equal(physics.uniforms.uCfAirA.value, physics.field.a);
  assert.equal(physics.uniforms.uCfAirB.value, physics.field.b);
  assert.equal(physics.uniforms.uCfAirC.value, physics.field.c);
  assert.ok((air.ash.material as THREE.ShaderMaterial).vertexShader.includes("cfAirPush(p)"));
  assert.ok((air.ash.material as THREE.ShaderMaterial).vertexShader.includes("uCfAirWind.x"));
  assert.ok(!(air.ash.material as THREE.ShaderMaterial).vertexShader.includes("uTime * 0.25"), "the ash has no drift of its own left");
  assert.ok(air.grade.scene!.includes("cfEnd.xz - uCfAirWind.xy"));
  assert.ok(!air.grade.scene!.includes("uCfAirTime * 0.006"), "nor have the wisps");
  assert.ok(AIR_MOTION_GLSL.includes(`#define CF_AIR_SLOTS ${AIR_SLOTS}`));
  air.dispose();
  assert.notEqual(arenaPhysics(context), physics, "a disposed arena's air is not handed out again");
});

test("the match's places are the board's units; the air's are metres", () => {
  const { context } = arena(tier("high"));
  const physics = arenaPhysics(context);
  physics.update(4);
  physics.disturb("blow", 1, 0.5, -2, 1, 0.25);
  assert.deepEqual([...physics.field.a.subarray(0, 3)].map((value) => +value.toFixed(4)), [ARENA_METRES, 0.5 * ARENA_METRES, -2 * ARENA_METRES]);
  assert.equal(physics.field.b[0], 4.25, "from the arena's clock as of its last frame, after the delay");
  physics.update(4.5);
  assert.equal(physics.uniforms.uCfAirNow.value, 4.5);
  assert.equal(physics.uniforms.uCfAirLive.value, 1);
});

test("the wind's uniforms are the wind at the arena's clock", () => {
  const { context } = arena(tier("medium"));
  const physics = arenaPhysics(context);
  physics.update(41);
  const wind = airWind(41), close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-5, `${a} against ${b}`);
  close(physics.uniforms.uCfAirWind.value.x, wind.driftX); close(physics.uniforms.uCfAirWind.value.y, wind.driftZ);
  close(physics.uniforms.uCfAirWind.value.z, wind.speedX); close(physics.uniforms.uCfAirWind.value.w, wind.speedZ);
  close(physics.uniforms.uCfAirGust.value.x, wind.gustX); close(physics.uniforms.uCfAirGust.value.y, wind.gustZ);
  // held (the pause menu: the match passes no time), the same moment again: nothing moves
  const held = physics.uniforms.uCfAirWind.value.clone();
  physics.update(41);
  assert.ok(physics.uniforms.uCfAirWind.value.equals(held));
});

test("reduced motion adds nothing to the air, and switching it on clears what was there", () => {
  const { context, state } = arena(tier("high"));
  const air = createArenaAir(context, light), physics = air.physics;
  for (let frame = 0; frame < RAISED_WARM_FRAMES; frame++) air.update(frame / 60);
  air.update(12);
  physics.disturb("spell", 0, 0, 0);
  air.update(12.5);
  assert.equal(physics.uniforms.uCfAirLive.value, 1);
  assert.equal(air.raised.points.visible, true);
  assert.ok(physics.mist.value.w > 0);
  // the look stops its clock at 0 under reduced motion (battlefield-look.ts frame)
  state.still = true;
  air.update(0);
  assert.equal(physics.uniforms.uCfAirLive.value, 0);
  assert.equal(air.raised.points.visible, false);
  assert.equal(physics.mist.value.w, 0);
  assert.deepEqual([...physics.uniforms.uCfAirWind.value.toArray()].slice(0, 2), [0, 0], "and the wind has carried nothing");
  const version = physics.field.version;
  physics.disturb("spell", 0, 0, 0);
  physics.disturb("step", 1, 0, 1);
  assert.equal(physics.field.version, version, "nothing is written");
  air.update(0);
  assert.equal(air.raised.points.visible, false);
});

test("at rest the raised ash is not drawn and the shaders' loop is empty; an impulse shows it until the air has settled", () => {
  const { context } = arena(tier("medium"));
  const air = createArenaAir(context, light), physics = air.physics;
  // its first frames are drawn, with nothing raised: the program is built under the loading screen
  for (let frame = 0; frame < RAISED_WARM_FRAMES; frame++) { air.update(frame / 60); assert.equal(air.raised.points.visible, true); }
  air.update(1);
  assert.equal(air.raised.points.visible, false);
  assert.equal(physics.uniforms.uCfAirLive.value, 0);
  physics.disturb("fall", 2, 0, 2);
  air.update(1 + 1 / 60);
  assert.equal(air.raised.points.visible, true);
  assert.equal(physics.uniforms.uCfAirLive.value, 1);
  // the pause menu holds the clock: the same frame again, still shown, nothing written
  const version = physics.field.version;
  for (let i = 0; i < 5; i++) air.update(1 + 1 / 60);
  assert.equal(air.raised.points.visible, true);
  assert.equal(physics.field.version, version);
  air.update(1 + AIR_IMPULSES.fall.life + 0.1);
  assert.equal(air.raised.points.visible, false);
  assert.equal(physics.uniforms.uCfAirLive.value, 0);
  // hidden with the air itself (the surface part's development switch hides the ash)
  physics.disturb("fall", 2, 0, 2);
  air.ash.visible = false;
  air.update(4);
  assert.equal(air.raised.points.visible, false);
});

test("the raised ash scales by tier, and a tier draws the first flakes of every slot", () => {
  const { context, state } = arena(tier("low"));
  const air = createArenaAir(context, light);
  const range = () => air.raised.geometry.drawRange.count;
  assert.equal(range(), AIR_SLOTS * RAISED_PER_SLOT[0]);
  assert.equal(air.raised.uniforms.uPerSlot.value, RAISED_PER_SLOT[0]);
  state.quality = tier("medium"); air.setQuality(state.quality);
  assert.equal(range(), AIR_SLOTS * RAISED_PER_SLOT[1]);
  state.quality = tier("high"); air.setQuality(state.quality);
  assert.equal(range(), AIR_SLOTS * RAISED_PER_SLOT[2]);
  assert.equal(air.raised.uniforms.uPerSlot.value, RAISED_PER_SLOT[2]);
  assert.ok(RAISED_PER_SLOT[0] < RAISED_PER_SLOT[1] && RAISED_PER_SLOT[1] < RAISED_PER_SLOT[2]);
  assert.ok(AIR_SLOTS * RAISED_PER_SLOT[0] <= 300, "the low tier's whole cloud is under three hundred points");
  // within any tier's run every slot has the same number of flakes, numbered from 0
  const flake = air.raised.geometry.getAttribute("aFlake") as THREE.BufferAttribute;
  for (const per of RAISED_PER_SLOT) {
    const seen = new Map<number, number[]>();
    for (let i = 0; i < AIR_SLOTS * per; i++) seen.set(flake.getX(i), [...(seen.get(flake.getX(i)) ?? []), flake.getY(i)]);
    assert.equal(seen.size, AIR_SLOTS);
    for (const numbers of seen.values()) assert.deepEqual(numbers, Array.from({ length: per }, (_, n) => n));
  }
  assert.equal(flake.count, AIR_SLOTS * RAISED_PER_SLOT[2]);
});

test("the mist answers a heavy impulse on the high tier and discrete medium only", () => {
  assert.equal(mistParts(tier("high"), 2), true);
  assert.equal(mistParts(tier("medium"), 1), true);
  assert.equal(mistParts(tier("medium", false), 1), false, "medium on integrated graphics: nothing added to its final pass");
  assert.equal(mistParts(tier("low"), 0), false);
  for (const [quality, parts] of [[tier("high"), true], [tier("medium"), true], [tier("medium", false), false], [tier("low"), false]] as const) {
    const { context } = arena(quality);
    const air = createArenaAir(context, light);
    air.update(2);
    air.physics.disturb("rite", 0, 0, 0);
    air.update(3);
    assert.equal(air.physics.mist.value.w > 0, parts, `${quality.name}${quality.area ? "" : " (integrated)"}`);
    if (parts) assert.ok(air.physics.mist.value.z > AIR_IMPULSES.rite.radius);
  }
  // a change of tier mid-match is followed
  const { context, state } = arena(tier("high"));
  const air = createArenaAir(context, light);
  air.update(2); air.physics.disturb("rite", 0, 0, 0); air.update(3);
  assert.ok(air.physics.mist.value.w > 0);
  state.quality = tier("low"); air.setQuality(state.quality); air.update(3.1);
  assert.equal(air.physics.mist.value.w, 0);
});

test("the air frees what it made, the raised ash with it", () => {
  const { context } = arena(tier("high"), 2);
  const air = createArenaAir(context, light);
  assert.equal(context.world.children.length, 2);
  let freed = 0;
  for (const thing of air.owned) thing.addEventListener("dispose", () => { freed += 1; });
  assert.ok(air.owned.includes(air.raised.geometry) && air.owned.includes(air.raised.material));
  air.dispose();
  assert.equal(freed, air.owned.length);
  assert.equal(context.world.children.length, 0);
});
