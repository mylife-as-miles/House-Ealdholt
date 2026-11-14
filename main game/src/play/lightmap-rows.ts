/**
 * Turns a decoded image's rows over in place: the last row first. EXRLoader writes rows bottom-up while glTF's second
 * UV set reads them top-down (A-02). Plain typed arrays only, so the EXR worker (exr.worker.ts) can do it beside the
 * decode, off the main thread.
 */
export function flipRowsInPlace(data: Uint16Array | Float32Array | null | undefined, height: number): void {
  if (!data || !height) return;
  const stride = (data.length / height) | 0;
  const row = data.slice(0, stride);
  for (let y = 0; y < height >> 1; y++) {
    const a = y * stride, b = (height - 1 - y) * stride;
    row.set(data.subarray(a, a + stride));
    data.copyWithin(a, b, b + stride);
    data.set(row, b);
  }
}
