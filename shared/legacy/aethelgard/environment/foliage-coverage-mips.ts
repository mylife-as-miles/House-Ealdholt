export interface FoliageCoverageMipLevel {
  readonly width: number;
  readonly height: number;
  readonly rgba: Uint8Array;
  readonly coveredPixels: number;
  readonly targetCoveredPixels: number;
  readonly coverage: number;
  /** Signed difference from base coverage; tiny levels have unavoidable pixel quantization. */
  readonly coverageError: number;
  readonly alphaScale: number;
  readonly adjustedAlphaPixels: number;
  readonly boundaryCorrections: number;
}

export interface FoliageCoverageMipChain {
  readonly levels: readonly FoliageCoverageMipLevel[];
  readonly baseCoverage: number;
  readonly alphaCutoff: number;
  readonly totalByteLength: number;
}

const linearSrgb = Float64Array.from({ length: 256 }, (_, byte) => {
  const value = byte / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
});

function srgbByte(value: number): number {
  const encoded = value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055;
  return Math.max(0, Math.min(255, Math.round(encoded * 255)));
}

function validate(rgba: Uint8Array, width: number, height: number, alphaCutoff: number): void {
  if (!(rgba instanceof Uint8Array)) throw new TypeError('Foliage mip input must be RGBA8 bytes.');
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0
    || !Number.isSafeInteger(width * height * 4) || rgba.length !== width * height * 4) {
    throw new RangeError('Foliage mip dimensions must match the RGBA8 byte length.');
  }
  if (!Number.isFinite(alphaCutoff) || alphaCutoff < 0 || alphaCutoff > 1) {
    throw new RangeError('Foliage alpha cutoff must be finite and between zero and one.');
  }
}

function covered(rgba: Uint8Array, cutoff: number): number {
  let count = 0;
  for (let i = 3; i < rgba.length; i += 4) if (rgba[i] / 255 >= cutoff) count++;
  return count;
}

/** Area-box filtering supports odd dimensions without discarding an edge row.
 * Inputs are straight/unassociated sRGB RGBA8. Filter RGB in linear light,
 * premultiplied by alpha, then unpremultiply before encoding sRGB again.
 * Filter each level from the unchanged base so alpha corrections never feed
 * back into later RGB or erase faint support through intermediate rounding. */
function downsample(source: FoliageCoverageMipLevel, width: number, height: number): { width: number; height: number; rgba: Uint8Array; alpha: Float64Array } {
  const rgba = new Uint8Array(width * height * 4), alpha = new Float64Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const x0 = x * source.width / width, x1 = (x + 1) * source.width / width;
    const y0 = y * source.height / height, y1 = (y + 1) * source.height / height;
    let red = 0, green = 0, blue = 0, totalAlpha = 0;
    for (let sy = Math.floor(y0); sy < Math.ceil(y1); sy++) for (let sx = Math.floor(x0); sx < Math.ceil(x1); sx++) {
      const weight = (Math.min(x1, sx + 1) - Math.max(x0, sx)) * (Math.min(y1, sy + 1) - Math.max(y0, sy));
      const at = (sy * source.width + sx) * 4, weightedAlpha = weight * source.rgba[at + 3] / 255;
      red += linearSrgb[source.rgba[at]] * weightedAlpha;
      green += linearSrgb[source.rgba[at + 1]] * weightedAlpha;
      blue += linearSrgb[source.rgba[at + 2]] * weightedAlpha;
      totalAlpha += weightedAlpha;
    }
    const pixel = y * width + x, at = pixel * 4;
    if (totalAlpha > 0) {
      rgba[at] = srgbByte(red / totalAlpha);
      rgba[at + 1] = srgbByte(green / totalAlpha);
      rgba[at + 2] = srgbByte(blue / totalAlpha);
    }
    alpha[pixel] = totalAlpha / ((x1 - x0) * (y1 - y0));
    rgba[at + 3] = Math.max(0, Math.min(255, Math.round(alpha[pixel] * 255)));
  }
  return { width, height, rgba, alpha };
}

