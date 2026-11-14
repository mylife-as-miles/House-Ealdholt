import assert from 'node:assert/strict';
import test from 'node:test';
import { Box3, BufferGeometry, Color, Float32BufferAttribute, Group, Matrix4, Mesh, MeshPhysicalMaterial,
  MeshStandardMaterial, PerspectiveCamera, Plane, Scene, ShaderLib, Texture, Vector3, Vector4,
  type WebGLRenderer, type WebGLRenderTarget } from 'three';
import { createEaldholtPlanarPond, createEaldholtPondRedraw, EALDHOLT_PLANAR_POND, EALDHOLT_POND_GGX_SAMPLES,
  inspectEaldholtPlanarPond, patchEaldholtPlanarPond, updateEaldholtPondCamera } from './pond-planar-reflection';
import { applyEaldholtWaterLook } from './water-look';

function fixture(){
  const scene=new Scene(),root=new Group(),geometry=new BufferGeometry();scene.add(root);
  geometry.setAttribute('position',new Float32BufferAttribute([-2,0,-1,2,0,-1,3,0,1,0,0,2,-2,0,1],3));
  geometry.setAttribute('uv',new Float32BufferAttribute([0,0,1,0,1,1,.5,1,0,1],2));geometry.setIndex([0,2,1,0,3,2,0,4,3]);geometry.computeVertexNormals();
  const material=new MeshPhysicalMaterial({roughness:.24,ior:1.333}),normal=new Texture(),sky=new Texture();
  material.name='Crownfall_Pond_Water_Review';material.normalMap=normal;material.normalScale.set(.8,.7);material.envMap=sky;
  const pond=new Mesh(geometry,material as MeshStandardMaterial|MeshStandardMaterial[]);root.add(pond);
  const camera=new PerspectiveCamera(45,16/9,.15,650);camera.position.set(6,5,8);camera.lookAt(0,0,0);camera.updateMatrixWorld(true);
  const borrowed=[geometry,material,normal,sky];let disposed=0;for(const value of borrowed)value.addEventListener('dispose',()=>disposed++);
  return{scene,root,geometry,material,normal,sky,pond,camera,borrowedDisposals:()=>disposed,
    cleanup(){geometry.dispose();material.dispose();normal.dispose();sky.dispose();}};
}

/** Closed water volume: one flat top, sloping outward bevel, vertical sides
 * and a downward bottom. The draw buffers also contain an unused high point. */
function closedPondGeometry():BufferGeometry{
  const geometry=new BufferGeometry(),positions:number[]=[],indices:number[]=[];
  for(const [radius,y] of [[1,.1],[1.1,.08],[1.1,0]])
    for(const [x,z] of [[-1,-1],[-1,1],[1,1],[1,-1]])positions.push(x*radius,y,z*radius);
  positions.push(0,50,0);indices.push(0,1,2,0,2,3);
  for(let layer=0;layer<2;layer++)for(let i=0;i<4;i++){
    const a=layer*4+i,b=layer*4+(i+1)%4,c=a+4,d=b+4;indices.push(a,c,d,a,d,b);
  }
  indices.push(8,10,9,8,11,10);geometry.setAttribute('position',new Float32BufferAttribute(positions,3));geometry.setIndex(indices);
  geometry.setAttribute('uv',new Float32BufferAttribute(positions.map(()=>0).slice(0,positions.length/3*2),2));geometry.computeVertexNormals();
  return geometry;
}

