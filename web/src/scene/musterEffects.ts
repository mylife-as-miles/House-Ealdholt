/**
 * Each army takes the field in its own kingdom's manner during the match opening (the white and black beats of
 * shared/play/match-opening.ts). While a figure burns in, its kingdom's sigil is inscribed on the tile under it and its
 * kingdom's motes rise round it; as it stands whole the sigil flares and the figure throws off a last burst, and within
 * a second nothing of it is left (the sigil goes in half that). The burning edge takes the kingdom's ember colour as
 * well (the engine sets it with PieceView.setDissolveEmber from the style returned by {@link MusterEffects.track}).
 *
 * It has to be cheap on an Intel UHD 630, so while an opening plays it is two draw calls in all: every particle of both
 * armies in one set of points, and every sigil in one instanced quad. Nothing is drawn or updated outside an opening.
 * Each particle's path is worked out on the graphics card from the opening's clock and from how far its figure has
 * formed, so a frame only uploads two small uniform arrays and allocates nothing. The patterns are drawn in the shaders,
 * without textures.
 */
import * as THREE from "three";

import type { ArmySkinId } from "../assets/generated";
import type { Faction } from "../core/types";

/** Figures the effects can follow at once: both armies' sixteen. */
export const MUSTER_SLOTS = 32;
/** Particles one figure may shed in all, every emitter of its kingdom together. */
export const SLOT_PARTICLES = 64;
/** Seconds a sigil lasts after its figure stands: the flare, then the fade. */
export const FLOURISH_SECONDS = 0.5;
/** Seconds a forming figure goes on shedding after it stands, so that its motes do not all stop on one frame. */
export const SHED_TAIL = 0.05;
/**
 * Radius of a sigil's ring in board units, for a figure of height 1 (taller figures reach a little further). A square
 * is 1.02 across and the side's own ring under each figure is 0.36, so the sigil rings that ring inside the tile.
 */
export const SIGIL_RADIUS = 0.45;
/** Height of the sigils above the board: over the side's ring (0.012), clear of the tiles. */
const SIGIL_LIFT = 0.02;
/** How far a sigil's quad reaches, in sigil radii: room for the pulse that runs out over the board at the stand. */
const SIGIL_EXTENT = 1.65;
/**
 * How far the patterns themselves reach, in sigil radii. Outside the pulse's short run a sigil's quad is drawn only this
 * large, and nothing past it is shaded: seen low and close, a whole quad covers a good part of the screen.
 */
const SIGIL_REACH = 1.3;
/** The desert wind that carries Solforiz's ash and sand (and a little of Kwind-09's steam), in board units a second. */
const WIND = new THREE.Vector3(-0.55, 0, 0.08);
/** "Not yet", as the graphics card is told it: an infinity is not safe in a uniform. */
const NEVER = 1e5;

export type MusterMotion = "rise" | "spiral" | "burst" | "arc";
export type MusterShape = "dot" | "flame" | "streak" | "flake" | "star" | "puff" | "bolt";
export type SigilPattern = "heraldic" | "seared" | "academy" | "dial";

/** One kind of particle a kingdom's figures shed. */
export interface MusterEmitter {
  /** What it is, for the reader. */
  name: string;
  /** Shed while the figure forms (each particle in turn, again and again until it stands), or once as it stands. */
  when: "forming" | "standing";
  /**
   * rise: up from a ring round the figure; spiral: round it and up; burst: thrown from its feet and slowed by the air;
   * arc: the joints of a bolt between two points on the figure, struck afresh each life (drawn with the bolt shape,
   * a streak from each joint to the next).
   */
  motion: MusterMotion;
  shape: MusterShape;
  count: number;
  /** An arc's joints per bolt (the count is whole bolts of these). */
  perArc?: number;
  /** sRGB colour, and how bright it burns (or, for a matte particle, how lit it is). */
  color: number;
  gain: number;
  /** Left out, it adds light (fire, magic); above 0 it covers what is behind it that much (ash, sand, steam). */
  matte?: number;
  /** World size, from and to (a bolt's: the width of its line). */
  size: [number, number];
  /** Seconds each lives, from and to. */
  life: [number, number];
  /** Seconds after the stand before it is thrown (standing emitters only). */
  delay?: [number, number];
  /** Distance from the figure's axis it starts at, in board units (an arc's bolt runs this far out). */
  radius: number;
  /** Where up the figure it starts, as fractions of the figure's height. */
  height: [number, number];
  /** Starts round a band that climbs from the bottom of `height` to the top of it as the figure forms. */
  climb?: boolean;
  /** Rising speed (rise, spiral) or outward speed (burst), in board units a second. */
  speed?: number;
  /** A burst's upward speed. */
  lift?: number;
  /** How fast a rising particle drifts outward. */
  spread?: number;
  /** A spiral's turn, in radians a second. */
  spin?: number;
  /** How much of the wind takes it. */
  wind?: number;
  /** Downward pull; below 0 it floats up. */
  gravity?: number;
  /** An arc's sweep round the figure (radians) and its climb (fractions of the height; below 0 always upward). */
  span?: number;
  rise?: number;
  /** How many times a second an arc re-forks. */
  crackle?: number;
  /** A streak's length over its width. */
  stretch?: number;
  /** How much it flickers, 0 to 1. */
  twinkle?: number;
}

export interface MusterStyle {
  /** The kingdom that fields the army. */
  kingdom: string;
  /** The burning edge's colour (sRGB) and how hard it burns, against the side's own (1). */
  ember: number;
  emberGain: number;
  /** The sigil inscribed under each figure: its pattern, its three colours (sRGB) with their strengths, its turn. */
  sigil: {
    pattern: SigilPattern;
    ink: number; inkGain: number;
    gild: number; gildGain: number;
    accent: number; accentGain: number;
    /** Radians a second. */
    spin: number;
  };
  emitters: MusterEmitter[];
}

/**
 * The four kingdoms (the creator's art direction: assets/korvenia/ART_DIRECTION.md, assets/solforiz/ART_DIRECTION.md and
 * docs/legacy/environment/NATION_KWIND-09.md). Each figure is seen close up, low and from the side, so the effects stay
 * short and spare: a sigil, one or two kinds of mote while it forms, one burst as it stands.
 */
