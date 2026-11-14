import { readStoryProgress, saveStoryProgress, completePrologue, hasWatchedPrologue, storyChapters } from '../../shared/menu/story-progress';
import { lazy, memo, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Atmosphere from "./Atmosphere";
import CreatureStage from "./CreatureStage";
import HomeGrid from "./HomeGrid";
import Chapters from "./Chapters";
import { type ChapterItem } from "./chapters-content";
import LoadingScreen from "./LoadingScreen";
import LaunchArtwork from './LaunchArtwork';
import { usePreferredFullscreen } from './usePreferredFullscreen';
import useBootLoading from "./useBootLoading";
import MenuTransition from "./MenuTransition";
import MenuDialog from "./MenuDialog";
import type { ShowcaseView } from "../../shared/menu/types";
import ShowcaseBoundary from "./showcase/ShowcaseBoundary";
import Chronicles, { type ChroniclesHandle } from "./Chronicles";
import { SettingsGrid, SETTINGS_CATEGORIES } from "./SettingsGrid";
import SettingsDetail from "./SettingsDetail";
import { MatchSettingsContext, type MatchSettings } from "./play/match-settings";
import { useMenuAudio } from "./useMenuAudio";
import NowPlaying from "./NowPlaying";
import { InputPrompt, InputPromptContext } from "./InputPrompt";
import { MenuLocaleProvider } from "./MenuLocale";
import { translate } from "../../shared/menu/localization";
import { controllerDevice, type InputDevice } from "./input-prompts";
import { SETTINGS_RESET_COPY } from "../../shared/menu/settings";
import CreditsFilm, { type CreditsFilmHandle } from "./CreditsFilm";
import OpeningFilm, { type OpeningFilmHandle } from "./OpeningFilm";
import { OPENING_FILM_CLOSED, ealdholtFromLegacy, ealdholtOpeningClosed, ealdholtOpeningSeen, ealdholtOpeningShouldPlay, markEaldholtOpeningSeen, markOpeningSeen, openingAtStartup, openingFilmIsOpen, openingFilmStatus, openingSeen, openingStartupFinished, openingStartupSeen, prologueFinished, prologueFromChapters, reduceOpeningFilm, type OpeningFilmEvent, type OpeningFilmState } from "../../shared/menu/opening-film";
import { CREDITS_FILM_CLOSED, creditsEntry, creditsFilmIsOpen, creditsFilmStatus, reduceCreditsFilm, type CreditsFilmEvent, type CreditsFilmState } from "../../shared/menu/credits-film";
import { normalizePreferences, type BindingAction, type Direction, type Preferences, type SettingsCategory, type SettingsPageHandle } from "./settings-types";
import { HOME_CONTENT, getNextHomeTile, type HomeDirection } from "./home-content";
import { publishMatchAudioPreferences } from "./play/match-audio-settings";
import { PLAY_CARDS as cards, NAV_TABS as tabs, getModalContent } from "../../shared/menu/content";
import type { MenuPanel, MenuScreen } from "../../shared/menu/types";
import { LegacyLayer } from "./legacy/LegacyLayer";
import type { LegacyScreenHandle } from "./legacy/legacy-handle";
import type { DesktopEnvironmentQuality } from "./legacy/environment-contract";
import "./styles.css";
// The motion shared by every screen: light on a selection, panels swinging in, a press sinking (see that file).
import "./ui-motion.css";
import type { ReplayEntry } from "../../shared/showcase/types";
import type { PlayMode } from "../../shared/play/match";

type Panel = MenuPanel | "settings-reset";
/** My Legacy is a desktop destination screen opened from Home, outside the four top tabs. */
type Screen = MenuScreen | "legacy" | "match";

// The Legacy layer fades in over this long before the menu's ambient renderers pause beneath it.
const LEGACY_COVER_MS = 340;
// A slider sends a change per tick; preferences are written once they settle (and before the page goes away).
const PREFERENCES_WRITE_DELAY_MS = 250;
// A film that fails closes at once; its notice stays on the menu this long.
const FILM_NOTICE_MS = 6000;
const Showcase = lazy(() => import("./Showcase"));
const PlayRoute = lazy(() => import("./play/PlayRoute"));
// My Legacy needs no render when a menu preference changes elsewhere.
const LegacyLayerView = memo(LegacyLayer);

const preferencesKey = "crownfall.main-game.preferences";

/** The pad list, or null where the browser refuses the Gamepad API (a gamepad Permissions-Policy, or a frame without allow="gamepad", throws). */
function readGamepads(): ReturnType<Navigator["getGamepads"]> | null {
  try { return navigator.getGamepads?.() ?? null; }
  catch { return null; }
}

/** The first connected standard-mapping pad, found without allocating per frame. */
function standardGamepad(): Gamepad | null {
  const pads = readGamepads();
  if (!pads) return null;
  let fallback: Gamepad | null = null;
  for (let index = 0; index < pads.length; index++) {
    const pad = pads[index];
    if (pad && pad.connected && pad.mapping === "standard") {
      fallback ??= pad;
      if (gamepadEngaged(pad)) return pad;
    }
  }
  return fallback;
}

function anyGamepadConnected(): boolean {
  const pads = readGamepads();
  if (!pads) return false;
  for (let index = 0; index < pads.length; index++) if (pads[index]?.connected) return true;
  return false;
}

/** Any button pressed or stick deflected past the menu threshold. */
function gamepadEngaged(pad: Gamepad): boolean {
  for (let index = 0; index < pad.buttons.length; index++) if (pad.buttons[index].pressed) return true;
  for (let index = 0; index < pad.axes.length; index++) if (Math.abs(pad.axes[index]) > .55) return true;
  return false;
}

/** localStorage, or null where the browser refuses it (the opening then counts every start as the first). */
function menuStorage(): Storage | null {
  try { return window.localStorage; } catch { return null; }
}

function getPreferences(): Preferences {
  try { return normalizePreferences(JSON.parse(localStorage.getItem(preferencesKey) || "{}")); }
  catch { return normalizePreferences(null); }
}

export default function App() {
  const [inputDevice, setInputDevice] = useState<InputDevice>('keyboard');
  useEffect(() => {
    const keyboard = (event: Event) => {
      if (event.type === 'pointerdown' && event.target instanceof Element && event.target.closest('[data-input-demo]')) return;
      setInputDevice('keyboard');
    };
    window.addEventListener('keydown', keyboard, true);
    window.addEventListener('pointerdown', keyboard, true);
    return () => {
      window.removeEventListener('keydown', keyboard, true);
      window.removeEventListener('pointerdown', keyboard, true);
    };
  }, []);
  const [replayToOpen, setReplayToOpen] = useState<ReplayEntry | null>(null);
  const watchMatchReplay = (entry: ReplayEntry) => { showcaseOrigin.current = "play"; setActiveTab(2); setTransitionDirection(1); setReplayToOpen(entry); setShowcaseView("replays"); setScreen("showcase"); };
  const [playMode, setPlayMode] = useState<PlayMode>("classic");
  const [selected, setSelected] = useState<number>(1);
  const [screen, setScreen] = useState<Screen>("play");
  const [homeSelected, setHomeSelected] = useState(0);
  const [storyProgress, setStoryProgress] = useState(() => readStoryProgress(menuStorage()));
  const chapters = useMemo(() => storyChapters(storyProgress), [storyProgress]);
  const [chapterJustUnlocked, setChapterJustUnlocked] = useState(false);
  const [chapterSelected, setChapterSelected] = useState(0);
  const [chapterPreview, setChapterPreview] = useState<ChapterItem | null>(null);
  const [showcaseView, setShowcaseView] = useState<ShowcaseView>("overview");
  const [transitionDirection, setTransitionDirection] = useState(1);
  const [systemReducedMotion, setSystemReducedMotion] = useState(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const [settingsSelected, setSettingsSelected] = useState(0);
  const [settingsCategory, setSettingsCategory] = useState<SettingsCategory | null>(null);
  const [activeTab, setActiveTab] = useState<number>(1);
  const [panel, setPanel] = useState<Panel>(null);
  const [preferences, setPreferences] = useState<Preferences>(getPreferences);
  const t = (text: string) => translate(text, preferences.locale);
  const [preferencesSaved, setPreferencesSaved] = useState(true);
  const [legacyAudioPaused, setLegacyAudioPaused] = useState(false);
  // The end-credits film plays over the Credits page; it never changes the screen or category.
  const [creditsFilm, setCreditsFilm] = useState<CreditsFilmState>(CREDITS_FILM_CLOSED);
  const filmOpen = creditsFilmIsOpen(creditsFilm);
  const filmRef = useRef<CreditsFilmHandle>(null);
  const previousFilmOpen = useRef(filmOpen);
  const filmEvent = useCallback((event: CreditsFilmEvent) => setCreditsFilm(current => reduceCreditsFilm(current, event)), []);
  // The opening plays as the game starts (the whole film the first time, the title sequence after),
  // or again from Credits. While it is open the menu waits, inert, beneath it.
  const [opening, setOpening] = useState<OpeningFilmState>(OPENING_FILM_CLOSED);
  const openingOpen = openingFilmIsOpen(opening);
  const openingRef = useRef<OpeningFilmHandle>(null);
  const previousOpening = useRef(opening);
  const previousLegacyOpening = useRef(opening);
  const previousOpeningOpen = useRef(openingOpen);
  const startupOpening = useRef(false);
  const openingEvent = useCallback((event: OpeningFilmEvent) => setOpening(current => reduceOpeningFilm(current, event)), []);
  const anyFilmOpen = filmOpen || openingOpen;
  const resetAction = useRef<(() => void) | null>(null);
  const reducedMotion = !preferences.motion || systemReducedMotion;
  const boot = useBootLoading(reducedMotion);
  const continueBoot = boot.continueToMenu;
  const retryBoot = boot.retry;
  const gameplayShowcase = screen === "showcase" && (showcaseView === "battles" || showcaseView === "arenas");
  const audioBlocked = !openingOpen && (boot.blocking || screen === "match" || gameplayShowcase || screen === "legacy" && legacyAudioPaused);
  const audio = useMenuAudio(preferences, audioBlocked);
  const rememberWindowed = useCallback(() => setPreferences(current => ({ ...current, fullscreen: false })), []);
  usePreferredFullscreen(preferences.fullscreen, rememberWindowed);
  // Matches and AI battles mix their own sound; they follow the same Master, Music and Effects settings.
  useEffect(() => { publishMatchAudioPreferences(preferences); }, [preferences]);
  const bootKeys = useRef(new Set<string>());
  const bootPadBlocked = useRef(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const lastPanel = useRef<Panel>(null);
  const showcaseRef = useRef<SettingsPageHandle>(null);
  const chaptersRef = useRef<SettingsPageHandle>(null);
  const chroniclesRef = useRef<ChroniclesHandle>(null);
  const showcaseOrigin = useRef<"home" | "play" | "settings" | "chapters">("play");
  const previousShowcaseView = useRef<ShowcaseView>(showcaseView);
  const cardRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const homeRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const settingsRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const detailRef = useRef<SettingsPageHandle>(null);
  const settingsOrigin = useRef<"home" | "play">("play");
  const previousCategory = useRef<SettingsCategory | null>(null);
  const restoreFocus = useRef(false);
  const homeRight = useRef(1);
  const previousScreen = useRef<Screen>(screen);
  const gamepadInputAt = useRef(0);
  const gamepadConfirmHeld = useRef(false);
  const gamepadBackHeld = useRef(false);
  const gamepadResetHeld = useRef(false);
  const gamepadShoulderHeld = useRef(false);
  // Any menu input held on the last poll: audio is unlocked once per press, not every frame of a hold.
  const gamepadUnlockHeld = useRef(false);
  const gamepadPolledAt = useRef(0);
  const [filmNotice, setFilmNotice] = useState("");
  const legacyRef = useRef<LegacyScreenHandle>(null);
  const [legacyMounted, setLegacyMounted] = useState(false);
  const [legacyAudioToastSafe, setLegacyAudioToastSafe] = useState(false);
  // The Gamepad API is polled only while a pad is connected; browsers announce pads with gamepadconnected.
  const [gamepadConnected, setGamepadConnected] = useState(anyGamepadConnected);
  const [menuSuspended, setMenuSuspended] = useState(false);
  const legacyQuality = useMemo((): DesktopEnvironmentQuality => ({
    preset: preferences.quality,
    renderScale: preferences.renderScale,
    frameLimit: preferences.frameLimit,
  }), [preferences.quality, preferences.renderScale, preferences.frameLimit]);

  const closePanel = useCallback(() => {
    resetAction.current = null;
    restoreFocus.current = true;
    setPanel(null);
    setChapterJustUnlocked(false);
    setActiveTab(screen === "home" || screen === "legacy" ? 0 : screen === "settings" ? 3 : screen === "showcase" ? 2 : 1);
  }, [screen]);
  const selectCard = useCallback((index: number) => {
    const next = ((index % cards.length) + cards.length) % cards.length;
    setSelected(next);
    cardRefs.current[next]?.focus({ preventScroll: true });
  }, []);
  const selectHome = useCallback((index: number, focus = true) => {
    const next = Math.max(0, Math.min(index, HOME_CONTENT.length - 1));
    if (next > 0) homeRight.current = next;
    setHomeSelected(next);
    if (focus) homeRefs.current[next]?.focus({ preventScroll: true });
  }, []);
  const moveHome = useCallback((direction: HomeDirection) => {
    selectHome(getNextHomeTile(homeSelected, direction, homeRight.current));
  }, [homeSelected, selectHome]);
  const selectSettings = useCallback((index: number) => {
    const next = Math.max(0, Math.min(5, index));
    setSettingsSelected(next);
    settingsRefs.current[next]?.focus({ preventScroll: true });
  }, []);
  const moveSettings = useCallback((direction: Direction) => {
    const column = settingsSelected % 3;
    const row = Math.floor(settingsSelected / 3);
    const nextColumn = Math.max(0, Math.min(2, column + (direction === "left" ? -1 : direction === "right" ? 1 : 0)));
    const nextRow = Math.max(0, Math.min(1, row + (direction === "up" ? -1 : direction === "down" ? 1 : 0)));
    selectSettings(nextRow * 3 + nextColumn);
  }, [settingsSelected, selectSettings]);
  const activateSettings = useCallback((index: number) => {
    if (boot.blocking) return;
    setSettingsSelected(index);
    setTransitionDirection(1);
    setSettingsCategory(SETTINGS_CATEGORIES[index]);
    // Choosing Credits plays the end-credits film at once (this press is its gesture),
    // unless the menu is asked to reduce motion: then the notices page opens with Play.
    if (SETTINGS_CATEGORIES[index] === "credits" && creditsEntry({ reducedMotion }) === "film") filmEvent({ type: "open" });
  }, [boot.blocking, reducedMotion, filmEvent]);
  const playCredits = useCallback(() => { if (!boot.blocking) filmEvent({ type: "open" }); }, [boot.blocking, filmEvent]);
  const skipCredits = useCallback(() => filmEvent({ type: "skip" }), [filmEvent]);
  const playOpening = useCallback(() => { if (!boot.blocking) openingEvent({ type: "open", cut: "full", origin: "credits" }); }, [boot.blocking, openingEvent]);
  const skipOpening = useCallback(() => openingEvent({ type: "skip" }), [openingEvent]);
  const openTab = useCallback((index: number, direction?: number) => {
    if (boot.blocking) return;
    setTransitionDirection(direction ?? (index >= activeTab ? 1 : -1));
    setActiveTab(index);
    setPanel(null);
    if (index < 2) {
      setScreen(index === 0 ? "home" : "play");
      setSettingsCategory(null);
    } else if (index === 2) {
      if (screen !== "showcase") showcaseOrigin.current = (screen === "legacy" || screen === "chronicles") ? "home" : screen === "match" ? "play" : screen;
      setScreen("showcase");
      setShowcaseView("overview");
    } else if (index === 3) {
      if (screen === "home" || screen === "play") settingsOrigin.current = screen;
      else if (screen === "chronicles") settingsOrigin.current = "home";
      else if (screen === "chapters") settingsOrigin.current = "play";
      else if (screen === "showcase" && showcaseOrigin.current !== "settings") settingsOrigin.current = showcaseOrigin.current === "chapters" ? "play" : showcaseOrigin.current;
      setScreen("settings");
      setSettingsCategory(null);
    }
  }, [screen, activeTab, boot.blocking]);
  const confirmPanel = useCallback(() => {
    if (panel === "settings-reset") {
      const reset = resetAction.current;
      resetAction.current = null;
      reset?.();
      closePanel();
    } else if (panel === "quit") openTab(0);
    else closePanel();
  }, [panel, openTab, closePanel]);
  const moveDialogFocus = useCallback((direction: Direction | "first" | "last") => {
    const buttons = dialog.current?.querySelectorAll<HTMLButtonElement>(".dialog-actions button");
    if (!buttons?.length) return;
    const first = direction === "left" || direction === "up" || direction === "first";
    buttons[first ? 0 : buttons.length - 1]?.focus({ preventScroll: true });
  }, []);
  const activateDialogSelection = useCallback(() => {
    const focused = document.activeElement;
    if (focused instanceof HTMLButtonElement && dialog.current?.contains(focused)) focused.click();
    else if (panel === "settings-reset") closePanel();
    else confirmPanel();
  }, [panel, closePanel, confirmPanel]);
  const changeTab = useCallback((direction: number) => {
    if (screen === "showcase" && showcaseRef.current?.cancel()) return;
    openTab((activeTab + direction + tabs.length) % tabs.length, direction);
  }, [activeTab, openTab, screen]);
  const changeShowcaseView = useCallback((view: ShowcaseView) => {
    if (boot.blocking) return;
    setTransitionDirection(view === "overview" ? -1 : 1);
    setShowcaseView(view);
  }, [boot.blocking]);
  const activate = useCallback((index: number) => {
    if (boot.blocking) return;
    setSelected(index);
    if (cards[index].id === "classic" || cards[index].id === "local-duel") {
      setPlayMode(cards[index].id as PlayMode);
      setPanel(null);
      setScreen("match");
    } else if (cards[index].id === "chapters") {
      setTransitionDirection(1);
      setPanel(null);
      setScreen("chapters");
      setActiveTab(1);
    } else setPanel(cards[index].id);
  }, [boot.blocking]);
  const previewChapter = useCallback((chapter: ChapterItem) => {
    if (boot.blocking) return;
    // The Prologue entry plays the prologue film (this press is its gesture) and returns here.
    if (chapter.film === "prologue") { openingEvent(prologueFromChapters()); return; }
    setChapterPreview(chapter);
    setPanel("chapter-preview");
  }, [boot.blocking, openingEvent]);
  const enterLegacy = useCallback(() => {
    setLegacyMounted(true);
    setTransitionDirection(1);
    setPanel(null);
    setScreen("legacy");
    setActiveTab(0);
  }, []);
  const openLegacy = useCallback(() => {
    if (boot.blocking) return;
    // The first visit to My Legacy plays the House Ealdholt opening (this press is its gesture) over Home, in every
    // build: the film is a finished cut in public/video, not the licensed village, which only development builds
    // have. My Legacy is not mounted, so nothing of it starts loading, until the film has closed. Later visits open
    // at once.
    if (ealdholtOpeningShouldPlay({
      seen: ealdholtOpeningSeen(menuStorage()), reducedMotion, automated: navigator.webdriver === true, search: window.location.search,
    })) {
      setPanel(null);
      openingEvent(ealdholtFromLegacy());
      return;
    }
    enterLegacy();
  }, [boot.blocking, reducedMotion, openingEvent, enterLegacy]);
  // Every Legacy screen offers Play: it leaves My Legacy for the Play tab with the Classic card selected.
  const playFromLegacy = useCallback(() => {
    if (boot.blocking) return;
    setSelected(0);
    openTab(1, -1);
  }, [boot.blocking, openTab]);
  const activateHome = useCallback((index: number) => {
    if (boot.blocking) return;
    const item = HOME_CONTENT[index];
    if (!item?.action || !item.title || !item.imageSrc) return;
    setHomeSelected(index);
    if (item.destination === "legacy") openLegacy();
    else if (item.destination === "chronicles") { setTransitionDirection(1); setScreen("chronicles"); }
    else setPanel(item.action);
  }, [boot.blocking, openLegacy]);
  const back = useCallback(() => {
    // Back skips the opening: to the menu at startup, to the Credits page on a replay.
    if (openingOpen) { openingEvent({ type: "skip" }); return; }
    if (boot.blocking) return;
    // Back skips the film and lands on the Credits page beneath it.
    if (filmOpen) { filmEvent({ type: "skip" }); return; }
    if (panel) { closePanel(); return; }
    if (screen === "legacy") {
      // Unwinds dialog → inspection → overview inside the Legacy screen before returning Home.
      if (legacyRef.current?.cancel()) return;
      setTransitionDirection(-1);
      setScreen("home");
      setActiveTab(0);
      return;
    }
    setTransitionDirection(-1);
    if (screen === "chapters") { openTab(1, -1); return; }
    if (screen === "chronicles") {
      if (!chroniclesRef.current?.cancel()) openTab(0, -1);
      return;
    }
    if (screen === "showcase") {
      if (showcaseRef.current?.cancel()) return;
      if (showcaseView !== "overview") setShowcaseView("overview");
      else {
        const origin = showcaseOrigin.current;
        setScreen(origin);
        setActiveTab(origin === "home" ? 0 : origin === "settings" ? 3 : 1);
      }
      return;
    }
    if (screen === "settings" && settingsCategory && detailRef.current?.cancel()) return;
    if (screen === "settings" && settingsCategory) setSettingsCategory(null);
    else if (screen === "settings") openTab(settingsOrigin.current === "home" ? 0 : 1);
    else if (screen === "home") openTab(1);
    else setPanel("quit");
  }, [panel, screen, settingsCategory, showcaseView, closePanel, openTab, boot.blocking, filmOpen, filmEvent, openingOpen, openingEvent]);
  const activateSelected = useCallback(() => {
    if (boot.blocking) return;
    if (screen === "home") activateHome(homeSelected);
    else if (screen === "legacy") legacyRef.current?.activate();
    else if (screen === "showcase") showcaseRef.current?.activate();
    else if (screen === "chronicles") chroniclesRef.current?.activate();
    else if (screen === "chapters") chaptersRef.current?.activate();
    else if (screen === "settings") {
      if (settingsCategory) detailRef.current?.activate();
      else activateSettings(settingsSelected);
    } else activate(selected);
  }, [screen, homeSelected, settingsCategory, settingsSelected, selected, activateHome, activateSettings, activate, boot.blocking]);

  // The film belongs to the Credits page: leaving it by any route closes the film.
  useEffect(() => {
    if (filmOpen && (screen !== "settings" || settingsCategory !== "credits")) filmEvent({ type: "skip" });
  }, [filmOpen, screen, settingsCategory, filmEvent]);
  // So does an opening replayed from Credits, and the prologue belongs to Chapters.
  useEffect(() => {
    if (!openingOpen) return;
    if (opening.origin === "credits" && (screen !== "settings" || settingsCategory !== "credits")) openingEvent({ type: "skip" });
    if (opening.origin === "chapters" && screen !== "chapters") openingEvent({ type: "skip" });
    // The House Ealdholt opening plays over Home, on the way into My Legacy.
    if (opening.origin === "legacy" && screen !== "home") openingEvent({ type: "skip" });
  }, [openingOpen, opening.origin, screen, settingsCategory, openingEvent]);

  // The House Ealdholt opening has closed. Ended or skipped (Skip, Back, Esc, gamepad B), it has been shown and is
  // not played again; a film that could not play is not recorded. Either way My Legacy follows, unless the menu
  // left Home beneath the film. A layout effect, so Home is never painted between the film and My Legacy.
  useLayoutEffect(() => {
    const closed = ealdholtOpeningClosed(previousLegacyOpening.current, opening);
    previousLegacyOpening.current = opening;
    if (!closed) return;
    if (closed !== "failed") markEaldholtOpeningSeen(menuStorage());
    if (screen === "home" && !boot.blocking) enterLegacy();
  }, [opening, screen, boot.blocking, enterLegacy]);

  // Start the opening alongside menu preparation: the full film on a first start,
  // the title sequence afterwards, and no autoplay with reduced motion.
  useEffect(() => {
    if (startupOpening.current) return;
    startupOpening.current = true;
    const cut = openingAtStartup({ seen: openingSeen(menuStorage()), reducedMotion });
    if (!cut) return;
    openingEvent({ type: "open", cut, origin: "startup" });
  }, [boot.blocking, boot.leaving, reducedMotion, openingEvent]);

  // Once the startup opening is skipped or ends, this player has started Crownfall: later starts show the title
  // sequence. A film that could not play records nothing, so the next start tries the whole film again.
  useEffect(() => {
    const previous = previousOpening.current;
    if (openingStartupFinished(previous, opening)) {
      if (openingStartupSeen(previous, opening)) markOpeningSeen(menuStorage());
      boot.finish();
    }
    if (screen === "chapters" && prologueFinished(previous, opening)) {
      const next = completePrologue(storyProgress, new Date().toISOString());
      setChapterJustUnlocked(!hasWatchedPrologue(storyProgress));
      setStoryProgress(next);
      saveStoryProgress(next, menuStorage());
      const available = storyChapters(next);
      const index = available.findIndex(chapter => chapter.id === "chapter-01");
      setChapterSelected(index);
      setChapterPreview(available[index]);
      setPanel("chapter-preview");
    }
    previousOpening.current = opening;
  }, [opening, screen, boot.finish, storyProgress]);

  // A film that fails closes at once: say so where the player lands. The Credits page shows its own notice.
  useEffect(() => {
    if (openingFilmIsOpen(opening) || opening.notice !== "failed" || opening.origin === "credits") { setFilmNotice(""); return; }
    setFilmNotice(openingFilmStatus(opening));
    const timer = window.setTimeout(() => setFilmNotice(""), FILM_NOTICE_MS);
    return () => window.clearTimeout(timer);
  }, [opening]);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const change = () => setSystemReducedMotion(media.matches);
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, []);

  useEffect(() => {
    if (panel) lastPanel.current = panel;
    if (panel && !dialog.current?.open) {
      dialog.current?.showModal();
      // React's autoFocus runs on mount; this shared dialog is already mounted.
      // Select the safe reset default only after showModal makes it focusable.
      dialog.current?.querySelector<HTMLButtonElement>(panel === "settings-reset" ? ".secondary-action" : ".primary-action")?.focus({ preventScroll: true });
    }
    else if (!panel && dialog.current?.open) dialog.current?.close();
  }, [panel]);

  useEffect(() => {
    if (boot.blocking) return;
    if (previousScreen.current === screen && previousCategory.current === settingsCategory && previousShowcaseView.current === showcaseView && previousFilmOpen.current === filmOpen && previousOpeningOpen.current === openingOpen && !restoreFocus.current) return;
    const enteringChapterOne = previousOpeningOpen.current && !openingOpen && opening.cut === 'prologue'
      && opening.origin === 'chapters' && opening.completed === true && screen === 'chapters';
    previousScreen.current = screen;
    previousCategory.current = settingsCategory;
    previousShowcaseView.current = showcaseView;
    previousFilmOpen.current = filmOpen;
    previousOpeningOpen.current = openingOpen;
    restoreFocus.current = false;
    if (enteringChapterOne) return;
    // The opening holds focus while it plays; closing it returns focus to the menu (or the Credits page).
    if (openingOpen) { openingRef.current?.focus(); return; }
    // The film holds focus while it plays; closing it returns focus to the Credits page.
    if (filmOpen) { filmRef.current?.focus(); return; }
    if (panel) return;
    if (screen === "legacy") { legacyRef.current?.focus(); return; }
    if (screen === "showcase") { showcaseRef.current?.focus(); return; }
    if (screen === "chronicles") { chroniclesRef.current?.focus(); return; }
    if (screen === "chapters") { chaptersRef.current?.focus(); return; }
    if (screen === "settings" && settingsCategory) { detailRef.current?.focus(); return; }
    const target = screen === "home" ? homeRefs.current[homeSelected] : screen === "settings" ? settingsRefs.current[settingsSelected] : cardRefs.current[selected];
    target?.focus({ preventScroll: true });
  }, [screen, settingsCategory, showcaseView, panel, homeSelected, settingsSelected, selected, boot.blocking, filmOpen, openingOpen]);

  // One render loop at a time: once the opaque Legacy layer has covered the stage,
  // the sorcerer and particles pause and hide. Leaving restores them at once,
  // before the layer fades out, so the menu looks exactly as it did.
  useEffect(() => {
    if (screen !== "legacy") {
      setMenuSuspended(false);
      return;
    }
    const timer = setTimeout(() => setMenuSuspended(true), reducedMotion ? 0 : LEGACY_COVER_MS);
    return () => clearTimeout(timer);
  }, [screen, reducedMotion]);

  useEffect(() => {
    let written = false;
    const write = () => {
      if (written) return;
      written = true;
      window.clearTimeout(timer);
      try {
        localStorage.setItem(preferencesKey, JSON.stringify(preferences));
        setPreferencesSaved(true);
      } catch {
        setPreferencesSaved(false);
      }
    };
    // Each tick of a slider is a new value: write the one it settles on, or at once if the page is going away.
    const timer = window.setTimeout(write, PREFERENCES_WRITE_DELAY_MS);
    const leaving = () => { if (document.visibilityState === "hidden") write(); };
    window.addEventListener("pagehide", write);
    document.addEventListener("visibilitychange", leaving);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("pagehide", write);
      document.removeEventListener("visibilitychange", leaving);
    };
  }, [preferences]);

  const retrySave = useCallback(() => {
    try { localStorage.setItem(preferencesKey, JSON.stringify(preferences)); setPreferencesSaved(true); }
    catch { setPreferencesSaved(false); }
  }, [preferences]);
  // The match's pause menu shows these same Settings pages, on these preferences, saved the same way.
  const matchSettings = useMemo<MatchSettings>(() => ({ preferences, onChange: setPreferences, preferencesSaved, onRetrySave: retrySave }), [preferences, preferencesSaved, retrySave]);
  const requestReset = useCallback((apply: () => void) => {
    resetAction.current = apply;
    setPanel("settings-reset");
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (screen === "match") return;
      if (boot.blocking && !openingOpen) { bootKeys.current.add(event.code); return; }
      if (bootKeys.current.has(event.code)) return;
      if (event.code === 'F9' && !panel && screen === 'settings' && settingsCategory && settingsCategory !== 'input') {
        event.preventDefault(); detailRef.current?.reset(); return;
      }
      const action = (Object.entries(preferences.bindings) as [BindingAction, string][]).find(([, code]) => code === event.code)?.[0];
      // Text fields (the Legacy banner name and motto) keep every key except Escape.
      const typing = event.target instanceof HTMLTextAreaElement || (event.target instanceof HTMLInputElement && (event.target.type === "text" || event.target.type === "search"));
      const marketEditor = event.target instanceof HTMLElement && !!event.target.closest('[data-near-market]') && (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement);
      if ((typing || marketEditor) && event.code !== "Escape") return;
      if (event.repeat && (action === "select" || action === "back" || event.code === "Escape" || anyFilmOpen && event.code === "Space")) {
        event.preventDefault();
        return;
      }
      if (openingOpen) {
        // Over the opening: Back or Esc skips. While it waits, any other key begins it (this key
        // press is the gesture its sound needs); once playing, Space, Enter or Select pause and resume.
        // A focused button keeps its own Enter/Space activation, and Tab moves between them.
        const buttonActivation = (event.code === "Enter" || event.code === "Space") && event.target instanceof HTMLButtonElement;
        const modifierOnly = /^(?:Shift|Control|Alt|Meta|OS)(?:Left|Right)?$/.test(event.code) || event.code === "CapsLock";
        if (event.code === "Escape" || action === "back") { event.preventDefault(); back(); }
        else if (buttonActivation || event.code === "Tab" || modifierOnly) return;
        else if (opening.phase === "waiting") { event.preventDefault(); openingEvent({ type: "begin" }); }
        else if (event.code === "Space" || event.code === "Enter" || action === "select") { event.preventDefault(); openingEvent({ type: "toggle" }); }
        else if (action) event.preventDefault();
        return;
      }
      if (filmOpen) {
        // Over the film: Back or Esc skips; Space, Enter or Select pause and resume.
        // A focused film button keeps its own Enter/Space activation, and Tab moves between them.
        const buttonActivation = (event.code === "Enter" || event.code === "Space") && event.target instanceof HTMLButtonElement;
        if (event.code === "Escape" || action === "back") { event.preventDefault(); back(); }
        else if (buttonActivation || event.code === "Tab") return;
        else if (event.code === "Space" || event.code === "Enter" || action === "select") { event.preventDefault(); filmEvent({ type: "toggle" }); }
        else if (action) event.preventDefault();
        return;
      }
      if (event.code === "Escape" || action === "back") {
        event.preventDefault();
        back();
        return;
      }
      if (panel) {
        if (action === "previousTab" || action === "nextTab") event.preventDefault();
        else if (action && ["left", "right", "up", "down", "first", "last"].includes(action)) {
          event.preventDefault();
          moveDialogFocus(action as Direction | "first" | "last");
        } else if (action === "select" && !((event.code === "Enter" || event.code === "Space") && event.target instanceof HTMLButtonElement)) {
          event.preventDefault();
          activateDialogSelection();
        }
        return;
      }
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement || event.target instanceof HTMLTextAreaElement) return;
      if (action === "previousTab" || action === "nextTab") {
        event.preventDefault();
        if (screen === "legacy") legacyRef.current?.cycle(action === "nextTab" ? 1 : -1);
        else if (screen === "chronicles") chroniclesRef.current?.cycle(action === "nextTab" ? 1 : -1);
        else changeTab(action === "nextTab" ? 1 : -1);
        return;
      }
      const direction = action && ["left", "right", "up", "down"].includes(action) ? action as Direction : undefined;
      if (direction) {
        event.preventDefault();
        if (screen === "home") moveHome(direction);
        else if (screen === "legacy") legacyRef.current?.move(direction);
        else if (screen === "showcase") showcaseRef.current?.move(direction);
        else if (screen === "chronicles") chroniclesRef.current?.move(direction);
        else if (screen === "chapters") chaptersRef.current?.move(direction);
        else if (screen === "settings") {
          if (settingsCategory) detailRef.current?.move(direction);
          else moveSettings(direction);
        } else if (direction === "left" || direction === "right") selectCard(selected + (direction === "right" ? 1 : -1));
        return;
      }
      if (action === "first" || action === "last") {
        event.preventDefault();
        const first = action === "first";
        if (screen === "home") selectHome(first ? 0 : HOME_CONTENT.length - 1);
        else if (screen === "legacy") legacyRef.current?.edge?.(!first);
        else if (screen === "settings" && !settingsCategory) selectSettings(first ? 0 : 5);
        else if (screen === "settings") detailRef.current?.edge?.(!first);
        else if (screen === "showcase") showcaseRef.current?.edge?.(!first);
        else if (screen === "chronicles") chroniclesRef.current?.edge?.(!first);
        else if (screen === "chapters") chaptersRef.current?.edge?.(!first);
        else if (screen === "play") selectCard(first ? 0 : cards.length - 1);
      }
      if (action === "select" && !((event.code === "Enter" || event.code === "Space") && event.target instanceof HTMLButtonElement)) {
        event.preventDefault();
        activateSelected();
      }
    };
    const onKeyUp = (event: KeyboardEvent) => { bootKeys.current.delete(event.code); };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKeyUp);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("keyup", onKeyUp); };
  }, [preferences.bindings, panel, screen, settingsCategory, selected, activateSelected, back, changeTab, moveHome, moveSettings, selectHome, selectSettings, selectCard, moveDialogFocus, activateDialogSelection, boot.blocking, filmOpen, filmEvent, anyFilmOpen, openingOpen, opening.phase, openingEvent]);

  useEffect(() => {
    const refresh = () => { setGamepadConnected(anyGamepadConnected()); if (!standardGamepad()) setInputDevice('keyboard'); };
    refresh();
    window.addEventListener("gamepadconnected", refresh);
    window.addEventListener("gamepaddisconnected", refresh);
    return () => {
      window.removeEventListener("gamepadconnected", refresh);
      window.removeEventListener("gamepaddisconnected", refresh);
    };
  }, []);

  useEffect(() => {
    // No pad, no per-frame polling: the loop starts on gamepadconnected and stops on gamepaddisconnected.
    if (!gamepadConnected || screen === "match") return;
    let frame: number;
    const poll = (time: number) => {
      const pad = standardGamepad();
      if (pad && gamepadEngaged(pad)) setInputDevice(controllerDevice(pad.id));
      if (boot.blocking && !openingOpen) {
        bootPadBlocked.current = !!pad && gamepadEngaged(pad);
        if (pad && time > gamepadInputAt.current) {
          if (boot.canContinue && pad.buttons[0]?.pressed) { continueBoot(); gamepadInputAt.current = time + 500; }
          else if (boot.degraded && pad.buttons[3]?.pressed) { retryBoot(); gamepadInputAt.current = time + 500; }
        }
        frame = requestAnimationFrame(poll);
        return;
      }
      if (bootPadBlocked.current && pad) {
        if (gamepadEngaged(pad)) {
          frame = requestAnimationFrame(poll);
          return;
        }
        bootPadBlocked.current = false;
      }
      if (!pad?.buttons[0]?.pressed) gamepadConfirmHeld.current = false;
      if (!pad?.buttons[1]?.pressed) gamepadBackHeld.current = false;
      if (!pad?.buttons[3]?.pressed) gamepadResetHeld.current = false;
      if (!pad?.buttons[4]?.pressed && !pad?.buttons[5]?.pressed) gamepadShoulderHeld.current = false;
      if (openingOpen) {
        // Over the opening only A (begin, then pause/resume) and B (skip) act. A gamepad press may not
        // count as a gesture for sound; if refused after waiting, the opening plays silently with a notice.
        if (pad && time > gamepadInputAt.current) {
          if (pad.buttons[0]?.pressed && !gamepadConfirmHeld.current) {
            gamepadConfirmHeld.current = true; void audio.unlock(); openingEvent({ type: "toggle" }); gamepadInputAt.current = time + 350;
          } else if (pad.buttons[1]?.pressed && !gamepadBackHeld.current) {
            gamepadBackHeld.current = true; back(); gamepadInputAt.current = time + 350;
          }
        }
        frame = requestAnimationFrame(poll);
        return;
      }
      if (filmOpen) {
        // Over the film only A (pause/resume) and B (skip) act; the menu beneath is inert.
        if (pad && time > gamepadInputAt.current) {
          if (pad.buttons[0]?.pressed && !gamepadConfirmHeld.current) {
            gamepadConfirmHeld.current = true; void audio.unlock(); filmEvent({ type: "toggle" }); gamepadInputAt.current = time + 350;
          } else if (pad.buttons[1]?.pressed && !gamepadBackHeld.current) {
            gamepadBackHeld.current = true; back(); gamepadInputAt.current = time + 350;
          }
        }
        frame = requestAnimationFrame(poll);
        return;
      }
      // Right stick orbits and the triggers zoom the Legacy camera every frame, scaled by frame time.
      const polledAt = gamepadPolledAt.current;
      gamepadPolledAt.current = time;
      if (pad && !panel && screen === "legacy" && polledAt > 0) {
        const delta = Math.min(0.1, Math.max(0, (time - polledAt) / 1000));
        const yaw = Math.abs(pad.axes[2] ?? 0) > 0.18 ? pad.axes[2] : 0;
        const pitch = Math.abs(pad.axes[3] ?? 0) > 0.18 ? -pad.axes[3] : 0;
        const trigger = (pad.buttons[7]?.value ?? 0) - (pad.buttons[6]?.value ?? 0);
        const zoom = Math.abs(trigger) > 0.08 ? trigger : 0;
        if (yaw || pitch || zoom) legacyRef.current?.orbit(yaw * delta, pitch * delta, zoom * delta);
      }
      const left = !!pad && (pad.buttons[14]?.pressed || pad.axes[0] < -0.55);
      const right = !!pad && (pad.buttons[15]?.pressed || pad.axes[0] > 0.55);
      const up = !!pad && (pad.buttons[12]?.pressed || pad.axes[1] < -0.55);
      const down = !!pad && (pad.buttons[13]?.pressed || pad.axes[1] > 0.55);
      const direction: Direction | undefined = left ? "left" : right ? "right" : up ? "up" : down ? "down" : undefined;
      const engaged = !!pad && (!!direction || [0, 1, 3, 4, 5].some((index) => pad.buttons[index]?.pressed));
      // Unlock once per press: a held button must not ask the browser to resume audio on every frame.
      if (engaged && !gamepadUnlockHeld.current) void audio.unlock();
      gamepadUnlockHeld.current = engaged;
      // Y resets only pages with editable settings; Credits and the controller diagram have none.
      const resettable = !panel && screen === "settings" && !!settingsCategory && settingsCategory !== "credits" && settingsCategory !== "input";
      if (pad && time > gamepadInputAt.current) {
        if (direction && (panel || screen !== "play" || left || right)) audio.play("navigate");
        else if (pad.buttons[0]?.pressed && !gamepadConfirmHeld.current) audio.play("select");
        else if (pad.buttons[1]?.pressed && !gamepadBackHeld.current) audio.play("back");
        else if (resettable && pad.buttons[3]?.pressed && !gamepadResetHeld.current) audio.play("confirm");
        else if ((pad.buttons[4]?.pressed || pad.buttons[5]?.pressed) && !gamepadShoulderHeld.current) audio.play("navigate");
        if (panel) {
          if (direction) {
            moveDialogFocus(direction);
            gamepadInputAt.current = time + 230;
          } else if (pad.buttons[0]?.pressed && !gamepadConfirmHeld.current) {
            gamepadConfirmHeld.current = true;
            activateDialogSelection();
            gamepadInputAt.current = time + 350;
          } else if (pad.buttons[1]?.pressed && !gamepadBackHeld.current) {
            gamepadBackHeld.current = true;
            closePanel();
            gamepadInputAt.current = time + 350;
          }
        } else if (direction && (screen !== "play" || left || right)) {
          if (screen === "home") moveHome(direction);
          else if (screen === "legacy") legacyRef.current?.move(direction);
          else if (screen === "showcase") showcaseRef.current?.move(direction);
          else if (screen === "chronicles") chroniclesRef.current?.move(direction);
          else if (screen === "chapters") chaptersRef.current?.move(direction);
          else if (screen === "settings") {
            if (settingsCategory) detailRef.current?.move(direction);
            else moveSettings(direction);
          } else selectCard(selected + (right ? 1 : -1));
          gamepadInputAt.current = time + 230;
        } else if (pad.buttons[0]?.pressed && !gamepadConfirmHeld.current) {
          gamepadConfirmHeld.current = true;
          activateSelected();
          gamepadInputAt.current = time + 350;
        } else if (pad.buttons[1]?.pressed && !gamepadBackHeld.current) {
          gamepadBackHeld.current = true;
          back();
          gamepadInputAt.current = time + 350;
        } else if (pad.buttons[3]?.pressed && !gamepadResetHeld.current && resettable) {
          gamepadResetHeld.current = true;
          detailRef.current?.reset();
          gamepadInputAt.current = time + 350;
        } else if ((pad.buttons[4]?.pressed || pad.buttons[5]?.pressed) && !gamepadShoulderHeld.current) {
          // One tab per press: holding a shoulder button must not lap the tabs (and mount Showcase) every 250 ms.
          gamepadShoulderHeld.current = true;
          if (screen === "legacy") legacyRef.current?.cycle(pad.buttons[5]?.pressed ? 1 : -1);
          else if (screen === "chronicles") chroniclesRef.current?.cycle(pad.buttons[5]?.pressed ? 1 : -1);
          else changeTab(pad.buttons[5]?.pressed ? 1 : -1);
          gamepadInputAt.current = time + 250;
        }
      }
      frame = requestAnimationFrame(poll);
    };
    frame = requestAnimationFrame(poll);
    return () => cancelAnimationFrame(frame);
  }, [gamepadConnected, panel, screen, settingsCategory, selected, activateSelected, back, changeTab, moveHome, moveSettings, selectCard, moveDialogFocus, activateDialogSelection, closePanel, boot.blocking, boot.canContinue, boot.degraded, continueBoot, retryBoot, audio.play, audio.unlock, filmOpen, filmEvent, openingOpen, openingEvent]);

  const detailScreenOpen = screen === "chapters" || screen === "settings" && !!settingsCategory;
  const legacyOpen = screen === "legacy";
  const displayedPanel = panel || lastPanel.current;
  const modalContent = displayedPanel === "settings-reset" ? SETTINGS_RESET_COPY : getModalContent(displayedPanel, chapterPreview);
  const viewKey = screen === "settings" ? `settings:${settingsCategory || "grid"}` : screen === "showcase" ? `showcase:${showcaseView}` : screen;
  // Chronicles and a match draw their own full stage: the sorcerer and the motes
  // pause and hide beneath them, keeping their renderers for the return.
  const stageResting = screen === "chronicles" || screen === "match";
  const stageSuspended = menuSuspended || stageResting || anyFilmOpen || (screen === "showcase" && showcaseView !== "overview");
  // Behind the loading screen, a dialog or a blurred detail page the stage holds
  // its last frame: no WebGL frames and no CSS animation under the blur.
  const stageFrozen = boot.visible || !!panel || detailScreenOpen;

  return (
    <MenuLocaleProvider locale={preferences.locale} onChange={locale => setPreferences(current => ({ ...current, locale }))}>
    <InputPromptContext.Provider value={{ device: inputDevice, bindings: preferences.bindings }}>
    <main
      data-input-kind={inputDevice}
      onClickCapture={(event) => {
        if (screen === "match" || anyFilmOpen || !event.nativeEvent.isTrusted) return;
        const control = event.target instanceof Element ? event.target.closest("button,select,input[type=range]") : null;
        if (!control || control.hasAttribute("data-audio-test")) return;
        const label = control.getAttribute("aria-label") || control.textContent || "";
        audio.play(/^(?:Back|Cancel|Close)/i.test(label.trim()) ? "back" : "select");
      }}
      onKeyDownCapture={(event) => {
        if (screen === "match" || anyFilmOpen || event.defaultPrevented || event.repeat || event.ctrlKey || event.altKey || event.metaKey || boot.blocking) return;
        const target = event.target;
        if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || target instanceof Element && target.closest(".is-capturing")) return;
        const binding = (Object.entries(preferences.bindings) as [BindingAction, string][]).find(([, code]) => code === event.code)?.[0];
        if (binding === "select" && !((event.code === "Enter" || event.code === "Space") && target instanceof HTMLButtonElement)) audio.play("select");
        else if (binding === "back" || event.code === "Escape") audio.play("back");
        else if (binding && binding !== "select") audio.play("navigate");
      }}
      data-audio-state={audio.status?.state || "locked"}
      data-audio-music-playing={audio.status?.musicPlaying || false}
      data-audio-music-state={audio.status?.musicState || "idle"}
      data-audio-track={audio.status?.nowPlaying?.trackId}
      data-audio-track-sequence={audio.status?.nowPlaying?.sequence ?? 0}
      data-audio-master-gain={audio.status?.masterGain ?? 0}
      data-audio-music-gain={audio.status?.musicGain ?? 0}
      data-audio-sfx-gain={audio.status?.sfxGain ?? 0}
      data-settings-saved={preferencesSaved}
      data-credits-film={creditsFilm.phase}
      data-story-prologue={storyProgress.prologue.state}
      data-opening-film={opening.phase}
      data-opening-cut={openingOpen ? opening.cut : undefined}
      data-audio-film-gain={audio.status?.filmGain ?? 0}
      data-boot-state={boot.visible ? boot.leaving ? "leaving" : boot.degraded ? "degraded" : "loading" : "ready"} className={`menu-shell ${preferences.motion ? "" : "reduce-motion"} ${screen === "settings" ? "is-settings" : ""} ${screen === "settings" && settingsCategory ? "settings-detail-open" : ""} ${detailScreenOpen ? "detail-screen-open" : ""} ${legacyOpen ? "legacy-open" : ""} ${preferences.showHints ? "" : "hide-control-hints"}`}>
      <div className="menu-stage">
        <div className="scene-wash" aria-hidden="true" />
        <Atmosphere
          quality={preferences.quality}
          reducedMotion={!preferences.motion}
          renderScale={preferences.renderScale}
          frameLimit={preferences.frameLimit}
          suspended={stageSuspended}
          frozen={stageFrozen}
        />
        <CreatureStage reducedMotion={!preferences.motion} renderScale={preferences.renderScale} frameLimit={preferences.frameLimit} onLoadState={boot.onModelState} loadAttempt={boot.attempt} suspended={stageSuspended} frozen={stageFrozen} placeholder={!boot.blocking} />
        <div className="menu-content" inert={boot.blocking || anyFilmOpen} aria-hidden={boot.blocking || anyFilmOpen || undefined}>
        <nav className={`main-nav${screen === "home" ? " main-nav--home" : stageResting ? " main-nav--hidden" : ""}`} aria-label="Main menu" inert={detailScreenOpen || legacyOpen || stageResting}>
          <button
            className="shoulder-button"
            aria-label={t('Previous menu tab')}
            onClick={() => changeTab(-1)}
          >
            <span><InputPrompt action="previousTab" /></span>
          </button>
          <div className="nav-links" role="tablist" aria-label="Sections">
            <span className="nav-active-indicator" aria-hidden="true" style={{ width: `${[7.5, 6.72, 12.1875, 10.78125][activeTab]}cqw`, transform: `translate3d(${[0, 9.375, 17.97, 32.0325][activeTab]}cqw, 0, 0)` }} />
            {tabs.map((tab, index) => (
              <button
                key={tab.aria}
                role="tab"
                aria-selected={activeTab === index}
                aria-label={t(tab.aria)}
                className={`nav-item ${activeTab === index ? "is-active" : ""}`}
                onClick={() => openTab(index)}
              >
                {t(tab.label)}
              </button>
            ))}
          </div>
          <button
            className="shoulder-button shoulder-next"
            aria-label={t('Next menu tab')}
            onClick={() => changeTab(1)}
          >
            <span><InputPrompt action="nextTab" /></span>
          </button>
        </nav>

        <MenuTransition viewKey={viewKey} reducedMotion={reducedMotion} direction={transitionDirection}>
        {screen === "match" ? (
          <MatchSettingsContext.Provider value={matchSettings}><ShowcaseBoundary key="match" title="The match could not be opened" message="The rest of the menu is available. Reload to try the match again." onBack={() => openTab(1, -1)}><Suspense fallback={<div role="status">Preparing match setup…</div>}><PlayRoute onWatchReplay={watchMatchReplay} mode={playMode} quality={preferences.quality} automaticGraphics={preferences.automaticGraphics} renderScale={preferences.renderScale} frameLimit={preferences.frameLimit} reducedMotion={reducedMotion} onBack={() => openTab(1, -1)} /></Suspense></ShowcaseBoundary></MatchSettingsContext.Provider>
        ) : screen === "legacy" ? null : screen === "home" ? (
          <HomeGrid
            selected={homeSelected}
            onSelect={selectHome}
            onActivate={(_item, index) => activateHome(index)}
            tileRefs={homeRefs}
          />
        ) : screen === "chapters" ? (
          <Chapters ref={chaptersRef} chapters={chapters} newlyUnlocked={chapterJustUnlocked} selected={chapterSelected} onSelect={setChapterSelected} onPreview={previewChapter} onBack={back} reducedMotion={reducedMotion} />
        ) : screen === "showcase" ? (
          <ShowcaseBoundary key="showcase" onBack={back}><Suspense fallback={<div role="status" style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", color: "#cdb98d" }}>Preparing Showcase…</div>}><Showcase replayToOpen={replayToOpen} onReplayOpened={() => setReplayToOpen(null)} ref={showcaseRef} view={showcaseView} onViewChange={changeShowcaseView} onBackRoot={back} reducedMotion={reducedMotion} quality={preferences.quality} automaticGraphics={preferences.automaticGraphics} renderScale={preferences.renderScale} frameLimit={preferences.frameLimit} /></Suspense></ShowcaseBoundary>
        ) : screen === "chronicles" ? (
          <Chronicles ref={chroniclesRef} onBack={back} reducedMotion={reducedMotion} quality={preferences.quality} renderScale={preferences.renderScale} frameLimit={preferences.frameLimit} bindings={preferences.bindings} />
        ) : screen === "settings" ? (
          settingsCategory ? <SettingsDetail
            ref={detailRef}
            category={settingsCategory}
            preferences={preferences}
            preferencesSaved={preferencesSaved}
            audioStatus={audio.status}
            onTestSound={() => { void audio.test(); }}
            onNextTrack={audio.nextTrack}
            onPlayCredits={playCredits}
            onPlayOpening={playOpening}
            creditsStatus={filmOpen || openingOpen ? "" : [creditsFilmStatus(creditsFilm), opening.origin === "credits" ? openingFilmStatus(opening) : ""].filter(Boolean).join(" ")}
            reducedMotion={reducedMotion}
            onRetrySave={retrySave}
            onRequestReset={requestReset}
            onChange={setPreferences}
            onBack={back}
          /> : <SettingsGrid
            selected={settingsSelected}
            onSelect={selectSettings}
            onActivate={activateSettings}
            buttonRefs={settingsRefs}
          />
        ) : (
        <section className="game-cards" aria-label="Play options">
          {cards.map((card, index) => (
            <button
              key={card.id}
              ref={(element) => {
                cardRefs.current[index] = element;
              }}
              type="button"
              tabIndex={selected === index ? 0 : -1}
              className={`game-card card-${card.artwork} ${selected === index ? "is-selected" : ""}`}
              aria-label={t(card.label)}
              aria-pressed={selected === index}
              onPointerMove={(event) => {
                if (
                  event.pointerType === "mouse" &&
                  (event.movementX !== 0 || event.movementY !== 0)
                ) setSelected(index);
              }}
              onFocus={() => setSelected(index)}
              onClick={() => activate(index)}
            >
              <span className="card-art" aria-hidden="true" />
              <span className="card-shade" aria-hidden="true" />
              <span className="card-heading">
                <span className="card-title">{t(card.title)}</span>
                <span className="card-subtitle">{t(card.subtitle)}</span>
              </span>
              <span className="card-description">{t(card.description)}</span>
            </button>
          ))}
        </section>
        )}

        </MenuTransition>

        {legacyMounted && <LegacyLayerView environmentAudioOutput={audio.effectsOutput} ref={legacyRef} active={legacyOpen} reducedMotion={reducedMotion} quality={legacyQuality} onBack={back} onPlay={playFromLegacy} onAudioToastSafetyChange={setLegacyAudioToastSafe} onAudioSuspensionChange={setLegacyAudioPaused} />}

        <NowPlaying status={audio.status} blocked={audioBlocked || !!panel || anyFilmOpen || legacyOpen && !legacyAudioToastSafe} reducedMotion={reducedMotion} surface={legacyOpen ? "legacy" : "menu"} />

        {screen !== "showcase" && screen !== "chapters" && !legacyOpen && !stageResting && !(screen === "settings" && settingsCategory) && <footer className="controller-hints" aria-label="Menu controls">
          <button aria-label={t('Select')} onClick={activateSelected}>
            <span className="controller-key" aria-hidden="true">
              <InputPrompt action="select" />
            </span>
            <span>{t('Select')}</span>
          </button>
          <button aria-label={t('Back')} onClick={back}>
            <span className="controller-key" aria-hidden="true">
              <InputPrompt action="back" />
            </span>
            <span>{t('Back')}</span>
          </button>
        </footer>}
        {(screen === "play" || screen === "chapters") && <p className={`menu-film-notice${filmNotice && !anyFilmOpen ? " is-shown" : ""}`} role="status" aria-live="polite" data-film-notice={filmNotice ? "failed" : undefined}>{anyFilmOpen ? "" : filmNotice}</p>}
        <div className="film-grain" aria-hidden="true" />

        <MenuDialog
          ref={dialog}
          title={modalContent.title}
          description={modalContent.description}
          note={modalContent.note}
          panel={panel || "closed"}
          artwork={chapterPreview?.imageSrc}
          newlyUnlocked={chapterJustUnlocked}
          onConfirm={confirmPanel}
          onCancel={closePanel}
          reducedMotion={reducedMotion}
          defaultCancel={panel === "settings-reset"}
        />
        </div>
        {boot.visible && !openingOpen && <LaunchArtwork leaving={boot.leaving} onContinue={boot.canContinue ? boot.continueToMenu : undefined} />}
      </div>
      {/* Outside the 16:9 stage so the film fills the whole viewport, letterboxed in black. */}
      {filmOpen && <CreditsFilm
        ref={filmRef}
        state={creditsFilm}
        attachAudio={audio.attachFilm}
        onEvent={filmEvent}
        onBack={skipCredits}
        reducedMotion={reducedMotion}
      />}
      {openingOpen && <OpeningFilm
        key={`${opening.cut}:${opening.origin}`}
        ref={openingRef}
        state={opening}
        attachAudio={audio.attachFilm}
        onEvent={openingEvent}
        onSkip={skipOpening}
        reducedMotion={reducedMotion}
      />}
    </main>
    </InputPromptContext.Provider>
    </MenuLocaleProvider>
  );
}
