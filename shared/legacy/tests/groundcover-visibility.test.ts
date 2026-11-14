import assert from 'node:assert/strict';
import test from 'node:test';
import { EALDHOLT_VILLAGE_VIEWS } from '../aethelgard/village-views';
import { ealdholtPlantTriangleBudget } from '../aethelgard/environment/plant-triangle-budget';
import { EALDHOLT_GROUNDCOVER_VISIBILITY, EALDHOLT_GROUNDCOVER_FAMILY_RESERVE, ealdholtRepresentativePlantDiameter, selectEaldholtGroundcoverCells,
  type EaldholtGroundcoverCell, type EaldholtGroundcoverProjection } from '../aethelgard/environment/groundcover-visibility';

// Budgets follow the performance table (L-12); costs below are relative to High's.
const HIGH = EALDHOLT_GROUNDCOVER_VISIBILITY.high.triangleBudget;
const projection: EaldholtGroundcoverProjection = { quality: 'high', projectionScaleY: 1 / Math.tan(Math.PI / 8), drawBufferHeight: 800, nearPlane: .15 };
const cell = (id: number, changes: Partial<EaldholtGroundcoverCell> = {}): EaldholtGroundcoverCell => ({
  id, family: 'original-flower-family', inFrustum: true, nearDepth: 100, farDepth: 110,
  plantDiameter: .7, triangles: 12_000, instances: 40, drawCalls: 1, ...changes,
});

test('original source plants beyond the former 25m cutoff remain eligible in the unchanged Overview', () => {
  const view = EALDHOLT_VILLAGE_VIEWS.find(view => view.id === 'overview')!;
  const direction = view.target.map((value, i) => value - view.position[i]);
  const length = Math.hypot(...direction), forward = direction.map(value => value / length);
  // A source cell by the existing village, with ordinary transformed flower
  // diameter. This is projection data only, never a generated scene.
  const center = [19, .5, 32], halfSize = [4, .5, 4];
  const depth = center.reduce((sum, value, i) => sum + (value - view.position[i]) * forward[i], 0);
  const radius = halfSize.reduce((sum, value, i) => sum + value * Math.abs(forward[i]), 0);
  assert.ok(Math.hypot(...center.map((value, i) => value - view.position[i])) > 25);
  const result = selectEaldholtGroundcoverCells([cell(0, { nearDepth: depth - radius, farDepth: depth + radius })], projection);
  assert.deepEqual(result.selectedIds, [0]);
  assert.ok(result.minimumSelectedPixelDiameter > 5);
  assert.equal(result.selectedInstances, 40);
});

test('representative source size is a nonmutating median and a large spatial cell cannot qualify subpixel plants', () => {
  const sizes = Object.freeze([.4, .8, .6, 100]);
  assert.equal(ealdholtRepresentativePlantDiameter(sizes), .7);
  assert.deepEqual(sizes, [.4, .8, .6, 100]);
  assert.equal(ealdholtRepresentativePlantDiameter([NaN, -1, 0, Infinity]), 0);
  const tinyPlants = cell(1, { plantDiameter: .01 });
  const result = selectEaldholtGroundcoverCells([tinyPlants], projection);
  assert.deepEqual(result.selectedIds, []);
  assert.equal(result.rejectedSizeCells, 1);
  assert.equal(result.selectedTriangles, 0);
});

test('FOV, actual draw-buffer resolution and camera-forward depth determine projected eligibility', () => {
  const small = cell(0, { plantDiameter: .1, nearDepth: 100, farDepth: 105 });
  assert.equal(selectEaldholtGroundcoverCells([small], projection).rejectedSizeCells, 1);
  assert.deepEqual(selectEaldholtGroundcoverCells([small], { ...projection, drawBufferHeight: 1600 }).selectedIds, [0]);
  assert.deepEqual(selectEaldholtGroundcoverCells([small], { ...projection, projectionScaleY: 1 / Math.tan(10 * Math.PI / 180) }).selectedIds, [0]);
  assert.deepEqual(selectEaldholtGroundcoverCells([cell(0, { ...small, nearDepth: 50, farDepth: 55 })], projection).selectedIds, [0]);
  const reduced = selectEaldholtGroundcoverCells([cell(1, { plantDiameter: .2 })], { ...projection, drawBufferHeight: 400 });
  assert.equal(reduced.rejectedSizeCells, 1, 'renderScale must influence the true pixel footprint');
});

