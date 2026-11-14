import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  EALDHOLT_ASSET_CANDIDATE_MANIFEST,
  EALDHOLT_ASSET_ROLES,
  EALDHOLT_ASSET_VERIFIED_ON,
  EALDHOLT_RECOMMENDABLE_LICENCES,
  validateAssetCandidates,
  type EaldholtAssetCandidate,
  type EaldholtAssetRecommendation,
  type EaldholtAssetSource,
} from './asset-candidates';

// The shipped manifest is the subject. Invalid variants are synthetic edits of
// a JSON copy of it (ids such as 'test-a'); they record no real asset decision.

const MANIFEST = EALDHOLT_ASSET_CANDIDATE_MANIFEST;
const POLY_HAVEN_SOURCES = ['polyhaven-verdant-trail', 'polyhaven-namaqualand'];

/** A plain, mutable deep copy to build invalid variants from. */
function plainCopy(): any {
  return JSON.parse(JSON.stringify(MANIFEST));
}

function candidateIn(data: any, assetId: string): any {
  const found = data.candidates.find((candidate: any) => candidate.assetId === assetId);
  assert.ok(found, `the fixture needs ${assetId}`);
  return found;
}

function sourceIn(data: any, id: string): any {
  const found = data.sources.find((source: any) => source.id === id);
  assert.ok(found, `the fixture needs source ${id}`);
  return found;
}

/** Edit a copy, then demand that validation refuses it with a matching error. */
function expectRefused(edit: (data: any) => void, pattern: RegExp): void {
  const data = plainCopy();
  edit(data);
  const result = validateAssetCandidates(data);
  assert.equal(result.ok, false, `expected a refusal matching ${pattern}`);
  if (!result.ok) assert.match(result.error, pattern);
}

function isDeeplyFrozen(value: unknown): boolean {
  if (value === null || typeof value !== 'object') return true;
  return Object.isFrozen(value) && Object.values(value).every(isDeeplyFrozen);
}

function tally(list: readonly { readonly recommendation: EaldholtAssetRecommendation }[]): Record<EaldholtAssetRecommendation, number> {
  const counts = { recommended: 0, conditional: 0, rejected: 0 };
  for (const item of list) counts[item.recommendation] += 1;
  return counts;
}

/** A synthetic candidate from a non-Poly-Haven source, for cross-reference checks. */
function syntheticEntry(data: any, overrides: Record<string, unknown>): any {
  return {
    ...candidateIn(data, 'boulder_01'),
    id: 'test-a',
    assetId: 'test-a',
    sourceUrl: 'https://example.org/test-a',
    ...overrides,
  };
}

test('the shipped manifest passes its own validator, is deeply frozen and stays a working placeholder', () => {
  const result = validateAssetCandidates(MANIFEST);
  assert.ok(result.ok, result.ok ? '' : result.error);
  assert.equal(JSON.stringify(result.manifest), JSON.stringify(MANIFEST));
  assert.equal(MANIFEST.schema, 1);
  assert.equal(MANIFEST.status, 'working-placeholder');
  assert.equal(MANIFEST.snapshotDate, '2026-11-06');
  assert.ok(isDeeplyFrozen(MANIFEST));
  for (const entry of [...MANIFEST.sources, ...MANIFEST.candidates]) {
    assert.equal(entry.verifiedOn, EALDHOLT_ASSET_VERIFIED_ON);
  }
});

