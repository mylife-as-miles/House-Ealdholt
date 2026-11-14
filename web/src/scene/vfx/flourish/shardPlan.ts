/**
 * What a kill throws into the air, as arithmetic: glinting flakes in the killer's colours and dark chips of stone,
 * thrown hard, held by the air, drifting on a turbulent wind and fading. No Three.js in here, so the node tests reach it
 * (shared/play/flourish-shards.test.ts); sparks.ts and chips.ts draw what this plans, and their vertex shaders evaluate
 * the same flight and the same wind.
 *
 * The flight is the spells' (spells/shared/particlePlan.ts flightPoint): the exact path under linear drag and a
 * constant pull, so nothing is integrated on the CPU and nothing depends on the frame rate. The wind is the curl of a
 * slowly turning vector field ({@link curl}): divergence-free, so what it carries swirls and eddies but never bunches
 * up or thins out, which is what makes drifting debris read as air rather than as noise.
 */
import { between, scatter, type Dice } from "../spells/shared/particlePlan";

/** How a spark of the shared pool is drawn (sparks.ts). */
export const SPARK_KIND = Object.freeze({
  /** A soft round light with a hot heart. */
  mote: 0,
  /** The same drawn out along its own motion on the screen: a spark, a streak of a starburst. */
  streak: 1,
  /** A flat flake tumbling in three dimensions, flashing white as its face turns to catch the light. */
  flake: 2,
  /** A dark chip of stone: not a spark at all, it is drawn lit and solid by chips.ts. */
  chip: 3,
  /** A blade of fire: a hard-edged, faceted kite of flame thrown out of a fire spell's blow. */
  blade: 4,
});

/** One spark, flake or chip as it is written into a pool: reused, never allocated per spawn. */
export interface ShardSpec {
  kind: number;
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  /** Seconds from now until it appears (0 for at once), and how long it lives. */
  delay: number;
  life: number;
  /** The air's hold on it, per second, and its fall (negative rises). */
  drag: number;
  gravity: number;
  /** Its half-size in scene units. */
  size: number;
  /** How far the turbulent wind carries it, as a factor of the wind's speed. */
  wander: number;
  /**
   * Radians a second it turns (flakes and chips); for a streak, the shutter it is drawn out over (seconds); for a blade of
   * fire, how many times its width it reaches at its longest. And its own dice.
   */
  spin: number;
  seed: number;
  /** Its colour (sRGB hex), how hot it starts (0..1: hot ones begin near white and cool), and a second colour (a chip's lit edge). */
  colour: number;
  heat: number;
  edge: number;
}

export function blankShard(): ShardSpec {
  return { kind: 0, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, delay: 0, life: 1, drag: 0, gravity: 0, size: 0.02, wander: 0, spin: 0, seed: 0, colour: 0xffffff, heat: 0, edge: 0xffffff };
}

/**
 * The wind: the curl of the vector potential psi = (sin(a y + t) cos(b z), sin(a z + 1.3 t) cos(b x), sin(a x + 0.7 t)
 * cos(b y)), taken analytically. Written into `out`. The GLSL in sparks.ts and chips.ts is this expression.
 */
export function curl(x: number, y: number, z: number, t: number, out = { x: 0, y: 0, z: 0 }): { x: number; y: number; z: number } {
  const a = 1.7, b = 1.3;
  // psi.x = sin(a y + t) cos(b z); psi.y = sin(a z + 1.3 t) cos(b x); psi.z = sin(a x + 0.7 t) cos(b y)
  const dzy = -b * Math.sin(a * x + 0.7 * t) * Math.sin(b * y); // d psi.z / dy
  const dyz = a * Math.cos(a * z + 1.3 * t) * Math.cos(b * x); // d psi.y / dz
  const dxz = -b * Math.sin(a * y + t) * Math.sin(b * z); // d psi.x / dz
  const dzx = a * Math.cos(a * x + 0.7 * t) * Math.cos(b * y); // d psi.z / dx
  const dyx = -b * Math.sin(a * z + 1.3 * t) * Math.sin(b * x); // d psi.y / dx
  const dxy = a * Math.cos(a * y + t) * Math.cos(b * z); // d psi.x / dy
  out.x = dzy - dyz; out.y = dxz - dzx; out.z = dyx - dxy;
  return out;
}

