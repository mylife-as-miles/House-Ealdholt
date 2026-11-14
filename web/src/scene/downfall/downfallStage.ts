import * as THREE from "three";
import type { Faction, PieceKind } from "../../core/types";
import type { DropKind } from "../../../../shared/play/gambit-sound";
import { hash01, KNEEL_FRONT, KNEEL_SINK, KNEEL_STEP, planDownfall, placeFallenProps, type DownfallKind, type DownfallPlan, type FallenPlacement, type FallenPropInput, type FootCircle } from "./downfallPlan";
import { planDownfallCamera, type CameraPose, type DownfallCamera } from "./downfallCamera";
import { STANCE_FADE, type DownfallCast, type DownfallClock } from "./downfallPose";
import { measureProp, PropFall, withHull, type PropShape } from "./fallenProp";
import { SideShade } from "./sideShade";

/** What the stage asks of a figure (PieceView implements it; the tests fake it). */
export interface DownfallFigureView {
  readonly container: THREE.Object3D;
  readonly kind: PieceKind;
  readonly color: Faction;
  readonly isSlain: boolean;
  /** Its height on the board, world units. */
  readonly standingHeight: number;
  /** How tall it actually stands, to the top of its head (the shots frame the Kings by it). */
  measuredHeight(): number;
  /** The top of the crest floating over its head, standing; absent, a third over its height. */
  crestTop?(): number;
  /** True when it carries a long arm in both hands (a musket): it raises both. */
  readonly holdsLongArm: boolean;
  /** The way it faces on the board (unit, y = 0). */
  facing(out: THREE.Vector3): THREE.Vector3;
  beginDownfall(cast: DownfallCast, clock: DownfallClock): void;
  /** Its stance stops: the clip fades to a held frame over `fade` seconds and stays there. */
  holdStance(fade: number): void;
  /** What its hands hold that can fall. */
  downfallProps(): readonly { readonly group: THREE.Object3D; readonly weapon: string; readonly shield: boolean }[];
  /** Takes a fallen weapon into its own keeping (so it goes with the figure when the board is rebuilt). */
  adoptFallen(group: THREE.Object3D): void;
  /** Its ring, crest and rim light fade (`insignia`), and the light on it falls (`shade`), both 0..1. */
  setDownfallLight(insignia: number, shade: number): void;
  /**
   * When its knee meets the stone (downfall clock): null until its kneel is solved, Infinity if it will not kneel.
   * Without it, the knee is heard most of the way through the sink.
   */
  kneelContact?(): number | null;
}

export interface DownfallStageInput {
  readonly reason: DownfallKind;
  readonly winner: Faction;
  /** The square of the piece giving check, for the King's look when he realizes. */
  readonly threat: string | null;
  readonly figures: readonly { readonly square: string; readonly view: DownfallFigureView }[];
  readonly squareSize: number;
  readonly ground: number;
  readonly camera: { readonly origin: CameraPose; readonly lens: number; readonly aspect: number; readonly reach: number; readonly sight?: (eye: { x: number; y: number; z: number }, point: { x: number; y: number; z: number }) => boolean };
  /** Straight to the final tableau, without sound (Skip, Reduced Motion, a rebuild of a finished board). */
  readonly instant: boolean;
  /** The ending this is ("reason:fen"), so a rebuilt board can be put back in the same tableau. */
  readonly key: string;
  /** The match's own draw for its ending (planDownfall): the live game and its replay pass the same. */
  readonly seed?: number;
}

/** The voice of a figure still standing that says its army's line (gambit-sound.ts downfallClips). */
export type ArmyVoice = "p1" | "p2" | "r" | "q" | "k";

/** The downfall's sounds, played by the match's one mixer (audioManager weaponDrop, kneel, armyLine). */
export interface DownfallStageHooks {
  /**
   * A weapon striking the stone, at the frame it does. Every sound carries a `salt` naming it on the board ("drop e8 0"),
   * the same in the live game and its replay: what the mixer chooses for it is drawn from the match's seed with it.
   */
  drop(kind: DropKind, options: { readonly pan: number; readonly volume: number; readonly salt: string }): void;
  /** A knee meeting the stone, at the frame it does. */
  kneel(options: { readonly pan: number; readonly volume: number; readonly salt: string }): void;
  /** One line from an army in the voice of a figure still standing: its length, or null when the floor was not free. */
  armyLine(side: Faction, event: "despair" | "victory", options: { readonly voice: ArmyVoice; readonly pan: number; readonly salt: string }): number | null;
  /** Where a board point is across the screen, -1 left to 1 right, for panning. */
  pan(x: number, z: number): number;
}

