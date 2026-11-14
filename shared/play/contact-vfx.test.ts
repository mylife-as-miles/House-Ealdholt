import test from 'node:test';
import assert from 'node:assert/strict';
import { contactEventSeed, contactEvidenceUsable, planContactParticles, sampleContactParticle, type ContactFxInput } from './contact-vfx';
const impact: ContactFxInput = { id: 'pawn:shield-contact', seed: 17, point: { x: 1, y: 1.2, z: 0 },
  normal: { x: -1, y: 0, z: 0 }, material: 'iron', quality: 'high', strength: 1, groundY: .2 };
test('impact presentation requires real adjacent sockets and a resolved front-facing shield', () => {
  const p = { x: 0, y: 1, z: 0 };
  assert.equal(contactEvidenceUsable(p, p, true, true), true);
  assert.equal(contactEvidenceUsable(p, p, true, null), false);
  assert.equal(contactEvidenceUsable(p, p, true, false), false);
  assert.equal(contactEvidenceUsable(null, p, false, null), false);
  assert.equal(contactEvidenceUsable({ x: 1, y: 1, z: 0 }, p, false, null), false);
});

test('same authored contact reproduces its particles; a different marker has a distinct stable seed', () => {
  assert.deepEqual(planContactParticles(impact), planContactParticles(JSON.parse(JSON.stringify(impact))));
  assert.notEqual(contactEventSeed(17, 'shield'), contactEventSeed(17, 'thrust'));
  const p = planContactParticles(impact)[0];
  assert.ok(p.velocity.x < 0, 'particles leave the contacted surface toward the weapon');
});
test('metal, wood, stone and water have different finite material responses with bounded quality costs', () => {
  const kinds = ['steel', 'wood', 'stone', 'water'].map(material => planContactParticles({ ...impact, material: material as ContactFxInput['material'] })[0].kind);
  assert.deepEqual(kinds, [0, 1, 2, 3]);
  for (const [quality, count] of [['low', 6], ['medium', 12], ['high', 20], ['ultra', 28]] as const) {
    assert.equal(planContactParticles({ ...impact, quality, strength: 999 }).length, count);
  }
});
test('flesh and reduced motion do not create a second blood or particle path', () => {
  assert.deepEqual(planContactParticles({ ...impact, material: 'flesh' }), []);
  assert.deepEqual(planContactParticles({ ...impact, reducedMotion: true }), []);
  assert.deepEqual(planContactParticles({ ...impact, normal: { x: 0, y: 0, z: 0 } }), []);
});
test('closed-form sampling is independent of frame partitions, clamps to supplied surface and expires', () => {
  const p = planContactParticles({ ...impact, point: { x: 1, y: .21, z: 0 }, normal: { x: 0, y: -1, z: 0 } })[0];
  const first = sampleContactParticle(p, .2);
  for (const t of [.04, .08, .12, .16]) sampleContactParticle(p, t);
  assert.deepEqual(sampleContactParticle(p, .2), first);
  assert.equal(first.position.y, .2);
  assert.equal(sampleContactParticle(p, p.seconds).opacity, 0);
  assert.equal(sampleContactParticle(p, Infinity).opacity, 0);
});
test('malformed source data is rejected before GPU upload', () => {
  for (const patch of [{ seed: NaN }, { seed: -1 }, { id: 'x'.repeat(257) }, { groundY: Infinity },
    { point: { x: NaN, y: 0, z: 0 } }, { normal: { x: Infinity, y: 0, z: 0 } }, { material: '__proto__' }]) {
    assert.throws(() => planContactParticles({ ...impact, ...patch } as ContactFxInput));
  }
});
