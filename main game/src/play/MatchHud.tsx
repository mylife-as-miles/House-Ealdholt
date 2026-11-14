/**
 * The interface drawn over a match in play, in the match setup's design (MatchSetup.css; My Legacy's observer wears
 * the same): blurred panels under a fading orange rule, quiet uppercase headings after small orange glyphs, tiles,
 * rows with a kingdom's stripe, the diamond medallion with the kingdom's sigil, the menu's key chips and one orange
 * call to action.
 *
 * Where things stand. The two kingdoms, top left: who leads each, its clock, what it has taken; the side to move is
 * lit in its kingdom's colour and says so, and a computer that failed is retried there. The actions, in a bar top
 * right, with the move record under it. A fight's or the ending's skip prompt, bottom left. The board fills the
 * middle and the bottom of every screen and the fallen stand beside it, so nothing is kept there: only the promotion
 * picker, the result and the confirm dialog come over it, each when it must be answered.
 *
 * A wide stage holds everything open. A narrower one (4:3, a phone) folds the move record to its heading and puts
 * resigning, the rematch and leaving under a Menu button (match-hud-model.ts, hudTier).
 *
 * The promotion picker can be backed out of (its Back, Escape, a controller's back button, the mouse's other button on
 * the board): nothing is played and the Pawn is in hand again.
 *
 * Keys: U takes a move back, F flips the board, R puts the view back as the game frames it, M turns the sound on and
 * off (on the board itself, Shift with the arrows turns and tilts the view and + and - pull it in and out:
 * MatchExperience.tsx); Escape skips a fight or the ending and
 * closes what is open, and when it has nothing else to do it opens the pause menu (MatchPause.tsx), as do the pause
 * tile at the start of the bar and a controller's Start. A controller plays the board and reaches these controls too
 * (useMatchGamepad.ts). The key chips show the keyboard's keys or the controller's buttons, whichever was used last,
 * and none on a touch screen.
 *
 * A move queued while the board was busy is shown on the board itself; where a fight's skip prompt stands, a prompt
 * calls it off (Escape, a controller's back button, the mouse's other button on the board).
 *
 * How the view is turned from the device in use is a quiet line under the move record until the view has been turned
 * once, and is always in the pause menu.
 */
