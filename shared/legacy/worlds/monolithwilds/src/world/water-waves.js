// Procedural textures for the water module (no image files):
//
//   createWaveNormalTexture()  tileable wave slope map, rendered once on the GPU. A sum of
//                              directional sine waves with integer wave numbers (so it tiles
//                              exactly) and a wind-sea spectrum (amplitude ~ k^-1.7, biased toward
//                              one direction). RG = slope x/z (0.5 = flat). Mipmapped: distant
//                              water averages toward flat.
//   createWaterNoiseTexture()  tileable value-noise fbm set, RGBA = 4 independent fields
//                              (R, G: smooth fbm at two scales, B: cellular "foam" pattern,
//                              A: fine fbm). Used for wind patches, foam breakup, falls and mist.

import * as THREE from 'crownfall-world-three';

const TAU = Math.PI * 2;

/** Wave list: integer wave vectors (so the map tiles), amplitude from a directional spectrum. */
function waveList(rng) {
  const waves = [];
  const count = 72;
  for (let w = 0; w < count; w++) {
    let kx = 0;
    let kz = 0;
    let km = 0;
    // log-uniform wavelength between tile/2 and tile/40, direction spread around +x
    for (let tries = 0; tries < 20; tries++) {
      const k = Math.exp(Math.log(2) + rng() * Math.log(40 / 2));
      const spread = rng() < 0.75 ? 0.9 : Math.PI; // most waves travel roughly with the wind
      const a = (rng() * 2 - 1) * spread;
      kx = Math.round(k * Math.cos(a));
      kz = Math.round(k * Math.sin(a));
      km = Math.hypot(kx, kz);
      if (km >= 2) break;
    }
    if (km < 1) continue;
    const amp = Math.pow(km, -1.7) * (0.6 + 0.8 * rng());
    const ph = rng() * TAU;
    if (w % 5 === 0) continue; // (a second height field for glints used to take every 5th wave)
    waves.push({ kx, kz, amp, ph });
  }
  // merge waves that share a wave vector (k and -k are the same wave) into one phasor, so the
  // slope RMS below is exact
  const merged = new Map();
  for (const w of waves) {
    let { kx, kz, ph } = w;
    if (kx < 0 || (kx === 0 && kz < 0)) {
      kx = -kx;
      kz = -kz;
      ph = -ph;
    }
    const key = `${kx},${kz}`;
    const m = merged.get(key) || { kx, kz, re: 0, im: 0 };
    m.re += w.amp * Math.cos(ph);
    m.im += w.amp * Math.sin(ph);
    merged.set(key, m);
  }
  return [...merged.values()].map((m) => ({ kx: m.kx, kz: m.kz, amp: Math.hypot(m.re, m.im), ph: Math.atan2(m.im, m.re) }));
}

const WAVE_VS = /* glsl */ `
void main() { gl_Position = vec4(position.xy * 2.0, 0.0, 1.0); }
`;
const WAVE_FS = /* glsl */ `
uniform vec4 uWaves[WAVES];   // kx, kz (cycles per tile), amplitude, phase
uniform float uScale;
uniform float uSize;
void main() {
  // texel (i, j) samples the tile at (i, j) / N, like a DataTexture filled on the CPU would
  vec2 p = floor(gl_FragCoord.xy) / uSize;
  vec2 s = vec2(0.0);
  for (int i = 0; i < WAVES; i++) {
    vec4 w = uWaves[i];
    float a = 6.2831853 * fract(w.x * p.x + w.y * p.y) + w.w;
    s -= w.z * w.xy * sin(a);
  }
  s = clamp(s * uScale, -1.0, 1.0);
  gl_FragColor = vec4(s * 0.5 + 0.5, 0.5, 1.0);
}
`;

/**
 * Tileable wave slope map, rendered once on the GPU (a sum of ~60 directional sine waves per texel
 * is ~4 M sin() calls: milliseconds on a GPU, ~70 ms of JS). RG = slope x / z, encoded as
 * slope / 0.5 in [-1, 1] -> [0, 1], normalised to an RMS slope of 0.16. Mipmapped, so distant
 * water averages toward flat (the shader widens the glitter through roughness instead).
 */
