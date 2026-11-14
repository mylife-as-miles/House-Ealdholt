import test from'node:test';import assert from'node:assert/strict';import{chromium}from'playwright';
import{ShaderChunk,ShaderLib}from'three';
import{createEaldholtBankExposureSections,patchEaldholtWoodlandValleySurface}from'../../../../shared/legacy/aethelgard/environment/woodland-ground';
import{patchRegionalForestFloor}from'../../../../shared/legacy/aethelgard/environment/regional-forest-floor';
import{patchWorldEnvironmentMaterial}from'../../../../shared/legacy/aethelgard/environment/environment-material-shader';
import{createHash}from'node:crypto';import{readFileSync}from'node:fs';import{execFileSync}from'node:child_process';

function expand(code:string):string{return code.replace(/#include <([\w_]+)>/g,(_all,name:string)=>{const value=(ShaderChunk as Record<string,string>)[name];assert.equal(typeof value,'string',name);return expand(value);});}
function bankProgram(piecewise:boolean,floor:boolean,weather:boolean,weatherBeforeFloor=false){
 const samples=piecewise?[-30,-5,5,.3,-10,-4,6,.31,10,-6,4,.8,30,-5,5,.7]:[-30,-5,5,.3,-10,-4,6,.5,10,-6,4,.7,30,-5,5,.9];
 const sections=createEaldholtBankExposureSections(samples,64),shader={uniforms:{},vertexShader:ShaderLib.standard.vertexShader,fragmentShader:ShaderLib.standard.fragmentShader};
 patchEaldholtWoodlandValleySurface(shader,.06,'attribute',{waterHeight:.3,earthNormal:{},earthOrm:{},rock:{albedo:{},normal:{},meanLuminance:.1},woodland:{bank:{tileMetres:1.3,targetLuminance:.06},meadow:{albedo:{},normal:{},meanLuminance:.07,targetLuminance:.07,tileMetres:2},sections}});
 if(weather&&weatherBeforeFloor)patchWorldEnvironmentMaterial(shader,{},false,false,ShaderChunk.lights_fragment_begin);
 if(floor)patchRegionalForestFloor(shader,{});
 if(weather&&!weatherBeforeFloor)patchWorldEnvironmentMaterial(shader,{},false,false,ShaderChunk.lights_fragment_begin);
 const vertex=expand(shader.vertexShader),fragment=expand(shader.fragmentShader),counts=[...new Set((vertex+'\n'+fragment).match(/\b(?:NUM_[A-Z_0-9]+|UNION_CLIPPING_PLANES)\b/g)??[])].map(name=>`#define ${name} ${name==='NUM_DIR_LIGHTS'||name==='NUM_HEMI_LIGHTS'?1:0}`).join('\n');
 const flags='#define USE_MAP\n#define MAP_UV uv\n#define USE_NORMALMAP\n#define USE_NORMALMAP_TANGENTSPACE\n#define NORMALMAP_UV uv\n#define USE_AOMAP\n#define AOMAP_UV uv\n#define USE_COLOR\n#define USE_FOG\n';
 const common=`#version 300 es\nprecision highp float;precision highp int;\n${counts}\n${flags}\nuniform mat4 viewMatrix;uniform vec3 cameraPosition;uniform bool isOrthographic;\n`;
 return{name:`bank-${piecewise?'changing':'affine'}-floor${Number(floor)}-weather${Number(weather)}${weatherBeforeFloor?'-weather-before-floor':''}`,stageKnots:sections.waterStages.count,sourceStages:Array.from(sections.waterStages.data),
  vertex:common+'#define attribute in\n#define varying out\n#define texture2D texture\nuniform mat4 modelMatrix;uniform mat4 modelViewMatrix;uniform mat4 projectionMatrix;uniform mat3 normalMatrix;\nin vec3 position;in vec3 normal;in vec2 uv;in vec3 color;\n'+vertex,
  fragment:common+'#define varying in\n#define texture2D texture\n#define textureCube texture\n#define gl_FragColor result\nout vec4 result;vec4 linearToOutputTexel(vec4 value){return value;}\n'+fragment};
}

// Full actual r185 PBR chunks + actual bank builder, late litter hook and
// actual land-weather hook. Link only: no world, picture, runtime frame or
// Native SDK/hardware/performance claim. Run only with an idle browser slot.
test('actual bank PBR programs link with local stages, late forest floor and weather',{
 skip:process.env.CROWNFALL_VERIFY_BANK_GPU!=='1'&&'Set CROWNFALL_VERIFY_BANK_GPU=1 on an idle browser-capable worker.',timeout:60_000,
},async()=>{
 const programs=[bankProgram(false,false,false),bankProgram(false,true,true),bankProgram(true,true,true),bankProgram(true,true,true,true)];
 const pin=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),sourceHash=createHash('sha256').update(readFileSync(new URL('../../../../shared/legacy/aethelgard/environment/woodland-ground.ts',import.meta.url))).digest('hex');
 const browser=await chromium.launch({headless:true,executablePath:process.env.CROWNFALL_CHROMIUM_PATH??'/usr/bin/chromium',args:['--disable-dev-shm-usage','--enable-unsafe-swiftshader']});
 try{const page=await browser.newPage();await page.evaluate('globalThis.__name=(fn)=>fn');
  const result=await page.evaluate((programs)=>{
   const canvas=document.createElement('canvas');canvas.width=canvas.height=1;const gl=canvas.getContext('webgl2',{antialias:false});if(!gl)throw Error('WebGL2 is unavailable.');
   const compile=(type:number,code:string)=>{const shader=gl.createShader(type)!;gl.shaderSource(shader,code);gl.compileShader(shader);if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(shader)??'Bank shader compile failed.');return shader;};
   const rows=programs.map(entry=>{const vertex=compile(gl.VERTEX_SHADER,entry.vertex),fragment=compile(gl.FRAGMENT_SHADER,entry.fragment),program=gl.createProgram()!;gl.attachShader(program,vertex);gl.attachShader(program,fragment);gl.linkProgram(program);const linked=gl.getProgramParameter(program,gl.LINK_STATUS)===true,log=gl.getProgramInfoLog(program);if(!linked)throw Error(entry.name+': '+log);
    let stages=0,samplers=0;for(let i=0;i<gl.getProgramParameter(program,gl.ACTIVE_UNIFORMS);i++){const uniform=gl.getActiveUniform(program,i)!;if(uniform.name==='uEaldholtValleyWaterStages[0]')stages=uniform.size;if(([gl.SAMPLER_2D,gl.SAMPLER_3D,gl.SAMPLER_CUBE] as readonly number[]).includes(uniform.type))samplers+=uniform.size;}
    gl.useProgram(program);gl.uniform2fv(gl.getUniformLocation(program,'uEaldholtValleyWaterStages[0]'),Float32Array.from(entry.sourceStages));const read=new Float32Array(stages*2),uniformReadLengths:number[]=[];
    for(let i=0;i<stages;i++){const value=gl.getUniform(program,gl.getUniformLocation(program,`uEaldholtValleyWaterStages[${i}]`)!);uniformReadLengths.push(value?.length??0);if(!(value instanceof Float32Array)||value.length!==2)throw Error('Actual WebGL stage array does not return one vec2 element.');read.set(value,i*2);}
    const stageValuesMatchSource=Array.from(read).every((v,i)=>v===entry.sourceStages[i]);gl.useProgram(null);gl.deleteProgram(program);gl.deleteShader(vertex);gl.deleteShader(fragment);return{name:entry.name,linked,stageKnots:stages,expectedStageKnots:entry.stageKnots,stageValuesMatchSource,uniformReadLengths,samplers};});
   const error=gl.getError(),maximumSamplers=gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS);gl.getExtension('WEBGL_lose_context')?.loseContext();return{rows,error,maximumSamplers,renderCalls:0,worldActivated:false,screenshotTaken:false};
  },programs);
  console.log(JSON.stringify({sourcePin:pin,sourceSha256:sourceHash,scope:'Actual Desktop r185 PBR compile/link and source-stage uniform transport only; no source geometry, world, pixels or Native SDK/device claim.',...result}));assert.equal(result.error,0);assert.equal(result.rows.length,4);for(const row of result.rows){assert.ok(row.linked);assert.equal(row.stageKnots,row.expectedStageKnots);assert.ok(row.stageValuesMatchSource);assert.ok(row.uniformReadLengths.every(n=>n===2));assert.ok(row.samplers<=Math.min(16,result.maximumSamplers));}
 }finally{await browser.close();console.log('Bank PBR GPU browser CLOSED.');}
});
