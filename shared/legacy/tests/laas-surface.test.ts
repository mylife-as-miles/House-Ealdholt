import assert from 'node:assert/strict';
import test from 'node:test';
import { villageSurfaceBlend, type VillageSurfaceFields } from '../aethelgard/environment/laas-surface';

const dry: VillageSurfaceFields = { slope: 0, vegetationDensity: 1, moisture: 0, rockExposure: 0, riverDepthMetres: 0, shoreWetness: 0 };

test('portable LAAS surface preserves open grass, forest floor and bare rock coverage', () => {
  assert.deepEqual(villageSurfaceBlend(dry).weights, { soil: 0, grass: 1, forestFloor: 0, rock: 0 });
  assert.equal(villageSurfaceBlend({ ...dry, moisture: 0.6 }).weights.forestFloor, 1);
  assert.deepEqual(villageSurfaceBlend({ ...dry, slope: 1.15 }).weights, { soil: 0, grass: 0, forestFloor: 0, rock: 1 });
  assert.equal(villageSurfaceBlend({ ...dry, vegetationDensity: 0 }).weights.soil, 1);
});

test('continuous surface weights stay bounded and conserve coverage across transition knees', () => {
  for (let i = 0; i <= 200; i++) {
    const result = villageSurfaceBlend({ ...dry, slope: i / 100, moisture: i / 200, vegetationDensity: 0.7, rockExposure: 0.3 });
    const weights = Object.values(result.weights);
    assert.ok(weights.every(value => value >= 0 && value <= 1));
    assert.ok(Math.abs(weights.reduce((a, b) => a + b, 0) - 1) < 1e-12);
    assert.ok(result.roughness >= 0.25 && result.roughness <= 1);
  }
  for (const slope of [0.22, 0.45, 0.5, 0.62, 0.9, 1.15]) {
    const left = villageSurfaceBlend({ ...dry, moisture: 0.45, slope: slope - 1e-6 });
    const right = villageSurfaceBlend({ ...dry, moisture: 0.45, slope: slope + 1e-6 });
    for (const key of ['soil', 'grass', 'forestFloor', 'rock'] as const) assert.ok(Math.abs(left.weights[key] - right.weights[key]) < 1e-4);
  }
});

test('water margins darken linear albedo and reduce roughness without inventing a water level', () => {
  const base = villageSurfaceBlend(dry);
  const shore = villageSurfaceBlend({ ...dry, shoreWetness: 1 });
  const river = villageSurfaceBlend({ ...dry, riverDepthMetres: 2 });
  assert.deepEqual(base.weights, shore.weights);
  assert.ok(shore.wetAlbedoMultiplier < base.wetAlbedoMultiplier);
  assert.ok(shore.roughness < base.roughness);
  assert.equal(river.wetAlbedoMultiplier, 1 - 0.75 * 0.55);
  assert.equal(base.wetAlbedoMultiplier, 1);
});

test('malformed sample fields fail before producing NaN bake data and source inputs stay unchanged', () => {
  const before = JSON.stringify(dry);
  villageSurfaceBlend(dry);
  assert.equal(JSON.stringify(dry), before);
  for (const key of Object.keys(dry) as (keyof VillageSurfaceFields)[]) {
    for (const value of [NaN, Infinity, -Infinity]) assert.throws(() => villageSurfaceBlend({ ...dry, [key]: value }), RangeError);
    const incomplete: Partial<VillageSurfaceFields> = { ...dry };
    delete incomplete[key];
    assert.throws(() => villageSurfaceBlend(incomplete as VillageSurfaceFields), RangeError);
  }
  assert.throws(() => villageSurfaceBlend({ ...dry, slope: -0.1 }), RangeError);
  assert.throws(() => villageSurfaceBlend({ ...dry, riverDepthMetres: -1 }), RangeError);
});
