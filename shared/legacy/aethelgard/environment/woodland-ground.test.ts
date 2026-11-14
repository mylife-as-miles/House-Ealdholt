import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { villageSurfaceBlend } from './laas-surface';
import {
  EALDHOLT_BANK_EXPOSURE, EALDHOLT_CANOPY_COVER_SCALE, EALDHOLT_CANOPY_MAX_CROWNS, EALDHOLT_MEADOW_VARIATION, EALDHOLT_VALLEY_BANK_BAND, EALDHOLT_VALLEY_GRASS_INDEX_RAMP, EALDHOLT_VALLEY_NOISE,
  EALDHOLT_VALLEY_PALETTE_REFERENCE, EALDHOLT_VALLEY_ROCK, EALDHOLT_VALLEY_STEEP, EALDHOLT_WOODLAND_BANK_ART_VERSION, EALDHOLT_WOODLAND_FLOOR, EALDHOLT_WOODLAND_FLOOR_COMPOSITE_CHROMATICITY,
  EALDHOLT_WOODLAND_GROUND_BAKE_PALETTE, EALDHOLT_WOODLAND_GROUND_CACHE_KEY, EALDHOLT_WOODLAND_GROUND_CHROMATICITY, EALDHOLT_WOODLAND_GROUND_COMMITTED_LAYERS,
  EALDHOLT_WOODLAND_GROUND_LAYER_NAMES, EALDHOLT_WOODLAND_GROUND_LAYERS, EALDHOLT_WOODLAND_KIT_GRADES, EALDHOLT_WOODLAND_VALLEY_FETCHES, createEaldholtBankExposureSections, createEaldholtCanopyCoverField,
  ealdholtCanopyCrownCaps, ealdholtCanopyDecode, ealdholtCanopyLaasFields, ealdholtCanopyShade, ealdholtCanopyTextureLayout, ealdholtCanopyTierSelector, ealdholtFlowerPetalWeight, ealdholtFlowerPixelGrade,
  ealdholtKitColourMultiplier, ealdholtMeadowVariation, ealdholtPondProbeValleyArtStatus, ealdholtSrgbSaturation, ealdholtValleyBankBandShare, ealdholtValleyBankBandWidth, ealdholtValleyCanopyBreakup,
  ealdholtValleyFields, ealdholtValleyGroundWeights, ealdholtValleyNoise, ealdholtValleyLayerAlbedo, ealdholtValleyRockWeight, ealdholtValleySteepWeight, ealdholtWoodlandGroundLayerMipBytes,
  ealdholtWoodlandGroundMapSize, ealdholtWoodlandGroundMipBytes, ealdholtWoodlandGroundWeights, ealdholtWoodlandHerbShare, patchEaldholtWoodlandValleySurface, readEaldholtWoodlandGroundManifest,
  sampleEaldholtBankExposure, sampleEaldholtBankSection, type EaldholtCanopyCrown, type EaldholtCanopyField, type EaldholtWoodlandGroundLayer,
} from './woodland-ground';
import { createEaldholtRiverValleyBuffers, type EaldholtTerrainEdges } from './river-valley';
import { createEaldholtCoastalValleyBuffers } from './coastal-valley';

const textures = new URL('../../../../main%20game/public/assets/legacy/environment/aethelgard/textures/', import.meta.url);
const committed = (layer: EaldholtWoodlandGroundLayer) => JSON.parse(readFileSync(new URL(`${EALDHOLT_WOODLAND_GROUND_LAYERS[layer].folder}/manifest.json`, textures), 'utf8'));
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const Y = (rgb: readonly number[]) => .2126 * rgb[0] + .7152 * rgb[1] + .0722 * rgb[2];
function fixture(layer: EaldholtWoodlandGroundLayer = 'meadow') {
  const spec = EALDHOLT_WOODLAND_GROUND_LAYERS[layer];
  return { version: 2, set: 'ealdholt-woodland-ground', layer, assetId: spec.assetId, sourceUrl: spec.sourceUrl, licence: 'CC0-1.0', tileMetres: spec.tileMetres,
    laasWeight: spec.laasWeight, modified: spec.modified, profiles: Object.fromEntries((['desktop', 'quest'] as const).map(profile => [profile, { meanLuminance: .1,
      files: Object.fromEntries(spec.roles.map(role => { const size = ealdholtWoodlandGroundMapSize(profile, role); return [role, { file: `${spec.prefix}-${profile}-${role}-${size}.webp`, size, bytes: 100, sha256: 'b'.repeat(64) }]; })) }])) };
}

test('the selected set is frozen, distinct, ships only sampled maps and orders reflectance woodland < bank < meadow < path', () => {
  assert.deepEqual(EALDHOLT_WOODLAND_GROUND_LAYER_NAMES, ['meadow', 'woodland', 'path', 'bank']);
  assert.deepEqual(EALDHOLT_WOODLAND_GROUND_COMMITTED_LAYERS, ['meadow', 'woodland', 'bank']);
  assert.ok(Object.isFrozen(EALDHOLT_WOODLAND_GROUND_LAYERS) && EALDHOLT_WOODLAND_GROUND_LAYER_NAMES.every(name => Object.isFrozen(EALDHOLT_WOODLAND_GROUND_LAYERS[name]) && Object.isFrozen(EALDHOLT_WOODLAND_GROUND_LAYERS[name].roles)));
  const specs = EALDHOLT_WOODLAND_GROUND_LAYER_NAMES.map(name => EALDHOLT_WOODLAND_GROUND_LAYERS[name]);
  for (const key of ['folder', 'prefix', 'assetId'] as const) assert.equal(new Set(specs.map(spec => spec[key])).size, 4);
  assert.ok(specs.every(spec => /-v2$/.test(spec.folder)));
  assert.deepEqual(specs.map(spec => spec.laasWeight), ['grass', 'forestFloor', 'soil', 'soil-wet']);
  assert.deepEqual(specs.map(spec => spec.roles.join('+')), ['albedo+normal', 'albedo', 'albedo+normal+orm', 'albedo+normal+orm']);
  assert.deepEqual(specs.filter(spec => spec.modified).map(spec => spec.layer), ['meadow', 'woodland', 'bank']);
  const y = Object.fromEntries(specs.map(spec => [spec.layer, spec.targetLuminance]));
  assert.ok(y.woodland < y.bank && y.bank < y.meadow && y.meadow < y.path);
  // The meadow sits on the village atlas olive (Y 0.0694); the bank is about 0.86x and the floor about 0.79x of it.
  assert.ok(Math.abs(y.meadow - Y([.052, .079, .026])) < .002); assert.ok(Math.abs(y.bank / y.meadow - .857) < .01); assert.ok(Math.abs(y.woodland / y.meadow - .786) < .01);
  assert.match(EALDHOLT_WOODLAND_BANK_ART_VERSION, /earth-grass-rock/); assert.notEqual(EALDHOLT_WOODLAND_BANK_ART_VERSION, 'grounded-bank-earth-grass-rock-v2');
  assert.match(EALDHOLT_WOODLAND_GROUND_CACHE_KEY, /^:polyhaven-woodland-ground-v2$/);
  assert.equal(ealdholtWoodlandGroundMapSize('desktop', 'normal'), 1024); assert.equal(ealdholtWoodlandGroundMapSize('quest', 'albedo'), 512); assert.equal(ealdholtWoodlandGroundMapSize('quest', 'orm'), 256);
  assert.equal(ealdholtWoodlandGroundMipBytes(1024), 5592404); assert.equal(ealdholtWoodlandGroundMipBytes(256), 349524); assert.throws(() => ealdholtWoodlandGroundMipBytes(2048));
  assert.equal(ealdholtWoodlandGroundLayerMipBytes('bank', 'quest'), ealdholtWoodlandGroundMipBytes(512) + 2 * ealdholtWoodlandGroundMipBytes(256));
  assert.equal(ealdholtWoodlandGroundLayerMipBytes('woodland', 'desktop'), ealdholtWoodlandGroundMipBytes(1024));
});

