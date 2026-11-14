import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";

// The strike maps are painted on a canvas, and these tests run without a page.
vi.mock("./textures", async () => {
  const { CanvasTexture, Texture } = await import("three");
  const texture = () => Object.assign(new Texture(), { isCanvasTexture: true }) as unknown as InstanceType<typeof CanvasTexture>;
  return { crescentTexture: texture, factionRingTexture: texture, pillarTexture: texture, shockwaveTexture: texture };
});
import { disposeStrikeAssets, spawnConquestClaim, spawnGroundWave, spawnSlash, strikeSpares } from "./strikes";
import { TweenManager } from "./tween";

async function play(tweens: TweenManager, done: Promise<void>): Promise<void> {
  let finished = false;
  void done.then(() => { finished = true; });
  for (let i = 0; i < 400 && !finished; i += 1) { tweens.update(1 / 30); await Promise.resolve(); await Promise.resolve(); }
  await done;
}

function nextMaterialId(): number { const material = new THREE.MeshBasicMaterial(); material.dispose(); return material.id; }

describe("strike pooling (A-26)", () => {
  it("reuses the discs and slashes of one blow for the next", async () => {
    const scene = new THREE.Group(), tweens = new TweenManager(), at = new THREE.Vector3(1, 0, 2);
    const blow = async () => {
      await play(tweens, spawnSlash(scene, tweens, at, { color: 0xffffff, size: 1 }));
      await play(tweens, spawnGroundWave(scene, tweens, at, { color: 0xff8800, radius: 2, height: 0.02, echo: true }));
      await play(tweens, spawnConquestClaim(scene, tweens, at, { color: 0x3355ff, radius: 2, height: 0.02 }));
    };
    await blow();
    expect(scene.children).toHaveLength(0);
    expect(strikeSpares()).toEqual({ discs: 2, slashes: 1 });
    const start = nextMaterialId();
    for (let i = 0; i < 10; i += 1) await blow();
    expect(nextMaterialId() - start).toBe(1);
    expect(scene.children).toHaveLength(0);
    disposeStrikeAssets();
    expect(strikeSpares()).toEqual({ discs: 0, slashes: 0 });
  });
});
