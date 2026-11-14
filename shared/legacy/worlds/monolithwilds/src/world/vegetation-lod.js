// Instance storage, LOD selection and culling for the vegetation.
//
// Every plant is 8 floats (see vegetation-material.js): x, y, z, scale, yaw, seed, tier + rank,
// form code + colour.
//
// Static plants (trees, shrubs, reeds) live in a CellField: a 128 m grid over the world where each
// species' instances are sorted by cell and shuffled inside it (so a prefix of a cell is a random
// subset: that is how far-away forests are thinned — see `rank`). When the camera has moved or
// turned enough, the field walks the cells from the camera outward (spiral order, so buffers are
// filled near-to-far and the GPU's early-z rejects hidden trees), culls them against a slightly
// widened view frustum, picks a LOD per cell (or per instance for cells straddling a LOD boundary)
// and copies the surviving instance ranges into one dynamic instance buffer per (species, LOD).
// Draw calls stay fixed (one per species x LOD), whatever the forest size.
//
// Exact ground heights: instances start on the terrain's 9 m height grid (bilinear); cells that come
// within ~350 m get their heights replaced by exact heightAt() values, a few cells per frame.

import * as THREE from 'crownfall-world-three';

export const STRIDE = 8;

/** One draw: a species' LOD geometry + a dynamic instance buffer. */
export class InstBuf {
  constructor(geo, material, depth, capacity, { castShadow = false, receiveShadow = true, name = 'veg' } = {}) {
    this.cap = Math.max(16, capacity | 0);
    this.arr = new Float32Array(this.cap * STRIDE);
    this.ib = new THREE.InstancedInterleavedBuffer(this.arr, STRIDE, 1);
    this.ib.setUsage(THREE.DynamicDrawUsage);
    const g = new THREE.InstancedBufferGeometry();
    g.index = geo.index;
    for (const k of Object.keys(geo.attributes)) g.setAttribute(k, geo.attributes[k]);
    g.setAttribute('aInstA', new THREE.InterleavedBufferAttribute(this.ib, 4, 0));
    g.setAttribute('aInstB', new THREE.InterleavedBufferAttribute(this.ib, 4, 4));
    g.instanceCount = 0;
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    g.boundingBox = new THREE.Box3(new THREE.Vector3(-1e6, -1e6, -1e6), new THREE.Vector3(1e6, 1e6, 1e6));
    this.geo = g;
    const mesh = new THREE.Mesh(g, material);
    mesh.name = name;
    mesh.customDepthMaterial = depth;
    mesh.frustumCulled = false;
    mesh.castShadow = castShadow;
    mesh.receiveShadow = receiveShadow;
    mesh.matrixAutoUpdate = false;
    mesh.visible = false;
    this.mesh = mesh;
    this.tris = geo.index.count / 3;
    this.n = 0;
    this.overflow = 0;
    this.peak = 0;
  }

  begin() {
    this.n = 0;
    this.overflow = 0;
  }

  pushRange(src, start, count) {
    let c = count;
    if (this.n + c > this.cap) {
      this.overflow += this.n + c - this.cap;
      c = this.cap - this.n;
    }
    if (c <= 0) return;
    const a = this.arr;
    if (c > 48) {
      a.set(src.subarray(start * STRIDE, (start + c) * STRIDE), this.n * STRIDE);
    } else {
      let o = this.n * STRIDE;
      const e = (start + c) * STRIDE;
      for (let k = start * STRIDE; k < e; k++) a[o++] = src[k];
    }
    this.n += c;
  }

  push1(src, i) {
    if (this.n >= this.cap) {
      this.overflow++;
      return;
    }
    const a = this.arr;
    let o = this.n * STRIDE;
    const s = i * STRIDE;
    for (let k = 0; k < STRIDE; k++) a[o++] = src[s + k];
    this.n++;
  }

  end() {
    const g = this.geo;
    g.instanceCount = this.n;
    this.ib.clearUpdateRanges();
    if (this.n > 0) {
      this.ib.addUpdateRange(0, this.n * STRIDE);
      this.ib.needsUpdate = true;
    }
    this.mesh.visible = this.n > 0;
    if (this.n > this.peak) this.peak = this.n;
  }
}

/** Growable float store for placement (stride 8). */
export class InstList {
  constructor(cap = 4096) {
    this.a = new Float32Array(cap * STRIDE);
    this.n = 0;
  }

