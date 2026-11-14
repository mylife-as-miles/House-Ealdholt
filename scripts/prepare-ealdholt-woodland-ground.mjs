// Offline, deterministic Poly Haven CC0 intake for the Ealdholt woodland ground set.
// Inputs (official downloads, API snapshots and licence pages) stay in a private
// intake folder outside Git; `fetch` builds that folder from Poly Haven. Each layer
// is written to its OWN new folder; existing folders are never overwritten.
// Nothing here runs at game runtime.
//
//   node scripts/prepare-ealdholt-woodland-ground.mjs fetch   PRIVATE_INTAKE_DIRECTORY
//   node scripts/prepare-ealdholt-woodland-ground.mjs prepare PRIVATE_INTAKE_DIRECTORY OUTPUT_PARENT_DIRECTORY [layers...] [--include-held-back]
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { linearFromSrgb, meanLinearLuminance, reducePhotographicMap } from './prepare-aethelgard-photographic-ground.mjs';

const hash = (bytes, algorithm = 'sha256') => createHash(algorithm).update(bytes).digest('hex');
const srgbFromLinear = value => value <= .0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - .055;
const round = (value, digits = 6) => Number(value.toFixed(digits));
const smoothstep = (low, high, value) => { const t = Math.max(0, Math.min(1, (value - low) / (high - low))); return t * t * (3 - 2 * t); };
const luminanceOf = rgb => .2126 * rgb[0] + .7152 * rgb[1] + .0722 * rgb[2];
const grassIndex = rgb => (rgb[1] - rgb[0]) / Math.max(luminanceOf(rgb), 1e-9);

// ---------------------------------------------------------------------------
// Colour measurement. Used for the source analysis in
// docs/legacy/environment/EALDHOLT_GROUND_SOURCES.md and recorded in every
// prepared manifest, so the published numbers can be reproduced from the files.
// ---------------------------------------------------------------------------

/** Pixel classes use HSV on the encoded sRGB values. A pixel is chromatic when
 * its HSV saturation reaches 0.12 and its value reaches 0.04; otherwise it is
 * neutral (grey stone, shadow, bleached litter). Hue bands, in degrees:
 * green [70,170), olive/straw [55,70), warm brown/tan [345,360)+[0,55),
 * other (cyan, blue, violet) [170,345). */
export const GROUND_COLOUR_CLASSES = Object.freeze({
  chromaticSaturation: .12, minimumValue: .04,
  green: Object.freeze([70, 170]), olive: Object.freeze([55, 70]), warm: Object.freeze([345, 55]),
});

export function hsv(r, g, b) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min;
  let hue = 0;
  if (delta > 0) {
    if (max === r) hue = 60 * (((g - b) / delta) % 6);
    else if (max === g) hue = 60 * ((b - r) / delta + 2);
    else hue = 60 * ((r - g) / delta + 4);
    if (hue < 0) hue += 360;
  }
  return [hue, max > 0 ? delta / max : 0, max];
}

/** Class of one sRGB pixel (components 0..1). Exported for tests. */
export function classifyGroundPixel(r, g, b) {
  const [hue, saturation, value] = hsv(r, g, b), c = GROUND_COLOUR_CLASSES;
  if (saturation < c.chromaticSaturation || value < c.minimumValue) return 'neutral';
  if (hue >= c.green[0] && hue < c.green[1]) return 'green';
  if (hue >= c.olive[0] && hue < c.olive[1]) return 'olive';
  if (hue >= c.warm[0] || hue < c.warm[1]) return 'warm';
  return 'other';
}

/** Statistics for an 8-bit sRGB image. `pixels` holds `channels` bytes per
 * pixel (3 or 4; alpha is ignored). Luminance is linear Rec. 709 Y, the same
 * quantity as every existing ground manifest's meanLuminance. Macro metrics
 * measure visible tile blotchiness at two block scales: the coefficient of
 * variation of block-mean luminance, and the standard deviation of the
 * block-mean chroma index (G-R)/Y, which catches colour patches that a
 * luminance-only metric misses. */
