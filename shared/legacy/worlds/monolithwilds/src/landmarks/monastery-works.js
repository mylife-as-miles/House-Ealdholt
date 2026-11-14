// Honeycomb Cloister — the built works around the cells: the socle and its walk, the portal with
// its telescoping hexagonal frames and bronze doors, the flanking hex towers, the grand stair and
// forecourt, the stair ribbons that trace the great hexagon and zig-zag up the wings, the
// cantilevered prayer platforms, fallen cells, scree and hanging vines.
//
// Everything here is merged by material into Acc accumulators (see monastery-geo.js).

import * as THREE from 'crownfall-world-three';
import { SQ3, toTemplate, T_BOX, mtx, hexCorners, hexPrismXY, rawGeometry } from './monastery-geo.js';

const _m = new THREE.Matrix4();
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();

// ---------------------------------------------------------------------------
// templates
// ---------------------------------------------------------------------------

/** Vertical hexagonal prism (flat-top in plan when rot = 0), radius 1, y in [0, 1], capped. */
function hexColumnGeo(capTop = true) {
  const g = new THREE.CylinderGeometry(1, 1, 1, 6, 1, !capTop);
  g.translate(0, 0.5, 0);
  return g.toNonIndexed();
}
const T_HEXCOL = toTemplate(hexColumnGeo(true));
/** Hex frustum: radius 1 at y=0 to k at y=1. */
function hexFrustum(k) {
  const g = new THREE.CylinderGeometry(k, 1, 1, 6, 1, false);
  g.translate(0, 0.5, 0);
  return toTemplate(g.toNonIndexed());
}
const T_HEXCONE = hexFrustum(0.02);
const T_HEXTAPER = hexFrustum(0.72);
/** Fallen cell: hexagonal prism along z with both caps, pointy-top, radius 1, z in [-1, 0]. */
const T_CELLPRISM = toTemplate(hexPrismXY(true, true).toNonIndexed());
/** Corbel wedge: box x[-0.5,0.5], y[-1,0], z[0,1] with the lower front edge pulled back. */
const T_CORBEL = (() => {
  const g = new THREE.BoxGeometry(1, 1, 1);
  g.translate(0, -0.5, 0.5);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) if (p.getY(i) < -0.5 && p.getZ(i) > 0.5) p.setZ(i, 0.12);
  return toTemplate(g.toNonIndexed());
})();
/** Tapered beam: x[-0.5,0.5], y[-1,0] at z=0 shrinking to y[-0.35,0] at z=1 (cantilever). */
const T_BEAM = (() => {
  const g = new THREE.BoxGeometry(1, 1, 1);
  g.translate(0, -0.5, 0.5);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    if (p.getZ(i) > 0.5) {
      p.setY(i, p.getY(i) * 0.35);
      p.setX(i, p.getX(i) * 0.8);
    }
  }
  return toTemplate(g.toNonIndexed());
})();
const T_ICO = (() => {
  const g = new THREE.IcosahedronGeometry(1, 1);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = 0.78 + 0.34 * Math.abs(Math.sin(x * 5.1 + y * 3.7) * Math.cos(z * 4.3 - x * 2.1));
    p.setXYZ(i, x * k, y * k * 0.8, z * k);
  }
  g.computeVertexNormals();
  return toTemplate(g);
})();

// ---------------------------------------------------------------------------
// face frame helpers
// ---------------------------------------------------------------------------

/** World point at face coords (x, y), `d` metres out from the reference sheet. */
export function facePoint(face, x, y, d, out = new THREE.Vector3()) {
  const yaw = face.yaw(x);
  return out.set(x + d * Math.sin(yaw), y, face.zBase(x, y) + d * Math.cos(yaw));
}

/** Box with an explicit basis: centre c, axis X (unit), Y, Z; sizes. */
function basisBox(A, t, c, X, Y, Z, sx, sy, sz, tint) {
  _m.makeBasis(X, Y, Z);
  _m.scale(_v3.set(sx, sy, sz));
  _m.setPosition(c);
  A.put(t, _m, tint);
}

// ---------------------------------------------------------------------------
// stairs
// ---------------------------------------------------------------------------

/**
 * One straight flight on the face from a = [x, y] (bottom) to b (top). The tread line sits
 * `d0` out from the sheet (against the flush cells); treads `width` deep. Tall step blocks overlap
 * so the underside reads as an inverted stair; a sloped parapet on the outer edge; corbels.
 */
