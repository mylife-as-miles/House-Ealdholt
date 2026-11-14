/** Keep operator-only asset inputs out of production, including SDK modules
 * that serialize the complete Vite environment rather than individual keys. */
export function stripPrivatePreviewBuildInputs(
  command: 'build' | 'serve',
  environment: Record<string, string | undefined>,
  loaded: Record<string, string> = {},
): void {
  if (command !== 'build') return;
  for (const key of new Set([...Object.keys(environment), ...Object.keys(loaded)])) {
    if (key.startsWith('VITE_ELDERBLOOM_')) environment[key] = '';
  }
}
