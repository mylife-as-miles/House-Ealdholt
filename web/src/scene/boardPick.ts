import * as THREE from "three";

import type { PieceKind, SquareId } from "../core/types";
import { PIECE_HEIGHT } from "./pieces";

/**
 * Which square a press is meant for.
 *
 * Every figure is tested through an invisible box nearly as wide as its tile and taller than itself (pieces.ts),
 * which makes a figure easy to pick up. Seen from a player's seat that box also covers most of the tile behind it,
 * where nothing is drawn: with the nearest thing under the pointer always winning, a press on a lit destination was
 * answered by the figure standing a rank in front of it. From White's seat at the start of a game the four Knight
 * moves could be pressed on a twentieth of their tile, and nowhere near its middle.
 *
 * So a box is told apart from the figure inside it. The pointer is on a figure when its ray passes through the
 * figure's own body; anywhere else in the box it is only near one. What is pointed at then goes by what the player
 * sees and can act on:
 *
 * 1. a figure the pointer is on, if it can be played (a legal destination, or a piece of the side to move);
 * 2. else the tile under the pointer, if the piece in hand may go there;
 * 3. else a figure the pointer is near that stands on a legal destination;
 * 4. else a figure the pointer is near that can be picked up;
 * 5. else whatever is nearest, as before (a press on it is refused, or lets the piece in hand go).
 */
export interface FigureHit {
  square: SquareId;
  /** The ray passes through the figure itself, not only through the box round it. */
  body: boolean;
}

export interface PickInput {
  /** The figures whose boxes the ray enters, nearest first. */
  figures: readonly FigureHit[];
  /** The square of the board under the ray, past every figure; null off the board. */
  tile: SquareId | null;
  /** Whether the piece in hand may go to a square. Never true with nothing in hand. */
  wanted(square: SquareId): boolean;
  /** Whether a figure of the side that may move stands on a square. */
  own(square: SquareId): boolean;
}

export function resolvePick({ figures, tile, wanted, own }: PickInput): SquareId | null {
  const on = figures.find((hit) => hit.body && (wanted(hit.square) || own(hit.square)));
  if (on) return on.square;
  if (tile && wanted(tile)) return tile;
  const near = figures.find((hit) => wanted(hit.square)) ?? figures.find((hit) => own(hit.square));
  if (near) return near.square;
  return figures[0]?.square ?? tile;
}

/**
 * How wide a figure is taken to be, as a radius round its upright axis, in board units (a tile is 1.02 across). The
 * sculpts are people: about a third as wide as they are tall, a little more for the cloaked and the armoured.
 */
export const BODY_RADIUS: Record<PieceKind, number> = { p: 0.18, n: 0.22, b: 0.2, r: 0.22, q: 0.22, k: 0.24 };

const foot = new THREE.Vector3();
const head = new THREE.Vector3();

/**
 * Whether a ray passes through a figure standing at `position`: within its radius of its upright axis. The axis stops
 * a radius short of the top of the head, so the figure ends where the sculpt does and what shows over its head (the
 * Pawn standing behind a King, seen from the King's side) can be pointed at.
 */
export function rayOnBody(ray: THREE.Ray, position: THREE.Vector3, kind: PieceKind): boolean {
  const radius = BODY_RADIUS[kind];
  foot.copy(position);
  head.copy(position).setY(position.y + PIECE_HEIGHT[kind] - radius);
  return ray.distanceSqToSegment(foot, head) <= radius * radius;
}
