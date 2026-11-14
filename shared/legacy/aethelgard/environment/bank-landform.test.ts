import assert from 'node:assert/strict';
import test from 'node:test';
import { createEaldholtBankLandformBuffers, createEaldholtLandformBankSampler, type EaldholtBankLandformInput } from './bank-landform';
import { collectEaldholtTerrainEdges } from './river-valley';
import { createEaldholtCoastalValleyBuffers } from './coastal-valley';
import { createEaldholtWoodlandSupportIndex } from './river-woodland';
function fixture(profile:'desktop'|'quest'):EaldholtBankLandformInput {
  const edges=collectEaldholtTerrainEdges(visit=>{for(let x=0;x<=150;x+=10)for(let z=0;z<=150;z+=10)visit(x,2,z);});
  const data=createEaldholtCoastalValleyBuffers(edges,profile);
  const mid=Math.floor(data.channel.positions.length/12)*6,x=data.channel.positions[mid],high=data.channel.positions[mid+5];
  return{land:{...data.land,wetness:data.landWetness},water:[data.channel,data.sea],sourceEnvelope:{minX:0,maxX:150,minZ:0,maxZ:150},
    protectedFootprints:[{minX:x-3,maxX:x+3,minZ:high+3,maxZ:high+9}],profile};
}
function boundary(positions:ArrayLike<number>,indices:ArrayLike<number>){
  const edges=new Map<string,number>();for(let i=0;i<indices.length;i+=3)for(let k=0;k<3;k++){
    const a=indices[i+k],b=indices[i+(k+1)%3],key=[a,b].sort((a,b)=>a-b).join(':');edges.set(key,(edges.get(key)??0)+1);
  }
  assert.ok([...edges.values()].every(n=>n<=2));
  return [...edges].filter(([,n])=>n===1).map(([key])=>key.split(':').map(Number).map(i=>[positions[i*3],positions[i*3+1],positions[i*3+2]].join(':')).sort().join('|')).sort();
}
for(const profile of ['desktop','quest']as const){
  test(`${profile}: connected clearing relief preserves source buffers, contacts and the complete outside-only footprint`,()=>{
    const input=fixture(profile),before=JSON.stringify(input),data=createEaldholtBankLandformBuffers(input),base=input.land;
    assert.equal(JSON.stringify(input),before);assert.ok(data.trianglesAdded>0&&data.trianglesAdded<=(profile==='desktop'?4000:1500));
    assert.ok(data.maximumRaise>1&&data.maximumRaise<=3);assert.ok(data.movedVertices>50);
    assert.equal(data.bufferBytes,[data.positions,data.normals,data.colours,data.uv,data.wetness,data.indices].reduce((n,a)=>n+a.byteLength,0));
    assert.deepEqual(boundary(data.positions,data.indices),boundary(base.positions,base.indices));
    const edgeCounts=new Map<string,number>();for(let i=0;i<base.indices.length;i+=3)for(let k=0;k<3;k++){
      const key=[base.indices[i+k],base.indices[i+(k+1)%3]].sort((a,b)=>a-b).join(':');edgeCounts.set(key,(edgeCounts.get(key)??0)+1);
    }
    const seams=new Set([...edgeCounts].filter(([,n])=>n===1).flatMap(([key])=>key.split(':').map(Number)));
    for(const i of seams)for(const [old,next,size]of [[base.positions,data.positions,3],[base.normals,data.normals,3],[base.colours,data.colours,3],[base.uv,data.uv,2],[base.wetness,data.wetness,1]]as const)
      for(let c=0;c<size;c++)assert.equal(next[i*size+c],old[i*size+c],'every source-opening/outer-seam attribute stays exact');
    assert.equal(data.trianglesAdded,(data.positions.length-base.positions.length)/3*2,'only conforming two-face splits add triangles');
    let addedRelief=0;for(let i=0;i<data.positions.length;i+=3){
      assert.ok(data.normals[i+1]>0&&[data.positions[i],data.positions[i+1],data.positions[i+2],data.normals[i],data.normals[i+1],data.normals[i+2]].every(Number.isFinite));
      assert.ok(data.wetness[i/3]>=0&&data.wetness[i/3]<=1);
      assert.ok(Math.abs(data.uv[i/3*2]-data.positions[i]/2)<.00002&&Math.abs(data.uv[i/3*2+1]+data.positions[i+2]/2)<.00002);
      if(i<base.positions.length){assert.equal(data.positions[i],base.positions[i]);assert.equal(data.positions[i+2],base.positions[i+2]);
        if(base.positions[i+1]<.55){assert.equal(data.positions[i+1],base.positions[i+1]);for(let k=0;k<3;k++){assert.equal(data.normals[i+k],base.normals[i+k]);assert.equal(data.colours[i+k],base.colours[i+k]);}assert.equal(data.wetness[i/3],base.wetness[i/3]);}
        if(data.positions[i+1]-base.positions[i+1]>1)addedRelief++;
      }
    }
    assert.ok(addedRelief>10,'metre-scale shoulders affect exposed baseline land, not only newly inserted details');
    const area=(p:ArrayLike<number>,ix:ArrayLike<number>)=>{let a=0;for(let i=0;i<ix.length;i+=3){const [u,v,w]=[ix[i]*3,ix[i+1]*3,ix[i+2]*3],up=(p[v+2]-p[u+2])*(p[w]-p[u])-(p[v]-p[u])*(p[w+2]-p[u+2]);assert.ok(up>0);a+=up/2;}return a;};
    assert.ok(Math.abs(area(data.positions,data.indices)-area(base.positions,base.indices))<.0001,'no overlapping coverage, new holes or chopped source terrain');
    const again=createEaldholtBankLandformBuffers(input);assert.deepEqual(again,data);
  });
  test(`${profile}: whole canopy support patches preserve baseline height and slope, including between original vertices`,()=>{
    const input=fixture(profile),data=createEaldholtBankLandformBuffers(input),old=createEaldholtWoodlandSupportIndex([input.land]),next=createEaldholtWoodlandSupportIndex([data]);
    let probes=0;for(const r of input.protectedFootprints)for(let x=r.minX;x<=r.maxX;x+=.75)for(let z=r.minZ;z<=r.maxZ;z+=.75){const a=old.sample(x,z),b=next.sample(x,z);if(!a)continue;assert.ok(b);assert.ok(Math.abs(a.height-b.height)<.00002);assert.ok(Math.abs(a.slope-b.slope)<.00002);probes++;}
    assert.ok(probes>30);
  });
}
test('malformed land, water and runtime guards fail without writing input',()=>{
  const input=fixture('desktop'),before=JSON.stringify(input);
  assert.throws(()=>createEaldholtBankLandformBuffers({...input,profile:'bad'as never}),/intake/);
  assert.throws(()=>createEaldholtBankLandformBuffers({...input,protectedFootprints:[{minX:NaN,maxX:1,minZ:0,maxZ:1}]}),/intake/);
  assert.throws(()=>createEaldholtBankLandformBuffers({...input,land:{...input.land,normals:[]}}),/intake/);
  assert.throws(()=>createEaldholtBankLandformBuffers({...input,water:[{positions:[],indices:[]},input.water[1]]}),/paired/);
  assert.equal(JSON.stringify(input),before);
});

