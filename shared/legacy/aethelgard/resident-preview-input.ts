/** Operator-owned DEV input. This describes one standing visual prototype,
 * never a household member, gameplay place, route, or saved activity. */
export const EALDHOLT_RESIDENT_PREVIEW_ASSET_ID = 'ealdholt-neutral-resident-preview';
export const EALDHOLT_RESIDENT_PREVIEW_ID = 'ealdholt-standing-resident-preview';
export const RESIDENT_PREVIEW_WORLD_MAX_BYTES = 256 * 1024 * 1024;
export const RESIDENT_PREVIEW_ACTOR_MAX_BYTES = 16 * 1024 * 1024;
export interface ResidentPreviewGlb {
  readonly file: string; readonly sha256: string; readonly bytes: number; readonly url: string;
}
export interface EaldholtResidentPreviewInput {
  readonly revision: string; readonly profile: 'desktop' | 'quest';
  readonly source: ResidentPreviewGlb; readonly actor: ResidentPreviewGlb;
  readonly idleClip: string; readonly proofSha256: string;
  readonly position: readonly [number, number, number]; readonly yawRadians: number;
  /** Expected complete IDLE envelope after placement, in source metres. */
  readonly idleEnvelope: { readonly min: readonly [number, number, number]; readonly max: readonly [number, number, number] };
}
type Row = Record<string, unknown>;
const hash = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
function record(v: unknown, keys: readonly string[]): Row {
  if (!v || typeof v !== 'object' || Array.isArray(v) || Object.getPrototypeOf(v) !== Object.prototype
    || Object.keys(v).length !== keys.length || keys.some(k => !Object.prototype.hasOwnProperty.call(v, k))) throw Error('Resident preview fields are invalid.');
  return v as Row;
}
function point(v: unknown): readonly [number, number, number] {
  if (!Array.isArray(v) || v.length !== 3 || v.some(n => typeof n !== 'number' || !Number.isFinite(n) || Math.abs(n) > 1e6)) throw Error('Resident preview points must be finite source metres.');
  return Object.freeze([v[0], v[1], v[2]]) as readonly [number, number, number];
}
function asset(v: unknown, max: number, folder: URL): ResidentPreviewGlb {
  const r = record(v, ['file', 'sha256', 'bytes']);
  if (typeof r.file !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.-]*\.glb$/.test(r.file) || r.file.includes('..')
    || !hash(r.sha256) || typeof r.bytes !== 'number' || !Number.isSafeInteger(r.bytes) || r.bytes < 28 || r.bytes > max) throw Error('Resident preview asset identity is invalid.');
  return Object.freeze({ file: r.file, sha256: r.sha256, bytes: r.bytes, url: new URL(r.file, folder).href });
}
/** The native manifest can call this synchronously, without fetching, timers,
 * storage or world state. The mounting renderer validates the same input again.
 * A proof hash records offline provenance; it is not a live collision test. */
export function readEaldholtResidentPreviewInput(raw: unknown, profile: 'desktop' | 'quest', sourceModelUrl: string): EaldholtResidentPreviewInput | null {
  if (raw === undefined || raw === '') return null;
  if (typeof raw !== 'string' || raw.length > 16384 || !['desktop', 'quest'].includes(profile)) throw Error('Resident preview needs a bounded private JSON configuration.');
  const modelUrl = new URL(sourceModelUrl);
  if (!['http:', 'https:'].includes(modelUrl.protocol) || modelUrl.username || modelUrl.password || modelUrl.search || modelUrl.hash) throw Error('Resident preview needs a plain HTTP model URL.');
  const root = record(JSON.parse(raw) as unknown, ['schemaVersion', 'usage', 'revision', 'actor', 'idleClip', 'profiles']);
  if (root.schemaVersion !== 1 || root.usage !== 'standing-visual-only' || typeof root.revision !== 'string'
    || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,95}$/.test(root.revision) || typeof root.idleClip !== 'string'
    || !root.idleClip.trim() || root.idleClip.length > 128 || /[\u0000-\u001f]/.test(root.idleClip)) throw Error('Resident preview version or purpose is unsupported.');
  const folder = new URL('.', modelUrl), actor = asset(root.actor, RESIDENT_PREVIEW_ACTOR_MAX_BYTES, folder);
  const profiles = record(root.profiles, ['desktop', 'quest']);
  let selected: EaldholtResidentPreviewInput | null = null;
  for (const key of ['desktop', 'quest'] as const) {
    const row = record(profiles[key], ['source', 'position', 'yawRadians', 'idleEnvelope', 'proofSha256']);
    const source = asset(row.source, RESIDENT_PREVIEW_WORLD_MAX_BYTES, folder), position = point(row.position);
    const envelope = record(row.idleEnvelope, ['min', 'max']), min = point(envelope.min), max = point(envelope.max);
    if (!hash(row.proofSha256) || typeof row.yawRadians !== 'number' || !Number.isFinite(row.yawRadians)
      || Math.abs(row.yawRadians) > Math.PI * 2 || min.some((n, i) => max[i] <= n || max[i] - n > 10)) throw Error('Resident preview standing envelope is invalid.');
    if (source.file === actor.file || source.sha256 === actor.sha256) throw Error('Resident and village assets must have separate identities.');
    if (key === profile) {
      if (source.url !== modelUrl.href) throw Error('Resident preview does not match the selected village profile.');
      selected = Object.freeze({ revision: root.revision, profile, source, actor, idleClip: root.idleClip,
        proofSha256: row.proofSha256, position, yawRadians: row.yawRadians, idleEnvelope: Object.freeze({ min, max }) });
    }
  }
  return selected;
}

