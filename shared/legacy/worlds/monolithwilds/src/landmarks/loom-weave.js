// The Loom of Hours — the unfinished weave.
//
//   * Tapestry: in the four upper-left hour-sectors the warp is gathered into one plane (z = 0,
//     ring-local) and interlaced with horizontal stone slats (weft) in a twill-like brick bond,
//     alternately in front of / behind the warp. Weaving proceeds from the top down (as on a
//     warp-weighted loom); the lower edge is a ragged diagonal where work stopped. The slats
//     carry a woven motif (pale limestone / dark basalt / rows of glowing glyph slats).
//   * The shuttle: a 40 m bronze-and-stone shuttle hangs on the last weft cable just past the
//     ragged edge, as if the weaver let go mid-pass.
//   * The cloth beam: a colossal roller lying half-sunk across the valley floor behind the ring,
//     wound with woven cloth that has partly unrolled toward the ring; gear-toothed end hubs echo
//     the 24 hour-blocks (one hub has broken off).

import * as THREE from 'crownfall-world-three';
import { boxTris, geoTris } from './loom-ring.js';

const COL_SPACING = 2.6;
const X_RIGHT = -61;
const X_LEFT = -205;
const ROW = 2.0; // weft row pitch (slat height 1.8)

function hash1(n) {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

export const WEAVE = {
  xRight: X_RIGHT,
  xLeft: X_LEFT,
  /** Top of the weave (just under the comb) at local x. */
  top(x) {
    return Math.sqrt(Math.max(0, 221 * 221 - x * x)) - 10;
  },
  /** Ragged lower edge (where the weaving stopped). Descends toward the outer side. */
  edge(x) {
    const t = (x - X_RIGHT) / (X_LEFT - X_RIGHT); // 0 at the centre side, 1 outer
    const base = 122 - 150 * t;
    const col = Math.round(x / COL_SPACING);
    const rag = (hash1(col) - 0.5) * 9 + (hash1(Math.floor(col / 3) + 50) - 0.5) * 10;
    return base + rag;
  },
  /** Warp columns carrying the tapestry. */
  columns() {
    const out = [];
    for (let x = X_RIGHT - 1; x > X_LEFT; x -= COL_SPACING) {
      const top = WEAVE.top(x);
      const edge = Math.min(WEAVE.edge(x), top - 6);
      out.push({ x, top, edge });
    }
    return out;
  },
};

/** Motif: 0 pale, 1 dark, 2 glyph. Diamonds (lozenges) inside banded borders. */
function motif(x, y) {
  const band = ((y % 54) + 54) % 54;
  if (band < 2.4) return 2; // one row of glyph slats per band: woven "text"
  if (band < 7.2) return 1;
  if (band > 49) return 1;
  const cx = ((x % 34) + 34) % 34 - 17;
  const cy = band - 28;
  const d = Math.abs(cx) + Math.abs(cy) * 0.9;
  if (d > 9 && d < 13.5) return 1;
  if (d < 3.6) return 1;
  return 0;
}

/**
 * Tapestry + shuttle, ring-local, into the given sinks (stone/basalt/glyph/bronze Tris).
 * Returns { shuttle: {x,y,z}, fallen: [[x,y,z],...] (local points of fallen slats), cols }
 */
export function buildTapestry(rng, sinks) {
  const cols = WEAVE.columns();
  const fallen = [];

  // Weft rows: every row is a continuous zigzag of stone slats — each slat spans one warp
  // interval and crosses from in front of one warp to behind the next (over-under), with
  // alternate rows in opposite phase (a plain weave). Rows stop at the ragged edge.
  const DZ = 0.55;
  const rowsTop = Math.max(...cols.map((c) => c.top));
  const dirV = new THREE.Vector3();
  const up = new THREE.Vector3();
  const side = new THREE.Vector3();
  const basis = new THREE.Matrix4();
  const put2 = (sink, x0, z0, x1, z1, y, tilt, tint) => {
    // slat from (x0, z0) to (x1, z1) at height y (box long axis along the segment)
    dirV.set(x1 - x0, 0, z1 - z0);
    const len = dirV.length();
    dirV.normalize();
    up.set(0, 1, 0).applyAxisAngle(dirV, tilt);
    side.crossVectors(dirV, up);
    basis.makeBasis(dirV, up, side);
    basis.setPosition((x0 + x1) / 2, y, (z0 + z1) / 2);
    boxTris(sink, len + 0.35, 1.8, 0.42, basis, tint);
  };
  for (let r = 0; ; r++) {
    const y = rowsTop - 1.0 - r * ROW;
    if (y < -70) break;
    const phase = r % 2;
    let stray = 0;
    for (let i = 0; i < cols.length - 1; i++) {
      const c0 = cols[i];
      const c1 = cols[i + 1];
      if (y > Math.min(c0.top, c1.top) - 0.9) continue;
      const lowEdge = Math.max(c0.edge, c1.edge);
      const xm = (c0.x + c1.x) / 2;
      const z0 = (i + phase) % 2 === 0 ? DZ : -DZ;
      if (y < lowEdge) {
        // just below the edge: a few loose slats dangle askew, others have fallen
        if (y > lowEdge - ROW * 1.5 && stray < 2) {
          if (rng.chance(0.12)) {
            stray++;
            const drop = rng.range(0.5, 3.5);
            put2(sinks.stone, c0.x, z0 * 2.2, c1.x, -z0 * 2.2, y - drop, rng.range(-0.9, 0.9), [1.05, 1.0, 0.9]);
          } else if (rng.chance(0.15)) fallen.push([xm, y, 0]);
        }
        continue;
      }
      const nearEdge = y - lowEdge < ROW * 2;
      if (nearEdge && rng.chance(0.16)) {
        fallen.push([xm, y, 0]);
        continue;
      }
      const mo = motif(xm, y);
      const sink = mo === 1 ? sinks.basalt : mo === 2 ? sinks.glyph : sinks.stone;
      const v = 0.92 + 0.14 * rng();
      const tint = mo === 0 ? [1.12 * v, 1.06 * v, 0.95 * v] : [v, v, v];
      const sag = nearEdge ? rng.range(-0.5, 0.2) : 0;
      put2(sink, c0.x, z0, c1.x, -z0, y + sag + rng.range(-0.04, 0.04), nearEdge ? rng.range(-0.12, 0.12) : rng.range(-0.02, 0.02), tint);
    }
  }

  // --- the shuttle ---------------------------------------------------------------
  const sh = { x: -30, y: 104, z: 0 };
  {
    const L = 21; // half length (tip to centre)
    const SLOTW = 7; // half width of the open slot holding the pirn
    const halfProfile = [];
    for (let k = 0; k <= 10; k++) {
      const t = k / 10; // 0 at the slot, 1 at the tip
      halfProfile.push(new THREE.Vector2(Math.max(0.05, 4.3 * Math.pow(Math.cos((t * Math.PI) / 2), 0.55)), t * (L - SLOTW)));
    }
    // two stone half-bodies tapering outward, an open slot between them
    for (const sg of [-1, 1]) {
      const g = new THREE.LatheGeometry(halfProfile, 14);
      g.scale(1, 1, 0.78);
      // lathe axis +y (slot -> tip); turn it so the tip points outward along ±x
      g.rotateZ(sg > 0 ? -Math.PI / 2 : Math.PI / 2);
      g.translate(sh.x + sg * SLOTW, sh.y, sh.z);
      geoTris(sinks.stone, g, null, [0.95, 0.9, 0.82]);
      g.dispose();
      // flat end face at the slot
      const cap = new THREE.CircleGeometry(4.3, 14);
      cap.scale(1, 0.78, 1);
      cap.rotateY(sg > 0 ? -Math.PI / 2 : Math.PI / 2);
      cap.translate(sh.x + sg * SLOTW, sh.y, sh.z);
      geoTris(sinks.stone, cap, null, [0.8, 0.76, 0.7]);
      cap.dispose();
      // bronze tip
      const tip = new THREE.ConeGeometry(0.9, 4.5, 10);
      tip.rotateZ(sg > 0 ? -Math.PI / 2 : Math.PI / 2);
      tip.translate(sh.x + sg * (L + 2), sh.y, sh.z);
      geoTris(sinks.bronze, tip, null, [1, 1, 1]);
      tip.dispose();
    }
    // bronze rails joining the halves
    for (const zz of [-2.9, 2.9]) {
      const rail = new THREE.BoxGeometry(18, 1.1, 0.9);
      rail.translate(sh.x, sh.y + 0.4, sh.z + zz);
      geoTris(sinks.bronze, rail, null, [1, 1, 1]);
      rail.dispose();
    }
    // the wound pirn in the slot
    const pirn = new THREE.CylinderGeometry(2.6, 2.6, 13, 16, 1);
    pirn.rotateZ(Math.PI / 2);
    pirn.translate(sh.x, sh.y, sh.z);
    geoTris(sinks.glyph, pirn, null, [0.95, 0.9, 0.85]);
    pirn.dispose();
    const axle = new THREE.CylinderGeometry(0.8, 0.8, 16.5, 8, 1);
    axle.rotateZ(Math.PI / 2);
    axle.translate(sh.x, sh.y, sh.z);
    geoTris(sinks.bronze, axle, null, [1, 1, 1]);
    axle.dispose();
  }

  return { shuttle: sh, fallen, cols };
}

/**
 * The cloth beam, world space. `frame` gives the ring orientation; the beam lies behind the ring,
 * parallel to it, across the valley floor. Returns nothing; writes into sinks.
 */
export function buildClothBeam(ctx, frame, rng, sinks) {
  const yaw = frame.yaw;
  const ax = [Math.cos(yaw), 0, -Math.sin(yaw)]; // beam axis (ring-local x)
  const nz = [Math.sin(yaw), 0, Math.cos(yaw)]; // toward the ring front
  const back = 250;
  const cxw = frame.cx - nz[0] * back + ax[0] * 20;
  const czw = frame.cz - nz[2] * back + ax[2] * 20;
  const HALF = 150;
  const R = 13;
  const at = (s, n = 0) => [cxw + ax[0] * s + nz[0] * n, czw + ax[2] * s + nz[2] * n];
  const gA = ctx.heightAt(...at(-HALF));
  const gB = ctx.heightAt(...at(HALF));
  const gM = ctx.heightAt(...at(0));
  // lie on the ground, sunk by ~45 % of the radius; tilt to follow the two ends
  const yA = Math.max(gA, gM - 6) + R * 0.55;
  const yB = Math.max(gB, gM - 6) + R * 0.55;
  const A = new THREE.Vector3(at(-HALF)[0], yA, at(-HALF)[1]);
  const B = new THREE.Vector3(at(HALF)[0], yB, at(HALF)[1]);
  const dir = B.clone().sub(A);
  const len = dir.length();
  dir.normalize();
  const mid = A.clone().add(B).multiplyScalar(0.5);
  const qAlign = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
  const roll = new THREE.Quaternion().setFromAxisAngle(dir, 0.3);
  // The roller has snapped: beyond BRK the second half is kinked, slid toward the ring and sunk.
  const BRK = 28;
  const pivot = mid.clone().addScaledVector(dir, BRK);
  const kink = new THREE.Matrix4()
    .makeTranslation(pivot.x + nz[0] * 9, pivot.y - 3.5, pivot.z + nz[2] * 9)
    .multiply(new THREE.Matrix4().makeRotationY(0.22))
    .multiply(new THREE.Matrix4().makeRotationAxis(new THREE.Vector3(nz[0], 0, nz[2]), -0.05))
    .multiply(new THREE.Matrix4().makeTranslation(-pivot.x, -pivot.y, -pivot.z));
  const mAt = (s, extraRot = 0) => {
    const q = qAlign.clone();
    if (extraRot) q.premultiply(new THREE.Quaternion().setFromAxisAngle(dir, extraRot));
    q.premultiply(roll);
    const p = mid.clone().addScaledVector(dir, s);
    const m = new THREE.Matrix4().compose(p, q, new THREE.Vector3(1, 1, 1));
    return s > BRK ? m.premultiply(kink) : m;
  };

  // core roller with carved collars
  {
    // two halves of the core, each with a jagged broken end at the snap
    const la = BRK - 1.2 + len / 2;
    const lb = len / 2 - BRK - 1.2;
    const ga = new THREE.CylinderGeometry(R, R, la, 40, 1, false);
    geoTris(sinks.stone, ga, mAt(-len / 2 + la / 2), [0.92, 0.88, 0.8]);
    const gb = new THREE.CylinderGeometry(R, R, lb, 40, 1, false);
    geoTris(sinks.stone, gb, mAt(len / 2 - lb / 2), [0.92, 0.88, 0.8]);
    ga.dispose();
    gb.dispose();
    for (const [s0, sg] of [[BRK - 1.2, 1], [BRK + 1.2, -1]]) {
      for (let k = 0; k < 9; k++) {
        const a = rng.range(0, Math.PI * 2);
        const rr = rng.range(2, R - 2.5);
        const sz = rng.range(2.5, 5.5);
        const m = mAt(s0 + sg * sz * 0.3).multiply(
          new THREE.Matrix4().compose(
            new THREE.Vector3(Math.cos(a) * rr, 0, Math.sin(a) * rr),
            new THREE.Quaternion().setFromEuler(new THREE.Euler(rng() * 0.5, rng() * 3, rng() * 0.5)),
            new THREE.Vector3(sz, sz * rng.range(0.8, 1.6), sz),
          ),
        );
        boxTris(sinks.stone, 1, 1, 1, m, [0.85, 0.82, 0.76]);
      }
    }
    // spilled slats around the break
    for (let k = 0; k < 40; k++) {
      const p = at(BRK + rng.range(-18, 22), rng.range(-26, 26));
      const gy = ctx.heightAt(p[0], p[1]);
      const m = new THREE.Matrix4().compose(
        new THREE.Vector3(p[0], gy + 0.4, p[1]),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(rng.range(-0.4, 0.4), rng.range(0, 6.3), rng.range(-0.4, 0.4))),
        new THREE.Vector3(1, 1, 1),
      );
      boxTris(rng.chance(0.4) ? sinks.basalt : sinks.stone, 7.2, 0.5, 1.85, m, [0.95, 0.92, 0.85]);
    }
    for (let s = -len / 2 + 6; s < len / 2 - 4; s += 11) {
      if (Math.abs(s - BRK) < 3) continue;
      const c = new THREE.CylinderGeometry(R + 0.9, R + 0.9, 2.2, 40, 1, true);
      geoTris(sinks.basalt, c, mAt(s), [0.9, 0.9, 0.9]);
      c.dispose();
    }
  }
  // wound cloth: rows of slats wrapped around the roller (the same weave as the tapestry),
  // three layers deep, slightly loose and irregular; the motif shows as bands along the beam
  const clothHalf = 88;
  {
    const NS = 26;
    const up = new THREE.Vector3();
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    for (let s2 = -clothHalf, r = 0; s2 < clothHalf; s2 += ROW, r++) {
      if (Math.abs(s2 - BRK) < 2.4) continue;
      const rr = R + 2.2 + 0.25 * Math.sin(r * 0.7) + rng.range(-0.15, 0.15);
      const a0 = (r % 2) * (Math.PI / NS) + rng.range(-0.02, 0.02);
      for (let k = 0; k < NS; k++) {
        const ang = a0 + (k / NS) * Math.PI * 2;
        const mo = motif(k * 7.3, s2 * 1.2 + 30);
        const sink = mo === 1 ? sinks.basalt : mo === 2 ? sinks.glyph : sinks.stone;
        // local frame: beam axis = y (mAt aligns +y with the beam); slat tangent to the roll
        up.set(Math.cos(ang), 0, Math.sin(ang));
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -ang);
        m4.compose(up.multiplyScalar(rr), q, new THREE.Vector3(1, 1, 1));
        m4.premultiply(mAt(s2));
        boxTris(sink, 0.9, 2.0, ((Math.PI * 2 * rr) / NS) * 0.97, m4, mo === 0 ? [1.08, 1.02, 0.92] : [0.95, 0.95, 0.95]);
      }
    }
  }
  // end hubs: gear-toothed discs (24 teeth) — one still on the axle, one broken off nearby
  const hub = (m4, sink) => {
    const disc = new THREE.CylinderGeometry(25, 25, 5, 48, 1);
    geoTris(sink, disc, m4, [0.95, 0.95, 0.95]);
    disc.dispose();
    const boss = new THREE.CylinderGeometry(9, 11, 9, 24, 1);
    geoTris(sinks.bronze, boss, m4, [1, 1, 1]);
    boss.dispose();
    for (let k = 0; k < 24; k++) {
      const a = (k / 24) * Math.PI * 2;
      const tm = new THREE.Matrix4().makeRotationY(a).multiply(new THREE.Matrix4().makeTranslation(28, 0, 0));
      const tooth = new THREE.BoxGeometry(7, 4.2, 5);
      tooth.applyMatrix4(tm);
      geoTris(sink, tooth, m4, [0.9, 0.9, 0.9]);
      tooth.dispose();
    }
  };
  hub(mAt(-len / 2 - 1.5), sinks.glyph);
  {
    // the broken-off hub lies flat on the valley floor beyond the other end
    const p = at(HALF + 58, 22);
    const gy = ctx.heightAt(p[0], p[1]);
    const m4 = new THREE.Matrix4().compose(
      new THREE.Vector3(p[0], gy + 0.6, p[1]),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0.09, 0.4, -0.06)),
      new THREE.Vector3(1, 1, 1),
    );
    hub(m4, sinks.glyph);
    // the bare axle stub where it broke
    const stub = new THREE.CylinderGeometry(7.5, 7.5, 7, 20, 1);
    geoTris(sinks.bronze, stub, mAt(len / 2 + 3), [1, 1, 1]);
    stub.dispose();
  }

  // unrolled cloth lying on the ground toward the ring: rows of slats following the terrain
  {
    const rows = 46;
    const width = 150;
    const up = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const m4 = new THREE.Matrix4();
    const axis = new THREE.Vector3(ax[0], 0, ax[2]);
    const basis = new THREE.Matrix4();
    const zAxis = new THREE.Vector3();
    const xAxis = new THREE.Vector3();
    for (let r = 0; r < rows; r++) {
      const n = R + 6 + r * 2.5;
      // ragged far end
      const reach = rows - 6 + Math.floor(rng.range(0, 7));
      for (let s = -width / 2 + (r % 2) * 2.6; s < width / 2; s += 5.2) {
        if (r > reach && rng.chance(0.7)) continue;
        const edge = Math.abs(s) > width / 2 - 8 || r > rows - 8;
        if (edge && rng.chance(0.3)) continue;
        const p = at(s, n);
        const gy = ctx.heightAt(p[0], p[1]);
        const nrm = ctx.normalAt(p[0], p[1]);
        up.set(nrm.x, nrm.y, nrm.z);
        xAxis.copy(axis).addScaledVector(up, -axis.dot(up)).normalize();
        zAxis.crossVectors(xAxis, up).normalize();
        basis.makeBasis(xAxis, up, zAxis);
        q.setFromRotationMatrix(basis);
        const jitter = edge ? rng.range(-0.35, 0.35) : rng.range(-0.03, 0.03);
        q.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(rng.range(-0.02, 0.02), jitter, rng.range(-0.02, 0.02))));
        m4.compose(new THREE.Vector3(p[0], gy + 0.25, p[1]), q, new THREE.Vector3(1, 1, 1));
        const mo = motif(s * 1.3, r * 2.4 + 20);
        const sink = mo === 1 ? sinks.basalt : mo === 2 ? sinks.glyph : sinks.stone;
        boxTris(sink, 4.9, 0.8, 2.1, m4, mo === 0 ? [1.0, 0.95, 0.86] : [0.95, 0.95, 0.95]);
      }
    }
  }
  return { mid, dir, len };
}
