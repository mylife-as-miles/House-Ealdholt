// Shared procedural materials for architecture and rock.
//
// No textures: every surface gets solid-noise colour drift, masonry block courses, rain streaks,
// moss on up-facing surfaces, carved glowing glyph bands, and derivative-based bump detail,
// all evaluated per pixel in world space (or object space for moving parts).
//
// Usage:
//   const m = ctx.materials.get('stone');            // shared instance (preferred)
//   const m2 = ctx.materials.create('stone', { blocks: [5, 2.2], color: '#a89880' }); // variant
//   const g = ctx.materials.glow('#ffb56b', { day: 0.4, night: 5 });  // emissive lamp/window
//
// All library materials accept a per-vertex `color` attribute as a tint multiplier (the
// GeometryBuilder writes it); geometry without one renders as if the tint were white.

import * as THREE from 'crownfall-world-three';
import { atmo } from './atmosphere.js';

// ---------------------------------------------------------------------------
// GLSL
// ---------------------------------------------------------------------------

const MW_COMMON = /* glsl */ `
varying vec3 vMwPos;
varying vec3 vMwNrm;
`;

const MW_FRAG_PARS = /* glsl */ `
${MW_COMMON}
uniform vec4 uMwTime;      // x seconds, y night 0..1
uniform vec3 uMwAlt;       // colour multiplier for macro variation / odd blocks
uniform vec3 uMwMoss;      // moss (or patina) colour, linear
uniform vec3 uMwGlyphColor;
uniform vec4 uMwBlocks;    // x width, y height, z mortar width, w groove depth (m)
uniform vec4 uMwWeather;   // x streaks, y moss, z grime, w bump strength
uniform vec4 uMwDetail;    // x macro scale (m), y tone variation, z fine grain, w strata spacing (m)
uniform vec4 uMwGlyph;     // x cell size, y band spacing, z band height, w intensity
uniform vec4 uMwSurface;   // x rough min, y rough max, z patina amount, w sparkle

// Rotated lattice so value-noise cells never align with world axes (no faint grid lines).
const mat3 MW_ROT = mat3(0.00, 0.80, 0.60, -0.80, 0.36, -0.48, -0.60, -0.48, 0.64);
float mwHash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float mwHash13(vec3 p3) {
  p3 = fract(p3 * 0.1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}
float mwNoise3(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float n000 = mwHash13(i);
  float n100 = mwHash13(i + vec3(1.0, 0.0, 0.0));
  float n010 = mwHash13(i + vec3(0.0, 1.0, 0.0));
  float n110 = mwHash13(i + vec3(1.0, 1.0, 0.0));
  float n001 = mwHash13(i + vec3(0.0, 0.0, 1.0));
  float n101 = mwHash13(i + vec3(1.0, 0.0, 1.0));
  float n011 = mwHash13(i + vec3(0.0, 1.0, 1.0));
  float n111 = mwHash13(i + vec3(1.0, 1.0, 1.0));
  return mix(
    mix(mix(n000, n100, f.x), mix(n010, n110, f.x), f.y),
    mix(mix(n001, n101, f.x), mix(n011, n111, f.x), f.y),
    f.z);
}
float mwFbm3(vec3 p) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    s += a * mwNoise3(p);
    p = MW_ROT * p * 2.03 + vec3(17.1, 5.3, 11.7);
    a *= 0.5;
  }
  return s / 0.9375;
}
// Dominant-axis planar coordinates: walls get (horizontal, y), tops get (x, z).
vec2 mwPlanar(vec3 p, vec3 n) {
  vec3 an = abs(n);
  if (an.y > an.x && an.y > an.z) return p.xz;
  if (an.x > an.z) return vec2(p.z, p.y);
  return vec2(p.x, p.y);
}
// Ashlar courses. Returns x groove (1 in mortar), y block id hash, z distance to block edge (m).
vec3 mwBlocks(vec2 uv, vec2 size, float mortar) {
  float row = floor(uv.y / size.y);
  float rh = mwHash12(vec2(row, 17.0));
  float w = size.x * (0.65 + 0.7 * rh);
  float xs = uv.x / w + rh * 3.0 + mod(row, 2.0) * 0.5;
  float col = floor(xs);
  vec2 f = vec2(fract(xs), fract(uv.y / size.y));
  vec2 e = min(f, 1.0 - f) * vec2(w, size.y);
  float edge = min(e.x, e.y);
  float groove = 1.0 - smoothstep(mortar * 0.35, mortar, edge);
  return vec3(groove, mwHash12(vec2(col, row) + 0.37), edge);
}
float mwSegment(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a;
  vec2 ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h);
}
// A procedural rune in each cell of an inscription band.
float mwGlyph(vec2 uv, float cell) {
  vec2 c = floor(uv / cell);
  vec2 f = fract(uv / cell) - 0.5;
  float h = mwHash12(c);
  float h2 = mwHash12(c + 13.7);
  if (h < 0.1) return 0.0;
  float d = 1e3;
  if (fract(h * 7.0) > 0.45) d = min(d, mwSegment(f, vec2(0.0, -0.36), vec2(0.0, 0.36)));
  if (fract(h * 13.0) > 0.5) d = min(d, mwSegment(f, vec2(-0.3, 0.3), vec2(0.3, 0.3)));
  if (fract(h * 17.0) > 0.6) d = min(d, mwSegment(f, vec2(-0.3, -0.3), vec2(0.3, -0.3)));
  if (fract(h2 * 5.0) > 0.62) d = min(d, abs(length(f) - 0.2));
  if (fract(h2 * 11.0) > 0.7) d = min(d, mwSegment(f, vec2(-0.3, -0.3), vec2(0.3, 0.3)));
  if (fract(h2 * 7.0) > 0.7) d = min(d, mwSegment(f, vec2(-0.3, 0.0), vec2(0.05, 0.0)));
  if (fract(h2 * 19.0) > 0.72) d = min(d, length(f - vec2(0.18, -0.12)) - 0.05);
  float aa = fwidth(uv.x / cell) * 1.2;
  return 1.0 - smoothstep(0.04, 0.04 + aa, d);
}
// Bump mapping from a procedural height (Mikkelsen, derivative based). View space.
vec3 mwPerturbNormal(vec3 surfPos, vec3 surfNorm, float h) {
  vec3 dpdx = dFdx(surfPos);
  vec3 dpdy = dFdy(surfPos);
  vec3 r1 = cross(dpdy, surfNorm);
  vec3 r2 = cross(surfNorm, dpdx);
  float det = dot(dpdx, r1);
  vec3 grad = sign(det) * (dFdx(h) * r1 + dFdy(h) * r2);
  // facets seen exactly edge-on give det = 0 and a zero vector: normalize() would return NaN, which
  // spreads through the water's mipmapped mirror into black blocks
  vec3 n = abs(det) * surfNorm - grad;
  float l2 = dot(n, n);
  return l2 > 1e-30 ? n * inversesqrt(l2) : surfNorm;
}
`;

