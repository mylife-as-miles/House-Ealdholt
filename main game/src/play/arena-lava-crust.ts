/**
 * The lava's crust as one small tiling texture, grown in code when the look loads (no image is shipped for it).
 *
 * A cooling crust cracks like drying mud: it breaks where it is most strained, which is furthest from any crack that
 * has already relieved it, and a new crack runs until it meets an old one, turning to meet it square. So cracks are
 * grown in generations, each starting in the widest plates the last one left, and the plates come out with the
 * T-shaped corners real crust has instead of the Y-shaped ones of a cell pattern. This way of growing cracks (starts
 * at the places furthest from any crack, arms that wander, bend to meet the crack ahead square on and stop on
 * reaching it) is adapted from crates/solstice-procgen/src/cracks.rs in the solstice repository (MIT licence),
 * rewritten smaller in TypeScript for this texture. Its licence notice is in main game/public/licenses/solstice-MIT.txt.
 *
 * Channels: R distance to the nearest crack of any generation, G distance to the nearest crack of the first two
 * generations (the ones still open in cold crust), both as the square root of the distance over CRUST_REACH texels;
 * B a random shade, the same over a whole plate; A a smooth tiling noise.
 */
import { seeded } from "./arena-lava-geometry";

/** Texels over which the two distance channels run from 0 to 1 (R, then G). */
export const CRUST_REACH = [12, 24] as const;

export interface CrustOptions {
  size?: number;
  seed?: number;
  /** Each generation's spacing, texels: a new crack starts only where the nearest is at least this far. */
  spacings?: number[];
}

export function growCrust(options: CrustOptions = {}): { size: number; data: Uint8Array } {
  const size = options.size ?? 256, spacings = options.spacings ?? [72, 40, 22, 12];
  const random = seeded(options.seed ?? 7);
  const cells = size * size;
  const wrap = (v: number) => ((Math.floor(v) % size) + size) % size;
  const cell = (x: number, y: number) => wrap(y) * size + wrap(x);
  // which crack claimed each cell (0: none) and at which step; and, kept up as cracks grow, the distance from each
  // texel to the nearest crack where that is under three texels (to any crack, and to one of the first two generations)
  const owner = new Int32Array(cells), claimedAt = new Int32Array(cells);
  const nearAll = new Float32Array(cells).fill(Infinity), nearMajor = new Float32Array(cells).fill(Infinity);
  let cracks = 0;
  // Exact beside the crack, so that it keeps a clean edge when the texture is magnified.
  const stamp = (ax: number, ay: number, bx: number, by: number, generation: number) => {
    const dx = bx - ax, dy = by - ay, span = Math.max(dx * dx + dy * dy, 1e-9);
    for (let y = Math.floor(Math.min(ay, by) - 2.5); y <= Math.ceil(Math.max(ay, by) + 2.5); y++) {
      for (let x = Math.floor(Math.min(ax, bx) - 2.5); x <= Math.ceil(Math.max(ax, bx) + 2.5); x++) {
        const px = x + 0.5 - ax, py = y + 0.5 - ay;
        const t = Math.min(1, Math.max(0, (px * dx + py * dy) / span));
        const d = Math.hypot(px - dx * t, py - dy * t), c = cell(x, y);
        if (d < nearAll[c]) nearAll[c] = d;
        if (generation <= 1 && d < nearMajor[c]) nearMajor[c] = d;
      }
    }
  };

  spacings.forEach((spacing, generation) => {
    const field = spread(size, nearAll);
    const at = (x: number, y: number) => field[cell(x, y)];
    // starts: the places furthest from any crack, each keeping others of its generation a spacing away
    const starts: [number, number, number][] = [];
    for (let y = 0; y < size; y += 3) for (let x = 0; x < size; x += 3) {
      const d = at(x, y);
      if (d >= spacing) starts.push([Math.min(d, size) * (1 + 0.3 * random()), x, y]);
    }
    starts.sort((a, b) => b[0] - a[0]);
    const taken = new Uint8Array(cells);
    for (const [, sx, sy] of starts) {
      if (taken[cell(sx, sy)]) continue;
      const r = Math.ceil(spacing);
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (dx * dx + dy * dy <= r * r) taken[cell(sx + dx, sy + dy)] = 1;
      const id = ++cracks;
      const x0 = sx + random() * 3, y0 = sy + random() * 3;
      // it heads straight away from the nearest crack, and its other arm toward it; with no crack yet, anywhere
      const gx = at(x0 + 2, y0) - at(x0 - 2, y0), gy = at(x0, y0 + 2) - at(x0, y0 - 2);
      const heading = (Math.abs(gx) + Math.abs(gy) > 1e-3 && Number.isFinite(gx + gy) ? Math.atan2(gy, gx) : random() * Math.PI * 2) + (random() - 0.5) * 0.4;
      for (const arm of [0, Math.PI]) {
        let x = x0, y = y0, h = heading + arm, curve = (random() - 0.5) * 0.03;
        const longest = Math.round(spacing * 2.6);
        for (let step = 1; step <= longest; step++) {
          // bend to meet what is ahead square on, harder the nearer it is
          const ax = at(x + 2, y) - at(x - 2, y), ay = at(x, y + 2) - at(x, y - 2), near = at(x, y);
          if (Number.isFinite(near) && near < spacing && Math.abs(ax) + Math.abs(ay) > 1e-3) {
            const turn = Math.atan2(-ay, -ax) - h;
            h += Math.atan2(Math.sin(turn), Math.cos(turn)) * (1 - near / spacing) * 0.3;
          }
          curve = Math.max(-0.04, Math.min(0.04, curve + (random() - 0.5) * 0.012));
          h += curve + (random() - 0.5) * 0.16;
          if (random() < 0.02) h += (random() - 0.5) * 1.1;
          const dx = Math.cos(h), dy = Math.sin(h), nx = x + dx, ny = y + dy;
          const ahead = cell(nx + dx * 1.5, ny + dy * 1.5);
          const met = owner[ahead] !== 0 && (owner[ahead] !== id || claimedAt[ahead] + 12 < step);
          stamp(x, y, met ? nx + dx * 1.5 : nx, met ? ny + dy * 1.5 : ny, generation);
          for (const [cx, cy] of [[x + dx * 0.5, y + dy * 0.5], [nx, ny]]) {
            const c = cell(cx, cy);
            if (owner[c] === 0) { owner[c] = id; claimedAt[c] = step; }
          }
          x = nx; y = ny;
          if (met || (generation > 0 && random() < 0.004)) break;
        }
      }
    }
  });

  const all = spread(size, nearAll), major = spread(size, nearMajor);
  // plates: the areas the cracks leave, each one shade
  const shade = new Float32Array(cells).fill(-1);
  const stack: number[] = [];
  for (let start = 0; start < cells; start++) {
    if (shade[start] >= 0 || owner[start] !== 0) continue;
    const value = random();
    shade[start] = value; stack.push(start);
    while (stack.length) {
      const c = stack.pop()!, x = c % size, y = (c / size) | 0;
      for (const next of [cell(x + 1, y), cell(x - 1, y), cell(x, y + 1), cell(x, y - 1)]) {
        if (shade[next] < 0 && owner[next] === 0) { shade[next] = value; stack.push(next); }
      }
    }
  }
  // a crack's own texels take a neighbouring plate's shade, so that filtering leaves no seam of another value along it
  for (let c = 0; c < cells; c++) {
    if (shade[c] >= 0) continue;
    const x = c % size, y = (c / size) | 0;
    let found = 0.5;
    search: for (let r = 1; r <= 3; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const s = shade[cell(x + dx, y + dy)];
      if (s >= 0 && owner[cell(x + dx, y + dy)] === 0) { found = s; break search; }
    }
    shade[c] = found;
  }
  const noise = tilingNoise(size, random);
  const data = new Uint8Array(cells * 4);
  for (let c = 0; c < cells; c++) {
    data[c * 4] = Math.round(255 * Math.sqrt(Math.min(1, all[c] / CRUST_REACH[0])));
    data[c * 4 + 1] = Math.round(255 * Math.sqrt(Math.min(1, major[c] / CRUST_REACH[1])));
    data[c * 4 + 2] = Math.round(255 * shade[c]);
    data[c * 4 + 3] = Math.round(255 * noise[c]);
  }
  return { size, data };
}