export function measureGroundAlbedo(pixels, width, height, channels = 3) {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 16 || height < 16 || width % 16 || height % 16)
    throw Error('Ground measurement expects an image whose sides are positive multiples of 16.');
  if (channels !== 3 && channels !== 4) throw Error('Ground measurement expects RGB or RGBA pixels.');
  if (!pixels || pixels.length !== width * height * channels) throw Error('Ground measurement pixel buffer does not match its dimensions.');
  const count = width * height, bins = 4096, luminanceHistogram = new Uint32Array(bins), hueHistogram = new Array(12).fill(0);
  const linear = [0, 0, 0], shares = { green: 0, olive: 0, warm: 0, neutral: 0, other: 0 }, energy = { green: 0, olive: 0, warm: 0, neutral: 0, other: 0 };
  const blocks = { 8: new Float64Array(8 * 8 * 4), 16: new Float64Array(16 * 16 * 4) };
  let luminanceSum = 0, saturationSum = 0, logSum = 0, logSquares = 0, chromatic = 0;
  const saturationHistogram = new Uint32Array(1001);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const at = (y * width + x) * channels, r = pixels[at] / 255, g = pixels[at + 1] / 255, b = pixels[at + 2] / 255;
    const lr = linearFromSrgb(r), lg = linearFromSrgb(g), lb = linearFromSrgb(b), luminance = .2126 * lr + .7152 * lg + .0722 * lb;
    linear[0] += lr; linear[1] += lg; linear[2] += lb; luminanceSum += luminance;
    luminanceHistogram[Math.min(bins - 1, Math.floor(luminance * bins))]++;
    const logLuminance = Math.log(Math.max(luminance, 1e-4)); logSum += logLuminance; logSquares += logLuminance * logLuminance;
    const [hue, saturation] = hsv(r, g, b); saturationSum += saturation; saturationHistogram[Math.round(saturation * 1000)]++;
    const kind = classifyGroundPixel(r, g, b); shares[kind]++; energy[kind] += luminance;
    if (kind !== 'neutral') { chromatic++; hueHistogram[Math.min(11, Math.floor(hue / 30))]++; }
    for (const side of [8, 16]) { const block = (Math.floor(y * side / height) * side + Math.floor(x * side / width)) * 4, list = blocks[side];
      list[block] += lr; list[block + 1] += lg; list[block + 2] += lb; list[block + 3] += luminance; }
  }
  const percentile = fraction => {
    const target = fraction * count; let seen = 0;
    for (let i = 0; i < bins; i++) { seen += luminanceHistogram[i]; if (seen >= target) return (i + .5) / bins; }
    return 1;
  };
  const medianSaturation = (() => { let seen = 0; for (let i = 0; i <= 1000; i++) { seen += saturationHistogram[i]; if (seen >= count / 2) return i / 1000; } return 1; })();
  const meanLinearRgb = linear.map(value => value / count), meanLuminance = luminanceSum / count;
  const macro = side => {
    const list = blocks[side], n = side * side, ys = [], indices = [];
    for (let i = 0; i < n; i++) { const rgb = [list[i * 4], list[i * 4 + 1], list[i * 4 + 2]]; ys.push(list[i * 4 + 3]); indices.push(grassIndex(rgb)); }
    const mean = values => values.reduce((a, b) => a + b, 0) / values.length, sd = values => { const m = mean(values); return Math.sqrt(values.reduce((a, b) => a + (b - m) ** 2, 0) / values.length); };
    return { luminanceCv: sd(ys) / Math.max(mean(ys), 1e-12), chromaSd: sd(indices) };
  };
  const macro8 = macro(8), macro16 = macro(16);
  const chromaticity = meanLinearRgb.map(value => value / Math.max(meanLinearRgb[0] + meanLinearRgb[1] + meanLinearRgb[2], 1e-9));
  const meanSrgb8 = meanLinearRgb.map(value => Math.round(Math.max(0, Math.min(1, srgbFromLinear(value))) * 255));
  const [meanHue, meanSaturationOfMean] = hsv(...meanSrgb8.map(value => value / 255));
  const logMean = logSum / count;
  return {
    width, height, pixels: count,
    meanLinearRgb: meanLinearRgb.map(value => round(value)), meanSrgb8, meanColourHue: round(meanHue, 2), meanColourSaturation: round(meanSaturationOfMean, 4),
    meanLuminance: round(meanLuminance, 8),
    luminancePercentiles: { p05: round(percentile(.05)), p25: round(percentile(.25)), p50: round(percentile(.5)), p75: round(percentile(.75)), p95: round(percentile(.95)) },
    logLuminanceDeviation: round(Math.sqrt(Math.max(0, logSquares / count - logMean * logMean)), 4),
    meanSaturation: round(saturationSum / count, 4), medianSaturation,
    shares: Object.fromEntries(Object.entries(shares).map(([kind, value]) => [kind, round(value / count, 4)])),
    luminanceWeightedShares: Object.fromEntries(Object.entries(energy).map(([kind, value]) => [kind, round(value / Math.max(luminanceSum, 1e-12), 4)])),
    greenToWarmRatio: round(shares.green / Math.max(shares.warm, 1), 4),
    chromaticHueHistogram30: hueHistogram.map(value => round(value / Math.max(chromatic, 1), 4)),
    linearChromaticity: chromaticity.map(value => round(value, 4)),
    /** The outer-valley shader's grass test, (G-R)/Y of the linear mean. */
    valleyGrassIndex: round(grassIndex(meanLinearRgb), 4),
    /** Coefficient of variation of the 8x8 block-mean luminance (unchanged definition). */
    macroVariation: round(macro8.luminanceCv, 4),
    macroLuminanceVariation16: round(macro16.luminanceCv, 4),
    /** Standard deviation of block-mean (G-R)/Y at 8x8 and 16x16 blocks. */
    macroChromaVariation8: round(macro8.chromaSd, 4), macroChromaVariation16: round(macro16.chromaSd, 4),
  };
}

// ---------------------------------------------------------------------------
// Living-sward grade (meadow). No candidate Poly Haven ground scan is
// green-dominant (see the analysis document), so the meadow albedo is graded:
//  * a HARD vegetation mask (hue >= 38 deg, saturation >= 0.15, value >= 0.07,
//    each with a 3-degree / 0.03-wide anti-alias edge) selects grass blades and
//    straw; red-brown litter, soil, grey twigs and dark crevices are bit-identical;
//  * selected pixels move by one common offset in linear chromaticity, from the
//    vegetation centre toward the photo's OWN strongest living greens, with
//    per-pixel linear luminance restored, so structure, contrast and the mean
//    luminance stay photographic and straw stays lighter/yellower than blades;
//  * the amount is calibrated by bisection so the tile mean (G-R)/Y equals the
//    target. The target was chosen against DISPLAYED pixels under the village
//    daylight (analysis document) and is no lower than the village ground atlas
//    olive (+0.389), so the valley meadow can continue the village at its edge.
// ---------------------------------------------------------------------------

/** Village ground atlas olive, shared/legacy/aethelgard/environment/ground-atlas.ts. */
export const VILLAGE_ATLAS_OLIVE = Object.freeze([.052, .079, .026]);
/** Valley grass palette, shared/legacy/aethelgard/environment/river-valley.ts. */
export const VALLEY_GRASS_PALETTE = Object.freeze([.063, .080, .034]);
export const LIVING_SWARD_GRADE = Object.freeze({
  mask: Object.freeze({ hue: Object.freeze([35, 38]), hueEnd: Object.freeze([150, 160]), saturation: Object.freeze([.12, .15]), value: Object.freeze([.04, .07]) }),
  /** Living-green reference: source pixels with hue in [75,150), saturation >= 0.3, value >= 0.1. */
  reference: Object.freeze({ hue: Object.freeze([75, 150]), saturation: .3, value: .1 }),
  /** Calibration target, (G-R)/Y of the tile's linear mean: the village atlas olive itself.
   * Under the village daylight this already displays at hue 85 deg (the atlas strip
   * shows 84.5-84.8 deg) with 80-93% green pixels at plan, normal and overview distance. */
  meanGrassIndex: round(grassIndex(VILLAGE_ATLAS_OLIVE), 4),
  /** No grade may land below the village atlas olive. */
  minimumGrassIndex: round(grassIndex(VILLAGE_ATLAS_OLIVE), 4),
});

