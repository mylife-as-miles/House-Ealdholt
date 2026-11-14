// PRIVATE standalone Desktop asset qualification. No app graph or model writes.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';
import sharp from 'sharp';
import { preflightPrivateOutput, preflightStewardSources } from '../../scripts/prepare-ealdholt-steward.mjs';
const base = '/workspace/private-assets/crownfall-characters', origin = 'http://127.0.0.1:5173';
const uvComparison = process.env.CROWNFALL_STEWARD_PREVIEW_MODE === 'uv-before-after';
const paths = uvComparison ? [resolve(base, 'derived/steward-lod-v3/house-steward-lod-candidate.glb'), resolve(base, 'derived/steward-uv-corrected-v2/house-steward-lod-uv-corrected.glb')]
  : [resolve(base, 'derived/steward-v1/house-steward-atlas512-candidate.glb'), resolve(base, 'derived/steward-lod-v3/house-steward-lod-candidate.glb')];
const directory = process.env.CROWNFALL_STEWARD_PREVIEW_OUT || resolve(base, 'derived/steward-preview-v1');
const plan = await preflightPrivateOutput(base, directory, ['fullbody.png', 'head-collar.png', 'comparison.jpg', 'evidence.json']);
const proof = await preflightStewardSources(base), sourceReport = JSON.parse(await readFile(resolve(base, 'derived/steward-v1/provenance.json'))), lodReport = JSON.parse(await readFile(resolve(base, 'derived/steward-lod-v3/lod-provenance.json')));
const binaries = await Promise.all(paths.map(path => readFile(path))), hashes = binaries.map(bytes => createHash('sha256').update(bytes).digest('hex'));
if (uvComparison) { const report = JSON.parse(await readFile(resolve(base, 'derived/steward-uv-corrected-v2/material-provenance.json')));assert.equal(hashes[0], lodReport.stats.sha256);assert.equal(hashes[1], report.files.find(file => file.path === paths[1]).sha256); }
else { assert.equal(hashes[0], sourceReport.files.find(file => file.variant === 'atlas512-candidate').sha256);assert.equal(hashes[1], lodReport.stats.sha256); }
const output = await plan.create(), errors = [], evidence = { scope: 'Standalone Desktop Three asset previews, not Native UI or in-world evidence', rendering: 'headless Chromium SwiftShader; no hardware or physical comfort claim',
  rawArchivesVerified: proof.proof.archives.length, rawMembersVerified: proof.proof.rawFilesByteIdenticalToFrozenArchiveMembers, consumedMembersVerified: proof.proof.readQualified.consumed.size, paths, hashes, frames: [], errors, passed: false };
