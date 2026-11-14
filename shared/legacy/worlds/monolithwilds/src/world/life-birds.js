// Birds: every bird in the basin is one instance of a tiny low-poly mesh, and its whole life —
// flight path, heading, banking, wingbeat, glides — is evaluated in the vertex shader from time
// and a handful of per-instance numbers. One draw call, zero per-frame CPU work.
//
// Two flight systems:
//   kettle  soaring birds riding a thermal: each circles a slowly drifting centre on its own
//           radius / height, spiralling up and down (around the Loom, the Needles, the Wardens…)
//   tour    a flock whose centre follows a closed Lissajous loop (ellipse or figure-8, chosen so
//           it never stops); each bird holds an offset in the flock's heading frame (a V of
//           cranes, a loose cloud of starlings) that breathes and wobbles.
// Heading = central difference of the bird's own path; bank = lift tilted toward the centripetal
// acceleration (exaggerated so turns read on screen). Far birds are enlarged to a minimum pixel
// span so they stay readable specks against the sky instead of aliasing away.

import * as THREE from 'crownfall-world-three';
import { LIFE_VERT_UNIFORMS, LIFE_FRAG_UNIFORMS } from './life-common.js';

const TAU = Math.PI * 2;

// ---------------------------------------------------------------------------------------------
// Flock plan. Altitudes are absolute (m). Landmark data: loom ring centre ≈ (350, ~395, -1750),
// plane normal (-0.435, 0, 0.9); Needles to ~900 m; Wardens ≤ 220 m; stair door ≈ 700 m.
// ---------------------------------------------------------------------------------------------
const SOARER = { span: [2.6, 3.4], flap: 1.25, duty: 0.14, albedo: 0.045, chord: 1.0, tail: 1.0, night: 1.3 };
const RAPTOR = { span: [1.8, 2.3], flap: 1.6, duty: 0.2, albedo: 0.06, chord: 0.9, tail: 1.1, night: 1.3 };
const CRANE = { span: [2.0, 2.3], neck: 0.62, flap: 1.35, duty: 0.93, albedo: 0.1, chord: 0.8, tail: 0.55, night: 1.0 };
const STARLING = { span: [0.38, 0.46], flap: 3.1, duty: 0.72, albedo: 0.035, chord: 0.8, tail: 0.8, night: 1.05 };
const SWIFT = { span: [0.42, 0.5], flap: 4.2, duty: 0.5, albedo: 0.03, chord: 0.55, tail: 0.55, night: 1.1 };
const GULL = { span: [1.25, 1.45], flap: 2.0, duty: 0.3, albedo: 0.55, chord: 0.7, tail: 0.7, night: 1.1 };
const JACKDAW = { span: [0.65, 0.75], flap: 2.6, duty: 0.8, albedo: 0.035, chord: 0.9, tail: 0.9, night: 1.1 };

