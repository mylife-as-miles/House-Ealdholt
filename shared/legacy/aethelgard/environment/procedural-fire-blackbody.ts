/** Planck/CIE integration adapted from Leon Lin's MIT procedural-fire,
 * blackbody.js, pinned95ab0a9003e20f1b0a5556ac14b401dfa0a37596.
 * This bounded LUT retains physical temperature-dependent emission; it is not
 * a replacement palette. See repository third-party notices for attribution. */
export const PROCEDURAL_FIRE_TEMPERATURE_RANGE = Object.freeze([400, 2400] as const);
const gaussian = (x: number, mean: number, low: number, high: number) => {
  const t = (x - mean) / (x < mean ? low : high); return Math.exp(-.5 * t * t);
};
function cie(wavelength: number): readonly [number, number, number] {
  return [1.056 * gaussian(wavelength,599.8,37.9,31) + .362 * gaussian(wavelength,442,16,26.7) - .065 * gaussian(wavelength,501.1,20.4,26.2),
    .821 * gaussian(wavelength,568.8,46.9,40.5) + .286 * gaussian(wavelength,530.9,16.3,31.1),
    1.217 * gaussian(wavelength,437,11.8,36) + .681 * gaussian(wavelength,459,26,13.8)];
}
export function proceduralFirePlanck(wavelengthNanometres: number, temperatureKelvin: number): number {
  if (!Number.isFinite(wavelengthNanometres) || wavelengthNanometres <= 0 || !Number.isFinite(temperatureKelvin) || temperatureKelvin <= 0) return 0;
  const wavelength = wavelengthNanometres * 1e-9;
  return 1.191042972e-16 / (wavelength ** 5 * Math.expm1(.01438776877 / (wavelength * temperatureKelvin)));
}
function xyz(temperature: number, soot = false): number[] {
  const output = [0, 0, 0];
  for (let wavelength = 380; wavelength <= 780; wavelength += 5) {
    const power = proceduralFirePlanck(wavelength, temperature) * (soot ? (wavelength / 550) ** -1.39 : 1), observer = cie(wavelength);
    for (let i = 0; i < 3; i++) output[i] += power * observer[i];
  }
  return output;
}
/** Linear RGB radiance relative to a1500K blackbody luminance. No browser,
 * GPU, white-balance state or time is involved. */
export function proceduralFireBlackbody(temperatureKelvin: number, soot = false): readonly [number, number, number] {
  if (!Number.isFinite(temperatureKelvin) || temperatureKelvin <= 0) return [0, 0, 0];
  const value = xyz(Math.min(10000, temperatureKelvin), soot), reference = xyz(1500)[1];
  const x = value[0] / reference, y = value[1] / reference, z = value[2] / reference;
  return [Math.max(0, 3.2404542*x - 1.5371385*y - .4985314*z),
    Math.max(0, -.969266*x + 1.8760108*y + .041556*z), Math.max(0, .0556434*x - .2040259*y + 1.0572252*z)];
}
export function createProceduralFireBlackbodyLut(samples = 128): { readonly data: Uint8Array; readonly width: number; readonly height: 2 } {
  if (!Number.isSafeInteger(samples) || samples < 16 || samples > 1024) throw Error('Fire blackbody LUT needs16–1024 samples.');
  const data = new Uint8Array(samples * 2 * 4), [minimum, maximum] = PROCEDURAL_FIRE_TEMPERATURE_RANGE;
  for (let row = 0; row < 2; row++) for (let i = 0; i < samples; i++) {
    const color = proceduralFireBlackbody(minimum + (maximum-minimum)*i/(samples-1), row === 1), offset = (row*samples+i)*4;
    // Log radiance preserves HDR in ordinaryRGBA8 without pre-tonemapping.
    // The shader decodes exp2(16*x)-1 before the owner's single tone map.
    for (let channel = 0; channel < 3; channel++) data[offset+channel] = Math.round(255*Math.min(1,Math.log2(1+color[channel])/16));
    data[offset+3] = 255;
  }
  return { data, width: samples, height: 2 };
}
