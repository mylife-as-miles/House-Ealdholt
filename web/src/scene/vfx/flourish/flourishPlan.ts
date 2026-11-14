/**
 * The flourishes of a kill, as plain data: each kingdom's colours, what each quality preset may spend, and when none
 * of it is drawn. No Three.js in here, so the node tests reach it (shared/play/flourish-*.test.ts).
 *
 * A flourish is what a modern stylised game draws over the blow itself: the crescent of light a killing swing leaves
 * (arcPlan.ts), the flakes and chips a kill throws (shardPlan.ts), the kingdom's sigil stamped in the air where a spell
 * or a summon strikes (sigils.ts, glyphPlan.ts), and the ribbons a caster draws in to the hand (gatherPlan.ts). Every
 * one is in the colours of the kingdom that kills, never of its side of the board.
 */
import type { QualityPreset } from "../../quality";
import type { VfxArmy } from "../wiring";

/** One kingdom's flourish colours (sRGB hex, as three's Color takes them). */
export interface FlourishLook {
  /** The white-hot heart: an arc's leading line, a sigil's strokes at their flash, a flake's glint. */
  core: number;
  /** The kingdom's own colour: an arc's body and a sigil's strokes. */
  edge: number;
  /** The deep, saturated colour an arc's soft side and every halo fall to. */
  deep: number;
  /** Most flakes, and the rest (a second metal, or the light caught off ice). */
  flake: number;
  flakeAccent: number;
  /** The stone chips a kill throws, and the light of the blow caught on their edges while they are hot. */
  chip: number;
  chipEdge: number;
}

/**
 * Each kingdom's flourish colours, matched to its spell look (spellLook.ts SPELL_LOOK) and its burn (scorchPlan.ts):
 *
 * - Solforiz (`sun`): the sun's fire. Deep orange at the edges and a red-orange depth: under the 360 arenas' AgX grade a
 *   gold goes khaki and an orange stays fire (docs/play/SUMMONS.md, the phoenix). Its flakes are hammered gold and ember.
 * - Aethelgard (`ivory`): cold witchfire off a crystal staff. Pale cyan edges over a glacier blue; its flakes are ice
 *   glitter, its chips cold slate.
 * - Kwind-09 (`kwind`): the arc. Electric blue-violet; among its flakes the brass of its fittings and sodium lamps.
 * - Korvenia (`empire`): arcane violet, with antique gold among the flakes and obsidian chips.
 */
export const FLOURISH_LOOK: Readonly<Record<VfxArmy, FlourishLook>> = Object.freeze({
  sun: { core: 0xfff1d6, edge: 0xff7a1c, deep: 0xc8260a, flake: 0xffae42, flakeAccent: 0xff5a1e, chip: 0x2b2018, chipEdge: 0xff9a4a },
  ivory: { core: 0xf4feff, edge: 0x70dcff, deep: 0x2a7cf0, flake: 0xdaf6ff, flakeAccent: 0x9fdcff, chip: 0x353b44, chipEdge: 0xbfeaff },
  kwind: { core: 0xefeaff, edge: 0x7c62ff, deep: 0x3214d0, flake: 0xc4b8ff, flakeAccent: 0xe0a446, chip: 0x1d1c22, chipEdge: 0x9d8cff },
  empire: { core: 0xf7e8ff, edge: 0xc458ff, deep: 0x6a16c0, flake: 0xe2b6ff, flakeAccent: 0xd9b25c, chip: 0x17131c, chipEdge: 0xd6a6ff },
});

/** How near (degrees of hue) a colour must lie to a blow's accent to be of the kingdom's own family, and take it. */
export const KEPT_FAMILY = 40;

/**
 * `hex` turned to `hueDegrees`, its HSV saturation and value kept (the black and white of a killing blow judges colour
 * by its HSV hue on the frame as shown, moments/momentShader.ts moHsv).
 */
export function withHue(hex: number, hueDegrees: number): number {
  const r = ((hex >> 16) & 255) / 255, g = ((hex >> 8) & 255) / 255, b = (hex & 255) / 255;
  const v = Math.max(r, g, b), s = v === 0 ? 0 : (v - Math.min(r, g, b)) / v;
  const h = ((((hueDegrees % 360) + 360) % 360) / 60);
  const f = (n: number) => { const k = (n + h) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); };
  const byte = (x: number) => Math.round(clamp01(x) * 255);
  return (byte(f(5)) << 16) | (byte(f(3)) << 8) | byte(f(1));
}

/**
 * A kingdom's look for one killing blow, its kept colour on the blow's accent (moments/momentPlan.ts blowAccent: the one
 * hue a killing blow's black and white keeps, in turns, 0 to 1). Every colour of the kingdom's own family (within
 * {@link KEPT_FAMILY} degrees of the accent) is turned to that hue, its saturation and value kept, so the arc, the flakes,
 * the chips' hot edges, the sigil and the fire burn through the black and white in the attacker's colour, where its
 * other shades (Solforiz's red depth when the red is the victim's) would go grey. The white-hot heart stays white, and a
 * second metal (Kwind-09's brass, Korvenia's gold) and the dark stone keep their own. The accent is the kingdom's own hue
 * or a few degrees off it, so outside the moment the look is still the kingdom's.
 */
