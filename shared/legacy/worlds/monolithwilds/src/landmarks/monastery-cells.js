// Honeycomb Cloister — the cells.
//
// Construction logic: a pointy-top hexagonal lattice is laid over the cliff. Every lattice site
// that survives the plan (core hexagon + the ragged colonies of the wings, minus the portal, the
// great oculus, the waterfall channels and collapse scars) becomes one cell: a hexagonal tube
// ("body") hung from the reference sheet, pushed out of the cliff by the protrusion field and
// reaching back into the rock, capped by one of four carved fronts (door, oculus window, sealed
// plug, door with balcony). The protrusion depth is the drawing medium: seen from afar, thousands
// of prisms at different depths form a relief (a hexagonal spiral converging on the oculus) that
// the low evening sun rakes from the west.
//
// Rendering: 1 instanced body mesh + 4 instanced front meshes + 1 instanced lantern mesh.

import * as THREE from 'crownfall-world-three';
import { SQ3, toTemplate, mergeTemplates, templateGeometry, hexCorners, hexPrismXY, rawGeometry, mtx } from './monastery-geo.js';

// ---------------------------------------------------------------------------
// templates (local frame: +z out of the cliff, front plane at z = 0, pointy-top hex in XY)
// ---------------------------------------------------------------------------

/** Flat hexagonal ring face at z between radii ro and ri (pointy-top), facing +z. */
function hexRingFace(ro, ri, z = 0) {
  const P = [], N = [], I = [];
  const co = hexCorners(ro), ci = hexCorners(ri);
  for (let k = 0; k < 6; k++) {
    P.push(co[k][0], co[k][1], z, ci[k][0], ci[k][1], z);
    N.push(0, 0, 1, 0, 0, 1);
  }
  for (let k = 0; k < 6; k++) {
    const a = k * 2, b = ((k + 1) % 6) * 2;
    I.push(a, b, a + 1, b, b + 1, a + 1);
  }
  return rawGeometry(P, N, I);
}

/** Inward-facing hexagonal sleeve of radius r from z0 (front) back to z1. */
function hexSleeve(r, z0, z1) {
  const P = [], N = [], I = [];
  const c = hexCorners(r);
  let v = 0;
  for (let k = 0; k < 6; k++) {
    const [ax, ay] = c[k];
    const [bx, by] = c[(k + 1) % 6];
    const mx = (ax + bx) / 2, my = (ay + by) / 2;
    const l = Math.hypot(mx, my);
    P.push(ax, ay, z0, bx, by, z0, bx, by, z1, ax, ay, z1);
    for (let q = 0; q < 4; q++) N.push(-mx / l, -my / l, 0);
    I.push(v, v + 1, v + 2, v, v + 2, v + 3);
    v += 4;
  }
  return rawGeometry(P, N, I);
}

/** Outline of an arched door (sill at y0, width w, springing at ys, semicircular head). CCW. */
function doorOutline(w, y0, ys, seg = 8) {
  const r = w / 2;
  const pts = [[-r, y0], [r, y0], [r, ys]];
  for (let i = 1; i < seg; i++) {
    const a = (Math.PI * i) / seg;
    pts.push([Math.cos(a) * r, ys + Math.sin(a) * r]);
  }
  pts.push([-r, ys]);
  return pts;
}

