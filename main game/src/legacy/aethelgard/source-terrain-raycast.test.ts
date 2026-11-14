import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Box3,BufferGeometry,DoubleSide,Float32BufferAttribute,Matrix4,Mesh,MeshBasicMaterial,Raycaster,Vector3} from 'three';
import {prepareSourceTerrainRaycastIndex,type SourceTerrainRow,type SourceTerrainRaycastIndex} from './source-terrain-raycast';
const material=new MeshBasicMaterial({side:DoubleSide});
function terrain(size=12,divisions=24):BufferGeometry{
 const p:number[]=[],indices:number[]=[];for(let z=0;z<=divisions;z++)for(let x=0;x<=divisions;x++){const a=x/divisions*size-size/2,b=z/divisions*size-size/2;p.push(a,Math.sin(a*.7)*.21+Math.cos(b*.3)*.13,b);}
 for(let z=0;z<divisions;z++)for(let x=0;x<divisions;x++){if(x===divisions/2&&z===divisions/2)continue;const a=z*(divisions+1)+x,b=a+1,c=a+divisions+1,d=c+1;indices.push(a,c,b,b,c,d);}
 const g=new BufferGeometry();g.setAttribute('position',new Float32BufferAttribute(p,3));g.setIndex(indices);g.computeVertexNormals();g.computeBoundingBox();return g;
}
function row(geometry:BufferGeometry,frame=new Matrix4()):SourceTerrainRow{
 const actor=new Mesh(geometry,material);actor.visible=false;geometry.setDrawRange(0,0);
 return{actor,frame,bounds:geometry.boundingBox!.clone().applyMatrix4(frame)};
}
function proxy(row:SourceTerrainRow):Mesh{
 const source=row.actor.geometry,g=new BufferGeometry();for(const[name,a]of Object.entries(source.attributes))g.setAttribute(name,a);g.setIndex(source.index);g.setDrawRange(0,source.index?.count??source.getAttribute('position').count);g.boundingBox=source.boundingBox!.clone();g.computeBoundingSphere();const full=new Mesh(g,material);full.matrixAutoUpdate=false;full.matrixWorld.copy(row.frame);return full;
}
function prepare(rows:readonly SourceTerrainRow[]){const task=prepareSourceTerrainRaycastIndex(rows);let n=0,s=task.next();while(!s.done){n++;s=task.next();}return{owner:s.value,yields:n};}
function sampler(rows:readonly SourceTerrainRow[],full:ReadonlyMap<SourceTerrainRow,Mesh>,owner?:SourceTerrainRaycastIndex){const ray=new Raycaster();return(x:number,z:number)=>{
 const candidates=rows.filter(r=>x>=r.bounds.min.x-1e-5&&x<=r.bounds.max.x+1e-5&&z>=r.bounds.min.z-1e-5&&z<=r.bounds.max.z+1e-5);if(!candidates.length)return NaN;
 const high=Math.max(...candidates.map(r=>r.bounds.max.y))+1,low=Math.min(...candidates.map(r=>r.bounds.min.y))-1;ray.set(new Vector3(x,high,z),new Vector3(0,-1,0));ray.near=0;ray.far=high-low;
 let closest=Infinity,height=NaN;for(const r of candidates){if(!ray.ray.intersectsBox(r.bounds))continue;const mesh=owner?owner.meshFor(r,x,z,full.get(r)!):full.get(r)!;if(!mesh)continue;const hit=ray.intersectObject(mesh,false)[0];if(hit&&hit.distance<closest){closest=hit.distance;height=hit.point.y;}}
 return height;
};}
function exact(actual:number,expected:number,x:number,z:number){assert.ok(Object.is(actual,expected),JSON.stringify({x,z,actual,expected}));}
function fingerprint(rows:readonly SourceTerrainRow[]){return rows.map(r=>({index:r.actor.geometry.index,array:r.actor.geometry.index?.array.slice(),attributes:Object.fromEntries(Object.entries(r.actor.geometry.attributes).map(([k,a])=>[k,{a,array:a.array.slice()}])),draw:{...r.actor.geometry.drawRange},matrix:r.frame.toArray()}));}
function unchanged(rows:readonly SourceTerrainRow[],before:ReturnType<typeof fingerprint>){rows.forEach((r,i)=>{const s=before[i];assert.strictEqual(r.actor.geometry.index,s.index);assert.deepEqual(r.actor.geometry.index?.array,s.array);for(const[k,v]of Object.entries(s.attributes)){assert.strictEqual(r.actor.geometry.getAttribute(k),v.a);assert.deepEqual(r.actor.geometry.getAttribute(k).array,v.array);}assert.deepEqual(r.actor.geometry.drawRange,s.draw);assert.deepEqual(r.frame.toArray(),s.matrix);assert.equal(r.actor.visible,false);});}

