/**
 * The Claiming, in a match: every ritual now under way, who holds their threads, and what each does to its body.
 *
 * mystic/claim.ts draws one ritual's light and mystic/claimPlan.ts times it. This keeps them for the match: it
 * asks whoever stands over the board (the arena's sorcerer) to raise its hands and hold the thread, or holds it
 * from the sky when nobody does; it unmakes the body by the ritual's clock; and it tells the match the three
 * moments it acts on: the thread touching down, the soul leaving, and the body being gone.
 *
 * A ritual outlives its body: the promise is kept when the body is gone, and the thread lets go on its own after.
 */
import * as THREE from "three";
import type { PieceKind } from "../../../core/types";
import type { QualityPreset } from "../../quality";
import type { BeamLook } from "./beam";
import { BEAM_BUDGET, type Point } from "./beamPlan";
import { Claim, type ClaimOptions } from "./claim";
import { castHold, claimMomentsBetween, returnHold, returnMomentsBetween, skyHold, threadFar, type ClaimTimeline } from "./claimPlan";

/** Whoever stands over the board and takes the fallen. */
export interface Claimant {
  /** Raises its hands over a point on the board, and keeps them up for `hold` seconds once they are. */
  cast(point: THREE.Vector3, hold: number): void;
  /** Seconds its hands take to come up after {@link cast}. */
  readonly rise: number;
  /**
   * The hands that could hold the thread to a body lying at `body`, the one it would choose first: where each
   * is, asked every frame.
   */
  grips(body: Point): readonly ((out: THREE.Vector3) => THREE.Vector3)[];
  /** Where its face is, for a camera that wants it in the frame. */
  face(out: THREE.Vector3): THREE.Vector3;
}

/** The sorcerer's own light: the jade of its eyes, not either army's colour. */
export const CLAIM_LOOK: BeamLook = { core: 0xeafff4, glow: 0x35e0a0, ember: 0xa8ffd8 };

/** Finished claims (and the palms that held them) kept for reuse: more than this only when captures overlap. */
const SPARE_RITES = 3;

export interface ClaimRequest {
  kind: PieceKind;
  /** The body's chest where it lies, and the stone under it. */
  body: Point;
  stone: Point;
  /** The colour of the fallen army's soul. */
  soul: number;
  quality: QualityPreset;
  /** The short form: fast play and reduced motion. */
  brief: boolean;
  /**
   * Chooses among the hands that could hold the thread, given where each is now: the match picks one its camera
   * can see. Without it, the holder's own first choice is taken.
   */
  pick?(hands: readonly THREE.Vector3[]): number;
  /** Unmakes the body: 0 whole, 1 gone. Called every frame until it is gone, the last time with 1. */
  unmake(amount: number): void;
  /** The thread leaves the hand (`seconds` until it lands), lands on the body, the soul leaves it, and reaches the hand. */
  onThread?(seconds: number): void;
  onTouch?(): void;
  onSoul?(): void;
  onArrive?(): void;
}

/**
 * A claim taken back: an Undo has put a captured piece back on its square, and the ritual that took it plays
 * backwards over it (claimPlan returnState).
 */
export interface ReturnRequest {
  kind: PieceKind;
  /** The piece's chest where it stands again, and the stone under it. */
  body: Point;
  stone: Point;
  /** The colour of its army's soul. */
  soul: number;
  quality: QualityPreset;
  /** The short form: fast play and reduced motion. */
  brief: boolean;
  /** Remakes the body: called every frame from 1 (nothing of it) to 0 (whole), the last time with 0. */
  remake(amount: number): void;
  /** The thread stands again between hand and stone, the soul leaves the hand, and it is back in the body. */
  onThread?(): void;
  onSoul?(): void;
  onHome?(): void;
}

export interface ClaimHandle {
  readonly timeline: ClaimTimeline;
  /** Where the thread is held now. */
  hand(out: THREE.Vector3): THREE.Vector3;
  /**
   * Kept when the body is gone (for a return: whole again), or when the ritual is cut short (Undo, a new game,
   * {@link Claiming.complete}).
   */
  readonly gone: Promise<void>;
}

interface Rite {
  claim: Claim;
  /** What the ritual does to its body: a claim's, or a return's when it was taken back. */
  request: ClaimRequest | null;
  back: ReturnRequest | null;
  handle: ClaimHandle;
  palm: THREE.Sprite;
  grip(out: THREE.Vector3): THREE.Vector3;
  resolve(): void;
  gone: boolean;
  /** Seconds before its clock starts: a return waits for the holder's hands to come up. */
  wait: number;
}

