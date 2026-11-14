import React, { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { createRoot } from "react-dom/client";
import { DEFAULT_MENU_AUDIO_PREFERENCES } from "../../shared/menu/audio";
import { OPENING_FILM_CLOSED, ealdholtFromLegacy, openingFilmIsOpen, reduceOpeningFilm, type OpeningFilmEvent } from "../../shared/menu/opening-film";
import OpeningFilm from "./OpeningFilm";
import { AethelgardPreview } from "./legacy/aethelgard/AethelgardPreview";
import type { LegacyScreenHandle } from "./legacy/legacy-handle";
import { houseKeyTarget, isFilmShortcutAvailable, routeHouseKey } from "./house-keyboard";
import { desktopReleaseVillage } from "./legacy/release-village";
import { useMenuAudio } from "./useMenuAudio";
import { applyMenuTheme } from "./theme";
import "./styles.css";
import "./house.css";

const quality = { preset: "medium", renderScale: 100, frameLimit: 60 } as const;
function House() {
  const [paused, setPaused] = useState(false);
  const village = useRef<LegacyScreenHandle>(null);
  const [needsGesture, setNeedsGesture] = useState(false);
  const mutedAttempt = useRef(false);
  // Standalone always opens on the original House Ealdholt film. Unlike the
  // Crownfall menu, it deliberately does not consult the seen flag.
  const [opening, setOpening] = useState(() => reduceOpeningFilm(OPENING_FILM_CLOSED, ealdholtFromLegacy()));
  const filmOpen = openingFilmIsOpen(opening);
  const filmEvent = useCallback((event: OpeningFilmEvent) => {
    if (event.type === "muted") mutedAttempt.current = true;
    if (event.type === "audible") mutedAttempt.current = false;
    // If the browser blocks both audible and muted autoplay, retain the film
    // for a trusted press. Actual media errors still open the village.
    if (event.type === "failed" && mutedAttempt.current) {
      const video = document.querySelector<HTMLVideoElement>('[data-opening-cut="ealdholt"] video');
      if (video && !video.error) {
        setNeedsGesture(true);
        setOpening(current => reduceOpeningFilm(current, { type: "pause" }));
        return;
      }
    }
    setOpening(current => reduceOpeningFilm(current, event));
  }, []);
  const audio = useMenuAudio(DEFAULT_MENU_AUDIO_PREFERENCES, paused);

  useEffect(() => {
    if (!filmOpen) return;
    const keydown = (event: KeyboardEvent) => {
      if (!isFilmShortcutAvailable(event)) return;
      if (event.key === "Escape") { event.preventDefault(); filmEvent({ type: "skip" }); return; }
      const target = event.target;
      if ((event.key === " " || event.key === "Enter") && !(target instanceof HTMLElement && target.closest("button, input, select, textarea, a"))) {
        event.preventDefault(); filmEvent({ type: "toggle" });
      }
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [filmOpen, filmEvent]);

  useEffect(() => {
    if (filmOpen) return;
    const keydown = (event: KeyboardEvent) => {
      if (routeHouseKey(event, houseKeyTarget(event.target), village.current)) event.preventDefault();
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [filmOpen]);

  const filmDialog = document.querySelector<HTMLElement>('[data-opening-cut="ealdholt"]') ?? document.body;
  if (filmOpen) return <>
    <OpeningFilm state={opening} attachAudio={audio.attachFilm} onEvent={filmEvent}
      onSkip={() => filmEvent({ type: "skip" })} reducedMotion={false} />
    {opening.phase === "paused" ? createPortal(<button type="button" className="house-film-action" data-house-film-resume autoFocus
      onClick={() => {
        const video = document.querySelector<HTMLVideoElement>('[data-opening-cut="ealdholt"] video');
        if (video) { try { video.muted = false; void video.play().catch(() => {}); } catch { /* The player will offer its fallback. */ } }
        void audio.unlock(); setNeedsGesture(false); filmEvent({ type: "resume" });
      }}>{needsGesture ? "Play film" : "Resume film"}</button>, filmDialog)
      : opening.notice === "muted" ? createPortal(<button type="button" className="house-film-action" data-house-film-sound
        onClick={() => { void audio.unlock(); }}>Enable sound</button>, filmDialog) : null}
  </>;
  if (!desktopReleaseVillage) return <main className="house-missing"><h1>House Ealdholt</h1><p>The verified village assets are missing. Follow the setup instructions and build the project again.</p></main>;
  return <AethelgardPreview ref={village} standalone active reducedMotion={false} quality={quality} mode="inherited"
    modelBaseUrl={desktopReleaseVillage.urls.base} environmentAudioOutput={audio.effectsOutput}
    onAudioSuspensionChange={setPaused} onBack={() => {}} onPlay={() => {}} />;
}
applyMenuTheme();
createRoot(document.getElementById("root")!).render(<House />);
