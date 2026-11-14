import assert from "node:assert/strict";
import test from "node:test";
import {
  SOUL_STREAM_ANIMATIONS, SOUL_STREAM_DASH, SOUL_STREAM_PATHS, SOUL_STREAM_PIECES, dashPose, parseCubicPath, streamCurve,
} from "./soul-stream-dashes";

const PERIOD = SOUL_STREAM_DASH.length + SOUL_STREAM_DASH.gap;
const PIECE = SOUL_STREAM_DASH.length / SOUL_STREAM_PIECES;
const SPEED = SOUL_STREAM_DASH.travel / SOUL_STREAM_DASH.seconds;

interface Stop { offset: number; x: number; y: number; angle: number; scale: number }
function stops(keyframes: string): Stop[] {
  return [...keyframes.matchAll(/([\d.]+)%\{transform:translate\(([-\d.]+)px, ([-\d.]+)px\) rotate\(([-\d.]+)rad\) scaleX\(([-\d.]+)\)\}/g)]
    .map((m) => ({ offset: Number(m[1]) / 100, x: Number(m[2]), y: Number(m[3]), angle: Number(m[4]), scale: Number(m[5]) }));
}
/** What the browser draws between keyframes: each transform function interpolated linearly. */
function interpolate(list: Stop[], progress: number): Stop {
  let index = 0;
  while (index < list.length - 2 && list[index + 1].offset <= progress) index++;
  const a = list[index], b = list[index + 1], t = b.offset > a.offset ? (progress - a.offset) / (b.offset - a.offset) : 0;
  const mix = (p: number, q: number) => p + (q - p) * t;
  return { offset: progress, x: mix(a.x, b.x), y: mix(a.y, b.y), angle: mix(a.angle, b.angle), scale: mix(a.scale, b.scale) };
}
const ends = (pose: { x: number; y: number; angle: number; scale: number }, size = PIECE) => {
  const length = pose.scale * size;
  return [pose.x, pose.y, pose.x + Math.cos(pose.angle) * length, pose.y + Math.sin(pose.angle) * length];
};

test("the four stream paths parse into their cubic segments", () => {
  assert.deepEqual(SOUL_STREAM_PATHS.map((d) => parseCubicPath(d).length), [2, 2, 2, 1]);
  assert.throws(() => parseCubicPath("M0 0 L10 10"));
});

test("arc length is measured along the curve, not between control points", () => {
  const straight = streamCurve("M0 0 C10 0 20 0 30 0");
  assert.ok(Math.abs(straight.length - 30) < 1e-6);
  assert.deepEqual(straight.at(15).map((v) => Math.round(v * 1000) / 1000), [15, 0]);
  for (const d of SOUL_STREAM_PATHS) {
    const coarse = streamCurve(d, 64).length, fine = streamCurve(d, 2048).length;
    assert.ok(Math.abs(coarse - fine) < 0.05, `${d}: ${coarse} vs ${fine}`);
  }
});

