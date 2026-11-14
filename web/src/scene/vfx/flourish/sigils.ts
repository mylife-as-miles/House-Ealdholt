/**
 * Each kingdom's sigil: the mark a spell or a summon stamps in the air where it strikes. Plain data with no Three.js,
 * so the node tests reach it (shared/play/flourish-glyph.test.ts); glyphs.ts draws it.
 *
 * A sigil is a list of strokes in a unit disc (x right, y up, radius 1): straight strokes, and arcs of circles and of
 * ellipses (a dot is a circle of no radius). Every stroke carries the stretch of the pen's run it is drawn in
 * (`order`, 0..1), so the mark arrives in the order a hand would strike it, many pens at once where it is symmetrical.
 *
 * The four are our own, drawn from each kingdom's character (main game/public/models/<kingdom>/README.md and
 * docs/legacy/environment/NATION_*.md). None is any faith's symbol: no cross is made anywhere (no two straight strokes
 * cross; the tests check it), no crescent, no star of points, no pentagram or hexagram. None is the burn marks' own:
 * Korvenia's hex brand (scorchPlan.ts) is a broken cog round a lozenge, and no sigil has a cog's teeth or a lozenge.
 *
 * - Aethelgard, **the Six Stones**: a ring of six standing stones, the frost that grows between them. A small hexagon
 *   (the hearth), six arms of frost leaving its corners, each forking once, and running out through the six gaps of a
 *   broken ring; the arms lie level, so none rises out of the victim's head. The clan steading's stone ring, and the cold witchfire of its Frost line and Glacial crown.
 * - Solforiz, **the Terraced Sun**: the sun rising between two windcatcher towers over three terraces. A disc with a
 *   furnace heart and a fan of eight long and short rays over its upper half (a pair either side of straight up, none
 *   rising out of the victim's head), two towers, three stepped terraces under it.
 *   The terraced fortress cities of the Scorched Caliphate, and their sun and fire.
 * - Korvenia, **the Eclipse Orrery**: the duchy under the eclipse. A ring of corona round the eclipsed disc, the bead of
 *   light where the sun breaks out at its rim, nine uneven streamers of corona, and two orbits tilted across it, each
 *   with its planet. The armillary of its occult academies, under its eclipse.
 * - Kwind-09, **the Spark Gap**: a corporation's charter mark. A flat-topped hexagon (a bolt head, the foundry's), the
 *   bore inside it, two terminals and the spark that jumps between them, and a trace out to a pad on either side, as
 *   on a circuit board. The arc its whole army fights with.
 */
import type { VfxArmy } from "../wiring";

/** A straight stroke from `a` to `b`, `width` thick at `a` and `taper` times that at `b`. */
export interface LineStroke { kind: "line"; a: [number, number]; b: [number, number]; width: number; taper?: number; order: [number, number]; live?: boolean }
/**
 * An arc of an ellipse centred on `c` with radii `r` (equal for a circle, zero for a dot), turned by `turn` radians,
 * from parametric angle `from` to `to` (radians, counter-clockwise from +x; `to` may pass 2 pi).
 */
export interface ArcStroke { kind: "arc"; c: [number, number]; r: [number, number]; turn?: number; from: number; to: number; width: number; order: [number, number]; live?: boolean }
export type SigilStroke = LineStroke | ArcStroke;

export interface Sigil {
  name: string;
  strokes: readonly SigilStroke[];
}

const TAU = Math.PI * 2;
const deg = (d: number) => (d * Math.PI) / 180;
const polar = (r: number, angle: number, c: [number, number] = [0, 0]): [number, number] => [c[0] + Math.cos(angle) * r, c[1] + Math.sin(angle) * r];
const line = (a: [number, number], b: [number, number], width: number, order: [number, number], taper = 1, live = false): LineStroke => ({ kind: "line", a, b, width, taper, order, ...(live ? { live } : {}) });
const arc = (c: [number, number], r: number | [number, number], from: number, to: number, width: number, order: [number, number], turn = 0): ArcStroke =>
  ({ kind: "arc", c, r: typeof r === "number" ? [r, r] : r, turn, from, to, width, order });
