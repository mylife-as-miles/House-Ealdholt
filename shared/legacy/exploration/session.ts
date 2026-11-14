/** Ephemeral intentional travel only. Never imports, receives or mutates a house save. */
import type { AuthoredRouteGraph, ExplorationPoint, ExplorationSessionSnapshot, RouteSafety } from "./contract";
import { compileRouteNetwork, copyPoint, nearestAuthoredNode, planAuthoredRoute, pointDistance, routePointSafe, routeSegmentSafe } from "./navigation";
import type { RouteNetwork } from "./navigation";

const EPSILON = 1e-7;
const DEFAULT_SPEED = 2.2;
/** Drop excess elapsed time on stalled/hidden frames rather than teleporting to catch up. */
const DEFAULT_MAX_DELTA = 0.1;

export interface ExplorationSessionOptions {
  graph: AuthoredRouteGraph;
  /** Actual currently available member IDs, supplied by the domain adapter. */
  members: readonly string[];
  /** Every member must have an explicitly authored initial node. No nearest-node guessing. */
  starts: Readonly<Record<string, string>>;
  /** Landmark IDs, plus optional `route:${node.id}` entries for world clicks. */
  destinations: Readonly<Record<string, string>>;
  /** Explicitly offered hub relocations. These are never described as walking. */
  fastTravelDestinations?: readonly string[];
  safety?: RouteSafety;
  speed?: number;
  maxDeltaSeconds?: number;
}

export interface ExplorationSession {
  getSnapshot(): ExplorationSessionSnapshot;
  subscribe(listener: (snapshot: ExplorationSessionSnapshot) => void): () => void;
  setMember(id: string): boolean;
  travel(destination: string): boolean;
  fastTravel(destination: string): boolean;
  moveToPoint(point: ExplorationPoint, tolerance?: number): boolean;
  /** Elapsed seconds. Pause does not accumulate elapsed time. */
  update(deltaSeconds: number): void;
  setPaused(paused: boolean): void;
  cancel(): void;
}

interface MemberPosition {
  point: ExplorationPoint;
  node: string | null;
  /** Retained after a mid-edge cancel so the next request cannot cut across terrain. */
  edge: { from: string; to: string } | null;
}

interface TravelLeg {
  from: ExplorationPoint;
  to: ExplorationPoint;
  arrivalNode: string;
  edgeFrom: string;
  edgeTo: string;
}

interface TravelPlan { legs: TravelLeg[]; cost: number; distance: number; anchor: string }
interface ActiveTravel extends TravelPlan { index: number; travelled: number }

function ownValue(record: Readonly<Record<string, string>>, key: string): string | undefined {
  return Object.prototype.hasOwnProperty.call(record, key) ? record[key] : undefined;
}

function planFromPosition(network: RouteNetwork, position: MemberPosition, destinationNode: string): TravelPlan | null {
  const anchors = position.node ? [position.node] : position.edge ? [position.edge.from, position.edge.to] : [];
  const candidates: TravelPlan[] = [];
  for (const anchor of anchors) {
    const route = planAuthoredRoute(network, anchor, destinationNode);
    if (!route.ok) continue;
    const anchorPoint = network.points.get(anchor)!;
    const connectorDistance = pointDistance(position.point, anchorPoint);
    const legs: TravelLeg[] = [];
    let connectorCost = 0;
    if (connectorDistance > EPSILON) {
      if (!position.edge || !routeSegmentSafe(network, position.point, anchorPoint)) continue;
      const sourceEdge = network.links.get(position.edge.from)?.find((edge) => edge.to === position.edge!.to);
      if (!sourceEdge) continue;
      connectorCost = connectorDistance * sourceEdge.cost / sourceEdge.distance;
      legs.push({ from: copyPoint(position.point), to: copyPoint(anchorPoint), arrivalNode: anchor,
        edgeFrom: position.edge.from, edgeTo: position.edge.to });
    }
    for (let index = 1; index < route.nodes.length; index++) {
      const from = route.nodes[index - 1], to = route.nodes[index];
      legs.push({ from: copyPoint(network.points.get(from)!), to: copyPoint(network.points.get(to)!),
        arrivalNode: to, edgeFrom: from, edgeTo: to });
    }
    candidates.push({ legs, cost: connectorCost + route.cost, distance: connectorDistance + route.distance, anchor });
  }
  candidates.sort((a, b) => a.cost - b.cost || (a.anchor < b.anchor ? -1 : a.anchor > b.anchor ? 1 : 0));
  return candidates[0] ?? null;
}