function stairFlight(ctx, W, face, a, b, o) {
  const { width = 5.2, d0 = 0.45, rise = 0.32, tint = 1, lampEvery = 0 } = o;
  const dy = b[1] - a[1];
  const n = Math.max(1, Math.round(Math.abs(dy) / rise));
  const H = 3.2;
  const dx = (b[0] - a[0]) / n;
  const stepRise = dy / n;
  const run = Math.abs(dx);
  for (let k = 0; k < n; k++) {
    const x = a[0] + dx * (k + 0.5);
    const yTop = a[1] + stepRise * (k + 1);
    const yaw = face.yaw(x);
    facePoint(face, x, yTop - H / 2, d0 + width / 2, _v1);
    W.stone.put(T_BOX, mtx(_v1.x, _v1.y, _v1.z, yaw, 0, 0, run * 1.04 + 0.02, H, width), tint * (0.92 + 0.12 * ((k * 7) % 5) / 5));
  }
  // parapet + corbels in ~8 m chunks
  const len = Math.hypot(b[0] - a[0], dy);
  const chunks = Math.max(1, Math.round(len / 8));
  for (let c = 0; c < chunks; c++) {
    const t0 = c / chunks, t1 = (c + 1) / chunks;
    const xa = a[0] + (b[0] - a[0]) * t0, ya = a[1] + dy * t0;
    const xb = a[0] + (b[0] - a[0]) * t1, yb = a[1] + dy * t1;
    const pa = facePoint(face, xa, ya + 0.55 + stepRise * 0.5, d0 + width - 0.25, new THREE.Vector3());
    const pb = facePoint(face, xb, yb + 0.55 + stepRise * 0.5, d0 + width - 0.25, new THREE.Vector3());
    const X = _v2.subVectors(pb, pa);
    const L = X.length();
    X.normalize();
    const yaw = face.yaw((xa + xb) / 2);
    const Z = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    const Y = new THREE.Vector3().crossVectors(Z, X).normalize();
    const cpos = pa.clone().add(pb).multiplyScalar(0.5);
    basisBox(W.stone, T_BOX, cpos, X, Y, Z, L + 0.1, 1.1, 0.5, 0.95 * tint);
    // corbel under the outer edge
    const xm = (xa + xb) / 2, ym = (ya + yb) / 2;
    facePoint(face, xm, ym - H + 0.1, d0 - 0.3, _v1);
    W.stone.put(T_CORBEL, mtx(_v1.x, _v1.y, _v1.z, yaw, 0, 0, 1.3, 4.5, width + 0.3), 0.85 * tint);
    if (lampEvery && c % lampEvery === lampEvery - 1) {
      facePoint(face, xm, ym + 1.6 + stepRise, d0 + width - 0.25, _v1);
      W.lights.push({ x: _v1.x, y: _v1.y, z: _v1.z, size: 3.2, b: 0.9 });
      W.bronze.put(T_BOX, mtx(_v1.x, _v1.y + 0.55, _v1.z, yaw, 0, 0, 0.7, 0.18, 0.7), 1);
      W.glow.put(T_BOX, mtx(_v1.x, _v1.y, _v1.z, yaw + 0.78, 0, 0, 0.42, 0.8, 0.42), 1);
    }
  }
  return n;
}

/** Landing: a slab on the face at (x, y) (top), `w` along the face, with a parapet and a lamp. */
function landing(ctx, W, face, x, y, w, o) {
  const { width = 5.2, d0 = 0.45, depthExtra = 1.6 } = o;
  const yaw = face.yaw(x);
  const D = width + depthExtra;
  facePoint(face, x, y - 1.6, d0 + D / 2, _v1);
  W.stone.put(T_BOX, mtx(_v1.x, _v1.y, _v1.z, yaw, 0, 0, w, 3.2, D), 0.97);
  // parapet on the outer edge and the two ends
  facePoint(face, x, y + 0.55, d0 + D - 0.25, _v1);
  W.stone.put(T_BOX, mtx(_v1.x, _v1.y, _v1.z, yaw, 0, 0, w, 1.1, 0.5), 0.95);
  // big corbel below
  facePoint(face, x, y - 3.1, d0 - 0.3, _v1);
  W.stone.put(T_CORBEL, mtx(_v1.x, _v1.y, _v1.z, yaw, 0, 0, w * 0.7, 7, D + 0.3), 0.85);
  // lantern on a short post at the outer corner
  facePoint(face, x, y + 1.9, d0 + D - 0.3, _v1);
  W.bronze.put(T_BOX, mtx(_v1.x, _v1.y - 1.1, _v1.z, yaw, 0, 0, 0.3, 1.4, 0.3), 1);
  W.bronze.put(T_BOX, mtx(_v1.x, _v1.y + 0.55, _v1.z, yaw, 0, 0, 0.8, 0.2, 0.8), 1);
  W.glow.put(T_BOX, mtx(_v1.x, _v1.y, _v1.z, yaw + 0.78, 0, 0, 0.5, 0.9, 0.5), 1);
  W.lights.push({ x: _v1.x, y: _v1.y, z: _v1.z, size: 4.5, b: 1.1 });
}

/** A polyline stair: flights between consecutive points with landings at the turns. */
export function stairRibbon(ctx, W, face, pts, o = {}) {
  let steps = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    let a = pts[i], b = pts[i + 1];
    const up = b[1] >= a[1];
    if (!up) [a, b] = [b, a];
    // trim the flight ends so they meet the landings
    const dirx = Math.sign(b[0] - a[0]) || 1;
    const trim = i > 0 || o.landingAtStart ? 3.2 : 0;
    const trimB = i < pts.length - 2 || o.landingAtEnd ? 3.2 : 0;
    const slope = (b[1] - a[1]) / Math.max(1e-3, Math.abs(b[0] - a[0]));
    const aa = up ? [a[0] + dirx * trim, a[1] + slope * trim] : [a[0] + dirx * trimB, a[1] + slope * trimB];
    const bb = up ? [b[0] - dirx * trimB, b[1] - slope * trimB] : [b[0] - dirx * trim, b[1] - slope * trim];
    steps += stairFlight(ctx, W, face, aa, bb, { ...o, lampEvery: o.lampEvery ?? 3 });
  }
  for (let i = o.landingAtStart ? 0 : 1; i < pts.length - (o.landingAtEnd ? 0 : 1); i++) {
    landing(ctx, W, face, pts[i][0], pts[i][1], 7.5, o);
  }
  return steps;
}

