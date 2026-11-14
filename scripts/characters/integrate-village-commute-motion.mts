/** Private metadata integration only. Source meshes, certificates, household
 * assignments, routes and configuration are never authored or changed here. */
import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {performance} from 'node:perf_hooks';
import {EALDHOLT_VILLAGE_POPULATION as POP} from '../../shared/legacy/aethelgard/characters/village-population.ts';
import {getPopulationArt} from '../../shared/legacy/aethelgard/characters/village-population-art.ts';
import {parsePopulationMotionEvidence,qualifyPopulationMotion,type PopulationMotionEvidence} from '../../shared/legacy/aethelgard/characters/population-motion-clearance.ts';
import {resolvePopulationPresentation} from '../../shared/legacy/aethelgard/characters/village-activity-presentation.ts';
import {createEaldholtVillageSite,applyVillageSiteRigidClearance,validateVillageSiteRigidClearance,type VillageSiteLayout} from '../../shared/legacy/aethelgard/characters/village-site.ts';
import {createVillagePopulationRuntime,advanceVillagePopulationRuntime,sampleVillagePopulationRuntime,type VillagePopulationResidentState} from '../../shared/legacy/aethelgard/characters/village-population-runtime.ts';
import {privateCommuteOutput,readPinnedCharacterAsset} from './bake-village-commute-motion.mts';

const digest=(value:Buffer|string)=>crypto.createHash('sha256').update(value).digest('hex');
const read=(file:string)=>{if(fs.statSync(file).size>32*1024*1024)throw Error('Motion/site metadata exceeds32MiB.');const bytes=fs.readFileSync(file);return{bytes,data:JSON.parse(bytes.toString('utf8'))};};
const HELP=`Integrate completed actual-asset motion evidence into private certified site manifests.
Required: --assets-root CHARACTERS_DIRECTORY --motion EVIDENCE.json --motion-report BAKE_REPORT.json
          --source-evidence PREVIOUS.json --source-evidence-sha256 EXPECTED_SHA256
          --desktop DESKTOP_SITE.json --quest QUEST_SITE.json --output-dir PRIVATE_DIRECTORY
Optional: --sweep-minutes 240 (0–1440) --max-ms 30000 (100–120000) --overwrite --help
New candidate mode instead of prior inputs:
          --fresh-candidate --profile desktop|quest --site-candidate NEW.json
          --site-candidate-sha256 EXPECTED_SHA256 --source-model ORIGINAL.glb
          --source-model-sha256 EXPECTED_SHA256 --motion-sha256 EXPECTED_SHA256
          --motion-report-sha256 EXPECTED_SHA256
All100 residents and every actual LOD must have fresh bake records. No geometry or active configuration is changed.`;

/** Validate completeness before any output. The report and evidence remain
 * caller supplied data; this is not a signed proof of having run the sampler. */
export function validateCompleteCommuteBake(bytes:Buffer,report:any):PopulationMotionEvidence{
 const evidence=parsePopulationMotionEvidence(JSON.parse(bytes.toString('utf8')));
 if(!report||report.completed!==true||report.method!=='cpu-sampled-skin-and-props-v1'||report.fps!==60||report.paddingMetres!==.05
  ||!Array.isArray(report.errors)||report.errors.length||!Array.isArray(report.rows)||report.outputSha256!==digest(bytes))throw Error('Completed source-bound motion bake report does not match evidence.');
 const expected=new Set(POP.residents.flatMap(person=>getPopulationArt(person.id)!.levels.map(level=>person.id+'\0'+level.level))),seen=new Set<string>();
 if(report.rows.length!==expected.size||Object.keys(evidence.residents).length!==POP.residents.length)throw Error('Motion integration requires all100 residents and every published LOD.');
 for(const row of report.rows){const key=row?.residentId+'\0'+row?.level;if(!expected.has(key)||seen.has(key)||!Array.isArray(row.clips)||!row.clips.length)throw Error('Motion bake contains missing, duplicated or unregistered resident levels.');seen.add(key);
  const level=evidence.residents[row.residentId]?.levels[row.level as keyof typeof evidence.residents[string]['levels']];if(!level)throw Error('Motion report level has no corresponding evidence.');
  const clipNames=new Set<string>();for(const clip of row.clips){const stored=level.clips[clip?.name];if(!clip||typeof clip.name!=='string'||clipNames.has(clip.name)||!stored||!clip.evidence
    ||!(['radiusMetres','heightMetres','minimumBodyYMetres','placedBelowGround'] as const).every(key=>stored[key]===clip.evidence[key])
    ||!Number.isSafeInteger(clip.samples)||clip.samples<2||!Number.isSafeInteger(clip.crossChecks)||clip.crossChecks<1||!Number.isFinite(clip.largestReferenceError)||clip.largestReferenceError>1e-8||clip.largestReferenceError<0)throw Error('Motion report does not match its measured clips and skinning cross-checks.');clipNames.add(clip.name);}
 }
 return evidence;
}