const dot = (c: [number, number], radius: number, order: [number, number]): ArcStroke => ({ kind: "arc", c, r: [0, 0], from: 0, to: TAU, width: radius, order });

/** Aethelgard: the Six Stones. */
function sixStones(): Sigil {
  const strokes: SigilStroke[] = [];
  const arms = Array.from({ length: 6 }, (_, i) => deg(i * 60));
  // the hearth: a small hexagon, its corners where the arms leave
  for (let i = 0; i < 6; i += 1) strokes.push(line(polar(0.2, arms[i]), polar(0.2, arms[(i + 1) % 6]), 0.03, [0, 0.18]));
  for (const angle of arms) {
    // an arm of frost from the hearth out through a gap in the ring, thinning as it goes
    strokes.push(line(polar(0.2, angle), polar(1.0, angle), 0.036, [0.12, 0.52], 0.55));
    // and its fork, a little way out
    for (const side of [-1, 1]) strokes.push(line(polar(0.56, angle), polar(0.74, angle + side * deg(17)), 0.026, [0.4, 0.62], 0.5));
  }
  // the six stones: the ring between the arms, broken where each arm runs out
  for (const angle of arms) strokes.push(arc([0, 0], 0.82, angle + deg(12), angle + deg(48), 0.05, [0.5, 0.95]));
  return { name: "the Six Stones", strokes };
}

/** Solforiz: the Terraced Sun. */
function terracedSun(): Sigil {
  const sun: [number, number] = [0, 0.2];
  const strokes: SigilStroke[] = [];
  // three terraces, the lowest the widest, struck from the bottom up
  strokes.push(line([-0.78, -0.6], [0.78, -0.6], 0.045, [0, 0.22]));
  strokes.push(line([-0.58, -0.43], [0.58, -0.43], 0.042, [0.06, 0.26]));
  strokes.push(line([-0.38, -0.26], [0.38, -0.26], 0.04, [0.12, 0.3]));
  // two windcatcher towers standing on the top terrace
  strokes.push(line([-0.38, -0.26], [-0.38, 0.04], 0.034, [0.25, 0.4]));
  strokes.push(line([0.38, -0.26], [0.38, 0.04], 0.034, [0.25, 0.4]));
  // the sun's disc, and its furnace heart
  strokes.push(arc(sun, 0.32, deg(-90), deg(270), 0.05, [0.3, 0.68]));
  strokes.push(dot(sun, 0.08, [0.85, 0.95]));
  // its rays over its upper half, long and short, fanning out from the pair either side of straight up
  for (let i = 0; i < 8; i += 1) {
    const angle = deg(11.25 + i * 22.5), long = i % 2 === 1, start = Math.abs(i - 3.5) * 0.035;
    strokes.push(line(polar(0.42, angle, sun), polar(long ? 0.8 : 0.62, angle, sun), long ? 0.04 : 0.03, [0.55 + start, 0.78 + start], 0.35));
  }
  return { name: "the Terraced Sun", strokes };
}

/** Korvenia: the Eclipse Orrery. */
function eclipseOrrery(): Sigil {
  const strokes: SigilStroke[] = [];
  const tilt = deg(18), orbit: [number, number] = [1.0, 0.27];
  // the corona's ring, and the faint rim of the dark disc inside it
  strokes.push(arc([0, 0], 0.5, deg(40), deg(400), 0.05, [0, 0.34]));
  strokes.push(arc([0, 0], 0.42, deg(40), deg(400), 0.016, [0.08, 0.3]));
  // the bead of light where the sun breaks out at the rim
  strokes.push(dot(polar(0.5, deg(40)), 0.075, [0.3, 0.36]));
  // two orbits tilted across it, each with its planet
  strokes.push(arc([0, 0], orbit, deg(200), deg(560), 0.022, [0.24, 0.78], tilt));
  strokes.push(arc([0, 0], orbit, deg(20), deg(380), 0.022, [0.24, 0.78], -tilt));
  const planet = (turn: number, at: number): [number, number] => {
    const x = Math.cos(at) * orbit[0], y = Math.sin(at) * orbit[1];
    return [x * Math.cos(turn) - y * Math.sin(turn), x * Math.sin(turn) + y * Math.cos(turn)];
  };
  strokes.push(dot(planet(tilt, deg(205)), 0.05, [0.8, 0.9]));
  strokes.push(dot(planet(-tilt, deg(25)), 0.05, [0.8, 0.9]));
  // nine streamers of corona, uneven, bursting out from the ring; none straight up
  const reach = [0.96, 0.66, 0.84, 0.62, 0.92, 0.64, 0.8, 0.6, 0.74];
  reach.forEach((r, i) => {
    const angle = deg(30 + i * 40);
    strokes.push(line(polar(0.58, angle), polar(r, angle), 0.034, [0.42 + i * 0.02, 0.7 + i * 0.02], 0.25));
  });
  return { name: "the Eclipse Orrery", strokes };
}

