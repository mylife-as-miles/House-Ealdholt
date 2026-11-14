// THE KNEELING WARDENS — five faceless colossi kneeling in a shallow crescent on the north
// shore, bowed toward a small landing at the water's edge, as if waiting for a command that
// never came.
//
// They are buildings in the shape of bodies: every limb is a pile of 3 m masonry courses; the
// bow is made by corbelling, so a bowed back becomes stepped terraces with stairs and hanging
// gardens and the chest a corbelled overhang; the backs are coffered facades (pilasters, recessed
// panels, windows, loggias, balconies, flying buttresses) with an inscribed spine that glows
// cyan at night; the arms are buttress-towers with stairs inside; the shoulders rise as coursed
// towers either side of the bowed, faceless head; the hands are terraces with stairs and lanterns.
// Five stages of one gesture: the west one kneels upright, head sunk to its chest, hands on its
// knees; the second bows with arms braced (hollow at the waist, a bronze bell swinging inside);
// the centre bows deepest, its forehead resting on an altar at the end of the causeway; the
// fourth bows low with elbows flared, its head of black obsidian; the easternmost has fallen
// apart and its head lies in the shallows.
//
// Files: wardens-sink.js (geometry sink + coursed stacks), wardens-body.js (one colossus: the
// spine-swept body model, limbs, heads, flyers),
// wardens-ruin.js (the fallen one), wardens-shore.js (landing + causeway),
// wardens-flora.js (the plants that took root on them).

import * as THREE from 'crownfall-world-three';
import { Sink } from './wardens-sink.js';
import { buildWarden } from './wardens-body.js';
import { buildRuin } from './wardens-ruin.js';
import { buildShore } from './wardens-shore.js';
import { plantTrees } from './wardens-flora.js';
import { yieldToMain as yieldFrame } from '../core/yield.js';

// The crescent: wardens sit on a circle of radius ARC_R around a focus near the shore
// (site-local: +z = site.facing, toward the lake). West is kept open for the pillar avenue.
const ARC_R = 375;
const FOCUS_Z = 390;
const TURN = 1.7;
// Pose: the spine curls from lean0 to lean1 (radians from vertical); neckA/bow = the neck's first
// bend past the spine and the final angle of the hanging head. Storeys (loggias, chestLoggia,
// waist, stumpT) are spine fractions 0 (pelvis) .. 1 (shoulders).
const DEFS = [
  { id: 'west', th: -0.7, s: 1.0, arms: 'thighs', lean0: 0.03, lean1: 0.32, curl: 0.3, spineL: 126, neckA: 0.7, bow: 2.85, head: 'spindle', neck: 'colonnade', elbow: 2, loggias: [0.4, 0.64], chestLoggia: 0.72, balconies: 6, lampP: 0.12, tone: [1.0, 0.98, 0.95] },
  { id: 'second', th: -0.36, s: 1.05, arms: 'front', lean0: 0.3, lean1: 0.92, curl: 0.3, spineL: 132, neckA: 0.35, bow: 2.7, head: 'egg', neck: 'vertebrae', elbow: 3, loggias: [0.68], chestLoggia: 0.58, waist: [0.2, 0.36], bell: true, balconies: 8, lampP: 0.11, tone: [0.95, 0.96, 0.98] },
  { id: 'centre', th: 0, s: 1.14, pose: 'prostrate', lean0: 0.55, lean1: 1.42, curl: 0.05, spineL: 124, head: 'facet', neck: 'vertebrae', elbow: 1, loggias: [0.3, 0.56], balconies: 9, lampP: 0.13, tone: [1.02, 0.99, 0.95] },
  { id: 'fourth', th: 0.38, s: 1.04, arms: 'wide', lean0: 0.42, lean1: 1.04, curl: 0.25, spineL: 128, neckA: 0.3, bow: 2.7, head: 'lens', dark: true, neck: 'collar', elbow: 3, loggias: [0.56], chestLoggia: 0.46, balconies: 5, lampP: 0.11, tone: [0.97, 0.96, 0.95] },
  { id: 'fallen', th: 0.74, s: 1.0, arms: 'front', lean0: 0.4, lean1: 0.8, spineL: 128, neckA: 0.4, bow: 2.3, head: 'egg', neck: 'colonnade', elbow: 3, loggias: [0.2], balconies: 2, lampP: 0.03, ruined: true, turn: 0.45, stumpT: 0.36, armBreakR: 50, tone: [0.96, 0.95, 0.93] },
];

