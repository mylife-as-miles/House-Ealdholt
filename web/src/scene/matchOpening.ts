/**
 * The camera performance before a match's first move: a list of shots, each a cut to one pose and a move to another,
 * run on the render clock. It owns no camera, actors, chess state or audio: each frame the engine asks it where the
 * camera stands and how far each army has taken the field (compare checkmatePresentation.ts and the duel camera).
 * What the shots are is decided elsewhere (shared/play/match-opening.ts).
 */
export type OpeningVector = readonly [number, number, number];
export interface OpeningPose {
  position: OpeningVector;
  target: OpeningVector;
  /** Vertical field of view in degrees; left out, the lens the match is played with. */
  fov?: number;
  /** A lift on the match's exposure (left out, 1): for a shot that looks into the arena's darker end. */
  exposure?: number;
}
export type OpeningEase = "linear" | "in" | "out" | "in-out";
export type OpeningSide = "w" | "b";
/** Where an army's wave starts: one flank (it crosses to the other), or both flanks at once (it closes on the King
 * and Queen, who stand last). */
export type OpeningMusterFrom = "a" | "h" | "flanks";
export interface OpeningMuster {
  side: OpeningSide;
  from: OpeningMusterFrom;
  /** When in the shot the wave starts and ends, as fractions of it (default 0.08 and 0.9). */
  start?: number;
  end?: number;
}
export interface OpeningShot {
  from: OpeningPose;
  /** "rest" is the framing the match is played from, which the engine solves for the screen. */
  to: OpeningPose | "rest";
  seconds: number;
  ease?: OpeningEase;
  /** "orbit" swings the camera round its target instead of sliding it in a straight line. */
  path?: "line" | "orbit";
  /** The army that takes the field during this shot. An army no shot musters stands from the start. */
  muster?: OpeningMuster;
  /** Depth of field: the distance from the camera held sharp (left out, none is asked for). */
  focus?: number;
}
export interface OpeningRest { position: OpeningVector; target: OpeningVector; fov: number }
export interface OpeningSample {
  /** Index of the shot on screen. */
  shot: number;
  position: [number, number, number];
  target: [number, number, number];
  fov: number;
  /** The exposure lift at this moment (1 at rest). */
  exposure: number;
  focus: number | null;
  /** How far each army's wave has run: 0 none of it stands yet, 1 all of it. */
  muster: Record<OpeningSide, number>;
  /** Where each army's wave runs from. */
  musterFrom: Record<OpeningSide, OpeningMusterFrom>;
  done: boolean;
}

const EASE: Record<OpeningEase, (t: number) => number> = {
  linear: t => t,
  in: t => t * t,
  out: t => 1 - (1 - t) * (1 - t),
  "in-out": t => t * t * (3 - 2 * t),
};
const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const mix = (a: number, b: number, t: number) => a + (b - a) * t;

/**
 * How whole one figure is (0 not there, 1 standing) when its army's wave has run `wave` of the way. From one flank the
 * wave crosses the files in turn, each Pawn forming a beat behind the officer it stands before. From both flanks it
 * closes on the middle, the Pawns a beat ahead, so the last to stand are the King and Queen.
 */
export function musterReveal(wave: number, file: number, pawn: boolean, from: OpeningMusterFrom): number {
  const order = from === "flanks" ? (3.5 - Math.abs(file - 3.5)) / 3 : (from === "a" ? file : 7 - file) / 7;
  const start = order * 0.58 + (pawn === (from !== "flanks") ? 0.08 : 0);
  return clamp01((clamp01(wave) - start) / 0.34);
}

export class MatchOpeningTimeline {
  private elapsed = 0;
  private readonly starts: number[] = [];
  readonly duration: number;

  constructor(private readonly shots: readonly OpeningShot[], private readonly rest: OpeningRest) {
    let at = 0;
    for (const shot of shots) { this.starts.push(at); at += Math.max(0.001, shot.seconds); }
    this.duration = at;
  }

