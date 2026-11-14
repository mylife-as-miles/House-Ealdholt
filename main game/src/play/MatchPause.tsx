/**
 * The pause menu over a match in play (the creator's picture of 11 November 2026): a list on the left (Resume,
 * Settings, Stats, Exit) and, beside it, what the chosen entry holds. Settings is the game's own Settings grid
 * (SettingsGrid) and, for a tile, its page (SettingsDetail), on the main menu's preferences and saved the same way
 * (match-settings.ts); Stats is this match so far; Exit asks the HUD's "Leave this match?". The match is held while it
 * is open (MatchExperience pauses its controller).
 *
 * Walked as the main menu is: arrows (or the player's bindings) move, Enter or Select chooses, Escape or Back steps
 * back (a page to the grid, the grid to the list, the list to the match). A controller does the same through the
 * handle below (useMatchGamepad.ts); a pointer or a finger presses what it touches.
 *
 * Inside a match the Credits page leaves out its two films and the Audio page the menu soundtrack's rows: the films are
 * the main menu's own full-screen players over its Credits page, and the soundtrack is silent while a match plays (it
 * has its own sound). Test Sound plays through the match's own mixer.
 *
 * Beside the Select and Back prompts it says how the view over the board is turned from the device in use (the keys,
 * or a controller's right stick and triggers): the one set of match controls no tile of the HUD shows.
 */
import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { ARMY_KINGDOMS, type MatchArmies, type MatchConfig } from "../../../shared/play/match";
import { SETTINGS_RESET_COPY } from "../../../shared/menu/settings";
import type { Faction, GameSnapshot } from "../../../web/src/core/types";
import { InputPrompt } from "../InputPrompt";
import { useMenuLocale } from "../MenuLocale";
import { SettingsGrid, SETTINGS_CATEGORIES } from "../SettingsGrid";
import SettingsDetail from "../SettingsDetail";
import { DEFAULT_BINDINGS, type BindingAction, type Direction, type SettingsCategory, type SettingsPageHandle } from "../settings-types";
import { KingdomSigil } from "./MatchSetup";
import { formatClock, sideRole, type HudTier, type ViewHint } from "./match-hud-model";
import { Glyph, MatchConfirm, PieceGlyph, tintOf, ViewHints, type ConfirmCopy } from "./MatchHudParts";
import { matchStats, PAUSE_ITEMS, stepPauseItem, stepSettingsTile, type PauseItem } from "./match-pause-model";
import { useMatchSettings } from "./match-settings";
import "./MatchPause.css";

export interface MatchPauseHandle {
  move(direction: Direction): void;
  edge(last: boolean): void;
  activate(): void;
  back(): void;
  /** The open Settings page's Reset Defaults (the controller's top button, F9 on a keyboard). */
  reset(): void;
}

const LABEL: Record<PauseItem, string> = { resume: "Resume", settings: "Settings", stats: "Stats", exit: "Exit" };
const RESET_COPY: ConfirmCopy = { glyph: "again", heading: "Settings", title: SETTINGS_RESET_COPY.title, body: SETTINGS_RESET_COPY.description, cancel: "Cancel", confirm: SETTINGS_RESET_COPY.action };

/** Where the keys act: the list, the grid beside it, an open Settings page, or the Stats beside the list. */
type Zone = "list" | "grid" | "detail" | "stats";

export interface MatchPauseProps {
  config: MatchConfig;
  armies: MatchArmies;
  snapshot: GameSnapshot | null;
  reducedMotion: boolean;
  /** The HUD's layout for this screen (match-hud-model.ts, hudTier): a phone's is closer set. */
  tier: HudTier;
  /** The key that steps back, as its chip shows it; null on a touch screen. */
  backKey: string | null;
  /** How the view over the board is turned from the device in use (match-hud-model.ts); null on a touch screen. */
  viewHints: readonly ViewHint[] | null;
  /** Another question is open over the menu (the HUD's "Leave this match?"): the menu leaves the keys to it. */
  blocked: boolean;
  onResume(): void;
  onExit(): void;
  onTestSound(): void;
}

