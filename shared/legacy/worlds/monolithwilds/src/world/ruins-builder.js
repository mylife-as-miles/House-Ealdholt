// RuinBuilder — a lean geometry accumulator for the ruins module.
//
// Why not core GeometryBuilder? The ruins are made of tens of thousands of tiny pieces (voussoirs,
// drums, rubble, broken courses). Cloning a BufferGeometry per piece is too slow for the 1.5 s
// budget, so this writes straight into growable typed arrays:
//   hexa(mat, corners)       any 8-corner block (wedges, voussoirs, tapered / sheared / jittered boxes)
//   box(mat, m, w, h, d, o)  a box with its base at local y=0 (optional taper / jitter)
//   geo(mat, geometry, m)    any BufferGeometry (read in place, never cloned)
// Pieces are bucketed by region chunk + material so the whole module stays at a few draw calls
// while far chunks can still be frustum culled.
//
// Vertex colour = tint * "rising damp": surfaces within a few metres of the current ground
// reference (setGround) are darkened and greened — the cheapest, most effective way to make stone
// look like it has sat in wet grass for a thousand years.

import * as THREE from 'crownfall-world-three';

class GrowF32 {
  constructor(n = 4096) {
    this.a = new Float32Array(n);
    this.n = 0;
  }
  reserve(k) {
    if (this.n + k <= this.a.length) return;
    let len = this.a.length * 2;
    while (len < this.n + k) len *= 2;
    const b = new Float32Array(len);
    b.set(this.a.subarray(0, this.n));
    this.a = b;
  }
}
class GrowU32 extends GrowF32 {
  constructor(n = 4096) {
    super(1);
    this.a = new Uint32Array(n);
  }
  reserve(k) {
    if (this.n + k <= this.a.length) return;
    let len = this.a.length * 2;
    while (len < this.n + k) len *= 2;
    const b = new Uint32Array(len);
    b.set(this.a.subarray(0, this.n));
    this.a = b;
  }
}

class Bucket {
  constructor(material, chunk) {
    this.material = material;
    this.chunk = chunk;
    this.pos = new GrowF32(1 << 15);
    this.nrm = new GrowF32(1 << 15);
    this.col = new GrowF32(1 << 15);
    this.idx = new GrowU32(1 << 14);
    this.verts = 0;
  }
}

// hexa corner order: bottom 0(-,-,-) 1(+,-,-) 2(+,-,+) 3(-,-,+), top 4(-,+,-) 5(+,+,-) 6(+,+,+) 7(-,+,+)
const FACES = [
  [0, 1, 2, 3], // -y
  [4, 7, 6, 5], // +y
  [0, 4, 5, 1], // -z
  [3, 2, 6, 7], // +z
  [0, 3, 7, 4], // -x
  [1, 5, 6, 2], // +x
];
const UNIT = [
  [-0.5, 0, -0.5], [0.5, 0, -0.5], [0.5, 0, 0.5], [-0.5, 0, 0.5],
  [-0.5, 1, -0.5], [0.5, 1, -0.5], [0.5, 1, 0.5], [-0.5, 1, 0.5],
];

const _n3 = new THREE.Matrix3();

