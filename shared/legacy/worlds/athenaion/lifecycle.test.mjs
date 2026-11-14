import assert from 'node:assert/strict';
import {test} from 'node:test';
import {releaseOwnedWorld} from './lifecycle.js';
const node=(children=[],extra={})=>({children,...extra,traverse(fn){fn(this);for(const child of this.children)child.traverse(fn);},clear(){this.children=[];},removeFromParent(){this.removed=true;}});
test('partial staging and orphan resources are released without disposing host children',()=>{
 const calls=new Map(),resource=name=>({dispose(){calls.set(name,(calls.get(name)||0)+1);}});
 const texture={...resource('texture'),isTexture:true},material={...resource('material'),uniforms:{map:{value:texture}}},geometry=resource('geometry');
 const host=node([],{geometry:resource('host-geometry')}),partial=node([],{geometry,material}),root=node([node([],{geometry,material})]);
 const staging=node([host,partial]),target=resource('target'),orphanMaterial=resource('orphan-material');
 const errors=releaseOwnedWorld({root,staging,initialChildren:new Set([host]),materials:[orphanMaterial],resources:[target],releasers:[()=>calls.set('release',1)]});
 assert.equal(errors.length,0);for(const name of ['texture','material','geometry','target','orphan-material','release'])assert.equal(calls.get(name),1,name);
 assert.equal(calls.has('host-geometry'),false);assert.equal(host.removed,undefined);assert.equal(partial.removed,true);assert.equal(root.children.length,0);
});
test('one failed disposer does not strand the remaining resources',()=>{
 let released=0;const errors=releaseOwnedWorld({root:node(),staging:node(),initialChildren:new Set(),resources:[{dispose(){throw Error('failed');}},{dispose(){released++;}}]});
 assert.equal(errors.length,1);assert.equal(released,1);
});
