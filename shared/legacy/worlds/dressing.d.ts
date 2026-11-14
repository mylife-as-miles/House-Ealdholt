import type { SourceWorld } from './index';
import type { LegacySceneState } from '../environment-contract';
import type { HeraldrySlot } from '../environment/heraldry/atlas';
/**
 * One piece of cloth. `wall`: hangs from `position` (top centre of the cloth) on the source's
 * architecture. `standard`: stands on a pole whose foot is at `position`.
 */
export interface BannerSite {
  id: string;
  kind: 'wall' | 'standard';
  /** Which atlas cloth: the house, its ally, or the nation's standard. */
  heraldry?: Extract<HeraldrySlot, 'player' | 'ally' | 'rival' | 'crown'>;
  position: readonly [number, number, number];
  /** Compass bearing the cloth faces (0 = -Z, 90 = +X). Omitted: faces the establishing camera. */
  facing?: number;
  width: number;
  /** Cloth drop; defaults to the heraldry's own 1:1.5 proportion. */
  height?: number;
  /** Pole height above `position`, for standards. */
  pole?: number;
  /** Wall cloth: paired lamps on the hanging rod. */
  lamp?: boolean;
  /** Hem movement as a fraction of the width. */
  motion?: number;
  /** Plain cloth from the middle of the tile, without its border: valances, not heraldry. */
  plain?: boolean;
  /** Size multiplier when the host shows the world as a miniature. Defaults to the world's reliefScale. */
  relief?: number;
}
export interface WorldHeraldry {
  sites: readonly BannerSite[];
  /** Source cloth meshes the house's cloth replaces, by material name. Restored on dispose. */
  hideMaterials?: readonly string[];
  /** Source-material finish toward the kingdom's stone colour. null: leave source colours alone. */
  tint?: { amount?: number; exclude?: RegExp } | null;
  /** Size multiplier for every site when the host shows the world as a miniature (Quest). */
  reliefScale?: number;
  clothLift?: number;
  clothEnv?: number;
  lampGain?: number;
}
export interface WorldDressing {
  setState(state:LegacySceneState):void;
  update(time:number,motion:boolean):void;
  dispose():void;
  stats():{ sites:number; draws:number; triangles:number; tinted:number; hidden:number };
  readonly group:unknown;
  readonly texture:unknown;
}
export function dressWorld(three:unknown,asset:SourceWorld&{heraldry?:WorldHeraldry},state:LegacySceneState,options?:{relief?:boolean}):WorldDressing;
export function disposeSourceTree(root:unknown):void;
