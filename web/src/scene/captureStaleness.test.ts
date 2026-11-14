import * as THREE from "three";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SceneEngine } from "./sceneEngine";
import { CombatCancelled } from "./pairedCombat";

/**
 * M-20: a capture scene begun on one board must not act on the next. These drive the actual SceneEngine methods on a
 * stand-in engine (no WebGL): an Undo is the board's revision moving on while the scene awaits.
 */
function engine(overrides: Record<string, unknown> = {}) {
  return Object.assign(Object.create(SceneEngine.prototype), { boardRevision: 1, disposed: false, preset: "low", ...overrides }) as SceneEngine & Record<string, any>;
}
const figure = () => ({ container: new THREE.Group(), faceTowards: vi.fn() });

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("capture scenes after an Undo (M-20)", () => {
  it("does not claim a body whose death was cut short by a new board", async () => {
    const scene = engine();
    scene.slay = vi.fn(async () => { scene.boardRevision += 1; });
    scene.banish = vi.fn(async () => {});
    await scene.crumble(figure(), new THREE.Vector3(1, 0, 0));
    expect(scene.slay).toHaveBeenCalledOnce();
    expect(scene.banish).not.toHaveBeenCalled();
  });

  it("claims it when the board is the one the death began on", async () => {
    const scene = engine();
    scene.slay = vi.fn(async () => {});
    scene.banish = vi.fn(async () => {});
    await scene.crumble(figure(), new THREE.Vector3(1, 0, 0));
    expect(scene.banish).toHaveBeenCalledOnce();
  });

  it("lets an aftershock begun on the old board shake nothing on the new one", async () => {
    vi.useFakeTimers();
    const shake = { add: vi.fn() }, board = { impact: vi.fn() }, effects = { spawnBurst: vi.fn() };
    const scene = engine({ shake, board, effects, stirAir: vi.fn() });
    const shock = scene.aftershock("e4", 0.5);
    scene.boardRevision += 1;
    await vi.advanceTimersByTimeAsync(400);
    await shock;
    expect(shake.add).not.toHaveBeenCalled();
    expect(board.impact).not.toHaveBeenCalled();
    expect(effects.spawnBurst).not.toHaveBeenCalled();
  });

  it("stops a beat with the cancellation the capture's try lets pass quietly", () => {
    const scene = engine();
    expect(() => scene.stopIfStale(1)).not.toThrow();
    scene.boardRevision = 2;
    expect(() => scene.stopIfStale(1)).toThrow(CombatCancelled);
    scene.boardRevision = 1; scene.disposed = true;
    expect(() => scene.stopIfStale(1)).toThrow(CombatCancelled);
  });
});

describe("a move that breaks part-way (M-20)", () => {
  const scene = () => engine({ movesInFlight: 0, combatHurry: 1, quietStage: false, walkHurry: 1, hurried: new Set(), rebuildPending: false, rebuildPieces: vi.fn() });

  it("stands the board up again from the game, and still reports the error", async () => {
    const view = scene();
    view.runMove = vi.fn(async () => { throw new Error("a clip failed to load"); });
    await expect(view.animateMove({})).rejects.toThrow("a clip failed to load");
    expect(view.rebuildPieces).toHaveBeenCalledOnce();
    expect(view.movesInFlight).toBe(0);
  });

  it("leaves alone a beat cut short by a new board", async () => {
    const view = scene();
    view.runMove = vi.fn(async () => { throw new CombatCancelled(); });
    await expect(view.animateMove({})).rejects.toBeInstanceOf(CombatCancelled);
    expect(view.rebuildPieces).not.toHaveBeenCalled();
  });
});
