import assert from 'node:assert/strict';
import test from 'node:test';
import {chromium} from 'playwright';
import {Matrix4, ShaderChunk, ShaderLib} from 'three';
import {patchEaldholtWaterShoreColor, EALDHOLT_WATER_SHORE_LOOK as LOOK} from '../../../../shared/legacy/aethelgard/environment/water-shore-color';
import {patchEaldholtWaterRipples} from '../../../../shared/legacy/aethelgard/environment/water-ripples';
import {patchEaldholtRiverFlow} from '../../../../shared/legacy/aethelgard/environment/river-flow-shader';
import {patchWorldEnvironmentMaterial} from '../../../../shared/legacy/aethelgard/environment/environment-material-shader';
import {riverHeight,derivative as heightDerivative} from '../../../../shared/legacy/tests/fixtures/river-broad-reference';
import {patchEaldholtRiverFlowV6} from '../../../../shared/legacy/tests/fixtures/river-flow-v6-reference';

function expand(code:string):string {
 return code.replace(/#include <([\w_]+)>/g,(_all,name:string)=>{
  const chunk=(ShaderChunk as Record<string,string>)[name];assert.equal(typeof chunk,'string',`Known r185 chunk: ${name}`);return expand(chunk);
 });
}
function zeroCounts(code:string):string {
 return [...new Set(code.match(/\b(?:NUM_[A-Z_0-9]+|UNION_CLIPPING_PLANES)\b/g)??[])].map(name=>`#define ${name} 0`).join('\n');
}
function physicalProgram(regional:boolean,weather:boolean,weatherFirst=false) {
 const shader={uniforms:{},vertexShader:ShaderLib.standard.vertexShader,fragmentShader:ShaderLib.standard.fragmentShader};
 patchEaldholtWaterRipples(shader,{time:{value:0},metresPerWorldUnit:{value:1},worldToSource:{value:new Matrix4()},sourceToWorldRotation:{value:new Matrix4()}});
 if(weather&&weatherFirst)patchWorldEnvironmentMaterial(shader,{},false,true,ShaderChunk.lights_fragment_begin);
 if(regional){patchEaldholtWaterShoreColor(shader);patchEaldholtRiverFlow(shader);}
 if(weather&&!weatherFirst)patchWorldEnvironmentMaterial(shader,{},false,true,ShaderChunk.lights_fragment_begin);
 const vertex=expand(shader.vertexShader),fragment=expand(shader.fragmentShader);
 const shared=`#version 300 es\nprecision highp float;precision highp int;\n#define PHYSICAL\n${zeroCounts(vertex+'\n'+fragment)}\nuniform mat4 viewMatrix;uniform vec3 cameraPosition;uniform bool isOrthographic;\n`;
 return {name:`${regional?'regional':'pond'}-${weather?'weather':'plain'}${weatherFirst?'-weather-first':''}`,
  vertex:shared+`#define attribute in\n#define varying out\n#define texture2D texture\nuniform mat4 modelMatrix;uniform mat4 modelViewMatrix;uniform mat4 projectionMatrix;uniform mat3 normalMatrix;\nin vec3 position;in vec3 normal;in vec2 uv;\n${vertex}`,
  fragment:shared+`#define varying in\n#define texture2D texture\n#define textureCube texture\n#define gl_FragColor result\nout vec4 result;vec4 linearToOutputTexel(vec4 value){return value;}\n${fragment}`};
}

