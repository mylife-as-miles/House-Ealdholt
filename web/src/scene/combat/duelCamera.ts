/**
 * The duel camera: where the match camera stands to watch two figures fight,
 * and how it gets there and back.
 *
 * Two pure pieces, free of three.js and of the engine, so both run in node
 * tests:
 *
 *  - {@link planDuelShot} picks one camera position, target and lens for a
 *    fight. It frames both fighters at about half the frame height from a
 *    three-quarter angle, looking slightly down, from the player's own side of
 *    the line the blow travels on (left stays left), and of the angles it may
 *    use it takes the one the fewest standing pieces block. When the fight
 *    tells it where the killing blow will land, an angle from which the
 *    killer's own body, shield or arm hides that point is passed over, and the
 *    line is crossed only if no angle on the player's side shows it. Same
 *    input, same shot: there is no randomness.
 *
 *  - {@link DuelCameraTimeline} is the move itself: ease in, hold, a small
 *    push-in on the killing blow, hold, ease back. It is advanced with the
 *    frame delta the fight's own clock is advanced with, and it ends on the
 *    home pose exactly, not near it.
 *
 * Nothing here is specific to Pawns: any capture that has an attacker, a
 * victim and a blow direction can ask for a shot.
 */

export interface Vec3 { x: number; y: number; z: number }
export interface CameraPose { position: Vec3; target: Vec3; fov: number }

/** A standing piece that may be in the way: an upright cylinder on the board. */
export interface DuelObstacle { x: number; z: number; radius: number; height: number }

export interface DuelShotInput {
  /** Where the attacker sets off from. Only used to keep its walk-in in view. */
  attackerStart: Vec3;
  /** Where the attacker fights from. */
  standoff: Vec3;
  /** Where the victim stands. */
  victim: Vec3;
  /** Ground direction the blow travels in (attacker towards victim). Need not be unit length. */
  blow: { x: number; z: number };
  attackerHeight: number;
  victimHeight: number;
  /** Half the width of a fighter with its weapon out. */
  reach?: number;
  /** How far past its square the body lands, along the blow. */
  fallReach?: number;
  /** The player's lens: vertical field of view in degrees, and width over height. */
  fov: number;
  aspect: number;
  /** The player's view right now. */
  camera: { position: Vec3; target: Vec3 };
  bounds: {
    /** Height of the board surface. */
    floor: number;
    /** The eye stays inside this ground radius of the arena's centre (x = z = 0). */
    radius: number;
    /** Lowest the eye may sit above the board. */
    clearance?: number;
  };
  /** Every other piece left standing. Never the two fighters. */
  obstacles: readonly DuelObstacle[];
  /**
   * The killing blow, as far as it is known before the fight: where the weapon
   * meets the body, and what of the two fighters stands round that point at
   * that moment. A shot from which the sight line to the contact is blocked is
   * only taken when every other one is worse.
   */
  kill?: DuelKill;
  /** Share of the frame height the taller fighter should take. */
  fill?: number;
  /** How far above the middle of the frame the fight sits, as a share of the half frame (the HUD covers the bottom). */
  rise?: number;
}

/**
 * A part of a fighter at the killing blow: everything within `radius` of the
 * segment from `a` to `b`. With `normal` it is a shield instead: a flat disc of
 * that radius centred on `a` and facing along `normal`.
 */
export interface DuelBody { a: Vec3; b: Vec3; radius: number; normal?: Vec3 }
export interface DuelKill {
  /** Where the weapon enters. */
  contact: Vec3;
  /** Where the victim stands when he is struck, if the fight has moved him off his square: the fall is framed from there. */
  victimAt?: Vec3;
  /** The killer's trunk, head, shield and weapon arm as he strikes, and the victim's own trunk and shield. */
  bodies: readonly DuelBody[];
}

