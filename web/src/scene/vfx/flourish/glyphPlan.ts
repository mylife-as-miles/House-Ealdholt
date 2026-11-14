/**
 * A sigil stamped where a spell or a summon strikes, as arithmetic: its one clock (struck, flash, held, burnt away),
 * where it stands, the strokes laid out for the GPU, and the starburst thrown out of it. No Three.js in here, so the node
 * tests reach it (shared/play/flourish-glyph.test.ts); glyphs.ts draws it.
 *
 * It stands in the air behind the victim, upright, facing the eye, its heart level with the chest: the body, depth-tested
 * against it, stands whole in front of its light and the strokes are seen round it, as the Lance's star stands behind its
 * victim (docs/play/SPELL_LIBRARY.md, "it never hides its kill"). It is lifted so its lowest stroke clears the stone.
 */
import { between, type Dice } from "../spells/shared/particlePlan";
import { clamp01, smoothstep } from "./flourishPlan";
import { SPARK_KIND, type ShardSpec } from "./shardPlan";
import { strokePoints, type Sigil } from "./sigils";

/** The glyph's limits. Times in seconds, distances in scene units. */
export const GLYPH = Object.freeze({
  /** The pen strikes the whole mark in this long: a stamp, not a drawing. */
  draw: 0.12,
  /** The flash peaks this soon after the blow and falls away over `flashFade`. */
  flashPeak: 0.045,
  flashFade: 0.13,
  /** Held whole until `hold`, then burnt away over `burn`: about two thirds of a second in all. */
  hold: 0.3,
  burn: 0.32,
  /** How much it widens as it burns away. */
  grow: 0.14,
  /** Its radius for a power of 1 (a Bishop's spell), and how far behind the chest it stands, away from the eye. */
  radius: 0.6,
  behind: 0.34,
  /** Its lowest point stays this far over the stone. */
  clearance: 0.05,
});

/** What the glyph is doing `t` seconds after the blow. */
export interface GlyphEnvelope {
  /** How far the pen has run, 0..1. */
  pen: number;
  /** The white flash of the strike, 0..1. */
  flash: number;
  /** How brightly the strokes burn, 0..1 (with a faint shimmer while held). */
  glow: number;
  /** How far it has burnt away, 0..1. */
  burn: number;
  /** Its size, as a factor. */
  scale: number;
  done: boolean;
}

export function glyphEnvelope(t: number, out: GlyphEnvelope = { pen: 0, flash: 0, glow: 0, burn: 0, scale: 1, done: false }): GlyphEnvelope {
  if (!(t >= 0)) { out.pen = 0; out.flash = 0; out.glow = 0; out.burn = 0; out.scale = 1; out.done = false; return out; }
  const p = clamp01(t / GLYPH.draw);
  out.pen = 1 - (1 - p) * (1 - p) * (1 - p);
  out.flash = t < GLYPH.flashPeak ? smoothstep(0, GLYPH.flashPeak, t) : Math.exp(-(t - GLYPH.flashPeak) / GLYPH.flashFade);
  const burning = smoothstep(GLYPH.hold, GLYPH.hold + GLYPH.burn, t);
  out.burn = smoothstep(GLYPH.hold - 0.04, GLYPH.hold + GLYPH.burn, t);
  out.glow = smoothstep(0, 0.035, t) * (1 - burning) * (1 + 0.05 * Math.sin(t * 41));
  out.scale = 1 + GLYPH.grow * burning;
  out.done = t >= GLYPH.hold + GLYPH.burn;
  return out;
}

/** Where the glyph stands: behind the chest, away from the eye along the floor, and high enough to clear the stone. */
export function glyphCentre(chest: { x: number; y: number; z: number }, eye: { x: number; y: number; z: number }, radius: number, boardTop: number,
  out = { x: 0, y: 0, z: 0 }): { x: number; y: number; z: number } {
  let ax = chest.x - eye.x, az = chest.z - eye.z;
  const l = Math.hypot(ax, az) || 1; ax /= l; az /= l;
  out.x = chest.x + ax * GLYPH.behind; out.z = chest.z + az * GLYPH.behind;
  out.y = Math.max(chest.y, boardTop + radius * (1 + GLYPH.grow) + GLYPH.clearance);
  return out;
}

/** Floats per stroke in each of the packed attributes (glyphs.ts reads them as aA, aB, aC). */
export const GLYPH_STRIDE = 4;

/** A sigil's strokes laid out for one instanced draw. */
export interface PackedSigil {
  count: number;
  /** A line's two ends, or an arc's centre and radii. */
  a: Float32Array;
  /** kind (0 line, 1 arc), width at its start, width at its end, turn (an arc's) */
  b: Float32Array;
  /** an arc's angles (from, to), and the pen's run it is drawn in (from, to) */
  c: Float32Array;
  /**
   * a live stroke (1: it flickers, as a spark does), a seed of its own, and whether its start and its end are joined to
   * another straight stroke (1 each): a joined end is drawn at half its light, so two strokes meeting make one, not a bead
   */
  d: Float32Array;
}