function rendererFixture(render:(target:WebGLRenderTarget|null,scene:Scene,camera:PerspectiveCamera)=>void=()=>{}){
  let target:WebGLRenderTarget|null=null,face=3,mip=2,scissorTest=true,alpha=.3;
  const viewport=new Vector4(11,12,600,400),scissor=new Vector4(4,5,500,300),color=new Color('#123456');
  const fake={xr:{enabled:false,isPresenting:false},shadowMap:{autoUpdate:true,needsUpdate:true},autoClear:false,
    info:{render:{calls:7,triangles:123}},getRenderTarget:()=>target,getActiveCubeFace:()=>face,getActiveMipmapLevel:()=>mip,
    getViewport:(v:Vector4)=>v.copy(viewport),getScissor:(v:Vector4)=>v.copy(scissor),getScissorTest:()=>scissorTest,
    getClearColor:(v:Color)=>v.copy(color),getClearAlpha:()=>alpha,
    setRenderTarget:(next:WebGLRenderTarget|null,nextFace=0,nextMip=0)=>{target=next;face=nextFace;mip=nextMip;},
    setViewport:(v:Vector4|number,y?:number,w?:number,h?:number)=>{if(v instanceof Vector4)viewport.copy(v);else viewport.set(v,y!,w!,h!);},
    setScissor:(v:Vector4)=>scissor.copy(v),setScissorTest:(next:boolean)=>{scissorTest=next;},setClearColor:(v:Color,a:number)=>{color.copy(v);alpha=a;},
    clear:()=>{},render:(scene:Scene,camera:PerspectiveCamera)=>render(target,scene,camera),
  };
  return{renderer:fake as unknown as WebGLRenderer,snapshot:()=>({target,face,mip,viewport:viewport.toArray(),scissor:scissor.toArray(),scissorTest,
    color:color.getHex(),alpha,xr:fake.xr.enabled,shadowAuto:fake.shadowMap.autoUpdate,shadowNeeds:fake.shadowMap.needsUpdate,autoClear:fake.autoClear})};
}

function redrawClock(){
  let now=0,token=0;const pending=new Map<number,{at:number;callback:()=>void}>();
  return{
    clock:{now:()=>now,set:(callback:()=>void,delay:number)=>{const id=++token;pending.set(id,{at:now+delay,callback});return id;},clear:(id:number)=>{pending.delete(id);}},
    count:()=>pending.size,
    advance(to:number){
      for(;;){const first=[...pending.entries()].sort((a,b)=>a[1].at-b[1].at)[0];if(!first||first[1].at>to)break;
        now=first[1].at;pending.delete(first[0]);first[1].callback();}
      now=to;
    },
  };
}

test('the original irregular pond is measured without changing its outline, UVs, bounds cache or assignments',()=>{
  const f=fixture(),positions=Array.from(f.geometry.getAttribute('position').array),uv=Array.from(f.geometry.getAttribute('uv').array),index=Array.from(f.geometry.index!.array);
  try{
    f.root.position.set(7,2,-9);f.root.rotation.y=.6;
    const result=inspectEaldholtPlanarPond(f.root);
    assert.deepEqual(result.surfaces,[f.pond]);assert.equal(result.vertices,5);assert.ok(result.maximumDeviation<1e-8);
    assert.ok(result.plane.distanceToPoint(new Vector3(7,2,-9))<1e-8);
    assert.deepEqual(Array.from(f.geometry.getAttribute('position').array),positions);assert.deepEqual(Array.from(f.geometry.getAttribute('uv').array),uv);
    assert.deepEqual(Array.from(f.geometry.index!.array),index);assert.equal(f.geometry.boundingBox,null);assert.equal(f.pond.material,f.material);
    f.geometry.getAttribute('position').setY(3,.01);assert.throws(()=>inspectEaldholtPlanarPond(f.root),/not planar/);
    f.geometry.getAttribute('position').setY(3,0);f.pond.material=[f.material,new MeshStandardMaterial()];
    assert.throws(()=>inspectEaldholtPlanarPond(f.root),/mixed opaque/);(f.pond.material[1] as MeshStandardMaterial).dispose();
  }finally{f.cleanup();}
});

