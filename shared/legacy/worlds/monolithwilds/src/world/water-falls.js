// Landscape waterfalls (the landmarks own theirs): two 400 m falls off the northern escarpment, a
// fall into the head of the canyon, and one off the south-west rim of the Needle City plateau.
//
// Construction
//   lip      found from the terrain (the first point where the ground starts to drop toward the
//            chosen direction); a short feeder stream on the top leads to it.
//   path     a water parcel launched over the lip is integrated under gravity; where it meets rock
//            it slides along the surface (so tiered walls give tiered cascades), until it reaches
//            the pool / river / ground below. Every sample stores its fall time and speed.
//   ribbons  a main sheet with a slightly bulged cross-section (reads from the side), two thin
//            side strands and a wide, faint spray veil. Every vertex is pushed clear of the cliff.
//   shader   streak noise scrolled with the *fall time* coordinate, so the pattern moves at the
//            real (accelerating) speed and stretches as it falls; coherent at the lip, fraying into
//            horsetail streaks, dissolving into spray; lit by the key light (sun or moon) with a
//            per-vertex heightfield shadow (a short march through the world height texture in the
//            vertex shader: live through a time-lapse, no CPU work), a forward-scattering glow when
//            backlit, and HDR glints.
//   mist     one instanced draw of billboards that billow, rise and fade at every base.

import * as THREE from 'crownfall-world-three';

const G = 9.81;

// ---------------------------------------------------------------------------------------------
// sites
// ---------------------------------------------------------------------------------------------

/** Escarpment lip at x: walk from the high ground toward the cliff line until the ground drops. */
function escarpmentLip(ctx, x) {
  const cz = ctx.cliffLineZ(x);
  const dcz = (ctx.cliffLineZ(x + 5) - ctx.cliffLineZ(x - 5)) / 10;
  let nx = -dcz;
  let nz = 1;
  const l = Math.hypot(nx, nz);
  nx /= l;
  nz /= l;
  let px = x - nx * 90;
  let pz = cz - nz * 90;
  let top = ctx.heightAt(px, pz);
  for (let s = -90; s < 60; s += 1) {
    const qx = x + nx * s;
    const qz = cz + nz * s;
    const h = ctx.heightAt(qx, qz);
    if (h < top - 1.5) return { x: px, z: pz, y: top, dx: nx, dz: nz };
    top = Math.max(h, top - 0.2);
    px = qx;
    pz = qz;
  }
  return { x: px, z: pz, y: top, dx: nx, dz: nz };
}

/** Lip on a rim: march from (fx, fz) toward dir until the ground falls away (> 28 m within 25 m). */
function rimLip(ctx, fx, fz, dx, dz, maxDist = 700) {
  for (let s = 0; s < maxDist; s += 2) {
    const x = fx + dx * s;
    const z = fz + dz * s;
    const h = ctx.heightAt(x, z);
    if (h - ctx.heightAt(x + dx * 25, z + dz * 25) > 28) {
      // step back to the last point that is still level with the top
      let b = s;
      while (b > 0 && ctx.heightAt(fx + dx * b, fz + dz * b) < h - 1.0) b -= 1;
      return { x: fx + dx * b, z: fz + dz * b, y: ctx.heightAt(fx + dx * b, fz + dz * b), dx, dz };
    }
  }
  return null;
}

function findSites(ctx) {
  const L = ctx.layout;
  const sites = [];
  // 1-2. escarpment: ~400 m free fall onto the apron at its foot
  for (const [id, x, w, v0] of [
    ['escarpment-west', -2050, 30, 4.6],
    ['escarpment-east', -800, 27, 4.0],
  ]) {
    const lip = escarpmentLip(ctx, x);
    sites.push({ id, lip, width: w, v0, stop: 'ground', spread: 2.1, feeder: 260, mist: 1.0, seed: sites.length });
  }
  // 3. the head of the canyon: off the east rim into the river
  {
    const [ax, az] = L.CANYON[0];
    const [bx, bz] = L.CANYON[1];
    const tl = Math.hypot(bx - ax, bz - az);
    const tx = (bx - ax) / tl;
    const tz = (bz - az) / tl;
    const ex = tz; // east-side normal of the canyon axis
    const ez = -tx;
    const along = 80;
    const cx = bx + tx * along + ex * 330;
    const cz = bz + tz * along + ez * 330;
    const lip = rimLip(ctx, cx, cz, -ex, -ez);
    if (lip) sites.push({ id: 'canyon-head', lip, width: 28, v0: 3.8, stop: 'water', spread: 1.5, feeder: 220, mist: 0.8, seed: 2 });
  }
  // 4. the Needle City plateau: south-west rim, facing the evening sun and the spawn ridge
  {
    const s = L.LANDMARK_BY_ID.needles;
    const a = 2.4;
    const dx = Math.cos(a);
    const dz = Math.sin(a);
    const lip = rimLip(ctx, s.x + dx * 380, s.z + dz * 380, dx, dz, 300);
    if (lip) sites.push({ id: 'needle-rim', lip, width: 20, v0: 3.4, stop: 'ground', spread: 1.3, feeder: 60, mist: 0.6, seed: 3 });
  }
  return sites;
}

