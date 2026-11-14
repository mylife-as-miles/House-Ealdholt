import assert from 'node:assert/strict';
import test from 'node:test';
import { sourceGrassDensity } from '../aethelgard/environment/source-vegetation';
import { bakeVillageTerrain } from '../aethelgard/environment/terrain-bake';
import { mat4, mat4Compose } from '../environment/kernel/math';

test('source grass affects only its measured footprint at ground height',()=>{
  const density=sourceGrassDensity([{origin:[10,2,20],footprintRadius:0.8}]);
  assert.ok(density.at(10,2,20)>0.5);
  assert.equal(density.at(10.81,2,20),0);
  assert.equal(density.at(10,0,20),0);
  assert.equal(density.at(10,4,20),0);
  assert.equal(density.at(100,2,200),0);
  assert.equal(sourceGrassDensity([]).at(10,2,20),0);
});

test('duplicate exported clumps do not multiply density and source positions stay unchanged',()=>{
  const sites=[{origin:[0,1,0] as const,footprintRadius:1}];
  const before=JSON.stringify(sites),one=sourceGrassDensity(sites),duplicate=sourceGrassDensity([...sites,...sites]);
  assert.equal(duplicate.sites,1);
  assert.equal(one.at(0,1,0),duplicate.at(0,1,0));
  assert.equal(JSON.stringify(sites),before);
});

test('world-space source density greens only nearby transformed ground, keeping unsupported ground dry',()=>{
  const source=sourceGrassDensity([{origin:[10,2,20],footprintRadius:0.8}]);
  const matrix=mat4Compose(mat4(),10,2,20),normals=[0,1,0,0,1,0],positions=[0,0,0,4,0,0];
  const result=bakeVillageTerrain(normals,matrix,undefined,{positions,densityAt:source.at});
  assert.equal(result.vegetatedVertices,1);
  assert.ok(result.colors[0]<result.colors[3]);
  assert.ok(result.colors[1]/result.colors[0]>result.colors[4]/result.colors[3]);
  const cliff=bakeVillageTerrain([1,0,0],matrix,undefined,{positions:[0,0,0],densityAt:source.at});
  assert.ok(Math.abs(cliff.colors[0]-.34)<1e-6);
});

test('invalid source measurements fail rather than spreading NaN over ground',()=>{
  assert.throws(()=>sourceGrassDensity([{origin:[NaN,1,0],footprintRadius:1}]),RangeError);
  assert.throws(()=>sourceGrassDensity([{origin:[0,1,0],footprintRadius:0}]),RangeError);
  assert.throws(()=>sourceGrassDensity([]).at(Infinity,1,0),RangeError);
  assert.throws(()=>bakeVillageTerrain([0,1,0],mat4(),undefined,{positions:[],densityAt:()=>0}),RangeError);
});
