// Actual worker/TSL producer and CPU byte comparison. No scene or game claims.
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const host=new URL(process.env.CROWNFALL_TEST_URL??'http://127.0.0.1:4191');assert.ok(['localhost','127.0.0.1'].includes(host.hostname));
const sharedRoot=resolve(dirname(fileURLToPath(import.meta.url)),'../../shared/legacy/aethelgard/environment');
const browser=await chromium.launch({headless:true,executablePath:process.env.CROWNFALL_CHROMIUM_PATH??'/usr/bin/chromium',args:['--disable-dev-shm-usage','--enable-unsafe-webgpu','--enable-unsafe-swiftshader']});
try{
 const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.route('**/__cloud-compute-api.html',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><title>Cloud compute API check</title>'}));await page.goto(new URL('/__cloud-compute-api.html',host).href);
 const result=await page.evaluate(async sharedRoot=>{
  const {createCloudDensityVolume,validateCloudDensityVolume}=await import(sharedRoot+'/cloud-volume.ts');
  const run=(width,height)=>new Promise((resolve,reject)=>{
   const worker=new Worker('/src/legacy/aethelgard/cloud-density.worker.ts',{type:'module'}),timer=setTimeout(()=>{worker.terminate();reject(Error('Cloud worker timed out.'));},60000);
   worker.onerror=e=>{clearTimeout(timer);worker.terminate();reject(Error(e.message));};worker.onmessage=e=>{clearTimeout(timer);worker.terminate();if(e.data.error)reject(Error(e.data.error));else resolve(e.data);};worker.postMessage({width,height});
  });
  const results=[];
  for(const [width,height]of [[16,8],[32,12],[64,24]]){
   const start=performance.now(),reply=await run(width,height),data=reply.data,cpu=createCloudDensityVolume(width,height);let densityMaxDifference=0,densityDifferences=0,occurrenceDifferences=0;
   for(let at=0;at<data.length;at+=2){const difference=Math.abs(data[at]-cpu[at]);densityMaxDifference=Math.max(densityMaxDifference,difference);densityDifferences+=Number(difference>0);occurrenceDifferences+=Number(data[at+1]!==cpu[at+1]);}
   results.push({width,height,backend:reply.backend,fallbackReason:reply.fallbackReason,bytes:data.length,valid:validateCloudDensityVolume(data,width,height),densityMaxDifference,densityDifferences,occurrenceDifferences,milliseconds:performance.now()-start});
  }
  return results;
 },'/@fs/'+sharedRoot);
 for(const r of result){
  assert.equal(r.bytes,r.width*r.height*r.width*2);assert.equal(r.valid,true);assert.ok(['webgpu-tsl','cpu-worker'].includes(r.backend));
  if(r.backend==='cpu-worker')assert.match(r.fallbackReason,/WebGPU.*unavailable|WebGPU.*not.*available|Failed to create.*WebGPU|GPU.*adapter/i,'Unexpected GPU error must not pass as an unsupported-device fallback.');
  assert.equal(r.occurrenceDifferences,0,'Occurrence bytes must agree exactly between CPU and WGSL.');
  assert.ok(r.densityMaxDifference<=1,'Floating point density must agree within one RG8 quantization step.');
 }
 assert.deepEqual(errors,[],'The real worker must not hide shader compilation/validation errors behind its CPU fallback.');
 console.log(JSON.stringify({passed:true,result,scope:'Actual worker/CPU byte comparison with software adapters permitted; not target hardware performance.'}));
}finally{await browser.close();}
