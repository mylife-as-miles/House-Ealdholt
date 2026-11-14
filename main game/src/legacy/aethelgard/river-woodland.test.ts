import assert from 'node:assert/strict';
import test from 'node:test';
import { Box3, BoxGeometry, BufferAttribute, BufferGeometry, Group, InstancedMesh, Matrix4, Mesh, MeshStandardMaterial, PlaneGeometry, Quaternion, Texture, Vector3 } from 'three';
import { createEaldholtRiverValley } from './river-valley';
import { createEaldholtRiverWoodland } from './river-woodland';
import { createEaldholtFoliageDensity } from './foliage-density';
import { createEaldholtBankLandform } from './bank-landform';
import { createEaldholtCoastalContinuity } from './coastal-continuity';
import { createEaldholtOuterContinuation } from './outer-continuation';
import { mergeEaldholtTerrainSupport } from '../../../../shared/legacy/aethelgard/environment/terrain-support';
import { createEaldholtWoodlandSupportIndex } from '../../../../shared/legacy/aethelgard/environment/river-woodland';
import { createEaldholtWoodlandUnderstory } from './woodland-understory';

test('whole-tree woodland ignores display transforms, obeys budgets and owns only its instance buffers', () => {
  const root = new Group(); root.scale.setScalar(.02); root.position.set(3, 2, -4); root.rotation.set(.1, .5, 0);
  const terrainGeometry = new PlaneGeometry(20, 20, 4, 4).rotateX(-Math.PI / 2), terrainMaterial = new MeshStandardMaterial();
  const terrain = new Mesh(terrainGeometry, terrainMaterial); terrain.name = 'LandscapeComponent_0'; terrain.position.y = 2; root.add(terrain);
  const family = new Group(); family.name = 'SM_BlackAlder_Forest_05_PP3'; family.position.set(3, 0, 4); family.rotation.y = .3; root.add(family);
  const texture = new Texture(), bark = new MeshStandardMaterial({ alphaTest: .4 }), leaf = new MeshStandardMaterial({ map: texture, alphaTest: .4 });
  const geometries = [new BoxGeometry(.4, 5, .4).translate(0, 2.5, 0), new BoxGeometry(3, 3, 2.6).translate(0, 5, 0), new BoxGeometry(.2, 3, .2).translate(0, 1.5, 0)];
  const materials = [bark, leaf, bark], instance = new Matrix4().compose(new Vector3(7, 2, -3), new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), .4), new Vector3(1.2, 1.2, 1.2));
  const sources = geometries.map((geometry, i) => { const mesh = new InstancedMesh(geometry, materials[i], 1); mesh.name = 'SM_BlackAlder_Forest_05_PP3_' + i; mesh.setMatrixAt(0, instance); if (i === 1) mesh.position.x = .2; family.add(mesh); return mesh; });
  const originalMatrices = sources.map(mesh => Array.from(mesh.instanceMatrix.array));
  root.updateWorldMatrix(true, true);
  const trunkActor = new Matrix4(), leafActor = new Matrix4(); sources[0].getMatrixAt(0, trunkActor); sources[1].getMatrixAt(0, leafActor);
  const sourceLeafRelative = new Matrix4().multiplyMatrices(sources[0].matrixWorld, trunkActor).invert().multiply(sources[1].matrixWorld).multiply(leafActor);
  const geometryBounds = geometries.map(geometry => geometry.boundingBox);
  let borrowedDisposals = 0;
  for (const resource of [terrainGeometry, terrainMaterial, ...geometries, bark, leaf, texture]) resource.addEventListener('dispose', () => borrowedDisposals++);
  const valley = createEaldholtRiverValley(root, undefined, { profile: 'quest' });
  const woodland = createEaldholtRiverWoodland(root, valley.object, { profile: 'quest' });
  assert.equal(woodland.object.parent, null); assert.equal(woodland.drawCalls, 3); assert.ok(woodland.instanceCount > 8 && woodland.instanceCount <= 76);
  assert.equal(woodland.trianglesPerTree, 36); assert.equal(woodland.triangles, 36 * woodland.instanceCount); assert.ok(woodland.triangles <= 40000);
  assert.equal(woodland.object.userData.crownfallFoliageDensity.schema, 1); assert.equal(woodland.object.userData.crownfallFoliageDensity.counts.high, woodland.instanceCount); assert.equal(woodland.sourceTerrainTriangles, terrainGeometry.index!.count / 3);
  const composition = woodland.object.userData.crownfallRiverWoodland.composition;
  assert.equal(composition.version, 'cluster-and-fringe-satellites-v2'); assert.equal(composition.baselineActors, woodland.instanceCount); assert.equal(composition.candidateActors, woodland.instanceCount);
  assert.ok(composition.anchorsPreserved && composition.ordinalsScaleYawPreserved && composition.spacingUnchanged); assert.match(composition.candidateConnectivity.scope, /Conservative crown circles/);
  assert.ok(woodland.bounds); assert.equal(woodland.object.children.length, 3); assert.equal(woodland.object.userData.iwsdkPreviewBounds, undefined);
  const owned = woodland.object.children as InstancedMesh[];
  owned.forEach((mesh, i) => { assert.equal(mesh.geometry, geometries[i]); assert.equal(mesh.material, materials[i]); assert.ok(mesh.boundingBox && mesh.boundingSphere); });
  assert.ok(new Box3().setFromObject(woodland.object).getSize(new Vector3()).y > 4, 'bounds must include the canopy height');
  const addedTrunk = new Matrix4(), addedLeaf = new Matrix4(); owned[0].getMatrixAt(0, addedTrunk); owned[1].getMatrixAt(0, addedLeaf);
  const addedLeafRelative = addedTrunk.invert().multiply(addedLeaf);
  addedLeafRelative.elements.forEach((value, i) => assert.ok(Math.abs(value - sourceLeafRelative.elements[i]) < 1e-5, 'all whole-tree component transforms must be retained'));
  root.scale.setScalar(1); root.position.set(0, 0, 0); root.rotation.set(0, 0, 0);
  const second = createEaldholtRiverWoodland(root, valley.object, { profile: 'quest' });
  assert.equal(second.instanceCount, woodland.instanceCount);
  second.object.children.forEach((mesh, i) => { const a = (mesh as InstancedMesh).instanceMatrix.array, b = owned[i].instanceMatrix.array; assert.equal(a.length, b.length); for (let k = 0; k < a.length; k++) assert.ok(Math.abs(a[k] - b[k]) < 1e-5, 'display-root transform must cancel to numerical precision'); });
  sources.forEach((mesh, i) => assert.deepEqual(Array.from(mesh.instanceMatrix.array), originalMatrices[i]));
  geometries.forEach((geometry, i) => assert.equal(geometry.boundingBox, geometryBounds[i], 'borrowed geometry bounds must remain untouched'));
  let ownedDisposals = 0; owned.forEach(mesh => mesh.addEventListener('dispose', () => ownedDisposals++));
  woodland.dispose(); woodland.dispose(); second.dispose(); assert.equal(ownedDisposals, 3); assert.equal(borrowedDisposals, 0);
  valley.dispose(); sources.forEach(mesh => mesh.dispose()); for (const geometry of [terrainGeometry, ...geometries]) geometry.dispose();
  terrainMaterial.dispose(); bark.dispose(); leaf.dispose(); texture.dispose();
});