export const MUSTER_STYLES: Record<ArmySkinId, MusterStyle> = {
  // Aethelgard: ivory and gold, swords and shields, and the cold witchfire of its staves (see spells.ts). A heraldic
  // ring of gold with a cross of swords is inscribed under each figure; gold motes rise off it as it forms, with pale
  // wisps of witchfire low about its feet, and it stands in a spray of gold.
  ivory: {
    kingdom: "Aethelgard",
    ember: 0xffc35a, emberGain: 1,
    sigil: { pattern: "heraldic", ink: 0xffb847, inkGain: 1.5, gild: 0x8fc4ff, gildGain: 0.8, accent: 0xfff1d6, accentGain: 1.1, spin: 0.25 },
    emitters: [
      { name: "gold motes", when: "forming", motion: "rise", shape: "dot", count: 24, color: 0xffcc66, gain: 2.4, size: [0.02, 0.034], life: [0.45, 0.7], radius: 0.24, height: [0.05, 0.95], climb: true, speed: 0.35, spread: 0.05, gravity: -0.15, twinkle: 0.8 },
      { name: "witchfire", when: "forming", motion: "rise", shape: "flame", count: 6, color: 0x9fd0ff, gain: 0.9, size: [0.09, 0.14], life: [0.4, 0.6], radius: 0.18, height: [0, 0.35], speed: 0.5, twinkle: 0.3 },
      { name: "gold spray", when: "standing", motion: "burst", shape: "dot", count: 18, color: 0xffd27a, gain: 3, size: [0.018, 0.03], life: [0.35, 0.55], radius: 0.16, height: [0.02, 0.12], speed: 0.85, lift: 0.7, gravity: 0.8, twinkle: 0.5 },
      { name: "witchfire flare", when: "standing", motion: "burst", shape: "flame", count: 4, color: 0xa8d0ff, gain: 1.1, size: [0.12, 0.18], life: [0.3, 0.45], radius: 0.1, height: [0, 0.1], speed: 0.1, lift: 0.8, gravity: -0.4 },
    ],
  },
  // Solforiz, the Scorched Caliphate: ash, sulphur, furnace fire and copper, and the desert's wind. A sun of cracks is
  // seared into the tile, white-hot as the figure stands and cooling to copper; sparks and ash stream off the figure on
  // the wind, and it stands in a gust of sand.
  sun: {
    kingdom: "Solforiz",
    ember: 0xff5a14, emberGain: 1.6,
    sigil: { pattern: "seared", ink: 0xff6a1a, inkGain: 2, gild: 0x9c4a22, gildGain: 0.9, accent: 0xffc35c, accentGain: 2.2, spin: 0 },
    emitters: [
      { name: "sparks", when: "forming", motion: "rise", shape: "streak", count: 16, color: 0xffa040, gain: 3.2, size: [0.011, 0.017], stretch: 4, life: [0.35, 0.6], radius: 0.2, height: [0.05, 0.95], climb: true, speed: 0.7, spread: 0.1, wind: 0.9, gravity: 0.3 },
      { name: "ash", when: "forming", motion: "rise", shape: "flake", count: 14, color: 0x8a8078, gain: 0.45, matte: 0.85, size: [0.02, 0.036], life: [0.5, 0.7], radius: 0.24, height: [0.1, 1], speed: 0.25, wind: 1.3 },
      { name: "sand gust", when: "standing", motion: "burst", shape: "puff", count: 16, color: 0x8a6a45, gain: 1.2, matte: 0.55, size: [0.06, 0.11], life: [0.45, 0.65], radius: 0.25, height: [0, 0.25], speed: 0.3, lift: 0.35, wind: 2.2 },
      { name: "dust", when: "standing", motion: "burst", shape: "puff", count: 4, color: 0x7a5c3c, gain: 0.9, matte: 0.35, size: [0.13, 0.19], life: [0.5, 0.65], radius: 0.15, height: [0, 0.2], speed: 0.15, lift: 0.4, wind: 1.8 },
      { name: "furnace sparks", when: "standing", motion: "burst", shape: "streak", count: 10, color: 0xffb050, gain: 3.5, size: [0.011, 0.016], stretch: 4, life: [0.3, 0.5], radius: 0.12, height: [0.02, 0.2], speed: 0.8, lift: 1, wind: 0.8, gravity: 2 },
    ],
  },
  // Korvenia: occult aristocracy, Belle Epoque luxury and academy magic, beautiful before it is frightening. A violet
  // circle of glyphs turns under the figure, a silver star in it over a rose window of stained glass; silver stars
  // spiral up round the figure as it forms, and it stands in a shower of them.
  empire: {
    kingdom: "Korvenia",
    ember: 0xa66cff, emberGain: 1.5,
    sigil: { pattern: "academy", ink: 0x9466ff, inkGain: 1.5, gild: 0xe8e4ff, gildGain: 1.2, accent: 0xd9a95a, accentGain: 0.9, spin: 0.45 },
    emitters: [
      { name: "silver stars", when: "forming", motion: "spiral", shape: "star", count: 22, color: 0xe6e0ff, gain: 2, size: [0.035, 0.055], life: [0.55, 0.75], radius: 0.3, height: [0, 0.7], climb: true, speed: 0.45, spin: 3.6, twinkle: 0.6 },
      { name: "violet motes", when: "forming", motion: "rise", shape: "dot", count: 10, color: 0xb07cff, gain: 1.6, size: [0.012, 0.02], life: [0.45, 0.65], radius: 0.22, height: [0.05, 0.9], climb: true, speed: 0.3, twinkle: 0.5 },
      { name: "gold glints", when: "forming", motion: "spiral", shape: "star", count: 6, color: 0xe0b060, gain: 1.6, size: [0.025, 0.04], life: [0.55, 0.75], radius: 0.34, height: [0, 0.6], climb: true, speed: 0.4, spin: -3, twinkle: 0.7 },
      { name: "star shower", when: "standing", motion: "burst", shape: "star", count: 14, color: 0xf0ecff, gain: 2.4, size: [0.04, 0.065], life: [0.4, 0.6], radius: 0.22, height: [0.05, 0.4], speed: 0.45, lift: 0.8, gravity: -0.2, twinkle: 0.4 },
    ],
  },
  // Kwind-09, the zaibatsu: soot black, verdigris, brass, sodium lamps, and cyan arc-tech and steam. A dial of sodium
  // lamps steps round the tile with a cyan reticle inside it; arcs crackle over the figure as it forms, throwing weld
  // spatter, and it stands with a last discharge to the ground and a vent of steam.
  kwind: {
    kingdom: "Kwind-09",
    ember: 0x46e6ff, emberGain: 1,
    sigil: { pattern: "dial", ink: 0xffa22e, inkGain: 1.5, gild: 0x3fe0ff, gildGain: 1.4, accent: 0x5fbf98, accentGain: 0.6, spin: 0 },
    emitters: [
      { name: "cyan arcs", when: "forming", motion: "arc", shape: "bolt", count: 22, perArc: 11, color: 0x7af4ff, gain: 3, size: [0.01, 0.013], life: [0.1, 0.18], radius: 0.2, height: [0.1, 0.9], climb: true, span: 1.1, rise: 0.4, crackle: 30 },
      { name: "amber arc", when: "forming", motion: "arc", shape: "bolt", count: 11, perArc: 11, color: 0xffb04a, gain: 2.6, size: [0.009, 0.012], life: [0.12, 0.2], radius: 0.22, height: [0.1, 0.9], climb: true, span: 0.9, rise: 0.4, crackle: 26 },
      { name: "weld spatter", when: "forming", motion: "rise", shape: "streak", count: 5, color: 0xffc060, gain: 3, size: [0.008, 0.012], stretch: 4, life: [0.3, 0.5], radius: 0.2, height: [0.2, 0.9], climb: true, speed: 0.6, spread: 0.35, gravity: 3 },
      { name: "steam", when: "forming", motion: "rise", shape: "puff", count: 2, color: 0xa8b4bc, gain: 1.1, matte: 0.55, size: [0.07, 0.11], life: [0.6, 0.7], radius: 0.2, height: [0, 0.12], speed: 0.3, wind: 0.3 },
      { name: "discharge", when: "standing", motion: "arc", shape: "bolt", count: 18, perArc: 9, color: 0xb8fbff, gain: 3.4, size: [0.012, 0.015], life: [0.16, 0.16], radius: 0.2, height: [0, 0], span: 0.7, rise: -0.85, crackle: 40 },
      { name: "steam vent", when: "standing", motion: "burst", shape: "puff", count: 6, color: 0xa8b4bc, gain: 1.1, matte: 0.6, size: [0.08, 0.13], life: [0.6, 0.8], radius: 0.18, height: [0, 0.15], speed: 0.25, lift: 0.5, wind: 0.3, gravity: -0.3 },
    ],
  },
};