function hash3(x, y, z, s) {
  let h = Math.imul((x * 73.13) | 0, 374761393) ^ Math.imul((y * 91.7) | 0, 668265263) ^ Math.imul((z * 57.3) | 0, 2147483647) ^ Math.imul(s | 0, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296 - 0.5;
}

export class RuinBuilder {
  /**
   * @param {object} opts
   *   chunkOf(x, z) -> string   region key for a world position
   */
  constructor({ chunkOf = () => 'all' } = {}) {
    this.chunkOf = chunkOf;
    this.buckets = new Map();
    this.ground = -1e9;
    this.dampHeight = 5;
    this.tint = [1, 1, 1];
    this.triangles = 0;
    /** Scatter density multiplier (rubble etc.); lowered on low quality. */
    this.detail = 1;
    this._c = new Float32Array(24);
  }

  /** Ground reference (y) for the rising-damp tint of subsequent pieces. */
  setGround(y, dampHeight = 5) {
    this.ground = y;
    this.dampHeight = dampHeight;
    return this;
  }

  /** Base tint: number (grey multiplier) or [r,g,b] or '#hex'. */
  setTint(t) {
    this.tint = parseTint(t);
    return this;
  }

  _bucket(material, x, z) {
    const chunk = this.chunkOf(x, z);
    let byChunk = this.buckets.get(material);
    if (!byChunk) this.buckets.set(material, (byChunk = new Map()));
    let b = byChunk.get(chunk);
    if (!b) byChunk.set(chunk, (b = new Bucket(material, chunk)));
    return b;
  }

  _color(out, o, y, tint) {
    const g = this.ground;
    const t = tint || this.tint;
    let r = t[0], gg = t[1], bb = t[2];
    const h = (y - g) / this.dampHeight;
    if (h < 1) {
      const s = h <= 0 ? 0 : h * h * (3 - 2 * h);
      // wet, dark, faintly green at the foot
      r *= 0.5 + 0.5 * s;
      gg *= 0.56 + 0.44 * s;
      bb *= 0.46 + 0.54 * s;
    }
    out[o] = r;
    out[o + 1] = gg;
    out[o + 2] = bb;
  }

  /**
   * Add an 8-corner block. `c` is a flat array of 24 numbers (world space) in hexa corner order.
   * `jit` (m) displaces every corner by a position hash (watertight crumble).
   */
  hexa(material, c, tint = null, jit = 0) {
    if (jit > 0) {
      for (let i = 0; i < 8; i++) {
        const x = c[i * 3], y = c[i * 3 + 1], z = c[i * 3 + 2];
        c[i * 3] = x + hash3(x, y, z, 1) * 2 * jit;
        c[i * 3 + 1] = y + hash3(x, y, z, 2) * 2 * jit;
        c[i * 3 + 2] = z + hash3(x, y, z, 3) * 2 * jit;
      }
    }
    const b = this._bucket(material, c[0], c[2]);
    const tt = tint ? parseTint(tint) : null;
    b.pos.reserve(72);
    b.nrm.reserve(72);
    b.col.reserve(72);
    b.idx.reserve(36);
    const P = b.pos.a, N = b.nrm.a, C = b.col.a, I = b.idx.a;
    for (let f = 0; f < 6; f++) {
      const q = FACES[f];
      const a = q[0] * 3, bq = q[1] * 3, cq = q[2] * 3, d = q[3] * 3;
      // normal from the diagonals: robust for slightly non-planar quads
      const ex = c[cq] - c[a], ey = c[cq + 1] - c[a + 1], ez = c[cq + 2] - c[a + 2];
      const fx = c[d] - c[bq], fy = c[d + 1] - c[bq + 1], fz = c[d + 2] - c[bq + 2];
      let nx = ey * fz - ez * fy;
      let ny = ez * fx - ex * fz;
      let nz = ex * fy - ey * fx;
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
      if (len < 1e-12) continue; // degenerate face (wedge)
      nx /= len; ny /= len; nz /= len;
      const base = b.verts;
      for (let k = 0; k < 4; k++) {
        const ci = q[k] * 3;
        const o = b.pos.n;
        P[o] = c[ci]; P[o + 1] = c[ci + 1]; P[o + 2] = c[ci + 2];
        N[o] = nx; N[o + 1] = ny; N[o + 2] = nz;
        this._color(C, o, c[ci + 1], tt);
        b.pos.n += 3; b.nrm.n += 3; b.col.n += 3;
      }
      b.verts += 4;
      const io = b.idx.n;
      I[io] = base; I[io + 1] = base + 1; I[io + 2] = base + 2;
      I[io + 3] = base; I[io + 4] = base + 2; I[io + 5] = base + 3;
      b.idx.n += 6;
      this.triangles += 2;
    }
    return this;
  }

  /**
   * Box with its base centred at local origin, spanning y in [0, h], transformed by matrix `m`.
   * opts: taper (top scale, number or [sx, sz]), shift ([dx, dz] top offset, local), jit (m).
   */
  box(material, m, w, h, d, opts = null, tint = null) {
    let tx = 1, tz = 1, sx = 0, sz = 0, jit = 0;
    if (opts) {
      if (opts.taper !== undefined) {
        if (Array.isArray(opts.taper)) { tx = opts.taper[0]; tz = opts.taper[1]; } else { tx = tz = opts.taper; }
      }
      if (opts.shift) { sx = opts.shift[0]; sz = opts.shift[1]; }
      jit = opts.jit || 0;
    }
    const c = this._c;
    const e = m.elements;
    for (let i = 0; i < 8; i++) {
      const u = UNIT[i];
      const top = u[1] > 0;
      const lx = u[0] * w * (top ? tx : 1) + (top ? sx : 0);
      const ly = u[1] * h;
      const lz = u[2] * d * (top ? tz : 1) + (top ? sz : 0);
      c[i * 3] = e[0] * lx + e[4] * ly + e[8] * lz + e[12];
      c[i * 3 + 1] = e[1] * lx + e[5] * ly + e[9] * lz + e[13];
      c[i * 3 + 2] = e[2] * lx + e[6] * ly + e[10] * lz + e[14];
    }
    return this.hexa(material, c, tint, jit);
  }

  /**
   * Add an arbitrary BufferGeometry transformed by `m`. The geometry is read, not modified.
   * Missing normals are computed on the source once (cached flag).
   */
  geo(material, geometry, m, tint = null) {
    if (!geometry.attributes.normal) geometry.computeVertexNormals();
    const pa = geometry.attributes.position;
    const na = geometry.attributes.normal;
    const count = pa.count;
    const e = m.elements;
    // chunk by the transformed origin
    const b = this._bucket(material, e[12], e[14]);
    const tt = tint ? parseTint(tint) : null;
    _n3.getNormalMatrix(m);
    const ne = _n3.elements;
    b.pos.reserve(count * 3);
    b.nrm.reserve(count * 3);
    b.col.reserve(count * 3);
    const P = b.pos.a, N = b.nrm.a, C = b.col.a;
    const base = b.verts;
    const pArr = pa.array, nArr = na.array;
    const pStride = pa.isInterleavedBufferAttribute ? pa.data.stride : 3;
    const pOff = pa.isInterleavedBufferAttribute ? pa.offset : 0;
    for (let i = 0; i < count; i++) {
      const pi = i * pStride + pOff;
      const x = pArr[pi], y = pArr[pi + 1], z = pArr[pi + 2];
      const o = b.pos.n;
      const wx = e[0] * x + e[4] * y + e[8] * z + e[12];
      const wy = e[1] * x + e[5] * y + e[9] * z + e[13];
      const wz = e[2] * x + e[6] * y + e[10] * z + e[14];
      P[o] = wx; P[o + 1] = wy; P[o + 2] = wz;
      const nx = nArr[i * 3], ny = nArr[i * 3 + 1], nz = nArr[i * 3 + 2];
      let mx = ne[0] * nx + ne[3] * ny + ne[6] * nz;
      let my = ne[1] * nx + ne[4] * ny + ne[7] * nz;
      let mz = ne[2] * nx + ne[5] * ny + ne[8] * nz;
      const l = Math.sqrt(mx * mx + my * my + mz * mz) || 1;
      N[o] = mx / l; N[o + 1] = my / l; N[o + 2] = mz / l;
      this._color(C, o, wy, tt);
      b.pos.n += 3; b.nrm.n += 3; b.col.n += 3;
    }
    b.verts += count;
    const index = geometry.index;
    // negative determinant (mirroring) flips winding
    const flip = m.determinant() < 0;
    if (index) {
      const ia = index.array;
      b.idx.reserve(ia.length);
      const I = b.idx.a;
      for (let i = 0; i < ia.length; i += 3) {
        const o = b.idx.n;
        I[o] = base + ia[i];
        I[o + 1] = base + (flip ? ia[i + 2] : ia[i + 1]);
        I[o + 2] = base + (flip ? ia[i + 1] : ia[i + 2]);
        b.idx.n += 3;
      }
      this.triangles += ia.length / 3;
    } else {
      b.idx.reserve(count);
      const I = b.idx.a;
      for (let i = 0; i < count; i += 3) {
        const o = b.idx.n;
        I[o] = base + i;
        I[o + 1] = base + (flip ? i + 2 : i + 1);
        I[o + 2] = base + (flip ? i + 1 : i + 2);
        b.idx.n += 3;
      }
      this.triangles += count / 3;
    }
    return this;
  }

  /** Merge into meshes (one per chunk x material). Returns a Group. */
  build({ name = 'ruins', castShadow = true, receiveShadow = true, minTris = 4000 } = {}) {
    const group = new THREE.Group();
    group.name = name;
    const all = [];
    for (const byChunk of this.buckets.values()) {
      // fold tiny chunk buckets into the biggest bucket of the same material: a draw call is
      // worth more than the culling of a few hundred triangles
      const list = [...byChunk.values()].sort((a, c) => c.verts - a.verts);
      const host = list[0];
      for (let i = 1; i < list.length; i++) {
        const bk = list[i];
        if (bk.idx.n / 3 >= minTris) continue;
        appendBucket(host, bk);
        bk.verts = 0;
      }
      for (const bk of list) if (bk.verts) all.push(bk);
    }
    all.sort((a, c) => (a.chunk < c.chunk ? -1 : a.chunk > c.chunk ? 1 : 0));
    for (const b of all) {
      if (!b.verts) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(b.pos.a.slice(0, b.pos.n), 3));
      g.setAttribute('normal', new THREE.BufferAttribute(b.nrm.a.slice(0, b.nrm.n), 3));
      g.setAttribute('color', new THREE.BufferAttribute(b.col.a.slice(0, b.col.n), 3));
      const idx = b.verts > 65535 ? b.idx.a.slice(0, b.idx.n) : Uint16Array.from(b.idx.a.subarray(0, b.idx.n));
      g.setIndex(new THREE.BufferAttribute(idx, 1));
      g.computeBoundingSphere();
      g.computeBoundingBox();
      const mesh = new THREE.Mesh(g, b.material);
      mesh.name = `${name}:${b.chunk}:${b.material.userData?.preset ?? b.material.type}`;
      mesh.castShadow = castShadow;
      mesh.receiveShadow = receiveShadow;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      group.add(mesh);
    }
    this.buckets.clear();
    return group;
  }
}

function appendBucket(dst, src) {
  const base = dst.verts;
  const nv = src.pos.n;
  dst.pos.reserve(nv);
  dst.nrm.reserve(nv);
  dst.col.reserve(nv);
  dst.pos.a.set(src.pos.a.subarray(0, nv), dst.pos.n);
  dst.nrm.a.set(src.nrm.a.subarray(0, nv), dst.nrm.n);
  dst.col.a.set(src.col.a.subarray(0, nv), dst.col.n);
  dst.pos.n += nv;
  dst.nrm.n += nv;
  dst.col.n += nv;
  const ni = src.idx.n;
  dst.idx.reserve(ni);
  const I = dst.idx.a;
  const S = src.idx.a;
  for (let i = 0; i < ni; i++) I[dst.idx.n + i] = S[i] + base;
  dst.idx.n += ni;
  dst.verts += src.verts;
}

const _tc = new THREE.Color();
export function parseTint(t) {
  if (t == null) return [1, 1, 1];
  if (Array.isArray(t)) return t;
  if (typeof t === 'number' && t <= 4) return [t, t, t];
  _tc.set(t);
  return [_tc.r, _tc.g, _tc.b];
}
