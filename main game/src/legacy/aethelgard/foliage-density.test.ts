import assert from 'node:assert/strict';
import test from 'node:test';
import { Box3, BoxGeometry, Group, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, PlaneGeometry, Sphere, Vector3 } from 'three';
import { createEaldholtFoliageDensity } from './foliage-density';

function fixture(family = 'alder', components = 3, capacity = 5) {
  const root = new Group(), owner = new Group(), material = new MeshBasicMaterial(), meshes: InstancedMesh[] = [];
  owner.userData.crownfallFoliageDensity = { schema: 1, family, components, counts: { low: 1, medium: 3, high: 5 } };
  for (let part = 0; part < components; part++) {
    const mesh = new InstancedMesh(part === 1 ? new PlaneGeometry(1, 1) : new BoxGeometry(1, 1, 1), material, capacity);
    for (let index = 0; index < capacity; index++) mesh.setMatrixAt(index, new Matrix4().makeTranslation(index === 4 ? 100 : index * 2, part, 0));
    meshes.push(mesh); owner.add(mesh);
  }
  root.add(owner);
  return { root, owner, meshes, material, cleanup() { for (const mesh of meshes) { mesh.dispose(); mesh.geometry.dispose(); } material.dispose(); } };
}

test('authored family tiers select whole actors and retain maximum-pool culling bounds', () => {
  const f = fixture();
  try {
    const matrixArrays = f.meshes.map(mesh => mesh.instanceMatrix.array.slice());
    const handle = createEaldholtFoliageDensity(f.root, 'low');
    assert.deepEqual(f.meshes.map(mesh => mesh.count), [1, 1, 1]);
    assert.equal(handle.diagnostics.selectedActors, 1);
    assert.equal(handle.diagnostics.selectedTriangles, 26);
    assert.equal(handle.diagnostics.selectedDrawCalls, 3);
    for (const mesh of f.meshes) {
      assert.ok(mesh.boundingBox!.max.x >= 100.5);
      assert.ok(mesh.boundingSphere!.containsPoint(new Vector3(100, mesh.position.y, 0)));
      assert.equal(mesh.geometry.boundingBox, null, 'shared geometry bounds stay untouched');
    }
    const boxes = f.meshes.map(mesh => mesh.boundingBox), spheres = f.meshes.map(mesh => mesh.boundingSphere), low = handle.diagnostics;
    assert.equal(handle.setQuality('low'), false); assert.equal(handle.diagnostics, low);
    assert.equal(handle.setQuality('high'), true);
    assert.deepEqual(f.meshes.map(mesh => mesh.count), [5, 5, 5]);
    assert.equal(handle.diagnostics.selectedActors, 5); assert.equal(handle.diagnostics.selectedTriangles, 130);
    f.meshes.forEach((mesh, i) => { assert.equal(mesh.boundingBox, boxes[i]); assert.equal(mesh.boundingSphere, spheres[i]); assert.deepEqual(mesh.instanceMatrix.array, matrixArrays[i]); });
    handle.setQuality('medium'); assert.equal(handle.diagnostics.selectedActors, 3);
    handle.dispose(); handle.dispose(); assert.equal(handle.disposed, true);
    assert.deepEqual(f.meshes.map(mesh => mesh.count), [5, 5, 5]);
    for (const mesh of f.meshes) { assert.equal(mesh.boundingBox, null); assert.equal(mesh.boundingSphere, null); }
    assert.equal(handle.setQuality('high'), false);
  } finally { f.cleanup(); }
});

test('density edits affect only clone counts/visibility; untagged original actors and cached resources survive', () => {
  const f = fixture(), source = f.owner, clone = f.root.clone(true), untouched = new InstancedMesh(new BoxGeometry(), f.material, 18);
  clone.add(untouched);
  const clonedOwner = clone.children[0], cloned = clonedOwner.children as InstancedMesh[];
  const previousBox = new Box3(new Vector3(-1, -1, -1), new Vector3(110, 4, 1)), previousSphere = new Sphere(new Vector3(50, 0, 0), 61);
  cloned[0].boundingBox = previousBox; cloned[0].boundingSphere = previousSphere; cloned[2].visible = false;
  const originalMatrix = source.children.map(mesh => (mesh as InstancedMesh).instanceMatrix.array.slice());
  let borrowedDisposals = 0; f.material.addEventListener('dispose', () => borrowedDisposals++);
  for (const mesh of f.meshes) mesh.geometry.addEventListener('dispose', () => borrowedDisposals++);
  clonedOwner.userData.crownfallFoliageDensity.counts.low = 0;
  const handle = createEaldholtFoliageDensity(clone, 'low');
  assert.deepEqual(cloned.map(mesh => mesh.count), [0, 0, 0]); assert.ok(cloned.every(mesh => !mesh.visible));
  assert.equal(untouched.count, 18); assert.equal(untouched.boundingBox, null);
  handle.setQuality('high'); assert.deepEqual(cloned.map(mesh => mesh.visible), [true, true, false]);
  handle.dispose(); assert.equal(cloned[0].boundingBox, previousBox); assert.equal(cloned[0].boundingSphere, previousSphere);
  assert.deepEqual(cloned.map(mesh => mesh.visible), [true, true, false]); assert.equal(borrowedDisposals, 0);
  f.meshes.forEach((mesh, i) => { assert.equal(mesh.count, 5); assert.deepEqual(mesh.instanceMatrix.array, originalMatrix[i]); });
  for (const mesh of cloned) mesh.dispose(); untouched.dispose(); untouched.geometry.dispose(); f.cleanup();
});

