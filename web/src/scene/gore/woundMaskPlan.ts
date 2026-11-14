// Adapted from zulubo/SkinGore (MIT). Copyright (c) 2020 zulubo. See public/licenses/SkinGore-MIT.txt.
/**
 * Wound masks (Milestone 03, "Wounded Warriors"), as numbers: what one wound paints into its figure's own damage
 * mask, and what a quality preset affords. No Three.js in here, so the node tests reach it
 * (shared/play/wound-mask.test.ts); gore/WoundMasks.ts paints what this plans and gore/woundMaskShader.ts is how a
 * figure's own materials show it.
 *
 * The technique is SkinGore's: every wound renders the figure's skinned mesh unwrapped into its UV space, each
 * texel lit by how near the skinned surface point it stands for lies to the wound (both in one space), the hit is
 * dilated across the UV seams and added into a small accumulation texture the figure keeps, and the figure's own
 * materials show blood and torn flesh where that texture says. Here every wound is a few strokes:
 *
 *   blob     a stab, a pierce, a bite: round (a bite a little long)
 *   capsule  a slash, a tear: along the cut
 *   broad    a crush, a burst: wide and ragged
 *
 * and, while the body bleeds, runs of blood painted down it along gravity as the body is then posed, so they bend
 * as it falls.
 *
 * The mask's channels (RGBA, 8 bits each, added into, saturating at 1), for whatever later reads or deepens them:
 *
 *   r  open    the wound itself: torn flesh where it is past about 0.35
 *   g  blood   blood on the surface: the soak round a wound, and the runs down from it
 *   b  deep    how deep the wound goes: the dark core where it is high (with the opening), and with opened
 *              interiors the layers inside it, the bone glimpsed at the bottom, and how far the surface sinks
 *   a  cover   1 wherever the bake reached a texel (the dilation's coverage); nothing reads it for the look
 *
 * Sizes are the gore tiers' (goreTiers.ts `goreBudget(tier, quality).mask`): 64 texels a side for an ordinary
 * fight on Low and Medium, up to 256 for a fatality. A figure keeps the largest tier it has been hit at. The rest
 * of what a preset affords is {@link WOUND_MASK_BUDGET}.
 *
 * Violence: nothing at Minimal. Cinematic is moderate: smaller strokes, less blood, a short run. Full is deep and
 * wet: larger strokes, more blood, longer runs and a second rivulet, and where the tier opens wounds (tier 2 at
 * Full, `goreShow(...).interiors`) the layers inside and the deepest part of the surface sunk in.
 */
import type { QualityPreset } from "../quality";
import { goreBudget, type GoreTier } from "./goreTiers";
import type { GoreIntensity, GoreWeapon } from "./GoreTypes";

/** What a blow, a spell or a summon opens. */
export type GoreWoundKind = "stab" | "pierce" | "bite" | "slash" | "tear" | "crush" | "burst";
export const GORE_WOUND_KINDS: readonly GoreWoundKind[] = ["stab", "pierce", "bite", "slash", "tear", "crush", "burst"];

/** How a stroke is shaped in the mask. */
export type WoundShape = "blob" | "capsule" | "broad";

/** The wound a weapon opens when its source says nothing more (a summon's bite, a spell's ice say more). */
export const WEAPON_WOUND: Readonly<Record<GoreWeapon, GoreWoundKind>> = {
  spear: "stab", lance: "stab", sword: "slash", axe: "slash", mace: "crush", staff: "crush", musket: "pierce", fist: "crush",
};

/** The mask's channels, for anything that reads or deepens them later. */
export const WOUND_MASK_CHANNELS = { r: "open", g: "blood", b: "deep", a: "cover" } as const;

/** What a quality preset affords the masks, beside their size (which is the gore tier's). */
export interface WoundMaskBudget {
  /** Figures that may wear a mask at once; past it the oldest gives its mask up. */
  live: number;
  /** Paints of each run of blood while a wound bleeds (each one a little further down the body). */
  runs: number;
  /** Rings of texels the dilation fills past the UV islands' edges, so seams do not show. */
  rings: number;
}

