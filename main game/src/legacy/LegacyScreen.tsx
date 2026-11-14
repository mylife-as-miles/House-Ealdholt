import { InputPrompt } from "../InputPrompt";
import { forwardRef, useCallback, useEffect, useEffectEvent, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from "react";
import { LEGACY_COPY, LEGACY_TEXT } from "../../../shared/legacy/content/copy";
import { NATIONS } from "../../../shared/legacy/content/nations";
import { readEnvironmentLayout, saveEnvironmentLayout } from "../../../shared/legacy/content/environments";
import type { LegacyEnvironmentLayout } from "../../../shared/legacy/content/environments";
import { LEGACY_EXPLORATION_COPY as EXPLORATION } from "../../../shared/legacy/exploration/copy";
import type { LegacyExplorationSnapshot } from "../../../shared/legacy/exploration/contract";
import type { SettlementSnapshot } from "../../../shared/legacy/settlement/contract";
import { LEGACY_LANDMARKS } from "../../../shared/legacy/environment-contract";
import { prominentAftermath } from "../../../shared/legacy/domain/aftermath";
import { presentBannerhold, presentFoundingDraft, representativeCondition } from "../../../shared/legacy/domain/presentation";
import { validateBannerName, validateMotto } from "../../../shared/legacy/domain/founding";
import type { HeraldNotice, Heraldry, LandmarkId, LegacyEvent } from "../../../shared/legacy/types";
import type { Direction } from "../settings-types";
import { ADAPTIVE_QUALITY, adaptivePresetFor, capQuality } from "./adaptive-quality";
import type { QualityPreset } from "./adaptive-quality";
import { AftermathCard } from "./AftermathCard";
import { CYCLE_EVENT } from "./Cycler";
import { DESKTOP_LEGACY_COPY as UI } from "./desktop-copy";
import type { DesktopEnvironmentQuality, DesktopLegacyEnvironment, ScreenAnchor } from "./environment-contract";
import { LegacyEnvironmentAborted, loadLegacyEnvironment } from "./environment-provider";
import type { LegacyEnvironmentSource } from "./environment-provider";
import { createFoundingDraft } from "./founding-draft";
import type { FoundingDraft } from "./founding-draft";
import { FoundingCeremony } from "./FoundingCeremony";
import { HeraldryEmblem } from "./HeraldryEmblem";
import { LandmarkLabels } from "./LandmarkLabels";
import type { LandmarkLabelsHandle, LandmarkSummary } from "./LandmarkLabels";
import { LegacyDialog } from "./LegacyDialog";
import { LegacyExploration } from "./LegacyExploration";
import type { LegacyExplorationHandle } from "./LegacyExploration";
import type { LegacyDialogContent, LegacyDialogHandle } from "./LegacyDialog";
import type { LegacyScreenHandle } from "./legacy-handle";
import { NextStepAction, wagerTermsFor } from "./LegacyTerms";
import { nextStepFor } from "./next-step";
import type { NextStep } from "./next-step";
import { BannerHallPanel } from "./panels/BannerHallPanel";
import { HeraldsStationPanel } from "./panels/HeraldsStationPanel";
import { InspectionPanel } from "./panels/InspectionPanel";
import { MusterGroundsPanel } from "./panels/MusterGroundsPanel";
import { WarRecordPanel } from "./panels/WarRecordPanel";
import { PreviewMissingPanel, RecoveryPanel } from "./RecoveryPanel";
import { currentNavigable, focusDefault, focusEdge, moveFocus } from "./spatial-nav";
import { legacyTimestamp } from "./storage";
import { loadInitialLegacySession, useLegacySession } from "./useLegacySession";
import type { InitialLegacySession } from "./useLegacySession";
import "./LegacyScreen.css";

export interface LegacyScreenProps {
  environmentAudioOutput?():import('../../../shared/menu/audio').MenuEffectsOutput|null;
  active: boolean;
  reducedMotion: boolean;
  quality: DesktopEnvironmentQuality;
  /** App's unwinding Back (Escape, B, the footer control): it asks this screen first, then returns Home. */
  onBack(): void;
  /** Leaves My Legacy for the menu's Play tab, from any Legacy screen. */
  onPlay(): void;
}

type Mode = "recovery" | "preview-missing" | "founding" | "bannerhold";
type FocusRequest = { kind: "default" } | { kind: "landmark"; id: LandmarkId } | { kind: "selector"; selector: string };
interface DialogState { content: LegacyDialogContent; confirm(): void }
interface Beat { name: string; heraldry: Heraldry }

const BEAT_MS = 2600;
const BEAT_STILL_MS = 1600;
const FEEDBACK_MS = 5000;

function cycleLandmark(id: LandmarkId, delta: 1 | -1): LandmarkId {
  const index = LEGACY_LANDMARKS.indexOf(id);
  return LEGACY_LANDMARKS[(index + delta + LEGACY_LANDMARKS.length) % LEGACY_LANDMARKS.length];
}

interface ResolvedLegacyScreenProps extends LegacyScreenProps {
  initialSession: InitialLegacySession;
}

export const LegacyScreen = forwardRef<LegacyScreenHandle, ResolvedLegacyScreenProps>(function LegacyScreen({ active, reducedMotion, quality, onBack, onPlay, initialSession }, ref) {
  const session = useLegacySession(initialSession);
  const { state, dispatch } = session;
  const [draft, setDraft] = useState<FoundingDraft>(() => createFoundingDraft());
  const [inspected, setInspected] = useState<LandmarkId | null>(null);
  const [selected, setSelected] = useState<LandmarkId>("banner-hall");
  const [hovered, setHovered] = useState<LandmarkId | null>(null);
  const [closeUp, setCloseUp] = useState(false);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [beat, setBeat] = useState<Beat | null>(null);
  /** Back sets the aftermath aside for this visit; only Acknowledge clears it from the save. */
  const [aftermathDeferred, setAftermathDeferred] = useState(false);
  const [feedback, setFeedback] = useState({ text: "", revision: 0 });
  const [inputMode, setInputMode] = useState<"keys" | "pointer">("keys");
  const [environment, setEnvironment] = useState<DesktopLegacyEnvironment | null>(null);
  const [firstFrame, setFirstFrame] = useState(false);
  const [environmentInfo, setEnvironmentInfo] = useState<{ source: LegacyEnvironmentSource; fallbackReason: string | null } | null>(null);
  const [environmentError, setEnvironmentError] = useState<string | null>(null);
  /** A failure after the environment was created (rebuild, lost graphics context); rendering it shows the Retry panel. */
  const [environmentFailure, setEnvironmentFailure] = useState<Error | null>(null);
  const [environmentLayout, setEnvironmentLayout] = useState<LegacyEnvironmentLayout>(readEnvironmentLayout);
  const [changingEnvironment, setChangingEnvironment] = useState(false);
  const [layoutError, setLayoutError] = useState<string | null>(null);
  const [exploration, setExploration] = useState<LegacyExplorationSnapshot | null>(null);
  const [explorationRequested, setExplorationRequested] = useState(false);
  const [settlement, setSettlement] = useState<SettlementSnapshot | null>(null);
  const [settlementOverlayOpen, setSettlementOverlayOpen] = useState(false);
  // Ready means a frame has rendered and the created environment is in hand, whichever arrives last.
  const environmentReady = firstFrame && environment !== null;
  /** Set once by the automatic step down; the player's own preset is never rewritten. */
  const [qualityCap, setQualityCap] = useState<QualityPreset | null>(null);
  const effectiveQuality = useMemo(() => capQuality(quality, qualityCap), [quality, qualityCap]);
  const rootRef = useRef<HTMLElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const overviewRef = useRef<HTMLDivElement>(null);
  const foundingRef = useRef<HTMLElement>(null);
  const recoveryRef = useRef<HTMLElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const aftermathRef = useRef<HTMLElement>(null);
  const labelsRef = useRef<LandmarkLabelsHandle>(null);
  const dialogRef = useRef<LegacyDialogHandle>(null);
  const explorationRef = useRef<LegacyExplorationHandle>(null);
  const focusRequest = useRef<FocusRequest | null>(null);
  const focusFrame = useRef(0);
  const beatTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const mode: Mode = session.kind === "recovery" ? "recovery" : session.kind === "preview-missing" ? "preview-missing" : state.banner ? "bannerhold" : "founding";
  const scene = useMemo(() => mode === "founding"
    ? { ...presentFoundingDraft({ nationId: draft.nationId, name: draft.name, heraldry: draft.heraldry, seed: draft.seed, mode: state.mode, previewId: state.previewId }), estatePersistent: false }
    : { ...presentBannerhold(state), estatePersistent: session.persistent }, [mode, draft.nationId, draft.name, draft.heraldry, draft.seed, state, session.persistent]);
  const aftermath = useMemo(() => prominentAftermath(state), [state]);
  const nextStep = useMemo(() => nextStepFor(state), [state]);
  const cameraKey: LandmarkId | "overview" | "representative" = beat ? "banner-hall"
    : mode === "founding" ? "banner-hall"
      : mode === "bannerhold" ? (closeUp ? "representative" : inspected ?? "overview") : "overview";
  const showAftermath = mode === "bannerhold" && !inspected && !beat && aftermath.length > 0 && !aftermathDeferred;
  const overview = mode === "bannerhold" && !inspected && !beat && !showAftermath;
  const exploring = overview && exploration?.enabled === true;
  const emphasis = overview ? hovered ?? selected : null;

  const feedbackTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const announce = useCallback((text: string) => {
    if (feedbackTimer.current !== undefined) clearTimeout(feedbackTimer.current);
    setFeedback((previous) => ({ text, revision: previous.revision + 1 }));
    feedbackTimer.current = setTimeout(() => setFeedback((previous) => ({ text: "", revision: previous.revision })), FEEDBACK_MS);
  }, []);
  const requestFocus = useCallback((request: FocusRequest) => { focusRequest.current = request; }, []);

  const setExplorationEnabled = useCallback((enabled: boolean) => {
    if (enabled && (!environmentReady || !exploration?.available || changingEnvironment)) return;
    setExplorationRequested(enabled);
    requestFocus(enabled ? { kind: "selector", selector: "[data-party-member][aria-pressed='true']" } : { kind: "landmark", id: selected });
  }, [environmentReady, exploration?.available, changingEnvironment, selected, requestFocus]);

  const selectExplorationMember = useCallback((id: string) => {
    if (!environment?.setExplorationMember?.(id)) return;
    const member = exploration?.members.find((entry) => entry.id === id);
    if (member) announce(EXPLORATION.selectedAnnouncement(member.name));
  }, [environment, exploration?.members, announce]);

  const travelToLandmark = useCallback((id: LandmarkId) => {
    if (!exploration?.enabled) return;
    const destination = exploration.destinations.find((entry) => entry.id === id);
    if (!destination?.available) return;
    explorationRef.current?.showLandmark(id);
    const travelled = destination.travelMode === "fast-travel"
      ? environment?.fastTravelToLandmark?.(id) : environment?.travelToLandmark?.(id);
    if (!travelled) return;
    setSelected(id);
    const member = exploration.members.find((entry) => entry.id === exploration.selectedMemberId);
    if (member) announce(EXPLORATION.movingAnnouncement(member.name, LEGACY_COPY.landmarks[id].title));
  }, [environment, exploration, announce]);

  const changeEnvironment = useCallback(async (layout: LegacyEnvironmentLayout) => {
    if (changingEnvironment || layout === environmentLayout) return;
    if (!environment?.setLayout) { setLayoutError(EXPLORATION.unavailableRenderer); return; }
    setChangingEnvironment(true);
    setLayoutError(null);
    try {
      await environment.setLayout(layout);
      setEnvironmentLayout(layout);
      saveEnvironmentLayout(layout);
    } catch {
      setLayoutError(EXPLORATION.environmentFailed);
    } finally {
      setChangingEnvironment(false);
    }
  }, [environment, environmentLayout, changingEnvironment]);

  const beginSettlementEditing = useCallback(() => {
    environment?.cancelTravel?.();
    setExplorationRequested(false);
    setCloseUp(false);
    setInspected(null);
    setHovered(null);
  }, [environment]);

  // ------------------------------------------------------------- actions

  const openLandmark = useCallback((id: LandmarkId) => {
    if (mode !== "bannerhold" || dialog || beat) return;
    // World, dock, counter and journal entry paths share the same unwind. A
    // hidden estate chooser must never consume Back behind a house inspector.
    explorationRef.current?.dismiss();
    // Labels stay mounted while their overview layer hides. Release overview
    // focus before that mutation: React must not restore a now-hidden label
    // and all of its ancestor scroll positions while the inspector lays out.
    // The existing focus request still lands on the inspector's primary action.
    const focused = document.activeElement;
    if (focused instanceof HTMLElement && overviewRef.current?.contains(focused)) focused.blur();
    setSelected(id);
    setHovered(null);
    setCloseUp(false);
    setInspected(id);
    requestFocus({ kind: "default" });
  }, [mode, dialog, beat, requestFocus]);

  const closeInspection = useCallback(() => {
    if (!inspected) return;
    setSelected(inspected);
    setCloseUp(false);
    setInspected(null);
    requestFocus({ kind: "landmark", id: inspected });
  }, [inspected, requestFocus]);

  const cycleInspection = useCallback((delta: 1 | -1) => {
    if (!inspected) return;
    const next = cycleLandmark(inspected, delta);
    setSelected(next);
    setCloseUp(false);
    setInspected(next);
    requestFocus({ kind: "default" });
  }, [inspected, requestFocus]);

  const run = useCallback((event: LegacyEvent): string | null => {
    const error = dispatch(event);
    if (error) announce(error);
    return error;
  }, [dispatch, announce]);

  const finishBeat = useCallback(() => {
    if (beatTimer.current !== undefined) clearTimeout(beatTimer.current);
    beatTimer.current = undefined;
    setBeat(null);
    setSelected("banner-hall");
    requestFocus({ kind: "landmark", id: "banner-hall" });
  }, [requestFocus]);

  const raiseBanner = useCallback(() => {
    const name = validateBannerName(draft.name);
    const motto = validateMotto(draft.motto);
    if (name.ok === false) { announce(name.error); return; }
    if (motto.ok === false) { announce(motto.error); return; }
    const error = run({ type: "found-banner", name: name.name, nationId: draft.nationId, heraldry: draft.heraldry, motto: motto.motto, at: legacyTimestamp(), seed: draft.seed });
    setDialog(null);
    if (error) return;
    // The beat itself is a status region, so the founding is shown and announced once, by the beat.
    setInspected(null);
    setCloseUp(false);
    setBeat({ name: name.name, heraldry: draft.heraldry });
    setDraft(createFoundingDraft(draft.nationId));
    beatTimer.current = setTimeout(finishBeat, reducedMotion ? BEAT_STILL_MS : BEAT_MS);
  }, [draft, run, announce, finishBeat, reducedMotion]);

  const confirmDissolve = useCallback(() => {
    const copy = LEGACY_COPY.reset;
    setDialog({
      content: { title: copy.title, body: copy.body, confirmLabel: copy.confirm, cancelLabel: copy.cancel, destructive: true },
      confirm: () => {
        setDialog(null);
        const nationId = state.banner?.nationId;
        const error = session.dissolve();
        if (error) { announce(error); return; }
        setInspected(null);
        setCloseUp(false);
        setDraft(createFoundingDraft(nationId));
        requestFocus({ kind: "default" });
      },
    });
  }, [session, state.banner, announce, requestFocus]);

  const goToStep = useCallback((step: NextStep) => {
    if (mode !== "bannerhold" || beat) return;
    setDialog(null);
    setSelected(step.landmark);
    setHovered(null);
    setCloseUp(false);
    setInspected(step.landmark);
    // Land on the control that takes the step: the challenge's Accept, or the panel's default (Nominate).
    requestFocus(step.kind === "answer" && step.noticeId ? { kind: "selector", selector: `[data-accept="${step.noticeId}"]` } : { kind: "default" });
  }, [mode, beat, requestFocus]);

  const confirmAccept = useCallback((notice: HeraldNotice) => {
    const copy = LEGACY_COPY.notices;
    // Accepting is allowed before a Pawn is named, but the wager speaks of "your representative", so say so and offer the way there.
    const step = nextStepFor(state);
    const unnamed = step !== null && step.kind === "nominate" ? step : null;
    const terms = wagerTermsFor(state, notice);
    setDialog({
      content: {
        title: copy.acceptTitle,
        body: copy.acceptBody,
        warning: unnamed?.detail,
        terms: terms ? { heading: copy.wagerHeading, terms } : undefined,
        confirmLabel: copy.accept,
        cancelLabel: LEGACY_COPY.founding.back,
        alternate: unnamed ? { label: unnamed.title, onSelect: () => goToStep(unnamed) } : undefined,
      },
      confirm: () => {
        setDialog(null);
        if (!run({ type: "accept-challenge", noticeId: notice.id, at: legacyTimestamp() })) announce(copy.accepted);
        requestFocus({ kind: "default" });
      },
    });
  }, [state, run, announce, requestFocus, goToStep]);

  const confirmReplacement = useCallback(() => {
    const future = session.session.kind === "recovery" && session.session.reason === "future-version";
    setDialog({
      content: {
        title: LEGACY_COPY.newBanner.title,
        body: future ? LEGACY_COPY.futureSave.replaceNote : LEGACY_COPY.invalidSave.startNewNote,
        confirmLabel: LEGACY_COPY.invalidSave.startNew,
        cancelLabel: LEGACY_COPY.founding.back,
        destructive: true,
      },
      confirm: () => {
        setDialog(null);
        session.beginReplacement();
        requestFocus({ kind: "default" });
      },
    });
  }, [session, requestFocus]);

  const continueAsGuest = useCallback(() => {
    session.continueAsGuest();
    requestFocus({ kind: "default" });
  }, [session, requestFocus]);

  const toggleCloseUp = useCallback(() => setCloseUp((value) => !value), []);

  // ------------------------------------------------------------- environment

  const onEnvironmentHover = useEffectEvent((id: LandmarkId | null) => {
    if (overview) setHovered(id);
  });
  const onEnvironmentSelect = useEffectEvent((id: LandmarkId) => {
    setInputMode("pointer");
    if (exploring) travelToLandmark(id);
    else if (overview) openLandmark(id);
  });
  const initialEnvironment = useRef({ scene, quality, reducedMotion, layout: environmentLayout });

  useEffect(() => {
    const container = stageRef.current;
    if (!container) return;
    let cancelled = false;
    let created: DesktopLegacyEnvironment | null = null;
    const abort = new AbortController();
    const initial = initialEnvironment.current;
    loadLegacyEnvironment({
      container,
      state: initial.scene,
      quality: initial.quality,
      reducedMotion: initial.reducedMotion,
      layout: initial.layout,
      onLandmarkHover: (id) => onEnvironmentHover(id),
      onLandmarkSelect: (id) => onEnvironmentSelect(id),
      onReady: () => { if (!cancelled) setFirstFrame(true); },
      onError: (error) => { if (!cancelled) setEnvironmentFailure(error); },
    }, abort.signal).then((loaded) => {
      if (cancelled) {
        loaded.environment.dispose();
        return;
      }
      created = loaded.environment;
      setEnvironment(loaded.environment);
      setEnvironmentInfo({ source: loaded.source, fallbackReason: loaded.fallbackReason });
      // onReady is optional in the contract; a created environment is usable after its first frame either way.
      requestAnimationFrame(() => { if (!cancelled) setFirstFrame(true); });
    }).catch((error: unknown) => {
      if (cancelled || error instanceof LegacyEnvironmentAborted) return;
      setEnvironmentError(error instanceof Error ? error.message : String(error));
    });
    return () => {
      cancelled = true;
      abort.abort();
      created?.dispose();
      container.replaceChildren();
    };
  }, []);

  // ?legacyStats exposes the environment's contract statistics for performance measurement (opt-in, any build).
  useEffect(() => {
    if (!environment || !new URLSearchParams(window.location.search).has("legacyStats")) return;
    const target = window as unknown as {
      __legacyStats?: () => { source: LegacyEnvironmentSource | null } & ReturnType<DesktopLegacyEnvironment["getStats"]>;
      __legacyExploration?: () => LegacyExplorationSnapshot | null;
      __legacySettlement?: () => SettlementSnapshot | null;
      __legacySettlementDebug?: () => {
        snapshot: SettlementSnapshot | null;
        sourceKit: ReturnType<NonNullable<DesktopLegacyEnvironment["getSettlementSourceInfo"]>> | null;
        renderInfo: ReturnType<NonNullable<DesktopLegacyEnvironment["getSettlementRenderInfo"]>> | null;
        landmarks: ReturnType<DesktopLegacyEnvironment["getLandmarks"]>;
      };
      __legacyProjectSettlement?: (x: number, z: number, worldY?: number) => ScreenAnchor | null;
    };
    const source = environmentInfo?.source ?? null;
    target.__legacyStats = () => ({ source, ...environment.getStats() });
    target.__legacyExploration = () => environment.getExplorationSnapshot?.() ?? null;
    target.__legacySettlement = () => environment.getSettlementSnapshot?.() ?? null;
    target.__legacySettlementDebug = () => ({ snapshot: environment.getSettlementSnapshot?.() ?? null, sourceKit: environment.getSettlementSourceInfo?.() ?? null, renderInfo: environment.getSettlementRenderInfo?.() ?? null, landmarks: environment.getLandmarks() });
    target.__legacyProjectSettlement = (x, z, worldY) => {
      if (!Number.isFinite(x) || !Number.isFinite(z) || (worldY !== undefined && !Number.isFinite(worldY))) return null;
      const anchor = environment.projectSettlementPoint?.(x, z, worldY);
      const bounds = stageRef.current?.getBoundingClientRect();
      return anchor && bounds ? { ...anchor, x: anchor.x + bounds.left, y: anchor.y + bounds.top } : null;
    };
    return () => { delete target.__legacyStats; delete target.__legacyExploration; delete target.__legacySettlement; delete target.__legacySettlementDebug; delete target.__legacyProjectSettlement; };
  }, [environment, environmentInfo]);

  useEffect(() => { environment?.setState(scene); }, [environment, scene]);
  useEffect(() => {
    if (!environment?.getExplorationSnapshot || !environment.subscribeExploration) { setExploration(null); return; }
    setExploration(environment.getExplorationSnapshot());
    return environment.subscribeExploration(setExploration);
  }, [environment]);
  useEffect(() => {
    if (!environment?.getSettlementSnapshot || !environment.subscribeSettlement) { setSettlement(null); return; }
    setSettlement(environment.getSettlementSnapshot());
    return environment.subscribeSettlement(setSettlement);
  }, [environment]);
  useEffect(() => {
    if (settlement?.tool || settlement?.selectedId) beginSettlementEditing();
  }, [settlement?.tool, settlement?.selectedId, beginSettlementEditing]);
  // Travel and party selection are ephemeral. An inspector, aftermath or hidden
  // screen suspends exploration without touching any house save or consequence.
  useEffect(() => {
    environment?.setExplorationEnabled?.(explorationRequested && overview && active && !changingEnvironment);
  }, [environment, explorationRequested, overview, active, changingEnvironment]);
  const lastArrival = useRef<string | null>(null);
  useEffect(() => {
    const arrived = exploration?.enabled && exploration.status === "arrived" && LEGACY_LANDMARKS.includes(exploration.destination as LandmarkId)
      ? exploration.destination : null;
    if (arrived && arrived !== lastArrival.current) announce(EXPLORATION.arrivalAnnouncement(LEGACY_COPY.landmarks[arrived as LandmarkId].title));
    lastArrival.current = arrived;
  }, [exploration?.enabled, exploration?.status, exploration?.destination, announce]);
  useEffect(() => { environment?.setPaused(!active); }, [environment, active]);
  useEffect(() => { environment?.setQuality(effectiveQuality); }, [environment, effectiveQuality]);
  // Adaptive quality: sampled every two seconds (never per frame) while the screen is shown; one step down per page, told once.
  useEffect(() => {
    if (!environment || !environmentReady || !active || qualityCap !== null || effectiveQuality.preset === "low") return;
    const since = performance.now();
    const timer = window.setInterval(() => {
      if (document.hidden || performance.now() - since < ADAPTIVE_QUALITY.graceMs) return;
      const next = adaptivePresetFor(effectiveQuality, environment.getStats().frameTimesMs);
      if (!next) return;
      setQualityCap(next);
      announce(UI.qualityStepped(UI.presetName[next]));
    }, ADAPTIVE_QUALITY.checkMs);
    return () => window.clearInterval(timer);
  }, [environment, environmentReady, active, qualityCap, effectiveQuality, announce]);
  useEffect(() => { environment?.setReducedMotion(reducedMotion); }, [environment, reducedMotion]);
  useEffect(() => { environment?.highlightLandmark(emphasis); }, [environment, emphasis]);
  // A layout effect, so the camera framing changes before the labels' first projection in the same commit.
  useLayoutEffect(() => {
    if (!environment) return;
    if (cameraKey === "representative") environment.inspectRepresentative();
    else environment.focusLandmark(cameraKey === "overview" ? null : cameraKey);
  }, [environment, cameraKey]);
  useEffect(() => {
    const stage = stageRef.current;
    if (!environment || !stage) return;
    const observer = new ResizeObserver(() => environment.resize());
    observer.observe(stage);
    return () => observer.disconnect();
  }, [environment]);

  // ------------------------------------------------------------- focus

  const activeScope = useCallback((): HTMLElement | null => {
    if (mode === "recovery" || mode === "preview-missing") return recoveryRef.current;
    if (mode === "founding") return foundingRef.current;
    if (inspected) return panelRef.current;
    if (showAftermath) return aftermathRef.current;
    return overviewRef.current;
  }, [mode, inspected, showAftermath]);

  const focusLandmarkLabel = useCallback((id: LandmarkId): boolean => {
    const label = overviewRef.current?.querySelector<HTMLButtonElement>(`[data-dock-landmark="${id}"]`)
      ?? overviewRef.current?.querySelector<HTMLButtonElement>(`.legacy-label[data-landmark="${id}"]`);
    if (!label || label.disabled) return false;
    label.focus({ preventScroll: true });
    return document.activeElement === label;
  }, []);

  useEffect(() => {
    if (active) requestFocus({ kind: "default" });
    else setHovered(null);
  }, [active, requestFocus]);

  useEffect(() => {
    if (mode === "founding") requestFocus({ kind: "default" });
  }, [mode, draft.step, requestFocus]);

  useEffect(() => () => {
    if (beatTimer.current !== undefined) clearTimeout(beatTimer.current);
    if (feedbackTimer.current !== undefined) clearTimeout(feedbackTimer.current);
    if (focusFrame.current !== 0) cancelAnimationFrame(focusFrame.current);
  }, []);

  const applyFocusRequest = useCallback(() => {
    const request = focusRequest.current;
    if (!request || !active || dialog || beat) return;
    let done = false;
    if (request.kind === "landmark" && overview) done = focusLandmarkLabel(request.id);
    else if (request.kind === "selector") {
      const scope = activeScope();
      const target = scope?.querySelector<HTMLElement>(request.selector) ?? null;
      if (target) {
        target.focus({ preventScroll: true });
        target.scrollIntoView({ block: "nearest", behavior: "instant" });
        done = document.activeElement === target;
      } else if (scope) done = focusDefault(scope);
    } else if (request.kind === "default") {
      if (overview) done = focusLandmarkLabel(selected) || (overviewRef.current ? focusDefault(overviewRef.current, inputMode === "keys") : false);
      else {
        const scope = activeScope();
        done = scope ? focusDefault(scope, inputMode === "keys") : false;
      }
    }
    if (done) focusRequest.current = null;
  }, [active, dialog, beat, overview, selected, inputMode, activeScope, focusLandmarkLabel]);

  // Discrete React effects can run before paint. Focusing/scrolling a newly
  // mounted inspector there forces its layout into the input task. Let its
  // first frame lay out, then restore the same requested target next frame.
  const scheduleFocusRequest = useCallback(() => {
    if (focusFrame.current !== 0) cancelAnimationFrame(focusFrame.current);
    focusFrame.current = requestAnimationFrame(() => {
      focusFrame.current = requestAnimationFrame(() => {
        focusFrame.current = 0;
        applyFocusRequest();
      });
    });
  }, [applyFocusRequest]);
  // Declared after effects that request focus; the latest committed view owns
  // the request, so another transition cancels any obsolete pending target.
  useEffect(() => { if (focusRequest.current) scheduleFocusRequest(); });

  // ------------------------------------------------------------- input

  useImperativeHandle(ref, () => {
    const cycler = (element: HTMLElement | null, delta: number): boolean => {
      if (!element?.hasAttribute("data-cycler")) return false;
      element.dispatchEvent(new CustomEvent(CYCLE_EVENT, { detail: delta }));
      return true;
    };
    return {
      move(direction: Direction) {
        setInputMode("keys");
        if (dialog) { dialogRef.current?.move(direction); return; }
        if (beat) return;
        const scope = activeScope();
        if (!scope) return;
        if ((direction === "left" || direction === "right") && cycler(currentNavigable(scope), direction === "left" ? -1 : 1)) return;
        // Landmark labels move with the camera; read their positions from this moment, not the last painted frame.
        if (overview) labelsRef.current?.sync();
        moveFocus(scope, direction);
      },
      edge(last: boolean) {
        setInputMode("keys");
        if (dialog) { dialogRef.current?.move(last ? "last" : "first"); return; }
        if (beat) return;
        if (overview) {
          const id = LEGACY_LANDMARKS[last ? LEGACY_LANDMARKS.length - 1 : 0];
          setSelected(id);
          focusLandmarkLabel(id);
          return;
        }
        const scope = activeScope();
        if (scope) focusEdge(scope, last);
      },
      activate() {
        setInputMode("keys");
        if (dialog) { dialogRef.current?.activate(); return; }
        if (beat) { finishBeat(); return; }
        const scope = activeScope();
        if (!scope) return;
        const current = currentNavigable(scope);
        if (!current) {
          if (exploring) travelToLandmark(selected);
          else if (overview) openLandmark(selected);
          else focusDefault(scope);
          return;
        }
        if (!cycler(current, 1)) current.click();
      },
      reset() { /* Legacy has no resettable preferences; dissolving a banner always asks first. */ },
      focus() {
        requestFocus({ kind: "default" });
        scheduleFocusRequest();
      },
      cancel() {
        if (dialog) { setDialog(null); return true; }
        if (beat) { finishBeat(); return true; }
        if (mode === "founding" && draft.step > 0) {
          setDraft((current) => ({ ...current, step: Math.max(0, current.step - 1) }));
          return true;
        }
        if (explorationRef.current?.cancel()) return true;
        if (mode === "bannerhold" && closeUp) { setCloseUp(false); return true; }
        if (mode === "bannerhold" && inspected) { closeInspection(); return true; }
        if (showAftermath) { setAftermathDeferred(true); requestFocus({ kind: "default" }); return true; }
        if (exploring && exploration?.status === "moving") { environment?.cancelTravel?.(); announce(EXPLORATION.stopped); return true; }
        if (exploring) { setExplorationEnabled(false); return true; }
        return false;
      },
      cycle(delta: 1 | -1) {
        setInputMode("keys");
        if (dialog || beat) return;
        if (inspected) { cycleInspection(delta); return; }
        if (overview) {
          const next = cycleLandmark(selected, delta);
          setSelected(next);
          focusLandmarkLabel(next);
        }
      },
      orbit(yaw: number, pitch: number, zoom: number) {
        if (!dialog && !beat && environment && (mode === "bannerhold" || mode === "founding")) environment.nudgeOrbit(yaw, pitch, zoom);
      },
    };
  }, [dialog, beat, mode, draft.step, overview, showAftermath, inspected, closeUp, selected, environment, activeScope, focusLandmarkLabel, finishBeat, openLandmark, closeInspection, cycleInspection, requestFocus, scheduleFocusRequest, exploring, exploration?.status, announce, setExplorationEnabled, travelToLandmark]);

  // ------------------------------------------------------------- render

  const summaries = useMemo((): Record<LandmarkId, LandmarkSummary> => {
    const representative = scene.representative;
    return {
      "banner-hall": { status: `${LEGACY_COPY.rank[scene.rank]} · ${LEGACY_COPY.recognitionLabel(state.standing.recognition)}` },
      "muster-grounds": { status: representative ? `${representative.name} · ${LEGACY_COPY.status[representativeCondition(representative)].label}` : UI.noRepresentative },
      "war-record": { status: UI.entries(state.chronicle.length) },
      "heralds-station": {
        status: scene.unreadNotices > 0 ? UI.unreadCount(scene.unreadNotices) : UI.noticeCount(state.notices.length),
        badge: scene.unreadNotices > 0 ? scene.unreadNotices : undefined,
      },
    };
  }, [scene, state]);

  const backLabel = mode === "founding"
    ? (draft.step > 0 ? UI.back : LEGACY_COPY.backToHome)
    : mode === "bannerhold" && (inspected !== null || closeUp || showAftermath || exploring || settlementOverlayOpen) ? UI.back : LEGACY_COPY.backToHome;
  const banner = state.banner;
  const sessionLabel = session.session.kind === "preview" || session.session.kind === "preview-missing" || session.kind === "guest"
    ? (session.session.kind === "preview" ? session.session.label : LEGACY_COPY.guest.label)
    : null;

  // LegacyLayer's error boundary turns this into its failure panel; Retry mounts a fresh screen and environment.
  if (environmentFailure) throw new Error(`The Legacy environment stopped: ${environmentFailure.message}`, { cause: environmentFailure });

  let panel = null;
  if (mode === "bannerhold" && inspected === "banner-hall") panel = <BannerHallPanel state={state} scene={scene} persistent={session.persistent} nextStep={nextStep} onNextStep={goToStep} onDissolve={confirmDissolve} />;
  else if (mode === "bannerhold" && inspected === "muster-grounds") panel = <MusterGroundsPanel state={state} scene={scene} closeUp={closeUp} nextStep={nextStep} dispatch={dispatch} onInspect={toggleCloseUp} onFeedback={announce} onNextStep={goToStep} />;
  else if (mode === "bannerhold" && inspected === "war-record") panel = <WarRecordPanel state={state} nextStep={nextStep} onNextStep={goToStep} />;
  else if (mode === "bannerhold" && inspected === "heralds-station") panel = <HeraldsStationPanel state={state} scene={scene} nextStep={nextStep} dispatch={run} onAccept={confirmAccept} onNextStep={goToStep} />;

  return <section
    ref={rootRef}
    className={`legacy-screen legacy-screen--${mode}${mode === "bannerhold" && environmentReady && !showAftermath && !beat ? " is-settlement" : ""}${inspected ? " is-inspecting" : ""}${beat ? " is-raising" : ""}${exploring ? " is-exploring" : ""}${reducedMotion ? " legacy-screen--still" : ""}`}
    aria-label={UI.screenLabel}
    data-legacy-mode={mode}
    data-session={session.kind}
    data-input={inputMode}
    data-environment={environmentInfo?.source ?? "loading"}
    data-environment-ready={environmentReady ? "true" : "false"}
    data-quality={effectiveQuality.preset}
    onPointerDown={() => setInputMode("pointer")}
    onKeyDown={(event) => {
      // Up/down leave a single-line text field (Tab and Enter keep their native roles).
      if ((event.key !== "ArrowUp" && event.key !== "ArrowDown") || event.nativeEvent.isComposing) return;
      if (!(event.target instanceof HTMLInputElement) || event.target.type !== "text") return;
      const scope = activeScope();
      if (!scope) return;
      event.preventDefault();
      setInputMode("keys");
      moveFocus(scope, event.key === "ArrowUp" ? "up" : "down");
    }}
  >
    <div ref={stageRef} className="legacy-stage" />
    <div className="legacy-vignette" aria-hidden="true" />
    {!environmentReady && <p className="legacy-loading" role="status"><span className="legacy-loading-mark" aria-hidden="true" />{environmentError ?? UI.preparing}</p>}

    <header className="legacy-header">
      {banner && <p className="legacy-eyebrow">{LEGACY_COPY.title}</p>}
      {banner ? <div className="legacy-crest">
        <HeraldryEmblem className="legacy-crest-shield" heraldry={banner.heraldry} aspect="shield" label="" />
        <div>
          <h1 className="legacy-crest-name">{banner.name}</h1>
          <p className="legacy-crest-line">{LEGACY_COPY.rank[state.standing.rank]} · {NATIONS[banner.nationId].name}</p>
        </div>
      </div> : <>
        <h1 className="legacy-header-title">{LEGACY_COPY.title}</h1>
        <p className="legacy-header-tagline">{LEGACY_COPY.tagline}</p>
      </>}
      <div className="legacy-badges">
        {sessionLabel && <p className={`legacy-session-badge${session.session.kind === "preview" ? " is-preview" : ""}`} data-session-label>{sessionLabel}</p>}
        {session.session.kind === "preview" && <p className="legacy-badge-note">{session.session.title}</p>}
        {session.kind === "unavailable" && <p className="legacy-session-badge is-warning" title={LEGACY_COPY.storageUnavailable.body}>{LEGACY_COPY.storageUnavailable.title}</p>}
        {session.saveError && <p className="legacy-session-badge is-warning" title={session.saveError}>{LEGACY_COPY.saveFailed}</p>}
        {environmentInfo?.fallbackReason && <p className="legacy-badge-note">{UI.standInFallback}</p>}
      </div>
    </header>

    {mode === "bannerhold" && <div ref={overviewRef} className="legacy-overview">
      <LandmarkLabels
        ref={labelsRef}
        environment={environment}
        tracking={active && overview && environmentReady && !exploring}
        hidden={!overview || !environmentReady || exploring}
        selected={selected}
        hovered={hovered}
        summaries={summaries}
        onSelect={setSelected}
        onHover={setHovered}
        onOpen={(id) => { openLandmark(id); }}
      />
      {environmentReady && !beat && !showAftermath && banner && <LegacyExploration ref={explorationRef} snapshot={exploration} settlement={settlement} settlementEnvironment={environment} onEditorBegin={beginSettlementEditing} onOverlayChange={setSettlementOverlayOpen} onShowPlot={environment?.focusSettlementPreview ? () => environment.focusSettlementPreview?.() : undefined} house={{ name: banner.name, nation: NATIONS[banner.nationId].name, rank: LEGACY_COPY.rank[state.standing.rank], heraldry: banner.heraldry, recognition: state.standing.recognition, memberCount: state.members.length, matchCount: state.matches.length, unreadNotices: scene.unreadNotices, sessionLabel }} selected={selected} inspected={inspected} layout={environmentLayout} changing={changingEnvironment} error={layoutError} nextStep={nextStep} onLayout={changeEnvironment} onEnabled={(enabled) => { if (inspected) closeInspection(); setExplorationEnabled(enabled); }} onMember={selectExplorationMember} onTravel={travelToLandmark} onCancel={() => { environment?.cancelTravel?.(); announce(EXPLORATION.stopped); }} onInteract={(id) => { if (exploration?.enabled && exploration.status === "arrived" && exploration.destination === id && !exploration.paused) openLandmark(id); }} onInspect={openLandmark} onRosterOpen={() => { setCloseUp(false); setInspected(null); requestFocus({ kind: "selector", selector: "[data-party-member][aria-pressed='true'], [data-party-member]:not(:disabled)" }); }} onNextStep={(step) => { if (exploring) travelToLandmark(step.landmark); else goToStep(step); }} />}
    </div>}
    {showAftermath && <AftermathCard ref={aftermathRef} entries={aftermath} onDismiss={() => { run({ type: "dismiss-aftermath" }); requestFocus({ kind: "default" }); }} />}

    {panel && inspected && <InspectionPanel ref={panelRef} landmark={inspected} onClose={closeInspection} onCycle={cycleInspection}>{panel}</InspectionPanel>}

    {mode === "founding" && <FoundingCeremony ref={foundingRef} draft={draft} onChange={setDraft} onRaise={raiseBanner} onCancel={onBack} guest={!session.persistent} />}
    {mode === "recovery" && session.session.kind === "recovery" && <RecoveryPanel ref={recoveryRef} reason={session.session.reason} error={session.session.error} onReplace={confirmReplacement} onGuest={continueAsGuest} />}
    {mode === "preview-missing" && session.session.kind === "preview-missing" && <PreviewMissingPanel ref={recoveryRef} error={session.session.error} previews={session.session.previews} onGuest={continueAsGuest} />}

    {beat && <div className="legacy-beat" role="status" onClick={finishBeat}>
      <HeraldryEmblem className="legacy-beat-banner" heraldry={beat.heraldry} aspect="banner" label="" />
      <p className="legacy-beat-heading">{LEGACY_COPY.aftermath.headings.founding}</p>
      <p className="legacy-beat-name">{beat.name}</p>
      {banner && <p className="legacy-beat-line">{LEGACY_TEXT.founding(beat.name, NATIONS[banner.nationId].polity).body}</p>}
    </div>}

    <footer className="legacy-footer" aria-label={UI.controls}>
      <button type="button" className="legacy-footer-button" data-legacy-back aria-label={backLabel} onClick={onBack}><span className="controller-key" aria-hidden="true"><InputPrompt action="back" /></span><span className="legacy-footer-label">{backLabel}</span><span className="legacy-footer-compact" aria-hidden="true">{UI.back}</span></button>
      {/* Chess comes first: every Legacy screen is one action from the Play tab. */}
      {!beat && <button type="button" className="legacy-footer-button legacy-footer-play" data-legacy-play aria-label={LEGACY_COPY.navigation.playLabel} onClick={onPlay}>{LEGACY_COPY.navigation.play}<span className="legacy-footer-chevron" aria-hidden="true">›</span></button>}
      {overview && <button type="button" className="legacy-footer-button" aria-label={UI.select} onClick={() => exploring ? travelToLandmark(selected) : openLandmark(selected)}><span className="controller-key" aria-hidden="true"><InputPrompt action="select" /></span>{UI.select}</button>}
      {mode === "bannerhold" && !beat && <span className="legacy-footer-hint"><span className="controller-key legacy-key-wide" aria-hidden="true"><InputPrompt action="previousTab" /></span><span className="controller-key legacy-key-wide" aria-hidden="true"><InputPrompt action="nextTab" /></span>{UI.landmarks}</span>}
      {(mode === "bannerhold" || mode === "founding") && !beat && <span className="legacy-footer-hint"><span className="controller-key legacy-key-wide" aria-hidden="true">RS</span>{UI.lookAround}</span>}
      {overview && <span className="legacy-footer-note">{UI.pointerHint}</span>}
    </footer>
    <p className="legacy-feedback" role="status" aria-live="polite"><span key={feedback.revision}>{feedback.text}</span></p>
    {dialog && <LegacyDialog ref={dialogRef} content={dialog.content} onConfirm={dialog.confirm} onCancel={() => setDialog(null)} reducedMotion={reducedMotion} />}
  </section>;
});

export default LegacyScreen;

/** Resolve the session once per lazy-load attempt, without bringing fixture tapes into the normal screen chunk. */
export async function loadLegacyScreen() {
  const initialSession = await loadInitialLegacySession();
  const Screen = forwardRef<LegacyScreenHandle, LegacyScreenProps>(function ResolvedLegacyScreen(props, ref) {
    return <LegacyScreen {...props} ref={ref} initialSession={initialSession} />;
  });
  return { default: Screen };
}
