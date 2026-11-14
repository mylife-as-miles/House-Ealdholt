/**
 * Droplet flight in closed form: gravity plus linear drag, dv/dt = g - k v.
 *
 *   p(t) = p0 + (v0 - vT) (1 - e^(-k t)) / k + vT t,     vT = (0, -G / k, 0)
 *
 * The position at any time is a function of the launch state alone, so a
 * droplet is at the same place at the same time whatever the frame rate, and
 * where it meets the board (y = top) is known before it leaves the wound. The
 * vertex shader of BloodParticles evaluates the very same expression.
 */
import type { Vec3 } from "./GoreTypes";

/** World units per second squared. A figure is about 0.8 units tall, so this is a little under real scale: it reads. */
export const GORE_GRAVITY = 7.5;

export interface Launch { origin: Vec3; velocity: Vec3; /** Linear drag coefficient, 1/s. Must be positive. */ drag: number }

export function flightPosition(launch: Launch, t: number, out: Vec3, gravity = GORE_GRAVITY): Vec3 {
  const k = launch.drag, decay = (1 - Math.exp(-k * t)) / k, fall = -gravity / k;
  out.x = launch.origin.x + launch.velocity.x * decay;
  out.y = launch.origin.y + (launch.velocity.y - fall) * decay + fall * t;
  out.z = launch.origin.z + launch.velocity.z * decay;
  return out;
}

export function flightVelocity(launch: Launch, t: number, out: Vec3, gravity = GORE_GRAVITY): Vec3 {
  const e = Math.exp(-launch.drag * t), fall = -gravity / launch.drag;
  out.x = launch.velocity.x * e;
  out.y = fall + (launch.velocity.y - fall) * e;
  out.z = launch.velocity.z * e;
  return out;
}

/**
 * Seconds until the droplet meets the plane y = `top`, or -1 if it starts at
 * or under it. Height over time is concave with a single crossing, bracketed
 * by doubling and closed by a fixed number of bisections: no tolerance loop,
 * so the answer is bit-identical for identical input.
 */
export function landingTime(launch: Launch, top: number, gravity = GORE_GRAVITY): number {
  if (!(launch.origin.y > top)) return -1;
  const k = launch.drag, fall = -gravity / k, rise = launch.velocity.y - fall, y0 = launch.origin.y - top;
  const height = (t: number) => y0 + rise * (1 - Math.exp(-k * t)) / k + fall * t;
  let low = 0, high = 0.25;
  for (let i = 0; i < 12 && height(high) > 0; i += 1) { low = high; high *= 2; }
  for (let i = 0; i < 40; i += 1) {
    const middle = (low + high) / 2;
    if (height(middle) > 0) low = middle; else high = middle;
  }
  return (low + high) / 2;
}
