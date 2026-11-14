import { useMenuLocale } from '../MenuLocale';
import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import type { ShowcaseRecord } from '../../../shared/showcase/types';
import type { CameraPreset, SceneEngine } from '../../../web/src/scene/sceneEngine';
import type { GameController } from '../../../web/src/core/gameController';
import { audio } from '../../../web/src/audio/audioManager';
import { ARMY_KINGDOMS } from '../../../shared/play/match';
import { replayNotes, replayScriptOf, type ReplayScript } from '../../../shared/play/replay-show';
import { CinematicReplay } from './cinematic-replay';
import type { StagePreferences } from './ShowcaseStageView';
import { disposeBakedGroup, loadBakedEnvironment } from '../play/environment';
import { createBattlefieldLook } from '../play/battlefield-look';
import { claimantOf } from '../play/arena-sorcerer';
import { subscribeMatchAudioPreferences } from '../play/match-audio-settings';
import { applyVoiceLine, stepCaptions, type Caption } from '../play/match-subtitles';
import type { Chronicle } from '../../../shared/play/chronicle';
import type { SubtitleSize } from '../settings-types';
import LoadingScreen from '../LoadingScreen';
import '../play/play.css';

/** `match` is the seat the game was played from (a duel's view swinging between turns, as it did); the rest are fixed views. */
export type ReplayCamera = 'match' | 'cinematic' | 'top' | 'black';
export interface ReplayStageHandle { next(): void; skip(): void }
/** What the transport shows about the stage: whether a battle or the ending is on (Skip), and what the record could not keep. */
export interface ReplayStageStatus { ready: boolean; performing: 'move' | 'battle' | 'ending' | null; notes: readonly string[] }

interface ReplayStageProps {
  /** A recorded match (record.match is set). */
  record: ShowcaseRecord;
  /** The Showcase session's timeline: where the board should be, and whether it plays. */
  ply: number;
  playing: boolean;
  speed: number;
  battlesOnly: boolean;
  camera: ReplayCamera;
  preferences: StagePreferences;
  /** A move has begun that brings the board to `ply` (ShowcaseSession.reach). */
  onReach(ply: number): void;
  /** The replay has been shown to its end (ShowcaseSession.finishPlayback). */
  onFinish(): void;
  onStatus?(status: ReplayStageStatus): void;
}

/**
 * A recorded match played back as it was played: the same SceneEngine, board, figures, kingdoms, arena, lighting and
 * sorcerer as the live match (MatchExperience), each recorded move performed through the real controller
 * (shared/play/replay-show.ts, ./cinematic-replay.ts). It cannot start a clock, the computer, a gameover or a Legacy
 * effect. Native orbit and zoom stay available; moves are refused.
 */
