/**
 * Blood on ice, for the blades and spikes that run a piece through (shared/piercePlan.ts) and the ice under it. GLSL
 * chunks, so every ice spell bleeds alike; a shader takes one of them. The match draws the wounds and the spray
 * through its gore system; this is only what stays on the ice. The Violence setting decides how much there is
 * (piercePlan.bloodOf): none at Minimal, where neither chunk is asked.
 *
 * On a blade (BLOOD_ON_BLADE: shared/solids.ts for the frost line's great spike, glacial/blades.ts for the crown's
 * glass): the length of it that is in the body is coated, and just past where it came out; beyond that the blood
 * thins out toward the point in streaks, so a long spike is ice with blood on it and not a red pole; below where it
 * went in, a few rivulets run down toward the stone, each at its own pace and each with a heavier bead at its head,
 * so it reads as running, not as paint. Light inside the ice shines through it deep red (bloodGlow).
 *
 * In a sheet of ice (BLOOD_IN_ICE: glacial/sheet.ts, frost/rime.ts): pools that soak in where blood comes down, under
 * the body and at the foot of each blade once its rivulets have reached the stone. Each spreads fast as it lands and
 * slows, ragged at its edge, and runs further along the seams and cracks of the ice than across it.
 */

const BLOOD_NOISE = /* glsl */ `
float bloodHash(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 45758.5453); }
float bloodNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(bloodHash(i), bloodHash(i + vec2(1.0, 0.0)), f.x), mix(bloodHash(i + vec2(0.0, 1.0)), bloodHash(i + vec2(1.0, 1.0)), f.x), f.y);
}
`;

/**
 * `bloodOn(local, through, since, amount, seed)`: how much of a blade's surface is blood, 0..1. `local` is the blade's
 * own unit space (y from 0 where it stands in the stone to 1 at its tip); `through` is where along it it entered and
 * left the body (both 0 for a blade that did not); `since` is seconds since it went through (negative before);
 * `amount` is the blood the Violence setting shows. `bloodColour(amount)` is its colour, darker the more there is.
 */
export const BLOOD_ON_BLADE = /* glsl */ `
${BLOOD_NOISE}
float bloodOn(vec3 local, vec2 through, float since, float amount, float seed) {
  if (amount <= 0.0 || through.y <= 0.0 || since < 0.0) return 0.0;
  float y = local.y, angle = atan(local.z, local.x) / 6.2831853 + 0.5;
  // what is in the body is coated, and just past where it came out; beyond, it thins toward the point in streaks
  float inside = smoothstep(through.x - 0.03, through.x + 0.01, y) * (1.0 - smoothstep(through.y + 0.06, through.y + 0.14, y));
  float streak = smoothstep(0.25, 0.55, bloodNoise(vec2(angle * 8.0 + seed * 2.3, y * 5.0 - seed)));
  float past = step(through.y, y) * streak * exp(-max(0.0, y - through.y) / (0.14 + 0.08 * amount));
  float coat = max(inside, past) * (0.8 + 0.2 * bloodNoise(vec2(angle * 9.0, y * 14.0) + seed));
  // below where it went in, a few rivulets run down, each at its own pace
  float lane = bloodNoise(vec2(angle * 7.0 + seed * 3.1, 1.7));
  float stream = smoothstep(0.5, 0.7, bloodNoise(vec2(angle * 11.0 + seed * 5.3, y * 2.0 + seed)));
  float front = through.x - since * (0.16 + 0.32 * lane) * (0.75 + 0.25 * amount);
  float run = stream * smoothstep(front - 0.015, front + 0.02, y) * step(y, through.x + 0.01) * (0.6 + 0.4 * smoothstep(front, through.x, y));
  // and each has a heavier bead at its head
  float fromFront = (y - front) / 0.012;
  float bead = stream * exp(-fromFront * fromFront) * 0.7 * step(0.0, front);
  return clamp(max(coat, run + bead) * min(1.0, 0.7 + 0.3 * amount), 0.0, 1.0);
}
vec3 bloodColour(float amount) { return mix(vec3(0.42, 0.018, 0.024), vec3(0.24, 0.004, 0.01), clamp(amount - 1.0, 0.0, 1.0)); }
// the light inside the ice shines through the film of blood on it: deep red, from what would have lit the glass
vec3 bloodGlow(vec3 within, float amount) { return vec3(0.7, 0.035, 0.045) * (0.15 + dot(within, vec3(0.3, 0.6, 0.1))) * (amount > 1.0 ? 0.8 : 1.0); }
`;

/** The most pools a sheet of ice holds: one under the body and one at the foot of each of up to four blades. */
export const ICE_BLOOD_POOLS = 5;

/**
 * `bloodInIce(p, seam)`: how much of the ice at `p` blood has soaked, 0..1. `p` is on the board (x, z), in the frame
 * the pools were given in; `seam` is how much of a seam or crack between plates this point is, 0..1. The uniforms:
 * `uIceBlood[i]` is a pool (x, z, the seconds after the blow it starts, how far it spreads: 0 for none), `uIceBloodSince`
 * is seconds since the blow (negative before) and `uIceBloodAmount` the blood the Violence setting shows.
 * `bloodInIceColour(amount)` is its colour under the ice: darker the more there is.
 */
export const BLOOD_IN_ICE = /* glsl */ `
${BLOOD_NOISE}
uniform vec4 uIceBlood[${ICE_BLOOD_POOLS}];
uniform float uIceBloodAmount, uIceBloodSince;
float bloodInIce(vec2 p, float seam) {
  if (uIceBloodAmount <= 0.0 || uIceBloodSince <= 0.0) return 0.0;
  float soaked = 0.0;
  for (int i = 0; i < ${ICE_BLOOD_POOLS}; i++) {
    vec4 pool = uIceBlood[i];
    float since = uIceBloodSince - pool.z;
    if (pool.w <= 0.0 || since <= 0.0) continue;
    // fast as it lands, then slowing; ragged at its edge
    float r = pool.w * (1.0 - exp(-since / 0.45)), d = length(p - pool.xy);
    float ragged = ((bloodNoise(p * 14.0 + pool.xy * 5.0) - 0.5) * 0.55 + (bloodNoise(p * 47.0 - pool.xy * 3.0) - 0.5) * 0.12) * r;
    float body = smoothstep(r + 0.012, r - 0.012, d + ragged);
    // and further down the seams than across the plates
    float run = seam * smoothstep(r * 1.8 + 0.01, r * 0.8, d + ragged * 0.5);
    soaked = max(soaked, max(body, run * 0.85));
  }
  return soaked;
}
vec3 bloodInIceColour(float amount) { return mix(vec3(0.26, 0.01, 0.016), vec3(0.13, 0.0, 0.006), clamp(amount - 1.0, 0.0, 1.0)); }
`;