/** What a fallen weapon sounds like on the stone, from what it is (weapons.ts ids): a blade, a pole, a gun or a shield. */
export function dropKindOf(weapon: string, shield: boolean): DropKind {
  if (shield) return "shield";
  if (/pistol|musket|rifle|carbine|gun/i.test(weapon)) return "musket";
  if (/sword|sabre|saber|blade|cleaver|dagger|knife|falchion|scimitar/i.test(weapon)) return "blade";
  return "pole";
}

interface Cast { view: DownfallFigureView; cast: DownfallCast; held: boolean; dropped: boolean; heardKneel: boolean; }
interface Fall { fall: PropFall; group: THREE.Object3D; released: number; kind: DropKind; salt: string; heard: number; x: number; z: number; resting: boolean; }
interface Prop { owner: string; group: THREE.Object3D; shape: PropShape; kind: DropKind; key: string; salt: string; weapon: string; }
/** Who says an army's line, from where, and in what window (the bark floor picks the moment: never over the King). */
interface Line { side: Faction; event: "despair" | "victory"; voice: ArmyVoice; x: number; z: number; opens: number; closes: number; said: number | null; }

const smooth = (t: number) => { const c = Math.min(1, Math.max(0, t)); return c * c * (3 - 2 * c); };

/**
 * Runs a downfall plan on the board: the figures' parts (DownfallPose, through each figure), the weapons
 * leaving the hands (PropFall), the light leaving that side (SideShade and each figure's insignia), and the
 * sounds at their beats. Owns no chess state and no camera: the scene asks it for the shot at each instant.
 * Its clock is the scene's, advanced once a frame before the figures are posed.
 */
export class DownfallStage {
  readonly clock: DownfallClock = { time: 0 };
  private plan: DownfallPlan | null = null;
  private camera: DownfallCamera | null = null;
  private readonly casts = new Map<string, Cast>();
  private readonly props = new Map<string, Prop[]>();
  private readonly placements = new Map<string, FallenPlacement>();
  private falls: Fall[] = [];
  private lines: Line[] = [];
  private shade: SideShade | null = null;
  private ground = 0;
  private silent = false;
  private staged: string | null = null;
  private readonly position = new THREE.Vector3();
  private readonly quaternion = new THREE.Quaternion();
  private readonly parentQuaternion = new THREE.Quaternion();
  private readonly scale = new THREE.Vector3();

  constructor(private readonly scene: THREE.Object3D, private readonly hooks: DownfallStageHooks) {}

  get active(): boolean { return this.plan !== null; }
  get finished(): boolean { return !!this.plan && this.clock.time >= this.plan.timeline.end; }
  get current(): DownfallPlan | null { return this.plan; }
  /** The ending last staged ("reason:fen"), kept across a rebuild so the same tableau can be put back. */
  get stagedKey(): string | null { return this.staged; }
  /** The weapons on their way down or lying on the stone (for tests and diagnostics). */
  get fallen(): readonly { readonly group: THREE.Object3D; readonly resting: boolean }[] {
    return this.falls.map(entry => ({ group: entry.group, resting: this.clock.time - entry.released >= entry.fall.duration }));
  }
  get shadeStrength(): number { return this.shade?.strength ?? 0; }

  /** The shot at `time`, or null when nothing is staged. */
  cameraAt(time: number): CameraPose | null { return this.camera?.at(time) ?? null; }

