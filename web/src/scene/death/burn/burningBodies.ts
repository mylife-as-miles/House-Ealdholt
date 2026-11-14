/**
 * Burning bodies: draws what burnPlan.ts plans, on the figure that a fire kill has just taken.
 *
 * It owns nothing of its own in the scene. The char is the figure's own materials (charShader.ts, through
 * `PieceView.setChar`); the flames are sprites of the flipbook's `fire` atlas (vfx/flipbook.ts), respawned at
 * the figure's bones a few times a second so they follow it as it flails; smoke, embers and the flash are the
 * scene's existing particles (effects.ts); the light on the stone is a borrowed spell light. So there is
 * nothing to build at start-up and nothing to free but the light.
 *
 * sceneEngine.ts decides when (death/deathStyle.ts), hands over the figure and waits on {@link burn} or
 * {@link fade}; `update` runs once a frame after the figures have been posed. `reset` is Undo, a new game
 * and any other rebuild of the board: every figure it held has been disposed by then, and a figure put back
 * is a new one with new materials, so nothing of a burn can reach it.
 */
import * as THREE from "three";
import { TILE } from "../../board";
import type { EffectsSystem } from "../../effects";
import type { PieceView } from "../../pieces";
import type { SpellLight } from "../../spells";
import type { FlipbookSystem } from "../../vfx/flipbook";
import type { FlipbookSpawn } from "../../vfx/flipbookCore";
import {
  CHAR_FULL,
  NATURAL_FLAME,
  charFront,
  charHeat,
  collapseClip,
  flailClips,
  flameLevel,
  flameSeats,
  flinchTimes,
  heldJolts,
  lurchAt,
  planBurn,
  type BurnInputs,
  type BurnPlan,
  type FadePlan,
  type Lurch,
} from "./burnPlan";
import type { CharState } from "./charShader";

export interface BurnHost {
  effects: EffectsSystem;
  /** The flipbook system, once the scene has one. */
  flipbook(): FlipbookSystem | null;
  /** How bright things that are light themselves are drawn in this arena (vfx/wiring.ts `vfxGlow`). */
  glow(): number;
  /** A spell light on loan, or null when the preset has none or they are all out. */
  light(colour: number, distance: number): SpellLight | null;
  /** Where the camera is: flames stand on the side of the body that faces it. */
  eye(): THREE.Vector3;
  /** The preset's particle count for a capture burst. */
  particles(): number;
}

/** What the scene does for one burn: its clock, its sounds and what only it can play. */
export interface BurnStage {
  wait(seconds: number): Promise<void>;
  /** True once the board has been rebuilt under the burn. */
  stale(): boolean;
  /** The rigid topple, for a sculpt with no death clip. */
  topple(): Promise<void>;
  /** The fire has caught. */
  ignited(): void;
  /** The figure has started to fall. */
  falling(): void;
  /** The body has reached the stone. */
  landed(): void;
}

interface Seat {
  anchor: THREE.Object3D;
  /** A point in the anchor's own space, for sculpts with no bones. */
  local: THREE.Vector3 | null;
  at: number;
  next: number;
  /** 0..1, fixed per seat: its flames' size and which way they are mirrored. */
  grain: number;
}

interface Body {
  victim: PieceView;
  plan: BurnPlan;
  clock: number;
  /** Seconds on the clock at which the body reached the stone; -1 until it has. */
  landedAt: number;
  standing: boolean;
  /** Burning in something's grip (igniteHeld): it is moved by what holds it, and only jerks as the fire bites. */
  held: boolean;
  /** From the torso to the point of impact, in world space: the fire's origin rides on the body. */
  offset: THREE.Vector3;
  seats: Seat[];
  flinches: number[];
  flinch: number;
  nextSmoke: number;
  nextEmber: number;
  light: SpellLight | null;
  emberHex: number;
  char: CharState;
  crumble: { t: number; next: number; done: () => void } | null;
}

interface Fading { victim: PieceView; t: number; seconds: number; done: () => void }

