import type { BannerholdPresentation, LandmarkId } from "../types";
import { LEGACY_COPY } from "../content/copy";
import { LEGACY_LANDMARKS } from "../environment-contract";
import { explorationMembers } from "./bannerhold";
import type { AuthoredRouteGraph, ExplorationDestination, ExplorationMember, ExplorationPoint, ExplorationSessionSnapshot, LegacyExplorationSnapshot, RouteSafety } from "./contract";
import { createExplorationSession } from "./session";
import type { ExplorationSession } from "./session";
import { compileRouteNetwork, planAuthoredRoute, nearestAuthoredNode } from "./navigation";
import type { RouteNetwork } from "./navigation";
import type { Collider } from "../environment/kernel/mesh";

export interface ExplorationRouteData {
  graph: AuthoredRouteGraph;
  safety: RouteSafety;
  destinations: Readonly<Record<string, string>>;
  startNode: string;
  /** Explicit relocation nodes for distant hubs. Only authored destinations qualify. */
  fastTravel?: Partial<Record<LandmarkId, string>>;
  cameraColliders?: readonly Collider[];
  sampleGround?: (x: number, z: number) => number | null;
}
/** Renderer-neutral presentation controller. House state is read, never mutated. */
export class SceneExplorationController {
  private session: ExplorationSession | null = null;
  private state: BannerholdPresentation;
  private routes: ExplorationRouteData | null = null;
  private reason: string | null = "This environment has no verified walking routes yet.";
  private enabled = false;
  private paused = false;
  private elapsed = 0;
  private reachable = new Set<string>();
  private network: RouteNetwork | null = null;
  private listeners = new Set<(snapshot: LegacyExplorationSnapshot) => void>();
  /**
   * Renderers read the snapshot every frame, so it is built once per change, never per call: publish() and
   * dispose() drop it, and a new session snapshot (the session replaces its own only when it changes)
   * rebuilds it. Members and destinations are kept until the house state, routes or availability change.
   */
  private snapshot: LegacyExplorationSnapshot | null = null;
  private snapshotSource: ExplorationSessionSnapshot | null = null;
  private members: readonly ExplorationMember[] | null = null;
  private destinations: readonly ExplorationDestination[] | null = null;
  private destinationsAvailable = false;
  constructor(state: BannerholdPresentation) { this.state = state; }
  configure(state: BannerholdPresentation, routes: ExplorationRouteData | null, reason?: string) {
    this.state = state; this.routes = routes; this.reachable.clear();
    this.reason = reason ?? (routes ? null : "This environment has no verified walking routes yet.");
    const members = explorationMembers(state).filter(m => m.available);
    if (routes) {
      const compiled = compileRouteNetwork(routes.graph, routes.safety);
      this.network = compiled.ok ? compiled.network : null;
      this.resolveReachable(routes.startNode);
      const starts = Object.fromEntries(members.map(m => [m.id, routes.startNode]));
      this.session = createExplorationSession({ ...routes, starts, members: members.map(m => m.id), speed: 4.5, fastTravelDestinations: Object.keys(routes.fastTravel ?? {}) });
      this.session.setPaused(this.paused || !this.enabled);
      if (!compiled.ok) this.reason = compiled.error;
    } else { this.session = null; this.network = null; }
    this.publish();
  }
  private resolveReachable(startNode: string) {
    this.reachable.clear();
    if (this.network && this.routes) for (const id of LEGACY_LANDMARKS) {
      const target = this.routes.destinations[id];
      if (target && planAuthoredRoute(this.network, startNode, target).ok) this.reachable.add(id);
    }
  }
  setState(state: BannerholdPresentation) {
    const before = explorationMembers(this.state).map(m => [m.id, m.status]);
    const after = explorationMembers(state).map(m => [m.id, m.status]);
    this.state = state;
    if (JSON.stringify(before) !== JSON.stringify(after)) this.configure(state, this.routes, this.reason ?? undefined);
    else this.publish();
  }
  getSnapshot(): LegacyExplorationSnapshot {
    const source = this.session?.getSnapshot() ?? null;
    if (this.snapshot && source === this.snapshotSource) return this.snapshot;
    const raw = source ?? { status: "unavailable" as const, selectedMember: null, destination: null, location: null, progress: 0, error: this.reason, paused: this.paused || !this.enabled };
    const available = !!this.routes && !!raw.location && !this.reason;
    this.members ??= explorationMembers(this.state);
    if (!this.destinations || this.destinationsAvailable !== available) {
      this.destinationsAvailable = available;
      this.destinations = LEGACY_LANDMARKS.map(id => {
        const fastTravel = !this.reachable.has(id) && !!this.routes?.fastTravel?.[id];
        return { id, label: LEGACY_COPY.landmarks[id].title, available: available && (this.reachable.has(id) || fastTravel), travelMode: fastTravel ? "fast-travel" as const : "walk" as const, ...(!this.reachable.has(id) && !fastTravel ? { reason: "No verified walking route reaches this destination. Use overview to inspect it." } : {}) };
      });
    }
    this.snapshotSource = source;
    this.snapshot = { ...raw, enabled: this.enabled, available, unavailableReason: this.reason ?? (!raw.location ? "No available house member can explore." : null), members: this.members, selectedMemberId: raw.selectedMember, destinations: this.destinations };
    return this.snapshot;
  }
  subscribe(listener: (snapshot: LegacyExplorationSnapshot) => void) { this.listeners.add(listener); listener(this.getSnapshot()); return () => { this.listeners.delete(listener); }; }
  /** Every change ends here (configure, state, member, travel, enabled, paused, cancel), so it drops the cached snapshot. */
  private invalidate() { this.snapshot = null; this.members = null; this.destinations = null; }
  private publish() { this.invalidate(); const snapshot = this.getSnapshot(); for (const listener of this.listeners) { try { listener(snapshot); } catch { /* A view cannot interrupt scene travel. */ } } }
  setMember(id: string) {
    const changed = this.session?.setMember(id) ?? false;
    const location = this.session?.getSnapshot().location;
    if (changed && this.network && location) { const node = nearestAuthoredNode(this.network, location, 3); if (node) this.resolveReachable(node); }
    this.publish(); return changed;
  }
  travel(id: LandmarkId) { if (!this.enabled || this.paused || !this.reachable.has(id)) return false; const moved = this.session?.travel(id) ?? false; this.publish(); return moved; }
  moveToPoint(point: ExplorationPoint) { if (!this.enabled || this.paused) return false; const moved = this.session?.moveToPoint(point, 2.4) ?? false; this.publish(); return moved; }
  fastTravel(id: LandmarkId) {
    const node = this.routes?.fastTravel?.[id];
    if (!this.enabled || this.paused || !this.routes || !node) return false;
    const arrived = this.session?.fastTravel(id) ?? false;
    if (arrived) this.resolveReachable(this.routes.destinations[id]);
    this.publish(); return arrived;
  }
  cancel() { this.session?.cancel(); this.publish(); }
  setEnabled(enabled: boolean) { this.enabled = enabled; if (!enabled) this.session?.cancel(); this.session?.setPaused(this.paused || !enabled); this.publish(); }
  setPaused(paused: boolean) { this.paused = paused; this.session?.setPaused(paused || !this.enabled); this.publish(); }
  update(delta: number) {
    const previous = this.session?.getSnapshot().status;
    this.session?.update(delta); this.elapsed += delta;
    const current = this.session?.getSnapshot().status;
    if ((this.elapsed >= .1 && current === "moving") || previous !== current) { this.elapsed = 0; this.publish(); }
  }
  dispose() { this.listeners.clear(); this.session?.cancel(); this.session = null; this.invalidate(); }
}