/** A fresh candidate has no inherited measurements. Every stored clip must be
 * accounted for by this completed bake, not smuggled in as unreported history. */
export function validateFreshCommuteBake(bytes:Buffer,report:any):PopulationMotionEvidence{
 if(!report||report.provenanceMode!=='fresh-measured'||report.sourceEvidence!==null||report.sourceEvidenceSha256!==null
  ||report.selection?.fullPopulation!==true||!['commute','routine'].includes(report.selection?.clipScope)
  ||report.generator?.name!=='bake-village-commute-motion'||typeof report.generator?.sha256!=='string'||!/^[a-f0-9]{64}$/.test(report.generator.sha256)
  ||report.siteClearance!=='not-measured-by-animation-envelope-bake')throw Error('Fresh integration requires an explicit fresh measured bake with no prior evidence.');
 const evidence=validateCompleteCommuteBake(bytes,report);
 for(const row of report.rows){
  if(!Number.isSafeInteger(row.vertexCount)||row.vertexCount<1)throw Error('Fresh bake needs actual skinned vertex counts.');
  const level=evidence.residents[row.residentId].levels[row.level as keyof typeof evidence.residents[string]['levels']]!;
  if(Object.keys(level.clips).length!==row.clips.length)throw Error('Fresh evidence contains clips not measured by its bake report.');
  for(const clip of row.clips){
   if(!Number.isSafeInteger(clip.skinnedVertexSamples)||clip.skinnedVertexSamples!==row.vertexCount*clip.samples)throw Error('Fresh bake did not account for every sampled skinned vertex.');
   const trajectory=clip.jointTrajectories;if(trajectory?.method!=='sampled-joint-centres-not-contact-proof'||!Array.isArray(trajectory.joints))throw Error('Fresh bake needs actual joint-centre trajectories, not contact claims.');
   const names=new Set<string>();for(const joint of trajectory.joints){
    if(!joint||typeof joint.name!=='string'||names.has(joint.name)||!Number.isFinite(joint.travelMetres)||joint.travelMetres<0)throw Error('Malformed fresh joint trajectory.');names.add(joint.name);
    for(const key of ['first','last','minimum','maximum'])if(!Array.isArray(joint[key])||joint[key].length!==3||!joint[key].every(Number.isFinite))throw Error('Malformed fresh joint trajectory.');
    for(let axis=0;axis<3;axis++)if(joint.minimum[axis]>joint.maximum[axis]||joint.first[axis]<joint.minimum[axis]-1e-10||joint.first[axis]>joint.maximum[axis]+1e-10||joint.last[axis]<joint.minimum[axis]-1e-10||joint.last[axis]>joint.maximum[axis]+1e-10)throw Error('Fresh joint trajectory leaves its measured bounds.');
   }
   if(!['root','foot_l','foot_r'].every(name=>names.has(name)))throw Error('Fresh bake omitted actual root or foot joints.');
  }
 }
 return evidence;
}