const MW_FRAG_MAIN = /* glsl */ `
{
  vec3 p = vMwPos;
  #ifdef MW_LOCAL
    vec3 wn = normalize(vMwNrm);
  #else
    vec3 wn = normalize(transpose(mat3(viewMatrix)) * normal);
  #endif
  float dist = length(vViewPosition);
  float fineFade = 1.0 - smoothstep(40.0, 220.0, dist);
  float mesoFade = 1.0 - smoothstep(400.0, 1600.0, dist);

  vec3 pr = MW_ROT * p;
  float macro = mwFbm3(pr / uMwDetail.x);
  float meso = mwNoise3(pr * 0.33);
  float fine = mwNoise3(MW_ROT * pr * 2.9);

  vec3 albedo = diffuseColor.rgb;
  albedo = mix(albedo, albedo * uMwAlt, smoothstep(0.32, 0.78, macro));
  albedo *= 1.0 + (meso - 0.5) * uMwDetail.y * mesoFade;
  albedo *= 1.0 + (fine - 0.5) * 0.18 * uMwDetail.z * fineFade;

  float height = (meso - 0.5) * 0.3 * mesoFade + (fine - 0.5) * 0.06 * uMwDetail.z * fineFade;
  float rough = mix(uMwSurface.x, uMwSurface.y, meso);
  float cavity = 0.0;

  #ifdef MW_STRATA
  {
    float sy = p.y / uMwDetail.w + (macro - 0.5) * 1.6;
    float bandId = floor(sy);
    float band = fract(sy);
    albedo *= 0.8 + 0.34 * mwHash12(vec2(bandId, 3.0));
    float ledge = smoothstep(0.0, 0.1, band);
    height += (ledge - 1.0) * 0.35 * mesoFade;
    cavity += (1.0 - ledge) * 0.6;
  }
  #endif

  #ifdef MW_BLOCKS
  {
    vec2 uv = mwPlanar(p, wn);
    vec3 b = mwBlocks(uv, uMwBlocks.xy, uMwBlocks.z);
    float aaW = max(fwidth(uv.x), fwidth(uv.y));
    float bFade = 1.0 - smoothstep(uMwBlocks.y * 0.06, uMwBlocks.y * 0.3, aaW);
    float groove = b.x * bFade;
    albedo *= mix(1.0, 0.8 + 0.4 * b.y, bFade);
    albedo = mix(albedo, albedo * uMwAlt, step(0.86, b.y) * 0.7 * bFade);
    height -= groove * uMwBlocks.w;
    height += smoothstep(0.0, uMwBlocks.z * 4.0, b.z) * 0.03 * bFade;
    cavity += groove;
  }
  #endif

  // rain streaks down walls
  float vertical = 1.0 - abs(wn.y);
  float streak = mwNoise3(vec3(p.x * 0.8, p.y * 0.011, p.z * 0.8) + macro * 2.0);
  float streakMask = vertical * smoothstep(0.52, 0.86, streak) * uMwWeather.x;
  albedo *= 1.0 - 0.4 * streakMask;
  rough -= 0.12 * streakMask;

  // grime in cavities
  albedo *= 1.0 - cavity * 0.6 * uMwWeather.z;

  // moss on ledges and tops, lichen specks on walls
  float mossN = mwFbm3(p * 0.085 + 3.1);
  float mossMask = smoothstep(0.5, 0.88, wn.y + (mossN - 0.5) * 1.1) * smoothstep(0.38, 0.62, mossN);
  mossMask = clamp(mossMask + cavity * 0.25 * smoothstep(0.0, 0.5, wn.y), 0.0, 1.0) * uMwWeather.y;
  float lichen = smoothstep(0.74, 0.8, mwNoise3(pr * 1.25)) * vertical * uMwWeather.y * 0.45 * fineFade;
  albedo = mix(albedo, uMwMoss * (0.65 + 0.7 * meso), clamp(mossMask + lichen, 0.0, 1.0));
  rough = mix(rough, 0.95, mossMask);

  #ifdef MW_PATINA
  {
    float pat = smoothstep(0.38, 0.72, macro + (meso - 0.5) * 0.7 + wn.y * 0.3 + streakMask * 0.4) * uMwSurface.z;
    albedo = mix(albedo, uMwMoss * (0.8 + 0.4 * fine), pat);
    metalnessFactor = mix(metalnessFactor, 0.05, pat);
    rough = mix(rough, 0.85, pat);
  }
  #endif

  #ifdef MW_SPARKLE
  {
    float sp = step(1.0 - 0.012 * uMwSurface.w, mwHash13(floor(p * 18.0))) * fineFade;
    rough = mix(rough, 0.05, sp);
  }
  #endif

  #ifdef MW_GLYPHS
  {
    vec2 uv = mwPlanar(p, wn);
    float bandCoord = uv.y / uMwGlyph.y;
    float inBand = step(abs(fract(bandCoord) - 0.5) * uMwGlyph.y, uMwGlyph.z * 0.5);
    float g = mwGlyph(uv, uMwGlyph.x) * inBand * (1.0 - step(0.85, abs(wn.y)));
    float cellId = mwHash12(floor(uv / uMwGlyph.x));
    float pulse = 0.6 + 0.4 * sin(uMwTime.x * 0.7 + cellId * 6.2831 + uv.y * 0.04);
    float glow = uMwGlyph.w * (0.18 + 1.8 * uMwTime.y) * pulse;
    totalEmissiveRadiance += uMwGlyphColor * g * glow;
    albedo *= 1.0 - 0.7 * g;
    height -= g * 0.025;
  }
  #endif

  diffuseColor.rgb = max(albedo, vec3(0.0));
  roughnessFactor = clamp(rough, 0.04, 1.0);
  normal = mwPerturbNormal(-vViewPosition, normal, height * uMwWeather.w);
}
`;

