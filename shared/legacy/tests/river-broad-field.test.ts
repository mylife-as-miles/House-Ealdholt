import assert from 'node:assert/strict';
import test from 'node:test';
import {RIVER_BROAD_FIELD,RIVER_BROAD_FIELD_GLSL} from '../aethelgard/environment/river-broad-field';
import {riverBroad,riverV6Broad,riverFine,riverHeight,derivative,carrierPower} from './fixtures/river-broad-reference';

test('two bounded cubic height octaves keep a continuous analytic gradient, including negative lattice coordinates',()=>{
  assert.deepEqual(RIVER_BROAD_FIELD,{version:'bounded-2d-height-v1',frequency:.45,heightAmplitude:.0176,weights:[.65,.35]});
  for(const [x,y]of[[.3,.7],[13,-2.4],[-27,3.1],[-123.25,-7.8],[0,0],[511.8,5.25]]){
    const sample=riverBroad(x,y);assert.ok(Math.abs(sample.height)<=.0176+1e-12);
    for(let axis=0;axis<2;axis++)assert.ok(Math.abs(sample.gradient[axis]-derivative((x,y)=>riverBroad(x,y).height,x,y,axis))<1e-8);
    const fine=riverFine(x,y);for(let axis=0;axis<2;axis++)assert.ok(Math.abs(sample.gradient[axis]+fine.gradient[axis]-derivative(riverHeight,x,y,axis))<1e-8);
  }
  // Cross an actual octave0 lattice edge; its height/normal must agree from
  // both sides. This is a source boundary, not a screen/pixel offset.
  const x=(3-.23)/(.8*.45),y=0,e=1e-7,a=riverBroad(x-e,y),b=riverBroad(x+e,y);
  assert.ok(Math.abs(a.height-b.height)<1e-8);assert.ok(Math.hypot(...a.gradient.map((v,i)=>v-b.gradient[i]))<1e-7);
});

test('the former carrier concentration falls while resolved slope RMS and maximum remain comparable',()=>{
  let oldEnergy=0,newEnergy=0,oldMax=0,newMax=0,oldPower=0,newPower=0,count=0;
  for(let lane=0;lane<33;lane++){
    const y=-8+lane*.5,oldRow:number[]=[],newRow:number[]=[];
    for(let i=0;i<512;i++){
      const x=-32+i*.125,a=riverV6Broad(x,y).gradient,b=riverBroad(x,y).gradient,f=riverFine(x,y).gradient;
      oldEnergy+=a[0]*a[0]+a[1]*a[1];newEnergy+=b[0]*b[0]+b[1]*b[1];oldMax=Math.max(oldMax,Math.hypot(...a));newMax=Math.max(newMax,Math.hypot(...b));count++;
      oldRow.push(a[0]+f[0]);newRow.push(b[0]+f[0]);
    }
    oldPower+=carrierPower(oldRow,.125);newPower+=carrierPower(newRow,.125);
  }
  const ratio=Math.sqrt(newEnergy/oldEnergy);assert.ok(ratio>.85&&ratio<1.1,'Do not hide the carrier by reducing overall normal strength.');
  assert.ok(newMax<oldMax*1.25,'Do not replace the broad rows with extreme specular spikes.');
  assert.ok(oldPower/33>.5);assert.ok(newPower<oldPower*.55,'Compare normalized power, independent of amplitude.');
  console.log('river-broad-source-measurement',JSON.stringify({count,oldRms:Math.sqrt(oldEnergy/count),newRms:Math.sqrt(newEnergy/count),oldMax,newMax,oldCarrierPower:oldPower/33,newCarrierPower:newPower/33,
    scope:'Source arithmetic only; no renderer, visual score, scene, frame time or device claim.'}));
});

test('broad filtering depends only on original advected coordinates and introduces no samplers or live state',()=>{
  assert.equal((RIVER_BROAD_FIELD_GLSL.match(/cfRiverHeightNoise\([uv]\)/g)??[]).length,2);
  assert.doesNotMatch(RIVER_BROAD_FIELD_GLSL,/sampler|uniform\s|cfDownstream|cfRiverSourceGradient|fwidth/);
  assert.deepEqual([...RIVER_BROAD_FIELD_GLSL.matchAll(/dFd[xy]\(([^)]*)\)/g)].map(row=>row[1]),['lattice','lattice']);
});
