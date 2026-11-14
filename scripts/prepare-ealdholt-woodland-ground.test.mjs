import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, mkdtemp, mkdir, writeFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { linearFromSrgb, meanLinearLuminance } from './prepare-aethelgard-photographic-ground.mjs';
import {
  BANK_ROUGHNESS_REMAP, GROUND_COLOUR_CLASSES, LITTER_COOLING, LIVING_SWARD_GRADE, USER_AGENT, VILLAGE_ATLAS_OLIVE, WOODLAND_GROUND_LAYERS, classifyGroundPixel, coolLitter,
  fetchEaldholtWoodlandGroundIntake, gradeLivingSward, livingSwardWeight, measureGroundAlbedo, measureLivingGreenReference, prepareEaldholtWoodlandGround, remapBankRoughness,
  VALLEY_GRASS_PALETTE, verifyAssetPageLicence, verifyWoodlandGroundSource, woodlandGroundMapSize, woodlandGroundMipBytes,
} from './prepare-ealdholt-woodland-ground.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const luminance = (r, g, b) => .2126 * linearFromSrgb(r / 255) + .7152 * linearFromSrgb(g / 255) + .0722 * linearFromSrgb(b / 255);
function image(width, height, pick) { const data = Buffer.alloc(width * height * 3); for (let i = 0; i < width * height; i++) data.set(pick(i), i * 3); return data; }
const index = rgb => (rgb[1] - rgb[0]) / (.2126 * rgb[0] + .7152 * rgb[1] + .0722 * rgb[2]);

test('colour classes and statistics follow the documented HSV bands, linear Rec. 709 luminance and block macro metrics', () => {
  assert.equal(classifyGroundPixel(.35, .5, .2), 'green'); assert.equal(classifyGroundPixel(.6, .45, .3), 'warm'); assert.equal(classifyGroundPixel(.5, .5, .3), 'olive');
  assert.equal(classifyGroundPixel(.5, .5, .48), 'neutral'); assert.equal(classifyGroundPixel(.01, .02, .01), 'neutral'); assert.equal(classifyGroundPixel(.2, .3, .6), 'other');
  assert.equal(GROUND_COLOUR_CLASSES.chromaticSaturation, .12);
  const half = image(64, 64, i => i % 2 ? [90, 128, 50] : [150, 110, 70]), stats = measureGroundAlbedo(half, 64, 64);
  assert.equal(stats.shares.green, .5); assert.equal(stats.shares.warm, .5); assert.equal(stats.greenToWarmRatio, 1);
  const rgba = Buffer.alloc(64 * 64 * 4); for (let i = 0; i < 64 * 64; i++) rgba.set([...half.subarray(i * 3, i * 3 + 3), 255], i * 4);
  assert.ok(Math.abs(stats.meanLuminance - meanLinearLuminance(rgba)) < 1e-8); assert.deepEqual(measureGroundAlbedo(rgba, 64, 64, 4).shares, stats.shares);
  assert.equal(stats.macroVariation, 0); assert.equal(stats.macroChromaVariation8, 0); assert.equal(stats.macroChromaVariation16, 0);
  // Left half green, right half brown: equal luminance blocks would hide this; the chroma metric must not.
  const split = image(64, 64, i => (i % 64) < 32 ? [96, 124, 60] : [134, 108, 72]), splitStats = measureGroundAlbedo(split, 64, 64);
  assert.ok(splitStats.macroChromaVariation8 > .3 && splitStats.macroChromaVariation16 > .3);
  assert.throws(() => measureGroundAlbedo(half, 60, 64)); assert.throws(() => measureGroundAlbedo(half.subarray(3), 64, 64)); assert.throws(() => measureGroundAlbedo(half, 64, 64, 2));
});