export async function build(ctx, site) {
  const mats = ctx.materials;
  const M = {
    stone: mats.get('stone'),
    basalt: mats.get('basalt'),
    // the heads are carved monolithically (no coursing) and paler than the bodies: they catch
    // what light there is when the bodies stand in their own shade; one is black obsidian
    head: mats.get('stoneSmooth'),
    headDark: mats.get('obsidian'),
    // a continuous rune column: band spacing == band height, so the whole strip is inscribed
    spine: mats.create('obsidianGlyph', { glyphs: { cell: 1.15, band: 3, height: 3.2, intensity: 0.75, color: '#5fe6ff' } }),
    // lanterns / lit windows; the head slits reuse it with a cyan vertex tint (SLIT_TINT)
    lamp: mats.glow('#ffb56b', { day: 0.08, night: 5.5, flicker: 0.22 }),
    leaf: mats.get('rock'),
  };

  const root = new THREE.Group();
  root.name = 'landmark:wardens';
  root.position.set(site.x, 0, site.z);

  const f = site.facing;
  const cf = Math.cos(f), sf = Math.sin(f);
  // site-local (x right, z toward the lake) -> offset from the site centre in world axes
  const toSite = (lx, lz) => [lx * cf + lz * sf, -lx * sf + lz * cf];
  const groundS = (lx, lz) => {
    const [x, z] = toSite(lx, lz);
    return ctx.heightAt(site.x + x, site.z + z);
  };

  const sink = new Sink();
  const info = [];
  for (let i = 0; i < DEFS.length; i++) {
    if (i) await yieldFrame(); // keep the loader responsive: ~150 ms of work per warden
    const d = DEFS[i];
    const lx = ARC_R * Math.sin(d.th);
    const lz = FOCUS_Z - ARC_R * Math.cos(d.th);
    const [ox, oz] = toSite(lx, lz);
    // the outer ones turn in toward the causeway axis, so from the lake they show their bowed
    // profiles while the centre one bows straight to the water
    const yaw = f - (d.turn ?? d.th * TURN);
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    const m = new THREE.Matrix4().makeRotationY(yaw).setPosition(ox, 0, oz);
    sink.setMatrix(m);
    sink.tone = d.tone || [1, 1, 1];
    const groundAt = (wx, wz) => ctx.heightAt(site.x + ox + wx * cy + wz * sy, site.z + oz - wx * sy + wz * cy);
    const W = {
      ...d,
      rng: ctx.noise.createRng(`wardens-${d.id}`),
      g0: groundAt(0, 0),
      groundAt,
      groundMin(wx, wz, r) {
        let g = groundAt(wx, wz);
        for (let k = 0; k < 8; k++) {
          const a = (k / 8) * Math.PI * 2;
          g = Math.min(g, groundAt(wx + Math.cos(a) * r, wz + Math.sin(a) * r));
        }
        return g;
      },
    };
    const anchors = buildWarden(sink, M, W);
    if (d.ruined) buildRuin(sink, M, W, anchors);
    plantTrees(sink, M.leaf, anchors.plant, W.rng);
    const toWorld = (p) => new THREE.Vector3(p.x, p.y, p.z).applyMatrix4(m).add(root.position);
    info.push({ d, W, m, anchors, toWorld, lx, lz });
  }

  // landing + causeway in the site-local frame
  sink.setMatrix(new THREE.Matrix4().makeRotationY(f));
  sink.tone = [1, 1, 1];
  const centre = info[2];
  const shoreRng = ctx.noise.createRng('wardens-shore');
  const ca = centre.anchors;
  const shore = buildShore(sink, M, groundS, shoreRng, centre.d.pose === 'prostrate'
    ? { endZ: centre.lz + ca.altar.zFront, markersUntil: centre.lz + ca.fingerZ + 10, altar: true }
    : { endZ: centre.lz + ca.fingerZ + 20, markersUntil: -1e9, stairTo: { z: centre.lz + ca.fingerZ - 18 * centre.d.s, y: ca.thumbY } });
  plantTrees(sink, M.leaf, shore.plant, shoreRng);

  const group = sink.build('wardens', new Set([M.lamp]));
  root.add(group);

  // the bell hanging inside the second warden's open waist: it swings, very slowly
  let bell = null;
  const bellInfo = info.find((w) => w.anchors.bell);
  if (bellInfo) {
    const b = bellInfo.anchors.bell;
    const hang = new THREE.Vector3(b.x, b.y, b.z).applyMatrix4(bellInfo.m);
    const pivot = new THREE.Group();
    pivot.position.copy(hang);
    pivot.rotation.order = 'YXZ'; // yaw first, then the swing in the warden's own axes
    pivot.rotation.y = f - (bellInfo.d.turn ?? bellInfo.d.th * TURN);
    const mesh = new THREE.Mesh(bellGeometry(b.s), ctx.materials.create('bronze', { local: true }));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.name = 'wardens:bell';
    pivot.add(mesh);
    root.add(pivot);
    bell = pivot;
  }
  ctx.scene.add(root);

  // ---------------------------------------------------------------- viewpoints
  const W2 = (lx, y, lz) => {
    const [x, z] = toSite(lx, lz);
    return [site.x + x, y, site.z + z];
  };
  // inside the second warden's open waist, behind the hanging bell, looking out toward the lake
  const bw = info.find((w) => w.anchors.waist);
  let inWaist = null, bellLook = null;
  if (bw) {
    const wz = bw.anchors.waist;
    // stand beside the bell (it hangs in the left of the frame) and look out between the piers
    inWaist = bw.toWorld({ x: wz.x + 12 * bw.d.s, y: wz.y + 4, z: wz.z - 12 * bw.d.s });
    bellLook = bw.toWorld({ x: wz.x - 4 * bw.d.s, y: wz.y + 8, z: wz.z + 45 });
  }
  // beneath the centre warden's resting head, on the causeway before the altar stair
  const alt = centre.anchors.altar;
  const altarZ = alt ? centre.lz + alt.z : 180;
  const viewpoints = [
    // from the south-west hills, sun behind the shoulder: the crescent against the escarpment
    { label: 'establishing', pos: W2(-800, 170, 950), look: W2(0, 70, 90) },
    // the procession of bows seen along the shore, the landing and causeway beyond
    { label: 'approach', pos: W2(-330, 95, 470), look: W2(-20, 80, 90) },
    // backlit from the lake's north-east corner: the sun sets behind the bowed silhouettes
    { label: 'dramatic', pos: W2(400, 55, 630), look: W2(20, 80, 90) },
    { label: 'intimate', pos: inWaist ? inWaist.toArray() : W2(-10, 27, 330), look: bellLook ? bellLook.toArray() : W2(0, 40, 100) },
    // best at night, when the lanterns on the altar are lit and the slit wakes
    { label: 'the resting head', pos: W2(-26, 24, altarZ + 105), look: W2(0, 52, altarZ), hour: 22 },
    { label: 'the backs', pos: W2(250, 245, -420), look: W2(-120, 90, 40), hour: 17.9 },
    // from the water at night: five cyan slits in a row, doubled by the lake
    { label: 'night vigil', pos: W2(-40, 32, 720), look: W2(0, 80, 70), hour: 22 },
  ];
  // Outdoor cameras must clear the forest canopy (conifers reach ~45 m) and the vegetation
  // module's giant trees, whose positions are only known at runtime.
  const giants = ctx.vegetation?.giants || [];
  for (const v of viewpoints) {
    if (v.label === 'intimate' || v.label === 'the resting head') continue;
    const p = v.pos;
    const g = ctx.heightAt(p[0], p[2]);
    if (g > 1) p[1] = Math.max(p[1], g + 58);
    for (const t of giants) {
      const R = (t.height || 70) * 0.9 + 12;
      const dx = p[0] - t.x, dz = p[2] - t.z;
      const d = Math.hypot(dx, dz);
      if (d < R && p[1] < t.y + (t.height || 70) + 15) {
        const k = (R + 4) / Math.max(d, 1e-3);
        p[0] = t.x + dx * k;
        p[2] = t.z + dz * k;
        p[1] = Math.max(p[1], ctx.heightAt(p[0], p[2]) + 58);
      }
    }
  }

  return {
    object: root,
    viewpoints,
    update(dt, t) {
      if (!bell) return;
      // two incommensurate slow periods (~26 s and ~71 s): never quite repeating, never quick
      bell.rotation.x = 0.03 * Math.sin(t * 0.241) + 0.012 * Math.sin(t * 0.0887 + 1.3);
      bell.rotation.z = 0.014 * Math.sin(t * 0.173 + 0.6);
    },
  };
}

