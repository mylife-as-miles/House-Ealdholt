import { generateExhibition, openReplay, recordFromPGN } from './records';
import { parsePortableReplay, parseReplayArchiveAsync } from './storage';
import type { GenerationOptions, ReplayEntry, ShowcaseRecord } from './types';

export type ReplayJob =
  | { kind: 'archive'; raw: string | null }
  | { kind: 'open'; entry: ReplayEntry }
  | { kind: 'import'; text: string; arena: number; createdAt: string }
  | { kind: 'generate'; options: Omit<GenerationOptions, 'signal'> };
export type ReplayJobValue = ShowcaseRecord | readonly ReplayEntry[];
export type ReplayJobResponse =
  | { kind: 'progress'; progress: number }
  | { kind: 'complete'; value: ReplayJobValue }
  | { kind: 'error'; message: string };

/** Same chess rules in the module Worker and the explicit Node test fallback. */
export async function executeReplayJob(job: ReplayJob, signal?: AbortSignal, onProgress?: (value: number) => void): Promise<ReplayJobValue> {
  if (signal?.aborted) throw new DOMException('Replay processing cancelled', 'AbortError');
  if (job.kind === 'archive') return parseReplayArchiveAsync(job.raw, signal);
  if (job.kind === 'generate') return generateExhibition({ ...job.options, signal }, onProgress);
  if (job.kind === 'open') return openReplay(job.entry);
  const input = parsePortableReplay(job.text);
  return recordFromPGN(input.pgn, { ...input.metadata, source: 'import', arena: input.metadata.arena ?? job.arena, createdAt: input.metadata.createdAt || job.createdAt });
}
