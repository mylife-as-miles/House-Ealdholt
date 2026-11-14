import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {open, readFile} from 'node:fs/promises';
import test from 'node:test';
import {Box3, BufferAttribute, BufferGeometry, Group, InstancedMesh, Matrix4, MeshStandardMaterial,
  PerspectiveCamera, Quaternion, Scene, Vector3, type WebGLRenderer} from 'three';
import {createAuthoredArchitectureSuffixVisibility} from './architecture-suffix-visibility';

const sourcePath=process.env.CROWNFALL_ARCHITECTURE_SOURCE_GLB,reportPath=process.env.CROWNFALL_ARCHITECTURE_BASELINE_REPORT;
test('the pinned original source TRS and accepted Riverside camera select prefix12 with every source ordinal retained',
  {skip:!sourcePath||!reportPath},async()=>{
  const file=await open(sourcePath!,'r'),sha=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex');
  const read=async(bytes:number,start:number)=>{const b=Buffer.alloc(bytes),r=await file.read(b,0,bytes,start);assert.equal(r.bytesRead,bytes);return b;};
  try{
    const h=await read(20,0);assert.equal(h.readUInt32LE(0),0x46546c67);assert.equal(h.readUInt32LE(8),174285136);
    const length=h.readUInt32LE(12);assert.ok(length<2*1024*1024);const json=await read(length,20);
    assert.equal(sha(json),'fb9887f83c5ae189df52674e07bc9bc68bcb8d1a6757c8fccc6c770e6a92251e');
    const j=JSON.parse(json.toString()),node=j.nodes[1289],primitive=j.meshes[124].primitives[0],position=j.accessors[primitive.attributes.POSITION];
    assert.equal(node.name,'duvar_cell_-1_0');assert.equal(node.mesh,124);assert.deepEqual(node.children,[1303]);assert.equal(node.extras.crownfallElderbloom.sourceInstances,17);
    assert.ok(j.scenes[j.scene??0].nodes.includes(1289));assert.equal(node.matrix,undefined);assert.equal(node.translation,undefined);
    const hashes:Record<number,string>={4150:'4397b2fa1c17758b6aee2ac8e97535f470d20dd7574d551895f7cf1266042f1f',4151:'02fa37e5321e7bd77a607047d120edc54312343a8a13055e8571d098a0680e2a',4152:'b8da2241c5765eed3c52b91fd5ea8288ae443f636a998e03c1a54406f993bcc7'};
    const values=async(id:number,width:number)=>{const a=j.accessors[id],v=j.bufferViews[a.bufferView];assert.equal(a.count,16);assert.equal(a.componentType,5126);assert.equal(v.byteStride,undefined);
      const b=await read(a.count*width*4,28+length+(v.byteOffset??0)+(a.byteOffset??0));assert.equal(sha(b),hashes[id]);return Array.from({length:16},(_,i)=>Array.from({length:width},(_,c)=>b.readFloatLE((i*width+c)*4)));};
    const attrs=node.extensions.EXT_mesh_gpu_instancing.attributes,t=await values(attrs.TRANSLATION,3),q=await values(attrs.ROTATION,4),s=await values(attrs.SCALE,3);
    const report=JSON.parse(await readFile(reportPath!,'utf8'));assert.equal(report.passed,true);assert.equal(report.sourceCommit,'f2b8dc1f3efdd809d75269d5805f2747a87ddba6');
    const sourceSha=report.lastWorld.populationSourceSha256;assert.equal(sourceSha,'3b02834505642a5a9e7535e92812df8e565b99005e9921d41be83be4f5da3b28');
    const row=report.image.drawAttribution.topObjects.find((r:{name:string})=>r.name===node.name);assert.equal(row.triangles,16*j.accessors[primitive.indices].count/3);
    // Bounds/count reconstruction only: positions/pixels of the private asset
    // are not decoded, copied or committed, and no renderer/browser is started.
    const geometry=new BufferGeometry();geometry.setAttribute('position',new BufferAttribute(new Float32Array(position.count*3),3));
    geometry.setIndex(new BufferAttribute(new Uint16Array(j.accessors[primitive.indices].count),1));geometry.boundingBox=new Box3(new Vector3().fromArray(position.min),new Vector3().fromArray(position.max));
    const material=new MeshStandardMaterial(),source=new InstancedMesh(geometry,material,16);source.name=node.name;source.userData.crownfallElderbloom={kind:'architecture'};
    for(let i=0;i<16;i++)source.setMatrixAt(i,new Matrix4().compose(new Vector3().fromArray(t[i]),new Quaternion().fromArray(q[i]),new Vector3().fromArray(s[i])));
    const matrixBytes=Buffer.from(new Uint8Array(source.instanceMatrix.array.buffer)),root=new Group(),scene=new Scene();root.add(source);scene.add(root);
    const w=report.lastWorld,camera=new PerspectiveCamera(Number(w.cameraFov),report.image.width/report.image.height,.15,11000);camera.position.fromArray(JSON.parse(w.cameraPosition));camera.lookAt(new Vector3().fromArray(JSON.parse(w.cameraTarget)));camera.updateMatrixWorld(true);
    const renderer={render(_scene:Scene,_camera:PerspectiveCamera){return source.count;},xr:{isPresenting:false},shadowMap:{enabled:false},getRenderTarget(){return null;}};
    const owner=createAuthoredArchitectureSuffixVisibility({sourceRoot:root,sourceSha256:sourceSha,renderer:renderer as unknown as WebGLRenderer,scene,camera});
    try{
      assert.equal(owner.stats.status,'ready');assert.equal(renderer.render(scene,camera),12);assert.equal(source.count,16);
      assert.equal(owner.stats.potentialOmittedTriangles,71124);assert.equal(owner.stats.retainedMatrixBytes,1024);assert.equal(owner.stats.boundsTests,5);
      assert.deepEqual(Buffer.from(source.instanceMatrix.array.buffer),matrixBytes);
      const matrix=new Matrix4();for(let i=0;i<16;i++){source.getMatrixAt(i,matrix);assert.deepEqual(Array.from(matrix.elements),Array.from(new Float32Array(matrixBytes.buffer,matrixBytes.byteOffset+i*64,16)));}
    }finally{owner.dispose();source.dispose();geometry.dispose();material.dispose();}
  }finally{await file.close();}
});
