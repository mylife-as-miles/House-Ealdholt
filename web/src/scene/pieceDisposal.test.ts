import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { disposeSculpt } from "./pieces";

describe("an army's sculpts let go", () => {
  it("frees the textures its materials hold, once each, with the geometry and materials (A-25)", () => {
    const shared = new THREE.Texture(), normal = new THREE.Texture();
    const body = new THREE.MeshStandardMaterial({ map: shared, normalMap: normal });
    const arms = new THREE.MeshStandardMaterial({ map: shared });
    const geometry = new THREE.BufferGeometry();
    const root = new THREE.Group();
    root.add(new THREE.Mesh(geometry, body), new THREE.Mesh(geometry, [arms, body]));
    const freed: string[] = [];
    for (const [name, item] of [["map", shared], ["normal", normal], ["body", body], ["arms", arms], ["geometry", geometry]] as const) {
      item.addEventListener("dispose", () => freed.push(name));
    }
    disposeSculpt(root);
    expect(freed.sort()).toEqual(["arms", "body", "geometry", "map", "normal"]);
  });
});
