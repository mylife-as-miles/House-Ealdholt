/**
 * The Claiming, as a timeline: what the ritual that takes a fallen piece is doing at each moment. No Three.js in
 * here, so the node tests reach it (shared/play/mystic-claim.test.ts); mystic/claim.ts draws what this decides.
 *
 * A piece that has fallen is never lifted off the stone. A sigil is drawn round it, a thread of light comes down
 * from the sorcerer's hand, the body is unmade where it lies and rises as motes, its soul goes up the thread, and
 * the thread lets go. In order:
 *
 *   still    nothing moves: the body lies where it fell
 *   mark     the sigil is drawn on the stone, by a pen that goes once round
 *   thread   the thread comes down from the hand; `touch` is the moment it lands
 *   unmake   the body is unmade from its extremities inward, under a shaft of light
 *   soul     a knot of light in the fallen army's colour leaves the body and climbs the thread to the hand
 *   release  the thread thins and breaks; the sigil cools into the stone
 *
 * The brief form is for fast play and reduced motion: the sigil appears whole, a still shaft stands over the body
 * while it fades, and nothing travels.
 */
import type { PieceKind } from "../../../core/types";
import { smooth, type Point } from "./beamPlan";

export interface ClaimTimeline {
  /** The sigil's pen starts and finishes. */
  mark: readonly [number, number];
  /** The thread leaves the hand, and the moment it touches the body. */
  thread: readonly [number, number];
  /** The body starts to come apart, and is gone. */
  unmake: readonly [number, number];
  /** The soul leaves the body, and reaches the hand. Equal when nothing travels (the brief form). */
  soul: readonly [number, number];
  /** The thread starts to let go, and everything is over. */
  release: readonly [number, number];
  /** Seconds from the body settling to the square being clear. */
  total: number;
  brief: boolean;
}

/** How much longer the ritual runs for a heavier piece: a Queen is not taken as lightly as a Pawn. */
export const CLAIM_WEIGHT: Readonly<Record<PieceKind, number>> = { p: 1, n: 1.1, b: 1.1, r: 1.2, q: 1.35, k: 1.35 };

const scale = (times: readonly number[], by: number) => times.map((time) => +(time * by).toFixed(3));

/** The timeline for taking a piece of `kind`. `brief` is the short form (fast play, reduced motion). */
export function claimTimeline(kind: PieceKind, brief = false): ClaimTimeline {
  if (brief) return { mark: [0, 0], thread: [0, 0.2], unmake: [0.2, 0.9], soul: [0.9, 0.9], release: [0.8, 1.1], total: 1.1, brief: true };
  const [markStart, markEnd, threadStart, touch, unmakeStart, unmakeEnd, soulStart, soulEnd, releaseStart, total] =
    scale([0.35, 1.05, 0.9, 1.3, 1.4, 2.6, 2.3, 2.9, 2.95, 3.5], CLAIM_WEIGHT[kind]);
  return { mark: [markStart, markEnd], thread: [threadStart, touch], unmake: [unmakeStart, unmakeEnd], soul: [soulStart, soulEnd], release: [releaseStart, total], total, brief: false };
}

export interface ClaimState {
  /** How much of the sigil the pen has drawn, 0..1. */
  sigilDrawn: number;
  /** How brightly the sigil and the stone under it glow, 0..1: half lit once drawn, full once the thread touches. */
  sigilGlow: number;
  /** How far down from the hand the thread has reached, 0..1. */
  reach: number;
  /** The thread's strength, 0..1. */
  power: number;
  /** Which way light runs on the thread: 1 down to the body, -1 back up to the hand. */
  flow: 1 | -1;
  /** The shaft of light over the body, 0..1. */
  shaft: number;
  /** The motes rising off the body, 0..1. */
  rise: number;
  /** Seconds since the thread touched down, or -1 before it has. */
  sinceTouch: number;
  /** How far the body has been unmade, 0 whole to 1 gone. */
  unmade: number;
  /** Where the soul is on the thread (1 at the body, 0 at the hand), or null when it is not travelling. */
  soul: number | null;
  /** How brightly the hand that holds the thread burns, 0..1, with a flare as the soul arrives. */
  hand: number;
  done: boolean;
}

