/**
 * Solforiz's summon: the Queen calls a phoenix, a god of fire and sun, as a rite the match can play (rites/rite.ts).
 *
 * A thread of fire climbs from her raised hand into the sky, two pens write a seal of fire there and it flares, and
 * the phoenix bursts through it: a raptor of fire eighteen units across the wings, with a fanned tail and long
 * streamers, a hooked beak and white-hot eyes, wings and tail ablaze and trailing fire and soot. It cries, banks down
 * out of the sky on slow heavy beats and swoops on the victim with its legs thrown forward; its talons close on the
 * piece, and it carries it up, beating hard, and hovers over the board while the body burns in its grip (`death` is
 * "held-burn": the match sets the body alight and keeps it where `hold` says, between the talons). It lets go, and the
 * charred body falls back onto its own square, where fire runs out round it on the stone; the bird rears upright,
 * folds into its own light and is a small sun over the board, with a star struck through it, two halos, a shock ring
 * and embers raining down; and it gutters out before the board's own camera comes back.
 *
 * There is no model: the bird is drawn in code (phoenixForm.ts lays it out, plumes.ts and body.ts burn it). The
 * flight, the moments and everything loose are pure arithmetic with node tests (phoenixFlight.ts, phoenixPlan.ts;
 * shared/play/rite-phoenix*.test.ts); this file only hands them to the drawing and to the match.
 *
 * What each tier draws:
 *
 * | tier   | feathers a wing (+ coverts) | tail: fan, streamers | cuts a feather | embers, sparks, rain | flames on the bird, fire shed, soot | halo pass |
 * |--------|-----------------------------|----------------------|----------------|----------------------|-------------------------------------|-----------|
 * | low    | 18 (+6)                     | 6, 4                 | 6              | 140, 60, 60          | 40, 70, 24                          | 1         |
 * | medium | 22 (+14)                    | 8, 5                 | 8              | 260, 110, 120        | 72, 130, 44                         | 0.7       |
 * | high   | 26 (+18)                    | 10, 6                | 10             | 400, 170, 180        | 104, 200, 64                        | 0.6       |
 * | ultra  | 30 (+22)                    | 12, 7                | 12             | 560, 230, 240        | 136, 280, 90                        | 0.55      |
 *
 * (PHOENIX_BUDGET in phoenixForm.ts.) About twenty-five draws at the most, fewer at any one moment: what is not
 * happening is hidden. The lowest tier lends no light, so every glow is drawn: a halo pass under every flame, a
 * glow round the body, and the bird's and the sun's light laid on the board as a pool. The flames on the bird, the
 * fire it sheds and its soot are the game's flipbook atlases (flamePlan.ts, flames.ts), each loaded once a page;
 * `ready` waits for them.
 *
 * Every layer of the bird, the seal and the sun burns over a dark body of embers that covers part of what is behind
 * it, and the solid part of each writes depth. How much it covers, how deep the fire burns and how much glow is
 * added round it follow how the match shows the frame (`uDay`, read off the gain it sets: vfxGlow is about 1 where the
 * 360 arenas show it, and about a third at the baked fallback's exposure of 5). Against the bright 360 skies the bird is a blaze on a
 * dark core, and the arenas' grade, which treats every pixel without depth as sky, treats it as a thing in front of
 * the sky; in a dark hall the cover is lost in the dark and the fire is light.
 */
