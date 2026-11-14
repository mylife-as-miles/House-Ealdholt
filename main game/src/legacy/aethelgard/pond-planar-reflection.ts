import { Box3, Color, Frustum, HalfFloatType, InstancedMesh, LinearFilter, LinearSRGBColorSpace, Matrix4, Mesh,
  MeshStandardMaterial, PerspectiveCamera, Plane, SkinnedMesh, Vector3, Vector4, WebGLRenderTarget,
  type Material, type Object3D, type Scene, type WebGLRenderer } from 'three';
import { isEaldholtPondProbeSurface } from '../../../../shared/legacy/aethelgard/environment/pond-probe';

export const EALDHOLT_PLANAR_POND = Object.freeze({ size:512,maximumUpdatesPerSecond:15,planeTolerance:1e-4,
  minimumCapNormalY:1-1e-7,minimumCapProjectedFraction:.8,filterSamples:16,filterMethod:'finite-screen-ggx-split-sum' });

/** Fixed Hammersley quadrature, not animated noise. The second coordinate is
 * radical inverse base2; the shader maps it through the GGX inverse CDF. */
export const EALDHOLT_POND_GGX_SAMPLES=Object.freeze(Array.from({length:EALDHOLT_PLANAR_POND.filterSamples},(_,index)=>{
  let bits=index,inverse=0,weight=.5;
  for(let bit=0;bit<4;bit++){inverse+=(bits&1)*weight;bits>>=1;weight*=.5;}
  return Object.freeze([index/EALDHOLT_PLANAR_POND.filterSamples,inverse] as const);
}));

interface PondTriangle {points:Vector3[];keys:string[];normal:Vector3;area:number}
export interface EaldholtPondCap {
  surfaces:Mesh[];plane:Plane;maximumDeviation:number;vertices:number;
  capTriangles:number;capVertices:number;capArea:number;capHeight:number;capProjectedFraction:number;
}

/** Only the triangles that Three actually draws participate in the contract.
 * Attribute padding, undrawn groups and an arbitrary first vertex cannot
 * establish a water plane. Source buffers and their caches remain untouched. */
function pondTriangles(root:Object3D):{surfaces:Mesh[];triangles:PondTriangle[];vertices:number}{
  root.updateWorldMatrix(true,true);
  const surfaces:Mesh[]=[],triangles:PondTriangle[]=[],instance=new Matrix4(),world=new Matrix4();let vertices=0;
  root.traverse(object=>{
    if(!(object instanceof Mesh))return;
    const materials=Array.isArray(object.material)?object.material:[object.material];
    if(!materials.some(isEaldholtPondProbeSurface))return;
    if(!materials.every(isEaldholtPondProbeSurface))throw Error('Planar pond requires a separate verified pond mesh; mixed opaque groups are preserved.');
    if(object instanceof SkinnedMesh||object.morphTargetInfluences?.length)throw Error('Planar pond requires a static surface.');
    const geometry=object.geometry,positions=geometry.getAttribute('position'),index=geometry.index;
    if(!positions||positions.itemSize!==3)throw Error('Planar pond position data is unavailable.');
    const count=index?.count??positions.count,draw=geometry.drawRange;
    const groups=Array.isArray(object.material)?geometry.groups:[{start:0,count,materialIndex:0}];
    const offsets:number[]=[],seen=new Set<number>();
    for(const group of groups){
      if(!materials[group.materialIndex??0])throw Error('Planar pond draw material is unavailable.');
      const start=Math.max(0,draw.start,group.start),end=Math.min(count,draw.start+draw.count,group.start+group.count);
      if(!Number.isInteger(start)||!Number.isInteger(end)||start%3||(end-start)%3)throw Error('Planar pond requires complete referenced triangles.');
      for(let i=start;i<end;i+=3){if(seen.has(i))throw Error('Planar pond draw groups overlap.');seen.add(i);offsets.push(i);}
    }
    if(!offsets.length)return;
    surfaces.push(object);
    const actors=object instanceof InstancedMesh?object.count:1;
    for(let actor=0;actor<actors;actor++){
      world.copy(object.matrixWorld);
      if(object instanceof InstancedMesh){object.getMatrixAt(actor,instance);world.multiply(instance);}
      if(!Number.isFinite(world.determinant())||world.determinant()<=0)throw Error('Planar pond requires a positive nonsingular source transform.');
      const used=new Set<number>();
      for(const offset of offsets){
        const points:Vector3[]=[];
        for(let corner=0;corner<3;corner++){
          const id=index?index.getX(offset+corner):offset+corner;
          if(!Number.isInteger(id)||id<0||id>=positions.count)throw Error('Planar pond triangle index is invalid.');
          const point=new Vector3().fromBufferAttribute(positions,id).applyMatrix4(world);
          if(!Number.isFinite(point.x)||!Number.isFinite(point.y)||!Number.isFinite(point.z))throw Error('Planar pond vertices must be finite.');
          used.add(id);points.push(point);
        }
        const normal=new Vector3().subVectors(points[1],points[0]).cross(new Vector3().subVectors(points[2],points[0])),length=normal.length();
        if(length<=1e-12)throw Error('Planar pond has a degenerate referenced triangle.');
        triangles.push({points,keys:points.map(p=>`${p.x},${p.y},${p.z}`),normal:normal.divideScalar(length),area:length/2});
      }
      vertices+=used.size;
    }
  });
  if(!triangles.length)throw Error('Verified pond surface is absent.');
  return{surfaces,triangles,vertices};
}

