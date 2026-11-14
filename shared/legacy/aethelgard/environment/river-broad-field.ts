/** BakedVoxelLighting22f3dc4 river-kernels.js (MIT,2026 SamG-Coder) informs
 * the two-dimensional corner interpolation and two-scale height field.
 * See BAKED_VOXEL_LIGHTING_SOURCE.md for the retained full notice. Crownfall
 * uses two fixed, rotated, sampler-free octaves and exact integer hashing.
 * Bounded corner elevations retain comparable highlight energy without the
 * former longitudinal carrier. This changes neither geometry nor water depth. */
export const RIVER_BROAD_FIELD = Object.freeze({
  version: 'bounded-2d-height-v1', frequency: .45, heightAmplitude: .0176,
  weights: [.65, .35] as const,
});

export const RIVER_BROAD_FIELD_GLSL = `
// Two bounded corner heights, smoothly interpolated: the spatial field and its
// analytic gradient are continuous. Integer hashing agrees across GL2 runtimes.
float cfRiverCorner(vec2 cell) {
  uvec2 p = uvec2(ivec2(cell));
  uint h = p.x * 0x9e3779b9u ^ p.y * 0x85ebca6bu ^ 0xc2b2ae35u;
  h ^= h >> 16u; h *= 0x7feb352du; h ^= h >> 15u; h *= 0x846ca68bu; h ^= h >> 16u;
  return float(h >> 31u);
}
// x: height; yz: exact derivatives of that height in lattice coordinates.
vec3 cfRiverHeightNoise(vec2 p) {
  vec2 cell = floor(p), f = fract(p), u = f * f * (3. - 2. * f), du = 6. * f * (1. - f);
  float a = cfRiverCorner(cell), b = cfRiverCorner(cell + vec2(1., 0.));
  float c = cfRiverCorner(cell + vec2(0., 1.)), d = cfRiverCorner(cell + vec2(1.));
  return vec3(mix(mix(a, b, u.x), mix(c, d, u.x), u.y),
    mix(b - a, d - c, u.y) * du.x, mix(c - a, d - b, u.x) * du.y);
}
float cfRiverBroadVisibility(vec2 lattice) {
  // A cubic corner transition spans half a wave per lattice cell. Only raw
  // source/advection coordinates are differentiated, never a normal/tangent.
  float footprint = 3.14159265359 * max(length(dFdx(lattice)), length(dFdy(lattice)));
  return 1. - smoothstep(.45, 1.6, footprint);
}
// xy: height gradient in channel metres; z: normalized crest height;
// w: retained broad visibility for the existing unresolved-roughness budget.
vec4 cfRiverBroad(vec2 q) {
  vec2 u = vec2(dot(q, vec2(.8, .6)), dot(q, vec2(-.6, .8))) * ${RIVER_BROAD_FIELD.frequency} + vec2(.23, .17);
  vec2 v = vec2(dot(q, vec2(.9238795325, -.3826834324)), dot(q, vec2(.3826834324, .9238795325))) * ${RIVER_BROAD_FIELD.frequency * 2} + vec2(.37, .19);
  vec3 a = cfRiverHeightNoise(u), b = cfRiverHeightNoise(v);
  float visibleA = cfRiverBroadVisibility(u), visibleB = cfRiverBroadVisibility(v);
  vec2 gradientA = vec2(.8 * a.y - .6 * a.z, .6 * a.y + .8 * a.z) * ${RIVER_BROAD_FIELD.frequency};
  vec2 gradientB = vec2(.9238795325 * b.y + .3826834324 * b.z, -.3826834324 * b.y + .9238795325 * b.z) * ${RIVER_BROAD_FIELD.frequency * 2};
  return vec4(2. * ${RIVER_BROAD_FIELD.heightAmplitude} * (.65 * gradientA * visibleA + .35 * gradientB * visibleB),
    2. * (.65 * a.x + .35 * b.x) - 1., .65 * visibleA + .35 * visibleB);
}
`;