/** The wind's GLSL, the same field as {@link curl}. */
export const CURL_GLSL = /* glsl */ `
vec3 flourishCurl(vec3 p, float t) {
  const float a = 1.7, b = 1.3;
  float dzy = -b * sin(a * p.x + 0.7 * t) * sin(b * p.y);
  float dyz = a * cos(a * p.z + 1.3 * t) * cos(b * p.x);
  float dxz = -b * sin(a * p.y + t) * sin(b * p.z);
  float dzx = a * cos(a * p.x + 0.7 * t) * cos(b * p.y);
  float dyx = -b * sin(a * p.z + 1.3 * t) * sin(b * p.x);
  float dxy = a * cos(a * p.y + t) * cos(b * p.z);
  return vec3(dzy - dyz, dxz - dzx, dyx - dxy);
}
`;

/** Where a kill's flakes and chips come from, and how it was dealt. */
export interface ShatterInput {
  /** Where the blow went in (a wound, a spell's impact), and the stone under the victim. */
  at: { x: number; y: number; z: number };
  floor: { x: number; y: number; z: number };
  /** The way the blow travels (need not be unit; level is fine): the flakes are thrown on along it. */
  direction: { x: number; y: number; z: number };
  /**
   * Away from the eye, along the floor (need not be unit): flakes and chips are thrown that way and round the sides, so
   * none crosses in front of the body. Omitted: no bias.
   */
  away?: { x: number; z: number };
  /** How hard: about 1 for a Pawn's thrust or a Bishop's spell, up to 1.75 for a Queen. */
  power: number;
  flakes: number;
  chips: number;
  look: { flake: number; flakeAccent: number; chip: number; chipEdge: number };
}

/** The limits of a shatter. */
export const SHATTER = Object.freeze({
  /** The flakes' and chips' longest life: everything a kill throws is gone well before the Claiming's beat. */
  longest: 2.1,
  /** A quarter of the flakes are the second colour. */
  accent: 0.25,
});

/**
 * Plans one kill's flakes and chips with `dice`, handing each to `emit` in the one record `spec` (nothing is allocated
 * per shard). Flakes burst from the wound and are thrown on along the blow, held almost at once by the air, and drift;
 * chips are torn up from the stone round the feet, climb, hang and fall back, a little hot at first.
 */
