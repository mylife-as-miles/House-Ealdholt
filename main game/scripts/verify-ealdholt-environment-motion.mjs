// Real renderer / GPU pixel evidence, independent of the UIKit/React input
// suites. Uses a declared low profile on the private Quest LOD; never a fake
// render, hidden world, forced shader clock or hardware performance assertion.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import sharp from 'sharp';

const model = process.argv[2];
assert.ok(model, 'Pass the private Quest LOD GLB URL.');
const url = new URL(model);
assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname) && url.pathname.endsWith('.glb'));
const origin = process.env.CROWNFALL_TEST_URL || 'http://127.0.0.1:5173';
const out = resolve(process.env.CROWNFALL_MOTION_ARTIFACTS || 'artifacts/ealdholt-preview/environment-motion');
await mkdir(out, { recursive: true });
const evidence = { passed: false, profile: 'Actual Desktop renderer; low quality; private Quest LOD;640x360 software Chromium',
  limitations: 'Renderer-method motion probe, not UI input, physical Quest, map-alignment or frame-rate evidence.', observations: {}, errors: [] };
const server = createServer((request, response) => {
  if (request.url === '/favicon.ico') { response.writeHead(204).end(); return; }
  response.setHeader('Content-Type', 'text/html');
  response.end(`<!doctype html><html><head><base href=${JSON.stringify(origin+'/')}><style>html,body,#stage{margin:0;width:100%;height:100%;overflow:hidden}</style></head><body><div id="stage"></div><script type="module">
    import {createEaldholtVillageView} from ${JSON.stringify(origin+'/src/legacy/aethelgard/village-view.ts')};
    const host=document.querySelector('#stage');
    window.control=createEaldholtVillageView({host,modelUrl:${JSON.stringify(model)},quality:{preset:'low',renderScale:100,frameLimit:30},active:true,reducedMotion:true,panelMode:'village',label:'Environment motion probe',onReady(){host.dataset.ready='true'},onError(){host.dataset.error='true'}});
  </script></body></html>`);
});
let browser;
try {
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  browser = await chromium.launch({ headless: true,
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
    args: ['--no-sandbox','--disable-dev-shm-usage','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width:640,height:360 }, reducedMotion:'reduce' });
  page.on('pageerror', error => evidence.errors.push(error.message));
  page.on('console', message => { if (message.type()==='error') evidence.errors.push(message.text()); });
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForFunction(() => { const d=document.querySelector('#stage')?.dataset;return d?.ready==='true'||d?.error==='true'; }, undefined, { timeout:180000 });
  assert.equal(await page.locator('#stage').getAttribute('data-error'),null);
  const state = () => page.locator('#stage').evaluate(node => ({ ...node.dataset }));
  const snapshot = async name => {
    await page.evaluate(() => window.control.setActive(false));
    const data = await state(), file=resolve(out,name+'.png');
    await page.screenshot({ path:file,timeout:90000 });
    return { data,file };
  };
  const advance = async seconds => {
    const before = Number((await state()).environmentTime);
    await page.evaluate(() => { window.control.setReducedMotion(false); window.control.setActive(true); });
    await page.waitForFunction(target => Number(document.querySelector('#stage')?.dataset.environmentTime)>=target,before+seconds,{ timeout:90000 });
  };
  const changed = async (a,b,region) => {
    const first=await sharp(a).extract(region).removeAlpha().raw().toBuffer();
    const second=await sharp(b).extract(region).removeAlpha().raw().toBuffer();
    let pixels=0,difference=0;
    for(let i=0;i<first.length;i+=3){let delta=0;for(let c=0;c<3;c++)delta+=Math.abs(first[i+c]-second[i+c]);if(delta>2)pixels++;difference+=delta;}
    return { changedPixels:pixels,totalRgbDifference:difference,region };
  };
  for(const [view,region] of [['riverside',{left:96,top:2,width:448,height:46}],['lakeside',{left:180,top:150,width:260,height:45}]]) {
    await page.evaluate(view => { window.control.setReducedMotion(true);window.control.setActive(true);window.control.setView(view); },view);
    await page.waitForFunction(view => document.querySelector('#stage')?.dataset.selectedView===view,view);
    await advance(.4);const first=await snapshot(view+'-motion-a');
    await advance(1.2);const second=await snapshot(view+'-motion-b');
    const diff=await changed(first.file,second.file,region);
    assert.ok(diff.changedPixels>5,`${view} must change visible pixels inside its sky/water region: ${JSON.stringify(diff)}`);
    await page.waitForTimeout(300);const paused=await snapshot(view+'-paused');
    assert.equal(paused.data.environmentTime,second.data.environmentTime);
    assert.equal((await changed(second.file,paused.file,region)).totalRgbDifference,0);
    evidence.observations[view]={ first:first.data,second:second.data,paused:paused.data,...diff };
  }
  const before=(await state()).renderFrames;
  await page.evaluate(() => {window.control.setReducedMotion(true);window.control.setActive(true);});
  await page.waitForFunction(before => document.querySelector('#stage')?.dataset.renderFrames!==before,before);
  const reduced=await snapshot('reduced-motion-a');
  await page.evaluate(() => window.control.setActive(true));
  await page.waitForTimeout(500);const later=await snapshot('reduced-motion-b');
  assert.equal(later.data.environmentTime,reduced.data.environmentTime);
  assert.equal((await changed(reduced.file,later.file,{left:0,top:0,width:640,height:360})).totalRgbDifference,0);
  evidence.observations.reducedMotion={ before:reduced.data,after:later.data };
  assert.deepEqual(evidence.errors,[]);
  await page.evaluate(() => window.control.dispose());
  evidence.passed=true;
} catch(error) { evidence.failure=String(error.stack||error);throw error; }
finally {
  await writeFile(resolve(out,'verification.json'),JSON.stringify(evidence,null,2));
  await browser?.close();if(server.listening)await new Promise(done=>server.close(done));
}
console.log('PASS rendered cloud/water motion, pause and reduced motion');