export function createWaveNormalTexture(rng, renderer, size = 256) {
  const waves = waveList(rng);
  // analytic RMS of each slope component: mean((sum a k sin)^2) = sum a^2 k^2 / 2
  let ss = 0;
  for (const w of waves) ss += (w.amp * w.amp * (w.kx * w.kx + w.kz * w.kz)) / 2;
  const rms = Math.sqrt(ss / 2) || 1;
  const scale = (0.16 / rms) * 2.0;
  if (!renderer) return cpuWaveTexture(waves, scale, size);

  const rt = new THREE.WebGLRenderTarget(size, size, {
    type: THREE.UnsignedByteType,
    format: THREE.RGBAFormat,
    wrapS: THREE.RepeatWrapping,
    wrapT: THREE.RepeatWrapping,
    magFilter: THREE.LinearFilter,
    minFilter: THREE.LinearMipmapLinearFilter,
    generateMipmaps: true,
    depthBuffer: false,
    stencilBuffer: false,
  });
  rt.texture.name = 'water-waves';
  rt.texture.colorSpace = THREE.NoColorSpace;
  const mat = new THREE.ShaderMaterial({
    vertexShader: WAVE_VS,
    fragmentShader: WAVE_FS,
    defines: { WAVES: waves.length },
    uniforms: {
      uWaves: { value: waves.map((w) => new THREE.Vector4(w.kx, w.kz, w.amp, w.ph)) },
      uScale: { value: scale },
      uSize: { value: size },
    },
    depthTest: false,
    depthWrite: false,
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
  quad.frustumCulled = false;
  const scene = new THREE.Scene();
  scene.add(quad);
  const cam = new THREE.Camera();
  const prev = renderer.getRenderTarget();
  const prevXr = renderer.xr.enabled;
  renderer.xr.enabled = false;
  renderer.setRenderTarget(rt);
  renderer.render(scene, cam);
  renderer.setRenderTarget(prev);
  renderer.xr.enabled = prevXr;
  quad.geometry.dispose();
  mat.dispose();
  const tex = rt.texture;
  tex.userData.slopeScale = 0.5;
  tex.userData.renderTarget = rt;
  return tex;
}

/** CPU fallback of the same map (no renderer, e.g. in node tooling). */
function cpuWaveTexture(waves, scale, N) {
  const data = new Uint8Array(N * N * 4);
  const sx = new Float32Array(N * N);
  const sz = new Float32Array(N * N);
  for (const w of waves) {
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const a = TAU * ((w.kx * i + w.kz * j) / N) + w.ph;
        const s = w.amp * Math.sin(a);
        sx[j * N + i] -= w.kx * s;
        sz[j * N + i] -= w.kz * s;
      }
    }
  }
  for (let o = 0; o < N * N; o++) {
    data[o * 4] = Math.round((Math.max(-1, Math.min(1, sx[o] * scale)) * 0.5 + 0.5) * 255);
    data[o * 4 + 1] = Math.round((Math.max(-1, Math.min(1, sz[o] * scale)) * 0.5 + 0.5) * 255);
    data[o * 4 + 2] = 128;
    data[o * 4 + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.colorSpace = THREE.NoColorSpace;
  tex.name = 'water-waves';
  tex.needsUpdate = true;
  tex.userData.slopeScale = 0.5;
  return tex;
}

/** Periodic value-noise fbm on an N x N torus (per-octave column tables keep the inner loop flat). */
function periodicFbm(rng, N, baseCells, octaves, gain = 0.5) {
  const out = new Float32Array(N * N);
  const c0s = new Int32Array(N);
  const c1s = new Int32Array(N);
  const txs = new Float32Array(N);
  let amp = 1;
  let norm = 0;
  let cells = baseCells;
  for (let o = 0; o < octaves; o++) {
    const lat = new Float32Array(cells * cells);
    for (let i = 0; i < lat.length; i++) lat[i] = rng() * 2 - 1;
    const f = cells / N;
    for (let i = 0; i < N; i++) {
      const x = i * f;
      const x0 = Math.floor(x);
      const tx = x - x0;
      txs[i] = tx * tx * (3 - 2 * tx);
      c0s[i] = x0 % cells;
      c1s[i] = (x0 + 1) % cells;
    }
    for (let j = 0; j < N; j++) {
      const y = j * f;
      const y0 = Math.floor(y);
      let ty = y - y0;
      ty = ty * ty * (3 - 2 * ty);
      const r0 = (y0 % cells) * cells;
      const r1 = ((y0 + 1) % cells) * cells;
      const row = j * N;
      for (let i = 0; i < N; i++) {
        const c0 = c0s[i];
        const c1 = c1s[i];
        const tx = txs[i];
        const a = lat[r0 + c0] + (lat[r0 + c1] - lat[r0 + c0]) * tx;
        const b = lat[r1 + c0] + (lat[r1 + c1] - lat[r1 + c0]) * tx;
        out[row + i] += amp * (a + (b - a) * ty);
      }
    }
    norm += amp;
    amp *= gain;
    cells *= 2;
  }
  for (let i = 0; i < out.length; i++) out[i] /= norm;
  return out;
}

/** Periodic Worley F1 (cells of foam / bubbles). Feature points on a padded (wrapped) lattice. */
function periodicCells(rng, N, cells) {
  const pts = new Float32Array(cells * cells * 2);
  for (let i = 0; i < pts.length; i++) pts[i] = rng();
  // padded copy (cells + 2)^2 so the 3x3 search never wraps: point (gx, gy) in absolute units
  const P = cells + 2;
  const px = new Float32Array(P * P);
  const py = new Float32Array(P * P);
  for (let gy = -1; gy <= cells; gy++) {
    for (let gx = -1; gx <= cells; gx++) {
      const k = (((gy + cells) % cells) * cells + ((gx + cells) % cells)) * 2;
      const o = (gy + 1) * P + (gx + 1);
      px[o] = gx + pts[k];
      py[o] = gy + pts[k + 1];
    }
  }
  const out = new Float32Array(N * N);
  const f = cells / N;
  for (let j = 0; j < N; j++) {
    const y = j * f;
    const cy = Math.floor(y);
    for (let i = 0; i < N; i++) {
      const x = i * f;
      const cx = Math.floor(x);
      let best = 9;
      for (let dy = 0; dy < 3; dy++) {
        const o = (cy + dy) * P + cx;
        for (let dx = 0; dx < 3; dx++) {
          const ddx = px[o + dx] - x;
          const ddy = py[o + dx] - y;
          const d = ddx * ddx + ddy * ddy;
          if (d < best) best = d;
        }
      }
      out[j * N + i] = Math.sqrt(best);
    }
  }
  return out;
}

export function createWaterNoiseTexture(rng, size = 256) {
  const N = size;
  const a = periodicFbm(rng, N, 4, 5, 0.52);
  const b = periodicFbm(rng, N, 8, 4, 0.55);
  const c = periodicCells(rng, N, 16);
  const d = periodicFbm(rng, N, 16, 4, 0.6);
  const data = new Uint8Array(N * N * 4);
  const enc = (v) => Math.max(0, Math.min(255, Math.round(v)));
  for (let o = 0; o < N * N; o++) {
    data[o * 4] = enc((a[o] * 0.5 + 0.5) * 255);
    data[o * 4 + 1] = enc((b[o] * 0.5 + 0.5) * 255);
    data[o * 4 + 2] = enc(Math.min(1, c[o] * 1.25) * 255);
    data[o * 4 + 3] = enc((d[o] * 0.5 + 0.5) * 255);
  }
  // stretch contrast of the fbm channels so smoothstep thresholds behave
  for (const ch of [0, 1, 3]) {
    let lo = 255;
    let hi = 0;
    for (let o = 0; o < N * N; o++) {
      const v = data[o * 4 + ch];
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    const s = 255 / Math.max(1, hi - lo);
    for (let o = 0; o < N * N; o++) data[o * 4 + ch] = enc((data[o * 4 + ch] - lo) * s);
  }
  const tex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.colorSpace = THREE.NoColorSpace;
  tex.name = 'water-noise';
  tex.needsUpdate = true;
  return tex;
}