test('candidate ids are unique and every collection asset is assessed exactly once', () => {
  const ids = MANIFEST.candidates.map(candidate => candidate.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual(MANIFEST.collections.map(snapshot => [snapshot.collectionId, snapshot.assetIds.length]),
    [['verdant_trail', 15], ['namaqualand', 15]]);
  for (const snapshot of MANIFEST.collections) {
    for (const assetId of snapshot.assetIds) {
      const matches = MANIFEST.candidates.filter(candidate => candidate.source === snapshot.source && candidate.assetId === assetId);
      assert.equal(matches.length, 1, `${snapshot.collectionId}/${assetId} is assessed exactly once`);
    }
    assert.equal(MANIFEST.candidates.filter(candidate => candidate.source === snapshot.source).length, snapshot.assetIds.length);
  }
  expectRefused(data => { data.candidates[1].id = data.candidates[0].id; }, /duplicate candidate id/);
  expectRefused(data => { data.candidates.push({ ...data.candidates[0], id: 'test-a' }); }, /duplicate source and asset pair/);
  expectRefused(data => { data.collections[0].assetIds.push('shrub_01'); }, /duplicate asset id shrub_01/);
});

test('every Poly Haven entry points to an id listed in its recorded collection snapshot', () => {
  for (const candidate of MANIFEST.candidates) {
    assert.ok(POLY_HAVEN_SOURCES.indexOf(candidate.source) !== -1, `${candidate.id} comes from a Poly Haven collection`);
    const snapshot = MANIFEST.collections.find(entry => entry.source === candidate.source);
    assert.ok(snapshot, `${candidate.source} has a recorded snapshot`);
    assert.ok(snapshot.assetIds.indexOf(candidate.assetId) !== -1, `${candidate.assetId} is listed in ${snapshot.collectionId}`);
    assert.equal(candidate.sourceUrl, `https://polyhaven.com/a/${candidate.assetId}`);
    assert.equal(candidate.id, `polyhaven:${candidate.assetId}`);
  }
  expectRefused(data => { candidateIn(data, 'boulder_01').assetId = 'boulder_99'; },
    /boulder_99 is not listed in the recorded A Verdant Trail collection snapshot/);
  expectRefused(data => { candidateIn(data, 'boulder_01').source = 'polyhaven-namaqualand'; },
    /boulder_01 is not listed in the recorded Namaqualand collection snapshot/);
  expectRefused(data => { candidateIn(data, 'boulder_01').sourceUrl = 'https://polyhaven.com/a/boulder_02'; }, /Poly Haven asset page/);
  expectRefused(data => { candidateIn(data, 'boulder_01').id = 'polyhaven:test-a'; }, /expected polyhaven:boulder_01/);
  expectRefused(data => { data.collections.pop(); }, /missing the asset snapshot for polyhaven-namaqualand/);
  expectRefused(data => { data.collections[0].source = 'hf-codepawl-abo-glb'; }, /must belong to a Poly Haven collection source/);
});

test('only allowed licences may be recommended', () => {
  assert.deepEqual([...EALDHOLT_RECOMMENDABLE_LICENCES], ['CC0-1.0', 'CC-BY-4.0']);
  for (const candidate of MANIFEST.candidates.filter(entry => entry.recommendation === 'recommended')) {
    assert.ok(EALDHOLT_RECOMMENDABLE_LICENCES.indexOf(candidate.licence) !== -1, candidate.id);
  }
  for (const source of MANIFEST.sources.filter(entry => entry.recommendation === 'recommended')) {
    assert.ok(EALDHOLT_RECOMMENDABLE_LICENCES.indexOf(source.upstreamLicence) !== -1, source.id);
  }
  expectRefused(data => {
    Object.assign(candidateIn(data, 'boulder_01'), { licence: 'MIT', attributionRequired: true, attribution: 'Synthetic notice.' });
  }, /candidates\[\d+\]\.recommendation: MIT is not a licence that may be recommended/);
  expectRefused(data => {
    Object.assign(sourceIn(data, 'hf-codepawl-menagerie-glb'), { recommendation: 'recommended', thematicFit: 'partial' });
  }, /per-model is not a licence that may be recommended/);
  expectRefused(data => {
    data.candidates.push(syntheticEntry(data, { source: 'hf-codepawl-abo-glb', licence: 'unknown', recommendation: 'recommended' }));
  }, /unknown is not a licence that may be recommended/);
});

test('attribution is recorded when required, and only then', () => {
  for (const entry of [...MANIFEST.sources, ...MANIFEST.candidates]) {
    if (entry.attributionRequired) assert.ok(entry.attribution !== null && entry.attribution.length > 0, entry.id);
    else assert.equal(entry.attribution, null, entry.id);
  }
  for (const source of MANIFEST.sources.filter(entry => entry.kind !== 'polyhaven-collection')) {
    assert.equal(source.attributionRequired, true, `${source.id} needs credit or a notice`);
  }
  expectRefused(data => { sourceIn(data, 'hf-codepawl-abo-glb').attribution = null; }, /attribution text must be recorded/);
  expectRefused(data => { sourceIn(data, 'hf-codepawl-abo-glb').attributionRequired = false; }, /CC-BY-4.0 requires attribution/);
  expectRefused(data => { candidateIn(data, 'boulder_01').attribution = 'Unrequested credit.'; }, /recorded only when the licence requires it/);
  expectRefused(data => {
    data.candidates.push(syntheticEntry(data, { source: 'hf-codepawl-abo-glb', licence: 'CC-BY-4.0', recommendation: 'rejected' }));
  }, /CC-BY-4.0 requires attribution/);
});

test('no non-commercial or unverified-upstream entry is recommended', () => {
  for (const entry of [...MANIFEST.sources, ...MANIFEST.candidates].filter(item => item.recommendation === 'recommended')) {
    assert.equal(entry.nonCommercial, false, entry.id);
    assert.equal(entry.upstreamLicenceVerified, true, entry.id);
  }
  for (const source of MANIFEST.sources.filter(entry => entry.recommendation === 'recommended')) {
    assert.equal(source.statedLicence, source.upstreamLicence, source.id);
  }
  expectRefused(data => { candidateIn(data, 'boulder_01').upstreamLicenceVerified = false; },
    /upstream licence is unverified cannot be recommended/);
  expectRefused(data => { candidateIn(data, 'boulder_01').nonCommercial = true; }, /non-commercial entry cannot be recommended/);
  expectRefused(data => { sourceIn(data, 'polyhaven-verdant-trail').upstreamLicenceVerified = false; },
    /sources\[0\]\.recommendation: an entry whose upstream licence is unverified/);
  expectRefused(data => { sourceIn(data, 'polyhaven-verdant-trail').statedLicence = 'CC-BY-4.0'; },
    /stated licence differs from its upstream licence cannot be recommended/);
  expectRefused(data => { sourceIn(data, 'polyhaven-namaqualand').upstreamLicenceVerified = false; },
    /cannot be verified beyond its source/);
  expectRefused(data => {
    Object.assign(sourceIn(data, 'hf-codepawl-abo-glb'), { statedLicence: 'CC-BY-NC-4.0', upstreamLicence: 'CC-BY-NC-4.0' });
  }, /CC-BY-NC-4.0 forbids commercial use and must be flagged non-commercial/);
  expectRefused(data => {
    data.candidates.push(syntheticEntry(data, {
      source: 'hf-codepawl-simready-glb', licence: 'CC-BY-4.0', attributionRequired: true, attribution: 'Synthetic credit.',
    }));
  }, /a rejected source cannot supply a recommended asset/);
});

test('roles are valid, HDRIs alone fill the sky role and every role has a candidate or an in-use asset', () => {
  for (const candidate of MANIFEST.candidates) assert.ok(EALDHOLT_ASSET_ROLES.indexOf(candidate.role) !== -1, candidate.id);
  for (const asset of MANIFEST.inUse) assert.ok(EALDHOLT_ASSET_ROLES.indexOf(asset.role) !== -1, asset.assetId);
  for (const role of EALDHOLT_ASSET_ROLES) {
    const covered = MANIFEST.candidates.some(candidate => candidate.role === role) || MANIFEST.inUse.some(asset => asset.role === role);
    assert.ok(covered, `${role} has a candidate or an in-use reference`);
  }
  for (const candidate of MANIFEST.candidates) {
    assert.equal(candidate.role === 'sky-hdri', candidate.facts.kind === 'hdri', candidate.id);
  }
  expectRefused(data => { candidateIn(data, 'boulder_01').role = 'test-role'; }, /role: expected one of/);
  expectRefused(data => { candidateIn(data, 'lichen_rock').role = 'sky-hdri'; }, /sky-hdri is the role for HDRIs/);
  expectRefused(data => { candidateIn(data, 'goegap_road').role = 'boulders-lichen-rock'; }, /sky-hdri is the role for HDRIs/);
  expectRefused(data => { data.inUse[0].role = 'test-role'; }, /inUse\[0\]\.role: expected one of/);
});

test('nothing is marked integrated, and in-use assets stay reference points', () => {
  for (const candidate of MANIFEST.candidates) assert.equal(candidate.status, 'candidate');
  expectRefused(data => { data.candidates[0].status = 'integrated'; }, /nothing in this manifest is integrated/);
  expectRefused(data => { data.status = 'approved'; }, /working-placeholder/);
  const grass = MANIFEST.inUse.find(asset => asset.assetId === 'leafy_grass');
  assert.ok(grass, 'the canonical grass is recorded as in use');
  assert.equal(grass.role, 'meadow-grass-cover');
  assert.equal(grass.licence, 'CC0-1.0');
  assert.deepEqual(MANIFEST.inUse.map(asset => asset.assetId), ['leafy_grass', 'stony_dirt_path', 'rock_surface']);
  assert.ok(!MANIFEST.candidates.some(candidate => MANIFEST.inUse.some(asset => asset.assetId === candidate.assetId)));
  expectRefused(data => { data.inUse.push({ ...data.inUse[0], assetId: 'boulder_01' }); }, /boulder_01 is already in use/);
  expectRefused(data => { data.inUse[0].provenance = '../outside/provenance.json'; }, /relative repository path/);
  expectRefused(data => { data.inUse[0].provenance = '/absolute/provenance.json'; }, /relative repository path/);
});

test('source records keep the licence-risk findings for every listed source', () => {
  assert.deepEqual(MANIFEST.sources.map(source => source.title), [
    'A Verdant Trail', 'Namaqualand', 'codepawl/simready-glb', 'codepawl/abo-glb', 'codepawl/ct-anatomy-glb',
    'codepawl/menagerie-glb', 'codepawl/scanned-objects-glb', 'codepawl/spume',
  ]);
  for (const source of MANIFEST.sources.filter(entry => entry.kind === 'polyhaven-collection')) {
    assert.equal(source.upstreamLicence, 'CC0-1.0');
    assert.equal(source.upstreamLicenceVerified, true);
    assert.equal(source.attributionRequired, false);
    assert.equal(source.revision, null);
  }
  const reuploads = MANIFEST.sources.filter(entry => entry.kind === 'dataset-reupload');
  assert.equal(reuploads.length, 5);
  for (const source of reuploads) {
    assert.equal(source.recommendation, 'rejected', source.id);
    assert.equal(source.thematicFit, 'off-theme', source.id);
    assert.equal(source.upstreamLicenceVerified, true, source.id);
    assert.equal(source.statedLicence, source.upstreamLicence, `${source.id}: no licence mismatch was found`);
    assert.equal(source.nonCommercial, false, source.id);
    assert.match(source.revision ?? '', /^[0-9a-f]{40}$/, source.id);
    assert.ok(source.risks.some(risk => /EXT_meshopt_compression/.test(risk)), `${source.id} flags the Quest format risk`);
  }
  assert.equal(sourceIn(MANIFEST, 'hf-codepawl-menagerie-glb').statedLicence, 'per-model');
  const spume: EaldholtAssetSource = sourceIn(MANIFEST, 'github-codepawl-spume');
  assert.equal(spume.kind, 'tool-repository');
  assert.equal(spume.thematicFit, 'not-an-asset');
  assert.equal(spume.upstreamLicence, 'Apache-2.0');
  assert.equal(spume.recommendation, 'conditional');
  assert.ok(!MANIFEST.candidates.some(candidate => candidate.source === spume.id));
  expectRefused(data => {
    data.candidates.push(syntheticEntry(data, {
      source: 'github-codepawl-spume', licence: 'Apache-2.0', attributionRequired: true, attribution: 'Synthetic notice.',
      recommendation: 'conditional',
    }));
  }, /a tool repository supplies no asset candidates/);
  expectRefused(data => {
    Object.assign(sourceIn(data, 'hf-codepawl-simready-glb'), { recommendation: 'recommended' });
  }, /a source rated off-theme cannot be recommended/);
  expectRefused(data => {
    Object.assign(sourceIn(data, 'github-codepawl-spume'), { recommendation: 'recommended' });
  }, /Apache-2\.0 is not a licence that may be recommended/);
  expectRefused(data => { data.sources[1] = { ...data.sources[0] }; }, /duplicate source id polyhaven-verdant-trail/);
  expectRefused(data => { data.sources.push({ ...data.sources[0] }); }, /manifest\.sources: expected 1 to 8 entries/);
});

test('untrusted data is read strictly: accessors, prototypes, extra fields and sparse arrays are refused unread', () => {
  let reads = 0;
  const withAccessor = plainCopy();
  Object.defineProperty(withAccessor.candidates[0], 'reason', {
    enumerable: true,
    configurable: true,
    get() {
      reads += 1;
      return 'Synthetic reason.';
    },
  });
  assert.equal(validateAssetCandidates(withAccessor).ok, false);
  assert.equal(reads, 0, 'the accessor is never invoked');

  const withPrototype = plainCopy();
  withPrototype.candidates[0] = Object.assign(Object.create({ inherited: true }), withPrototype.candidates[0]);
  assert.equal(validateAssetCandidates(withPrototype).ok, false);

  const hidden = plainCopy();
  Object.defineProperty(hidden.sources[0], 'reason', { enumerable: false });
  const hiddenResult = validateAssetCandidates(hidden);
  assert.equal(hiddenResult.ok, false);
  if (!hiddenResult.ok) assert.match(hiddenResult.error, /enumerable/);

  const symbolKey = plainCopy();
  symbolKey.candidates[0][Symbol('test')] = true;
  assert.equal(validateAssetCandidates(symbolKey).ok, false);

  expectRefused(data => { data.candidates[0].extra = true; }, /expected plain data/);
  expectRefused(data => { delete data.candidates[0].reason; }, /expected plain data/);
  expectRefused(data => { data.candidates.length += 1; }, /dense plain array/);
  expectRefused(data => { data.candidates[0].reason = ' Padded reason.'; }, /trimmed single-line text/);
  expectRefused(data => { data.candidates[0].suitability = 'Line one.\nLine two.'; }, /trimmed single-line text/);
  expectRefused(data => { data.sources[2].url = 'http://huggingface.co/datasets/codepawl/simready-glb'; }, /https URL/);
  expectRefused(data => { data.candidates[0].verifiedOn = '2026-11-05'; }, /expected 2026-11-06/);
  expectRefused(data => { data.snapshotDate = '2026-11-07'; }, /manifest\.snapshotDate: expected 2026-11-06/);
  expectRefused(data => { data.collections[0].datePublished = '2024-02-30'; }, /real calendar date/);
  expectRefused(data => { data.sources[2].revision = 'main'; }, /hexadecimal revision/);
  expectRefused(data => { candidateIn(data, 'shrub_02').facts.gltfTriangles = 1.5; }, /gltfTriangles: expected an integer/);
  expectRefused(data => { candidateIn(data, 'shrub_02').facts.alphaModes = ['MASK', 'MASK']; }, /duplicate alpha mode/);
  expectRefused(data => { candidateIn(data, 'kloofendal_28d_misty').facts.sunElevationEstimateDegrees = 120; }, /from -90 to 90/);
  expectRefused(data => { candidateIn(data, 'lichen_rock').facts.gltfTriangles = 10; }, /facts: expected plain data/);
  expectRefused(data => { candidateIn(data, 'lichen_rock').facts.kind = 'test-kind'; }, /facts\.kind: expected one of/);
  expectRefused(data => { data.schema = 2; }, /expected schema 1/);
  for (const value of [null, undefined, 1, 'manifest', [], Object.create(null)]) {
    assert.equal(validateAssetCandidates(value).ok, false);
  }
});

test('validation returns an owned frozen copy, never changes its input and is deterministic', () => {
  const input = plainCopy();
  const before = JSON.stringify(input);
  const result = validateAssetCandidates(input);
  assert.ok(result.ok, result.ok ? '' : result.error);
  assert.ok(Object.isFrozen(result));
  assert.equal(JSON.stringify(input), before, 'the input is not changed');
  assert.equal(Object.isFrozen(input), false, 'the input is not frozen');
  assert.equal(Object.isFrozen(input.candidates[0].facts), false);
  assert.notEqual(result.manifest, input);
  assert.notEqual(result.manifest.candidates[0], input.candidates[0]);
  assert.notEqual(result.manifest.candidates[0].facts, input.candidates[0].facts);
  assert.ok(isDeeplyFrozen(result.manifest));
  input.candidates[0].reason = 'Changed after validation.';
  assert.notEqual(result.manifest.candidates[0].reason, 'Changed after validation.', 'later input edits cannot reach the copy');
  const again = validateAssetCandidates(plainCopy());
  assert.ok(again.ok);
  assert.equal(JSON.stringify(again.manifest), JSON.stringify(MANIFEST), 'the same input gives the same output');
});

test('recorded facts keep the live research values and the assessment boundaries', () => {
  const byAsset = (assetId: string): EaldholtAssetCandidate => {
    const found = MANIFEST.candidates.find(candidate => candidate.assetId === assetId);
    assert.ok(found, assetId);
    return found;
  };
  assert.deepEqual(byAsset('boulder_01').facts, { kind: 'model', gltfTriangles: 66122, gltfMeshes: 1, alphaModes: ['OPAQUE'] });
  assert.deepEqual(byAsset('shrub_02').facts, { kind: 'model', gltfTriangles: 27254, gltfMeshes: 4, alphaModes: ['MASK'] });
  assert.deepEqual(byAsset('leipoldtia_schultzei').facts, { kind: 'model', gltfTriangles: 385504, gltfMeshes: 3, alphaModes: ['BLEND'] });
  assert.deepEqual(byAsset('coast_sand_01').facts, { kind: 'texture', tileMetres: 15 });
  assert.deepEqual(byAsset('kloofendal_28d_misty').facts,
    { kind: 'hdri', timeOfDay: 'morning', weather: 'fog', contrast: 'medium', sunElevationEstimateDegrees: 29 });
  assert.equal(byAsset('rogland_moonlit_night').recommendation, 'rejected');
  assert.equal(tally(MANIFEST.candidates.filter(candidate => candidate.source === 'polyhaven-namaqualand')).recommended, 0,
    'Namaqualand supplies no recommended asset');
  assert.equal(tally(MANIFEST.candidates.filter(candidate => candidate.role === 'sky-hdri')).recommended, 0,
    'every HDRI waits for a creator atmosphere decision');
  for (const candidate of MANIFEST.candidates.filter(entry => entry.recommendation !== 'recommended' && entry.facts.kind === 'model')) {
    assert.ok(candidate.reason.length > 20, `${candidate.id} explains its verdict`);
  }
});

test('the plan document lists every source and candidate with its verdict, and its summary counts match', () => {
  const doc = readFileSync(new URL('../../../../docs/legacy/environment/ASSET_SOURCES_2026-11.md', import.meta.url), 'utf8');
  const lines = doc.split('\n');
  for (const candidate of MANIFEST.candidates) {
    const row = lines.find(line => line.startsWith(`| \`${candidate.assetId}\` |`));
    assert.ok(row, `${candidate.assetId} has a row in the plan`);
    assert.ok(row.includes(`| ${candidate.facts.kind} |`), `${candidate.assetId} row names its kind`);
    assert.ok(row.includes(`| ${candidate.recommendation} |`), `${candidate.assetId} row says ${candidate.recommendation}`);
  }
  for (const source of MANIFEST.sources) {
    const row = lines.find(line => line.startsWith(`| ${source.title}`));
    assert.ok(row, `${source.title} has a licence-risk row`);
    assert.ok(row.trimEnd().endsWith(`| ${source.recommendation} |`), `${source.title} row says ${source.recommendation}`);
  }
  for (const asset of MANIFEST.inUse) assert.ok(doc.includes(`\`${asset.assetId}\``), `${asset.assetId} is named as in use`);
  const counts = tally(MANIFEST.candidates);
  const flat = doc.replace(/\s+/g, ' ');
  assert.ok(flat.includes(`Of their ${MANIFEST.candidates.length} assets, ${counts.recommended} recommended, `
    + `${counts.conditional} conditional and ${counts.rejected} rejected.`), 'the summary counts match the manifest');
  assert.match(doc, /validateAssetCandidates/);
  assert.match(doc, /## Verified live on 6 November 2026/);
  assert.match(doc, /## Not verified/);
});

test('the module stays pure shared code within the ES2020 baseline', () => {
  const source = readFileSync(new URL('./asset-candidates.ts', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:"'`])\/\/.*$/gm, '$1');
  assert.doesNotMatch(source, /from\s+['"](three|@iwsdk\/[^'"]*|react|react-dom)['"]/);
  assert.doesNotMatch(source, /\b(Math\.random|Date\.now|new Date|performance\.now|setTimeout|setInterval|requestAnimationFrame|localStorage|sessionStorage|indexedDB|fetch)\b/);
  assert.doesNotMatch(source, /(?<![.\w$])(window|document|navigator)\./);
  assert.doesNotMatch(source, /\.at\(|\.findLast\(|\.findLastIndex\(|Object\.hasOwn\(|\.replaceAll\(|structuredClone\(|\d_\d/);
});
