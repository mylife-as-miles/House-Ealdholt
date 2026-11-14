/**
 * Pieces shared by the match HUD (MatchHud.tsx) and its pause menu (MatchPause.tsx): the fine-line marks, the setup's
 * arrow, the small piece figures, the menu's key chip and the confirm dialog. Styled by MatchHud.css.
 */
import { Fragment, useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { ARMY_TINT } from "./MatchSetup";
import type { ArmyId } from "../../../shared/play/match";
import type { PieceKind } from "../../../web/src/core/types";
import { useMenuLocale } from "../MenuLocale";
import type { ViewHint } from "./match-hud-model";

/** Fine-line marks in the manner of the setup's and the observer's (original to this HUD). */
const GLYPH = {
  duel: "M5 4l9.5 9.5 M19 4l-9.5 9.5 M12.5 16.5l4-4 M11.5 16.5l-4-4 M16 16l4 4 M8 16l-4 4",
  undo: "M9 14 4 9l5-5 M4 9h10a6 6 0 0 1 0 12h-3",
  flip: "M4.5 9.5A8 8 0 0 1 19 7 M19.5 3v4.5H15 M19.5 14.5A8 8 0 0 1 5 17 M4.5 21v-4.5H9",
  sound: "M4 9.5h3.5L12 6v12l-4.5-3.5H4z M15.5 9.2a4 4 0 0 1 0 5.6 M18 6.6a7.6 7.6 0 0 1 0 10.8",
  mute: "M4 9.5h3.5L12 6v12l-4.5-3.5H4z M16 9.5l5 5 M21 9.5l-5 5",
  sun: "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z M12 2.5v2.3 M12 19.2v2.3 M5.3 5.3l1.6 1.6 M17.1 17.1l1.6 1.6 M2.5 12h2.3 M19.2 12h2.3 M5.3 18.7l1.6-1.6 M17.1 6.9l1.6-1.6",
  flag: "M5 21.5V3 M5 4h13.5l-3 4.5 3 4.5H5",
  again: "M20 12a8 8 0 1 1-2.5-5.8 M20.5 3.5V8H16",
  leave: "M13 4h6.5v16H13 M15 12H3.5 M7.5 8l-4 4 4 4",
  moves: "M4 6h2 M9.5 6H20 M4 12h2 M9.5 12H20 M4 18h2 M9.5 18H20",
  menu: "M4 7h16 M4 12h16 M4 17h16",
  chevron: "M6 9.5l6 6 6-6",
  skip: "M5 5.5l6.5 6.5L5 18.5 M12.5 5.5 19 12l-6.5 6.5",
  pause: "M8.5 5v14 M15.5 5v14",
  play: "M7.5 4.5l12 7.5-12 7.5z",
  crown: "M3.5 8.5l4.3 3.8L12 5.5l4.2 6.8 4.3-3.8L18.6 18H5.4z M5.5 21h13",
  alert: "M12 3.5 2.5 20h19z M12 10v5 M12 17.6v.2",
  watch: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z M10 8.6l5.4 3.4-5.4 3.4z",
  save: "M5 4h11.5L19 6.5V20H5z M8.5 4v5h6.5V4 M8 20v-6.5h8V20",
  field: "M2.5 19.5 9 8.5l4.2 6.3 2.8-4.3 5.5 9z M16.5 5.5a1.6 1.6 0 1 0 0-.01",
  clock: "M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17z M12 7.5V12l3 2",
  stats: "M4 20.5h16 M6.5 17V11 M11 17V6 M15.5 17v-8 M20 17v-4",
  eye: "M2.5 12s3.6-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.6 6.5-9.5 6.5S2.5 12 2.5 12z M12 9.2a2.8 2.8 0 1 0 0 5.6 2.8 2.8 0 0 0 0-5.6z",
  cancel: "M6 6l12 12 M18 6 6 18",
} as const;
export type GlyphName = keyof typeof GLYPH;
export function Glyph({ name }: { name: GlyphName }) {
  return <svg className="hud-glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={GLYPH[name]} /></svg>;
}

/** The setup's Start arrow. */
export function Arrow() {
  return <svg className="hud-arrow" viewBox="0 0 32 12" fill="none" aria-hidden="true"><path d="M1 6H29M24 1 30 6 24 11" stroke="currentColor" strokeWidth="1.5" /></svg>;
}

/** The pieces as small solid figures, for what was taken and for the promotion picker. */
const PIECE: Record<PieceKind, string> = {
  p: "M12 3.4a3.3 3.3 0 0 1 2.3 5.7c1.5.9 2.4 2.3 2.6 4H7.1c.2-1.7 1.1-3.1 2.6-4A3.3 3.3 0 0 1 12 3.4ZM8 14.4h8l1.4 4.1H6.6ZM5.5 19.6h13V22h-13Z",
  n: "M7.4 18.5c0-4 2-5.6 3.7-7.1l-2.8 1-1.9-1.7 3.4-5L10.9 2.4 13 4.5c3.3.6 5.5 3.5 5.5 7.5 0 2.6-.6 4.4-1.4 6.5ZM5.5 19.6h13V22h-13Z",
  b: "M12 2a1.6 1.6 0 0 1 1.1 2.7c2.2 1.8 3.6 4 3.6 6.2 0 2-.9 3.5-2.3 4.4l1.4 3.2H8.2l1.4-3.2c-1.4-.9-2.3-2.4-2.3-4.4 0-2.2 1.4-4.4 3.6-6.2A1.6 1.6 0 0 1 12 2ZM5.5 19.6h13V22h-13Z",
  r: "M6 3h3v2.2h1.8V3h2.4v2.2H15V3h3v4.8l-1.8 1.8v6.3l1.6 2.6H6.2l1.6-2.6V9.6L6 7.8ZM5 19.6h14V22H5Z",
  q: "M3.4 7.4 7.4 12l1.4-7.4L12 11.4l3.2-6.8 1.4 7.4 4-4.6-2 11.1H5.4ZM5 19.6h14V22H5Z",
  k: "M11 2h2v2h2v2h-2v2.3c2.9.4 5 2.5 5 5.2 0 1.8-.8 3.3-2.2 4.3l1.2 1.7H7l1.2-1.7C6.8 16.8 6 15.3 6 13.5c0-2.7 2.1-4.8 5-5.2V6H9V4h2ZM5 19.6h14V22H5Z",
};
export function PieceGlyph({ kind }: { kind: PieceKind }) {
  return <svg className="hud-piece" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d={PIECE[kind]} /></svg>;
}

/** The menu's key chip; nothing where there is no key to show. */
export function Key({ children }: { children?: ReactNode }) {
  return children ? <kbd aria-hidden="true">{children}</kbd> : null;
}

/**
 * How the view is turned from the device in use (match-hud-model.ts, viewHints): a quiet line of the menu's key chips,
 * each with what it does. The HUD shows it under the move record until the view has been turned once; the pause menu
 * shows it always. It is for the eye: the board's own description says the same to a screen reader.
 */
export function ViewHints({ hints }: { hints: readonly ViewHint[] }) {
  const { t } = useMenuLocale();
  return <p className="hud-view-hints" aria-hidden="true">
    <span className="hud-view-title"><Glyph name="eye" />{t("View")}</span>
    {hints.map((hint) => <span key={hint.label} className="hud-view-hint">
      {hint.keys.map((key, index) => <Fragment key={key}>{hint.chord && index > 0 && <i>+</i>}<Key>{key}</Key></Fragment>)}
      <span>{t(hint.label)}</span>
    </span>)}
  </p>;
}

/** A kingdom's colour, for the parts drawn in it. */
export const tintOf = (army: ArmyId) => ({ ["--army-tint" as string]: ARMY_TINT[army] }) as CSSProperties;

export interface ConfirmCopy {
  glyph: GlyphName;
  /** The small heading over the question: what is being asked about. */
  heading: string;
  title: string;
  body: string;
  /** The two answers. The game's checks find the match's own by "Keep playing" and "Confirm". */
  cancel: string;
  confirm: string;
}

/**
 * Asked before something that cannot be taken back: leaving the match, beginning it again, resigning, putting a page
 * of settings back to its defaults. It opens on the answer that changes nothing, which Escape also gives.
 */
export function MatchConfirm({ copy, label = "Confirm match action", backKey, onCancel, onConfirm }: { copy: ConfirmCopy; label?: string; backKey: string | null; onCancel(): void; onConfirm(): void }) {
  const { t } = useMenuLocale();
  const dialog = useRef<HTMLDialogElement>(null);
  // Answered either way, the focus goes back to where it was when the question was asked. It is noted once: React's
  // development checks run this effect twice, and the second run would find the dialog's own button in focus.
  const asker = useRef<HTMLElement | null | undefined>(undefined);
  useEffect(() => {
    if (asker.current === undefined) asker.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!dialog.current?.open) dialog.current?.showModal();
    // While the dialog is open everything behind it is inert, so this only takes effect once it has gone.
    return () => { const back = asker.current; if (back?.isConnected) back.focus({ preventScroll: true }); };
  }, []);
  return <dialog className="match-confirm" ref={dialog} onCancel={(event) => { event.preventDefault(); onCancel(); }} aria-label={label}>
    <div className="hud-panel hud-confirm">
      <p className="hud-heading"><Glyph name={copy.glyph} /><span>{copy.heading}</span></p>
      <h2>{t(copy.title)}</h2>
      <p className="hud-confirm-body">{t(copy.body)}</p>
      <div className="hud-confirm-actions">
        <button type="button" className="hud-quiet" autoFocus data-hud-back="" onClick={onCancel}><Key>{backKey}</Key>{t(copy.cancel)}</button>
        <button type="button" className="hud-cta" onClick={onConfirm}><span>{t(copy.confirm)}</span><Arrow /></button>
      </div>
    </div>
  </dialog>;
}