const ASH = 0x24211f;
/** The ember glow of a crack, and of the burning edge, before the arena's exposure is taken off it. */
const CRACK_GLOW = 3;
const EDGE_GLOW = 2.6;
/** The burn-away's edge as the husk crumbles: the embers' colour, held down so it stays their colour at any exposure. */
const CRUMBLE_GLOW = 0.5;
/** The fire's light stands this far above the chest: it lights the stone and the figures round it, not the char under it. */
const LIGHT_LIFT = 0.9;
const LIGHT_POWER = 2.6;
/** How bright a spell-coloured flame sprite is, against natural fire's 0.95. */
const SPELL_FLAME_LEVEL = 0.68;

export class BurningBodies {
  private readonly bodies: Body[] = [];
  private readonly fades: Fading[] = [];
  /** Figures that have already left the board here (faded, or crumbled): nothing else may clear them. */
  private gone = new WeakSet<PieceView>();
  private readonly lurch: Lurch = { x: 0, z: 0, yaw: 0, tilt: 0 };
  private readonly point = new THREE.Vector3();
  private readonly torso = new THREE.Vector3();
  private readonly push = new THREE.Vector3();
  private readonly colour = new THREE.Color();
  private readonly spec: FlipbookSpawn = { x: 0, y: 0, z: 0, size: 1 };

  constructor(private readonly host: BurnHost) {}

  /** Bodies alight or smouldering, husks crumbling and figures fading now: for browser checks (all 0 after an Undo). */
  get stats(): { burning: number; husks: number; crumbling: number; fading: number } {
    let burning = 0, husks = 0, crumbling = 0;
    for (const body of this.bodies) { if (body.crumble) crumbling += 1; else if (body.landedAt >= 0) husks += 1; else burning += 1; }
    return { burning, husks, crumbling, fading: this.fades.length };
  }

  /** Whether this figure burned or faded here: it is never hurled or swallowed. */
  owns(victim: PieceView): boolean {
    return this.gone.has(victim) || this.bodies.some(body => body.victim === victim);
  }

  /** Whether this figure lies on the board as a husk now. */
  isHusk(victim: PieceView): boolean {
    return this.bodies.some(body => body.victim === victim && !body.crumble);
  }

  /**
   * The whole burn, from the fire catching to the husk lying smouldering: ignition at the side the blast came
   * from, the stagger, the collapse, and the smoulder the plan asks for. Resolves when the square may be taken.
   */
  async burn(victim: PieceView, blow: THREE.Vector3, input: BurnInputs, stage: BurnStage): Promise<void> {
    const body = this.ignite(victim, blow, input);
    const plan = body.plan;
    const live = (): boolean => !stage.stale() && this.bodies.includes(body);
    stage.ignited();

    if (plan.flail > 0) {
      // A rig with the Pawn clip library reels from one stagger into the next; any other rig is carried by
      // the lurch and the jolts alone (update, below).
      let at = 0;
      for (const step of flailClips(plan, id => victim.combatClipInfo(id)?.duration ?? 0)) {
        if (step.at > at) { await stage.wait(step.at - at); at = step.at; }
        if (!live()) return;
        victim.playVariant(step.id, 1, 0.14);
      }
      await stage.wait(plan.flail - at);
      if (!live()) return;
    }

    // It goes down where it stands: over the burn mark, and never onto a neighbour's square.
    body.standing = false;
    victim.runtime.rotation.set(0, 0, 0);
    victim.setStrikeTilt(0);
    victim.setCombatReaction({ rootLimit: TILE * 0.25 });
    stage.falling();
    const death = victim.hasAnimations ? victim.playDeath() : 0;
    if (death <= 0) {
      await stage.topple();
    } else {
      const clip = collapseClip(id => victim.hasCombatVariant(id));
      const info = clip ? victim.combatClipInfo(clip) : null;
      let landing = Math.min(death, victim.deathPlan()?.land ?? death * 0.8);
      if (clip && info) {
        // Joined just before the knees give: the stagger was the wind-up.
        const from = Math.max(0, (info.events.hit ?? 0) - 0.2);
        victim.playVariant(clip, 1, 0.18, from);
        landing = Math.max(0.2, (info.events.land ?? info.duration * 0.85) - from);
      }
      await stage.wait(landing);
    }
    if (!live()) return;
    body.landedAt = body.clock;
    this.land(body);
    stage.landed();
    await stage.wait(plan.smoulder);
  }