const MOTION_ID: Record<MusterMotion, number> = { rise: 0, spiral: 1, burst: 2, arc: 3 };
const SHAPE_ID: Record<MusterShape, number> = { dot: 0, flame: 1, streak: 2, flake: 3, star: 4, puff: 5, bolt: 6 };
const PATTERN_ID: Record<SigilPattern, number> = { heraldic: 0, seared: 1, academy: 2, dial: 3 };

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const smoothstep = (from: number, to: number, value: number) => { const t = clamp01((value - from) / (to - from)); return t * t * (3 - 2 * t); };

// The timing below is the shaders' own, written out again here so that it can be tested; keep the two alike.

/** How much of a sigil is inscribed: it is drawn in over the first part of the burn, before the figure shows. */
export function sigilDraw(reveal: number): number {
  return smoothstep(0, 0.3, reveal);
}

/** How bright a sigil burns: steadily while its figure forms, flaring as it stands, gone FLOURISH_SECONDS later. */
export function sigilGlow(reveal: number, standAge: number | null): number {
  if (standAge === null) return 0.65 * smoothstep(0, 0.15, reveal);
  const age = Math.max(0, standAge);
  return (0.65 + 1.2 * Math.exp(-age * 10)) * (1 - smoothstep(0.12, FLOURISH_SECONDS, age));
}

/** The ring that runs out over the board as a figure stands: its radius in sigil radii, and its strength. */
export function sigilPulse(standAge: number | null): { radius: number; glow: number } {
  if (standAge === null) return { radius: 1, glow: 0 };
  const k = clamp01(standAge / 0.4);
  return { radius: 1 + 0.6 * (1 - (1 - k) * (1 - k)), glow: (1 - k) * (1 - k) * 1.4 };
}

/**
 * A forming particle's age in seconds, or null while it waits its turn or once its figure has stood. Each one is shed
 * `offset` (a share of its life) after the figure starts to form, then again every life, until the figure stands;
 * the last ones shed live out their lives.
 */
export function shedAge(time: number, kindledAt: number, stoodAt: number, offset: number, life: number): number | null {
  const since = time - kindledAt - offset * life;
  if (since < 0 || life <= 0) return null;
  const age = since - Math.floor(since / life) * life;
  return time - age > stoodAt + SHED_TAIL ? null : age;
}

/** A standing particle's age in seconds, or null outside its one life. */
export function burstAge(time: number, stoodAt: number, delay: number, life: number): number | null {
  const age = time - stoodAt - delay;
  return age >= 0 && age < life ? age : null;
}

/** At most how many seconds after its figure stands anything of a kingdom's effect is still to be seen. */
export function settleSeconds(style: MusterStyle): number {
  let longest = FLOURISH_SECONDS;
  for (const emitter of style.emitters) {
    const after = emitter.when === "forming" ? SHED_TAIL + emitter.life[1] : (emitter.delay?.[1] ?? 0) + emitter.life[1];
    longest = Math.max(longest, after);
  }
  return longest;
}

/** Particles a style asks for in all. */
export function styleParticles(style: MusterStyle): number {
  return style.emitters.reduce((sum, emitter) => sum + emitter.count, 0);
}

const HASH_GLSL = /* glsl */ `
float hash11(float p) { p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }
vec3 hash31(float p) {
  vec3 q = fract(vec3(p) * vec3(0.1031, 0.1030, 0.0973));
  q += dot(q, q.yzx + 33.33);
  return fract((q.xxy + q.yzz) * q.zyx);
}`;

const SLOT_GLSL = /* glsl */ `
#define SLOTS ${MUSTER_SLOTS}
#define NEVER ${NEVER.toFixed(1)}
#define TAU 6.28318531
uniform float uTime;
// Per figure: where it stands, how tall it is and how high above the stone it forms (x, z, height, lift); how far it
// has formed, how fast, when it started and when it stood (reveal, reveal per second, kindled at, stood at; NEVER for
// not yet).
uniform vec4 uSlotA[SLOTS];
uniform vec4 uSlotB[SLOTS];`;

