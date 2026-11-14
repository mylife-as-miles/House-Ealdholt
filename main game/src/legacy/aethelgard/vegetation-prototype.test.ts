import assert from 'node:assert/strict';
import test from 'node:test';
import {BoxGeometry, Group, InstancedMesh, MeshStandardMaterial, PerspectiveCamera, Scene, type WebGLRenderer} from 'three';
import {createVegetationPrototypeResources} from './vegetation-prototype';
import {createWorldPreparationQueue} from '../../../../shared/legacy/aethelgard/environment/world-preparation-queue';
import type {VegetationPreparationWorker} from './vegetation-worker';

test('shared compiler owns its material program beyond the first cell lease and never reparents source draws', async () => {
  const source = new MeshStandardMaterial(), geometry = new BoxGeometry(), draw = new InstancedMesh(geometry, source, 1), owner = new Group(); owner.add(draw);
  const queue = createWorldPreparationQueue(() => {}); let calls = 0, retired = 0, borrowedRetired = 0;
  source.addEventListener('dispose', () => borrowedRetired++); geometry.addEventListener('dispose', () => borrowedRetired++);
  const renderer = {compileAsync: async (preview: Group) => {
    calls++; const mesh = preview.children[0] as InstancedMesh, material = mesh.material as MeshStandardMaterial;
    assert.notEqual(material, source); assert.equal(mesh.geometry, geometry); assert.equal(material.onBeforeCompile, source.onBeforeCompile);
    material.addEventListener('dispose', () => retired++);
  }} as unknown as WebGLRenderer;
  const pool = createVegetationPrototypeResources(renderer, queue, {} as VegetationPreparationWorker, 1024);
  const camera = new PerspectiveCamera(), scene = new Scene(), first = pool.compile('source-v1', [draw], camera, scene), second = pool.compile('source-v1', [draw], camera, scene);
  await new Promise(resolve => setTimeout(resolve, 0)); queue.step(); await Promise.all([first.ready, second.ready]);
  first.release(); pool.trim(); assert.equal(retired, 0); assert.equal(calls, 1); assert.equal(draw.parent, owner);
  second.release(); pool.trim(); assert.equal(retired, 1); assert.equal(borrowedRetired, 0); pool.dispose(); queue.dispose();
  draw.dispose(); geometry.dispose(); source.dispose();
});
