// @ts-nocheck
/** Offline source geometry authoring, never a replacement world. Original GLB
 * buffers stay read-only. Every output route must pass original-triangle
 * capsule clearance, whole-footprint terrain support and complete Recast proof.
 * Door thresholds prove an EXTERIOR approach only: never a bed, workplace pose,
 * navigation inside a building or a tool reach. Keep generated output private. */
import fs from 'node:fs';
import crypto from 'node:crypto';
import {resolve,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {parseArgs} from 'node:util';
import {EALDHOLT_VILLAGE_POPULATION as population} from '../../shared/legacy/aethelgard/characters/village-population.ts';
import {createEaldholtVillageSite,validateVillageSiteRigidClearance,applyVillageSiteRigidClearance,resolveVillageSitePath} from '../../shared/legacy/aethelgard/characters/village-site.ts';
const {values}=parseArgs({options:{'source-model':{type:'string'},profile:{type:'string'},'base-site':{type:'string'},'output-dir':{type:'string'},'recast-root':{type:'string'},'bootstrap-candidate':{type:'boolean',default:false},'source-sha256':{type:'string'},'candidate-id':{type:'string'},'max-ms':{type:'string'},'clearance-height':{type:'string'}}});
// A fresh candidate has its own measured provenance. It never manufactures the
// old base certificate, changes a save, or claims to recover a missing package.
if(values['bootstrap-candidate']){
 const {buildFreshVillageSourceCandidate}=await import('./village-source-authoring.mts');
 await buildFreshVillageSourceCandidate(values);process.exit(0);
}
if(values['clearance-height']!==undefined)throw Error('--clearance-height requires explicit --bootstrap-candidate authoring; existing source-bound sites cannot be relabelled.');
if(!values['source-model']||!values['base-site']||!values['output-dir']||!values['recast-root']||!['desktop','quest'].includes(values.profile??''))throw Error('Provide --source-model actual.glb --profile desktop|quest --base-site matching-source-site.json --output-dir PRIVATE_DIRECTORY --recast-root private/node_modules.');
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..'),file=resolve(values['source-model']),profile=values.profile,dir=resolve(values['output-dir']);
fs.mkdirSync(dir,{recursive:true,mode:0o700});
const load=path=>import(pathToFileURL(path).href);
const [{GLTFLoader},{BufferGeometry,BufferAttribute,Matrix4,Vector3,Box3,Ray,DoubleSide,Texture},{MeshBVH},{init,NavMeshQuery},{generateSoloNavMesh}]=await Promise.all([
 load(resolve(root,'main game/node_modules/three/examples/jsm/loaders/GLTFLoader.js')),load(resolve(root,'main game/node_modules/three/build/three.module.js')),
 load(resolve(root,'main game/node_modules/three-mesh-bvh/src/index.js')),load(resolve(values['recast-root'],'@recast-navigation/core/dist/index.mjs')),
 load(resolve(values['recast-root'],'@recast-navigation/generators/dist/index.mjs'))]);
globalThis.self=globalThis;
const raw=fs.readFileSync(file),sha=crypto.createHash('sha256').update(raw).digest('hex'),base=JSON.parse(fs.readFileSync(values['base-site'],'utf8'));
const original=createEaldholtVillageSite({profile,modelSha256:sha,binding:base.binding,certificate:base.certificate,placeBindings:base.placeBindings??[],residentPlaceBindings:base.residentPlaceBindings??[]});
applyVillageSiteRigidClearance(original,validateVillageSiteRigidClearance(original,base.rigidSourceClearance));
const loader=new GLTFLoader();loader.register(parser=>({name:'CPUTextures',beforeRoot(){parser.loadTexture=()=>Promise.resolve(new Texture());}}));
const gltf=await loader.parseAsync(raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength),'');gltf.scene.updateMatrixWorld(true);
const localProofBox=new Box3(new Vector3(-12,-20,5),new Vector3(78,6,51)),localGeometryBounds=new WeakMap(),actorBox=new Box3();
const ground=[],groundActors=[],solid=[],water=[],m=new Matrix4(),w=new Matrix4(),v=new Vector3();let terrainTriangles=0,solidTriangles=0;const doors=[],functionalObjects=[];
gltf.scene.traverse(o=>{if(!o.isMesh)return;let treeFamily=false,groundcover=false;for(let n=o;n;n=n.parent){treeFamily ||= n.userData.crownfallElderbloom?.kind==='tree'||/^SM_BlackAlder_/i.test(n.name);groundcover ||= n.userData.crownfallElderbloom?.kind==='groundcover';}const isGround=/^LandscapeComponent_/.test(o.name),isPlant=/Grass|flower|Daisy|Poppy|Shrub|Leaves/i.test(o.name);const pos=o.geometry.attributes.position,ix=o.geometry.index;
 for(let k=0;k<(o.isInstancedMesh?o.count:1);k++){
  if(o.isInstancedMesh){o.getMatrixAt(k,m);w.multiplyMatrices(o.matrixWorld,m);}else w.copy(o.matrixWorld);
  if(!isGround){let local=localGeometryBounds.get(o.geometry);if(!local){local=new Box3();for(let at=0;at<pos.count;at++)local.expandByPoint(v.fromBufferAttribute(pos,at));localGeometryBounds.set(o.geometry,local);}actorBox.copy(local).applyMatrix4(w);if(!actorBox.intersectsBox(localProofBox))continue;if(/(?:^|_)Door_/i.test(o.name)){doors.push({sourceActor:o.name,instance:k,min:actorBox.min.toArray(),max:actorBox.max.toArray()});}if(/Blacksmith_Anvil|Old_Stone_Well|Campfire|Old_Wooden_Bench/i.test(o.name))functionalObjects.push({sourceActor:o.name,instance:k,min:actorBox.min.toArray(),max:actorBox.max.toArray()});}
  const materials=Array.isArray(o.material)?o.material:[o.material];const groupList=o.geometry.groups.length?o.geometry.groups:[{start:0,count:ix?ix.count:pos.count,materialIndex:0}];
  for(const sourceGroup of groupList){const gr={...sourceGroup,count:Math.min(sourceGroup.count,(ix?ix.count:pos.count)-sourceGroup.start)};if(!Number.isFinite(gr.count)||gr.count<0)throw Error("Invalid original source group extent.");const mat=materials[gr.materialIndex??0];if(!mat)continue;
   if(/water|pond|sea/i.test(mat.name)){const bb=new Box3();for(let i=gr.start;i<gr.start+gr.count;i++){const n=ix?ix.getX(i):i;v.fromBufferAttribute(pos,n).applyMatrix4(w);bb.expandByPoint(v);}water.push(bb);continue;}
   if(!isGround&&(isPlant||groundcover||treeFamily&&mat.side===DoubleSide||/BlackAlder.*TwoSided/i.test(mat.name)||mat.transparent&&mat.opacity<.99))continue;
   for(let i=gr.start;i<gr.start+gr.count;i+=3){const coords=[];const triBox=new Box3();for(let j=0;j<3;j++){const n=ix?ix.getX(i+j):i+j;v.fromBufferAttribute(pos,n).applyMatrix4(w);coords.push(v.x,v.y,v.z);if(!isGround)triBox.expandByPoint(v);}if(!isGround&&!triBox.intersectsBox(localProofBox))continue;const dst=isGround?ground:solid;if(dst.length>30_000_000)throw Error(JSON.stringify({name:o.name,parent:o.parent?.name,material:mat.name,indexCount:ix?.count,positions:pos.count,instance:k,count:o.count,ground:isGround,coords,solidTriangles,terrainTriangles}));dst.push(...coords);if(isGround){terrainTriangles++;groundActors.push(o.name);}else solidTriangles++;}
  }
 }
});
function tree(data){const g=new BufferGeometry();g.setAttribute('position',new BufferAttribute(new Float64Array(data),3));return new MeshBVH(g,{targetLeafSize:12,indirect:true});}
const gbvh=tree(ground),sbvh=tree(solid);console.log({terrainTriangles,solidTriangles,water:water.length});
const ray=new Ray(new Vector3(),new Vector3(0,-1,0));function floor(x,z){ray.origin.set(x,15,z);const hit=gbvh.raycastFirst(ray,DoubleSide,0,30);if(!hit)return null;const p=[x,hit.point.y,z];p.sourceActor=groundActors[hit.faceIndex];return p;}
const groups=[],cells=new Map(),ids=[];let maxGap=0;const tol=.00002;
for(let i=0;i<ground.length;i+=3){const p=ground.slice(i,i+3),c=p.map(x=>Math.floor(x/tol));let found=-1;
 for(let a=-1;a<=1&&found<0;a++)for(let b=-1;b<=1&&found<0;b++)for(let d=-1;d<=1&&found<0;d++){for(const id of cells.get(`${c[0]+a},${c[1]+b},${c[2]+d}`)??[]){if(groups[id].every(q=>Math.hypot(...p.map((x,j)=>x-q[j]))<=tol)){found=id;break;}}}
 if(found<0){found=groups.length;groups.push([]);const key=c.join(',');if(!cells.has(key))cells.set(key,[]);cells.get(key).push(found);}
 for(const q of groups[found])maxGap=Math.max(maxGap,Math.hypot(...p.map((x,j)=>x-q[j])));groups[found].push(p);ids.push(found);
}
const rawEdges=new Map();for(let i=0;i<ground.length;i+=9)for(let j=0;j<3;j++){const a=ground.slice(i+j*3,i+j*3+3).join(','),b=ground.slice(i+((j+1)%3)*3,i+((j+1)%3)*3+3).join(','),key=a<b?a+'|'+b:b+'|'+a;rawEdges.set(key,(rawEdges.get(key)??0)+1);}const originalBoundaryCount=[...rawEdges.values()].filter(n=>n===1).length;const edges=new Map();for(let i=0;i<ids.length;i+=3)for(let j=0;j<3;j++){const a=ids[i+j],b=ids[i+(j+1)%3],key=a<b?`${a},${b}`:`${b},${a}`;const e=edges.get(key);if(e)e.count++;else edges.set(key,{count:1,a:groups[a][0],b:groups[b][0]});}
if([...edges.values()].some(e=>e.count>2))throw Error('Non-manifold ground');const boundaries=[...edges.values()].filter(e=>e.count===1);console.log({groups:groups.length,boundaries:boundaries.length,maxGap});
const cross=(a,b,c)=>(b[0]-a[0])*(c[2]-a[2])-(b[2]-a[2])*(c[0]-a[0]);
function pointDist(p,a,b){const x=b[0]-a[0],z=b[2]-a[2],l=x*x+z*z,t=l?Math.max(0,Math.min(1,((p[0]-a[0])*x+(p[2]-a[2])*z)/l)):0;return Math.hypot(p[0]-a[0]-t*x,p[2]-a[2]-t*z);}
function segDist(a,b,c,d){if(cross(a,b,c)*cross(a,b,d)<0&&cross(c,d,a)*cross(c,d,b)<0)return 0;return Math.min(pointDist(a,c,d),pointDist(b,c,d),pointDist(c,a,b),pointDist(d,a,b));}
function inPoly(p,poly){let yes=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){const a=poly[i],b=poly[j];if((a[2]>p[2])!==(b[2]>p[2])&&p[0]<(b[0]-a[0])*(p[2]-a[2])/(b[2]-a[2])+a[0])yes=!yes;}return yes;}
function clipY(poly,y,above){const out=[];for(let i=0;i<poly.length;i++){const a=poly[i],b=poly[(i+1)%poly.length],inside=above?a[1]>=y:a[1]<=y,next=above?b[1]>=y:b[1]<=y;if(inside)out.push(a);if(inside!==next){const t=(y-a[1])/(b[1]-a[1]);out.push(a.map((x,k)=>x+t*(b[k]-x)));}}return out;}
const radius=.85,height=2.1,margin=.005;
function clear(a,b){const low=Math.min(a[1],b[1])+.005,high=Math.max(a[1],b[1])+height,bb=new Box3(new Vector3(Math.min(a[0],b[0])-radius-margin,low,Math.min(a[2],b[2])-radius-margin),new Vector3(Math.max(a[0],b[0])+radius+margin,high,Math.max(a[2],b[2])+radius+margin));
 if(!localProofBox.containsBox(bb))return false;let hit=false;sbvh.shapecast({intersectsBounds:x=>x.intersectsBox(bb),intersectsTriangle:t=>{let p=clipY([t.a.toArray(),t.b.toArray(),t.c.toArray()],low,true);if(p.length)p=clipY(p,high,false);if(!p.length)return false;
  if(inPoly(a,p)||inPoly(b,p)||p.some((x,i)=>segDist(a,b,x,p[(i+1)%p.length])<radius+margin)){hit=true;return true;}return false;}});return!hit;}
