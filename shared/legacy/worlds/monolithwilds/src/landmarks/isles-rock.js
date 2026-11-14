// Unmoored Isles — the rock bodies.
//
// Each isle is one closed "spindle" grid in (angle, row): a grassy cap (rings from the centre to a
// noisy elliptical rim, gentle mounds, flattened pads for buildings), a fluted cliff band, then an
// inverted mountain underneath — radius (1 - t)^g so it narrows fast under the shoulder and ends
// in a long bent spike, with vertical ribs growing stronger toward the point, secondary
// stalactites hanging off the belly. Strata come from the material (object space).

import * as THREE from 'crownfall-world-three';
import { worldNoise } from '../core/noise.js';
import { toTemplate } from './isles-geo.js';

const TAU = Math.PI * 2;
const sstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Faceted boulder templates (a few noise-displaced icosahedra). */
export const ROCKS = [0, 1, 2, 3].map((k) => {
  const g = new THREE.IcosahedronGeometry(1, 1);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const d = 1 + 0.28 * worldNoise.noise3(x * 1.3 + k * 9.1, y * 1.3 - k * 3.7, z * 1.3 + k * 5.3);
    p.setXYZ(i, x * d, y * d * (y < -0.4 ? 0.7 : 1), z * d);
  }
  g.computeVertexNormals();
  return toTemplate(g);
});

/** Shape functions of one isle (no geometry). Coordinates are root-local (site-relative). */
export function makeShape(spec) {
  const { x: cx, z: cz, top, rx, rz, rot, seed } = spec;
  const NR = 360;
  const rim = new Float32Array(NR);
  for (let i = 0; i < NR; i++) {
    const th = (i / NR) * TAU;
    const a = th - rot;
    const re = 1 / Math.sqrt((Math.cos(a) / rx) ** 2 + (Math.sin(a) / rz) ** 2);
    const c = Math.cos(th), s = Math.sin(th);
    const n = worldNoise.fbm2(c * 1.2 + seed * 7.1, s * 1.2 - seed * 3.3, 4) * 0.16 + worldNoise.fbm2(c * 4.2 + seed, s * 4.2 + seed * 2, 2) * 0.05;
    rim[i] = re * (1 + n);
  }
  const R = (th) => {
    let f = (th / TAU) % 1;
    if (f < 0) f += 1;
    f *= NR;
    const i0 = Math.floor(f), t = f - i0;
    return rim[i0 % NR] * (1 - t) + rim[(i0 + 1) % NR] * t;
  };
  const uAt = (x, z) => {
    const dx = x - cx, dz = z - cz;
    return Math.hypot(dx, dz) / R(Math.atan2(dz, dx));
  };
  const hNat = (x, z) => {
    const dx = x - cx, dz = z - cz;
    const u = uAt(x, z);
    const m = Math.max(0, 1 - u * u);
    let h = top + spec.mound * Math.pow(m, 1.4) * (0.6 + 0.4 * worldNoise.fbm2(dx * 0.012 + seed, dz * 0.012 - seed, 3));
    h += spec.bumps * worldNoise.fbm2(dx * 0.035 + seed * 3, dz * 0.035, 3) * (1 - sstep(0.75, 1, u) * 0.6);
    h -= 2.4 * sstep(0.8, 1.0, u); // rounded shoulder at the rim
    return h;
  };
  const pads = spec.pads || [];
  for (const p of pads) {
    p.ax = cx + p.x;
    p.az = cz + p.z;
    if (p.h == null) p.h = hNat(p.ax, p.az) + (p.dh || 0);
  }
  const topAt = (x, z) => {
    let h = hNat(x, z);
    for (const p of pads) {
      const d = Math.hypot(x - p.ax, z - p.az);
      const k = 1 - sstep(p.r, p.r + (p.blend ?? 10), d);
      if (k > 0) h += (p.h - h) * k;
    }
    return h;
  };
  const reserve = pads.map((p) => ({ x: p.ax, z: p.az, r: p.r + 2 }));
  const free = (x, z, margin = 0, maxU = 0.9) => {
    if (uAt(x, z) > maxU) return false;
    for (const r of reserve) if ((x - r.x) ** 2 + (z - r.z) ** 2 < (r.r + margin) ** 2) return false;
    return true;
  };
  const rimPoint = (th, inset = 0) => {
    const r = R(th) - inset;
    const x = cx + Math.cos(th) * r, z = cz + Math.sin(th) * r;
    return [x, topAt(x, z), z];
  };
  /** Angle of the rim facing a local point. */
  const angleTo = (x, z) => Math.atan2(z - cz, x - cx);
  return { spec, R, uAt, topAt, free, reserve, rimPoint, angleTo, cx, cz, yTip: top - spec.cliff - spec.depth };
}