// ---------------------------------------------------------------------------
// the socle (base wall), its walk and buttresses
// ---------------------------------------------------------------------------

export function buildSocle(ctx, W, face, P) {
  const { ySocle, socleD, xs0, xs1 } = P;
  const seg = 6;
  const rng = ctx.noise.createRng('monastery-socle');
  for (let x = xs0; x < xs1; x += seg) {
    const xm = x + seg / 2;
    // skip where a waterfall channel breaks through the wall
    if (P.inChannel(xm, ySocle - 5, 2)) continue;
    const yaw = face.yaw(xm);
    const zFront = face.zBase(xm, ySocle) + socleD;
    const back = face.footAt(xm) - 6;
    const g = Math.min(ctx.heightAt(xm - 3, zFront), ctx.heightAt(xm + 3, zFront), ctx.heightAt(xm, zFront + 4));
    const bottom = g - 5;
    // ruined ends: the wall steps down toward the ends of the colony
    const endT = Math.min(xm - xs0, xs1 - xm);
    const topY = ySocle - Math.max(0, 22 - endT) * 1.1 - (endT < 22 ? rng() * 3 : 0);
    const D = zFront - back;
    // upper wall
    const cx = xm + Math.sin(yaw) * (-D / 2), cz = zFront - Math.cos(yaw) * (D / 2);
    const hU = topY - (ySocle - 14);
    if (hU > 0.5) W.stone.put(T_BOX, mtx(cx, ySocle - 14 + hU / 2, cz, yaw, 0, 0, seg + 0.05, hU, D), 0.96 + 0.08 * rng());
    // battered lower wall (steps out 2.4 m)
    const zl = zFront + 2.4;
    const cxl = xm + Math.sin(yaw) * (-(zl - back) / 2 + 2.4), czl = zl - Math.cos(yaw) * ((zl - back) / 2);
    const hL = Math.min(topY, ySocle - 14) - bottom;
    if (hL > 0) W.stone.put(T_BOX, mtx(cxl, bottom + hL / 2, czl, yaw, 0, 0, seg + 0.05, hL, zl - back), 0.9 + 0.08 * rng());
    // sloped weathering course between the two
    facePoint(face, xm, ySocle - 14, socleD + 1.2, _v1);
    W.stone.put(T_BOX, mtx(_v1.x, _v1.y, _v1.z, yaw, -0.5, 0, seg + 0.05, 1.2, 3.2), 0.85);
    if (topY > ySocle - 0.5) {
      // cornice with the glyph band and the walk's parapet
      facePoint(face, xm, ySocle - 2.2, socleD + 0.3, _v1);
      W.glyph.put(T_BOX, mtx(_v1.x, _v1.y, _v1.z, yaw, 0, 0, seg + 0.05, 2.6, 1.4), 1);
      facePoint(face, xm, ySocle - 0.45, socleD + 0.9, _v1);
      W.stone.put(T_BOX, mtx(_v1.x, _v1.y, _v1.z, yaw, 0, 0, seg + 0.05, 0.9, 1.8), 1.02);
      if (!P.inPortal(xm)) {
        facePoint(face, xm, ySocle + 0.6, socleD - 0.3, _v1);
        W.stone.put(T_BOX, mtx(_v1.x, _v1.y, _v1.z, yaw, 0, 0, seg * 0.8, 1.2, 0.55), 0.98);
      }
    }
  }
  // buttresses: stepped piers every ~30 m
  for (let x = xs0 + 18; x < xs1 - 10; x += 30) {
    if (P.inPortal(x) || P.inChannel(x, ySocle - 5, 8)) continue;
    const yaw = face.yaw(x);
    const zFront = face.zBase(x, ySocle) + socleD + 2.4;
    const g = ctx.heightAt(x, zFront + 3) - 4;
    const tiers = [[0, 5.5, 4.2], [0.45, 3.8, 3.4], [0.75, 2.2, 2.6]];
    for (const [f, dOut, wid] of tiers) {
      const y0 = g + (ySocle - 6 - g) * f;
      const h = (ySocle - 6 - g) * (f === 0.75 ? 0.25 : f === 0.45 ? 0.3 : 0.45) + 0.2;
      facePoint(face, x, y0 + h / 2, socleD + 2.4 + dOut / 2 - 0.5, _v1);
      W.stone.put(T_BOX, mtx(_v1.x, _v1.y, _v1.z, yaw, 0, 0, wid, h, dOut + 1), 0.93);
    }
  }
}

// ---------------------------------------------------------------------------
// the portal
// ---------------------------------------------------------------------------

/** Outline of a hexagonal arch: half-width w, jamb height h, apex a, bottom b. CCW. */
function hexArch(w, h, a, b = 0) {
  return [[-w, b], [w, b], [w, h], [0, a], [-w, h]];
}

function extrudeBand(outer, hole, depth) {
  const shape = new THREE.Shape(outer.map(([x, y]) => new THREE.Vector2(x, y)));
  shape.holes.push(new THREE.Path(hole.slice().reverse().map(([x, y]) => new THREE.Vector2(x, y))));
  return new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 1 });
}