test('tagged complete prototype is hidden, ordinary source crowns remain protected and new trees can occupy the repaired source exterior', () => {
  const root=new Group(),terrainGeometry=new PlaneGeometry(100,100,8,8).rotateX(-Math.PI/2),terrainMaterial=new MeshStandardMaterial(),terrain=new Mesh(terrainGeometry,terrainMaterial);terrain.name='LandscapeComponent_0';terrain.position.y=2;root.add(terrain);
  const houseGeometry=new BoxGeometry(4,4,4),house=new Mesh(houseGeometry,terrainMaterial);house.name='source house';house.position.y=4;root.add(house);
  const geometries=[new BoxGeometry(.4,5,.4).translate(0,2.5,0),new BoxGeometry(3,3,3).translate(0,5,0),new BoxGeometry(.2,3,.2).translate(0,1.5,0)],material=new MeshStandardMaterial({alphaTest:.3333}),prototype=new Group();prototype.name='SM_BlackAlder_Forest_05_PP3_ExteriorPrototype';prototype.userData.crownfallWoodlandPrototype={schema:1,family:'SM_BlackAlder_Forest_05_PP3',hidden:true,components:3};root.add(prototype);
  for(let i=0;i<3;i++){const mesh=new InstancedMesh(geometries[i],material,1);mesh.name=prototype.name+'_'+i;mesh.setMatrixAt(0,new Matrix4().makeTranslation(0,2,0));prototype.add(mesh);}
  const ordinary=new Group();ordinary.name='SM_BlackAlder_Field_04_ordinary';ordinary.position.set(20,2,0);geometries.forEach((geometry,i)=>{const mesh=new Mesh(geometry,material);mesh.name=ordinary.name+'_'+i;ordinary.add(mesh);});root.add(ordinary);const sapling=new Mesh(geometries[2],material);sapling.name='SM_BlackAlder_Sapling_01';sapling.position.set(-25,2,10);root.add(sapling);
  const before=ordinary.matrix.clone(),valley=createEaldholtRiverValley(root,undefined,{profile:'quest'});root.add(valley.object);const woodland=createEaldholtRiverWoodland(root,valley.object,{profile:'quest'});
  assert.equal(prototype.visible,false);assert.equal(ordinary.visible,true);assert.deepEqual(ordinary.matrix.elements,before.elements.map((v,i)=>i===12?20:i===13?2:v));assert.equal(woodland.existingCrownCount,2);assert.ok(woodland.sourceFamily.includes('ExteriorPrototype'));assert.ok(woodland.sourceBeltInstanceCount>0);assert.ok(woodland.object.userData.crownfallRiverWoodland.northShoulderInstanceCount>0);assert.ok(woodland.object.userData.crownfallRiverWoodland.eastShoulderInstanceCount>0);assert.ok(woodland.instanceCount<=76&&woodland.triangles<=40000);assert.equal(woodland.object.userData.crownfallFoliageDensity.counts.low,Math.min(38,woodland.instanceCount));assert.equal(woodland.object.userData.crownfallFoliageDensity.counts.medium,Math.min(56,woodland.instanceCount));
  const meshes=woodland.object.children as InstancedMesh[],matrix=new Matrix4(),position=new Vector3();for(let i=0;i<woodland.instanceCount;i++){meshes[0].getMatrixAt(i,matrix);position.setFromMatrixPosition(matrix);if(Math.abs(position.x)<50&&Math.abs(position.z)<50)assert.ok(Math.abs(position.y-2)<1e-5);assert.ok(Math.hypot(position.x-20,position.z)>3,'ordinary crowns are included in exclusion');}
  const box=new Box3().setFromObject(woodland.object);assert.deepEqual(box.min.toArray(),woodland.bounds!.min);assert.deepEqual(box.max.toArray(),woodland.bounds!.max);
  const buffers=meshes.map(mesh=>mesh.instanceMatrix.array),density=createEaldholtFoliageDensity(woodland.object,'low');assert.equal(density.diagnostics.selectedActors,Math.min(38,woodland.instanceCount));meshes.forEach((mesh,i)=>{assert.equal(mesh.instanceMatrix.array,buffers[i]);assert.equal(mesh.count,Math.min(38,woodland.instanceCount));});const lowBox=new Box3().setFromObject(woodland.object);assert.ok(lowBox.min.distanceTo(box.min)<1e-5&&lowBox.max.distanceTo(box.max)<1e-5,'LOW preserves complete HIGH bounds');density.setQuality('high');assert.equal(density.diagnostics.selectedActors,woodland.instanceCount);density.dispose();
  let borrowedDisposed=0;[terrainGeometry,houseGeometry,...geometries,material,terrainMaterial].forEach(r=>r.addEventListener('dispose',()=>borrowedDisposed++));woodland.dispose();woodland.dispose();assert.equal(borrowedDisposed,0);assert.equal(prototype.visible,false);valley.dispose();for(const geometry of[terrainGeometry,houseGeometry,...geometries])geometry.dispose();material.dispose();terrainMaterial.dispose();
});

