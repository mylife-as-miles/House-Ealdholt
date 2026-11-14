import assert from 'node:assert/strict';
import test from 'node:test';
import {createEaldholtFarGeography} from './far-surround';
import {createEaldholtRegionalHorizon} from './regional-horizon';
const geography=()=>createEaldholtFarGeography({sourceEnvelope:{minX:0,maxX:80,minZ:0,maxZ:80},
  seaPositions:[-100,0,-100,-50,0,-100,-100,0,200,-50,0,200],
  channelPositions:[-50,0,90,-50,0,115,200,0,90,200,0,115],riverFarX:10000});

for(const profile of ['desktop','quest'] as const)test(`${profile}: regional ridge stays east, leaves the source unchanged and rises beyond local hills`,()=>{
  const g=geography(),before=structuredClone(g),a=createEaldholtRegionalHorizon(g,profile),b=createEaldholtRegionalHorizon(g,profile);
  assert.deepEqual(g,before);assert.deepEqual(a,b);assert.equal(a.placementEligible,false);
  assert.ok(a.bounds.min[0]>g.sourceEnvelope.maxX+800);assert.ok(a.bounds.max[1]>900&&a.bounds.max[1]<2000);
  assert.ok(a.byteLength<(profile==='quest'?800000:1500000));
  assert.ok([...a.positions,...a.normals,...a.colours].every(Number.isFinite));
  let northernPeak=0,southernPeak=0;
  for(let i=0;i<a.positions.length;i+=3){assert.ok(Math.abs(Math.hypot(...a.normals.subarray(i,i+3))-1)<1e-5);assert.ok(a.normals[i+1]>0);
    if(a.positions[i+2]<-1500)northernPeak=Math.max(northernPeak,a.positions[i+1]);else southernPeak=Math.max(southernPeak,a.positions[i+1]);}
  assert.ok(northernPeak>southernPeak,'The northeastern snowy massif remains the tallest.');
});

test('river-bank rows leave the continued waterway open even on the reduced grid',()=>{
  const g=geography(),a=createEaldholtRegionalHorizon(g,'quest');
  let wetFaces=0;
  for(let i=0;i<a.indices.length;i+=3){const ids=Array.from(a.indices.subarray(i,i+3)),z=ids.reduce((v,id)=>v+a.positions[id*3+2]/3,0);
    if(z>90&&z<115){wetFaces++;for(const id of ids)assert.ok(a.positions[id*3+1]<g.seaLevel,'No dry mountain face may cap the river.');}}
  assert.ok(wetFaces>0);
});