/** A solid pond may contain a bottom, sides and a bevel. Qualify one connected,
 * dominant upper cap, never fit those volume faces or a convenient small patch.
 * Different water levels, holes, warped upper faces and ambiguous caps fail closed. */
export function inspectEaldholtPlanarPond(root:Object3D):EaldholtPondCap{
  const {surfaces,triangles,vertices}=pondTriangles(root),tolerance=EALDHOLT_PLANAR_POND.planeTolerance;
  let highest=-Infinity,upProjectedArea=0;
  for(const triangle of triangles){
    for(const point of triangle.points)highest=Math.max(highest,point.y);
    upProjectedArea+=triangle.area*Math.max(0,triangle.normal.y);
  }
  const cap:PondTriangle[]=[];
  for(const triangle of triangles){
    if(triangle.normal.y<EALDHOLT_PLANAR_POND.minimumCapNormalY)continue;
    const low=Math.min(...triangle.points.map(p=>p.y)),high=Math.max(...triangle.points.map(p=>p.y));
    if(high-low>tolerance)throw Error('Pond upper surface is not planar.');
    if(highest-low>tolerance)throw Error('Pond is not planar: ambiguous flat caps at multiple water levels.');
    cap.push(triangle);
  }
  if(!cap.length)throw Error('Pond upper surface is not planar: no consistent highest upward cap.');
  // Fit the largest qualified face, not an unstable tiny first triangle.
  const stable=cap.reduce((best,face)=>face.area>best.area?face:best),plane=new Plane().setFromNormalAndCoplanarPoint(stable.normal,stable.points[0]);
  let maximumDeviation=0,capArea=0;
  const vertexKeys=new Set<string>(),edges=new Map<string,number[]>(),neighbours=cap.map(()=>new Set<number>());
  for(let i=0;i<cap.length;i++){
    const face=cap[i];capArea+=face.area;
    if(face.normal.dot(plane.normal)<EALDHOLT_PLANAR_POND.minimumCapNormalY)throw Error('Pond upper cap normals are inconsistent.');
    for(let j=0;j<3;j++){
      maximumDeviation=Math.max(maximumDeviation,Math.abs(plane.distanceToPoint(face.points[j])));vertexKeys.add(face.keys[j]);
      const pair=[face.keys[j],face.keys[(j+1)%3]].sort(),key=JSON.stringify(pair),adjacent=edges.get(key)??[];
      for(const other of adjacent){neighbours[i].add(other);neighbours[other].add(i);}adjacent.push(i);edges.set(key,adjacent);
    }
  }
  if(maximumDeviation>tolerance)throw Error(`Pond upper cap is not planar: maximum deviation ${maximumDeviation} world units.`);
  const reached=new Set<number>([0]),pending=[0];
  while(pending.length){for(const next of neighbours[pending.pop()!]!)if(!reached.has(next)){reached.add(next);pending.push(next);}}
  if(reached.size!==cap.length)throw Error('Planar pond requires one connected upper cap.');
  // A missing/warped interior patch must not masquerade as a surrounding cap.
  const boundary=new Map<string,string[]>();
  for(const [key,adjacent] of edges){
    if(adjacent.length>2)throw Error('Planar pond upper cap is nonmanifold.');
    if(adjacent.length===1){const [a,b]=JSON.parse(key) as string[];boundary.set(a,[...(boundary.get(a)??[]),b]);boundary.set(b,[...(boundary.get(b)??[]),a]);}
  }
  if(!boundary.size||[...boundary.values()].some(next=>next.length!==2))throw Error('Planar pond upper cap has an invalid boundary.');
  const boundarySeen=new Set<string>(),boundaryPending=[boundary.keys().next().value as string];
  while(boundaryPending.length){const next=boundaryPending.pop()!;if(boundarySeen.has(next))continue;boundarySeen.add(next);boundaryPending.push(...boundary.get(next)!);}
  if(boundarySeen.size!==boundary.size)throw Error('Planar pond upper cap contains a hole or warped interior patch.');
  const capProjectedFraction=cap.reduce((sum,face)=>sum+face.area*face.normal.y,0)/upProjectedArea;
  if(capProjectedFraction<EALDHOLT_PLANAR_POND.minimumCapProjectedFraction)throw Error('Planar pond upper cap does not dominate the upward water surface.');
  return{surfaces,plane,maximumDeviation,vertices,capTriangles:cap.length,capVertices:vertexKeys.size,capArea,
    capHeight:highest,capProjectedFraction};
}