export interface DuelShot extends CameraPose {
  /** False when one of the fighters' own bodies stands between the eye and the point the weapon enters (true when the blow is not known). */
  killSeen: boolean;
  /** Where the eye stands after the push-in on the killing blow. */
  push: Vec3;
  /** Which side of the blow line the eye is on: the sign of its offset along {@link lineNormal}. */
  side: 1 | -1;
  /** Degrees off the pure profile view: positive leans behind the attacker. */
  lean: number;
  /** Degrees the view looks down. */
  pitch: number;
  distance: number;
  /** Share of the sight lines to the fighters that a standing piece blocks, 0 to 1. */
  occlusion: number;
  /** Share of the frame height the taller fighter takes. */
  fill: number;
  /** True when the arena wall forced the eye closer than the framing wanted. */
  confined: boolean;
}

export const DUEL_SHOT = {
  fill: 0.55,
  /** Frame edge kept clear around everything that must be seen, as a share of the half frame. */
  margin: 0.1,
  /** The eye closes this share of its distance on the killing blow. */
  push: 0.08,
  leans: [40, 55, 25],
  /** The lean preferred when the killing blow is known: nearer the profile, where the gap between the two bodies is widest. */
  killLean: 25,
  pitches: [26, 33],
  minFov: 30,
  maxFov: 50,
  minDistance: 1.2,
  clearance: 0.3,
  reach: 0.3,
  /** The fight sits this share of the half frame above its middle: the caption and the move list cover the bottom edge. */
  rise: 0.16,
  /** What a hidden kill costs a candidate: more than any angle or pitch preference, less than the arena wall. */
  hiddenKill: 8,
  /** What it costs to cross the line of the blow to the far side from the player: only paid to see the kill. */
  crossLine: 5,
} as const;

const RAD = Math.PI / 180;
const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
const along = (origin: Vec3, direction: Vec3, distance: number): Vec3 => ({
  x: origin.x + direction.x * distance, y: origin.y + direction.y * distance, z: origin.z + direction.z * distance,
});
const clamp = (value: number, low: number, high: number): number => Math.min(high, Math.max(low, value));
const lerp = (a: number, b: number, t: number): number => a * (1 - t) + b * t;
const mix = (a: Vec3, b: Vec3, t: number): Vec3 => ({ x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), z: lerp(a.z, b.z, t) });

/** The blow direction as a unit ground vector (towards +z when it has no length). */
export function blowAxis(blow: { x: number; z: number }): { x: number; z: number } {
  const length = Math.hypot(blow.x, blow.z);
  return length < 1e-9 ? { x: 0, z: 1 } : { x: blow.x / length, z: blow.z / length };
}

/** The ground normal of the blow line. Which side a point is on is the sign of its offset along this. */
export function lineNormal(blow: { x: number; z: number }): { x: number; z: number } {
  const axis = blowAxis(blow);
  return { x: -axis.z, z: axis.x };
}

/** The middle of the fight: between the fighters, at half the taller one's height. */
export function duelFocus(input: Pick<DuelShotInput, "standoff" | "victim" | "attackerHeight" | "victimHeight" | "bounds">): Vec3 {
  return {
    x: (input.standoff.x + input.victim.x) / 2,
    y: input.bounds.floor + Math.max(input.attackerHeight, input.victimHeight) * 0.5,
    z: (input.standoff.z + input.victim.z) / 2,
  };
}

/** Where a world point lands in a view: x and y from -1 to 1 across the frame, and its depth. */
export function projectToFrame(view: CameraPose, aspect: number, point: Vec3): { x: number; y: number; depth: number } {
  const basis = viewBasis(sub(view.target, view.position));
  const offset = sub(point, view.position);
  const depth = dot(offset, basis.forward);
  const tanV = Math.tan(view.fov * RAD / 2);
  return { x: dot(offset, basis.right) / (depth * tanV * aspect), y: dot(offset, basis.up) / (depth * tanV), depth };
}

function viewBasis(look: Vec3): { forward: Vec3; right: Vec3; up: Vec3 } {
  const length = Math.hypot(look.x, look.y, look.z) || 1;
  const forward = { x: look.x / length, y: look.y / length, z: look.z / length };
  // right = forward x world-up; a view straight down has no right, so pick one.
  let right = { x: -forward.z, y: 0, z: forward.x };
  const flat = Math.hypot(right.x, right.z);
  right = flat < 1e-9 ? { x: 1, y: 0, z: 0 } : { x: right.x / flat, y: 0, z: right.z / flat };
  const up = {
    x: right.y * forward.z - right.z * forward.y,
    y: right.z * forward.x - right.x * forward.z,
    z: right.x * forward.y - right.y * forward.x,
  };
  return { forward, right, up };
}

