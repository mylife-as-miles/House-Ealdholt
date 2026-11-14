import { Box3, Matrix4, Mesh, Vector3, type BufferGeometry, type Material, type Object3D } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

export interface EaldholtFarWoodlandConfig { readonly url:string;readonly sha256:string }
export interface EaldholtFarWoodlandPart { readonly geometry:BufferGeometry;readonly targetMaterialName:string;readonly semanticID:string;readonly localMatrix?:Matrix4;readonly material?:Material }
export interface EaldholtFarWoodlandLod {
  readonly parts:readonly EaldholtFarWoodlandPart[];readonly bounds:Box3;readonly canopyRadius:number;
  readonly groundContactLocalY:number;readonly triangles:number;readonly geometryBytes:number;readonly referencedGeometryBytes:number;readonly sha256:string|null;
  readonly kind:'private-native-lod'|'borrowed-detailed';readonly ownership:'owned'|'borrowed';readonly sourceFamily:string;readonly sourceOwner?:Object3D;
  dispose():void;
}
export const EALDHOLT_FAR_WOODLAND_MAX_GLB_BYTES=128*1024;
export function readEaldholtFarWoodlandConfig(raw:unknown,baseUrl?:string):EaldholtFarWoodlandConfig|null {
  if(raw===undefined||raw===null||raw==='')return null;
  if(typeof raw!=='string')throw Error('Private far woodland configuration must be JSON text.');
  let data:unknown;try{data=JSON.parse(raw);}catch{throw Error('Invalid private far woodland JSON.');}
  if(!data||typeof data!=='object'||Array.isArray(data))throw Error('Incomplete private far woodland configuration.');
  const d=data as Record<string,unknown>;
  if(typeof d.url!=='string'||typeof d.sha256!=='string'||!/^[a-f0-9]{64}$/i.test(d.sha256))throw Error('Private far woodland requires a URL and SHA-256.');
  const url=new URL(d.url,baseUrl),sameOrigin=baseUrl&&url.origin===new URL(baseUrl).origin;
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash||!url.pathname.endsWith('.glb')
    ||!sameOrigin&&!['127.0.0.1','localhost','[::1]'].includes(url.hostname))throw Error('Private far woodland must be an immutable same-origin or loopback GLB.');
  return Object.freeze({url:url.href,sha256:d.sha256.toLowerCase()});
}

/** Validate the self-contained geometry-only container BEFORE GLTFLoader can
 * follow any resource references. The authenticated byte hash is checked first. */
export function validateEaldholtFarWoodlandGlb(bytes:ArrayBuffer):void {
  if(bytes.byteLength<28||bytes.byteLength>EALDHOLT_FAR_WOODLAND_MAX_GLB_BYTES)throw Error('Far woodland GLB exceeds its geometry-only size budget.');
  const v=new DataView(bytes);
  if(v.getUint32(0,true)!==0x46546c67||v.getUint32(4,true)!==2||v.getUint32(8,true)!==bytes.byteLength||v.getUint32(16,true)!==0x4e4f534a)throw Error('Invalid far woodland GLB header.');
  const length=v.getUint32(12,true),offset=20+length;
  if(length%4||offset+8>bytes.byteLength||v.getUint32(offset+4,true)!==0x004e4942||offset+8+v.getUint32(offset,true)!==bytes.byteLength)throw Error('Far woodland requires one JSON and one embedded BIN chunk.');
  let j:any;try{j=JSON.parse(new TextDecoder().decode(new Uint8Array(bytes,20,length)));}catch{throw Error('Invalid far woodland GLB JSON.');}
  if(j.asset?.version!=='2.0'||j.buffers?.length!==1||j.buffers[0].uri!==undefined||!Number.isSafeInteger(j.buffers[0].byteLength)||j.buffers[0].byteLength<1||j.buffers[0].byteLength>v.getUint32(offset,true)
    ||['materials','textures','images','skins','animations','cameras','extensionsUsed','extensionsRequired'].some(k=>j[k]?.length)
    ||j.extensions||j.buffers[0].extensions||j.bufferViews?.some((b:any)=>b.extensions||b.buffer!==0)
    ||j.meshes?.length!==3||j.meshes.some((m:any)=>m.extensions||m.primitives?.length!==1||m.primitives[0].extensions||m.primitives[0].material!==undefined
      ||(m.primitives[0].mode??4)!==4||!Number.isInteger(m.primitives[0].indices)))throw Error('Far woodland must contain only three complete embedded geometry parts.');
  if(j.nodes?.some((n:any)=>n.extensions||n.camera!==undefined||n.skin!==undefined))throw Error('Unsupported far woodland node resources.');
  const indexed=j.meshes.map((m:any)=>j.accessors?.[m.primitives[0].indices]?.count);
  if(indexed.some((n:unknown)=>typeof n!=='number'||!Number.isInteger(n)||n<=0||n%3)||indexed.reduce((a:number,b:number)=>a+b,0)!==1575)throw Error('Far woodland must retain the complete525-triangle source family.');
}

