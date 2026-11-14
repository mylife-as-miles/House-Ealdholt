import assert from 'node:assert/strict';
import test from 'node:test';
import {ealdholtPlantTriangleBudget, EALDHOLT_PLANT_TRIANGLE_SHARE, LEGACY_VIEW_TRIANGLE_BUDGET} from './plant-triangle-budget';
import {EALDHOLT_GROUNDCOVER_VISIBILITY} from './groundcover-visibility';

test('all plant budgets together stay inside the performance table for every preset', () => {
  const share = Object.values(EALDHOLT_PLANT_TRIANGLE_SHARE).reduce((sum, value) => sum + value, 0);
  assert.ok(share <= 2 / 3 + 1e-9, 'plants leave a third of the view for everything else');
  for (const quality of ['low', 'medium', 'high'] as const) {
    const total = ealdholtPlantTriangleBudget('trees', quality) + EALDHOLT_GROUNDCOVER_VISIBILITY[quality].triangleBudget + ealdholtPlantTriangleBudget('regionalGroundcover', quality);
    assert.ok(total <= LEGACY_VIEW_TRIANGLE_BUDGET[quality], `${quality}: ${total} plant triangles fit ${LEGACY_VIEW_TRIANGLE_BUDGET[quality]}`);
    assert.equal(EALDHOLT_GROUNDCOVER_VISIBILITY[quality].triangleBudget, ealdholtPlantTriangleBudget('groundcover', quality));
  }
  assert.deepEqual(['low', 'medium', 'high'].map(q => ealdholtPlantTriangleBudget('trees', q as 'low')), [102_000, 272_000, 510_000]);
});