export function buildPortal(ctx, W, face, P) {
  const { xc, ySocle, socleD, portal } = P;
  const yaw = face.yaw(xc);
  const zS = face.zBase(xc, ySocle) + socleD; // socle front at the axis
  // local frame: origin on the threshold at the socle front, +z out of the cliff
  const origin = new THREE.Vector3(xc, ySocle, zS);
  const base = new THREE.Matrix4().makeRotationY(yaw).setPosition(origin);
  const L = (x, y, z, ry = 0, sx = 1, sy = 1, sz = 1, rx = 0) => mtx(x, y, z, ry, rx, 0, sx, sy, sz, new THREE.Matrix4()).premultiply(base);

  const K = portal.frames;
  const zDoor = portal.zDoor; // local z of the doors (negative = inside the socle line)
  const outlines = [];
  for (let k = 0; k <= K; k++) outlines.push(hexArch(portal.w0 + portal.dw * k, portal.h0 + portal.dh * k, portal.a0 + portal.da * k, k === 0 ? 0 : -4));
  for (let k = 0; k < K; k++) {
    const zFront = zDoor + portal.step * (k + 1);
    const depth = zFront - (zDoor - 2);
    const g = extrudeBand(outlines[k + 1], outlines[k], depth);
    const t = toTemplate(g);
    const acc = k % 2 === 1 ? W.glyph : W.stone;
    acc.put(t, L(0, 0, zDoor - 2), k % 2 === 1 ? 1 : 0.98 + 0.03 * k);
    // a thin projecting lip on the front edge of each frame's opening (catches the light)
    const o = outlines[k];
    for (let s = 0; s < o.length; s++) {
      if (s === 0) continue; // not along the threshold
      const [ax, ay] = o[s], [bx, by] = o[(s + 1) % o.length];
      const mx = (ax + bx) / 2, my = (ay + by) / 2;
      const len = Math.hypot(bx - ax, by - ay);
      const ang = Math.atan2(by - ay, bx - ax);
      const lip = new THREE.Matrix4().makeRotationZ(ang).scale(_v3.set(len + 0.6, 0.7, 0.9));
      lip.setPosition(mx, my, zFront + 0.2);
      acc.put(T_BOX, lip.premultiply(base), 1.05);
    }
  }
  // threshold slab inside the portal
  W.stone.put(T_BOX, L(0, -0.6, zDoor + (portal.step * K) / 2, 0, (portal.w0 + portal.dw * K) * 2, 1.2, portal.step * K + 2), 1.0);

  // bronze doors: two leaves filling the inner hex arch, studded with hexagonal bosses
  const w0 = portal.w0, h0 = portal.h0, a0 = portal.a0;
  for (const side of [-1, 1]) {
    const gap = 0.35;
    const pts = side < 0
      ? [[-w0, 0], [-gap, 0], [-gap, a0 - (gap * (a0 - h0)) / w0], [-w0, h0]]
      : [[gap, 0], [w0, 0], [w0, h0], [gap, a0 - (gap * (a0 - h0)) / w0]];
    const shape = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
    const g = new THREE.ExtrudeGeometry(shape, { depth: 1.2, bevelEnabled: false });
    W.bronze.put(toTemplate(g), L(0, 0, zDoor - 1.0), 1);
    // bosses
    for (let r = 0; r < 12; r++) {
      const y = 2.5 + r * 3.6;
      for (let c = 0; c < 3; c++) {
        const x = side * (gap + 1.9 + c * 3.2 + (r % 2) * 1.6);
        const maxY = Math.abs(x) < w0 ? h0 + ((w0 - Math.abs(x)) / w0) * (a0 - h0) : 0;
        if (Math.abs(x) > w0 - 1.2 || y > maxY - 2) continue;
        W.bronze.put(T_HEXCOL, L(x, y, zDoor + 0.2, 0, 1.05, 0.55, 1.05, Math.PI / 2), 0.9);
      }
    }
    // great ring handle
    const ring = new THREE.TorusGeometry(1.6, 0.28, 6, 16).toNonIndexed();
    W.bronze.put(toTemplate(ring), L(side * 2.6, 13, zDoor + 0.55), 1.1);
  }
  // light leaking through the crack between the leaves (and under the doors)
  W.glow.put(T_BOX, L(0, a0 * 0.45, zDoor - 1.3, 0, 0.66, a0 * 0.9, 0.2), 0.8);
  W.lights.push({ x: origin.x + Math.sin(yaw) * (zDoor + 1), y: ySocle + 4, z: origin.z + Math.cos(yaw) * (zDoor + 1), size: 9, b: 0.8 });

  // flanking towers: stacked hexagonal drums with cornices, lantern crowns and spires
  const towerX = portal.w0 + portal.dw * K + portal.towerGap;
  for (const side of [-1, 1]) {
    const tx = xc + side * towerX * Math.cos(yaw);
    const tzw = face.zBase(tx, ySocle) + socleD + 6;
    const lx = side * towerX;
    const lz = tzw - zS + 0; // approx local z
    const g0 = ctx.heightAt(tx, tzw) - 3;
    let y = g0 - ySocle;
    const drums = [[10.5, 44], [9.2, 38], [7.8, 30], [6.4, 20], [5.0, 12]];
    for (let d = 0; d < drums.length; d++) {
      const [r, h] = drums[d];
      const hh = d === 0 ? ySocle - g0 + 6 + h * 0.3 : h;
      W.stone.put(T_HEXCOL, L(lx, y, lz, Math.PI / 6, r, hh, r), 0.97 - d * 0.02);
      // cornice
      W.glyph.put(T_HEXCOL, L(lx, y + hh - 1.8, lz, Math.PI / 6, r + 0.8, 1.8, r + 0.8), 1);
      // lantern niches on the drum faces (glow, front three faces)
      if (d >= 1 && d <= 3) {
        for (const fa of [-1, 0, 1]) {
          const ang = fa * (Math.PI / 3);
          const ap = r * Math.cos(Math.PI / 6) + 0.05;
          const nx = Math.sin(ang), nz = Math.cos(ang);
          W.glow.put(T_BOX, L(lx + nx * ap, y + hh * 0.5, lz + nz * ap, ang, 1.4, 3.2, 0.2), 0.7);
          const wp = new THREE.Vector3(lx + nx * (ap + 0.5), y + hh * 0.5, lz + nz * (ap + 0.5)).applyMatrix4(base);
          W.lights.push({ x: wp.x, y: wp.y, z: wp.z, size: 3.5, b: 0.7 });
        }
      }
      y += hh;
    }
    W.bronze.put(T_HEXCONE, L(lx, y, lz, Math.PI / 6, 4.2, 26, 4.2), 1);
    W.bronze.put(T_HEXCOL, L(lx, y + 25, lz, 0, 0.5, 6, 0.5), 1);
  }
  return { origin, yaw, zS };
}

