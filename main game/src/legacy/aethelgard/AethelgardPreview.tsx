import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { EALDHOLT_PREVIEW_COPY as COPY } from "../../../../shared/legacy/aethelgard/copy";
import { EALDHOLT_LOADING_START, advanceEaldholtLoading } from "../../../../shared/legacy/aethelgard/loading-progress";
import { EALDHOLT_INHERITED_COPY as HOUSE_COPY } from "../../../../shared/legacy/aethelgard/inherited-copy";
import { EALDHOLT_INTERFACE_COPY as UI } from "../../../../shared/legacy/aethelgard/interface-copy";
import { describeVillageWorld, type VillageWorldStatus } from "../../../../shared/legacy/aethelgard/environment/world-status";
import { createBrowserInheritedSessionStore } from "../../../../shared/legacy/aethelgard/inherited-browser-store";
import { createInheritedVisit, type InheritedVisit, type InheritedVisitSnapshot } from "../../../../shared/legacy/aethelgard/inherited-visit";
import { createBrowserHouseholdStore } from "../../../../shared/legacy/aethelgard/household-browser-store";
import { createHouseholdRuntime, parseHouseholdRuntimeSeed, type HouseholdRuntime, type HouseholdRuntimeSnapshot } from "../../../../shared/legacy/aethelgard/household-runtime";
import { householdSeedUrl, loadHouseholdSeed } from "../../../../shared/legacy/aethelgard/household-seed-loader";
import { describeHouseholdRuntime, getHouseholdActivityPanel, HOUSEHOLD_ACTIVITY_COPY, HOUSEHOLD_RUNTIME_COPY } from "../../../../shared/legacy/aethelgard/household-runtime-copy";
import { EALDHOLT_PEOPLE_DRAFT, getEaldholtDraftDialogue } from "../../../../shared/legacy/aethelgard/people-draft";
import { getEaldholtDraftFollowup } from "../../../../shared/legacy/aethelgard/people-followups";
import { EALDHOLT_HOUSE } from "../../../../shared/legacy/aethelgard/house";
import { EALDHOLT_VILLAGE_VIEWS, type EaldholtViewId } from "../../../../shared/legacy/aethelgard/village-views";
import { EALDHOLT_TYPOGRAPHY } from "../../../../shared/legacy/aethelgard/typography";
import { EALDHOLT_UI_THEME } from "../../../../shared/legacy/aethelgard/ui-theme";
import { chooseInheritedBannerPreset, createInheritedBannerDraft, type InheritedBannerDraft } from "../../../../shared/legacy/aethelgard/entry-draft";
import { cycleInheritedBannerPart, describeInheritedBannerPart, INHERITED_BANNER_PARTS, type InheritedBannerPart } from "../../../../shared/legacy/aethelgard/banner-editor";
import { describeHeraldry, HERALDRY_PRESETS } from "../../../../shared/legacy/content/heraldry";
import type { Heraldry } from "../../../../shared/legacy/types";
import type { Direction } from "../../settings-types";
import type { DesktopEnvironmentQuality } from "../environment-contract";
import type { LegacyScreenHandle } from "../legacy-handle";
import { HeraldryEmblem } from "../HeraldryEmblem";
import { currentNavigable, focusDefault, focusEdge, moveFocus, navigableElements } from "../spatial-nav";
import { createEaldholtVillageView, type EaldholtVillageView } from "./village-view";
import { LegacyGlassButton } from "./threeui-community/LegacyGlassButton";
import { ObserverHud } from "./observer/ObserverHud";
import { EaldholtLoadingScreen } from "./EaldholtLoadingScreen";
import "./AethelgardPreview.css";
import "./threeui-community/legacy-glass.css";
// My Legacy in the main menu's look, layered over the two sheets above (see that file).
import "./legacy-menu-theme.css";

type Step = "intro" | "banner" | "village";
/** "watch" (a villager to follow) and "houses" (the neighbouring houses) open in My Legacy's observer panel (observer/ObserverHud.tsx). */
type ToolDrawer = "views" | "camera" | "watch" | "houses" | null;
type InterfaceIconKind = "views" | "people" | "camera" | "home" | "play" | "back" | "close" | "pause" | "banner" | "watch";
/** Original fine-line interface marks; decorative, with visible text labels. */
function InterfaceIcon({ kind }: { kind: InterfaceIconKind }) {
  const paths: Record<InterfaceIconKind, string> = {
    views: "M3 5h18v14H3z M3 15l5-5 5 5 3-3 5 5 M16 8h.01",
    people: "M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6 M2 20v-2a6 6 0 0 1 12 0v2 M16 5a3 3 0 0 1 0 6 M18 14a5 5 0 0 1 4 4v2",
    camera: "M3 7h5l2-3h4l2 3h5v13H3z M16 13a4 4 0 1 1-8 0 4 4 0 0 1 8 0",
    home: "M3 11l9-8 9 8 M5 10v11h5v-7h4v7h5V10",
    play: "M8 4l12 8-12 8z",
    back: "M20 12H4 M10 6l-6 6 6 6",
    close: "M5 5l14 14 M19 5L5 19",
    pause: "M8 5v14 M16 5v14",
    banner: "M5 22V3 M5 4h14v11l-7-3-7 3",
    watch: "M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6",
  };
  return <svg className="ealdholt-action-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[kind]} /></svg>;
}
export interface AethelgardPreviewProps {
  environmentAudioOutput?():import('../../../../shared/menu/audio').MenuEffectsOutput|null;
  active: boolean;
  reducedMotion: boolean;
  quality: DesktopEnvironmentQuality;
  onBack(): void;
  onPlay(): void;
  /** Operator-owned local URL; no original Fab asset is bundled or published. */
  modelBaseUrl: string;
  modelFiles?: { desktop: string; quest: string };
  entryMode?: "intro" | "village";
  /** The saved slice is selected explicitly by the development-only host. */
  mode?: "preview" | "inherited";
  /** Read-only layout safety for the host's brief music notification. */
  onAudioToastSafetyChange?(safe: boolean): void;
  onAudioSuspensionChange?(paused: boolean): void;
}

