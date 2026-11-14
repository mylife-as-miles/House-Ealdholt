// Asset-only browser regression. Uses Crownfall's real Desktop loader and
// prepare adapter, with no app, scene, renderer, canvas, save or profile.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';
import {chromium} from 'playwright';

const desktop=resolve(dirname(fileURLToPath(import.meta.url)),'..'),repo=dirname(desktop);
const output=resolve(process.env.CROWNFALL_NATURAL_BANK_INTAKE_OUTPUT??'');
assert.ok(process.env.CROWNFALL_NATURAL_BANK_INTAKE_OUTPUT&&output.startsWith('/'),'Choose a NEW absolute private output directory.');
assert.ok(!output.startsWith(repo+'/'),'Evidence must be outside the source checkout.');
await mkdir(output,{mode:0o700}); // Exclusive: never overwrite earlier evidence.
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const assetPath='assets/legacy/environment/aethelgard/natural-bank-plants-v1/';
const git=args=>execFileSync('git',args,{cwd:repo,encoding:'utf8'}).trim();
const helperPath=fileURLToPath(import.meta.url),helperSha256=hash(await readFile(helperPath));
const report={passed:false,startedAt:new Date().toISOString(),sourceCommit:git(['rev-parse','HEAD']),sourceTreeStatus:git(['status','--porcelain']),helperSha256,
 scope:'Actual Desktop environment GLTFLoader and actual prepareNaturalRiparianAsset for both public canonical GLBs. Native-file data qualification under Desktop is not Native SDK, rendering, visual or hardware proof.',
 renderersCreated:0,scenesActivated:0,camerasCreated:0,screenshotsTaken:0,models:{},sourceModules:{},pageErrors:[],blocked:[],browserClosed:false,serverClosed:false};
