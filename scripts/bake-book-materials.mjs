/** Reproducible offline bake of the licensed source maps. No runtime procedural grain. */
import sharp from 'sharp';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

const cache = resolve('artifacts/source-textures/book-cover-v1');
const output = resolve('main game/public/assets/chronicles/book-cover-v1');
await mkdir(output, { recursive: true });
if (process.argv.includes('--fetch')) {
  // Published outputs carry exact source URLs and hashes, so a fresh checkout is reproducible.
  const pins = JSON.parse(await readFile(resolve(output, 'sources.json'), 'utf8'));
  await mkdir(cache, { recursive: true });
  for (const asset of pins.sources) {
    const metadata = {};
    for (const map of asset.maps) {
      const response = await fetch(map.url, { signal: AbortSignal.timeout(45000), headers: { 'User-Agent': 'Crownfall-local-material-preparation/1.0' } });
      if (!response.ok) throw new Error(`${map.url}: HTTP ${response.status}`);
      const bytes = Buffer.from(await response.arrayBuffer());
      if (createHash('md5').update(bytes).digest('hex') !== map.md5) throw new Error(`Source hash mismatch: ${map.url}`);
      await writeFile(resolve(cache, `${asset.asset}-${map.key.toLowerCase()}.jpg`), bytes);
      metadata[map.key] = { '2k': { jpg: map } };
    }
    await writeFile(resolve(cache, `${asset.asset}-files.json`), JSON.stringify(metadata));
  }
}
const S = 2048, sourceSize = 2048;
const source = {};
for (const asset of ['brown_leather', 'rusty_metal_04']) {
  const metadata = JSON.parse(await readFile(resolve(cache, `${asset}-files.json`), 'utf8'));
  source[asset] = {};
  for (const key of ['Diffuse', 'nor_gl', 'arm']) {
    const path = resolve(cache, `${asset}-${key.toLowerCase()}.jpg`), bytes = await readFile(path);
    if (createHash('md5').update(bytes).digest('hex') !== metadata[key]['2k'].jpg.md5) throw new Error(`Source hash mismatch: ${path}`);
    source[asset][key] = await sharp(bytes).removeAlpha().raw().toBuffer();
  }
}
const color = Buffer.alloc(S * S * 3), normal = Buffer.alloc(S * S * 3), orm = Buffer.alloc(S * S * 3), quest = Buffer.alloc(S * S * 3);
for (let i = 0; i < S * S; i++) { normal.set([128, 128, 255], i * 3); orm.set([255, 220, 0], i * 3); }
const clamp = (n, a = 0, b = 1) => Math.max(a, Math.min(b, n));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const sample = (data, u, v, channel) => data[((Math.floor(((v % 1 + 1) % 1) * sourceSize) * sourceSize + Math.floor(((u % 1 + 1) % 1) * sourceSize)) * 3) + channel] / 255;
const gaussian = (n, w) => Math.exp(-(n * n) / (w * w));
const h = (u, v) => {
  const edge = Math.min(u * .526, (1 - u) * .526, v * .783, (1 - v) * .783);
  // Double blind-tooled border and a shallow panel depression, in metres.
  return -.00024 * gaussian(edge - .016, .0008) - .00014 * gaussian(edge - .020, .0006)
    - .00010 * gaussian(edge - .032, .0012) - .00016 * (1 - smooth(.003, .018, edge));
};
function writePixel(x, y, rgb, n, arm, light) {
  const i = (y * S + x) * 3;
  const length = Math.hypot(...n);
  for (let c = 0; c < 3; c++) {
    color[i + c] = Math.round(clamp(rgb[c]) * 255);
    normal[i + c] = Math.round((n[c] / length * .5 + .5) * 255);
    orm[i + c] = Math.round(clamp(arm[c]) * 63) * 4;
    quest[i + c] = Math.round(clamp(rgb[c] * light) * 255);
  }
}
function leather(x, y, u, v) {
  const src = source.brown_leather, repeatV = 1.49;
  const edge = Math.min(u * .526, (1 - u) * .526, v * .783, (1 - v) * .783);
  const grain = sample(src.Diffuse, u, v * repeatV, 0);
  const worn = (1 - smooth(.001, .013, edge)) * (.45 + .55 * grain);
  const groove = gaussian(edge - .016, .0011) * .24 + gaussian(edge - .020, .0008) * .16 + gaussian(edge - .032, .0016) * .1;
  const recess = smooth(.032, .042, edge) * .045;
  const variation = 1 + .025 * Math.sin(u * 11 + Math.sin(v * 9));
  const rgb = [0, 1, 2].map(c => sample(src.Diffuse, u, v * repeatV, c) * [.80, .75, .84][c] * (1 - groove - recess) * variation + worn * [.10, .065, .038][c]);
  const eps = .0005;
  const dx = (h(u + eps, v) - h(u - eps, v)) / (2 * eps * .526);
  const dy = -(h(u, v + eps) - h(u, v - eps)) / (2 * eps * .783);
  const n = [sample(src.nor_gl, u, v * repeatV, 0) * 2 - 1, sample(src.nor_gl, u, v * repeatV, 1) * 2 - 1, 1];
  n[0] = n[0] * .68 - dx; n[1] = n[1] * .68 - dy;
  const ao = sample(src.arm, u, v * repeatV, 0) * (1 - groove * .45);
  const rough = clamp(sample(src.arm, u, v * repeatV, 1) * .42 + .39 - worn * .12, .5, .92);
  const diffuseLight = .86 + .16 * Math.max(0, -.35 * n[0] + .45 * n[1] + .8 * n[2]);
  writePixel(x, y, rgb, n, [ao, rough, 0], diffuseLight);
}
function bronze(x, y, u, v) {
  const src = source.rusty_metal_04, lum = sample(src.Diffuse, u, v, 0);
  const patina = smooth(.15, .42, 1 - lum) * .10;
  const rgb = [.40 + lum * .27, .27 + lum * .21 + patina * .18, .12 + lum * .14 + patina * .12];
  const n = [0, 1, 2].map(c => sample(src.nor_gl, u, v, c) * 2 - 1); n[0] *= .13; n[1] *= .13;
  const rough = clamp(sample(src.arm, u, v, 1) * .35 + .27, .3, .68);
  const ao = .85 + .15 * sample(src.arm, u, v, 0);
  const light = .77 + .27 * Math.max(0, -.4 * n[0] + .4 * n[1] + .8 * n[2]);
  writePixel(x, y, rgb, n, [ao, rough, .78], light);
}
function paper(x, y, u, v) {
  const fiber = sample(source.brown_leather.Diffuse, u * 3, v * .35, 0);
  const line = Math.pow(.5 + .5 * Math.sin(v * Math.PI * 190 + Math.sin(u * 41) * .4), 10);
  const stain = .045 * Math.sin(u * 18 + Math.sin(v * 9));
  const shade = .92 + fiber * .1 - line * .09 + stain;
  writePixel(x, y, [.76 * shade, .68 * shade, .50 * shade], [0, line * .06, 1], [.97, .94, 0], .95);
}
// Sixteen pixels of edge dilation keep mip filtering away from neighbouring surfaces.
for (const [rect, bake] of [[[16, 16, 1344, 2000], leather], [[1392, 16, 640, 640], bronze], [[1392, 704, 640, 320], paper]]) {
  const [x, y, w, height] = rect;
  for (let j = -16; j < height + 16 && j + y < S; j++) for (let i = -16; i < w + 16; i++) {
    if (x + i >= 0 && x + i < S && y + j >= 0) bake(x + i, y + j, clamp(i / (w - 1)), clamp(j / (height - 1)));
  }
}
const raw = { width: S, height: S, channels: 3 };
await sharp(color, { raw }).webp({ quality: 94 }).toFile(resolve(output, 'book-basecolor.webp'));
await sharp(normal, { raw }).webp({ quality: 97, smartSubsample: true }).toFile(resolve(output, 'book-normal.webp'));
await sharp(orm, { raw }).resize(1024, 1024).webp({ lossless: true }).toFile(resolve(output, 'book-orm.webp'));
await sharp(quest, { raw }).resize(1024, 1024).webp({ quality: 94 }).toFile(resolve(output, 'book-quest.webp'));
const provenance = { version: 1, license: 'CC0-1.0', licenseUrl: 'https://polyhaven.com/license', sources: [] };
for (const asset of ['brown_leather', 'rusty_metal_04']) {
  const metadata = JSON.parse(await readFile(resolve(cache, `${asset}-files.json`), 'utf8'));
  provenance.sources.push({ asset, url: `https://polyhaven.com/a/${asset}`, author: asset === 'brown_leather' ? 'Rob Tuytel' : 'Amal Kumar', maps: ['Diffuse', 'nor_gl', 'arm'].map(key => ({ key, ...metadata[key]['2k'].jpg })) });
}
provenance.bakes = [];
for (const name of ['basecolor', 'normal', 'orm', 'quest']) {
  const bytes = await readFile(resolve(output, `book-${name}.webp`));
  provenance.bakes.push({ file: `book-${name}.webp`, size: name === 'quest' || name === 'orm' ? 1024 : S, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
}
await writeFile(resolve(output, 'sources.json'), JSON.stringify(provenance, null, 2) + '\n');
console.log(JSON.stringify(provenance.bakes, null, 2));
