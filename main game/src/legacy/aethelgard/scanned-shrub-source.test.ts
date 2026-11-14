import assert from 'node:assert/strict';
import test from 'node:test';
import {existsSync,readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {BufferAttribute,BufferGeometry,DoubleSide,Group,Mesh,MeshStandardMaterial,Quaternion,Texture,Vector3} from 'three';
import {borrowScannedShrubSource} from './scanned-shrub-source';
import {SCANNED_SHRUB_MEASURED,SCANNED_SHRUB_ASSETS,scannedShrubAssetMetadataMatches} from '../../../../shared/legacy/aethelgard/environment/scanned-shrub-assets';
const directory=process.env.CROWNFALL_SHRUB_SOURCE_FIXTURE??'/workspace/private-assets/crownfall/polyhaven-shrub02-b-pbr-v1-2026-11-11';

// Exact prepared uncompressed readback has already been checked against the
// shipped lossless Draco attributes/indices. Only CPU geometry/PBR metadata is
// instantiated here: image contents are never decoded, viewed or rendered.
for(const native of [false,true])test(`actual ${native?'Native':'Desktop'} shrub preserves source buffers/TRS/PBR and qualifies natural-height visual normalization`,{
 skip:!existsSync(join(directory,'manifest.json'))&&'Private exact-source fixture is unavailable.',
},()=>{
 const manifest=JSON.parse(readFileSync(join(directory,'manifest.json'),'utf8')),output=manifest.outputs[native?1:0],bytes=readFileSync(join(directory,output.fallback.filename));
 assert.equal(createHash('sha256').update(bytes).digest('hex'),output.fallback.sha256);
 const jsonLength=bytes.readUInt32LE(12),json=JSON.parse(bytes.subarray(20,20+jsonLength).toString()),binary=bytes.subarray(28+jsonLength);
 assert.ok(scannedShrubAssetMetadataMatches(json.asset.extras,native));
 const accessor=(id:number)=>{const a=json.accessors[id],v=json.bufferViews[a.bufferView],size=({SCALAR:1,VEC2:2,VEC3:3,VEC4:4} as Record<string,number>)[a.type],step=({5123:2,5125:4,5126:4} as Record<number,number>)[a.componentType];
  assert.ok(size&&step&&!a.normalized);const values=new Float32Array(a.count*size),data=new DataView(binary.buffer,binary.byteOffset,binary.byteLength),offset=(v.byteOffset??0)+(a.byteOffset??0),stride=v.byteStride??step*size;
  for(let i=0;i<a.count;i++)for(let c=0;c<size;c++)values[i*size+c]=a.componentType===5126?data.getFloat32(offset+i*stride+c*step,true):a.componentType===5123?data.getUint16(offset+i*stride+c*step,true):data.getUint32(offset+i*stride+c*step,true);
  return{values,size};};
 const primitive=json.meshes[0].primitives[0],geometry=new BufferGeometry();
 for(const [name,key]of [['position','POSITION'],['normal','NORMAL'],['uv','TEXCOORD_0']] as const){const a=accessor(primitive.attributes[key]);geometry.setAttribute(name,new BufferAttribute(a.values,a.size));}
 geometry.setIndex(new BufferAttribute(Uint32Array.from(accessor(primitive.indices).values),1));
 const textures=Array.from({length:3},()=>{const t=new Texture();t.image={width:native?512:1024,height:native?512:1024};return t;});
 const material=new MeshStandardMaterial({map:textures[1],normalMap:textures[0],roughnessMap:textures[2],metalnessMap:textures[2],aoMap:textures[2],alphaTest:.5,side:DoubleSide});
 const root=new Group(),node=json.nodes[json.scenes[json.scene??0].nodes[0]],mesh=new Mesh(geometry,material);root.add(mesh);
 mesh.position.fromArray(node.translation??[0,0,0]);mesh.quaternion.copy(new Quaternion().fromArray(node.rotation??[0,0,0,1]));mesh.scale.fromArray(node.scale??[1,1,1]);mesh.updateMatrix();
 const before={matrix:mesh.matrix.toArray(),position:geometry.getAttribute('position').array.slice(),normal:geometry.getAttribute('normal').array.slice(),index:geometry.index!.array.slice(),material:mesh.material};
 let borrowedDisposals=0;geometry.addEventListener('dispose',()=>borrowedDisposals++);material.addEventListener('dispose',()=>borrowedDisposals++);textures.forEach(t=>t.addEventListener('dispose',()=>borrowedDisposals++));
 try{
  const source=borrowScannedShrubSource(root,native);assert.ok(source);assert.equal(source.triangles,5242);assert.equal(source.height,SCANNED_SHRUB_MEASURED.height);assert.equal(source.textureBytes,SCANNED_SHRUB_ASSETS[native?'native':'desktop'].textureBytes);
  assert.equal(source.parts.length,1);assert.equal(source.parts[0].foliage,true);assert.equal(source.parts[0].geometry,geometry);assert.equal(source.parts[0].material,material);assert.equal(source.normalization.elements[0],1);assert.equal(source.normalization.elements[5],1);assert.equal(source.normalization.elements[10],1);assert.equal(source.normalization.elements[12],0);assert.equal(source.normalization.elements[14],0);
  assert.ok(Math.abs(source.bounds.min.y-source.contact.baseY)<1e-7);assert.ok(source.contact.radius<.24);assert.ok(source.canopyRadius+source.windReach<1);
  assert.deepEqual(mesh.matrix.toArray(),before.matrix);assert.deepEqual(geometry.getAttribute('position').array,before.position);assert.deepEqual(geometry.getAttribute('normal').array,before.normal);assert.deepEqual(geometry.index!.array,before.index);assert.equal(mesh.material,before.material);assert.equal(borrowedDisposals,0);
  const alpha=material.alphaTest;material.alphaTest=0;assert.equal(borrowScannedShrubSource(root,native),null);material.alphaTest=alpha;
  const position=geometry.getAttribute('position');position.setX(0,50);assert.equal(borrowScannedShrubSource(root,native),null,'wrong source geometry stays on the original bramble fallback');
 }finally{geometry.dispose();material.dispose();textures.forEach(t=>t.dispose());root.clear();}
});
