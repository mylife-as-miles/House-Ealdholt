/**
 * The flourishes of a kill, together: the one object the scene owns for them (flourishPlan.ts says what they are).
 *
 * - **Arcs** (arcs.ts): the crescent of light a killing swing leaves along the real blade, and a summon's strike.
 * - **Shards** (sparks.ts, chips.ts): glinting flakes and dark chips of stone thrown by a kill or a spell's blow.
 * - **Glyphs** (glyphs.ts): the kingdom's sigil stamped in the air where a spell or a summon strikes, with its starburst.
 * - **Gathers** (gather.ts): ribbons spiralling in to a caster's hand as it gathers, with little arcs for Kwind-09.
 *
 * Everything is allocated for the quality preset when the scene is made, and again only when the preset changes;
 * a frame and a spawn write into what is there. The scene decides when flourishes may be drawn at all (flourishAllowed:
 * none under reduced motion, on the tactical map or on the menu's background board) and clears them whenever the board
 * is rebuilt (Undo, a new game, a new army).
 *
 * `timeScale` multiplies every second given to update (1 is normal time, 0 holds them still). The scene's own time
 * scale (a killing blow's hit-stop, a fatality's slow motion, a replay's transport) already reaches them through the
 * frame's delta, so they hang with the blow without it.
 *
 * What a killing blow throws (its arc, its shards, its sigil, its fire) may be given the blow's accent `hue` (turns, as
 * moments/momentPlan.ts blowAccent gives it): its kept colour is then that hue (flourishPlan.ts keptLook), so it burns
 * through the blow's black and white in the attacker's colour.
 */
import * as THREE from "three";
import type { QualityPreset } from "../../quality";
import type { VfxArmy } from "../wiring";
import { sequence } from "../spells/shared/particlePlan";
import { LightArcs, type ArcSampler } from "./arcs";
import { ChipPool } from "./chips";
import { FLOURISH_BUDGET, FLOURISH_LOOK, keptLook, type FlourishBudget, type FlourishLook } from "./flourishPlan";
import { GatherRibbons, type HandSampler } from "./gather";
import { GLYPH, glyphCentre, planStarburst, type GlyphPlane } from "./glyphPlan";
import { GlyphBursts } from "./glyphs";
import { SPARK_KIND, blankShard, planFlare, planShatter, planSmear, smearsDue, type ShardSpec } from "./shardPlan";
import { SparkPool } from "./sparks";

export type { ArcSampler } from "./arcs";
export { weaponEdge } from "./arcs";
export type { HandSampler } from "./gather";

/** What is alive, for browser checks: all zero once a board is rebuilt, and once the Claiming has had its beat. */
export interface FlourishStats {
  arcs: number;
  sparks: number;
  chips: number;
  glyphs: number;
  gathers: number;
  budget: FlourishBudget;
}

/** A summon's blow, as {@link CombatFlourish.slash} sweeps it. */
export interface SlashShape {
  /** The circle the virtual blade's tip runs round, how deep its body is, how far it sweeps (radians) and how fast. */
  radius: number;
  thickness: number;
  sweep: number;
  seconds: number;
}

type Point = { x: number; y: number; z: number };

/** A body being watched for smears: where it was, how fast it is going (smoothed), and what it still owes. */
interface Smear {
  id: string | null;
  sample: HandSampler | null;
  colour: number;
  dice: () => number;
  last: THREE.Vector3;
  velocity: THREE.Vector3;
  seen: boolean;
  owed: number;
  /** Seconds it has been watched: a watch nobody ended (a fight cut short without a rebuilt board) ends by itself. */
  age: number;
}

/** The longest a body is watched for smears: a lunge is over well inside it. */
const SMEAR_WATCH = 4;

