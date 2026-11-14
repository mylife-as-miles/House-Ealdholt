import assert from "node:assert/strict";
import { test } from "node:test";
import * as THREE from "three";
import { createArenaCinema } from "./arena-cinema";
import type { ArenaContext, ArenaQuality } from "./arena-kit";

const tier = (name: ArenaQuality["name"], shadow: number): ArenaQuality => ({ name, scale: 1, msaa: 0, bloom: false, shadow, area: true, embers: 0, dpr: 1 });

function arena(setting: 1 | 2, quality: ArenaQuality) {
  const scene = new THREE.Scene();
  scene.environmentIntensity = 0.15;
  const context = {
    scene, setting, quality: () => quality, world: new THREE.Group(), camera: new THREE.PerspectiveCamera(),
  } as unknown as ArenaContext;
  const lamp = (light: THREE.Light, name: string, intensity: number) => { light.name = name; light.intensity = intensity; return light; };
  const lamps = [
    lamp(new THREE.DirectionalLight(new THREE.Color(1, 0.6, 0.3)), "CFCL_Sun_EclipseRim", 1.25),
    lamp(new THREE.DirectionalLight(), "CFCL_Sun_EclipseKey", 0.54),
    lamp(new THREE.DirectionalLight(), "CFCL_Sun_GrazeKey", 0.1),
    lamp(new THREE.SpotLight(), "CF_Spot_BoardTop", 27),
    lamp(new THREE.RectAreaLight(), "CFCL_Area_PieceRim", 0.95),
    lamp(new THREE.RectAreaLight(), "CFCL_Area_PieceKey", 1.27),
  ];
  (lamps[3] as THREE.SpotLight).castShadow = true;
  return { context, scene, lamps };
}

test("one lamp is the board's key: the eclipse's sun, from behind and to the left, casting the figures' shadows", () => {
  const { context, lamps } = arena(1, tier("high", 2048));
  const cinema = createArenaCinema(context);
  assert.equal(cinema.key(), null, "no key before the look's lamps are known");
  cinema.lamps!(lamps);
  const key = cinema.key()!;
  assert.equal(key, lamps[0]);
  assert.ok(key.castShadow);
  assert.deepEqual([key.shadow.mapSize.x, key.shadow.mapSize.y], [2048, 2048]);
  // behind the board (toward Black) and to White's left, well above the horizon: shadows fall toward the player
  assert.ok(key.position.z < 0 && key.position.x < 0);
  const elevation = Math.asin(key.position.clone().normalize().y) * 180 / Math.PI;
  assert.ok(elevation > 25 && elevation < 40, `elevation ${elevation}`);
  // every figure on the board, and its shadow's tip, lies inside the shadow camera
  const camera = key.shadow.camera;
  assert.ok(camera.right >= 4.08 * Math.SQRT2 + 1.5 && camera.left === -camera.right && camera.top === camera.right);
  const distance = key.position.length() / 2.3;
  assert.ok(camera.near < distance - 12 && camera.far > distance + 12);
  assert.ok(key.intensity > 1.25 * 4, "it outweighs every fill");
});

test("the lamps that cast no shadow keep only a share, and the top spot gives way to the key", () => {
  const { context, lamps } = arena(1, tier("high", 2048));
  createArenaCinema(context).lamps!(lamps);
  const by = (name: string) => lamps.find((lamp) => lamp.name === name)!;
  assert.equal(by("CFCL_Sun_EclipseKey").intensity, 0);
  assert.equal(by("CF_Spot_BoardTop").intensity, 0);
  assert.equal(by("CF_Spot_BoardTop").castShadow, false, "one shadow map, not two");
  assert.ok(by("CFCL_Area_PieceRim").intensity < 0.95);
  assert.equal(by("CFCL_Area_PieceKey").intensity, 1.27, "a lamp the table does not name is left alone");
  assert.equal(by("CFCL_Sun_GrazeKey").intensity, 0.1);
});

test("the sky's ambient is cut once, so a figure has a lit side and a dark one", () => {
  const { context, scene } = arena(1, tier("medium", 1024));
  createArenaCinema(context);
  assert.ok(scene.environmentIntensity < 0.15 && scene.environmentIntensity > 0.04);
});

