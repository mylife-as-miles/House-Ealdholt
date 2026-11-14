// Population review renders (original Crownfall code): many residents at once, posed by their archetype clip library
// exactly as the actor owner will pair them ({scene: resident.scene, animations: library.animations}, placement.scale),
// with the shared prop kits attached by the clip manifest's grips (kitMatrix) and workplace positions. Draws a plain
// untextured ground plane only: no stand-in terrain, village or scene geometry.
//
//   node scripts/characters/review/render-population.mjs PLAN.json OUTPUT_DIR
//
// PLAN.json (written by scripts/characters/review/population-evidence-plan.ts):
//   { "root": DIR (characters folder), "assets": {id: relative GLB path},
//     "shots": [{ "file", "size": [w, h], "camera": {"type": "persp"|"ortho", "position", "target", "fov"?, "height"?},
//                 "shadow": {"centre": [x, z], "radius"}, "grid"?: bool, "labels"?: "under"|"over"|null, "title"?,
//                 "actors": [{ "body": assetId, "anim": assetId (library or the body itself), "clip", "time",
//                              "position": [x, z], "yaw" (radians), "scale", "label"?, "sub"?, "height" (metres),
//                              "props": [{ "asset", "node", "bone"? , "matrix"? (bone-local, column-major),
//                                          "position"? [x, y, z], "yawDeg"? (root frame, workplace props) }] }],
//                 "notes"?: [{ "position": [x, z], "text", "sub"? }], "silhouette"?: bool (white unlit on black, no ground),
//                 "statics"?: [{ "asset", "node", "position": [x, y, z], "yawDeg"?, "scale"? }] (kit props on their own) }],
//     "sheets": [{ "file", "cols", "title"?, "tiles": [shot without file] }] }
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
if (!planPath || !outDir) { console.error('usage: render-population.mjs PLAN.json OUTPUT_DIR'); process.exit(2); }
const plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
const root = path.resolve(path.dirname(planPath), plan.root);
fs.mkdirSync(outDir, { recursive: true });

