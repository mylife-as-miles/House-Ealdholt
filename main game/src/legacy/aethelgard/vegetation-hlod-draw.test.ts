import assert from 'node:assert/strict';
import test from 'node:test';
import {BoxGeometry,DoubleSide,Group,InstancedMesh,Matrix4,MeshStandardMaterial,PerspectiveCamera,Scene,type WebGLRenderer} from 'three';
import {createWorldPreparationQueue} from '../../../../shared/legacy/aethelgard/environment/world-preparation-queue';
import {createEaldholtWoodlandVisibility,readAuthoredWoodlandMatrix} from './woodland-visibility';
import {createEaldholtTreeHlod} from './vegetation-hlod';
import type {VegetationPrototypeResources} from './vegetation-prototype';
import type {VegetationPreparationWorker} from './vegetation-worker';

test('near/far colour draws compact independently while the original shadow and reflection family remains intact',async()=>{
  const root=new Group(),materials=[new MeshStandardMaterial(),new MeshStandardMaterial({side:DoubleSide}),new MeshStandardMaterial()];
  const geometries=[new BoxGeometry(.3,3,.3),new BoxGeometry(3,3,3),new BoxGeometry(.2,2,.2)];
  const parts=geometries.map((g,i)=>{const mesh=new InstancedMesh(g,materials[i],3);for(let n=0;n<3;n++)mesh.setMatrixAt(n,new Matrix4().makeTranslation(0,0,-10-n*290));root.add(mesh);return mesh;});
  root.userData.crownfallRiverWoodland={wholeTree:true};root.userData.crownfallFoliageDensity={counts:{low:3,medium:3,high:3}};
  const callbacks=parts.map(p=>[p.onBeforeRender,p.onAfterRender]),visibility=createEaldholtWoodlandVisibility(root),queue=createWorldPreparationQueue(()=>{});
  const camera=new PerspectiveCamera(60,1,.1,1000);camera.position.set(0,1,0);camera.lookAt(0,1,-1);camera.updateMatrixWorld();
  const resources={indices(_key:unknown,data:{indices:Uint32Array}){return{ready:Promise.resolve({indices:data.indices}),release(){}};},
    atlas(){return{ready:new Promise(()=>{}),release(){}};}} as unknown as VegetationPrototypeResources;
  const renderer={compileAsync:async()=>{}} as unknown as WebGLRenderer;
  const hlod=createEaldholtTreeHlod(root,visibility,{renderer,camera,scene:new Scene(),queue,worker:{} as VegetationPreparationWorker,resources,signal:new AbortController().signal,changed(){}});
  try{
    for(let n=0;n<100&&hlod.stats.readyMask!==3;n++){queue.step();await new Promise(r=>setTimeout(r,0));}
    assert.equal(hlod.stats.readyMask,3);
    visibility.update([camera],'high');hlod.update(0,camera,'medium',true);
    const draws=root.getObjectByName('Source-derived tree HLOD')!.children as InstancedMesh[];
    assert.equal(draws.length,6);assert.deepEqual(draws.slice(0,3).map(p=>p.count),[1,1,1]);
    assert.deepEqual(draws.slice(3).map(p=>p.count),[2,2,2]);
    assert.deepEqual(hlod.stats.levels,[1,2,0,0]);
    // The far-source roots are retained for shadows/picking, but their colour
    // render callback submits zero instances rather than discard-only pixels.
    for(const p of parts){assert.equal(p.count,3);p.onBeforeRender.call(p,renderer,new Scene(),camera,p.geometry,p.material as MeshStandardMaterial,null as never);assert.equal(p.count,0);
      p.onAfterRender.call(p,renderer,new Scene(),camera,p.geometry,p.material as MeshStandardMaterial,null as never);assert.equal(p.count,3);}
    assert.deepEqual(readAuthoredWoodlandMatrix(parts[0],2,new Matrix4()).elements,new Matrix4().makeTranslation(0,0,-590).elements);
    const matrix=new Matrix4();draws[3].getMatrixAt(0,matrix);assert.equal(matrix.elements[14],-300);
    visibility.restore('high');hlod.restore();assert.ok(draws.every(p=>p.count===0));
    parts[0].onBeforeRender.call(parts[0],renderer,new Scene(),camera,parts[0].geometry,materials[0],null as never);assert.equal(parts[0].count,3);
    // Returning from a reflection rebuilds the compact colour list even when
    // the camera and original visibility membership have not changed.
    visibility.update([camera],'high');hlod.update(20,camera,'medium',true);assert.deepEqual(draws.slice(0,3).map(p=>p.count),[1,1,1]);
    hlod.dispose();parts.forEach((p,i)=>{assert.equal(p.onBeforeRender,callbacks[i][0]);assert.equal(p.onAfterRender,callbacks[i][1]);assert.equal(p.geometry,geometries[i]);assert.equal(p.material,materials[i]);});
  }finally{hlod.dispose();visibility.dispose();queue.dispose();geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());parts.forEach(p=>p.dispose());}
});
