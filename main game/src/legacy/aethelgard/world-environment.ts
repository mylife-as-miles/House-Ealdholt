import {acquireWorldGeometryReader,isWorldGeometryReaderActive} from '../../../../shared/legacy/aethelgard/environment/world-geometry-readers';
import {createShaderTime} from '../../../../shared/legacy/aethelgard/environment/shader-time';
import {patchVegetationWind,vegetationWindBindingKey,VEGETATION_WIND_SHADER_VERSION,type VegetationWindBinding} from '../../../../shared/legacy/aethelgard/environment/vegetation-wind';
import {updateCloudOffset} from '../../../../shared/legacy/aethelgard/environment/cloud-motion';
import {Color,Data3DTexture,DirectionalLight,InstancedMesh,LinearFilter,Matrix4,Mesh,MeshDepthMaterial,MeshDistanceMaterial,MeshStandardMaterial,RGBADepthPacking,RGFormat,RepeatWrapping,ShaderChunk,ShaderMaterial,Vector2,Vector3,
 type Material,type Camera,type HemisphereLight,type Object3D,type Scene,type WebGLRenderer} from 'three';
import {sampleWorldEnvironment,type WorldEnvironmentOverride,type WorldEnvironmentState} from '../../../../shared/legacy/aethelgard/environment/world-environment-state';
import {worldSkyIrradiance} from '../../../../shared/legacy/aethelgard/environment/world-sky-irradiance';
import {EALDHOLT_VILLAGE_DAYLIGHT} from '../../../../shared/legacy/aethelgard/environment/daylight';
import type {VillageWorldStatus} from '../../../../shared/legacy/aethelgard/environment/world-status';
import type {VillagePopulationTime} from '../../../../shared/legacy/aethelgard/characters/village-population-runtime';
import {CLOUD_DENSITY_VERSION,cloudDensityCacheMetadata,CLOUD_FIELD_LAYOUT,CLOUD_SAMPLING_VERSION,validateCloudDensityVolume} from '../../../../shared/legacy/aethelgard/environment/cloud-volume';
import {worldSkyShader} from '../../../../shared/legacy/aethelgard/environment/world-sky-shader';
import {WORLD_CELESTIAL_SHADER_VERSION} from '../../../../shared/legacy/aethelgard/environment/world-celestial-shader';
import {patchWorldEnvironmentMaterial,WORLD_ENVIRONMENT_SHADER_VERSION} from '../../../../shared/legacy/aethelgard/environment/environment-material-shader';
import {createWorldBakeCache,worldBakeKey} from '../../../../shared/legacy/aethelgard/environment/world-bake-cache';
import {createIndexedWorldBakeStore} from '../../../../shared/legacy/aethelgard/environment/world-bake-idb';
import type {WorldPreparationQueue} from '../../../../shared/legacy/aethelgard/environment/world-preparation-queue';
import type {WorldEnvironmentChangeReason} from '../../../../shared/legacy/aethelgard/environment/environment-change';

/** A consumer of the existing saved clock, not a second clock. Imported GLBs,
 * HDR reflections, static voxel occupancy and resident state remain intact. */
