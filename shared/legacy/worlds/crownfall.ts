import { NATIONS } from '../content/nations';
import { TINCTURE_SRGB } from '../environment-contract';
import type { LegacySceneState } from '../environment-contract';
import type { AtlasHeraldry } from '../environment/heraldry/adapter';
import type { NationId } from '../types';

export interface WorldKingdomStyle {
  stone: string; trim: string; ambient: string; ground: string;
  /** National standard cloth, the same field and border the original Bannerhold's crown mounts use. */
  crownField: string; crownBorder: string;
  /** Lamp colour on standards: the nation's own glow from its palette. */
  glow: string;
  /** Standard poles: the nation's own primary colour. */
  pole: string;
}
const palette = (id: NationId) => NATIONS[id].palette;
export const WORLD_KINGDOM_STYLE: Record<NationId, WorldKingdomStyle> = {
  korvenia: {stone:'#a39bab',trim:'#c19a51',ambient:'#bcb1d1',ground:'#413d4b',crownField:palette('korvenia').secondary,crownBorder:palette('korvenia').metal,glow:palette('korvenia').glow,pole:palette('korvenia').primary},
  solforiz: {stone:'#d1b78c',trim:'#ddb359',ambient:'#e1d5b7',ground:'#6b5037',crownField:palette('solforiz').primary,crownBorder:palette('solforiz').metal,glow:palette('solforiz').glow,pole:palette('solforiz').primary},
  aethelgard: {stone:'#a5b2a2',trim:'#aa9c73',ambient:'#c2d1d1',ground:'#344831',crownField:palette('aethelgard').secondary,crownBorder:palette('aethelgard').metal,glow:palette('aethelgard').glow,pole:palette('aethelgard').primary},
  'kwind-09': {stone:'#8599a2',trim:'#62c9cd',ambient:'#a5c9d6',ground:'#334751',crownField:palette('kwind-09').primary,crownBorder:palette('kwind-09').glow,glow:palette('kwind-09').glow,pole:palette('kwind-09').primary},
};
/** The state's heraldry for the shared atlas. Undyed and veil cloth match the original Bannerhold's. */
export function worldAtlasHeraldry(state: LegacySceneState): AtlasHeraldry {
  const style = WORLD_KINGDOM_STYLE[state.nationId];
  return {
    player: state.heraldry,
    ally: state.alliedHouse?.heraldry ?? null,
    rival: state.rivalHouse?.heraldry ?? null,
    crown: { field: style.crownField, border: style.crownBorder },
    undyed: '#8f877b',
    veil: { cloth: '#231d2b', border: style.trim },
  };
}
/** Changes only when the atlas pixels would change, so status updates never re-upload it. */
export function worldAtlasKey(h: AtlasHeraldry): string {
  return JSON.stringify([h.player, h.ally, h.rival, h.crown.field, h.crown.border]);
}
export function fieldColor(state:LegacySceneState):string {
  return state.heraldry ? TINCTURE_SRGB[state.heraldry.field[0]] : '#8c816c';
}