const DEFAULT_MODELS = {
  desktop: "elderbloom-village-desktop-coastal-full-woodland-candidate-v5.glb",
  quest: "elderbloom-village-quest-coastal-pond-foliage-candidate-v2-normal16.glb",
};
const PART_LABELS = {
  division: COPY.fields.division, field0: COPY.fields.firstField, field1: COPY.fields.secondField,
  ordinary: COPY.fields.ordinary, ordinaryTincture: COPY.fields.ordinaryColour,
  charge: COPY.fields.charge, chargeTincture: COPY.fields.chargeColour,
} satisfies Record<InheritedBannerPart, string>;
const DISPLAY_STYLE = {
  "--ealdholt-display-family": `"${EALDHOLT_TYPOGRAPHY.displayFamily}", Georgia, serif`,
  "--ealdholt-display-weight": String(EALDHOLT_TYPOGRAPHY.displayWeight),
  "--ealdholt-hero-family": `"${EALDHOLT_TYPOGRAPHY.heroFamily}", "${EALDHOLT_TYPOGRAPHY.displayFamily}", Georgia, serif`,
  "--ealdholt-hero-weight": String(EALDHOLT_TYPOGRAPHY.heroWeight),
} as CSSProperties;
const THREEUI_STYLE = {
  ...Object.fromEntries(Object.entries(EALDHOLT_UI_THEME.palette).map(([name, value]) => [`--ealdholt-ui-${name}`, value])),
  "--ealdholt-ui-panel-radius": `${EALDHOLT_UI_THEME.panelRadius}px`,
  "--ealdholt-ui-control-radius": `${EALDHOLT_UI_THEME.controlRadius}px`,
} as CSSProperties;
let localDisplayFace: FontFace | null = null;
let localHeroFace: FontFace | null = null;

function loadLocalDisplayFace(): void {
  if (localDisplayFace || typeof FontFace === "undefined" || !document.fonts) return;
  const base = new URL(import.meta.env.BASE_URL, document.baseURI);
  const url = new URL(EALDHOLT_TYPOGRAPHY.displayAsset, base);
  if (url.origin !== window.location.origin) return;
  const face = new FontFace(EALDHOLT_TYPOGRAPHY.displayFamily, `url(${JSON.stringify(url.href)}) format("truetype")`, {
    weight: String(EALDHOLT_TYPOGRAPHY.displayWeight), style: "normal", display: "swap",
  });
  localDisplayFace = face;
  document.fonts.add(face);
  void face.load().catch(() => {
    document.fonts.delete(face);
    if (localDisplayFace === face) localDisplayFace = null;
  });
}

function loadLocalHeroFace(): void {
  if (localHeroFace || typeof FontFace === "undefined" || !document.fonts) return;
  const base = new URL(import.meta.env.BASE_URL, document.baseURI);
  const url = new URL(EALDHOLT_TYPOGRAPHY.heroAsset, base);
  if (url.origin !== window.location.origin) return;
  const face = new FontFace(EALDHOLT_TYPOGRAPHY.heroFamily, `url(${JSON.stringify(url.href)}) format("truetype")`, {
    weight: String(EALDHOLT_TYPOGRAPHY.heroWeight), style: "normal", display: "swap",
  });
  localHeroFace = face;
  document.fonts.add(face);
  void face.load().catch(() => {
    document.fonts.delete(face);
    if (localHeroFace === face) localHeroFace = null;
  });
}

/** The original preview stays visit-only. The explicit inherited mode uses the
 * separate saved contract; the renderer and host input surface are shared. */
