import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {chromium} from 'playwright';
import * as desktop from 'three';
import {patchWorldEnvironmentMaterial,WORLD_ENVIRONMENT_SHADER_VERSION} from '../../../../shared/legacy/aethelgard/environment/environment-material-shader';
import {patchVegetationWind} from '../../../../shared/legacy/aethelgard/environment/vegetation-wind';
import {patchVoxelMaterial} from '../../../../shared/legacy/aethelgard/environment/voxel-radiance-shaders';
import {patchRegionalForestFloor} from '../../../../shared/legacy/aethelgard/environment/regional-forest-floor';
import {createEaldholtBankExposureSections,patchEaldholtWoodlandValleySurface} from '../../../../shared/legacy/aethelgard/environment/woodland-ground';
import {patchEaldholtWaterRipples} from '../../../../shared/legacy/aethelgard/environment/water-ripples';
import {patchEaldholtWaterShoreColor} from '../../../../shared/legacy/aethelgard/environment/water-shore-color';
import {patchEaldholtRiverFlow} from '../../../../shared/legacy/aethelgard/environment/river-flow-shader';
import {recordedEaldholtChannelSamples} from '../../../../shared/legacy/aethelgard/environment/authored-bank-knots.fixture';
import {packEaldholtBankExposure,ealdholtBankLookupUniformVectors} from '../../../../shared/legacy/aethelgard/environment/authored-bank-knots';
import {bankStageDiagnosticSignature} from '../../../../shared/legacy/aethelgard/environment/bank-material-diagnostics';
import {worldSkyShader} from '../../../../shared/legacy/aethelgard/environment/world-sky-shader';
import {sampleWorldEnvironment} from '../../../../shared/legacy/aethelgard/environment/world-environment-state';
import {WORLD_CELESTIAL_SHADER_VERSION} from '../../../../shared/legacy/aethelgard/environment/world-celestial-shader';