test('frustum, behind-camera and near-clipped cells are rejected; near-plane intersections remain finite', () => {
  const cells = [cell(0, { inFrustum: false }), cell(1, { nearDepth: -8, farDepth: -1 }),
    cell(2, { nearDepth: .01, farDepth: .1 }), cell(3, { nearDepth: -1, farDepth: 2 })];
  const result = selectEaldholtGroundcoverCells(cells, projection);
  assert.deepEqual(result.selectedIds, [3]);
  assert.equal(result.rejectedFrustumCells, 1);
  assert.equal(result.rejectedDepthCells, 2);
  assert.ok(Number.isFinite(result.maximumSelectedPixelDiameter));
  assert.equal(result.selectedDrawCalls, 1);
});

test('stable source ordinals break equal benefit/cost ties independently of candidate input ordering', () => {
  const cells = [cell(20, { triangles: HIGH / 2 }), cell(3, { triangles: HIGH / 2 }), cell(10, { triangles: HIGH / 2 })];
  const first = selectEaldholtGroundcoverCells(Object.freeze(cells.map(value => Object.freeze(value))), projection);
  const second = selectEaldholtGroundcoverCells([...cells].reverse(), projection);
  assert.deepEqual(first.selectedIds, [3, 10]);
  assert.deepEqual(second, first);
  assert.equal(first.rejectedBudgetCells, 1);
});

test('all existing quality budgets are exact and whole-cell selection never exceeds them', () => {
  assert.deepEqual(Object.values(EALDHOLT_GROUNDCOVER_VISIBILITY).map(policy => policy.triangleBudget), (['high', 'medium', 'low'] as const).map(quality => ealdholtPlantTriangleBudget('groundcover', quality)));
  for (const quality of ['high', 'medium', 'low'] as const) {
    const budget = EALDHOLT_GROUNDCOVER_VISIBILITY[quality].triangleBudget;
    const cells = Array.from({ length: 4 }, (_, i) => cell(i, { plantDiameter: 1, triangles: budget / 2 }));
    const result = selectEaldholtGroundcoverCells(cells, { ...projection, quality });
    assert.equal(result.selectedTriangles, budget);
    assert.equal(result.selectedIds.length, 2);
    assert.equal(result.rejectedBudgetCells, 2);
    assert.equal(result.selectedDrawCalls, 2);
  }
});

test('selection measures projected benefit per resource cost and reports infeasible reserved families honestly', () => {
  const cells = [cell(0, { family: 'flower', triangles: HIGH }),
    cell(1, { family: 'grass', triangles: HIGH / 2 }), cell(2, { family: 'grass', triangles: HIGH / 2 })];
  const result = selectEaldholtGroundcoverCells(cells, projection);
  assert.deepEqual(result.selectedIds, [1, 2]);
  assert.deepEqual(result.families, [
    { family: 'flower', eligibleCells: 1, eligibleInstances: 40, selectedCells: 0, selectedInstances: 0, selectedTriangles: 0, selectedDrawCalls: 0 },
    { family: 'grass', eligibleCells: 2, eligibleInstances: 80, selectedCells: 2, selectedInstances: 80, selectedTriangles: HIGH, selectedDrawCalls: 2 },
  ]);
  const oversize = selectEaldholtGroundcoverCells([cell(0, { triangles: HIGH + 1 }), cell(1, { triangles: 100 })], projection);
  assert.deepEqual(oversize.selectedIds, [1]);
});

test('original groundcover has exact draw caps as well as unchanged triangle caps at every quality', () => {
  assert.deepEqual(Object.values(EALDHOLT_GROUNDCOVER_VISIBILITY).map(policy => policy.drawBudget), [160, 80, 32]);
  for (const quality of ['high', 'medium', 'low'] as const) {
    const policy = EALDHOLT_GROUNDCOVER_VISIBILITY[quality];
    const cells = Array.from({ length: 200 }, (_, id) => cell(id, { triangles: 100, plantDiameter: 1 }));
    const result = selectEaldholtGroundcoverCells(cells, { ...projection, quality });
    assert.equal(result.selectedDrawCalls, policy.drawBudget);
    assert.equal(result.selectedTriangles, policy.drawBudget * 100);
    assert.equal(result.rejectedDrawBudgetCells, 200 - policy.drawBudget);
    assert.ok(result.selectedTriangles <= policy.triangleBudget);
    assert.ok(result.reservedTriangles <= Math.floor(policy.triangleBudget * EALDHOLT_GROUNDCOVER_FAMILY_RESERVE));
    assert.ok(result.reservedDrawCalls <= Math.floor(policy.drawBudget * EALDHOLT_GROUNDCOVER_FAMILY_RESERVE));
  }
});