export class CombatFlourish {
  readonly object = new THREE.Group();
  /** Multiplies every second given to update (a hit-stop's hook): 1 normal, 0 held still. */
  timeScale = 1;
  private preset: QualityPreset;
  private budget: FlourishBudget;
  private sparks!: SparkPool;
  private chips!: ChipPool;
  private arcs!: LightArcs;
  private glyphs!: GlyphBursts;
  private gather!: GatherRibbons;
  private readonly spec: ShardSpec = blankShard();
  private readonly plane: GlyphPlane = { centre: { x: 0, y: 0, z: 0 }, right: { x: 1, y: 0, z: 0 }, up: { x: 0, y: 1, z: 0 }, out: { x: 0, y: 0, z: 1 } };
  private readonly centre = new THREE.Vector3();
  private readonly point = { x: 0, y: 0, z: 0 };
  private readonly route = (spec: ShardSpec) => { if (spec.kind === SPARK_KIND.chip) this.chips.spawn(spec); else this.sparks.spawn(spec); };
  private readonly smears: Smear[] = [0, 1].map(() => ({ id: null, sample: null, colour: 0xffffff, dice: () => 0, last: new THREE.Vector3(), velocity: new THREE.Vector3(), seen: false, owed: 0, age: 0 }));
  private readonly here = new THREE.Vector3();
  private readonly due = { now: 0, owed: 0 };
  private readonly mixed = new THREE.Color();
  private readonly white = new THREE.Color(0xffffff);
  private disposed = false;
  private readonly floor: number;
  /** Each kingdom's look on each accent it has struck with (a handful at most), made once. */
  private readonly kept = new Map<string, FlourishLook>();

  constructor(options: { quality: QualityPreset; boardTop: number }) {
    this.object.name = "CombatFlourish";
    this.preset = options.quality;
    this.budget = FLOURISH_BUDGET[options.quality];
    this.floor = options.boardTop;
    this.build();
  }

  get stats(): FlourishStats {
    return { arcs: this.arcs.active, sparks: this.sparks.active, chips: this.chips.active, glyphs: this.glyphs.active, gathers: this.gather.active, budget: this.budget };
  }

  // ------------------------------------------------------------------ arcs

  /**
   * Starts tracing a killer's blade (unseen until {@link revealArc}), in its kingdom's colours. `scale` thickens the arc
   * for a giant's blade (a summoned colossus): 1 for a figure of the board, at most 3. `hue` is its blow's accent.
   */
  beginArc(id: string, sample: ArcSampler, army: VfxArmy, seed: number, scale = 1, hue?: number): boolean {
    return !this.disposed && this.arcs.begin(id, sample, this.lookFor(army, hue), seed, scale);
  }
  /** The killing blow has landed: its arc is drawn, with the swing that brought it home. */
  revealArc(id: string): void { if (!this.disposed) this.arcs.reveal(id); }
  /** Where the blade went in: the arc thins round it, so the wound is seen. */
  clearArcAround(id: string, at: Point, radius = 0.2): void { if (!this.disposed) this.arcs.clearAround(id, this.centre.set(at.x, at.y, at.z), radius); }
  /** The fight has moved on: the blade is no longer traced, and an arc never revealed is dropped. */
  stopArc(id: string): void { if (!this.disposed) this.arcs.stop(id); }

  /**
   * A summon's killing strike: a virtual blade swept through `centre`, starting along `from` and going `toward`, drawn
   * as it sweeps and gone 0.3 s after.
   */
  slash(id: string, centre: Point, from: Point, toward: Point, army: VfxArmy, shape: SlashShape, seed: number, hue?: number): boolean {
    if (this.disposed) return false;
    return this.arcs.slash(id, new THREE.Vector3(centre.x, centre.y, centre.z), new THREE.Vector3(from.x, from.y, from.z), new THREE.Vector3(toward.x, toward.y, toward.z),
      shape.radius, shape.thickness, shape.sweep, shape.seconds, this.lookFor(army, hue), seed);
  }

  // ------------------------------------------------------------------ shards

  /**
   * A kill's flakes and chips: flakes out of `at` (the wound, a spell's impact), thrown on along `direction`; chips torn
   * up from the stone at `floor`. `power` about 1 for a Pawn or a Bishop, up to 1.75 for a Queen. Given the `eye`, none
   * is thrown toward it, across the body.
   */
  shatter(at: Point, floor: Point, direction: Point, army: VfxArmy, power: number, seed: number, eye?: Point, hue?: number): number {
    if (this.disposed) return 0;
    const look = this.lookFor(army, hue);
    const away = eye ? { x: at.x - eye.x, z: at.z - eye.z } : undefined;
    return planShatter({ at, floor, direction, away, power, flakes: this.budget.flakes, chips: this.budget.chips, look }, sequence(seed >>> 0 || 1), this.route, this.spec);
  }

