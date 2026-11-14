import { describe, expect, it } from "vitest";
import { BoardReactionDirector, boardLineOfSight, type BoardObserver, type BoardReactionEvent } from "./boardReactionDirector";
import type { Faction, PieceKind } from "../core/types";

function actor(square: string, kind: PieceKind = "p", color: Faction = "b"): BoardObserver {
  return { id: `${color}-${square}`, square, kind, color, point: { x: square.charCodeAt(0)-97, y: 0, z: Number(square[1])-1 } };
}
const impact: BoardReactionEvent = { id: "capture-1", type: "capture-impact", point: { x: 3, y: 0, z: 4 }, victimColor: "b" };

describe("visual-only board reaction policy", () => {
  it("prioritizes nearby witnesses, excludes the duel and leaves distant soldiers alone", () => {
    const nearby = actor("c4"), primary = actor("e5"), far = actor("h1"), director = new BoardReactionDirector("high");
    const plan = director.plan({ ...impact, primary: [primary.id] }, [nearby, primary, far]);
    expect(plan.reactions.map(item => item.id)).toEqual([nearby.id]);
    expect(plan.reactions[0].cue.pose).toBe("flinch");
  });

  it("gives the same loss different Pawn, Queen and opposing-army responses", () => {
    const pawn = actor("c4"), queen = actor("f5", "q"), enemy = actor("e3", "p", "w");
    const plan = new BoardReactionDirector("high").plan(impact, [pawn, queen, enemy]);
    const cues = new Map(plan.reactions.map(row => [row.id, row.cue]));
    expect(cues.get(pawn.id)!.flinch).toBeGreaterThan(cues.get(enemy.id)!.flinch);
    expect(cues.get(queen.id)!.flinch).toBe(0);
    expect(cues.get(queen.id)!.duration).toBeGreaterThan(cues.get(pawn.id)!.duration);
    expect(cues.get(queen.id)!.pose).toBe("watch");
  });

  it("uses standing pieces as occluders and ignores the active endpoint actors", () => {
    const observer = actor("a1"), blocker = actor("a3"), target = actor("a5");
    expect(boardLineOfSight(observer, target.point, [observer, blocker, target], new Set())).toBe(false);
    expect(boardLineOfSight(observer, target.point, [observer, blocker, target], new Set([blocker.id]))).toBe(true);
  });

  it("caps simultaneous reactions across several events; Low uses only heads, except for a killing", () => {
    const roster = [actor("c4"), actor("f5", "q"), actor("e6", "n"), actor("c6", "r"), actor("b5", "b"), actor("d3", "k"), actor("e4", "p", "w")];
    for (const quality of ["low", "medium", "high", "ultra"] as const) {
      const director = new BoardReactionDirector(quality);
      for (const type of ["move-started", "capture-impact", "ally-fallen"] as const) {
        const plan = director.plan({ ...impact, type, id: type }, roster);
        expect(director.activeCount).toBeLessThanOrEqual(director.budget);
        // A killing a few squares away moves the whole body on every preset; a move only turns heads on Low.
        if (quality === "low") expect(plan.reactions.every(item => item.cue.headOnly === (type === "move-started"))).toBe(true);
      }
      expect(director.activeCount).toBeGreaterThan(0);
    }
  });

  it("deduplicates repeated state notifications and enforces a per-observer cooldown", () => {
    const roster = [actor("c4")], director = new BoardReactionDirector();
    expect(director.plan(impact, roster).reactions).toHaveLength(1);
    expect(director.plan(impact, roster).reactions).toHaveLength(0);
    expect(director.plan({ ...impact, id: "capture-2" }, roster).reactions).toHaveLength(0);
    director.update(10);
    expect(director.activeCount).toBe(0);
    expect(director.plan({ ...impact, id: "capture-3" }, roster).reactions).toHaveLength(1);
  });

  it("releases an observer when the Combat Director takes ownership of it", () => {
    const pawn = actor("c4"), director = new BoardReactionDirector();
    director.plan(impact, [pawn]);
    const plan = director.plan({ ...impact, id: "next", primary: [pawn.id] }, [pawn]);
    expect(plan.release).toContain(pawn.id); expect(plan.reactions).toHaveLength(0); expect(director.activeCount).toBe(0);
  });

  it("keeps a checked King guarded until check clears and checkmate leaves a defiant living King", () => {
    const king = actor("a1", "k"), director = new BoardReactionDirector("low");
    const event: BoardReactionEvent = { ...impact, id: "check", type: "check", kingId: king.id, point: king.point, focus: actor("h8", "q", "w").point, checks: 4 };
    const first = director.plan(event, [king]).reactions[0].cue;
    expect(first.pose).toBe("royal-guard"); expect(first.sustained).toBe(true);
    director.update(120); expect(director.activeCount).toBe(1);
    expect(director.releaseRoyal()).toEqual([king.id]); expect(director.activeCount).toBe(0);
    const mate = director.plan({ ...event, id: "mate", type: "checkmate" }, [king]).reactions[0].cue;
    expect(mate.pose).toBe("defiant"); expect(mate.grip).toBeLessThan(0);
    director.update(120); expect(director.activeCount).toBe(1);
    director.reset(); expect(director.activeCount).toBe(0);
  });

  it("is deterministic after reset or roster reordering and never modifies positions", () => {
    const roster = [actor("c4"), actor("f5", "q"), actor("e6", "n")];
    for (const value of roster) { Object.freeze(value.point); Object.freeze(value); }
    const before = JSON.stringify(roster), director = new BoardReactionDirector("high");
    const first = director.plan(impact, roster);
    director.reset(); const again = director.plan(impact, [...roster].reverse());
    expect(again).toEqual(first); expect(JSON.stringify(roster)).toBe(before);
  });
});
