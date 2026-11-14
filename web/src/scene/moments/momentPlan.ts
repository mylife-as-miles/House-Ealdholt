/**
 * Cinematic moments (docs/play/MOMENTS.md): the time and grade beats round a fight's big blows, as plain numbers.
 *
 * - **The killing blow.** A hit-stop on the fight's own clock (the scene's time scale, which every system's delta is
 *   given in, so the choreography, the sound it cues and the effects stay together); the frame struck to
 *   high-contrast black and white, sweeping out from the contact point and keeping only the attacker's kingdom colour;
 *   a ripple in screen space from the contact point; a brief fringe of chromatic aberration; a small kick of the lens
 *   on top of whatever shot holds the camera. Its weight follows the kill: a Pawn's death lighter, a Queen's or a
 *   summon's heavier ({@link blowStrength}).
 * - **A spell's darkness**, from its gather to just after its blow: shadows and mid-tones pressed down, the spell's own
 *   light kept, the vignette closing in ({@link SPELL_DARK}).
 * - **The dread of a King in check**: a faint desaturation and vignette ({@link DREAD}).
 * - **The defeat grade** another system asks for: one side's kingdom colour and the hall's light drained ({@link DEFEAT}).
 *
 * Every curve is a function of the capture (who takes whom, how, which armies, whether it mates) and of real seconds
 * since its beat began. Nothing is random: the same game, played or replayed, plays the same moments.
 *
 * Accessibility: nothing here brightens the frame quickly. The black and white crushes shadows and mid-tones and
 * leaves highlights where they were (MOMENT_GLSL `moMono`), so it is never a white frame; the only quick change of
 * light is its return to colour, once per killing blow; every other grade eases over half a second or more.
 *
 * Pure, no three.js: shared/play/moments.test.ts.
 */
import type { ArmySkinId } from "../../assets/generated";
import type { Faction, PieceKind } from "../../core/types";

/** How a blow is dealt (gore/goreTiers.ts KillMoment["style"]). */
export type BlowStyle = "melee" | "gun" | "spell" | "summon";

/** What a killing blow is, as the engine knows it on the frame it lands. */
export interface BlowKill {
  attacker: PieceKind;
  victim: PieceKind;
  style: BlowStyle;
  /** The armies on each side of the blow: the attacker's colour is the one the black and white keeps. */
  attackerArmy: ArmySkinId;
  victimArmy: ArmySkinId;
  /** The victim's side: its ring and rim are drawn in that side's colour whatever army it wears ({@link SIDE_HUE}). */
  victimSide?: Faction;
  /** The capture gives checkmate, or takes a side's last piece beside its King. */
  mate?: boolean;
  last?: boolean;
  /** Reduced Motion: no hit-stop, ripple, fringe or kick, only a gentle grade that eases in and out. */
  gentle?: boolean;
  /** A spell's or a summon's own colours (0xRRGGBB): the kept band reaches to take them in ({@link blowAccent}). */
  palette?: readonly number[];
}

/**
 * A kingdom's colour, as a hue (0 to 1 round the wheel), the half-width kept round it, and how far its centre may move
 * each way within the kingdom's own palette when the victim's colours stand near it (`shift`). Read off the armies'
 * own magic (spellLook.ts SPELL_LOOK), by army and never by side.
 *
 * - Solforiz (`sun`): its fire, gold through orange to red (its blood-red too); the gold end when the red is the victim's.
 * - Aethelgard (`ivory`): the cold cyan witchfire and its blue; the cyan end when the blue is the victim's.
 * - Kwind-09 (`kwind`): the arc's blue-violet.
 * - Korvenia (`empire`): arcane violet.
 */
export const KINGDOM_ACCENT: Readonly<Record<ArmySkinId, { readonly hue: number; readonly width: number; readonly shift: readonly [number, number] }>> = {
  sun: { hue: 18 / 360, width: 26 / 360, shift: [-10 / 360, 16 / 360] },
  ivory: { hue: 202 / 360, width: 24 / 360, shift: [-12 / 360, 10 / 360] },
  kwind: { hue: 253 / 360, width: 18 / 360, shift: [-6 / 360, 6 / 360] },
  empire: { hue: 278 / 360, width: 18 / 360, shift: [-6 / 360, 8 / 360] },
};

