import { describe, expect, it } from "vitest";
import { Chess } from "chess.js";
import { GameController } from "./gameController";
import { recordFromPGN } from "../../../shared/showcase/records";
import type { MoveEvent } from "./types";
import { COMBAT_LIBRARY_VERSION, PAWN_ATTACKS, PAWN_DEFENSES, PAWN_HITS, PAWN_DEATHS, combatComment, type CombatSequence } from "../../../shared/play/combat-sequences";
import { combatRecordFromComment } from "../scene/combat/record";
import { planFromRecord } from "../scene/combat/director";
import { pawnDuelInput } from "../scene/combat/pawnDuel";


describe("Pawn choreography recorded with legal moves", () => {
  it("keeps the same chess result while recording the selected compatible sequence for replay", async () => {
    const game = new GameController(), events: MoveEvent[] = [], reference = new Chess();
    game.on("move", event => events.push(event));
    game.start({ mode: "hotseat", difficulty: "easy", playerColor: "w", clockMinutes: null });
    for (const [from, to] of [["e2", "e4"], ["d7", "d5"], ["e4", "d5"]]) {
      expect(await game.tryMove(from, to)).toBe(true); reference.move({ from, to });
    }
    const snapshot = game.getSnapshot(), choice = events[2].choreography, plan = events[2].combat;
    expect(choice).toBeDefined(); expect(snapshot.fen).toBe(reference.fen());
    expect(plan?.kind).toBe("sequence"); expect(plan!.record).toMatch(/^\[%cfcombat 2 pawn\./);
    expect(snapshot.moves[2].choreography).toEqual(choice); expect(snapshot.pgn).toContain(plan!.record);
    expect(combatRecordFromComment(snapshot.pgn)?.sequence).toBe(plan!.sequenceId);
    const replay = recordFromPGN(snapshot.pgn);
    // The frame-only showcase retains the PGN but cannot reinterpret v2 as a
    // v1 tuple. A director-capable reader rebuilds the precise recorded plan.
    expect(replay.frames[3].move?.choreography).toBeUndefined();
    const restored = recordFromPGN(replay.pgn);
    expect(restored.frames[3].move?.choreography).toBeUndefined();
    expect(restored.pgn).toContain(plan!.record);
    const input = pawnDuelInput({ color: "w", from: "e4", to: "d5", victim: "d5", armies: { w: "ivory", b: "sun" }, sanMoves: snapshot.sanList });
    expect(planFromRecord(plan!.record, input)).toEqual(plan);
    expect(replay.frames[3].pieces.some(piece => piece.color === "b" && piece.square === "d5")).toBe(false);
    expect(game.undo()).toBe(true); expect(game.getSnapshot().moves).toHaveLength(2);
    expect(game.getSnapshot().pgn).not.toContain("[%cfcombat");
    expect(await game.tryMove("e4", "d5")).toBe(true); expect(game.getSnapshot().moves[2].choreography).toEqual(choice);
    expect(events[3].combat).toEqual(plan); expect(game.getSnapshot().pgn).toContain(plan!.record);
    game.dispose();
  });

  it("varies three real Pawn captures while preserving every legal capture and its recorded pairing", async () => {
    const game = new GameController(), captures: MoveEvent[] = [];
    game.on("move", event => { if (event.capture) captures.push(event); });
    game.start({ mode: "hotseat", difficulty: "easy", playerColor: "w", clockMinutes: null,
      startingFen: "7k/8/8/2p1p1p1/1P1P1P2/8/8/K7 w - - 0 1" });
    for (const [from, to] of [["b4", "c5"], ["h8", "g8"], ["d4", "e5"], ["g8", "h8"], ["f4", "g5"]]) expect(await game.tryMove(from, to)).toBe(true);
    expect(new Set(captures.map(event => event.choreography?.attack)).size).toBe(3);
    for (const square of ["c5", "e5", "g5"]) expect(game.pieceAt(square)).toEqual({ color: "w", kind: "p" });
    const replay = recordFromPGN(game.getSnapshot().pgn);
    expect([...replay.pgn.matchAll(/\[%cfcombat [^\]]+\]/g)].map(match => match[0])).toEqual(captures.map(event => event.combat!.record));
    expect(replay.frames.some(frame => frame.move?.choreography)).toBe(false);
    game.dispose();
  });

  it("retains genuine v1 records and their original clip profile through PGN save and reload", () => {
    for (const [index, attack] of PAWN_ATTACKS.entries()) {
      const choice: CombatSequence = { version: 1, library: COMBAT_LIBRARY_VERSION, attack,
        defense: PAWN_DEFENSES[index], hit: PAWN_HITS[index], death: PAWN_DEATHS[index] };
      const token = combatComment(choice), pgn = `1. e4 d5 2. exd5 {${token}} *`;
      const replay = recordFromPGN(pgn), restored = recordFromPGN(replay.pgn);
      expect(replay.frames[3].move?.choreography).toEqual(choice);
      expect(restored.frames[3].move?.choreography).toEqual(choice);
      expect(restored.pgn).toContain(token);
      const input = pawnDuelInput({ color: "w", from: "e4", to: "d5", victim: "d5", armies: { w: "ivory", b: "sun" }, sanMoves: replay.moves });
      const plan = planFromRecord(token, input);
      expect(plan.kind).toBe("sequence");
      if (plan.kind !== "sequence") throw Error("A retained v1 record must be playable");
      expect(plan.animationLibrary).toBe(COMBAT_LIBRARY_VERSION); expect(plan.record).toBe(token);
    }
  });

  it("keeps en passant's defender square distinct from the attacker's destination", async () => {
    const game = new GameController(), events: MoveEvent[] = [];
    game.on("move", event => events.push(event));
    game.start({ mode: "hotseat", difficulty: "easy", playerColor: "w", clockMinutes: null });
    for (const [from, to] of [["e2", "e4"], ["a7", "a6"], ["e4", "e5"], ["d7", "d5"], ["e5", "d6"]]) expect(await game.tryMove(from, to)).toBe(true);
    expect(events[4].capture?.square).toBe("d5"); expect(events[4].to).toBe("d6");
    expect(events[4].choreography).toBeDefined(); expect(game.pieceAt("d5")).toBeNull();
    game.dispose();
  });
});
