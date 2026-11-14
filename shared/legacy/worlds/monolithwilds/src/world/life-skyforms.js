// The Drifters — a handful of colossal seed-lanterns adrift 1–1.8 km above the basin.
//
// Anatomy of one (local frame, y up, ~300 m from crown to claws):
//   husk     a ribbed, pumpkin-scalloped translucent membrane (a paper-lantern / physalis husk),
//            open at the bottom, torn away in a few lower bays
//   ribs     slender meridian ribs that run past the mouth and curl outward into claws, each
//            ending in a heavy bead — the same weights that hang from the Loom
//   crown    a pappus of ~100 fine filaments bursting from the apex like a dandelion seed,
//            drooping at their tips: the sail that keeps the thing aloft
//   seed     a glowing ovoid core suspended inside the husk by radiating fibres
//   threads  long plumb-lines (250–650 m) hanging from the claws and the mouth, beaded, swaying
//            with slow travelling waves
// Everything is animated in the vertex shader from per-form uniforms (position, rotation,
// breathing phase, drag): the husk breathes, the crown opens and closes a beat later, threads
// sway and trail behind the drift. By day they are pale, sun-shot ghosts at the edge of the haze
// (the membrane glows when the sun is behind them); at night the veins wake a faint cyan and
// slow amber pulses travel down the threads.
//
// Two draw calls: the body (membrane + ribs, premultiplied translucency) and the lines (crown,
// fibres, threads as min-pixel-width camera ribbons + bead/seed glow sprites, additive).

import * as THREE from 'crownfall-world-three';
import { LIFE_VERT_UNIFORMS, LIFE_FRAG_UNIFORMS } from './life-common.js';

const TAU = Math.PI * 2;
const NF = 5; // uniform array size (max forms)

const FORMS = [
  { at: [-250, 1360, -980], orbit: [700, 420], period: 1900, phase: 0.3, scale: 1.12, ribs: 11, crown: 120, threads: 22, spin: 1 / 340 },
  { at: [980, 1660, -2080], orbit: [520, 320], period: 2300, phase: 2.1, scale: 0.88, ribs: 9, crown: 96, threads: 16, spin: -1 / 410 },
  { at: [-1500, 1200, 380], orbit: [480, 560], period: 2100, phase: 4.0, scale: 1.0, ribs: 12, crown: 110, threads: 19, spin: 1 / 380 },
  { at: [1420, 1520, 820], orbit: [600, 460], period: 2600, phase: 5.2, scale: 1.24, ribs: 13, crown: 130, threads: 25, spin: -1 / 300 },
  { at: [120, 1800, -2250], orbit: [380, 200], period: 1700, phase: 1.3, scale: 0.7, ribs: 9, crown: 84, threads: 13, spin: 1 / 260 },
];

// husk profile: v (0 apex .. 1 mouth), y, r
const PROFILE = [
  [0.0, 95, 0],
  [0.05, 90, 15],
  [0.15, 72, 43],
  [0.3, 42, 64],
  [0.45, 12, 73],
  [0.6, -18, 70],
  [0.75, -48, 58],
  [0.88, -75, 42],
  [1.0, -100, 30],
];
// rib continuation past the mouth: outward curl, then hanging claw (r, y)
const CLAW = [
  [30, -100],
  [37, -118],
  [49, -138],
  [59, -160],
  [63, -180],
  [61, -198],
];

function catmull(p0, p1, p2, p3, t) {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}
/** Smooth profile sample at v in [0,1] -> [y, r]. */
function profileAt(v) {
  const P = PROFILE;
  let i = 0;
  while (i < P.length - 2 && v > P[i + 1][0]) i++;
  const a = P[Math.max(0, i - 1)];
  const b = P[i];
  const c = P[i + 1];
  const d = P[Math.min(P.length - 1, i + 2)];
  const t = (v - b[0]) / (c[0] - b[0]);
  return [catmull(a[1], b[1], c[1], d[1], t), Math.max(0, catmull(a[2], b[2], c[2], d[2], t))];
}

