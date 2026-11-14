import test from 'node:test';
import assert from 'node:assert/strict';
import {qualifySourceEmergencyRoute,type SourceRouteTriangle,type SourceRoutePoint} from './emergency-source-route-clearance';
const body={radius:.6231633375592951,height:1.9020472484796265,margin:.005,lift:.02};
const ground:SourceRouteTriangle[]=[[[0,1,0],[0,1,12],[12,1,0]],[[12,1,0],[0,1,12],[12,1,12]]];
const points:SourceRoutePoint[]=[[2,1,6],[10,1,6]];
const wall=(x:number,y:number):SourceRouteTriangle=>[[x,y,5],[x,y+1,5],[x,y,7]];
function run(input:Parameters<typeof qualifySourceEmergencyRoute>[0]){const task=qualifySourceEmergencyRoute(input);let yields=0,step=task.next();while(!step.done){yields++;step=task.next();}return{...step.value,yields};}
test('qualifies a continuous worker route beneath real rigid branches while retaining the taller source hold',()=>{
 const branch:SourceRouteTriangle=[[5,4.1,5],[5,4.1,7],[7,4.1,6]],input={ground,rigid:[branch],water:[],points,body};
 const measured=run(input);assert.equal(measured.minimumSupportEdgeMetres,2);assert.equal(measured.maximumSupportSlope,0);assert.ok(measured.yields>0);
 assert.throws(()=>run({...input,body:{...body,radius:.85,height:3.5}}),/rigid triangle/u);
});
test('rejects a thin original rigid barrier between clear endpoint stands',()=>{
 assert.throws(()=>run({ground,rigid:[wall(6,1.2)],water:[],points,body}),/rigid triangle/u);
 assert.doesNotThrow(()=>run({ground,rigid:[wall(6,1.2)],water:[],points:[[2,1,3],[10,1,3]],body}));
});
test('keeps whole-footprint boundaries and original water solid even when route centres have terrain',()=>{
 assert.throws(()=>run({ground,rigid:[],water:[],points:[[.5,1,2],[.5,1,10]],body}),/terrain boundary/u);
 assert.throws(()=>run({ground,rigid:[],water:[{min:[5,0,5.8],max:[7,2,6.2]}],points,body}),/original water/u);
});
test('rejects changed terrain height, duplicate source faces and finite proof-budget overflow',()=>{
 assert.throws(()=>run({ground,rigid:[],water:[],points:[[2,1.1,6],[10,1.1,6]],body}),/terrain/u);
 assert.throws(()=>run({ground:[...ground,ground[0]],rigid:[],water:[],points,body}),/duplicate/u);
 assert.throws(()=>run({ground,rigid:Array(250000).fill(wall(6,1.2)),water:[],points,body}),/finite proof contract/u);
});
test('measures slope over the actual swept round footprint of a long diagonal',()=>{
 const offPath:SourceRouteTriangle=[[8,1,3],[9,3,3],[9,1,4]];
 assert.doesNotThrow(()=>run({ground:[...ground,offPath],rigid:[],water:[],points:[[2,1,2],[10,1,10]],body}));
 const onPath:SourceRouteTriangle=[[5,1,5],[6,3,5],[6,1,6]];
 assert.throws(()=>run({ground:[...ground,onPath],rigid:[],water:[],points:[[2,1,2],[10,1,10]],body}),/boundary|slope/u);
});
