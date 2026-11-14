/** Offline, CPU-only, source-byte-bound animation envelopes for real residents.
 * Original GLBs and prior measurements are read-only. Sampling does not prove
 * routes, interactions, continuous collision, crossfades or rendered quality. */
import fs from 'node:fs';
import crypto from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {resolve,relative,dirname,isAbsolute,sep} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {parseArgs} from 'node:util';
import {EALDHOLT_POPULATION_ASSET_SHA256 as hashes} from '../../shared/legacy/aethelgard/characters/population-asset-integrity.ts';
import {EALDHOLT_VILLAGE_POPULATION as population} from '../../shared/legacy/aethelgard/characters/village-population.ts';
import {getPopulationArt,type PopulationArtEntry} from '../../shared/legacy/aethelgard/characters/village-population-art.ts';
import {getHouseholdArtSet,type HouseholdArtSet} from '../../shared/legacy/aethelgard/characters/household-art-sets.ts';
import {isWalkLikeClip} from '../../shared/legacy/aethelgard/characters/crowd-binding.ts';
import {prepareCrowdLibrary,bindCrowdTemplate} from '../../main game/src/legacy/aethelgard/characters/crowd-residents.ts';
import {parsePopulationMotionEvidence} from '../../shared/legacy/aethelgard/characters/population-motion-clearance.ts';

const repositoryRoot=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const inside=(base:string,path:string)=>{const suffix=relative(base,path);return suffix!=='..'&&!suffix.startsWith('..'+sep)&&!isAbsolute(suffix);};
/** Resolve ancestor symlinks before enforcing the private-output boundary. */
function realLocation(path:string):string{let ancestor=resolve(path);while(!fs.existsSync(ancestor)){const next=dirname(ancestor);if(next===ancestor)break;ancestor=next;}return resolve(fs.realpathSync(ancestor),relative(ancestor,resolve(path)));}
export function privateCommuteOutput(path:string,assetsRoot:string):string{
 const out=realLocation(path),assets=fs.realpathSync(resolve(assetsRoot));
 if(inside(fs.realpathSync(repositoryRoot),out)||inside(assets,out))throw Error('Motion output must stay outside the checkout and read-only source asset tree.');return out;
}
export function readPinnedCharacterAsset(assetsRoot:string,file:string,maxBytes=128*1024*1024):Buffer{
 if(!Object.prototype.hasOwnProperty.call(hashes,file))throw Error('Unregistered character asset path: '+file);
 const root=fs.realpathSync(resolve(assetsRoot)),path=fs.realpathSync(resolve(root,file));
 if(!inside(root,path))throw Error('Character asset symlink leaves its declared root.');
 const size=fs.statSync(path).size;if(size>maxBytes)throw Error('Character asset exceeds its byte budget: '+file);
 const bytes=fs.readFileSync(path);if(crypto.createHash('sha256').update(bytes).digest('hex')!==hashes[file])throw Error('Raw pinned asset changed: '+file);return bytes;
}
export type CommuteMotionClipScope='commute'|'routine';
/** Sample only exact published names. A routine bake adds declared work and
 * common social/seated clips; it does not grant their separate site/contact gates. */
