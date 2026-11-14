// @ts-nocheck
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {VEGETATION_BRANCH_L2,acceptVegetationBranchL2} from '../../shared/legacy/aethelgard/environment/vegetation-branch-l2';
import {createHash} from 'node:crypto';
import {MeshoptSimplifier} from 'meshoptimizer';
import {simplifyVegetationIndices} from '../../shared/legacy/aethelgard/environment/vegetation-simplify.ts';
import {GLTFLoader} from '../../main game/node_modules/three/examples/jsm/loaders/GLTFLoader.js';
import {Mesh,DoubleSide,InstancedMesh,Matrix4} from '../../main game/node_modules/three/build/three.module.js';
// CPU-only original-source geometry inspection. No renderer, image decoder,
// generated assets, world construction, browser, saved state or capture.
const file=process.argv[2];if(!file)throw Error('Usage: tsx scripts/environment/measure-vegetation-l2.mts PRIVATE_GLB');
const raw=fs.readFileSync(file),n=raw.readUInt32LE(12),j=JSON.parse(raw.subarray(20,20+n).toString());
function strip(v){if(!v||typeof v!=='object')return;for(const k of Object.keys(v))if(/Texture$/.test(k))delete v[k];else strip(v[k]);}
delete j.images;delete j.textures;delete j.samplers;for(const m of j.materials??[])strip(m);
let text=Buffer.from(JSON.stringify(j));text=Buffer.concat([text,Buffer.alloc((4-text.length%4)%4,32)]);const tail=raw.subarray(20+n),b=Buffer.alloc(20+text.length+tail.length);raw.copy(b,0,0,12);b.writeUInt32LE(b.length,8);b.writeUInt32LE(text.length,12);b.writeUInt32LE(0x4e4f534a,16);text.copy(b,20);tail.copy(b,20+text.length);
globalThis.self=globalThis;const gltf=await new GLTFLoader().parseAsync(b.buffer.slice(b.byteOffset,b.byteOffset+b.length),'');gltf.scene.updateMatrixWorld(true);
const seen=new Set(),rows=[],mat=new Matrix4(),frame=new Matrix4(),meshes=[],maximumScales=new Map();
gltf.scene.traverse(node=>{if(node instanceof Mesh)meshes.push(node);});
// The first named user is only a row label. Every source user of the same
// geometry contributes its original instance scale before geometry deduplication.
for(const mesh of meshes){let scale=mesh.matrixWorld.getMaxScaleOnAxis(),instances=1;if(mesh instanceof InstancedMesh){scale=0;instances=mesh.instanceMatrix.count;for(let i=0;i<instances;i++){mesh.getMatrixAt(i,mat);scale=Math.max(scale,frame.multiplyMatrices(mesh.matrixWorld,mat).getMaxScaleOnAxis());}}
 const prior=maximumScales.get(mesh.geometry);if(prior){prior.scale=Math.max(prior.scale,scale);prior.users++;prior.instances+=instances;}else maximumScales.set(mesh.geometry,{scale,users:1,instances});
}
for(const mesh of meshes){
 let family=null;for(let owner=mesh;owner;owner=owner.parent)if(/SM_BlackAlder_/.test(owner.name))family=owner;if(!family||mesh.material.side===DoubleSide||seen.has(mesh.geometry))continue;seen.add(mesh.geometry);
 const geo=mesh.geometry,p=geo.getAttribute('position'),entries=Object.entries(geo.attributes).filter(([name])=>name!=='position'),stride=entries.reduce((n,[,a])=>n+a.itemSize,0),positions=Float32Array.from({length:p.count*3},(_,i)=>p.getComponent(Math.floor(i/3),i%3)),attributes=new Float32Array(p.count*stride);
 for(let i=0;i<p.count;i++){let o=i*stride;for(const[,a]of entries)for(let c=0;c<a.itemSize;c++)attributes[o++]=a.getComponent(i,c);}
 const input={positions,attributes,indices:geo.index?Uint32Array.from(geo.index.array):Uint32Array.from({length:p.count},(_,i)=>i),stride,foliage:false,attributeWeights:entries.flatMap(([name,a])=>Array(a.itemSize).fill(name==='normal'?.1:name==='tangent'?.01:.2))};
 const {scale,users,instances}=maximumScales.get(mesh.geometry);
 const l1=await simplifyVegetationIndices({...input,ratio:.35,error:.015},MeshoptSimplifier),candidates=[];
 for(const error of [VEGETATION_BRANCH_L2.error]){const r=await simplifyVegetationIndices({...input,ratio:VEGETATION_BRANCH_L2.ratio,error},MeshoptSimplifier),metres=r.error*MeshoptSimplifier.getScale(positions,3)*scale;assert.ok(r.error<=error+1e-7);assert.ok(Math.abs(r.indices.reduce((y,i)=>Math.min(y,positions[i*3+1]),Infinity)-input.indices.reduce((y,i)=>Math.min(y,positions[i*3+1]),Infinity))<1e-5);candidates.push({budget:error,triangles:r.indices.length/3,selectedTriangles:acceptVegetationBranchL2(input.indices.length/3,l1.indices.length/3,r.indices.length/3,r.error)?r.indices.length/3:l1.indices.length/3,heldAtL1:!acceptVegetationBranchL2(input.indices.length/3,l1.indices.length/3,r.indices.length/3,r.error),error:r.error,maximumSourceMetres:metres,low300pxAt123_9m:metres*300/(2*Math.tan(Math.PI/6)*123.9),vr1832pxAt80_5m:metres*1832/(2*80.5)});}
 rows.push({family:family.name,material:mesh.material.name,source:input.indices.length/3,l1:l1.indices.length/3,maximumActorScale:scale,geometryUsers:users,sourceInstances:instances,candidates});
}
console.log(JSON.stringify({profile:VEGETATION_BRANCH_L2,limits:'Meshoptimizer relative error estimate, not a Hausdorff/silhouette guarantee or measured FPS. Pixel estimates use original recorded maximum actor scale; future rescaling/projections must be checked separately. No image pixels or renderer used. L0/L1 and captures are unchanged.',rootContactPreserved:true,sourceSha256:createHash('sha256').update(raw).digest('hex'),rows},null,2));