function circleOutline(r, cy, seg = 14) {
  const pts = [];
  for (let i = 0; i < seg; i++) {
    const a = (Math.PI * 2 * i) / seg - Math.PI / 2;
    pts.push([Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  return pts;
}

/** Hexagon (radius r) with a hole (outline pts), as a flat face at depth z facing +z. */
function hexWallWithHole(r, hole, z) {
  const shape = new THREE.Shape(hexCorners(r).map(([x, y]) => new THREE.Vector2(x, y)));
  const path = new THREE.Path(hole.slice().reverse().map(([x, y]) => new THREE.Vector2(x, y)));
  shape.holes.push(path);
  const g = new THREE.ShapeGeometry(shape, 1);
  g.translate(0, 0, z);
  return g;
}

/** Tunnel walls behind an outline (closed polygon, CCW), from z0 back to z1, facing inward. */
function outlineTunnel(pts, z0, z1) {
  const P = [], N = [], I = [];
  let v = 0;
  const n = pts.length;
  for (let k = 0; k < n; k++) {
    const [ax, ay] = pts[k];
    const [bx, by] = pts[(k + 1) % n];
    // CCW outline: the inside is to the left of a->b, inward normal = (-dy, dx)
    const dx = bx - ax, dy = by - ay;
    const l = Math.hypot(dx, dy) || 1;
    const nx = -dy / l, ny = dx / l;
    P.push(ax, ay, z0, bx, by, z0, bx, by, z1, ax, ay, z1);
    for (let q = 0; q < 4; q++) N.push(nx, ny, 0);
    I.push(v, v + 2, v + 1, v, v + 3, v + 2);
    v += 4;
  }
  return rawGeometry(P, N, I);
}

function polygonFace(pts, z) {
  const shape = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
  const g = new THREE.ShapeGeometry(shape, 1);
  g.translate(0, 0, z);
  return g;
}

function boxAt(cx, cy, cz, sx, sy, sz) {
  const g = new THREE.BoxGeometry(sx, sy, sz);
  g.translate(cx, cy, cz);
  return g;
}

/**
 * Builds the cell templates for lattice radius R. Returns templates + key dimensions.
 * Shading baked per vertex: the reveal darkens toward the recess, tunnels fall off to near black
 * (cheap ambient occlusion that reads at every distance).
 */
export function makeCellKit(R) {
  const Ro = R - 0.16; // joint between neighbouring cells
  const aO = (Ro * SQ3) / 2;
  const rimW = 0.72;
  const Ri = ((aO - rimW) * 2) / SQ3;
  const dR = 1.15; // depth of the reveal (front plane -> recess wall)
  const sill = -Ri * 0.5 + 0.25;
  const doorW = 2.0, doorSpring = sill + 2.3;
  const dT = 2.6; // door tunnel depth
  const ocR = 1.35, ocY = 0.35, dO = 1.8;

  const ring = toTemplate(hexRingFace(Ro, Ri, 0), () => 1);
  const sleeve = toTemplate(hexSleeve(Ri, 0, -dR), (x, y, z) => 0.82 + 0.25 * (z / dR));
  const sleeveShallow = toTemplate(hexSleeve(Ri, 0, -0.45), (x, y, z) => 0.85 + 0.2 * (z / 0.45));

  const door = doorOutline(doorW, sill, doorSpring);
  const doorWall = toTemplate(hexWallWithHole(Ri, door, -dR), () => 0.62);
  const doorTun = toTemplate(outlineTunnel(door, -dR, -dR - dT), (x, y, z) => {
    const t = (-z - dR) / dT; // 0 front .. 1 back
    return 0.42 * (1 - t) * (1 - t) + 0.03;
  });
  const doorBack = toTemplate(polygonFace(door, -dR - dT), () => 0.025);

  const oc = circleOutline(ocR, ocY);
  const ocWall = toTemplate(hexWallWithHole(Ri, oc, -dR), () => 0.62);
  const ocTun = toTemplate(outlineTunnel(oc, -dR, -dR - dO), (x, y, z) => {
    const t = (-z - dR) / dO;
    return 0.42 * (1 - t) * (1 - t) + 0.03;
  });
  const ocBack = toTemplate(polygonFace(oc, -dR - dO), () => 0.025);

  // sealed: shallow reveal, plug wall, a raised flat-top hexagonal boss carved on it
  const plug = toTemplate(polygonFace(hexCorners(Ri), -0.45), () => 0.7);
  const bossG = hexPrismXY(true, false);
  bossG.rotateZ(Math.PI / 6);
  bossG.scale(1.05, 1.05, 0.3);
  bossG.translate(0, 0.1, -0.45 + 0.3);
  const boss = toTemplate(bossG, (x, y, z, nx, ny, nz) => (nz > 0.5 ? 0.9 : 0.78));

  // balcony: slab at sill level projecting past the rim, low parapet, two corbels
  const slabD = 1.9, slabW = 3.1;
  const bal = [
    toTemplate(boxAt(0, sill - 0.2, -dR / 2 + slabD / 2 - 0.35, slabW, 0.4, dR + slabD), (x, y, z, nx, ny) => (ny < -0.5 ? 0.55 : 0.95)),
    toTemplate(boxAt(0, sill + 0.45, slabD - 0.35 - 0.12, slabW, 0.9, 0.24), () => 0.95),
    toTemplate(boxAt(-slabW / 2 + 0.12, sill + 0.45, slabD / 2 - 0.4, 0.24, 0.9, slabD - 0.3), () => 0.95),
    toTemplate(boxAt(slabW / 2 - 0.12, sill + 0.45, slabD / 2 - 0.4, 0.24, 0.9, slabD - 0.3), () => 0.95),
  ];
  for (const sx of [-1, 1]) {
    const cg = new THREE.BoxGeometry(0.45, 1.3, slabD - 0.2);
    // tapered corbel: pull the bottom-front edge back
    const p = cg.attributes.position;
    for (let i = 0; i < p.count; i++) {
      if (p.getY(i) < 0 && p.getZ(i) > 0) p.setZ(i, p.getZ(i) - (slabD - 0.5));
    }
    cg.computeVertexNormals();
    cg.translate(sx * (slabW / 2 - 0.45), sill - 0.4 - 0.65, (slabD - 0.2) / 2 - 0.35);
    bal.push(toTemplate(cg.toNonIndexed(), () => 0.8));
  }

  const T = {
    door: mergeTemplates([ring, sleeve, doorWall, doorTun, doorBack]),
    oculus: mergeTemplates([ring, sleeve, ocWall, ocTun, ocBack]),
    sealed: mergeTemplates([ring, sleeveShallow, plug, boss]),
    balcony: mergeTemplates([ring, sleeve, doorWall, doorTun, doorBack, ...bal]),
    body: toTemplate(hexPrismXY(false, false)),
  };

  // lantern glow: a plane just in front of the dark back of the door / oculus tunnel
  const lampDoor = { w: doorW * 0.98, h: doorSpring + doorW / 2 - sill, y: (sill + doorSpring + doorW / 2) / 2, z: -dR - dT + 0.05 };
  const lampOc = { w: ocR * 2, h: ocR * 2, y: ocY, z: -dR - dO + 0.05 };

  return { R, Ro, Ri, dR, sill, doorW, doorSpring, dT, T, lampDoor, lampOc };
}

// ---------------------------------------------------------------------------
// layout
// ---------------------------------------------------------------------------

/**
 * Lays out the cells. `plan` supplies:
 *   R, x0, x1, yBottom, yTop                      lattice extent
 *   member(x, y) -> 0..1                          presence (core + wings, ragged edges)
 *   excluded(x, y) -> bool                        holes (portal, oculus, channels, scars)
 *   protrusion(x, y) -> metres
 *   groove(x, y) -> 0..1                          1 on stair / gallery lines (cells flush, doors)
 *   tone(x, y) -> brightness multiplier           faded glyphs, soot, wet streaks
 *   litChance(x, y) -> 0..1
 */
export function layoutCells(ctx, face, plan, kit) {
  const { R } = plan;
  const W = SQ3 * R;
  const rowH = 1.5 * R;
  const cells = [];
  const H = ctx.noise.hash2;
  const rows = Math.floor((plan.yTop - plan.yBottom) / rowH) + 1;
  for (let j = 0; j < rows; j++) {
    const y = plan.yBottom + j * rowH;
    const off = j & 1 ? W / 2 : 0;
    const cols = Math.floor((plan.x1 - plan.x0) / W) + 1;
    for (let i = 0; i < cols; i++) {
      const x = plan.x0 + i * W + off;
      const m = plan.member(x, y);
      if (m <= 0) continue;
      const h1 = H(i, j, 11), h2 = H(i, j, 23), h3 = H(i, j, 37), h4 = H(i, j, 41);
      if (h1 > m) continue; // ragged, thinning colony edges
      if (plan.excluded(x, y)) continue;
      const g = plan.groove(x, y);
      let p = plan.protrusion(x, y, h2);
      p = p * (1 - g) + 0.35 * g;
      // type
      let type;
      if (g > 0.5) type = h3 < 0.8 ? 'door' : 'oculus';
      else if (h3 < 0.36) type = 'door';
      else if (h3 < 0.56) type = 'oculus';
      else if (h3 < 0.86) type = 'sealed';
      else type = p > 1.5 ? 'balcony' : 'door';
      const yaw = face.yaw(x);
      const zF = face.zBase(x, y) + p;
      const back = face.rockMinZ(x - W / 2, x + W / 2, y - R, y + R) - 3;
      const lit = type !== 'sealed' && h4 < plan.litChance(x, y);
      cells.push({ x, y, zF, back, yaw, p, type, lit, tone: plan.tone(x, y, h2), i, j, h: h2 });
    }
  }
  return cells;
}

// ---------------------------------------------------------------------------
// meshes
// ---------------------------------------------------------------------------

const _m = new THREE.Matrix4();
const _m2 = new THREE.Matrix4();
const _c = new THREE.Color();

function instanced(geometry, material, n, name, { castShadow = true, receiveShadow = true } = {}) {
  const mesh = new THREE.InstancedMesh(geometry, material, n);
  mesh.name = `monastery:${name}`;
  mesh.castShadow = castShadow;
  mesh.receiveShadow = receiveShadow;
  mesh.matrixAutoUpdate = false;
  return mesh;
}

/**
 * Builds the instanced meshes. Returns { meshes, lamps (world positions of lit doorways), triangles }.
 */
export function buildCellMeshes(ctx, cells, kit, mats) {
  const { T, Ro } = kit;
  const meshes = [];
  let triangles = 0;

  // bodies ------------------------------------------------------------------
  const bodyGeo = templateGeometry(T.body);
  const bodies = instanced(bodyGeo, mats.cell, cells.length, 'bodies');
  for (let k = 0; k < cells.length; k++) {
    const c = cells[k];
    const L = Math.max(2, c.zF - c.back);
    const sx = 1 / Math.max(0.9, Math.cos(c.yaw));
    mtx(c.x, c.y, c.zF, c.yaw, 0, 0, Ro * sx, Ro, L, _m);
    bodies.setMatrixAt(k, _m);
    const t = c.tone;
    bodies.setColorAt(k, _c.setRGB(t[0] * 0.92, t[1] * 0.92, t[2] * 0.92));
  }
  bodies.instanceMatrix.needsUpdate = true;
  bodies.instanceColor.needsUpdate = true;
  bodies.computeBoundingSphere();
  meshes.push(bodies);
  triangles += (T.body.idx.length / 3) * cells.length;

  // fronts -----------------------------------------------------------------
  const lamps = [];
  for (const type of ['door', 'oculus', 'sealed', 'balcony']) {
    const list = cells.filter((c) => c.type === type);
    if (!list.length) continue;
    const mesh = instanced(templateGeometry(T[type]), mats.cell, list.length, `front-${type}`);
    for (let k = 0; k < list.length; k++) {
      const c = list[k];
      const sx = 1 / Math.max(0.9, Math.cos(c.yaw));
      mtx(c.x, c.y, c.zF, c.yaw, 0, 0, sx, 1, 1, _m);
      mesh.setMatrixAt(k, _m);
      const t = c.tone;
      mesh.setColorAt(k, _c.setRGB(t[0], t[1], t[2]));
      if (c.lit) lamps.push(c);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
    meshes.push(mesh);
    triangles += (T[type].idx.length / 3) * list.length;
  }

  // lanterns: one glowing plane at the back of each lit doorway / window ----
  if (lamps.length) {
    const quad = new THREE.PlaneGeometry(1, 1);
    const qg = new THREE.BufferGeometry();
    qg.setAttribute('position', quad.attributes.position);
    qg.setAttribute('normal', quad.attributes.normal);
    const col = new Float32Array(quad.attributes.position.count * 3).fill(1);
    qg.setAttribute('color', new THREE.BufferAttribute(col, 3));
    qg.setIndex(quad.index);
    const mesh = instanced(qg, mats.lamp, lamps.length, 'lanterns', { castShadow: false, receiveShadow: false });
    for (let k = 0; k < lamps.length; k++) {
      const c = lamps[k];
      const L = c.type === 'oculus' ? kit.lampOc : kit.lampDoor;
      mtx(c.x, c.y, c.zF, c.yaw, 0, 0, 1, 1, 1, _m);
      _m2.makeTranslation(0, L.y, L.z).scale(new THREE.Vector3(L.w, L.h, 1));
      _m.multiply(_m2);
      mesh.setMatrixAt(k, _m);
      const b = 0.55 + 0.45 * c.h;
      mesh.setColorAt(k, _c.setRGB(b, b * (0.85 + 0.1 * c.h), b * (0.7 + 0.2 * c.h)));
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
    meshes.push(mesh);
    triangles += 2 * lamps.length;
  }

  return { meshes, lamps, triangles };
}

/** World position of a point given in a cell's local frame (for lights, vines, water). */
export function cellPoint(c, lx, ly, lz, out = new THREE.Vector3()) {
  const s = Math.sin(c.yaw), co = Math.cos(c.yaw);
  out.set(c.x + lx * co + lz * s, c.y + ly, c.zF - lx * s + lz * co);
  return out;
}