const FLOCKS = [
  // --- the Loom of Hours: a thermal in front of the ring, a high wheel over its crown, a murmuration
  { id: 'loom-kettle', kind: 'kettle', at: [250, 470, -1543], n: 12, r: [50, 130], speed: [10.5, 13], alt: [-60, 90], altAmp: 25, drift: 40, driftFreq: 0.004, dir: 1, tilt: 0.1, ...SOARER },
  { id: 'loom-crown', kind: 'kettle', at: [350, 790, -1750], n: 9, r: [130, 260], speed: [12, 14], alt: [-20, 80], altAmp: 20, drift: 60, driftFreq: 0.003, dir: -1, tilt: 0.06, ...SOARER },
  { id: 'loom-murmur', kind: 'tour', at: [330, 330, -1350], n: 70, amp: [320, 40, 120], freq: [0.021, 0.033, 0.042], phase: [0, 1, 0], spread: [42, 16, 30], cloud: true, wobble: 3.5, breathe: 0.3, ...STARLING, quality: 0.5 },
  // --- the Needle City: a wheel above the spires, a ring around the plateau edge
  { id: 'needles-high', kind: 'kettle', at: [1350, 1010, -1150], n: 10, r: [200, 380], speed: [12, 14], alt: [-40, 80], altAmp: 30, drift: 60, driftFreq: 0.0025, dir: 1, tilt: 0.05, ...SOARER },
  { id: 'needles-ring', kind: 'kettle', at: [1350, 560, -1150], n: 7, r: [540, 610], speed: [11, 13], alt: [-40, 60], altAmp: 20, drift: 20, driftFreq: 0.002, dir: -1, tilt: 0.03, ...RAPTOR },
  // --- the Kneeling Wardens: birds wheeling over the bowed heads
  { id: 'wardens-kettle', kind: 'kettle', at: [-250, 300, -870], n: 11, r: [90, 230], speed: [10, 12.5], alt: [-30, 60], altAmp: 18, drift: 50, driftFreq: 0.004, dir: 1, tilt: 0.08, ...SOARER },
  // --- the lake: two V-skeins of cranes, pale gulls skimming the water, a dusk murmuration
  { id: 'lake-cranes', kind: 'tour', at: [250, 62, -40], n: 11, amp: [500, 10, 360], freq: [0.0165, 0.05, 0.0165], phase: [0, 0, Math.PI / 2], vee: [3.3, 2.7, 0.18], wobble: 0.5, breathe: 0.04, ...CRANE },
  { id: 'lake-cranes-2', kind: 'tour', at: [60, 84, -200], n: 7, amp: [420, 8, 260], freq: [0.019, 0.043, 0.019], phase: [Math.PI, 0, Math.PI / 2], vee: [3.1, 2.6, 0.15], wobble: 0.4, breathe: 0.05, ...CRANE },
  { id: 'lake-gulls', kind: 'tour', at: [150, 16, 520], n: 6, amp: [300, 5, 110], freq: [0.028, 0.09, 0.056], phase: [0, 0, 0], spread: [70, 4, 45], wobble: 7, breathe: 0.2, ...GULL },
  { id: 'lake-murmur', kind: 'tour', at: [520, 125, -120], n: 110, amp: [260, 35, 180], freq: [0.024, 0.031, 0.024], phase: [0, 2, Math.PI / 2], spread: [55, 22, 40], cloud: true, wobble: 4, breathe: 0.35, ...STARLING, quality: 0.5 },
  // --- swifts combing the face of the Honeycomb Cloister
  { id: 'cloister-swifts', kind: 'tour', at: [-1250, 250, -1180], n: 28, amp: [330, 70, 25], freq: [0.03, 0.071, 0.09], phase: [0, 1, 0.5], spread: [40, 30, 18], cloud: true, wobble: 9, breathe: 0.3, ...SWIFT, quality: 0.6 },
  // --- solitary wheels over the other places
  { id: 'isles-kettle', kind: 'kettle', at: [1350, 640, 1650], n: 7, r: [150, 350], speed: [11, 13], alt: [-30, 60], altAmp: 25, drift: 60, driftFreq: 0.003, dir: 1, tilt: 0.06, ...SOARER },
  { id: 'stair-door', kind: 'kettle', at: [-420, 760, 300], n: 2, r: [45, 70], speed: [9, 10.5], alt: [-10, 20], altAmp: 12, drift: 10, driftFreq: 0.01, dir: -1, tilt: 0.12, ...RAPTOR },
  { id: 'temple-kettle', kind: 'kettle', at: [-450, 580, 1650], n: 6, r: [120, 220], speed: [11, 13], alt: [-30, 50], altAmp: 20, drift: 40, driftFreq: 0.004, dir: 1, tilt: 0.07, ...SOARER },
  { id: 'span-kettle', kind: 'kettle', at: [1720, 255, -60], n: 5, r: [80, 170], speed: [10, 12], alt: [-20, 40], altAmp: 15, drift: 30, driftFreq: 0.005, dir: -1, tilt: 0.08, ...RAPTOR },
  { id: 'choir-daws', kind: 'tour', at: [-1750, 200, -150], n: 24, amp: [480, 15, 300], freq: [0.02, 0.05, 0.04], phase: [0, 0, 0], spread: [35, 10, 25], cloud: true, wobble: 4, breathe: 0.25, ...JACKDAW, quality: 0.6 },
  { id: 'spawn-kettle', kind: 'kettle', at: [-700, 270, 600], n: 5, r: [60, 120], speed: [10, 12], alt: [-20, 40], altAmp: 15, drift: 30, driftFreq: 0.005, dir: 1, tilt: 0.1, ...RAPTOR },
  { id: 'orrery-kettle', kind: 'kettle', at: [-1800, 580, 1150], n: 6, r: [250, 400], speed: [12, 14], alt: [-20, 50], altAmp: 20, drift: 40, driftFreq: 0.003, dir: -1, tilt: 0.05, ...SOARER },
];

