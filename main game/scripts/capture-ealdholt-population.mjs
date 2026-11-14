// Actual game/UI evidence. No direct scene/camera access or prepared Legacy saves.
import assert from 'node:assert/strict';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {resolve,relative,dirname,basename} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
import {captureActualWorldCanvas} from './actual-world-canvas-readback.mjs';
import {populationNavigationReady,canopyCaptureState,regionalDetailCaptureReady} from './actual-world-capture-gates.mjs';
import {verifyEnvironmentDecoders} from './verify-environment-decoders.mjs';
import {actualWorldDaylight,daylightInspectionTiming,daylightInspectionWorkDeadline} from './actual-world-daylight.mjs';
const dir=resolve(process.env.CROWNFALL_EALDHOLT_ARTIFACTS??'');
assert.ok(process.env.CROWNFALL_EALDHOLT_ARTIFACTS&&relative(resolve(dirname(fileURLToPath(import.meta.url)),'../..'),dir).startsWith('..'),'Choose a private evidence directory outside the checkout.');
await mkdir(dir,{recursive:true,mode:0o700});
const url=new URL(process.env.CROWNFALL_TEST_URL??'http://127.0.0.1:4191');url.searchParams.set('ealdholt-house','1');url.searchParams.set('ealdholtWorldTrace','1');
const views=(process.env.CROWNFALL_EALDHOLT_VIEWS??'well,overview').split(',');assert.ok(views.length>0&&views.every(v=>['well','overview','riverside'].includes(v)));
const minimumDrawn=Number(process.env.CROWNFALL_EALDHOLT_MIN_DRAWN??1);assert.ok(Number.isInteger(minimumDrawn)&&minimumDrawn>=1&&minimumDrawn<=100);
const entryView=process.env.CROWNFALL_EALDHOLT_ENTRY_VIEW;assert.ok(!entryView||['well','overview','riverside'].includes(entryView));
const width=Number(process.env.CROWNFALL_EALDHOLT_CAPTURE_WIDTH??1280);assert.ok([960,1280].includes(width));
const viewport={width,height:width===960?600:800};
const renderScale=Number(process.env.CROWNFALL_EALDHOLT_RENDER_SCALE??90);assert.ok([50,75,90,100].includes(renderScale));
const report={passed:false,startedAt:new Date().toISOString(),views:[],errors:[],warnings:[],browserClosed:false,
 limits:'Real Desktop application, reduced-motion capture on software rendering; not physical Quest or completed 100-resident behavior evidence.'};