test('import-renamed source tree owners protect their complete HIGH crowns once while preserving hidden-tier source buffers',()=>{
  const root=new Group(),terrainGeometry=new PlaneGeometry(100,100,8,8).rotateX(-Math.PI/2),material=new MeshStandardMaterial({alphaTest:.3333}),terrain=new Mesh(terrainGeometry,material);terrain.name='LandscapeComponent_0';terrain.position.y=2;root.add(terrain);
  const houseGeometry=new BoxGeometry(4,4,4),house=new Mesh(houseGeometry,material);house.name='source house';house.position.y=4;root.add(house);
  const geometries=[new BoxGeometry(.4,5,.4).translate(0,2.5,0),new BoxGeometry(3,3,3).translate(0,5,0),new BoxGeometry(.2,3,.2).translate(0,1.5,0)];
  const legacy=new Group();legacy.name='SM_BlackAlder_Forest_05_PP3';root.add(legacy);
  for(let i=0;i<3;i++){const o=new InstancedMesh(geometries[i],material,1);o.name=legacy.name+'_'+i;o.setMatrixAt(0,new Matrix4().makeTranslation(0,2,24));legacy.add(o);}
  const owner=new Group();owner.name='Crownfall_Source_Foliage_import_alias';owner.userData.crownfallFoliageDensity={schema:1,family:'native-source-field04-v1',components:4,counts:{low:0,medium:1,high:2}};root.add(owner);
  const nested=new Group();nested.name='SM_BlackAlder_Field_04_Nested';owner.add(nested);
  const sourceParts:InstancedMesh[]=[];for(let i=0;i<4;i++){const o=new InstancedMesh(geometries[i%3],material,2);o.name=nested.name+'_'+i;o.setMatrixAt(0,new Matrix4().makeTranslation(-20,2,0));o.setMatrixAt(1,new Matrix4().makeTranslation(20,2,0));o.count=0;nested.add(o);sourceParts.push(o);}
  const grass=new Group();grass.name='Crownfall_Source_Foliage_grass_alias';grass.userData.crownfallFoliageDensity={schema:1,family:'native-source-grass1-v1',components:1,counts:{low:1,medium:2,high:2}};const grassPart=new InstancedMesh(geometries[1],material,2);grassPart.setMatrixAt(0,new Matrix4().makeTranslation(30,2,0));grassPart.setMatrixAt(1,new Matrix4().makeTranslation(-30,2,0));grass.add(grassPart);root.add(grass);
  const matrices=sourceParts.map(o=>Array.from(o.instanceMatrix.array)),valley=createEaldholtRiverValley(root,undefined,{profile:'quest'});root.add(valley.object);const woodland=createEaldholtRiverWoodland(root,valley.object,{profile:'quest'});
  assert.equal(woodland.existingCrownCount,3,'two metadata-owned HIGH actors and one legacy actor; nested display alias is not double counted');assert.equal(woodland.sourceFamily,legacy.name,'a source density owner does not replace the qualified borrowed prototype');
  assert.ok(woodland.instanceCount>8&&woodland.instanceCount<=76);const matrix=new Matrix4(),radius=Math.hypot(1.5,1.5);for(let i=0;i<woodland.instanceCount;i++){(woodland.object.children[0]as InstancedMesh).getMatrixAt(i,matrix);const x=matrix.elements[12],z=matrix.elements[14],scale=Math.hypot(matrix.elements[0],matrix.elements[2]);for(const sourceX of [-20,20])assert.ok(Math.hypot(x-sourceX,z)+.0001>=radius*(1+scale),'the currently hidden HIGH-pool source crown is protected');}
  sourceParts.forEach((o,i)=>{assert.equal(o.count,0);assert.deepEqual(Array.from(o.instanceMatrix.array),matrices[i]);});assert.equal(grassPart.count,2);
  let borrowedDisposals=0;for(const r of [terrainGeometry,houseGeometry,...geometries,material])r.addEventListener('dispose',()=>borrowedDisposals++);woodland.dispose();valley.dispose();assert.equal(borrowedDisposals,0);for(const r of [terrainGeometry,houseGeometry,...geometries,material])r.dispose();
});

