// Terrain material: MeshStandardMaterial + onBeforeCompile, so three's lighting, shadows, IBL and
// the global height fog stay intact. Everything is world-space and procedural:
//
//   vertex    CDLOD geomorph (each vertex slides toward its parent level's surface with distance)
//   fragment  meadow / dry grass / forest floor / soil / scree / stratified cliff rock with
//             erosion streaks / beach, wet band and lake bed / slope- and aspect-aware snow,
//             multi-scale noise from one small tiling DataTexture, baked world maps (far normals,
//             cavity, drainage, talus, forest, meadow, sandstone), heightfield sun visibility
//             (mountain shadows over the whole basin) and cavity ambient occlusion.

import * as THREE from 'crownfall-world-three';
import { WG_N, WG_X0, WG_STEP, MAX_LEVEL } from './terrain-jobs.js';

// sRGB palette (converted to linear constants in the shader)
const PAL = {
  LUSH: '#3f6e24',
  OLIVE: '#5f7431',
  DRY: '#a08a4c',
  STRAW: '#bda46a',
  ALPINE: '#857c52',
  NEEDLE: '#2f2c1d',
  MOSS: '#2b4119',
  SOIL: '#6a5641',
  LIME_A: '#bdb19c',
  LIME_B: '#968d80',
  LIME_C: '#d8c9a9',
  SAND_A: '#a65c38',
  SAND_B: '#c98b5a',
  SAND_C: '#dfc39a',
  GRAN_A: '#86827c',
  GRAN_B: '#5d5b59',
  BASALT_A: '#3b393b',
  BASALT_B: '#5b524e',
  SCREE: '#a0978a',
  BEACH: '#c9b38a',
  PEBBLE: '#877c6d',
  SILT: '#5d5645',
  SILT_DEEP: '#2c2d27',
  SNOW: '#eef2f7',
  VARNISH: '#3a3029',
  LICHEN: '#b4a46a',
};

function paletteGLSL() {
  const c = new THREE.Color();
  return Object.entries(PAL)
    .map(([k, v]) => {
      c.set(v); // converts to linear working space
      return `const vec3 C_${k} = vec3(${c.r.toFixed(4)}, ${c.g.toFixed(4)}, ${c.b.toFixed(4)});`;
    })
    .join('\n');
}

// ---------------------------------------------------------------------------
// Tiling multi-channel noise texture (256², RGBA8, mipmapped)
//   R, G  smooth value-noise fbm (two seeds)     B  Worley F1 cells (pebbles / blocks)
//   A     high-frequency fbm (grain, tufts)
// ---------------------------------------------------------------------------