// ---------------------------------------------------------------------------------------------
// Shared GLSL: per-form transform + deformation (keeps ribs, fibres, threads and beads attached)
// ---------------------------------------------------------------------------------------------
const FORM_GLSL = /* glsl */ `
uniform vec4 uFormPos[${NF}];   // xyz world centre, w scale
uniform mat3 uFormRot[${NF}];
uniform vec4 uFormAnim[${NF}];  // x breath phase, y crown phase, z/w unused
uniform vec4 uFormDrag[${NF}];  // xyz world drag vector (m of trailing per 100 m of thread)
uniform vec4 uSkyForms;         // x visibility (alpha + lit gain), y night glow, zw unused

// breathing: the husk swells around its equator; claws and threads ride along with the mouth
vec3 formBreath(vec3 p, float breath) {
  float b = sin(breath);
  float w = 1.0 - smoothstep(0.0, 115.0, abs(p.y - 5.0));
  float sr = 1.0 + 0.045 * b * w + 0.03 * b * smoothstep(-95.0, -150.0, p.y);
  p.xz *= sr;
  p.y *= 1.0 - 0.012 * b * step(-100.0, p.y);
  return p;
}
`;

const BODY_VS = /* glsl */ `
${LIFE_VERT_UNIFORMS}
${FORM_GLSL}
attribute vec4 aB; // form id, kind (0 membrane, 1 rib), v along the profile, seed
varying vec3 vWorld;
varying vec3 vN;
varying vec4 vB;
#include <fog_pars_vertex>
void main() {
  int f = int(aB.x + 0.5);
  vec4 fp = uFormPos[f];
  vec3 p = formBreath(position, uFormAnim[f].x);
  vec3 wp = fp.xyz + uFormRot[f] * (p * fp.w);
  vWorld = wp;
  vN = normalize(uFormRot[f] * normal);
  vB = aB;
  vec4 mvPosition = viewMatrix * vec4(wp, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const BODY_FS = /* glsl */ `
