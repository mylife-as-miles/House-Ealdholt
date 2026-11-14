// Growth on the lower Stair: curtains of hanging creeper under the stringers and the landing bays
// of the first coils (spray from the lake keeps them green), thinning out with height. Thin
// tapered 3-sided strands, tinted dark green into the lichened-marble mesh (no extra draw call).

export function buildGrowth(ctx, P, W, rng) {
  const w = W.low;
  const t0 = w.tint;
  let strands = 0;
  const f = {};
  const hang = (x, y, z, len, sway, seed) => {
    // a strand: 4 segments bending a little in the wind direction
    const segs = 4;
    let px = x, py = y, pz = z;
    const wx = Math.cos(seed * 6.28) * sway, wz = Math.sin(seed * 6.28) * sway;
    for (let k = 0; k < segs; k++) {
      const t = (k + 1) / segs;
      const nx = x + wx * t * t, ny = y - len * t, nz = z + wz * t * t;
      const r0 = 0.09 * (1 - (k / segs) * 0.7), r1 = 0.09 * (1 - t * 0.7);
      w.strut([px, py, pz], [nx, ny, nz], r0, r1, 3, seed * 3);
      px = nx;
      py = ny;
      pz = nz;
    }
    strands++;
  };
  for (let s = 20; s < P.sTop0; s += 2.2) {
    const y = P.yLine(s);
    if (y > 240) break;
    const dens = 1 - y / 240;
    if (rng() > dens * 0.34) continue;
    P.plan(s, f);
    const hw = P.width(s) / 2;
    const d = P.depth(s);
    const side = rng() < 0.7 ? 1 : -1;
    const u = side * (hw + 0.02);
    const n = 2 + Math.floor(rng() * 5);
    for (let k = 0; k < n; k++) {
      const du = (rng() - 0.5) * 0.3;
      const ds = (rng() - 0.5) * 2.4;
      const x = f.x + f.nx * (u + du * side) + f.tx * ds;
      const z = f.z + f.nz * (u + du * side) + f.tz * ds;
      const yy = P.yLine(s + ds) - d + 0.05;
      const len = (1.2 + rng() * rng() * 9) * (0.5 + dens * 0.8);
      const g = 0.24 + rng() * 0.12;
      w.tint = [g * 0.85, g * 1.1, g * 0.55];
      hang(x, yy, z, len, 0.3 + rng() * 0.6, rng());
    }
  }
  // beards under the lower landing bays' corbels
  for (const g of P.landings) {
    if (g.y0 > 200 || g.feature === 'gate' || g.feature === 'door') continue;
    const mid = (g.s0 + g.s1) / 2;
    P.plan(mid, f);
    const cu = P.width(mid) / 2 - 0.37;
    for (let k = 0; k < 9; k++) {
      const a = rng() * Math.PI;
      const r = 3.0 + rng() * 0.25;
      const x = f.x + f.tx * Math.cos(a) * r + f.nx * (cu + Math.sin(a) * r);
      const z = f.z + f.tz * Math.cos(a) * r + f.nz * (cu + Math.sin(a) * r);
      const gg = 0.22 + rng() * 0.12;
      w.tint = [gg * 0.85, gg * 1.1, gg * 0.55];
      hang(x, g.y0 - 1.2, z, 1 + rng() * 4.5, 0.3, rng());
    }
  }
  w.tint = t0;
  return strands;
}