/** What the ritual is doing `seconds` after the body settled. */
export function claimState(timeline: ClaimTimeline, seconds: number): ClaimState {
  const { mark, thread, unmake, soul, release, total, brief } = timeline;
  const touch = thread[1];
  const leaving = smooth(release[0], release[1], seconds);
  const touched = seconds >= touch;
  const drawn = brief ? 1 : smooth(mark[0], mark[1], seconds);
  const travelling = !brief && seconds > soul[0] && seconds < soul[1];
  // the soul starts slowly out of the body and is fastest into the hand
  const climbed = travelling ? ((seconds - soul[0]) / (soul[1] - soul[0])) ** 1.8 : 0;
  const arrival = brief ? 0 : Math.exp(-(((seconds - soul[1]) / 0.16) ** 2));
  return {
    sigilDrawn: drawn,
    sigilGlow: Math.max(0, (brief ? 0.45 * smooth(0, 0.15, seconds) : 0.45 * drawn) + 0.55 * smooth(touch, touch + 0.15, seconds) - 0.85 * leaving),
    reach: brief ? 1 : smooth(thread[0], touch, seconds),
    power: (brief ? 0.6 * smooth(0, touch, seconds) : smooth(thread[0] - 0.05, thread[0] + 0.1, seconds)) * (1 - leaving),
    flow: seconds < touch + 0.2 ? 1 : -1,
    shaft: smooth(touch, touch + 0.4, seconds) * (1 - leaving),
    rise: smooth(unmake[0], unmake[0] + 0.4, seconds) * (1 - smooth(unmake[1], Math.min(unmake[1] + 0.5, total), seconds)),
    sinceTouch: touched ? seconds - touch : -1,
    unmade: smooth(unmake[0], unmake[1], seconds),
    soul: travelling ? 1 - climbed : null,
    hand: Math.min(1, 0.55 * smooth(thread[0] - 0.3, thread[0], seconds) * (1 - leaving) + arrival),
    done: seconds >= total,
  };
}

// ------------------------------------------------------------------ in a match

/**
 * The moments of a ritual the match acts on: the thread leaving the hand, landing on the body, the soul leaving
 * the body, the body being gone, the soul reaching the hand, and the end.
 */
export type ClaimMoment = "thread" | "touch" | "soul" | "gone" | "arrive" | "done";

/** When each moment falls, in the order the match hears of them. */
export function claimMoments(timeline: ClaimTimeline): readonly { moment: ClaimMoment; at: number }[] {
  const { thread, soul, unmake, total } = timeline;
  const moments: { moment: ClaimMoment; at: number }[] = [
    { moment: "thread", at: thread[0] }, { moment: "touch", at: thread[1] }, { moment: "soul", at: soul[0] },
    { moment: "gone", at: unmake[1] }, { moment: "arrive", at: soul[1] }, { moment: "done", at: total },
  ];
  // a stable sort: moments that fall together keep the order above
  return moments.map((entry, index) => ({ entry, index })).sort((a, b) => a.entry.at - b.entry.at || a.index - b.index).map(({ entry }) => entry);
}

/** The moments passed between two readings of the ritual's clock: after `from` (or at it, when `from` is 0), up to and including `to`. */
export function claimMomentsBetween(timeline: ClaimTimeline, from: number, to: number): ClaimMoment[] {
  return claimMoments(timeline).filter(({ at }) => (from <= 0 ? at >= 0 : at > from) && at <= to).map(({ moment }) => moment);
}

// ------------------------------------------------------------------ taken back

/**
 * The Claiming taken back, when an Undo returns a captured piece to its square: the ritual run backwards. The
 * thread stands again between the hand and the stone, the soul comes out of the hand and down it, the body is
 * remade from its heart outward as the motes fall back into it, and the thread goes back up into the hand while
 * the sigil is undrawn. It is the ritual's own state, read from its end towards its start; the drawing runs its
 * own clock backwards with it (mystic/claim.ts `reverse`).
 */
export function returnState(timeline: ClaimTimeline, seconds: number): ClaimState {
  const state = claimState(timeline, Math.max(0, timeline.total - Math.max(0, seconds)));
  return { ...state, done: seconds >= timeline.total };
}

/**
 * The moments of a return the match acts on: the thread standing again, the soul leaving the hand, the soul back
 * in the body, the body whole, and the end.
 */
export type ReturnMoment = "thread" | "soul" | "home" | "whole" | "done";

