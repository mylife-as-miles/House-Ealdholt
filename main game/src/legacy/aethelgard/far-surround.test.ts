import assert from 'node:assert/strict';
import test from 'node:test';
import { Box3, BoxGeometry, BufferGeometry, Group, InstancedMesh, Matrix4, Mesh, MeshStandardMaterial, PlaneGeometry, Texture, Vector3 } from 'three';
import { createEaldholtFarSurround, createEaldholtFarSurroundBridge } from './far-surround';
import { createEaldholtRiverValley } from './river-valley';
import { createEaldholtBankLandform } from './bank-landform';
import { createEaldholtCoastalContinuity } from './coastal-continuity';
import { createEaldholtOuterContinuation } from './outer-continuation';
import { createEaldholtFarGeography } from '../../../../shared/legacy/aethelgard/environment/far-surround';

function fixture() {
  const root = new Group(), ground = new PlaneGeometry(150, 150, 12, 12).rotateX(-Math.PI / 2), material = new MeshStandardMaterial(), map = new Texture();
  material.map = map;
  const terrain = new Mesh(ground, material); terrain.name = 'LandscapeComponent_0'; terrain.position.set(25, 2, 25); root.add(terrain);
  const actorGeometry = new BoxGeometry(2, 12, 2), actor = new InstancedMesh(actorGeometry, material, 2);
  actor.setMatrixAt(0, new Matrix4().makeTranslation(20, 8, 20)); actor.setMatrixAt(1, new Matrix4().makeTranslation(150, 10, 15)); actor.count = 1; root.add(actor);
  const valley = createEaldholtRiverValley(root, undefined, { profile: 'desktop' }); root.add(valley.object);
  const bank = createEaldholtBankLandform(root, valley.object, null, { profile: 'desktop' });
  const continuity = createEaldholtCoastalContinuity(root, valley.object, bank, { profile: 'desktop' });
  const outer = createEaldholtOuterContinuation(root, valley.object, { profile: 'desktop' }); valley.object.add(outer.object);
  return { root, ground, actor, actorGeometry, material, map, valley, outer,
    dispose() { outer.dispose(); continuity.dispose(); bank.dispose(); valley.dispose(); ground.dispose(); actorGeometry.dispose(); material.dispose(); map.dispose(); } };
}
const snapshot = (g: BufferGeometry) => ({ index: g.index ? Array.from(g.index.array) : null,
  attributes: Object.fromEntries(Object.entries(g.attributes).map(([name, a]) => [name, Array.from(a.array)])) });
const meshes = (root: Group) => { const result: Mesh[] = []; root.traverse(o => { if (o instanceof Mesh) result.push(o); }); return result; };
const inputState = (f: ReturnType<typeof fixture>) => meshes(f.root).map(o => ({ mesh: o, geometry: o.geometry, bounds: o.geometry.boundingBox, sphere: o.geometry.boundingSphere, data: snapshot(o.geometry) }));