// ---------------------------------------------------------------------------------------------
// path integration
// ---------------------------------------------------------------------------------------------

function tracePath(ctx, site, v0, clearance = 2.5) {
  const { lip } = site;
  const p = new THREE.Vector3(lip.x, lip.y + 0.6, lip.z);
  const v = new THREE.Vector3(lip.dx * v0, 0, lip.dz * v0);
  const n = { x: 0, y: 1, z: 0 };
  const pts = [];
  let t = 0;
  let s = 0;
  let lastS = -1e9;
  let airborne = false;
  let fell = 0;
  const dt = 0.04;
  const prev = new THREE.Vector3();
  for (let i = 0; i < 6000; i++) {
    prev.copy(p);
    v.y -= G * dt;
    p.addScaledVector(v, dt);
    t += dt;
    const g = ctx.heightAt(p.x, p.z);
    let contact = false;
    if (p.y < g + clearance) {
      contact = true;
      p.y = g + clearance;
      ctx.normalAt(p.x, p.z, n);
      const vn = v.x * n.x + v.y * n.y + v.z * n.z;
      if (vn < 0) {
        v.x -= n.x * vn;
        v.y -= n.y * vn;
        v.z -= n.z * vn;
      }
      v.multiplyScalar(0.975);
      // water keeps heading over the edge
      v.x += lip.dx * 0.25;
      v.z += lip.dz * 0.25;
    } else if (p.y > g + clearance + 6) {
      airborne = true;
    }
    s += p.distanceTo(prev);
    const speed = v.length();
    // sample every ~3.5 m (finer while slow at the lip)
    if (s - lastS > Math.min(6, 2 + speed * 0.06)) {
      pts.push({ p: p.clone(), t, speed, contact });
      lastS = s;
    }
    fell = lip.y - p.y;
    if (site.stop === 'water' && p.y < 0.5) break;
    // landed: we were falling (or cascading) and have come to rest on gentle ground
    if (site.stop === 'ground' && contact && fell > 30 && airborne) {
      // a ledge is not the foot: only stop when the ground ahead does not keep falling away
      const slope = 1 - n.y;
      const ahead = ctx.heightAt(p.x + lip.dx * 35, p.z + lip.dz * 35);
      if (slope < 0.25 && ahead > p.y - 12) break;
    }
    if (fell > 30 && contact && Math.hypot(v.x, v.z) < 1.5 && Math.abs(v.y) < 1) break;
  }
  pts.push({ p: p.clone(), t, speed: v.length(), contact: true });
  return { pts, drop: fell, time: t };
}

// ---------------------------------------------------------------------------------------------
// ribbon geometry
// ---------------------------------------------------------------------------------------------

const _t = new THREE.Vector3();
const _a = new THREE.Vector3();
const _o = new THREE.Vector3();
const _q = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

/**
 * Build one ribbon strand along the path into the arrays.
 * opts: width0, spread (width growth to the bottom), offset (lateral m), bulge (m), start/end
 * progress window, alpha, seed, veil (0/1), across (vertices across).
 */