/** When each moment of a return falls: the ritual's own moments, backwards. */
export function returnMoments(timeline: ClaimTimeline): readonly { moment: ReturnMoment; at: number }[] {
  const { soul, unmake, total } = timeline;
  const back = (time: number) => +(total - time).toFixed(3);
  const moments: { moment: ReturnMoment; at: number }[] = [
    { moment: "thread", at: 0 }, { moment: "soul", at: back(soul[1]) }, { moment: "home", at: back(soul[0]) },
    { moment: "whole", at: back(unmake[0]) }, { moment: "done", at: total },
  ];
  return moments.map((entry, index) => ({ entry, index })).sort((a, b) => a.entry.at - b.entry.at || a.index - b.index).map(({ entry }) => entry);
}

/** The moments of a return passed between two readings of its clock, as {@link claimMomentsBetween}. */
export function returnMomentsBetween(timeline: ClaimTimeline, from: number, to: number): ReturnMoment[] {
  return returnMoments(timeline).filter(({ at }) => (from <= 0 ? at >= 0 : at > from) && at <= to).map(({ moment }) => moment);
}

/**
 * How long whoever holds the thread keeps its hands raised for a return, from when they are up: until the thread
 * has gone back into the hand.
 */
export function returnHold(timeline: ClaimTimeline): number {
  return Math.max(0.2, timeline.total - timeline.thread[0]);
}

/**
 * Where the thread is held when nobody stands over the board to hold it (an arena without the sorcerer, the
 * menu's board): high above the far side, out of any frame the player keeps, so it reads as coming from on high.
 */
export function skyHold(stone: Point): Point {
  return { x: stone.x * 0.35, y: stone.y + 22, z: stone.z - 9 };
}

/**
 * How much larger the thread is drawn at the hand than at the body, from how far away the hand is: a thread
 * forty squares long would be a hair at its far end without it.
 */
export function threadFar(hand: Point, body: Point): number {
  const length = Math.hypot(hand.x - body.x, hand.y - body.y, hand.z - body.z);
  return Math.min(4.5, Math.max(1, length / 9));
}

/**
 * How long whoever holds the thread keeps its hands raised, from the ritual's first moment: its arms take `rise`
 * seconds to come up, and they stay up until the thread starts to let go.
 */
export function castHold(timeline: ClaimTimeline, rise: number): number {
  return Math.max(0.2, timeline.release[0] - rise);
}

/** Whether the camera leaves the player's view to watch a claim: the first of a match, and every piece above a Pawn. */
export function claimIsWatched(kind: PieceKind, claimsSoFar: number): boolean {
  return claimsSoFar === 0 || kind !== "p";
}

export interface ClaimShot { position: Point; target: Point; fov: number }

export interface ClaimShotInput {
  /** The body, the hand that holds its thread, and the holder's face. */
  body: Point;
  hand: Point;
  face: Point;
  /** The height of the stone, the frame's width over its height, and how far from the board's centre the eye may stand. */
  boardTop: number;
  aspect: number;
  radius: number;
  /** A figure the frame should hold too (the fallen's strongest mourner, its head): the view turns and widens for it. */
  keep?: Point | null;
}

/** How the claim shot stands: this far behind the body and this high over the stone, with this much frame kept clear. */
export const CLAIM_SHOT = { back: 5.4, height: 3.1, margin: 7, fov: [36, 58] } as const;

/**
 * The shot that watches a claim: the eye stands behind the body on the line from the holder, above the heads of
 * the pieces round it, so the body lies low in the frame and the holder rises over it with the thread between.
 */
export function claimShot(input: ClaimShotInput): ClaimShot {
  const { body, hand, face, boardTop } = input;
  let dx = body.x - hand.x, dz = body.z - hand.z;
  const span = Math.hypot(dx, dz);
  if (span < 1e-6) { dx = 0; dz = 1; } else { dx /= span; dz /= span; }
  let x = body.x + dx * CLAIM_SHOT.back, z = body.z + dz * CLAIM_SHOT.back;
  const out = Math.hypot(x, z);
  if (out > input.radius) { x *= input.radius / out; z *= input.radius / out; }
  const eye = { x, y: boardTop + CLAIM_SHOT.height, z };
  const pitch = (point: Point) => Math.atan2(point.y - eye.y, Math.hypot(point.x - eye.x, point.z - eye.z));
  const top = Math.max(hand.y, face.y);
  const low = pitch({ x: body.x, y: boardTop, z: body.z }), high = pitch({ x: face.x, y: top, z: face.z });
  const degrees = 180 / Math.PI;
  const fov = Math.min(CLAIM_SHOT.fov[1], Math.max(CLAIM_SHOT.fov[0], (high - low) * degrees + 2 * CLAIM_SHOT.margin));
  // looked at along the line to the holder, at the pitch midway between the body and its face
  const middle = (low + high) / 2, reach = Math.hypot(body.x - eye.x, body.z - eye.z) || 1;
  const ahead = { x: (hand.x - eye.x), z: (hand.z - eye.z) }, far = Math.hypot(ahead.x, ahead.z) || 1;
  const shot = {
    position: eye,
    target: { x: eye.x + (ahead.x / far) * reach, y: eye.y + Math.tan(middle) * reach, z: eye.z + (ahead.z / far) * reach },
    fov,
  };
  return input.keep ? keepInFrame(shot, input.keep, input.aspect) : shot;
}