  /**
   * A body set alight in something's grip (rites/rite.ts `held-burn`, a phoenix's talons): the fire catches where it
   * was taken and spreads and the skin chars as in {@link burn}, but the figure does not stagger, flail or fall here.
   * Whatever holds it moves it; it jerks in the grip as the fire bites, and its flames are left streaming behind it as
   * it is carried. Once it is down on the stone, {@link landHeld} makes it a husk like any other.
   */
  igniteHeld(victim: PieceView, blow: THREE.Vector3, input: BurnInputs): void {
    const body = this.ignite(victim, blow, { ...input, held: true });
    body.standing = false;
    body.held = true;
    body.flinches = heldJolts(body.plan);
  }

  /**
   * A body carried burning has come down on the stone: from here it smoulders as a husk, to be crumbled by
   * {@link crumble}. Returns the seconds it smoulders before the square may be taken; 0 for a figure not burning in a grip.
   */
  landHeld(victim: PieceView): number {
    const body = this.bodies.find(entry => entry.victim === victim && entry.held && !entry.crumble);
    if (!body) return 0;
    body.held = false;
    body.landedAt = body.clock;
    this.land(body);
    return body.plan.smoulder;
  }

  /**
   * The husk crumbles to ash where it lies: the surface is eaten away through its ember edge, soot and embers
   * come off it, and it is gone. It is never lifted or thrown. Resolves at once for a figure that is not a husk.
   */
  crumble(victim: PieceView): Promise<void> {
    const body = this.bodies.find(entry => entry.victim === victim && !entry.crumble);
    if (!body) return Promise.resolve();
    return new Promise(resolve => { body.crumble = { t: 0, next: 0, done: resolve }; });
  }

  /** The Minimal death: a short flash where the blow landed, and the body fades. No char, no flames, no gore. */
  fade(victim: PieceView, plan: FadePlan, colour: number): Promise<void> {
    if (plan.flash > 0) this.host.effects.spawnFlash(victim.combatPoint(this.point), plan.flash, plan.flashSeconds, colour);
    this.gone.add(victim);
    return new Promise(resolve => { this.fades.push({ victim, t: 0, seconds: Math.max(0.05, plan.fade), done: resolve }); });
  }

  update(delta: number): void {
    for (let i = this.fades.length - 1; i >= 0; i--) {
      const fade = this.fades[i];
      fade.t = Math.min(1, fade.t + delta / fade.seconds);
      fade.victim.setOpacity(1 - fade.t * fade.t * (3 - 2 * fade.t));
      // What the figure carries goes with it: the burn-away takes, in the fade's second half, whatever opacity leaves drawn.
      fade.victim.setDissolve(Math.max(0, (fade.t - 0.4) / 0.6));
      if (fade.t >= 1) { this.fades.splice(i, 1); fade.victim.setOpacity(0); fade.victim.setDissolve(1); fade.done(); }
    }
    for (let i = this.bodies.length - 1; i >= 0; i--) {
      const body = this.bodies[i];
      body.clock += delta;
      this.char(body);
      if (body.crumble) { if (this.crumbling(body, delta)) this.bodies.splice(i, 1); continue; }
      if (body.standing) this.stagger(body);
      else if (body.held) this.jolts(body, 0.5, 0.35);
      this.flames(body);
      this.smoke(body);
    }
  }

  /** Undo, a new game, a rebuilt board: every burn is dropped where it is and anything waiting on one is let go. */
  reset(): void {
    for (const body of this.bodies.splice(0)) {
      body.light?.release();
      body.victim.setChar(null);
      body.crumble?.done();
    }
    for (const fade of this.fades.splice(0)) fade.done();
    this.gone = new WeakSet();
  }

  dispose(): void {
    this.reset();
  }