/**
 * Emit one isle body. Returns an underside sampler for roots / chains / falls.
 * accRock: cliffs + underside + stalactites + boulders; accGrass: the cap.
 */
export function buildIsleBody(shape, accRock, accGrass, rng, q = 1) {
  const s = shape.spec;
  const { cx, cz, R } = shape;
  const NA = Math.max(48, Math.round(s.na * q));
  const NT = s.nt;
  const NC = 6;
  const NU = s.nu;
  const seed = s.seed;
  const n2 = worldNoise.fbm2, n3 = worldNoise.noise3, f3 = worldNoise.fbm3;

  const cosA = new Float32Array(NA), sinA = new Float32Array(NA), RA = new Float32Array(NA);
  for (let i = 0; i < NA; i++) {
    const th = (i / NA) * TAU;
    cosA[i] = Math.cos(th);
    sinA[i] = Math.sin(th);
    RA[i] = R(th);
  }

  // ---------------- grassy cap -------------------------------------------------------------
  {
    const rows = NT + 1; // rings 1..NT + lip
    const nv = 1 + rows * NA;
    const P = new Float32Array(nv * 3), C = new Float32Array(nv * 3);
    const set = (v, x, y, z) => {
      P[v * 3] = x;
      P[v * 3 + 1] = y;
      P[v * 3 + 2] = z;
      const g = n2(x * 0.018 + seed, z * 0.018 - seed, 3);
      const dry = sstep(0.05, 0.55, n2(x * 0.045 + 7.7 + seed, z * 0.045 - 3.1, 2) + shape.uAt(x, z) * 0.35 - 0.2);
      const k = 0.9 + 0.22 * g;
      C[v * 3] = k * (0.92 + 0.3 * dry);
      C[v * 3 + 1] = k * (1.0 + 0.06 * dry);
      C[v * 3 + 2] = k * (0.9 - 0.25 * dry);
    };
    set(0, cx, shape.topAt(cx, cz), cz);
    for (let j = 1; j <= rows; j++) {
      const lip = j === rows;
      const u = lip ? 1.012 : Math.pow(j / NT, 0.9);
      for (let i = 0; i < NA; i++) {
        const r = RA[i] * u;
        const x = cx + cosA[i] * r, z = cz + sinA[i] * r;
        let y = lip ? shape.topAt(cx + cosA[i] * RA[i], cz + sinA[i] * RA[i]) - 1.3 : shape.topAt(x, z);
        set(1 + (j - 1) * NA + i, x, y, z);
      }
    }
    const I = [];
    for (let i = 0; i < NA; i++) I.push(0, 1 + ((i + 1) % NA), 1 + i);
    for (let j = 0; j < rows - 1; j++) {
      const a0 = 1 + j * NA, b0 = a0 + NA;
      for (let i = 0; i < NA; i++) {
        const i1 = (i + 1) % NA;
        I.push(a0 + i, a0 + i1, b0 + i1, a0 + i, b0 + i1, b0 + i);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(P, 3));
    g.setIndex(I);
    g.computeVertexNormals();
    accGrass.raw(P, g.attributes.normal.array, I, C);
  }

  // ---------------- cliffs + inverted mountain ---------------------------------------------------
  const rows = 1 + NC + NU; // rim, cliff rows, underside rows (last underside row -> tip vertex)
  const nv = rows * NA + 1;
  const P = new Float32Array(nv * 3), C = new Float32Array(nv * 3);
  const tipOffX = s.tipOff[0], tipOffZ = s.tipOff[1];
  const yTip = shape.yTip;
  const yRim = new Float32Array(NA), yCB = new Float32Array(NA), gA = new Float32Array(NA);
  for (let i = 0; i < NA; i++) {
    const c = cosA[i], sn = sinA[i];
    yRim[i] = shape.topAt(cx + c * RA[i], cz + sn * RA[i]) - 0.6;
    const ch = s.cliff * (0.7 + 0.6 * (0.5 + 0.5 * n2(c * 1.7 + seed * 2, sn * 1.7 + 4.1, 3)));
    yCB[i] = yRim[i] - ch;
    gA[i] = s.taper * (0.8 + 0.4 * (0.5 + 0.5 * n2(c * 1.4 - seed, sn * 1.4 + seed * 1.3, 3)));
  }
  const put = (v, x, y, z, tint) => {
    P[v * 3] = x;
    P[v * 3 + 1] = y;
    P[v * 3 + 2] = z;
    C[v * 3] = tint[0];
    C[v * 3 + 1] = tint[1];
    C[v * 3 + 2] = tint[2];
  };
  const tint = [1, 1, 1];
  const rockTint = (x, y, z, t) => {
    // warm pale cliffs -> darker, cooler belly; iron-red bands and pale mineral bands
    // sedimentary banding: broad bands + thinner courses, gently warped
    const band = n2(y * 0.045 + seed, (x + z) * 0.004, 2) + 0.35 * Math.sin(y * 0.33 + n2(x * 0.01, z * 0.01, 2) * 4);
    const iron = sstep(0.2, 0.6, band) * (0.35 + 0.65 * t);
    const pale = sstep(0.35, 0.7, -band) * 0.5;
    const k = (1.02 - 0.42 * Math.pow(t, 0.8)) * (0.92 + 0.16 * n3(x * 0.05, y * 0.05, z * 0.05));
    tint[0] = k * (1 + 0.22 * iron + 0.1 * pale);
    tint[1] = k * (0.97 - 0.2 * iron + 0.08 * pale);
    tint[2] = k * (0.92 - 0.34 * iron + 0.06 * pale);
    return tint;
  };
  for (let i = 0; i < NA; i++) {
    const c = cosA[i], sn = sinA[i];
    const flute = (1 - Math.abs(n3(c * s.flutes, sn * s.flutes, seed))) ** 3;
    for (let k = 0; k <= NC; k++) {
      const f = k / NC;
      let r = RA[i] * (1 + 0.012 * Math.sin(f * Math.PI) - 0.02 * f - 0.06 * flute * Math.sin(f * Math.PI * 0.9 + 0.1));
      // irregular ledges where softer strata weathered back
      if (k === 2 || k === 4) r += (0.5 + 0.5 * n2(c * 3.1 + k, sn * 3.1 + seed, 2)) * 1.8 - 0.4;
      const y = k === 0 ? yRim[i] : yRim[i] + (yCB[i] - yRim[i]) * f;
      let x = cx + c * r, z = cz + sn * r;
      const d = (3.2 * f3(x * 0.045, y * 0.05, z * 0.045, 3) + 1.0 * f3(x * 0.16, y * 0.12, z * 0.16, 2)) * (k === 0 ? 0.25 : 1);
      x += c * d;
      z += sn * d;
      put(k * NA + i, x, y, z, rockTint(x, y, z, 0));
    }
    for (let k = 1; k <= NU; k++) {
      const t = k / (NU + 1);
      const rho = Math.pow(1 - t, gA[i]);
      const rib = 1 - Math.abs(n3(c * s.ribF, sn * s.ribF, t * 1.3 + seed));
      const ribs = 1 + s.ribs * (rib * rib - 0.45) * (0.3 + 0.9 * t);
      const bulge = 1 + 0.08 * n3(c * 2.1 + seed, sn * 2.1, t * 3.1) * Math.sin(t * Math.PI);
      const y = yCB[i] + (yTip - yCB[i]) * Math.pow(t, s.drop) + s.depth * 0.05 * n3(c * 1.5, sn * 1.5 + seed, t * 2) * Math.sin(t * Math.PI);
      const ox = cx + tipOffX * t * t, oz = cz + tipOffZ * t * t;
      const r = RA[i] * rho * ribs * bulge;
      let x = ox + c * r, z = oz + sn * r;
      const amp = s.rough * Math.min(1, rho * 5);
      const d = amp * f3(x * 0.03 + seed, y * 0.03, z * 0.03, 4);
      x += c * d;
      z += sn * d;
      put((NC + k) * NA + i, x, y, z, rockTint(x, y, z, t));
    }
  }
  const tipV = rows * NA;
  put(tipV, cx + tipOffX, yTip, cz + tipOffZ, rockTint(cx, yTip, cz, 1));
  const I = [];
  for (let k = 0; k < rows - 1; k++) {
    const a0 = k * NA, b0 = a0 + NA;
    for (let i = 0; i < NA; i++) {
      const i1 = (i + 1) % NA;
      I.push(a0 + i, a0 + i1, b0 + i1, a0 + i, b0 + i1, b0 + i);
    }
  }
  const last = (rows - 1) * NA;
  for (let i = 0; i < NA; i++) I.push(last + i, last + ((i + 1) % NA), tipV);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(P, 3));
  g.setIndex(I);
  g.computeVertexNormals();
  const N = g.attributes.normal.array;
  accRock.raw(P, N, I, C);

  // ---------------- underside sampler --------------------------------------------------------------
  const under = (th, t) => {
    let f = (th / TAU) % 1;
    if (f < 0) f += 1;
    const i = Math.round(f * NA) % NA;
    const k = NC + Math.max(1, Math.min(NU, Math.round(t * (NU + 1))));
    const v = k * NA + i;
    return { x: P[v * 3], y: P[v * 3 + 1], z: P[v * 3 + 2], nx: N[v * 3], ny: N[v * 3 + 1], nz: N[v * 3 + 2], c: cosA[i], s: sinA[i] };
  };
  /** A point on the cliff face (f 0 = rim, 1 = cliff foot). */
  const cliff = (th, f) => {
    let ff = (th / TAU) % 1;
    if (ff < 0) ff += 1;
    const i = Math.round(ff * NA) % NA;
    const k = Math.max(0, Math.min(NC, Math.round(f * NC)));
    const v = k * NA + i;
    return { x: P[v * 3], y: P[v * 3 + 1], z: P[v * 3 + 2], c: cosA[i], s: sinA[i] };
  };

  // ---------------- stalactites off the belly --------------------------------------------------------
  const spikes = [];
  for (let n = 0; n < s.spikes; n++) {
    const th = rng() * TAU;
    const t = 0.18 + rng() * 0.32;
    const p = under(th, t);
    const L = s.depth * (0.22 + rng() * 0.3);
    const r0 = Math.max(4, Math.hypot(p.x - cx, p.z - cz) * (0.22 + rng() * 0.14));
    const px = p.x - p.c * r0 * 0.9, pz = p.z - p.s * r0 * 0.9;
    spikes.push({ x: px, y: p.y - L, z: pz });
    emitSpike(accRock, px, p.y + r0 * 0.4, pz, r0, L, p.c, p.s, seed + n * 3.7, rockTint);
  }

  return { under, cliff, NA, spikes };
}

