import assert from "node:assert/strict";
import test from "node:test";
import type { AuthoredRouteGraph, RouteSafety } from "../exploration/contract";
import { compileRouteNetwork, nearestAuthoredNode, planAuthoredRoute } from "../exploration/navigation";

const safe: RouteSafety = { isPointSafe: () => true, isSegmentSafe: () => true };
const graph: AuthoredRouteGraph = {
  nodes: [
    { id: "a", position: { x: 0, y: 0, z: 0 } },
    { id: "b", position: { x: 3, y: 0, z: 0 } },
    { id: "c", position: { x: 3, y: 2, z: 4 } },
    { id: "d", position: { x: 0, y: 0, z: 4 } },
    { id: "isolated", position: { x: 20, y: 0, z: 0 } },
  ],
  edges: [{ from: "a", to: "b" }, { from: "b", to: "c" }, { from: "c", to: "d" }],
};

function network(input = graph, safety: RouteSafety = safe) {
  const result = compileRouteNetwork(input, safety);
  assert.ok(result.ok);
  return result.network;
}

test("A* follows authored routes and terrain heights instead of a shorter direct terrain line", () => {
  const result = planAuthoredRoute(network(), "a", "d");
  assert.ok(result.ok);
  assert.deepEqual(result.nodes, ["a", "b", "c", "d"]);
  assert.equal(result.distance, 3 + Math.sqrt(20) + Math.sqrt(13));
  assert.deepEqual(planAuthoredRoute(network(), "d", "a").ok && planAuthoredRoute(network(), "d", "a"), {
    ok: true, nodes: ["d", "c", "b", "a"], distance: Math.sqrt(13) + Math.sqrt(20) + 3, cost: Math.sqrt(13) + Math.sqrt(20) + 3,
  });
});

test("disconnected, unknown and blocked destinations cannot acquire an invented path", () => {
  assert.equal(planAuthoredRoute(network(), "a", "isolated").ok, false);
  assert.equal(planAuthoredRoute(network(), "a", "missing").ok, false);
  const blocked = network(graph, { ...safe, isSegmentSafe: (a, b) => a.y === b.y });
  assert.equal(planAuthoredRoute(blocked, "a", "c").ok, false);
  const unsafe = network(graph, { ...safe, isPointSafe: (point) => point.z !== 4 });
  assert.equal(planAuthoredRoute(unsafe, "a", "d").ok, false);
});

test("route search is deterministic under authored data ordering and respects explicit penalties", () => {
  const diamond: AuthoredRouteGraph = {
    nodes: [{ id: "start", position: { x: 0, y: 0, z: 0 } }, { id: "left", position: { x: -1, y: 0, z: 1 } },
      { id: "right", position: { x: 1, y: 0, z: 1 } }, { id: "end", position: { x: 0, y: 0, z: 2 } }],
    edges: [{ from: "start", to: "right" }, { from: "right", to: "end" }, { from: "start", to: "left" }, { from: "left", to: "end" }],
  };
  const first = planAuthoredRoute(network(diamond), "start", "end");
  assert.deepEqual(first, planAuthoredRoute(network({ nodes: [...diamond.nodes].reverse(), edges: [...diamond.edges].reverse() }), "start", "end"));
  assert.ok(first.ok);
  assert.deepEqual(first.nodes, ["start", "left", "end"]);
  const penalised = { ...diamond, edges: diamond.edges.map((edge) => edge.to === "left" ? { ...edge, cost: 10 } : edge) };
  const next = planAuthoredRoute(network(penalised), "start", "end");
  assert.ok(next.ok);
  assert.deepEqual(next.nodes, ["start", "right", "end"]);
});

test("missing safety, thrown validators and malformed route data fail safely", () => {
  assert.equal(compileRouteNetwork(graph).ok, false);
  assert.equal(compileRouteNetwork(graph, { isPointSafe: () => true }).ok, false);
  assert.equal(planAuthoredRoute(network(graph, { isPointSafe: () => { throw new Error("not ready"); }, isSegmentSafe: () => true }), "a", "b").ok, false);
  for (const invalid of [
    { ...graph, nodes: [...graph.nodes, graph.nodes[0]] },
    { ...graph, nodes: [{ id: "bad", position: { x: NaN, y: 0, z: 0 } }] },
    { ...graph, edges: [{ from: "a", to: "missing" }] },
    { ...graph, edges: [{ from: "a", to: "a" }] },
    { ...graph, edges: [{ from: "a", to: "b", cost: 1 }] },
    { ...graph, edges: [{ from: "a", to: "b", cost: Infinity }] },
    { ...graph, edges: [{ from: "a", to: "b" }, { from: "b", to: "a" }] },
  ]) assert.equal(compileRouteNetwork(invalid, safe).ok, false);
});

test("world clicks select only safe nearby authored nodes with a bounded tolerance", () => {
  const routes = network();
  assert.equal(nearestAuthoredNode(routes, { x: 0.2, y: 0, z: 0.1 }), "a");
  assert.equal(nearestAuthoredNode(routes, { x: 100, y: 0, z: 100 }), null);
  assert.equal(nearestAuthoredNode(routes, { x: 0, y: 10, z: 0 }), null, "height is part of the distance");
  assert.equal(nearestAuthoredNode(routes, { x: 100, y: 0, z: 100 }, 1000), null, "caller cannot remove the snap bound");
  assert.equal(nearestAuthoredNode(routes, { x: NaN, y: 0, z: 0 }), null);
  assert.equal(nearestAuthoredNode(network(graph, { ...safe, isPointSafe: (p) => p.x === 0 }), { x: 0.2, y: 0, z: 0 }), null, "unsafe clicks are rejected even near a safe node");
});

test("compiled routes copy authored positions and edges without writing to the source", () => {
  const input = structuredClone(graph);
  const before = JSON.stringify(input);
  const routes = network(input);
  assert.equal(JSON.stringify(input), before);
  input.nodes[0].position.x = 999;
  (input.edges as { from: string; to: string }[]).length = 0;
  const result = planAuthoredRoute(routes, "a", "d");
  assert.ok(result.ok);
  assert.deepEqual(result.nodes, ["a", "b", "c", "d"]);
  assert.equal(routes.points.get("a")!.x, 0);
});