/**
 * Distances known beside the cracks, spread to every texel of a tile that wraps: each texel takes the least of its
 * neighbours' plus the step between them. Close enough further out, where only the plates' insides are shaded by it.
 */
function spread(size: number, near: Float32Array): Float32Array {
  const field = Float32Array.from(near);
  const diagonal = Math.SQRT2;
  for (let pass = 0; pass < 2; pass++) {
    for (let y = 0; y < size; y++) {
      const row = y * size, up = (y === 0 ? size - 1 : y - 1) * size;
      for (let x = 0; x < size; x++) {
        const left = x === 0 ? size - 1 : x - 1, right = x === size - 1 ? 0 : x + 1;
        field[row + x] = Math.min(field[row + x], field[row + left] + 1, field[up + x] + 1, field[up + left] + diagonal, field[up + right] + diagonal);
      }
    }
    for (let y = size - 1; y >= 0; y--) {
      const row = y * size, down = (y === size - 1 ? 0 : y + 1) * size;
      for (let x = size - 1; x >= 0; x--) {
        const left = x === 0 ? size - 1 : x - 1, right = x === size - 1 ? 0 : x + 1;
        field[row + x] = Math.min(field[row + x], field[row + right] + 1, field[down + x] + 1, field[down + left] + diagonal, field[down + right] + diagonal);
      }
    }
  }
  return field;
}

/** Smooth noise in 0..1 that tiles: five octaves of value noise on lattices that divide the tile. */
function tilingNoise(size: number, random: () => number): Float32Array {
  const out = new Float32Array(size * size);
  let total = 0, amplitude = 1;
  for (let period = 4; period <= 64; period *= 2) {
    const lattice = new Float32Array(period * period);
    for (let i = 0; i < lattice.length; i++) lattice[i] = random();
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const fx = (x / size) * period, fy = (y / size) * period;
      const x0 = Math.floor(fx), y0 = Math.floor(fy);
      const tx = fx - x0, ty = fy - y0, sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
      const a = lattice[(y0 % period) * period + (x0 % period)], b = lattice[(y0 % period) * period + ((x0 + 1) % period)];
      const c = lattice[((y0 + 1) % period) * period + (x0 % period)], d = lattice[((y0 + 1) % period) * period + ((x0 + 1) % period)];
      out[y * size + x] += amplitude * (a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy);
    }
    // (0.65 an octave, not a half: the lava's shader wants as much fine grain in it as it can get)
    total += amplitude; amplitude *= 0.65;
  }
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < out.length; i++) { out[i] /= total; lo = Math.min(lo, out[i]); hi = Math.max(hi, out[i]); }
  for (let i = 0; i < out.length; i++) out[i] = (out[i] - lo) / Math.max(hi - lo, 1e-6);
  return out;
}
