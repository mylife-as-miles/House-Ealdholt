import type { LandmarkId, MemberStatus } from "../types";

/** Exploration is ephemeral presentation. It never writes house progression. */
export interface ExplorationPoint { x: number; y: number; z: number }
export interface RouteNode { id: string; position: ExplorationPoint }
/** Connections are undirected authored walkways. Optional cost must cover distance. */
export interface RouteEdge { from: string; to: string; cost?: number }
export interface AuthoredRouteGraph { nodes: readonly RouteNode[]; edges: readonly RouteEdge[] }
/** Both checks are required: unsupported worlds cannot silently become walkable. */
export interface RouteSafety {
  isPointSafe?: (point: ExplorationPoint) => boolean;
  isSegmentSafe?: (from: ExplorationPoint, to: ExplorationPoint) => boolean;
}
export interface ExplorationSessionSnapshot {
  status: "idle" | "moving" | "arrived" | "unavailable";
  selectedMember: string | null;
  destination: string | null;
  location: ExplorationPoint | null;
  progress: number;
  error: string | null;
  paused: boolean;
}
export interface ExplorationMember {
  id: string;
  name: string;
  status: MemberStatus;
  role: "representative" | "levy";
  available: boolean;
}
export interface ExplorationDestination {
  id: LandmarkId;
  label: string;
  available: boolean;
  reason?: string;
  travelMode?: "walk" | "fast-travel";
}
export interface LegacyExplorationSnapshot extends ExplorationSessionSnapshot {
  enabled: boolean;
  available: boolean;
  unavailableReason: string | null;
  members: readonly ExplorationMember[];
  selectedMemberId: string | null;
  destinations: readonly ExplorationDestination[];
}
export interface LegacyExplorationEnvironment {
  getExplorationSnapshot(): LegacyExplorationSnapshot;
  setExplorationMember(memberId: string): boolean;
  travelToLandmark(id: LandmarkId): boolean;
  /** Only points close to a verified authored path can be selected. */
  moveToPoint?(point: ExplorationPoint): boolean;
  /** An explicit relocation between distant hubs, never presented as walking. */
  fastTravelToLandmark?(id: LandmarkId): boolean;
  cancelTravel(): void;
  setExplorationEnabled(enabled: boolean): void;
  subscribeExploration(listener: (snapshot: LegacyExplorationSnapshot) => void): () => void;
}
