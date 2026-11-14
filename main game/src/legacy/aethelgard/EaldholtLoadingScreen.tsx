import { useEffect, useState } from "react";
import { EALDHOLT_LOADING_COPY as COPY } from "../../../../shared/legacy/aethelgard/copy";
import { EALDHOLT_INTERFACE_COPY as UI } from "../../../../shared/legacy/aethelgard/interface-copy";
import { ealdholtLoadingPercent, type EaldholtLoadingProgress } from "../../../../shared/legacy/aethelgard/loading-progress";
import { useMenuLocale } from "../../MenuLocale";
import { LegacyGlassButton } from "./threeui-community/LegacyGlassButton";

/** Matches the fade-out in AethelgardPreview.css (.ealdholt-loading.is-leaving). */
export const EALDHOLT_LOADING_FADE_MS = 700;
/** A still of the village from the House Ealdholt opening, behind a dark wash. */
const BACKDROP = "assets/legacy/ealdholt-loading.webp";

export interface EaldholtLoadingScreenProps {
  /** The village loader's own state: this screen stays until it reports ready. */
  state: "loading" | "ready" | "error";
  progress: EaldholtLoadingProgress;
  reducedMotion: boolean;
  onRetry(): void;
  onHome(): void;
}

/**
 * My Legacy's own loading screen: it covers the stage while the village of
 * House Ealdholt is prepared, names the stage the loader has reached and fills
 * one bar. When the loader reports ready it fades out over the village (with
 * reduced motion it is simply removed). A failed load keeps the screen, with
 * the village's existing failure copy, Retry and Home. The boot and match
 * loading screen (src/LoadingScreen.tsx) is a different screen; only its
 * accessibility pattern is followed here.
 */
export function EaldholtLoadingScreen({ state, progress, reducedMotion, onRetry, onHome }: EaldholtLoadingScreenProps) {
  const { t } = useMenuLocale();
  // Present from the first frame of a load; gone once a ready village has been uncovered.
  const [gone, setGone] = useState(state === "ready");
  useEffect(() => {
    if (state !== "ready") { setGone(false); return; }
    if (reducedMotion) { setGone(true); return; }
    const timer = window.setTimeout(() => setGone(true), EALDHOLT_LOADING_FADE_MS);
    return () => window.clearTimeout(timer);
  }, [state, reducedMotion]);
  if (gone || state === "ready" && reducedMotion) return null;

  const leaving = state === "ready";
  const failed = state === "error";
  const value = leaving ? 1 : Math.min(1, Math.max(0, progress.value));
  const percent = leaving ? 100 : ealdholtLoadingPercent(progress);
  const status = t(leaving ? COPY.ready : COPY.stages[progress.stage]);
  const backdrop = new URL(BACKDROP, new URL(import.meta.env.BASE_URL, document.baseURI)).href;

  return <section
    className={`ealdholt-loading${leaving ? " is-leaving" : ""}${failed ? " is-error" : ""}${reducedMotion ? " is-still" : ""}`}
    data-ealdholt-loading={leaving ? "leaving" : state}
    data-ealdholt-loading-stage={failed ? undefined : progress.stage}
    data-ealdholt-loading-value={failed ? undefined : value.toFixed(3)}
    role="region"
    aria-label={t(COPY.accessibleName)}
    aria-busy={state === "loading"}
    inert={leaving}
  >
    <img className="ealdholt-loading-art" src={backdrop} alt="" draggable={false} aria-hidden="true" />
    <div className="ealdholt-loading-shade" aria-hidden="true" />
    <div className="ealdholt-loading-brand">
      <p className="ealdholt-loading-eyebrow">{t(COPY.eyebrow)}</p>
      <h2 className="ealdholt-loading-title">{COPY.title}</h2>
    </div>
    {failed ? <div className="ealdholt-loading-lower ealdholt-loading-failure" role="alert">
      <p className="ealdholt-loading-status">{t(COPY.error.title)}</p>
      <p className="ealdholt-loading-note">{t(COPY.error.body)}</p>
      <div className="ealdholt-loading-actions">
        <LegacyGlassButton data-nav data-nav-default data-ealdholt-loading-retry className="is-primary" onClick={onRetry}>{t(UI.retry)}</LegacyGlassButton>
        <LegacyGlassButton data-nav data-ealdholt-loading-home onClick={onHome}>{t(UI.home)}</LegacyGlassButton>
      </div>
    </div> : <div className="ealdholt-loading-lower">
      <div className="ealdholt-loading-status-line">
        <span className="ealdholt-loading-mark" aria-hidden="true" />
        <p className="ealdholt-loading-status" role="status" aria-live="polite" aria-atomic="true">{status}</p>
        <span className="ealdholt-loading-percent" aria-hidden="true">{percent}%</span>
      </div>
      <div
        className="ealdholt-loading-bar"
        role="progressbar"
        aria-label={t(COPY.progressLabel)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-valuetext={`${status}, ${percent}%`}
      >
        <span style={{ transform: `scaleX(${value})` }} />
      </div>
    </div>}
    {/* Reachable by pointer and Tab (Back and Esc also leave); kept out of Select, so a second press on the Home tile cannot leave again. */}
    {state === "loading" && <LegacyGlassButton data-ealdholt-loading-home className="is-quiet ealdholt-loading-leave" onClick={onHome}>{t(UI.home)}</LegacyGlassButton>}
  </section>;
}

export default EaldholtLoadingScreen;