export const WOUND_MASK_BUDGET: Readonly<Record<QualityPreset, WoundMaskBudget>> = {
  low: { live: 3, runs: 1, rings: 2 },
  medium: { live: 4, runs: 2, rings: 2 },
  high: { live: 6, runs: 3, rings: 2 },
  ultra: { live: 8, runs: 4, rings: 2 },
};

/**
 * Capsules a figure's materials keep round its strokes in the sculpt's rest pose: outside every one of them the
 * mask is not shown. The figures' UV islands are packed tightly, and at 64 texels a side many small parts own no
 * texel of their own, so the bake's seam dilation and the bilinear filter would carry a wound onto a far part
 * (a chest wound onto a headdress). See docs/play/GORE_SYSTEM.md.
 */
export const WOUND_GATES = 12;
/**
 * Floats one gate takes: (a, radius), (b, back), (normal, front). Like a stroke it is a prism through the body: a
 * capsule across the surface, reaching from the anchor bone (`back` behind the wound) to `front` before it; a gate
 * merged from two pointing different ways has no normal and is a plain capsule.
 */
export const WOUND_GATE_FLOATS = 12;

/** Draws one paint costs: the bake of each mesh in UV space, and one pass that dilates the hit and adds it in. */
export function paintDraws(meshes: number): number { return Math.max(1, meshes) + 1; }

/** Bytes of one mask (RGBA, 8 bits a channel). The bake's hit buffer of the same size is shared by every mask. */
export function maskBytes(size: number): number { return size * size * 4; }

/**
 * One stroke, in the wound's own frame on the surface: x across the body, y up it, z out of it (world units).
 * A blob or a broad stroke is round about the wound's point; a capsule runs from -half to +half along `axis`.
 */
export interface WoundStroke {
  shape: WoundShape;
  /** Unit direction of a capsule in the frame's x-y plane. */
  axis: { x: number; y: number };
  half: number;
  /** Radii: of the opening (channel r), the blood round it (g), and the deep core (b). */
  open: number;
  blood: number;
  deep: number;
  /** What each channel is given at the stroke's middle. */
  amount: { open: number; blood: number; deep: number };
  /** 0..1: how torn its edge is (the bake's lobes from the sculpt's own surface). */
  ragged: number;
  /** How far in front of the wound's point the stroke still reaches, world units (behind, it reaches to the anchor bone). */
  front: number;
  seed: number;
}

/** A run of blood: painted at `at` seconds after the wound, down the body from `from` to `to` along gravity as it then hangs. */
export interface WoundRun {
  at: number;
  /** Distances down from the wound, world units. */
  from: number;
  to: number;
  width: number;
  blood: number;
  /** Sideways from the wound's point, world units (a second rivulet). */
  side: number;
}

export interface WoundMaskPlan {
  /** The gore tier the wound was opened at (goreTiers.ts), and the mask's side in texels at that tier. */
  tier: GoreTier;
  size: number;
  kind: GoreWoundKind;
  strokes: WoundStroke[];
  runs: WoundRun[];
  /** Tier 2 at Full: layers inside the wound, bone at its bottom, the surface sunk in. */
  interiors: boolean;
  /** Tier 1 and up: torn cloth at the edge, a frayed dark rim, blood soaked into the cloth round it. */
  fabric: boolean;
  /** How deep the deepest part sinks, as a share of the figure's height (0 without interiors). */
  sink: number;
  /** 0..1: how wet it is when fresh. It dries from there. */
  wet: number;
  /**
   * How far behind the wound's point its strokes and runs reach, world units. Unset, they reach to the anchor bone,
   * through the body. A stump's wound faces along its bone, and reaching to the bone's far end would paint the whole
   * limb: it reaches about two of the cut's radii instead ({@link STUMP_WOUND}).
   */
  back?: number;
}

