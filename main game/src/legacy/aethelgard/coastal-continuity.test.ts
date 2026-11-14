import assert from 'node:assert/strict';
import test from 'node:test';
import { Box3, BoxGeometry, BufferGeometry, Group, InstancedMesh, Matrix4, Mesh, MeshStandardMaterial, PlaneGeometry } from 'three';
import { createEaldholtBankLandform } from './bank-landform';
import { createEaldholtCoastalContinuity } from './coastal-continuity';
import { createEaldholtRiverValley } from './river-valley';
import { createEaldholtRiverWoodland } from './river-woodland';
import { createEaldholtOuterContinuation } from './outer-continuation';
import { createEaldholtLandformBankSampler } from '../../../../shared/legacy/aethelgard/environment/bank-landform';
import { createEaldholtWoodlandSupportIndex } from '../../../../shared/legacy/aethelgard/environment/river-woodland';
import { mergeEaldholtTerrainSupport } from '../../../../shared/legacy/aethelgard/environment/terrain-support';
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
  return { root, ground, material, valley, woodland, bank, land, dispose() { bank.dispose(); woodland.dispose(); valley.dispose(); for (const g of [ground, ...geometries]) g.dispose(); material.dispose(); } };
}
const snapshot = (g: BufferGeometry) => ({ indices: Array.from(g.index!.array), attributes: Object.fromEntries(Object.entries(g.attributes).map(([name, a]) => [name, Array.from(a.array)])) });
test('existing bank geometry receives a sparse reversible patch without new resources or bounds growth', () => {
  const f = fixture(), geometry = f.land.geometry, old = snapshot(geometry), bounds = new Box3().setFromObject(f.root);
  const water = f.valley.object.children.slice(1).map(o => snapshot((o as Mesh).geometry));
  const roots = f.woodland.object.children.map(o => Array.from((o as InstancedMesh).instanceMatrix.array));
  const source = Array.from(f.ground.getAttribute('position').array), material = f.land.material, children = f.valley.object.children.slice();
  let disposals = 0; geometry.addEventListener('dispose', () => disposals++);
  const c = createEaldholtCoastalContinuity(f.root, f.valley.object, f.bank, { profile });
  assert.equal(f.land.geometry, geometry); assert.equal(f.land.material, material); assert.deepEqual(f.valley.object.children, children);
  assert.ok(c.verticesChanged > 20 && c.maximumRaise > 1 && c.outerBoundaryVerticesChanged > 2);
  assert.equal(c.trianglesAdded, 0); assert.equal(c.drawCallsAdded, 0); assert.equal(c.textureBytesAdded, 0);
  assert.equal(c.cpuPatchBytes, c.verticesChanged * 42); assert.ok(new Box3().setFromObject(f.root).equals(bounds));
  const after = snapshot(geometry); assert.deepEqual(after.indices, old.indices);
  for (const [name, values] of Object.entries(old.attributes)) if (!['position', 'normal'].includes(name)) assert.deepEqual(after.attributes[name], values);
  assert.deepEqual(Array.from(f.ground.getAttribute('position').array), source);
  assert.deepEqual(f.valley.object.children.slice(1).map(o => snapshot((o as Mesh).geometry)), water);
  assert.deepEqual(f.woodland.object.children.map(o => Array.from((o as InstancedMesh).instanceMatrix.array)), roots);
  assert.throws(() => createEaldholtCoastalContinuity(f.root, f.valley.object, f.bank, { profile }), /live owner/);
  c.dispose(); c.dispose(); assert.deepEqual(snapshot(geometry), old); assert.equal(disposals, 0); assert.equal(geometry.userData.crownfallCoastalContinuity, undefined);
  f.dispose(); assert.equal(disposals, 1, 'only the bank disposes its geometry');
});
test('display transforms cancel and a later edit keeps its whole foreign tuple', () => {
  const f = fixture(), geometry = f.land.geometry, before = snapshot(geometry);
  const a = createEaldholtCoastalContinuity(f.root, f.valley.object, f.bank, { profile }), expected = snapshot(geometry); a.dispose();
  f.root.scale.setScalar(.02); f.root.position.set(3, 4, -2); f.root.rotation.set(.1, .4, .05);
  const b = createEaldholtCoastalContinuity(f.root, f.valley.object, f.bank, { profile });
  assert.deepEqual(snapshot(geometry), expected, 'display transform cannot alter the model-local patch');
  const position = geometry.getAttribute('position'), normal = geometry.getAttribute('normal');
  const changed = Array.from({ length: position.count }, (_, i) => i).filter(i => position.getY(i) !== before.attributes.position[i * 3 + 1]);
  const foreign = changed[0], unchangedOwned = changed[changed.length - 1]; position.setY(foreign, position.getY(foreign) + .125);
  const tuple = [position.getX(foreign), position.getY(foreign), position.getZ(foreign), normal.getX(foreign), normal.getY(foreign), normal.getZ(foreign)];
  b.dispose(); assert.deepEqual([position.getX(foreign), position.getY(foreign), position.getZ(foreign), normal.getX(foreign), normal.getY(foreign), normal.getZ(foreign)], tuple);
  assert.equal(position.getY(unchangedOwned), before.attributes.position[unchangedOwned * 3 + 1]);
  f.dispose();
});
test('replacement geometry and missing bank ownership are respected', () => {
  const f = fixture(), geometry = f.land.geometry, c = createEaldholtCoastalContinuity(f.root, f.valley.object, f.bank, { profile });
  const replacement = geometry.clone(), expected = snapshot(replacement); f.land.geometry = replacement; c.dispose();
  assert.equal(f.land.geometry, replacement); assert.deepEqual(snapshot(replacement), expected);
  delete replacement.userData.crownfallBankLandform;
  assert.throws(() => createEaldholtCoastalContinuity(f.root, f.valley.object, f.bank, { profile }), /bank-owned/);
  f.land.geometry = geometry; replacement.dispose(); f.dispose();
});
test('a foreign attribute-array replacement is not restored or disposed', () => {
  const f = fixture(), c = createEaldholtCoastalContinuity(f.root, f.valley.object, f.bank, { profile });
  const geometry = f.land.geometry, normal = geometry.getAttribute('normal');
  assert.equal(Reflect.set(normal, 'array', normal.array.slice()), true); const foreign = normal.array, expected = snapshot(geometry); let disposals = 0;
  geometry.addEventListener('dispose', () => disposals++);
  c.dispose(); assert.equal(normal.array, foreign); assert.deepEqual(snapshot(geometry), expected); assert.equal(disposals, 0);
  f.dispose();
});

