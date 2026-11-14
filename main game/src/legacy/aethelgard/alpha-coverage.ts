/** Preserve a cutout's measured base-level coverage through minification.
 * This changes alpha only. The caller supplies normally filtered RGB/alpha;
 * the source cutoff and all RGB bytes are retained. */
export function alphaCoverage(pixels: Uint8ClampedArray, cutoff: number): number {
  if (pixels.length === 0 || pixels.length % 4 || !Number.isFinite(cutoff) || cutoff <= 0 || cutoff > 1) {
    throw new RangeError("A cutout needs RGBA pixels and a cutoff in (0, 1].");
  }
  let covered = 0;
  for (let index = 3; index < pixels.length; index += 4) if (pixels[index] / 255 >= cutoff) covered++;
  return covered / (pixels.length / 4);
}

export interface AlphaCoverageCorrection {
  pixels: Uint8ClampedArray;
  scale: number;
  coverage: number;
  uncorrectedCoverage: number;
  targetCoverage: number;
  absoluteError: number;
  pixelCount: number;
}

export function preserveAlphaCoverage(
  pixels: Uint8ClampedArray,
  cutoff: number,
  targetCoverage: number,
): AlphaCoverageCorrection {
  const uncorrectedCoverage = alphaCoverage(pixels, cutoff);
  if (!Number.isFinite(targetCoverage) || targetCoverage < 0 || targetCoverage > 1) {
    throw new RangeError("Target coverage must be in [0, 1].");
  }
  const pixelCount = pixels.length / 4;
  const cutoffByte = Math.ceil(cutoff * 255);
  const histogram = new Uint32Array(256), suffix = new Uint32Array(257);
  for (let index = 3; index < pixels.length; index += 4) histogram[pixels[index]]++;
  for (let alpha = 255; alpha >= 0; alpha--) suffix[alpha] = suffix[alpha + 1] + histogram[alpha];
  let scale = 1, error = Math.abs(uncorrectedCoverage - targetCoverage);
  if (targetCoverage < error) { scale = 0; error = targetCoverage; }
  // Each nonzero histogram bin is a possible alpha boundary. Testing those
  // boundaries finds the closest achievable coverage without an image-sized
  // binary-search loop. Zero-alpha texels always remain transparent.
  for (let boundary = 1; boundary <= 255; boundary++) {
    const candidateScale = (cutoffByte - .5 + 1e-7) / boundary;
    const threshold = Math.max(1, Math.min(256, Math.ceil((cutoffByte - .5) / candidateScale)));
    const candidateError = Math.abs(suffix[threshold] / pixelCount - targetCoverage);
    if (candidateError < error - 1e-12 || (Math.abs(candidateError - error) < 1e-12 && Math.abs(Math.log(candidateScale)) < Math.abs(Math.log(scale)))) {
      scale = candidateScale;
      error = candidateError;
    }
  }
  const result = pixels.slice();
  for (let index = 3; index < result.length; index += 4) result[index] = Math.min(255, Math.round(result[index] * scale));
  const coverage = alphaCoverage(result, cutoff);
  return { pixels: result, scale, coverage, uncorrectedCoverage, targetCoverage,
    absoluteError: Math.abs(coverage - targetCoverage), pixelCount };
}