export function planShatter(input: ShatterInput, dice: Dice, emit: (spec: ShardSpec) => void, spec: ShardSpec = blankShard()): number {
  const power = Math.max(0.5, Math.min(1.9, input.power));
  const dl = Math.hypot(input.direction.x, input.direction.z) || 1;
  const dx = input.direction.x / dl, dz = input.direction.z / dl;
  const al = input.away ? Math.hypot(input.away.x, input.away.z) : 0;
  const ax = al > 1e-6 ? input.away!.x / al : 0, az = al > 1e-6 ? input.away!.z / al : 0;
  let made = 0;
  const flakes = Math.round(input.flakes * (0.75 + 0.25 * power));
  for (let i = 0; i < flakes; i += 1) {
    const way = scatter(dice, -0.2, 0.95);
    // a flake thrown toward the eye is turned back: it goes round the side of the body or behind it
    let wx = way.x, wz = way.z;
    const toward = -(wx * ax + wz * az);
    if (toward > 0) { wx += ax * toward * 1.6; wz += az * toward * 1.6; }
    // thrown on along the blow, scattered round it
    const speed = between(dice, 0.9, 2.4) * (0.85 + 0.15 * power);
    spec.kind = SPARK_KIND.flake;
    spec.x = input.at.x + ax * 0.05 + between(dice, -0.04, 0.04); spec.y = input.at.y + between(dice, -0.05, 0.05); spec.z = input.at.z + az * 0.05 + between(dice, -0.04, 0.04);
    spec.vx = (wx * 0.75 + dx * 0.55 + ax * 0.35) * speed; spec.vy = (way.y * 0.8 + 0.35) * speed; spec.vz = (wz * 0.75 + dz * 0.55 + az * 0.35) * speed;
    spec.delay = between(dice, 0, 0.04);
    spec.life = between(dice, 1.1, 1.9);
    spec.drag = between(dice, 2.6, 4.2);
    spec.gravity = between(dice, 0.3, 0.75);
    spec.size = between(dice, 0.012, 0.024) * (0.9 + 0.1 * power);
    spec.wander = between(dice, 0.3, 0.6);
    spec.spin = between(dice, 4, 12) * (dice() < 0.5 ? -1 : 1);
    spec.seed = dice();
    spec.colour = dice() < SHATTER.accent ? input.look.flakeAccent : input.look.flake;
    spec.heat = between(dice, 0.55, 1);
    spec.edge = 0xffffff;
    emit(spec); made += 1;
  }
  const chips = Math.round(input.chips * (0.7 + 0.3 * power));
  for (let i = 0; i < chips; i += 1) {
    const turn = dice() * Math.PI * 2, out = between(dice, 0.08, 0.26);
    let ox = Math.cos(turn), oz = Math.sin(turn);
    // none is thrown toward the eye, across the body's legs
    const toward = -(ox * ax + oz * az);
    if (toward > 0) { ox += ax * toward * 2; oz += az * toward * 2; const l = Math.hypot(ox, oz) || 1; ox /= l; oz /= l; }
    const climb = between(dice, 0.9, 1.9) * (0.85 + 0.15 * power), spread = between(dice, 0.4, 1.1);
    spec.kind = SPARK_KIND.chip;
    spec.x = input.floor.x + ox * out; spec.y = input.floor.y + 0.03; spec.z = input.floor.z + oz * out;
    spec.vx = ox * spread + dx * 0.4; spec.vy = climb; spec.vz = oz * spread + dz * 0.4;
    spec.delay = between(dice, 0, 0.05);
    spec.life = between(dice, 0.95, 1.55);
    spec.drag = between(dice, 2.2, 3.2);
    spec.gravity = between(dice, 2.6, 3.6);
    spec.size = between(dice, 0.012, 0.03) * (0.9 + 0.1 * power);
    spec.wander = between(dice, 0.08, 0.2);
    spec.spin = between(dice, 3, 9) * (dice() < 0.5 ? -1 : 1);
    spec.seed = dice();
    spec.colour = input.look.chip;
    spec.heat = between(dice, 0.4, 1);
    spec.edge = input.look.chipEdge;
    emit(spec); made += 1;
  }
  return made;
}

/** How bright a flake or chip is `u` of the way through its life: up at once, held, then gone smoothly (no pop). */
export function shardFade(u: number): number {
  if (u <= 0 || u >= 1) return 0;
  const appear = Math.min(1, u / 0.06), leave = 1 - Math.max(0, (u - 0.6) / 0.4);
  return appear * appear * (3 - 2 * appear) * leave * leave * (3 - 2 * leave);
}

/**
 * A fire spell's blow, as crystalline fire: blades of flame thrown out round the struck body, faceted and hard-edged,
 * that shoot out to their length and are drawn back in within half a second. They are thrown from behind the body
 * (`at` is already behind it, away from the eye) and away from the eye, round and up, so they frame the kill and never
 * cross in front of it. In the kingdom's fire and its gold.
 */