const page = `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:#1d2126}canvas{display:block}</style>
<script type="importmap">{"imports":{"three":"/three/build/three.module.js","three/addons/":"/three/examples/jsm/"}}</script></head><body>
<script type="module">
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1); renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene(); scene.background = new THREE.Color(0x9aa3ab);
const pmrem = new THREE.PMREMGenerator(renderer); scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture; scene.environmentIntensity = 0.35;
scene.add(new THREE.HemisphereLight(0xd6dee6, 0x4b4336, 1.05));
const key = new THREE.DirectionalLight(0xfff1de, 2.5); key.castShadow = true; key.shadow.mapSize.set(4096, 4096); key.shadow.bias = -0.0003; key.shadow.normalBias = 0.02;
scene.add(key, key.target);
// plain untextured ground: no stand-in terrain, village or scene geometry
const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshStandardMaterial({ color: 0x77726a, roughness: 0.95 }));
ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
const grid = new THREE.GridHelper(200, 200, 0x8d877d, 0x8d877d); grid.position.y = 0.002; grid.material.transparent = true; grid.material.opacity = 0.18; scene.add(grid);
const loader = new GLTFLoader(); const assets = {}; const dyn = new THREE.Group(); scene.add(dyn);
window.load = async (id, url) => { const g = await loader.loadAsync(url); assets[id] = g; return { id, clips: g.animations.length }; };
const flat = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide });
function place(a, silhouette) {
  const body = assets[a.body]; if (!body) throw Error('missing asset ' + a.body);
  const obj = SkeletonUtils.clone(body.scene);
  obj.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; if (silhouette) o.material = flat; } });
  obj.scale.setScalar(a.scale || 1); obj.position.set(a.position[0], 0, a.position[1]); obj.rotation.y = a.yaw || 0;
  obj.traverse(o => { if (o.morphTargetInfluences) o.morphTargetInfluences.fill(0); });  // household sets: rest face unless a clip keys it
  const lib = assets[a.anim || a.body];
  if (a.clip) {
    const clip = lib.animations.find(c => c.name === a.clip); if (!clip) throw Error('missing clip ' + a.clip + ' in ' + (a.anim || a.body));
    const mixer = new THREE.AnimationMixer(obj); const act = mixer.clipAction(clip); act.play();
    mixer.setTime(Math.max(0, Math.min(a.time || 0, clip.duration - 1e-4)));
  }
  for (const p of a.props || []) {
    const kit = assets[p.asset]; const node = kit.scene.getObjectByName(p.node); if (!node) throw Error('missing prop ' + p.node);
    const holder = new THREE.Group(); const c = node.clone(true); c.traverse(o => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; } }); holder.add(c);
    if (p.bone) {
      const bone = obj.getObjectByName(p.bone); if (!bone) throw Error('missing bone ' + p.bone);
      holder.matrixAutoUpdate = false; holder.matrix.fromArray(p.matrix); bone.add(holder);
    } else {
      holder.position.fromArray(p.position || [0, 0, 0]); holder.rotation.y = (p.yawDeg || 0) * Math.PI / 180;
      if (p.matrix) { holder.matrixAutoUpdate = false; holder.matrix.fromArray(p.matrix); }
      obj.add(holder);
    }
  }
  obj.updateMatrixWorld(true); dyn.add(obj); return obj;
}
window.shot = (s) => {
  dyn.clear(); const [w, h] = s.size; renderer.setSize(w, h);
  const placed = s.actors.map(a => ({ a, obj: place(a, s.silhouette) }));
  // static kit props without a resident (prop sheets): { asset, node, position [x, y, z], yawDeg?, scale? }
  for (const st of s.statics || []) {
    const kit = assets[st.asset]; const node = kit.scene.getObjectByName(st.node); if (!node) throw Error('missing prop ' + st.node);
    const c = node.clone(true); c.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; } });
    c.matrixAutoUpdate = true; c.position.fromArray(st.position || [0, 0, 0]); c.rotation.set(0, (st.yawDeg || 0) * Math.PI / 180, 0); c.scale.setScalar(st.scale || 1);
    dyn.add(c);
  }
  // silhouette shots (clone-risk measure): white unlit figures and held props on black, no ground
  ground.visible = !s.silhouette; scene.background = new THREE.Color(s.silhouette ? 0x000000 : 0x9aa3ab);
  renderer.toneMapping = s.silhouette ? THREE.NoToneMapping : THREE.ACESFilmicToneMapping;
  if (s.silhouette) for (const { obj } of placed) obj.traverse(o => { if (o.isMesh) o.material = flat; });
  const c = s.camera; let camera;
  if (c.type === 'ortho') { const hh = c.height / 2, hw = hh * w / h; camera = new THREE.OrthographicCamera(-hw, hw, hh, -hh, 0.1, 600); }
  else camera = new THREE.PerspectiveCamera(c.fov || 30, w / h, c.near || 0.05, 600);
  camera.position.fromArray(c.position); camera.lookAt(new THREE.Vector3(...c.target)); camera.updateProjectionMatrix();
  const sc = s.shadow || { centre: [c.target[0], c.target[2]], radius: 8 }; const r = sc.radius;
  key.target.position.set(sc.centre[0], 0, sc.centre[1]); key.position.set(sc.centre[0] + r * 0.6 + 3, r * 1.2 + 6, sc.centre[1] + r * 0.8 + 4);
  Object.assign(key.shadow.camera, { left: -r * 1.3, right: r * 1.3, top: r * 1.3, bottom: -r * 1.3, near: 0.5, far: r * 4 + 30 }); key.shadow.camera.updateProjectionMatrix();
  grid.visible = !!s.grid && !s.silhouette;
  renderer.render(scene, camera);
  const labels = [];
  if (s.labels) for (const { a } of placed) if (a.label) {
    const top = new THREE.Vector3(a.position[0], s.labels === 'over' ? (a.height || 1.7) + 0.12 : 0, a.position[1]).project(camera);
    if (Math.abs(top.x) < 1.05 && Math.abs(top.y) < 1.05 && top.z < 1) labels.push({ x: (top.x + 1) / 2 * w, y: (1 - top.y) / 2 * h, text: a.label, sub: a.sub || '' });
  }
  for (const n of s.notes || []) {  // free text at ground points (household names in the overview)
    const p = new THREE.Vector3(n.position[0], 0, n.position[1]).project(camera);
    if (Math.abs(p.x) < 1.05 && Math.abs(p.y) < 1.05 && p.z < 1) labels.push({ x: (p.x + 1) / 2 * w, y: (1 - p.y) / 2 * h, text: n.text, sub: n.sub || '' });
  }
  return { url: renderer.domElement.toDataURL('image/png'), labels };
};
window.compose = async (tiles, cols, tw, th, title) => {
  const rows = Math.ceil(tiles.length / cols); const head = title ? 34 : 0;
  const cv = document.createElement('canvas'); cv.width = tw * cols; cv.height = th * rows + head; const g = cv.getContext('2d');
  g.fillStyle = '#1d2126'; g.fillRect(0, 0, cv.width, cv.height);
  if (title) { g.font = '600 18px sans-serif'; g.fillStyle = '#e8e8e8'; g.fillText(title, 10, 23); }
  for (let i = 0; i < tiles.length; i++) {
    const t = tiles[i]; const img = new Image(); img.src = t.url; await img.decode();
    const x = (i % cols) * tw, y = Math.floor(i / cols) * th + head; g.drawImage(img, x, y, tw, th);
    g.textAlign = 'center';
    for (const l of t.labels || []) {
      const lx = x + l.x * tw / img.width, ly = y + l.y * th / img.height + (t.labelMode === 'under' ? 14 : -4);
      g.font = '600 12px sans-serif'; const wd = Math.max(g.measureText(l.text).width, l.sub ? (g.font = '11px sans-serif', g.measureText(l.sub).width) : 0) + 8;
      g.fillStyle = 'rgba(0,0,0,.6)'; g.fillRect(lx - wd / 2, ly - 12, wd, l.sub ? 27 : 15);
      g.fillStyle = '#fff'; g.font = '600 12px sans-serif'; g.fillText(l.text, lx, ly);
      if (l.sub) { g.font = '11px sans-serif'; g.fillStyle = '#cfd6dc'; g.fillText(l.sub, lx, ly + 13); }
    }
    g.textAlign = 'left';
    if (t.caption) { g.font = '600 13px sans-serif'; const wd = g.measureText(t.caption).width + 10; g.fillStyle = 'rgba(0,0,0,.6)'; g.fillRect(x, y + th - 21, wd, 21); g.fillStyle = '#fff'; g.fillText(t.caption, x + 5, y + th - 6); }
  }
  return cv.toDataURL('image/png');
};
window.ready = true;
</script></body></html>`;

