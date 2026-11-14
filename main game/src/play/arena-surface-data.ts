/** What the arena's surfaces and air are worked out from, without a renderer: the sky's light by direction, which
 * stretches of lava reach a mesh, what a baked material is made of, and the texels of the fine surface detail.
 * arena-surface.ts and arena-air.ts draw with these. */
import type { ArenaQuality } from "./arena-kit";

export type Rgb = [number, number, number];

/** The three feature sets a part scales itself by: 0 low, 1 medium, 2 high (`auto` runs the low or the medium set). */
export function arenaTier(quality: ArenaQuality): 0 | 1 | 2 {
  if (quality.name === "high") return 2;
  if (quality.name === "medium") return 1;
  if (quality.name === "low") return 0;
  return quality.area ? 1 : 0;
}

// ---------------------------------------------------------------------------------------------------------------------
// The sky's light by direction

/** Light arriving from the six axis directions, in the bake's units (radiance: a white surface facing that way shows it). */
export interface AmbientCube {
  /** +x, -x, +y, -y, +z, -z. */
  faces: [Rgb, Rgb, Rgb, Rgb, Rgb, Rgb];
  /** Mean of the band round the horizon: what haze between the camera and a surface glows with. */
  horizon: Rgb;
}

/**
 * Averages an equirectangular panorama into an ambient cube. `decode` reads one channel of one texel; rows run upward
 * and u = 0.5 looks along -z (the look's panorama, see PANO_GLSL in battlefield-look.ts). Radiance above `ceiling` is
 * clipped first: the eclipse's limb is a light of its own (the bake and the lit lamps carry it), not ambient.
 */
export function ambientCubeFromPanorama(width: number, height: number, decode: (index: number) => number,
  options: { ceiling: number; step?: number; sign?: 1 | -1 }): AmbientCube {
  const step = Math.max(1, options.step ?? 8), sign = options.sign ?? 1;
  const sum = Array.from({ length: 6 }, () => [0, 0, 0]), weight = new Array<number>(6).fill(0);
  const horizon = [0, 0, 0];
  let horizonWeight = 0;
  for (let row = step >> 1; row < height; row += step) {
    const theta = ((row + 0.5) / height - 0.5) * Math.PI, cosTheta = Math.cos(theta), y = Math.sin(theta);
    for (let column = step >> 1; column < width; column += step) {
      const phi = ((column + 0.5) / width - 0.5) * 2 * Math.PI * sign;
      const x = Math.sin(phi) * cosTheta, z = -Math.cos(phi) * cosTheta;
      const at = (row * width + column) * 4;
      const r = Math.min(options.ceiling, decode(at)), g = Math.min(options.ceiling, decode(at + 1)), b = Math.min(options.ceiling, decode(at + 2));
      const axes = [x, -x, y, -y, z, -z];
      for (let face = 0; face < 6; face++) {
        // a texel's solid angle goes with cos(theta); its share of a face's light with the cosine to that face
        const w = Math.max(0, axes[face]) * cosTheta;
        if (w <= 0) continue;
        sum[face][0] += r * w; sum[face][1] += g * w; sum[face][2] += b * w; weight[face] += w;
      }
      if (Math.abs(y) < 0.2) {
        horizon[0] += r * cosTheta; horizon[1] += g * cosTheta; horizon[2] += b * cosTheta; horizonWeight += cosTheta;
      }
    }
  }
  const faces = sum.map((s, face) => s.map((v) => v / Math.max(1e-6, weight[face])) as Rgb) as AmbientCube["faces"];
  return { faces, horizon: horizon.map((v) => v / Math.max(1e-6, horizonWeight)) as Rgb };
}

/**
 * The sky's light as it reaches the arena's surfaces. The fog scatters the eclipse's light round the arena, so it
 * arrives more evenly than the bare sky would send it: each face keeps its colour, and the faces' brightnesses are
 * drawn toward one another (`evenness` 0 leaves them, 1 makes them equal) about the brightness of `anchor`.
 */
export function evenedCube(cube: AmbientCube, evenness: number, anchor: number): AmbientCube {
  const luma = (color: Rgb) => 0.2126 * color[0] + 0.7152 * color[1] + 0.0722 * color[2];
  const reference = Math.max(1e-6, luma(cube.faces[anchor]));
  const faces = cube.faces.map((face) => {
    const own = Math.max(1e-6, luma(face));
    const k = Math.pow(own / reference, 1 - evenness) * reference / own;
    return [face[0] * k, face[1] * k, face[2] * k] as Rgb;
  }) as AmbientCube["faces"];
  return { faces, horizon: cube.horizon };
}