// Opt-in scalar buffer checks and real r185 PBR compile/link only. No world,
// synthetic scene, screenshot or claim of visual/hardware acceptance is made.
test('real regional water shader blends wet contact without changing open water, pond Fresnel or geometry',{
 skip:process.env.CROWNFALL_VERIFY_WATER_GPU!=='1'&&'Set CROWNFALL_VERIFY_WATER_GPU=1 on an idle browser-capable worker.',timeout:60_000,
},async()=>{
 const scaffold=()=>({uniforms:{},vertexShader:'#include <common>\n#include <begin_vertex>',fragmentShader:`#include <common>
uniform vec3 baseColor;uniform float baseRoughness;uniform float testFresnel;uniform float testStep;
void main(){vEaldholtWaterShore=vec2(testShore.x+testStep*(gl_FragCoord.x-.5),testShore.y);
vec4 diffuseColor=vec4(baseColor,1.);
#include <color_fragment>
float roughnessFactor=baseRoughness;
#include <roughnessmap_fragment>
#include <lights_physical_fragment>
float cfFresnel=testFresnel;
TEST_SKY_MIX
result=vec4(diffuseColor.rgb,roughnessFactor);if(mode==1)result=vec4(ealdholtShoreContact,cfWaterSkyMix,ealdholtContactWidth,1.);
}`});
 const weather={uniforms:{},vertexShader:ShaderLib.standard.vertexShader,fragmentShader:ShaderLib.standard.fragmentShader};
 patchWorldEnvironmentMaterial(weather,{},false,true,ShaderChunk.lights_fragment_begin);
 const mixCode=weather.fragmentShader.match(/float cfWaterSkyMix=[\s\S]*?(?=reflectedLight\.indirectSpecular=mix)/)?.[0];assert.ok(mixCode);
 const numeric=[false,true].map(weatherFirst=>{
  const shader=scaffold();
  if(weatherFirst)patchWorldEnvironmentMaterial(shader,{},false,true);
  patchEaldholtWaterShoreColor(shader);
  if(!weatherFirst)patchWorldEnvironmentMaterial(shader,{},false,true);
  // Keep the actual patch declarations and both the actual weather roughness
  // insertion and final shore floor. Only unrelated sky/cloud helpers are left
  // out of this scalar fragment; their full PBR program compiles above.
  const preamble=shader.fragmentShader.split('\n').filter(line=>/^#define CROWNFALL_COASTAL_WATER_SHORE_COLOR|^uniform vec3 uEaldholt|^varying vec2 vEaldholtWaterShore;/.test(line)).join('\n');
  const body=shader.fragmentShader.slice(shader.fragmentShader.indexOf('uniform vec3 baseColor;'));
  return {name:weatherFirst?'weather-first':'shore-first',fragment:`#version 300 es\nprecision highp float;uniform float cfRain;uniform vec2 testShore;uniform int mode;out vec4 result;\n`+(preamble+'\n'+body)
   .replace('varying vec2 vEaldholtWaterShore;','vec2 vEaldholtWaterShore;')
   .replace('#include <color_fragment>','').replace('#include <roughnessmap_fragment>','').replace('#include <lights_physical_fragment>','').replace('TEST_SKY_MIX',mixCode)};
 });
 const programs=[false,true].flatMap(regional=>[false,true].map(weather=>physicalProgram(regional,weather)));
 programs.push(physicalProgram(true,true,true));
 const browser=await chromium.launch({headless:true,executablePath:process.env.CROWNFALL_CHROMIUM_PATH??'/usr/bin/chromium',args:['--disable-dev-shm-usage','--enable-unsafe-swiftshader']});
 try {
  const page=await browser.newPage();await page.evaluate('globalThis.__name=(fn)=>fn');
  const data=await page.evaluate(({programs,numeric,look})=>{
   const canvas=document.createElement('canvas');canvas.width=4;canvas.height=1;
   const gl=canvas.getContext('webgl2',{antialias:false});if(!gl)throw Error('WebGL2 required for water numeric checks.');
   function compile(type:number,code:string){const s=gl!.createShader(type)!;gl!.shaderSource(s,code);gl!.compileShader(s);if(!gl!.getShaderParameter(s,gl!.COMPILE_STATUS))throw Error(gl!.getShaderInfoLog(s)??'Water shader compile failed.');return s;}
   function link(vertex:string,fragment:string){const v=compile(gl!.VERTEX_SHADER,vertex),f=compile(gl!.FRAGMENT_SHADER,fragment),p=gl!.createProgram()!;gl!.attachShader(p,v);gl!.attachShader(p,f);gl!.linkProgram(p);if(!gl!.getProgramParameter(p,gl!.LINK_STATUS))throw Error(gl!.getProgramInfoLog(p)??'Water shader link failed.');gl!.deleteShader(v);gl!.deleteShader(f);return p;}
   const compiled=programs.map(entry=>{const p=link(entry.vertex,entry.fragment);gl.deleteProgram(p);return entry.name;});
   if(!gl.getExtension('EXT_color_buffer_float'))throw Error('Float attachment required for numeric water readback.');
   const vertex='#version 300 es\nvoid main(){vec2 p=vec2(float((gl_VertexID<<1)&2),float(gl_VertexID&2));gl_Position=vec4(p*2.-1.,0.,1.);}';
   const vao=gl.createVertexArray(),texture=gl.createTexture(),fbo=gl.createFramebuffer();
   gl.bindTexture(gl.TEXTURE_2D,texture);gl.texStorage2D(gl.TEXTURE_2D,1,gl.RGBA32F,4,1);gl.bindFramebuffer(gl.FRAMEBUFFER,fbo);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,texture,0);
   if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw Error('Water numeric attachment incomplete.');
   gl.viewport(0,0,4,1);gl.bindVertexArray(vao);gl.disable(gl.DITHER);
   const orders=numeric.map(entry=>{
   const program=link(vertex,entry.fragment);gl.useProgram(program);
   const loc=(name:string)=>gl.getUniformLocation(program,name),base=[.012,.028,.048];
   gl.uniform3fv(loc('baseColor'),base);gl.uniform1f(loc('baseRoughness'),.24);
   gl.uniform3fv(loc('uEaldholtShallowLinearColor'),look.shallowLinearColor);gl.uniform3fv(loc('uEaldholtShoreContactLinearColor'),look.contactLinearColor);
   const pixels=new Float32Array(16);
   function sample(distance:number,kind:'channel'|'sea',step=0,fresnel=0,rain=0){
    gl!.uniform2f(loc('testShore'),kind==='sea'?distance:5-distance,kind==='sea'?-1:5);gl!.uniform1f(loc('testStep'),step);gl!.uniform1f(loc('testFresnel'),fresnel);
    gl!.uniform1f(loc('cfRain'),rain);
    const read=(mode:number)=>{gl!.uniform1i(loc('mode'),mode);gl!.drawArrays(gl!.TRIANGLES,0,3);gl!.readPixels(0,0,4,1,gl!.RGBA,gl!.FLOAT,pixels);return Array.from(pixels.slice(0,4));};
    return{distance,kind,step,fresnel,rain,surface:read(0),contact:read(1)};
   }
   const samples=[0,.1,.35,.675,1,1.35,3,5].flatMap(d=>[sample(d,'channel'),sample(d,'sea')]);
   const open=[sample(6,'sea'),sample(100,'sea'),sample(1e6,'sea')],grazing=[sample(0,'sea',0,1),sample(6,'sea',0,1)];
   const filtered=[sample(.675,'sea',2),sample(6,'sea',100)];
   const rain=[sample(0,'channel',0,0,1),sample(0,'sea',0,0,1),sample(6,'sea',0,0,1)];
   gl.uniform1f(loc('baseRoughness'),.8);const rough=sample(0,'sea');
   gl.deleteProgram(program);return{name:entry.name,samples,open,grazing,filtered,rain,rough};
   });
   const error=gl.getError();gl.deleteFramebuffer(fbo);gl.deleteTexture(texture);gl.deleteVertexArray(vao);gl.getExtension('WEBGL_lose_context')?.loseContext();
   return{compiled,orders,error};
  },{programs,numeric,look:LOOK});
  assert.equal(data.error,0);assert.equal(data.compiled.length,5);assert.deepEqual(data.orders.map(row=>row.name),['shore-first','weather-first']);
  for(const group of ['samples','open','grazing','filtered','rain'] as const){
   const first=data.orders[0][group],second=data.orders[1][group];
   for(let i=0;i<first.length;i++)for(const field of ['surface','contact'] as const)for(let k=0;k<4;k++)assert.ok(Math.abs(first[i][field][k]-second[i][field][k])<1e-6,`${group} ${field}: patch orders must have the same actual GPU result`);
  }
  for(const order of data.orders){
  for(let i=0;i<order.samples.length;i+=2){const a=order.samples[i],b=order.samples[i+1];for(let k=0;k<4;k++){assert.ok(Math.abs(a.surface[k]-b.surface[k])<1e-6,'same measured distance gives the same channel/sea response');assert.ok(Math.abs(a.contact[k]-b.contact[k])<1e-6,'equivalent signed channel and sea distances agree within float precision');}}
  const shore=order.samples[0],edgeColor=LOOK.contactLinearColor;
  assert.equal(shore.contact[0],1);assert.equal(shore.contact[1],0,'procedural sky replacement cannot override contact');assert.ok(Math.abs(shore.surface[3]-.62)<1e-6);
  const base=[.012,.028,.048],oldShore=base.map((v,i)=>v*(1-LOOK.strength)+LOOK.shallowLinearColor[i]*LOOK.strength);
  const error=(a:readonly number[],b:readonly number[])=>a.slice(0,3).reduce((n,v,i)=>n+(v-b[i])**2,0);
  assert.ok(error(shore.surface,edgeColor)<error(oldShore,edgeColor)*.01,'real contact reduces the old blue-to-earth discontinuity');
  for(let i=2;i<order.samples.length;i+=2){assert.ok(order.samples[i].contact[0]<=order.samples[i-2].contact[0]);assert.ok(order.samples[i].surface[3]<=order.samples[i-2].surface[3]+1e-6);}
  for(const row of order.open){assert.ok(error(row.surface,base)<1e-12);assert.equal(row.contact[0],0,'open sea/mouth distances do not create a fake shoreline');assert.ok(Math.abs(row.surface[3]-.24)<1e-6);assert.equal(row.contact[1],.25);}
  assert.equal(order.grazing[0].contact[1],0);assert.ok(Math.abs(order.grazing[1].contact[1]-.7)<1e-6,'unmodified grazing sky Fresnel survives away from the bank');
  assert.ok(order.filtered[0].contact[0]>.5);assert.equal(order.filtered[1].contact[0],0);assert.equal(order.filtered[1].contact[2],6,'coarse pixel filter is bounded');
  assert.ok(Math.abs(order.rough.surface[3]-.8)<1e-6,'never make an already rough surface smoother');
  assert.ok(Math.abs(order.rain[0].surface[3]-.62)<1e-6&&Math.abs(order.rain[1].surface[3]-.62)<1e-6,'full rain cannot lower channel or sea contact below its final roughness floor');
  assert.ok(Math.abs(order.rain[2].surface[3]-.282)<1e-6,'full-rain open water keeps the existing weather roughness response');
  }
  console.log('water-contact-numerics',JSON.stringify({compiled:data.compiled,orders:data.orders.map(row=>({name:row.name,contactColor:row.samples[0].surface.slice(0,3),contactRoughness:row.samples[0].surface[3],rainContactRoughness:row.rain[0].surface[3],rainOpenRoughness:row.rain[2].surface[3],openColor:row.open[0].surface.slice(0,3),bankSkyMix:row.samples[0].contact[1],openGrazingSkyMix:row.grazing[1].contact[1],maxFilterMetres:row.filtered[1].contact[2]})),scope:'Scalar GPU checks and actual r185 shader compilation; no scene, visual score, flow evidence, FPS or physical Quest validation.'}));
 } finally {await browser.close();}
});

