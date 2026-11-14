/**
 * How the arena's air moves: the wind everything in it follows, and what the match does to it. The air itself is
 * arena-air.ts, which keeps this in step with the look (its clock, its tier, its end); the arithmetic is
 * shared/play/air-disturbance.ts.
 *
 * The match tells it what happens on the board (`disturb`: a step, a blow, a body reaching the stone, a spell, a
 * rite; SceneEngine.stirAir). It keeps the last few as uniform arrays, and whatever hangs in the air reads them in
 * its own vertex shader (AIR_MOTION_GLSL): the drifting ash and the eclipse's embers are parted and lifted round
 * each one, and the ash lying on the stone is thrown up from it as a ring (createRaisedAsh). The low mist thins
 * where the heaviest of them rolls over the board's edge. Nothing is worked out per flake on the page: an impulse is
 * one write to the arrays, and a frame costs a dozen comparisons and the wind's few sines.
 *
 * Its clock is the look's (battlefield-look.ts gives the parts the match's own time): held with the pause menu,
 * slowed with a fatality, and 0 under reduced motion, where nothing is added to the air at all.
 */
import * as THREE from "three";
import { AIR_RISE, AIR_SLOTS, airWind, createAirDisturbance, type AirDisturbance, type AirImpulseKind } from "../../../shared/play/air-disturbance";
import type { ArenaContext, ArenaQuality } from "./arena-kit";
import { arenaTier, type Rgb } from "./arena-surface-data";

/** Metres to one of the board's units: the arena's root is scaled by 1/2.3 (arena-kit.ts ArenaContext.world). */
export const ARENA_METRES = 2.3;
/** Flakes of settled ash one impulse may raise, by tier (low, medium, high): the raised ash's whole cost. */
export const RAISED_PER_SLOT = [24, 96, 160] as const;
/** Frames the raised ash is drawn for when the arena is first shown, although nothing is raised yet. */
export const RAISED_WARM_FRAMES = 3;
/** The board's top, in the look's metres (arena-air.ts measures its layers from it), and how far above it ash lies. */
const BOARD_TOP = 0, SETTLED = 0.04;

/**
 * For a vertex shader of something that hangs in the air. `cfAirPush(p)` is how far the match has pushed the air at
 * `p` (metres, the arena's space); `uCfAirWind` is the wind: xy how far it has carried the air (for what wraps
 * round a box), zw how fast it blows now; `uCfAirGust` is the gusts' share of that drift, which stays within a
 * couple of metres (for what must not drift away).
 */
export const AIR_MOTION_GLSL = /* glsl */ `
#define CF_AIR_SLOTS ${AIR_SLOTS}
uniform vec4 uCfAirA[CF_AIR_SLOTS], uCfAirB[CF_AIR_SLOTS], uCfAirC[CF_AIR_SLOTS];
uniform vec4 uCfAirWind;
uniform vec2 uCfAirGust;
uniform float uCfAirNow;
uniform int uCfAirLive;
// what is left of an impulse (shared/play/air-disturbance.ts airEnvelope)
float cfAirEnvelope(float age, float life) {
  float left = 1.0 - age / life;
  return smoothstep(0.0, ${AIR_RISE.toFixed(3)}, age) * left * left;
}
vec3 cfAirPush(vec3 p) {
  vec3 push = vec3(0.0);
  for (int i = 0; i < CF_AIR_SLOTS; i++) {
    if (i >= uCfAirLive) break;
    vec4 a = uCfAirA[i], b = uCfAirB[i];
    float age = uCfAirNow - b.x;
    if (age <= 0.0 || age >= b.z) continue;
    vec3 d = p - a.xyz;
    float span = length(d);
    // outward, and lifted as well as parted: the stone is under it, so the air goes up
    d.y = d.y * 0.5 + 0.35 * span + 1e-4;
    push += normalize(d) * (b.y * cfAirEnvelope(age, b.z) * exp(-span * span / (a.w * a.w)));
  }
  return push;
}`;

export interface ArenaPhysics {
  field: AirDisturbance;
  /** The uniforms AIR_MOTION_GLSL declares: shared by every material that reads the air, by reference. */
  uniforms: {
    uCfAirA: { value: Float32Array }; uCfAirB: { value: Float32Array }; uCfAirC: { value: Float32Array };
    uCfAirWind: { value: THREE.Vector4 }; uCfAirGust: { value: THREE.Vector2 };
    uCfAirNow: { value: number }; uCfAirLive: { value: number };
  };
  /** For the look's final pass: where the low mist is thinned (x, z, radius in metres; amount 0 to 1). */
  mist: { value: THREE.Vector4 };
  /**
   * The match did something to the air: where (the board's units, as the match engine has them), how hard (about 1)
   * and how long from now. Ignored under reduced motion.
   */
  disturb(kind: AirImpulseKind, x: number, y: number, z: number, power?: number, delay?: number): void;
  /** Once a frame, before anything that reads the air is drawn: seconds of the look's clock (0 with reduced motion). */
  update(time: number): void;
  setQuality(quality: ArenaQuality): void;
  dispose(): void;
}

