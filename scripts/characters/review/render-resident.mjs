// Review harness: renders actual exported resident GLBs with three.js in headless
// Chromium (software rendering) and writes PNG sheets, frame sequences and a JSON
// summary with model facts, measurements and page/console errors.
//
//   node scripts/characters/review/render-resident.mjs PLAN.json OUTPUT_DIR
//
// PLAN.json: { "modelDir": DIR, "models": {"id": "file.glb"}, "outputs": [ {file, cols, size,
// frames: [shot...]}, ... ], "measure": [ {id, model, clip, fps, seconds, bones, meshes} ] }
// A shot: { model, label, camera: {az, el, dist, target, fov}, light: "studio"|"village" (daylight on a plain plane),
// clip, time, morphs, bones: {name: [x,y,z] degrees}, props: [{model, node, bone}], shadows/normalMaps: false (diagnostics),
// root: [x,y,z], yaw, ground, markers: [bone...], hide: [mesh...], show: [mesh...],
// extras: [{model, clip, time, root, yaw, props, morphs, bones}] (other residents in the same shot) }.
// Evidence goes outside the repository; captures are not headset performance evidence.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../..');
const { chromium } = await import(path.join(repo, 'main game/node_modules/playwright/index.mjs'));
const threeDir = path.join(repo, 'main game/node_modules/three');
const [planPath, outDir] = process.argv.slice(2);
if (!planPath || !outDir) { console.error('usage: render-resident.mjs PLAN.json OUTPUT_DIR'); process.exit(2); }
const plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
fs.mkdirSync(outDir, { recursive: true });