test('committed layer folders: strict manifests, every file hash and byte count verified, held-back path absent', () => {
  let files = 0;
  for (const layer of EALDHOLT_WOODLAND_GROUND_COMMITTED_LAYERS) {
    const folder = new URL(EALDHOLT_WOODLAND_GROUND_LAYERS[layer].folder + '/', textures), manifest = committed(layer);
    const provenance = JSON.parse(readFileSync(new URL('provenance.json', folder), 'utf8')), listed = new Map<string, { bytes: number; sha256: string }>(provenance.files.map((entry: { file: string; bytes: number; sha256: string }) => [entry.file, entry]));
    for (const profile of ['desktop', 'quest'] as const) {
      const before = JSON.stringify(manifest), result = readEaldholtWoodlandGroundManifest(manifest, layer, profile);
      assert.equal(JSON.stringify(manifest), before); assert.deepEqual(Object.keys(result.files), [...EALDHOLT_WOODLAND_GROUND_LAYERS[layer].roles]);
      assert.equal(result.gpuBytesWithMipsEstimate, ealdholtWoodlandGroundLayerMipBytes(layer, profile));
      assert.ok(result.meanLuminance > .02 && result.meanLuminance < .4); assert.equal(result.targetLuminance, EALDHOLT_WOODLAND_GROUND_LAYERS[layer].targetLuminance);
      for (const file of Object.values(result.files)) {
        const bytes = readFileSync(new URL(file!.file, folder)); files++;
        assert.equal(bytes.length, file!.bytes, `${file!.file} bytes`); assert.equal(sha256(bytes), file!.sha256, `${file!.file} sha256`);
        assert.equal(listed.get(file!.file)?.sha256, file!.sha256);
      }
    }
    for (const file of ['CC0-1.0.txt', 'manifest.json', 'SOURCES.md']) { const bytes = readFileSync(new URL(file, folder)); assert.equal(listed.get(file)?.sha256, sha256(bytes)); assert.equal(listed.get(file)?.bytes, bytes.length); }
    assert.equal(provenance.intakeDate, '2026-11-06'); assert.equal(provenance.licence.spdx, 'CC0-1.0'); assert.match(provenance.licence.assetPage.statement, /publicdomain\/zero\/1\.0/);
  }
  assert.equal(files, 2 * (2 + 1 + 3));
  assert.equal(existsSync(new URL(EALDHOLT_WOODLAND_GROUND_LAYERS.path.folder + '/manifest.json', textures)), false, 'the path layer is held back until an in-situ need is shown');
  for (const retired of ['ground-meadow-v1', 'ground-woodland-floor-v1', 'ground-path-v1', 'ground-bank-v1']) assert.equal(existsSync(new URL(retired + '/manifest.json', textures)), false, retired);
});

test('foreign sources, renamed or extra files, wrong sizes, malformed values and accessors fail before any texture work', () => {
  const changes: ((value: any) => void)[] = [
    value => { value.assetId = 'leafy_grass'; }, value => { value.sourceUrl = 'https://example.invalid/a/forrest_ground_01'; }, value => { value.licence = 'CC-BY-4.0'; },
    value => { value.layer = 'woodland'; }, value => { value.tileMetres = 2.3; }, value => { value.modified = false; }, value => { value.laasWeight = 'soil'; },
    value => { value.version = 1; }, value => { value.set = 'other'; }, value => { value.profiles.quest.files.normal.size = 512; }, value => { value.profiles.quest.meanLuminance = NaN; },
    value => { value.profiles.quest.meanLuminance = 1.5; }, value => { value.profiles.quest.files.albedo.file = '../grass-leafy-v1/grass-quest-albedo-512.webp'; },
    value => { value.profiles.quest.files.normal.file = 'meadow-quest-normal-512.webp'; }, value => { value.profiles.quest.files.orm = { file: 'meadow-quest-orm-256.webp', size: 256, bytes: 1, sha256: 'b'.repeat(64) }; },
    value => { delete value.profiles.quest.files.normal; }, value => { value.profiles.quest.files.albedo.sha256 = 'private'; }, value => { value.profiles.quest.files.normal.bytes = Infinity; },
    value => { value.profiles.quest.files.normal.bytes = 64 * 1024 * 1024; }, value => { value.profiles.quest.files = []; }, value => { delete value.profiles.quest; },
  ];
  for (const change of changes) { const value = fixture(); change(value); assert.throws(() => readEaldholtWoodlandGroundManifest(value, 'meadow', 'quest'), /woodland ground/); }
  assert.throws(() => readEaldholtWoodlandGroundManifest(fixture(), 'woodland', 'quest'));
  assert.throws(() => readEaldholtWoodlandGroundManifest(fixture(), 'meadow', 'web' as never));
  assert.throws(() => readEaldholtWoodlandGroundManifest(fixture(), 'lawn' as never, 'quest'));
  let calls = 0; const value = fixture(); Object.defineProperty(value, 'profiles', { get() { calls++; throw Error('getter'); } });
  assert.throws(() => readEaldholtWoodlandGroundManifest(value, 'meadow', 'quest')); assert.equal(calls, 0);
  assert.throws(() => readEaldholtWoodlandGroundManifest(Object.create(fixture()), 'meadow', 'quest'));
  for (const layer of EALDHOLT_WOODLAND_GROUND_LAYER_NAMES) for (const profile of ['desktop', 'quest'] as const) assert.equal(readEaldholtWoodlandGroundManifest(fixture(layer), layer, profile).layer, layer);
});

test('LAAS weights map onto meadow, woodland, path, bank and rock without losing or inventing coverage', () => {
  const samples: [number, number, number, number][] = [];
  for (const slope of [0, .3, .7, 1.4]) for (const vegetation of [0, .5, 1]) for (const moisture of [0, .5, 1]) for (const rockExposure of [0, .6]) samples.push([slope, vegetation, moisture, rockExposure]);
  for (const [slope, vegetationDensity, moisture, rockExposure] of samples) for (const pathMask of [0, .5, 1]) for (const shoreWetness of [0, .4, 1]) {
    const laas = villageSurfaceBlend({ slope, vegetationDensity, moisture, rockExposure, riverDepthMetres: 0, shoreWetness }).weights;
    const w = ealdholtWoodlandGroundWeights(laas, { pathMask, shoreWetness }), values = [w.meadow, w.woodland, w.path, w.bank, w.rock];
    assert.ok(values.every(value => value >= 0 && Number.isFinite(value))); assert.ok(Math.abs(values.reduce((a, b) => a + b, 0) - 1) < 1e-9); assert.equal(w.rock, laas.rock);
    if (pathMask === 0 && shoreWetness === 0) { assert.equal(w.meadow, laas.grass); assert.equal(w.woodland, laas.forestFloor); assert.equal(w.path, laas.soil); assert.equal(w.bank, 0); }
    if (pathMask === 1) { assert.equal(w.meadow, 0); assert.equal(w.woodland, 0); assert.equal(w.bank, 0); }
  }
  assert.throws(() => ealdholtWoodlandGroundWeights({ soil: .5, grass: .2, forestFloor: 0, rock: 0 }, { pathMask: 0, shoreWetness: 0 }), /sum to one/);
  assert.throws(() => ealdholtWoodlandGroundWeights({ soil: 1, grass: 0, forestFloor: 0, rock: 0 }, { pathMask: NaN, shoreWetness: 0 }));
  const open = { slope: .1, vegetationDensity: .8, moisture: 0, rockExposure: 0, riverDepthMetres: 0, shoreWetness: 0 };
  assert.deepEqual(ealdholtCanopyLaasFields(open, 0), open);
  const covered = villageSurfaceBlend(ealdholtCanopyLaasFields(open, 1)).weights; assert.ok(covered.forestFloor > .85 && covered.forestFloor > covered.grass);
});


