/**
 * The CombatStage the live match plays a {@link CombatPlan} on.
 *
 * This file is the translation only: it turns the runner's abstract cues into
 * calls on a narrow {@link StageHost}, which sceneEngine.ts binds to its own
 * private methods (glide, meleeContact, slay, banish, reactToImpact, ...). It
 * imports neither three.js nor the engine, so it runs in node tests on a stub.
 *
 * What it owns, whatever the plan says:
 *  - one {@link CombatAudioLayer} per fight: the killing strike sounds once,
 *    through the host's sound bank, and never from the host's `impact`;
 *  - `impact` (the engine's contact: hit reaction, board shock and the single
 *    witness call) is asked for exactly once, with `plan.power`;
 *  - one body fall: when the plan carries a `fall.*` cue the host's own
 *    body-fall sound is silenced;
 *  - the aftermath. An authored death is longer than the plan's fall-to-settle
 *    window, so the body is never hurried: `fall` starts it, and the body is
 *    cleared and the square claimed only when it is down. The engine awaits
 *    {@link EngineCombatStage.aftermath} after the runner returns;
 *  - nothing moves a figure, the camera or the IK after `finish`.
 */
import type { Anchor, AudioCue, BoardPoint, CameraAction, ContactAction, EffectAction, Framing, Gait, Locus, Marker, Pose, Resolution } from "./choreography";
import { MARKER_PHASE, type Actor, type ClipRole } from "./choreography";
import { CombatAudioLayer, type CombatSoundBank } from "./audio";
import type { CombatPlan } from "./director";
import type { ClipInfo, CombatActor, CombatStage, FinishStatus, Vec3 } from "./runner";
import { advanceCharacterAction, beginCharacterAction, claimCharacterContact, createCharacterActionState, interruptCharacterAction,
  characterGuardFaces, type CharacterActionState } from "../../../../shared/legacy/aethelgard/characters/action-state";

/** One fighter, as the engine exposes it (a PieceView behind closures). */
export interface StageFigure {
  /** Where the figure stands now (its board anchor, not a bone). */
  position(): Vec3;
  /** Real rendered front, when the model's orientation is known. */
  forward?(): Vec3 | null;
  /** An authored clip id (`attack.thrust`) or a generic clip name (`attack`), if the rig holds it. */
  clip(id: string): ClipInfo | null;
  /** `from`: seconds into the clip to join it at. */
  play(id: string, rate: number, fade: number, from?: number): void;
  /** Eases the playing clip to a new speed. Nothing may change once `live()` is false. */
  rate?(rate: number, ease: number, live: () => boolean): void;
  /** Seconds into the clip now playing, or null when none is. */
  clipTime?(): number | null;
  /** The hips lead the coming thrust for this long. */
  drive?(seconds: number): void;
  /** While on, the figure's guard puts the shield on the opponent's incoming weapon line. */
  meet?(on: boolean): void;
  /** Shield up and weight set against a point. */
  brace(toward: Vec3): void;
  /** A procedural flinch along a direction: no hit flash, no hit clip. */
  flinch(direction: Vec3, strength: number): void;
  /** Stand there at once. */
  place(at: Vec3): void;
  /** Go there over `duration` seconds. Nothing may move once `live()` is false. */
  travel(to: Vec3, options: { duration: number; gait: Gait; arc: number }, live: () => boolean): void;
  face(toward: Vec3, duration: number): void;
  anchor(name: Anchor): Vec3 | null;
  /** What the weapon is steered onto at the clip's contact frame (null: the torso, as authored). */
  aimWeapon(at: Anchor | null): void;
}

/** A render-context-free observation, never a second damage/strike/witness path. */
export interface StageContactResolved {
  readonly id:string; readonly seed:number; readonly atSeconds:number;
  readonly fromActor:Actor; readonly toActor:Actor;
  readonly fromAnchor:Anchor; readonly toAnchor:Anchor;
  readonly from:Vec3|null; readonly to:Vec3|null;
  /** null when no real facing or shield socket is available; does not alter the legal capture. */
  readonly facingGuard:boolean|null;
}

