import assert from 'node:assert/strict';
import test from 'node:test';
import { createEaldholtFarProjectionData, traceEaldholtFarProjection } from '../aethelgard/environment/far-surround-projection';
import { EALDHOLT_FAR_LAND_FIELD, sampleEaldholtFarGeography, type EaldholtFarProjectionPacket } from '../aethelgard/environment/far-surround';

const packet = (): EaldholtFarProjectionPacket => ({
  geography: { version: 1, axes: 'source:+X-east/-Z-north', landField: EALDHOLT_FAR_LAND_FIELD,
    coastSamples: new Float32Array([-100, -50, 0, -40, 100, -50]),
    channelSamples: new Float32Array([0, -8, 8, 1, 100, -6, 6, 1]),
    seaLevel: 1, sourceEnvelope: { minX: 0, maxX: 100, minZ: -50, maxZ: 50 }, riverJoinX: 100, riverFarX: 5000 },
  localBounds: { min: [-150, 0, -150], max: [200, 20, 200] },
});

test('far projection copies canonical coast/river rows into bounded packed uniforms', () => {
  const p = packet(), data = createEaldholtFarProjectionData(p);
  assert.equal(data.coastCount, 3); assert.equal(data.channelCount, 2);
  assert.deepEqual(Array.from(data.coast.slice(0, 6)), Array.from(p.geography.coastSamples));
  assert.deepEqual(Array.from(data.channel.slice(0, 8)), Array.from(p.geography.channelSamples));
  assert.deepEqual(data.landField, [2.4, .45, .35, 250, 280]);
  const first = data.coast[0]; p.geography.coastSamples[0] = -900;
  assert.equal(data.coast[0], first, 'uniform ownership does not mutate or retain input arrays');
  assert.throws(() => createEaldholtFarProjectionData({ ...p, geography: { ...p.geography, coastSamples: new Float32Array([0, -50, 0, -40]) } }), /projection samples/);
});

test('finite projection rays retain sea west, river east and mainland on other sides', () => {
  const p = packet();
  for (const [x, z, kind] of [[-1000, 0, 'sea'], [4000, 0, 'channel'], [0, -1000, 'mainland'], [0, 1000, 'mainland'], [4000, 100, 'mainland']] as const) {
    const hit = traceEaldholtFarProjection(p, [x, 100, z], [0, -1, 0]);
    assert.equal(hit?.kind, kind); assert.ok(hit && hit.distance > 0);
    assert.ok(Math.abs(hit!.point[1] - sampleEaldholtFarGeography(p.geography, x, z).level) < 1e-10);
  }
  assert.equal(traceEaldholtFarProjection(p, [0, 100, 0], [1, 0, 0]), null);
  assert.equal(traceEaldholtFarProjection(p, [0, 100, 0], [0, 1, 0]), null);
  assert.equal(traceEaldholtFarProjection(p, [0, 100, 0], [0, 0, 0]), null);
  assert.throws(() => traceEaldholtFarProjection(p, [NaN, 0, 0], [0, -1, 0]), /projection ray/);
});

test('actual low Quest pond eye keeps local upward/downward skies open and traces only outside the local slab', () => {
  // Source envelope, footprint, sea/river stages and probe eye measured from
  // the real Quest R11 packet. No private model file is required by this test.
  const p: EaldholtFarProjectionPacket = { geography: {
    version: 1, axes: 'source:+X-east/-Z-north', landField: EALDHOLT_FAR_LAND_FIELD,
    coastSamples: new Float32Array([-80.39999389648438, -65.61839294433594, 160.88394165039062, -65.61839294433594]),
    channelSamples: new Float32Array([-65.61839294433594, 114.03227996826172, 145.28553771972656, .4547862112522125,
      131.783935546875, 112.01409912109375, 123.287841796875, .33634480834007263]),
    seaLevel: .4547862112522125, sourceEnvelope: { minX: -50.39999771118164, maxX: 101.783935546875, minZ: -50.39999771118164, maxZ: 101.783935546875 }, riverJoinX: 131.783935546875, riverFarX: 10000,
  }, localBounds: { min: [-130.61839294433594, -1.0616627931594849, -80.39999389648438], max: [131.783935546875, 22.695933627562113, 160.88394165039062] } };
  const eye = [-10.394722571728625, 1.1082419988393175, -4.383616747721334];
  assert.ok(Math.abs(sampleEaldholtFarGeography(p.geography, eye[0], eye[2]).level - 3.271772828133827) < 1e-10);
  for (const ray of [[0, 1, 0], [1, 1, 0], [-1, 1, 0], [0, 1, 1], [0, -1, 0]]) assert.equal(traceEaldholtFarProjection(p, eye, ray), null, 'generic far field must never fill the local footprint');
  const grazing = traceEaldholtFarProjection(p, eye, [1, 1e-8, 0]);
  assert.ok(grazing && grazing.point.every(Number.isFinite)); assert.ok(grazing.point[0] > p.localBounds.max[0]);
  const seaBeforeEntry = traceEaldholtFarProjection(p, [-1000, 20, 0], [1, -.1, 0]);
  assert.equal(seaBeforeEntry?.kind, 'sea'); assert.ok(seaBeforeEntry!.point[0] < p.localBounds.min[0], 'retain legitimate outside foreground hits before entering the local slab');
  const farDown = traceEaldholtFarProjection(p, [4000, 100, 120], [0, -1, 0]);
  const farUp = traceEaldholtFarProjection(p, [4000, -1, 120], [0, 1, 0]);
  assert.equal(farDown?.kind, 'channel'); assert.equal(farUp?.kind, 'channel', 'upward far-only hits remain valid outside the local footprint');
  assert.equal(traceEaldholtFarProjection(p, eye, [1e-12, 1, 0]), null);
});

// Raised geometry must never silently enter the withheld three-refinement path.
test('Native projection refuses the unsupported layered mainland packet', () => {
  const p = packet();
  Object.assign(p.geography, { mainlandRelief: {} });
  assert.throws(() => createEaldholtFarProjectionData(p), /unqualified for layered mainland/);
  assert.throws(() => traceEaldholtFarProjection(p, [500, 100, 300], [0, -1, 0]), /unqualified for layered mainland/);
});
