import type { LegacyExplorationSnapshot } from './contract';
export function createExplorationFigure<T extends { Group: new (...args: any[]) => any }>(three: T, options?: { miniature?: boolean; atlas?: unknown }): {
  root: InstanceType<T['Group']>;
  update(snapshot: LegacyExplorationSnapshot, delta: number, reducedMotion?: boolean): void;
  dispose(): void;
};
