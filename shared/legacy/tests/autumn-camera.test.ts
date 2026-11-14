import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CameraRig } from '../../../main game/src/legacy/environment/cameraRig';
import { buildAutumnSettlement } from '../environment/settlement/build';
import { environmentFixture } from '../environment/fixtures';
import { settlementHeight } from '../environment/settlement/layout';

test('aerial settlement pan and wheel keep a wide safe camera instead of collapsing into a nearby roof',()=>{
 const build=buildAutumnSettlement({state:environmentFixture('founded'),quality:'desktop-low'}),rig=new CameraRig(1280/720);
 rig.setWorld(build.staging.cameras,build.colliders,build.field);rig.setAerialMode(true);rig.focus('establishing',true);
 const initial=rig.camera.position.clone();
 rig.panPixels(60,15,720);rig.orbitBy(0,0,Math.exp(-180*.0015));
 for(let i=0;i<120;i++)rig.apply(1/60);
 const point=rig.camera.position.clone().set(4,settlementHeight(4,7)+.1,7).project(rig.camera);
 assert.ok(Math.abs(point.x)<1&&Math.abs(point.y)<1,'the actual QA target stays in the viewport after its measured pan/zoom');
 assert.ok(rig.camera.position.y>35,'the camera stays above rooftops');
 assert.ok(rig.camera.position.distanceTo(initial)>5,'the input really changes the view');
 for(let i=0;i<12;i++){rig.orbitBy(0,-12,.3);rig.apply(1/60,true);}
 assert.ok(rig.camera.position.y>30,'repeated legal zoom cannot turn the aerial camera into a2m actor boom');
 assert.ok(rig.camera.position.length()>60);
});