test('a bounded generic family reserve represents feasible families despite one dominant benefit/cost family', () => {
  const families = ['family-a', 'family-b', 'family-c', 'family-d'];
  const cells = families.map((family, id) => cell(id, { family, triangles: 4_000, plantDiameter: 1 }));
  cells.push(...Array.from({ length: 180 }, (_, i) => cell(i + 4, { family: 'dominant-family', triangles: 100, instances: 100, plantDiameter: 3 })));
  for (const quality of ['high', 'medium', 'low'] as const) {
    const result = selectEaldholtGroundcoverCells(cells, { ...projection, quality });
    for (const family of families) assert.equal(result.families.find(row => row.family === family)?.selectedCells, 1);
    assert.equal(result.families.find(row => row.family === 'dominant-family')!.selectedCells > 0, true);
    assert.ok(result.selectedDrawCalls <= result.drawBudget);
    assert.ok(result.selectedTriangles <= result.triangleBudget);
    assert.ok(result.reservedTriangles <= result.triangleBudget * .35);
    assert.ok(result.reservedDrawCalls <= result.drawBudget * .35);
    assert.deepEqual(selectEaldholtGroundcoverCells([...cells].reverse(), { ...projection, quality }), result);
  }
});

test('draw cost prevents tiny cheap source cells monopolising every available slot', () => {
  const sparse = Array.from({ length: 300 }, (_, id) => cell(id, { triangles: 1, instances: 1 }));
  const dense = Array.from({ length: 200 }, (_, i) => cell(300 + i, { triangles: 600, instances: 100 }));
  const result = selectEaldholtGroundcoverCells([...sparse, ...dense], projection);
  assert.equal(result.selectedDrawCalls, 160);
  assert.ok(result.selectedIds.filter(id => id >= 300).length > 100);
  assert.ok(result.selectedTriangles <= HIGH);
});

test('impossible resource costs are not forced by family representation, including multi-draw cells', () => {
  const cells = [cell(0, { family: 'too-many-triangles', triangles: HIGH + 1 }),
    cell(1, { family: 'too-many-draws', drawCalls: 161 }), cell(2, { family: 'feasible', drawCalls: 2, triangles: 100 })];
  const result = selectEaldholtGroundcoverCells(cells, projection);
  assert.deepEqual(result.selectedIds, [2]);
  assert.equal(result.selectedDrawCalls, 2);
  assert.equal(result.rejectedBudgetCells, 2);
  assert.equal(result.rejectedTriangleBudgetCells, 1);
  assert.equal(result.rejectedDrawBudgetCells, 1);
  for (const family of ['too-many-triangles', 'too-many-draws']) assert.equal(result.families.find(row => row.family === family)!.selectedCells, 0);
});

test('invalid projection, duplicate identities and invalid source-size/cost data cannot produce unsafe visibility', () => {
  for (const bad of [{ drawBufferHeight: 0 }, { projectionScaleY: NaN }, { nearPlane: -1 }, { quality: '__proto__' }]) {
    assert.throws(() => selectEaldholtGroundcoverCells([], { ...projection, ...bad } as EaldholtGroundcoverProjection), /Invalid source groundcover projection/);
  }
  assert.throws(() => selectEaldholtGroundcoverCells([cell(0), cell(0)], projection), /unique stable ordinals/);
  const bad = [cell(0, { plantDiameter: NaN }), cell(1, { triangles: -1 }), cell(2, { drawCalls: 0 }),
    cell(3, { nearDepth: 12, farDepth: 10 }), cell(4, { instances: 0 })];
  const result = selectEaldholtGroundcoverCells(bad, projection);
  assert.equal(result.rejectedInvalidCells, bad.length);
  assert.deepEqual(result.selectedIds, []);
  assert.equal(result.minimumSelectedPixelDiameter, 0);
  assert.equal(result.maximumSelectedPixelDiameter, 0);
});
