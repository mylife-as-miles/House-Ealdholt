/**
 * The moments director (docs/play/MOMENTS.md): plays the beats of moments/momentPlan.ts on the player's clock and hands
 * the engine, each frame, the scene's time scale, the lens kick and the grade both pipelines draw.
 *
 *   const scale = moments.advance(played, real)   // first thing every frame: the hit-stop's time scale
 *   moments.blow(kill, contactPoint)               // the frame a killing blow lands
 *   moments.darken(true) / struck() / darken(false) // a spell's gather, its blow, its end (however it ends)
 *   moments.setCheck(side | null)                  // a King in check, or none
 *   moments.setDefeat(loser, winner, amount, s)    // the defeat grade another system asks for
 *   const kick = moments.lensKick(lensScale)       // degrees off the shot's lens for this frame only
 *   const grade = moments.compose(project, aspect) // the grade, with the contact point where the camera sees it now
 *   moments.hurry() / reset() / settle()           // a skipped fight; Undo, a new game, a rebuild; Skip ending
 *
 * No three.js and nothing random: the engine projects the contact point for it, and every curve is the plan's, run
 * on the frame's played seconds (a replay's transport over the player's clock; the player's clock in a match). Tactical view and the menu's background board are never graded; Reduced Motion keeps only the
 * gentle grade (no hit-stop, ripple, fringe or lens kick).
 *
 * Pure: shared/play/moments.test.ts.
 */
import type { ArmySkinId } from "../../assets/generated";
import type { Faction } from "../../core/types";
import {
  DEFEAT,
  DREAD,
  EasedLevel,
  KINGDOM_ACCENT,
  SPELL_DARK,
  SUMMON_DARK,
  blankFrame,
  blowAt,
  gradeIsNeutral,
  neutralGrade,
  planBlow,
  smooth,
  sweepFront,
  type BlowKill,
  type BlowPlan,
  type MomentGrade,
} from "./momentPlan";

export interface MomentPoint { x: number; y: number; z: number }
/** Where a world point is on screen (0 to 1 from the bottom left), and whether it is behind the camera. */
export interface MomentScreen { x: number; y: number; behind: boolean }

/** What the director may show: nothing at all on the map or the menu's board; only gentle grades under Reduced Motion. */
export interface MomentFlags {
  reducedMotion: boolean;
  tactical: boolean;
  menuBoard: boolean;
}

/** A moment beginning or ending, for whoever listens (the hit effects, the music's director, browser checks). */
export type MomentEvent =
  | { type: "blow"; strength: number; gentle: boolean; point: MomentPoint; accentHue: number; hold: number; seconds: number }
  | { type: "blow-end" }
  | { type: "darken"; on: boolean }
  | { type: "dread"; side: Faction | null }
  | { type: "defeat"; side: Faction | null; amount: number }
  | { type: "reset" };

/** The moments now, as one read: what the hit effects hang on and what the music's director listens to. */
export interface MomentSignals {
  /** The scene's time scale from the hit-stop this frame (1: none). Every system's delta already has it. */
  timeScale: number;
  /** True while a hit-stop holds the fight's clock. */
  holding: boolean;
  /** The killing blow playing, if any: its weight, real seconds since it landed, how far the frame is black and white. */
  blow: { strength: number; seconds: number; mono: number; gentle: boolean; point: MomentPoint } | null;
  /** How dark the hall is for a spell (0 to 1). */
  darkness: number;
  /** A King in check: whose, and how far the dread grade shows (0 to 1). */
  dread: { side: Faction | null; level: number };
  /** The defeat grade: whose colour is drained, and how far (0 to 1). */
  defeat: { side: Faction | null; amount: number };
}

/** A blow cut short (a skipped fight, Reduced Motion switched on): its black and white eases out over this long. */
const CUT_SHORT = 0.12;
/** Skip ending: what is left of a blow, a spell's darkness or the defeat grade eases out over this long. */
const SETTLE = 0.3;

export class MomentDirector {
  private flags: MomentFlags = { reducedMotion: false, tactical: false, menuBoard: false };
  private plan: BlowPlan | null = null;
  /** Real seconds since the blow landed (-1 before its first frame). */
  private age = -1;
  private point: MomentPoint = { x: 0, y: 0, z: 0 };
  /** A blow cut short: its black and white easing out from where it was. */
  private fading: { from: number; vignette: number; age: number; seconds: number } | null = null;
  private readonly frame = blankFrame();
  private readonly dark = new EasedLevel(SPELL_DARK.in, SPELL_DARK.out);
  /** How deep the darkness goes: a spell's, or a summon's lighter one (SUMMON_DARK). */
  private darkLook: { readonly press: number; readonly far: number; readonly desaturation: number; readonly vignette: number } = SPELL_DARK;
  /** Real seconds left before a struck spell's darkness lifts (-1: not counting). */
  private linger = -1;
  private readonly dread = new EasedLevel(DREAD.in, DREAD.out);
  private dreadSide: Faction | null = null;
  private readonly defeat = new EasedLevel(DEFEAT.seconds, DEFEAT.seconds);
  private defeatSide: Faction | null = null;
  private defeatHue = 0;
  private defeatWidth = 0.05;
  private spareHue = 0;
  private scale = 1;
  private readonly listeners = new Set<(event: MomentEvent) => void>();
  readonly grade: MomentGrade = neutralGrade();

