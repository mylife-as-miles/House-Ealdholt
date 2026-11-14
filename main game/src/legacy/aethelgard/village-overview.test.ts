import assert from 'node:assert/strict';import test from 'node:test';
import {PerspectiveCamera,Vector3} from 'three';
import {EALDHOLT_VILLAGE_VIEWS} from '../../../../shared/legacy/aethelgard/village-views';
test('the overview includes the upper crown of a mature tree just outside the northern fixture boundary',()=>{
 const view=EALDHOLT_VILLAGE_VIEWS.find(v=>v.id==='overview')!;
 const corners:Vector3[]=[];for(const x of [16,34])for(const y of [9,21])for(const z of [-40,-25])corners.push(new Vector3(x,y,z));
 const count=(fov:number)=>{const camera=new PerspectiveCamera(fov,1.6,.05,11000);camera.position.fromArray(view.position);camera.lookAt(new Vector3().fromArray(view.target));camera.updateMatrixWorld();return corners.filter(c=>{const p=c.clone().project(camera);return Math.abs(p.x)<=1&&Math.abs(p.y)<=1&&p.z>=-1&&p.z<=1;}).length;};
 assert.ok(count(45)<corners.length,'The previous lens clips part of the near northern canopy.');assert.equal(count(view.fov),corners.length);
 assert.deepEqual(view.position,[25,90,90]);assert.deepEqual(view.target,[25,1,25],'Stationary Native focus and source-space settlement anchors stay the same.');
});
