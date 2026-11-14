// Reuse proof for the crowd clip libraries: plays the published clips-only library GLBs on bodies that carry no
// clips (test bodies bound to an archetype skeleton, crowd residents, or the household residents) exactly as the
// actor owner will ({scene: body.scene, animations: library.animations}, placement.scale), renders stride diagrams
// and frame sheets on a plain ground plane, and measures planted feet on the skinned mesh.
//
//   node scripts/characters/review/clip-library-proof.mjs PLAN.json OUTPUT_DIR
//
// PLAN.json: { "modelDir": DIR, "bodies": {id: {file, scale?, scaleFrom?: "hips"}}, "libraries": {id: file},
//   "manifests": {libraryId: manifest path relative to modelDir}, "props": {...stand-in prop shapes...},
//   "strides": [{file, body, library, clip, ghosts, seconds?, az?, dist?}],
//   "sheets": [{file, cols, size, frames: [{body, library, clip, time, az, el, dist, target, label, props}]}],
//   "measure": [{id, body, library, clip, fps}] }
// Evidence goes outside the repository; SwiftShader captures are not headset or performance evidence.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../..');
const { chromium } = await import(path.join(repo, 'main game/node_modules/playwright/index.mjs'));
const threeDir = path.join(repo, 'main game/node_modules/three');
const [planPath, outDir] = process.argv.slice(2);
if (!planPath || !outDir) { console.error('usage: clip-library-proof.mjs PLAN.json OUTPUT_DIR'); process.exit(2); }
const plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
plan.modelDir = path.resolve(path.dirname(planPath), plan.modelDir);  // relative to the plan file
fs.mkdirSync(outDir, { recursive: true });
const manifests = {};
for (const [id, rel] of Object.entries(plan.manifests || {})) manifests[id] = JSON.parse(fs.readFileSync(path.resolve(plan.modelDir, rel), 'utf8'));