/** A soft round glow, made once: the palm that holds a thread burns with it. */
let glowTexture: THREE.DataTexture | null = null;
function glow(): THREE.DataTexture {
  if (glowTexture) return glowTexture;
  const size = 64, data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) {
    const d = Math.min(1, Math.hypot(x + 0.5 - size / 2, y + 0.5 - size / 2) / (size / 2));
    // a hot heart in a wide soft skirt
    const value = Math.round(255 * Math.min(1, 0.75 * Math.exp(-d * d * 14) + 0.45 * (1 - d) ** 2.2));
    data.set([value, value, value, 255], (y * size + x) * 4);
  }
  glowTexture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  glowTexture.colorSpace = THREE.NoColorSpace; glowTexture.magFilter = THREE.LinearFilter; glowTexture.minFilter = THREE.LinearFilter;
  glowTexture.needsUpdate = true;
  return glowTexture;
}

export class Claiming {
  /** Everything the rituals draw. The match adds it to its scene once. */
  readonly object = new THREE.Group();
  private claimant: Claimant | null = null;
  private readonly rites: Rite[] = [];
  private readonly at = new THREE.Vector3();
  private gain = 1;
  private count = 0;
  /** Finished claims and palms, kept for the next capture (A-26). */
  private readonly spareClaims: Claim[] = [];
  private readonly sparePalms: THREE.Sprite[] = [];

  constructor() { this.object.name = "Claiming"; }

  /** Who holds the threads from now on; null hands them back to the sky. Rituals under way keep the hand they have. */
  setClaimant(claimant: Claimant | null): void { this.claimant = claimant; }
  get held(): boolean { return this.claimant !== null; }
  /** Claims now drawing, returns now drawing, and how many claims have been begun since the last {@link clear}. */
  get active(): number { return this.rites.filter((rite) => rite.request).length; }
  get returning(): number { return this.rites.filter((rite) => rite.back).length; }
  get begun(): number { return this.count; }
  /** Where the holder's face is, or null when the threads come from the sky. */
  face(out: THREE.Vector3): THREE.Vector3 | null { return this.claimant ? this.claimant.face(out) : null; }

  /** Begins the ritual over a body that has come to rest. */
  begin(request: ClaimRequest): ClaimHandle {
    const claimant = this.claimant;
    const grip = this.grip(request.body, request.stone, request.pick);
    const claim = this.claim({
      budget: BEAM_BUDGET[request.quality], look: CLAIM_LOOK, soul: request.soul, kind: request.kind, brief: request.brief,
      hand: grip, body: request.body, stone: request.stone, far: threadFar(grip(this.at), request.body),
    });
    if (claimant) claimant.cast(this.at.set(request.stone.x, request.stone.y, request.stone.z), castHold(claim.timeline, claimant.rise));
    this.count += 1;
    return this.add(claim, grip, request, null, 0);
  }

  /**
   * Takes a claim back: the piece an Undo has put back on its square is returned by the same ritual run
   * backwards. The holder raises its hands first; the thread stands, the soul comes down it, the body is remade,
   * and the thread goes back up into the hand. The body should be hidden (remade at 1) until the first call.
   */
  restore(request: ReturnRequest): ClaimHandle {
    const claimant = this.claimant;
    const grip = this.grip(request.body, request.stone);
    const claim = this.claim({
      budget: BEAM_BUDGET[request.quality], look: CLAIM_LOOK, soul: request.soul, kind: request.kind, brief: request.brief,
      hand: grip, body: request.body, stone: request.stone, far: threadFar(grip(this.at), request.body), reverse: true,
    });
    if (claimant) claimant.cast(this.at.set(request.stone.x, request.stone.y, request.stone.z), returnHold(claim.timeline));
    return this.add(claim, grip, null, request, claimant && !request.brief ? claimant.rise : 0);
  }

  /** Ends one ritual now. A return leaves its body whole; a claim leaves its body as it is. */
  complete(handle: ClaimHandle): void {
    const index = this.rites.findIndex((rite) => rite.handle === handle);
    if (index < 0) return;
    const rite = this.rites[index];
    if (rite.back && !rite.gone) rite.back.remake(0);
    this.end(index);
  }