let browser, context;
const html = `<!doctype html><html><head><style>html,body{margin:0;overflow:hidden;background:#aeb2b2}canvas{display:block}#labels{position:absolute;inset:10px 0 auto;display:flex;color:#202425;font:18px sans-serif;text-align:center}#labels span{width:50%}</style></head><body><div id="labels"><span>${uvComparison ? 'Before UV correction · 9,377 triangles' : 'Atlas · 18,827 triangles'}</span><span>${uvComparison ? 'After UV correction · 9,377 triangles' : 'LOD · 9,377 triangles'}</span></div><script type="module">
import * as T from '${origin}/node_modules/.vite/deps/three.js';
import {GLTFLoader} from '${origin}/node_modules/three/examples/jsm/loaders/GLTFLoader.js';
try{
const renderer=new T.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});renderer.setSize(1200,800);renderer.setPixelRatio(1);renderer.outputColorSpace=T.SRGBColorSpace;renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=1;renderer.setScissorTest(true);document.body.append(renderer.domElement);
const loaded=await Promise.all(['/atlas.glb','/lod.glb'].map(url=>new GLTFLoader().loadAsync(url)));
const models=loaded.map(g=>{const scene=new T.Scene();scene.background=new T.Color('#aeb2b2');scene.add(g.scene);scene.add(new T.HemisphereLight(0xffffff,0x686e72,1.8));const key=new T.DirectionalLight(0xfff5e7,2.8);key.position.set(3,5,5);scene.add(key);const fill=new T.DirectionalLight(0xdce8f0,1.1);fill.position.set(-3,2,2);scene.add(fill);const mixer=new T.AnimationMixer(g.scene),clip=g.animations.find(a=>a.name==='Idle_Talking_Loop');if(!clip)throw Error('talk clip absent');const action=mixer.clipAction(clip);action.play();return{scene,object:g.scene,mixer,clip,action};});
const bones=models.map(m=>{const set=new Set();m.object.traverse(o=>{if(o.isBone)set.add(o);});return set;});if([...bones[0]].some(b=>bones[1].has(b)))throw Error('cross-model bone alias');
window.sample=async(kind,time)=>{const stats=[];let reference;
for(let i=0;i<models.length;i++){const m=models[i];m.mixer.setTime(time);m.object.updateMatrixWorld(true);m.object.traverse(o=>{if(o.isSkinnedMesh){o.skeleton.update();o.computeBoundingBox();o.computeBoundingSphere();}});const box=new T.Box3().setFromObject(m.object);if(i===0)reference=box.clone();const region=reference.clone();
if(kind==='head-collar'){const h=reference.max.y-reference.min.y,c=reference.getCenter(new T.Vector3());region.min.set(c.x-h*.19,reference.max.y-h*.34,c.z-h*.17);region.max.set(c.x+h*.19,reference.max.y+h*.025,c.z+h*.17);}
const size=region.getSize(new T.Vector3()),center=region.getCenter(new T.Vector3()),fov=35,aspect=.75,distance=Math.max(size.y/(2*Math.tan(T.MathUtils.degToRad(fov/2))),size.x/(2*Math.tan(T.MathUtils.degToRad(fov/2))*aspect))*1.16+size.z*.5;
const camera=new T.PerspectiveCamera(fov,aspect,.01,30);camera.position.copy(center).addScaledVector(new T.Vector3(.28,.06,1).normalize(),distance);camera.lookAt(center);camera.updateMatrixWorld();await renderer.compileAsync(m.scene,camera);renderer.setViewport(i*600,0,600,800);renderer.setScissor(i*600,0,600,800);renderer.info.reset();renderer.render(m.scene,camera);
const meshes=[],materials=new Set();m.object.traverse(o=>{if(o.isSkinnedMesh){meshes.push({name:o.name,bones:o.skeleton.bones.length,vertices:o.geometry.attributes.position.count,triangles:o.geometry.index.count/3});for(const mat of Array.isArray(o.material)?o.material:[o.material])materials.add(mat);}});
const maps=[...materials].map(mat=>({name:mat.name,normal:!!mat.normalMap,normalSize:mat.normalMap?[mat.normalMap.image.width,mat.normalMap.image.height]:null,baseSize:mat.map?[mat.map.image.width,mat.map.image.height]:null,roughness:!!mat.roughnessMap}));if(meshes.length!==2||maps.some(mat=>!mat.normal||mat.normalSize[0]!==512))throw Error('expected actual two skinned meshes and 512 normal maps');
stats.push({index:i,time,clip:m.clip.name,duration:m.clip.duration,actionRunning:m.action.isRunning(),boneCount:bones[i].size,meshes,maps,drawCalls:renderer.info.render.calls,triangles:renderer.info.render.triangles,bounds:{min:box.min.toArray(),max:box.max.toArray()},camera:{position:camera.position.toArray(),target:center.toArray(),fov},units:'source metres; rest height1.8m; active talking pose approximately1.75m; no model rescale'});}
return{kind,time,models:stats};};window.ready=true;
}catch(error){window.failure=error.stack||String(error);}
</script></body></html>`;
const server = createServer((request, response) => { response.setHeader('Cache-Control', 'no-store');if (request.url === '/') { response.setHeader('Content-Type', 'text/html');response.end(html); }
  else if (request.url === '/atlas.glb' || request.url === '/lod.glb') { response.setHeader('Content-Type', 'model/gltf-binary');response.end(binaries[request.url === '/atlas.glb' ? 0 : 1]); }
  else if (request.url === '/favicon.ico') response.writeHead(204).end();else response.writeHead(404).end(); });
try {
  await new Promise((resolve, reject) => { server.once('error', reject);server.listen(8069, '127.0.0.1', resolve); });
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  context = await browser.newContext({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: 1, serviceWorkers: 'block' });const page = await context.newPage();page.on('pageerror', e => errors.push(String(e)));page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('http://127.0.0.1:8069/', { timeout: 30000 });await page.waitForFunction(() => window.ready || window.failure, null, { timeout: 45000 });assert.equal(await page.evaluate(() => window.failure ?? null), null);
  for (const [kind, time] of [['fullbody', 0], ['head-collar', 2.933333396911621/2]]) {
    const frame = await page.evaluate(async ({ kind, time }) => await window.sample(kind, time), { kind, time });evidence.frames.push(frame);
    assert.deepEqual(frame.models.map(m => m.drawCalls), [2, 2]);assert.deepEqual(frame.models.map(m => m.triangles), uvComparison ? [9377, 9377] : [18827, 9377]);assert.ok(frame.models.every(m => m.actionRunning && m.boneCount === 65));
    const screenshot = await page.screenshot({ timeout: 30000 });await output.write(kind + '.png', screenshot);
  }
  assert.deepEqual(errors, []);const full = await readFile(resolve(directory, 'fullbody.png')), crop = await readFile(resolve(directory, 'head-collar.png'));
  const preview = await sharp({ create: { width: 600, height: 800, channels: 3, background: '#aeb2b2' } }).composite([{ input: await sharp(full).resize(600,400).toBuffer(), left:0,top:0 }, {input:await sharp(crop).resize(600,400).toBuffer(),left:0,top:400}]).jpeg({quality:78}).toBuffer();await output.write('comparison.jpg', preview);evidence.passed=true;
} catch(error) { evidence.failure=error.stack||String(error);throw error; }
finally { await context?.close().catch(()=>{});await browser?.close().catch(()=>{});await new Promise(resolve=>server.close(resolve));await output.write('evidence.json',JSON.stringify(evidence,null,2));await output.close();console.log(JSON.stringify({passed:evidence.passed,output:directory,errors:evidence.errors,failure:evidence.failure??null})); }