export function keptLook(look: FlourishLook, accentHue: number): FlourishLook {
  if (!Number.isFinite(accentHue)) return look;
  const degrees = ((((accentHue * 360) % 360) + 360) % 360);
  const keep = (hex: number) => {
    const d = Math.abs(((hue(hex) - degrees + 540) % 360) - 180);
    return d <= KEPT_FAMILY && saturation(hex) > 0 ? withHue(hex, degrees) : hex;
  };
  return { core: look.core, edge: keep(look.edge), deep: keep(look.deep), flake: keep(look.flake), flakeAccent: keep(look.flakeAccent), chip: look.chip, chipEdge: keep(look.chipEdge) };
}

/** What one quality preset may spend on flourishes. Every pool is sized from this once, never grown. */
export interface FlourishBudget {
  /** Cuts between two samples of an arc (its Catmull-Rom smoothing): a fast swing is a curve, not a polyline. */
  arcSubdivide: number;
  /** Sparks one arc sheds along its leading edge. */
  arcSparks: number;
  /** Slots in the one pool every spark, streak and flake shares. */
  sparks: number;
  /** Flakes and stone chips one kill throws. */
  flakes: number;
  chips: number;
  /** Slots in the chips' pool (two or three kills' worth can be in the air at once). */
  chipPool: number;
  /** A sigil's starburst: long streaks thrown out in its plane, and loose sparks that fall. */
  glyphStreaks: number;
  glyphSparks: number;
  /** Blades of crystalline fire round a fire spell's blow. */
  flares: number;
  /** Ribbons a caster draws in to the hand, the cuts along each, and the little arcs of a Kwind-09 cast. */
  ribbons: number;
  ribbonSegments: number;
  lightning: number;
}

/**
 * The budgets. The lowest preset has no bloom, and the recorder has none at `medium` either: every flourish draws its
 * own halo on every preset, so cutting a preset cuts counts, never the glow.
 */
export const FLOURISH_BUDGET: Readonly<Record<QualityPreset, FlourishBudget>> = Object.freeze({
  low: { arcSubdivide: 3, arcSparks: 4, sparks: 176, flakes: 6, chips: 4, chipPool: 12, glyphStreaks: 10, glyphSparks: 6, flares: 8, ribbons: 3, ribbonSegments: 28, lightning: 1 },
  medium: { arcSubdivide: 4, arcSparks: 8, sparks: 352, flakes: 14, chips: 8, chipPool: 24, glyphStreaks: 18, glyphSparks: 12, flares: 14, ribbons: 4, ribbonSegments: 40, lightning: 2 },
  high: { arcSubdivide: 5, arcSparks: 12, sparks: 512, flakes: 22, chips: 12, chipPool: 36, glyphStreaks: 26, glyphSparks: 18, flares: 20, ribbons: 5, ribbonSegments: 52, lightning: 3 },
  ultra: { arcSubdivide: 6, arcSparks: 16, sparks: 704, flakes: 30, chips: 16, chipPool: 48, glyphStreaks: 32, glyphSparks: 24, flares: 26, ribbons: 5, ribbonSegments: 64, lightning: 3 },
});

/** Where flourishes are drawn at all. */
export interface FlourishFlags {
  reducedMotion: boolean;
  /** The flat tactical map. */
  tactical: boolean;
  /** The menu's background board (attract mode, the title tableau): it stays plain. */
  menuBoard: boolean;
}

/** Every flourish moves, so reduced motion has none; the map and the menu's board keep their restraint. */
export function flourishAllowed(flags: FlourishFlags): boolean {
  return !flags.reducedMotion && !flags.tactical && !flags.menuBoard;
}

/** Linear red, green and blue of an sRGB hex colour, as three's Color.setHex gives them under colour management. */
export function linearRgb(hex: number): [number, number, number] {
  const channel = (value: number) => { const c = value / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  return [channel((hex >> 16) & 255), channel((hex >> 8) & 255), channel(hex & 255)];
}

/** How saturated a colour is (HSV saturation of its sRGB channels), 0 grey to 1 pure. */
export function saturation(hex: number): number {
  const r = (hex >> 16) & 255, g = (hex >> 8) & 255, b = hex & 255;
  const high = Math.max(r, g, b), low = Math.min(r, g, b);
  return high === 0 ? 0 : (high - low) / high;
}

/** The hue of a colour in degrees (0 red, 120 green, 240 blue). */
export function hue(hex: number): number {
  const r = ((hex >> 16) & 255) / 255, g = ((hex >> 8) & 255) / 255, b = (hex & 255) / 255;
  const high = Math.max(r, g, b), low = Math.min(r, g, b), d = high - low;
  if (d === 0) return 0;
  const h = high === r ? ((g - b) / d) % 6 : high === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
/** Hermite ease from `from` to `to`, 0 below and 1 above (GLSL's smoothstep). */
export function smoothstep(from: number, to: number, value: number): number {
  const t = clamp01((value - from) / (to - from));
  return t * t * (3 - 2 * t);
}
export { clamp01 };

/** A hash of a string to a 32-bit seed (FNV-1a), for flourishes named by an id. */
export function seedOf(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}
