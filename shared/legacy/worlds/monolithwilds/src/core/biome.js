// Biome fields shared by terrain shading and vegetation placement so forests on the ground
// texture and trees line up. All functions are pure, deterministic and cheap-ish (call on grids).
//
//   forestDensity(x, z)  0..1   where trees grow (0 = open land)
//   meadowDensity(x, z)  0..1   lush grass/flowers vs dry grass
//   biomeAt(x, z)               { h, slope, forest, meadow, rock, sand, snow }

import { worldNoise as N, smoothstep, clamp } from './noise.js';
import { heightAt, normalAt } from './terrain-height.js';
import { isReserved, LANDMARK_BY_ID } from './layout.js';

const { fbm2, noise2 } = N;
const _n = { x: 0, y: 1, z: 0 };

/** Tree density from macro noise, altitude, slope and water. `h`/`ny` may be passed to save work. */
export function forestDensity(x, z, h = heightAt(x, z), ny = null) {
  if (h < 1.5) return 0;
  if (ny === null) ny = normalAt(x, z, _n).y;
  // large forest patches + edges broken up by finer noise
  let f = fbm2(x * 0.0009 + 7.3, z * 0.0009 - 3.1, 4) * 0.9 + 0.12;
  f += 0.25 * fbm2(x * 0.004, z * 0.004, 2);
  // valleys and lowland near water are lusher; the plain and plateau tops stay open
  f += 0.25 * (1 - smoothstep(20, 140, h));
  // a dark conifer belt along the foot of the mountain ring (below the tree line)
  const r = Math.sqrt(x * x + z * z);
  f += 0.32 * smoothstep(2150, 2600, r) * (1 - smoothstep(3400, 4200, r)) * (1 - smoothstep(380, 640, h));
  f -= 0.55 * smoothstep(420, 720, h); // tree line
  f *= smoothstep(0.62, 0.8, ny); // no trees on steep slopes
  // the eastern lowland under the Unmoored Isles is deep forest
  const isl = LANDMARK_BY_ID.isles;
  const di = Math.hypot(x - isl.x, z - isl.z);
  f += 0.55 * (1 - smoothstep(350, 800, di));
  // open plain around the Choir, open terrace at the Wardens
  if (isReserved(x, z, 60)) f -= 1.0;
  return clamp(smoothstep(0.18, 0.62, f), 0, 1);
}

export function meadowDensity(x, z) {
  return clamp(0.5 + 0.6 * fbm2(x * 0.0021 - 11.0, z * 0.0021 + 4.0, 3) + 0.15 * noise2(x * 0.02, z * 0.02), 0, 1);
}

export function biomeAt(x, z) {
  const h = heightAt(x, z);
  const n = normalAt(x, z, _n);
  const slope = 1 - n.y;
  const forest = forestDensity(x, z, h, n.y);
  const rock = smoothstep(0.22, 0.4, slope);
  const sand = 1 - smoothstep(1.5, 5.0, h);
  const snow = smoothstep(900, 1150, h + 80 * noise2(x * 0.004, z * 0.004)) * (1 - smoothstep(0.45, 0.7, slope));
  return { h, slope, forest, meadow: meadowDensity(x, z), rock, sand, snow };
}