const MW_VERT_WORLD = /* glsl */ `
  vMwPos = cameraPosition + transpose(mat3(viewMatrix)) * mvPosition.xyz;
  vMwNrm = transpose(mat3(viewMatrix)) * transformedNormal;
`;

const MW_VERT_LOCAL = /* glsl */ `
  {
    vec4 mwP = vec4(transformed, 1.0);
    vec3 mwN = objectNormal;
    #ifdef USE_INSTANCING
      mwP = instanceMatrix * mwP;
      mwN = mat3(instanceMatrix) * mwN;
    #endif
    vMwPos = mwP.xyz;
    vMwNrm = mwN;
  }
`;

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------

/**
 * Preset fields (all optional):
 *   color, alt (multiplier colour), moss (colour), glyphColor
 *   rough: [min, max], metalness
 *   blocks: [w, h] | null, mortar, grooveDepth
 *   streaks, mossAmount, grime, bump, macroScale, variation, fine
 *   strata (spacing in m) | 0, patina 0..1, sparkle 0..1
 *   glyphs: { cell, band, height, intensity, color } | null
 *   local: true to use object-space coordinates (for moving/rotating meshes)
 *   flatShading, side, transparent, opacity, emissive, emissiveIntensity
 */
export const PRESETS = {
  // Warm pale limestone ashlar — the default monumental stone.
  stone: {
    color: '#bcae98', alt: '#d9c2a8', moss: '#4b5a2c',
    rough: [0.72, 0.95], blocks: [3.4, 1.5], mortar: 0.08, grooveDepth: 0.09,
    streaks: 0.65, mossAmount: 0.55, grime: 0.8, bump: 1.0, macroScale: 45, variation: 0.35, fine: 1,
  },
  // Same stone, carved monolithically (no block courses) — statues, curved forms.
  stoneSmooth: {
    color: '#b8aa94', alt: '#cdb89f', moss: '#4b5a2c',
    rough: [0.65, 0.92], streaks: 0.7, mossAmount: 0.5, grime: 0.6, bump: 1.0, macroScale: 35, variation: 0.4, fine: 1,
  },
  // Near-black volcanic stone with huge blocks.
  basalt: {
    color: '#35353a', alt: '#5a5550', moss: '#3d4a26',
    rough: [0.55, 0.9], blocks: [6.0, 2.8], mortar: 0.1, grooveDepth: 0.12,
    streaks: 0.45, mossAmount: 0.35, grime: 0.5, bump: 1.1, macroScale: 60, variation: 0.3, fine: 1.2,
  },
  basaltSmooth: {
    color: '#303035', alt: '#4d4945', moss: '#3d4a26',
    rough: [0.5, 0.85], streaks: 0.4, mossAmount: 0.3, grime: 0.4, bump: 1.0, macroScale: 40, variation: 0.3, fine: 1.3,
  },
  // Polished black glass-stone. Reflects the sky. Great for monoliths.
  obsidian: {
    color: '#0c0d11', alt: '#1b1a22', moss: '#2a3320',
    rough: [0.08, 0.3], streaks: 0.25, mossAmount: 0.08, grime: 0.2, bump: 0.35, macroScale: 30, variation: 0.25, fine: 0.4,
    sparkle: 0.6,
  },
  // Obsidian with glowing inscription bands (cyan).
  obsidianGlyph: {
    color: '#0c0d11', alt: '#1b1a22', moss: '#2a3320',
    rough: [0.1, 0.32], streaks: 0.2, mossAmount: 0.05, grime: 0.2, bump: 0.35, macroScale: 30, variation: 0.25, fine: 0.4,
    glyphs: { cell: 1.6, band: 14, height: 3.4, intensity: 3.2, color: '#5fe6ff' },
  },
  // Dark stone with amber glyph bands.
  glyphStone: {
    color: '#4a4540', alt: '#6b6258', moss: '#3d4a26',
    rough: [0.6, 0.9], blocks: [4.2, 1.8], mortar: 0.08, grooveDepth: 0.08,
    streaks: 0.5, mossAmount: 0.35, grime: 0.6, bump: 1.0, macroScale: 40, variation: 0.3, fine: 1,
    glyphs: { cell: 1.4, band: 9, height: 2.6, intensity: 2.6, color: '#ffb35c' },
  },
  // Red/orange sedimentary rock with horizontal strata.
  sandstone: {
    color: '#b06a45', alt: '#d49a6a', moss: '#56602f',
    rough: [0.75, 0.97], streaks: 0.55, mossAmount: 0.3, grime: 0.6, bump: 1.2, macroScale: 50, variation: 0.35, fine: 1.2,
    strata: 2.6,
  },
  // Bright white stone with gentle polish — reads beautifully at distance.
  marble: {
    color: '#e3ddd2', alt: '#cfc6b8', moss: '#5c6a3a',
    rough: [0.3, 0.55], blocks: [5.0, 2.4], mortar: 0.03, grooveDepth: 0.04,
    streaks: 0.5, mossAmount: 0.3, grime: 0.5, bump: 0.6, macroScale: 25, variation: 0.18, fine: 0.5,
  },
  marbleSmooth: {
    color: '#e6e0d5', alt: '#d2c9ba', moss: '#5c6a3a',
    rough: [0.28, 0.5], streaks: 0.45, mossAmount: 0.25, grime: 0.3, bump: 0.5, macroScale: 25, variation: 0.15, fine: 0.5,
  },
  // Ivory, bone-like surface with pores — organic architecture.
  bone: {
    color: '#dccfb3', alt: '#b9a684', moss: '#6b6a3c',
    rough: [0.45, 0.75], streaks: 0.6, mossAmount: 0.25, grime: 0.7, bump: 1.3, macroScale: 20, variation: 0.3, fine: 1.6,
  },
  // Pale lime plaster over rubble.
  plaster: {
    color: '#d3c7b1', alt: '#b7a58b', moss: '#56643a',
    rough: [0.82, 0.98], streaks: 0.8, mossAmount: 0.45, grime: 0.8, bump: 0.9, macroScale: 18, variation: 0.45, fine: 1.4,
  },
  // Fired clay tiles / terracotta.
  terracotta: {
    color: '#a4573a', alt: '#c67b52', moss: '#4f5a2d',
    rough: [0.7, 0.92], blocks: [0.9, 0.45], mortar: 0.03, grooveDepth: 0.03,
    streaks: 0.6, mossAmount: 0.4, grime: 0.7, bump: 0.9, macroScale: 20, variation: 0.35, fine: 1,
  },
  // Aged bronze with verdigris patina.
  bronze: {
    color: '#7a5a34', alt: '#5d4128', moss: '#4f9a86',
    rough: [0.3, 0.6], metalness: 0.9, patina: 0.75,
    streaks: 0.4, mossAmount: 0.0, grime: 0.4, bump: 0.5, macroScale: 12, variation: 0.3, fine: 0.8,
  },
  // Weathered gold leaf.
  gold: {
    color: '#c9a45b', alt: '#a07e3a', moss: '#6c8d5a',
    rough: [0.2, 0.42], metalness: 1.0, patina: 0.15,
    streaks: 0.3, mossAmount: 0.0, grime: 0.3, bump: 0.3, macroScale: 10, variation: 0.25, fine: 0.5,
  },
  // Rusted dark iron.
  iron: {
    color: '#3a3430', alt: '#6b3f25', moss: '#7a4a2a',
    rough: [0.55, 0.9], metalness: 0.7, patina: 0.55,
    streaks: 0.7, mossAmount: 0.0, grime: 0.5, bump: 0.7, macroScale: 8, variation: 0.35, fine: 1.2,
  },
  // Cool translucent-looking crystal (cheap: no transmission).
  crystal: {
    color: '#8fd3e6', alt: '#b5a2ff', moss: '#8fd3e6',
    rough: [0.02, 0.12], metalness: 0.2, streaks: 0.0, mossAmount: 0.0, grime: 0.0, bump: 0.2,
    macroScale: 8, variation: 0.3, fine: 0.2, emissive: '#2a6f86', emissiveIntensity: 0.6,
  },
  // Natural rock for boulders / cliffs placed by scatter modules.
  rock: {
    color: '#7b736a', alt: '#9a8f7f', moss: '#46552a',
    rough: [0.75, 0.98], streaks: 0.5, mossAmount: 0.6, grime: 0.6, bump: 1.4, macroScale: 25, variation: 0.45, fine: 1.4,
  },
};

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

