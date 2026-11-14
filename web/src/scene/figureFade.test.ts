import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { FADE_DEPTH_WRITE, fadeMaterial } from "./figureFade";

describe("fadeMaterial (A-27)", () => {
  it("rebuilds the program when the material turns transparent or opaque, and only then", () => {
    const material = new THREE.MeshStandardMaterial();
    const start = material.version;
    fadeMaterial(material, 0.5);
    expect(material.transparent).toBe(true);
    expect(material.version).toBe(start + 1);
    fadeMaterial(material, 0.4);
    fadeMaterial(material, 0.2);
    expect(material.version).toBe(start + 1);
    fadeMaterial(material, 1);
    expect(material.transparent).toBe(false);
    expect(material.version).toBe(start + 2);
    fadeMaterial(material, 1);
    expect(material.version).toBe(start + 2);
  });

  it("keeps writing depth until the figure is faint", () => {
    const material = new THREE.MeshStandardMaterial();
    fadeMaterial(material, 0.6);
    expect(material.depthWrite).toBe(true);
    fadeMaterial(material, FADE_DEPTH_WRITE + 0.01);
    expect(material.depthWrite).toBe(true);
    fadeMaterial(material, FADE_DEPTH_WRITE);
    expect(material.depthWrite).toBe(false);
    expect(material.opacity).toBe(FADE_DEPTH_WRITE);
  });
});
