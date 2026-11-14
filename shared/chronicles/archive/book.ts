/** Articulated Atlas book. A heavily damped hinge lifts deliberately and retains momentum on interruption. */
export const ATLAS_BOOK = { segments: 16, hinge: .008, step: 1 / 120, mass: 1, stiffness: 10, damping: 5.6 } as const;
export interface AtlasBookState {
  angle: number; velocity: number; goal: number; hold: number; remainder: number; drive: number;
  dragging: boolean; settled: boolean; relief: number; curl: number;
  bends: Float64Array; speeds: Float64Array; curve: Float32Array;
}
export function createAtlasBookState(still = false): AtlasBookState {
  const state: AtlasBookState = {
    angle: still ? 0 : -Math.PI, velocity: 0, goal: 0, hold: still ? 0 : .6, remainder: 0, drive: 0,
    dragging: false, settled: still, relief: still ? 1 : 0, curl: 0,
    bends: new Float64Array(ATLAS_BOOK.segments + 1), speeds: new Float64Array(ATLAS_BOOK.segments + 1),
    curve: new Float32Array((ATLAS_BOOK.segments + 1) * 3),
  };
  updateCurve(state); return state;
}
function updateCurve(state: AtlasBookState): void {
  let x = 0, y = 0; state.curl = 0;
  for (let i = 0; i <= ATLAS_BOOK.segments; i++) {
    const a = state.bends[i];
    if (i) { x -= Math.cos(a) * .5 / ATLAS_BOOK.segments; y -= Math.sin(a) * .5 / ATLAS_BOOK.segments; }
    state.curve[i * 3] = x; state.curve[i * 3 + 1] = y; state.curve[i * 3 + 2] = a;
    state.curl = Math.max(state.curl, Math.abs(a));
  }
  const opening = 1 - Math.abs(state.angle) / Math.PI;
  const t = Math.max(0, Math.min(1, (opening - .7) / .3));
  state.relief = t * t * (3 - 2 * t);
}
export function setAtlasBookOpen(state: AtlasBookState, open: boolean, still = false): void {
  state.goal = open ? 0 : -Math.PI; state.hold = 0; state.dragging = false; state.settled = false;
  if (still) {
    state.angle = state.goal; state.velocity = 0; state.bends.fill(0); state.speeds.fill(0);
    state.remainder = 0; state.settled = true; updateCurve(state);
  }
}
export function dragAtlasBook(state: AtlasBookState, angle: number, delta: number): void {
  const next = Math.max(-Math.PI, Math.min(0, angle));
  const dt = Math.max(1 / 120, delta), velocity = Math.max(-9, Math.min(9, (next - state.angle) / dt));
  state.drive = Math.max(-180, Math.min(180, (velocity - state.velocity) / dt)); state.velocity = velocity;
  state.angle = next; state.hold = 0; state.dragging = true; state.settled = false; updateCurve(state);
}
export function releaseAtlasBook(state: AtlasBookState): void {
  state.goal = Math.abs(state.velocity) > .7 ? (state.velocity > 0 ? 0 : -Math.PI) : (state.angle > -Math.PI / 2 ? 0 : -Math.PI);
  state.dragging = false; state.settled = false;
}
export function stepAtlasBook(state: AtlasBookState, seconds: number, still = false): boolean {
  if (still) { setAtlasBookOpen(state, state.goal === 0, true); return false; }
  if (!Number.isFinite(seconds) || seconds <= 0 || state.settled) return !state.settled;
  const dt = ATLAS_BOOK.step;
  state.remainder += Math.min(.1, seconds);
  while (state.remainder >= dt) {
    state.remainder -= dt;
    if (state.hold > 0) { state.hold -= dt; continue; }
    const acceleration = state.dragging ? state.drive : ATLAS_BOOK.stiffness * (state.goal - state.angle) - ATLAS_BOOK.damping * state.velocity;
    if (!state.dragging) {
      state.velocity += acceleration * dt / ATLAS_BOOK.mass;
      state.angle += state.velocity * dt;
      if (state.angle > 0) { state.angle = 0; state.velocity = -Math.abs(state.velocity) * .16; }
      if (state.angle < -Math.PI) { state.angle = -Math.PI; state.velocity = Math.abs(state.velocity) * .16; }
    } else { state.drive *= Math.exp(-20 * dt); state.velocity *= Math.exp(-10 * dt); }
    for (let i = 1; i <= ATLAS_BOOK.segments; i++) {
      const s = i / ATLAS_BOOK.segments, a = state.bends[i];
      const neighbour = state.bends[i - 1] + state.bends[Math.min(ATLAS_BOOK.segments, i + 1)] - 2 * a;
      const force = -100 * a - 10 * state.speeds[i] + 25 * neighbour - acceleration * .06 * s * s - 2 * Math.sin(state.angle) * s * s;
      state.speeds[i] += force * dt; state.bends[i] += state.speeds[i] * dt;
      state.bends[i] = Math.max(-.5, Math.min(.5, state.bends[i]));
      // Paper can lift off the stack, but it cannot pass through it at the open stop.
      if (state.angle > -.12 && state.bends[i] > 0) { state.bends[i] = 0; state.speeds[i] = -Math.abs(state.speeds[i]) * .12; }
      if (state.angle < -Math.PI + .1) state.bends[i] = Math.max(-.02, Math.min(.08, state.bends[i]));
    }
    let calm = !state.dragging && Math.abs(state.angle - state.goal) < .0002 && Math.abs(state.velocity) < .002;
    for (let i = 0; calm && i <= ATLAS_BOOK.segments; i++) calm = Math.abs(state.bends[i]) < .0003 && Math.abs(state.speeds[i]) < .003;
    if (calm) {
      state.angle = state.goal; state.velocity = 0; state.bends.fill(0); state.speeds.fill(0); state.settled = true;
    }
  }
  updateCurve(state); return !state.settled;
}
export const atlasBookInteractive = (state: AtlasBookState) => state.settled && state.angle === 0;

