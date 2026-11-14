import assert from 'node:assert/strict';import test from 'node:test';
import {readFile} from 'node:fs/promises';import {createHash} from 'node:crypto';
import {REGIONAL_VEGETATION_PROFILES} from '../../../../shared/legacy/aethelgard/environment/regional-vegetation-profiles';
test('production Low vegetation reduces branches while retaining exact foliage, PBR materials and actor frames',async()=>{
 const load=async(profile:keyof typeof REGIONAL_VEGETATION_PROFILES)=>{const info=REGIONAL_VEGETATION_PROFILES[profile],bytes=await readFile(new URL('../../../public/assets/legacy/environment/aethelgard/regional-v1/'+info.file,import.meta.url));assert.equal(createHash('sha256').update(bytes).digest('hex'),info.sha256);const n=bytes.readUInt32LE(12),json=JSON.parse(bytes.subarray(20,20+n).toString());return{json,binary:bytes.subarray(28+n)};};
 const high=await load('desktop'),low=await load('quest');assert.notEqual(REGIONAL_VEGETATION_PROFILES.desktop.sha256,REGIONAL_VEGETATION_PROFILES.quest.sha256);assert.deepEqual(high.json.materials,low.json.materials);assert.deepEqual(high.json.images,low.json.images);
 const accessor=(g:typeof high,id:number)=>{const a=g.json.accessors[id],v=g.json.bufferViews[a.bufferView];assert.ok(!v.byteStride,'Writer output must be tightly packed');return{type:a.type,componentType:a.componentType,count:a.count,bytes:g.binary.subarray((v.byteOffset??0)+(a.byteOffset??0),(v.byteOffset??0)+v.byteLength)};};
 let highBark=0,lowBark=0,leaves=0;
 for(const node of high.json.nodes){const peer=low.json.nodes.find((n:{name:string})=>n.name===node.name);assert.ok(peer);assert.deepEqual(node.matrix,peer.matrix);if(node.mesh===undefined)continue;
  const a=high.json.meshes[node.mesh].primitives,b=low.json.meshes[peer.mesh].primitives;
  if(node.name.endsWith('foliage')){leaves++;assert.equal(a.length,b.length);for(let p=0;p<a.length;p++){assert.equal(a[p].material,b[p].material);assert.deepEqual(accessor(high,a[p].indices),accessor(low,b[p].indices));for(const name of Object.keys(a[p].attributes))assert.deepEqual(accessor(high,a[p].attributes[name]),accessor(low,b[p].attributes[name]));}}
  else{for(const p of a)highBark+=high.json.accessors[p.indices].count/3;for(const p of b)lowBark+=low.json.accessors[p.indices].count/3;}
 }
 assert.equal(leaves,15);assert.ok(lowBark<highBark*.3,'The shipped Low asset must materially reduce branch work');
});
