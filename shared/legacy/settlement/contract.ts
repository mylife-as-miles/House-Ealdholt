import type { LegacyEnvironmentLayout } from '../content/environments';

/** Estate arrangement is separate from the chess-authoritative Legacy state. */
export type SettlementBuilding = 'cottage' | 'storehouse' | 'pavilion' | 'ruin-arch';
export type SettlementTool = SettlementBuilding;
export interface SettlementPlacement {
  id: string;
  kind: SettlementTool;
  x: number;
  z: number;
  width: number;
  depth: number;
  rotation: 0 | 1 | 2 | 3;
  /** Reserved null slot preserves the v1 building-save format. */
  crop: null;
}
export interface SettlementPreview extends SettlementPlacement { valid: boolean; reason: string | null }
export interface SettlementLayout {
  version: 1;
  bannerId: string;
  worldId: LegacyEnvironmentLayout;
  placements: readonly SettlementPlacement[];
}
export interface SettlementSnapshot {
  available: boolean;
  reason: string | null;
  tool: SettlementTool | null;
  preview: SettlementPreview | null;
  placements: readonly SettlementPlacement[];
  selectedId: string | null;
  message: string | null;
  /** Failed device storage must not be presented as a successful save. */
  storageError: string | null;
  maxPlacements: number;
}
export interface LegacySettlementEnvironment {
  /** Actual source kit geometry and provenance; read only, never a scene mutation. */
  getSettlementSourceInfo?(): import('../worlds/combined/kit').CombinedWorldKitInfo | null;
  /** Read-only evidence of generated scene geometry, separate from layout intent. */
  getSettlementRenderInfo?(): import('./render').SettlementRenderInfo | null;
  getSettlementSnapshot(): SettlementSnapshot;
  subscribeSettlement(listener: (snapshot: SettlementSnapshot) => void): () => void;
  setSettlementTool(tool: SettlementTool | null): boolean;
  setSettlementCursor(x: number, z: number): boolean;
  moveSettlementCursor(dx: number, dz: number): boolean;
  rotateSettlementPreview(): boolean;
  commitSettlementPlacement(): boolean;
  cancelSettlementPlacement(): void;
  selectSettlementPlacement(id: string | null): boolean;
  deleteSettlementPlacement(id?: string): boolean;
}
export const SETTLEMENT_TOOLS: readonly { id: SettlementTool; label: string; width: number; depth: number; detail: string }[] = [
  { id: 'cottage', label: 'Terrace cottage', width: 8, depth: 7, detail: 'A plaster-and-stone cottage with a tiled roof.' },
  { id: 'storehouse', label: 'Storehouse', width: 10, depth: 8, detail: 'A low stone storehouse for your estate.' },
  { id: 'pavilion', label: 'Timber pavilion', width: 4, depth: 4, detail: 'An open timber pavilion beneath a curved roof.' },
  { id: 'ruin-arch', label: 'Stone arch', width: 8, depth: 3, detail: 'A pointed arch assembled from weathered masonry.' },
];
/** Provenance for actual component generators present in rendered geometry. */
export interface SettlementSourceAsset {
  id: string;
  repository: string;
  commit: string;
  path: string;
  generator: string;
  license: string;
}
