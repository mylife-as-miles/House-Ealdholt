import type { ResidentPreviewGlb } from '../resident-preview-input';

export interface EaldholtPopulationSiteInput {
  readonly profile: 'desktop' | 'quest';
  readonly source: ResidentPreviewGlb;
  readonly site: { readonly url: string; readonly bytes: number; readonly sha256: string };
}
const hash = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
function record(v: unknown): Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw Error('Invalid population site configuration.');
  return v as Record<string, unknown>;
}
/** Private source geometry stays in the operator's asset folder. No coordinates,
 * deployment URL or source hash is embedded in this shared contract. */
export function readEaldholtPopulationSiteInput(raw: unknown, profile: 'desktop' | 'quest', modelUrl: string): EaldholtPopulationSiteInput | null {
  if (raw === undefined || raw === '') return null;
  if (typeof raw !== 'string' || raw.length > 16384) throw Error('Population site configuration must be bounded JSON.');
  const model = new URL(modelUrl);
  if (!['http:', 'https:'].includes(model.protocol) || model.username || model.password || model.search || model.hash) throw Error('Invalid population model URL.');
  const config = record(JSON.parse(raw));
  if (config.version !== 1) throw Error('Unsupported population site configuration.');
  const row = record(record(config.profiles)[profile]), source = record(row.source), site = record(row.site);
  if (typeof source.file !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.-]*\.glb$/.test(source.file) || source.file.includes('..')
    || new URL(source.file, new URL('.', model)).href !== model.href || !hash(source.sha256)
    || !Number.isSafeInteger(source.bytes) || (source.bytes as number) < 28 || (source.bytes as number) > 256 * 1024 * 1024
    || typeof site.file !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.-]*\.json$/.test(site.file) || site.file.includes('..')
    || !hash(site.sha256) || !Number.isSafeInteger(site.bytes) || (site.bytes as number) < 2 || (site.bytes as number) > 16 * 1024 * 1024) {
    throw Error('Population site and rendered model need matching byte identities.');
  }
  return Object.freeze({ profile, source: Object.freeze({ file: source.file, sha256: source.sha256, bytes: source.bytes as number, url: model.href }),
    site: Object.freeze({ url: new URL(site.file, new URL('.', model)).href, sha256: site.sha256, bytes: site.bytes as number }) });
}

/** The parser consumes the bytes verified here, never a second URL load. */
export async function loadEaldholtPopulationSite(input: EaldholtPopulationSiteInput, signal: AbortSignal,
  fetcher: typeof fetch = globalThis.fetch): Promise<unknown> {
  const response = await fetcher(input.site.url, { signal, credentials: 'same-origin', redirect: 'error' });
  if (!response.ok || !response.body) throw Error('Population site could not be loaded.');
  const declared = response.headers.get('content-length');
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) !== input.site.bytes)) {
    await response.body.cancel(); throw Error('Population site byte length changed.');
  }
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let length = 0;
  try {
    for (;;) {
      signal.throwIfAborted(); const { done, value } = await reader.read(); if (done) break;
      length += value.byteLength;
      if (length > input.site.bytes) throw Error('Population site exceeded its byte record.');
      chunks.push(value);
    }
    if (length !== input.site.bytes) throw Error('Population site was incomplete.');
    const bytes = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const actual = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
    signal.throwIfAborted(); if (actual !== input.site.sha256) throw Error('Population site hash changed.');
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch (error) { await reader.cancel().catch(() => undefined); throw error; }
  finally { reader.releaseLock(); }
}