const page = `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:#1d2126}canvas{display:block}</style>
<script type="importmap">{"imports":{"three":"/three/build/three.module.js","three/addons/":"/three/examples/jsm/"}}</script></head><body>
<script type="module">
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1); renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene(); scene.background = new THREE.Color(0x8d969e);
const pmrem = new THREE.PMREMGenerator(renderer); scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture; scene.environmentIntensity = 0.3;
scene.add(new THREE.HemisphereLight(0xcfd8e0, 0x4b4336, 1.0));
const key = new THREE.DirectionalLight(0xfff1de, 2.4); key.position.set(2.5, 4, 3); key.castShadow = true; key.shadow.mapSize.set(2048, 2048);
Object.assign(key.shadow.camera, { left: -4, right: 4, top: 4, bottom: -2, near: 0.5, far: 20 }); key.shadow.bias = -0.0004; scene.add(key, key.target);
// plain untextured ground with a 10 cm grid: no stand-in terrain, village or scene geometry
const ground = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshStandardMaterial({ color: 0x6f6a62, roughness: 0.92 }));
ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
const grid = new THREE.GridHelper(12, 120, 0x2b6cff, 0xaab2bc); grid.position.y = 0.001; grid.material.transparent = true; grid.material.opacity = 0.35; scene.add(grid);
const camera = new THREE.PerspectiveCamera(30, 1, 0.01, 200);
const loader = new GLTFLoader(); const bodies = {}, libs = {}; const dyn = new THREE.Group(); scene.add(dyn);
const skin = new THREE.MeshStandardMaterial({ color: 0xc9a58a, roughness: 0.75 });
const ghostMat = c => new THREE.MeshStandardMaterial({ color: c, roughness: 0.8, transparent: true, opacity: 0.55, depthWrite: false });
window.loadBody = async (id, url, matKeep) => {
  const g = await loader.loadAsync(url); const root = g.scene;
  root.traverse(o => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; if (!matKeep) o.material = skin; } });
  bodies[id] = { root, gltf: g };
  const hips = root.getObjectByName('hips'); const p = new THREE.Vector3(); root.updateMatrixWorld(true); hips.getWorldPosition(p);
  return { id, hipsY: p.y, meshes: (() => { const m = []; root.traverse(o => { if (o.isMesh) m.push(o.name); }); return m; })() };
};
const propModels = {};
window.loadPropModel = async (id, url) => { const g = await loader.loadAsync(url); propModels[id] = g.scene; return { id }; };
window.loadLib = async (id, url) => {
  const g = await loader.loadAsync(url); libs[id] = g;
  const hips = g.scene.getObjectByName('hips'); const p = new THREE.Vector3(); g.scene.updateMatrixWorld(true); hips.getWorldPosition(p);
  return { id, clips: g.animations.length, hipsY: p.y };
};
function footSets(root) {
  // per foot: sole vertex groups found in the bind pose (heel: rear quarter, ball: under the toe joint, tip: front 12
  // percent of the lowest 1.5 cm of the foot-weighted vertices); measured as group means, like locomotion.Soles
  const out = { l: { heel: [], ball: [], tip: [], all: [] }, r: { heel: [], ball: [], tip: [], all: [] } };
  root.updateMatrixWorld(true); const v = new THREE.Vector3();
  root.traverse(m => {
    if (!m.isSkinnedMesh) return;
    m.skeleton.pose();
    const bones = m.skeleton.bones.map(b => b.name); const si = m.geometry.attributes.skinIndex, sw = m.geometry.attributes.skinWeight;
    for (const s of ['l', 'r']) {
      const want = new Set(['foot_' + s, 'toes_' + s].map(n => bones.indexOf(n))); const pts = [];
      for (let i = 0; i < si.count; i++) {
        let w = 0; for (let k = 0; k < 4; k++) if (want.has(si.getComponent(i, k))) w += sw.getComponent(i, k);
        if (w >= 0.5) { m.getVertexPosition(i, v); v.applyMatrix4(m.matrixWorld); pts.push([i, v.x, v.y, v.z]); }
      }
      if (!pts.length) continue;
      const ymin = Math.min(...pts.map(p => p[2])); const low = pts.filter(p => p[2] < ymin + 0.015);
      out.restMin = Math.min(out.restMin ?? Infinity, ymin);
      const zs = low.map(p => p[3]); const z0 = Math.min(...zs), z1 = Math.max(...zs), span = z1 - z0;
      const toes = root.getObjectByName('toes_' + s); const tp = new THREE.Vector3(); toes.getWorldPosition(tp);
      for (const p of low) {
        out[s].all.push([m, p[0]]);
        if (p[3] < z0 + 0.25 * span) out[s].heel.push([m, p[0]]);
        if (p[3] > z1 - 0.12 * span) out[s].tip.push([m, p[0]]);
        if (Math.abs(p[3] - tp.z) < 0.015) out[s].ball.push([m, p[0]]);
      }
      if (!out[s].ball.length) for (const p of low) if (Math.abs(p[3] - tp.z) < 0.03) out[s].ball.push([m, p[0]]);  // shoes whose sole line misses the toe joint
    }
  });
  return out;
}
function pose(id, lib, clip, t, scale, rootPos) {
  const b = bodies[id]; const mixer = b.mixer || (b.mixer = new THREE.AnimationMixer(b.root));
  mixer.stopAllAction(); const c = libs[lib].animations.find(a => a.name === clip); if (!c) throw Error('missing clip ' + clip);
  const a = mixer.clipAction(c); a.reset(); a.play(); mixer.setTime(Math.min(t, c.duration - 1e-6));
  b.root.scale.setScalar(scale); b.root.position.set(...(rootPos || [0, 0, 0])); b.root.updateMatrixWorld(true);
  return c;
}
function groupMean(list) {
  const v = new THREE.Vector3(), acc = new THREE.Vector3();
  if (!list.length) return new THREE.Vector3(0, 99, 0);  // empty group: never counted as planted
  for (const [m, i] of list) { m.getVertexPosition(i, v); v.applyMatrix4(m.matrixWorld); acc.add(v); }
  return acc.multiplyScalar(1 / Math.max(1, list.length));
}
function lowest(sets) {
  const v = new THREE.Vector3(); const out = {};
  for (const s of ['l', 'r']) {
    let lo = null;
    for (const [m, i] of sets[s].all) { m.getVertexPosition(i, v); v.applyMatrix4(m.matrixWorld); if (!lo || v.y < lo.y) lo = v.clone(); }
    out[s] = lo;
    for (const part of ['heel', 'ball', 'tip']) out[s + '_' + part] = groupMean(sets[s][part]);
  }
  return out;
}
window.measure = (spec) => {
  const b = bodies[spec.body]; const sets = b.sets || (b.sets = footSets(b.root));
  const c = libs[spec.library].animations.find(a => a.name === spec.clip); if (!c) throw Error('missing clip ' + spec.clip);
  const fps = spec.fps || 30; const n = Math.round(c.duration * fps); const rows = [];
  for (let f = 0; f <= n; f++) {
    const t = f / fps; const tr = spec.travel ? spec.travel(t) : 0;
    pose(spec.body, spec.library, spec.clip, f === n && spec.loop ? 0 : t, spec.scale, [0, 0, 0]);
    const lo = lowest(sets); const row = { t }; for (const k of ['l_heel', 'l_ball', 'l_tip', 'r_heel', 'r_ball', 'r_tip']) row[k] = [lo[k].x, lo[k].y, lo[k].z]; row.lowY = Math.min(lo.l.y, lo.r.y); rows.push(row);
  }
  return { rows, restMin: sets.restMin };
};
window.stride = (spec, w, h) => {
  dyn.clear(); const b = bodies[spec.body];
  b.root.visible = false; scene.remove(b.root);
  const c = libs[spec.library].animations.find(a => a.name === spec.clip); if (!c) throw Error('missing clip ' + spec.clip);
  const ghosts = spec.ghosts || 8; const span = spec.seconds || c.duration; const markers = [];
  const sets0 = b.sets || (b.sets = footSets(b.root));
  for (let g = 0; g < ghosts; g++) {
    const t = span * g / (ghosts - 1); const z = spec.travel[g];
    const clone = SkeletonUtils.clone(b.root); clone.visible = true; clone.traverse(o => { if (o.isMesh) { o.material = g === ghosts - 1 || g === 0 ? skin : ghostMat(0xd8b7a0); o.castShadow = g % 2 === 0; } });
    clone.scale.setScalar(spec.scale); clone.position.set(0, 0, z); clone.updateMatrixWorld(true);
    const sets = footSets(clone);  // in the bind pose, before the clip is applied (footSets resets the skeleton)
    const mixer = new THREE.AnimationMixer(clone); const a = mixer.clipAction(c); a.play(); mixer.setTime(spec.loop && t >= c.duration ? 0 : Math.min(t, c.duration - 1e-6));
    clone.updateMatrixWorld(true); dyn.add(clone);
    const lo = lowest(sets);
    for (const s of ['l', 'r']) {
      const p = lo[s]; const ok = p.y < 0.012;
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.014, 10, 8), new THREE.MeshBasicMaterial({ color: ok ? (s === 'l' ? 0x34c759 : 0x0a84ff) : 0xff3b30, depthTest: false }));
      m.position.set(p.x, Math.max(p.y, 0.004), p.z); m.renderOrder = 10; dyn.add(m); markers.push([s, p.x, p.y, p.z]);
    }
  }
  const zs = spec.travel; const mid = (zs[0] + zs[zs.length - 1]) / 2; const len = Math.abs(zs[zs.length - 1] - zs[0]) + 1.2;
  renderer.setSize(w, h); camera.aspect = w / h; camera.fov = 26;
  const az = (spec.az ?? 90) * Math.PI / 180, el = (spec.el ?? 6) * Math.PI / 180; const dist = spec.dist || Math.max(4.2, len * 2.3) * spec.scale;
  const target = new THREE.Vector3(0, 0.85 * spec.scale * (spec.heightK || 1), mid);
  camera.position.set(target.x + Math.sin(az) * Math.cos(el) * dist, target.y + Math.sin(el) * dist, target.z + Math.cos(az) * Math.cos(el) * dist);
  camera.near = 0.05; camera.updateProjectionMatrix(); camera.lookAt(target); key.target.position.copy(target); key.position.copy(target).add(new THREE.Vector3(2.5, 4, 3));
  renderer.render(scene, camera); const url = renderer.domElement.toDataURL('image/png'); dyn.clear(); return { url, markers };
};
window.frame = (spec, w, h) => {
  dyn.clear(); for (const b of Object.values(bodies)) { b.root.visible = false; scene.remove(b.root); }
  const list = [spec, ...(spec.extras || [])];
  for (const s of list) {
    const b = bodies[s.body]; scene.add(b.root); b.root.visible = true;
    pose(s.body, s.library, s.clip, s.time || 0, s.scale, s.root || [0, 0, 0]);
    for (const p of s.props || []) {
      const geo = new THREE.Group();
      if (p.model) {  // a published prop kit node, attached with the manifest's kitMatrix
        const node = propModels[p.model].getObjectByName(p.node); if (!node) throw Error('missing prop node ' + p.node);
        const c = node.clone(true); c.traverse(o => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; } }); geo.add(c);
      }
      for (const part of p.parts || []) {
        const mat = new THREE.MeshStandardMaterial({ color: part.color || 0x8a6a48, roughness: 0.8 });
        let mesh;
        if (part.box) mesh = new THREE.Mesh(new THREE.BoxGeometry(...part.box), mat);
        else { mesh = new THREE.Mesh(new THREE.CylinderGeometry(part.r, part.r2 ?? part.r, part.len, 10), mat); }
        mesh.position.fromArray(part.at || [0, 0, 0]); if (part.rot) mesh.rotation.set(...part.rot.map(d => d * Math.PI / 180));
        mesh.castShadow = true; geo.add(mesh);
      }
      if (p.bone) { const bone = b.root.getObjectByName(p.bone); geo.matrixAutoUpdate = false; geo.matrix.fromArray(p.matrix); bone.add(geo); geo.userData.attached = true; }
      else { geo.matrixAutoUpdate = false; geo.matrix.fromArray(p.matrix); b.root.add(geo); geo.userData.attached = true; }
    }
    b.root.updateMatrixWorld(true);
  }
  renderer.setSize(w, h); camera.aspect = w / h; camera.fov = spec.fov || 30;
  const az = (spec.az ?? 30) * Math.PI / 180, el = (spec.el ?? 10) * Math.PI / 180, dist = spec.dist || 3.2;
  const target = new THREE.Vector3(...(spec.target || [0, 0.9, 0]));
  camera.position.set(target.x + Math.sin(az) * Math.cos(el) * dist, target.y + Math.sin(el) * dist, target.z + Math.cos(az) * Math.cos(el) * dist);
  camera.near = 0.02; camera.updateProjectionMatrix(); camera.lookAt(target); key.target.position.copy(target); key.position.copy(target).add(new THREE.Vector3(2.5, 4, 3));
  renderer.render(scene, camera); const url = renderer.domElement.toDataURL('image/png');
  for (const s of list) { const b = bodies[s.body]; const rm = []; b.root.traverse(o => { if (o.userData.attached) rm.push(o); }); rm.forEach(o => o.removeFromParent()); }
  return url;
};
window.ready = true;
</script></body></html>`;