  push(x, y, z, s, yaw, seed, rank, c) {
    if ((this.n + 1) * STRIDE > this.a.length) {
      const b = new Float32Array(this.a.length * 2);
      b.set(this.a);
      this.a = b;
    }
    const o = this.n * STRIDE;
    const a = this.a;
    a[o] = x;
    a[o + 1] = y;
    a[o + 2] = z;
    a[o + 3] = s;
    a[o + 4] = yaw;
    a[o + 5] = seed;
    a[o + 6] = rank;
    // colour param: fraction = colour ramp 0..1, integer part = form code (crown lift) — keep the
    // fraction below 1 so float rounding never bumps the code
    const code = Math.floor(c);
    a[o + 7] = code + Math.min(0.995, c - code);
    return this.n++;
  }
}

const _sphere = new THREE.Sphere();
const _m = new THREE.Matrix4();
const _padCam = new THREE.PerspectiveCamera();

/** Frustum of `camera` widened by `padDeg` on every side (so small turns need no refresh). */
export function paddedFrustum(camera, padDeg, far, frustum) {
  const tv = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const th = tv * camera.aspect;
  const p = THREE.MathUtils.degToRad(padDeg);
  const tv2 = Math.tan(Math.min(1.45, Math.atan(tv) + p));
  const th2 = Math.tan(Math.min(1.45, Math.atan(th) + p));
  _padCam.fov = THREE.MathUtils.radToDeg(2 * Math.atan(tv2));
  _padCam.aspect = th2 / tv2;
  _padCam.near = 1;
  _padCam.far = far;
  _padCam.updateProjectionMatrix();
  _m.multiplyMatrices(_padCam.projectionMatrix, camera.matrixWorldInverse);
  frustum.setFromProjectionMatrix(_m);
  return frustum;
}

const smooth = (a, b, x) => {
  let t = (x - a) / (b - a);
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return t * t * (3 - 2 * t);
};

/**
 * A static species: instances + LOD buffers.
 *   lods: [{ buf: InstBuf, max: distance }]  (last LOD's max is ignored: it runs to `cull`)
 *   thin: [start, end, keep]  (same numbers as the material's uVegDist)
 */
export class StaticKind {
  constructor({ name, lods, cull, thin = null, sink = 0.3, H = 10, refine = true }) {
    this.name = name;
    this.lods = lods;
    this.cull = cull;
    this.thin = thin;
    this.sink = sink;
    this.H = H;
    this.refine = refine;
    this.list = new InstList();
    this.data = null;
    this.start = null;
    this.count = 0;
  }

  keep(d) {
    if (!this.thin) return 1;
    return 1 + (this.thin[2] - 1) * smooth(this.thin[0], this.thin[1], d);
  }

  /** Beyond this, LOD is chosen per cell instead of per instance. */
  get fineLod() {
    const L = this.lods;
    return L.length > 2 ? L[1].max : L[0].max;
  }

  lodOf(d) {
    const L = this.lods;
    for (let i = 0; i < L.length - 1; i++) if (d < L[i].max) return i;
    return L.length - 1;
  }
}

export class CellField {
  constructor({ half = 4608, cell = 128, rng }) {
    this.C = cell;
    this.nc = Math.ceil((2 * half) / cell);
    this.x0 = -half;
    const n = this.nc * this.nc;
    this.y0 = new Float32Array(n).fill(1e9);
    this.y1 = new Float32Array(n).fill(-1e9);
    this.any = new Uint8Array(n);
    this.refined = new Uint8Array(n);
    this.kinds = [];
    this.rng = rng;
    this.frustum = new THREE.Frustum();
    this.lastPos = new THREE.Vector3(1e9, 0, 0);
    this.lastDir = new THREE.Vector3();
    this.lastAspect = 0;
    this.lastFov = 0;
    this.dirty = true;
    this.queue = [];
    this.queued = new Uint8Array(n);
    this.stats = { refreshes: 0, lastMs: 0, cells: 0 };
    this._dir = new THREE.Vector3();
    this.maxCull = 0;
  }

  addKind(kind) {
    this.kinds.push(kind);
    this.maxCull = Math.max(this.maxCull, kind.cull);
    return kind;
  }

  cellOf(x, z) {
    let i = Math.floor((x - this.x0) / this.C);
    let j = Math.floor((z - this.x0) / this.C);
    i = i < 0 ? 0 : i >= this.nc ? this.nc - 1 : i;
    j = j < 0 ? 0 : j >= this.nc ? this.nc - 1 : j;
    return j * this.nc + i;
  }

