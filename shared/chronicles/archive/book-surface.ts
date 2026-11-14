import type { AtlasBookFamily, AtlasBookPart } from './book';
import { ATLAS_BOOK_MATERIALS } from './book-materials';

export interface BookSurface {
  side: AtlasBookPart['side']; family: AtlasBookFamily;
  positions: Float32Array; normals: Float32Array; uvs: Float32Array; indices: Uint16Array;
}

/** Rounded physical edges and dimension-aware UVs; independent of either Three runtime. */
export function atlasBookSurfaces(parts: readonly AtlasBookPart[], width: number, depth: number): BookSurface[] {
  const batches: BookSurface[] = [];
  for (const side of ['left', 'right', 'spine'] as const) for (const family of ['leather', 'paper', 'bronze'] as const) {
    const selected = parts.filter(part => part.side === side && part.family === family);
    if (!selected.length) continue;
    const positions: number[] = [], normals: number[] = [], uvs: number[] = [], indices: number[] = [];
    const island = ATLAS_BOOK_MATERIALS.islands[family], atlasSize = ATLAS_BOOK_MATERIALS.size;
    for (const part of selected) {
      const h = part.size.map(value => value / 2);
      const radius = Math.min(family === 'leather' ? .0014 : .00065, Math.min(...h) * .45);
      // Broad covers need two arc segments. Tiny fittings/page edges need only a chamfer.
      const broad = family === 'leather' && part.size[0] > .5;
      const coordinates = h.map(half => broad
        ? [-half, -half + radius * .293, -half + radius, half - radius, half - radius * .293, half]
        : [-half, -half + radius, half - radius, half]);
      const c = Math.cos(part.yaw), s = Math.sin(part.yaw);
      for (let axis = 0; axis < 3; axis++) for (const sign of [-1, 1]) {
        const u = (axis + 1) % 3, v = (axis + 2) % 3;
        const nx = coordinates[u].length, ny = coordinates[v].length, first = positions.length / 3;
        for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
          const p = [0, 0, 0]; p[axis] = sign * h[axis]; p[u] = coordinates[u][i]; p[v] = coordinates[v][j];
          const inner = p.map((value, a) => Math.max(-h[a] + radius, Math.min(h[a] - radius, value)));
          const n = p.map((value, a) => value - inner[a]); const length = Math.hypot(...n);
          for (let a = 0; a < 3; a++) n[a] /= length;
          const rounded = inner.map((value, a) => value + n[a] * radius);
          positions.push((rounded[0] * c + rounded[2] * s + part.at[0]) * width,
            (rounded[1] + part.at[1]) * width, (-rounded[0] * s + rounded[2] * c + part.at[2]) * width);
          normals.push(n[0] * c + n[2] * s, n[1], -n[0] * s + n[2] * c);
          let su: number, sv: number;
          if (axis === 1) { su = p[0]; sv = p[2]; }
          else if (axis === 0 && family === 'leather') { su = p[1] * (side === 'spine' ? 2.4 : 1); sv = p[2]; }
          else if (axis === 0) { su = p[2]; sv = p[1]; }
          else { su = p[0]; sv = p[1]; }
          // Full cover faces use the bound-edge wear bake. Small insets/edges crop its clean centre.
          const full = broad && axis === 1;
          const scaleU = family === 'leather' ? .526 : family === 'bronze' ? .085 : .496;
          const scaleV = family === 'leather' ? depth / width + .037 : family === 'bronze' ? .085 : .09;
          const tu = .5 + su / scaleU, tv = .5 + sv / scaleV;
          const a = full ? tu : Math.max(.08, Math.min(.92, tu));
          const b = full ? tv : Math.max(.08, Math.min(.92, tv));
          uvs.push((island[0] + a * island[2]) / atlasSize, 1 - (island[1] + b * island[3]) / atlasSize);
        }
        for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
          const a = first + j * nx + i, b = a + 1, d = a + nx, e = d + 1;
          if (sign > 0) indices.push(a, b, d, b, e, d); else indices.push(a, d, b, b, d, e);
        }
      }
    }
    batches.push({ side, family, positions: new Float32Array(positions), normals: new Float32Array(normals),
      uvs: new Float32Array(uvs), indices: new Uint16Array(indices) });
  }
  return batches;
}
