import * as THREE from "three";

import { BoardView, squareToWorld, TILE } from "./board";

/** A stand-in for look/board/board.glb: Blender metres (2.3 m squares), tiles named by square, plus a base. */
function bakedModel(squares: string[]): THREE.Group {
  const root = new THREE.Group();
  for (const square of squares) {
    const tile = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.41, 2.1), new THREE.MeshStandardMaterial());
    tile.name = `CFCL_Board_Tile_${square}`;
    const at = squareToWorld(square).multiplyScalar(2.3 / TILE);
    tile.position.set(at.x, -0.205, at.z);
    root.add(tile);
  }
  const base = new THREE.Mesh(new THREE.BoxGeometry(21.85, 1, 21.85), new THREE.MeshStandardMaterial());
  base.name = "CFCL_Board_Base";
  root.add(base);
  return root;
}

const worldOf = (object: THREE.Object3D) => object.getWorldPosition(new THREE.Vector3());

test("baked board tiles land on their squares, follow tile jolts and keep the game tiles pickable", () => {
  const board = new BoardView();
  const model = bakedModel(["a1", "e4", "h8"]);
  const e4 = model.getObjectByName("CFCL_Board_Tile_e4")!;
  board.setBakedBoard(model);
  board.group.updateMatrixWorld(true);

  for (const square of ["a1", "e4", "h8"]) {
    const baked = board.group.getObjectByName(`CFCL_Board_Tile_${square}`)!;
    const centre = squareToWorld(square);
    expect(worldOf(baked).x).toBeCloseTo(centre.x, 5);
    expect(worldOf(baked).z).toBeCloseTo(centre.z, 5);
    expect(new THREE.Box3().setFromObject(baked).max.y).toBeCloseTo(0, 5);
  }
  const gameTile = board.tiles.find((tile) => tile.userData.square === "e4")!;
  expect(e4.parent).toBe(gameTile);
  expect((gameTile.material as THREE.Material).visible).toBe(false);

  // A capture jolt moves and tilts the game tile; the baked tile rides along, fixed in the tile's frame.
  const rest = worldOf(e4);
  const inTile = gameTile.worldToLocal(worldOf(e4));
  board.impact("e4", 0xff6a3c, 1);
  board.update(0.05);
  board.group.updateMatrixWorld(true);
  expect(worldOf(gameTile).distanceTo(gameTile.userData.home as THREE.Vector3)).toBeGreaterThan(0.001);
  expect(worldOf(e4).distanceTo(rest)).toBeGreaterThan(0.001);
  expect(gameTile.worldToLocal(worldOf(e4)).distanceTo(inTile)).toBeLessThan(1e-6);

  // Invisible tiles are still what pointer picking hits.
  const ray = new THREE.Raycaster(squareToWorld("e4", 5), new THREE.Vector3(0, -1, 0));
  board.update(5);
  board.group.updateMatrixWorld(true);
  expect(ray.intersectObjects(board.tiles, false)[0]?.object.userData.square).toBe("e4");
  board.dispose();
});

test("null restores the procedural board and disposes the baked one", () => {
  const board = new BoardView();
  const model = bakedModel(["e4"]);
  const geometry = (model.getObjectByName("CFCL_Board_Tile_e4") as THREE.Mesh).geometry;
  let disposed = false;
  geometry.addEventListener("dispose", () => { disposed = true; });
  board.setBakedBoard(model);
  board.setBakedBoard(null);
  expect(disposed).toBe(true);
  expect(board.group.getObjectByName("CFCL_Board_Tile_e4")).toBeUndefined();
  expect(board.group.getObjectByName("board-baked")).toBeUndefined();
  expect(board.tiles.every((tile) => (tile.material as THREE.Material).visible)).toBe(true);
  board.dispose();
});

// ------------------------------------------------------------------------------------------------- markers

/** The four layers every marker is drawn in, and how many marks each will draw this frame. */
function markerLayers(board: BoardView) {
  const layer = (name: string) => {
    const mesh = board.group.getObjectByName(name) as THREE.Mesh<THREE.InstancedBufferGeometry>;
    const numbers = (attribute: string, index: number) => Array.from((mesh.geometry.getAttribute(attribute).array as Float32Array).slice(index * 4, index * 4 + 4));
    return { mesh, count: () => mesh.geometry.instanceCount, pose: (index: number) => numbers("aPose", index), tint: (index: number) => numbers("aTint", index) };
  };
  return { pools: layer("markers-pools"), over: layer("markers-over"), figures: layer("markers-figures"), shafts: layer("markers-shafts") };
}

