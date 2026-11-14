import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { InputPrompt } from './InputPrompt';
import {
  CREDITS_FILM, CREDITS_FILM_COPY, creditsFilmPlayback, creditsFilmStatus, resolveCreditsFilm,
  type CreditsFilmEvent, type CreditsFilmState,
} from "../../shared/menu/credits-film";
import { CreditsFilmPlayer } from "../../shared/menu/credits-film-player";
import "./CreditsFilm.css";

export interface CreditsFilmHandle {
  focus(): void;
}

export interface CreditsFilmProps {
  state: CreditsFilmState;
  /** Routes the film through the menu audio graph; returns its release. */
  attachAudio(media: HTMLVideoElement): () => void;
  onEvent(event: CreditsFilmEvent): void;
  onBack(): void;
  reducedMotion: boolean;
}

/**
 * The end-credits film fills the menu stage while the rest of the menu is
 * inert beneath it. Back, Esc and gamepad B skip it; Space, Enter and gamepad
 * A pause and resume (App routes those keys). Leaving opens the Credits page.
 */
export const CreditsFilm = forwardRef<CreditsFilmHandle, CreditsFilmProps>(function CreditsFilm({ state, attachAudio, onEvent, onBack, reducedMotion }, ref) {
  const root = useRef<HTMLElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const player = useRef<CreditsFilmPlayer | null>(null);
  const started = useRef(0);
  const events = useRef(onEvent);
  events.current = onEvent;
  const attach = useRef(attachAudio);
  attach.current = attachAudio;
  const paused = state.phase === "paused";
  const status = creditsFilmStatus(state);

  useImperativeHandle(ref, () => ({ focus() { root.current?.focus({ preventScroll: true }); } }), []);

  useEffect(() => {
    const element = video.current;
    if (!element) return;
    const instance = new CreditsFilmPlayer(element, {
      src: resolveCreditsFilm(new URL(import.meta.env.BASE_URL, document.baseURI)),
      // The end credits never hold for a press ('blocked' belongs to the opening).
      onEvent: (event) => { if (event !== "blocked") events.current({ type: event }); },
    });
    const release = attach.current(element);
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
  }, []);

  useEffect(() => {
    const instance = player.current;
    if (!instance) return;
    const playback = creditsFilmPlayback(state, document.hidden);
    // Every opening comes from a click, key or button press, so sound is requested
    // in that input's activation; a refusal continues silently with a notice.
    if (playback === "play" && started.current !== state.sequence) { started.current = state.sequence; instance.start(true); }
    else if (playback === "play") instance.resume(true);
    else if (playback === "pause") instance.pause();
  }, [state]);

  return <section
    ref={root}
    className={`credits-film${paused ? " is-paused" : ""}${reducedMotion ? " is-still" : ""}`}
    role="dialog"
    aria-modal="true"
    aria-label={CREDITS_FILM_COPY.accessibleName}
    aria-describedby="credits-film-description"
    tabIndex={-1}
    data-credits-film={state.phase}
  >
    <video
      ref={video}
      className="credits-film-video"
      width={CREDITS_FILM.width}
      height={CREDITS_FILM.height}
      aria-label={CREDITS_FILM_COPY.accessibleName}
      aria-describedby="credits-film-description"
      onClick={() => onEvent({ type: "toggle" })}
    />
    <p id="credits-film-description" className="credits-film-visually-hidden">{CREDITS_FILM_COPY.description} {CREDITS_FILM_COPY.byline}.</p>
    <p className={`credits-film-status${status ? " is-shown" : ""}`} role="status" aria-live="polite">{status}</p>
    <footer className="credits-film-hint" aria-label="End credits controls" onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') event.stopPropagation(); }}>
      <button type="button" className="credits-film-control" aria-label={paused ? CREDITS_FILM_COPY.resume : CREDITS_FILM_COPY.pause} onClick={() => onEvent({ type: "toggle" })}>
        <span className="credits-film-prompt" aria-hidden="true"><InputPrompt action="select" /></span>{paused ? CREDITS_FILM_COPY.resume : CREDITS_FILM_COPY.pause}
      </button>
      <button type="button" className="credits-film-control" aria-label={CREDITS_FILM_COPY.back} title={`${CREDITS_FILM_COPY.skip} ${CREDITS_FILM_COPY.title}`} onClick={onBack}>
        <span className="credits-film-prompt" aria-hidden="true"><InputPrompt action="back" /></span>{CREDITS_FILM_COPY.back}
      </button>
    </footer>
  </section>;
});

export default CreditsFilm;
