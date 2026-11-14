// Regression tests for actual exported scene LOD, not GPU/texture validation.
import assert from 'node:assert/strict';
import * as T from 'crownfall-world-three';
import { applySourceLod } from './lod.js';
const group=mesh=>{const root=new T.Group(),part=new T.Group();part.name='Temple bridge';part.add(mesh);root.add(part);return root;};
const large=()=>new T.PlaneGeometry(1,1,160,160);
for(const mode of ['encoded','alpha','deforming','interleaved']){
 const geometry=large(),material=new T.MeshStandardMaterial(),mesh=new T.Mesh(geometry,material);
 if(mode==='encoded')geometry.setAttribute('aOrg',new T.Float32BufferAttribute(new Float32Array(geometry.attributes.position.count*3),3));
 if(mode==='alpha')material.alphaTest=.5;
 if(mode==='deforming')material.userData.patch={vertexWorld:'wPos4.xyz += vec3(1.0);'};
 if(mode==='interleaved'){
  const p=geometry.attributes.position,a=new Float32Array(p.count*5);for(let i=0;i<p.count;i++){a[i*5+1]=p.getX(i);a[i*5+2]=p.getY(i);a[i*5+3]=p.getZ(i);}
  geometry.setAttribute('position',new T.InterleavedBufferAttribute(new T.InterleavedBuffer(a,5),3,1));
 }
 applySourceLod(group(mesh),'quest');assert.ok(mesh.geometry===geometry,`${mode} geometry must be preserved`);
 console.log(`PASS ${mode} payload is not clustered`);
}
{
 const a=large(),b=large();b.translate(0,0,.0001);
 const position=new Float32Array(a.attributes.position.array.length+b.attributes.position.array.length),normal=new Float32Array(position.length),uv=new Float32Array(a.attributes.uv.array.length+b.attributes.uv.array.length);
 position.set(a.attributes.position.array);position.set(b.attributes.position.array,a.attributes.position.array.length);normal.set(a.attributes.normal.array);normal.set(b.attributes.normal.array,a.attributes.normal.array.length);uv.set(a.attributes.uv.array);uv.set(b.attributes.uv.array,a.attributes.uv.array.length);
 const geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.BufferAttribute(position,3));geometry.setAttribute('normal',new T.BufferAttribute(normal,3));geometry.setAttribute('uv',new T.BufferAttribute(uv,2));geometry.setIndex([...a.index.array,...Array.from(b.index.array,i=>i+a.attributes.position.count)]);
 const mesh=new T.Mesh(geometry,new T.MeshStandardMaterial());applySourceLod(group(mesh),'quest');
 const p=mesh.geometry.attributes.position;assert.ok(p.array.some((_,i)=>i%3===2&&Math.abs(p.array[i]-.0001)<1e-7),'second disconnected plane survives');
 for(let i=0;i<mesh.geometry.index.count;i+=3){const ix=mesh.geometry.index;const zs=[p.getZ(ix.getX(i)),p.getZ(ix.getX(i+1)),p.getZ(ix.getX(i+2))];assert.ok(Math.max(...zs)-Math.min(...zs)<1e-7,'no face bridges disconnected planes');}
 console.log('PASS disconnected components remain separate');
}
{
 const mesh=new T.InstancedMesh(new T.PlaneGeometry(1,1),new T.MeshStandardMaterial(),200);
 mesh.geometry.setAttribute('aTree',new T.InterleavedBufferAttribute(new T.InstancedInterleavedBuffer(new Float32Array(200*5),5),4,1));
 applySourceLod(group(mesh),'quest');assert.equal(mesh.count,200,'interleaved payload cannot be repacked independently of matrices');console.log('PASS interleaved instance data retains count and layout');
}
{
 const scaled=new T.InstancedMesh(large(),new T.MeshStandardMaterial(),1),unit=new T.InstancedMesh(large(),new T.MeshStandardMaterial(),1);
 scaled.setMatrixAt(0,new T.Matrix4().makeScale(100,.01,1));unit.setMatrixAt(0,new T.Matrix4());
 applySourceLod(group(scaled),'quest');applySourceLod(group(unit),'quest');
 const triangles=mesh=>(mesh.geometry.index?.count??mesh.geometry.attributes.position.count)/3;
 assert.ok(triangles(scaled)>triangles(unit),'large instances need finer source-space geometry than unit instances');
 console.log('PASS instance scale retains finer source-space geometry');
}
