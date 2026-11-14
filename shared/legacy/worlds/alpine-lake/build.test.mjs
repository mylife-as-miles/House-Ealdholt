import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildWorld } from './build.js';
const THREE=await import('../../../../main game/node_modules/three/build/three.module.js');
const build=async profile=>{const scene=new THREE.Scene();const asset=await buildWorld({THREE,renderer:null,scene,camera:new THREE.PerspectiveCamera(),profile,nationId:'korvenia'});asset.root.updateMatrixWorld(true);return asset;};
const worlds={quest:await build('quest'),desktop:await build('desktop')};
const cost=root=>{let triangles=0,draws=0;root.traverse(o=>{if(!o.isMesh)return;const g=o.geometry,count=(g.index?g.index.count:g.getAttribute('position').count)/3;triangles+=count*(o.isInstancedMesh?o.count:1);draws++;});return{triangles,draws};};
const named=(asset,name)=>{let found=null;asset.root.traverse(o=>{if(o.name===`Alpine / ${name}`)found=o;});assert.ok(found,name);return found;};
test('both profiles fit the triangle and draw budgets',()=>{
 const quest=cost(worlds.quest.root),desktop=cost(worlds.desktop.root);
 assert.ok(quest.triangles<=250000,`quest ${quest.triangles}`);assert.ok(quest.draws<=120,`quest ${quest.draws}`);
 assert.ok(desktop.triangles<=800000,`desktop ${desktop.triangles}`);assert.ok(desktop.draws<=200,`desktop ${desktop.draws}`);
});
test('the forest casts no shadow pass: its shade is baked into the valley',()=>{
 for(const asset of Object.values(worlds))asset.root.traverse(o=>{if(o.isMesh)assert.equal(o.castShadow,false,o.name);});
});
for(const profile of ['quest','desktop'])test(`the twin falls are in frame and not hidden by rock from the establishing view: ${profile}`,()=>{
 const asset=worlds[profile],falls=named(asset,'twin east-shore falls'),position=falls.geometry.getAttribute('position'),flow=falls.geometry.getAttribute('aFlow');
 const camera=new THREE.PerspectiveCamera(asset.view.fov,16/9,.1,14000);camera.position.fromArray(asset.view.position);camera.lookAt(...asset.view.target);camera.updateMatrixWorld(true);
 const terrain=[named(asset,'continuous mountain basin')],ray=new THREE.Raycaster(),p=new THREE.Vector3(),direction=new THREE.Vector3();
 let top=Infinity,bottom=-Infinity,tested=0,clear=0;
 for(let i=0;i<position.count;i+=3){
  if(flow.getZ(i)!==0)continue;p.fromBufferAttribute(position,i);if(p.y<40)continue;
  const ndc=p.clone().project(camera);assert.ok(Math.abs(ndc.x)<1&&Math.abs(ndc.y)<1,`outside frame ${p.toArray()}`);
  const y=(1-ndc.y)*360;top=Math.min(top,y);bottom=Math.max(bottom,y);
  const distance=p.distanceTo(camera.position);direction.copy(p).sub(camera.position).normalize();ray.set(camera.position,direction);ray.far=distance-1;
  tested++;if(!ray.intersectObjects(terrain,false).length)clear++;
 }
 assert.ok(tested>10);assert.ok(bottom-top>100,`falls span ${bottom-top}px of a 720 line frame`);
 assert.ok(clear/tested>.8,`only ${clear}/${tested} sample points are clear of the terrain`);
});
test('the falls face the viewer rather than edge on',()=>{
 const asset=worlds.quest,position=named(asset,'twin east-shore falls').geometry.getAttribute('position');
 // the first ribbon pair across its width, compared with the line of sight
 const a=new THREE.Vector3().fromBufferAttribute(position,0),b=new THREE.Vector3().fromBufferAttribute(position,1);
 const across=b.clone().sub(a).setY(0).normalize(),sight=new THREE.Vector3().fromArray(asset.view.position).sub(a).setY(0).normalize();
 assert.ok(Math.abs(across.dot(sight))<.55,`dot ${across.dot(sight)}`);
});
test('building twice gives the same valley',async()=>{
 const again=await build('quest'),a=named(worlds.quest,'continuous mountain basin').geometry.getAttribute('position').array,b=named(again,'continuous mountain basin').geometry.getAttribute('position').array;
 assert.deepEqual(Array.from(a.subarray(0,300)),Array.from(b.subarray(0,300)));
 assert.equal(named(again,'conifer stands').count,named(worlds.quest,'conifer stands').count);
});
