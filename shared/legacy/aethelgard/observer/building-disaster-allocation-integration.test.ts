import test from 'node:test';
import assert from 'node:assert/strict';
import {EALDHOLT_VILLAGE_POPULATION as population} from '../characters/village-population';
import {EALDHOLT_POPULATION_ASSET_SHA256 as files} from '../characters/population-asset-integrity';
import {parsePopulationMotionEvidence} from '../characters/population-motion-clearance';
import {requiredVillageWorkplaceMotionClips,parseVillageSiteWorkplaceRoutes,type VillageSiteWorkplaceRoute} from '../characters/village-workplace-routes';
import type {VillageSiteLayout,VillageSitePoint} from '../characters/village-site';
import {createVillagePopulationRuntime,serializeVillagePopulationRuntime,type VillagePopulationRuntime,type VillagePopulationRuntimeResult} from '../characters/village-population-runtime';
import {parseVillageTimberCatalogue} from './village-timber-supply';
import type {ResidentWorkplaceFrame} from '../characters/resident-workplace-frame';
import type {ResidentWorkstation,ResidentWorkstationObservation} from '../characters/resident-workstations';

import {buildSourceBuildingCatalogue} from './building-damage-catalogue';
import {createVillageBuildingDamage,settleVillageBuildingRaid,buildingDamageKey} from './building-damage';
import {createBuildingConflagration,stepBuildingConflagration} from './building-conflagration';
import {buildingFireIncidentId} from './building-disaster-session';
import {advanceBuildingDisasterProjection,type BuildingDisasterProjectionSource} from './building-disaster-projection';
import {EMPTY_OBSERVER_SAVE,parseObserverSave,serializeObserverSave,type ObserverSave} from './observer-save';
import type {ResidentBuildingEmergencyStation} from '../characters/resident-building-emergency';

