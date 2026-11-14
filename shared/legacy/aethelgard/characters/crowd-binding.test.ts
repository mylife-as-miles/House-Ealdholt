import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';
import {
  CODEX_OWNER_MOTIONS, CROWD_OWNER_MOTIONS_ALL, crowdFaceCalibration, crowdResidentPaths, isWalkLikeClip, parseCrowdResidentMeta, planCrowdClips,
  type CrowdResidentMeta,
} from './crowd-binding';
import { DEFAULT_FACE_CALIBRATION, validateFaceCalibration } from './face-performance';
import { EALDHOLT_VILLAGE_POPULATION as POP, getPopulationClip, type PopulationArchetype, type PopulationResident } from './village-population';

// The published crowd files (canonical desktop copy) and the clip library manifest agree with the binding contract.
const CROWD = new URL('../../../../main game/public/assets/legacy/environment/aethelgard/characters/crowd-v1/', import.meta.url);
const manifestPath = new URL('clips/manifest.json', CROWD);
const libraryNames = new Map<PopulationArchetype, Set<string>>();
if (existsSync(manifestPath)) {
  const m = JSON.parse(readFileSync(manifestPath, 'utf8')) as { libraries: Record<string, { clips: Record<string, unknown> }> };
  for (const [a, l] of Object.entries(m.libraries)) libraryNames.set(a as PopulationArchetype, new Set(Object.keys(l.clips)));
}
const residentsDir = new URL('residents/', CROWD);
const publishedJson = existsSync(residentsDir) ? readdirSync(residentsDir).filter(f => f.endsWith('.json') && f !== 'index.json') : [];

/** A manifest for any crowd resident from the population data (placement scale 1), for planning checks. */
function metaFor(r: PopulationResident): CrowdResidentMeta {
  const a = r.appearance;
  return parseCrowdResidentMeta({ residentId: r.id, archetype: a.archetype, clipLibrary: `crowd-clips-${a.archetype}-v1.glb`, placementScale: 1,
    envelopeMarginMetres: 0.3, faceTier: 'face-joints-only', faceCalibration: { upperLidClosed: 0.48, lowerLidClosed: -0.15, jawOpen: 0.2 },
    motion: { idle: a.motion.idle, walk: a.motion.walk, talk: a.motion.talk, rate: a.motion.rate, roleClips: a.motion.roleClips },
    props: a.props.map(p => ({ id: p.id, kit: 'x', socket: p.socket })),
    measured: { triangles: 3500, materials: 1, meshes: 1, joints: 64, morphTargets: 0, clips: 0, fileBytes: 240000 } }, r.id);
}

test('every published resident manifest parses, belongs to the population and names its archetype library', { skip: !publishedJson.length && 'crowd-v1 not published' }, () => {
  for (const f of publishedJson) {
    const json = JSON.parse(readFileSync(new URL(f, residentsDir), 'utf8'));
    const meta = parseCrowdResidentMeta(json, f.slice(0, -5));
    const r = POP.residents.find(x => x.id === meta.residentId)!;
    assert.ok(r && r.appearance.kind === 'crowd', `${meta.residentId} is a crowd resident`);
    assert.equal(meta.archetype, r.appearance.archetype);
    assert.equal(meta.motion.walk, r.appearance.motion.walk);
    assert.deepEqual(meta.motion.roleClips, r.appearance.motion.roleClips);
    assert.equal(crowdResidentPaths(meta.residentId, meta.archetype).library, `crowd-v1/clips/${meta.clipLibrary}`);
    assert.equal(validateFaceCalibration(crowdFaceCalibration(meta)), null);
    assert.ok(Object.isFrozen(meta) && Object.isFrozen(meta.motion.roleClips));
  }
});

test('manifest parsing refuses what the adapters cannot trust', () => {
  const good = JSON.parse(JSON.stringify({ residentId: 'ealdholt-test', archetype: 'adult-male', clipLibrary: 'crowd-clips-adult-male-v1.glb', placementScale: 1,
    faceTier: 'face-joints-only', faceCalibration: { upperLidClosed: 0.5, lowerLidClosed: -0.15, jawOpen: 0.2 },
    motion: { idle: 'idle', walk: 'walk', talk: 'talk', rate: 1, roleClips: [] }, measured: { triangles: 3500, materials: 1, joints: 64, fileBytes: 1 } }));
  assert.equal(parseCrowdResidentMeta(good).residentId, 'ealdholt-test');
  assert.throws(() => parseCrowdResidentMeta(good, 'someone-else'), /not someone-else/);
  assert.throws(() => parseCrowdResidentMeta({ ...good, clipLibrary: 'crowd-clips-child-v1.glb' }), /adult-male clip library/);
  assert.throws(() => parseCrowdResidentMeta({ ...good, faceTier: 'joints-and-morphs' }), /joints-only/);
  assert.throws(() => parseCrowdResidentMeta({ ...good, placementScale: 3 }), /placementScale/);
  assert.throws(() => parseCrowdResidentMeta({ ...good, measured: { ...good.measured, morphTargets: 44 } }), /no morphs/);
  assert.throws(() => parseCrowdResidentMeta({ ...good, motion: { ...good.motion, walk: 'Walk Fast' } }), /walk must be a clip name/);
  assert.throws(() => parseCrowdResidentMeta(null), /object/);
});

