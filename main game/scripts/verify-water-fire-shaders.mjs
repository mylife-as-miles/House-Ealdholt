// Production adapter GPU/numerical tests. Isolated technical fixtures only:
// no authored-world screenshot, gameplay, XR or hardware-performance claim.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import ts from 'typescript';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const origin=new URL(process.env.CROWNFALL_TEST_URL??'http://127.0.0.1:4191');
assert.ok(['localhost','127.0.0.1','[::1]'].includes(origin.hostname));
const names=['open-water-runtime','procedural-fire-runtime','village-fire','water-look'];
const adapters={}, hashes={}, nativeFiles=Object.fromEntries(['three.module.js','three.core.js'].map(name=>[name,readFileSync(resolve(root,'main-game-vr/node_modules/three/build',name),'utf8')]));
for(const [platform,app,three]of[['desktop','main game','/node_modules/three/build/three.module.js'],['native-installed-renderer','main-game-vr','/__water-fire-native/three.module.js']]){
 for(const name of names){const file=resolve(root,app,'src/legacy/aethelgard',name+'.ts'),source=readFileSync(file,'utf8');hashes[app+'/'+name]=createHash('sha256').update(source).digest('hex');
  const rewritten=source.replace(/\bfrom\s*(['"])([^'"]+)\1/g,(all,q,id)=>{
   if(id==='three'||id==='@iwsdk/core')return 'from '+JSON.stringify(three);
   if(id.startsWith('.')){const key=basename(id).replace(/\.(?:js|ts)$/,'');if(names.includes(key)&&/^\.\/[^/]+$/.test(id))return 'from '+JSON.stringify('/__water-fire/'+platform+'/'+key+'.js');return 'from '+JSON.stringify('/@fs/'+resolve(dirname(file),id.replace(/\.js$/,''))+'.ts');}return all;});
  adapters['/__water-fire/'+platform+'/'+name+'.js']=ts.transpileModule(rewritten,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
 }
}
const sharedModules=['open-water-clock','open-water-programs','open-water-shader','open-water-spectrum','procedural-fire-field','procedural-fire-blackbody','procedural-fire-shader','water-ripples'];
for(const name of sharedModules){const file='shared/legacy/aethelgard/environment/'+name+'.ts';hashes[file]=createHash('sha256').update(readFileSync(resolve(root,file))).digest('hex');}
let browser;const errors=[];const deadline=setTimeout(()=>void browser?.close(),110000);
try{
 browser=await chromium.launch({headless:true,executablePath:'/usr/bin/chromium',timeout:15000,args:['--no-sandbox','--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader']});
 const page=await browser.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.route('**/*',route=>{const url=new URL(route.request().url());if(url.origin!==origin.origin)return route.abort();
  if(adapters[url.pathname])return route.fulfill({contentType:'text/javascript',body:adapters[url.pathname]});
  if(url.pathname.startsWith('/__water-fire-native/'))return route.fulfill({contentType:'text/javascript',body:nativeFiles[basename(url.pathname)]});
  if(url.pathname==='/__water-fire-check.html')return route.fulfill({contentType:'text/html',body:'<!doctype html><link rel="icon" href="data:,"><canvas></canvas>'});
  if(/\.(glb|hdr|webp|png|jpg|mp3|mp4|woff2)$/.test(url.pathname))return route.abort();return route.continue();});
 await page.goto(new URL('/__water-fire-check.html',origin).href,{timeout:15000});
 const results=await page.evaluate(async({root})=>{
  const rows=[];
  const shared='/@fs/'+root+'/shared/legacy/aethelgard/environment/';
  const {patchWorldEnvironmentMaterial}=await import(shared+'environment-material-shader.ts');
  const {patchVoxelMaterial}=await import(shared+'voxel-radiance-shaders.ts');
  for(const [platform,three]of[['desktop','/node_modules/three/build/three.module.js'],['native-installed-renderer','/__water-fire-native/three.module.js']]){
   const T=await import(three),base='/__water-fire/'+platform+'/';
   const {createEaldholtOpenWater}=await import(base+'open-water-runtime.js');
   const {createEaldholtVillageFire}=await import(base+'village-fire.js');
   const {applyEaldholtWaterLook}=await import(base+'water-look.js');
   const canvas=document.createElement('canvas');document.body.append(canvas);
   const renderer=new T.WebGLRenderer({canvas,antialias:false});renderer.setPixelRatio(.75);renderer.setSize(48,48);renderer.outputColorSpace=T.LinearSRGBColorSpace;renderer.setClearColor(0x000000,0);
   const gl=renderer.getContext(),shaderErrors=[];renderer.debug.onShaderError=(_g,_p,v,f)=>shaderErrors.push([gl.getShaderInfoLog(v),gl.getShaderInfoLog(f)]);
   const target=new T.WebGLRenderTarget(48,48),holdTarget=new T.WebGLRenderTarget(17,19),scene=new T.Scene();
   const camera=new T.PerspectiveCamera(50,1,.01,100);camera.position.set(0,3,3);camera.lookAt(0,0,0);
   const model=new T.Group();scene.add(model);scene.add(new T.HemisphereLight(0xffffff,0x303020,2));
   let budgetNow=0;
   const water=createEaldholtOpenWater(renderer,{now:()=>budgetNow,profile:platform==='desktop'?'desktop':'quest',resolution:platform==='desktop'?64:32,maxUpdatesPerSecond:10});
   const advanceWater=(time,active,weather)=>{budgetNow+=100;water.update(time,active,weather);};
   const fire=createEaldholtVillageFire({renderer,pointLights:false});let look;const sourceMaterials=[],geometries=[];
   const cloud=new T.Data3DTexture(new Uint8Array([0,0]),1,1,1);cloud.format=T.RGFormat;cloud.unpackAlignment=1;cloud.needsUpdate=true;
   const white=new T.DataTexture(new Uint8Array([255,255,255,255]),1,1,T.RGBAFormat);white.needsUpdate=true;
   const identity=new T.Matrix4(),environmentUniforms={cfCloudDensity:{value:cloud},cfCloudCoverage:{value:0},cfCloudGlobalTransmission:{value:1},cfCloudLightingEnabled:{value:1},cfCloudOffset:{value:new T.Vector2()},cfWorldSun:{value:new T.Vector3(0,1,0)},cfSurfaceWeatherEnabled:{value:1},cfEnvironmentSeconds:{value:12},cfCloudSourceToWorld:{value:identity},cfEnvironmentToSource:{value:identity},cfWorldWetness:{value:.2},cfRain:{value:.1},cfSkyHorizon:{value:new T.Color(.2,.3,.4)},cfSkyZenith:{value:new T.Color(.1,.2,.4)},cfDaylight:{value:1},cfWindStrength:{value:.4},cfWindDirection:{value:new T.Vector2(1,0)}};
   const gi={cfGiRadiance:{value:white},cfGiSunVisibility:{value:white},cfGiWorldToSource:{value:identity},cfGiMin:{value:new T.Vector3(-25,-2,-25)},cfGiSize:{value:new T.Vector3(50,8,50)},cfGiResolution:{value:new T.Vector3(1,1,1)},cfGiAtlasSize:{value:new T.Vector2(1,1)},cfGiColumns:{value:1},cfGiEnabled:{value:0},cfGiRadianceScale:{value:8},cfGiSunShadow:{value:1},cfGiSunWorldDirection:{value:new T.Vector3(0,1,0)}};
   const check=message=>{if(shaderErrors.length)throw Error(message+': '+JSON.stringify(shaderErrors));for(const p of renderer.info.programs??[])if(!gl.getProgramParameter(p.program,gl.LINK_STATUS))throw Error(message+': program link failed '+gl.getProgramInfoLog(p.program));const e=gl.getError();if(e)throw Error(message+': GL error '+e);};
   try{
    holdTarget.viewport.set(1,2,11,13);holdTarget.scissor.set(3,4,5,6);holdTarget.scissorTest=true;renderer.setRenderTarget(holdTarget);
    const state=()=>({logicalViewport:renderer.getViewport(new T.Vector4()).toArray(),logicalScissor:renderer.getScissor(new T.Vector4()).toArray(),logicalTest:renderer.getScissorTest(),physicalViewport:Array.from(gl.getParameter(gl.VIEWPORT)),physicalScissor:Array.from(gl.getParameter(gl.SCISSOR_BOX)),physicalTest:gl.isEnabled(gl.SCISSOR_TEST)});
    const before=state();
    const weather={wind:[1,0],windStrength:.75,rain:.2};advanceWater(0,true,weather);
    if(renderer.getRenderTarget()!==holdTarget||JSON.stringify(state())!==JSON.stringify(before))throw Error('Water compute changed foreign target state: '+JSON.stringify({before,after:state()}));
    renderer.setViewport(2,3,11,13);renderer.setScissor(1,2,10,12);renderer.setScissorTest(true);const explicit=state();advanceWater(.1,true,weather);advanceWater(.2,true,weather);
    if(JSON.stringify(state())!==JSON.stringify(explicit))throw Error('Water compute changed explicit target state: '+JSON.stringify({explicit,after:state()}));
    check('FFT preparation');renderer.setScissorTest(false);renderer.setViewport(0,0,48,48);renderer.setRenderTarget(target);
    if(water.uniforms.ready.value!==1)throw Error('Expected actual supported GPU FFT: '+JSON.stringify(water.diagnostics));
    const sampleMaterial=new T.ShaderMaterial({uniforms:{field:water.uniforms.surface1},vertexShader:'varying vec2 p;void main(){p=uv;gl_Position=vec4(position.xy,0.,1.);}',fragmentShader:'varying vec2 p;uniform sampler2D field;void main(){gl_FragColor=texture2D(field,p);}',depthTest:false,depthWrite:false,toneMapped:false});
    const sampleScene=new T.Scene(),sampleGeometry=new T.PlaneGeometry(2,2);sampleScene.add(new T.Mesh(sampleGeometry,sampleMaterial));const floatTarget=new T.WebGLRenderTarget(16,16,{type:T.FloatType});
    function field(){renderer.setRenderTarget(floatTarget);renderer.render(sampleScene,camera);const data=new Float32Array(16*16*4);renderer.readRenderTargetPixels(floatTarget,0,0,16,16,data);if(!data.every(Number.isFinite))throw Error('Nonfinite spectral field.');return data;}
    const a=field();advanceWater(.3,true,weather);advanceWater(.4,true,weather);const b=field();const energy=b.reduce((n,v)=>n+v*v,0),change=b.reduce((n,v,i)=>n+Math.abs(v-a[i]),0);if(!(energy>1e-12&&change>1e-10))throw Error('Spectral output did not advance: '+JSON.stringify({energy,change}));
    water.reset();renderer.setPixelRatio(2);advanceWater(10,true,weather);const ratioTwo=field();water.reset();renderer.setPixelRatio(.75);advanceWater(11,true,weather);const ratioLow=field();
    const pixelRatioError=ratioLow.reduce((error,v,i)=>Math.max(error,Math.abs(v-ratioTwo[i])),0);if(pixelRatioError>1e-6)throw Error('Presentation pixel ratio changed spectral fields: '+pixelRatioError);
    const diagnostic=JSON.stringify(water.diagnostics);advanceWater(10000,false,weather);advanceWater(10001,false,weather);if(JSON.stringify(water.diagnostics)!==diagnostic)throw Error('Held water advanced GPU work.');
    sampleMaterial.dispose();sampleGeometry.dispose();floatTarget.dispose();renderer.setRenderTarget(target);
    const phases=[];
    for(const profile of ['pond','trough','river','inlet','sea']){
     const source=new T.MeshStandardMaterial({color:0x081828});source.name=profile==='trough'?'Crownfall_Trough_Water_Review':'Crownfall_Pond_Water_Review';sourceMaterials.push(source);
     const geometry=new T.PlaneGeometry(4,4,4,4);geometry.rotateX(-Math.PI/2);geometries.push(geometry);const mesh=new T.Mesh(geometry,source);mesh.frustumCulled=false;model.add(mesh);
     if(profile==='pond'||profile==='trough')look=applyEaldholtWaterLook(model,null,{openWater:water});
     else{const frame={worldToSource:{value:new T.Matrix4()},sourceToWorldRotation:{value:new T.Matrix4()}};const material=new T.MeshPhysicalMaterial({color:0x081828,roughness:.24,ior:1.333});material.onBeforeCompile=s=>water.patchShader(s,frame,profile);mesh.material=material;}
     const physical=mesh.material,sourceCompile=physical.onBeforeCompile;physical.onBeforeCompile=function(s,r){sourceCompile.call(this,s,r);patchWorldEnvironmentMaterial(s,environmentUniforms,false,true,T.ShaderChunk.lights_fragment_begin);patchVoxelMaterial(s,gi,T.ShaderChunk.lights_fragment_begin);};
     await renderer.compileAsync(scene,camera);renderer.render(scene,camera);check('PBR weather/GI '+profile);phases.push(profile);look?.dispose();look=null;if(mesh.material!==source)mesh.material.dispose();model.remove(mesh);
    }
    scene.remove(model);scene.add(fire.rootObject3D);const p=fire.rootObject3D.children[0].position;camera.position.set(p.x,p.y+.4,p.z+2.5);camera.lookAt(p.x,p.y+.4,p.z);
    fire.update(0,true);await renderer.compileAsync(scene,camera);renderer.render(scene,camera);check('Combustion startup');
    const pixels=new Uint8Array(48*48*4);renderer.readRenderTargetPixels(target,0,0,48,48,pixels);const lit=pixels.reduce((n,v,i)=>n+(i%4<3&&v>5?1:0),0);if(!lit)throw Error('Initial reduced-motion fire is invisible: '+JSON.stringify({max:Math.max(...pixels),rgbMax:pixels.reduce((n,v,i)=>i%4<3?Math.max(n,v):n,0),diag:fire.runtime.diagnostics,camera:camera.position.toArray(),anchor:p.toArray(),gl:gl.getError()}));
    // Source cooking-fire bounds: translationY .989489436 + maxY .199937478.
    // A conservative opaque fuel bed must not bury the luminous flame root.
    const bedTop=1.189426914,bedHeight=.209798649;
    const bedGeometry=new T.BoxGeometry(1.414031744,bedHeight,1.241220713),bedMaterial=new T.MeshBasicMaterial({color:0x000000});
    const bed=new T.Mesh(bedGeometry,bedMaterial);bed.position.set(p.x,bedTop-bedHeight*.5,p.z);scene.add(bed);
    let visibleAboveFuelRatio;
    try{
     renderer.render(scene,camera);check('Source fuel-bed occlusion');
     const covered=new Uint8Array(pixels.length);renderer.readRenderTargetPixels(target,0,0,48,48,covered);
     const energy=data=>data.reduce((n,v,i)=>n+(i%4<3?v:0),0);
     visibleAboveFuelRatio=energy(covered)/energy(pixels);
     if(visibleAboveFuelRatio<.85)throw Error('Source logs bury the luminous fire root: '+JSON.stringify({visibleAboveFuelRatio,bedTop,anchorY:p.y}));
    }finally{scene.remove(bed);bedGeometry.dispose();bedMaterial.dispose();}
    const staticField=JSON.stringify(fire.runtime.diagnostics);fire.update(500,true,undefined,{wind:[0,1],windStrength:1,rain:1});if(JSON.stringify(fire.runtime.diagnostics)!==staticField)throw Error('Reduced-motion fire mutated.');
    fire.update(500.1,false,undefined,weather);fire.update(500.2,false,undefined,weather);fire.update(500.3,false,undefined,weather);renderer.render(scene,camera);check('Combustion motion');
    const loss=gl.getExtension('WEBGL_lose_context');let contextRecovery='extension-unavailable';
    if(loss){
     const event=name=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Context event timeout: '+name)),10000);renderer.domElement.addEventListener(name,()=>{clearTimeout(timer);resolve();},{once:true});});
     let done=event('webglcontextlost');loss.loseContext();await done;if(water.uniforms.ready.value!==0)throw Error('Lost context retained stale spectral publication.');
     done=event('webglcontextrestored');await new Promise(resolve=>setTimeout(resolve,100));loss.restoreContext();await done;const beforeRestore=water.diagnostics.spectrumBuilds;
     advanceWater(600,false,weather);if(water.uniforms.ready.value!==0)throw Error('Paused restore published unprepared fields.');
     advanceWater(600.1,true,weather);if(water.uniforms.ready.value!==1||water.diagnostics.spectrumBuilds!==beforeRestore+1)throw Error('Restored context failed to rebuild same-wind spectra.');
     check('Context recovery');contextRecovery='lost-held-restored-rebuilt';
    }
    rows.push({platform,revision:T.REVISION,fft:{energy,change,pixelRatioError,...water.diagnostics},fire:{litComponents:lit,visibleAboveFuelRatio,...fire.runtime.diagnostics},phases,contextRecovery,linkedPrograms:renderer.info.programs.length,shaderErrors});
   }finally{look?.dispose();fire.dispose();water.dispose();for(const g of geometries)g.dispose();for(const m of sourceMaterials)m.dispose();target.dispose();holdTarget.dispose();cloud.dispose();white.dispose();renderer.dispose();renderer.forceContextLoss();canvas.remove();}
  }return rows;
 },{root});
 assert.deepEqual(errors,[]);const report={scope:'Isolated actual production adapter shader/numerical checks; not a world screenshot, XR test or hardware benchmark.',hashes,results};
 if(process.env.CROWNFALL_WATER_FIRE_REPORT)writeFileSync(process.env.CROWNFALL_WATER_FIRE_REPORT,JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{clearTimeout(deadline);await browser?.close();}