// ---------------------------------------------------------------------------------------------
// Geometry: one bird, unit wingspan, x = right, y = up, z = forward (beak +z).
// aPart: 0 body, 1 wing (bent at root and elbow in the shader), 3 tail, 4 neck/head (z = 0..1
// fraction of neck length), 5 legs (z = 0..1 fraction of leg length).
// ---------------------------------------------------------------------------------------------
function birdGeometry() {
  const P = [];
  const part = [];
  const idx = [];
  const v = (x, y, z, p) => {
    P.push(x, y, z);
    part.push(p);
    return part.length - 1;
  };
  const tri = (a, b, c) => idx.push(a, b, c);
  const quad = (a, b, c, d) => {
    tri(a, b, c);
    tri(a, c, d);
  };
  // body: nose, two diamond rings, tail root
  const nose = v(0, 0.006, 0.2, 0);
  const A = [v(0.036, 0, 0.07, 0), v(0, 0.032, 0.07, 0), v(-0.036, 0, 0.07, 0), v(0, -0.034, 0.07, 0)];
  const B = [v(0.022, 0.002, -0.11, 0), v(0, 0.022, -0.11, 0), v(-0.022, 0.002, -0.11, 0), v(0, -0.02, -0.11, 0)];
  const tailRoot = v(0, 0.002, -0.16, 0);
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    tri(nose, A[j], A[i]);
    quad(A[i], A[j], B[j], B[i]);
    tri(B[i], B[j], tailRoot);
  }
  // wings (mirrored). Root at |x| = 0.03, elbow at 0.23, fingered tip swept back.
  for (const s of [1, -1]) {
    const rL = v(0.03 * s, 0.008, 0.075, 1);
    const rT = v(0.03 * s, 0.004, -0.085, 1);
    const eL = v(0.23 * s, 0.004, 0.07, 1);
    const eT = v(0.23 * s, 0, -0.1, 1);
    const tL = v(0.46 * s, 0, 0.005, 1);
    const tT = v(0.44 * s, 0, -0.075, 1);
    const f1 = v(0.5 * s, 0, -0.02, 1);
    const f2 = v(0.485 * s, 0, -0.06, 1);
    quad(rL, eL, eT, rT);
    quad(eL, tL, tT, eT);
    tri(tL, f1, f2);
    tri(tL, f2, tT);
  }
  // tail fan
  const t0 = v(0, 0.003, -0.13, 3);
  const t1 = v(0.06, 0, -0.26, 3);
  const t2 = v(0, 0.001, -0.235, 3);
  const t3 = v(-0.06, 0, -0.26, 3);
  quad(t0, t1, t2, t3);
  // neck + head (collapses into the nose when neck = 0)
  const n0 = [v(0.012, 0.004, 0, 4), v(0, 0.02, 0, 4), v(-0.012, 0.004, 0, 4)];
  const n1 = [v(0.008, 0.012, 1, 4), v(0, 0.026, 1, 4), v(-0.008, 0.012, 1, 4)];
  for (let i = 0; i < 3; i++) quad(n0[i], n0[(i + 1) % 3], n1[(i + 1) % 3], n1[i]);
  const beak = v(0, 0.012, 1.28, 4);
  for (let i = 0; i < 3; i++) tri(n1[i], n1[(i + 1) % 3], beak);
  // trailing legs (cranes)
  const l0 = v(0.008, -0.02, 0, 5);
  const l1 = v(-0.008, -0.02, 0, 5);
  const l2 = v(-0.004, -0.014, 1, 5);
  const l3 = v(0.004, -0.014, 1, 5);
  quad(l0, l1, l2, l3);

  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('aPart', new THREE.Float32BufferAttribute(part, 1));
  g.setIndex(idx);
  return g;
}

