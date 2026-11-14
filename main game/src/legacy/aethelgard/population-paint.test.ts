import test from 'node:test';
import assert from 'node:assert/strict';
import { populationPaintSignature } from './population-paint';
test('loading never repeatedly repaints the environment; prepared actors paint once',()=>{
  const loading={selected:8,loading:8,actorSets:0,setups:0,revision:1};
  for(let i=0;i<100;i++)assert.equal(populationPaintSignature(loading),null);
  assert.equal(populationPaintSignature({...loading,loading:0,actorSets:7,setups:7}),null);
  const ready={...loading,loading:0,actorSets:8,setups:8};
  assert.equal(populationPaintSignature(ready),'8:8:1');
  assert.equal(populationPaintSignature(ready),populationPaintSignature(ready));
});
test('routine milestones and disappearing residents invalidate an otherwise unchanged actor set',()=>{
  const ready={selected:8,loading:0,actorSets:8,setups:8,revision:1};
  assert.notEqual(populationPaintSignature({...ready,revision:2}),populationPaintSignature(ready));
  assert.notEqual(populationPaintSignature({...ready,selected:0}),populationPaintSignature(ready));
  assert.equal(populationPaintSignature({...ready,selected:0,actorSets:0}),'0:8:1');
});
