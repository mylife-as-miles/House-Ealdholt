// Where the ruins stand. Anchors are hand-placed for composition (seen from the spawn ridge, on the
// flight lines between landmarks, framing a landmark), then snapped by a deterministic local search
// to ground that suits the archetype: flat for plazas and colonnades, a slope for the great rings,
// a crest for the waymarkers, the shallows for the drowned ruins. Nothing lands inside a landmark
// clear zone (layout.isReserved) or footprint, the canyon, the aqueduct or the avenue corridor.

import * as S from './ruins-sites.js';

// [type, x, z, search radius, options]
// opts.face: [x, z] to aim the site's +z axis at (else random / downhill for rings)
const ANCHORS = [
  // --- gates ---
  ['gatePylon', -820, 760, 160, { face: [250, -700] }], // foreground from the spawn ridge
  ['gateSlab', 720, -1260, 220, {}],
  ['gateTriple', -300, 1130, 160, { face: [-450, 1650] }], // forced perspective at the Temple
  ['gateRing', 620, 1150, 220, { face: [80, 40] }],
  ['gatePylon', 2150, -700, 220, { face: [1720, 0] }],
  ['gateSlab', -2350, 250, 220, { face: [-1750, -150] }],
  ['gateRing', -620, -1260, 160, { face: [320, -1750] }],
  ['gateTriple', 1900, 1350, 220, { face: [1350, 1650] }],
  // --- colonnades ---
  ['colonnade', -1000, 290, 120, { flat: true }],
  ['colonnade', 980, -520, 180, {}],
  ['colonnade', 320, 1320, 220, { hover: true }], // the columns that remember their height
  ['colonnade', -2200, -560, 160, {}],
  ['colonnade', 2050, 1150, 220, {}],
  ['colonnade', -60, -1320, 180, {}],
  // --- obelisks ---
  ['obeliskStanding', -1320, -920, 160, {}],
  ['obeliskStanding', 860, -300, 140, {}],
  ['obeliskStanding', 2300, 320, 220, {}],
  ['obeliskStanding', -1550, 1720, 220, {}],
  ['obeliskToppled', 1100, -1700, 200, {}],
  ['obeliskToppled', -220, 2020, 220, {}],
  ['obeliskToppled', 2000, 1500, 220, {}],
  ['obeliskToppled', -2480, -1050, 220, {}],
  ['obeliskToppled', -700, 500, 140, {}],
  // --- great rings (slopes) ---
  ['greatRing', -2600, 620, 260, { slope: true }],
  ['greatRing', 1650, -1850, 260, { slope: true }],
  ['greatRing', 620, 2100, 260, { slope: true }],
  ['greatRing', 2420, -320, 260, { slope: true }],
  // --- descents (flat) ---
  ['descent', 480, 790, 120, { flat: true, face: [80, 40] }], // south shore, stair falls toward the lake
  ['descent', 1760, 880, 140, { flat: true }],
  // --- door processions: all aimed at the door atop the Stair to Nowhere ---
  ['doorProcession', -1520, -1080, 180, { face: [-420, 300] }],
  ['doorProcession', 520, -820, 180, { face: [-420, 300] }],
  ['doorProcession', -1560, 380, 160, { face: [-420, 300] }],
  // --- statue fragments ---
  ['colossalHead', -760, -250, 160, {}],
  ['colossalHead', 1500, 1100, 200, {}],
  ['colossalHead', -2020, -1020, 200, {}],
  ['colossalHand', -1380, 1520, 180, {}],
  ['colossalHand', 960, 180, 160, {}],
  // --- broken walls ---
  ['brokenWall', -2500, -700, 200, {}],
  ['brokenWall', 860, -1050, 180, {}],
  ['brokenWall', -520, 920, 160, {}],
  ['brokenWall', 2150, -1500, 220, {}],
  ['brokenWall', -2000, 520, 200, {}],
  // --- the sunken plaza ---
  ['sunkenPlaza', 1230, -160, 120, { flat: true }], // east of the lake, in the last light
];

const RADIUS = {
  gatePylon: 44, gateSlab: 40, gateTriple: 70, gateRing: 32, colonnade: 80, obeliskStanding: 18,
  obeliskToppled: 55, greatRing: 65, descent: 70, doorProcession: 90, colossalHead: 32,
  colossalHand: 30, brokenWall: 80, sunkenPlaza: 62, stele: 8, cairn: 6, drownedStair: 36,
  drownedGate: 26, drownedPavilion: 22, drownedColonnade: 50,
};

