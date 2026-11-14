import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { GameController } from "../core/gameController";
import type { GameSnapshot, PieceKind, Faction } from "../core/types";
import { SceneEngine } from "./sceneEngine";
import { MomentDirector } from "./moments/MomentDirector";
import { BoardReactionDirector } from "./boardReactionDirector";
import { CheckmatePresentation } from "./checkmatePresentation";
import { DownfallStage } from "./downfall/downfallStage";
import { BattleBonds } from "./battleBonds";
import { TILE, squareToWorld } from "./board";

/** Actual SceneEngine adapters with observed actors; no WebGL/arena claim. */
function fixture(entries: { square: string; kind: PieceKind; color: Faction }[], controller?: GameController) {
  const pieces = new Map(entries.map(entry => {
    const container = new THREE.Group(); container.position.copy(squareToWorld(entry.square));
    return [entry.square, { ...entry, container, isSlain: false, applyBoardReaction: vi.fn(), clearBoardReaction: vi.fn(), setBattlefieldQuiet: vi.fn(), setBattleMood: vi.fn(), playDeath: vi.fn(),
      // the downfall's side of a figure (PieceView): poses and fallen weapons are the downfall tests' to check
      standingHeight: 1, holdsLongArm: false, measuredHeight: () => 1, facing: (out: THREE.Vector3) => out.set(0, 0, entry.color === "w" ? -1 : 1),
      beginDownfall: vi.fn(), holdStance: vi.fn(), downfallProps: () => [], adoptFallen: vi.fn(), setDownfallLight: vi.fn(), setBadgeEnabled: vi.fn() }];
  }));
  const world = new THREE.Scene();
  const scene = Object.assign(Object.create(SceneEngine.prototype), {
    scene: world, downfall: new DownfallStage(world, { drop: vi.fn(), kneel: vi.fn(), armyLine: vi.fn(() => null), pan: () => 0 }), camera: new THREE.PerspectiveCamera(), lensFov: 46,
    applyOrbitLimits: vi.fn(), factory: { getSkins: () => ({ w: "ivory", b: "sun" }) }, board: { clearHighlights: vi.fn() }, rankBadges: true,
    pieces, boardReactions: new BoardReactionDirector("medium", TILE), battleBonds: new BattleBonds(), reactionStateKey: "", boardRevision: 1, controller,
    reducedMotion: false, tactical: false, menuPresentation: false,
    conclusion: new CheckmatePresentation(), conclusionViewActive: false, conclusionCameraRevision: 0,
    controls: { enabled: false, target: new THREE.Vector3() }, interactive: true, attract: false, cameraScripted: false,
    postfx: { setCinematic: vi.fn() }, callbacks: { onConclusionState: vi.fn() },
    // The real engine's cinematic moments (skipEndCinematic settles them).
    moments: new MomentDirector(),
  });
  return { scene, pieces };
}
const sync = (scene: object, snapshot: GameSnapshot) => Reflect.apply(Reflect.get(SceneEngine.prototype, "syncBoardReactions"), scene, [snapshot]);

