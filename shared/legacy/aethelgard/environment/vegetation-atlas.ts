/** Per-view alpha-weighted filtering and coverage-preserving mipmaps, adapted
 * from BakedVoxelLighting atlas-worker.js (MIT). Views filter independently;
 * the shader clamps its LOD before a pixel can blend different captures. */
export interface VegetationAtlasMip { width: number; height: number; colour: Uint8Array; normal: Uint8Array }
export interface VegetationAtlasRecord {
  schema: 1; views: 8 | 16; tileSize: number; columns: 4; rows: number;
  centre: readonly [number, number, number]; extent: readonly [number, number];
  mips: VegetationAtlasMip[]; coverage?: readonly number[];
}
/** Count the actual rectangular RGBA colour+normal mip chain. The common
 * baseBytes * 4/3 estimate undercounts the final 2x1/1x1 levels of eight views. */
export function vegetationAtlasByteLength(tileSize: number, views: 8 | 16): number {
  if (![32, 64, 128, 256].includes(tileSize) || ![8, 16].includes(views)) throw Error('Invalid vegetation atlas layout.');
  let width = tileSize * 4, height = tileSize * views / 4, bytes = 0;
  for (;;) {
    bytes += width * height * 8;
    if (width === 1 && height === 1) return bytes;
    width = Math.max(1, width >> 1); height = Math.max(1, height >> 1);
  }
}
function coverage(data: Uint8Array, width: number, ox: number, oy: number, size: number, cutoff: number) {
  let hit = 0;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (data[((y + oy) * width + x + ox) * 4 + 3] >= cutoff) hit++;
  return hit / (size * size);
}
function correctCoverage(data: Uint8Array, width: number, ox: number, oy: number, size: number, target: number, cutoff: number) {
  const histogram = new Uint32Array(256), suffix = new Uint32Array(257);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) histogram[data[((y + oy) * width + x + ox) * 4 + 3]]++;
  for (let i = 255; i >= 0; i--) suffix[i] = suffix[i + 1] + histogram[i];
  let scale = 1, error = Math.abs(suffix[cutoff] / (size * size) - target);
  for (let boundary = 1; boundary < 256; boundary++) {
    const candidate = (cutoff - .5 + 1e-7) / boundary, difference = Math.abs(suffix[boundary] / (size * size) - target);
    if (difference < error - 1e-10) { error = difference; scale = candidate; }
  }
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = ((y + oy) * width + x + ox) * 4 + 3; data[i] = Math.min(255, Math.round(data[i] * scale));
  }
}
export function buildVegetationAtlasMips(input: Omit<VegetationAtlasRecord, 'mips'> & {colour: Uint8Array; normal: Uint8Array}): VegetationAtlasRecord {
  const {tileSize, views, columns, rows, centre, extent} = input;
  if (input.schema !== 1 || ![8, 16].includes(views) || columns !== 4 || rows !== views / 4 ||
      ![32, 64, 128, 256].includes(tileSize) || !centre.every(Number.isFinite) ||
      !extent.every(n => Number.isFinite(n) && n > 0)) throw Error('Invalid vegetation atlas layout.');
  let width = tileSize * columns, height = tileSize * rows;
  if (input.colour.length !== width * height * 4 || input.normal.length !== input.colour.length) throw Error('Incomplete vegetation atlas channels.');
  const targets = Array.from({length: views}, (_, view) => coverage(input.colour, width, view % columns * tileSize, Math.floor(view / columns) * tileSize, tileSize, 82));
  const mips: VegetationAtlasMip[] = [{width, height, colour: input.colour, normal: input.normal}];
  let size = tileSize;
  while (width > 1 || height > 1) {
    const prior = mips[mips.length - 1], w = Math.max(1, width >> 1), h = Math.max(1, height >> 1);
    const colour = new Uint8Array(w * h * 4), normal = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let alpha = 0, red = 0, green = 0, blue = 0, nx = 0, ny = 0, nz = 0;
      for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) {
        const offset = (Math.min(height - 1, y * 2 + j) * width + Math.min(width - 1, x * 2 + i)) * 4;
        const a = prior.colour[offset + 3] / 255; alpha += a;
        red += prior.colour[offset] * a; green += prior.colour[offset + 1] * a; blue += prior.colour[offset + 2] * a;
        nx += (prior.normal[offset] / 127.5 - 1) * a; ny += (prior.normal[offset + 1] / 127.5 - 1) * a; nz += (prior.normal[offset + 2] / 127.5 - 1) * a;
      }
      const dst = (y * w + x) * 4, inverse = 1 / Math.max(alpha, .000001), length = Math.hypot(nx, ny, nz) || 1;
      colour[dst] = Math.round(red * inverse); colour[dst + 1] = Math.round(green * inverse); colour[dst + 2] = Math.round(blue * inverse); colour[dst + 3] = Math.round(alpha * 255 / 4);
      normal[dst] = Math.round((nx / length * .5 + .5) * 255); normal[dst + 1] = Math.round((ny / length * .5 + .5) * 255); normal[dst + 2] = Math.round((nz / length * .5 + .5) * 255); normal[dst + 3] = colour[dst + 3];
    }
    size >>= 1;
    if (size >= 1) for (let view = 0; view < views; view++) correctCoverage(colour, w, view % columns * size, Math.floor(view / columns) * size, size, targets[view], 82);
    // Both channels describe the same cutout after coverage correction.
    for (let i = 3; i < colour.length; i += 4) normal[i] = colour[i];
    mips.push({width: w, height: h, colour, normal}); width = w; height = h;
  }
  return {schema: 1, views, tileSize, columns, rows, centre, extent, mips, coverage: targets};
}
