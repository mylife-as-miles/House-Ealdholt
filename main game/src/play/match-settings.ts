/**
 * What the main menu lends a match so that its pause menu can show the real Settings pages (SettingsGrid and
 * SettingsDetail) on the same preferences, saved the same way. App.tsx provides it around the match it shows; the
 * match's own props then carry each change into the running match (quality, render scale, reduced motion) and the
 * match audio follows the published sound settings. Where no one provides it (the Showcase's embedded battles, which
 * have no pause menu), the pause menu shows no Settings.
 */
import { createContext, useContext } from "react";
import type { Preferences } from "../settings-types";

export interface MatchSettings {
  preferences: Preferences;
  onChange(preferences: Preferences): void;
  /** Whether the last change reached the device's storage, and a way to try again when it did not. */
  preferencesSaved: boolean;
  onRetrySave(): void;
}

export const MatchSettingsContext = createContext<MatchSettings | null>(null);
export const useMatchSettings = () => useContext(MatchSettingsContext);