export interface StageHost {
  /** The engine's CombatSession for this pair: `elapsedSeconds` and `wait`. */
  readonly clock: { now(): number; wait(seconds: number): Promise<void> };
  readonly attacker: StageFigure;
  readonly defender: StageFigure;
  /** World position of a plan reference point. */
  reference(ref: BoardPoint["ref"]): Vec3;
  /** World offset of a board offset in squares (file towards h, rank towards 8). */
  offset(file: number, rank: number): Vec3;
  /** Stereo position of a world point, -1..1. */
  pan(at: Vec3): number;
  readonly sounds: CombatSoundBank;
  contactResolved?(event:StageContactResolved):void;
  phase?(phase: typeof MARKER_PHASE[Marker], marker: Marker): void;
  /** Follow `focus` at `tightness`, with the lens `fov` degrees off its rest (negative: closer). */
  camera(focus: Vec3, tightness: number, fov: number, duration: number, live: () => boolean): void;
  effect(fx: EffectAction<BoardPoint>["fx"], at: Vec3, strength: number, cue: EffectAction<BoardPoint>): void;
  /** The engine's contact (meleeContact) without its strike sound: impact effects,
   * the defender's hit reaction, and reactToImpact(point, power, victim, attacker). */
  impact(power: number, resolution: Resolution): void;
  /** The defender dies (slay). `silent`: the plan sounds the body fall itself. Resolves when the death has played out.
   * `landed` is to be called on the frame the body reaches the stone (the death clip's `land` marker). */
  fall(silent: boolean, resolution: Resolution, landed: () => void): Promise<void>;
  /** The body leaves the board (banish). */
  clear(): Promise<void>;
  /** The attacker walks onto the square it has taken. */
  claim(gait: Gait): Promise<void>;
  /** Seconds from the start of the fall to the body reaching the floor: the killer sets off then, not when the clip ends. */
  landing?(): number;
  /** Play what is left of the capture fast (a skip after the kill). */
  hurry?(): void;
  /** Camera and IK back to rest. Not called for "cancelled": that board is gone. */
  finish(status: FinishStatus): void;
  /** The combat feel layer's terms for this fight (runner.ts CombatStage.feel). Absent: the fight plays without it. */
  readonly feel?: { worldHitstop: boolean; windup: boolean };
  /**
   * A fighter starts an attack clip at `rate`, joined `from` seconds in. `killing`: this one carries the killing
   * blow. The host may draw the weapon's trail through its drive and mark the killing blow's start (feel.ts).
   */
  swing?(actor: Actor, clip: ClipInfo, options: { rate: number; from: number; killing: boolean }): void;
}

/** A stopped blow shows sparks and sounds its clash only if the steel is this close to the shield when it should land. */
export const BLOCK_TOLERANCE = 0.16;
/** Seconds a body lies where it fell before it is cleared, when the host knows the landing. */
export const BODY_REST = 0.3;
/** The body-fall cue's level against its authored one once it sounds on the landing (about -4.4 dB). */
const FALL_UNDER_KILL = 0.6;
const FRAMING: Readonly<Record<Framing, number>> = { wide: 0.98, duel: 0.68, attacker: 0.68, defender: 0.68, contact: 0.6, victor: 0.86 };
const GENERIC: Partial<Record<ClipRole, string>> = { attack: "attack", death: "death" };
const add = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const mid = (a: Vec3, b: Vec3): Vec3 => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 });
const other = (actor: Actor): Actor => actor === "attacker" ? "defender" : "attacker";

