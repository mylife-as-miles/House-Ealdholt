// Chunked quadtree LOD with CDLOD-style geomorphing, drawn through two BatchedMeshes.
//
// Every node is a 64x64-cell chunk; a node splits when the camera is closer than K x its size.
// Selection is view-independent (turning the camera never needs new data); BatchedMesh culls
// chunks per instance against the view (and the shadow camera) and multi-draws the rest, so the
// whole terrain costs ~2 draw calls (+2 in the shadow pass) instead of one per chunk.
// Vertices morph toward the parent level's surface as they approach the distance at which the
// parent takes over, so LOD changes never pop; skirts cover any transient crack (e.g. while a finer
// chunk is still being computed). Heights come from worker jobs; the main thread only copies the
// returned arrays into a batch slot (~0.1 ms per chunk, a few per frame).

import * as THREE from 'crownfall-world-three';
import { MAX_LEVEL, ROOT_HALF, CHUNK_VERTS, levelSize, buildChunkIndex, WG_N, WG_X0, WG_STEP, CELLS } from './terrain-jobs.js';
import { yieldToMain as yieldMain } from '../core/yield.js';

const MORPH_START = 0.7; // fraction of the handover distance where morphing begins
const MIN_LEVEL = 3; // coarsest drawn level (4.6 km chunks, 72 m cells)

class Node {
  constructor(L, ix, iz, parent) {
    this.L = L;
    this.ix = ix;
    this.iz = iz;
    this.key = `${L}:${ix}:${iz}`;
    this.size = levelSize(L);
    this.x0 = ix * this.size - ROOT_HALF;
    this.z0 = iz * this.size - ROOT_HALF;
    this.parent = parent;
    this.children = null;
    this.minY = parent ? parent.minY : -60;
    this.maxY = parent ? parent.maxY : 2600;
    this.state = 0; // 0 idle, 1 requested, 2 ready
    this.slot = null;
    this.batch = null;
    this.visible = false;
    this.shown = -1;
    this.used = 0;
    this.prio = 0;
  }
}

/** A BatchedMesh with fixed-size chunk slots (every chunk has identical vertex/index counts). */
class ChunkBatch {
  constructor(name, material, depthMaterial, capacity, castShadow, indexCount) {
    this.indexCount = indexCount;
    this.capacity = capacity;
    const mesh = new THREE.BatchedMesh(capacity, capacity * CHUNK_VERTS, capacity * indexCount, material);
    mesh.name = name;
    mesh.customDepthMaterial = depthMaterial;
    mesh.castShadow = castShadow;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false; // per-instance culling instead
    mesh.perObjectFrustumCulled = true;
    mesh.sortObjects = true; // front-to-back: cheap early-z rejection of hidden ground
    mesh.matrixAutoUpdate = false;
    this.mesh = mesh;
    this.slots = [];
    this.free = [];
    this.owner = new Map(); // slot -> node
  }

  get used() {
    return this.slots.length - this.free.length;
  }

  /** Copy a chunk geometry into a slot; returns the slot or null when full. */
  alloc(geometry) {
    const mesh = this.mesh;
    let slot;
    if (this.free.length) {
      slot = this.free.pop();
      mesh.setGeometryAt(slot.geo, geometry);
    } else if (this.slots.length < this.capacity) {
      const geo = mesh.addGeometry(geometry, CHUNK_VERTS, this.indexCount);
      const inst = mesh.addInstance(geo);
      slot = { geo, inst };
      this.slots.push(slot);
    } else return null;
    mesh.setVisibleAt(slot.inst, false);
    return slot;
  }

  release(slot) {
    this.mesh.setVisibleAt(slot.inst, false);
    this.owner.delete(slot);
    this.free.push(slot);
  }

  /** Grow by `extra` slots (reallocates the batch buffers — rare). */
  grow(extra) {
    const cap = this.capacity + extra;
    this.mesh.setGeometrySize(cap * CHUNK_VERTS, cap * this.indexCount);
    this.mesh.setInstanceCount(cap);
    this.capacity = cap;
  }
}