interface StrokeSpec {
  shape: WoundShape;
  /** Multiples of the wound's size. */
  half: number; open: number; blood: number; deep: number;
  amount: { open: number; blood: number; deep: number };
  ragged: number;
  /** The capsule's angle from the frame's x axis: a base and a seeded spread either way, radians. */
  angle: number; spread: number;
}

/**
 * Each kind's stroke, in multiples of the wound's size (GoreDirector's `wound.size`: about 0.06 of a square for a
 * blow of power 1, a seventh of a Pawn's height). A stab opens a hole of about half that radius, its blood
 * soaking out to about three quarters of it (on a man, a hand's breadth round the wound).
 */
export const WOUND_STROKES: Readonly<Record<GoreWoundKind, StrokeSpec>> = {
  stab: { shape: "blob", half: 0, open: 0.45, blood: 0.7, deep: 0.22, amount: { open: 1, blood: 1, deep: 1 }, ragged: 0.25, angle: 0, spread: Math.PI },
  pierce: { shape: "blob", half: 0, open: 0.4, blood: 0.75, deep: 0.2, amount: { open: 1.1, blood: 1.1, deep: 1.15 }, ragged: 0.3, angle: 0, spread: Math.PI },
  bite: { shape: "blob", half: 0.3, open: 0.5, blood: 0.8, deep: 0.24, amount: { open: 1, blood: 1, deep: 0.85 }, ragged: 0.55, angle: 0, spread: 0.3 },
  slash: { shape: "capsule", half: 1.3, open: 0.2, blood: 0.5, deep: 0.1, amount: { open: 1, blood: 0.9, deep: 0.8 }, ragged: 0.18, angle: 0.55, spread: 0.3 },
  tear: { shape: "capsule", half: 0.9, open: 0.32, blood: 0.7, deep: 0.16, amount: { open: 1, blood: 1, deep: 0.9 }, ragged: 0.6, angle: -Math.PI / 2, spread: 0.5 },
  crush: { shape: "broad", half: 0, open: 0.75, blood: 1, deep: 0.3, amount: { open: 0.75, blood: 1, deep: 0.6 }, ragged: 0.7, angle: 0, spread: Math.PI },
  burst: { shape: "broad", half: 0, open: 0.95, blood: 1.2, deep: 0.5, amount: { open: 1, blood: 1.2, deep: 1 }, ragged: 0.8, angle: 0, spread: Math.PI },
};

/** Cinematic and Full: how much larger, bloodier and deeper, and how the blood runs. Minimal has none. */
export const WOUND_VIOLENCE: Readonly<Record<Exclude<GoreIntensity, "minimal">, {
  radius: number; blood: number; open: number; bloodAmount: number; deep: number; wet: number;
  /** Run length and width, multiples of the wound's size; a second rivulet at Full. */
  run: number; runWidth: number; rivulets: number; extraRuns: number;
}>> = {
  cinematic: { radius: 1, blood: 1, open: 0.9, bloodAmount: 0.9, deep: 0.75, wet: 0.7, run: 2, runWidth: 0.2, rivulets: 1, extraRuns: 0 },
  full: { radius: 1.15, blood: 1.15, open: 1.1, bloodAmount: 1.15, deep: 1, wet: 1, run: 3, runWidth: 0.24, rivulets: 2, extraRuns: 1 },
};

/** How deep opened interiors sink the surface at the wound's deepest point, as a share of the figure's height. */
export const WOUND_SINK = 0.025;

export interface WoundMaskInput {
  kind: GoreWoundKind;
  /** The wound's size, world units (GoreDirector's `wound.size`). */
  size: number;
  /** The blow's power, 0..2. */
  power: number;
  intensity: GoreIntensity;
  quality: QualityPreset;
  /** The tier and what it shows (goreTiers.ts `goreShow`). */
  tier: GoreTier;
  /** The mask's side at that tier (`goreShow(...).budget.mask`). */
  mask: number;
  interiors: boolean;
  fabric: boolean;
  /** Seconds the wound bleeds (GoreDirector's `wound.bleed`); 0 under reduced motion: its runs are simply there. */
  bleed: number;
  seed: number;
}