/** Coarse cached height grid (bilinear) — cheap enough to score thousands of candidates. */
function heightGrid(heightAt, half = 2950, step = 70) {
  const n = Math.floor((2 * half) / step) + 1;
  const a = new Float32Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) a[j * n + i] = heightAt(-half + i * step, -half + j * step);
  return (x, z) => {
    const fx = Math.min(n - 1.001, Math.max(0, (x + half) / step));
    const fz = Math.min(n - 1.001, Math.max(0, (z + half) / step));
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const u = fx - i;
    const v = fz - j;
    const k = j * n + i;
    return (a[k] * (1 - u) + a[k + 1] * u) * (1 - v) + (a[k + n] * (1 - u) + a[k + n + 1] * u) * v;
  };
}

export function planSites(ctx, rng, { corridor = [] } = {}) {
  const { layout, canyonDistance } = ctx;
  const heightAt = ctx.heightAt;
  const hg = heightGrid(heightAt);
  const placed = [];
  const lms = layout.LANDMARKS;

  const blocked = (x, z, r) => {
    if (Math.hypot(x, z) > 2850) return true;
    if (layout.isReserved(x, z, r + 40)) return true;
    for (const l of lms) if (l.clear <= 0 && Math.hypot(x - l.x, z - l.z) < l.radius + r + 30) return true;
    if (canyonDistance(x, z).d < 240 + r) return true;
    // rock formations (sea stacks, arches, hoodoos) are placed before the ruins
    if (ctx.rocks?.blocked?.(x, z, r + 10)) return true;
    for (const p of placed) if (Math.hypot(x - p.x, z - p.z) < r + p.r + 30) return true;
    for (const c of corridor) if (Math.hypot(x - c[0], z - c[1]) < r + c[2]) return true;
    return false;
  };
  const relief = (x, z, r) => {
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const h = hg(x + Math.cos(a) * r, z + Math.sin(a) * r);
      lo = Math.min(lo, h);
      hi = Math.max(hi, h);
    }
    const hc = hg(x, z);
    return { lo: Math.min(lo, hc), hi: Math.max(hi, hc), hc };
  };

  for (const [type, ax, az, sr, opts] of ANCHORS) {
    const r = RADIUS[type];
    let best = null;
    const tries = 26;
    for (let t = 0; t < tries; t++) {
      const a = rng() * Math.PI * 2;
      const d = t === 0 ? 0 : sr * Math.sqrt(rng());
      const x = ax + Math.cos(a) * d;
      const z = az + Math.sin(a) * d;
      if (blocked(x, z, r)) continue;
      const rl = relief(x, z, r * 0.8);
      if (rl.lo < 3 || rl.hc > 650) continue;
      const range = rl.hi - rl.lo;
      let score;
      if (opts.slope) {
        const sl = range / (r * 1.6);
        score = -Math.abs(sl - 0.32) * 10;
      } else if (opts.flat) {
        score = -range;
      } else {
        score = -Math.max(0, range - r * 0.25) * 0.6;
      }
      score -= (d / sr) * 2; // prefer staying near the anchor
      if (!best || score > best.score) best = { x, z, score };
    }
    if (!best) continue;
    const g = heightAt(best.x, best.z);
    let yaw;
    if (opts.slope) {
      const n = ctx.normalAt(best.x, best.z);
      yaw = Math.atan2(n.x, n.z); // +z faces downhill
    } else if (opts.face) {
      yaw = Math.atan2(opts.face[0] - best.x, opts.face[1] - best.z);
    } else {
      yaw = rng() * Math.PI * 2;
    }
    placed.push({ type, x: best.x, z: best.z, g, yaw, r, id: placed.length, hover: !!opts.hover });
  }

  // --- waymarkers on crests: local height maxima standing proud of their surroundings ---
  const cands = [];
  const step = 115;
  for (let x = -2700; x <= 2700; x += step) {
    for (let z = -2700; z <= 2700; z += step) {
      const jx = x + (rng() - 0.5) * step * 0.6;
      const jz = z + (rng() - 0.5) * step * 0.6;
      if (Math.hypot(jx, jz) > 2700) continue;
      const h = hg(jx, jz);
      if (h < 25 || h > 560) continue;
      let sum = 0;
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        sum += hg(jx + Math.cos(a) * 95, jz + Math.sin(a) * 95);
      }
      const ridge = h - sum / 6;
      if (ridge > 9) cands.push({ x: jx, z: jz, h, ridge });
    }
  }
  cands.sort((a, c) => c.ridge - a.ridge);
  const markers = [];
  for (const c of cands) {
    if (markers.length >= 26) break;
    if (blocked(c.x, c.z, 10)) continue;
    if (markers.some((m) => Math.hypot(m.x - c.x, m.z - c.z) < 300)) continue;
    const type = rng() < 0.62 ? 'stele' : 'cairn';
    const m = { type, x: c.x, z: c.z, g: heightAt(c.x, c.z), yaw: rng() * Math.PI * 2, r: RADIUS[type], id: placed.length };
    markers.push(m);
    placed.push(m);
  }

  // --- minor fragments scattered through open, gentle land ---
  {
    let n = 0;
    for (let t = 0; t < 800 && n < 46; t++) {
      const a = rng() * Math.PI * 2;
      const rr = 250 + Math.sqrt(rng()) * 2450;
      const x = Math.cos(a) * rr;
      const z = Math.sin(a) * rr;
      if (blocked(x, z, 16)) continue;
      const rl = relief(x, z, 14);
      if (rl.lo < 4 || rl.hc > 520 || rl.hi - rl.lo > 7) continue;
      placed.push({ type: 'fragment', x, z, g: heightAt(x, z), yaw: rng() * Math.PI * 2, r: 16, id: placed.length, kind: n % 5 });
      n++;
    }
  }

  // --- drowned ruins at the lake edge: walk out from the shore to the shallows ---
  const L = layout.LAKE;
  const drowned = [
    ['drownedStair', -0.95],
    ['drownedGate', 1.9],
    ['drownedPavilion', 2.55],
    ['drownedColonnade', 1.25],
    ['drownedHand', -0.35],
  ];
  for (const [type, ang0] of drowned) {
    let done = false;
    for (let k = 0; k < 14 && !done; k++) {
      const ang = ang0 + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.07;
      const dx = Math.cos(ang);
      const dz = Math.sin(ang);
      // find the shoreline along this ray (first point from outside where ground < 0)
      let shore = -1;
      for (let rr = 1250; rr > 300; rr -= 8) {
        if (heightAt(L.x + dx * rr, L.z + dz * rr) < 0) {
          shore = rr;
          break;
        }
      }
      if (shore < 0) continue;
      const inset = type === 'drownedStair' ? 4 : type === 'drownedColonnade' ? 30 : type === 'drownedHand' ? 45 : 38;
      const x = L.x + dx * (shore - inset);
      const z = L.z + dz * (shore - inset);
      const r = RADIUS[type] ?? 20;
      // lake sites may sit in the water: only check landmark zones and spacing
      if (layout.isReserved(x, z, r + 40)) continue;
      let bad = false;
      for (const l of lms) if (l.clear <= 0 && Math.hypot(x - l.x, z - l.z) < l.radius + r + 30) bad = true;
      for (const p of placed) if (Math.hypot(x - p.x, z - p.z) < r + p.r + 30) bad = true;
      if (ctx.rocks?.blocked?.(x, z, r + 10)) bad = true;
      if (bad) continue;
      const yaw = Math.atan2(-dx, -dz); // +z points into the lake (toward the centre)
      placed.push({ type, x, z, g: heightAt(x, z), yaw, r, id: placed.length, shore });
      done = true;
    }
  }
  return placed;
}

