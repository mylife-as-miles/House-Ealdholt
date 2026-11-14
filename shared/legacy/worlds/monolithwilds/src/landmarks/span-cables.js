// Ligament cables of the Vertebral Span (bronze and iron): a supraspinous cable through every
// fin tip (one snapped end hangs loose), intertransverse cables along each flank, crossed
// interspinous rigging between fins, a ventral tendon under the centra, and splayed stays that
// tie the end units back into the rim rock like guy-lines.

import * as THREE from 'crownfall-world-three';
import { sweep, curvePts } from './span-geo.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

function catenary(a, b, sag, n = 14) {
  return curvePts((t) => V(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t - sag * 4 * t * (1 - t), a.z + (b.z - a.z) * t), n);
}

export function cable(B, mat, a, b, r, sag, n = 14) {
  const pts = catenary(a, b, sag, n);
  B.add(sweep(pts, () => [r, r], { radial: r > 0.4 ? 7 : 5, capBulge: 0 }), mat, null, 1);
}

export function buildCables(ctx, F, B, M, units) {
  const W = (u, p) => p.clone().applyMatrix4(u.matrix);
  const withFin = units.filter((u) => u.type !== 'patch');
  const collar = new THREE.TorusGeometry(1, 0.3, 6, 18);
  collar.rotateX(Math.PI / 2);

  // supraspinous cable through the fin tips
  for (let i = 0; i < withFin.length - 1; i++) {
    const a = withFin[i];
    const b = withFin[i + 1];
    const pa = W(a, a.finPath(a.finTEnd * 0.9));
    const pb = W(b, b.finPath(b.finTEnd * 0.9));
    const d = pa.distanceTo(pb);
    if (b.brokenFin) {
      // snapped where the fin broke: the loose end hangs down the side of the sail
      const hang = [];
      for (let k = 0; k <= 12; k++) {
        const t = k / 12;
        hang.push(V(pa.x + (pb.x - pa.x) * 0.35 * Math.sin(t * 1.4), pa.y - 26 * t * t - 2 * t, pa.z + 2.5 * t));
      }
      B.add(sweep(hang, () => [0.42, 0.42], { radial: 6, capBulge: 0 }), M.bronze, null, 1);
      continue;
    }
    if (a.brokenFin) continue;
    cable(B, M.bronze, pa, pb, 0.42, 0.05 * d + (b.i - a.i > 1 ? 5 : 1));
  }
  // collars where the cable passes each fin
  for (const u of withFin) {
    if (u.brokenFin) continue;
    const t = u.finTEnd * 0.9;
    const p = u.finPath(t);
    const p2 = u.finPath(Math.min(1, t + 0.02));
    const dir = p2.sub(p).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), dir);
    const a = u.Lc * (0.37 - 0.22 * 0.95 + 0.07 * 0.95) * 1.02 + 0.35;
    const b = u.size * (1.5 - 0.8 * 0.95 + 0.55 * 0.95) + 0.35;
    const m = new THREE.Matrix4().compose(p, q, V(a, 1.6, b)).premultiply(u.matrix);
    B.add(collar, M.bronze, m, 1);
  }

  // intertransverse cables along both flanks (they bridge the patch with a longer sag)
  for (const si of [0, 1]) {
    for (let i = 0; i < withFin.length - 1; i++) {
      const a = withFin[i];
      const b = withFin[i + 1];
      const pa = W(a, a.wingTip[si]);
      const pb = W(b, b.wingTip[si]);
      cable(B, M.iron, pa, pb, 0.34, 1.2 + 0.03 * pa.distanceTo(pb) + (b.i - a.i > 1 ? 4 : 0));
    }
  }

  // ossified tendons: a basket-weave of thin bone rods along both flanks of the sail, each rod
  // spanning two fins diagonally (as in the backs of some great reptiles)
  const finSide = (u, t, sd) => {
    const c = u.finPath(t);
    const fil = 1 + 0.6 * (1 - Math.min(1, t / 0.14));
    const b = u.size * (u.type === 'lumb' ? 1.7 - 0.5 * t : 1.45 - 0.85 * Math.min(1, Math.max(0, (t - 0.03) / 0.69))) * fil;
    return c.setZ(c.z + sd * (b + 0.35));
  };
  for (let i = 0; i < withFin.length - 2; i++) {
    const a = withFin[i];
    const b = withFin[i + 2];
    if (a.type !== 'thor' || b.type !== 'thor' || b.i - a.i > 2) continue;
    for (const sd of [-1, 1]) {
      for (const [ta, tb] of [[0.14, 0.42], [0.42, 0.14], [0.3, 0.6], [0.6, 0.3]]) {
        const ha = Math.min(ta, a.finTEnd * 0.92);
        const hb = Math.min(tb, b.finTEnd * 0.92);
        cable(B, M.bone, W(a, finSide(a, ha, sd)), W(b, finSide(b, hb, sd)), 0.32, 0.4, 10);
      }
    }
  }

  // ventral tendon under the centra
  const ventral = [];
  for (const u of units) {
    const y = u.type === 'patch' ? -u.Rc - 2.2 : -u.Rc * 0.9 - 2.4;
    ventral.push(W(u, V(-u.Lc * 0.3, y, 0)), W(u, V(u.Lc * 0.3, y, 0)));
  }
  for (let i = 1; i < ventral.length - 1; i += 2) {
    const a = ventral[i];
    const b = ventral[i + 1];
    cable(B, M.bronze, a, b, 0.75, 1.6, 8);
  }
  for (let i = 0; i < ventral.length; i += 2) cable(B, M.bronze, ventral[i], ventral[i + 1], 0.75, -0.3, 6);

  // guy-line stays from the end fins to anchor blocks on the rims
  const anchors = [];
  const stay = (u, side, s, off) => {
    const [x, z] = F.toXZ(s, off);
    const gy = ctx.heightAt(x, z);
    const pa = W(u, u.finPath(0.72));
    const pb = V(x, gy + 3.5, z);
    cable(B, M.iron, pa, pb, 0.3, 0.012 * pa.distanceTo(pb), 18);
    anchors.push({ x, z, y: gy, dir: pa.clone().sub(pb).normalize() });
    // anchor: a basalt block sunk in the rim with a bronze eye
    const blk = new THREE.BoxGeometry(6, 7, 6);
    B.add(blk, M.basalt, new THREE.Matrix4().makeRotationY(side * 0.3 + s * 0.01).setPosition(x, gy + 0.5, z), 0.8);
    const eye = new THREE.TorusGeometry(1.4, 0.45, 6, 14);
    const q = new THREE.Quaternion().setFromUnitVectors(V(0, 0, 1), V(-(pa.z - pb.z), 0, pa.x - pb.x).normalize());
    B.add(eye, M.bronze, new THREE.Matrix4().compose(V(x, gy + 4.6, z), q, V(1, 1, 1)), 1);
  };
  const west = units.filter((u) => u.type === 'thor')[0];
  const east = units.filter((u) => u.type === 'lumb')[1];
  for (const sd of [-1, 1]) {
    stay(west, sd, F.rimW - 34, sd * 58);
    stay(west, sd, F.rimW - 12, sd * 74);
    stay(east, sd, F.rimE + 34, sd * 60);
    stay(east, sd, F.rimE + 12, sd * 76);
  }
  return { anchors };
}
