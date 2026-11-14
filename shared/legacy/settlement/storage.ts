import { LEGACY_ENVIRONMENTS, type LegacyEnvironmentLayout } from '../content/environments';
import type { SettlementLayout, SettlementPlacement } from './contract';
import { validPlacementShape } from './validation';
export const SETTLEMENT_STORAGE_PREFIX = 'crownfall.legacy.estate.v1';
export const MAX_SETTLEMENT_PLACEMENTS = 48;
export interface SettlementStorage { getItem(key:string):string|null; setItem(key:string,value:string):void; removeItem?(key:string):void }
export function settlementStorageKey(bannerId:string,worldId:LegacyEnvironmentLayout){return `${SETTLEMENT_STORAGE_PREFIX}.${encodeURIComponent(bannerId)}.${worldId}`;}
/** Read-only v1 migration: discard retired farming records without touching the
 * house or rewriting device storage. A later building edit saves the clean layout.
 * Unknown/invalid records still reject the save rather than hiding corruption. */
function isRetiredField(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const p = value as Record<string, unknown>;
  return p.kind === 'field' && typeof p.id === 'string'
    && /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,95}$/.test(p.id)
    && !['banner-hall', 'muster-grounds', 'war-record', 'heralds-station'].includes(p.id)
    && [p.x, p.z, p.width, p.depth].every(v => typeof v === 'number' && Number.isFinite(v))
    && Math.abs(p.x as number) < 1e6 && Math.abs(p.z as number) < 1e6
    && Number.isInteger(p.width) && (p.width as number) >= 4 && (p.width as number) <= 24
    && Number.isInteger(p.depth) && (p.depth as number) >= 4 && (p.depth as number) <= 24
    && [0, 1, 2, 3].includes(p.rotation as number)
    && ['oats', 'cabbage', 'carrots', 'pumpkins'].includes(p.crop as string);
}
export function parseSettlementLayout(value:string,bannerId:string,worldId:LegacyEnvironmentLayout):SettlementLayout|null {
  try {
    if(value.length>128*1024)return null;
    const raw=JSON.parse(value);
    if(!raw||raw.version!==1||raw.bannerId!==bannerId||raw.worldId!==worldId||!LEGACY_ENVIRONMENTS.some(w=>w.id===worldId)||!Array.isArray(raw.placements)||raw.placements.length>MAX_SETTLEMENT_PLACEMENTS)return null;
    if(!raw.placements.every((p:unknown)=>validPlacementShape(p)||isRetiredField(p))||new Set(raw.placements.map((p:{id:string})=>p.id)).size!==raw.placements.length)return null;
    return {version:1,bannerId,worldId,placements:raw.placements.filter(validPlacementShape).map((p:SettlementPlacement)=>({...p}))};
  }catch{return null;}
}
export function readSettlementLayout(storage:SettlementStorage|null,bannerId:string,worldId:LegacyEnvironmentLayout):{layout:SettlementLayout|null;error:string|null}{
  if(!storage)return {layout:null,error:'Device storage is unavailable. Layout changes will last for this session.'};
  try {
    const raw=storage.getItem(settlementStorageKey(bannerId,worldId));
    if(raw===null)return {layout:null,error:null};
    const layout=parseSettlementLayout(raw,bannerId,worldId);
    return {layout,error:layout?null:'The saved estate layout could not be read. The house record is unchanged.'};
  }catch{return {layout:null,error:'Device storage could not be read. Layout changes will last for this session.'};}
}
export function writeSettlementLayout(storage:SettlementStorage|null,layout:SettlementLayout):string|null{
  if(!storage)return 'Device storage is unavailable. This layout is available for this session.';
  try{storage.setItem(settlementStorageKey(layout.bannerId,layout.worldId),JSON.stringify(layout));return null;}
  catch{return 'The estate layout could not be saved. These changes are available for this session.';}
}
export function browserSettlementStorage():SettlementStorage|null{
  try{return typeof globalThis.localStorage==='undefined'?null:globalThis.localStorage;}catch{return null;}
}