const toLinear = (c) => new THREE.Color(c); // THREE.Color converts sRGB hex -> linear working space

function colorVec3(c) {
  const col = toLinear(c);
  return new THREE.Vector3(col.r, col.g, col.b);
}

let materialSerial = 0;

/** Create a new procedural material from a preset name (or preset object) plus overrides. */
export function createMaterial(preset = 'stone', overrides = {}) {
  const base = typeof preset === 'string' ? PRESETS[preset] : preset;
  if (!base) throw new Error(`Unknown material preset: ${preset}`);
  const o = { ...base, ...overrides };

  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(o.color ?? '#aaaaaa'),
    roughness: 1,
    metalness: o.metalness ?? 0,
    vertexColors: true,
    flatShading: !!o.flatShading,
    side: o.side ?? THREE.FrontSide,
    transparent: !!o.transparent,
    opacity: o.opacity ?? 1,
    emissive: new THREE.Color(o.emissive ?? '#000000'),
    emissiveIntensity: o.emissiveIntensity ?? 1,
  });
  // Geometry without a colour attribute behaves as white tint.
  mat.defaultAttributeValues = { color: [1, 1, 1] };

  const rough = o.rough ?? [0.7, 0.95];
  const blocks = o.blocks ?? null;
  const glyphs = o.glyphs ?? null;

  const uniforms = {
    uMwTime: { value: atmo.time },
    uMwAlt: { value: colorVec3(o.alt ?? '#ffffff') },
    uMwMoss: { value: colorVec3(o.moss ?? '#4b5a2c') },
    uMwGlyphColor: { value: colorVec3(glyphs?.color ?? '#ffb35c') },
    uMwBlocks: { value: new THREE.Vector4(blocks?.[0] ?? 3, blocks?.[1] ?? 1.5, o.mortar ?? 0.08, o.grooveDepth ?? 0.08) },
    uMwWeather: { value: new THREE.Vector4(o.streaks ?? 0.5, o.mossAmount ?? 0.4, o.grime ?? 0.6, o.bump ?? 1) },
    uMwDetail: { value: new THREE.Vector4(o.macroScale ?? 40, o.variation ?? 0.3, o.fine ?? 1, o.strata || 3) },
    uMwGlyph: { value: new THREE.Vector4(glyphs?.cell ?? 1.5, glyphs?.band ?? 10, glyphs?.height ?? 3, glyphs?.intensity ?? 2) },
    uMwSurface: { value: new THREE.Vector4(rough[0], rough[1], o.patina ?? 0, o.sparkle ?? 0) },
  };

  const defines = {};
  if (blocks) defines.MW_BLOCKS = '';
  if (glyphs) defines.MW_GLYPHS = '';
  if (o.strata) defines.MW_STRATA = '';
  if (o.patina) defines.MW_PATINA = '';
  if (o.sparkle) defines.MW_SPARKLE = '';
  if (o.local) defines.MW_LOCAL = '';
  mat.defines = { ...(mat.defines || {}), ...defines };

  const key = `mw-${materialSerial++}-${Object.keys(defines).sort().join('.')}`;
  mat.customProgramCacheKey = () => key;
  mat.userData.mwUniforms = uniforms;
  mat.userData.preset = typeof preset === 'string' ? preset : 'custom';

  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${MW_COMMON}`)
      .replace('#include <project_vertex>', `#include <project_vertex>\n${o.local ? MW_VERT_LOCAL : MW_VERT_WORLD}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${MW_FRAG_PARS}`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\n${MW_FRAG_MAIN}`);
  };
  return mat;
}