export interface FreshCommuteInputPins {readonly sourceModelSha256:string;readonly siteCandidateSha256:string;readonly motionSha256:string;readonly motionReportSha256:string}
export function prepareFreshCommuteMotionSite(raw:any,evidenceData:unknown,profile:'desktop'|'quest',pins:FreshCommuteInputPins){
 if(![pins.sourceModelSha256,pins.siteCandidateSha256,pins.motionSha256,pins.motionReportSha256].every(hash=>typeof hash==='string'&&/^[a-f0-9]{64}$/.test(hash)))throw Error('Fresh integration requires exact input SHA-256 pins.');
 const candidate=raw?.authoringCandidate;
 if(!candidate||candidate.status!=='new-measured-candidate'||candidate.freshWorldsOnly!==true||candidate.previousPackageRecovered!==false
  ||typeof candidate.identity!=='string'||!candidate.identity.startsWith('new-source-candidate:')
  ||candidate.sourceModelSha256!==pins.sourceModelSha256||candidate.sourceMeasurement?.sourceSha256!==pins.sourceModelSha256
  ||candidate.sourceMeasurement?.sourceOriginalBuffersUnchanged!==true
  ||raw.binding?.profile!==profile||raw.binding?.sourceSha256!==pins.sourceModelSha256)throw Error('Fresh source candidate profile, model identity or measured provenance does not match.');
 if(Object.prototype.hasOwnProperty.call(raw,'motionEvidence')||Object.prototype.hasOwnProperty.call(raw,'freshMotionProvenance'))throw Error('Fresh integration requires a new candidate without prior motion bindings.');
 const prepared=prepareCommuteMotionSite(raw,evidenceData,profile);
 const provenance={schemaVersion:1,kind:'fresh-candidate-motion-integration',freshWorldsOnly:true,
  siteCandidateIdentity:candidate.identity,...pins,priorEvidence:null,
  scope:'Measured character envelopes only; joint centres are not equipment, bed or foot-contact proof. Source-site route certificates remain independently required.'};
 const data={...prepared.data,freshMotionProvenance:provenance},nonMotion={...data} as any;delete nonMotion.motionEvidence;delete nonMotion.freshMotionProvenance;
 assert.equal(digest(JSON.stringify(nonMotion)),digest(JSON.stringify(raw)),'Fresh integration may attach only measured motion and its provenance.');
 return{...prepared,data};
}

export function prepareCommuteMotionSite(raw:any,evidenceData:unknown,profile:'desktop'|'quest'):{data:any;site:VillageSiteLayout;unchangedSourceSha256:string}{
 parsePopulationMotionEvidence(evidenceData);
 const original=createEaldholtVillageSite({profile,modelSha256:raw.binding.sourceSha256,binding:raw.binding,certificate:raw.certificate,placeBindings:raw.placeBindings,residentPlaceBindings:raw.residentPlaceBindings});
 const site=applyVillageSiteRigidClearance(original,validateVillageSiteRigidClearance(original,raw.rigidSourceClearance));
 const before={...raw};delete before.motionEvidence;const unchangedSourceSha256=digest(JSON.stringify(before));
 const data={...raw,motionEvidence:evidenceData},after={...data};delete after.motionEvidence;
 assert.equal(digest(JSON.stringify(after)),unchangedSourceSha256,'Only motionEvidence may change during integration.');
 return{data,site,unchangedSourceSha256};
}

function movingState(person:typeof POP.residents[number],slotIndex:number):VillagePopulationResidentState{
 const slot=person.registry.routine[slotIndex];return{residentId:person.id,tier:person.fidelityTier,activity:slot.activity,roleClip:null,availableRoleClips:person.appearance.motion.roleClips,scheduledPlaceId:slot.placeId,placeId:slot.placeId,fromPlaceId:person.homePlaceId,slotIndex,slotStartMinute:slot.startMinute,slotEndMinute:slot.endMinute,status:'travelling',reason:null,position:[0,0,0],yawRadians:0,moving:true,presentable:true};
}
export function auditCommuteEnvelopeCapabilities(site:VillageSiteLayout,evidence:PopulationMotionEvidence,platform:'desktop'|'quest'){
 const ordinary:any[]=[],roles:any[]=[];
 for(const person of POP.residents){
  const plans=person.registry.routine.map((_,index)=>{const state=movingState(person,index);return{state,presentation:resolvePopulationPresentation(state)};}).filter(plan=>plan.presentation.presentable&&plan.presentation.motion==='walk');
  const plain=plans.find(plan=>!plan.presentation.activity.roleClip);if(!plain)throw Error('No ordinary authored walking plan: '+person.id);
  ordinary.push({residentId:person.id,...qualifyPopulationMotion(plain.state,plain.presentation,site,evidence,platform,{profile:site.profile,sha256:site.sourceSha256})});
  const seen=new Set<string>();for(const plan of plans){const clip=plan.presentation.activity.roleClip;if(!clip||seen.has(clip))continue;seen.add(clip);roles.push({residentId:person.id,clip,...qualifyPopulationMotion(plan.state,plan.presentation,site,evidence,platform,{profile:site.profile,sha256:site.sourceSha256})});}
 }
 return{scope:'Envelope capability for authored moving plans only; not physical arrival or rendered actors.',ordinaryWalk:{total:ordinary.length,qualified:ordinary.filter(row=>row.presentable).length,held:ordinary.filter(row=>!row.presentable)},movingRolePlans:{total:roles.length,qualified:roles.filter(row=>row.presentable).length,held:roles.filter(row=>!row.presentable)}};
}