/** Vegetation weight in [0,1] for one sRGB pixel (components 0..1): a hard
 * threshold with a narrow anti-alias edge, never a wide partial-weight ramp. */
export function livingSwardWeight(r, g, b, grade = LIVING_SWARD_GRADE) {
  const [hue, saturation, value] = hsv(r, g, b), m = grade.mask;
  return smoothstep(m.hue[0], m.hue[1], hue) * (1 - smoothstep(m.hueEnd[0], m.hueEnd[1], hue)) * smoothstep(m.saturation[0], m.saturation[1], saturation) * smoothstep(m.value[0], m.value[1], value);
}

/** Linear chromaticity of the photo's own strongest living greens. */
export function measureLivingGreenReference(pixels, width, height, channels = 3, grade = LIVING_SWARD_GRADE) {
  if (!pixels || pixels.length !== width * height * channels) throw Error('Living green measurement expects a complete buffer.');
  const sum = [0, 0, 0], ref = grade.reference; let count = 0;
  for (let i = 0; i < width * height; i++) {
    const r = pixels[i * channels] / 255, g = pixels[i * channels + 1] / 255, b = pixels[i * channels + 2] / 255, [hue, saturation, value] = hsv(r, g, b);
    if (hue < ref.hue[0] || hue >= ref.hue[1] || saturation < ref.saturation || value < ref.value) continue;
    sum[0] += linearFromSrgb(r); sum[1] += linearFromSrgb(g); sum[2] += linearFromSrgb(b); count++;
  }
  if (count < width * height * .01) throw Error('Too few living green pixels to measure.');
  const total = sum[0] + sum[1] + sum[2];
  return { pixels: count, chromaticity: sum.map(value => value / total) };
}

function shiftPixels(linear, weights, shift, output) {
  let clipped = 0; const mean = [0, 0, 0];
  for (let i = 0; i < weights.length; i++) {
    const lr = linear[i * 3], lg = linear[i * 3 + 1], lb = linear[i * 3 + 2], weight = weights[i];
    let r = lr, g = lg, b = lb;
    if (weight > 0) {
      const sum = lr + lg + lb, luminance = .2126 * lr + .7152 * lg + .0722 * lb;
      let cr = lr / sum + weight * shift[0], cg = lg / sum + weight * shift[1], cb = lb / sum + weight * shift[2];
      if (cr < 1e-4 || cg < 1e-4 || cb < 1e-4) clipped++;
      cr = Math.max(cr, 1e-4); cg = Math.max(cg, 1e-4); cb = Math.max(cb, 1e-4);
      const scale = luminance / (.2126 * cr + .7152 * cg + .0722 * cb);
      r = cr * scale; g = cg * scale; b = cb * scale;
      const peak = Math.max(r, g, b); if (peak > 1) { r /= peak; g /= peak; b /= peak; clipped++; }
    }
    if (output) { output[i * 3] = r; output[i * 3 + 1] = g; output[i * 3 + 2] = b; }
    mean[0] += r; mean[1] += g; mean[2] += b;
  }
  return { clipped, meanGrassIndex: grassIndex(mean) };
}

/** Returns a new RGB buffer (3 bytes per pixel) and the grade record. Each
 * vegetation pixel moves by weight * strength * (reference - centre) in linear
 * chromaticity, with its linear luminance restored; `strength` is found by
 * bisection so the tile mean reaches grade.meanGrassIndex. */
export function gradeLivingSward(pixels, width, height, channels = 3, grade = LIVING_SWARD_GRADE) {
  if (!pixels || pixels.length !== width * height * channels || (channels !== 3 && channels !== 4)) throw Error('Sward grade expects a complete RGB or RGBA buffer.');
  if (!Number.isFinite(grade.meanGrassIndex) || grade.meanGrassIndex <= -1 || grade.meanGrassIndex >= 1.5) throw Error('Sward grade needs a finite mean grass index target.');
  if (grade.meanGrassIndex < grade.minimumGrassIndex) throw Error('Sward grade target lies below the village atlas olive.');
  const reference = measureLivingGreenReference(pixels, width, height, channels, grade).chromaticity;
  const count = width * height, weights = new Float32Array(count), linear = new Float64Array(count * 3), vegetation = [0, 0, 0], sourceMean = [0, 0, 0];
  let weightSum = 0, protectedPixels = 0;
  for (let i = 0; i < count; i++) {
    const at = i * channels, r = pixels[at] / 255, g = pixels[at + 1] / 255, b = pixels[at + 2] / 255;
    const lr = linearFromSrgb(r), lg = linearFromSrgb(g), lb = linearFromSrgb(b), sum = lr + lg + lb;
    linear[i * 3] = lr; linear[i * 3 + 1] = lg; linear[i * 3 + 2] = lb; sourceMean[0] += lr; sourceMean[1] += lg; sourceMean[2] += lb;
    const weight = sum > 1e-6 ? livingSwardWeight(r, g, b, grade) : 0; weights[i] = weight; weightSum += weight; if (weight === 0) protectedPixels++;
    if (weight > 0) { vegetation[0] += weight * lr / sum; vegetation[1] += weight * lg / sum; vegetation[2] += weight * lb / sum; }
  }
  if (weightSum < count * .01) throw Error('Sward grade found too little vegetation to move.');
  const centre = vegetation.map(value => value / weightSum), direction = reference.map((value, c) => value - centre[c]);
  const at = strength => shiftPixels(linear, weights, direction.map(value => value * strength), null);
  let low = 0, high = 8;
  if (at(low).meanGrassIndex >= grade.meanGrassIndex) high = 0;
  else if (at(high).meanGrassIndex < grade.meanGrassIndex) throw Error('Sward grade cannot reach the target grass index.');
  for (let step = 0; step < 48 && high > 0; step++) { const middle = (low + high) / 2; if (at(middle).meanGrassIndex < grade.meanGrassIndex) low = middle; else high = middle; }
  const strength = high, graded = new Float64Array(count * 3), result = shiftPixels(linear, weights, direction.map(value => value * strength), graded);
  const output = Buffer.alloc(count * 3);
  for (let i = 0; i < count * 3; i++) output[i] = Math.round(Math.max(0, Math.min(1, srgbFromLinear(graded[i]))) * 255);
  for (let i = 0; i < count; i++) if (weights[i] === 0) for (let c = 0; c < 3; c++) output[i * 3 + c] = pixels[i * channels + c];
  return { pixels: output, record: {
    method: 'living-sward grade v2: hard vegetation mask; one linear-chromaticity offset toward the photo\'s own strongest living greens; per-pixel linear luminance preserved; masked-out pixels bit-identical',
    reference: reference.map(value => round(value, 4)), referenceSelection: grade.reference,
    calibration: { quantity: '(G-R)/Y of the tile linear mean', target: grade.meanGrassIndex, minimum: grade.minimumGrassIndex, minimumSource: 'village ground atlas olive, shared/legacy/aethelgard/environment/ground-atlas.ts',
      source: round(grassIndex(sourceMean), 4), achieved: round(result.meanGrassIndex, 4), strength: round(strength, 4) },
    sourceVegetationCentre: centre.map(value => round(value, 4)), meanVegetationWeight: round(weightSum / count, 4), protectedPixelShare: round(protectedPixels / count, 4), clippedPixels: result.clipped,
    parameters: { mask: grade.mask, meanGrassIndex: grade.meanGrassIndex },
  } };
}