let server,browser,deadline;
try{
 const manifest=JSON.parse(await readFile(desktop+'/public/'+assetPath+'manifest.json','utf8'));
 for(const[profile,pin]of Object.entries(manifest.profiles)){const bytes=await readFile(desktop+'/public/'+assetPath+pin.file);assert.equal(hash(bytes),pin.sha256);report.models[profile]={file:pin.file,sha256:pin.sha256,bytes:bytes.length};}
 server=await createServer({root:desktop,configFile:false,appType:'custom',logLevel:'warn',cacheDir:output+'/vite-cache',
  resolve:{dedupe:['three']},optimizeDeps:{noDiscovery:true,include:['three','three/examples/jsm/loaders/GLTFLoader.js','three/examples/jsm/loaders/DRACOLoader.js','three/examples/jsm/loaders/KTX2Loader.js']},
  server:{host:'127.0.0.1',port:0,fs:{allow:[repo]}}});
 await server.listen();const address=server.httpServer.address();assert.ok(address&&typeof address==='object');const origin='http://127.0.0.1:'+address.port;report.origin=origin;
 const modules={loader:'/src/legacy/aethelgard/environment-asset-loader.ts',prepare:'/src/legacy/aethelgard/natural-riparian-source.ts',program:'/src/legacy/aethelgard/natural-riparian-program.ts'};
 for(const[key,path]of Object.entries(modules)){const bytes=await readFile(desktop+path),response=await fetch(origin+path);assert.equal(response.status,200);const emitted=await response.text(),match=emitted.match(/sourceMappingURL=data:application\/json;base64,([^\s]+)/);assert.ok(match,'Actual transformed source map missing: '+path);const map=JSON.parse(Buffer.from(match[1],'base64').toString());assert.ok(map.sourcesContent.some(source=>hash(source)===hash(bytes)),'Served module differs from worktree: '+path);report.sourceModules[key]={path,sha256:hash(bytes),servedSourceMapMatches:true};}
 browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH??'/usr/bin/chromium',args:['--disable-dev-shm-usage']});
 deadline=setTimeout(()=>void browser.close(),60000);const context=await browser.newContext(),page=await context.newPage();page.on('pageerror',error=>report.pageErrors.push(String(error)));
 await context.route('**/*',async route=>{const url=new URL(route.request().url());if(url.origin!==origin){report.blocked.push(url.href);await route.abort();}else await route.fallback();});
 await page.route(origin+'/__natural-riparian-asset-intake',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><meta charset="utf-8"><title>Canonical asset intake</title>'}));
 await page.goto(origin+'/__natural-riparian-asset-intake',{waitUntil:'domcontentloaded'});
 report.intake=await page.evaluate(async({models,assetPath})=>{
  const{createEaldholtEnvironmentAssetLoader}=await import('/src/legacy/aethelgard/environment-asset-loader.ts');
  const{prepareNaturalRiparianAsset}=await import('/src/legacy/aethelgard/natural-riparian-source.ts');
  const controller=new AbortController(),loader=createEaldholtEnvironmentAssetLoader({baseUrl:'/',signal:controller.signal}),profiles=[];
  const digest=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');
  const invariant=(okay,message)=>{if(!okay)throw Error(message);};
  try{for(const[profile,pin]of Object.entries(models)){
   invariant(await digest(await fetch('/'+assetPath+pin.file).then(response=>response.arrayBuffer()))===pin.sha256,'Browser asset checksum mismatch.');
   const asset=await loader.loadAsync('/'+assetPath+pin.file),meshes=[];asset.scene.traverse(node=>{if(node.isMesh)meshes.push(node);});
   let prepared,sourceDisposals=0;const originals=meshes.map(mesh=>({geometry:mesh.geometry,material:mesh.material,map:mesh.material.map,normalMap:mesh.material.normalMap,arm:mesh.material.roughnessMap}));
   for(const row of originals)for(const resource of[row.geometry,row.material,row.map,row.normalMap,row.arm])resource.addEventListener('dispose',()=>sourceDisposals++);
   const snapshot=async()=>Promise.all(meshes.map(async mesh=>({name:mesh.name,attributes:Object.keys(mesh.geometry.attributes).sort(),normalMapType:mesh.material.normalMapType,normalScale:mesh.material.normalScale.toArray(),
    arrays:await Promise.all([...Object.entries(mesh.geometry.attributes),['index',mesh.geometry.index]].map(async([name,a])=>({name,itemSize:a.itemSize,normalized:a.normalized,sha256:await digest(new Uint8Array(a.array.buffer,a.array.byteOffset,a.array.byteLength))}))),
    material:{uuid:mesh.material.uuid,type:mesh.material.type,color:mesh.material.color.toArray(),roughness:mesh.material.roughness,metalness:mesh.material.metalness,alphaTest:mesh.material.alphaTest,transparent:mesh.material.transparent,side:mesh.material.side,
     textures:[mesh.material.map,mesh.material.normalMap,mesh.material.roughnessMap].map(texture=>({uuid:texture.uuid,sourceUuid:texture.source.uuid,colorSpace:texture.colorSpace,flipY:texture.flipY,generateMipmaps:texture.generateMipmaps,wrapS:texture.wrapS,wrapT:texture.wrapT,minFilter:texture.minFilter,magFilter:texture.magFilter,offset:texture.offset.toArray(),repeat:texture.repeat.toArray(),rotation:texture.rotation}))}})));
   const before=await snapshot();
   try{prepared=await prepareNaturalRiparianAsset(asset,profile==='native');invariant(prepared.plants.length===2,'Both source families must qualify.');
    const after=await snapshot();invariant(JSON.stringify(before)===JSON.stringify(after),'Source arrays/material state changed.');
    for(let i=0;i<meshes.length;i++){const old=originals[i],owned=prepared.plants[i];invariant(meshes[i].geometry===old.geometry&&meshes[i].material===old.material&&old.material.map===old.map&&old.material.normalMap===old.normalMap&&old.material.roughnessMap===old.arm,'Original source references changed.');invariant(before[i].attributes.join(',')==='normal,position,uv'&&before[i].normalMapType===0&&before[i].normalScale.join(',')==='1,-1','Actual derivative-tangent source contract differs.');
     invariant(owned.geometry!==old.geometry&&owned.material!==old.material&&owned.map!==old.map&&owned.material.normalMap!==old.normalMap&&owned.material.normalScale.toArray().join(',')==='1,-1','Owned source clone/sign contract differs.');}
    profiles.push({profile,file:pin.file,sha256:pin.sha256,loader:'Actual Desktop createEaldholtEnvironmentAssetLoader',before,after,sourcePreserved:true,prepared:{plants:prepared.plants.length,sourceSha256:prepared.sourceSha256,accountedBytes:prepared.accountedBytes,normalScales:prepared.plants.map(plant=>plant.material.normalScale.toArray())}});
   }finally{prepared?.dispose();prepared?.dispose();invariant(sourceDisposals===0,'Owned cleanup disposed original source resources.');
    const geometries=new Set(),materials=new Set(),textures=new Set(),images=new Set();for(const row of originals){geometries.add(row.geometry);materials.add(row.material);for(const texture of[row.map,row.normalMap,row.arm]){textures.add(texture);if(texture.image instanceof ImageBitmap)images.add(texture.image);}}
    for(const g of geometries)g.dispose();for(const m of materials)m.dispose();for(const t of textures)t.dispose();for(const image of images)image.close();asset.scene.clear();}
  }}finally{loader.dispose();controller.abort();await loader.whenIdle();}
  invariant(document.querySelectorAll('canvas,#root').length===0,'Application or renderer DOM was activated.');
  return{profiles,decoder:{...loader.stats},appDomAbsent:true};
 },{models:report.models,assetPath});
 assert.equal(report.intake.profiles.length,2);assert.equal(report.intake.decoder.pending,0);assert.equal(report.intake.decoder.decodersReleased,true);assert.deepEqual(report.pageErrors,[]);assert.deepEqual(report.blocked,[]);
 for(const pin of Object.values(report.models))assert.equal(hash(await readFile(desktop+'/public/'+assetPath+pin.file)),pin.sha256);
 assert.equal(git(['rev-parse','HEAD']),report.sourceCommit);assert.equal(git(['status','--porcelain']),report.sourceTreeStatus);assert.equal(hash(await readFile(helperPath)),helperSha256);
 for(const module of Object.values(report.sourceModules))assert.equal(hash(await readFile(desktop+module.path)),module.sha256,'Source changed during intake: '+module.path);
 report.sourceStableAcrossRun=true;
 report.passed=true;
}catch(error){report.failure=String(error);report.stack=error.stack;process.exitCode=1;}
finally{clearTimeout(deadline);if(browser){await browser.close();report.browserClosed=true;}if(server){await server.close();report.serverClosed=true;}report.finishedAt=new Date().toISOString();await writeFile(output+'/intake.json',JSON.stringify(report,null,2),{mode:0o600});console.log(JSON.stringify({passed:report.passed,failure:report.failure,output:output+'/intake.json',browserClosed:report.browserClosed,serverClosed:report.serverClosed}));}