const PARTICLE_VERTEX = /* glsl */ `
${SLOT_GLSL}
#define TAIL ${SHED_TAIL.toFixed(3)}
uniform float uScale;
uniform vec3 uWind;
attribute vec4 aSlot;   // slot, motion (below 0: none), shape, shed as it stands (1) or while it forms (0)
attribute vec2 aTime;   // forming: when in its life it is first shed (0 to 1); standing: its delay; then its life
attribute vec2 aBand;   // where up the figure it starts (fractions); a negative top climbs with the burn
attribute vec4 aMove;   // speed, then spread / spin / lift, wind, gravity; for an arc: radius, sweep, climb, forks
// position is (seed, distance from the figure's axis, 0); for an arc's joint (seed, its number, the bolt's last number)
attribute vec4 aLook;   // size, stretch, twinkle, matte
attribute vec3 aColor;
varying vec3 vColor;
varying float vMatte;
varying float vShape;
varying float vStretch;
varying vec2 vDir;
${HASH_GLSL}

// One joint of a bolt: the bolt's two ends are shared by its joints, the pushes off the line between them are each
// joint's own, and none at the ends. A joint is named by its number, so that the joint before it, drawing the streak
// up to it, finds it exactly where it is.
vec3 boltJoint(float joint, float joints, float seed, float cycle, float fork, vec3 base, float radius, float a0, float a1, float h0, float h1, float height) {
  float u = joint / joints;
  float j = hash11(seed * 31.7 + joint * 17.3 + cycle * 5.31 + fork * 11.13) - 0.5;
  float k = hash11(seed * 13.3 + joint * 29.1 + cycle * 2.17 + fork * 7.71) - 0.5;
  float bow = sin(3.14159265 * u);
  float ang = mix(a0, a1, u) + j * 0.32 * bow;
  return base + vec3(cos(ang), 0.0, sin(ang)) * (radius * (1.0 + 0.3 * bow) + k * 0.06 * bow) + vec3(0.0, height * mix(h0, h1, u) + j * 0.08 * bow, 0.0);
}

void main() {
  vColor = vec3(0.0); vMatte = 0.0; vShape = aSlot.z; vStretch = max(1.0, aLook.y); vDir = vec2(0.0, 1.0);
  // Anything not out is put beyond the clip volume, where nothing of it is drawn.
  gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
  gl_PointSize = 1.0;
  if (aSlot.y < -0.5) return;
  int slot = int(aSlot.x + 0.5);
  vec4 A = uSlotA[slot];
  vec4 B = uSlotB[slot];
  if (B.z >= NEVER) return;
  float life = aTime.y;
  float age;
  float cycle = 0.0;
  if (aSlot.w > 0.5) {
    if (B.w >= NEVER) return;
    age = uTime - B.w - aTime.x;
    if (age < 0.0 || age >= life) return;
  } else {
    float since = uTime - B.z - aTime.x * life;
    if (since < 0.0) return;
    cycle = floor(since / life);
    age = since - cycle * life;
    if (uTime - age > B.w + TAIL) return;
  }
  float t = age / life;
  // Fresh chances each time it is shed, so a mote does not retrace the last one's path.
  vec3 rnd = hash31(position.x * 173.31 + cycle * 7.137 + aSlot.x * 0.617);
  float height = A.z;
  float reach = 0.8 + 0.2 * height;
  vec3 base = vec3(A.x, A.w, A.y);
  // How whole the figure was when this one was shed.
  float born = clamp(B.x - B.y * age, 0.0, 1.0);
  float lo = aBand.x, hi = abs(aBand.y);
  float rise = aBand.y < 0.0 ? clamp(mix(lo, hi, born) + (rnd.z - 0.5) * 0.3, 0.0, 1.0) : mix(lo, hi, rnd.z);
  float y0 = height * rise;
  vec3 p;
  vec3 v = vec3(0.0);
  vec3 next = vec3(0.0);
  float motion = aSlot.y;
  if (motion < 0.5) {
    float ang = TAU * (position.x + rnd.x);
    vec3 out1 = vec3(cos(ang), 0.0, sin(ang));
    float speed = aMove.x * (0.75 + 0.5 * rnd.z);
    float sway = 0.02 * sin(age * 6.0 + position.x * 40.0);
    p = base + out1 * (position.y * reach * (0.7 + 0.6 * rnd.y) + aMove.y * age) + vec3(-out1.z, 0.0, out1.x) * sway
      + vec3(0.0, y0 + speed * age - 0.5 * aMove.w * age * age, 0.0) + uWind * aMove.z * age;
    v = out1 * aMove.y + vec3(0.0, speed - aMove.w * age, 0.0) + uWind * aMove.z;
  } else if (motion < 1.5) {
    float spin = aMove.y * (0.8 + 0.4 * rnd.y);
    float ang = TAU * (position.x + rnd.x) + spin * age;
    vec3 out1 = vec3(cos(ang), 0.0, sin(ang));
    float radius = position.y * reach * (0.85 + 0.3 * rnd.y) * (1.0 - 0.45 * t);
    float speed = aMove.x * (0.8 + 0.4 * rnd.z);
    p = base + out1 * radius + vec3(0.0, y0 + speed * age, 0.0) + uWind * aMove.z * age;
    v = vec3(-out1.z, 0.0, out1.x) * radius * spin + vec3(0.0, speed, 0.0);
  } else if (motion < 2.5) {
    float ang = TAU * (position.x + rnd.x);
    vec3 out1 = vec3(cos(ang), 0.0, sin(ang));
    vec3 v0 = out1 * aMove.x * (0.6 + 0.8 * rnd.y) + vec3(0.0, aMove.y * (0.6 + 0.8 * rnd.z), 0.0);
    float slow = exp(-2.6 * age);
    p = base + out1 * position.y * reach * (0.6 + 0.8 * rnd.y) + vec3(0.0, y0, 0.0) + v0 * (1.0 - slow) / 2.6
      + uWind * aMove.z * age - vec3(0.0, 0.5 * aMove.w * age * age, 0.0);
    v = v0 * slow + uWind * aMove.z - vec3(0.0, aMove.w * age, 0.0);
  } else {
    // A bolt between two points on the figure, struck afresh each life and forking a few times within it. Each joint
    // draws the streak from itself to the next, so the last draws nothing.
    float joint = position.y, joints = max(1.0, position.z);
    if (joint > joints - 0.5) return;
    vec3 bolt = hash31(position.x * 59.13 + cycle * 3.71 + aSlot.x * 1.31);
    float a0 = TAU * bolt.x;
    float a1 = a0 + (bolt.y > 0.5 ? 1.0 : -1.0) * aMove.y * (0.6 + 0.8 * bolt.z);
    float climb = aMove.z < 0.0 ? -aMove.z * (0.5 + 0.5 * bolt.z) : (bolt.z - 0.5) * aMove.z;
    float h1 = clamp(rise + climb, 0.0, 1.0);
    float fork = floor(age * aMove.w);
    // Now and then the bolt is out altogether: an arc stutters.
    if (hash11(position.x * 7.13 + cycle * 1.93 + fork * 3.37) < 0.18) return;
    p = boltJoint(joint, joints, position.x, cycle, fork, base, aMove.x * reach, a0, a1, rise, h1, height);
    next = boltJoint(joint + 1.0, joints, position.x, cycle, fork, base, aMove.x * reach, a0, a1, rise, h1, height);
  }
  float shape = aSlot.z;
  float size = aLook.x * (0.8 + 0.4 * rnd.y);
  float fade = smoothstep(0.0, 0.12, t) * (1.0 - smoothstep(0.55, 1.0, t));
  if (shape > 4.5) {
    // A puff swells as it thins.
    size *= 1.0 + 1.5 * t;
    fade = smoothstep(0.0, 0.15, t) * (1.0 - smoothstep(0.35, 1.0, t));
  } else if (shape > 1.5 && shape < 2.5) {
    // A spark burns down.
    size *= 1.0 - 0.45 * t;
    fade = smoothstep(0.0, 0.06, t) * (1.0 - smoothstep(0.5, 1.0, t));
  } else if (shape > 2.5 && shape < 3.5) {
    // A flake of ash turns over as it goes, thin edge-on.
    size *= 0.55 + 0.45 * abs(sin(age * 9.0 + position.x * 30.0));
  }
  float twinkle = 1.0 - aLook.z * 0.5 * (1.0 + sin(uTime * 21.0 + position.x * 57.0 + cycle * 2.3));
  if (motion > 2.5) {
    // One stretch of a bolt: a sprite centred between this joint and the next, long enough to reach both (a little
    // over, so that the stretches meet), with the line drawn along it.
    vec4 from = projectionMatrix * (viewMatrix * vec4(p, 1.0));
    vec4 to = projectionMatrix * (viewMatrix * vec4(next, 1.0));
    if (from.w <= 0.0 || to.w <= 0.0) return;
    vec2 run = (to.xy / to.w - from.xy / from.w) * vec2(uScale / projectionMatrix[0][0], uScale / projectionMatrix[1][1]);
    float len = length(run);
    vec4 middle = viewMatrix * vec4(0.5 * (p + next), 1.0);
    gl_Position = projectionMatrix * middle;
    float width = aLook.x * uScale / max(0.05, -middle.z);
    float line = max(1.5, width);
    float span = len * 1.2 + line * 2.0;
    if (len > 1e-4) vDir = run / len;
    vStretch = span / line;
    gl_PointSize = clamp(span, 2.0, 192.0);
    vColor = aColor * fade * clamp(width / 1.5, 0.0, 1.0);
    return;
  }
  vec4 view = viewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * view;
  float pixels = size * vStretch * uScale / max(0.05, -view.z);
  if (shape > 1.5 && shape < 2.5) {
    // Which way a streak runs on screen: along its flight.
    vec4 ahead = projectionMatrix * (viewMatrix * vec4(p + v * 0.05, 1.0));
    if (ahead.w > 0.0 && gl_Position.w > 0.0) {
      vec2 d = ahead.xy / ahead.w - gl_Position.xy / gl_Position.w;
      d.x *= projectionMatrix[1][1] / projectionMatrix[0][0];
      float len = length(d);
      if (len > 1e-6) vDir = d / len;
    }
  }
  // Under two pixels a mote is drawn at two and dimmed, rather than flickering in and out.
  float small = clamp(pixels / 2.0, 0.0, 1.0);
  gl_PointSize = clamp(pixels, 2.0, 192.0);
  float strength = fade * twinkle * small * small;
  float matte = aLook.w;
  vColor = aColor * strength * (matte > 0.0 ? matte : 1.0);
  vMatte = matte * strength;
}`;

