/**
 * Swept weapon contact: when, where and on what a blow lands.
 *
 * A strike clip's `contact` marker says when its author meant the weapon to
 * arrive. Whether it does depends on where the two figures stand and what the
 * defender is doing at that moment. This solver takes the weapon line (grip to
 * tip) sampled across the strike, and the defender's torso capsule and shield
 * disc sampled at the same times, and sweeps one against the other.
 *
 * It answers, before the fight starts:
 *  - the first time the steel touches something, and whether that is the
 *    shield or the body ({@link SweptContact.anchor});
 *  - the point and the surface normal there (the gore pass can use both);
 *  - when nothing is touched, how far short the tip stays at its closest, so
 *    the stage can move the standoff ({@link reachCorrection}).
 *
 * Pure: plain numbers in, plain numbers out. No three.js, no engine.
 */
export interface Vec3 { x: number; y: number; z: number }
/** The weapon as a rigid line at one moment of the strike clip. */
export interface WeaponSample { time: number; grip: Vec3; tip: Vec3 }
export interface TorsoCapsule { base: Vec3; top: Vec3; radius: number }
/** A shield as a flat disc. `normal` points out of its face, towards the threat. */
export interface ShieldDisc { centre: Vec3; normal: Vec3; radius: number }
export interface TargetSample { time: number; torso: TorsoCapsule; shield?: ShieldDisc | null }

export interface SweptContact {
  /** Clip seconds (on the weapon samples' clock) of the touch, or of the closest approach. */
  time: number;
  point: Vec3;
  /** Out of the surface that was hit. */
  normal: Vec3;
  anchor: "shield" | "torso";
  /** True when the weapon line passed through the surface. */
  hit: boolean;
  /** Tip to surface at `time`: 0 on a hit, else how far short the blow stays. */
  distance: number;
  /** Shield hits only: degrees between the shield's face and the incoming blow (0 is square on). */
  facing?: number;
}

const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const add = (a: Vec3, b: Vec3, k = 1): Vec3 => ({ x: a.x + b.x * k, y: a.y + b.y * k, z: a.z + b.z * k });
const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
const length = (a: Vec3): number => Math.hypot(a.x, a.y, a.z);
const unit = (a: Vec3, fallback: Vec3 = { x: 0, y: 1, z: 0 }): Vec3 => { const l = length(a); return l < 1e-9 ? fallback : { x: a.x / l, y: a.y / l, z: a.z / l }; };
const mix = (a: Vec3, b: Vec3, t: number): Vec3 => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t });
const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

/** Closest points of two segments, as parameters 0..1 along each. */
export function closestOnSegments(p1: Vec3, q1: Vec3, p2: Vec3, q2: Vec3): { s: number; t: number; distance: number } {
  const d1 = sub(q1, p1), d2 = sub(q2, p2), r = sub(p1, p2);
  const a = dot(d1, d1), e = dot(d2, d2), f = dot(d2, r);
  let s = 0, t = 0;
  if (a <= 1e-12 && e <= 1e-12) { s = 0; t = 0; }
  else if (a <= 1e-12) { t = clamp01(f / e); }
  else {
    const c = dot(d1, r);
    if (e <= 1e-12) { s = clamp01(-c / a); }
    else {
      const b = dot(d1, d2), denominator = a * e - b * b;
      s = denominator > 1e-12 ? clamp01((b * f - c * e) / denominator) : 0;
      t = (b * s + f) / e;
      if (t < 0) { t = 0; s = clamp01(-c / a); } else if (t > 1) { t = 1; s = clamp01((b - c) / a); }
    }
  }
  return { s, t, distance: length(sub(add(p1, d1, s), add(p2, d2, t))) };
}

function targetAt(targets: readonly TargetSample[], time: number): TargetSample {
  if (targets.length === 1 || time <= targets[0].time) return targets[0];
  for (let i = 1; i < targets.length; i += 1) {
    const a = targets[i - 1], b = targets[i];
    if (time > b.time) continue;
    const t = clamp01((time - a.time) / Math.max(1e-9, b.time - a.time));
    const shield = a.shield && b.shield ? { centre: mix(a.shield.centre, b.shield.centre, t), normal: unit(mix(a.shield.normal, b.shield.normal, t)), radius: a.shield.radius + (b.shield.radius - a.shield.radius) * t } : (t < 0.5 ? a.shield : b.shield) ?? null;
    return { time, torso: { base: mix(a.torso.base, b.torso.base, t), top: mix(a.torso.top, b.torso.top, t), radius: a.torso.radius + (b.torso.radius - a.torso.radius) * t }, shield };
  }
  return targets[targets.length - 1];
}