/**
 * Draws each face's colour toward `tint` by that face's share, keeping the face's brightness. The fog between the
 * sky and the arena has a colour of its own (cool in Setting 1, violet in Setting 2) and what it scatters down takes
 * it; the side that looks at the eclipse keeps the eclipse's warmth.
 */
export function tintedCube(cube: AmbientCube, tint: Rgb, shares: readonly number[]): AmbientCube {
  const luma = (color: Rgb) => 0.2126 * color[0] + 0.7152 * color[1] + 0.0722 * color[2];
  const tintLuma = Math.max(1e-6, luma(tint));
  const faces = cube.faces.map((face, index) => {
    const own = luma(face), share = shares[index] ?? 0;
    return face.map((value, channel) => value * (1 - share) + tint[channel] / tintLuma * own * share) as Rgb;
  }) as AmbientCube["faces"];
  return { faces, horizon: cube.horizon };
}

// ---------------------------------------------------------------------------------------------------------------------
// Lava as light

/** The lava that stands in when the lava part lists none: the look's own pools and rivers, as its Blender scene
 * describes them (metres; `scale` brings them to the game's units). */
export function emittersFromInspect(inspect: Record<string, unknown>, scale: number): { at: Rgb; radius: number }[] {
  const lava = ((inspect.objects as Record<string, unknown> | undefined)?.lava ?? {}) as Record<string, { center_gl?: number[]; size?: number[] }>;
  const out: { at: Rgb; radius: number }[] = [];
  for (const [name, object] of Object.entries(lava)) {
    // the abyss under the board is a terrain 300 m across, not a pool: it is the warm light from below instead
    if (!/Pool|River/.test(name) || !object.center_gl || !object.size) continue;
    const spans = [...object.size].sort((a, b) => b - a);
    out.push({ at: object.center_gl.map((v) => v * scale) as Rgb, radius: 0.25 * (spans[0] + spans[1]) * scale });
  }
  return out;
}

/**
 * The emitters that can light something inside a sphere, nearest influence first, as indices into `emitters`.
 * `reach` is how many radii from an emitter its light is counted (the shader fades it out by there).
 */
export function emittersReaching(emitters: readonly { position: { x: number; y: number; z: number }; radius: number }[],
  center: { x: number; y: number; z: number }, radius: number, reach: number, limit: number): number[] {
  const scored: [number, number][] = [];
  emitters.forEach((emitter, index) => {
    const distance = Math.hypot(emitter.position.x - center.x, emitter.position.y - center.y, emitter.position.z - center.z);
    const gap = Math.max(0, distance - radius);
    if (gap < emitter.radius * reach) scored.push([index, gap / Math.max(1e-6, emitter.radius)]);
  });
  return scored.sort((a, b) => a[1] - b[1]).slice(0, limit).map(([index]) => index);
}

/** What the low tier's bake needs to work the arena's light out on the CPU, as the shader does (arena-surface.ts). */
export interface ArenaLightModel {
  faces: AmbientCube["faces"];
  /** The fill's strength, and the share of it the far ruins get. */
  fill: number; farShare: number;
  /** Where the arena is (x, z) and the distances over which the fill falls to the far ruins' share. */
  near: [number, number, number, number];
  /** The board: half its width, its top's height, how far from its foot the floor is shaded, the share left there. */
  board: [number, number, number, number];
  /** The lava's strength, and how many radii an emitter's light reaches. */
  lava: number; reach: number;
  emitters: { x: number; y: number; z: number; radius: number; color: Rgb }[];
}

/**
 * The light arriving at a place with a unit normal: the sky's fill by direction and the light of the stretches of
 * lava named in `mask` (one bit each). The same sums as cfFill and cfLava in arena-surface.ts.
 */
function smooth(low: number, high: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - low) / (high - low)));
  return t * t * (3 - 2 * t);
}