// A synthetic source envelope run through the real shared valley builders (no private data).
function syntheticEdges(): EaldholtTerrainEdges {
  const minX = -100.3, maxX = 100.2, minZ = -80.1, maxZ = 80.2, h = (a: number, b: number) => 3 + .4 * Math.sin(a * .05) * Math.cos(b * .05);
  const side = (lo: number, hi: number, height: (t: number) => number) => Array.from({ length: 21 }, (_, i) => { const t = lo + (hi - lo) * i / 20; return [t, height(t)] as const; });
  return { minX, maxX, minZ, maxZ, west: side(minZ, maxZ, z => h(minX, z)), east: side(minZ, maxZ, z => h(maxX, z)), north: side(minX, maxX, x => h(x, minZ)), south: side(minX, maxX, x => h(x, maxZ)) };
}
const smooth01 = (low: number, high: number, value: number) => { const t = Math.max(0, Math.min(1, (value - low) / (high - low))); return t * t * (3 - 2 * t); };
/** The shader's own non-periodic fields (CPU twin of ealdholtValleyFields()). */
const broadField = (x: number, z: number) => ealdholtValleyFields(x, z).field, fineField = (x: number, z: number) => ealdholtValleyFields(x, z).fine;

test('valley twin v5: rock follows slope and height only, steep faces are bank soil, the band follows the waterline and canopy splits the meadow', () => {
  // Flat ground is never rock at any height (the old neutral-palette term made flat grey strips rock).
  for (const height of [0, 2, 5, 20]) assert.equal(ealdholtValleyRockWeight(0, height, 0), 0);
  assert.ok(ealdholtValleyRockWeight(.5, 6, 0) > .99); assert.ok(ealdholtValleyRockWeight(.5, 1, 0) < .4);
  // A steep face low above the water is bank soil, not top-down meadow; high above it, rock.
  const lowFace = ealdholtValleyGroundWeights({ distance: 3, exposure: 0, slope: .7, wetness: 0, heightAboveWater: 1 });
  assert.ok(lowFace.meadow < .01 && lowFace.bank > .7, JSON.stringify(lowFace));
  // A sharp step whose smoothed vertex normals look gentle is still steep by its face slope.
  const step = ealdholtValleyGroundWeights({ distance: 3, exposure: 0, slope: .15, faceSlope: .74, wetness: 0, heightAboveWater: 1.5 });
  assert.ok(step.meadow < .01 && step.bank > .5, JSON.stringify(step));
  const highFace = ealdholtValleyGroundWeights({ distance: 30, exposure: 0, slope: .7, wetness: 0, heightAboveWater: 8 });
  assert.ok(highFace.rock > .99 && highFace.meadow < .01, JSON.stringify(highFace));
  assert.equal(ealdholtValleySteepWeight(EALDHOLT_VALLEY_STEEP.slope[0]), 0); assert.equal(ealdholtValleySteepWeight(EALDHOLT_VALLEY_STEEP.slope[1]), 1);
  // Current v5 physical widths: thin inner fringe, intermittent narrower outer
  // scarps, and at most 1.2 m additional slope width. The stale v4 bounds failed
  // unchanged before the exact-authored-knot lookup was added.
  const widthNear=(actual:number,expected:number,label:string)=>assert.ok(Math.abs(actual-expected)<1e-12,`${label}: ${actual}m versus ${expected}m`);
  widthNear(ealdholtValleyBankBandWidth(0, 0, .5),.2275,'neutral inner fringe');
  widthNear(ealdholtValleyBankBandWidth(1, 0, .5),1.17,'neutral outer bank');
  widthNear(ealdholtValleyBankBandWidth(1, 0, 1),2.07,'high-field outer bank');
  widthNear(ealdholtValleyBankBandWidth(1, 0, 0),.27,'low field breaks a cut bank to a fringe');
  widthNear(ealdholtValleyBankBandWidth(1, .5, .5)-ealdholtValleyBankBandWidth(1, 0, .5),1.2,'steep slopes widen it');
  widthNear(ealdholtValleyBankBandWidth(0, 0, 1),1.5025,'inner bends get occasional muddy breaks');
  assert.equal(ealdholtValleyBankBandShare({ distance: 20, exposure: 1, slope: 0, wetness: 0 }), 0);
  assert.ok(Math.abs(ealdholtValleyBankBandShare({ distance: 20, exposure: 0, slope: 0, wetness: 1 }) - EALDHOLT_VALLEY_BANK_BAND.fringe) < 1e-12, 'the wettest waterline keeps a fringe');
  for (const distance of [-1, 0, .5, 1, 2, 4, 8]) for (const exposure of [0, .5, 1]) for (const slope of [0, .3, .7]) for (const field of [0, .5, 1]) for (const fine of [0, 1]) for (const wetness of [0, .5, 1])
    for (const canopyCover of [0, .5, 1]) for (const heightAboveWater of [0, 1.5, 6]) {
      const input = { distance, exposure, slope, field, fine, wetness, heightAboveWater, canopyCover }, share = ealdholtValleyBankBandShare(input);
      assert.ok(share >= 0 && share <= EALDHOLT_VALLEY_BANK_BAND.share[1] + 1e-12, 'a scarp is never a solid block');
      const w = ealdholtValleyGroundWeights(input), values = [w.bank, w.meadow, w.woodland, w.rock];
      assert.ok(values.every(value => value >= -1e-12 && Number.isFinite(value)) && Math.abs(values.reduce((a, b) => a + b, 0) - 1) < 1e-12);
      if (canopyCover === 0) assert.equal(w.woodland, 0);
      if (canopyCover === 1) assert.equal(w.meadow, 0);
    }
  // Only partial cover shifts with the field.
  assert.equal(ealdholtValleyCanopyBreakup(1, 1), 1); assert.equal(ealdholtValleyCanopyBreakup(0, 1), 0);
  assert.ok(ealdholtValleyCanopyBreakup(.5, 1) > .5 && ealdholtValleyCanopyBreakup(.5, 0) < .5);
  // Fields are deterministic value noise: 0..1, broad varies over 10-40 m, fine over 2-6 m, no period.
  const values: number[] = []; for (let x = -200; x < 200; x += 1.7) for (let z = -150; z < 150; z += 1.9) { const f = ealdholtValleyFields(x, z); values.push(f.field); assert.ok(f.field >= 0 && f.field <= 1 && f.fine >= 0 && f.fine <= 1); }
  const mean = values.reduce((a, b) => a + b, 0) / values.length; assert.ok(mean > .4 && mean < .6, `field mean ${mean}`);
  assert.equal(ealdholtValleyFields(12.5, -3.25).field, ealdholtValleyFields(12.5, -3.25).field); assert.ok(ealdholtValleyNoise(3, 4) >= 0 && ealdholtValleyNoise(3, 4) <= 1);
  const corr = (lag: number, pick: 'field' | 'fine') => { let s = 0, n = 0; for (let x = -150; x < 150; x += 1.3) for (let z = -100; z < 100; z += 6.7) { s += (ealdholtValleyFields(x, z)[pick] - .5) * (ealdholtValleyFields(x + lag, z)[pick] - .5); n++; } return s / n; };
  assert.ok(corr(4, 'field') > .6 * corr(.5, 'field') && corr(40, 'field') < .2 * corr(.5, 'field'), 'broad field: 10-40 m'); assert.ok(corr(8, 'fine') < .25 * corr(.25, 'fine'), 'fine field: a few metres');
  assert.equal(EALDHOLT_VALLEY_NOISE.broad.scales[0] > EALDHOLT_VALLEY_NOISE.fine.scales[0], true);
  assert.throws(() => ealdholtValleyGroundWeights({ distance: NaN, exposure: 0, slope: 0, wetness: 0, heightAboveWater: 0 }));
});