  get done(): boolean { return this.elapsed >= this.duration; }
  get time(): number { return this.elapsed; }

  /** Moves on by a frame's delta (ignoring a delta that is not a forward step) and says where things stand. */
  update(delta: number): OpeningSample {
    if (Number.isFinite(delta) && delta > 0) this.elapsed = Math.min(this.duration, this.elapsed + delta);
    return this.sample();
  }

  /** Jumps to a moment of the performance. */
  seek(seconds: number): OpeningSample {
    if (Number.isFinite(seconds)) this.elapsed = Math.min(this.duration, Math.max(0, seconds));
    return this.sample();
  }

  /** Jumps to the end: the camera at rest, both armies standing. */
  skip(): OpeningSample { this.elapsed = this.duration; return this.sample(); }

  private pose(pose: OpeningPose | "rest"): Required<OpeningPose> {
    return pose === "rest" ? { ...this.rest, exposure: 1 } : { position: pose.position, target: pose.target, fov: pose.fov ?? this.rest.fov, exposure: pose.exposure ?? 1 };
  }

  sample(): OpeningSample {
    const done = this.done || this.shots.length === 0;
    const muster: Record<OpeningSide, number> = { w: 1, b: 1 }, musterFrom: Record<OpeningSide, OpeningMusterFrom> = { w: "a", b: "a" };
    if (done) return { shot: Math.max(0, this.shots.length - 1), position: [...this.rest.position], target: [...this.rest.target], fov: this.rest.fov, exposure: 1, focus: null, muster, musterFrom, done: true };
    let index = this.shots.length - 1;
    while (index > 0 && this.starts[index]! > this.elapsed) index--;
    const shot = this.shots[index]!, local = clamp01((this.elapsed - this.starts[index]!) / Math.max(0.001, shot.seconds));
    // Each army: standing once its shot is past, absent before it, in between while it plays.
    this.shots.forEach((other, at) => {
      if (!other.muster) return;
      const { side, from, start = 0.08, end = 0.9 } = other.muster;
      musterFrom[side] = from;
      muster[side] = at < index ? 1 : at > index ? 0 : clamp01((local - start) / Math.max(0.001, end - start));
    });
    const t = EASE[shot.ease ?? "in-out"](local), from = this.pose(shot.from), to = this.pose(shot.to);
    const target: [number, number, number] = [mix(from.target[0], to.target[0], t), mix(from.target[1], to.target[1], t), mix(from.target[2], to.target[2], t)];
    let position: [number, number, number];
    if (shot.path === "orbit") {
      // Round the target: distance, height angle and bearing each go their own way, the bearing by the shorter turn.
      const a = spherical(from.position, from.target), b = spherical(to.position, to.target);
      let turn = b.bearing - a.bearing;
      if (turn > Math.PI) turn -= 2 * Math.PI; else if (turn < -Math.PI) turn += 2 * Math.PI;
      const radius = mix(a.radius, b.radius, t), lift = mix(a.lift, b.lift, t), bearing = a.bearing + turn * t;
      position = [target[0] + radius * Math.cos(lift) * Math.sin(bearing), target[1] + radius * Math.sin(lift), target[2] + radius * Math.cos(lift) * Math.cos(bearing)];
    } else position = [mix(from.position[0], to.position[0], t), mix(from.position[1], to.position[1], t), mix(from.position[2], to.position[2], t)];
    return { shot: index, position, target, fov: mix(from.fov, to.fov, t), exposure: mix(from.exposure, to.exposure, t), focus: shot.focus ?? null, muster, musterFrom, done: false };
  }
}

function spherical(position: OpeningVector, target: OpeningVector): { radius: number; lift: number; bearing: number } {
  const x = position[0] - target[0], y = position[1] - target[1], z = position[2] - target[2];
  const radius = Math.max(1e-6, Math.hypot(x, y, z));
  return { radius, lift: Math.asin(Math.min(1, Math.max(-1, y / radius))), bearing: Math.atan2(x, z) };
}
