import { getBannerholdBlueprint } from '../blueprint';
import type { BannerholdBlueprint, CameraFraming, NpcAgent, Pose, TerrainSampler } from '../blueprint';
import type { BuildInput, EnvironmentBuild } from '../build/buildBannerhold';
import { computeStats } from '../build/buildBannerhold';
import { resolveSceneSlots, slotCapacities } from '../build/state';
import { qualityProfile } from '../quality';
import { createMaterialLibrary } from '../materials/library';
import { createKitContext } from '../kits/context';
import { nationStyle } from '../kits/nations/style';
import { buildAgents, buildSlots, SLOT_SETS } from '../kits/figures/slots';
import { buildBannerMounts } from '../kits/props/heraldry';
import { bakeMesh } from '../kernel/bake';
import { LEGACY_COPY } from '../../content/copy';
import { buildSettlementNature } from './nature';
import { buildSettlementBuilding } from './buildings';
import { AUTUMN_LANDMARK_FOOTPRINTS, AUTUMN_SETTLEMENT_BUILDINGS, AUTUMN_SETTLEMENT_PATHS, AUTUMN_WATER_LEVEL, createSettlementTerrainField, settlementColliders, settlementHeight, settlementShore } from './layout';
import { sourceShoreColliders } from '../../worlds/combined/shore-layout';
import { SETTLEMENT_LIGHTING,SETTLEMENT_SUN_DIRECTION } from './lighting';
const pose=(x:number,z:number,lift=0):Pose=>({position:[x,settlementHeight(x,z)+lift,z],yawDeg:0});
/** Long-lens perspective gives the reference's aerial/isometric reading while
 * preserving the established perspective camera and bounded orbit controls. */