  private ignite(victim: PieceView, blow: THREE.Vector3, input: BurnInputs): Body {
    // A beat that failed part-way and is finished the plain way burns the same figure again: one fire per body.
    const again = this.bodies.findIndex(entry => entry.victim === victim);
    if (again >= 0) { const [old] = this.bodies.splice(again, 1); old.light?.release(); old.crumble?.done(); }
    const plan = planBurn(input);
    const torso = victim.combatPoint(new THREE.Vector3());
    // The side of the chest the blast came in on.
    const offset = new THREE.Vector3(-blow.x, 0, -blow.z);
    if (offset.lengthSq() > 1e-8) offset.normalize().multiplyScalar(0.1);
    const origin = torso.clone().add(offset);

    const anchors: THREE.Object3D[] = [];
    const locals: (THREE.Vector3 | null)[] = [];
    victim.visual.traverse(node => { if ((node as THREE.Bone).isBone) { anchors.push(node); locals.push(null); } });
    if (anchors.length === 0) {
      // A sculpt with no skeleton: flames up its height, carried by the figure as it topples.
      for (const share of [0.1, 0.32, 0.55, 0.78, 0.95]) { anchors.push(victim.runtime); locals.push(new THREE.Vector3(0, input.height * share, 0)); }
    }
    victim.container.updateWorldMatrix(true, true);
    const points = anchors.map((anchor, i) => locals[i] ? anchor.localToWorld(locals[i]!.clone()) : anchor.getWorldPosition(new THREE.Vector3()));
    const seats = flameSeats(plan, points, origin).map((seat, n) => ({
      anchor: anchors[seat.index], local: locals[seat.index], at: seat.at, next: seat.at, grain: (n * 0.618034) % 1,
    }));

    const body: Body = {
      victim, plan, clock: 0, landedAt: -1, standing: plan.flail > 0, held: false, offset, seats,
      flinches: flinchTimes(plan), flinch: 0, nextSmoke: 0.15, nextEmber: 0.1,
      light: plan.budget.light && plan.variant === "full" ? this.host.light(this.colour.setRGB(plan.ember[0], plan.ember[1], plan.ember[2]).getHex(), 4.2) : null,
      emberHex: this.colour.setRGB(plan.ember[0], plan.ember[1], plan.ember[2]).getHex(),
      char: { origin: { x: origin.x, y: origin.y, z: origin.z }, front: 0, heat: 0, edgeGlow: 0, ember: plan.ember, time: 0, crumbleGlow: CRUMBLE_GLOW },
      crumble: null,
    };
    this.bodies.push(body);
    this.char(body);

    if (plan.variant === "full") {
      const particles = this.host.particles();
      this.host.effects.spawnFlash(origin, 1.1, 0.16, body.emberHex);
      this.host.effects.spawnBurst(origin, body.emberHex, Math.round(particles * 0.4), { speed: 1.6, life: 0.9, gravity: -0.3, radius: 0.08, size: 0.08, growth: 0.4, drag: 1.6, rise: 0.4 });
    }
    return body;
  }

  /** Where the fire's origin is this frame, and the char it has made of the body. */
  private char(body: Body): void {
    const { plan, char } = body;
    const torso = body.victim.combatPoint(this.torso);
    char.origin.x = torso.x + body.offset.x; char.origin.y = torso.y + body.offset.y; char.origin.z = torso.z + body.offset.z;
    char.front = charFront(plan, body.clock);
    const glow = this.host.glow();
    const sinceLanding = body.landedAt < 0 ? -1 : body.clock - body.landedAt;
    // The embers flare again as the husk breaks up.
    const breaking = body.crumble ? 1 + body.crumble.t : 1;
    char.heat = charHeat(plan, body.clock, sinceLanding) * CRACK_GLOW * glow * breaking;
    char.edgeGlow = plan.flicker && char.front < CHAR_FULL ? EDGE_GLOW * glow : 0;
    char.time = plan.flicker ? body.clock : 0;
    char.crumbleGlow = CRUMBLE_GLOW * glow;
    body.victim.setChar(char);
    if (body.light) {
      const level = sinceLanding < 0 ? 1 : Math.max(0, 1 - sinceLanding / Math.max(0.2, plan.smoulder));
      body.light.set(this.point.set(char.origin.x, char.origin.y + LIGHT_LIFT, char.origin.z), LIGHT_POWER * level * Math.min(1, body.clock / 0.3) * (0.82 + 0.18 * Math.sin(body.clock * 23)));
      if (level <= 0 || body.crumble) { body.light.release(); body.light = null; }
    }
  }

