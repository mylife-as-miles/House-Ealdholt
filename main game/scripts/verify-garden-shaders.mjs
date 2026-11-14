// Bounded production-shader link check. No game, assets, screenshots or saved profile.
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import ts from 'typescript';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const origin=new URL(process.env.CROWNFALL_TEST_URL??'http://127.0.0.1:4191');
assert.ok(['localhost','127.0.0.1','[::1]'].includes(origin.hostname),'GPU check accepts loopback only.');
const names=['garden-planting','garden-life','water-look'];
const adapterPaths=['main game','main-game-vr'].flatMap(app=>names.map(name=>app+'/src/legacy/aethelgard/'+name+'.ts'));
const hooks=[...adapterPaths,...['garden-planting','garden-particles','vegetation-wind','environment-material-shader','voxel-radiance-shaders','water-ripples'].map(name=>'shared/legacy/aethelgard/environment/'+name+'.ts')];
const digest=path=>createHash('sha256').update(readFileSync(resolve(root,path))).digest('hex');
const productionSha256=Object.fromEntries(hooks.map(path=>[path,digest(path)]));
const nativeFiles=Object.fromEntries(['three.module.js','three.core.js'].map(name=>[name,readFileSync(resolve(root,'main-game-vr/node_modules/three/build',name),'utf8')]));
const nativeModuleSha256=Object.fromEntries(Object.entries(nativeFiles).map(([name,source])=>[name,createHash('sha256').update(source).digest('hex')]));
const adapters={};
for(const [runtime,app,three] of [['desktop','main game','/node_modules/three/build/three.module.js'],['native-installed-renderer','main-game-vr','/__garden-native-three/three.module.js']]){
 for(const name of names){
  const path=resolve(root,app,'src/legacy/aethelgard',name+'.ts');
  // Use each unchanged production factory body. Only its runtime import is
  // redirected: Native's IWSDK re-export becomes its installed Three, without
  // loading an SDK world. Shared production modules still come through Vite.
  const source=readFileSync(path,'utf8').replace(/\bfrom\s*(['"])([^'"]+)\1/g,(all,quote,id)=>{
   if(id==='three'||id==='@iwsdk/core')return 'from '+JSON.stringify(three);
   if(id.startsWith('.'))return 'from '+JSON.stringify('/@fs/'+resolve(dirname(path),id)+'.ts');
   return all;
  });
  const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022},reportDiagnostics:true});
  assert.equal(compiled.diagnostics?.length??0,0,'Factory transpilation failed: '+path);
  adapters['/__garden-adapters/'+runtime+'/'+name+'.js']=compiled.outputText;
 }
}