test('the living-sward grade uses a hard mask, keeps litter bit-identical and luminance photographic, and lands on the atlas olive', () => {
  assert.ok(Math.abs(LIVING_SWARD_GRADE.minimumGrassIndex - index(VILLAGE_ATLAS_OLIVE)) < 1e-4);
  assert.equal(LIVING_SWARD_GRADE.meanGrassIndex, LIVING_SWARD_GRADE.minimumGrassIndex);
  // Hard mask: red-brown litter (hue ~20), grey twigs and dark crevices get exactly zero; straw (hue ~44) and blades get one.
  assert.equal(livingSwardWeight(120 / 255, 72 / 255, 50 / 255), 0); assert.equal(livingSwardWeight(128 / 255, 124 / 255, 118 / 255), 0);
  assert.equal(livingSwardWeight(8 / 255, 7 / 255, 3 / 255), 0); assert.equal(livingSwardWeight(168 / 255, 146 / 255, 96 / 255), 1); assert.equal(livingSwardWeight(70 / 255, 140 / 255, 40 / 255), 1);
  // Living greens (reference), straw, red-brown litter and grey twigs.
  const palette = [[70, 140, 40], [168, 146, 96], [120, 72, 50], [128, 124, 118]], source = image(128, 128, i => palette[(i * 7 + (i >> 7)) % 4]);
  const reference = measureLivingGreenReference(source, 128, 128); assert.ok(reference.pixels > 1000 && reference.chromaticity[1] > .5);
  const { pixels, record } = gradeLivingSward(source, 128, 128, 3);
  assert.ok(Math.abs(record.calibration.achieved - LIVING_SWARD_GRADE.meanGrassIndex) < 2e-3); assert.equal(record.clippedPixels, 0);
  for (let i = 0; i < 128 * 128; i++) {
    const before = source.subarray(i * 3, i * 3 + 3), after = pixels.subarray(i * 3, i * 3 + 3);
    if (livingSwardWeight(before[0] / 255, before[1] / 255, before[2] / 255) === 0) assert.deepEqual([...after], [...before]);
    else assert.ok(Math.abs(luminance(...after) - luminance(...before)) < .006, `luminance at ${i}`);
  }
  let strawAt = 0; while (source[strawAt * 3] !== 168) strawAt++;
  const straw = [...pixels.subarray(strawAt * 3, strawAt * 3 + 3)]; assert.equal(classifyGroundPixel(straw[0] / 255, straw[1] / 255, straw[2] / 255), 'green');
  assert.throws(() => gradeLivingSward(image(64, 64, () => [120, 72, 50]), 64, 64, 3), /living green|vegetation/);
  assert.throws(() => gradeLivingSward(source, 128, 128, 3, { ...LIVING_SWARD_GRADE, meanGrassIndex: .2 }), /atlas olive/);
});

test('litter cooling and bank roughness remap are bounded, deterministic and leave structure alone', () => {
  const litter = image(64, 64, i => [[120, 80, 40], [90, 60, 30], [60, 50, 30]][i % 3]), cooled = coolLitter(litter, 64, 64);
  const centre = rgb => { const s = rgb[0] + rgb[1] + rgb[2]; return rgb.map(v => v / s); }, mean = data => { const m = [0, 0, 0]; for (let i = 0; i < data.length; i += 3) for (let c = 0; c < 3; c++) m[c] += linearFromSrgb(data[i + c] / 255); return m; };
  const before = centre(mean(litter)), after = centre(mean(cooled.pixels));
  assert.ok(after[0] < before[0] && after[2] > before[2], 'cooler: less red, more blue');
  const expected = before.map((value, c) => value + (LITTER_COOLING.target[c] - value) * LITTER_COOLING.amount);
  after.forEach((value, c) => assert.ok(Math.abs(value - expected[c]) < .01));
  for (let i = 0; i < 64 * 64; i++) assert.ok(Math.abs(luminance(...cooled.pixels.subarray(i * 3, i * 3 + 3)) - luminance(...litter.subarray(i * 3, i * 3 + 3))) < .006);
  assert.deepEqual(coolLitter(litter, 64, 64).pixels, cooled.pixels);
  const arm = Buffer.from([200, 0, 10, 180, 128, 0, 255, 255, 3]), remapped = remapBankRoughness(arm).pixels;
  assert.deepEqual([remapped[0], remapped[2], remapped[3], remapped[5], remapped[6], remapped[8]], [200, 10, 180, 0, 255, 3]);
  assert.equal(remapped[1], Math.round(BANK_ROUGHNESS_REMAP.offset * 255)); assert.equal(remapped[7], Math.round(Math.min(1, BANK_ROUGHNESS_REMAP.offset + BANK_ROUGHNESS_REMAP.scale) * 255));
  assert.ok(remapped[4] / 255 > .8 && remapped[4] / 255 < .9);
});

