// The two ends of the Stair and what fell from it:
//   * the podium on the islet (a round paved drum with a low broken parapet), the dark eye of a
//     well on the helix axis, the basalt gate where the climb begins, the landing stair and the
//     jetty reaching into the lake;
//   * the top: the platform flaring out at the end of the unwound flight and the free-standing
//     basalt door frame with its bronze door slightly ajar onto 700 m of air (the leaf is a
//     separate mesh so it can breathe open and shut over minutes); light leaks from the gap;
//   * fragments: step blocks, slabs, balusters and a newel fallen onto the islet and the shallows.

import * as THREE from 'crownfall-world-three';
import { STAIR } from './stair-path.js';
import { lantern } from './stair-landings.js';
import { LightQuads } from './stair-light.js';

const ws = STAIR.stringer;
const CURB = STAIR.curb;
const UP = [0, 1, 0];
const _m = new THREE.Matrix4();
const _e = new THREE.Euler();
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3(1, 1, 1);

/** A block rotated by yaw/pitch/roll (fallen fragments). */
function tilted(w, x, y, z, sx, sy, sz, yaw, pitch, roll) {
  _e.set(pitch, yaw, roll, 'YXZ');
  _q.setFromEuler(_e);
  _m.compose(_v.set(0, 0, 0), _q, _s);
  const e = _m.elements;
  const ax = [e[0] * sx * 0.5, e[1] * sx * 0.5, e[2] * sx * 0.5];
  const ay = [e[4] * sy * 0.5, e[5] * sy * 0.5, e[6] * sy * 0.5];
  const az = [e[8] * sz * 0.5, e[9] * sz * 0.5, e[10] * sz * 0.5];
  w.box([x, y, z], ax, ay, az);
}

export const PODIUM_R = 35;