test('a closed beveled volume qualifies only its referenced highest cap without changing source geometry',()=>{
  const f=fixture(),geometry=closedPondGeometry();f.pond.geometry=geometry;
  const positions=Array.from(geometry.getAttribute('position').array),indices=Array.from(geometry.index!.array),uv=Array.from(geometry.getAttribute('uv').array);
  try{
    const cap=inspectEaldholtPlanarPond(f.root);
    assert.equal(cap.vertices,12,'unused high attribute padding is not a drawn water level');
    assert.equal(cap.capTriangles,2);assert.equal(cap.capVertices,4);assert.equal(cap.capArea,4);
    assert.ok(Math.abs(cap.capHeight-.1)<1e-8);assert.ok(cap.maximumDeviation<1e-8);
    assert.ok(cap.capProjectedFraction>.82&&cap.capProjectedFraction<.83);
    assert.ok(Math.abs(cap.plane.distanceToPoint(new Vector3(0,.1,0)))<1e-8);
    assert.ok(Math.abs(cap.plane.distanceToPoint(new Vector3(0,0,0)))>.09,'bottom remains outside the cap');
    assert.deepEqual(Array.from(geometry.getAttribute('position').array),positions);assert.deepEqual(Array.from(geometry.index!.array),indices);
    assert.deepEqual(Array.from(geometry.getAttribute('uv').array),uv);assert.equal(geometry.boundingBox,null);
    geometry.getAttribute('position').setY(0,.09);assert.throws(()=>inspectEaldholtPlanarPond(f.root),/not planar/);
  }finally{geometry.dispose();f.cleanup();}
});

test('different water levels, disconnected caps and small flat patches cannot establish one pond plane',()=>{
  const f=fixture(),geometry=closedPondGeometry(),second=new Mesh(geometry,f.material);f.pond.geometry=geometry;f.root.add(second);
  try{
    second.position.set(5,.3,0);assert.throws(()=>inspectEaldholtPlanarPond(f.root),/multiple water levels/);
    second.position.y=0;assert.throws(()=>inspectEaldholtPlanarPond(f.root),/one connected/);f.root.remove(second);
    const position=geometry.getAttribute('position');for(let i=0;i<4;i++){position.setX(i,position.getX(i)*.5);position.setZ(i,position.getZ(i)*.5);}
    assert.throws(()=>inspectEaldholtPlanarPond(f.root),/does not dominate/);
  }finally{geometry.dispose();f.cleanup();}
});

test('a dominant flat ring cannot conceal a warped interior top',()=>{
  const f=fixture(),geometry=closedPondGeometry();f.pond.geometry=geometry;
  try{
    const positions=Array.from(geometry.getAttribute('position').array),indices=Array.from(geometry.index!.array).slice(6);
    positions.push(-.2,.1,-.2,-.2,.1,.2,.2,.1,.2,.2,.1,-.2,0,.09,0);
    for(let i=0;i<4;i++){
      const next=(i+1)%4,a=13+i,b=13+next;indices.push(i,b,a,i,next,b,a,b,17);
    }
    geometry.setAttribute('position',new Float32BufferAttribute(positions,3));geometry.setIndex(indices);
    assert.throws(()=>inspectEaldholtPlanarPond(f.root),/hole or warped interior/);
  }finally{geometry.dispose();f.cleanup();}
});

test('draw ranges exclude hidden triangles from the water-level contract',()=>{
  const f=fixture(),position=f.geometry.getAttribute('position');
  try{
    const source=Array.from(position.array);source.push(100,100,100,101,100,100,100,100,101);
    f.geometry.setAttribute('position',new Float32BufferAttribute(source,3));
    f.geometry.setIndex([5,7,6,...Array.from(f.geometry.index!.array)]);f.geometry.setDrawRange(3,9);
    const cap=inspectEaldholtPlanarPond(f.root);assert.equal(cap.vertices,5);assert.equal(cap.capHeight,0);assert.equal(cap.maximumDeviation,0);
    f.geometry.setDrawRange(0,12);assert.throws(()=>inspectEaldholtPlanarPond(f.root),/multiple water levels/);
  }finally{f.cleanup();}
});

test('a tiny first cap triangle cannot tilt the plane fitted from the large qualified face',()=>{
  const f=fixture();
  try{
    const source=Array.from(f.geometry.getAttribute('position').array);source.push(-2.00001,1e-10,0);
    f.geometry.setAttribute('position',new Float32BufferAttribute(source,3));f.geometry.setIndex([0,5,4,...Array.from(f.geometry.index!.array)]);
    const cap=inspectEaldholtPlanarPond(f.root);
    assert.deepEqual(cap.plane.normal.toArray(),[0,1,0]);assert.ok(Math.abs(cap.plane.constant)<1e-12);assert.ok(cap.maximumDeviation<1.1e-10);
  }finally{f.cleanup();}
});

