import type { BannerholdPresentation, LandmarkId } from "../types";
import { getBannerholdBlueprint, createTerrainSampler } from "../environment/blueprint";
import type { BannerholdBlueprint, Route } from "../environment/blueprint/types";
import type { Collider } from "../environment/kernel/mesh";
import type { AuthoredRouteGraph, ExplorationMember, ExplorationPoint, RouteSafety } from "./contract";

const LANDMARK_DESTINATION: Record<LandmarkId, string> = {
  "banner-hall": "manor", "muster-grounds": "muster", "war-record": "archive", "heralds-station": "herald",
};
export function explorationMembers(state: BannerholdPresentation): ExplorationMember[] {
  const members: ExplorationMember[] = [];
  if (state.representative) members.push({ id: state.representative.memberId, name: state.representative.name, status: state.representative.status, role: "representative", available: state.representative.status === "available" });
  for (const member of state.levy) if (!members.some(m => m.id === member.memberId)) members.push({ id: member.memberId, name: member.name, status: member.status, role: "levy", available: member.status === "available" });
  return members;
}
interface Segment { route: Route; index: number; a: ExplorationPoint; b: ExplorationPoint; height: (x: number, z: number, t: number) => number }
function project(p: ExplorationPoint, s: Segment) {
  const dx = s.b.x - s.a.x, dz = s.b.z - s.a.z;
  const t = Math.max(0, Math.min(1, ((p.x - s.a.x) * dx + (p.z - s.a.z) * dz) / (dx * dx + dz * dz || 1)));
  const x = s.a.x + dx * t, z = s.a.z + dz * t;
  return { x, y: s.height(x, z, t), z };
}
function distance(a: ExplorationPoint, b: ExplorationPoint) { return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z); }
/** Routes are authored circulation, not a fabricated navigation plane. Bridge decks retain authored heights. */
export function bannerholdRoutes(state: BannerholdPresentation, colliders: readonly Collider[], blueprint?: BannerholdBlueprint, sampleHeight?: (x:number,z:number)=>number, sampleWater?: (x:number,z:number)=>number) {
  const bp = blueprint ?? getBannerholdBlueprint(state.nationId), terrain = createTerrainSampler(bp.terrain);
  const height = sampleHeight ?? terrain.height, waterLevel = sampleWater ?? terrain.waterLevel;
  const segments: Segment[] = [];
  for (const route of bp.routes) {
    if (route.outer || route.kind === "rail") continue;
    const points = route.points.map(([x, z], i) => ({ x, y: route.grade === "elevated" ? route.deckY?.[i] ?? height(x, z) : height(x, z), z }));
    for (let i = 1; i < points.length; i++) { const a = points[i - 1], b = points[i]; segments.push({ route, index: i - 1, a, b, height: route.grade === "elevated" ? (_x, _z, t) => a.y + (b.y - a.y) * t : (x, z) => height(x, z) }); }
  }
  const onRoute = (p: ExplorationPoint) => {
    const water = waterLevel(p.x, p.z);
    return (!Number.isFinite(water) || p.y >= water - .05) && segments.some(s => distance(p, project(p, s)) <= Math.max(.35, s.route.width / 2 - .18));
  };
  const blocked = (p: ExplorationPoint) => colliders.some(c => {
    if (!c.blocksCamera) return false;
    const dx = p.x - c.center[0], dz = p.z - c.center[2], co = Math.cos(c.yaw), si = Math.sin(c.yaw);
    const x = co * dx - si * dz, z = si * dx + co * dz;
    return Math.abs(x) < c.halfExtents[0] + .16 && Math.abs(z) < c.halfExtents[2] + .16 && p.y + 1.65 > c.center[1] - c.halfExtents[1] && p.y + .2 < c.center[1] + c.halfExtents[1];
  });
  const safety: RouteSafety = {
    isPointSafe: p => [p.x, p.y, p.z].every(Number.isFinite) && onRoute(p) && !blocked(p),
    isSegmentSafe: (a, b) => {
      const n = Math.max(1, Math.ceil(distance(a, b) / .6));
      for (let i = 0; i <= n; i++) { const t = i / n; if (!safety.isPointSafe!({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t })) return false; }
      return true;
    },
  };
  const graph: { nodes: { id: string; position: ExplorationPoint }[]; edges: { from: string; to: string }[] } = { nodes: [], edges: [] };
  const byKey = new Map<string, string>();
  const edges = new Set<string>();
  const add = (p: ExplorationPoint): string | null => {
    if (!safety.isPointSafe!(p)) return null;
    const key = `${p.x.toFixed(3)},${p.y.toFixed(3)},${p.z.toFixed(3)}`;
    const existing = byKey.get(key); if (existing) return existing;
    const id = `walk-${graph.nodes.length}`; graph.nodes.push({ id, position: p }); byKey.set(key, id); return id;
  };
  const connect = (a: string | null, b: string | null) => {
    if (!a || !b || a === b) return;
    const pa = graph.nodes.find(n => n.id === a)!.position, pb = graph.nodes.find(n => n.id === b)!.position;
    const key = [a, b].sort().join("|");
    if (!edges.has(key) && safety.isSegmentSafe!(pa, pb)) { graph.edges.push({ from: a, to: b }); edges.add(key); }
  };
  // Every segment is split at authored endpoints projected onto it, so T junctions
  // connect without jumping across walls or joining a bridge to the road beneath it.
  const junctions: [ExplorationPoint, ExplorationPoint][] = [];
  for (const segment of segments) {
    const cuts = [segment.a, segment.b];
    for (const other of segments) {
      const joins = other.route.grade === segment.route.grade || [other.route.kind, segment.route.kind].some(kind => kind === "stair" || kind === "ramp");
      if (!joins) continue;
      for (const end of [other.a, other.b]) {
        const p = project(end, segment), tolerance = Math.max(other.route.width, segment.route.width) / 2 + .75;
        if (distance(end, p) <= tolerance && safety.isSegmentSafe!(end, p)) { cuts.push(p); junctions.push([end, p]); }
      }
    }
    cuts.sort((a, b) => distance(segment.a, a) - distance(segment.a, b));
    for (let j = 1; j < cuts.length; j++) {
      const a = cuts[j - 1], b = cuts[j], count = Math.max(1, Math.ceil(distance(a, b) / 1.5));
      let previous = add(a);
      for (let i = 1; i <= count; i++) { const t = i / count, x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t, p = project({ x, y: 0, z }, segment), id = add(p); connect(previous, id); previous = id; }
    }
  }
  for (const [a, b] of junctions) connect(add(a), add(b));
  const nearest = (x: number, z: number) => graph.nodes.slice().sort((a, b) => Math.hypot(a.position.x - x, a.position.z - z) - Math.hypot(b.position.x - x, b.position.z - z))[0]?.id ?? "";
  const destinations: Record<string, string> = {};
  for (const [landmark, destination] of Object.entries(LANDMARK_DESTINATION)) {
    const d = bp.destinations.find(v => v.id === destination); if (d) destinations[landmark] = nearest(d.position[0], d.position[1]);
  }
  for (const node of graph.nodes) destinations[`route:${node.id}`] = node.id;
  const gate = bp.destinations.find(d => d.id === "gate") ?? bp.destinations[0];
  const fastTravel = Object.fromEntries(Object.entries(destinations).filter(([id]) => !id.startsWith("route:"))) as Partial<Record<LandmarkId, string>>;
  return { graph: graph as AuthoredRouteGraph, safety, destinations, fastTravel, startNode: destinations["muster-grounds"] || (gate ? nearest(gate.position[0], gate.position[1]) : graph.nodes[0]?.id ?? ""), cameraColliders: colliders, sampleGround: height };
}
