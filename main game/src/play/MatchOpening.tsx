/**
 * The cards over a match's opening (the creator's direction of 11 November 2026). What is shown and when is decided
 * by shared/play/match-opening.ts and the camera is moved by the scene engine; this draws the letterbox, the
 * battlefield's name, each kingdom under its flag as its army takes the field, and the two against each other, in
 * the setup screen's lettering. Any key, click, tap or controller button skips to the match.
 */
import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { MatchOpeningBeatId, MatchOpeningKingdom, MatchOpeningPlan } from "../../../shared/play/match-opening";
import { MATCH_ARMY_CHOICES } from "../../../shared/play/setup";
import { InputPrompt } from "../InputPrompt";
import { useMenuLocale } from "../MenuLocale";
import { ARMY_TINT } from "./MatchSetup";
import "./MatchOpening.css";
import { connectedGamepads } from "../gamepads";

/** The flags made for the four kingdoms' reveal (public/assets/play/kingdoms), in the setup's order of kingdoms. */
const ART = `${import.meta.env.BASE_URL}assets/play/kingdoms/`;
const flagOf = (kingdom: MatchOpeningKingdom) => `${ART}flag-${Math.max(0, MATCH_ARMY_CHOICES.findIndex((choice) => choice.value === kingdom.army))}.webp`;
const tintOf = (kingdom: MatchOpeningKingdom) => ({ ["--tint" as string]: ARMY_TINT[kingdom.army] }) as CSSProperties;

export default function MatchOpening({ plan, beat, onSkip }: { plan: MatchOpeningPlan; beat: MatchOpeningBeatId; onSkip(): void }) {
  const { t } = useMenuLocale();
  const root = useRef<HTMLDivElement>(null);
  const [touch] = useState(() => { try { return window.matchMedia("(pointer: coarse)").matches; } catch { return false; } });
  const skip = useRef(onSkip);
  skip.current = onSkip;
  useEffect(() => { root.current?.focus({ preventScroll: true }); }, []);
  // A controller: any button pressed after the opening began skips it (one held from the setup screen does not).
  useEffect(() => {
    let frame = 0, armed = false;
    const poll = () => {
      const pressed = Array.from(connectedGamepads()).some((pad) => pad?.buttons.some((button) => button.pressed));
      if (!pressed) armed = true;
      else if (armed) { skip.current(); return; }
      frame = requestAnimationFrame(poll);
    };
    frame = requestAnimationFrame(poll);
    return () => cancelAnimationFrame(frame);
  }, []);

  const { w, b } = plan.kingdoms, left = plan.kingdoms[plan.left], right = plan.kingdoms[plan.left === "w" ? "b" : "w"];
  const mustering = beat === "white" ? w : beat === "black" ? b : null;
  // How long this beat lasts, so its card can be gone before the cut that ends it. The camera cuts a frame or more
  // before the cards change, and a card still up at the cut was seen over the next shot's first frames.
  const seconds = plan.beats.find((entry) => entry.id === beat)?.shot.seconds;
  return <div ref={root} tabIndex={-1} className="match-opening" data-beat={beat} data-cut={plan.cut}
    style={seconds ? { ["--mo-beat" as string]: `${seconds}s` } as CSSProperties : undefined}
    onPointerDown={() => skip.current()}
    onKeyDown={(event) => {
      if (["Shift", "Control", "Alt", "Meta", "Tab"].includes(event.key)) return;
      event.preventDefault(); event.stopPropagation(); skip.current();
    }}>
    <p className="match-sr" role="status">{`${left.name} ${t("against")} ${right.name}. ${t(plan.battlefield.title)}. ${t("Press any key to skip.")}`}</p>
    <i className="mo-bar mo-bar--top" aria-hidden="true" /><i className="mo-bar mo-bar--bottom" aria-hidden="true" />

    {beat === "arena" && <header key="arena" className="mo-title" aria-hidden="true">
      <p className="mo-eyebrow">{t(plan.mode)}</p>
      <h1>{t(plan.battlefield.title)}</h1>
      <p className="mo-lead">{t(plan.battlefield.description)}</p>
    </header>}

    {mustering && <div key={mustering.side} className={`mo-kingdom mo-kingdom--${mustering.side === "w" ? "first" : "second"}`} style={tintOf(mustering)} aria-hidden="true">
      <span className="mo-flag"><img src={flagOf(mustering)} alt="" draggable={false} /></span>
      <div className="mo-kingdom-text">
        <p className="mo-eyebrow">{t(mustering.role)}</p>
        <h2>{mustering.name}</h2>
        <p className="mo-detail">{t(mustering.detail)}</p>
      </div>
    </div>}

    {/* Still up as the camera swings round to the match, where it fades: there is no cut there to take it away. */}
    {(beat === "versus" || beat === "begin") && <div key="versus" className="mo-versus" aria-hidden="true">
      {[left, right].map((kingdom, index) => <div key={kingdom.side} className={`mo-side mo-side--${index ? "right" : "left"}`} style={tintOf(kingdom)}>
        <span className="mo-flag"><img src={flagOf(kingdom)} alt="" draggable={false} /></span>
        <div><h2>{kingdom.name}</h2><p className="mo-eyebrow">{t(kingdom.role)}</p></div>
      </div>)}
      <b>{t("vs")}</b>
    </div>}

    {/* A touch screen has no Enter key to show: it is told to tap. */}
    <span className="mo-skip" aria-hidden="true">{touch ? t("Tap to skip") : <><kbd><InputPrompt action="select" /></kbd>{t("Skip")}</>}</span>
  </div>;
}
