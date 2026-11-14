/** Lightweight sky-dome adaptation of ZyFou/ProceduralTerrains noise.
 * MIT source and exact revision: ./PROCEDURAL_TERRAINS_SOURCES.md.
 * This is texture-backed cloud coverage, not volumetric ray marching. */
export const EALDHOLT_CLOUDS = Object.freeze({
  radius: 550, textureSize: 256, windX: .0018, windZ: .0007,
  projectionFloor: .07, horizonFadeStart: .09, horizonFadeEnd: .28,
});

function fract(value: number): number { return value - Math.floor(value); }
/** Hoskins hash and quintic interpolation adapted from cloudGLSL.js. */
function hash(x: number, y: number, z: number): number {
  x = fract(x * .1031); y = fract(y * .1031); z = fract(z * .1031);
  const d = x * (z + 31.32) + y * (y + 31.32) + z * (x + 31.32);
  x += d; y += d; z += d; return fract((x + y) * z);
}
function noise(x: number, y: number, z: number): number {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const smooth = (n: number) => n * n * n * (n * (n * 6 - 15) + 10);
  const a = smooth(x - ix), b = smooth(y - iy), c = smooth(z - iz);
  const mix = (p: number, q: number, t: number) => p + (q - p) * t;
  return mix(mix(mix(hash(ix, iy, iz), hash(ix + 1, iy, iz), a),
    mix(hash(ix, iy + 1, iz), hash(ix + 1, iy + 1, iz), a), b),
  mix(mix(hash(ix, iy, iz + 1), hash(ix + 1, iy, iz + 1), a),
    mix(hash(ix, iy + 1, iz + 1), hash(ix + 1, iy + 1, iz + 1), a), b), c);
}
/** A toroidal 3D domain makes both repeat seams continuous. Original Crownfall
 * texture baking; no external texture, camera, DOM, renderer or network use. */
export function createEaldholtCloudPixels(size: number = EALDHOLT_CLOUDS.textureSize): Uint8Array {
  if (!Number.isInteger(size) || size < 16 || size > 512) throw Error('Invalid cloud texture size.');
  const pixels = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size * Math.PI * 2, v = y / size * Math.PI * 2;
    let value = 0, amplitude = .5, sum = 0;
    for (let octave = 0; octave < 4; octave++) {
      const frequency = 2 ** octave;
      value += amplitude * noise(17 + Math.cos(u) * 2.8 * frequency,
        11 + Math.sin(u) * 2.8 * frequency + Math.cos(v) * 2.1 * frequency,
        7 + Math.sin(v) * 2.1 * frequency);
      sum += amplitude; amplitude *= .5;
    }
    const p = (y * size + x) * 4, coverage = Math.round(value / sum * 255);
    pixels[p] = coverage; pixels[p + 1] = coverage; pixels[p + 2] = coverage; pixels[p + 3] = 255;
  }
  return pixels;
}

export const EALDHOLT_CLOUD_VERTEX = `varying vec3 vEaldholtCloudDirection;
void main() {
  vEaldholtCloudDirection = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.);
}`;

export const EALDHOLT_CLOUD_FRAGMENT = `
uniform sampler2D uEaldholtCloudNoise;
uniform float uEaldholtCloudTime;
varying vec3 vEaldholtCloudDirection;
void main() {
  vec3 direction = normalize(vEaldholtCloudDirection);
  // Hide the safety-clamped projection entirely in horizon haze. A visible
  // constant denominator stretches the same cloud sample into vertical bars.
  vec2 domain = direction.xz / max(direction.y, ${EALDHOLT_CLOUDS.projectionFloor.toFixed(3)}) * .15;
  vec2 drift = vec2(${EALDHOLT_CLOUDS.windX}, ${EALDHOLT_CLOUDS.windZ}) * uEaldholtCloudTime;
  float broad = texture2D(uEaldholtCloudNoise, domain + drift).r;
  float detail = texture2D(uEaldholtCloudNoise, domain * 2.13 - drift * .38 + vec2(.27, .43)).r;
  float density = smoothstep(.41, .66, broad * .8 + detail * .2);
  float horizonFade = smoothstep(${EALDHOLT_CLOUDS.horizonFadeStart.toFixed(3)}, ${EALDHOLT_CLOUDS.horizonFadeEnd.toFixed(3)}, direction.y);
  float light = smoothstep(.35, .69, broad + (detail - .5) * .3);
  vec3 cloudColour = mix(vec3(.49, .57, .64), vec3(.94, .94, .91), light);
  gl_FragColor = vec4(cloudColour, density * horizonFade * .84);
  #include <colorspace_fragment>
}`;