export function createWorldEnvironment(options:{sourceRoot:Object3D;atmosphere:Object3D;scene:Scene;renderer:WebGLRenderer;camera:Camera;
 sun:DirectionalLight;fill?:HemisphereLight;queue:WorldPreparationQueue;signal:AbortSignal;native?:boolean;
 reducedMotion():boolean;quality:()=> 'low'|'medium'|'high';readClock():{time:VillagePopulationTime;worldKey:string;animationSeconds:number}|null;
 /** My Legacy's observer: the sky it commands, in place of the seeded weather while it holds. */
 override?():WorldEnvironmentOverride|undefined;
 setSunDirection(direction:Vector3):void;changed(reason?:WorldEnvironmentChangeReason):void;statusChanged?(status:VillageWorldStatus):void}){
 const controller=new AbortController(),signal=controller.signal,shaderTime=createShaderTime();
 const fillGround=options.fill?.groundColor.clone();
 const cache=createWorldBakeCache({store:createIndexedWorldBakeStore()}),width=options.native?32:64,height=options.native?12:24;
 const fallback=new Data3DTexture(new Uint8Array(2),1,1,1);fallback.format=RGFormat;fallback.needsUpdate=true;
 const skyInverse=new Matrix4(),inverse=new Matrix4(),eye=new Vector3(),direction=new Vector3(),cloudSun=new Vector3(),sourceSun=new Vector3(),cloudSunTarget=new Vector3(),moonDirection=new Vector3(),moonWorldDirection=new Vector3(),moonWorldTarget=new Vector3(),moon=new DirectionalLight('#8da7df',0);
 moon.name='Ealdholt clock-driven moonlight';moon.castShadow=false;options.sourceRoot.add(moon,moon.target);
 let density:Data3DTexture=fallback,worker:Worker|null=null,disposed=false,lastScan=-Infinity,lastEvent=-Infinity,started=false,lastQuality='';
 let state:WorldEnvironmentState|null=null,lastMinute=-Infinity,lastOverrideKey='';
 const celestialSourceFrame=new Matrix4(),celestialSunFrame=new Matrix4(),celestialSunTargetFrame=new Matrix4(),celestialSunParentFrame=new Matrix4(),identityFrame=new Matrix4();let celestialFrameReady=false;
 let scanUnresolved=false,unresolvedMaterialGraph=false,colourAdmissionSlots=0,colourStageHeld=false,colourPressureHold=false,colourPressureSkipped=false;
 let publishedHour=-1,publishedMinute=-1,publishedDay=-1,publishedWeather='';
 const uniforms:ShaderMaterial['uniforms']={cfCloudDensity:{value:density},cfEnvironmentSeconds:{value:0},cfCloudOffset:{value:new Vector2()},cfCloudCoverage:{value:.3},cfCloudGlobalTransmission:{value:1},cfCloudLightingEnabled:{value:0},cfWorldSun:{value:new Vector3(0,1,0)},
 cfWorldMoon:{value:new Vector3(0,1,0)},cfMoonIllumination:{value:0},cfMoonVisibility:{value:0},cfMoonWashout:{value:0},cfNightVisibility:{value:0},cfStarRotation:{value:new Vector2(1,0)},
 cfSkyZenith:{value:new Color().setRGB(.17,.34,.56)},cfSkyHorizon:{value:new Color().setRGB(.64,.73,.77)},cfSunColour:{value:new Color().setRGB(1,.95,.86)},cfCloudEye:{value:eye},cfDaylight:{value:1},cfRain:{value:0},
 cfEnvironmentToSource:{value:inverse},cfCloudSourceToWorld:{value:options.sourceRoot.matrixWorld},cfWindStrength:{value:.2},cfWindDirection:{value:{x:1,y:.3}},cfWorldWetness:{value:0},cfSurfaceWeatherEnabled:{value:0}};
 const stats={status:'awaiting-clock',error:'',clock:'existing-persisted-village-clock',hour:9,minute:0,day:0,weather:'clear',rain:0,wetness:0,daylight:1,
 celestialShader:WORLD_CELESTIAL_SHADER_VERSION,moonPhase:0,moonIllumination:0,moonDirection:[0,1,0],nightVisibility:0,milkyWayVisibility:0,cloudVolume:[width,height,width],cloudLayout:CLOUD_FIELD_LAYOUT,cloudBytes:0,cloudSteps:options.native?4:options.quality()==='low'?12:options.quality()==='high'?32:20,cloudBackend:'pending',cloudFallbackReason:'',cloudDensityBuilds:0,cloudDensityRestores:0,cloudUploadRetries:0,cloudMotionSeconds:0,cloudOffset:[0,0],windStrength:0,windDirection:[1,0],windProgramsReady:0,windShadowProgramsReady:0,ownedColourMaterials:0,ownedShadowMaterials:0,colourBudgetHeld:false,colourMaterialsStaged:0,colourReadyUnpublished:0,colourPublicationBatches:0,colourPublicationLimit:32,activeWindMaterialSlots:0,activeWindReadyMaterialSlots:0,materials:0,materialProgramsPending:0,shadowMaterialProgramsPending:0,surfaceWeather:'global-lighting-fallback',surfaceWeatherError:'',nativeAmbientFallback:!!options.native,cache:cache.stats,materialGraphPending:false,notifications:{visual:0,preparation:0,ready:0}};
 const notifyChange=(reason:WorldEnvironmentChangeReason='visual')=>{if(!disposed){stats.notifications[reason]++;options.changed(reason);}};
 const materialRecords=new Map<MeshStandardMaterial,{intensity:number}>();
 const shadowOriginals=new Map<Mesh,{depth:Mesh['customDepthMaterial'];distance:Mesh['customDistanceMaterial']}>(),shadowBases=new Map<Mesh,{depth:MeshDepthMaterial;distance:MeshDistanceMaterial}>();
 const owner='environment-'+Math.random().toString(36).slice(2),ownedMaterials=new Set<MeshStandardMaterial|MeshDepthMaterial|MeshDistanceMaterial>(),originals=new Map<string,MeshStandardMaterial|MeshDepthMaterial|MeshDistanceMaterial>();
 const shadowMaterials=new Set<MeshDepthMaterial|MeshDistanceMaterial>();
 // Preserve colour capacity even when many nodes retain authored depth passes.
 const maximumColourMaterials=384,maximumShadowMaterials=128,maximumColourPublication=32;
 function updateMaterialOwnershipStats(){stats.ownedColourMaterials=ownedMaterials.size-shadowMaterials.size;stats.ownedShadowMaterials=shadowMaterials.size;}
 const compiled=new WeakMap<MeshStandardMaterial|MeshDepthMaterial|MeshDistanceMaterial,Map<string,{material:MeshStandardMaterial|MeshDepthMaterial|MeshDistanceMaterial;ready:boolean}>>();
 function windBindingFor(mesh:Mesh,material:MeshStandardMaterial|MeshDepthMaterial|MeshDistanceMaterial,forcedBinding?:VegetationWindBinding):VegetationWindBinding|undefined{
  const candidate=forcedBinding??mesh.userData.crownfallVegetationWind;
  // Only plant owners may grant wind. A material label or a raised terrain
  // vertex is never evidence of vegetation; soil and collision stay rigid.
  const kind=mesh.userData.crownfallElderbloom?.kind,cellKind=mesh.userData.crownfallInstanceCell?.kind;
  const nonVegetation=['terrain','water','rock','debris','building','structure'].includes(kind)||cellKind==='rock'||cellKind==='debris'||Boolean(material.userData.crownfallWaterLook||material.userData.crownfallRiver||material.userData.crownfallRiverSurface);
  const binding:VegetationWindBinding|undefined=!nonVegetation&&!('isSkinnedMesh' in mesh)&&candidate&&Array.isArray(candidate.root)&&candidate.root.length===3&&candidate.root.every(Number.isFinite)&&Array.isArray(candidate.tip)&&candidate.tip.length===3&&candidate.tip.every(Number.isFinite)?candidate:undefined;
  return binding;
 }
 function adapt(original:MeshStandardMaterial|MeshDepthMaterial|MeshDistanceMaterial,mesh:Mesh,shadow=false,forcedBinding?:VegetationWindBinding,shadowState?:{ready:boolean},admit=true){
  const fallback=original;
  if(!isWorldGeometryReaderActive(mesh.geometry)){scanUnresolved=true;if(shadowState)shadowState.ready=false;return fallback;}
  // Re-enter through the authored source when a live quality change needs a
  // different weather variant. Keep the valid old program until it is ready.
  if(original.userData.crownfallEnvironmentOwner===owner&&ownedMaterials.has(original))original=originals.get(original.userData.crownfallEnvironmentOriginal)??original;
  const binding=windBindingFor(mesh,original,forcedBinding);
  const weather=!shadow&&!options.native&&options.quality()!=='low';
  if(!weather&&!binding)return original;
  const variant=[mesh instanceof InstancedMesh,'isSkinnedMesh' in mesh,!!mesh.geometry.morphAttributes.position,!!mesh.geometry.morphAttributes.normal,mesh instanceof InstancedMesh&&!!mesh.instanceColor,mesh.geometry.hasAttribute('tangent'),mesh.geometry.hasAttribute('crownfallLodRange'),binding?vegetationWindBindingKey(binding):'no-wind',weather].join(':');
  const cache=compiled.get(original),existing=cache?.get(variant);if(existing){if(!existing.ready){scanUnresolved=true;if(shadowState)shadowState.ready=false;}return existing.ready?existing.material:fallback;}
  scanUnresolved=true;if(shadowState)shadowState.ready=false;
  const budgetHeld=shadow?shadowMaterials.size>=maximumShadowMaterials:ownedMaterials.size-shadowMaterials.size>=maximumColourMaterials;
  if(!shadow&&budgetHeld)stats.colourBudgetHeld=true;
  if(!shadow&&admit&&!budgetHeld){if(colourPressureHold)colourPressureSkipped=true;else if(colourAdmissionSlots<=0)colourStageHeld=true;}
  if(!admit||stats.materialProgramsPending>=2||budgetHeld||!shadow&&(colourPressureHold||colourAdmissionSlots<=0))return fallback;
  acquireWorldGeometryReader(mesh.geometry,()=>{
  if(!shadow)colourAdmissionSlots--;
  const material=original.clone(),compile=original.onBeforeCompile,key=original.customProgramCacheKey;
  material.onBeforeRender=original.onBeforeRender;
  material.onBeforeCompile=function(shader,renderer){compile.call(this,shader,renderer);if(weather)patchWorldEnvironmentMaterial(shader,uniforms,false,/water|river|pond|sea/i.test(original.name),ShaderChunk.lights_fragment_begin);if(binding)patchVegetationWind(shader,uniforms,binding);};
  // Root/tip/flex are per-material uniforms; their values must not compile a
  // separate GPU program for every otherwise identical plant geometry.
  material.customProgramCacheKey=()=>key.call(original)+':'+WORLD_ENVIRONMENT_SHADER_VERSION+':'+CLOUD_SAMPLING_VERSION+':'+weather+':wind:'+Boolean(binding)+(binding?':'+VEGETATION_WIND_SHADER_VERSION:'');
  material.userData.crownfallWindBinding=binding;material.userData.crownfallEnvironmentOwner=owner;material.userData.crownfallEnvironmentOriginal=original.uuid;
  originals.set(original.uuid,original);ownedMaterials.add(material);if(shadow&&(material instanceof MeshDepthMaterial||material instanceof MeshDistanceMaterial))shadowMaterials.add(material);updateMaterialOwnershipStats();const entry={material,ready:false},variants=cache??new Map();variants.set(variant,entry);compiled.set(original,variants);
  stats.materialProgramsPending++;if(shadow)stats.shadowMaterialProgramsPending++;const preview=mesh.clone(false);preview.material=material;preview.visible=true;preview.frustumCulled=false;
  const ready=options.queue.enqueue({bytes:0,signal,priority:()=>isActiveDraw(mesh)?50:145,work:async()=>{
   const previous=options.renderer.debug.onShaderError;let failure='';
   options.renderer.debug.onShaderError=(gl,program,vertex,fragment)=>{if((gl.getShaderSource(fragment)??'').includes('CROWNFALL_WORLD_ENVIRONMENT')||(gl.getShaderSource(vertex)??'').includes('CROWNFALL_VEGETATION_WIND'))failure=gl.getProgramInfoLog(program)??'Environment material shader failed.';previous?.(gl,program,vertex,fragment);};
   try{await options.renderer.compileAsync(preview,options.camera,options.scene);}finally{options.renderer.debug.onShaderError=previous;}
   if(failure)throw Error(failure);
  }}).then(()=>{if(!disposed){entry.ready=true;if(binding){if(shadow)stats.windShadowProgramsReady++;else stats.windProgramsReady++;}lastScan=-Infinity;}}).catch(cause=>{
   if(disposed||signal.aborted)return;
   if(/bounded job\/upload budget/.test(String(cause))){
    // Queue pressure is temporary. Retain the GLB material, retire this unused
    // clone and let the next bounded scan retry instead of caching it forever.
    if(!shadow)colourPressureHold=true;
    if(variants.get(variant)===entry)variants.delete(variant);
    ownedMaterials.delete(material);if(material instanceof MeshDepthMaterial||material instanceof MeshDistanceMaterial)shadowMaterials.delete(material);updateMaterialOwnershipStats();material.dispose();if(!stats.surfaceWeatherError)stats.surfaceWeather='waiting-for-upload-budget';
   }else{stats.surfaceWeatherError=String(cause);stats.surfaceWeather='fallback-shader';}
  }).finally(()=>{stats.materialProgramsPending--;if(shadow)stats.shadowMaterialProgramsPending--;if(!disposed)lastScan=-Infinity;if(preview instanceof InstancedMesh)preview.dispose();notifyChange(shadow&&!entry.ready?'visual':'preparation');});
  return{ready,release(){}};});
  return fallback;
 }
 const skyRecords:{material:ShaderMaterial;fragment:string;vertex:string;tone:boolean}[]=[];
 const skyNodes:Mesh[]=[];
 options.atmosphere.traverse(node=>{if(!(node instanceof Mesh)||!(node.material instanceof ShaderMaterial))return;
 const material=node.material,fragment=material.fragmentShader;skyRecords.push({material,fragment,vertex:material.vertexShader,tone:material.toneMapped});skyNodes.push(node);
 material.vertexShader='varying vec3 cfCloudWorldRay;\n'+material.vertexShader.replace(/void main\s*\(\s*\)\s*\{/,`void main(){cfCloudWorldRay=(modelMatrix*vec4(position,1.)).xyz-cameraPosition;`).replace(/gl_Position = ([^;]+);/,'gl_Position = $1; gl_Position.z = gl_Position.w*.999999;');Object.assign(material.uniforms,uniforms);
 if(fragment.includes('ealdholtProjectFar')){
  const begin=fragment.indexOf('  if (projected.a < .5) {'),end=fragment.indexOf('  gl_FragColor =',begin);
  if(begin<0||end<0)throw Error('Unsupported far atmosphere shader.');
  material.fragmentShader='varying vec3 cfCloudWorldRay;\n'+worldSkyShader(stats.cloudSteps)+fragment.slice(0,begin)+`  if(projected.a<.5)colour=sky;else colour*=mix(vec3(.045,.065,.10),vec3(1.),cfDaylight);\n`+fragment.slice(end);
  material.fragmentShader=material.fragmentShader.replace(/vec3 sky = [^;]+;/,'vec3 sky = cfSky(normalize(cfCloudWorldRay));');
 }else material.fragmentShader='varying vec3 cfCloudWorldRay;\n'+worldSkyShader(stats.cloudSteps)+`void main(){gl_FragColor=vec4(cfSky(normalize(cfCloudWorldRay)),1.);\n#include <colorspace_fragment>\n}`;
 material.fragmentShader=material.fragmentShader.replace('#include <colorspace_fragment>','#include <tonemapping_fragment>\n#include <colorspace_fragment>');material.toneMapped=true;material.needsUpdate=true;
 });
 const clearCache=()=>{void cache.clear();};if(import.meta.env?.DEV)window.addEventListener('crownfall:clear-environment-cache',clearCache);
 // Only one density texture waits here. Queue pressure retries its upload at
 // one-second intervals, without restarting the worker or changing bake keys.
 async function uploadCloudDensity(texture:Data3DTexture,bytes:number){
  for(;;){
   signal.throwIfAborted();
   try{await options.queue.enqueue({bytes,signal,priority:()=>110,work:()=>options.renderer.initTexture(texture)});return;}
   catch(cause){
    signal.throwIfAborted();if(!/bounded job\/upload budget/.test(String(cause)))throw cause;
    stats.status='waiting-for-cloud-upload';stats.cloudUploadRetries++;notifyChange('preparation');
    await new Promise<void>((resolve,reject)=>{
     const finish=()=>{signal.removeEventListener('abort',cancel);resolve();};
     const timer=setTimeout(finish,1000);
     const cancel=()=>{clearTimeout(timer);signal.removeEventListener('abort',cancel);reject(signal.reason??Error('Cloud upload cancelled.'));};
     signal.addEventListener('abort',cancel,{once:true});if(signal.aborted)cancel();
    });
   }
  }
 }
 async function prepareClouds(){if(started||disposed)return;started=true;stats.status='preparing-cloud-density';const metadata=cloudDensityCacheMetadata(width,height);
  try{const key=await worldBakeKey('cloud-density',metadata),epoch=cache.generation,cached=await cache.get(key,b=>b.metadata===metadata&&validateCloudDensityVolume(b.data,width,height),signal);signal.throwIfAborted();
   const data=cached?cached.data:await new Promise<Uint8Array>((resolve,reject)=>{
    worker=new Worker(new URL('./cloud-density.worker.ts',import.meta.url),{type:'module'});
    const finish=()=>{worker?.terminate();worker=null;signal.removeEventListener('abort',cancel);};const cancel=()=>{finish();reject(Error('Cloud baking cancelled.'));};signal.addEventListener('abort',cancel,{once:true});
    worker.onerror=e=>{finish();reject(Error(e.message));};worker.onmessage=(e:MessageEvent<{data?:Uint8Array;error?:string;backend?:string;fallbackReason?:string}>)=>{finish();if(e.data.data){stats.cloudBackend=e.data.backend??'cpu-worker';stats.cloudFallbackReason=e.data.fallbackReason??'';resolve(e.data.data);}else reject(Error(e.data.error??'Cloud density unavailable.'));};worker.postMessage({width,height});
   });signal.throwIfAborted();
   if(!validateCloudDensityVolume(data,width,height))throw Error('Invalid versioned RG8 cloud source.');
   const texture=new Data3DTexture(data,width,height,width);texture.format=RGFormat;texture.minFilter=texture.magFilter=LinearFilter;texture.wrapS=texture.wrapR=RepeatWrapping;texture.unpackAlignment=1;texture.needsUpdate=true;
   try{await uploadCloudDensity(texture,data.byteLength);signal.throwIfAborted();}
   catch(cause){texture.dispose();throw cause;}
   density=texture;uniforms.cfCloudDensity.value=texture;stats.cloudBytes=data.byteLength;if(cached){stats.cloudDensityRestores++;stats.cloudBackend='persistent-density';}else{stats.cloudDensityBuilds++;void cache.put(key,{metadata,data},signal,epoch);}
   lastMinute=-Infinity;stats.status='ready';notifyChange();
  }catch(cause){if(disposed)return;stats.status='sky-fallback';stats.error=String(cause);notifyChange();}
 }
 function isActiveDraw(mesh:Mesh):boolean{
  if((mesh instanceof InstancedMesh&&mesh.count===0)||mesh.geometry.drawRange.count===0)return false;
  if((Array.isArray(mesh.material)?mesh.material:[mesh.material]).every(material=>!material.visible))return false;
  for(let node:Object3D|null=mesh;node;node=node.parent){if(!node.visible)return false;if(node===options.sourceRoot)break;}
  return true;
 }
 function prepareMaterials(now:number,force=false):boolean{
  if(disposed)return false;
  const quality=options.quality();if(quality!==lastQuality){lastQuality=quality;lastScan=-Infinity;lastMinute=-Infinity;}
  if(!force&&now-lastScan<=5000)return false;lastScan=now;scanMaterials();return true;
 }
 function scanMaterials(){scanUnresolved=false;colourStageHeld=false;colourPressureSkipped=false;let visiblePublication=false;
  const shadowUpdates:{mesh:Mesh;depth:Mesh['customDepthMaterial'];distance:Mesh['customDistanceMaterial'];ready:boolean}[]=[];stats.colourBudgetHeld=false;stats.activeWindMaterialSlots=0;stats.activeWindReadyMaterialSlots=0;const live=new Set<MeshStandardMaterial>();
  const plants:Mesh[]=[],other:Mesh[]=[],dormant:Mesh[]=[];
  options.sourceRoot.traverse(node=>{if(node instanceof Mesh)(isActiveDraw(node)?node.userData.crownfallVegetationWind?plants:other:dormant).push(node);});
  const pendingColour=()=>stats.materialProgramsPending-stats.shadowMaterialProgramsPending;
  const readyCapacity=Math.max(0,maximumColourPublication-pendingColour());
  const nodes=[...plants,...other,...dormant],readyColours=new Set<Material>();
  const colourUpdates:{mesh:Mesh;geometry:Mesh['geometry'];old:Mesh['material'];next:Material[]}[]=[];
  // Resolve current variants without admitting work. Private ready programs do
  // not mutate a visible binding or count as active wind coverage yet.
  for(const mesh of nodes){const old=mesh.material,list=Array.isArray(old)?old:[old],next=list.map(material=>material instanceof MeshStandardMaterial?adapt(material,mesh,false,undefined,undefined,false):material);
   if(next.some((material,i)=>material!==list[i])){colourUpdates.push({mesh,geometry:mesh.geometry,old,next});for(let i=0;i<next.length;i++)if(next[i]!==list[i]&&readyColours.size<readyCapacity)readyColours.add(next[i]);}
  }
  colourAdmissionSlots=Math.max(0,maximumColourPublication-readyColours.size-pendingColour());
  for(const mesh of nodes)for(const material of Array.isArray(mesh.material)?mesh.material:[mesh.material])if(material instanceof MeshStandardMaterial)adapt(material,mesh);
  const current=(row:typeof colourUpdates[number])=>{if(row.mesh.geometry!==row.geometry||!isWorldGeometryReaderActive(row.geometry))return false;let parent:Object3D|null=row.mesh;while(parent&&parent!==options.sourceRoot)parent=parent.parent;return parent===options.sourceRoot;};
  let colourPublished=false;
  // Only admitted colour work gates a partial cohort. Future graph rows,
  // terminal failures, shadows and the global preparation queue cannot hold it.
  if(readyColours.size>=maximumColourPublication||pendingColour()===0){
   const publish=new Set([...readyColours].slice(0,maximumColourPublication));
   for(const row of colourUpdates){if(!current(row)||row.mesh.material!==row.old)continue;const list=Array.isArray(row.old)?row.old:[row.old],next=row.next.map((material,i)=>publish.has(material)?material:list[i]);
    if(next.some((material,i)=>material!==list[i])){const wasActive=isActiveDraw(row.mesh);row.mesh.material=Array.isArray(row.old)?next:next[0];visiblePublication=wasActive||isActiveDraw(row.mesh)||visiblePublication;colourPublished=true;}
   }
   if(colourPublished)stats.colourPublicationBatches++;
  }
  const unpublishedColours=new Set<Material>();
  for(const row of colourUpdates){if(!current(row))continue;const assigned=Array.isArray(row.mesh.material)?row.mesh.material:[row.mesh.material];for(let i=0;i<row.next.length;i++)if(row.next[i]!==assigned[i])unpublishedColours.add(row.next[i]);}
  stats.colourReadyUnpublished=unpublishedColours.size;
  stats.colourMaterialsStaged=Math.min(unpublishedColours.size,Math.max(0,maximumColourPublication-pendingColour()));
  // An enqueue refusal gets one no-admission drain/flush scan, not an immediate
  // retry loop. A real partial publication buys one eligible continuation;
  // without new ready progress, the existing scan cadence remains the fallback.
  if(colourPressureHold&&pendingColour()===0)colourPressureHold=false;
  const continueColour=colourPublished&&(colourStageHeld||colourPressureSkipped||unpublishedColours.size>0);
  if(continueColour)lastScan=-Infinity;
  for(const node of nodes){
   if(!isWorldGeometryReaderActive(node.geometry))continue;
   const list=Array.isArray(node.material)?node.material:[node.material],next=list;
   if(isActiveDraw(node))for(const material of next){
    if(!(material instanceof MeshStandardMaterial)||!material.visible)continue;
    const eligible=windBindingFor(node,material);if(!eligible)continue;
    stats.activeWindMaterialSlots++;
    const assigned=material.userData.crownfallWindBinding;
    if(ownedMaterials.has(material)&&material.userData.crownfallEnvironmentOwner===owner&&assigned&&vegetationWindBindingKey(assigned)===vegetationWindBindingKey(eligible))stats.activeWindReadyMaterialSlots++;
   }

   const windBinding=node.userData.crownfallVegetationWind??next.find(material=>material.userData.crownfallWindBinding)?.userData.crownfallWindBinding;
   const colourReady=next.some(material=>(material instanceof MeshStandardMaterial)&&ownedMaterials.has(material)&&material.userData.crownfallEnvironmentOwner===owner&&material.userData.crownfallWindBinding);
   if(options.renderer.shadowMap?.enabled!==true||!node.castShadow){const prior=shadowOriginals.get(node);if(prior){node.customDepthMaterial=prior.depth;node.customDistanceMaterial=prior.distance;}}
   if(windBinding&&colourReady&&options.renderer.shadowMap?.enabled===true&&node.castShadow&&(shadowBases.has(node)||(stats.materialProgramsPending<2&&shadowMaterials.size<=maximumShadowMaterials-4))){
    if(!shadowOriginals.has(node))shadowOriginals.set(node,{depth:node.customDepthMaterial,distance:node.customDistanceMaterial});
    let bases=shadowBases.get(node);
    if(!bases){const source=list.find(m=>m instanceof MeshStandardMaterial);bases={depth:new MeshDepthMaterial({depthPacking:RGBADepthPacking}),distance:new MeshDistanceMaterial()};
     if(source instanceof MeshStandardMaterial)for(const material of [bases.depth,bases.distance]){material.map=source.map;material.alphaMap=source.alphaMap;material.alphaTest=source.alphaTest;material.side=source.side;}
     shadowBases.set(node,bases);ownedMaterials.add(bases.depth);ownedMaterials.add(bases.distance);shadowMaterials.add(bases.depth);shadowMaterials.add(bases.distance);}
    const prior=shadowOriginals.get(node)!;
    const depth=prior.depth??bases.depth,distance=prior.distance??bases.distance;
    // Keep previous valid bindings until admitted shadow work is ready;
    // a private compile result is not a shadow-map publication.
    const shadowState={ready:true};
    const nextDepth=depth instanceof MeshDepthMaterial?adapt(depth,node,true,windBinding,shadowState):node.customDepthMaterial;
    const nextDistance=distance instanceof MeshDistanceMaterial?adapt(distance,node,true,windBinding,shadowState):node.customDistanceMaterial;
    shadowUpdates.push({mesh:node,depth:nextDepth,distance:nextDistance,ready:shadowState.ready});
   }

   for(const material of next){if(!(material instanceof MeshStandardMaterial))continue;live.add(material);if(materialRecords.has(material))continue;
    const intensity=typeof material.userData.crownfallEnvironmentBaseIntensity==='number'?material.userData.crownfallEnvironmentBaseIntensity:material.envMapIntensity;
    material.userData.crownfallEnvironmentBaseIntensity=intensity;materialRecords.set(material,{intensity});
    // A long private compile must not publish clone-creation-time IBL. Read the
    // latest already sampled state, without inventing or advancing the clock.
    if(!options.native&&state&&material.envMap)material.envMapIntensity=intensity*(.045+.955*state.daylight)*state.cloudTransmission;
   }}
  for(const [material,record]of materialRecords)if(!live.has(material)){material.envMapIntensity=record.intensity;delete material.userData.crownfallEnvironmentBaseIntensity;materialRecords.delete(material);}
  updateMaterialOwnershipStats();stats.materials=materialRecords.size;if(!stats.surfaceWeatherError)stats.surfaceWeather=stats.materialProgramsPending?'compiling':options.native||options.quality()==='low'?'wind-only-lighting-fallback':'progressive-material-weather';
  const unresolved=scanUnresolved||stats.materialProgramsPending>0||unpublishedColours.size>0,settled=unresolvedMaterialGraph&&!unresolved;
  // Only admitted shadow work gates this cohort. A failed or budget-held
  // unrelated colour variant must not starve already prepared shadow pairs.
  if(stats.shadowMaterialProgramsPending===0)for(const {mesh,depth,distance,ready}of shadowUpdates){
   if(!ready)continue;
   if(mesh.customDepthMaterial===depth&&mesh.customDistanceMaterial===distance)continue;
   mesh.customDepthMaterial=depth;mesh.customDistanceMaterial=distance;
   // Desktop caches its shadow map (autoUpdate=false). The ready wake must
   // consume these new bindings even with a static sun/camera/paused clock.
   options.renderer.shadowMap.needsUpdate=true;visiblePublication=true;
  }
  unresolvedMaterialGraph=unresolved;stats.materialGraphPending=unresolved;
  if(settled)notifyChange('ready');else if(visiblePublication)notifyChange('visual');else if(continueColour)notifyChange('preparation');
 }
 // Native orbit/zoom can change these frames while the saved calendar holds.
 // Compare actual matrices before touching lunar placement; no clock resampling,
 // shader recompilation or cloud preparation belongs to this presentation step.
 function updateCelestialWorldFrame(force=false){
  if(!state)return false;
  options.sun.updateWorldMatrix(true,false);options.sun.target.updateWorldMatrix(true,false);
  const parentFrame=options.sun.parent?.matrixWorld??identityFrame;
  if(!force&&celestialFrameReady&&celestialSourceFrame.equals(options.sourceRoot.matrixWorld)&&celestialSunFrame.equals(options.sun.matrixWorld)&&celestialSunTargetFrame.equals(options.sun.target.matrixWorld)&&celestialSunParentFrame.equals(parentFrame))return false;
  celestialSourceFrame.copy(options.sourceRoot.matrixWorld);celestialSunFrame.copy(options.sun.matrixWorld);celestialSunTargetFrame.copy(options.sun.target.matrixWorld);celestialSunParentFrame.copy(parentFrame);celestialFrameReady=true;
  cloudSun.setFromMatrixPosition(options.sun.matrixWorld).sub(cloudSunTarget.setFromMatrixPosition(options.sun.target.matrixWorld)).normalize();(uniforms.cfWorldSun.value as Vector3).copy(cloudSun);
  moonDirection.fromArray(state.celestial.orbitTangent);if(options.sun.parent)moonDirection.transformDirection(options.sun.parent.matrixWorld);
  moonDirection.addScaledVector(cloudSun,-moonDirection.dot(cloudSun));
  if(moonDirection.lengthSq()<1e-12){moonDirection.set(Math.abs(cloudSun.x)<.9?1:0,0,Math.abs(cloudSun.x)<.9?0:1);moonDirection.addScaledVector(cloudSun,-moonDirection.dot(cloudSun));}moonDirection.normalize();
  const lunarAngle=state.celestial.moonPhase*Math.PI*2;
  moonWorldDirection.copy(cloudSun).multiplyScalar(Math.cos(lunarAngle)).addScaledVector(moonDirection,-Math.sin(lunarAngle)).normalize();
  moon.target.position.set(25,1,25);moon.target.getWorldPosition(moonWorldTarget);moon.position.copy(moonWorldTarget).addScaledVector(moonWorldDirection,145).applyMatrix4(inverse);moon.intensity=state.moonIntensity;
  moon.getWorldPosition(moonWorldDirection).sub(moonWorldTarget).normalize();(uniforms.cfWorldMoon.value as Vector3).copy(moonWorldDirection);
  uniforms.cfMoonIllumination.value=state.celestial.moonIllumination;uniforms.cfMoonVisibility.value=state.celestial.moonVisibility;uniforms.cfMoonWashout.value=state.celestial.moonWashout;uniforms.cfNightVisibility.value=state.celestial.nightVisibility;(uniforms.cfStarRotation.value as Vector2).set(Math.cos(state.celestial.starRotationRadians),Math.sin(state.celestial.starRotationRadians));
  stats.moonPhase=state.celestial.moonPhase;stats.moonIllumination=state.celestial.moonIllumination;stats.moonDirection[0]=moonWorldDirection.x;stats.moonDirection[1]=moonWorldDirection.y;stats.moonDirection[2]=moonWorldDirection.z;stats.nightVisibility=state.celestial.nightVisibility;stats.milkyWayVisibility=state.celestial.nightVisibility*(1.-.94*state.celestial.moonWashout);
  for(const record of skyRecords)if(record.material.uniforms.uEaldholtFarSourceSun)record.material.uniforms.uEaldholtFarSourceSun.value=sourceSun.copy(cloudSun).transformDirection(inverse);
  return true;
 }
 function dispose(){if(disposed)return;disposed=true;controller.abort();worker?.terminate();worker=null;options.signal.removeEventListener('abort',dispose);
  if(import.meta.env?.DEV)window.removeEventListener('crownfall:clear-environment-cache',clearCache);cache.close();
  moon.removeFromParent();moon.target.removeFromParent();moon.dispose();
  for(const [material,record]of materialRecords){material.envMapIntensity=record.intensity;delete material.userData.crownfallEnvironmentBaseIntensity;material.needsUpdate=true;}
  options.sourceRoot.traverse(node=>{if(!(node instanceof Mesh))return;const old=node.material,list=Array.isArray(old)?old:[old];const next=list.map(material=>material.userData.crownfallEnvironmentOwner===owner?originals.get(material.userData.crownfallEnvironmentOriginal)??material:material);if(next.some((m,i)=>m!==list[i]))node.material=Array.isArray(old)?next:next[0];});
  for(const [mesh,prior]of shadowOriginals){mesh.customDepthMaterial=prior.depth;mesh.customDistanceMaterial=prior.distance;}shadowOriginals.clear();shadowBases.clear();
  for(const record of skyRecords){record.material.fragmentShader=record.fragment;record.material.vertexShader=record.vertex;record.material.toneMapped=record.tone;record.material.needsUpdate=true;}
  void options.queue.whenIdle().then(()=>{fallback.dispose();if(density!==fallback)density.dispose();for(const material of ownedMaterials)material.dispose();ownedMaterials.clear();shadowMaterials.clear();updateMaterialOwnershipStats();});stats.status='disposed';
 }
 options.signal.addEventListener('abort',dispose,{once:true});if(options.signal.aborted)dispose();
 options.sun.getWorldPosition(cloudSun).sub(options.sun.target.getWorldPosition(cloudSunTarget)).normalize();(uniforms.cfWorldSun.value as Vector3).copy(cloudSun);
 if(!disposed)void prepareClouds();
 return{stats,get cloudField(){return{texture:density,revision:CLOUD_DENSITY_VERSION,coverage:uniforms.cfCloudCoverage.value as number,globalTransmission:uniforms.cfCloudGlobalTransmission.value as number,offset:[(uniforms.cfCloudOffset.value as Vector2).x,(uniforms.cfCloudOffset.value as Vector2).y] as const,sourceToWorld:options.sourceRoot.matrixWorld.toArray(),sunDirection:[(uniforms.cfWorldSun.value as Vector3).x,(uniforms.cfWorldSun.value as Vector3).y,(uniforms.cfWorldSun.value as Vector3).z] as const,enabled:!options.native&&options.quality()!=='low'&&density!==fallback};},get state(){return state;},get animationSeconds(){return uniforms.cfEnvironmentSeconds.value as number;},
 // Prewarm materials during loading or while a world draw waits on its GPU
 // fence. Force once after source owners publish their final material graph;
 // uniform values stay live, with no clock reads, relighting or world renders.
 prepare(now:number,force=false){return prepareMaterials(now,force);},update(now:number){
  if(disposed)return false;const clock=options.readClock();if(!clock)return false;
  options.sourceRoot.updateWorldMatrix(true,false);inverse.copy(options.sourceRoot.matrixWorld).invert();options.camera.getWorldPosition(eye);
  prepareMaterials(now);
  for(const sky of skyNodes){if(!sky.parent)continue;sky.parent.updateWorldMatrix(true,false);options.camera.getWorldPosition(direction);sky.position.copy(direction).applyMatrix4(skyInverse.copy(sky.parent.matrixWorld).invert());sky.updateWorldMatrix(false,false);}
  // Cloud/wind animation follows the saved clock on every rendered frame,
  // independently of the coarser sun/weather sampling interval.
  // Shaders get session-relative seconds (L-19); cloud drift keeps the world-time double.
  const animationSeconds=options.reducedMotion()?0:clock.animationSeconds,shaderSeconds=shaderTime.seconds(animationSeconds),animationChanged=uniforms.cfEnvironmentSeconds.value!==shaderSeconds;
  uniforms.cfEnvironmentSeconds.value=shaderSeconds;stats.cloudMotionSeconds=animationSeconds;const windStrength=options.reducedMotion()?0:state?.windStrength??0,windChanged=uniforms.cfWindStrength.value!==windStrength;uniforms.cfWindStrength.value=windStrength;stats.windStrength=windStrength;
  const offset=uniforms.cfCloudOffset.value as Vector2;
  updateCloudOffset(offset,animationSeconds,state?.wind??[1,.35],state?.windStrength??.3,options.reducedMotion());stats.cloudOffset[0]=offset.x;stats.cloudOffset[1]=offset.y;
  const minute=clock.time.absoluteWorldMinute+clock.time.fractionalMinute;
  const override=options.override?.(),overrideKey=override?JSON.stringify(override):'';
  if(Math.abs(minute-lastMinute)<.015&&overrideKey===lastOverrideKey){const frameChanged=updateCelestialWorldFrame();return animationChanged||windChanged||frameChanged;}lastMinute=minute;lastOverrideKey=overrideKey;state=sampleWorldEnvironment(clock.time,clock.worldKey,override);void prepareClouds();
  stats.hour=state.hour;stats.minute=state.minute;stats.day=state.dayIndex;stats.weather=state.weather;stats.rain=state.rain;stats.wetness=state.wetness;stats.daylight=state.daylight;
  if(state.hour!==publishedHour||state.minute!==publishedMinute||state.dayIndex!==publishedDay||state.weather!==publishedWeather){
   publishedHour=state.hour;publishedMinute=state.minute;publishedDay=state.dayIndex;publishedWeather=state.weather;
   options.statusChanged?.({hour:state.hour,minute:state.minute,dayIndex:state.dayIndex,weather:state.weather});
  }
  direction.fromArray(state.sunDirection);options.setSunDirection(direction);
  options.sun.intensity=state.sunIntensity;options.sun.color.setRGB(...state.sunColour);
  updateCelestialWorldFrame(true);

  if(options.fill){
   // Colour owns linear irradiance; the existing GI bridge reads colour*power.
   // Retain the authored ground-side curve and exact noon energy separately.
   options.fill.intensity=1;options.fill.color.setRGB(...worldSkyIrradiance(state));
   if(fillGround)options.fill.groundColor.copy(fillGround).multiplyScalar(EALDHOLT_VILLAGE_DAYLIGHT.hemisphereIntensity*(.1+.9*state.daylight));
  }
  (uniforms.cfSkyZenith.value as Color).setRGB(...state.skyZenith);(uniforms.cfSkyHorizon.value as Color).setRGB(...state.skyHorizon);(uniforms.cfSunColour.value as Color).setRGB(...state.sunColour);
  uniforms.cfCloudLightingEnabled.value=!options.native&&options.quality()!=='low'&&density!==fallback?1:0;uniforms.cfCloudCoverage.value=state.cloudCoverage;uniforms.cfCloudGlobalTransmission.value=state.cloudTransmission;uniforms.cfDaylight.value=state.daylight;uniforms.cfRain.value=state.rain;uniforms.cfWorldWetness.value=options.quality()==='low'?0:state.wetness;
  uniforms.cfSurfaceWeatherEnabled.value=options.quality()==='low'?0:1;uniforms.cfWindStrength.value=options.reducedMotion()?0:state.windStrength;stats.windStrength=uniforms.cfWindStrength.value;stats.windDirection[0]=state.wind[0];stats.windDirection[1]=state.wind[1];(uniforms.cfWindDirection.value as {x:number;y:number}).x=state.wind[0];(uniforms.cfWindDirection.value as {x:number;y:number}).y=state.wind[1];
  const intensity=(.045+.955*state.daylight)*state.cloudTransmission;
  if(!options.native){options.scene.environmentIntensity=(options.quality()==='high'?1:options.quality()==='medium'?.95:.9)*intensity;
   if(options.scene.fog)options.scene.fog.color.setRGB(...state.skyHorizon);options.scene.backgroundIntensity=.045+.955*state.daylight;
   for(const [material,record]of materialRecords)if(material.envMap)material.envMapIntensity=record.intensity*intensity;
  }
  options.sourceRoot.userData.crownfallWorldConditions={hour:state.hour,day:state.dayIndex,weather:state.weather,rain:state.rain,windStrength:state.windStrength};
  if(now-lastEvent>1000){lastEvent=now;if(typeof window!=='undefined')window.dispatchEvent(new CustomEvent('crownfall:world-weather',{detail:{hour:state.hour,day:state.dayIndex,rain:state.rain,windStrength:state.windStrength,weather:state.weather}}));}
  return true;
 },dispose};
}
export type WorldEnvironment=ReturnType<typeof createWorldEnvironment>;