// ---------------------------------------------------------------------------
// terrace, grand stair and forecourt
// ---------------------------------------------------------------------------

export function buildApproach(ctx, W, face, P, portalInfo) {
  const { xc, ySocle } = P;
  const { origin, yaw } = portalInfo;
  const base = new THREE.Matrix4().makeRotationY(yaw).setPosition(origin);
  const L = (x, y, z, ry = 0, sx = 1, sy = 1, sz = 1) => mtx(x, y, z, ry, 0, 0, sx, sy, sz, new THREE.Matrix4()).premultiply(base);
  const toW = (lx, lz) => new THREE.Vector3(lx, 0, lz).applyMatrix4(base);
  const gAt = (lx, lz) => {
    const p = toW(lx, lz);
    return ctx.heightAt(p.x, p.z) - ySocle;
  };
  const rng = ctx.noise.createRng('monastery-approach');

  // terrace in front of the portal (local y = 0 is the threshold)
  const tW = 44, tD = P.terraceD;
  const gT = Math.min(gAt(-tW / 2, tD), gAt(tW / 2, tD), gAt(0, tD / 2)) - 4;
  W.stone.put(T_BOX, L(0, gT / 2, tD / 2 - 2, 0, tW * 2, -gT, tD + 4), 0.95);
  W.glyph.put(T_BOX, L(0, -1.6, tD - 1.2, 0, tW * 2 + 0.6, 2.2, 1.6), 1);
  for (const s of [-1, 1]) {
    // parapet sides of the terrace + lamps
    W.stone.put(T_BOX, L(s * (tW - 0.4), 0.6, tD / 2 - 1, 0, 0.8, 1.2, tD - 2), 1);
    for (const lz of [6, tD - 3]) {
      const lamp = toW(s * (tW - 3), lz);
      W.bronze.put(T_HEXCOL, L(s * (tW - 3), 0, lz, 0, 0.35, 4.2, 0.35), 1);
      W.glow.put(T_BOX, L(s * (tW - 3), 4.8, lz, 0.78, 0.9, 1.2, 0.9), 1);
      W.lights.push({ x: lamp.x, y: ySocle + 4.8, z: lamp.z, size: 5, b: 1 });
    }
  }

  // grand stair down to the forecourt (south), two flights with a landing
  const sW = 17;
  let lz = tD;
  let ly = 0;
  const groundEnd = gAt(0, tD + 60);
  const drop = -groundEnd + 0.5;
  const nSteps = Math.round(drop / 0.26);
  const riseS = drop / nSteps;
  const runS = 0.52;
  const landingAt = Math.floor(nSteps / 2);
  for (let k = 0; k < nSteps; k++) {
    if (k === landingAt) {
      // landing
      const gl = gAt(0, lz + 4);
      W.stone.put(T_BOX, L(0, (ly + gl - 2) / 2, lz + 4, 0, sW * 2, ly - gl + 2, 8), 0.95);
      lz += 8;
    }
    ly -= riseS;
    const gs = gAt(0, lz + runS / 2) - 2;
    if (ly - gs > 0.05) W.stone.put(T_BOX, L(0, (ly + gs) / 2, lz + runS / 2, 0, sW * 2, ly - gs, runS + 0.02), 0.94 + 0.08 * rng());
    lz += runS;
  }
  // stepped cheek walls with lamps
  for (const s of [-1, 1]) {
    const len = lz - tD;
    for (let c = 0; c < 8; c++) {
      const z0 = tD + (len * c) / 8, z1 = tD + (len * (c + 1)) / 8;
      const yTopA = -(drop * (c / 8)) + 1.1, yTopB = -(drop * ((c + 1) / 8)) + 1.1;
      const gz = gAt(s * (sW + 1), (z0 + z1) / 2) - 2;
      const yTop = Math.max(yTopA, yTopB);
      if (yTop - gz > 0.3) W.stone.put(T_BOX, L(s * (sW + 1), (yTop + gz) / 2, (z0 + z1) / 2, 0, 2.2, yTop - gz, z1 - z0 + 0.05), 0.92);
    }
  }
  const stairEndZ = lz;

  // forecourt: a hexagonal pavement on the apron with broken hexagonal pillars around it
  const fR = 44;
  const fz = stairEndZ + fR * 0.82;
  const fc = toW(0, fz);
  let fTop = -Infinity;
  for (let a = 0; a < 6; a++) {
    const ang = (a * Math.PI) / 3;
    fTop = Math.max(fTop, gAt(Math.cos(ang) * fR * 0.5, fz + Math.sin(ang) * fR * 0.5));
  }
  fTop = Math.max(fTop, gAt(0, fz)) + 0.35;
  for (let ring = 0; ring < 3; ring++) {
    const r = fR + ring * 2.2;
    const y0 = fTop - ring * 0.45;
    W.stone.put(T_HEXCOL, L(0, y0 - 8, fz, 0, r, 8, r), 0.9 - ring * 0.03);
  }
  // inlaid ring of glyph stone and a central hexagonal basin/altar
  W.glyph.put(T_HEXCOL, L(0, fTop - 0.3, fz, 0, fR * 0.62, 0.34, fR * 0.62), 1);
  W.stone.put(T_HEXCOL, L(0, fTop - 0.3, fz, 0, fR * 0.56, 0.36, fR * 0.56), 1.05);
  W.stone.put(T_HEXCOL, L(0, fTop, fz, Math.PI / 6, 6.5, 1.3, 6.5), 0.95);
  W.bronze.put(T_HEXCOL, L(0, fTop + 1.3, fz, Math.PI / 6, 4.2, 0.5, 4.2), 1);
  W.glow.put(T_HEXCOL, L(0, fTop + 1.8, fz, Math.PI / 6, 1.2, 0.3, 1.2), 1);
  W.lights.push({ x: fc.x, y: ySocle + fTop + 2.3, z: fc.z, size: 6, b: 1.2 });
  for (let a = 0; a < 12; a++) {
    const ang = (a / 12) * Math.PI * 2 + 0.26;
    const px = Math.cos(ang) * (fR - 4), pz = fz + Math.sin(ang) * (fR - 4);
    if (pz < stairEndZ + 6 && Math.abs(px) < sW + 4) continue;
    const h = rng() < 0.35 ? 2 + rng() * 5 : 9 + rng() * 11;
    W.stone.put(T_HEXCOL, L(px, fTop - 1, pz, 0, 1.9, h + 1, 1.9), 0.9 + rng() * 0.12);
    if (h > 9) W.stone.put(T_HEXCOL, L(px, fTop + h, pz, 0, 2.4, 1.1, 2.4), 0.95);
  }
  return { fTopY: ySocle + fTop, fc, stairEndZ };
}

