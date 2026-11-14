/** Private development content only. The hosts supply an operator-owned base;
 * neither the file name nor any household content is bundled in production. */
export const HOUSEHOLD_SEED_MAX_BYTES = 1024 * 1024;

export function householdSeedUrl(baseUrl: string, file: unknown): string | null {
  if (typeof file !== 'string' || !file) return null;
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*\.json$/.test(file) || file.includes('..')) {
    throw new Error('Household content needs a JSON file name in the configured private asset folder.');
  }
  const base = new URL(baseUrl);
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash) {
    throw new Error('Household content needs an HTTP asset folder without embedded credentials.');
  }
  if (!base.pathname.endsWith('/')) base.pathname += '/';
  return new URL(file, base).href;
}

/** Bound the transferred bytes before parsing; Content-Length alone is not
 * trusted. Abort belongs to the mounting host, including Strict Mode replay. */
export async function loadHouseholdSeed(url: string, signal: AbortSignal,
  fetcher: typeof fetch = globalThis.fetch): Promise<unknown> {
  const response = await fetcher(url, { signal, credentials: 'same-origin', redirect: 'error' });
  if (!response.ok || !response.body) throw new Error('Household content could not be loaded.');
  const declared = response.headers.get('content-length');
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > HOUSEHOLD_SEED_MAX_BYTES)) {
    await response.body.cancel();
    throw new Error('Household content exceeds the allowed size.');
  }
  const reader = response.body.getReader(), chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > HOUSEHOLD_SEED_MAX_BYTES) throw new Error('Household content exceeds the allowed size.');
      chunks.push(value);
    }
    signal.throwIfAborted();
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally { reader.releaseLock(); }
}
