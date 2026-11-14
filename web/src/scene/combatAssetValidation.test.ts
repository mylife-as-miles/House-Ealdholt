import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { COMBAT_LIBRARY_VERSION } from "../../../shared/play/combat-sequences";
import { validateCombatMetadata, validateCombatTracks } from "./combatAnimationLibrary";

function asset() {
  const clip = new THREE.AnimationClip("attack.thrust", 1, [new THREE.VectorKeyframeTrack("Hips.position", [0, 1], [0, 0, 0, 0, 0, 0])]);
  const meta = { id: clip.name, version: COMBAT_LIBRARY_VERSION, archetype: "wp", tags: ["attack", "polearm"], fps: 30, duration: 1,
    markers: [{ name: "contact", frame: 15, time: .5 }, { name: "impact", frame: 15, time: .5 }] };
  return { clip, meta };
}

describe("combat asset import boundaries", () => {
  it("does not let a missing role tag bypass the authored contact requirement", () => {
    const { clip, meta } = asset();
    expect(() => validateCombatMetadata({ ...meta, tags: ["polearm"], markers: [] }, "wp", clip)).toThrow();
    expect(() => validateCombatMetadata({ ...meta, tags: [1] }, "wp", clip)).toThrow();
  });
  it("rejects ambiguous contact frames and conflicting impact aliases", () => {
    const { clip, meta } = asset();
    expect(() => validateCombatMetadata({ ...meta, markers: [...meta.markers, { name: "contact", frame: 24, time: .8 }] }, "wp", clip)).toThrow();
    expect(() => validateCombatMetadata({ ...meta, markers: [{ name: "contact", frame: 15, time: .5 }, { name: "impact", frame: 24, time: .8 }] }, "wp", clip)).toThrow();
  });
  it("rejects malformed events and bounds the event list before processing it", () => {
    const { clip, meta } = asset();
    expect(() => validateCombatMetadata({ ...meta, markers: [null] }, "wp", clip)).toThrow("Invalid Blender animation event");
    expect(() => validateCombatMetadata({ ...meta, markers: Array(129).fill(meta.markers[0]) }, "wp", clip)).toThrow();
  });
  it("orders valid exported cues without modifying the parsed source document", () => {
    const { clip, meta } = asset();
    const markers = [{ name: "end", frame: 30, time: 1 }, ...meta.markers, { name: "start", frame: 0, time: 0 }];
    const result = validateCombatMetadata({ ...meta, markers }, "wp", clip);
    expect(result.markers.map(marker => marker.time)).toEqual([0, .5, .5, 1]);
    expect(markers[0].name).toBe("end");
  });
  it("rejects nonfinite skeletal samples, invalid keyframe times and empty animations", () => {
    const { clip } = asset(); expect(() => validateCombatTracks(clip)).not.toThrow();
    clip.tracks[0].values[1] = NaN; expect(() => validateCombatTracks(clip)).toThrow("Nonfinite combat animation pose");
    clip.tracks[0].values[1] = 0; clip.tracks[0].times[1] = 0; expect(() => validateCombatTracks(clip)).toThrow("Invalid combat keyframe times");
    expect(() => validateCombatTracks(new THREE.AnimationClip("attack.thrust", 1, []))).toThrow();
  });
});
