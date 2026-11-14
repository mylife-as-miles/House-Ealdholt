/** One source-bound, complete-leaf-cluster derivative. It is an optional
 * Desktop L1 representation; canonical source captures and Native stay intact. */
export const FOREST01_DENSITY_LOD = {
  version: 'forest01-whole-leaf-clusters-v1',
  sourceSha256: '3b02834505642a5a9e7535e92812df8e565b99005e9921d41be83be4f5da3b28',
  sourceLeafTriangles: 50471,
  sourceLeafVertices: 76843,
  leafTriangles: 31845,
  woodTriangles: 2744,
  triangles: 34589,
  ownerBufferBytes: 32768,
  selectionSha256: 'e33efb1ea0e132b085659cfe4b9ce6f0ca24d0f1a3b56ae9f370a907ba1f4955',
} as const;
import {FOREST01_DENSITY_WALKING} from './forest01-density-walking-data';
import {FOREST01_DENSITY_DATA} from './forest01-density-data';
import {worldBakeDigest} from './world-bake-cache';
import type {VegetationSimplifyInput} from './vegetation-simplify';
export type Forest01PackedInput = VegetationSimplifyInput & {channels:readonly {name:string;size:number}[]};
export interface Forest01PackedResult {positions:Float32Array;attributes:readonly {name:string;size:number;values:Float32Array}[];indices:Uint32Array;bounds:number[];error:number;sourceTriangles:number}
const digest=(array:ArrayBufferView)=>worldBakeDigest(new Uint8Array(array.buffer,array.byteOffset,array.byteLength));
const fail=()=>{throw Error('Unqualified Forest01 whole-cluster derivative.');};
export function densityWoodPart(vertices:number,triangles:number):0|1|null {
  return vertices===3030&&triangles===3941?0:vertices===3795&&triangles===3999?1:null;
}
export async function matchesForest01DensityInput(input:Forest01PackedInput,part:0|1|2):Promise<boolean>{
  const data=FOREST01_DENSITY_DATA.parts[part];
  if(input.positions.length!==data.sourceVertices*3||input.indices.length!==data.sourceTriangles*3||input.attributes.length!==data.sourceVertices*input.stride||input.channels.length!==data.channels.length||input.foliage!==(part===2)||!input.positions.every(Number.isFinite)||!input.attributes.every(Number.isFinite))return false;
  if(await digest(input.positions)!==data.sourcePositionsSha256||await digest(input.indices)!==data.sourceIndicesSha256)return false;
  let offset=0;
  for(const channel of input.channels){
    const expected=data.channels.find(c=>c.name===channel.name);if(!expected||channel.size!==expected.size)return false;
    const values=new Float32Array(data.sourceVertices*channel.size);
    for(let i=0;i<data.sourceVertices;i++)for(let k=0;k<channel.size;k++)values[i*channel.size+k]=input.attributes[i*input.stride+offset+k];
    if(await digest(values)!==expected.sha256)return false;offset+=channel.size;
  }
  return offset===input.stride&&new Set(input.channels.map(c=>c.name)).size===data.channels.length;
}
/** Cheap manifest replay, never the offline density search or another simplifier. */
export async function selectForest01DensityIndices(input:Forest01PackedInput):Promise<{indices:Uint32Array;error:number}>{
  if(!await matchesForest01DensityInput(input,2))return fail();
  const mask=decode(FOREST01_DENSITY_DATA.parts[2].originalTriangleSelection),indices=new Uint32Array(FOREST01_DENSITY_LOD.leafTriangles*3);let cursor=0;
  for(let face=0;face<FOREST01_DENSITY_LOD.sourceLeafTriangles;face++)if(mask[face>>3]&(1<<(face&7))){if(cursor+3>indices.length)return fail();indices.set(input.indices.subarray(face*3,face*3+3),cursor);cursor+=3;}
  if(cursor!==indices.length||await digest(indices)!==FOREST01_DENSITY_LOD.selectionSha256)return fail();
  return{indices,error:0};
}
export function decode(value:string):Uint8Array {return Uint8Array.from(atob(value),c=>c.charCodeAt(0));}
/** Used for the independent terrain proof, and only after source fingerprints
 * qualify. The draw's wood must independently match this exact packed output. */
