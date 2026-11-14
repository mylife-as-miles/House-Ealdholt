// Geometry helpers for monumental architecture. All return THREE.BufferGeometry built around a
// sensible origin (documented per function). Units are metres. Combine with GeometryBuilder.

import * as THREE from 'crownfall-world-three';
import { worldNoise } from './noise.js';

/** Tapered box: base (wb x db) at y=0, top (wt x dt) at y=h. Flat-shaded look (split normals). */
export function frustumBox(wb, db, wt, dt, h) {
  const g = new THREE.BoxGeometry(1, 1, 1);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i) + 0.5; // 0..1
    const w = wb + (wt - wb) * y;
    const d = db + (dt - db) * y;
    p.setXYZ(i, p.getX(i) * w, y * h, p.getZ(i) * d);
  }
  g.computeVertexNormals();
  return g;
}

/** Regular n-gon prism (column / tower shaft). Base at y=0. Radii bottom r0, top r1. */
export function prism(sides, r0, r1, h, heightSegments = 1) {
  const g = new THREE.CylinderGeometry(r1, r0, h, sides, heightSegments, false);
  g.translate(0, h / 2, 0);
  return sides <= 8 ? g.toNonIndexed() : g;
}

/**
 * Arch ring (the curved band of an arch) lying in the XY plane, extruded along Z by `depth`.
 * Springs at y=0, span measured between inner faces, centred on x=0, z in [-depth/2, depth/2].
 * pointed > 0 makes a Gothic-style pointed arch (0..1).
 */
export function archRing({ span = 10, rise = null, thick = 1.5, depth = 2, segments = 24, pointed = 0 } = {}) {
  const r = span / 2;
  const rs = rise ?? r;
  const inner = [];
  const outer = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const a = Math.PI * (1 - t);
    let x = Math.cos(a) * r;
    let y = Math.sin(a) * rs;
    if (pointed > 0) {
      // bend towards a point at the apex
      const k = Math.abs(Math.cos(a));
      y += pointed * rs * 0.35 * (1 - k) * (1 - k);
      x *= 1 - pointed * 0.12 * Math.sin(a);
    }
    inner.push(new THREE.Vector2(x, y));
    const nx = Math.cos(a);
    const ny = Math.sin(a);
    outer.push(new THREE.Vector2(x + nx * thick, y + ny * thick));
  }
  const shape = new THREE.Shape();
  shape.moveTo(outer[0].x, outer[0].y);
  for (let i = 1; i < outer.length; i++) shape.lineTo(outer[i].x, outer[i].y);
  for (let i = inner.length - 1; i >= 0; i--) shape.lineTo(inner[i].x, inner[i].y);
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 1 });
  g.translate(0, 0, -depth / 2);
  return g;
}

/**
 * A wall slab with an arched opening, in XY, extruded along Z. Bottom at y=0, centred on x.
 */
export function archedWall({ width = 20, height = 20, span = 8, spring = 8, rise = null, depth = 2, segments = 20 } = {}) {
  const shape = new THREE.Shape();
  shape.moveTo(-width / 2, 0);
  shape.lineTo(width / 2, 0);
  shape.lineTo(width / 2, height);
  shape.lineTo(-width / 2, height);
  shape.closePath();
  const hole = new THREE.Path();
  const r = span / 2;
  const rs = rise ?? r;
  hole.moveTo(-r, 0.001);
  hole.lineTo(r, 0.001);
  hole.lineTo(r, spring);
  for (let i = 1; i <= segments; i++) {
    const a = (Math.PI * i) / segments;
    hole.lineTo(Math.cos(a) * r, spring + Math.sin(a) * rs);
  }
  hole.lineTo(-r, 0.001);
  shape.holes.push(hole);
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 1 });
  g.translate(0, 0, -depth / 2);
  return g;
}

/**
 * Straight flight of stairs as one extruded profile. Rises along +y, runs along +z,
 * spans x in [-width/2, width/2]. `solid` fills underneath down to y=0.
 */
