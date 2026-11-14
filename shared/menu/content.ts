import { CHRONICLES_MAP } from "../chronicles/content";
import type {
  ChapterItem, Direction, HomeContent, HomeDirection, MenuPanel,
  ModalContent, PlayCard, SettingsCategory,
} from "./types";

// Both desktop and Quest consume these exact labels, supplied artwork and
// availability states. Change the common content here rather than copying it.
export const PLAY_CARDS = [
  {
    id: "classic",
    artwork: "new",
    title: "CLASSIC",
    label: "Classic",
    subtitle: "Make your opening move.",
    description: "Traditional chess against the computer.",
    preview: "Classic is available on desktop: choose Eclipse or Violet Night, then play against the computer. Immersive chess is not available in this build.",
  },
  {
    id: "local-duel",
    artwork: "resume",
    title: "LOCAL DUEL",
    label: "Local Duel",
    subtitle: "Share the board.",
    description: "Two players. One device.",
    preview: "Local Duel is available on desktop: choose Eclipse or Violet Night, then share the board with another player on one device. Immersive chess is not available in this build.",
  },
  {
    id: "chapters",
    artwork: "load",
    title: "CHAPTERS",
    label: "Chapters",
    subtitle: "Choose a chapter.",
    description: "Tactical missions and lasting consequences.",
    preview: "Crownfall's campaign chapters are not connected to this menu.",
  },
  {
    id: "online-duel",
    artwork: "browse",
    title: "ONLINE DUEL",
    label: "Online Duel",
    subtitle: "Unavailable in this build.",
    description: "",
    preview: "Online play is unavailable in this build. No matchmaking service is connected.",
  },
] as const satisfies readonly PlayCard[];
export const NAV_TABS = [
  { label: "HOME", panel: null, aria: "Home" },
  { label: "PLAY", panel: null, aria: "Play" },
  { label: "SHOWCASE", panel: null, aria: "Showcase" },
  { label: "SETTINGS", panel: null, aria: "Settings" },
] as const;

// The tall tile occupies both rows. Returning right restores the last right
// tile; outer edges clamp rather than wrapping across an unrelated cell.
export function getNextHomeTile(
  current: number,
  direction: HomeDirection,
  lastRightIndex = 1,
): number {
  if (direction === "left") return 0;
  if (direction === "right")
    return current === 0 ? (lastRightIndex === 2 ? 2 : 1) : current;
  if (direction === "up") return current === 2 ? 1 : current;
  return current === 1 ? 2 : current;
}

// Supplied Home artwork opens implemented destinations; Herald Board remains an information panel.
export const HOME_CONTENT: HomeContent = [
  {
    id: "feature",
    title: "My Legacy",
    imageSrc: "/assets/home/my-legacy.webp",
    action: "legacy",
    destination: "legacy",
  },
  {
    id: "upper",
    title: "Chronicles",
    imageSrc: CHRONICLES_MAP.src,
    imageFit: "contain",
    action: "chronicles",
    destination: "chronicles",
  },
  {
    id: "lower",
    title: "Herald Board",
    imageSrc: "/assets/home/herald-board.webp",
    action: "herald",
  },
];

export const CHAPTER_COLUMNS = 5;
const artwork = ["new", "resume", "load", "browse"] as const;
const positions = ["42% 50%", "53% 50%", "60% 50%", "42% 50%", "75% 45%", "22% 50%", "15% 50%", "78% 50%", "12% 50%", "84% 50%", "36% 50%", "18% 50%", "62% 50%", "65% 50%"];