import * as THREE from "three";
import type { Point } from "../../vfx/mystic/beamPlan";
import { ParticlePool } from "../../vfx/spells/shared/particles";
import type { RiteCast, RiteEffect, RiteEntry, RiteSound, RiteState } from "../rite";
import { PhoenixBody } from "./body";
import { phoenixFlames } from "./flamePlan";
import { PhoenixFlames } from "./flames";
import { PhoenixModel } from "./model";
import { modelFlames, type ModelFlame } from "./modelRig";
import { sequence } from "../../vfx/spells/shared/particlePlan";
import { cutUniforms, fireColours, fireUniforms } from "./fire";
import { moveStrike, phoenixEvents, phoenixPosition, phoenixVelocity, phoenixShotAt, phoenixShots, phoenixWingbeats, planPhoenix, type PhoenixEvent, type PhoenixPlan, type PhoenixShot } from "./phoenixFlight";
import { PHOENIX_BUDGET, emptyPose, lockTalons, phoenixPose, plumeBuffers, plumeLayout, writePlumes, type PlumeAnchors, type PlumeBuffers, type PlumeLayout } from "./phoenixForm";
import { phoenixMoment, phoenixParticles, sealPoint } from "./phoenixPlan";
import { PhoenixPlumes } from "./plumes";
import { PhoenixSealMark } from "./seal";
import { PhoenixSun } from "./sun";
import { PhoenixWash } from "./wash";

/** How far the light the rite borrows reaches. The match fixes it at the first ask, so it is the sun's from the start. */
const GLOW_REACH = 12;

const point = (v: THREE.Vector3): Point => ({ x: v.x, y: v.y, z: v.z });

class PhoenixRiteEffect implements RiteEffect {
  readonly object = new THREE.Group();
  readonly death = "held-burn" as const;
  readonly ready: Promise<void>;
  readonly strikeAt: number;
  readonly duration: number;
  private readonly plan: PhoenixPlan;
  private readonly beats: ReturnType<typeof phoenixWingbeats>;
  private readonly events: PhoenixEvent[];
  private shots: PhoenixShot[];
  private readonly layout: PlumeLayout;
  private readonly buffers: PlumeBuffers;
  private readonly scratch: { points: Float32Array; profile: Float32Array };
  private readonly pose = emptyPose();
  private readonly anchors: PlumeAnchors;
  private readonly shared: Record<string, THREE.IUniform>;
  private readonly plumes: PhoenixPlumes;
  private readonly body: PhoenixBody;
  private readonly seal: PhoenixSealMark;
  private readonly sun: PhoenixSun;
  private readonly wash: PhoenixWash;
  private readonly flames: PhoenixFlames;
  /** The bird itself, the rigged model; the bird drawn in code (plumes, body) stands in for it if it cannot be had. */
  private readonly model: PhoenixModel;
  private onModel = false;
  private modelFlames: ModelFlame[] = [];
  private readonly light: ParticlePool;
  private readonly smoke: ParticlePool;
  private readonly hand = new THREE.Vector3();
  private readonly chest = new THREE.Vector3();
  private readonly glowAt = new THREE.Vector3();
  private readonly state: RiteState;
  private readonly glow: { position: Point; colour: number; intensity: number; reach: number };
  private readonly hold: { position: Point; up: Point; forward: Point };
  private seconds = 0;
  private readonly velocity = { x: 0, y: 0, z: 0 };
  private readonly stream = [0, 1, 0];
  private readonly socketAt = new THREE.Vector3();