test('final terrain chain roots whole trees on the real continuation apron and preserves source buffers', () => {
  for (const profile of ['desktop', 'quest'] as const) {
    const root = new Group(); root.scale.setScalar(.02); root.position.set(3, 2, -4); root.rotation.y = .4;
    const ground = new PlaneGeometry(150, 150, 12, 12).rotateX(-Math.PI / 2), material = new MeshStandardMaterial({ alphaTest: .3 });
    const terrain = new Mesh(ground, material); terrain.name = 'LandscapeComponent_0'; terrain.position.set(25, 2, 25); root.add(terrain);
    const prototype = new Group(); prototype.name = 'SM_BlackAlder_Forest_05_PP3_ExteriorPrototype';
    prototype.userData.crownfallWoodlandPrototype = { schema: 1, family: 'SM_BlackAlder_Forest_05_PP3', hidden: true, components: 3 }; root.add(prototype);
    const geometries = [new BoxGeometry(.4, 5, .4).translate(0, 2.5, 0), new BoxGeometry(3, 3, 3).translate(0, 5, 0), new BoxGeometry(.2, 3, .2).translate(0, 1.5, 0)];
    const sources = geometries.map(geometry => { const part = new InstancedMesh(geometry, material, 1); part.setMatrixAt(0, new Matrix4()); prototype.add(part); return part; });
    const grassGeometry = new BufferGeometry(); grassGeometry.setAttribute('position', new BufferAttribute(new Float32Array([-.3, 0, -.1, .3, 0, .1, 0, .25, 0]), 3));
    grassGeometry.setIndex(Array.from({ length: 96 * 3 }, (_, i) => i % 3)); grassGeometry.computeVertexNormals();
    const sourceGrass = new InstancedMesh(grassGeometry, material, 1); sourceGrass.name = 'S_Grass_Clumps_complete'; root.add(sourceGrass);
    const originalPositions = Array.from(ground.getAttribute('position').array), originalIndices = Array.from(ground.index!.array);
    const originalMatrices = sources.map(part => Array.from(part.instanceMatrix.array));
    const valley = createEaldholtRiverValley(root, undefined, { profile }); root.add(valley.object);
    const bank = createEaldholtBankLandform(root, valley.object, null, { profile });
    const continuity = createEaldholtCoastalContinuity(root, valley.object, bank, { profile });
    const outer = createEaldholtOuterContinuation(root, valley.object, { profile }); valley.object.add(outer.object); root.updateWorldMatrix(true, true);
    const main = valley.object.children.find(o => o instanceof Mesh && /outside village valley/.test(o.name)) as Mesh;
    const apron = outer.object.children.find(o => o instanceof Mesh && o.userData.crownfallElderbloom?.kind === 'terrain') as Mesh;
    const surface = (mesh: Mesh) => {
      const source = mesh.geometry.getAttribute('position'), positions = new Float64Array(source.count * 3), vertex = new Vector3();
      const frame = new Matrix4().copy(root.matrixWorld).invert().multiply(mesh.matrixWorld);
      for (let i = 0; i < source.count; i++) { vertex.fromBufferAttribute(source, i).applyMatrix4(frame); positions.set(vertex.toArray(), i * 3); }
      return { positions, indices: mesh.geometry.index!.array };
    };
    const final = mergeEaldholtTerrainSupport([surface(main), surface(apron), surface(terrain)]), support = createEaldholtWoodlandSupportIndex([final]);
    const exterior = createEaldholtWoodlandSupportIndex([mergeEaldholtTerrainSupport([surface(main), surface(apron)])]);
    const apronSupport = createEaldholtWoodlandSupportIndex([surface(apron)]), mainSupport = createEaldholtWoodlandSupportIndex([surface(main)]);
    const woodland = createEaldholtRiverWoodland(root, valley.object, { profile }), placements = woodland.placements!;
    const accepted = woodland.object.userData.crownfallRiverWoodland.acceptedRegionCounts;
    const count = (region: string) => placements.filter(p => p.region === region).length;
    assert.deepEqual(accepted, { source: count('source'), near: count('near'), farFringe: count('far-fringe'), farDeep: count('far-deep'), mainland: count('mainland') });
    assert.ok(Object.values(accepted).every(value => Number.isSafeInteger(value)));
    assert.equal(Object.values(accepted).reduce((sum: number, value) => sum + Number(value), 0), woodland.instanceCount);
    assert.ok(accepted.near > 0 && accepted.farFringe > 0, 'the actual final terrain retains both supported riparian shares');
    assert.equal(woodland.object.userData.crownfallRiverWoodland.supportSurfaceCount, 2);
    assert.equal(woodland.object.userData.crownfallRiverWoodland.supportTriangles, (main.geometry.index!.count + apron.geometry.index!.count) / 3);
    let apronRoots = 0;
    for (const p of placements) {
      if (p.x < -50 || p.x > 100 || p.z < -50 || p.z > 100) {
        const actual = exterior.sample(p.x, p.z); assert.ok(actual); assert.ok(Math.abs(p.y - actual.height) < 1e-8, 'roots use final rendered triangles');
      } else assert.ok(support.sample(p.x, p.z));
      if (apronSupport.sample(p.x, p.z) && !mainSupport.sample(p.x, p.z)) apronRoots++;
    }
    assert.ok(apronRoots > 0, `${profile} must use actual supported apron, not just main-land bounds`);
    const grass = createEaldholtWoodlandUnderstory(root, valley.object, { profile, woodlandPlacements: placements, canopyRadius: woodland.canopyRadius! });
    assert.ok(grass.instanceCount > 0); assert.equal(grass.object.userData.crownfallWoodlandUnderstory.supportSurfaceCount, 2);
    let apronGrass = 0;
    for (const p of grass.placements) {
      const actual = exterior.sample(p.x, p.z); assert.ok(actual); assert.ok(Math.abs(p.y - actual.height) < 1e-8);
      if (apronSupport.sample(p.x, p.z) && !mainSupport.sample(p.x, p.z)) apronGrass++;
    }
    assert.ok(apronGrass > 0, `${profile} grass uses the real apron triangles`);
    assert.ok(woodland.instanceCount <= (profile === 'quest' ? 76 : 200)); assert.ok(woodland.triangles <= (profile === 'quest' ? 40000 : 2000000));
    assert.deepEqual(Array.from(ground.getAttribute('position').array), originalPositions); assert.deepEqual(Array.from(ground.index!.array), originalIndices);
    sources.forEach((part, i) => assert.deepEqual(Array.from(part.instanceMatrix.array), originalMatrices[i]));
    let borrowed = 0; [ground, material, grassGeometry, ...geometries].forEach(resource => resource.addEventListener('dispose', () => borrowed++));
    grass.dispose(); grass.dispose(); woodland.dispose(); woodland.dispose(); assert.equal(borrowed, 0);
    outer.dispose(); continuity.dispose(); bank.dispose(); valley.dispose(); sources.forEach(part => part.dispose());
    sourceGrass.dispose(); [ground, material, grassGeometry, ...geometries].forEach(resource => resource.dispose());
  }
});