test('channel twin: on the real coastal valley no bank run is solid for more than 8 m, exposure ramps over at least 10 m, the inlet flare and channel ends carry none', () => {
  for (const profile of ['desktop', 'quest'] as const) {
    const edges = syntheticEdges(), valley = createEaldholtCoastalValleyBuffers(edges, profile, createEaldholtRiverValleyBuffers(edges, profile));
    const channel = valley.shape.channelSamples, sections = createEaldholtBankExposureSections(channel, 64), xEnd = sections.x0 + sections.step * (sections.count - 1);
    const bankAt = (x: number) => { for (let i = 4; i < channel.length; i += 4) if (x <= channel[i]) { const t = (x - channel[i - 4]) / (channel[i] - channel[i - 4]); return [channel[i - 3] + (channel[i + 1] - channel[i - 3]) * t, channel[i - 2] + (channel[i + 2] - channel[i - 2]) * t]; } return [channel[channel.length - 3], channel[channel.length - 2]]; };
    let outerMaximum = 0;
    for (const side of [0, 1]) {
      const exposure: number[] = [], xs: number[] = [];
      for (let x = sections.x0; x <= xEnd; x += .25) { const [low, high] = bankAt(x); exposure.push(sampleEaldholtBankSection(sections, x, side ? high + 1 : low - 1).exposure); xs.push(x); }
      outerMaximum = Math.max(outerMaximum, ...exposure);
      // Every rise or fall of exposure between 10% and 90% of its range takes at least 10 m along the river.
      for (let i = 1; i < exposure.length; i++) for (const [from, to] of [[.1, .9], [.9, .1]]) {
        if (!((exposure[i - 1] - from) * (exposure[i] - from) <= 0 && exposure[i - 1] !== exposure[i])) continue;
        let j = i; while (j < exposure.length && (to > from ? exposure[j] < to : exposure[j] > to) && (to > from ? exposure[j] >= exposure[j - 1] - 1e-9 : exposure[j] <= exposure[j - 1] + 1e-9)) j++;
        if (j < exposure.length && (to > from ? exposure[j] >= to : exposure[j] <= to)) assert.ok(xs[j] - xs[i] >= 10, `${profile} side ${side}: exposure ${from}->${to} over ${(xs[j] - xs[i]).toFixed(1)} m at x=${xs[i].toFixed(1)}`);
      }
      // Band share at fixed depths inland: never solid for more than 8 m, and its inland extent varies.
      for (const depth of [.5, 1, 1.5, 2.5]) {
        let run = 0, longest = 0;
        for (let x = sections.x0; x <= xEnd; x += .25) {
          const [low, high] = bankAt(x), z = side ? high + depth : low - depth, section = sampleEaldholtBankSection(sections, x, z);
          const share = ealdholtValleyBankBandShare({ ...section, slope: 0, wetness: 0, field: broadField(x, z), fine: fineField(x, z) });
          run = share >= .9 ? run + .25 : 0; longest = Math.max(longest, run);
        }
        assert.ok(longest <= 8, `${profile} side ${side} depth ${depth}: solid run ${longest} m`);
      }
    }
    assert.ok(outerMaximum > .6, `${profile}: outer bends are found (${outerMaximum.toFixed(2)})`);
    // The inlet flare (fast-widening mouth) is not a cut bank; exposure and band fade beyond the channel ends.
    for (let x = valley.shape.coastX; x <= valley.shape.coastX + valley.shape.inletReach * .5; x += 1) { const [low, high] = bankAt(x); assert.ok(sampleEaldholtBankSection(sections, x, high + 1).exposure < .05, `${profile} flare x=${x}`); }
    const [low] = bankAt(sections.x0); const beyond = sampleEaldholtBankSection(sections, sections.x0 - EALDHOLT_BANK_EXPOSURE.endFadeMetres, low - 1);
    assert.equal(beyond.reach, 0); assert.equal(beyond.exposure, 0); assert.equal(ealdholtValleyBankBandShare({ ...beyond, slope: 0, wetness: 0 }), 0);
  }
});

test('bank sections: outer bends of a meander score high, inner bends low, sampling matches the shader contract and bad input fails', () => {
  const samples: number[] = [];
  for (let i = 0; i <= 64; i++) { const x = -160 + i * 5, centre = 120 + 6 * Math.sin(x * .035); samples.push(x, centre - 5.5, centre + 5.5, .4); }
  const sections = createEaldholtBankExposureSections(samples, 64);
  assert.equal(sections.count, 64); assert.equal(sections.data.length, 256); assert.ok(sections.step > 0);
  // sin(x * .035) peaks at x ~ 44.9 (bend toward +Z: far bank outer) and dips at x ~ -44.9 (near bank outer).
  assert.ok(sampleEaldholtBankExposure(sections, 45, 140) > .8 && sampleEaldholtBankExposure(sections, 45, 100) < .1);
  assert.ok(sampleEaldholtBankExposure(sections, -45, 100) > .8 && sampleEaldholtBankExposure(sections, -45, 140) < .1);
  const inside = sampleEaldholtBankSection(sections, 0, 120), land = sampleEaldholtBankSection(sections, 0, 130);
  assert.ok(inside.distance < 0 && Math.abs(land.distance - 4.5) < .05 && land.reach === 1);
  for (const value of sections.data) assert.ok(Number.isFinite(value));
  assert.throws(() => createEaldholtBankExposureSections([0, 1, 2, 0], 64), /channel/);
  assert.throws(() => createEaldholtBankExposureSections(samples, 4), /sections/);
  assert.throws(() => createEaldholtBankExposureSections([0, 2, 1, 0, 1, 2, 3, 0, 2, 2, 3, 0, 3, 2, 3, 0], 8), /Invalid channel/);
});

