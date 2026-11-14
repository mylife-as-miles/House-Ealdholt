import { describe, expect, it, vi } from "vitest";
import { AIR_IMPULSES } from "../../../../shared/play/air-disturbance";
import { AIR_OF_MOMENT, airStirs, stirAir, type AirSink } from "./airWiring";
import type { VfxMoment } from "./wiring";

const play = { reducedMotion: false, tactical: false, menuBoard: false };

describe("what the match tells the arena's air", () => {
  it("passes a real event on as it was given: kind, place, power, delay", () => {
    const sink = vi.fn<AirSink>();
    expect(stirAir(sink, play, "blow", 1, 0.5, -2, 1.2, 0.3)).toBe(true);
    expect(sink).toHaveBeenCalledExactlyOnceWith("blow", 1, 0.5, -2, 1.2, 0.3);
    stirAir(sink, play, "step", 0, 0, 0);
    expect(sink).toHaveBeenLastCalledWith("step", 0, 0, 0, 1, 0);
    stirAir(sink, play, "fall", 0, 0, 0, 1, -4);
    expect(sink).toHaveBeenLastCalledWith("fall", 0, 0, 0, 1, 0);
  });

  it("stirs nothing under reduced motion, on the flat map, on the menu's board, or with no arena to tell", () => {
    const sink = vi.fn<AirSink>();
    for (const flags of [{ ...play, reducedMotion: true }, { ...play, tactical: true }, { ...play, menuBoard: true }]) {
      expect(airStirs(flags)).toBe(false);
      expect(stirAir(sink, flags, "spell", 0, 0, 0)).toBe(false);
    }
    expect(airStirs(play)).toBe(true);
    expect(stirAir(null, play, "spell", 0, 0, 0)).toBe(false);
    expect(stirAir(undefined, play, "spell", 0, 0, 0)).toBe(false);
    expect(sink).not.toHaveBeenCalled();
  });

  it("drops a place or a power that is not a number", () => {
    const sink = vi.fn<AirSink>();
    expect(stirAir(sink, play, "blow", NaN, 0, 0)).toBe(false);
    expect(stirAir(sink, play, "blow", 0, Infinity, 0)).toBe(false);
    expect(stirAir(sink, play, "blow", 0, 0, 0, NaN)).toBe(false);
    expect(stirAir(sink, play, "blow", 0, 0, 0, 0)).toBe(false);
    expect(stirAir(sink, play, "blow", 0, 0, 0, 1, NaN)).toBe(false);
    expect(sink).not.toHaveBeenCalled();
  });

  it("gives every flipbook moment its answer in the air, and tells a spell and the mist once", () => {
    const moments: VfxMoment[] = ["fall", "step", "bash", "musket", "spell", "mist", "slam"];
    expect(Object.keys(AIR_OF_MOMENT).sort()).toEqual([...moments].sort());
    expect(AIR_OF_MOMENT.fall).toBe("fall");
    expect(AIR_OF_MOMENT.step).toBe("step");
    expect(AIR_OF_MOMENT.bash).toBe("clash");
    expect(AIR_OF_MOMENT.musket).toBe("shot");
    expect(AIR_OF_MOMENT.slam).toBe("slam");
    // SceneEngine.spellBurst reports a spell itself, library spell or not; the mist round a caster is the air already
    expect(AIR_OF_MOMENT.spell).toBeNull();
    expect(AIR_OF_MOMENT.mist).toBeNull();
    for (const kind of Object.values(AIR_OF_MOMENT)) if (kind) expect(AIR_IMPULSES[kind]).toBeDefined();
  });
});
