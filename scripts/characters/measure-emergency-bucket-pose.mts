import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {AnimationMixer,Vector3} from '../../main game/node_modules/three/build/three.module.js';
import {GLTFLoader} from '../../main game/node_modules/three/examples/jsm/loaders/GLTFLoader.js';
import {prepareCrowdLibrary,bindCrowdTemplate} from '../../main game/src/legacy/aethelgard/characters/crowd-residents.ts';
import {getPopulationArt} from '../../shared/legacy/aethelgard/characters/village-population-art.ts';
import {EALDHOLT_POPULATION_ASSET_SHA256 as HASHES} from '../../shared/legacy/aethelgard/characters/population-asset-integrity.ts';
import {emergencyBucketPose0,emergencyPropSocket} from '../../main game/src/legacy/aethelgard/emergency-action-visuals.ts';
const root=resolve(import.meta.dirname,'../../main game/public/assets/legacy/environment/aethelgard/characters')+'/';
const sha=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex');
const loader=new GLTFLoader();
function bytes(path:string){const b=readFileSync(root+path);if(sha(b)!==HASHES[path])throw Error('Original pin mismatch:'+path);return b;}
function cpu(b:Buffer){const n=b.readUInt32LE(12),g=JSON.parse(b.subarray(20,20+n).toString());delete g.images;delete g.textures;delete g.samplers;for(const m of g.materials??[]){function strip(v:any){for(const k in v)if(k.endsWith('Texture'))delete v[k];else if(v[k]&&typeof v[k]==='object')strip(v[k]);}strip(m);}let j=Buffer.from(JSON.stringify(g));j=Buffer.concat([j,Buffer.alloc((4-j.length%4)%4,32)]);const out=Buffer.alloc(20+j.length+b.length-20-n);b.copy(out,0,0,12);out.writeUInt32LE(out.length,8);out.writeUInt32LE(j.length,12);out.writeUInt32LE(0x4e4f534a,16);j.copy(out,20);b.copy(out,20+j.length,20+n);return out.buffer.slice(out.byteOffset,out.byteOffset+out.length);}
export async function measurePublishedEmergencyBucketPose(id:string){
 const art=getPopulationArt(id)!,bodyPath=art.levels[0].path.replace(/^aethelgard\/characters\//,''),metaPath=art.manifest.replace(/^aethelgard\/characters\//,''),clipPath=art.clipLibrary!.path.replace(/^aethelgard\/characters\//,''),kitPath='crowd-v1/props/crowd-props-everyday-v1.glb';
 const meta=JSON.parse(bytes(metaPath).toString()),files=Object.fromEntries([bodyPath,metaPath,clipPath,kitPath].map(path=>[path,HASHES[path]]));
 const [body,libraryFile,kit]=await Promise.all([loader.parseAsync(cpu(bytes(bodyPath)),''),loader.parseAsync(cpu(bytes(clipPath)),''),loader.parseAsync(cpu(bytes(kitPath)),'')]);
 const library=prepareCrowdLibrary(libraryFile as any);bindCrowdTemplate(body as any,library);const mixer=new AnimationMixer(body.scene),action=mixer.clipAction(library.clip('carry_bucket_walk'));action.play();mixer.setTime(0);
 body.scene.scale.multiplyScalar(art.placementScale);const attachment=meta.presentation.clips.carry_bucket_walk.held.find((p:any)=>p.prop==='bucket'),prop=kit.scene.getObjectByName(attachment.node)!.clone(true);prop.matrixAutoUpdate=false;prop.matrix.fromArray(attachment.matrix);body.scene.getObjectByName(attachment.bone)!.add(prop);body.scene.updateMatrixWorld(true);
 const socket=emergencyPropSocket('bucket',HASHES[kitPath])!,mouth=new Vector3().fromArray(socket.point).applyMatrix4(prop.matrixWorld).toArray(),handle=new Vector3().fromArray(socket.handlePoint!).applyMatrix4(prop.matrixWorld).toArray(),prior=emergencyBucketPose0(id,files);
 const result={id,clipId:'carry_bucket_walk',sampleSeconds:0,mouth,handle,files,placementScale:art.placementScale,referenceMaximumError:prior?Math.max(...mouth.map((n,i)=>Math.abs(n-prior.mouth[i])),...handle.map((n,i)=>Math.abs(n-prior.handle[i]))):null};if(prior&&result.referenceMaximumError!>1e-12)throw Error('Existing measurement algorithm mismatch:'+JSON.stringify(result));return result;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const rows=[];for(const id of process.argv.slice(2).filter(v=>!v.startsWith('--')).length?process.argv.slice(2).filter(v=>!v.startsWith('--')):['ealdholt-brewster','ealdholt-swineherd','ealdholt-hall-groom'])rows.push(await measurePublishedEmergencyBucketPose(id));
 console.log(JSON.stringify({kind:'original-source-exact-bucket-pose0',originalFilesUnchanged:true,rows},null,2));
}
