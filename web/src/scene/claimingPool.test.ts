import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { Claiming, type ClaimRequest } from "./vfx/mystic/claiming";

const camera = new THREE.PerspectiveCamera(45, 1.6, 0.1, 200);

function request(kind: ClaimRequest["kind"], events: string[]): ClaimRequest {
  return {
    kind, body: { x: 0, y: 0.3, z: 0 }, stone: { x: 0, y: 0, z: 0 }, soul: 0xff6040, quality: "medium", brief: false,
    unmake: (amount) => { if (amount >= 1 && !events.includes("gone")) events.push("gone"); },
    onTouch: () => events.push("touch"),
  };
}

/** Plays every ritual to its end. */
function finish(claiming: Claiming): void {
  for (let i = 0; i < 2000 && claiming.active > 0; i += 1) claiming.update(1 / 30, camera, 720, 1);
}

function madeSince(): { material: number; object: number } {
  const material = new THREE.ShaderMaterial(), object = new THREE.Object3D();
  material.dispose();
  return { material: material.id, object: object.id };
}

describe("claim pooling (A-26)", () => {
  it("takes the next capture with the claim the last one finished, from its first moment", () => {
    const claiming = new Claiming();
    const first: string[] = [];
    const handle = claiming.begin(request("p", first));
    finish(claiming);
    expect(first).toEqual(["touch", "gone"]);
    expect(claiming.spare).toEqual({ claims: 1, palms: 1 });

    const start = madeSince();
    const second: string[] = [];
    const next = claiming.begin(request("q", second));
    const end = madeSince();
    // Only madeSince's own probes: the beam, the landing and the palm were reused.
    expect(end.material - start.material).toBe(1);
    expect(end.object - start.object).toBe(1);
    expect(claiming.spare).toEqual({ claims: 0, palms: 0 });
    // A Queen is taken more slowly than a Pawn: the reused claim follows its new timeline.
    expect(next.timeline.total).toBeGreaterThan(handle.timeline.total);
    expect(claiming.object.children.filter((node) => node.visible)).toHaveLength(1);
    finish(claiming);
    expect(second).toEqual(["touch", "gone"]);
    claiming.dispose();
    expect(claiming.spare).toEqual({ claims: 0, palms: 0 });
  });
});
