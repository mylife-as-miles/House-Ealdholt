import { useMenuLocale } from "../MenuLocale";
import { InputPrompt, InputPromptContext, useInputPrompts } from "../InputPrompt";
import { useRef, useEffect, useId, useState } from "react";
import { ARMY_KINGDOMS, BATTLEFIELDS, CLASSIC_PLAYER_ARMY, DEFAULT_MATCH_ARMIES, type ArmyId, type GamePortSetting, type MatchArmies, type MatchConfig, type PlayMode } from "../../../shared/play/match";
import { MATCH_ARMY_CHOICES, MATCH_CLOCK_CHOICES, MATCH_RIVAL_CHOICES, MATCH_SETUP_MODES, MATCH_SIDE_CHOICES, MATCH_STRENGTH_CHOICES } from "../../../shared/play/setup";
import { useSetupGamepad } from "./useSetupGamepad";
import "./MatchSetup.css";
import { publicUrl } from "../public-url";

function CrownMark({ className = "" }: { className?: string }) {
  return <svg className={className} viewBox="0 0 64 64" fill="none" aria-hidden="true">
    <path d="M12 21 23 31 32 13 41 31 52 21 47 46H17L12 21Z" stroke="currentColor" strokeWidth="1.5" />
    <path d="M18 40H46M20 51H44M32 7V12M8 17 11 20M56 17 53 20" stroke="currentColor" strokeWidth="1.5" />
    <path d="m32 26 5 9-5 6-5-6 5-9Z" fill="currentColor" />
  </svg>;
}

function KingMark({ dark = false }: { dark?: boolean }) {
  return <svg className={`setup-king${dark ? " is-obsidian" : ""}`} viewBox="0 0 32 44" fill="none" aria-hidden="true">
    <path d="M16 2V11M12 6H20M8 14 12 18 16 12 20 18 24 14 22 23H10L8 14ZM11 25H21L20 29 23 35H9L12 29 11 25ZM8 38H24V41H8V38Z" fill="currentColor" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
  </svg>;
}

function ArrowMark() {
  return <svg viewBox="0 0 32 12" fill="none" aria-hidden="true"><path d="M1 6H29M24 1 30 6 24 11" stroke="currentColor" strokeWidth="1.5" /></svg>;
}

/** Each kingdom's colour: its sigil, its stripe on the army choices and its side of the match-up banner. */
export const ARMY_TINT: Record<ArmyId, string> = { ivory: "#e9dfc8", sun: "#43c3a2", empire: "#7f9ee6", kwind: "#e8b04a" };

const polar = (cx: number, cy: number, r: number, degrees: number) => {
  const a = (degrees * Math.PI) / 180;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)].map((v) => v.toFixed(2)).join(" ");
};
/** Solforiz's sun rises over its stepped temple: rays across the upper half only. */
const SUN_RAYS = [-180, -150, -120, -90, -60, -30, 0].map((d) => `M${polar(16, 15, 7.5, d)}L${polar(16, 15, 11, d)}`).join("");
const STAR = Array.from({ length: 10 }, (_, i) => polar(16, 15.5, i % 2 ? 2.2 : 4.6, i * 36 - 90)).join(" ");
/** Korvenia's laurel: leaves along both branches, each tilted with its stem (the right branch mirrors the left). */
const LAUREL_LEAVES = [[8.4, 26, -35], [6.2, 22.4, -58], [4.9, 18.2, -80], [4.8, 14, -100], [5.7, 10.2, -118]]
  .flatMap(([x, y, a]) => [[x, y, a], [32 - x, y, -a]]);

/** Kwind-09's cog: eight teeth round a ring, a bolt of arc-light through the middle. */
const COG = Array.from({ length: 8 }, (_, i) => {
  const a = i * 45;
  return `M${polar(16, 16, 9.5, a - 9)}L${polar(16, 16, 12.5, a - 7)}L${polar(16, 16, 12.5, a + 7)}L${polar(16, 16, 9.5, a + 9)}`;
}).join("");

/** The kingdom's emblem: Aethelgard's crowned shield, Solforiz's stepped sun, Korvenia's laurel and star, Kwind-09's
 * arc-lit cog. */