function support(a,b){let edge=Infinity;for(const e of boundaries)edge=Math.min(edge,segDist(a,b,e.a,e.b));if(edge<radius+margin+.00002)return null;for(const waterBox of water){if(Math.min(a[0],b[0])-radius<waterBox.max.x&&Math.max(a[0],b[0])+radius>waterBox.min.x&&Math.min(a[2],b[2])-radius<waterBox.max.z&&Math.max(a[2],b[2])+radius>waterBox.min.z)return null;}
 const bb=new Box3(new Vector3(Math.min(a[0],b[0])-radius,Math.min(a[1],b[1])-1,Math.min(a[2],b[2])-radius),new Vector3(Math.max(a[0],b[0])+radius,Math.max(a[1],b[1])+1,Math.max(a[2],b[2])+radius));let slope=0;gbvh.shapecast({intersectsBounds:x=>x.intersectsBox(bb),intersectsTriangle:t=>{t.getNormal(v);slope=Math.max(slope,Math.hypot(v.x,v.z)/Math.abs(v.y));return false;}});if(slope>Math.tan(35*Math.PI/180))return null;return{edge,slope};}
await init();const indices=Array.from({length:ground.length/3},(_,i)=>i);const nav=generateSoloNavMesh(new Float32Array(ground),new Uint32Array(indices),{cs:.1,ch:.025,walkableSlopeAngle:35,walkableHeight:84,walkableClimb:4,walkableRadius:9,minRegionArea:4,mergeRegionArea:20});if(!nav.success)throw Error(nav.error);const query=new NavMeshQuery(nav.navMesh);
const vec=p=>({x:p[0],y:p[1],z:p[2]});
function certified(a,b){const sup=support(a,b);if(!sup||!clear(a,b))return null;const s=query.findClosestPoint(vec(a)),e=query.findClosestPoint(vec(b));if(!s.success||!e.success||Math.hypot(s.point.x-a[0],s.point.z-a[2])>.15||Math.hypot(e.point.x-b[0],e.point.z-b[2])>.15)return null;
 const path=query.findPath(s.polyRef,e.polyRef,s.point,e.point);const refs=Array.from(path.polys.getHeapView());const ok=path.success&&path.status===1073741824&&refs[refs.length-1]===e.polyRef;path.polys.destroy();if(!ok)return null;
 // Short direct legs must also be clear of navmesh edges; raycast confirms the
 // entire straight segment stays in the returned walkable corridor.
 const ray=query.raycast(s.polyRef,s.point,e.point);if(!ray.success||ray.t<1)return null;
 return{...sup,refs,status:path.status};}

