import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { combatEventTime, installCombatEvents, parseCombatEvents, plantedAt, retimedCombatEvent } from "./animationContacts";

function clip(): THREE.AnimationClip {
  return new THREE.AnimationClip("attack", 2, []);
}

describe("authored combat contact markers", () => {
  it("uses Blender's actual impact frame, correctly retimed with the attack", () => {
    const animation = clip();
    expect(installCombatEvents(animation, {
      version: 1, action: "Sword_Judgment",
      events: [{ name: "impact", time: 1.4 }],
    })).toBe(true);
    expect(combatEventTime(animation, "impact")).toBe(1.4);
    expect(retimedCombatEvent(animation, "impact", 1)).toBeCloseTo(0.7);
  });

  it("does not invent markers for old unmarked GLBs", () => {
    const animation = clip();
    expect(combatEventTime(animation, "impact")).toBeNull();
    expect(retimedCombatEvent(animation, "impact", 0.9)).toBeNull();
    expect(plantedAt(animation, "left", 0.5)).toBeNull();
  });

  it("rejects markers outside clip duration and malformed data", () => {
    expect(parseCombatEvents({ version: 1, action: "attack", events: [{ name: "impact", time: 4 }] }, 2)).toBeNull();
    expect(parseCombatEvents({ version: 1, action: "attack", events: [{ name: "unknown", time: 1 }] }, 2)).toBeNull();
    expect(parseCombatEvents({ version: 1, action: "attack", events: [{ name: "impact", time: NaN }] }, 2)).toBeNull();
    expect(parseCombatEvents({ version: 1, events: [] }, 2)).toBeNull();
    expect(parseCombatEvents({ version: 1, action: "attack", events: [{ name: "guard", time: .3 }] }, 2)).toEqual([{ name: "guard", time: .3 }]);
  });

  it("obeys planted and lifted intervals rather than sticking feet throughout an attack", () => {
    const animation = clip();
    installCombatEvents(animation, {
      version: 1, action: "Sword_Judgment",
      events: [
        { name: "foot_left_plant", time: 0.3 },
        { name: "foot_left_lift", time: 1.0 },
        { name: "foot_left_plant", time: 1.6 },
      ],
    });
    expect(plantedAt(animation, "left", 0.1)).toBe(false);
    expect(plantedAt(animation, "left", 0.4)).toBe(true);
    expect(plantedAt(animation, "left", 1.2)).toBe(false);
    expect(plantedAt(animation, "left", 1.8)).toBe(true);
  });
});