export function arenaLightAt(model: ArenaLightModel, mask: number, p: { x: number; y: number; z: number }, n: { x: number; y: number; z: number }, out: number[]): void {
  // (no closures, destructuring or Math.hypot: this runs for every vertex of the arena when the low tier bakes)
  const faces = model.faces, near = model.near, board = model.board;
  const fx = faces[n.x > 0 ? 0 : 1], fy = faces[n.y > 0 ? 2 : 3], fz = faces[n.z > 0 ? 4 : 5];
  const wx = n.x * n.x, wy = n.y * n.y, wz = n.z * n.z;
  const dx = p.x - near[0], dz = p.z - near[1];
  const far = smooth(near[2], near[3], Math.sqrt(dx * dx + dz * dz));
  const half = board[0], top = board[1], reach = board[2], share = board[3];
  const ox = Math.max(Math.abs(p.x) - half, 0), oz = Math.max(Math.abs(p.z) - half, 0);
  const foot = Math.min(1, smooth(0, reach, Math.sqrt(ox * ox + oz * oz)) + smooth(top - 0.4, top, p.y));
  const k = model.fill * (1 + (model.farShare - 1) * far) * (share + (1 - share) * foot);
  for (let c = 0; c < 3; c++) out[c] = (wx * fx[c] + wy * fy[c] + wz * fz[c]) * k;
  for (let i = 0; mask !== 0 && i < model.emitters.length; i++, mask >>>= 1) {
    if ((mask & 1) === 0) continue;
    const e = model.emitters[i];
    const dx = e.x - p.x, dy = e.y - p.y, dz = e.z - p.z;
    const r2 = e.radius * e.radius, d2 = dx * dx + dy * dy + dz * dz, range2 = r2 * model.reach * model.reach;
    if (d2 >= range2) continue;
    const inv = 1 / Math.sqrt(d2 + 1e-4), fade = 1 - d2 / range2, wide = Math.min(e.radius * inv, 0.35);
    const above = Math.min(1, Math.max(0, 0.4 - 1.3 * dy * inv));
    const wrap = Math.min(1, Math.max(0, ((n.x * dx + n.y * dy + n.z * dz) * inv + wide) / (1 + wide)));
    const strength = r2 / (d2 + r2) * fade * fade * above * wrap * model.lava;
    for (let c = 0; c < 3; c++) out[c] += e.color[c] * strength;
  }
}

/**
 * How open a place is, by the light baked into it: `low` where the bake is black, rising with the logarithm of the
 * baked light between 2^lo and 2^hi, 1 above. On a log scale a place lit a tenth as well as its neighbour still
 * reads as darker, so the bake's shading carries through under the fill. The same sum as cfOpenness in
 * arena-surface.ts and the low tier's bake.
 */
export function arenaOpenness(luma: number, low: number, lo: number, hi: number): number {
  const t = Math.min(1, Math.max(0, (Math.log2(Math.max(luma, 1e-7)) - lo) / (hi - lo)));
  return low + (1 - low) * t;
}

// ---------------------------------------------------------------------------------------------------------------------
// What a baked material is made of

/** How a surface answers light, from its material's name (the baked files carry base colour only). */
export interface SurfaceKind {
  name: string;
  roughness: number;
  /** 0 stone, 1 metal: a metal's highlight takes the surface's colour. */
  metal: number;
  /** How strongly the fine detail (break-up and bump) shows, 0-1. Plants get little: their meshes are the detail. */
  detail: number;
  /** Highlight strength, 0-1. */
  sheen: number;
  /** The share of the sky's fill it takes. The moss shells lie over the dais's carved floor and are mostly unlit in
   * the bake; at the full share they would cover it like a green carpet. */
  fill: number;
  /** Linear base colour, for the meshes whose bake holds colour times light in one (their material is plain white). */
  albedo: Rgb;
}