function auditCommuteRuntime(site:VillageSiteLayout,evidence:PopulationMotionEvidence,profile:'desktop'|'quest',minutes:number,budget:()=>void){
 const actual:any={scope:'CPU navigation and motion gates; not proof of drawn people or hardware performance.',minutes,uniqueMovingResidents:0,uniqueMotionQualifiedResidents:0,held:[],samples:[]};
 if(minutes){const epoch=1800000000000,pace=4000,key='offline-commute-audit-'+profile,revision='commute-audit-v1',made=createVillagePopulationRuntime({population:POP,confirmedEntry:true,worldKey:key,contentRevision:revision,createdAt:epoch,initialDayMinute:540,millisecondsPerWorldMinute:pace,walkingSpeedMetresPerSecond:.8});if(!made.ok)throw Error(made.error);let state=made.snapshot;const moving=new Set<string>(),qualified=new Set<string>(),held=new Map<string,string>();
  for(let minute=0;minute<=minutes;minute++){budget();const next=advanceVillagePopulationRuntime(state,{expectedGeneration:state.generation,worldKey:key,contentRevision:revision,observedAt:epoch+minute*pace,maxAdvanceMinutes:1,site});if(!next.ok)throw Error(next.error);state=next.snapshot;const sample=sampleVillagePopulationRuntime(state,site);let count=0,passed=0;
   for(const person of sample.residents){if(!person.moving||!person.presentable)continue;count++;moving.add(person.residentId);const result=qualifyPopulationMotion(person,resolvePopulationPresentation(person),site,evidence,profile,{profile,sha256:site.sourceSha256});if(result.presentable){passed++;qualified.add(person.residentId);}else held.set(person.residentId,result.reason??'unknown');}
   if(minute%15===0)actual.samples.push({absoluteMinute:540+minute,moving:count,motionQualified:passed,certifiedArrivals:sample.residents.filter(person=>person.arrivalEvidence==='certified-route-arrival').length});
  }
  actual.uniqueMovingResidents=moving.size;actual.uniqueMotionQualifiedResidents=qualified.size;actual.held=[...held].map(([residentId,reason])=>({residentId,reason}));
 }
 return actual;
}

function checkedInput(file:string,expected:string,label:string){
 const input=read(file);if(!/^[a-f0-9]{64}$/.test(expected)||digest(input.bytes)!==expected)throw Error(label+' SHA-256 does not match its explicit pin.');return input;
}
function checkedSourceModel(file:string,expected:string,budget:()=>void){
 if(!/^[a-f0-9]{64}$/.test(expected))throw Error('Original model requires an explicit SHA-256 pin.');
 const path=fs.realpathSync(resolve(file)),stat=fs.statSync(path);if(!stat.isFile()||stat.size<20||stat.size>512*1024*1024)throw Error('Original source model exceeds its GLB byte budget.');
 const hash=crypto.createHash('sha256'),fd=fs.openSync(path,'r'),chunk=Buffer.allocUnsafe(8*1024*1024);let offset=0;
 try{while(offset<stat.size){budget();const count=fs.readSync(fd,chunk,0,Math.min(chunk.length,stat.size-offset),offset);if(count<=0)throw Error('Original source model could not be read completely.');
   if(offset===0&&(chunk.readUInt32LE(0)!==0x46546c67||chunk.readUInt32LE(4)!==2||chunk.readUInt32LE(8)!==stat.size))throw Error('Original source model must be an unchanged GLB v2.');
   hash.update(chunk.subarray(0,count));offset+=count;
  }}finally{fs.closeSync(fd);}
 const sha256=hash.digest('hex');if(sha256!==expected)throw Error('Original source model SHA-256 does not match its explicit pin.');return{path,bytes:stat.size,sha256};
}