// ---------------------------------------------------------------------------
// Litter cooling (woodland floor) and bank roughness remap.
// ---------------------------------------------------------------------------

/** Every pixel moves `amount` of the way from the tile's mean chromaticity toward
 * an olive-grey (sRGB about 110,110,95), as one common linear-chromaticity offset
 * with per-pixel luminance restored: the warm autumn litter reads cooler and less
 * saturated without losing leaf structure. */
export const LITTER_COOLING = Object.freeze({ target: Object.freeze([.365, .365, .27]), amount: .28 });
export function coolLitter(pixels, width, height, channels = 3, cooling = LITTER_COOLING) {
  if (!pixels || pixels.length !== width * height * channels) throw Error('Litter cooling expects a complete buffer.');
  if (!(cooling.amount >= 0 && cooling.amount <= 1) || cooling.target.length !== 3 || Math.abs(cooling.target.reduce((a, b) => a + b, 0) - 1) > .001) throw Error('Invalid litter cooling.');
  const count = width * height, linear = new Float64Array(count * 3), mean = [0, 0, 0];
  for (let i = 0; i < count; i++) for (let c = 0; c < 3; c++) { const value = linearFromSrgb(pixels[i * channels + c] / 255); linear[i * 3 + c] = value; mean[c] += value; }
  const total = mean[0] + mean[1] + mean[2], centre = mean.map(value => value / total), shift = cooling.target.map((value, c) => (value - centre[c]) * cooling.amount);
  const weights = new Float32Array(count).fill(1), graded = new Float64Array(count * 3), result = shiftPixels(linear, weights, shift, graded), output = Buffer.alloc(count * 3);
  for (let i = 0; i < count * 3; i++) output[i] = Math.round(Math.max(0, Math.min(1, srgbFromLinear(graded[i]))) * 255);
  return { pixels: output, record: { method: 'litter cooling: common linear-chromaticity offset toward olive-grey; per-pixel luminance preserved', target: [...cooling.target], amount: cooling.amount,
    sourceCentre: centre.map(value => round(value, 4)), clippedPixels: result.clipped } };
}

/** Dry bank soil is matte: roughness' = 0.70 + 0.27 * source roughness (source mean
 * 0.546 -> about 0.85; range 0.70..0.97). The valley shader alone adds wet gloss
 * where shore wetness is high. AO and metallic stay as photographed. */
export const BANK_ROUGHNESS_REMAP = Object.freeze({ offset: .7, scale: .27 });
export function remapBankRoughness(pixels, remap = BANK_ROUGHNESS_REMAP) {
  if (!pixels || pixels.length % 3) throw Error('Bank roughness remap expects RGB ARM pixels.');
  const output = Buffer.from(pixels);
  for (let i = 1; i < output.length; i += 3) output[i] = Math.round(Math.min(1, remap.offset + remap.scale * pixels[i] / 255) * 255);
  return { pixels: output, record: { method: 'ARM green (roughness) remap; R (AO) and B (metallic) untouched', offset: remap.offset, scale: remap.scale } };
}

// ---------------------------------------------------------------------------
// Frozen official source identities (Poly Haven files API, read 2026-11-06).
// A changed official revision requires an intentional update here.
// ---------------------------------------------------------------------------

export const INTAKE_DATE = '2026-11-06';
export const USER_AGENT = 'Crownfall-ealdholt-ground-intake/2 (https://github.com/mylife-as-miles/Crownfall; offline CC0 asset preparation)';
const TEXTURE_URL = (id, file) => `https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/${id}/${file}`;
const layer = spec => Object.freeze({ ...spec, roles: Object.freeze([...spec.roles]), sources: Object.freeze(Object.fromEntries(Object.entries(spec.sources).map(([role, entry]) => [role, Object.freeze(entry)]))) });

/** The layers. `folder` is the new directory under the Aethelgard texture folder;
 * `prefix` starts every file name; `laasWeight` names the LAAS blend weight the
 * layer renders (shared/legacy/aethelgard/environment/laas-surface.ts); `roles`
 * lists the maps the valley shader samples; `committed: false` marks a layer that
 * is selected and reproducible but held back from the repository. Keep in step
 * with EALDHOLT_WOODLAND_GROUND_LAYERS in woodland-ground.ts. */