test('displayed layer albedo keeps woodland < bank < meadow < path on every matched palette (CPU twin of the shader)', () => {
  const palettes: number[][] = [[.063, .080, .034], [.105, .081, .054], [.035, .063, .025], [.071, .050, .030], [.061, .054, .039], [.10, .105, .102]];
  for (let t = 0; t <= 1; t += .125) for (const wet of [1, .6]) palettes.push([.105, .081, .054].map((soil, c) => (soil + ([.063, .080, .034][c] - soil) * t) * wet));
  for (const scale of [.3, .6, 1, 1.4]) palettes.push([.063, .080, .034].map(value => value * scale));
  for (const palette of palettes) {
    const y = ealdholtValleyLayerAlbedo(palette);
    assert.ok(y.woodland < y.bank && y.bank < y.meadow && y.meadow < y.path, `order at ${palette}`);
    assert.ok(Math.abs(y.bank / y.meadow - EALDHOLT_WOODLAND_GROUND_LAYERS.bank.targetLuminance / EALDHOLT_WOODLAND_GROUND_LAYERS.meadow.targetLuminance) < 1e-12);
  }
  const grass = ealdholtValleyLayerAlbedo(EALDHOLT_VALLEY_PALETTE_REFERENCE.grass), soil = ealdholtValleyLayerAlbedo(EALDHOLT_VALLEY_PALETTE_REFERENCE.soil);
  assert.ok(Math.abs(grass.meadow - .07) < 1e-12 && Math.abs(soil.bank - .06) < 1e-12); assert.ok(soil.bank < grass.meadow);
  assert.throws(() => ealdholtValleyLayerAlbedo([.1, -.1, .1]));
});

test('palette references are the real valley palettes: soil- and grass-band vertices of the shared builder are proportional to them', () => {
  const edges = syntheticEdges(), base = createEaldholtRiverValleyBuffers(edges, 'desktop'), { positions, colours, normals } = base.land;
  const proportional = (colour: number[], reference: readonly number[]) => { const k = colour.map((value, c) => value / reference[c]); return Math.max(...k) / Math.min(...k) - 1; };
  let soil = 0, grass = 0;
  for (let i = 0; i < positions.length / 3; i++) {
    if (normals[i * 3 + 1] < .999) continue; // flat: no stone blend
    const colour = [colours[i * 3], colours[i * 3 + 1], colours[i * 3 + 2]], z = positions[i * 3 + 2];
    if (z > edges.maxZ + 30 && z < edges.maxZ + 60 && proportional(colour, EALDHOLT_VALLEY_PALETTE_REFERENCE.soil) < 1e-6) soil++;
    if (z < edges.minZ - 20 && proportional(colour, EALDHOLT_VALLEY_PALETTE_REFERENCE.grass) < 1e-6) grass++;
  }
  assert.ok(grass > 20, `grass-proportional vertices ${grass}`); assert.ok(soil > 3, `soil-proportional vertices ${soil}`);
});

function jitteredBelt(spacing = 10, columns = 13, rows = 5, seed = 12345): EaldholtCanopyCrown[] {
  let state = seed; const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
  const crowns: EaldholtCanopyCrown[] = [];
  for (let i = 0; i < columns; i++) for (let j = 0; j < rows; j++) {
    const x = -60 + i * spacing + (random() - .5) * 4, z = j * spacing + (random() - .5) * 4, r = 3.2 + 1.6 * random();
    crowns.push({ minX: x - r, maxX: x + r, minZ: z - r, maxZ: z + r });
  }
  return crowns;
}
const texel = (field: EaldholtCanopyField, x: number, z: number, channel = 2) => {
  const column = Math.floor((x - field.frame[0]) * field.frame[2] * field.width), row = Math.floor((z - field.frame[1]) * field.frame[3] * field.height);
  return column < 0 || row < 0 || column >= field.width || row >= field.height ? 0 : field.data[(row * field.width + column) * 4 + channel] / 255;
};
const cover = (field: EaldholtCanopyField, x: number, z: number, channel = 2) => ealdholtCanopyDecode(texel(field, x, z, channel)).cover;

test('canopy field: a jittered 10 m belt is one connected floor with >= 90% interior cover >= 0.8, an edge of at most 8 m and depth only in its core', () => {
  const bounds = { minX: -200, maxX: 200, minZ: -150, maxZ: 150 }, field = createEaldholtCanopyCoverField(bounds, jitteredBelt(), 256);
  assert.equal(field.width * field.height, 256 * 256); assert.ok(field.width > field.height, 'an elongated belt gets an elongated texture');
  const texelX = 1 / field.frame[2] / field.width, texelZ = 1 / field.frame[3] / field.height; assert.ok(texelX <= 1 && texelZ <= 1, `texels ${texelX} x ${texelZ} m`);
  let interior = 0, closed = 0;
  for (let x = -54; x <= 54; x += .5) for (let z = 6; z <= 34; z += .5) { interior++; if (cover(field, x, z) >= .8) closed++; }
  assert.ok(closed / interior >= .9, `interior closed ${closed / interior}`);
  const { width, height } = field, seen = new Uint8Array(width * height); let components = 0;
  for (let start = 0; start < width * height; start++) {
    if (seen[start] || field.data[start * 4 + 2] < 102) continue; components++;
    const stack = [start]; seen[start] = 1;
    while (stack.length) { const i = stack.pop()!, x = i % width, z = (i - x) / width;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, nz = z + dz, n = nz * width + nx; if (nx >= 0 && nz >= 0 && nx < width && nz < height && !seen[n] && field.data[n * 4 + 2] >= 102) { seen[n] = 1; stack.push(n); } } }
  }
  assert.equal(components, 1);
  for (let x = -50; x <= 50; x += 10) {
    let plateau = 0, first = NaN, last = NaN;
    for (let z = 26; z <= 34; z += .1) plateau = Math.max(plateau, cover(field, x, z));
    for (let z = 26; z <= 70; z += .1) { const value = cover(field, x, z); if (Number.isNaN(first) && value < .9 * plateau) first = z; if (Number.isNaN(last) && value <= .1) last = z; }
    assert.ok(last - first <= 8, `edge at x=${x}: ${last - first} m`);
  }
  // Depth grows only inside the closed stand: zero within 2 m of its outline, positive in its core.
  for (let x = -40; x <= 40; x += 10) { let edge = 20; while (edge < 70 && cover(field, x, edge) >= .5) edge += .1; assert.equal(ealdholtCanopyDecode(texel(field, x, edge - 2)).depth, 0, `x=${x} edge ${edge}`); }
  let deepest = 0; for (let x = -30; x <= 30; x += 1) deepest = Math.max(deepest, ealdholtCanopyDecode(texel(field, x, 20)).depth); assert.ok(deepest > .3, `core depth ${deepest}`);
  assert.ok(field.tiers.high!.closingRadiusMetres >= 3 && field.tiers.high!.closingRadiusMetres <= 8);
});