export default forwardRef<ReplayStageHandle, ReplayStageProps>(function ReplayStage({ record, ply, playing, speed, battlesOnly, camera, preferences, onReach, onFinish, onStatus }, ref) {
  const { t } = useMenuLocale();
  const canvas = useRef<HTMLCanvasElement>(null);
  const root = useRef<HTMLDivElement>(null), frameBox = useRef<HTMLDivElement>(null);
  const engine = useRef<SceneEngine | null>(null);
  const driver = useRef<CinematicReplay | null>(null);
  const script = useRef<ReplayScript | null>(null);
  /** The ply the stage last told the session about: a session ply that differs is the viewer's own seek. */
  const reported = useRef(ply);
  const latest = useRef({ ply, playing, speed, battlesOnly, camera, preferences, onReach, onFinish, onStatus });
  latest.current = { ply, playing, speed, battlesOnly, camera, preferences, onReach, onFinish, onStatus };
  const [ready, setReady] = useState(false), [error, setError] = useState(''), [progress, setProgress] = useState(0), [status, setStatus] = useState('Preparing the battlefield');
  const [attempt, setAttempt] = useState(0);
  const [performing, setPerforming] = useState<ReplayStageStatus['performing']>(null);
  const [notes, setNotes] = useState<readonly string[]>([]);
  const [subtitles, setSubtitles] = useState<{ on: boolean; size: SubtitleSize }>({ on: true, size: 'medium' });
  const [captions, setCaptions] = useState<Caption[]>([]);
  /** The battle's chronicle as the ending wrote it (SceneEngine onChronicle), shown once the replay has shown that ending. */
  const [chronicle, setChronicle] = useState<Chronicle | null>(null), [ended, setEnded] = useState(false);
  const fidelity = useRef<'exact' | 'plain'>('exact');
  const violence = useRef<Parameters<SceneEngine['setViolenceIntensity']>[0]>('cinematic');

  useImperativeHandle(ref, () => ({ next: () => driver.current?.next(), skip: () => driver.current?.skip() }), []);

  // The canvas the match was seen in. A Classic game or a duel filled the window, so the replay's canvas has the window's
  // size and is shown scaled down inside the stage; an AI Battle was watched in this very stage and fills it. The
  // engine frames by that canvas (its shape, and whether it is small enough to play like a phone's), and the shots a
  // fight chooses (the duel camera, the hand the Claiming is seen in) follow, so the replay chooses the same ones.
  useLayoutEffect(() => {
    const host = root.current, box = frameBox.current;
    if (!host || !box) return;
    const fit = () => {
      const width = host.clientWidth, height = host.clientHeight;
      const live = record.match?.mode === 'ai-battle' ? { w: width, h: height } : { w: window.innerWidth, h: window.innerHeight };
      const scale = Math.min(width / Math.max(1, live.w), height / Math.max(1, live.h));
      box.style.width = `${Math.round(live.w)}px`; box.style.height = `${Math.round(live.h)}px`;
      box.style.transform = `translate(-50%, -50%) scale(${scale})`;
      engine.current?.handleResize();
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(host);
    window.addEventListener('resize', fit);
    return () => { observer.disconnect(); window.removeEventListener('resize', fit); };
  }, [record.match?.mode]);

  // The viewer's own settings, as a live match takes them: levels, subtitles and how much blood is shown.
  useEffect(() => subscribeMatchAudioPreferences(preferences => {
    audio.configure(preferences);
    setSubtitles({ on: preferences.subtitles, size: preferences.subtitleSize });
    violence.current = preferences.violence; engine.current?.setViolenceIntensity(preferences.violence);
  }), []);

  // Subtitles as the live match shows them, naming each side by the kingdom it fielded.
  useEffect(() => {
    const now = () => performance.now() / 1000;
    let all: Caption[] = [], shown: Caption[] = [];
    const refresh = () => {
      const step = stepCaptions(all, now());
      all = step.live;
      if (step.visible.length !== shown.length || step.visible.some((caption, i) => caption !== shown[i])) { shown = step.visible; setCaptions(step.visible); }
    };
    // As the live match: a line said a moment ahead goes up as its voice starts and comes down as its words end.
    const exact = new Set<number>();
    const at = (seconds: number) => { const id = window.setTimeout(() => { exact.delete(id); refresh(); }, Math.max(0, seconds - now()) * 1000 + 1); exact.add(id); };
    const unsubscribe = audio.onVoiceLine(event => {
      const armies = script.current?.armies;
      all = applyVoiceLine(all, event, now(), side => armies ? ARMY_KINGDOMS[armies[side]] : side === 'w' ? 'Aethelgard' : 'Solforiz');
      refresh();
      if (event.type !== 'clear') for (const caption of all) if (caption.token === event.token) { if (caption.showAt > now()) at(caption.showAt); at(caption.hideAt); }
    });
    const timer = window.setInterval(refresh, 100);
    return () => { unsubscribe(); window.clearInterval(timer); for (const id of exact) window.clearTimeout(id); };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let active: SceneEngine | null = null, controller: GameController | null = null, world: THREE.Group | null = null;
    let look: Awaited<ReturnType<typeof createBattlefieldLook>> | null = null;
    let heard: boolean | null = null;
    setReady(false); setError(''); setProgress(0); setPerforming(null);
    const plan = replayScriptOf(record);
    script.current = plan;
    if (!plan) { setError('This replay is not a recorded match.'); return; }
    fidelity.current = plan.fidelity;
    setNotes(replayNotes(plan));
    const prefs = latest.current.preferences;
    void (async () => {
      try {
        const [{ SceneEngine: Engine }, { GameController: Controller }] = await Promise.all([import('../../../web/src/scene/sceneEngine'), import('../../../web/src/core/gameController')]);
        if (cancelled || !canvas.current) return;
        controller = new Controller();
        // As MatchExperience stages a match: the same engine settings, the kingdoms the record names, the same arena.
        active = new Engine(canvas.current, controller, {
          onLoadProgress: n => { if (!cancelled) setProgress(n * .45); }, onReady() {}, onPromotionOpen() {}, onQualityAdjusted() {}, onFps() {},
          onContextLost: () => setError('The graphics context was lost. Retry loading.'),
          onChronicle: written => { if (!cancelled) setChronicle(written); },
        }, prefs.quality);
        engine.current = active;
        active.setRenderScale(prefs.renderScale);
        active.setInteractive(false); active.setReducedMotion(prefs.reducedMotion); active.setViolenceIntensity(violence.current);
        active.setBattlefieldQuality(prefs.automaticGraphics ? 'auto' : prefs.quality);
        active.setArmySkins(plan.armies);
        await active.load({ warmClips: false });
        if (cancelled) return;
        setStatus('Loading the arena and its lighting');
        const setting = record.match!.setting;
        world = new THREE.Group(); world.scale.setScalar(1 / 2.3);
        active.setBakedWorld(world, setting === 'scene-02');
        const context = active.getBattlefieldContext();
        const shadows = { enabled: context.renderer.shadowMap.enabled, type: context.renderer.shadowMap.type };
        try {
          look = await createBattlefieldLook({ ...context, world, setting, quality: prefs.automaticGraphics ? 'auto' : prefs.quality, renderScale: prefs.renderScale,
            reducedMotion: () => latest.current.preferences.reducedMotion, cancelled: () => cancelled });
        } catch (cause) {
          if (cancelled) return;
          // The same fallback as the live match (MatchExperience): the baked arena and its lightmaps.
          console.warn('[replay] battlefield look unavailable; staging the baked arena instead', cause);
          disposeBakedGroup(world); world = null;
          context.renderer.shadowMap.enabled = shadows.enabled; context.renderer.shadowMap.type = shadows.type;
          active.setRenderScale(prefs.renderScale);
          const baked = await loadBakedEnvironment(setting, n => { if (!cancelled) setProgress(.45 + n * .4); });
          if (cancelled) { disposeBakedGroup(baked); return; }
          world = baked;
          active.setBakedWorld(baked, setting === 'scene-02');
        }
        if (cancelled) return;
        if (look) {
          if (look.sorcerer) active.setClaimant(claimantOf(look.sorcerer));
          active.setBattlefieldRenderer(look);
          if (look.board) active.setBakedBoard(look.board);
        }
        active.start();
        setStatus('Preparing the battles'); setProgress(.9);
        // Every strike, fall and authored duel clip is in hand before the first fight: none plays a stand-in.
        await active.prepareReplay();
        if (cancelled) return;
        const replay = new CinematicReplay(controller, active, plan, {
          // Held, the board's sound is gated and the match score draws back as for a paused exhibition (audioManager.ts).
          setHeard: next => { if (heard === next) return; heard = next; audio.setReplayHeard(next); },
        }, {
          reached: at => { reported.current = at; setEnded(false); latest.current.onReach(at); },
          finished: () => { setEnded(true); latest.current.onFinish(); },
          performing: on => setPerforming(on ? replay.position >= plan.moves.length ? 'ending' : plan.moves[replay.position].capture ? 'battle' : 'move' : null),
        });
        driver.current = replay;
        void audio.unlock(); audio.setScene('battle');
        reported.current = latest.current.ply;
        replay.setSpeed(latest.current.speed); replay.setBattlesOnly(latest.current.battlesOnly);
        replay.open(latest.current.ply);
        applyCamera(active, plan, latest.current.camera);
        // Orbit and zoom stay the viewer's; the replay's controller refuses every move.
        active.setInteractive(true);
        setReady(true);
        if (latest.current.playing) replay.play();
      } catch (cause) { if (!cancelled) { console.error('[replay] load failed', cause); setError(cause instanceof Error ? cause.message : 'The recorded match could not be staged.'); } }
    })();
    return () => {
      cancelled = true;
      driver.current?.dispose(); driver.current = null;
      controller?.dispose();
      // The arena is disposed before the engine, while the renderer still knows its GPU resources (A-05).
      if (world) disposeBakedGroup(world);
      world = null;
      active?.dispose();
      if (look) { look.dispose(); if (look.board) disposeBakedGroup(look.board); }
      engine.current = null;
      audio.setMuted(true);
    };
    // One stage per record and quality; the transport is synchronised below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [record.id, record.pgn, preferences.quality, attempt]);

  // The session's timeline drives the transport: a ply the stage did not report is the viewer's seek.
  useEffect(() => {
    const replay = driver.current;
    if (!ready || !replay) return;
    if (ply !== reported.current) { reported.current = ply; setEnded(false); replay.seek(ply); }
    if (playing) replay.play(); else replay.pause();
  }, [ply, playing, ready]);
  useEffect(() => { driver.current?.setSpeed(speed); }, [speed, ready]);
  useEffect(() => { driver.current?.setBattlesOnly(battlesOnly); }, [battlesOnly, ready]);
  useEffect(() => { if (ready && engine.current && script.current) applyCamera(engine.current, script.current, camera); }, [camera, ready]);
  useEffect(() => { engine.current?.setReducedMotion(preferences.reducedMotion); }, [preferences.reducedMotion]);
  useEffect(() => { engine.current?.setRenderScale(preferences.renderScale); }, [preferences.renderScale, ready]);
  useEffect(() => { engine.current?.setFrameLimit(preferences.frameLimit); }, [preferences.frameLimit, ready]);
  useEffect(() => { latest.current.onStatus?.({ ready, performing, notes }); }, [ready, performing, notes]);

  const frame = record.frames[Math.max(0, Math.min(record.frames.length - 1, ply))];
  const seat = script.current && camera === 'match' ? seatOf(script.current) : camera;
  return <div ref={root} className="gameplay-stage replay-stage" data-replay-fen={frame?.fen} data-replay-setting={record.match?.setting} data-replay-camera={seat}
    data-replay-ready={ready} data-replay-ply={ply} data-replay-performing={performing ?? 'none'} data-replay-fidelity={fidelity.current}>
    <div ref={frameBox} className="replay-stage-frame"><canvas ref={canvas} aria-label="Recorded match pieces and battlefield" /></div>
    {ready && notes.length > 0 && <p className="replay-stage-note" role="note">{notes.map(note => t(note)).join(' ')}</p>}
    {ready && ended && chronicle && <section className="match-chronicle replay-chronicle" aria-label="Chronicle of the battle"><h3>{chronicle.title}</h3>{chronicle.lines.map((line, index) => <p key={index}>{line}</p>)}</section>}
    {ready && subtitles.on && <div className="match-subtitles replay-subtitles" data-size={subtitles.size} role="log" aria-live="polite" aria-label="Subtitles">{captions.map(caption => <p key={caption.token} data-side={caption.side ?? 'fallen'}>{caption.speaker && <b>{caption.speaker}</b>}<span>{caption.text}</span></p>)}</div>}
    {(!ready || error) && <LoadingScreen progress={error ? null : progress} status={t(error || status)} progressLabel="Preparing replay" ready={false} leaving={false} reducedMotion={preferences.reducedMotion} degraded={!!error} onRetry={error ? () => setAttempt(n => n + 1) : undefined} />}
  </div>;
});

/**
 * Where the live game's camera sat: behind the player's own side in Classic, behind White in a duel (MatchExperience),
 * and the Showcase's Cinematic view an AI Battle opens on (GameplayShowcase).
 */
const seatOf = (script: ReplayScript): CameraPreset => script.mode === 'demo' ? 'cinematic' : script.mode === 'ai' && script.playerColor === 'b' ? 'black' : 'white';

/** The live game's seat (with its turn swing in a duel), or one of the fixed views. */
function applyCamera(engine: SceneEngine, script: ReplayScript, camera: ReplayCamera): void {
  engine.setRotateBoard(camera === 'match');
  engine.setCameraPreset(camera === 'match' ? seatOf(script) : camera);
}
