import {Group,type Object3D} from 'three';
import type {CrowdLoaderPort} from './characters/crowd-residents';
import type {BuildingEmergencySites} from './building-emergency-sites';
import {createWoodWorkplaceAnimation,WOOD_WORK_CLIP,type WoodWorkplaceAnimation} from './ordinary-work-animation';
import {EALDHOLT_WOOD_WORKPLACE_CANDIDATE as proposal} from '../../../../shared/legacy/aethelgard/characters/ealdholt-wood-workplace-candidate';
import {copyObserverJSON} from '../../../../shared/legacy/aethelgard/observer/observer-json';
import {parseVillageSiteWorkplaceRoutes} from '../../../../shared/legacy/aethelgard/characters/village-workplace-routes';
import {type VillageSiteLayout} from '../../../../shared/legacy/aethelgard/characters/village-site';
import type {ResidentWorkplaceFrame} from '../../../../shared/legacy/aethelgard/characters/resident-workplace-frame';
import {parseResidentWorkstationCatalog,type ResidentWorkstation} from '../../../../shared/legacy/aethelgard/characters/resident-workstations';
import {parseVillageTimberCatalogue,type VillageTimberSupply} from '../../../../shared/legacy/aethelgard/observer/village-timber-supply';
import type {ResidentActionSource} from '../../../../shared/legacy/aethelgard/characters/resident-action-queue';
import {EALDHOLT_VILLAGE_POPULATION} from '../../../../shared/legacy/aethelgard/characters/village-population';
import {EALDHOLT_POPULATION_ASSET_SHA256} from '../../../../shared/legacy/aethelgard/characters/population-asset-integrity';

export interface PrepareVillageWorkplacesInput {
 readonly sites:BuildingEmergencySites;readonly siteIdentity:string;readonly sourceRoot:Object3D;
 readonly loader:CrowdLoaderPort;readonly characterAssetRoot:string;readonly signal?:AbortSignal;
}
export interface VillageWorkplaces {
 readonly object:Group;readonly site:VillageSiteLayout;readonly frame:ResidentWorkplaceFrame;
 readonly diagnostics:{readonly sourceActor:string;readonly routeKnots:number;readonly inputUnits:1;readonly yieldTimber:12};
 syncSupply(supply:VillageTimberSupply):void;dispose():void;
}
const RESIDENT='ealdholt-master-mason',SOURCE='ealdholt-original-woodpile-batch-v1',STATION='ealdholt-community-wood-processing-v1',ROUTE='ealdholt-community-mason-wood-access-v1',ANCHOR='ealdholt-community-mason-wood-stand-v1';
async function digest(value:unknown):Promise<string>{const bytes=new TextEncoder().encode(JSON.stringify(value)),hash=await crypto.subtle.digest('SHA-256',bytes);return Array.from(new Uint8Array(hash),v=>v.toString(16).padStart(2,'0')).join('');}
const close=(a:readonly number[],b:readonly number[],epsilon=1e-8)=>a.length===b.length&&a.every((n,i)=>Math.abs(n-b[i])<=epsilon);
/** Admit a small, person-bound community workcell in the existing landscape.
 * The existing raw pile supplies finite gameplay input. Its decorative mesh
 * creates no inventory; only a completed, physically guarded job earns timber. */
