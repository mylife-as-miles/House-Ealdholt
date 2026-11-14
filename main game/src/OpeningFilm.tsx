import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { createPortal } from 'react-dom';
import { InputPrompt } from './InputPrompt';
import { useMenuLocale } from './MenuLocale';
import LaunchArtwork from './LaunchArtwork';
import {
  OPENING_FILMS, OPENING_FILM_COPY, STORY_CINEMATIC_COPY, openingFilmIsStory, openingFilmPlayback, openingFilmStatus, resolveOpeningFilm,
  type OpeningFilmEvent, type OpeningFilmState,
} from "../../shared/menu/opening-film";
import { CreditsFilmPlayer } from "../../shared/menu/credits-film-player";
import type { MenuFilmKind } from "../../shared/menu/audio";
import "./CreditsFilm.css";
import "./OpeningFilm.css";

export interface OpeningFilmHandle {
  focus(): void;
}

export interface OpeningFilmProps {
  state: OpeningFilmState;
  /** Routes the film through the menu audio graph as a cinematic; returns its release. */
  attachAudio(media: HTMLVideoElement, kind: MenuFilmKind): () => void;
  onEvent(event: OpeningFilmEvent): void;
  onSkip(): void;
  reducedMotion: boolean;
}

/**
 * A story film fills the viewport while the menu waits, inert, beneath it: the
 * whole opening the first time Crownfall starts, its title sequence afterwards,
 * the whole opening again from Credits, the Story-mode prologue from Chapters,
 * or the House Ealdholt opening before a first visit to My Legacy's village.
 * Startup cuts download behind launch artwork; the story cinematics (the
 * Prologue and the House Ealdholt opening) stream directly, without that
 * artwork, and offer the one Skip cinematic action. Back, Esc and gamepad B
 * skip; Space, Enter and gamepad A pause and resume (App routes those keys).
 */