async function integrateFreshCandidate(values:any,minutes:number,budget:()=>void,started:number){
 if(values['source-evidence']!==undefined||values['source-evidence-sha256']!==undefined||values.desktop!==undefined||values.quest!==undefined)throw Error('Fresh candidate integration cannot include prior-world inputs.');
 const required=['profile','site-candidate','site-candidate-sha256','source-model','source-model-sha256','motion-sha256','motion-report-sha256'];
 if(required.some(key=>!values[key]))throw Error('Fresh candidate integration requires its source profile and exact candidate, model, motion and report inputs.\n'+HELP);
 const profile=values.profile;if(profile!=='desktop'&&profile!=='quest')throw Error('Fresh candidate profile must be desktop or quest.');
 const dir=privateCommuteOutput(values['output-dir'],values['assets-root']);
 const input=checkedInput(values['site-candidate'],values['site-candidate-sha256'],'Fresh site candidate');
 const sourceModel=checkedSourceModel(values['source-model'],values['source-model-sha256'],budget);
 const motion=checkedInput(values.motion,values['motion-sha256'],'Fresh motion'),report=checkedInput(values['motion-report'],values['motion-report-sha256'],'Fresh motion report');
 const evidence=validateFreshCommuteBake(motion.bytes,report.data);
 const pins:FreshCommuteInputPins={sourceModelSha256:sourceModel.sha256,siteCandidateSha256:digest(input.bytes),motionSha256:digest(motion.bytes),motionReportSha256:digest(report.bytes)};
 const prepared=prepareFreshCommuteMotionSite(input.data,motion.data,profile,pins),checked=new Set<string>();
 for(const resident of Object.values(evidence.residents))for(const level of Object.values(resident.levels))for(const file of Object.keys(level!.files))if(!checked.has(file)){budget();readPinnedCharacterAsset(values['assets-root'],file);checked.add(file);}
 const sourceInputs=[values['site-candidate'],values.motion,values['motion-report'],values['source-model']].map(path=>fs.realpathSync(resolve(path)));
 const filename=profile+'-fresh-commute-sites.json',reportName='fresh-commute-integration-report.json';
 for(const name of [filename,reportName]){const path=resolve(dir,name);if(fs.existsSync(path)&&sourceInputs.includes(fs.realpathSync(path)))throw Error('Fresh output would overwrite a read-only source input.');if(!values.overwrite&&fs.existsSync(path))throw Error('Fresh integration output exists; choose a new directory or explicitly pass --overwrite.');}
 const capabilities=auditCommuteEnvelopeCapabilities(prepared.site,evidence,profile),actual=auditCommuteRuntime(prepared.site,evidence,profile,minutes,budget),payload=JSON.stringify(prepared.data);
 const summary={schemaVersion:1,kind:'fresh-source-candidate-motion-integration',freshWorldsOnly:true,sourceEvidence:null,
  candidate:{path:resolve(values['site-candidate']),identity:input.data.authoringCandidate.identity,sha256:pins.siteCandidateSha256},sourceModel,
  motion:{path:resolve(values.motion),bytes:motion.bytes.length,sha256:pins.motionSha256},bakeReport:{path:resolve(values['motion-report']),sha256:pins.motionReportSha256},
  actualPinnedAssetFilesVerified:checked.size,sourceAssetsWritten:false,siteGeometryChanged:false,configurationChanged:false,savedStateChanged:false,
  elapsedMilliseconds:performance.now()-started,profiles:[{profile,sourceModelSha256:sourceModel.sha256,output:{filename,bytes:Buffer.byteLength(payload),sha256:digest(payload)},unchangedNonMotionDataSha256:prepared.unchangedSourceSha256,...capabilities,actual}]};
 budget();fs.mkdirSync(dir,{recursive:true,mode:0o700});
 for(const output of [{file:filename,payload},{file:reportName,payload:JSON.stringify(summary,null,2)}]){const path=resolve(dir,output.file),temp=path+'.tmp-'+process.pid;fs.writeFileSync(temp,output.payload,{mode:0o600,flag:'wx'});fs.renameSync(temp,path);}
 console.log(JSON.stringify(summary,null,2));return summary;
}