export class EngineCombatStage implements CombatStage {
  readonly clock: CombatStage["clock"];
  readonly attacker: CombatActor;
  readonly defender: CombatActor;
  readonly audioLayer: CombatAudioLayer;
  private plan: CombatPlan | null = null;
  private finished = false;
  private impacts = 0;
  private fallen: Promise<void> | null = null;
  private ending: Promise<void> | null = null;
  /** Bumped per figure by every new move, and for everything by finish. */
  private readonly motion: Record<Actor, number> = { attacker: 0, defender: 0 };
  private shot = 0;
  private began = 0;
  private cancelled = false;
  private action: CharacterActionState | null = null;
  private readonly interruptedActors = new Set<Actor>();
  private contactFailures = 0;
  /** The plan's body-fall cue, held from its authored moment until the body really lands. */
  private heldFall: (() => void) | null = null;
  private landed = false;
  private fellAt = 0;
  /** The speed each fighter's clip was last given. */
  private readonly rates: Partial<Record<Actor, number>> = {};
  private clearedBody: Promise<void> | null = null;
  /** Every stopped blow: how far the steel was from the shield, and whether that counted as a block. */
  private readonly blocks: { at: number; distance: number | null; held: boolean }[] = [];
  private blockMissed = false;

  readonly feel?: { worldHitstop: boolean; windup: boolean };

  constructor(private readonly host: StageHost) {
    this.clock = host.clock;
    this.audioLayer = new CombatAudioLayer(host.sounds);
    this.attacker = this.actor("attacker");
    this.defender = this.actor("defender");
    if (host.feel) this.feel = { ...host.feel };
  }

  /** How the fight ended on the stage, for diagnostics and tests. */
  get status(): { finished: boolean; impacts: number; contactFailures: number; sounded: readonly { cue: AudioCue; at: number }[]; blocks: readonly { at: number; distance: number | null; held: boolean }[] } {
    return { finished: this.finished, impacts: this.impacts, contactFailures: this.contactFailures, sounded: this.audioLayer.played, blocks: this.blocks };
  }

  private point(place: BoardPoint): Vec3 {
    return add(this.host.reference(place.ref), this.host.offset(place.file, place.rank));
  }

  private locus(where: Locus<BoardPoint>): Vec3 {
    if ("point" in where) return this.point(where.point);
    const figure = this.host[where.actor];
    return figure.anchor(where.anchor) ?? figure.position();
  }

  private actor(role: Actor): CombatActor {
    const figure = this.host[role], rival = this.host[other(role)];
    return {
      clip: (clipRole, prefer) => {
        for (const id of prefer) { const held = figure.clip(id); if (held) return held; }
        const generic = GENERIC[clipRole];
        return generic ? figure.clip(generic) : null;
      },
      play: (clip, options) => {
        if (this.finished) return;
        // A new blow is aimed where its own contact cue says, from its first frame.
        if (clip.id.startsWith("attack")) {
          this.interruptedActors.delete(role);
          // Only a skip joins an attack part-way in, and it joins the killing blow: that one is meant for the body.
          // (The fight's clock has jumped ahead of this stage's own count, so the next contact cannot be looked up.)
          const joined = (options.from ?? 0) > 0;
          figure.aimWeapon(joined ? null : this.nextAim(role));
          this.host.swing?.(role, clip, { rate: options.rate, from: options.from ?? 0, killing: joined || this.nextIsKill(role) });
        }
        this.rates[role] = options.rate;
        figure.play(clip.id, options.rate, options.fade, options.from ?? 0);
      },
      ...(figure.rate ? { rate: (rate: number, ease: number, land?: { clipTime: number; seconds: number; slack: number }) => {
        if (this.finished) return;
        const now = land ? figure.clipTime?.() ?? null : null;
        let speed = rate;
        if (land && now !== null) {
          // What is left of the clip over what is left of the time, allowing for the ease into the new speed.
          const from = this.rates[role] ?? rate, time = Math.max(1e-3, land.seconds - ease / 2);
          speed = Math.min(rate + land.slack, Math.max(rate - land.slack, (land.clipTime - now - from * ease / 2) / time));
        }
        this.rates[role] = speed;
        figure.rate!(speed, ease, () => !this.finished);
      } } : {}),
      pose: (pose: Pose, options) => {
        if (this.finished) return;
        const toward = options.toward ? this.locus(options.toward) : rival.anchor("torso") ?? rival.position();
        if (pose === "brace" || pose === "block") { figure.brace(toward); return; }
        if (pose === "stagger") {
          // Cancel that body's old travel/contact work, while preserving the
          // paired plan's final legal result and the other fighter's strike.
          this.motion[role] += 1; this.interruptedActors.add(role); figure.aimWeapon(null);
        }
        const here = figure.position(), from = rival.position();
        figure.flinch({ x: here.x - from.x, y: 0, z: here.z - from.z }, options.strength * (pose === "stagger" ? 1.3 : 0.8));
      },
      move: (to, options) => {
        if (this.finished) return;
        const token = ++this.motion[role], target = this.point(to);
        if (options.duration <= 0) { figure.place(target); return; }
        figure.travel(target, options, () => !this.finished && this.motion[role] === token);
      },
      face: (toward, duration) => { if (!this.finished) figure.face(this.locus(toward), duration); },
      anchor: name => figure.anchor(name),
    };
  }

