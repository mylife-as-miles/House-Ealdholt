import { describe, expect, it } from "vitest";
import { Chess } from "chess.js";
import { boardRoyalThreat } from "./boardRoyalState";

describe("royal reactions use real chess threats", () => {
  it("uses legal attackers, including double check, rather than the last moving piece", () => {
    const fen = "4k3/8/8/1B6/8/8/8/4R1K1 b - - 0 1";
    const threat = boardRoyalThreat(fen, [{ color: "w", check: true }, { color: "b", check: true }, { color: "w", check: true }])!;
    expect(threat.kingSquare).toBe("e8"); expect(threat.attackers).toEqual(["b5", "e1"]);
    expect(threat.checks).toBe(2); expect(threat.mate).toBe(false);
  });
  it("identifies Fool's Mate while keeping both Kings and the complete position unchanged", () => {
    const game = new Chess(); for (const move of ["f3", "e5", "g4", "Qh4#"]) game.move(move);
    const fen = game.fen(), threat = boardRoyalThreat(fen, [{ color: "b", check: true }])!;
    expect(threat.color).toBe("w"); expect(threat.kingSquare).toBe("e1"); expect(threat.attackers).toEqual(["h4"]); expect(threat.mate).toBe(true);
    expect(game.fen()).toBe(fen); expect(game.get("e1").type).toBe("k"); expect(game.get("e8").type).toBe("k");
    game.undo(); expect(boardRoyalThreat(game.fen(), [])).toBeNull();
  });
  it("keeps a normal opening and a stalemate free of checkmate reactions", () => {
    expect(boardRoyalThreat(new Chess().fen(), [])).toBeNull();
    const draw = new Chess("7k/5K2/6Q1/8/8/8/8/8 b - - 0 1");
    expect(draw.isStalemate()).toBe(true); expect(boardRoyalThreat(draw.fen(), [])).toBeNull();
  });
});
