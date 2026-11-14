import test,{type TestContext}from'node:test';import assert from'node:assert/strict';
import{BoxGeometry,DirectionalLight,Group,HemisphereLight,Mesh,PerspectiveCamera,Scene,ShaderMaterial,Vector2,Vector3,type WebGLRenderer}from'three';
import{createWorldEnvironment}from'./world-environment';
import{createWorldPreparationQueue}from'../../../../shared/legacy/aethelgard/environment/world-preparation-queue';
import type{WorldEnvironmentOverride}from'../../../../shared/legacy/aethelgard/environment/world-environment-state';
const native=false,flush=()=>new Promise<void>(resolve=>setImmediate(resolve));
function fixture(context:TestContext,sunInSource=false){
 const prior=Object.getOwnPropertyDescriptor(globalThis,'Worker');class PendingCloud{onmessage:unknown;onerror:unknown;postMessage(){}terminate(){}}Object.defineProperty(globalThis,'Worker',{configurable:true,value:PendingCloud});
 const fill=new HemisphereLight(0xffffff,0x514a37,.18),ground=fill.groundColor.clone();
 const sourceRoot=new Group(),atmosphere=new Group(),scene=new Scene(),sun=new DirectionalLight(),sunFrame=new Group(),camera=new PerspectiveCamera();sourceRoot.position.set(300,40,-700);sourceRoot.rotation.y=.7;sourceRoot.scale.set(2,3,.5);sunFrame.rotation.y=.4;sunFrame.scale.set(1.1,1.6,.7);sunFrame.add(sun,sun.target);scene.add(sourceRoot,atmosphere,camera);(sunInSource?sourceRoot:scene).add(sunFrame);scene.environmentIntensity=1.7;
 const originalVertex='void main(){gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.);}',originalFragment='void main(){gl_FragColor=vec4(1.);}',geometry=new BoxGeometry(),sky=new ShaderMaterial({vertexShader:originalVertex,fragmentShader:originalFragment});atmosphere.add(new Mesh(geometry,sky));
 const queue=createWorldPreparationQueue(()=>{});let minute=0,override:WorldEnvironmentOverride={weather:'clear'},reads=0,compiles=0;
 const renderer={debug:{onShaderError:undefined},shadowMap:{enabled:false},async compileAsync(){compiles++;}}as unknown as WebGLRenderer;
 const environment=createWorldEnvironment({sourceRoot,atmosphere,scene,sun,fill,camera,renderer,queue,signal:new AbortController().signal,native,quality:()=> 'low',reducedMotion:()=>true,readClock(){reads++;return{time:{absoluteWorldMinute:minute,fractionalMinute:0,dayIndex:Math.floor(minute/1440),dayMinute:minute%1440,elapsedWorldMinutes:minute,deferredMilliseconds:0},worldKey:'celestial-adapter-fixture',animationSeconds:minute*60};},override:()=>override,setSunDirection(direction){sun.position.copy(sun.target.position).addScaledVector(direction,145);},changed(){}});
 context.after(async()=>{environment.dispose();queue.dispose();await queue.whenIdle();await flush();assert.equal(sky.fragmentShader,originalFragment);assert.equal(sky.vertexShader,originalVertex);geometry.dispose();sky.dispose();if(prior)Object.defineProperty(globalThis,'Worker',prior);else Reflect.deleteProperty(globalThis,'Worker');});
 return{environment,sourceRoot,scene,sun,fill,ground,camera,sky,setMinute(value:number){minute=value;},setOverride(value:WorldEnvironmentOverride){override=value;},get reads(){return reads;},get compiles(){return compiles;}};
}
test('the real sky and moon light share world directions and exact phase across nonidentity/nonuniform scene frames',async context=>{
 const f=fixture(context);f.environment.update(0);const state=f.environment.state!,moon=f.sourceRoot.getObjectByName('Ealdholt clock-driven moonlight')as DirectionalLight;assert.ok(moon);const worldMoon=moon.getWorldPosition(new Vector3()).sub(moon.target.getWorldPosition(new Vector3())).normalize(),worldSun=f.sun.getWorldPosition(new Vector3()).sub(f.sun.target.getWorldPosition(new Vector3())).normalize();assert.ok(Math.abs(worldMoon.dot(worldSun)-(1-2*state.celestial.moonIllumination))<1e-11);assert.ok((f.sky.uniforms.cfWorldMoon.value as Vector3).distanceTo(worldMoon)<1e-12);assert.ok((f.sky.uniforms.cfWorldSun.value as Vector3).distanceTo(worldSun)<1e-12);assert.equal(moon.intensity,state.moonIntensity);assert.ok(moon.intensity>0);assert.equal(f.sky.uniforms.cfMoonIllumination.value,state.celestial.moonIllumination);assert.equal(f.environment.stats.moonPhase,.375);assert.equal(f.sky.uniforms.cfNightVisibility.value,1);
 const before=worldMoon.clone(),rotation=(f.sky.uniforms.cfStarRotation.value as Vector2).clone(),shader=f.sky.fragmentShader;f.camera.position.set(100,35,400);f.camera.rotation.y=1.4;f.environment.update(16);assert.ok((f.sky.uniforms.cfWorldMoon.value as Vector3).distanceTo(before)<1e-12);assert.ok((f.sky.uniforms.cfStarRotation.value as Vector2).distanceTo(rotation)<1e-12);assert.equal(f.sky.fragmentShader,shader);assert.match(shader,/sky\+=cfCelestialSky\(ray\)/);assert.match(f.sky.vertexShader,/\.xyz-cameraPosition/);assert.equal(f.compiles,0);if(native)assert.equal(f.scene.environmentIntensity,1.7,'Native IBL remains on its honest ambient fallback.');
});
test('reduced motion keeps a nonblack moonless sky and the same clock still moves its calendar without rebaking',async context=>{
 const f=fixture(context);f.environment.update(0);const density=f.environment.cloudField.texture;f.setMinute(18*1440);f.environment.update(1000);const state=f.environment.state!;assert.ok(state.celestial.moonIllumination<.01);assert.equal(state.moonIntensity,0);assert.equal(f.sky.uniforms.cfMoonWashout.value,0);assert.equal(f.sky.uniforms.cfNightVisibility.value,1);assert.equal(f.environment.stats.milkyWayVisibility,1);assert.ok((f.sky.uniforms.cfSkyZenith.value as{r:number;g:number;b:number}).b>0);assert.equal(f.sky.uniforms.cfEnvironmentSeconds.value,0);assert.deepEqual((f.sky.uniforms.cfCloudOffset.value as Vector2).toArray(),[0,0]);assert.equal(f.environment.cloudField.texture,density);assert.equal(f.environment.stats.cloudDensityBuilds,0);assert.equal(f.compiles,0);const reads=f.reads;f.environment.prepare(1016,true);assert.equal(f.reads,reads,'Preparation never owns a new celestial clock.');
});
test('fair-weather cumulus and explicit cloud/rain overrides reach the actual sky uniforms on both adapters',async context=>{
 const f=fixture(context);f.setMinute(720);f.setOverride({weather:'rain'});f.environment.update(0);assert.ok(f.environment.stats.rain>.8);f.setOverride({weather:'clear',cloudCoverage:.22,rain:0,windStrength:0});f.environment.update(16);assert.equal(f.environment.stats.weather,'clear');assert.equal(f.sky.uniforms.cfCloudCoverage.value,.22);assert.equal(f.sky.uniforms.cfRain.value,0);assert.equal(f.sky.uniforms.cfNightVisibility.value,0);assert.equal(f.environment.stats.windStrength,0);assert.match(f.sky.fragmentShader,/cfCloudSample\(q\)/);assert.match(f.sky.fragmentShader,/colour\+sky\*transmission/);assert.match(f.sky.fragmentShader,/beer\*mix\(.55,1.,powder\)/,'Cumulus keeps the existing source billows and Beer/powder lighting.');f.setOverride({weather:'clear',cloudCoverage:0});f.environment.update(32);assert.equal(f.sky.uniforms.cfCloudCoverage.value,0);
});

