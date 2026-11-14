/**
 * The scene's gore: the one object sceneEngine.ts talks to.
 *
 *   const gore = new GoreSystem({ quality, intensity });
 *   scene.add(gore.root);
 *   gore.begin(event, { wound: torsoBone, weapon: spearSocket });   // at the decisive contact
 *   gore.land(impactId, bodyPoint);                                 // with the gore sound, as the body lands
 *   gore.bodyGone(impactId);                                        // banish
 *   gore.update(delta);                                             // every frame, the fight's own delta
 *   gore.undoTo(ply); gore.reset(); gore.dispose();
 *
 * It owns the shared GPU resources (one droplet mesh, one decal mesh, a small
 * pool of wound quads, the figures' wound masks) and the {@link GoreLedger} that
 * says what appears when. All of it is created once per quality preset and freed
 * on dispose.
 *
 * Every wound any source opens (a duel's blow, a spell's ice, a summon's bite or
 * tearing, a ball) comes through {@link GoreSystem.wound}, the one place a body is
 * wounded: it is painted into the defender's own wound mask (WoundMasks.ts) where
 * the figure can wear one, and drawn as a decal or a quad on the bone only where
 * it cannot.
 */
import * as THREE from "three";
import { BloodDecals } from "./BloodDecals";
import { BloodFlow } from "./BloodFlow";
import { BloodParticles, type ParticleBackend } from "./BloodParticles";
import { DEFAULT_BOARD } from "./GoreDirector";
import { GoreLedger, type GoreSink } from "./GoreLedger";
import { GORE_CAPACITY } from "./GoreQuality";
import { DEFAULT_GORE_INTENSITY, type GoreEvent, type GoreIntensity, type GorePlan, type PoolPlan, type SplashPlan, type SprayPlan, type StainPlan, type WeaponStainPlan, type WoundPlan } from "./GoreTypes";
import { splashDecal, weaponDecal, woundDecal } from "./SurfaceDecals";
import { WoundMasks, asWoundBody, type WoundBody, type WoundMaskStats } from "./WoundMasks";
import { WoundRenderer } from "./WoundRenderer";
import type { QualityPreset } from "../quality";

export interface GoreBindings {
  /** The defender's anchor bone (torso): the wound rides on it. */
  wound?: THREE.Object3D | null;
  /** The attacker's weapon socket (spearhead): the weapon stain rides on it. */
  weapon?: THREE.Object3D | null;
  /** The defender's figure: its skinned meshes take the skin-bound wound. Without it the wound is a quad on the bone. */
  defender?: THREE.Object3D | null;
  /** The attacker's figure: its skinned armour takes the splashes thrown back at it. */
  attacker?: THREE.Object3D | null;
  /** World direction marks on the weapon should face (towards the camera). Default: up. */
  facing?: { x: number; y: number; z: number };
}

export interface GoreSystemOptions {
  quality: QualityPreset;
  intensity?: GoreIntensity;
  board?: { top?: number; tile?: number };
  /** A different droplet renderer (for instance one built on three.quarks). */
  particles?: (capacity: number) => ParticleBackend;
  /** The renderer that paints the figures' wound masks. Without it every wound is a decal or a quad on the bone. */
  renderer?: THREE.WebGLRenderer;
  /** The figure a defender's object stands for, if it can wear a wound mask. Default: its `userData.piece`. */
  bodyOf?: (figure: THREE.Object3D) => WoundBody | null;
}

/** `GoreEvent` without what the system already knows. */
export type GoreEventInput = Omit<GoreEvent, "quality" | "intensity" | "board"> & Partial<Pick<GoreEvent, "quality" | "intensity" | "board">>;