  /** The lurch and the jolts laid over the skeleton while the figure burns on its feet. */
  private stagger(body: Body): void {
    const { victim, plan } = body;
    const lurch = lurchAt(plan, body.clock, this.lurch);
    victim.runtime.position.x = lurch.x * TILE;
    victim.runtime.position.z = lurch.z * TILE;
    victim.runtime.rotation.y = lurch.yaw;
    victim.setStrikeTilt(lurch.tilt);
    this.jolts(body, 0.7, 0.5);
  }

  /** The jolts due by now, each from a turning side, each `base` strong and up to `spread` more. */
  private jolts(body: Body, base: number, spread: number): void {
    while (body.flinch < body.flinches.length && body.clock >= body.flinches[body.flinch]) {
      const turn = body.flinch * 2.39996 + (body.plan.seed % 628) / 100;
      body.victim.flinch(this.push.set(Math.cos(turn), 0, Math.sin(turn)), base + spread * ((body.flinch * 0.618034) % 1));
      body.flinch += 1;
    }
  }

  private flames(body: Body): void {
    const { plan } = body;
    const flipbook = this.host.flipbook();
    if (!flipbook || plan.flames <= 0) return;
    const sinceLanding = body.landedAt < 0 ? -1 : body.clock - body.landedAt;
    const glow = this.host.glow();
    const spec = this.spec;
    const tint = plan.flame ?? NATURAL_FLAME;
    // A spell's colour at the brightness of the baked fire, held under it: several of these overlap, and a tint that
    // sums past 1 turns white all over. The heart is made white on purpose instead (`mono` past 1, the plan's
    // flameHeat): a hot core with its edges in the army's colour.
    const bright = plan.flame ? SPELL_FLAME_LEVEL : 1;
    const eye = this.host.eye();
    for (const seat of body.seats) {
      if (body.clock < seat.next) continue;
      const level = flameLevel(plan, body.clock - seat.at, sinceLanding);
      // Once the husk has burnt down the seat goes out.
      if (level <= 0.03) { seat.next = Infinity; continue; }
      seat.next = body.clock + plan.budget.flameEvery * (0.85 + 0.3 * Math.random());
      const at = seat.local ? seat.anchor.localToWorld(this.point.copy(seat.local)) : seat.anchor.getWorldPosition(this.point);
      // On the side of the limb that faces the camera, so the fire is on the body and not behind it.
      this.push.set(eye.x - at.x, 0, eye.z - at.z);
      if (this.push.lengthSq() > 1e-6) at.addScaledVector(this.push.normalize(), 0.06 + 0.1 * Math.random());
      const size = plan.flameSize * level * (0.78 + 0.44 * seat.grain);
      const down = sinceLanding >= 0;
      // A flame's foot is a little under its bone on a standing figure, and on the husk once it lies.
      spec.x = at.x + (Math.random() - 0.5) * 0.06; spec.y = Math.max(0.02, at.y - size * (down ? 0.05 : 0.16)); spec.z = at.z + (Math.random() - 0.5) * 0.06;
      spec.size = size;
      spec.delay = 0; spec.fps = 24 + 10 * seat.grain; spec.life = plan.budget.flameLife;
      spec.frameOffset = Math.floor(Math.random() * 64);
      // On its feet the fire streams up off the body; on the stone it stays on the husk.
      spec.vx = 0; spec.vy = down ? 0.04 : 0.2 + 0.18 * seat.grain; spec.vz = 0;
      spec.growth = 0.3; spec.rotation = (Math.random() - 0.5) * 0.3; spec.spin = 0;
      spec.flip = Math.random() < 0.5;
      spec.alpha = 0.85;
      spec.r = tint[0] * bright * glow; spec.g = tint[1] * bright * glow; spec.b = tint[2] * bright * glow;
      spec.additive = 1; spec.fadeIn = 0.07; spec.fadeOut = plan.budget.flameLife * 0.45; spec.soft = 0.03;
      spec.mono = plan.flame ? 1 + plan.flameHeat : 0;
      flipbook.spawn("fire", spec);
    }
  }