const PARTICLE_FRAGMENT = /* glsl */ `
varying vec3 vColor;
varying float vMatte;
varying float vShape;
varying float vStretch;
varying vec2 vDir;
void main() {
  vec2 q = gl_PointCoord * 2.0 - 1.0;
  q.y = -q.y;
  float r2 = dot(q, q);
  if (r2 > 1.0) discard;
  float edge = 1.0 - r2;
  float c;
  if (vShape < 0.5) {
    // A mote: a hot heart in a soft halo.
    c = exp(-r2 * 12.0) + 0.3 * exp(-r2 * 3.5) * edge;
  } else if (vShape < 1.5) {
    // A wisp of witchfire: a soft tongue of cold light drawn upward, with no hard edge or point to it.
    float y = q.y * 0.5 + 0.5;
    float x = q.x / mix(0.42, 0.12, y);
    c = 0.8 * exp(-x * x * 2.2) * smoothstep(0.0, 0.3, y) * (1.0 - smoothstep(0.45, 1.0, y));
  } else if (vShape < 2.5) {
    // A spark: a streak along its flight.
    float along = dot(q, vDir), across = dot(q, vec2(-vDir.y, vDir.x)) * vStretch;
    c = exp(-along * along * 3.0 - across * across * 7.0) * edge + 0.6 * exp(-along * along * 14.0 - across * across * 26.0);
  } else if (vShape < 3.5) {
    // A flake of ash.
    c = 1.0 - smoothstep(0.2, 0.75, r2);
  } else if (vShape < 4.5) {
    // A star: four sharp rays and a bright heart.
    float ax = abs(q.x), ay = abs(q.y);
    c = exp(-r2 * 18.0) + 0.85 * (exp(-ax * 16.0 - ay * 2.4) + exp(-ay * 16.0 - ax * 2.4)) * edge;
  } else if (vShape < 5.5) {
    // A puff of steam or dust.
    c = edge * edge;
  } else {
    // A stretch of a bolt: an even line with a white-hot thread down it, its ends overlapping the next stretch's.
    float along = abs(dot(q, vDir)), across = dot(q, vec2(-vDir.y, vDir.x)) * vStretch;
    c = (1.0 - smoothstep(0.8, 1.0, along)) * (0.55 * exp(-across * across * 5.0) + exp(-across * across * 40.0));
  }
  // Premultiplied: a glowing particle adds its light and covers nothing, a matte one covers what is behind it.
  gl_FragColor = vec4(vColor * c, vMatte * c);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const SIGIL_VERTEX = /* glsl */ `
${SLOT_GLSL}
#define FLOURISH ${FLOURISH_SECONDS.toFixed(3)}
#define EXTENT ${SIGIL_EXTENT.toFixed(3)}
#define REACH ${SIGIL_REACH.toFixed(3)}
uniform float uRadius;
uniform float uLift;
attribute vec4 aSigil;   // slot, pattern, spin, seed
attribute vec3 aInk;
attribute vec3 aGild;
attribute vec3 aAccent;
varying vec2 vP;
varying float vDraw;
varying float vGlow;
varying float vPulse;
varying float vPulseGlow;
varying float vCool;
varying float vPattern;
varying float vSeed;
varying float vSpin;
varying vec3 vInk;
varying vec3 vGild;
varying vec3 vAccent;
void main() {
  vP = position.xz; vDraw = 0.0; vGlow = 0.0; vPulse = 1.0; vPulseGlow = 0.0; vCool = 0.3;
  vPattern = aSigil.y; vSeed = aSigil.w; vSpin = 0.0; vInk = aInk; vGild = aGild; vAccent = aAccent;
  gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
  int slot = int(aSigil.x + 0.5);
  vec4 A = uSlotA[slot];
  vec4 B = uSlotB[slot];
  if (B.z >= NEVER) return;
  float glow;
  if (B.w >= NEVER) {
    glow = 0.65 * smoothstep(0.0, 0.15, B.x);
  } else {
    float age = max(0.0, uTime - B.w);
    glow = (0.65 + 1.2 * exp(-age * 10.0)) * (1.0 - smoothstep(0.12, FLOURISH, age));
    float k = clamp(age / 0.4, 0.0, 1.0);
    vPulse = 1.0 + 0.6 * (1.0 - (1.0 - k) * (1.0 - k));
    vPulseGlow = (1.0 - k) * (1.0 - k) * 1.4;
    vCool = clamp(age / FLOURISH, 0.0, 1.0);
  }
  if (glow < 0.002 && vPulseGlow < 0.002) return;
  float reach = 0.8 + 0.2 * A.z;
  // The whole quad only while the pulse runs out; otherwise just as far as the pattern goes.
  float extent = vPulseGlow > 0.002 ? 1.0 : REACH / EXTENT;
  vP = position.xz * extent;
  vec3 world = vec3(A.x + vP.x * uRadius * reach, uLift, A.y + vP.y * uRadius * reach);
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
  vDraw = smoothstep(0.0, 0.3, B.x);
  vGlow = glow;
  vSpin = aSigil.z * (uTime - B.z);
}`;

const SIGIL_FRAGMENT = /* glsl */ `
#define TAU 6.28318531
#define PI 3.14159265
#define EXTENT ${SIGIL_EXTENT.toFixed(3)}
#define REACH ${SIGIL_REACH.toFixed(3)}
uniform float uTime;
varying vec2 vP;
varying float vDraw;
varying float vGlow;
varying float vPulse;
varying float vPulseGlow;
varying float vCool;
varying float vPattern;
varying float vSeed;
varying float vSpin;
varying vec3 vInk;
varying vec3 vGild;
varying vec3 vAccent;
${HASH_GLSL}
float noise11(float x) { float i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f); return mix(hash11(i), hash11(i + 1.0), f); }
// A line of half-width w at distance d, softened over about a pixel either side.
float band(float d, float w, float aa) { return 1.0 - smoothstep(w - aa, w + aa, d); }
vec2 turn(vec2 p, float a) { float c = cos(a), s = sin(a); return vec2(c * p.x - s * p.y, s * p.x + c * p.y); }
float segment(vec2 p, vec2 a, vec2 b) { vec2 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0); return length(pa - ba * h); }
// How far round the pen has come, from angle 0 (frac is the angle as a share of a turn).
float inscribed(float frac, float draw) { return 1.0 - smoothstep(draw * 1.05 - 0.03, draw * 1.05, frac); }

// Each pattern gives how much of each colour is lit here (ink, gild, accent) and how much of the ground it darkens.

