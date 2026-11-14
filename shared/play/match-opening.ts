/**
 * What is shown before a match's first move (the creator's direction of 11 November 2026: a short in-engine opening
 * that changes with the two kingdoms and can always be skipped):
 *
 *   arena     the battlefield from high up, the board bare, and its name
 *   white     White's army takes the field along its ranks, under its kingdom's name and flag
 *   black     then Black's
 *   versus    the two armies across the board from the side, the player's (or player one's) on the left
 *   begin     the camera comes round to where the match is played from
 *
 * A rematch plays only the last two. This file decides the shots and the words; the scene engine moves the camera
 * (web/src/scene/matchOpening.ts) and the match screen shows the cards (main game/src/play/MatchOpening.tsx).
 * Positions are in the board's own units: a square is 1.02 across, White's back rank stands at z = +3.57 and Black's
 * at z = -3.57, the a-file at x = -3.57.
 */
import type { OpeningShot } from "../../web/src/scene/matchOpening";
import { ARMY_KINGDOMS, BATTLEFIELDS, matchArmies, type ArmyId, type MatchConfig } from "./match";
import { ARMY_DETAILS } from "./setup";

export type MatchOpeningCut = "full" | "short";
export type MatchOpeningBeatId = "arena" | "white" | "black" | "versus" | "begin";
export interface MatchOpeningKingdom {
  side: "w" | "b";
  army: ArmyId;
  name: string;
  /** What it fights with (the setup screen's line). */
  detail: string;
  /** Who leads it in this match. */
  role: "You" | "Computer" | "Player 1" | "Player 2";
}
export interface MatchOpeningBeat {
  id: MatchOpeningBeatId;
  shot: OpeningShot;
  /** When the beat starts, in seconds from the opening's start. */
  at: number;
}
export interface MatchOpeningPlan {
  cut: MatchOpeningCut;
  beats: readonly MatchOpeningBeat[];
  shots: readonly OpeningShot[];
  seconds: number;
  /** The camera the match is played from, where the opening ends. */
  preset: "white" | "black";
  battlefield: { title: string; description: string };
  /** The mode's name, shown over the battlefield's. */
  mode: "Classic" | "Local Duel" | "AI Battle";
  kingdoms: Record<"w" | "b", MatchOpeningKingdom>;
  /** The side shown on the left of the versus shot: the player's, or player one's. */
  left: "w" | "b";
}

const RANK = 3.57;

/**
 * An army taking the field. It assembles from both flanks toward its King and Queen; the camera, low before the Pawns,
 * starts off one flank looking down the ranks and comes in to stand before the two of them as they form.
 */
function musterShot(side: "w" | "b", seconds: number): OpeningShot {
  const z = side === "w" ? 1 : -1;
  // White's army is seen against the arena's dark end, and its frames came out at about a tenth to a sixth of full
  // brightness on Violet Night; Black's is seen against the bright sky. Each is lifted a little for its shot.
  const exposure = side === "w" ? 1.45 : 1.12;
  return {
    from: { position: [5.6, 1.05, 0.2 * z], target: [1.6, 0.9, (RANK - 0.27) * z], fov: 40, exposure },
    // Aimed a little past them, so they stand to one side of the picture and their kingdom's name to the other. It
    // ends far enough back that the Queen is not cut by the edge of a 4:3 screen, nor the King covered by the name on
    // one of 16:10, and a little above their waists, so they are seen down to the squares they stand on.
    to: { position: [1.65, 1.08, -0.5 * z], target: [1.1, 1.0, RANK * z], fov: 40, exposure },
    seconds, ease: "in-out", focus: 4.4,
    // The wave ends with the King and Queen standing whole, three quarters of a second before the cut.
    muster: { side, from: "flanks", start: 0.02, end: 0.72 },
  };
}

export function buildMatchOpening(config: Pick<MatchConfig, "mode" | "setting" | "playerColor" | "armies">, cut: MatchOpeningCut = "full"): MatchOpeningPlan {
  const armies = matchArmies(config);
  const preset: "white" | "black" = config.mode === "classic" && config.playerColor === "b" ? "black" : "white";
  const near = preset === "white" ? 1 : -1;
  const role = (side: "w" | "b"): MatchOpeningKingdom["role"] => config.mode === "classic" ? (side === config.playerColor ? "You" : "Computer") : side === "w" ? "Player 1" : "Player 2";
  const kingdom = (side: "w" | "b"): MatchOpeningKingdom => ({ side, army: armies[side], name: ARMY_KINGDOMS[armies[side]], detail: ARMY_DETAILS[armies[side]], role: role(side) });
  const field = BATTLEFIELDS.find((entry) => entry.id === config.setting) ?? BATTLEFIELDS[0];

  // From the side, a little above the Kings' crowns, the two armies facing each other across the board. Far enough out
  // that both stand whole on a wide screen and on a 4:3 one (any nearer, the corner figures are cut off even at 16:9),
  // and high enough that the front ranks do not hide the rest and the squares are not seen at a glancing angle. The
  // camera at +x puts White on the left, so it stands on the player's right hand: their army is the one on the left.
  const versus: OpeningShot = {
    from: { position: [10.8 * near, 3.0, 0.8 * near], target: [0.2 * near, 0.6, 0], fov: 50 },
    to: { position: [9.8 * near, 2.6, 0], target: [0.2 * near, 0.6, 0], fov: 50 },
    seconds: cut === "full" ? 1.9 : 2.2, ease: "out", focus: 9.6,
  };
  const begin: OpeningShot = { from: versus.to as OpeningShot["from"], to: "rest", seconds: 1.6, ease: "in-out", path: "orbit" };
  const list: [MatchOpeningBeatId, OpeningShot][] = cut === "short" ? [["versus", versus], ["begin", begin]] : [
    // Always from White's end, whoever plays from it: that way lies the sky the battlefield is named for. From this far
    // back the eclipse (and on Violet Night the ring of light round it) stands whole under the letterbox all the way
    // in, risen over the skull, and the board keeps to the right of the middle, so the battlefield's name has the dark
    // ground to its left.
    ["arena", {
      from: { position: [-7.8, 5.8, 25.5], target: [-5.3, 5.6, -5], fov: 46 },
      to: { position: [-6.4, 4.6, 19.5], target: [-4.5, 5.0, -5], fov: 48 },
      seconds: 2.6, ease: "out",
    }],
    ["white", musterShot("w", 2.6)],
    ["black", musterShot("b", 2.6)],
    ["versus", versus],
    ["begin", begin],
  ];
  let at = 0;
  const beats = list.map(([id, shot]) => { const beat = { id, shot, at }; at += shot.seconds; return beat; });
  return {
    cut, beats, shots: beats.map((beat) => beat.shot), seconds: at, preset,
    battlefield: { title: field.subtitle, description: field.description },
    mode: config.mode === "classic" ? "Classic" : config.mode === "local-duel" ? "Local Duel" : "AI Battle",
    kingdoms: { w: kingdom("w"), b: kingdom("b") },
    left: preset === "white" ? "w" : "b",
  };
}
