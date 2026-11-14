import assert from 'node:assert/strict';
import test from 'node:test';
import { createTerrainHubs, createSourceClearance } from '../worlds/exploration';
import { compileRouteNetwork, planAuthoredRoute } from '../exploration/navigation';
const ids=['banner-hall','muster-grounds','war-record','heralds-station'] as const;
const landmarks=ids.map((id,i)=>({id,position:[i*120,3,0] as const}));

test('distant terrain hubs have real local walking edges and require explicit transfer',()=>{
 const hubs=createTerrainHubs({landmarks,groundAt:()=>2,dryAt:()=>true,clearAt:()=>true});
 assert.ok(hubs);assert.equal(Object.keys(hubs.fastTravel!).length,4);
 const compiled=compileRouteNetwork(hubs.graph,hubs.safety);assert.ok(compiled.ok);
 if(!compiled.ok)return;
 for(const edge of hubs.graph.edges){
  const a=compiled.network.points.get(edge.from)!,b=compiled.network.points.get(edge.to)!;
  assert.ok(Math.hypot(a.x-b.x,a.z-b.z)<=3.001);
  assert.equal(hubs.safety.isSegmentSafe!(a,b),true);
 }
 assert.equal(planAuthoredRoute(compiled.network,hubs.startNode,hubs.destinations['war-record']).ok,false);
 for(const id of ids)assert.equal(planAuthoredRoute(compiled.network,hubs.fastTravel![id]!,hubs.destinations[id]).ok,true);
});

test('flooded or unsupported ground never becomes a generic walking plane',()=>{
 for(const options of [{groundAt:()=>-2,dryAt:()=>false},{groundAt:()=>NaN,dryAt:()=>true}])
  assert.equal(createTerrainHubs({landmarks,...options,clearAt:()=>true}),null);
});

test('routes avoid a real steep drop and occupied source positions',()=>{
 const hubs=createTerrainHubs({landmarks:[landmarks[0]],groundAt:(x)=>x<0?0:40,dryAt:()=>true,clearAt:(x,_y,z)=>!(z>2&&z<5)});
 assert.ok(hubs);
 for(const edge of hubs!.graph.edges){
  const a=hubs!.graph.nodes.find(n=>n.id===edge.from)!.position,b=hubs!.graph.nodes.find(n=>n.id===edge.to)!.position;
  assert.ok((a.x<0)===(b.x<0),'no edge jumps across the cliff');
  assert.equal(hubs!.safety.isSegmentSafe!(a,b),true);
 }
});

test('source capsule probes detect backfaces without changing visible material',async()=>{
 const {createRequire}=await import('node:module');
 const T=createRequire(new URL('../../../main game/package.json',import.meta.url))('three');
 const root=new T.Group(),material=new T.MeshBasicMaterial({side:T.FrontSide});
 const pillar=new T.Mesh(new T.BoxGeometry(.4,4,.4),material);pillar.name='stone pillar';pillar.position.y=2;root.add(pillar);
 const clear=createSourceClearance(T,root);
 assert.equal(clear(0,0,0),false,'a capsule beginning inside a pillar is blocked');
 assert.equal(clear(3,0,0),true,'clear source ground remains available');
 assert.equal(pillar.material,material);assert.equal(material.side,T.FrontSide);
});

test('accelerated real triangle queries preserve collision results and rendered topology',async()=>{
 const {createRequire}=await import('node:module');
 const require=createRequire(new URL('../../../main game/package.json',import.meta.url));
 const T=require('three'),{MeshBVH}=require('three-mesh-bvh');
 const root=new T.Group(),geometry=new T.BoxGeometry(.4,4,5,8,64,48),index=geometry.index.array.slice();
 const wall=new T.Mesh(geometry,new T.MeshBasicMaterial({side:T.FrontSide}));wall.position.set(2,2,0);wall.rotation.y=.3;root.add(wall);
 const direct=createSourceClearance(T,root),indexed=createSourceClearance(T,root,[],MeshBVH);
 for(const [x,z] of [[0,0],[2,0],[2.3,0],[5,0],[2,4],[-1,-1]])assert.equal(indexed(x,0,z),direct(x,0,z));
 assert.deepEqual(geometry.index.array,index,'index order remains unchanged for the visible source mesh');
});
