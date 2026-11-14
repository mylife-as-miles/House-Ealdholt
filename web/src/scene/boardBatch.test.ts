import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";

// The board's pictures are painted on a canvas, and these tests run without a page: blank textures stand in.
vi.mock("./textures", async (original) => {
  const actual = await original<typeof import("./textures")>();
  const { Texture } = await import("three");
  return { ...actual, boardBorderTexture: () => new Texture(), marbleTexture: () => new Texture(), markerAtlasTexture: () => new Texture() };
});
import { BoardView, squareToWorld, TILE } from "./board";

/** look/board/board.glb in miniature: 64 tiles sharing one material, named by square, and a base. */
function bakedModel(): { root: THREE.Group; material: THREE.MeshStandardMaterial } {
  const root = new THREE.Group(), material = new THREE.MeshStandardMaterial();
  for (const file of "abcdefgh") for (let rank = 1; rank <= 8; rank += 1) {
    const square = `${file}${rank}`;
    // One draw range, as the exported tiles have (a box's six groups would be six draws).
    const geometry = new THREE.BoxGeometry(2.1, 0.41, 2.1);
    geometry.clearGroups();
    const tile = new THREE.Mesh(geometry, material);
    tile.name = `CFCL_Board_Tile_${square}`;
    const at = squareToWorld(square).multiplyScalar(2.3 / TILE);
    tile.position.set(at.x, -0.205, at.z);
    root.add(tile);
  }
  const base = new THREE.Mesh(new THREE.BoxGeometry(21.85, 1, 21.85), new THREE.MeshStandardMaterial());
  base.name = "CFCL_Board_Base";
  root.add(base);
  return { root, material };
}

const centreOf = (batch: THREE.BatchedMesh, id: number) => new THREE.Vector3().setFromMatrixPosition(batch.getMatrixAt(id, new THREE.Matrix4()));

describe("baked board tiles in one draw (A-14)", () => {
  it("draws the 64 tiles as one batch that follows their jolts, and frees it with the board", () => {
    const board = new BoardView();
    const { root } = bakedModel();
    board.setBakedBoard(root);
    const batch = board.group.getObjectByName("board-baked-tiles") as THREE.BatchedMesh;
    expect(batch?.isBatchedMesh).toBe(true);
    expect(batch.instanceCount).toBe(64);
    const e4 = board.group.getObjectByName("CFCL_Board_Tile_e4") as THREE.Mesh;
    expect(e4.visible).toBe(false);

    // Every instance where its tile is: on its square, its top at the board's top.
    board.update(0);
    const e4Id = 8 * 4 + 3; // the model's order: a1..a8, b1.., so e4 is the 36th tile
    expect(centreOf(batch, e4Id).x).toBeCloseTo(squareToWorld("e4").x, 5);
    expect(centreOf(batch, e4Id).z).toBeCloseTo(squareToWorld("e4").z, 5);

    // A jolt moves the tile, and the batch with it; at rest it is home again.
    const rest = centreOf(batch, e4Id);
    board.impact("e4", 0xff6a3c, 1);
    board.update(0.05);
    expect(centreOf(batch, e4Id).distanceTo(rest)).toBeGreaterThan(0.001);
    board.update(5);
    board.update(0);
    expect(centreOf(batch, e4Id).distanceTo(rest)).toBeLessThan(1e-6);

    let disposed = false;
    batch.geometry.addEventListener("dispose", () => { disposed = true; });
    board.setBakedBoard(null);
    expect(disposed).toBe(true);
    expect(board.group.getObjectByName("board-baked-tiles")).toBeUndefined();
    board.dispose();
  });

  it("keeps separate tiles when they do not share a material", () => {
    const board = new BoardView();
    const { root } = bakedModel();
    (root.getObjectByName("CFCL_Board_Tile_a1") as THREE.Mesh).material = new THREE.MeshStandardMaterial();
    board.setBakedBoard(root);
    expect(board.group.getObjectByName("board-baked-tiles")).toBeUndefined();
    expect(board.group.getObjectByName("CFCL_Board_Tile_e4")!.visible).toBe(true);
    board.dispose();
  });
});
