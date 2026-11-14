/**
 * A cinematic fatality (gore tier 3, gore/goreTiers.ts) as a directed sequence: the beats the fatality director
 * (fatality/FatalityDirector.ts) adds round a kill's killing blow. It never replaces the duel, the spell or the
 * summon that kills; it holds the blow:
 *
 * | Real seconds after the blow | Beat |
 * | --- | --- |
 * | 0 | the scene's time starts to slow (to a quarter, eased in), a low impact under the blow, the camera moves in on the wound |
 * | 0 to 1.4 | slow motion; the X-ray (fatality/anatomyPlan.ts XRAY): the skin goes ghostly, the bone at the wound cracks and shatters, the wound channel opens |
 * | about 1.1 | the camera goes back to the kill's own shot (which the Claiming's shot may then take over, as before) |
 * | about 1.4 | the scene runs at its own speed again |
 *
 * The beats run on the player's clock (the frame's real delta, which the film harness steps at fixed frames): the
 * slow motion is the scene's own time scale, applied by the engine to every system's delta (tweens, mixers, physics,
 * effects, spells, the rite). Sound keeps its own clock.
 *
 * A tier 2 kill that takes a limb off (death/sever) gets a light form of it, the cut ({@link SEVER_CUT}): a close
 * shot on the body and where the limb flies, held about a second and a half, then home or the Claiming's shot; no
 * slow motion and no X-ray, which stay a fatality's.
 *
 * Pure, no three.js: shared/play/fatality-plan.test.ts.
 */
import type { GoreShow } from "../gore/goreTiers";
import { riteShot, shotTurn, turnHome, type RiteShotView } from "../rites/riteShot";

export const FATALITY = {
  /** The scene's time at the heart of the beat: a quarter of real time. */
  slow: 0.25,
  /** Real seconds easing down into the slow motion, held there, and easing back out. */
  easeIn: 0.14, hold: 0.95, easeOut: 0.32,
  /** Real seconds the camera takes to move in on the wound, from the blow. */
  closeSeconds: 0.42,
  /** Real seconds after the blow the view goes back to the kill's own shot, and how long it takes. */
  backAt: 1.12, backSeconds: 0.7,
  /** The close shot: its lens (degrees, vertical) and the least it frames round the wound (scene units, a radius). */
  lens: 24, reach: 0.26,
  /**
   * A spell's fatality: the lens it frames the trunk on (degrees), and the least it frames round the chest (scene
   * units, a radius). A spell raises its own shapes round the piece, and the X-ray's bones are drawn over them, so the
   * shot holds the skeleton large rather than look for a gap: at the close shot's nearest (RITE_SHOT.close) a Pawn's
   * trunk fills about two thirds of the frame's height (a third, on 32 degrees and the rite's own 0.6).
   */
  spellLens: 26, spellReach: 0.42,
  /** The share of the figure's height kept in frame round the wound. */
  frame: 0.22,
  /** How loud the one low impact under the blow is (audio.groundSlam). */
  impact: 0.55,
  /** The share of the camera's shake kept while the close shot holds: a long lens on a slowed blow shows it all. */
  shake: 0.15,
} as const;

/** Real seconds from the blow until the director lets go: the slow motion is over and the camera is back. */
export const FATALITY_SECONDS = Math.max(FATALITY.easeIn + FATALITY.hold + FATALITY.easeOut, FATALITY.backAt + FATALITY.backSeconds);

/** What the director plays round a kill: a fatality's whole sequence, a sever's cut, or an ordinary fight's look at the body. */
export type SequenceKind = "fatality" | "cut" | "look";

/**
 * A tier 2 sever's cut: real seconds the camera takes to come in on the body and where the limb flies, how long it is
 * held, and how long it takes to go back; the steepnesses it may look down at (degrees, the first preferred).
 */
export const SEVER_CUT = { closeSeconds: 0.35, hold: 1.5, backSeconds: 0.8, downs: [16, 30, 44] } as const;

/**
 * An ordinary fight's look at the body (gore tier 1 and up, where neither a fatality nor a cut plays): as the killer
 * takes the square, the camera comes in on the body where it lies, near enough to see the wound painted into it (the
 * wound masks), holds a moment, and goes home or on to the Claiming. Without it the duel's camera follows the winner
 * and the wound is seen, if at all, at the edge of the frame. Real seconds in, held and back; its lens (degrees) and
 * the least it frames (a radius); the steepnesses it may look down at, the first preferred.
 */