test("a board full of markers is drawn in four calls, and an empty one in none", () => {
  const board = new BoardView();
  const layers = markerLayers(board);
  board.update(0.016);
  expect([layers.pools.count(), layers.over.count(), layers.figures.count(), layers.shafts.count()]).toEqual([0, 0, 0, 0]);

  // A queen's worth of destinations of every kind, the shade over everything else, the cursor and a blow.
  const lit = ["d4", "d5", "d6", "d7", "c5", "b6", "a7", "e5", "f6", "g7", "c4", "b4", "a4", "e4", "f4", "g4", "h4", "d3", "d2", "c3", "e3"];
  board.setHighlight("d4", "select");
  lit.slice(1).forEach((square, index) => board.setHighlight(square, (["move", "capture", "castle", "promote", "hint", "check", "last"] as const)[index % 7], index % 2 === 0));
  board.setShroud(lit, "d4");
  board.setHover("h8");
  board.land("a1");
  board.impact("h1");
  board.update(0.05);
  board.update(0.05);
  board.update(0.3);

  // Nothing else in the board's group belongs to a marker: 64 tiles, the base, its trim and the four layers.
  expect(board.group.children.length).toBe(64 + 2 + 4);
  expect(layers.pools.count()).toBeGreaterThanOrEqual(lit.length + 1);
  expect(layers.over.count()).toBeGreaterThanOrEqual(lit.length + 1 + (64 - lit.length));
  expect(layers.figures.count()).toBeGreaterThan(0);
  expect(layers.shafts.count()).toBe(3);
  board.dispose();
});

test("a marker fades out rather than vanishing, and one set again at once never drops", () => {
  const board = new BoardView();
  const layers = markerLayers(board);
  board.setHighlight("e4", "last");
  board.update(1);
  expect(layers.pools.count()).toBe(1);
  const full = layers.pools.tint(0);

  // What the engine does when a selection is dropped: everything cleared, the last move put straight back.
  board.clearHighlights();
  board.setHighlight("e4", "last");
  board.update(0.016);
  expect(layers.pools.count()).toBe(1);
  // Its slow breath moves it a few parts in a hundred between frames; a marker starting again would be near nothing.
  expect(layers.pools.tint(0)[0] / full[0]).toBeGreaterThan(0.9);

  board.clearHighlights();
  board.update(0.03);
  expect(layers.pools.count()).toBe(1);
  expect(Math.abs(layers.pools.tint(0)[0])).toBeLessThan(Math.abs(full[0]));
  board.update(1);
  expect(layers.pools.count()).toBe(0);
  expect(layers.over.count()).toBe(0);
  board.dispose();
});

test("with motion reduced a marker stands at full strength at once, holds still and goes at once", () => {
  const moving = new BoardView();
  moving.setHighlight("e4", "move");
  moving.update(0.01);
  const rising = markerLayers(moving).over.tint(0)[1];

  const still = new BoardView();
  const layers = markerLayers(still);
  still.setReducedMotion(true);
  still.setHighlight("e4", "move", true, 0.1);
  still.setShroud(["e4"], "e2");
  still.update(0.01);
  // The shade is drawn first, the line after it.
  expect(layers.over.count()).toBe(64);
  const first = layers.over.tint(63);
  expect(first[1]).toBeGreaterThan(rising * 5);
  still.update(0.37);
  expect(layers.over.tint(63)).toEqual(first);
  expect(layers.over.tint(0)[3]).toBeGreaterThan(0.5);

  still.clearHighlights();
  still.update(0.01);
  expect(layers.over.count()).toBe(0);
  expect(layers.pools.count()).toBe(0);
  moving.dispose();
  still.dispose();
});

test("a promotion square has light standing on it and its crown faces the side promoting", () => {
  const board = new BoardView();
  const layers = markerLayers(board);
  board.setHighlight("e8", "promote");
  board.update(1);
  expect(layers.shafts.count()).toBe(1);
  expect(layers.over.pose(0)[3]).toBe(0);
  expect(layers.over.pose(0).slice(0, 2)).toEqual([squareToWorld("e8").x, squareToWorld("e8").z].map(Math.fround));

  board.clearHighlights();
  board.update(1);
  board.setHighlight("d1", "promote");
  board.update(1);
  expect(layers.over.pose(0)[3]).toBeCloseTo(Math.PI, 5);

  // No other kind stands light in the air.
  board.clearHighlights();
  board.update(1);
  for (const kind of ["select", "move", "capture", "castle", "last", "check", "hint"] as const) board.setHighlight("a3", kind), board.update(1), expect(layers.shafts.count()).toBe(0);
  board.dispose();
});

test("the cursor is drawn last, over whatever marks its square", () => {
  const board = new BoardView();
  const layers = markerLayers(board);
  board.setHighlight("c6", "capture");
  board.setHover("c6");
  board.update(1);
  expect(layers.over.count()).toBe(2);
  expect(layers.over.pose(1).slice(0, 2)).toEqual(layers.over.pose(0).slice(0, 2));
  board.setHover(null);
  board.update(1);
  expect(layers.over.count()).toBe(1);
  board.dispose();
});

test("a pass drawing the scene with a material of its own draws nothing of the markers", () => {
  // Depth of field and ambient occlusion draw the scene again with their own material, which reads only `position`.
  const board = new BoardView();
  for (const name of ["markers-pools", "markers-over", "markers-figures", "markers-shafts"]) {
    const geometry = (board.group.getObjectByName(name) as THREE.Mesh).geometry;
    const position = geometry.getAttribute("position");
    expect(Array.from(position.array as Float32Array).every((value) => value === 0)).toBe(true);
    expect(geometry.getAttribute("aCorner").count).toBe(position.count);
  }
  board.dispose();
});