  /** Advances every ritual. `gain` keeps their light from clipping in a bright exposure (vfxGlow). */
  update(seconds: number, camera: THREE.PerspectiveCamera, height: number, gain: number): void {
    this.gain = gain;
    for (let index = this.rites.length - 1; index >= 0; index -= 1) {
      const rite = this.rites[index];
      rite.claim.setGain(gain);
      // A return waits for the holder's hands to come up before its clock starts.
      let step = seconds;
      if (rite.wait > 0) { const used = Math.min(rite.wait, step); rite.wait -= used; step -= used; }
      const waiting = rite.wait > 0;
      rite.claim.object.visible = !waiting;
      const { request, back, claim } = rite, before = claim.elapsed;
      const state = claim.update(step, camera, height);
      let done = false;
      if (request) {
        if (!rite.gone) request.unmake(state.unmade);
        // a frame that moved no time hears nothing: a moment at 0 is heard on the first frame that passes it
        for (const moment of step > 0 ? claimMomentsBetween(claim.timeline, before, claim.elapsed) : []) {
          if (moment === "thread") request.onThread?.(Math.max(0, claim.timeline.thread[1] - claim.elapsed));
          else if (moment === "touch") request.onTouch?.();
          else if (moment === "soul") request.onSoul?.();
          else if (moment === "arrive") request.onArrive?.();
          else if (moment === "gone") { if (!rite.gone) { rite.gone = true; request.unmake(1); rite.resolve(); } }
          else done = true;
        }
      } else if (back) {
        if (!rite.gone) back.remake(waiting ? 1 : state.unmade);
        for (const moment of waiting || step <= 0 ? [] : returnMomentsBetween(claim.timeline, before, claim.elapsed)) {
          if (moment === "thread") back.onThread?.();
          else if (moment === "soul") back.onSoul?.();
          else if (moment === "home") back.onHome?.();
          else if (moment === "whole") { if (!rite.gone) { rite.gone = true; back.remake(0); rite.resolve(); } }
          else done = true;
        }
      }
      // the palm that holds the thread burns, and flares as the soul comes into it
      const distance = camera.position.distanceTo(rite.grip(rite.palm.position));
      const size = (0.55 + 0.95 * state.hand) * Math.max(1, distance / 14);
      rite.palm.scale.set(size, size, 1);
      rite.palm.material.opacity = Math.min(1, state.hand) * gain;
      rite.palm.visible = state.hand > 0.01;
      if (done || state.done) this.end(index);
    }
  }

  /** Ends every ritual at once, bodies as they are: the board has been replaced under them. */
  clear(): void {
    for (let index = this.rites.length - 1; index >= 0; index -= 1) this.end(index);
    this.count = 0;
  }

  dispose(): void {
    this.clear();
    for (const claim of this.spareClaims.splice(0)) claim.dispose();
    for (const palm of this.sparePalms.splice(0)) palm.material.dispose();
    this.object.removeFromParent();
  }

  /** How many finished claims and palms wait to be reused. */
  get spare(): { claims: number; palms: number } { return { claims: this.spareClaims.length, palms: this.sparePalms.length }; }

  /** A claim for these options: a finished one built for the same budget, started again, or a new one. */
  private claim(options: ClaimOptions): Claim {
    const index = this.spareClaims.findIndex((claim) => claim.budget === options.budget);
    if (index < 0) return new Claim(options);
    const [claim] = this.spareClaims.splice(index, 1);
    claim.restart(options);
    return claim;
  }

  /** The hand that holds a thread to `body`: one of the holder's (chosen by `pick`), else a point high in the sky. */
  private grip(body: Point, stone: Point, pick?: (hands: readonly THREE.Vector3[]) => number): (out: THREE.Vector3) => THREE.Vector3 {
    const sky = skyHold(stone);
    const grips = this.claimant ? this.claimant.grips(body) : [];
    const chosen = grips.length > 1 && pick ? pick(grips.map((hold) => hold(new THREE.Vector3()))) : 0;
    return grips[Math.min(grips.length - 1, Math.max(0, Math.round(chosen) || 0))] ?? ((out: THREE.Vector3) => out.set(sky.x, sky.y, sky.z));
  }

  private add(claim: Claim, grip: (out: THREE.Vector3) => THREE.Vector3, request: ClaimRequest | null, back: ReturnRequest | null, wait: number): ClaimHandle {
    claim.setGain(this.gain);
    claim.object.visible = wait <= 0;
    const palm = this.sparePalms.pop() ?? new THREE.Sprite(new THREE.SpriteMaterial({
      map: glow(), color: CLAIM_LOOK.glow, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, fog: false,
    }));
    palm.material.opacity = 0;
    palm.visible = false; palm.renderOrder = 6;
    this.object.add(claim.object, palm);
    let resolve = () => {};
    const gone = new Promise<void>((done) => { resolve = done; });
    const handle: ClaimHandle = { timeline: claim.timeline, hand: grip, gone };
    this.rites.push({ claim, request, back, handle, palm, grip, resolve, gone: false, wait });
    return handle;
  }

  private end(index: number): void {
    const [rite] = this.rites.splice(index, 1);
    // Kept for the next capture, a few of each: more are only wanted when captures overlap.
    rite.claim.object.removeFromParent();
    if (this.spareClaims.length < SPARE_RITES) this.spareClaims.push(rite.claim); else rite.claim.dispose();
    rite.palm.removeFromParent();
    if (this.sparePalms.length < SPARE_RITES) this.sparePalms.push(rite.palm); else rite.palm.material.dispose();
    if (!rite.gone) { rite.gone = true; rite.resolve(); }
  }
}
