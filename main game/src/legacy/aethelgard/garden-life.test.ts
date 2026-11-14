import assert from 'node:assert/strict';
import test from 'node:test';
import {Group,Points,ShaderMaterial} from 'three';
import {createEaldholtGardenLife,type EaldholtGardenLifeFrame} from './garden-life';

const frame:EaldholtGardenLifeFrame={animationSeconds:10,daylight:1,wind:[1,0],windStrength:.1,reducedMotion:false,rain:0};
function positions(points:Points){return Array.from(points.geometry.getAttribute('position').array);}

test('garden points retain the source frame, bounded budgets and correct weather/day gates',()=>{
  const root=new Group();root.scale.setScalar(.015);root.position.set(12,2,-4);
  const garden=createEaldholtGardenLife(root,{anchor:[1395,7,881]});
  assert.equal(garden.object.parent,null);root.add(garden.object);assert.deepEqual(garden.object.position.toArray(),[1395,7,881]);
  assert.equal(garden.object.children.length,2);assert.equal(garden.stats.capacity,104);
  garden.update(frame);assert.equal(garden.stats.motes,64);assert.equal(garden.stats.fireflies,0);
  garden.update({...frame,daylight:0});assert.equal(garden.stats.motes,0);assert.equal(garden.stats.fireflies,40);
  garden.update({...frame,daylight:0,rain:1});assert.equal(garden.object.visible,false);assert.equal(garden.stats.drawCalls,0);
  garden.update({...frame,windStrength:1});assert.equal(garden.stats.motes,0);
  for(const node of garden.object.children){assert.ok(node instanceof Points);assert.equal(node.castShadow,false);assert.equal(node.receiveShadow,false);assert.equal((node.material as ShaderMaterial).depthWrite,false);}
  garden.dispose();
});

test('pause, hidden/reduced-motion and clock seeks do not accumulate simulation or own a second clock',()=>{
  const root=new Group(),garden=createEaldholtGardenLife(root,{anchor:[0,0,0],native:true});
  root.add(garden.object);const motes=garden.object.children[0] as Points;
  assert.equal(garden.stats.capacity,48);garden.update(frame);const initial=positions(motes);
  garden.update({...frame,animationSeconds:10.1});assert.notDeepEqual(positions(motes),initial);
  const moving=positions(motes);garden.update({...frame,animationSeconds:11,paused:true});assert.deepEqual(positions(motes),moving);
  garden.update({...frame,animationSeconds:100});assert.deepEqual(positions(motes),moving,'resume rebases without catching up');
  garden.update({...frame,animationSeconds:100.1,active:false});assert.equal(garden.object.visible,false);assert.deepEqual(positions(motes),moving);
  garden.update({...frame,animationSeconds:100.2,reducedMotion:true});assert.equal(garden.stats.needsAnimation,false);assert.deepEqual(positions(motes),moving);
  garden.update({...frame,animationSeconds:100.3});garden.update({...frame,animationSeconds:8000});assert.deepEqual(positions(motes),moving,'clock seek does not replay particle work');
  let geometryDisposals=0,materialDisposals=0;
  for(const node of garden.object.children as Points[]){node.geometry.addEventListener('dispose',()=>geometryDisposals++);(node.material as ShaderMaterial).addEventListener('dispose',()=>materialDisposals++);}
  garden.dispose();garden.dispose();assert.equal(root.children.length,0);assert.equal(geometryDisposals,2);assert.equal(materialDisposals,2);assert.equal(garden.update(frame),false);
});

test('identical source anchors produce repeatable particles across reloads',()=>{
  const a=createEaldholtGardenLife(new Group(),{anchor:[8,2,5]}),b=createEaldholtGardenLife(new Group(),{anchor:[8,2,5]});
  for(let i=0;i<8;i++){const f={...frame,animationSeconds:10+i/60};a.update(f);b.update(f);}
  assert.deepEqual(positions(a.object.children[0] as Points),positions(b.object.children[0] as Points));a.dispose();b.dispose();
});