export const WOUND_LOOK = { closeSeconds: 0.45, hold: 1.05, backSeconds: 0.6, lens: 24, reach: 0.3, downs: [38, 52, 24], near: 0.45 } as const;

/** Real seconds a sequence of this kind lasts, from its start until the director lets go. */
export function sequenceSeconds(kind: SequenceKind): number {
  return kind === "cut" ? SEVER_CUT.hold + SEVER_CUT.backSeconds : kind === "look" ? WOUND_LOOK.hold + WOUND_LOOK.backSeconds : FATALITY_SECONDS;
}

const smooth = (t: number): number => { const x = Math.min(1, Math.max(0, t)); return x * x * (3 - 2 * x); };

/** The scene's time scale `seconds` real seconds after the blow: 1, eased down to {@link FATALITY}.slow, held, eased back to 1. A cut and a look keep time. */
export function timeScaleAt(seconds: number, kind: SequenceKind = "fatality"): number {
  const { slow, easeIn, hold, easeOut } = FATALITY;
  if (!(seconds > 0) || kind !== "fatality") return 1;
  if (seconds < easeIn) return 1 + (slow - 1) * smooth(seconds / easeIn);
  if (seconds < easeIn + hold) return slow;
  if (seconds < easeIn + hold + easeOut) return slow + (1 - slow) * smooth((seconds - easeIn - hold) / easeOut);
  return 1;
}

/** Scene seconds that pass in the first `seconds` real seconds after the blow, stepped as the engine steps it. */
export function sceneSecondsAt(seconds: number, step = 1 / 120): number {
  let scene = 0;
  for (let t = 0; t < seconds; t += step) scene += timeScaleAt(t + step) * Math.min(step, seconds - t);
  return scene;
}

export type FatalityBeat = "close" | "back" | "end";

/**
 * The beats that fall after `from` and up to `to` real seconds after the blow, in order. `from` is negative before
 * the first update: the close shot is asked for on the frame of the blow.
 */
export function beatsBetween(from: number, to: number, kind: SequenceKind = "fatality"): FatalityBeat[] {
  const beats: FatalityBeat[] = [];
  const crossed = (at: number) => from < at && to >= at;
  if (crossed(0)) beats.push("close");
  if (crossed(kind === "cut" ? SEVER_CUT.hold : kind === "look" ? WOUND_LOOK.hold : FATALITY.backAt)) beats.push("back");
  if (crossed(sequenceSeconds(kind))) beats.push("end");
  return beats;
}

/**
 * Whether a kill plays its fatality: only where its gore tier shows one (a capture that mates, a Queen taking a
 * Queen, a side's last piece; at Full, with capture cinematics on and no reduced motion; never on the map or the
 * menu's board), and never in a fight the player has asked to hurry past.
 */
export function fatalityPlays(show: Pick<GoreShow, "fatality">, hurried: boolean): boolean {
  return show.fatality && !hurried;
}

/**
 * Whether a limb coming off gets the cut: a tier 2 kill (an execution) whose limb really came off, not hurried past. A
 * fatality keeps its whole sequence instead, and a sever below tier 2 does not happen (the tiers allow none).
 */
export function severCutPlays(show: Pick<GoreShow, "tier" | "sever">, hurried: boolean): boolean {
  return show.tier === 2 && show.sever && !hurried;
}

/**
 * Whether a killed body gets the look: its wound is shown (gore tier 1 and up: the wound masks), and the player has
 * not asked to hurry past the fight. The engine also wants its duel's shot still holding the camera, and the director
 * idle (a fatality or a cut already showed the body).
 */
export function woundLookPlays(show: Pick<GoreShow, "tier" | "cuts">, hurried: boolean): boolean {
  return show.tier >= 1 && show.cuts && !hurried;
}

/**
 * What the look keeps in frame: the wound (or, where it is not known, the chest) and the body round it as it lies, its
 * joints within {@link WOUND_LOOK}.near of its height of that point: the trunk the wound is in, not the whole body (the
 * first filming framed the whole of a Pawn lying, and its wound did not read).
 */