  constructor(private readonly cast: RiteCast) {
    const budget = PHOENIX_BUDGET[cast.quality];
    cast.chest(this.chest); cast.hand(this.hand);
    this.plan = planPhoenix({
      queen: cast.queen, chest: point(this.chest), stone: cast.stone, standing: cast.standing, viewer: cast.viewer,
      boardTop: cast.boardTop, tile: cast.tile, hall: cast.hall, seed: cast.seed, brief: cast.brief,
    });
    const plan = this.plan, T = plan.timeline;
    this.strikeAt = T.strikeAt; this.duration = T.duration;
    this.beats = phoenixWingbeats(T);
    // The talons close exactly on the chest: the strike is moved to where the posed bird's talons fall.
    lockTalons(plan, this.beats);
    this.events = phoenixEvents(plan);
    this.shots = phoenixShots(plan, cast.queen);

    // One set of uniforms every layer reads: the fire's four temperatures, the clock, the gain, the seal's cut.
    const { normal, centre, radius } = plan.seal;
    // uDay: how the match shows the frame, read off the gain (vfxGlow: 1 in the 360 arenas, about a third at the baked fallback's exposure of 5).
    this.shared = { ...fireUniforms(cast.look), ...cutUniforms(), uTime: { value: 0 }, uGain: { value: 1 }, uDay: { value: 1 } };
    (this.shared.uCut.value as THREE.Vector4).set(normal.x, normal.y, normal.z, normal.x * centre.x + normal.y * centre.y + normal.z * centre.z);
    (this.shared.uCutCentre.value as THREE.Vector3).set(centre.x, centre.y, centre.z);
    this.shared.uCutRadius.value = radius;

    this.layout = plumeLayout(budget, plan.seed, plan.bird, plan.unit);
    this.buffers = plumeBuffers(this.layout);
    const most = this.layout.specs.reduce((m, spec) => Math.max(m, spec.segments + 1), 0);
    this.scratch = { points: new Float32Array(most * 3), profile: new Float32Array(most * 2) };
    this.anchors = { hand: point(this.hand), thread: 0, threadGlow: 0, pen: sealPoint(plan, 0) };
    this.plumes = new PhoenixPlumes(this.layout, this.buffers, this.shared, { halo: budget.halo });
    this.body = new PhoenixBody(this.shared, plan.bird, budget.halo, cast.quality === "low" ? 12 : 18);
    this.seal = new PhoenixSealMark(plan.seal, this.shared, plan.seed, cast.brief);
    this.sun = new PhoenixSun({ centre: plan.sun, boardTop: cast.boardTop, unit: plan.unit, seed: plan.seed, halo: budget.halo, pool: cast.quality === "low" ? 0.16 : 0.08, brief: cast.brief }, this.shared);
    this.wash = new PhoenixWash({ stone: cast.stone, unit: plan.unit, seed: plan.seed, flames: budget.flames, brief: cast.brief }, this.shared, cast.boardTop);

    // Its real fire: flames standing on it, fire shed along its flight rolling into soot, and soot (the game's flipbooks).
    this.flames = new PhoenixFlames(phoenixFlames(plan, budget, this.layout, this.beats), this.layout, this.shared, { quality: cast.quality, soot: new THREE.Color(0.035, 0.027, 0.022) });
    this.model = new PhoenixModel(this.shared, plan.unit);
    // Waited for by the match before the Queen calls: the flames' atlases and the model. A model that cannot be had
    // leaves the bird drawn in code.
    this.ready = Promise.all([this.flames.ready, this.model.ready]).then(([, had]) => { if (had) this.adoptModel(budget.blaze); });
    const loose = phoenixParticles(plan, budget, this.layout, this.beats, point(this.hand));
    const colours = fireColours(cast.look), smoke = cast.look.smoke;
    this.light = new ParticlePool({ particles: loose.light, capacity: loose.light.length, look: { hot: colours.white, mid: colours.gold, cool: colours.red }, blend: "add", floor: cast.boardTop, seed: plan.seed });
    this.smoke = new ParticlePool({
      particles: loose.smoke, capacity: loose.smoke.length, look: { hot: new THREE.Color(smoke).lerp(new THREE.Color(cast.look.core), 0.25).getHex(), mid: smoke, cool: new THREE.Color(smoke).multiplyScalar(0.4).getHex() },
      blend: "cover", floor: cast.boardTop, seed: plan.seed + 1, opacity: 0.42,
    });
    this.object.name = "PhoenixRite";
    this.object.add(this.wash.object, this.smoke.object, this.seal.object, this.sun.object, this.flames.object, this.body.object, this.plumes.object, this.model.object, this.light.object);
    this.glow = { position: { x: centre.x, y: centre.y, z: centre.z }, colour: cast.look.light, intensity: 0, reach: GLOW_REACH * plan.unit };
    // The body hangs upright between the talons, facing on along the swoop.
    this.hold = { position: { ...plan.chest }, up: { x: 0, y: 1, z: 0 }, forward: { ...plan.heading } };
    this.state = { struck: false, blow: null, hold: null, released: false, done: false, wounds: [], sounds: [], shake: 0, glow: null, shot: 0, frame: this.shots[0].frame };
  }