test("at every moment the pieces stand exactly where the dashed stroke's dashes stood, and tile them", () => {
  for (const [index, stream] of SOUL_STREAM_ANIMATIONS.entries()) {
    const curve = streamCurve(SOUL_STREAM_PATHS[index]), list = stops(stream.keyframes);
    assert.ok(list.length > 50, "keyframes cover the path densely");
    assert.equal(list[0].offset, 0);
    assert.equal(list[list.length - 1].offset, 1);
    const cycle = stream.duration * SPEED;
    assert.ok(cycle >= curve.length + SOUL_STREAM_DASH.length && Math.abs(cycle / PERIOD - Math.round(cycle / PERIOD)) < 1e-9);
    assert.equal(stream.runners.length % SOUL_STREAM_PIECES, 0);
    for (let time = 0; time < SOUL_STREAM_DASH.seconds; time += 0.37) {
      // The dashed stroke at this time: a dash begins at every vt + 150k; its pieces follow every 7.5 units.
      const expected: number[] = [];
      for (let start = ((SPEED * time) % PERIOD) - PERIOD; start < curve.length; start += PERIOD) {
        for (let piece = 0; piece < SOUL_STREAM_PIECES; piece++) {
          const from = start + piece * PIECE;
          if (dashPose(curve, from, 0, PIECE).scale > 1e-3) expected.push(from);
        }
      }
      const drawn: number[][] = [];
      for (const runner of stream.runners) {
        const progress = (((time - runner.delay) / stream.duration) % 1 + 1) % 1;
        const pose = interpolate(list, progress);
        if (pose.scale > 1e-3) drawn.push(ends(pose));
      }
      assert.equal(drawn.length, expected.length, `path ${index} at ${time}s`);
      for (const from of expected) {
        const truth = ends(dashPose(curve, from, 0, PIECE));
        const nearest = Math.min(...drawn.map((d) => Math.max(...d.map((v, k) => Math.abs(v - truth[k])))));
        assert.ok(nearest < 0.6, `path ${index} at ${time}s: piece from ${from.toFixed(1)} is off by ${nearest.toFixed(2)} units`);
      }
    }
  }
});

test("the pieces follow the curve: their joints sit on it, and it bows from them by under a seventh of the 3-unit stroke", () => {
  for (const d of SOUL_STREAM_PATHS) {
    const curve = streamCurve(d);
    for (let start = 0; start + SOUL_STREAM_DASH.length <= curve.length; start += 7) {
      for (let piece = 0; piece < SOUL_STREAM_PIECES; piece++) {
        const from = start + piece * PIECE, [x0, y0, x1, y1] = ends(dashPose(curve, from, 0, PIECE));
        const a = curve.at(from), b = curve.at(from + PIECE), middle = curve.at(from + PIECE / 2);
        assert.ok(Math.hypot(x0 - a[0], y0 - a[1]) < 1e-6 && Math.hypot(x1 - b[0], y1 - b[1]) < 1e-6);
        // How far the curve bows away from the piece's chord at its middle.
        const bow = Math.abs((x1 - x0) * (middle[1] - y0) - (y1 - y0) * (middle[0] - x0)) / Math.hypot(x1 - x0, y1 - y0);
        assert.ok(bow < 0.4, `${d} at ${from.toFixed(1)}: bow ${bow.toFixed(2)}`);
      }
    }
  }
});

test("with animation off each piece rests where the static dashed stroke drew it", () => {
  for (const [index, stream] of SOUL_STREAM_ANIMATIONS.entries()) {
    const curve = streamCurve(SOUL_STREAM_PATHS[index]);
    stream.runners.forEach((runner, n) => {
      const from = Math.floor(n / SOUL_STREAM_PIECES) * PERIOD + (n % SOUL_STREAM_PIECES) * PIECE, [x, y] = curve.at(from);
      if (from < curve.length) assert.ok(runner.rest.startsWith(`translate(${Number(x.toFixed(2))}px, ${Number(y.toFixed(2))}px)`), runner.rest);
      else assert.ok(runner.rest.endsWith("scaleX(0)"));
    });
  }
});

test("the dash ends sit on the curve: the chord spans the true dash", () => {
  const curve = streamCurve(SOUL_STREAM_PATHS[0]);
  const pose = dashPose(curve, 60), [x0, y0, x1, y1] = ends(pose, SOUL_STREAM_DASH.length), a = curve.at(60), b = curve.at(90);
  assert.ok(Math.hypot(x0 - a[0], y0 - a[1]) < 1e-9 && Math.hypot(x1 - b[0], y1 - b[1]) < 1e-9);
  assert.equal(dashPose(curve, -40).scale, 0);
  assert.equal(dashPose(curve, curve.length + 1).scale, 0);
  assert.ok(dashPose(curve, -10).scale > 0 && dashPose(curve, -10).scale < 1, "a dash entering the path is drawn in part");
});
