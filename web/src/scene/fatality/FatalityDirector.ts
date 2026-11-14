/**
 * The fatality director (gore tier 3, docs/play/GORE_SYSTEM.md "Three tiers"): the directed sequence a fatality adds
 * round a kill's killing blow, wrapping the kill's own cinematic and never replacing it.
 *
 *   director.begin(request)                      // on the frame the killing blow lands (sceneEngine.ts fatalityBlow)
 *   const scale = director.advance(realDelta)    // first thing every frame: the scene's time scale for this frame
 *   director.update(sceneDelta, realDelta, cam)  // after the pieces have animated and physics has posed the bones
 *   director.refine(victim, point, direction)    // a spell's or a rite's own first wound, when it comes
 *   director.cancel()                            // Undo, a new game, a rebuilt board, a skipped fight
 *
 * The beats (fatality/fatalityPlan.ts) run on the player's clock: the slow motion is the scene's own time scale,
 * which the engine applies to every system's delta. The engine is told each beat (`host.beat`): it moves the camera
 * in on the wound, sounds the one low impact, and sends the view back to the kill's own shot. What a fatality draws
 * is in its layers: the X-ray (fatality/xray.ts) and the fluid blood.
 *
 * Gated by the kill's GoreShow (`fatality`), which the engine keeps per victim (sceneEngine.ts goreShowOf).
 *
 * A tier 2 kill that takes a limb off plays the light form, the cut (`kind: "cut"`, fatality/fatalityPlan.ts
 * SEVER_CUT): the close shot on the body and the limb's flight and the way back, in the scene's own time, with no
 * layers drawn.
 */
import * as THREE from "three";
import type { GoreShow } from "../gore/goreTiers";
import type { PieceView } from "../pieces";
import { beatsBetween, FATALITY_SECONDS, timeScaleAt, type FatalityBeat, type SequenceKind } from "./fatalityPlan";

export interface FatalityRequest {
  /** A fatality's whole sequence (the default), a sever's cut, or an ordinary fight's look at the body. */
  kind?: SequenceKind;
  /** What the close shot keeps in frame, where it is not the wound (a cut: the body and where the limb flies). */
  frame?: readonly { x: number; y: number; z: number }[];
  victim: PieceView;
  attacker: PieceView;
  /** Where the killing blow went in (world), and the line it travels (any length, either way along it). */
  point: THREE.Vector3;
  direction: THREE.Vector3;
  /** The point is a wound the kill opened itself (a spell's, a rite's): nothing later reads it again. */
  exact?: boolean;
  show: GoreShow;
  /** The capture's ply, and the seed its dice come from: the same game plays the same fatality. */
  ply: number;
  seed: number;
}

/** The fatality now playing, as its layers and the engine see it. */
export interface Fatality {
  readonly kind: SequenceKind;
  readonly frame: readonly { x: number; y: number; z: number }[] | null;
  readonly victim: PieceView;
  readonly attacker: PieceView;
  /** Where the blow went in, and the way it travels into the body (unit). A spell's or a rite's own wound refines them. */
  readonly point: THREE.Vector3;
  readonly direction: THREE.Vector3;
  readonly show: GoreShow;
  readonly ply: number;
  readonly seed: number;
  /** Real seconds since the blow, and scene seconds (the slow motion's). */
  readonly seconds: number;
  readonly sceneSeconds: number;
}

/** Something a fatality draws: begun with it, advanced every frame once the bones are posed, ended with it. */
export interface FatalityLayer {
  /** Its own objects, added to the director's root once. */
  readonly object: THREE.Object3D;
  begin(fatality: Fatality): void;
  /** `scene` is the frame's delta in the slow motion, `real` the player's. */
  update(fatality: Fatality, scene: number, real: number, camera: THREE.Camera): void;
  /** The wound was read again (a spell's or a rite's own first wound). */
  refine?(fatality: Fatality): void;
  /** The fatality is over or cut short: everything it showed goes, and the figure is left as it was found. */
  end(): void;
  dispose(): void;
}

export interface FatalityHost {
  /** A beat of the sequence has come: `close` (the blow), `back` (the view goes back), `end`. */
  beat(beat: FatalityBeat, fatality: Fatality): void;
}

export interface FatalityStats {
  /** Sequences begun since the director was made (cuts and looks among them), whether one plays now, and which kind. */
  begun: number;
  cuts: number;
  looks: number;
  active: boolean;
  kind: SequenceKind | null;
  /** Real and scene seconds into the one playing, and the scene's time scale this frame. */
  seconds: number;
  sceneSeconds: number;
  scale: number;
  /** Beats told to the engine, in order, for the one playing (or the last). */
  beats: FatalityBeat[];
}

interface Playing {
  kind: SequenceKind; frame: readonly { x: number; y: number; z: number }[] | null;
  victim: PieceView; attacker: PieceView; point: THREE.Vector3; direction: THREE.Vector3; show: GoreShow; ply: number; seed: number;
  seconds: number; sceneSeconds: number; refined: boolean;
}

/** A spell's or a rite's own wound is taken in place of the blow's only this soon after it (real seconds). */
const REFINE_WITHIN = 0.6;
const chest = new THREE.Vector3();

/**
 * The line of a blow turned to run into the body from where it went in: a wound reports the way its blood goes, which
 * at the entry is back out along the blade. Normalises `direction` in place and returns it.
 */
