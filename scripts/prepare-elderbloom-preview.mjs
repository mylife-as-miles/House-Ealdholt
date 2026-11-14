// Local, offline preview preparation. Never edits the source or publishes assets.
// Run: node scripts/prepare-elderbloom-preview.mjs source.glb output.glb
// Reference Desktop profile (private outputs only): add --desktop-detail
// --detail-compact --full-terrain --material-repair-audit=/private/exact-audit.json.
// The audit proves identical POSITION/NORMAL/TANGENT/UV/index accessor identities
// before replacing failed magenta exports. Tree material variants with identical
// geometry/UVs share one authored template, disclosed in the adjacent report.
// Dense source-positioned vegetation is retained in spatial cells, not deleted.
// The renderer MUST distance/frustum-cull groundcover cells (8m); global counts
// are not a rendering budget or a headset-performance pass. Compact base-colour
// maps require EXT_texture_webp; all other data maps stay PNG. Existing ordinary
// preview profiles retain their established geometry/texture settings.
import { open, readFile, writeFile, mkdir, stat, lstat, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
const desktopRequire = createRequire(new URL('../main game/package.json', import.meta.url));
const questRequire = createRequire(new URL('../main-game-vr/package.json', import.meta.url));
const { Box3, Matrix3, Matrix4, Vector3, Quaternion } = desktopRequire('three');
const { MeshoptSimplifier } = desktopRequire('meshoptimizer');
const sharp = questRequire('sharp');
const sourcePath = await realpath(resolve(process.argv[2] ?? '/workspace/private-assets/elderbloom/elderbloom_hollow.glb'));
const outputPath = resolve(process.argv[3] ?? '/workspace/private-assets/elderbloom/optimized/elderbloom-courtyard-raw.glb');
if (sourcePath === outputPath) throw new Error('Source and derivative must differ.');
// Preserve prior models, reports and symlink aliases before doing expensive work.
// Exclusive final writes close the race between this preflight and persistence.
for(const destination of [outputPath,outputPath+'.report.json',outputPath+'.terrain-cost.json']){
 try{await lstat(destination);throw new Error(`Refusing existing output or symlink: ${destination}`);}
 catch(error){if(error.code!=='ENOENT')throw error;}
}

const questPreview = process.argv.includes('--quest-preview');
const desktopDetail = process.argv.includes('--desktop-detail');
const detailCompact = process.argv.includes('--detail-compact');
const canopyV5 = process.argv.includes('--canopy-v5');
if(canopyV5&&!desktopDetail)throw new Error('Canopy repair requires the Desktop detail profile.');
if(detailCompact&&!desktopDetail)throw new Error('Compact detail requires the Desktop detail profile.');
if(desktopDetail&&questPreview)throw new Error('Desktop detail is a separate profile from Quest preview.');
const repairAuditPath=process.argv.find(arg=>arg.startsWith('--material-repair-audit='))?.slice('--material-repair-audit='.length);
if(desktopDetail&&!repairAuditPath)throw new Error('Desktop detail requires an explicit exact-accessor material repair audit.');
const fullTerrain = process.argv.includes('--full-terrain'),terrainCostOnly=process.argv.includes('--terrain-cost-only'),terrainPositionOnly=process.argv.includes('--terrain-position-only');
const repairSmallTerrainHole=process.argv.includes('--repair-small-terrain-hole');
const terrainMaxError=Number(process.argv.find(arg=>arg.startsWith('--terrain-max-error='))?.split('=')[1]??'.15');
if(![.15,.5].includes(terrainMaxError))throw new Error('Only the bounded0.15m and0.5m experimental terrain tiers are supported.');
if(terrainCostOnly&&!questPreview)throw new Error('Terrain-only cost pass requires the Quest candidate profile.');
const profile = canopyV5 ? 'desktop-detail-canopy-v5' : desktopDetail ? 'desktop-detail' : questPreview ? 'quest-preview' : process.argv.includes('--full-village') ? 'full-village' : 'central-courtyard';
const neighborhood = profile !== 'central-courtyard';
const bounds = desktopDetail ? { minX:-51, maxX:103, minZ:-51, maxZ:103 } : neighborhood ? { minX:-24, maxX:86, minZ:-23, maxZ:81 } : { minX:18, maxX:51, minZ:25, maxZ:52 };
const source = await open(sourcePath, 'r');
const header = Buffer.alloc(20); await source.read(header,0,20,0);
if(header.readUInt32LE(0)!==0x46546c67||header.readUInt32LE(4)!==2)throw new Error('Expected GLB2.');
const jsonBytes = header.readUInt32LE(12), jsonBuffer = Buffer.alloc(jsonBytes);
await source.read(jsonBuffer,0,jsonBytes,20);
const input = JSON.parse(jsonBuffer.toString('utf8'));
const binOffset = 28 + jsonBytes;
const chunks=[], out={asset:{version:'2.0',generator:'Crownfall local Elderbloom preview preparation'},scene:0,scenes:[{name:'Elderbloom village local preview',nodes:[]}],nodes:[],meshes:[],accessors:[],bufferViews:[],buffers:[{byteLength:0}],materials:[],textures:[],images:[],samplers:input.samplers??[],extensionsUsed:['EXT_mesh_gpu_instancing'],extensionsRequired:['EXT_mesh_gpu_instancing']};
let byteOffset=0, geometryBytes=0, decodedTextureBytes=0;
function append(bytes,target){const pad=(4-byteOffset%4)%4;if(pad){chunks.push(Buffer.alloc(pad));byteOffset+=pad;}const idx=out.bufferViews.length;out.bufferViews.push({buffer:0,byteOffset,byteLength:bytes.byteLength,...(target?{target}:{})});chunks.push(Buffer.from(bytes.buffer,bytes.byteOffset,bytes.byteLength));byteOffset+=bytes.byteLength;return idx;}
function accessor(array,type,target,min,max){const componentType=array instanceof Float32Array?5126:array instanceof Uint32Array?5125:array instanceof Uint16Array?5123:5121;const width={SCALAR:1,VEC2:2,VEC3:3,VEC4:4}[type];const idx=out.accessors.length;out.accessors.push({bufferView:append(array,target),componentType,count:array.length/width,type,...(min?{min,max}:{})});geometryBytes+=array.byteLength;return idx;}
const rawViews=new Map(), typedAccessors=new Map();
async function rawView(idx){if(rawViews.has(idx))return rawViews.get(idx);const view=input.bufferViews[idx],bytes=Buffer.alloc(view.byteLength);await source.read(bytes,0,bytes.length,binOffset+(view.byteOffset??0));rawViews.set(idx,bytes);return bytes;}
async function readAccessor(idx){if(typedAccessors.has(idx))return typedAccessors.get(idx);const a=input.accessors[idx],v=input.bufferViews[a.bufferView],raw=await rawView(a.bufferView);const width={SCALAR:1,VEC2:2,VEC3:3,VEC4:4}[a.type],sizes={5121:1,5123:2,5125:4,5126:4};if(!width||!sizes[a.componentType]||a.sparse)throw new Error('Unsupported source accessor.');const values=new Float32Array(a.count*width);const stride=v.byteStride??width*sizes[a.componentType];for(let i=0;i<a.count;i++)for(let j=0;j<width;j++){const o=(a.byteOffset??0)+i*stride+j*sizes[a.componentType];let x=a.componentType===5126?raw.readFloatLE(o):a.componentType===5125?raw.readUInt32LE(o):a.componentType===5123?raw.readUInt16LE(o):raw.readUInt8(o);if(a.normalized)x/=a.componentType===5123?65535:255;values[i*width+j]=x;}typedAccessors.set(idx,values);return values;}
const matrices=[];
function walk(index,parent){const n=input.nodes[index];const local=n.matrix?new Matrix4().fromArray(n.matrix):new Matrix4().compose(new Vector3().fromArray(n.translation??[0,0,0]),new Quaternion().fromArray(n.rotation??[0,0,0,1]),new Vector3().fromArray(n.scale??[1,1,1]));const m=parent.clone().multiply(local);matrices[index]=m;for(const child of n.children??[])walk(child,m);}
for(const root of input.scenes[input.scene??0].nodes)walk(root,new Matrix4());
function category(mesh){const name=mesh.name??'';return /^LandscapeComponent/.test(name)?'terrain':/BlackAlder/.test(name)?'tree':(desktopDetail?/Grass|flower|vmcobd0ja|vgztealha/i:/Grass|flower|vmcobd0ja/i).test(name)?'groundcover':'architecture';}
function centre(nodeIndex){const node=input.nodes[nodeIndex],m=input.meshes[node.mesh];const p=input.accessors[m.primitives[0].attributes.POSITION];return new Vector3().fromArray(p.min??[0,0,0]).add(new Vector3().fromArray(p.max??[0,0,0])).multiplyScalar(.5).applyMatrix4(matrices[nodeIndex]);}
const selectedByMesh=new Map(), selected=[], treeCells=new Set(), grassCells=new Set(), sourceCounts={terrain:0,tree:0,groundcover:0,architecture:0};
// Full neighborhood keeps a bounded, spatially representative set of existing
// lower-detail source trees, with every retained source transform unchanged.
const sourceTriangles=m=>m.primitives.reduce((n,p)=>n+(p.indices!==undefined?input.accessors[p.indices].count:input.accessors[p.attributes.POSITION].count)/3,0);
const treeCandidates=input.nodes.map((n,i)=>({n,i})).filter(({n,i})=>n.mesh!==undefined&&matrices[i]&&category(input.meshes[n.mesh])==='tree'&&sourceTriangles(input.meshes[n.mesh])<=15000).map(({i})=>({i,p:centre(i)})).filter(({p})=>p.x>=bounds.minX&&p.x<=bounds.maxX&&p.z>=bounds.minZ&&p.z<=bounds.maxZ);
const boundedTrees=new Set();if(!desktopDetail&&neighborhood&&treeCandidates.length){let next=treeCandidates.reduce((a,b)=>a.p.distanceToSquared(new Vector3(bounds.minX,0,bounds.maxZ))<b.p.distanceToSquared(new Vector3(bounds.minX,0,bounds.maxZ))?a:b);while(boundedTrees.size<(questPreview?8:18)&&next){boundedTrees.add(next.i);next=treeCandidates.filter(c=>!boundedTrees.has(c.i)).map(c=>({...c,spacing:Math.min(...treeCandidates.filter(v=>boundedTrees.has(v.i)).map(v=>(c.p.x-v.p.x)**2+(c.p.z-v.p.z)**2))})).sort((a,b)=>b.spacing-a.spacing)[0];}}

for(let i=0;i<input.nodes.length;i++){const node=input.nodes[i];if(node.mesh===undefined||!matrices[i])continue;const mesh=input.meshes[node.mesh],kind=category(mesh);sourceCounts[kind]++;const c=centre(i);if(kind!=='terrain'&&(c.x<bounds.minX||c.x>bounds.maxX||c.z<bounds.minZ||c.z>bounds.maxZ))continue;if(!desktopDetail&&kind==='tree'){if(neighborhood){if(!boundedTrees.has(i))continue;}else{const cell=`${Math.floor(c.x/7)}:${Math.floor(c.z/7)}`;if(treeCells.has(cell))continue;treeCells.add(cell);}}if(!desktopDetail&&kind==='groundcover'){if(!/Grass_Clumps/.test(mesh.name))continue;if(neighborhood&&!/Var2_lod1/.test(mesh.name))continue;const spacing=questPreview?30:neighborhood?15:5;const cell=`${Math.floor(c.x/spacing)}:${Math.floor(c.z/spacing)}`;if(grassCells.has(cell)||(neighborhood&&grassCells.size>=(questPreview?8:48)))continue;grassCells.add(cell);}const arr=selectedByMesh.get(node.mesh)??[];arr.push(i);selectedByMesh.set(node.mesh,arr);selected.push({node:i,kind});}
// A single shared terrain topology avoids independent component LOD cracks.
// Only the untextured terrain is welded; architectural geometry is untouched.
let terrainWeldReport=null,terrainContactLocks=null,terrainGuardBounds=bounds;
if(questPreview){
 const positions=[],normalSums=[],indices=[],welded=new Map(),owners=[],seamVertices=new Set();
 const contactCells=new Map();let contactFootprints=0;
 for(const[meshId,nodeIds]of selectedByMesh){const mesh=input.meshes[meshId];if(!/Medieval_Modular|^Wall_|^duvar$|^çatı$|SM_MERGED_StaticMeshActor|^Extrude_|^Cone_/.test(mesh.name??''))continue;const local=new Box3();for(const p of mesh.primitives){const a=input.accessors[p.attributes.POSITION];if(a.min&&a.max)local.union(new Box3(new Vector3().fromArray(a.min),new Vector3().fromArray(a.max)));}for(const nodeId of nodeIds){const box=local.clone().applyMatrix4(matrices[nodeId]),footprint=[box.min.x-1,box.max.x+1,box.min.z-1,box.max.z+1];contactFootprints++;for(let x=Math.floor(footprint[0]/4);x<=Math.floor(footprint[1]/4);x++)for(let z=Math.floor(footprint[2]/4);z<=Math.floor(footprint[3]/4);z++){const key=`${x}:${z}`,list=contactCells.get(key)??[];list.push(footprint);contactCells.set(key,list);}}}

 const sourceTerrain=[...selectedByMesh].filter(([mesh])=>category(input.meshes[mesh])==='terrain');
 for(const[mesh,nodeIds]of sourceTerrain){
  for(const nodeId of nodeIds){
   const transform=matrices[nodeId],normalTransform=new Matrix3().getNormalMatrix(transform);
   for(const primitive of input.meshes[mesh].primitives){
    const p=await readAccessor(primitive.attributes.POSITION),n=await readAccessor(primitive.attributes.NORMAL),ix=Uint32Array.from(await readAccessor(primitive.indices));
    const localMap=new Map();
    function vertex(old){
     if(localMap.has(old))return localMap.get(old);
     const v=new Vector3().fromArray(p,old*3).applyMatrix4(transform),normal=new Vector3().fromArray(n,old*3).applyNormalMatrix(normalTransform),qx=Math.floor(v.x/.0002),qy=Math.floor(v.y/.0002),qz=Math.floor(v.z/.0002);
     let id;
     for(let dx=-1;dx<=1&&id===undefined;dx++)for(let dy=-1;dy<=1&&id===undefined;dy++)for(let dz=-1;dz<=1&&id===undefined;dz++)for(const candidate of welded.get(`${qx+dx}:${qy+dy}:${qz+dz}`)??[]){const x=positions[candidate*3]-v.x,y=positions[candidate*3+1]-v.y,z=positions[candidate*3+2]-v.z;if(x*x+y*y+z*z<=.0002**2){id=candidate;break;}}
     if(id===undefined){id=positions.length/3;positions.push(v.x,v.y,v.z);normalSums.push(normal.x,normal.y,normal.z);owners.push(mesh);const key=`${qx}:${qy}:${qz}`,cell=welded.get(key)??[];cell.push(id);welded.set(key,cell);}else{normalSums[id*3]+=normal.x;normalSums[id*3+1]+=normal.y;normalSums[id*3+2]+=normal.z;if(owners[id]!==mesh)seamVertices.add(id);}
     localMap.set(old,id);return id;
    }
    for(let i=0;i<ix.length;i+=3){const a=new Vector3().fromArray(p,ix[i]*3).applyMatrix4(transform),b=new Vector3().fromArray(p,ix[i+1]*3).applyMatrix4(transform),c=new Vector3().fromArray(p,ix[i+2]*3).applyMatrix4(transform),x=(a.x+b.x+c.x)/3,z=(a.z+b.z+c.z)/3;if(!fullTerrain&&(x<bounds.minX||x>bounds.maxX||z<bounds.minZ||z>bounds.maxZ))continue;indices.push(vertex(ix[i]),vertex(ix[i+1]),vertex(ix[i+2]));}
   }
  }
  selectedByMesh.delete(mesh);
 }
 if(!seamVertices.size)throw new Error('Expected connected source landscape seams.');
 if(fullTerrain){terrainGuardBounds={minX:Infinity,maxX:-Infinity,minZ:Infinity,maxZ:-Infinity};for(let i=0;i<positions.length;i+=3){terrainGuardBounds.minX=Math.min(terrainGuardBounds.minX,positions[i]);terrainGuardBounds.maxX=Math.max(terrainGuardBounds.maxX,positions[i]);terrainGuardBounds.minZ=Math.min(terrainGuardBounds.minZ,positions[i+2]);terrainGuardBounds.maxZ=Math.max(terrainGuardBounds.maxZ,positions[i+2]);}}
 terrainContactLocks=new Uint8Array(positions.length/3);for(let i=0;i<terrainContactLocks.length;i++){const x=positions[i*3],z=positions[i*3+2];if((contactCells.get(`${Math.floor(x/4)}:${Math.floor(z/4)}`)??[]).some(f=>x>=f[0]&&x<=f[1]&&z>=f[2]&&z<=f[3]))terrainContactLocks[i]=1;}
 for(let i=0;i<normalSums.length;i+=3){const n=new Vector3().fromArray(normalSums,i).normalize();n.toArray(normalSums,i);}
 function syntheticAccessor(array,type){const index=input.accessors.length;input.accessors.push({componentType:5126,type,count:array.length/(type==='VEC3'?3:1)});typedAccessors.set(index,array);return index;}
 const p=syntheticAccessor(Float32Array.from(positions),'VEC3'),n=syntheticAccessor(Float32Array.from(normalSums),'VEC3'),ix=syntheticAccessor(Uint32Array.from(indices),'SCALAR'),mesh=input.meshes.length,node=input.nodes.length;
 input.meshes.push({name:'LandscapeComponent_0',primitives:[{attributes:{POSITION:p,NORMAL:n},indices:ix,material:0}]});input.nodes.push({name:'LandscapeComponent_0',mesh});matrices[node]=new Matrix4();selectedByMesh.set(mesh,[node]);
 terrainWeldReport={sourceCandidateComponents:sourceTerrain.length,sourceComponents:new Set(owners).size,weldedVertices:positions.length/3,sharedSeamVertices:seamVertices.size,sourceTriangles:indices.length/3,maxPositionMergeToleranceMetres:.0002,structuralContactFootprints:contactFootprints,lockedContactVertices:terrainContactLocks.reduce((n,v)=>n+v,0),outsideContactErrorCapMetres:terrainMaxError};
}
if(terrainCostOnly)for(const[mesh]of [...selectedByMesh])if(category(input.meshes[mesh])!=='terrain')selectedByMesh.delete(mesh);
const exactMaterialRepairs=[],normalizedTreeMaterialBindings=[];
if(desktopDetail){
 const audit=JSON.parse(await readFile(resolve(repairAuditPath),'utf8'));
 if(audit.unresolvedTreeMaterialBindings?.length)throw new Error('Tree material repair audit has unresolved bindings.');
 const signature=p=>JSON.stringify({attributes:p.attributes,indices:p.indices,mode:p.mode??4});
 for(const entry of [...(audit.safeTreeMaterialBindings??[]),...(audit.safeGrassMaterialBindings??[])]){
  const primitive=input.meshes[entry.mesh]?.primitives[entry.primitive],replacement=entry.matches?.[0];
  const alternative=replacement&&input.meshes[replacement[0]]?.primitives[replacement[1]],bad=input.materials[entry.material];
  if(!primitive||primitive.material!==entry.material||!alternative||alternative.material!==replacement[2]||signature(primitive)!==signature(alternative))throw new Error('Material repair audit does not exactly match source geometry/UV signature.');
  if(JSON.stringify(bad?.pbrMetallicRoughness?.baseColorFactor)!=='[1,0,1,1]'||bad?.pbrMetallicRoughness?.baseColorTexture||(bad?.emissiveFactor!==undefined&&JSON.stringify(bad.emissiveFactor)!=='[1,0,1]'))throw new Error('Material repair expected a literal failed magenta export.');
  primitive.material=replacement[2];exactMaterialRepairs.push({mesh:entry.mesh,primitive:entry.primitive,failedSourceMaterial:entry.material,templateMesh:replacement[0],templatePrimitive:replacement[1],templateSourceMaterial:replacement[2]});
 }
 // Unreal exported different baked maps per actor for otherwise byte-identical
 // tree prototypes. Share one authored, usable material per exact accessor/UV
 // signature; never transfer a texture to different geometry or UV coordinates.
 const treeTemplates=new Map();
 for(let mesh=0;mesh<input.meshes.length;mesh++){
  if(category(input.meshes[mesh])!=='tree')continue;
  for(let pi=0;pi<input.meshes[mesh].primitives.length;pi++){
   const primitive=input.meshes[mesh].primitives[pi],key=signature(primitive),mat=input.materials[primitive.material];
   if(!mat?.pbrMetallicRoughness?.baseColorTexture)throw new Error('Tree template has no authored base-colour map.');
   const template=treeTemplates.get(key);
   if(!template)treeTemplates.set(key,{mesh,primitive:pi,material:primitive.material});
   else if(primitive.material!==template.material){normalizedTreeMaterialBindings.push({mesh,primitive:pi,sourceMaterial:primitive.material,templateMesh:template.mesh,templatePrimitive:template.primitive,templateSourceMaterial:template.material});primitive.material=template.material;}
  }
 }
}
const canopySourceLodSubstitutions=[];
if(canopyV5){
 const geometrySignature=mesh=>JSON.stringify(mesh.primitives.map(p=>({attributes:p.attributes,indices:p.indices,mode:p.mode??4})));
 const fieldSignature=geometrySignature(input.meshes[96]);
 if(input.meshes[96]?.name!=='SM_BlackAlder_Field_04'||input.meshes[97]?.name!=='SM_BlackAlder_Field_04_PP')throw new Error('Canopy repair expects the audited source Field04 and matching PP LOD.');
 function meshBounds(mesh){const box=new Box3();for(const p of mesh.primitives){const a=input.accessors[p.attributes.POSITION];if(!a.min||!a.max)throw new Error('Canopy LOD bounds require authored bounds.');box.union(new Box3(new Vector3().fromArray(a.min),new Vector3().fromArray(a.max)));}return box;}
 const originalBounds=meshBounds(input.meshes[96]),replacementBounds=meshBounds(input.meshes[97]);
 const localBoundsDelta=Math.max(...originalBounds.min.toArray().map((v,i)=>Math.abs(v-replacementBounds.min.getComponent(i))),...originalBounds.max.toArray().map((v,i)=>Math.abs(v-replacementBounds.max.getComponent(i))));
 if(localBoundsDelta>.05)throw new Error('Same-family canopy source LOD no longer meets the measured 5cm local bound guard.');
 const replacementNodes=[...(selectedByMesh.get(97)??[])];
 for(const[mesh,nodeIndices]of [...selectedByMesh]){
  if(category(input.meshes[mesh])!=='tree'||geometrySignature(input.meshes[mesh])!==fieldSignature)continue;
  let maxWorldBoundsCoordinateDelta=0;
  for(const nodeIndex of nodeIndices){const a=originalBounds.clone().applyMatrix4(matrices[nodeIndex]),b=replacementBounds.clone().applyMatrix4(matrices[nodeIndex]);maxWorldBoundsCoordinateDelta=Math.max(maxWorldBoundsCoordinateDelta,...a.min.toArray().map((v,i)=>Math.abs(v-b.min.getComponent(i))),...a.max.toArray().map((v,i)=>Math.abs(v-b.max.getComponent(i))));}
  canopySourceLodSubstitutions.push({sourceMesh:mesh,sourceMeshName:input.meshes[mesh].name,sourceInstances:nodeIndices.length,prototypeMesh:97,prototypeMeshName:input.meshes[97].name,localBoundsDeltaMetres:localBoundsDelta,maxWorldBoundsCoordinateDeltaMetres:maxWorldBoundsCoordinateDelta,originalWorldMatricesPreserved:true,reason:'Whole authored same-family PP source LOD replaces Field04 exported leaf alpha/cutoff mismatch. All PP UV/material bindings stay together; no guessed UV reassignment or alpha pixel edit.'});
  replacementNodes.push(...nodeIndices);selectedByMesh.delete(mesh);
 }
 selectedByMesh.set(97,replacementNodes);
 if(canopySourceLodSubstitutions.reduce((n,x)=>n+x.sourceInstances,0)!==322)throw new Error('Canopy source LOD repair must cover the audited322 Field04 actors.');
}
const imageMap=new Map(),imageHashMap=new Map(),textureMap=new Map(),materialMap=new Map(),materialHashMap=new Map();
async function image(oldIndex,role){
 const key=`${oldIndex}:${role}`,img=input.images[oldIndex];if(imageMap.has(key))return imageMap.get(key);if(img.uri||img.bufferView===undefined)throw new Error('Expected embedded source image.');
 const raw=await rawView(img.bufferView),foliage=/BlackAlder|Grass|flower|vmcob/i.test(img.name??'');const imageLimit=desktopDetail?(role==='baseColorTexture'?1024:role==='normalTexture'||!detailCompact?512:256):questPreview?(role==='baseColorTexture'?256:128):foliage?256:role==='baseColorTexture'?512:256;const hash=createHash('sha256').update(raw).digest('hex')+':'+imageLimit+':'+(detailCompact&&role==='baseColorTexture'?'webp95':'png');
 if(imageHashMap.has(hash)){imageMap.set(key,imageHashMap.get(hash));rawViews.delete(img.bufferView);return imageHashMap.get(hash);}
 const resizedImage=sharp(raw,{limitInputPixels:100000000}).resize({width:imageLimit,height:imageLimit,fit:'inside',withoutEnlargement:true});const webp=detailCompact&&role==='baseColorTexture';const resized=await (webp?resizedImage.webp({quality:95,alphaQuality:100,effort:5}):resizedImage.png({compressionLevel:8})).toBuffer({resolveWithObject:true});
 const idx=out.images.length;out.images.push({name:`Elderbloom_surface_${idx}`,mimeType:webp?'image/webp':'image/png',bufferView:append(resized.data)});decodedTextureBytes+=resized.info.width*resized.info.height*4;imageHashMap.set(hash,idx);imageMap.set(key,idx);rawViews.delete(img.bufferView);return idx;
}
async function texture(oldIndex,role){const key=`${oldIndex}:${role}`;if(textureMap.has(key))return textureMap.get(key);const old=input.textures[oldIndex],source=await image(old.source,role);let idx=out.textures.findIndex(t=>(t.extensions?.EXT_texture_webp?.source??t.source)===source&&t.sampler===old.sampler);if(idx<0){idx=out.textures.length;out.textures.push({...(out.images[source].mimeType==='image/webp'?{extensions:{EXT_texture_webp:{source}}}:{source}),...(old.sampler!==undefined?{sampler:old.sampler}:{})});}textureMap.set(key,idx);return idx;}
function textureBindings(value,result=[]){if(!value||typeof value!=='object')return result;for(const[k,v]of Object.entries(value)){if(k.endsWith('Texture')&&v&&typeof v==='object'&&Number.isSafeInteger(v.index))result.push({index:v.index,texCoord:v.extensions?.KHR_texture_transform?.texCoord??v.texCoord??0});else if(v&&typeof v==='object')textureBindings(v,result);}return result;}
async function remapTextureInfo(value){if(!value||typeof value!=='object')return;for(const[k,v]of Object.entries(value)){if(k.endsWith('Texture')&&v&&typeof v==='object'&&typeof v.index==='number')v.index=await texture(v.index,k);else if(v&&typeof v==='object')await remapTextureInfo(v);}}
async function material(oldIndex){if(materialMap.has(oldIndex))return materialMap.get(oldIndex);const mat=structuredClone(input.materials[oldIndex]??{});delete mat.name;await remapTextureInfo(mat);if(oldIndex===0){mat.name='Elderbloom_Ground_MaterialReview';mat.pbrMetallicRoughness={baseColorFactor:[.32,.29,.21,1],metallicFactor:0,roughnessFactor:1};}const key=JSON.stringify(mat);let idx=materialHashMap.get(key);if(idx===undefined){idx=out.materials.length;out.materials.push({...mat,name:mat.name??`Elderbloom_material_${idx}`});materialHashMap.set(key,idx);}materialMap.set(oldIndex,idx);return idx;}
await MeshoptSimplifier.ready;
const meshMap=new Map(),meshHashMap=new Map(),sourcePrototypeMap=new Map(),simplifications=[];
let removedDegenerateTriangles=0,removedDuplicateTerrainTriangles=0,terrainQualityGuard=null;
for(const [oldMeshIndex,nodeIndices] of selectedByMesh){
 const originalMesh=input.meshes[oldMeshIndex],kind=category(originalMesh),prepared=[];
 const prototypeKey=desktopDetail?JSON.stringify(originalMesh.primitives.map(p=>({attributes:p.attributes,indices:p.indices,mode:p.mode??4,material:p.material}))):null;
 if(prototypeKey&&sourcePrototypeMap.has(prototypeKey)){meshMap.set(oldMeshIndex,sourcePrototypeMap.get(prototypeKey));continue;}
 for(const primitive of originalMesh.primitives){
  if((primitive.mode??4)!==4)throw new Error('Only triangle source primitives are supported.');
  const attrs={};for(const[name,index]of Object.entries(primitive.attributes)){if(!/^(POSITION|NORMAL|TANGENT|TEXCOORD_\d+|COLOR_\d+)$/.test(name))throw new Error(`Unsupported authored attribute ${name}; refusing to discard it.`);attrs[name]={array:await readAccessor(index),type:input.accessors[index].type};}
  const positions=attrs.POSITION.array;let indices=primitive.indices!==undefined?Uint32Array.from(await readAccessor(primitive.indices)):Uint32Array.from({length:positions.length/3},(_,i)=>i);
  if(kind==='terrain'&&!fullTerrain){
   const m=matrices[nodeIndices[0]],keep=[];const p=new Vector3();
   for(let i=0;i<indices.length;i+=3){let x=0,z=0;for(let j=0;j<3;j++){p.fromArray(positions,indices[i+j]*3).applyMatrix4(m);x+=p.x/3;z+=p.z/3;}if(x>=bounds.minX&&x<=bounds.maxX&&z>=bounds.minZ&&z<=bounds.maxZ)keep.push(indices[i],indices[i+1],indices[i+2]);}
   indices=Uint32Array.from(keep);if(!indices.length)continue;
  }
  const scanRelief=neighborhood&&/Mossy_Stone_Wall|^duvar$/.test(originalMesh.name),smallTimber=neighborhood&&/Wooden_Beam|Bollard/.test(originalMesh.name);
  const questArchitectureTarget=/Mossy_Stone_Wall/.test(originalMesh.name)?90:/^duvar$/.test(originalMesh.name)?150:/Wooden_Beam/.test(originalMesh.name)?32:/Bollard/.test(originalMesh.name)?24:/Fence/.test(originalMesh.name)?50:/Medieval_Modular/.test(originalMesh.name)?120:/Gravestone/.test(originalMesh.name)?40:/Barrel|Bench|Pot|Hay|Carafe|Wheel|Wood_Pile/.test(originalMesh.name)?40:180;
  const canopyTree=canopyV5&&kind==='tree',canopyFullLeaf=canopyTree&&primitive.material===249;
  if(canopyTree&&primitive.material===31)throw new Error('Broken Field04 leaf binding remains after same-family source LOD repair.');
  const detailTarget=canopyFullLeaf?indices.length/3:canopyTree?4000:kind==='terrain'?7938:kind==='tree'?(detailCompact?1800:4000):kind==='groundcover'?(/Grass/.test(originalMesh.name)?(detailCompact?96:188):/vmcobd0ja/.test(originalMesh.name)?(detailCompact?384:768):/flower_02/.test(originalMesh.name)?(detailCompact?512:900):400):scanRelief?5000:smallTimber?1200:/Well|Roof|^çatı$/.test(originalMesh.name)?8000:2500;
  const before=indices.length/3,target=desktopDetail?detailTarget:questPreview?(kind==='terrain'?5000:kind==='tree'?200:kind==='groundcover'?188:questArchitectureTarget):kind==='terrain'?1600:kind==='tree'?1200:kind==='groundcover'?188:scanRelief?700:smallTimber?200:550;
  let error=0;
  const originalTerrainIndices=questPreview&&kind==='terrain'?indices.slice():null;
  if(before>target){
   const usedUVs=[...new Set(textureBindings(input.materials[primitive.material]??{}).map(b=>b.texCoord))].map(channel=>attrs[`TEXCOORD_${channel}`]);if(usedUVs.some(a=>!a))throw new Error(`Source mesh ${oldMeshIndex} binds an absent UV set.`);
   const normal=attrs.NORMAL?.array,normalWeight=canopyTree?.06:desktopDetail?(detailCompact?(kind==='groundcover'?.008:.03):.06):questPreview&&kind==='terrain'&&terrainPositionOnly?0:questPreview?.001:.01,attributeWidth=usedUVs.length*2+(normal?3:0),attributeValues=new Float32Array(positions.length/3*attributeWidth),weights=[...usedUVs.flatMap(()=>[canopyTree?.12:desktopDetail?(detailCompact?(kind==='groundcover'?.01:.06):.12):questPreview?.005:.06,canopyTree?.12:desktopDetail?(detailCompact?(kind==='groundcover'?.01:.06):.12):questPreview?.005:.06]),...(normal?[normalWeight,normalWeight,normalWeight]:[])];
   for(let v=0;v<positions.length/3;v++){let a=v*attributeWidth;for(const uv of usedUVs){attributeValues[a++]=uv.array[v*2];attributeValues[a++]=uv.array[v*2+1];}if(normal)for(let j=0;j<3;j++)attributeValues[a++]=normal[v*3+j];}
   const flags=kind==='terrain'?(questPreview?['LockBorder','ErrorAbsolute']:['LockBorder']):questPreview&&kind==='tree'?['Permissive','Prune']:['Permissive'];
   [indices,error]=MeshoptSimplifier.simplifyWithAttributes(indices,positions,3,attributeValues,attributeWidth,weights,questPreview&&kind==='terrain'?terrainContactLocks:null,target*3,canopyTree?.008:desktopDetail?(kind==='tree'?(detailCompact?.02:.008):kind==='groundcover'?(detailCompact?.06:.012):.001):questPreview?(kind==='terrain'?terrainMaxError:kind==='tree'?.04:scanRelief?.035:smallTimber?.025:/Fence|Gravestone|Barrel|Bench|Pot|Hay|Carafe|Wheel|Wood_Pile/.test(originalMesh.name)?.03:.015):kind==='terrain'?.002:kind==='tree'?.008:scanRelief?.015:smallTimber?.01:.003,flags);
  }
  // Keep only finite, nonzero-area triangles after LOD. This does not erase
  // merely small features; source-local area must be exactly zero to be removed.
  const validIndices=[],terrainFacePairs=new Map();let removedHere=0;
  if(questPreview&&kind==='terrain')for(let i=0;i<indices.length;i+=3){const a=indices[i],b=indices[i+1],c=indices[i+2],key=[a,b,c].sort((x,y)=>x-y).join(':'),pair=terrainFacePairs.get(key)??{count:0,winding:0};pair.count++;pair.winding+=(a<b?1:-1)*(b<c?1:-1)*(c<a?1:-1);terrainFacePairs.set(key,pair);}
  for(const pair of terrainFacePairs.values())if(pair.count>1&&(pair.count!==2||pair.winding!==0))throw new Error('Unexpected terrain duplicate face; refusing broad cleanup.');
  for(let i=0;i<indices.length;i+=3){const a=indices[i],b=indices[i+1],c=indices[i+2];const ax=positions[b*3]-positions[a*3],ay=positions[b*3+1]-positions[a*3+1],az=positions[b*3+2]-positions[a*3+2],bx=positions[c*3]-positions[a*3],by=positions[c*3+1]-positions[a*3+1],bz=positions[c*3+2]-positions[a*3+2];const cx=ay*bz-az*by,cy=az*bx-ax*bz,cz=ax*by-ay*bx;const areaSquared=cx*cx+cy*cy+cz*cz;if(a===b||b===c||a===c||areaSquared===0){removedHere++;continue;}if(!Number.isFinite(areaSquared))throw new Error('Nonfinite geometry after LOD.');if(questPreview&&kind==='terrain'){const key=[a,b,c].sort((x,y)=>x-y).join(':');if(terrainFacePairs.get(key)?.count===2){removedDuplicateTerrainTriangles++;continue;}}validIndices.push(a,b,c);}
  indices=Uint32Array.from(validIndices);removedDegenerateTriangles+=removedHere;if(!indices.length)continue;
  if(questPreview&&kind==='terrain'){
   const retained=new Set(indices);let locked=0,retainedLocked=0;for(let v=0;v<terrainContactLocks.length;v++)if(terrainContactLocks[v]){locked++;if(retained.has(v))retainedLocked++;}
   if(retainedLocked!==locked)throw new Error('Terrain LOD discarded a protected structural contact vertex.');
   const edges=new Map();for(let i=0;i<indices.length;i+=3)for(let j=0;j<3;j++){let a=indices[i+j],b=indices[i+(j+1)%3];if(a>b)[a,b]=[b,a];const key=`${a}:${b}`;edges.set(key,(edges.get(key)??0)+1);}
   let boundaryEdges=0,internalBoundaryEdges=0,nonmanifoldEdges=0;const internalEdges=[];for(const[key,count]of edges){if(count>2)nonmanifoldEdges++;if(count!==1)continue;boundaryEdges++;const[a,b]=key.split(':').map(Number),x=(positions[a*3]+positions[b*3])/2,z=(positions[a*3+2]+positions[b*3+2])/2;if(x>terrainGuardBounds.minX+1&&x<terrainGuardBounds.maxX-1&&z>terrainGuardBounds.minZ+1&&z<terrainGuardBounds.maxZ-1){internalBoundaryEdges++;internalEdges.push([a,b]);}}
   let smallHoleDiagnostic=null;
   if(internalEdges.length===3){
    const vertices=[...new Set(internalEdges.flat())];
    if(vertices.length===3&&vertices.every(v=>internalEdges.flat().filter(id=>id===v).length===2)){
     const points=vertices.map(v=>new Vector3().fromArray(positions,v*3)),centroid=points[0].clone().add(points[1]).add(points[2]).multiplyScalar(1/3),normal=new Vector3().subVectors(points[1],points[0]).cross(new Vector3().subVectors(points[2],points[0])),area=normal.length()/2,maxEdge=Math.max(points[0].distanceTo(points[1]),points[1].distanceTo(points[2]),points[2].distanceTo(points[0]));
     let sourceHeight=null,sourceTriangleOffset=null;
     for(let t=0;t<originalTerrainIndices.length;t+=3){const a=originalTerrainIndices[t]*3,b=originalTerrainIndices[t+1]*3,c=originalTerrainIndices[t+2]*3,ax=positions[a],az=positions[a+2],bx=positions[b],bz=positions[b+2],cx=positions[c],cz=positions[c+2];if(centroid.x<Math.min(ax,bx,cx)-1e-6||centroid.x>Math.max(ax,bx,cx)+1e-6||centroid.z<Math.min(az,bz,cz)-1e-6||centroid.z>Math.max(az,bz,cz)+1e-6)continue;const den=(bz-cz)*(ax-cx)+(cx-bx)*(az-cz);if(Math.abs(den)<1e-14)continue;const wa=((bz-cz)*(centroid.x-cx)+(cx-bx)*(centroid.z-cz))/den,wb=((cz-az)*(centroid.x-cx)+(ax-cx)*(centroid.z-cz))/den,wc=1-wa-wb;if(Math.min(wa,wb,wc)>=-1e-6){sourceHeight=wa*positions[a+1]+wb*positions[b+1]+wc*positions[c+1];sourceTriangleOffset=t;break;}}
     const centroidHeightError=sourceHeight===null?null:Math.abs(centroid.y-sourceHeight),repairAllowed=sourceHeight!==null&&maxEdge<=1&&area<=.5&&centroidHeightError<=.15&&normal.y!==0;
     smallHoleDiagnostic={vertices:points.map(p=>p.toArray()),centroid:centroid.toArray(),areaSquareMetres:area,maxEdgeMetres:maxEdge,sourceCoversCentroid:sourceHeight!==null,sourceHeight,sourceTriangleOffset,centroidHeightErrorMetres:centroidHeightError,repairAllowed,addedFace:false};
     if(repairSmallTerrainHole&&repairAllowed){const face=normal.y>0?vertices:[vertices[0],vertices[2],vertices[1]];for(let j=0;j<3;j++){let a=face[j],b=face[(j+1)%3];if(a>b)[a,b]=[b,a];const key=`${a}:${b}`;if(edges.get(key)!==1)throw new Error('Small-hole edge no longer has a single incident face.');edges.set(key,2);}indices=Uint32Array.from([...indices,...face]);boundaryEdges-=3;internalBoundaryEdges=0;smallHoleDiagnostic.addedFace=true;smallHoleDiagnostic.addedFaceWinding='upward';}
     else if(repairSmallTerrainHole&&sourceHeight!==null&&centroidHeightError<=.00001&&area<=1e-9&&maxEdge<=2){
      const pairs=[[0,1,2],[1,2,0],[2,0,1]].sort((a,b)=>points[b[0]].distanceToSquared(points[b[1]])-points[a[0]].distanceToSquared(points[a[1]])),[ai,bi,ci]=pairs[0],midpoint=points[ai].clone().add(points[bi]).multiplyScalar(.5),midpointError=midpoint.distanceTo(points[ci]);smallHoleDiagnostic.collinearMidpointErrorMetres=midpointError;
      if(midpointError<=.00001){const a=vertices[ai],b=vertices[bi],c=vertices[ci];let replacement=null,offset=null;for(let t=0;t<indices.length&&!replacement;t+=3){const tri=[indices[t],indices[t+1],indices[t+2]];for(let j=0;j<3;j++){const from=tri[j],to=tri[(j+1)%3],other=tri[(j+2)%3];if((from===a&&to===b)||(from===b&&to===a)){replacement=[from,c,other,c,to,other];offset=t;break;}}}
       if(replacement){for(let f=0;f<6;f+=3){const p=new Vector3().fromArray(positions,replacement[f]*3),q=new Vector3().fromArray(positions,replacement[f+1]*3),r=new Vector3().fromArray(positions,replacement[f+2]*3);if(q.sub(p).cross(r.sub(p)).y<=0)throw new Error('Collinear terrain stitch would create a non-upward face.');}indices=Uint32Array.from([...indices.subarray(0,offset),...replacement,...indices.subarray(offset+3)]);edges.clear();for(let t=0;t<indices.length;t+=3)for(let j=0;j<3;j++){let a=indices[t+j],b=indices[t+(j+1)%3];if(a>b)[a,b]=[b,a];const key=`${a}:${b}`;edges.set(key,(edges.get(key)??0)+1);}boundaryEdges=0;internalBoundaryEdges=0;nonmanifoldEdges=0;for(const[key,count]of edges){if(count>2)nonmanifoldEdges++;if(count!==1)continue;boundaryEdges++;const[a,b]=key.split(':').map(Number),x=(positions[a*3]+positions[b*3])/2,z=(positions[a*3+2]+positions[b*3+2])/2;if(x>terrainGuardBounds.minX+1&&x<terrainGuardBounds.maxX-1&&z>terrainGuardBounds.minZ+1&&z<terrainGuardBounds.maxZ-1)internalBoundaryEdges++;}smallHoleDiagnostic.stitchedCollinearEdge=true;smallHoleDiagnostic.replacedTriangleWithTwo=true;smallHoleDiagnostic.existingVertexPositionsUnchanged=true;}
      }
     }
    }
   }
   terrainQualityGuard={lockedContactVertices:locked,retainedContactVertices:retainedLocked,missingContactVertices:locked-retainedLocked,smallHoleDiagnostic,boundaryEdges,internalBoundaryEdges,nonmanifoldEdges,removedDuplicateFaces:removedDuplicateTerrainTriangles,normalAttributeWeight:terrainPositionOnly?0:.001,contactVertexMergeToleranceMetres:.0002,outsideContactErrorCapMetres:terrainMaxError};
   if(terrainCostOnly){const topologyPass=!internalBoundaryEdges&&!nonmanifoldEdges,report={terrainCostOnly:true,topologyPass,fullTerrain,sourcePath,sourceTriangles:before,finalTerrainTriangles:indices.length/3,absoluteErrorMetres:error,terrainWeldReport,terrainQualityGuard,terrainBounds:terrainGuardBounds};await mkdir(dirname(outputPath),{recursive:true});await writeFile(outputPath+'.terrain-cost.json',JSON.stringify(report,null,2),{flag:'wx'});await source.close();console.log(JSON.stringify(report,null,2));process.exit(topologyPass?0:2);}
   if(internalBoundaryEdges||nonmanifoldEdges)throw new Error('Terrain LOD failed its shared-seam topology guard: '+JSON.stringify(terrainQualityGuard));
  }
  simplifications.push({mesh:oldMeshIndex,kind,before,after:indices.length/3,relativeError:questPreview&&kind==='terrain'?null:error,absoluteErrorMetres:questPreview&&kind==='terrain'?error:null,removedDegenerateTriangles:removedHere});
  const remap=new Map(),compactIndices=new Uint32Array(indices.length);let vertexCount=0;
  for(let i=0;i<indices.length;i++){const sourceIndex=indices[i];if(!remap.has(sourceIndex))remap.set(sourceIndex,vertexCount++);compactIndices[i]=remap.get(sourceIndex);}
  const compactAttrs={};for(const[name,{array,type}]of Object.entries(attrs)){const width={VEC2:2,VEC3:3,VEC4:4}[type],compact=new Float32Array(vertexCount*width);for(const[oldIndex,newIndex]of remap)for(let j=0;j<width;j++)compact[newIndex*width+j]=array[oldIndex*width+j];compactAttrs[name]={array:compact,type};}
  prepared.push({attrs:compactAttrs,indices:compactIndices,material:kind==='tree'&&!desktopDetail?primitive.material:await material(primitive.material),before});
 }
 if(!prepared.length)continue;
 const hasher=createHash('sha256');for(const p of prepared){if(kind!=='tree'||desktopDetail)hasher.update(String(p.material));for(const[name,a]of Object.entries(p.attrs)){hasher.update(name);hasher.update(Buffer.from(a.array.buffer));}hasher.update(Buffer.from(p.indices.buffer));}const hash=hasher.digest('hex');
 let newMeshIndex=meshHashMap.get(hash);
 if(newMeshIndex===undefined){
  newMeshIndex=out.meshes.length;const primitives=[];
  for(const p of prepared){const attributes={};for(const[name,a]of Object.entries(p.attrs)){let min,max;if(name==='POSITION'){min=[Infinity,Infinity,Infinity];max=[-Infinity,-Infinity,-Infinity];for(let i=0;i<a.array.length;i++){const j=i%3;min[j]=Math.min(min[j],a.array[i]);max[j]=Math.max(max[j],a.array[i]);}}attributes[name]=accessor(a.array,a.type,34962,min,max);}primitives.push({attributes,indices:accessor(p.indices,'SCALAR',34963),material:kind==='tree'&&!desktopDetail?await material(p.material):p.material});}
  out.meshes.push({name:originalMesh.name,primitives});meshHashMap.set(hash,newMeshIndex);
 }
 meshMap.set(oldMeshIndex,newMeshIndex);if(prototypeKey)sourcePrototypeMap.set(prototypeKey,newMeshIndex);
 if(oldMeshIndex%25===0)console.log(`Prepared source mesh ${oldMeshIndex}: ${out.meshes.length} unique output meshes, ${out.images.length} images.`);
}
// Combine repeated prototypes into true instanced draws. No original actor transform
// is applied to another actor, and layout is not regenerated.
const instanceGroups=new Map();for(const [oldMeshIndex,nodeIndices]of selectedByMesh){if(!meshMap.has(oldMeshIndex))continue;const mesh=meshMap.get(oldMeshIndex),kind=category(input.meshes[oldMeshIndex]);for(const nodeIndex of nodeIndices){const p=centre(nodeIndex),cellSize=desktopDetail?(kind==='groundcover'?8:kind==='tree'?16:kind==='architecture'?24:0):0,cellX=cellSize?Math.floor(p.x/cellSize):0,cellZ=cellSize?Math.floor(p.z/cellSize):0,key=`${mesh}:${cellX}:${cellZ}`,group=instanceGroups.get(key)??{mesh,nodeIndices:[],cellSize,cellX,cellZ};group.nodeIndices.push(nodeIndex);instanceGroups.set(key,group);}}
let renderedTriangles=0,batches=0,selectedInstances=0;const renderedTrianglesByCategory={terrain:0,tree:0,groundcover:0,architecture:0};const selectedCounts={terrain:0,tree:0,groundcover:0,architecture:0};
for(const{mesh,nodeIndices,cellSize,cellX,cellZ}of instanceGroups.values()){const meshInfo=out.meshes[mesh],kind=category(meshInfo);selectedCounts[kind]+=nodeIndices.length;selectedInstances+=nodeIndices.length;batches+=meshInfo.primitives.length;const groupTriangles=meshInfo.primitives.reduce((n,p)=>n+out.accessors[p.indices].count/3,0)*nodeIndices.length;renderedTriangles+=groupTriangles;renderedTrianglesByCategory[kind]+=groupTriangles;
 const node={name:meshInfo.name+(cellSize?`_cell_${cellX}_${cellZ}`:''),mesh,...(desktopDetail?{extras:{crownfallElderbloom:{kind,cellX,cellZ,cellSize,sourceInstances:nodeIndices.length,referenceDetail:true}}}:{})};
 if(nodeIndices.length===1)node.matrix=matrices[nodeIndices[0]].toArray();
 else {const translations=new Float32Array(nodeIndices.length*3),rotations=new Float32Array(nodeIndices.length*4),scales=new Float32Array(nodeIndices.length*3);for(let i=0;i<nodeIndices.length;i++){const p=new Vector3(),q=new Quaternion(),s=new Vector3();matrices[nodeIndices[i]].decompose(p,q,s);p.toArray(translations,i*3);q.toArray(rotations,i*4);s.toArray(scales,i*3);}node.extensions={EXT_mesh_gpu_instancing:{attributes:{TRANSLATION:accessor(translations,'VEC3',34962),ROTATION:accessor(rotations,'VEC4',34962),SCALE:accessor(scales,'VEC3',34962)}}};}
 out.scenes[0].nodes.push(out.nodes.length);out.nodes.push(node);
}
const declaredExtensions=new Set();function collectExtensions(value){if(!value||typeof value!=='object')return;for(const[k,v]of Object.entries(value)){if(k==='extensions'&&v&&typeof v==='object')for(const name of Object.keys(v))declaredExtensions.add(name);if(v&&typeof v==='object')collectExtensions(v);}}
for(const value of [out.materials,out.nodes,out.meshes,out.textures,out.images])collectExtensions(value);out.extensionsUsed=[...declaredExtensions].sort();out.extensionsRequired=out.extensionsUsed.filter(name=>['EXT_mesh_gpu_instancing','EXT_texture_webp'].includes(name));
let auditedTextureBindings=0;for(const mesh of out.meshes)for(const primitive of mesh.primitives)for(const binding of textureBindings(out.materials[primitive.material])){auditedTextureBindings++;if(!out.textures[binding.index])throw new Error('Output material references a missing texture.');if(primitive.attributes[`TEXCOORD_${binding.texCoord}`]===undefined)throw new Error(`Output ${mesh.name} references missing TEXCOORD_${binding.texCoord}.`);}

const finalPad=(4-byteOffset%4)%4;if(finalPad){chunks.push(Buffer.alloc(finalPad));byteOffset+=finalPad;}out.buffers[0].byteLength=byteOffset;
const json=Buffer.from(JSON.stringify(out)),jsonPadding=(4-json.length%4)%4,jsonChunk=Buffer.concat([json,Buffer.alloc(jsonPadding,0x20)]);const outputHeader=Buffer.alloc(20);outputHeader.writeUInt32LE(0x46546c67,0);outputHeader.writeUInt32LE(2,4);outputHeader.writeUInt32LE(28+jsonChunk.length+byteOffset,8);outputHeader.writeUInt32LE(jsonChunk.length,12);outputHeader.writeUInt32LE(0x4e4f534a,16);const binHeader=Buffer.alloc(8);binHeader.writeUInt32LE(byteOffset,0);binHeader.writeUInt32LE(0x004e4942,4);
await mkdir(dirname(outputPath),{recursive:true});const handle=await open(outputPath,'wx');await handle.write(outputHeader);await handle.write(jsonChunk);await handle.write(binHeader);for(const chunk of chunks)await handle.write(chunk);await handle.close();await source.close();
const report={profile,desktopDetail,detailCompact,canopyV5,canopySourceLodSubstitutions,sourceMeshMap:Object.fromEntries(meshMap),baseColourEncoding:detailCompact?'WebPquality95alpha100':'PNG',exactMaterialRepairs,normalizedTreeMaterialBindings,spatialInstanceCells:desktopDetail?{groundcover:8,tree:16,architecture:24}:null,fullTerrain,terrainPositionOnly,terrainMaxError,repairSmallTerrainHole,sourcePath,sourceBytes:(await stat(sourcePath)).size,outputPath,outputBytes:(await stat(outputPath)).size,bounds,sourceCounts,selectedCounts,selectedInstances,uniqueMeshes:out.meshes.length,estimatedDrawBatches:batches,renderedTriangles,renderedTrianglesByCategory,removedDegenerateTriangles,removedDuplicateTerrainTriangles,terrainWeldReport,terrainQualityGuard,geometryBytes,decodedTextureBytes,decodedTexturesWithMips:Math.ceil(decodedTextureBytes*4/3),uniqueImages:out.images.length,materials:out.materials.length,sourceMaterialMap:Object.fromEntries(materialMap),auditedTextureBindings,declaredExtensions:out.extensionsUsed,removedGroundcover:sourceCounts.groundcover-selectedCounts.groundcover,derivativeLimitations:['Local preview only; no publication or licence validation.',...(canopyV5?['CanopyV5 substitutes the authored Field04_PP source LOD for322originalField04 actors because the original leaf alpha/cutoff export is inconsistent. Source actor matrices are unchanged; original Field04 geometry is not claimed restored.','Other canonical source tree families audited: usable leaf alpha coverage, with largeField02/Forest01leaves retained unsimplified. Alpha-preserving mipmaps remain a separate renderer correction.']:[]),'Ground material is neutral provisional; LAAS surface bake follows separately.',fullTerrain?'All64 source landscape components are retained; geometry LOD requires visual review.':'Terrain is cropped by triangle centroid; geometry reduction requires visual review.',profile==='central-courtyard'?'Courtyard profile is a measured central courtyard subset, not the whole settlement.':desktopDetail?'Reference detail profile retains every measured source placement; runtime visibility must cull spatial cells. Failed magenta materials use exact-geometry templates; usable per-actor baked tree variants are normalized to one authored template per identical geometry/UV family.':'Full village profile retains all measured architecture instances; decorative vegetation is thinned.',questPreview?'This is an unaccepted Native LOD candidate; only metadata budgets are checked.':'Budgets are metadata estimates for desktop model review, not headset performance evidence.','Quest whole-frame250k triangle gate remains a separate unpassed gate.'],simplifications};
await writeFile(outputPath+'.report.json',JSON.stringify(report,null,2),{flag:'wx'});console.log(JSON.stringify({...report,sourceMaterialMap:`${materialMap.size} source-to-output numeric entries in adjacent report.`,simplifications:`${simplifications.length} detailed entries in adjacent report.`},null,2));
