/**
 * Violence Intensity: how much blood a capture shows in a match. One setting,
 * shared by both menus, independent of graphics quality. It only changes what
 * is drawn; captures and their outcomes are the same at every level
 * (docs/play/GORE_SYSTEM.md).
 */
export type ViolenceIntensity = 'minimal' | 'cinematic' | 'full';
export const VIOLENCE_INTENSITIES: readonly ViolenceIntensity[] = Object.freeze(['minimal', 'cinematic', 'full'] as const);
export const DEFAULT_VIOLENCE_INTENSITY: ViolenceIntensity = 'cinematic';

export const VIOLENCE_COPY = Object.freeze({
  label: 'Violence Intensity',
  values: Object.freeze({ minimal: 'Minimal blood', cinematic: 'Cinematic blood', full: 'Full presentation' } satisfies Record<ViolenceIntensity, string>),
  description: 'Choose how much blood a capture shows in a match. Minimal blood leaves one small stain. Cinematic blood adds the spray, the wound, stains on the board and a pool. Full presentation shows more of each. Captures and their results never change.',
  /** Appended where the platform has no match to apply it to. */
  noMatch: 'Immersive chess is not available in this build, so this has no effect here yet.',
});

export function normalizeViolenceIntensity(value: unknown): ViolenceIntensity {
  return VIOLENCE_INTENSITIES.includes(value as ViolenceIntensity) ? value as ViolenceIntensity : DEFAULT_VIOLENCE_INTENSITY;
}

/** The next level in either direction, wrapping. */
export function cycleViolenceIntensity(value: ViolenceIntensity, direction: number): ViolenceIntensity {
  const count = VIOLENCE_INTENSITIES.length, index = Math.max(0, VIOLENCE_INTENSITIES.indexOf(value));
  return VIOLENCE_INTENSITIES[(index + (direction < 0 ? -1 : 1) + count) % count];
}

/** The General category's row, identical in both menus. `match`: this platform plays matches. */
export function violenceIntensityRow(value: ViolenceIntensity, options: { match: boolean }): { id: 'violence-intensity'; label: string; value: string; description: string } {
  return {
    id: 'violence-intensity', label: VIOLENCE_COPY.label, value: VIOLENCE_COPY.values[value],
    description: options.match ? VIOLENCE_COPY.description : `${VIOLENCE_COPY.description}\n${VIOLENCE_COPY.noMatch}`,
  };
}