// Aethelgard: a gold ring and a fainter one inside it with sixteen ivory pearls between them, a cross of four swords
// through it and four short rays between them, and a breath of witchfire within.
vec4 heraldic(vec2 p, float r, float aa) {
  vec2 q = turn(p, vSpin);
  float a = atan(q.y, q.x);
  float frac = fract(a / TAU + 1.0);
  float pen = inscribed(frac, vDraw);
  float rings = band(abs(r - 1.0), 0.028, aa) + 0.8 * band(abs(r - 0.86), 0.014, aa);
  float k = floor(frac * 16.0);
  float pa = (k + 0.5) / 16.0 * TAU;
  float pearl = band(length(q - 0.93 * vec2(cos(pa), sin(pa))), 0.022, aa);
  float s = abs(mod(a + PI / 4.0, PI / 2.0) - PI / 4.0);
  float sword = band(s * r, mix(0.032, 0.003, clamp((r - 0.2) / 1.05, 0.0, 1.0)), aa) * step(0.2, r) * (1.0 - smoothstep(1.2, 1.26, r));
  float s2 = abs(mod(a, PI / 2.0) - PI / 4.0);
  float ray = band(s2 * r, mix(0.02, 0.002, clamp((r - 0.45) / 0.42, 0.0, 1.0)), aa) * step(0.45, r) * (1.0 - smoothstep(0.84, 0.88, r));
  float fire = (1.0 - smoothstep(0.0, 0.86, r)) * 0.22 * (0.8 + 0.2 * sin(uTime * 7.0 + r * 12.0));
  return vec4((rings + sword) * pen, fire * vDraw, (pearl + ray) * pen, 0.0);
}

// Solforiz: twelve cracks seared out from the feet as the figure forms, a jagged ring of heat round them, and the
// ground scorched dark beneath.
vec4 seared(vec2 p, float r, float aa) {
  float a = atan(p.y, p.x);
  float cell = a / TAU * 12.0;
  float ray = floor(cell + 0.5);
  float wander = (noise11(r * 7.0 + ray * 3.1 + vSeed * 17.0) - 0.5) * 0.16;
  float d = abs(cell - ray + wander) * TAU / 12.0 * r;
  float reach = mix(0.22, 1.2, vDraw);
  float crack = band(d, 0.012 + 0.012 * (1.0 - r), aa) * smoothstep(0.18, 0.24, r) * (1.0 - smoothstep(reach - 0.08, reach, r));
  float rr = 0.95 + (noise11(a * 5.0 + vSeed * 9.0) - 0.5) * 0.09;
  float heat = (band(abs(r - rr), 0.03, aa) + 0.25 * band(abs(r - rr), 0.09, aa)) * vDraw;
  float core = exp(-r * r * 16.0) * 0.5 * vDraw;
  float scorch = (1.0 - smoothstep(0.65, 1.2, r)) * vDraw;
  return vec4(crack + heat, 0.0, core, scorch);
}

// Korvenia: a violet circle, a band of glyphs turning against it, a silver star of eight points drawn eight-in-three,
// and under the star a rose window, its panes violet and antique gold.
const vec2 STAR[8] = vec2[8](vec2(1.0, 0.0), vec2(0.7071, 0.7071), vec2(0.0, 1.0), vec2(-0.7071, 0.7071),
                             vec2(-1.0, 0.0), vec2(-0.7071, -0.7071), vec2(0.0, -1.0), vec2(0.7071, -0.7071));
vec4 academy(vec2 p, float r, float aa) {
  vec2 q = turn(p, vSpin);
  float a = atan(q.y, q.x);
  float frac = fract(a / TAU + 1.0);
  float pen = inscribed(frac, vDraw);
  float rings = band(abs(r - 1.0), 0.014, aa) + band(abs(r - 0.92), 0.007, aa) + 0.8 * band(abs(r - 0.72), 0.007, aa);
  // The glyphs and the star are each worked out only within their own rings.
  float glyph = 0.0;
  if (abs(r - 0.82) < 0.09) {
    vec2 g = turn(p, -vSpin * 1.7);
    float cells = 28.0;
    float gc = fract(atan(g.y, g.x) / TAU + 1.0) * cells;
    float ci = floor(gc);
    vec2 c = vec2((fract(gc) - 0.5) * TAU * 0.82 / cells, r - 0.82);
    float hA = hash11(ci * 1.37 + vSeed * 31.0), hB = hash11(ci * 2.71 + vSeed * 17.0), hC = hash11(ci * 0.53 + vSeed * 7.0);
    float w = 0.0075;
    glyph = band(segment(c, vec2(-0.03, -0.045), vec2(-0.03, 0.045)), w, aa) * step(0.35, hA);
    glyph = max(glyph, band(segment(c, vec2(-0.03, 0.045), vec2(0.035, -0.045)), w, aa) * step(0.55, hB));
    glyph = max(glyph, band(segment(c, vec2(-0.035, 0.0), vec2(0.035, 0.0)), w, aa) * step(0.6, hC) * step(hA, 0.8));
    glyph = max(glyph, band(abs(length(c - vec2(0.02, 0.025)) - 0.016), w * 0.8, aa) * step(0.75, hA * hB + 0.4));
    glyph *= step(ci / cells, vDraw) * step(abs(c.y), 0.07);
  }
  float star = 0.0;
  if (r < 0.76) {
    for (int i = 0; i < 8; i++) {
      int j = i + 3;
      if (j >= 8) j -= 8;
      star = max(star, band(segment(q, 0.72 * STAR[i], 0.72 * STAR[j]), 0.006, aa));
    }
  }
  float sector = floor(fract(a / TAU + 1.0 / 16.0) * 8.0);
  float pane = (1.0 - smoothstep(0.62, 0.7, r)) * smoothstep(0.18, 0.26, r) * 0.18 * vDraw;
  float gold = mod(sector, 2.0);
  return vec4(rings * pen + pane * (1.0 - gold), star * vDraw + glyph, pane * gold, 0.0);
}

// Kwind-09: a dial of thirty-two sodium lamps that steps round rather than turning and lights in turn as it draws in,
// a cyan reticle inside it with four ticks, four brass brackets, and a faint tread plate in the middle.
vec4 dial(vec2 p, float r, float aa) {
  float a = atan(p.y, p.x);
  float tick = floor(uTime * 7.0) * TAU / 64.0;
  float frac = fract((a + tick) / TAU + 1.0);
  float seg = frac * 32.0;
  float lit = step(floor(seg) / 32.0, vDraw * 1.001 - 0.001);
  float dash = band(abs(fract(seg) - 0.5), 0.3, aa * 32.0 / (TAU * max(r, 0.1))) * band(abs(r - 0.99), 0.035, aa);
  float reticle = band(abs(r - 0.8), 0.009, aa);
  float s = abs(mod(a + PI / 4.0, PI / 2.0) - PI / 4.0);
  float ticks = band(s * r, 0.008, aa) * step(0.52, r) * step(r, 0.76);
  float s2 = abs(mod(a, PI / 2.0) - PI / 4.0);
  float bracket = band(abs(r - 0.68), 0.01, aa) * step(s2, 0.24) + band(abs(s2 - 0.24) * r, 0.01, aa) * step(0.6, r) * step(r, 0.68);
  float plate = band(abs(fract((p.x + p.y) * 5.0) - 0.5), 0.06, aa * 5.0) * band(abs(fract((p.x - p.y) * 5.0) - 0.5), 0.3, aa * 5.0);
  plate *= (1.0 - smoothstep(0.5, 0.6, r)) * 0.25;
  return vec4(dash * lit, (reticle + ticks) * vDraw, (bracket + plate) * vDraw, 0.0);
}

