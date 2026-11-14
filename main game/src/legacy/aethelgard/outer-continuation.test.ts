import assert from 'node:assert/strict';
import { createEaldholtOuterContinuation } from './outer-continuation';
import test from 'node:test';
import { Box3, BoxGeometry, BufferGeometry, Group, InstancedMesh, Matrix4, Mesh, MeshStandardMaterial, PlaneGeometry } from 'three';
import { createEaldholtBankLandform } from './bank-landform';
import { createEaldholtCoastalContinuity } from './coastal-continuity';
import { createEaldholtRiverValley } from './river-valley';
import { createEaldholtRiverWoodland } from './river-woodland';
const profile = 'desktop' as const;
function fixture() {
  const root = new Group(), ground = new PlaneGeometry(150, 150, 12, 12).rotateX(-Math.PI / 2), material = new MeshStandardMaterial({ alphaTest: .3 });
  const terrain = new Mesh(ground, material); terrain.name = 'LandscapeComponent_0'; terrain.position.set(25, 2, 25); root.add(terrain);
  const prototype = new Group(); prototype.name = 'SM_BlackAlder_Forest_05_PP3_ExteriorPrototype';
  prototype.userData.crownfallWoodlandPrototype = { schema: 1, family: 'SM_BlackAlder_Forest_05_PP3', hidden: true, components: 3 }; root.add(prototype);
  const geometries = [new BoxGeometry(.4, 5, .4).translate(0, 2.5, 0), new BoxGeometry(3, 3, 3).translate(0, 5, 0), new BoxGeometry(.2, 3, .2).translate(0, 1.5, 0)];
  for (const geometry of geometries) { const part = new InstancedMesh(geometry, material, 1); part.setMatrixAt(0, new Matrix4()); prototype.add(part); }
  const valley = createEaldholtRiverValley(root, undefined, { profile }); root.add(valley.object);
  const woodland = createEaldholtRiverWoodland(root, valley.object, { profile }); root.add(woodland.object);
  const bank = createEaldholtBankLandform(root, valley.object, woodland, { profile }), land = valley.object.children[0] as Mesh;
  const continuity = createEaldholtCoastalContinuity(root, valley.object, bank, { profile });
  return { root, ground, material, valley, woodland, bank, land, continuity, dispose() { continuity.dispose(); bank.dispose(); woodland.dispose(); valley.dispose(); for (const g of [ground, ...geometries]) g.dispose(); material.dispose(); } };
}
const snapshot = (g: BufferGeometry) => ({ indices: Array.from(g.index!.array), attributes: Object.fromEntries(Object.entries(g.attributes).map(([name, a]) => [name, Array.from(a.array)])) });
test('parentless owned rings borrow materials, preserve old buffers and participate in real bounds', () => {
  const f = fixture(), source = f.valley.object.children.map(o => snapshot((o as Mesh).geometry)), oldBounds = new Box3().setFromObject(f.root);
  let borrowedDisposals = 0; const materials = new Set(f.valley.object.children.map(o => (o as Mesh).material));
  for (const m of materials) if (!Array.isArray(m)) m.addEventListener('dispose', () => borrowedDisposals++);
  for (const o of f.valley.object.children) (o as Mesh).geometry.addEventListener('dispose', () => borrowedDisposals++);
  const h = createEaldholtOuterContinuation(f.root, f.valley.object, { profile }); assert.equal(h.object.parent, null); assert.equal(h.drawCalls, 2);
  assert.equal((h.object.children[0] as Mesh).material, f.land.material); assert.equal((h.object.children[1] as Mesh).material, (f.valley.object.children[2] as Mesh).material);
  const geometries = h.object.children.map(o => (o as Mesh).geometry); let ownedDisposals = 0;
  for (const g of geometries) { g.addEventListener('dispose', () => ownedDisposals++); for (const name of ['uv1', 'uv2', 'uv3']) assert.equal(g.getAttribute(name), g.getAttribute('uv')); }
  const arrays = new Set(geometries.flatMap(g => [...Object.values(g.attributes).map(a => a.array), g.index!.array]));
  assert.equal([...arrays].reduce((n, a) => n + a.byteLength, 0), h.bufferBytes);
  assert.deepEqual(f.valley.object.children.map(o => snapshot((o as Mesh).geometry)), source);
  f.valley.object.add(h.object); const next = new Box3().setFromObject(f.root);
  assert.ok(next.containsBox(oldBounds)); assert.equal(next.min.x, Math.fround(oldBounds.min.x - h.westWidth));
  assert.equal(next.min.y, oldBounds.min.y); assert.equal(next.max.y, oldBounds.max.y); assert.equal(next.max.z, oldBounds.max.z);
  assert.equal(h.object.userData.iwsdkPreviewBounds, undefined);
  h.dispose(); h.dispose(); assert.equal(ownedDisposals, 2); assert.equal(borrowedDisposals, 0); assert.equal(h.object.parent, null);
  assert.ok(new Box3().setFromObject(f.root).equals(oldBounds)); f.dispose();
});
test('miniature transforms cancel and incomplete graphs fail without installing anything', () => {
  const f = fixture(), a = createEaldholtOuterContinuation(f.root, f.valley.object, { profile });
  const expected = a.object.children.map(o => snapshot((o as Mesh).geometry)); a.dispose();
  f.root.scale.setScalar(.02); f.root.position.set(3, 4, -2); f.root.rotation.set(.1, .4, .05);
  const b = createEaldholtOuterContinuation(f.root, f.valley.object, { profile });
  assert.deepEqual(b.object.children.map(o => snapshot((o as Mesh).geometry)), expected); b.dispose();
  const marker = f.land.geometry.userData.crownfallCoastalContinuity; delete f.land.geometry.userData.crownfallCoastalContinuity;
  assert.throws(() => createEaldholtOuterContinuation(f.root, f.valley.object, { profile }), /completed bank/);
  f.land.geometry.userData.crownfallCoastalContinuity = marker; f.dispose();
});
