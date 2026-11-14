// The processional walkway along the back of the Vertebral Span: a continuous bone lamina with
// paving slabs (a few sunk, cracked or missing), low curbs, and lamp-obelisks at every joint.

import * as THREE from 'crownfall-world-three';
import { sweep, superellipse } from './span-geo.js';
import { trs } from '../core/builder.js';
import { frustumBox } from '../core/shapes.js';

/** Walkway half-width at station s (interpolated between unit centres). */
export function halfWidthAt(units, s) {
  if (s <= units[0].s) return units[0].hw;
  for (let i = 0; i < units.length - 1; i++) {
    const a = units[i];
    const b = units[i + 1];
    if (s <= b.s) {
      const t = (s - a.s) / (b.s - a.s);
      return a.hw + (b.hw - a.hw) * t;
    }
  }
  return units[units.length - 1].hw;
}

export function buildDeck(ctx, F, B, M, rng, units) {
  const s0 = F.sW - 6;
  const s1 = F.sE + 6;
  const step = 2.5;
  const n = Math.ceil((s1 - s0) / step) + 1;
  const fr = [];
  for (let k = 0; k < n; k++) {
    const s = s0 + ((s1 - s0) * k) / (n - 1);
    const f = F.frameAt(s);
    fr.push({ s, P: f.P.clone(), T: f.T.clone(), U: f.U.clone(), S: f.S.clone(), hw: halfWidthAt(units, s) });
  }
  const frames = { S: fr.map((f) => f.S), U: fr.map((f) => f.U) };

  // bone lamina under the paving
  const base = sweep(fr.map((f) => f.P.clone().addScaledVector(f.U, -1.25)), (t, k) => [fr[k].hw + 0.75, 1.15], {
    radial: 20, frames, profile: superellipse(5), capStart: true, capEnd: true, capBulge: 0.02,
  });
  B.add(base, M.bone, null, 0.95);

  // curbs
  for (const sd of [-1, 1]) {
    const pts = fr.map((f) => f.P.clone().addScaledVector(f.S, sd * (f.hw + 0.4)).addScaledVector(f.U, 0.2));
    const g = sweep(pts, () => [0.42, 0.62], { radial: 8, frames, profile: superellipse(4), capBulge: 0.1 });
    B.add(g, M.stoneSmooth, null, 0.92);
  }

  // paving slabs (world-space block courses would fight the slab joints, so use smooth stone)
  const box = new THREE.BoxGeometry(1, 1, 1);
  const m = new THREE.Matrix4();
  const slab = 2.6;
  for (let s = F.sW + 1; s < F.sE - 1; s += slab) {
    if (rng() < 0.035) continue; // missing slab: the bone shows through
    const f = F.frameAt(s + slab / 2);
    const hw = halfWidthAt(units, s);
    const across = rng() < 0.3 ? 2 : 1; // some courses split in two
    for (let q = 0; q < across; q++) {
      const w = (2 * hw) / across;
      const zc = -hw + w * (q + 0.5);
      const sunk = rng() < 0.06 ? -0.15 - rng() * 0.25 : 0;
      const tilt = rng() < 0.08 ? (rng() - 0.5) * 0.08 : (rng() - 0.5) * 0.01;
      const base = new THREE.Matrix4().makeBasis(f.T, f.U, f.S).setPosition(f.P);
      m.multiplyMatrices(base, trs(0, -0.3 + sunk, zc, tilt, (rng() - 0.5) * 0.01, (rng() - 0.5) * 0.02, slab - 0.1, 0.6, w - 0.1));
      B.add(box, M.stoneSmooth, m, 0.88 + rng() * 0.2);
    }
  }

  // lamp-obelisks at each joint, both sides
  const shaft = frustumBox(0.95, 0.95, 0.6, 0.6, 3.9);
  const lamp = new THREE.BoxGeometry(0.62, 0.7, 0.62);
  const cap = new THREE.ConeGeometry(0.62, 1.5, 4, 1);
  cap.rotateY(Math.PI / 4);
  const plinth = new THREE.BoxGeometry(1.5, 0.6, 1.5);
  const lamps = [];
  for (let i = 0; i < units.length - 1; i++) {
    const s = units[i].jointS ?? (units[i].s + units[i].L / 2);
    const f = F.frameAt(s);
    const hw = halfWidthAt(units, s);
    const base = new THREE.Matrix4().makeBasis(f.T, f.U, f.S).setPosition(f.P);
    for (const sd of [-1, 1]) {
      if (i === 7 && sd === 1) continue; // toppled one (lies on the deck, see below)
      const z = sd * (hw - 0.75);
      m.multiplyMatrices(base, trs(0, 0.3, z));
      B.add(plinth, M.stoneSmooth, m, 0.85);
      m.multiplyMatrices(base, trs(0, 0.55, z));
      B.add(shaft, M.stoneSmooth, m, 0.95);
      m.multiplyMatrices(base, trs(0, 4.8, z));
      B.add(lamp, M.glow, m, 1);
      m.multiplyMatrices(base, trs(0, 5.15 + 0.75, z));
      B.add(cap, M.stoneSmooth, m, 0.95);
      lamps.push(f.P.clone().addScaledVector(f.S, z).addScaledVector(f.U, 4.8));
    }
    if (i === 7) {
      // a fallen lamp-obelisk lying across the walkway, its cap snapped off
      m.multiplyMatrices(base, trs(1.5, 0.75, hw - 2.4, 0.2, 0.9, Math.PI / 2 - 0.05));
      B.add(shaft, M.stoneSmooth, m, 0.9);
      m.multiplyMatrices(base, trs(-2.4, 0.5, hw - 0.8, 0.4, 0.3, 1.2));
      B.add(cap, M.stoneSmooth, m, 0.9);
    }
  }
  return { lamps };
}