/** A hanging stalactite (bent cone grid). */
function emitSpike(acc, x0, y0, z0, r0, L, bc, bs, seed, rockTint) {
  const NA = 12, NR = 12;
  const nv = NA * NR + 1;
  const P = new Float32Array(nv * 3), C = new Float32Array(nv * 3);
  for (let k = 0; k < NR; k++) {
    const t = k / NR;
    const rho = Math.pow(1 - t, 1.5);
    const y = y0 - L * t;
    const ox = x0 + bc * L * 0.12 * t * t, oz = z0 + bs * L * 0.12 * t * t;
    for (let i = 0; i < NA; i++) {
      const a = (i / NA) * TAU;
      const c = Math.cos(a), s = Math.sin(a);
      const n = worldNoise.noise3(c * 1.6 + seed, s * 1.6, t * 2.5 + seed);
      const r = r0 * rho * (1 + 0.28 * n);
      const v = k * NA + i;
      P[v * 3] = ox + c * r;
      P[v * 3 + 1] = y + n * r0 * 0.15;
      P[v * 3 + 2] = oz + s * r;
      const tt = rockTint(P[v * 3], y, P[v * 3 + 2], 0.45 + 0.55 * t);
      C[v * 3] = tt[0];
      C[v * 3 + 1] = tt[1];
      C[v * 3 + 2] = tt[2];
    }
  }
  const tip = NA * NR;
  P[tip * 3] = x0 + bc * L * 0.12;
  P[tip * 3 + 1] = y0 - L;
  P[tip * 3 + 2] = z0 + bs * L * 0.12;
  C[tip * 3] = C[tip * 3 + 1] = C[tip * 3 + 2] = 0.55;
  const I = [];
  for (let k = 0; k < NR - 1; k++) {
    for (let i = 0; i < NA; i++) {
      const i1 = (i + 1) % NA;
      const a = k * NA, b = a + NA;
      I.push(a + i, a + i1, b + i1, a + i, b + i1, b + i);
    }
  }
  const lastRow = (NR - 1) * NA;
  for (let i = 0; i < NA; i++) I.push(lastRow + i, lastRow + ((i + 1) % NA), tip);
  // cap the top (hidden inside the belly, but avoids see-through at grazing angles)
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(P, 3));
  g.setIndex(I);
  g.computeVertexNormals();
  acc.raw(P, g.attributes.normal.array, I, C);
}

