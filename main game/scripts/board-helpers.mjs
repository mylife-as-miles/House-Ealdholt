import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

/** Test-only observation of the real engine, with no hooks shipped in the application. */
export async function installBoardProbe(page) {
  const source = fileURLToPath(new URL('../../web/src/scene/sceneEngine.ts', import.meta.url)).replaceAll('\\', '/');
  await page.evaluate(async url => {
    const { SceneEngine } = await import(url);
    const { squareToWorld } = await import(url.replace('sceneEngine.ts', 'board.ts'));
    const original = SceneEngine.prototype.setBakedBoard;
    SceneEngine.prototype.setBakedBoard = function (model) {
      original.call(this, model);
      window.__boardProbe = { ...this.getBattlefieldContext(), squareToWorld };
    };
  }, `/@fs/${source}`);
}

export async function verifyActualBoard(page) {
  const result = await page.evaluate(() => {
    const { scene, camera, squareToWorld } = window.__boardProbe;
    scene.updateMatrixWorld(true);
    const tiles = [], failures = [], materials = new Set(), materialNames = new Set(), textures = new Set(); let triangles = 0, meshes = 0;
    scene.traverse(object => {
      if (!object.isMesh || !object.name.startsWith('CFCL_Board_')) return;
      // The scenery keeps hidden source meshes for reference; only the playable board renders.
      for (let parent = object; parent; parent = parent.parent) if (!parent.visible) return;
      triangles += object.geometry.index.count / 3;
      meshes++;
      materials.add(object.material.uuid);
      materialNames.add(object.material.name);
      for (const value of Object.values(object.material)) if (value?.isTexture) textures.add(value.uuid);
      const square = /^CFCL_Board_Tile_([a-h][1-8])$/.exec(object.name)?.[1];
      if (!square) return;
      object.geometry.computeBoundingBox();
      const box = object.geometry.boundingBox.clone().applyMatrix4(object.matrixWorld);
      const center = box.getCenter(camera.position.clone()), expected = squareToWorld(square);
      tiles.push(square);
      if (Math.abs(center.x - expected.x) > .001 || Math.abs(center.z - expected.z) > .001 || Math.abs(box.max.y) > .001) failures.push(`${square}: position`);
      if (object.parent.userData.square !== square || object.parent.material.visible !== false) failures.push(`${square}: picking parent`);
    });
    return { tiles: tiles.sort(), failures, meshes, materials: materials.size, materialNames: [...materialNames], textures: textures.size, triangles };
  });
  assert.equal(result.tiles.length, 64, JSON.stringify(result)); assert.equal(new Set(result.tiles).size, 64);
  assert.deepEqual(result.failures, []); assert.equal(result.meshes, 69); assert.equal(result.triangles, 142884);
  // GLTFLoader clones the shared material for meshes using derivative tangents.
  assert.deepEqual(result.materialNames, ['CF_Board_Baked']); assert.ok(result.materials <= 2); assert.equal(result.textures, 3);
  return result;
}

export async function clickBoardSquare(page, square) {
  const point = await page.evaluate(square => {
    const { camera, squareToWorld } = window.__boardProbe;
    camera.updateMatrixWorld(true);
    const p = squareToWorld(square, .01).project(camera);
    const r = document.querySelector('canvas[aria-label="Crownfall chessboard"]').getBoundingClientRect();
    return { x: r.left + (p.x + 1) * r.width / 2, y: r.top + (1 - p.y) * r.height / 2 };
  }, square);
  assert.ok(Number.isFinite(point.x) && Number.isFinite(point.y));
  await page.mouse.click(point.x, point.y);
}
