/** Give first-entry image decoding/actor preparation an idle GPU opportunity.
 * The previous completed world frame stays visible. Simulation and DOM input
 * continue; this never changes residents, schedules, poses or saved time. */
export function createPopulationPreparationWindow(maximumMilliseconds = 1500) {
  let started: number | null = null, finished = false;
  return {
    status: 'idle' as 'idle' | 'preparing' | 'ready' | 'budget-expired',
    reset() { started = null; finished = false; this.status = 'idle'; },
    defer(now: number, state: { selected: number; ready: number; loading: number } | null): boolean {
      if (finished || !state) return false;
      if (state.ready > 0) { finished = true; this.status = 'ready'; return false; }
      if (!state.selected || !state.loading) return false;
      started ??= now;
      if (now - started >= maximumMilliseconds) { finished = true; this.status = 'budget-expired'; return false; }
      this.status = 'preparing'; return true;
    },
  };
}