export function woundLookFrame(joints: readonly Point[], centre: Point, height: number): Point[] {
  const near = height * WOUND_LOOK.near;
  const close = joints.filter(p => Math.hypot(p.x - centre.x, p.y - centre.y, p.z - centre.z) <= near);
  return [{ x: centre.x, y: centre.y, z: centre.z }, ...close.map(p => ({ x: p.x, y: p.y, z: p.z }))];
}

/**
 * Whether the rank crests still wait once a close shot has let go of the camera (sceneEngine closeShotHolds), given that
 * shot's own camera and the one holding the camera now. They wait while the shot's own is still the camera (on its way
 * home, or kept on the body for the Claiming), and while a newer shot that took the camera from it (the Claiming's,
 * after a look) is still coming in from the close view. In the first filming of the look, they came back large as the
 * Claiming's shot rose from the body.
 */
export function closeShotWaits(own: object, now: { readonly phase: string } | null | undefined): boolean {
  return now === own || now?.phase === "in";
}

/** Where a thrown limb comes down on the stone: gravity alone, from where it was cut (scene units; Jolt's own fall). */
export function limbLanding(from: Point, velocity: Point, top: number, gravity = 9.81): Point {
  const height = Math.max(0, from.y - top);
  const t = (velocity.y + Math.sqrt(velocity.y * velocity.y + 2 * gravity * height)) / gravity;
  return { x: from.x + velocity.x * t, y: top, z: from.z + velocity.z * t };
}

/** How far round its stone a falling body may come to lie, a share of its height (severFrame's ring). */
export const BODY_FALL = 0.9;

/**
 * What a sever's cut keeps in frame: the body, from the stone to a little over its head, where the limb was cut, the
 * top of its arc and where it comes down, and every way the body may fall: a ring round the stone, {@link BODY_FALL}
 * of its height out. The way it falls cannot be told from the blow: in the first filmings of a Knight's cleaver the
 * head flew along the blow while the body fell across it, toward the camera, and lay cut off at the bottom of the
 * frame.
 */
export function severFrame(stone: Point, height: number, cut: Point, landing: Point, apex?: Point): Point[] {
  const ring: Point[] = [];
  for (let i = 0; i < 6; i += 1) {
    const angle = (i / 6) * Math.PI * 2;
    ring.push({ x: stone.x + Math.cos(angle) * height * BODY_FALL, y: stone.y, z: stone.z + Math.sin(angle) * height * BODY_FALL });
  }
  return [
    { x: stone.x, y: stone.y, z: stone.z }, { x: stone.x, y: stone.y + height * 1.08, z: stone.z },
    { ...cut }, { ...landing }, ...(apex ? [{ ...apex }] : []), ...ring,
  ];
}

export interface Point { x: number; y: number; z: number }

/** A figure standing on the board that may be in the way of the close shot: an upright cylinder. */
export interface Standing { x: number; z: number; radius: number; height: number }

export interface WoundShotInput {
  /** What to keep in frame, in place of the wound and a little round it (a sever's cut: the body and the limb's flight). */
  frame?: readonly Point[];
  /** The lens (degrees), the least the frame may be (a radius), and the steepnesses to try, in place of the fatality's. */
  lens?: number;
  reach?: number;
  downs?: readonly number[];
  /** Where the blow went in, and the height of the figure it went into. */
  wound: Point;
  height: number;
  /** The player's view: the shot is taken from its side. */
  home: { position: Point; target: Point };
  /** The killer and the victim: the shot turns off the line between them, to see the channel along its length. */
  from: Point;
  to: Point;
  boardTop: number;
  aspect: number;
  /** How far from the board's centre the eye may stand. */
  radius: number;
  /** Every other figure standing (the killer among them, the victim not). */
  standing: readonly Standing[];
  /** The victim's chest, kept in frame with the wound: the X-ray's ribs and the break are there. */
  chest?: Point;
}

export interface WoundShot {
  /** How far the shot is turned off the player's side (radians, as rites/riteShot.ts turnHome takes it) and how steeply it looks down (degrees). */
  turn: number;
  down: number;
  view: RiteShotView;
  /** The share of the sight lines to the wound a standing figure blocks, 0 to 1. */
  occlusion: number;
}

