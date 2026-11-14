import assert from "node:assert/strict";
import test from "node:test";
import type { AuthoredRouteGraph, RouteSafety } from "../exploration/contract";
import { createExplorationSession } from "../exploration/session";
import type { ExplorationSessionOptions } from "../exploration/session";

const graph: AuthoredRouteGraph = {
  nodes: [{ id: "a", position: { x: 0, y: 0, z: 0 } }, { id: "b", position: { x: 3, y: 0, z: 0 } },
    { id: "c", position: { x: 3, y: 0, z: 4 } }, { id: "separate", position: { x: 20, y: 0, z: 0 } }],
  edges: [{ from: "a", to: "b" }, { from: "b", to: "c" }],
};
const safety: RouteSafety = { isPointSafe: () => true, isSegmentSafe: () => true };
function options(extra: Partial<ExplorationSessionOptions> = {}): ExplorationSessionOptions {
  return { graph, members: ["actual-pawn-a", "actual-pawn-b"], starts: { "actual-pawn-a": "a", "actual-pawn-b": "b" },
    destinations: { hall: "a", muster: "c", blocked: "separate", "route:a": "a", "route:b": "b", "route:c": "c" },
    safety, speed: 2, ...extra };
}

test("travel is intentional continuous movement, with no delayed forced arrival or stall teleport", () => {
  const session = createExplorationSession(options());
  assert.equal(session.travel("muster"), true);
  session.update(300);
  assert.equal(session.getSnapshot().status, "moving");
  assert.equal(session.getSnapshot().location!.x, 0.2, "a stalled update is clamped to 100ms");
  assert.equal(session.getSnapshot().location!.z, 0);
  for (let i = 0; i < 14; i++) session.update(0.1);
  assert.ok(Math.abs(session.getSnapshot().location!.z) < 1e-6, "the member reaches the authored corner before turning");
  for (let i = 0; i < 20; i++) session.update(0.1);
  assert.deepEqual(session.getSnapshot().location, { x: 3, y: 0, z: 4 });
  assert.equal(session.getSnapshot().status, "arrived");
  assert.equal(session.getSnapshot().progress, 1);
  assert.equal(session.getSnapshot().destination, "muster");
});

test("pause freezes real travel and resumes without accumulated catch-up time", () => {
  const session = createExplorationSession(options());
  session.travel("muster");
  session.update(0.1);
  session.setPaused(true);
  const paused = session.getSnapshot();
  session.update(60);
  assert.equal(session.getSnapshot(), paused);
  assert.equal(paused.status, "moving");
  session.setPaused(false);
  session.update(0.1);
  assert.equal(session.getSnapshot().location!.x, 0.4);
});

test("cancel and replan from mid-edge preserve the actual position and cannot take a diagonal shortcut", () => {
  const session = createExplorationSession(options());
  session.travel("muster");
  for (let i = 0; i < 5; i++) session.update(0.1);
  const position = session.getSnapshot().location;
  session.cancel();
  assert.equal(session.getSnapshot().status, "idle");
  assert.deepEqual(session.getSnapshot().location, position);
  session.update(10);
  assert.deepEqual(session.getSnapshot().location, position);
  assert.equal(session.travel("muster"), true);
  session.update(0.1);
  assert.equal(session.getSnapshot().location!.z, 0);
  assert.ok(session.getSnapshot().location!.x > position!.x);
  session.cancel();
  assert.equal(session.travel("hall"), true);
  session.update(0.1);
  assert.equal(session.getSnapshot().location!.z, 0);
  assert.ok(Math.abs(session.getSnapshot().location!.x - position!.x) < 1e-6, "reverse uses the known edge");
});

test("member selection only accepts supplied IDs and preserves distinct session positions", () => {
  const session = createExplorationSession(options());
  session.travel("muster");
  session.update(0.1);
  assert.equal(session.setMember("actual-pawn-b"), true);
  assert.deepEqual(session.getSnapshot().location, { x: 3, y: 0, z: 0 });
  assert.equal(session.getSnapshot().status, "idle");
  assert.equal(session.setMember("actual-pawn-a"), true);
  assert.deepEqual(session.getSnapshot().location, { x: 0.2, y: 0, z: 0 });
  assert.equal(session.setMember("invented-hero"), false);
  assert.equal(session.getSnapshot().selectedMember, "actual-pawn-a");
  assert.equal(session.getSnapshot().status, "unavailable");
});

test("unknown, disconnected, unsafe and unavailable starting positions cannot claim arrival", () => {
  const session = createExplorationSession(options());
  for (const id of ["missing", "blocked"]) {
    assert.equal(session.travel(id), false);
    assert.equal(session.getSnapshot().status, "unavailable");
    assert.equal(session.getSnapshot().progress, 0);
    assert.deepEqual(session.getSnapshot().location, { x: 0, y: 0, z: 0 });
  }
  assert.equal(createExplorationSession(options({ starts: {} })).travel("muster"), false);
  assert.equal(createExplorationSession(options({ safety: undefined })).travel("muster"), false);
  assert.equal(createExplorationSession(options({ members: [] })).getSnapshot().selectedMember, null);
  const absent = createExplorationSession(options({ members: ["unplaced"], starts: {} }));
  assert.equal(absent.getSnapshot().selectedMember, "unplaced", "HUD can still identify an unavailable actual member");
  assert.equal(absent.getSnapshot().location, null);
});