/**
 * The hue each side's identity is drawn in, whatever army it wears (pieces.ts FACTION_RING and FACTION_RIM: the band on
 * its tile and the light along its silhouette), White blue and Black red-orange.
 */
export const SIDE_HUE: Readonly<Record<Faction, number>> = { w: 206 / 360, b: 12 / 360 };

/** The distance between two hues round the wheel, 0 to 0.5. */
export function hueDistance(a: number, b: number): number {
  const d = Math.abs((((a - b) % 1) + 1.5) % 1 - 0.5);
  return d;
}

/**
 * How much of the distance to the nearest of the victim's colours the kept band may span: the band's soft edge ends at
 * its half-width, so the victim's colour sits beyond it by half as much again.
 */
const ACCENT_CLEAR = 0.7;
/** The narrowest band the accent is narrowed to before its centre is moved off its kingdom's own (hue units). */
const ACCENT_USABLE = 14 / 360;

/**
 * The colour the black and white keeps: the attacker's kingdom hue and a half-width round it, kept clear of the
 * victim's colours (its kingdom's hue, and its side's ring and rim), so the accent is the killer's alone. Where one of
 * them stands near (Kwind-09's blue-violet beside Korvenia's violet; Solforiz's fire beside the red of Black's rings
 * when Solforiz plays White), the band narrows; where that leaves it narrower than {@link ACCENT_USABLE}, its centre
 * moves the least it must within the kingdom's palette (Solforiz to its gold, Aethelgard to its cyan). A spell's or a
 * summon's `palette` moves and opens the band to take its own colours in too (reachPalette).
 */
export function blowAccent(attacker: ArmySkinId, victim: ArmySkinId, victimSide?: Faction, palette: readonly number[] = []): { hue: number; width: number } {
  const own = KINGDOM_ACCENT[attacker];
  const avoid = [...(attacker === victim ? [] : [KINGDOM_ACCENT[victim].hue]), ...(victimSide ? [SIDE_HUE[victimSide]] : [])];
  const clearAt = (hue: number, base: number) => avoid.reduce((width, other) => Math.min(width, hueDistance(hue, other) * ACCENT_CLEAR), attacker === victim ? base * 0.6 : base);
  const widthAt = (hue: number) => clearAt(hue, own.width);
  const kept = kingdomBand(own, widthAt);
  return palette.length ? reachPalette(kept, own, palette, clearAt) : kept;
}

/** A spell's palette reaches this far from its kingdom's hue at most (Solforiz's gold core is 25 degrees off its fire). */
const PALETTE_REACH = 40 / 360;
/** How much wider than its kingdom's own the band may open for a spell's colours. */
const PALETTE_OPEN = 8 / 360;
/** A colour paler than this has no hue the black and white would keep anyway (MOMENT_GLSL counts chroma from 0.2). */
const PALETTE_SATURATION = 0.3;

