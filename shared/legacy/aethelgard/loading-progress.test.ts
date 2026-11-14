import assert from 'node:assert/strict';
import test from 'node:test';
import { EALDHOLT_LOADING_COPY, EALDHOLT_PREVIEW_COPY } from './copy';
import { EALDHOLT_HOUSE } from './house';
import {
  EALDHOLT_LOADING_SPANS, EALDHOLT_LOADING_STAGES, EALDHOLT_LOADING_START, advanceEaldholtLoading, ealdholtLoadingPercent,
  type EaldholtLoadingProgress, type EaldholtLoadingReport,
} from './loading-progress';

const run = (reports: EaldholtLoadingReport[], from: EaldholtLoadingProgress = EALDHOLT_LOADING_START) => reports.reduce(advanceEaldholtLoading, from);
const near = (actual: number, expected: number, message?: string) => assert.ok(Math.abs(actual - expected) < 1e-9, message ?? `${actual} is not ${expected}`);

test('the stages share one bar, in order, without gaps or overlap, and stop short of complete', () => {
  let cursor = 0;
  for (const stage of EALDHOLT_LOADING_STAGES) {
    const [start, end] = EALDHOLT_LOADING_SPANS[stage];
    assert.equal(start, cursor, stage);
    assert.ok(end > start, stage);
    cursor = end;
  }
  assert.ok(cursor < 1, 'only the loader reporting ready completes the bar');
  assert.deepEqual(Object.keys(EALDHOLT_LOADING_SPANS), [...EALDHOLT_LOADING_STAGES]);
});

test('every stage has its own status line, and the screen keeps the existing failure copy', () => {
  const lines = EALDHOLT_LOADING_STAGES.map(stage => EALDHOLT_LOADING_COPY.stages[stage]);
  for (const line of lines) assert.ok(line.trim().length > 0);
  assert.equal(new Set(lines).size, lines.length);
  assert.deepEqual(Object.keys(EALDHOLT_LOADING_COPY.stages), [...EALDHOLT_LOADING_STAGES]);
  assert.equal(EALDHOLT_LOADING_COPY.stages.download, 'Fetching the village');
  assert.equal(EALDHOLT_LOADING_COPY.stages.warmup, 'Lighting the hearths');
  assert.equal(EALDHOLT_LOADING_COPY.eyebrow, 'MY LEGACY');
  assert.equal(EALDHOLT_LOADING_COPY.title, EALDHOLT_HOUSE.name.toUpperCase());
  assert.equal(EALDHOLT_LOADING_COPY.title, 'HOUSE EALDHOLT');
  assert.equal(EALDHOLT_LOADING_COPY.error.title, EALDHOLT_PREVIEW_COPY.error.title);
  assert.equal(EALDHOLT_LOADING_COPY.error.title, 'Village unavailable');
});

test('a download with a known size fills its share by bytes; an unmeasured stage holds at its start', () => {
  assert.deepEqual(EALDHOLT_LOADING_START, { stage: 'download', value: 0 });
  const [downloadStart, downloadEnd] = EALDHOLT_LOADING_SPANS.download;
  const half = advanceEaldholtLoading(EALDHOLT_LOADING_START, { stage: 'download', fraction: .5 });
  near(half.value, (downloadStart + downloadEnd) / 2);
  near(advanceEaldholtLoading(half, { stage: 'download', fraction: 1 }).value, downloadEnd);
  assert.deepEqual(advanceEaldholtLoading(half, { stage: 'parse', fraction: null }), { stage: 'parse', value: EALDHOLT_LOADING_SPANS.parse[0] });
  const [assemblyStart, assemblyEnd] = EALDHOLT_LOADING_SPANS.assembly;
  near(advanceEaldholtLoading(EALDHOLT_LOADING_START, { stage: 'assembly', fraction: .5 }).value, (assemblyStart + assemblyEnd) / 2);
  assert.equal(ealdholtLoadingPercent(half), Math.round(half.value * 100));
});

test('the bar never retreats: late, repeated, out-of-range and unknown reports are harmless', () => {
  const woodland = run([{ stage: 'download', fraction: 1 }, { stage: 'woodland', fraction: null }]);
  assert.equal(advanceEaldholtLoading(woodland, { stage: 'download', fraction: .2 }), woodland, 'an earlier stage is ignored');
  assert.equal(advanceEaldholtLoading(woodland, { stage: 'woodland', fraction: null }), woodland, 'a repeat returns the very same object');
  const assembling = run([{ stage: 'assembly', fraction: .75 }], woodland);
  assert.equal(advanceEaldholtLoading(assembling, { stage: 'assembly', fraction: .25 }), assembling, 'a lower fraction keeps the bar');
  assert.equal(advanceEaldholtLoading(assembling, { stage: 'assembly', fraction: 7 }).value, EALDHOLT_LOADING_SPANS.assembly[1]);
  assert.equal(advanceEaldholtLoading(assembling, { stage: 'assembly', fraction: Number.NaN }), assembling);
  assert.equal(advanceEaldholtLoading(assembling, { stage: 'assembly', fraction: -3 }), assembling);
  assert.equal(advanceEaldholtLoading(assembling, { stage: 'nonsense' as never, fraction: 1 }), assembling);
  let previous = EALDHOLT_LOADING_START.value;
  let state = EALDHOLT_LOADING_START;
  for (const stage of EALDHOLT_LOADING_STAGES) for (const fraction of [null, .5, .1, 1]) {
    state = advanceEaldholtLoading(state, { stage, fraction });
    assert.ok(state.value >= previous, `${stage} ${fraction}`);
    previous = state.value;
  }
  assert.equal(state.stage, 'warmup');
  assert.equal(state.value, EALDHOLT_LOADING_SPANS.warmup[1]);
  assert.equal(ealdholtLoadingPercent({ stage: 'warmup', value: 4 }), 100);
  assert.equal(ealdholtLoadingPercent({ stage: 'download', value: -1 }), 0);
});
