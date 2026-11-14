import { useEffect, useRef, useState } from "react";
import { INITIAL_SHOWCASE_FRAME } from "../../../shared/showcase/records";
import { SHOWCASE_COPY as copy } from "../../../shared/showcase/catalog";
import type { ShowcaseFrame } from "../../../shared/showcase/types";
import { createShowcaseStage } from "./ShowcaseStage";

export type ShowcaseCamera = "cinematic" | "board" | "side";
export interface StagePreferences {
  automaticGraphics?: boolean;
  quality: "low" | "medium" | "high";
  renderScale: number;
  frameLimit: 0 | 30 | 60 | 120;
  reducedMotion: boolean;
}

export default function ShowcaseStageView({ frame, arena, camera, preferences }: {
  frame: ShowcaseFrame | null; arena: number; camera: ShowcaseCamera; preferences: StagePreferences;
}) {
  const host = useRef<HTMLDivElement>(null);
  const stage = useRef<ReturnType<typeof createShowcaseStage> | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!host.current) return;
    setError("");
    try {
      const instance = createShowcaseStage(host.current, { ...preferences, onFailure: () => setError(copy.rendererFallback) });
      stage.current = instance;
      instance.setFrame(frame ?? INITIAL_SHOWCASE_FRAME);
      instance.setArena(arena);
      instance.setView(camera);
      const visibility = () => instance.setPaused(document.hidden);
      visibility();
      document.addEventListener("visibilitychange", visibility);
      return () => { document.removeEventListener("visibilitychange", visibility); instance.dispose(); stage.current = null; };
    } catch {
      setError(copy.rendererFallback);
    }
    // Scene lifetime is independent of playback/quality changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);
  useEffect(() => { stage.current?.setFrame(frame ?? INITIAL_SHOWCASE_FRAME); }, [frame]);
  useEffect(() => { stage.current?.setArena(arena); }, [arena]);
  useEffect(() => { stage.current?.setView(camera); }, [camera]);
  useEffect(() => { stage.current?.setPreferences(preferences); }, [preferences.quality, preferences.renderScale, preferences.frameLimit, preferences.reducedMotion]);
  return <div className={`showcase-stage${error ? " has-error" : ""}`} data-stage-arena={arena} data-stage-ply={frame?.ply ?? 0} data-stage-view={camera} data-stage-quality={preferences.quality} data-stage-reduced-motion={preferences.reducedMotion} data-stage-render-scale={preferences.renderScale} data-stage-frame-limit={preferences.frameLimit}>
    <div className="showcase-stage-host" ref={host} aria-label="Live three-dimensional chess exhibition" role="img" />
    {error && <div className="showcase-stage-failure" role="status"><span>{error}</span><button type="button" data-showcase-control onClick={() => setAttempt(value => value + 1)}>{copy.retry}</button></div>}
    <span className="showcase-stage-vignette" aria-hidden="true" />
  </div>;
}