let browser=null,result=null,failure=null,closed=false,expired=false;const errors=[];
const deadline=setTimeout(()=>{expired=true;void browser?.close().catch(()=>{});},50_000);
try{
 browser=await chromium.launch({headless:true,timeout:10_000,executablePath:process.env.CHROMIUM_PATH??'/usr/bin/chromium',args:['--disable-dev-shm-usage','--enable-unsafe-swiftshader']});
 const page=await browser.newPage();page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
 await page.route('**/*',route=>{
  const url=new URL(route.request().url());if(url.origin!==origin.origin)return route.abort();
  if(url.pathname.startsWith('/__garden-native-three/')){const source=nativeFiles[url.pathname.split('/').at(-1)];return source?route.fulfill({contentType:'text/javascript',body:source}):route.abort();}
  if(adapters[url.pathname])return route.fulfill({contentType:'text/javascript',body:adapters[url.pathname]});
  if(url.pathname==='/__garden-shaders-gpu.html')return route.fulfill({contentType:'text/html',body:'<!doctype html><link rel="icon" href="data:,"><canvas></canvas>'});
  // This isolated fixture has no reason to request application assets or pages.
  if(/\.(?:glb|gltf|hdr|png|jpe?g|webp|mp[34]|ogg|woff2?)(?:$|\?)/i.test(url.pathname))return route.abort();
  return route.continue();
 });
 await page.goto(new URL('/__garden-shaders-gpu.html',origin).href,{timeout:10_000});
 result=await page.evaluate(async({root})=>{
  const shared='/@fs/'+root+'/shared/legacy/aethelgard/environment/';
  const {patchWorldEnvironmentMaterial,WORLD_ENVIRONMENT_SHADER_VERSION}=await import(shared+'environment-material-shader.ts');
  const {patchVoxelMaterial}=await import(shared+'voxel-radiance-shaders.ts');
  const {EALDHOLT_POND_GRAVITY_WAVES}=await import(shared+'water-ripples.ts');
  if(EALDHOLT_POND_GRAVITY_WAVES.length!==5)throw Error('Expected the five production pond waves.');
  const links=[],rows=[],seams=[],shaderErrors=[];
  const runtimes=[{name:'desktop',url:'/node_modules/three/build/three.module.js'},{name:'native-installed-renderer',url:'/__garden-native-three/three.module.js'}];
  for(const runtime of runtimes){
   const T=await import(runtime.url),base='/__garden-adapters/'+runtime.name+'/';
   const {createEaldholtGardenPlanting}=await import(base+'garden-planting.js'),{createEaldholtGardenLife}=await import(base+'garden-life.js'),{applyEaldholtWaterLook}=await import(base+'water-look.js');
   const renderer=new T.WebGLRenderer({canvas:document.createElement('canvas'),alpha:true,antialias:false});renderer.setSize(32,32);renderer.setPixelRatio(1);renderer.toneMapping=T.ACESFilmicToneMapping;
   const gl=renderer.getContext(),target=new T.WebGLRenderTarget(32,32),textures=[],clones=[],seenPrograms=new Set();
   renderer.debug.checkShaderErrors=true;renderer.debug.onShaderError=(g,program,vertex,fragment)=>shaderErrors.push({runtime:runtime.name,program:g.getProgramInfoLog(program),vertex:g.getShaderInfoLog(vertex),fragment:g.getShaderInfoLog(fragment)});
   const cloud=new T.Data3DTexture(new Uint8Array([0,0]),1,1,1);cloud.format=T.RGFormat;cloud.unpackAlignment=1;cloud.needsUpdate=true;textures.push(cloud);
   const white=new T.DataTexture(new Uint8Array([255,255,255,255]),1,1,T.RGBAFormat);white.needsUpdate=true;textures.push(white);
   const identity=new T.Matrix4(),weather={cfCloudDensity:{value:cloud},cfCloudCoverage:{value:0},cfCloudGlobalTransmission:{value:1},cfCloudLightingEnabled:{value:1},cfCloudOffset:{value:new T.Vector2()},cfWorldSun:{value:new T.Vector3(0,1,0)},cfSurfaceWeatherEnabled:{value:1},cfEnvironmentSeconds:{value:12},cfCloudSourceToWorld:{value:identity},cfEnvironmentToSource:{value:identity},cfWorldWetness:{value:.2},cfRain:{value:.1},cfSkyHorizon:{value:new T.Color(.2,.3,.4)},cfSkyZenith:{value:new T.Color(.1,.2,.4)},cfDaylight:{value:1},cfWindStrength:{value:.4},cfWindDirection:{value:new T.Vector2(1,0)}};
   const gi={cfGiRadiance:{value:white},cfGiSunVisibility:{value:white},cfGiWorldToSource:{value:identity},cfGiMin:{value:new T.Vector3(-25,-2,-25)},cfGiSize:{value:new T.Vector3(50,8,50)},cfGiResolution:{value:new T.Vector3(1,1,1)},cfGiAtlasSize:{value:new T.Vector2(1,1)},cfGiColumns:{value:1},cfGiEnabled:{value:0},cfGiRadianceScale:{value:8},cfGiSunShadow:{value:1},cfGiSunWorldDirection:{value:new T.Vector3(0,1,0)}};
   const scene=new T.Scene(),camera=new T.PerspectiveCamera(60,1,.01,100);camera.position.set(0,18,24);camera.lookAt(0,0,0);
   const sun=new T.DirectionalLight(0xffffff,2),moon=new T.DirectionalLight(0xaaccee,.2);sun.position.set(0,20,0);moon.position.set(0,-20,0);scene.add(new T.AmbientLight(0xffffff,.4),sun,moon);
   const source=new T.Group(),geometry=(size,y)=>{const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute([-size,y,-size,-size,y,size,size,y,size,-size,y,-size,size,y,size,size,y,-size],3));g.computeVertexNormals();return g;};
   const waterMaterial=new T.MeshStandardMaterial({side:T.DoubleSide});waterMaterial.name='Crownfall_Pond_Water_Review';
   const pond=new T.Mesh(geometry(10,0),waterMaterial),land=new T.Mesh(geometry(25,.2),new T.MeshStandardMaterial());land.name='LandscapeComponent_0';source.add(pond,land);
   const plants=createEaldholtGardenPlanting(source,{profile:runtime.name==='desktop'?'desktop':'quest'});
   if(!plants.stats.qualified||plants.stats.plants<1)throw Error('Production garden fixture failed qualification: '+JSON.stringify(plants.stats));
   source.add(plants.object);const water=applyEaldholtWaterLook(source);if(water.materialCount!==1||!pond.material.isMeshPhysicalMaterial)throw Error('Production physical pond material was not installed.');
   const life=createEaldholtGardenLife(source,{anchor:plants.anchor,native:runtime.name!=='desktop'});source.add(life.object);land.visible=false;pond.visible=false;scene.add(source);
   const originalMaterials=new Map(plants.object.children.map(mesh=>[mesh,mesh.material]));
   function compose(material,label,full){
    const clone=material.clone(),prior=material.onBeforeCompile,key=material.customProgramCacheKey;clones.push(clone);
    clone.onBeforeCompile=function(shader,r){
     prior.call(this,shader,r);
     if(full){patchWorldEnvironmentMaterial(shader,weather,false,label==='pond',T.ShaderChunk.lights_fragment_begin);patchVoxelMaterial(shader,gi,T.ShaderChunk.lights_fragment_begin);}
     const counts=Object.fromEntries(['uniform mat4 cfEnvironmentToSource;','uniform float cfEnvironmentSeconds;','uniform float cfWindStrength;','uniform vec2 cfWindDirection;'].map(text=>[text,shader.vertexShader.split(text).length-1]));
     const wind=shader.vertexShader.includes('CROWNFALL_VEGETATION_WIND'),waves=(shader.fragmentShader.match(/ripples \+= ealdholtPondGravityBand\(point/g)??[]).length;
     if(wind&&Object.values(counts).some(count=>count!==1))throw Error('Duplicate source-wind declarations: '+JSON.stringify({label,counts}));
     if(wind&&full&&shader.uniforms.cfEnvironmentToSource!==weather.cfEnvironmentToSource)throw Error('Weather clone lost the live source frame.');
     if(label==='pond'&&(waves!==5||!shader.fragmentShader.includes('CROWNFALL_POND_GRAVITY_RIPPLES')))throw Error('Physical pond lost the production five-wave patch.');
     if(full&&(!shader.fragmentShader.includes('CROWNFALL_WORLD_ENVIRONMENT')||!shader.fragmentShader.includes('uniform sampler2D cfGiRadiance;')))throw Error('Production PBR composition seam missing.');
     seams.push({runtime:runtime.name,label,full,wind,counts,waves});
    };
    clone.customProgramCacheKey=()=>key.call(material)+':garden-gpu:'+label+':'+full;return clone;
   }
   function inspectPrograms(label){for(const program of renderer.info.programs){if(seenPrograms.has(program.id))continue;seenPrograms.add(program.id);const linked=gl.getProgramParameter(program.program,gl.LINK_STATUS)===true,log=gl.getProgramInfoLog(program.program)??'';links.push({runtime:runtime.name,label,id:program.id,linked,log});if(!linked)throw Error('Garden shader link failed: '+JSON.stringify({runtime:runtime.name,label,log,shaderErrors}));}}
   async function draw(label){renderer.setRenderTarget(target);await renderer.compileAsync(scene,camera);renderer.render(scene,camera);inspectPrograms(label);const error=gl.getError();if(error)throw Error('Garden fixture GL error: '+error);if(renderer.info.render.calls<1)throw Error('No real draw submitted for '+label);rows.push({runtime:runtime.name,revision:T.REVISION,label,calls:renderer.info.render.calls,programs:renderer.info.programs.length});}
   try{
    plants.update(12,true,{direction:[1,0],strength:.4});water.update(12,true,{wind:[1,0],windStrength:.4});water.update(12.1,true,{wind:[1,0],windStrength:.4});
    for(const full of[false,true]){
     for(const mesh of plants.object.children){mesh.frustumCulled=false;mesh.material=compose(originalMaterials.get(mesh),mesh.name,full);}
     await draw(full?'plant-wind-weather-GI':'plant-wind-only');
    }
    plants.object.visible=false;pond.visible=true;const physical=pond.material;pond.frustumCulled=false;
    for(const full of[false,true]){pond.material=compose(physical,'pond',full);await draw(full?'pond-five-wave-weather-GI':'pond-five-wave-physical');}pond.visible=false;pond.material=physical;
    const frame={animationSeconds:12,daylight:1,wind:[1,0],windStrength:.1,reducedMotion:false,rain:0,active:true,paused:false};
    for(const daylight of[1,0]){life.update({...frame,daylight});for(const points of life.object.children)points.frustumCulled=false;await draw(daylight?'production-motes':'production-fireflies');}
   }finally{
    renderer.setRenderTarget(null);life.dispose();water.dispose();plants.dispose();for(const clone of clones)clone.dispose();pond.geometry.dispose();land.geometry.dispose();waterMaterial.dispose();land.material.dispose();target.dispose();for(const texture of textures)texture.dispose();renderer.dispose();renderer.forceContextLoss();
   }
  }
  return{rows,links,seams,shaderErrors,weatherVersion:WORLD_ENVIRONMENT_SHADER_VERSION,pondWaves:EALDHOLT_POND_GRAVITY_WAVES.length};
 },{root});
 assert.equal(expired,false,'GPU fixture exceeded50 seconds.');assert.equal(errors.length,0,errors.join('\n'));assert.equal(result.shaderErrors.length,0,JSON.stringify(result.shaderErrors));assert.equal(result.rows.length,12);assert.ok(result.links.length>=10);
 for(const runtime of['desktop','native-installed-renderer']){
  assert.equal(result.rows.filter(row=>row.runtime===runtime).length,6);
  assert.ok(result.seams.some(row=>row.runtime===runtime&&row.wind&&row.full));
  assert.equal(result.seams.filter(row=>row.runtime===runtime&&row.label==='pond'&&row.waves===5).length,2);
 }
 for(const program of result.links)assert.ok(program.linked,JSON.stringify(program));for(const path of hooks)assert.equal(digest(path),productionSha256[path],'Production source changed during verification: '+path);
}catch(error){failure=error instanceof Error?error.stack:String(error);process.exitCode=1;}
finally{clearTimeout(deadline);if(browser){await browser.close();closed=true;}}
console.log(JSON.stringify({passed:!failure&&!expired&&closed,browserClosed:closed,expired,failure,errors,productionSha256,nativeModuleSha256,...result,scope:'Actual production factory shaders and installed Desktop/Native Three WebGLRenderer compile, draw and LINK_STATUS only; Native runtime import redirected from IWSDK re-export to its installed Three. Full weather/GI on Native is shader compatibility coverage. No game assets, SDK world, screenshot, frame-rate, headset or visual-quality acceptance.'}));