const KINDS: [RegExp, SurfaceKind][] = [
  [/Obsidian/i, { name: "obsidian", roughness: 0.28, metal: 0, detail: 0.45, sheen: 1, fill: 1, albedo: [0.02, 0.02, 0.024] }],
  [/Bronze|Gold|Manacle|InlayGlow/i, { name: "metal", roughness: 0.42, metal: 1, detail: 0.6, sheen: 1, fill: 1, albedo: [0.32, 0.2, 0.09] }],
  [/CrimsonLeaf|crimson|coral/i, { name: "leaf", roughness: 0.6, metal: 0, detail: 0.15, sheen: 0.35, fill: 1, albedo: [0.2, 0.035, 0.03] }],
  [/MossShell/i, { name: "moss", roughness: 0.85, metal: 0, detail: 0.2, sheen: 0.2, fill: 0.3, albedo: [0.06, 0.075, 0.035] }],
  [/Moss|Sedge|Fern|Vine/i, { name: "plant", roughness: 0.85, metal: 0, detail: 0.2, sheen: 0.2, fill: 1, albedo: [0.06, 0.075, 0.035] }],
  [/Root|roots|Fungus|fungus/i, { name: "wood", roughness: 0.8, metal: 0, detail: 0.5, sheen: 0.3, fill: 1, albedo: [0.1, 0.075, 0.055] }],
  [/Bone|HandStone|Skull/i, { name: "bone", roughness: 0.6, metal: 0, detail: 0.8, sheen: 0.6, fill: 1, albedo: [0.3, 0.27, 0.23] }],
  // Dark stone, glossier at the owner's asking (it was 0.9 and 0.07, taken down from 0.8 and 0.15 when a sharp, strong
  // highlight on so dark a surface read as metal on high). The highlight is still held to the surface's own brightness
  // (cfShineCap in arena-surface.ts), which is what keeps this wet rather than metallic.
  [/CooledLava|Basalt|rib/i, { name: "basalt", roughness: 0.62, metal: 0, detail: 0.7, sheen: 0.25, fill: 1, albedo: [0.06, 0.055, 0.052] }],
];
// (glossier at the owner's asking: it was 0.74 and 0.7)
const STONE: SurfaceKind = { name: "stone", roughness: 0.42, metal: 0, detail: 1, sheen: 1, fill: 1, albedo: [0.11, 0.1, 0.09] };

export function surfaceKind(materialName: string): SurfaceKind {
  return KINDS.find(([pattern]) => pattern.test(materialName))?.[1] ?? STONE;
}

// ---------------------------------------------------------------------------------------------------------------------
// The fine detail

function mulberry(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Texels of the surface detail, RGBA8, `size` square, repeating without a seam:
 *   R  mottle and grain about 0.5: stains a hand across and finer speckle, for breaking up colour and roughness;
 *   G,B the slope of a height field along u and v, about 0.5, for bump;
 *   A  1 on the flat, falling to 0 in the few cracks and the pits.
 * Generated here so that the game ships no texture for it.
 */
export function detailTexels(size: number, seed = 20261111): Uint8Array {
  const random = mulberry(seed);
  // value noise on lattices that wrap at the tile's edge
  const lattice = (period: number) => { const values = new Float32Array(period * period); for (let i = 0; i < values.length; i++) values[i] = random(); return values; };
  const sample = (values: Float32Array, period: number, u: number, v: number) => {
    const x = u * period, y = v * period, x0 = Math.floor(x), y0 = Math.floor(y);
    let fx = x - x0, fy = y - y0;
    fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
    const a = values[(y0 % period) * period + (x0 % period)], b = values[(y0 % period) * period + ((x0 + 1) % period)];
    const c = values[((y0 + 1) % period) * period + (x0 % period)], d = values[((y0 + 1) % period) * period + ((x0 + 1) % period)];
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  };
  const layers = (periods: number[], gain: number) => {
    const set = periods.map((period) => ({ period, values: lattice(period) }));
    return (u: number, v: number) => {
      let value = 0, amplitude = 1, total = 0;
      for (const { period, values } of set) { value += amplitude * sample(values, period, u, v); total += amplitude; amplitude *= gain; }
      return value / total;
    };
  };
  const smooth = (low: number, high: number, x: number) => { const t = Math.min(1, Math.max(0, (x - low) / (high - low))); return t * t * (3 - 2 * t); };
  const mottle = layers([3, 6, 12], 0.6), speckle = layers([24, 48, 96], 0.75), relief = layers([4, 8, 16, 32, 64], 0.6);
  const where = layers([2, 4], 0.5), pitting = layers([36, 72], 0.8);
  // cracks: stretches of the borders between cells of scattered points (also wrapping)
  const cells = 5, points = new Float32Array(cells * cells * 2);
  for (let i = 0; i < points.length; i++) points[i] = random();
  const height = new Float32Array(size * size), grain = new Float32Array(size * size), flat = new Float32Array(size * size);
  for (let row = 0; row < size; row++) {
    for (let column = 0; column < size; column++) {
      const u = (column + 0.5) / size, v = (row + 0.5) / size;
      let nearest = 9, second = 9;
      const cu = u * cells, cv = v * cells, cx = Math.floor(cu), cy = Math.floor(cv);
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const ix = (cx + dx + cells) % cells, iy = (cy + dy + cells) % cells;
          const px = cx + dx + points[(iy * cells + ix) * 2], py = cy + dy + points[(iy * cells + ix) * 2 + 1];
          const distance = Math.hypot(px - cu, py - cv);
          if (distance < nearest) { second = nearest; nearest = distance; } else if (distance < second) second = distance;
        }
      }
      const fine = speckle(u, v);
      // a crack runs where the two nearest points are equally far, and only where a broad noise lets it: a few
      // broken lines to a tile, not a net of cells
      const crack = (1 - smooth(0.004, 0.035, second - nearest)) * smooth(0.6, 0.7, where(u, v));
      const pit = smooth(0.7, 0.77, pitting(u, v));
      const i = row * size + column;
      flat[i] = 1 - Math.max(crack, 0.7 * pit);
      grain[i] = 0.5 + 0.9 * (mottle(u, v) - 0.5) + 0.7 * (fine - 0.5);
      // cracks and pits are cut into the height field, so the bump follows them
      height[i] = relief(u, v) + 0.1 * (fine - 0.5) - 0.2 * crack - 0.1 * pit;
    }
  }
  const out = new Uint8Array(size * size * 4);
  const pack = (value: number) => Math.max(0, Math.min(255, Math.round(value * 255)));
  for (let row = 0; row < size; row++) {
    for (let column = 0; column < size; column++) {
      const i = row * size + column;
      const left = height[row * size + ((column + size - 1) % size)], right = height[row * size + ((column + 1) % size)];
      const down = height[((row + size - 1) % size) * size + column], up = height[((row + 1) % size) * size + column];
      out[i * 4] = pack(grain[i]);
      out[i * 4 + 1] = pack(0.5 + (right - left) * size * DETAIL_SLOPE);
      out[i * 4 + 2] = pack(0.5 + (up - down) * size * DETAIL_SLOPE);
      out[i * 4 + 3] = pack(flat[i]);
    }
  }
  return out;
}
/** The packed slope per unit of height change across one texel pair, times the tile's size in texels. */
export const DETAIL_SLOPE = 1 / 56;

