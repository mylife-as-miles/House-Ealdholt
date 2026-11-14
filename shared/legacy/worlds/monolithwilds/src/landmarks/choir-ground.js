// Choir ground works: the stepped amphitheatre ring (raised around a floor at grade, so it reads
// as a sunken bowl from inside), its gate cut toward the sunset, the obsidian mirror and glyph
// circle under the giant, and the paved processional spiral with its sparse glowing tiles.

import * as THREE from 'crownfall-world-three';
import { oct } from './choir-mesh.js';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3(1, 1, 1);

function place(x, y, z, yaw, rx = 0, rz = 0) {
  _e.set(rx, yaw, rz, 'YXZ');
  _q.setFromEuler(_e);
  return _m.compose(_v.set(x, y, z), _q, _s);
}

export function buildAmphitheatre(ctx, K, plan, rng) {
  const a = plan.amph;
  const { R0, STEPS, RISE, TREAD, Rrim, Rout, floorY, gLow, rimY } = a;
  const bottom = gLow - 1.2;

  // stepped profile (r, y), inner edge outward
  const prof = [[R0, floorY]];
  for (let k = 0; k < STEPS; k++) {
    const y = floorY + (k + 1) * RISE;
    prof.push([R0 + k * TREAD, y], [R0 + (k + 1) * TREAD, y]);
  }
  prof.push([Rrim, rimY]);
  const drop = (rimY - bottom) / 3;
  prof.push([Rrim + 0.7, rimY - drop], [Rrim + 2.9, rimY - drop], [Rrim + 3.6, rimY - 2 * drop], [Rrim + 5.9, rimY - 2 * drop], [Rout, bottom]);

  const phiA = a.gate + a.GAP;
  const phiB = a.gate - a.GAP + Math.PI * 2;
  const segs = 180;
  K.stone.frame(null).setTint(0.97);
  for (let i = 0; i < prof.length - 1; i++) {
    const [r0, y0] = prof[i];
    const [r1, y1] = prof[i + 1];
    const dr = r1 - r0;
    const dy = y1 - y0;
    const l = Math.hypot(dr, dy);
    const nr = -dy / l;
    const ny = dr / l;
    for (let j = 0; j < segs; j++) {
      const p0 = phiA + ((phiB - phiA) * j) / segs;
      const p1 = phiA + ((phiB - phiA) * (j + 1)) / segs;
      const c0 = Math.cos(p0), s0 = Math.sin(p0), c1 = Math.cos(p1), s1 = Math.sin(p1);
      // weathering: some treads slightly darker / greener in patches
      K.stone.setTint(0.9 + 0.12 * Math.sin(j * 0.37 + i * 1.3) * Math.sin(j * 0.11));
      K.stone.quadN(
        [r0 * c0, y0, r0 * s0], [r0 * c1, y0, r0 * s1], [r1 * c1, y1, r1 * s1], [r1 * c0, y1, r1 * s0],
        [nr * c0, ny, nr * s0], [nr * c1, ny, nr * s1], [nr * c1, ny, nr * s1], [nr * c0, ny, nr * s0],
      );
    }
  }
  // gate cut faces
  const contour = prof.map(([r, y]) => new THREE.Vector2(r, y));
  contour.push(new THREE.Vector2(R0, bottom));
  const tris = THREE.ShapeUtils.triangulateShape(contour, []);
  for (const [phi, sgn] of [[phiA, -1], [phiB, 1]]) {
    const c = Math.cos(phi), s = Math.sin(phi);
    const pts = contour.map((p) => [p.x * c, p.y, p.x * s]);
    K.stone.setTint(0.95).poly(pts, tris, [-s * sgn, 0, c * sgn]);
  }

  // floor: paved disc, obsidian mirror, glyph circle
  K.stone.setTint(0.9);
  const disc = (r, n) => Array.from({ length: n }, (_, i) => [Math.cos((i / n) * Math.PI * 2) * r, Math.sin((i / n) * Math.PI * 2) * r]);
  K.stone.prism(disc(R0 + 0.5, 72), bottom, disc(R0 + 0.5, 72), floorY, { bottom: false });
  K.dead.frame(null).setTint(1);
  K.dead.prism(disc(13, 64), floorY - 0.2, disc(13, 64), floorY + 0.08, { bottom: false });
  K.stone.setTint(0.8);
  K.stone.prism(disc(14.2, 64), floorY - 0.2, disc(14.2, 64), floorY + 0.05, { bottom: false });

  K.glow.frame(null).setTint(1);
  const dash = (r, width, n, fill, ph = 0) => {
    for (let i = 0; i < n; i++) {
      const a0 = ((i + ph) / n) * Math.PI * 2;
      const len = ((Math.PI * 2 * r) / n) * fill;
      K.glow.box(Math.cos(a0) * r, floorY + 0.1, Math.sin(a0) * r, width, 0.08, len, -a0);
    }
  };
  dash(15.2, 0.45, 40, 0.82);
  dash(21.5, 0.3, 28, 0.5, 0.25);
  dash(R0 - 2.2, 0.22, 60, 0.35, 0.5);
  for (let i = 0; i < 12; i++) {
    const a0 = (i / 12) * Math.PI * 2 + 0.13;
    const rm = 18.3;
    K.glow.box(Math.cos(a0) * rm, floorY + 0.1, Math.sin(a0) * rm, 4.6, 0.08, 0.28, -a0);
  }

  // loose and heaved blocks on the treads; a few broken tread edges
  for (let i = 0; i < 46; i++) {
    const k = rng.int(0, STEPS - 1);
    const phi = rng.range(phiA + 0.05, phiB - 0.05);
    const r = R0 + (k + rng.range(0.3, 0.8)) * TREAD;
    const y = floorY + (k + 1) * RISE;
    const sx = rng.range(0.9, 2.6), sy = rng.range(0.5, 1.1), sz = rng.range(0.9, 2.2);
    K.stone.frame(place(Math.cos(phi) * r, y + sy * 0.3, Math.sin(phi) * r, -phi, rng.range(-0.25, 0.25), rng.range(-0.25, 0.25)))
      .setTint(rng.range(0.8, 1.02));
    K.stone.prism(oct(sx / 2, sz / 2, 0.12), -sy / 2, oct(sx / 2, sz / 2, 0.12), sy / 2);
  }
  K.stone.frame(null);
}

