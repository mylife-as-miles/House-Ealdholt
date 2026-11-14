import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  applyEaldholtDensityOrder, buildEaldholtInstanceCellIndex, createEaldholtDensityOrder, createEaldholtInstanceCellCoverage, createEaldholtInstanceCellHeadroom,
  createEaldholtInstanceCellSelector, createEaldholtInstanceCellUniforms, defaultEaldholtInstanceCellTiers, ealdholtAabbDistance, ealdholtAabbInFrustum,
  ealdholtCoverageDistance, ealdholtInstanceCellBandAt, ealdholtInstanceCellCurve, ealdholtInstanceCellDensityAt, ealdholtInstanceCellIndexSteps, ealdholtInstanceCellReachFade,
  ealdholtInstanceCellLevelFraction, ealdholtInstanceCellScaleAt, ealdholtInstanceCellThreshold, ealdholtPcg2d, ealdholtProjectionFocalPixels,
  EALDHOLT_INSTANCE_CELL_KINDS, EALDHOLT_INSTANCE_CELL_PROFILES, EALDHOLT_INSTANCE_CELL_STATE, EALDHOLT_INSTANCE_CELL_STATE_STRIDE, EALDHOLT_INSTANCE_CELLS_SOURCE,
  EALDHOLT_PERFORMANCE_BUDGETS, extractEaldholtFrustumPlanes, patchEaldholtInstanceCellShader, readEaldholtInstanceCellTiers,
  resolveEaldholtInstanceCellLayerSettings, type EaldholtInstanceCellIndex, type EaldholtInstanceCellKindRule, type EaldholtInstanceCellLayerInput,
  type EaldholtInstanceCellSelector,
} from './instance-cells';
import { EALDHOLT_VILLAGE_VIEWS } from '../village-views';

// ---- plain column-major matrix helpers (three's conventions, no three import)
type M = Float64Array;
function perspective(fovDegrees: number, aspect: number, near: number, far: number): M {
  const top = near * Math.tan(fovDegrees * Math.PI / 360), right = top * aspect, m = new Float64Array(16);
  m[0] = near / right; m[5] = near / top; m[10] = -(far + near) / (far - near); m[14] = -2 * far * near / (far - near); m[11] = -1;
  return m;
}
function lookAt(eye: number[], target: number[]): M {
  const sub = (a: number[], b: number[]) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const norm = (v: number[]) => { const l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; };
  const cross = (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const z = norm(sub(eye, target)), x = norm(cross([0, 1, 0], z)), y = cross(z, x), v = new Float64Array(16);
  v[0] = x[0]; v[4] = x[1]; v[8] = x[2]; v[12] = -dot(x, eye);
  v[1] = y[0]; v[5] = y[1]; v[9] = y[2]; v[13] = -dot(y, eye);
  v[2] = z[0]; v[6] = z[1]; v[10] = z[2]; v[14] = -dot(z, eye); v[15] = 1;
  return v;
}
function multiply(a: ArrayLike<number>, b: ArrayLike<number>): M {
  const out = new Float64Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) { let sum = 0; for (let k = 0; k < 4; k++) sum += a[k * 4 + r] * b[c * 4 + k]; out[c * 4 + r] = sum; }
  return out;
}
function clip(eye: number[], target: number[], fov = 60, far = 1000) { return multiply(perspective(fov, 16 / 9, .1, far), lookAt(eye, target)); }
function instance(out: Float32Array | number[], i: number, x: number, y: number, z: number, yaw: number, k: number): void {
  const c = Math.cos(yaw), s = Math.sin(yaw), o = i * 16;
  out[o] = c * k; out[o + 1] = 0; out[o + 2] = -s * k; out[o + 3] = 0;
  out[o + 4] = 0; out[o + 5] = k; out[o + 6] = 0; out[o + 7] = 0;
  out[o + 8] = s * k; out[o + 9] = 0; out[o + 10] = c * k; out[o + 11] = 0;
  out[o + 12] = x; out[o + 13] = y; out[o + 14] = z; out[o + 15] = 1;
}
const rule: EaldholtInstanceCellKindRule = { nominalSize: .5, cellSize: 16, hysteresis: .1,
  bands: [{ pixels: 40, lod: 0, density: 1 }, { pixels: 16, lod: 1, density: .6 }, { pixels: 7, lod: 2, density: .3 }] };
const lods = [{ triangles: 24, draws: 1 }, { triangles: 6, draws: 1 }, { triangles: 2, draws: 1 }];
const localBounds = { min: [-.3, 0, -.2] as [number, number, number], max: [.3, .6, .25] as [number, number, number] };
const roomy = { low: { draws: 1e6, triangles: 1e12 }, medium: { draws: 1e6, triangles: 1e12 }, high: { draws: 1e6, triangles: 1e12 } };
function grid(spacing = 2, size = 128, tiers?: { low: number; medium: number; high: number }, offset = 0, id = 'grass', salt = 7): EaldholtInstanceCellLayerInput {
  const side = Math.floor(size / spacing), matrices = new Float32Array(side * side * 16);
  let i = 0;
  for (let gx = 0; gx < side; gx++) for (let gz = 0; gz < side; gz++, i++)
    instance(matrices, i, offset + gx * spacing + .37, (gx * 7 + gz * 3) % 5 * .1, offset + gz * spacing + .61, (i * 2.399) % (Math.PI * 2), .8 + (i % 7) * .07);
  // Scatter priorities so tier and density prefixes are spatially uniform.
  return { id, kind: 'groundcover', matrices: applyEaldholtDensityOrder(matrices, createEaldholtDensityOrder(matrices, salt)), localBounds, lods, rule, tiers };
}
const parentsOf = (index: EaldholtInstanceCellIndex) => {
  const parent = new Int32Array(index.cellCount).fill(-1);
  for (let c = 0; c < index.cellCount; c++) for (let k = 0; k < index.cellChildCount[c]; k++) parent[index.cellChildStart[c] + k] = c;
  return parent;
};
/** Instance ranks drawn by the selection, mapped to the cell that draws them. */
function submitted(index: EaldholtInstanceCellIndex, selector: EaldholtInstanceCellSelector, layer = 0) {
  const owner = new Map<number, number>();
  for (let c = 0; c < index.cellCount; c++) if (index.cellLayer[c] === layer && selector.lod[c] >= 0)
    for (let k = 0; k < selector.count[c]; k++) owner.set(index.order[index.cellStart[c] + k], c);
  return owner;
}

