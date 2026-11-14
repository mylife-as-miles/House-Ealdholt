import { MAX_ARCHIVE_BYTES, MAX_REPLAYS } from './catalog';
import { SHOWCASE_STORAGE_KEY } from './storage-key';
import { replayEntryFromPGN } from './records';
import type { ReplayEntry, ShowcaseStorage } from './types';

const byteSize = (text: string) => new TextEncoder().encode(text).byteLength;
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

export function discoverShowcaseStorage(): ShowcaseStorage | null {
  try { return globalThis.localStorage ?? null; } catch { return null; }
}

function archiveEntries(raw: string | null): unknown[] {
  if (raw === null) return [];
  if (byteSize(raw) > MAX_ARCHIVE_BYTES) throw new Error('The replay archive is larger than the supported limit.');
  let data: unknown;
  try { data = JSON.parse(raw); } catch { throw new Error('The replay archive could not be read.'); }
  if (!object(data) || data.version !== 1 || !Array.isArray(data.entries) || data.entries.length > MAX_REPLAYS) throw new Error('The replay archive version or format is unsupported.');
  return data.entries;
}

function validateEntry(entry: unknown, ids: Set<string>): ReplayEntry {
    if (!object(entry) || typeof entry.id !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,95}$/.test(entry.id)
      || ids.has(entry.id) || typeof entry.pgn !== 'string' || typeof entry.title !== 'string'
      || !Number.isInteger(entry.arena) || Number(entry.arena) < 0 || Number(entry.arena) > 3
      || (entry.source !== 'computer' && entry.source !== 'import' && entry.source !== 'match') || typeof entry.createdAt !== 'string'
      || !Number.isFinite(Date.parse(entry.createdAt))) throw new Error('A stored replay entry is invalid.');
    ids.add(entry.id);
    // Recompute move count and results from legal moves, rather than trust JSON.
    return replayEntryFromPGN(entry.pgn, {
      id: entry.id, title: entry.title, arena: Number(entry.arena), source: entry.source,
      createdAt: entry.createdAt, ...(typeof entry.seed === 'number' ? { seed: entry.seed } : {}),
      ...(entry.source === 'computer' ? { termination: 'move-limit' as const } : {}),
    });
}

/** The archive stores PGN, never trusted renderer frames or arbitrary application data. */
export function parseReplayArchive(raw: string | null): readonly ReplayEntry[] {
  const ids = new Set<string>();
  return Object.freeze(archiveEntries(raw).map(entry => validateEntry(entry, ids)));
}

/** Validate one bounded PGN per task so a full archive cannot monopolize the XR thread. */
export async function parseReplayArchiveAsync(raw: string | null, signal?: AbortSignal): Promise<readonly ReplayEntry[]> {
  const input = archiveEntries(raw), ids = new Set<string>(), entries: ReplayEntry[] = [];
  for (const entry of input) {
    await new Promise<void>(resolve => setTimeout(resolve, 0));
    if (signal?.aborted) throw new DOMException('Replay archive loading cancelled', 'AbortError');
    entries.push(validateEntry(entry, ids));
  }
  if (signal?.aborted) throw new DOMException('Replay archive loading cancelled', 'AbortError');
  return Object.freeze(entries);
}

export function serializeReplayArchive(entries: readonly ReplayEntry[]): string {
  if (entries.length > MAX_REPLAYS) throw new Error(`Keep at most ${MAX_REPLAYS} replays in this archive.`);
  const raw = JSON.stringify({ version: 1, entries });
  if (byteSize(raw) > MAX_ARCHIVE_BYTES) throw new Error('The replay archive is full. Export a replay before removing one.');
  return raw;
}

export interface ReplayArchiveRead {
  readonly entries: readonly ReplayEntry[];
  readonly status: 'saved' | 'session' | 'corrupt';
  readonly raw: string | null;
}

export function readReplayArchive(storage: ShowcaseStorage | null): ReplayArchiveRead {
  const source = readReplayArchiveSource(storage);
  if (source.status === 'session') return { ...source, entries: Object.freeze([]) };
  try { return { entries: parseReplayArchive(source.raw), status: 'saved', raw: source.raw }; }
  catch { return { entries: Object.freeze([]), status: 'corrupt', raw: source.raw }; }
}

export function readReplayArchiveSource(storage: ShowcaseStorage | null): { status: 'saved' | 'session'; raw: string | null } {
  if (!storage) return { status: 'session', raw: null };
  try { return { status: 'saved', raw: storage.getItem(SHOWCASE_STORAGE_KEY) }; }
  catch { return { status: 'session', raw: null }; }
}

/** Detect observed external edits and rely on Web Storage's atomic setItem failure. */
export function writeReplayArchive(storage: ShowcaseStorage | null, entries: readonly ReplayEntry[], expectedRaw: string | null): { ok: boolean; raw?: string; message: string } {
  if (!storage) return { ok: false, message: 'Device storage is unavailable. This replay stays in this visit.' };
  let raw: string;
  try { raw = serializeReplayArchive(entries); }
  catch (error) { return { ok: false, message: error instanceof Error ? error.message : 'The replay archive is full.' }; }
  try {
    if (storage.getItem(SHOWCASE_STORAGE_KEY) !== expectedRaw) return { ok: false, message: 'The archive changed in another page. Reload the archive before saving; its data is unchanged.' };
    storage.setItem(SHOWCASE_STORAGE_KEY, raw);
    return { ok: true, raw, message: 'Saved on this device.' };
  } catch { return { ok: false, message: 'The replay could not be saved on this device. It stays in this visit.' }; }
}

export function parsePortableReplay(text: string): { pgn: string; metadata: { title?: string; arena?: number; createdAt?: string } } {
  if (typeof text !== 'string' || byteSize(text) > MAX_ARCHIVE_BYTES) throw new Error('Choose a replay file smaller than 512 KB.');
  if (!text.trimStart().startsWith('{')) return { pgn: text, metadata: {} };
  let data: unknown;
  try { data = JSON.parse(text); } catch {
    // A PGN may begin with a brace comment. Only a closed leading comment with
    // remaining content can reach the strict legal-move parser; arbitrary JSON
    // objects are still rejected by the envelope check below.
    const commentEnd = text.indexOf('}');
    if (commentEnd < 0 || !text.slice(commentEnd + 1).trim()) throw new Error('The replay file could not be read.');
    return { pgn: text, metadata: {} };
  }
  if (!object(data) || data.format !== 'crownfall-showcase-replay' || data.version !== 1 || !object(data.entry) || typeof data.entry.pgn !== 'string') throw new Error('This is not a supported Crownfall replay file.');
  return {
    pgn: data.entry.pgn,
    metadata: {
      ...(typeof data.entry.title === 'string' ? { title: data.entry.title } : {}),
      ...(Number.isInteger(data.entry.arena) && Number(data.entry.arena) >= 0 && Number(data.entry.arena) < 4 ? { arena: Number(data.entry.arena) } : {}),
      ...(typeof data.entry.createdAt === 'string' && Number.isFinite(Date.parse(data.entry.createdAt)) ? { createdAt: data.entry.createdAt } : {}),
    },
  };
}
