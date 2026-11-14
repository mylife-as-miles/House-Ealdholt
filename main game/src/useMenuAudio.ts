import { useCallback, useEffect, useRef, useState } from "react";
import { CrownfallMenuAudio, type MenuAudioStatus, type MenuAudioPreferences, type MenuFilmKind } from "../../shared/menu/audio";
import { resolveCrownfallSoundtrack } from "../../shared/menu/soundtrack";

/** One audio graph for the menu; a trusted input unlocks browser audio. */
export function useMenuAudio(preferences: MenuAudioPreferences, blocked: boolean) {
  const audio = useRef<CrownfallMenuAudio | null>(null);
  const preferencesRef = useRef(preferences);
  preferencesRef.current = preferences;
  const blockedRef = useRef(blocked);
  blockedRef.current = blocked;
  const [status, setStatus] = useState<MenuAudioStatus | null>(null);
  const receiveStatus = useCallback((next: MenuAudioStatus) => {
    setStatus(current => JSON.stringify(current) === JSON.stringify(next) ? current : next);
  }, []);
  const unlock = useCallback(async () => {
    const current = audio.current;
    if (!current) return false;
    const enabled = await current.unlock();
    return audio.current === current && enabled;
  }, []);
  const play = useCallback((kind: "navigate" | "select" | "back" | "confirm" | "cancel") => {
    audio.current?.play(kind);
  }, []);
  const nextTrack = useCallback(() => {
    const current = audio.current;
    if (!current || document.hidden || blockedRef.current) return;
    // Start gesture unlock, then dispatch immediately. Media loading never
    // holds up the settings action or any menu navigation.
    void current.unlock();
    current.nextTrack();
  }, []);

  useEffect(() => {
    const instance = new CrownfallMenuAudio({ tracks: resolveCrownfallSoundtrack(new URL(import.meta.env.BASE_URL, document.baseURI)) });
    audio.current = instance;
    const unsubscribe = instance.subscribe(next => { if (audio.current === instance) receiveStatus(next); });
    instance.configure(preferencesRef.current);
    const visibility = () => { instance.setSuspended(document.hidden || blockedRef.current); };
    const gesture = () => { if (!document.hidden) void unlock(); };
    visibility();
    receiveStatus(instance.status);
    document.addEventListener("visibilitychange", visibility);
    document.addEventListener("pointerdown", gesture, true);
    document.addEventListener("keydown", gesture, true);
    return () => {
      document.removeEventListener("visibilitychange", visibility);
      document.removeEventListener("pointerdown", gesture, true);
      document.removeEventListener("keydown", gesture, true);
      unsubscribe();
      if (audio.current === instance) audio.current = null;
      instance.dispose();
    };
  }, [unlock, receiveStatus]);

  useEffect(() => {
    audio.current?.configure(preferences);
    audio.current?.setSuspended(document.hidden || blocked);
  }, [preferences, blocked]);

  const test = useCallback(async () => {
    if (await unlock()) play("confirm");
  }, [play, unlock]);
  /** A film takes the music channel; its release starts a fresh shuffled soundtrack track. The opening is a cinematic (Master volume only). */
  const attachFilm = useCallback((media: HTMLMediaElement, kind?: MenuFilmKind) => audio.current?.attachFilm(media, kind) ?? (() => {}), []);
  const effectsOutput=useCallback(()=>audio.current?.effectsOutput()??null,[]);
  return { status, unlock, play, test, nextTrack, attachFilm, effectsOutput };
}
