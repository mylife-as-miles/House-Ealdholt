/**
 * The menu's four soul streams as moving dashes that the compositor animates (U-18).
 *
 * They were SVG paths with `stroke-dasharray: 30 120` and an animated `stroke-dashoffset`, which repaints the strokes
 * every frame. Here each dash is drawn as four short pieces, boxes that travel along the path by `transform`
 * keyframes alone: at every keyframe a piece spans the chord between its true ends on the curve (its visible part at
 * either end of the path), so together they follow the dash's curve while the browser only recomposites. Each path
 * has one keyframe rule; its runners share it, offset by a piece or by a whole period of the dash pattern.
 */

/** In the streams' 1280 x 714 drawing space. */
export const SOUL_STREAM_SPACE = { width: 1280, height: 714 } as const;
export const SOUL_STREAM_PATHS = Object.freeze([
  'M665 259 C719 214 646 207 686 157 C708 132 681 120 691 97',
  'M1168 177 C1256 161 1255 130 1218 99 C1191 69 1212 52 1235 37',
  'M1221 351 C1175 320 1227 302 1206 269 C1192 250 1201 222 1232 207',
  'M1002 94 C1023 52 1105 64 1075 9',
]);
/** The former dash pattern and its motion: 30 on, 120 off, moving 300 units in 18 s. */
export const SOUL_STREAM_DASH = { length: 30, gap: 120, travel: 300, seconds: 18 } as const;
const PERIOD = SOUL_STREAM_DASH.length + SOUL_STREAM_DASH.gap;
/** Pieces per dash: the curve bows from a 7.5-unit chord by at most about a third of a unit (the stroke is 3 wide). */
export const SOUL_STREAM_PIECES = 4;
const PIECE = SOUL_STREAM_DASH.length / SOUL_STREAM_PIECES;
const SPEED = SOUL_STREAM_DASH.travel / SOUL_STREAM_DASH.seconds;

type Point = readonly [number, number];
interface Cubic { readonly from: Point; readonly c1: Point; readonly c2: Point; readonly to: Point }

/** Absolute `M x y` followed by absolute `C` segments: the only commands the streams use. */
export function parseCubicPath(d: string): Cubic[] {
  const tokens = d.match(/[MC]|-?\d*\.?\d+(?:e[-+]?\d+)?/gi) ?? [];
  const segments: Cubic[] = [];
  let index = 0, current: Point | null = null;
  const number = () => { const value = Number(tokens[index++]); if (!Number.isFinite(value)) throw new Error(`Bad path: ${d}`); return value; };
  const point = (): Point => [number(), number()];
  while (index < tokens.length) {
    const command = tokens[index++];
    if (command === 'M') current = point();
    else if (command === 'C' && current) {
      do { const c1 = point(), c2 = point(), to = point(); segments.push({ from: current, c1, c2, to }); current = to; }
      while (index < tokens.length && !/^[MC]$/i.test(tokens[index]));
    } else throw new Error(`Unsupported path command ${command} in ${d}`);
  }
  return segments;
}

function cubicAt({ from, c1, c2, to }: Cubic, t: number): Point {
  const u = 1 - t, a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, e = t * t * t;
  return [a * from[0] + b * c1[0] + c * c2[0] + e * to[0], a * from[1] + b * c1[1] + c * c2[1] + e * to[1]];
}

/** A path sampled densely enough that its polyline length and points match the curve to well under a unit. */
export interface StreamCurve { readonly length: number; at(distance: number): Point }
export function streamCurve(d: string, samplesPerSegment = 256): StreamCurve {
  const points: Point[] = [], lengths: number[] = [];
  for (const segment of parseCubicPath(d)) {
    for (let step = points.length ? 1 : 0; step <= samplesPerSegment; step++) {
      const point = cubicAt(segment, step / samplesPerSegment), previous = points[points.length - 1];
      lengths.push(previous ? lengths[lengths.length - 1] + Math.hypot(point[0] - previous[0], point[1] - previous[1]) : 0);
      points.push(point);
    }
  }
  const length = lengths[lengths.length - 1];
  return {
    length,
    at(distance) {
      const s = Math.max(0, Math.min(length, distance));
      let low = 0, high = lengths.length - 1;
      while (high - low > 1) { const mid = (low + high) >> 1; if (lengths[mid] <= s) low = mid; else high = mid; }
      const span = lengths[high] - lengths[low], t = span > 0 ? (s - lengths[low]) / span : 0;
      return [points[low][0] + (points[high][0] - points[low][0]) * t, points[low][1] + (points[high][1] - points[low][1]) * t];
    },
  };
}