test('candidate-index raycasts exactly match full source at seams, holes, stacked ground and nonuniform mirrored frames',()=>{
 const base=terrain(),offset=new Matrix4().makeTranslation(12,0,0),sloped=new Matrix4().makeTranslation(-12,2,4).multiply(new Matrix4().makeRotationY(.37)).multiply(new Matrix4().makeRotationX(.19)).multiply(new Matrix4().makeScale(-1.3,.7,1.8));
 const rows=[row(base),row(base,offset),row(base,sloped),row(terrain(4,8),new Matrix4().makeTranslation(-2,1,1))],before=fingerprint(rows),full=new Map(rows.map(r=>[r,proxy(r)])),{owner,yields}=prepare(rows),original=sampler(rows,full),accelerated=sampler(rows,full,owner);assert.ok(yields>=rows.length);let seed=0x4194;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/0x100000000;};
 try{for(let i=0;i<3000;i++){const x=random()*48-24,z=random()*28-14;exact(accelerated(x,z),original(x,z),x,z);}
  for(const x of[-24,-12,-6,-4,-2,-0,0,2,4,6,12,18])for(const z of[-6,-4,-2,0,2,4,6])for(const e of[0,Number.EPSILON,-Number.EPSILON,1e-10,-1e-10])exact(accelerated(x+e,z),original(x+e,z),x+e,z);
  assert.ok(Number.isNaN(accelerated(.25,.25)),'the original missing terrain cell remains unsupported, rather than interpolated across its hole');assert.ok(Number.isNaN(accelerated(200,200)));assert.ok(owner.stats.cachedMeshes>0);unchanged(rows,before);
 }finally{owner.dispose();for(const m of full.values())m.geometry.dispose();for(const g of new Set(rows.map(r=>r.actor.geometry)))g.dispose();}
});

test('nonindexed and enormous overlapping faces retain original face order through bounded spill candidates',()=>{
 const indexed=terrain(100,2),g=indexed.toNonIndexed();g.computeBoundingBox();indexed.dispose();const r=row(g),full=proxy(r),{owner}=prepare([r]),a=sampler([r],new Map([[r,full]])),b=sampler([r],new Map([[r,full]]),owner);
 try{for(const x of[-50,-49,-1,0,1,49,50,51])for(const z of[-50,-20,0,20,50,51])exact(b(x,z),a(x,z),x,z);assert.ok(owner.stats.triangleReferences<100,'giant source faces are bounded spills rather than unbounded bin duplication');}
 finally{owner.dispose();full.geometry.dispose();g.dispose();}
});

test('async preparation cancellation and mesh-cache disposal never dispose or rewrite source buffers',()=>{
 const g=terrain(80,128),r=row(g),before=fingerprint([r]);let sourceDisposals=0;g.addEventListener('dispose',()=>sourceDisposals++);const task=prepareSourceTerrainRaycastIndex([r]);assert.equal(task.next().done,false);task.return(undefined as never);assert.equal(sourceDisposals,0);unchanged([r],before);
 const full=proxy(r),{owner}=prepare([r]),sample=sampler([r],new Map([[r,full]]),owner);for(let x=-38;x<=38;x+=2)for(let z=-38;z<=38;z+=2)sample(x+.13123456789,z+.213456789);
 assert.ok(owner.stats.cachedMeshes<=512);assert.ok(owner.stats.cachedIndexBytes<=8*1024*1024);assert.ok(owner.stats.triangleReferences<=4*1024*1024);unchanged([r],before);owner.dispose();assert.equal(owner.stats.cachedMeshes,0);assert.equal(owner.stats.cachedIndexBytes,0);assert.equal(owner.meshFor(r,0,0,full),null);assert.equal(sourceDisposals,0);full.geometry.dispose();g.dispose();
});

test('paired exact terrain index differs only by its existing Three runtime import',()=>{
 const desktop=readFileSync(new URL('./source-terrain-raycast.ts',import.meta.url),'utf8'),native=readFileSync(new URL('../../../../main-game-vr/src/legacy/aethelgard/source-terrain-raycast.ts',import.meta.url),'utf8');assert.equal(native.replace(" from '@iwsdk/core';"," from 'three';"),desktop);
});

test('pathological source overlap exceeds the bounded index budget and retains the exact full-raycast fallback',()=>{
 const points:number[]=[];for(let i=0;i<2050;i++)points.push(0,0,0,100,0,0,0,0,100);const g=new BufferGeometry();g.setAttribute('position',new Float32BufferAttribute(points,3));g.computeBoundingBox();const r=row(g),before=fingerprint([r]),full=proxy(r),{owner}=prepare([r]);
 try{assert.equal(owner.stats.fallbackRows,1);assert.equal(owner.stats.indexedRows,0);assert.equal(owner.stats.triangleReferences,0);assert.strictEqual(owner.meshFor(r,1,1,full),full);const raw=sampler([r],new Map([[r,full]])),accelerated=sampler([r],new Map([[r,full]]),owner);exact(accelerated(1.0123456789,1.123456789),raw(1.0123456789,1.123456789),1.0123456789,1.123456789);unchanged([r],before);}
 finally{owner.dispose();full.geometry.dispose();g.dispose();}
});
