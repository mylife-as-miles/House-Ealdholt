import assert from 'node:assert/strict';
import test from 'node:test';
import { loadEaldholtPondProbeIdentity } from '../aethelgard/environment/pond-probe-config';
import { EALDHOLT_POND_PROBE } from '../aethelgard/environment/pond-probe';
import {
  RELEASE_VILLAGE_FILES, RELEASE_VILLAGE_PATH, bundledReleaseVillageMarker, readReleaseVillage,
  releaseEaldholtPondProbeConfig, releaseVillageUrls,
} from '../aethelgard/release-village';
import { ealdholtVisitMode } from '../aethelgard/visit-route';

const profile = (name: 'desktop' | 'quest') => ({ ...RELEASE_VILLAGE_FILES[name], modelSha256: 'b'.repeat(64), lightingVersion: `${name}-balanced-r1` });
const marker = (profiles: Record<string, unknown> = { desktop: profile('desktop'), quest: profile('quest') }) => ({ version: 1, path: RELEASE_VILLAGE_PATH, profiles });

test('a bundled village is read per profile; anything absent or malformed reads as no village', () => {
  assert.deepEqual(readReleaseVillage(marker(), 'desktop'), profile('desktop'));
  assert.deepEqual(readReleaseVillage(marker({ quest: profile('quest') }), 'quest'), profile('quest'));
  assert.equal(readReleaseVillage(marker({ quest: profile('quest') }), 'desktop'), null, 'a Quest-only build has no desktop village');
  for (const raw of [undefined, null, '', 'null', 7, [], {}, { ...marker(), version: 2 }, { ...marker(), path: 'http://127.0.0.1:4188/' }]) {
    assert.equal(readReleaseVillage(raw, 'desktop'), null, JSON.stringify(raw));
  }
  for (const change of [{ model: 'other.glb' }, { hdr: '../secret.hdr' }, { modelSha256: 'B'.repeat(64) }, { modelSha256: 'b'.repeat(63) },
    { lightingVersion: '' }, { lightingVersion: 'x'.repeat(161) }, { lightingVersion: 'line\nbreak' }]) {
    assert.equal(readReleaseVillage(marker({ desktop: { ...profile('desktop'), ...change } }), 'desktop'), null, JSON.stringify(change));
  }
});

test('outside a release build no marker exists', () => {
  assert.equal(bundledReleaseVillageMarker(), null);
});

test('bundled files resolve under the app base, absolute or relative, and pair the pond probe with the model', () => {
  const village = readReleaseVillage(marker(), 'quest')!;
  const relative = releaseVillageUrls(village, './');
  assert.equal(relative.base, './legacy/elderbloom/');
  assert.equal(relative.model, './legacy/elderbloom/' + RELEASE_VILLAGE_FILES.quest.model);
  const absolute = releaseVillageUrls(readReleaseVillage(marker(), 'desktop')!, 'https://crownfall.example/play/');
  assert.equal(absolute.model, new URL(RELEASE_VILLAGE_FILES.desktop.model, 'https://crownfall.example/play/legacy/elderbloom/').href);
  assert.equal(releaseVillageUrls(village, 'https://crownfall.example/play').base, 'https://crownfall.example/play/legacy/elderbloom/');
  const probe = releaseEaldholtPondProbeConfig(village, 'quest', relative);
  assert.deepEqual(probe, { profile: 'quest', modelUrl: relative.model, modelSha256: village.modelSha256, lightingVersion: village.lightingVersion,
    hdrUrl: relative.hdr, metadataUrl: relative.metadata });
});

test('the bundled probe metadata is still checked against the identity the build recorded', async () => {
  const village = readReleaseVillage(marker(), 'quest')!;
  const config = releaseEaldholtPondProbeConfig(village, 'quest', releaseVillageUrls(village, 'https://crownfall.example/'));
  const metadata = { version: 1, profile: 'quest', modelSha256: village.modelSha256, lightingVersion: village.lightingVersion, sourceAxes: true,
    neutralFillAlreadyBaked: true, realtime: false, format: 'radiance-rgbe', ...EALDHOLT_POND_PROBE.quest };
  const requested: string[] = [];
  const fetcher = (async (url: string) => { requested.push(url); return Response.json(metadata); }) as unknown as typeof fetch;
  const identity = await loadEaldholtPondProbeIdentity(config, new AbortController().signal, fetcher);
  assert.equal(identity.modelSha256, village.modelSha256);
  assert.deepEqual(requested, ['https://crownfall.example/legacy/elderbloom/' + RELEASE_VILLAGE_FILES.quest.metadata]);
  const stale = (async () => Response.json({ ...metadata, lightingVersion: 'older-r0' })) as unknown as typeof fetch;
  await assert.rejects(loadEaldholtPondProbeIdentity(config, new AbortController().signal, stale), /stale/);
});

test('release builds: the bundled village opens inherited, its absence keeps the Legacy screen, and development is unchanged', () => {
  const queries = ['', '?ealdholt-preview=1', '?ealdholt-house=1', '?ealdholt-house=0', '?legacy=fresh', '?legacyPreview=review', '?unrelated=1'];
  for (const query of queries) {
    assert.equal(ealdholtVisitMode(false, query, false, true), 'inherited', `release with village ${query}`);
    assert.equal(ealdholtVisitMode(false, query, false, false), null, `release without village ${query}`);
    assert.equal(ealdholtVisitMode(false, query, true, false), null, `local configuration cannot enable a release ${query}`);
    for (const configured of [false, true]) {
      assert.equal(ealdholtVisitMode(true, query, configured, true), ealdholtVisitMode(true, query, configured, false), `development ignores the marker ${query}`);
    }
  }
});
