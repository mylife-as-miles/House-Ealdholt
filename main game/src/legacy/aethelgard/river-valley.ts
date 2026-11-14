import type { createEaldholtOpenWater } from './open-water-runtime';
import {patchEaldholtRiverFlow, EALDHOLT_RIVER_FLOW_PROGRAM_KEY} from '../../../../shared/legacy/aethelgard/environment/river-flow-shader';
import{bankStageDiagnosticSignature}from'../../../../shared/legacy/aethelgard/environment/bank-material-diagnostics';
import{EALDHOLT_BANK_KNOT_PROGRAM_KEY,ealdholtBankLookupUniformVectors}from'../../../../shared/legacy/aethelgard/environment/authored-bank-knots';
import { BufferAttribute, BufferGeometry, Color, Group, Matrix4, Mesh, MeshPhysicalMaterial, MeshStandardMaterial, Vector3, type Object3D, type Texture } from 'three';
import { collectEaldholtTerrainEdges, type EaldholtValleyMesh } from '../../../../shared/legacy/aethelgard/environment/river-valley';
import { createEaldholtCoastalValleyBuffers, createEaldholtCoastalInspectionView, type EaldholtCoastalInspectionView } from '../../../../shared/legacy/aethelgard/environment/coastal-valley';
import { EALDHOLT_WATER_LOOK as WATER, EALDHOLT_REGIONAL_WATER_ENV_INTENSITY } from '../../../../shared/legacy/aethelgard/environment/water-look';
import { createEaldholtWaterMotion, patchEaldholtWaterRipples, type EaldholtWaterWind } from '../../../../shared/legacy/aethelgard/environment/water-ripples';
import { patchEaldholtRiverSurface, EALDHOLT_BANK_ART_VERSION, EALDHOLT_VALLEY_GRASS_CACHE_KEY } from '../../../../shared/legacy/aethelgard/environment/river-surface';
export { EALDHOLT_BANK_ART_VERSION } from '../../../../shared/legacy/aethelgard/environment/river-surface';
import { createEaldholtCoastalWaterShoreAttributes, patchEaldholtWaterShoreColor, EALDHOLT_WATER_SHORE_ATTRIBUTES, EALDHOLT_WATER_SHORE_CACHE_KEY } from '../../../../shared/legacy/aethelgard/environment/water-shore-color';
import type { EaldholtBorrowedSurfaceMaps } from './ground-albedo-detail';
import { createEaldholtBankExposureSections, EALDHOLT_WOODLAND_BANK_ART_VERSION, type EaldholtWoodlandValleyOptions } from '../../../../shared/legacy/aethelgard/environment/woodland-ground';

export interface EaldholtRiverValley {
  readonly object:Object3D;readonly triangles:number;readonly drawCalls:3;readonly bufferBytes:number;
  readonly bounds:{min:readonly[number,number,number];max:readonly[number,number,number]};
  readonly sourceJoinVertices:number;readonly viewpoint:EaldholtCoastalInspectionView;
  readonly artVersion:string;
  update(elapsedSeconds:number,animated:boolean,wind?:EaldholtWaterWind|null):void;dispose():void;
}

/** Original outside-only landscape proposal. Add object to privateModel BEFORE
 * composite framing/comfort bounds. It is real terrain, never a bounds exclusion.
 * Surface maps are borrowed: dispose this handle before the ground-map owner.
 * The model root's miniature/display scale is ignored during source-edge intake. */