export async function loadEaldholtFarWoodlandLod(config:EaldholtFarWoodlandConfig,options:{signal:AbortSignal;fetcher?:typeof fetch}):Promise<EaldholtFarWoodlandLod> {
  options.signal.throwIfAborted();
  const response=await(options.fetcher??fetch)(config.url,{signal:options.signal,cache:'no-store',redirect:'error',credentials:'omit'});
  if(!response.ok)throw Error('Private far woodland request failed ('+response.status+').');
  const declared=response.headers.get('content-length');
  if(declared!==null&&(!/^\d+$/.test(declared)||+declared>EALDHOLT_FAR_WOODLAND_MAX_GLB_BYTES)){await response.body?.cancel();throw Error('Far woodland response exceeds its size budget.');}
  const reader=response.body?.getReader();if(!reader)throw Error('Far woodland response has no body.');
  const chunks:Uint8Array[]=[];let size=0;
  try {for(;;){const r=await reader.read();if(r.done)break;size+=r.value.byteLength;if(size>EALDHOLT_FAR_WOODLAND_MAX_GLB_BYTES)throw Error('Far woodland response exceeds its size budget.');chunks.push(r.value);}}
  catch(error){await reader.cancel().catch(()=>{});throw error;}finally{reader.releaseLock();}
  if(declared!==null&&size!==+declared)throw Error('Incomplete far woodland response.');
  const bytes=new Uint8Array(size);let at=0;for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.length;}
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(b=>b.toString(16).padStart(2,'0')).join('');
  if(hash!==config.sha256)throw Error('Private far woodland SHA-256 does not match.');
  validateEaldholtFarWoodlandGlb(bytes.buffer);options.signal.throwIfAborted();
  const gltf=await new GLTFLoader().parseAsync(bytes.buffer,''),geometries=new Set<BufferGeometry>(),materials=new Set<Material>();
  gltf.scene.traverse(o=>{if(o instanceof Mesh){geometries.add(o.geometry);for(const m of Array.isArray(o.material)?o.material:[o.material])materials.add(m);}});
  let disposed=false;
  const dispose=()=>{if(disposed)return;disposed=true;gltf.scene.removeFromParent();for(const g of geometries)g.dispose();for(const m of materials)m.dispose();gltf.scene.clear();};
  try {
    options.signal.throwIfAborted();gltf.scene.updateMatrixWorld(true);
    const roots=gltf.scene.children.filter(o=>o.userData.crownfallFarWoodlandLod),root=roots[0],tag=root?.userData.crownfallFarWoodlandLod;
    if(roots.length!==1||tag.schema!==1||tag.sourceUnits!=='metres'||tag.upAxis!=='+Y'||tag.partFrames!=='identity'||tag.requiresDesktopMaterialBinding!==true||tag.completeNativeLod!==true
      ||!Array.isArray(tag.rootOrigin)||tag.rootOrigin.length!==3||tag.rootOrigin.some((v:unknown)=>v!==0))throw Error('Far woodland root frame metadata is unqualified.');
    const parts:EaldholtFarWoodlandPart[]=[],identity=new Matrix4(),point=new Vector3(),bounds=new Box3();let triangles=0,geometryBytes=0;
    root.traverse(o=>{if(!(o instanceof Mesh))return;const p=o.userData.crownfallFarWoodlandLodPart,g=o.geometry as BufferGeometry,pos=g.getAttribute('position');
      if(!p||p.schema!==1||typeof p.targetMaterialName!=='string'||!p.targetMaterialName||typeof p.semanticID!=='string'
        ||!o.matrixWorld.equals(identity)||!g.index||!pos||pos.itemSize!==3||g.index.count%3)throw Error('Unqualified far woodland part or transform.');
      for(let i=0;i<pos.count;i++){point.fromBufferAttribute(pos,i);if(![point.x,point.y,point.z].every(Number.isFinite))throw Error('Nonfinite far woodland geometry.');bounds.expandByPoint(point);}
      triangles+=g.index.count/3;geometryBytes+=g.index.array.byteLength+Object.values(g.attributes).reduce((sum,a)=>sum+a.array.byteLength,0);
      parts.push({geometry:g,targetMaterialName:p.targetMaterialName,semanticID:p.semanticID});
    });
    const expected=['ealdholt-far-lod-bark','ealdholt-far-lod-canopy','ealdholt-far-lod-decoration'];
    if(parts.length!==3||triangles!==525||expected.some(id=>parts.filter(p=>p.semanticID===id).length!==1)||bounds.isEmpty())throw Error('Far woodland source family is incomplete.');
    const metadataBounds=tag.bounds;
    if(!metadataBounds||![...metadataBounds.min,...metadataBounds.max].every(Number.isFinite)
      ||bounds.min.toArray().some((v,i)=>Math.abs(v-metadataBounds.min[i])>1e-5)||bounds.max.toArray().some((v,i)=>Math.abs(v-metadataBounds.max[i])>1e-5)
      ||Math.abs(bounds.min.y-tag.groundContactLocalY)>1e-5)throw Error('Far woodland source bounds do not match actual geometry.');
    const canopyRadius=Math.hypot(Math.max(Math.abs(bounds.min.x),Math.abs(bounds.max.x)),Math.max(Math.abs(bounds.min.z),Math.abs(bounds.max.z)));
    if(Math.abs(canopyRadius-tag.conservativeFootprintRadius)>1e-5)throw Error('Far woodland source crown is unqualified.');
    return {parts,bounds,canopyRadius,groundContactLocalY:bounds.min.y,triangles:525,geometryBytes,referencedGeometryBytes:geometryBytes,sha256:hash,
      kind:'private-native-lod',ownership:'owned',sourceFamily:'private-native-lod-525',dispose};
  } catch(error){dispose();throw error;}
}
