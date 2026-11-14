import { useMenuLocale } from "../MenuLocale";
import { lazy, Suspense, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { ARMY_KINGDOMS, matchArmies, matchOptions, type MatchConfig } from "../../../shared/play/match";
import type { GameController } from "../../../web/src/core/gameController";
import { PIECE_LABEL, type GameSnapshot, type PieceKind } from "../../../web/src/core/types";
import type { SceneEngine } from "../../../web/src/scene/sceneEngine";
import { DEFAULT_PROMOTION_FOCUS, promotionKeyAction, type PromotionChoice } from "../../../web/src/scene/promotion/promotionChoice";
import { audio } from "../../../web/src/audio/audioManager";
import { disposeBakedGroup, loadBakedEnvironment } from "./environment";
import * as THREE from 'three';
import { createBattlefieldLook } from './battlefield-look';
import { claimantOf, type ArenaSorcerer } from './arena-sorcerer';
import { captureCompletedMatch } from "../../../shared/play/replay";
import type { Chronicle } from "../../../shared/play/chronicle";
import type { ReplayEntry } from "../../../shared/showcase/types";
import { localId } from "../../../shared/showcase/records";
import { saveMatchReplay } from "../showcase/match-replays";
import { subscribeMatchAudioPreferences } from "./match-audio-settings";
import { applyVoiceLine, stepCaptions, type Caption } from "./match-subtitles";
import { DEFAULT_VIOLENCE_INTENSITY, type ViolenceIntensity } from "../../../shared/menu/violence";
import type { SubtitleSize } from "../settings-types";
import LoadingScreen from "../LoadingScreen";
import { buildMatchOpening, type MatchOpeningBeatId, type MatchOpeningCut, type MatchOpeningPlan } from "../../../shared/play/match-opening";
import MatchOpening from "./MatchOpening";
import MatchHud, { type MatchHudActions } from "./MatchHud";
import { queuedAnnouncement, tapAnnouncement } from "./match-hud-model";

/** One press of a view key: a twenty-fourth of a turn round the board, a few degrees of height, a tenth of the distance. */
const VIEW_KEY_TURN = Math.PI / 12, VIEW_KEY_TILT = 0.07, VIEW_KEY_PULL = 0.1;
const time = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}`;

export interface SpectatorControls {
  pause(): void;
  speed(value: number): void;
  camera(value: "cinematic" | "top" | "black"): void;
}
const LegacyMatchReview = lazy(() => import('./LegacyMatchReview'));

/** The opening to play before this match, or null: none was asked for, motion is reduced, or a script is driving
 * the browser (the game's checks start their matches at once; `?opening=match` plays it regardless). */
function matchOpeningFor(config: MatchConfig, cut: MatchOpeningCut | "none", reducedMotion: boolean): MatchOpeningPlan | null {
  if (cut === "none" || reducedMotion) return null;
  try { if (navigator.webdriver && new URLSearchParams(window.location.search).get("opening") !== "match") return null; } catch { return null; }
  return buildMatchOpening(config, cut);
}

/**
 * Resolves once the page is drawing steadily. The first frames of a scene build its shaders and can each take
 * seconds; this waits them out: after the first two frames, three in a row must each come within a quarter of a
 * second of the one before, or within 1.6 times the quickest frame seen (so a slow machine's even pace counts). It
 * gives up after `limit` milliseconds, or after four seconds without a frame at all (a tab that is not being drawn).
 */
const steadyFrames = (limit: number) => new Promise<void>((resolve) => {
  const started = performance.now();
  let last = started, quickest = Infinity, seen = 0, steady = 0, frame = 0, idle = 0, done = false;
  const finish = () => { if (done) return; done = true; cancelAnimationFrame(frame); window.clearTimeout(idle); resolve(); };
  const tick = () => {
    const now = performance.now(), took = now - last;
    window.clearTimeout(idle); idle = window.setTimeout(finish, 4000);
    last = now; quickest = Math.min(quickest, took); seen++;
    steady = seen > 2 && took < Math.max(250, quickest * 1.6) ? steady + 1 : 0;
    if (steady >= 3 || now - started > limit) finish(); else frame = requestAnimationFrame(tick);
  };
  idle = window.setTimeout(finish, 4000);
  frame = requestAnimationFrame(tick);
});
export default function MatchExperience(props: Parameters<typeof ActiveMatchExperience>[0]) {
  const [accepted, setAccepted] = useState(props.config.mode !== "classic" || !props.config.legacy);
  if (!accepted && props.config.mode === "classic" && props.config.legacy) return <Suspense fallback={<LoadingScreen progress={null} status="Preparing match stakes" ready={false} leaving={false} reducedMotion={props.reducedMotion} onBack={props.onSetup} />}>
    <LegacyMatchReview setup={props.config.legacy} onAccept={() => setAccepted(true)} onBack={props.onSetup} />
  </Suspense>;
  return <ActiveMatchExperience {...props} />;
}

function ActiveMatchExperience({ config, quality, automaticGraphics = false, renderScale = 100, reducedMotion, frameLimit = 0, onBack, onSetup, onRetry, onWatchReplay, embedded = false, onSnapshot, onSpectatorReady, onReplayReady, opening: openingCut = "none", round: rematchRound = 0 }: {
  /** The opening played before the first move: the whole of it, the short one of a rematch, or none (the default). */
  opening?: MatchOpeningCut | "none";
  /**
   * Load the match afresh (the parent mounts a new one): Retry after a failure, and a rematch of a match with legacy
   * stakes, which are reviewed again. Every other rematch is played in place, on the battlefield already up (A-01).
   */
  onRetry(): void;
  /** A change asks for a rematch in place (the Showcase's "New exhibition"); the HUD's "Play again" asks for it itself. */
  round?: number;
  config: MatchConfig; automaticGraphics?: boolean; quality: "low" | "medium" | "high"; renderScale?: number; reducedMotion: boolean; onBack(): void; onSetup(): void; onWatchReplay?(entry: ReplayEntry): void;
  frameLimit?: number;
  embedded?: boolean;
  onSnapshot?(snapshot: GameSnapshot): void;
  onSpectatorReady?(controls: SpectatorControls): void;
  onReplayReady?(entry: ReplayEntry): void;
}) {
  const { t } = useMenuLocale();
  const events = useRef({ onSnapshot, onSpectatorReady, onReplayReady });
  // Each side is called by the kingdom whose army it fields (Classic: you are always Aethelgard).
  const armies = matchArmies(config);
  const nameOf = (side: "w" | "b") => ARMY_KINGDOMS[armies[side]];
  const sideNames = useRef(nameOf); sideNames.current = nameOf;
  events.current = { onSnapshot, onSpectatorReady, onReplayReady };
  // Made once per match, and without crypto.randomUUID, which a plain-http LAN address does not have (M-14).
  const [initialMatchId] = useState(() => (config.mode === "classic" ? config.legacy?.matchId : undefined) ?? localId("match"));
  const matchId = useRef(initialMatchId);
  /** The games played on this battlefield: each rematch played in place is the next (the HUD starts afresh with it). */
  const [gameNumber, setGameNumber] = useState(0);
  /** Set by the load once the battlefield is up: begins another game on it (A-01). Null while loading or lost. */
  const rematchInPlace = useRef<((cut: MatchOpeningCut | "none") => boolean) | null>(null);
  const completed = useRef<ReplayEntry | null>(null);
  const [replay, setReplay] = useState<ReplayEntry | null>(null);
  const [legacyNotice, setLegacyNotice] = useState("");
  const [replayNotice, setReplayNotice] = useState("");
  const [savingReplay, setSavingReplay] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const controller = useRef<GameController | null>(null);
  const engine = useRef<SceneEngine | null>(null);
  const motion = useRef(reducedMotion);
  const violence = useRef<ViolenceIntensity>(DEFAULT_VIOLENCE_INTENSITY);
  useEffect(() => { motion.current = reducedMotion; engine.current?.setReducedMotion(reducedMotion); }, [reducedMotion]);
  const [snapshot, setSnapshot] = useState<GameSnapshot | null>(null);
  const [ready, setReady] = useState(false);
  // `staged`: the scene is on screen (the opening, then the match). `ready`: the match itself has begun.
  const [staged, setStaged] = useState(false);
  const [opening, setOpening] = useState<{ plan: MatchOpeningPlan; beat: MatchOpeningBeatId } | null>(null);
  // Played once for this match: a reload of the scene (a quality change) does not play it again.
  const openingWanted = useRef(openingCut);
  const resolution = useRef(renderScale); resolution.current = renderScale;
  const frameCap = useRef(frameLimit); frameCap.current = frameLimit;
  // The player's frame-rate cap reaches the arena too (A-09), now and whenever it changes.
  useEffect(() => { engine.current?.setFrameLimit(frameLimit); }, [frameLimit]);
  useEffect(() => { engine.current?.setRenderScale(renderScale); }, [renderScale, ready]);
  const [loading, setLoading] = useState("Preparing the pieces…");
  const [progress, setProgress] = useState<number | null>(0);
  const [error, setError] = useState<string | null>(null);
  const [conclusion, setConclusion] = useState(false);
  /** What the battle meant, from the record (shared/play/chronicle.ts): the ending writes it, the results show it. */
  const [chronicle, setChronicle] = useState<Chronicle | null>(null);
  const [fighting, setFighting] = useState(false);
  // A piece held while the board is busy, or the move queued for it (SceneEngine holds it; the HUD offers to call it off).
  const [queued, setQueued] = useState<{ from: string; to: string | null } | null>(null);
  // The view has been turned from the keys or a controller: the HUD stops showing how (the pause menu still does).
  const [viewFound, setViewFound] = useState(false);
  const [promotion, setPromotion] = useState(false);
  /** The candidate the board's picker has in focus: the HUD's panel highlights its row. */
  const [promotionFocus, setPromotionFocus] = useState<PromotionChoice>(DEFAULT_PROMOTION_FOCUS);
  const [muted, setMuted] = useState(false);
  const [confirm, setConfirm] = useState<"leave" | "restart" | "resign" | null>(null);
  const [brightness, setBrightness] = useState(1);
  // Graphics quality changes reach the running match (the pause menu's Settings can change it mid-game): the figures and
  // the arena's look take the new quality as they are, and the match goes on. The scene is built with the quality of
  // the moment it is loaded.
  const graphics = useRef({ quality, automatic: automaticGraphics }); graphics.current = { quality, automatic: automaticGraphics };
  useEffect(() => { engine.current?.setQuality(quality); engine.current?.setBattlefieldQuality(automaticGraphics ? 'auto' : quality); }, [automaticGraphics, quality]);
  // The pause menu (MatchPause.tsx, drawn by the HUD). While it is open the match is held: its clocks stop and the
  // computer does not move (a move it has ready waits). Closing it lets go only of a hold the menu made, so a
  // computer that failed, or an AI battle paused from its own tile, stays held.
  const [pauseOpen, setPauseOpen] = useState(false);
  const pauseHeld = useRef(false);
  // The scene is held with it: a fight, a fatality's slow motion, a Queen's rite or the ending stand still on screen
  // and go on from the same frame (SceneEngine.setHeld).
  const openPause = () => {
    const game = controller.current;
    if (!ready || pauseOpen) return;
    if (game && !game.getSnapshot().paused) { game.setPaused(true); pauseHeld.current = game.getSnapshot().paused; }
    engine.current?.setHeld(true);
    setPauseOpen(true);
  };
  const closePause = () => {
    setPauseOpen(false);
    engine.current?.setHeld(false);
    if (pauseHeld.current) { pauseHeld.current = false; controller.current?.setPaused(false); }
  };
  const [graphicsStats, setGraphicsStats] = useState<Record<string, unknown>>({});
  const [announcement, setAnnouncement] = useState("Arrow keys explore squares. Enter selects a piece or a destination.");
  // The match mixes its own sound under the menu's settings. The page has already had a press, so it may start now:
  // the board's opening bell needs the mixer awake before the first move.
  const [subtitles, setSubtitles] = useState<{ on: boolean; size: SubtitleSize }>({ on: true, size: "medium" });
  const [captions, setCaptions] = useState<Caption[]>([]);
  useEffect(() => {
    const unsubscribe = subscribeMatchAudioPreferences((preferences) => {
      audio.configure(preferences);
      setSubtitles({ on: preferences.subtitles, size: preferences.subtitleSize });
      violence.current = preferences.violence; engine.current?.setViolenceIntensity(preferences.violence);
    });
    // Silent and already in the battle's scene under the loading screen, as every later match is (closing a match
    // mutes the mixer): left in the menu's scene, the first match after a page load played the old dirge under the
    // loading screen and faded it out over the arena's first second. The arena unmutes it once it is drawn.
    audio.setMuted(true); audio.setScene("battle");
    void audio.unlock();
    return unsubscribe;
  }, []);
  // Subtitles follow the mixer: each spoken line as it starts (some start after a delay), cut short by a blow, or
  // cleared when the voices are silenced. A light poll puts them up and takes them down on time; a line the page was
  // too busy to draw while it was spoken goes up late rather than not at all.
  useEffect(() => {
    const now = () => performance.now() / 1000;
    let all: Caption[] = [];
    let shown: Caption[] = [];
    const refresh = () => {
      const step = stepCaptions(all, now());
      all = step.live;
      const next = step.visible;
      if (next.length !== shown.length || next.some((caption, i) => caption !== shown[i])) { shown = next; setCaptions(next); }
    };
    // A line said a moment ahead (a piece's reaction starts as it lands) goes up as its voice starts and comes down as
    // its words end (or soon after a cut), on time rather than at the next poll.
    const exact = new Set<number>();
    const at = (seconds: number) => { const id = window.setTimeout(() => { exact.delete(id); refresh(); }, Math.max(0, seconds - now()) * 1000 + 1); exact.add(id); };
    const unsubscribe = audio.onVoiceLine((event) => {
      all = applyVoiceLine(all, event, now(), (side) => sideNames.current(side)); refresh();
      if (event.type !== "clear") for (const caption of all) if (caption.token === event.token) { if (caption.showAt > now()) at(caption.showAt); at(caption.hideAt); }
    });
    const timer = window.setInterval(refresh, 100);
    return () => { unsubscribe(); window.clearInterval(timer); for (const id of exact) window.clearTimeout(id); };
  }, []);

  useEffect(() => {
    let cancelled = false;
    // Leaving mid-load calls every download off (A-07): the figures' with the engine's disposal, the arena's here.
    const loads = new AbortController();
    // A lost graphics context ends the match where it stands (M-10): the error screen covers the board, so neither
    // clock may run and the computer may not move behind it. Retry builds the match again on a new context.
    let contextLost = false;
    let legacyRecorder: import("../../../web/src/legacy/musterBridge").MusterRecorder | null = null;
    let active: SceneEngine | null = null;
    let game: GameController | null = null;
    let world: THREE.Group | null = null;
    let look: Awaited<ReturnType<typeof createBattlefieldLook>> | null = null;
    // The giant behind the board follows the play: its head turns to the square the last move ended on. It is
    // also the one who takes the fallen: the engine asks it to raise its hands and hold the thread of each claim.
    let sorcerer: ArenaSorcerer | null = null;
    const lastSquare = new THREE.Vector3();
    // Each game played on this battlefield (the first, and every rematch played in place, A-01) has its number:
    // whatever is still pending from a game that has been replaced does nothing.
    let gameRound = 0;
    // The match is heard once, as its loading screen first goes; a rematch leaves the sound as the player has it.
    let heard = false;
    const hear = () => { if (heard) return; heard = true; audio.setMuted(false); audio.setScene("battle"); };
    const stale = (at: number) => cancelled || contextLost || at !== gameRound;
    let capturing = false;
    // The bar (A-07): the figures and the arena load side by side, each its share by bytes (the armies about a third,
    // the arena the rest); the last few percent are the first frames being drawn under it.
    const shares = { figures: 0, arena: 0 };
    const showProgress = () => {
      if (cancelled) return;
      const next = shares.figures * .3 + shares.arena * .65;
      setProgress((shown) => Math.max(shown ?? 0, next));
      setLoading(shares.figures >= 1 && shares.arena >= 1 ? "Preparing the battlefield"
        : shares.figures >= 1 ? "Loading the arena and its lighting" : shares.arena >= 1 ? "Preparing the pieces" : "Preparing the pieces and the arena");
    };
    /**
     * Begins a game on the battlefield that is up: the opening asked for (the whole one, a rematch's short one, or
     * none), then the first move. The first game is begun by the load below; a rematch begins another (A-01).
     */
    const begin = async (at: number, cut: MatchOpeningCut | "none") => {
      const scene = active!, match = game!;
      // The opening: the arena, each army taking the field, the two against each other, and the camera round to
      // where the match is played from. Skipped, it ends there at once.
      const plan = matchOpeningFor(config, cut, motion.current);
      if (plan) {
        // The game is begun now but held. The figures it puts on the board are the ones the opening shows (so
        // nothing is rebuilt when it ends), the bell that opens a game rings over the arena, and neither clock runs
        // nor the computer starts thinking until the opening is over. It used to think during the opening, but
        // the held opening below keeps the page busy for seconds, so its first search ran out of time and Classic
        // played as the second mover opened on "Computer unavailable".
        match.start(matchOptions(config), { held: true });
        // Its sound (web/src/audio/opening-cues.ts): the clips are fetched now, and the bell game.start has just
        // asked for waits for the first picture. The engine rings that bell from a microtask, so this comes before
        // the next await.
        audio.prepareOpening(plan.beats);
        const played = scene.playMatchOpening(plan.shots, plan.preset, (index) => {
          if (stale(at)) return;
          setOpening({ plan, beat: plan.beats[index]!.id });
          // Each beat is heard as it comes on screen (the first is reported now, under the loading screen, and is
          // heard once the opening is let go, below).
          if (index > 0) audio.openingCue(index);
        }, { held: true });
        // And so is the opening itself, held: its camera visits every shot with every figure and its crest standing
        // solid, so all of it is drawn unseen (see holdMatchOpening), and none of it is spent before it can be
        // watched. Then it starts from its first frame, with its first card already up.
        const warming = performance.now();
        do await steadyFrames(8000); while (!stale(at) && !scene.matchOpeningWarm && performance.now() - warming < 8000);
        if (stale(at)) return;
        setOpening({ plan, beat: plan.beats[0]!.id });
        // The match is heard from here, as the loading screen goes: not under its last seconds of warm-up.
        hear();
        setStaged(true);
        scene.holdMatchOpening(false);
        if (scene.matchOpeningActive) audio.openingCue(0);
        await played;
        // Replaced by a rematch meanwhile, the new game's opening has its own sounds: they are left alone.
        if (stale(at)) return;
        // Played out or skipped, its own sounds end with it; the bell, once rung, rings on into the match.
        audio.stopOpening(0.4);
        look?.opening("over");
        setOpening(null);
        scene.setInteractive(config.mode !== "ai-battle");
        match.setPaused(false);
      } else {
        look?.opening("none");
        scene.setCameraPreset(config.mode === "classic" && config.playerColor === "b" ? "black" : "white");
        scene.setInteractive(config.mode !== "ai-battle");
        // The match is heard from here, as the loading screen goes (and before the bell game.start rings).
        hear();
        // Download time never consumes either player's clock or starts an AI turn.
        match.start(matchOptions(config));
      }
      events.current.onSpectatorReady?.({ pause: () => game?.togglePaused(), speed: value => game?.setDemoSpeed(value), camera: value => active?.setCameraPreset(value) });
      setStaged(true); setReady(true);
      canvas.current?.focus();
    };
    void (async () => {
      try {
        const [{ SceneEngine: Engine }, { GameController: Controller }, { squareToWorld }] = await Promise.all([
          import("../../../web/src/scene/sceneEngine"), import("../../../web/src/core/gameController"), import("../../../web/src/scene/board"),
        ]);
        if (cancelled || !canvas.current) return;
        game = new Controller(); controller.current = game;
        // The opening's sounds are fetched while the battlefield loads, so they are in hand when it starts.
        if (matchOpeningFor(config, openingWanted.current, motion.current)) audio.preloadOpening();
        if (config.legacy && config.mode === "classic") {
          const { beginOriginalLegacyMatch } = await import("./legacy-match");
          if (cancelled) return;
          legacyRecorder = beginOriginalLegacyMatch(game, config.legacy, message => { if (!cancelled) setLegacyNotice(message); });
        }
        game.on("state", snapshot => {
          setSnapshot(snapshot); events.current.onSnapshot?.(snapshot);
          const square = snapshot.lastMove ? lastSquare.copy(squareToWorld(snapshot.lastMove.to)) : null;
          sorcerer?.watch(square);
        });
        game.on("gameover", () => {
          if (completed.current || capturing) return;
          capturing = true;
          const at = gameRound;
          // The replay replays the whole game twice (tens of milliseconds by move 100): it is built once the end
          // scene's first frames are out, not inside the frame that starts it (M-19).
          const capture = () => {
            if (at !== gameRound) return;
            capturing = false;
            if (cancelled || completed.current || !game) return;
            try {
              completed.current = captureCompletedMatch(game.getSnapshot(), config, matchId.current, new Date().toISOString());
              setReplay(completed.current);
              events.current.onReplayReady?.(completed.current);
            } catch (cause) { setReplayNotice(cause instanceof Error ? cause.message : "The replay could not be prepared."); }
          };
          const idle = (window as Window & { requestIdleCallback?: (run: () => void, options?: { timeout: number }) => number }).requestIdleCallback;
          if (idle) idle(capture, { timeout: 1000 }); else window.setTimeout(capture, 0);
        });
        active = new Engine(canvas.current, game, {
          onLoadProgress: (n) => { shares.figures = n; showProgress(); },
          onReady: () => {}, onPromotionOpen: setPromotion, onPromotionFocus: (kind) => setPromotionFocus(kind as PromotionChoice), onQualityAdjusted: () => {}, onFps: () => {},
          onContextLost: () => {
            contextLost = true;
            game?.stop();
            if (!cancelled) setError("The graphics context was lost, so the match was stopped. Retry the match to reload the battlefield.");
          },
          onConclusionState: active => { if (!cancelled) setConclusion(active); },
          onChronicle: written => { if (!cancelled) setChronicle(written); },
          onCombatActive: active => { if (!cancelled) setFighting(active); },
          onMoveQueued: (move, ended) => {
            if (cancelled) return;
            setQueued(move);
            // A queued move that is played or refused as the board comes free is said, as a press's result is.
            const said = queuedAnnouncement(ended);
            if (said) setAnnouncement(said);
          },
        }, graphics.current.quality);
        engine.current = active;
        // Development only: lets a capture script hold the camera on a pose (see playMatchOpening).
        if (import.meta.env.DEV) (window as unknown as { __crownfallMatchEngine?: SceneEngine }).__crownfallMatchEngine = active;
        active.setRenderScale(resolution.current);
        active.setFrameLimit(frameCap.current);
        active.setInteractive(false); active.setReducedMotion(motion.current); active.setViolenceIntensity(violence.current);
        active.setArmySkins(matchArmies(config));
        world = new THREE.Group(); world.scale.setScalar(1 / 2.3);
        active.setBakedWorld(world, config.setting === "scene-02");
        const context = active.getBattlefieldContext();
        const shadows = { enabled: context.renderer.shadowMap.enabled, type: context.renderer.shadowMap.type };
        showProgress();
        // The figures and the arena's look load side by side (A-07): the look needs only the engine's renderer,
        // scene and camera. The figures failing ends the load; the look failing stages the baked arena instead.
        const [figures, built] = await Promise.allSettled([
          active.load({ warmClips: false }),
          createBattlefieldLook({ ...context, world, setting: config.setting,
            quality: graphics.current.automatic ? 'auto' : graphics.current.quality, renderScale: resolution.current, reducedMotion: () => motion.current,
            cancelled: () => cancelled, signal: loads.signal,
            onProgress: (ratio) => { shares.arena = ratio; showProgress(); },
            onStats: stats => { if (!cancelled) setGraphicsStats({ ...stats }); } }),
        ]);
        if (built.status === "fulfilled") look = built.value;
        const dropLook = () => { if (look) { look.dispose(); if (look.board) disposeBakedGroup(look.board); look = null; } };
        if (cancelled) { dropLook(); if (world) disposeBakedGroup(world); world = null; return; }
        if (figures.status === "rejected") { dropLook(); throw figures.reason; }
        shares.figures = 1;
        if (!look) {
          // The pinned look package (main game/public/gameport-look, see docs/PLAY_LOOK_PORT.md) is not part of the
          // repository. Without it the match is staged in the baked arena and its lightmaps, as before the look port.
          console.warn("[match] battlefield look unavailable; staging the baked arena instead", (built as PromiseRejectedResult).reason);
          disposeBakedGroup(world); world = null;
          context.renderer.shadowMap.enabled = shadows.enabled; context.renderer.shadowMap.type = shadows.type;
          active.setRenderScale(resolution.current);
          shares.arena = 0;
          setProgress(.3);
          const baked = await loadBakedEnvironment(config.setting, (ratio) => { shares.arena = ratio; showProgress(); }, loads.signal);
          if (cancelled) { disposeBakedGroup(baked); return; }
          world = baked;
          active.setBakedWorld(baked, config.setting === "scene-02");
        } else {
          sorcerer = look.sorcerer;
          if (sorcerer) active.setClaimant(claimantOf(sorcerer));
          active.setBattlefieldRenderer(look);
          if (look.board) active.setBakedBoard(look.board);
        }
        shares.arena = 1; showProgress();
        active.start();
        active.warmAnimations();
        // The first frames build every shader, which can take seconds. They are drawn under the loading screen, and
        // the game begins only once the page is drawing steadily. Begun before them, the computer's first search ran
        // out of its time while the page was busy (the search has three to eight seconds), and Classic played as the
        // second mover opened on "Computer unavailable". What the first fight shows (the blood, the dust) is built in the
        // background meanwhile (SceneEngine.warmEffects), and waited for too: built on the first kill, it froze it.
        await Promise.all([steadyFrames(20000), active.effectsReady(15000)]);
        if (cancelled || contextLost) return;
        if (!cancelled) setProgress(1);
        // Played once for this match: a rematch plays the short one (A-01).
        const cut = openingWanted.current;
        openingWanted.current = "none";
        // From here a rematch is played on this battlefield, as it stands (A-01).
        rematchInPlace.current = (rematchCut) => {
          if (cancelled || contextLost || !active || !game) return false;
          const at = ++gameRound;
          capturing = false;
          // An opening still on stage (a rematch asked for twice) ends now; the new game's own begins below.
          active.skipMatchOpening();
          audio.stopOpening(0);
          active.setInteractive(false);
          if (matchOpeningFor(config, rematchCut, motion.current)) audio.preloadOpening();
          void begin(at, rematchCut).catch((cause) => { if (!stale(at)) { console.error("[match] rematch failed", cause); setError(cause instanceof Error ? cause.message : String(cause)); } });
          return true;
        };
        await begin(gameRound, cut);
      } catch (cause) {
        if (!cancelled && !(loads.signal.aborted && (cause as { name?: string } | null)?.name === "AbortError")) {
          console.error("[match] load failed", cause); setError(cause instanceof Error ? cause.message : String(cause));
        }
      }
    })();
    return () => {
      cancelled = true; sorcerer = null; legacyRecorder?.dispose(); game?.dispose();
      rematchInPlace.current = null;
      loads.abort();
      // The arena first, while the renderer still knows its textures and buffers: disposed after the engine (which
      // disposes the renderer), their GPU memory was never released (A-05).
      if (world) disposeBakedGroup(world);
      world = null;
      active?.dispose();
      controller.current = null; engine.current = null; audio.setMuted(true);
    };
  }, [config]);

  /**
   * Another game on the battlefield that is up (A-01): the engine, the arena's look and its world stay, the game is
   * begun again (with the short opening where the match had one), and everything that belonged to the last game is
   * cleared: its replay, its notices, its ending, its chronicle and its id. It used to mount a new match, which loaded
   * the whole battlefield again (some 80 files and a new graphics context). Retry after a failure still loads afresh,
   * and so does a match with legacy stakes, whose stakes are reviewed again.
   */
  const rematch = () => {
    if (error || (config.mode === "classic" && config.legacy)) { onRetry(); return; }
    // Still loading: the game about to begin is a fresh one already.
    const again = rematchInPlace.current;
    if (!again) return;
    if (pauseOpen) closePause();
    pauseHeld.current = false;
    setConfirm(null); setReady(false); setOpening(null);
    setConclusion(false); setChronicle(null); setFighting(false); setQueued(null); setPromotion(false);
    completed.current = null; setReplay(null); setReplayNotice(""); setSavingReplay(false); setLegacyNotice("");
    matchId.current = localId("match");
    setAnnouncement("Arrow keys explore squares. Enter selects a piece or a destination.");
    setGameNumber((n) => n + 1);
    again(openingCut === "none" ? "none" : "short");
  };
  // The parent's own "New exhibition" (the Showcase): the same rematch, asked for from outside.
  const askedRound = useRef(rematchRound);
  useEffect(() => {
    if (askedRound.current === rematchRound) return;
    askedRound.current = rematchRound;
    rematch();
    // Only a change of round asks; rematch itself reads the render it is called from.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rematchRound]);
  const keyDown = (event: KeyboardEvent<HTMLCanvasElement>) => {
    const view = engine.current, game = controller.current;
    if (!ready || !view || !game || confirm || pauseOpen) return;
    if (promotion) {
      // Q, R, B and N choose at once; the arrows move the focus round the four, Enter or Space chooses it
      // (promotion/promotionChoice.ts). Escape backs out of it: nothing is played, and the Pawn is in hand again.
      const action = promotionKeyAction(event.key);
      if (!action) return;
      event.preventDefault();
      if (action.type === "choose") view.chooseKeyboardPromotion(action.kind);
      else if (action.type === "move") view.movePromotionFocus(action.step);
      else if (action.type === "confirm") { if (!event.repeat) view.confirmPromotion(); }
      else { view.cancelPromotion(); setAnnouncement("Promotion cancelled. The Pawn is selected again."); }
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      if (conclusion) view.skipEndCinematic();
      else if (fighting) view.skipCombat();
      // A piece in hand (or one held for when the board is free, with the move queued for it) is let go first; with
      // nothing to let go, Escape pauses.
      else if (view.pieceInHand) { view.cancelKeyboardSelection(); setAnnouncement(queued?.to ? "Queued move cancelled." : "Selection cleared."); }
      else openPause();
      return;
    }
    const pieceAt = (square: string) => { const piece = game.pieceAt(square); return piece ? `${nameOf(piece.color)} ${PIECE_LABEL[piece.kind]}` : null; };
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      // The board says what the press did (a piece picked up, a move, a refusal, a piece held until the move on
      // stage is over), and that is what is read out.
      const action = view.activateKeyboardSquare();
      setAnnouncement(tapAnnouncement(action, view.keyboardCursor, pieceAt, action.type === "select" ? game.legalTargets(action.square).length : 0, game.getSnapshot().inCheck));
      return;
    }
    // The view from the keys: + and - pull it in and out, Shift with an arrow turns and tilts it (R, read by the
    // HUD, puts it back). Each press is a small step; a held key repeats it.
    if (event.key === "+" || event.key === "=" || event.key === "-" || event.key === "_") {
      event.preventDefault(); view.nudgeCamera(0, 0, event.key === "-" || event.key === "_" ? -VIEW_KEY_PULL : VIEW_KEY_PULL); setViewFound(true); return;
    }
    const direction = ({ ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down" } as const)[event.key];
    if (!direction) return;
    event.preventDefault();
    if (event.shiftKey) {
      view.nudgeCamera(direction === "right" ? VIEW_KEY_TURN : direction === "left" ? -VIEW_KEY_TURN : 0, direction === "up" ? VIEW_KEY_TILT : direction === "down" ? -VIEW_KEY_TILT : 0, 0);
      setViewFound(true);
      return;
    }
    // The cursor is the board's: it steps as the player sees the board (Up is away from them, from either side),
    // and goes on from the square the pointer was last over.
    const square = view.moveKeyboardCursor(direction);
    setAnnouncement(`${square.toUpperCase()}, ${pieceAt(square) ?? "empty"}.`);
  };
  // Spoken lines are written out during the opening too (the board's whisper after its bell).
  const subtitleLog = subtitles.on && <div className="match-subtitles" data-size={subtitles.size} role="log" aria-live="polite" aria-label="Subtitles">{captions.map((caption) => <p key={caption.token} data-side={caption.side ?? "fallen"}>{caption.speaker && <b>{caption.speaker}</b>}<span>{caption.text}</span></p>)}</div>;
  // What the HUD's controls do. MatchHud.tsx draws them and reads the keys and the controller for them.
  const hudActions: MatchHudActions = {
    undo: () => { controller.current?.undo(); },
    flip: () => engine.current?.flipCamera(),
    look: (yaw, pitch, zoom) => { engine.current?.nudgeCamera(yaw, pitch, zoom); setViewFound(true); },
    resetView: () => { engine.current?.resetView(); setViewFound(true); },
    toggleSound: () => { audio.setMuted(!muted); setMuted(!muted); },
    setBrightness: (value) => { setBrightness(value); engine.current?.setBrightness(value); },
    ask: setConfirm,
    retryComputer: () => controller.current?.setPaused(false),
    togglePause: () => controller.current?.togglePaused(),
    skipEnding: () => engine.current?.skipEndCinematic(),
    skipFight: () => engine.current?.skipCombat(),
    cancelQueued: () => { engine.current?.cancelKeyboardSelection(); setAnnouncement("Queued move cancelled."); },
    promote: (kind) => engine.current?.chooseKeyboardPromotion(kind),
    focusPromotion: (kind) => engine.current?.focusPromotion(kind),
    movePromotionFocus: (step) => engine.current?.movePromotionFocus(step),
    confirmPromotion: () => engine.current?.confirmPromotion(),
    cancelPromotion: () => { engine.current?.cancelPromotion(); setAnnouncement("Promotion cancelled. The Pawn is selected again."); },
    watchReplay: onWatchReplay && replay ? () => onWatchReplay(replay) : undefined,
    saveReplay: async () => {
      if (!replay) return;
      setSavingReplay(true);
      // A rematch begun meanwhile has its own replay: the notice of the one saved is not put over it.
      const entry = replay, current = () => completed.current === entry;
      try { const saved = await saveMatchReplay(entry); if (current()) setReplayNotice(saved.message); } catch { if (current()) setReplayNotice("Replay could not be saved. Try again."); } finally { if (current()) setSavingReplay(false); }
    },
    playAgain: () => rematch(),
    changeBattlefield: onSetup,
    focusBoard: () => canvas.current?.focus({ preventScroll: true }),
    pause: openPause,
    resume: closePause,
    testSound: () => audio.blip("press"),
  };
  return <section className="match-experience" aria-label={`${config.mode === "ai-battle" ? "AI Battle" : config.mode === "classic" ? "Classic" : "Local Duel"} match`} data-match-mode={snapshot?.mode} data-match-setting={config.setting} data-match-ready={ready} data-match-opening={opening?.beat ?? "none"} data-match-plies={snapshot?.sanList.length ?? 0} data-match-busy={snapshot?.busy ?? false} data-match-conclusion={conclusion} data-match-paused={pauseOpen} onPointerDown={() => void audio.unlock()}>
    <canvas ref={canvas} tabIndex={ready ? 0 : -1} onKeyDown={keyDown} role="application" aria-label="Crownfall chessboard" aria-describedby="match-keys" />
    <p id="match-keys" className="match-sr">{t('Use arrow keys to explore squares. Enter or Space selects a piece and a destination. Escape clears selection. For promotion press Q, R, B or N, or Escape to take the Pawn back in hand.')} {t('While a move is being played or the computer is thinking, Enter on one of your pieces and then on a square queues that move for when the board is free, and Enter anywhere else hurries a piece that is walking.')} {t('U takes a move back, F flips the board, M turns the sound on or off.')} {t('Shift with the arrow keys turns and tilts the view, plus and minus bring it closer and farther, and R puts it back.')} {t('With nothing selected, Escape opens the pause menu.')}</p>
    <div aria-live="polite" className="match-sr">{announcement}</div>
    {!staged || error ? <LoadingScreen progress={error ? null : progress} status={error ?? loading} ready={false} leaving={false} reducedMotion={reducedMotion} degraded={!!error} onRetry={error ? onRetry : undefined} onBack={embedded ? undefined : onSetup} progressLabel="Preparing battlefield" /> : opening ? <><MatchOpening plan={opening.plan} beat={opening.beat} onSkip={() => engine.current?.skipMatchOpening()} />{subtitleLog}</> : !ready ? null : !embedded ? <>
      <MatchHud key={gameNumber} config={config} armies={armies} snapshot={snapshot} clocks={snapshot?.clock.enabled ? { w: time(snapshot.clock.whiteMs), b: time(snapshot.clock.blackMs) } : null}
        reducedMotion={reducedMotion} conclusion={conclusion} fighting={fighting} promotion={promotion} promotionFocus={promotionFocus} muted={muted} brightness={brightness}
        replayReady={!!replay} savingReplay={savingReplay} replayNotice={replayNotice} legacyNotice={legacyNotice} chronicle={chronicle} actions={hudActions} pauseOpen={pauseOpen} queued={queued} viewFound={viewFound}
        confirm={confirm} onConfirmCancel={() => setConfirm(null)} onConfirmAccept={() => { const action = confirm; setConfirm(null); if (action === "leave") onBack(); else if (action === "restart") rematch(); else controller.current?.resign(); }}>
        <small hidden aria-hidden="true" data-battlefield-stats data-board-model={graphicsStats.board === true ? "baked" : "procedural"} data-gpu={String(graphicsStats.gpu ?? "")} data-quality={automaticGraphics ? 'auto' : quality} data-fps={String(graphicsStats.fps ?? '')} data-render-scale={String(graphicsStats.renderScale ?? '')}>{String(graphicsStats.features ?? '')} {String(graphicsStats.pixels ?? '')}</small>
      </MatchHud>
      {subtitleLog}
    </> : null}
  </section>;
}
