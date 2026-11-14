// Honeycomb Cloister — fitting the real cliff.
//
// The escarpment is a steep, three-riser face that wiggles along x (cliffLineZ + noise). We march
// each 2 m column from the plateau lip down to the apron once (~25 k heightAt calls), record where
// the rock surface is at every 2 m of height (faceZ), and derive the honeycomb's reference surface:
// a smooth, slightly leaning sheet `zBase(x, y)` that stands `margin` metres proud of the rock
// everywhere (cells are hung from it; their bodies reach back into the rock), plus the local yaw
// of that sheet so every cell faces straight out of the cliff.

const Z_NORTH = 62; // search window around the cliff line (the face lies in [cz-50, cz+28])
const Z_SOUTH = 40;

export function sampleFace(ctx, { x0, x1, y0, y1, dx = 2, dy = 2, margin = 8, lean = 0.05, yFoot = 70 }) {
  const nx = Math.round((x1 - x0) / dx) + 1;
  const ny = Math.round((y1 - y0) / dy) + 1;
  const faceZ = new Float32Array(nx * ny);
  const nzs = Z_NORTH + Z_SOUTH + 1;
  const h = new Float32Array(nzs);
  const footZ = new Float32Array(nx);
  const footY = new Float32Array(nx);

  for (let i = 0; i < nx; i++) {
    const x = x0 + i * dx;
    const cz = ctx.cliffLineZ(x);
    const zN = Math.floor(cz - Z_NORTH);
    for (let k = 0; k < nzs; k++) h[k] = ctx.heightAt(x, zN + k);
    // the foot: first sample (from the north) that is back down near apron level
    let kf = nzs - 1;
    for (let k = 0; k < nzs; k++) {
      if (h[k] < h[nzs - 1] + 6 && h[k] < 120) { kf = k; break; }
    }
    footZ[i] = zN + kf;
    footY[i] = h[Math.min(nzs - 1, kf + 3)];
    for (let j = 0; j < ny; j++) {
      const y = y0 + j * dy;
      // southernmost z whose ground is at or above y
      let z = zN;
      if (h[nzs - 1] >= y) z = zN + nzs - 1;
      else {
        for (let k = nzs - 2; k >= 0; k--) {
          if (h[k] >= y) {
            const f = (h[k] - y) / Math.max(1e-3, h[k] - h[k + 1]);
            z = zN + k + Math.min(1, Math.max(0, f));
            break;
          }
        }
      }
      faceZ[i * ny + j] = z;
    }
  }

  // reference sheet: per column the most forward rock (after removing the lean), then a wide
  // max-filter followed by a narrower box blur, so the smoothed sheet never dips into the rock
  const raw = new Float32Array(nx);
  for (let i = 0; i < nx; i++) {
    let m = -Infinity;
    for (let j = 0; j < ny; j++) {
      const y = y0 + j * dy;
      if (y < yFoot + 4) continue;
      m = Math.max(m, faceZ[i * ny + j] + lean * (y - yFoot));
    }
    raw[i] = m + margin;
  }
  const maxW = Math.round(26 / dx);
  const mx = new Float32Array(nx);
  for (let i = 0; i < nx; i++) {
    let m = -Infinity;
    for (let k = Math.max(0, i - maxW); k <= Math.min(nx - 1, i + maxW); k++) m = Math.max(m, raw[k]);
    mx[i] = m;
  }
  let zs = mx;
  for (let pass = 0; pass < 2; pass++) {
    const w = Math.round(12 / dx);
    const out = new Float32Array(nx);
    for (let i = 0; i < nx; i++) {
      let s = 0, c = 0;
      for (let k = i - w; k <= i + w; k++) {
        s += zs[Math.min(nx - 1, Math.max(0, k))];
        c++;
      }
      out[i] = s / c;
    }
    zs = out;
  }

  const colF = (x) => {
    const f = (x - x0) / dx;
    const i = Math.max(0, Math.min(nx - 2, Math.floor(f)));
    return [i, Math.max(0, Math.min(1, f - i))];
  };

  const face = {
    x0, x1, y0, y1, dx, dy, nx, ny, lean, yFoot, margin, faceZ, footZ, footY,
    /** z of the reference sheet (cells with zero protrusion have their front here). */
    zBase(x, y) {
      const [i, t] = colF(x);
      return zs[i] + (zs[i + 1] - zs[i]) * t - lean * (y - yFoot);
    },
    /** Yaw (radians about +y) that turns local +z to the outward normal of the sheet at x. */
    yaw(x) {
      const [i] = colF(x);
      const d = (zs[i + 1] - zs[i]) / dx;
      return Math.atan2(-d, 1);
    },
    /** Rock surface z at (x, y) (bilinear). North of it is rock. */
    rockZ(x, y) {
      const [i, t] = colF(x);
      const fj = (Math.min(y1, Math.max(y0, y)) - y0) / dy;
      const j = Math.max(0, Math.min(ny - 2, Math.floor(fj)));
      const u = fj - j;
      const a = faceZ[i * ny + j] * (1 - u) + faceZ[i * ny + j + 1] * u;
      const b = faceZ[(i + 1) * ny + j] * (1 - u) + faceZ[(i + 1) * ny + j + 1] * u;
      return a + (b - a) * t;
    },
    /** Deepest (most northern) rock z over a rectangle — where a body must reach to be buried. */
    rockMinZ(xa, xb, ya, yb) {
      let m = Infinity;
      const ia = Math.max(0, Math.floor((xa - x0) / dx)), ib = Math.min(nx - 1, Math.ceil((xb - x0) / dx));
      const ja = Math.max(0, Math.floor((ya - y0) / dy)), jb = Math.min(ny - 1, Math.ceil((yb - y0) / dy));
      for (let i = ia; i <= ib; i++) for (let j = ja; j <= jb; j++) m = Math.min(m, faceZ[i * ny + j]);
      return m;
    },
    /** Most forward rock z over a rectangle. */
    rockMaxZ(xa, xb, ya, yb) {
      let m = -Infinity;
      const ia = Math.max(0, Math.floor((xa - x0) / dx)), ib = Math.min(nx - 1, Math.ceil((xb - x0) / dx));
      const ja = Math.max(0, Math.floor((ya - y0) / dy)), jb = Math.min(ny - 1, Math.ceil((yb - y0) / dy));
      for (let i = ia; i <= ib; i++) for (let j = ja; j <= jb; j++) m = Math.max(m, faceZ[i * ny + j]);
      return m;
    },
    /** z of the cliff foot (where the face meets the apron) at x. */
    footAt(x) {
      const [i, t] = colF(x);
      return footZ[i] + (footZ[i + 1] - footZ[i]) * t;
    },
  };
  return face;
}