export class TerrainLOD {
  constructor(ctx, pool, mat, opts) {
    this.ctx = ctx;
    this.pool = pool;
    this.uniforms = mat.uniforms;
    this.K = opts.K;
    this.maxLevel = opts.maxLevel;
    this.castMinLevel = opts.castMinLevel;
    this.maxInflight = opts.maxInflight ?? 3;
    this.world = opts.world; // Float32Array WG_N² (for bbox estimates)

    this.index = new THREE.BufferAttribute(buildChunkIndex(ctx.profile === 'quest' ? 4 : 2), 1);
    const n = this.index.count;
    this.fine = new ChunkBatch('terrain-near', mat.material, mat.depthMaterial, opts.fineCapacity ?? 200, true, n);
    this.coarse = new ChunkBatch('terrain-far', mat.material, mat.depthMaterial, opts.coarseCapacity ?? 240, false, n);
    this.group = new THREE.Group();
    this.group.name = 'terrain';
    this.group.matrixAutoUpdate = false;
    this.group.add(this.fine.mesh, this.coarse.mesh);
    ctx.scene.add(this.group);

    this.root = new Node(0, 0, 0, null);
    this.nodes = new Map([[this.root.key, this.root]]);
    this.displayed = [];
    this.wanted = [];
    this.results = [];
    this.frame = 0;
    this.tick = 0;
    this.lastCam = new THREE.Vector3(1e9, 0, 0);
    this.dirty = true;
    this.stats = { chunks: 0, jobs: 0, computedSamples: 0, grown: 0 };

    // morph ranges per level: a level-L vertex is fully on the parent surface at the distance where
    // the parent stops splitting (K x parent size).
    const m = this.uniforms.uTerrMorph.value;
    for (let L = 1; L <= MAX_LEVEL; L++) {
      const end = this.K * levelSize(L - 1);
      m[L].set(end * MORPH_START, end);
    }
    this._geo = new THREE.BufferGeometry();
    this._geo.setIndex(this.index);
  }

  // ---- geometry ---------------------------------------------------------------

  _batchFor(node) {
    return node.L >= this.castMinLevel ? this.fine : this.coarse;
  }

