/**
 * Reads a response body into one ArrayBuffer, reporting the share received
 * when the server states the body's size. The bytes are exactly those
 * `response.arrayBuffer()` would return; this only adds progress.
 *
 * With no usable `Content-Length`, no readable body, or a `Content-Encoding`
 * (the stated length is then the compressed size, not the bytes delivered) it
 * falls back to `arrayBuffer()` and reports nothing: the caller's bar holds at
 * the start of its download stage rather than showing an invented figure.
 */
export async function readResponseBytes(response: Response, onFraction?: (fraction: number) => void): Promise<ArrayBuffer> {
  const stated = response.headers.get("Content-Length");
  const total = stated === null ? Number.NaN : Number(stated);
  if (!onFraction || !response.body || !Number.isSafeInteger(total) || total <= 0 || response.headers.get("Content-Encoding")) return response.arrayBuffer();
  const reader = response.body.getReader();
  let bytes = new Uint8Array(total), received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (received + value.byteLength > bytes.byteLength) {
      // The server sent more than it stated: keep every byte, and stop claiming a share of an unknown total.
      const grown = new Uint8Array(Math.max(bytes.byteLength * 2, received + value.byteLength));
      grown.set(bytes.subarray(0, received)); bytes = grown;
    }
    bytes.set(value, received); received += value.byteLength;
    if (received <= total) onFraction(received / total);
  }
  return received === bytes.byteLength ? bytes.buffer : bytes.slice(0, received).buffer;
}
