import {Frustum,Group,InstancedMesh,Matrix4,Mesh,Quaternion,Sphere,Vector2,Vector3,type Camera,type Object3D,type WebGLRenderer} from 'three';
import type {RegionalWorldLayout} from '../../../../shared/legacy/aethelgard/environment/regional-world-layout';
import {EALDHOLT_REGIONAL_WORLD} from '../../../../shared/legacy/aethelgard/environment/regional-world-policy';
import {createInstanceMatrixUploads} from '../../../../shared/legacy/aethelgard/environment/instance-matrix-writer';
import {REGIONAL_ROCK_LOD,REGIONAL_ROCK_LOD_VERSION,regionalRockPixelDiameter,regionalRockUsesNear,regionalRockWorldScale,type RegionalRockProjection} from '../../../../shared/legacy/aethelgard/environment/regional-rock-lod';

/** Scanned CC0 boulders use permanent layout data, culled instance buffers and
 * two index LODs. Loader templates own their geometry/materials/textures. */
export function createRegionalRocks(options:{sourceRoot:Object3D;camera:Camera;native?:boolean;signal:AbortSignal;
 renderer?:Pick<WebGLRenderer,'getDrawingBufferSize'>;cameras?:(camera:Camera)=>readonly Camera[];
 load(detail:'near'|'far'):Promise<Object3D>;changed():void}){
 const object=new Group();object.name='Namaqualand scanned woodland boulder clusters';object.userData.iwsdkPreviewBounds='exclude';
 object.userData.crownfallRegionalRocks={nonSolid:true,source:'Poly Haven Namaqualand CC0',navigationAuthority:false};
 const stats={status:'loading',error:'',placed:0,visible:0,near:0,far:0,renderedRocks:0,submittedRendererFrame:-1,drawCalls:0,triangles:0,
  lodPolicy:REGIONAL_ROCK_LOD_VERSION,screenSizeDemotions:0,projectionFallbacks:0,projectionViews:0,lodStateBytes:0,instanceBufferBytes:0,instanceFloatsQueued:0};
 // Unchanged instance lists upload nothing; changes upload only their span (L-14).
 const uploads=createInstanceMatrixUploads();
 let disposed=false,models:{near:Object3D;far:Object3D}|null=null,layout:RegionalWorldLayout|null=null,lastUpdate=-Infinity;
 const batches:{near:InstancedMesh;far:InstancedMesh}[]=[],inverse=new Matrix4(),projection=new Matrix4(),matrix=new Matrix4(),sphere=new Sphere(),position=new Vector3(),rotation=new Quaternion(),scale=new Vector3(),up=new Vector3(0,1,0),drawBuffer=new Vector2(),singleCamera:Camera[]=[options.camera];
 type View={camera:Camera;frustum:Frustum;validFrustum:boolean;fromSource:Matrix4;cameraInverse:Matrix4;eye:Vector3;sourceScale:number;projection:RegionalRockProjection};
 const views:View[]=[];let viewCount=0,nearState=new Uint8Array(0);
 function dispose(){if(disposed)return;disposed=true;object.removeFromParent();for(const b of batches){b.near.dispose();b.far.dispose();}batches.length=0;object.clear();nearState=new Uint8Array(0);views.length=0;layout=null;models=null;stats.lodStateBytes=stats.instanceBufferBytes=0;options.signal.removeEventListener('abort',dispose);stats.status='disposed';}
 options.signal.addEventListener('abort',dispose,{once:true});if(options.signal.aborted)dispose();
 void Promise.all([options.load('near'),options.load('far')]).then(([near,far])=>{if(disposed)return;models={near,far};stats.status='awaiting-layout';options.changed();}).catch(cause=>{if(!disposed){stats.status='held-error';stats.error=String(cause);options.changed();}});
 function assemble(next:RegionalWorldLayout){
  if(!models||layout||disposed)return;
  if(next.rocks.length%6||next.rocks.length/6>EALDHOLT_REGIONAL_WORLD.additionalRocks)throw Error('Regional rock instance budget exceeded.');
  layout=next;stats.placed=next.rocks.length/6;nearState=new Uint8Array(Math.ceil(stats.placed/8));stats.lodStateBytes=nearState.byteLength;
  for(let variant=0;variant<3;variant++){
   const id=['namaqualand_boulder_02','namaqualand_boulder_04','namaqualand_boulder_06'][variant];
   let capacity=0;for(let at=5;at<next.rocks.length;at+=6)if(next.rocks[at]===variant)capacity++;
   const pair={} as {near:InstancedMesh;far:InstancedMesh};
   for(const detail of ['near','far'] as const){const root=models[detail].getObjectByName(id);let part:Mesh|null=null;root?.traverse(node=>{if(node instanceof Mesh)part=node;});
    if(!part)throw Error('Missing scanned rock prototype: '+id);const source=part as Mesh,mesh=new InstancedMesh(source.geometry,source.material,capacity);
    mesh.name=id+':'+detail;mesh.count=0;mesh.frustumCulled=false;mesh.castShadow=false;mesh.receiveShadow=true;mesh.raycast=()=>{};
    mesh.onAfterRender=(renderer,_scene,camera)=>{if(camera!==options.camera)return;const frame=renderer.info.render.frame;if(stats.submittedRendererFrame!==frame){stats.submittedRendererFrame=frame;stats.renderedRocks=0;}stats.renderedRocks+=mesh.count;};
    object.add(mesh);pair[detail]=mesh;stats.instanceBufferBytes+=mesh.instanceMatrix.array.byteLength;
   }batches.push(pair);
  }stats.status='ready';options.changed();
 }
 function refreshViews(camera:Camera){
  singleCamera[0]=camera;const requested=options.cameras?.(camera),supplied=requested?.length?requested:singleCamera;
  const array=supplied.length===1?(supplied[0] as Camera&{isArrayCamera?:boolean;cameras?:Camera[]}):null;
  const cameras=array?.isArrayCamera&&array.cameras?.length?array.cameras:supplied;
  drawBuffer.set(0,0);try{options.renderer?.getDrawingBufferSize(drawBuffer);}catch{/* Unknown viewport retains the original distance LOD. */}
  const sourceScale=regionalRockWorldScale(options.sourceRoot.matrixWorld.elements)??NaN;viewCount=cameras.length;stats.projectionViews=viewCount;
  for(let i=0;i<viewCount;i++){
   const camera=cameras[i],flags=camera as Camera&{isPerspectiveCamera?:boolean;isOrthographicCamera?:boolean;near?:number;viewport?:{z:number;w:number}};
   let view=views[i];if(!view){view={camera,frustum:new Frustum(),validFrustum:false,fromSource:new Matrix4(),cameraInverse:new Matrix4(),eye:new Vector3(),sourceScale,projection:{kind:'unknown',projectionScaleX:0,projectionScaleY:0,drawBufferWidth:0,drawBufferHeight:0,nearPlane:0,viewDepth:0,viewOffset:0,radius:0}};views.push(view);}
   view.camera=camera;view.sourceScale=sourceScale;view.eye.setFromMatrixPosition(camera.matrixWorld).applyMatrix4(inverse);
   // Authoritative XR eye matrices belong to the world; never rebuild their TRS.
   view.fromSource.multiplyMatrices(view.cameraInverse.copy(camera.matrixWorld).invert(),options.sourceRoot.matrixWorld);
   const p=view.projection;p.kind=flags.isPerspectiveCamera?'perspective':flags.isOrthographicCamera?'orthographic':'unknown';p.projectionScaleX=Math.abs(camera.projectionMatrix.elements[0]);p.projectionScaleY=Math.abs(camera.projectionMatrix.elements[5]);p.nearPlane=flags.near??0;
   const viewport=flags.viewport,validViewport=viewport&&Number.isFinite(viewport.z)&&Number.isFinite(viewport.w)&&viewport.z>0&&viewport.w>0,flat=cameras.length===1&&!array?.isArrayCamera;
   p.drawBufferWidth=validViewport?viewport.z:flat?drawBuffer.x:0;p.drawBufferHeight=validViewport?viewport.w:flat?drawBuffer.y:0;
   view.validFrustum=p.kind!=='unknown'&&p.projectionScaleY>0&&camera.projectionMatrix.elements.every(Number.isFinite)&&view.fromSource.elements.every(Number.isFinite);
   if(view.validFrustum)view.frustum.setFromProjectionMatrix(projection.multiplyMatrices(camera.projectionMatrix,view.fromSource));
  }
 }
 return{object,stats,beginFrame(){stats.renderedRocks=0;stats.submittedRendererFrame=-1;},update(next:RegionalWorldLayout,camera:Camera,now:number,quality:'low'|'medium'|'high'){
  if(disposed||stats.status==='held-error')return;
  try{assemble(next);}catch(cause){stats.status='held-error';stats.error=String(cause);options.changed();return;}
  if(!layout||now-lastUpdate<180)return;lastUpdate=now;
  options.sourceRoot.updateWorldMatrix(true,false);inverse.copy(options.sourceRoot.matrixWorld).invert();refreshViews(camera);
  const policy=REGIONAL_ROCK_LOD[options.native?'native':'desktop'][quality];
  for(const b of batches)b.near.count=b.far.count=0;stats.visible=stats.near=stats.far=stats.drawCalls=stats.triangles=stats.screenSizeDemotions=stats.projectionFallbacks=0;
  for(let at=0;at<layout.rocks.length;at+=6){const p=layout.rocks,x=p[at],y=p[at+1],z=p[at+2],yaw=p[at+3],size=p[at+4],variant=p[at+5],id=at/6;
   sphere.center.set(x,y+size,z);sphere.radius=size*1.8;let visible=false,distance=Infinity,pixels=0,fallback=false;
   for(let i=0;i<viewCount;i++){const view=views[i],d=Math.hypot(x-view.eye.x,y-view.eye.y,z-view.eye.z);if(d>policy.range||view.validFrustum&&!view.frustum.intersectsSphere(sphere))continue;
    visible=true;distance=Math.min(distance,d);const projection=view.projection;
    position.copy(sphere.center).applyMatrix4(view.fromSource);projection.viewDepth=-position.z;projection.viewOffset=Math.hypot(position.x,position.y);projection.radius=sphere.radius*view.sourceScale;
    const diameter=regionalRockPixelDiameter(projection);
    if(diameter===null)fallback=true;else pixels=Math.max(pixels,diameter);
   }
   if(!visible)continue;const mask=1<<(id&7),wasNear=!!(nearState[id>>3]&mask),near=regionalRockUsesNear(distance,fallback?null:pixels,wasNear,quality,!!options.native);
   if(near)nearState[id>>3]|=mask;else nearState[id>>3]&=~mask;
   if(distance<policy.near){if(fallback)stats.projectionFallbacks++;if(!near)stats.screenSizeDemotions++;}
   const detail=near?'near':'far',mesh=batches[variant][detail];matrix.compose(position.set(x,y,z),rotation.setFromAxisAngle(up,yaw),scale.setScalar(size));uploads.write(mesh.instanceMatrix,mesh.count++,matrix.elements);stats[detail]++;stats.visible++;
  }
  for(const b of batches)for(const detail of ['near','far'] as const){const mesh=b[detail];mesh.visible=mesh.count>0;if(mesh.count){stats.drawCalls++;stats.triangles+=mesh.count*(mesh.geometry.index?.count??mesh.geometry.getAttribute('position').count)/3;}}
  stats.instanceFloatsQueued+=uploads.commit();
 },dispose};
}
export type RegionalRocks=ReturnType<typeof createRegionalRocks>;