  _install(node, c) {
    const g = this._geo;
    g.setAttribute('position', new THREE.BufferAttribute(c.pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(c.nrm, 3, true));
    g.setAttribute('aMorph', new THREE.BufferAttribute(c.mor, 3));
    g.setAttribute('aMorphN', new THREE.BufferAttribute(c.morN, 2, true));
    const pad = 1;
    g.boundingBox = new THREE.Box3(
      new THREE.Vector3(c.x0 - pad, c.minY - pad, c.z0 - pad),
      new THREE.Vector3(c.x0 + c.size + pad, c.maxY + 2 + pad, c.z0 + c.size + pad),
    );
    g.boundingSphere = g.boundingBox.getBoundingSphere(new THREE.Sphere());
    const batch = this._batchFor(node);
    let slot = batch.alloc(g);
    if (!slot) {
      this._evict(batch, 24);
      slot = batch.alloc(g);
    }
    if (!slot) {
      batch.grow(Math.ceil(batch.capacity * 0.25));
      this.stats.grown++;
      slot = batch.alloc(g);
    }
    node.slot = slot;
    node.batch = batch;
    node.visible = false;
    node.used = this.frame; // fresh chunks are about to be shown: never evict them first
    batch.owner.set(slot, node);
    node.minY = c.minY;
    node.maxY = c.maxY + 2; // morph targets can sit slightly above
    node.state = 2;
  }

  _drop(node) {
    node.batch.release(node.slot);
    node.slot = null;
    node.batch = null;
    node.visible = false;
    node.state = 0;
  }

  _setVisible(node, v) {
    if (node.visible === v) return;
    node.visible = v;
    node.batch.mesh.setVisibleAt(node.slot.inst, v);
  }

  /**
   * Free up to `count` least-recently-used chunks the current selection does not touch (neither
   * drawn nor on the path to a drawn chunk). Fresh chunks count as touched (see _install).
   */
  _evict(batch, count) {
    const cands = [];
    for (const node of batch.owner.values()) if (node.used < this.frame && node.L > MIN_LEVEL) cands.push(node);
    cands.sort((a, b) => a.used - b.used);
    for (let i = 0; i < Math.min(count, cands.length); i++) this._drop(cands[i]);
  }

  // ---- tree ---------------------------------------------------------------------

  _children(node) {
    if (!node.children) {
      const L = node.L + 1;
      node.children = [];
      for (let k = 0; k < 4; k++) {
        const ix = node.ix * 2 + (k & 1), iz = node.iz * 2 + (k >> 1);
        const c = new Node(L, ix, iz, node);
        this._estimateBounds(c);
        this.nodes.set(c.key, c);
        node.children.push(c);
      }
    }
    return node.children;
  }

  /** Height range of a not-yet-computed node from the world grid (inside ±4600 m). */
  _estimateBounds(node) {
    const w = this.world;
    if (!w) return;
    const i0 = Math.floor((node.x0 - WG_X0) / WG_STEP), i1 = Math.ceil((node.x0 + node.size - WG_X0) / WG_STEP);
    const j0 = Math.floor((node.z0 - WG_X0) / WG_STEP), j1 = Math.ceil((node.z0 + node.size - WG_X0) / WG_STEP);
    if (i1 < 0 || j1 < 0 || i0 > WG_N - 1 || j0 > WG_N - 1) return;
    const a0 = Math.max(0, i0), a1 = Math.min(WG_N - 1, i1), b0 = Math.max(0, j0), b1 = Math.min(WG_N - 1, j1);
    const st = Math.max(1, Math.floor((a1 - a0) / 24));
    let lo = Infinity, hi = -Infinity;
    for (let j = b0; j <= b1; j += st) {
      for (let i = a0; i <= a1; i += st) {
        const h = w[j * WG_N + i];
        if (h < lo) lo = h;
        if (h > hi) hi = h;
      }
    }
    const inside = i0 >= 0 && j0 >= 0 && i1 <= WG_N - 1 && j1 <= WG_N - 1;
    const margin = 12 + node.size * 0.02;
    if (inside) {
      node.minY = lo - margin;
      node.maxY = hi + margin;
    } else {
      node.minY = Math.min(node.minY, lo - margin);
      node.maxY = Math.max(node.maxY, hi + margin);
    }
  }

  _dist(node, p) {
    const x0 = node.x0, z0 = node.z0, s = node.size;
    const dx = p.x < x0 ? x0 - p.x : p.x > x0 + s ? p.x - x0 - s : 0;
    const dz = p.z < z0 ? z0 - p.z : p.z > z0 + s ? p.z - z0 - s : 0;
    const dy = p.y < node.minY ? node.minY - p.y : p.y > node.maxY ? p.y - node.maxY : 0;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  _want(node, prio) {
    if (node.state !== 0) return;
    node.prio = prio;
    this.wanted.push(node);
  }

  _show(node) {
    node.shown = this.frame;
    node.used = this.frame;
    this.displayed.push(node);
  }

  _visit(node, cam, far) {
    const d = this._dist(node, cam);
    if (d > far) return;
    node.used = this.frame; // on the active path (drawn, or a ready fallback for its children)
    // Levels above MIN_LEVEL are organisational only (never computed or drawn).
    if (node.L < MIN_LEVEL) {
      for (const k of this._children(node)) this._visit(k, cam, far);
      return;
    }
    const split = node.L < this.maxLevel && d < this.K * node.size;
    if (split) {
      const kids = this._children(node);
      let allReady = true;
      for (const k of kids) if (k.state !== 2 && this._dist(k, cam) <= far) allReady = false;
      if (allReady) {
        for (const k of kids) this._visit(k, cam, far);
        return;
      }
      for (const k of kids) if (k.state === 0) this._want(k, this._dist(k, cam) / k.size);
      if (node.state === 2) {
        this._show(node);
        return;
      }
      this._want(node, -10 + d / node.size);
      for (const k of kids) if (k.state === 2) this._show(k);
      return;
    }
    if (node.state === 2) {
      this._show(node);
      return;
    }
    this._want(node, -10 + d / node.size);
    if (node.children && node.children.every((k) => k.state === 2)) for (const k of node.children) this._show(k);
  }

  /** Re-select the displayed set for the camera position. */
  select(cam) {
    this.frame++;
    const prev = this.displayed;
    this.displayed = [];
    this.wanted.length = 0;
    const far = this.ctx.camera.far * 1.02;
    this._visit(this.root, cam, far);
    for (const n of this.displayed) this._setVisible(n, true);
    for (const n of prev) if (n.shown !== this.frame && n.slot) this._setVisible(n, false);
    this.wanted.sort((a, b) => a.prio - b.prio);
    this.lastCam.copy(cam);
    this.dirty = false;
  }

  // ---- jobs ---------------------------------------------------------------------

  _workerFor(node) {
    const n = this.pool.size;
    if (node.L >= 7) {
      // leaf chunks go to the worker that computed (and cached) their level-7 ancestor
      const a = node.L === 7 ? node : node.parent;
      return (((a.ix * 73856093) ^ (a.iz * 19349663)) >>> 0) % n;
    }
    let best = 0;
    for (let i = 1; i < n; i++) if (this.pool.inflight(i) < this.pool.inflight(best)) best = i;
    return best;
  }

  _dispatch(limit = Infinity) {
    let sent = 0;
    for (const node of this.wanted) {
      if (sent >= limit) break;
      if (node.state !== 0) continue;
      const w = this._workerFor(node);
      if (this.pool.threaded && this.pool.inflight(w) >= this.maxInflight) continue;
      node.state = 1;
      sent++;
      this.stats.jobs++;
      this.pool
        .run(w, { type: 'chunk', L: node.L, ix: node.ix, iz: node.iz })
        .then((c) => this.results.push([node, c]))
        .catch((err) => {
          node.state = 0;
          console.error('[terrain] chunk job failed', err);
        });
    }
    return sent;
  }

  _integrate(maxPerFrame = Infinity) {
    let n = 0;
    while (this.results.length && n < maxPerFrame) {
      const [node, c] = this.results.shift();
      if (node.state !== 1) continue;
      this.stats.computedSamples += c.computed || 0;
      this._install(node, c);
      this.stats.chunks++;
      n++;
    }
    if (n) this.dirty = true;
    return n;
  }

  /** Synchronously compute everything the current selection wants (screenshot mode). */
  refineSync(cam, maxRounds = 12) {
    for (let r = 0; r < maxRounds; r++) {
      this.select(cam);
      if (!this.wanted.length) return true;
      for (const node of this.wanted) {
        if (node.state !== 0) continue;
        const c = this.pool.runLocal({ type: 'chunk', L: node.L, ix: node.ix, iz: node.iz });
        this.stats.computedSamples += c.computed || 0;
        node.state = 1;
        this._install(node, c);
      }
    }
    this.select(cam);
    return !this.wanted.length;
  }

  /**
   * Asynchronously refine until the selection is complete (initial load). Leaf chunks go to the
   * worker holding their parent's samples; everything else is pulled from a shared queue by the
   * workers and by the (otherwise idle) main thread.
   */
  async refineAsync(cam, maxRounds = 14) {
    const W = this.pool.size;
    for (let r = 0; r < maxRounds; r++) {
      this._integrate();
      this.select(cam);
      if (!this.wanted.length) return true;
      const own = Array.from({ length: W }, () => []);
      const shared = [];
      for (const node of this.wanted) {
        if (node.state !== 0) continue;
        node.state = 1;
        if (node.L >= 7) own[this._workerFor(node)].push(node);
        else shared.push(node);
      }
      let next = 0;
      const job = (node) => ({ type: 'chunk', L: node.L, ix: node.ix, iz: node.iz });
      const loops = [];
      for (let w = 0; w < W; w++) {
        loops.push(
          (async () => {
            for (const node of own[w]) this.results.push([node, await this.pool.run(w, job(node))]);
            while (next < shared.length) {
              const node = shared[next++];
              this.results.push([node, await this.pool.run(w, job(node))]);
            }
          })(),
        );
      }
      if (this.pool.threaded) {
        loops.push(
          (async () => {
            await yieldMain();
            while (next < shared.length) {
              const node = shared[next++];
              this.results.push([node, this.pool.runLocal(job(node))]);
              await yieldMain();
            }
          })(),
        );
      }
      await Promise.all(loops);
    }
    this._integrate();
    this.select(cam);
    return !this.wanted.length;
  }

  /** Per frame: integrate finished chunks, re-select when needed, keep the workers busy. */
  update(cam, syncMode) {
    if (syncMode) {
      if (this.dirty || cam.distanceToSquared(this.lastCam) > 0.25) this.refineSync(cam);
      return;
    }
    this._integrate(6);
    if (this.dirty || cam.distanceToSquared(this.lastCam) > 1) this.select(cam);
    if (this.wanted.length) this._dispatch(this.pool.threaded ? Infinity : 1);
    // keep headroom in the batches so they (almost) never have to grow mid-flight
    if ((++this.tick & 31) === 0) {
      for (const b of [this.fine, this.coarse]) if (b.used > b.capacity * 0.85) this._evict(b, Math.ceil(b.capacity * 0.1));
    }
  }

  countVisible() {
    const levels = {};
    for (const n of this.displayed) levels[n.L] = (levels[n.L] || 0) + 1;
    // chunks that survived the last frustum culling (main camera renders after the shadow pass)
    const drawn = (this.fine.mesh._multiDrawCount || 0) + (this.coarse.mesh._multiDrawCount || 0);
    return {
      levels,
      drawnChunks: drawn,
      drawnTris: drawn * (this.index.count / 3),
      displayed: this.displayed.length,
      tris: this.displayed.length * (this.index.count / 3),
      slots: this.fine.slots.length + this.coarse.slots.length,
      used: this.fine.used + this.coarse.used,
    };
  }
}