/** Boulders scattered over a cap. */
export function scatterBoulders(shape, acc, rng, count, sMin, sMax) {
  for (let n = 0, tries = 0; n < count && tries < count * 8; tries++) {
    const th = rng() * TAU;
    const u = Math.sqrt(rng()) * 0.95;
    const r = shape.R(th) * u;
    const x = shape.cx + Math.cos(th) * r, z = shape.cz + Math.sin(th) * r;
    if (!shape.free(x, z, 3, 0.97)) continue;
    const sz = sMin + (sMax - sMin) * Math.pow(rng(), 2.2);
    const y = shape.topAt(x, z) - sz * 0.35;
    acc.put(ROCKS[n % 4], x, y, z, sz, sz * (0.55 + rng() * 0.3), sz * (0.7 + rng() * 0.4), rng() * 0.4, rng() * TAU, rng() * 0.4, 0.85 + rng() * 0.25);
    n++;
  }
}

/** A ring of small rocks around an isle (they are emitted in the ring's own slot). */
export function orbitRocks(acc, cx, cy, cz, rng, count, r0, r1, spreadY, sMin, sMax) {
  for (let n = 0; n < count; n++) {
    const a = (n / count) * TAU + rng() * 0.25;
    const r = r0 + (r1 - r0) * rng();
    const sz = sMin + (sMax - sMin) * Math.pow(rng(), 1.8);
    acc.put(ROCKS[n % 4], cx + Math.cos(a) * r, cy + (rng() - 0.5) * spreadY, cz + Math.sin(a) * r, sz, sz * (0.6 + rng() * 0.5), sz * (0.7 + rng() * 0.5), rng() * TAU, rng() * TAU, rng() * TAU, 0.8 + rng() * 0.3);
    // some carry a crown of turf
    if (rng() < 0.3) {
      // tiny fragments trailing each rock
      acc.put(ROCKS[(n + 1) % 4], cx + Math.cos(a + 0.02) * (r + sz * 1.6), cy + (rng() - 0.5) * spreadY * 0.5, cz + Math.sin(a + 0.02) * (r + sz * 1.6), sz * 0.3, sz * 0.25, sz * 0.3, rng() * 3, rng() * 3, 0, 0.8);
    }
  }
}