  /**
   * The model is in: its talons, not the drawn bird's, close on the chest (the strike is moved until the posed model's
   * feet meet it), the camera's beats follow the moved strike, and the flames stand on its bones.
   */
  private adoptModel(blaze: number): void {
    const plan = this.plan, pose = this.pose, at = new THREE.Vector3();
    this.onModel = true;
    for (let i = 0; i < 8; i += 1) {
      phoenixPose(plan, this.beats, plan.timeline.strikeAt, pose);
      this.model.pose(plan, this.beats, plan.timeline.strikeAt, pose);
      this.model.socket(at);
      const by = { x: plan.chest.x - at.x, y: plan.chest.y - at.y, z: plan.chest.z - at.z };
      if (Math.hypot(by.x, by.y, by.z) < 1e-4) break;
      moveStrike(plan, by);
    }
    this.shots = phoenixShots(plan, this.cast.queen);
    this.modelFlames = modelFlames(blaze, sequence((plan.seed ^ 0x6f1a) >>> 0), plan.unit);
    this.flames.standOn(this.modelFlames);
    this.model.object.visible = false;
  }

  update(delta: number, camera: THREE.PerspectiveCamera, height: number): RiteState {
    const before = this.seconds;
    this.seconds += Math.max(0, delta);
    const t = this.seconds, plan = this.plan, cast = this.cast, moment = phoenixMoment(plan, t);
    this.shared.uTime.value = t;
    this.shared.uCutOn.value = moment.cut ? 1 : 0;

    // The bird, its thread, and everything that burns with it.
    cast.hand(this.hand);
    const anchors = this.anchors;
    anchors.hand.x = this.hand.x; anchors.hand.y = this.hand.y; anchors.hand.z = this.hand.z;
    anchors.thread = moment.thread; anchors.threadGlow = moment.threadGlow;
    const pose = phoenixPose(plan, this.beats, t, this.pose);
    const shown = pose.shown;
    // With the model drawn, the ribbons draw only the thread from the Queen's hand.
    if (this.onModel) pose.shown = 0;
    const drawn = pose.shown > 0.001 || moment.threadGlow > 0.001;
    this.plumes.object.visible = drawn;
    if (drawn) { writePlumes(this.layout, pose, plan, anchors, this.buffers, this.scratch); this.plumes.refresh(); this.plumes.fit(camera, height); }
    pose.shown = shown;
    // the flames on it stream back along the air it flies through, and up where it hovers
    const v = phoenixVelocity(plan, t, this.velocity), sx = -v.x, sy = -v.y + 2.2 * plan.unit, sz = -v.z, sl = Math.hypot(sx, sy, sz) || 1;
    this.stream[0] = sx / sl; this.stream[1] = sy / sl; this.stream[2] = sz / sl;
    const burning = pose.shown > 0.001 ? pose.shown * (1 - pose.collapse) : 0;
    if (this.onModel) {
      this.model.pose(plan, this.beats, t, pose);
      const flames = this.modelFlames, model = this.model;
      this.flames.updateOn(t, (i, out) => (model.flame(flames[i], out) ? 0.85 + 0.15 * Math.min(1, pose.heat) : 0), this.stream, burning);
    } else this.flames.update(t, this.buffers, this.stream, burning);
    // how far the body is out of the seal: its centre's height over the seal's plane, while the seal still cuts it
    const n = plan.seal.normal, c = plan.seal.centre;
    const out = (pose.centre[0] - c.x) * n.x + (pose.centre[1] - c.y) * n.y + (pose.centre[2] - c.z) * n.z;
    const through = moment.cut ? Math.min(1, Math.max(0, (out + 0.2 * plan.unit) / (0.9 * plan.unit))) : 1;
    this.body.pose(pose, plan.sun, through, this.onModel);
    this.seal.set(moment);
    this.sun.set(moment, t);
    this.wash.set(moment, camera, height);
    this.light.setAnchor(this.hand);
    this.light.update(t, camera, height);
    this.smoke.update(t, camera, height);

    // What the match acts on: the strike, the sounds and shakes that fell in this step, the light, the shot.
    const sounds: RiteSound[] = [];
    let shake = 0;
    for (const event of this.events) {
      if (event.at <= before || event.at > t) continue;
      if (event.cue) sounds.push({ cue: event.cue, at: this.where(event.where, pose), volume: event.volume });
      if (!cast.brief) shake += event.shake;
    }
    if (moment.struck && !this.state.struck) this.state.blow = { from: phoenixPosition(plan, plan.timeline.strikeAt - 0.12), power: 1 };
    this.state.struck = moment.struck;
    // From the moment the talons close until they open, the body is where they hold it; then it is let go.
    const T = plan.timeline, carrying = !cast.brief && moment.struck && t < T.release;
    if (carrying) {
      if (this.onModel) { const at = this.model.socket(this.socketAt); this.hold.position.x = at.x; this.hold.position.y = at.y; this.hold.position.z = at.z; }
      else { this.hold.position.x = pose.socket[0]; this.hold.position.y = pose.socket[1]; this.hold.position.z = pose.socket[2]; }
    }
    this.state.hold = carrying ? this.hold : null;
    this.state.released = t >= T.release;
    this.state.sounds = sounds;
    this.state.shake = shake;
    const at = this.where(moment.glowAt, pose);
    this.glow.position = at; this.glow.intensity = moment.glow;
    this.state.glow = moment.glow > 0.01 && !moment.done ? this.glow : null;
    const shot = phoenixShotAt(this.shots, t);
    this.state.shot = shot; this.state.frame = this.shots[shot].frame; this.state.look = this.shots[shot].look; this.state.close = this.shots[shot].close; this.state.facing = this.shots[shot].facing;
    this.state.done = moment.done;
    this.object.visible = !moment.done;
    return this.state;
  }