/** Shared deformation: a fixed spine, flexible page strip and rigid cover hinge. */
export const ATLAS_BOOK_GLSL = /* glsl */ `
  uniform vec3 uBookCurve[17]; uniform float uBookAngle; uniform float uBookRelief; uniform float uBookWidth;
  vec3 atlasBookPosition(vec3 position) {
    vec3 p = position / uBookWidth;
    if (p.x < 0.) {
      float segment = clamp(-p.x * 32., 0., 15.9999);
      int index = int(floor(segment)); vec3 c = mix(uBookCurve[index], uBookCurve[index + 1], fract(segment));
      float h = p.y * uBookRelief;
      p.xy = vec2(c.x - sin(c.z) * h, c.y + cos(c.z) * h - .008);
      float a = uBookAngle; p.xy = mat2(cos(a), sin(a), -sin(a), cos(a)) * p.xy + vec2(0., .008);
    } else { p.y *= uBookRelief; }
    return p * uBookWidth;
  }
  vec3 atlasBookNormal(vec3 normal, float x) {
    vec3 n = normalize(mix(vec3(0., 1., 0.), normal, uBookRelief));
    if (x < 0.) {
      float segment = clamp(-x / uBookWidth * 32., 0., 15.9999); int i = int(floor(segment));
      float a = uBookAngle + mix(uBookCurve[i].z, uBookCurve[i + 1].z, fract(segment));
      n.xy = mat2(cos(a), sin(a), -sin(a), cos(a)) * n.xy;
    }
    return n;
  }
`;

export type AtlasBookFamily = 'leather' | 'paper' | 'bronze';
export interface AtlasBookPart { side: 'left' | 'right' | 'spine'; family: AtlasBookFamily; at: [number, number, number]; size: [number, number, number]; yaw: number }
/** Centre of the actual cover/page-block envelope, rather than the unfolded map rectangle. */
export function atlasBookCenterX(state: AtlasBookState, parts: readonly AtlasBookPart[]): number {
  let min = Infinity, max = -Infinity;
  const c = Math.cos(state.angle), s = Math.sin(state.angle);
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i], halfX = (Math.abs(Math.cos(part.yaw)) * part.size[0] + Math.abs(Math.sin(part.yaw)) * part.size[2]) / 2;
    const centre = part.side === 'left' ? c * part.at[0] - s * (part.at[1] - ATLAS_BOOK.hinge) : part.at[0];
    const half = part.side === 'left' ? Math.abs(c) * halfX + Math.abs(s) * part.size[1] / 2 : halfX;
    min = Math.min(min, centre - half); max = Math.max(max, centre + half);
  }
  return (min + max) / 2;
}
/** Normalized model data, shared by both Three runtimes; north is still -Z. */
export function atlasBookParts(depth: number): AtlasBookPart[] {
  const parts: AtlasBookPart[] = [];
  const put = (side: AtlasBookPart['side'], family: AtlasBookFamily, at: AtlasBookPart['at'], size: AtlasBookPart['size'], yaw = 0) => parts.push({ side, family, at, size, yaw });
  for (const side of ['left', 'right'] as const) {
    const sign = side === 'left' ? -1 : 1;
    put(side, 'leather', [sign * .253, -.046, 0], [.526, .012, depth + .037]);
    // The painted relief includes sea beds at -0.012, so the page block stays below them.
    for (let i = 0; i < 9; i++) put(side, 'paper', [sign * .25, -.016 - i * .0027, 0], [.496, .0022, depth - .007]);
    for (const z of [-1, 1]) {
      put(side, 'bronze', [sign * .254, -.053, z * (depth / 2 + .008)], [.495, .0018, .002]);
      for (const x of [.018, .49]) put(side, 'bronze', [sign * x, -.0538, z * (depth / 2 - .008)], [.023, .002, .023], Math.PI / 4);
    }
    for (const x of [.012, .497]) put(side, 'bronze', [sign * x, -.053, 0], [.002, .0018, depth + .016]);
    // Neutral embossed geometry, with no invented faction crest or text.
    put(side, 'bronze', [sign * .255, -.0535, 0], [.064, .002, .064], Math.PI / 4);
    put(side, 'leather', [sign * .255, -.055, 0], [.052, .002, .052], Math.PI / 4);
  }
  put('spine', 'leather', [0, -.026, 0], [.014, .04, depth + .033]);
  for (const z of [-.35, -.19, .19, .35]) put('spine', 'bronze', [0, -.026, z * depth], [.017, .043, .007]);
  return parts;
}