const binding=structuredClone(base.binding),certificate=structuredClone(base.certificate);
// Recompute topology proof from the current model; preserved source routes are
// also re-certified below rather than trusting matching SHA text alone.
certificate.routes=[];binding.routes={};binding.anchors={};
certificate.groundSeamPairClosureToleranceMetres=tol;certificate.groundSeamTopology={sourceBufferMutation:false,sourceCoordinateRoundingMetres:0,seamPairClosureToleranceMetres:tol,maximumMeasuredEndpointDeltaMetres:maxGap,pairedEdgeCount:originalBoundaryCount-boundaries.length,originalUnmatchedEdgeCount:originalBoundaryCount,trueBoundaryEdgeCount:boundaries.length};
const nodes=[],routeEdges=[],known=new Map(),lift=.02;
function addNode(id,p,metadata={}){if(!p)return null;const sup=support(p,p);if(!sup||!clear(p,p))return null;if(known.has(id))return known.get(id);const node={id,p:[...p],...metadata};nodes.push(node);known.set(id,node);return node;}
for(const anchor of original.anchors)addNode(anchor.id,[...anchor.sourceGroundPoint],{sourceActor:anchor.sourceActor,kind:'preserved'});
const grid=[];for(let z=7.5;z<=48.9;z+=1.8)for(let x=-9.9;x<=75.9;x+=1.8){const p=floor(x,z);const node=addNode(`life-grid-${grid.length}`,p,{sourceActor:p?.sourceActor,kind:'grid'});if(node)grid.push(node);}
// Actual merged GLBs contain instanced door meshes. SourceActor+instance keeps
// their identities distinct. Choose both thin-axis approaches; only the side
// connected to the existing certified outdoor graph will be bound as exterior.
const thresholdCandidates=[];for(const [i,door]of doors.entries()){
 const dx=door.max[0]-door.min[0],dz=door.max[2]-door.min[2],x=(door.min[0]+door.max[0])/2,z=(door.min[2]+door.max[2])/2;
 if(Math.min(dx,dz)>1.1||Math.max(dx,dz)>5||door.max[1]-door.min[1]<1.2)continue;
 for(const side of [-1,1])for(const offset of [radius+margin+.15,radius+margin+.55,radius+margin+1.0]){
  const p=floor(x+(dx<dz?side*(dx/2+offset):0),z+(dx<dz?0:side*(dz/2+offset)));
  const node=addNode(`life-door-${i}-${side===1?'positive':'negative'}-${Math.round(offset*1000)}`,p,{sourceActor:p?.sourceActor,kind:'door',door});if(node)thresholdCandidates.push(node);
 }
}
const workCandidates=[];for(const [i,object]of functionalObjects.entries())if(/Blacksmith_Anvil/i.test(object.sourceActor)){
 const x=(object.min[0]+object.max[0])/2,z=(object.min[2]+object.max[2])/2;for(const radius of [2.1,2.8,3.5])for(let direction=0;direction<8;direction++){
 const angle=direction*Math.PI/4,p=floor(x+Math.cos(angle)*radius,z+Math.sin(angle)*radius),node=addNode(`life-anvil-${i}-${Math.round(radius*100)}-${direction}`,p,{sourceActor:p?.sourceActor,kind:'work-approach',sourceObject:object});if(node)workCandidates.push(node);}}
