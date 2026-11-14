// Capture orchestration only; these gates do not change the running world.
export function populationNavigationReady(data) {
  if (data.populationStatus === 'error') throw Error(data.populationError || 'Population site failed.');
  // Ready mesh counts belong to the current camera's presentation selection.
  // Site readiness is sufficient to navigate to the requested authored view.
  return data.populationStatus === 'ready' && Number(data.populationRegistered) === 100;
}

export function canopyCaptureState(forest, { overview = false, requireComplete = false } = {}) {
  const complete = forest?.readyCanopies === 15 && forest.canopyPreparation === 'ready';
  if (complete) return { ready: !overview || forest.renderedCanopies > 0, complete: true, degraded: false, error: '' };
  if (forest?.canopyPreparation === 'failed' && forest.canopyError) {
    if (requireComplete) throw Error(forest.canopyError);
    return { ready: true, complete: false, degraded: true, error: forest.canopyError };
  }
  return { ready: false, complete: false, degraded: false, error: forest?.canopyError ?? '' };
}

/** A drained upload queue alone does not prove that the last requested cell
 * was started or that its publication reached the current frame. */
export function regionalDetailCaptureReady(forest) {
  if (forest?.detailError) throw Error(forest.detailError);
  const requested = forest?.detailRequestedCells;
  return forest?.status === 'ready' && Number.isSafeInteger(requested) && requested > 0
    && forest.detailReady === true && forest.detailReadyCells === requested
    && forest.detailPendingCells === 0 && forest.nearPreparing === 0
    && forest.sourceFallbackCells === 0;
}