  begin(input: DownfallStageInput): DownfallPlan | null {
    this.cancel();
    const figures = input.figures.filter(entry => !entry.view.isSlain).map(({ square, view }) => ({
      id: view.container.uuid, square, kind: view.kind, color: view.color, x: view.container.position.x, z: view.container.position.z,
    }));
    const plan = planDownfall({ reason: input.reason, winner: input.winner, figures, threat: input.threat, squareSize: input.squareSize, seed: input.seed });
    if (!plan) return null;
    this.plan = plan;
    this.staged = input.key;
    this.ground = input.ground;
    this.clock.time = 0;
    const views = new Map(input.figures.map(entry => [entry.view.container.uuid, entry.view]));
    for (const role of [plan.king, ...plan.defeated]) {
      const view = views.get(role.id);
      if (!view) continue;
      const cast: DownfallCast = { side: "defeat", role };
      view.beginDownfall(cast, this.clock);
      this.casts.set(role.id, { view, cast, held: false, dropped: false, heardKneel: false });
    }
    for (const role of [...(plan.victorKing ? [plan.victorKing] : []), ...plan.victors]) {
      const view = views.get(role.id);
      if (!view) continue;
      const cast: DownfallCast = { side: "victor", role, longArm: view.holdsLongArm };
      view.beginDownfall(cast, this.clock);
      this.casts.set(role.id, { view, cast, held: true, dropped: true, heardKneel: true });
    }
    this.measureProps(plan, views, input);
    this.lines = this.speakers(plan, views);
    this.shade = new SideShade(input.squareSize * 4, input.ground + 0.004);
    this.scene.add(this.shade.mesh);
    const king = views.get(plan.king.id)!, victor = plan.victorKing ? views.get(plan.victorKing.id) ?? null : null;
    const kneelers = new Set(plan.defeated.filter(role => role.gesture === "kneel").map(role => role.id));
    const facing = king.facing(new THREE.Vector3());
    this.camera = planDownfallCamera({
      plan,
      king: { x: king.container.position.x, z: king.container.position.z, facing: { x: facing.x, z: facing.z }, height: king.measuredHeight(), crest: king.crestTop?.() },
      victor: victor ? { x: victor.container.position.x, z: victor.container.position.z, height: victor.measuredHeight() } : null,
      army: [plan.king, ...plan.defeated].map(role => views.get(role.id)).filter((view): view is DownfallFigureView => !!view)
        .map(view => ({ x: view.container.position.x, z: view.container.position.z })),
      standing: input.figures.filter(entry => entry.view !== king && !entry.view.isSlain).map(({ view }) => ({
        x: view.container.position.x, z: view.container.position.z, height: view.standingHeight, kneels: kneelers.has(view.container.uuid),
      })),
      origin: input.camera.origin, lens: input.camera.lens, aspect: input.camera.aspect, reach: input.camera.reach, sight: input.camera.sight,
    });
    if (input.instant) this.skip();
    else this.advance();
    return plan;
  }

  /** Measures every weapon the beaten hold and decides where each will come to rest, before any falls. */
  private measureProps(plan: DownfallPlan, views: Map<string, DownfallFigureView>, input: DownfallStageInput): void {
    const inputs: FallenPropInput[] = [];
    const order = [plan.king, ...plan.defeated].slice().sort((a, b) => a.drop - b.drop || a.square.localeCompare(b.square));
    const facing = new THREE.Vector3(), right = new THREE.Vector3(), at = new THREE.Vector3();
    for (const role of order) {
      const view = views.get(role.id);
      if (!view) continue;
      view.facing(facing);
      right.set(-facing.z, 0, facing.x);
      const list: Prop[] = [];
      view.downfallProps().forEach((entry, index) => {
        const shape = measureProp(entry.group);
        if (!shape) return;
        const key = `${role.id}:${index}`;
        entry.group.getWorldPosition(at).sub(view.container.position);
        list.push({ owner: role.id, group: entry.group, shape, kind: dropKindOf(entry.weapon, entry.shield), key, salt: `drop ${role.square} ${index}`, weapon: entry.weapon });
        inputs.push({
          key, x: view.container.position.x, z: view.container.position.z, facing: { x: facing.x, z: facing.z },
          hand: at.dot(right) >= 0 ? 1 : -1, length: shape.length, width: Math.max(shape.width, 0.02),
          height: view.standingHeight, rear: role.gesture === "kneel" ? (role.rearSide === "right" ? 1 : -1) : 0,
        });
      });
      this.props.set(role.id, list);
    }
    const feet: FootCircle[] = input.figures.filter(entry => !entry.view.isSlain)
      .map(({ view }) => ({ x: view.container.position.x, z: view.container.position.z, r: 0.12 * view.standingHeight }));
    for (const placement of placeFallenProps(inputs, feet)) this.placements.set(placement.key, placement);
  }

