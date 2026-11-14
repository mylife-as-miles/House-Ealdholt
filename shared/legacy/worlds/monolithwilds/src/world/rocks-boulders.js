// Instanced boulders with camera-driven LOD.
//
// Every loose rock in the world (meadow boulders, scree, debris at the foot of formations) is an
// instance of one of a few rock recipes. Instances are bucketed into spatial cells; when the camera
// has moved a few metres, each cell in range re-sorts its rocks into three tessellation levels
// (720 / 180 / 80 triangles) by distance relative to rock size, and culls rocks that would be a
// couple of pixels. One InstancedMesh per (recipe, level) keeps the draw calls fixed.

import * as THREE from 'crownfall-world-three';
import { rockShape, rockGeometry } from './rocks-geo.js';

const CELL = 256;

export class BoulderField {
  /**
   * @param {object} opts
   *   kinds: [{ name, kind, seed }]  rock recipes
   *   material: THREE.Material
   *   quality: ctx.quality
   */
  constructor({ kinds, material, quality }) {
    this.kinds = kinds.map((k, i) => ({ ...k, index: i, shape: rockShape(k.seed, k.kind) }));
    this.material = material;
    this.quality = quality;
    // growable per-instance storage
    this.cap = 4096;
    this.n = 0;
    this.mats = new Float32Array(this.cap * 16);
    this.cols = new Float32Array(this.cap * 3);
    this.pos = new Float32Array(this.cap * 4); // x, y, z, radius
    this.kind = new Uint8Array(this.cap);
    this.lastCam = new THREE.Vector3(1e9, 0, 0);
    this.stats = { lod: [0, 0, 0] };
    const lvl = quality.level;
    // distance multipliers (x radius) for LOD0 / LOD1 / cull
    this.k0 = lvl === 'high' ? 18 : lvl === 'medium' ? 14 : 9;
    this.k1 = lvl === 'high' ? 90 : lvl === 'medium' ? 70 : 45;
    this.kc = lvl === 'high' ? 480 : lvl === 'medium' ? 400 : 260;
  }

  _grow() {
    const c = this.cap * 2;
    const m = new Float32Array(c * 16);
    m.set(this.mats);
    this.mats = m;
    const cl = new Float32Array(c * 3);
    cl.set(this.cols);
    this.cols = cl;
    const p = new Float32Array(c * 4);
    p.set(this.pos);
    this.pos = p;
    const k = new Uint8Array(c);
    k.set(this.kind);
    this.kind = k;
    this.cap = c;
  }

  /** Add an instance from a composed matrix. radius = bounding radius in metres. */
  add(kindIndex, matrix, radius, r = 1, g = 1, b = 1) {
    if (this.n >= this.cap) this._grow();
    const i = this.n++;
    this.mats.set(matrix.elements, i * 16);
    this.cols[i * 3] = r;
    this.cols[i * 3 + 1] = g;
    this.cols[i * 3 + 2] = b;
    const e = matrix.elements;
    this.pos[i * 4] = e[12];
    this.pos[i * 4 + 1] = e[13];
    this.pos[i * 4 + 2] = e[14];
    this.pos[i * 4 + 3] = radius;
    this.kind[i] = kindIndex;
    return i;
  }

  /** Build geometries (call before placing, so minY is known). */
  prepare() {
    for (const k of this.kinds) {
      k.geos = [rockGeometry(k.shape, 5), rockGeometry(k.shape, 2), rockGeometry(k.shape, 1)];
      k.minY = k.geos[0].boundingBox.min.y;
      k.maxY = k.geos[0].boundingBox.max.y;
      k.tris = k.geos.map((g) => g.index.count / 3);
    }
  }