for(const sunInSource of[false,true])test('a held calendar refreshes the '+(sunInSource?'miniature':'independent')+' sun and moon frames without new preparation',context=>{
  const f=fixture(context,sunInSource);f.environment.update(0);
  const state=f.environment.state!,moon=f.sourceRoot.getObjectByName('Ealdholt clock-driven moonlight')as DirectionalLight,shader=f.sky.fragmentShader,density=f.environment.cloudField.texture;
  const assertDirections=()=>{
   const worldMoon=moon.getWorldPosition(new Vector3()).sub(moon.target.getWorldPosition(new Vector3())).normalize(),worldSun=f.sun.getWorldPosition(new Vector3()).sub(f.sun.target.getWorldPosition(new Vector3())).normalize();
   assert.ok((f.sky.uniforms.cfWorldMoon.value as Vector3).distanceTo(worldMoon)<1e-12,'Visible lunar disc must follow its actual light during miniature orbit/zoom.');
   assert.ok((f.sky.uniforms.cfWorldSun.value as Vector3).distanceTo(worldSun)<1e-12);
   assert.ok(Math.abs(worldMoon.dot(worldSun)-(1-2*state.celestial.moonIllumination))<1e-11,'Nonuniform transforms must preserve geometric lunar phase.');
   assert.equal(f.environment.state,state,'A view change must retain the sampled saved calendar.');
  };
  assertDirections();
  f.sourceRoot.rotation.set(.23,1.1,.1);f.sourceRoot.scale.set(.02,.035,.013);f.sourceRoot.position.set(-4,2,-9);
  const reads=f.reads;assert.equal(f.environment.update(16),true);assert.equal(f.reads,reads+1,'Frame refresh uses the existing single clock read.');assertDirections();
  f.sun.parent!.rotation.set(-.12,.35,.07);f.sun.parent!.scale.set(1.4,.7,2.2);
  assert.equal(f.environment.update(32),true);assertDirections();
  assert.equal(f.environment.update(48),false,'A stationary held frame has no repeated visual invalidation.');
  assert.equal(f.sky.fragmentShader,shader);assert.equal(f.environment.cloudField.texture,density);assert.equal(f.environment.stats.cloudDensityBuilds,0);assert.equal(f.compiles,0);
});