const MatchPause = forwardRef<MatchPauseHandle, MatchPauseProps>(function MatchPause({ config, armies, snapshot, reducedMotion, tier, backKey, viewHints, blocked, onResume, onExit, onTestSound }, ref) {
  const { t } = useMenuLocale();
  const settings = useMatchSettings();
  const items: readonly PauseItem[] = settings ? PAUSE_ITEMS : PAUSE_ITEMS.filter((item) => item !== "settings");
  const [item, setItem] = useState<PauseItem>("resume");
  const [zone, setZone] = useState<Zone>("list");
  const [tile, setTile] = useState(0);
  const [category, setCategory] = useState<SettingsCategory | null>(null);
  const [resetting, setResetting] = useState<(() => void) | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Partial<Record<PauseItem, HTMLButtonElement | null>>>({});
  const tileRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const detail = useRef<SettingsPageHandle>(null);
  const stats = useRef<HTMLElement>(null);

  // Opened, the menu takes the focus; closed, it hands it back to where it was (the board, or the HUD's pause tile).
  // Noted once: React's development checks run this effect twice.
  const asker = useRef<HTMLElement | null | undefined>(undefined);
  useEffect(() => {
    if (asker.current === undefined) asker.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return () => { const back = asker.current; if (back?.isConnected) back.focus({ preventScroll: true }); };
  }, []);
  // Each step lands the focus where the keys now act.
  useEffect(() => {
    if (zone === "list") itemRefs.current[item]?.focus({ preventScroll: true });
    else if (zone === "grid") tileRefs.current[tile]?.focus({ preventScroll: true });
    else if (zone === "detail") detail.current?.focus();
    else stats.current?.focus({ preventScroll: true });
    // Only a change of zone (or of page) moves the focus here; moves within a zone focus as they go.
  }, [zone, category]);

  const chooseItem = (next: PauseItem, focus = true) => { setItem(next); setZone("list"); if (focus) itemRefs.current[next]?.focus({ preventScroll: true }); };
  const chooseTile = (next: number) => { setTile(next); setZone("grid"); tileRefs.current[next]?.focus({ preventScroll: true }); };
  const openItem = (which: PauseItem) => {
    if (which === "resume") onResume();
    else if (which === "exit") onExit();
    else if (which === "settings") { setItem("settings"); setZone("grid"); }
    else { setItem("stats"); setZone("stats"); }
  };
  const openCategory = (index: number) => { setTile(index); setCategory(SETTINGS_CATEGORIES[index]); setZone("detail"); };

  const handle: MatchPauseHandle = {
    move(direction) {
      if (zone === "detail") { detail.current?.move(direction); return; }
      if (zone === "grid") {
        const next = stepSettingsTile(tile, direction);
        if (next === null) chooseItem("settings"); else chooseTile(next);
        return;
      }
      if (zone === "stats") {
        if (direction === "left") chooseItem("stats");
        else if (direction === "up" || direction === "down") stats.current?.scrollBy({ top: direction === "up" ? -80 : 80 });
        return;
      }
      if (direction === "up" || direction === "down") {
        let next = stepPauseItem(item, direction);
        if (!items.includes(next)) next = stepPauseItem(next, direction);
        if (items.includes(next)) chooseItem(next);
      } else if (direction === "right" && (item === "settings" || item === "stats")) openItem(item);
    },
    edge(last) {
      if (zone === "detail") detail.current?.edge?.(last);
      else if (zone === "grid") chooseTile(last ? SETTINGS_CATEGORIES.length - 1 : 0);
      else if (zone === "list") chooseItem(last ? items[items.length - 1]! : items[0]!);
    },
    activate() {
      if (zone === "detail") detail.current?.activate();
      else if (zone === "grid") openCategory(tile);
      else if (zone === "list") openItem(item);
    },
    back() {
      if (zone === "detail") {
        if (detail.current?.cancel()) return;
        setCategory(null);
        setZone("grid");
      } else if (zone === "grid" || zone === "stats") chooseItem(item);
      else onResume();
    },
    reset() { if (zone === "detail" && category !== "input") detail.current?.reset(); },
  };
  useImperativeHandle(ref, () => handle);

  // The keys, read as the main menu reads them (App.tsx), with the player's bindings. The board and the HUD leave
  // them alone while the menu is open.
  const live = useRef({ handle, blocked, resetting, bindings: settings?.preferences.bindings ?? DEFAULT_BINDINGS });
  live.current = { handle, blocked, resetting, bindings: settings?.preferences.bindings ?? DEFAULT_BINDINGS };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const now = live.current;
      if (now.blocked || now.resetting || event.defaultPrevented || event.ctrlKey || event.altKey || event.metaKey) return;
      const target = event.target instanceof Element ? event.target : null;
      // A question open over the menu, and the Controls page while it waits for a key to bind, keep their keys.
      if (target?.closest("dialog, .is-capturing")) return;
      const action = (Object.entries(now.bindings) as [BindingAction, string][]).find(([, code]) => code === event.code)?.[0];
      const back = event.code === "Escape" || action === "back";
      if (event.repeat && (back || action === "select")) { event.preventDefault(); return; }
      if (back) { event.preventDefault(); now.handle.back(); return; }
      if (event.code === "F9") { event.preventDefault(); now.handle.reset(); return; }
      // Sliders, lists and text keep their own keys.
      if (target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement) return;
      const direction = action === "left" || action === "right" || action === "up" || action === "down" ? action : null;
      if (direction) { event.preventDefault(); now.handle.move(direction); return; }
      if (action === "first" || action === "last") { event.preventDefault(); now.handle.edge(action === "last"); return; }
      // Enter or Space on a button presses it; the Select binding presses whatever is chosen.
      if (action === "select" && !((event.code === "Enter" || event.code === "Space") && target instanceof HTMLButtonElement)) { event.preventDefault(); now.handle.activate(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const sides = ["w", "b"] as const;
  const figures = snapshot ? matchStats(snapshot) : null;
  return <div ref={root} className={`hud match-pause${category ? " is-detail" : ""}${reducedMotion ? " is-reduced-motion" : ""}`} role="dialog" aria-modal="true" aria-label={t("Paused")} data-tier={tier} data-pause-zone={zone} data-pause-item={item}>
    <div className="pause-scrim" aria-hidden="true" />
    {!category && <nav className="pause-list" aria-label="Pause menu">
      {items.map((entry) => <button key={entry} ref={(element) => { itemRefs.current[entry] = element; }} type="button"
        className={`pause-item${item === entry ? " is-selected" : ""}`} aria-current={item === entry ? "true" : undefined}
        tabIndex={item === entry ? 0 : -1} data-pause-entry={entry}
        onFocus={() => { setItem(entry); setZone("list"); }}
        onPointerMove={(event) => { if (event.pointerType === "mouse" && (event.movementX || event.movementY)) setItem(entry); }}
        onClick={() => openItem(entry)}>{t(LABEL[entry])}</button>)}
    </nav>}

    {item === "settings" && settings && (category
      ? <SettingsDetail ref={detail} category={category} preferences={settings.preferences} preferencesSaved={settings.preferencesSaved}
        audioStatus={null} onTestSound={onTestSound} reducedMotion={reducedMotion} onRetrySave={settings.onRetrySave}
        onRequestReset={(apply) => setResetting(() => apply)} onChange={settings.onChange} onBack={() => { setCategory(null); setZone("grid"); }} />
      : <div className="pause-pane pause-settings"><SettingsGrid selected={tile} onSelect={(index) => { setTile(index); setZone("grid"); }} onActivate={openCategory} buttonRefs={tileRefs} /></div>)}

    {item === "stats" && figures && <section ref={stats} className="pause-pane pause-stats" aria-label={t("Stats")} tabIndex={-1}>
      <p className="hud-heading"><Glyph name="stats" /><span>{t("This match")}</span></p>
      <div className="pause-stats-totals">
        <span className="hud-stat"><b>{figures.fullMoves}</b><i>{t(figures.fullMoves === 1 ? "move" : "moves")}</i></span>
        <span className="hud-stat"><b>{formatClock(figures.playedMs)}</b><i>{t("played")}</i></span>
        <span className="hud-stat"><b>{figures.duels}</b><i>{t(figures.duels === 1 ? "duel" : "duels")}</i></span>
      </div>
      <div className="pause-stats-sides">
        {sides.map((side) => <StatsSide key={side} side={side} name={ARMY_KINGDOMS[armies[side]]} role={sideRole(config, side)} style={tintOf(armies[side])} figures={figures} sigil={<KingdomSigil army={armies[side]} />} />)}
      </div>
    </section>}

    {!category && <footer className="pause-prompts">
      <button type="button" onClick={() => handle.activate()}><span className="pause-chip" aria-hidden="true"><InputPrompt action="select" /></span>{t("Select")}</button>
      <button type="button" onClick={() => handle.back()}><span className="pause-chip" aria-hidden="true"><InputPrompt action="back" /></span>{t("Back")}</button>
      {/* The match's own controls that no tile shows: how the view over the board is turned. */}
      {viewHints && <ViewHints hints={viewHints} />}
    </footer>}

    {resetting && <MatchConfirm copy={{ ...RESET_COPY, heading: t(RESET_COPY.heading) }} label={t(SETTINGS_RESET_COPY.title)} backKey={backKey}
      onCancel={() => setResetting(null)} onConfirm={() => { const apply = resetting; setResetting(null); apply(); }} />}
  </div>;
});
export default MatchPause;

function StatsSide({ side, name, role, style, figures, sigil }: { side: Faction; name: string; role: string; style: CSSProperties; figures: ReturnType<typeof matchStats>; sigil: ReactNode }) {
  const { t } = useMenuLocale();
  const mine = figures.sides[side], theirs = figures.sides[side === "w" ? "b" : "w"];
  const material = mine.lead > 0 ? `+${mine.lead}` : theirs.lead > 0 ? `−${theirs.lead}` : t("Even");
  const rows: [string, ReactNode][] = [
    ["Moves", String(mine.moves)],
    ["Captured", mine.takenCount ? <span className="pause-taken">{mine.taken.map((group) => <span key={group.kind}><PieceGlyph kind={group.kind} />{group.count > 1 && group.count}</span>)}</span> : "—"],
    ["Material", material],
    ["Checks", String(mine.checks)],
    ["Duels won", String(mine.duelsWon)],
    ["Time taken", formatClock(mine.thinkingMs)],
    ...(mine.clockMs !== null ? [["Clock", formatClock(mine.clockMs)] as [string, string]] : []),
  ];
  return <div className="pause-stats-side" style={style} data-side={side}>
    <div className="pause-stats-kingdom"><span className="hud-medal">{sigil}</span><span><strong>{name}</strong><small>{t(role)}</small></span></div>
    <dl>{rows.map(([label, value]) => <div key={label}><dt>{t(label)}</dt><dd>{value}</dd></div>)}</dl>
  </div>;
}
