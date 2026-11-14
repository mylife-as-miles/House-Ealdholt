/**
 * The four kingdoms, revealed the first time a player opens Classic or Local Duel (the creator's direction of
 * 11 November 2026): a gold crown trembles, light breaks out of it and it bursts; its four pieces fly out tumbling
 * and land in a row, and where each lands a beam of light falls in that kingdom's colour and its flag is raised and
 * flies there, bearing the kingdom's sigil. Then the match setup follows. Original to Crownfall: the crown and the
 * flags were modelled and rendered for this (public/assets/play/kingdoms, see SOURCES.md beside that folder); nothing
 * is taken from another game.
 *
 * The whole sequence is CSS on one timeline (NationsReveal.css) that starts once the crown's pictures have loaded.
 * Any key or click skips to the end of it; Continue (or the same key again) goes on to the setup. With reduced
 * motion the kingdoms are simply shown, their flags still.
 */
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { MATCH_ARMY_CHOICES } from "../../../shared/play/setup";
import type { RevealMoment } from "../../../web/src/audio/opening-cues";
import { InputPrompt, InputPromptContext, useInputPrompts } from "../InputPrompt";
import { useMenuLocale } from "../MenuLocale";
import { subscribeMatchAudioPreferences } from "./match-audio-settings";
import { ARMY_TINT } from "./MatchSetup";
import { useSetupGamepad } from "./useSetupGamepad";
import "./NationsReveal.css";

/** The match's mixer, which plays the reveal's sound; it is loaded with the reveal, never with the menu. */
type RevealMixer = (typeof import("../../../web/src/audio/audioManager"))["audio"];

/** When the last flag is flying and Continue is offered (ms from the timeline's start); matches NationsReveal.css. */
const REVEALED_AT = 4200;
/** The crown's pictures get this long to load before the reveal goes ahead without them. */
const ART_TIMEOUT = 2500;
const SEEN_KEY = "crownfall.play.kingdoms-revealed.v1";
const ART = `${import.meta.env.BASE_URL}assets/play/kingdoms/`;
/** From the crown's render (crown.json beside the pictures): where each piece sits in the crown picture, as fractions
 * of its width (left to right: Aethelgard, Solforiz, Korvenia, Kwind-09), each piece's picture being PIECE_SIZE of it
 * and a strip of PIECE_FRAMES frames. */
const PIECES = [{ x: -0.2434, y: 0.0109 }, { x: -0.0976, y: -0.0717 }, { x: 0.0976, y: 0.0461 }, { x: 0.2434, y: -0.0364 }] as const;
const PIECE_SIZE = 0.7528, PIECE_FRAMES = 24;

/** Whether this player should be shown the reveal now. Skipped under browser automation, so the game's verification
 * scripts open the setup directly; `?reveal=kingdoms` shows it regardless (and again). */
export function shouldRevealKingdoms(): boolean {
  try {
    if (new URLSearchParams(window.location.search).get("reveal") === "kingdoms") return true;
    if (navigator.webdriver) return false;
    return window.localStorage.getItem(SEEN_KEY) !== "1";
  } catch { return false; }
}
function markSeen(): void { try { window.localStorage.setItem(SEEN_KEY, "1"); } catch { /* shown again next time, where storage is refused */ } }

const MOTES = Array.from({ length: 18 }, (_, index) => {
  const seed = Math.sin(index * 53.3) * 43758.5453, unit = seed - Math.floor(seed);
  return { left: (index * 59 + 11) % 100, size: 1.5 + unit * 2.5, duration: 12 + ((index * 5) % 9), delay: -((index * 11) % 19), drift: Math.round((unit - .5) * 160) };
});