// Story mode opens with the Prologue, "The Name They Buried": choosing it plays the
// prologue film (shared/menu/opening-film.ts), drawn in the creator's cines-engine;
// its art is a still from that film. Numbered slots stay locked until shared
// story progress reveals Chapter One's Coming soon overview; dedicated artwork can
// replace the supplied environment placeholders.
export const PROLOGUE_CHAPTER: ChapterItem = Object.freeze({
  id: "prologue",
  title: "Prologue",
  imageSrc: "/assets/chapters/prologue.webp",
  imagePosition: "50% 50%",
  previewable: true,
  locked: false,
  film: "prologue",
});
export const CHAPTERS: readonly ChapterItem[] = [PROLOGUE_CHAPTER, ...Array.from({ length: 14 }, (_, index) => ({
  id: `chapter-${String(index + 1).padStart(2, "0")}`,
  title: `Chapter ${String(index + 1).padStart(2, "0")}`,
  imageSrc: `/assets/environments/card-${artwork[index % artwork.length]}.webp`,
  imagePosition: positions[index],
  previewable: false,
  locked: true,
  ...(index === 0 ? { subtitle: "The Pawn Who Would Not Die" } : {}),
}))];

export function getNextChapter(index: number, direction: Direction, preferredColumn = index % CHAPTER_COLUMNS): number {
  const current = Math.max(0, Math.min(CHAPTERS.length - 1, index));
  const row = Math.floor(current / CHAPTER_COLUMNS);
  if (direction === "left" || direction === "right") {
    const first = row * CHAPTER_COLUMNS;
    const last = Math.min(first + CHAPTER_COLUMNS - 1, CHAPTERS.length - 1);
    return Math.max(first, Math.min(last, current + (direction === "left" ? -1 : 1)));
  }
  const lastRow = Math.floor((CHAPTERS.length - 1) / CHAPTER_COLUMNS);
  const nextRow = Math.max(0, Math.min(lastRow, row + (direction === "up" ? -1 : 1)));
  return Math.min(nextRow * CHAPTER_COLUMNS + preferredColumn, CHAPTERS.length - 1);
}

export const SHOWCASE_CATEGORIES = [
  { id: "battles", title: "AI BATTLES", label: "AI Battles", status: "Live exhibition", description: "Watch the board come alive.", art: "/assets/environments/card-new.webp" },
  { id: "arenas", title: "ARENAS", label: "Arenas", status: "Match environments", description: "Choose the setting for every move.", art: "/assets/environments/card-browse.webp" },
  { id: "replays", title: "MATCH REPLAYS", label: "Match Replays", status: "Saved on this device", description: "Return to the turning point.", art: "" },
] as const;
export const ARENAS = [
  { label: "Arena 01", source: "/assets/environments/card-new.webp", alt: "Luminous ruined landscape with a ferris wheel" },
  { label: "Arena 02", source: "/assets/environments/card-resume.webp", alt: "Blue gateway and floating architecture" },
  { label: "Arena 03", source: "/assets/environments/card-load.webp", alt: "Timber bridges and distant arches" },
  { label: "Arena 04", source: "/assets/environments/card-browse.webp", alt: "Crystal cliffs, dragons and towers" },
];


// The parent uses this order for keyboard/controller and hand-accessible views.
export const SETTINGS_CATEGORIES = ["general", "controls", "input", "video", "audio", "credits"] as const satisfies readonly SettingsCategory[];

export function getModalContent(
  panel: MenuPanel,
  chapter?: Pick<ChapterItem, "title" | "subtitle" | "status"> | null,
): ModalContent {
  const mode = PLAY_CARDS.find((item) => item.id === panel);
  if (mode) return { title: mode.label, description: mode.preview, note: "Menu preview only. No gameplay will start here." };
  if (panel === "chapter-preview" && chapter?.status === "coming-soon") return {
    title: chapter.title,
    description: chapter.subtitle || chapter.title,
    note: "Coming soon",
  };
  if (panel === "chapter-preview" && chapter) return {
    title: chapter.title,
    description: "Chapter gameplay is not connected in this build.",
    note: "This is a chapter-selection preview. Campaign progress and unlocks are not recorded.",
  };
  if (panel === "quit") return { title: "Return to Home?", description: "Your menu preferences stay on this device." };
  const home = HOME_CONTENT.find((item) => item.action === panel);
  return {
    title: home?.title || "Crownfall",
    description: home?.destination ? "" : panel === "legacy" ? "Legacy profiles are unavailable in this build." : "The herald board is unavailable in this build.",
  };
}