/**
 * Texels of the air's noise, RGBA8, `size` square, repeating without a seam: R broad shapes with strong contrast
 * (the gaps between light shafts), G and B two softer fields about 0.5 (wisps in the mist), A unused.
 */
export function airTexels(size: number, seed = 20261112): Uint8Array {
  const random = mulberry(seed);
  const field = (periods: number[], gain: number) => {
    const layers = periods.map((period) => { const values = new Float32Array(period * period); for (let i = 0; i < values.length; i++) values[i] = random(); return { period, values }; });
    const out = new Float32Array(size * size);
    let low = Infinity, high = -Infinity;
    for (let row = 0; row < size; row++) {
      for (let column = 0; column < size; column++) {
        const u = (column + 0.5) / size, v = (row + 0.5) / size;
        let value = 0, amplitude = 1;
        for (const { period, values } of layers) {
          const x = u * period, y = v * period, x0 = Math.floor(x), y0 = Math.floor(y);
          let fx = x - x0, fy = y - y0;
          fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
          const a = values[(y0 % period) * period + (x0 % period)], b = values[(y0 % period) * period + ((x0 + 1) % period)];
          const c = values[((y0 + 1) % period) * period + (x0 % period)], d = values[((y0 + 1) % period) * period + ((x0 + 1) % period)];
          value += amplitude * (a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy);
          amplitude *= gain;
        }
        out[row * size + column] = value;
        low = Math.min(low, value); high = Math.max(high, value);
      }
    }
    for (let i = 0; i < out.length; i++) out[i] = (out[i] - low) / Math.max(1e-6, high - low);
    return out;
  };
  const beams = field([3, 6, 12], 0.5), wispA = field([4, 8, 16, 32], 0.6), wispB = field([5, 10, 20], 0.6);
  const out = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    out[i * 4] = Math.round(beams[i] * 255); out[i * 4 + 1] = Math.round(wispA[i] * 255);
    out[i * 4 + 2] = Math.round(wispB[i] * 255); out[i * 4 + 3] = 255;
  }
  return out;
}