export async function integrateVillageCommuteMotion(argv:readonly string[]=process.argv.slice(2)):Promise<any>{
 const {values}=parseArgs({args:[...argv],options:{'assets-root':{type:'string'},motion:{type:'string'},'motion-report':{type:'string'},'source-evidence':{type:'string'},'source-evidence-sha256':{type:'string'},desktop:{type:'string'},quest:{type:'string'},'output-dir':{type:'string'},'fresh-candidate':{type:'boolean',default:false},profile:{type:'string'},'site-candidate':{type:'string'},'site-candidate-sha256':{type:'string'},'source-model':{type:'string'},'source-model-sha256':{type:'string'},'motion-sha256':{type:'string'},'motion-report-sha256':{type:'string'},'sweep-minutes':{type:'string'},'max-ms':{type:'string'},overwrite:{type:'boolean',default:false},help:{type:'boolean',default:false}}});
 if(values.help){console.log(HELP);return null;}
 if(!values['assets-root']||!values.motion||!values['motion-report']||!values['output-dir'])throw Error(HELP);
 const maximumMs=Number(values['max-ms']??30000),minutes=Number(values['sweep-minutes']??240);
 if(!Number.isSafeInteger(maximumMs)||maximumMs<100||maximumMs>120000||!Number.isSafeInteger(minutes)||minutes<0||minutes>1440)throw Error('Motion integration requires bounded time and sweep budgets.');
 const started=performance.now(),budget=()=>{if(performance.now()-started>maximumMs)throw Error('Motion integration time budget exceeded.');};
 if(values['fresh-candidate'])return integrateFreshCandidate(values,minutes,budget,started);
 if(['profile','site-candidate','site-candidate-sha256','source-model','source-model-sha256','motion-sha256','motion-report-sha256'].some(key=>(values as any)[key]!==undefined))throw Error('Fresh candidate inputs require the explicit --fresh-candidate mode.');
 if(!values['source-evidence']||!values['source-evidence-sha256']||!values.desktop||!values.quest)throw Error(HELP);
 const dir=privateCommuteOutput(values['output-dir'],values['assets-root']),motion=read(values.motion),report=read(values['motion-report']),evidence=validateCompleteCommuteBake(motion.bytes,report.data);
 const previous=read(values['source-evidence']),previousHash=digest(previous.bytes),oldEvidence=parsePopulationMotionEvidence(previous.data);
 if(!/^[a-f0-9]{64}$/.test(values['source-evidence-sha256'])||previousHash!==values['source-evidence-sha256']||report.data.sourceEvidenceSha256!==previousHash)throw Error('Original source evidence does not match bake provenance.');
 for(const [residentId,resident]of Object.entries(oldEvidence.residents))for(const [name,level]of Object.entries(resident.levels)){
  const current=evidence.residents[residentId]?.levels[name as keyof typeof resident.levels];if(!current)throw Error('Original resident-level evidence was removed.');
  for(const [file,hash]of Object.entries(level!.files))if(current.files[file]!==hash)throw Error('Original source-byte identity was removed.');
  for(const clip of Object.keys(level!.clips))if(!current.clips[clip])throw Error('Original measured clip was removed.');
 }
 const checked=new Set<string>();
 for(const resident of Object.values(evidence.residents))for(const level of Object.values(resident.levels))for(const file of Object.keys(level!.files)){if(!checked.has(file)){budget();readPinnedCharacterAsset(values['assets-root'],file);checked.add(file);}}
 const sourceInputs=[values.motion,values['motion-report'],values['source-evidence'],values.desktop,values.quest].map(path=>fs.realpathSync(resolve(path))),outputNames=['desktop-commute-sites.json','quest-commute-sites.json','commute-integration-report.json'];
 for(const name of outputNames){const path=resolve(dir,name);if(fs.existsSync(path)&&sourceInputs.includes(fs.realpathSync(path)))throw Error('Output would overwrite read-only source metadata.');if(!values.overwrite&&fs.existsSync(path))throw Error('Motion integration output exists; choose a new directory or explicitly pass --overwrite.');}
 const profiles:any[]=[],payloads:{file:string;payload:string}[]=[];
 for(const profile of ['desktop','quest'] as const){
  budget();const input=read(values[profile]!),prepared=prepareCommuteMotionSite(input.data,motion.data,profile),capabilities=auditCommuteEnvelopeCapabilities(prepared.site,evidence,profile);
  const old=parsePopulationMotionEvidence(input.data.motionEvidence),previous=auditCommuteEnvelopeCapabilities(prepared.site,old,profile);
  const actual:any={scope:'CPU navigation and motion gates; not proof of drawn people or hardware performance.',minutes,uniqueMovingResidents:0,uniqueMotionQualifiedResidents:0,held:[],samples:[]};
  if(minutes){const epoch=1800000000000,pace=4000,key='offline-commute-audit-'+profile,revision='commute-audit-v1',made=createVillagePopulationRuntime({population:POP,confirmedEntry:true,worldKey:key,contentRevision:revision,createdAt:epoch,initialDayMinute:540,millisecondsPerWorldMinute:pace,walkingSpeedMetresPerSecond:.8});if(!made.ok)throw Error(made.error);let state=made.snapshot;const moving=new Set<string>(),qualified=new Set<string>(),held=new Map<string,string>();
   for(let minute=0;minute<=minutes;minute++){budget();const next=advanceVillagePopulationRuntime(state,{expectedGeneration:state.generation,worldKey:key,contentRevision:revision,observedAt:epoch+minute*pace,maxAdvanceMinutes:1,site:prepared.site});if(!next.ok)throw Error(next.error);state=next.snapshot;const sample=sampleVillagePopulationRuntime(state,prepared.site);let count=0,passed=0;
    for(const person of sample.residents){if(!person.moving||!person.presentable)continue;count++;moving.add(person.residentId);const result=qualifyPopulationMotion(person,resolvePopulationPresentation(person),prepared.site,evidence,profile,{profile,sha256:prepared.site.sourceSha256});if(result.presentable){passed++;qualified.add(person.residentId);}else held.set(person.residentId,result.reason??'unknown');}
    if(minute%15===0)actual.samples.push({absoluteMinute:540+minute,moving:count,motionQualified:passed,certifiedArrivals:sample.residents.filter(person=>person.arrivalEvidence==='certified-route-arrival').length});
   }
   actual.uniqueMovingResidents=moving.size;actual.uniqueMotionQualifiedResidents=qualified.size;actual.held=[...held].map(([residentId,reason])=>({residentId,reason}));
  }
  const payload=JSON.stringify(prepared.data),filename=profile+'-commute-sites.json';payloads.push({file:filename,payload});
  profiles.push({profile,sourceModelSha256:prepared.site.sourceSha256,input:{path:resolve(values[profile]!),bytes:input.bytes.length,sha256:digest(input.bytes)},output:{filename,bytes:Buffer.byteLength(payload),sha256:digest(payload)},unchangedNonMotionDataSha256:prepared.unchangedSourceSha256,previouslyQualifiedOrdinaryWalks:previous.ordinaryWalk.qualified,...capabilities,actual});
 }
 const summary={schemaVersion:1,kind:'source-bound-commute-motion-integration',motion:{path:resolve(values.motion),bytes:motion.bytes.length,sha256:digest(motion.bytes)},bakeReport:{path:resolve(values['motion-report']),sha256:digest(report.bytes)},sourceEvidence:{path:resolve(values['source-evidence']),sha256:previousHash},actualPinnedAssetFilesVerified:checked.size,sourceAssetsWritten:false,siteGeometryChanged:false,configurationChanged:false,elapsedMilliseconds:performance.now()-started,profiles};
 budget();fs.mkdirSync(dir,{recursive:true,mode:0o700});payloads.push({file:'commute-integration-report.json',payload:JSON.stringify(summary,null,2)});
 for(const output of payloads){const path=resolve(dir,output.file),temp=path+'.tmp-'+process.pid;fs.writeFileSync(temp,output.payload,{mode:0o600,flag:'wx'});fs.renameSync(temp,path);}
 console.log(JSON.stringify(summary,null,2));return summary;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))integrateVillageCommuteMotion().catch(error=>{console.error(error instanceof Error?error.message:String(error));process.exitCode=1;});