function inward(victim: PieceView, point: THREE.Vector3, direction: THREE.Vector3): THREE.Vector3 {
  direction.normalize();
  victim.combatPoint(chest).sub(point);
  if (chest.lengthSq() > 1e-6 && chest.dot(direction) < 0) direction.negate();
  return direction;
}

export class FatalityDirector {
  readonly root = new THREE.Group();
  private playing: Playing | null = null;
  private scale = 1;
  private begun = 0;
  private cuts = 0;
  private looks = 0;
  private beats: FatalityBeat[] = [];
  /** Real seconds since the blow on the previous advance: beats fall between that and now. */
  private before = -1;

  constructor(private readonly host: FatalityHost, private readonly layers: readonly FatalityLayer[] = []) {
    this.root.name = "fatality";
    for (const layer of layers) this.root.add(layer.object);
  }

  /** Whether a fatality plays now. */
  get active(): boolean { return this.playing !== null; }
  /** The scene's time scale this frame (1 when none plays). */
  get timeScale(): number { return this.scale; }
  /** While a fatality holds the camera, the shot moves on the player's clock, not the slow motion's. */
  get holdsCamera(): boolean { return this.playing !== null; }
  /** Whether the fatality playing is this victim's. */
  owns(victim: PieceView): boolean { return this.playing?.victim === victim; }
  get stats(): FatalityStats {
    const p = this.playing;
    return { begun: this.begun, cuts: this.cuts, looks: this.looks, active: p !== null, kind: p?.kind ?? null, seconds: p?.seconds ?? 0, sceneSeconds: p?.sceneSeconds ?? 0, scale: this.scale, beats: [...this.beats] };
  }

  /** The killing blow has landed on a kill whose tier shows a fatality: the sequence begins on this frame. */
  begin(request: FatalityRequest): boolean {
    if (this.playing) this.cancel();
    const direction = request.direction.clone();
    if (direction.lengthSq() < 1e-8) direction.set(0, 0, -1);
    const kind = request.kind ?? "fatality";
    this.playing = {
      kind, frame: request.frame ? request.frame.map(p => ({ x: p.x, y: p.y, z: p.z })) : null,
      victim: request.victim, attacker: request.attacker, point: request.point.clone(), direction: inward(request.victim, request.point, direction),
      show: request.show, ply: request.ply, seed: request.seed, seconds: 0, sceneSeconds: 0, refined: request.exact === true,
    };
    this.begun += 1;
    if (kind === "cut") this.cuts += 1;
    if (kind === "look") this.looks += 1;
    this.beats = [];
    this.before = -1;
    this.scale = 1;
    // A cut draws nothing of its own: its layers are a fatality's.
    if (kind === "fatality") for (const layer of this.layers) {
      try { layer.begin(this.playing); } catch (error) { console.warn("[fatality] a layer could not begin", error); }
    }
    return true;
  }

  /**
   * First thing every frame: moves the sequence on by the player's delta, tells the engine the beats that fall in
   * it, and returns the scene's time scale for this frame.
   */
  advance(real: number): number {
    const playing = this.playing;
    if (!playing) { this.scale = 1; return 1; }
    const step = Math.max(0, real);
    const from = this.before;
    playing.seconds = from < 0 ? 0 : from + step;
    this.before = playing.seconds;
    this.scale = timeScaleAt(playing.seconds, playing.kind);
    playing.sceneSeconds += step * this.scale;
    for (const beat of beatsBetween(from, playing.seconds, playing.kind)) {
      this.beats.push(beat);
      try { this.host.beat(beat, playing); } catch (error) { console.warn(`[fatality] the ${beat} beat failed`, error); }
      if (beat === "end") { this.finish(); return this.scale; }
    }
    return this.scale;
  }

  /** After the pieces have animated and the death physics has posed the bones: the layers follow the body. */
  update(scene: number, real: number, camera: THREE.Camera): void {
    const playing = this.playing;
    if (!playing || playing.kind !== "fatality") return;
    for (const layer of this.layers) {
      try { layer.update(playing, scene, real, camera); } catch (error) { console.warn("[fatality] a layer failed", error); }
    }
  }

  /** A spell's or a rite's own first wound on the victim, when it comes soon after the blow: it is where the blow really went. */
  refine(victim: PieceView, point: THREE.Vector3, direction: THREE.Vector3): void {
    const playing = this.playing;
    if (!playing || playing.kind !== "fatality" || playing.victim !== victim || playing.refined || playing.seconds > REFINE_WITHIN || direction.lengthSq() < 1e-8) return;
    playing.refined = true;
    playing.point.copy(point);
    playing.direction.copy(inward(victim, point, direction.clone()));
    for (const layer of this.layers) layer.refine?.(playing);
  }

  /** Cut short (Undo, a new game, a rebuilt board, a skipped fight): the scene's time is its own again at once. */
  cancel(): void {
    if (this.playing) this.finish();
  }

  dispose(): void {
    this.cancel();
    for (const layer of this.layers) layer.dispose();
    this.root.removeFromParent();
  }

  private finish(): void {
    this.playing = null;
    this.scale = 1;
    this.before = -1;
    for (const layer of this.layers) {
      try { layer.end(); } catch (error) { console.warn("[fatality] a layer could not end", error); }
    }
  }
}

/** Real seconds a fatality lasts, beat to beat (for diagnostics and the films). */
export const FATALITY_LENGTH = FATALITY_SECONDS;