const made = new WeakMap<object, ArenaPhysics>();

/**
 * The air's motion for this arena: made the first time it is asked for (by the air, arena-air.ts), and the same one
 * for whoever asks after (the look, for its embers and for the match).
 */
export function arenaPhysics(context: ArenaContext, tierOf: (quality: ArenaQuality) => 0 | 1 | 2 = arenaTier): ArenaPhysics {
  const existing = made.get(context.shared);
  if (existing) return existing;
  const field = createAirDisturbance();
  const uniforms = {
    uCfAirA: { value: field.a }, uCfAirB: { value: field.b }, uCfAirC: { value: field.c },
    uCfAirWind: { value: new THREE.Vector4() }, uCfAirGust: { value: new THREE.Vector2() },
    uCfAirNow: { value: 0 }, uCfAirLive: { value: 0 },
  };
  const mist = { value: new THREE.Vector4(0, 0, 1, 0) };
  const wind = airWind(0), part: [number, number, number, number] = [0, 0, 1, 0];
  let now = 0, mists = mistParts(context.quality(), tierOf(context.quality()));
  const physics: ArenaPhysics = {
    field, uniforms, mist,
    disturb(kind, x, y, z, power = 1, delay = 0) {
      if (context.reducedMotion()) return;
      field.push({ kind, x: x * ARENA_METRES, y: y * ARENA_METRES, z: z * ARENA_METRES, power, delay }, now);
    },
    update(time) {
      // a clock that has gone back (reduced motion switched on, which stops it at 0) leaves nothing in the air
      if (time < now) field.clear();
      now = time;
      uniforms.uCfAirNow.value = time;
      uniforms.uCfAirLive.value = field.live(time);
      airWind(time, wind);
      uniforms.uCfAirWind.value.set(wind.driftX, wind.driftZ, wind.speedX, wind.speedZ);
      uniforms.uCfAirGust.value.set(wind.gustX, wind.gustZ);
      if (mists && uniforms.uCfAirLive.value > 0) { field.mistAt(time, part); mist.value.set(part[0], part[1], part[2], part[3]); }
      else mist.value.w = 0;
    },
    setQuality(quality) { mists = mistParts(quality, tierOf(quality)); },
    dispose() { made.delete(context.shared); },
  };
  made.set(context.shared, physics);
  return physics;
}

/**
 * Whether the low mist answers the heaviest impulses: one more term per pixel of the final pass while one is live.
 * Not on the low tier (it has no mist), nor on medium on integrated graphics (battlefield-look.ts MEDIUM_INTEGRATED,
 * which is known here by its area lamps being off): that tier gets nothing added to its final pass.
 */
export function mistParts(quality: ArenaQuality, tier: 0 | 1 | 2): boolean {
  return tier === 2 || (tier === 1 && quality.area);
}

/**
 * How the raised ash is lit (arena-air.ts): `ash` is its colour on the board, under the board's key light as well as
 * the sky (the drifting ash hangs in the sky's light alone and is darker); `glow` and `sun` are the drifting ash's
 * bright edge toward the eclipse; `ember` is the colour of what leaves glowing.
 */
export interface RaisedAshLook {
  ash: THREE.Vector3;
  glow: THREE.Vector3;
  sun: THREE.Vector3;
  ember: Rgb;
}

/**
 * The ash lying on the stone, thrown up by what the match does: each impulse raises a ring of flakes from the tile
 * under it, outward as far as its `throw` and up as far as its `lift`, which the air stops, the wind carries and
 * which sink back as the drifting ash sinks. Some leave glowing where the impulse was hot (a spell, a rite, steel on
 * steel) and cool as they go. Every flake's path is worked out in its vertex shader from its impulse's slot, so a
 * frame uploads nothing; while the air is at rest the cloud is not drawn at all (after its first few frames).
 */