export async function prepareVillageWorkplaces(input:PrepareVillageWorkplacesInput):Promise<VillageWorkplaces|null>{
 const site=input.sites.site;if(site.profile!=='desktop'||site.sourceSha256!==proposal.sourceSha256)return null;
 if(input.siteIdentity!==proposal.siteSha256)throw Error('Ordinary workplace source artifact differs.');
 const candidate=copyObserverJSON(proposal)as typeof proposal,person=EALDHOLT_VILLAGE_POPULATION.residents.find(r=>r.id===RESIDENT)!;
 const{certificateSha256:certificate,...certified}=candidate;if(await digest(certified)!==certificate)throw Error('Workplace candidate certificate differs from its complete source contract.');
 {
  // Original home connectivity is checked against the untouched graph.
  const home=site.residentPlaceBindings.find(r=>r.residentId===person.id&&r.placeId===person.homePlaceId)?.anchorId,seen=new Set(home?[home]:[]),queue=home?[home]:[];
  for(let i=0;i<queue.length;i++)for(const edge of site.routes){const next=edge.from===queue[i]?edge.to:edge.reversible&&edge.to===queue[i]?edge.from:null;if(next&&!seen.has(next)){seen.add(next);queue.push(next);}}
  if(!seen.has(candidate.fromAnchorId))throw Error('Community timber route is disconnected from the resident original home.');
 }
 const actors=input.sites.sourceActors(candidate.rawSource.sourceActor),raw=actors.find(row=>row.sourceOrdinal===candidate.rawSource.sourceOrdinal);
 // GLTFLoader decomposes/recomposes node matrices; its last floating bit can
 // differ from the authored matrix. Keep the raw-byte-pinned transform as the
 // durable identity, while checking the loaded instance at numerical precision.
 if(!raw||!close(raw.sourceWorldMatrix,candidate.rawSource.sourceWorldMatrix,1e-12)||await digest(candidate.rawSource.sourceWorldMatrix)!==candidate.rawSource.transformSha256)throw Error('The finite input pile is not its exact original instance/transform.');
 const proof=await input.sites.qualifySourceOperation({routePoints:candidate.routePoints,routeBody:candidate.routeBody,workPoint:candidate.workPoint,workBody:candidate.workBody,expectedGroundActor:candidate.groundActor},{signal:input.signal});
 const recovery=candidate.recoveryApproach,refuge=site.emergencyRefuges?.find(row=>row.id===recovery.refugeId&&row.residentId===RESIDENT&&row.certificateSha256===recovery.certificateSha256);
 if(!refuge||refuge.anchorId!==recovery.fromAnchorId||!close(refuge.proof.sourceGroundPoint,recovery.sourceGroundPoint,1e-12)||refuge.proof.siteIdentity!==input.siteIdentity)throw Error('Recovery work must start at the exact qualified original refuge.');
 await input.sites.qualifySourceOperation({routePoints:recovery.routePoints,routeBody:candidate.routeBody,workPoint:candidate.workPoint,workBody:candidate.workBody,expectedGroundActor:candidate.groundActor},{signal:input.signal});
 if(input.signal?.aborted)throw Error('Workplace preparation cancelled.');
 let animation:WoodWorkplaceAnimation|null=null;
 try{
  const source:ResidentActionSource=Object.freeze({profile:site.profile,sha256:site.sourceSha256,siteIdentity:site.profile+':'+site.sourceSha256+':'+(site.navigationRevision??'source-site')});
  animation=await createWoodWorkplaceAnimation({loader:input.loader,assetRoot:input.characterAssetRoot,source,standPosition:candidate.workPoint,yawRadians:0,residentId:RESIDENT,communityTimberPreparation:true});
  if(input.signal?.aborted)throw Error('Workplace preparation cancelled.');
  for(const[path,sha]of Object.entries(candidate.workFiles))if(EALDHOLT_POPULATION_ASSET_SHA256[path]!==sha||animation.files[path]!==sha)throw Error('Work operation assets differ from the actual measured proposal.');
  for(const[name,expected]of Object.entries(candidate.workClipMeasurements)){const actual=animation.clipMeasurements[name];if(!actual||!close([actual.radiusMetres,actual.heightMetres,actual.minimumBodyYMetres],[expected.radiusMetres,expected.heightMetres,expected.minimumBodyYMetres])||actual.placedBelowGround!==expected.placedBelowGround||actual.minimumBodyYMetres<-.005)throw Error('Actual work skin/props/ground measurement differs.');}
  if(!close(animation.contactPoint,candidate.workContactPoint))throw Error('Authored axe/finite-input contact differs from original published triangles.');
  const routePoints=candidate.routePoints,bottom=routePoints.map(p=>Object.freeze([p[0],p[1]+candidate.routeBody.lift,p[2]])as readonly[number,number,number]),length=routePoints.slice(1).reduce((sum,p,i)=>sum+Math.hypot(...p.map((n,k)=>n-routePoints[i][k])),0);
  const recoveryPoints=recovery.routePoints,recoveryBottom=recoveryPoints.map(p=>Object.freeze([p[0],p[1]+candidate.routeBody.lift,p[2]])as readonly[number,number,number]),recoveryLength=recoveryPoints.slice(1).reduce((sum,p,i)=>sum+Math.hypot(...p.map((n,k)=>n-recoveryPoints[i][k])),0);
  const capability=parseVillageSiteWorkplaceRoutes([{id:ROUTE,purpose:'community-timber',residentId:RESIDENT,placeId:'woodland-edge',anchorId:ANCHOR,sourceActor:proof.groundActor,certificateSha256:candidate.certificateSha256,body:{...candidate.routeBody,zeroCrossfade:true},
   recoveryApproach:{refugeId:recovery.refugeId,certificateSha256:recovery.certificateSha256,route:{id:ROUTE+'-recovery',from:recovery.fromAnchorId,to:ANCHOR,reversible:true,sourceGroundPolyline:recoveryPoints,capsuleBottomPolyline:recoveryBottom,lengthMetres:recoveryLength}},
   proof:{sourceSha256:site.sourceSha256,profile:site.profile,siteIdentity:input.siteIdentity,sourceGroundPoint:candidate.workPoint,capsuleBottomPoint:[candidate.workPoint[0],candidate.workPoint[1]+.02,candidate.workPoint[2]],originalTriangleClearance:true,wholeFootprintSupported:true,sweptIdleAndWalkClear:true,motionEvidence:candidate.neutralMotionEvidence,publicExteriorOnly:true},
   topology:{anchor:{id:ANCHOR,sourceActor:proof.groundActor,sourceGroundPoint:candidate.workPoint,capsuleBottomPoint:[candidate.workPoint[0],candidate.workPoint[1]+.02,candidate.workPoint[2]],standingOnly:true},route:{id:ROUTE,from:candidate.fromAnchorId,to:ANCHOR,reversible:true,sourceGroundPolyline:routePoints,capsuleBottomPolyline:bottom,lengthMetres:length}}}])[0];
  const catalog:readonly ResidentWorkstation[]=Object.freeze([{resourceId:SOURCE,station:{id:STATION,residentId:RESIDENT,placeId:'woodland-edge',anchorId:ANCHOR,source,clip:WOOD_WORK_CLIP,certificateSha256:candidate.certificateSha256,durationWorldMinutes:1,proof:{originalTriangleClearance:true,wholeFootprintSupported:true,sweptClipAndPropsClear:true,contactSourceActor:'prop_kindling_bundle'}},standPosition:candidate.workPoint,yawRadians:0,maximumStandDistanceMetres:.02,maximumFacingErrorRadians:.04,contactPoint:animation.contactPoint,maximumToolContactDistanceMetres:.02,markerIds:animation.markerIds}]);parseResidentWorkstationCatalog(catalog,source);
  const timberCatalogue=parseVillageTimberCatalogue({sources:[{id:SOURCE,profile:site.profile,sourceSha256:site.sourceSha256,siteIdentity:source.siteIdentity,sourceActor:raw.sourceActor,sourceInstance:'source-ordinal:'+raw.sourceOrdinal,transformSha256:candidate.rawSource.transformSha256,certificateSha256:candidate.certificateSha256,rawUnits:1,timberPerUnit:12}],operations:[{sourceId:SOURCE,residentId:RESIDENT,stationId:STATION,placeId:'woodland-edge',stationCertificateSha256:candidate.certificateSha256,clip:WOOD_WORK_CLIP,contactSourceActor:'prop_kindling_bundle',requiredWorldMinutes:1}]});
  const work=animation,object=new Group();object.name='EaldholtSourceQualifiedWorkplaces';object.add(work.object);let disposed=false;const originalVisible=raw.node.visible;
  const frame:ResidentWorkplaceFrame=Object.freeze({source,catalog,timberCatalogue,routeCertificates:Object.freeze({[ROUTE]:capability.certificateSha256}),presentation:Object.freeze([{stationId:STATION,certificateSha256:candidate.certificateSha256,body:candidate.workBody,clipMeasurement:work.clipMeasurements[WOOD_WORK_CLIP],clipMeasurements:work.clipMeasurements,files:work.files}]),
   assignments:Object.freeze([{id:'ealdholt-community-timber-preparation-v1',residentId:RESIDENT,placeId:'woodland-edge',routeId:ROUTE,sourceId:SOURCE,activity:'Prepares finite village timber for rebuilding.',stockTargetTimber:12,when:'reconstruction-needed' as const}]),
   observe(context:Parameters<NonNullable<ResidentWorkplaceFrame['observe']>>[0],entry:Parameters<NonNullable<ResidentWorkplaceFrame['observe']>>[1],timing:Parameters<NonNullable<ResidentWorkplaceFrame['observe']>>[2]){return disposed||!entry?null:work.observe(context,entry,catalog[0],timing.millisecondsPerWorldMinute);}});
  return{object,site:Object.freeze({...site,workplaceRoutes:Object.freeze([...(site.workplaceRoutes??[]),capability])}),frame,diagnostics:Object.freeze({sourceActor:raw.sourceActor,routeKnots:routePoints.length,inputUnits:1,yieldTimber:12}),
   syncSupply(supply){if(disposed)return;const stock=supply.sources.find(row=>row.id===SOURCE&&row.sourceSha256===site.sourceSha256&&row.transformSha256===candidate.rawSource.transformSha256);const available=!stock||stock.remainingUnits>0;raw.node.visible=originalVisible&&available;work.setInputVisible(available);},
   dispose(){if(disposed)return;disposed=true;raw.node.visible=originalVisible;work.dispose();object.removeFromParent();object.clear();}};
 }catch(error){animation?.dispose();throw error;}
}