  /** Sort instances into cells, create the InstancedMeshes, add them to `parent`. */
  finalize(parent) {
    const n = this.n;
    // --- spatial cells (sorted index list) ---
    const cellKey = new Int32Array(n);
    const order = new Uint32Array(n);
    for (let i = 0; i < n; i++) {
      const cx = Math.floor(this.pos[i * 4] / CELL);
      const cz = Math.floor(this.pos[i * 4 + 2] / CELL);
      cellKey[i] = (cx + 64) * 256 + (cz + 64);
      order[i] = i;
    }
    order.sort((a, b) => cellKey[a] - cellKey[b]);
    this.order = order;
    const cells = [];
    for (let s = 0; s < n; ) {
      const key = cellKey[order[s]];
      let e = s;
      let maxR = 0;
      while (e < n && cellKey[order[e]] === key) {
        maxR = Math.max(maxR, this.pos[order[e] * 4 + 3]);
        e++;
      }
      const cx = Math.floor(key / 256) - 64;
      const cz = (key % 256) - 64;
      cells.push({ start: s, end: e, maxR, x: (cx + 0.5) * CELL, z: (cz + 0.5) * CELL });
      s = e;
    }
    this.cells = cells;

    // --- meshes: per kind, per level ---
    const counts = this.kinds.map(() => 0);
    for (let i = 0; i < n; i++) counts[this.kind[i]]++;
    this.meshes = [];
    const group = new THREE.Group();
    group.name = 'rocks:boulders';
    for (const k of this.kinds) {
      const total = Math.max(1, counts[k.index]);
      const caps = [Math.min(total, 3000), Math.min(total, 9000), total];
      k.meshes = [];
      for (let l = 0; l < 3; l++) {
        const mesh = new THREE.InstancedMesh(k.geos[l], this.material, caps[l]);
        mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(caps[l] * 3).fill(1), 3);
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
        mesh.count = 0;
        mesh.castShadow = l < 2;
        mesh.receiveShadow = true;
        mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1);
        mesh.name = `rocks:${k.name}:lod${l}`;
        mesh.userData.cap = caps[l];
        mesh.matrixAutoUpdate = false;
        k.meshes.push(mesh);
        this.meshes.push(mesh);
        group.add(mesh);
      }
    }
    parent.add(group);
    this.group = group;
    // scratch for per-mesh bounds
    this._bounds = this.meshes.map(() => new Float32Array(6));
    return group;
  }

  /** Re-bucket instances by distance to the camera. Cheap enough to run every few frames. */
  update(camPos, force = false) {
    const dx0 = camPos.x - this.lastCam.x;
    const dy0 = camPos.y - this.lastCam.y;
    const dz0 = camPos.z - this.lastCam.z;
    if (!force && dx0 * dx0 + dy0 * dy0 + dz0 * dz0 < 64) return false;
    this.lastCam.copy(camPos);
    const cx = camPos.x, cy = camPos.y, cz = camPos.z;
    const P = this.pos, M = this.mats, C = this.cols, K = this.kind;
    const k0 = this.k0, k1 = this.k1, kc = this.kc;
    const meshes = this.meshes;
    const nm = meshes.length;
    for (let m = 0; m < nm; m++) {
      meshes[m].count = 0;
      const b = this._bounds[m];
      b[0] = b[1] = b[2] = Infinity;
      b[3] = b[4] = b[5] = -Infinity;
    }
    const halfDiag = CELL * 0.7072;
    const order = this.order;
    for (const cell of this.cells) {
      const ddx = cell.x - cx, ddz = cell.z - cz;
      const cd = Math.sqrt(ddx * ddx + ddz * ddz) - halfDiag;
      if (cd > cell.maxR * kc) continue;
      for (let s = cell.start; s < cell.end; s++) {
        const i = order[s];
        const x = P[i * 4], y = P[i * 4 + 1], z = P[i * 4 + 2], r = P[i * 4 + 3];
        const ex = x - cx, ey = y - cy, ez = z - cz;
        const d = Math.sqrt(ex * ex + ey * ey + ez * ez);
        if (d > r * kc) continue;
        let lvl = d < r * k0 + 20 ? 0 : d < r * k1 + 35 ? 1 : 2;
        const kind = K[i];
        let mi = kind * 3 + lvl;
        let mesh = meshes[mi];
        while (mesh.count >= mesh.userData.cap && lvl < 2) {
          lvl++;
          mi++;
          mesh = meshes[mi];
        }
        if (mesh.count >= mesh.userData.cap) continue;
        const o = mesh.count++;
        const dst = mesh.instanceMatrix.array;
        const so = i * 16, dO = o * 16;
        for (let q = 0; q < 16; q++) dst[dO + q] = M[so + q];
        const dc = mesh.instanceColor.array;
        dc[o * 3] = C[i * 3];
        dc[o * 3 + 1] = C[i * 3 + 1];
        dc[o * 3 + 2] = C[i * 3 + 2];
        const b = this._bounds[mi];
        if (x - r < b[0]) b[0] = x - r;
        if (y - r < b[1]) b[1] = y - r;
        if (z - r < b[2]) b[2] = z - r;
        if (x + r > b[3]) b[3] = x + r;
        if (y + r > b[4]) b[4] = y + r;
        if (z + r > b[5]) b[5] = z + r;
      }
    }
    const lod = this.stats.lod;
    lod[0] = lod[1] = lod[2] = 0;
    for (let m = 0; m < nm; m++) {
      const mesh = meshes[m];
      const c = mesh.count;
      lod[m % 3] += c;
      mesh.visible = c > 0;
      if (!c) continue;
      const b = this._bounds[m];
      const bs = mesh.boundingSphere;
      bs.center.set((b[0] + b[3]) * 0.5, (b[1] + b[4]) * 0.5, (b[2] + b[5]) * 0.5);
      bs.radius = 0.5 * Math.hypot(b[3] - b[0], b[4] - b[1], b[5] - b[2]);
      const im = mesh.instanceMatrix;
      im.clearUpdateRanges();
      im.addUpdateRange(0, c * 16);
      im.needsUpdate = true;
      const ic = mesh.instanceColor;
      ic.clearUpdateRanges();
      ic.addUpdateRange(0, c * 3);
      ic.needsUpdate = true;
    }
    return true;
  }

  /** Triangles currently submitted (for stats). */
  triangles() {
    let t = 0;
    for (const k of this.kinds) for (let l = 0; l < 3; l++) t += k.meshes[l].count * k.tris[l];
    return t;
  }
}
