import { useMenuLocale } from "./MenuLocale";
import { InputPrompt } from "./InputPrompt";
import { forwardRef, useEffect, useRef, useState } from "react";
import "./MenuDialog.css";
import { INK_REVEAL } from "../../shared/menu/ink-transition";

export type MenuDialogProps = {
  title: string;
  artwork?: string;
  newlyUnlocked?: boolean;
  description: string;
  note?: string;
  panel: string;
  onConfirm: () => void;
  onCancel: () => void;
  reducedMotion: boolean;
  /** Reversible settings reset still defaults to keeping the current values. */
  defaultCancel?: boolean;
};

const MenuDialog = forwardRef<HTMLDialogElement, MenuDialogProps>(
  function MenuDialog(
    { title, description, note, panel, onConfirm, onCancel, reducedMotion, defaultCancel = false, artwork, newlyUnlocked = false },
    ref,
  ) {
    const { t } = useMenuLocale();
    const pointerStartedOutside = useRef(false);
    const [systemReducedMotion, setSystemReducedMotion] = useState(() =>
      typeof window === "undefined"
        ? false
        : window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    );

    useEffect(() => {
      const query = window.matchMedia("(prefers-reduced-motion: reduce)");
      const update = () => setSystemReducedMotion(query.matches);
      query.addEventListener("change", update);
      return () => query.removeEventListener("change", update);
    }, []);

    const still = reducedMotion || systemReducedMotion;

    const storyIntro = panel === 'chapter-preview';
    const body = useRef<HTMLDivElement>(null);
    useEffect(() => {
      if (!storyIntro || still || !body.current) return;
      const maskImage = `url("${import.meta.env.BASE_URL}${INK_REVEAL.mask}")`;
      const animation = body.current.animate([
        { maskImage, maskRepeat: 'no-repeat', maskPosition: '50% 50%', maskSize: '0% 0%' },
        { maskImage, maskRepeat: 'no-repeat', maskPosition: '50% 50%', maskSize: `${INK_REVEAL.finalScale * 100}% ${INK_REVEAL.finalScale * 100}%` },
      ], { duration: INK_REVEAL.durationMs, easing: INK_REVEAL.easing });
      return () => animation.cancel();
    }, [storyIntro, still]);

    return (
      <dialog
        ref={ref}
        className={`menu-dialog menu-dialog--reference${still ? " menu-dialog--still" : ""}`}
        data-panel={panel}
        aria-labelledby="dialog-heading"
        aria-describedby={
          note ? "dialog-description dialog-note" : "dialog-description"
        }
        onKeyDown={(event) => {
          if (event.key !== "Tab") return;
          const buttons = event.currentTarget.querySelectorAll<HTMLButtonElement>(
            ".dialog-actions button",
          );
          const first = buttons[0];
          const last = buttons[buttons.length - 1];
          if (!first || !last) return;
          if (event.shiftKey && (document.activeElement === first || document.activeElement === event.currentTarget)) {
            event.preventDefault();
            last.focus({ preventScroll: true });
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus({ preventScroll: true });
          }
        }}
        onCancel={(event) => {
          event.preventDefault();
          onCancel();
        }}
        onPointerDown={(event) => {
          pointerStartedOutside.current = event.target === event.currentTarget;
        }}
        onClick={(event) => {
          const outside =
            event.target === event.currentTarget &&
            pointerStartedOutside.current;
          pointerStartedOutside.current = false;
          if (outside) onCancel();
        }}
      >
        <div ref={body} className="dialog-inner" data-story-introduction={storyIntro || undefined} data-new-unlock={storyIntro && newlyUnlocked || undefined}>
          {storyIntro && artwork && <div className="chapter-introduction-art" style={{ backgroundImage: `url("${artwork}")` }} aria-hidden="true" />}
          <h1 id="dialog-heading">{t(title)}</h1>
          <div className="dialog-copy">
            <p id="dialog-description" className="dialog-description">
              {t(description)}
            </p>
            {note && (
              <p id="dialog-note" className="dialog-note">
                {t(note)}
              </p>
            )}
          </div>
          <div className="dialog-actions">
            <button
              type="button"
              className="primary-action"
              aria-label={t(storyIntro ? "Back to chapters" : "Confirm")}
              autoFocus={!defaultCancel}
              onClick={onConfirm}
            >
              <span className="dialog-key" aria-hidden="true"><InputPrompt action="select" /></span>
              {t(storyIntro ? "Back to chapters" : "Confirm")}
            </button>
            {!storyIntro && <button
              type="button"
              className="secondary-action"
              aria-label={t("Cancel")}
              autoFocus={defaultCancel}
              onClick={onCancel}
            >
              <span className="dialog-key" aria-hidden="true"><InputPrompt action="back" /></span>
              {t("Cancel")}
            </button>}
          </div>
        </div>
      </dialog>
    );
  },
);

export default MenuDialog;