export function selectCommuteMotionClips(art:PopulationArtEntry,set:HouseholdArtSet|null,available:readonly string[],scope:CommuteMotionClipScope):string[]{
 const present=new Set(available),names=new Set<string>([art.motions.idle,art.motions.walk]);
 if(set){for(const name of [set.actorMotions.extra.start,set.actorMotions.extra.stop])if(name)names.add(name);}
 else{for(const name of art.motions.roleClips)if(isWalkLikeClip(name))names.add(name);for(const name of [`${art.motions.walk}_start`,`${art.motions.walk}_stop`])if(present.has(name))names.add(name);}
 if(scope==='routine'){
  names.add(art.motions.talk);for(const name of art.motions.roleClips)names.add(name);
  for(const name of ['idle','idle_b','talk','talk_b','look_around','sit_down','sit','stand_up'])if(present.has(name))names.add(name);
  if(set)for(const name of Object.values(set.actorMotions.extra))if(name)names.add(name);
  for(const name of [...names])for(const suffix of ['_enter','_exit','_start','_stop'])if(present.has(name+suffix))names.add(name+suffix);
 }
 return [...names];
}
const HELP=`Bake existing resident clips and held props at 60 Hz, with actual Three skinning cross-checks.
Required: --assets-root CHARACTERS_DIRECTORY --output-dir PRIVATE_DIRECTORY
Choose one evidence origin:
          --fresh (new measurements; no prior evidence or approval is invented)
          --source-evidence PREVIOUS.json --source-evidence-sha256 EXPECTED_SHA256
Optional: --only id,id --levels crowd,desktop-lod0,desktop-lod1,quest
          --clip-scope commute|routine (default: routine for fresh; commute for prior merge)
          --max-ms 600000 --max-heap-mib 1536 --max-cache-mib 128 --max-asset-mib 128
          --overwrite --help
Use spaces between each option and its value. Nothing is downloaded. Original assets are never written.`;
export async function bakeVillageCommuteMotion(argv:readonly string[]=process.argv.slice(2)):Promise<any>{
 const {values}=parseArgs({args:[...argv],options:{'assets-root':{type:'string'},fresh:{type:'boolean',default:false},'source-evidence':{type:'string'},'source-evidence-sha256':{type:'string'},'output-dir':{type:'string'},'clip-scope':{type:'string'},only:{type:'string'},levels:{type:'string'},'max-ms':{type:'string'},'max-heap-mib':{type:'string'},'max-cache-mib':{type:'string'},'max-asset-mib':{type:'string'},overwrite:{type:'boolean',default:false},help:{type:'boolean',default:false}}});
 if(values.help){console.log(HELP);return null;}
 if(!values['assets-root']||!values['output-dir'])throw Error(HELP);
 const fresh=values.fresh,hasPrior=values['source-evidence']!==undefined||values['source-evidence-sha256']!==undefined;
 if(fresh&&hasPrior)throw Error('Fresh motion sampling cannot include prior evidence inputs. Choose one evidence origin.');
 if(!fresh&&(!values['source-evidence']||!values['source-evidence-sha256']))throw Error('Choose --fresh or supply both prior evidence inputs.\n'+HELP);
 const scope=values['clip-scope']??(fresh?'routine':'commute');if(scope!=='commute'&&scope!=='routine')throw Error('Unknown motion clip scope.');
 const root=fs.realpathSync(resolve(values['assets-root'])),dir=privateCommuteOutput(values['output-dir'],root),sourceEvidence=fresh?null:resolve(values['source-evidence']!);
 const bounded=(value:string|undefined,fallback:number,min:number,max:number)=>{const n=value===undefined?fallback:Number(value);if(!Number.isSafeInteger(n)||n<min||n>max)throw Error('Invalid bounded motion-bake budget.');return n;};
 const maximumMs=bounded(values['max-ms'],600000,100,1800000),maxHeapBytes=bounded(values['max-heap-mib'],1536,32,4096)*1048576,maxCacheBytes=bounded(values['max-cache-mib'],128,1,1024)*1048576,maxAssetBytes=bounded(values['max-asset-mib'],128,1,512)*1048576;
 const only=values.only?new Set(values.only.split(',')):null,chosenLevels=values.levels?new Set(values.levels.split(',')):null;
 if(only&&[...only].some(id=>!population.residents.some(r=>r.id===id))||chosenLevels&&[...chosenLevels].some(level=>!['crowd','desktop-lod0','desktop-lod1','quest'].includes(level)))throw Error('Unknown resident or actual published LOD selection.');
 const selected=population.residents.filter(r=>!only||only.has(r.id)),expectedRows=selected.reduce((sum,r)=>sum+getPopulationArt(r.id)!.levels.filter(level=>!chosenLevels||chosenLevels.has(level.level)).length,0);
 if(!expectedRows)throw Error('Selection has no actual published resident levels.');
 let sourceSha:string|null=null,result:any={schemaVersion:1,method:'cpu-sampled-skin-and-props-v1',fps:60,paddingMetres:.05,residents:{}};
 if(sourceEvidence){
  if(fs.statSync(sourceEvidence).size>16*1024*1024)throw Error('Source evidence exceeds16MiB.');
  const sourceBytes=fs.readFileSync(sourceEvidence);sourceSha=crypto.createHash('sha256').update(sourceBytes).digest('hex');
  if(!/^[a-f0-9]{64}$/.test(values['source-evidence-sha256']!)||sourceSha!==values['source-evidence-sha256'])throw Error('Prior source evidence SHA-256 does not match.');
  result=JSON.parse(sourceBytes.toString('utf8'));
  if(['commute-motion-evidence.json','commute-motion-report.json'].some(file=>realLocation(resolve(dir,file))===fs.realpathSync(sourceEvidence)))throw Error('Output may not overwrite the read-only source evidence.');
 }
 parsePopulationMotionEvidence(result);
 if(!values.overwrite&&['commute-motion-evidence.json','commute-motion-report.json'].some(file=>fs.existsSync(resolve(dir,file))))throw Error('Motion output exists; choose a new private directory or explicitly pass --overwrite.');
 fs.mkdirSync(dir,{recursive:true,mode:0o700});
 const started=performance.now(),budget=()=>{if(performance.now()-started>maximumMs)throw Error('Motion sampling time budget exceeded.');if(process.memoryUsage().heapUsed>maxHeapBytes)throw Error('Motion sampling heap budget exceeded.');};
 const [{GLTFLoader},{AnimationMixer,LoopOnce,Matrix4,Mesh,Vector3,Box3}]=await Promise.all([import(new URL('../../main game/node_modules/three/examples/jsm/loaders/GLTFLoader.js',import.meta.url).href),import(new URL('../../main game/node_modules/three/build/three.module.js',import.meta.url).href)]);
 (globalThis as any).self=globalThis;
 const report:any={generator:{name:'bake-village-commute-motion',sha256:crypto.createHash('sha256').update(fs.readFileSync(fileURLToPath(import.meta.url))).digest('hex')},method:'cpu-sampled-skin-and-props-v1',fps:60,paddingMetres:.05,provenanceMode:fresh?'fresh-measured':'merge-prior',sourceEvidence,sourceEvidenceSha256:sourceSha,siteClearance:'not-measured-by-animation-envelope-bake',limits:{maximumMilliseconds:maximumMs,maximumHeapBytes:maxHeapBytes,maximumRawCacheBytes:maxCacheBytes,maximumAssetBytes:maxAssetBytes,singleWorker:true},selection:{residentIds:selected.map(r=>r.id),levels:chosenLevels?[...chosenLevels]:null,clipScope:scope,fullPopulation:expectedRows===population.residents.reduce((sum,r)=>sum+getPopulationArt(r.id)!.levels.length,0)},rows:[],errors:[],completed:false};
const strip=(p:string)=>p.replace(/^aethelgard\/characters\//,'');
const checkedFiles=new Map<string,Buffer>();let cachedBytes=0;const checkedIdentities=new Set<string>();
function checked(file:string){let bytes=checkedFiles.get(file);if(bytes){checkedFiles.delete(file);checkedFiles.set(file,bytes);return bytes;}budget();bytes=readPinnedCharacterAsset(root,file,maxAssetBytes);while(cachedBytes+bytes.length>maxCacheBytes&&checkedFiles.size){const key=checkedFiles.keys().next().value!;cachedBytes-=checkedFiles.get(key)!.length;checkedFiles.delete(key);}if(bytes.length<=maxCacheBytes){checkedFiles.set(file,bytes);cachedBytes+=bytes.length;}checkedIdentities.add(file);return bytes;}
// Same in-memory texture removal as the existing publisher; skin, morph and animation buffers remain intact.
function cpuBytes(bytes:Buffer){const n=bytes.readUInt32LE(12),g=JSON.parse(bytes.subarray(20,20+n).toString('utf8'));delete g.images;delete g.textures;delete g.samplers;
 for(const material of g.materials??[]){for(const key of Object.keys(material))if(key.endsWith('Texture'))delete material[key];if(material.pbrMetallicRoughness){delete material.pbrMetallicRoughness.baseColorTexture;delete material.pbrMetallicRoughness.metallicRoughnessTexture;}}
 let json=Buffer.from(JSON.stringify(g));json=Buffer.concat([json,Buffer.alloc((4-json.length%4)%4,0x20)]);const bin=bytes.subarray(20+n),out=Buffer.alloc(20+json.length+bin.length);out.writeUInt32LE(0x46546c67,0);out.writeUInt32LE(2,4);out.writeUInt32LE(out.length,8);out.writeUInt32LE(json.length,12);out.writeUInt32LE(0x4e4f534a,16);json.copy(out,20);bin.copy(out,20+json.length);return out.buffer.slice(out.byteOffset,out.byteOffset+out.length);}
const loader=new GLTFLoader(),shared=new Map<string,any>(),preparedLibraries=new Map<string,any>();
async function load(file:string,cache=false){if(cache&&shared.has(file))return shared.get(file);const data=await loader.parseAsync(cpuBytes(checked(file)),'');if(cache)shared.set(file,data);return data;}
function disposeModel(model:any){const geometries=new Set<any>(),materials=new Set<any>();model.traverse((o:any)=>{if(o.geometry)geometries.add(o.geometry);for(const m of Array.isArray(o.material)?o.material:o.material?[o.material]:[])materials.add(m);});for(const g of geometries)g.dispose();for(const m of materials)m.dispose();model.clear();}
const allKits=Object.keys(hashes).filter(p=>/^crowd-v1\/props\/[^/]+\.glb$/.test(p));
async function propsFor(art:any,set:any,meta:any,name:string,model:any,props:any){
 const attached:any[]=[];
 if(art.kind==='crowd'){
  const active=meta.presentation.clips[name]??{held:[],placed:[],hidesRest:[]};
  const bindings=[...active.held,...active.placed,...meta.presentation.rest.filter((x:any)=>!active.hidesRest.includes(x.prop)&&!active.held.some((p:any)=>p.prop===x.prop))];
  for(const b of bindings){const kit=await load(meta.presentation.kits[b.kit],true),original=kit.scene.getObjectByName(b.node);if(!original)throw Error('Missing exact crowd prop '+b.node);const p=original.clone(true);p.matrixAutoUpdate=false;p.matrix.fromArray(b.matrix);p.matrixWorldNeedsUpdate=true;const parent=b.bone?model.getObjectByName(b.bone):model;if(!parent)throw Error('Missing actual crowd prop bone '+b.bone);parent.add(p);attached.push({object:p,placed:!b.bone});}
 }else{
  const held=set.propsByClip[name]??[],visible=[...held];
  for(const [heldName,copies] of Object.entries(set.restingProps) as any){if(!held.some((p:any)=>p.node===heldName))for(const copy of copies)if(copy.bone)visible.push(copy);}
  for(const b of visible){if(!b.bone)continue; // Fixed workstation objects stay at independent source anchors, never on the walking body.
   const original=props.scene.getObjectByName(b.node),parent=model.getObjectByName(b.bone);if(!original||!parent)throw Error('Missing actual household prop/bone '+b.node);const p=original.clone(true);parent.add(p);attached.push({object:p,placed:false});}
 }
 return attached;
}
function sample(model:any,skins:any[],mixer:any,clip:any,props:any[]){
 const action=mixer.clipAction(clip);action.setLoop(LoopOnce,1);action.clampWhenFinished=true;action.reset().play();
 const matrices=new Map(skins.map((mesh:any)=>[mesh,mesh.skeleton.bones.map(()=>new Matrix4())]));
 const original=new Vector3(),weighted=new Vector3(),work=new Vector3(),v=new Vector3(),box=new Box3();
 // Joint centres are diagnostic trajectories, never sole/contact proof. The
 // full skinned surface and held/placed props still define the safety envelope.
 const trajectories=['root','foot_l','foot_r','toes_l','toes_r'].map(name=>({name,node:model.getObjectByName(name),bounds:new Box3(),first:null as number[]|null,last:null as number[]|null,distance:0}));
 if(fresh&&trajectories.slice(0,3).some(joint=>!joint.node))throw Error('Fresh motion sampling requires actual root and foot joints.');
 let radius=0,height=-Infinity,minBody=Infinity,placedBelowGround=false,vertices=0,crossChecks=0,largestReferenceError=0;
 const steps=Math.ceil(clip.duration*60);
 for(let step=0;step<=steps;step++){
  if(step%60===0)budget();
  mixer.setTime(Math.min(step/60,clip.duration));model.updateMatrixWorld(true);
  for(const joint of trajectories){if(!joint.node)continue;joint.node.getWorldPosition(work);joint.bounds.expandByPoint(work);if(joint.last)joint.distance+=v.fromArray(joint.last).distanceTo(work);else joint.first=work.toArray();joint.last=work.toArray();}
  for(const mesh of skins){const pos=mesh.geometry.attributes.position,indices=mesh.geometry.attributes.skinIndex,weights=mesh.geometry.attributes.skinWeight,bones:any=matrices.get(mesh);
   for(let b=0;b<bones.length;b++)bones[b].multiplyMatrices(mesh.skeleton.bones[b].matrixWorld,mesh.skeleton.boneInverses[b]);
   const morphed=mesh.morphTargetInfluences?.some((weight:number)=>weight!==0);
   for(let i=0;i<pos.count;i++){
    if(morphed)Mesh.prototype.getVertexPosition.call(mesh,i,original);else original.fromBufferAttribute(pos,i);original.applyMatrix4(mesh.bindMatrix);weighted.set(0,0,0);
    for(let c=0;c<4;c++){const weight=weights.getComponent(i,c);if(weight)weighted.addScaledVector(work.copy(original).applyMatrix4(bones[indices.getComponent(i,c)]),weight);}
    v.copy(weighted).applyMatrix4(mesh.bindMatrixInverse).applyMatrix4(mesh.matrixWorld);
    if((step===0||step===steps||step===Math.floor(steps/2))&&i%311===0){mesh.getVertexPosition(i,work).applyMatrix4(mesh.matrixWorld);const error=work.distanceTo(v);largestReferenceError=Math.max(largestReferenceError,error);crossChecks++;if(error>1e-8)throw Error('CPU sampler differs from actual Three skinning '+error);}
    radius=Math.max(radius,Math.hypot(v.x,v.z));height=Math.max(height,v.y);minBody=Math.min(minBody,v.y);vertices++;
   }
  }
  for(const prop of props){box.setFromObject(prop.object,true);if(prop.placed&&box.min.y<-.02)placedBelowGround=true;for(const x of [box.min.x,box.max.x])for(const z of [box.min.z,box.max.z])radius=Math.max(radius,Math.hypot(x,z));height=Math.max(height,box.max.y);}
 }
 action.stop();mixer.uncacheAction(clip);return{evidence:{radiusMetres:radius+.05,heightMetres:height+.05,minimumBodyYMetres:minBody,placedBelowGround},samples:steps+1,skinnedVertexSamples:vertices,crossChecks,largestReferenceError,
  jointTrajectories:{method:'sampled-joint-centres-not-contact-proof',joints:trajectories.filter(joint=>joint.node).map(joint=>({name:joint.name,first:joint.first,last:joint.last,minimum:joint.bounds.min.toArray(),maximum:joint.bounds.max.toArray(),travelMetres:joint.distance}))}};
}
function checkpoint(){report.elapsedMilliseconds=performance.now()-started;report.heapUsed=process.memoryUsage().heapUsed;const payload=JSON.stringify(result);parsePopulationMotionEvidence(JSON.parse(payload));const file=dir+'/commute-motion-evidence.json';fs.writeFileSync(file+'.tmp-'+process.pid,payload,{mode:0o600,flag:'wx'});fs.renameSync(file+'.tmp-'+process.pid,file);report.outputSha256=crypto.createHash('sha256').update(payload).digest('hex');const reportFile=dir+'/commute-motion-report.json';fs.writeFileSync(reportFile+'.tmp-'+process.pid,JSON.stringify(report,null,2),{mode:0o600,flag:'wx'});fs.renameSync(reportFile+'.tmp-'+process.pid,reportFile);}
for(const resident of population.residents){
 if(only&&!only.has(resident.id))continue;
 if(performance.now()-started>maximumMs||process.memoryUsage().heapUsed>maxHeapBytes){report.errors.push({residentId:resident.id,error:fresh?'Batch time or heap budget exceeded; remaining residents have no new evidence.':'Batch time or heap budget exceeded; remaining residents retain existing evidence.'});break;}
 const art=getPopulationArt(resident.id)!,set=getHouseholdArtSet(resident.id),residentStarted=performance.now();
 for(const level of art.levels){if(chosenLevels&&!chosenLevels.has(level.level))continue;let body:any=null,props:any=null;
  try{
   const bodyPath=strip(level.path),metaPath=strip(art.manifest),meta=JSON.parse(checked(metaPath).toString()),files:any={};
   body=await load(bodyPath);const model=body.scene;model.scale.setScalar(art.placementScale);model.updateMatrixWorld(true);
   const lib=art.kind==='crowd'?await load(strip(art.clipLibrary!.path),true):body,clips:any={};
   if(art.kind==='crowd'){const libPath=strip(art.clipLibrary!.path);let prepared=preparedLibraries.get(libPath);if(!prepared){prepared=prepareCrowdLibrary(lib);preparedLibraries.set(libPath,prepared);}bindCrowdTemplate(body,prepared);}
   const names=selectCommuteMotionClips(art,set,lib.animations.map((clip:any)=>clip.name),scope);
   const skins:any[]=[];model.traverse((o:any)=>{if(o.isSkinnedMesh)skins.push(o);});if(!skins.length)throw Error('Missing real skinned meshes.');
   const required=[bodyPath,metaPath];if(art.kind==='crowd')required.push(strip(art.clipLibrary!.path),'crowd-v1/clips/manifest.json','crowd-v1/props/kits.json',...allKits);else if(art.propsFiles){const propsPath=strip(level.level==='quest'?art.propsFiles.quest:art.propsFiles.desktop);required.push(propsPath);props=await load(propsPath,true);}
   for(const path of required){checked(path);files[path]=hashes[path];}
   const mixer=new AnimationMixer(model),clipMetrics:any[]=[];
   for(const name of names){const clip=lib.animations.find((c:any)=>c.name===name);if(!clip)throw Error('Missing exact published clip '+name);const attached=await propsFor(art,set,meta,name,model,props),clipStarted=performance.now();
    try{const measured=sample(model,skins,mixer,clip,attached);clips[name]=measured.evidence;clipMetrics.push({name,milliseconds:performance.now()-clipStarted,...measured});}finally{for(const prop of attached)prop.object.removeFromParent();}
   }
   mixer.stopAllAction();mixer.uncacheRoot(model);
   const target=result.residents[resident.id]??={levels:{}};const old=target.levels[level.level];target.levels[level.level]={files:{...old?.files,...files},clips:{...old?.clips,...clips}};
   report.rows.push({residentId:resident.id,level:level.level,clips:clipMetrics,vertexCount:skins.reduce((n,m)=>n+m.geometry.attributes.position.count,0),elapsedMilliseconds:performance.now()-residentStarted});
   console.log(JSON.stringify({residentId:resident.id,level:level.level,clips:Object.keys(clips),milliseconds:performance.now()-residentStarted,heapMiB:Math.round(process.memoryUsage().heapUsed/1048576)}));
  }catch(error){const message=error instanceof Error?error.message:String(error);report.errors.push({residentId:resident.id,level:level.level,error:message});console.error('HELD',resident.id,level.level,message);}
  finally{if(body)disposeModel(body.scene);}
 }
 checkpoint();(globalThis as any).gc?.();
}
report.completed=report.errors.length===0&&report.rows.length===expectedRows;report.checkedAssetIdentities=[...checkedIdentities].sort();checkpoint();console.log('DONE',JSON.stringify({rows:report.rows.length,errors:report.errors.length,milliseconds:report.elapsedMilliseconds,outputSha256:report.outputSha256}));return report;

}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 bakeVillageCommuteMotion().then(report=>{if(report&&!report.completed)process.exitCode=2;}).catch(error=>{console.error(error instanceof Error?error.message:String(error));process.exitCode=1;});
}
