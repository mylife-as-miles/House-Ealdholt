/** Authored density prefixes only: metadata contains counts, never placements.
 * Callers must pass an instance-owned hierarchy, never an AssetManager prototype.
 * Measure comfort/framing at the complete HIGH pool before applying a lower
 * quality. Adapters retain conservative HIGH bounds across all later changes.
 * Lower counts do not shrink HIGH-sized instance buffers or GPU allocation. */
export type EaldholtFoliageQuality = 'low' | 'medium' | 'high';
export interface EaldholtFoliageDensityMetadata {
  readonly schema: 1;
  readonly family: string;
  readonly components: number;
  readonly counts: Readonly<Record<EaldholtFoliageQuality, number>>;
}
export interface EaldholtFoliageComponentInfo {
  readonly capacity: number;
  readonly initialCount: number;
  readonly trianglesPerActor: number;
  readonly draws: number;
  readonly completeGeometry: boolean;
}
export interface EaldholtFoliageFamilyDiagnostic {
  readonly family: string; readonly components: number;
  readonly actors: number; readonly triangles: number; readonly drawCalls: number;
}
export interface EaldholtFoliageDiagnostic {
  readonly quality: EaldholtFoliageQuality;
  readonly familyCount: number; readonly componentCount: number;
  readonly selectedActors: number; readonly selectedTriangles: number; readonly selectedDrawCalls: number;
  /** Potential geometry when visible; excludes runtime culling, stereo and shadow passes. */
  readonly families: readonly EaldholtFoliageFamilyDiagnostic[];
}
export interface EaldholtFoliageDensity {
  readonly diagnostics: EaldholtFoliageDiagnostic;
  readonly disposed: boolean;
  setQuality(quality: EaldholtFoliageQuality): boolean;
  dispose(): void;
}
export function assertEaldholtFoliageQuality(value: unknown): asserts value is EaldholtFoliageQuality {
  if (value !== 'low' && value !== 'medium' && value !== 'high') throw Error('Invalid authored foliage quality.');
}
export function readEaldholtFoliageDensity(value: unknown): EaldholtFoliageDensityMetadata {
  const tag = value as Partial<EaldholtFoliageDensityMetadata> | null;
  if (!tag || typeof tag !== 'object' || tag.schema !== 1 || typeof tag.family !== 'string'
    || !tag.family.trim() || tag.family.length > 160 || /[\u0000-\u001f\u007f]/.test(tag.family)
    || !Number.isSafeInteger(tag.components) || tag.components! < 1 || tag.components! > 64
    || !tag.counts || typeof tag.counts !== 'object') throw Error('Invalid authored foliage density metadata.');
  const { low, medium, high } = tag.counts;
  if (![low, medium, high].every(count => Number.isSafeInteger(count) && count >= 0)
    || low > medium || medium > high) throw Error('Authored foliage density counts must increase from low to high.');
  return Object.freeze({ schema: 1, family: tag.family, components: tag.components!,
    counts: Object.freeze({ low, medium, high }) });
}
export function validateEaldholtFoliageComponents(tag: EaldholtFoliageDensityMetadata, infos: readonly EaldholtFoliageComponentInfo[]): void {
  if (infos.length !== tag.components) throw Error(`Incomplete authored foliage family: ${tag.family}.`);
  const initial = infos[0]?.initialCount;
  for (const info of infos) {
    if (!Number.isSafeInteger(info.capacity) || info.capacity < tag.counts.high
      || !Number.isSafeInteger(info.initialCount) || info.initialCount < 0 || info.initialCount > info.capacity
      || info.initialCount !== initial) throw Error(`Incoherent authored foliage instance pool: ${tag.family}.`);
    if (!info.completeGeometry || !Number.isSafeInteger(info.trianglesPerActor) || info.trianglesPerActor < 1
      || !Number.isSafeInteger(info.draws) || info.draws < 1) throw Error(`Incomplete authored foliage geometry: ${tag.family}.`);
  }
}
export interface EaldholtFoliageAdapter<N extends object, C extends object, S> {
  children(node: N): readonly N[];
  metadata(node: N): unknown;
  component(node: N): C | null;
  drawable(node: N): boolean;
  inspect(component: C, high: number): EaldholtFoliageComponentInfo;
  snapshot(component: C): S;
  primeHighBounds(component: C, high: number): void;
  select(component: C, count: number): void;
  restore(component: C, snapshot: S): void;
}
const owners = new WeakMap<object, object>();