export function settlementCameras():CameraFraming[]{const overview:CameraFraming={id:'establishing',label:'Settlement overview',position:[-88,130,118],target:[0,3,3],fovDeg:32,orbit:{yawDeg:[-180,180],pitchDeg:[38,72],distance:[85,300]},transitionSeconds:.8,composition:'Compact autumn village, woodland and western shoreline together'};return [overview,{...overview,id:'founding'},{...overview,id:'representative'},...AUTUMN_LANDMARK_FOOTPRINTS.map(p=>({...overview,id:`landmark:${p.id}` as const}))];}
export function settlementBlueprint(nationId:BannerholdBlueprint['nationId']):BannerholdBlueprint {
 const bp=structuredClone(getBannerholdBlueprint(nationId));bp.siteName='Bannerhold';bp.summary='Original autumn settlement presentation; house consequences remain chess-driven.';
 const hall=AUTUMN_SETTLEMENT_BUILDINGS.find(building=>building.landmark==='banner-hall')!;
 const frontStandard=(x:number):Pose=>{const z=6.5,c=Math.cos(hall.yaw),s=Math.sin(hall.yaw),worldX=hall.x+c*x+s*z,worldZ=hall.z-s*x+c*z;return{position:[worldX,settlementHeight(worldX,worldZ),worldZ],yawDeg:hall.yaw*180/Math.PI};};
 bp.terrain={...bp.terrain,extents:{minX:-88,maxX:88,minZ:-88,maxZ:88},baseElevation:2.8,baseSurface:'meadow',features:[],water:[],surfaces:[],logic:'Ground and shoreline sampled by settlementHeight; field is shared by both renderers.'};
 bp.buildings=[];bp.walls=[];bp.towers=[];bp.gates=[];
 bp.routes=AUTUMN_SETTLEMENT_PATHS.map(p=>({id:p.id,name:p.id,kind:'path',hierarchy:p.id==='main'?'primary':'pedestrian',points:p.points,width:p.width,surface:'packed-earth',grade:'ground',covered:false,users:['residents','soldiers'],outer:false}));
 bp.landmarks=AUTUMN_LANDMARK_FOOTPRINTS.map(p=>({id:p.id,label:LEGACY_COPY.landmarks[p.id].title,buildingIds:[p.id],anchor:[p.center[0],p.center[1]+2,p.center[2]],pickCenter:[p.center[0],p.center[1]+3,p.center[2]],pickRadius:Math.max(p.width,p.depth)*.55,cameraId:`landmark:${p.id}`}));
 bp.destinations=[{id:'gate',label:'Main path',position:[28,70]},{id:'manor',label:'Banner Hall',position:[-7,-23]},{id:'muster',label:'Muster Grounds',position:[11,23]},{id:'archive',label:'War Record',position:[-27,-25]},{id:'herald',label:"Herald's Station",position:[8,37]},{id:'residential',label:'Village',position:[-25,17]},{id:'artisan',label:'Workshops',position:[37,-1]}];
 bp.muster={...bp.muster,pawnStand:pose(17,20),levySlots:Array.from({length:8},(_,i)=>pose(18+i%4*1.7,21+Math.floor(i/4)*2)),drillSquare:{kind:'rect',center:[21,21],width:11,depth:7}};
 bp.slots={...bp.slots,injuredRest:pose(27,17),captiveMarker:pose(17,20),honourNiches:Array.from({length:6},(_,i)=>pose(2+i*1.8,-16.7,1)),recordMarkers:Array.from({length:8},(_,i)=>pose(-22+i*.6,-1,1)),noticeBoard:Array.from({length:4},(_,i)=>pose(-1+i*.7,35.1,1.2)),heraldArrival:pose(8,37),rivalCorrespondence:pose(4,35.2,1.1),alliedEnvoy:pose(5,34),foundingStandard:frontStandard(-5.85),bannerMounts:[{id:'player-hall',kind:'standard',heraldry:'player',pose:frontStandard(-5.85),height:9.5,minHallTier:0},{id:'crown-hall',kind:'standard',heraldry:'crown',pose:frontStandard(-.55),height:9,minHallTier:0}]};
 bp.npcs=AUTUMN_SETTLEMENT_PATHS.slice(0,4).map((path,i):NpcAgent=>({id:'settlement-resident-'+i,role:i===0?'messenger':'resident',label:'Village resident',district:'C',count:1,route:path.points,heightMode:'terrain',steps:[{kind:'hold',seconds:3+i,activity:'chat'},{kind:'walk',to:path.points.length-1},{kind:'hold',seconds:4,activity:'inspect'},{kind:'walk',to:0}],phaseSeconds:i*13,speed:1.25,lod:{fullRateWithin:500,reducedRateWithin:700,hiddenBeyond:1000},activitySiteIds:[]}));
 bp.atmosphere={...bp.atmosphere,timeOfDay:'Warm afternoon',sun:{...SETTLEMENT_LIGHTING.sun,disc:'sun'},sky:{zenith:'#b8cad4',horizon:'#d5cbb3',ground:'#746a4e',ambientIntensity:.62},fog:{colour:'#a9bbc3',near:270,far:920,heightFalloff:.004},wind:{towardBearingDeg:80,speed:.5,gustiness:.15},exposure:1.0,notes:'Warm autumn aerial view with light blue shoreline and soft warm key light.'};
 bp.cameras=settlementCameras();bp.observation={position:bp.cameras[0].position,target:bp.cameras[0].target,description:'Aerial autumn settlement'};bp.vr={...bp.vr,displayScale:.0105,displayCenter:[0,0],datumY:2.8,detailExtent:{width:176,depth:176},skirtMargins:{far:24,lateral:24,near:0},viewerFacingBearingDeg:0};return bp;
}
export function buildAutumnSettlement(input:BuildInput):EnvironmentBuild {
 const nation=input.nationId??input.state?.nationId??'korvenia',bp=settlementBlueprint(nation),quality=qualityProfile(input.quality),field=createSettlementTerrainField();
 const terrain:TerrainSampler={model:bp.terrain,height:settlementHeight,surface:()=> 'meadow',waterLevel:(x,z)=>x<settlementShore(z)?AUTUMN_WATER_LEVEL:NaN,slope:(x,z)=>Math.hypot(settlementHeight(x+1,z)-settlementHeight(x-1,z),settlementHeight(x,z+1)-settlementHeight(x,z-1))/2};
 const ctx=createKitContext({bp,quality,style:nationStyle(nation),terrain,field,lib:createMaterialLibrary(nation),far:settlementHeight});
 // The original Crownfall compound manor is the dominant Banner Hall. It uses
 // the existing worker material library and semantic masks. Other buildings and
 // the open Temple court shelter are actual source geometry in combined/kit;
 // workers must not emit duplicate shells for those source lots.
 const nature=buildSettlementNature(input.quality==='quest',0),hall=AUTUMN_SETTLEMENT_BUILDINGS.find(building=>building.landmark==='banner-hall')!;
 let meshes=nature.meshes.concat(buildSettlementBuilding(hall));
 buildBannerMounts(ctx);buildSlots(ctx);const agents=buildAgents(ctx);meshes=meshes.concat(ctx.b.finish());const instances=nature.instances.concat(ctx.instances.finish());
 if(quality.bakeDirectional){for(const mesh of meshes)if(mesh.part!=='terrain'&&mesh.material!=='settlement-water'&&mesh.material!=='cloth-heraldry')bakeMesh(mesh,{ground:settlementHeight,contact:{strength:.14,height:1},directional:{dir:SETTLEMENT_SUN_DIRECTION,strength:.38,ambient:.78}});for(const set of instances)for(const mesh of set.prototypes)if(mesh.material!=='cloth-heraldry')bakeMesh(mesh,{ground:()=>-1000,directional:{dir:SETTLEMENT_SUN_DIRECTION,strength:.3,ambient:.82}});}
 const capacities=slotCapacities(bp);return {version:1,nationId:nation,quality,meshes,instances,agents,slots:SLOT_SETS,slotCapacities:capacities,initialSlots:resolveSceneSlots(input.state,capacities),colliders:[...settlementColliders(),...sourceShoreColliders()],field,landmarks:bp.landmarks.map(l=>({id:l.id,label:l.label,anchor:l.anchor,pickCenter:l.pickCenter,pickRadius:l.pickRadius,cameraId:l.cameraId,bounds:{min:[l.anchor[0]-l.pickRadius,l.anchor[1]-2,l.anchor[2]-l.pickRadius],max:[l.anchor[0]+l.pickRadius,l.anchor[1]+12,l.anchor[2]+l.pickRadius]}})),lights:[],smoke:[],fires:[],staging:{cameras:bp.cameras,observation:bp.observation,atmosphere:bp.atmosphere,vr:bp.vr,settlementBounds:{min:[-50,0,-55],max:[70,18,72]},destinations:bp.destinations},stats:computeStats(meshes,instances)};
}
