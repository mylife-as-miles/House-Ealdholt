import { ARMY_KINGDOMS, type ArmyId, type GamePortSetting, type MatchConfig, type PlayMode } from "./match";

/** Captures of the actual game renderer, shared by desktop and Quest selection. */
export const BATTLEFIELD_PREVIEWS: Readonly<Record<GamePortSetting, { preview: string; overview: string }>> = {
  "scene-01": { preview: "/assets/play/scene-01-selection.webp", overview: "/assets/play/scene-01-overview.webp" },
  "scene-02": { preview: "/assets/play/scene-02-selection.webp", overview: "/assets/play/scene-02-overview.webp" },
};

/** Presentation of the existing match options; this does not add game rules. */
export const MATCH_SETUP_MODES: Record<PlayMode, { title: string; eyebrow: string; description: string }> = {
  classic: { title: "Classic", eyebrow: "Player versus computer", description: "Choose the ground. Set the terms. Make your opening move." },
  "local-duel": { title: "Local Duel", eyebrow: "Two players · one device", description: "One board. Two opponents. An opening of your own." },
};

export const MATCH_CLOCK_CHOICES: readonly { value: number | null; label: string; short: string; detail: string }[] = [
  { value: null, label: "No clock", short: "∞", detail: "Untimed" },
  { value: 5, label: "5 minutes each", short: "5", detail: "min each" },
  { value: 10, label: "10 minutes each", short: "10", detail: "min each" },
  { value: 15, label: "15 minutes each", short: "15", detail: "min each" },
];

export const MATCH_STRENGTH_CHOICES: readonly { value: MatchConfig["difficulty"]; label: string }[] = [
  { value: "easy", label: "Easy" },
  { value: "medium", label: "Medium" },
  { value: "hard", label: "Hard" },
];

/** Classic: you always lead Aethelgard; this picks who opens. */
export const MATCH_SIDE_CHOICES = [
  { value: "w", label: "First move", detail: "You open the game" },
  { value: "b", label: "Second move", detail: "The computer opens" },
] as const;

/** What each army fights with, for the pickers. */
export const ARMY_DETAILS: Readonly<Record<ArmyId, string>> = {
  ivory: "Swords, shields and witchfire",
  sun: "Sunblades, ash spears and furnace fire",
  empire: "Muskets, rifles and cannon",
  kwind: "Arc-tech, shock pikes and steam",
};

/** Every army a duel may field, in picker order. */
export const MATCH_ARMY_CHOICES: readonly { value: ArmyId; label: string; detail: string }[] =
  (["ivory", "sun", "empire", "kwind"] as const).map((value) => ({ value, label: ARMY_KINGDOMS[value], detail: ARMY_DETAILS[value] }));

/** Classic: the kingdoms the computer may field against your Aethelgard. */
export const MATCH_RIVAL_CHOICES = MATCH_ARMY_CHOICES.filter((choice) => choice.value !== "ivory");

export function matchClockLabel(minutes: number | null): string {
  return minutes === null ? "No clock" : `${minutes} min each`;
}