export function buildSite(ctx, b, M, s) {
  const rng = ctx.noise.createRng(`ruins:${s.type}:${s.id}`);
  switch (s.type) {
    case 'gatePylon': return S.gatePylon(ctx, b, M, rng, s);
    case 'gateSlab': return S.gateSlab(ctx, b, M, rng, s);
    case 'gateTriple': return S.gateTriple(ctx, b, M, rng, s);
    case 'gateRing': return S.gateRing(ctx, b, M, rng, s);
    case 'colonnade': return S.colonnade(ctx, b, M, rng, s, { hover: s.hover });
    case 'obeliskStanding': return S.obeliskStanding(ctx, b, M, rng, s);
    case 'obeliskToppled': return S.obeliskToppled(ctx, b, M, rng, s);
    case 'greatRing': return S.greatRing(ctx, b, M, rng, s);
    case 'descent': return S.descent(ctx, b, M, rng, s);
    case 'doorProcession': return S.doorProcession(ctx, b, M, rng, s);
    case 'colossalHead': return S.colossalHead(ctx, b, M, rng, s);
    case 'colossalHand': return S.colossalHand(ctx, b, M, rng, s);
    case 'brokenWall': return S.brokenWall(ctx, b, M, rng, s);
    case 'sunkenPlaza': return S.sunkenPlaza(ctx, b, M, rng, s);
    case 'stele': return S.stele(ctx, b, M, rng, s);
    case 'cairn': return S.cairn(ctx, b, M, rng, s);
    case 'drownedStair': return S.drownedStair(ctx, b, M, rng, s);
    case 'drownedGate': return S.drownedGate(ctx, b, M, rng, s);
    case 'drownedPavilion': return S.drownedPavilion(ctx, b, M, rng, s);
    case 'drownedColonnade': return S.colonnade(ctx, b, M, rng, s, { drowned: true, rows: 2, count: 5, H: 16 });
    case 'drownedHand': return S.colossalHand(ctx, b, M, rng, s);
    case 'fragment': return S.fragment(ctx, b, M, rng, s);
    default: return null;
  }
}