function addStrand(ctx, out, path, dir, opts) {
  const pts = path.pts;
  const n = pts.length;
  const M = opts.across ?? 11;
  const across = new THREE.Vector3(dir.z, 0, -dir.x).normalize();
  const tTotal = pts[n - 1].t;
  const base = out.pos.length / 3;
  let rows = 0;
  let first = -1;
  for (let i = 0; i < n; i++) {
    const prog = i / (n - 1);
    if (prog < opts.start || prog > opts.end) continue;
    if (first < 0) first = i;
    const a = pts[Math.max(0, i - 1)].p;
    const b = pts[Math.min(n - 1, i + 1)].p;
    _t.subVectors(b, a).normalize();
    _o.crossVectors(across, _t).normalize();
    if (_o.x * dir.x + _o.z * dir.z < 0) _o.negate();
    const pk = pts[i];
    const w = opts.width0 * (1 + opts.spread * Math.pow(prog, 1.15));
    const lat = opts.offset * (1 + 0.6 * prog);
    for (let k = 0; k < M; k++) {
      const u = (k / (M - 1)) * 2 - 1;
      _q.copy(pk.p)
        .addScaledVector(across, lat + (u * w) / 2)
        .addScaledVector(_o, opts.bulge * (1 - u * u) * (0.4 + prog) + opts.push * prog);
      // keep clear of the rock: push out along the sheet normal until the ground is below
      for (let it = 0; it < 14; it++) {
        const g = ctx.heightAt(_q.x, _q.z);
        if (_q.y > g + 1.8) break;
        _q.addScaledVector(_o, 2.2);
        if (pk.contact) _q.y = Math.max(_q.y, g + 1.2);
      }
      out.pos.push(_q.x, _q.y, _q.z);
      out.nrm.push(_o.x, _o.y, _o.z);
      out.uv.push(u, (u * w) / 2 + lat);
      out.fall.push(pk.t, prog, pk.speed, opts.seed);
      out.strand.push(opts.alpha, opts.veil, pk.contact ? 1 : 0, tTotal);
    }
    rows++;
  }
  for (let r = 0; r < rows - 1; r++) {
    for (let k = 0; k < M - 1; k++) {
      const i0 = base + r * M + k;
      const i1 = i0 + M;
      out.idx.push(i0, i1, i0 + 1, i0 + 1, i1, i1 + 1);
    }
  }
  return { first, rows, M, base };
}

// ---------------------------------------------------------------------------------------------
// shaders
// ---------------------------------------------------------------------------------------------

// key-light visibility of a point above the ground: an exponential march toward the light through
// the world height texture with a soft penumbra (starts clear of the cliff the water hugs)
const LIGHT_MARCH = /* glsl */ `
uniform sampler2D uHeight;
uniform vec4 uHeightXf;
uniform vec3 uKeyDir;
float wfHeight(vec2 xz) {
  return textureLod(uHeight, (xz - uHeightXf.xy) * uHeightXf.zw, 0.0).r;
}
float wfLightVis(vec3 p) {
  float t = 9.0;
  float vis = 1.0;
  for (int i = 0; i < 22; i++) {
    vec3 q = p + uKeyDir * t;
    if (q.y > 2600.0) break;
    vis = min(vis, clamp((q.y - wfHeight(q.xz)) / (0.06 * t + 2.0) + 0.5, 0.0, 1.0));
    if (vis <= 0.0) break;
    t *= 1.33;
  }
  return vis;
}
`;