import { useEffect, useId, useLayoutEffect, useRef, useState, type MouseEvent, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { ARMY_KINGDOMS, BATTLEFIELDS, type ArmyId, type MatchArmies, type MatchConfig } from "../../../shared/play/match";
import { MATCH_ARMY_CHOICES } from "../../../shared/play/setup";
import type { Chronicle } from "../../../shared/play/chronicle";
import { PIECE_LABEL, type Faction, type GameSnapshot } from "../../../web/src/core/types";
import { InputPromptContext, useInputPrompts } from "../InputPrompt";
import { promptLabel, type InputDevice } from "../input-prompts";
import { useMenuLocale } from "../MenuLocale";
import { ARMY_TINT, KingdomSigil } from "./MatchSetup";
import {
  activeSide, capturedBy, formatClock, hudTier, materialLead, movePairs, resultSummary, sideRole, sideState, stageSize, statusLine, viewHints,
  type HudTier, type SideState,
} from "./match-hud-model";
import { useMatchGamepad } from "./useMatchGamepad";
import { promotionKeyAction } from "../../../web/src/scene/promotion/promotionChoice";
import { Arrow, Glyph, Key, MatchConfirm, PieceGlyph, tintOf, ViewHints, type ConfirmCopy } from "./MatchHudParts";
import MatchPause, { type MatchPauseHandle } from "./MatchPause";
import "./MatchHud.css";

export type MatchConfirmAction = "leave" | "restart" | "resign";
export type PromotionKind = "q" | "r" | "b" | "n";

export interface MatchHudActions {
  undo(): void;
  flip(): void;
  /** Turn, tilt and pull the view by hand (radians, radians, share of the distance), and put it back as the game frames it. */
  look(yaw: number, pitch: number, zoom: number): void;
  resetView(): void;
  toggleSound(): void;
  setBrightness(value: number): void;
  /** Ask before leaving, starting again or resigning. */
  ask(action: MatchConfirmAction): void;
  retryComputer(): void;
  togglePause(): void;
  skipEnding(): void;
  skipFight(): void;
  /** Let go of the piece held, and call off the move queued, while the board is busy. */
  cancelQueued(): void;
  promote(kind: PromotionKind): void;
  /** Focus a candidate on the board's picker (its row hovered or in focus here); nothing is chosen. */
  focusPromotion(kind: PromotionKind): void;
  /** Move the picker's focus along, wrapping round (the arrows with the focus here). */
  movePromotionFocus(step: number): void;
  /** Choose the candidate in focus. */
  confirmPromotion(): void;
  /** Back out of the promotion picker: nothing is played, and the Pawn is in hand again. */
  cancelPromotion(): void;
  /** Absent where a replay cannot be watched from here. */
  watchReplay?(): void;
  saveReplay(): void;
  playAgain(): void;
  changeBattlefield(): void;
  /** Hand the keyboard back to the board. */
  focusBoard(): void;
  /** Open the pause menu (the match is held while it is open), and close it again. */
  pause(): void;
  resume(): void;
  /** A sound through the match's own mixer, for the Audio page's Test Sound. */
  testSound(): void;
}

export interface MatchHudProps {
  config: MatchConfig;
  armies: MatchArmies;
  snapshot: GameSnapshot | null;
  /** Each side's clock as it reads now, or null in an untimed match. */
  clocks: Record<Faction, string> | null;
  reducedMotion: boolean;
  /** The ending is being played, a fight is on stage, a pawn waits to be promoted. */
  conclusion: boolean;
  fighting: boolean;
  promotion: boolean;
  /** The candidate the board's picker has in focus: its row is highlighted here. */
  promotionFocus?: PromotionKind;
  muted: boolean;
  brightness: number;
  /** A finished match's replay is ready to watch or save; `saving` while it is being written; what came of saving. */
  replayReady: boolean;
  savingReplay: boolean;
  replayNotice: string;
  legacyNotice: string;
  /** What the battle meant (shared/play/chronicle.ts), written by the ending, shown under the result. */
  chronicle?: Chronicle | null;
  /** The question being asked, if any, and its two answers. */
  confirm: MatchConfirmAction | null;
  onConfirmCancel(): void;
  onConfirmAccept(): void;
  actions: MatchHudActions;
  /** The pause menu is open. */
  pauseOpen: boolean;
  /** A piece held while the board is busy (`to` null), or the move queued for it. */
  queued: { from: string; to: string | null } | null;
  /** The view has been turned from the keys or a controller in this match: its controls need not be shown again. */
  viewFound: boolean;
  /** The renderer's hidden figures, read by the game's checks; they stay in the move record. */
  children?: ReactNode;
}

/** The setup's drifting motes, fewer, for the result panel (placed once, seeded, so they do not jump). */
const MOTES = (() => {
  let seed = 11;
  const next = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  return Array.from({ length: 14 }, (_, i) => ({
    left: next() * 100, size: 2 + next() * 3, delay: -next() * 14, duration: 9 + next() * 9, drift: (next() - 0.5) * 60,
    color: i % 3 === 0 ? "#f0a64a" : "#63edce",
  }));
})();
function Motes() {
  return <div className="hud-motes" aria-hidden="true">{MOTES.map((mote, index) => <i key={index} style={{ left: `${mote.left}%`, width: mote.size, height: mote.size, animationDelay: `${mote.delay}s`, animationDuration: `${mote.duration}s`, ["--mote-drift" as string]: `${mote.drift}px`, ["--mote-color" as string]: mote.color }} />)}</div>;
}

/** The flag made for a kingdom (public/assets/play/kingdoms, in the setup's order of kingdoms): flying, or still where
 * motion is reduced. The match's opening raises the same flags. */
const flagOf = (army: ArmyId, still: boolean) => `${import.meta.env.BASE_URL}assets/play/kingdoms/flag-${Math.max(0, MATCH_ARMY_CHOICES.findIndex((choice) => choice.value === army))}${still ? "-still" : ""}.webp`;

/** The buttons a controller shows for the two board actions it has of its own, and for reaching the HUD. */
/** The buttons a controller shows for the two board actions it has of its own, for the pause menu (Menu, Options, +)
 * and for reaching the HUD's controls (View, Create, −). */
const PAD: Record<Exclude<InputDevice, "keyboard">, { undo: string; flip: string; pause: string; hud: string }> = {
  xbox: { undo: "X", flip: "Y", pause: "≡", hud: "⧉" },
  playstation: { undo: "□", flip: "△", pause: "≡", hud: "⧉" },
  nintendo: { undo: "Y", flip: "X", pause: "+", hud: "−" },
};

/** The stage's size class, measured from the HUD itself so a pillarboxed screen counts as what it shows. */
function useStage(root: RefObject<HTMLElement | null>): { tier: HudTier; width: number } {
  const [stage, setStage] = useState(() => { const [width, height] = stageSize(window.innerWidth, window.innerHeight); return { tier: hudTier(width, height), width }; });
  useLayoutEffect(() => {
    const element = root.current;
    if (!element) return;
    const measure = () => setStage((now) => {
      const tier = hudTier(element.clientWidth, element.clientHeight), width = element.clientWidth;
      return now.tier === tier && now.width === width ? now : { tier, width };
    });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [root]);
  return stage;
}

/* ------------------------------------------------------------------ a kingdom's plate */

const STATE_LABEL: Partial<Record<SideState, string>> = { move: "To move", thinking: "Thinking…", check: "Check", paused: "Paused", won: "Victory" };

function Plate({ side, army, foe, role, state, lit, clock, low, snapshot }: {
  side: Faction; army: ArmyId; foe: ArmyId; role: string; state: SideState; lit: boolean; clock: string | null; low: boolean; snapshot: GameSnapshot | null;
}) {
  const { t } = useMenuLocale();
  const name = ARMY_KINGDOMS[army];
  const taken = capturedBy(snapshot?.captured ?? [], side);
  const lead = materialLead(snapshot?.materialDiff ?? 0, side);
  const label = STATE_LABEL[state];
  return <li className="hud-plate" data-side={side} data-state={state} data-lit={lit || undefined} style={tintOf(army)}>
    <span className="hud-medal"><KingdomSigil army={army} /></span>
    <span className="hud-plate-id">
      <span className="hud-plate-name">{name}</span>
      <small>{t(role)}</small>
    </span>
    {clock && <span className="hud-clock match-clocks" role="timer" aria-label={`${name} ${t("Clock")}`} data-low={low || undefined}><b>{clock}</b><i>{t("min")}</i></span>}
    <span className="hud-plate-foot">
      {label && <span className="hud-chip" data-state={state}>{state === "won" && <Glyph name="crown" />}{t(label)}</span>}
      {(taken.length > 0 || lead > 0) && <span className="hud-taken" style={{ ["--foe-tint" as string]: ARMY_TINT[foe] }} role="img" aria-label={`${t("Captured")}: ${taken.map((group) => `${group.count > 1 ? `${group.count} × ` : ""}${t(PIECE_LABEL[group.kind])}`).join(", ")}${lead > 0 ? ` (+${lead})` : ""}`}>
        {taken.map((group) => <span key={group.kind}><PieceGlyph kind={group.kind} />{group.count > 1 && group.count}</span>)}
        {lead > 0 && <b>+{lead}</b>}
      </span>}
    </span>
  </li>;
}

/* ------------------------------------------------------------------ the HUD */

export default function MatchHud({
  config, armies, snapshot, clocks, reducedMotion, conclusion, fighting, promotion, promotionFocus = "q", muted, brightness,
  replayReady, savingReplay, replayNotice, legacyNotice, chronicle, confirm, onConfirmCancel, onConfirmAccept, actions, pauseOpen, queued, viewFound, children,
}: MatchHudProps) {
  const { t, locale } = useMenuLocale();
  const prompts = useInputPrompts();
  const [device, setDevice] = useState<InputDevice>(prompts.device);
  const root = useRef<HTMLDivElement>(null);
  const stage = useStage(root);
  const { tier } = stage;
  const [touch] = useState(() => { try { return window.matchMedia("(pointer: coarse)").matches; } catch { return false; } });
  // The move record: open or folded as the player left it, else open only where the stage has room for it.
  const [ledgerChoice, setLedgerChoice] = useState<boolean | null>(null);
  const ledgerOpen = ledgerChoice ?? tier === "wide";
  const [pop, setPop] = useState<"menu" | "brightness" | null>(null);
  const ledgerId = useId(), brightnessId = useId(), menuId = useId();
  const list = useRef<HTMLOListElement>(null);

  const nameOf = (side: Faction) => ARMY_KINGDOMS[armies[side]];
  const result = snapshot?.result ?? null;
  const status = statusLine(snapshot, nameOf);
  const lit = activeSide(snapshot);
  const moves = snapshot?.sanList ?? [];
  const pairs = movePairs(moves);
  const latest = moves.length ? `${Math.ceil(moves.length / 2)}${moves.length % 2 ? "." : "…"} ${moves[moves.length - 1]}` : "";
  const canUndo = !result && !!snapshot?.canUndo && !snapshot.busy && !snapshot.thinking;
  const canResign = config.mode !== "ai-battle" && snapshot?.status === "playing" && !snapshot.busy && !snapshot.thinking;
  const pad = device === "keyboard" ? null : PAD[device];
  // Escape on a keyboard whatever the menu's own bindings are: the board and the dialog answer that key itself.
  const backKey = touch ? null : pad ? promptLabel("back", device, prompts.bindings) : "Esc";
  const keys = touch ? {} : pad ? { undo: pad.undo, flip: pad.flip, pause: pad.pause } : { undo: "U", flip: "F", sound: "M", pause: "Esc" };

  // The latest move is kept in view as the record grows.
  useEffect(() => { if (list.current) list.current.scrollTop = list.current.scrollHeight; }, [moves.length, ledgerOpen]);
  // A menu shut by the stage growing wide is not left open behind it.
  useEffect(() => { if (tier === "wide") setPop((open) => (open === "menu" ? null : open)); }, [tier]);
  // What is open closes on a press anywhere else.
  useEffect(() => {
    if (!pop) return;
    const close = (event: PointerEvent) => { if (!(event.target instanceof Element && event.target.closest(".hud-pop, [data-hud-opens]"))) setPop(null); };
    document.addEventListener("pointerdown", close, true);
    return () => document.removeEventListener("pointerdown", close, true);
  }, [pop]);

  // A long translation can make the bar too wide to stand beside the kingdoms: its first tiles then drop their words.
  const [crowded, setCrowded] = useState(false);
  useLayoutEffect(() => { setCrowded(false); }, [tier, locale, stage.width]);
  useLayoutEffect(() => {
    if (crowded || !root.current) return;
    // Laid-out widths, not where the panels are drawn: both are still swinging in when this first runs.
    const left = root.current.querySelector<HTMLElement>(".hud-left"), bar = root.current.querySelector<HTMLElement>(".hud-bar");
    if (left && bar && left.offsetLeft * 2 + left.offsetWidth + 8 + bar.offsetWidth > root.current.clientWidth) setCrowded(true);
  }, [crowded, tier, locale, stage.width]);

  // The keys and the controller read the match as it is now, not as it was when they were set up.
  const live = useRef({ actions, promotion, conclusion, fighting, confirm, pop, canUndo, pauseOpen, queued });
  live.current = { actions, promotion, conclusion, fighting, confirm, pop, canUndo, pauseOpen, queued };
  const pauseMenu = useRef<MatchPauseHandle>(null);
  // The board's focus moved (its arrows, a pointer over a figure, the controller): a row of the panel in focus here
  // follows it, so the one Enter or select would press is always the one lifted on the board.
  useEffect(() => {
    const panel = root.current?.querySelector<HTMLElement>(".match-promotion");
    if (!panel) return;
    const active = document.activeElement;
    const following = (active instanceof HTMLElement && panel.contains(active) && active.matches(".hud-choice")) || root.current?.dataset.hudInput === "gamepad";
    const row = panel.querySelector<HTMLElement>(`.hud-choice[data-promotion="${promotionFocus}"]`);
    if (following && row && row !== active) row.focus({ preventScroll: true });
  }, [promotionFocus, promotion]);
  useEffect(() => {
    const host = root.current?.closest<HTMLElement>(".match-experience");
    if (!host) return;
    const onKey = (event: KeyboardEvent) => {
      const now = live.current;
      if (!event.isTrusted || event.ctrlKey || event.metaKey || event.altKey || now.confirm || now.pauseOpen) return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      // With the focus on the board, its own handler answers Escape and the promotion keys.
      const onBoard = target instanceof HTMLCanvasElement;
      const key = event.key.toLowerCase();
      if (now.promotion) {
        const action = onBoard ? null : promotionKeyAction(event.key);
        if (!action) return;
        if (action.type === "choose") now.actions.promote(action.kind);
        else if (action.type === "move") now.actions.movePromotionFocus(action.step);
        // A row in focus here is pressed as any button is (it is the one in focus on the board too).
        else if (action.type === "confirm") { if (target?.matches(".hud-choice")) return; now.actions.confirmPromotion(); }
        else now.actions.cancelPromotion();
        event.preventDefault();
        return;
      }
      if (event.key === "Escape") {
        if (now.pop) {
          // Closing from inside what was opened leaves the focus on the tile that opened it.
          if (target?.closest(".hud-pop")) root.current?.querySelector<HTMLElement>('[data-hud-opens][aria-expanded="true"]')?.focus();
          setPop(null);
        } else if (!onBoard) {
          // As on the board: a fight or the ending is skipped first, then what is held or queued is let go.
          if (now.conclusion) now.actions.skipEnding(); else if (now.fighting) now.actions.skipFight(); else if (now.queued) now.actions.cancelQueued(); else now.actions.pause();
        }
        return;
      }
      if (event.repeat || target?.matches("input, textarea, select")) return;
      if (key === "u") { if (now.canUndo) now.actions.undo(); }
      else if (key === "f") now.actions.flip();
      else if (key === "r") now.actions.resetView();
      else if (key === "m") now.actions.toggleSound();
      else return;
      event.preventDefault();
    };
    host.addEventListener("keydown", onKey);
    return () => host.removeEventListener("keydown", onKey);
  }, []);
  useMatchGamepad(root, {
    undo: () => { if (live.current.canUndo) live.current.actions.undo(); },
    flip: () => live.current.actions.flip(),
    look: (yaw, pitch, zoom) => live.current.actions.look(yaw, pitch, zoom),
    resetView: () => live.current.actions.resetView(),
    dismiss: () => setPop(null),
    // Start opens the pause menu, and closes it again; not while a pawn waits to be promoted.
    togglePause: () => { const now = live.current; if (now.pauseOpen) now.actions.resume(); else if (!now.promotion) now.actions.pause(); },
    pauseMenu: () => (live.current.pauseOpen ? pauseMenu.current : null),
  }, setDevice);

  // A pointer's press on an action hands the keyboard back to the board, so the arrows and Enter go on playing it. A
  // press made from the keyboard or a controller stays where it is.
  const press = (run: () => void) => (event: MouseEvent<HTMLButtonElement>) => { run(); if (event.detail > 0) actions.focusBoard(); };
  // A question is asked from where the focus should return if it is declined: the board after a pointer's press, the
  // Menu tile when the button pressed is about to close with its menu.
  const ask = (action: MatchConfirmAction) => (event: MouseEvent<HTMLButtonElement>) => {
    if (event.detail > 0) actions.focusBoard();
    else if (event.currentTarget.closest(".hud-pop")) root.current?.querySelector<HTMLElement>('[data-hud-opens][aria-expanded="true"]')?.focus();
    setPop(null);
    actions.ask(action);
  };
  const toggle = (which: "menu" | "brightness") => () => setPop((open) => (open === which ? null : which));

  const menuStage = root.current?.closest<HTMLElement>(".menu-stage") ?? null;
  const pauseLayer = (menu: ReactNode) => (menuStage ? createPortal(menu, menuStage) : menu);
  const battlefield = BATTLEFIELDS.find((item) => item.id === config.setting);
  const summary = result ? resultSummary(result, nameOf) : null;
  const matchActions = <>
    {config.mode === "ai-battle" && <button type="button" className="hud-tile" onClick={press(actions.togglePause)}><Glyph name={snapshot?.paused ? "play" : "pause"} /><span className="hud-label">{t(snapshot?.paused ? "Resume battle" : "Pause battle")}</span></button>}
    <button type="button" className="hud-tile" disabled={!canResign} onClick={ask("resign")}><Glyph name="flag" /><span className="hud-label">{t("Resign")}</span></button>
    <button type="button" className="hud-tile" onClick={ask("restart")}><Glyph name="again" /><span className="hud-label">{t("Rematch")}</span></button>
    <button type="button" className="hud-tile" onClick={ask("leave")}><Glyph name="leave" /><span className="hud-label">{t(config.mode === "ai-battle" ? "Back to Showcase" : "Back to Play")}</span></button>
  </>;

  // The board's own picker stands its four figures over the far side of the board. A wide stage has room for this one
  // under the kingdoms, beside the board; a narrower one puts it low in the middle, over the mover's own back ranks.
  const promotionPicker = promotion && <div className="match-promotion hud-panel" role="group" aria-label="Promote pawn" style={tintOf(armies[snapshot?.turn ?? "w"])}>
    <p className="hud-heading"><Glyph name="crown" /><span>{t("Promote pawn")}</span></p>
    <div className="hud-promotion-choices">
      {(["q", "r", "b", "n"] as const).map((kind, index) => <button type="button" key={kind} className="hud-choice" data-hud-primary={index === 0 ? "" : undefined} data-promotion={kind} data-focused={kind === promotionFocus || undefined} aria-current={kind === promotionFocus || undefined} aria-keyshortcuts={kind.toUpperCase()} onClick={() => actions.promote(kind)} onPointerEnter={() => actions.focusPromotion(kind)} onFocus={() => actions.focusPromotion(kind)}>
        <PieceGlyph kind={kind} /><span>{t(PIECE_LABEL[kind])}</span><Key>{touch || pad ? null : kind.toUpperCase()}</Key>
      </button>)}
    </div>
    {/* Backing out: nothing is played, and the Pawn is in hand again, so the keys go back to the board with it. */}
    <button type="button" className="hud-quiet hud-promotion-back" data-hud-back="" onClick={() => { actions.cancelPromotion(); actions.focusBoard(); }}><Key>{backKey}</Key>{t("Back")}</button>
  </div>;
  return <InputPromptContext.Provider value={{ device, bindings: prompts.bindings }}>
    <div ref={root} className={`hud${reducedMotion ? " is-reduced-motion" : ""}`} data-tier={tier} data-touch={touch || undefined} data-crowded={crowded || undefined} data-paused={pauseOpen || undefined}>
      {/* The two kingdoms. The sentence the old header showed is still here for screen readers and the game's checks:
          the plates say the same to the eye. */}
      <div className="hud-left" inert={pauseOpen || undefined}>
        <header className="match-hud hud-panel hud-sides">
          <p className="hud-heading"><Glyph name="duel" /><span>{t(config.mode === "ai-battle" ? "AI Battle · spectating" : config.mode === "classic" ? "Classic" : "Local Duel")}</span>{battlefield && <em>{t(battlefield.subtitle)}</em>}</p>
          <strong className="match-sr" role="status">{t(status.headline)}{status.note ? ` · ${t(status.note)}` : ""}</strong>
          <ul className="hud-plates">
            {(["w", "b"] as const).map((side) => <Plate key={side} side={side} army={armies[side]} foe={armies[side === "w" ? "b" : "w"]} role={sideRole(config, side)} state={sideState(snapshot, side)} lit={lit === side}
              clock={clocks?.[side] ?? null} low={!!snapshot?.clock.enabled && !result && (side === "w" ? snapshot.clock.whiteMs : snapshot.clock.blackMs) < 30000} snapshot={snapshot} />)}
          </ul>
          {snapshot?.engineError && <div className="hud-alert">
            <small role="alert"><Glyph name="alert" />{t(snapshot.engineError)}</small>
            <button type="button" className="hud-cta" onClick={press(actions.retryComputer)}><span>{t("Retry computer")}</span><Arrow /></button>
          </div>}
        </header>
        {tier === "wide" && promotionPicker}
      </div>

      <div className="hud-right" inert={pauseOpen || undefined}>
        <nav className="hud-controls" aria-label="Match controls">
          <div className="hud-bar hud-panel">
            {pad && <span className="hud-pad-hint" aria-hidden="true"><kbd>{pad.hud}</kbd></span>}
            <div className="hud-bar-group hud-bar-group--pause">
              <button type="button" className="hud-tile hud-tile--icon hud-tile--pause" aria-keyshortcuts="Escape" disabled={promotion} onClick={press(actions.pause)}><Glyph name="pause" /><span className="hud-label">{t("Pause")}</span><Key>{keys.pause}</Key></button>
            </div>
            <div className="hud-bar-group hud-bar-group--play">
              <button type="button" className="hud-tile" disabled={!canUndo} aria-keyshortcuts="U" onClick={press(actions.undo)}><Glyph name="undo" /><span className="hud-label">{t("Undo")}</span><Key>{keys.undo}</Key></button>
              <button type="button" className="hud-tile" aria-keyshortcuts="F" onClick={press(actions.flip)}><Glyph name="flip" /><span className="hud-label">{t("Flip board")}</span><Key>{keys.flip}</Key></button>
              <button type="button" className="hud-tile hud-tile--sound" aria-pressed={!muted} aria-keyshortcuts="M" onClick={press(actions.toggleSound)}><Glyph name={muted ? "mute" : "sound"} /><span className="hud-label">{t(muted ? "Sound off" : "Sound on")}</span><Key>{keys.sound}</Key></button>
              <button type="button" className="hud-tile hud-tile--icon" data-hud-opens aria-expanded={pop === "brightness"} aria-controls={pop === "brightness" ? brightnessId : undefined} onClick={toggle("brightness")}><Glyph name="sun" /><span className="hud-label">{t("Brightness")}</span></button>
            </div>
            {tier === "wide"
              ? <div className="hud-bar-group hud-bar-group--match">{matchActions}</div>
              : <div className="hud-bar-group hud-bar-group--match"><button type="button" className="hud-tile" data-hud-opens aria-expanded={pop === "menu"} aria-controls={pop === "menu" ? menuId : undefined} onClick={toggle("menu")}><Glyph name="menu" /><span className="hud-label">{t("Menu")}</span></button></div>}
          </div>
          {pop === "brightness" && <div className="hud-pop hud-pop--brightness hud-panel" id={brightnessId} role="group" aria-label={t("Brightness")}>
            <p className="hud-heading"><Glyph name="sun" /><span>{t("Brightness")}</span></p>
            <div className="hud-brightness">
              <input type="range" min="0.6" max="1.8" step="0.05" value={brightness} aria-label={t("Brightness")} style={{ ["--fill" as string]: `${((brightness - 0.6) / 1.2) * 100}%` }} onChange={(event) => actions.setBrightness(Number(event.target.value))} />
              <span className="hud-stat" aria-hidden="true"><b>{Math.round(brightness * 100)}</b><i>%</i></span>
            </div>
          </div>}
          {tier !== "wide" && pop === "menu" && <div className="hud-pop hud-pop--menu hud-panel" id={menuId} role="group" aria-label={t("Menu")}>
            <p className="hud-heading"><Glyph name="flag" /><span>{t("Menu")}</span></p>
            {matchActions}
          </div>}
        </nav>

        <aside className={`match-ledger hud-panel${ledgerOpen ? "" : " is-folded"}`} aria-label="Move record">
          {children}
          <h2 className="hud-ledger-head">
            <button type="button" className="hud-ledger-toggle" aria-expanded={ledgerOpen} aria-controls={ledgerId} onClick={() => setLedgerChoice(!ledgerOpen)}>
              <Glyph name="moves" /><span className="hud-ledger-title">{t("Moves")}</span>{latest && <em>{latest}</em>}<Glyph name="chevron" />
            </button>
          </h2>
          <div id={ledgerId} className="hud-ledger-body" hidden={!ledgerOpen}>
            {pairs.length ? <>
              <div className="hud-ledger-sides" aria-hidden="true"><span />{(["w", "b"] as const).map((side) => <span key={side} style={tintOf(armies[side])}><KingdomSigil army={armies[side]} />{nameOf(side)}</span>)}</div>
              <ol ref={list}>{pairs.map((pair, row) => <li key={pair.number}>
                <span className="hud-ply-number">{pair.number}.</span>
                <span className="hud-ply" style={tintOf(armies.w)} aria-current={row * 2 === moves.length - 1 || undefined}>{pair.white}</span>
                {pair.black ? <span className="hud-ply" style={tintOf(armies.b)} aria-current={row * 2 + 1 === moves.length - 1 || undefined}>{pair.black}</span> : <span />}
              </li>)}</ol>
            </> : <p className="hud-ledger-empty">{t("No moves yet.")}</p>}
          </div>
        </aside>
        {/* How the view is turned from the device in use, until it has been: then it is only in the pause menu. */}
        {!touch && tier !== "small" && !viewFound && !result && <ViewHints hints={viewHints(device)} />}
      </div>

      {(conclusion || fighting) && <button type="button" className="hud-skip" inert={pauseOpen || undefined} data-skip-fight={conclusion ? undefined : ""} onClick={press(conclusion ? actions.skipEnding : actions.skipFight)}>
        {backKey ? <kbd aria-hidden="true">{backKey}</kbd> : <Glyph name="skip" />}{t(conclusion ? "Skip ending" : "Skip fight")}
      </button>}
      {/* A queued move is called off from the same place; a fight on stage has the key first, as it has on the board. */}
      {queued?.to && !conclusion && !fighting && !promotion && !result && <button type="button" className="hud-skip" inert={pauseOpen || undefined} data-cancel-queued="" onClick={press(actions.cancelQueued)}>
        {backKey ? <kbd aria-hidden="true">{backKey}</kbd> : <Glyph name="cancel" />}{t("Cancel queued move")}<em>{queued.from.toUpperCase()} → {queued.to.toUpperCase()}</em>
      </button>}

      {tier !== "wide" && promotionPicker}

      {result && summary && !conclusion && <div className="match-result hud-panel" role="status" inert={pauseOpen || undefined} data-outcome={result.winner ? "win" : "draw"} style={result.winner ? tintOf(armies[result.winner]) : undefined}>
        <Motes />
        {/* The winner under its flag, as the opening shows each kingdom; a phone keeps to the medallion, and a draw
            shows both kingdoms' medallions. */}
        <div className="hud-result-head" data-flag={result.winner && tier !== "small" ? "" : undefined}>
          {result.winner && tier !== "small" ? <span className="hud-flag" aria-hidden="true"><img src={flagOf(armies[result.winner], reducedMotion)} alt="" draggable={false} /></span>
            : <div className="hud-result-crest" aria-hidden="true">
              {(result.winner ? [result.winner] : ["w", "b"] as const).map((side) => <span key={side} className="hud-medal" style={tintOf(armies[side])}><KingdomSigil army={armies[side]} /></span>)}
            </div>}
          <div className="hud-result-words">
            <p className="hud-eyebrow">{t(summary.reason)}</p>
            <strong>{t(summary.title)}</strong>
            <p className="hud-result-line">{t(summary.line)}</p>
          </div>
        </div>
        <div className="hud-result-body">
          <div className="hud-result-stats">
            <span className="hud-stat"><b>{Math.ceil(moves.length / 2)}</b><i>{t("Moves")}</i></span>
            <span className="hud-stat"><b>{formatClock(snapshot?.elapsed.totalMs ?? 0)}</b><i>{t("min")}</i></span>
          </div>
          {chronicle && <section className="match-chronicle" aria-label="Chronicle of the battle"><h3>{chronicle.title}</h3>{chronicle.lines.map((line, index) => <p key={index}>{line}</p>)}</section>}
          <p className="hud-result-notice" aria-live="polite">{replayNotice}</p>
          {legacyNotice && <p className="hud-result-notice">{legacyNotice}</p>}
          <div className="hud-result-actions">
            {replayReady && <>
              <button type="button" className="hud-tile" disabled={!actions.watchReplay} onClick={() => actions.watchReplay?.()}><Glyph name="watch" /><span className="hud-label">{t("Watch Replay")}</span></button>
              <button type="button" className="hud-tile" disabled={savingReplay} onClick={actions.saveReplay}><Glyph name="save" /><span className="hud-label">{t("Save Replay")}</span></button>
            </>}
            <button type="button" className="hud-tile" onClick={actions.changeBattlefield}><Glyph name="field" /><span className="hud-label">{t("Change battlefield")}</span></button>
            <button type="button" className="hud-cta" data-hud-primary="" onClick={actions.playAgain}><span>{t("Play again")}</span><Arrow /></button>
          </div>
        </div>
      </div>}

      {/* Drawn into the menu's stage, where the main menu draws its Settings, so the Settings pages keep their own look
          (the match screen's button rules would reach them here). Without a stage (a test page) it is drawn here. */}
      {pauseOpen && pauseLayer(<MatchPause ref={pauseMenu} config={config} armies={armies} snapshot={snapshot} reducedMotion={reducedMotion} tier={tier}
        backKey={backKey} viewHints={touch ? null : viewHints(device)} blocked={!!confirm} onResume={actions.resume} onExit={() => actions.ask("leave")} onTestSound={actions.testSound} />)}

      {confirm && <MatchConfirm copy={{ ...CONFIRM[confirm], heading: t(confirm === "resign" ? "Resign" : confirm === "restart" ? "Rematch" : config.mode === "ai-battle" ? "Back to Showcase" : "Back to Play") }} backKey={backKey} onCancel={onConfirmCancel} onConfirm={onConfirmAccept} />}
    </div>
  </InputPromptContext.Provider>;
}

/** The match's three questions. Each opens on "Keep playing"; the game's checks answer them with "Confirm". */
const CONFIRM: Record<MatchConfirmAction, Omit<ConfirmCopy, "heading">> = {
  leave: { glyph: "leave", title: "Leave this match?", body: "The current match will end.", cancel: "Keep playing", confirm: "Confirm" },
  restart: { glyph: "again", title: "Start a new match?", body: "The current match will end.", cancel: "Keep playing", confirm: "Confirm" },
  resign: { glyph: "flag", title: "Resign this match?", body: "Your opponent wins this match.", cancel: "Keep playing", confirm: "Confirm" },
};