  // ------------------------------------------------------------------ glyphs

  /**
   * Stamps `army`'s sigil where a spell or a summon struck: behind the victim's `chest`, away from the `eye`, upright and
   * facing it, with its starburst. `power` sizes it (a Queen's is larger).
   */
  stamp(chest: Point, eye: Point, army: VfxArmy, power: number, seed: number, hue?: number): void {
    if (this.disposed) return;
    const look = this.lookFor(army, hue);
    const radius = GLYPH.radius * (0.85 + 0.15 * Math.max(0.5, Math.min(2, power)));
    const at = glyphCentre(chest, eye, radius, this.floor, this.point);
    this.centre.set(at.x, at.y, at.z);
    this.glyphs.stamp(army, look, this.centre, radius, new THREE.Vector3(eye.x, eye.y, eye.z), this.plane);
    planStarburst(this.plane, radius, this.budget.glyphStreaks, this.budget.glyphSparks, look, sequence((seed ^ 0x51a7) >>> 0 || 1), this.route, this.spec);
  }

  /**
   * A fire spell's blow as crystalline fire: hard-edged blades of flame thrown out from behind the victim's `chest` (away
   * from the `eye`), round and up, never across the body.
   */
  flare(chest: Point, eye: Point, army: VfxArmy, power: number, seed: number, hue?: number): number {
    if (this.disposed) return 0;
    const look = this.lookFor(army, hue);
    const ax = chest.x - eye.x, az = chest.z - eye.z, l = Math.hypot(ax, az) || 1;
    this.point.x = chest.x + (ax / l) * 0.16; this.point.y = chest.y + 0.05; this.point.z = chest.z + (az / l) * 0.16;
    return planFlare(this.point, { x: ax, z: az }, this.budget.flares, power, look, sequence((seed ^ 0xf1a4e) >>> 0 || 1), this.route, this.spec);
  }

  // ------------------------------------------------------------------ gathers

  /** Ribbons spiral in to the hand `hand` gives for `seconds`, in `army`'s colours; Kwind-09's crackle with little arcs. */
  beginGather(id: string, hand: HandSampler, seconds: number, army: VfxArmy, seed: number): void {
    if (this.disposed) return;
    this.gather.begin(id, hand, seconds, FLOURISH_LOOK[army], army === "kwind", seed);
  }
  /** The spell has left the hand, or the cast was cut short. */
  endGather(id?: string): void { if (!this.disposed) this.gather.end(id); }

  // ------------------------------------------------------------------ smears

  /**
   * Watches a body (`sample` gives its chest) for a lunge: while it moves faster than a walk it sheds long, faint smears
   * behind it, as a brush leaves on very fast motion, in a pale wash of its kingdom's colour. Until {@link endSmear}, or
   * four seconds at most.
   */
  beginSmear(id: string, sample: HandSampler, army: VfxArmy, seed: number): void {
    if (this.disposed) return;
    const smear = this.smears.find(item => item.id === id) ?? this.smears.find(item => item.id === null) ?? this.smears[0];
    this.mixed.setHex(FLOURISH_LOOK[army].edge).lerp(this.white, 0.55);
    smear.id = id; smear.sample = sample; smear.colour = this.mixed.getHex(); smear.dice = sequence(seed >>> 0 || 1); smear.seen = false; smear.owed = 0; smear.age = 0; smear.velocity.set(0, 0, 0);
  }
  /** The body has struck (or the fight is over): no more smears. */
  endSmear(id?: string): void {
    for (const smear of this.smears) if (id === undefined || smear.id === id) { smear.id = null; smear.sample = null; }
  }

  // ------------------------------------------------------------------ frame