export function buildBase(ctx, P, W, rng) {
  const cx = P.cx, cz = P.cz;
  const yB = P.yBase;
  const top = yB - 0.08;
  const lamps = [];
  // lowest ground around the rim: the drum goes down to it
  let gMin = 1e9;
  for (let a = 0; a < 24; a++) {
    const t = (a / 24) * Math.PI * 2;
    gMin = Math.min(gMin, ctx.heightAt(cx + Math.cos(t) * (PODIUM_R + 2), cz + Math.sin(t) * (PODIUM_R + 2)));
  }
  const y0 = Math.min(gMin, yB - 3) - 2;
  const R = PODIUM_R;
  const w = W.low;
  const t0 = w.tint;
  w.tint = [t0[0] * 0.8, t0[1] * 0.82, t0[2] * 0.78];
  // drum: battered base, a band, the paved top
  w.lathe(cx, y0, cz, [[R + 2.2, 0], [R + 1.4, top - y0 - 2.6], [R + 1.4, top - y0 - 2.2], [R + 1.0, top - y0 - 2.0], [R + 1.0, top - y0 - 0.35], [R + 1.25, top - y0 - 0.25], [R + 1.25, top - y0]], 56, 0, { capTop: false });
  w.tint = [t0[0] * 0.86, t0[1] * 0.87, t0[2] * 0.84];
  // paving: concentric rings of slabs (cheap: a ringed fan, the material draws the joints)
  const rings = [0, 4.5, 11, 18, 26, R + 1.25];
  for (let r = 0; r < rings.length - 1; r++) {
    const n = 12 + r * 10;
    for (let k = 0; k < n; k++) {
      const a0 = (k / n) * Math.PI * 2, a1 = ((k + 1) / n) * Math.PI * 2;
      const r0 = rings[r], r1 = rings[r + 1];
      const tone = 0.9 + rng() * 0.14;
      w.tint = [t0[0] * 0.86 * tone, t0[1] * 0.87 * tone, t0[2] * 0.84 * tone];
      const p = (rr, a) => [cx + Math.cos(a) * rr, top, cz + Math.sin(a) * rr];
      if (r0 === 0) w.triN([cx, top, cz], p(r1, a0), p(r1, a1), UP);
      else w.quadN(p(r0, a0), p(r1, a0), p(r1, a1), p(r0, a1), UP);
    }
  }
  // the parapet: a low wall on the rim, broken in places, open toward the jetty
  const jd = Math.atan2(40 - cz, 80 - cx); // toward the lake centre
  w.tint = [t0[0] * 0.8, t0[1] * 0.82, t0[2] * 0.78];
  const nWall = 64;
  for (let k = 0; k < nWall; k++) {
    const a = (k / nWall) * Math.PI * 2;
    let da = Math.abs(((a - jd + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
    if (da < 0.13) continue; // the opening to the jetty stair
    if (rng() < 0.12) continue; // fallen
    const h = rng() < 0.15 ? 0.3 + rng() * 0.4 : 0.95;
    const x = cx + Math.cos(a) * (R + 0.55), z = cz + Math.sin(a) * (R + 0.55);
    const len = ((Math.PI * 2 * (R + 0.55)) / nWall) * 0.97;
    w.block(x, top + h / 2, z, 0.7, h, len, -a);
    if (h > 0.9) w.block(x, top + h + 0.07, z, 0.9, 0.14, len + 0.02, -a);
  }
  // the well: the helix axis, a black eye of still water
  W.basalt.lathe(cx, top, cz, [[3.3, 0], [3.3, 0.75], [3.5, 0.82], [3.5, 0.95], [2.7, 0.95], [2.7, 0.3]], 28, 0, { capTop: false });
  W.obsidian.lathe(cx, top + 0.3, cz, [[2.72, 0], [0.0, 0.0]], 28, 0, { capTop: false });
  W.bronze.lathe(cx, top + 0.95, cz, [[3.14, 0], [3.14, 0.05], [3.06, 0.05]], 28, 0, { capTop: false });
  w.tint = t0;

  // ---- the gate: a basalt frame where the climb begins (it rhymes with the door at the top)
  {
    const s = 4.5;
    const f = P.plan(s, {});
    const hw = P.width(s) / 2;
    const yaw = Math.atan2(f.tx, f.tz);
    const Hg = 9.5;
    for (const sd of [-1, 1]) {
      const u = sd * (hw + 0.5);
      const x = f.x + f.nx * u, z = f.z + f.nz * u;
      W.basalt.block(x, yB + Hg / 2, z, 1.9, Hg, 2.4, yaw);
      W.basalt.block(x, yB + 0.45, z, 2.4, 0.9, 2.9, yaw);
      // lamps on bronze brackets on the outer faces
      const lx = f.x + f.nx * (u + sd * 1.35) - f.tx * 1.3, lz = f.z + f.nz * (u + sd * 1.35) - f.tz * 1.3;
      W.bronze.strut([f.x + f.nx * (u + sd * 0.8) - f.tx * 1.25, yB + 5.6, f.z + f.nz * (u + sd * 0.8) - f.tz * 1.25], [lx, yB + 5.6, lz], 0.06, 0.06, 4);
      W.bronze.strut([lx, yB + 5.6, lz], [lx, yB + 5.05, lz], 0.03, 0.03, 4);
      lantern(W, lx, yB + 4.4, lz, 1.1, yaw);
      lamps.push([lx, yB + 4.4, lz]);
    }
    const x = f.x, z = f.z;
    W.basalt.block(x, yB + Hg + 1.0, z, 2 * hw + 3.4, 2.0, 2.8, yaw);
    W.basalt.block(x, yB + Hg + 2.35, z, 2 * hw + 4.2, 0.7, 3.3, yaw);
    W.basalt.block(x, yB + Hg + 3.1, z, 2 * hw + 1.2, 0.8, 2.2, yaw);
  }

  // ---- landing stair down the islet and the jetty into the lake
  {
    const dx = Math.cos(jd), dz = Math.sin(jd);
    const nx = -dz, nz = dx;
    const wj = 4.6;
    const yDeck = 1.15;
    const r0 = R + 1.3;
    const nSteps = Math.max(1, Math.round((top - yDeck) / 0.19));
    const rise = (top - yDeck) / nSteps;
    const runJ = 0.42;
    for (let k = 0; k < nSteps; k++) {
      const r = r0 + k * runJ + runJ / 2;
      const yt = top - (k + 1) * rise;
      const x = cx + dx * r, z = cz + dz * r;
      const g = ctx.heightAt(x, z);
      const yb = Math.min(g, yt) - 1.5;
      w.tint = [t0[0] * 0.84, t0[1] * 0.85, t0[2] * 0.82];
      w.block(x, (yt + yb) / 2, z, wj, yt - yb, runJ + 0.02, Math.PI / 2 - jd);
    }
    // cheek walls stepping down with the flight
    const rEnd = r0 + nSteps * runJ;
    for (const sd of [-1, 1]) {
      for (let k = 0; k < nSteps; k += 6) {
        const r = r0 + (k + 3) * runJ;
        const yt = top - (k + 3) * rise + 0.9;
        const x = cx + dx * r + nx * sd * (wj / 2 + 0.35), z = cz + dz * r + nz * sd * (wj / 2 + 0.35);
        const g = ctx.heightAt(x, z);
        const yb = Math.min(g, yt) - 1.5;
        w.block(x, (yt + yb) / 2, z, 0.7, yt - yb, runJ * 6 + 0.03, Math.PI / 2 - jd);
      }
    }
    // deck on piles
    const deckLen = 30;
    const rm = rEnd + deckLen / 2;
    w.tint = [t0[0] * 0.8, t0[1] * 0.81, t0[2] * 0.78];
    w.block(cx + dx * rm, yDeck - 0.4, cz + dz * rm, wj, 0.8, deckLen, Math.PI / 2 - jd);
    for (let r = rEnd + 2; r <= rEnd + deckLen - 1; r += 5.5) {
      for (const sd of [-1, 1]) {
        const x = cx + dx * r + nx * sd * (wj / 2 - 0.5), z = cz + dz * r + nz * sd * (wj / 2 - 0.5);
        const g = Math.min(ctx.heightAt(x, z), -1);
        w.tint = [t0[0] * 0.66, t0[1] * 0.7, t0[2] * 0.64];
        w.block(x, (yDeck - 0.8 + g - 1) / 2, z, 1.1, yDeck - 0.8 - g + 1, 1.1, Math.PI / 2 - jd);
      }
    }
    // bollards and a lamp at the end
    const re = rEnd + deckLen - 1.2;
    for (const sd of [-1, 1]) {
      const x = cx + dx * re + nx * sd * (wj / 2 - 0.45), z = cz + dz * re + nz * sd * (wj / 2 - 0.45);
      W.bronze.lathe(x, yDeck, z, [[0.26, 0], [0.2, 0.5], [0.3, 0.62], [0.28, 0.72], [0.0, 0.78]], 8, 0);
    }
    const lx = cx + dx * (re - 2) + nx * (wj / 2 - 0.45), lz = cz + dz * (re - 2) + nz * (wj / 2 - 0.45);
    W.bronze.lathe(lx, yDeck, lz, [[0.2, 0], [0.16, 0.2], [0.07, 0.3], [0.055, 3.2], [0.12, 3.3]], 6, 0);
    lantern(W, lx, yDeck + 3.3, lz, 1.0, jd);
    lamps.push([lx, yDeck + 3.3, lz]);
    w.tint = t0;
  }
  return { lamps };
}

/**
 * The top: platform + door frame (merged, static) and the door leaf (its own pivot, animated).
 * Returns { pivot, leafWidth, light: LightQuads pieces, glowAt, update }.
 */
export function buildTop(ctx, P, W, leafMat) {
  const s0 = P.sTop0;
  const f = P.plan(s0, {});
  const T = [f.tx, 0, f.tz];
  const N = [f.nx, 0, f.nz];
  const y = P.yTop;
  const yaw = Math.atan2(f.tx, f.tz);
  const at = (t, u, v) => [f.x + T[0] * t + N[0] * u, y + v, f.z + T[2] * t + N[2] * u];
  const w = W.top;
  const hw0 = P.width(s0 - 0.01) / 2;
  const L = 14;
  const HW = 8.2;
  const dP = 1.4;
  // platform outline (t, u): the stair's width flaring out to carry the door
  const outline = [[0, -hw0], [4.5, -HW], [L, -HW], [L, HW], [4.5, HW], [0, hw0]];
  const n = outline.length;
  const topP = outline.map(([t, u]) => at(t, u, 0));
  const botP = outline.map(([t, u]) => at(t, u, -dP));
  for (let k = 1; k < n - 1; k++) {
    w.triN(topP[0], topP[k], topP[k + 1], UP);
    w.triN(botP[0], botP[k], botP[k + 1], [0, -1, 0]);
  }
  for (let k = 0; k < n; k++) {
    const a = k, b = (k + 1) % n;
    if (k === n - 1) continue; // joins the stair
    const ta = outline[a], tb = outline[b];
    const mt = (ta[0] + tb[0]) / 2, mu = (ta[1] + tb[1]) / 2;
    const out = [T[0] * (mt - L / 2) + N[0] * mu, 0, T[2] * (mt - L / 2) + N[2] * mu];
    w.quadN(topP[a], botP[a], botP[b], topP[b], out);
  }
  // a stepped corbel under the cantilevered platform
  w.box(at(L / 2 + 0.5, 0, -dP - 0.45), [N[0] * (HW - 0.8), 0, N[2] * (HW - 0.8)], [0, 0.45, 0], [T[0] * (L / 2 - 1.5), 0, T[2] * (L / 2 - 1.5)]);
  w.box(at(L / 2 + 1, 0, -dP - 1.2), [N[0] * (HW - 2.2), 0, N[2] * (HW - 2.2)], [0, 0.3, 0], [T[0] * (L / 2 - 3), 0, T[2] * (L / 2 - 3)]);
  // curbs along the flared sides (broken toward the edge)
  for (const sd of [-1, 1]) {
    const p0 = at(0.2, sd * (hw0 - 0.35), CURB / 2), p1 = at(4.5, sd * (HW - 0.35), CURB / 2);
    const len = Math.hypot(p1[0] - p0[0], p1[2] - p0[2]);
    w.block((p0[0] + p1[0]) / 2, CURB / 2 + y, (p0[2] + p1[2]) / 2, 0.7, CURB, len + 0.4, Math.atan2(p1[0] - p0[0], p1[2] - p0[2]));
    const b = at(4.5 + 2.9, sd * (HW - 0.35), CURB / 2);
    w.block(b[0], b[1], b[2], 0.7, CURB, 5.8, yaw);
  }

  // ---- the door frame (basalt): plinths, jambs, lintel, a flared stepped cornice, a crown;
  // a bronze architrave line around the opening on the stair face catches the low sun
  const wo = 7.4; // clear opening
  const ho = 20.5;
  const jw = 2.6;
  const jd = 3.0;
  const tD = 11.2; // frame centre along the platform
  const B = W.basalt;
  const Wf = wo + 2 * jw;
  for (const sd of [-1, 1]) {
    const c = at(tD, sd * (wo / 2 + jw / 2), ho / 2);
    B.block(c[0], c[1], c[2], jw, ho, jd, yaw);
    const pl = at(tD, sd * (wo / 2 + jw / 2 + 0.15), 0.9);
    B.block(pl[0], pl[1], pl[2], jw + 0.7, 1.8, jd + 0.6, yaw);
    // bronze architrave: vertical strips framing the opening, proud of the stair face
    const rv = at(tD - jd / 2 - 0.06, sd * (wo / 2 + 0.36), (ho + 0.4) / 2 + 0.9);
    W.bronze.block(rv[0], rv[1], rv[2], 0.42, ho - 0.5, 0.14, yaw);
  }
  {
    const ar = at(tD - jd / 2 - 0.06, 0, ho + 0.2);
    W.bronze.block(ar[0], ar[1], ar[2], wo + 1.14, 0.42, 0.14, yaw);
    const c = at(tD, 0, ho + 1.8);
    B.block(c[0], c[1], c[2], Wf, 3.6, jd, yaw);
    const k1 = at(tD, 0, ho + 3.95);
    B.block(k1[0], k1[1], k1[2], Wf + 0.7, 0.7, jd + 0.6, yaw);
    const k2 = at(tD, 0, ho + 4.7);
    B.block(k2[0], k2[1], k2[2], Wf + 1.6, 0.8, jd + 1.5, yaw);
    const k3 = at(tD, 0, ho + 5.22);
    B.block(k3[0], k3[1], k3[2], Wf + 2.0, 0.25, jd + 1.9, yaw);
    const a = at(tD, 0, ho + 6.1);
    B.block(a[0], a[1], a[2], Wf - 2.0, 1.5, jd - 0.5, yaw);
    const kk = at(tD, 0, ho + 7.25);
    B.block(kk[0], kk[1], kk[2], 2.4, 0.8, jd - 1.0, yaw);
    // bronze sill
    const sl = at(tD - 0.2, 0, 0.03);
    W.bronze.block(sl[0], sl[1], sl[2], wo + 0.2, 0.06, jd * 0.8, yaw);
  }

  // ---- the leaf: bronze, hinged on the -u jamb, opening toward the stair (−T)
  const leaf = new THREE.Group();
  const lw = new (W.bronze.constructor)('door-leaf');
  const th = 0.5;
  const tLeaf = tD - jd / 2 + 0.55; // closed plane, rebated into the stair face of the frame
  // leaf in pivot space: x from 0 (hinge) to wo, y up, z thickness (centred)
  lw.block(wo / 2, ho / 2, 0, wo - 0.04, ho - 0.02, th);
  // stiles and rails on both faces (raised frames around 2 x 5 panels)
  for (const zf of [-1, 1]) {
    const z = zf * (th / 2 + 0.05);
    for (const x of [0.3, wo / 2, wo - 0.3]) lw.block(x, ho / 2, z, 0.5, ho - 0.1, 0.1);
    for (let r = 0; r <= 5; r++) lw.block(wo / 2, 0.3 + (r / 5) * (ho - 0.6), z, wo - 0.2, 0.42, 0.1);
    // bosses at the rail crossings
    for (let r = 1; r < 5; r++) for (const x of [wo / 2]) lw.block(x, 0.3 + (r / 5) * (ho - 0.6), z * 1.3, 0.34, 0.34, 0.1);
  }
  // a great ring pull on the stair face, near the free edge
  lw.strut([wo - 1.1, 9.6, -th / 2 - 0.14], [wo - 1.1, 8.4, -th / 2 - 0.42], 0.07, 0.07, 6);
  lw.lathe(wo - 1.1, 9.4, -th / 2 - 0.14, [[0.28, 0], [0.33, 0.25], [0.0, 0.42]], 8, 0);
  const leafGeo = lw.geometry();
  const leafMesh = new THREE.Mesh(leafGeo, leafMat);
  leafMesh.name = 'stair:door-leaf';
  leafMesh.castShadow = true;
  leafMesh.receiveShadow = true;
  leaf.add(leafMesh);
  // the pivot: at the hinge line, local x → +N, local z → +T (flip if needed for handedness)
  const pivot = new THREE.Group();
  pivot.name = 'stair:door';
  const hinge = at(tLeaf, -wo / 2, 0);
  pivot.position.set(hinge[0], hinge[1], hinge[2]);
  const basis = new THREE.Matrix4().makeBasis(new THREE.Vector3(N[0], 0, N[2]), new THREE.Vector3(0, 1, 0), new THREE.Vector3(T[0], 0, T[2]));
  let openSign = 1;
  if (basis.determinant() < 0) {
    basis.makeBasis(new THREE.Vector3(N[0], 0, N[2]), new THREE.Vector3(0, 1, 0), new THREE.Vector3(-T[0], 0, -T[2]));
    openSign = -1;
  }
  pivot.quaternion.setFromRotationMatrix(basis);
  pivot.add(leaf);
  // opening toward −T: rotation about local y; with z = +T a positive angle swings the free
  // edge (x = wo) toward −z = −T
  const baseOpen = 0.62;
  leaf.rotation.y = baseOpen * openSign;

  // ---- light leaking through the gap (quads facing −T, toward anyone on the stair)
  const Lq = new LightQuads();
  const gapU = wo / 2; // the jamb edge the free edge swings away from
  const pSrc = tLeaf + th / 2 + 0.5; // light plane just behind the closed leaf
  const back = [-T[0], 0, -T[2]];
  // the sliver: the whole opening lit from behind — only the gap shows it
  Lq.quad(at(pSrc, gapU, 0), at(pSrc, -gapU, 0), at(pSrc, -gapU, ho), at(pSrc, gapU, ho), 3.2, [0.3, 0.3], back);
  // glow on the jamb reveal beside the gap
  Lq.quad(at(pSrc, gapU - 0.01, 0), at(tD - jd / 2 - 0.02, gapU - 0.01, 0), at(tD - jd / 2 - 0.02, gapU - 0.01, ho), at(pSrc, gapU - 0.01, ho), 1.1, [0.0, 0.7], [-N[0], 0, -N[2]]);
  // the blade of light laid on the platform toward the stair, fanning from the gap
  const bl = tLeaf - 0.3;
  const fy = 0.025;
  Lq.quad(at(tLeaf, gapU + 0.05, fy), at(tLeaf, gapU - 1.0, fy), at(tLeaf - bl, gapU - 3.3, fy), at(tLeaf - bl, gapU + 0.35, fy), 1.3, [0, 1], UP);
  return {
    pivot, leaf, openSign, baseOpen, wo, tD, lightQuads: Lq,
    glowAt: at(tLeaf - 0.4, gapU - 0.4, ho * 0.45),
    at,
  };
}

/** Fallen pieces: below the breaches, around the podium, in the shallows. */
export function buildFragments(ctx, P, W, rng, info) {
  const pieces = [];
  const place = (x, z, kind) => {
    const g = ctx.heightAt(x, z);
    if (g < -3.5) return; // lost in deep water
    pieces.push({ x, z, g, kind });
  };
  // under each breach: what fell straight down
  for (const b of info.breaches) {
    const sm = (b.s0 + b.s1) / 2;
    const f = P.plan(sm, {});
    for (let k = 0; k < 16; k++) {
      const r = 3 + rng() * 16;
      const a = rng() * Math.PI * 2;
      place(f.x + Math.cos(a) * r, f.z + Math.sin(a) * r, rng() < 0.3 ? 'slab' : 'step');
    }
  }
  // around the base: the lower flights' missing treads and rails, collected by time
  for (let k = 0; k < 46; k++) {
    const r = 12 + rng() * 48;
    const a = rng() * Math.PI * 2;
    const x = P.cx + Math.cos(a) * r, z = P.cz + Math.sin(a) * r;
    if (r < PODIUM_R + 2 && rng() < 0.55) continue;
    place(x, z, rng.pick(['step', 'step', 'baluster', 'baluster', 'rail', 'slab']));
  }
  const w = W.low;
  const t0 = w.tint;
  for (const p of pieces) {
    const onPodium = Math.hypot(p.x - P.cx, p.z - P.cz) < PODIUM_R + 0.5;
    const gy = onPodium ? P.yBase - 0.08 : p.g;
    const yaw = rng() * Math.PI * 2;
    const k = 0.72 + rng() * 0.16;
    w.tint = [t0[0] * k, t0[1] * k * 1.01, t0[2] * k * 0.95];
    if (p.kind === 'step') {
      const sx = 1.6 + rng() * 3.2, sy = 0.24, sz = 0.36 + rng() * 0.2;
      tilted(w, p.x, gy + sy * 0.25, p.z, sx, sy + 0.14, sz, yaw, (rng() - 0.5) * 0.3, (rng() - 0.5) * 0.25);
    } else if (p.kind === 'slab') {
      const sx = 2 + rng() * 3.5, sy = 0.9 + rng() * 0.6, sz = 1.5 + rng() * 2.5;
      const sink = p.g < 0 ? 0.2 : 0.45;
      tilted(w, p.x, gy + sy * (0.5 - sink), p.z, sx, sy, sz, yaw, (rng() - 0.5) * 0.9, (rng() - 0.5) * 0.7);
    } else if (p.kind === 'baluster') {
      const L = 0.86;
      const dx = Math.cos(yaw) * L, dz = Math.sin(yaw) * L;
      w.strut([p.x, gy + 0.08, p.z], [p.x + dx, gy + 0.1, p.z + dz], 0.09, 0.07, 4);
    } else {
      const L = 1.5 + rng() * 3;
      tilted(w, p.x, gy + 0.1, p.z, 0.52, 0.24, L, yaw, (rng() - 0.5) * 0.2, (rng() - 0.5) * 0.3);
    }
  }
  // a toppled newel with its bronze finial, and a long stringer section leaning on the podium
  {
    const a = 2.4;
    const x = P.cx + Math.cos(a) * (PODIUM_R + 5), z = P.cz + Math.sin(a) * (PODIUM_R + 5);
    const g = ctx.heightAt(x, z);
    if (g > -2) {
      w.tint = [t0[0] * 0.8, t0[1] * 0.8, t0[2] * 0.76];
      tilted(w, x, g + 0.25, z, 0.66, 2.0, 0.66, 0.4, Math.PI / 2 - 0.08, 0.1);
      W.bronze.lathe(x + Math.cos(0.4) * 1.3, g + 0.1, z - Math.sin(0.4) * 1.3, [[0.16, 0], [0.24, 0.12], [0.2, 0.3], [0.0, 0.42]], 6, 0);
    }
    const a2 = 3.9;
    const x2 = P.cx + Math.cos(a2) * (PODIUM_R + 4.5), z2 = P.cz + Math.sin(a2) * (PODIUM_R + 4.5);
    const g2 = ctx.heightAt(x2, z2);
    if (g2 > -2) {
      w.tint = [t0[0] * 0.74, t0[1] * 0.76, t0[2] * 0.7];
      tilted(w, x2, g2 + 1.6, z2, 1.2, 2.2, 9, -a2 + Math.PI / 2, 0.32, 0.1);
    }
  }
  w.tint = t0;
  return pieces.length;
}