test('canopy field: a lone tree caps at 0.35..0.5 with no depth and leaves no litter more than 1 m beyond its drip line', () => {
  const bounds = { minX: -100, maxX: 100, minZ: -100, maxZ: 100 }, field = createEaldholtCanopyCoverField(bounds, [{ minX: -4, maxX: 4, minZ: -4, maxZ: 4 }], 128);
  const centre = cover(field, 0, 0); assert.ok(centre >= .35 && centre <= .5, `lone cap ${centre}`); assert.equal(ealdholtCanopyDecode(texel(field, 0, 0)).depth, 0);
  for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 8) assert.equal(cover(field, Math.cos(angle) * 5.2, Math.sin(angle) * 5.2), 0);
  const caps = ealdholtCanopyCrownCaps([{ x: 0, z: 0, r: 4 }, { x: 10, z: 0, r: 4 }, { x: 5, z: 8, r: 4 }, { x: 100, z: 100, r: 4 }]);
  assert.ok(caps[3] === .4 && caps[0] > .7 && caps[0] < 1, `caps ${Array.from(caps)}`);
  assert.deepEqual(ealdholtCanopyDecode(EALDHOLT_CANOPY_COVER_SCALE), { cover: 1, depth: 0 }); assert.deepEqual(ealdholtCanopyDecode(1), { cover: 1, depth: 1 });
});

test('canopy field: tier channels hold only the trees each tier draws, compute only the requested tiers identically, and frame on crowns outside the envelope', () => {
  const bounds = { minX: -100, maxX: 100, minZ: -100, maxZ: 100 };
  const crowns = [{ minX: -54, maxX: -46, minZ: -4, maxZ: 4 }, { minX: -4, maxX: 4, minZ: -4, maxZ: 4 }, { minX: 46, maxX: 54, minZ: -4, maxZ: 4 }];
  const tiers = { low: 1, medium: 2, high: 3 }, field = createEaldholtCanopyCoverField(bounds, crowns, 256, tiers), channel = (x: number, c: number) => cover(field, x, 0, c);
  assert.ok(channel(-50, 0) > 0 && channel(0, 0) === 0 && channel(50, 0) === 0, 'low');
  assert.ok(channel(-50, 1) > 0 && channel(0, 1) > 0 && channel(50, 1) === 0, 'medium');
  assert.ok(channel(-50, 2) > 0 && channel(0, 2) > 0 && channel(50, 2) > 0, 'high');
  for (let i = 0; i < field.width * field.height; i++) assert.equal(field.data[i * 4 + 3], 0);
  assert.deepEqual([field.tiers.low!.crowns, field.tiers.medium!.crowns, field.tiers.high!.crowns], [1, 2, 3]); assert.deepEqual(field.computed, ['low', 'medium', 'high']);
  // A lazily computed tier is byte-identical to the same channel of a full field, with the same frame and layout.
  const medium = createEaldholtCanopyCoverField(bounds, crowns, 256, tiers, { compute: ['medium'] });
  assert.deepEqual(medium.frame, field.frame); assert.equal(medium.width, field.width); assert.deepEqual(medium.computed, ['medium']); assert.equal(medium.tiers.low, undefined);
  for (let i = 0; i < field.width * field.height; i++) { assert.equal(medium.data[i * 4 + 1], field.data[i * 4 + 1]); assert.equal(medium.data[i * 4], 0); assert.equal(medium.data[i * 4 + 2], 0); }
  assert.deepEqual(ealdholtCanopyTierSelector('medium'), [0, 1, 0, 0]); assert.throws(() => ealdholtCanopyTierSelector('ultra' as never));
  const again = createEaldholtCanopyCoverField(bounds, crowns, 256, tiers); assert.deepEqual(again.data, field.data);
  for (let i = 0; i < field.width; i++) for (const index of [i, (field.height - 1) * field.width + i]) assert.equal(field.data[index * 4 + 2], 0);
  for (let i = 0; i < field.height; i++) for (const index of [i * field.width, i * field.width + field.width - 1]) assert.equal(field.data[index * 4 + 2], 0);
  // Crowns whose centre lies inside the source envelope still count for density but never frame the texture.
  const ring = [...crowns, { minX: -10, maxX: 10, minZ: 60, maxZ: 70 }], envelope = { minX: -60, maxX: 60, minZ: -10, maxZ: 10 };
  const framed = createEaldholtCanopyCoverField(bounds, ring, 256, undefined, { frameExclusion: envelope });
  assert.ok(framed.frame[1] > 40, `frame starts at the outside crown (z ${framed.frame[1]})`);
  assert.deepEqual(ealdholtCanopyTextureLayout(300, 60, 256), { width: 512, height: 128 }); assert.deepEqual(ealdholtCanopyTextureLayout(100, 100, 128), { width: 128, height: 128 });
  assert.deepEqual(createEaldholtCanopyCoverField(bounds, [], 64).data, new Uint8Array(64 * 64 * 4));
  assert.throws(() => createEaldholtCanopyCoverField({ minX: 0, maxX: 0, minZ: 0, maxZ: 1 }, [], 64), /bounds/);
  assert.throws(() => createEaldholtCanopyCoverField(bounds, [], 100), /size/);
  assert.throws(() => createEaldholtCanopyCoverField(bounds, [{ minX: 0, maxX: NaN, minZ: 0, maxZ: 1 }], 64), /crown/);
  assert.throws(() => createEaldholtCanopyCoverField(bounds, crowns, 64, { low: 2, medium: 1, high: 3 }), /prefixes/);
  assert.throws(() => createEaldholtCanopyCoverField(bounds, crowns, 64, { low: 1, medium: 2, high: 4 }), /prefixes/);
  assert.throws(() => createEaldholtCanopyCoverField(bounds, Array.from({ length: EALDHOLT_CANOPY_MAX_CROWNS + 1 }, () => crowns[0]), 64), /Too many/);
  assert.throws(() => createEaldholtCanopyCoverField(bounds, crowns, 64, undefined, { falloffMetres: 1.5 }), /falloff/);
  assert.throws(() => createEaldholtCanopyCoverField(bounds, crowns, 64, undefined, { compute: ['ultra' as never] }), /tiers/);
});

test('woodland floor: a green herb fringe at stand edges, about half herb cover inside, litter only in deep cover; unshadowed shade at full cover', () => {
  const f = EALDHOLT_WOODLAND_FLOOR;
  assert.ok(ealdholtWoodlandHerbShare(.2, 0) >= f.fringeShare - 1e-9, 'fringe'); assert.ok(ealdholtWoodlandHerbShare(1, 0) <= f.patchShare[0] + 1e-9, 'low patch inside');
  let sum = 0, n = 0; for (let a = 0; a <= 1.0001; a += .02) for (let b = 0; b <= 1.0001; b += .02) { sum += ealdholtWoodlandHerbShare(1, .55 * a + .45 * b); n++; }
  assert.ok(sum / n >= .45 && sum / n <= .65, `interior mean herb share ${sum / n}`);
  assert.ok(ealdholtWoodlandHerbShare(1, 1, 1) < .3 && ealdholtWoodlandHerbShare(1, 0, 1) < .1, 'deep cover is mostly litter');
  assert.equal(ealdholtCanopyShade(1, false), 1); assert.ok(Math.abs(ealdholtCanopyShade(1, true) - (1 - f.shade)) < 1e-12); assert.equal(ealdholtCanopyShade(0, true), 1);
  assert.throws(() => ealdholtWoodlandHerbShare(NaN));
});

