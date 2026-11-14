import fs from 'node:fs';import crypto from 'node:crypto';import {resolve} from 'node:path';import {parseArgs} from 'node:util';
// Offline authoring: measured proof and motion bytes are inputs, never invented
// by this tool. Outputs are private model-bound metadata, not public assets.
import {EALDHOLT_VILLAGE_POPULATION as pop} from '../../shared/legacy/aethelgard/characters/village-population.ts';
import {createEaldholtVillageSite,validateVillageSiteRigidClearance,applyVillageSiteRigidClearance} from '../../shared/legacy/aethelgard/characters/village-site.ts';
import {createVillagePopulationRuntime,sampleVillagePopulationRuntime} from '../../shared/legacy/aethelgard/characters/village-population-runtime.ts';
import {createPopulationEndpointAdmission} from '../../shared/legacy/aethelgard/characters/population-endpoint-admission.ts';
import {parsePopulationMotionEvidence,qualifyPopulationMotion} from '../../shared/legacy/aethelgard/characters/population-motion-clearance.ts';
import {resolvePopulationPresentation} from '../../shared/legacy/aethelgard/characters/village-activity-presentation.ts';
const {values}=parseArgs({options:{profile:{type:'string'},proof:{type:'string'},motion:{type:'string'},'output-dir':{type:'string'}}});
const profile=values.profile;
if(!['desktop','quest'].includes(profile??'')||!values.proof||!values.motion||!values['output-dir'])throw Error('Provide --profile desktop|quest --proof source-site.json --motion motion-evidence.json --output-dir PRIVATE_DIRECTORY.');
const d=resolve(values['output-dir']);fs.mkdirSync(d,{recursive:true,mode:0o700});
function read(path:string){const bytes=fs.readFileSync(path);if(bytes.length>16*1024*1024)throw Error('Site authoring input exceeds 16 MiB.');return JSON.parse(bytes.toString('utf8'));}
const base=read(values.proof),motion=read(values.motion);
parsePopulationMotionEvidence(motion);
// Validate every original anchor/certificate before candidate ordering can use it.
const rawSite=createEaldholtVillageSite({profile:profile as 'desktop'|'quest',modelSha256:base.binding.sourceSha256,binding:base.binding,certificate:base.certificate,placeBindings:[],residentPlaceBindings:[]});
const proofSite=applyVillageSiteRigidClearance(rawSite,validateVillageSiteRigidClearance(rawSite,base.rigidSourceClearance));
const anchors=new Map(proofSite.anchors.map(a=>[a.id,a]));
if(!Array.isArray(base.candidates)||base.candidates.length>4096)throw Error('Bounded measured candidates are required.');
for(const [i,c]of base.candidates.entries()){
 const a=anchors.get(`courtyard-${i}`);
 if(!a||!['well-courtyard','east-well-courtyard'].includes(c.zone)||!Array.isArray(c.p)||c.p.length!==3||c.p.some((v:number,k:number)=>!Number.isFinite(v)||Math.abs(v-a.sourceGroundPoint[k])>1e-6))throw Error('Public destination is not a cleared, measured courtyard anchor.');
}
const places=new Set(['village-well','village-courtyard','proposed-lanes']);
const people=pop.residents.filter(r=>r.registry.routine.some(s=>places.has(s.placeId)));
// Fixed, distinct physical destinations for the well, courtyards and their existing lanes. No
// shared seat/workstation, synthetic home, invented route, or idle-as-work.
const candidates=base.candidates.map((c:any,index:number)=>({...c,index}));
const central=candidates.filter((c:any)=>c.zone==='well-courtyard').sort((a:any,b:any)=>Math.hypot(a.p[0]-19,a.p[2]-32)-Math.hypot(b.p[0]-19,b.p[2]-32));
const eastern=candidates.filter((c:any)=>c.zone==='east-well-courtyard').sort((a:any,b:any)=>Math.hypot(a.p[0]-49,a.p[2]-24)-Math.hypot(b.p[0]-49,b.p[2]-24));
const ordered:any[]=[];for(let i=0;i<Math.max(central.length,eastern.length);i++){if(central[i])ordered.push(central[i]);if(eastern[i])ordered.push(eastern[i]);}
if(ordered.length<people.length)throw Error(`Only ${ordered.length} genuinely cleared destinations for ${people.length} public-space residents.`);
// Prioritize the existing morning conversation/children near the central well;
// schedules and the clock are unchanged. All others retain their real role.
people.sort((a,b)=>Number(b.registry.routine.some(s=>s.startMinute<=540&&s.endMinute>540&&places.has(s.placeId)))-Number(a.registry.routine.some(s=>s.startMinute<=540&&s.endMinute>540&&places.has(s.placeId))));
const bindings:any[]=[];
for(const [i,r]of people.entries())for(const placeId of new Set(r.registry.routine.filter(s=>places.has(s.placeId)).map(s=>s.placeId)))bindings.push({residentId:r.id,placeId,status:'mapped-exterior',anchorId:`courtyard-${ordered[i].index}`});
const data={binding:base.binding,certificate:base.certificate,rigidSourceClearance:base.rigidSourceClearance,placeBindings:[],residentPlaceBindings:bindings,motionEvidence:motion,workplaceAnchors:[]};
const original=createEaldholtVillageSite({profile:profile as 'desktop'|'quest',modelSha256:base.binding.sourceSha256,binding:data.binding,certificate:data.certificate,placeBindings:[],residentPlaceBindings:bindings});
const site=applyVillageSiteRigidClearance(original,validateVillageSiteRigidClearance(original,data.rigidSourceClearance)),evidence=parsePopulationMotionEvidence(motion);
const reports=[];
for(let minute=0;minute<1440;minute+=30){
 const runtime=createVillagePopulationRuntime({population:pop,confirmedEntry:true,worldKey:'private-authoring-check',contentRevision:'private-authoring-v3',createdAt:0,initialDayMinute:minute,millisecondsPerWorldMinute:4000,walkingSpeedMetresPerSecond:.8});if(!runtime.ok)throw Error(runtime.error);
 const admission=createPopulationEndpointAdmission(site),sample=admission.sample(sampleVillagePopulationRuntime(runtime.snapshot,site),0,new Set());
 const rows=sample.residents.filter(r=>r.position).map(r=>{const p=resolvePopulationPresentation(r);return{id:r.residentId,position:r.position,motion:p.motion,activity:r.activity,...qualifyPopulationMotion(r,p,site,evidence,profile as 'desktop'|'quest')}});
 const qualified=rows.filter(r=>r.presentable);reports.push({minute,mapped:rows.length,qualified:qualified.length,residents:qualified.map(r=>r.id),held:rows.filter(r=>!r.presentable).map(r=>({id:r.id,reason:r.reason}))});
 for(let i=0;i<qualified.length;i++)for(let j=0;j<i;j++){const a=qualified[i].position!,b=qualified[j].position!;if(Math.abs(a[1]-b[1])<site.capsule.height&&Math.hypot(a[0]-b[0],a[2]-b[2])<2*site.capsule.radius)throw Error('Overlapping certified residents.');}
}
const bytes=Buffer.from(JSON.stringify(data)),sha256=crypto.createHash('sha256').update(bytes).digest('hex'),file=`ealdholt-population-${profile}-public-destinations-v3.json`;
fs.writeFileSync(`${d}/${file}`,bytes);fs.writeFileSync(`${d}/${profile}-qualification.json`,JSON.stringify({file,bytes:bytes.length,sha256,registered:100,publicResidents:people.length,residentPlaceBindings:bindings.length,anchors:site.anchors.length,reports},null,2));
console.log(JSON.stringify({profile,file,bytes:bytes.length,sha256,publicResidents:people.length,residentPlaceBindings:bindings.length,atNine:reports.find(r=>r.minute===540),atEleven:reports.find(r=>r.minute===660),atSixteen:reports.find(r=>r.minute===960)},null,2));
