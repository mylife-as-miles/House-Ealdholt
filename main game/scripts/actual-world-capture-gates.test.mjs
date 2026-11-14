import test from 'node:test';
import assert from 'node:assert/strict';
import { populationNavigationReady, canopyCaptureState, regionalDetailCaptureReady } from './actual-world-capture-gates.mjs';

test('normal navigation depends on the loaded site rather than current camera actor assets', () => {
  assert.equal(populationNavigationReady({ populationStatus: 'ready', populationRegistered: '100', populationReady: '0', populationDrawn: '0' }), true);
  assert.equal(populationNavigationReady({ populationStatus: 'loading', populationRegistered: '100', populationReady: '2' }), false);
  assert.equal(populationNavigationReady({ populationStatus: 'ready', populationRegistered: '0' }), false);
});

test('population loader failures are preserved before normal navigation', () => {
  assert.throws(() => populationNavigationReady({ populationStatus: 'error', populationError: 'Source hash mismatch' }), /Source hash mismatch/);
});

test('complete overhead captures require the compiled ready phase and actual overview submission', () => {
  const ready = { readyCanopies: 15, canopyPreparation: 'ready', renderedCanopies: 12 };
  assert.deepEqual(canopyCaptureState(ready, { overview: true }), { ready: true, complete: true, degraded: false, error: '' });
  assert.equal(canopyCaptureState({ ...ready, renderedCanopies: 0 }, { overview: true }).ready, false);
  assert.equal(canopyCaptureState({ ...ready, canopyPreparation: 'preparing' }).ready, false);
});

test('explicit canopy fallback is labelled incomplete and cannot pass a strict complete gate', () => {
  const failed = { readyCanopies: 8, canopyPreparation: 'failed', canopyError: 'Source vegetation capture view 0 is empty' };
  assert.deepEqual(canopyCaptureState(failed), { ready: true, complete: false, degraded: true, error: failed.canopyError });
  assert.throws(() => canopyCaptureState(failed, { requireComplete: true }), /view 0 is empty/);
  assert.equal(canopyCaptureState({ ...failed, canopyPreparation: 'preparing' }).ready, false);
});

test('settled woodland evidence cannot pass with an unstarted cell or retained source fallback', () => {
  const ready = { status: 'ready', detailRequestedCells: 3, detailReadyCells: 3,
    detailPendingCells: 0, detailReady: true, nearPreparing: 0, sourceFallbackCells: 0 };
  assert.equal(regionalDetailCaptureReady(ready), true);
  for (const pending of [
    { detailReadyCells: 2, detailPendingCells: 1, detailReady: false },
    { nearPreparing: 1 }, { sourceFallbackCells: 1 }, { detailRequestedCells: 0 },
    { detailRequestedCells: NaN }, { status: 'awaiting-preparation' }, { detailReady: false },
  ]) assert.equal(regionalDetailCaptureReady({ ...ready, ...pending }), false);
  assert.equal(regionalDetailCaptureReady({ status: 'ready', nearPreparing: 0 }), false,
    'older diagnostics cannot certify that every requested cell was prepared');
  assert.throws(() => regionalDetailCaptureReady({ ...ready, detailError: 'Cell capture held' }), /Cell capture held/);
});