export function stairs({ width = 6, steps = 20, rise = 0.3, run = 0.45, solid = true } = {}) {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  for (let i = 0; i < steps; i++) {
    shape.lineTo(i * run, (i + 1) * rise);
    shape.lineTo((i + 1) * run, (i + 1) * rise);
  }
  if (solid) shape.lineTo(steps * run, 0);
  else {
    shape.lineTo(steps * run, steps * rise - rise * 2);
    shape.lineTo(run * 1.5, -rise);
  }
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, { depth: width, bevelEnabled: false, curveSegments: 1 });
  // profile is in XY (x = run); rotate so run -> +z, extrude -> x
  g.rotateY(-Math.PI / 2);
  g.translate(width / 2, 0, 0);
  return g;
}

/** Surface of revolution around Y. `profile` = [[r, y], ...]. */
export function lathe(profile, segments = 32, phiStart = 0, phiLength = Math.PI * 2) {
  const pts = profile.map(([r, y]) => new THREE.Vector2(Math.max(r, 0.0001), y));
  return new THREE.LatheGeometry(pts, segments, phiStart, phiLength);
}

/** Tube along a smooth curve through points (Vector3 or [x,y,z]). */
export function tubeAlong(points, radius = 1, tubularSegments = 64, radialSegments = 8, closed = false) {
  const pts = points.map((p) => (p.isVector3 ? p : new THREE.Vector3(p[0], p[1], p[2])));
  const curve = new THREE.CatmullRomCurve3(pts, closed, 'centripetal');
  return new THREE.TubeGeometry(curve, tubularSegments, radius, radialSegments, closed);
}

/** Extrude a 2D shape (THREE.Shape or [[x,y],...]) along +Z by depth, centred on z. */
export function extrudeShape(shapeOrPoints, depth = 1, { bevel = 0, bevelSegments = 1, curveSegments = 8 } = {}) {
  let shape = shapeOrPoints;
  if (Array.isArray(shapeOrPoints)) {
    shape = new THREE.Shape(shapeOrPoints.map(([x, y]) => new THREE.Vector2(x, y)));
  }
  const g = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments,
    curveSegments,
  });
  g.translate(0, 0, -depth / 2);
  return g;
}

/** Partial sphere dome, base at y=0. openness in (0,1]: 1 = hemisphere. */
export function dome(radius = 10, openness = 1, widthSegments = 48, heightSegments = 24) {
  const g = new THREE.SphereGeometry(radius, widthSegments, heightSegments, 0, Math.PI * 2, 0, (Math.PI / 2) * openness);
  const baseY = radius * Math.cos((Math.PI / 2) * openness);
  g.translate(0, -baseY, 0);
  return g;
}

/**
 * Displace vertices along their normals by 3D noise — erosion, lumpy rock, weathered edges.
 * Works on any geometry; subdivide first for smooth results. Recomputes normals.
 */
export function displace(geometry, { amp = 0.5, freq = 0.2, octaves = 3, seed = 0 } = {}) {
  const g = geometry.index ? geometry : geometry;
  const p = g.attributes.position;
  if (!g.attributes.normal) g.computeVertexNormals();
  const n = g.attributes.normal;
  // Use position-keyed displacement so split vertices at seams move identically.
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const d = amp * worldNoise.fbm3(x * freq + seed, y * freq - seed, z * freq + seed * 0.5, octaves);
    p.setXYZ(i, x + n.getX(i) * d, y + n.getY(i) * d, z + n.getZ(i) * d);
  }
  p.needsUpdate = true;
  g.computeVertexNormals();
  return g;
}

/**
 * Jitter vertex positions randomly (shared positions move together): crumbled, hand-cut stone.
 */
export function jitter(geometry, amount = 0.1, seed = 1) {
  const p = geometry.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const n1 = worldNoise.noise3(x * 3.1 + seed, y * 3.1, z * 3.1);
    const n2 = worldNoise.noise3(x * 3.1, y * 3.1 + seed, z * 3.1 + 7);
    const n3 = worldNoise.noise3(x * 3.1 + 11, y * 3.1, z * 3.1 + seed);
    p.setXYZ(i, x + n1 * amount, y + n2 * amount, z + n3 * amount);
  }
  p.needsUpdate = true;
  geometry.computeVertexNormals();
  return geometry;
}

/** Rotate a geometry so its +Y axis points along `dir` (Vector3). Returns the geometry. */
export function alignY(geometry, dir) {
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
  geometry.applyQuaternion(q);
  return geometry;
}
