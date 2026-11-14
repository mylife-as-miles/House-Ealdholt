// Descending Temple — water: the falls that pour off the plaza rim (and a few gallery spouts),
// thinning into streaks and dissolving into mist long before they reach the mesa; drifting mist
// billboards; the still pools (plaza basin + channels, the raised reflecting pool on the mesa).
//
// Falls: one merged ribbon geometry (a solid core sheet + a wider spray veil per fall). The
// shader scrolls streak noise in "fall age" space (age = sqrt(2d/g)) so streaks visibly
// accelerate and stretch as they drop. Mist: camera-facing quads expanded in the vertex shader,
// drifting slowly with time. All animation is in shaders; update() does nothing per frame.

import * as THREE from 'crownfall-world-three';
import { TIER_FALLS, sideToXZ } from './temple-crown.js';
import { setBounds } from './temple-geo.js';

const NOISE_GLSL = /* glsl */ `
float twHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float twNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(twHash(i), twHash(i + vec2(1.0, 0.0)), f.x), mix(twHash(i + vec2(0.0, 1.0)), twHash(i + vec2(1.0, 1.0)), f.x), f.y);
}
`;

const FALL_VERT = /* glsl */ `
attribute vec3 aInfo; // layer, drop, seed
varying vec2 vUv;
varying vec3 vInfo;
#include <fog_pars_vertex>
void main() {
  vUv = uv;
  vInfo = aInfo;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const FALL_FRAG = /* glsl */ `