${LIFE_FRAG_UNIFORMS}
uniform vec4 uSkyForms;
varying vec3 vWorld;
varying vec3 vN;
varying vec4 vB;
#include <fog_pars_fragment>
void main() {
  float t = uAtmoTime.x;
  vec3 V = normalize(vWorld - cameraPosition);
  vec3 n = normalize(vN);
  float ndv = abs(dot(n, V));
  float fres = pow(1.0 - ndv, 2.2);
  float rib = vB.y;
  float v = vB.z;
  // membrane: veins parallel to the ribs and growth rings, faded out before they alias
  float vw = vB.w * 4.0;
  float vr = v * 12.0;
  float aa = 1.0 - smoothstep(0.25, 0.7, max(fwidth(vw), fwidth(vr)));
  float veins = (pow(abs(sin(vw * 3.1416)), 16.0) * 0.6 + pow(abs(sin(vr * 3.1416)), 20.0) * 0.35) * aa;
  float a = mix(0.035 + 0.42 * fres + 0.08 * veins, 0.3 + 0.45 * fres, rib);
  // light: sun through the membrane when it is behind the form, soft sky, a little diffuse
  float mu = max(dot(V, uKeyDir), 0.0);
  float trans = pow(mu, 4.0) * 1.3 + pow(mu, 24.0) * 2.5;
  float diff = max(dot(n, uKeyDir), 0.0) * 0.5 + max(-dot(n, uKeyDir), 0.0) * 0.25;
  vec3 ivory = vec3(0.92, 0.86, 0.76);
  vec3 lit = ivory * (uSkyLight * 0.5 + uSunLight * (0.1 * diff + trans * (1.0 - rib * 0.7)));
  a *= uSkyForms.x;
  vec3 col = lit * a;
  // night: veins and ribs wake a faint cold cyan; a slow pulse climbs down from the crown
  float pulse = 0.35 + 0.65 * pow(0.5 + 0.5 * sin(v * 9.0 - t * 0.45 + vB.w * 2.0), 6.0);
  vec3 cyan = vec3(0.37, 0.9, 1.0);
  col += cyan * uSkyForms.y * pulse * (0.05 * (0.3 + veins) * (1.0 - rib) + 0.1 * rib + 0.02 * fres);
  // haze swallows them: fade (not tint) with the atmosphere's optical depth
  vec4 fogT = atmoFogTerm(cameraPosition, vWorld);
  float keep = 1.0 - fogT.a;
  col = col * keep + fogT.rgb * (a * fogT.a * 0.35);
  gl_FragColor = vec4(col, a * keep);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const LINE_VS = /* glsl */ `
${LIFE_VERT_UNIFORMS}
${FORM_GLSL}
attribute vec3 aTan;
attribute vec4 aL; // form id, kind (0 crown, 1 thread, 2 fibre, 3 bead sprite, 4 seed sprite), u along, seed
attribute vec4 aW; // side (-1..1) / sprite corner x, sprite corner y, width or sprite size (m), curve length (m)
varying vec4 vL;
varying vec2 vUV;
varying float vCov;
varying vec3 vWorld;
#include <fog_pars_vertex>

vec3 deformLine(vec3 p, float kind, float u, float seed, float len, float t, int f) {
  p = formBreath(p, uFormAnim[f].x);
  if (kind < 0.5) {
    // crown filaments open and close a beat after the husk, and flutter
    vec3 apex = vec3(0.0, 92.0, 0.0);
    vec3 q = p - apex;
    float o = 1.0 + 0.09 * sin(uFormAnim[f].y);
    q.xz *= o;
    q.y -= (o - 1.0) * 0.45 * length(q.xz);
    q += vec3(sin(t * 0.9 + seed * 40.0 + u * 7.0), 0.4 * sin(t * 0.7 + seed * 23.0), cos(t * 0.8 + seed * 31.0 + u * 6.0)) * (1.8 * u * u);
    p = apex + q;
  } else if (kind < 1.5 || (kind > 2.5 && kind < 3.5)) {
    // threads (and their beads): travelling waves growing toward the free end
    float amp = 0.075 * len * pow(u, 1.5);
    p += amp * vec3(sin(t * 0.19 - u * 3.8 + seed * 6.28), 0.0, cos(t * 0.15 - u * 3.1 + seed * 4.1));
    p.y += 0.02 * len * u * u * sin(t * 0.11 + seed * 9.0);
  }
  return p;
}

void main() {
  int f = int(aL.x + 0.5);
  float kind = aL.y;
  float u = aL.z;
  float seed = aL.w;
  float t = uLifeTime.x;
  vec4 fp = uFormPos[f];
  mat3 R = uFormRot[f];
  vec3 lp = deformLine(position, kind, u, seed, aW.w, t, f);
  vec3 wp = fp.xyz + R * (lp * fp.w);
  // threads trail behind the drift
  if (kind > 0.5 && kind < 1.5 || (kind > 2.5 && kind < 3.5)) wp += uFormDrag[f].xyz * (u * u * aW.w * 0.01 * fp.w);
  float dist = max(length(wp - cameraPosition), 1.0);
  vL = aL;
  vUV = aW.xy;
  vec4 mvPosition;
  if (kind > 2.5) {
    // camera-facing glow sprite; never smaller than a few pixels (energy kept via vCov)
    float size = aW.z * fp.w;
    float minSize = 3.0 * dist / uProj;
    float s = max(size, minSize);
    vCov = (size / s) * (size / s);
    mvPosition = viewMatrix * vec4(wp, 1.0);
    mvPosition.xy += aW.xy * s * 0.5;
  } else {
    // camera-facing ribbon at least ~1.2 px wide; thinner ones fade instead of aliasing
    vec3 T = normalize(R * aTan);
    vec3 side = normalize(cross(T, wp - cameraPosition));
    float w = aW.z * fp.w;
    float minW = 1.3 * dist / uProj;
    float ww = max(w, minW);
    vCov = w / ww;
    wp += side * aW.x * ww * 0.5;
    mvPosition = viewMatrix * vec4(wp, 1.0);
  }
  vWorld = wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const LINE_FS = /* glsl */ `
${LIFE_FRAG_UNIFORMS}
uniform vec4 uSkyForms;
varying vec4 vL;
varying vec2 vUV;
varying float vCov;
varying vec3 vWorld;
#include <fog_pars_fragment>
void main() {
  float t = uAtmoTime.x;
  float kind = vL.y;
  float u = vL.z;
  float seed = vL.w;
  vec3 V = normalize(vWorld - cameraPosition);
  float mu = max(dot(V, uKeyDir), 0.0);
  vec3 amber = vec3(1.0, 0.62, 0.28);
  vec3 cyan = vec3(0.37, 0.9, 1.0);
  vec3 col;
  if (kind > 2.5) {
    float r2 = dot(vUV, vUV);
    float g = exp(-r2 * 5.0) + 0.35 * exp(-r2 * 1.6);
    g *= 1.0 - smoothstep(0.8, 1.0, r2);
    float isSeed = step(3.5, kind);
    // beads: pale pearls by day (lit from behind), amber embers at night, pulsing slowly
    float beat = 0.55 + 0.45 * sin(t * 0.35 + seed * 20.0 + u * 6.0);
    vec3 day = uSunLight * (0.02 + 0.25 * pow(mu, 6.0)) + uSkyLight * 0.05;
    vec3 night = amber * (isSeed > 0.5 ? 1.6 : 1.1) * beat;
    col = (day * uSkyForms.x * mix(0.8, 1.6, isSeed) + night * uSkyForms.y) * g;
  } else {
    float across = 1.0 - vUV.x * vUV.x;
    // silk: catches the light when the sun is behind it, a faint sheen otherwise
    vec3 day = uSunLight * (0.025 + 0.4 * pow(mu, 5.0) + 0.8 * pow(mu, 30.0)) + uSkyLight * 0.045;
    float fadeEnd = kind < 0.5 ? 1.0 - smoothstep(0.7, 1.0, u) * 0.8 : 1.0 - smoothstep(0.85, 1.0, u) * 0.6;
    // night: signals run down the threads, the crown shimmers cold
    float sig = pow(0.5 + 0.5 * sin(u * 22.0 - t * 0.55 + seed * 30.0), 14.0);
    vec3 night = kind < 0.5 ? cyan * (0.1 + 0.25 * sig) : mix(cyan * 0.12, amber * 1.4, sig);
    col = (day * uSkyForms.x + night * uSkyForms.y) * across * fadeEnd * (kind > 1.5 ? 0.6 : 1.0);
  }
  col *= vCov;
  vec4 fogT = atmoFogTerm(cameraPosition, vWorld);
  col *= 1.0 - fogT.a;
  gl_FragColor = vec4(col, 0.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

// ---------------------------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------------------------

function buildForm(fi, spec, rng, body, lines) {
  const K = spec.ribs;
  // rib angles, slightly irregular
  const ribA = [];
  for (let k = 0; k < K; k++) ribA.push(((k + rng.range(-0.12, 0.12)) / K) * TAU);
  const SAG = 0.12;
  const BAY_SEG = 6;
  const VSEG = 30;
  const NU = K * BAY_SEG;

  // --- membrane (scalloped between ribs, some lower bays torn open)
  const torn = new Float32Array(K).fill(2);
  for (let k = 0; k < K; k++) if (rng() < 0.35) torn[k] = rng.range(0.55, 0.85);
  const memP = [];
  const memTheta = [];
  for (let j = 0; j <= VSEG; j++) {
    const v = j / VSEG;
    const [y, r0] = profileAt(v);
    for (let i = 0; i <= NU; i++) {
      const k = Math.floor(i / BAY_SEG) % K;
      const fr = (i % BAY_SEG) / BAY_SEG;
      const a0 = ribA[k];
      const a1 = k === K - 1 ? ribA[0] + TAU : ribA[k + 1];
      const a = a0 + (a1 - a0) * (i === NU ? 1 : fr);
      const sag = Math.sin(Math.PI * (i === NU ? 0 : fr)) ** 2;
      const r = r0 * (1 - SAG * sag);
      memP.push([Math.cos(a) * r, y, Math.sin(a) * r]);
      memTheta.push(a);
    }
  }
  const memG = new THREE.BufferGeometry();
  const mp = new Float32Array(memP.length * 3);
  memP.forEach((p, i) => mp.set(p, i * 3));
  memG.setAttribute('position', new THREE.BufferAttribute(mp, 3));
  const mIdx = [];
  const row = NU + 1;
  for (let j = 0; j < VSEG; j++) {
    const v = (j + 0.5) / VSEG;
    for (let i = 0; i < NU; i++) {
      const k = Math.floor(i / BAY_SEG);
      // ragged tear: lower part of some bays is gone, with an uneven edge
      const edge = torn[k] + 0.06 * Math.sin(i * 2.7 + k * 1.3) + 0.03 * Math.sin(i * 7.1);
      if (v > edge) continue;
      const a = j * row + i;
      mIdx.push(a, a + row, a + 1, a + 1, a + row, a + row + 1);
    }
  }
  memG.setIndex(mIdx);
  memG.computeVertexNormals();
  const mn = memG.attributes.normal.array;
  const base = body.P.length / 3;
  for (let i = 0; i < memP.length; i++) {
    body.P.push(...memP[i]);
    body.N.push(mn[i * 3], mn[i * 3 + 1], mn[i * 3 + 2]);
    body.B.push(fi, 0, Math.floor(i / row) / VSEG, memTheta[i] * K / TAU);
  }
  for (const x of mIdx) body.I.push(base + x);

  // --- ribs: tubes along the meridians, through the mouth into the claws, bead at the end
  const clawTips = [];
  for (let k = 0; k < K; k++) {
    const a = ribA[k];
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const pts = [];
    for (let j = 1; j <= 36; j++) {
      const v = j / 36;
      const [y, r] = profileAt(v);
      pts.push([r + 1.2, y, v]);
    }
    const clawLen = rng.range(0.85, 1.08);
    for (let j = 1; j < CLAW.length; j++) pts.push([CLAW[j][0] * (0.9 + 0.1 * clawLen), CLAW[0][1] + (CLAW[j][1] - CLAW[0][1]) * clawLen, 1 + j / CLAW.length]);
    const last = pts[pts.length - 1];
    clawTips.push([ca * last[0], last[1], sa * last[0]]);
    const SIDES = 5;
    const rb = body.P.length / 3;
    for (let j = 0; j < pts.length; j++) {
      const [r, y, v] = pts[j];
      const prev = pts[Math.max(0, j - 1)];
      const next = pts[Math.min(pts.length - 1, j + 1)];
      // tangent in the (radial, y) plane
      let tr = next[0] - prev[0];
      let ty = next[1] - prev[1];
      const tl = Math.hypot(tr, ty) || 1;
      tr /= tl;
      ty /= tl;
      // in-plane normal (outward) and the tangential direction around the axis
      const nr = ty;
      const ny = -tr;
      const rad = 2.4 * (1 - 0.35 * Math.min(1, v)) * (v < 0.04 ? 0.6 : 1);
      for (let s = 0; s < SIDES; s++) {
        const ang = (s / SIDES) * TAU;
        const cr = Math.cos(ang);
        const sr = Math.sin(ang);
        // offset = cr * inPlaneNormal + sr * aroundAxis
        const ox = cr * nr * ca - sr * sa;
        const oy = cr * ny;
        const oz = cr * nr * sa + sr * ca;
        body.P.push(ca * r + ox * rad, y + oy * rad, sa * r + oz * rad);
        body.N.push(ox, oy, oz);
        body.B.push(fi, 1, Math.min(1.2, v), a * K / TAU);
      }
    }
    for (let j = 0; j < pts.length - 1; j++) {
      for (let s = 0; s < SIDES; s++) {
        const a0 = rb + j * SIDES + s;
        const a1 = rb + j * SIDES + ((s + 1) % SIDES);
        body.I.push(a0, a0 + SIDES, a1, a1, a0 + SIDES, a1 + SIDES);
      }
    }
  }

  // --- lines helpers
  const addRibbon = (pts, kind, width0, width1, seed, len) => {
    const b0 = lines.P.length / 3;
    const n = pts.length;
    for (let j = 0; j < n; j++) {
      const p = pts[j];
      const q = pts[Math.min(n - 1, j + 1)];
      const o = pts[Math.max(0, j - 1)];
      let tx = q[0] - o[0];
      let ty = q[1] - o[1];
      let tz = q[2] - o[2];
      const tl = Math.hypot(tx, ty, tz) || 1;
      tx /= tl;
      ty /= tl;
      tz /= tl;
      const u = j / (n - 1);
      const w = width0 + (width1 - width0) * u;
      for (const side of [-1, 1]) {
        lines.P.push(p[0], p[1], p[2]);
        lines.T.push(tx, ty, tz);
        lines.L.push(fi, kind, u, seed);
        lines.W.push(side, 0, w, len);
      }
    }
    for (let j = 0; j < n - 1; j++) {
      const a = b0 + j * 2;
      lines.I.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  };
  const addSprite = (p, kind, size, u, seed, len) => {
    const b0 = lines.P.length / 3;
    for (const [cx, cy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      lines.P.push(p[0], p[1], p[2]);
      lines.T.push(0, 1, 0);
      lines.L.push(fi, kind, u, seed);
      lines.W.push(cx, cy, size, len);
    }
    lines.I.push(b0, b0 + 1, b0 + 2, b0, b0 + 2, b0 + 3);
  };

  // --- crown: pappus filaments from a small cap around the apex, drooping at the tips
  for (let c = 0; c < spec.crown; c++) {
    const phi = rng() * TAU;
    const alpha = THREE.MathUtils.degToRad(rng.range(18, 78));
    const Lc = rng.range(95, 165) * (1 - 0.25 * (alpha / 1.4));
    const capR = rng.range(2, 13);
    const s0 = [Math.cos(phi) * capR, profileAt(capR / 300)[0] + 1, Math.sin(phi) * capR];
    const d = [Math.cos(phi) * Math.sin(alpha), Math.cos(alpha), Math.sin(phi) * Math.sin(alpha)];
    const pts = [];
    const SEG = 14;
    for (let j = 0; j <= SEG; j++) {
      const u = j / SEG;
      pts.push([s0[0] + d[0] * Lc * u, s0[1] + d[1] * Lc * u - 0.32 * Lc * u * u * (0.6 + Math.sin(alpha)), s0[2] + d[2] * Lc * u]);
    }
    const seed = rng();
    addRibbon(pts, 0, 1.1, 0.5, seed, Lc);
    // feathery tuft at the tip
    const tip = pts[SEG];
    const nt = rng.int(2, 4);
    for (let k = 0; k < nt; k++) {
      const pa = phi + rng.range(-0.9, 0.9);
      const tl = rng.range(10, 22);
      const tp = [];
      for (let j = 0; j <= 3; j++) {
        const u = j / 3;
        tp.push([tip[0] + Math.cos(pa) * tl * u, tip[1] + rng.range(-0.3, 0.6) * tl * u - 0.4 * tl * u * u, tip[2] + Math.sin(pa) * tl * u]);
      }
      addRibbon(tp, 0, 0.5, 0.25, seed, Lc);
    }
  }

  // --- the seed and its fibres
  const core = [0, -8, 0];
  addSprite(core, 4, 70, 0, rng(), 0);
  addSprite(core, 4, 26, 0, rng(), 0);
  for (let k = 0; k < K; k++) {
    for (const v of [0.35, 0.62]) {
      const [y, r] = profileAt(v + rng.range(-0.05, 0.05));
      const a = ribA[k];
      const end = [Math.cos(a) * r * 0.98, y, Math.sin(a) * r * 0.98];
      const pts = [];
      for (let j = 0; j <= 6; j++) {
        const u = j / 6;
        pts.push([core[0] + (end[0] - core[0]) * u, core[1] + (end[1] - core[1]) * u - 4 * Math.sin(Math.PI * u), core[2] + (end[2] - core[2]) * u]);
      }
      addRibbon(pts, 2, 0.7, 0.5, rng(), 70);
    }
  }

  // --- threads: one from each claw, the rest from inside the mouth; beaded, weighted
  for (let k = 0; k < spec.threads; k++) {
    let top;
    if (k < K) top = clawTips[k];
    else {
      const a = rng() * TAU;
      const r = rng.range(8, 24);
      top = [Math.cos(a) * r, -92 + rng.range(-4, 4), Math.sin(a) * r];
    }
    const len = k < K ? rng.range(240, 480) : rng.range(360, 650);
    const seed = rng();
    const SEG = Math.round(len / 9);
    const spread = [top[0] * 0.0006 * len, top[2] * 0.0006 * len];
    const pts = [];
    for (let j = 0; j <= SEG; j++) {
      const u = j / SEG;
      pts.push([top[0] + spread[0] * u, top[1] - len * u, top[2] + spread[1] * u]);
    }
    addRibbon(pts, 1, 0.9, 0.6, seed, len);
    // beads every 30–60 m, the terminal weight larger
    let d = rng.range(25, 50);
    while (d < len - 20) {
      const u = d / len;
      addSprite([top[0] + spread[0] * u, top[1] - d, top[2] + spread[1] * u], 3, rng.range(3.5, 6), u, seed, len);
      d += rng.range(30, 62);
    }
    addSprite([top[0] + spread[0], top[1] - len, top[2] + spread[1]], 3, rng.range(10, 15), 1, seed, len);
  }
  // beads on the claw tips
  for (const tip of clawTips) addSprite(tip, 3, 9, 0, rng(), 1);
}

// ---------------------------------------------------------------------------------------------

export function buildSkyforms(ctx, shared) {
  const rng = ctx.noise.createRng('life-skyforms');
  const q = ctx.quality.level;
  const forms = FORMS.slice(0, q === 'low' ? 3 : FORMS.length);

  const body = { P: [], N: [], B: [], I: [] };
  const lines = { P: [], T: [], L: [], W: [], I: [] };
  forms.forEach((spec, i) => {
    const s = { ...spec };
    if (q === 'low') {
      s.crown = Math.round(s.crown * 0.6);
      s.threads = Math.round(s.threads * 0.7);
    }
    buildForm(i, s, rng, body, lines);
  });

  const bodyGeo = new THREE.BufferGeometry();
  bodyGeo.setAttribute('position', new THREE.Float32BufferAttribute(body.P, 3));
  bodyGeo.setAttribute('normal', new THREE.Float32BufferAttribute(body.N, 3));
  bodyGeo.setAttribute('aB', new THREE.Float32BufferAttribute(body.B, 4));
  bodyGeo.setIndex(body.I);
  const lineGeo = new THREE.BufferGeometry();
  lineGeo.setAttribute('position', new THREE.Float32BufferAttribute(lines.P, 3));
  lineGeo.setAttribute('aTan', new THREE.Float32BufferAttribute(lines.T, 3));
  lineGeo.setAttribute('aL', new THREE.Float32BufferAttribute(lines.L, 4));
  lineGeo.setAttribute('aW', new THREE.Float32BufferAttribute(lines.W, 4));
  lineGeo.setIndex(lines.I);

  const formU = {
    uFormPos: { value: Array.from({ length: NF }, () => new THREE.Vector4(0, -1e5, 0, 1)) },
    uFormRot: { value: Array.from({ length: NF }, () => new THREE.Matrix3()) },
    uFormAnim: { value: Array.from({ length: NF }, () => new THREE.Vector4()) },
    uFormDrag: { value: Array.from({ length: NF }, () => new THREE.Vector4()) },
    uSkyForms: { value: new THREE.Vector4(1, 0, 0, 0) },
  };
  const bodyMat = new THREE.ShaderMaterial({
    name: 'life-skyforms-body',
    uniforms: { ...ctx.fogUniforms(), ...shared, ...formU },
    vertexShader: BODY_VS,
    fragmentShader: BODY_FS,
    fog: true,
    transparent: true,
    premultipliedAlpha: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const lineMat = new THREE.ShaderMaterial({
    name: 'life-skyforms-lines',
    uniforms: { ...ctx.fogUniforms(), ...shared, ...formU },
    vertexShader: LINE_VS,
    fragmentShader: LINE_FS,
    fog: true,
    transparent: true,
    premultipliedAlpha: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const group = new THREE.Group();
  group.name = 'life-skyforms';
  const bodyMesh = new THREE.Mesh(bodyGeo, bodyMat);
  bodyMesh.name = 'life-skyforms-body';
  bodyMesh.frustumCulled = false;
  bodyMesh.renderOrder = 4;
  const lineMesh = new THREE.Mesh(lineGeo, lineMat);
  lineMesh.name = 'life-skyforms-lines';
  lineMesh.frustumCulled = false;
  lineMesh.renderOrder = 5;
  group.add(bodyMesh, lineMesh);

  // ------------------------------------------------------------------ per-frame placement
  const m4 = new THREE.Matrix4();
  const e = new THREE.Euler();

  function place(elapsed) {
    for (let i = 0; i < forms.length; i++) {
      const f = forms[i];
      const w = TAU / f.period;
      const ph = elapsed * w + f.phase;
      const x = f.at[0] + f.orbit[0] * Math.cos(ph);
      const z = f.at[2] + f.orbit[1] * Math.sin(ph);
      const y = f.at[1] + 28 * Math.sin(elapsed * 0.011 + f.phase * 3.1) + 10 * Math.sin(elapsed * 0.037 + f.phase);
      formU.uFormPos.value[i].set(x, y, z, f.scale);
      // drift velocity (analytic) -> the threads trail behind it
      const vx = -f.orbit[0] * w * Math.sin(ph);
      const vz = f.orbit[1] * w * Math.cos(ph);
      const vy = 28 * 0.011 * Math.cos(elapsed * 0.011 + f.phase * 3.1);
      formU.uFormDrag.value[i].set(-vx * 2.2, -vy, -vz * 2.2, 0);
      const yaw = elapsed * TAU * f.spin + f.phase * 2.0;
      e.set(0.05 * Math.sin(elapsed * 0.071 + f.phase), yaw, 0.045 * Math.sin(elapsed * 0.053 + f.phase * 2.0), 'YXZ');
      m4.makeRotationFromEuler(e);
      formU.uFormRot.value[i].setFromMatrix4(m4);
      const breath = elapsed * (TAU / (26 + 6 * i)) + f.phase * 5.0;
      formU.uFormAnim.value[i].set(breath, breath - 1.1, 0, 0);
    }
  }
  place(0);

  return {
    mesh: group,
    triangles: (body.I.length + lines.I.length) / 3,
    update(dt, elapsed) {
      place(elapsed);
      const env = ctx.env;
      const S = formU.uSkyForms.value;
      // day: faint ghosts; dusk: the low sun lights the membranes; night: dark shapes that
      // eclipse the stars, veins and threads glowing faintly
      S.x = 0.5 + 0.35 * env.twilight - 0.05 * env.night;
      S.y = THREE.MathUtils.smoothstep(env.night, 0.3, 0.9);
    },
  };
}