test('shared cell module stays platform-free and deterministic, with its LAAS provenance', () => {
  const source = readFileSync(new URL('./instance-cells.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /from\s+['"](three|@iwsdk\/[^'"]*|react|react-dom)['"]/);
  assert.doesNotMatch(source, /Math\.random\s*\(|Date\.now\s*\(|new Date\s*\(|performance\.now|setTimeout|setInterval|requestAnimationFrame|\bdocument\.|\bwindow\./);
  assert.equal(EALDHOLT_INSTANCE_CELLS_SOURCE.commit, 'fd75fdb718996908aad3d22b59dfa297dc94298d');
  assert.equal(EALDHOLT_INSTANCE_CELLS_SOURCE.licence, 'MIT');
  assert.equal(EALDHOLT_INSTANCE_CELLS_SOURCE.adaptedCode[0].source, 'src/gpu/passes/Scatter.ts');
  assert.ok(EALDHOLT_INSTANCE_CELLS_SOURCE.adoptedDesign.some(item => item.source === 'src/vegetation/GroundRing.ts' && /1\/sqrt/.test(item.rule)));
  const licence = readFileSync(new URL('./LICENSE.laas.txt', import.meta.url), 'utf8');
  assert.match(licence, /MIT License/); assert.match(licence, new RegExp(EALDHOLT_INSTANCE_CELLS_SOURCE.notice.replace(/[()]/g, '\\$&')));
});

test('pcg2d port matches an exact uint32 reference of the LAAS hash', () => {
  const Mul = 1664525n, Add = 1013904223n, U = (v: bigint) => v & 0xffffffffn;
  const reference = (x: number, z: number, salt: number) => {
    const a0 = U(BigInt(x + 40000 + (salt & 0x3fff))), b0 = U(BigInt(z + 40000 + ((salt >> 14) & 0x3fff)));
    const a1 = U(a0 * Mul + Add), b1 = U(b0 * Mul + Add), a2 = U(a1 + b1 * Mul), b2 = U(b1 + a2 * Mul);
    const a3 = a2 ^ (a2 >> 16n), b3 = b2 ^ (b2 >> 16n), a4 = U(a3 + b3 * Mul), b4 = U(b3 + a4 * Mul);
    const a5 = a4 ^ (a4 >> 16n), b5 = b4 ^ (b4 >> 16n);
    return [Number(a5 & 0xffffffn) / 16777216, Number(b5 & 0xffffffn) / 16777216];
  };
  const out = new Float64Array(2), buckets = new Array(16).fill(0);
  for (const salt of [0, 1, 0x3fff, 0x4000, 0x51f3 ^ 0x1234f, 0x7fffffff]) {
    for (let x = -40000; x <= 1e6; x += 52919) for (let z = -40000; z <= 1e6; z += 77003) {
      ealdholtPcg2d(x, z, salt, out);
      assert.deepEqual([out[0], out[1]], reference(x, z, salt));
      assert.ok(out[0] >= 0 && out[0] < 1 && out[1] >= 0 && out[1] < 1);
    }
  }
  for (let x = 0; x < 64; x++) for (let z = 0; z < 64; z++) { ealdholtPcg2d(x, z, 77, out); buckets[Math.floor(out[0] * 16)]++; }
  for (const count of buckets) assert.ok(count > 4096 / 16 * .75 && count < 4096 / 16 * 1.25, 'hash is roughly uniform');
  ealdholtPcg2d(3, 4, 1, out); const a = out[0]; ealdholtPcg2d(3, 4, 2, out); assert.notEqual(out[0], a);
  assert.throws(() => ealdholtPcg2d(-40001, 0, 0, out), RangeError);
  assert.throws(() => ealdholtPcg2d(.5, 0, 0, out), RangeError);
  assert.throws(() => ealdholtPcg2d(0, 0, -1, out), RangeError);
});

test('density order is a stable, input-order-independent, spatially uniform permutation', () => {
  const side = 32, matrices = new Float32Array(side * side * 16);
  for (let i = 0; i < side * side; i++) instance(matrices, i, Math.floor(i / side) * 2 + .3, 0, (i % side) * 2 + .7, i, 1);
  const count = side * side, order = createEaldholtDensityOrder(matrices, 99);
  assert.deepEqual([...order].sort((a, b) => a - b), Array.from({ length: count }, (_, i) => i));
  assert.deepEqual(createEaldholtDensityOrder(matrices, 99), order);
  assert.notDeepEqual(createEaldholtDensityOrder(matrices, 100), order);
  const reversed = new Float32Array(matrices.length);
  for (let i = 0; i < count; i++) reversed.set(matrices.subarray((count - 1 - i) * 16, (count - i) * 16), i * 16);
  const a = applyEaldholtDensityOrder(matrices, order), b = applyEaldholtDensityOrder(reversed, createEaldholtDensityOrder(reversed, 99));
  assert.deepEqual(a, b, 'every placement keeps its rank when the input is reordered');
  const quarters = [0, 0, 0, 0];
  for (let i = 0; i < count / 4; i++) quarters[(a[i * 16 + 12] >= 32 ? 1 : 0) + (a[i * 16 + 14] >= 32 ? 2 : 0)]++;
  for (const share of quarters) assert.ok(share > count / 16 * .75 && share < count / 16 * 1.25, `prefix share ${share}`);
  assert.throws(() => applyEaldholtDensityOrder(matrices, new Uint32Array(count)), /permutation/);
  assert.throws(() => createEaldholtDensityOrder([1, 2, 3], 1), /16 values/);
});

test('the density curve is continuous, full through the nearest band, tier-scaled only beyond it, and instances shrink to nothing at the reach', () => {
  const s = resolveEaldholtInstanceCellLayerSettings(rule, 1150, 'groundcover');
  assert.deepEqual(s.bandDensities, [1, .6, .3]);
  assert.ok(Math.abs(s.reach - s.bandDistances[2] * .9) < 1e-9, 'zero scale where the last hysteresis window opens');
  assert.ok(Math.abs(s.reachStart - s.reach * .85) < 1e-9);
  assert.equal(s.castShadow, false); assert.equal(s.alphaMips, true);
  for (const factor of [1, .75, .5]) {
    let previous = ealdholtInstanceCellDensityAt(s, factor, 0);
    assert.equal(previous, 1);
    assert.equal(ealdholtInstanceCellDensityAt(s, factor, s.bandDistances[0]), 1, 'no thinning inside the nearest band on any tier');
    for (let d = .05; d < s.reach; d += .05) {
      const rho = ealdholtInstanceCellDensityAt(s, factor, d);
      assert.ok(rho <= previous + 1e-12, 'nonincreasing');
      assert.ok(previous - rho < .01, `continuous at ${d.toFixed(2)} m (step ${(previous - rho).toFixed(4)})`);
      previous = rho;
    }
    assert.equal(ealdholtInstanceCellDensityAt(s, factor, s.reach), 0, 'nothing is drawn beyond the reach');
    assert.ok(Math.abs(ealdholtInstanceCellDensityAt(s, factor, s.bandDistances[1]) - .6 * factor) < 1e-9, 'knot at the band edge');
  }
  assert.equal(ealdholtInstanceCellDensityAt(s, 0, 1), 0, 'a disabled tier draws nothing');
  // Level caps: the HIGH curve at each split edge less the hysteresis margin.
  assert.equal(s.levelCaps[0], 1); assert.equal(s.levelCaps[1], 1);
  assert.ok(Math.abs(s.levelCaps[2] - ealdholtInstanceCellDensityAt(s, 1, s.bandDistances[1] * .9)) < 1e-12);
  assert.equal(ealdholtInstanceCellBandAt(s, 0), 0); assert.equal(ealdholtInstanceCellBandAt(s, s.bandDistances[2] + 1), 3);
  assert.throws(() => resolveEaldholtInstanceCellLayerSettings({ ...rule, bands: [{ pixels: 40, lod: 0, density: .5 }] }, 1150), /full density/);
  assert.throws(() => resolveEaldholtInstanceCellLayerSettings({ ...rule, widenMax: 9 }, 1150), /widening/);
  assert.throws(() => resolveEaldholtInstanceCellLayerSettings({ ...rule, reachFade: 0 }, 1150), /reach fade/);
  // The reach fade scales every survivor smoothly to zero instead of thinning the last, widest ones.
  let fade = 1;
  for (let d = s.reachStart - 1; d <= s.reach + 1; d += .01) {
    const next = ealdholtInstanceCellReachFade(s.reachStart, s.reach, d);
    assert.ok(next <= fade + 1e-12 && fade - next < .002, `reach fade continuous at ${d.toFixed(2)}`); fade = next;
  }
  assert.equal(fade, 0); assert.equal(ealdholtInstanceCellReachFade(s.reachStart, s.reach, s.reachStart), 1);
  assert.ok(Math.abs(ealdholtInstanceCellCurve([10, 20], [1, .5], 2, Math.sqrt(200)) - Math.sqrt(.5)) < 1e-12, 'power-law segment');
});

test('index builds a deterministic nested quadtree with full-geometry bounds, origin-aligned roots and level-capped prefixes', () => {
  const tiers = { low: 400, medium: 1700, high: 4000 }, layer = grid(2, 128, tiers);
  const a = buildEaldholtInstanceCellIndex([layer], { profile: 'desktop' }), b = buildEaldholtInstanceCellIndex([layer], { profile: 'desktop' });
  assert.deepEqual(a, b);
  const settings = a.layers[0].settings, sizes = settings.levelSizes;
  assert.deepEqual(sizes, [16, 32, 64]);
  assert.deepEqual(a.layers[0].origin, [.37, .61].map(v => Math.fround(v)));
  // 128 m of instances aligned to their own origin: exactly 2 x 2 roots of 64 m.
  assert.equal(a.layers[0].roots, 4); assert.equal(a.cellCount, 4 + 16 + 64); assert.equal(a.layers[0].levels, 3);
  assert.deepEqual([...a.cellLevel], [...new Array(4).fill(2), ...new Array(16).fill(1), ...new Array(64).fill(0)], 'roots first, breadth first');
  const m = layer.matrices, origin = a.layers[0].origin;
  let stored = 0;
  for (let c = 0; c < a.cellCount; c++) {
    const level = a.cellLevel[c];
    for (let k = 0; k < a.cellChildCount[c]; k++) {
      const child = a.cellChildStart[c] + k;
      assert.equal(a.cellLevel[child], level - 1);
      assert.equal(Math.floor(a.cellX[child] / 2), a.cellX[c]); assert.equal(Math.floor(a.cellZ[child] / 2), a.cellZ[c]);
      for (let r = 0; r < 3; r++) { assert.ok(a.cellBounds[child * 6 + r] >= a.cellBounds[c * 6 + r] - 1e-9); assert.ok(a.cellBounds[child * 6 + 3 + r] <= a.cellBounds[c * 6 + 3 + r] + 1e-9); }
    }
    if (level === 0) assert.equal(a.cellChildCount[c], 0); else assert.ok(a.cellChildCount[c] >= 1);
    // Stored instances: ascending, inside the region, and exactly the prefix the level's cap allows.
    const cap = ealdholtInstanceCellThreshold(tiers.high, settings.levelCaps[level]), fraction = ealdholtInstanceCellLevelFraction(a, 0, level);
    let previous = -1;
    for (let k = 0; k < a.cellInstances[c]; k++) {
      const i = a.order[a.cellStart[c] + k], o = i * 16;
      assert.ok(i > previous && i < cap); previous = i;
      assert.ok((i + .5) / tiers.high < fraction, 'the shader cap keeps every stored instance');
      assert.equal(Math.floor((m[o + 12] - origin[0]) / sizes[level]), a.cellX[c]); assert.equal(Math.floor((m[o + 14] - origin[1]) / sizes[level]), a.cellZ[c]);
      // Bounds include each instance origin (the shader measures distance there).
      for (let r = 0; r < 3; r++) assert.ok(m[o + 12 + r] >= a.cellBounds[c * 6 + r] - 1e-9 && m[o + 12 + r] <= a.cellBounds[c * 6 + 3 + r] + 1e-9);
    }
    stored += a.cellInstances[c];
  }
  assert.equal(stored, a.layers[0].storedInstances);
  // Level-0 cells partition the HIGH tier, and each prototype box (all LODs) fits its cell.
  const seen = new Uint8Array(4096);
  for (let c = 0; c < a.cellCount; c++) if (a.cellLevel[c] === 0) for (let k = 0; k < a.cellInstances[c]; k++) {
    const i = a.order[a.cellStart[c] + k], o = i * 16;
    assert.equal(seen[i], 0); seen[i] = 1;
    for (let corner = 0; corner < 8; corner++) {
      const p = [corner & 1 ? localBounds.max[0] : localBounds.min[0], corner & 2 ? localBounds.max[1] : localBounds.min[1], corner & 4 ? localBounds.max[2] : localBounds.min[2]];
      for (let r = 0; r < 3; r++) {
        const v = m[o + r] * p[0] + m[o + 4 + r] * p[1] + m[o + 8 + r] * p[2] + m[o + 12 + r];
        assert.ok(v >= a.cellBounds[c * 6 + r] - 1e-9 && v <= a.cellBounds[c * 6 + 3 + r] + 1e-9);
      }
    }
  }
  assert.equal(seen.reduce((sum, v) => sum + v, 0), 4000, 'level 0 stores the complete HIGH tier once');
  assert.deepEqual(a.layers[0].tiers, tiers);
  assert.ok(a.bounds && a.bounds.min[0] < .37 && a.bounds.max[0] > 126);
  // The stepwise build yields between chunks and layers and returns the same index.
  const steps = ealdholtInstanceCellIndexSteps([layer, grid(4, 64, undefined, 200, 'flowers', 3)], { profile: 'desktop' }, 1024);
  let yields = 0, result: EaldholtInstanceCellIndex | undefined;
  for (;;) { const next = steps.next(); if (next.done) { result = next.value; break; } yields++; }
  assert.ok(yields >= 6, `${yields} yields`);
  assert.deepEqual(result, buildEaldholtInstanceCellIndex([layer, grid(4, 64, undefined, 200, 'flowers', 3)], { profile: 'desktop' }));
});

test('index validation rejects incomplete or unsafe inputs', () => {
  const layer = grid(8, 64);
  const bad = new Float32Array(layer.matrices); bad[5] = NaN;
  assert.throws(() => buildEaldholtInstanceCellIndex([{ ...layer, matrices: bad }], { profile: 'desktop' }), /non-finite/);
  const skew = new Float32Array(layer.matrices); skew[3] = .1;
  assert.throws(() => buildEaldholtInstanceCellIndex([{ ...layer, matrices: skew }], { profile: 'desktop' }), /affine/);
  assert.throws(() => buildEaldholtInstanceCellIndex([{ ...layer, tiers: { low: 9, medium: 3, high: 4 } }], { profile: 'desktop' }), /tiers/);
  assert.throws(() => buildEaldholtInstanceCellIndex([{ ...layer, tiers: { low: 1, medium: 2, high: 1e6 } }], { profile: 'desktop' }), /tiers/);
  assert.throws(() => buildEaldholtInstanceCellIndex([{ ...layer, lods: [] }], { profile: 'desktop' }), /LODs/);
  assert.throws(() => buildEaldholtInstanceCellIndex([layer, layer], { profile: 'desktop' }), /unique/);
  assert.throws(() => buildEaldholtInstanceCellIndex([{ ...layer, localBounds: { min: [0, 0, 0], max: [-1, 1, 1] } }], { profile: 'desktop' }), /bounds/);
  assert.throws(() => buildEaldholtInstanceCellIndex([{ ...layer, rule: { ...rule, hysteresis: .4 } }], { profile: 'desktop' }), /hysteresis/);
  assert.throws(() => buildEaldholtInstanceCellIndex([{ ...layer, rule: { ...rule, bands: [{ pixels: 40, lod: 0, density: 1 }, { pixels: 10, lod: 1, density: 1.2 }] } }], { profile: 'desktop' }), /density/);
  assert.throws(() => buildEaldholtInstanceCellIndex([layer], { profile: 'desktop', budgets: { ...roomy, low: { draws: -1, triangles: 0 } } }), /budgets/);
  assert.throws(() => buildEaldholtInstanceCellIndex([layer], { profile: 'phone' as 'desktop' }), /profile/);
  assert.throws(() => buildEaldholtInstanceCellIndex([{ ...layer, kind: 'hedge' as 'rock' }], { profile: 'desktop' }), /kind/);
});

test('frustum planes from plain matrices match the clip volume and keep a conservative margin; focal comes from the projection', () => {
  const planes = new Float64Array(24), identity = new Float64Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  extractEaldholtFrustumPlanes(identity, planes);
  assert.deepEqual([...planes], [-1, 0, 0, 1, 1, 0, 0, 1, 0, 1, 0, 1, 0, -1, 0, 1, 0, 0, -1, 1, 0, 0, 1, 1]);
  const box = (x: number, y: number, z: number, h = .5) => [x - h, y - h, z - h, x + h, y + h, z + h];
  extractEaldholtFrustumPlanes(clip([0, 2, 0], [0, 2, -10]), planes);
  assert.equal(ealdholtAabbInFrustum(planes, box(0, 2, -10), 0, 0), true);
  assert.equal(ealdholtAabbInFrustum(planes, box(0, 2, 10), 0, 0), false, 'behind the camera');
  assert.equal(ealdholtAabbInFrustum(planes, box(40, 2, -10), 0, 0), false, 'outside the right plane');
  assert.equal(ealdholtAabbInFrustum(planes, box(0, 2, -1200), 0, 0), false, 'beyond the far plane');
  const edge = 10 * Math.tan(Math.PI / 6) * 16 / 9 + .9;
  assert.equal(ealdholtAabbInFrustum(planes, box(edge, 2, -10, .3), 0, 0), false);
  assert.equal(ealdholtAabbInFrustum(planes, box(edge, 2, -10, .3), 0, 1), true);
  const zeroToOne = new Float64Array(24); extractEaldholtFrustumPlanes(identity, zeroToOne, true);
  assert.deepEqual([...zeroToOne.subarray(20, 24)], [0, 0, 1, 0]);
  assert.throws(() => extractEaldholtFrustumPlanes(new Float64Array(16), planes), /Degenerate/);
  assert.equal(ealdholtAabbDistance([0, 0, 0, 1, 1, 1], 0, .5, .5, .5), 0);
  assert.equal(ealdholtAabbDistance([0, 0, 0, 1, 1, 1], 0, 4, 1, 5), 5);
  // 1080 px tall at a 50 degree vertical field of view is the nominal ~1158 px/rad.
  assert.ok(Math.abs(ealdholtProjectionFocalPixels(perspective(50, 16 / 9, .1, 100), 1080) - 540 / Math.tan(25 * Math.PI / 180)) < 1e-6);
  assert.equal(ealdholtProjectionFocalPixels(identity, 1080), 0, 'orthographic projections are not rescaled');
});

/** Visible ranks for the selection at an eye, using the CPU reference of the vertex shader. */
function visibleSet(index: EaldholtInstanceCellIndex, selector: EaldholtInstanceCellSelector, layer: EaldholtInstanceCellLayerInput, inside: (i: number) => boolean) {
  const out = new Map<number, number>(), scale = [0, 0, 0], owner = submitted(index, selector);
  for (const [rank, cell] of owner) {
    if (!inside(rank)) continue;
    const o = rank * 16;
    ealdholtInstanceCellScaleAt(selector.layerState, 0, rank, ealdholtInstanceCellLevelFraction(index, 0, index.cellLevel[cell]), layer.matrices[o + 12], layer.matrices[o + 13], layer.matrices[o + 14], scale);
    if (scale[0] > 0) out.set(rank, scale[0]);
  }
  return out;
}

test('selection never changes which instances are visible: density is per instance, cells only bound the work', () => {
  const layer = grid(1.5, 255, undefined, -128), index = buildEaldholtInstanceCellIndex([layer], { profile: 'desktop', budgets: roomy });
  const selector = createEaldholtInstanceCellSelector(index, { quality: 'high' });
  const planes = new Float64Array(24), scale = [0, 0, 0], high = index.layers[0].tiers.high;
  let checked = 0, bandChanges = 0, previousBands = new Int16Array(index.cellCount);
  for (let step = 0; step <= 40; step++) {
    // A 60 m walk with a slow turn: cells change band, split and merge along the way.
    const eye = [-30 + step * 1.5, 1.7, -40 + step * .75], target = [eye[0] + 40 * Math.cos(step * .015), 1, eye[2] + 40 * Math.sin(.6 + step * .015)];
    const view = clip(eye, target, 60, 1000);
    selector.update(eye[0], eye[1], eye[2], view);
    extractEaldholtFrustumPlanes(view, planes);
    const inside = (i: number) => {
      const o = i * 16, p = [layer.matrices[o + 12], layer.matrices[o + 13], layer.matrices[o + 14]];
      for (let k = 0; k < 24; k += 4) if (planes[k] * p[0] + planes[k + 1] * p[1] + planes[k + 2] * p[2] + planes[k + 3] < 1) return false;
      return true;
    };
    const visible = visibleSet(index, selector, layer, inside);
    // Ideal: every instance inside the view whose own (rank, distance) passes the curve, at full precision.
    let ideal = 0;
    for (let i = 0; i < high; i++) {
      if (!inside(i)) continue;
      const o = i * 16;
      ealdholtInstanceCellScaleAt(selector.layerState, 0, i, 1, layer.matrices[o + 12], layer.matrices[o + 13], layer.matrices[o + 14], scale);
      if (scale[0] <= 0) continue;
      ideal++;
      assert.ok(visible.has(i), `step ${step}: instance ${i} must be submitted by some drawn cell`);
      assert.ok(Math.abs(visible.get(i)! - scale[0]) < 1e-12, 'the drawn level never changes its scale');
    }
    assert.equal(visible.size, ideal, 'no extra instance becomes visible');
    checked += ideal;
    for (let c = 0; c < index.cellCount; c++) if (selector.band[c] !== previousBands[c]) bandChanges++;
    previousBands = new Int16Array(selector.band);
  }
  assert.ok(checked > 20_000 && bandChanges > 40, `${checked} visible instance checks across ${bandChanges} band changes`);
});

test('scale is continuous in distance: survivors widen as density falls and shrink to zero over the fade window', () => {
  const index = buildEaldholtInstanceCellIndex([grid(2, 64)], { profile: 'desktop', budgets: roomy });
  const selector = createEaldholtInstanceCellSelector(index, { quality: 'high' });
  selector.update(0, 1.7, 0, clip([0, 1.7, 0], [10, 0, 10]));
  const s = index.layers[0].settings, out = [0, 0, 0], high = index.layers[0].tiers.high;
  for (const rank of [0, Math.floor(high * .2), Math.floor(high * .5), high - 1]) {
    let previous = -1;
    for (let d = 0; d < s.reach * 1.1; d += .02) {
      ealdholtInstanceCellScaleAt(selector.layerState, 0, rank, 1, d, 1.7, 0, out);
      if (previous >= 0) assert.ok(Math.abs(out[0] - previous) < .2, `rank ${rank}: no pop at ${d.toFixed(2)} m`);
      previous = out[0];
      const rho = ealdholtInstanceCellDensityAt(s, 1, d * selector.diagnostics.distanceScale);
      if ((rank + .5) / high >= rho && rho <= 1 - s.fade) assert.equal(out[0], 0, 'beyond its threshold, outside the full-density lift, an instance is fully hidden');
    }
    ealdholtInstanceCellScaleAt(selector.layerState, 0, rank, 1, s.reach * 2, 1.7, 0, out); assert.equal(out[0], 0);
    // A full-density band draws every instance, the last-ranked included, at its own size.
    ealdholtInstanceCellScaleAt(selector.layerState, 0, rank, 1, s.bandDistances[0] * .5 / selector.diagnostics.distanceScale, 1.7, 0, out);
    assert.deepEqual(out.map(v => Number(v.toFixed(9))), [1, 1, 1], `rank ${rank} at full density`);
  }
  // The first-ranked survivor widens toward the clamp as density falls; height grows by the gain.
  ealdholtInstanceCellScaleAt(selector.layerState, 0, 0, 1, s.reachStart * .9 / selector.diagnostics.distanceScale, 1.7, 0, out);
  assert.ok(out[0] > 1.2 && out[0] <= s.widenMax && Math.abs(out[1] - (1 + (out[0] - 1) * s.heightGain)) < 1e-6, JSON.stringify(out));
});

test('a tight share coarsens instead of dropping: every region stays covered and the nearest cells refine first', () => {
  const layer = grid(1, 256, undefined, -128), index = buildEaldholtInstanceCellIndex([layer], { profile: 'desktop', budgets: roomy });
  const free = createEaldholtInstanceCellSelector(index, { quality: 'high' }), eye = [0, 6, -100], view = clip(eye, [0, 0, 40], 60);
  free.update(eye[0], eye[1], eye[2], view);
  // A share between the base coverage (near field plus every root) and full refinement.
  const base = free.diagnostics.baseDraws, share = Math.ceil(base / .88);
  const tight = createEaldholtInstanceCellSelector(index, { quality: 'high', share: { draws: share, triangles: 1e12 } });
  tight.update(eye[0], eye[1], eye[2], view);
  assert.ok(free.diagnostics.drawCalls > share, `${free.diagnostics.drawCalls} draws unconstrained, base ${base}, share ${share}`);
  assert.ok(tight.diagnostics.drawCalls <= share && tight.diagnostics.coarsenedCells > 0 && tight.diagnostics.refusedSplits > 0 && tight.diagnostics.budgetCulled === 0,
    JSON.stringify(tight.diagnostics));
  // Coverage continuity: every level-0 cell drawn by the free selection has a drawn ancestor-or-self in the tight one.
  const parent = parentsOf(index);
  const covered = (selector: EaldholtInstanceCellSelector, c: number) => { for (let p = c; p >= 0; p = parent[p]) if (selector.lod[p] >= 0) return true; return false; };
  for (let c = 0; c < index.cellCount; c++) if (free.lod[c] >= 0) assert.ok(covered(tight, c), `region of cell ${c} keeps coverage`);
  // The nearest drawn tight cell is the most refined one: near ground refines first.
  const drawnTight = [...Array(index.cellCount).keys()].filter(c => tight.lod[c] >= 0).sort((a, b) =>
    ealdholtAabbDistance(index.cellBounds, a * 6, eye[0], eye[1], eye[2]) - ealdholtAabbDistance(index.cellBounds, b * 6, eye[0], eye[1], eye[2]));
  assert.equal(index.cellLevel[drawnTight[0]], Math.min(...drawnTight.map(c => index.cellLevel[c])), 'the cell at the camera is refined first');
});

test('admission hysteresis: smooth pans and dollies under a binding share never toggle coverage back and forth', t => {
  // A dense five-layer set modelled on the critic's flicker probe.
  const hash = new Float64Array(2);
  const scatter = (spacing: number, salt: number, keep: (x: number, z: number) => boolean) => {
    const out: number[] = [];
    for (let gx = Math.ceil(-120 / spacing); gx < 120 / spacing; gx++) for (let gz = Math.ceil(-120 / spacing); gz < 120 / spacing; gz++) {
      ealdholtPcg2d(gx + 1000, gz + 1000, salt, hash);
      const x = (gx + hash[0]) * spacing, z = (gz + hash[1]) * spacing;
      if (!keep(x, z)) continue;
      ealdholtPcg2d(gx + 2000, gz + 2000, salt, hash);
      const k = .7 + .6 * hash[0], yaw = hash[1] * Math.PI * 2, c = Math.cos(yaw) * k, s = Math.sin(yaw) * k;
      out.push(c, 0, -s, 0, 0, k, 0, 0, s, 0, c, 0, x, 0, z, 1);
    }
    const m = Float32Array.from(out);
    return applyEaldholtDensityOrder(m, createEaldholtDensityOrder(m, salt));
  };
  const river = (x: number, z: number) => Math.abs(z - 20 - 12 * Math.sin(x / 30)) < 6;
  const box = (x: number, y: number, z: number) => ({ min: [-x, 0, -z] as [number, number, number], max: [x, y, z] as [number, number, number] });
  const layers: EaldholtInstanceCellLayerInput[] = [
    { id: 'grass', kind: 'groundcover', matrices: scatter(1.3, 11, (x, z) => !river(x, z)), localBounds: box(.3, .55, .3), lods: [{ triangles: 42, draws: 1 }, { triangles: 8, draws: 1 }, { triangles: 4, draws: 1 }] },
    { id: 'wildflowers', kind: 'groundcover', matrices: scatter(3.4, 22, (x, z) => !river(x, z) && Math.sin(x / 9) * Math.cos(z / 11) > -.2), localBounds: box(.1, .4, .1), lods: [{ triangles: 14, draws: 2 }, { triangles: 2, draws: 1 }] },
    { id: 'shrubs', kind: 'understory', matrices: scatter(5.5, 33, (x, z) => !river(x, z) && (z < -40 || x > 50)), localBounds: box(.75, 1.1, .75), lods: [{ triangles: 320, draws: 1 }, { triangles: 80, draws: 1 }] },
    { id: 'ferns', kind: 'understory', matrices: scatter(3.6, 44, (x, z) => !river(x, z) && (z < -30 || x > 45)), localBounds: box(.7, .7, .7), lods: [{ triangles: 56, draws: 1 }, { triangles: 16, draws: 1 }] },
    { id: 'rock-groups', kind: 'rock', matrices: scatter(14, 55, () => true), localBounds: box(1, .55, .8), lods: [{ triangles: 320, draws: 1 }, { triangles: 20, draws: 1 }] },
  ];
  const projection = perspective(58, 16 / 9, .15, 650), withHysteresis = buildEaldholtInstanceCellIndex(layers, { profile: 'desktop' });
  const stateless = buildEaldholtInstanceCellIndex(layers, { profile: 'desktop', admissionHysteresis: 0 }), parent = parentsOf(withHysteresis);
  const level0: number[] = [];
  for (let c = 0; c < withHysteresis.cellCount; c++) if (withHysteresis.cellLevel[c] === 0) level0.push(c);
  const pathView = (path: 'pan' | 'dolly', f: number) => {
    let eye: number[], target: number[];
    if (path === 'pan') { const a = f / 900 * Math.PI * 2; eye = [24, 2, 39]; target = [24 + Math.cos(a) * 50, 1, 39 + Math.sin(a) * 50]; }
    else { const t = f / 900; eye = [-90 + 180 * t, 2, -60 + 40 * t]; target = [eye[0] + 50, 1, eye[2] + 15]; }
    return { eye, view: multiply(projection, lookAt(eye, target)) };
  };
  /** Per content-bearing level-0 region (in range, in view, with stored instances): which level
   * draws it (-1 none). A reversal returns to a state left within 8 frames. Regions out of view or
   * range are skipped: a refined parent's empty or off-screen child changes nothing on screen. */
  const planes = new Float64Array(24);
  const run = (index: EaldholtInstanceCellIndex, tier: 'medium' | 'low', path: 'pan' | 'dolly', share: { draws: number; triangles: number }) => {
    const selector = createEaldholtInstanceCellSelector(index, { quality: tier, share });
    const drawnLevel = new Int8Array(level0.length).fill(-2), previousLevel = new Int8Array(level0.length), lastChange = new Int32Array(level0.length).fill(-1000);
    let reversals = 0, levelReversals = 0, bound = 0, dropped = 0, gainChanges = 0, maxGainStep = 0, lastGain = 1;
    for (let f = 0; f < 900; f++) {
      const { eye, view } = pathView(path, f);
      selector.update(eye[0], eye[1], eye[2], view);
      // Every gain change moves the far threshold of every far instance: count them and their size.
      const gain = selector.diagnostics.densityGain;
      if (gain !== lastGain) { gainChanges++; maxGainStep = Math.max(maxGainStep, Math.abs(gain / lastGain - 1)); lastGain = gain; }
      extractEaldholtFrustumPlanes(view, planes);
      if (selector.diagnostics.refusedSplits > 0) bound++;
      if (selector.diagnostics.budgetCulled > 0) dropped++;
      for (let r = 0; r < level0.length; r++) {
        const c0 = level0[r];
        if (index.cellInstances[c0] === 0 || selector.band[c0] >= index.layers[index.cellLayer[c0]].settings.bandDistances.length
          || !ealdholtAabbInFrustum(planes, index.cellBounds, c0 * 6, 0)) continue;
        let level = -1;
        for (let p = c0; p >= 0; p = parent[p]) if (selector.lod[p] >= 0) { level = index.cellLevel[p]; break; }
        if (drawnLevel[r] !== -2 && level !== drawnLevel[r]) {
          // Coverage reversal: covered -> bare -> covered (or the reverse) within 8 frames, the
          // critic's visibility flicker. Level reversal: a covered region's drawn level toggles back.
          if (f - lastChange[r] <= 8 && level === previousLevel[r]) { if (level < 0 || drawnLevel[r] < 0) reversals++; else levelReversals++; }
          previousLevel[r] = drawnLevel[r]; lastChange[r] = f;
        }
        drawnLevel[r] = level;
      }
    }
    return { reversals, levelReversals, bound, dropped, gainChanges, maxGainStep: Number(maxGainStep.toFixed(4)) };
  };
  const report: Record<string, unknown> = {};
  for (const tier of ['medium', 'low'] as const) for (const path of ['pan', 'dolly'] as const) {
    const probe = createEaldholtInstanceCellSelector(withHysteresis, { quality: tier, share: { draws: 1e6, triangles: 1e12 } }), full: number[] = [], fullTris: number[] = [];
    let baseDraws = 0, baseTriangles = 0;
    for (let f = 0; f < 900; f += 3) {
      const { eye, view } = pathView(path, f);
      probe.update(eye[0], eye[1], eye[2], view);
      baseDraws = Math.max(baseDraws, probe.diagnostics.baseDraws); baseTriangles = Math.max(baseTriangles, probe.diagnostics.baseTriangles);
      full.push(probe.diagnostics.drawCalls); fullTris.push(probe.diagnostics.triangles);
    }
    // Regime A: a share that covers the base everywhere with a margin for refinement. Splits are refused, nothing drops, nothing toggles.
    const coveredShare = { draws: Math.ceil(baseDraws / .88) + 8, triangles: Math.ceil(baseTriangles / .88) + 20_000 };
    const covered = run(withHysteresis, tier, path, coveredShare);
    assert.equal(covered.dropped, 0, `${tier} ${path}: nothing drops above the base coverage`);
    assert.equal(covered.reversals, 0, `${tier} ${path}: ${covered.reversals} coverage reversals above the base coverage`);
    assert.ok(covered.levelReversals <= 2, `${tier} ${path}: ${covered.levelReversals} level reversals above the base coverage`);
    // Regime B: three quarters of the median full cost, below the base in places, so roots may drop.
    const median = (values: number[]) => [...values].sort((a, b) => a - b)[values.length >> 1];
    const tight = { draws: Math.round(median(full) * .75), triangles: Math.round(median(fullTris) * .75) };
    const kept = run(withHysteresis, tier, path, tight), baseline = run(stateless, tier, path, tight);
    assert.ok(kept.bound > 100, `${tier} ${path}: the tight share binds (${kept.bound} frames)`);
    // While triangles bind, the far gain tracks the share in small relative steps only.
    assert.ok(kept.maxGainStep <= .01 + 1e-6 && covered.maxGainStep <= .01 + 1e-6, `${tier} ${path}: gain steps ${kept.maxGainStep} / ${covered.maxGainStep}`);
    // Below the base coverage, roots must drop; hysteresis removes most of the resulting back-and-forth.
    assert.ok(kept.reversals <= Math.max(2, baseline.reversals * .35), `${tier} ${path}: ${kept.reversals} reversals with hysteresis vs ${baseline.reversals} without`);
    report[`${tier}:${path}`] = { coveredShare: coveredShare.draws, coveredBound: covered.bound, coveredReversals: covered.reversals, coveredLevelReversals: covered.levelReversals,
      tightShare: tight.draws, ...kept, statelessReversals: baseline.reversals, statelessLevelReversals: baseline.levelReversals };
  }
  assert.equal(Object.keys(report).length, 4);
  t.diagnostic(`admission ${JSON.stringify(report)}`);
});

test('adaptive density lowers far density smoothly to meet a triangle share and never exceeds the authored curve', () => {
  const layer = grid(1, 256, undefined, -128), eye = [0, 8, -110], view = clip(eye, [0, 0, 60], 60);
  const free = createEaldholtInstanceCellSelector(buildEaldholtInstanceCellIndex([layer], { profile: 'desktop', budgets: roomy }), { quality: 'high' });
  free.update(eye[0], eye[1], eye[2], view);
  const full = free.diagnostics.triangles;
  for (let i = 0; i < 5; i++) free.update(eye[0], eye[1], eye[2], view);
  assert.equal(free.diagnostics.densityGain, 1, 'with room, the authored curve is kept (the gain never rises above it)');
  const index = buildEaldholtInstanceCellIndex([layer], { profile: 'desktop', budgets: roomy });
  const share = Math.round(full * .85), tight = createEaldholtInstanceCellSelector(index, { quality: 'high', share: { draws: 1e6, triangles: share } });
  let previous = 1, settledAt = -1;
  for (let i = 0; i < 80; i++) {
    tight.update(eye[0], eye[1], eye[2], view);
    const gain = tight.diagnostics.densityGain;
    assert.ok(gain >= previous * (1 - .01) - 1e-9 && gain <= previous * (1 + .005) + 1e-9, `update ${i}: gain moves at most 1% down / 0.5% up (relative) per update`);
    previous = gain;
    // Uniforms carry exactly the gained knots the CPU counted with: nearest band untouched.
    const o = EALDHOLT_INSTANCE_CELL_STATE.knotDensities, s = index.layers[0].settings;
    assert.equal(tight.layerState[o], 1);
    assert.ok(Math.abs(tight.layerState[o + 1] - Math.fround(s.bandDensities[1] * gain)) < 1e-6);
    if (!tight.diagnostics.settling && settledAt < 0) settledAt = i;
  }
  assert.ok(previous < .95 && previous > .35, `gain settles below the authored curve (${previous.toFixed(3)})`);
  assert.ok(tight.diagnostics.triangles <= share * 1.05, `triangles ${tight.diagnostics.triangles} meet the share ${share}`);
  assert.ok(settledAt > 0, 'the gain stops moving once the share is met');
  assert.equal(tight.diagnostics.budgetCulled, 0, 'nothing drops: far density thins instead');
  // Below the base coverage (near field plus coarse roots), the gain bottoms out: the share is reported, never a hole.
  const floor = createEaldholtInstanceCellSelector(index, { quality: 'high', share: { draws: 1e6, triangles: Math.round(full * .4) } });
  for (let i = 0; i < 160; i++) floor.update(eye[0], eye[1], eye[2], view);
  assert.ok(floor.diagnostics.densityGain === index.adaptiveDensity!.min && floor.diagnostics.overShareTriangles > 0 && floor.diagnostics.budgetCulled === 0);
  assert.throws(() => buildEaldholtInstanceCellIndex([layer], { profile: 'desktop', adaptiveDensity: { min: .5, max: 1.5 } }), /ceiling/);
});

test('profiles: caps within the performance budgets, no bald ground near the camera, and far bands that reach the village poses', () => {
  for (const profile of ['desktop', 'quest'] as const) {
    const rules = EALDHOLT_INSTANCE_CELL_PROFILES[profile], totals = EALDHOLT_PERFORMANCE_BUDGETS[profile];
    for (const tier of ['low', 'medium', 'high'] as const) {
      assert.ok(rules.budgets[tier].draws <= totals[tier].draws * .4 && rules.budgets[tier].triangles <= totals[tier].triangles * .4, `${profile} ${tier} cap`);
      assert.ok(rules.headroom.floor[tier].draws <= rules.budgets[tier].draws && rules.headroom.floor[tier].triangles <= rules.budgets[tier].triangles);
    }
    for (const kindName of EALDHOLT_INSTANCE_CELL_KINDS) {
      const settings = resolveEaldholtInstanceCellLayerSettings(rules.kinds[kindName], rules.focalPixels, kindName);
      for (let i = 1; i < settings.bandDistances.length; i++) {
        assert.ok(settings.bandDistances[i] > settings.bandDistances[i - 1]);
        assert.equal(settings.levelSizes[i], settings.levelSizes[i - 1] * 2);
      }
    }
    // LAAS: nothing within ~12 m is bald. Full density holds there on every tier.
    const ground = resolveEaldholtInstanceCellLayerSettings(rules.kinds.groundcover, rules.focalPixels, 'groundcover');
    for (const tier of ['low', 'medium', 'high'] as const) assert.ok(ground.bandDistances[0] * rules.tierScale[tier] >= 12, `${profile} ${tier} near field`);
  }
  // Quest shares follow headroom with no floor: zero while the scene exceeds its budget.
  for (const tier of ['low', 'medium', 'high'] as const) assert.deepEqual(EALDHOLT_INSTANCE_CELL_PROFILES.quest.headroom.floor[tier], { draws: 0, triangles: 0 });
  assert.ok(Math.abs(ealdholtCoverageDistance(.5, 1150, 3) - 191.666667) < 1e-5, 'the far groundcover band reaches ~190 m');
  assert.throws(() => ealdholtCoverageDistance(0, 1150, 7), RangeError);
});

/** Band, LOD and density for each kind at a pose's subject distance (1080 px tall view). */
export function villagePoseTable() {
  const rows: { pose: string; profile: string; tier: string; kind: string; distance: number; pixels: number; band: number; lod: number | null; density: number }[] = [];
  const span = 300, inspection = { position: [span / 2 - span * .08, 36, span * .6], target: [-span / 2 + span * .14, 2.5, span * .55], fov: 64 };
  const poses: { id: string; position: readonly number[]; target: readonly number[]; fov: number }[] = [...EALDHOLT_VILLAGE_VIEWS, { id: 'riverside-computed-300m', ...inspection }];
  for (const pose of poses) {
    const distance = Math.hypot(pose.position[0] - pose.target[0], pose.position[1] - pose.target[1], pose.position[2] - pose.target[2]);
    const focal = 540 / Math.tan(pose.fov * Math.PI / 360);
    for (const profile of ['desktop'] as const) {
      const rules = EALDHOLT_INSTANCE_CELL_PROFILES[profile];
      for (const tier of ['low', 'medium', 'high'] as const) {
        const effective = distance * rules.focalPixels / focal / rules.tierScale[tier];
        for (const kindName of ['groundcover', 'understory', 'rock'] as const) {
          const s = resolveEaldholtInstanceCellLayerSettings(rules.kinds[kindName], rules.focalPixels, kindName), band = ealdholtInstanceCellBandAt(s, effective);
          rows.push({ pose: pose.id, profile, tier, kind: kindName, distance: Math.round(distance * 10) / 10, pixels: Math.round(s.nominalSize * focal / distance * 10) / 10,
            band, lod: band < s.bandLods.length ? s.bandLods[band] : null, density: Math.round(ealdholtInstanceCellDensityAt(s, tier === 'low' ? .5 : tier === 'medium' ? .75 : 1, effective) * 1000) / 1000 });
        }
      }
    }
  }
  return rows;
}

test('village poses: groundcover, understory and rock groups reach the reviewed subject distances on Desktop', () => {
  const rows = villagePoseTable(), at = (pose: string, tier: string, kindName: string) => rows.find(row => row.pose === pose && row.tier === tier && row.kind === kindName)!;
  for (const tier of ['medium', 'high']) {
    assert.ok(at('overview', tier, 'groundcover').density >= .08, `overview ${tier}: groundcover drawn (${JSON.stringify(at('overview', tier, 'groundcover'))})`);
    assert.ok(at('overview', tier, 'understory').density >= .25 && at('overview', tier, 'rock').lod !== null);
    assert.ok(at('riverside', tier, 'groundcover').density >= .12 && at('riverside', tier, 'understory').density >= .4, `fixed riverside ${tier}`);
    assert.ok(at('riverside-computed-300m', tier, 'understory').density > 0 && at('riverside-computed-300m', tier, 'rock').lod !== null, `computed riverside ${tier}`);
  }
  assert.ok(at('overview', 'low', 'groundcover').density > 0, 'overview low still draws a sparse groundcover band');
  for (const pose of ['well', 'churchyard', 'lakeside']) for (const tier of ['low', 'medium', 'high']) {
    const row = at(pose, tier, 'groundcover');
    assert.ok(row.band <= 1 && row.density >= .7, `${pose} ${tier}: near field stays dense`);
  }
});

test('headroom shares follow the worst recent base, shrink at once, grow past hysteresis and stay zero on an over-budget Quest', () => {
  const desktop = EALDHOLT_INSTANCE_CELL_PROFILES.desktop;
  const room = createEaldholtInstanceCellHeadroom(desktop.headroom, desktop.budgets, 'high');
  assert.deepEqual({ ...room.share }, { ...desktop.headroom.floor.high });
  assert.equal(room.observe(250, 900_000, 20, 50_000), true);
  assert.deepEqual({ ...room.share }, { draws: Math.min(128, Math.floor(400 * .9 - 230)), triangles: Math.min(560_000, Math.floor(1_500_000 * .9 - 850_000)) });
  const before = { ...room.share };
  assert.equal(room.observe(240, 880_000, 20, 50_000), false, 'a smaller base within the window changes nothing');
  assert.equal(room.observe(330, 900_000, 20, 50_000), true, 'a heavier scene shrinks the share at once');
  assert.ok(room.share.draws < before.draws && room.share.draws >= desktop.headroom.floor.high.draws);
  for (let i = 0; i < desktop.headroom.window; i++) room.observe(150, 400_000, 10, 20_000);
  assert.deepEqual({ ...room.share }, { ...desktop.budgets.high }, 'after the window, light frames restore the cap');
  const over = createEaldholtInstanceCellHeadroom(desktop.headroom, desktop.budgets, 'medium');
  over.observe(260, 1_900_000, 0, 0);
  assert.deepEqual({ ...over.share }, { ...desktop.headroom.floor.medium }); assert.equal(over.overBudget, true);
  const quest = EALDHOLT_INSTANCE_CELL_PROFILES.quest, native = createEaldholtInstanceCellHeadroom(quest.headroom, quest.budgets, 'medium');
  native.observe(70, 368_836, 0, 0);
  assert.deepEqual({ ...native.share }, { draws: 0, triangles: 0 }, 'the 369k-triangle Native candidate leaves no share');
  const light = createEaldholtInstanceCellHeadroom(quest.headroom, quest.budgets, 'medium');
  light.observe(60, 200_000, 0, 0);
  assert.deepEqual({ ...light.share }, { draws: 10, triangles: Math.min(18_000, Math.floor(250_000 * .95 - 200_000)) });
  assert.equal(light.setTier('high'), true);
  assert.throws(() => createEaldholtInstanceCellHeadroom({ ...quest.headroom, window: 0 }, quest.budgets, 'high'), /window/);
});

test('the shader patch injects per-instance thinning into standard chunks and reads live selector state', () => {
  const index = buildEaldholtInstanceCellIndex([grid(2, 64)], { profile: 'desktop', budgets: roomy });
  const selector = createEaldholtInstanceCellSelector(index, { quality: 'medium' }), uniforms = createEaldholtInstanceCellUniforms(selector, 0);
  const source = '#include <common>\nvoid main() {\n#include <beginnormal_vertex>\n#include <begin_vertex>\n#include <project_vertex>\n}';
  const shader = { vertexShader: source, uniforms: {} as Record<string, { value: unknown }> };
  patchEaldholtInstanceCellShader(shader, uniforms);
  assert.match(shader.vertexShader, /attribute vec2 ealdholtCell;/);
  assert.match(shader.vertexShader, /transformed \*= ealdholtCellScale\(\);/);
  assert.match(shader.vertexShader, /objectNormal \*= vec3\( cellScale\.y, cellScale\.x, cellScale\.y \);/);
  assert.doesNotMatch(shader.vertexShader, /discard/, 'no alpha discard: early depth survives');
  const patched = shader.vertexShader; patchEaldholtInstanceCellShader(shader, uniforms); assert.equal(shader.vertexShader, patched, 'idempotent');
  assert.equal(shader.uniforms.uEaldholtCellEye, uniforms.uEaldholtCellEye);
  assert.throws(() => patchEaldholtInstanceCellShader({ vertexShader: 'void main() {}', uniforms: {} }, uniforms), /standard/);
  // Uniform values are live views: update() writes the eye and scale without new objects.
  const eyeArray = uniforms.uEaldholtCellEye.value;
  selector.update(3, 4, 5, clip([3, 4, 5], [20, 0, 20]), 2);
  assert.deepEqual([...eyeArray], [3, 4, 5, Math.fround(2 / EALDHOLT_INSTANCE_CELL_PROFILES.desktop.tierScale.medium)]);
  assert.equal(uniforms.uEaldholtCellEye.value, eyeArray);
  // Tier changes rewrite the density knots: the nearest stays 1, farther ones scale.
  const knots = uniforms.uEaldholtCellKnotR.value, medium = [...knots];
  selector.setTier('low');
  assert.equal(knots[0], 1); assert.ok(knots[1] < medium[1] && Math.abs(knots[1] / medium[1] - .5 / .75) < 1e-6);
  assert.equal(EALDHOLT_INSTANCE_CELL_STATE_STRIDE, EALDHOLT_INSTANCE_CELL_STATE.knotDensities + 8);
});

test('coverage raster: footprint density per kind on a metre grid, in the canopy field frame convention', () => {
  const grass = grid(2, 64), rocks: EaldholtInstanceCellLayerInput = { ...grid(8, 64, undefined, 0, 'rocks', 9), kind: 'rock', rule: undefined };
  const coverage = createEaldholtInstanceCellCoverage([grass, rocks], { profile: 'desktop', tier: 'high', cellMetres: 4 });
  assert.equal(coverage.cellMetres, 4);
  assert.ok(coverage.kinds.groundcover && coverage.kinds.rock && !coverage.kinds.understory);
  assert.equal(coverage.kinds.groundcover!.length, coverage.width * coverage.height);
  // Expected mean groundcover fraction from footprints: 0.6 x 0.45 box x pi/4 x scale^2 per 2 x 2 m.
  const m = grass.matrices; let footprint = 0;
  for (let i = 0; i < m.length / 16; i++) footprint += .6 * .45 * Math.PI / 4 * Math.hypot(m[i * 16], m[i * 16 + 1], m[i * 16 + 2]) * Math.hypot(m[i * 16 + 8], m[i * 16 + 9], m[i * 16 + 10]);
  const interior = coverage.kinds.groundcover![Math.floor(coverage.height / 2) * coverage.width + Math.floor(coverage.width / 2)] / 255;
  assert.ok(Math.abs(interior - footprint / (64 * 64)) < .06, `interior coverage ${interior.toFixed(3)} vs ${(footprint / 4096).toFixed(3)}`);
  const [x0, z0, sx, sz] = coverage.frame;
  assert.ok(x0 < .37 && z0 < .61 && Math.abs(sx * coverage.width * 4 - 1) < 1e-12 && Math.abs(sz * coverage.height * 4 - 1) < 1e-12);
  assert.ok(coverage.reach.groundcover! > 70 && coverage.reach.rock! > coverage.reach.groundcover!);
  const low = createEaldholtInstanceCellCoverage([grass], { profile: 'desktop', tier: 'low', cellMetres: 4 });
  assert.ok(low.meanCoverage.groundcover! < coverage.meanCoverage.groundcover! * .6, 'tiers thin the raster too');
  assert.throws(() => createEaldholtInstanceCellCoverage([grass], { profile: 'desktop', tier: 'high', cellMetres: 1 }), /2-8/);
});

test('authored density metadata maps to tiers; untagged layers use the woodland split', () => {
  const metadata = { schema: 1, family: 'groundcover-cells-v1', components: 2, counts: { low: 10, medium: 20, high: 30 } };
  assert.deepEqual(readEaldholtInstanceCellTiers(metadata, 40, 2), { family: 'groundcover-cells-v1', tiers: { low: 10, medium: 20, high: 30 } });
  assert.throws(() => readEaldholtInstanceCellTiers(metadata, 40, 1), /components/);
  assert.throws(() => readEaldholtInstanceCellTiers(metadata, 20, 2), /exceeds/);
  assert.throws(() => readEaldholtInstanceCellTiers({ ...metadata, counts: { low: 5, medium: 4, high: 6 } }, 40, 2), /increase/);
  assert.deepEqual(defaultEaldholtInstanceCellTiers(7), { low: 4, medium: 6, high: 7 });
  assert.equal(ealdholtInstanceCellThreshold(10, .3), 3, 'floating error never adds an instance');
});