test('the real camera is mirrored with its lens/view offset intact and the pond clips below-water geometry',()=>{
  const f=fixture();
  try{
    f.camera.setViewOffset(1920,1080,-100,0,1920,1080);f.camera.updateProjectionMatrix();
    const projection=f.camera.projectionMatrix.clone(),position=f.camera.position.clone(),mirror=new PerspectiveCamera(),textureMatrix=new Matrix4(),plane=new Plane(new Vector3(0,1,0),0);
    assert.equal(updateEaldholtPondCamera(f.camera,plane,mirror,textureMatrix),true);
    assert.deepEqual(mirror.position.toArray(),[6,-5,8]);assert.deepEqual(mirror.view,f.camera.view);
    assert.deepEqual(f.camera.position,position);assert.deepEqual(f.camera.projectionMatrix,projection);
    const pv=new Matrix4().multiplyMatrices(mirror.projectionMatrix,mirror.matrixWorldInverse);
    const above=new Vector4(0,.1,0,1).applyMatrix4(pv),below=new Vector4(0,-.1,0,1).applyMatrix4(pv);
    assert.ok(above.z+above.w>0);assert.ok(below.z+below.w<0);
    const point=new Vector3(1,0,.5),ray=point.clone().sub(mirror.position).normalize();
    const project=(p:Vector3)=>{const v=new Vector4(p.x,p.y,p.z,1).applyMatrix4(textureMatrix);return[v.x/v.w,v.y/v.w];};
    const expected=project(point),directional=project(mirror.position.clone().add(ray));
    assert.ok(Math.abs(expected[0]-directional[0])<1e-10&&Math.abs(expected[1]-directional[1])<1e-10,'flat-normal reflection directions match ordinary projective sampling');
    f.camera.position.y=-1;f.camera.updateMatrixWorld(true);assert.equal(updateEaldholtPondCamera(f.camera,plane,mirror,textureMatrix),false);
  }finally{f.cleanup();}
});

test('owned physical clones keep inherited ripple normals, lighting, borrowed maps and callbacks',()=>{
  const f=fixture(),r=rendererFixture(),water=applyEaldholtWaterLook(f.root,f.sky),baseline=f.pond.material as MeshPhysicalMaterial;
  const handle=createEaldholtPlanarPond(r.renderer,f.scene,f.root,{camera:f.camera});
  try{
    const clone=f.pond.material as MeshPhysicalMaterial;
    assert.notEqual(clone,baseline);assert.equal(clone.normalMap,baseline.normalMap);assert.deepEqual(clone.normalScale,baseline.normalScale);
    assert.equal(clone.roughness,baseline.roughness);assert.equal(clone.ior,baseline.ior);assert.equal(clone.color.getHex(),baseline.color.getHex());
    assert.equal(clone.onBeforeRender,baseline.onBeforeRender);assert.equal(clone.envMap,baseline.envMap);
    const shader={uniforms:{},vertexShader:ShaderLib.physical.vertexShader,fragmentShader:ShaderLib.physical.fragmentShader};
    clone.onBeforeCompile(shader as Parameters<typeof clone.onBeforeCompile>[0],r.renderer);
    assert.ok(shader.fragmentShader.includes('CROWNFALL_POND_RIPPLES'));assert.ok(shader.fragmentShader.includes('CROWNFALL_PLANAR_POND'));
    assert.ok(shader.fragmentShader.includes('#include <normal_fragment_maps>'));assert.ok(shader.fragmentShader.includes('#include <lights_fragment_maps>'));
    assert.ok(shader.fragmentShader.includes('inverseTransformDirection(normal,viewMatrix)'));assert.ok(shader.vertexShader.includes('instanceMatrix*ealdholtPlanarLocal'));
    const capUniform=(shader.uniforms as Record<string,{value:Vector4}>).uEaldholtPlanarCap.value;
    assert.deepEqual(capUniform.toArray().slice(0,3),[0,1,0]);assert.ok(Math.abs(capUniform.w)<1e-12);
    const gate=shader.fragmentShader.indexOf('abs(dot(uEaldholtPlanarCap,vec4(vEaldholtPlanarWorld,1.)))<=0.0001');
    assert.ok(gate>0&&gate<shader.fragmentShader.indexOf('ealdholtPlanarFiltered+='));
    assert.ok(shader.fragmentShader.includes('&&gl_FrontFacing'));
    assert.ok(shader.fragmentShader.includes('abs(dot(ealdholtPlanarFace,uEaldholtPlanarCap.xyz))>=0.9999999'));
    assert.equal(f.root.children.length,1,'no mirror plane or other proxy geometry was added');
  }finally{handle.dispose();assert.equal(f.pond.material,baseline);water.dispose();assert.equal(f.pond.material,f.material);assert.equal(f.borrowedDisposals(),0);f.cleanup();}
});