/** True when the straight line between two points passes through a standing piece. */
export function sightBlocked(eye: Vec3, point: Vec3, obstacle: DuelObstacle, floor = 0): boolean {
  const dx = point.x - eye.x, dz = point.z - eye.z;
  const ox = eye.x - obstacle.x, oz = eye.z - obstacle.z;
  const a = dx * dx + dz * dz, b = 2 * (ox * dx + oz * dz), c = ox * ox + oz * oz - obstacle.radius * obstacle.radius;
  let enter = 0, leave = 1;
  if (a < 1e-12) { if (c > 0) return false; } else {
    const root = b * b - 4 * a * c;
    if (root <= 0) return false;
    const spread = Math.sqrt(root);
    enter = Math.max(0, (-b - spread) / (2 * a)); leave = Math.min(1, (-b + spread) / (2 * a));
    if (enter >= leave) return false;
  }
  // Inside the cylinder's footprint between `enter` and `leave`: blocked if the line dips below its top there.
  const lowest = Math.min(lerp(eye.y, point.y, enter), lerp(eye.y, point.y, leave));
  return lowest < floor + obstacle.height;
}

/** The shortest distance between two segments. */
export function segmentDistance(p1: Vec3, q1: Vec3, p2: Vec3, q2: Vec3): number {
  const d1 = sub(q1, p1), d2 = sub(q2, p2), r = sub(p1, p2);
  const a = dot(d1, d1), e = dot(d2, d2), f = dot(d2, r);
  let s = 0, t = 0;
  if (a <= 1e-12 && e <= 1e-12) return Math.hypot(r.x, r.y, r.z);
  if (a <= 1e-12) t = clamp(f / e, 0, 1);
  else {
    const c = dot(d1, r);
    if (e <= 1e-12) s = clamp(-c / a, 0, 1);
    else {
      const b = dot(d1, d2), denominator = a * e - b * b;
      s = denominator > 1e-12 ? clamp((b * f - c * e) / denominator, 0, 1) : 0;
      t = (b * s + f) / e;
      if (t < 0) { t = 0; s = clamp(-c / a, 0, 1); } else if (t > 1) { t = 1; s = clamp((b - c) / a, 0, 1); }
    }
  }
  const gap = sub(along(p1, d1, s), along(p2, d2, t));
  return Math.hypot(gap.x, gap.y, gap.z);
}

/** True when nothing of the two fighters stands on the straight line from the eye to where the weapon enters. */
export function killVisible(eye: Vec3, kill: DuelKill): boolean {
  // The last few centimetres are the wound itself and the steel in it.
  const length = Math.hypot(eye.x - kill.contact.x, eye.y - kill.contact.y, eye.z - kill.contact.z);
  if (length < 1e-6) return false;
  const near = mix(kill.contact, eye, Math.min(1, 0.05 / length));
  return !kill.bodies.some(body => body.normal ? crossesDisc(eye, near, body.a, body.normal, body.radius) : segmentDistance(eye, near, body.a, body.b) < body.radius);
}

/** True when the segment from `p` to `q` passes through a disc. */
function crossesDisc(p: Vec3, q: Vec3, centre: Vec3, normal: Vec3, radius: number): boolean {
  const from = dot(sub(p, centre), normal), to = dot(sub(q, centre), normal);
  if (from * to > 0 || Math.abs(from - to) < 1e-12) return false;
  const at = mix(p, q, from / (from - to)), off = sub(at, centre);
  return Math.hypot(off.x, off.y, off.z) < radius;
}

interface Candidate { side: 1 | -1; lean: number; pitch: number; cost: number }

