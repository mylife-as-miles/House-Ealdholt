import { patchEaldholtWaterRipples } from '../../aethelgard/environment/water-ripples.ts';

/** Original Crownfall estate water. The filename and compatibility factory are
 * retained for existing consumers; no procedural-alpine-lake source is bundled.
 * See alpine-SOURCE.md and the licensed shared ripple helper's provenance. */
export const CROWNFALL_WATER_SOURCE=Object.freeze({
  repository:'https://github.com/mylife-as-miles/Crownfall',commit:'project-owned',author:'Crownfall',
  license:'Original Crownfall code; repository terms apply',publication:'Original implementation included',files:Object.freeze({}),
});
export const ALPINE_SOURCE=CROWNFALL_WATER_SOURCE;
export const ALPINE_COMMON_GLSL='';
export const ALPINE_WATER_GLSL='';
export const CROWNFALL_ALPINE_LOOK=Object.freeze({
  inScatter:Object.freeze([.07,.19,.22]),skyLow:Object.freeze([.34,.48,.59]),skyHigh:Object.freeze([.57,.71,.83]),
  bedLow:Object.freeze([.12,.10,.07]),bedHigh:Object.freeze([.24,.21,.15]),opticalDepthSlope:.6,skyCloudMix:.35,
});
function resolveLook(input={}){
  const result={};
  for(const key of ['inScatter','skyLow','skyHigh','bedLow','bedHigh']){
    const value=input[key]??CROWNFALL_ALPINE_LOOK[key],limit=key==='inScatter'?12:key.startsWith('sky')?8:1;
    if(!Array.isArray(value)||value.length!==3||!value.every(n=>Number.isFinite(n)&&n>=0&&n<=limit))throw Error(`Invalid Crownfall water look: ${key}`);
    result[key]=Object.freeze([...value]);
  }
  for(const [key,min,max]of [['opticalDepthSlope',.1,2],['skyCloudMix',0,1]]){
    const value=input[key]??CROWNFALL_ALPINE_LOOK[key];
    if(!Number.isFinite(value)||value<min||value>max)throw Error(`Invalid Crownfall water look: ${key}`);
    result[key]=value;
  }
  return Object.freeze(result);
}

export function createCrownfallEstateWater({THREE:T,profile='desktop',waterLevel=.55,extent=profile==='quest'?88:500,look={}}){
  if(!T?.MeshPhysicalMaterial||!T?.Matrix4)throw Error('Estate water requires the consuming Three namespace');
  if(!['desktop','quest'].includes(profile)||!Number.isFinite(extent)||extent<=0||extent>1000||!Number.isFinite(waterLevel))throw Error('Invalid estate lake bounds');
  const hostLook=resolveLook(look),root=new T.Group();root.name='Crownfall original estate water';
  const source=Object.freeze({id:'crownfall-original-estate-water',repository:CROWNFALL_WATER_SOURCE.repository,commit:CROWNFALL_WATER_SOURCE.commit,path:'shared/legacy/worlds/combined/alpine.js',generator:'Original Crownfall PBR water with licensed footprint-filtered pond ripples',license:CROWNFALL_WATER_SOURCE.license});
  root.userData.sourceAssetId=source.id;root.userData.sourceProvenance=[source];
  const geometry=new T.PlaneGeometry(extent*2,extent*2);geometry.rotateX(-Math.PI/2);geometry.computeBoundingBox();
  const material=new T.MeshPhysicalMaterial({name:'Crownfall original estate water',color:new T.Color().setRGB(...hostLook.inScatter),roughness:.28,metalness:0,ior:1.333,specularIntensity:1,side:T.DoubleSide,depthWrite:true,depthTest:true});
  const uniforms={time:{value:0},metresPerWorldUnit:{value:1},worldToSource:{value:new T.Matrix4()},sourceToWorldRotation:{value:new T.Matrix4()}};
  const eye=new T.Vector3();let reduced=false,disposed=false;
  function refreshFrame(){root.updateWorldMatrix(true,false);uniforms.worldToSource.value.copy(root.matrixWorld).invert();uniforms.sourceToWorldRotation.value.extractRotation(root.matrixWorld);}
  material.onBeforeCompile=shader=>patchEaldholtWaterRipples(shader,uniforms);
  material.onBeforeRender=refreshFrame;
  material.customProgramCacheKey=()=>':crownfall-original-estate-water:v2';
  material.userData.sourceShader={...source,originalImplementation:true,usesUpstreamAlpineCode:false,sharedRippleSource:'ZyFou/ProceduralTerrains (MIT); see shared/legacy/aethelgard/environment/PROCEDURAL_TERRAINS_SOURCES.md',hostLook,hostLookVersion:1,sceneReflections:false};
  material.userData.crownfallWaterUniforms=uniforms;material.userData.crownfallSourceCamera=eye;
  const mesh=new T.Mesh(geometry,material);mesh.name='Crownfall original estate lake surface';mesh.position.y=waterLevel;mesh.castShadow=false;mesh.receiveShadow=false;mesh.userData.sourceAsset=source;mesh.userData.sourceAssetId=source.id;mesh.userData.sourceProvenance=[source];mesh.raycast=()=>{};root.add(mesh);
  refreshFrame();
  return {root,update(delta,camera){
    if(disposed)return;
    if(!reduced)uniforms.time.value+=Math.max(0,Math.min(.1,Number.isFinite(delta)?delta:0));
    refreshFrame();
    if(camera){camera.getWorldPosition(eye);eye.applyMatrix4(uniforms.worldToSource.value);}
  },setReducedMotion(value){reduced=!!value;},getInfo(){return {included:!disposed,assetId:source.id,source,shader:material.userData.sourceShader,triangles:2,drawCalls:1,time:uniforms.time.value,reducedMotion:reduced,permissionRecordPending:false,usesUpstreamAlpineCode:false};},dispose(){if(disposed)return;disposed=true;root.removeFromParent();root.clear();geometry.dispose();material.dispose();}};
}
/** Compatibility alias only; this factory contains no Alpine upstream source. */
export const createAlpineWater=createCrownfallEstateWater;