/** Independent CPU integration reference for the shader's GGX split-sum
 * contract, in the local frame R=V=N=(0,0,1). */
function ggxDirections(roughness:number){
  const alpha=roughness**2;
  return EALDHOLT_POND_GGX_SAMPLES.map(([u,v])=>{
    const cosTheta=Math.sqrt((1-v)/(1+(alpha**2-1)*v)),sinTheta=Math.sqrt(Math.max(0,1-cosTheta**2)),phi=2*Math.PI*u;
    const half=new Vector3(Math.cos(phi)*sinTheta,Math.sin(phi)*sinTheta,cosTheta);
    const direction=new Vector3(0,0,-1).reflect(half);return{direction,weight:Math.max(direction.z,0)};
  }).filter(sample=>sample.weight>0);
}

test('the fixed16-sample GGX quadrature converges to a mirror and broadens with inherited roughness',()=>{
  assert.equal(EALDHOLT_POND_GGX_SAMPLES.length,16);assert.ok(Object.isFrozen(EALDHOLT_POND_GGX_SAMPLES));
  for(const coordinate of [0,1])assert.equal(new Set(EALDHOLT_POND_GGX_SAMPLES.map(sample=>Math.floor(sample[coordinate]*16))).size,16);
  for(const sample of ggxDirections(0))assert.ok(sample.direction.distanceTo(new Vector3(0,0,1))<1e-12);
  const width=(roughness:number)=>{const samples=ggxDirections(roughness),total=samples.reduce((sum,sample)=>sum+sample.weight,0);
    return samples.reduce((sum,sample)=>sum+(1-sample.direction.z)*sample.weight,0)/total;};
  assert.ok(width(.24)>width(.1));assert.ok(width(.5)>width(.24));assert.ok(width(1)>width(.5));
  for(const sample of ggxDirections(.24)){assert.ok(Math.abs(sample.direction.length()-1)<1e-12);assert.ok(Number.isFinite(sample.weight));}
});

test('GGX weighting preserves constant radiance and uses probe energy for unsupported screen directions',()=>{
  const integrate=(roughness:number,supported:(direction:Vector3)=>boolean,current:number,probe:number)=>{
    const samples=ggxDirections(roughness),total=samples.reduce((sum,sample)=>sum+sample.weight,0);
    return samples.reduce((sum,sample)=>sum+(supported(sample.direction)?current:probe)*sample.weight,0)/total;
  };
  for(const roughness of [0,.1,.24,.5,1]){
    assert.ok(Math.abs(integrate(roughness,()=>true,2,7)-2)<1e-12,'a white environment is not dimmed or amplified');
    assert.ok(Math.abs(integrate(roughness,direction=>direction.x>=0,2,2)-2)<1e-12,'a screen boundary cannot change constant energy');
    assert.ok(Math.abs(integrate(roughness,()=>false,2,7)-7)<1e-12,'an entirely unsupported lobe retains probe radiance');
    const partial=integrate(roughness,direction=>direction.x>=0,2,7);assert.ok(partial>=2&&partial<=7+1e-12);
  }
});

