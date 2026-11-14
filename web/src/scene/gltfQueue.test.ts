import { describe, expect, it } from "vitest";
import type { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

import { loadGltf } from "./gltfQueue";

describe("a queued GLB download called off (A-07)", () => {
  it("is not tried again once its signal has fired, and one not yet begun never starts", async () => {
    const leaving = new AbortController();
    let calls = 0;
    const loader = { loadAsync: async () => { calls += 1; leaving.abort(); throw new TypeError("Failed to fetch"); } } as unknown as GLTFLoader;
    await expect(loadGltf(loader, "pawn.glb", 5, leaving.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(calls).toBe(1);
    await expect(loadGltf(loader, "rook.glb", 5, leaving.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(calls).toBe(1);
  });
});
