import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";

// The effects' sprite maps are painted on a canvas, and these tests run without a page.
vi.mock("./textures", async () => {
  const { Texture } = await import("three");
  const texture = () => new Texture();
  return { sparkTexture: texture, radialTexture: texture, smokeTexture: texture };
});
import { EffectsSystem, burstCapacity } from "./effects";

/** The id the next three.js material and object would get: how many have been made since. */
function made(): { material: number; object: number; geometry: number } {
  const material = new THREE.SpriteMaterial(), object = new THREE.Object3D(), geometry = new THREE.BufferGeometry();
  material.dispose(); geometry.dispose();
  return { material: material.id, object: object.id, geometry: geometry.id };
}

/** One capture's worth of effects, played out to the end. */
function capture(effects: EffectsSystem, at: THREE.Vector3): void {
  effects.spawnBurst(at, 0xffaa55, 40, { life: 0.6 });
  effects.spawnBurst(at, 0x8899ff, 12, { life: 0.4 });
  effects.spawnFlash(at, 1.6, 0.28);
  effects.spawnSmoke(at, { count: 8, life: 0.8 });
  for (let i = 0; i < 90; i += 1) effects.update(1 / 30);
}

describe("effects pooling (A-26)", () => {
  it("sizes a burst's buffers in a few powers of two", () => {
    expect([1, 16, 17, 40, 64, 65, 200].map(burstCapacity)).toEqual([16, 16, 32, 64, 64, 128, 256]);
  });

  it("makes no new sprites, materials or geometries once the first capture has filled the pool", () => {
    const effects = new EffectsSystem();
    const at = new THREE.Vector3(0, 0.5, 0);
    capture(effects, at);
    const after = effects.stats();
    expect(after.live).toBe(0);
    expect(after.spare).toBe(1 + 2 + 8);
    const start = made();
    for (let i = 0; i < 50; i += 1) capture(effects, at);
    const end = made();
    // Only the probes made by made() itself: one of each.
    expect(end.material - start.material).toBe(1);
    expect(end.geometry - start.geometry).toBe(1);
    expect(end.object - start.object).toBe(1);
    expect(effects.stats().objects).toBe(after.objects);
  });

  it("draws a reused burst with only its own specks, and hides what is spare", () => {
    const effects = new EffectsSystem();
    const at = new THREE.Vector3();
    effects.spawnBurst(at, 0xffffff, 40, { life: 0.1 });
    for (let i = 0; i < 10; i += 1) effects.update(1 / 30);
    effects.spawnBurst(at, 0xff0000, 33, { life: 1 });
    const points = effects.group.children.filter((node) => (node as THREE.Points).isPoints && node.visible && node.name === "") as THREE.Points[];
    expect(points).toHaveLength(1);
    expect(points[0].geometry.drawRange.count).toBe(33);
    expect((points[0].material as THREE.PointsMaterial).color.getHex()).toBe(0xff0000);
    effects.clear();
    expect(effects.group.children.filter((node) => node.visible && node.name === "")).toHaveLength(0);
  });

  it("leaves with the old board what other systems hung in the group, and keeps its own spares", () => {
    const effects = new EffectsSystem();
    effects.spawnFlash(new THREE.Vector3());
    const trail = new THREE.Mesh();
    effects.group.add(trail);
    effects.clear();
    expect(trail.parent).toBeNull();
    expect(effects.stats()).toMatchObject({ live: 0, spare: 1 });
    effects.dispose();
    expect(effects.group.children).toHaveLength(0);
  });
});
