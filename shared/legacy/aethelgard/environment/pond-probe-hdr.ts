/** Original Radiance RGBE writer. Input is scene-linear HDR readback, never an
 * exposed/tonemapped screenshot. Literal packets are valid scanline RLE; this
 * deliberately favors a small, auditable writer over compression complexity. */
export function encodeEaldholtProbeHdr(
  rgba: Float32Array,
  width: number,
  height: number,
  rowOrder: 'bottom-up' | 'top-down' = 'bottom-up',
): Uint8Array {
  if (!Number.isInteger(width) || width < 8 || width > 32767 || !Number.isInteger(height) || height < 1 || height > 32767
    || rgba.length !== width * height * 4 || (rowOrder !== 'bottom-up' && rowOrder !== 'top-down')) {
    throw Error('Invalid HDR dimensions, RGBA length or row order.');
  }
  const header = new TextEncoder().encode(`#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y ${height} +X ${width}\n`);
  const packets = Math.ceil(width / 128), rowLength = 4 + 4 * (width + packets);
  const result = new Uint8Array(header.length + height * rowLength), row = new Uint8Array(width * 4);
  result.set(header); let output = header.length;
  for (let y = 0; y < height; y++) {
    const sourceY = rowOrder === 'bottom-up' ? height - 1 - y : y;
    for (let x = 0; x < width; x++) {
      const p = (sourceY * width + x) * 4, r = rgba[p], g = rgba[p + 1], b = rgba[p + 2];
      if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b) || Math.min(r, g, b) < 0) {
        throw Error('HDR radiance must be finite and nonnegative.');
      }
      const maximum = Math.max(r, g, b);
      if (maximum < 1e-32) { row[x] = row[width + x] = row[2 * width + x] = row[3 * width + x] = 0; continue; }
      const exponent = Math.floor(Math.log2(maximum)) + 1;
      if (exponent < -127 || exponent > 127) throw Error('HDR radiance exceeds RGBE exponent range.');
      const scale = 256 / 2 ** exponent;
      row[x] = Math.min(255, Math.floor(r * scale)); row[width + x] = Math.min(255, Math.floor(g * scale));
      row[2 * width + x] = Math.min(255, Math.floor(b * scale)); row[3 * width + x] = exponent + 128;
    }
    result[output++] = 2; result[output++] = 2; result[output++] = width >> 8; result[output++] = width & 255;
    for (let channel = 0; channel < 4; channel++) for (let x = 0; x < width; x += 128) {
      const count = Math.min(128, width - x); result[output++] = count;
      result.set(row.subarray(channel * width + x, channel * width + x + count), output); output += count;
    }
  }
  return result;
}