// ---------------------------------------------------------------------------------------------
// Shaders
// ---------------------------------------------------------------------------------------------
const BIRD_VS = /* glsl */ `
${LIFE_VERT_UNIFORMS}
uniform float uMinPx;
attribute float aPart;
attribute vec4 aA; // xyz anchor, w kind (0 kettle, 1 tour)
attribute vec4 aB; // kettle: driftAmp, altAmp, radius, speed   | tour: Ax, Ay, Az, wobble
attribute vec4 aC; // kettle: driftFreq, theta0, dir, radiusVar | tour: fx, fy, fz, breathe
attribute vec4 aD; // kettle: driftPhase, altOffset, tilt, seed | tour: px, py, pz, seed
attribute vec4 aE; // tour: formation offset xyz (right, up, forward)
attribute vec4 aF; // span, neck, flap rate (Hz), flap duty
attribute vec4 aG; // albedo, chord, tail, night-roost factor
varying vec3 vWorld;
varying float vAlb;
varying float vWing;
#include <fog_pars_vertex>

vec3 birdPos(float t) {
  float seed = aD.w;
  if (aA.w < 0.5) {
    vec3 c = aA.xyz + aB.x * vec3(sin(t * aC.x + aD.x), 0.0, cos(t * aC.x * 0.83 + aD.x * 1.7));
    float r = aB.z * (1.0 + aC.w * sin(t * 0.021 + seed * 9.7));
    float th = aC.z * t * aB.w / aB.z + aC.y;
    float h = aD.y + aB.y * sin(t * 0.013 + seed * 5.3) + aD.z * r * sin(th + seed * 3.0);
    return c + vec3(r * cos(th), h, r * sin(th));
  }
  vec3 ph = t * aC.xyz + aD.xyz;
  vec3 c = aA.xyz + aB.xyz * sin(ph);
  vec3 v = aB.xyz * aC.xyz * cos(ph);
  vec3 f = normalize(vec3(v.x, v.y * 0.3, v.z) + vec3(1e-5, 0.0, 0.0));
  vec3 r = normalize(cross(vec3(0.0, 1.0, 0.0), f));
  vec3 u = cross(f, r);
  float br = 1.0 + aC.w * sin(t * 0.37 + seed * 6.2831);
  vec3 o = aE.xyz * br + aB.w * vec3(sin(t * 0.71 + seed * 17.0), 0.6 * sin(t * 0.53 + seed * 29.0), sin(t * 0.61 + seed * 11.0));
  return c + r * o.x + u * o.y + f * o.z;
}

void main() {
  float t = uLifeTime.x;
  float seed = aD.w;
  vec3 p0 = birdPos(t - 0.5);
  vec3 p1 = birdPos(t);
  vec3 p2 = birdPos(t + 0.5);
  vec3 vel = p2 - p0;
  vec3 fwd = normalize(vel + vec3(0.0, 0.0, 1e-5));
  vec3 acc = (p2 - 2.0 * p1 + p0) * 4.0;
  vec3 lat = acc - dot(acc, fwd) * fwd;
  vec3 upv = normalize(vec3(0.0, 9.81, 0.0) + lat * 2.6);
  vec3 right = normalize(cross(upv, fwd));
  upv = cross(fwd, right);

  // wingbeat: bursts of flapping between glides; climbing makes them flap
  float climb = clamp(fwd.y * 5.0, 0.0, 1.0);
  float duty = aF.w;
  float sw = 0.5 + 0.5 * sin(t * (0.07 + 0.05 * seed) + seed * 40.0);
  float flapping = max(smoothstep(1.0 - duty - 0.12, 1.0 - duty + 0.12, sw), climb);
  float ph = t * aF.z * 6.2831 + seed * 60.0;
  float a1 = mix(0.1, 0.12 + 0.62 * sin(ph), flapping);
  float a2 = mix(-0.06, 0.1 + 0.5 * sin(ph - 1.1), flapping);

  vec3 p = position;
  float wing = step(0.5, aPart) * step(aPart, 1.5);
  if (wing > 0.5) {
    float s = sign(p.x);
    float ax = abs(p.x);
    float rin = min(ax, 0.23) - 0.03;
    float rout = max(ax - 0.23, 0.0);
    p.z *= aG.y;
    p.x = s * (0.03 + rin * cos(a1) + rout * cos(a1 + a2));
    p.y += rin * sin(a1) + rout * sin(a1 + a2);
  }
  if (aPart > 2.5 && aPart < 3.5) p.z = -0.13 + (p.z + 0.13) * aG.z;
  if (aPart > 3.5 && aPart < 4.5) p.z = 0.17 + p.z * aF.y;
  if (aPart > 4.5) p.z = -0.12 - p.z * aF.y * 0.85;

  // enlarge far birds to a minimum on-screen span; roost at night
  float dist = length(p1 - cameraPosition);
  float px = aF.x * uProj / max(dist, 1.0);
  float enl = clamp(uMinPx / px, 1.0, 7.0);
  float vis = smoothstep(seed - 0.06, seed + 0.06, 1.0 - uLifeEnv.x * aG.w);
  p *= aF.x * enl * vis;

  vec3 wp = p1 + right * p.x + upv * p.y + fwd * p.z;
  vWorld = wp;
  vAlb = aG.x;
  vWing = wing;
  vec4 mvPosition = viewMatrix * vec4(wp, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const BIRD_FS = /* glsl */ `