export default function NationsReveal({ onDone, onBack, reducedMotion = false }: { onDone(): void; onBack(): void; reducedMotion?: boolean }) {
  const { t } = useMenuLocale();
  const prompts = useInputPrompts();
  const [device, setDevice] = useState(prompts.device);
  // The timeline waits for the crown's pictures and its sound (briefly), so both are there when it starts.
  const [ready, setReady] = useState(reducedMotion);
  // Resolves once the reveal's sound is in hand, or has failed; see the sound below.
  const soundArrived = useRef<() => void>(() => {});
  const soundReady = useRef<Promise<void> | null>(null);
  if (soundReady.current === null) soundReady.current = new Promise<void>((resolve) => { soundArrived.current = resolve; });
  const [revealed, setRevealed] = useState(reducedMotion);
  const [skipped, setSkipped] = useState(reducedMotion);
  const root = useRef<HTMLElement>(null), proceed = useRef<HTMLButtonElement>(null);
  useSetupGamepad(root, onBack, prompts.bindings, setDevice);

  useEffect(() => {
    if (ready) return;
    let live = true;
    const start = () => { if (live) setReady(true); };
    const files = ["crown.webp", "crown-open.webp", ...PIECES.map((_, index) => `piece-${index}.webp`)];
    // On a first, cold load the sound (its mixer and clips) took longer than the pictures and joined the crown's riser
    // part way through; the same time limit holds for both.
    void Promise.allSettled([...files.map(file => { const image = new Image(); image.src = ART + file; return image.decode(); }), soundReady.current]).then(start);
    const timer = window.setTimeout(start, ART_TIMEOUT);
    return () => { live = false; window.clearTimeout(timer); };
  }, [ready]);
  useEffect(() => {
    if (revealed) { proceed.current?.focus({ preventScroll: true }); return; }
    if (!ready) return;
    const timer = window.setTimeout(() => setRevealed(true), REVEALED_AT);
    return () => window.clearTimeout(timer);
  }, [ready, revealed]);
  useEffect(() => { root.current?.focus({ preventScroll: true }); }, []);

  // Its sound (web/src/audio/opening-cues.ts): each cue on the timeline's own time, counted from the moment it starts,
  // under the menu's sound settings. A skip before the pieces have all landed ends it on one soft cue; shown still
  // (reduced motion), that soft cue is all there is.
  const sound = useRef<{ mixer: RevealMixer; moments: readonly RevealMoment[]; landed: number } | null>(null);
  const begun = useRef<number | null>(null);
  const heard = useRef<"nothing" | "timeline" | "settled">("nothing");
  const cut = useRef(skipped); cut.current = skipped;
  const still = useRef(reducedMotion);
  const listen = useRef(() => {});
  listen.current = () => {
    const live = sound.current;
    if (!live || begun.current === null || heard.current === "settled") return;
    const elapsed = (performance.now() - begun.current) / 1000;
    if (cut.current) {
      // Once every piece has landed there is nothing left to cut short: what still rings rings out.
      if (heard.current === "nothing" || elapsed < live.landed) {
        if (heard.current === "timeline") live.mixer.stopReveal(0.12);
        live.mixer.revealCue("settle");
      }
      heard.current = "settled";
      return;
    }
    if (heard.current !== "nothing") return;
    heard.current = "timeline";
    for (const moment of live.moments) live.mixer.revealCue(moment.name, { delay: moment.at - elapsed, index: moment.index });
  };
  useEffect(() => {
    let live = true, unsubscribe = () => {};
    void Promise.all([import("../../../web/src/audio/audioManager"), import("../../../web/src/audio/opening-cues")]).then(([{ audio }, cues]) => {
      if (!live) return;
      unsubscribe = subscribeMatchAudioPreferences((preferences) => audio.configure(preferences));
      void audio.prepareReveal({ still: still.current }).then(() => soundArrived.current());
      const moments = cues.revealSoundSheet();
      sound.current = { mixer: audio, moments, landed: Math.max(...moments.filter((moment) => moment.name === "land").map((moment) => moment.at)) };
      listen.current();
    }, () => { /* Without its mixer the reveal is simply silent. */ soundArrived.current(); });
    return () => { live = false; unsubscribe(); sound.current?.mixer.stopReveal(0.3); sound.current = null; };
  }, []);
  useEffect(() => { if (ready && begun.current === null) { begun.current = performance.now(); listen.current(); } }, [ready]);
  useEffect(() => { if (skipped) listen.current(); }, [skipped]);

  const finish = () => { markSeen(); onDone(); };
  /** The first press shows everything at once; the next goes on. */
  const advance = () => { if (revealed) finish(); else { setSkipped(true); setReady(true); setRevealed(true); } };

  return <InputPromptContext.Provider value={{ device, bindings: prompts.bindings }}><section
    ref={root} tabIndex={-1} className={`nations-reveal${skipped ? " is-skipped" : ""}${reducedMotion ? " is-reduced-motion" : ""}`}
    role="dialog" aria-modal="true" aria-labelledby="nations-reveal-title" data-ready={ready} data-revealed={revealed}
    onPointerDown={(event) => { if (!revealed && !(event.target as HTMLElement).closest("button")) advance(); }}
    onKeyDown={(event) => {
      if (event.key === "Escape" || event.code === prompts.bindings.back) { event.preventDefault(); event.stopPropagation(); onBack(); return; }
      if ((event.key === "Enter" || event.key === " ") && !(revealed && event.target === proceed.current)) { event.preventDefault(); advance(); }
    }}>
    <div className="nr-backdrop" aria-hidden="true" />
    <div className="nr-motes" aria-hidden="true">{MOTES.map((mote, index) => <i key={index} style={{ left: `${mote.left}%`, width: mote.size, height: mote.size,
      animationDuration: `${mote.duration}s`, animationDelay: `${mote.delay}s`, ["--mote-drift" as string]: `${mote.drift}px` }} />)}</div>
    <div className="nr-floor" aria-hidden="true" />

    <header className="nr-header">
      <p className="nr-eyebrow">{t("Crownfall")}</p>
      <h1 id="nations-reveal-title">{t("The Four Kingdoms")}</h1>
      <p className="nr-lead">{t("One crown fell. Four kingdoms took up its pieces.")}</p>
    </header>

    {/* The crown: whole while it trembles, breaking open with light, then each piece flies to its kingdom. */}
    <div className="nr-crown" aria-hidden="true" style={{ ["--piece" as string]: PIECE_SIZE } as CSSProperties}>
      <div className="nr-crown-body">
        <div className="nr-rays" /><div className="nr-crown-glow" />
        <img className="nr-crown-art" src={`${ART}crown.webp`} alt="" draggable={false} />
        <img className="nr-crown-art nr-crown-art--open" src={`${ART}crown-open.webp`} alt="" draggable={false} />
        <div className="nr-core" />
      </div>
      {PIECES.map((piece, index) => <div key={index} className="nr-piece" style={{ ["--i" as string]: index, ["--fx" as string]: piece.x, ["--fy" as string]: piece.y,
        ["--tint" as string]: ARMY_TINT[MATCH_ARMY_CHOICES[index].value] } as CSSProperties}>
        <div className="nr-piece-lift"><i className="nr-piece-art" style={{ backgroundImage: `url("${ART}piece-${index}.webp")`, backgroundSize: `${PIECE_FRAMES * 100}% 100%` }} /></div>
      </div>)}
      <div className="nr-flash" /><div className="nr-ring" />
    </div>

    <ul className="nr-kingdoms">
      {MATCH_ARMY_CHOICES.map((kingdom, index) => <li key={kingdom.value} className="nr-kingdom" data-kingdom={kingdom.value}
        style={{ ["--i" as string]: index, ["--tint" as string]: ARMY_TINT[kingdom.value] } as CSSProperties}>
        <i className="nr-beam" aria-hidden="true" />
        <i className="nr-pedestal" aria-hidden="true" /><i className="nr-ripple" aria-hidden="true" />
        {/* The kingdom's flag, flying: a rendered loop, or one still frame of it where motion is reduced. */}
        <span className="nr-flag" aria-hidden="true"><picture className="nr-flag-cloth">
          {!reducedMotion && <source media="(prefers-reduced-motion: no-preference)" srcSet={`${ART}flag-${index}.webp`} type="image/webp" />}
          <img src={`${ART}flag-${index}-still.webp`} alt="" draggable={false} />
        </picture></span>
        <strong>{kingdom.label}</strong>
        <small>{t(kingdom.detail)}</small>
      </li>)}
    </ul>

    <footer className="nr-footer">
      <span className="nr-hint" aria-hidden="true"><kbd><InputPrompt action="select" /></kbd>{t(revealed ? "Continue" : "Skip")}</span>
      <button ref={proceed} type="button" className="nr-continue" tabIndex={revealed ? 0 : -1} aria-hidden={!revealed} onClick={finish}>
        <span>{t("Choose your battlefield")}</span>
        <svg viewBox="0 0 32 12" fill="none" aria-hidden="true"><path d="M1 6H29M24 1 30 6 24 11" stroke="currentColor" strokeWidth="1.5" /></svg>
      </button>
    </footer>
  </section></InputPromptContext.Provider>;
}