test('the shader filters only indirect radiance with16 bounded GGX reads and keeps screen fallback and physical shading',()=>{
  const f=fixture(),r=rendererFixture(),handle=createEaldholtPlanarPond(r.renderer,f.scene,f.root,{camera:f.camera});
  try{
    const clone=f.pond.material as MeshPhysicalMaterial,shader={uniforms:{},vertexShader:ShaderLib.physical.vertexShader,fragmentShader:ShaderLib.physical.fragmentShader};
    clone.onBeforeCompile(shader as Parameters<typeof clone.onBeforeCompile>[0],r.renderer);
    assert.ok(shader.fragmentShader.includes('#define CROWNFALL_PLANAR_GGX_SAMPLES 16'));
    assert.equal(shader.fragmentShader.split('texture2D(uEaldholtPlanarTexture').length-1,1,'one texture site inside a fixed-bound sample loop');
    assert.ok(shader.fragmentShader.includes('material.roughness*material.roughness'));
    assert.ok(shader.fragmentShader.includes('reflect(-ealdholtPlanarRay,halfVector)'));
    assert.ok(shader.fragmentShader.includes('ealdholtPlanarReadRadiance(direction,radiance,envMapIntensity)*weight'));
    assert.ok(shader.fragmentShader.includes('if(coordinate.w<=0.)return fallbackRadiance;'));
    assert.ok(shader.fragmentShader.includes('return fallbackRadiance;\n  return texture2D'));
    assert.ok(shader.fragmentShader.includes('#include <lights_fragment_end>'),'the inherited energy/Fresnel BRDF still consumes indirect radiance');
    assert.match(clone.customProgramCacheKey(),/v3-cap-ggx16/);assert.equal(clone.roughness,.24);assert.equal(clone.normalMap,f.normal);
    assert.equal(handle.diagnostics.filterSamples,EALDHOLT_PLANAR_POND.filterSamples);
    assert.equal(handle.diagnostics.filterMethod,'finite-screen-ggx-split-sum');assert.equal(handle.diagnostics.updates,0,'filter adds no scene pass');
  }finally{handle.dispose();f.cleanup();}
});

test('a bounded real-scene pass excludes self, resolves reflection-only tree visibility, guards recursion and restores every touched renderer state',()=>{
  const f=fixture(),tree=new Group();tree.visible=false;f.scene.add(tree);
  let handle:ReturnType<typeof createEaldholtPlanarPond>,target:WebGLRenderTarget|undefined,ownedDisposals=0;
  const r=rendererFixture((current,scene,camera)=>{
    assert.equal(scene,f.scene);assert.notEqual(camera,f.camera);assert.equal(f.pond.visible,false);assert.equal(tree.visible,true);
    assert.equal(handle.update(10_000),false,'nested captures cannot recurse');
    target=current!;assert.equal(target.width,512);assert.equal(target.height,512);assert.equal(target.texture.generateMipmaps,false);
    target.addEventListener('dispose',()=>ownedDisposals++);
  });
  const before=r.snapshot();handle=createEaldholtPlanarPond(r.renderer,f.scene,f.root,{camera:f.camera,plantCells:[{object:tree,box:new Box3(new Vector3(-1,.1,-1),new Vector3(1,2,1))}]});
  try{
    assert.equal(handle.update(0),true);assert.equal(handle.update(10),false);assert.equal(handle.diagnostics.updates,1);
    assert.equal(handle.diagnostics.lastDrawCalls,7);assert.equal(handle.diagnostics.lastTriangles,123);assert.ok(Number.isFinite(handle.diagnostics.lastCpuMs));
    assert.equal(tree.visible,false);assert.equal(f.pond.visible,true);assert.deepEqual(r.snapshot(),before);
  }finally{handle.dispose();handle.dispose();assert.equal(ownedDisposals,1);assert.equal(f.pond.material,f.material);assert.equal(f.borrowedDisposals(),0);f.cleanup();}
});

test('render failure restores baseline materials and state without disposing borrowed scene resources',()=>{
  const f=fixture(),r=rendererFixture(()=>{throw Error('reflection fault');}),before=r.snapshot();
  const handle=createEaldholtPlanarPond(r.renderer,f.scene,f.root,{camera:f.camera});
  try{
    assert.equal(handle.update(0),false);assert.match(handle.diagnostics.error,/reflection fault/);assert.equal(handle.update(1000),false);
    assert.equal(f.pond.material,f.material);assert.equal(f.pond.visible,true);assert.deepEqual(r.snapshot(),before);assert.equal(f.borrowedDisposals(),0);
  }finally{handle.dispose();f.cleanup();}
});

