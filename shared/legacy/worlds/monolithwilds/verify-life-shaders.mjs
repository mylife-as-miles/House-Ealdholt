// Focused assembly regression for the two GPU-reported skyform errors. This is
// preprocessing/assembly, not a replacement for the consuming renderer's GPU gate.
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { spawnSync } from 'node:child_process';
if(!process.env.CROWNFALL_THREE_MODULE)throw Error('Set CROWNFALL_THREE_MODULE');
registerHooks({resolve(s,c,n){return n(s==='crownfall-world-three'?process.env.CROWNFALL_THREE_MODULE:s,c);}});
const THREE=await import('crownfall-world-three');
const noise=await import('./src/core/noise.js'),layout=await import('./src/core/layout.js'),terrain=await import('./src/core/terrain-height.js');
const {atmo,atmosphereUniforms,fogUniforms}=await import('./src/core/atmosphere.js');
const {createEnvironment}=await import('./src/core/environment.js');
const {createSourceTransform}=await import('./source-transform.js');
const {build}=await import('./src/world/life.js');
const root=new THREE.Scene();root.fog=new THREE.FogExp2(0,0.00025);const camera=new THREE.PerspectiveCamera(55,4/3,1,20000);camera.position.set(-1000,330,1250);
const ctx={THREE,scene:root,camera,renderer:{domElement:{width:640,height:480},getDrawingBufferSize(v){return v.set(640,480);}},quality:{level:'low',shadows:false},params:{hour:17.6},layout,noise,...terrain,atmo,atmosphereUniforms,fogUniforms};ctx.env=createEnvironment(ctx);await build(ctx);
for(const system of ['birds','motes','fireflies','mist','skyforms'])assert.ok(ctx.life[system],`${system} constructs`);
const globals={...THREE.ShaderChunk};createSourceTransform(root,camera);
const seen=new Set(),materials=[];root.traverse(o=>{for(const m of (o.material?(Array.isArray(o.material)?o.material:[o.material]):[])){if(m.isShaderMaterial&&!seen.has(m)){seen.add(m);materials.push(m);}}});
for(const material of materials){
 const shader={uniforms:{...material.uniforms},vertexShader:material.vertexShader,fragmentShader:material.fragmentShader};material.onBeforeCompile(shader,{});
 for(const fog of [false,true]){
  const definitions=Object.entries(material.defines||{}).map(([k,v])=>`#define ${k} ${v}`).join('\n');
  const text=(fog?'#define USE_FOG\n#define FOG_EXP2\n':'')+definitions+'\n'+shader.fragmentShader.replace(/#include\s*<[^>]+>/g,'');
  const result=spawnSync('cpp',['-P','-undef','-nostdinc','-x','c'],{input:text,encoding:'utf8'});assert.equal(result.status,0,`${material.name}: ${result.stderr}`);
  if(/\buAtmoTime\b/.test(result.stdout))assert.match(result.stdout,/uniform\s+vec4\s+uAtmoTime\s*;/,`${material.name} declares atmosphere time with fog=${fog}`);
  if(/\batmoFogTerm\s*\(/.test(result.stdout))assert.match(result.stdout,/vec4\s+atmoFogTerm\s*\(/,`${material.name} declares atmosphere helper with fog=${fog}`);
 }
 if(/viewMatrix\s*\*\s*vec4\(wp,/.test(material.vertexShader))assert.match(shader.vertexShader,/viewMatrix\s*\*\s*uMwWorldFromSource\s*\*\s*vec4\(wp,/,`${material.name} rasterises source-space life through the root transform`);
}
assert.deepEqual({...THREE.ShaderChunk},globals);console.log(JSON.stringify({passed:true,materials:materials.map(m=>m.name||m.type),fogConfigurations:2,limits:'CPU shader assembly/preprocessing only; root must repeat actual GPU shader gate.'},null,2));