test("a route becoming blocked stops movement at the real position without an arrival callback", () => {
  let open = true;
  const session = createExplorationSession(options({ safety: { ...safety, isSegmentSafe: () => open } }));
  session.travel("muster");
  session.update(0.1);
  const before = session.getSnapshot().location;
  open = false;
  session.update(0.1);
  assert.equal(session.getSnapshot().status, "unavailable");
  assert.deepEqual(session.getSnapshot().location, before);
  assert.notEqual(session.getSnapshot().progress, 1);
});

test("click-to-move only uses registered authored node destinations and rejects off-route requests", () => {
  const session = createExplorationSession(options());
  assert.equal(session.moveToPoint({ x: 3.1, y: 0, z: 0.1 }), true);
  assert.equal(session.getSnapshot().destination, "route:b");
  session.update(0.1);
  assert.equal(session.getSnapshot().location!.z, 0);
  assert.equal(session.moveToPoint({ x: 10, y: 0, z: 10 }), false);
  assert.equal(session.getSnapshot().status, "unavailable");
  const withoutNodeDestinations = createExplorationSession(options({ destinations: { muster: "c" } }));
  assert.equal(withoutNodeDestinations.moveToPoint({ x: 3, y: 0, z: 0 }), false);
});

test("invalid deltas do not move, emit or corrupt progress; arrival is stable", () => {
  const session = createExplorationSession(options());
  session.travel("muster");
  const before = session.getSnapshot();
  for (const dt of [NaN, Infinity, -1, 0]) session.update(dt);
  assert.equal(session.getSnapshot(), before);
  session.cancel();
  session.travel("hall");
  assert.equal(session.getSnapshot().status, "arrived");
  const arrival = session.getSnapshot();
  session.update(1);
  assert.equal(session.getSnapshot(), arrival);
});

test("session owns copies of caller data; immutable view snapshots and subscription disposal preserve state", () => {
  const input = options({ graph: structuredClone(graph) });
  const before = JSON.stringify(input);
  Object.freeze(input.members);
  Object.freeze(input.starts);
  Object.freeze(input.destinations);
  const session = createExplorationSession(input);
  let events = 0;
  const unsubscribe = session.subscribe(() => { events++; });
  session.subscribe(() => { throw new Error("broken view"); });
  assert.equal(session.travel("muster"), true);
  session.update(0.1);
  assert.equal(events, 2);
  assert.equal(JSON.stringify(input), before);
  assert.throws(() => { session.getSnapshot().location!.x = 100; }, TypeError);
  unsubscribe();
  session.update(0.1);
  assert.equal(events, 2);
  const fresh = createExplorationSession(input);
  assert.deepEqual(fresh.getSnapshot().location, { x: 0, y: 0, z: 0 }, "positions are session-only, never persisted into starts");
});

test("explicit fast travel requires an allowlisted safe node and preserves other members' positions", () => {
  const session = createExplorationSession(options({ fastTravelDestinations: ["blocked"] }));
  assert.equal(session.fastTravel("muster"), false, "ordinary route destinations are not implicitly fast travel");
  session.cancel();
  session.travel("muster");
  session.update(.1);
  session.setMember("actual-pawn-b");
  assert.equal(session.fastTravel("blocked"), true, "an explicit hub hop may cross disconnected routes");
  assert.deepEqual(session.getSnapshot().location, { x: 20, y: 0, z: 0 });
  assert.equal(session.getSnapshot().status, "arrived");
  assert.equal(session.getSnapshot().progress, 1);
  session.setMember("actual-pawn-a");
  assert.deepEqual(session.getSnapshot().location, { x: .2, y: 0, z: 0 }, "another member retains their actual session position");
});

test("paused or newly unsafe fast travel never relocates or claims arrival", () => {
  let safe = true;
  const session = createExplorationSession(options({ fastTravelDestinations: ["blocked"],
    safety: { ...safety, isPointSafe: point => point.x < 10 || safe } }));
  session.travel("muster");
  session.update(.1);
  session.setPaused(true);
  const paused = session.getSnapshot();
  assert.equal(session.fastTravel("blocked"), false);
  assert.equal(session.getSnapshot(), paused, "the pending journey survives until explicit Resume");
  session.setPaused(false);
  safe = false;
  assert.equal(session.fastTravel("blocked"), false);
  assert.deepEqual(session.getSnapshot().location, paused.location);
  assert.equal(session.getSnapshot().status, "unavailable");
});