test('complete final land + both seas feed three bounded borrowed-material surfaces', () => {
  const f = fixture(), before = inputState(f), h = createEaldholtFarSurround(f.root, f.valley.object);
  assert.equal(h.object.parent, null); assert.equal(h.drawCalls, 3); assert.equal(h.extraTextureBytes, 0);
  assert.ok(h.triangles > 0 && h.triangles <= 1024); assert.ok(h.bufferBytes <= 128 * 1024);
  const [land, sea, channel] = h.object.children as Mesh[], [localLand, localChannel, localSea] = f.valley.object.children as Mesh[];
  const ownedArrays = new Set([land, sea, channel].flatMap(m => [...Object.values(m.geometry.attributes).map(a => a.array), m.geometry.index!.array]));
  assert.equal([...ownedArrays].reduce((sum, a) => sum + a.byteLength, 0), h.bufferBytes);
  assert.equal([land, sea, channel].reduce((sum, m) => sum + m.geometry.index!.count / 3, 0), h.triangles);
  assert.equal(land.material, localLand.material); assert.equal(sea.material, localSea.material); assert.equal(channel.material, localChannel.material);
  assert.deepEqual(before.map(s => snapshot(s.geometry)), before.map(s => s.data));
  for (const s of before) { assert.equal(s.mesh.geometry, s.geometry); assert.equal(s.geometry.boundingBox, s.bounds); assert.equal(s.geometry.boundingSphere, s.sphere); }
  const metadata = h.object.userData.crownfallFarSurround;
  assert.equal(metadata.localPlacementEligible, false); assert.equal(metadata.fullBoundsRequired, true);
  assert.deepEqual(metadata.localBounds, h.localBounds); assert.deepEqual(metadata.completeSolidBounds, h.bounds);
  assert.ok(h.localBounds.max[0] >= 151, 'complete HIGH actor remains represented while current count is one');
  assert.ok(h.bounds.min[0] < h.localBounds.min[0]); assert.ok(h.bounds.max[2] > h.localBounds.max[2]);
  for (const m of [land, sea, channel]) {
    assert.equal(m.userData.crownfallFarSurround.localPlacementEligible, false); assert.equal(m.userData.iwsdkPreviewBounds, undefined);
    for (const name of ['uv1', 'uv2', 'uv3']) assert.equal(m.geometry.getAttribute(name), m.geometry.getAttribute('uv'));
  }
  h.dispose(); f.dispose();
});

test('far seams reuse exact actual geometry and shader attribute tuples', () => {
  const f = fixture(), h = createEaldholtFarSurround(f.root, f.valley.object);
  const local = meshes(f.valley.object as Group);
  for (const [far, kind] of (h.object.children as Mesh[]).map(m => [m, m.userData.crownfallElderbloom.kind] as const)) {
    const inputs = local.filter(m => m.userData.crownfallElderbloom?.kind === kind && (kind === 'terrain' || (/river/.test(far.name) ? /regional river/.test(m.name) : /sea/.test(m.name))));
    const tuples = new Map<string, number[][]>();
    const names = ['normal', 'color', 'uv', ...(kind === 'terrain' ? ['ealdholtShoreWetness'] : ['ealdholtWaterAcross', 'ealdholtWaterHalfWidth'])];
    for (const m of inputs) { const p = m.geometry.getAttribute('position'); for (let i = 0; i < p.count; i++) {
      const key = [p.getX(i), p.getY(i), p.getZ(i)].join(':');
      const tuple = names.flatMap(name => { const a = m.geometry.getAttribute(name); return Array.from({ length: a.itemSize }, (_, j) => a.getComponent(i, j)); });
      const existing = tuples.get(key) ?? []; existing.push(tuple); tuples.set(key, existing);
    } }
    let matches = 0; const p = far.geometry.getAttribute('position');
    for (let i = 0; i < p.count; i++) {
      const candidates = tuples.get([p.getX(i), p.getY(i), p.getZ(i)].join(':')); if (!candidates) continue;
      const tuple = names.flatMap(name => { const a = far.geometry.getAttribute(name); return Array.from({ length: a.itemSize }, (_, j) => a.getComponent(i, j)); });
      assert.ok(candidates.some(candidate => candidate.every((v, j) => v === tuple[j])), 'seam material tuple must match an actual input'); matches++;
    }
    assert.ok(matches >= 2, `${far.name} retains a real seam`);
  }
  assert.ok(h.object.userData.crownfallFarSurround.seams.seaEdges > 2, 'original and outer sea north/south seams are included');
  h.dispose(); f.dispose();
});

