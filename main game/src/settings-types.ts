import {
  DEFAULT_MENU_AUDIO_PREFERENCES, normalizeMenuAudioPreferences,
  type MenuAudioPreferences,
} from "../../shared/menu/audio";
import { normalizeLocale, type Locale } from "../../shared/menu/localization";
import { DEFAULT_VIOLENCE_INTENSITY, normalizeViolenceIntensity, type ViolenceIntensity } from "../../shared/menu/violence";

export type Quality = "low" | "medium" | "high";
export type FrameLimit = 0 | 30 | 60 | 120;
/** How large the match subtitles are drawn. */
export type SubtitleSize = "small" | "medium" | "large";
export const SUBTITLE_SIZES: readonly SubtitleSize[] = ["small", "medium", "large"];
export type SettingsCategory = "general" | "controls" | "input" | "video" | "audio" | "credits";
export type Direction = "left" | "right" | "up" | "down";
export type BindingAction = Direction | "select" | "back" | "previousTab" | "nextTab" | "first" | "last";
export type MenuBindings = Record<BindingAction, string>;

export const DEFAULT_BINDINGS: MenuBindings = {
  left: "ArrowLeft", right: "ArrowRight", up: "ArrowUp", down: "ArrowDown",
  select: "Enter", back: "Escape", previousTab: "KeyQ", nextTab: "KeyE", first: "Home", last: "End",
};

export const BINDING_LABELS: Record<BindingAction, string> = {
  left: "Move left", right: "Move right", up: "Move up", down: "Move down",
  select: "Select", back: "Back", previousTab: "Previous tab", nextTab: "Next tab", first: "First option", last: "Last option",
};

export interface Preferences extends MenuAudioPreferences {
  locale: Locale;
  quality: Quality;
  automaticGraphics: boolean;
  fullscreen: boolean;
  motion: boolean;
  showHints: boolean;
  renderScale: number;
  frameLimit: FrameLimit;
  bindings: MenuBindings;
  /** Show the match's spoken lines (pleas, kings, the fallen) as subtitles. Desktop only: Quest has no match. */
  subtitles: boolean;
  subtitleSize: SubtitleSize;
  /** How much blood a capture shows in a match. Shared with Quest (shared/menu/violence.ts). */
  violence: ViolenceIntensity;
}

export const INITIAL_PREFERENCES: Preferences = {
  ...DEFAULT_MENU_AUDIO_PREFERENCES,
  locale: "en",
  quality: "medium", automaticGraphics: false, fullscreen: true, motion: true, showHints: true,
  renderScale: 90, frameLimit: 0, bindings: { ...DEFAULT_BINDINGS },
  subtitles: true, subtitleSize: "medium",
  violence: DEFAULT_VIOLENCE_INTENSITY,
};

/** Old saved menus acquire new controls without accepting invalid renderer values. */
export function normalizePreferences(value: unknown): Preferences {
  const candidate = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
  return {
    ...normalizeMenuAudioPreferences(candidate),
    locale: normalizeLocale(candidate.locale),
    quality: ["low", "medium", "high"].includes(String(candidate.quality)) ? candidate.quality as Quality : INITIAL_PREFERENCES.quality,
    automaticGraphics: typeof candidate.automaticGraphics === 'boolean' ? candidate.automaticGraphics : false,
    fullscreen: typeof candidate.fullscreen === 'boolean' ? candidate.fullscreen : true,
    motion: typeof candidate.motion === "boolean" ? candidate.motion : INITIAL_PREFERENCES.motion,
    showHints: typeof candidate.showHints === "boolean" ? candidate.showHints : INITIAL_PREFERENCES.showHints,
    renderScale: typeof candidate.renderScale === "number" && Number.isFinite(candidate.renderScale)
      ? Math.min(100, Math.max(50, candidate.renderScale)) : INITIAL_PREFERENCES.renderScale,
    frameLimit: typeof candidate.frameLimit === "number" && [0, 30, 60, 120].includes(candidate.frameLimit)
      ? candidate.frameLimit as FrameLimit : INITIAL_PREFERENCES.frameLimit,
    bindings: normalizeBindings(candidate.bindings),
    subtitles: typeof candidate.subtitles === "boolean" ? candidate.subtitles : INITIAL_PREFERENCES.subtitles,
    subtitleSize: SUBTITLE_SIZES.includes(candidate.subtitleSize as SubtitleSize)
      ? candidate.subtitleSize as SubtitleSize : INITIAL_PREFERENCES.subtitleSize,
    violence: normalizeViolenceIntensity(candidate.violence),
  };
}

export function normalizeBindings(value: unknown): MenuBindings {
  if (!value || typeof value !== "object") return { ...DEFAULT_BINDINGS };
  const candidate = value as Record<string, unknown>;
  const codes = Object.keys(DEFAULT_BINDINGS).map((key) => candidate[key]);
  if (codes.some((code) => typeof code !== "string" || !/^(Arrow(?:Left|Right|Up|Down)|Key[A-Z]|Digit[0-9]|Enter|Space|Escape|Home|End|Backspace|Delete|PageUp|PageDown)$/.test(code)) || new Set(codes).size !== codes.length) return { ...DEFAULT_BINDINGS };
  if (Object.entries(candidate).some(([key, code]) => key !== "back" && code === "Escape")) return { ...DEFAULT_BINDINGS };
  return Object.fromEntries(Object.keys(DEFAULT_BINDINGS).map((key) => [key, candidate[key]])) as MenuBindings;
}

export function keyLabel(code: string): string {
  const labels: Record<string, string> = { ArrowLeft: "←", ArrowRight: "→", ArrowUp: "↑", ArrowDown: "↓", Escape: "Esc", Space: "Space", Enter: "Enter", PageUp: "Page Up", PageDown: "Page Down" };
  return labels[code] || code.replace(/^Key|^Digit/, "");
}

export interface SettingsPageHandle {
  move(direction: Direction): void;
  edge?(last: boolean): void;
  activate(): void;
  reset(): void;
  focus(): void;
  cancel(): boolean;
}