test('map roles and sizes, source identities, licences, held-back layers and output aliases fail closed', async () => {
  assert.deepEqual(Object.fromEntries(Object.entries(WOODLAND_GROUND_LAYERS).map(([name, spec]) => [name, [spec.folder, spec.roles.join('+'), spec.committed]])), {
    meadow: ['ground-meadow-v2', 'albedo+normal', true], woodland: ['ground-woodland-floor-v2', 'albedo', true], path: ['ground-path-v2', 'albedo+normal+orm', false], bank: ['ground-bank-v2', 'albedo+normal+orm', true] });
  assert.equal(woodlandGroundMapSize('desktop', 'orm'), 1024); assert.equal(woodlandGroundMapSize('quest', 'albedo'), 512); assert.equal(woodlandGroundMapSize('quest', 'normal'), 256);
  assert.equal(woodlandGroundMipBytes(1024), 5592404); assert.throws(() => woodlandGroundMipBytes(128));
  const entry = WOODLAND_GROUND_LAYERS.bank.sources.albedo;
  assert.throws(() => verifyWoodlandGroundSource(Buffer.from('wrong'), { url: 'https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/brown_mud_rocks_01/' + entry.file, size: entry.bytes, md5: entry.md5 }, 'bank', 'albedo'), /mismatch/);
  assert.throws(() => verifyWoodlandGroundSource(Buffer.alloc(entry.bytes), { url: 'https://example.invalid/x.jpg', size: entry.bytes, md5: entry.md5 }, 'bank', 'albedo'), /mismatch/);
  assert.throws(() => verifyWoodlandGroundSource(Buffer.alloc(1), {}, 'lawn', 'albedo'), /Unknown/);
  assert.throws(() => verifyAssetPageLicence('<html>"license":"https://creativecommons.org/licenses/by/4.0/" rock_path</html>', 'rock_path'), /CC0/);
  assert.equal(verifyAssetPageLicence('"license":"https://creativecommons.org/publicdomain/zero/1.0/" CC0 1.0 Universal rock_path', 'rock_path').url, 'https://polyhaven.com/a/rock_path');
  const directory = await mkdtemp(join(tmpdir(), 'woodland-ground-'));
  try {
    await assert.rejects(prepareEaldholtWoodlandGround(directory, directory), /separate/);
    await assert.rejects(prepareEaldholtWoodlandGround(directory, join(directory, 'out')), /separate/);
    const parent = join(directory, 'parent'); await mkdir(join(parent, 'ground-bank-v2'), { recursive: true }); await writeFile(join(parent, 'ground-bank-v2', 'sentinel'), 'kept');
    await assert.rejects(prepareEaldholtWoodlandGround(join(directory, 'intake'), parent, ['bank']), /overwrite/);
    assert.equal(await readFile(join(parent, 'ground-bank-v2', 'sentinel'), 'utf8'), 'kept');
    await assert.rejects(prepareEaldholtWoodlandGround(join(directory, 'intake'), parent, ['lawn']), /Unknown/);
    await assert.rejects(prepareEaldholtWoodlandGround(join(directory, 'intake'), parent, ['path']), /held-back/);
    // The fetcher sends the unique User-Agent and refuses a mismatched download before writing it.
    const seen = [];
    const fake = async (url, init) => { seen.push(init?.headers?.['User-Agent']);
      if (url.includes('legalcode')) return new Response('CC0 1.0 Universal');
      if (url.endsWith('/license')) return new Response('Our assets are all licensed as CC0');
      if (url.includes('/info/')) return new Response('{}');
      if (url.includes('/files/')) return new Response(JSON.stringify({ Diffuse: { '1k': { jpg: { url: 'https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/rock_path/rock_path_diff_1k.jpg', size: 1, md5: '0' } } } }));
      if (url.includes('polyhaven.com/a/')) return new Response('"license":"https://creativecommons.org/publicdomain/zero/1.0/" CC0 1.0 Universal rock_path');
      return new Response('bad bytes'); };
    const intake = join(directory, 'fetched');
    await assert.rejects(fetchEaldholtWoodlandGroundIntake(intake, ['path'], fake), /mismatch/);
    assert.ok(seen.length && seen.every(agent => agent === USER_AGENT)); assert.match(USER_AGENT, /Crownfall/);
    await assert.rejects(access(join(intake, 'source', 'rock_path_diff_1k.jpg')));
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('committed layer folders match their manifests, provenance, modifications and recorded analysis', async () => {
  const root = new URL('../main%20game/public/assets/legacy/environment/aethelgard/textures/', import.meta.url);
  let files = 0;
  for (const [name, spec] of Object.entries(WOODLAND_GROUND_LAYERS)) {
    const folder = new URL(spec.folder + '/', root);
    if (!spec.committed) { await assert.rejects(access(new URL('manifest.json', folder)), undefined, `${name} is held back`); continue; }
    const manifest = JSON.parse(await readFile(new URL('manifest.json', folder), 'utf8')), provenance = JSON.parse(await readFile(new URL('provenance.json', folder), 'utf8'));
    const legal = await readFile(new URL('CC0-1.0.txt', folder));
    assert.equal(manifest.version, 2); assert.equal(manifest.layer, name); assert.equal(manifest.assetId, spec.assetId); assert.equal(manifest.licence, 'CC0-1.0');
    assert.equal(manifest.modified, spec.modification !== null); assert.deepEqual(manifest.roles, [...spec.roles]);
    assert.equal(provenance.licence.spdx, 'CC0-1.0'); assert.match(provenance.licence.assetPage.statement, /publicdomain\/zero\/1\.0/); assert.equal(provenance.intakeDate, '2026-11-06');
    assert.ok(legal.includes('CC0 1.0 Universal')); assert.equal(provenance.licence.legalCodeSha256, sha(legal));
    const listed = new Map(provenance.files.map(entry => [entry.file, entry]));
    for (const file of ['CC0-1.0.txt', 'manifest.json', 'SOURCES.md']) { const bytes = await readFile(new URL(file, folder)); assert.equal(listed.get(file).sha256, sha(bytes)); assert.equal(listed.get(file).bytes, bytes.length); }
    for (const [profile, entry] of Object.entries(manifest.profiles)) {
      assert.deepEqual(Object.keys(entry.files), [...spec.roles]);
      assert.equal(entry.gpuBytesWithMipsEstimate, spec.roles.reduce((sum, role) => sum + woodlandGroundMipBytes(woodlandGroundMapSize(profile, role)), 0));
      for (const [role, file] of Object.entries(entry.files)) {
        const bytes = await readFile(new URL(file.file, folder)); files++;
        assert.equal(file.size, woodlandGroundMapSize(profile, role)); assert.equal(bytes.length, file.bytes); assert.equal(sha(bytes), file.sha256); assert.equal(listed.get(file.file).sha256, file.sha256);
        const { data, info } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
        assert.equal(info.width, file.size); assert.equal(info.height, file.size);
        if (role === 'albedo') {
          assert.ok(Math.abs(meanLinearLuminance(data) - entry.meanLuminance) < 1e-12);
          if (profile === 'desktop') {
            const rgb = Buffer.alloc(file.size * file.size * 3); for (let i = 0; i < file.size * file.size; i++) rgb.set(data.subarray(i * 4, i * 4 + 3), i * 3);
            if (spec.modification === null || spec.modification === 'bank-roughness') assert.equal(sha(rgb), provenance.sources.albedo.decodedRgbSha256, `${name} albedo must be the decoded source`);
            assert.deepEqual(measureGroundAlbedo(data, file.size, file.size, 4).shares, entry.analysis.shares);
          }
        }
        if (role === 'normal') for (let i = 0; i < data.length; i += 4 * 97) assert.ok(Math.abs(Math.hypot(data[i] / 255 * 2 - 1, data[i + 1] / 255 * 2 - 1, data[i + 2] / 255 * 2 - 1) - 1) < .02);
        if (role === 'orm' && name === 'bank') for (let i = 1; i < data.length; i += 4 * 61) assert.ok(data[i] >= Math.round(BANK_ROUGHNESS_REMAP.offset * 255) - 1, 'dry bank soil is matte');
      }
    }
  }
  assert.equal(files, 2 * (2 + 1 + 3));
  const meadow = JSON.parse(await readFile(new URL('ground-meadow-v2/manifest.json', root), 'utf8')), grade = JSON.parse(await readFile(new URL('ground-meadow-v2/provenance.json', root), 'utf8'));
  const analysis = meadow.profiles.desktop.analysis;
  assert.ok(analysis.shares.green > .6 && analysis.shares.green > analysis.shares.warm, 'meadow must be green-dominant'); assert.ok(grade.sourceAnalysis.shares.warm > grade.sourceAnalysis.shares.green);
  assert.ok(Math.abs(analysis.meanLuminance - grade.sourceAnalysis.meanLuminance) < 1e-3, 'grade preserves luminance');
  assert.ok(Math.abs(analysis.valleyGrassIndex - LIVING_SWARD_GRADE.meanGrassIndex) < 3e-3);
  // A few saturated straw pixels need a chromaticity channel clamped at zero (luminance still restored); recorded, and kept below 1%.
  assert.ok(grade.modificationRecord.albedo.clippedPixels < .01 * 1024 * 1024);
  assert.ok(typeof analysis.macroChromaVariation8 === 'number' && typeof analysis.macroChromaVariation16 === 'number');
  const woodland = JSON.parse(await readFile(new URL('ground-woodland-floor-v2/provenance.json', root), 'utf8')), bank = JSON.parse(await readFile(new URL('ground-bank-v2/provenance.json', root), 'utf8'));
  assert.equal(woodland.modificationRecord.albedo.amount, LITTER_COOLING.amount); assert.deepEqual(bank.modificationRecord.orm, { method: 'ARM green (roughness) remap; R (AO) and B (metallic) untouched', ...BANK_ROUGHNESS_REMAP });
});

// Run through tsx (npm run test:environment) so the TypeScript sources of the duplicated constants can be imported.
test('duplicated palette constants match their sources: the village ground atlas olive and the valley grass palette', async t => {
  let atlas, woodland;
  try { atlas = await import('../shared/legacy/aethelgard/environment/ground-atlas.ts'); woodland = await import('../shared/legacy/aethelgard/environment/woodland-ground.ts'); }
  catch { t.skip('imports TypeScript sources: run npm run test:environment'); return; }
  const { groundAlbedo } = atlas, { EALDHOLT_VALLEY_PALETTE_REFERENCE } = woodland;
  assert.deepEqual([...VALLEY_GRASS_PALETTE], [...EALDHOLT_VALLEY_PALETTE_REFERENCE.grass]);
  // groundAlbedo returns 8-bit sRGB of (olive x detail) on flat, fully grassed ground; its linear chromaticity is the olive's.
  const chroma = rgb => { const total = rgb[0] + rgb[1] + rgb[2]; return rgb.map(v => v / total); }, target = chroma(VILLAGE_ATLAS_OLIVE);
  let sum = [0, 0, 0];
  for (let i = 0; i < 400; i++) { const srgb = groundAlbedo(i * 1.37, 3, i * .91, 0, 1); sum = sum.map((v, c) => v + linearFromSrgb(srgb[c] / 255)); }
  chroma(sum).forEach((value, c) => assert.ok(Math.abs(value - target[c]) < .004, `atlas olive chromaticity channel ${c}: ${value} vs ${target[c]}`));
});