/** A colour's hue and saturation (0 to 1), as the shader's own HSV reads it. */
export function hexHue(hex: number): { hue: number; saturation: number } {
  const r = ((hex >> 16) & 255) / 255, g = ((hex >> 8) & 255) / 255, b = (hex & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  if (d <= 0) return { hue: 0, saturation: 0 };
  const hue = max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { hue: hue / 6, saturation: max > 0 ? d / max : 0 };
}

/**
 * The kept band, moved and opened to take in a spell's or a summon's own colours as well as its kingdom's: the arc
 * from the band's centre over every saturated colour of the palette near enough to be the kingdom's, centred, and as
 * wide as that arc (never narrower than the band, never more than {@link PALETTE_OPEN} past the kingdom's own), still
 * clear of the victim's colours. Solforiz's sun keeps its gold core as well as its red flame. Where the victim's colours
 * stand too near the moved centre, the band stays as it was.
 */
function reachPalette(kept: { hue: number; width: number }, own: { readonly width: number }, palette: readonly number[], clearAt: (hue: number, base: number) => number): { hue: number; width: number } {
  let lo = 0, hi = 0;
  for (const colour of palette) {
    const { hue, saturation } = hexHue(colour);
    if (saturation < PALETTE_SATURATION || hueDistance(hue, kept.hue) > PALETTE_REACH) continue;
    const delta = ((hue - kept.hue + 1.5) % 1) - 0.5;
    lo = Math.min(lo, delta); hi = Math.max(hi, delta);
  }
  if (hi - lo <= 1e-9) return kept;
  const hue = (kept.hue + (lo + hi) / 2 + 1) % 1, base = own.width + PALETTE_OPEN;
  const width = Math.min(clearAt(hue, base), Math.max(kept.width, hi - lo));
  return width >= Math.min(kept.width, ACCENT_USABLE) ? { hue, width } : kept;
}

/** The kingdom's own band (blowAccent before a palette): its hue, narrowed or moved within its palette to stay clear. */
function kingdomBand(own: (typeof KINGDOM_ACCENT)[ArmySkinId], widthAt: (hue: number) => number): { hue: number; width: number } {
  let best = { hue: own.hue, width: widthAt(own.hue) };
  if (best.width >= Math.min(own.width, ACCENT_USABLE)) return best;
  // The least move that makes the band usable, else the widest band the palette allows; whole degrees, so it is exact.
  const steps = Math.round(Math.max(-own.shift[0], own.shift[1]) * 360);
  for (let step = 1; step <= steps; step += 1) {
    for (const sign of [1, -1]) {
      const shift = (sign * step) / 360;
      if (shift < own.shift[0] - 1e-9 || shift > own.shift[1] + 1e-9) continue;
      const hue = (own.hue + shift + 1) % 1, width = widthAt(hue);
      if (width >= Math.min(own.width, ACCENT_USABLE)) return { hue, width };
      if (width > best.width + 1e-9) best = { hue, width };
    }
  }
  return best;
}

/** How much a victim's death weighs, by rank: the court and the big pieces are struck harder than a footsoldier. */
const VICTIM_WEIGHT: Readonly<Record<PieceKind, number>> = { p: 0.3, n: 0.55, b: 0.55, r: 0.7, q: 0.9, k: 1 };

/**
 * The weight of a killing blow, 0 to 1: a Pawn's death 0.3, a minor piece's 0.55, a Rook's 0.7, a Queen's 0.9; a
 * Queen's own kill a little more, a spell a touch over steel; a summon (what a Queen calls on), a capture that mates and
 * one that takes a side's last piece the most there is.
 */
export function blowStrength(kill: Pick<BlowKill, "attacker" | "victim" | "style" | "mate" | "last">): number {
  if (kill.mate || kill.last || kill.style === "summon") return 1;
  let weight = VICTIM_WEIGHT[kill.victim] ?? 0.5;
  if (kill.attacker === "q") weight += 0.1;
  if (kill.style === "spell") weight += 0.05;
  return Math.min(1, Math.max(0, weight));
}

/** The lightest blow there is (a Pawn's death), from which a blow's parameters are interpolated. */
const LIGHTEST = 0.3;

/** A killing blow's moment, as the director plays it: every figure in real seconds unless named otherwise. */
export interface BlowPlan {
  readonly strength: number;
  readonly gentle: boolean;
  /** The hit-stop: real seconds the fight's clock crawls at `crawl` of its speed, then eases back over `release`. */
  readonly hold: number;
  readonly crawl: number;
  readonly release: number;
  /** The black and white: it sweeps out from the contact point over `monoIn`, holds, and colour returns over `monoOut`. */
  readonly monoIn: number;
  readonly monoHold: number;
  readonly monoOut: number;
  /** How far it goes (1: all the way to black and white, the accent aside). */
  readonly mono: number;
  /** The ripple: how long it runs, how far its front travels and how hard it bends the frame (frame heights). */
  readonly waveSeconds: number;
  readonly waveReach: number;
  readonly waveAmplitude: number;
  readonly waveWidth: number;
  /** The chromatic fringe: its strength one frame height from the contact point, and how long it lasts. */
  readonly aberration: number;
  readonly aberrationSeconds: number;
  /** The lens kick: degrees off the shot's own lens at the match's rest lens, how fast it comes and how long it eases off. */
  readonly punch: number;
  readonly punchIn: number;
  readonly punchOut: number;
  /** How far the vignette closes in while the frame is black and white. */
  readonly vignette: number;
  /** The colour kept: a hue and the half-width round it (0 to 1 round the wheel). */
  readonly accentHue: number;
  readonly accentWidth: number;
  /** Real seconds from the blow until everything it changed is back exactly as it was. */
  readonly seconds: number;
}

/** What a blow shows on one frame. */
export interface BlowFrame {
  /** The scene's time scale (1: full speed). */
  timeScale: number;
  /** How far the frame is black and white, and how far out from the contact point it has swept (0 to 1). */
  mono: number;
  sweep: number;
  /** The ripple's front (frame heights from the contact point) and how hard it bends the frame there. */
  waveRadius: number;
  waveAmplitude: number;
  waveWidth: number;
  /** The fringe, one frame height from the contact point (frame heights). */
  aberration: number;
  /** The lens kick in degrees at the match's rest lens. */
  punch: number;
  vignette: number;
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const clamp01 = (x: number): number => (x <= 0 ? 0 : x >= 1 ? 1 : x);
/** Smoothstep on 0..1: zero slope at both ends, so nothing it drives starts or stops on a hard frame. */
export const smooth = (x: number): number => { const t = clamp01(x); return t * t * (3 - 2 * t); };
const outQuad = (x: number): number => { const t = clamp01(x); return 1 - (1 - t) * (1 - t); };
const outCubic = (x: number): number => { const t = clamp01(x); return 1 - (1 - t) ** 3; };

/** The gentle form a blow takes under Reduced Motion: a soft drain of colour, no time, ripple, fringe or lens. */
export const GENTLE_BLOW = { in: 0.3, hold: 0.15, out: 0.6, mono: 0.4, vignette: 0.12 } as const;

/** The killing blow's moment for a kill. */
export function planBlow(kill: BlowKill): BlowPlan {
  const strength = blowStrength(kill);
  const w = clamp01((strength - LIGHTEST) / (1 - LIGHTEST));
  const accent = blowAccent(kill.attackerArmy, kill.victimArmy, kill.victimSide, kill.palette);
  if (kill.gentle) {
    const seconds = GENTLE_BLOW.in + GENTLE_BLOW.hold + GENTLE_BLOW.out;
    return {
      strength, gentle: true, hold: 0, crawl: 1, release: 0,
      monoIn: GENTLE_BLOW.in, monoHold: GENTLE_BLOW.hold, monoOut: GENTLE_BLOW.out, mono: GENTLE_BLOW.mono,
      waveSeconds: 0, waveReach: 0, waveAmplitude: 0, waveWidth: 0, aberration: 0, aberrationSeconds: 0,
      punch: 0, punchIn: 0, punchOut: 0, vignette: GENTLE_BLOW.vignette,
      accentHue: accent.hue, accentWidth: accent.width, seconds,
    };
  }
  const hold = lerp(0.07, 0.12, w), release = 0.05;
  // Colour comes back over at least 0.1 s: at 30 frames a second, two frames between the black and white and colour.
  const monoIn = 0.09, monoHold = lerp(0.02, 0.07, w), monoOut = lerp(0.1, 0.14, w);
  const waveSeconds = lerp(0.38, 0.52, w);
  const aberrationSeconds = lerp(0.16, 0.24, w);
  const punchIn = 0.03, punchOut = lerp(0.3, 0.45, w);
  return {
    strength, gentle: false,
    hold, crawl: lerp(0.09, 0.03, w), release,
    monoIn, monoHold, monoOut, mono: lerp(0.9, 1, w),
    waveSeconds, waveReach: lerp(0.65, 1.05, w), waveAmplitude: lerp(0.009, 0.02, w), waveWidth: lerp(0.06, 0.1, w),
    aberration: lerp(0.0025, 0.005, w), aberrationSeconds,
    punch: lerp(1.2, 3.4, w), punchIn, punchOut,
    vignette: lerp(0.15, 0.35, w),
    accentHue: accent.hue, accentWidth: accent.width,
    seconds: Math.max(hold + release, monoIn + monoHold + monoOut, waveSeconds, aberrationSeconds, punchIn + punchOut),
  };
}

/** How far the black and white goes `t` real seconds after the blow: up as it sweeps out, held, eased back to colour. */
function monoAt(plan: BlowPlan, t: number): number {
  if (!(t >= 0)) return 0;
  const out = plan.monoIn + plan.monoHold;
  if (t >= out + plan.monoOut) return 0;
  if (plan.gentle && t < plan.monoIn) return plan.mono * smooth(t / plan.monoIn);
  if (t <= out) return plan.mono;
  return plan.mono * (1 - smooth((t - out) / plan.monoOut));
}

/** The scene's time scale `t` real seconds after the blow: a crawl for `hold`, eased back to full speed over `release`. */
export function blowTimeScale(plan: BlowPlan, t: number): number {
  if (plan.gentle || !(t >= 0) || t >= plan.hold + plan.release) return 1;
  if (t < plan.hold) return plan.crawl;
  return lerp(plan.crawl, 1, smooth((t - plan.hold) / plan.release));
}

/** What a blow shows `t` real seconds after it lands. Everything is exactly at rest from `plan.seconds` on. */
export function blowAt(plan: BlowPlan, t: number, out: BlowFrame = blankFrame()): BlowFrame {
  const live = t >= 0 && t < plan.seconds;
  out.timeScale = live ? blowTimeScale(plan, t) : 1;
  out.mono = live ? monoAt(plan, t) : 0;
  out.sweep = !live ? 0 : plan.gentle ? 1 : outQuad(t / plan.monoIn);
  const wave = live && plan.waveSeconds > 0 && t < plan.waveSeconds ? t / plan.waveSeconds : -1;
  out.waveRadius = wave >= 0 ? plan.waveReach * outCubic(wave) : 0;
  out.waveAmplitude = wave >= 0 ? plan.waveAmplitude * (1 - wave) ** 1.5 : 0;
  out.waveWidth = wave >= 0 ? plan.waveWidth * (0.6 + 0.8 * wave) : 0;
  out.aberration = live && plan.aberrationSeconds > 0 && t < plan.aberrationSeconds ? plan.aberration * (1 - smooth(t / plan.aberrationSeconds)) : 0;
  out.punch = !live || plan.punch <= 0 ? 0 : t < plan.punchIn ? plan.punch * (0.55 + 0.45 * (t / plan.punchIn))
    : t < plan.punchIn + plan.punchOut ? plan.punch * (1 - smooth((t - plan.punchIn) / plan.punchOut)) : 0;
  out.vignette = plan.mono > 0 ? plan.vignette * (out.mono / plan.mono) : 0;
  return out;
}

export function blankFrame(): BlowFrame {
  return { timeScale: 1, mono: 0, sweep: 0, waveRadius: 0, waveAmplitude: 0, waveWidth: 0, aberration: 0, punch: 0, vignette: 0 };
}

/**
 * A spell's darkness (and a summon's, from the Queen's call): real seconds it takes to come down as the spell gathers,
 * how long it lingers after the blow lands, and how long it takes to lift. At full darkness shadows and mid-tones are
 * pressed to about a fifth (`press`) and the far hall and sky with them (`far`: nothing far off is kept), the spell's
 * own light is kept, colour drops by `desaturation` and the vignette closes in by `vignette`.
 */
export const SPELL_DARK = { in: 0.6, linger: 0.4, out: 0.9, press: 0.82, far: 1, desaturation: 0.45, vignette: 0.45 } as const;

/**
 * A summon's darkness, from the Queen's call to just after what she called strikes: lighter than a spell's, as it
 * holds for the whole rite (five to seven seconds) and the rite is the spectacle: the board and its figures stay
 * readable round the creature, the far hall and the sky dimmed rather than gone (a phoenix burns against the sky).
 * Spell darkness at full kept the board under a summon near black for all of it. Timing as {@link SPELL_DARK}.
 */
export const SUMMON_DARK = { press: 0.6, far: 0.55, desaturation: 0.3, vignette: 0.35 } as const;

/** A King in check: a faint desaturation and vignette, eased in over `in` seconds and out over `out`. */
export const DREAD = { in: 1.2, out: 0.8, desaturation: 0.22, vignette: 0.34 } as const;

/**
 * The defeat grade (setDefeatGrade): at full, the losing kingdom's colour is gone, the rest of the frame keeps
 * `1 - desaturation` of its colour (the winner's kingdom colour is spared), the light falls by `light` and the
 * vignette closes in by `vignette`. Eased over the seconds the caller asks for, `seconds` unless it says. It works on
 * the frame by hue, not by side, so it cannot tell a victor's red cloak from the beaten kingdom's red: the downfall
 * asks for it at 0.6 and lets its world-space shade over the beaten half (downfall/sideShade.ts) say which side fell.
 * At full strength the whole hold read as black and white, the victorious sovereign as grey as the kneeling King.
 */
export const DEFEAT = { desaturation: 0.35, light: 0.3, vignette: 0.35, widen: 1.35, seconds: 1.6 } as const;

/**
 * A level that eases between 0 and 1: its progress moves at a steady rate towards its target, and what is shown is
 * that progress smoothed, so it never starts or stops on a hard frame, and a change of mind mid-way turns smoothly.
 */
export class EasedLevel {
  private progress = 0;
  target = 0;
  constructor(public riseSeconds: number, public fallSeconds: number) {}
  get value(): number { return smooth(this.progress); }
  get raw(): number { return this.progress; }
  get resting(): boolean { return this.progress === this.target; }
  step(seconds: number): number {
    if (this.progress === this.target || !(seconds > 0)) return this.value;
    if (this.progress < this.target) this.progress = Math.min(this.target, this.progress + seconds / Math.max(1e-3, this.riseSeconds));
    else this.progress = Math.max(this.target, this.progress - seconds / Math.max(1e-3, this.fallSeconds));
    return this.value;
  }
  /** At rest at once, where it is asked to be. */
  snap(value: number): void { this.progress = this.target = clamp01(value); }
}

/**
 * Everything the grade is given on one frame, in both pipelines (MOMENT_GLSL): a neutral grade (`on` false) leaves
 * the frame exactly as it was drawn.
 */
export interface MomentGrade {
  on: boolean;
  /** The contact point on screen (0 to 1, from the bottom left), the frame's width over its height. */
  centreX: number;
  centreY: number;
  aspect: number;
  /** The ripple: its front and its width (frame heights from the centre), and how hard it bends the frame there. */
  waveRadius: number;
  waveWidth: number;
  waveAmplitude: number;
  /** The fringe, one frame height from the centre (frame heights). */
  aberration: number;
  /** Black and white: how far, the front of its sweep (frame heights from the centre), and the hue kept round its half-width. */
  mono: number;
  sweep: number;
  accentHue: number;
  accentWidth: number;
  /** The scene's light: shadows and mid-tones pressed down (0 to 1), how much of that reaches the far hall, and a multiplier on all of it. */
  darkness: number;
  far: number;
  light: number;
  /** Colour taken from the whole frame (0 to 1), and the vignette closing in (0 to 1). */
  desaturation: number;
  vignette: number;
  /** The defeat grade: the hue drained and the half-width round it, how far, and the winner's hue spared. */
  drainHue: number;
  drainWidth: number;
  drain: number;
  spareHue: number;
}

export function neutralGrade(out?: MomentGrade): MomentGrade {
  const grade = out ?? ({} as MomentGrade);
  grade.on = false;
  grade.centreX = 0.5; grade.centreY = 0.5; grade.aspect = grade.aspect > 0 ? grade.aspect : 16 / 9;
  grade.waveRadius = 0; grade.waveWidth = 0.05; grade.waveAmplitude = 0; grade.aberration = 0;
  grade.mono = 0; grade.sweep = 0; grade.accentHue = 0; grade.accentWidth = 0.05;
  grade.darkness = 0; grade.far = 0; grade.light = 1;
  grade.desaturation = 0; grade.vignette = 0;
  grade.drainHue = 0; grade.drainWidth = 0.05; grade.drain = 0; grade.spareHue = 0;
  return grade;
}

/** Whether a grade changes anything at all: the pipelines skip every moment instruction when it does not. */
export function gradeIsNeutral(grade: MomentGrade): boolean {
  return grade.waveAmplitude <= 0 && grade.aberration <= 0 && grade.mono <= 0 && grade.darkness <= 0 && grade.light >= 1
    && grade.desaturation <= 0 && grade.vignette <= 0 && grade.drain <= 0;
}

/**
 * The front of the black and white's sweep, in frame heights from the contact point, `progress` (0 to 1) of the way
 * out: at 1 it has passed the corner of the frame furthest from the contact point, soft edge and all.
 */
export function sweepFront(progress: number, centreX: number, centreY: number, aspect: number): number {
  const dx = Math.max(centreX, 1 - centreX) * aspect, dy = Math.max(centreY, 1 - centreY);
  return clamp01(progress) * (Math.hypot(dx, dy) + MONO_EDGE + 0.02);
}

/** The width of the black and white's front, in frame heights (MOMENT_GLSL). */
export const MONO_EDGE = 0.12;