function build(input: DuelShotInput, candidate: Candidate, fov: number): DuelShot {
  const axis = blowAxis(input.blow), normal = lineNormal(input.blow);
  const floor = input.bounds.floor, fill = input.fill ?? DUEL_SHOT.fill;
  const reach = input.reach ?? DUEL_SHOT.reach;
  const fallReach = input.fallReach ?? input.victimHeight * 0.9;
  const focus = duelFocus(input);
  const lean = candidate.lean * RAD, pitch = candidate.pitch * RAD;
  // From the target out to the eye: across the line on the chosen side, leaning back along it, and up.
  const ground = {
    x: Math.cos(lean) * candidate.side * normal.x - Math.sin(lean) * axis.x,
    z: Math.cos(lean) * candidate.side * normal.z - Math.sin(lean) * axis.z,
  };
  const out = { x: ground.x * Math.cos(pitch), y: Math.sin(pitch), z: ground.z * Math.cos(pitch) };
  const basis = viewBasis({ x: -out.x, y: -out.y, z: -out.z });
  const tanV = Math.tan(fov * RAD / 2), tanH = tanV * input.aspect;

  // Everything that has to be in the frame, edge margin included.
  const must: Vec3[] = [];
  for (const [spot, height] of [[input.standoff, input.attackerHeight], [input.victim, input.victimHeight]] as const) {
    const feet = { x: spot.x, y: floor, z: spot.z }, head = { x: spot.x, y: floor + height * 1.06, z: spot.z };
    const chest = { x: spot.x, y: floor + height * 0.6, z: spot.z };
    must.push(feet, head, along(chest, basis.right, reach), along(chest, basis.right, -reach));
  }
  must.push({ x: input.victim.x + axis.x * fallReach, y: floor, z: input.victim.z + axis.z * fallReach });
  // A victim knocked back or dodging before he dies falls from where he was struck, not from his square.
  const struck = input.kill?.victimAt;
  if (struck) must.push({ x: struck.x, y: floor + input.victimHeight * 1.06, z: struck.z }, { x: struck.x + axis.x * fallReach, y: floor, z: struck.z + axis.z * fallReach });
  // Look at the middle of all that as this heading sees it, not at the fighters' midpoint:
  // the body falls to one side, and a centred frame can stand closer.
  let low = Infinity, high = -Infinity, left = Infinity, right = -Infinity;
  for (const point of must) {
    const offset = sub(point, focus), across = dot(offset, basis.right), up = dot(offset, basis.up);
    low = Math.min(low, up); high = Math.max(high, up); left = Math.min(left, across); right = Math.max(right, across);
  }
  const centred = along(along(focus, basis.right, (left + right) / 2), basis.up, (low + high) / 2);
  let target = centred;
  // The push-in happens with all of this still in shot.
  const keep = 1 - DUEL_SHOT.margin, closed = 1 - DUEL_SHOT.push;
  const filled = (from: number): number => {
    const view = { position: along(target, out, from), target, fov };
    const span = (spot: Vec3, height: number) =>
      (projectToFrame(view, input.aspect, { x: spot.x, y: floor + height, z: spot.z }).y - projectToFrame(view, input.aspect, { x: spot.x, y: floor, z: spot.z }).y) / 2;
    return Math.max(span(input.standoff, input.attackerHeight), span(input.victim, input.victimHeight));
  };
  const fit = (): number => {
    let reach: number = DUEL_SHOT.minDistance;
    for (const point of must) {
      const offset = sub(point, target);
      const depth = dot(offset, basis.forward);
      reach = Math.max(reach,
        (Math.abs(dot(offset, basis.right)) / (keep * tanH) - depth) / closed,
        (Math.abs(dot(offset, basis.up)) / (keep * tanV) - depth) / closed);
    }
    // Then back off until the taller fighter takes no more of the frame than asked.
    if (filled(reach) > fill) {
      let near = reach, far = reach + 12;
      for (let i = 0; i < 48; i++) { const middle = (near + far) / 2; if (filled(middle) > fill) near = middle; else far = middle; }
      reach = far;
    }
    return reach;
  };
  let distance = fit();
  // Aim a little under the fight, so it sits above the middle of the frame, clear of the caption and the move list;
  // the distance is fitted again each time, because everything in shot has moved up towards the top edge.
  const rise = input.rise ?? DUEL_SHOT.rise;
  for (let i = 0; rise > 0 && i < 3; i++) { target = along(centred, basis.up, -rise * tanV * distance); distance = fit(); }
  // Inside the arena: the furthest the eye may back off along this heading before it meets the wall.
  const towards = ground.x * target.x + ground.z * target.z;
  const span = towards * towards - (target.x * target.x + target.z * target.z) + input.bounds.radius * input.bounds.radius;
  const room = span <= 0 ? 0 : Math.max(0, Math.sqrt(span) - towards) / Math.max(1e-6, Math.cos(pitch));
  const confined = distance > room + 1e-9;
  if (confined) distance = room;
  const position = along(target, out, distance);
  const clearance = floor + (input.bounds.clearance ?? DUEL_SHOT.clearance);
  if (position.y < clearance) position.y = clearance;

  // What stands between the eye and the fight. The walk-in counts for half.
  const lines: [Vec3, number][] = [];
  for (const [spot, height] of [[input.standoff, input.attackerHeight], [input.victim, input.victimHeight]] as const) {
    lines.push([{ x: spot.x, y: floor + height * 0.9, z: spot.z }, 1], [{ x: spot.x, y: floor + height * 0.55, z: spot.z }, 1], [{ x: spot.x, y: floor + height * 0.15, z: spot.z }, 1]);
  }
  lines.push([{ x: input.attackerStart.x, y: floor + input.attackerHeight * 0.55, z: input.attackerStart.z }, 0.5]);
  let blocked = 0, total = 0;
  for (const [point, weight] of lines) {
    total += weight;
    if (input.obstacles.some(obstacle => sightBlocked(position, point, obstacle, floor))) blocked += weight;
  }
  // A piece the eye is standing in fills the frame whatever the sight lines say.
  const inside = input.obstacles.some(obstacle => Math.hypot(position.x - obstacle.x, position.z - obstacle.z) < obstacle.radius + 0.25 && position.y < floor + obstacle.height + 0.25);
  const occlusion = inside ? 1 : blocked / total;

  const push = mix(position, target, DUEL_SHOT.push);
  return {
    position, target, fov, push,
    // Seen as the blow lands and after the push-in on it.
    killSeen: !input.kill || (killVisible(position, input.kill) && killVisible(push, input.kill)),
    side: candidate.side, lean: candidate.lean, pitch: candidate.pitch, distance, occlusion, confined,
    fill: filled(distance),
  };
}