export class GoreSystem implements GoreSink {
  readonly root = new THREE.Group();
  readonly ledger: GoreLedger;
  private quality: QualityPreset;
  private level: GoreIntensity;
  private readonly board: { top: number; tile: number };
  private readonly makeParticles: (capacity: number) => ParticleBackend;
  private particles!: ParticleBackend;
  private decals!: BloodDecals;
  private wounds!: WoundRenderer;
  private flow!: BloodFlow;
  private masks: WoundMasks | null = null;
  private readonly renderer: THREE.WebGLRenderer | null;
  private readonly bodyOf: (figure: THREE.Object3D) => WoundBody | null;
  private bindings: GoreBindings | null = null;
  /** Bindings kept for splashes that land a moment after the contact. Dropped with the impact. */
  private readonly splashBindings = new Map<string, GoreBindings>();
  private tactical = false;
  private readonly tip = new THREE.Vector3();
  private disposed = false;

  constructor(options: GoreSystemOptions) {
    this.root.name = "gore";
    this.quality = options.quality;
    this.level = options.intensity ?? DEFAULT_GORE_INTENSITY;
    this.board = { top: options.board?.top ?? DEFAULT_BOARD.top, tile: options.board?.tile ?? DEFAULT_BOARD.tile };
    this.makeParticles = options.particles ?? (capacity => new BloodParticles(capacity));
    this.renderer = options.renderer ?? null;
    this.bodyOf = options.bodyOf ?? (figure => asWoundBody(figure.userData.piece));
    this.ledger = new GoreLedger(this);
    this.build();
  }

  get intensity(): GoreIntensity { return this.level; }
  /** Applies to captures from now on; what is already on the board stays. */
  setIntensity(intensity: GoreIntensity): void { this.level = intensity; }

  /** New pool sizes. Blood on the board is dropped: the engine rebuilds its pieces on the same call. */
  setQuality(quality: QualityPreset): void {
    if (quality === this.quality || this.disposed) return;
    this.quality = quality;
    this.ledger.reset();
    this.teardown();
    this.build();
  }

  /** Tactical view shows stains only: droplets, wounds and weapon stains are hidden while it is on. */
  setTactical(active: boolean): void {
    this.tactical = active;
    if (active) this.particles.object.visible = false;
  }

  /** Scene light for the unlit parts (droplets and wounds). Stains are lit by the scene itself. */
  setLight(color: THREE.ColorRepresentation, level = 1): void {
    if (this.particles instanceof BloodParticles) this.particles.setLight(color, level);
    this.wounds.setLight(color, level);
  }

  /**
   * Builds the programs of what a capture first shows before any capture, as the arena draws them (`compile`, the
   * arena's: see SceneEngine.warmEffects): the stains, the droplets, the wound marks on a bone and on the skin, and the
   * wound masks' bake and dilation. The stains are a lit material, and with the arena's lights its program took
   * seconds to build: built on the frame of the first kill, that was a freeze of three seconds and more. Resolves once
   * the driver has them. A quality change makes new materials, to be warmed again.
   */
  warm(compile: (object: THREE.Object3D) => Promise<unknown>): Promise<unknown> {
    if (this.disposed) return Promise.resolve();
    const masks = this.masks?.warm();
    const marks = this.wounds.warmers();
    try { return Promise.all([compile(this.root), compile(marks.object), masks]); } finally { marks.release(); }
  }

  /** The contact has happened. Returns the plan (empty, with `silent` set, when nothing is shown). */
  begin(event: GoreEventInput, bindings: GoreBindings = {}): GorePlan {
    this.bindings = bindings;
    try {
      const plan = this.ledger.begin({ ...event, quality: event.quality ?? this.quality, intensity: event.intensity ?? this.level, board: event.board ?? this.board });
      if (plan.splashes.some(splash => splash.at > 0) && this.ledger.has(plan.impactId)) this.splashBindings.set(plan.impactId, bindings);
      return plan;
    } finally { this.bindings = null; }
  }

  land(impactId: string, at?: { x: number; z: number }): void { this.ledger.land(impactId, at); }
  bodyGone(impactId: string): void { this.ledger.bodyGone(impactId); }
  undoTo(ply: number): void { this.ledger.undoTo(ply); }
  /** The fight was cancelled before it finished: its blood goes with it. */
  cancel(impactId: string): void { this.ledger.cancel(impactId); }
  /** The figures are about to be rebuilt: take every wound, mask and weapon stain off them first. Blood on the board stays. */
  releaseFigures(): void { this.wounds.clear(); this.masks?.clear(); this.splashBindings.clear(); }
  reset(): void { this.ledger.reset(); }