/**
 * Emissive material for windows, lanterns, glowing seams. Unlit; brightness rises at night.
 * Values > 1 bloom. `flicker` 0..1 adds a gentle candle-like wobble per instance/position.
 */
export function createGlowMaterial(color = '#ffb56b', { day = 0.6, night = 4.0, flicker = 0, side = THREE.FrontSide, transparent = false, opacity = 1 } = {}) {
  const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(color), side, transparent, opacity });
  mat.defaultAttributeValues = { color: [1, 1, 1] };
  mat.vertexColors = true;
  const uniforms = {
    uMwTime: { value: atmo.time },
    uMwGlow: { value: new THREE.Vector3(day, night, flicker) },
  };
  const key = `mw-glow-${materialSerial++}`;
  mat.customProgramCacheKey = () => key;
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vMwGlowPos;`)
      .replace('#include <project_vertex>', `#include <project_vertex>\nvMwGlowPos = cameraPosition + transpose(mat3(viewMatrix)) * mvPosition.xyz;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform vec4 uMwTime;\nuniform vec3 uMwGlow;\nvarying vec3 vMwGlowPos;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          float fl = 1.0;
          if (uMwGlow.z > 0.0) {
            vec3 cell = floor(vMwGlowPos * 0.5);
            float ph = fract(sin(dot(cell, vec3(12.9898, 78.233, 37.719))) * 43758.5453) * 6.2831;
            fl = 1.0 - uMwGlow.z * (0.5 + 0.5 * sin(uMwTime.x * 7.0 + ph) * sin(uMwTime.x * 3.1 + ph * 2.0));
          }
          diffuseColor.rgb *= mix(uMwGlow.x, uMwGlow.y, uMwTime.y) * fl;
        }`);
  };
  return mat;
}

/**
 * The material library handed to modules as ctx.materials.
 *   get(name)            shared instance of a preset (created lazily)
 *   create(name, over)   new variant (not shared)
 *   glow(color, opts)    shared glow material keyed by colour+opts
 */
export function createMaterialLibrary() {
  const cache = new Map();
  const glowCache = new Map();
  return {
    presets: PRESETS,
    get(name) {
      if (!cache.has(name)) cache.set(name, createMaterial(name));
      return cache.get(name);
    },
    create: createMaterial,
    glow(color = '#ffb56b', opts = {}) {
      const k = `${color}|${JSON.stringify(opts)}`;
      if (!glowCache.has(k)) glowCache.set(k, createGlowMaterial(color, opts));
      return glowCache.get(k);
    },
  };
}