export const WOODLAND_GROUND_LAYERS = Object.freeze({
  meadow: layer({ folder: 'ground-meadow-v2', prefix: 'meadow', assetId: 'forrest_ground_01', name: 'Forest Ground 01', tileMetres: 2, laasWeight: 'grass', modification: 'living-sward', roles: ['albedo', 'normal'], committed: true,
    role: 'Green-dominant meadow sward: grass, straw, twigs and protected litter (albedo chroma graded, see modifications).',
    sources: {
      albedo: { key: 'Diffuse', file: 'forrest_ground_01_diff_1k.jpg', bytes: 833711, md5: '236e7d928f5e357a194fd92de189cbe4' },
      normal: { key: 'nor_gl', file: 'forrest_ground_01_nor_gl_1k.jpg', bytes: 1428763, md5: 'ba4265df25aea293913d004b69ef9ab0' },
      orm: { key: 'arm', file: 'forrest_ground_01_arm_1k.jpg', bytes: 296969, md5: '0bca8bef07d3c48faea4aae3fac9a757' },
    } }),
  woodland: layer({ folder: 'ground-woodland-floor-v2', prefix: 'woodland', assetId: 'forest_leaves_03', name: 'Forest Leaves 03', tileMetres: 2.3, laasWeight: 'forestFloor', modification: 'litter-cooling', roles: ['albedo'], committed: true,
    role: 'Woodland floor leaf litter, cooled toward olive-grey; the valley shader adds a living moss/herb term under canopy.',
    sources: {
      albedo: { key: 'Diffuse', file: 'forest_leaves_03_diff_1k.jpg', bytes: 1000751, md5: 'd407c7adebb2d943107eb91a30a9f909' },
      normal: { key: 'nor_gl', file: 'forest_leaves_03_nor_gl_1k.jpg', bytes: 1404719, md5: '2ab6164e4eb8116e9209c5af261f22a6' },
      orm: { key: 'arm', file: 'forest_leaves_03_arm_1k.jpg', bytes: 1044455, md5: 'cee4ef6c48848ffa09f818ab86367eab' },
    } }),
  path: layer({ folder: 'ground-path-v2', prefix: 'path', assetId: 'rock_path', name: 'Rock Path', tileMetres: 2, laasWeight: 'soil', modification: null, roles: ['albedo', 'normal', 'orm'], committed: false,
    role: 'Worn, low-saturation trodden earth with grit and small stones for paths and yards (held back until an in-situ village need is shown).',
    sources: {
      albedo: { key: 'Diffuse', file: 'rock_path_diff_1k.jpg', bytes: 905736, md5: 'a5959ba76b70266a8abc1f6a5f6a45f4' },
      normal: { key: 'nor_gl', file: 'rock_path_nor_gl_1k.jpg', bytes: 1286638, md5: '297904619ebbcf26b38cc1412595a617' },
      orm: { key: 'arm', file: 'rock_path_arm_1k.jpg', bytes: 868852, md5: 'bf785c25b0fe27c217507a6786f0ca4d' },
    } }),
  bank: layer({ folder: 'ground-bank-v2', prefix: 'bank', assetId: 'brown_mud_rocks_01', name: 'Brown Mud Rocks 01', tileMetres: 1.3, laasWeight: 'soil-wet', modification: 'bank-roughness', roles: ['albedo', 'normal', 'orm'], committed: true,
    role: 'Exposed riverbank: brown mud with loose stones and scattered weeds (matte when dry; the shader adds wet gloss at the waterline).',
    sources: {
      albedo: { key: 'Diffuse', file: 'brown_mud_rocks_01_diff_1k.jpg', bytes: 887215, md5: '19e4d0066282bd8439bdc713310bbbe4' },
      normal: { key: 'nor_gl', file: 'brown_mud_rocks_01_nor_gl_1k.jpg', bytes: 1400087, md5: 'aea4a53ff5a38070e7dbda4feb81a0b9' },
      orm: { key: 'arm', file: 'brown_mud_rocks_01_arm_1k.jpg', bytes: 514636, md5: '05bdb8c8ebb8e53e09a1207b48fc0abf' },
    } }),
});

const ROLES = Object.freeze(['albedo', 'normal', 'orm']);
const PROFILES = Object.freeze(['desktop', 'quest']);
const CC0_LICENCE_URL = 'https://creativecommons.org/publicdomain/zero/1.0/';
const LICENCE_FILES = Object.freeze({ 'licenses/CC0-1.0-legalcode.txt': 'https://creativecommons.org/publicdomain/zero/1.0/legalcode.txt', 'licenses/polyhaven-license.html': 'https://polyhaven.com/license' });

/** Map size per profile and role (Quest data maps follow the earth/rock set at 256 px). */
export function woodlandGroundMapSize(profile, role) {
  if (!PROFILES.includes(profile) || !ROLES.includes(role)) throw Error('Invalid woodland ground profile or role.');
  return profile === 'desktop' ? 1024 : role === 'albedo' ? 512 : 256;
}
export function woodlandGroundMipBytes(size) {
  if (size !== 256 && size !== 512 && size !== 1024) throw Error('Invalid woodland ground size.');
  let bytes = 0; for (let level = size; level >= 1; level /= 2) bytes += level * level * 4; return bytes;
}

/** Verifies one official download against the frozen identity and the files API snapshot. */
export function verifyWoodlandGroundSource(bytes, apiEntry, layerName, role) {
  const spec = WOODLAND_GROUND_LAYERS[layerName], expected = spec?.sources[role];
  if (!expected) throw Error('Unknown woodland ground layer or role.');
  const url = TEXTURE_URL(spec.assetId, expected.file);
  if (!Buffer.isBuffer(bytes) || apiEntry?.url !== url || apiEntry.size !== expected.bytes || apiEntry.md5 !== expected.md5
    || bytes.length !== expected.bytes || hash(bytes, 'md5') !== expected.md5) throw Error(`Woodland ground ${layerName} ${role}: official URL, size or fixed MD5 mismatch.`);
  return { url, bytes: bytes.length, md5: expected.md5, sha256: hash(bytes) };
}

