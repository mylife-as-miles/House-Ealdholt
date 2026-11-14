/** Spectrum equations adapted from Leonxlnx/open-water, ocean/ocean.js,
 * 3d1adaa1154f98e639a6c6e0f7c514bbeb0496b8. Copyright (c) 2026 Leonxlnx,
 * MIT; see Open Water notices. No upstream audio is included. */
export const OPEN_WATER_SOURCE_REVISION = '3d1adaa1154f98e639a6c6e0f7c514bbeb0496b8';
export const OPEN_WATER_LENGTHS = Object.freeze([1800, 117, 21, 3.7] as const);
export type OpenWaterResolution = 32 | 64;
export interface OpenWaterBand { readonly length: number; readonly minimum: number; readonly maximum: number; readonly texel: number }
export interface OpenWaterSpectrumParameters { readonly wind: number; readonly fetch: number; readonly direction: number; readonly scale: number }
const G = 9.81, SIGMA_RHO = 7.4e-5;

/** Keep adjacent spectral partitions contiguous at bounded resolutions. The
 * upstream 6*dk handoff assumes N=256; at N=32 it exceeds a coarse band's
 * Nyquist limit and would leave a large missing wavelength interval. */
export function createOpenWaterBands(resolution: OpenWaterResolution): readonly OpenWaterBand[] {
  if (resolution !== 32 && resolution !== 64) throw Error('Open Water resolution must be 32 or 64.');
  const boundaries = [Math.PI / OPEN_WATER_LENGTHS[0]];
  for (let i = 1; i < 4; i++) boundaries.push(Math.min(12 * Math.PI / OPEN_WATER_LENGTHS[i], Math.PI * (resolution - 2) / OPEN_WATER_LENGTHS[i - 1]));
  boundaries.push(Math.PI * (resolution - 2) / OPEN_WATER_LENGTHS[3]);
  return Object.freeze(OPEN_WATER_LENGTHS.map((length, i) => Object.freeze({ length, minimum: boundaries[i], maximum: boundaries[i + 1], texel: length / resolution })));
}

/** Omnidirectional Elfouhaily elevation spectrum S(k), in metres cubed. */
export function openWaterElfouhaily(k: number, wind: number, fetch: number): { spectrum: number; peak: number } {
  if (!Number.isFinite(k) || k <= 0 || !Number.isFinite(wind) || wind <= 0 || !Number.isFinite(fetch) || fetch <= 0) return { spectrum: 0, peak: 0 };
  const U = Math.max(.5, wind), ko = G / (U * U);
  const omega = Math.min(5, Math.max(.84, .84 * Math.tanh((ko * fetch / 2.2e4) ** .4) ** -.75));
  const kp = ko * omega * omega, cp = Math.sqrt(G / kp), km = 370, cm = .23;
  const c = Math.sqrt(G / k * (1 + (k / km) ** 2)), lpm = Math.exp(-1.25 * (kp / k) ** 2);
  const gamma = omega <= 1 ? 1.7 : 1.7 + 6 * Math.log10(omega), sigma = .08 * (1 + 4 / omega ** 3), r = Math.sqrt(k / kp) - 1;
  const jp = gamma ** Math.exp(-r * r / (2 * sigma * sigma));
  const bl = .5 * .006 * omega ** .55 * (cp / c) * lpm * jp * Math.exp(-omega / Math.sqrt(10) * r);
  const ustar = .03795 * U, am = Math.max(0, ustar <= cm ? .01 * (1 + Math.log(ustar / cm)) : .01 * (1 + 3 * Math.log(ustar / cm)));
  const bh = .5 * am * (cm / c) * lpm * jp * Math.exp(-.25 * (k / km - 1) ** 2);
  return { spectrum: (bl + bh) / k ** 3, peak: kp };
}
export function openWaterDonelanBanner(theta: number, ratio: number): number {
  const r = Math.min(10, Math.max(.56, ratio));
  const beta = r < .95 ? 2.61 * r ** 1.3 : r < 1.6 ? 2.28 * r ** -1.3 : 10 ** (-.4 + .8393 * Math.exp(-.567 * Math.log(r * r)));
  const c = Math.cosh(Math.min(15, Math.max(-15, beta * theta)));
  return beta / (2 * Math.tanh(beta * Math.PI) * c * c);
}
export interface OpenWaterSpectrumStats { readonly heightVariance: number; readonly significantHeight: number; readonly resolvedSlopeVariance: number; readonly bandSlopeVariance: readonly number[] }
/** Production CPU integral drives the Jacobian foam threshold and supplies the
 * slope energy lost by coarse fragment filtering. It does not advance time. */
