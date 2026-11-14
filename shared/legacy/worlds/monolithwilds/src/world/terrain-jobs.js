// Terrain compute kernels — pure functions shared by the terrain workers (terrain-worker.js) and the
// main-thread fallback. No THREE, no DOM.
//
// Grid conventions
// ----------------
// The LOD quadtree root is a 36 800 m square centred on the origin (the playable world is ±4600 m;
// the rest is the far mountain ring seen from altitude). Every vertex of every level sits on a
// global lattice of "leaf units" (LEAF_STEP = 2.246 m); level L uses a stride of 2^(8-L) units.
// The world grid (1025² samples, 8.98 m) covers ±4600 m and coincides exactly with level 6, so
// coarse chunks are pure lookups and fine chunks only compute the samples the world grid lacks.

import { heightAt, canyonDistance } from '../core/terrain-height.js';
import { forestDensity, meadowDensity } from '../core/biome.js';
import { LANDMARK_BY_ID } from '../core/layout.js';

export const ROOT = 36800;
export const ROOT_HALF = ROOT / 2;
export const CELLS = 64; // cells per chunk side
export const VERTS = CELLS + 1; // 65
export const BORDER = 2; // extra samples around a chunk (normals + coarse normals)
export const GW = VERTS + 2 * BORDER; // 69: sampled grid width
export const MAX_LEVEL = 8;
export const LEAF_STEP = ROOT / (CELLS << MAX_LEVEL); // 2.24609375 (exact in binary)
export const SKIRT_VERTS = 4 * VERTS;
export const CHUNK_VERTS = VERTS * VERTS + SKIRT_VERTS; // 4485

// World grid: 1025 x 1025 over ±4600, stride 4 leaf units.
export const WG_N = 1025;
export const WG_X0 = -4600;
export const WG_STEP = 9200 / 1024; // 8.984375
const WG_STRIDE = 4;
const WG_G0 = Math.round((WG_X0 + ROOT_HALF) / LEAF_STEP); // 6144
const WG_G1 = WG_G0 + (WG_N - 1) * WG_STRIDE; // 10240
const CG_STRIDE = 32;
const CG_G0 = 4096; // (-9200 + 18400) / LEAF_STEP
const CG_G1 = CG_G0 + 256 * CG_STRIDE;

// Coarse outer grid (257², 71.9 m = level-3 spacing, ±9200 m): distant occluders for the
// sun-visibility sweep (the far western wall, the outer ranges), and free samples for far chunks.
export const CG_N = 257;
export const CG_X0 = -9200;
export const CG_STEP = 18400 / 256; // 71.875

export const levelSize = (L) => ROOT / (1 << L);
export const levelStride = (L) => 1 << (MAX_LEVEL - L); // leaf units per cell
export const levelStep = (L) => levelSize(L) / CELLS;

// ---------------------------------------------------------------------------
// World grid
// ---------------------------------------------------------------------------

/** Heights for world-grid rows [j0, j1). */
export function worldRows(j0, j1) {
  const out = new Float32Array((j1 - j0) * WG_N);
  let k = 0;
  for (let j = j0; j < j1; j++) {
    const z = WG_X0 + j * WG_STEP;
    for (let i = 0; i < WG_N; i++) out[k++] = heightAt(WG_X0 + i * WG_STEP, z);
  }
  return out;
}

