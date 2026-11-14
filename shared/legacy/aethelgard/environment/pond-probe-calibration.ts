import { EALDHOLT_POND_PROBE, ealdholtProbeDirection, type EaldholtPondProbeProfile } from './pond-probe';

export type EaldholtProbeCardinal = '+X' | '-X' | '+Y' | '-Y' | '+Z' | '-Z';
/** Original diagnostic radiance only. No private scene or source pixels. */
export const EALDHOLT_PROBE_CARDINAL_RADIANCE: Readonly<Record<EaldholtProbeCardinal, readonly [number, number, number]>> = {
  '+X': [2, .04, .04], '-X': [.04, 2, 2], '+Y': [.04, 2, .04],
  '-Y': [2, .04, 2], '+Z': [.04, .04, 2], '-Z': [2, 2, .04],
};

export function createEaldholtCardinalProbePixels(profile: EaldholtPondProbeProfile = 'quest'): { width: number; height: number; data: Float32Array } {
  const { width, height } = EALDHOLT_POND_PROBE[profile], data = new Float32Array(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const direction = ealdholtProbeDirection((x + .5) / width, (y + .5) / height);
    let axis = 0; if (Math.abs(direction[1]) > Math.abs(direction[axis])) axis = 1; if (Math.abs(direction[2]) > Math.abs(direction[axis])) axis = 2;
    const cardinal = ((direction[axis] >= 0 ? '+' : '-') + ['X', 'Y', 'Z'][axis]) as EaldholtProbeCardinal;
    const rgb = EALDHOLT_PROBE_CARDINAL_RADIANCE[cardinal], offset = (y * width + x) * 4;
    data[offset] = rgb[0]; data[offset + 1] = rgb[1]; data[offset + 2] = rgb[2]; data[offset + 3] = 1;
  }
  return { width, height, data };
}

export function scoreEaldholtCardinalProbeSample(rgb: readonly [number, number, number], expected: EaldholtProbeCardinal): {
  normalized: readonly [number, number, number]; maximumChannelError: number; passed: boolean;
} {
  if (rgb.some(value => !Number.isFinite(value) || value < 0)) throw Error('Cardinal GPU readback is invalid.');
  const peak = Math.max(...rgb), target = EALDHOLT_PROBE_CARDINAL_RADIANCE[expected];
  const normalized = rgb.map(value => peak ? value / peak : 0) as [number, number, number];
  const maximumChannelError = Math.max(...normalized.map((value, channel) => Math.abs(value - target[channel] / 2)));
  return { normalized, maximumChannelError, passed: peak > .02 && maximumChannelError < .08 };
}
