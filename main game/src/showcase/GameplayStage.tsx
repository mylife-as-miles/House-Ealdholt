import { useEffect, useRef, useState } from 'react';
import type { GamePortSetting } from '../../../shared/play/match';
import type { ShowcaseFrame } from '../../../shared/showcase/types';
import type { SceneEngine, CameraPreset } from '../../../web/src/scene/sceneEngine';
import type { GameController } from '../../../web/src/core/gameController';
import type { StagePreferences } from './ShowcaseStageView';
import { disposeBakedGroup, loadBakedEnvironment } from '../play/environment';
import LoadingScreen from '../LoadingScreen';

/** A passive board renderer. It cannot finish games or apply Legacy events. */
export default function GameplayStage({ setting, frame, camera = 'cinematic', preferences }: {
  setting: GamePortSetting; frame?: ShowcaseFrame | null; camera?: CameraPreset; preferences: StagePreferences;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const engine = useRef<SceneEngine | null>(null);
  const game = useRef<GameController | null>(null);
  const latest = useRef({ frame, camera, preferences }); latest.current = { frame, camera, preferences };
  const [ready, setReady] = useState(false), [error, setError] = useState(''), [progress, setProgress] = useState(0), [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    let active: SceneEngine | null = null, controller: GameController | null = null;
    let world: Awaited<ReturnType<typeof loadBakedEnvironment>> | null = null;
    setReady(false); setError(''); setProgress(0);
    void (async () => {
      try {
        const [{ SceneEngine }, { GameController }] = await Promise.all([import('../../../web/src/scene/sceneEngine'), import('../../../web/src/core/gameController')]);
        if (cancelled || !canvas.current) return;
        controller = new GameController(); game.current = controller;
        active = new SceneEngine(canvas.current, controller, { onLoadProgress: n => { if (!cancelled) setProgress(n * .5); }, onReady() {}, onPromotionOpen() {}, onQualityAdjusted() {}, onFps() {}, onContextLost: () => setError('The graphics context was lost. Retry loading.') }, latest.current.preferences.quality);
        engine.current = active; active.setInteractive(false); active.setReducedMotion(latest.current.preferences.reducedMotion);
        active.setRenderScale(latest.current.preferences.renderScale);
        await active.load({ warmClips: false });
        if (cancelled) return;
        world = await loadBakedEnvironment(setting, n => { if (!cancelled) setProgress(.5 + n * .5); });
        if (cancelled) { disposeBakedGroup(world); world = null; return; }
        active.setBakedWorld(world, setting === 'scene-02');
        active.start();
        if (latest.current.frame) controller.showReplayPosition(latest.current.frame.fen);
        // Orbit/zoom is enabled; the controller stays idle and rejects all moves.
        active.setInteractive(true);
        active.setCameraPreset(latest.current.camera);
        setReady(true);
      } catch (cause) { if (!cancelled) setError(cause instanceof Error ? cause.message : 'The match environment could not load.'); }
    })();
    // The arena is disposed before the engine, while the renderer still knows its GPU resources (A-05).
    return () => { cancelled = true; controller?.dispose(); if (world) disposeBakedGroup(world); world = null; active?.dispose(); engine.current = null; game.current = null; };
  }, [setting, attempt]);
  useEffect(() => { if (ready && frame) game.current?.showReplayPosition(frame.fen); }, [frame, ready]);
  useEffect(() => { if (ready) engine.current?.setCameraPreset(camera); }, [camera, ready]);
  useEffect(() => { engine.current?.setReducedMotion(preferences.reducedMotion); }, [preferences.reducedMotion]);
  useEffect(() => { engine.current?.setRenderScale(preferences.renderScale); }, [preferences.renderScale, ready]);
  useEffect(() => { engine.current?.setFrameLimit(preferences.frameLimit); }, [preferences.frameLimit, ready]);
  return <div className="gameplay-stage" data-replay-fen={frame?.fen} data-replay-setting={setting} data-replay-camera={camera} data-replay-ready={ready}>
    <canvas ref={canvas} aria-label="Recorded match pieces and battlefield" />
    {(!ready || error) && <LoadingScreen progress={error ? null : progress} status={error || 'Preparing the match environment'} progressLabel="Preparing replay" ready={false} leaving={false} reducedMotion={preferences.reducedMotion} degraded={!!error} onRetry={error ? () => setAttempt(n => n + 1) : undefined} />}
  </div>;
}