/** How far inside the frame's side edge a kept figure is held (degrees). */
const KEEP_MARGIN = 6;

/**
 * The claim shot turned and widened so a figure is in it too (a companion grieving beside the body): turned halfway
 * toward it and opened just enough to hold both, up to the widest lens; where even that cannot hold both, turned no
 * further than keeps the body and its thread in. A figure already inside the frame leaves the shot as it was.
 */
export function keepInFrame(shot: ClaimShot, keep: Point, aspect: number): ClaimShot {
  const rad = Math.PI / 180, eye = shot.position;
  const view = Math.atan2(shot.target.x - eye.x, shot.target.z - eye.z);
  let off = Math.atan2(keep.x - eye.x, keep.z - eye.z) - view;
  off = Math.atan2(Math.sin(off), Math.cos(off));
  const half = (fov: number) => Math.atan(Math.tan(fov * rad / 2) * aspect) - KEEP_MARGIN * rad;
  if (Math.abs(off) <= half(shot.fov)) return shot;
  // The lens that holds both with the turn split between them, within the claim shot's own lenses.
  const needed = 2 * Math.atan(Math.tan(Math.abs(off) / 2 + KEEP_MARGIN * rad) / aspect) / rad;
  const fov = Math.min(CLAIM_SHOT.fov[1], Math.max(shot.fov, needed));
  const turn = Math.sign(off) * Math.min(half(fov), Math.max(0, Math.abs(off) - half(fov)));
  const dx = shot.target.x - eye.x, dz = shot.target.z - eye.z, cos = Math.cos(turn), sin = Math.sin(turn);
  // Round the eye on the floor: a positive turn is toward +x from +z, as atan2(x, z) measures it.
  return { position: eye, target: { x: eye.x + dx * cos + dz * sin, y: shot.target.y, z: eye.z - dx * sin + dz * cos }, fov };
}

/** The close view of the holder: the frame is this many of its hand-to-face spans tall, between these lenses. */
export const CLAIM_CLOSE = { frame: 10, fov: [10, 26] } as const;

/**
 * The second beat of the claim shot: from the same place, a long lens on the one who holds the thread, so the
 * soul is seen to arrive in its hand. `reach` is how far ahead of the eye the view's target is put (orbit
 * controls measure their distance to it), not how far away the holder is.
 */
export function claimCloseShot(input: { eye: Point; hand: Point; face: Point; reach: number }): ClaimShot {
  const { eye, hand, face } = input;
  // the hand and the face both in the frame, the hand's side of the middle
  const aim = { x: (hand.x + face.x) / 2, y: Math.max(hand.y, face.y) - 0.2 * CLAIM_CLOSE.frame, z: (hand.z + face.z) / 2 };
  const away = Math.hypot(aim.x - eye.x, aim.y - eye.y, aim.z - eye.z) || 1;
  const degrees = 180 / Math.PI;
  const fov = Math.min(CLAIM_CLOSE.fov[1], Math.max(CLAIM_CLOSE.fov[0], 2 * Math.atan(CLAIM_CLOSE.frame / 2 / away) * degrees));
  const step = input.reach / away;
  return {
    position: { ...eye },
    target: { x: eye.x + (aim.x - eye.x) * step, y: eye.y + (aim.y - eye.y) * step, z: eye.z + (aim.z - eye.z) * step },
    fov,
  };
}

/** How long the camera stays on the holder after the soul has arrived, before it goes home. */
export const CLAIM_LINGER = 0.5;