/**
 * The shot for one fight. Deterministic: candidates are tried in a fixed order
 * and a later one must be strictly better to replace an earlier one.
 */
export function planDuelShot(input: DuelShotInput): DuelShot {
  return rankDuelShots(input)[0].shot;
}

/** Every shot {@link planDuelShot} weighs, best first (equal costs keep the order they are tried in). */
export function rankDuelShots(input: DuelShotInput): { shot: DuelShot; cost: number }[] {
  const axis = blowAxis(input.blow), normal = lineNormal(input.blow);
  const focus = duelFocus(input);
  const eye = { x: input.camera.position.x - focus.x, z: input.camera.position.z - focus.z };
  const across = eye.x * normal.x + eye.z * normal.z, behind = -(eye.x * axis.x + eye.z * axis.z);
  // A player looking straight down the line is on neither side: both are open.
  const own: 1 | -1 = across > 0 ? 1 : -1, onLine = Math.abs(across) < 0.05;
  // The far side of the line is only on offer when there is a kill to be seen from it.
  const sides: (1 | -1)[] = onLine || input.kill ? [own, own === 1 ? -1 : 1] : [own];
  // Lean towards where the player already is, so the camera swings as little as it can.
  const home = behind >= 0 ? 1 : -1;
  const fov = clamp(input.fov, DUEL_SHOT.minFov, DUEL_SHOT.maxFov);
  const candidates: Candidate[] = [];
  for (const side of sides) for (const pitch of DUEL_SHOT.pitches) for (const direction of [home, -home]) for (const lean of DUEL_SHOT.leans) {
    candidates.push({
      side, pitch, lean: lean * direction,
      cost: Math.abs(lean * direction - (input.kill ? DUEL_SHOT.killLean : DUEL_SHOT.leans[0]) * home) / 90 + (pitch === DUEL_SHOT.pitches[0] ? 0 : 0.2) + (side === own || onLine ? 0 : DUEL_SHOT.crossLine),
    });
  }
  const ranked = candidates.map((candidate, index) => {
    const shot = build(input, candidate, fov);
    return { shot, index, cost: shot.occlusion * 10 + (shot.confined ? 100 : 0) + (shot.killSeen ? 0 : DUEL_SHOT.hiddenKill) + candidate.cost };
  });
  // A later candidate must be strictly better to come before an earlier one.
  ranked.sort((a, b) => (Math.abs(a.cost - b.cost) < 1e-9 ? a.index - b.index : a.cost - b.cost));
  return ranked.map(({ shot, cost }) => ({ shot, cost }));
}