const START=1800000000000,PACE=4000,INITIAL=600,WORLD='workplace-integration-unit-world-1',REV='workplace-integration-unit-v1',sha='a'.repeat(64);
const mason=population.residents.find(p=>p.id==='ealdholt-master-mason')!,PLACE='woodland-edge',STATION='unit-community-chop',SOURCE='unit-original-raw-pile';
const sourceIdentity='desktop:'+sha+':source-site',source={profile:'desktop' as const,sha256:sha,siteIdentity:sourceIdentity};
function freeze<T>(value:T):T{if(value&&typeof value==='object'&&!Object.isFrozen(value)){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;}
function accepted(result:VillagePopulationRuntimeResult):VillagePopulationRuntime{if(!result.ok)assert.fail(result.error);return result.snapshot;}
const bottom=(p:VillageSitePoint):VillageSitePoint=>[p[0],p[1]+.02,p[2]];

/** Entirely synthetic source-contract fixture. Actual published file IDs and
 * clip names satisfy the same strict metadata path as source qualification;
 * numeric envelopes/terrain assertions here are mocks, not real GLB evidence.
 * No scene, image, private model, teleport or forged completed job is used. */
function fixture(options:{contacts?:boolean;release?:boolean;fullyWeighted?:boolean;pose?:boolean}={}){
 const anchors=population.residents.map((person,i)=>{const p:VillageSitePoint=person.id===mason.id?[0,0,0]:[100+i*10,0,100];return{id:'unit-home-'+i,sourceActor:'unit-original-terrain',sourceGroundPoint:p,capsuleBottomPoint:bottom(p),standingOnly:true as const};});
 const home=anchors[population.residents.findIndex(p=>p.id===mason.id)],junction={id:'unit-junction',sourceActor:'unit-original-terrain',sourceGroundPoint:[3,0,0]as VillageSitePoint,capsuleBottomPoint:[3,.02,0]as VillageSitePoint,standingOnly:true as const};
 const route=(id:string,from:string,to:string,g:readonly VillageSitePoint[])=>({id,from,to,reversible:true as const,sourceGroundPolyline:g,capsuleBottomPolyline:g.map(bottom),lengthMetres:g.slice(1).reduce((n,p,i)=>n+Math.hypot(...p.map((v,k)=>v-g[i][k])),0)});
 const base=freeze({profile:'desktop',sourceSha256:sha,frame:'source-root-local-metres',capsule:{radius:.85,height:3.5},anchors:[...anchors,junction],routes:[route('unit-original-lane',home.id,junction.id,[home.sourceGroundPoint,junction.sourceGroundPoint])],placeBindings:[],residentPlaceBindings:population.residents.map((person,i)=>({residentId:person.id,placeId:person.homePlaceId,anchorId:anchors[i].id,status:'mapped-exterior'}))})as VillageSiteLayout;
 const neutral=requiredVillageWorkplaceMotionClips(mason.id),clips=Object.fromEntries(neutral.map(name=>[name,{radiusMetres:.4,heightMetres:1.2,minimumBodyYMetres:-.01,placedBelowGround:false}]));
 const motion=parsePopulationMotionEvidence({schemaVersion:1,method:'cpu-sampled-skin-and-props-v1',fps:60,paddingMetres:.05,residents:{[mason.id]:{levels:{crowd:{files:{...files},clips}}}}});
 const p:VillageSitePoint=[6,0,3],anchor={id:'unit-timber-stand',sourceActor:'unit-original-terrain',sourceGroundPoint:p,capsuleBottomPoint:bottom(p),standingOnly:true as const};
 const cap=parseVillageSiteWorkplaceRoutes([{id:'unit-community-route',residentId:mason.id,purpose:'community-timber',placeId:PLACE,anchorId:anchor.id,sourceActor:anchor.sourceActor,certificateSha256:'b'.repeat(64),body:{radius:.67,height:2.1,margin:.005,lift:.02,zeroCrossfade:true},proof:{sourceSha256:sha,profile:'desktop',siteIdentity:'unit-source-artifact',sourceGroundPoint:p,capsuleBottomPoint:bottom(p),originalTriangleClearance:true,wholeFootprintSupported:true,sweptIdleAndWalkClear:true,publicExteriorOnly:true,motionEvidence:motion},topology:{anchor,route:route('unit-work-connector',junction.id,anchor.id,[junction.sourceGroundPoint,[3,0,3],p])}}])[0] as VillageSiteWorkplaceRoute;
 const site=freeze({...base,workplaceRoutes:[cap]});
 const measurement={radiusMetres:1.3,heightMetres:2.6,minimumBodyYMetres:0,placedBelowGround:false},marker='unit-authored-chop-contact',contactPoint:VillageSitePoint=[6,1,3];
 const station=freeze({station:{id:STATION,residentId:mason.id,placeId:PLACE,anchorId:anchor.id,source,clip:'work_chop_wood',certificateSha256:'c'.repeat(64),durationWorldMinutes:1,proof:{originalTriangleClearance:true,wholeFootprintSupported:true,sweptClipAndPropsClear:true,contactSourceActor:'unit-original-chopping-block'}},resourceId:'unit-shared-block',standPosition:p,yawRadians:Math.PI/2,maximumStandDistanceMetres:.05,maximumFacingErrorRadians:.05,contactPoint,maximumToolContactDistanceMetres:.05,markerIds:[marker]} satisfies ResidentWorkstation);
 const timberCatalogue=parseVillageTimberCatalogue({sources:[{id:SOURCE,profile:'desktop',sourceSha256:sha,siteIdentity:sourceIdentity,sourceActor:'unit-original-raw-pile',sourceInstance:'node:1298',transformSha256:'d'.repeat(64),certificateSha256:'e'.repeat(64),rawUnits:1,timberPerUnit:12}],operations:[{sourceId:SOURCE,residentId:mason.id,stationId:STATION,placeId:PLACE,stationCertificateSha256:'c'.repeat(64),clip:'work_chop_wood',contactSourceActor:'unit-original-chopping-block',requiredWorldMinutes:1}]});
 const observations:{at:number;phase:string;elapsed:number;contact:boolean;released:boolean}[]=[];
 const frame:ResidentWorkplaceFrame={source,catalog:[station],timberCatalogue,presentation:[{stationId:STATION,certificateSha256:'c'.repeat(64),body:{radius:1.35,height:2.65,margin:.005,lift:.02},clipMeasurement:measurement,clipMeasurements:{work_chop_wood_enter:measurement,work_chop_wood:measurement,work_chop_wood_exit:measurement},files:{...files}}],assignments:[{id:'unit-material-subtask',residentId:mason.id,placeId:PLACE,routeId:cap.id,sourceId:SOURCE,activity:'Prepares finite timber for the village repairs.',stockTargetTimber:12}],
  observe(context,entry,timing):ResidentWorkstationObservation|null{
   if(!entry||!context.queue)return null;assert.equal(timing.millisecondsPerWorldMinute,PACE);
   const phase=context.queue.current!,elapsed=(context.absoluteMinute-(entry.phaseStartedAtMinute??entry.lease.sinceMinute))*timing.millisecondsPerWorldMinute/1000;
   const performing=phase==='perform',releasing=phase==='release',released=releasing&&elapsed>=1.6&&options.release!==false,contact=performing&&elapsed>=1.12&&options.contacts!==false;
   const activeClip=released?'idle_a':releasing?'work_chop_wood_exit':performing?'work_chop_wood':'work_chop_wood_enter';
   observations.push({at:context.absoluteMinute,phase,elapsed,contact,released});
   return{residentId:mason.id,jobId:context.queue.jobId,stationId:STATION,atMinute:context.absoluteMinute,source,stationCertificateSha256:'c'.repeat(64),position:p,yawRadians:Math.PI/2,poseSourceQualified:options.pose!==false,fullyWeighted:options.fullyWeighted!==false&&elapsed>=.8,activeClip,
    contact:contact?{event:{ownerId:mason.id,requestId:100+Number(entry.lease.id.split(':')[1]),motion:'work',clipId:'work_chop_wood',kind:'marker',state:'playing',seconds:1.12,loop:Math.floor(elapsed/2),hold:'none',markerId:marker,markerName:'chop-contact',markerKind:'contact'},toolPoint:contactPoint,targetPoint:contactPoint,contactSourceActor:'unit-original-chopping-block'}:null,equipmentReleased:released};
  }};
 return{base,site,cap,frame,observations};
}
function create(){return accepted(createVillagePopulationRuntime({population,confirmedEntry:true,worldKey:WORLD,contentRevision:REV,createdAt:START,initialDayMinute:INITIAL,millisecondsPerWorldMinute:PACE,walkingSpeedMetresPerSecond:1}));}
// The source-contract fixture above is deliberately synthetic. This additional
// fixture measures reducer integration and persistence, never real geometry.
const buildingCatalogue=buildSourceBuildingCatalogue({sourceSha256:sha,profile:'desktop',parts:[
 {id:'unit-ruin-door',kind:'door',bounds:{min:[1000,0,0],max:[1004,2,.2]}},
 {id:'unit-ruin-wall',kind:'wall',bounds:{min:[1000,0,3],max:[1004,2,3.2]}},
 {id:'unit-ruin-roof',kind:'roof',bounds:{min:[999.8,2,-.2],max:[1004.2,2.4,3.4]}}]});
const ruinedBuilding=buildingCatalogue.buildings[0];
function ruinedObserver():ObserverSave{
 const outcome={worldKey:WORLD,raidId:'raid-500-0',startMinute:500,settledMinute:500,outcome:'burned' as const,binding:ruinedBuilding.binding,targetLabel:'Synthetic projection fixture'};
 const fire=stepBuildingConflagration(createBuildingConflagration({worldKey:WORLD,absoluteMinute:500,seed:WORLD,buildings:buildingCatalogue.buildings}),{absoluteMinute:600,damageOutcome:outcome,weather:Array.from({length:100},(_,minute)=>({atMinute:500+minute,rain:0,windX:0,windZ:0}))}).state;
 assert.ok(fire.buildings.every(b=>b.phase!=='burning'));
 return{...EMPTY_OBSERVER_SAVE,offsetMilliseconds:23,speed:1,entries:[{id:'unit-memory',minute:590,kind:'life',text:'A preserved local entry.'}],memories:{[mason.id]:[{key:'unit-memory',minute:590,text:'A preserved resident memory.'}]},raidSerial:1,
  realm:{...EMPTY_OBSERVER_SAVE.realm,resolvedMinute:600},buildingDamage:{status:'valid',state:settleVillageBuildingRaid(createVillageBuildingDamage(WORLD,500),outcome,600)},buildingFire:{status:'valid',state:fire},
  raidCursor:{status:'valid',state:{kind:'observer-raid-cursor',schemaVersion:1,worldKey:WORLD,resolvedMinute:600}}};
}
function projectionSource(f:ReturnType<typeof fixture>):BuildingDisasterProjectionSource{
 const repair=(saved:ObserverSave):ResidentBuildingEmergencyStation[]=>{
  const fire=saved.buildingFire?.status==='valid'?saved.buildingFire.state.buildings.find(b=>b.binding.buildingId===ruinedBuilding.binding.buildingId):null,incident=fire&&buildingFireIncidentId(fire);if(!incident)return[];
  return[{id:'unit-projection-repair',disasterId:incident,residentId:mason.id,placeId:mason.workPlaceId,anchorId:'unit-source-repair-anchor',kind:'repair',buildingKey:buildingDamageKey(ruinedBuilding.binding),sourceActor:'unit-original-ground',contactPoint:[1006,1,0],yawRadians:0,clip:'work_chisel',operationWorldMinutes:1,waterUnits:1,
   proof:{sourceSha256:sha,profile:'desktop',siteIdentity:sourceIdentity,originalTriangleClearance:true,wholeFootprintSupported:true,sweptClipAndPropsClear:true,contactSourceActor:'unit-original-ruined-wall',maximumContactDistanceMetres:1,clip:'work_chisel'}}];
 };
 return{site:f.site,buildings:buildingCatalogue.buildings,workplaceFrame:f.frame,repairStationsAt:repair,
  frameAt(saved,at){const fire=saved.buildingFire?.status==='valid'?saved.buildingFire.state.buildings:[];
   return{siteIdentity:sourceIdentity,buildings:buildingCatalogue.buildings,incidents:fire.filter(b=>b.ignition&&b.phase!=='sound').map(b=>({id:buildingFireIncidentId(b)!,binding:b.binding,burning:b.phase==='burning',requiresRepair:b.phase!=='burning',observedAbsoluteMinute:at,expiresAbsoluteMinute:at+1000,knownByResidentIds:[],affectedResidentIds:[]})),stations:[],shelterPlaceIds:[],obstacles:[],repairOrders:saved.localRebuildOrders?.status==='valid'?saved.localRebuildOrders.state.orders:[]};}};
}
function project(saved:ObserverSave,c:VillagePopulationRuntime,at:number,source:BuildingDisasterProjectionSource,budget=60){return advanceBuildingDisasterProjection(saved,{...source,canonical:c,requestedMilliseconds:(at-INITIAL)*PACE,sites:buildingCatalogue.sites.map(b=>({index:b.binding.siteIndex,bearing:b.bearing,buildingBinding:b.binding})),maxWorldMinutes:budget});}
function roundSave(saved:ObserverSave){return parseObserverSave(serializeObserverSave(saved),WORLD);}
function funded(saved:ObserverSave){
 assert.equal(saved.buildingEmergency?.status,'valid');assert.equal(saved.localRebuildOrders?.status,'valid');
 if(saved.buildingEmergency?.status!=='valid'||saved.localRebuildOrders?.status!=='valid')assert.fail('Expected funded physical checkpoint and local order.');
 const stock=saved.buildingEmergency.state.timberSupply!;
 assert.equal(stock.producedTimber,12);assert.equal(stock.allocatedTimber,12);assert.equal(stock.availableTimber,0);assert.equal(stock.sources[0].remainingUnits,0);assert.equal(stock.allocations.length,1);assert.equal(stock.workWatermarks.length,1);
 assert.equal(saved.localRebuildOrders.state.orders.length,1);assert.equal(saved.localRebuildOrders.state.orders[0].reservedTimber,12);assert.equal(saved.localRebuildOrders.state.orders[0].deliveredTimber,0);assert.equal(saved.buildingDamage?.status==='valid'?saved.buildingDamage.state.timber:-1,0);
}

test('projection commits actual earned timber and one automatic order atomically, preserving metadata through JSON reload and replay',()=>{
 const f=fixture(),src=projectionSource(f),canonical=create(),initial=ruinedObserver(),before=serializeVillagePopulationRuntime(canonical);
 const whole=project(initial,canonical,620,src);assert.equal(whole.status,'ready',whole.error??'');funded(whole.save);
 let save=initial;for(let at=600;at<=620;at++){const next=project(roundSave(save),canonical,at,src);assert.equal(next.status,'ready',next.error??'');save=next.save;}
 assert.deepEqual(roundSave(save),roundSave(whole.save));
 for(let repeat=0;repeat<3;repeat++){const again=project(roundSave(save),canonical,620,src);assert.equal(again.status,'ready',again.error??'');funded(again.save);save=again.save;}
 assert.deepEqual(save.entries,initial.entries);assert.deepEqual(save.memories,initial.memories);assert.equal(save.offsetMilliseconds,23);assert.equal(save.speed,initial.speed);
 assert.deepEqual(serializeVillagePopulationRuntime(canonical),before);assert.equal(whole.snapshot&&serializeVillagePopulationRuntime(whole.snapshot).ok,false,'Observer metadata survives the allocated snapshot; it cannot be saved as a canonical world.');
 assert.deepEqual(whole.checkpoint,whole.save.buildingEmergency?.status==='valid'?whole.save.buildingEmergency.state:null);
});

test('failed post-work funding frame retains the preceding complete transaction and a retry spends earned raw material once',()=>{
 const f=fixture(),src=projectionSource(f),canonical=create(),initial=ruinedObserver(),before=project(initial,canonical,607,src);assert.equal(before.status,'ready',before.error??'');
 const broken={...src,repairStationsAt(saved:ObserverSave,at:number){if(at===608)throw Error('unit-detached-repair-source');return src.repairStationsAt!(saved,at);}};
 const held=project(roundSave(before.save),canonical,620,broken);assert.equal(held.status,'blocked');assert.match(held.error??'',/unit-detached-repair-source/);assert.equal(held.processedMinute,607);
 assert.equal(held.checkpoint?.timberSupply?.availableTimber,0);assert.equal(held.checkpoint?.timberSupply?.sources[0].remainingUnits,1);assert.equal(held.save.localRebuildOrders?.status==='valid'?held.save.localRebuildOrders.state.orders.length:0,0);
 const retry=project(roundSave(held.save),canonical,620,src);assert.equal(retry.status,'ready',retry.error??'');funded(retry.save);
 const direct=project(initial,canonical,620,src);assert.deepEqual(roundSave(retry.save),roundSave(direct.save));
});