  /**
   * Who speaks for each army. The beaten army's despair comes in the voice of its Pawn nearest the King, else its
   * Rook or Queen, from where that figure stands, as soon as the floor is free after the King's own words (endGame
   * says them 1.5 s after the bell). The victors answer in the long hold, which frames their sovereign behind the
   * kneeling King, once the despair has been said: half the time in his voice, otherwise their Queen's or their
   * Pawn's nearest the beaten King (which, the board decides). A line the floor never makes room for in its window
   * is not said.
   */
  private speakers(plan: DownfallPlan, views: Map<string, DownfallFigureView>): Line[] {
    const timeline = plan.timeline, lines: Line[] = [];
    const king = views.get(plan.king.id)?.container.position;
    if (!king) return lines;
    const nearest = (roles: readonly { readonly id: string }[], kind: PieceKind): DownfallFigureView | null => {
      let best: DownfallFigureView | null = null, distance = Infinity;
      for (const role of roles) {
        const view = views.get(role.id);
        if (!view || view.kind !== kind) continue;
        const d = view.container.position.distanceTo(king);
        if (d < distance - 1e-6) { best = view; distance = d; }
      }
      return best;
    };
    const voice = (view: DownfallFigureView): ArmyVoice => view.kind === "p"
      ? (hash01(`${plan.key}:voice:${Math.round(view.container.position.x * 100)}:${Math.round(view.container.position.z * 100)}`) < 0.5 ? "p1" : "p2")
      : view.kind as ArmyVoice;
    const add = (side: Faction, event: Line["event"], view: DownfallFigureView | null, opens: number, closes: number) => {
      if (view) lines.push({ side, event, voice: voice(view), x: view.container.position.x, z: view.container.position.z, opens, closes, said: null });
    };
    add(plan.loser, "despair", nearest(plan.defeated, "p") ?? nearest(plan.defeated, "r") ?? nearest(plan.defeated, "q"),
      timeline.spread + 0.3, (timeline.alone ?? timeline.hold) + 2);
    const sovereign = plan.victorKing ? views.get(plan.victorKing.id) ?? null : null;
    const queen = nearest(plan.victors, "q"), pawn = nearest(plan.victors, "p"), pick = hash01(`${plan.key}:victory`);
    const answer = pick < 0.5 ? sovereign ?? queen ?? pawn : pick < 0.75 ? queen ?? pawn ?? sovereign : pawn ?? queen ?? sovereign;
    add(plan.winner, "victory", answer, timeline.hold + 0.4, timeline.final);
    return lines;
  }

  update(delta: number): void {
    const plan = this.plan;
    if (!plan || this.clock.time >= plan.timeline.end) return;
    if (!Number.isFinite(delta) || delta <= 0) return;
    this.clock.time = Math.min(plan.timeline.end, this.clock.time + delta);
    this.advance();
  }

  /** Straight to the end: every hand open, every weapon on the stone, every figure down, without a sound. */
  skip(): void {
    const plan = this.plan;
    if (!plan) return;
    this.clock.time = plan.timeline.end;
    this.silent = true;
    try { this.advance(true); } finally { this.silent = false; }
  }