// ---------------------------------------------------------------------------
// prayer platforms
// ---------------------------------------------------------------------------

export function buildPlatform(ctx, W, face, x, y, len, turn, o = {}) {
  const yaw = face.yaw(x) + turn;
  const root = facePoint(face, x, y, -6, new THREE.Vector3());
  const dir = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
  const Lb = len + 6;
  // the beam (tapered cantilever), top at y
  W.stone.put(T_BEAM, mtx(root.x, y, root.z, yaw, 0, 0, o.beamW ?? 3.4, o.beamH ?? 6.5, Lb), 0.95);
  // walkway parapets on the beam
  for (const s of [-1, 1]) {
    const px = root.x + dir.x * (Lb / 2 + 3) + Math.cos(yaw) * s * 1.45;
    const pz = root.z + dir.z * (Lb / 2 + 3) - Math.sin(yaw) * s * 1.45;
    W.stone.put(T_BOX, mtx(px, y + 0.5, pz, yaw, 0, 0, 0.35, 1.0, Lb - 6), 0.95);
  }
  // raking strut from lower on the face to the middle of the beam
  const s0 = facePoint(face, x, y - len * 0.75, -2, new THREE.Vector3());
  const s1 = root.clone().addScaledVector(dir, Lb * 0.55);
  s1.y = y - 2.5;
  const X = new THREE.Vector3().subVectors(s1, s0);
  const sl = X.length();
  X.normalize();
  const Zs = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
  const Ys = new THREE.Vector3().crossVectors(Zs, X).normalize();
  basisBox(W.stone, T_BOX, s0.clone().add(s1).multiplyScalar(0.5), X, Ys, Zs, sl, 1.6, 1.8, 0.9);
  // chains from the strut to the beam tip
  const tip = root.clone().addScaledVector(dir, Lb);
  // platform: hexagonal slab with parapet ring
  const pr = o.platR ?? 6.5;
  const pc = root.clone().addScaledVector(dir, Lb + pr * 0.6);
  W.stone.put(T_HEXCOL, mtx(pc.x, y - 1.4, pc.z, yaw, 0, 0, pr, 1.4, pr), 0.98);
  W.stone.put(T_HEXTAPER, mtx(pc.x, y - 4.6, pc.z, yaw, Math.PI, 0, pr * 0.95, 3.2, pr * 0.95), 0.9);
  const c6 = hexCorners(pr - 0.3);
  for (let k = 0; k < 6; k++) {
    // parapet segments (leave the side facing the beam open)
    const a = c6[k], b = c6[(k + 1) % 6];
    const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
    const ang = Math.atan2(my, mx);
    // hexCorners are in XY (pointy-top); map to plan (x -> lateral, y -> along dir)
    const ldir = my;
    if (ldir < -pr * 0.5) continue;
    const wx = pc.x + Math.cos(yaw) * mx + dir.x * my;
    const wz = pc.z - Math.sin(yaw) * mx + dir.z * my;
    W.stone.put(T_BOX, mtx(wx, y + 0.55, wz, yaw - ang + Math.PI / 2, 0, 0, pr * 0.95, 1.1, 0.4), 0.97);
  }
  // pavilion: six slender posts, stepped bronze roof, finial, hanging lantern
  const pv = pr * 0.62;
  const c6p = hexCorners(pv);
  for (let k = 0; k < 6; k++) {
    const [mx, my] = c6p[k];
    const wx = pc.x + Math.cos(yaw) * mx + dir.x * my;
    const wz = pc.z - Math.sin(yaw) * mx + dir.z * my;
    W.stone.put(T_BOX, mtx(wx, y + 3.2, wz, yaw, 0, 0, 0.45, 6.4, 0.45), 0.98);
  }
  W.stone.put(T_HEXCOL, mtx(pc.x, y + 6.4, pc.z, yaw, 0, 0, pv + 1.2, 0.7, pv + 1.2), 0.95);
  W.bronze.put(T_HEXTAPER, mtx(pc.x, y + 7.1, pc.z, yaw, 0, 0, pv + 1.4, 1.6, pv + 1.4), 1);
  W.bronze.put(T_HEXCONE, mtx(pc.x, y + 8.7, pc.z, yaw, 0, 0, pv + 0.3, 5.5, pv + 0.3), 1);
  W.bronze.put(T_HEXCOL, mtx(pc.x, y + 14, pc.z, 0, 0, 0, 0.15, 3, 0.15), 1);
  W.bronze.put(T_BOX, mtx(pc.x, y + 5.4, pc.z, yaw, 0, 0, 0.12, 1.8, 0.12), 1);
  W.glow.put(T_HEXCOL, mtx(pc.x, y + 3.6, pc.z, yaw, 0, 0, 0.55, 1.1, 0.55), 1);
  W.lights.push({ x: pc.x, y: y + 4.1, z: pc.z, size: 7, b: 1.4 });
  // a bell under the tip for the longest ones
  if (o.bell) {
    W.bronze.put(T_HEXTAPER, mtx(tip.x, y - 9, tip.z, yaw, Math.PI, 0, 1.6, 2.6, 1.6), 1);
    W.bronze.put(T_BOX, mtx(tip.x, y - 5.2, tip.z, yaw, 0, 0, 0.12, 5, 0.12), 1);
  }
  return { tip, pc };
}