const types = { '.js': 'text/javascript', '.glb': 'model/gltf-binary', '.html': 'text/html' };
const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  if (url === '/') { res.setHeader('Content-Type', 'text/html'); return res.end(page); }
  let file = null;
  if (url.startsWith('/three/')) file = path.join(threeDir, url.slice(7));
  if (url.startsWith('/model/')) { const cand = path.resolve(root, url.slice(7)); if (cand.startsWith(root + path.sep)) file = cand; }
  if (!file || !fs.existsSync(file)) { res.statusCode = 404; return res.end('missing'); }
  res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream'); fs.createReadStream(file).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
function chromiumPath() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  for (const dir of (process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers').split(path.delimiter)) {
    if (!fs.existsSync(dir)) continue;
    for (const d of fs.readdirSync(dir).filter(d => d.startsWith('chromium_headless_shell-')).sort().reverse()) {
      const f = path.join(dir, d, 'chrome-headless-shell-linux64', 'chrome-headless-shell'); if (fs.existsSync(f)) return f;
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
const only = process.env.ONLY ? new Set(process.env.ONLY.split(',')) : null;
const want = new Set();
for (const s of [...(plan.shots || []), ...(plan.sheets || []).flatMap(sh => sh.tiles)]) {
  for (const a of s.actors) { want.add(a.body); if (a.anim) want.add(a.anim); for (const p of a.props || []) want.add(p.asset); }
  for (const st of s.statics || []) want.add(st.asset);
}
for (const id of want) await tab.evaluate(([i, u]) => window.load(i, u), [id, '/model/' + plan.assets[id]]);
const save = (file, url) => fs.writeFileSync(path.join(outDir, file), Buffer.from(url.split(',')[1], 'base64'));
for (const s of plan.shots || []) {
  if (only && !only.has(s.file)) continue;
  const r = await tab.evaluate(sp => window.shot(sp), s);
  const out = await tab.evaluate(([t, ttl]) => window.compose(t, 1, t[0].w, t[0].h, ttl),
    [[{ url: r.url, labels: r.labels, labelMode: s.labels, caption: s.caption, w: s.size[0], h: s.size[1] }], s.title || null]);
  save(s.file, out); console.log('shot', s.file);
}
for (const sh of plan.sheets || []) {
  if (only && !only.has(sh.file)) continue;
  const tiles = [];
  for (const t of sh.tiles) { const r = await tab.evaluate(sp => window.shot(sp), t); tiles.push({ url: r.url, labels: r.labels, labelMode: t.labels, caption: t.caption }); }
  const [tw, th] = sh.tiles[0].size;
  save(sh.file, await tab.evaluate(([t, c, w, h, ttl]) => window.compose(t, c, w, h, ttl), [tiles, sh.cols, tw, th, sh.title || null]));
  console.log('sheet', sh.file);
}
await browser.close(); server.close();
console.log(JSON.stringify({ errors }));
if (errors.length) process.exitCode = 1;
