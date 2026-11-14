import assert from 'node:assert/strict';
import test from 'node:test';
import { Box3, BufferAttribute, BufferGeometry, Group, InstancedMesh, Matrix4, Mesh, MeshStandardMaterial, PlaneGeometry, Texture, Vector3 } from 'three';
import { createEaldholtRiverValley } from './river-valley';
import { createEaldholtRiverMargin } from './river-margin';

test('shore helper borrows one whole grass primitive, owns only added buffers/outcrops and includes real bounds',()=>{
  const root=new Group();root.scale.setScalar(.02);root.position.set(3,2,-4);root.rotation.y=.4;
  const ground=new PlaneGeometry(20,20,4,4).rotateX(-Math.PI/2),sourceMat=new MeshStandardMaterial();const terrain=new Mesh(ground,sourceMat);terrain.name='LandscapeComponent_0';terrain.position.y=2;root.add(terrain);
  const grass=new BufferGeometry();grass.setAttribute('position',new BufferAttribute(new Float32Array([-.3,0,0,.3,0,0,0,.22,0]),3));grass.computeVertexNormals();
  const grassMap=new Texture(),grassMat=new MeshStandardMaterial({map:grassMap,alphaTest:.3333}),source=new InstancedMesh(grass,grassMat,1);source.name='S_Grass_Clumps_test_complete_cell_0_0';source.setMatrixAt(0,new Matrix4().makeTranslation(3,2,1));root.add(source);
  const maps={albedo:new Texture(),normal:new Texture(),orm:new Texture()};maps.normal.channel=maps.orm.channel=2;
  const originalMatrix=Array.from(source.instanceMatrix.array),originalBounds=grass.boundingBox;let borrowed=0;for(const r of [ground,sourceMat,grass,grassMat,grassMap,...Object.values(maps)])r.addEventListener('dispose',()=>borrowed++);
  const valley=createEaldholtRiverValley(root,undefined,{profile:'quest'}),margin=createEaldholtRiverMargin(root,valley.object,maps,{profile:'quest'});
  assert.equal(margin.object.parent,null);assert.equal(margin.drawCalls,2);assert.equal(margin.grassInstanceCount,10);assert.ok(margin.stoneInstanceCount>0&&margin.stoneInstanceCount<=4);assert.equal(margin.grassTrianglesPerClump,1);assert.equal(margin.triangles,margin.grassInstanceCount+margin.stoneInstanceCount*180);assert.ok(margin.triangles<=3000);assert.equal(margin.stoneFormsPerGroup,3);assert.equal(margin.ownedGeometryBytes,18360);assert.ok(margin.bounds);
  const added=margin.object.children as InstancedMesh[];assert.equal(added[0].geometry,grass);assert.equal(added[0].material,grassMat);assert.equal((added[1].material as MeshStandardMaterial).map,maps.albedo);assert.notEqual(added[1].geometry,grass);
  assert.equal(added[1].geometry.getAttribute('position').count/3,180);assert.equal(margin.object.userData.iwsdkPreviewBounds,undefined);
  root.add(valley.object);const attached=createEaldholtRiverMargin(root,valley.object,maps,{profile:'quest'});assert.equal(attached.instanceCount,margin.instanceCount);
  attached.object.children.forEach((mesh,i)=>{const values=(mesh as InstancedMesh).instanceMatrix.array,reference=added[i].instanceMatrix.array;for(let j=0;j<values.length;j++)assert.ok(Math.abs(values[j]-reference[j])<1e-5);});
  assert.deepEqual(Array.from(source.instanceMatrix.array),originalMatrix);assert.equal(grass.boundingBox,originalBounds);assert.equal(source.material,grassMat);
  root.add(margin.object);assert.ok(new Box3().setFromObject(root).getSize(new Vector3()).z>1);
  let owned=0;for(const mesh of added)mesh.addEventListener('dispose',()=>owned++);added[1].geometry.addEventListener('dispose',()=>owned++);(added[1].material as MeshStandardMaterial).addEventListener('dispose',()=>owned++);
  margin.dispose();margin.dispose();attached.dispose();assert.equal(owned,4);assert.equal(borrowed,0);assert.equal(margin.object.parent,null);
  valley.dispose();source.dispose();for(const r of [ground,sourceMat,grass,grassMat,grassMap,...Object.values(maps)])r.dispose();
});
test('multi-part grass is rejected whole rather than dropping components to fit one draw',()=>{
  const root=new Group(),ground=new PlaneGeometry(20,20,2,2).rotateX(-Math.PI/2),material=new MeshStandardMaterial(),terrain=new Mesh(ground,material);terrain.name='LandscapeComponent_0';terrain.position.y=2;root.add(terrain);
  const family=new Group();family.name='S_Grass_Clumps_multi_component';root.add(family);
  const grass=new BufferGeometry();grass.setAttribute('position',new BufferAttribute(new Float32Array([-.2,0,0,.2,0,0,0,.2,0]),3));grass.computeVertexNormals();
  for(let i=0;i<2;i++){const mesh=new InstancedMesh(grass,material,1);mesh.name='S_Grass_Clumps_multi_component_'+i;family.add(mesh);}
  const valley=createEaldholtRiverValley(root,undefined,{profile:'quest'}),margin=createEaldholtRiverMargin(root,valley.object,undefined,{profile:'quest'});
  assert.equal(margin.sourceGrassFamily,null);assert.equal(margin.grassInstanceCount,0);assert.equal(margin.drawCalls,1);assert.ok(margin.stoneInstanceCount>0&&margin.stoneInstanceCount<=4);assert.match(margin.limit!,/stones only/);
  margin.dispose();valley.dispose();family.children.forEach(mesh=>(mesh as InstancedMesh).dispose());ground.dispose();grass.dispose();material.dispose();
});
