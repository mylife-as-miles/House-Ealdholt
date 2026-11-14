// Descending Temple — hanging gardens. Vegetation obeys *our* gravity while the architecture obeys
// the sky's: trees grow out of the terrace planters sideways, reaching out from under the eaves
// toward the light, and curtains of vines pour over every plate edge, hanging freely in the air
// past the narrower terraces below. Built in the tilted frame of the mass.
//
// One custom foliage material (colour comes entirely from vertex / instance colour), one merged
// mesh for vines + trunks, one InstancedMesh for leaf clumps.

import * as THREE from 'crownfall-world-three';
import { mergeVertices } from '../core/geometry-utils.js';
import { Acc, setBounds } from './temple-geo.js';
import { BITES, stairHalfWidth } from './temple-tiers.js';

const SIDES = [0, Math.PI / 2, Math.PI, -Math.PI / 2];
const LEAF = [
  [0.3, 0.44, 0.16], [0.35, 0.48, 0.18], [0.42, 0.5, 0.2], [0.26, 0.4, 0.17], [0.5, 0.52, 0.2], [0.56, 0.48, 0.19],
];

function leafClumpGeometry(worldNoise, detail = 1) {
  let g = new THREE.IcosahedronGeometry(1, detail);
  g.deleteAttribute('uv');
  g.deleteAttribute('normal');
  g = mergeVertices(g);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const n = 1 + 0.28 * worldNoise.noise3(x * 1.7, y * 1.7, z * 1.7) + 0.12 * worldNoise.noise3(x * 4.1 + 3, y * 4.1, z * 4.1);
    p.setXYZ(i, x * n, y * n * 0.78, z * n);
  }
  g.computeVertexNormals();
  return g;
}

/** Hanging strand as two crossed tapered ribbons with a gentle outward belly. */
function strand(acc, x, y, z, ox, oz, len, w0, tint, rng) {
  const segs = 4;
  const bx = ox * (0.2 + rng() * 0.4), bz = oz * (0.2 + rng() * 0.4);
  const tx = -oz, tz = ox; // across
  const F = acc.frame ? acc.frame.elements : null;
  acc.reserve(2 * 2 * (segs + 1), 2 * 6 * segs);
  const push = (px, py, pz, nx, ny, nz) => {
    if (F) {
      const X = F[0] * px + F[4] * py + F[8] * pz + F[12];
      const Y = F[1] * px + F[5] * py + F[9] * pz + F[13];
      const Z = F[2] * px + F[6] * py + F[10] * pz + F[14];
      return acc.vert(X, Y, Z, nx, ny, nz, tint[0], tint[1], tint[2]);
    }
    return acc.vert(px, py, pz, nx, ny, nz, tint[0], tint[1], tint[2]);
  };
  for (let ribbon = 0; ribbon < 2; ribbon++) {
    const ax = ribbon ? ox : tx, az = ribbon ? oz : tz; // ribbon width direction
    const nx = ribbon ? tx : ox, nz = ribbon ? tz : oz; // ribbon normal
    const base = acc.vc;
    for (let s = 0; s <= segs; s++) {
      const f = s / segs;
      const w = w0 * (1 - f * 0.75);
      const belly = Math.sin(f * Math.PI) * 0.6 + f * 0.4;
      const cx = x + bx * belly, cy = y - len * f, cz = z + bz * belly;
      push(cx - ax * w, cy, cz - az * w, nx, 0.2, nz);
      push(cx + ax * w, cy, cz + az * w, nx, 0.2, nz);
    }
    for (let s = 0; s < segs; s++) {
      const a = base + s * 2;
      acc.index(a); acc.index(a + 1); acc.index(a + 2);
      acc.index(a + 1); acc.index(a + 3); acc.index(a + 2);
    }
  }
}