function notAborted(signal: AbortSignal): void { if (signal.aborted) throw Error('Resident preview asset loading was cancelled.'); }
/** Verify the exact owned response bytes before either engine parses them.
 * Only the current single-buffer, embedded-image GLB transport is accepted. */
export async function verifyResidentPreviewGlb(bytes: ArrayBuffer, expected: ResidentPreviewGlb, signal: AbortSignal): Promise<void> {
  notAborted(signal);
  if (bytes.byteLength !== expected.bytes || bytes.byteLength < 28) throw Error('Resident preview asset length differs from its private record.');
  const actual = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
  notAborted(signal);
  if (actual !== expected.sha256) throw Error('Resident preview asset hash differs from its private record.');
  const view = new DataView(bytes), jsonLength = view.getUint32(12, true), binAt = 20 + jsonLength;
  if (view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2 || view.getUint32(8, true) !== bytes.byteLength
    || view.getUint32(16, true) !== 0x4e4f534a || jsonLength > 16 * 1024 * 1024 || jsonLength % 4 || binAt + 8 > bytes.byteLength
    || view.getUint32(binAt + 4, true) !== 0x004e4942 || binAt + 8 + view.getUint32(binAt, true) !== bytes.byteLength) throw Error('Resident preview requires one complete JSON/BIN GLB.');
  const data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(bytes, 20, jsonLength))) as Row;
  if (!data || typeof data !== 'object' || Array.isArray(data) || !Array.isArray(data.buffers) || data.buffers.length !== 1) throw Error('Resident preview GLB must contain one embedded buffer.');
  const buffer = data.buffers[0] as Row;
  if (!buffer || typeof buffer !== 'object' || buffer.uri !== undefined || typeof buffer.byteLength !== 'number'
    || !Number.isSafeInteger(buffer.byteLength) || buffer.byteLength < 0 || buffer.byteLength > view.getUint32(binAt, true)
    || view.getUint32(binAt, true) - buffer.byteLength > 3) throw Error('Resident preview GLB buffer is not self-contained.');
  if (data.images !== undefined && (!Array.isArray(data.images) || data.images.some(image => !image || typeof image !== 'object'
    || (image as Row).uri !== undefined && (typeof (image as Row).uri !== 'string' || !((image as Row).uri as string).startsWith('data:image/'))))) throw Error('Resident preview GLB contains an external image.');
}

/** Byte-limited transfer, no redirects/credentials in URLs; parsers receive
 * these same verified bytes or a Blob made from them, never a second URL load. */
export async function loadVerifiedResidentPreviewGlb(expected: ResidentPreviewGlb, signal: AbortSignal,
  fetcher: typeof fetch = globalThis.fetch): Promise<ArrayBuffer> {
  notAborted(signal);
  const url = new URL(expected.url);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash || url.search
    || !hash(expected.sha256) || !Number.isSafeInteger(expected.bytes) || expected.bytes < 28 || expected.bytes > RESIDENT_PREVIEW_WORLD_MAX_BYTES) throw Error('Resident preview transfer identity is invalid.');
  const response = await fetcher(expected.url, { signal, credentials: 'same-origin', redirect: 'error' });
  if (!response.ok || !response.body) throw Error('Resident preview asset could not be loaded.');
  const declared = response.headers.get('content-length');
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) !== expected.bytes)) { await response.body.cancel(); throw Error('Resident preview response length differs from its private record.'); }
  const reader = response.body.getReader(), bytes = new ArrayBuffer(expected.bytes), output = new Uint8Array(bytes);
  let at = 0;
  try {
    for (;;) {
      notAborted(signal); const next = await reader.read(); if (next.done) break;
      if (next.value.byteLength > expected.bytes - at) throw Error('Resident preview response exceeds its private byte limit.');
      output.set(next.value, at); at += next.value.byteLength;
    }
    if (at !== expected.bytes) throw Error('Resident preview response was incomplete.');
    await verifyResidentPreviewGlb(bytes, expected, signal); return bytes;
  } catch (error) { await reader.cancel().catch(() => undefined); throw error; }
  finally { reader.releaseLock(); }
}
