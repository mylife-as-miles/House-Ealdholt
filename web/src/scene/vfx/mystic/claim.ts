/**
 * The Claiming, drawn: a thread from the sorcerer's hand to a fallen piece, and what happens where it lands.
 * mystic/claimPlan.ts decides what the ritual is doing at each moment; this places a beam and a landing by it.
 *
 * It draws only the light. The caller owns everything else the ritual touches: it unmakes the body by
 * {@link ClaimState.unmade}, sounds the touch when {@link ClaimState.sinceTouch} turns positive, and asks the
 * sorcerer to cast.
 */
import * as THREE from "three";
import type { PieceKind } from "../../../core/types";
import { MysticBeam, type BeamLook } from "./beam";
import type { BeamBudget, Point } from "./beamPlan";
import { claimState, claimTimeline, returnState, type ClaimState, type ClaimTimeline } from "./claimPlan";
import { MysticLanding } from "./landing";

export interface ClaimOptions {
  budget: BeamBudget;
  /** The light of whoever takes the piece. */
  look: BeamLook;
  /** The colour of the fallen army's soul. */
  soul: number;
  /** What fell: a heavier piece is taken more slowly. */
  kind: PieceKind;
  /** The short form, for fast play and reduced motion. */
  brief?: boolean;
  /** Where the thread is held, asked every frame, so a hand that moves carries the thread with it. */
  hand(out: THREE.Vector3): THREE.Vector3;
  /** The body the thread lands on, and the stone it lies on. */
  body: Point;
  stone: Point;
  /** How much larger the thread's strands and rings are drawn at the hand than at the body (see farScale). */
  far?: number;
  /** The sigil's radius on the stone. */
  radius?: number;
  /**
   * The ritual taken back (an Undo returning the piece): it plays from its end to its start (claimPlan
   * returnState), and the light's own clock runs backwards with it, so the motes fall and the thread's light
   * runs the other way.
   */
  reverse?: boolean;
}

export class Claim {
  readonly object = new THREE.Group();
  private timelineNow: ClaimTimeline;
  private readonly beam: MysticBeam;
  private readonly landing: MysticLanding;
  private readonly hand = new THREE.Vector3();
  private seconds = 0;
  private last: ClaimState;

  constructor(private options: ClaimOptions) {
    this.timelineNow = claimTimeline(options.kind, options.brief === true);
    this.beam = new MysticBeam({ budget: options.budget, look: options.look, far: options.far ?? 1, radius: 0.1, ringSize: 0.34 });
    this.landing = new MysticLanding({ budget: options.budget, look: options.look, radius: options.radius });
    this.landing.setCentre(options.stone);
    this.object.add(this.beam.object, this.landing.object);
    this.last = this.read(0);
    this.apply(this.last);
  }

  get timeline(): ClaimTimeline { return this.timelineNow; }
  /** The buffers it was built for: a pooled claim is only reused at the same budget. */
  get budget(): BeamBudget { return this.options.budget; }

  /**
   * Takes another ritual from its first moment, reusing the beam and landing already built (A-26: a claim per
   * capture made eight materials and their objects, freed seconds later). The budget and look must be the ones
   * it was made with.
   */
  restart(options: ClaimOptions): void {
    this.options = options;
    this.timelineNow = claimTimeline(options.kind, options.brief === true);
    this.seconds = 0;
    this.beam.restart(options.far ?? 1);
    this.beam.setLook(options.look);
    this.landing.restart(options.stone, options.radius);
    this.landing.setLook(options.look);
    this.object.visible = true;
    this.last = this.read(0);
    this.apply(this.last);
  }

  /** What the ritual was doing at the last update. */
  get state(): ClaimState { return this.last; }
  get elapsed(): number { return this.seconds; }

  /** Advances the ritual and returns what it is now doing. `height` is the drawing buffer's height in pixels. */
  update(seconds: number, camera: THREE.PerspectiveCamera, height: number): ClaimState {
    this.seconds += seconds;
    this.last = this.read(this.seconds);
    this.apply(this.last);
    const clock = this.options.reverse ? -seconds : seconds;
    this.beam.update(clock, camera, height);
    this.landing.update(clock, camera, height);
    return this.last;
  }

  private read(seconds: number): ClaimState {
    return this.options.reverse ? returnState(this.timeline, seconds) : claimState(this.timeline, seconds);
  }

  /** Keeps its colours from clipping to white in a bright exposure (vfxGlow). */
  setGain(gain: number): void { this.beam.setGain(gain); this.landing.setGain(gain); }

  dispose(): void {
    this.beam.dispose(); this.landing.dispose();
    this.object.removeFromParent();
  }

  private apply(state: ClaimState): void {
    const { body } = this.options;
    this.beam.setEnds(this.options.hand(this.hand), body, 0.035);
    // a slow wind across the middle of the thread; the brief form holds still
    if (!this.timeline.brief) this.beam.setSway(Math.sin(this.seconds * 0.7) * 0.5, Math.sin(this.seconds * 0.45 + 1) * 0.25, 0);
    this.beam.setReach(state.reach); this.beam.setPower(state.power); this.beam.setFlow(state.flow);
    this.beam.setSoul(state.soul, this.options.soul);
    this.landing.setSigil(state.sigilDrawn, state.sigilGlow);
    this.landing.setShaft(state.shaft); this.landing.setRise(state.rise); this.landing.setBurst(state.sinceTouch);
  }
}