const page = `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:#1d2126}canvas{display:block}</style>
<script type="importmap">{"imports":{"three":"/three/build/three.module.js","three/addons/":"/three/examples/jsm/"}}</script></head><body>
<script type="module">
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1); renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
const pmrem = new THREE.PMREMGenerator(renderer);
const studioEnv = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
const models = {}; const lights = new THREE.Group(); scene.add(lights);
const loader = new GLTFLoader();
// Ground: a plain untextured plane in both lights. Residents are judged on neutral backdrops; no stand-in
// terrain, village or scene geometry is drawn (environment work is paused by the creator, 7 November).
const groundVillage = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.MeshStandardMaterial({ color: 0x7a7266, roughness: 0.95 }));
groundVillage.rotation.x = -Math.PI / 2; groundVillage.receiveShadow = true;
const groundStudio = new THREE.Mesh(new THREE.CircleGeometry(3, 64), new THREE.MeshStandardMaterial({ color: 0x6f6a62, roughness: 0.9 }));
groundStudio.rotation.x = -Math.PI / 2; groundStudio.receiveShadow = true;
const grid = new THREE.GridHelper(4, 40, 0x2b6cff, 0x9aa4b0); grid.position.y = 0.0015; grid.material.transparent = true; grid.material.opacity = 0.55;
const markerGroup = new THREE.Group(); scene.add(markerGroup);
scene.add(groundVillage, groundStudio, grid);
const camera = new THREE.PerspectiveCamera(30, 1, 0.01, 200);
function setLight(kind) {
  lights.clear();
  if (kind === 'village') {
    scene.background = new THREE.Color(0xaab8c4); scene.fog = new THREE.Fog(0xaab8c4, 18, 70);
    scene.environment = studioEnv; scene.environmentIntensity = 0.25;
    lights.add(new THREE.HemisphereLight(0xc4d2de, 0x4a4636, 1.25));
    const sun = new THREE.DirectionalLight(0xffe6c8, 2.1); sun.position.set(-6, 5.5, 7); sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048); Object.assign(sun.shadow.camera, { left: -4, right: 4, top: 4, bottom: -2, near: 0.5, far: 30 });
    sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.02; lights.add(sun, sun.target);
    groundVillage.visible = true; groundStudio.visible = false;
  } else {
    scene.background = new THREE.Color(0x8d969e); scene.fog = null;
    scene.environment = studioEnv; scene.environmentIntensity = 0.32;
    lights.add(new THREE.HemisphereLight(0xcfd8e0, 0x4b4336, 1.0));
    const key = new THREE.DirectionalLight(0xfff1de, 2.5); key.position.set(1.6, 2.8, 2.4); key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048); Object.assign(key.shadow.camera, { left: -1.4, right: 1.4, top: 2.3, bottom: -0.2 });
    key.shadow.bias = -0.0004; key.shadow.normalBias = 0.01;
    const rim = new THREE.DirectionalLight(0xc8d8ff, 1.0); rim.position.set(-1.8, 2.2, -2.0);
    lights.add(key, key.target, rim); groundVillage.visible = false; groundStudio.visible = true;
  }
}
window.loadModel = async (id, url) => {
  const gltf = await loader.loadAsync(url); const root = gltf.scene; root.name = 'model:' + id;
  const meshes = [], bones = {};
  root.traverse(o => {
    if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; meshes.push(o); }
    if (o.isBone || o.type === 'Object3D' || o.isGroup) { bones[o.name] = o; }
  });
  root.traverse(o => { if (o.isBone) o.userData.rest = o.quaternion.clone(); });
  const mixer = new THREE.AnimationMixer(root);
  models[id] = { root, meshes, bones, mixer, clips: gltf.animations, parent: null };
  let tris = 0; const mats = new Set(), maps = new Map(); let morphs = 0;
  for (const m of meshes) {
    const g = m.geometry; tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
    for (const mat of [].concat(m.material)) { mats.add(mat); for (const k of ['map', 'normalMap', 'roughnessMap', 'aoMap', 'metalnessMap', 'alphaMap', 'emissiveMap']) if (mat[k] && mat[k].image) maps.set(mat[k].uuid, [mat[k].image.width, mat[k].image.height]); }
    morphs = Math.max(morphs, m.morphTargetInfluences ? m.morphTargetInfluences.length : 0);
  }
  const box = new THREE.Box3().setFromObject(root);
  return { id, meshes: meshes.map(m => ({ name: m.name, material: [].concat(m.material).map(x => x.name).join(','), skinned: !!m.isSkinnedMesh,
      tris: (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3, morphs: m.morphTargetInfluences ? m.morphTargetInfluences.length : 0 })),
    triangles: tris, materials: [...mats].map(m => m.name), textures: [...maps.values()], maxMorphs: morphs,
    bones: Object.values(bones).filter(b => b.isBone).length, clips: gltf.animations.map(c => ({ name: c.name, duration: c.duration, tracks: c.tracks.length })),
    bounds: [box.min.toArray(), box.max.toArray()] };
};
function resetModel(m) {
  m.mixer.stopAllAction();
  m.root.traverse(o => { if (o.isBone && o.userData.rest) o.quaternion.copy(o.userData.rest); });
  for (const mesh of m.meshes) if (mesh.morphTargetInfluences) mesh.morphTargetInfluences.fill(0);
}
function poseModel(m, s) {
  resetModel(m);
  if (s.clip) { const c = m.clips.find(c => c.name === s.clip); if (!c) throw Error('missing clip ' + s.clip); const a = m.mixer.clipAction(c); a.play(); m.mixer.setTime(s.time || 0); }
  for (const [name, deg] of Object.entries(s.bones || {})) {
    const b = m.bones[name]; if (!b) throw Error('missing bone ' + name);
    const e = new THREE.Euler(...deg.map(d => d * Math.PI / 180), 'XYZ'); b.quaternion.multiply(new THREE.Quaternion().setFromEuler(e));
  }
  for (const mesh of m.meshes) {
    mesh.visible = !(s.hide || []).includes(mesh.name) && (!s.show || s.show.includes(mesh.name));
    if (!mesh.morphTargetDictionary) continue;
    for (const [k, v] of Object.entries(s.morphs || {})) { const i = mesh.morphTargetDictionary[k]; if (i !== undefined) mesh.morphTargetInfluences[i] = v; }
  }
  m.root.position.fromArray(s.root || [0, 0, 0]); m.root.rotation.y = (s.yaw || 0) * Math.PI / 180;
  m.root.updateMatrixWorld(true);
}
function target(s, m) {
  const t = s.camera && s.camera.target;
  if (Array.isArray(t)) return new THREE.Vector3(...t).add(m.root.position);
  const p = new THREE.Vector3();
  const pick = { head: 'head', chest: 'spine_03', hips: 'hips', feet: 'foot_l' }[t || 'body'] || (typeof t === 'string' && m.bones[t] ? t : undefined);
  if (pick && m.bones[pick]) { m.bones[pick].getWorldPosition(p); if (t === 'head') p.y += 0.06; if (t === 'feet') { p.x = m.root.position.x; p.y = 0.12; } return p; }
  const box = new THREE.Box3().setFromObject(m.root); box.getCenter(p); return p;
}
const markerMat = new THREE.MeshBasicMaterial({ color: 0xff3b30, depthTest: false }); const markerOk = new THREE.MeshBasicMaterial({ color: 0x34c759, depthTest: false });
const lineMat = new THREE.LineBasicMaterial({ color: 0xff3b30, depthTest: false });
window.shot = (s, w, h) => {
  renderer.setSize(w, h); camera.aspect = w / h;
  setLight(s.light || 'studio'); grid.visible = !!s.grid;
  if (s.shadows === false) lights.traverse(l => { if (l.isLight) l.castShadow = false; });  // diagnostic: no shadow maps
  for (const mm of Object.values(models)) mm.root.traverse(o => { if (o.isMesh) for (const mat of [].concat(o.material)) { if (mat.userData.normalMap === undefined) mat.userData.normalMap = mat.normalMap; mat.normalMap = s.normalMaps === false ? null : mat.userData.normalMap; mat.needsUpdate = true; } });  // diagnostic: normalMaps false
  for (const [id, m] of Object.entries(models)) { m.root.visible = false; if (m.root.parent) m.root.parent.remove(m.root); }
  const m = models[s.model]; scene.add(m.root); m.root.visible = true; poseModel(m, s);
  const propMixers = [];
  const attach = (mm, list, sh) => {
    const sources = new Set();
    for (const p of list || []) {
      const src = models[p.model]; const node = src.root.getObjectByName(p.node); if (!node) throw Error('missing prop ' + p.node);
      // clones keep their node names so the props GLB's clip (named after the body clip) can drive its mechanisms
      const clone = node.clone(true); clone.userData.attached = true; clone.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; } });
      if (p.bone) mm.bones[p.bone].add(clone); else mm.root.add(clone);  // workplace props stand in the resident root frame
      sources.add(src);
    }
    for (const src of sources) {  // animated mechanisms (bellows, spindle) play at the body clip's time
      const pc = sh.clip && src.clips.find(c => c.name === sh.clip);
      if (!pc) continue;
      const mixer = new THREE.AnimationMixer(mm.root); mixer.clipAction(pc).play(); mixer.setTime(sh.time || 0); propMixers.push(mixer);
    }
  };
  attach(m, s.props, s);
  const extras = [];
  for (const e of s.extras || []) {  // other residents in the same shot (group and interaction views)
    const mm = models[e.model]; if (mm === m || extras.includes(mm)) throw Error('a model can appear once per shot');
    scene.add(mm.root); mm.root.visible = true; poseModel(mm, e); attach(mm, e.props, e); extras.push(mm);
  }
  markerGroup.clear(); const info = {};
  m.root.updateMatrixWorld(true);
  for (const name of s.markers || []) {
    const b = m.bones[name]; const p = new THREE.Vector3(); b.getWorldPosition(p); info[name] = p.toArray();
    const sph = new THREE.Mesh(new THREE.SphereGeometry(0.018, 12, 8), p.y < (s.contactHeight || 0.11) ? markerOk : markerMat); sph.position.copy(p); sph.renderOrder = 10; markerGroup.add(sph);
    const g = new THREE.BufferGeometry().setFromPoints([p, new THREE.Vector3(p.x, 0, p.z)]); const l = new THREE.Line(g, lineMat); l.renderOrder = 10; markerGroup.add(l);
  }
  const c = s.camera || {}; const az = (c.az || 0) * Math.PI / 180, el = (c.el || 0) * Math.PI / 180, dist = c.dist || 3;
  const t = target(s, m); if (c.targetOffset) t.add(new THREE.Vector3(...c.targetOffset)); camera.fov = c.fov || 30; camera.near = Math.max(0.01, dist / 200); camera.updateProjectionMatrix();
  camera.position.set(t.x + Math.sin(az) * Math.cos(el) * dist, t.y + Math.sin(el) * dist, t.z + Math.cos(az) * Math.cos(el) * dist); camera.lookAt(t);
  renderer.render(scene, camera);
  for (const mixer of propMixers) { mixer.stopAllAction(); mixer.uncacheRoot(mixer.getRoot()); }
  for (const mm of [m, ...extras]) {
    for (const ch of [...mm.root.children]) if (ch.userData.attached) ch.removeFromParent();
    for (const o of Object.values(mm.bones)) for (const ch of [...o.children]) if (ch.userData.attached) ch.removeFromParent();
  }
  return renderer.domElement.toDataURL('image/png');
};
window.measure = (spec) => {
  const m = models[spec.model]; const out = { times: [], bones: {}, meshMinY: {} };
  for (const b of spec.bones || []) out.bones[b] = [];
  for (const n of spec.meshes || []) out.meshMinY[n] = [];
  const clip = m.clips.find(c => c.name === spec.clip); if (!clip) throw Error('missing clip ' + spec.clip);
  const frames = Math.round(clip.duration * (spec.fps || 30)); const v = new THREE.Vector3();
  for (let f = 0; f <= frames; f++) {
    const time = Math.min(clip.duration, f / (spec.fps || 30)); poseModel(m, { clip: spec.clip, time }); out.times.push(time);
    for (const b of spec.bones || []) { m.bones[b].getWorldPosition(v); out.bones[b].push(v.toArray()); }
    for (const n of spec.meshes || []) {
      const mesh = m.meshes.find(x => x.name === n); if (!mesh) { out.meshMinY[n].push(null); continue; }
      let lo = Infinity, lx = 0, lz = 0; const pos = mesh.geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) { mesh.getVertexPosition(i, v); v.applyMatrix4(mesh.matrixWorld); if (v.y < lo) { lo = v.y; lx = v.x; lz = v.z; } }
      out.meshMinY[n].push([lx, lo, lz]);
    }
  }
  return out;
};
window.ready = true;
</script></body></html>`;