const types = { '.js': 'text/javascript', '.glb': 'model/gltf-binary', '.html': 'text/html' };
const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  if (url === '/') { res.setHeader('Content-Type', 'text/html'); return res.end(page); }
  let file = null;
  if (url.startsWith('/three/')) file = path.join(threeDir, url.slice(7));
  if (url.startsWith('/model/')) { const root = path.resolve(plan.modelDir), cand = path.resolve(root, url.slice(7)); if (cand.startsWith(root + path.sep)) file = cand; }
  if (!file || !fs.existsSync(file)) { res.statusCode = 404; return res.end('missing'); }
  res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream'); fs.createReadStream(file).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
function chromiumPath() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  for (const root of (process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers').split(path.delimiter)) {
    if (!fs.existsSync(root)) continue;
    for (const d of fs.readdirSync(root).filter(d => d.startsWith('chromium_headless_shell-')).sort().reverse()) {
      const f = path.join(root, d, 'chrome-headless-shell-linux64', 'chrome-headless-shell'); if (fs.existsSync(f)) return f;
    }
  }
  return undefined;
}
const browser = await chromium.launch({ headless: true, executablePath: chromiumPath(), args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const tab = await browser.newPage({ viewport: { width: 1024, height: 1024 } });
const errors = [];
tab.on('pageerror', e => errors.push('pageerror: ' + e.message));
tab.on('console', m => { if (m.type() === 'error') errors.push(m.type() + ': ' + m.text()); });
await tab.goto(`http://127.0.0.1:${server.address().port}/`);
await tab.waitForFunction(() => window.ready === true, null, { timeout: 120000 });
const info = { bodies: {}, libraries: {} };
for (const [id, file] of Object.entries(plan.libraries)) info.libraries[id] = await tab.evaluate(([i, u]) => window.loadLib(i, u), [id, '/model/' + file]);
for (const [id, file] of Object.entries(plan.propModels || {})) await tab.evaluate(([i, u]) => window.loadPropModel(i, u), [id, '/model/' + file]);
for (const [id, b] of Object.entries(plan.bodies)) info.bodies[id] = await tab.evaluate(([i, u, k]) => window.loadBody(i, u, k), [id, '/model/' + b.file, !!b.keepMaterials]);
// placement scale: given (crowd test bodies: the measured placementScale) or from the hips height (household residents)
const scaleOf = (bodyId, libId) => { const b = plan.bodies[bodyId]; if (b.scaleFrom === 'hips') return info.bodies[bodyId].hipsY / info.libraries[libId].hipsY; return b.scale ?? 1; };
function travelFn(libId, clip, scale) {
  const m = manifests[libId]; const c = m && m.clips[clip]; if (!c) return () => 0;
  if (c.speedMetresPerSecond && c.loop) return t => c.speedMetresPerSecond * t * scale;
  if (c.rootTravelMetres) { const tr = c.rootTravelMetres; return t => { const f = Math.min(tr.length - 1, t * 30); const k = Math.floor(f), u = f - k; return ((tr[k] ?? tr[tr.length - 1]) * (1 - u) + (tr[Math.min(k + 1, tr.length - 1)]) * u) * scale; }; }
  return () => 0;
}
const results = { info, strides: [], measures: {}, errors };
for (const s of plan.strides || []) {
  const scale = scaleOf(s.body, s.library); const m = manifests[s.library]; const c = m.clips[s.clip]; const span = s.seconds || c.seconds; const ghosts = s.ghosts || 8;
  const tf = travelFn(s.library, s.clip, scale); const travel = []; for (let g = 0; g < ghosts; g++) travel.push(tf(span * g / (ghosts - 1)));
  const r = await tab.evaluate(([sp, w, h]) => window.stride(sp, w, h), [{ ...s, scale, travel, loop: c.loop, seconds: span }, s.size?.[0] || 1400, s.size?.[1] || 520]);
  fs.writeFileSync(path.join(outDir, s.file), Buffer.from(r.url.split(',')[1], 'base64')); results.strides.push({ file: s.file, scale, markers: r.markers }); console.log('stride', s.file);
}
for (const sh of plan.sheets || []) {
  const [w, h] = sh.size || [400, 400]; const cols = sh.cols || sh.frames.length; const rows = Math.ceil(sh.frames.length / cols); const tiles = [];
  for (const f of sh.frames) {
    const fr = { ...f, scale: scaleOf(f.body, f.library) }; if (f.extras) fr.extras = f.extras.map(e => ({ ...e, scale: scaleOf(e.body, e.library) }));
    tiles.push({ label: f.label || '', data: await tab.evaluate(([s, ww, hh]) => window.frame(s, ww, hh), [fr, w, h]) });
  }
  const sheet = await tab.evaluate(async ([tl, ww, hh, cc, rr]) => {
    const cv = document.createElement('canvas'); cv.width = ww * cc; cv.height = hh * rr; const g = cv.getContext('2d'); g.fillStyle = '#1d2126'; g.fillRect(0, 0, cv.width, cv.height);
    for (let i = 0; i < tl.length; i++) { const img = new Image(); img.src = tl[i].data; await img.decode(); const x = (i % cc) * ww, y = Math.floor(i / cc) * hh; g.drawImage(img, x, y);
      if (tl[i].label) { g.font = '600 14px sans-serif'; g.fillStyle = 'rgba(0,0,0,.55)'; g.fillRect(x, y + hh - 22, g.measureText(tl[i].label).width + 10, 22); g.fillStyle = '#fff'; g.fillText(tl[i].label, x + 5, y + hh - 6); } }
    return cv.toDataURL('image/png');
  }, [tiles, w, h, cols, rows]);
  fs.writeFileSync(path.join(outDir, sh.file), Buffer.from(sheet.split(',')[1], 'base64')); console.log('sheet', sh.file);
}
for (const ms of plan.measure || []) {
  const scale = scaleOf(ms.body, ms.library); const c = manifests[ms.library].clips[ms.clip];
  const res = await tab.evaluate(sp => window.measure(sp), { body: ms.body, library: ms.library, clip: ms.clip, fps: ms.fps || 30, scale, loop: c.loop });
  const rows = res.rows; const restMin = res.restMin * scale;  // the body's lowest sole point at rest (bind pose), scaled
  const tf = travelFn(ms.library, ms.clip, scale);
  // ground-frame sole points: undo the in-place root removal (forward is +Z in glTF)
  const parts = ['l_heel', 'l_ball', 'l_tip', 'r_heel', 'r_ball', 'r_tip'];
  const g = rows.map(r => { const o = { t: r.t }; for (const k of parts) o[k] = [r[k][0], r[k][1], r[k][2] + tf(r.t)]; return o; });
  const out = { scale, frames: g.length, minSoleCm: +(Math.min(...rows.map(r => r.lowY)) * 100).toFixed(2), restSoleCm: +(restMin * 100).toFixed(2), points: {} };
  const contactAt = (ms.contact || 0.01) + Math.max(0, restMin);  // planted = within 1 cm of the body's own resting sole height
  // a sole point is planted while its group mean is within 1 cm of the ground; slide = largest ground-frame spread
  // of a planted run of at least 3 frames (0.1 s)
  for (const k of parts) {
    const runs = []; let cur = null;
    g.forEach((r, i) => { const down = r[k][1] < contactAt; if (down) { if (!cur) cur = []; cur.push(i); } else if (cur) { runs.push(cur); cur = null; } });
    if (cur) runs.push(cur);
    const slides = runs.filter(run => run.length >= 3).map(run => { let m = 0; for (const a of run) for (const b of run) m = Math.max(m, Math.hypot(g[a][k][0] - g[b][k][0], g[a][k][2] - g[b][k][2])); return +(m * 100).toFixed(2); });
    out.points[k] = { runs: runs.length, maxSlideCm: slides.length ? Math.max(...slides) : 0, minYcm: +(Math.min(...g.map(r => r[k][1])) * 100).toFixed(2) };
  }
  out.l = { maxSlideCm: Math.max(...['l_heel', 'l_ball', 'l_tip'].map(k => out.points[k].maxSlideCm)) };
  out.r = { maxSlideCm: Math.max(...['r_heel', 'r_ball', 'r_tip'].map(k => out.points[k].maxSlideCm)) };
  results.measures[ms.id] = out;
}
fs.writeFileSync(path.join(outDir, `proof-${path.basename(planPath, '.json')}.json`), JSON.stringify(results, null, 1));
await browser.close(); server.close();
console.log(JSON.stringify({ errors: errors.length, measures: Object.fromEntries(Object.entries(results.measures).map(([k, v]) => [k, { scale: +v.scale.toFixed(3), minSoleCm: v.minSoleCm, restSoleCm: v.restSoleCm, slideL: v.l.maxSlideCm, slideR: v.r.maxSlideCm }])) }));