  /** What may be shown. The map and the menu's board drop everything at once; Reduced Motion cuts a blow to its grade. */
  setFlags(flags: Partial<MomentFlags>): void {
    const next = { ...this.flags, ...flags };
    const suppressed = (next.tactical || next.menuBoard) && !(this.flags.tactical || this.flags.menuBoard);
    const calmed = next.reducedMotion && !this.flags.reducedMotion;
    this.flags = next;
    if (suppressed) this.clearTransient();
    else if (calmed && this.plan && !this.plan.gentle) this.cutShort(CUT_SHORT);
    // The menu's board is no match: no King of it is anyone's dread.
    if (next.menuBoard) this.setCheck(null);
  }

  /** Nothing is shown on the map or the menu's board. */
  get suppressed(): boolean { return this.flags.tactical || this.flags.menuBoard; }

  /** The scene's time scale this frame (1 when no hit-stop holds). */
  get timeScale(): number { return this.scale; }
  /** True while a hit-stop holds the fight's clock. */
  get holding(): boolean { return this.scale < 1; }
  /** True while a killing blow's moment plays. */
  get active(): boolean { return this.plan !== null; }
  /** The blow playing, for browser checks. */
  get playing(): BlowPlan | null { return this.plan; }

  /**
   * The killing blow has landed, at `point` (world). Its moment begins on the next frame, one frame in. A blow while
   * another still plays takes over from it. Nothing on the map or the menu's board; the gentle form under Reduced Motion.
   */
  blow(kill: BlowKill, point: MomentPoint): BlowPlan | null {
    if (this.suppressed) return null;
    const plan = planBlow({ ...kill, gentle: kill.gentle || this.flags.reducedMotion });
    this.plan = plan; this.age = -1; this.fading = null;
    this.point = { x: point.x, y: point.y, z: point.z };
    this.emit({ type: "blow", strength: plan.strength, gentle: plan.gentle, point: { ...this.point }, accentHue: plan.accentHue, hold: plan.hold, seconds: plan.seconds });
    return plan;
  }

  /**
   * A spell's gather begins (`true`): the hall darkens; a summon's call (`summon`) darkens it less, for longer.
   * `false` lifts it now, however the spell ended.
   */
  darken(on: boolean, summon = false): void {
    if (on) {
      if (this.suppressed) return;
      this.darkLook = summon ? SUMMON_DARK : SPELL_DARK;
      if (this.dark.target !== 1) this.emit({ type: "darken", on: true });
      this.dark.target = 1; this.linger = -1;
      return;
    }
    if (this.dark.target !== 0) this.emit({ type: "darken", on: false });
    this.dark.target = 0; this.linger = -1;
  }

  /** The spell's blow has landed: its darkness lingers a moment more, then lifts. */
  struck(): void {
    if (this.dark.target === 1 && this.linger < 0) this.linger = SPELL_DARK.linger;
  }

  /**
   * The King of `side` is in check (its grade eased in), or no King is (eased out). The signal follows the game on the
   * map too (the music still hears it); only the grade is left out there. The menu's board has none.
   */
  setCheck(side: Faction | null): void {
    const next = this.flags.menuBoard ? null : side;
    if (next === this.dreadSide) return;
    this.dreadSide = next;
    this.emit({ type: "dread", side: next });
  }

  /**
   * The defeat grade: `loser`'s kingdom colour and the hall's light drained by `amount` (0 to 1), easing there over
   * `seconds`; `winner`'s colour is spared. A `null` loser (or an amount of 0) eases it away.
   */
  setDefeat(loser: { side: Faction; army: ArmySkinId } | null, winner: ArmySkinId | null, amount = 1, seconds: number = DEFEAT.seconds): void {
    const target = loser ? Math.min(1, Math.max(0, Number.isFinite(amount) ? amount : 0)) : 0;
    if (loser) {
      const accent = KINGDOM_ACCENT[loser.army];
      this.defeatSide = loser.side; this.defeatHue = accent.hue; this.defeatWidth = accent.width * DEFEAT.widen;
      this.spareHue = winner ? KINGDOM_ACCENT[winner].hue : (accent.hue + 0.5) % 1;
    }
    const span = Math.max(0, Number.isFinite(seconds) ? seconds : DEFEAT.seconds);
    if (span <= 0) this.defeat.snap(target);
    else { this.defeat.riseSeconds = this.defeat.fallSeconds = span; this.defeat.target = target; }
    this.emit({ type: "defeat", side: target > 0 ? this.defeatSide : null, amount: target });
  }