// ---------------------------------------------------------------------------
// great oculus: a telescoping hexagonal shaft into the heart of the core
// ---------------------------------------------------------------------------

export function buildOculus(ctx, W, face, P) {
  const { xc } = P;
  const { y: yo, r, frames, frontP, backD } = P.oculus;
  const yaw = face.yaw(xc);
  const zB = face.zBase(xc, yo);
  const base = new THREE.Matrix4().makeRotationY(yaw).setPosition(xc, yo, zB);
  const L = (x, y, z, rz = 0, sx = 1, sy = 1, sz = 1) => {
    const m = new THREE.Matrix4().makeRotationZ(rz).scale(_v3.set(sx, sy, sz));
    m.setPosition(x, y, z);
    return m.premultiply(base);
  };
  // concentric hexagonal rings stepping inward and back: front ring radius r at z=frontP
  for (let k = 0; k < frames; k++) {
    const t = k / (frames - 1);
    const ro = r * (1 - 0.52 * t) + 3.2;
    const ri = r * (1 - 0.52 * t);
    const zf = frontP - (frontP + backD) * t;
    const ring = new THREE.Shape(hexCorners(ro).map(([x, y]) => new THREE.Vector2(x, y)));
    ring.holes.push(new THREE.Path(hexCorners(ri).reverse().map(([x, y]) => new THREE.Vector2(x, y))));
    const depth = (frontP + backD) / (frames - 1) + 0.6;
    const g = new THREE.ExtrudeGeometry(ring, { depth, bevelEnabled: false });
    g.translate(0, 0, -depth);
    const acc = k === 1 || k === 3 ? W.glyph : W.stone;
    acc.put(toTemplate(g, (x, y, z, nx, ny, nz) => (nz > 0.5 ? 1 : 0.72 - 0.4 * t)), L(0, 0, zf), 1 - 0.35 * t);
  }
  // back wall with the bronze star
  const rBack = r * 0.48;
  const backZ = -backD;
  W.stone.put(T_HEXCOL, L(0, 0, backZ - 1, Math.PI / 2, rBack + 3.2, 1, rBack + 3.2).multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2)), 0.35);
  const star = [];
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    const rr = i % 2 ? rBack * 0.32 : rBack * 0.86;
    star.push(new THREE.Vector2(Math.cos(a) * rr, Math.sin(a) * rr));
  }
  const sg = new THREE.ExtrudeGeometry(new THREE.Shape(star), { depth: 1.2, bevelEnabled: false });
  W.bronze.put(toTemplate(sg), L(0, 0, backZ - 0.2), 0.9);
  // the unseen star itself: a small glowing core
  W.glow.put(T_HEXCOL, L(0, 0, backZ + 1.1, 0, 1.4, 1.4, 1.4).multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2)), 1.6);
  const wp = new THREE.Vector3(0, 0, backZ + 2.5).applyMatrix4(base);
  W.lights.push({ x: wp.x, y: wp.y, z: wp.z, size: 14, b: 1.6 });
  return { base, yaw };
}