test('actual bounded broad shader reduces carrier concentration at comparable slope energy, including paused time',{
 skip:process.env.CROWNFALL_VERIFY_WATER_GPU!=='1'&&'Set CROWNFALL_VERIFY_WATER_GPU=1 on an idle browser-capable worker.',timeout:90_000,
},async()=>{
 const variants=[['frozen-v6',patchEaldholtRiverFlowV6],['bounded-v7',patchEaldholtRiverFlow]]as const;
 const programs=variants.map(([name,patch])=>{
  const shader={uniforms:{},vertexShader:'#include <common>\n#include <begin_vertex>',fragmentShader:`#include <common>
uniform float sampleTime;uniform int sampleLayer;
void main(){vec2 p=vec2(-32.+(gl_FragCoord.x-.5)*.125,-4.+(gl_FragCoord.y-.5)*.125);
 vEaldholtWaterSourcePosition=vec3(p.x,0.,p.y);vEaldholtWaterShore=vec2(p.y,20.);
 vec4 diffuseColor=vec4(.012,.028,.048,1.);float roughnessFactor=.24;vec3 normal=vec3(0.,1.,0.);
 #include <color_fragment>
 #include <roughnessmap_fragment>
 #include <normal_fragment_maps>
 #include <lights_physical_fragment>
 result=sampleLayer==1?cfRiverLayer(p):cfRiverSurface(p,vEaldholtWaterShore,sampleTime,0.);
}`};
  patchEaldholtWaterRipples(shader,{time:{value:0},metresPerWorldUnit:{value:1},worldToSource:{value:new Matrix4()},sourceToWorldRotation:{value:new Matrix4()}});
  patchEaldholtWaterShoreColor(shader);patch(shader);
  return{name,fragment:('#version 300 es\nprecision highp float;precision highp int;uniform mat4 viewMatrix;out vec4 result;\n'+shader.fragmentShader)
   .replace(/#include <(?:common|color_fragment|roughnessmap_fragment|normal_fragment_maps|lights_physical_fragment)>/g,'')
   .replace('varying vec3 vEaldholtWaterSourcePosition;','vec3 vEaldholtWaterSourcePosition;').replace('varying vec2 vEaldholtWaterShore;','vec2 vEaldholtWaterShore;')};
 });
 const browser=await chromium.launch({headless:true,executablePath:process.env.CROWNFALL_CHROMIUM_PATH??'/usr/bin/chromium',args:['--disable-dev-shm-usage','--enable-unsafe-swiftshader']});
 try{
  const page=await browser.newPage();await page.evaluate('globalThis.__name=(fn)=>fn');
  const result=await page.evaluate(({programs})=>{
   const width=512,height=65,canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
   const gl=canvas.getContext('webgl2',{antialias:false});if(!gl||!gl.getExtension('EXT_color_buffer_float'))throw Error('GL2 float scalar attachment required.');
   function compile(type:number,source:string){const shader=gl!.createShader(type)!;gl!.shaderSource(shader,source);gl!.compileShader(shader);if(!gl!.getShaderParameter(shader,gl!.COMPILE_STATUS))throw Error(gl!.getShaderInfoLog(shader)??'Broad shader compilation failed.');return shader;}
   const vertex=compile(gl.VERTEX_SHADER,'#version 300 es\nvoid main(){vec2 p=vec2(float((gl_VertexID<<1)&2),float(gl_VertexID&2));gl_Position=vec4(p*2.-1.,0.,1.);}');
   const vao=gl.createVertexArray(),fbo=gl.createFramebuffer(),texture=gl.createTexture();gl.bindVertexArray(vao);
   gl.bindTexture(gl.TEXTURE_2D,texture);gl.texStorage2D(gl.TEXTURE_2D,1,gl.RGBA32F,width,height);gl.bindFramebuffer(gl.FRAMEBUFFER,fbo);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,texture,0);
   if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw Error('Broad scalar attachment incomplete.');gl.viewport(0,0,width,height);gl.disable(gl.DITHER);
   function metrics(data:Float32Array){
    let energy=0,maximum=0,carrier=0;for(let i=0;i<data.length;i+=4){energy+=data[i]*data[i]+data[i+1]*data[i+1];maximum=Math.max(maximum,Math.hypot(data[i],data[i+1]));}
    for(let y=0;y<height;y+=4){let mean=0;for(let x=0;x<width;x++)mean+=data[(y*width+x)*4]/width;
     const row=Array.from({length:width},(_,x)=>(data[(y*width+x)*4]-mean)*(.5-.5*Math.cos(2*Math.PI*x/(width-1))));
     let band=0,total=0;for(const value of row)total+=value*value;
     for(let k=1;k<width/2;k++){if(Math.abs(k/(width*.125)-1.45/(2*Math.PI))>.06)continue;let re=0,im=0;for(let x=0;x<width;x++){const phase=2*Math.PI*k*x/width;re+=row[x]*Math.cos(phase);im-=row[x]*Math.sin(phase);}band+=re*re+im*im;}
     carrier+=total>0?2*band/(width*total):0;
    }
    return{rms:Math.sqrt(energy/(width*height)),maximum,carrierPower:carrier/17};
   }
   const identity=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1],data=new Float32Array(width*height*4);
   const versions=programs.map(({name,fragment})=>{
    const pixel=compile(gl.FRAGMENT_SHADER,fragment),program=gl.createProgram()!;gl.attachShader(program,vertex);gl.attachShader(program,pixel);gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(program)??'Broad shader link failed.');gl.useProgram(program);
    const loc=(name:string)=>gl.getUniformLocation(program,name);gl.uniformMatrix4fv(loc('viewMatrix'),false,identity);gl.uniformMatrix4fv(loc('uEaldholtWaterSourceRotation'),false,identity);gl.uniform1f(loc('uEaldholtWaterWindStrength'),0);
    const samples=[-1,0,.75,1.7,3,5.9].map(time=>{gl.uniform1i(loc('sampleLayer'),time<0?1:0);gl.uniform1f(loc('sampleTime'),Math.max(0,time));gl.drawArrays(gl.TRIANGLES,0,3);gl.readPixels(0,0,width,height,gl.RGBA,gl.FLOAT,data);return{time,...metrics(data)};});
    gl.deleteShader(pixel);gl.deleteProgram(program);return{name,samples};
   });
   const error=gl.getError();gl.deleteShader(vertex);gl.deleteVertexArray(vao);gl.deleteTexture(texture);gl.deleteFramebuffer(fbo);gl.getExtension('WEBGL_lose_context')?.loseContext();return{versions,error};
  },{programs});
  assert.equal(result.error,0);
  const [old,current]=result.versions;
  for(let i=0;i<old.samples.length;i++){
   const a=old.samples[i],b=current.samples[i];assert.equal(a.time,b.time);assert.ok(b.rms>a.rms*.7&&b.rms<a.rms*1.15,'Keep comparable actual resolved normal energy across phase blending.');
   assert.ok(b.maximum<a.maximum*1.35,'Retain the original highlight slope budget.');assert.ok(b.carrierPower<a.carrierPower*.6,'Carrier reduction must remain after amplitude normalization.');
  }
  console.log('river-broad-gpu-measurement',JSON.stringify({...result,scope:'Actual production GLSL scalar readback only; no scene, image, visual score or hardware performance claim.'}));
 }finally{await browser.close();}
});