  /** Where something of the rite is now, for its sound and its light. */
  private where(what: "hand" | "seal" | "bird" | "victim" | "sun", pose: ReturnType<typeof emptyPose>): Point {
    const plan = this.plan;
    if (what === "hand") return point(this.hand);
    if (what === "seal") return { ...plan.seal.centre };
    if (what === "sun") return { ...plan.sun };
    if (what === "victim") return point(this.cast.chest(this.chest));
    const c = pose.collapse, pull = Math.pow(1 - c, 1.5), s = plan.sun;
    this.glowAt.set(s.x + (pose.centre[0] - s.x) * pull, s.y + (pose.centre[1] - s.y) * pull, s.z + (pose.centre[2] - s.z) * pull);
    return point(this.glowAt);
  }

  setGain(gain: number): void {
    this.shared.uGain.value = gain;
    const day = Math.min(1, Math.max(0, (gain - 0.45) / 0.5));
    this.shared.uDay.value = day * day * (3 - 2 * day);
    this.light.setGain(gain);
  }

  dispose(): void {
    this.plumes.dispose(); this.body.dispose(); this.seal.dispose(); this.sun.dispose(); this.wash.dispose(); this.flames.dispose(); this.model.dispose(); this.light.dispose(); this.smoke.dispose();
    this.object.removeFromParent();
  }
}

/** Makes the phoenix's rite for one capture. */
export function makePhoenixRite(cast: RiteCast): RiteEffect {
  return new PhoenixRiteEffect(cast);
}

/** The entry for the match's table of rites. */
export const PHOENIX_RITE: RiteEntry = { id: "solforiz.queen.phoenix", name: "The phoenix", army: "sun", make: makePhoenixRite };
