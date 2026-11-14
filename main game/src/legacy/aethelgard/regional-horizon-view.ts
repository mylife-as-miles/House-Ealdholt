import {worldHazeDistance,type WorldEnvironmentState} from '../../../../shared/legacy/aethelgard/environment/world-environment-state';
import {patchRegionalRidgeShader} from '../../../../shared/legacy/aethelgard/environment/regional-ridge-shader';
import {BufferAttribute,BufferGeometry,Color,Group,Mesh,MeshStandardMaterial,type Camera,type Object3D,type Scene,type WebGLRenderer} from 'three';
import type {EaldholtFarGeography} from '../../../../shared/legacy/aethelgard/environment/far-surround';
import type {EaldholtRegionalHorizon} from '../../../../shared/legacy/aethelgard/environment/regional-horizon';
import type {WorldPreparationQueue} from '../../../../shared/legacy/aethelgard/environment/world-preparation-queue';
import type {EaldholtBorrowedSurfaceMaps} from './ground-albedo-detail';

/** One worker and one bounded upload for distant regional scenery. This is a
 * backdrop in the existing source frame, never navigation/collision authority. */
export function createEaldholtRegionalHorizonView(options:{geography:EaldholtFarGeography;profile:'desktop'|'quest';
  rock?:EaldholtBorrowedSurfaceMaps;conditions?:()=>WorldEnvironmentState|null;
  renderer:WebGLRenderer;scene:Scene;camera:Camera;queue:WorldPreparationQueue;signal:AbortSignal;changed():void}){
  const object=new Group();object.name='Ealdholt eastern regional mountain scenery';
  object.userData.crownfallRegionalHorizon={axes:'source:+X-east/-Z-north',placementEligible:false,nonSolid:true};
  object.userData.iwsdkPreviewBounds='exclude';
  const stats={status:'preparing',error:'',triangles:0,bytes:0,drawCalls:0,bounds:null as EaldholtRegionalHorizon['bounds']|null};
  const abort=new AbortController();let disposed=false,worker:Worker|null=null,geometry:BufferGeometry|null=null,material:MeshStandardMaterial|null=null;
  const cancel=()=>dispose();options.signal.addEventListener('abort',cancel,{once:true});
  function fail(error:unknown){if(disposed)return;stats.status='fallback';stats.error=error instanceof Error?error.message:String(error);worker?.terminate();worker=null;options.changed();}
  function dispose(){if(disposed)return;disposed=true;abort.abort();worker?.terminate();worker=null;object.removeFromParent();object.clear();
    const g=geometry,m=material;geometry=null;material=null;
    const retire=()=>{g?.dispose();m?.dispose();};
    if(options.queue.pending)void options.queue.whenIdle().then(retire);else retire();
    options.signal.removeEventListener('abort',cancel);stats.status='disposed';}
  try{
    options.signal.throwIfAborted();
    worker=new Worker(new URL('./regional-horizon.worker.ts',import.meta.url),{type:'module'});
    worker.onerror=error=>fail(error.message);
    worker.onmessage=(event:MessageEvent<{data?:EaldholtRegionalHorizon;error?:string}>)=>{
      worker?.terminate();worker=null;if(disposed)return;
      if(event.data.error||!event.data.data){fail(event.data.error??'Regional scenery worker returned no data.');return;}
      const data=event.data.data;
      void options.queue.enqueue({bytes:data.byteLength,signal:abort.signal,priority:()=>70,work:async()=>{
        abort.signal.throwIfAborted();
        const g=new BufferGeometry();geometry=g;
        g.setAttribute('position',new BufferAttribute(data.positions,3));g.setAttribute('normal',new BufferAttribute(data.normals,3));g.setAttribute('color',new BufferAttribute(data.colours,3));
        const uv=new BufferAttribute(data.uv,2);for(const channel of ['uv','uv1','uv2','uv3'])g.setAttribute(channel,uv);
        g.setIndex(new BufferAttribute(data.indices,1));g.computeBoundingBox();g.computeBoundingSphere();
        const rock=options.rock;
        const m=new MeshStandardMaterial({name:'Ealdholt distant rock and snowy ridge',vertexColors:true,roughness:.96,metalness:0,fog:false,
          map:rock?.albedo??null,normalMap:rock?.normal??null,roughnessMap:rock?.orm??null,transparent:true});material=m;m.normalScale.set(.35,.35);
        const sourceDistanceScale={value:1},hazeLength={value:16000};
        m.onBeforeCompile=shader=>patchRegionalRidgeShader(shader,{cfRegionalHazeColour:{value:options.scene.fog?.color??new Color('#a9bac4')},cfRegionalRockMean:{value:Math.max(.02,rock?.meanLuminance??1)},cfRegionalSourceDistanceScale:sourceDistanceScale,cfRegionalHazeLength:hazeLength});
        m.customProgramCacheKey=()=>':ealdholt-regional-ridge-triplanar-haze-v3';
        const mesh=new Mesh(g,m);mesh.name='Eastern ridge and northeastern snowy massif';mesh.castShadow=false;mesh.receiveShadow=false;mesh.raycast=()=>{};
        mesh.userData.crownfallRegionalHorizon=object.userData.crownfallRegionalHorizon;
        mesh.userData.iwsdkPreviewBounds='exclude';
        // The finite cloud dome represents sky behind the regional backdrop.
        // Sort this opaque-alpha scenery just after that transparent sky.
        mesh.renderOrder=-9;
        mesh.onBeforeRender=()=>{hazeLength.value=worldHazeDistance(options.conditions?.()??null);sourceDistanceScale.value=1/Math.max(1e-7,mesh.matrixWorld.getMaxScaleOnAxis());};
        const priorError=options.renderer.debug.onShaderError;let shaderFailure='';
        const onShaderError:NonNullable<WebGLRenderer['debug']['onShaderError']>=(gl,program,vertex,fragment)=>{
          if((gl.getShaderSource(fragment)??'').includes('cfRegionalRockMean'))shaderFailure=[gl.getProgramInfoLog(program),gl.getShaderInfoLog(fragment)].filter(Boolean).join('\n');
          if(priorError)priorError(gl,program,vertex,fragment);
          else console.error('World shader compilation failed:',shaderFailure||gl.getProgramInfoLog(program));
        };
        options.renderer.debug.onShaderError=onShaderError;
        try{await options.renderer.compileAsync(mesh,options.camera,options.scene);}
        finally{if(options.renderer.debug.onShaderError===onShaderError)options.renderer.debug.onShaderError=priorError;}
        if(shaderFailure)throw Error(shaderFailure);
        abort.signal.throwIfAborted();object.add(mesh);
        Object.assign(stats,{status:'ready',triangles:data.indices.length/3,bytes:data.byteLength,drawCalls:1,bounds:data.bounds});options.changed();
      }}).catch(fail);
    };
    worker.postMessage({geography:options.geography,profile:options.profile});
  }catch(error){fail(error);}
  return {object:object as Object3D,stats,dispose};
}