// ------------------------------------------------------------------ timeline

export const DUEL_TIMING = { easeIn: 0.75, push: 0.2, easeOut: 0.8, handover: 1.15 } as const;
/** The way back rises over the pieces between the fight and the player's view: this much, plus a share of the ground it covers. */
export const DUEL_RETURN_ARC = { base: 0.25, perUnit: 0.1, max: 1.3 } as const;
export type DuelCameraPhase = "in" | "hold" | "out" | "done";

const inOutCubic = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const outCubic = (t: number): number => 1 - Math.pow(1 - t, 3);
const copy = (pose: CameraPose): CameraPose => ({ position: { ...pose.position }, target: { ...pose.target }, fov: pose.fov });
const blend = (a: CameraPose, b: CameraPose, t: number): CameraPose => ({ position: mix(a.position, b.position, t), target: mix(a.target, b.target, t), fov: lerp(a.fov, b.fov, t) });

/**
 * From one view to another round the thing being looked at, not through it:
 * the heading, the ground distance and the height each go their own way, and
 * the eye is lifted in an arc on the way. `t` 0 is `a` and 1 is `b`, exactly.
 */
export function sweepBlend(a: CameraPose, b: CameraPose, t: number): CameraPose {
  if (t <= 0) return copy(a);
  if (t >= 1) return copy(b);
  const target = mix(a.target, b.target, t);
  const from = sub(a.position, a.target), to = sub(b.position, b.target);
  const near = Math.hypot(from.x, from.z), far = Math.hypot(to.x, to.z);
  const ground = Math.hypot(b.position.x - a.position.x, b.position.z - a.position.z);
  const lift = Math.min(DUEL_RETURN_ARC.max, DUEL_RETURN_ARC.base + DUEL_RETURN_ARC.perUnit * ground) * Math.sin(Math.PI * t);
  if (near < 1e-6 || far < 1e-6) { const straight = blend(a, b, t); straight.position.y += lift; return straight; }
  const start = Math.atan2(from.x, from.z);
  const turn = Math.atan2(Math.sin(Math.atan2(to.x, to.z) - start), Math.cos(Math.atan2(to.x, to.z) - start));
  const heading = start + turn * t, radius = lerp(near, far, t);
  return {
    position: { x: target.x + Math.sin(heading) * radius, y: target.y + lerp(from.y, to.y, t) + lift, z: target.z + Math.cos(heading) * radius },
    target, fov: lerp(a.fov, b.fov, t),
  };
}

/**
 * The camera move of one fight: from `from` in to the shot, hold, push in on
 * the killing blow, hold, then back to `home`.
 *
 * It only moves when {@link update} is given time, so it is as frame-rate
 * independent as the clock it is fed, and it never holds a tween of its own:
 * dropping the object is all it takes to stop it. Once `done`, the pose is the
 * home pose itself, value for value.
 */
export class DuelCameraTimeline {
  private homePose: CameraPose;
  private shot: DuelShot;
  private readonly timing: { easeIn: number; push: number; easeOut: number };
  private from: CameraPose;
  private state: DuelCameraPhase = "in";
  private clock = 0;
  private pushed: number | null = null;
  private pose: CameraPose;

