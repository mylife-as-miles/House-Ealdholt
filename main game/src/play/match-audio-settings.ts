import { DEFAULT_MENU_AUDIO_PREFERENCES, type MenuAudioPreferences } from "../../../shared/menu/audio";
import type { ViolenceIntensity } from "../../../shared/menu/violence";
import { INITIAL_PREFERENCES, type SubtitleSize } from "../settings-types";

/** What a match takes from the menu's settings: the mixer's levels, the subtitles and how much blood is shown. */
export interface MatchAudioPreferences extends MenuAudioPreferences {
  subtitles: boolean;
  subtitleSize: SubtitleSize;
  violence: ViolenceIntensity;
}

/**
 * The menu's sound settings, handed to the match mixer without the menu importing it: the match engine and its audio
 * stay out of the menu's cold-start graph. App publishes; a match subscribes while it is open.
 */
let current: MatchAudioPreferences = {
  ...DEFAULT_MENU_AUDIO_PREFERENCES, subtitles: INITIAL_PREFERENCES.subtitles, subtitleSize: INITIAL_PREFERENCES.subtitleSize,
  violence: INITIAL_PREFERENCES.violence,
};
const listeners = new Set<(preferences: MatchAudioPreferences) => void>();

export function publishMatchAudioPreferences(preferences: MatchAudioPreferences): void {
  const next = { volume: preferences.volume, musicVolume: preferences.musicVolume, sfxVolume: preferences.sfxVolume, music: preferences.music, soundEffects: preferences.soundEffects, subtitles: preferences.subtitles, subtitleSize: preferences.subtitleSize, violence: preferences.violence };
  if (JSON.stringify(next) === JSON.stringify(current)) return;
  current = next;
  for (const listener of listeners) listener(current);
}

/** Calls `listener` now and on every change; returns the unsubscribe. */
export function subscribeMatchAudioPreferences(listener: (preferences: MatchAudioPreferences) => void): () => void {
  listener(current);
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