test('one invalid family rejects the entire hierarchy before counts, visibility or bounds change', () => {
  const good = fixture('good'), bad = fixture('bad'), root = new Group(); root.add(good.owner, bad.owner);
  bad.owner.userData.crownfallFoliageDensity.counts.high = 6;
  const all = [...good.meshes, ...bad.meshes];
  assert.throws(() => createEaldholtFoliageDensity(root, 'low'), /instance pool|geometry/);
  for (const mesh of all) { assert.equal(mesh.count, 5); assert.equal(mesh.visible, true); assert.equal(mesh.boundingBox, null); assert.equal(mesh.boundingSphere, null); }
  good.cleanup(); bad.cleanup();
});

test('ambiguous ownership, incomplete families and partial geometry safely reject', () => {
  for (const fault of ['missing', 'count', 'nested', 'duplicate', 'static', 'range', 'nan-matrix', 'non-affine', 'duplicate-node'] as const) {
    const f = fixture(), other = fixture('other');
    try {
      if (fault === 'missing') f.owner.userData.crownfallFoliageDensity.components = 4;
      if (fault === 'count') f.meshes[1].count = 4;
      if (fault === 'nested') f.meshes[0].userData.crownfallFoliageDensity = { schema: 1, family: 'nested', components: 1, counts: { low: 0, medium: 1, high: 5 } };
      if (fault === 'duplicate') { other.owner.userData.crownfallFoliageDensity.family = 'alder'; f.root.add(other.owner); }
      if (fault === 'static') f.owner.add(new Mesh(f.meshes[0].geometry, f.material));
      if (fault === 'range') f.meshes[0].geometry.setDrawRange(0, 3);
      if (fault === 'nan-matrix') f.meshes[1].instanceMatrix.array[16] = NaN;
      if (fault === 'non-affine') f.meshes[1].instanceMatrix.array[15] = 0;
      if (fault === 'duplicate-node') f.owner.children.push(f.meshes[0]);
      assert.throws(() => createEaldholtFoliageDensity(f.root, 'low'), /foliage|geometry/);
      for (const mesh of [...f.meshes, ...other.meshes]) { assert.equal(mesh.boundingBox, null); assert.equal(mesh.boundingSphere, null); }
    } finally { f.cleanup(); other.cleanup(); }
  }
});

test('untagged models are a safe no-op and simultaneous density owners cannot overlap', () => {
  const f = fixture(); delete f.owner.userData.crownfallFoliageDensity;
  const empty = createEaldholtFoliageDensity(f.root, 'medium');
  assert.equal(empty.diagnostics.familyCount, 0); assert.equal(empty.diagnostics.selectedActors, 0);
  empty.setQuality('high'); empty.dispose(); assert.ok(f.meshes.every(mesh => mesh.count === 5 && mesh.boundingBox === null)); f.cleanup();
  const tagged = fixture(), first = createEaldholtFoliageDensity(tagged.root, 'low');
  assert.throws(() => createEaldholtFoliageDensity(tagged.root, 'high'), /active density owner/);
  assert.ok(tagged.meshes.every(mesh => mesh.count === 1)); first.dispose();
  const next = createEaldholtFoliageDensity(tagged.root, 'high'); next.dispose(); tagged.cleanup();
});

test('complete multi-material components count all draws without mutating geometry groups', () => {
  const f = fixture('flowers', 1), mesh = f.meshes[0];
  mesh.material = Array.from({ length: 6 }, () => f.material);
  const groups = JSON.stringify(mesh.geometry.groups), handle = createEaldholtFoliageDensity(f.root, 'low');
  assert.equal(handle.diagnostics.selectedActors, 1); assert.equal(handle.diagnostics.selectedTriangles, 12); assert.equal(handle.diagnostics.selectedDrawCalls, 6);
  assert.equal(JSON.stringify(mesh.geometry.groups), groups); handle.dispose(); f.cleanup();
});

test('authored box padding and culling sphere padding stay separate without inflating the model', () => {
  const f = fixture('padded', 1), mesh = f.meshes[0];
  const cachedGeometryBox = new Box3(new Vector3(-4, -4, -4), new Vector3(4, 4, 4));
  const cachedSphere = new Sphere(new Vector3(50, 0, 0), 80);
  mesh.geometry.boundingBox = cachedGeometryBox; mesh.boundingSphere = cachedSphere;
  const handle = createEaldholtFoliageDensity(f.root, 'low');
  assert.equal(mesh.geometry.boundingBox, cachedGeometryBox);
  assert.deepEqual(cachedGeometryBox.min.toArray(), [-4, -4, -4]);
  assert.equal(mesh.boundingBox!.max.x, 104); assert.equal(mesh.boundingBox!.min.x, -4);
  assert.ok(mesh.boundingSphere!.containsPoint(new Vector3(130, 0, 0)), 'culling sphere padding remains conservative separately');
  assert.notEqual(mesh.boundingSphere, cachedSphere); assert.equal(cachedSphere.radius, 80);
  handle.setQuality('high'); assert.equal(mesh.boundingBox!.max.x, 104); assert.equal(mesh.boundingBox!.min.x, -4);
  handle.dispose(); assert.equal(mesh.boundingSphere, cachedSphere); f.cleanup();
});
