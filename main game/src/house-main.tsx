import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { DEFAULT_MENU_AUDIO_PREFERENCES } from "../../shared/menu/audio";
import { AethelgardPreview } from "./legacy/aethelgard/AethelgardPreview";
import { desktopReleaseVillage } from "./legacy/release-village";
import { useMenuAudio } from "./useMenuAudio";
import { applyMenuTheme } from "./theme";
import "./styles.css";
import "./house.css";

const quality = { preset: "medium", renderScale: 100, frameLimit: 60 } as const;
function House() {
  const [paused, setPaused] = useState(false);
  const audio = useMenuAudio(DEFAULT_MENU_AUDIO_PREFERENCES, paused);
  if (!desktopReleaseVillage) return <main className="house-missing"><h1>House Ealdholt</h1><p>The verified village assets are missing. Follow the setup instructions and build the project again.</p></main>;
  return <AethelgardPreview active reducedMotion={false} quality={quality} mode="inherited"
    modelBaseUrl={desktopReleaseVillage.urls.base} environmentAudioOutput={audio.effectsOutput}
    onAudioSuspensionChange={setPaused} onBack={() => {}} onPlay={() => {}} />;
}
applyMenuTheme();
createRoot(document.getElementById("root")!).render(<House />);