  /** The anchor this fighter's next weapon contact is meant for. */
  private nextAim(role: Actor): Anchor | null {
    const now = this.clock.now() - this.began;
    const cue = this.plan?.contacts.find(item => item.from.actor === role && item.from.anchor === "weaponTip" && item.at >= now - 1e-6);
    return cue && cue.to.anchor !== "torso" ? cue.to.anchor : null;
  }

  /** True when this fighter's next weapon contact is the killing blow (the body, on the decisive marker). */
  private nextIsKill(role: Actor): boolean {
    if (role !== "attacker" || !this.plan) return false;
    const now = this.clock.now() - this.began, plan = this.plan;
    const cue = plan.contacts.find(item => item.from.actor === role && item.from.anchor === "weaponTip" && item.at >= now - 1e-6);
    return !!cue && cue.to.anchor === "torso" && Math.abs(cue.at - plan.markers.decisive) < 0.12 * plan.timeScale;
  }

  begin(plan: CombatPlan): void {
    if (this.finished || this.plan) return;
    this.plan = plan; this.began = this.clock.now();
    const windows=plan.contacts.map(cue=>({id:cue.id,opensAt:cue.at,closesAt:cue.at}));
    windows.push({id:"resolution.final",opensAt:plan.markers.decisive,closesAt:plan.markers.decisive});
    const began=beginCharacterAction(createCharacterActionState("combat-stage",0,{capacity:0,regenPerSecond:0}),{
      id:plan.sequenceId,staminaCost:0,windupSeconds:plan.markers.clash,
      activeSeconds:Math.max(0,plan.markers.decisive-plan.markers.clash),
      recoverySeconds:Math.max(1e-6,plan.seconds-plan.markers.decisive),cooldownSeconds:0,windows,
    },0);
    this.action=began.state;
  }

  phase(phase: typeof MARKER_PHASE[Marker], marker: Marker): void { if (!this.finished) this.host.phase?.(phase, marker); }

  camera(cue: CameraAction): void {
    if (this.finished) return;
    const a = this.host.attacker.position(), d = this.host.defender.position();
    const focus = cue.framing === "attacker" ? a : cue.framing === "defender" ? d
      : cue.framing === "victor" ? this.host.reference("destination")
      : cue.framing === "wide" ? mid(this.host.reference("origin"), d) : mid(a, d);
    const token = ++this.shot;
    this.host.camera(focus, FRAMING[cue.framing], cue.fov ?? 0, cue.duration, () => !this.finished && this.shot === token);
  }

