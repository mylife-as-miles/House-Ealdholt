/**
 * Keeping the summons' shots clear of the pieces in front of them. No Three.js in here, so the node tests reach it
 * (shared/play/rite-armies.test.ts).
 *
 * The match frames what a rite names from the player's side (rites/riteShot.ts): the eye stands along the line
 * from the player through the middle of what is framed, looking a little down. An army fights on the board, so that
 * line runs low over the pieces between the player and the victim, and a piece standing on the victim's own file
 * (its rank badge with it) fills the bottom of the shot. Sliding the whole frame a little sideways moves the eye off
 * that line without changing what is in frame: the victim sits a few degrees off the middle and the pieces in front
 * stand to either side of it.
 */
import type { Point } from "../../vfx/mystic/beamPlan";
import { riteShot } from "../riteShot";
import type { Flat } from "./crowdPlan";

export interface ClearShotOptions {
  standing: readonly Flat[];
  /** Where the player watches from. */
  viewer: Point;
  boardTop: number;
  /** How tall a piece and its badge stand. */
  height?: number;
  /** The frame's shape and lens, and how far from the board's middle the eye may stand: the match's, about. */
  aspect?: number;
  fov?: number;
  radius?: number;
  /** The sideways slides tried, in board units, nearest first. */
  slides?: readonly number[];
  /** What must not be hidden besides the middle of the frame, where it really is: the victim's body, say. */
  subject?: readonly Point[];
}

/** How near the line from `eye` to `target` passes to any piece standing between them, below its badge's top. */
export function sightClearance(eye: Point, target: Point, standing: readonly Flat[], boardTop: number, height = 2.05): number {
  let nearest = Infinity;
  for (let k = 1; k <= 24; k += 1) {
    const u = k / 25;
    const x = eye.x + (target.x - eye.x) * u, y = eye.y + (target.y - eye.y) * u, z = eye.z + (target.z - eye.z) * u;
    if (y > boardTop + height) continue;
    for (const piece of standing) nearest = Math.min(nearest, Math.hypot(piece.x - x, piece.z - z));
  }
  return nearest;
}

/**
 * The frame slid sideways (square to the player's line) by whichever of `slides` leaves the eye's line of sight
 * clearest of the pieces in front, preferring the smallest slide that does. The frame comes back unchanged when it
 * is already clear.
 */
export function clearFrame(frame: readonly Point[], options: ClearShotOptions): Point[] {
  if (frame.length === 0) return [];
  const { standing, viewer, boardTop } = options;
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const p of frame) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z); }
  const middle = { x: (minX + maxX) / 2, y: boardTop, z: (minZ + maxZ) / 2 };
  let way = { x: viewer.x - middle.x, z: viewer.z - middle.z };
  const length = Math.hypot(way.x, way.z);
  way = length > 1e-6 ? { x: way.x / length, z: way.z / length } : { x: 0, z: 1 };
  const side = { x: -way.z, z: way.x };
  const input = { home: { position: viewer, target: middle }, boardTop, aspect: options.aspect ?? 16 / 9, fov: options.fov ?? 46, radius: options.radius ?? 10.6 };
  let best: Point[] = frame.map((p) => ({ ...p })), bestScore = -Infinity;
  for (const slide of options.slides ?? [0, 0.45, -0.45, 0.8, -0.8]) {
    const moved = frame.map((p) => ({ x: p.x + side.x * slide, y: p.y, z: p.z + side.z * slide }));
    const shot = riteShot(moved, input);
    // the middle of the frame, and every point of the subject, must be seen past the pieces in front
    let clear = sightClearance(shot.position, shot.target, standing, boardTop, options.height);
    for (const p of options.subject ?? []) clear = Math.min(clear, sightClearance(shot.position, p, standing, boardTop, options.height));
    clear = Math.min(0.7, clear);
    const score = clear - 0.12 * Math.abs(slide);
    if (score > bestScore + 1e-9) { bestScore = score; best = moved; }
  }
  return best;
}