/** Mirror the real perspective camera and replace its near plane with the
 * pond plane (oblique near-plane clipping, as used by Three's Reflector).
 * The source camera and its authored view offset/projection remain untouched. */
export function updateEaldholtPondCamera(source:PerspectiveCamera,plane:Plane,mirror:PerspectiveCamera,textureMatrix:Matrix4):boolean{
  source.updateWorldMatrix(true,false);
  const eye=new Vector3().setFromMatrixPosition(source.matrixWorld),normal=plane.normal;
  const distance=plane.distanceToPoint(eye);
  if(distance<=EALDHOLT_PLANAR_POND.planeTolerance)return false;
  mirror.copy(source,false);
  mirror.position.copy(eye).addScaledVector(normal,-2*distance);
  const forward=new Vector3(0,0,-1).transformDirection(source.matrixWorld).reflect(normal);
  mirror.up.set(0,1,0).transformDirection(source.matrixWorld).reflect(normal);
  mirror.lookAt(new Vector3().copy(mirror.position).add(forward));mirror.updateMatrixWorld(true);
  mirror.projectionMatrix.copy(source.projectionMatrix);
  const clip=plane.clone().applyMatrix4(mirror.matrixWorldInverse),c=new Vector4(clip.normal.x,clip.normal.y,clip.normal.z,clip.constant);
  const p=mirror.projectionMatrix.elements,q=new Vector4((Math.sign(c.x)+p[8])/p[0],(Math.sign(c.y)+p[9])/p[5],-1,(1+p[10])/p[14]);
  const denominator=c.dot(q);
  if(!Number.isFinite(denominator)||Math.abs(denominator)<1e-9)return false;
  c.multiplyScalar(2/denominator);p[2]=c.x;p[6]=c.y;p[10]=c.z+1;p[14]=c.w;
  mirror.projectionMatrixInverse.copy(mirror.projectionMatrix).invert();
  textureMatrix.set(.5,0,0,.5,0,.5,0,.5,0,0,.5,.5,0,0,0,1)
    .multiply(mirror.projectionMatrix).multiply(mirror.matrixWorldInverse);
  return true;
}