const buckets=new Map();for(const node of nodes){const key=`${Math.floor(node.p[0]/3)},${Math.floor(node.p[2]/3)}`;if(!buckets.has(key))buckets.set(key,[]);buckets.get(key).push(node);}
let attempted=0;function addEdge(a,b,id){if(a===b)return;const proof=certified(a.p,b.p);attempted++;if(!proof)return;const line=[a.p,b.p],body=line.map(p=>[p[0],p[1]+lift,p[2]]),lengthMetres=Math.hypot(...a.p.map((n,k)=>n-b.p[k]));if(lengthMetres<1e-7)return;
 routeEdges.push({a:a.id,b:b.id});binding.routes[id]={from:a.id,to:b.id,reversible:true,sourceGroundPolyline:line,capsuleBottomPolyline:body,lengthMetres,corridorRefs:proof.refs};certificate.routes.push({from:a.id,to:b.id,lengthMetres,partialPathAccepted:false,findPathStatus:proof.status,allSourceSolidEnvelopesClear:true,groundWholeFootprintSupported:true,waterAndInteriorsExcluded:true,groundEdgeClearanceLowerBound:proof.edge-maxGap,slopeLipschitzUpperBound:proof.slope,capsuleBottomLiftMetres:lift,sourceGroundPolyline:line,capsuleBottomPolyline:body,corridor:proof.refs});}