/**
 * Where a piece of `length` units that starts at `start` (path distance) is drawn: its visible chord, or nothing.
 * `scale` is the chord over `length`, for a box `length` units long.
 */
export interface DashPose { readonly x: number; readonly y: number; readonly angle: number; readonly scale: number }
export function dashPose(curve: StreamCurve, start: number, previousAngle = 0, length: number = SOUL_STREAM_DASH.length): DashPose {
  const from = Math.max(0, start), to = Math.min(curve.length, start + length);
  const visible = to > from;
  const a = curve.at(visible ? from : Math.min(curve.length, Math.max(0, start))), b = curve.at(visible ? to : Math.min(curve.length, Math.max(0, start)));
  const dx = b[0] - a[0], dy = b[1] - a[1], chord = Math.hypot(dx, dy);
  let angle = chord > 1e-6 ? Math.atan2(dy, dx) : previousAngle;
  // Keep the angle continuous so interpolation between keyframes never spins the dash the long way round.
  while (angle - previousAngle > Math.PI) angle -= 2 * Math.PI;
  while (angle - previousAngle < -Math.PI) angle += 2 * Math.PI;
  return { x: a[0], y: a[1], angle, scale: visible ? chord / length : 0 };
}

const fixed = (value: number, digits: number) => Number(value.toFixed(digits)).toString();
export function poseTransform(pose: DashPose): string {
  return `translate(${fixed(pose.x, 2)}px, ${fixed(pose.y, 2)}px) rotate(${fixed(pose.angle, 4)}rad) scaleX(${fixed(pose.scale, 4)})`;
}

export interface StreamRunner { readonly delay: number; readonly rest: string }
export interface StreamAnimation {
  readonly name: string;
  /** Seconds for one runner to cross its whole cycle (a whole number of dash periods). */
  readonly duration: number;
  readonly keyframes: string;
  readonly runners: readonly StreamRunner[];
}

/**
 * One path's keyframe rule (for one piece) and runners. A runner's cycle covers whole dash periods, enough for a
 * dash to enter at the start, cross the path and leave. Runner (j, k) is piece k of dash j: k pieces ahead of the
 * dash's start and j periods behind dash 0, which starts where the dashed stroke's first dash stood at time zero. A
 * runner's `rest` transform is where it stands at time zero, for when animation is off (reduced motion), as the
 * static dashed stroke was.
 */
export function streamAnimation(d: string, name: string, step = 2): StreamAnimation {
  const curve = streamCurve(d), piece = PIECE;
  const periods = Math.ceil((curve.length + SOUL_STREAM_DASH.length) / PERIOD), cycle = periods * PERIOD, duration = cycle / SPEED;
  // Piece start along the cycle: -piece (about to enter) up to cycle - piece.
  const stops: string[] = [];
  let angle = dashPose(curve, 0, 0, piece).angle, offset = 0;
  const push = (start: number) => {
    const pose = dashPose(curve, start, angle, piece); angle = pose.angle;
    const percent = Math.min(100, ((start + piece) / cycle) * 100);
    if (stops.length === 0 || percent > offset) { stops.push(`${fixed(percent, 4)}%{transform:${poseTransform(pose)}}`); offset = percent; }
  };
  for (let start = -piece; start < curve.length; start += step) push(start);
  push(curve.length);
  push(cycle - piece);
  const runners = Array.from({ length: periods * SOUL_STREAM_PIECES }, (_, index) => {
    const start = Math.floor(index / SOUL_STREAM_PIECES) * PERIOD + (index % SOUL_STREAM_PIECES) * piece;
    // Negative delay: the runner is already `piece + start` units into its cycle at time zero.
    return { delay: -((start + piece) / SPEED), rest: poseTransform(dashPose(curve, start, dashPose(curve, 0, 0, piece).angle, piece)) };
  });
  return { name, duration, keyframes: `@keyframes ${name}{${stops.join('')}}`, runners };
}

export const SOUL_STREAM_ANIMATIONS: readonly StreamAnimation[] = Object.freeze(
  SOUL_STREAM_PATHS.map((d, index) => streamAnimation(d, `soul-stream-${index}`)),
);