  update(delta: number): void {
    if (this.disposed) return;
    this.ledger.update(delta);
    this.particles.update(delta);
    if (this.tactical) this.particles.object.visible = false;
    this.decals.update(delta);
    this.wounds.update(delta);
    // Wounds opened since the last frame are painted into their figures' masks now, before the frame is drawn.
    this.masks?.update(delta);
  }

  dispose(): void {
    if (this.disposed) return;
    this.ledger.dispose();
    this.teardown();
    this.root.removeFromParent();
    this.disposed = true;
  }

  /** Counts for diagnostics and browser checks. */
  get stats(): { impacts: number; decals: number; wounds: number; surfaceDecals: number; pending: boolean; masks: WoundMaskStats | null } {
    return { impacts: this.ledger.plans.length, decals: this.decals.buffer.count, wounds: this.wounds.live, surfaceDecals: this.wounds.decals, pending: this.ledger.pending, masks: this.masks?.stats ?? null };
  }

  /** What the last decals were laid on (or that they found nothing, or a wound went into a mask), for browser checks. The newest sixteen. */
  readonly decalReport: { what: string; vertices: number; on: string; ms: number }[] = [];
  private note(what: string, mesh: THREE.Mesh | null, ms: number): void {
    if (this.decalReport.length >= 16) this.decalReport.shift();
    this.decalReport.push({ what, vertices: mesh ? mesh.geometry.getAttribute("position").count : 0, on: mesh?.parent?.name || mesh?.parent?.type || "", ms: Math.round(ms * 10) / 10 });
  }

  // ---- GoreSink: called by the ledger at each planned moment.

  spray(_plan: GorePlan, spray: SprayPlan): void { if (!this.tactical) this.flow.release(spray); }

  stain(plan: GorePlan, stain: StainPlan): void {
    this.decals.add(plan.impactId, {
      kind: 0, x: stain.x, z: stain.z, radius: stain.radius, rotation: stain.rotation,
      shape: stain.shape, stretch: stain.stretch, grow: 0, grooveBias: 0,
    });
  }

  wound(plan: GorePlan, wound: WoundPlan): void {
    if (this.tactical) return;
    // Into the figure's own wound mask where it can wear one: on the body itself, through every pose, kept with the figure.
    const figure = this.bindings?.defender, body = figure ? this.bodyOf(figure) : null;
    if (wound.mask && body && this.masks) {
      const started = Date.now();
      if (this.masks.open(plan.impactId, body, this.bindings?.wound ?? null, wound)) { this.note("wound.mask", null, Date.now() - started); return; }
    }
    // Skin-bound where the body takes it: the wound conforms to the surface and bends with it.
    const defender = wound.bind === "skin" ? this.bindings?.defender : null;
    if (defender) {
      try {
        const started = Date.now();
        const decal = woundDecal(defender, { point: wound.point, normal: wound.normal, size: wound.size, wound: true });
        this.note("wound", decal, Date.now() - started);
        if (decal) { this.wounds.adopt(plan.impactId, "wound", decal, { shape: wound.shape, bleed: wound.bleed, splash: false }); return; }
      } catch (error) { console.warn("[gore] skin-bound wound failed; using the bone quad", error); }
    }
    this.wounds.attach(plan.impactId, "wound", this.bindings?.wound ?? null, wound.point, wound.normal, { size: wound.size, shape: wound.shape, bleed: wound.bleed });
  }

  woundRun(plan: GorePlan, _wound: WoundPlan, index: number): void {
    if (!this.tactical) this.masks?.run(plan.impactId, index);
  }

  // ---- A severed limb's stump (death/sever SeverSystem, through GibBlood): straight into the figure's own mask.