interface Touch { anchor: "shield" | "torso"; point: Vec3; normal: Vec3; gap: number; facing?: number }

/** What the weapon line touches at one instant, and how far the tip is from each surface. */
function touch(grip: Vec3, tip: Vec3, target: TargetSample): { hit: Touch | null; near: Touch } {
  const shaft = sub(tip, grip), heading = unit(shaft);
  let hit: Touch | null = null, near: Touch | null = null;
  const shield = target.shield;
  if (shield) {
    const normal = unit(shield.normal);
    const from = dot(sub(grip, shield.centre), normal), to = dot(sub(tip, shield.centre), normal);
    const facing = Math.acos(Math.min(1, Math.max(-1, -dot(heading, normal)))) * 180 / Math.PI;
    // Through the face from its front: the grip is in front of the plane, the tip at or behind it.
    if (from > 0 && to <= 0) {
      const point = add(grip, shaft, from / Math.max(1e-9, from - to));
      if (length(sub(point, shield.centre)) <= shield.radius) hit = { anchor: "shield", point, normal, gap: 0, facing };
    }
    const flat = sub(sub(tip, shield.centre), { x: normal.x * to, y: normal.y * to, z: normal.z * to });
    const outside = Math.max(0, length(flat) - shield.radius);
    near = { anchor: "shield", point: add(shield.centre, unit(flat, { x: 0, y: 0, z: 0 }), Math.min(length(flat), shield.radius)), normal, gap: Math.hypot(outside, Math.max(0, to)), facing };
  }
  const capsule = target.torso;
  const closest = closestOnSegments(grip, tip, capsule.base, capsule.top);
  const onAxis = mix(capsule.base, capsule.top, closest.t), onWeapon = add(grip, shaft, closest.s);
  const body: Touch = { anchor: "torso", point: add(onAxis, unit(sub(onWeapon, onAxis), { x: -heading.x, y: 0, z: -heading.z }), capsule.radius), normal: unit(sub(onWeapon, onAxis), { x: -heading.x, y: 0, z: -heading.z }), gap: 0 };
  if (!hit && closest.distance <= capsule.radius) hit = body;
  const tipToAxis = closestOnSegments(tip, tip, capsule.base, capsule.top);
  const tipGap = Math.max(0, tipToAxis.distance - capsule.radius);
  const bodyNear: Touch = { ...body, gap: Math.max(0, Math.min(tipGap, closest.distance - capsule.radius)) };
  if (!near || bodyNear.gap < near.gap) near = bodyNear;
  return { hit, near };
}

/**
 * Sweeps the weapon through the strike. Samples are joined by straight lines
 * and each span is searched in `steps` slices, so a thin shield is not skipped
 * between two 30 Hz frames. Returns the first touch, else the closest approach.
 */
export function sweepWeapon(weapon: readonly WeaponSample[], targets: readonly TargetSample[], options: { steps?: number } = {}): SweptContact | null {
  if (!weapon.length || !targets.length) return null;
  const steps = Math.max(1, Math.round(options.steps ?? 6));
  let best: (Touch & { time: number }) | null = null;
  for (let i = 0; i < weapon.length; i += 1) {
    const a = weapon[Math.max(0, i - 1)], b = weapon[i];
    for (let k = i === 0 ? steps : 1; k <= steps; k += 1) {
      const t = k / steps, time = a.time + (b.time - a.time) * t;
      const result = touch(mix(a.grip, b.grip, t), mix(a.tip, b.tip, t), targetAt(targets, time));
      if (result.hit) return { time, point: result.hit.point, normal: result.hit.normal, anchor: result.hit.anchor, hit: true, distance: 0, ...(result.hit.facing === undefined ? {} : { facing: result.hit.facing }) };
      if (!best || result.near.gap < best.gap - 1e-9) best = { ...result.near, time };
    }
  }
  return best && { time: best.time, point: best.point, normal: best.normal, anchor: best.anchor, hit: false, distance: best.gap, ...(best.facing === undefined ? {} : { facing: best.facing }) };
}

