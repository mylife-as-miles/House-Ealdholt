import assert from 'node:assert/strict';
import test from 'node:test';
import {chromium} from 'playwright';
import {Euler,Matrix3,Matrix4,Quaternion,ShaderChunk,ShaderLib,Vector3} from 'three';
import {patchVegetationWind,type VegetationWindBinding} from '../../../../shared/legacy/aethelgard/environment/vegetation-wind';
import {patchVegetationImpostor} from '../../../../shared/legacy/aethelgard/environment/vegetation-shaders';
import {patchWorldEnvironmentMaterial} from '../../../../shared/legacy/aethelgard/environment/environment-material-shader';
type WindShader=Parameters<typeof patchVegetationWind>[0];

// Frozen reference: the exact pre-optimization patch from 410a5f1. It is used
// only by this numerical test, never imported into a game renderer or asset bake.
function legacyPatch(shader:WindShader,uniforms:Record<string,{value:unknown}>,binding:VegetationWindBinding):void {
 if(shader.vertexShader.includes('CROWNFALL_VEGETATION_WIND'))return;
 Object.assign(shader.uniforms,uniforms,{
  cfWindRoot:{value:{x:binding.root[0],y:binding.root[1],z:binding.root[2]}},
  cfWindTip:{value:{x:binding.tip[0],y:binding.tip[1],z:binding.tip[2]}},cfWindFlex:{value:binding.grass?.11:.018}
 });
 const weather=shader.vertexShader.includes('CROWNFALL_WORLD_ENVIRONMENT_VERTEX');
 const declarations=weather?'':'uniform mat4 cfEnvironmentToSource; uniform float cfEnvironmentSeconds; uniform float cfWindStrength; uniform vec2 cfWindDirection;';
 // GLSL globals must precede helpers that reference them. The full weather
 // patch owns those declarations; wind-only programs declare their own here.
 const common=weather?'uniform float cfSurfaceWeatherEnabled;':'#include <common>';
 shader.vertexShader=shader.vertexShader.replace(common,`${common}
 #define CROWNFALL_VEGETATION_WIND
 ${declarations}
 uniform vec3 cfWindRoot; uniform vec3 cfWindTip; uniform float cfWindFlex;
 mat4 cfWindActorFrame(){mat4 frame=cfEnvironmentToSource*modelMatrix;
 #ifdef USE_INSTANCING
 frame=frame*instanceMatrix;
 #endif
 return frame;}
 vec2 cfWindCurve(vec3 point,mat4 frame){
 vec3 anchor=(frame*vec4(cfWindRoot,1.)).xyz;
 float height=max(.001,abs((frame*vec4(cfWindTip,1.)).y-anchor.y));
 float weight=clamp((point.y-anchor.y)/height,0.,1.);
 float gust=sin(dot(anchor.xz,vec2(.083,.061))-cfEnvironmentSeconds*.9)*.75+sin(dot(anchor.xz,vec2(.027,-.049))-cfEnvironmentSeconds*.37)*.25;
 float amplitude=min(height,20.)*cfWindFlex*cfWindStrength*gust;
 return vec2(amplitude*weight*weight,point.y>anchor.y&&point.y<anchor.y+height?amplitude*2.*weight/height:0.);}
 mat3 cfWindNormalCorrection(mat4 frame,float slope){
 return mat3(1.)-outerProduct(transpose(mat3(frame))*vec3(0.,1.,0.),inverse(mat3(frame))*vec3(cfWindDirection.x,0.,cfWindDirection.y))*slope;
 }`);
 const captured=shader.vertexShader.includes('vCrownfallAtlasNormal');
 if(!captured)shader.vertexShader=shader.vertexShader.replace('#include <defaultnormal_vertex>',`
 mat4 cfNormalFrame=cfWindActorFrame();
 if(abs(determinant(mat3(cfNormalFrame)))>.0000000001)objectNormal=cfWindNormalCorrection(cfNormalFrame,cfWindCurve((cfNormalFrame*vec4(position,1.)).xyz,cfNormalFrame).y)*objectNormal;
 #include <defaultnormal_vertex>`);
 // At this seam captured cards have already been rebuilt in their actor frame.
 // Inserting before morphing/project also preserves existing thinning patches.
 shader.vertexShader=shader.vertexShader.replace('#include <morphtarget_vertex>',`
 mat4 cfWindFrame=cfWindActorFrame();
 vec3 cfWindPoint=(cfWindFrame*vec4(transformed,1.)).xyz;
 vec2 cfWindShape=cfWindCurve(cfWindPoint,cfWindFrame);
 if(abs(determinant(mat3(cfWindFrame)))>.0000000001){
 transformed+=inverse(mat3(cfWindFrame))*vec3(cfWindDirection.x*cfWindShape.x,0.,cfWindDirection.y*cfWindShape.x);
 ${captured?'vCrownfallAtlasNormal=vCrownfallAtlasNormal*cfWindNormalCorrection(cfWindFrame,cfWindShape.y);':''}
 }
 #include <morphtarget_vertex>`);
}

