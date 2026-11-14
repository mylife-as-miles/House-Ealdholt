/**
 * Vector and quaternion maths on plain arrays, for the death physics.
 *
 * The physics layer imports neither three.js nor Jolt at run time, so that it
 * can be tested in Node exactly as it runs in the browser. Quaternions are
 * [x, y, z, w]; matrices are 16 numbers, column-major, as three.js keeps them.
 */
export type V3 = [number, number, number];
export type Q4 = [number, number, number, number];

export const v3 = (x = 0, y = 0, z = 0): V3 => [x, y, z];
export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const length = (a: V3): number => Math.hypot(a[0], a[1], a[2]);
export const lerp = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
export const clamp = (value: number, low: number, high: number): number => Math.min(high, Math.max(low, value));

/** Unit length, or `fallback` for a vector too short to have a direction. */
export function unit(a: V3, fallback: V3 = [0, 1, 0]): V3 {
  const l = length(a);
  return l > 1e-9 && Number.isFinite(l) ? [a[0] / l, a[1] / l, a[2] / l] : [fallback[0], fallback[1], fallback[2]];
}

/** Some unit vector at right angles to `a` (unit): the same one every time. */
export function perpendicular(a: V3): V3 {
  const pick: V3 = Math.abs(a[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  return unit(cross(a, pick));
}

/** `a` with its part along `axis` (unit) taken out, unit length. */
export function orthogonal(a: V3, axis: V3): V3 {
  const out = sub(a, scale(axis, dot(a, axis)));
  return length(out) > 1e-6 ? unit(out) : perpendicular(axis);
}

export const qIdentity = (): Q4 => [0, 0, 0, 1];
export const qConj = (q: Q4): Q4 => [-q[0], -q[1], -q[2], q[3]];
export function qMul(a: Q4, b: Q4): Q4 {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
}
export function qNormalize(q: Q4): Q4 {
  const l = Math.hypot(q[0], q[1], q[2], q[3]);
  return l > 1e-12 ? [q[0] / l, q[1] / l, q[2] / l, q[3] / l] : [0, 0, 0, 1];
}
export function qRotate(q: Q4, v: V3): V3 {
  const [x, y, z, w] = q;
  const tx = 2 * (y * v[2] - z * v[1]), ty = 2 * (z * v[0] - x * v[2]), tz = 2 * (x * v[1] - y * v[0]);
  return [v[0] + w * tx + y * tz - z * ty, v[1] + w * ty + z * tx - x * tz, v[2] + w * tz + x * ty - y * tx];
}
export function qAxisAngle(axis: V3, angle: number): Q4 {
  const s = Math.sin(angle / 2);
  return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(angle / 2)];
}
/** The rotation whose columns are the right-handed unit axes x, y, z. */
export function qFromBasis(x: V3, y: V3, z: V3): Q4 {
  const m00 = x[0], m10 = x[1], m20 = x[2], m01 = y[0], m11 = y[1], m21 = y[2], m02 = z[0], m12 = z[1], m22 = z[2];
  const trace = m00 + m11 + m22;
  let q: Q4;
  if (trace > 0) { const s = 0.5 / Math.sqrt(trace + 1); q = [(m21 - m12) * s, (m02 - m20) * s, (m10 - m01) * s, 0.25 / s]; }
  else if (m00 > m11 && m00 > m22) { const s = 2 * Math.sqrt(1 + m00 - m11 - m22); q = [0.25 * s, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s]; }
  else if (m11 > m22) { const s = 2 * Math.sqrt(1 + m11 - m00 - m22); q = [(m01 + m10) / s, 0.25 * s, (m12 + m21) / s, (m02 - m20) / s]; }
  else { const s = 2 * Math.sqrt(1 + m22 - m00 - m11); q = [(m02 + m20) / s, (m12 + m21) / s, 0.25 * s, (m10 - m01) / s]; }
  return qNormalize(q);
}
/** A frame whose y axis is `axis` (unit), turned about it so its x axis is as near `towards` as it can be. */
export function qFromAxis(axis: V3, towards?: V3): Q4 {
  const x = towards ? orthogonal(towards, axis) : perpendicular(axis);
  return qFromBasis(x, axis, cross(x, axis));
}
/** Angular velocity (world, radians a second) that turns `from` into `to` in `seconds`. */
export function angularVelocity(from: Q4, to: Q4, seconds: number): V3 {
  let d = qMul(to, qConj(from));
  if (d[3] < 0) d = [-d[0], -d[1], -d[2], -d[3]];
  const s = Math.hypot(d[0], d[1], d[2]);
  if (s < 1e-9 || seconds <= 0) return [0, 0, 0];
  const angle = 2 * Math.atan2(s, d[3]), k = angle / (s * seconds);
  return [d[0] * k, d[1] * k, d[2] * k];
}
/** `a` cut down to at most `limit` long. */
export function limit(a: V3, max: number): V3 {
  const l = length(a);
  return l > max && l > 0 ? scale(a, max / l) : a;
}

/** Position, rotation and (uniform) scale of a column-major 4x4 that holds no shear. */
export function decompose(m: ArrayLike<number>, offset = 0): { position: V3; rotation: Q4; scale: number } {
  const x: V3 = [m[offset], m[offset + 1], m[offset + 2]], y: V3 = [m[offset + 4], m[offset + 5], m[offset + 6]], z: V3 = [m[offset + 8], m[offset + 9], m[offset + 10]];
  const sx = length(x), sy = length(y), sz = length(z);
  // A mirrored frame has no rotation to speak of: flip one axis so the quaternion is still a rotation.
  const flip = dot(cross(x, y), z) < 0 ? -1 : 1;
  const rotation = qFromBasis(unit(x, [1, 0, 0]), unit(y, [0, 1, 0]), scale(unit(z, [0, 0, 1]), flip));
  return { position: [m[offset + 12], m[offset + 13], m[offset + 14]], rotation, scale: (sx + sy + sz) / 3 * flip };
}
/** Column-major product a * b. */
export function mat4Mul(a: ArrayLike<number>, b: ArrayLike<number>): number[] {
  const out = new Array<number>(16);
  for (let c = 0; c < 4; c += 1) for (let r = 0; r < 4; r += 1) {
    out[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  }
  return out;
}
/** The column-major matrix of a translation, rotation and per-axis scale. */
export function compose(position: V3, q: Q4, s: V3 = [1, 1, 1]): number[] {
  const x = qRotate(q, [1, 0, 0]), y = qRotate(q, [0, 1, 0]), z = qRotate(q, [0, 0, 1]);
  return [x[0] * s[0], x[1] * s[0], x[2] * s[0], 0, y[0] * s[1], y[1] * s[1], y[2] * s[1], 0, z[0] * s[2], z[1] * s[2], z[2] * s[2], 0, position[0], position[1], position[2], 1];
}
/** Stateless hash to [0, 1), the gore system's own mix: the same seed always scatters the same way. */
export function hash01(seed: number, index: number, channel: number): number {
  let h = (seed ^ Math.imul(index + 1, 0x9e3779b1) ^ Math.imul(channel + 1, 0x85ebca6b)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
