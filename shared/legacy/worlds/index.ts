import type { LandmarkId, NationId } from '../types';
import type { ExplorationRouteData } from '../exploration/controller';
import type { LegacyEnvironmentLayout } from '../content/environments';
import type { WorldHeraldry } from './dressing.js';
import { HERALDRY as ALPINE_HERALDRY } from './alpine-lake/banners';
import { HERALDRY as ATHENAION_HERALDRY } from './athenaion/banners';
import { HERALDRY as TEMPLE_HERALDRY } from './golden-temple/banners';
import { HERALDRY as MONOLITH_HERALDRY } from './monolithwilds/banners';
export type WorldVector = readonly [number, number, number];
export interface SourceWorld {
  exploration?: ExplorationRouteData;
  /** False for a world rebuilt independently of any upstream source. buildSourceWorld fills this in. */
  sourceWorld?: boolean;
  /** Size of the off-screen target a world mirrors itself into, if it has one. */
  reflectionTarget?(): readonly [number, number] | null;
  /** Native Object3D in the adapter's own Three namespace. */
  root: unknown;
  view: { position: WorldVector; target: WorldVector; fov: number };
  landmarks: { id: LandmarkId; position: WorldVector }[];
  extent: { center: WorldVector; width: number; depth: number; height: number };
  lighting?: { sunDirection: WorldVector; sunColor: string; skyColor: string; groundColor: string; exposure: number; sunIntensity?: number };
  update?(timeSeconds: number, deltaSeconds: number): void;
  /** Source-specific targets, workers, hooks and off-tree resources only. */
  dispose?(): void;
  setSourceTransform?(inverseRootMatrix: unknown, sourceCameraPosition: unknown): void;
  /** Where this world hangs the house's cloth and how the kingdom finish treats it. */
  heraldry?: WorldHeraldry;
}
export interface SourceWorldContext {
  THREE: unknown; renderer: unknown; scene: unknown; camera: unknown;
  profile: 'desktop' | 'quest'; nationId: NationId;
  onProgress?: (label: string) => void;
}
type WorldModule = { buildWorld(ctx: SourceWorldContext): Promise<SourceWorld> };
const builders = import.meta.glob<WorldModule>('./*/build.js');
const heraldry = { 'golden-temple': TEMPLE_HERALDRY, 'monolith-wilds': MONOLITH_HERALDRY, 'alpine-lake': ALPINE_HERALDRY, athenaion: ATHENAION_HERALDRY } as const;
const folders = { 'golden-temple': 'golden-temple', 'monolith-wilds': 'monolithwilds', 'alpine-lake': 'alpine-lake', athenaion: 'athenaion' } as const;
export async function buildSourceWorld(layout: Exclude<LegacyEnvironmentLayout, 'bannerhold'>, ctx: SourceWorldContext): Promise<SourceWorld> {
  const load = builders[`./${folders[layout]}/build.js`];
  if (!load) throw new Error(`Source world is unavailable: ${layout}`);
  const result = await (await load()).buildWorld(ctx);
  result.heraldry = heraldry[layout];
  // The source film's opening reveal, not the old elevated debugging overview.
  // See Golden Temple src/shots.js, shot0 final key (24mm lens).
  if(layout==='golden-temple') {
    result.view={position:[44.45,2.8,21],target:[-30,9.8,-9],fov:46};
    if(result.lighting) result.lighting.sunIntensity=7;
  }
  if (!result?.root || result.landmarks.length !== 4 || !(result.extent.width > 0)) throw new Error(`Invalid source world: ${layout}`);
  result.sourceWorld = result.sourceWorld !== false;
  return result;
}
