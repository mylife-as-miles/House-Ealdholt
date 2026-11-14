/** Original Crownfall authored-route navigation. Reference principles: see SOURCE.md. */
import type { AuthoredRouteGraph, ExplorationPoint, RouteSafety } from "./contract";

const EPSILON = 1e-7;

export interface RouteLink {
  readonly to: string;
  readonly distance: number;
  readonly cost: number;
}

/** A defensive copy of authored data; this module never creates off-route shortcuts. */
export interface RouteNetwork {
  readonly points: ReadonlyMap<string, Readonly<ExplorationPoint>>;
  readonly links: ReadonlyMap<string, readonly RouteLink[]>;
  readonly safety: RouteSafety;
}

export type RouteNetworkResult =
  | { readonly ok: true; readonly network: RouteNetwork }
  | { readonly ok: false; readonly error: string };

export type AuthoredRouteResult =
  | { readonly ok: true; readonly nodes: readonly string[]; readonly distance: number; readonly cost: number }
  | { readonly ok: false; readonly error: string };

export function pointDistance(a: ExplorationPoint, b: ExplorationPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

export function copyPoint(point: ExplorationPoint): ExplorationPoint {
  return { x: point.x, y: point.y, z: point.z };
}

function validPoint(point: ExplorationPoint): boolean {
  return !!point && Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z);
}

export function routePointSafe(network: RouteNetwork, point: ExplorationPoint): boolean {
  try {
    return validPoint(point) && network.safety.isPointSafe?.(copyPoint(point)) === true;
  } catch {
    return false;
  }
}

export function routeSegmentSafe(network: RouteNetwork, from: ExplorationPoint, to: ExplorationPoint): boolean {
  try {
    return routePointSafe(network, from) && routePointSafe(network, to)
      && network.safety.isSegmentSafe?.(copyPoint(from), copyPoint(to)) === true;
  } catch {
    return false;
  }
}

/**
 * Edges are undirected authored walkways. Both validators are mandatory: an absent
 * source-world navigation/collision model must remain unavailable, not become a
 * generic straight line. A validator exception is a safe refusal.
 */
export function compileRouteNetwork(graph: AuthoredRouteGraph, safety?: RouteSafety): RouteNetworkResult {
  if (typeof safety?.isPointSafe !== "function" || typeof safety?.isSegmentSafe !== "function") {
    return { ok: false, error: "This environment has no verified walking routes." };
  }
  if (!graph || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges) || graph.nodes.length === 0) {
    return { ok: false, error: "This environment has no authored walking routes." };
  }
  const points = new Map<string, Readonly<ExplorationPoint>>();
  const links = new Map<string, RouteLink[]>();
  for (const node of graph.nodes) {
    if (!node || typeof node.id !== "string" || !node.id.trim() || points.has(node.id) || !validPoint(node.position)) {
      return { ok: false, error: "The environment walking route data is invalid." };
    }
    points.set(node.id, Object.freeze(copyPoint(node.position)));
    links.set(node.id, []);
  }
  const seenEdges = new Set<string>();
  for (const edge of graph.edges) {
    if (!edge || typeof edge.from !== "string" || typeof edge.to !== "string") {
      return { ok: false, error: "The environment walking route data is invalid." };
    }
    const from = points.get(edge.from), to = points.get(edge.to);
    const edgeKey = JSON.stringify([edge.from, edge.to].sort());
    if (!from || !to || edge.from === edge.to || seenEdges.has(edgeKey)) {
      return { ok: false, error: "The environment walking route connections are invalid." };
    }
    const distance = pointDistance(from, to);
    const cost = edge.cost ?? distance;
    // Geometric distance is the heuristic, so authored penalties may only add cost.
    if (!Number.isFinite(distance) || distance <= EPSILON || !Number.isFinite(cost) || cost < distance) {
      return { ok: false, error: "The environment walking route distances are invalid." };
    }
    seenEdges.add(edgeKey);
    links.get(edge.from)!.push(Object.freeze({ to: edge.to, distance, cost }));
    links.get(edge.to)!.push(Object.freeze({ to: edge.from, distance, cost }));
  }
  const sortedLinks = new Map<string, readonly RouteLink[]>();
  for (const [id, neighbours] of links) sortedLinks.set(id, Object.freeze(neighbours.sort((a, b) => compareIds(a.to, b.to))));
  // Copy the function references so replacing a caller's options does not change a session.
  return { ok: true, network: Object.freeze({ points, links: sortedLinks, safety: Object.freeze({
    isPointSafe: safety.isPointSafe,
    isSegmentSafe: safety.isSegmentSafe,
  }) }) };
}

function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** A world click may select an existing route node, never invent a new terrain segment. */
export function nearestAuthoredNode(network: RouteNetwork, point: ExplorationPoint, tolerance = 1.5): string | null {
  if (!routePointSafe(network, point) || !Number.isFinite(tolerance) || tolerance < 0 || tolerance > 3) return null;
  let nearest: string | null = null, nearestDistance = Infinity;
  for (const [id, position] of network.points) {
    const distance = pointDistance(point, position);
    if (distance > tolerance || !routePointSafe(network, position)) continue;
    if (distance < nearestDistance || (distance === nearestDistance && (nearest === null || compareIds(id, nearest) < 0))) {
      nearest = id;
      nearestDistance = distance;
    }
  }
  return nearest;
}

/** Deterministic A*: safe authored edges only; blocked edges can never be jumped. */
export function planAuthoredRoute(network: RouteNetwork, fromId: string, toId: string): AuthoredRouteResult {
  const start = network.points.get(fromId), goal = network.points.get(toId);
  if (!start || !goal) return { ok: false, error: "That walking destination is not available." };
  if (!routePointSafe(network, start) || !routePointSafe(network, goal)) {
    return { ok: false, error: "That walking destination is not safe to reach." };
  }
  if (fromId === toId) return { ok: true, nodes: Object.freeze([fromId]), distance: 0, cost: 0 };
  const open = new Set([fromId]);
  const previous = new Map<string, string>();
  const costs = new Map<string, number>([[fromId, 0]]);
  const estimates = new Map<string, number>([[fromId, pointDistance(start, goal)]]);
  const closed = new Set<string>();
  while (open.size) {
    const current = [...open].sort((a, b) => {
      const difference = estimates.get(a)! - estimates.get(b)!;
      return difference || compareIds(a, b);
    })[0];
    if (current === toId) {
      const nodes: string[] = [toId];
      while (previous.has(nodes[0])) nodes.unshift(previous.get(nodes[0])!);
      const distance = nodes.slice(1).reduce((sum, id, index) => sum + pointDistance(network.points.get(nodes[index])!, network.points.get(id)!), 0);
      return { ok: true, nodes: Object.freeze(nodes), distance, cost: costs.get(current)! };
    }
    open.delete(current);
    closed.add(current);
    const point = network.points.get(current)!;
    for (const edge of network.links.get(current) ?? []) {
      if (closed.has(edge.to) || !routeSegmentSafe(network, point, network.points.get(edge.to)!)) continue;
      const nextCost = costs.get(current)! + edge.cost;
      if (nextCost >= (costs.get(edge.to) ?? Infinity)) continue;
      costs.set(edge.to, nextCost);
      estimates.set(edge.to, nextCost + pointDistance(network.points.get(edge.to)!, goal));
      previous.set(edge.to, current);
      open.add(edge.to);
    }
  }
  return { ok: false, error: "No safe authored walking route reaches that destination." };
}
