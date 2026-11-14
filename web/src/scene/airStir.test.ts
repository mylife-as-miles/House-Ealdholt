import * as THREE from "three";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SceneEngine } from "./sceneEngine";
import { audio } from "../audio/audioManager";
import type { AirSink } from "./vfx/airWiring";

/**
 * The engine's own reports to the arena's air, through its real methods (footfall, the flipbook moments, a burst
 * body's landing). No WebGL: the engine is observed without its constructor, as the duel lifecycle tests observe it.
 */
function fixture(overrides: Record<string, unknown> = {}) {
  vi.spyOn(audio, "footstep").mockImplementation(() => {});
  const disturb = vi.fn<AirSink>();
  const effects = { spawnSmoke: vi.fn(), spawnBurst: vi.fn(), spawnContact: vi.fn(() => 6) };
  const scene = Object.assign(Object.create(SceneEngine.prototype), {
    battlefieldRenderer: { disturb }, disposed: false, reducedMotion: false, tactical: false, menuPresentation: false, attract: false,
    preset: "high", boardRevision: 3, landingDusts: 0, vfx: null, effects, airFoot: new THREE.Vector3(),
    vfxFlags: { quality: "low", reducedMotion: false, tactical: false, menuBoard: false },
    silentBoard: () => false, stereoPan: () => 0,
    // The pieces' voices decide whether a step is heard and with what (boardVoices.ts): every step, its own timbre.
    voices: { stepHeard: () => true, stepTimbre: (_piece: unknown, timbre: string) => timbre },
    controller: { getSnapshot: () => ({ sanList: ["e4", "d5", "exd5"] }) },
    ...overrides,
  });
  const call = (name: string, ...args: unknown[]) => Reflect.apply(Reflect.get(SceneEngine.prototype, name), scene, args);
  return { scene, disturb, effects, call };
}
const gait = { stepsPerTile: 2, cadence: 2.7, timbre: "scuff", volume: 0.72 };
const walker = (foot: THREE.Vector3 | null) => {
  const container = new THREE.Group(); container.position.set(1, 0, 2);
  return { container, lowerFoot: (out: THREE.Vector3) => (foot ? out.copy(foot) : null) };
};

describe("the match tells the arena's air what happens on the board", () => {
  afterEach(() => vi.restoreAllMocks());

  it("a footfall parts the ash under the boot that came down, and its dust is put there", () => {
    const f = fixture();
    f.call("footfall", walker(new THREE.Vector3(1.2, 0.07, 2.1)), gait, 1, true);
    expect(f.disturb).toHaveBeenCalledExactlyOnceWith("step", 1.2, 0, 2.1, 0.72, 0);
    const at = f.effects.spawnSmoke.mock.calls[0][0] as THREE.Vector3;
    expect([at.x, at.y, at.z]).toEqual([1.2, 0.05, 2.1]);
  });

  it("a figure with no legs to read steps where it stands; without dust on this preset the air is still told", () => {
    const f = fixture();
    f.call("footfall", walker(null), gait, 2, false);
    expect(f.disturb).toHaveBeenCalledExactlyOnceWith("step", 1, 0, 2, 0.72, 0);
    expect(f.effects.spawnSmoke).not.toHaveBeenCalled();
  });

  it("a flipbook moment tells the air on its own delay, whether or not a flipbook is drawn for it", () => {
    const f = fixture();
    // no flipbook system at all (vfx: null): nothing is played, the air is told all the same
    expect(f.call("playVfx", "fall", new THREE.Vector3(2, 0, -1), null, 0, null, 0.42)).toBe(false);
    expect(f.disturb).toHaveBeenLastCalledWith("fall", 2, 0, -1, 1, 0.42);
    f.call("playVfx", "slam", new THREE.Vector3(0, 0, 0), { power: 1.4, source: "melee" });
    expect(f.disturb).toHaveBeenLastCalledWith("slam", 0, 0, 0, 1.4, 0);
    f.call("playVfx", "bash", new THREE.Vector3(0.5, 0, 0.5));
    expect(f.disturb).toHaveBeenLastCalledWith("clash", 0.5, 0, 0.5, 1, 0);
    f.call("playVfx", "musket", new THREE.Vector3(3, 0.6, 0), { power: 0.8 });
    expect(f.disturb).toHaveBeenLastCalledWith("shot", 3, 0.6, 0, 0.8, 0);
    f.call("playVfx", "step", new THREE.Vector3(1, 0, 1), { power: 0.5 });
    expect(f.disturb).toHaveBeenLastCalledWith("step", 1, 0, 1, 0.5, 0);
    expect(f.disturb).toHaveBeenCalledTimes(5);
    // a spell is told where it breaks (spellBurst), the mist round a caster not at all
    f.call("playVfx", "spell", new THREE.Vector3());
    f.call("playVfx", "mist", new THREE.Vector3());
    expect(f.disturb).toHaveBeenCalledTimes(5);
  });

  it("a piece of a burst body reaching the stone raises one puff from the stone's pool and stirs the ash, the trunk harder", () => {
    const f = fixture();
    f.call("landingDust", new THREE.Vector3(1, 0.2, 1), true);
    f.call("landingDust", new THREE.Vector3(-2, 0.1, 0), false);
    expect(f.disturb.mock.calls).toEqual([["fall", 1, 0, 1, 0.8, 0], ["fall", -2, 0, 0, 0.35, 0]]);
    expect(f.effects.spawnContact).toHaveBeenCalledTimes(2);
    const [trunk, limb] = f.effects.spawnContact.mock.calls.map(([input]) => input as { id: string; seed: number; material: string; strength: number; point: { y: number } });
    expect(trunk.material).toBe("stone");
    expect(trunk.strength).toBeGreaterThan(limb.strength);
    expect(trunk.id).not.toBe(limb.id);
    expect(trunk.seed).not.toBe(limb.seed);
    expect(trunk.point.y).toBeCloseTo(0.02);
  });

  it("says nothing under reduced motion, on the flat map, on the menu's board, after disposal, or to an arena with no air", () => {
    const quiet = [{ reducedMotion: true }, { tactical: true }, { menuPresentation: true }, { attract: true }, { silentBoard: () => true }, { disposed: true }];
    for (const settings of quiet) {
      const f = fixture(settings);
      expect(f.call("stirAir", "spell", 0, 0, 0, 1)).toBe(false);
      f.call("playVfx", "fall", new THREE.Vector3());
      f.call("landingDust", new THREE.Vector3(), true);
      expect(f.disturb, JSON.stringify(Object.keys(settings))).not.toHaveBeenCalled();
    }
    // reduced motion and the flat map draw no landing dust either
    for (const settings of [{ reducedMotion: true }, { tactical: true }]) {
      const f = fixture(settings);
      f.call("landingDust", new THREE.Vector3(), true);
      expect(f.effects.spawnContact).not.toHaveBeenCalled();
    }
    // the baked arena and Quest have no `disturb`; before the look is in, there is no renderer at all
    for (const battlefieldRenderer of [{}, null, undefined]) {
      const f = fixture({ battlefieldRenderer });
      expect(f.call("stirAir", "blow", 0, 0, 0)).toBe(false);
      expect(() => f.call("footfall", walker(null), gait, 1, false)).not.toThrow();
    }
  });
});
