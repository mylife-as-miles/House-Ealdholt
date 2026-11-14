import { lazy, Suspense, useState } from "react";
import type { MatchConfig, PlayMode } from "../../../shared/play/match";
import type { ReplayEntry } from "../../../shared/showcase/types";
import MatchSetup from "./MatchSetup";
import NationsReveal, { shouldRevealKingdoms } from "./NationsReveal";
import LoadingScreen from "../LoadingScreen";
import "./play.css";

const MatchExperience = lazy(() => import("./MatchExperience"));

export default function PlayRoute({ mode, onBack, quality, automaticGraphics, renderScale, reducedMotion, onWatchReplay, frameLimit = 0 }: { onWatchReplay(entry: ReplayEntry): void; mode: PlayMode; onBack(): void; quality: "low" | "medium" | "high"; automaticGraphics: boolean; renderScale: number; reducedMotion: boolean; /** Player frame-rate cap in frames per second; 0 means the display rate. */ frameLimit?: number }) {
  const [config, setConfig] = useState<MatchConfig | null>(null);
  // A new match mounted for Retry (and for a rematch with legacy stakes); every other rematch is played in place inside
  // MatchExperience, on the battlefield already loaded (A-01).
  const [attempt, setAttempt] = useState(0);
  // A match begun from the setup opens with the whole opening; a rematch or a retry with the short one.
  const [opening, setOpening] = useState<"full" | "short">("full");
  // The first time a player opens Classic or Local Duel, the four kingdoms are revealed before the setup.
  const [reveal, setReveal] = useState(shouldRevealKingdoms);
  return <div className={`play-route${config ? " is-playing" : ""}`}>
    {config ? <Suspense fallback={<LoadingScreen progress={null} status="Preparing the game…" ready={false} leaving={false} reducedMotion={reducedMotion} onBack={() => setConfig(null)} progressLabel="Preparing battlefield" />}>
      <MatchExperience key={attempt} config={config} onWatchReplay={onWatchReplay} quality={quality} automaticGraphics={automaticGraphics} renderScale={renderScale} reducedMotion={reducedMotion} frameLimit={frameLimit} onBack={onBack} onSetup={() => setConfig(null)} onRetry={() => { setOpening("short"); setAttempt((n) => n + 1); }} opening={opening} />
    </Suspense> : reveal ? <NationsReveal onDone={() => setReveal(false)} onBack={onBack} reducedMotion={reducedMotion} />
      : <MatchSetup mode={mode} onStart={(next) => { setOpening("full"); setConfig(next); }} onBack={onBack} reducedMotion={reducedMotion} />}
  </div>;
}