/** Asset-level licence evidence: the official asset page declares CC0 1.0. */
export function verifyAssetPageLicence(page, assetId) {
  const text = Buffer.isBuffer(page) ? page.toString('utf8') : String(page);
  if (!text.includes(`"license":"${CC0_LICENCE_URL}"`) || !text.includes('CC0 1.0 Universal') || !text.includes(assetId)) throw Error(`Asset page for ${assetId} does not declare CC0 1.0.`);
  return { url: `https://polyhaven.com/a/${assetId}`, bytes: Buffer.byteLength(text), sha256: hash(Buffer.from(text)), statement: `"license":"${CC0_LICENCE_URL}"` };
}

/** Builds the private intake layout from Poly Haven with a unique User-Agent:
 * metadata/<id>-{info,files}.json, pages/<id>.html, licenses/*, source/<1k JPGs>.
 * Every download is checked against the live files API and the frozen identity
 * (URL, size, MD5) before it is written; nothing is written into the repository. */
export async function fetchEaldholtWoodlandGroundIntake(intakeDirectory, layers = Object.keys(WOODLAND_GROUND_LAYERS), fetcher = globalThis.fetch) {
  const root = resolve(intakeDirectory);
  if (!layers.length || layers.some(name => !WOODLAND_GROUND_LAYERS[name])) throw Error('Unknown woodland ground layer.');
  const get = async url => { const response = await fetcher(url, { headers: { 'User-Agent': USER_AGENT } }); if (!response.ok) throw Error(`${url}: HTTP ${response.status}`); return Buffer.from(await response.arrayBuffer()); };
  for (const folder of ['metadata', 'pages', 'licenses', 'source']) await mkdir(join(root, folder), { recursive: true });
  const written = [];
  for (const [file, url] of Object.entries(LICENCE_FILES)) { const bytes = await get(url); await writeFile(join(root, file), bytes); written.push({ file, url, bytes: bytes.length, sha256: hash(bytes) }); }
  for (const name of layers) {
    const spec = WOODLAND_GROUND_LAYERS[name], info = await get(`https://api.polyhaven.com/info/${spec.assetId}`), files = await get(`https://api.polyhaven.com/files/${spec.assetId}`), page = await get(`https://polyhaven.com/a/${spec.assetId}`);
    const parsed = JSON.parse(files);
    verifyAssetPageLicence(page, spec.assetId);
    for (const role of ROLES) {
      const expected = spec.sources[role], api = parsed[expected.key]?.['1k']?.jpg, bytes = await get(TEXTURE_URL(spec.assetId, expected.file));
      verifyWoodlandGroundSource(bytes, api, name, role);
      await writeFile(join(root, 'source', expected.file), bytes); written.push({ file: `source/${expected.file}`, url: api.url, bytes: bytes.length, md5: api.md5 });
    }
    await writeFile(join(root, 'metadata', `${spec.assetId}-info.json`), info); await writeFile(join(root, 'metadata', `${spec.assetId}-files.json`), files); await writeFile(join(root, 'pages', `${spec.assetId}.html`), page);
  }
  return { userAgent: USER_AGENT, files: written };
}

async function decodeJpeg(bytes, channels = 3) {
  const image = sharp(bytes), result = channels === 1 ? image.greyscale() : image.removeAlpha();
  const { data, info } = await result.raw().toBuffer({ resolveWithObject: true });
  if (info.width !== 1024 || info.height !== 1024 || info.channels !== channels) throw Error('Expected an official 1024 px source map.');
  return data;
}
const asValues = rgb => ({ size: 1024, values: Float32Array.from(rgb, value => value / 255) });

function analysis(pixels, size, channels) {
  const s = measureGroundAlbedo(pixels, size, size, channels);
  return { meanLuminance: s.meanLuminance, meanSrgb8: s.meanSrgb8, meanColourHue: s.meanColourHue, meanSaturation: s.meanSaturation,
    shares: s.shares, luminanceWeightedShares: s.luminanceWeightedShares, luminancePercentiles: s.luminancePercentiles,
    linearChromaticity: s.linearChromaticity, valleyGrassIndex: s.valleyGrassIndex, macroVariation: s.macroVariation, macroLuminanceVariation16: s.macroLuminanceVariation16,
    macroChromaVariation8: s.macroChromaVariation8, macroChromaVariation16: s.macroChromaVariation16 };
}

function sourcesText(spec, entry, modification) {
  const sizes = PROFILES.map(profile => `${profile} ${spec.roles.map(role => `${role} ${woodlandGroundMapSize(profile, role)} px`).join(', ')}`).join('; ');
  return `# ${spec.name} — Ealdholt ${spec.prefix} ground layer\n\n`
    + `Powered by Poly Haven. ${spec.name} — ${Object.keys(entry.authors).join(', ')}: https://polyhaven.com/a/${spec.assetId} . CC0-1.0; official licence https://polyhaven.com/license ; the asset page declares CC0 1.0 Universal. Legal code is included in CC0-1.0.txt.\n\n`
    + `${spec.role} Photographed as a ${spec.tileMetres} m tile. Intake date ${INTAKE_DATE}. Maps (only those the valley shader samples): ${sizes}. sRGB albedo, OpenGL normals (renormalized) and linear ARM (R=AO, G=roughness, B=metallic) stay aligned; configure flipY=false.\n\n`
    + `Modifications: ${modification}\n\n`
    + `Source URLs, fixed official MD5/size checks, source and derived SHA-256 hashes, licence evidence and processing are in provenance.json and manifest.json. Original downloads remain outside the repository. Reproduce with node scripts/prepare-ealdholt-woodland-ground.mjs fetch PRIVATE_INTAKE_DIRECTORY, then node scripts/prepare-ealdholt-woodland-ground.mjs prepare PRIVATE_INTAKE_DIRECTORY OUTPUT_PARENT_DIRECTORY . Full mip-chain RGBA8 byte figures are estimates, not GPU or headset measurements. Nothing loads at runtime unless an integration explicitly requests this folder.\n`;
}

/** Prepares every requested layer in memory, then writes each NEW folder
 * exclusively. Fails before writing if any destination folder already exists.
 * Held-back layers are prepared only when `includeHeldBack` is set. */