export const OpeningFilm = forwardRef<OpeningFilmHandle, OpeningFilmProps>(function OpeningFilm({ state, attachAudio, onEvent, onSkip, reducedMotion }, ref) {
  const { t } = useMenuLocale();
  const story = openingFilmIsStory(state.cut);
  const root = useRef<HTMLElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const player = useRef<CreditsFilmPlayer | null>(null);
  const started = useRef(0);
  const [mediaUrl, setMediaUrl] = useState<string | null>(null);
  const [frameReady, setFrameReady] = useState(false);
  const events = useRef(onEvent);
  events.current = onEvent;
  const attach = useRef(attachAudio);
  attach.current = attachAudio;
  const cut = useRef(state.cut);
  const waiting = state.phase === "waiting";
  const paused = state.phase === "paused";
  const status = openingFilmStatus(state);

  useImperativeHandle(ref, () => ({ focus() { root.current?.focus({ preventScroll: true }); } }), []);

  // Only startup/replay cuts use launch artwork and a complete download; story playback streams.
  useEffect(() => {
    if (openingFilmIsStory(cut.current)) {
      setMediaUrl(resolveOpeningFilm(cut.current, new URL(import.meta.env.BASE_URL, document.baseURI)));
      return;
    }
    const controller = new AbortController(); let url: string | null = null;
    void fetch(resolveOpeningFilm(cut.current, new URL(import.meta.env.BASE_URL, document.baseURI)), { signal: controller.signal })
      .then(response => { if (!response.ok) throw new Error(`Opening film: HTTP ${response.status}`); return response.blob(); })
      .then(blob => { if (!controller.signal.aborted) { url = URL.createObjectURL(blob); setMediaUrl(url); } })
      .catch(() => { if (!controller.signal.aborted) events.current({ type: 'failed' }); });
    return () => { controller.abort(); if (url) URL.revokeObjectURL(url); };
  }, []);

  useEffect(() => {
    const element = video.current;
    if (!element || !mediaUrl) return;
    const instance = new CreditsFilmPlayer(element, {
      src: mediaUrl,
      onEvent: (event) => events.current({ type: event }),
    });
    const release = attach.current(element, "cinematic");
    player.current = instance;
    started.current = 0;
    const visibility = () => { if (document.hidden) events.current({ type: "pause" }); };
    document.addEventListener("visibilitychange", visibility);
    return () => {
      document.removeEventListener("visibilitychange", visibility);
      if (player.current === instance) player.current = null;
      release();
      instance.dispose();
    };
  }, [mediaUrl]);

  useEffect(() => {
    const instance = player.current;
    if (!instance) return;
    const playback = openingFilmPlayback(state, document.hidden);
    if (playback === "hold") { events.current({ type: 'begin' }); }
    // Request sound immediately; autoplay refusal falls back to continuous muted playback.
    else if (playback === "play" && started.current !== state.sequence) {
      started.current = state.sequence;
      instance.start(true);
    }
    else if (playback === "play") instance.resume(state.notice !== 'muted');
    else if (playback === "pause") {
      instance.pause();
      // Held back only because the tab is hidden (the film opened behind another tab, U-06): say so as a pause, so the
      // player comes back to "Paused / Resume" instead of a black "Starting the film…" that nothing re-evaluates.
      if (state.phase !== "paused") events.current({ type: "pause" });
    }
  }, [state, mediaUrl]);

  // Restore audio on an ordinary interaction; autoplay never waits for a sound button.
  useEffect(() => {
    if (state.notice !== 'muted') return;
    const unmute = () => { if (!video.current?.paused) player.current?.resume(true); };
    document.addEventListener('pointerdown', unmute, true);
    document.addEventListener('keydown', unmute, true);
    return () => {
      document.removeEventListener('pointerdown', unmute, true);
      document.removeEventListener('keydown', unmute, true);
    };
  }, [state.notice]);

  const film = OPENING_FILMS[state.cut];
  const describedBy = `opening-film-description-${state.cut}`;
  return createPortal(<section
    ref={root}
    className={`credits-film opening-film${paused ? " is-paused" : ""}${waiting ? " is-waiting" : ""}${reducedMotion ? " is-still" : ""}`}
    role="dialog"
    aria-modal="true"
    aria-label={t(OPENING_FILM_COPY.accessibleName[state.cut])}
    aria-describedby={describedBy}
    tabIndex={-1}
    data-opening-film={state.phase}
    data-opening-cut={state.cut}
    data-opening-origin={state.origin}
  >
    <video
      ref={video}
      className="credits-film-video"
      width={film.width}
      height={film.height}
      data-source={film.src}
      onLoadedData={() => setFrameReady(true)}
      onVolumeChange={() => { if (video.current && !video.current.muted) onEvent({ type: 'audible' }); }}
      aria-label={t(OPENING_FILM_COPY.accessibleName[state.cut])}
      aria-describedby={describedBy}
      onClick={story ? undefined : () => onEvent({ type: "toggle" })}
    />
    <p id={describedBy} className="credits-film-visually-hidden">{t(OPENING_FILM_COPY.description[state.cut])} {OPENING_FILM_COPY.bylines[state.cut]}.</p>
    {!story && (!frameReady || state.phase === 'starting') && <LaunchArtwork />}
    <p className={`credits-film-status${paused ? " is-shown" : ""}`} role="status" aria-live="polite">{paused ? status : ''}</p>
    <footer className="credits-film-hint" aria-label="Opening controls" onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') event.stopPropagation(); }}>
      {!story && <button type="button" className="credits-film-control" aria-label={paused ? OPENING_FILM_COPY.resume : OPENING_FILM_COPY.pause} onClick={() => onEvent({ type: "toggle" })}>
          <span className="credits-film-prompt" aria-hidden="true"><InputPrompt action="select" /></span>{paused ? OPENING_FILM_COPY.resume : OPENING_FILM_COPY.pause}
      </button>}
      <button type="button" className="credits-film-control" aria-label={t(story ? STORY_CINEMATIC_COPY.skip : OPENING_FILM_COPY.skip)} title={`${OPENING_FILM_COPY.skip} ${OPENING_FILM_COPY.titles[state.cut]}`} onClick={onSkip}>
        <span className="credits-film-prompt" aria-hidden="true"><InputPrompt action="back" /></span>{t(story ? STORY_CINEMATIC_COPY.skip : OPENING_FILM_COPY.skip)}
      </button>
    </footer>
  </section>, document.body);
});

export default OpeningFilm;