  /**
   * Advances everything by `seconds` times {@link timeScale}. Call once a frame after animation and contact IK (the arcs
   * sample the blades then). `glow` is the gain light takes in this exposure (vfxGlow), `light` the gain lit matter
   * takes (vfxLight); `height` is the drawing buffer's height in pixels.
   */
  update(seconds: number, camera: THREE.PerspectiveCamera, height: number, glow: number, light: number): void {
    if (this.disposed || !camera) return;
    const step = Number.isFinite(seconds) && seconds > 0 ? seconds * Math.max(0, Number.isFinite(this.timeScale) ? this.timeScale : 1) : 0;
    this.arcs.setGain(glow); this.sparks.setGain(glow); this.glyphs.setGain(glow); this.gather.setGain(glow); this.chips.setLight(light, glow);
    this.arcs.update(step, camera);
    for (const smear of this.smears) if (smear.id && step > 0) this.watch(smear, step);
    this.sparks.update(step, camera, height);
    this.chips.update(step);
    this.glyphs.update(step, camera);
    this.gather.update(step, camera, height);
  }

  /** A new preset: the pools are made again at its size. What was in the air goes. */
  setQuality(preset: QualityPreset): void {
    if (this.disposed || preset === this.preset) return;
    this.preset = preset; this.budget = FLOURISH_BUDGET[preset];
    this.teardown();
    this.build();
  }

  /** Everything goes at once: the board has been rebuilt (Undo, a new game, a new army), or the map or reduced motion is up. */
  clear(): void {
    if (this.disposed) return;
    this.endSmear();
    this.arcs.clear(); this.sparks.clear(); this.chips.clear(); this.glyphs.clear(); this.gather.clear();
  }

  dispose(): void {
    if (this.disposed) return;
    this.teardown();
    this.disposed = true;
    this.object.removeFromParent();
  }

  /** `army`'s look, its kept colour on a blow's accent `hue` where one is given (keptLook); made once per accent. */
  private lookFor(army: VfxArmy, hue?: number): FlourishLook {
    const look = FLOURISH_LOOK[army];
    if (hue === undefined || !Number.isFinite(hue)) return look;
    const key = `${army} ${Math.round((((hue % 1) + 1) % 1) * 3600)}`;
    let kept = this.kept.get(key);
    if (!kept) { kept = keptLook(look, hue); if (this.kept.size < 64) this.kept.set(key, kept); }
    return kept;
  }

  private watch(smear: Smear, step: number): void {
    smear.age += step;
    if (smear.age > SMEAR_WATCH) { smear.id = null; smear.sample = null; return; }
    let at: THREE.Vector3 | null = null;
    try { at = smear.sample ? smear.sample(this.here) : null; } catch { at = null; }
    if (!at || !Number.isFinite(at.x + at.y + at.z)) { smear.seen = false; return; }
    if (smear.seen) {
      // its velocity, eased over a few frames so one jerky frame does not smear
      const k = Math.min(1, step * 18);
      smear.velocity.x += ((at.x - smear.last.x) / step - smear.velocity.x) * k;
      smear.velocity.y += ((at.y - smear.last.y) / step - smear.velocity.y) * k;
      smear.velocity.z += ((at.z - smear.last.z) / step - smear.velocity.z) * k;
      const due = smearsDue(smear.velocity.length(), step, smear.owed, this.due);
      smear.owed = due.owed;
      for (let i = 0; i < due.now; i += 1) this.sparks.spawn(planSmear(at, smear.velocity, smear.colour, smear.dice, this.spec));
    }
    smear.last.copy(at); smear.seen = true;
  }

  private build(): void {
    const b = this.budget;
    this.sparks = new SparkPool(b.sparks, this.floor);
    this.chips = new ChipPool(b.chipPool, this.floor);
    this.arcs = new LightArcs(this.sparks, this.floor, { subdivide: b.arcSubdivide, sparks: b.arcSparks });
    this.glyphs = new GlyphBursts(this.floor);
    this.gather = new GatherRibbons(b.ribbons, b.ribbonSegments, b.lightning);
    this.object.add(this.chips.object, this.arcs.object, this.glyphs.object, this.gather.object, this.sparks.object);
  }

  private teardown(): void {
    this.arcs.dispose(); this.sparks.dispose(); this.chips.dispose(); this.glyphs.dispose(); this.gather.dispose();
  }
}