export function planFlare(at: { x: number; y: number; z: number }, away: { x: number; z: number }, count: number, power: number, look: { edge: number; flake: number },
  dice: Dice, emit: (spec: ShardSpec) => void, spec: ShardSpec = blankShard()): number {
  const al = Math.hypot(away.x, away.z) || 1, ax = away.x / al, az = away.z / al;
  const n = Math.round(count * (0.8 + 0.2 * Math.max(0.5, Math.min(1.9, power))));
  for (let i = 0; i < n; i += 1) {
    // round the compass in the plane facing the eye, and up; never back toward the eye
    const turn = ((i + between(dice, -0.3, 0.3)) / Math.max(1, n)) * Math.PI * 2;
    const side = Math.cos(turn), rise = Math.sin(turn) * 0.8 + 0.35, back = between(dice, 0.15, 0.6);
    let vx = -az * side + ax * back, vy = rise, vz = ax * side + az * back;
    const l = Math.hypot(vx, vy, vz) || 1; vx /= l; vy /= l; vz /= l;
    const speed = between(dice, 2.2, 4.2);
    spec.kind = SPARK_KIND.blade;
    spec.x = at.x; spec.y = at.y; spec.z = at.z;
    spec.vx = vx * speed; spec.vy = vy * speed; spec.vz = vz * speed;
    spec.delay = between(dice, 0, 0.05);
    spec.life = between(dice, 0.3, 0.5);
    spec.drag = between(dice, 4.5, 6.5);
    spec.gravity = -0.5;
    spec.size = between(dice, 0.024, 0.058);
    spec.wander = 0; spec.spin = between(dice, 2.8, 7.5); spec.seed = dice();
    spec.colour = dice() < 0.3 ? look.flake : look.edge;
    spec.heat = 1; spec.edge = look.edge;
    emit(spec);
  }
  return n;
}

/** A lunge's smears: how fast a body must move before it smears, and how the smears are drawn. */
export const SMEAR = Object.freeze({
  /** Scene units a second: a walk does not smear, a charge or a lunge into a blow does. */
  threshold: 1.7,
  /** Smears a second for each unit a second above the threshold. */
  rate: 26,
  /** The most smears one frame sheds. */
  most: 4,
  /** How far round the body's axis they start, and how far up and down it. */
  radius: 0.17,
  reach: 0.34,
});

/**
 * How many smears a body moving at `speed` sheds over `seconds`, carrying the fraction left over in `owed` (so a frame
 * rate does not change how many are shed). Returns the whole number to shed now and what is still owed, written into
 * `out` (the caller's own, so a frame allocates nothing).
 */
export function smearsDue(speed: number, seconds: number, owed: number, out: { now: number; owed: number } = { now: 0, owed: 0 }): { now: number; owed: number } {
  if (!(speed > SMEAR.threshold) || !(seconds > 0)) { out.now = 0; out.owed = 0; return out; }
  const total = owed + (speed - SMEAR.threshold) * SMEAR.rate * seconds;
  out.now = Math.min(SMEAR.most, Math.floor(total));
  out.owed = Math.min(1, total - out.now);
  return out;
}

/**
 * One smear off a body at `at` moving with velocity `v`: a long, faint stroke drawn out behind it, as a brush leaves on
 * very fast motion. It trails away from where the body is going, so it never crosses what the body is going for.
 */
export function planSmear(at: { x: number; y: number; z: number }, v: { x: number; y: number; z: number }, colour: number, dice: Dice, spec: ShardSpec): ShardSpec {
  const speed = Math.hypot(v.x, v.y, v.z) || 1, back = -0.38;
  const turn = dice() * Math.PI * 2, r = SMEAR.radius * Math.sqrt(dice()), h = between(dice, -SMEAR.reach, SMEAR.reach);
  spec.kind = SPARK_KIND.streak;
  spec.x = at.x + Math.cos(turn) * r; spec.y = at.y + h; spec.z = at.z + Math.sin(turn) * r;
  spec.vx = v.x * back + between(dice, -0.15, 0.15); spec.vy = v.y * back + between(dice, -0.08, 0.12); spec.vz = v.z * back + between(dice, -0.15, 0.15);
  spec.delay = 0; spec.life = between(dice, 0.14, 0.24); spec.drag = 2.5; spec.gravity = 0;
  spec.size = between(dice, 0.01, 0.018) * Math.min(1.6, speed / 2.5);
  spec.wander = 0; spec.spin = between(dice, 0.11, 0.17); spec.seed = dice();
  spec.colour = colour; spec.heat = between(dice, 0.15, 0.35); spec.edge = colour;
  return spec;
}
