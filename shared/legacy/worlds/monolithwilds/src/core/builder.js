// GeometryBuilder: accumulate thousands of transformed pieces, then merge them into ONE mesh
// per material. This is how landmarks stay at a handful of draw calls while being enormously
// detailed. Also: instancing helper and a few geometry utilities.
//
//   const b = new GeometryBuilder();
//   const m = new THREE.Matrix4();
//   b.add(new THREE.BoxGeometry(4, 2, 4), mats.get('stone'), m.makeTranslation(0, 1, 0));
//   b.add(geo, mats.get('basalt'), matrix, 0.8);          // optional tint (number or colour)
//   const group = b.build({ name: 'my-landmark' });        // THREE.Group of merged meshes
//   scene.add(group);

import * as THREE from 'crownfall-world-three';
import { mergeGeometries } from './geometry-utils.js';

const _color = new THREE.Color();

/** Normalise a geometry so it can be merged with any other: indexed, position/normal/uv/color only. */
export function normalizeGeometry(geometry, tint = null) {
  let g = geometry;
  if (!g.index) {
    const count = g.attributes.position.count;
    const idx = new (count > 65535 ? Uint32Array : Uint16Array)(count);
    for (let i = 0; i < count; i++) idx[i] = i;
    g.setIndex(new THREE.BufferAttribute(idx, 1));
  }
  for (const name of Object.keys(g.attributes)) {
    if (name !== 'position' && name !== 'normal' && name !== 'uv' && name !== 'color') g.deleteAttribute(name);
  }
  if (!g.attributes.normal) g.computeVertexNormals();
  const count = g.attributes.position.count;
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(count * 2), 2));
  if (!g.attributes.color || g.attributes.color.itemSize !== 3) {
    if (g.attributes.color) g.deleteAttribute('color');
    const arr = new Float32Array(count * 3);
    if (tint === null) arr.fill(1);
    else {
      if (typeof tint === 'number' && tint <= 4) _color.setRGB(tint, tint, tint);
      else _color.set(tint);
      for (let i = 0; i < count; i++) {
        arr[i * 3] = _color.r;
        arr[i * 3 + 1] = _color.g;
        arr[i * 3 + 2] = _color.b;
      }
    }
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  } else if (tint !== null) {
    if (typeof tint === 'number' && tint <= 4) _color.setRGB(tint, tint, tint);
    else _color.set(tint);
    const c = g.attributes.color;
    for (let i = 0; i < count; i++) c.setXYZ(i, c.getX(i) * _color.r, c.getY(i) * _color.g, c.getZ(i) * _color.b);
  }
  // Merge needs identical attribute types. Force float32 non-normalised.
  for (const name of ['position', 'normal', 'uv', 'color']) {
    const a = g.attributes[name];
    if (!(a.array instanceof Float32Array) || a.normalized || a.isInterleavedBufferAttribute) {
      const arr = new Float32Array(a.count * a.itemSize);
      for (let i = 0; i < a.count; i++) for (let k = 0; k < a.itemSize; k++) arr[i * a.itemSize + k] = a.getComponent(i, k);
      g.setAttribute(name, new THREE.BufferAttribute(arr, a.itemSize));
    }
  }
  g.morphAttributes = {};
  g.clearGroups();
  return g;
}

export class GeometryBuilder {
  constructor() {
    /** @type {Map<THREE.Material, THREE.BufferGeometry[]>} */
    this.buckets = new Map();
    this.vertexCount = 0;
  }

  /**
   * Add a piece. The geometry is cloned (the original is left untouched and can be reused).
   * @param {THREE.BufferGeometry} geometry
   * @param {THREE.Material} material
   * @param {THREE.Matrix4} [matrix]
   * @param {number|string|THREE.Color} [tint]  brightness multiplier (0..4) or colour; baked into vertex colour
   */
  add(geometry, material, matrix = null, tint = null) {
    const g = normalizeGeometry(geometry.clone(), tint);
    if (matrix) g.applyMatrix4(matrix);
    let list = this.buckets.get(material);
    if (!list) this.buckets.set(material, (list = []));
    list.push(g);
    this.vertexCount += g.attributes.position.count;
    return this;
  }

  /** Add a mesh (uses its world-less local matrix composed with `parentMatrix`). */
  addMesh(mesh, parentMatrix = null) {
    mesh.updateMatrix();
    const m = parentMatrix ? parentMatrix.clone().multiply(mesh.matrix) : mesh.matrix;
    return this.add(mesh.geometry, mesh.material, m);
  }

  /** Merge everything into a Group with one Mesh per material. */
  build({ name = 'built', castShadow = true, receiveShadow = true } = {}) {
    const group = new THREE.Group();
    group.name = name;
    for (const [material, list] of this.buckets) {
      if (!list.length) continue;
      // merge in chunks to stay well within index limits and keep culling useful
      const CHUNK_VERTS = 1_500_000;
      let batch = [];
      let verts = 0;
      const flush = () => {
        if (!batch.length) return;
        const merged = mergeGeometries(batch, false);
        merged.computeBoundingSphere();
        merged.computeBoundingBox();
        const mesh = new THREE.Mesh(merged, material);
        mesh.castShadow = castShadow;
        mesh.receiveShadow = receiveShadow;
        mesh.name = `${name}:${material.userData?.preset ?? material.type}`;
        mesh.matrixAutoUpdate = false;
        mesh.updateMatrix();
        group.add(mesh);
        for (const g of batch) g.dispose();
        batch = [];
        verts = 0;
      };
      for (const g of list) {
        batch.push(g);
        verts += g.attributes.position.count;
        if (verts > CHUNK_VERTS) flush();
      }
      flush();
    }
    this.buckets.clear();
    return group;
  }
}

/**
 * Build an InstancedMesh from a list of matrices (and optional per-instance colours).
 * Geometry is normalised so library materials (vertexColors) work.
 */
export function makeInstanced(geometry, material, matrices, { colors = null, castShadow = true, receiveShadow = true, name = 'instanced' } = {}) {
  const g = normalizeGeometry(geometry.clone());
  const mesh = new THREE.InstancedMesh(g, material, matrices.length);
  for (let i = 0; i < matrices.length; i++) mesh.setMatrixAt(i, matrices[i]);
  if (colors) {
    for (let i = 0; i < colors.length; i++) mesh.setColorAt(i, colors[i] instanceof THREE.Color ? colors[i] : _color.set(colors[i]));
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.castShadow = castShadow;
  mesh.receiveShadow = receiveShadow;
  mesh.name = name;
  mesh.computeBoundingSphere();
  return mesh;
}

/** Compose a matrix from position / euler rotation / scale in one call. */
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
export function trs(x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx, order = 'YXZ') {
  _e.set(rx, ry, rz, order);
  _q.setFromEuler(_e);
  _p.set(x, y, z);
  _s.set(sx, sy, sz);
  return new THREE.Matrix4().compose(_p, _q, _s);
}
