import assert from 'node:assert/strict';
import test from 'node:test';
import {solsticeFireflyFlash,solsticeGradientNoise} from './garden-particles';

test('fireflies retain all four source lifetime flashes and dark gaps',()=>{
  for(const age of [.05,.32,.6,.88])assert.equal(solsticeFireflyFlash(age),1);
  for(const age of [0,.11,.27,.4,.55,.66,.83,.95,1])assert.equal(solsticeFireflyFlash(age),0);
  assert.ok(Math.abs(solsticeFireflyFlash(.025)-.5)<1e-12);assert.equal(solsticeFireflyFlash(-1),0);assert.equal(solsticeFireflyFlash(2),0);
});

test('ported curl field has the source analytic derivative across positive and negative lattice cells',()=>{
  const actual=new Float64Array(4),left=new Float64Array(4),right=new Float64Array(4),epsilon=1e-5;
  for(const point of [[.2,1.4,-.8],[-2.1,-.3,4.8],[2,3,4]]){
    solsticeGradientNoise(point[0],point[1],point[2],0x68bc21eb,actual);
    for(let axis=0;axis<3;axis++){const lo=[...point],hi=[...point];lo[axis]-=epsilon;hi[axis]+=epsilon;
      solsticeGradientNoise(lo[0],lo[1],lo[2],0x68bc21eb,left);solsticeGradientNoise(hi[0],hi[1],hi[2],0x68bc21eb,right);
      assert.ok(Math.abs(actual[axis+1]-(right[0]-left[0])/(2*epsilon))<1e-6);}
  }
});
