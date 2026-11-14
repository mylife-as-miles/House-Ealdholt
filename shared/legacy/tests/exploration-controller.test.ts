import { test } from "node:test";
import assert from "node:assert/strict";
import { environmentFixture } from "../environment/fixtures";
import { buildBannerhold } from "../environment/build/buildBannerhold";
import { bannerholdRoutes } from "../exploration/bannerhold";
import { SceneExplorationController } from "../exploration/controller";
import { compileRouteNetwork } from "../exploration/navigation";
import { LEGACY_LANDMARKS } from "../environment-contract";

for (const nation of ["korvenia", "solforiz", "aethelgard", "kwind-09"] as const) {
  test(`${nation} exploration uses safe authored ground and keeps house state unchanged`, () => {
    const state = environmentFixture("founded", nation), before = JSON.stringify(state);
    const build = buildBannerhold({ state, quality: "desktop-low" });
    const routes = bannerholdRoutes(state, build.colliders);
    assert.equal(compileRouteNetwork(routes.graph, routes.safety).ok, true);
    assert.ok(routes.graph.nodes.length > 20);
    const nodes = new Map(routes.graph.nodes.map(n => [n.id, n.position]));
    for (const edge of routes.graph.edges) assert.equal(routes.safety.isSegmentSafe!(nodes.get(edge.from)!, nodes.get(edge.to)!), true);
    const controller = new SceneExplorationController(state);
    controller.configure(state, routes); controller.setEnabled(true);
    assert.equal(controller.getSnapshot().available, true);
    assert.deepEqual(controller.getSnapshot().members.map(m => m.id), ["fixture-member-1", "fixture-member-2", "fixture-member-3"]);
    for (const id of LEGACY_LANDMARKS) {
      const destination = controller.getSnapshot().destinations.find(d => d.id === id)!;
      assert.equal(destination.available, true);
      assert.equal(destination.travelMode === "fast-travel" ? controller.fastTravel(id) : controller.travel(id), true);
      for (let frame = 0; frame < 3000 && controller.getSnapshot().status === "moving"; frame++) controller.update(.1);
      assert.equal(controller.getSnapshot().status, "arrived");
      assert.equal(controller.getSnapshot().destination, id);
      assert.equal(routes.safety.isPointSafe!(controller.getSnapshot().location!), true);
    }
    const at = controller.getSnapshot().location;
    assert.equal(controller.moveToPoint({ x: 1e8, y: 0, z: 1e8 }), false);
    assert.deepEqual(controller.getSnapshot().location, at);
    assert.equal(JSON.stringify(state), before);
    controller.dispose();
  });
}

test("unsupported source and captive party have truthful unavailable states", () => {
  const state = environmentFixture("founded"), controller = new SceneExplorationController(state);
  controller.configure(state, null);
  assert.equal(controller.getSnapshot().available, false);
  assert.match(controller.getSnapshot().unavailableReason!, /verified walking routes/);
  assert.equal(controller.travel("muster-grounds"), false);
  const unavailable = { ...state, representative: state.representative ? { ...state.representative, status: "captive" as const } : null, levy: state.levy.map(m => ({ ...m, status: "captive" as const })) };
  controller.configure(unavailable, bannerholdRoutes(unavailable, []));
  assert.equal(controller.getSnapshot().available, false);
  assert.equal(controller.getSnapshot().selectedMemberId, null);
});

test("pause, cancel and party selection preserve safe ephemeral movement", () => {
  const state = environmentFixture("founded"), controller = new SceneExplorationController(state);
  const build = buildBannerhold({ state, quality: "desktop-low" });
  controller.configure(state, bannerholdRoutes(state, build.colliders)); controller.setEnabled(true);
  assert.equal(controller.travel("banner-hall"), true);
  controller.update(.1); const position = controller.getSnapshot().location;
  controller.setPaused(true); controller.update(5);
  assert.deepEqual(controller.getSnapshot().location, position);
  controller.setPaused(false); controller.cancel();
  assert.deepEqual(controller.getSnapshot().location, position);
  assert.equal(controller.setMember("fixture-member-2"), true);
  assert.equal(controller.setMember("fixture-member-1"), true);
  assert.deepEqual(controller.getSnapshot().location, position);
});

