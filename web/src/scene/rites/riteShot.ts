/**
 * The shot that watches a Queen's summon: how to frame what the rite says matters now (rites/rite.ts
 * RiteState.frame). No Three.js in here, so the node tests reach it (shared/play/rite-shot.test.ts).
 *
 * The eye is put on the player's own side of what it watches, so the board does not turn under the player, far
 * enough back that every point is in the frame. Over the board it looks a little down, as the player does; for
 * something high in the sky (a wyvern feeding in a hover) it stands lower and looks up at it. It never goes
 * below the stone or past the hall's wall: kept nearer, it widens the lens instead.
 */
import type { Point } from "../vfx/mystic/beamPlan";

export interface RiteShotView { position: Point; target: Point; fov: number }

export interface RiteShotInput {
  /** The player's view: the shot is taken from its side. */
  home: { position: Point; target: Point };
  /** The height of the stone. */
  boardTop: number;
  /** The frame's width over its height, and the lens the match is using (degrees, vertical). */
  aspect: number;
  fov: number;
  /** How far from the board's centre the eye may stand. */
  radius: number;
  /**
   * A kill watched up close (a body run through, which nothing throws): the eye may come as near as
   * {@link RITE_SHOT}.close, and what is watched may be as small as one figure.
   */
  close?: boolean;
  /**
   * With `close`: the smallest radius it lets what it watches be, in place of {@link RITE_SHOT}.closeReach. A
   * fatality's shot on the wound (fatality/fatalityPlan.ts) frames less than a whole figure, on a longer lens.
   */
  closeReach?: number;
  /**
   * Degrees the view looks down over the board, in place of {@link RITE_SHOT}.down: a fatality's shot on the wound
   * stands higher to look over the figures round it.
   */
  down?: number;
  /**
   * Degrees the view looks down at what it frames, whatever its height (up, if negative), in place of the turn from
   * looking down over the board to looking up at the sky: a body hung in the sky (the phoenix's hover) is seen from
   * under it, against the sky, not against the bird.
   */
  look?: number;
  /**
   * The side the eye stands on, as a flat direction from what it frames (need not be of unit length), in place of
   * the player's side: the phoenix's body in its talons is watched from behind the bird, between its legs.
   */
  facing?: { x: number; z: number };
}

export const RITE_SHOT = {
  /** The share of the half frame that what is watched may fill: the rest is kept clear round it. */
  fill: 0.8,
  /** How near and how far the eye stands from what it watches. */
  near: 4, far: 17,
  /** How near it may come on a kill watched up close, and the smallest it lets what it watches be (a radius). */
  close: 2.4, closeReach: 0.6,
  /** Degrees the view looks down over the board, and up at something high in the sky. */
  down: 16, up: 10,
  /** Heights above the stone between which the view turns from looking down to looking up. */
  low: 2.5, high: 6,
  /** The eye stays at least this far above the stone. */
  floor: 1.4,
  /** The widest lens the shot will use when the wall keeps it near. */
  widest: 64,
  /**
   * A spell's shot turns off the line from the caster to the piece once its view runs this close along it (the
   * cosine of the angle between them), and turns at most this far (radians) when it runs straight along it.
   */
  aligned: 0.7, turn: 0.62,
} as const;

const DEG = Math.PI / 180;
const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

/**
 * How far to turn a shot about the vertical (radians, as {@link turnHome} takes it) so that one figure does not
 * stand between the eye and another: a caster in front of the piece it casts at, seen from behind, or the piece in
 * front of its caster. None while the line between them crosses the view; up to {@link RITE_SHOT}.turn as the view
 * comes to run straight along it. It turns the way that takes the view further off the line; a line dead along the
 * view turns the eye toward the middle of the hall.
 */