export function KingdomSigil({ army }: { army: ArmyId }) {
  return <svg className="setup-sigil" viewBox="0 0 32 32" fill="none" aria-hidden="true" style={{ color: ARMY_TINT[army] }}>
    {army === "ivory" && <>
      <path d="M16 3 27 7v8c0 7-4.6 12-11 14C9.4 27 5 22 5 15V7z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M10.5 19.5 11.6 12l3 3L16 10l1.4 5 3-3 1.1 7.5z" fill="currentColor" />
    </>}
    {army === "sun" && <>
      <circle cx="16" cy="15" r="4.6" fill="currentColor" />
      <path d={SUN_RAYS} stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M8 22.5h16M10.5 25.5h11M13 28.5h6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </>}
    {army === "empire" && <>
      <path d="M12 28.5C7 25.5 5.4 18 8 9.5M20 28.5C25 25.5 26.6 18 24 9.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      {LAUREL_LEAVES.map(([x, y, a], i) => <ellipse key={i} cx={x} cy={y} rx="2.3" ry="1.05" transform={`rotate(${a} ${x} ${y})`} fill="currentColor" />)}
      <polygon points={STAR} fill="currentColor" />
    </>}
    {army === "kwind" && <>
      <circle cx="16" cy="16" r="9.5" stroke="currentColor" strokeWidth="1.6" />
      <path d={COG} stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M17.6 9.5 12.6 16.8h3.6l-1.8 5.7 5-7.3h-3.6z" fill="currentColor" />
    </>}
  </svg>;
}

