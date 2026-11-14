// What took root on the observatory: small crooked trees in the cracks of the upper shell, on the
// gallery deck and on the capitals of the columns; curtains of hanging vines from breach edges,
// cornices and the underside of the telescope. All in site space, merged into the leaf / bark
// buckets (rock preset tinted green, basalt tinted brown) — no extra shader programs.

import * as THREE from 'crownfall-world-three';

const UP = new THREE.Vector3(0, 1, 0);
const _p = new THREE.Vector3();
const _q = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _s = new THREE.Matrix4();
const _e = new THREE.Euler();
const _qt = new THREE.Quaternion();
const _v = new THREE.Vector3();

// rock preset base colour is a warm grey; these multiply it into mossy / leafy greens
const LEAF_TINTS = [
  [0.34, 0.62, 0.2],
  [0.42, 0.68, 0.22],
  [0.3, 0.52, 0.2],
  [0.5, 0.66, 0.26],
  [0.62, 0.6, 0.26], // autumn-touched
];
const VINE_TINTS = [
  [0.3, 0.5, 0.2],
  [0.36, 0.56, 0.22],
  [0.28, 0.44, 0.2],
];
const BARK = [1.25, 1.02, 0.82];

function blobGeometry(ctx, seed) {
  const g = new THREE.IcosahedronGeometry(1, 1);
  const p = g.attributes.position;
  const N = ctx.noise.worldNoise;
  for (let i = 0; i < p.count; i++) {
    _v.fromBufferAttribute(p, i);
    const k = 1 + 0.28 * N.noise3(_v.x * 1.7 + seed, _v.y * 1.7, _v.z * 1.7 - seed);
    _v.multiplyScalar(k);
    if (_v.y < -0.2) _v.y *= 0.55; // flatter underside
    p.setXYZ(i, _v.x, _v.y, _v.z);
  }
  g.computeVertexNormals();
  return g;
}

export function buildFlora(ctx, S, M, trees, vines) {
  const rng = ctx.noise.createRng('observatory-flora');
  const blobs = [blobGeometry(ctx, 1.3), blobGeometry(ctx, 7.1), blobGeometry(ctx, 13.7)];
  S.setMatrix(new THREE.Matrix4());
  let nTrees = 0;
  for (const t of trees) {
    const s = t.s * 10; // overall height scale (m)
    const base = t.p;
    // trunk: 3 crooked segments leaning a little, mostly toward the light (west)
    let a = base.clone();
    const lean = new THREE.Vector3(-0.35 + (rng() - 0.5) * 0.6, 1, (rng() - 0.5) * 0.6).normalize();
    const segs = 3;
    const w0 = Math.max(0.35, s * 0.07);
    for (let k = 0; k < segs; k++) {
      const len = (s * 0.62) / segs;
      _v.copy(lean).add(_p.set((rng() - 0.5) * 0.5, 0, (rng() - 0.5) * 0.5)).normalize();
      const b = a.clone().addScaledVector(_v, len);
      S.beam(M.bark, k === 0 ? a.clone().addScaledVector(_v, -1.2) : a, b, _q.set(1, 0, 0), w0 * (1 - k * 0.22), w0 * (1 - k * 0.22), BARK, 0.8);
      a = b;
    }
    // canopy: a few flattened blobs around the crown
    const nb = 3 + Math.floor(rng() * 3);
    const tint = LEAF_TINTS[Math.floor(rng() * LEAF_TINTS.length)];
    for (let k = 0; k < nb; k++) {
      const r = s * (0.22 + rng() * 0.16);
      _p.copy(a).add(_v.set((rng() - 0.5) * s * 0.45, (rng() - 0.3) * s * 0.22, (rng() - 0.5) * s * 0.45));
      _e.set(rng() * 0.4, rng() * 6.28, rng() * 0.4);
      _qt.setFromEuler(_e);
      _m.compose(_p, _qt, _v.set(r * (1 + rng() * 0.4), r * (0.6 + rng() * 0.25), r * (1 + rng() * 0.4)));
      const k2 = 0.85 + rng() * 0.3;
      S.geo(M.leaf, blobs[Math.floor(rng() * 3)], _m, [tint[0] * k2, tint[1] * k2, tint[2] * k2]);
    }
    nTrees++;
  }
  // low moss / shrub cushions around every tree base
  for (const t of trees) {
    const n = 2 + Math.floor(rng() * 3);
    for (let k = 0; k < n; k++) {
      const r = 1.2 + rng() * 2.2;
      _p.copy(t.p).add(_v.set((rng() - 0.5) * 7, 0.2, (rng() - 0.5) * 7));
      _m.compose(_p, _qt.identity(), _v.set(r * 1.4, r * 0.55, r * 1.2));
      const tint = VINE_TINTS[Math.floor(rng() * VINE_TINTS.length)];
      S.geo(M.leaf, blobs[k % 3], _m, tint);
    }
  }
  // vines: each anchor drops a curtain of 3–5 strands, each 3 tapering pieces with a slight drift
  for (const v of vines) {
    const n = 3 + Math.floor(rng() * 3);
    const tint = VINE_TINTS[Math.floor(rng() * VINE_TINTS.length)];
    for (let k = 0; k < n; k++) {
      const len = v.len * (0.45 + rng() * 0.7);
      let a = v.p.clone().add(_v.set((rng() - 0.5) * 4, 0, (rng() - 0.5) * 4));
      if (a.y - len < 0.4) continue; // never dip into the lake
      const drift = new THREE.Vector3((rng() - 0.5) * 0.8, 0, (rng() - 0.5) * 0.8);
      const w = 0.5 + rng() * 0.7;
      for (let i = 0; i < 3; i++) {
        const b = a.clone().addScaledVector(UP, -len / 3).addScaledVector(drift, (i + 1) * 0.6);
        S.beam(M.leaf, a, b, _q.set(1, 0, 0), w * (1 - i * 0.28), w * 0.6, tint, 0.75);
        a = b;
      }
    }
  }
  for (const b of blobs) b.dispose();
  return { trees: nTrees };
}