export function shotTurn(home: { position: Point; target: Point }, from: Point, to: Point): number {
  let vx = home.position.x - home.target.x, vz = home.position.z - home.target.z;
  const reach = Math.hypot(vx, vz);
  let lx = to.x - from.x, lz = to.z - from.z;
  const span = Math.hypot(lx, lz);
  if (reach < 1e-6 || span < 1e-6) return 0;
  vx /= reach; vz /= reach; lx /= span; lz /= span;
  const amount = clamp((Math.abs(vx * lx + vz * lz) - RITE_SHOT.aligned) / (1 - RITE_SHOT.aligned), 0, 1);
  if (amount === 0) return 0;
  const turn = RITE_SHOT.turn * amount;
  const along = (angle: number) => { const c = Math.cos(angle), s = Math.sin(angle); return Math.abs((vx * c + vz * s) * lx + (-vx * s + vz * c) * lz); };
  const a = along(turn), b = along(-turn);
  if (Math.abs(a - b) > 1e-6) return a < b ? turn : -turn;
  // Dead along the line: whichever way puts the eye nearer the middle of the hall.
  const eye = (angle: number) => { const c = Math.cos(angle), s = Math.sin(angle); return Math.hypot(home.target.x + (vx * c + vz * s) * reach, home.target.z + (-vx * s + vz * c) * reach); };
  return eye(turn) <= eye(-turn) ? turn : -turn;
}

/** The player's view turned about its target by `angle` radians: a shot is then taken from that side. */
export function turnHome<T extends { position: Point; target: Point }>(home: T, angle: number): T {
  if (angle === 0) return home;
  const dx = home.position.x - home.target.x, dz = home.position.z - home.target.z, c = Math.cos(angle), s = Math.sin(angle);
  return { ...home, position: { x: home.target.x + dx * c + dz * s, y: home.position.y, z: home.target.z - dx * s + dz * c } };
}

/** Where the camera stands and looks to keep `points` in the frame. `points` must not be empty. */
export function riteShot(points: readonly Point[], input: RiteShotInput): RiteShotView {
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
  }
  const centre = { x: (minX + maxX) / 2, y: (minY + maxY) / 2, z: (minZ + maxZ) / 2 };
  let reach = input.close ? Math.max(0.01, input.closeReach ?? RITE_SHOT.closeReach) : 1.2;
  for (const p of points) reach = Math.max(reach, Math.hypot(p.x - centre.x, p.y - centre.y, p.z - centre.z));

  // How much of the frame the points may take: the narrower of its two half angles.
  const vertical = (input.fov / 2) * DEG;
  const horizontal = Math.atan(Math.tan(vertical) * input.aspect);
  const usable = Math.min(vertical, horizontal) * RITE_SHOT.fill;
  const wanted = clamp(reach / Math.sin(usable), input.close ? RITE_SHOT.close : RITE_SHOT.near, RITE_SHOT.far);

  // From the player's side (or the side the beat asks for), looking down over the board and up at the sky.
  let dx = input.facing ? input.facing.x : input.home.position.x - input.home.target.x;
  let dz = input.facing ? input.facing.z : input.home.position.z - input.home.target.z;
  const flat = Math.hypot(dx, dz);
  if (flat < 1e-6) { dx = 0; dz = 1; } else { dx /= flat; dz /= flat; }
  const height = centre.y - input.boardTop;
  const turn = clamp((height - RITE_SHOT.low) / (RITE_SHOT.high - RITE_SHOT.low), 0, 1);
  const down = input.down ?? RITE_SHOT.down;
  const elevation = (input.look ?? down + (-RITE_SHOT.up - down) * turn) * DEG;
  const eyeY = Math.max(input.boardTop + RITE_SHOT.floor, centre.y + wanted * Math.sin(elevation));
  let across = Math.sqrt(Math.max(0, wanted * wanted - (eyeY - centre.y) ** 2));

  // Not past the wall: the furthest the eye can stand along that line from what it watches.
  const ex = centre.x + dx * across, ez = centre.z + dz * across;
  if (Math.hypot(ex, ez) > input.radius) {
    const b = centre.x * dx + centre.z * dz, c = centre.x * centre.x + centre.z * centre.z - input.radius * input.radius;
    across = Math.max(0, -b + Math.sqrt(Math.max(0, b * b - c)));
  }
  const position = { x: centre.x + dx * across, y: eyeY, z: centre.z + dz * across };
  const distance = Math.hypot(position.x - centre.x, position.y - centre.y, position.z - centre.z);

  // Kept nearer than it wanted: the lens widens to take everything in, as far as it may.
  let fov = input.fov;
  if (distance < wanted - 1e-6) {
    const half = Math.asin(Math.min(1, reach / Math.max(distance, 1e-6))) / RITE_SHOT.fill;
    const byWidth = Math.atan(Math.tan(half) / input.aspect);
    fov = clamp(2 * Math.max(half, input.aspect >= 1 ? 0 : byWidth) / DEG, input.fov, RITE_SHOT.widest);
  }
  return { position, target: centre, fov };
}
