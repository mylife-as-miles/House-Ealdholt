import { speakerFor, type GambitSide } from "../../../shared/play/gambit-sound";
import type { VoiceLineEvent } from "../../../web/src/audio/audioManager";

/** One spoken line on screen, in seconds on the page clock (performance.now() / 1000). */
export interface Caption {
  token: number;
  speaker: string;
  /** The speaker's army, or null for the fallen. */
  side: GambitSide | null;
  text: string;
  showAt: number;
  hideAt: number;
  /** Set once it has been on screen (see stepCaptions). */
  seen?: boolean;
}

/** However short the line, it stays up long enough to read. */
const MIN_SECONDS = 1.6;
const READING_CHARS_PER_SECOND = 17;
/** Held after the last word, so it does not vanish with the voice. */
const LINGER_SECONDS = 0.6;
/** A plea cut off by the blow stays this long after the cut (within the reading minimum). */
const CUT_SECONDS = 0.5;
/** A line the screen never got to show is put up late, but not this long after its voice. */
const LATE_LIMIT_SECONDS = 10;
export const MAX_CAPTIONS = 2;

const readingSeconds = (text: string) => Math.max(MIN_SECONDS, text.length / READING_CHARS_PER_SECOND);

/** The captions after one event from the match mixer; `sideName` names the kingdom each side fields (for a line that does not say its side). */
export function applyVoiceLine(captions: readonly Caption[], event: VoiceLineEvent, now: number, sideName?: (side: GambitSide) => string): Caption[] {
  if (event.type === "clear") return [];
  if (event.type === "cut") {
    return captions.map((caption) => caption.token !== event.token ? caption
      : { ...caption, hideAt: Math.min(caption.hideAt, Math.max(now + CUT_SECONDS, caption.showAt + MIN_SECONDS)) });
  }
  // A piece's clip names its kingdom, and so its speaker; the mixer says which side it spoke for.
  const speaker = speakerFor(event.clip, sideName, event.side);
  const showAt = now + Math.max(0, event.delay);
  return [...captions, {
    token: event.token, speaker: speaker?.name ?? "", side: speaker?.side ?? null, text: event.text,
    showAt, hideAt: showAt + Math.max(event.duration + LINGER_SECONDS, readingSeconds(event.text)),
  }];
}

/** Those on screen at `now`, oldest first, at most MAX_CAPTIONS. */
export function visibleCaptions(captions: readonly Caption[], now: number): Caption[] {
  return captions.filter((caption) => caption.showAt <= now && now < caption.hideAt).slice(-MAX_CAPTIONS);
}

/** Drops the captions that have finished. */
export function liveCaptions(captions: readonly Caption[], now: number): Caption[] {
  return captions.filter((caption) => now < caption.hideAt);
}

/**
 * The captions brought to `now` for the screen: `live` to keep, `visible` to draw (see visibleCaptions). A line that
 * finished before the screen could show it, because the page was frozen while it was spoken (the first frames of a
 * battlefield can hold the page for seconds while the voices play on), is put up now for its reading time instead of
 * being lost, once, and only within LATE_LIMIT_SECONDS of its voice.
 */
export function stepCaptions(captions: readonly Caption[], now: number): { live: Caption[]; visible: Caption[] } {
  const live = captions.flatMap((caption): Caption[] => now < caption.hideAt ? [caption]
    : caption.seen || now - caption.showAt > LATE_LIMIT_SECONDS ? []
    : [{ ...caption, showAt: now, hideAt: now + readingSeconds(caption.text), seen: true }]);
  const onScreen = new Set(visibleCaptions(live, now).map((caption) => caption.token));
  const marked = live.map((caption) => caption.seen || !onScreen.has(caption.token) ? caption : { ...caption, seen: true });
  return { live: marked, visible: visibleCaptions(marked, now) };
}