varying vec2 vUv;
varying vec3 vInfo;
#include <fog_pars_fragment>
${NOISE_GLSL}
void main() {
  float d = vUv.y;
  float drop = vInfo.y;
  float layer = vInfo.x;
  float seed = vInfo.z;
  float t = uAtmoTime.x;
  float fall = clamp(d / drop, 0.0, 1.0);
  float age = sqrt(2.0 * max(d, 0.0) / 9.8);
  float s = age - t * 0.9;
  float x = vUv.x;
  float n1 = twNoise(vec2(x * 18.0 + seed, s * 1.7));
  float n2 = twNoise(vec2(x * 47.0 + seed * 3.1, s * 4.1 + 7.0));
  float n3 = twNoise(vec2(x * 7.0 - seed, s * 0.8 + 3.0));
  float streak = n1 * 0.5 + n2 * 0.28 + n3 * 0.34;
  // the sheet thins into separate strands, then dissolves
  float thr = mix(0.12, 0.82, smoothstep(0.02, 0.75, fall));
  float body = smoothstep(thr - 0.18, thr + 0.22, streak);
  float ew = 0.12 + 0.25 * fall;
  float edge = smoothstep(0.0, ew, x + (n3 - 0.5) * 0.12) * smoothstep(1.0, 1.0 - ew, x - (n1 - 0.5) * 0.12);
  float fade = 1.0 - smoothstep(0.38, 0.95, fall);
  float a = body * edge * fade;
  if (layer > 0.5) a = (0.25 + 0.5 * n3) * edge * smoothstep(0.02, 0.25, fall) * (1.0 - smoothstep(0.5, 1.0, fall)) * 0.45;
  else a *= mix(0.92, 0.55, fall);
  // light: ambient sky + sun, strong forward scattering when backlit
  vec3 V = normalize(vAtmoWorldPos - cameraPosition);
  float fwd = pow(max(dot(V, uAtmoSunDir), 0.0), 4.0);
  vec3 col = uAtmoFogColor * 0.6 + vec3(0.2, 0.23, 0.27) * (1.0 - uAtmoTime.y) + uAtmoSunColor * (0.55 + 2.4 * fwd);
  col += vec3(0.03, 0.045, 0.07) * uAtmoTime.y;
  col *= 0.86 + 0.28 * n2;
  gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));
  #include <fog_fragment>
}
`;

const MIST_VERT = /* glsl */ `
attribute vec4 aPuff;   // size, seed, phase, alpha
attribute vec2 aCorner;
uniform vec4 uAtmoTime;
varying vec2 vC;
varying vec2 vP;
#include <fog_pars_vertex>
void main() {
  vec3 c = position;
  float t = uAtmoTime.x;
  c.x += sin(t * 0.045 + aPuff.z) * aPuff.x * 0.22;
  c.y += sin(t * 0.031 + aPuff.z * 1.7) * aPuff.x * 0.1;
  c.z += cos(t * 0.039 + aPuff.z) * aPuff.x * 0.22;
  vec4 mvPosition = modelViewMatrix * vec4(c, 1.0);
  float rot = (aPuff.y - 0.5) * 0.6 + t * 0.012 * (aPuff.y - 0.5);
  float cr = cos(rot), sr = sin(rot);
  vec2 k = vec2(cr * aCorner.x - sr * aCorner.y, sr * aCorner.x + cr * aCorner.y);
  mvPosition.xy += vec2(k.x, k.y * 1.35) * aPuff.x;
  vC = aCorner;
  vP = vec2(aPuff.y, aPuff.w);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const MIST_FRAG = /* glsl */ `
varying vec2 vC;
varying vec2 vP;
#include <fog_pars_fragment>
${NOISE_GLSL}
void main() {
  float r = length(vC);
  float a = 1.0 - smoothstep(0.15, 1.0, r);
  float n = twNoise(vC * 2.2 + vP.x * 17.0) * 0.6 + twNoise(vC * 5.1 - vP.x * 9.0) * 0.4;
  a *= a * (0.45 + 0.75 * n) * vP.y;
  vec3 V = normalize(vAtmoWorldPos - cameraPosition);
  float fwd = pow(max(dot(V, uAtmoSunDir), 0.0), 3.0);
  float day = 1.0 - uAtmoTime.y;
  vec3 col = uAtmoFogColor * 0.6 + vec3(0.2, 0.22, 0.26) * day + uAtmoSunColor * (0.55 + 1.8 * fwd);
  col += vec3(0.02, 0.03, 0.05) * uAtmoTime.y;
  gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));
  #include <fog_fragment>
}
`;

export function buildWater(ctx, { root, tilt, out, base, rng, tiers, reflect = [] }) {
  let triangles = 0;

  // --- tier (gallery) falls -----------------------------------------------------------------
  const v = new THREE.Vector3();
  for (const f of TIER_FALLS) {
    const t = tiers[f.tier];
    const a = [0, Math.PI / 2, Math.PI, -Math.PI / 2][f.side];
    const [x, z] = sideToXZ(a, f.u, t.hw + 1.4);
    v.set(x, t.yf + 0.4, z).applyMatrix4(tilt);
    out.falls.push({ x: v.x, y: v.y, z: v.z, a, w: f.w, drop: 150 + rng() * 40, v0: 3.2 });
  }

  // --- falls ------------------------------------------------------------------------------------
  const P = [], UV = [], INFO = [], IDX = [];
  let vc = 0;
  const K = 44;
  const COLS = 4;
  for (const f of out.falls) {
    const ox = Math.sin(f.a), oz = Math.cos(f.a);
    const tx = Math.cos(f.a), tz = -Math.sin(f.a);
    const seed = rng() * 50;
    for (let layer = 0; layer < 2; layer++) {
      const base0 = vc;
      for (let k = 0; k <= K; k++) {
        const fk = k / K;
        const d = f.drop * Math.pow(fk, 1.7);
        const hOff = f.v0 * Math.sqrt((2 * d) / 9.8) + (layer ? 1.2 + d * 0.02 : 0);
        const w = f.w * (1 + d / 110) * (layer ? 1.7 : 1) + (layer ? 3 : 0);
        const wob = Math.sin(d * 0.025 + seed) * d * 0.02;
        for (let c = 0; c <= COLS; c++) {
          const fc = c / COLS;
          const across = (fc - 0.5) * w;
          P.push(f.x + ox * hOff + tx * (across + wob), f.y - d, f.z + oz * hOff + tz * (across + wob));
          UV.push(fc, d);
          INFO.push(layer, f.drop, seed + layer * 13);
          vc++;
        }
      }
      for (let k = 0; k < K; k++) {
        for (let c = 0; c < COLS; c++) {
          const a0 = base0 + k * (COLS + 1) + c;
          const b0 = a0 + COLS + 1;
          IDX.push(a0, b0, a0 + 1, a0 + 1, b0, b0 + 1);
        }
      }
    }
  }
  const fallGeo = new THREE.BufferGeometry();
  fallGeo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  fallGeo.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2));
  fallGeo.setAttribute('aInfo', new THREE.Float32BufferAttribute(INFO, 3));
  fallGeo.setIndex(IDX);
  setBounds(fallGeo, fallGeo.attributes.position.array);
  const fallMat = new THREE.ShaderMaterial({
    uniforms: { ...ctx.fogUniforms() },
    vertexShader: FALL_VERT,
    fragmentShader: FALL_FRAG,
    fog: true,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const falls = new THREE.Mesh(fallGeo, fallMat);
  falls.name = 'temple:falls';
  falls.renderOrder = 2;
  falls.frustumCulled = false;
  root.add(falls);
  triangles += IDX.length / 3;

  // --- mist puffs ---------------------------------------------------------------------------------
  const MP = [], MC = [], MA = [], MI = [];
  let mv = 0;
  const puff = (x, y, z, size, alpha) => {
    const seed = rng();
    const phase = rng() * 6.28;
    for (const [cx, cy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      MP.push(x, y, z);
      MC.push(cx, cy);
      MA.push(size, seed, phase, alpha);
    }
    MI.push(mv, mv + 1, mv + 2, mv, mv + 2, mv + 3);
    mv += 4;
  };
  for (const f of out.falls) {
    const ox = Math.sin(f.a), oz = Math.cos(f.a);
    const n = Math.round(f.drop / 11);
    for (let k = 0; k < n; k++) {
      const fk = 0.35 + 0.65 * Math.pow(rng(), 0.6);
      const d = f.drop * fk;
      const hOff = f.v0 * Math.sqrt((2 * d) / 9.8);
      const spread = 4 + d * 0.12;
      const x = f.x + ox * (hOff + (rng() - 0.3) * spread) + (rng() - 0.5) * spread * Math.cos(f.a);
      const z = f.z + oz * (hOff + (rng() - 0.3) * spread) - (rng() - 0.5) * spread * Math.sin(f.a);
      const size = 16 + fk * 42 + rng() * 16;
      puff(x, f.y - d, z, size, 0.03 + 0.048 * Math.sin(Math.PI * Math.min(1, fk * 1.1)));
    }
    // spray at the lip
    for (let k = 0; k < 3; k++) puff(f.x + ox * (2 + k * 2), f.y - 3 - k * 5, f.z + oz * (2 + k * 2), 4 + k * 2.5, 0.16);
  }
  // low spray drifting over the reflecting pool
  if (base.poolY) {
    for (let k = 0; k < 26; k++) {
      const ang = rng() * Math.PI * 2;
      const r = 30 + rng() * 60;
      puff(Math.cos(ang) * r, base.poolY + 2 + rng() * 5, Math.sin(ang) * r, 12 + rng() * 14, 0.05 + rng() * 0.06);
    }
  }
  const mistGeo = new THREE.BufferGeometry();
  mistGeo.setAttribute('position', new THREE.Float32BufferAttribute(MP, 3));
  mistGeo.setAttribute('aCorner', new THREE.Float32BufferAttribute(MC, 2));
  mistGeo.setAttribute('aPuff', new THREE.Float32BufferAttribute(MA, 4));
  mistGeo.setIndex(MI);
  const mistMat = new THREE.ShaderMaterial({
    uniforms: { ...ctx.fogUniforms() },
    vertexShader: MIST_VERT,
    fragmentShader: MIST_FRAG,
    fog: true,
    transparent: true,
    depthWrite: false,
  });
  const mist = new THREE.Mesh(mistGeo, mistMat);
  mist.name = 'temple:mist';
  mist.renderOrder = 3;
  mist.frustumCulled = false;
  root.add(mist);
  triangles += MI.length / 3;

  // --- still water: plaza basin + channels (tilted) and the reflecting pool (level) ---------
  const WP = [], WI = [], WM = [];
  let wv = 0;
  const quad = (pts, m, mirror) => {
    for (const [x, y, z] of pts) {
      v.set(x, y, z);
      if (m) v.applyMatrix4(m);
      WP.push(v.x, v.y, v.z);
      WM.push(mirror);
    }
    WI.push(wv, wv + 2, wv + 1, wv, wv + 3, wv + 2);
    wv += 4;
  };
  const rect = (x0, z0, x1, z1, y, m, mirror) => quad([[x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1]], m, mirror);
  const ring = (rIn, rOut, y, m, causeway = 0, mirror = 0) => {
    rect(-rOut, rIn, rOut, rOut, y, m, mirror);
    rect(-rOut, -rOut, rOut, -rIn, y, m, mirror);
    rect(rIn, -rIn, rOut, rIn, y, m, mirror);
    if (causeway) {
      rect(-rOut, causeway, -rIn, rIn, y, m, mirror);
      rect(-rOut, -rIn, -rIn, -causeway, y, m, mirror);
    } else rect(-rOut, -rIn, -rIn, rIn, y, m, mirror);
  };
  for (const q of out.waterQuads) {
    if (q.ring) ring(q.rIn, q.rOut, q.y, tilt);
    else {
      const s = Math.sin(q.a), c = Math.cos(q.a);
      const P4 = [[q.u - q.w / 2, q.r0], [q.u + q.w / 2, q.r0], [q.u + q.w / 2, q.r1], [q.u - q.w / 2, q.r1]].map(([u, r]) => [u * c + r * s, q.y, -u * s + r * c]);
      quad(P4, tilt, 0);
    }
  }
  for (const p of base.pools) ring(p.rIn, p.rOut, p.y, null, p.causeway, 1);
  const wGeo = new THREE.BufferGeometry();
  wGeo.setAttribute('position', new THREE.Float32BufferAttribute(WP, 3));
  wGeo.setAttribute('aMirror', new THREE.Float32BufferAttribute(WM, 1));
  wGeo.setIndex(WI);
  wGeo.computeVertexNormals();
  const mirror = createMirror(ctx, root, base, reflect);
  const wMat = new THREE.MeshStandardMaterial({ color: new THREE.Color('#0b1418'), roughness: 0.05, metalness: 0.0 });
  mirror.patch(wMat);
  const pools = new THREE.Mesh(wGeo, wMat);
  pools.name = 'temple:pools';
  pools.receiveShadow = true;
  root.add(pools);
  triangles += WI.length / 3;

  return {
    triangles,
    update: mirror.update,
  };
}

// ---------------------------------------------------------------------------
// Planar mirror for the reflecting pool: the inverted ziggurat appears the right way up in it.
// Only the temple's main meshes are re-rendered (private layer 7), at half resolution, and only
// while the camera is near and above the pool with the pool in view (Reflector-style virtual
// camera with an oblique near plane; no extra shader programs for the reflected materials).

const MIRROR_LAYER = 7;

function createMirror(ctx, root, base, meshNames) {
  const THREEr = THREE;
  const uniforms = {
    tRefl: { value: null },
    uTexMat: { value: new THREEr.Matrix4() },
    uReflOn: { value: 0 },
    uPoolTime: { value: ctx.atmo ? ctx.atmo.time : { x: 0, y: 0, z: 0, w: 0 } },
    uPoolSky: { value: ctx.atmo ? ctx.atmo.fogColor : { x: 0.5, y: 0.5, z: 0.55 } },
    uPoolSun: { value: ctx.atmo ? ctx.atmo.sunColor : { x: 1, y: 0.6, z: 0.3 } },
    uNoEnv: { value: 1 },
  };
  const patch = (mat) => {
    mat.customProgramCacheKey = () => 'temple-pool-mirror';
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, uniforms);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aMirror;\nuniform mat4 uTexMat;\nvarying vec4 vReflUv;\nvarying float vMirror;\nvarying vec3 vPoolW;')
        .replace('#include <project_vertex>', '#include <project_vertex>\n{ vec4 pw = modelMatrix * vec4(transformed, 1.0); vReflUv = uTexMat * pw; vMirror = aMirror; vPoolW = pw.xyz; }');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform sampler2D tRefl;\nuniform float uReflOn;\nuniform float uNoEnv;\nuniform vec4 uPoolTime;\nuniform vec3 uPoolSky;\nuniform vec3 uPoolSun;\nvarying vec4 vReflUv;\nvarying float vMirror;\nvarying vec3 vPoolW;')
        .replace('#include <opaque_fragment>', `#include <opaque_fragment>
        {
          float nv = clamp(dot(normalize(vViewPosition), normal), 0.0, 1.0);
          float fres = mix(0.12, 0.92, pow(1.0 - nv, 3.0));
          vec4 rc = vec4(0.0);
          if (uReflOn > 0.5 && vMirror > 0.5) {
            float t = uPoolTime.x;
            vec2 rip = vec2(sin(vPoolW.x * 0.31 + t * 0.7) + sin(vPoolW.z * 0.23 - t * 0.5),
                            sin(vPoolW.z * 0.27 + t * 0.6) + sin(vPoolW.x * 0.19 + t * 0.45)) * 0.0016;
            rc = texture2DProj(tRefl, vReflUv + vec4(rip * vReflUv.w, 0.0, 0.0));
          }
          // until an environment map exists, reflect an approximate horizon sky where the mirror is empty
          vec3 sky = uPoolSky * 1.08 + uPoolSun * 0.08;
          gl_FragColor.rgb = mix(gl_FragColor.rgb, sky, fres * (1.0 - clamp(rc.a, 0.0, 1.0)) * uNoEnv);
          gl_FragColor.rgb = mix(gl_FragColor.rgb, rc.rgb, fres * clamp(rc.a, 0.0, 1.0));
        }`);
    };
  };

  const enabled = ctx.quality.level !== 'low' && ctx.renderer && base.pools.length;
  const envCheck = () => {
    uniforms.uNoEnv.value = ctx.scene.environment ? 0 : 1;
  };
  if (!enabled) return { patch, update: envCheck };

  const renderer = ctx.renderer;
  const size = new THREEr.Vector2();
  const rt = new THREEr.WebGLRenderTarget(4, 4, { type: THREEr.HalfFloatType, depthBuffer: true });
  rt.texture.generateMipmaps = false;
  uniforms.tRefl.value = rt.texture;
  const resize = () => {
    renderer.getDrawingBufferSize(size);
    rt.setSize(Math.max(4, Math.floor(size.x * 0.5)), Math.max(4, Math.floor(size.y * 0.5)));
  };
  resize();
  ctx.onResize?.(resize);

  // reflected meshes + the lights must share the private layer
  for (const n of meshNames) root.getObjectByName(n)?.layers.enable(MIRROR_LAYER);
  for (const l of [ctx.env?.sun, ctx.env?.moon, ctx.env?.hemi]) l?.layers.enable(MIRROR_LAYER);

  const pool = base.pools[0];
  const wy = pool.y;
  root.updateMatrixWorld(true);
  const centre = new THREEr.Vector3(0, wy, 0).applyMatrix4(root.matrixWorld);
  const box = new THREEr.Box3(new THREEr.Vector3(-pool.rOut, wy - 1, -pool.rOut), new THREEr.Vector3(pool.rOut, wy + 1, pool.rOut)).applyMatrix4(root.matrixWorld);
  const cam = ctx.camera;
  const vcam = new THREEr.PerspectiveCamera();
  vcam.layers.set(MIRROR_LAYER);
  vcam.matrixAutoUpdate = true;
  const normal = new THREEr.Vector3(0, 1, 0);
  const planePoint = new THREEr.Vector3(centre.x, wy, centre.z);
  const camPos = new THREEr.Vector3();
  const view = new THREEr.Vector3();
  const lookAt = new THREEr.Vector3();
  const target = new THREEr.Vector3();
  const rot = new THREEr.Matrix4();
  const plane = new THREEr.Plane();
  const clip = new THREEr.Vector4();
  const q = new THREEr.Vector4();
  const frustum = new THREEr.Frustum();
  const pv = new THREEr.Matrix4();
  const clearColor = new THREEr.Color();
  const bias = new THREEr.Matrix4().set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);

  function update() {
    envCheck();
    uniforms.uReflOn.value = 0;
    cam.updateMatrixWorld();
    camPos.setFromMatrixPosition(cam.matrixWorld);
    const dx = camPos.x - centre.x, dz = camPos.z - centre.z;
    if (dx * dx + dz * dz > 1300 * 1300 || camPos.y < wy + 0.3) return;
    pv.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    frustum.setFromProjectionMatrix(pv);
    if (!frustum.intersectsBox(box)) return;

    // virtual camera mirrored in the plane y = wy
    view.copy(camPos);
    view.y = 2 * wy - view.y;
    rot.extractRotation(cam.matrixWorld);
    lookAt.set(0, 0, -1).applyMatrix4(rot).add(camPos);
    target.copy(lookAt);
    target.y = 2 * wy - target.y;
    vcam.position.copy(view);
    vcam.up.set(0, 1, 0).applyMatrix4(rot);
    vcam.up.y = -vcam.up.y;
    vcam.lookAt(target);
    vcam.far = cam.far;
    vcam.near = cam.near;
    vcam.updateMatrixWorld();
    vcam.projectionMatrix.copy(cam.projectionMatrix);
    vcam.matrixWorldInverse.copy(vcam.matrixWorld).invert();
    uniforms.uTexMat.value.copy(bias).multiply(vcam.projectionMatrix).multiply(vcam.matrixWorldInverse);

    // oblique near plane = the water plane (nothing below the surface is reflected)
    plane.setFromNormalAndCoplanarPoint(normal, planePoint).applyMatrix4(vcam.matrixWorldInverse);
    clip.set(plane.normal.x, plane.normal.y, plane.normal.z, plane.constant);
    const pe = vcam.projectionMatrix.elements;
    q.x = (Math.sign(clip.x) + pe[8]) / pe[0];
    q.y = (Math.sign(clip.y) + pe[9]) / pe[5];
    q.z = -1.0;
    q.w = (1.0 + pe[10]) / pe[14];
    clip.multiplyScalar(2.0 / clip.dot(q));
    pe[2] = clip.x;
    pe[6] = clip.y;
    pe[10] = clip.z + 1.0 - 0.003;
    pe[14] = clip.w;
    vcam.projectionMatrixInverse.copy(vcam.projectionMatrix).invert();

    const prevTarget = renderer.getRenderTarget();
    const prevShadow = renderer.shadowMap.autoUpdate;
    const prevBg = ctx.scene.background;
    const prevAlpha = renderer.getClearAlpha();
    renderer.getClearColor(clearColor);
    renderer.shadowMap.autoUpdate = false;
    ctx.scene.background = null;
    renderer.setRenderTarget(rt);
    renderer.setClearColor(0x000000, 0);
    renderer.clear(true, true, false);
    renderer.render(ctx.scene, vcam);
    renderer.setRenderTarget(prevTarget);
    renderer.setClearColor(clearColor, prevAlpha);
    ctx.scene.background = prevBg;
    renderer.shadowMap.autoUpdate = prevShadow;
    uniforms.uReflOn.value = 1;
  }

  return { patch, update };
}
