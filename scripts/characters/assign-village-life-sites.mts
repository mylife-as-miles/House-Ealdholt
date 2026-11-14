/** Private authoring over already certified source geometry. Household IDs are
 * allocated to the SAME actual source doorway on Desktop and Quest. This never
 * changes geometry, route certificates, animations or the logical roster. */
import fs from 'node:fs';
import crypto from 'node:crypto';
import {resolve} from 'node:path';
import {parseArgs} from 'node:util';
import {EALDHOLT_VILLAGE_POPULATION as population} from '../../shared/legacy/aethelgard/characters/village-population.ts';
import {createEaldholtVillageSite,validateVillageSiteRigidClearance,applyVillageSiteRigidClearance,resolveVillageSiteEndpoint,resolveVillageSitePath,type VillageSiteLayout} from '../../shared/legacy/aethelgard/characters/village-site.ts';
const {values}=parseArgs({options:{desktop:{type:'string'},quest:{type:'string'},'output-dir':{type:'string'}}});
if(!values.desktop||!values.quest||!values['output-dir'])throw Error('Provide --desktop certified-desktop.json --quest certified-quest.json --output-dir PRIVATE_DIRECTORY.');
const files=[values.desktop,values.quest],sources=files.map(file=>JSON.parse(fs.readFileSync(file,'utf8'))),directory=resolve(values['output-dir']);fs.mkdirSync(directory,{recursive:true,mode:0o700});
function validated(data:any):VillageSiteLayout{const site=createEaldholtVillageSite({profile:data.binding.profile,modelSha256:data.binding.sourceSha256,binding:data.binding,certificate:data.certificate,placeBindings:data.placeBindings,residentPlaceBindings:data.residentPlaceBindings});return applyVillageSiteRigidClearance(site,validateVillageSiteRigidClearance(site,data.rigidSourceClearance));}
const sites=sources.map(validated);
function componentIds(site:VillageSiteLayout){const adjacency=new Map<string,string[]>();for(const route of site.routes)for(const [a,b]of [[route.from,route.to],[route.to,route.from]]){if(!adjacency.has(a))adjacency.set(a,[]);adjacency.get(a)!.push(b);}const result=new Map<string,number>();for(const anchor of site.anchors){if(result.has(anchor.id))continue;const queue=[anchor.id],id=result.size;result.set(anchor.id,id);for(let n=0;n<queue.length;n++)for(const next of adjacency.get(queue[n])??[])if(!result.has(next)){result.set(next,id);queue.push(next);}}return result;}
const components=sites.map(componentIds);
const center=(door:any)=>door.min.map((value:number,index:number)=>(value+door.max[index])/2) as number[];
const separation=(a:readonly number[],b:readonly number[])=>Math.hypot(...a.map((n,i)=>n-b[i]));
const common:any[]=[];
for(const a of sources[0].lifeSite.qualifiedExteriorEntrances){const location=center(a.sourceDoor),b=sources[1].lifeSite.qualifiedExteriorEntrances.find((entry:any)=>separation(location,center(entry.sourceDoor))<.05);if(b)common.push({center:location,entries:[a,b]});}
common.sort((a,b)=>a.center[2]-b.center[2]||a.center[0]-b.center[0]);
if(!common.length)throw Error('No actual source doorway has qualified exterior evidence in both profiles.');
const homes=new Map<string,any>(),used=new Set<any>(),publicPlaces=new Set(['village-well','village-courtyard','proposed-lanes']);
for(const household of population.households){
 const points=sites.map(site=>household.memberIds.flatMap(id=>site.residentPlaceBindings.filter(row=>row.residentId===id&&publicPlaces.has(row.placeId)).flatMap(row=>{const anchor=resolveVillageSiteEndpoint(site,row.placeId,id);return anchor?[anchor]:[];})));
 const score=(entry:any)=>entry.entries.reduce((sum:number,row:any,profile:number)=>sum+points[profile].filter(point=>components[profile].get(point.id)===components[profile].get(row.anchorId)).length,0);
 const distance=(entry:any)=>entry.entries.reduce((sum:number,row:any,profile:number)=>{const source=sites[profile].anchors.find(a=>a.id===row.anchorId)!;return sum+points[profile].reduce((n,p)=>n+separation(p.sourceGroundPoint,source.sourceGroundPoint),0);},0);
 const choices=[...common].sort((a,b)=>Number(used.has(a))-Number(used.has(b))||score(b)-score(a)||distance(a)-distance(b)||a.center[2]-b.center[2]||a.center[0]-b.center[0]);const selected=choices[0];homes.set(household.homePlaceId,selected);used.add(selected);
}
const authoring={schemaVersion:1,status:'working-source-backed-household-allocation',sourceSha256:sites.map(site=>({profile:site.profile,sha256:site.sourceSha256})),sharedSourceDoorways:common.length,households:population.households.map(h=>({householdId:h.id,homePlaceId:h.homePlaceId,memberIds:h.memberIds,sourceDoorCenter:homes.get(h.homePlaceId).center,sharedBuildingAllowed:true,indoorPoseEvidence:false}))};
fs.writeFileSync(resolve(directory,'life-site-household-authoring.json'),JSON.stringify(authoring,null,2),{mode:0o600});
for(const [profileIndex,original]of sources.entries()){
 const data=structuredClone(original),profile=sites[profileIndex].profile,bindings=data.residentPlaceBindings as any[];
 // Remove any earlier provisional occupation-only binding. A real measured door
 // does not by itself prove that a mill, bakery, tannery or church exists there.
 const homePlaces=new Set(population.households.map(h=>h.homePlaceId));
 for(let i=bindings.length-1;i>=0;i--)if(!homePlaces.has(bindings[i].placeId)&&!publicPlaces.has(bindings[i].placeId))bindings.splice(i,1);
 const set=(residentId:string,placeId:string,anchorId:string)=>{const existing=bindings.find(r=>r.residentId===residentId&&r.placeId===placeId);if(existing){existing.anchorId=anchorId;existing.status='mapped-exterior';}else bindings.push({residentId,placeId,anchorId,status:'mapped-exterior'});};
 const householdRecords=population.households.map(h=>{const entry=homes.get(h.homePlaceId).entries[profileIndex];for(const residentId of h.memberIds)set(residentId,h.homePlaceId,entry.anchorId);return{householdId:h.id,placeId:h.homePlaceId,anchorId:entry.anchorId,sourceDoor:entry.sourceDoor,status:'working-household-exterior-assignment',sharedBuildingAllowed:true,indoorPoseEvidence:false};});
 const workplaces=[...new Set(population.residents.map(r=>r.workPlaceId))].map(placeId=>{const home=householdRecords.find(h=>h.placeId===placeId);if(home){for(const resident of population.residents.filter(r=>r.workPlaceId===placeId))set(resident.id,placeId,home.anchorId);return{placeId,anchorId:home.anchorId,status:'home-based-occupation-exterior-threshold',equipmentOrAnimationEvidence:false,indoorPoseEvidence:false};}if(publicPlaces.has(placeId))return{placeId,status:'existing-certified-public-destinations',equipmentOrAnimationEvidence:false,indoorPoseEvidence:false};const known=original.lifeSite.workplaces.find((r:any)=>r.placeId===placeId&&r.status==='source-anvil-exterior-approach');if(known){for(const resident of population.residents.filter(r=>r.workPlaceId===placeId))set(resident.id,placeId,known.anchorId);return known;}return{placeId,anchorId:null,status:'unmapped-requires-occupation-compatible-source-authoring',equipmentOrAnimationEvidence:false,indoorPoseEvidence:false};});
 data.lifeSite={...data.lifeSite,households:householdRecords,workplaces,householdAuthoring:authoring,claim:'Measured shared-source exterior household thresholds and known public destinations. No invented workplace equipment, interiors, beds, poses or observed arrivals.'};
 const site=validated(data),coverage=population.residents.map(r=>({residentId:r.id,home:!!resolveVillageSiteEndpoint(site,r.homePlaceId,r.id),work:!!resolveVillageSiteEndpoint(site,r.workPlaceId,r.id),homeWorkConnected:!!resolveVillageSitePath(site,r.homePlaceId,r.workPlaceId,r.id)})),bytes=Buffer.from(JSON.stringify(data)),filename=`ealdholt-population-${profile}-life-sites-v4.json`,sha256=crypto.createHash('sha256').update(bytes).digest('hex');
 fs.writeFileSync(resolve(directory,filename),bytes,{mode:0o600});const report={profile,filename,bytes:bytes.length,sha256,sourceSha256:site.sourceSha256,anchors:site.anchors.length,routes:site.routes.length,households:householdRecords.length,residents:100,commonSourceDoorways:common.length,homeBound:coverage.filter(c=>c.home).length,workBound:coverage.filter(c=>c.work).length,homeWorkConnected:coverage.filter(c=>c.homeWorkConnected).length,unmappedWorkplaces:workplaces.filter(w=>w.status==='unmapped-requires-occupation-compatible-source-authoring').map(w=>w.placeId),coverage};fs.writeFileSync(resolve(directory,`${profile}-life-site-report.json`),JSON.stringify(report,null,2),{mode:0o600});console.log(JSON.stringify({...report,coverage:undefined},null,2));
}
