import test from 'node:test';
import assert from 'node:assert/strict';
import {qualifySourceEmergencyRefuge,type SourceRefugeGeometry} from './emergency-source-refuge-clearance';
import type {SourceRouteTriangle} from './emergency-source-route-clearance';
const ground:readonly SourceRouteTriangle[]=[[[ -12,1,-12],[-12,1,12],[12,1,-12]],[[12,1,-12],[-12,1,12],[12,1,12]]];
const body={radius:.7516176338222496,height:2.002123945387056,margin:.005,lift:.02};
const base:SourceRefugeGeometry={ground,rigid:[],architecture:[],water:[],points:[[-4,1,0],[4,1,0]],body};
function run(input:SourceRefugeGeometry){const task=qualifySourceEmergencyRefuge(input);let step=task.next(),yields=0;while(!step.done){yields++;step=task.next();}return yields;}
test('a full measured body clears high tree branches while the same architectural roof forbids exterior admission',()=>{
 const overhead:SourceRouteTriangle=[[-1,4,-1],[1,4,-1],[0,4,1]];
 const input={...base,rigid:[overhead]},before=structuredClone(input);assert.ok(run(input)>0);assert.deepEqual(input,before);
 assert.throws(()=>run({...input,architecture:[overhead]}),/architectural overhead/u);
 const lowBranch:SourceRouteTriangle=[[-1,2,-1],[1,2,-1],[0,2,1]];
 assert.throws(()=>run({...base,rigid:[lowBranch]}),/rigid/u);
});
test('whole footprint, water and original source body support remain required for refuge paths',()=>{
 assert.throws(()=>run({...base,points:[[-11.7,1,0],[4,1,0]]}),/terrain boundary/u);
 assert.throws(()=>run({...base,water:[{min:[-.1,0,-1],max:[.1,1,1]}]}),/water/u);
 assert.throws(()=>run({...base,points:[[-4,1.1,0],[4,1,0]]}),/terrain/u);
 assert.throws(()=>run({...base,points:[[-4,NaN,0],[4,1,0]]}),/finite proof/u);
});
test('long bounded refuge paths check every chunk and still reject an obstacle after the first63 segments',()=>{
 const points=Array.from({length:100},(_,i)=>[-4+i*8/99,1,0]as const),input={...base,points};assert.ok(run(input)>1);
 const wall:SourceRouteTriangle=[[2,1,-1],[2,3,-1],[2,2,1]];
 assert.throws(()=>run({...input,rigid:[wall]}),/rigid/u);
 assert.throws(()=>run({...input,points:Array.from({length:257},()=>points[0])}),/finite proof/u);
 assert.ok(run({...input,points:Array.from({length:256},(_,i)=>[-4+i*8/255,1,0]as const)})>1);
 const task=qualifySourceEmergencyRefuge(input);assert.equal(task.next().done,false);task.return(undefined);assert.deepEqual(input.points,points);
});