export function buildGardens(ctx, A, tiers, rng, out, tilt) {
  const mat = ctx.materials.create(
    {
      color: '#ffffff', alt: '#d8e0b0', moss: '#ffffff',
      rough: [0.72, 0.95], streaks: 0, mossAmount: 0, grime: 0, bump: 1.6, macroScale: 6, variation: 0.6, fine: 2.2,
    },
    { side: THREE.DoubleSide },
  );
  const vines = new Acc('vines');
  vines.setFrame(tilt);
  const clumps = []; // { m: Matrix4, c: Color }
  const _m = new THREE.Matrix4();
  const _q = new THREE.Quaternion();
  const _e = new THREE.Euler();
  const _p = new THREE.Vector3();
  const _s = new THREE.Vector3();
  const addClump = (x, y, z, r, sy, col, yaw = 0) => {
    _e.set((rng() - 0.5) * 0.4, yaw, (rng() - 0.5) * 0.4);
    _q.setFromEuler(_e);
    _p.set(x, y, z);
    _s.set(r, r * sy, r);
    const m = new THREE.Matrix4().compose(_p, _q, _s).premultiply(tilt);
    const v = 0.8 + rng() * 0.4;
    clumps.push({ m, c: new THREE.Color(col[0] * v, col[1] * v, col[2] * v) });
  };
  const bitten = (ti, x, z, pad) => BITES.some((b) => b.tier === ti && Math.hypot(x - b.x, z - b.z) < b.r + pad);

  // --- trees in the garden planters -------------------------------------------------------
  const bark = [0.3, 0.24, 0.18];
  for (const tr of out.trees) {
    const ox = Math.sin(tr.a), oz = Math.cos(tr.a);
    const s = tr.size;
    let x = tr.x, y = tr.y, z = tr.z;
    // two trunk segments: first reaching out from under the eave, then turning up
    const segs = [
      { lean: 1.05 + tr.lean * 0.35, len: 7 * s },
      { lean: 0.55 + tr.lean * 0.3, len: 6 * s },
      { lean: 0.2, len: 3.5 * s },
    ];
    let rad = 0.55 * s;
    for (const g of segs) {
      const dx = ox * Math.sin(g.lean), dy = Math.cos(g.lean), dz = oz * Math.sin(g.lean);
      const x2 = x + dx * g.len, y2 = y + dy * g.len, z2 = z + dz * g.len;
      vines.beam(x, y, z, x2, y2, z2, rad * 2, rad * 2, bark);
      x = x2; y = y2; z = z2;
      rad *= 0.7;
    }
    const col = LEAF[Math.floor(rng() * LEAF.length)];
    const nC = 5 + Math.floor(rng() * 4);
    for (let k = 0; k < nC; k++) {
      const sp = 6 * s;
      addClump(x + (rng() - 0.5) * sp + ox * rng() * 3, y + (rng() - 0.35) * 2.5 * s, z + (rng() - 0.5) * sp + oz * rng() * 3, (1.5 + rng() * 1.6) * s, 0.55, col, rng() * 6);
    }
    // a few vines trailing from the canopy
    for (let k = 0; k < 4; k++) {
      strand(vines, x + (rng() - 0.5) * 4, y - 1, z + (rng() - 0.5) * 4, ox, oz, 6 + rng() * 14, 0.35, LEAF[Math.floor(rng() * 3)], rng);
    }
  }

  // --- upright trees in the plaza groves --------------------------------------------------------
  for (const tr of out.plazaTrees) {
    const s = tr.size;
    const h = (9 + rng() * 6) * s;
    const lx = (rng() - 0.5) * 0.3, lz = (rng() - 0.5) * 0.3;
    vines.beam(tr.x, tr.y, tr.z, tr.x + lx * h, tr.y + h, tr.z + lz * h, 0.9 * s, 0.9 * s, bark);
    const col = LEAF[Math.floor(rng() * LEAF.length)];
    const cx = tr.x + lx * h, cy = tr.y + h, cz = tr.z + lz * h;
    for (let k = 0; k < 5; k++) {
      addClump(cx + (rng() - 0.5) * 6 * s, cy + (rng() - 0.6) * 4 * s, cz + (rng() - 0.5) * 6 * s, (2.2 + rng() * 1.8) * s, 0.7, col, rng() * 6);
    }
  }

  // --- vine curtains over the plate edges ---------------------------------------------------
  for (const t of tiers) {
    if (t.i < 2) continue;
    const garden = t.type === 'garden';
    const density = garden ? 0.05 : 0.012; // clusters per metre of edge
    const co = 0.55 + 0.035 * t.h;
    const rEdge = t.hw + co + 0.25;
    for (const a of SIDES) {
      const n = Math.round(2 * t.hw * density);
      const clear = stairHalfWidth(tiers[Math.max(0, t.i - 1)]);
      for (let k = 0; k < n; k++) {
        const u = (rng() * 2 - 1) * (t.hw - 3);
        if (Math.abs(u) < clear) continue;
        const s = Math.sin(a), c = Math.cos(a);
        const x = u * c + rEdge * s, z = -u * s + rEdge * c;
        if (bitten(t.i, x, z, 3)) continue;
        const col = LEAF[Math.floor(rng() * LEAF.length)];
        const span = 2.5 + rng() * (garden ? 8 : 3);
        const strands = garden ? 10 + Math.floor(rng() * 12) : 4 + Math.floor(rng() * 5);
        const maxLen = garden ? 14 + rng() * 34 : 5 + rng() * 14;
        for (let q = 0; q < strands; q++) {
          const uu = u + (rng() - 0.5) * span;
          const xx = uu * c + rEdge * s, zz = -uu * s + rEdge * c;
          const len = maxLen * (0.3 + 0.7 * rng());
          strand(vines, xx, t.yf + 0.2, zz, s, c, len, 0.28 + rng() * 0.3, col, rng);
        }
        // leafy mass spilling over the cornice
        const k2 = garden ? 3 : 1;
        for (let q = 0; q < k2; q++) {
          const uu = u + (rng() - 0.5) * span * 0.6;
          const rr = rEdge - 0.6;
          addClump(uu * c + rr * s, t.yf + 0.3 + rng() * 0.6, -uu * s + rr * c, 0.9 + rng() * 1.2, 0.6, col, a);
        }
      }
    }
  }

  // --- merge --------------------------------------------------------------------------------
  const meshes = [];
  let triangles = vines.triangles;
  const vm = vines.toMesh(mat, { name: 'temple:vines' });
  if (vm) meshes.push(vm);
  if (clumps.length) {
    const geo = leafClumpGeometry(ctx.noise.worldNoise, ctx.profile === 'quest' ? 0 : 1);
    const im = new THREE.InstancedMesh(geo, mat, clumps.length);
    // library materials read the per-vertex colour attribute; give the clump geometry a white one
    const cnt = geo.attributes.position.count;
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(cnt * 3).fill(1), 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(cnt * 2), 2));
    clumps.forEach((c, i) => {
      im.setMatrixAt(i, c.m);
      im.setColorAt(i, c.c);
    });
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
    im.castShadow = true;
    im.receiveShadow = true;
    im.name = 'temple:leaves';
    // bounds from instance translations (InstancedMesh.computeBoundingSphere is very slow here)
    const T = new Float32Array(clumps.length * 3);
    clumps.forEach((c, i) => {
      T[i * 3] = c.m.elements[12];
      T[i * 3 + 1] = c.m.elements[13];
      T[i * 3 + 2] = c.m.elements[14];
    });
    const bb = new THREE.BufferGeometry();
    setBounds(bb, T);
    im.boundingSphere = bb.boundingSphere;
    im.boundingSphere.radius += 12;
    im.boundingBox = bb.boundingBox.expandByScalar(12);
    meshes.push(im);
    triangles += (geo.index ? geo.index.count / 3 : cnt / 3) * clumps.length;
  }
  return { meshes, triangles };
}