/** Stateless hash to [0, 1): the same (seed, channel) always gives the same number. */
export function maskHash(seed: number, channel: number): number {
  let h = (seed ^ Math.imul(channel + 1, 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));
const round = (value: number) => Math.round(value * 1e6) / 1e6;

/** What one wound paints, or null where nothing is painted (Minimal, tier 0, no mask on this preset). */
export function planWoundMask(input: WoundMaskInput): WoundMaskPlan | null {
  if (input.intensity === "minimal" || input.tier === 0 || !(input.mask > 0) || !(input.size > 0)) return null;
  const look = WOUND_VIOLENCE[input.intensity], spec = WOUND_STROKES[input.kind], budget = WOUND_MASK_BUDGET[input.quality];
  const size = input.size, seed = input.seed >>> 0;
  const power = clamp(Number.isFinite(input.power) ? input.power : 1, 0.3, 2);
  const deepen = clamp(power / 1.2, 0.6, 1.4);
  const angle = spec.angle + (maskHash(seed, 1) * 2 - 1) * spec.spread;
  const radius = size * look.radius;
  const stroke: WoundStroke = {
    shape: spec.shape,
    axis: { x: round(Math.cos(angle)), y: round(Math.sin(angle)) },
    half: round(spec.half * radius),
    open: round(spec.open * radius),
    blood: round(spec.blood * radius * look.blood),
    deep: round(spec.deep * radius),
    amount: {
      open: round(spec.amount.open * look.open),
      blood: round(spec.amount.blood * look.bloodAmount),
      deep: round(clamp(spec.amount.deep * look.deep * deepen, 0, 1.5)),
    },
    ragged: spec.ragged,
    front: round(Math.max(spec.blood, spec.half) * radius * 1.5),
    seed: Math.floor(maskHash(seed, 2) * 65536),
  };

  // Runs of blood down the body, each painted further down as the wound bleeds; under reduced motion all at once.
  const runs: WoundRun[] = [];
  const steps = input.bleed > 0 ? budget.runs + look.extraRuns : 1;
  const length = look.run * size * (0.8 + 0.4 * maskHash(seed, 3)), width = look.runWidth * size;
  for (let rivulet = 0; rivulet < look.rivulets; rivulet += 1) {
    const share = rivulet === 0 ? 1 : 0.6;
    const side = rivulet === 0 ? 0 : (maskHash(seed, 4) < 0.5 ? -1 : 1) * stroke.open * (0.8 + 0.6 * maskHash(seed, 5));
    for (let step = 0; step < steps; step += 1) {
      const begin = step / steps, end = (step + 1) / steps;
      runs.push({
        at: round(input.bleed > 0 ? input.bleed * (0.1 + 0.62 * end) * (rivulet === 0 ? 1 : 1.12) : 0),
        // Each paint overlaps the last a little, so the run has no gaps where the body moved between them.
        from: round(Math.max(0, begin * length * share - width)), to: round(end * length * share),
        width: round(width * (rivulet === 0 ? 1 : 0.75) * (1 - 0.35 * begin)),
        blood: round(1.05 * look.bloodAmount * (1 - 0.25 * begin)),
        side: round(side),
      });
    }
  }
  runs.sort((a, b) => a.at - b.at);

  return {
    tier: input.tier, size: input.mask, kind: input.kind, strokes: [stroke], runs,
    interiors: input.interiors, fabric: input.fabric,
    sink: input.interiors ? WOUND_SINK * clamp(stroke.amount.deep, 0, 1) : 0,
    wet: look.wet,
  };
}

/**
 * The wound a limb leaves where it came off (death/sever SeverSystem `paintStumpWound`): the skin round the cut torn,
 * wet and opened, broad and ragged as a burst's, sized to the cut, reaching a little way up the stump (`back`), its
 * blood run down the body as it then hangs. The thrown limb wears the figure's materials but not its rest pose, so
 * the mask's gates (in the sculpt's rest space) leave it out; its cut end has raw flesh of its own.
 */
export const STUMP_WOUND = {
  /** The wound's size, in the cut's radii: a burst's stroke opens about this and soaks about 1.4 times it, at Full. */
  size: 1.7,
  /** The blow it stands for, as the planner's power (0..2): the deepest a stroke goes. */
  power: 1.6,
  /** Seconds the stump bleeds down the body (its beats last about this long). */
  bleed: 2.4,
  /** How far up the stump it reaches, in the cut's radii (WoundMaskPlan.back): the bone's far end is a limb away. */
  back: 2.2,
} as const;

export interface StumpMaskInput {
  /** The cut's radius, world units. */
  radius: number;
  intensity: GoreIntensity;
  quality: QualityPreset;
  /** The kill's gore tier: limbs come off at tier 2 and 3 only. */
  tier: GoreTier;
  /** Seconds it bleeds: {@link STUMP_WOUND}.bleed, or 0 under reduced motion (its runs are simply there). */
  bleed: number;
  seed: number;
}

/**
 * What a stump paints into its figure's mask, or null where nothing is: limbs come off only at tier 2 and up at
 * Full (goreTiers.ts `goreShow(...).sever`), and the wound opens to its interiors and tears the cloth round it.
 */
export function planStumpMask(input: StumpMaskInput): WoundMaskPlan | null {
  if (input.intensity !== "full" || input.tier < 2 || !(input.radius > 0)) return null;
  const plan = planWoundMask({
    kind: "burst", size: input.radius * STUMP_WOUND.size, power: STUMP_WOUND.power, intensity: input.intensity, quality: input.quality,
    tier: input.tier, mask: goreBudget(input.tier, input.quality).mask, interiors: true, fabric: true, bleed: input.bleed, seed: input.seed,
  });
  return plan && { ...plan, back: round(input.radius * STUMP_WOUND.back) };
}

/**
 * How wet a mask reads `seconds` after its last paint: fresh blood shines, then dulls as it dries, never quite to
 * nothing within a match. `wet` is the plan's fresh wetness.
 */
export function wetness(wet: number, seconds: number): number {
  const t = Math.max(0, seconds);
  return wet * (0.4 + 0.6 * Math.exp(-t / 14));
}

/**
 * How strongly a point of the surface is painted by a stroke, as the bake computes it (without the ragged edge):
 * `lateral` is its distance from the stroke's axis across the surface, `depth` how far in front of (positive) or
 * behind (negative) the wound's point it lies, `back` how far behind the anchor bone is. For the tests.
 */
export function strokeAt(stroke: Pick<WoundStroke, "shape" | "open" | "blood" | "deep" | "amount" | "front">, lateral: number, depth: number, back: number): { open: number; blood: number; deep: number } {
  const smooth = (from: number, to: number, value: number) => { const t = clamp((value - from) / (to - from), 0, 1); return t * t * (3 - 2 * t); };
  const reach = smooth(-back - 0.002, -back * 0.5, depth) * (1 - smooth(stroke.front * 0.6, stroke.front, depth));
  // A cone, linear in distance; the opening keeps a flat top, wider for a broad stroke.
  const cone = (radius: number, top = 0) => clamp((radius - lateral) / Math.max(1e-5, radius * (1 - top)), 0, 1);
  const open = cone(stroke.open, stroke.shape === "broad" ? 0.7 : 0.25);
  return { open: open * stroke.amount.open * reach, blood: cone(stroke.blood) * stroke.amount.blood * reach, deep: cone(stroke.deep) * stroke.amount.deep * reach };
}