  stumpWound(impactId: string, body: WoundBody, anchor: THREE.Object3D, wound: WoundPlan): boolean {
    if (this.tactical || !this.masks || !wound.mask) return false;
    const started = Date.now();
    const opened = this.masks.open(impactId, body, anchor, wound);
    if (opened) this.note("stump.mask", null, Date.now() - started);
    return opened;
  }

  stumpRun(impactId: string, index: number): void { if (!this.tactical) this.masks?.run(impactId, index); }

  /** Where a figure's wound painted into its mask is now (world), and the way out of it: false where it wears none. */
  woundOf(body: WoundBody, point: THREE.Vector3, normal: THREE.Vector3): boolean { return this.masks?.woundOf(body, point, normal) ?? false; }

  splash(plan: GorePlan, splash: SplashPlan): void {
    const bindings = this.splashBindings.get(plan.impactId) ?? this.bindings;
    if (this.tactical || !bindings) return;
    try {
      const started = Date.now();
      const mesh = splash.target === "weapon"
        ? bindings.weapon ? weaponDecal(bindings.weapon, splash.along, splash.size, bindings.facing ?? { x: 0, y: 1, z: 0 }) : null
        : bindings.attacker && plan.wound ? splashDecal(bindings.attacker, plan.wound.point, splash.direction, splash.size, this.board.tile * 1.4) : null;
      this.note(`splash.${splash.target}`, mesh, Date.now() - started);
      if (mesh) this.wounds.adopt(plan.impactId, "weapon", mesh, { shape: splash.shape, bleed: 0, splash: true });
    } catch (error) { console.warn("[gore] splash decal failed", error); }
  }

  weaponStain(plan: GorePlan, stain: WeaponStainPlan): void {
    // Without a socket there is nothing for it to ride on: a smear hanging in the air is worse than none.
    const socket = this.bindings?.weapon;
    // The plain smear is the fallback: a decal already lies on the weapon where the preset allows one.
    if (this.tactical || !socket || this.wounds.has(plan.impactId, "weapon")) return;
    socket.updateWorldMatrix(true, false);
    this.wounds.attach(plan.impactId, "weapon", socket, this.tip.setFromMatrixPosition(socket.matrixWorld), { x: 0, y: 0, z: 1 }, { size: stain.size, shape: stain.shape, bleed: 0 });
  }

  pool(plan: GorePlan, pool: PoolPlan, at: { x: number; z: number }): void { this.flow.pool(plan.impactId, pool, at); }
  /** Banished: a decal or quad leaves with the body now. A mask stays on the figure until it is gone (PieceView.resetPose). */
  releaseBody(impactId: string): void { this.wounds.release(impactId, "wound"); }
  releaseWeapon(impactId: string): void { this.wounds.release(impactId, "weapon", true); }

  remove(impactId: string): void {
    this.splashBindings.delete(impactId);
    this.decals.removeImpact(impactId);
    this.wounds.release(impactId);
    // Its strokes come out of the mask: painted again from the impacts that stay, or gone with the last of them.
    this.masks?.release(impactId);
    // Droplets live for under a second: an Undo simply empties the air.
    this.particles.clear();
  }

  clear(): void {
    this.splashBindings.clear();
    this.decals.clear();
    this.wounds.clear();
    this.masks?.clear();
    this.particles.clear();
  }

  private build(): void {
    const capacity = GORE_CAPACITY[this.quality];
    this.particles = this.makeParticles(capacity.particles);
    this.decals = new BloodDecals(capacity.decals, this.board);
    this.wounds = new WoundRenderer(capacity.wounds, this.root);
    this.flow = new BloodFlow(this.particles, this.decals, this.board.top);
    this.masks = this.renderer ? new WoundMasks(this.renderer, this.quality) : null;
    this.root.add(this.decals.object, this.particles.object);
  }

  private teardown(): void {
    this.particles.dispose();
    this.decals.dispose();
    this.wounds.dispose();
    this.masks?.dispose();
    this.masks = null;
  }
}
