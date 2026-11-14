import { describe, expect, it } from "vitest";
import { approachOf, directRankDuel, rankCombatant, RANK_ARCHETYPES, RANK_CATALOG, RANK_LIBRARY_CLIPS, type RankDuelMove } from "./rankDuel";
import { missingClips, neededClips } from "./pawnDuel";
import type { Kingdom } from "./choreography";
import { withCombatRecord } from "./record";
import type { CombatPlan } from "./director";

const move = (over: Partial<RankDuelMove>): RankDuelMove => ({
  color: "b", from: "e8", to: "e4", victim: "e4", attacker: "r", defender: "n",
  armies: { w: "ivory", b: "sun" }, sanMoves: ["e4", "e5", "Rxe4"], ...over,
});
const plan = (over: Partial<RankDuelMove>): CombatPlan => {
  const duel = directRankDuel(move(over));
  if (!duel || duel.direction.kind !== "sequence") throw new Error(`no fight: ${duel?.direction.kind === "fallback" ? duel.direction.reason : "not a rank capture"}`);
  return duel.direction;
};

describe("rank duels", () => {
  it("builds a valid catalog of fights for every way of coming in", () => {
    const ids = RANK_CATALOG.map(sequence => sequence.id);
    expect(ids).toContain("rank.parried");
    for (const kind of ["n", "r", "k"]) for (const family of ["through-guard", "flank", "behind"]) expect(ids).toContain(`rank.${family}.${kind}`);
    expect(RANK_CATALOG.every(sequence => sequence.animationLibrary === "crownfall-rank-combat-1")).toBe(true);
    expect(RANK_CATALOG.some(sequence => sequence.fits.defender.includes("k"))).toBe(false);
  });

  it("reads the way in from the defender's own front: White faces the eighth rank, Black the first", () => {
    expect(approachOf({ from: "e8", to: "e4" }, "w")).toBe("front");
    expect(approachOf({ from: "a4", to: "e4" }, "w")).toBe("side");
    expect(approachOf({ from: "e1", to: "e4" }, "w")).toBe("back");
    expect(approachOf({ from: "e1", to: "e5" }, "b")).toBe("front");
    expect(approachOf({ from: "h5", to: "e5" }, "b")).toBe("side");
    expect(approachOf({ from: "e8", to: "e5" }, "b")).toBe("back");
    // A Knight's jump: two ranks ahead and one across is in front, one rank and two across is the flank.
    expect(approachOf({ from: "f6", to: "e4" }, "w")).toBe("front");
    expect(approachOf({ from: "g5", to: "e4" }, "w")).toBe("side");
    expect(approachOf({ from: "f2", to: "e4" }, "w")).toBe("back");
  });

  it("stages only Knights, Rooks and Kings taking a Knight or a Rook, on rigs that have a rank library", () => {
    expect(directRankDuel(move({ attacker: "p" }))).toBeUndefined();
    expect(directRankDuel(move({ defender: "p" }))).toBeUndefined();
    expect(directRankDuel(move({ attacker: "q" }))).toBeUndefined();
    expect(directRankDuel(move({ defender: "b" }))).toBeUndefined();
    // Korvenia's Rook fights with powder: no rank library, today's cinematic.
    expect(directRankDuel(move({ armies: { w: "ivory", b: "empire" } }))).toBeUndefined();
    expect(rankCombatant("b", "empire", "n")?.clips).toContain("attack.strike");
    expect(rankCombatant("b", "empire", "r")).toBeNull();
  });

  it("chooses the fight by the way the attacker comes in", () => {
    expect(plan({}).sequenceId).toBe("rank.through-guard.r");
    expect(plan({ from: "a4" }).sequenceId).toBe("rank.flank.r");
    expect(plan({ from: "e1" }).sequenceId).toBe("rank.behind.r");
    // The Charged Slash's two swings: the forehand is parried, the backhand kills.
    expect(plan({ attacker: "n", from: "f6" }).sequenceId).toBe("rank.parried");
    // Kwind-09's courier kicks once: the guard he meets is broken through.
    expect(plan({ attacker: "n", from: "f6", armies: { w: "ivory", b: "kwind" } }).sequenceId).toBe("rank.through-guard.n");
    expect(plan({ attacker: "k", from: "e5", sanMoves: ["e4", "Kxe4"] }).sequenceId).toBe("rank.through-guard.k");
  });

  it("asks each rig only for the clips it holds, and the procedural guard and hit where it has none", () => {
    // The Aethelgard Knight's library holds the guard and the hits moved from the Solforiz Knight's purchase.
    const knight = plan({});
    expect(knight.defender.find(cue => cue.do === "clip" && cue.clip.role === "block")).toMatchObject({ clip: { prefer: ["defend.block"] } });
    expect(knight.resolution.hit.prefer).toEqual(["hit.front"]);
    expect(knight.resolution.death.prefer).toEqual(["death.backward", "death.forward"]);
    // A Rook's own library has no guard or hit yet: they fall back to the procedural ones.
    const rook = plan({ defender: "r" });
    const guard = rook.defender.find(cue => cue.do === "clip" && cue.clip.role === "block");
    expect(guard && guard.do === "clip" ? guard.clip.prefer : null).toEqual([]);
    expect(rook.resolution.hit.prefer).toEqual([]);
    expect(rook.resolution.death.prefer).toEqual(["death.backward"]);
    expect(neededClips(rook)).toEqual({ attacker: ["attack.strike"], defender: ["death.backward"] });
  });

  it("gives the Kwind-09 courier his kick's run-up from the flank and from behind, and the slashing Knights theirs", () => {
    const kwind = { w: "ivory", b: "kwind" } as const;
    expect(plan({ attacker: "n", from: "g5", armies: kwind }).sequenceId).toBe("rank.flank.n-kick");
    expect(plan({ attacker: "n", from: "f2", armies: kwind }).sequenceId).toBe("rank.behind.n-kick");
    expect(plan({ attacker: "n", from: "g5" }).sequenceId).toBe("rank.flank.n");
    expect(plan({ attacker: "n", from: "f2" }).sequenceId).toBe("rank.behind.n");
  });

  it("stages every pairing of rigs that both have a rank library, from every side, with only the clips they hold", () => {
    const kingdoms: Kingdom[] = ["ivory", "sun", "empire", "kwind"];
    const ways = { front: "e8", side: "a4", back: "e1" } as const;
    let fought = 0;
    for (const attackerKingdom of kingdoms) for (const defenderKingdom of kingdoms) for (const attacker of ["n", "r", "k"] as const)
      for (const defender of ["n", "r"] as const) for (const [way, from] of Object.entries(ways)) {
        const library = { a: RANK_ARCHETYPES[attackerKingdom][attacker], d: RANK_ARCHETYPES[defenderKingdom][defender] };
        // A Knight comes in on a Knight's jump, the others along the line.
        const start = attacker === "n" ? { front: "f6", side: "g5", back: "f2" }[way as keyof typeof ways] : from;
        const duel = directRankDuel(move({ attacker, defender, from: start, armies: { w: defenderKingdom, b: attackerKingdom } }));
        if (!library.a || !library.d) { expect(duel).toBeUndefined(); continue; }
        expect(duel?.direction.kind, `${library.a} takes ${library.d} from the ${way}`).toBe("sequence");
        if (duel?.direction.kind !== "sequence") continue;
        const holds = (archetype: string) => (id: string) => RANK_LIBRARY_CLIPS[archetype].includes(id);
        expect(missingClips(duel.direction, { attacker: holds(library.a), defender: holds(library.d) })).toBeNull();
        fought += 1;
      }
    expect(fought).toBeGreaterThan(100);
  });

  it("is refused by the stage, for today's cinematic, when a rig's rank library did not load", () => {
    // The engine asks the real rigs (sceneEngine.ts playDirectedCombat): a figure with no rank library holds nothing.
    const fight = plan({});
    expect(missingClips(fight, { attacker: () => false, defender: () => true })).toBe("attacker lacks attack.strike");
    expect(missingClips(fight, { attacker: () => true, defender: () => false })).toBe("defender lacks hit.front");
  });

  it("is the same fight again after an Undo, and replays from the record the move carries", () => {
    const first = plan({ from: "a4" }), again = plan({ from: "a4" });
    expect(again).toEqual(first);
    const replayed = plan({ from: "a4", sanMoves: ["d4"], comment: withCombatRecord(null, first.record) });
    expect(replayed.sequenceId).toBe(first.sequenceId);
    expect(replayed.geometry.side).toBe(first.geometry.side);
  });
});