export function createRaisedAsh(physics: ArenaPhysics, look: RaisedAshLook) {
  const most = RAISED_PER_SLOT[2], count = AIR_SLOTS * most;
  const seed = new Float32Array(count * 3), flake = new Float32Array(count * 4);
  // a fixed sequence, as the drifting ash has: the same match raises the same flakes
  let state = 40507;
  const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
  // flake by flake across the slots (the first of every slot, then the second of every slot): a tier draws the
  // first so many of each by drawing a shorter run
  for (let i = 0; i < count; i++) {
    seed[i * 3] = random(); seed[i * 3 + 1] = random(); seed[i * 3 + 2] = random();
    flake[i * 4] = i % AIR_SLOTS; flake[i * 4 + 1] = Math.floor(i / AIR_SLOTS);
    flake[i * 4 + 2] = 0.06 + 0.14 * random() * random(); flake[i * 4 + 3] = random();
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(seed, 3));
  geometry.setAttribute("aFlake", new THREE.BufferAttribute(flake, 4));
  const uniforms = {
    ...physics.uniforms,
    uScale: { value: 800 }, uPerSlot: { value: most as number }, uAmount: { value: 1 },
    uAsh: { value: look.ash }, uGlow: { value: look.glow }, uSunDir: { value: look.sun },
    uEmber: { value: new THREE.Vector3(look.ember[0], look.ember[1], look.ember[2]) },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `
      ${AIR_MOTION_GLSL}
      // position: three seeds (the way out, how far, how high); aFlake: its slot, its number in the slot, its size
      // in metres, and the chance it leaves glowing
      attribute vec4 aFlake; uniform float uScale, uPerSlot, uAmount; uniform vec3 uAsh, uGlow, uSunDir, uEmber;
      varying vec4 vColor; varying float vLit;
      void main() {
        int slot = int(aFlake.x + 0.5);
        vec4 a = uCfAirA[slot], b = uCfAirB[slot], c = uCfAirC[slot];
        float age = uCfAirNow - b.x, life = b.z * (0.55 + 0.45 * position.z);
        vColor = vec4(0.0); vLit = 0.0; gl_PointSize = 1.0;
        // not raised: its slot is empty or spent, or the impulse raises fewer flakes than this one's number
        if (age <= 0.0 || age >= life || aFlake.y >= c.y * uPerSlot) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
        float way = position.x * 6.2832;
        vLit = step(aFlake.w, c.z);
        // thrown along the stone as a ring (the front of it at the impulse's throw) and stopped by the air; lifted,
        // then sinking as the drifting ash does, unless it is hot: what glows goes on rising
        float along = 0.12 * a.w * position.y + b.w * (0.72 + 0.28 * position.y) * (1.0 - exp(-3.2 * age));
        // (most of it stays low: the ring is seen as a ring before it has drifted apart)
        float up = c.x * (0.1 + 0.9 * position.z * position.z) * (1.0 + 0.4 * vLit) * (1.0 - exp(-2.5 * age)) + (0.46 * vLit - 0.16) * age;
        vec3 p = vec3(a.x + cos(way) * along, ${BOARD_TOP.toFixed(1)} + ${SETTLED.toFixed(2)} + max(up, 0.0), a.z + sin(way) * along);
        // once it is off the stone the wind has it
        p.xz += uCfAirWind.zw * age * smoothstep(0.0, 0.3, up);
        vec4 world = modelMatrix * vec4(p, 1.0);
        vec4 mv = viewMatrix * world;
        gl_Position = projectionMatrix * mv;
        // its true size on screen (uScale is pixels a metre at one metre; the view's depth is in the board's units),
        // never more than a small share of the picture's height however near the camera comes
        float size = aFlake.z * uScale / max(-mv.z * ${ARENA_METRES.toFixed(1)}, 0.01);
        gl_PointSize = clamp(size, 1.5, clamp(uScale * 0.008, 4.0, 10.0));
        float fade = smoothstep(0.0, 0.07, age) * pow(1.0 - age / life, 1.5);
        float alpha = smoothstep(0.4, 1.6, -mv.z) * (1.0 - smoothstep(16.0, 30.0, -mv.z)) * min(1.0, size) * uAmount * fade;
        float forward = pow(max(dot(normalize(world.xyz - cameraPosition), uSunDir), 0.0), 8.0);
        // ash is laid over the picture; what glows is added to it, and cools faster than it fades
        vColor = mix(vec4(uAsh + uGlow * forward, alpha * (0.5 + 0.3 * position.y)), vec4(uEmber * fade, alpha), vLit);
      }`,
    fragmentShader: /* glsl */ `
      varying vec4 vColor; varying float vLit;
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        float a = vColor.a * (1.0 - smoothstep(0.1, 0.25, dot(c, c)));
        gl_FragColor = vec4(vColor.rgb * a, a * (1.0 - vLit));
      }`,
    transparent: true, depthWrite: false, blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
  });
  const points = new THREE.Points(geometry, material);
  points.name = "arena-ash-raised";
  points.frustumCulled = false;
  points.renderOrder = 5;
  // Drawn for its first frames, with every flake still out of sight: its program is then built with the arena's
  // others under the loading screen, not on the first footfall of the match.
  let warming = RAISED_WARM_FRAMES;
  return {
    points, uniforms, geometry, material,
    setTier(tier: 0 | 1 | 2) {
      uniforms.uPerSlot.value = RAISED_PER_SLOT[tier];
      geometry.setDrawRange(0, AIR_SLOTS * RAISED_PER_SLOT[tier]);
    },
    /** Once a frame, after the physics' own update: `scale` is the drifting ash's (pixels a metre at 1 m). */
    update(scale: number, shown: boolean) {
      uniforms.uScale.value = scale;
      points.visible = shown && (physics.uniforms.uCfAirLive.value > 0 || warming-- > 0);
    },
    dispose() { points.removeFromParent(); geometry.dispose(); material.dispose(); },
  };
}