for(const profile of ['desktop','quest']as const)test(`${profile}: continuous riparian corridor retains baseline grade while added relief recovers inland`,()=>{
  const original=fixture(profile),riparianCorridor={width:profile==='quest'?18:26,blendWidth:profile==='quest'?8:12};
  const input={...original,riparianCorridor},before=structuredClone(input),data=createEaldholtBankLandformBuffers(input);
  assert.deepEqual(input,before);assert.deepEqual(data,createEaldholtBankLandformBuffers(input));
  const old=createEaldholtWoodlandSupportIndex([input.land]),next=createEaldholtWoodlandSupportIndex([data]),bank=createEaldholtLandformBankSampler(input.water);
  let unchanged=0,inland=0;
  for(let x=-35;x<185;x+=3.7)for(let z=-35;z<290;z+=3.1){
    const distance=bank(x,z).distance,a=old.sample(x,z),b=next.sample(x,z);if(!a||!b||distance<=0)continue;
    if(distance<riparianCorridor.width-.5){assert.ok(Math.abs(a.height-b.height)<.00002&&Math.abs(a.slope-b.slope)<.00002,'whole baseline support faces stay exact, including between vertices');unchanged++;}
    else if(distance>riparianCorridor.width&&b.height-a.height>.001)inland++;
  }
  assert.ok(unchanged>100&&inland>10,'the continuous protected corridor does not disable the inland terrain pass');
  assert.ok(data.trianglesAdded<=(profile==='quest'?1500:4000));
  assert.deepEqual(boundary(data.positions,data.indices),boundary(input.land.positions,input.land.indices));
});
test('invalid optional riparian corridors reject before writing source buffers',()=>{
  const input=fixture('desktop'),before=structuredClone(input);
  for(const riparianCorridor of [{width:NaN,blendWidth:12},{width:0,blendWidth:12},{width:26,blendWidth:0}])assert.throws(()=>createEaldholtBankLandformBuffers({...input,riparianCorridor}),/riparian corridor/);
  assert.deepEqual(input,before);
});