export function forest01DensityWoodIndices(part:0|1):Uint32Array {
  const bytes=decode(FOREST01_DENSITY_DATA.parts[part].originalVertexIndicesU16),view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  return Uint32Array.from({length:bytes.length/2},(_,i)=>view.getUint16(i*2,true));
}
export async function matchesForest01DensityPacked(result:Forest01PackedResult,part:0|1|2):Promise<boolean>{
  const data=FOREST01_DENSITY_DATA.parts[part];
  if(part===2&&result.error!==0)return false;
  if(!(result.positions instanceof Float32Array)||!(result.indices instanceof Uint32Array)||result.positions.length!==data.packedVertices*3||result.indices.length!==data.triangles*3||result.sourceTriangles!==data.sourceTriangles||result.attributes.length!==data.packedChannels.length||!result.positions.every(Number.isFinite)||result.indices.some(i=>i>=data.packedVertices)||result.bounds.length!==6||!result.bounds.every(Number.isFinite))return false;
  if(await digest(result.positions)!==data.packedPositionsSha256||await digest(result.indices)!==data.packedIndicesSha256)return false;
  for(const channel of result.attributes){const expected=data.packedChannels.find(c=>c.name===channel.name);
    if(!expected||channel.size!==expected.size||!(channel.values instanceof Float32Array)||channel.values.length!==data.packedVertices*channel.size||await digest(channel.values)!==expected.sha256)return false;
  }
  return new Set(result.attributes.map(c=>c.name)).size===data.packedChannels.length;
}
/** Worker/cache boundary: broad index caps alone do not prove non-inflation. */
export function validPackedVegetationResult(result:Forest01PackedResult,sourceTriangles:number):boolean {
  const vertices=result.positions?.length/3;
  if(!(result.positions instanceof Float32Array)||!Number.isSafeInteger(vertices)||vertices<1||vertices>500000||!result.positions.every(Number.isFinite)||!(result.indices instanceof Uint32Array)||!result.indices.length||result.indices.length%3||result.indices.length>sourceTriangles*3||result.indices.some(i=>i>=vertices)||result.sourceTriangles!==sourceTriangles||!Number.isFinite(result.error)||result.error<0||!Array.isArray(result.bounds)||result.bounds.length!==6||!result.bounds.every(Number.isFinite)||!Array.isArray(result.attributes)||result.attributes.some(a=>!(a.values instanceof Float32Array)||!Number.isSafeInteger(a.size)||a.size<1||a.size>4||a.values.length!==vertices*a.size||!a.values.every(Number.isFinite))||new Set(result.attributes.map(a=>a.name)).size!==result.attributes.length)return false;
  const bounds=[Infinity,Infinity,Infinity,-Infinity,-Infinity,-Infinity];
  for(let at=0;at<result.positions.length;at++) {const axis=at%3,n=result.positions[at];bounds[axis]=Math.min(bounds[axis],n);bounds[axis+3]=Math.max(bounds[axis+3],n);}
  return bounds.every((n,i)=>n===result.bounds[i]);
}

export interface Forest01DensityWalkingProof {readonly version:string;readonly producer:string;readonly normalization:readonly number[];readonly triangles:Float64Array}
export function matchesForest01DensityNormalization(values:readonly number[]):boolean {return Array.isArray(values)&&values.length===16&&values.every((n,i)=>n===FOREST01_DENSITY_WALKING.normalization[i]);}
/** Synchronous exact-byte binding keeps the layout qualifier deterministic.
 * The producer supplies source-normalized coordinates, never actor offsets. */
export function validForest01DensityWalkingProof(proof:Forest01DensityWalkingProof|undefined):boolean {
 if(!proof||proof.version!==FOREST01_DENSITY_LOD.version||proof.producer!==FOREST01_DENSITY_WALKING.producer||!matchesForest01DensityNormalization(proof.normalization)||!(proof.triangles instanceof Float64Array)||proof.triangles.length!==FOREST01_DENSITY_WALKING.triangles*9)return false;
 const actual=new Uint8Array(proof.triangles.buffer,proof.triangles.byteOffset,proof.triangles.byteLength),expected=decode(FOREST01_DENSITY_WALKING.bytes);
 return actual.length===expected.length&&actual.every((n,i)=>n===expected[i]);
}