describe("board reactions wired to the real scene adapters", () => {
  it("waits until a move settles, then reacts once to check and releases the King after escape", async () => {
    const game = new GameController();
    game.start({ mode: "hotseat", difficulty: "easy", playerColor: "w", clockMinutes: null, startingFen: "4k3/8/8/8/8/8/8/4R1K1 b - - 0 1" });
    const f = fixture(game.getBoard(), game), king = f.pieces.get("e8")!;
    sync(f.scene, { ...game.getSnapshot(), busy: true }); expect(king.applyBoardReaction).not.toHaveBeenCalled();
    sync(f.scene, game.getSnapshot()); expect(king.applyBoardReaction).toHaveBeenCalledOnce();
    expect(king.applyBoardReaction.mock.calls[0][0].pose).toBe("royal-guard");
    sync(f.scene, game.getSnapshot()); expect(king.applyBoardReaction).toHaveBeenCalledOnce();
    expect(await game.tryMove("e8", "f8")).toBe(true);
    f.pieces.delete("e8"); king.container.position.copy(squareToWorld("f8")); f.pieces.set("f8", king);
    sync(f.scene, game.getSnapshot()); expect(king.clearBoardReaction).toHaveBeenCalledOnce();
    game.dispose();
  });

  it("makes a mated King defiant, quiets the battlefield and never calls a death or changes a square", async () => {
    const game = new GameController();
    game.start({ mode: "hotseat", difficulty: "easy", playerColor: "w", clockMinutes: null });
    for (const [from, to] of [["f2", "f3"], ["e7", "e5"], ["g2", "g4"], ["d8", "h4"]]) expect(await game.tryMove(from, to)).toBe(true);
    const f = fixture(game.getBoard(), game), positions = [...f.pieces].map(([square, actor]) => [square, actor.container.position.toArray()]);
    expect(game.getSnapshot().result?.reason).toBe("checkmate"); sync(f.scene, game.getSnapshot());
    const king = f.pieces.get("e1")!;
    expect(king.applyBoardReaction.mock.calls[0][0].pose).toBe("defiant");
    for (const actor of f.pieces.values()) { expect(actor.setBattlefieldQuiet).toHaveBeenCalledWith(true); expect(actor.playDeath).not.toHaveBeenCalled(); }
    expect([...f.pieces].map(([square, actor]) => [square, actor.container.position.toArray()])).toEqual(positions);
    expect(game.getBoard().filter(actor => actor.kind === "k")).toHaveLength(2);
    game.dispose();
  });

  it("skips observer dispatch in reduced-motion, tactical and menu presentations", () => {
    const game = new GameController();
    game.start({ mode: "hotseat", difficulty: "easy", playerColor: "w", clockMinutes: null, startingFen: "4k3/8/8/8/8/8/8/4R1K1 b - - 0 1" });
    for (const mode of ["reducedMotion", "tactical", "menuPresentation"]) {
      const f = fixture(game.getBoard(), game); f.scene[mode] = true;
      sync(f.scene, game.getSnapshot()); expect(f.pieces.get("e8")!.applyBoardReaction).not.toHaveBeenCalled();
    }
    game.dispose();
  });

  it("cancels stale conclusion work and immediately releases input and the results panel", async () => {
    const f = fixture([]); f.scene.conclusionViewActive = true; f.scene.cameraScripted = true;
    const ending = f.scene.conclusion.start(1, () => {});
    Reflect.apply(Reflect.get(SceneEngine.prototype, "cancelEndFraming"), f.scene, []);
    expect(await ending).toBe(false); expect(f.scene.controls.enabled).toBe(true); expect(f.scene.cameraScripted).toBe(false);
    expect(f.scene.callbacks.onConclusionState).toHaveBeenCalledExactlyOnceWith(false);
    Reflect.apply(Reflect.get(SceneEngine.prototype, "cancelEndFraming"), f.scene, []);
    expect(f.scene.callbacks.onConclusionState).toHaveBeenCalledOnce();
  });

  it("stages the downfall through the actual adapter: skip ends on the board, reveals results, and no King is slain", async () => {
    const game = new GameController();
    game.start({ mode: "hotseat", difficulty: "easy", playerColor: "w", clockMinutes: null });
    for (const [from, to] of [["f2", "f3"], ["e7", "e5"], ["g2", "g4"], ["d8", "h4"]]) await game.tryMove(from, to);
    const f = fixture(game.getBoard());
    f.scene.controller = game; f.scene.camera.position.set(0, 6.4, 8.6);
    f.scene.controls.target = new THREE.Vector3(); f.scene.captureFollowRig = vi.fn();
    const ending = Reflect.apply(Reflect.get(SceneEngine.prototype, "playEndCinematic"), f.scene, [false]);
    expect(f.scene.conclusion.active).toBe(true); expect(f.scene.callbacks.onConclusionState).toHaveBeenCalledWith(true);
    expect(f.scene.downfall.current.king.square).toBe("e1");
    expect(f.scene.scene.getObjectByName("downfall_shade")).toBeTruthy();
    // Every figure has its part; the beaten King's realization stops his stance at once, the rest wait for the wave.
    for (const actor of f.pieces.values()) expect(actor.beginDownfall).toHaveBeenCalledOnce();
    expect(f.pieces.get("e1")!.holdStance).toHaveBeenCalledOnce();
    expect(f.pieces.get("a2")!.holdStance).not.toHaveBeenCalled();
    f.scene.skipEndCinematic(); await ending;
    expect(f.scene.camera.position.y).toBeCloseTo(6.8, 6);
    const focus = squareToWorld("e1", .7), camera = f.scene.camera.position;
    expect(Math.hypot(camera.x-focus.x, camera.z-focus.z)).toBeLessThanOrEqual(8.001);
    expect(f.scene.camera.fov).toBe(46);
    expect(f.scene.controls.enabled).toBe(true); expect(f.scene.callbacks.onConclusionState).toHaveBeenLastCalledWith(false);
    expect(f.scene.applyOrbitLimits).toHaveBeenCalled();
    for (const [square, actor] of f.pieces) {
      expect(actor.playDeath).not.toHaveBeenCalled();
      if (actor.color === "w") expect(actor.holdStance, `${square} held its stance`).toHaveBeenCalled();
      else expect(actor.holdStance, `${square} (a victor) keeps its own`).not.toHaveBeenCalled();
    }
    expect(game.getBoard().filter(actor => actor.kind === "k")).toHaveLength(2);
    expect(f.scene.downfall.finished).toBe(true);
    expect(f.scene.board.clearHighlights).toHaveBeenCalledWith(["check"]);
    game.dispose();
  });

  it("keeps only the beaten King's crest in the close shots and gives every crest back after", async () => {
    const game = new GameController();
    game.start({ mode: "hotseat", difficulty: "easy", playerColor: "w", clockMinutes: null });
    for (const [from, to] of [["f2", "f3"], ["e7", "e5"], ["g2", "g4"], ["d8", "h4"]]) await game.tryMove(from, to);
    const f = fixture(game.getBoard());
    f.scene.controller = game; f.scene.controls.target = new THREE.Vector3(); f.scene.captureFollowRig = vi.fn();
    const ending = Reflect.apply(Reflect.get(SceneEngine.prototype, "playEndCinematic"), f.scene, [false]);
    for (let i = 0; i < 6 * 30; i++) { f.scene.downfall.update(1/30); f.scene.conclusion.update(1/30, 1); }
    const king = f.pieces.get("e1")!, pawn = f.pieces.get("a2")!;
    expect(king.setBadgeEnabled).toHaveBeenLastCalledWith(true);
    expect(pawn.setBadgeEnabled).toHaveBeenLastCalledWith(false);
    f.scene.skipEndCinematic(); await ending;
    for (const actor of f.pieces.values()) expect(actor.setBadgeEnabled).toHaveBeenLastCalledWith(true);
    game.dispose();
  });

  it("puts a rebuilt board back in the same final tableau, and a new game in none", async () => {
    const game = new GameController();
    game.start({ mode: "hotseat", difficulty: "easy", playerColor: "w", clockMinutes: null });
    for (const [from, to] of [["f2", "f3"], ["e7", "e5"], ["g2", "g4"], ["d8", "h4"]]) await game.tryMove(from, to);
    const f = fixture(game.getBoard());
    f.scene.controller = game; f.scene.controls.target = new THREE.Vector3(); f.scene.captureFollowRig = vi.fn();
    const ending = Reflect.apply(Reflect.get(SceneEngine.prototype, "playEndCinematic"), f.scene, [false]);
    f.scene.skipEndCinematic(); await ending;
    // A rebuild (another army, a new preset) frees the figures: the stage lets go, then stands the new ones straight in the tableau.
    f.scene.downfall.cancel();
    expect(f.scene.scene.getObjectByName("downfall_shade")).toBeUndefined();
    const rebuilt = fixture(game.getBoard());
    Object.assign(rebuilt.scene, { controller: game, downfall: f.scene.downfall, scene: f.scene.scene });
    Reflect.apply(Reflect.get(SceneEngine.prototype, "restageDownfall"), rebuilt.scene, []);
    expect(rebuilt.pieces.get("e1")!.holdStance).toHaveBeenCalledWith(0);
    expect(f.scene.downfall.finished).toBe(true);
    expect(f.scene.scene.getObjectByName("downfall_shade")).toBeTruthy();
    // A new game: nothing to put back.
    game.start({ mode: "hotseat", difficulty: "easy", playerColor: "w", clockMinutes: null });
    f.scene.downfall.cancel();
    const fresh = fixture(game.getBoard());
    Object.assign(fresh.scene, { controller: game, downfall: f.scene.downfall, scene: f.scene.scene });
    Reflect.apply(Reflect.get(SceneEngine.prototype, "restageDownfall"), fresh.scene, []);
    for (const actor of fresh.pieces.values()) expect(actor.beginDownfall).not.toHaveBeenCalled();
    expect(f.scene.scene.getObjectByName("downfall_shade")).toBeUndefined();
    game.dispose();
  });

  it("keeps the quieter ending for a stalemate: no downfall is staged", async () => {
    const game = new GameController();
    game.start({ mode: "hotseat", difficulty: "easy", playerColor: "w", clockMinutes: null, startingFen: "7k/5K2/8/6Q1/8/8/8/8 w - - 0 1" });
    expect(await game.tryMove("g5", "g6")).toBe(true);
    expect(game.getSnapshot().result?.reason).toBe("stalemate");
    const f = fixture(game.getBoard());
    Object.assign(f.scene, { controller: game, controls: { enabled: true, target: new THREE.Vector3() }, moveCameraTo: vi.fn(async () => {}), shake: { add: vi.fn() } });
    await Reflect.apply(Reflect.get(SceneEngine.prototype, "playEndCinematic"), f.scene, [false]);
    expect(f.scene.downfall.active).toBe(false);
    for (const actor of f.pieces.values()) expect(actor.beginDownfall).not.toHaveBeenCalled();
    expect(f.scene.moveCameraTo).toHaveBeenCalledOnce();
    game.dispose();
  });

  it("gives a companion's fall its meaning through the real adapters: grief beside the body, and the voices told once", async () => {
    // The d- and e-Pawns stand side by side for fifteen plies; then ...cxd4 takes the d-Pawn.
    const game = new GameController();
    game.start({ mode: "hotseat", difficulty: "easy", playerColor: "w", clockMinutes: null });
    const line = [["e2", "e4"], ["e7", "e6"], ["d2", "d4"], ["b7", "b6"], ["g1", "f3"], ["c8", "b7"], ["f1", "d3"], ["g8", "e7"], ["e1", "g1"], ["e7", "g6"],
      ["b1", "c3"], ["f8", "e7"], ["c1", "e3"], ["e8", "g8"], ["d1", "e2"], ["c7", "c5"], ["h2", "h3"]];
    for (const [from, to] of line) expect(await game.tryMove(from, to)).toBe(true);
    // The witnesses stand where they stood before the capture; the fighters are the duel's.
    const f = fixture(game.getBoard(), game), heard: string[] = [];
    f.scene.onBattleEmotion((event: { kind: string; bond: { survivor: { id: string } } | null }) => heard.push(`${event.kind}:${event.bond?.survivor.id}`));
    expect(await game.tryMove("c5", "d4")).toBe(true);
    const killer = f.pieces.get("c5")!, victim = f.pieces.get("d4")!;
    f.pieces.delete("c5"); f.pieces.delete("d4");
    const fallen = [victim.container.position, .65, victim, killer, "ally-fallen"];
    Reflect.apply(Reflect.get(SceneEngine.prototype, "reactToImpact"), f.scene, fallen);
    const companion = f.pieces.get("e4")!;
    expect(companion.applyBoardReaction).toHaveBeenCalledOnce();
    const cue = companion.applyBoardReaction.mock.calls[0][0];
    expect(cue.pose).toBe("grief"); expect(cue.bow).toBeGreaterThan(.1); expect(cue.duration).toBeGreaterThan(4);
    expect(heard).toEqual(["companion:w:e2"]);
    // The same fall reported again on this board is not told again.
    Reflect.apply(Reflect.get(SceneEngine.prototype, "reactToImpact"), f.scene, fallen);
    expect(heard).toHaveLength(1);
    game.dispose();
  });

  it("lets an avenger have its moment once it stands on the square it took, through the real adapters", async () => {
    const game = new GameController();
    game.start({ mode: "hotseat", difficulty: "easy", playerColor: "w", clockMinutes: null });
    for (const [from, to] of [["e2", "e4"], ["d7", "d5"], ["e4", "d5"], ["d8", "d5"]]) expect(await game.tryMove(from, to)).toBe(true);
    const f = fixture(game.getBoard(), game);
    Reflect.apply(Reflect.get(SceneEngine.prototype, "honourAvenger"), f.scene, []);
    const queen = f.pieces.get("d5")!;
    expect(queen.applyBoardReaction).toHaveBeenCalledOnce();
    expect(queen.applyBoardReaction.mock.calls[0][0].pose).toBe("resolve");
    // Not under reduced motion.
    const quiet = fixture(game.getBoard(), game); quiet.scene.reducedMotion = true;
    Reflect.apply(Reflect.get(SceneEngine.prototype, "honourAvenger"), quiet.scene, []);
    expect(quiet.pieces.get("d5")!.applyBoardReaction).not.toHaveBeenCalled();
    game.dispose();
  });
});