  effect(cue: EffectAction<BoardPoint>): void {
    if (this.finished) return;
    // Sparks off a shield are earned: the steel has to be there.
    if (cue.fx === "sparks" && "actor" in cue.where && cue.where.anchor === "shieldFace") {
      // A fighter with no shield parries: what the steel has to reach is his own weapon.
      const incoming = this.host[other(cue.where.actor)], receiver = this.host[cue.where.actor];
      const tip = incoming.anchor("weaponTip"), face = receiver.anchor("shieldFace"), shield = face ?? receiver.anchor("weaponTip");
      const distance = tip && shield ? Math.hypot(tip.x - shield.x, tip.y - shield.y, tip.z - shield.z) : null;
      const forward = receiver.forward?.();
      const facing = !face || !!forward && characterGuardFaces({ position: receiver.position(), forward, incomingFrom: incoming.position() });
      // Missing sockets never manufacture a block, sound or material response.
      const held = distance !== null && distance <= BLOCK_TOLERANCE && facing;
      this.blocks.push({ at: this.clock.now() - this.began, distance, held });
      this.blockMissed = !held;
      if (!held) return;
      // Where they actually meet, not where the socket is.
      if (tip && shield) { this.host.effect(cue.fx, mid(tip, shield), cue.strength ?? 1, cue); return; }
    }
    this.host.effect(cue.fx, this.locus(cue.where), cue.strength ?? 1, cue);
  }

  audio(cue: AudioCue, options: { volume: number; from: Actor | null }): void {
    if (this.finished) return;
    if (this.blockMissed && cue.startsWith("clash.")) { this.blockMissed = false; return; }
    const fallCue = cue === "fall.light" || cue === "fall.heavy";
    const play = () => {
      const at = options.from ? this.host[options.from].position() : mid(this.host.attacker.position(), this.host.defender.position());
      // On the landing the thud sits under the gore sound and a few dB under the kill, which stays the loudest cue.
      this.audioLayer.play(cue, this.clock.now() - this.began, { volume: options.volume * (fallCue ? FALL_UNDER_KILL : 1), pan: this.host.pan(at) });
    };
    // A death clip puts the body on the stone well after the plan's fall cue:
    // the thud waits for the body's own landing.
    if (fallCue && this.fallen && !this.landed) { this.heldFall = play; return; }
    play();
  }

  contact(cue: ContactAction, state: "aim" | "release"): void {
    if (this.finished || cue.from.anchor !== "weaponTip") return;
    // Held until this fighter's next blow re-aims: letting go on the contact
    // frame would swing the weapon back to the torso while it is still out.
    if (state === "aim") {
      this.host[cue.from.actor].aimWeapon(cue.to.anchor === "torso" ? null : cue.to.anchor);
      this.host[cue.from.actor].drive?.(cue.lead ?? 0.12);
    }
    // A blow meant for the shield is met by it: the guard goes to the weapon's line while it comes in.
    if (cue.to.anchor === "shieldFace") this.host[cue.to.actor].meet?.(state === "aim");
  }

  sampleContact(cue:ContactAction,sampled:{from:Vec3|null;to:Vec3|null}):void {
    if(this.finished||!this.plan||!this.action||this.interruptedActors.has(cue.from.actor))return;
    // Resolve the stored cue, not a caller-supplied timestamp or invented window.
    const authored=this.plan.contacts.find(item=>item.id===cue.id);
    if(!authored||authored.from.actor!==cue.from.actor||authored.to.actor!==cue.to.actor
      ||authored.from.anchor!==cue.from.anchor||authored.to.anchor!==cue.to.anchor)return;
    if(authored.at<this.action.atSeconds)return;
    const claimed=claimCharacterContact(this.action,{windowId:authored.id,targetId:authored.to.actor,atSeconds:authored.at});
    if(!claimed.accepted)return;this.action=claimed.state;
    const point=(p:Vec3|null):Vec3|null=>p&&[p.x,p.y,p.z].every(Number.isFinite)?{x:p.x,y:p.y,z:p.z}:null;
    const from=point(sampled.from),to=point(sampled.to),receiver=this.host[authored.to.actor];
    const forward=receiver.forward?.()??null;
    const facingGuard=authored.to.anchor==='shieldFace'&&to&&from&&forward
      // At true contact the two sockets can coincide. The striker's actual
      // body position supplies an incoming direction without fabricating a
      // direction from that zero-length socket pair.
      ?characterGuardFaces({position:receiver.position(),forward,incomingFrom:this.host[authored.from.actor].position()}):null;
    const event:StageContactResolved={id:authored.id,seed:this.plan.seed,atSeconds:authored.at,
      fromActor:authored.from.actor,toActor:authored.to.actor,fromAnchor:authored.from.anchor,toAnchor:authored.to.anchor,from,to,facingGuard};
    // A failed optional effect must not invalidate a committed chess capture.
    try{this.host.contactResolved?.(event);}catch{this.contactFailures+=1;}
  }

