import assert from 'node:assert/strict';
import test from 'node:test';
import { collectEaldholtTerrainEdges,createEaldholtRiverValleyBuffers,type EaldholtTerrainEdges } from '../aethelgard/environment/river-valley';

function fixture():EaldholtTerrainEdges {
  const samples=Array.from({length:17},(_,i)=>i*2),height=(x:number,z:number)=>2+Math.sin(x*.1)*.7+Math.cos(z*.08)*.4;
  return {minX:0,maxX:32,minZ:0,maxZ:32,west:samples.map(z=>[z,height(0,z)]),east:samples.map(z=>[z,height(32,z)]),north:samples.map(x=>[x,height(x,0)]),south:samples.map(x=>[x,height(x,32)])};
}
function inside(x:number,z:number){return x>1e-4&&x<31.9999&&z>1e-4&&z<31.9999;}
test('river valley preserves every source join, excludes village interior and includes real expanded bounds',()=>{
  const source=fixture(),before=JSON.stringify(source);
  for(const profile of ['desktop','quest']as const){
    const result=createEaldholtRiverValleyBuffers(source,profile),margin=profile==='quest'?30:70;
    assert.equal(JSON.stringify(source),before);assert.equal(result.bounds.min[0],-margin);assert.equal(result.bounds.max[2],32+margin);
    assert.ok(result.triangles<15000);assert.ok(result.bufferBytes<1024*1024);assert.equal(result.sourceJoinVertices,68);
    for(const side of ['west','east','north','south']as const)for(const [coordinate,y]of source[side]){
      const x=side==='west'?0:side==='east'?32:coordinate,z=side==='north'?0:side==='south'?32:coordinate;
      assert.ok(Array.from({length:result.land.positions.length/3},(_,i)=>i).some(i=>Math.abs(result.land.positions[i*3]-x)<1e-5&&Math.abs(result.land.positions[i*3+1]-y)<1e-5&&Math.abs(result.land.positions[i*3+2]-z)<1e-5));
    }
    for(const mesh of [result.land,result.water])for(let i=0;i<mesh.indices.length;i+=3){
      const p=mesh.indices.subarray(i,i+3),x=(mesh.positions[p[0]*3]+mesh.positions[p[1]*3]+mesh.positions[p[2]*3])/3,z=(mesh.positions[p[0]*3+2]+mesh.positions[p[1]*3+2]+mesh.positions[p[2]*3+2])/3;
      assert.equal(inside(x,z),false);for(const j of p)assert.ok(mesh.normals[j*3+1]>0);
    }
    assert.ok(result.water.positions.length<result.land.positions.length/5);
  }
});
test('bounded river crosses the proposed landscape and its bed remains below the water surface',()=>{
  const {land,water,bounds}=createEaldholtRiverValleyBuffers(fixture(),'quest');
  assert.equal(water.positions[0],bounds.min[0]);assert.equal(water.positions[water.positions.length-3],bounds.max[0]);
  let riverMin=Infinity,riverMax=-Infinity;
  for(let i=0;i<water.positions.length;i+=3){riverMin=Math.min(riverMin,water.positions[i+2]);riverMax=Math.max(riverMax,water.positions[i+2]);}
  assert.ok(riverMin>32);assert.ok(riverMax<62);assert.ok(riverMax-riverMin>11);
  for(let i=0;i<water.indices.length;i+=3){
    const a=water.indices[i]*3,b=water.indices[i+1]*3,c=water.indices[i+2]*3,x=(water.positions[a]+water.positions[b]+water.positions[c])/3,z=(water.positions[a+2]+water.positions[b+2]+water.positions[c+2])/3,y=(water.positions[a+1]+water.positions[b+1]+water.positions[c+1])/3;
    let ground=-Infinity;
    for(let j=0;j<land.indices.length;j+=3){
      const p=land.indices[j]*3,q=land.indices[j+1]*3,r=land.indices[j+2]*3,ax=land.positions[p],az=land.positions[p+2],bx=land.positions[q],bz=land.positions[q+2],cx=land.positions[r],cz=land.positions[r+2];
      const d=(bz-cz)*(ax-cx)+(cx-bx)*(az-cz),u=((bz-cz)*(x-cx)+(cx-bx)*(z-cz))/d,v=((cz-az)*(x-cx)+(ax-cx)*(z-cz))/d,w=1-u-v;
      if(u>=-1e-5&&v>=-1e-5&&w>=-1e-5)ground=Math.max(ground,land.positions[p+1]*u+land.positions[q+1]*v+land.positions[r+1]*w);
    }
    assert.ok(Number.isFinite(ground)&&ground<y-.03,`River bed must sit below water: ground${ground},water${y}`);
  }
});
test('runtime boundary intake rejects incomplete or overhanging source edges rather than fabricating a join',()=>{
  const e=fixture(),points:readonly number[][]=e.north.map(([x,y])=>[x,y,0]);
  assert.throws(()=>createEaldholtRiverValleyBuffers({...e,south:e.south.slice(1)}),/Incomplete/);
  assert.throws(()=>collectEaldholtTerrainEdges(visit=>{for(const p of points)visit(p[0],p[1],p[2]);}),/unavailable/);
});

test('outer banks vary between dry soil, meadow and damp shore without changing the source footprint',()=>{
  const {land,water}=createEaldholtRiverValleyBuffers(fixture(),'quest');
  let meadow=0,soil=0;
  for(let i=0;i<land.colours.length;i+=3){
    const [r,g,b]=land.colours.subarray(i,i+3);
    assert.ok([r,g,b].every(value=>Number.isFinite(value)&&value>0&&value<.2));
    if(g>r*1.2)meadow++;
    if(r>g*1.1)soil++;
  }
  assert.ok(meadow>50&&soil>50,'The new terrain must contain distinct broad meadow and soil coverage.');
  assert.ok(water.colours.every(value=>value===1),'The bank palette must not recolour the river surface.');
});


test('new meadow meets source land without an artificial surrounding soil band',()=>{
  const {land}=createEaldholtRiverValleyBuffers(fixture(),'quest');let boundary=0;
  for(let i=0;i<land.positions.length;i+=3) {
    if(Math.abs(land.positions[i+2])>.0001||land.positions[i]<0||land.positions[i]>32)continue;
    boundary++;assert.ok(land.colours[i+1]>land.colours[i]*1.1);
  }
  assert.ok(boundary>8);
});
