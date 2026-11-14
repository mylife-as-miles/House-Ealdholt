import{Group,InstancedMesh,Texture,type Camera,type Scene,type WebGLRenderer}from'three';
import type{GLTF}from'three/addons/loaders/GLTFLoader.js';
import{naturalRiparianAsset,naturalRiparianLimit,naturalRiparianReservation}from'../../../../shared/legacy/aethelgard/environment/natural-riparian-policy';
import type{WorldPreparationQueue}from'../../../../shared/legacy/aethelgard/environment/world-preparation-queue';
import{prepareNaturalRiparianAsset,type NaturalRiparianPreparedSource}from'./natural-riparian-source';
import{createWorldResourceRetirementFence}from'./world-resource-retirement';
import{compileNaturalRiparianPrograms}from'./natural-riparian-program';
/** One optional bounded source pair, no simulation or independent draw budget.
 * The groundcover owner admits these meshes jointly with the ordinary grass. */
export function createNaturalRiparianPlants(options:{renderer:WebGLRenderer;scene:Scene;camera:Camera;queue:WorldPreparationQueue;signal:AbortSignal;native?:boolean;load():Promise<GLTF>;changed():void;retirementFence?:()=>Promise<void>},prepare=prepareNaturalRiparianAsset){
 const object=new Group();object.name='Qualified natural riverbank plants';object.userData.crownfallRegionalGroundcover={nonSolid:true,naturalSource:true};object.userData.iwsdkPreviewBounds='exclude';
 const stats={status:'loading' as'loading'|'preparing'|'ready'|'fallback'|'disposed',error:'',reservationBytes:naturalRiparianReservation(options.native),accountedBytes:0,sourceSha256:naturalRiparianAsset(options.native).sha256,uploadedTextures:0,submitted:false,retiring:false,retired:false};
 const controller=new AbortController(),signal=controller.signal,fence=options.retirementFence??createWorldResourceRetirementFence(options.renderer,options.queue),meshes:InstancedMesh[]=[];
 let source:NaturalRiparianPreparedSource|null=null,disposed=false,retirement:Promise<void>=Promise.resolve();
 const destroy=(value:NaturalRiparianPreparedSource|null)=>{for(const mesh of meshes)mesh.dispose();meshes.length=0;value?.dispose();source=null;object.clear();stats.retiring=false;stats.retired=true;};
 const retire=()=>{if(stats.retiring||stats.retired)return;const value=source;if(stats.submitted){stats.retiring=true;retirement=options.queue.whenIdle().then(()=>fence()).then(()=>destroy(value));}else destroy(value);};
 function dispose(){if(disposed)return;disposed=true;controller.abort();options.signal.removeEventListener('abort',dispose);for(const mesh of meshes){mesh.count=0;mesh.visible=false;}object.removeFromParent();stats.status='disposed';
  retire();
 }
 options.signal.addEventListener('abort',dispose,{once:true});if(options.signal.aborted)dispose();
 const supported=typeof options.renderer.initTexture==='function'&&typeof options.renderer.compileAsync==='function'&&typeof options.renderer.getContext==='function'&&!!options.renderer.debug&&Array.isArray(options.renderer.info?.programs);
 if(!disposed&&!supported){stats.status='fallback';stats.error='Natural-source GPU preparation unsupported; retain original grass.';}
 if(!disposed&&supported)void Promise.resolve().then(()=>{signal.throwIfAborted();return options.load();}).then(asset=>prepare(asset,!!options.native,signal)).then(async value=>{
  if(disposed){value.dispose();return;}source=value;stats.accountedBytes=value.accountedBytes;if(value.accountedBytes>stats.reservationBytes)throw Error('Natural plant source exceeds its carved residency budget.');stats.status='preparing';
  for(const plant of value.plants){const mesh=new InstancedMesh(plant.geometry,plant.material,naturalRiparianLimit(options.native));mesh.name='Riparian grass '+plant.variant;mesh.count=0;mesh.visible=false;mesh.frustumCulled=false;mesh.castShadow=false;mesh.receiveShadow=true;mesh.raycast=()=>{};mesh.userData.crownfallVegetationWind={root:[0,plant.minimumY,0],tip:[0,plant.maximumY,0],grass:true};meshes.push(mesh);}
  const textures=new Set<Texture>();for(const plant of value.plants)for(const v of Object.values(plant.material))if(v instanceof Texture)textures.add(v);
  for(const texture of textures){const image=texture.image as{width:number;height:number};const bytes=texture.mipmaps?.length?texture.mipmaps.reduce((n,m)=>n+((m as{data?:Uint8Array}).data?.byteLength??0),0):Math.ceil(image.width*image.height*4*4/3);
   await options.queue.enqueue({signal,bytes,priority:()=>82,work:()=>{signal.throwIfAborted();stats.submitted=true;options.renderer.initTexture(texture);stats.uploadedTextures++;}});signal.throwIfAborted();}
  const preview=new Group();for(const mesh of meshes){const clone=mesh.clone(false);clone.visible=true;clone.count=1;preview.add(clone);}
  try{await options.queue.enqueue({signal,bytes:0,priority:()=>82,work:()=>{signal.throwIfAborted();stats.submitted=true;return compileNaturalRiparianPrograms(options.renderer,preview,options.camera,options.scene,value.plants.map(p=>p.material));}});}finally{for(const mesh of preview.children)if(mesh instanceof InstancedMesh)mesh.dispose();preview.clear();}
  signal.throwIfAborted();if(disposed)return;for(const mesh of meshes)object.add(mesh);stats.status='ready';options.changed();
 }).catch(cause=>{if(disposed)return;stats.status='fallback';stats.error=String(cause);for(const mesh of meshes){mesh.count=0;mesh.visible=false;}object.removeFromParent();
  retire();options.changed();
 });
 return{object,stats,meshes,get source(){return stats.status==='ready'?source:null;},dispose,whenRetired:()=>retirement};
}