void main() {
  float r = length(vP);
  // Past the pattern (and past the pulse while it runs) there is nothing to draw: stop before any of the work.
  if (r > (vPulseGlow > 0.002 ? EXTENT : REACH)) discard;
  float aa = fwidth(r) * 1.2 + 1e-4;
  vec4 m;
  vec3 ink = vInk;
  if (vPattern < 0.5) m = heraldic(vP, r, aa);
  else if (vPattern < 1.5) {
    m = seared(vP, r, aa);
    // The seared ground cools from white heat, through the furnace's orange, to dull copper.
    ink = mix(mix(vAccent, vInk, smoothstep(0.0, 0.35, vCool)), vGild, smoothstep(0.35, 1.0, vCool));
  }
  else if (vPattern < 2.5) m = academy(vP, r, aa);
  else m = dial(vP, r, aa);
  vec3 col = (ink * m.x + vGild * m.y + vAccent * m.z) * vGlow;
  // The pulse that runs out over the board as the figure stands.
  float pulse = band(abs(r - vPulse), 0.05, aa) + 0.3 * band(abs(r - vPulse), 0.16, aa);
  col += mix(vInk, vAccent, 0.5) * pulse * vPulseGlow;
  gl_FragColor = vec4(col, m.w * 0.45 * min(vGlow, 1.0));
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

/** A small fixed-seed generator, so a slot's particles come out the same every opening. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const between = (range: [number, number], t: number) => range[0] + (range[1] - range[0]) * t;

/** What the effects know of one figure. */
interface Slot {
  side: Faction;
  reveal: number;
  /** Reveal per second, from the last two changes. */
  rate: number;
  /** When it last changed, on the opening's clock. */
  seenAt: number;
  kindledAt: number;
  stoodAt: number;
}

/** One figure's progress, as the effects saw it (for the tests and for debugging). */
export interface MusterFigureState {
  slot: number;
  side: Faction;
  reveal: number;
  kindledAt: number | null;
  stoodAt: number | null;
}

export class MusterEffects {
  readonly group = new THREE.Group();
  /** Off, an opening plays without them (for comparing frame times, say). */
  enabled = true;

  private styles: Record<Faction, MusterStyle> | null = null;
  private readonly slots: Slot[] = Array.from({ length: MUSTER_SLOTS }, () => ({ side: "w" as Faction, reveal: 0, rate: 0, seenAt: 0, kindledAt: Infinity, stoodAt: Infinity }));
  private used = 0;
  private readonly bySquare = new Map<string, number>();
  private readonly slotA = new Float32Array(MUSTER_SLOTS * 4);
  private readonly slotB = new Float32Array(MUSTER_SLOTS * 4);
  private readonly shared = { uTime: { value: 0 }, uSlotA: { value: this.slotA }, uSlotB: { value: this.slotB } };
  private readonly particleUniforms = { ...this.shared, uScale: { value: 800 }, uWind: { value: WIND.clone() } };
  private readonly particles: THREE.Points;
  private readonly sigils: THREE.Mesh;
  private readonly attributes: THREE.BufferAttribute[] = [];
  private readonly seeds: Float32Array;
  private readonly aSlot: Float32Array;
  private readonly aTime: Float32Array;
  private readonly aBand: Float32Array;
  private readonly aMove: Float32Array;
  private readonly aLook: Float32Array;
  private readonly aColor: Float32Array;
  private readonly aSigil: Float32Array;
  private readonly aInk: Float32Array;
  private readonly aGild: Float32Array;
  private readonly aAccent: Float32Array;
  private dirty = false;
  private readonly viewport = new THREE.Vector4();
  private readonly scratch = new THREE.Color();

  constructor() {
    this.group.name = "muster-effects";
    this.group.visible = false;
    this.resetSlotState();

    const capacity = MUSTER_SLOTS * SLOT_PARTICLES;
    const geometry = new THREE.BufferGeometry();
    const attribute = (name: string, size: number, buffer: Float32Array): Float32Array => {
      const entry = new THREE.BufferAttribute(buffer, size);
      geometry.setAttribute(name, entry);
      this.attributes.push(entry);
      return buffer;
    };
    this.seeds = attribute("position", 3, new Float32Array(capacity * 3));
    this.aSlot = attribute("aSlot", 4, new Float32Array(capacity * 4));
    this.aTime = attribute("aTime", 2, new Float32Array(capacity * 2));
    this.aBand = attribute("aBand", 2, new Float32Array(capacity * 2));
    this.aMove = attribute("aMove", 4, new Float32Array(capacity * 4));
    this.aLook = attribute("aLook", 4, new Float32Array(capacity * 4));
    this.aColor = attribute("aColor", 3, new Float32Array(capacity * 3));
    for (let index = 0; index < capacity; index += 1) this.aSlot[index * 4 + 1] = -1;
    this.particles = new THREE.Points(geometry, new THREE.ShaderMaterial({
      name: "muster-particles",
      uniforms: this.particleUniforms,
      vertexShader: PARTICLE_VERTEX,
      fragmentShader: PARTICLE_FRAGMENT,
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
      premultipliedAlpha: true,
    }));
    this.particles.name = "muster-particles";
    // The paths are worked out in the shader, so the points' bounds say nothing about where they are.
    this.particles.frustumCulled = false;
    this.particles.renderOrder = 5;
    // A mote's size on screen needs the height in pixels of whatever is being drawn into (the battlefield look draws
    // into its own target, at a scale that follows the frame rate).
    this.particles.onBeforeRender = (renderer, _scene, camera) => {
      renderer.getCurrentViewport(this.viewport);
      this.particleUniforms.uScale.value = this.viewport.w * 0.5 * (camera as THREE.PerspectiveCamera).projectionMatrix.elements[5];
    };

    const plane = new THREE.PlaneGeometry(SIGIL_EXTENT * 2, SIGIL_EXTENT * 2);
    plane.rotateX(-Math.PI / 2);
    const quads = new THREE.InstancedBufferGeometry();
    quads.setIndex(plane.getIndex());
    quads.setAttribute("position", plane.getAttribute("position"));
    const instanced = (name: string, size: number): Float32Array => {
      const buffer = new Float32Array(MUSTER_SLOTS * size);
      const entry = new THREE.InstancedBufferAttribute(buffer, size);
      quads.setAttribute(name, entry);
      this.attributes.push(entry);
      return buffer;
    };
    this.aSigil = instanced("aSigil", 4);
    this.aInk = instanced("aInk", 3);
    this.aGild = instanced("aGild", 3);
    this.aAccent = instanced("aAccent", 3);
    for (let slot = 0; slot < MUSTER_SLOTS; slot += 1) this.aSigil[slot * 4] = slot;
    quads.instanceCount = MUSTER_SLOTS;
    this.sigils = new THREE.Mesh(quads, new THREE.ShaderMaterial({
      name: "muster-sigils",
      uniforms: { ...this.shared, uRadius: { value: SIGIL_RADIUS }, uLift: { value: SIGIL_LIFT } },
      vertexShader: SIGIL_VERTEX,
      fragmentShader: SIGIL_FRAGMENT,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.NormalBlending,
      premultipliedAlpha: true,
    }));
    this.sigils.name = "muster-sigils";
    this.sigils.frustumCulled = false;
    // Over the side's ring under each figure (3), under the particles.
    this.sigils.renderOrder = 4;
    this.group.add(this.sigils, this.particles);
  }

  /** True from {@link begin} until {@link clear}. */
  get active(): boolean {
    return this.styles !== null;
  }

  /**
   * Readies an opening that musters `armies`. Nothing shows until a figure starts to form, but both draws are made
   * from the first frame: the match holds that frame under its loading screen, so the shaders are built unseen.
   */
  begin(armies: Record<Faction, ArmySkinId>): void {
    this.clear();
    if (!this.enabled) return;
    this.styles = { w: MUSTER_STYLES[armies.w], b: MUSTER_STYLES[armies.b] };
    this.group.visible = true;
  }

  /**
   * One figure's progress, as the opening sets it (call it whenever that changes): its square, side, place, height
   * and how whole it is (0 to 1), on the opening's clock in seconds. Returns its kingdom's style, whose ember the
   * figure's burning edge should take, or null when no opening is being followed. `lift` raises its motes off the
   * stone (a promoted figure forms in the air, sceneEngine's promotion); its sigil stays on the tile.
   */
  track(square: string, side: Faction, x: number, z: number, height: number, reveal: number, time: number, lift = 0): MusterStyle | null {
    const styles = this.styles;
    if (!styles) return null;
    let index = this.bySquare.get(square);
    if (index === undefined) {
      if (this.used >= MUSTER_SLOTS) return styles[side];
      index = this.used;
      this.used += 1;
      this.bySquare.set(square, index);
      const slot = this.slots[index]!;
      slot.side = side; slot.reveal = 0; slot.rate = 0; slot.seenAt = time; slot.kindledAt = Infinity; slot.stoodAt = Infinity;
      this.writeSlot(index, styles[side]);
    }
    const slot = this.slots[index]!;
    // A figure of the other side on the same square (the board rebuilt meanwhile) takes its own kingdom's particles.
    if (slot.side !== side) {
      slot.side = side;
      this.writeSlot(index, styles[side]);
    }
    const value = clamp01(reveal);
    if (value <= 0) {
      slot.kindledAt = Infinity; slot.stoodAt = Infinity; slot.rate = 0;
    } else {
      if (slot.kindledAt === Infinity) {
        slot.kindledAt = time; slot.rate = 0;
      } else if (time > slot.seenAt) {
        const rate = (value - slot.reveal) / (time - slot.seenAt);
        slot.rate = slot.rate === 0 ? rate : slot.rate * 0.5 + rate * 0.5;
      }
      // The opening reports a figure only when it changes, so one at 1 here has just come up from below it.
      if (value >= 1 && slot.stoodAt === Infinity) slot.stoodAt = time;
    }
    slot.reveal = value;
    slot.seenAt = time;
    const a = index * 4;
    this.slotA[a] = x; this.slotA[a + 1] = z; this.slotA[a + 2] = height; this.slotA[a + 3] = lift;
    this.slotB[a] = value; this.slotB[a + 1] = Math.max(0, slot.rate);
    this.slotB[a + 2] = Number.isFinite(slot.kindledAt) ? slot.kindledAt : NEVER;
    this.slotB[a + 3] = Number.isFinite(slot.stoodAt) ? slot.stoodAt : NEVER;
    return styles[side];
  }

  /** Draws the motes or leaves them out, the sigils staying (the low preset's promotion keeps only its sigil). */
  showParticles(visible: boolean): void {
    this.particles.visible = visible;
  }

  /** Moves the effects to the opening's clock, in seconds. */
  update(time: number): void {
    if (!this.styles) return;
    this.shared.uTime.value = time;
    if (this.dirty) {
      for (const attribute of this.attributes) attribute.needsUpdate = true;
      this.dirty = false;
    }
  }

  /** Ends at once: nothing drawn, no figure followed. */
  clear(): void {
    this.styles = null;
    this.group.visible = false;
    this.bySquare.clear();
    this.used = 0;
    this.resetSlotState();
  }

  /** What the effects know of the figure on `square`, or null. */
  stateOf(square: string): MusterFigureState | null {
    const index = this.bySquare.get(square);
    if (index === undefined) return null;
    const slot = this.slots[index]!;
    return {
      slot: index, side: slot.side, reveal: slot.reveal,
      kindledAt: Number.isFinite(slot.kindledAt) ? slot.kindledAt : null,
      stoodAt: Number.isFinite(slot.stoodAt) ? slot.stoodAt : null,
    };
  }

  dispose(): void {
    this.clear();
    this.particles.geometry.dispose();
    (this.particles.material as THREE.Material).dispose();
    this.sigils.geometry.dispose();
    (this.sigils.material as THREE.Material).dispose();
    this.group.removeFromParent();
    this.group.clear();
  }

  private resetSlotState(): void {
    this.slotA.fill(0);
    this.slotB.fill(0);
    for (let slot = 0; slot < MUSTER_SLOTS; slot += 1) {
      this.slotB[slot * 4 + 2] = NEVER;
      this.slotB[slot * 4 + 3] = NEVER;
    }
  }

  /** Writes one figure's particles and sigil for its kingdom; they are sent to the graphics card on the next update. */
  private writeSlot(slot: number, style: MusterStyle): void {
    const random = mulberry32(0x5bd1e995 ^ Math.imul(slot + 1, 0x9e3779b1));
    const end = (slot + 1) * SLOT_PARTICLES;
    let index = slot * SLOT_PARTICLES;
    for (const emitter of style.emitters) {
      const arc = emitter.motion === "arc";
      const group = arc ? Math.max(2, emitter.perArc ?? 12) : 1;
      for (let made = 0; made < emitter.count && index < end; made += group) {
        // One bolt's joints share everything but their number along it.
        const seed = random(), offset = random(), life = between(emitter.life, random());
        const delay = emitter.delay ? between(emitter.delay, random()) : 0;
        const size = between(emitter.size, random());
        for (let j = 0; j < group && made + j < emitter.count && index < end; j += 1, index += 1) {
          this.seeds.set([seed, arc ? j : emitter.radius, arc ? group - 1 : 0], index * 3);
          this.aSlot.set([slot, MOTION_ID[emitter.motion], SHAPE_ID[emitter.shape], emitter.when === "standing" ? 1 : 0], index * 4);
          this.aTime[index * 2] = emitter.when === "standing" ? delay : offset;
          this.aTime[index * 2 + 1] = life;
          this.aBand[index * 2] = emitter.height[0];
          this.aBand[index * 2 + 1] = emitter.climb ? -Math.max(1e-3, emitter.height[1]) : emitter.height[1];
          const move = arc
            ? [emitter.radius, emitter.span ?? 1, emitter.rise ?? 0.3, emitter.crackle ?? 25]
            : [emitter.speed ?? 0, emitter.motion === "spiral" ? emitter.spin ?? 0 : emitter.motion === "burst" ? emitter.lift ?? 0 : emitter.spread ?? 0, emitter.wind ?? 0, emitter.gravity ?? 0];
          this.aMove.set(move, index * 4);
          this.aLook.set([size, emitter.stretch ?? 1, emitter.twinkle ?? 0, emitter.matte ?? 0], index * 4);
          this.scratch.setHex(emitter.color).multiplyScalar(emitter.gain);
          this.aColor.set([this.scratch.r, this.scratch.g, this.scratch.b], index * 3);
        }
      }
    }
    for (; index < end; index += 1) this.aSlot[index * 4 + 1] = -1;

    const sigil = style.sigil;
    this.aSigil.set([slot, PATTERN_ID[sigil.pattern], sigil.spin * (random() < 0.5 ? -1 : 1), random()], slot * 4);
    const colour = (buffer: Float32Array, hex: number, gain: number) => {
      this.scratch.setHex(hex).multiplyScalar(gain);
      buffer.set([this.scratch.r, this.scratch.g, this.scratch.b], slot * 3);
    };
    colour(this.aInk, sigil.ink, sigil.inkGain);
    colour(this.aGild, sigil.gild, sigil.gildGain);
    colour(this.aAccent, sigil.accent, sigil.accentGain);
    this.dirty = true;
  }
}