/**
 * The turns (radians, round the line-of-blow turn) and the steepness (degrees down) the close shot may take, the first
 * preferred. It looks down a good way by choice: over what a spell raises round the piece (the ice of a crown), and
 * over the figures in front.
 */
export const WOUND_SHOT = { turns: [0, 0.45, -0.45, 0.9, -0.9, 1.35, -1.35], downs: [30, 44, 16], spellDowns: [44, 30, 16] } as const;

/**
 * The share of the sight lines from an eye to points round the wound that pass through a standing figure. A spell's
 * close beats take the same test (rites/spellShot.ts).
 */
export function blocked(eye: Point, targets: readonly Point[], standing: readonly Standing[], boardTop: number): number {
  let hit = 0;
  for (const target of targets) {
    for (const figure of standing) {
      // Where the line comes nearest the figure's axis, on the ground plane, and whether it is low enough there to meet it.
      const dx = target.x - eye.x, dz = target.z - eye.z, l2 = dx * dx + dz * dz;
      const t = l2 < 1e-9 ? 0 : Math.min(1, Math.max(0, ((figure.x - eye.x) * dx + (figure.z - eye.z) * dz) / l2));
      if (t <= 0 || t >= 0.97) continue;
      const px = eye.x + dx * t, pz = eye.z + dz * t, y = eye.y + (target.y - eye.y) * t;
      if (Math.hypot(px - figure.x, pz - figure.z) < figure.radius && y < boardTop + figure.height) { hit += 1; break; }
    }
  }
  return hit / targets.length;
}

/**
 * The close shot on the wound: from the player's side, turned off the line of the blow, on the long lens, and of the
 * turns and steepnesses it may take ({@link WOUND_SHOT}) the one the fewest figures stand in front of, nearest the
 * preferred. The figures round a piece in the middle of the board otherwise hide the very wound the shot is for.
 */
export function woundShot(input: WoundShotInput): WoundShot {
  const frame = input.frame ? [...input.frame] : woundFrame(input.wound, input.height, input.chest);
  const lens = input.lens ?? FATALITY.lens, reach = input.reach ?? FATALITY.reach, downs = input.downs ?? WOUND_SHOT.downs;
  const base = shotTurn(input.home, input.from, input.to);
  const r = input.height * 0.12, w = input.wound;
  const targets = [w, { x: w.x, y: w.y + r, z: w.z }, { x: w.x, y: w.y - r, z: w.z }, { x: w.x + r, y: w.y, z: w.z }, { x: w.x - r, y: w.y, z: w.z }];
  let best: (WoundShot & { cost: number }) | null = null;
  for (const [order, offset] of WOUND_SHOT.turns.entries()) for (const down of downs) {
    const turn = base + offset;
    const view = riteShot(frame, { home: turnHome(input.home, turn), boardTop: input.boardTop, aspect: input.aspect, fov: lens, radius: input.radius, close: true, closeReach: reach, down });
    const occlusion = blocked(view.position, targets, input.standing, input.boardTop);
    const cost = occlusion * 10 + order * 0.25 + downs.indexOf(down) * 0.6;
    if (!best || cost < best.cost - 1e-9) best = { turn, down, view, occlusion, cost };
  }
  const { cost: _cost, ...shot } = best!;
  return shot;
}

/**
 * What the close shot keeps in frame (rites/riteShot.ts, close): the wound, and a little of the body round it, a
 * share of the figure's height ({@link FATALITY}.frame) on every side; and the chest, where one is given.
 */
export function woundFrame(wound: Point, height: number, chest?: Point): Point[] {
  const r = Math.max(0.05, height * FATALITY.frame);
  return [
    ...(chest ? [{ ...chest }] : []),
    { ...wound },
    { x: wound.x + r, y: wound.y, z: wound.z }, { x: wound.x - r, y: wound.y, z: wound.z },
    { x: wound.x, y: wound.y + r, z: wound.z }, { x: wound.x, y: Math.max(0, wound.y - r), z: wound.z },
    { x: wound.x, y: wound.y, z: wound.z + r }, { x: wound.x, y: wound.y, z: wound.z - r },
  ];
}
