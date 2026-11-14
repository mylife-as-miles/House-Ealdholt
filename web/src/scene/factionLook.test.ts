import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { applyFactionLook, applyPaintRelief } from "./pieces";

describe("an army's own painted sculpt keeps its paint under the side's glow", () => {
  const painted = () => { const material = new THREE.MeshStandardMaterial({ metalness: 0, roughness: 1 }); material.map = new THREE.Texture(); return material; };

  it("lays the side colour through the paint when the sculpt ships no emissive map (Solforiz, Korvenia, Kwind-09)", () => {
    for (const side of ["w", "b"] as const) {
      const material = painted();
      applyFactionLook(material, side, true);
      expect(material.color.getHex()).toBe(0xffffff);
      expect(material.emissiveMap).toBe(material.map);
      expect(material.emissive.getHex()).toBe(side === "w" ? 0x2a4d94 : 0x711a12);
      expect(material.emissiveIntensity).toBeCloseTo(0.05);
    }
  });

  it("leaves a sculpt's own emissive map alone (Aethelgard)", () => {
    const material = painted(), own = new THREE.Texture();
    material.emissiveMap = own;
    applyFactionLook(material, "w", true);
    expect(material.emissiveMap).toBe(own);
  });

  it("a borrowed or untextured figure is still tinted flat, with no emissive map invented for it", () => {
    const borrowed = painted(), bare = new THREE.MeshStandardMaterial();
    applyFactionLook(borrowed, "b", false); applyFactionLook(bare, "w", true);
    expect(borrowed.color.getHex()).toBe(0x34363d); expect(borrowed.emissiveMap).toBeNull();
    expect(bare.color.getHex()).toBe(0xfff2dd); expect(bare.emissiveMap).toBeNull();
  });
});

describe("a painted sculpt takes its relief from its paint", () => {
  it("reads the colour picture as height too, a little smoother, and filters it for the play camera's grazing view", () => {
    const material = new THREE.MeshStandardMaterial({ roughness: 0.85 });
    material.map = new THREE.Texture();
    applyPaintRelief(material);
    expect(material.bumpMap).toBe(material.map);
    expect(material.bumpScale).toBeGreaterThan(0);
    expect(material.roughness).toBeLessThan(0.85);
    expect(material.map.anisotropy).toBeGreaterThanOrEqual(8);
  });

  it("never roughens a surface that was smoother already", () => {
    const material = new THREE.MeshStandardMaterial({ roughness: 0.3 });
    material.map = new THREE.Texture();
    applyPaintRelief(material);
    expect(material.roughness).toBe(0.3);
  });

  it("leaves alone a material with no paint, or with a normal or bump map of its own", () => {
    const bare = new THREE.MeshStandardMaterial({ roughness: 0.85 });
    applyPaintRelief(bare);
    expect(bare.bumpMap).toBeNull(); expect(bare.roughness).toBe(0.85);
    const sculpted = new THREE.MeshStandardMaterial({ roughness: 0.85 }), normal = new THREE.Texture();
    sculpted.map = new THREE.Texture(); sculpted.normalMap = normal;
    applyPaintRelief(sculpted);
    expect(sculpted.bumpMap).toBeNull(); expect(sculpted.roughness).toBe(0.85);
  });
});