test('every crowd resident\'s every role clip is presentable with the patched owner, and never by idle or talk', { skip: !libraryNames.size && 'clip libraries not published' }, () => {
  let roles = 0, carries = 0, seated = 0;
  for (const r of POP.residents.filter(x => x.appearance.kind === 'crowd')) {
    const meta = metaFor(r), names = libraryNames.get(r.appearance.archetype)!;
    const base = planCrowdClips(meta, names, {}, CODEX_OWNER_MOTIONS.patched);
    assert.equal(base.clips.idle, meta.motion.idle); assert.equal(base.clips.walk, meta.motion.walk); assert.equal(base.clips.talk, meta.motion.talk);
    assert.equal(base.unpresentable, null);
    assert.equal(base.clips.work, undefined);
    if (names.has(`${meta.motion.walk}_start`)) assert.equal(base.clips.start, `${meta.motion.walk}_start`);
    for (const role of meta.motion.roleClips) {
      const plan = planCrowdClips(meta, names, { roleClip: role }, CODEX_OWNER_MOTIONS.patched);
      assert.equal(plan.unpresentable, null, `${r.id} ${role}`);
      const used = Object.values(plan.clips);
      assert.equal(new Set(used).size, used.length, `${r.id} ${role}: no clip serves two motions`);
      for (const n of used) assert.ok(names.has(n));
      if (isWalkLikeClip(role)) {
        carries++;
        if (role !== meta.motion.walk) { assert.equal(plan.clips.walk, role); assert.ok(plan.walkIsOverlay); assert.equal(plan.clips.start, undefined); }
      } else {
        roles++;
        assert.equal(plan.clips.work, role);
        assert.notEqual(plan.clips.work, plan.clips.idle); assert.notEqual(plan.clips.work, plan.clips.talk);
        if (names.has(`${role}_enter`)) assert.equal(plan.clips.workEnter, `${role}_enter`);
        if (getPopulationClip(role)?.kind === 'seated') { seated++; assert.equal(plan.clips.sit, 'sit'); assert.ok(plan.seatedWork); }
        else assert.equal(plan.clips.sit, undefined, 'seated clips only when the slot needs them');
      }
    }
  }
  assert.ok(roles > 100 && carries > 20 && seated > 5, `${roles} role loops, ${carries} carries, ${seated} seated`);
});

test('with the owner as it is, work is reported unpresentable rather than replaced; plans are stable keys', { skip: !libraryNames.size && 'clip libraries not published' }, () => {
  const farmer = POP.residents.find(r => r.appearance.kind === 'crowd' && r.appearance.motion.roleClips.includes('work_hoe'))!;
  const meta = metaFor(farmer), names = libraryNames.get(farmer.appearance.archetype)!;
  const now = planCrowdClips(meta, names, { roleClip: 'work_hoe' }, CODEX_OWNER_MOTIONS.current);
  assert.equal(now.unpresentable, 'work_hoe');
  assert.deepEqual(Object.keys(now.clips).sort(), ['idle', 'talk', 'walk']);
  const carry = farmer.appearance.motion.roleClips.find(isWalkLikeClip);
  if (carry) assert.equal(planCrowdClips(meta, names, { roleClip: carry }, CODEX_OWNER_MOTIONS.current).clips.walk, carry, 'carries need no owner change');
  assert.equal(planCrowdClips(meta, names, { roleClip: 'work_pray' }, CODEX_OWNER_MOTIONS.patched).unpresentable, 'work_pray', 'not this resident\'s role');
  const a = planCrowdClips(meta, names, { roleClip: 'work_hoe' }, CODEX_OWNER_MOTIONS.patched), b = planCrowdClips(meta, [...names], { roleClip: 'work_hoe' }, CODEX_OWNER_MOTIONS.patched);
  assert.equal(a.key, b.key);
  assert.notEqual(a.key, planCrowdClips(meta, names, { roleClip: 'work_hoe', seated: true }, CODEX_OWNER_MOTIONS.patched).key);
  assert.throws(() => planCrowdClips(meta, new Set(['idle']), {}, CODEX_OWNER_MOTIONS.patched), /not in its library/);
  assert.throws(() => planCrowdClips(meta, names, {}, ['walk']), /idle motion/);
  assert.deepEqual([...CODEX_OWNER_MOTIONS.current], ['idle', 'talk', 'walk', 'sit']);
  assert.equal(CROWD_OWNER_MOTIONS_ALL.length, 11);
  assert.equal(crowdFaceCalibration(meta).eyeYawLimit, DEFAULT_FACE_CALIBRATION.eyeYawLimit);
});