export function computeOpenWaterSpectrumStats(parameters: OpenWaterSpectrumParameters, bands: readonly OpenWaterBand[]): OpenWaterSpectrumStats {
  const values = [parameters.wind, parameters.fetch, parameters.direction, parameters.scale];
  if (values.some(value => !Number.isFinite(value)) || parameters.wind < 0 || parameters.fetch <= 0 || parameters.scale < 0 || bands.length !== 4) throw Error('Invalid Open Water spectrum parameters.');
  const bandSlopeVariance = [0, 0, 0, 0]; let heightVariance = 0, resolvedSlopeVariance = 0;
  const steps = 192;
  for (let band = 0; band < bands.length; band++) {
    const low = Math.log(bands[band].minimum), high = Math.log(bands[band].maximum), width = (high - low) / steps;
    for (let i = 0; i < steps; i++) {
      const k = Math.exp(low + (i + .5) * width), dk = k * width;
      const spectrum = openWaterElfouhaily(k, parameters.wind, parameters.fetch).spectrum * parameters.scale * Math.exp(-k * k * .004 * .004);
      heightVariance += spectrum * dk; const slope = k * k * spectrum * dk;
      resolvedSlopeVariance += slope; bandSlopeVariance[band] += slope;
    }
  }
  return { heightVariance, significantHeight: 4 * Math.sqrt(heightVariance), resolvedSlopeVariance, bandSlopeVariance };
}

/** Gaussian complex seed input. Fixed per-band seeds keep spectrum changes
 * coherent; randomness is created once at setup, never per simulation frame. */
export function createOpenWaterNoise(resolution: OpenWaterResolution, seed: number): Float32Array {
  if ((resolution !== 32 && resolution !== 64) || !Number.isSafeInteger(seed)) throw Error('Open Water noise requires bounded resolution and a safe seed.');
  const noise = new Float32Array(resolution * resolution * 4); let state = (seed | 0) || 1;
  const uniform = () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return ((state >>> 0) + .5) / 4294967296; };
  for (let i = 0; i < noise.length; i += 2) {
    const radius = Math.sqrt(-2 * Math.log(uniform())), angle = 2 * Math.PI * uniform();
    noise[i] = radius * Math.cos(angle); noise[i + 1] = radius * Math.sin(angle);
  }
  return noise;
}
export function openWaterDispersion(k: number): number { return Math.sqrt(G * k + SIGMA_RHO * k * k * k); }

/** Numeric reference for the actual Stockham shader's unnormalised inverse
 * stages. Used to compare impulses/Hermitian modes against an independent DFT. */
export function openWaterInverseFFT1D(input: ArrayLike<number>): Float64Array {
  const n = input.length / 2;
  if (!Number.isSafeInteger(n) || n < 2 || n > 4096 || (n & (n - 1))) throw Error('FFT input requires interleaved complex power-of-two samples.');
  let source = Float64Array.from(input), target = new Float64Array(input.length);
  for (let stage = 0; stage < Math.log2(n); stage++) {
    const ns = 1 << stage;
    for (let i = 0; i < n; i++) {
      const r = i & (2 * ns - 1), k = r & (ns - 1), j = (i >> (stage + 1)) * ns + k;
      const angle = Math.PI * k / ns, wr = Math.cos(angle), wi = Math.sin(angle), sign = r < ns ? 1 : -1;
      const br = source[(j + n / 2) * 2], bi = source[(j + n / 2) * 2 + 1];
      target[i * 2] = source[j * 2] + sign * (br * wr - bi * wi);
      target[i * 2 + 1] = source[j * 2 + 1] + sign * (br * wi + bi * wr);
    }
    const swap = source; source = target; target = swap;
  }
  return source;
}