/** A small orange glyph before each heading: the field, the clock, the computer, the side, the banner. */
function LegendIcon({ kind }: { kind: "field" | "clock" | "computer" | "side" | "army" }) {
  return <svg className="setup-legend-icon" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    {kind === "field" && <path d="M1.5 13.5 5.5 6l3 4.5 2-3 4 6zM10.5 4a1.5 1.5 0 1 0 0-.01" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />}
    {kind === "clock" && <><circle cx="8" cy="8.5" r="5.8" stroke="currentColor" strokeWidth="1.3" /><path d="M8 5.2v3.5l2.3 1.5M6.5 1.5h3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></>}
    {kind === "computer" && <><rect x="3.5" y="3.5" width="9" height="9" rx="1" stroke="currentColor" strokeWidth="1.3" /><path d="M6 1v2.5M10 1v2.5M6 12.5V15M10 12.5V15M1 6h2.5M1 10h2.5M12.5 6H15M12.5 10H15" stroke="currentColor" strokeWidth="1.2" /><rect x="6.3" y="6.3" width="3.4" height="3.4" fill="currentColor" /></>}
    {kind === "side" && <path d="M8 1.5v3M6.5 3h3M4.5 6.5 6 8l2-3 2 3 1.5-1.5-1 4.5h-5zM5 12.5h6l.7 2H4.3z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />}
    {kind === "army" && <path d="M3.5 15V1.5M3.5 2.5h9l-2 3 2 3h-9" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />}
  </svg>;
}

const NUMERALS = ["I", "II", "III", "IV", "V", "VI"];

/** The menu's drifting motes, teal and amber, placed once (seeded) so they do not jump on every render. */
const MOTES = (() => {
  let seed = 7;
  const next = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  return Array.from({ length: 24 }, (_, i) => ({
    left: next() * 100, size: 2 + next() * 3.2, delay: -next() * 22, duration: 16 + next() * 16, drift: (next() - 0.5) * 80,
    color: i % 3 === 0 ? "#f0a64a" : "#63edce",
  }));
})();

/**
 * Match setup in the main menu's look: its bronze wash (the chosen battlefield's art fills the screen once one is
 * picked), its drifting motes, its orange for what is chosen and its key chips, and each kingdom's sigil and colour.
 * The words are kept to names and choices. Every control keeps its full accessible name; the summary of the match is
 * read to screen readers rather than printed. Arena art is the creator's battlefield cards (/assets/play/<id>-card.webp);
 * every visible word goes through the menu's localisation, and the key
 * chips follow the player's bindings and input device.
 */
export default function MatchSetup({ mode, onStart, onBack, reducedMotion = false }: { mode: PlayMode; onStart(config: MatchConfig): void; onBack(): void; reducedMotion?: boolean }) {
  const { t } = useMenuLocale();
  const prompts = useInputPrompts();
  const [device, setDevice] = useState(prompts.device);
  const [setting, setSetting] = useState<GamePortSetting | null>(null);
  // The battlefield art is always the screen's background: the chosen one, else the one under the pointer or focus,
  // else the first. Start still waits for an explicit choice.
  const [previewSetting, setPreviewSetting] = useState<GamePortSetting | null>(null);
  const backdropSetting = setting ?? previewSetting ?? BATTLEFIELDS[0].id;
  const [difficulty, setDifficulty] = useState<MatchConfig["difficulty"]>("medium");
  const [playerColor, setPlayerColor] = useState<"w" | "b">("w");
  const [clockMinutes, setClockMinutes] = useState<number | null>(null);
  const [rival, setRival] = useState<ArmyId>("sun");
  const [duelArmies, setDuelArmies] = useState<MatchArmies>({ ...DEFAULT_MATCH_ARMIES });
  const heading = useRef<HTMLHeadingElement>(null);
  const setupRef = useRef<HTMLElement>(null);
  const summaryId = useId();
  useSetupGamepad(setupRef, onBack, prompts.bindings, setDevice);
  const content = MATCH_SETUP_MODES[mode];
  const battlefield = BATTLEFIELDS.find((item) => item.id === setting);
  const clockLabel = clockMinutes === null ? t("No clock") : `${clockMinutes} ${t("min each")}`;
  const strength = MATCH_STRENGTH_CHOICES.find((item) => item.value === difficulty)!;
  // Classic: you lead Aethelgard on the side you chose; the computer fields the rival on the other.
  const armies: MatchArmies = mode === "classic"
    ? (playerColor === "w" ? { w: CLASSIC_PLAYER_ARMY, b: rival } : { w: rival, b: CLASSIC_PLAYER_ARMY })
    : duelArmies;
  useEffect(() => { heading.current?.focus({ preventScroll: true }); }, []);
  return <InputPromptContext.Provider value={{ device, bindings: prompts.bindings }}><section
    ref={setupRef}
    className={`match-setup setup-war-room${mode === "local-duel" ? " is-local-duel" : ""}${reducedMotion ? " is-reduced-motion" : ""}`}
    data-battlefield={setting || "unselected"}
    aria-label={`${t(content.title)} setup`}
    onKeyDown={(event) => { if (event.key === "Escape" || event.code === prompts.bindings.back) { event.preventDefault(); event.stopPropagation(); onBack(); } }}
  >
    <div className="setup-backdrop" aria-hidden="true">{BATTLEFIELDS.map((item) => <span key={item.id} className={backdropSetting === item.id ? "is-shown" : undefined} style={{ backgroundImage: `url('${publicUrl(`/assets/play/${item.id}-card.webp`)}')` }} />)}</div>
    <div className="setup-motes" aria-hidden="true">{MOTES.map((mote, index) => <i key={index} style={{ left: `${mote.left}%`, width: mote.size, height: mote.size, animationDelay: `${mote.delay}s`, animationDuration: `${mote.duration}s`, ["--mote-drift" as string]: `${mote.drift}px`, ["--mote-color" as string]: mote.color }} />)}</div>
    <div className="setup-frame">
      <header className="setup-header">
        <h1 ref={heading} tabIndex={-1}>{t(content.title)}</h1>
        {/* The match-up at a glance; screen readers get it from the summary in the footer. Each crest re-enters when
            its kingdom changes. */}
        <div className="setup-versus" aria-hidden="true">
          {(["w", "b"] as const).map((side, index) => <div key={side + armies[side]} className="setup-crest" style={{ ["--army-tint" as string]: ARMY_TINT[armies[side]], order: index * 2 }}>
            <span className="setup-crest-medal"><KingdomSigil army={armies[side]} /></span>
            <strong>{ARMY_KINGDOMS[armies[side]]}</strong>
            <small>{t(mode === "classic" ? (side === playerColor ? "You" : "Computer") : side === "w" ? "Player 1" : "Player 2")}</small>
          </div>)}
          <b style={{ order: 1 }}>{t("vs")}</b>
        </div>
      </header>

      <div className="setup-body">
        <fieldset className="setup-battlefields">
          <legend className="setup-section-title"><LegendIcon kind="field" />{t("Battlefield")}</legend>
          <div className="setup-battlefield-grid" role="group" aria-label="Battlefield">
            {BATTLEFIELDS.map((item, index) => <button
              type="button"
              key={item.id}
              className={`setup-battlefield setup-battlefield--${item.id}`}
              aria-label={`${t(item.title)} ${t(item.subtitle)}`}
              aria-pressed={setting === item.id}
              onClick={() => setSetting(item.id)}
              onPointerEnter={() => setPreviewSetting(item.id)}
              onPointerLeave={() => setPreviewSetting(null)}
              onFocus={() => setPreviewSetting(item.id)}
              onBlur={() => setPreviewSetting(null)}
              onKeyDown={(event) => {
                if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
                event.preventDefault();
                const next = event.key === "Home" ? 0 : event.key === "End" ? BATTLEFIELDS.length - 1 : Math.max(0, Math.min(BATTLEFIELDS.length - 1, index + (["ArrowLeft", "ArrowUp"].includes(event.key) ? -1 : 1)));
                (event.currentTarget.parentElement?.querySelectorAll("button")[next] as HTMLButtonElement | undefined)?.focus({ preventScroll: true });
                setSetting(BATTLEFIELDS[next].id);
              }}
            >
              <span className="setup-battlefield-fallback" aria-hidden="true"><CrownMark /></span>
              <span className="setup-battlefield-art" style={{ backgroundImage: `url('${publicUrl(`/assets/play/${item.id}-card.webp`)}')` }} aria-hidden="true" />
              <span className="setup-battlefield-shade" aria-hidden="true" />
              <span className="setup-battlefield-tag" aria-hidden="true">{NUMERALS[index]}</span>
              <span className="setup-selection-mark" aria-hidden="true">{setting === item.id ? "✓" : ""}</span>
              <strong className="setup-battlefield-name">{t(item.subtitle)}</strong>
            </button>)}
          </div>
        </fieldset>

        <div className="setup-terms">
          <fieldset className="setup-option-group setup-clock-group">
            <legend><LegendIcon kind="clock" />{t("Clock")}</legend>
            <div className="setup-clock-options" role="radiogroup" aria-label="Match clock">
              {MATCH_CLOCK_CHOICES.map((choice) => <label className={`setup-choice setup-clock-choice${choice.value === null ? " is-untimed" : ""}`} key={choice.value ?? "none"}>
                <input type="radio" name="match-clock" aria-label={t(choice.label)} checked={clockMinutes === choice.value} onChange={() => setClockMinutes(choice.value)} />
                <span className="setup-choice-face"><strong>{t(choice.short)}</strong>{choice.value !== null && <span>{t("min")}</span>}</span>
              </label>)}
            </div>
          </fieldset>

          {mode === "classic" ? <>
            <fieldset className="setup-option-group setup-strength-group">
              <legend><LegendIcon kind="computer" />{t("Computer")}</legend>
              <div className="setup-strength-options" role="radiogroup" aria-label="Computer strength">
                {MATCH_STRENGTH_CHOICES.map((choice, index) => <label className="setup-choice setup-strength-choice" key={choice.value}>
                  <input type="radio" name="match-strength" aria-label={t(choice.label)} checked={difficulty === choice.value} onChange={() => setDifficulty(choice.value)} />
                  <span className="setup-choice-face"><span className="setup-strength-bars" aria-hidden="true">{[0, 1, 2].map((bar) => <i key={bar} className={bar <= index ? "is-filled" : ""} />)}</span><span>{t(choice.label)}</span></span>
                </label>)}
              </div>
            </fieldset>
            <fieldset className="setup-option-group setup-side-group">
              <legend><LegendIcon kind="side" />{t("Your side")}</legend>
              <div className="setup-side-options" role="radiogroup" aria-label="Your side">
                {MATCH_SIDE_CHOICES.map((choice) => <label className="setup-choice setup-side-choice" key={choice.value}>
                  <input type="radio" name="match-side" aria-label={t(choice.label)} checked={playerColor === choice.value} onChange={() => setPlayerColor(choice.value)} />
                  <span className="setup-choice-face"><KingMark dark={choice.value === "b"} /><strong>{t(choice.label)}</strong></span>
                </label>)}
              </div>
            </fieldset>
            <fieldset className="setup-option-group setup-side-group setup-rival-group">
              <legend><LegendIcon kind="army" />{t("Opponent")}</legend>
              <div className="setup-side-options" role="radiogroup" aria-label="Opponent's army">
                {MATCH_RIVAL_CHOICES.map((choice) => <label className="setup-choice setup-side-choice setup-army-choice" key={choice.value} style={{ ["--army-tint" as string]: ARMY_TINT[choice.value] }}>
                  <input type="radio" name="match-rival" aria-label={choice.label} checked={rival === choice.value} onChange={() => setRival(choice.value)} />
                  <span className="setup-choice-face"><KingdomSigil army={choice.value} /><strong>{choice.label}</strong></span>
                </label>)}
              </div>
            </fieldset>
          </> : ([["w", "Player one", "Player 1"], ["b", "Player two", "Player 2"]] as const).map(([side, player, shown]) => <fieldset className="setup-option-group setup-army-group" key={side}>
            <legend><LegendIcon kind="army" />{t(shown)}</legend>
            <div className="setup-side-options setup-army-options" role="radiogroup" aria-label={player + "'s army"}>
              {MATCH_ARMY_CHOICES.map((choice) => {
                // Each side is a kingdom: the other player's kingdom is taken.
                const taken = duelArmies[side === "w" ? "b" : "w"] === choice.value;
                return <label className={"setup-choice setup-side-choice setup-army-choice" + (taken ? " is-taken" : "")} key={choice.value} style={{ ["--army-tint" as string]: ARMY_TINT[choice.value] }}>
                  <input type="radio" name={"match-army-" + side} aria-label={choice.label} disabled={taken} checked={duelArmies[side] === choice.value} onChange={() => setDuelArmies((current) => ({ ...current, [side]: choice.value }))} />
                  <span className="setup-choice-face"><KingdomSigil army={choice.value} /><strong>{choice.label}</strong></span>
                </label>;
              })}
            </div>
          </fieldset>)}
        </div>
      </div>

      <footer className="setup-footer">
        <div className="setup-footer-keys">
          <span className="setup-hint" aria-hidden="true"><kbd><InputPrompt action="select" /></kbd>{t("Select")}</span>
          <button type="button" className="setup-back" aria-label={t("Back to Play")} onClick={onBack}><kbd aria-hidden="true"><InputPrompt action="back" /></kbd>{t("Back")}</button>
        </div>
        <p id={summaryId} className="setup-summary" role="status" aria-live="polite" aria-atomic="true">{battlefield
          ? `${t(battlefield.subtitle)}, ${clockLabel}. ${mode === "classic" ? `${t(`${strength.label} computer`)}, ${t(`Aethelgard against ${ARMY_KINGDOMS[rival]}`)}, ${t(`You move ${playerColor === "w" ? "first" : "second"}`)}.` : `${t(`${ARMY_KINGDOMS[armies.w]} against ${ARMY_KINGDOMS[armies.b]}`)}, ${t("Two players")}.`}`
          : t("Choose a battlefield to continue.")}</p>
        <button type="button" className="setup-start" disabled={!setting} aria-label={t("Start match")} aria-describedby={summaryId} onClick={() => { if (setting) onStart({ mode, setting, difficulty, playerColor, clockMinutes, armies }); }}><span>{t(setting ? "Start match" : "Choose a battlefield")}</span><ArrowMark /></button>
      </footer>
    </div>
  </section></InputPromptContext.Provider>;
}