const root=new URL('../../../../',import.meta.url),native=createRequire(new URL('main-game-vr/package.json',root))('three') as typeof desktop;
const runtimes=[{name:'desktop',three:desktop,path:'main game'},{name:'native',three:native,path:'main-game-vr'}].map(runtime=>{
 // Use the installed renderer's ACTUAL private preprocessing functions. Merely
 // defining NUM_DIR_LIGHTS leaves a GLSL loop intact and misses the High bug.
 const source=readFileSync(new URL(runtime.path+'/node_modules/three/src/renderers/webgl/WebGLProgram.js',root),'utf8');
 const begin=source.indexOf('const unrollLoopPattern ='),end=source.indexOf('\nfunction generatePrecision',begin);assert.ok(begin>=0&&end>begin);
 const unroll=Function(source.slice(begin,end)+'\nreturn unrollLoops;')() as (source:string)=>string;
 const precisionEnd=source.indexOf('\nconst shadowMapTypeDefines',end);assert.ok(precisionEnd>end);
 const precision=(Function(source.slice(end,precisionEnd)+'\nreturn generatePrecision;')() as (options:{precision:string})=>string)({precision:'highp'});
 return{...runtime,unroll,precision,rendererSha256:createHash('sha256').update(source).digest('hex')};
});
type Runtime=typeof runtimes[number];
function expand(runtime:Runtime,source:string):string{return source.replace(/#include <([\w_]+)>/g,(_all,name:string)=>{const chunk=(runtime.three.ShaderChunk as Record<string,string>)[name];assert.equal(typeof chunk,'string',name);return expand(runtime,chunk);});}
function preprocess(runtime:Runtime,source:string,lights:number,shadow:boolean){return runtime.unroll(expand(runtime,source).replace(/\b(?:NUM_[A-Z_0-9]+|UNION_CLIPPING_PLANES)\b/g,name=>String(name==='NUM_DIR_LIGHTS'?lights:name==='NUM_DIR_LIGHT_SHADOWS'&&shadow?1:name==='NUM_POINT_LIGHTS'?1:0)));}
const scoped=/\{\s*(vec3 cfDirectionalWorld=[\s\S]*?cfCloudSunGain\(cfCloudWorldPoint\(cfEnvironmentPoint\)\);)\s*\}/;
function undoScope(fragment:string){assert.match(fragment,scoped);return fragment.replace(scoped,'$1');}
function pbr(runtime:Runtime,lights:number,shadow=false,kind='plain',weatherFirst=false,legacy=false,recordedBank=false){
 const shader={uniforms:{},vertexShader:runtime.three.ShaderLib.standard.vertexShader,fragmentShader:runtime.three.ShaderLib.standard.fragmentShader},chunk=runtime.three.ShaderChunk.lights_fragment_begin;
 let bankProfile:{knots:number;packed:number[];exposure:number[];stages:number[];signature:string;vectors:number}|null=null;
 const weather=()=>patchWorldEnvironmentMaterial(shader,{},false,kind==='water',chunk);
 if(kind==='bank'){
  const sections=createEaldholtBankExposureSections(recordedBank?recordedEaldholtChannelSamples():[-30,-5,5,.3,-10,-4,6,.31,10,-6,4,.8,30,-5,5,.7],64);
  if(recordedBank)bankProfile={knots:sections.authoredBanks.count,packed:Array.from(sections.authoredBanks.data),exposure:Array.from(packEaldholtBankExposure(sections.data,sections.count)),stages:Array.from(sections.waterStages.data),signature:bankStageDiagnosticSignature(sections.authoredBanks.data),vectors:ealdholtBankLookupUniformVectors(sections.authoredBanks.count,sections.count,sections.waterStages.count)};
  patchEaldholtWoodlandValleySurface(shader,.06,'attribute',{waterHeight:.3,earthNormal:{},earthOrm:{},rock:{albedo:{},normal:{},meanLuminance:.1},woodland:{bank:{tileMetres:1.3,targetLuminance:.06},meadow:{albedo:{},normal:{},meanLuminance:.07,targetLuminance:.07,tileMetres:2},sections}});
  if(weatherFirst)weather();patchRegionalForestFloor(shader,{});if(!weatherFirst)weather();
 }else if(kind==='water'){
  patchEaldholtWaterRipples(shader,{time:{value:0},metresPerWorldUnit:{value:1},worldToSource:{value:new desktop.Matrix4()},sourceToWorldRotation:{value:new desktop.Matrix4()}});
  if(weatherFirst)weather();patchEaldholtWaterShoreColor(shader);patchEaldholtRiverFlow(shader);if(!weatherFirst)weather();
 }else if(kind==='gi'){
  if(weatherFirst)weather();patchVoxelMaterial(shader,{},chunk);if(!weatherFirst)weather();
 }else weather();
 if(kind==='wind')patchVegetationWind(shader,{}, {root:[0,0,0],tip:[0,2,0],grass:false});
 if(legacy)shader.fragmentShader=undoScope(shader.fragmentShader);
 const flags=(shadow?'#define USE_SHADOWMAP\n#define SHADOWMAP_TYPE_PCF\n':'')+(kind==='wind'?'#define USE_INSTANCING\n#define USE_ALPHATEST\n':'')+(kind==='bank'?'#define USE_MAP\n#define MAP_UV uv\n#define USE_NORMALMAP\n#define USE_NORMALMAP_TANGENTSPACE\n#define NORMALMAP_UV uv\n#define USE_AOMAP\n#define AOMAP_UV uv\n#define USE_COLOR\n#define USE_FOG\n':'');
 const common='#version 300 es\n'+runtime.precision+'\n'+flags+'uniform mat4 viewMatrix;uniform vec3 cameraPosition;uniform bool isOrthographic;\n';
 return{name:`${runtime.name}-${kind}-${lights}dir-shadow${Number(shadow)}-first${Number(weatherFirst)}${legacy?'-OLD':''}${recordedBank?'-recorded54':''}`,legacy,bankProfile,
  vertex:common+'#define attribute in\n#define varying out\n#define texture2D texture\nuniform mat4 modelMatrix;uniform mat4 modelViewMatrix;uniform mat4 projectionMatrix;uniform mat3 normalMatrix;\nin vec3 position;in vec3 normal;in vec2 uv;in vec3 color;\n'+(kind==='wind'?'in mat4 instanceMatrix;\n':'')+preprocess(runtime,shader.vertexShader,lights,shadow),
  fragment:common+'#define varying in\n#define texture2D texture\n#define textureCube texture\n#define gl_FragColor result\nout vec4 result;vec4 linearToOutputTexel(vec4 value){return value;}\n'+preprocess(runtime,shader.fragmentShader,lights,shadow)};
}
function numeric(runtime:Runtime,lights:number){
 const pars=runtime.three.ShaderChunk.lights_pars_begin,structure=pars.match(/struct DirectionalLight \{[\s\S]*?\};/)?.[0],info=pars.match(/void getDirectionalLightInfo\([\s\S]*?light\.visible = true;\s*\}/)?.[0];assert.ok(structure&&info);const dir=structure+'\n'+info;
 const shader={uniforms:{},vertexShader:'#include <common>',fragmentShader:`#include <common>
 ${dir}
 uniform DirectionalLight directionalLights[${Math.max(1,lights)}];uniform mat4 viewMatrix;
 void main(){IncidentLight directLight;DirectionalLight directionalLight;vec3 fire=vec3(.125,.25,.375);vec3 sum=fire;
 #pragma unroll_loop_start
 for(int i=0;i<${lights};i++){
 directionalLight=directionalLights[i];
 getDirectionalLightInfo( directionalLight, directLight );
 sum+=directLight.color;
 }
 #pragma unroll_loop_end
 result=vec4(sum,1.);}`};patchWorldEnvironmentMaterial(shader,{},false);
 return{name:`${runtime.name}-${lights}dir-numeric`,lights,fragment:'#version 300 es\nprecision highp float;precision highp int;\n#define varying in\n#define texture2D texture\nout vec4 result;\n'+preprocess(runtime,shader.fragmentShader.replace('varying vec3 cfEnvironmentPoint;','const vec3 cfEnvironmentPoint=vec3(0.);'),lights,false)};
}

/** Production sky functions, numeric rays only. No world, image or clock/save
 * injection. The caller's existing single coordinated GPU window owns this. */
function celestial(runtime:Runtime){
 const at=(absoluteWorldMinute:number)=>({absoluteWorldMinute,fractionalMinute:0,dayIndex:Math.floor(absoluteWorldMinute/1440),dayMinute:absoluteWorldMinute%1440,elapsedWorldMinutes:absoluteWorldMinute,deferredMilliseconds:0});
 const gibbous=sampleWorldEnvironment(at(0),'gpu-celestial',{weather:'clear'}),moonless=sampleWorldEnvironment(at(18*1440),'gpu-celestial',{weather:'clear'}),dawn=sampleWorldEnvironment(at(360),'gpu-celestial',{weather:'clear'});
 const twilight=sampleWorldEnvironment(at(1080),'gpu-celestial',{weather:'clear'}),day=sampleWorldEnvironment(at(1020),'gpu-celestial',{weather:'clear'}),below=sampleWorldEnvironment(at(720),'gpu-celestial',{weather:'clear'});
 const moon=new desktop.Vector3().fromArray(gibbous.celestial.moonDirection),sun=new desktop.Vector3().fromArray(gibbous.sunDirection),east=new desktop.Vector3().crossVectors(new desktop.Vector3(0,1,0),moon).normalize(),north=new desktop.Vector3().crossVectors(moon,east);
 const projected=new desktop.Vector2(sun.dot(east),sun.dot(north)).normalize();
 const ray=(sign:number)=>moon.clone().addScaledVector(east,projected.x*.9*.0125*sign).addScaledVector(north,projected.y*.9*.0125*sign).normalize().toArray();
 const galaxy=new desktop.Vector3(.0548756,.8734371,.4838350).normalize().toArray();
 const probe=(name:string,state:typeof gibbous,direction:number[],mode:number,coverage=0,night=state.celestial.nightVisibility,visibility=state.celestial.moonVisibility,celestialGain=1)=>({name,direction,mode,coverage,night,celestialGain,sun:[...state.sunDirection],moon:[...state.celestial.moonDirection],illumination:state.celestial.moonIllumination,visibility,washout:state.celestial.moonWashout,daylight:state.daylight,zenith:[...state.skyZenith],horizon:[...state.skyHorizon],sunColour:[...state.sunColour]});
 return{name:runtime.name+'-production-celestial',steps:runtime.name==='native'?4:32,
  // Numeric isolation only: disable the celestial layer before the unchanged
  // production cloud compositing, without disabling the moon's cloud lighting.
  fragment:'#version 300 es\n'+runtime.precision+'\nuniform float probeCelestialGain;\n'+worldSkyShader(runtime.name==='native'?4:32).replace('sky+=cfCelestialSky(ray);','sky+=probeCelestialGain*cfCelestialSky(ray);')+'\nuniform vec3 probeDirection;uniform int probeMode;out vec4 result;\nvoid main(){vec3 ray=normalize(probeDirection);if(probeMode==2)result=cfMoonBody(ray);else result=vec4(probeMode==1?cfCelestialSky(ray):cfSky(ray),1.);}',
  probes:[probe('gibbous-lit',gibbous,ray(1),2),probe('gibbous-dark',gibbous,ray(-1),2),probe('moonless-band',moonless,galaxy,1),probe('gibbous-washout',gibbous,galaxy,1),probe('clear-full',moonless,galaxy,0),probe('clear-no-astro',moonless,galaxy,0,0,0),probe('overcast-full',moonless,galaxy,0,1),probe('overcast-no-astro',moonless,galaxy,0,1,0),probe('sunrise',dawn,[...dawn.sunDirection],0,.22),
   probe('twilight-moon',twilight,[...twilight.celestial.moonDirection],1),probe('twilight-no-moon',twilight,[...twilight.celestial.moonDirection],1,0,0,0),
   probe('twilight-away',twilight,galaxy,1),probe('day-away',day,galaxy,1),probe('day-moon',day,[...day.celestial.moonDirection],1),probe('below-horizon-moon',below,[...below.celestial.moonDirection],1),
   probe('twilight-clear',twilight,[...twilight.celestial.moonDirection],0),probe('twilight-clear-no-moon',twilight,[...twilight.celestial.moonDirection],0,0,0,twilight.celestial.moonVisibility,0),
   probe('twilight-overcast',twilight,[...twilight.celestial.moonDirection],0,1),probe('twilight-overcast-no-moon',twilight,[...twilight.celestial.moonDirection],0,1,0,twilight.celestial.moonVisibility,0)]};
}

test('installed r185 unrolling retains a separate cloud-light temporary per directional light in both runtimes',()=>{
 assert.equal(WORLD_ENVIRONMENT_SHADER_VERSION,'queued-world-environment-v8');
 for(const runtime of runtimes)for(const lights of [0,1,2,3]){
  const current=pbr(runtime,lights),fragment=current.fragment;
  assert.equal((fragment.match(/vec3 cfDirectionalWorld=/g)??[]).length,lights);
  assert.equal((fragment.match(/\{\s*vec3 cfDirectionalWorld=[\s\S]*?cfCloudSunGain\(cfCloudWorldPoint\(cfEnvironmentPoint\)\);\s*\}/g)??[]).length,lights);
  assert.doesNotMatch(fragment,/#pragma unroll_loop_start|UNROLLED_LOOP_INDEX/);
 }
 for(const path of ['main game','main-game-vr'])assert.match(readFileSync(new URL(path+'/src/legacy/aethelgard/world-environment.ts',root),'utf8'),/customProgramCacheKey=.*WORLD_ENVIRONMENT_SHADER_VERSION/);
});

test('both installed-runtime PBR fixtures retain the recorded54-knot uniform profile before the optional GPU gate',()=>{
 for(const runtime of runtimes){const prepared=pbr(runtime,2,true,'bank',false,false,true),profile=prepared.bankProfile!;
  assert.equal(profile.knots,54);assert.equal(profile.packed.length,164);assert.equal(profile.vectors,76);assert.equal(profile.stages.length,4);assert.equal(profile.exposure.length,128);assert.equal(profile.signature,bankStageDiagnosticSignature(Float32Array.from(profile.packed)));
  assert.match(prepared.fragment,/#define CROWNFALL_BANK_AUTHORED_KNOT_COUNT 54\b/);assert.match(prepared.fragment,/uniform vec4 uEaldholtValleyBankKnots\[41\]/);assert.match(prepared.fragment,/uniform vec4 uEaldholtValleyBank\[32\]/);assert.match(prepared.fragment,/uniform vec2 uEaldholtValleyWaterStages\[2\]/);assert.doesNotMatch(prepared.fragment,/#pragma unroll_loop_start|UNROLLED_LOOP_INDEX/);
 }
});

test('production celestial GPU fixtures retain calendar phases, cloud occlusion pairs and Native cloud budget before the opt-in gate',()=>{
 for(const runtime of runtimes){const sky=celestial(runtime);assert.equal(sky.probes.length,19);assert.equal(sky.steps,runtime.name==='native'?4:32);assert.match(sky.fragment,/uniform vec2 cfStarRotation/);assert.match(sky.fragment,/normal=east\*q.x\+north\*q.y-cfWorldMoon\*z/);assert.match(sky.fragment,/colour\+sky\*transmission/);assert.ok(sky.probes[0].illumination>.75);assert.ok(sky.probes[2].illumination<.01);assert.equal(sky.probes[2].washout,0);assert.equal(sky.probes[6].coverage,1);assert.equal(sky.probes[7].night,0);
  const probes=Object.fromEntries(sky.probes.map(probe=>[probe.name,probe]));
  assert.equal(probes['twilight-moon'].night,0);assert.ok(probes['twilight-moon'].moon[1]>.5&&probes['twilight-moon'].illumination>.85);
  assert.equal(probes['day-away'].daylight,1);assert.equal(probes['day-away'].night,0);assert.equal(probes['below-horizon-moon'].visibility,0);
 }
});

test('actual r185 unrolled High weather programs compile and only sunlight changes under local clouds',{
 skip:process.env.CROWNFALL_VERIFY_DIRECTIONAL_CLOUD_GPU!=='1'&&'Set CROWNFALL_VERIFY_DIRECTIONAL_CLOUD_GPU=1 only in a coordinated idle GPU window.',timeout:60_000,
},async()=>{
 const programs=runtimes.flatMap(runtime=>[...[0,1,2,3].map(n=>pbr(runtime,n)),pbr(runtime,2,true,'wind'),...[false,true].flatMap(first=>['bank','water','gi'].map(kind=>pbr(runtime,2,true,kind,first))),pbr(runtime,2,false,'plain',false,true),pbr(runtime,2,true,'bank',false,false,true)]);
 const numbers=runtimes.flatMap(runtime=>[0,1,2,3].map(n=>numeric(runtime,n)));
 const skies=runtimes.map(celestial);
 const browser=await chromium.launch({headless:true,executablePath:process.env.CROWNFALL_CHROMIUM_PATH??'/usr/bin/chromium',args:['--disable-dev-shm-usage','--enable-unsafe-swiftshader']});
 try{const page=await browser.newPage();await page.evaluate('globalThis.__name=(fn)=>fn');const result=await page.evaluate(({programs,numbers,skies})=>{
  const canvas=document.createElement('canvas');canvas.width=canvas.height=1;const gl=canvas.getContext('webgl2',{antialias:false});if(!gl)throw Error('WebGL2 required.');
  function compile(type:number,source:string){const shader=gl!.createShader(type)!;gl!.shaderSource(shader,source);gl!.compileShader(shader);return{shader,ok:gl!.getShaderParameter(shader,gl!.COMPILE_STATUS)===true,log:gl!.getShaderInfoLog(shader)??''};}
  function link(vertex:string,fragment:string){const v=compile(gl!.VERTEX_SHADER,vertex),f=compile(gl!.FRAGMENT_SHADER,fragment),program=gl!.createProgram()!;gl!.attachShader(program,v.shader);gl!.attachShader(program,f.shader);gl!.linkProgram(program);const linked=gl!.getProgramParameter(program,gl!.LINK_STATUS)===true,log=[v.log,f.log,gl!.getProgramInfoLog(program)??''].filter(Boolean).join('\n');gl!.deleteShader(v.shader);gl!.deleteShader(f.shader);return{program,linked,log};}
  const signature=(data:Float32Array)=>{let hash=2166136261;for(const byte of new Uint8Array(data.buffer,data.byteOffset,data.byteLength))hash=Math.imul(hash^byte,16777619);return(hash>>>0).toString(16).padStart(8,'0');};
  const rows=programs.map(entry=>{const p=link(entry.vertex,entry.fragment);let bank:null|{knots:number;packedVectors:number;expectedPackedVectors:number;floatCount:number;signature:string;expectedSignature:string;packedMatches:boolean;stageCount:number;stagesMatch:boolean;vectors:number;activeUniformVectorsUpperBound:number;maximumFragmentUniformVectors:number;samplers:number;maximumSamplers:number}=null;
   if(entry.bankProfile){if(!p.linked)throw Error(entry.name+': '+p.log);const expected=entry.bankProfile;let packedVectors=0,stages=0,samplers=0,activeUniformVectorsUpperBound=0;
    for(let i=0;i<gl.getProgramParameter(p.program,gl.ACTIVE_UNIFORMS);i++){const u=gl.getActiveUniform(p.program,i)!;if(u.name==='uEaldholtValleyBankKnots[0]')packedVectors=u.size;if(u.name==='uEaldholtValleyWaterStages[0]')stages=u.size;
     const columns=u.type===gl.FLOAT_MAT4?4:u.type===gl.FLOAT_MAT3?3:u.type===gl.FLOAT_MAT2?2:1;activeUniformVectorsUpperBound+=columns*u.size;
     if(([gl.SAMPLER_2D,gl.SAMPLER_3D,gl.SAMPLER_CUBE,gl.SAMPLER_2D_SHADOW]as readonly number[]).includes(u.type))samplers+=u.size;
    }
    gl.useProgram(p.program);gl.uniform4fv(gl.getUniformLocation(p.program,'uEaldholtValleyBankKnots[0]'),Float32Array.from(expected.packed));gl.uniform4fv(gl.getUniformLocation(p.program,'uEaldholtValleyBank[0]'),Float32Array.from(expected.exposure));gl.uniform2fv(gl.getUniformLocation(p.program,'uEaldholtValleyWaterStages[0]'),Float32Array.from(expected.stages));
    const read=new Float32Array(packedVectors*4);for(let i=0;i<packedVectors;i++){const value=gl.getUniform(p.program,gl.getUniformLocation(p.program,`uEaldholtValleyBankKnots[${i}]`)!);if(!(value instanceof Float32Array)||value.length!==4)throw Error('Packed source banks require one vec4 per uniform read.');read.set(value,i*4);}
    const stageRead=new Float32Array(stages*2);for(let i=0;i<stages;i++){const value=gl.getUniform(p.program,gl.getUniformLocation(p.program,`uEaldholtValleyWaterStages[${i}]`)!);if(!(value instanceof Float32Array)||value.length!==2)throw Error('Source stages require one vec2 per uniform read.');stageRead.set(value,i*2);}
    bank={knots:expected.knots,packedVectors,expectedPackedVectors:expected.packed.length/4,floatCount:read.length,signature:signature(read),expectedSignature:expected.signature,packedMatches:Array.from(read).every((v,i)=>v===expected.packed[i]),stageCount:stages,stagesMatch:Array.from(stageRead).every((v,i)=>v===expected.stages[i]),vectors:expected.vectors,activeUniformVectorsUpperBound,maximumFragmentUniformVectors:gl.getParameter(gl.MAX_FRAGMENT_UNIFORM_VECTORS),samplers,maximumSamplers:gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS)};
   }
   gl.useProgram(null);gl.deleteProgram(p.program);return{name:entry.name,legacy:entry.legacy,linked:p.linked,log:p.log,bank};});
  if(!gl.getExtension('EXT_color_buffer_float'))throw Error('Float attachment required for scalar proof.');
  const vao=gl.createVertexArray(),texture=gl.createTexture(),fbo=gl.createFramebuffer();gl.bindVertexArray(vao);gl.bindTexture(gl.TEXTURE_2D,texture);gl.texStorage2D(gl.TEXTURE_2D,1,gl.RGBA32F,1,1);gl.bindFramebuffer(gl.FRAMEBUFFER,fbo);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,texture,0);if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw Error('Numeric attachment incomplete.');
  const cloud=gl.createTexture();gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_3D,cloud);gl.texImage3D(gl.TEXTURE_3D,0,gl.RG8,1,1,1,0,gl.RG,gl.UNSIGNED_BYTE,new Uint8Array([255,0]));gl.texParameteri(gl.TEXTURE_3D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_3D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);gl.viewport(0,0,1,1);gl.disable(gl.DITHER);
  const vertex='#version 300 es\nvoid main(){vec2 p=vec2(float((gl_VertexID<<1)&2),float(gl_VertexID&2));gl_Position=vec4(p*2.-1.,0.,1.);}';
  const identity=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
  const samples=numbers.map(entry=>{const p=link(vertex,entry.fragment);if(!p.linked)throw Error(entry.name+': '+p.log);gl.useProgram(p.program);const loc=(name:string)=>gl.getUniformLocation(p.program,name);gl.uniformMatrix4fv(loc('viewMatrix'),false,identity);gl.uniformMatrix4fv(loc('cfCloudSourceToWorld'),false,identity);gl.uniform3f(loc('cfWorldSun'),0,1,0);gl.uniform1f(loc('cfSurfaceWeatherEnabled'),1);gl.uniform1f(loc('cfCloudCoverage'),1);gl.uniform1f(loc('cfCloudGlobalTransmission'),.5);gl.uniform1i(loc('cfCloudDensity'),0);
   const directions=[[0,1,0],[0,-1,0],[1,0,0]],colours=[[1,0,0],[0,0,2],[0,3,0]];for(let i=0;i<entry.lights;i++){gl.uniform3fv(loc(`directionalLights[${i}].direction`),directions[i]);gl.uniform3fv(loc(`directionalLights[${i}].color`),colours[i]);}
   const read=(enabled:number)=>{gl.uniform1f(loc('cfCloudLightingEnabled'),enabled);gl.drawArrays(gl.TRIANGLES,0,3);const value=new Float32Array(4);gl.readPixels(0,0,1,1,gl.RGBA,gl.FLOAT,value);return Array.from(value);};const clear=read(0),clouded=read(1);gl.deleteProgram(p.program);return{name:entry.name,lights:entry.lights,clear,clouded};});
  const celestialSamples=skies.map(entry=>{const p=link(vertex,entry.fragment);if(!p.linked)throw Error(entry.name+': '+p.log);gl.useProgram(p.program);const loc=(name:string)=>gl.getUniformLocation(p.program,name);gl.uniformMatrix4fv(loc('cfCloudSourceToWorld'),false,identity);gl.uniform1i(loc('cfCloudDensity'),0);gl.uniform2f(loc('cfCloudOffset'),0,0);gl.uniform3f(loc('cfCloudEye'),0,0,0);gl.uniform2f(loc('cfStarRotation'),1,0);gl.uniform1f(loc('cfRain'),0);
   const probes=entry.probes.map(probe=>{gl.uniform3fv(loc('probeDirection'),probe.direction);gl.uniform1i(loc('probeMode'),probe.mode);gl.uniform3fv(loc('cfWorldSun'),probe.sun);gl.uniform3fv(loc('cfWorldMoon'),probe.moon);gl.uniform1f(loc('cfMoonIllumination'),probe.illumination);gl.uniform1f(loc('cfMoonVisibility'),probe.visibility);gl.uniform1f(loc('probeCelestialGain'),probe.celestialGain);gl.uniform1f(loc('cfMoonWashout'),probe.washout);gl.uniform1f(loc('cfNightVisibility'),probe.night);gl.uniform1f(loc('cfDaylight'),probe.daylight);gl.uniform1f(loc('cfCloudCoverage'),probe.coverage);gl.uniform3fv(loc('cfSkyZenith'),probe.zenith);gl.uniform3fv(loc('cfSkyHorizon'),probe.horizon);gl.uniform3fv(loc('cfSunColour'),probe.sunColour);gl.drawArrays(gl.TRIANGLES,0,3);const pixel=new Float32Array(4);gl.readPixels(0,0,1,1,gl.RGBA,gl.FLOAT,pixel);return{name:probe.name,pixel:Array.from(pixel)};});gl.deleteProgram(p.program);return{name:entry.name,steps:entry.steps,linked:p.linked,probes};});
  gl.useProgram(null);gl.deleteTexture(cloud);gl.deleteFramebuffer(fbo);gl.deleteTexture(texture);gl.deleteVertexArray(vao);const error=gl.getError();gl.getExtension('WEBGL_lose_context')?.loseContext();return{rows,samples,celestialSamples,error};
 },{programs,numbers,skies});
  console.log(JSON.stringify({scope:'Actual installed Desktop/IWSDK r185 chunk expansion and renderer loop-unrolling; real WebGL2 compile/link plus 1x1 numeric readback. No world, scene picture, hardware or visual acceptance.',programVersion:WORLD_ENVIRONMENT_SHADER_VERSION,celestialVersion:WORLD_CELESTIAL_SHADER_VERSION,runtimes:runtimes.map(r=>({name:r.name,rendererSha256:r.rendererSha256})),...result}));
  assert.equal(result.error,0);for(const row of result.rows){if(row.legacy){assert.equal(row.linked,false,row.name);assert.match(row.log,/cfDirectionalWorld.*redefinition/,row.name);}else assert.equal(row.linked,true,row.name+': '+row.log);}
  const banks=result.rows.filter(row=>row.bank);assert.equal(banks.length,2);for(const row of banks){const bank=row.bank!;assert.equal(bank.knots,54);assert.equal(bank.packedVectors,41);assert.equal(bank.expectedPackedVectors,41);assert.equal(bank.floatCount,164);assert.equal(bank.signature,bank.expectedSignature);assert.ok(bank.packedMatches);assert.equal(bank.stageCount,2);assert.ok(bank.stagesMatch);assert.equal(bank.vectors,76);assert.ok(bank.activeUniformVectorsUpperBound<=Math.min(224,bank.maximumFragmentUniformVectors));assert.ok(bank.samplers<=Math.min(16,bank.maximumSamplers));}
  const gain=(.35+.65*Math.exp(-1.24*620*.009))/.5;
  for(const sample of result.samples){const expected=[.125+(sample.lights?1:0),.25+(sample.lights>2?3:0),.375+(sample.lights>1?2:0),1];for(let i=0;i<4;i++)assert.ok(Math.abs(sample.clear[i]-expected[i])<1e-6,sample.name+' clear'+i);assert.ok(Math.abs(sample.clouded[0]-(.125+(sample.lights?gain:0)))<2e-6,sample.name+' sun');for(let i=1;i<4;i++)assert.equal(sample.clouded[i],sample.clear[i],sample.name+' moon/off-axis/fire unchanged');}
  for(const sky of result.celestialSamples){assert.equal(sky.linked,true);assert.equal(sky.probes.length,19);const pixels=Object.fromEntries(sky.probes.map(probe=>[probe.name,probe.pixel]));for(const pixel of Object.values(pixels))assert.ok(pixel.every(value=>Number.isFinite(value)&&value>=0));const energy=(name:string)=>pixels[name].slice(0,3).reduce((n,v)=>n+v,0);assert.ok(energy('gibbous-lit')>energy('gibbous-dark')*10);assert.ok(pixels['gibbous-lit'][3]>.9&&pixels['gibbous-dark'][3]>.9);assert.ok(energy('moonless-band')>1e-5);assert.ok(energy('moonless-band')>energy('gibbous-washout')*1.2);const clear=energy('clear-full')-energy('clear-no-astro'),overcast=energy('overcast-full')-energy('overcast-no-astro');assert.ok(clear>1e-5);assert.ok(Math.abs(overcast)<clear*.02+1e-6,'Opaque production clouds must occlude celestial radiance.');assert.ok(pixels.sunrise[0]>pixels.sunrise[2],'The existing east dawn remains warm.');
   assert.ok(energy('twilight-moon')>.1,'An above-horizon gibbous moon stays visible before stars emerge.');
   assert.equal(energy('twilight-no-moon'),0);assert.equal(energy('twilight-away'),0);assert.equal(energy('day-away'),0,'Daytime stars and Milky Way remain hidden.');
   assert.ok(energy('day-moon')>.1,'The moon disc is independent of the star visibility gate.');assert.equal(energy('below-horizon-moon'),0);
   const moonClear=energy('twilight-clear')-energy('twilight-clear-no-moon'),moonCloud=energy('twilight-overcast')-energy('twilight-overcast-no-moon');
   assert.ok(moonClear>.1);assert.ok(Math.abs(moonCloud)<moonClear*.02+1e-6,'Production clouds still occlude the twilight moon disc.');
  }
 }finally{await browser.close();console.log('Directional cloud GPU browser CLOSED.');}
});