function preserveCoverage(level: ReturnType<typeof downsample>, baseCoverage: number, cutoff: number): FoliageCoverageMipLevel {
  const pixels = level.width * level.height, targetCoveredPixels = Math.round(baseCoverage * pixels);
  const originalAlpha = Uint8Array.from(level.rgba.filter((_, i) => i % 4 === 3));
  let alphaScale = 1, boundaryCorrections = 0;
  if (cutoff > 0 && covered(level.rgba, cutoff) !== targetCoveredPixels) {
    let threshold = 0;
    while (threshold / 255 < cutoff) threshold++;
    const order = Uint32Array.from({ length: pixels }, (_, i) => i);
    order.sort((a, b) => level.alpha[b] - level.alpha[a] || a - b);
    // Retain floating alpha until this decision: rounding a very faint but
    // nonzero downsample to RGBA8 first could erase its source support.
    if (targetCoveredPixels > 0) {
      const boundary = level.alpha[order[targetCoveredPixels - 1]];
      if (!(boundary > 0)) throw new Error('Requested foliage coverage exceeds the nontransparent mip support.');
      alphaScale = threshold / (boundary * 255);
    } else {
      const maximum = level.alpha[order[0]];
      alphaScale = maximum > 0 ? Math.min(1, (threshold - 1) / (maximum * 255)) : 1;
    }
    for (let rank = 0; rank < pixels; rank++) {
      const pixel = order[rank], at = pixel * 4 + 3;
      let alpha = Math.max(0, Math.min(255, Math.round(level.alpha[pixel] * alphaScale * 255)));
      // A uniform scale can straddle an RGBA8 tie. Resolve only threshold
      // boundary pixels, in deterministic source order, to the nearest count.
      if (rank < targetCoveredPixels && alpha < threshold) { alpha = threshold; boundaryCorrections++; }
      else if (rank >= targetCoveredPixels && alpha >= threshold) { alpha = threshold - 1; boundaryCorrections++; }
      level.rgba[at] = alpha;
    }
  }
  const coveredPixels = covered(level.rgba, cutoff);
  let adjustedAlphaPixels = 0;
  for (let i = 0; i < pixels; i++) if (originalAlpha[i] !== level.rgba[i * 4 + 3]) adjustedAlphaPixels++;
  if (coveredPixels !== targetCoveredPixels) throw new Error('Foliage mip coverage did not reach its nearest representable count.');
  return Object.freeze({ width: level.width, height: level.height, rgba: level.rgba, coveredPixels, targetCoveredPixels,
    coverage: coveredPixels / pixels, coverageError: coveredPixels / pixels - baseCoverage,
    alphaScale, adjustedAlphaPixels, boundaryCorrections });
}

/** Build an owned chain without mutating the source or consulting browser/Three
 * state. Base RGBA bytes are cloned exactly. Only lower-level alpha is changed
 * after linear-premultiplied RGB filtering; the material cutoff is unchanged.
 * Coverage targets the nearest integer pixel count, so error is at most
 * 0.5/(width*height), including the unavoidable final 1x1 decision. */
export function buildFoliageCoverageMipmaps(rgba: Uint8Array, width: number, height: number, alphaCutoff: number): FoliageCoverageMipChain {
  validate(rgba, width, height, alphaCutoff);
  const bytes = new Uint8Array(rgba), baseCovered = covered(bytes, alphaCutoff), baseCoverage = baseCovered / (width * height);
  const levels: FoliageCoverageMipLevel[] = [Object.freeze({ width, height, rgba: bytes,
    coveredPixels: baseCovered, targetCoveredPixels: baseCovered, coverage: baseCoverage, coverageError: 0,
    alphaScale: 1, adjustedAlphaPixels: 0, boundaryCorrections: 0 })];
  while (levels[levels.length - 1].width > 1 || levels[levels.length - 1].height > 1) {
    const previous = levels[levels.length - 1];
    levels.push(preserveCoverage(downsample(levels[0], Math.max(1, Math.floor(previous.width / 2)), Math.max(1, Math.floor(previous.height / 2))), baseCoverage, alphaCutoff));
  }
  return Object.freeze({ levels: Object.freeze(levels), baseCoverage, alphaCutoff,
    totalByteLength: levels.reduce((sum, level) => sum + level.rgba.byteLength, 0) });
}