${LIFE_FRAG_UNIFORMS}
varying vec3 vWorld;
varying float vAlb;
varying float vWing;
#include <fog_pars_fragment>
void main() {
  vec3 n = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
  vec3 V = normalize(vWorld - cameraPosition);
  if (dot(n, V) > 0.0) n = -n;
  float ndl = max(dot(n, uKeyDir), 0.0);
  vec3 col = vAlb * (uSkyLight * (0.55 + 0.45 * n.y) + uSunLight * ndl);
  // low sun shining through the flight feathers when the bird crosses it
  float back = pow(max(dot(V, uKeyDir), 0.0), 8.0);
  col += (0.04 + vAlb * 0.5) * uSunLight * back * vWing;
  gl_FragColor = vec4(col, 1.0);
  #include <fog_fragment>
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

// ---------------------------------------------------------------------------------------------
// CPU mirror of the flock centre paths (build-time validation only).
// ---------------------------------------------------------------------------------------------
function tourCentre(f, t, out) {
  out[0] = f.at[0] + f.amp[0] * Math.sin(t * f.freq[0] + f.phase[0]);
  out[1] = f.at[1] + f.amp[1] * Math.sin(t * f.freq[1] + f.phase[1]);
  out[2] = f.at[2] + f.amp[2] * Math.sin(t * f.freq[2] + f.phase[2]);
  return out;
}

/** Lowest clearance (m) of a flock above the ground along its path; lifts the flock if needed. */
function validateFlock(ctx, f) {
  const c = [0, 0, 0];
  let minClear = Infinity;
  if (f.kind === 'tour') {
    const period = TAU / Math.min(f.freq[0], f.freq[2]);
    const lowY = -f.spread?.[1] - (f.wobble ?? 0) - 6 || -8;
    for (let i = 0; i < 160; i++) {
      tourCentre(f, (i / 160) * period * 2, c);
      const reach = f.vee ? (f.n / 2) * f.vee[0] : f.spread[0];
      let g = ctx.surfaceAt(c[0], c[2]);
      g = Math.max(g, ctx.surfaceAt(c[0] + reach, c[2]), ctx.surfaceAt(c[0] - reach, c[2]));
      g = Math.max(g, ctx.surfaceAt(c[0], c[2] + reach), ctx.surfaceAt(c[0], c[2] - reach));
      minClear = Math.min(minClear, c[1] + lowY - g);
    }
  } else {
    const R = f.r[1] * 1.2 + f.drift;
    const lowY = f.at[1] + f.alt[0] - f.altAmp - f.tilt * R;
    for (let i = 0; i < 49; i++) {
      const a = i * 2.399963;
      const d = R * Math.sqrt((i + 0.5) / 49);
      const g = ctx.surfaceAt(f.at[0] + Math.cos(a) * d, f.at[2] + Math.sin(a) * d);
      minClear = Math.min(minClear, lowY - g);
    }
  }
  const need = f.kind === 'tour' && f.id.includes('gull') ? 4 : 18;
  if (minClear < need) {
    const lift = need - minClear;
    f.at = [f.at[0], f.at[1] + lift, f.at[2]];
    if (ctx.params.debug) console.warn(`[life] flock ${f.id} lifted ${lift.toFixed(0)} m (clearance ${minClear.toFixed(0)})`);
  }
  return minClear;
}

// ---------------------------------------------------------------------------------------------

export function buildBirds(ctx, shared) {
  const rng = ctx.noise.createRng('life-birds');
  const lowQ = ctx.quality.level === 'low';

  const birds = [];
  for (const f0 of FLOCKS) {
    const f = { ...f0 };
    validateFlock(ctx, f);
    const n = Math.max(1, Math.round(f.n * (lowQ && f.quality ? f.quality : 1)));
    const flockSeed = rng();
    for (let i = 0; i < n; i++) {
      const seed = rng();
      const span = rng.range(f.span[0], f.span[1]);
      const b = {
        A: [f.at[0], f.at[1], f.at[2], f.kind === 'kettle' ? 0 : 1],
        B: [0, 0, 0, 0],
        C: [0, 0, 0, 0],
        D: [0, 0, 0, seed],
        E: [0, 0, 0, 0],
        F: [span, f.neck ?? 0, f.flap * rng.range(0.9, 1.1), f.duty],
        G: [f.albedo * rng.range(0.85, 1.15), f.chord, f.tail, f.night],
      };
      if (f.kind === 'kettle') {
        const r = rng.range(f.r[0], f.r[1]);
        b.B = [f.drift, f.altAmp, r, rng.range(f.speed[0], f.speed[1])];
        b.C = [f.driftFreq, rng.range(0, TAU), f.dir, rng.range(0.08, 0.2)];
        // one shared drift phase per kettle so the thermal drifts as a whole
        b.D = [flockSeed * TAU, rng.range(f.alt[0], f.alt[1]), f.tilt * rng.range(0.5, 1.2), seed];
      } else {
        b.B = [f.amp[0], f.amp[1], f.amp[2], f.wobble];
        b.C = [f.freq[0], f.freq[1], f.freq[2], f.breathe];
        b.D = [f.phase[0], f.phase[1], f.phase[2], seed];
        if (f.vee) {
          // lead bird, then alternating arms trailing back
          const k = Math.ceil(i / 2);
          const side = i === 0 ? 0 : i % 2 ? 1 : -1;
          b.E = [side * k * f.vee[0] + rng.range(-0.4, 0.4), -k * f.vee[2] + rng.range(-0.3, 0.3), -k * f.vee[1] + rng.range(-0.4, 0.4), 0];
        } else {
          // cloud: denser core, ragged edge
          const u = rng.gauss() * 0.5;
          const w = rng.gauss() * 0.5;
          const q = rng.gauss() * 0.5;
          b.E = [u * f.spread[0], w * f.spread[1], q * f.spread[2], 0];
        }
      }
      birds.push(b);
    }
  }

  const geo = birdGeometry();
  const N = birds.length;
  const mk = (key) => {
    const arr = new Float32Array(N * 4);
    birds.forEach((b, i) => arr.set(b[key], i * 4));
    return new THREE.InstancedBufferAttribute(arr, 4);
  };
  for (const k of ['A', 'B', 'C', 'D', 'E', 'F', 'G']) geo.setAttribute(`a${k}`, mk(k));
  geo.instanceCount = N;

  const material = new THREE.ShaderMaterial({
    name: 'life-birds',
    uniforms: { ...ctx.fogUniforms(), ...shared, uMinPx: { value: 2.6 } },
    vertexShader: BIRD_VS,
    fragmentShader: BIRD_FS,
    fog: true,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, material);
  mesh.name = 'life-birds';
  mesh.frustumCulled = false; // positions live in the shader
  mesh.renderOrder = 1;
  return { mesh, count: N, triangles: (geo.index.count / 3) * N };
}