export async function prepareEaldholtWoodlandGround(intakeDirectory, outputParent, layers, options = {}) {
  const input = resolve(intakeDirectory), parent = resolve(outputParent);
  if (input === parent || parent.startsWith(input + '/') || input.startsWith(parent + '/')) throw Error('Use an output parent separate from the private intake.');
  const names = layers ?? Object.keys(WOODLAND_GROUND_LAYERS).filter(name => WOODLAND_GROUND_LAYERS[name].committed || options.includeHeldBack);
  if (!names.length || names.some(name => !WOODLAND_GROUND_LAYERS[name]) || new Set(names).size !== names.length) throw Error('Unknown or repeated woodland ground layer.');
  if (names.some(name => !WOODLAND_GROUND_LAYERS[name].committed) && !options.includeHeldBack) throw Error('A held-back layer needs --include-held-back.');
  for (const name of names) {
    const exists = await access(join(parent, WOODLAND_GROUND_LAYERS[name].folder)).then(() => true, () => false);
    if (exists) throw Error(`Refusing to overwrite existing ${WOODLAND_GROUND_LAYERS[name].folder}.`);
  }
  const [licence, licencePage] = await Promise.all(Object.keys(LICENCE_FILES).map(file => readFile(join(input, file))));
  if (!licence.includes('CC0 1.0 Universal') || !licencePage.includes('Our assets are all licensed as') || !licencePage.includes('CC0')) throw Error('Missing official CC0 evidence.');
  const licenceRecord = { spdx: 'CC0-1.0', officialUrl: 'https://polyhaven.com/license', legalCodeUrl: 'https://creativecommons.org/publicdomain/zero/1.0/legalcode.txt',
    officialPageSha256: hash(licencePage), legalCodeSha256: hash(licence), quote: 'Our assets are all licensed as CC0', credit: 'Powered by Poly Haven' };

  const prepared = [];
  for (const name of names) {
    const spec = WOODLAND_GROUND_LAYERS[name];
    const [infoBytes, filesBytes, page] = await Promise.all([`metadata/${spec.assetId}-info.json`, `metadata/${spec.assetId}-files.json`, `pages/${spec.assetId}.html`].map(file => readFile(join(input, file))));
    const info = JSON.parse(infoBytes), files = JSON.parse(filesBytes);
    if (info.type !== 1 || info.name !== spec.name || !info.authors || !Array.isArray(info.dimensions) || info.dimensions.length !== 2
      || info.dimensions.some(value => Math.abs(value / 1000 - spec.tileMetres) > .01)) throw Error(`Unexpected official identity or tile size for ${spec.assetId}.`);
    const pageRecord = verifyAssetPageLicence(page, spec.assetId), sources = {}, decoded = {};
    for (const role of ROLES) {
      const expected = spec.sources[role], bytes = await readFile(join(input, 'source', expected.file));
      sources[role] = verifyWoodlandGroundSource(bytes, files[expected.key]?.['1k']?.jpg, name, role);
      decoded[role] = await decodeJpeg(bytes); sources[role].decodedRgbSha256 = hash(decoded[role]);
      if (!spec.roles.includes(role)) sources[role].note = 'Verified for provenance; the valley shader samples no map of this role for this layer, so none is prepared.';
    }
    const sourceAnalysis = analysis(decoded.albedo, 1024, 3);
    let modification = 'None. Every map is the decoded official JPEG at 1024 px (linear-light box reduction for Quest).', modificationRecord = null;
    if (spec.modification === 'living-sward') {
      // `meadowGrassIndex` exists for documented calibration candidates only; committed folders use the constant.
      const grade = options.meadowGrassIndex === undefined ? LIVING_SWARD_GRADE : Object.freeze({ ...LIVING_SWARD_GRADE, meanGrassIndex: options.meadowGrassIndex });
      const graded = gradeLivingSward(decoded.albedo, 1024, 1024, 3, grade); decoded.albedo = graded.pixels; modificationRecord = { albedo: graded.record };
      modification = `Albedo chroma graded (living-sward v2): a hard vegetation mask selects blades and straw; they move by one linear-chromaticity offset toward the photo's own strongest living greens until the tile mean (G-R)/Y is ${grade.meanGrassIndex} (no lower than the village atlas olive ${grade.minimumGrassIndex}); per-pixel linear luminance preserved; litter, soil, twigs and crevices bit-identical. Normal map unmodified.`;
    } else if (spec.modification === 'litter-cooling') {
      const cooled = coolLitter(decoded.albedo, 1024, 1024, 3); decoded.albedo = cooled.pixels; modificationRecord = { albedo: cooled.record };
      modification = `Albedo litter cooled: every pixel moves ${LITTER_COOLING.amount} of the way from the tile's mean chromaticity toward olive-grey, with per-pixel linear luminance preserved.`;
    } else if (spec.modification === 'bank-roughness') {
      const remapped = remapBankRoughness(decoded.orm); decoded.orm = remapped.pixels; modificationRecord = { orm: remapped.record };
      modification = `ARM roughness remapped to ${BANK_ROUGHNESS_REMAP.offset} + ${BANK_ROUGHNESS_REMAP.scale} x source (dry bank soil is matte; the shader adds wet gloss). AO, metallic, albedo and normal unmodified.`;
    } else if (spec.modification !== null) throw Error('Unknown modification.');
    const record = { layer: name, spec, info, profiles: {}, sources, sourceAnalysis, modificationRecord, modification, pageRecord, infoBytes, filesBytes, outputs: [] };
    for (const profile of PROFILES) {
      const entry = { meanLuminance: 0, files: {}, gpuBytesWithMipsEstimate: 0 };
      for (const role of spec.roles) {
        const size = woodlandGroundMapSize(profile, role), pixels = reducePhotographicMap(asValues(decoded[role]), size, role === 'orm' ? 'data' : role);
        if (size === 1024 && role !== 'normal') {
          const rgb = Buffer.alloc(size * size * 3); for (let i = 0; i < size * size; i++) for (let c = 0; c < 3; c++) rgb[i * 3 + c] = pixels[i * 4 + c];
          if (!rgb.equals(decoded[role])) throw Error('1024 px colour and data maps must keep their prepared values.');
        }
        const bytes = await sharp(Buffer.from(pixels), { raw: { width: size, height: size, channels: 4 } }).removeAlpha().webp({ lossless: true, effort: 6 }).toBuffer();
        const check = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
        if (check.info.width !== size || check.info.height !== size || !check.data.equals(Buffer.from(pixels))) throw Error('Lossless WebP round trip mismatch.');
        if (role === 'albedo') { entry.meanLuminance = meanLinearLuminance(pixels); if (profile === 'desktop') entry.analysis = analysis(pixels, size, 4); }
        const file = `${spec.prefix}-${profile}-${role}-${size}.webp`, fileRecord = { file, size, bytes: bytes.length, sha256: hash(bytes) };
        entry.files[role] = fileRecord; entry.gpuBytesWithMipsEstimate += woodlandGroundMipBytes(size); record.outputs.push({ file, bytes, record: fileRecord });
      }
      record.profiles[profile] = entry;
    }
    prepared.push(record);
  }

  for (const record of prepared) {
    const { spec } = record, folder = join(parent, spec.folder);
    const manifest = { version: 2, set: 'ealdholt-woodland-ground', layer: record.layer, assetId: spec.assetId, name: spec.name, sourceUrl: `https://polyhaven.com/a/${spec.assetId}`,
      licence: 'CC0-1.0', authors: record.info.authors, tileMetres: spec.tileMetres, laasWeight: spec.laasWeight, modified: spec.modification !== null, intakeDate: INTAKE_DATE,
      roles: [...spec.roles],
      colour: { albedo: spec.modification === 'living-sward' || spec.modification === 'litter-cooling' ? 'sRGB RGB; opaque; chroma graded as recorded in provenance.json, luminance photographic' : 'sRGB RGB; opaque, untinted source photograph',
        normal: 'OpenGL tangent-space +Y; linear; vectors renormalized', orm: spec.modification === 'bank-roughness' ? 'Linear R=source AO, G=remapped roughness (provenance.json), B=source metallic' : 'Linear R=source AO, G=source roughness, B=source metallic',
        orientation: 'Source rows preserved; configure flipY=false for every map' },
      profiles: record.profiles };
    const evidence = { assetId: spec.assetId, name: spec.name, layer: record.layer, intakeDate: INTAKE_DATE, licence: { ...licenceRecord, assetPage: record.pageRecord },
      sourceUrl: manifest.sourceUrl, authors: record.info.authors, infoApi: `https://api.polyhaven.com/info/${spec.assetId}`, filesApi: `https://api.polyhaven.com/files/${spec.assetId}`,
      infoSha256: hash(record.infoBytes), filesSha256: hash(record.filesBytes), sources: record.sources,
      modifications: record.modification, modificationRecord: record.modificationRecord, sourceAnalysis: record.sourceAnalysis,
      processing: 'Decoded official 8-bit JPEG RGB directly. Linear-light box reduction for albedo; linear ARM reduction; normal vectors averaged and renormalized. Deterministic lossless WebP (effort 6) verified by exact decode. Opaque surface; no geometry, displacement or alpha blades.',
      tools: { generator: 'scripts/prepare-ealdholt-woodland-ground.mjs', node: process.version, sharp: sharp.versions },
      files: record.outputs.map(output => output.record) };
    const legal = licence, manifestText = JSON.stringify(manifest, null, 2) + '\n', sourcesMd = sourcesText(spec, record.info, record.modification);
    evidence.files.push({ file: 'CC0-1.0.txt', bytes: legal.length, sha256: hash(legal) }, { file: 'manifest.json', bytes: Buffer.byteLength(manifestText), sha256: hash(Buffer.from(manifestText)) },
      { file: 'SOURCES.md', bytes: Buffer.byteLength(sourcesMd), sha256: hash(Buffer.from(sourcesMd)) });
    await mkdir(folder, { recursive: false });
    for (const output of record.outputs) await writeFile(join(folder, output.file), output.bytes, { flag: 'wx' });
    await writeFile(join(folder, 'CC0-1.0.txt'), legal, { flag: 'wx' });
    await writeFile(join(folder, 'manifest.json'), manifestText, { flag: 'wx' });
    await writeFile(join(folder, 'SOURCES.md'), sourcesMd, { flag: 'wx' });
    await writeFile(join(folder, 'provenance.json'), JSON.stringify(evidence, null, 2) + '\n', { flag: 'wx' });
  }
  return Object.fromEntries(prepared.map(record => [record.layer, { folder: record.spec.folder, profiles: record.profiles }]));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2), includeHeldBack = args.includes('--include-held-back'), positional = args.filter(arg => arg !== '--include-held-back');
  const usage = () => { console.error('Usage: node scripts/prepare-ealdholt-woodland-ground.mjs fetch PRIVATE_INTAKE_DIRECTORY\n       node scripts/prepare-ealdholt-woodland-ground.mjs prepare PRIVATE_INTAKE_DIRECTORY OUTPUT_PARENT_DIRECTORY [meadow woodland bank path] [--include-held-back]'); process.exitCode = 1; };
  const command = positional[0];
  if (command === 'fetch' && positional.length >= 2) fetchEaldholtWoodlandGroundIntake(positional[1], positional.length > 2 ? positional.slice(2) : undefined)
    .then(result => console.log(JSON.stringify({ userAgent: result.userAgent, files: result.files.length })))
    .catch(error => { console.error(error.stack ?? error.message); process.exitCode = 1; });
  else if (command === 'prepare' && positional.length >= 3) prepareEaldholtWoodlandGround(positional[1], positional[2], positional.length > 3 ? positional.slice(3) : undefined, { includeHeldBack })
    .then(result => console.log(JSON.stringify(Object.fromEntries(Object.entries(result).map(([name, value]) => [name, { folder: value.folder,
      desktop: value.profiles.desktop.meanLuminance, quest: value.profiles.quest.meanLuminance }])))))
    .catch(error => { console.error(error.stack ?? error.message); process.exitCode = 1; });
  else usage();
}
