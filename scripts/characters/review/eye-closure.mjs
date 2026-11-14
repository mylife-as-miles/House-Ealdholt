// Eye-closure gate: renders the actual exported resident GLBs with three.js in headless Chromium and measures how much
// of each eyeball stays visible when the blink morphs are fully on (round 2 critic blocker: LOD1 and Quest residents
// never finished a blink). Every vertex whose strongest joint is an eye joint is drawn white, everything else black
// (lids, lashes, hair and garments occlude as they do in the game), from the front at 0.3 m; the visible white area
// at blink 1 is compared with the area at rest.
//
//   node scripts/characters/review/eye-closure.mjs MODEL_DIR OUT.json [--fail-above 0.02] file.glb ...
//
// Writes per-file results and a PNG strip next to OUT.json. Exit code 1 when any file leaves more than the allowed
// fraction visible. Software rendering: a geometry check, not headset or performance evidence.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../..');
const { chromium } = await import(path.join(repo, 'main game/node_modules/playwright/index.mjs'));
const threeDir = path.join(repo, 'main game/node_modules/three');
const args = process.argv.slice(2);
const failAt = args.indexOf('--fail-above');
const limit = failAt >= 0 ? Number(args.splice(failAt, 2)[1]) : 0.02;
const [modelDir, outPath, ...files] = args;
if (!modelDir || !outPath || !files.length) { console.error('usage: eye-closure.mjs MODEL_DIR OUT.json [--fail-above F] file.glb ...'); process.exit(2); }

const page = `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;background:#000">
<script type="importmap">{"imports":{"three":"/three/build/three.module.js","three/addons/":"/three/examples/jsm/"}}</script>
<script type="module">
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
const renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true });
renderer.setPixelRatio(1); renderer.setSize(640, 320); document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene(); scene.background = new THREE.Color(0x000000);
const camera = new THREE.PerspectiveCamera(16, 2, 0.01, 10);
const loader = new GLTFLoader();
window.measure = async (url) => {
  const gltf = await loader.loadAsync(url); const root = gltf.scene; scene.clear(); scene.add(root);
  let eyeJoints = null, eyeBones = [];
  const meshes = [];
  root.traverse(o => { if (o.isSkinnedMesh) meshes.push(o); });
  for (const m of meshes) {
    const names = m.skeleton.bones.map(b => b.name);
    eyeJoints = new Set(['face_eye_l', 'face_eye_r'].map(n => names.indexOf(n)).filter(i => i >= 0));
    eyeBones = m.skeleton.bones.filter(b => b.name === 'face_eye_l' || b.name === 'face_eye_r');
    const g = m.geometry, si = g.attributes.skinIndex, sw = g.attributes.skinWeight, n = g.attributes.position.count;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      let best = -1, bw = -1;
      for (let k = 0; k < 4; k++) { const w = sw.getComponent(i, k); if (w > bw) { bw = w; best = si.getComponent(i, k); } }
      const v = eyeJoints.has(best) ? 1 : 0; col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = v;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    m.material = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide });
    m.frustumCulled = false;
  }
  root.updateMatrixWorld(true);
  const c = new THREE.Vector3(); for (const b of eyeBones) { const p = new THREE.Vector3(); b.getWorldPosition(p); c.add(p); } c.multiplyScalar(1 / Math.max(1, eyeBones.length));
  camera.position.set(c.x, c.y, c.z + 0.3); camera.lookAt(c); camera.updateProjectionMatrix();
  const count = (blink) => {
    for (const m of meshes) {
      if (!m.morphTargetDictionary) continue;
      for (const [k, i] of Object.entries(m.morphTargetDictionary)) m.morphTargetInfluences[i] = (k === 'eyeBlinkLeft' || k === 'eyeBlinkRight') ? blink : 0;
    }
    renderer.render(scene, camera);
    const gl = renderer.getContext(); const px = new Uint8Array(640 * 320 * 4); gl.readPixels(0, 0, 640, 320, gl.RGBA, gl.UNSIGNED_BYTE, px);
    let white = 0; for (let i = 0; i < px.length; i += 4) if (px[i] > 127) white++;
    return { white, image: renderer.domElement.toDataURL('image/png') };
  };
  const hasBlink = meshes.some(m => m.morphTargetDictionary && m.morphTargetDictionary.eyeBlinkLeft !== undefined);
  const open = count(0), half = count(0.5), closed = count(1);
  return { hasBlinkMorph: hasBlink, eyeVertexMeshes: meshes.length, openPixels: open.white, halfPixels: half.white, closedPixels: closed.white,
    visibleFraction: open.white ? closed.white / open.white : null, images: [open.image, half.image, closed.image] };
};
window.ready = true;
</script></body></html>`;

const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  if (url === '/') { res.setHeader('Content-Type', 'text/html'); return res.end(page); }
  let file = null;
  if (url.startsWith('/three/')) file = path.join(threeDir, url.slice(7));
  if (url.startsWith('/model/')) { const root = path.resolve(modelDir), cand = path.resolve(root, url.slice(7)); if (cand.startsWith(root + path.sep)) file = cand; }
  if (!file || !fs.existsSync(file)) { res.statusCode = 404; return res.end('missing'); }
  res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : 'application/octet-stream');
  fs.createReadStream(file).pipe(res);
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
const browser = await chromium.launch({ headless: true, executablePath: chromiumPath(), args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const tab = await browser.newPage({ viewport: { width: 700, height: 400 } });
const errors = []; tab.on('pageerror', e => errors.push(e.message));
await tab.goto(`http://127.0.0.1:${server.address().port}/`);
await tab.waitForFunction(() => window.ready === true, null, { timeout: 60000 });
const results = {};
let failed = false;
fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
for (const f of files) {
  const r = await tab.evaluate(u => window.measure(u), '/model/' + f);
  const strip = path.join(path.dirname(path.resolve(outPath)), path.basename(f, '.glb') + '-eye-closure.png');
  const sheet = await tab.evaluate(async (imgs) => {
    const cv = document.createElement('canvas'); cv.width = 640 * 3; cv.height = 320; const g = cv.getContext('2d');
    for (let i = 0; i < imgs.length; i++) { const im = new Image(); im.src = imgs[i]; await im.decode(); g.drawImage(im, i * 640, 0); }
    g.font = '600 18px sans-serif'; g.fillStyle = '#ff5'; ['blink 0', 'blink 0.5', 'blink 1'].forEach((t, i) => g.fillText(t, i * 640 + 10, 24));
    return cv.toDataURL('image/png');
  }, r.images);
  fs.writeFileSync(strip, Buffer.from(sheet.split(',')[1], 'base64'));
  delete r.images;
  r.pass = r.hasBlinkMorph && r.visibleFraction !== null && r.visibleFraction <= limit;
  if (!r.pass) failed = true;
  results[f] = r;
  console.log(f, JSON.stringify(r));
}
fs.writeFileSync(outPath, JSON.stringify({ limit, errors, results }, null, 1));
await browser.close(); server.close();
process.exit(failed ? 1 : 0);
