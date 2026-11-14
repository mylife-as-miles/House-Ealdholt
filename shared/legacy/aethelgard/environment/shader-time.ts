/** Shader animation time (audit L-19). The village's animation seconds are the
 * age of the save: a 32-bit float uniform steps by 0.0625 s at seven days and
 * 0.25 s at thirty, so wind, rain and the river stutter more as a save ages.
 * Wind, ripples and rain are cosmetic phases, so shaders get time relative to
 * an hour-aligned epoch taken at the first reading in a session; JavaScript
 * consumers that need world time (cloud drift) keep the double. The epoch moves
 * again only after `rebaseSeconds` of continuous play or a clock rewind (one
 * phase step, at most every four hours by default). */
export const SHADER_TIME_EPOCH_STEP_SECONDS = 3600;
export function createShaderTime(rebaseSeconds = 4 * 3600) {
  let epoch = Number.NaN;
  return {
    /** Seconds for a shader uniform; 0 stays 0 (reduced motion). */
    seconds(worldSeconds: number): number {
      if (!Number.isFinite(worldSeconds) || worldSeconds === 0) return 0;
      const relative = worldSeconds - epoch;
      if (!(relative >= 0 && relative < rebaseSeconds)) {
        epoch = Math.floor(worldSeconds / SHADER_TIME_EPOCH_STEP_SECONDS) * SHADER_TIME_EPOCH_STEP_SECONDS;
        return worldSeconds - epoch;
      }
      return relative;
    },
    get epoch() { return epoch; },
  };
}
