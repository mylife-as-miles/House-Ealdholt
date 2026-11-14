import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { armSurfaceMaterial, carriedPatch, mergeArmParts, patchArmSurface } from "./armSurface";

describe("merged arm parts (A-14)", () => {
  it("carries each part's material in its vertices", () => {
    const box = new THREE.BoxGeometry(1, 1, 1), ball = new THREE.SphereGeometry(0.2, 6, 4);
    const merged = mergeArmParts([
      { geometry: box, color: 0xd8dee8, roughness: 0.21, metalness: 0.98, emissive: 0x101821, emissiveIntensity: 0.2, envMapIntensity: 1.3 },
      { geometry: ball, color: 0xbcd8ff, roughness: 0.08, metalness: 0.05, emissive: 0x6ea8ff, emissiveIntensity: 2.4, envMapIntensity: 0.6 },
    ]);
    const boxCount = box.toNonIndexed().attributes.position.count, total = boxCount + ball.toNonIndexed().attributes.position.count;
    expect(merged.attributes.position.count).toBe(total);
    expect(Object.keys(merged.attributes).sort()).toEqual(["aArmEmissive", "aArmSurface", "color", "normal", "position"]);
    const surface = merged.getAttribute("aArmSurface");
    expect([surface.getX(0), surface.getY(0), surface.getZ(0), surface.getW(0)].map((v) => +v.toFixed(2))).toEqual([0.21, 0.98, 0.2, 1.3]);
    expect([surface.getX(total - 1), surface.getZ(total - 1), surface.getW(total - 1)].map((v) => +v.toFixed(2))).toEqual([0.08, 2.4, 0.6]);
    // Linear colour, as three reads a colour attribute.
    const steel = new THREE.Color(0xd8dee8);
    expect(merged.getAttribute("color").getX(0)).toBeCloseTo(steel.r, 5);
  });

  it("finds every place it writes in three's physical shader", () => {
    const shader = { vertexShader: THREE.ShaderLib.physical.vertexShader, fragmentShader: THREE.ShaderLib.physical.fragmentShader };
    patchArmSurface(shader);
    expect(shader.vertexShader).toContain("vArmSurface = aArmSurface;");
    for (const line of ["roughnessFactor *= vArmSurface.x;", "metalnessFactor *= vArmSurface.y;", "vec3 totalEmissiveRadiance = vArmEmissive *", "#define envMapIntensity (envMapIntensity * vArmSurface.w)"]) {
      expect(shader.fragmentShader).toContain(line);
    }
    expect(shader.fragmentShader).not.toContain("vec3 totalEmissiveRadiance = emissive;");
  });

  it("is a material a figure can fade, shade and highlight like the old ones, with its patch kept for others", () => {
    const material = armSurfaceMaterial(THREE.DoubleSide);
    expect(material.vertexColors).toBe(true);
    expect(material.emissiveIntensity).toBe(0);
    expect(material.side).toBe(THREE.DoubleSide);
    expect(carriedPatch(material)?.key).toBe("arm-surface");
    expect(material.customProgramCacheKey()).toBe("arm-surface");
  });
});