  /** The fight is being skipped: the hit-stop, the ripple, the fringe and the kick stop now; colour comes straight back. */
  hurry(): void {
    if (this.plan) this.cutShort(CUT_SHORT);
  }

  /** Skip ending: whatever a blow, a spell or a defeat left on the frame eases out quickly. */
  settle(): void {
    if (this.plan) this.cutShort(SETTLE);
    this.dark.fallSeconds = SETTLE; this.darken(false);
    if (this.defeat.target > 0 || this.defeat.raw > 0) { this.defeat.riseSeconds = this.defeat.fallSeconds = SETTLE; this.defeat.target = 0; this.emit({ type: "defeat", side: null, amount: 0 }); }
  }

  /** Undo, a new game, a rebuilt board: every moment is gone at once, the check included (the state puts it back). */
  reset(): void {
    this.clearTransient();
    this.dread.snap(0);
    if (this.dreadSide !== null) { this.dreadSide = null; this.emit({ type: "dread", side: null }); }
    if (this.defeat.raw > 0 || this.defeat.target > 0) { this.defeat.snap(0); this.emit({ type: "defeat", side: null, amount: 0 }); }
    this.defeatSide = null;
    this.emit({ type: "reset" });
  }

  /** Everything at rest and nobody listening (the engine is going). */
  dispose(): void {
    this.reset();
    this.listeners.clear();
  }

