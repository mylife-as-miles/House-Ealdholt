// Tileable noise texture for the sky (clouds, Milky Way, moon surface, aurora rays).
// Baked once on the CPU, deterministic, 256x256 RGBA8, repeat-wrapped + mipmapped:
//   R  Perlin fbm (period 4)            large cloud masses / Milky Way clouds
//   G  inverted Worley fbm (period 5)   rounded cumulus billows
//   B  Perlin fbm (period 8)            cirrus / generic detail
//   A  inverted Worley (period 12)      small billows, crater-like cells

import * as THREE from 'crownfall-world-three';
import { mulberry32, seedFrom } from '../core/noise.js';

const SIZE = 256;

function makePerm(seed) {
  const rand = mulberry32(seedFrom(seed));
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const t = p[i];
    p[i] = p[j];
    p[j] = t;
  }
  const perm = new Uint8Array(512);
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  return perm;
}

const GX = [1, -1, 1, -1, 1.41421, -1.41421, 0, 0];
const GY = [1, 1, -1, -1, 0, 0, 1.41421, -1.41421];

/** Periodic 2D Perlin noise, period P (integer lattice), output roughly [-1, 1]. */
function perlin(x, y, P, perm) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const x0 = ((xi % P) + P) % P;
  const y0 = ((yi % P) + P) % P;
  const x1 = (x0 + 1) % P;
  const y1 = (y0 + 1) % P;
  const g = (ix, iy, dx, dy) => {
    const h = perm[perm[ix] + iy] & 7;
    return GX[h] * dx + GY[h] * dy;
  };
  const u = xf * xf * xf * (xf * (xf * 6 - 15) + 10);
  const v = yf * yf * yf * (yf * (yf * 6 - 15) + 10);
  const n00 = g(x0, y0, xf, yf);
  const n10 = g(x1, y0, xf - 1, yf);
  const n01 = g(x0, y1, xf, yf - 1);
  const n11 = g(x1, y1, xf - 1, yf - 1);
  const nx0 = n00 + (n10 - n00) * u;
  const nx1 = n01 + (n11 - n01) * u;
  return (nx0 + (nx1 - nx0) * v) * 0.9;
}

/** Periodic Worley F1 distance (cell units, ~0..1). */
function worley(x, y, P, perm) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  let best = 9;
  for (let oy = -1; oy <= 1; oy++) {
    for (let ox = -1; ox <= 1; ox++) {
      const cx = xi + ox;
      const cy = yi + oy;
      const wx = ((cx % P) + P) % P;
      const wy = ((cy % P) + P) % P;
      const h1 = perm[perm[wx] + wy];
      const h2 = perm[perm[wx + 17] + ((wy + 91) & 255)];
      const px = cx + h1 / 255;
      const py = cy + h2 / 255;
      const dx = px - x;
      const dy = py - y;
      const d = dx * dx + dy * dy;
      if (d < best) best = d;
    }
  }
  return Math.sqrt(best);
}

function perlinFbm(u, v, P, oct, perm) {
  let s = 0;
  let a = 0.5;
  let norm = 0;
  let f = 1;
  for (let o = 0; o < oct; o++) {
    s += a * perlin(u * P * f, v * P * f, P * f, perm);
    norm += a;
    a *= 0.5;
    f *= 2;
  }
  return s / norm;
}

function worleyFbm(u, v, P, oct, perm) {
  let s = 0;
  let a = 0.6;
  let norm = 0;
  let f = 1;
  for (let o = 0; o < oct; o++) {
    s += a * (1 - Math.min(1, worley(u * P * f, v * P * f, P * f, perm)));
    norm += a;
    a *= 0.45;
    f *= 2;
  }
  return s / norm;
}

/** Build the sky noise texture (≈40–80 ms). */
export function createSkyNoiseTexture() {
  const permA = makePerm('sky-a');
  const permB = makePerm('sky-b');
  const permC = makePerm('sky-c');
  const permD = makePerm('sky-d');
  const data = new Uint8Array(SIZE * SIZE * 4);
  const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
  for (let y = 0; y < SIZE; y++) {
    const v = y / SIZE;
    for (let x = 0; x < SIZE; x++) {
      const u = x / SIZE;
      const i = (y * SIZE + x) * 4;
      const r = perlinFbm(u, v, 4, 6, permA) * 0.5 + 0.5;
      const g = worleyFbm(u, v, 5, 3, permB);
      const b = perlinFbm(u, v, 8, 5, permC) * 0.5 + 0.5;
      const a = 1 - Math.min(1, worley(u * 12, v * 12, 12, permD));
      data[i] = clamp01((r - 0.5) * 1.35 + 0.5) * 255;
      data[i + 1] = clamp01(g * 1.15 - 0.05) * 255;
      data[i + 2] = clamp01((b - 0.5) * 1.35 + 0.5) * 255;
      data[i + 3] = clamp01(a) * 255;
    }
  }
  const tex = new THREE.DataTexture(data, SIZE, SIZE, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}
