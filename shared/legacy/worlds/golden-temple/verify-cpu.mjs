// Geometry/count verification only. Canvas drawing is stubbed: this is not a
// texture, shader, browser, headset, GPU-performance or visual validation.
import * as THREE from 'crownfall-world-three';
import { buildWorld } from './build.js';
import { writeFile } from 'node:fs/promises';
const gradient={addColorStop(){}};
function canvas(){
 const element={width:1,height:1,style:{},getContext(){return context;}};
 const target={canvas:element,measureText:text=>({width:String(text).length*8}),createLinearGradient:()=>gradient,createRadialGradient:()=>gradient,createPattern:()=>({}),getImageData:(x,y,w,h)=>({width:w,height:h,data:new Uint8ClampedArray(w*h*4)}),createImageData:(w,h)=>({width:w,height:h,data:new Uint8ClampedArray(w*h*4)})};
 const context=new Proxy(target,{get(t,p){return p in t?t[p]:()=>{}},set(t,p,v){t[p]=v;return true;}});return element;
}
globalThis.document={createElement:name=>{if(name!=='canvas')throw Error(`Unexpected DOM element in source build: ${name}`);return canvas();}};
const renderer={capabilities:{getMaxAnisotropy:()=>1,isWebGL2:true},getDrawingBufferSize:v=>v.set(640,480),getSize:v=>v.set(640,480),shadowMap:{enabled:false,autoUpdate:false}};
const profile=process.argv.includes('--desktop')?'desktop':'quest';
if(process.argv.includes('--abort')){
 const counts={geometry:0,material:0,texture:0,target:0};let atAbort;
 for(const [key,prototype] of [['geometry',THREE.BufferGeometry.prototype],['material',THREE.Material.prototype],['texture',THREE.Texture.prototype],['target',THREE.WebGLRenderTarget.prototype]]){
  const dispose=prototype.dispose;prototype.dispose=function(...args){counts[key]++;return dispose.apply(this,args);};
 }
 try{await buildWorld({THREE,renderer,profile,nationId:'korvenia',onProgress:label=>{if(label==='Building temple hall'){atAbort={...counts};throw Error('expected-pending-view-disposal');}}});throw Error('The pending abort was ignored');}
 catch(error){if(error.message!=='expected-pending-view-disposal')throw error;}
 const cleanup=Object.fromEntries(Object.entries(counts).map(([key,count])=>[key,count-atAbort[key]]));
 if(Object.values(cleanup).some(count=>count<=0))throw Error(`Incomplete internal abort cleanup: ${JSON.stringify(cleanup)}`);
 console.log(JSON.stringify({abortCleanupPassed:true,stubbedCanvas:true,disposedAfterAbort:cleanup},null,2));process.exit(0);
}
const started=performance.now();
const stages=[];let stage='';
const asset=await buildWorld({THREE,renderer,profile,nationId:'korvenia',scene:new THREE.Scene(),camera:new THREE.PerspectiveCamera(),onProgress:label=>{if(label!==stage){stage=label;stages.push({stage:label,ms:Math.round(performance.now()-started)});console.log(label);}}});
const groups=[];
for(const child of asset.root.children){let triangles=0,draws=0,instances=0;child.traverse(o=>{if(!o.isMesh||!o.visible)return;const geometry=o.geometry;const n=(geometry.index?.count??geometry.attributes.position.count)/3;triangles+=n*(o.isInstancedMesh?o.count:1);draws+=geometry.groups.length||1;if(o.isInstancedMesh)instances+=o.count;});const meshes=[];child.traverse(o=>{if(o.isMesh)meshes.push({name:o.name,triangles:(o.geometry.index?.count??o.geometry.attributes.position.count)/3*(o.isInstancedMesh?o.count:1)});});groups.push({name:child.name,triangles,draws,instances,heaviest:meshes.sort((a,b)=>b.triangles-a.triangles).slice(0,5)});}
const report={profile,stubbedCanvas:true,limits:'CPU source geometry and navigation only. Canvas drawing and GPU bakes are stubbed; no pixels, shader, headset frame-rate or comfort validation.',buildMs:Math.round(performance.now()-started),stages,navigation:asset.exploration?{nodes:asset.exploration.graph.nodes.length,edges:asset.exploration.graph.edges.length,hubs:Object.keys(asset.exploration.fastTravel??{}),destinations:Object.keys(asset.exploration.destinations).filter(id=>!id.startsWith('route:')),validationMs:Math.round(performance.now()-started-(stages.find(s=>s.stage==='Validating temple walking areas')?.ms??0))}:null,maxRssKiB:process.resourceUsage().maxRSS,groups,triangles:groups.reduce((n,g)=>n+g.triangles,0),draws:groups.reduce((n,g)=>n+g.draws,0)};
console.log(JSON.stringify(report,null,2));if(process.env.CROWNFALL_WORLD_REPORT)await writeFile(process.env.CROWNFALL_WORLD_REPORT,JSON.stringify(report,null,2));asset.dispose();