test("fast travel preserves each member's hub and refreshes honest walk/travel choices", () => {
  const state = environmentFixture("founded"), controller = new SceneExplorationController(state);
  const graph = { nodes: [{ id: "a", position: { x: 0, y: 0, z: 0 } }, { id: "a1", position: { x: 1, y: 0, z: 0 } }, { id: "b", position: { x: 100, y: 0, z: 0 } }, { id: "b1", position: { x: 101, y: 0, z: 0 } }], edges: [{ from: "a", to: "a1" }, { from: "b", to: "b1" }] };
  controller.configure(state, { graph, safety: { isPointSafe: () => true, isSegmentSafe: (a, b) => Math.abs(a.x - b.x) <= 1 }, startNode: "a", destinations: { "muster-grounds": "a1", "banner-hall": "b1", "war-record": "a", "heralds-station": "b" }, fastTravel: { "banner-hall": "b", "heralds-station": "b", "muster-grounds": "a", "war-record": "a" } });
  controller.setEnabled(true);
  assert.equal(controller.getSnapshot().destinations.find(d => d.id === "banner-hall")!.travelMode, "fast-travel");
  assert.equal(controller.fastTravel("banner-hall"), true);
  assert.equal(controller.getSnapshot().location!.x, 101);
  controller.setMember("fixture-member-2");
  assert.equal(controller.getSnapshot().location!.x, 0);
  assert.equal(controller.getSnapshot().destinations.find(d => d.id === "banner-hall")!.travelMode, "fast-travel");
  controller.setMember("fixture-member-1");
  assert.equal(controller.getSnapshot().location!.x, 101);
  assert.equal(controller.getSnapshot().destinations.find(d => d.id === "banner-hall")!.travelMode, "walk");
  assert.equal(controller.getSnapshot().destinations.find(d => d.id === "muster-grounds")!.travelMode, "fast-travel");
});

test("renderers reading the snapshot every frame get one object per change, never per call", () => {
  const state = environmentFixture("founded"), controller = new SceneExplorationController(state);
  const build = buildBannerhold({ state, quality: "desktop-low" });
  controller.configure(state, bannerholdRoutes(state, build.colliders)); controller.setEnabled(true);
  const idle = controller.getSnapshot();
  for (let frame = 0; frame < 5; frame++) { controller.update(1 / 60); assert.equal(controller.getSnapshot(), idle, "an idle frame allocates no snapshot"); }
  const seen: unknown[] = []; const unsubscribe = controller.subscribe(snapshot => seen.push(snapshot));
  assert.equal(seen[0], idle);
  assert.equal(controller.travel("banner-hall"), true);
  const departed = controller.getSnapshot();
  assert.notEqual(departed, idle); assert.equal(departed.status, "moving"); assert.equal(seen.at(-1), departed);
  controller.update(.016);
  const walking = controller.getSnapshot();
  assert.notEqual(walking, departed, "a moved figure gets a new snapshot");
  assert.notDeepEqual(walking.location, departed.location);
  assert.equal(controller.getSnapshot(), walking);
  assert.equal(walking.members, departed.members, "members are kept while only the location moves");
  assert.equal(walking.destinations, departed.destinations);
  controller.setPaused(true);
  const paused = controller.getSnapshot();
  assert.equal(paused.paused, true); assert.deepEqual(paused.location, walking.location); assert.equal(seen.at(-1), paused);
  controller.update(1); assert.deepEqual(controller.getSnapshot().location, paused.location, "a paused session does not move");
  controller.setPaused(false); controller.cancel();
  assert.equal(controller.getSnapshot().status, "idle"); assert.equal(controller.getSnapshot().paused, false);
  const captive = { ...state, levy: state.levy.map(m => ({ ...m, status: "captive" as const })) };
  controller.setState(captive);
  const levy = controller.getSnapshot().members.filter(m => m.role === "levy");
  assert.ok(levy.length > 0 && levy.every(m => m.status === "captive" && !m.available), "a state change rebuilds members");
  unsubscribe(); controller.dispose();
  assert.equal(controller.getSnapshot().available, false, "dispose drops the cached snapshot");
});
