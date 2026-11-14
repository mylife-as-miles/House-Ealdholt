import assert from 'node:assert/strict';
import test from 'node:test';
import {BoxGeometry, Group, Matrix4, Mesh, MeshStandardMaterial, type DataTexture} from 'three';
import {createGrassGroundLook} from './grass-ground-look';
import {buildGrassGroundField} from '../../../../shared/legacy/aethelgard/environment/grass-ground-field';
import {createWorldPreparationQueue} from '../../../../shared/legacy/aethelgard/environment/world-preparation-queue';
import type {VegetationPreparationWorker} from './vegetation-worker';
import type {VegetationCellHlod} from './vegetation-cell-hlod';

test('grass L3 publishes only after colour, normal and height upload and restores original terrain bindings', async () => {
  const source = new Group(), geometry = new BoxGeometry(4, .2, 4), material = new MeshStandardMaterial();
  const terrain = new Mesh(geometry, material); terrain.name = 'LandscapeComponent_0'; source.add(terrain);
  let ready = 0, uploads = 0, borrowedDisposed = 0;
  geometry.addEventListener('dispose', () => borrowedDisposed++); material.addEventListener('dispose', () => borrowedDisposed++);
  const pixels = new Uint8Array(16 * 16 * 4).fill(255), normal = pixels.slice();
  const patch = {id: 'grass_cell_0_0:0', matrix: new Matrix4().toArray(), bounds: [-1, -1, 1, 1] as const, size: 16, pixels, normals: normal};
  const cell = {groundPatches: Promise.resolve([patch]), groundReady() {ready++;}} as unknown as VegetationCellHlod;
  const queue = createWorldPreparationQueue(() => {}, 64, 2 * 1024 * 1024);
  const worker = {ground: async input => buildGrassGroundField(input)} as VegetationPreparationWorker;
  const field = createGrassGroundLook(source, [cell], {worker, queue, signal: new AbortController().signal,
    renderer: {initTexture(_texture: DataTexture) {uploads++; assert.equal(ready, 0);}}, changed() {}});
  for (let i = 0; i < 80 && field.stats.status === 'preparing'; i++) {queue.step(); await new Promise(resolve => setTimeout(resolve, 0));}
  await field.preparation; assert.equal(field.stats.status, 'ready'); assert.equal(uploads, 3); assert.equal(ready, 1);
  assert.notEqual(terrain.material, material); field.dispose(); await field.preparation;
  assert.equal(terrain.material, material); assert.equal(borrowedDisposed, 0); queue.dispose(); geometry.dispose(); material.dispose();
});

test('cancelled grass-field generation cannot mark grass L3 ready or replace source PBR materials', async () => {
  const source = new Group(), material = new MeshStandardMaterial(), geometry = new BoxGeometry();
  const terrain = new Mesh(geometry, material); terrain.name = 'LandscapeComponent_0'; source.add(terrain);
  let ready = 0, finish!: (value: never) => void;
  const pixels = new Uint8Array(16 * 16 * 4).fill(255);
  const cell = {groundPatches: Promise.resolve([{id: 'grass', matrix: new Matrix4().toArray(), bounds: [-1, -1, 1, 1], size: 16, pixels, normals: pixels}]), groundReady() {ready++;}} as unknown as VegetationCellHlod;
  const queue = createWorldPreparationQueue(() => {}), worker = {ground: () => new Promise(resolve => {finish = resolve;})} as unknown as VegetationPreparationWorker;
  const field = createGrassGroundLook(source, [cell], {worker, queue, signal: new AbortController().signal, renderer: {initTexture() {throw Error('unexpected upload');}}, changed() {}});
  await new Promise(resolve => setTimeout(resolve, 0)); field.dispose(); finish({} as never); await field.preparation;
  assert.equal(ready, 0); assert.equal(terrain.material, material); queue.dispose(); geometry.dispose(); material.dispose();
});