interface PlanarShader {uniforms:Record<string,{value:unknown}>;vertexShader:string;fragmentShader:string}
interface PlanarUniforms {texture:{value:unknown};matrix:{value:Matrix4};eye:{value:Vector3};ready:{value:number};cap:{value:Vector4}}
/** The usual isotropic GGX split-sum prefilter assumes V=N=reflected direction.
 * Importance-sampled half vectors use alpha=roughness², then weight reflected
 * directions by N·L. This is bounded current-view quadrature, not a complete
 * environment convolution. Missing screen directions retain the inherited
 * probe radiance. The original physical BRDF/Fresnel consumes the result. */
export function patchEaldholtPlanarPond(shader:PlanarShader,uniforms:PlanarUniforms):void{
  if(shader.fragmentShader.includes('CROWNFALL_PLANAR_POND'))throw Error('Planar pond shader is already bound.');
  const vertexSeam='#include <begin_vertex>',lightSeam='#include <lights_fragment_maps>';
  if(shader.vertexShader.split(vertexSeam).length!==2||shader.fragmentShader.split(lightSeam).length!==2
    ||!shader.vertexShader.includes('#include <common>')||!shader.fragmentShader.includes('#include <common>'))throw Error('Planar pond requires the standard physical shader seams.');
  shader.uniforms.uEaldholtPlanarTexture=uniforms.texture;shader.uniforms.uEaldholtPlanarMatrix=uniforms.matrix;
  shader.uniforms.uEaldholtPlanarEye=uniforms.eye;shader.uniforms.uEaldholtPlanarReady=uniforms.ready;
  shader.uniforms.uEaldholtPlanarCap=uniforms.cap;
  shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nvarying vec3 vEaldholtPlanarWorld;');
  shader.vertexShader=shader.vertexShader.replace(vertexSeam,`${vertexSeam}
vec4 ealdholtPlanarLocal=vec4(transformed,1.);
#ifdef USE_INSTANCING
  ealdholtPlanarLocal=instanceMatrix*ealdholtPlanarLocal;
#endif
vEaldholtPlanarWorld=(modelMatrix*ealdholtPlanarLocal).xyz;`);
  shader.fragmentShader=shader.fragmentShader.replace('#include <common>',`#include <common>
#define CROWNFALL_PLANAR_POND
varying vec3 vEaldholtPlanarWorld;
uniform sampler2D uEaldholtPlanarTexture;
uniform mat4 uEaldholtPlanarMatrix;
uniform vec3 uEaldholtPlanarEye;
uniform float uEaldholtPlanarReady;
uniform vec4 uEaldholtPlanarCap;
#define CROWNFALL_PLANAR_GGX_SAMPLES ${EALDHOLT_PLANAR_POND.filterSamples}
const vec2 ealdholtPlanarGgxXi[CROWNFALL_PLANAR_GGX_SAMPLES]=vec2[CROWNFALL_PLANAR_GGX_SAMPLES](
${EALDHOLT_POND_GGX_SAMPLES.map(([x,y])=>`  vec2(${x.toFixed(8)},${y.toFixed(8)})`).join(',\n')});
vec3 ealdholtPlanarReadRadiance(vec3 direction,vec3 fallbackRadiance,float intensity){
  vec4 coordinate=uEaldholtPlanarMatrix*vec4(uEaldholtPlanarEye+direction,1.);
  if(coordinate.w<=0.)return fallbackRadiance;
  vec2 uv=coordinate.xy/coordinate.w;
  if(any(lessThan(uv,vec2(0.)))||any(greaterThan(uv,vec2(1.))))return fallbackRadiance;
  return texture2D(uEaldholtPlanarTexture,uv).rgb*intensity;
}`);
  shader.fragmentShader=shader.fragmentShader.replace(lightSeam,`${lightSeam}
#if defined(RE_IndirectSpecular) && defined(USE_ENVMAP)
// Only the qualified upper cap replaces probe radiance. Its solid bevel,
// sides and bottom retain the original PBR even at the shared cap boundary.
vec3 ealdholtPlanarFace=normalize(cross(dFdx(vEaldholtPlanarWorld),dFdy(vEaldholtPlanarWorld)));
if(uEaldholtPlanarReady>.5&&gl_FrontFacing
  &&abs(dot(uEaldholtPlanarCap,vec4(vEaldholtPlanarWorld,1.)))<=${EALDHOLT_PLANAR_POND.planeTolerance}
  &&abs(dot(ealdholtPlanarFace,uEaldholtPlanarCap.xyz))>=${EALDHOLT_PLANAR_POND.minimumCapNormalY}){
  vec3 ealdholtPlanarNormal=inverseTransformDirection(normal,viewMatrix);
  vec3 ealdholtPlanarRay=reflect(normalize(vEaldholtPlanarWorld-cameraPosition),ealdholtPlanarNormal);
  vec3 ealdholtPlanarUp=abs(ealdholtPlanarRay.z)<.999?vec3(0.,0.,1.):vec3(1.,0.,0.);
  vec3 ealdholtPlanarTangent=normalize(cross(ealdholtPlanarUp,ealdholtPlanarRay));
  vec3 ealdholtPlanarBitangent=cross(ealdholtPlanarRay,ealdholtPlanarTangent);
  float ealdholtPlanarAlpha=material.roughness*material.roughness;
  float ealdholtPlanarAlphaSquared=ealdholtPlanarAlpha*ealdholtPlanarAlpha;
  vec3 ealdholtPlanarFiltered=vec3(0.);float ealdholtPlanarWeight=0.;
  for(int sampleIndex=0;sampleIndex<CROWNFALL_PLANAR_GGX_SAMPLES;sampleIndex++){
    vec2 xi=ealdholtPlanarGgxXi[sampleIndex];
    float phi=2.*PI*xi.x;
    float cosTheta=sqrt((1.-xi.y)/(1.+(ealdholtPlanarAlphaSquared-1.)*xi.y));
    float sinTheta=sqrt(max(0.,1.-cosTheta*cosTheta));
    vec3 halfVector=normalize(ealdholtPlanarTangent*(cos(phi)*sinTheta)+ealdholtPlanarBitangent*(sin(phi)*sinTheta)+ealdholtPlanarRay*cosTheta);
    vec3 direction=reflect(-ealdholtPlanarRay,halfVector);
    float weight=max(dot(ealdholtPlanarRay,direction),0.);
    if(weight>0.){
      ealdholtPlanarFiltered+=ealdholtPlanarReadRadiance(direction,radiance,envMapIntensity)*weight;
      ealdholtPlanarWeight+=weight;
    }
  }
  if(ealdholtPlanarWeight>0.)radiance=ealdholtPlanarFiltered/ealdholtPlanarWeight;
}
#endif`);
}

