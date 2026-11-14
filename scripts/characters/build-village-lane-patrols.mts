// @ts-nocheck
/** Private, opt-in patrol source authoring. Existing graph coordinates, GLB
 * bytes, original place allocations and all saved worlds remain untouched. */
import fs from 'node:fs';
import crypto from 'node:crypto';
import {resolve} from 'node:path';
import {parseArgs} from 'node:util';
import {pathToFileURL} from 'node:url';
import {EALDHOLT_VILLAGE_POPULATION as population} from '../../shared/legacy/aethelgard/characters/village-population.ts';
import {createEaldholtVillageSite,resolveVillageSiteEndpoint,resolveVillageSitePath,validateVillageSiteRigidClearance,applyVillageSiteRigidClearance} from '../../shared/legacy/aethelgard/characters/village-site.ts';
import {measureReleasedVillageGeometry,privateSourceOutput,RELEASED_SOURCE_SHA256} from './village-source-authoring.mts';
import {segmentDistance} from './village-source-geometry.mts';

/** Authored lane turns, selected from source graph stands. None is a door,
 * home, invented well/courtyard, or a replay of a resident's home commute. */
export const LANE_PATROL_AUTHORS=Object.freeze([
 {residentId:'ealdholt-spearman-husband',id:'spearman-lane-patrol-v1',anchors:{desktop:['candidate-v1-well-1-320-9','source-lane-patrol-interior-turn-v1'],quest:['candidate-v1-grid-4-36','candidate-v1-grid-4-39']},routineAnchor:{quest:'candidate-v1-grid-3-36'}},
 {residentId:'ealdholt-garrison-spearman',id:'garrison-lane-patrol-v1',anchors:{desktop:['candidate-v1-grid-4-36','candidate-v1-grid-4-40'],quest:['candidate-v1-grid-4-40','candidate-v1-grid-4-43']}},
]);
export const LANE_PATROL_LINK_AUTHORS=Object.freeze([
 {profile:'desktop',id:'source-lane-patrol-link-v1',from:'candidate-v1-well-1-320-9',to:'candidate-v1-well-1-720-11',interiorTurn:{id:'source-lane-patrol-interior-turn-v1',distanceBeforeEndMetres:1.8}},
]);
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function doorDistance(a,b,door){
 const x0=door.min[0],x1=door.max[0],z0=door.min[2],z1=door.max[2];
 if([a,b].some(p=>p[0]>=x0&&p[0]<=x1&&p[2]>=z0&&p[2]<=z1))return 0;
 const corners=[[x0,0,z0],[x1,0,z0],[x1,0,z1],[x0,0,z1]];
 return Math.min(...corners.map((p,i)=>segmentDistance(a,b,p,corners[(i+1)%4])));
}
export async function buildVillageLanePatrols(values){
 if(!['desktop','quest'].includes(values.profile)||!values['source-model']||!values['base-site']||!values['output-dir'])throw Error('Provide --profile desktop|quest --source-model ORIGINAL.glb --base-site final-source-site.json --output-dir PRIVATE_NEW_DIRECTORY.');
 const out=privateSourceOutput(values['output-dir']),name=`${values.profile}-guard-lane-patrol-v1.json`,reportName=`${values.profile}-guard-lane-patrol-v1-proof.json`;
 if(fs.existsSync(resolve(out,name))||fs.existsSync(resolve(out,reportName)))throw Error('Choose an unused private candidate output; never overwrite a source package.');
 const profile=values.profile,expected=RELEASED_SOURCE_SHA256[profile],baseBytes=fs.readFileSync(values['base-site']),base=JSON.parse(baseBytes.toString()),before=hash(baseBytes),sourceBytes=fs.readFileSync(values['source-model']);
 if(hash(sourceBytes)!==expected)throw Error('The exact original released GLB is required.');
 let site=createEaldholtVillageSite({profile,modelSha256:expected,binding:base.binding,certificate:base.certificate,placeBindings:base.placeBindings,residentPlaceBindings:base.residentPlaceBindings});
 if(site.navigationRevision||site.patrols)throw Error('Start from an unchanged final source allocation without patrols.');
 const started=performance.now(),limit=Number(values['max-ms']??180000);if(!Number.isSafeInteger(limit)||limit<1000||limit>600000)throw Error('Use a bounded source measurement budget.');
 const budget=()=>{if(performance.now()-started>limit)throw Error('Patrol original-source measurement budget exceeded.');};
 const measured=await measureReleasedVillageGeometry(values['source-model'],profile,expected,budget,site.capsule.height);
 try{
  const plans=[],bindings=[...base.residentPlaceBindings],proofs=[],routineBindings=[];
  const binding=JSON.parse(JSON.stringify(base.binding)),certificate=JSON.parse(JSON.stringify(base.certificate)),rigid=JSON.parse(JSON.stringify(base.rigidSourceClearance)),addedLinks=[];
  const doors=measured.doors.filter(d=>Math.min(d.max[0]-d.min[0],d.max[2]-d.min[2])<=1.1&&Math.max(d.max[0]-d.min[0],d.max[2]-d.min[2])<=5&&d.max[1]-d.min[1]>=1.2);
  fs.mkdirSync(out,{recursive:true,mode:0o700});
  fs.writeFileSync(resolve(out,`${profile}-source-lane-door-measurements.json`),JSON.stringify({source:expected,doors,stands:site.anchors.filter(a=>!a.id.includes('-door-')).map(a=>({id:a.id,point:a.sourceGroundPoint,minimumDoorFootprintDistanceMetres:Math.min(...doors.map(d=>doorDistance(a.sourceGroundPoint,a.sourceGroundPoint,d)))}))},null,2),{mode:0o600});
  function check(points,excludeDoorApproach){
   let edge=Infinity,slope=0,doorGap=Infinity;
   for(let i=0;i<points.length;i++){
    budget();const a=points[Math.max(0,i-1)],b=points[i],support=measured.oracle.support(a,b);
    if(!support||!measured.oracle.solidClear(a,b)||!measured.oracle.solidClear(a,b,true))throw Error(`Original rigid/overhead/full-footprint proof failed at segment ${i}.`);
    edge=Math.min(edge,support.edge);slope=Math.max(slope,support.slope);
    for(const d of doors)doorGap=Math.min(doorGap,doorDistance(a,b,d));
   }
   const minimumDoorCentrelineGap=site.capsule.radius+.005+1;
   if(excludeDoorApproach&&doorGap<minimumDoorCentrelineGap)throw Error(`Patrol must remain outside doorway approaches: ${doorGap} < ${minimumDoorCentrelineGap}.`);
   return{fullFootprintSupported:true,allOriginalRigidSolidsClear:true,originalRoofOverheadClear:true,minimumGroundBoundaryMetres:edge,maximumSlope:slope,minimumDoorFootprintDistanceMetres:doorGap,minimumRequiredDoorFootprintDistanceMetres:excludeDoorApproach?minimumDoorCentrelineGap:null};
  }
  const links=LANE_PATROL_LINK_AUTHORS.filter(l=>l.profile===profile);
  if(links.length){
   if(!values['recast-root'])throw Error('The explicit additional lane requires --recast-root with the existing source-authoring toolchain.');
   const load=p=>import(pathToFileURL(resolve(values['recast-root'],p)).href);
   const [{init,NavMeshQuery},{generateSoloNavMesh}]=await Promise.all([load('@recast-navigation/core/dist/index.mjs'),load('@recast-navigation/generators/dist/index.mjs')]);await init();
   const settings={cs:.1,ch:.025,walkableSlopeAngle:35,walkableHeight:Math.ceil(site.capsule.height/.025),walkableClimb:4,walkableRadius:9,minRegionArea:4,mergeRegionArea:20};
   const nav=generateSoloNavMesh(new Float32Array(measured.ground),new Uint32Array(Array.from({length:measured.ground.length/3},(_,i)=>i)),settings);if(!nav.success)throw Error('Original ground Recast generation failed.');
   const query=new NavMeshQuery(nav.navMesh),vector=p=>({x:p[0],y:p[1],z:p[2]});
   function registerLink(id,a,b,line){
    budget();const geometry=check(line,true),reverseGeometry=check([...line].reverse(),true);
    const start=query.findClosestPoint(vector(a.sourceGroundPoint)),end=query.findClosestPoint(vector(b.sourceGroundPoint));
    if(!start.success||!end.success||Math.hypot(start.point.x-a.sourceGroundPoint[0],start.point.z-a.sourceGroundPoint[2])>.15||Math.hypot(end.point.x-b.sourceGroundPoint[0],end.point.z-b.sourceGroundPoint[2])>.15)throw Error('Recast cannot cover the exact declared lane endpoints.');
    const path=query.findPath(start.polyRef,end.polyRef,start.point,end.point),refs=Array.from(path.polys.getHeapView()),complete=path.success&&path.status===1073741824&&refs.at(-1)===end.polyRef;path.polys.destroy();const ray=query.raycast(start.polyRef,start.point,end.point);
    if(!complete||!ray.success||ray.t<1)throw Error('The declared lane needs a complete, unobstructed Recast corridor.');
    const body=line.map(p=>[p[0],p[1]+.02,p[2]]),lengthMetres=line.slice(1).reduce((n,p,i)=>n+Math.hypot(...p.map((v,k)=>v-line[i][k])),0);
    binding.routes[id]={from:a.id,to:b.id,reversible:true,sourceGroundPolyline:line,capsuleBottomPolyline:body,lengthMetres,corridorRefs:refs};
    certificate.routes.push({from:a.id,to:b.id,sourceGroundPolyline:line,capsuleBottomPolyline:body,lengthMetres,corridor:refs,partialPathAccepted:false,findPathStatus:1073741824,allSourceSolidEnvelopesClear:true,groundWholeFootprintSupported:true,waterAndInteriorsExcluded:true,groundEdgeClearanceLowerBound:geometry.minimumGroundBoundaryMetres-measured.topology.evidence.maximumMeasuredEndpointDeltaMetres,slopeLipschitzUpperBound:geometry.maximumSlope,capsuleBottomLiftMetres:.02});
    rigid.routes.push({routeId:id,qualified:true});addedLinks.push({id,...binding.routes[id],geometry,reverseGeometry,recastSettings:settings,recastStatus:1073741824});return lengthMetres;
   }
   try{for(const spec of links){
    budget();const a=site.anchors.find(a=>a.id===spec.from),b=site.anchors.find(a=>a.id===spec.to);if(!a||!b)throw Error('Declared lane link lacks an original source stand.');
    const measuredLeg=measured.oracle.leg(a.sourceGroundPoint,b.sourceGroundPoint);if(!measuredLeg)throw Error('The one declared long lane failed original solid/roof/full-footprint projection.');
    const line=measuredLeg.points.map(p=>[...p]);
    if(Math.hypot(...line[0].map((n,i)=>n-a.sourceGroundPoint[i]))>.00002||Math.hypot(...line.at(-1).map((n,i)=>n-b.sourceGroundPoint[i]))>.00002)throw Error('New lane endpoints differ from original reached stands.');
    line[0]=[...a.sourceGroundPoint];line[line.length-1]=[...b.sourceGroundPoint];const length=registerLink(spec.id,a,b,line);
    if(spec.interiorTurn){
     const distance=length-spec.interiorTurn.distanceBeforeEndMetres;let at=0,index=1;
     for(;index<line.length;index++){const span=Math.hypot(...line[index].map((n,k)=>n-line[index-1][k]));if(at+span>=distance)break;at+=span;}
     if(index>=line.length||distance<=0)throw Error('Interior lane turn must lie inside the declared measured source path.');
     const span=Math.hypot(...line[index].map((n,k)=>n-line[index-1][k])),t=(distance-at)/span,p=line[index-1].map((n,k)=>n+(line[index][k]-n)*t),turn={id:spec.interiorTurn.id,sourceActor:a.sourceActor,sourceGroundPoint:p,capsuleBottomPoint:[p[0],p[1]+.02,p[2]],standingOnly:true};
     if(!measured.oracle.stand(p)||Math.hypot(p[0]-b.sourceGroundPoint[0],p[2]-b.sourceGroundPoint[2])<2*site.capsule.radius+.05)throw Error('Interior turn lacks stand proof or shared-stand separation.');
     const {id,...rawAnchor}=turn;binding.anchors[id]=rawAnchor;rigid.anchors.push({anchorId:id,qualified:true});
     registerLink(`${spec.id}-interior`,a,turn,[...line.slice(0,index),p]);registerLink(`${spec.id}-remainder`,turn,b,[p,...line.slice(index)]);
    }
   }}finally{query.destroy();nav.navMesh.destroy();}
   site=createEaldholtVillageSite({profile,modelSha256:expected,binding,certificate,placeBindings:base.placeBindings,residentPlaceBindings:base.residentPlaceBindings});
  }
  for(const spec of LANE_PATROL_AUTHORS){
   const resident=population.residents.find(r=>r.id===spec.residentId),slot=resident.registry.routine.find(s=>s.activity==='Patrols the lanes, the well and the courtyard in the lanes.');
   if(!slot||resident.registry.role.id!=='spearman'||slot.placeId!=='proposed-lanes')throw Error('Patrol author no longer matches its actual registered role/routine.');
   if(spec.routineAnchor?.[profile]){
    const anchor=site.anchors.find(a=>a.id===spec.routineAnchor[profile]),index=bindings.findIndex(b=>b.residentId===resident.id&&b.placeId===slot.placeId);
    if(!anchor||index<0)throw Error('Explicit fresh patrol entry lacks its own source binding.');check([anchor.sourceGroundPoint],true);
    routineBindings.push({residentId:resident.id,placeId:slot.placeId,previous:bindings[index],next:{...bindings[index],anchorId:anchor.id,status:'mapped-exterior'}});bindings[index]={...bindings[index],anchorId:anchor.id,status:'mapped-exterior'};
   }
   const waypoints=spec.anchors[profile].map((anchorId,i)=>{const anchor=site.anchors.find(a=>a.id===anchorId);if(!anchor||anchorId.includes('-door-'))throw Error(`${profile} has no declared source lane stand ${anchorId}.`);check([anchor.sourceGroundPoint],true);const placeId=`${spec.id}-turn-${i+1}`;bindings.push({residentId:resident.id,placeId,anchorId,status:'mapped-exterior'});return{placeId,purpose:'lane-patrol',anchorId};});
   const extended=Object.freeze({...site,residentPlaceBindings:Object.freeze([...bindings])}),paths=[];
   const commute=resolveVillageSitePath(extended,resident.homePlaceId,slot.placeId,resident.id);
   if(!commute||commute.lengthMetres<=1e-7)throw Error('Patrol entry must retain a real certified commute from the unchanged home.');
   paths.push({from:resident.homePlaceId,to:slot.placeId,kind:'home-commute-never-a-patrol-leg',...commute,geometry:check(commute.sourceGroundPolyline,false),reverseGeometry:check([...commute.sourceGroundPolyline].reverse(),false),polylineSha256:hash(JSON.stringify(commute.sourceGroundPolyline))});
   for(let i=-1;i<waypoints.length;i++){
    const from=i<0?slot.placeId:waypoints[i].placeId,to=waypoints[(i+1)%waypoints.length].placeId,path=resolveVillageSitePath(extended,from,to,resident.id);
    if(!path||path.lengthMetres<=1e-7||!path.legs.length)throw Error(`${profile} has no nonzero complete patrol path ${from} -> ${to}.`);
    if(path.legs.some(l=>!site.routes.find(r=>r.id===l.id)?.reversible))throw Error('Every return leg must retain its original reversible certificate.');
    const geometry=check(path.sourceGroundPolyline,i>=0),reverseGeometry=check([...path.sourceGroundPolyline].reverse(),i>=0);
    paths.push({from,to,kind:i<0?'entry-to-declared-lane':'recurring-lane-patrol',...path,geometry,reverseGeometry,polylineSha256:hash(JSON.stringify(path.sourceGroundPolyline))});
   }
   plans.push({id:spec.id,residentId:resident.id,activity:slot.activity,routineTargetPlaceId:slot.placeId,waypoints,dwellWorldMinutes:1});
   proofs.push({planId:spec.id,residentId:resident.id,paths});
  }
  const revision=hash(JSON.stringify({version:'source-lane-patrol-v1',source:expected,baseSiteSha256:before,plans,addedLinks,bindings}));
  const data={...base,binding:{...binding,navigationRevision:revision,patrols:plans},certificate:{...certificate,navigationRevision:revision,patrols:plans},rigidSourceClearance:rigid,residentPlaceBindings:bindings,
   freshPatrolProvenance:{schemaVersion:1,kind:'fresh-only-source-lane-patrol-v1',navigationRevision:revision,baseSiteSha256:before,sourceModelSha256:expected,originalSourceUnchanged:true,proofs,addedLinks,routineBindings}};
  const validated=createEaldholtVillageSite({profile,modelSha256:expected,binding:data.binding,certificate:data.certificate,placeBindings:data.placeBindings,residentPlaceBindings:data.residentPlaceBindings});
  if(validated.patrols?.length!==2)throw Error('Patrol source contract did not retain both plans.');
  const rigidSite=applyVillageSiteRigidClearance(validated,validateVillageSiteRigidClearance(validated,rigid));
  if(rigidSite.anchors.length!==validated.anchors.length||rigidSite.routes.length!==validated.routes.length)throw Error('Patrol source failed its complete rigid-envelope contract.');
  const bytes=Buffer.from(JSON.stringify(data));
  const report={schemaVersion:1,status:'source-certified-unpaired-candidate-not-active',profile,sourceModelSha256:expected,sourceOriginalBuffersUnchanged:hash(fs.readFileSync(values['source-model']))===expected,baseSiteSha256:before,baseUnchanged:hash(fs.readFileSync(values['base-site']))===before,navigationRevision:revision,candidateSha256:hash(bytes),candidateBytes:bytes.length,measurement:measured.measurement,proofs,addedLinks,routineBindings,elapsedMilliseconds:performance.now()-started,
   limitations:['No saved world adopts this new source allocation.','No root environment selection, render scene, pose, source GLB or save is written.','The first Desktop guard has a limited local-lane circuit under8m to remain outside an existing shared stand.','Guard standing-watch transitions exceed the current source envelope and remain held during the one-minute dwell.','These source/animation contracts are not browser visual or physical Quest acceptance.']};
  if(!report.sourceOriginalBuffersUnchanged||!report.baseUnchanged)throw Error('Original inputs changed during authoring.');
  fs.mkdirSync(out,{recursive:true,mode:0o700});fs.writeFileSync(resolve(out,name),bytes,{flag:'wx',mode:0o600});fs.writeFileSync(resolve(out,reportName),JSON.stringify(report,null,2),{flag:'wx',mode:0o600});
  return report;
 }finally{measured.dispose();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){const{values}=parseArgs({options:{profile:{type:'string'},'source-model':{type:'string'},'base-site':{type:'string'},'output-dir':{type:'string'},'max-ms':{type:'string'},'recast-root':{type:'string'}}});console.log(JSON.stringify(await buildVillageLanePatrols(values),null,2));}