test('display transform cancels without moving geometry, local focus or owned cost', () => {
  const f = fixture(), a = createEaldholtFarSurround(f.root, f.valley.object), expected = (a.object.children as Mesh[]).map(o => snapshot(o.geometry));
  const local = a.localBounds, bounds = a.bounds, cost = a.bufferBytes; a.dispose();
  f.root.scale.setScalar(.02); f.root.position.set(3, 4, -2); f.root.rotation.set(.1, .4, .05);
  const b = createEaldholtFarSurround(f.root, f.valley.object, { localBounds: local });
  assert.deepEqual((b.object.children as Mesh[]).map(o => snapshot(o.geometry)), expected);
  assert.deepEqual(b.localBounds, local); assert.deepEqual(b.bounds, bounds); assert.equal(b.bufferBytes, cost);
  f.root.add(b.object); f.root.updateWorldMatrix(true, true);
  const inverse = f.root.matrixWorld.clone().invert(), box = new Box3(), point = new Vector3();
  for (const m of b.object.children as Mesh[]) { const p = m.geometry.getAttribute('position'); for (let i = 0; i < p.count; i++) box.expandByPoint(point.fromBufferAttribute(p, i).applyMatrix4(m.matrixWorld).applyMatrix4(inverse)); }
  for (let axis = 0; axis < 3; axis++) { assert.ok(box.min.getComponent(axis) >= b.bounds.min[axis] - 1e-5); assert.ok(box.max.getComponent(axis) <= b.bounds.max[axis] + 1e-5); }
  b.dispose(); f.dispose();
});

test('dispose is idempotent and releases only three owned geometries', () => {
  const f = fixture(), h = createEaldholtFarSurround(f.root, f.valley.object); let owned = 0, borrowed = 0;
  for (const m of h.object.children as Mesh[]) m.geometry.addEventListener('dispose', () => owned++);
  const materials = new Set(meshes(f.root).map(m => m.material));
  for (const material of materials) if (!Array.isArray(material)) material.addEventListener('dispose', () => borrowed++);
  for (const m of meshes(f.root)) m.geometry.addEventListener('dispose', () => borrowed++);
  f.map.addEventListener('dispose', () => borrowed++); f.root.add(h.object);
  h.dispose(); h.dispose(); assert.equal(owned, 3); assert.equal(borrowed, 0); assert.equal(h.object.parent, null); assert.equal(h.object.children.length, 0);
  f.dispose();
});

test('projection packet uses the same actual canonical field and survives unattached disposal', () => {
  const f = fixture(), h = createEaldholtFarSurround(f.root, f.valley.object), packet = h.projectionPacket;
  const seaMeshes = meshes(f.valley.object as Group).filter(m => /sea/.test(m.name));
  const seaPositions = Float64Array.from(seaMeshes.flatMap(m => Array.from(m.geometry.getAttribute('position').array)));
  const channel = f.valley.object.children.find(o => /regional river surface/.test(o.name)) as Mesh;
  const expected = createEaldholtFarGeography({ seaPositions, channelPositions: channel.geometry.getAttribute('position').array,
    sourceEnvelope: { minX: -50, maxX: 100, minZ: -50, maxZ: 100 }, riverFarX: packet.geography.riverFarX });
  assert.deepEqual(packet.geography, expected); assert.equal(packet.localBounds, h.localBounds);
  assert.equal(h.object.parent, null); h.dispose();
  assert.deepEqual(packet.geography, expected); assert.deepEqual(packet.localBounds, h.localBounds);
  f.dispose();
});

test('unfinished, mismatched, duplicate and incomplete attribute intakes fail cleanly', () => {
  const f = fixture(), children = f.root.children.length;
  assert.throws(() => createEaldholtFarSurround(f.root, f.valley.object, { profile: 'quest' }), /profile/);
  f.valley.object.remove(f.outer.object); assert.throws(() => createEaldholtFarSurround(f.root, f.valley.object), /completed/); f.valley.object.add(f.outer.object);
  const sea = f.valley.object.children.find(o => /open sea surface/.test(o.name)) as Mesh, attr = sea.geometry.getAttribute('ealdholtWaterAcross');
  sea.geometry.deleteAttribute('ealdholtWaterAcross'); assert.throws(() => createEaldholtFarSurround(f.root, f.valley.object), /attribute/); sea.geometry.setAttribute('ealdholtWaterAcross', attr);
  assert.throws(() => createEaldholtFarSurround(f.root, f.valley.object, { localBounds: { min: [0, 0, 0], max: [NaN, 2, 3] } }), /finite/);
  assert.throws(() => createEaldholtFarSurround(f.root, f.valley.object, { localBounds: { min: [0, 0, 0], max: [1, 1, 1] } }), /every actual HIGH solid/);
  const h = createEaldholtFarSurround(f.root, f.valley.object); f.root.add(h.object);
  assert.throws(() => createEaldholtFarSurround(f.root, f.valley.object), /one completed/); h.dispose();
  assert.equal(f.root.children.length, children); f.dispose();
});