for(let i=0;i<nodes.length;i++){const a=nodes[i],bx=Math.floor(a.p[0]/3),bz=Math.floor(a.p[2]/3);for(let dx=-1;dx<=1;dx++)for(let dz=-1;dz<=1;dz++)for(const b of buckets.get(`${bx+dx},${bz+dz}`)??[]){if(a.id>=b.id||Math.hypot(a.p[0]-b.p[0],a.p[2]-b.p[2])>2.75)continue;addEdge(a,b,`life-link-${routeEdges.length}`);}if(i%250===0)console.log(JSON.stringify({stage:'certify',nodes:nodes.length,completed:i,routes:routeEdges.length,attempted}));}
// Keep original IDs so existing public place/resident bindings remain intact.
for(const route of original.routes){const a=known.get(route.from),b=known.get(route.to);if(a&&b&&!Object.values(binding.routes).some(r=>r.from===a.id&&r.to===b.id||r.from===b.id&&r.to===a.id))addEdge(a,b,route.id);}
// Connect sampling gaps with longer straight legs only when the original
// geometry and full capsule footprint certify them. A nearby graph node alone
// never authorizes crossing a wall, water, terrain edge or missing support.
const parents=new Map(nodes.map(n=>[n.id,n.id]));function rootOf(id){let root=id;while(parents.get(root)!==root)root=parents.get(root);for(let at=id;parents.get(at)!==root;){const next=parents.get(at);parents.set(at,root);at=next;}return root;}
for(const {a,b}of routeEdges)parents.set(rootOf(a),rootOf(b));
const bridgeCandidates=[];for(let i=0;i<nodes.length;i++)for(let j=i+1;j<nodes.length;j++){const a=nodes[i],b=nodes[j],distance=Math.hypot(a.p[0]-b.p[0],a.p[2]-b.p[2]);if(distance<=14&&rootOf(a.id)!==rootOf(b.id))bridgeCandidates.push({a,b,distance});}
bridgeCandidates.sort((a,b)=>a.distance-b.distance||a.a.id.localeCompare(b.a.id)||a.b.id.localeCompare(b.b.id));let bridges=0;for(const {a,b}of bridgeCandidates){if(rootOf(a.id)===rootOf(b.id))continue;const before=routeEdges.length;addEdge(a,b,`life-bridge-${bridges}`);if(routeEdges.length>before){parents.set(rootOf(a.id),rootOf(b.id));bridges++;}}console.log(JSON.stringify({stage:'bridges',bridges,candidates:bridgeCandidates.length}));
const adjacency=new Map();for(const {a,b}of routeEdges){if(!adjacency.has(a))adjacency.set(a,[]);if(!adjacency.has(b))adjacency.set(b,[]);adjacency.get(a).push(b);adjacency.get(b).push(a);}
const components=[],componentOf=new Map();for(const node of nodes){if(componentOf.has(node.id)||!adjacency.has(node.id))continue;const queue=[node.id],index=components.length;componentOf.set(node.id,index);for(let q=0;q<queue.length;q++)for(const next of adjacency.get(queue[q])??[])if(!componentOf.has(next)){componentOf.set(next,index);queue.push(next);}components.push(queue);}
const outdoorComponents=new Set(original.anchors.filter(a=>a.id.startsWith('courtyard-')).map(a=>componentOf.get(a.id)).filter(v=>v!==undefined));
const exterior=thresholdCandidates.filter(n=>outdoorComponents.has(componentOf.get(n.id)));
const byDoor=new Map();for(const n of exterior){const key=`${n.door.sourceActor}:${n.door.instance}`;if(!byDoor.has(key))byDoor.set(key,n);}
const allEntrances=[...byDoor.values()].sort((a,b)=>a.p[2]-b.p[2]||a.p[0]-b.p[0]);
const entranceCounts=new Map();for(const entry of allEntrances){const component=componentOf.get(entry.id);entranceCounts.set(component,(entranceCounts.get(component)??0)+1);}
const selectedComponent=[...entranceCounts].sort((a,b)=>b[1]-a[1]||components[b[0]].length-components[a[0]].length||a[0]-b[0])[0]?.[0];
const entrances=allEntrances.filter(entry=>componentOf.get(entry.id)===selectedComponent);
// A household assignment is an explicit working authoring decision backed by a
// measured exterior entrance. It does not rename a courtyard as a house, nor
// certify a sleeping/eating/workstation pose behind the threshold.
const bindings=structuredClone(base.residentPlaceBindings??[]),households=[],jobs=[],placeBindings=structuredClone(base.placeBindings??[]);
const setBinding=(residentId,placeId,anchorId)=>{const old=bindings.find(v=>v.residentId===residentId&&v.placeId===placeId);if(old){old.anchorId=anchorId;old.status='mapped-exterior';}else bindings.push({residentId,placeId,anchorId,status:'mapped-exterior'});};
const certifiedAnvilApproaches=workCandidates.filter(n=>outdoorComponents.has(componentOf.get(n.id)));
let smithyEntry=null,smithyAnvil=null;for(const candidate of certifiedAnvilApproaches){const sameRegion=allEntrances.filter(e=>componentOf.get(e.id)===componentOf.get(candidate.id));if(!sameRegion.length)continue;const nearest=[...sameRegion].sort((a,b)=>Math.hypot(a.p[0]-candidate.p[0],a.p[2]-candidate.p[2])-Math.hypot(b.p[0]-candidate.p[0],b.p[2]-candidate.p[2]))[0];if(!smithyEntry||Math.hypot(nearest.p[0]-candidate.p[0],nearest.p[2]-candidate.p[2])<Math.hypot(smithyEntry.p[0]-smithyAnvil.p[0],smithyEntry.p[2]-smithyAnvil.p[2])){smithyEntry=nearest;smithyAnvil=candidate;}}
if(entrances.length){for(const [i,h]of population.households.entries()){const entry=h.homePlaceId==='smithy-house'&&smithyEntry?smithyEntry:entrances[i%entrances.length];households.push({householdId:h.id,placeId:h.homePlaceId,anchorId:entry.id,sourceDoor:{sourceActor:entry.door.sourceActor,instance:entry.door.instance,min:entry.door.min,max:entry.door.max},status:'working-household-exterior-assignment',sharedBuildingAllowed:true,indoorPoseEvidence:false});for(const residentId of h.memberIds)setBinding(residentId,h.homePlaceId,entry.id);}
 const workplaces=[...new Set(population.residents.map(r=>r.workPlaceId))].sort();for(const placeId of workplaces){const home=households.find(h=>h.placeId===placeId);
  if(home){jobs.push({placeId,anchorId:home.anchorId,status:'home-based-occupation-exterior-threshold',equipmentOrAnimationEvidence:false,indoorPoseEvidence:false});for(const r of population.residents.filter(r=>r.workPlaceId===placeId))setBinding(r.id,placeId,home.anchorId);}
  else if(placeId==='smithy-forge'&&smithyAnvil){jobs.push({placeId,anchorId:smithyAnvil.id,status:'source-anvil-exterior-approach',sourceObject:smithyAnvil.sourceObject,equipmentOrAnimationEvidence:false,indoorPoseEvidence:false});for(const r of population.residents.filter(r=>r.workPlaceId===placeId))setBinding(r.id,placeId,smithyAnvil.id);}
  else if(['village-well','village-courtyard','proposed-lanes'].includes(placeId)){jobs.push({placeId,status:'existing-certified-public-destinations',equipmentOrAnimationEvidence:false,indoorPoseEvidence:false});}
  else jobs.push({placeId,anchorId:null,status:'unmapped-requires-occupation-compatible-source-authoring',equipmentOrAnimationEvidence:false,indoorPoseEvidence:false});
 }
}
// Remove isolated nodes from render evidence: every anchor needs at least one
// newly certified complete route endpoint, matching the runtime validator.
for(const node of nodes)if(adjacency.has(node.id))binding.anchors[node.id]={sourceActor:node.sourceActor,standingOnly:true,sourceGroundPoint:node.p,capsuleBottomPoint:[node.p[0],node.p[1]+lift,node.p[2]]};
const kept=new Set(Object.keys(binding.anchors));for(const row of bindings)if(row.anchorId&&!kept.has(row.anchorId)){row.anchorId=null;row.status='unmapped';}
const rigidSourceClearance={schema:1,profile,sourceSha256:sha,frame:binding.frame,sourceOriginalBuffersUnchanged:true,originalTriangleFrameMaximumErrorMetres:0,proxy:{radiusMetres:radius,bottomAboveGroundMetres:.005,topAboveGroundMetres:height,rigidSourceMarginMetres:margin,terrainContactToleranceMetres:.02},anchors:Object.keys(binding.anchors).map(anchorId=>({anchorId,qualified:true})),routes:Object.keys(binding.routes).map(routeId=>({routeId,qualified:true}))};
const result={...base,binding,certificate,rigidSourceClearance,placeBindings,residentPlaceBindings:bindings,workplaceAnchors:[],lifeSite:{schemaVersion:1,sourceModelSha256:sha,sourceOriginalBuffersUnchanged:true,households,workplaces:jobs,doorInventory:doors,functionalObjectInventory:functionalObjects,qualifiedExteriorEntrances:allEntrances.map(n=>({anchorId:n.id,sourceDoor:n.door})),claim:'Source-verified exterior approach only. Working household/occupation allocation; no indoor, equipment, animation or observed-arrival evidence.'}};
const checked=createEaldholtVillageSite({profile,modelSha256:sha,binding,certificate,placeBindings,residentPlaceBindings:bindings});applyVillageSiteRigidClearance(checked,validateVillageSiteRigidClearance(checked,rigidSourceClearance));
const coverage=population.residents.map(r=>({residentId:r.id,home:!!resolveVillageSitePath(checked,r.homePlaceId,r.homePlaceId,r.id),work:!!resolveVillageSitePath(checked,r.workPlaceId,r.workPlaceId,r.id),homeWorkConnected:!!resolveVillageSitePath(checked,r.homePlaceId,r.workPlaceId,r.id)}));
const bytes=Buffer.from(JSON.stringify(result)),filename=`ealdholt-population-${profile}-life-sites-v4.json`,digest=crypto.createHash('sha256').update(bytes).digest('hex');fs.writeFileSync(resolve(dir,filename),bytes,{mode:0o600});
const report={profile,filename,bytes:bytes.length,sha256:digest,sourceSha256:sha,terrainTriangles,solidTriangles,anchors:checked.anchors.length,routes:checked.routes.length,components:components.map(c=>c.length).sort((a,b)=>b-a),doorInstances:doors.length,exteriorEntrances:allEntrances.length,assignedConnectedEntrances:entrances.length,households:households.length,workplaces:jobs.filter(j=>j.status!=='unmapped-requires-occupation-compatible-source-authoring').length,unmappedWorkplaces:jobs.filter(j=>j.status==='unmapped-requires-occupation-compatible-source-authoring').map(j=>j.placeId),residents:coverage.length,homeBound:coverage.filter(c=>c.home).length,workBound:coverage.filter(c=>c.work).length,homeWorkConnected:coverage.filter(c=>c.homeWorkConnected).length,coverage};fs.writeFileSync(resolve(dir,`${profile}-life-site-report.json`),JSON.stringify(report,null,2),{mode:0o600});console.log(JSON.stringify(report,null,2));query.destroy();nav.navMesh.destroy();