test('a pending main shadow refresh prevents reflection-only shader warmup without consuming caller state',()=>{
  const f=fixture();let calls=0;
  const r=rendererFixture(()=>calls++);r.renderer.shadowMap.enabled=true;
  const before=r.snapshot(),handle=createEaldholtPlanarPond(r.renderer,f.scene,f.root,{camera:f.camera});
  try{
    assert.equal(handle.update(0),false);assert.equal(calls,0);assert.equal(handle.diagnostics.updates,0);
    assert.deepEqual(r.snapshot(),before,'pending shadows, visibility and render state remain owned by the main pass');
    // The ordinary main draw consumes the requested refresh first.
    r.renderer.shadowMap.needsUpdate=false;
    assert.equal(handle.update(0),true,'waiting did not consume the RTT throttle window');assert.equal(calls,1);
    assert.equal(r.renderer.shadowMap.needsUpdate,false);assert.equal(r.renderer.shadowMap.autoUpdate,true);
    r.renderer.shadowMap.needsUpdate=true;
    assert.equal(handle.update(1000),false,'later camera/quality shadow invalidation has the same ordering guarantee');assert.equal(calls,1);
  }finally{handle.dispose();f.cleanup();}
});

test('a static camera refresh survives an early post-shadow redraw and stops after one due capture',()=>{
  const f=fixture(),clock=redrawClock(),capturedX:number[]=[];
  const r=rendererFixture((_target,_scene,camera)=>capturedX.push(camera.position.x));
  r.renderer.shadowMap.enabled=true;r.renderer.shadowMap.needsUpdate=false;f.camera.position.x=0;
  const handle=createEaldholtPlanarPond(r.renderer,f.scene,f.root,{camera:f.camera});let redraws=0;
  const redraw=createEaldholtPondRedraw(()=>{redraws++;handle.update(clock.clock.now());redraw.schedule(handle.retryAtMilliseconds);},clock.clock);
  try{
    assert.equal(handle.update(0),true);assert.deepEqual(capturedX,[0]);
    clock.advance(10);f.camera.position.x=4;r.renderer.shadowMap.needsUpdate=true;
    assert.equal(handle.update(10),false);const due=handle.retryAtMilliseconds!;assert.ok(due>66&&due<67);
    r.renderer.shadowMap.needsUpdate=false;redraw.schedule(due);
    clock.advance(40);assert.equal(handle.update(40),false);redraw.schedule(handle.retryAtMilliseconds);
    assert.equal(clock.count(),1,'an early redraw retains one deadline rather than losing or duplicating the pending view');
    assert.deepEqual(capturedX,[0]);clock.advance(due+.01);
    assert.deepEqual(capturedX,[0,4]);assert.equal(redraws,1);assert.equal(handle.diagnostics.updates,2);assert.equal(clock.count(),0);
    clock.advance(1000);assert.equal(redraws,1,'a reduced-motion static view does not become an animation loop');
    redraw.schedule(1100);redraw.cancel();clock.advance(1200);assert.equal(redraws,1,'pause/disable/dispose cancellation leaves no late redraw');
    f.camera.position.y=-1;assert.equal(handle.update(1200),false);assert.equal(handle.retryAtMilliseconds,null);
    redraw.schedule(handle.retryAtMilliseconds);clock.advance(2000);assert.equal(clock.count(),0);assert.equal(redraws,1,'unsupported cameras do not retry');
  }finally{redraw.cancel();handle.dispose();assert.equal(handle.retryAtMilliseconds,null);f.cleanup();}
});

test('foreign assignments survive teardown and invalid shader seams fail explicitly',()=>{
  const f=fixture(),r=rendererFixture(),handle=createEaldholtPlanarPond(r.renderer,f.scene,f.root,{camera:f.camera}),foreign=new MeshStandardMaterial();
  f.pond.material=foreign;handle.dispose();assert.equal(f.pond.material,foreign);assert.equal(f.borrowedDisposals(),0);
  assert.throws(()=>patchEaldholtPlanarPond({uniforms:{},vertexShader:'unrelated',fragmentShader:'unrelated'},
    {texture:{value:null},matrix:{value:new Matrix4()},eye:{value:new Vector3()},ready:{value:0},cap:{value:new Vector4(0,1,0,0)}}),/physical shader seams/);
  foreign.dispose();f.cleanup();
});