test('local bridge allocates only clipped roles, borrows materials and retains the canonical field', () => {
  const f = fixture(), full = createEaldholtFarSurround(f.root, f.valley.object), localBounds = full.localBounds, packet = full.projectionPacket;
  full.dispose(); const source = inputState(f), bridge = createEaldholtFarSurroundBridge(f.root, f.valley.object, { localBounds });
  assert.equal(bridge.object.parent, null); assert.deepEqual(bridge.localBounds, localBounds); assert.deepEqual(bridge.projectionPacket, packet);
  assert.ok(bridge.triangles > 0 && bridge.triangles <= 512); assert.ok(bridge.bufferBytes <= 32 * 1024);
  assert.equal(bridge.object.children.length, bridge.drawCalls); assert.equal(bridge.extraTextureBytes, 0);
  const arrays = new Set<ArrayBufferView>(); let triangles = 0, disposed = 0, borrowed = 0;
  const owned = new Box3(), point = new Vector3();
  const [land, river, sea] = f.valley.object.children as Mesh[];
  for (const m of new Set([f.material, land.material, sea.material, river.material])) if (!Array.isArray(m)) m.addEventListener('dispose', () => borrowed++);
  for (const s of source) s.geometry.addEventListener('dispose', () => borrowed++);
  for (const mesh of bridge.object.children as Mesh[]) {
    assert.ok(mesh.geometry.index!.count > 0); triangles += mesh.geometry.index!.count / 3;
    for (const a of Object.values(mesh.geometry.attributes)) arrays.add(a.array); arrays.add(mesh.geometry.index!.array);
    assert.equal(mesh.material, /mainland/.test(mesh.name) ? land.material : /river/.test(mesh.name) ? river.material : sea.material);
    assert.equal(mesh.userData.crownfallFarSurround.localBridge, true); assert.equal(mesh.userData.crownfallFarSurroundBridge.localPlacementEligible, false);
    for (const name of ['uv1', 'uv2', 'uv3']) assert.equal(mesh.geometry.getAttribute(name), mesh.geometry.getAttribute('uv'));
    const p = mesh.geometry.getAttribute('position');
    for (let i = 0; i < p.count; i++) { point.fromBufferAttribute(p, i); owned.expandByPoint(point); for (let axis = 0; axis < 3; axis++)
      assert.ok(Number.isFinite(point.getComponent(axis)) && point.getComponent(axis) >= localBounds.min[axis] - 1e-5 && point.getComponent(axis) <= localBounds.max[axis] + 1e-5, 'no kilometre vertex enters the local bridge'); }
    mesh.geometry.addEventListener('dispose', () => disposed++);
  }
  assert.equal(triangles, bridge.triangles); assert.equal([...arrays].reduce((sum, a) => sum + a.byteLength, 0), bridge.bufferBytes);
  assert.deepEqual(bridge.bounds, { min: owned.min.toArray(), max: owned.max.toArray() });
  assert.deepEqual(source.map(s => snapshot(s.geometry)), source.map(s => s.data));
  const expected = (bridge.object.children as Mesh[]).map(m => snapshot(m.geometry)), count = bridge.drawCalls;
  bridge.dispose(); bridge.dispose(); assert.equal(disposed, count); assert.equal(borrowed, 0);
  f.root.scale.setScalar(.02); f.root.rotation.set(.5, .7, .05); f.root.position.set(3, 1.8, -2);
  const transformed = createEaldholtFarSurroundBridge(f.root, f.valley.object, { localBounds });
  assert.deepEqual((transformed.object.children as Mesh[]).map(m => snapshot(m.geometry)), expected);
  transformed.dispose(); f.dispose();
});