/**
 * Session state has no persistence seam. Reduced ambient motion is intentionally
 * absent: changing that preference must never suppress requested player travel.
 * Only one selected member travels; selection/cancel preserve actual positions.
 */
export function createExplorationSession(options: ExplorationSessionOptions): ExplorationSession {
  const compiled = compileRouteNetwork(options.graph, options.safety);
  const network = compiled.ok ? compiled.network : null;
  const members = [...options.members];
  const destinations = { ...options.destinations };
  const fastTravelDestinations = new Set(options.fastTravelDestinations ?? []);
  const speed = options.speed ?? DEFAULT_SPEED;
  const maxDelta = options.maxDeltaSeconds ?? DEFAULT_MAX_DELTA;
  let configurationError = compiled.ok === false ? compiled.error : null;
  if (members.some((id) => typeof id !== "string" || !id.trim()) || new Set(members).size !== members.length) {
    configurationError = "The available exploration member list is invalid.";
  }
  if (!Number.isFinite(speed) || speed <= 0 || !Number.isFinite(maxDelta) || maxDelta <= 0 || maxDelta > DEFAULT_MAX_DELTA) {
    configurationError = "The exploration movement settings are invalid.";
  }
  const positions = new Map<string, MemberPosition>();
  if (network) for (const id of members) {
    const node = ownValue(options.starts, id), point = node ? network.points.get(node) : null;
    if (point && routePointSafe(network, point)) positions.set(id, { point: copyPoint(point), node: node!, edge: null });
  }
  let selectedMember = members[0] ?? null;
  let destination: string | null = null;
  let status: ExplorationSessionSnapshot["status"] = "idle";
  let error: string | null = configurationError;
  let progress = 0;
  let paused = false;
  let active: ActiveTravel | null = null;
  const listeners = new Set<(snapshot: ExplorationSessionSnapshot) => void>();

  function currentPosition(): MemberPosition | null { return selectedMember ? positions.get(selectedMember) ?? null : null; }
  if (!selectedMember || !currentPosition() || configurationError) {
    status = "unavailable";
    error ??= selectedMember ? "This member has no verified starting position." : "No available house member can explore.";
  }

  function makeSnapshot(): ExplorationSessionSnapshot {
    const point = currentPosition()?.point;
    return Object.freeze({ status, selectedMember, destination, location: point ? Object.freeze(copyPoint(point)) : null,
      progress, error, paused });
  }
  let snapshot = makeSnapshot();

  function publish(): void {
    const next = makeSnapshot();
    if (next.status === snapshot.status && next.selectedMember === snapshot.selectedMember && next.destination === snapshot.destination
      && next.progress === snapshot.progress && next.error === snapshot.error && next.paused === snapshot.paused
      && next.location?.x === snapshot.location?.x && next.location?.y === snapshot.location?.y && next.location?.z === snapshot.location?.z) return;
    snapshot = next;
    for (const listener of [...listeners]) {
      // A view subscriber cannot interrupt authoritative travel state or other views.
      try { listener(snapshot); } catch { /* The subscribing adapter owns its render errors. */ }
    }
  }

  function unavailable(message: string, requestedDestination: string | null = null): false {
    active = null;
    status = "unavailable";
    error = message;
    destination = requestedDestination;
    progress = 0;
    publish();
    return false;
  }

  function travel(requestedDestination: string): boolean {
    if (configurationError || !network) return unavailable(configurationError ?? "This environment has no verified walking routes.", requestedDestination);
    const position = currentPosition();
    if (!selectedMember || !position) return unavailable("This member has no verified starting position.", requestedDestination);
    const targetNode = ownValue(destinations, requestedDestination);
    if (!targetNode || !network.points.has(targetNode)) return unavailable("That walking destination is not available.", requestedDestination);
    if (!routePointSafe(network, position.point)) return unavailable("This member's walking position is no longer safe.", requestedDestination);
    const plan = planFromPosition(network, position, targetNode);
    if (!plan) return unavailable("No safe authored walking route reaches that destination.", requestedDestination);
    destination = requestedDestination;
    error = null;
    progress = plan.distance <= EPSILON ? 1 : 0;
    status = plan.distance <= EPSILON ? "arrived" : "moving";
    active = status === "moving" ? { ...plan, index: 0, travelled: 0 } : null;
    publish();
    return true;
  }

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    setMember(id) {
      if (!members.includes(id)) return unavailable("That house member is not available to explore.");
      active = null;
      selectedMember = id;
      destination = null;
      progress = 0;
      error = configurationError ?? (positions.has(id) ? null : "This member has no verified starting position.");
      status = error ? "unavailable" : "idle";
      publish();
      return !error;
    },
    travel,
    fastTravel(requestedDestination) {
      // A paused experience cannot relocate; preserve its pending journey for Resume.
      if (paused) return false;
      if (configurationError || !network) return unavailable(configurationError ?? "This environment has no verified travel destinations.", requestedDestination);
      if (!fastTravelDestinations.has(requestedDestination)) return unavailable("Fast travel is not available to that destination.", requestedDestination);
      const position = currentPosition(), node = ownValue(destinations, requestedDestination);
      const point = node ? network.points.get(node) : null;
      if (!position || !point || !routePointSafe(network, position.point) || !routePointSafe(network, point)) {
        return unavailable("That fast travel destination is not safe to reach.", requestedDestination);
      }
      // Explicit relocation has no invented walking interval or route-completion animation.
      position.point = copyPoint(point);
      position.node = node!;
      position.edge = null;
      active = null;
      destination = requestedDestination;
      status = "arrived";
      progress = 1;
      error = null;
      publish();
      return true;
    },
    moveToPoint(point, tolerance = 1.5) {
      if (!network || configurationError) return unavailable(configurationError ?? "This environment has no verified walking routes.");
      const node = nearestAuthoredNode(network, point, tolerance);
      if (!node) return unavailable("Choose a point on a verified walking route.");
      return travel(`route:${node}`);
    },
    update(deltaSeconds) {
      if (!network || !active || paused || !Number.isFinite(deltaSeconds) || deltaSeconds <= 0) return;
      const position = currentPosition();
      if (!position) { unavailable("This member has no verified walking position.", destination); return; }
      let budget = speed * Math.min(deltaSeconds, maxDelta);
      while (active && active.index < active.legs.length && budget > 0) {
        const leg = active.legs[active.index];
        if (!routeSegmentSafe(network, position.point, leg.to)) {
          unavailable("The walking route is no longer safe. Choose another destination.", destination);
          return;
        }
        const remaining = pointDistance(position.point, leg.to);
        if (remaining <= budget + EPSILON) {
          position.point = copyPoint(leg.to);
          position.node = leg.arrivalNode;
          position.edge = null;
          active.travelled += remaining;
          active.index++;
          budget = Math.max(0, budget - remaining);
        } else {
          const fraction = budget / remaining;
          const next = { x: position.point.x + (leg.to.x - position.point.x) * fraction,
            y: position.point.y + (leg.to.y - position.point.y) * fraction,
            z: position.point.z + (leg.to.z - position.point.z) * fraction };
          if (!routePointSafe(network, next)) {
            unavailable("The walking route is no longer safe. Choose another destination.", destination);
            return;
          }
          position.point = next;
          position.node = null;
          position.edge = { from: leg.edgeFrom, to: leg.edgeTo };
          active.travelled += budget;
          budget = 0;
        }
        progress = Math.min(1, active.travelled / active.distance);
      }
      if (active && active.index === active.legs.length) { active = null; status = "arrived"; progress = 1; }
      publish();
    },
    setPaused(value) { paused = value; publish(); },
    cancel() {
      active = null;
      destination = null;
      progress = 0;
      error = configurationError ?? (currentPosition() ? null : "This member has no verified walking position.");
      status = error ? "unavailable" : "idle";
      publish();
    },
  };
}