/** A block only counts when the steel meets the shield first and the shield is turned to it. */
export function blockHolds(contact: SweptContact | null, maxFacing = 60): boolean {
  return !!contact && contact.hit && contact.anchor === "shield" && (contact.facing ?? 0) <= maxFacing;
}

/**
 * How far the attacker must stand closer (+) or further (-) along the blow so
 * that, at the weapon's furthest reach, the tip sits `depth` inside the surface
 * it is meant for. `blow` is the ground direction from attacker to defender.
 */
export function reachCorrection(weapon: readonly WeaponSample[], targets: readonly TargetSample[], blow: { x: number; z: number }, want: "shield" | "torso", depth = 0.03): number {
  return aimCorrection(weapon, targets, blow, want, depth).along;
}

/**
 * {@link reachCorrection} with its sideways part: `across` is how far the
 * attacker must stand to its own left (+) for the weapon's line, at furthest
 * reach, to pass through the middle of what it is meant for. A clip's stance
 * is rarely square on the line between two squares.
 */
export function aimCorrection(weapon: readonly WeaponSample[], targets: readonly TargetSample[], blow: { x: number; z: number }, want: "shield" | "torso", depth = 0.03): { along: number; across: number } {
  const reach = alongCorrection(weapon, targets, blow, want, depth);
  const l = Math.hypot(blow.x, blow.z);
  if (!weapon.length || !targets.length || l < 1e-9) return { along: 0, across: 0 };
  const axis = { x: blow.x / l, y: 0, z: blow.z / l }, left = { x: axis.z, y: 0, z: -axis.x };
  let furthest = weapon[0];
  for (const sample of weapon) if (dot(sample.tip, axis) > dot(furthest.tip, axis)) furthest = sample;
  const target = targetAt(targets, furthest.time);
  const centre = want === "shield" && target.shield ? target.shield.centre
    : mix(target.torso.base, target.torso.top, closestOnSegments(furthest.tip, furthest.tip, target.torso.base, target.torso.top).t);
  return { along: reach, across: dot(sub(centre, furthest.tip), left) };
}

function alongCorrection(weapon: readonly WeaponSample[], targets: readonly TargetSample[], blow: { x: number; z: number }, want: "shield" | "torso", depth: number): number {
  const l = Math.hypot(blow.x, blow.z);
  if (!weapon.length || !targets.length || l < 1e-9) return 0;
  const axis = { x: blow.x / l, y: 0, z: blow.z / l };
  // Furthest reach: the sample whose tip is furthest along the blow.
  let furthest = weapon[0];
  for (const sample of weapon) if (dot(sample.tip, axis) > dot(furthest.tip, axis)) furthest = sample;
  const target = targetAt(targets, furthest.time);
  if (want === "shield" && target.shield) {
    const normal = unit(target.shield.normal), towards = -dot(normal, axis);
    // Distance to the shield's plane measured along the blow.
    const gap = dot(sub(furthest.tip, target.shield.centre), normal);
    return towards > 0.2 ? gap / towards + depth : dot(sub(target.shield.centre, furthest.tip), axis) + depth;
  }
  const onAxis = mix(target.torso.base, target.torso.top, closestOnSegments(furthest.tip, furthest.tip, target.torso.base, target.torso.top).t);
  return dot(sub(onAxis, furthest.tip), axis) - target.torso.radius + depth;
}

/** A figure-local point (x to its left hand side, z ahead of it) placed on the board, facing along `forward`. */
export function placeLocal(local: Vec3, at: Vec3, forward: { x: number; z: number }): Vec3 {
  const l = Math.hypot(forward.x, forward.z) || 1, fx = forward.x / l, fz = forward.z / l;
  return { x: at.x + local.x * fz + local.z * fx, y: at.y + local.y, z: at.z - local.x * fx + local.z * fz };
}
/** A figure-local direction turned the same way. */
export function turnLocal(local: Vec3, forward: { x: number; z: number }): Vec3 {
  return placeLocal(local, { x: 0, y: 0, z: 0 }, forward);
}