export interface EaldholtPlanarPond {
  update(nowMilliseconds:number):boolean;
  /** A throttled/pending-shadow refresh remains due until the adapter retries.
   * Null means success or a nonretryable/unsupported view, never animation. */
  readonly retryAtMilliseconds:number|null;
  readonly diagnostics:{size:number;updates:number;lastCpuMs:number;lastDrawCalls:number;lastTriangles:number;planeDeviation:number;
    capTriangles:number;capVertices:number;capArea:number;capHeight:number;capProjectedFraction:number;
    filterSamples:number;filterMethod:string;error:string};
  dispose():void;
}

/** One owned deadline, not a render loop. Kept separate so static-view
 * throttling and late/cancelled callbacks can be tested without a live app. */
export function createEaldholtPondRedraw(redraw:()=>void,clock:{
  now:()=>number;set:(callback:()=>void,delayMilliseconds:number)=>number;clear:(token:number)=>void;
}):{schedule:(at:number|null)=>void;cancel:()=>void}{
  let token:number|null=null,deadline:number|null=null,generation=0;
  function cancel(){generation++;if(token!==null)clock.clear(token);token=null;deadline=null;}
  return{
    schedule(at){
      if(at===null||!Number.isFinite(at)){cancel();return;}
      if(token!==null&&deadline===at)return;
      cancel();deadline=at;const current=generation;
      token=clock.set(()=>{if(current!==generation)return;token=null;deadline=null;redraw();},Math.max(0,at-clock.now()));
    },
    cancel,
  };
}