test('terrain-first corridor propagates through final continuity, apron and rooted woodland without losing restoration',()=>{
  const f=fixture();f.bank.dispose();f.woodland.dispose();
  const base=f.land.geometry,before=snapshot(base),oldSupport=createEaldholtWoodlandSupportIndex([{positions:base.getAttribute('position').array,indices:base.index!.array}]);
  const waterMeshes=f.valley.object.children.slice(1)as Mesh[],waterBefore=waterMeshes.map(mesh=>snapshot(mesh.geometry));
  const surface=(mesh:Mesh)=>({positions:mesh.geometry.getAttribute('position').array,indices:mesh.geometry.index!.array});
  const bank=createEaldholtBankLandform(f.root,f.valley.object,null,{profile}),bankBefore=snapshot(f.land.geometry);
  const c=createEaldholtCoastalContinuity(f.root,f.valley.object,bank,{profile});
  assert.deepEqual(f.land.geometry.userData.crownfallCoastalContinuity.riparianCorridor,bank.riparianCorridor);
  const channel=waterMeshes.find(mesh=>/regional river surface/.test(mesh.name))!,sea=waterMeshes.find(mesh=>/open sea surface/.test(mesh.name))!;
  const sampler=createEaldholtLandformBankSampler([surface(channel),surface(sea)]),nextSupport=createEaldholtWoodlandSupportIndex([surface(f.land)]);let probes=0;
  for(let x=-85;x<145;x+=3.7)for(let z=-95;z<205;z+=3.1){const distance=sampler(x,z).distance,a=oldSupport.sample(x,z),b=nextSupport.sample(x,z);
    if(!a||!b||distance<=0||distance>=bank.riparianCorridor!.width-.5)continue;
    assert.ok(Math.abs(a.height-b.height)<.00002&&Math.abs(a.slope-b.slope)<.00002,'both passes preserve the original continuous riparian grade');probes++;
  }
  assert.ok(probes>100);assert.equal(c.trianglesAdded,0);assert.equal(c.drawCallsAdded,0);
  const outer=createEaldholtOuterContinuation(f.root,f.valley.object,{profile});f.valley.object.add(outer.object);
  const forest=createEaldholtRiverWoodland(f.root,f.valley.object,{profile});f.root.add(forest.object);
  const finalLand=mergeEaldholtTerrainSupport([surface(f.land),...outer.object.children.filter((mesh):mesh is Mesh=>mesh instanceof Mesh&&mesh.userData.crownfallElderbloom?.kind==='terrain').map(surface)]);
  const finalSupport=createEaldholtWoodlandSupportIndex([finalLand]);let fringe=0;
  for(const p of forest.placements??[]){const s=finalSupport.sample(p.x,p.z);if(!s)continue;assert.ok(Math.abs(s.height-p.y)<.00002);
    const distance=sampler(p.x,p.z).distance;if(distance>0&&distance<bank.riparianCorridor!.width)fringe++;
  }
  assert.ok(fringe>0,'the final real owned land accepts supported riparian roots');
  assert.deepEqual(waterMeshes.map(mesh=>snapshot(mesh.geometry)),waterBefore);assert.deepEqual(snapshot(base),before);
  forest.dispose();outer.dispose();c.dispose();assert.deepEqual(snapshot(f.land.geometry),bankBefore);
  bank.dispose();assert.equal(f.land.geometry,base);assert.deepEqual(snapshot(base),before);f.dispose();
});