/** Flagstones along the spiral and the gate passage; glowing tiles every ~25 m. */
export function buildPath(ctx, K, plan, rng) {
  const { gh, path, passage, amph } = plan;
  const rows = [];
  // resample the spiral at 3.1 m spacing by arc length
  let acc = 0;
  for (let i = 1; i < path.length; i++) {
    const p = path[i - 1], q = path[i];
    const l = Math.hypot(q.x - p.x, q.z - p.z);
    while (acc <= l) {
      const t = acc / l;
      rows.push({ x: p.x + (q.x - p.x) * t, z: p.z + (q.z - p.z) * t, tx: p.tx, tz: p.tz, gate: false });
      acc += 3.1;
    }
    acc -= l;
  }
  for (const p of passage) rows.push({ x: p.x, z: p.z, tx: 1, tz: 0, gate: true });

  const flags = [-2.36, 0, 2.36];
  let n = 0;
  let tiles = 0;
  for (const row of rows) {
    n++;
    const yaw = Math.atan2(row.tx, row.tz);
    const nx = row.tz, nz = -row.tx; // across the path
    const tile = !row.gate && n % 6 === 0;
    for (let f = 0; f < 3; f++) {
      if (!tile && rng.chance(0.045)) continue;
      const off = flags[f] + rng.range(-0.08, 0.08);
      const x = row.x + nx * off;
      const z = row.z + nz * off;
      let g = gh(x, z);
      const rr = Math.hypot(x, z);
      if (rr < amph.Rout + 1) g = Math.max(g, amph.floorY - 0.05);
      const w = 2.2 + rng.range(-0.1, 0.05);
      const l = 2.9 + rng.range(-0.15, 0.05);
      K.stone.frame(place(x, g + 0.08 + rng.range(-0.05, 0.04), z, yaw + rng.range(-0.03, 0.03), rng.range(-0.015, 0.015), rng.range(-0.015, 0.015)))
        .setTint(rng.range(0.74, 0.95));
      K.stone.prism(oct(w / 2, l / 2, 0.08), -0.45, oct(w / 2, l / 2, 0.08), 0, { bottom: false });
      if (tile && f === 1) {
        K.glow.frame(place(x, g + 0.1, z, yaw + Math.PI / 4)).setTint(1);
        K.glow.box(0, 0, 0, 1.05, 0.06, 1.05);
        tiles++;
      }
    }
  }
  K.stone.frame(null);
  K.glow.frame(null);
  return { rows: rows.length, tiles };
}

/**
 * Choir stalls: each row of stones stands on a low, broken basalt ribbon following the row's
 * spiral, so from above the band draws dark spiral lines on the plain.
 */
export function buildRibbons(ctx, K, plan, rng) {
  const { gh, rows, b, amph, rMin, rMax, pathDist } = plan;
  const kb = Math.sqrt(1 + b * b);
  let blocks = 0;
  for (const row of rows) {
    let phi = row.phi0;
    while (phi < row.phi1) {
      const r = (amph.Rout + 5) * Math.exp(b * (phi - amph.gate + Math.PI + row.sig));
      const u = Math.min(1, Math.max(0, (r - rMin) / (rMax - rMin)));
      const he = 6 + 88 * Math.pow(1 - u, 2.1);
      const we = 0.14 * he + 1.4;
      const half = 0.21 * we + 2.3;
      const len = 3.4 + 0.012 * r;
      const step = (len + 0.18) / (r * kb);
      const pc = phi + step / 2;
      const x = r * Math.cos(pc), z = r * Math.sin(pc);
      phi += step;
      if (r < amph.Rout + 4 || pathDist(x, z) < half + 4.5) continue;
      if (rng.chance(0.05)) continue;
      // tangent of the spiral at pc
      const tx = b * Math.cos(pc) - Math.sin(pc), tz = b * Math.sin(pc) + Math.cos(pc);
      const yaw = Math.atan2(tx, tz);
      const heave = rng.chance(0.06);
      const g = gh(x, z);
      K.basalt.frame(place(x, g + (heave ? rng.range(0.1, 0.4) : 0), z, yaw + rng.range(-0.02, 0.02),
        heave ? rng.range(-0.1, 0.1) : rng.range(-0.01, 0.01), heave ? rng.range(-0.12, 0.12) : rng.range(-0.01, 0.01)))
        .setTint(rng.range(0.8, 1.05));
      const hw = half * rng.range(0.96, 1.02);
      const ring = [[hw, -len / 2], [hw, len / 2], [-hw, len / 2], [-hw, -len / 2]];
      K.basalt.prism(ring, -0.7, ring, 0.3, { bottom: false });
      blocks++;
    }
  }
  K.basalt.frame(null);
  return blocks;
}
