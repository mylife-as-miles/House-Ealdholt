import { beforeEach, describe, expect, it, vi } from "vitest";
import { PieceFactory } from "./pieces";
import { Group } from "three";

const load = vi.hoisted(() => vi.fn(async (_archetype: string, _loader: unknown) => new Map()));
vi.mock("./combatAnimationLibrary", async importOriginal => ({
  ...await importOriginal<typeof import("./combatAnimationLibrary")>(), loadCombatAnimationLibrary: load,
}));
const wp = "https://r2-pub.rork.com/generated-3d-models/g9111r67kl6tq85g540sd/36d8c7d4-2f42-4672-8908-e9298fce9b69-rigged.glb";

function roster(entries: [string, string, string][]) {
  const factory = new PieceFactory();
  const templates = Reflect.get(factory, "templates") as Map<string, unknown>;
  const sources = Reflect.get(factory, "clipSources") as Map<string, unknown>;
  for (const [key, combat, rigged] of entries) {
    templates.set(key, { combat, skinned: true, scene: new Group() }); sources.set(key, { rigged });
  }
  return factory;
}

describe("combat libraries follow the rendered army's source rig", () => {
  beforeEach(() => load.mockClear());

  it("loads the same authored rig once for both board colours", async () => {
    const factory = roster([["wp", "wp", wp], ["bp", "wp", wp]]), installed = vi.fn();
    factory.onCombatLibrary(installed);
    await Promise.all([factory.ensureCombatLibrary("w", "p"), factory.ensureCombatLibrary("b", "p")]);
    expect(load).toHaveBeenCalledTimes(1); expect(load.mock.calls[0][0]).toBe("wp");
    expect(installed).toHaveBeenCalledOnce(); expect(installed.mock.calls[0][0]).toEqual(["wp", "bp"]);
  });

  it("rejects an archetype label on a different skeleton without fetching clips", async () => {
    const factory = roster([["bp", "wp", "https://assets.invalid/new-pawn.glb"]]);
    await factory.ensureCombatLibrary("b", "p"); expect(load).not.toHaveBeenCalled();
  });

  it("does not notify an unqualified roster when another roster loads its library", async () => {
    const factory = roster([["wp", "wp", wp], ["bp", "wp", "https://assets.invalid/new-pawn.glb"]]), installed = vi.fn();
    factory.onCombatLibrary(installed); await factory.ensureCombatLibrary("w", "p");
    expect(installed.mock.calls[0][0]).toEqual(["wp"]);
  });

  it("ignores a library that completes after the factory is disposed", async () => {
    let resolve!: (value: Map<string, never>) => void;
    load.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const factory = roster([["wp", "wp", wp]]), installed = vi.fn(); factory.onCombatLibrary(installed);
    const pending = factory.ensureCombatLibrary("w", "p"); factory.dispose(); resolve(new Map<string, never>()); await pending;
    expect(installed).not.toHaveBeenCalled(); expect(Reflect.get(factory, "combatLibraries").size).toBe(0);
  });
});