test("tiers: depth of field and contact shading on high only; the key's shadow follows the tier's shadow map, and none where it has none", () => {
  const { context, lamps } = arena(1, tier("high", 2048));
  const cinema = createArenaCinema(context);
  cinema.lamps!(lamps);
  assert.ok(cinema.uniforms.uCfFocus.value.w > 0);
  assert.ok(cinema.uniforms.uCfContact.value.z > 0, "contact shading re-reads the depth: the high tier's alone");
  cinema.setQuality!(tier("medium", 512));
  assert.equal(cinema.uniforms.uCfFocus.value.w, 0);
  assert.equal(cinema.uniforms.uCfContact.value.z, 0);
  assert.equal(cinema.key()!.shadow.mapSize.x, 512);
  assert.ok(cinema.key()!.castShadow);
  assert.ok(cinema.key()!.shadow.radius > 2, "a small map is blurred wider");
  cinema.setQuality!(tier("low", 0));
  assert.equal(cinema.key()!.castShadow, false);
  assert.equal(cinema.uniforms.uCfFocus.value.w, 0);
});

test("a cool kicker stands opposite the key, casts nothing, and the low tier goes without it", () => {
  const { context, lamps } = arena(1, tier("high", 2048));
  const cinema = createArenaCinema(context);
  cinema.lamps!(lamps);
  const key = cinema.key()!, kicker = cinema.kicker;
  assert.equal(kicker.parent, context.world);
  assert.equal(kicker.castShadow, false);
  assert.ok(kicker.visible);
  assert.ok(Math.sign(kicker.position.x) === -Math.sign(key.position.x), "the other side of the board");
  assert.ok(kicker.color.b > kicker.color.r, "cool against the warm key");
  assert.ok(kicker.intensity < key.intensity / 3, "an edge, not a second key");
  cinema.setQuality!(tier("low", 0));
  assert.equal(kicker.visible, false);
  cinema.dispose!();
  assert.equal(kicker.parent, null);
});

test("light shafts lie along the key, as tall curtains, and only where a tier can afford the walk", () => {
  const { context, lamps } = arena(1, tier("high", 2048));
  const cinema = createArenaCinema(context);
  cinema.lamps!(lamps);
  const u = cinema.uniforms, key = cinema.key()!.position.clone().normalize();
  const across = u.uCfRayU.value as THREE.Vector3, up = u.uCfRayV.value as THREE.Vector3;
  assert.ok(Math.abs((u.uCfRayDir.value as THREE.Vector3).dot(key) - 1) < 1e-6, "the beams run along the key's light, with the figures' shadows");
  assert.ok(Math.abs(across.dot(key)) < 1e-6 && Math.abs(up.dot(key)) < 1e-6, "the field is read in the plane across the light");
  assert.ok(up.length() < across.length() / 2, "stretched tall: curtains side by side");
  assert.ok(u.uCfRays.value.x > 0 && u.uCfRays.value.y === 16);
  cinema.setQuality!(tier("medium", 1024));
  assert.ok(u.uCfRays.value.x > 0 && u.uCfRays.value.y === 8, "half the steps on medium");
  cinema.setQuality!(tier("medium", 512));
  assert.equal(u.uCfRays.value.x, 0, "none on integrated graphics' medium");
  cinema.setQuality!(tier("low", 0));
  assert.equal(u.uCfRays.value.x, 0);
  cinema.update!(12.5, 0.016);
  assert.equal(u.uCfRayTime.value, 12.5, "the dust drifts on the arena's clock (0 with reduced motion)");
});

test("the surround is half-shadow, never black, and each setting keeps its own colours", () => {
  const one = createArenaCinema(arena(1, tier("high", 2048)).context).uniforms;
  const two = createArenaCinema(arena(2, tier("high", 2048)).context).uniforms;
  assert.ok(one.uCfPool.value.z >= 0.4, "what is left of the light out on the dais");
  assert.ok(one.uCfPool.value.x > 4.08 * 2.3, "the whole board is inside the pool");
  assert.ok(one.uCfContact.value.x < 1.02 / 2, "contact reaches less than half a tile: a figure does not darken its neighbour's square");
  const warm = one.uCfFarCol.value as THREE.Vector3, violet = two.uCfFarCol.value as THREE.Vector3;
  assert.ok(warm.x > warm.z, "Setting 1's far haze is the lava's");
  assert.ok(violet.z > violet.x, "Setting 2's is the night's");
});