function makeNoiseTexture(rng) {
  const S = 256;
  const lattice = (P, seed) => {
    const t = new Float32Array(P * P);
    for (let i = 0; i < t.length; i++) t[i] = rng();
    return (x, y) => {
      const xi = Math.floor(x), yi = Math.floor(y);
      const fx = x - xi, fy = y - yi;
      const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
      const x0 = ((xi % P) + P) % P, y0 = ((yi % P) + P) % P;
      const x1 = (x0 + 1) % P, y1 = (y0 + 1) % P;
      const a = t[y0 * P + x0], b = t[y0 * P + x1], c = t[y1 * P + x0], d = t[y1 * P + x1];
      return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
    };
  };
  const fbm = (periods) => {
    const layers = periods.map((P) => ({ P, f: lattice(P) }));
    return (u, v) => {
      let s = 0, a = 1, n = 0;
      for (const { P, f } of layers) {
        s += a * f(u * P, v * P);
        n += a;
        a *= 0.5;
      }
      return s / n;
    };
  };
  const fR = fbm([4, 8, 16, 32, 64]);
  const fG = fbm([4, 8, 16, 32, 64]);
  const fA = fbm([16, 32, 64, 128]);
  // Worley F1 on a periodic 16x16 jittered grid
  const WC = 16;
  const pts = new Float32Array(WC * WC * 2);
  for (let i = 0; i < WC * WC; i++) {
    pts[i * 2] = 0.1 + 0.8 * rng();
    pts[i * 2 + 1] = 0.1 + 0.8 * rng();
  }
  const worley = (u, v) => {
    const x = u * WC, y = v * WC;
    const xi = Math.floor(x), yi = Math.floor(y);
    let best = 9;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const cx = xi + dx, cy = yi + dy;
        const k = ((((cy % WC) + WC) % WC) * WC + (((cx % WC) + WC) % WC)) * 2;
        const px = cx + pts[k] - x, py = cy + pts[k + 1] - y;
        const d = px * px + py * py;
        if (d < best) best = d;
      }
    }
    return Math.sqrt(best);
  };
  const ch = [new Float32Array(S * S), new Float32Array(S * S), new Float32Array(S * S), new Float32Array(S * S)];
  for (let j = 0; j < S; j++) {
    for (let i = 0; i < S; i++) {
      const u = i / S, v = j / S, k = j * S + i;
      ch[0][k] = fR(u, v);
      ch[1][k] = fG(u + 0.37, v + 0.71);
      ch[2][k] = worley(u, v);
      ch[3][k] = fA(u, v);
    }
  }
  const data = new Uint8Array(S * S * 4);
  for (let c = 0; c < 4; c++) {
    let lo = Infinity, hi = -Infinity;
    for (const v of ch[c]) {
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    const inv = 1 / (hi - lo);
    for (let k = 0; k < S * S; k++) data[k * 4 + c] = Math.round((ch[c][k] - lo) * inv * 255);
  }
  const tex = new THREE.DataTexture(data, S, S, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  // nearest-mip bilinear: half the texel reads of trilinear; mip seams are invisible in noise
  tex.minFilter = THREE.LinearMipmapNearestFilter;
  tex.generateMipmaps = true;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

export function makeWorldTexture(data, format = THREE.RGBAFormat) {
  const tex = new THREE.DataTexture(data, WG_N, WG_N, format, THREE.UnsignedByteType);
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapNearestFilter;
  tex.generateMipmaps = true;
  tex.unpackAlignment = 1;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

// ---------------------------------------------------------------------------
// GLSL
// ---------------------------------------------------------------------------

const VERT_PARS = /* glsl */ `
attribute vec3 aMorph;  // x: parent-level height, y: level, z: grandparent-level height (borders)
attribute vec2 aMorphN; // parent-level normal (x, z)
uniform vec3 uTerrCam;
uniform vec2 uTerrMorph[${MAX_LEVEL + 1}];
// k: morph toward the parent level; kp: the parent level's own morph toward its parent (only
// moves border vertices, keeping them welded to a coarser neighbour that is itself morphing).
float terrMorphK(out float kp) {
  int L = int(aMorph.y + 0.5);
  float d = distance(uTerrCam, position);
  vec2 r = uTerrMorph[L];
  vec2 rp = uTerrMorph[L > 0 ? L - 1 : 0];
  kp = L > 0 ? clamp((d - rp.x) / (rp.y - rp.x), 0.0, 1.0) : 0.0;
  return clamp((d - r.x) / (r.y - r.x), 0.0, 1.0);
}
`;

const VERT_MORPH_NORMAL = /* glsl */ `
float terrKp;
float terrK = terrMorphK(terrKp);
vec3 terrNc = vec3(aMorphN.x, sqrt(max(0.0, 1.0 - dot(aMorphN, aMorphN))), aMorphN.y);
vec3 objectNormal = normalize(mix(normal, terrNc, terrK));
`;

const VERT_MORPH_POS = /* glsl */ `
vec3 transformed = vec3(position.x, mix(mix(position.y, aMorph.x, terrK), aMorph.z, terrKp), position.z);
`;

const FRAG_PARS = /* glsl */ `
varying vec3 vTerrPos;
varying vec3 vTerrNrm;
uniform sampler2D uTerrA;     // nx, nz, cavity, flow
uniform sampler2D uTerrB;     // forest, meadow, talus, sandstone
uniform sampler2D uTerrSun;   // heightfield sun visibility
uniform sampler2D uTerrNoise; // tiling multi-channel noise
uniform vec4 uTerrWorld;      // x0, z0, 1/extent, half texel
uniform vec4 uTerrFar;        // x,y: far-normal blend range, z: detail (quality), w: snow line
uniform vec4 uTerrCrater;     // crater x, z, radius, -
uniform vec3 uTerrSunDir;
${paletteGLSL()}

float terrHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
// All noise lookups use explicit gradients so the expensive layers can sit inside branches
// (rock-only, near-only) without breaking mip selection.
vec4 terrNG(vec2 uv, vec2 gx, vec2 gy) { return textureGrad(uTerrNoise, uv, gx, gy); }
// Biplanar sample (the two most facing planes of a triplanar set, blended) — cliffs never
// stretch, at two texture fetches instead of three.
vec4 terrTri(vec3 p, vec3 n, float s, vec3 dx, vec3 dy) {
  vec3 an = abs(n);
  ivec3 ma = (an.x > an.y && an.x > an.z) ? ivec3(0, 1, 2) : (an.y > an.z) ? ivec3(1, 2, 0) : ivec3(2, 0, 1);
  ivec3 mi = (an.x < an.y && an.x < an.z) ? ivec3(0, 1, 2) : (an.y < an.z) ? ivec3(1, 2, 0) : ivec3(2, 0, 1);
  ivec3 me = ivec3(3) - mi - ma;
  vec4 a = textureGrad(uTerrNoise, vec2(p[ma.y], p[ma.z]) * s, vec2(dx[ma.y], dx[ma.z]) * s, vec2(dy[ma.y], dy[ma.z]) * s);
  vec4 b = textureGrad(uTerrNoise, vec2(p[me.y], p[me.z]) * s + 0.37, vec2(dx[me.y], dx[me.z]) * s, vec2(dy[me.y], dy[me.z]) * s);
  vec2 w = clamp((vec2(an[ma.x], an[me.x]) - 0.5) * 2.0, 0.0, 1.0);
  w *= w;
  w *= w;
  return (a * w.x + b * w.y) / (w.x + w.y);
}
vec3 terrBump(vec3 surfPos, vec3 surfNorm, float h) {
  vec3 dpdx = dFdx(surfPos);
  vec3 dpdy = dFdy(surfPos);
  vec3 r1 = cross(dpdy, surfNorm);
  vec3 r2 = cross(surfNorm, dpdx);
  float det = dot(dpdx, r1);
  vec3 grad = sign(det) * (dFdx(h) * r1 + dFdy(h) * r2);
  return normalize(abs(det) * surfNorm - grad);
}
`;

const FRAG_MAIN = /* glsl */ `
float terrSunVis = 1.0;
float terrAO = 1.0;
vec3 terrSunDirV = normalize((viewMatrix * vec4(uTerrSunDir, 0.0)).xyz);
{
  vec3 P = vTerrPos;
  float dist = length(P - cameraPosition);
  vec3 dPx = dFdx(P);
  vec3 dPy = dFdy(P);
  float fwY = abs(dPx.y) + abs(dPy.y);     // metres of height per pixel (strata anti-aliasing)
  vec3 Nm = normalize(vTerrNrm);

  // ---- baked world maps ------------------------------------------------------
  vec2 wuv = (P.xz - uTerrWorld.xy) * uTerrWorld.z + uTerrWorld.w;
  vec2 we = min(wuv, 1.0 - wuv);
  float inW = smoothstep(0.0, 0.03, min(we.x, we.y));
  vec4 mA = texture2D(uTerrA, wuv);
  vec4 mB = texture2D(uTerrB, wuv);
  terrSunVis = mix(1.0, texture2D(uTerrSun, wuv).r, inW);
  vec3 Nt = vec3(mA.r * 2.0 - 1.0, 0.0, mA.g * 2.0 - 1.0);
  Nt.y = sqrt(max(0.02, 1.0 - dot(Nt.xz, Nt.xz)));
  float farW = smoothstep(uTerrFar.x, uTerrFar.y, dist) * inW;
  vec3 N = normalize(mix(Nm, Nt, farW));
  float cav = (mA.b - 0.5) * 2.0 * inW;   // + concave, - convex
  float flow = mA.a * inW;
  float forest = mB.r * inW;
  float meadow = mix(0.55, mB.g, inW);
  float talus = mB.b * inW;
  float sandst = mB.a * inW;
  float sl = 1.0 - N.y;                   // 0 flat .. 1 vertical
  vec3 aN = abs(N);
  vec3 tw = aN * aN; tw *= tw; tw /= (tw.x + tw.y + tw.z);
  float detail = uTerrFar.z;
  float fineFade = 1.0 - smoothstep(70.0, 320.0, dist);
  float microFade = (1.0 - smoothstep(8.0, 60.0, dist)) * detail;

  // ---- multi-scale noise (mip filtering averages it out with distance) ---------
  vec2 gx = dPx.xz, gy = dPy.xz;
  vec4 nM = terrNG(P.xz * 0.00029 + 0.11, gx * 0.00029, gy * 0.00029);  // ~3.4 km
  vec4 nm = terrNG(P.xz * 0.0019 + 0.31, gx * 0.0019, gy * 0.0019);     // ~520 m
  vec4 nf = terrNG(P.xz * 0.0147 + 0.57, gx * 0.0147, gy * 0.0147);     // ~68 m
  vec4 nd = terrNG(P.xz * 0.109 + 0.13, gx * 0.109, gy * 0.109);        // ~9 m
  vec4 nu = vec4(0.5);                                                   // ~1.6 m, near only
  if (dist < 90.0) nu = terrNG(P.xz * 0.63 + 0.77, gx * 0.63, gy * 0.63);

  // ---- vegetation ground: lush / olive / dry-gold grass, forest floor, soil ------
  float dry = 0.78 - meadow;
  dry += (nm.r - 0.5) * 0.75 + (nM.g - 0.5) * 0.9 + (nf.g - 0.5) * 0.4;
  dry += smoothstep(0.06, 0.2, sl) * 0.22 - cav * 0.25;
  dry -= smoothstep(0.35, 0.8, flow) * 0.55;
  dry += sandst * 0.06; // the sandstone country is a little drier
  dry = clamp(dry, 0.0, 1.0);
  vec3 grass = mix(C_LUSH, C_OLIVE, smoothstep(0.2, 0.6, dry));
  grass = mix(grass, C_DRY, smoothstep(0.5, 0.85, dry));
  grass = mix(grass, C_STRAW, smoothstep(0.82, 1.0, dry) * 0.7);
  grass = mix(grass, C_ALPINE, smoothstep(430.0, 780.0, P.y + (nm.g - 0.5) * 200.0));
  grass *= 0.78 + 0.44 * nd.a;
  grass *= 0.86 + 0.28 * mix(0.5, nu.a, microFade);
  // flowers / seed heads: tiny light specks in lush meadows (near only)
  float fl = smoothstep(0.83, 0.9, nu.b) * (1.0 - dry) * microFade * (1.0 - forest);
  grass = mix(grass, vec3(0.62, 0.58, 0.42), fl * 0.5);

  vec3 floorC = mix(C_NEEDLE, C_MOSS, smoothstep(0.35, 0.7, nf.r + (nd.g - 0.5) * 0.4));
  floorC *= 0.72 + 0.5 * nd.b;
  float fo = smoothstep(0.08, 0.65, forest + (nf.b - 0.5) * 0.25);
  vec3 ground = mix(grass, floorC, fo);

  float soil = smoothstep(0.19, 0.32, sl + (nf.b - 0.5) * 0.14 + (nd.r - 0.5) * 0.08) * (1.0 - fo * 0.6) * 0.6;
  soil = max(soil, smoothstep(0.6, 0.95, flow) * smoothstep(0.03, 0.15, sl) * 0.7);
  vec3 soilC = mix(C_SOIL, C_SAND_A * 0.8, sandst * 0.45) * (0.78 + 0.44 * nd.r);
  ground = mix(ground, soilC, soil * 0.85);

  // ---- where rock shows -------------------------------------------------------
  float steep = smoothstep(0.3, 0.75, sl);
  float strataW = smoothstep(0.34, 0.62, sl);   // layering only reads on true cliffs
  float rockW = smoothstep(0.24, 0.38, sl + (nm.b - 0.5) * 0.14 + (nf.r - 0.5) * 0.1 - cav * 0.1);
  rockW = max(rockW, smoothstep(0.14, 0.3, sl) * smoothstep(-0.2, -0.6, cav));
  rockW = max(rockW, smoothstep(1350.0, 1800.0, P.y + (nm.r - 0.5) * 300.0));
  rockW *= 1.0 - smoothstep(0.3, 0.9, forest) * (1.0 - steep);
  // below cliff steepness rock only breaks through the turf in outcrops (patchy, not a carpet)
  float outcrop = smoothstep(0.42, 0.62, nf.r * 0.6 + nd.g * 0.4 + (1.0 - rockW) * -0.1);
  rockW *= mix(outcrop, 1.0, smoothstep(0.4, 0.6, sl) + smoothstep(1350.0, 1800.0, P.y));
  float scree = smoothstep(0.12, 0.45, talus + (nf.b - 0.5) * 0.35 + (nd.b - 0.5) * 0.15) * (1.0 - rockW);

  // ---- rock: stratified limestone / sandstone / granite / basalt ----------------
  vec3 rock = C_LIME_B;
  float bf = 0.5;
  float stMask = 0.0;
  float ledgeFade = 0.0;
  vec4 rt = vec4(0.5);
  vec4 rd = vec4(0.5);
  float h1 = 0.5;
  float stBump = 0.0;
  if (rockW + scree > 0.003) {
    rt = terrTri(P, N, 0.021, dPx, dPy);                 // ~48 m
    if (dist < 400.0) rd = terrTri(P, N, 0.16, dPx, dPy); // ~6 m
    // beds pinch and swell (lensing) along the cliff, not perfect contour lines
    float warp = (nm.g - 0.5) * 70.0 + (nM.b - 0.5) * 180.0 + (rt.r - 0.5) * 16.0 + (nf.a - 0.5) * 9.0;
    float sy = P.y + warp;
    // formations (~46 m, readable from kilometres) subdivided into beds (~10.5 m)
    float form = sy / 46.0;
    float fid = floor(form);
    float g1 = terrHash(vec2(fid, 3.0));
    float g2 = terrHash(vec2(fid, 11.0));
    float band = sy / 10.5 + 0.35 * sin(sy * 0.061 + g1 * 6.0); // uneven bed thickness
    float bid = floor(band);
    bf = fract(band);
    float bandFade = 1.0 - smoothstep(0.25, 0.9, fwY / 10.5);
    h1 = mix(0.5, terrHash(vec2(bid, 7.0)), bandFade);
    float h2 = mix(0.3, terrHash(vec2(bid, 19.0)), bandFade);
    float formFade = (1.0 - smoothstep(0.3, 0.9, fwY / 46.0)) * (1.0 - 0.45 * smoothstep(2300.0, 3200.0, length(P.xz)));
    g1 = mix(0.5, g1, formFade);
    g2 = mix(0.4, g2, formFade);
    vec3 lime = mix(C_LIME_A, C_LIME_B, g1 * (0.8 + 0.5 * strataW) + h1 * 0.35);
    lime = mix(lime, C_LIME_C, smoothstep(0.6, 0.8, g2) * 0.8);
    lime *= 0.9 + 0.2 * h1 * strataW;
    vec3 sand = mix(C_SAND_A, C_SAND_B, g1);
    sand = mix(sand, C_SAND_C, smoothstep(0.62, 0.8, g2) * 0.85);
    sand *= 0.88 + 0.24 * h1 * strataW;
    rock = mix(lime, sand, smoothstep(0.1, 0.8, sandst));
    // gentler rock slopes: weathered, blotchy, no bands
    vec3 slab = mix(mix(C_LIME_A, C_LIME_B, 0.3 + 0.4 * rt.b), mix(C_SAND_B, C_SAND_A, 0.3 + 0.4 * rt.b), smoothstep(0.1, 0.8, sandst));
    rock = mix(slab * (0.85 + 0.3 * mix(0.5, rd.r, fineFade)), rock, strataW);
    float ring = smoothstep(2250.0, 3100.0, length(P.xz) + (nm.b - 0.5) * 500.0);
    vec3 gran = mix(C_GRAN_A, C_GRAN_B, rt.g) * (0.9 + 0.2 * h1);
    // the ring is layered pale limestone (Dolomite-like: it glows pink at dusk) over grey gneiss
    rock = mix(rock, gran, ring * 0.5 * (1.0 - sandst));
    float volc = 1.0 - smoothstep(uTerrCrater.z * 0.85, uTerrCrater.z * 1.8, distance(P.xz, uTerrCrater.xy));
    rock = mix(rock, mix(C_BASALT_A, C_BASALT_B, h1), volc * 0.8);
    // fine laminations inside each band, fading before they alias
    float lamW = (1.0 - smoothstep(0.15, 0.6, fwY)) * strataW;
    rock *= 1.0 + 0.09 * lamW * sin(sy * 5.3 + rd.a * 4.0) * smoothstep(0.3, 0.7, rt.g);
    // undercut shadow line beneath each ledge + pale ledge lip
    ledgeFade = (1.0 - smoothstep(1.2, 4.0, fwY)) * strataW;
    // only the hard beds form ledges, and their lips are broken along the face
    float hard = smoothstep(0.45, 0.7, h2 + (rt.b - 0.5) * 0.6) * ledgeFade;
    rock *= mix(1.0, 0.74, smoothstep(0.84, 1.0, bf) * hard);
    rock *= mix(1.0, 1.12, (1.0 - smoothstep(0.0, 0.08, bf)) * hard);
    // mottling and blocks
    rock *= mix(0.88 + 0.24 * rt.a, 0.78 + 0.44 * rt.a, strataW);
    rock *= mix(1.0, 0.8 + 0.4 * rd.g, fineFade);
    // vertical erosion streaks (desert varnish / rain) on the steep faces
    if (steep > 0.0) {
      vec4 sx = textureGrad(uTerrNoise, vec2(P.z * 0.041, P.y * 0.0032) + 0.2, vec2(dPx.z * 0.041, dPx.y * 0.0032), vec2(dPy.z * 0.041, dPy.y * 0.0032));
      vec4 sz = textureGrad(uTerrNoise, vec2(P.x * 0.041, P.y * 0.0032) + 0.6, vec2(dPx.x * 0.041, dPx.y * 0.0032), vec2(dPy.x * 0.041, dPy.y * 0.0032));
      float wz = tw.z / max(tw.x + tw.z, 1e-3);
      // two widths of streak (ribbons + broad stains), so the face never reads as a picket fence
      float streak = mix(mix(sx.r, sx.a, 0.4), mix(sz.r, sz.a, 0.4), wz) + (rt.g - 0.5) * 0.35;
      stMask = smoothstep(0.5, 0.78, streak + (rt.b - 0.5) * 0.25) * steep;
      stBump = stMask; // (continuous: the bed-modulated mask below has steps)
      // stains start under each ledge lip and fade down the bed (not full-height curtains)
      stMask *= mix(1.0, mix(0.25, 1.0, bf * bf), strataW);
      rock = mix(rock, rock * C_VARNISH * 2.2, stMask * 0.55);
      float pale = smoothstep(0.66, 0.86, 1.0 - streak) * steep;
      rock = mix(rock, rock * 1.22, pale * 0.5);
    }
    // lichen / moss on cooler, lower rock
    float lich = smoothstep(0.62, 0.8, rd.b) * (1.0 - ring) * (1.0 - smoothstep(600.0, 900.0, P.y)) * (1.0 - smoothstep(220.0, 380.0, dist));
    rock = mix(rock, C_LICHEN * 0.8, lich * 0.18 * (1.0 - steep * 0.5));
    rock = mix(rock, C_MOSS, smoothstep(0.55, 0.9, cav + flow * 0.5) * (1.0 - steep) * 0.35);
  }

  // ---- scree aprons under cliffs ------------------------------------------------
  vec3 screeC = mix(rock, C_SCREE * (0.8 + 0.3 * h1), 0.45);
  float cells = mix(0.5, nd.b, fineFade);
  screeC *= 0.7 + 0.6 * smoothstep(0.1, 0.9, cells) * (0.6 + 0.4 * nu.r);

  // ---- shore: beach, pebbles, wet band, lake bed --------------------------------
  float beachTop = 1.6 + nf.r * 3.2 + (1.0 - smoothstep(0.02, 0.14, sl)) * 2.2;
  float beach = (1.0 - smoothstep(beachTop - 1.2, beachTop, P.y)) * (1.0 - smoothstep(0.34, 0.55, sl));
  vec3 beachC = mix(C_BEACH, C_PEBBLE, smoothstep(0.35, 0.75, nf.g + sl * 1.5));
  beachC *= 0.82 + 0.36 * mix(0.5, smoothstep(0.15, 0.6, nd.b), fineFade);
  float wet = 1.0 - smoothstep(0.05, 0.55 + 0.45 * nf.b, P.y);
  float under = smoothstep(0.0, -1.2, P.y);
  vec3 bed = mix(C_SILT, C_SILT_DEEP, smoothstep(-2.0, -26.0, P.y)) * (0.8 + 0.4 * nf.a);

  // ---- snow: altitude, aspect (north faces hold more), slope, strata ledges -----
  float snowLine = uTerrFar.w + (nM.r - 0.5) * 320.0 + N.z * 120.0 - cav * 60.0;
  float snowH = smoothstep(snowLine - 80.0, snowLine + 60.0, P.y + (nf.g - 0.5) * 110.0 + (nd.r - 0.5) * 24.0);
  // high up, snow plasters steeper faces too (snowy aretes), lower it only holds on gentle ground
  float snowAlt = smoothstep(snowLine + 100.0, snowLine + 650.0, P.y);
  float snowS = 1.0 - smoothstep(0.34 + 0.2 * snowAlt, 0.6 + 0.15 * snowAlt, sl + (nd.g - 0.5) * 0.16 - cav * 0.12);
  float ledgeSnow = (1.0 - smoothstep(0.05, 0.32, bf)) * smoothstep(0.3, 0.5, sl) * ledgeFade;
  float snow = snowH * max(snowS, ledgeSnow * 0.85);
  snow = max(snow, snowH * smoothstep(0.5, 0.9, flow) * 0.8); // couloirs
  vec3 snowC = C_SNOW * (0.9 + 0.1 * nd.a);
  snowC = mix(snowC, snowC * vec3(0.8, 0.86, 0.97), smoothstep(0.1, 0.6, cav));

  // ---- composite ------------------------------------------------------------------
  vec3 col = ground;
  float rough = mix(0.92, 0.97, fo);
  col = mix(col, screeC, scree);
  rough = mix(rough, 0.9, scree);
  col = mix(col, rock, rockW);
  rough = mix(rough, 0.8 - stMask * 0.12, rockW);
  float bw = beach * (1.0 - rockW * 0.7);
  col = mix(col, beachC, bw);
  rough = mix(rough, 0.9, bw);
  col *= mix(1.0, 0.48, wet * (1.0 - under));
  rough = mix(rough, mix(0.2, 0.4, steep), wet * (1.0 - under));
  col = mix(col, bed, under);
  rough = mix(rough, 0.55, under);
  // dark wet drainage lines on rock & scree
  col *= 1.0 - 0.28 * smoothstep(0.55, 0.9, flow) * max(rockW, scree) * (1.0 - snow);
  col = mix(col, snowC, snow);
  rough = mix(rough, 0.5, snow);
  // macro variation so large areas never read as one colour
  col *= 0.84 + 0.32 * nM.a;
  col *= mix(vec3(1.0), vec3(1.05, 0.98, 0.9), smoothstep(0.35, 0.75, nm.a) * (1.0 - snow));
  col *= 1.0 - 0.2 * max(cav, 0.0) * (1.0 - snow);
  diffuseColor.rgb = col;
  roughnessFactor = clamp(rough, 0.04, 1.0);
  terrAO = clamp(1.0 - max(cav, 0.0) * 0.6 - fo * 0.15, 0.3, 1.0);

  // ---- normal: macro (far maps) + meso/micro bump near the camera -----------------
  float bumpH = 0.0;
  // broad buttresses and hollows (smooth channel; the high-frequency one reads as reptile scales)
  bumpH += (rt.g - 0.5) * 2.2 * rockW * (0.6 + 0.8 * strataW) * (1.0 - smoothstep(300.0, 1100.0, dist));
  bumpH += (rt.a - 0.5) * 0.35 * rockW * fineFade;
  bumpH += (rd.g - 0.5) * 0.45 * rockW * fineFade;
  // undercut groove below each ledge: a continuous tent in the bed coordinate (a step would spike
  // the derivative-based bump into dotted contour lines)
  float groove = smoothstep(0.78, 0.92, bf) * (1.0 - smoothstep(0.92, 1.0, bf));
  bumpH -= groove * 0.5 * rockW * ledgeFade * (1.0 - smoothstep(200.0, 700.0, dist));
  bumpH += (nd.a - 0.5) * 0.18 * (1.0 - rockW) * fineFade;
  bumpH += (nu.a - 0.5) * 0.06 * (1.0 - rockW) * microFade;
  bumpH += smoothstep(0.2, 0.7, nd.b) * 0.12 * (scree + bw * 0.5) * fineFade;
  bumpH -= stBump * 0.9 * rockW * (1.0 - smoothstep(250.0, 800.0, dist)); // rain flutes on cliffs
  bumpH *= 1.0 - snowH * snowS * 0.75; // (smooth snow term: the ledge snow has steps)
  vec3 Nv = normalize((viewMatrix * vec4(N, 0.0)).xyz);
  normal = terrBump(-vViewPosition, Nv, bumpH * detail);
  // terminator: bump detail may not light ground that faces away from the sun (and the shadow
  // map's self-comparison there would sparkle)
  terrSunVis *= smoothstep(-0.03, 0.12, dot(Nv, terrSunDirV));
  // specular anti-aliasing: widen the lobe where the normal varies within a pixel (no glint fireflies)
  vec3 dnx = dFdx(normal), dny = dFdy(normal);
  float sAA = min(0.2, 2.0 * max(dot(dnx, dnx), dot(dny, dny)));
  roughnessFactor = sqrt(clamp(roughnessFactor * roughnessFactor + sAA, 0.0, 1.0));
}
`;

const SUN_PATCH_FIND = 'getDirectionalLightInfo( directionalLight, directLight );';
const SUN_PATCH = `getDirectionalLightInfo( directionalLight, directLight );
		directLight.color *= mix( 1.0, terrSunVis, step( 0.995, dot( directLight.direction, terrSunDirV ) ) );`;

// ---------------------------------------------------------------------------

/**
 * Opt-in for other modules: make a built-in lit material (standard / physical / lambert / phong)
 * receive the terrain's basin-wide mountain shadows (heightfield visibility of the key light), so
 * trees, rocks and buildings darken with the ground when a ridge far away hides the sun.
 * Uses the fog chunk's world-position varying (every built-in material is fogged here).
 */
export function makeMountainShadowPatch(uniforms) {
  const pars = `
uniform sampler2D uTerrSun;
uniform vec4 uTerrWorld;
uniform vec3 uTerrSunDir;
`;
  const begin = `
float terrSunVis = 1.0;
vec3 terrSunDirV = normalize((viewMatrix * vec4(uTerrSunDir, 0.0)).xyz);
#ifdef USE_FOG
{
  vec2 wuv = (vAtmoWorldPos.xz - uTerrWorld.xy) * uTerrWorld.z + uTerrWorld.w;
  vec2 we = min(wuv, 1.0 - wuv);
  terrSunVis = mix(1.0, texture2D(uTerrSun, wuv).r, smoothstep(0.0, 0.03, min(we.x, we.y)));
}
#endif
`;
  return (material) => {
    if (material.userData.mwMountainShadows) return material;
    material.userData.mwMountainShadows = true;
    const prev = material.onBeforeCompile;
    const prevKey = material.customProgramCacheKey;
    material.onBeforeCompile = function (shader, renderer) {
      if (prev) prev.call(this, shader, renderer);
      shader.uniforms.uTerrSun = uniforms.uTerrSun;
      shader.uniforms.uTerrWorld = uniforms.uTerrWorld;
      shader.uniforms.uTerrSunDir = uniforms.uTerrSunDir;
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${pars}`)
        .replace('#include <lights_fragment_begin>', `${begin}\n${THREE.ShaderChunk.lights_fragment_begin.replace(SUN_PATCH_FIND, SUN_PATCH)}`);
    };
    material.customProgramCacheKey = function () {
      return `${prevKey ? prevKey.call(this) : ''}|mw-mtn-shadow`;
    };
    material.needsUpdate = true;
    return material;
  };
}

export function createTerrainMaterial(ctx, maps) {
  const rng = ctx.noise.createRng('terrain-noise');
  const noiseTex = makeNoiseTexture(rng);
  // anisotropic filtering keeps grazing-angle ground crisp (skipped on low/medium: costly on weak GPUs)
  if (ctx.quality.level === 'high') noiseTex.anisotropy = Math.min(8, ctx.renderer.capabilities.getMaxAnisotropy());
  const crater = ctx.layout.LANDMARK_BY_ID.orrery;
  const detail = ctx.quality.terrainDetail;

  const morph = [];
  for (let i = 0; i <= MAX_LEVEL; i++) morph.push(new THREE.Vector2(1e9, 1e9 + 1));

  const uniforms = {
    uTerrCam: { value: new THREE.Vector3() },
    uTerrMorph: { value: morph },
    uTerrA: { value: maps.A },
    uTerrB: { value: maps.B },
    uTerrSun: { value: maps.sun },
    uTerrNoise: { value: noiseTex },
    uTerrWorld: { value: new THREE.Vector4(WG_X0, WG_X0, 1 / (WG_STEP * WG_N), 0.5 / WG_N) },
    uTerrFar: { value: new THREE.Vector4(550, 1500, detail, 1020) },
    uTerrCrater: { value: new THREE.Vector4(crater.x, crater.z, 470, 0) },
    uTerrSunDir: { value: new THREE.Vector3(0, 1, 0) },
  };

  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, metalness: 0 });
  mat.name = 'terrain';
  mat.customProgramCacheKey = () => 'mw-terrain-1';
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERT_PARS}\nvarying vec3 vTerrPos;\nvarying vec3 vTerrNrm;`)
      .replace('#include <beginnormal_vertex>', VERT_MORPH_NORMAL)
      .replace('#include <begin_vertex>', VERT_MORPH_POS)
      .replace('#include <project_vertex>', `#include <project_vertex>\nvTerrPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvTerrNrm = objectNormal;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAG_PARS}`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\n${FRAG_MAIN}`)
      .replace('#include <lights_fragment_begin>', THREE.ShaderChunk.lights_fragment_begin.replace(SUN_PATCH_FIND, SUN_PATCH))
      .replace('#include <aomap_fragment>', `#include <aomap_fragment>\nreflectedLight.indirectDiffuse *= terrAO;\nreflectedLight.indirectSpecular *= mix(1.0, terrAO, 0.7);`);
  };

  // Shadow-pass material with the same geomorph, so shadows match the rendered surface.
  const depth = new THREE.MeshDepthMaterial();
  depth.name = 'terrain-depth';
  depth.customProgramCacheKey = () => 'mw-terrain-depth-1';
  depth.onBeforeCompile = (shader) => {
    shader.uniforms.uTerrCam = uniforms.uTerrCam;
    shader.uniforms.uTerrMorph = uniforms.uTerrMorph;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERT_PARS}`)
      .replace('#include <begin_vertex>', `float terrKp;\nfloat terrK = terrMorphK(terrKp);\n${VERT_MORPH_POS}`);
  };

  return { material: mat, depthMaterial: depth, uniforms, noiseTex };
}