  decisive(resolution: Resolution, plan: CombatPlan): void {
    if (this.finished || this.impacts > 0) return;
    if(this.action){
      const claim=claimCharacterContact(this.action,{windowId:"resolution.final",targetId:"defender",atSeconds:Math.max(this.action.atSeconds,plan.markers.decisive)});
      if(claim.accepted)this.action=claim.state;
    }
    this.impacts += 1;
    this.host.attacker.aimWeapon(null);
    this.host.impact(plan.power, resolution);
  }

  fall(resolution: Resolution): void {
    if (this.finished || this.fallen) return;
    // One body fall: the plan's own cue, or the engine's when it has none.
    const cued = !!this.plan?.audio.some(cue => cue.cue === "fall.light" || cue.cue === "fall.heavy");
    const land = () => {
      if (this.landed) return;
      this.landed = true;
      const held = this.heldFall;
      this.heldFall = null;
      if (!this.cancelled) held?.();
    };
    this.fellAt = this.clock.now();
    this.fallen = this.host.fall(cued, resolution, land);
    // A host with no landing frame of its own: the body is down when the fall is over.
    this.fallen.then(land, () => undefined);
  }

  settle(resolution: Resolution): void {
    if (this.finished && !this.fallen) return;
    if (this.ending) return;
    if (!this.fallen) this.fall(resolution);
    const claim = resolution.claim;
    // The killer sets off as soon as the body is on the floor; the body lies there a moment, then is cleared.
    const landing = this.host.landing?.() ?? NaN;
    const timed = landing >= 0;
    const after = (seconds: number) => Promise.race([this.fallen!, this.clock.wait(Math.max(1e-4, seconds - (this.clock.now() - this.fellAt)))]);
    const down = timed ? after(landing) : this.fallen!;
    let started!: () => void;
    const clearing = new Promise<void>(resolve => { started = resolve; });
    this.clearedBody = (timed ? after(landing + BODY_REST) : this.fallen!).then(() => { started(); return this.cancelled ? undefined : this.host.clear(); });
    this.clearedBody.catch(() => { started(); });
    this.ending = Promise.all([down.then(() => this.cancelled ? undefined : this.host.claim(claim.gait)), timed ? clearing : this.clearedBody]).then(() => {
      if (this.cancelled || !claim.clip) return;
      const clip = this.attacker.clip(claim.clip.role, claim.clip.prefer ?? []);
      if (clip) this.host.attacker.play(clip.id, 1, 0.12);
    });
    this.ending.catch(() => undefined);
  }

  hurry(): void { if (!this.finished || this.fallen) this.host.hurry?.(); }

  finish(status: FinishStatus): void {
    if (this.finished) return;
    this.finished = true;
    if(this.action){
      const at=Math.max(this.action.atSeconds,this.clock.now()-this.began);
      this.action=status==='completed'||status==='skipped'||status==='capped'
        ?advanceCharacterAction(this.action,Math.max(at,this.plan?.seconds??0))
        :interruptCharacterAction(this.action,at,"cancelled");
    }
    this.motion.attacker += 1; this.motion.defender += 1; this.shot += 1;
    if (status === "cancelled") { this.cancelled = true; return; }
    this.host.finish(status);
  }

  /**
   * Resolves when the body has been cleared and the attacker stands on its
   * square. Rejects if the board was replaced meanwhile (the session's
   * CombatCancelled). Resolves at once when the fight never reached its kill.
   */
  aftermath(): Promise<void> {
    return this.ending ?? this.fallen ?? Promise.resolve();
  }

  /** Resolves when the body has left the board. With a timed landing this is after {@link aftermath}. Never rejects. */
  cleared(): Promise<void> {
    return (this.clearedBody ?? Promise.resolve()).catch(() => undefined);
  }
}