const fastInput=process.env.CROWNFALL_EALDHOLT_CAPTURE_FAST_INPUT==='1';report.reducedActionabilityWaits=fastInput;report.domActivatedControls=fastInput;report.directCompositorCapture=fastInput;report.controlExecutionRealm=fastInput?'main-page-dom':'playwright';
const quality=process.env.CROWNFALL_EALDHOLT_QUALITY??'medium';assert.ok(['low','medium','high'].includes(quality));report.quality=quality;report.viewport=viewport;report.renderScale=renderScale;
const motion=process.env.CROWNFALL_EALDHOLT_REDUCED_MOTION==='0'?'no-preference':'reduce';report.reducedMotion=motion;report.limits='Real Desktop application, '+(motion==='reduce'?'reduced-motion':'normal-motion')+' capture on software rendering; not physical Quest or completed 100-resident behavior evidence.';
const environmentOnly=process.env.CROWNFALL_EALDHOLT_ENVIRONMENT_ONLY==='1';report.environmentOnly=environmentOnly;
const captureModelReady=process.env.CROWNFALL_EALDHOLT_CAPTURE_MODEL_READY==='1';report.captureModelReady=captureModelReady;
const capturePopulatedWell=process.env.CROWNFALL_EALDHOLT_CAPTURE_POPULATED_WELL==='1';
assert.ok(!capturePopulatedWell||(captureModelReady&&!environmentOnly&&views.includes('well')),'An additional Well image requires model-ready mode, normal entry and actual resident checks.');
const canvasFallback=process.env.CROWNFALL_EALDHOLT_CANVAS_FALLBACK==='1';
const singlePopulatedWell=!captureModelReady&&!environmentOnly&&views.length===1&&views[0]==='well';
const singleEnvironmentView=!captureModelReady&&environmentOnly&&views.length===1;
assert.ok(!canvasFallback||(fastInput&&(captureModelReady||singlePopulatedWell||singleEnvironmentView)),'Canvas fallback requires one current authored environment view, model-ready evidence, or a populated Well on the existing page.');
const canvasOnly=process.env.CROWNFALL_EALDHOLT_CANVAS_ONLY==='1';
assert.ok(!canvasOnly||(canvasFallback&&fastInput&&(singleEnvironmentView||singlePopulatedWell)),'Direct canvas evidence requires one current authored environment view or a populated Well with exact-frame resident checks; it does not capture UI.');
const verifyWind=process.env.CROWNFALL_EALDHOLT_VERIFY_WIND==='1';
assert.ok(!verifyWind||(singleEnvironmentView&&motion==='no-preference'),'Wind evidence requires one actual environment view with motion enabled.');
const daylightThroughUi=process.env.CROWNFALL_EALDHOLT_DAYLIGHT_THROUGH_UI==='1';
assert.ok(!daylightThroughUi||(singleEnvironmentView&&fastInput&&motion==='no-preference'),'Daylight inspection uses normal observer controls in one environment view.');
const requireWoodlandGround=process.env.CROWNFALL_EALDHOLT_REQUIRE_WOODLAND_GROUND==='1';
assert.ok(!requireWoodlandGround||singleEnvironmentView,'Ground integration evidence requires one actual environment view.');
const captureLimit=Number(process.env.CROWNFALL_EALDHOLT_CAPTURE_LIMIT_MS??420000);assert.ok(Number.isSafeInteger(captureLimit)&&captureLimit>=420000&&captureLimit<=1800000);
const captureDeadlineAt=Date.now()+captureLimit;
let browser,page;const deadline=setTimeout(()=>{report.failure='Capture exceeded its '+captureLimit+' ms limit.';void browser?.close();},captureLimit);
const root=()=>page.locator('.ealdholt-preview[aria-hidden="false"]');
const control=s=>root().locator(s),world=()=>control('.ealdholt-world');
const readyMenu=()=>page.locator('.menu-shell[data-boot-state="ready"] .menu-content:not([inert]):not([aria-hidden="true"])');
async function screenshot(path,timeout=150000){
 if(canvasFallback)timeout=Math.min(timeout,45000);
 if(!fastInput)return page.screenshot({path,timeout});
 const borrowedSession=!!captureSession,session=borrowedSession?await captureSession:await contextForCapture().newCDPSession(page);let timer;
 try{
  if(canvasOnly){
   report.directCompositorCapture=false;report.imageReadback='actual-application-canvas-without-ui';
   report.canvasReadback=await captureActualWorldCanvas(session,path,timeout);
   report.imageReadbacks??=[];report.imageReadbacks.push({file:basename(path),backend:report.imageReadback,compositorAttempted:false,canvas:report.canvasReadback});
   return;
  }
  let shot;
  try {shot=await Promise.race([
   session.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false,fromSurface:true}),
   new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Compositor screenshot timed out: '+basename(path))),timeout);}),
  ]);}catch(error){
   report.compositorReadbackPassed=false;report.compositorReadbackFailure={file:basename(path),error:String(error)};
   if(!canvasFallback)throw error;
   clearTimeout(timer);
   report.canvasReadback=await captureActualWorldCanvas(session,path,timeout);
   report.imageReadback='actual-application-canvas-without-ui';report.directCompositorCapture=false;
   report.imageReadbacks??=[];report.imageReadbacks.push({file:basename(path),backend:report.imageReadback,compositorPassed:false,compositorError:String(error),canvas:report.canvasReadback});
   if(report.imageEvidence&&basename(path)===report.imageEvidence.file)report.imageEvidence.readback=report.imageReadback;
   return;
  }
  await writeFile(path,Buffer.from(shot.data,'base64'));
  report.imageReadbacks??=[];report.imageReadbacks.push({file:basename(path),backend:'chromium-compositor',compositorPassed:true});
  report.compositorReadbackPassed=report.imageReadbacks.every(item=>item.compositorPassed);report.imageReadback='chromium-compositor';
 }finally{
  clearTimeout(timer);
  // A deadline may already have closed the browser; preserve the capture error.
  if(!borrowedSession)await session.detach().catch(()=>{});
 }
}
const contextForCapture=()=>page.context();
let captureSession,lastWorldData;
async function captureEvaluation(expression,timeout=150000){
 captureSession??=page.context().newCDPSession(page);const session=await captureSession;let timer;
 try{const response=await Promise.race([session.send('Runtime.evaluate',{expression,returnByValue:true}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Capture page operation timed out.')),timeout);})]);if(response.exceptionDetails)throw Error(response.exceptionDetails.text);return JSON.parse(response.result.value);}
 finally{clearTimeout(timer);}
}
async function data(timeout=150000){
 const value=fastInput?await captureEvaluation('JSON.stringify(document.querySelector(\'.ealdholt-preview[aria-hidden="false"] .ealdholt-world\')?.dataset??{})',timeout):await world().evaluate(e=>({...e.dataset}),undefined,{timeout});
 lastWorldData={readAt:new Date().toISOString(),data:value};return value;
}
// Actual DOM controls in the main page realm, with visible/enabled guards.
// No direct scene/camera access or utility-world execution during heavy frames.
async function activateWorld(selector,controlTimeout=150000){
 await until(remaining=>captureEvaluation(`JSON.stringify((()=>{const root=document.querySelector('.ealdholt-preview[aria-hidden="false"]');const b=root?.querySelector(${JSON.stringify(selector)});if(!b||b.disabled||!b.getClientRects().length||getComputedStyle(b).visibility==='hidden')return false;b.click();return true;})())`,Math.min(controlTimeout,remaining)),'visible actual village control '+selector,controlTimeout);
}
async function waitWorldControl(selector,present=true){
 await until(async()=>{
  const state=await captureEvaluation(`JSON.stringify((()=>{const root=document.querySelector('.ealdholt-preview[aria-hidden="false"]');const b=root?.querySelector(${JSON.stringify(selector)});return {present:!!b,visible:!!b&&!!b.getClientRects().length&&getComputedStyle(b).visibility!=='hidden',step:root?.dataset.ealdholtStep,drawer:root?.dataset.ealdholtDrawer,selectedView:root?.querySelector('.ealdholt-world')?.dataset.selectedView};})())`);
  report.lastControlState={selector,expectedVisible:present,...state};return present?state.visible:!state.visible;
 },'village control state '+selector);
}
async function closeViewsDrawer(){
 const selector='[data-ealdholt-tool-drawer="views"]';
 const visible=await captureEvaluation(`JSON.stringify((()=>{const drawer=document.querySelector('.ealdholt-preview[aria-hidden="false"]')?.querySelector(${JSON.stringify(selector)});return !!drawer&&!!drawer.getClientRects().length&&getComputedStyle(drawer).visibility!=='hidden';})())`);
 if(visible)await activateWorld(selector+' [data-ealdholt-drawer-close]');
 await waitWorldControl(selector,false);
}
async function skipStartupOpening(){
 const opening=page.locator('.opening-film[role="dialog"]');if(!await opening.count())return;
 report.startupOpeningPhase=await opening.getAttribute('data-opening-film');
 const skip=opening.getByRole('button',{name:'Skip',exact:true});
 await until(async()=>await skip.isVisible()&&await skip.isEnabled(),'visible opening Skip control',10000);
 if(fastInput)await skip.evaluate(button=>button.click());else await skip.click({noWaitAfter:true,timeout:10000});
 await until(async()=>await opening.count()===0,'startup opening closed through visible Skip',15000);
 report.startupOpeningSkipped=true;
}
async function activate(element,options={}){
 // The startup effect can mount the film just after the initial menu check.
 if(!fastInput){await skipStartupOpening();return element.click(options);}
 await until(async()=>{if(motion==='no-preference'&&!report.startupOpeningSkipped)await skipStartupOpening();return await element.isVisible()&&await element.isEnabled();},'enabled capture UI control',options.timeout??150000);
 await element.evaluate(button=>button.click());
}
async function until(read,label,timeout=150000){
 const at=Date.now(),end=at+timeout;console.log('WAIT',label);
 while(Date.now()<end){if(await read(Math.max(1,end-Date.now()))){console.log('READY',label,Date.now()-at);return;}await new Promise(r=>setTimeout(r,Math.min(250,Math.max(0,end-Date.now()))));}
 throw Error(label+' timed out');
}
async function inspectDaylightThroughUi(){
 const daylight=d=>actualWorldDaylight(JSON.parse(d.worldEnvironment??'null'));
 report.daylightUi={method:'visible observer speed buttons; no installed clock, weather or population state',attempts:[]};
 for(let attempt=0;attempt<2;attempt++){
  let d=await data();const entry={before:JSON.parse(d.worldEnvironment??'null')};report.daylightUi.attempts.push(entry);
  if(!daylight(d)){
   const observation=JSON.parse(d.populationObservation??'null');entry.observation=observation;
   const timing=daylightInspectionTiming(entry.before,observation);entry.timing=timing;
   const workDeadline=daylightInspectionWorkDeadline(timing,Date.now(),captureDeadlineAt);
   try{
    await activateWorld(`[data-observer-speed="${timing.speed}"]`,timing.actionTimeout);entry.accelerated=true;entry.acceleratedSpeed=timing.speed;
    await until(async remaining=>{d=await data(Math.min(timing.actionTimeout,remaining));const e=JSON.parse(d.worldEnvironment??'null');return e&&e.daylight>.8&&e.hour>=7&&e.hour<12;},'morning reached through normal observer time',Math.min(timing.timeout,workDeadline-Date.now()));
   }finally{
    // A failed morning wait must not leave the reused task profile at 16x.
    try{await activateWorld('[data-observer-speed="1"]',timing.actionTimeout);entry.normalSpeedRestored=true;}
    catch(error){entry.normalSpeedRestoreError=String(error);}
   }
   assert.equal(entry.normalSpeedRestored,true,'Normal observer speed could not be restored through its visible control.');
  }else await activateWorld('[data-observer-speed="1"]');
  const before=await data(),frame=Number(before.renderFrames);
  await until(async()=>{d=await data();return Number(d.renderFrames)>frame;},'a fresh world frame after returning to normal time',180000);
  entry.after=JSON.parse(d.worldEnvironment??'null');
  if(daylight(d)){report.daylightUi.passed=true;return;}
 }
 throw Error('Normal observer controls did not produce a confirmed daylight frame.');
}
try{
 const launch={headless:true,executablePath:process.env.CHROMIUM_PATH??'/usr/bin/chromium',args:['--disable-dev-shm-usage','--enable-unsafe-swiftshader',...(process.env.CROWNFALL_EALDHOLT_CAPTURE_DEBUG==='1'?['--remote-debugging-address=127.0.0.1','--remote-debugging-port=0']:[])]};
 let context;const profile=process.env.CROWNFALL_EALDHOLT_PROFILE_DIR;
 if(profile){const path=resolve(profile);assert.ok(basename(path).startsWith('crownfall-ealdholt-capture')&&relative(resolve(dirname(fileURLToPath(import.meta.url)),'../..'),path).startsWith('..'),'Use a dedicated capture profile outside the checkout.');const freshTaskProfile=process.env.CROWNFALL_EALDHOLT_FRESH_TASK_PROFILE==='1';await mkdir(path,{recursive:!freshTaskProfile,mode:0o700});report.freshTaskProfileCreated=freshTaskProfile;const marker=path+'/.crownfall-capture-profile';let content;try{content=await readFile(marker,'utf8');}catch(error){if(error.code!=='ENOENT')throw error;await writeFile(marker,'localhost-only capture profile\n',{flag:'wx',mode:0o600});content='localhost-only capture profile\n';}assert.equal(content,'localhost-only capture profile\n');context=await chromium.launchPersistentContext(path,{...launch,viewport,reducedMotion:motion});browser={close:()=>context.close()};report.persistentCaptureProfile=true;
 }else{browser=await chromium.launch(launch);context=await browser.newContext({viewport,reducedMotion:motion});}
 page=await context.newPage();report.extraCaptureTabsClosed=0;for(const extra of context.pages())if(extra!==page){await extra.close();report.extraCaptureTabsClosed++;}await page.bringToFront();page.setDefaultTimeout(150000);
 if(process.env.CROWNFALL_EALDHOLT_DECODER_FIXTURE){
  console.log('STAGE actual-asset-decoder-gpu-check');
  report.decoderProbe=await verifyEnvironmentDecoders(page,process.env.CROWNFALL_EALDHOLT_DECODER_FIXTURE,url.origin,{timeoutMs:120000});
  console.log('READY actual-asset-decoder-gpu-check',JSON.stringify(report.decoderProbe));
 }
 if(process.env.CROWNFALL_EALDHOLT_REQUIRE_UNBOUND_PROFILE==='1'&&report.freshTaskProfileCreated){report.taskProfilePopulation=[];report.taskProfileStorageEvidence='New task-owned profile directory created exclusively before browser launch; no saved world installed or erased.';}
 if(process.env.CROWNFALL_EALDHOLT_REQUIRE_UNBOUND_PROFILE==='1'&&!report.freshTaskProfileCreated){
  assert.ok(profile&&['127.0.0.1','localhost','[::1]'].includes(url.hostname),'Storage preflight is limited to the private task-owned loopback profile.');
  // The same-origin empty document reads this task profile before any game
  // script can advance a save. It neither installs nor deletes saved state.
  const probe=new URL('/__capture_storage_probe__',url).href;
  await page.route(probe,route=>route.fulfill({status:200,contentType:'text/html',body:'<!doctype html><title>Private capture storage check</title>'}));
  await page.goto(probe,{waitUntil:'domcontentloaded',timeout:30000});
  report.taskProfilePopulation=await page.evaluate(()=>Object.keys(localStorage).filter(key=>key.startsWith('crownfall.ealdholt.population.v1:')).map(key=>{
   try{const value=JSON.parse(localStorage.getItem(key)??'null');return {parseable:true,schemaVersion:value?.schemaVersion,
    boundNavigation:!!value?.navigation?.profile||!!value?.navigationOther?.profile};}
   catch{return {parseable:false,boundNavigation:true};}
  }));
  await page.unroute(probe);
  assert.equal(report.taskProfilePopulation.length,0,'Preserve this task profile: a population save already exists. Select a fresh task-owned profile and use ordinary entry; never clear or reset its people.');
 }
 page.on('pageerror',e=>report.errors.push(e.message));
 page.on('console',m=>{if(['warning','error'].includes(m.type())&&/WebGL|GL_INVALID|GL_OUT_OF_MEMORY|gl\.draw|vertexAttrib/i.test(m.text())){
  report.graphicsMessages??=[];if(report.graphicsMessages.length<12)report.graphicsMessages.push(m.text().slice(0,2000));console.log('GRAPHICS',m.text().slice(0,2000));
 }});
 page.on('console',m=>{if(m.type()==='error'&&/THREE.WebGLProgram|VALIDATE_STATUS|Shader Error|ERROR: 0:|World shader compilation failed/.test(m.text()))report.errors.push(m.text().slice(0,2400));});
 page.on('console',m=>{if(m.type()==='warning'&&/Source vegetation cell retains/.test(m.text())&&report.warnings.length<8)report.warnings.push(m.text().slice(0,800));});
 await page.addInitScript(({quality,renderScale,animated})=>localStorage.setItem('crownfall.main-game.preferences',JSON.stringify({quality,renderScale,motion:animated,volume:65,showHints:true})),{quality,renderScale,animated:motion==='no-preference'});
 console.log('STAGE normal-menu');await page.goto(url.href,{waitUntil:'domcontentloaded',timeout:150000});
 await until(async()=>{
  // Fresh normal-motion visits show the startup film above an inert menu.
  // Use its supported visible control rather than changing saved film state.
  await skipStartupOpening();
  const opening=page.locator('.opening-film[role="dialog"]');
  const loading=page.locator('.loading-screen');
  if(await loading.count()){
   const continuation=loading.getByRole('button',{name:'Continue to menu',exact:false});
   if(await continuation.isVisible()&&await continuation.isEnabled()){
    report.bootContinuation={state:await loading.getAttribute('data-loading-state'),status:await loading.getByRole('status').innerText()};
    try {await activate(continuation,{noWaitAfter:true,timeout:2000,force:fastInput});} catch (error) {
     // The supported continuation may disappear/change while model boot
     // completes. Re-read the menu/loading state within the bounded outer wait.
     if(error.name!=='TimeoutError'&&await loading.count())throw error;
    }
   }
  }
  return await readyMenu().count()>0&&await loading.count()===0&&await opening.count()===0;
 },'normal menu or its supported slow-load continuation');
 await activate(page.getByRole('tab',{name:'Home',exact:true}),{force:fastInput,noWaitAfter:true});await activate(page.getByRole('button',{name:'My Legacy',exact:true}),{force:fastInput,noWaitAfter:true});
 await root().waitFor();let bootLogAt=0,initial;
 const rootState=async()=>fastInput?captureEvaluation('JSON.stringify((root=>({...root?.dataset,worldData:{...root?.querySelector(\'.ealdholt-world\')?.dataset}}))(document.querySelector(\'.ealdholt-preview[aria-hidden="false"]\')))'):{ealdholtStep:await root().getAttribute('data-ealdholt-step'),ealdholtBusy:await root().getAttribute('data-ealdholt-busy')};
 await until(async()=>{const d=await data();if(d.initialWoodlandPreparation&&Date.now()-bootLogAt>15000){console.log('INITIAL-WOODLAND',d.initialWoodlandPreparation,d.treeHlod,d.farTreeHlod,d.worldPreparation);bootLogAt=Date.now();}
  if(d.modelReady==='true'){initial=d;return true;}return false;},'real environment with initial tree detail prepared',captureLimit>900000?600000:300000);
 console.log('STAGE model-ready',initial.modelProfile,initial.treeHlod,initial.farTreeHlod,initial.sourceVegetationHlod,initial.vegetationResources,initial.worldPreparation);
 if(singlePopulatedWell){
  const submitted=JSON.parse(initial.worldGpuFrame??'null')?.submitted;
  assert.ok(Number.isSafeInteger(submitted)&&submitted>0);
  await until(async()=>{const d=await data(),gpu=JSON.parse(d.worldGpuFrame??'null');return gpu?.completed>=submitted&&!gpu.failures;},'completed existing observer frame before Well navigation',150000);
  const d=await data();report.preWellWorld={};
  for(const key of ['modelProfile','modelFile','populationSourceSha256','populationSiteSha256','selectedView','cameraPosition','cameraTarget','worldGpuFrame','regionalForest','regionalWoodland','regionalLandmarks','sourceVegetationHlod','terrainStreaming','worldEnvironment','voxelGI','populationStatus','populationError','populationRegistered','populationSelected','populationDrawn','populationReady','populationSnapshot','populationObservation','populationLife']){
   try{report.preWellWorld[key]=JSON.parse(d[key]);}catch{report.preWellWorld[key]=d[key];}
  }
  await writeFile(dir+'/pre-well-world.json',JSON.stringify(report.preWellWorld,null,2));
  console.log('STAGE actual-pre-well-data',JSON.stringify({view:d.selectedView,forest:report.preWellWorld.regionalForest,drawn:d.populationDrawn}));
 }
 if(captureModelReady){
  const initialGpu=JSON.parse(initial.worldGpuFrame??'null'),submitted=initialGpu?.submitted;
  assert.ok(Number.isSafeInteger(submitted)&&submitted>0,'The prepared GLB world must have submitted a real frame.');
  report.imageEvidence={file:'model-ready.png',phase:(await rootState()).ealdholtStep==='village'?'current-observer-village':'pre-entry-current-world',selectedView:initial.selectedView,villagersVerified:false,populationDrawn:Number(initial.populationDrawn??0),worldGpuFrame:initialGpu};
  console.log('STAGE wait-model-ready-gpu-frame',submitted);
  await until(async()=>{const d=await data(),gpu=JSON.parse(d.worldGpuFrame??'null');report.imageEvidence.lastGpuFrame=gpu;
   if(gpu?.failures)throw Error('Prepared-world GPU frame failed.');
   return d.selectedView===initial.selectedView&&gpu?.completed>=submitted;
  },'completion of the exact prepared-world GPU frame before readback',150000);
  console.log('STAGE capture-current-model-ready-world');await screenshot(dir+'/model-ready.png',45000);report.imageEvidence.written=true;
 }
 const entryState=await rootState();report.entryStep=entryState.ealdholtStep;
 if(entryView&&entryState.ealdholtStep==='intro'){
  assert.equal(fastInput,true);
  console.log('STAGE inspect-before-entry',entryView);report.entryViewBeforeConfirmation=entryView;
  await activateWorld('[data-ealdholt-intro-visit]');
  await until(async()=>(await rootState()).ealdholtStep==='village','normal preview visit');
  report.entryViewAlreadySelected=(await data()).selectedView===entryView;
  if(!report.entryViewAlreadySelected){
   await activateWorld('[data-ealdholt-tool="views"]');await waitWorldControl('[data-ealdholt-tool-drawer="views"]');
   await activateWorld(`[data-ealdholt-view="${entryView}"]`);
   await until(async()=>(await data()).selectedView===entryView,'rendered inspection before the saved village epoch');
  }
  await closeViewsDrawer();
  await activateWorld('[data-ealdholt-banner-edit]');
  await until(async()=>(await rootState()).ealdholtStep==='banner','normal banner choice');
  await activateWorld('[data-ealdholt-preset]');await activateWorld('[data-ealdholt-confirm]');
 }else if(entryState.ealdholtStep==='intro'){console.log('STAGE confirm-inherited-entry');if(fastInput){await activateWorld('[data-ealdholt-intro-continue]');await activateWorld('[data-ealdholt-preset]');await activateWorld('[data-ealdholt-confirm]');}else{await activate(control('[data-ealdholt-intro-continue]'),{noWaitAfter:true});await activate(control('[data-ealdholt-preset]').first(),{noWaitAfter:true});await activate(control('[data-ealdholt-confirm]'),{noWaitAfter:true});}}
 else{assert.equal(entryState.ealdholtStep,'village','Capture needs normal observer entry or the existing inherited-entry UI.');report.existingVillageSessionPreserved=true;console.log('STAGE preserve-current-observer-village');}
 if(entryState.ealdholtStep!=='village'||entryState.ealdholtBusy!=='false')await until(async()=>{const d=await rootState();return d.ealdholtStep==='village'&&d.ealdholtBusy==='false';},'inherited confirmation');
 if(daylightThroughUi){await activateWorld('[data-observer-speed="1"]');report.entryNormalSpeedRestored=true;}
 console.log('STAGE population-site-ready');
 const entryWorld=entryState.worldData??initial;
 if(!populationNavigationReady(entryWorld))await until(async()=>{const d=await data();report.lastPopulationNavigation={status:d.populationStatus,error:d.populationError,registered:Number(d.populationRegistered),ready:Number(d.populationReady),drawn:Number(d.populationDrawn),selectedView:d.selectedView};return populationNavigationReady(d);},'actual population site before authored-view navigation');
 else report.lastPopulationNavigation={status:entryWorld.populationStatus,registered:Number(entryWorld.populationRegistered),selectedView:entryWorld.selectedView,evidence:'same atomic current-entry DOM sample'};
 for(const id of views){
  const current=singleEnvironmentView?entryWorld:await data();
  console.log('STAGE view-'+id);if(current.selectedView!==id){if(fastInput)await activateWorld('[data-ealdholt-tool="views"]');else await activate(control('[data-ealdholt-tool="views"]'),{noWaitAfter:true});if(fastInput)await waitWorldControl('[data-ealdholt-tool-drawer="views"]');else await control('[data-ealdholt-tool-drawer="views"]').waitFor();
  if(fastInput)await activateWorld(`[data-ealdholt-view="${id}"]`);else await activate(control(`[data-ealdholt-view="${id}"]`),{noWaitAfter:true});
  // The actual view control closes its own drawer. Do not wait for actor assets
  // from the previous camera before completing this normal UI navigation.
  await closeViewsDrawer();}
  if(!environmentOnly)await until(async()=>{const d=await data(),s=JSON.parse(d.populationSnapshot??'null');report.lastPopulation={status:d.populationStatus,error:d.populationError,drawn:Number(d.populationDrawn),ready:Number(d.populationReady),snapshot:s};return d.selectedView===id&&Number(d.populationDrawn)>=minimumDrawn&&s&&s.crowd.loading===0&&s.household.loading===0&&s.crowd.actorSets+s.household.actorSets>0;},'at least '+minimumDrawn+' actual posed residents before '+id+' capture');
  if(process.env.CROWNFALL_EALDHOLT_ELEVATED==='1'&&id==='overview'){
   await activate(control('[data-ealdholt-tool="camera"]'));const buttons=control('.ealdholt-view-controls button');
   const pose=await data(),steps=Math.round((.65-Number(pose.cameraPitch))/(.12*1.4));
   if(fastInput){await buttons.evaluateAll((items,{steps})=>{if(items.some(button=>button.disabled))throw Error('Camera controls disabled.');for(let i=0;i<Math.abs(steps);i++)items[steps<0?2:3].click();for(let i=0;i<6;i++)items[5].click();},{steps});}else{for(let i=0;i<Math.abs(steps);i++)await activate(buttons.nth(steps<0?2:3));for(let i=0;i<6;i++)await activate(buttons.nth(5));}
   await activate(control('[data-ealdholt-tool-drawer="camera"] [data-ealdholt-drawer-close]'));report.raisedCamera=true;
  }
  if(process.env.CROWNFALL_EALDHOLT_ORBIT_EAST==='1'&&id==='riverside'){
   if(fastInput){await activate(control('[data-ealdholt-tool="camera"]'));const pose=await data();let delta=-Math.PI/2-Number(pose.cameraYaw);while(delta>Math.PI)delta-=2*Math.PI;while(delta< -Math.PI)delta+=2*Math.PI;const steps=Math.round(delta/(.18*1.7));await control('.ealdholt-view-controls button').evaluateAll((items,{steps})=>{if(items.some(button=>button.disabled))throw Error('Camera controls disabled.');for(let i=0;i<Math.abs(steps);i++)items[steps<0?0:1].click();},{steps});await activate(control('[data-ealdholt-tool-drawer="camera"] [data-ealdholt-drawer-close]'));}
   else for(let attempt=0;attempt<4;attempt++){
    const pose=await data(),box=await world().boundingBox();assert.ok(box);
    let yawDelta=Number(pose.cameraYaw)+Math.PI/2;
    while(yawDelta>Math.PI)yawDelta-=2*Math.PI;while(yawDelta< -Math.PI)yawDelta+=2*Math.PI;
    if(Math.abs(yawDelta)<.15)break;
    const x=box.x+box.width/2,y=box.y+box.height/2,rotateSpeed=.55;
    const dx=(fastInput?yawDelta*box.height/(2*Math.PI*rotateSpeed):Math.max(-box.width*.36,Math.min(box.width*.36,yawDelta*box.height/(2*Math.PI*rotateSpeed))));
    const dy=Math.max(-box.height*.25,Math.min(box.height*.25,(Number(pose.cameraPitch)-(Math.PI/2-.1))*box.height/(2*Math.PI*rotateSpeed)));
    await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+dx,y+dy,{steps:1});await page.mouse.up();
    await until(async()=>Number((await data()).renderFrames)>Number(pose.renderFrames),'rendered orbit input');
   }
   await until(async()=>{const d=await data();return Math.abs(Number(d.cameraYaw)+Math.PI/2)<.16;},'east-facing view through normal orbit input');
  }
  if(id==='well'&&process.env.CROWNFALL_EALDHOLT_REQUIRE_WELL_PEOPLE==='1')await until(async()=>Number((await data()).populationDrawn)>0,'actual people drawn in the courtyard');
  const prepared=await data();
  if(requireWoodlandGround){
   const layers=JSON.parse(prepared.valleyGroundLayers??'null');
   report.valleyGround={mode:prepared.valleyGroundMode,artVersion:prepared.valleyArtVersion,layers,
    source:prepared.valleyGrassSource,textureCount:Number(prepared.valleyGrassTextureCount),textureBytes:Number(prepared.valleyGrassTextureBytesEstimate)};
   assert.equal(prepared.valleyGroundMode,'woodland','An available legacy grass fallback does not prove new ground integration.');
   assert.equal(prepared.valleyArtVersion,'grounded-bank-earth-grass-rock-v4');
   assert.equal(layers?.meadow,'ready');assert.equal(layers?.bank,'ready');
   assert.equal(prepared.valleyGrassSource,'forrest_ground_01');assert.equal(Number(prepared.valleyGrassTextureCount),5);
  }
  // Preserve a real current-view image before optional acceptance waits. A
  // software GPU can exhaust their deadline; the raw image is explicitly
  // diagnostic and never substitutes for a passed validation report.
  if(canvasOnly){
   console.log('STAGE diagnostic-actual-canvas',id);
   await screenshot(dir+'/'+id+'-before-validation.png',45000);
   report.diagnosticImage={file:id+'-before-validation.png',accepted:false,selectedView:prepared.selectedView,
    evidence:'Actual application canvas before optional environment acceptance gates; no UI.'};
   await writeFile(dir+'/verification-progress.json',JSON.stringify(report,null,2));
  }
  if(process.env.CROWNFALL_EALDHOLT_WAIT_HLOD==='1'){
   if(!fastInput&&!captureModelReady)await screenshot(dir+'/'+id+'-before-bake.png');
   report.populationBeforeBake={drawn:Number(prepared.populationDrawn),ready:Number(prepared.populationReady),snapshot:JSON.parse(prepared.populationSnapshot)};
  }
 if(process.env.CROWNFALL_EALDHOLT_WAIT_HLOD==='1'){
  console.log('STAGE source-derived-tree-hlod');
  let hlodLogAt=0;
  await until(async()=>{const d=await data();report.lastHlod={tree:d.treeHlod,far:d.farTreeHlod,cells:d.sourceVegetationHlod,ground:d.grassGroundField,pool:d.vegetationResources,queue:d.worldPreparation};if(JSON.parse(d.worldWebglErrors??'[]').length)throw Error('World WebGL error: '+d.worldWebglErrors);if(Date.now()-hlodLogAt>15000){console.log('HLOD',d.treeHlod,d.farTreeHlod,d.sourceVegetationHlod,d.grassGroundField,d.vegetationResources,d.worldPreparation);hlodLogAt=Date.now();}const trees=[d.treeHlod,d.farTreeHlod].filter(Boolean).map(s=>JSON.parse(s));for(const tree of trees)if(tree.status==='error')throw Error(tree.error);const cells=JSON.parse(d.sourceVegetationHlod??'null');if(cells?.errors.length)throw Error(cells.errors.join('; '));const ground=JSON.parse(d.grassGroundField??'null');if(ground?.status==='error')throw Error(ground.error);return trees.length===(d.modelProfile==='quest'?1:2)&&trees.every(tree=>tree.status==='ready'&&tree.readyMask===15)&&(!cells||cells.ready===cells.cells);},'all four source-derived vegetation levels',captureLimit>900000?1200000:600000);
 }


 if(process.env.CROWNFALL_EALDHOLT_WAIT_TERRAIN==='1'){
  console.log('STAGE authored-terrain-streaming');
  let terrainLogAt=0;
  await until(async()=>{const d=await data();if(d.terrainStreamingError)throw Error(d.terrainStreamingError);const terrain=JSON.parse(d.terrainStreaming??'null');report.lastTerrain=terrain;if(Date.now()-terrainLogAt>15000){console.log('TERRAIN',JSON.stringify(terrain));terrainLogAt=Date.now();}if(terrain?.errors.length)throw Error(terrain.errors.join('; '));if(JSON.parse(d.worldWebglErrors??'[]').length)throw Error('World WebGL error: '+d.worldWebglErrors);return terrain?.status==='ready'&&terrain.sources>0&&terrain.publishedSources===terrain.sources&&terrain.pending===0;},'authored terrain pages resident',450000);
 }
 if(process.env.CROWNFALL_EALDHOLT_WAIT_GI==='1'){
  console.log('STAGE world-voxel-gi');let giLogAt=0;
  await until(async()=>{const d=await data();const gi=JSON.parse(d.voxelGI??'null');report.lastVoxelGI=gi;if(Date.now()-giLogAt>15000){console.log('VOXEL',JSON.stringify(gi));giLogAt=Date.now();}if(gi?.error)throw Error(gi.error);if(quality==='low'&&gi?.status==='low-ambient-fallback')return gi.lowAmbientFallback&&gi.materialProgramsPending===0;if(JSON.parse(d.worldWebglErrors??'[]').length)throw Error('World WebGL error: '+d.worldWebglErrors);return gi?.status==='ready'&&gi.staticBuilds>0&&gi.relights>0&&gi.materials>0&&gi.materialProgramsPending===0;},'actual world voxel GI',300000);
 }
 if(process.env.CROWNFALL_EALDHOLT_WAIT_REGIONAL_FOREST==='1'&&id==='riverside'){
  console.log('STAGE regional-woodland');let forestLogAt=0;
  await until(async()=>{const d=await data(),forest=JSON.parse(d.regionalWoodland??'null');report.lastRegionalWoodland=forest;
   if(Date.now()-forestLogAt>15000){console.log('FOREST',JSON.stringify(forest));forestLogAt=Date.now();}
   if(forest?.error)throw Error(forest.error);return forest?.status==='ready'&&forest.readyMask===15&&forest.activeActors>0;},'regional forest in the actual world',captureLimit>900000?900000:600000);
 }
 if(process.env.CROWNFALL_EALDHOLT_WAIT_REGIONAL_WORLD==='1'){
  console.log('STAGE source-regional-world');let regionalLogAt=0;
  await until(async()=>{const d=await data(),forest=JSON.parse(d.regionalForest??'null'),landmarks=JSON.parse(d.regionalLandmarks??'null');
   report.lastRegionalForest=forest;report.lastRegionalLandmarks=landmarks;
   if(Date.now()-regionalLogAt>15000){console.log('REGIONAL',JSON.stringify({forest,landmarks,resources:d.regionalForestResources,queue:d.worldPreparation}));regionalLogAt=Date.now();}
   if(forest?.error||landmarks?.error)throw Error(forest?.error||landmarks?.error);
   return forest?.status==='ready'&&(!process.env.CROWNFALL_EALDHOLT_EXPECT_PLACEMENT_VERSION||forest.placementVersion===process.env.CROWNFALL_EALDHOLT_EXPECT_PLACEMENT_VERSION)&&forest.actors===56287&&forest.visibleActors>0&&landmarks?.status==='ready'&&landmarks.loaded===2;
  },'converted forest and landmarks in the actual village',900000);
 }
 if(process.env.CROWNFALL_EALDHOLT_WAIT_REGIONAL_DETAIL==='1'){
  await until(async()=>{const d=await data(),forest=JSON.parse(d.regionalForest??'null');report.lastRegionalDetail=forest;
   return regionalDetailCaptureReady(forest);
  },'all requested nearby woodland cells ready without source fallback',600000);
 }
 if(process.env.CROWNFALL_EALDHOLT_WAIT_WEATHER==='1'){
  await until(async()=>{const d=await data(),weather=JSON.parse(d.worldEnvironment??'null');report.lastWorldEnvironment=weather;
   if(weather?.error)throw Error(weather.error);return weather?.status==='ready'&&weather.cloudBytes>0&&weather.clock==='existing-persisted-village-clock';
  },'clock-driven weather and cached cloud density in the actual village',120000);
 }
 if(verifyWind)await until(async()=>{const d=await data(),environment=JSON.parse(d.worldEnvironment??'null');report.windPreparation=environment;
  if(environment?.surfaceWeatherError)throw Error(environment.surfaceWeatherError);
  return environment?.activeWindMaterialSlots>0&&environment.windStrength>0
   &&environment.activeWindReadyMaterialSlots===environment.activeWindMaterialSlots&&!environment.colourBudgetHeld;
 },'compiled wind materials in the actual village',captureLimit>900000?900000:300000);
 if(process.env.CROWNFALL_EALDHOLT_WAIT_HORIZON==='1'){
  await until(async()=>{const d=await data(),h=JSON.parse(d.regionalHorizon??'null');if(h?.error)throw Error(h.error);return h?.status==='ready';},'regional mountain scenery in the actual world',180000);
 }

  if(process.env.CROWNFALL_EALDHOLT_WAIT_DRESSING==='1')await until(async()=>{const d=await data(),f=JSON.parse(d.regionalForest??'null');report.lastDressing=f;return f?.status==='ready'&&f.actors===56287&&f.shrubs===8192&&f.renderedFarTrees>0&&f.renderedFarShrubs>0&&f.rocks?.placed===4096&&f.rocks.renderedRocks>0&&f.forestFloor?.status==='ready';},'actual tree, shrub, rock and litter submissions',300000);
  if(process.env.CROWNFALL_EALDHOLT_WAIT_CANOPIES==='1')await until(async()=>{const d=await data(),f=JSON.parse(d.regionalForest??'null');report.lastCanopies=f;const state=canopyCaptureState(f,{overview:id==='overview',requireComplete:process.env.CROWNFALL_EALDHOLT_REQUIRE_COMPLETE_CANOPIES==='1'});report.canopyEvidence=state;if(state.degraded&&!report.warnings.includes(state.error))report.warnings.push(state.error);return state.ready;},'source-derived overhead canopy captures or explicit degraded fallback',300000);
  if(process.env.CROWNFALL_EALDHOLT_WAIT_GROUNDCOVER==='1'&&id==='overview')await until(async()=>{const d=await data(),f=JSON.parse(d.regionalForest??'null');report.groundDressing=f;return f?.groundcover?.status==='ready'&&f.groundcover.placed>0&&f.groundcover.renderedGrass>0&&f.rocks?.renderedRocks>0&&f.renderedFarShrubs>0;},'source grass, scanned rocks and shrubs in an actual rendered frame',300000);
  if(process.env.CROWNFALL_EALDHOLT_WAIT_VILLAGE_EDGE==='1'&&id==='overview')await until(async()=>{const d=await data(),f=JSON.parse(d.regionalForest??'null');report.villageEdge=f;return f?.status==='ready'&&f.placementVersion===process.env.CROWNFALL_EALDHOLT_EXPECT_PLACEMENT_VERSION&&f.treesWithin20mOfVillage>=Number(process.env.CROWNFALL_EALDHOLT_MIN_EDGE_TREES??1)&&f.renderedFarTrees>0&&f.renderedFarShrubs>0&&f.detailCells>=Number(process.env.CROWNFALL_EALDHOLT_MIN_EDGE_DETAIL_CELLS??0);},'current village-edge placement in an actual rendered frame',300000);
  if(daylightThroughUi)await inspectDaylightThroughUi();
  const frameState=await data(),requestedFrame=JSON.parse(frameState.worldGpuFrame??'null')?.submitted;
  assert.ok(Number.isSafeInteger(requestedFrame)&&requestedFrame>0&&frameState.selectedView===id,'The selected view must have submitted a real frame.');
  // Streaming/animation can keep another frame in flight indefinitely. Wait
  // for completion of this actual selected-view submission, not GPU idleness.
  await until(async()=>{const d=await data();const gate=JSON.parse(d.worldGpuFrame??'null');return d.selectedView===id&&gate&&gate.completed>=requestedFrame&&gate.failures===0;},'completed selected-view GPU frame',150000);
  if(process.env.CROWNFALL_EALDHOLT_VERIFY_CLOUD_PHASE==='1'){
   assert.equal(motion,'no-preference');const before=JSON.parse(frameState.worldEnvironment??'null');
   assert.ok(before?.cloudBytes>0,'Cloud phase verification needs actual uploaded density.');let next;
   await until(async()=>{next=await data();const weather=JSON.parse(next.worldEnvironment??'null'),gpu=JSON.parse(next.worldGpuFrame??'null');return weather?.cloudMotionSeconds>before.cloudMotionSeconds+.5&&gpu?.completed>requestedFrame;},'cloud phase advanced on a subsequent completed world frame',45000);
   const after=JSON.parse(next.worldEnvironment);assert.notDeepEqual(after.cloudOffset,before.cloudOffset);
   assert.equal(after.cloudDensityBuilds,before.cloudDensityBuilds);assert.equal(after.cloudDensityRestores,before.cloudDensityRestores);
   report.cloudPhase={before,after,gpu:JSON.parse(next.worldGpuFrame),additionalDensityBuilds:0};
  }
  const captureThisView=!captureModelReady||(capturePopulatedWell&&id==='well');
  const d=canvasOnly?frameState:await data();if(captureThisView)await screenshot(dir+'/'+id+'.png',captureModelReady?45000:150000);
  // Readback can take long enough for a real schedule boundary to pass. Do
  // not certify the PNG using only counters sampled before that readback.
  const afterCapture=await data();
  assert.equal(afterCapture.selectedView,id,'The selected view changed during screenshot readback.');
  if(!environmentOnly&&captureThisView){
   const beforePeople=JSON.parse(d.populationSnapshot??'null'),afterPeople=JSON.parse(afterCapture.populationSnapshot??'null');
   const readback=report.imageReadbacks?.[report.imageReadbacks.length-1];
   if(readback?.canvas)assert.ok(readback.canvas.populationDrawn>=minimumDrawn,'The actual canvas frame did not report the required resident count.');
   else{assert.ok(Number(afterCapture.populationDrawn)>=minimumDrawn,'Residents left the captured view during screenshot readback.');
    assert.equal(afterPeople?.visualRevision,beforePeople?.visualRevision,'Resident schedules changed during screenshot readback; the image needs a new capture.');}
   if(captureModelReady)report.populatedWellEvidence={file:id+'.png',before:Number(d.populationDrawn),after:Number(afterCapture.populationDrawn),readback};
  }
  if(verifyWind){
   const before=JSON.parse(afterCapture.worldEnvironment),gpu=JSON.parse(afterCapture.worldGpuFrame);let next;
   await until(async()=>{next=await data();const environment=JSON.parse(next.worldEnvironment),frame=JSON.parse(next.worldGpuFrame);
    if(environment.surfaceWeatherError||frame.failures)throw Error(environment.surfaceWeatherError||'Wind frame failed.');
    return environment.cloudMotionSeconds>before.cloudMotionSeconds+.05&&frame.completed>gpu.completed;
   },'a later completed wind frame on the unchanged authored camera',120000);
   assert.equal(next.selectedView,id);assert.equal(next.cameraPosition,afterCapture.cameraPosition);assert.equal(next.cameraTarget,afterCapture.cameraTarget);
   report.windFrames={before,after:JSON.parse(next.worldEnvironment),gpu:JSON.parse(next.worldGpuFrame),cameraUnchanged:true,
    evidence:'Compiled material and completed-frame state; visible quality requires image review.'};
   await screenshot(dir+'/'+id+'-wind-motion.png',45000);
  }
  if(process.env.CROWNFALL_EALDHOLT_WAIT_CLOUD_MOTION==='1'&&id==='riverside'){
   assert.equal(motion,'no-preference');const before=JSON.parse(d.worldEnvironment),beforeGpu=JSON.parse(d.worldGpuFrame);let next;
   await until(async()=>{next=await data();const weather=JSON.parse(next.worldEnvironment??'null'),gpu=JSON.parse(next.worldGpuFrame??'null');return weather?.cloudMotionSeconds>before.cloudMotionSeconds+.5&&gpu?.completed>=beforeGpu.submitted+1;},'moving clouds and a subsequent completed world frame',300000);
   const after=JSON.parse(next.worldEnvironment);assert.notDeepEqual(after.cloudOffset,before.cloudOffset);assert.equal(after.cloudDensityBuilds,before.cloudDensityBuilds);assert.equal(after.cloudDensityRestores,before.cloudDensityRestores);
   if(!captureModelReady)await screenshot(dir+'/'+id+'-motion.png');report.cloudMotion={before,after,gpu:JSON.parse(next.worldGpuFrame),additionalDensityBuilds:0};
  }
  assert.deepEqual(JSON.parse(d.worldWebglErrors??'null'),[],'Actual world must report no WebGL errors.');
  if(quality==='low')assert.equal(d.localPointLightCount,'0','Low retains its zero-practical-light budget at every viewpoint.');
  const s=JSON.parse(d.populationSnapshot);assert.equal(d.populationRegistered,'100');assert.equal(d.populationFailed,'0');
  report.views.push({id,registered:100,drawn:Number(d.populationDrawn),ready:Number(d.populationReady),selected:s.selected,counts:s.counts,held:s.heldReasons,model:d.modelFile,sourceSha256:d.populationSourceSha256,siteSha256:d.populationSiteSha256,renderFrames:d.renderFrames,renderTriangles:Number(d.renderTriangles),woodlandSpatialVisibility:JSON.parse(d.woodlandSpatialVisibility??'null'),farWoodlandSpatialVisibility:JSON.parse(d.farWoodlandSpatialVisibility??'null'),treeHlod:JSON.parse(d.treeHlod??'null'),farTreeHlod:JSON.parse(d.farTreeHlod??'null'),sourceVegetationHlod:JSON.parse(d.sourceVegetationHlod??'null'),grassGroundField:JSON.parse(d.grassGroundField??'null'),vegetationResources:JSON.parse(d.vegetationResources??'null'),worldPreparation:JSON.parse(d.worldPreparation??'null'),worldGpuFrame:JSON.parse(d.worldGpuFrame??'null')});
  report.views[report.views.length-1].terrainStreaming=JSON.parse(d.terrainStreaming??'null');
  report.views[report.views.length-1].worldEnvironment=JSON.parse(d.worldEnvironment??'null');report.views[report.views.length-1].worldRain=JSON.parse(d.worldRain??'null');
  report.views[report.views.length-1].valleyGround={mode:d.valleyGroundMode,artVersion:d.valleyArtVersion,
   layers:JSON.parse(d.valleyGroundLayers??'null'),source:d.valleyGrassSource,textureCount:Number(d.valleyGrassTextureCount??0),textureBytes:Number(d.valleyGrassTextureBytesEstimate??0),pondProbeArtStatus:d.pondProbeValleyArtStatus};
  report.views[report.views.length-1].regionalForest=JSON.parse(d.regionalForest??'null');report.views[report.views.length-1].regionalLandmarks=JSON.parse(d.regionalLandmarks??'null');
  report.views[report.views.length-1].worldWebglErrors=JSON.parse(d.worldWebglErrors??'null');
  report.views[report.views.length-1].voxelGI=JSON.parse(d.voxelGI??'null');
  report.views[report.views.length-1].regionalWoodland=JSON.parse(d.regionalWoodland??'null');
  report.views[report.views.length-1].regionalHorizon=JSON.parse(d.regionalHorizon??'null');
  report.views[report.views.length-1].camera={position:JSON.parse(d.cameraPosition),target:JSON.parse(d.cameraTarget),yaw:Number(d.cameraYaw),pitch:Number(d.cameraPitch)};
  console.log('CAPTURED',id,'drawn',d.populationDrawn,'ready',d.populationReady);
 }
 if(process.env.CROWNFALL_EALDHOLT_VERIFY_WARM_GI==='1'){
  const cold=await data(),coldGI=JSON.parse(cold.voxelGI??'null');
  assert.ok(coldGI?.status==='ready'&&coldGI.cache?.writes>0,'Cold scene must persist an actual static volume before warm restoration is tested.');
  report.coldWorldCache=coldGI;
  report.coldVegetationCache=JSON.parse(cold.vegetationResources??'null')?.persistent??null;report.coldRegionalCache=JSON.parse(cold.regionalForestResources??'null')?.persistent??null;report.coldCloudCache=JSON.parse(cold.worldEnvironment??'null')?.cache??null;
  if(process.env.CROWNFALL_EALDHOLT_VERIFY_WARM_VEGETATION==='1')assert.ok(report.coldVegetationCache?.writes>0,'Cold scene must persist actual source atlases.');
  console.log('STAGE reload-for-warm-world-cache');
  await page.reload({waitUntil:'domcontentloaded',timeout:150000});
  await until(async()=>{
   await skipStartupOpening();
   return await readyMenu().count()>0&&await page.locator('.loading-screen').count()===0&&await page.locator('.opening-film[role="dialog"]').count()===0;
  },'reloaded interactive menu',180000);
  await activate(page.getByRole('tab',{name:'Home',exact:true}),{force:fastInput,noWaitAfter:true});await activate(page.getByRole('button',{name:'My Legacy',exact:true}),{force:fastInput,noWaitAfter:true});
  await root().waitFor();
  await until(async()=>{const d=await data();return d.modelReady==='true';},'reloaded real environment',600000);
  const rootState=async()=>fastInput?captureEvaluation('JSON.stringify(document.querySelector(\'.ealdholt-preview[aria-hidden="false"]\')?.dataset??{})'):{ealdholtStep:await root().getAttribute('data-ealdholt-step'),ealdholtBusy:await root().getAttribute('data-ealdholt-busy')};
 if((await rootState()).ealdholtStep==='intro'){
   await activate(control('[data-ealdholt-intro-continue]'),{force:fastInput,noWaitAfter:true});await activate(control('[data-ealdholt-preset]').first(),{force:fastInput,noWaitAfter:true});await activate(control('[data-ealdholt-confirm]'),{force:fastInput,noWaitAfter:true});
  }
  await until(async()=>await root().getAttribute('data-ealdholt-step')==='village','reloaded inherited village');
  if(fastInput)await activateWorld('[data-ealdholt-tool="views"]');else await activate(control('[data-ealdholt-tool="views"]'),{noWaitAfter:true});if(fastInput)await waitWorldControl('[data-ealdholt-tool-drawer="views"]');else await control('[data-ealdholt-tool-drawer="views"]').waitFor();
  await activate(control(`[data-ealdholt-view="${views.at(-1)}"]`),{noWaitAfter:true,force:fastInput});

  // The original save and naturally advancing clock are retained; no view,
  // character state or cache record is installed by the harness.
  await until(async()=>{const d=await data(),gi=JSON.parse(d.voxelGI??'null');report.warmWorldCache=gi;
   report.warmVegetationCache=JSON.parse(d.vegetationResources??'null')?.persistent??null;report.warmRegionalCache=JSON.parse(d.regionalForestResources??'null')?.persistent??null;report.warmEnvironment=JSON.parse(d.worldEnvironment??'null');
   if(gi?.error)throw Error(gi.error);return gi?.status==='ready'&&gi.restoredStaticVolumes>0&&gi.cache?.hits>0
    &&(process.env.CROWNFALL_EALDHOLT_VERIFY_WARM_VEGETATION!=='1'||report.warmVegetationCache?.hits>0)
    &&(process.env.CROWNFALL_EALDHOLT_WAIT_REGIONAL_WORLD!=='1'||report.warmRegionalCache?.hits>=15)
    &&(process.env.CROWNFALL_EALDHOLT_WAIT_WEATHER!=='1'||report.warmEnvironment?.cloudDensityRestores>0);},'actual warm scene voxel and vegetation restoration',450000);
  assert.deepEqual(JSON.parse((await data()).worldWebglErrors??'null'),[]);
  console.log('WARM-WORLD-CACHE',JSON.stringify(report.warmWorldCache));
 }

 assert.equal(report.errors.length,0);report.sceneChecksPassed=true;
 if(report.decoderProbe)assert.equal(report.decoderProbe.passed,true,'Actual compressed-asset GPU decoder proof failed; scene evidence remains diagnostic.');
 report.passed=true;
}catch(e){report.captureError=e.message;report.failure??=e.message;console.error(e);process.exitCode=1;
 try{await data(5000);}catch(error){report.failureWorldReadbackError=String(error);}
 if(lastWorldData){report.failureWorldReadAt=lastWorldData.readAt;const d=lastWorldData.data;report.failureWorld={worldEnvironment:d.worldEnvironment,regionalForest:d.regionalForest,regionalLandmarks:d.regionalLandmarks,voxelGI:d.voxelGI,terrainStreaming:d.terrainStreaming,treeHlod:d.treeHlod,farTreeHlod:d.farTreeHlod,sourceVegetationHlod:d.sourceVegetationHlod,grassGroundField:d.grassGroundField,vegetationResources:d.vegetationResources,worldPreparation:d.worldPreparation,regionalHorizon:d.regionalHorizon,regionalWoodland:d.regionalWoodland,cameraYaw:d.cameraYaw,cameraPitch:d.cameraPitch,selectedView:d.selectedView,worldGpuFrame:d.worldGpuFrame,populationStatus:d.populationStatus,populationError:d.populationError,populationRegistered:d.populationRegistered,populationSelected:d.populationSelected,populationDrawn:d.populationDrawn,populationReady:d.populationReady,populationSnapshot:d.populationSnapshot,populationObservation:d.populationObservation,populationLife:d.populationLife};}
}
finally{clearTimeout(deadline);if(browser){await browser.close();report.browserClosed=true;}report.finishedAt=new Date().toISOString();await writeFile(dir+'/verification.json',JSON.stringify(report,null,2));console.log('DONE',report.passed);}