// ---------------------------------------------------------------------------
// fallen cells, scree, vines
// ---------------------------------------------------------------------------

export function buildDebris(ctx, W, face, P, cells, kit) {
  const rng = ctx.noise.createRng('monastery-debris');
  const { ySocle, socleD } = P;
  // where things fell: scars, channels and the general foot of the face
  const spots = [];
  for (const f of P.falls) spots.push({ x: P.xc + f.u, n: 16, spread: 22, cells: 6 });
  for (const s of P.scars) spots.push({ x: P.xc + (s[0][0] + s[1][0]) / 2, n: 14, spread: 34, cells: 6 });
  for (let i = 0; i < 10; i++) spots.push({ x: P.xs0 + 20 + rng() * (P.xs1 - P.xs0 - 40), n: 5, spread: 18, cells: 1 });
  for (const s of spots) {
    for (let i = 0; i < s.n + s.cells; i++) {
      const x = s.x + (rng() - 0.5) * s.spread * 2;
      if (P.inPortal(x) && Math.abs(x - P.xc) < P.portalHalf + 30) continue;
      const yaw = face.yaw(x);
      const zf = face.zBase(x, ySocle) + socleD + 3 + rng() * rng() * 45;
      const px = x + Math.sin(yaw) * (zf - face.zBase(x, ySocle));
      const g = ctx.heightAt(px, zf);
      if (i < s.cells) {
        // a fallen cell: hexagonal prism lying on its flank, half sunk
        const len = 2.5 + rng() * 7;
        const rad = kit.Ro * (0.8 + rng() * 0.2);
        W.stone.put(T_CELLPRISM, mtx(px, g + rad * 0.45, zf, rng() * Math.PI * 2, (rng() - 0.5) * 0.5, Math.PI / 6 + (rng() - 0.5) * 0.3, rad, rad, len), 0.8 + rng() * 0.15);
      } else {
        const r = 0.8 + rng() * rng() * 4.5;
        W.rock.put(T_ICO, mtx(px, g + r * 0.2, zf, rng() * 6, rng(), rng(), r * (0.8 + rng() * 0.5), r * (0.6 + rng() * 0.3), r), 0.85 + rng() * 0.2);
      }
    }
  }
  // scree cones at the foot of the channels (where the water has undercut the socle)
  for (const f of P.falls) {
    const x0 = P.xc + f.u;
    for (let i = 0; i < 40; i++) {
      const x = x0 + (rng() - 0.5) * 30;
      const yaw = face.yaw(x);
      const d = socleD - 4 + rng() * 18;
      const zf = face.zBase(x, ySocle) + d;
      const px = x + Math.sin(yaw) * d;
      const g = ctx.heightAt(px, zf);
      const r = 0.6 + rng() * 2.8;
      W.rock.put(T_ICO, mtx(px, g + r * 0.3 + Math.max(0, 14 - d) * 0.6 * rng(), zf, rng() * 6, rng(), rng(), r, r * 0.7, r * 1.1), 0.8 + rng() * 0.2);
    }
  }
}

/** Hanging vines: thin tapering triangular strands from cell rims and ledges. */
export function buildVines(ctx, W, face, P, cells, kit) {
  const rng = ctx.noise.createRng('monastery-vines');
  const green = [0.36, 0.5, 0.24];
  const strand = (x, y, z, yaw, len, wid) => {
    const segs = Math.max(3, Math.min(9, Math.round(len / 2.5)));
    let px = x, py = y, pz = z;
    const sway = rng() * 6.28;
    for (let s = 0; s < segs; s++) {
      const t = (s + 1) / segs;
      const ny = y - len * t;
      const off = Math.sin(sway + t * 3.1) * 0.35 * t;
      const nx = x + Math.cos(yaw) * off, nz = z - Math.sin(yaw) * off + 0.15 * t;
      const w = wid * (1 - 0.7 * t);
      const cx = (px + nx) / 2, cy = (py + ny) / 2, cz = (pz + nz) / 2;
      W.rock.put(T_BOX, mtx(cx, cy, cz, yaw, 0, 0, w, py - ny + 0.1, w * 0.35), [green[0] * (0.8 + 0.3 * rng()), green[1] * (0.85 + 0.25 * rng()), green[2]]);
      px = nx; py = ny; pz = nz;
    }
  };
  for (const c of cells) {
    const wet = P.wetness(c.x, c.y);
    const chance = 0.035 + 0.25 * wet + (c.type === 'balcony' ? 0.2 : 0) + (c.x < P.xc - 250 || c.x > P.xc + 250 ? 0.05 : 0);
    if (rng() > chance) continue;
    const n = 1 + Math.floor(rng() * 4);
    const s = Math.sin(c.yaw), co = Math.cos(c.yaw);
    for (let k = 0; k < n; k++) {
      const lx = (rng() - 0.5) * kit.Ro * 1.3;
      const ly = -kit.Ro * 0.5 - rng() * 0.3;
      const lz = 0.25;
      const len = 2 + rng() * rng() * (8 + 22 * wet);
      strand(c.x + lx * co + lz * s, c.y + ly, c.zF - lx * s + lz * co, c.yaw, len, 0.35 + rng() * 0.7);
    }
  }
}