const types = { '.js': 'text/javascript', '.glb': 'model/gltf-binary', '.webp': 'image/webp', '.png': 'image/png', '.html': 'text/html' };
const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  if (url === '/') { res.setHeader('Content-Type', 'text/html'); return res.end(page); }
  let file = null;
  if (url.startsWith('/three/')) file = path.join(threeDir, url.slice(7));
  if (url.startsWith('/model/')) {  // model files may sit in subfolders of modelDir, never outside it
    const root = path.resolve(plan.modelDir), cand = path.resolve(root, url.slice(7));
    if (cand.startsWith(root + path.sep)) file = cand;
  }
  if (!file || !fs.existsSync(file)) { res.statusCode = 404; return res.end('missing'); }
  res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
  fs.createReadStream(file).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
// Use CHROMIUM_PATH, else the newest preinstalled headless shell when Playwright's pinned build is absent.
function chromiumPath() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const roots = (process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers').split(path.delimiter);
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    const shells = fs.readdirSync(root).filter(d => d.startsWith('chromium_headless_shell-')).sort().reverse();
    for (const d of shells) { const f = path.join(root, d, 'chrome-headless-shell-linux64', 'chrome-headless-shell'); if (fs.existsSync(f)) return f; }
  }
  return undefined;
}
const browser = await chromium.launch({ headless: true, executablePath: chromiumPath(), args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const tab = await browser.newPage({ viewport: { width: 1024, height: 1024 } });
const errors = [];
tab.on('pageerror', e => errors.push('pageerror: ' + e.message));
tab.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.type() + ': ' + m.text()); });
await tab.goto(`http://127.0.0.1:${server.address().port}/`);
await tab.waitForFunction(() => window.ready === true, null, { timeout: 120000 });
const summary = { plan: path.basename(planPath), models: {}, outputs: [], measurements: {}, errors };
for (const [id, file] of Object.entries(plan.models)) summary.models[id] = await tab.evaluate(([i, u]) => window.loadModel(i, u), [id, '/model/' + file]);