/** Shared atomic ownership/lifecycle; platform adapters supply their own engine.
 * Validation and setup allocate once. setQuality uses prebuilt plans/snapshots;
 * repeated quality values do nothing and no frame callback is registered. */
export function createEaldholtFoliageDensityWithAdapter<N extends object, C extends object, S>(
  root: N, initialQuality: EaldholtFoliageQuality, adapter: EaldholtFoliageAdapter<N, C, S>,
): EaldholtFoliageDensity {
  assertEaldholtFoliageQuality(initialQuality);
  type Family = { tag: EaldholtFoliageDensityMetadata; components: C[]; infos: EaldholtFoliageComponentInfo[] };
  const families: Family[] = [], seen = new Set<N>(), familyNames = new Set<string>();
  function visit(node: N, family: Family | null): void {
    if (seen.has(node)) throw Error('Ambiguous or cyclic authored foliage ownership.');
    seen.add(node);
    const metadata = adapter.metadata(node);
    if (metadata !== undefined) {
      if (family) throw Error('Nested authored foliage families are ambiguous.');
      const tag = readEaldholtFoliageDensity(metadata);
      if (familyNames.has(tag.family)) throw Error(`Duplicate authored foliage family: ${tag.family}.`);
      familyNames.add(tag.family); family = { tag, components: [], infos: [] }; families.push(family);
    }
    if (family) {
      const component = adapter.component(node);
      if (component) { family.components.push(component); family.infos.push(adapter.inspect(component, family.tag.counts.high)); }
      else if (adapter.drawable(node)) throw Error(`Non-instanced component inside authored foliage family: ${family.tag.family}.`);
    }
    for (const child of adapter.children(node)) visit(child, family);
  }
  visit(root, null);
  for (const family of families) validateEaldholtFoliageComponents(family.tag, family.infos);
  const entries = families.flatMap(family => family.components.map(component => ({ component, high: family.tag.counts.high, snapshot: adapter.snapshot(component) })));
  for (const { component } of entries) if (owners.has(component)) throw Error('An authored foliage instance already has an active density owner.');
  const token = {}, plans = {} as Record<EaldholtFoliageQuality, EaldholtFoliageDiagnostic>;
  for (const quality of ['low', 'medium', 'high'] as const) {
    const rows = families.map(({ tag, infos }) => Object.freeze({ family: tag.family, components: tag.components,
      actors: tag.counts[quality], triangles: infos.reduce((sum, info) => sum + info.trianglesPerActor * tag.counts[quality], 0),
      drawCalls: tag.counts[quality] > 0 ? infos.reduce((sum, info) => sum + info.draws, 0) : 0 }));
    plans[quality] = Object.freeze({ quality, familyCount: rows.length, componentCount: entries.length,
      selectedActors: rows.reduce((sum, row) => sum + row.actors, 0), selectedTriangles: rows.reduce((sum, row) => sum + row.triangles, 0),
      selectedDrawCalls: rows.reduce((sum, row) => sum + row.drawCalls, 0), families: Object.freeze(rows) });
  }
  function apply(quality: EaldholtFoliageQuality): void {
    for (const family of families) for (const component of family.components) adapter.select(component, family.tag.counts[quality]);
  }
  let disposed = false, quality = initialQuality;
  try {
    for (const entry of entries) owners.set(entry.component, token);
    for (const entry of entries) adapter.primeHighBounds(entry.component, entry.high);
    apply(quality);
  } catch (error) {
    for (const entry of entries) { adapter.restore(entry.component, entry.snapshot); if (owners.get(entry.component) === token) owners.delete(entry.component); }
    throw error;
  }
  return { get diagnostics() { return plans[quality]; }, get disposed() { return disposed; },
    setQuality(next) {
      assertEaldholtFoliageQuality(next);
      if (disposed || next === quality) return false;
      apply(next); quality = next; return true;
    }, dispose() {
      if (disposed) return; disposed = true;
      for (const entry of entries) { adapter.restore(entry.component, entry.snapshot); if (owners.get(entry.component) === token) owners.delete(entry.component); }
    },
  };
}