  /**
   * @param home the player's view, to return to
   * @param from where the camera is now, if not at home (a previous shot still easing back)
   */
  constructor(home: CameraPose, shot: DuelShot, options: { from?: CameraPose; easeIn?: number; push?: number; easeOut?: number } = {}) {
    this.homePose = copy(home);
    this.shot = shot;
    this.from = copy(options.from ?? home);
    this.pose = copy(this.from);
    this.timing = { easeIn: options.easeIn ?? DUEL_TIMING.easeIn, push: options.push ?? DUEL_TIMING.push, easeOut: options.easeOut ?? DUEL_TIMING.easeOut };
  }

  /** The view the shot ends on: the player's own, or the one {@link release} was given. */
  get home(): CameraPose { return copy(this.homePose); }
  get phase(): DuelCameraPhase { return this.state; }
  get done(): boolean { return this.state === "done"; }
  /** True once the camera is on its way home, or there. */
  get leaving(): boolean { return this.state === "out" || this.state === "done"; }
  get current(): CameraPose { return copy(this.pose); }
  /** The view the shot is easing to or holding (before any push-in): what a beat that cut in may go back to. */
  get aim(): CameraPose { return copy({ position: this.shot.position, target: this.shot.target, fov: this.shot.fov }); }

  /** The killing blow: close in a little more, and stay there. */
  push(): void { if (!this.leaving && this.pushed === null) this.pushed = 0; }

  /**
   * Ease on from wherever the camera is to another view, and hold there: a second beat of the same shot. Home is
   * unchanged, and a camera already on its way there is left alone.
   */
  moveTo(view: CameraPose, seconds: number): void {
    if (this.leaving) return;
    this.from = copy(this.pose);
    this.shot = { ...this.shot, ...copy(view), push: { ...view.position } };
    this.pushed = null; this.state = "in"; this.clock = 0; this.timing.easeIn = seconds;
  }

  /**
   * Ease back from wherever the camera is: to the player's view, or to `to`
   * (a hotseat game hands the view straight to the side of the player who moves
   * next, which then becomes the home this shot ends on). `seconds` overrides
   * the length of the way back.
   */
  release(to?: CameraPose, seconds?: number): void {
    if (this.leaving) return;
    if (to) { this.homePose = copy(to); this.timing.easeOut = seconds ?? DUEL_TIMING.handover; }
    else if (seconds !== undefined) this.timing.easeOut = seconds;
    this.from = copy(this.pose); this.state = "out"; this.clock = 0;
  }

  /**
   * Change the view the shot ends on, without letting go of it: the turn has passed to the other player while
   * the shot still holds the camera. A shot already on its way back turns for the new view from where it is,
   * over `seconds`.
   */
  rehome(to: CameraPose, seconds: number = DUEL_TIMING.handover): void {
    if (this.state === "done") return;
    this.homePose = copy(to);
    if (this.state !== "out") return;
    this.from = copy(this.pose); this.clock = 0; this.timing.easeOut = seconds;
  }

  /** Be at the view the shot ends on now. */
  snap(): void { this.state = "done"; this.pose = copy(this.homePose); }

  /** Advance by `delta` seconds and return where the camera belongs. */
  update(delta: number): CameraPose {
    const step = Math.max(0, delta);
    if (this.state === "done") return copy(this.homePose);
    this.clock += step;
    if (this.pushed !== null) this.pushed += step;
    if (this.state === "out") {
      const t = this.timing.easeOut <= 0 ? 1 : Math.min(1, this.clock / this.timing.easeOut);
      if (t >= 1) { this.snap(); return copy(this.homePose); }
      this.pose = sweepBlend(this.from, this.homePose, inOutCubic(t));
      return copy(this.pose);
    }
    const pushed = this.pushed === null ? 0 : outCubic(this.timing.push <= 0 ? 1 : Math.min(1, this.pushed / this.timing.push));
    const close: CameraPose = { position: mix(this.shot.position, this.shot.push, pushed), target: this.shot.target, fov: this.shot.fov };
    const t = this.timing.easeIn <= 0 ? 1 : Math.min(1, this.clock / this.timing.easeIn);
    if (t >= 1) this.state = "hold";
    this.pose = blend(this.from, close, inOutCubic(t));
    return copy(this.pose);
  }
}
