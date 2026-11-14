// Real WebGL shader/attribute regression; no game screenshots or performance claim.
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const host=new URL(process.env.CROWNFALL_TEST_URL??'http://127.0.0.1:4191');
assert.ok(['localhost','127.0.0.1'].includes(host.hostname));
const sharedRoot=resolve(dirname(fileURLToPath(import.meta.url)),'../../shared/legacy/aethelgard/environment');
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH??'/usr/bin/chromium',args:['--disable-dev-shm-usage','--enable-unsafe-swiftshader']});
try{
 const page=await browser.newPage(),messages=[];page.on('pageerror',e=>messages.push(e.message));page.on('console',m=>{if(m.type()==='error'||/GL_INVALID/.test(m.text()))messages.push(m.text());});
 await page.route('**/__regional-api.html',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><canvas></canvas>'}));await page.goto(new URL('/__regional-api.html',host).href);
 const result=await page.evaluate(async sharedRoot=>{
  const T=await import('/node_modules/three/build/three.module.js'),{createEaldholtRegionalHorizonView}=await import('/src/legacy/aethelgard/regional-horizon-view.ts');
  const {createEaldholtFarGeography}=await import(sharedRoot+'/far-surround.ts'),{createWorldPreparationQueue}=await import(sharedRoot+'/world-preparation-queue.ts');
  const renderer=new T.WebGLRenderer({canvas:document.querySelector('canvas'),preserveDrawingBuffer:true});renderer.setSize(16,16);const gl=renderer.getContext();
  const scene=new T.Scene(),camera=new T.PerspectiveCamera(70,1,.2,11000);camera.position.set(0,200,0);camera.lookAt(3300,700,-1300);scene.add(new T.HemisphereLight(0xffffff,0x557755,2));scene.add(new T.DirectionalLight(0xffffff,3));
  function tex(data,channel){const t=new T.DataTexture(new Uint8Array(data),1,1);t.channel=channel;t.needsUpdate=true;return t;}
  const rock={albedo:tex([160,150,140,255],2),normal:tex([128,128,255,255],2),orm:tex([255,220,0,255],3),meanLuminance:.32};
  const geography=createEaldholtFarGeography({sourceEnvelope:{minX:0,maxX:80,minZ:0,maxZ:80},seaPositions:[-100,0,-100,-50,0,-100,-100,0,200,-50,0,200],channelPositions:[-50,0,90,-50,0,115,200,0,90,200,0,115],riverFarX:30000});
  const queue=createWorldPreparationQueue(()=>{},64,2*1024*1024),abort=new AbortController(),owner=createEaldholtRegionalHorizonView({geography,profile:'quest',renderer,scene,camera,queue,signal:abort.signal,rock,changed(){}});scene.add(owner.object);
  const until=Date.now()+30000;while(owner.stats.status==='preparing'&&Date.now()<until){queue.step();await new Promise(r=>setTimeout(r,5));}
  if(owner.stats.status!=='ready')throw Error(JSON.stringify(owner.stats));
  renderer.render(scene,camera);const error=gl.getError(),pixels=new Uint8Array(16*16*4);gl.readPixels(0,0,16,16,gl.RGBA,gl.UNSIGNED_BYTE,pixels);let colour=0;for(let i=0;i<pixels.length;i+=4)colour+=pixels[i]+pixels[i+1]+pixels[i+2];
  const stats={...owner.stats};owner.dispose();queue.dispose();Object.values(rock).forEach(t=>t?.dispose?.());renderer.dispose();renderer.forceContextLoss();return{error,colour,stats};
 },'/@fs/'+sharedRoot);
 console.log(JSON.stringify({result,messages,scope:'GPU API regression only; not Crownfall scene or headset acceptance.'}));assert.equal(result.error,0);assert.equal(messages.length,0);assert.ok(result.colour>0);
}finally{await browser.close();}