export function createEaldholtRiverValley(privateModel:Object3D,maps?:EaldholtBorrowedSurfaceMaps,options:{profile?:'desktop'|'quest';environment?:Texture|null;rockMaps?:EaldholtBorrowedSurfaceMaps;grassMaps?:EaldholtBorrowedSurfaceMaps;openWater?:ReturnType<typeof createEaldholtOpenWater>}={}):EaldholtRiverValley {
  privateModel.updateWorldMatrix(true,true);
  const inverse=new Matrix4().copy(privateModel.matrixWorld).invert(),point=new Vector3();
  const terrain:{mesh:Mesh;frame:Matrix4}[]=[];
  privateModel.traverse(object=>{if(object instanceof Mesh&&/^LandscapeComponent_\d+(?:_\d+)?$/.test(object.name)&&object.geometry.getAttribute('position'))terrain.push({mesh:object,frame:new Matrix4().multiplyMatrices(inverse,object.matrixWorld)});});
  const edges=collectEaldholtTerrainEdges(visit=>{
    for(const {mesh,frame}of terrain){const positions=mesh.geometry.getAttribute('position');for(let i=0;i<positions.count;i++){point.fromBufferAttribute(positions,i).applyMatrix4(frame);visit(point.x,point.y,point.z);}}
  });
  const data=createEaldholtCoastalValleyBuffers(edges,options.profile??'desktop');
  // Only the explicit paired, measured layer contract opts into geometric meadow/bank
  // classification. Existing borrowed earth/grass maps keep their v2 appearance.
  const grass=options.grassMaps;
  const measured=(value:number|undefined):value is number=>typeof value==='number'&&Number.isFinite(value)&&value>0&&value<=1;
  const target=(value:number|undefined)=>measured(value)&&value<.5;
  const tile=(value:number|undefined)=>typeof value==='number'&&Number.isFinite(value)&&value>=.5&&value<=8;
  const woodland:EaldholtWoodlandValleyOptions|undefined=maps?.albedo&&grass?.albedo
    &&measured(maps.meanLuminance)&&measured(grass.meanLuminance)
    &&target(maps.targetLuminance)&&target(grass.targetLuminance)&&tile(maps.tileMetres)&&tile(grass.tileMetres)
    ?{bank:{tileMetres:maps.tileMetres!,targetLuminance:maps.targetLuminance!},
      meadow:{albedo:grass.albedo,normal:grass.normal,meanLuminance:grass.meanLuminance!,targetLuminance:grass.targetLuminance!,tileMetres:grass.tileMetres!},
      sections:createEaldholtBankExposureSections(data.shape.channelSamples,64)}:undefined;
  const artVersion=woodland?EALDHOLT_WOODLAND_BANK_ART_VERSION:EALDHOLT_BANK_ART_VERSION;
  function geometry(source:EaldholtValleyMesh){
    const g=new BufferGeometry(),uv=new BufferAttribute(source.uv,2);g.setAttribute('position',new BufferAttribute(source.positions,3));g.setAttribute('normal',new BufferAttribute(source.normals,3));g.setAttribute('color',new BufferAttribute(source.colours,3));
    for(const name of ['uv','uv1','uv2','uv3'])g.setAttribute(name,uv);g.setIndex(new BufferAttribute(source.indices,1));g.computeBoundingBox();g.computeBoundingSphere();return g;
  }
  const landGeometry=geometry(data.land),waterGeometry=geometry(data.channel),seaGeometry=geometry(data.sea);
  landGeometry.setAttribute('ealdholtShoreWetness',new BufferAttribute(data.landWetness,1));
  const shore=createEaldholtCoastalWaterShoreAttributes(data.shape,data.channel,data.sea);
  for(const [g,a] of [[waterGeometry,shore.channel],[seaGeometry,shore.sea]] as const){g.setAttribute(EALDHOLT_WATER_SHORE_ATTRIBUTES.across,new BufferAttribute(a.across,1));g.setAttribute(EALDHOLT_WATER_SHORE_ATTRIBUTES.halfWidth,new BufferAttribute(a.halfWidth,1));}
  const landMaterial=new MeshStandardMaterial({name:'Ealdholt proposed valley earth',vertexColors:true,color:0xffffff,roughness:.94,metalness:0,
    map:maps?.albedo??null,normalMap:maps?.normal??null,roughnessMap:maps?.orm??null,metalnessMap:null,aoMap:maps?.orm??null,aoMapIntensity:.8});
  landMaterial.normalScale.set(.25,.25);
  if (maps?.albedo) {
    const mean=maps.meanLuminance??.06,margin=options.profile==='quest'?30:70,rock=options.rockMaps;
    landMaterial.onBeforeCompile=shader=>patchEaldholtRiverSurface(shader,mean,edges.maxZ,margin,'attribute',{
      earthNormal:maps.normal,earthOrm:maps.orm,rock,grass,waterHeight:data.shape.seaLevel,woodland,
    });
    const mapContract=[!!maps.normal,!!maps.orm,!!rock?.albedo,!!rock?.normal,!!rock?.orm,!!grass?.albedo,!!grass?.normal,!!grass?.orm].map(Number).join('');
    const layerContract=woodland?':tiles-'+woodland.bank.tileMetres+'-'+woodland.meadow.tileMetres
      +':targets-'+woodland.bank.targetLuminance+'-'+woodland.meadow.targetLuminance+':sections-'+woodland.sections.count+':stage-knots-'+woodland.sections.waterStages.count+EALDHOLT_BANK_KNOT_PROGRAM_KEY+':banks-'+woodland.sections.authoredBanks.count:'';
    landMaterial.customProgramCacheKey=()=>':ealdholt-coastal-valley-surface:'+artVersion+':'+mapContract+(grass?.albedo?EALDHOLT_VALLEY_GRASS_CACHE_KEY:'')+layerContract;
    landMaterial.userData.crownfallRiverSurface={version:artVersion,sourceMetres:true,photographicRgbRetained:true,
      earthMapsBorrowed:true,rockMapsBorrowed:!!rock,extraTextureBytes:0,grassFromSourcePalette:!grass?.albedo,grassMapsBorrowed:!!grass?.albedo,grassSource:grass?.albedo?(grass.sourceAssetId??'caller-supplied'):null,
      geometricGroundWeights:!!woodland,bankSections:woodland?.sections.count??0,channelBankKnots:woodland?.sections.authoredBanks.count??0,channelBankSignature:woodland?bankStageDiagnosticSignature(woodland.sections.authoredBanks.data):null,channelBankLookupVersion:woodland?EALDHOLT_BANK_KNOT_PROGRAM_KEY:null,channelBankUniformVectors:woodland?ealdholtBankLookupUniformVectors(woodland.sections.authoredBanks.count,woodland.sections.count,woodland.sections.waterStages.count):0,channelStageKnots:woodland?.sections.waterStages.count??0,channelStageMaximumError:woodland?.sections.waterStages.maximumError??null,channelStageSignature:woodland?bankStageDiagnosticSignature(woodland.sections.waterStages.data):null,shoreContact:'material-only-existing-geometry',forestMapsBorrowed:false};
  }
  const waterMaterial=new MeshPhysicalMaterial({name:'Ealdholt proposed regional river',color:new Color().setRGB(...WATER.linearBaseColor),metalness:0,roughness:WATER.roughness,ior:WATER.ior,specularIntensity:WATER.specularIntensity,envMapIntensity:EALDHOLT_REGIONAL_WATER_ENV_INTENSITY,envMap:options.environment??null});
  const motion=createEaldholtWaterMotion();
  const ripple={time:motion.time,windDirection:motion.windDirection,windStrength:motion.windStrength,metresPerWorldUnit:{value:1},worldToSource:{value:new Matrix4()},sourceToWorldRotation:{value:new Matrix4()}};
  function refreshFrame(){privateModel.updateWorldMatrix(true,false);ripple.worldToSource.value.copy(privateModel.matrixWorld).invert();ripple.sourceToWorldRotation.value.extractRotation(privateModel.matrixWorld);}
  refreshFrame();waterMaterial.onBeforeCompile=shader=>{patchEaldholtWaterRipples(shader,ripple);patchEaldholtWaterShoreColor(shader);patchEaldholtRiverFlow(shader);options.openWater?.patchShader(shader,ripple,'river');};waterMaterial.customProgramCacheKey=()=>EALDHOLT_RIVER_FLOW_PROGRAM_KEY+EALDHOLT_WATER_SHORE_CACHE_KEY+(options.openWater?':open-water-v1:river':'');waterMaterial.onBeforeRender=refreshFrame;
  // The sea borrows the same PBR lighting, but not the river's downstream current.
  // Far/outer sea owners continue borrowing this exact material; no extra loop.
  const seaMaterial=options.openWater?waterMaterial.clone():waterMaterial;
  if(options.openWater){seaMaterial.name='Ealdholt Open Water western sea';seaMaterial.onBeforeCompile=shader=>{patchEaldholtWaterRipples(shader,ripple);patchEaldholtWaterShoreColor(shader);options.openWater!.patchShader(shader,ripple,'sea');};seaMaterial.customProgramCacheKey=()=>EALDHOLT_WATER_SHORE_CACHE_KEY+':open-water-v1:sea';seaMaterial.onBeforeRender=refreshFrame;}

  waterMaterial.userData.crownfallRiver={proposedLocalLandscape:true,georeferenced:false,staticIblOnly:true,noSceneReflections:true};
  const land=new Mesh(landGeometry,landMaterial),water=new Mesh(waterGeometry,waterMaterial),sea=new Mesh(seaGeometry,seaMaterial);land.name='Ealdholt outside village valley';water.name='Ealdholt regional river surface';sea.name='Ealdholt open sea surface';
  land.userData.crownfallElderbloom={kind:'terrain'};
  water.userData.crownfallElderbloom={kind:'water'};
  sea.userData.crownfallElderbloom={kind:'water'};
  land.castShadow=water.castShadow=sea.castShadow=false;land.receiveShadow=true;water.receiveShadow=sea.receiveShadow=false;
  const object=new Group();object.name='House Ealdholt Proposed Coastal Valley';object.add(land,water,sea);
  object.userData.crownfallRiverValley={profile:options.profile??'desktop',georeferenced:false,sourceGeometryUntouched:true,artVersion};
  let disposed=false;
  return {object,artVersion,triangles:data.triangles,drawCalls:3,bufferBytes:data.bufferBytes+shore.byteLength,bounds:data.bounds,sourceJoinVertices:data.sourceJoinVertices,viewpoint:createEaldholtCoastalInspectionView(data.shape),
    update(elapsedSeconds,animated,wind){if(!disposed)motion.update(elapsedSeconds,animated,wind);},
    dispose(){if(disposed)return;disposed=true;object.removeFromParent();object.clear();landGeometry.dispose();waterGeometry.dispose();seaGeometry.dispose();landMaterial.dispose();waterMaterial.dispose();if(seaMaterial!==waterMaterial)seaMaterial.dispose();},
  };
}