const binding:VegetationWindBinding={root:[0,.176,0],tip:[0,8.176,0],grass:false};
const grassBinding:VegetationWindBinding={root:[0,.01,0],tip:[0,.61,0],grass:true};
const transform=(position:number[],rotation:number[],scale:number[])=>new Matrix4().compose(new Vector3(position[0],position[1],position[2]),new Quaternion().setFromEuler(new Euler(rotation[0],rotation[1],rotation[2])),new Vector3(scale[0],scale[1],scale[2]));
const identity=new Matrix4(),source=transform([200,12,-300],[.07,.67,-.04],[.7,1.2,.85]);
const actor=transform([16,2,-24],[.09,.42,.08],[1.4,.9,.7]),cell=transform([30,1,-20],[0,-.3,0],[1.2,1,1.2]);
const instance=transform([6,.3,-7],[.12,.8,-.06],[.8,1.3,1.1]),mirrored=transform([-6,.2,8],[0,.6,0],[-.8,1.3,1.1]);
const view=transform([2,-3,5],[.2,-.1,.04],[1,1,1]);
const cases=[
 {name:'colour-identity',kind:'standard',model:identity,source:identity,instance:null},
 {name:'grass-rotated-scaled',kind:'standard',model:source.clone().multiply(actor),source,instance:null,grass:true},
 {name:'colour-rotated-scaled',kind:'standard',model:source.clone().multiply(actor),source,instance:null},
 {name:'colour-instanced',kind:'standard',model:source.clone().multiply(cell),source,instance},
 {name:'colour-reflected-instance',kind:'standard',model:source.clone().multiply(cell),source,instance:mirrored},
 {name:'captured-canopy',kind:'standard',model:source.clone().multiply(cell),source,instance,captured:true},
 {name:'captured-orthogonal',kind:'standard',model:source.clone().multiply(cell),source,instance,captured:true,orthogonal:true},
 {name:'depth-instanced',kind:'depth',model:source.clone().multiply(cell),source,instance},
 {name:'distance-reflected',kind:'distance',model:source.clone().multiply(cell),source,instance:mirrored},
 {name:'weather-colour',kind:'standard',model:source.clone().multiply(actor),source,instance:null,weather:true},
] as const;
function expandChunks(code:string):string{
 return code.replace(/#include <([\w_]+)>/g,(_all,name:string)=>{const part=(ShaderChunk as Record<string,string>)[name];assert.equal(typeof part,'string',`Known r185 chunk ${name}`);return expandChunks(part);});
}
function vertexFor(entry:typeof cases[number],mode:'bypass'|'legacy'|'fast'){
 const captured='captured'in entry&&entry.captured,weather='weather'in entry&&entry.weather;
 const shader:WindShader={uniforms:{},vertexShader:ShaderLib[entry.kind].vertexShader,fragmentShader:ShaderLib.standard.fragmentShader};
 if(captured)patchVegetationImpostor(shader,'orthogonal'in entry&&entry.orthogonal);
 if(weather)patchWorldEnvironmentMaterial(shader,{},false,false,ShaderChunk.lights_fragment_begin);
 const selected='grass'in entry&&entry.grass?grassBinding:binding;
 if(mode==='legacy')legacyPatch(shader,{},selected);else if(mode==='fast')patchVegetationWind(shader,{},selected);
 // Counters are test-only transform-feedback outputs. They prove that the
 // disabled branch does not visit any wind frame, gust or normal helper.
 let code=shader.vertexShader.replace('mat4 cfWindActorFrame(){','mat4 cfWindActorFrame(){cfWindWork.x+=1.;')
  .replace('float gust=sin(','cfWindWork.y+=1.;float gust=sin(')
  .replace('mat3 cfWindNormalCorrection(mat4 frame,float slope){','mat3 cfWindNormalCorrection(mat4 frame,float slope){cfWindWork.z+=1.;');
 code=code.replace(/void main\s*\(\s*\)\s*\{/,'void main(){cfWindWork=vec3(0.);');
 const normal=captured?'normalize(vCrownfallAtlasNormal*normalize(vec3(.2,.7,.3)))':entry.kind==='standard'?'vNormal':'normal';
 const tangent=entry.kind==='standard'?'vTangent':'tangent.xyz';
 code=code.replace(/}\s*$/,`tfPosition=mvPosition.xyz;tfNormal=${normal};tfTangent=${tangent};tfWork=cfWindWork;}`);
 const expanded=expandChunks(code),counts=[...new Set(expanded.match(/\b(?:NUM_[A-Z_0-9]+|UNION_CLIPPING_PLANES)\b/g)??[])].map(name=>'#define '+name+' 0').join('\n');
 return `#version 300 es
precision highp float;precision highp int;
#define attribute in
#define varying out
#define texture2D texture
#define USE_TANGENT
${counts}
${entry.instance?'#define USE_INSTANCING':''}
uniform mat4 modelMatrix;uniform mat4 modelViewMatrix;uniform mat4 projectionMatrix;uniform mat4 viewMatrix;uniform mat3 normalMatrix;uniform vec3 cameraPosition;
in vec3 position;in vec3 normal;in vec4 tangent;
${entry.instance?'in mat4 instanceMatrix;':''}
out vec3 tfPosition;out vec3 tfNormal;out vec3 tfTangent;out vec3 tfWork;vec3 cfWindWork;
${expanded}`;
}

test('zero wind skips deformation algebra and preserves actual colour, captured and shadow vertex outputs',{
 skip:process.env.CROWNFALL_VERIFY_WIND_GPU!=='1'&&'Set CROWNFALL_VERIFY_WIND_GPU=1 on a browser-capable worker.',timeout:60_000,
},async()=>{
 const payload=cases.map(entry=>{
  const captured='captured'in entry&&entry.captured,grass='grass'in entry&&entry.grass,selected=grass?grassBinding:binding,modelView=view.clone().multiply(entry.model);
  const points=captured?[-.5,-.5,0,.5,-.5,0,-.5,.5,0,.5,.5,0,0,0,0]:[-.4,-.3,.2,.2,.176,-.3,-.2,2,.3,.5,4.176,-.1,-.3,8.176,.2,.4,10,-.2];
  const count=points.length/3,normals=Array.from({length:count},()=>new Vector3(.2,.9,.3).normalize().toArray()).flat(),tangents=Array.from({length:count},()=>[1,0,0,1]).flat();
  return{name:entry.name,captured,normalKind:entry.kind==='standard'?'rendered':'unused-shadow-attribute',shaders:['bypass','legacy','fast'].map(mode=>vertexFor(entry,mode as 'bypass'|'legacy'|'fast')),
   points:grass?points.map((n,i)=>i%3===1?(n-.176)*.075+.01:n*.15):points,normals,tangents,root:[...selected.root],tip:[...selected.tip],flex:selected.grass?.11:.018,model:entry.model.toArray(),modelView:modelView.toArray(),view:view.toArray(),normalMatrix:new Matrix3().getNormalMatrix(modelView).toArray(),environment:entry.source.clone().invert().toArray(),instance:entry.instance?.toArray()??null};
 });
 const browser=await chromium.launch({headless:true,executablePath:process.env.CROWNFALL_CHROMIUM_PATH??'/usr/bin/chromium',args:['--disable-dev-shm-usage','--enable-unsafe-swiftshader']});
 try{
  const page=await browser.newPage();await page.evaluate('globalThis.__name=(fn)=>fn');
  const result=await page.evaluate(payload=>{
   const canvas=document.createElement('canvas'),gl=canvas.getContext('webgl2',{antialias:false});if(!gl)throw Error('WebGL2 required for numerical transform feedback.');
   function compile(type:number,code:string){const shader=gl!.createShader(type)!;gl!.shaderSource(shader,code);gl!.compileShader(shader);if(!gl!.getShaderParameter(shader,gl!.COMPILE_STATUS))throw Error(gl!.getShaderInfoLog(shader)??'Vertex compile failure');return shader;}
   const fragment=compile(gl.FRAGMENT_SHADER,'#version 300 es\nprecision highp float;out vec4 colour;void main(){colour=vec4(1.);}');
   const output=[];
   for(const entry of payload){
    const programs=entry.shaders.map(code=>{
     const vertex=compile(gl.VERTEX_SHADER,code),program=gl.createProgram()!;gl.attachShader(program,vertex);gl.attachShader(program,fragment);gl.transformFeedbackVaryings(program,['tfPosition','tfNormal','tfTangent','tfWork'],gl.INTERLEAVED_ATTRIBS);gl.linkProgram(program);
     if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error(entry.name+': '+gl.getProgramInfoLog(program));
     const vao=gl.createVertexArray();gl.bindVertexArray(vao);gl.useProgram(program);const buffers:WebGLBuffer[]=[];
     for(const [name,values,size]of [['position',entry.points,3],['normal',entry.normals,3],['tangent',entry.tangents,4]] as [string,number[],number][]){const location=gl.getAttribLocation(program,name);if(location<0)continue;const b=gl.createBuffer()!;buffers.push(b);gl.bindBuffer(gl.ARRAY_BUFFER,b);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(values),gl.STATIC_DRAW);gl.enableVertexAttribArray(location);gl.vertexAttribPointer(location,size,gl.FLOAT,false,0,0);}
     if(entry.instance){const location=gl.getAttribLocation(program,'instanceMatrix');if(location>=0)for(let column=0;column<4;column++){gl.disableVertexAttribArray(location+column);gl.vertexAttrib4fv(location+column,entry.instance.slice(column*4,column*4+4));}}
     const loc=(name:string)=>gl.getUniformLocation(program,name);
     for(const [name,value]of [['modelMatrix',entry.model],['modelViewMatrix',entry.modelView],['viewMatrix',entry.view],['projectionMatrix',[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]],['cfEnvironmentToSource',entry.environment]] as [string,number[]][])gl.uniformMatrix4fv(loc(name),false,value);
     gl.uniformMatrix3fv(loc('normalMatrix'),false,entry.normalMatrix);gl.uniform3f(loc('cameraPosition'),250,60,-210);
     gl.uniform3fv(loc('cfWindRoot'),entry.root);gl.uniform3fv(loc('cfWindTip'),entry.tip);gl.uniform1f(loc('cfWindFlex'),entry.flex);gl.uniform2f(loc('cfWindDirection'),.8,.6);
     gl.uniform3f(loc('crownfallSourceEye'),90,50,70);gl.uniform3f(loc('crownfallAtlasCentre'),0,4.176,0);gl.uniform2f(loc('crownfallAtlasExtent'),4,8);gl.uniform1f(loc('crownfallAtlasViews'),16);
     const feedback=gl.createTransformFeedback(),buffer=gl.createBuffer()!;buffers.push(buffer);gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK,feedback);gl.bindBuffer(gl.TRANSFORM_FEEDBACK_BUFFER,buffer);gl.bufferData(gl.TRANSFORM_FEEDBACK_BUFFER,entry.points.length/3*12*4,gl.DYNAMIC_READ);gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER,0,buffer);
     return{program,vertex,vao,buffers,feedback,buffer,loc};
    });
    const rows=[];
    for(const strength of [0,.0001,.37,1])for(const seconds of [0,1200.125]){
     const values=programs.map(p=>{gl.useProgram(p.program);gl.bindVertexArray(p.vao);gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK,p.feedback);gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER,0,p.buffer);gl.uniform1f(p.loc('cfWindStrength'),strength);gl.uniform1f(p.loc('cfEnvironmentSeconds'),seconds);gl.enable(gl.RASTERIZER_DISCARD);gl.beginTransformFeedback(gl.POINTS);gl.drawArrays(gl.POINTS,0,entry.points.length/3);gl.endTransformFeedback();gl.disable(gl.RASTERIZER_DISCARD);const data=new Float32Array(entry.points.length/3*12);gl.bindBuffer(gl.TRANSFORM_FEEDBACK_BUFFER,p.buffer);gl.getBufferSubData(gl.TRANSFORM_FEEDBACK_BUFFER,0,data);return Array.from(data);});
     rows.push({strength,seconds,values});
    }
    for(const p of programs){for(const b of p.buffers)gl.deleteBuffer(b);gl.deleteTransformFeedback(p.feedback);gl.deleteVertexArray(p.vao);gl.deleteProgram(p.program);gl.deleteShader(p.vertex);}
    output.push({name:entry.name,normalKind:entry.normalKind,rows});
   }
   const error=gl.getError();gl.deleteShader(fragment);gl.getExtension('WEBGL_lose_context')?.loseContext();return{output,error};
  },payload);
  assert.equal(result.error,0);let disabledMaxError=0,enabledMaxError=0,disabledBitDifferences=0,enabledSamples=0,skippedLegacyVisits=0;
  for(const entry of result.output)for(const row of entry.rows){
   const[bypass,legacy,fast]=row.values;assert.ok(fast.every(Number.isFinite),entry.name+' remains finite.');
   for(let at=0;at<fast.length;at++){
    if(at%12>=9){if(row.strength===0){assert.equal(fast[at],0,'Disabled wind must not visit frame/gust/normal helpers.');skippedLegacyVisits+=legacy[at];}continue;}
    const expected=row.strength===0?bypass[at]:legacy[at],error=Math.abs(fast[at]-expected);
    if(row.strength===0){disabledMaxError=Math.max(disabledMaxError,error);const bits=new Float32Array([fast[at],expected]);disabledBitDifferences+=Number(new Uint32Array(bits.buffer)[0]!==new Uint32Array(bits.buffer)[1]);assert.ok(error<=1e-6,entry.name+' disabled wind equals the untouched vertex path.');}
    else{enabledMaxError=Math.max(enabledMaxError,error);enabledSamples++;assert.ok(error<=.00005,entry.name+' enabled wind matches frozen 410a5f1 equations.');}
   }
  }
  assert.ok(skippedLegacyVisits>0,'The frozen disabled path must demonstrate the previously executed work.');
  console.log('wind-transform-feedback',JSON.stringify({cases:result.output.map(e=>({name:e.name,normalKind:e.normalKind})),disabledMaxError,disabledBitDifferences,enabledMaxError,enabledSamples,skippedLegacyVisits,scope:'Numerical vertex-shader control-flow/parity only; no scene, image, FPS or hardware-performance acceptance.'}));
 }finally{await browser.close();}
});