/** Lays a sigil out for the GPU, once per kingdom. */
export function packSigil(sigil: Sigil): PackedSigil {
  const count = sigil.strokes.length;
  const out: PackedSigil = { count, a: new Float32Array(count * 4), b: new Float32Array(count * 4), c: new Float32Array(count * 4), d: new Float32Array(count * 4) };
  const ends: [number, number][] = [];
  for (const stroke of sigil.strokes) if (stroke.kind === "line") ends.push(stroke.a, stroke.b);
  const joined = (at: [number, number]) => ends.filter(([x, y]) => Math.hypot(x - at[0], y - at[1]) < 1e-3).length > 1;
  sigil.strokes.forEach((stroke, i) => {
    if (stroke.kind === "line") {
      out.a.set([stroke.a[0], stroke.a[1], stroke.b[0], stroke.b[1]], i * 4);
      out.b.set([0, stroke.width, stroke.width * (stroke.taper ?? 1), 0], i * 4);
      out.c.set([0, 0, stroke.order[0], stroke.order[1]], i * 4);
    } else {
      out.a.set([stroke.c[0], stroke.c[1], stroke.r[0], stroke.r[1]], i * 4);
      out.b.set([1, stroke.width, stroke.width, stroke.turn ?? 0], i * 4);
      out.c.set([stroke.from, stroke.to, stroke.order[0], stroke.order[1]], i * 4);
    }
    const joins = stroke.kind === "line" ? [joined(stroke.a) ? 1 : 0, joined(stroke.b) ? 1 : 0] : [0, 0];
    out.d.set([stroke.live ? 1 : 0, ((i * 0.6180339887) % 1), joins[0], joins[1]], i * 4);
  });
  return out;
}

/** How far a sigil's strokes reach from its heart, with their widths: everything lies within this of the centre. */
export function sigilReach(sigil: Sigil): number {
  let reach = 0;
  for (const stroke of sigil.strokes) for (const [x, y] of strokePoints(stroke, 24)) reach = Math.max(reach, Math.hypot(x, y) + stroke.width);
  return reach;
}

/** The plane the glyph stands in: its right and up, unit vectors in the scene. */
export interface GlyphPlane {
  centre: { x: number; y: number; z: number };
  right: { x: number; y: number; z: number };
  up: { x: number; y: number; z: number };
  /** Toward the eye. */
  out: { x: number; y: number; z: number };
}

/**
 * The starburst thrown out as the sigil strikes: long streaks fanned out in its plane, fast and held hard by the air, so
 * they shoot out and stop; and loose sparks that fall. In the kingdom's colours, hot. Each is handed to `emit` in the
 * one record `spec`.
 */
export function planStarburst(plane: GlyphPlane, radius: number, streaks: number, sparks: number, look: { core: number; edge: number; flake: number },
  dice: Dice, emit: (spec: ShardSpec) => void, spec: ShardSpec): number {
  let made = 0;
  for (let i = 0; i < streaks; i += 1) {
    const angle = ((i + between(dice, -0.35, 0.35)) / Math.max(1, streaks)) * Math.PI * 2;
    const c = Math.cos(angle), s = Math.sin(angle), toward = between(dice, -0.15, 0.35);
    const speed = between(dice, 5.5, 10.5) * Math.sqrt(radius / GLYPH.radius);
    const from = between(dice, 0.05, 0.25) * radius;
    spec.kind = SPARK_KIND.streak;
    spec.x = plane.centre.x + (plane.right.x * c + plane.up.x * s) * from; spec.y = plane.centre.y + (plane.right.y * c + plane.up.y * s) * from; spec.z = plane.centre.z + (plane.right.z * c + plane.up.z * s) * from;
    spec.vx = (plane.right.x * c + plane.up.x * s + plane.out.x * toward) * speed;
    spec.vy = (plane.right.y * c + plane.up.y * s + plane.out.y * toward) * speed;
    spec.vz = (plane.right.z * c + plane.up.z * s + plane.out.z * toward) * speed;
    spec.delay = between(dice, 0, 0.03);
    spec.life = between(dice, 0.26, 0.48);
    spec.drag = between(dice, 6.5, 9);
    spec.gravity = 0.4;
    spec.size = between(dice, 0.011, 0.019) * Math.sqrt(radius / GLYPH.radius);
    spec.wander = 0; spec.spin = 0.05; spec.seed = dice();
    spec.colour = dice() < 0.4 ? look.core : look.edge;
    spec.heat = 1; spec.edge = look.core;
    emit(spec); made += 1;
  }
  for (let i = 0; i < sparks; i += 1) {
    const angle = dice() * Math.PI * 2, c = Math.cos(angle), s = Math.sin(angle);
    const speed = between(dice, 1.4, 3.4);
    spec.kind = SPARK_KIND.mote;
    spec.x = plane.centre.x; spec.y = plane.centre.y; spec.z = plane.centre.z;
    spec.vx = (plane.right.x * c + plane.up.x * s) * speed + plane.out.x * between(dice, 0, 1.2);
    spec.vy = (plane.right.y * c + plane.up.y * s) * speed + 0.8;
    spec.vz = (plane.right.z * c + plane.up.z * s) * speed + plane.out.z * between(dice, 0, 1.2);
    spec.delay = between(dice, 0, 0.06);
    spec.life = between(dice, 0.5, 0.95);
    spec.drag = between(dice, 1.2, 2);
    spec.gravity = between(dice, 2.6, 4);
    spec.size = between(dice, 0.009, 0.016);
    spec.wander = 0.2; spec.spin = 0; spec.seed = dice();
    spec.colour = dice() < 0.5 ? look.flake : look.edge;
    spec.heat = 1; spec.edge = look.core;
    emit(spec); made += 1;
  }
  return made;
}