test('actual river field removes unresolved bands, preserves downstream transport and hands off to measured bank contact', {
 skip:process.env.CROWNFALL_VERIFY_WATER_GPU!=='1'&&'Set CROWNFALL_VERIFY_WATER_GPU=1 on an idle browser-capable worker.',timeout:60_000,
}, async()=>{
 const shader={uniforms:{},vertexShader:'#include <common>\n#include <begin_vertex>',fragmentShader:`#include <common>
uniform vec2 testPoint;uniform vec2 testDx;uniform vec2 testDy;uniform float testHalfWidth;uniform float testWidthSlope;uniform float testCentreSlope;uniform float cfRain;uniform int mode;
void main(){
 vec2 p=testPoint+testDx*(gl_FragCoord.x-.5)+testDy*(gl_FragCoord.y-.5);
 vEaldholtWaterSourcePosition=vec3(p.x,0.,p.y);vEaldholtWaterShore=vec2(p.y-testCentreSlope*p.x,testHalfWidth+testWidthSlope*p.x);
 vec4 diffuseColor=vec4(.012,.028,.048,1.);float roughnessFactor=.24;vec3 normal=vec3(0.,1.,0.);
 #include <color_fragment>
 #include <roughnessmap_fragment>
 TEST_ACTUAL_RAIN_ROUGHNESS
 #include <normal_fragment_maps>
 #include <lights_physical_fragment>
 result=ealdholtRiverField;if(mode==1)result=vec4(normal,roughnessFactor);if(mode==2)result=vec4(diffuseColor.rgb,roughnessFactor);
 if(mode==3)result=cfRiverLayer(p);if(mode==4)result=vec4(cfLegacyRiverSlope(p,vEaldholtWaterShore,uEaldholtRippleTime),0.,0.);
}`};
 patchEaldholtWaterRipples(shader,{time:{value:0},metresPerWorldUnit:{value:1},worldToSource:{value:new Matrix4()},sourceToWorldRotation:{value:new Matrix4()}});
 patchEaldholtWaterShoreColor(shader);patchEaldholtRiverFlow(shader);
 const weather={uniforms:{},vertexShader:ShaderLib.standard.vertexShader,fragmentShader:ShaderLib.standard.fragmentShader};
 patchWorldEnvironmentMaterial(weather,{},false,true,ShaderChunk.lights_fragment_begin);
 const rain=weather.fragmentShader.match(/roughnessFactor=mix\(roughnessFactor,\.31,cfRain\*\.6\);/)?.[0];assert.ok(rain);
 // Exact pre-change normal arithmetic from60fa6da, with only its output adapted
 // to a scalar buffer. It is a negative control, never a runtime fallback.
 const legacy=`vec2 cfLegacyRiverSlope(vec2 p,vec2 shore,float time){
  vec2 flow=cfDownstream(p,shore.x),across=vec2(-flow.y,flow.x);
  float bank=max(0.,shore.y-abs(shore.x)),speed=mix(.25,1.15,smoothstep(0.,4.,bank));
  float along=dot(p,flow),crossway=dot(p,across);
  float a=along*2.1-time*speed*2.1+sin(crossway*.8)*.7,b=along*4.7-time*speed*3.6-crossway*1.2;
  return flow*(cos(a)*.026+cos(b)*.012)+across*(cos(crossway*2.3+sin(a))*.007);
 }`;
 const fragment=('#version 300 es\nprecision highp float;uniform mat4 viewMatrix;out vec4 result;\n'+shader.fragmentShader)
  .replace(/#include <(?:common|color_fragment|roughnessmap_fragment|normal_fragment_maps|lights_physical_fragment)>/g,'')
  .replace('varying vec3 vEaldholtWaterSourcePosition;','vec3 vEaldholtWaterSourcePosition;')
  .replace('varying vec2 vEaldholtWaterShore;','vec2 vEaldholtWaterShore;')
  .replace('TEST_ACTUAL_RAIN_ROUGHNESS',rain).replace('void main(){',legacy+'\nvoid main(){');
 const browser=await chromium.launch({headless:true,executablePath:process.env.CROWNFALL_CHROMIUM_PATH??'/usr/bin/chromium',args:['--disable-dev-shm-usage','--enable-unsafe-swiftshader']});
 try{
  const page=await browser.newPage();await page.evaluate('globalThis.__name=(fn)=>fn');
  const data=await page.evaluate(({fragment,look})=>{
   const size=32,canvas=document.createElement('canvas');canvas.width=canvas.height=size;
   const gl=canvas.getContext('webgl2',{antialias:false});if(!gl||!gl.getExtension('EXT_color_buffer_float'))throw Error('WebGL2 float scalar attachments required.');
   function compile(type:number,source:string){const s=gl!.createShader(type)!;gl!.shaderSource(s,source);gl!.compileShader(s);if(!gl!.getShaderParameter(s,gl!.COMPILE_STATUS))throw Error(gl!.getShaderInfoLog(s)??'River shader compilation failed.');return s;}
   const vertex=compile(gl.VERTEX_SHADER,'#version 300 es\nvoid main(){vec2 p=vec2(float((gl_VertexID<<1)&2),float(gl_VertexID&2));gl_Position=vec4(p*2.-1.,0.,1.);}'),pixel=compile(gl.FRAGMENT_SHADER,fragment),program=gl.createProgram()!;
   gl.attachShader(program,vertex);gl.attachShader(program,pixel);gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(program)??'River link failed.');
   const vao=gl.createVertexArray(),texture=gl.createTexture(),fbo=gl.createFramebuffer();gl.bindVertexArray(vao);gl.useProgram(program);
   gl.bindTexture(gl.TEXTURE_2D,texture);gl.texStorage2D(gl.TEXTURE_2D,1,gl.RGBA32F,size,size);gl.bindFramebuffer(gl.FRAMEBUFFER,fbo);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,texture,0);
   if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw Error('River scalar attachment incomplete.');
   gl.viewport(0,0,size,size);gl.disable(gl.DITHER);const loc=(name:string)=>gl.getUniformLocation(program,name),identity=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
   gl.uniformMatrix4fv(loc('viewMatrix'),false,identity);gl.uniformMatrix4fv(loc('uEaldholtWaterSourceRotation'),false,identity);gl.uniform2f(loc('uEaldholtWaterWindDirection'),1,0);gl.uniform1f(loc('uEaldholtWaterWindStrength'),0);
   gl.uniform3fv(loc('uEaldholtShallowLinearColor'),look.shallowLinearColor);gl.uniform3fv(loc('uEaldholtShoreContactLinearColor'),look.contactLinearColor);
   function sample(mode:number,p:[number,number],dx:[number,number],dy:[number,number],time=1.7,width=5,centreSlope=0,rain=0,widthSlope=0){
    gl!.uniform1i(loc('mode'),mode);gl!.uniform2fv(loc('testPoint'),p);gl!.uniform2fv(loc('testDx'),dx);gl!.uniform2fv(loc('testDy'),dy);gl!.uniform1f(loc('uEaldholtRippleTime'),time);gl!.uniform1f(loc('testHalfWidth'),width);gl!.uniform1f(loc('testWidthSlope'),widthSlope);gl!.uniform1f(loc('testCentreSlope'),centreSlope);gl!.uniform1f(loc('cfRain'),rain);
    gl!.drawArrays(gl!.TRIANGLES,0,3);const result=new Float32Array(size*size*4);gl!.readPixels(0,0,size,size,gl!.RGBA,gl!.FLOAT,result);return Array.from(result);
   }
   const fine=sample(0,[0,0],[.02,0],[0,.002]),coarse=sample(0,[0,0],[4,0],[0,.002]),legacyCoarse=sample(4,[0,0],[4,0],[0,.002]);
   const later=sample(0,[0,0],[.02,0],[0,.002],1.75),followWest=sample(0,[-.0575,0],[.02,0],[0,.002],1.75),followEast=sample(0,[.0575,0],[.02,0],[0,.002],1.75);
   const seamTimes=[3,6,6000].map(time=>({time,before:sample(0,[17,1.7],[.002,0],[0,.002],time-.0001).slice(0,4),after:sample(0,[17,1.7],[.002,0],[0,.002],time+.0001).slice(0,4)}));
   const contact=sample(0,[3,5],[.002,0],[0,-.002]).slice(0,4),contactNormal=sample(1,[3,5],[.002,0],[0,-.002],1.7,5,0,1).slice(0,4),sea=sample(0,[8,20],[.02,0],[0,.002],1.7,-1).slice(0,4);
   const layerPoints:[[number,number],[number,number],[number,number]]=[[.3,.7],[13,-2.4],[-27,3.1]],layers=layerPoints.map(point=>({point,value:sample(3,point,[.002,0],[0,.002]).slice(0,4)}));
   const gradients=[{point:[13,5.7] as [number,number],centreSlope:.3,widthSlope:0},{point:[-7,1.4] as [number,number],centreSlope:-.4,widthSlope:0},
    {point:[8,6] as [number,number],centreSlope:.3,widthSlope:.2},{point:[-12,1.2] as [number,number],centreSlope:-.4,widthSlope:-.15}]
    .map(row=>({...row,value:sample(0,row.point,[.002,row.centreSlope*.002],[0,.002],1.7,5,row.centreSlope,0,row.widthSlope).slice(0,4)}));
   const openRoughness=sample(1,[0,0],[4,0],[0,.002]).slice(0,4);
   const error=gl.getError();gl.deleteProgram(program);gl.deleteShader(vertex);gl.deleteShader(pixel);gl.deleteFramebuffer(fbo);gl.deleteTexture(texture);gl.deleteVertexArray(vao);gl.getExtension('WEBGL_lose_context')?.loseContext();
   return{fine,coarse,legacyCoarse,later,followWest,followEast,seamTimes,contact,contactNormal,sea,layers,gradients,openRoughness,error};
  },{fragment,look:LOOK});
  assert.equal(data.error,0);
  const rms=(rows:readonly number[])=>Math.sqrt(rows.reduce((sum,value,index)=>index%4<2?sum+value*value:sum,0)/(rows.length/2));
  assert.ok(rms(data.fine)>.003,'Resolved current must remain visible.');assert.ok(rms(data.legacyCoarse)>.005,'The unfiltered pre-change control retains spurious subpixel slope.');
  assert.ok(rms(data.coarse)<1e-7,'Unresolved river crests must not become screen-wide regular bands.');
  const difference=(a:readonly number[],b:readonly number[])=>rms(a.map((value,index)=>value-b[index]));
  const westError=difference(data.fine,data.followWest),staticError=difference(data.fine,data.later),eastError=difference(data.fine,data.followEast);
  assert.ok(westError<staticError*.4&&eastError>westError*2,'Following the actual westward current must retain its pattern better than standing still or travelling upstream.');
  assert.ok(data.contact.every(value=>Math.abs(value)<1e-8));assert.deepEqual(data.sea,[0,0,0,0]);assert.ok(Math.abs(data.contactNormal[3]-.62)<1e-6,'Full rain cannot override the existing contact floor.');
  assert.ok(Math.abs(data.openRoughness[3]-.31)<1e-6,'Only unresolved channel detail adds bounded roughness.');
  for(const row of data.seamTimes)for(let i=0;i<4;i++)assert.ok(Math.abs(row.before[i]-row.after[i])<.001,`No phase reset at${row.time}s.`);
  const height=riverHeight;
  const derivative=(f:(x:number,y:number)=>number,p:readonly number[],axis:number)=>heightDerivative(f,p[0],p[1],axis);
  for(const row of data.layers)for(let axis=0;axis<2;axis++)assert.ok(Math.abs(row.value[axis]-derivative(height,row.point,axis))<2e-5,'Bounded two-dimensional slope must agree with an independent central difference of height.');
  for(const row of data.gradients){const field=(x:number,z:number)=>{const across=z-row.centreSlope*x,bank=5+row.widthSlope*x-Math.abs(across),t=Math.max(0,Math.min(1,bank/4)),velocity=.25+.9*t*t*(3-2*t),phase=1.7/6,other=(phase+.5)%1,blend=1-Math.abs(phase*2-1);return height(-x-phase*6*velocity,across)*blend+height(-x-other*6*velocity,across)*(1-blend);};
   for(let axis=0;axis<2;axis++)assert.ok(Math.abs(row.value[axis]-derivative(field,row.point,axis))<.001,'Real centre tangent and slower-bank advection must agree with height derivatives.');}
  console.log('river-flow-numerics',JSON.stringify({fineRms:rms(data.fine),legacyCoarseRms:rms(data.legacyCoarse),filteredCoarseRms:rms(data.coarse),westError,staticError,eastError,contact:data.contact,sea:data.sea,fullRainContactRoughness:data.contactNormal[3],unresolvedRoughness:data.openRoughness[3],seamTimes:data.seamTimes.map(row=>row.time),gradientCases:data.gradients.map(row=>({centreSlope:row.centreSlope,widthSlope:row.widthSlope})),scope:'Actual shader scalar buffers and independent height derivatives; no scene, image, visual score, hardware or FPS claim.'}));
 }finally{await browser.close();}
});