  /** Sort every kind's instances by cell, shuffle inside cells, assign ranks, compute cell bounds. */
  finalize() {
    const nCells = this.nc * this.nc;
    for (const k of this.kinds) {
      const src = k.list.a;
      const n = k.list.n;
      const cellIdx = new Int32Array(n);
      const cnt = new Int32Array(nCells + 1);
      for (let i = 0; i < n; i++) {
        const c = this.cellOf(src[i * STRIDE], src[i * STRIDE + 2]);
        cellIdx[i] = c;
        cnt[c + 1]++;
      }
      for (let c = 0; c < nCells; c++) cnt[c + 1] += cnt[c];
      const start = cnt.slice();
      const fill = cnt.slice(0, nCells);
      const data = new Float32Array(n * STRIDE);
      for (let i = 0; i < n; i++) {
        const o = fill[cellIdx[i]]++;
        data.set(src.subarray(i * STRIDE, i * STRIDE + STRIDE), o * STRIDE);
      }
      // shuffle within each cell (deterministic), then rank = position / count
      const tmp = new Float32Array(STRIDE);
      for (let c = 0; c < nCells; c++) {
        const s = start[c], e = start[c + 1], m = e - s;
        if (m === 0) continue;
        for (let i = m - 1; i > 0; i--) {
          const j = Math.floor(this.rng() * (i + 1));
          if (j === i) continue;
          const a = (s + i) * STRIDE, b = (s + j) * STRIDE;
          tmp.set(data.subarray(a, a + STRIDE));
          data.copyWithin(a, b, b + STRIDE);
          data.set(tmp, b);
        }
        for (let i = 0; i < m; i++) {
          const o = (s + i) * STRIDE;
          const tier = Math.floor(data[o + 6]);
          data[o + 6] = tier + Math.min(0.999, (i + 0.5) / m);
          const y = data[o + 1];
          const top = y + k.H * data[o + 3] * 1.25;
          if (y - 3 < this.y0[c]) this.y0[c] = y - 3;
          if (top > this.y1[c]) this.y1[c] = top;
          this.any[c] = 1;
        }
      }
      k.data = data;
      k.start = start;
      k.count = n;
      k.list = null;
    }
    // spiral order of cell offsets (nearest first)
    const R = Math.ceil(this.maxCull / this.C) + 1;
    const offs = [];
    for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++) if (dx * dx + dz * dz <= (R + 1) * (R + 1)) offs.push([dx, dz, dx * dx + dz * dz]);
    offs.sort((a, b) => a[2] - b[2]);
    this.spiral = new Int16Array(offs.length * 2);
    offs.forEach((o, i) => {
      this.spiral[i * 2] = o[0];
      this.spiral[i * 2 + 1] = o[1];
    });
  }

  /** Exact ground heights for one cell's instances. */
  refineCell(c, heightAt) {
    if (this.refined[c]) return;
    this.refined[c] = 1;
    for (const k of this.kinds) {
      if (!k.refine) continue;
      const d = k.data;
      for (let i = k.start[c], e = k.start[c + 1]; i < e; i++) {
        const o = i * STRIDE;
        d[o + 1] = heightAt(d[o], d[o + 2]) - k.sink * d[o + 3];
      }
    }
  }

  /** Should the buffers be rebuilt for this camera? */
  needsRefresh(camera, moveThresh = 8, turnCos = 0.9925) {
    if (this.dirty) return true;
    const p = camera.position;
    camera.getWorldDirection(this._dir);
    if (p.distanceToSquared(this.lastPos) > moveThresh * moveThresh) return true;
    if (this._dir.dot(this.lastDir) < turnCos) return true;
    if (camera.aspect !== this.lastAspect || camera.fov !== this.lastFov) return true;
    return false;
  }

  /**
   * Rebuild all instance buffers for this camera.
   *   opts.refineDist  cells nearer than this get exact heights (queued, or immediately if `sync`)
   */
  refresh(camera, { heightAt, refineDist = 350, sync = false, padDeg = 12, nearAlways = 24 }) {
    const t0 = performance.now();
    const p = camera.position;
    this.lastPos.copy(p);
    camera.getWorldDirection(this.lastDir);
    this.lastAspect = camera.aspect;
    this.lastFov = camera.fov;
    this.dirty = false;
    const fr = paddedFrustum(camera, padDeg, this.maxCull + 400, this.frustum);
    for (const k of this.kinds) for (const L of k.lods) L.buf.begin();

    const C = this.C, nc = this.nc, x0 = this.x0, hc = C / 2;
    const ci0 = Math.floor((p.x - x0) / C), cj0 = Math.floor((p.z - x0) / C);
    const px = p.x, py = p.y, pz = p.z;
    const sp = this.spiral;
    const maxCull = this.maxCull;
    let cells = 0;
    for (let s = 0; s < sp.length; s += 2) {
      const ci = ci0 + sp[s], cj = cj0 + sp[s + 1];
      if (ci < 0 || cj < 0 || ci >= nc || cj >= nc) continue;
      const c = cj * nc + ci;
      if (!this.any[c]) continue;
      const cx = x0 + (ci + 0.5) * C, cz = x0 + (cj + 0.5) * C;
      const y0 = this.y0[c], y1 = this.y1[c];
      const ax = Math.abs(cx - px), az = Math.abs(cz - pz);
      const dx = Math.max(0, ax - hc), dz = Math.max(0, az - hc);
      const dy = py < y0 ? y0 - py : py > y1 ? py - y1 : 0;
      const dmin = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (dmin > maxCull) {
        if (Math.sqrt(sp[s] * sp[s] + sp[s + 1] * sp[s + 1]) * C - C * 1.5 > maxCull) break;
        continue;
      }
      if (dmin > nearAlways) {
        _sphere.center.set(cx, (y0 + y1) * 0.5, cz);
        const hy = (y1 - y0) * 0.5;
        _sphere.radius = Math.sqrt(2 * hc * hc + hy * hy) + (dmin < 900 ? 60 : 0);
        if (!fr.intersectsSphere(_sphere)) continue;
      }
      if (dmin < refineDist && !this.refined[c]) {
        if (sync) this.refineCell(c, heightAt);
        else if (!this.queued[c]) {
          this.queued[c] = 1;
          this.queue.push(c);
        }
      }
      const ey = Math.max(Math.abs(py - y0), Math.abs(py - y1));
      const dmax = Math.sqrt((ax + hc) * (ax + hc) + (az + hc) * (az + hc) + ey * ey);
      cells++;
      for (let ki = 0; ki < this.kinds.length; ki++) {
        const k = this.kinds[ki];
        const s0 = k.start[c], e0 = k.start[c + 1];
        if (s0 === e0 || dmin > k.cull) continue;
        const keepMax = Math.min(1, k.keep(Math.max(0, dmin - 12)) + 0.03);
        const take = Math.min(e0 - s0, Math.ceil((e0 - s0) * keepMax));
        const la = k.lodOf(dmin), lb = k.lodOf(dmax);
        if (la === lb) {
          k.lods[la].buf.pushRange(k.data, s0, take);
        } else if (dmin > k.fineLod) {
          // far cells straddling a band limit: whole cell by its centre distance (the shader
          // thins / fades per instance anyway)
          const dc = Math.sqrt(ax * ax + az * az + (py - (y0 + y1) * 0.5) ** 2);
          k.lods[k.lodOf(dc)].buf.pushRange(k.data, s0, take);
        } else {
          const d = k.data;
          for (let i = s0; i < s0 + take; i++) {
            const o = i * STRIDE;
            const ex = d[o] - px, ey2 = d[o + 1] - py, ez = d[o + 2] - pz;
            const dist = Math.sqrt(ex * ex + ey2 * ey2 + ez * ez);
            if (dist > k.cull) continue;
            const r = d[o + 6] % 1;
            if (r > k.keep(Math.max(0, dist - 12)) + 0.03) continue;
            k.lods[k.lodOf(dist)].buf.push1(d, i);
          }
        }
      }
    }
    for (const k of this.kinds) for (const L of k.lods) L.buf.end();
    this.stats.refreshes++;
    this.stats.cells = cells;
    this.stats.lastMs = performance.now() - t0;
  }

  /** Refine queued cells within a time budget (ms). Returns true if anything changed. */
  work(heightAt, budgetMs) {
    if (!this.queue.length) return false;
    const t0 = performance.now();
    let changed = false;
    while (this.queue.length && performance.now() - t0 < budgetMs) {
      const c = this.queue.shift();
      this.queued[c] = 0;
      if (!this.refined[c]) {
        this.refineCell(c, heightAt);
        changed = true;
      }
    }
    if (changed) this.dirty = true;
    return changed;
  }
}