  private advance(instant = false): void {
    const plan = this.plan!;
    const t = this.clock.time;
    for (const [id, entry] of this.casts) {
      if (entry.cast.side !== "defeat") continue;
      const role = entry.cast.role;
      if (!entry.held && t >= role.start) { entry.view.holdStance(instant ? 0 : STANCE_FADE); entry.held = true; }
      if (!entry.dropped && t >= role.drop) { this.release(id, entry, role.drop); entry.dropped = true; }
      const insignia = smooth((t - role.dim.from) / Math.max(0.1, role.dim.to - role.dim.from));
      entry.view.setDownfallLight(insignia, insignia * (role.royal ? 0.5 : 1));
      // The knee meets the stone as the figure's own kneel says (most of the way through the sink).
      const contact = role.gesture !== "kneel" || entry.heardKneel ? null
        : entry.view.kneelContact ? entry.view.kneelContact() : role.kneel + KNEEL_FRONT + KNEEL_STEP + KNEEL_SINK * 0.85;
      if (contact !== null && t >= contact) {
        entry.heardKneel = true;
        const at = entry.view.container.position;
        this.sound(() => this.hooks.kneel({ pan: this.hooks.pan(at.x, at.z), volume: role.royal ? 1 : 0.7, salt: `kneel ${role.square}` }));
      }
    }
    for (const entry of this.falls) {
      if (entry.resting) continue;
      const since = t - entry.released;
      entry.fall.pose(since, this.position, this.quaternion);
      this.placeWorld(entry.group, this.position, this.quaternion);
      while (entry.heard < entry.fall.contacts.length && since >= entry.fall.contacts[entry.heard].at) {
        const contact = entry.fall.contacts[entry.heard];
        entry.heard += 1;
        this.sound(() => this.hooks.drop(entry.kind, { pan: this.hooks.pan(entry.x, entry.z), volume: contact.strength, salt: entry.salt }));
      }
      // At rest it stays exactly where it lies: it need not be put there again every frame.
      if (since >= entry.fall.duration && entry.heard >= entry.fall.contacts.length) entry.resting = true;
    }
    this.shade?.set(plan.shade, t);
    // An army's line is offered each frame of its window until the bark floor takes it (null while the King speaks):
    // the despair first, the victors' only once the despair has been said and has ended, or its window has closed.
    const despair = this.lines.find(line => line.event === "despair");
    for (const line of this.lines) {
      if (line.said !== null || this.silent || t < line.opens || t >= line.closes) continue;
      if (line !== despair && despair && (despair.said === null ? t < despair.closes : t < despair.said + 0.35)) continue;
      let length: number | null = null;
      this.sound(() => { length = this.hooks.armyLine(line.side, line.event, { voice: line.voice, pan: this.hooks.pan(line.x, line.z), salt: `line ${line.event}` }); });
      if (length !== null) line.said = t + length;
    }
  }

  /** Lets go of what a figure holds: each weapon leaves the hand and falls to its planned place on the stone. */
  private release(id: string, entry: Cast, at: number): void {
    for (const prop of this.props.get(id) ?? []) {
      const placement = this.placements.get(prop.key);
      if (!placement || !prop.group.parent) continue;
      prop.group.updateWorldMatrix(true, false);
      prop.group.matrixWorld.decompose(this.position, this.quaternion, this.scale);
      // Its exact corners only now, as it falls (one kind of prop at a time, across the wave): its extents planned where it lies.
      const fall = new PropFall(withHull(prop.shape, prop.group, prop.weapon), { position: this.position.clone(), quaternion: this.quaternion.clone(), scale: (this.scale.x + this.scale.y + this.scale.z) / 3 },
        { x: placement.x, z: placement.z, yaw: placement.yaw }, this.ground);
      entry.view.adoptFallen(prop.group);
      prop.group.scale.setScalar((this.scale.x + this.scale.y + this.scale.z) / 3);
      this.falls.push({ fall, group: prop.group, released: at, kind: prop.kind, salt: prop.salt, heard: 0, x: placement.x, z: placement.z, resting: false });
    }
  }

  private placeWorld(group: THREE.Object3D, position: THREE.Vector3, quaternion: THREE.Quaternion): void {
    const parent = group.parent;
    if (!parent) return;
    parent.updateWorldMatrix(true, false);
    group.position.copy(parent.worldToLocal(this.scale.copy(position)));
    parent.getWorldQuaternion(this.parentQuaternion);
    group.quaternion.copy(this.parentQuaternion.invert().multiply(quaternion));
    group.updateMatrixWorld(true);
  }

  /** A sound at its frame, unless the ending is being skipped to; a sound that fails never stops the downfall. */
  private sound(play: () => void): void {
    if (this.silent) return;
    try { play(); } catch (error) { console.warn("[downfall] sound skipped", error); }
  }

  /**
   * The figures are about to be freed (a rebuild: Undo, a new game, another army, a new graphics preset). The
   * weapons go with them (they were adopted into the figures), the shade comes off the stone. The ending's key is
   * kept so a rebuilt board that is still this ending can be put back in its tableau.
   */
  cancel(): void {
    this.plan = null;
    this.camera = null;
    this.casts.clear();
    this.props.clear();
    this.placements.clear();
    this.falls = [];
    this.lines = [];
    this.shade?.dispose();
    this.shade = null;
    this.clock.time = 0;
  }

  /** Forgets the ending too: the next board is a new game. */
  reset(): void { this.cancel(); this.staged = null; }

  dispose(): void { this.reset(); }
}