  private smoke(body: Body): void {
    const { plan } = body;
    const { effects } = this.host;
    const down = body.landedAt >= 0;
    if (body.clock >= body.nextSmoke) {
      // Reduced motion: one slow wisp as the body goes down, and one more.
      body.nextSmoke = plan.variant === "calm" ? (down && body.clock - body.landedAt < 0.2 ? body.clock + 0.45 : Infinity) : body.clock + (down ? 0.34 : 0.26);
      if (plan.variant === "full" || down) {
        // Above the body, so the smoke stands over the char and never in front of it.
        const at = body.victim.combatPoint(this.point); at.y += down ? 0.3 : 0.45;
        effects.spawnSmoke(at, {
          count: plan.budget.smoke, radius: down ? 0.2 : 0.1, scale: down ? 0.34 : 0.3, growth: 2.3, life: down ? 1.7 : 1.3,
          speed: 0.22, rise: down ? 0.6 : 0.95, color: plan.smoke, opacity: down ? 0.4 : 0.46,
        });
      }
    }
    if (plan.variant === "full" && plan.budget.embers > 0 && body.clock >= body.nextEmber) {
      body.nextEmber = body.clock + (down ? 0.5 : 0.22);
      const at = body.victim.combatPoint(this.point);
      effects.spawnBurst(at, body.emberHex, Math.max(1, Math.round(plan.budget.embers * (down ? 0.6 : 1))), {
        speed: down ? 0.4 : 0.7, life: down ? 1.5 : 1.1, gravity: -0.5, radius: 0.22, size: 0.07, growth: 0.35, drag: 1.8, rise: down ? 0.35 : 0.5,
      });
    }
  }

  /** The body reaches the stone: what was burning on it is knocked loose. */
  private land(body: Body): void {
    body.nextSmoke = body.clock;
    if (body.plan.variant !== "full") return;
    const at = body.victim.combatPoint(this.point); at.y = Math.max(0.08, at.y);
    this.host.effects.spawnBurst(at, body.emberHex, Math.round(this.host.particles() * 0.3), { speed: 1.2, life: 1.2, gravity: 0.6, radius: 0.3, size: 0.075, growth: 0.4, drag: 1.5, rise: 0.3 });
  }

  /** One frame of the husk crumbling. True once it is gone. */
  private crumbling(body: Body, delta: number): boolean {
    const { plan, victim } = body;
    const crumble = body.crumble!;
    crumble.t = Math.min(1, crumble.t + delta / Math.max(0.05, plan.crumble));
    victim.setDissolve(crumble.t);
    if (plan.variant === "full" && crumble.t >= crumble.next) {
      crumble.next += 0.22;
      const at = victim.combatPoint(this.point); at.y = Math.max(0.12, at.y * 0.6);
      this.host.effects.spawnSmoke(at, { count: plan.budget.smoke + 1, radius: 0.3, scale: 0.42, growth: 2.1, life: 1.3, speed: 0.4, rise: 0.3, color: ASH, opacity: 0.45 });
      this.host.effects.spawnBurst(at, body.emberHex, Math.max(3, Math.round(this.host.particles() * 0.16)), { speed: 0.45, life: 1.5, gravity: -0.45, radius: 0.3, size: 0.08, growth: 0.32, drag: 1.8, rise: 0.35 });
    }
    if (crumble.t < 1) return false;
    victim.setDissolve(1);
    victim.setOpacity(0);
    this.gone.add(victim);
    crumble.done();
    return true;
  }
}
