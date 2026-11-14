// Choir plan: where every stone stands and what became of it.
//
// A paved processional path winds 1.5 turns inward on a logarithmic spiral (start: east, toward
// the aqueduct; end: the amphitheatre gate facing the sunset). The stones stand in five choir
// rows along a spiral band half a turn out of phase with it, so path and choir interleave as a
// double spiral; all face the centre, growing from ~6 m at the outer end of the band to ~100 m
// where it meets the amphitheatre. Then the roles: floaters, leaning pairs, split stones, sunk and tilted ones,
// empty plinths, and the fallen — each fallen stone picks the clearest direction to lie in; the
// one fallen giant crushed the smaller stones along its fall.
//
// All coordinates are site-local (root group sits at site.x, 0, site.z).

export const AMPH = { R0: 34, STEPS: 12, RISE: 1.2, TREAD: 3.9, TERRACE: 6, OUTER: 6.8, GAP: 0.09 };

export function makePlan(ctx, site, rng) {
  const gh = (x, z) => ctx.heightAt(site.x + x, site.z + z);

  // --- amphitheatre levels ----------------------------------------------------------------
  const A = AMPH;
  const Rtop = A.R0 + A.STEPS * A.TREAD;
  const Rrim = Rtop + A.TERRACE;
  const Rout = Rrim + A.OUTER;
  let gIn = -Infinity;
  let gLow = Infinity;
  for (let i = 0; i < 32; i++) {
    const a = (i / 32) * Math.PI * 2;
    for (const r of [0, 10, 20, 28, A.R0]) gIn = Math.max(gIn, gh(Math.cos(a) * r, Math.sin(a) * r));
    for (const r of [A.R0, 50, 70, Rrim, Rout, Rout + 4]) gLow = Math.min(gLow, gh(Math.cos(a) * r, Math.sin(a) * r));
  }
  const floorY = gIn + 0.35;
  const amph = { ...A, Rtop, Rrim, Rout, floorY, gLow, rimY: floorY + A.STEPS * A.RISE, gate: Math.PI };

  // --- processional path: logarithmic spiral, 1.5 turns ----------------------------------------
  const pIn = Rout + 5;
  const pOut = 585;
  const turns = 1.5;
  const b = Math.log(pOut / pIn) / (turns * Math.PI * 2);
  const path = [];
  {
    let phi = amph.gate;
    const end = amph.gate + turns * Math.PI * 2;
    const k = Math.sqrt(1 + b * b);
    while (phi <= end) {
      const r = pIn * Math.exp(b * (phi - amph.gate));
      // tangent of r(phi) = pIn e^(b phi): d/dphi (r cos, r sin) = r (b cos - sin, b sin + cos)
      const tx = b * Math.cos(phi) - Math.sin(phi);
      const tz = b * Math.sin(phi) + Math.cos(phi);
      const tl = Math.hypot(tx, tz);
      path.push({ x: r * Math.cos(phi), z: r * Math.sin(phi), r, phi, tx: tx / tl, tz: tz / tl });
      phi += 3 / (r * k);
    }
  }
  // radial gate passage from the spiral's inner end to the floor
  const passage = [];
  for (let r = A.R0 - 2; r <= pIn + 0.1; r += 3) passage.push({ x: -r, z: 0, r, phi: Math.PI, tx: 1, tz: 0 });
  const pathDist = (x, z) => {
    let best = Infinity;
    for (let i = 0; i < path.length; i += 2) {
      const p = path[i];
      const d = (p.x - x) * (p.x - x) + (p.z - z) * (p.z - z);
      if (d < best) best = d;
    }
    if (z > -20 && z < 20 && x < 0 && x > -pIn - 10) best = Math.min(best, z * z);
    return Math.sqrt(best);
  };

  // --- the stones: choir rows on a spiral band, half a turn out of phase with the path ------------
  // Row j follows r = pIn * e^(b (phi - gate + PI + sig_j)): the band's centre sits midway (in log
  // space) between successive turns of the path, so band and path interleave as a double spiral.
  const rMin = 118;
  const rMax = 510;
  const ROWS = 5;
  const BAND = 0.62; // fraction of each turn occupied by the band
  const kb = Math.sqrt(1 + b * b);
  const stones = [];
  const rows = [];
  for (let j = 0; j < ROWS; j++) {
    const sig = (j / (ROWS - 1) - 0.5) * 2 * BAND * Math.PI * 0.92;
    const rowR = (phi) => pIn * Math.exp(b * (phi - amph.gate + Math.PI + sig));
    let phi = amph.gate - Math.PI - sig + Math.log(rMin / pIn) / b;
    rows.push({ sig, phi0: phi, phi1: amph.gate - Math.PI - sig + Math.log(rMax / pIn) / b });
    let first = true;
    for (let guard = 0; guard < 400; guard++) {
      const r0 = rowR(phi);
      if (r0 > rMax) break;
      const u = Math.min(1, Math.max(0, (r0 - rMin) / (rMax - rMin)));
      const h = (6 + 88 * Math.pow(1 - u, 2.1)) * rng.range(0.78, 1.14);
      const w = Math.min(17, Math.max(2.2, (0.14 * h + 1.4) * rng.range(0.85, 1.15)));
      const d = Math.max(0.65, w * (h > 40 ? rng.range(0.14, 0.21) : rng.range(0.19, 0.27)));
      const sp = w * 1.35 + 4 + 0.03 * r0;
      if (first && j % 2) {
        phi += (0.5 * sp) / (r0 * kb);
        first = false;
        continue;
      }
      first = false;
      const th = phi + rng.range(-0.8, 0.8) / r0;
      const r = r0 + rng.range(-0.8, 0.8);
      const x = r * Math.cos(th);
      const z = r * Math.sin(th);
      const yaw = Math.atan2(-Math.cos(th), -Math.sin(th)) + rng.range(-0.04, 0.04);
      const pa = w / 2 + 0.5 + 0.1 * w;
      const pb = d / 2 + 0.5 + 0.1 * w;
      const foot = Math.hypot(pa + 1.1, pb + 1.1);
      const salt = rng();
      phi += sp / (r0 * kb);
      if (pathDist(x, z) < 3.7 + 2.2 + foot) continue;
      if (r - foot < Rout + 5) continue;
      stones.push({ i: stones.length, x, z, r, th, h, w, d, yaw, pa, pb, foot, sp, row: j, role: 'stand', salt });
    }
  }

  // --- roles ----------------------------------------------------------------------------------
  const order = stones.map((s) => s.i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const take = (count, role, ok) => {
    let c = 0;
    for (const i of order) {
      if (c >= count) break;
      const s = stones[i];
      if (s.role !== 'stand' || !ok(s)) continue;
      s.role = role;
      c++;
    }
  };
  take(18, 'float', (s) => s.h > 14 && s.h < 78 && s.r > 150);
  take(11, 'pair', (s) => s.h > 12 && s.h < 36);
  take(1, 'fallen', (s) => s.h > 80);
  take(15, 'fallen', (s) => s.h > 9 && s.h < 85);
  take(30, 'sunk', (s) => s.r > 190);
  take(26, 'split', (s) => s.h > 10);
  take(9, 'empty', (s) => s.h < 60);

  const inAmph = (x, z) => Math.hypot(x, z) < Rout + 3;
  for (const F of stones) {
    if (F.role !== 'fallen') continue;
    const giant = F.h > 80;
    const stumpH = F.h * (giant ? 0.16 : rng.range(0.12, 0.35));
    const L = F.h - stumpH;
    let best = null;
    const base = rng() * Math.PI * 2;
    for (let k = 0; k < 16; k++) {
      const a = base + (k / 16) * Math.PI * 2;
      const dx = Math.cos(a);
      const dz = Math.sin(a);
      let free = L + F.foot;
      const crush = [];
      for (const O of stones) {
        if (O === F) continue;
        const ox = O.x - F.x;
        const oz = O.z - F.z;
        const s = ox * dx + oz * dz;
        if (s < 0 || s > free + O.foot) continue;
        const lat = Math.abs(ox * dz - oz * dx);
        if (lat > O.foot * 0.85 + F.w * 0.5) continue;
        if (giant && O.h < F.h * 0.7 && (O.role === 'stand' || O.role === 'sunk' || O.role === 'split')) crush.push(O);
        else free = Math.min(free, s - O.foot);
      }
      for (let s = F.foot; s < free; s += 3) {
        const px = F.x + dx * s;
        const pz = F.z + dz * s;
        if (inAmph(px, pz) || pathDist(px, pz) < 4.2 + F.w * 0.5) {
          free = s;
          break;
        }
      }
      const score = free + (giant ? -crush.length * 4 : 0);
      if (!best || score > best.score) best = { score, free, dx, dz, crush: crush.filter((O) => (O.x - F.x) * dx + (O.z - F.z) * dz < free) };
    }
    F.fall = { dx: best.dx, dz: best.dz, stumpH, len: Math.max(0, Math.min(L, best.free - F.foot - 1)), total: L };
    for (const O of best.crush) O.role = 'crushed';
  }

  return { gh, amph, path, passage, pathIn: pIn, pathOut: pOut, stones, rows, b, pathDist, rMin, rMax };
}
