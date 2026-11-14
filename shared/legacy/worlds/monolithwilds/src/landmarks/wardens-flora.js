// Kneeling Wardens — the small wild things that took root on the colossi: pines on the
// shoulders and thighs, shrubs on ledges, hands and fallen stones. Tiny on purpose: they are
// what tells the eye how enormous the bodies are.

import * as THREE from 'crownfall-world-three';

let GEO = null;
function geos() {
  if (GEO) return GEO;
  const cone = new THREE.ConeGeometry(1, 1, 6, 1, true).toNonIndexed();
  cone.translate(0, 0.5, 0);
  cone.computeVertexNormals();
  const trunk = new THREE.CylinderGeometry(0.5, 0.7, 1, 5, 1, true).toNonIndexed();
  trunk.translate(0, 0.5, 0);
  trunk.computeVertexNormals();
  // lumpy foliage clump: a subdivided icosahedron with jittered vertices (flat shaded)
  const blob = new THREE.IcosahedronGeometry(1, 1);
  const p = blob.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = 0.82 + 0.36 * Math.abs(Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453 % 1);
    p.setXYZ(i, x * k, y * k, z * k);
  }
  blob.computeVertexNormals();
  GEO = { cone, trunk, blob };
  return GEO;
}

// multipliers on the 'rock' preset (a warm grey): these land on muted olive / pine greens
const LEAF_TINTS = [
  [0.62, 0.95, 0.4],
  [0.7, 1.02, 0.44],
  [0.5, 0.82, 0.4],
  [0.85, 1.0, 0.45],
  [1.15, 0.82, 0.4], // one autumn-rusty
];
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();

function place(x, y, z, sx, sy, sz, yaw = 0, tiltX = 0, tiltZ = 0) {
  _e.set(tiltX, yaw, tiltZ, 'YXZ');
  _q.setFromEuler(_e);
  return _m.compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz));
}

/** A small pine: trunk + two stacked cones. (x, y, z) = foot, h = height. */
export function pine(sink, mat, x, y, z, h, rng) {
  const G = geos();
  const t = rng.pick(LEAF_TINTS);
  const lean = rng.range(-0.12, 0.12);
  const lean2 = rng.range(-0.12, 0.12);
  sink.geo(mat, G.trunk, place(x, y - 0.3, z, h * 0.035, h * 0.45, h * 0.035, 0, lean, lean2), [0.62, 0.5, 0.4]);
  const yaw = rng.range(0, 6.28);
  sink.geo(mat, G.cone, place(x, y + h * 0.18, z, h * 0.26, h * 0.55, h * 0.26, yaw, lean, lean2), t);
  sink.geo(mat, G.cone, place(x, y + h * 0.48, z, h * 0.18, h * 0.52, h * 0.18, yaw + 0.5, lean, lean2), t);
}

/** A rounded shrub / small broadleaf clump. */
export function shrub(sink, mat, x, y, z, r, rng) {
  const G = geos();
  const t = rng.pick(LEAF_TINTS);
  const n = rng.int(1, 3);
  for (let i = 0; i < n; i++) {
    const ox = rng.range(-0.6, 0.6) * r, oz = rng.range(-0.6, 0.6) * r;
    const rr = r * rng.range(0.6, 1);
    sink.geo(mat, G.blob, place(x + ox, y + rr * 0.55, z + oz, rr, rr * rng.range(0.65, 0.9), rr, rng.range(0, 6), rng.range(-0.3, 0.3)), t);
  }
}

/** Broadleaf tree: trunk + a few blobs. */
export function broadleaf(sink, mat, x, y, z, h, rng) {
  const G = geos();
  const t = rng.pick(LEAF_TINTS);
  sink.geo(mat, G.trunk, place(x, y - 0.3, z, h * 0.04, h * 0.55, h * 0.04, 0, rng.range(-0.15, 0.15), rng.range(-0.15, 0.15)), [0.62, 0.5, 0.4]);
  const n = rng.int(2, 3);
  for (let i = 0; i < n; i++) {
    const rr = h * rng.range(0.22, 0.32);
    sink.geo(mat, G.blob, place(x + rng.range(-0.2, 0.2) * h, y + h * rng.range(0.5, 0.72), z + rng.range(-0.2, 0.2) * h, rr, rr * 0.8, rr, rng.range(0, 6)), t);
  }
}

/**
 * Scatter plants over anchor patches: { x, y, z, rx, rz, n, kind: 'mix'|'shrub'|'pine' }.
 * Coordinates are in the sink's current frame.
 */
export function plantTrees(sink, mat, spots, rng, scale = 1) {
  for (const sp of spots) {
    for (let i = 0; i < sp.n; i++) {
      const a = rng.range(0, Math.PI * 2);
      const rr = Math.sqrt(rng());
      const x = sp.x + Math.cos(a) * sp.rx * rr;
      const z = sp.z + Math.sin(a) * sp.rz * rr;
      const y = sp.y;
      const kind = sp.kind === 'mix' ? rng.pick(['pine', 'pine', 'shrub', 'broad']) : sp.kind;
      if (kind === 'pine') pine(sink, mat, x, y, z, rng.range(6, 13) * scale, rng);
      else if (kind === 'broad') broadleaf(sink, mat, x, y, z, rng.range(6, 10) * scale, rng);
      else shrub(sink, mat, x, y, z, rng.range(1.2, 2.8) * scale, rng);
    }
  }
}
