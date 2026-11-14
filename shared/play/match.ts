import type { ArmySkinId } from "../../web/src/assets/generated";
import type { StartOptions } from "../../web/src/core/gameController";

export type PlayMode = "classic" | "local-duel";
export type GamePortSetting = "scene-01" | "scene-02";
export interface MatchConfig {
  /** Supplied only by a Legacy-aware launch; never inferred for local or spectator games. */
  legacy?: import("../../web/src/legacy/musterBridge").MusterMatchSetup;
  mode: PlayMode | "ai-battle";
  setting: GamePortSetting;
  difficulty: "easy" | "medium" | "hard";
  playerColor: "w" | "b";
  clockMinutes: number | null;
  /** The army each side fields; omitted by older saved configs, see {@link matchArmies}. */
  armies?: MatchArmies;
}

export type ArmyId = ArmySkinId;
export type MatchArmies = Record<"w" | "b", ArmyId>;

/** The kingdom that fields each army. A side is called by its kingdom's name (kept equal to ARMY_SKINS' labels). */
export const ARMY_KINGDOMS: Readonly<Record<ArmyId, string>> = { ivory: "Aethelgard", sun: "Solforiz", empire: "Korvenia", kwind: "Kwind-09" };
/** In Classic the player always leads Aethelgard; the computer fields one of the other kingdoms. */
export const CLASSIC_PLAYER_ARMY: ArmyId = "ivory";
export const DEFAULT_MATCH_ARMIES: Readonly<MatchArmies> = { w: "ivory", b: "sun" };

/**
 * Who fields what. Classic: the player's side is Aethelgard and the computer's is the chosen rival (Solforiz unless
 * another kingdom was picked). A duel or an AI battle uses its two picks, which must be different kingdoms.
 */
export function matchArmies(config: Pick<MatchConfig, "mode" | "playerColor" | "armies">): MatchArmies {
  if (config.mode === "classic") {
    const computer = config.playerColor === "w" ? "b" : "w";
    const pick = config.armies?.[computer];
    const rival: ArmyId = pick && pick !== CLASSIC_PLAYER_ARMY ? pick : "sun";
    return config.playerColor === "w" ? { w: CLASSIC_PLAYER_ARMY, b: rival } : { w: rival, b: CLASSIC_PLAYER_ARMY };
  }
  const armies = config.armies;
  return armies && armies.w !== armies.b ? { w: armies.w, b: armies.b } : { ...DEFAULT_MATCH_ARMIES };
}

/** What a side is called in this match: its kingdom. */
export function sideName(config: Pick<MatchConfig, "mode" | "playerColor" | "armies">, side: "w" | "b"): string {
  return ARMY_KINGDOMS[matchArmies(config)[side]];
}
export const BATTLEFIELDS = [
  { id: "scene-01", title: "Setting 1", subtitle: "Eclipse", description: "The ritual arena beneath a warm eclipse." },
  { id: "scene-02", title: "Setting 2", subtitle: "Violet Night", description: "The ritual arena beneath a violet night sky." },
] as const;

export function matchOptions(config: MatchConfig): StartOptions {
  return {
    mode: config.mode === "ai-battle" ? "demo" : config.mode === "classic" ? "ai" : "hotseat",
    difficulty: config.difficulty,
    playerColor: config.playerColor,
    clockMinutes: config.clockMinutes,
    ...(config.mode === "ai-battle" ? { demo: { white: config.difficulty, black: config.difficulty, speed: 1, autoRematch: false } } : {}),
  };
}