  /** Told of each moment as it begins and ends. Returns the way to stop listening. */
  onMoment(listener: (event: MomentEvent) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  /**
   * First thing every frame: moves every moment on by the frame's played delta and returns the scene's time scale for
   * the frame (the hit-stop), which the engine multiplies into every system's delta. `played` is the player's delta
   * through a replay's transport (the same as `real` in a match): a replay at its own speed plays every moment as the
   * match did, and at another speed scales them with the scene. A replay held still (`played` 0 while `real` runs) is
   * never left struck: a blow on screen eases out (black and white, ripple, fringe and kick) on the player's clock and
   * its hit-stop is let go; a blow that has not shown its first frame waits and plays whole when the replay goes on; a
   * spell's darkness and the dread hold with the scene they belong to.
   */
  advance(played: number, real: number = played): number {
    const step = Number.isFinite(played) && played > 0 ? played : 0;
    const wall = Number.isFinite(real) && real > 0 ? real : 0;
    // Held still once a blow is on screen: it eases out. One that has not shown its first frame waits for the replay
    // to go on, and plays whole.
    if (step === 0 && wall > 0 && this.plan && this.age >= 0) this.cutShort(SETTLE);
    if (this.plan && (step > 0 || this.age >= 0)) {
      // The blow landed during the frame before: by the first frame drawn after it, one frame of it has passed.
      this.age = this.age < 0 ? step : this.age + step;
      if (this.age >= this.plan.seconds) { this.plan = null; this.age = -1; this.emit({ type: "blow-end" }); }
    }
    if (this.fading) {
      // A blow cut short eases out on the scene's time, or on the player's while a replay is held still.
      this.fading.age += step > 0 ? step : wall;
      if (this.fading.age >= this.fading.seconds) this.fading = null;
    }
    if (this.linger >= 0) {
      this.linger -= step;
      if (this.linger < 0) this.darken(false);
    }
    this.dark.step(step);
    if (this.dark.resting && this.dark.target === 0) this.dark.fallSeconds = SPELL_DARK.out;
    this.dread.target = this.dreadSide && !this.suppressed ? 1 : 0;
    this.dread.step(step);
    this.defeat.step(step);
    const plan = this.plan;
    this.scale = plan && !plan.gentle && !this.flags.reducedMotion ? blowAt(plan, this.age, this.frame).timeScale : 1;
    return this.scale;
  }

  /** The lens kick for this frame, in degrees off the shot's own lens (`scale`: the lens in force over the match's rest lens). */
  lensKick(scale = 1): number {
    const plan = this.plan;
    if (!plan || plan.gentle || this.flags.reducedMotion || this.suppressed || this.age < 0) return 0;
    return blowAt(plan, this.age, this.frame).punch * scale;
  }

  /**
   * The grade for this frame, written into {@link grade} and returned: `project` puts the blow's contact point on the
   * screen as the camera sees it now (after the lens kick and the shake), `aspect` is the frame's width over its height.
   */
  compose(project: (point: MomentPoint) => MomentScreen, aspect: number): MomentGrade {
    const g = neutralGrade(this.grade);
    g.aspect = aspect > 0 && Number.isFinite(aspect) ? aspect : 16 / 9;
    if (this.suppressed) return g;
    const dread = this.dread.value, dark = this.dark.value, defeat = this.defeat.value;
    // Colour and the vignette add up as each takes its share of what is left.
    const look = this.darkLook;
    let desaturation = 1 - (1 - DREAD.desaturation * dread) * (1 - look.desaturation * dark);
    let vignette = 1 - (1 - DREAD.vignette * dread) * (1 - look.vignette * dark) * (1 - DEFEAT.vignette * defeat);
    g.darkness = look.press * dark;
    g.far = look.far * dark;
    g.light = 1 - DEFEAT.light * defeat;
    if (defeat > 0) { g.drain = defeat; g.drainHue = this.defeatHue; g.drainWidth = this.defeatWidth; g.spareHue = this.spareHue; }
    const plan = this.plan;
    if (plan && this.age >= 0) {
      const f = blowAt(plan, this.age, this.frame);
      const calm = plan.gentle || this.flags.reducedMotion;
      const at = project(this.point);
      const onScreen = !at.behind && Number.isFinite(at.x) && Number.isFinite(at.y);
      g.centreX = onScreen ? Math.min(1.5, Math.max(-0.5, at.x)) : 0.5;
      g.centreY = onScreen ? Math.min(1.5, Math.max(-0.5, at.y)) : 0.5;
      g.mono = f.mono;
      g.sweep = sweepFront(calm ? 1 : f.sweep, g.centreX, g.centreY, g.aspect);
      g.accentHue = plan.accentHue; g.accentWidth = plan.accentWidth;
      if (!calm) {
        // Off screen, the contact point cannot centre a ripple or a fringe: the frame is still struck black and white.
        g.waveRadius = f.waveRadius; g.waveWidth = Math.max(1e-3, f.waveWidth); g.waveAmplitude = onScreen ? f.waveAmplitude : 0;
        g.aberration = onScreen ? f.aberration : 0;
      }
      vignette = 1 - (1 - vignette) * (1 - f.vignette);
    } else if (this.fading && this.plan === null) {
      const left = 1 - smooth(this.fading.age / this.fading.seconds);
      g.mono = this.fading.from * left;
      g.sweep = sweepFront(1, 0.5, 0.5, g.aspect);
      g.accentHue = this.fadingHue; g.accentWidth = this.fadingWidth;
      vignette = 1 - (1 - vignette) * (1 - this.fading.vignette * left);
    }
    g.desaturation = desaturation;
    g.vignette = vignette;
    g.on = !gradeIsNeutral(g);
    return g;
  }

  /** The moments now, as one read (see {@link MomentSignals}). */
  get signals(): MomentSignals {
    const plan = this.plan;
    const frame = plan && this.age >= 0 ? blowAt(plan, this.age, blankFrame()) : null;
    return {
      timeScale: this.scale, holding: this.scale < 1,
      blow: plan ? { strength: plan.strength, seconds: Math.max(0, this.age), mono: frame?.mono ?? 0, gentle: plan.gentle, point: { ...this.point } } : null,
      darkness: this.suppressed ? 0 : this.dark.value,
      dread: { side: this.dreadSide, level: this.suppressed ? 0 : this.dread.value },
      defeat: { side: this.defeat.target > 0 || this.defeat.raw > 0 ? this.defeatSide : null, amount: this.suppressed ? 0 : this.defeat.value },
    };
  }

  private fadingHue = 0;
  private fadingWidth = 0.05;

  /** The blow stops where it is: no more time, ripple, fringe or kick; its black and white eases out over `seconds`. */
  private cutShort(seconds: number): void {
    const plan = this.plan;
    if (!plan) return;
    const f = this.age >= 0 ? blowAt(plan, this.age, blankFrame()) : null;
    const from = f?.mono ?? 0;
    this.fadingHue = plan.accentHue; this.fadingWidth = plan.accentWidth;
    this.fading = from > 0 ? { from, vignette: f?.vignette ?? 0, age: 0, seconds } : null;
    this.plan = null; this.age = -1; this.scale = 1;
    this.emit({ type: "blow-end" });
  }

  /** The blow, its fade and a spell's darkness gone at once. */
  private clearTransient(): void {
    const had = this.plan !== null;
    this.plan = null; this.age = -1; this.fading = null; this.scale = 1;
    this.dark.snap(0); this.dark.fallSeconds = SPELL_DARK.out; this.linger = -1;
    if (had) this.emit({ type: "blow-end" });
  }

  private emit(event: MomentEvent): void {
    for (const listener of [...this.listeners]) {
      try { listener(event); } catch (error) { console.warn("[moments] a listener failed", error); }
    }
  }
}