for (const out of plan.outputs || []) {
  const [w, h] = out.size || [512, 512]; const cols = out.cols || out.frames.length; const rows = Math.ceil(out.frames.length / cols);
  const tiles = [];
  for (const f of out.frames) tiles.push({ label: f.label || '', data: await tab.evaluate(([s, ww, hh]) => window.shot(s, ww, hh), [f, w, h]) });
  if (out.sequence) {
    const dir = path.join(outDir, out.sequence); fs.mkdirSync(dir, { recursive: true });
    tiles.forEach((t, i) => fs.writeFileSync(path.join(dir, `frame-${String(i).padStart(4, '0')}.png`), Buffer.from(t.data.split(',')[1], 'base64')));
  }
  if (out.file) {
    const sheet = await tab.evaluate(async ([tl, ww, hh, cc, rr]) => {
      const cv = document.createElement('canvas'); cv.width = ww * cc; cv.height = hh * rr; const g = cv.getContext('2d');
      g.fillStyle = '#1d2126'; g.fillRect(0, 0, cv.width, cv.height);
      for (let i = 0; i < tl.length; i++) {
        const img = new Image(); img.src = tl[i].data; await img.decode(); const x = (i % cc) * ww, y = Math.floor(i / cc) * hh; g.drawImage(img, x, y);
        if (tl[i].label) { g.font = '600 15px sans-serif'; g.fillStyle = 'rgba(0,0,0,.55)'; g.fillRect(x, y + hh - 24, g.measureText(tl[i].label).width + 12, 24); g.fillStyle = '#fff'; g.fillText(tl[i].label, x + 6, y + hh - 7); }
      }
      return cv.toDataURL('image/png');
    }, [tiles, w, h, cols, rows]);
    fs.writeFileSync(path.join(outDir, out.file), Buffer.from(sheet.split(',')[1], 'base64'));
  }
  summary.outputs.push({ file: out.file || null, sequence: out.sequence || null, frames: out.frames.length });
  console.log('rendered', out.file || out.sequence);
}
for (const m of plan.measure || []) summary.measurements[m.id] = await tab.evaluate(s => window.measure(s), m);
fs.writeFileSync(path.join(outDir, `summary-${path.basename(planPath, '.json')}.json`), JSON.stringify(summary, null, 1));
await browser.close(); server.close();
console.log(JSON.stringify({ errors: errors.length, models: Object.fromEntries(Object.entries(summary.models).map(([k, v]) => [k, { triangles: v.triangles, bones: v.bones, maxMorphs: v.maxMorphs, materials: v.materials.length, clips: v.clips.map(c => c.name) }])) }));