test('meadow variation: lusher green near water and in hollows, drier straw-olive on sun-facing slopes, sedge on wet margins, about +/-5-8 degrees of hue', () => {
  const enc = (v: number) => v <= .0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - .055;
  const hue = (rgb: readonly number[]) => { const s = rgb.map(v => enc(Math.max(0, v))), max = Math.max(...s), min = Math.min(...s), d = max - min; return d ? 60 * ((s[2] - s[0]) / d + 2) : 0; };
  const mean = EALDHOLT_WOODLAND_GROUND_CHROMATICITY.meadow.map(v => v * .248 / Y(EALDHOLT_WOODLAND_GROUND_CHROMATICITY.meadow)), base = hue(mean);
  const shifted = (input: Parameters<typeof ealdholtMeadowVariation>[0]) => { const v = ealdholtMeadowVariation(input); return { ...v, hue: hue(mean.map((c, i) => c * v.gain[i])) - base, y: Y(mean.map((c, i) => c * v.gain[i])) / Y(mean) }; };
  const flat = [0, 1, 0] as const, open = { distance: 60, heightAboveWater: 5, normal: flat, wetness: 0, field: .5 };
  const neutral = shifted(open); assert.ok(Math.abs(neutral.hue) < .5 && Math.abs(neutral.y - 1) < .01, JSON.stringify(neutral));
  const lush = shifted({ ...open, distance: 3, heightAboveWater: .5 }); assert.ok(lush.hue > 4.5 && lush.hue < 8.5 && lush.y < .95, JSON.stringify(lush));
  const sunward = Math.sin(.4), facing = [sunward * .79, Math.cos(.4), sunward * .61] as const;
  const dry = shifted({ ...open, normal: facing }); assert.ok(dry.hue < -4.5 && dry.hue > -8.5 && dry.y > 1.03, JSON.stringify(dry));
  const sedge = shifted({ ...open, distance: 3, wetness: .6, heightAboveWater: 3 }); assert.ok(sedge.sedge > .7, JSON.stringify(sedge));
  for (const gain of [EALDHOLT_MEADOW_VARIATION.lushGain, EALDHOLT_MEADOW_VARIATION.dryGain, EALDHOLT_MEADOW_VARIATION.sedgeGain]) assert.ok(Math.abs(Y(mean.map((c, i) => c * gain[i])) / Y(mean) - 1) < .01, 'gains are luminance-neutral');
  assert.throws(() => ealdholtMeadowVariation({ ...open, normal: [0, 1] as never }));
});

test('meadow variation sun matches the village daylight once that module is present', async () => {
  let daylight: { EALDHOLT_VILLAGE_DAYLIGHT?: { sunOffset: readonly number[] } } | null = null;
  try { daylight = await import('./daylight' as string); } catch { daylight = null; }
  if (daylight?.EALDHOLT_VILLAGE_DAYLIGHT) assert.deepEqual([...daylight.EALDHOLT_VILLAGE_DAYLIGHT.sunOffset], [...EALDHOLT_MEADOW_VARIATION.sunOffset]);
  else assert.deepEqual([...EALDHOLT_MEADOW_VARIATION.sunOffset], [65, 109, 50]);
});

test('kit grades move measured kit onto the ground set; flower petals keep their colour while stems and leaves grade as foliage', () => {
  for (const [kitClass, mean] of [['rock', [.2551, .1769, .1120]], ['rock', [.1691, .1199, .0812]], ['wood', [.1102, .0671, .0378]], ['foliage', [.1690, .1631, .0806]], ['flower', [.08, .12, .03]]] as const) {
    const multiplier = ealdholtKitColourMultiplier(mean, kitClass), graded = mean.map((value, c) => value * multiplier[c]), grade = EALDHOLT_WOODLAND_KIT_GRADES[kitClass];
    assert.ok(Y(graded) >= grade.luminance[0] - 1e-6 && Y(graded) <= grade.luminance[1] + 1e-6, `${kitClass} luminance ${Y(graded)}`);
    assert.ok(ealdholtSrgbSaturation(graded) <= grade.maxSaturation + 1e-3, `${kitClass} saturation ${ealdholtSrgbSaturation(graded)}`);
  }
  // flower_empodium's petals (sRGB 177,161,66) are petals; its leaves (green) and dark crevices are not.
  assert.ok(ealdholtFlowerPetalWeight(177 / 255, 161 / 255, 66 / 255) > .99); assert.ok(ealdholtFlowerPetalWeight(.92, .9, .88) > .99, 'white petals');
  assert.ok(ealdholtFlowerPetalWeight(60 / 255, 100 / 255, 40 / 255) < .01); assert.ok(ealdholtFlowerPetalWeight(.05, .05, .04) < .01);
  const leaf = ealdholtKitColourMultiplier([.08, .12, .03], 'flower'), petal = [.4397, .3583, .0541];
  assert.deepEqual(ealdholtFlowerPixelGrade(petal, leaf, 1), petal); assert.deepEqual(ealdholtFlowerPixelGrade([.08, .12, .03], leaf, 0), [.08, .12, .03].map((v, c) => v * leaf[c]));
  assert.throws(() => ealdholtKitColourMultiplier([0, .1, .1], 'rock')); assert.throws(() => ealdholtKitColourMultiplier([.1, .1, .1], 'gold' as never));
  assert.equal(ealdholtPondProbeValleyArtStatus(EALDHOLT_WOODLAND_BANK_ART_VERSION), 'current');
  for (const old of ['grounded-bank-earth-grass-rock-v2', 'grounded-bank-earth-grass-rock-v3']) assert.equal(ealdholtPondProbeValleyArtStatus(old), 'stale');
  assert.equal(ealdholtPondProbeValleyArtStatus(undefined), 'unrecorded'); assert.equal(ealdholtPondProbeValleyArtStatus(''), 'unrecorded');
});

test('bake palette: chromaticities match the committed manifests; the forest floor is the valley litter-and-herb composite (hue 55-60), not autumn tan', () => {
  for (const layer of EALDHOLT_WOODLAND_GROUND_COMMITTED_LAYERS) {
    const measured = committed(layer).profiles.desktop.analysis.linearChromaticity as number[];
    EALDHOLT_WOODLAND_GROUND_CHROMATICITY[layer].forEach((value, channel) => assert.ok(Math.abs(value - measured[channel]) < 1e-9, `${layer} chromaticity`));
  }
  const palette = EALDHOLT_WOODLAND_GROUND_BAKE_PALETTE, enc = (v: number) => v <= .0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - .055;
  assert.ok(Math.abs(Y(palette.grass) - .07) < 2e-5); assert.ok(Math.abs(Y(palette.forestFloor) - .055) < 2e-5);
  assert.ok(Math.abs(Y(palette.soil) - .089) < 2e-5); assert.ok(Math.abs(Y(palette.rock) - .1) < 2e-5);
  for (const entry of [palette.soil, palette.grass, palette.forestFloor, palette.rock]) assert.ok(entry.length === 3 && entry.every(value => value > 0 && value < 1));
  assert.ok(Math.abs((palette.grass[1] - palette.grass[0]) / Y(palette.grass) - .3889) < .003);
  const s = palette.forestFloor.map(enc), max = Math.max(...s), min = Math.min(...s), hue = max === s[0] ? 60 * ((s[1] - s[2]) / (max - min)) : 60 * ((s[2] - s[0]) / (max - min) + 2);
  assert.ok(hue >= 55 && hue <= 60.5, `forest floor hue ${hue}`); assert.ok(Math.abs(EALDHOLT_WOODLAND_FLOOR_COMPOSITE_CHROMATICITY.reduce((a, b) => a + b, 0) - 1) < 1e-3);
  assert.ok(Y(palette.forestFloor) < Y(palette.grass));
});