const FALL_VS = /* glsl */ `
attribute vec4 aFall;    // x fall time (s), y progress 0..1, z speed (m/s), w seed
attribute vec4 aStrand;  // x alpha, y veil, z on-rock, w total fall time
${LIGHT_MARCH}
varying vec2 vUv;
varying vec4 vFall;
varying vec4 vStrand;
varying float vVis;
varying vec3 vN;
varying vec3 vWP;
#include <fog_pars_vertex>
void main() {
  vUv = uv;
  vFall = aFall;
  vStrand = aStrand;
  vN = normal;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWP = wp.xyz;
  vVis = wfLightVis(wp.xyz + normal * 3.0);
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const FALL_FS = /* glsl */ `
uniform float uTime;
uniform sampler2D uNoise;
uniform vec3 uKeyCol;
uniform vec3 uKeyDir;
uniform vec3 uAmb;
uniform float uNight;
varying vec2 vUv;
varying vec4 vFall;
varying vec4 vStrand;
varying float vVis;
varying vec3 vN;
varying vec3 vWP;
#include <fog_pars_fragment>
void main() {
  float tf = vFall.x;
  float prog = vFall.y;
  float speed = vFall.z;
  float seed = vFall.w;
  float veil = vStrand.y;
  float onRock = vStrand.z;
  float u = vUv.x;
  float across = vUv.y;
  // the pattern rides with the water: v = fall time - now (plus a slow drift of the lateral phase)
  float tv = tf - uTime;
  vec2 q = vec2(across / (6.0 + 5.0 * veil) + seed * 3.7, tv * (0.55 - 0.25 * veil));
  float n1 = texture2D(uNoise, q * vec2(1.0, 0.33)).a;
  float n2 = texture2D(uNoise, q * vec2(2.7, 1.1) + vec2(0.37, 0.11)).r;
  float n3 = texture2D(uNoise, q * vec2(0.45, 0.2) + vec2(0.71, 0.53)).g;
  float n = n1 * 0.55 + n2 * 0.3 + n3 * 0.35 - 0.1;
  // coherent sheet at the lip -> horsetail streaks -> spray
  float fray = smoothstep(0.05, 0.75, prog);
  float th = mix(0.18, 0.48, fray);
  float dens = smoothstep(th, th + 0.22 + 0.2 * fray, n);
  float spray = smoothstep(0.62, 1.0, prog);
  dens = mix(dens, 0.65 * smoothstep(0.22, 0.8, n2 * 0.6 + n3 * 0.6), spray * 0.8);
  // sliding over rock: thick white water
  dens = mix(dens, smoothstep(0.15, 0.55, n), onRock * (1.0 - fray * 0.5));
  if (veil > 0.5) dens = 0.45 * smoothstep(0.3, 0.95, n3 * 0.7 + n2 * 0.5) * smoothstep(0.05, 0.4, prog) * (1.0 - smoothstep(0.62, 0.95, prog));
  // frayed edges
  float edge = 1.0 - smoothstep(0.45 - 0.2 * veil, 1.0, abs(u) + (n2 - 0.5) * 0.55);
  float a = dens * edge * vStrand.x;
  a *= smoothstep(0.0, 0.04, prog) * (1.0 - smoothstep(0.9, 1.0, prog));
  if (a < 0.004) discard;

  vec3 V = normalize(cameraPosition - vWP);
  vec3 N = normalize(vN);
  if (dot(N, V) < 0.0) N = -N;
  // foam is a dense scattering medium: soft wrap lighting + forward scattering through thin spray
  float ndl = dot(N, uKeyDir);
  float wrap = clamp(ndl * 0.5 + 0.55, 0.0, 1.0);
  float mu = max(dot(-V, uKeyDir), 0.0);
  float fwd = pow(mu, 6.0) * 1.4 + pow(mu, 40.0) * 3.0;
  float thin = 1.0 - dens * 0.7;
  vec3 alb = vec3(0.86, 0.88, 0.9);
  vec3 col = alb * (uKeyCol * wrap * vVis + uAmb) * 0.3183;
  col += uKeyCol * vVis * fwd * thin * 0.22;
  // glints: bright pulses in the streaks (bloom), stronger in sunlight than moonlight
  float glint = smoothstep(0.8, 0.98, n1) * (1.0 - spray) * (1.0 - veil);
  col += uKeyCol * vVis * glint * (0.12 + 0.3 * wrap) * (1.0 - uNight * 0.6);
  gl_FragColor = vec4(col * a, a);
  #ifdef USE_FOG
    vec4 f = atmoFogTerm(cameraPosition, vAtmoWorldPos);
    gl_FragColor.rgb = gl_FragColor.rgb * (1.0 - f.a) + f.rgb * (f.a * gl_FragColor.a);
  #endif
}
`;

const MIST_VS = /* glsl */ `
attribute vec4 aMist;    // xyz centre, w size (m)
attribute vec4 aMist2;   // x phase, y period (s), z rise (m), w seed
attribute vec3 aDrift;   // horizontal drift over a life (m), vertical stretch
uniform float uTime;
${LIGHT_MARCH}
varying vec2 vUv;
varying float vAlpha;
varying float vSeed;
varying float vVis;
varying vec3 vWP;
#include <fog_pars_vertex>
void main() {
  float age = fract(aMist2.x + uTime / aMist2.y);
  vec3 c = aMist.xyz + vec3(aDrift.x * age, aMist2.z * age * (0.4 + 0.6 * age), aDrift.y * age);
  float size = aMist.w * (0.55 + 0.75 * age);
  vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  vec3 wp = c + (right * position.x + up * position.y * aDrift.z) * size;
  vUv = position.xy + 0.5;
  vAlpha = sin(age * 3.14159) * smoothstep(0.0, 0.15, age);
  vSeed = aMist2.w + age * 0.35;
  vVis = 0.25 + 0.75 * wfLightVis(c);
  vWP = wp;
  vec4 mvPosition = viewMatrix * vec4(wp, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const MIST_FS = /* glsl */ `
uniform sampler2D uNoise;
uniform vec3 uKeyCol;
uniform vec3 uKeyDir;
uniform vec3 uAmb;
uniform float uStrength;
varying vec2 vUv;
varying float vAlpha;
varying float vSeed;
varying float vVis;
varying vec3 vWP;
#include <fog_pars_fragment>
void main() {
  vec2 d = vUv - 0.5;
  float r = length(d) * 2.0;
  float soft = 1.0 - smoothstep(0.0, 1.0, r);
  soft *= soft;
  // billows: two noise scales eroding the puff, drifting apart as it ages
  float n = texture2D(uNoise, vUv * 0.38 + vec2(vSeed, vSeed * 1.7)).r;
  float n2 = texture2D(uNoise, vUv * 0.85 - d * 0.3 + vec2(vSeed * 2.3, 0.3)).a;
  float a = soft * smoothstep(0.12, 0.9, n * 0.7 + n2 * 0.45 - r * 0.3 + 0.12) * vAlpha * uStrength;
  if (a < 0.003) discard;
  vec3 V = normalize(cameraPosition - vWP);
  float mu = max(dot(-V, uKeyDir), 0.0);
  float fwd = pow(mu, 5.0) * 1.6 + pow(mu, 30.0) * 2.5;
  vec3 col = vec3(0.9) * (uKeyCol * (0.45 + 0.25 * n2) * vVis + uAmb) * 0.3183 + uKeyCol * vVis * fwd * 0.2;
  gl_FragColor = vec4(col * a, a);
  #ifdef USE_FOG
    vec4 f = atmoFogTerm(cameraPosition, vAtmoWorldPos);
    gl_FragColor.rgb = gl_FragColor.rgb * (1.0 - f.a) + f.rgb * (f.a * gl_FragColor.a);
  #endif
}
`;

// ---------------------------------------------------------------------------------------------

/** heightTex / heightXf: the world height texture (water-bake.js) the shaders march for shadows. */
export function buildFalls(ctx, { noiseTex, heightTex, heightXf }) {
  const t0 = performance.now();
  const rng = ctx.noise.createRng('water-falls');
  const sites = findSites(ctx);
  const out = { pos: [], nrm: [], uv: [], fall: [], strand: [], idx: [] };
  const mist = [];
  const falls = [];

  for (const site of sites) {
    const dir = new THREE.Vector3(site.lip.dx, 0, site.lip.dz).normalize();
    const path = tracePath(ctx, site, site.v0);
    if (path.pts.length < 6) continue;
    const across = new THREE.Vector3(dir.z, 0, -dir.x);
    const W = site.width;
    const seed = site.seed * 1.618;
    // main sheet, two thinner side strands, a faint wide veil of spray
    addStrand(ctx, out, path, dir, { width0: W, spread: site.spread, offset: 0, bulge: W * 0.12, push: 3, start: 0, end: 1, alpha: 0.95, seed, veil: 0 });
    const side = [
      [-0.85, 0.55, 0.12],
      [0.8, 0.45, 0.2],
    ];
    const mainEnd = path.pts[path.pts.length - 1].p;
    for (const [off, wmul, st] of side) {
      // a strand of its own when the rim is level there and it lands with the main sheet (a
      // straight cliff); on a ragged rim a lip found sideways starts high or in mid-air and wanders
      // off, so the strand rides the main path at an offset instead
      const lx = site.lip.x + across.x * W * off;
      const lz = site.lip.z + across.z * W * off;
      const lipH = ctx.heightAt(lx, lz);
      let p2 = null;
      if (Math.abs(lipH - site.lip.y) < 3) {
        p2 = tracePath(ctx, { ...site, lip: { ...site.lip, x: lx, y: lipH, z: lz } }, site.v0 * 0.8);
        const e = p2.pts[p2.pts.length - 1].p;
        if (p2.pts.length < 6 || Math.hypot(e.x - mainEnd.x, e.z - mainEnd.z) > W * 2.5 + 20) p2 = null;
      }
      const opts = { width0: W * 0.3 * wmul + 3, spread: site.spread * 1.2, offset: 0, bulge: 1.5, push: 2, start: st * 0.3, end: 1, alpha: 0.75, seed: seed + off, veil: 0, across: 5 };
      if (p2) addStrand(ctx, out, p2, dir, opts);
      else addStrand(ctx, out, path, dir, { ...opts, offset: W * off * 0.62, push: 3 });
    }
    // the spray veil: wide and faint, but not so wide its lower edge reads as a curtain
    addStrand(ctx, out, path, dir, { width0: W * 1.35, spread: site.spread * 0.75, offset: 0, bulge: W * 0.25, push: 12, start: 0.12, end: 1, alpha: 0.45 * site.mist, seed: seed + 5.3, veil: 1 });

    // landing
    const end = path.pts[path.pts.length - 1].p;
    const base = new THREE.Vector3(end.x, Math.max(ctx.heightAt(end.x, end.z), 0), end.z);
    falls.push({ id: site.id, lip: site.lip, dir, base, drop: path.drop, time: path.time, width: W, site });

    // mist: a billowing cloud at the base scaled with the drop, a low skirt rolling outward over
    // the ground, and tall spray plumes peeling off the lower fall. Many large, faint, overlapping
    // sprites read as one volume (few dense ones read as cotton balls).
    const scale = Math.min(1.6, 0.45 + path.drop / 360) * site.mist;
    const R = (W * 2.2 + 40) * scale;
    // only on the open side of the fall and on ground near the pool's level: a puff placed over
    // the cliff top or on its face would float up there on its own
    const dirA = Math.atan2(dir.z, dir.x);
    const spot = (rMax, rMin = 0) => {
      for (let tries = 0; tries < 8; tries++) {
        const r = rMin + Math.pow(rng(), 1.5) * (rMax - rMin);
        const a = dirA + (rng() - 0.5) * Math.PI * 1.25;
        const x = base.x + Math.cos(a) * r;
        const z = base.z + Math.sin(a) * r;
        const g = ctx.heightAt(x, z);
        if (g < base.y + 14) return { x, z, g, r };
      }
      return null;
    };
    const cloud = Math.round(64 * scale + 14);
    for (let i = 0; i < cloud; i++) {
      const sp = spot(R);
      if (!sp) continue;
      const r = sp.r;
      const mx = sp.x;
      const mz = sp.z;
      const size = (34 + rng() * 60) * (0.6 + 0.5 * scale);
      mist.push({
        x: mx,
        y: Math.max(sp.g, base.y) + size * 0.28 + rng() * 14,
        z: mz,
        size,
        phase: rng(),
        period: 16 + rng() * 18,
        rise: (15 + rng() * 38 * scale) * (1 - 0.7 * (r / R)), // the updraft is in the middle
        seed: rng() * 10,
        dx: dir.x * (10 + rng() * 30) + (rng() - 0.5) * 34,
        dz: dir.z * (10 + rng() * 30) + (rng() - 0.5) * 34,
        stretch: 0.9 + rng() * 0.5,
      });
    }
    const skirt = Math.round(22 * scale + 6);
    for (let i = 0; i < skirt; i++) {
      const sp = spot(R * 1.35, R * 0.45);
      if (!sp) continue;
      const a = Math.atan2(sp.z - base.z, sp.x - base.x);
      const mx = sp.x;
      const mz = sp.z;
      const size = (40 + rng() * 55) * (0.6 + 0.5 * scale);
      mist.push({
        x: mx,
        y: Math.max(sp.g, base.y) + size * 0.16,
        z: mz,
        size,
        phase: rng(),
        period: 22 + rng() * 20,
        rise: 3 + rng() * 8,
        seed: rng() * 10,
        dx: Math.cos(a) * (20 + rng() * 30),
        dz: Math.sin(a) * (20 + rng() * 30),
        stretch: 0.45 + rng() * 0.2,
      });
    }
    // spray plumes peeling off the lower fall
    // (only off the lowest part of the drop: higher up they read as stray puffs on the cliff)
    const pts = path.pts;
    let low = pts.length - 1;
    while (low > 0 && pts[low - 1].p.y < base.y + Math.max(25, path.drop * 0.28)) low--;
    const spray = Math.round(20 * scale) + 4;
    for (let i = 0; i < spray; i++) {
      const k = low + Math.floor((pts.length - low) * rng());
      const p = pts[Math.min(k, pts.length - 1)].p;
      const size = 14 + rng() * 24;
      mist.push({
        x: p.x + dir.x * (4 + rng() * 8) + across.x * (rng() - 0.5) * W * 0.6,
        y: p.y,
        z: p.z + dir.z * (4 + rng() * 8) + across.z * (rng() - 0.5) * W * 0.6,
        size,
        phase: rng(),
        period: 8 + rng() * 8,
        rise: -12 - rng() * 24,
        seed: rng() * 10,
        dx: dir.x * (12 + rng() * 16),
        dz: dir.z * (12 + rng() * 16),
        stretch: 1.6 + rng() * 0.8,
      });
    }
  }

  // ---- ribbon mesh
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(out.pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(out.nrm, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(out.uv, 2));
  geo.setAttribute('aFall', new THREE.Float32BufferAttribute(out.fall, 4));
  geo.setAttribute('aStrand', new THREE.Float32BufferAttribute(out.strand, 4));
  geo.setIndex(out.idx);
  geo.computeBoundingSphere();

  const lightU = {
    uKeyCol: { value: new THREE.Color(1, 1, 1) },
    uKeyDir: { value: new THREE.Vector3(0, 1, 0) },
    uHeight: { value: heightTex },
    uHeightXf: { value: heightXf },
    uAmb: { value: new THREE.Color(0.3, 0.3, 0.3) },
    uNight: { value: 0 },
  };
  const timeU = { value: 0 };
  const fallMat = new THREE.ShaderMaterial({
    name: 'water-falls',
    uniforms: { ...ctx.fogUniforms(), uTime: timeU, uNoise: { value: noiseTex }, ...lightU },
    vertexShader: FALL_VS,
    fragmentShader: FALL_FS,
    fog: true,
    transparent: true,
    premultipliedAlpha: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const fallMesh = new THREE.Mesh(geo, fallMat);
  fallMesh.name = 'water-falls';
  fallMesh.renderOrder = 2;
  fallMesh.frustumCulled = true;

  // ---- mist instances
  const quad = new THREE.InstancedBufferGeometry();
  quad.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
  quad.setIndex([0, 1, 2, 0, 2, 3]);
  const m1 = new Float32Array(mist.length * 4);
  const m2 = new Float32Array(mist.length * 4);
  const m3 = new Float32Array(mist.length * 3);
  mist.forEach((m, i) => {
    m1.set([m.x, m.y, m.z, m.size], i * 4);
    m2.set([m.phase, m.period, m.rise, m.seed], i * 4);
    m3.set([m.dx, m.dz, m.stretch], i * 3);
  });
  quad.setAttribute('aMist', new THREE.InstancedBufferAttribute(m1, 4));
  quad.setAttribute('aMist2', new THREE.InstancedBufferAttribute(m2, 4));
  const driftAttr = new THREE.InstancedBufferAttribute(m3, 3);
  quad.setAttribute('aDrift', driftAttr);
  quad.instanceCount = mist.length;
  // bounds for culling: all mist centres (+ max size)
  const box = new THREE.Box3();
  for (const m of mist) box.expandByPoint(new THREE.Vector3(m.x, m.y, m.z));
  box.expandByScalar(160);
  quad.boundingBox = box;
  quad.boundingSphere = box.getBoundingSphere(new THREE.Sphere());
  const mistMat = new THREE.ShaderMaterial({
    name: 'water-mist',
    uniforms: { ...ctx.fogUniforms(), uTime: timeU, uNoise: { value: noiseTex }, uStrength: { value: 0.27 }, ...lightU },
    vertexShader: MIST_VS,
    fragmentShader: MIST_FS,
    fog: true,
    transparent: true,
    premultipliedAlpha: true,
    depthWrite: false,
  });
  const mistMesh = new THREE.Mesh(quad, mistMat);
  mistMesh.name = 'water-mist';
  mistMesh.renderOrder = 3;

  return {
    falls,
    meshes: [fallMesh, mistMesh],
    fallMesh,
    mistMesh,
    lightU,
    timeU,
    stats: { ms: Math.round(performance.now() - t0), vertices: out.pos.length / 3, triangles: out.idx.length / 3, mist: mist.length },
  };
}