export const AethelgardPreview = forwardRef<LegacyScreenHandle, AethelgardPreviewProps>(function AethelgardPreview({
  active, reducedMotion, quality, onBack, onPlay, modelBaseUrl, modelFiles = DEFAULT_MODELS, entryMode = "intro", mode = "preview", onAudioToastSafetyChange, onAudioSuspensionChange, environmentAudioOutput,
}, ref) {
  const inherited = mode === "inherited";
  const [step, setStep] = useState<Step>(inherited ? "intro" : entryMode);
  const [bannerOrigin, setBannerOrigin] = useState<"intro" | "village">(entryMode);
  const [draft, setDraft] = useState(createInheritedBannerDraft);
  const [customizing, setCustomizing] = useState(false);
  const [toolDrawer, setToolDrawer] = useState<ToolDrawer>(null);
  const [infoOpen, setInfoOpen] = useState(false);
  const [personDetailsOpen, setPersonDetailsOpen] = useState(false);
  const [editorSection, setEditorSection] = useState<"field" | "ordinary" | "charge">("field");
  const [paused, setPaused] = useState(false);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
  // Bind the saved clock/conditions to this owner before its first world draw.
  // Graphics readiness must not switch the village's observation time later.
  const [observerView, setObserverView] = useState<EaldholtVillageView | null>(null);
  // The stage the village loader has reached, for My Legacy's loading screen.
  const [loadProgress, setLoadProgress] = useState(EALDHOLT_LOADING_START);
  const [retry, setRetry] = useState(0);
  const [villageView, setVillageView] = useState<EaldholtViewId>("overview");
  const [worldStatus, setWorldStatus] = useState<VillageWorldStatus | null>(null);
  const [announcementId, setAnnouncementId] = useState(0);
  const [visitSnapshot, setVisitSnapshot] = useState<InheritedVisitSnapshot | null>(null);
  const [visitLoaded, setVisitLoaded] = useState(!inherited);
  const [householdOpen, setHouseholdOpen] = useState(false);
  const [householdActivityOpen, setHouseholdActivityOpen] = useState(false);
  const [householdResidentId, setHouseholdResidentId] = useState<string | null>(null);
  const [householdSnapshot, setHouseholdSnapshot] = useState<HouseholdRuntimeSnapshot | null>(null);
  const [householdLoadState, setHouseholdLoadState] = useState<"disabled" | "loading" | "ready" | "error">("disabled");
  const [householdRetry, setHouseholdRetry] = useState(0);
  const householdRuntime = useRef<HouseholdRuntime | null>(null);
  const [personId, setPersonId] = useState<string | null>(null);
  const [freshResponse, setFreshResponse] = useState<{ personId: string; optionId: string } | null>(null);
  const [followupOpen, setFollowupOpen] = useState(false);
  const followupArea = useRef<HTMLDivElement>(null);
  const conversationVersion = useRef(0);
  const visit = useRef<InheritedVisit | null>(null);
  const lastSave = useRef<{ type: "entry" } | { type: "response"; personId: string; optionId: string } | null>(null);
  const root = useRef<HTMLElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const view = useRef<EaldholtVillageView | null>(null);
  const exitingHome = useRef(false);
  const drawerOpener = useRef<HTMLElement | null>(null);
  const pendingFocusReturn = useRef<HTMLElement | null>(null);
  const pendingFocusSelector = useRef<string | null>(null);
  const busy = inherited && (!visitSnapshot || visitSnapshot.busy);
  const session = inherited ? visitSnapshot?.session ?? null : null;
  const householdFile = import.meta.env.DEV ? import.meta.env.VITE_ELDERBLOOM_HOUSEHOLD_FILE : undefined;
  const householdEntryId = session ? JSON.stringify([session.house.id, session.entry.at, session.banner]) : null;
  const householdPhase = householdSnapshot?.phase ?? householdLoadState;
  const householdStatus = householdLoadState === "loading" ? HOUSEHOLD_RUNTIME_COPY.loading
    : householdLoadState === "error" ? HOUSEHOLD_RUNTIME_COPY.error : describeHouseholdRuntime(householdSnapshot);
  const householdActivity = useMemo(() => inherited && householdLoadState === "ready"
    ? getHouseholdActivityPanel(householdSnapshot) : null, [inherited, householdLoadState, householdSnapshot]);
  const activityResident = householdActivity?.residents.find(resident => resident.id === householdResidentId)
    ?? householdActivity?.residents[0];
  const activityVisible = householdActivityOpen && !!activityResident && !personId;
  const activityResidentIndex = activityResident && householdActivity ? householdActivity.residents.indexOf(activityResident) : 0;
  const bannerDraft = inherited ? visitSnapshot?.bannerDraft ?? draft : draft;
  const dialogue = personId && session ? getEaldholtDraftDialogue(personId, session) : undefined;
  const speaker = EALDHOLT_PEOPLE_DRAFT.find(person => person.id === personId);
  const recordedChoice = speaker && session?.choices.find(choice => choice.choiceId === speaker.decision.id);
  const selectedOption = speaker?.decision.options.find(option => option.id === recordedChoice?.optionId);
  const responseUncertain = !!selectedOption && lastSave.current?.type === "response" && lastSave.current.personId === personId
    && (busy || !!visitSnapshot?.error);
  const freshAcknowledgement = selectedOption && freshResponse?.personId === personId && freshResponse.optionId === selectedOption.id;
  const speech = responseUncertain ? null : freshAcknowledgement ? selectedOption.response : dialogue?.greeting;
  const followup = personId && session && !busy && !visitSnapshot?.error ? getEaldholtDraftFollowup(personId, session) : null;
  const worldUiOpen = householdOpen || toolDrawer !== null;
  // The inherited village waits behind My Legacy's full loading screen; the visit-only preview keeps its corner note,
  // because its banner steps are used while the village loads behind them.
  const loadingCover = inherited && loadState !== "ready";
  // Focus follows the cover: to Retry when a load fails, to the dock when the village appears. The preview's own
  // steps are in use while its village loads, so its focus is left where the player put it.
  const coverState = inherited ? loadState : null;
  const live = useRef({ active, paused, step, reducedMotion, quality, householdOpen });
  live.current = { active, paused, step, reducedMotion, quality, householdOpen };

  useEffect(() => { loadLocalDisplayFace(); loadLocalHeroFace(); }, []);
  useLayoutEffect(() => {
    onAudioSuspensionChange?.(active && paused);
    return () => onAudioSuspensionChange?.(false);
  }, [active, paused, onAudioSuspensionChange]);
  useLayoutEffect(() => {
    onAudioToastSafetyChange?.(active && step === "village" && villageView === "overview" && !paused && !busy && !visitSnapshot?.error && !worldUiOpen && loadState === "ready");
    return () => onAudioToastSafetyChange?.(false);
  }, [active, step, villageView, paused, busy, visitSnapshot?.error, worldUiOpen, loadState, onAudioToastSafetyChange]);
  useEffect(() => { if (!active) setFollowupOpen(false); }, [active]);
  useLayoutEffect(() => {
    if (followupOpen && active && !paused) followupArea.current?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" });
  }, [followupOpen, active, paused]);

  const foundHouse = async (owner: InheritedVisit) => {
    const arms = chooseInheritedBannerPreset(owner.getSnapshot().bannerDraft, HERALDRY_PRESETS.aethelgard[0].id);
    if (!arms.ok || !owner.chooseBanner(arms.draft)) return;
    lastSave.current = { type: "entry" };
    await owner.confirmBanner();
  };
  const loadVisit = (owner: InheritedVisit) => {
    const loaded = owner.load();
    if (visit.current !== owner) return;
    setVisitLoaded(loaded);
    if (!loaded) return;
    // My Legacy opens on the village itself: no steward, no banner ceremony. A house without a saved entry is
    // founded at once under the first Aethelgard arms (the creator's direction of 10 November 2026).
    setStep("village");
    if (!owner.getSnapshot().session) void foundHouse(owner);
  };
  useEffect(() => {
    if (!inherited) { setVisitSnapshot(null); setVisitLoaded(true); return; }
    // Effect ownership survives React's development setup/cleanup replay. A
    // disposed controller cannot notify this host after a pending save settles.
    const owner = createInheritedVisit({ mode: "inherited", store: createBrowserInheritedSessionStore(), at: () => new Date().toISOString() });
    visit.current = owner;
    setVisitSnapshot(owner.getSnapshot());
    const unsubscribe = owner.subscribe(snapshot => { if (visit.current === owner) setVisitSnapshot(snapshot); });
    loadVisit(owner);
    return () => { unsubscribe(); owner.dispose(); if (visit.current === owner) visit.current = null; };
  }, [inherited]);

  useEffect(() => {
    // The experiment has its own explicit content opt-in. Ordinary preview,
    // unconfirmed entry and production perform no fetch, timer or sidecar read.
    if (!inherited || !active || !session || !householdFile) {
      setHouseholdSnapshot(null); setHouseholdLoadState("disabled"); return;
    }
    const abort = new AbortController();
    let closed = false, owner: HouseholdRuntime | null = null;
    setHouseholdLoadState("loading"); setHouseholdSnapshot(null);
    const visible = () => live.current.active && !live.current.paused && !document.hidden;
    const visibility = () => owner?.setVisible(visible());
    document.addEventListener("visibilitychange", visibility);
    void (async () => {
      try {
        const url = householdSeedUrl(modelBaseUrl, householdFile);
        if (!url) throw new Error("Household content was not configured.");
        const content = await loadHouseholdSeed(url, abort.signal);
        if (closed) return;
        const parsed = parseHouseholdRuntimeSeed(content);
        if (!parsed.ok) throw new Error(parsed.error);
        owner = createHouseholdRuntime({ mode: "inherited", seed: parsed.seed, confirmedEntry: session, live: true,
          store: createBrowserHouseholdStore(parsed.seed.contentRevision), at: () => Date.now(), visible: visible(),
          yieldControl: () => new Promise(resolve => window.setTimeout(resolve, 0)),
          schedule: (callback, delay) => { const timer = window.setTimeout(callback, delay); return () => window.clearTimeout(timer); },
          onState: snapshot => { if (!closed) setHouseholdSnapshot(snapshot); },
        });
        householdRuntime.current = owner;
        setHouseholdSnapshot(owner.getSnapshot()); setHouseholdLoadState("ready");
        owner.scheduleRun("visit");
      } catch {
        if (!closed) setHouseholdLoadState("error");
      }
    })();
    return () => {
      closed = true; abort.abort(); document.removeEventListener("visibilitychange", visibility);
      owner?.dispose(); if (householdRuntime.current === owner) householdRuntime.current = null;
    };
    // The immutable entry identity deliberately excludes ordinary story choices.
  }, [inherited, active, modelBaseUrl, householdFile, householdEntryId, householdRetry]);
  useEffect(() => {
    householdRuntime.current?.setVisible(active && !paused && !document.hidden);
  }, [active, paused]);

  const modelUrl = useMemo(() => {
    // Quality changes detail/residency, never the authored Desktop settlement.
    // The compact source remains available to the separate Native experience.
    try { return new URL(modelFiles.desktop, modelBaseUrl).href; }
    catch { return null; }
  }, [modelBaseUrl, modelFiles.desktop]);

  useEffect(() => {
    const host = stage.current;
    if (!host) return;
    setLoadState("loading");
    setObserverView(null);
    setLoadProgress(EALDHOLT_LOADING_START);
    setWorldStatus(null);
    if (!modelUrl) { setLoadState("error"); return; }
    let current: EaldholtVillageView | null = null;
    let closed = false;
    try {
      current = createEaldholtVillageView({ host, modelUrl, audioOutput:environmentAudioOutput, quality: live.current.quality,
        active: live.current.active && !live.current.paused, reducedMotion: live.current.reducedMotion, panelMode: "village",
        label: COPY.village.title, onReady: () => { if (!closed) setLoadState("ready"); },
        onError: () => { if (!closed) setLoadState("error"); },
        onProgress: report => { if (!closed) setLoadProgress(current => advanceEaldholtLoading(current, report)); },
        onWorldStatus: status => { if (!closed) setWorldStatus(status); },
      });
      view.current = current;
      setObserverView(current);
      current.setInteractive(live.current.active && !live.current.paused && live.current.step === "village" && !live.current.householdOpen);
    } catch { setLoadState("error"); }
    return () => { closed = true; current?.dispose(); if (view.current === current) view.current = null;
      setObserverView(owner => owner === current ? null : owner); };
  }, [modelUrl, retry]);

  useEffect(() => {
    // A preview or the banner introduction must never seed a population world.
    view.current?.setPopulationEntry(inherited && step === 'village' ? householdEntryId : null);
  }, [inherited, step, householdEntryId, modelUrl, retry]);

  useEffect(() => { view.current?.setQuality(quality); }, [quality]);
  useEffect(() => { view.current?.setReducedMotion(reducedMotion); }, [reducedMotion]);
  useEffect(() => {
    // Only actual host visibility/pause changes activate the world. Opening a
    // DOM drawer must not reset resident/fire clocks or request another frame.
    view.current?.setActive(active && !paused);
  }, [active, paused]);
  useEffect(() => {
    view.current?.setInteractive(active && !paused && step === "village" && !householdOpen);
  }, [active, paused, step, householdOpen]);
  useEffect(() => {
    if (!active) return;
    const blur = () => setPaused(true);
    const visibility = () => { if (document.hidden) setPaused(true); };
    window.addEventListener("blur", blur);
    document.addEventListener("visibilitychange", visibility);
    return () => { window.removeEventListener("blur", blur); document.removeEventListener("visibilitychange", visibility); };
  }, [active]);

  useLayoutEffect(() => {
    if (!active || !root.current) return;
    const returning = pendingFocusReturn.current;
    const selector = pendingFocusSelector.current;
    pendingFocusReturn.current = null;
    pendingFocusSelector.current = null;
    const remountedOpener = selector ? root.current.querySelector<HTMLElement>(selector) : null;
    if (remountedOpener && !remountedOpener.closest("[inert], [hidden]")) { remountedOpener.focus({ preventScroll: true }); return; }
    if (returning?.isConnected && !returning.closest("[inert], [hidden]")) { returning.focus({ preventScroll: true }); return; }
    focusDefault(root.current);
  }, [active, step, paused, householdOpen, personId, activityVisible, customizing, toolDrawer, dialogue?.recordedOptionId, visitLoaded, coverState]);

  const chooseBanner = (next: InheritedBannerDraft) => {
    if (inherited) {
      if (busy || session || !visit.current?.chooseBanner(next)) return;
    } else setDraft(next);
    setAnnouncementId(value => value + 1);
  };
  const choosePreset = (id: string) => {
    if (!inherited) {
      setDraft(previous => { const next = chooseInheritedBannerPreset(previous, id); return next.ok ? next.draft : previous; });
      setAnnouncementId(value => value + 1);
      return;
    }
    const next = chooseInheritedBannerPreset(visit.current?.getSnapshot().bannerDraft ?? bannerDraft, id);
    if (next.ok) chooseBanner(next.draft);
  };
  const cyclePart = (part: InheritedBannerPart, direction: 1 | -1) => {
    if (!inherited) {
      setDraft(previous => cycleInheritedBannerPart(previous, part, direction));
      setAnnouncementId(value => value + 1);
      return;
    }
    chooseBanner(cycleInheritedBannerPart(visit.current?.getSnapshot().bannerDraft ?? bannerDraft, part, direction));
  };
  const confirmBanner = async () => {
    const owner = visit.current;
    if (!owner || busy) return;
    setInfoOpen(false);
    lastSave.current = { type: "entry" };
    const saved = await owner.confirmBanner();
    if (visit.current === owner && saved) setStep("village");
  };
  const chooseResponse = async (selectedPersonId: string, optionId: string) => {
    const owner = visit.current;
    if (!owner || busy) return;
    const version = conversationVersion.current;
    setFreshResponse(null); setFollowupOpen(false);
    lastSave.current = { type: "response", personId: selectedPersonId, optionId };
    const saved = await owner.chooseResponse(selectedPersonId, optionId);
    // The NPC's immediate reply belongs only to this verified response and
    // this conversation visit. Reopening later uses the saved return greeting.
    if (visit.current === owner && saved && conversationVersion.current === version) setFreshResponse({ personId: selectedPersonId, optionId });
  };
  const openHousehold = (selectedPersonId: string | null = null) => {
    pendingFocusSelector.current = !selectedPersonId && personId ? `[data-ealdholt-person-id="${personId}"]` : null;
    conversationVersion.current++;
    if (householdLoadState === "error") setHouseholdRetry(value => value + 1);
    else householdRuntime.current?.scheduleRun("retry");
    setToolDrawer(null); setPersonDetailsOpen(false); setFreshResponse(null); setFollowupOpen(false); setPersonId(selectedPersonId); setHouseholdActivityOpen(false); setHouseholdOpen(true);
  };
  const closeHousehold = () => {
    conversationVersion.current++;
    // Conversation removes the village dock. Resolve its newly mounted People
    // opener after commit rather than retaining an absent or detached element.
    pendingFocusReturn.current = null;
    pendingFocusSelector.current = "[data-ealdholt-household]";
    setPersonDetailsOpen(false); setFreshResponse(null); setFollowupOpen(false); setPersonId(null); setHouseholdActivityOpen(false); setHouseholdOpen(false);
  };
  const openToolDrawer = (next: Exclude<ToolDrawer, null>) => {
    if (toolDrawer === next) { pendingFocusReturn.current = drawerOpener.current; setToolDrawer(null); return; }
    drawerOpener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setHouseholdOpen(false); setPersonId(null); setHouseholdActivityOpen(false); setToolDrawer(next);
  };
  const closeToolDrawer = () => { pendingFocusReturn.current = drawerOpener.current; setToolDrawer(null); };
  const toggleEditor = () => {
    if (customizing) pendingFocusSelector.current = "[data-ealdholt-customize]";
    setInfoOpen(false); setCustomizing(value => !value);
  };
  const closePersonDetails = () => {
    const opener = root.current?.querySelector<HTMLElement>("[data-ealdholt-details]");
    setPersonDetailsOpen(false); setFollowupOpen(false); opener?.focus({ preventScroll: true });
  };
  const closeActivity = () => {
    pendingFocusSelector.current = "button[data-ealdholt-activity-open]";
    setHouseholdActivityOpen(false);
  };
  const cycleHouseholdResident = (direction: 1 | -1) => {
    if (!householdActivity?.residents.length) return;
    const residents = householdActivity.residents;
    setHouseholdResidentId(residents[(activityResidentIndex + direction + residents.length) % residents.length].id);
  };
  const retrySave = () => {
    const previous = lastSave.current;
    if (previous?.type === "entry") { if (inherited && visit.current && !session) void foundHouse(visit.current); else void confirmBanner(); }
    else if (previous) void chooseResponse(previous.personId, previous.optionId);
  };
  const saveStatus = inherited && (busy || visitSnapshot?.error) ? <div className="ealdholt-save-status" role={visitSnapshot?.error ? "alert" : "status"}>
    <p>{busy ? HOUSE_COPY.saving : visitSnapshot?.error}</p>
    {!busy && lastSave.current && <LegacyGlassButton data-nav onClick={retrySave}>{HOUSE_COPY.retry}</LegacyGlassButton>}
  </div> : null;
  const enterBanner = (from: "intro" | "village") => {
    if (inherited && (!visitLoaded || session || busy)) return;
    setToolDrawer(null); setInfoOpen(false); setCustomizing(false); setBannerOrigin(from); setStep("banner");
  };
  const cancel = () => {
    if (exitingHome.current) return false;
    if (paused) { setPaused(false); return true; }
    if (infoOpen) { setInfoOpen(false); return true; }
    if (customizing && step === "banner") { toggleEditor(); return true; }
    if (toolDrawer) { closeToolDrawer(); return true; }
    if (personDetailsOpen) { closePersonDetails(); return true; }
    if (activityVisible) { closeActivity(); return true; }
    if (personId) { openHousehold(); return true; }
    if (householdOpen) { closeHousehold(); return true; }
    if (inherited && busy) return false;
    if (step === "banner") { setInfoOpen(false); setStep(bannerOrigin); return true; }
    return false;
  };
  const back = () => { if (!cancel()) onBack(); };
  // App's onBack asks this handle to unwind first. An explicitly labelled Home
  // action must bypass that one unwind and leave from any preview layer.
  const goHome = () => { exitingHome.current = true; try { onBack(); } finally { exitingHome.current = false; } };
  const activePart = (): InheritedBannerPart | null => {
    const focused = root.current && currentNavigable(root.current);
    const part = focused && !focused.closest("[inert]") ? focused.dataset.ealdholtPart : null;
    return INHERITED_BANNER_PARTS.find(value => value === part) ?? null;
  };
  const move = (direction: Direction) => {
    if (!root.current || !active) return;
    const part = activePart();
    if (part && (direction === "left" || direction === "right")) { cyclePart(part, direction === "right" ? 1 : -1); return; }
    moveFocus(root.current, direction);
  };
  useImperativeHandle(ref, () => ({
    move,
    activate() {
      if (!root.current || !active) return;
      const focused = currentNavigable(root.current);
      if (focused?.closest("[inert]")) { focusDefault(root.current); return; }
      const part = activePart();
      if (part) cyclePart(part, 1);
      else focused?.click();
    },
    edge(last) { if (root.current && active) focusEdge(root.current, last); },
    reset() { if (!householdOpen) view.current?.resetView(); },
    focus() { if (root.current && active) focusDefault(root.current); },
    cancel,
    cycle(delta) {
      if (!root.current || !active) return;
      const part = activePart();
      if (part) cyclePart(part, delta);
      else moveFocus(root.current, delta > 0 ? "right" : "left");
    },
    orbit(yaw, pitch, zoom) { if (active && !paused && step === "village" && !householdOpen) view.current?.orbit(yaw, pitch, zoom); },
  }));

  const heraldry = bannerDraft.heraldry as Heraldry | null;
  const sectionParts: readonly InheritedBannerPart[] = editorSection === "field" ? ["division", "field0", "field1"]
    : editorSection === "ordinary" ? ["ordinary", "ordinaryTincture"] : ["charge", "chargeTincture"];
  const parts = sectionParts.filter(part => heraldry ? !(part === "field1" && heraldry.division === "plain")
    && !(part === "ordinaryTincture" && heraldry.ordinary === "none") && !(part === "chargeTincture" && heraldry.charge === "none") : part === sectionParts[0]);
  return <section ref={root} className={`ealdholt-preview ealdholt-threeui ealdholt-world-first${active ? " is-active" : ""}${reducedMotion ? " is-reduced" : ""}`} style={{ ...DISPLAY_STYLE, ...THREEUI_STYLE }} data-ealdholt-ui="world-first" data-ealdholt-ui-source={EALDHOLT_UI_THEME.source.commit} aria-hidden={!active} inert={!active}
    aria-labelledby="ealdholt-title" data-ealdholt-step={step} data-ealdholt-paused={paused} data-ealdholt-world={loadState}
    data-ealdholt-mode={mode} data-ealdholt-saved={!!session} data-ealdholt-busy={busy}
    data-ealdholt-household-phase={householdPhase} data-ealdholt-household-deferred={householdSnapshot?.deferredSteps ?? 0}
    data-ealdholt-household-completed={householdSnapshot?.completedTasks ?? 0}
    data-ealdholt-focus={householdOpen ? personId ? "conversation" : "household" : "exploration"}
    data-ealdholt-drawer={step === "banner" && customizing ? "banner-edit" : householdOpen ? "people" : toolDrawer ?? undefined}
    onFocusCapture={event => {
      const element = event.target instanceof HTMLElement ? event.target.closest<HTMLElement>("[data-nav]") : null;
      element?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" });
    }}
    onKeyDown={event => {
      if (event.key !== "Tab" || !root.current) return;
      const items = navigableElements(root.current), current = currentNavigable(root.current);
      if (items.length && ((event.shiftKey && current === items[0]) || (!event.shiftKey && current === items[items.length - 1]))) {
        event.preventDefault(); items[event.shiftKey ? items.length - 1 : 0].focus();
      }
    }}>
    <div ref={stage} className="ealdholt-world" />
    <div className="ealdholt-grade" aria-hidden="true" />
    <header className="ealdholt-header" data-ealdholt-ui-region="header" inert={paused || loadingCover}>
      <div className="wf-house-identity"><p className="ealdholt-eyebrow">{UI.legacy}</p><h1 id="ealdholt-title">{EALDHOLT_HOUSE.name}</h1>
        {step === "village" && worldStatus && <p className="ealdholt-world-status" data-ealdholt-world-status role="timer" aria-label={describeVillageWorld(worldStatus).accessible}>{describeVillageWorld(worldStatus).compact}</p>}
      </div>
      <nav className="wf-global-actions" aria-label={UI.legacy}>
        {!inherited && step === "village" && !session && <LegacyGlassButton data-nav data-ealdholt-banner-edit onClick={() => enterBanner("village")}><InterfaceIcon kind="banner" />{UI.chooseBanner}</LegacyGlassButton>}
        <LegacyGlassButton data-nav data-ealdholt-home aria-label={UI.accessible.home} onClick={goHome}><InterfaceIcon kind="home" />{UI.home}</LegacyGlassButton>
        <LegacyGlassButton data-nav data-ealdholt-play aria-label={UI.accessible.play} onClick={onPlay}><InterfaceIcon kind="play" />{UI.play}</LegacyGlassButton>
        <LegacyGlassButton data-nav data-ealdholt-pause aria-label={UI.pause} onClick={() => setPaused(true)}><InterfaceIcon kind="pause" /><span className="ealdholt-sr-only">{UI.pause}</span></LegacyGlassButton>
      </nav>
    </header>

    <div className="ealdholt-panels" inert={paused || loadingCover}>
      {inherited && !visitLoaded && <section className="wf-cinematic wf-intro" aria-live="polite">
        <p>{visitSnapshot?.error ?? COPY.loading.title}</p>
        {visitSnapshot?.error && <LegacyGlassButton data-nav data-nav-default disabled={busy} onClick={() => { if (visit.current) loadVisit(visit.current); }}>{UI.retry}</LegacyGlassButton>}
      </section>}
      {step === "intro" && !inherited && <section className="wf-cinematic wf-intro" data-ealdholt-intro data-ealdholt-ui-region="intro" aria-label={UI.introSpeaker}>
        <p className="ealdholt-eyebrow">{UI.introSpeaker}</p>
        <p className="wf-steward-line" data-ealdholt-intro-copy>{UI.introBody}</p>
        <div className="wf-action-row"><LegacyGlassButton data-nav data-nav-default data-ealdholt-intro-continue className="is-primary" disabled={busy} onClick={() => enterBanner("intro")}><InterfaceIcon kind="banner" />{UI.chooseBanner}</LegacyGlassButton>
          <LegacyGlassButton data-nav data-ealdholt-intro-visit disabled={busy} onClick={() => { setToolDrawer(null); setStep("village"); }}>{UI.visitVillage}<InterfaceIcon kind="play" /></LegacyGlassButton></div>
      </section>}

      {step === "banner" && <section className="wf-banner-flow" data-ealdholt-ui-region="banner" data-customizing={customizing} aria-labelledby="ealdholt-banner-title">
        <div className="wf-banner-scene">
          <div className="wf-banner-heading"><h2 id="ealdholt-banner-title">{UI.bannerHeading}</h2>
            {!customizing && <LegacyGlassButton data-nav data-ealdholt-customize aria-label={UI.accessible.edit} disabled={busy || !!session} aria-expanded={false} aria-controls="ealdholt-banner-drawer" onClick={toggleEditor}>{UI.edit}</LegacyGlassButton>}</div>
          <figure className="ealdholt-banner-display" data-chosen={!!heraldry}>{heraldry
            ? <HeraldryEmblem heraldry={heraldry} aspect="banner" className="ealdholt-banner-art" />
            : <div className="ealdholt-empty-banner" role="img" aria-label={COPY.banner.unchosen} />}
            <span className="wf-banner-suspension" aria-hidden="true"><i /><i /></span></figure>
        </div>
        <div className="wf-banner-rail" data-ealdholt-ui-region="crest" inert={busy || !!session || customizing}>
          <div className="ealdholt-presets" role="group" aria-label={COPY.banner.preset}>
            {HERALDRY_PRESETS.aethelgard.map((preset, index) => <LegacyGlassButton key={preset.id} data-nav data-nav-default={!customizing && index === 0 || undefined} data-ealdholt-preset={preset.id} aria-pressed={heraldry ? describeHeraldry(preset.heraldry) === describeHeraldry(heraldry) : false} onClick={() => choosePreset(preset.id)}>
              <HeraldryEmblem heraldry={preset.heraldry} aspect="shield" label="" /><span>{preset.label}</span></LegacyGlassButton>)}
          </div>
        </div>
        <div className="wf-commit-dock" data-ealdholt-ui-region="commands" inert={customizing}>
          <div className="wf-commit-note"><span>{inherited ? UI.commitConsequence : UI.previewInfo}</span><LegacyGlassButton data-nav data-ealdholt-info aria-label={UI.accessible.info} aria-expanded={infoOpen} aria-controls="ealdholt-commit-info" onClick={() => setInfoOpen(value => !value)}>{UI.info}</LegacyGlassButton></div>
          {infoOpen && <p className="wf-info-sheet" id="ealdholt-commit-info">{inherited ? UI.fullInfo : COPY.visitOnly}</p>}
          {saveStatus}
          <div className="wf-action-row"><LegacyGlassButton data-nav data-ealdholt-banner-back disabled={busy} onClick={back}><InterfaceIcon kind="back" />{UI.back}</LegacyGlassButton>
            <LegacyGlassButton data-nav data-ealdholt-confirm className="is-primary" disabled={!heraldry || busy} onClick={() => { setInfoOpen(false); if (inherited) void confirmBanner(); else setStep("village"); }}>{inherited ? UI.begin : UI.visitVillage}<InterfaceIcon kind="play" /></LegacyGlassButton></div>
        </div>
        {customizing && <aside className="wf-drawer wf-banner-editor" id="ealdholt-banner-drawer" data-ealdholt-banner-drawer data-ealdholt-ui-region="editor" aria-label={UI.accessible.edit}>
          <header><h3>{UI.edit}</h3><LegacyGlassButton data-nav data-ealdholt-drawer-close aria-label={UI.close} onClick={toggleEditor}><InterfaceIcon kind="close" /></LegacyGlassButton></header>
          <div className="ealdholt-editor-sections" role="group" aria-label={COPY.banner.customize}>{([
            ["field", COPY.fields.division], ["ordinary", COPY.fields.ordinary], ["charge", COPY.fields.charge],
          ] as const).map(([id, label]) => <LegacyGlassButton key={id} data-nav data-nav-default={editorSection === id || undefined} data-ealdholt-section={id} aria-pressed={editorSection === id} onClick={() => setEditorSection(id)}>{label}</LegacyGlassButton>)}</div>
          <div className="ealdholt-parts">{parts.map(part => <div key={part} tabIndex={0} role="group" aria-label={`${PART_LABELS[part]}: ${heraldry ? describeInheritedBannerPart(heraldry, part) : COPY.banner.unchosen}`} data-nav data-ealdholt-part={part} className="ealdholt-part">
            <span>{PART_LABELS[part]}</span><span className="ealdholt-part-value"><LegacyGlassButton tabIndex={-1} aria-label={`${PART_LABELS[part]} −`} onClick={() => cyclePart(part, -1)}>‹</LegacyGlassButton><strong>{heraldry ? describeInheritedBannerPart(heraldry, part) : COPY.banner.unchosen}</strong><LegacyGlassButton tabIndex={-1} aria-label={`${PART_LABELS[part]} +`} onClick={() => cyclePart(part, 1)}>›</LegacyGlassButton></span>
          </div>)}</div>
        </aside>}
      </section>}

      {step === "village" && <>
        {!personId && <nav className="wf-village-dock" aria-label={UI.context}>
          <LegacyGlassButton data-nav data-nav-default={!worldUiOpen || undefined} data-ealdholt-tool="views" disabled={loadState !== "ready"} aria-expanded={toolDrawer === "views"} onClick={() => openToolDrawer("views")}><InterfaceIcon kind="views" />{UI.views}</LegacyGlassButton>
          {inherited
            ? <LegacyGlassButton data-nav data-ealdholt-tool="watch" disabled={!session || busy} aria-expanded={toolDrawer === "watch"} onClick={() => openToolDrawer("watch")}><InterfaceIcon kind="watch" />Watch</LegacyGlassButton>
            : <LegacyGlassButton data-nav data-ealdholt-household disabled={!session || busy} aria-expanded={householdOpen} onClick={() => householdOpen ? closeHousehold() : openHousehold()}><InterfaceIcon kind="people" />{UI.people}</LegacyGlassButton>}
          {inherited && <LegacyGlassButton data-nav data-ealdholt-tool="houses" disabled={!session || busy} aria-expanded={toolDrawer === "houses"} onClick={() => openToolDrawer("houses")}><InterfaceIcon kind="banner" />Houses</LegacyGlassButton>}
          <LegacyGlassButton data-nav data-ealdholt-tool="camera" disabled={loadState !== "ready"} aria-expanded={toolDrawer === "camera"} onClick={() => openToolDrawer("camera")}><InterfaceIcon kind="camera" />{UI.camera}</LegacyGlassButton>
        </nav>}
        {(toolDrawer === "views" || toolDrawer === "camera") && <aside className="wf-drawer wf-tool-drawer" data-ealdholt-tool-drawer={toolDrawer} data-ealdholt-ui-region={toolDrawer} aria-label={toolDrawer === "views" ? UI.views : UI.camera}>
          <header><h3>{toolDrawer === "views" ? UI.views : UI.camera}</h3><LegacyGlassButton data-nav data-nav-default={toolDrawer === "camera" || undefined} data-ealdholt-drawer-close aria-label={UI.accessible.close} onClick={closeToolDrawer}><InterfaceIcon kind="close" /></LegacyGlassButton></header>
          {toolDrawer === "views" ? <div className="ealdholt-view-picker" role="group" aria-label={COPY.controls.view}>{EALDHOLT_VILLAGE_VIEWS.map(pose => <LegacyGlassButton key={pose.id} data-nav data-nav-default={villageView === pose.id || undefined} data-ealdholt-view={pose.id} aria-pressed={villageView === pose.id} onClick={() => { view.current?.setView(pose.id); setVillageView(pose.id); closeToolDrawer(); }}>{pose.label}</LegacyGlassButton>)}</div>
            : <><div className="ealdholt-view-controls">{([
              [COPY.controls.orbitLeft, "↶", -.18, 0, 0], [COPY.controls.orbitRight, "↷", .18, 0, 0],
              [COPY.controls.tiltUp, "↑", 0, -.12, 0], [COPY.controls.tiltDown, "↓", 0, .12, 0],
              [COPY.controls.zoomIn, "+", 0, 0, -.12], [COPY.controls.zoomOut, "−", 0, 0, .12],
            ] as const).map(([label, symbol, yaw, pitch, zoom]) => <LegacyGlassButton key={label} data-nav aria-label={label} title={label} onClick={() => view.current?.orbit(yaw, pitch, zoom)}>{symbol}</LegacyGlassButton>)}</div>
              <LegacyGlassButton data-nav data-ealdholt-camera-reset aria-label={UI.accessible.reset} onClick={() => { view.current?.resetView(); setVillageView("overview"); }}>{UI.reset}</LegacyGlassButton></>}
        </aside>}
        {inherited && !session && saveStatus}
        {inherited && session && householdEntryId && <ObserverHud key={householdEntryId} view={observerView} sourceReady={loadState === "ready"}
          worldKey={householdEntryId} sky={worldStatus?.weather ?? null} panel={toolDrawer === "watch" || toolDrawer === "houses" ? toolDrawer : "powers"}
          onPanel={next => { if (next === "powers") closeToolDrawer(); else if (toolDrawer !== next) openToolDrawer(next); }} reducedMotion={reducedMotion}
          rightPanelFree={toolDrawer !== "views" && toolDrawer !== "camera" && !householdOpen} />}
      </>}

      {inherited && step === "village" && session && householdOpen && !personId && <aside className="wf-drawer ealdholt-household" data-ealdholt-ui-region="people" aria-labelledby={activityVisible ? "ealdholt-activity-title" : "ealdholt-household-title"} data-ealdholt-activity-open={activityVisible || undefined}>
        <header><h3 id="ealdholt-household-title">{UI.people}</h3><LegacyGlassButton data-nav data-ealdholt-drawer-close aria-label={UI.accessible.close} onClick={closeHousehold}><InterfaceIcon kind="close" /></LegacyGlassButton></header>
        {!activityVisible && <>
          <div className="ealdholt-role-picker" role="group" aria-label={UI.people}>{EALDHOLT_PEOPLE_DRAFT.map((person, index) => <LegacyGlassButton key={person.id} data-nav data-nav-default={index === 0 || undefined} data-ealdholt-person-id={person.id} disabled={busy} onClick={() => openHousehold(person.id)}><InterfaceIcon kind="people" /><span>{person.roleLabel}</span></LegacyGlassButton>)}</div>
          {!!householdActivity?.residents.length && <LegacyGlassButton data-nav data-ealdholt-activity-open className="is-quiet" onClick={() => setHouseholdActivityOpen(true)}>{UI.activity}</LegacyGlassButton>}
          {householdLoadState === "error" && <p className="ealdholt-recorded" role="status" data-ealdholt-household-status>{householdStatus}</p>}
        </>}
        {activityVisible && activityResident && householdActivity && <section className="ealdholt-household-activity" data-ealdholt-household-activity data-ealdholt-activity-resident={activityResident.id} data-ealdholt-activity-count={householdActivity.residents.length} data-ealdholt-activity-index={activityResidentIndex} aria-labelledby="ealdholt-activity-title">
          <h3 id="ealdholt-activity-title">{UI.activity}</h3>
          {householdStatus && <p className="ealdholt-recorded" role="status" data-ealdholt-household-status>{householdStatus}</p>}
          <nav className="ealdholt-activity-navigation" aria-label={HOUSEHOLD_ACTIVITY_COPY.heading}><LegacyGlassButton data-nav data-nav-default data-ealdholt-activity-previous disabled={householdActivity.residents.length < 2} onClick={() => cycleHouseholdResident(-1)}>{HOUSEHOLD_ACTIVITY_COPY.previous}</LegacyGlassButton><span>{activityResidentIndex + 1}/{householdActivity.residents.length}</span><LegacyGlassButton data-nav data-ealdholt-activity-next disabled={householdActivity.residents.length < 2} onClick={() => cycleHouseholdResident(1)}>{HOUSEHOLD_ACTIVITY_COPY.next}</LegacyGlassButton></nav>
          <h4 aria-live="polite" aria-atomic="true">{activityResident.label}</h4><p>{activityResident.role} · {activityResident.household}</p>
          <dl><dt>{HOUSEHOLD_ACTIVITY_COPY.recordedActivity}</dt><dd data-ealdholt-activity-recorded>{activityResident.recordedActivity}</dd><dt>{HOUSEHOLD_ACTIVITY_COPY.plannedRoutine}</dt><dd data-ealdholt-activity-planned>{activityResident.plannedRoutine}</dd>
            {!!activityResident.family.length && <><dt>{HOUSEHOLD_ACTIVITY_COPY.family}</dt><dd><ul>{activityResident.family.map((tie, index) => <li key={index}>{tie}</li>)}</ul></dd></>}
            {!!activityResident.socialTies.length && <><dt>{HOUSEHOLD_ACTIVITY_COPY.socialTies}</dt><dd><ul>{activityResident.socialTies.map((tie, index) => <li key={index}>{tie}</li>)}</ul></dd></>}
            {activityResident.latestEvent && <><dt>{HOUSEHOLD_ACTIVITY_COPY.latestEvent}</dt><dd data-ealdholt-activity-event>{activityResident.latestEvent}</dd></>}
          </dl><LegacyGlassButton data-nav data-ealdholt-activity-close onClick={closeActivity}>{UI.back}</LegacyGlassButton>
        </section>}{saveStatus}
      </aside>}

      {inherited && step === "village" && session && householdOpen && personId && <section className="wf-cinematic ealdholt-household ealdholt-conversation" data-ealdholt-person={personId} aria-labelledby="ealdholt-dialogue-title">
        <header><h3 id="ealdholt-dialogue-title">{dialogue?.roleLabel ?? speaker?.roleLabel}</h3><LegacyGlassButton data-nav data-ealdholt-person-back aria-label={UI.people} onClick={() => openHousehold()}><InterfaceIcon kind="back" />{UI.people}</LegacyGlassButton></header>
        {speech && <p className="ealdholt-speech" data-ealdholt-acknowledgement={selectedOption ? freshAcknowledgement ? "immediate" : "return" : undefined}>{speech}</p>}
        {!dialogue && <p>{HOUSE_COPY.contentUnavailable}</p>}
        {dialogue?.prompt && <p className="ealdholt-dialogue-prompt" id="ealdholt-dialogue-prompt">{dialogue.prompt}</p>}
        <div className="ealdholt-responses" aria-describedby={dialogue?.prompt ? "ealdholt-dialogue-prompt" : undefined}>{dialogue?.options.map((option, index) => <LegacyGlassButton key={option.id} data-nav data-nav-default={index === 0 || undefined} data-ealdholt-option={option.id} disabled={busy} onClick={() => { void chooseResponse(personId, option.id); }}>{option.label}</LegacyGlassButton>)}</div>
        <div className="wf-dialogue-actions"><LegacyGlassButton data-nav data-ealdholt-details aria-expanded={personDetailsOpen} onClick={() => personDetailsOpen ? closePersonDetails() : setPersonDetailsOpen(true)}>{UI.details}</LegacyGlassButton><LegacyGlassButton data-nav data-nav-default={!dialogue?.options.length || undefined} onClick={closeHousehold}>{UI.close}</LegacyGlassButton></div>
        {personDetailsOpen && <div className="wf-dialogue-details" data-ealdholt-person-details>
          {selectedOption && <p className="ealdholt-player-response" data-ealdholt-recorded-response={selectedOption.id}>{selectedOption.label}</p>}
          {dialogue?.recordedOptionId && !responseUncertain && <p className="ealdholt-recorded" role="status">{HOUSE_COPY.recorded}</p>}
          {followup && <div ref={followupArea} className="ealdholt-followup"><LegacyGlassButton data-nav data-ealdholt-followup aria-expanded={followupOpen} aria-controls="ealdholt-followup-reply" onClick={() => setFollowupOpen(value => !value)}>{followup.question}</LegacyGlassButton><p id="ealdholt-followup-reply" data-ealdholt-followup-reply hidden={!followupOpen}>{followup.reply}</p></div>}
        </div>}{saveStatus}
      </section>}
    </div>

    {inherited && <EaldholtLoadingScreen state={loadState} progress={loadProgress} reducedMotion={reducedMotion} onRetry={() => setRetry(value => value + 1)} onHome={goHome} />}
    {!inherited && loadState !== "ready" && !paused && <aside className={`ealdholt-load-state${loadState === "error" ? " is-error" : ""}`} role="status"><span aria-hidden="true">◇</span><p>{loadState === "error" ? COPY.error.title : COPY.loading.title}</p>{loadState === "error" && <LegacyGlassButton data-nav onClick={() => setRetry(value => value + 1)}>{UI.retry}</LegacyGlassButton>}</aside>}
    {paused && <div className="ealdholt-pause" role="dialog" aria-modal="true" aria-labelledby="ealdholt-pause-title"><section><h2 id="ealdholt-pause-title">{UI.pause}</h2><LegacyGlassButton data-nav data-nav-default className="is-primary" onClick={() => setPaused(false)}>{UI.resume}</LegacyGlassButton><LegacyGlassButton data-nav data-ealdholt-home onClick={goHome}>{UI.home}</LegacyGlassButton><LegacyGlassButton data-nav data-ealdholt-play onClick={onPlay}>{UI.play}</LegacyGlassButton></section></div>}
    <span className="ealdholt-sr-only" role="status" aria-live="polite"><span key={announcementId}>{announcementId ? COPY.banner.updated : ""}</span></span>
  </section>;
});

export default AethelgardPreview;
