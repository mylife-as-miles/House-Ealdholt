// Visual settings only. Never part of Legacy progression or the house save.
export const LEGACY_ENVIRONMENTS = [
  { id: 'bannerhold', label: 'Bannerhold' },
  { id: 'golden-temple', label: 'Temple Terraces' },
  { id: 'monolith-wilds', label: 'Monolith Wilds' },
  { id: 'alpine-lake', label: 'Alpine Lake' },
  { id: 'athenaion', label: 'Citadel Terraces' },
] as const;
export type LegacyEnvironmentLayout = typeof LEGACY_ENVIRONMENTS[number]['id'];
export const ENVIRONMENT_STORAGE_KEY = 'crownfall.legacy.environment.v1';
export function environmentLayout(value: unknown): LegacyEnvironmentLayout {
  return LEGACY_ENVIRONMENTS.find(x => x.id === value)?.id ?? 'bannerhold';
}
export function nextEnvironment(current: LegacyEnvironmentLayout, step: -1 | 1): LegacyEnvironmentLayout {
  const index = LEGACY_ENVIRONMENTS.findIndex(x => x.id === current);
  return LEGACY_ENVIRONMENTS[(index + step + LEGACY_ENVIRONMENTS.length) % LEGACY_ENVIRONMENTS.length].id;
}
export function environmentLabel(id: LegacyEnvironmentLayout): string {
  return LEGACY_ENVIRONMENTS.find(x => x.id === id)!.label;
}
export function readEnvironmentLayout(): LegacyEnvironmentLayout {
  try { return environmentLayout(globalThis.localStorage?.getItem(ENVIRONMENT_STORAGE_KEY)); } catch { return 'bannerhold'; }
}
export function saveEnvironmentLayout(id: LegacyEnvironmentLayout): void {
  try { globalThis.localStorage?.setItem(ENVIRONMENT_STORAGE_KEY, id); } catch { /* Session-only when storage is unavailable. */ }
}