/** Kwind-09: the Spark Gap. */
function sparkGap(): Sigil {
  const strokes: SigilStroke[] = [];
  // a trace out to a pad on either side, struck from the pads inward
  for (const side of [-1, 1]) {
    strokes.push(arc([side * 0.92, 0], 0.06, 0, TAU, 0.022, [0, 0.12]));
    strokes.push(line([side * 0.86, 0], [side * 0.62, 0], 0.03, [0.08, 0.2]));
  }
  // the hexagon, flat on top, drawn by two pens from its left and right corners
  const corner = (i: number) => polar(0.62, deg(i * 60));
  const pen = [[3, 2, 1, 0], [0, 5, 4, 3]];
  for (const path of pen) for (let k = 0; k < 3; k += 1) strokes.push(line(corner(path[k]), corner(path[k + 1]), 0.045, [0.18 + k * 0.13, 0.31 + k * 0.13]));
  // the bore
  strokes.push(arc([0, 0], 0.42, deg(180), deg(540), 0.016, [0.45, 0.68]));
  // the terminals, and the spark that jumps between them
  strokes.push(dot([-0.26, 0], 0.065, [0.62, 0.7]));
  strokes.push(dot([0.26, 0], 0.065, [0.62, 0.7]));
  const jag: [number, number][] = [[-0.19, 0], [-0.11, 0.12], [-0.03, -0.1], [0.05, 0.1], [0.12, -0.08], [0.19, 0]];
  for (let k = 0; k < jag.length - 1; k += 1) strokes.push(line(jag[k], jag[k + 1], 0.03, [0.72 + k * 0.04, 0.76 + k * 0.04], 1, true));
  return { name: "the Spark Gap", strokes };
}

/** The four sigils, by kingdom. */
export const SIGILS: Readonly<Record<VfxArmy, Sigil>> = Object.freeze({
  ivory: sixStones(),
  sun: terracedSun(),
  empire: eclipseOrrery(),
  kwind: sparkGap(),
});

/** Points along a stroke's centre line, for checks and bounds: `count` of them, evenly by its parameter. */
export function strokePoints(stroke: SigilStroke, count = 16): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < count; i += 1) {
    const t = count > 1 ? i / (count - 1) : 0;
    if (stroke.kind === "line") out.push([stroke.a[0] + (stroke.b[0] - stroke.a[0]) * t, stroke.a[1] + (stroke.b[1] - stroke.a[1]) * t]);
    else {
      const angle = stroke.from + (stroke.to - stroke.from) * t, turn = stroke.turn ?? 0;
      const x = Math.cos(angle) * stroke.r[0], y = Math.sin(angle) * stroke.r[1];
      out.push([stroke.c[0] + x * Math.cos(turn) - y * Math.sin(turn), stroke.c[1] + x * Math.sin(turn) + y * Math.cos(turn)]);
    }
  }
  return out;
}

/** Where two straight strokes cross inside both (not at an end of either), or null. */
export function lineCrossing(a: LineStroke, b: LineStroke, margin = 0.04): [number, number] | null {
  const [x1, y1] = a.a, [x2, y2] = a.b, [x3, y3] = b.a, [x4, y4] = b.b;
  const d = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
  if (Math.abs(d) < 1e-9) return null;
  const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / d, u = -((x1 - x2) * (y1 - y3) - (y1 - y2) * (x1 - x3)) / d;
  return t > margin && t < 1 - margin && u > margin && u < 1 - margin ? [x1 + t * (x2 - x1), y1 + t * (y2 - y1)] : null;
}