/** One opt-in Desktop pass on the existing renderer. No proxy/mirror plane is
 * added: only verified original pond fragments sample the owned target.
 * The512²linear half-float target uses no mip chain (about3MiB with depth).
 * Each cap fragment uses at most16 current-view GGX samples, falling back to
 * inherited probe radiance outside the captured screen. No extra render pass
 * or full environment/GGX mip pyramid is implied. */
export function createEaldholtPlanarPond(renderer:WebGLRenderer,scene:Scene,root:Object3D,
  options:{camera:PerspectiveCamera;plantCells?:readonly {object:Object3D;box:Box3}[]}):EaldholtPlanarPond{
  if(renderer.xr.enabled||renderer.xr.isPresenting)throw Error('Planar pond is Desktop-only.');
  const measured=inspectEaldholtPlanarPond(root),camera=new PerspectiveCamera(),matrix=new Matrix4();
  const target=new WebGLRenderTarget(EALDHOLT_PLANAR_POND.size,EALDHOLT_PLANAR_POND.size,{
    type:HalfFloatType,minFilter:LinearFilter,magFilter:LinearFilter,generateMipmaps:false,depthBuffer:true,stencilBuffer:false,
  });
  target.texture.name='Ealdholt current-view planar pond (owned)';target.texture.colorSpace=LinearSRGBColorSpace;
  const uniforms:PlanarUniforms={texture:{value:target.texture},matrix:{value:matrix},eye:{value:new Vector3()},ready:{value:0},
    cap:{value:new Vector4(measured.plane.normal.x,measured.plane.normal.y,measured.plane.normal.z,measured.plane.constant)}};
  const materials=new Map<Material,MeshStandardMaterial>(),assignments:{mesh:Mesh;original:Material|Material[];assigned:Material|Material[]}[]=[];
  const cells=options.plantCells??[],cellVisibility=new Uint8Array(cells.length),surfaceVisibility=new Uint8Array(measured.surfaces.length);
  const frustum=new Frustum(),projectionView=new Matrix4(),viewport=new Vector4(),scissor=new Vector4(),clearColor=new Color();
  let disposed=false,capturing=false,lastUpdate=-Infinity,retryAt:number|null=null,updates=0,lastCpuMs=0,lastDrawCalls=0,lastTriangles=0,error='';
  function releaseMaterials():void{
    for(const entry of assignments)if(entry.mesh.material===entry.assigned)entry.mesh.material=entry.original;
    for(const material of materials.values())material.dispose();materials.clear();assignments.length=0;
  }
  try{
    for(const mesh of measured.surfaces){
      const original=mesh.material;
      const adapt=(material:Material)=>{
        const cached=materials.get(material);if(cached)return cached;
        if(!(material instanceof MeshStandardMaterial))throw Error('Planar pond requires the inherited physical material.');
        const clone=material.clone(),compile=material.onBeforeCompile,key=material.customProgramCacheKey;
        clone.name=material.name+'_ViewPlanar';
        clone.onBeforeRender=material.onBeforeRender;
        clone.onBeforeCompile=function(shader,viewRenderer){compile.call(this,shader,viewRenderer);patchEaldholtPlanarPond(shader,uniforms);};
        clone.customProgramCacheKey=function(){return key.call(material)+':ealdholt-planar-pond:v3-cap-ggx16';};
        clone.userData={...clone.userData,crownfallWaterLook:{...clone.userData.crownfallWaterLook,staticIblOnly:false,viewPlanarReflection:true}};
        materials.set(material,clone);return clone;
      };
      const assigned=Array.isArray(original)?original.map(adapt):adapt(original);
      assignments.push({mesh,original,assigned});mesh.material=assigned;
    }
  }catch(cause){releaseMaterials();target.dispose();throw cause;}
  return{
    update(now){
      if(disposed||capturing||error||!Number.isFinite(now))return false;
      retryAt=null;
      const due=lastUpdate+1000/EALDHOLT_PLANAR_POND.maximumUpdatesPerSecond;
      // Main-view shadows must exist before reflection-only receivers compile.
      // In Three r185 the first shadow pass also normalizes legacy PCFSoft to
      // comparison-depth PCF. Suppressing that pass can cache BASIC samplers
      // on objects that never appear in the main view. Do not consume or clear
      // the caller's refresh; the normal main render owns it.
      if(renderer.shadowMap.enabled&&renderer.shadowMap.needsUpdate){retryAt=Math.max(now,due);return false;}
      if(now<due){retryAt=due;return false;}
      if(!updateEaldholtPondCamera(options.camera,measured.plane,camera,matrix)){uniforms.ready.value=0;return false;}
      uniforms.eye.value.copy(camera.position);
      const previousTarget=renderer.getRenderTarget(),face=renderer.getActiveCubeFace(),mip=renderer.getActiveMipmapLevel();
      renderer.getViewport(viewport);renderer.getScissor(scissor);const scissorTest=renderer.getScissorTest();
      renderer.getClearColor(clearColor);const alpha=renderer.getClearAlpha(),xr=renderer.xr.enabled;
      const shadowAuto=renderer.shadowMap.autoUpdate,shadowNeeds=renderer.shadowMap.needsUpdate,autoClear=renderer.autoClear;
      capturing=true;const start=performance.now();
      try{
        for(let i=0;i<measured.surfaces.length;i++){surfaceVisibility[i]=Number(measured.surfaces[i].visible);measured.surfaces[i].visible=false;}
        // Main-view vegetation cell culling cannot remove a tree that belongs
        // in the mirrored view. Instance counts/LOD stay at their current tier.
        frustum.setFromProjectionMatrix(projectionView.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse));
        for(let i=0;i<cells.length;i++){cellVisibility[i]=Number(cells[i].object.visible);cells[i].object.visible=frustum.intersectsBox(cells[i].box);}
        renderer.xr.enabled=false;renderer.shadowMap.autoUpdate=false;renderer.shadowMap.needsUpdate=false;
        renderer.autoClear=true;renderer.setScissorTest(false);renderer.setRenderTarget(target);
        renderer.setViewport(0,0,EALDHOLT_PLANAR_POND.size,EALDHOLT_PLANAR_POND.size);renderer.clear();
        renderer.render(scene,camera);
        lastDrawCalls=renderer.info.render.calls;lastTriangles=renderer.info.render.triangles;
        uniforms.ready.value=1;lastUpdate=now;updates++;
        return true;
      }catch(cause){
        error=cause instanceof Error?cause.message:'Planar reflection pass failed.';uniforms.ready.value=0;releaseMaterials();return false;
      }finally{
        for(let i=0;i<cells.length;i++)cells[i].object.visible=cellVisibility[i]===1;
        for(let i=0;i<measured.surfaces.length;i++)measured.surfaces[i].visible=surfaceVisibility[i]===1;
        renderer.xr.enabled=xr;renderer.shadowMap.autoUpdate=shadowAuto;renderer.shadowMap.needsUpdate=shadowNeeds;
        renderer.autoClear=autoClear;renderer.setRenderTarget(previousTarget,face,mip);renderer.setViewport(viewport);
        renderer.setScissor(scissor);renderer.setScissorTest(scissorTest);renderer.setClearColor(clearColor,alpha);
        lastCpuMs=performance.now()-start;capturing=false;
      }
    },
    get retryAtMilliseconds(){return retryAt;},
    get diagnostics(){return{size:EALDHOLT_PLANAR_POND.size,updates,lastCpuMs,lastDrawCalls,lastTriangles,planeDeviation:measured.maximumDeviation,
      capTriangles:measured.capTriangles,capVertices:measured.capVertices,capArea:measured.capArea,
      capHeight:measured.capHeight,capProjectedFraction:measured.capProjectedFraction,
      filterSamples:EALDHOLT_PLANAR_POND.filterSamples,filterMethod:EALDHOLT_PLANAR_POND.filterMethod,error};},
    dispose(){if(disposed)return;disposed=true;retryAt=null;uniforms.ready.value=0;releaseMaterials();target.dispose();},
  };
}
