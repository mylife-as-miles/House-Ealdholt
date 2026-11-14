import { CHAPTERS } from './content';
import type { ChapterItem } from './types';

export const STORY_PROGRESS_KEY = 'crownfall.story.progress.v1';
export const STORY_PROGRESS_COPY = Object.freeze({
  unlock: 'Watch the Prologue to unlock Chapter One.',
  locked: 'This chapter is locked.',
  availability: 'Finish the Prologue to reveal Chapter One. Later chapters remain locked.',
});
export type StoryProgress = Readonly<{ version: 1; prologue: Readonly<
  { state: 'unwatched' } | { state: 'completed'; completedAt: string }
> }>;
export const EMPTY_STORY_PROGRESS: StoryProgress = Object.freeze({ version: 1, prologue: Object.freeze({ state: 'unwatched' }) });
export interface StoryStorage { getItem(key: string): string | null; setItem(key: string, value: string): void }
export function hasWatchedPrologue(progress: StoryProgress): boolean { return progress.prologue.state === 'completed'; }
export function normalizeStoryProgress(value: unknown): StoryProgress {
  if (!value || typeof value !== 'object') return EMPTY_STORY_PROGRESS;
  const p = value as { version?: unknown; prologue?: { state?: unknown; completedAt?: unknown } };
  const at = p.prologue?.completedAt;
  return p.version === 1 && p.prologue?.state === 'completed' && typeof at === 'string' && Number.isFinite(Date.parse(at))
    ? { version: 1, prologue: { state: 'completed', completedAt: at } } : EMPTY_STORY_PROGRESS;
}
export function readStoryProgress(storage: StoryStorage | null): StoryProgress {
  try { return normalizeStoryProgress(JSON.parse(storage?.getItem(STORY_PROGRESS_KEY) || 'null')); }
  catch { return EMPTY_STORY_PROGRESS; }
}
export function saveStoryProgress(progress: StoryProgress, storage: StoryStorage | null): boolean {
  if (!storage) return false;
  try { storage.setItem(STORY_PROGRESS_KEY, JSON.stringify(progress)); return true; }
  catch { return false; }
}
/** The only progression event: a naturally completed Prologue. Replays are idempotent. */
export function completePrologue(progress: StoryProgress, at: string): StoryProgress {
  if (hasWatchedPrologue(progress)) return progress;
  return normalizeStoryProgress({ version: 1, prologue: { state: 'completed', completedAt: at } });
}
export function storyChapters(progress: StoryProgress): readonly ChapterItem[] {
  return hasWatchedPrologue(progress) ? CHAPTERS.map(chapter => chapter.id === 'chapter-01'
    ? { ...chapter, locked: false, previewable: true, status: 'coming-soon' as const } : chapter) : CHAPTERS;
}
