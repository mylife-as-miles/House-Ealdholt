/**
 * My Legacy's loading screen: the named stages the village loader reports while
 * House Ealdholt is prepared, and the one bar they fill. Presentation only: no
 * clock, save or village state, and nothing here decides when the village is
 * ready (the loader's own onReady does). Desktop draws the bar; Quest shows the
 * same title and status copy on its existing status lines.
 */
export const EALDHOLT_LOADING_STAGES = [
  'download', 'verify', 'parse', 'ground', 'coast', 'foliage', 'pond', 'woodland', 'environment', 'residents', 'assembly', 'warmup',
] as const;
export type EaldholtLoadingStage = typeof EALDHOLT_LOADING_STAGES[number];

/** One report from the loader: the stage it has reached and, where it can be measured, how far through it. */
export interface EaldholtLoadingReport {
  readonly stage: EaldholtLoadingStage;
  /** 0 to 1 within the stage; null where the stage has no measurable total. */
  readonly fraction: number | null;
}

/**
 * The share of the bar each stage owns, as [start, end], in proportion to the
 * time each took in two measured loads of the Desktop village on the
 * development machine (13 November 2026, 152 s and 195 s, with the GPU shared):
 * the 174 MB model took 2 s and 22 s to arrive, the ground about 11 s, and the
 * woodland assembly (64 s and 84 s) and shader warm-up (75 s and 58 s) were
 * most of the wait. The last stage stops short of 1: only the loader's onReady
 * completes the bar.
 */
export const EALDHOLT_LOADING_SPANS: Readonly<Record<EaldholtLoadingStage, readonly [number, number]>> = Object.freeze({
  download: [0, .07],
  verify: [.07, .08],
  parse: [.08, .1],
  ground: [.1, .16],
  coast: [.16, .17],
  foliage: [.17, .18],
  pond: [.18, .19],
  woodland: [.19, .2],
  environment: [.2, .22],
  residents: [.22, .23],
  assembly: [.23, .62],
  warmup: [.62, .98],
});

export interface EaldholtLoadingProgress {
  readonly stage: EaldholtLoadingStage;
  /** The bar, 0 to 1. It never moves backwards. */
  readonly value: number;
}

export const EALDHOLT_LOADING_START: EaldholtLoadingProgress = Object.freeze({ stage: 'download', value: 0 });

/**
 * Folds a report into the bar. A stage never goes back to an earlier one and
 * the value never decreases, so a late or repeated report cannot make the bar
 * retreat. A report that changes nothing returns the very same object.
 */
export function advanceEaldholtLoading(current: EaldholtLoadingProgress, report: EaldholtLoadingReport): EaldholtLoadingProgress {
  const order = EALDHOLT_LOADING_STAGES.indexOf(report.stage);
  if (order < 0 || order < EALDHOLT_LOADING_STAGES.indexOf(current.stage)) return current;
  const [start, end] = EALDHOLT_LOADING_SPANS[report.stage];
  const fraction = report.fraction === null || !Number.isFinite(report.fraction) ? 0 : Math.min(1, Math.max(0, report.fraction));
  const value = Math.max(current.value, start + (end - start) * fraction);
  return report.stage === current.stage && value === current.value ? current : { stage: report.stage, value };
}

/** The bar as a whole percentage, for the progressbar's aria-valuenow. */
export function ealdholtLoadingPercent(progress: EaldholtLoadingProgress): number {
  return Math.round(Math.min(1, Math.max(0, progress.value)) * 100);
}