/** A bronze bell hanging from its crown at the origin (extends downward). */
function bellGeometry(s) {
  const H = 17 * s;
  const R = 7.6 * s;
  const prof = [[1.0, 0], [0.98, 0.04], [0.86, 0.12], [0.68, 0.3], [0.6, 0.5], [0.58, 0.7], [0.55, 0.86], [0.42, 0.96], [0.2, 1.0], [0.02, 1.0]];
  const outer = new THREE.LatheGeometry(prof.map(([r, t]) => new THREE.Vector2(r * R, t * H)), 40);
  // inner surface: the same curve, thinner, ordered downward so it faces inward
  const innerPts = prof.slice(0, 8).map(([r, t]) => new THREE.Vector2(Math.max(0.05, r * R - 0.9 * s), Math.min(t * H, H - 1.6 * s))).reverse();
  const inner = new THREE.LatheGeometry(innerPts, 40);
  const lip = new THREE.RingGeometry(R - 0.9 * s, R, 40, 1);
  lip.rotateX(Math.PI / 2);
  // hanger block on the crown
  const hanger = new THREE.CylinderGeometry(1.2 * s, 1.6 * s, 2.4 * s, 8);
  hanger.translate(0, H + 1.2 * s, 0);
  const merged = mergeGeos([outer, inner, lip, hanger]);
  merged.translate(0, -H - 2.4 * s, 0);
  return merged;
}

function mergeGeos(list) {
  const parts = list.map((g0) => {
    if (!g0.attributes.normal) g0.computeVertexNormals();
    return g0.index ? g0.toNonIndexed() : g0;
  });
  let n = 0;
  for (const g of parts) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3);
  const nrm = new Float32Array(n * 3);
  let o = 0;
  for (const g of parts) {
    pos.set(g.attributes.position.array, o);
    nrm.set(g.attributes.normal.array, o);
    o += g.attributes.position.count * 3;
    g.dispose();
  }
  for (const g of list) g.dispose();
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  out.setAttribute('color', new THREE.BufferAttribute(new Float32Array(pos.length).fill(1), 3));
  out.computeBoundingSphere();
  return out;
}