test('actual hemisphere and its existing GI product apply sky irradiance once while preserving noon and ground energy',context=>{
 const f=fixture(context),close=(a:number,b:number)=>assert.ok(Math.abs(a-b)<1e-12,`${a} != ${b}`);
 for(const minute of[720,1080,1095,1140,1440,720,1080]){
  f.setMinute(minute);f.environment.update(minute*1000);const state=f.environment.state!;
  const sky=[f.fill.color.r,f.fill.color.g,f.fill.color.b],ground=[f.fill.groundColor.r,f.fill.groundColor.g,f.fill.groundColor.b];
  const originalGround=[f.ground.r,f.ground.g,f.ground.b];
  for(let i=0;i<3;i++){
   close(sky[i]*f.fill.intensity,state.skyHorizon[i]*.18);
   close(ground[i]*f.fill.intensity,originalGround[i]*.18*(.1+.9*state.daylight));
  }
  const moon=f.sourceRoot.getObjectByName('Ealdholt clock-driven moonlight')as DirectionalLight;
  close(moon.intensity,state.moonIntensity);
  assert.ok(f.sky.uniforms.cfSkyHorizon.value!==f.fill.color,'Visible sky colour must retain its independently owned radiance.');
  if(native)assert.equal(f.scene.environmentIntensity,1.7,'Native ambient fallback ownership is unchanged.');
 }
 assert.equal(f.compiles,0);assert.equal(f.environment.stats.cloudDensityBuilds,0);
});