/** Heights for coarse-grid rows [j0, j1). */
export function coarseRows(j0, j1) {
  const out = new Float32Array((j1 - j0) * CG_N);
  let k = 0;
  for (let j = j0; j < j1; j++) {
    const z = CG_X0 + j * CG_STEP;
    for (let i = 0; i < CG_N; i++) out[k++] = heightAt(CG_X0 + i * CG_STEP, z);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Chunk sampling + vertex generation
// ---------------------------------------------------------------------------

/**
 * Sample the (GW x GW) height grid of chunk (L, ix, iz), including a 2-sample border.
 * Re-uses the world grid and (optionally) the parent chunk's grid wherever lattice points coincide.
 */
export function sampleChunk(L, ix, iz, world, parent, coarse = null) {
  const stride = levelStride(L);
  const gx0 = ix * CELLS * stride;
  const gz0 = iz * CELLS * stride;
  const H = new Float32Array(GW * GW);
  let pgx0 = 0, pgz0 = 0, pstride = 0;
  if (parent) {
    pstride = stride * 2;
    pgx0 = (ix >> 1) * CELLS * pstride;
    pgz0 = (iz >> 1) * CELLS * pstride;
  }
  let computed = 0;
  for (let j = 0; j < GW; j++) {
    const gz = gz0 + (j - BORDER) * stride;
    const z = gz * LEAF_STEP - ROOT_HALF;
    const zInWorld = world && gz >= WG_G0 && gz <= WG_G1 && (gz - WG_G0) % WG_STRIDE === 0;
    const wRow = zInWorld ? ((gz - WG_G0) / WG_STRIDE) * WG_N : 0;
    const zInCoarse = coarse && gz >= CG_G0 && gz <= CG_G1 && (gz - CG_G0) % CG_STRIDE === 0;
    const cRow = zInCoarse ? ((gz - CG_G0) / CG_STRIDE) * CG_N : 0;
    let pRow = -1;
    if (parent) {
      const pj = (gz - pgz0) / pstride + BORDER;
      if (pj === Math.floor(pj) && pj >= 0 && pj < GW) pRow = pj * GW;
    }
    for (let i = 0; i < GW; i++) {
      const gx = gx0 + (i - BORDER) * stride;
      if (zInWorld && gx >= WG_G0 && gx <= WG_G1 && (gx - WG_G0) % WG_STRIDE === 0) {
        H[j * GW + i] = world[wRow + (gx - WG_G0) / WG_STRIDE];
        continue;
      }
      if (zInCoarse && gx >= CG_G0 && gx <= CG_G1 && (gx - CG_G0) % CG_STRIDE === 0) {
        H[j * GW + i] = coarse[cRow + (gx - CG_G0) / CG_STRIDE];
        continue;
      }
      if (pRow >= 0) {
        const pi = (gx - pgx0) / pstride + BORDER;
        if (pi === Math.floor(pi) && pi >= 0 && pi < GW) {
          H[j * GW + i] = parent[pRow + pi];
          continue;
        }
      }
      H[j * GW + i] = heightAt(gx * LEAF_STEP - ROOT_HALF, z);
      computed++;
    }
  }
  H.computed = computed;
  return H;
}

/**
 * Build the vertex streams of a chunk from its sampled grid (packed: 30 bytes per vertex).
 *   pos   float xyz world position (fine)
 *   nrm   int16 (normalised) fine normal
 *   mor   float x = height on the parent level's surface (geomorph target), y = level,
 *         z = height on the grandparent level's surface along the chunk border (so a border
 *         follows a coarser neighbour's own morph exactly; = x inside the chunk)
 *   morN  int16 (normalised) parent-level normal (x, z components)
 * Skirts hang below the four edges to hide any transient cracks between LOD levels.
 */
export function buildChunk(L, ix, iz, H) {
  const stride = levelStride(L);
  const step = stride * LEAF_STEP;
  const x0 = ix * CELLS * stride * LEAF_STEP - ROOT_HALF;
  const z0 = iz * CELLS * stride * LEAF_STEP - ROOT_HALF;
  const pos = new Float32Array(CHUNK_VERTS * 3);
  const nrm = new Int16Array(CHUNK_VERTS * 3);
  const mor = new Float32Array(CHUNK_VERTS * 3);
  const morN = new Int16Array(CHUNK_VERTS * 2);
  const Q = 32767;
  const h = (i, j) => H[(j + BORDER) * GW + i + BORDER];

  // parent-level normals at even vertices (33 x 33)
  const CN = (CELLS >> 1) + 1;
  const cnx = new Float32Array(CN * CN);
  const cnz = new Float32Array(CN * CN);
  const inv4 = 1 / (4 * step);
  for (let J = 0; J < CN; J++) {
    for (let I = 0; I < CN; I++) {
      const i = I * 2, j = J * 2;
      const dx = (h(i - 2, j) - h(i + 2, j)) * inv4;
      const dz = (h(i, j - 2) - h(i, j + 2)) * inv4;
      const l = 1 / Math.sqrt(dx * dx + 1 + dz * dz);
      cnx[J * CN + I] = dx * l;
      cnz[J * CN + I] = dz * l;
    }
  }

  let minY = Infinity, maxY = -Infinity;
  const inv2 = 1 / (2 * step);
  for (let j = 0; j < VERTS; j++) {
    for (let i = 0; i < VERTS; i++) {
      const v = j * VERTS + i;
      const y = h(i, j);
      pos[v * 3] = x0 + i * step;
      pos[v * 3 + 1] = y;
      pos[v * 3 + 2] = z0 + j * step;
      const dx = (h(i - 1, j) - h(i + 1, j)) * inv2;
      const dz = (h(i, j - 1) - h(i, j + 1)) * inv2;
      const l = 1 / Math.sqrt(dx * dx + 1 + dz * dz);
      nrm[v * 3] = Math.round(dx * l * Q);
      nrm[v * 3 + 1] = Math.round(l * Q);
      nrm[v * 3 + 2] = Math.round(dz * l * Q);
      // geomorph target: the surface of the parent level's triangulation
      const ie = (i & 1) === 0, je = (j & 1) === 0;
      let yc, ncx, ncz;
      if (ie && je) {
        yc = y;
        const c = (j >> 1) * CN + (i >> 1);
        ncx = cnx[c];
        ncz = cnz[c];
      } else if (!ie && je) {
        yc = 0.5 * (h(i - 1, j) + h(i + 1, j));
        const a = (j >> 1) * CN + ((i - 1) >> 1);
        ncx = 0.5 * (cnx[a] + cnx[a + 1]);
        ncz = 0.5 * (cnz[a] + cnz[a + 1]);
      } else if (ie && !je) {
        yc = 0.5 * (h(i, j - 1) + h(i, j + 1));
        const a = ((j - 1) >> 1) * CN + (i >> 1);
        ncx = 0.5 * (cnx[a] + cnx[a + CN]);
        ncz = 0.5 * (cnz[a] + cnz[a + CN]);
      } else {
        const I = (i - 1) >> 1, J = (j - 1) >> 1;
        const a = J * CN + I;
        if (((I + J) & 1) === 0) {
          yc = 0.5 * (h(i - 1, j - 1) + h(i + 1, j + 1));
          ncx = 0.5 * (cnx[a] + cnx[a + CN + 1]);
          ncz = 0.5 * (cnz[a] + cnz[a + CN + 1]);
        } else {
          yc = 0.5 * (h(i + 1, j - 1) + h(i - 1, j + 1));
          ncx = 0.5 * (cnx[a + 1] + cnx[a + CN]);
          ncz = 0.5 * (cnz[a + 1] + cnz[a + CN]);
        }
      }
      mor[v * 3] = yc;
      mor[v * 3 + 1] = L;
      mor[v * 3 + 2] = yc;
      if (i === 0 || i === CELLS || j === 0 || j === CELLS) {
        // border: grandparent surface = linear between every 4th sample along the edge
        const alongI = j === 0 || j === CELLS;
        const t = alongI ? i : j;
        const t0 = t & ~3, t1 = Math.min(CELLS, t0 + 4), f = (t - t0) / 4;
        const ya = alongI ? h(t0, j) : h(i, t0);
        const yb = alongI ? h(t1, j) : h(i, t1);
        mor[v * 3 + 2] = ya + (yb - ya) * f;
      }
      morN[v * 2] = Math.round(ncx * Q);
      morN[v * 2 + 1] = Math.round(ncz * Q);
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (yc < minY) minY = yc;
      if (yc > maxY) maxY = yc;
      const y2 = mor[v * 3 + 2];
      if (y2 < minY) minY = y2;
      if (y2 > maxY) maxY = y2;
    }
  }

  // skirts: north (j=0), south (j=64), west (i=0), east (i=64) edges
  const depth = step * 6 + 6;
  let s = VERTS * VERTS;
  const edge = (i, j) => {
    const v = j * VERTS + i;
    pos[s * 3] = pos[v * 3];
    pos[s * 3 + 1] = pos[v * 3 + 1] - depth;
    pos[s * 3 + 2] = pos[v * 3 + 2];
    nrm[s * 3] = nrm[v * 3];
    nrm[s * 3 + 1] = nrm[v * 3 + 1];
    nrm[s * 3 + 2] = nrm[v * 3 + 2];
    mor[s * 3] = mor[v * 3] - depth;
    mor[s * 3 + 1] = L;
    mor[s * 3 + 2] = mor[v * 3 + 2] - depth;
    morN[s * 2] = morN[v * 2];
    morN[s * 2 + 1] = morN[v * 2 + 1];
    s++;
  };
  for (let i = 0; i < VERTS; i++) edge(i, 0);
  for (let i = 0; i < VERTS; i++) edge(i, CELLS);
  for (let j = 0; j < VERTS; j++) edge(0, j);
  for (let j = 0; j < VERTS; j++) edge(CELLS, j);
  minY -= depth;

  return { pos, nrm, mor, morN, minY, maxY, x0, z0, size: step * CELLS };
}

/** Shared triangle index list for every chunk (alternating diagonals + outward-facing skirts). */
export function buildChunkIndex(stride = 1) {
  const idx=[];
  for(let j=0;j<CELLS;j+=stride)for(let i=0;i<CELLS;i+=stride){const a=j*VERTS+i,b=a+stride,c=a+VERTS*stride,d=c+stride;idx.push(a,c,d,a,d,b);}
  const S=VERTS*VERTS,north=S,south=S+VERTS,west=S+2*VERTS,east=S+3*VERTS;
  for(let i=0;i<CELLS;i+=stride){let t0=i,t1=i+stride,s0=north+i,s1=north+i+stride;idx.push(t0,t1,s0,t1,s1,s0);t0=CELLS*VERTS+i;t1=t0+stride;s0=south+i;s1=south+i+stride;idx.push(t0,s0,t1,t1,s0,s1);}
  for(let j=0;j<CELLS;j+=stride){let t0=j*VERTS,t1=(j+stride)*VERTS,s0=west+j,s1=west+j+stride;idx.push(t0,s0,t1,t1,s0,s1);t0=j*VERTS+CELLS;t1=(j+stride)*VERTS+CELLS;s0=east+j;s1=east+j+stride;idx.push(t0,t1,s0,t1,s1,s0);}
  return new Uint16Array(idx);
}

// ---------------------------------------------------------------------------
// World shading maps
// ---------------------------------------------------------------------------

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const sstep = (a, b, x) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/** Normal (nx, nz) of the world grid at (i, j). */
function worldNormal(world, i, j, out) {
  const n = WG_N;
  const il = i > 0 ? i - 1 : i, ir = i < n - 1 ? i + 1 : i;
  const jd = j > 0 ? j - 1 : j, ju = j < n - 1 ? j + 1 : j;
  const dx = (world[j * n + il] - world[j * n + ir]) / ((ir - il) * WG_STEP);
  const dz = (world[jd * n + i] - world[ju * n + i]) / ((ju - jd) * WG_STEP);
  const l = 1 / Math.sqrt(dx * dx + 1 + dz * dz);
  out[0] = dx * l;
  out[1] = l;
  out[2] = dz * l;
  return out;
}

/** Warm sedimentary rock (sandstone) share: canyon, mesa, plateau. 0 = limestone/granite. */
function sandstoneAt(x, z) {
  const { d } = canyonDistance(x, z);
  let s = 1 - sstep(260, 720, d);
  const t = LANDMARK_BY_ID.temple;
  s = Math.max(s, 1 - sstep(330, 760, Math.sqrt((x - t.x) ** 2 + (z - t.z) ** 2)));
  const n = LANDMARK_BY_ID.needles;
  s = Math.max(s, 0.75 * (1 - sstep(520, 980, Math.sqrt((x - n.x) ** 2 + (z - n.z) ** 2))));
  return s;
}

/**
 * Per-row maps for world-grid rows [j0, j1): RGBA8 "A" (nx, nz, -, -) and "B" (forest, meadow,
 * talus, sandstone). Cavity and flow (whole-grid operators) are filled in by worldGlobal().
 *
 * Talus: cliff material (steep and higher up) collected from a ~80 m neighbourhood, deposited on
 * the gentler ground below — scree aprons at the feet of cliffs.
 */
export function worldMapRows(world, j0, j1) {
  const n = WG_N;
  const A = new Uint8Array((j1 - j0) * n * 4);
  const B = new Uint8Array((j1 - j0) * n * 4);
  const nrm = [0, 1, 0];
  // slope (1 - ny) for the rows plus the talus window margin
  const R = 3, ST = 3, M = R * ST;
  const s0 = Math.max(0, j0 - M), s1 = Math.min(n, j1 + M);
  const cliff = new Float32Array((s1 - s0) * n);
  const slope = new Float32Array((s1 - s0) * n);
  for (let j = s0; j < s1; j++) {
    for (let i = 0; i < n; i++) {
      const sv = 1 - worldNormal(world, i, j, nrm)[1];
      slope[(j - s0) * n + i] = sv;
      cliff[(j - s0) * n + i] = sstep(0.28, 0.55, sv);
    }
  }
  let k = 0;
  for (let j = j0; j < j1; j++) {
    const z = WG_X0 + j * WG_STEP;
    for (let i = 0; i < n; i++, k += 4) {
      const x = WG_X0 + i * WG_STEP;
      const h = world[j * n + i];
      worldNormal(world, i, j, nrm);
      A[k] = Math.round((nrm[0] * 0.5 + 0.5) * 255);
      A[k + 1] = Math.round((nrm[2] * 0.5 + 0.5) * 255);
      B[k] = Math.round(forestDensity(x, z, h, nrm[1]) * 255);
      B[k + 1] = Math.round(meadowDensity(x, z) * 255);
      B[k + 3] = Math.round(sandstoneAt(x, z) * 255);
      // talus
      if (h > -2) {
        let acc = 0, ws = 0;
        for (let dj = -R; dj <= R; dj++) {
          const jj = j + dj * ST;
          if (jj < 0 || jj >= n) continue;
          const row = jj * n, crow = (jj - s0) * n;
          for (let di = -R; di <= R; di++) {
            const ii = i + di * ST;
            if (ii < 0 || ii >= n) continue;
            const w = 1 / (1 + 0.35 * (di * di + dj * dj));
            ws += w;
            if (world[row + ii] > h + 6) acc += w * cliff[crow + ii];
          }
        }
        const kk = (j - s0) * n + i;
        const t = clamp01((acc / ws) * 3.2) * (1 - cliff[kk]) * sstep(0.03, 0.12, slope[kk] + 0.04);
        B[k + 2] = Math.round(t * 255);
      }
    }
  }
  return { A, B };
}

/** Separable box blur (radius r) of a float grid, edge-clamped. */
function boxBlur(src, n, r) {
  const tmp = new Float32Array(n * n);
  const out = new Float32Array(n * n);
  const w = 2 * r + 1;
  for (let j = 0; j < n; j++) {
    const row = j * n;
    let acc = 0;
    for (let k = -r; k <= r; k++) acc += src[row + Math.min(n - 1, Math.max(0, k))];
    for (let i = 0; i < n; i++) {
      tmp[row + i] = acc / w;
      acc += src[row + Math.min(n - 1, i + r + 1)] - src[row + Math.max(0, i - r)];
    }
  }
  for (let i = 0; i < n; i++) {
    let acc = 0;
    for (let k = -r; k <= r; k++) acc += tmp[Math.min(n - 1, Math.max(0, k)) * n + i];
    for (let j = 0; j < n; j++) {
      out[j * n + i] = acc / w;
      acc += tmp[Math.min(n - 1, j + r + 1) * n + i] - tmp[Math.max(0, j - r) * n + i];
    }
  }
  return out;
}

/**
 * Whole-grid operators: multi-scale cavity (ambient occlusion proxy) and multiple-flow-direction
 * drainage accumulation (gullies, wet channels).
 * Returns Uint8 arrays (WG_N²): cavity (128 = neutral, >128 concave), flow.
 */
export function worldGlobal(world) {
  const n = WG_N;
  const N = n * n;
  // --- cavity
  const b1 = boxBlur(world, n, 2);
  const b2 = boxBlur(world, n, 7);
  const b3 = boxBlur(world, n, 24);
  const cavity = new Uint8Array(N);
  for (let k = 0; k < N; k++) {
    const h = world[k];
    const c = (b1[k] - h) / 5 * 0.45 + (b2[k] - h) / 18 * 0.35 + (b3[k] - h) / 60 * 0.3;
    cavity[k] = Math.round(clamp01(0.5 + 0.5 * Math.tanh(c)) * 255);
  }

  // --- flow accumulation (MFD), cells processed from high to low via counting sort
  let hmin = Infinity, hmax = -Infinity;
  for (let k = 0; k < N; k++) {
    if (world[k] < hmin) hmin = world[k];
    if (world[k] > hmax) hmax = world[k];
  }
  const BUCKETS = 65536;
  const scale = (BUCKETS - 1) / Math.max(1, hmax - hmin);
  const count = new Uint32Array(BUCKETS + 1);
  const key = new Uint16Array(N);
  for (let k = 0; k < N; k++) {
    const b = BUCKETS - 1 - Math.floor((world[k] - hmin) * scale); // descending height
    key[k] = b;
    count[b + 1]++;
  }
  for (let b = 0; b < BUCKETS; b++) count[b + 1] += count[b];
  const order = new Uint32Array(N);
  for (let k = 0; k < N; k++) order[count[key[k]]++] = k;
  const acc = new Float32Array(N).fill(1);
  const DI = [-1, 0, 1, -1, 1, -1, 0, 1];
  const DJ = [-1, -1, -1, 0, 0, 1, 1, 1];
  const DW = [0.7071, 1, 0.7071, 1, 1, 0.7071, 1, 0.7071];
  const wts = new Float32Array(8);
  for (let o = 0; o < N; o++) {
    const k = order[o];
    const h = world[k];
    if (h < 0) continue; // the lake swallows everything
    const i = k % n, j = (k - i) / n;
    let sum = 0;
    for (let d = 0; d < 8; d++) {
      const ii = i + DI[d], jj = j + DJ[d];
      wts[d] = 0;
      if (ii < 0 || jj < 0 || ii >= n || jj >= n) continue;
      const drop = (h - world[jj * n + ii]) * DW[d];
      if (drop > 0) {
        const w = drop * drop; // sharpen toward steepest descent
        wts[d] = w;
        sum += w;
      }
    }
    if (sum <= 0) continue;
    const a = acc[k] / sum;
    for (let d = 0; d < 8; d++) if (wts[d] > 0) acc[(j + DJ[d]) * n + i + DI[d]] += a * wts[d];
  }
  const flow = new Uint8Array(N);
  const lref = 1 / Math.log(1 + 3000);
  for (let k = 0; k < N; k++) flow[k] = world[k] < 0 ? 0 : Math.round(clamp01((Math.log(1 + acc[k]) - Math.log(4)) * lref * 1.15) * 255);

  return { cavity, flow };
}

// ---------------------------------------------------------------------------
// Sun visibility (heightfield shadows for the whole world)
// ---------------------------------------------------------------------------

/**
 * One shadow-line sweep over an n x n grid toward the light (O(n²)): for every cell, the highest
 * occluder "shadow line" arriving from the light side. Two sweeps (upper / lower edge of the sun
 * disc) give a penumbra that widens with distance from the occluder.
 * `incoming(x, z, hi)` supplies the shadow line entering the grid from outside (or null).
 * Returns { hi, lo }: incoming shadow heights per cell (before the cell's own height).
 */
function sweep(H, n, x0, step, dir, spread, incoming) {
  const outHi = new Float32Array(n * n);
  const outLo = new Float32Array(n * n);
  const hl = Math.sqrt(dir[0] * dir[0] + dir[2] * dir[2]);
  const ux = dir[0] / hl, uz = dir[2] / hl;
  const tanE = dir[1] / hl;
  const tanHi = tanE + spread, tanLo = Math.max(-0.05, tanE - spread);
  const xMajor = Math.abs(ux) >= Math.abs(uz);
  const major = xMajor ? ux : uz;
  const minorRate = (xMajor ? uz : ux) / Math.abs(major);
  const stepLen = step / Math.abs(major);
  const dropHi = stepLen * tanHi, dropLo = stepLen * tanLo;
  const sgn = major > 0 ? 1 : -1;
  let prevHi = new Float32Array(n), prevLo = new Float32Array(n);
  let curHi = new Float32Array(n), curLo = new Float32Array(n);
  const start = sgn > 0 ? n - 1 : 0;
  for (let s = 0; s < n; s++) {
    const a = start - sgn * s; // major index, processed from the light side
    for (let b = 0; b < n; b++) {
      const k = xMajor ? b * n + a : a * n + b;
      let sh, sl;
      const fb = b + minorRate;
      if (s > 0 && fb >= 0 && fb <= n - 1) {
        const b0 = Math.floor(fb);
        const b1 = b0 < n - 1 ? b0 + 1 : b0;
        const t = fb - b0;
        sh = prevHi[b0] + (prevHi[b1] - prevHi[b0]) * t - dropHi;
        sl = prevLo[b0] + (prevLo[b1] - prevLo[b0]) * t - dropLo;
      } else if (incoming) {
        const x = x0 + (xMajor ? a : b) * step, z = x0 + (xMajor ? b : a) * step;
        sh = incoming(x, z, true);
        sl = incoming(x, z, false);
      } else {
        sh = sl = -1e9;
      }
      outHi[k] = sh;
      outLo[k] = sl;
      const h = H[k];
      curHi[b] = h > sh ? h : sh;
      curLo[b] = h > sl ? h : sl;
    }
    let t = prevHi;
    prevHi = curHi;
    curHi = t;
    t = prevLo;
    prevLo = curLo;
    curLo = t;
  }
  return { hi: outHi, lo: outLo };
}

/**
 * Soft terrain shadow for the key light (sun, or moon at night) over the whole world grid.
 * Distant occluders beyond ±4600 m come from a sweep over the coarse outer grid.
 * `dir` = unit vector toward the light. Returns Uint8 visibility (255 = lit).
 */
export function sunVisibility(world, dir, coarse = null, spread = 0.012) {
  const n = WG_N;
  const out = new Uint8Array(n * n);
  const hl = Math.sqrt(dir[0] * dir[0] + dir[2] * dir[2]);
  if (dir[1] <= -0.02 || hl < 1e-4) {
    out.fill(dir[1] > 0 ? 255 : 0);
    return out;
  }
  let incoming = null;
  if (coarse) {
    const c = sweep(coarse, CG_N, CG_X0, CG_STEP, dir, spread, null);
    incoming = (x, z, hi) => {
      const arr = hi ? c.hi : c.lo;
      let fx = (x - CG_X0) / CG_STEP, fz = (z - CG_X0) / CG_STEP;
      fx = fx < 0 ? 0 : fx > CG_N - 1.001 ? CG_N - 1.001 : fx;
      fz = fz < 0 ? 0 : fz > CG_N - 1.001 ? CG_N - 1.001 : fz;
      const i = fx | 0, j = fz | 0, tx = fx - i, tz = fz - j, k = j * CG_N + i;
      const a = arr[k] + (arr[k + 1] - arr[k]) * tx;
      const b = arr[k + CG_N] + (arr[k + CG_N + 1] - arr[k + CG_N]) * tx;
      return a + (b - a) * tz;
    };
  }
  const f = sweep(world, n, WG_X0, WG_STEP, dir, spread, incoming);
  const bias = 1.2;
  for (let k = 0; k < n * n; k++) {
    const h = world[k] + bias;
    const sh = f.hi[k], sl = f.lo[k];
    let v;
    if (h >= sl) v = 1;
    else if (h <= sh) v = 0;
    else v = (h - sh) / Math.max(0.01, sl - sh);
    out[k] = Math.round(v * 255);
  }
  return out;
}