function shaderFixture() {
  return { uniforms: {} as Record<string, { value: unknown }>, vertexShader: '#include <common>\n#include <begin_vertex>',
    fragmentShader: '#include <common>\n#include <map_fragment>\n#include <color_fragment>\n#include <roughnessmap_fragment>\n#include <normal_fragment_maps>\n#include <lights_physical_fragment>\n#include <aomap_fragment>' };
}
function woodlandOptions(withForest = true) {
  const samples: number[] = []; for (let i = 0; i <= 20; i++) samples.push(-100 + i * 10, 95, 106, .4);
  const canopy = { texture: { value: {} }, frame: { value: [0, 0, 1, 1] }, select: { value: [0, 0, 1, 0] }, shade: { value: 0 } };
  return { earthNormal: {}, earthOrm: {}, rock: { albedo: {}, normal: {}, meanLuminance: .12 }, waterHeight: .4,
    woodland: { bank: { tileMetres: 1.3, targetLuminance: .06 }, meadow: { albedo: {}, normal: {}, meanLuminance: .248, targetLuminance: .07, tileMetres: 2 },
      sections: createEaldholtBankExposureSections(samples, 64), ...(withForest ? { forest: { albedo: {}, meanLuminance: .05, targetLuminance: .055, tileMetres: 2.3 }, canopy } : {}) } };
}

test('woodland valley shader: shared uniforms, no new samplers, explicit LODs in branches, ascending smoothstep edges, no neutral rock term, idempotent and fail-closed', () => {
  const shader = shaderFixture(), options = woodlandOptions();
  patchEaldholtWoodlandValleySurface(shader, .082, 'attribute', options);
  const custom = Object.keys(shader.uniforms).filter(name => /Albedo|Normal|Orm|Canopy$/.test(name) && name.startsWith('uEaldholtValley'));
  assert.deepEqual(custom.sort(), ['uEaldholtValleyCanopy', 'uEaldholtValleyEarthNormal', 'uEaldholtValleyEarthOrm', 'uEaldholtValleyForestAlbedo', 'uEaldholtValleyGrassAlbedo', 'uEaldholtValleyGrassNormal', 'uEaldholtValleyRockAlbedo', 'uEaldholtValleyRockNormal']);
  assert.equal(shader.uniforms.uEaldholtValleyCanopy, options.woodland.canopy!.texture, 'the valley owns the canopy uniform objects');
  assert.equal(shader.uniforms.uEaldholtValleyCanopyShade, options.woodland.canopy!.shade); assert.equal(shader.uniforms.uEaldholtValleyCanopySelect, options.woodland.canopy!.select);
  assert.equal((shader.uniforms.uEaldholtValleyBank.value as Float32Array).length, 128); assert.deepEqual(shader.uniforms.uEaldholtValleyBankFrame.value, [-100, 1 / options.woodland.sections.step, 63, options.woodland.sections.step]);
  const fragment = shader.fragmentShader;
  assert.match(fragment, new RegExp(EALDHOLT_WOODLAND_BANK_ART_VERSION)); assert.match(fragment, new RegExp(EALDHOLT_WOODLAND_GROUND_CACHE_KEY));
  assert.doesNotMatch(fragment, /neutral|sRGBToLinear|discard|random\s*\(|ealdholtValleyPhoto\(/);
  // Derivatives only in the LOD helper, the face normal and the tangent frame, all outside any branch.
  assert.equal((fragment.match(/dFdx\(/g) ?? []).length, 4);
  const branches = fragment.split(/if\(ealdholt(?:Bank|Rock|Forest)W>\.001\)\{/).slice(1).map(part => part.slice(0, part.indexOf('\n  }')));
  assert.equal(branches.length, 3); for (const branch of branches) { assert.doesNotMatch(branch, /dFdx|dFdy|texture2D\(/); assert.match(branch, /ealdholtValleyFetch\(/); }
  for (const [, a, b] of fragment.matchAll(/smoothstep\((-?[\d.]+),(-?[\d.]+),/g)) assert.ok(Number(a) < Number(b), `smoothstep(${a},${b})`);
  assert.match(fragment, /ealdholtValleySide\(map,/); assert.match(fragment, /ealdholtValleySide\(uEaldholtValleyRockAlbedo,/);
  assert.match(fragment, /reflectedLight\.directDiffuse\*=ealdholtShade/); assert.match(fragment, /\*\(1\.-ealdholtSteep\)/);
  for (const name of ['ealdholtValleyBankBand', 'ealdholtMeadowGain', 'ealdholtValleyBankSection', 'ealdholtValleyFollow']) assert.match(fragment, new RegExp(`${name}\\(`));
  // Fetch census: every fetch site in the hooks, and those outside the layer branches and their one-line guards.
  const hooks = fragment.slice(fragment.indexOf('#include <color_fragment>')), F = EALDHOLT_WOODLAND_VALLEY_FETCHES;
  const fetches = (text: string) => (text.match(/ealdholtValleyFetch\(|texture2D\(|textureLod\(/g) ?? []).length + 2 * (text.match(/ealdholtValleySide\(/g) ?? []).length;
  assert.equal(fetches(hooks), F.always + F.canopy + F.bank + F.steepBank + F.rock + F.steepRock + F.floor);
  const unguarded = hooks.replace(/if\(ealdholt(?:Bank|Rock|Forest)W>\.001\)\{[\s\S]*?\n  \}/g, '').replace(/if\(ealdholt\w+>\.001\)[^;\n]*;/g, '');
  assert.equal(fetches(unguarded), F.always + F.canopy);
  const before = JSON.stringify(shader); patchEaldholtWoodlandValleySurface(shader, .082, 'attribute', options); assert.equal(JSON.stringify(shader), before);
  const plain = shaderFixture(); patchEaldholtWoodlandValleySurface(plain, .082, 'attribute', woodlandOptions(false));
  assert.equal(plain.uniforms.uEaldholtValleyCanopy, undefined); assert.equal(plain.uniforms.uEaldholtValleyForestAlbedo, undefined); assert.doesNotMatch(plain.fragmentShader, /uEaldholtValleyCanopyShade/);
  for (const broken of [{ ...options, woodland: { ...options.woodland, canopy: undefined } }, { ...options, woodland: { ...options.woodland, meadow: { ...options.woodland.meadow, targetLuminance: .9 } } },
    { ...options, woodland: { ...options.woodland, sections: { ...options.woodland.sections, count: 3 } } }, { ...options, woodland: undefined }]) {
    const next = shaderFixture(), snapshot = JSON.stringify(next);
    assert.throws(() => patchEaldholtWoodlandValleySurface(next, .082, 'attribute', broken as never), /Invalid|needs/); assert.equal(JSON.stringify(next), snapshot);
  }
  assert.throws(() => patchEaldholtWoodlandValleySurface(shaderFixture(), .082, 'river', options), /needs/);
  assert.equal(EALDHOLT_VALLEY_ROCK.slope[0] < EALDHOLT_VALLEY_ROCK.slope[1] && EALDHOLT_VALLEY_GRASS_INDEX_RAMP[0] < EALDHOLT_VALLEY_GRASS_INDEX_RAMP[1], true);
});
