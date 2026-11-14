import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PHOENIX_HOVER_SHOT, PHOENIX_SIZE, phoenixArc, phoenixDisplay, phoenixEvents, phoenixFlap, phoenixFrame, phoenixPosition, phoenixShotAt, phoenixShots,
  phoenixTimeAtArc, phoenixTimeline, phoenixVelocity, phoenixWingbeats, planPhoenix, type PhoenixPlan, type PhoenixPlanInput,
} from "../../web/src/scene/rites/phoenix/phoenixFlight";
import { phoenixMoment, phoenixParticles, sealPoint } from "../../web/src/scene/rites/phoenix/phoenixPlan";
import { PHOENIX_BUDGET, lockTalons, phoenixPose, plumeLayout } from "../../web/src/scene/rites/phoenix/phoenixForm";
import { riteShot } from "../../web/src/scene/rites/riteShot";

type P = { x: number; y: number; z: number };
const TILE = 1.02;
const square = (file: number, rank: number) => ({ x: (file - 3.5) * TILE, z: (3.5 - (rank - 1)) * TILE });
const at = (file: number, rank: number, y: number): P => ({ ...square(file, rank), y });
const distance = (a: P, b: P) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const flatDistance = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z);
const dot = (a: P, b: P) => a.x * b.x + a.y * b.y + a.z * b.z;
const socketAt = (plan: PhoenixPlan, t: number): P => { const s = phoenixPose(plan, phoenixWingbeats(plan.timeline), t).socket; return { x: s[0], y: s[1], z: s[2] }; };
/** A plan as the rite makes it: planned, then its strike moved so the talons close on the chest. */
const planned = (p: PhoenixPlanInput) => { const plan = planPhoenix(p); lockTalons(plan, phoenixWingbeats(plan.timeline)); return plan; };

/** The white Queen on d1 takes on d7, the player behind White; the opening's other pieces still stand. */
const start: { x: number; z: number }[] = [];
for (let file = 0; file < 8; file += 1) for (const rank of [1, 2, 7, 8]) start.push(square(file, rank));
const input = (over: Partial<PhoenixPlanInput> = {}): PhoenixPlanInput => {
  const queen = at(3, 1, 0), stone = at(3, 7, 0);
  return {
    queen, stone, chest: { ...stone, y: 0.62 }, viewer: { x: 0, y: 6.4, z: 8.6 },
    standing: start.filter((s) => flatDistance(s, stone) > 0.1 && flatDistance(s, queen) > 0.1).concat([{ x: queen.x, z: queen.z }]),
    boardTop: 0, tile: TILE, hall: 11, seed: 7, brief: false, ...over,
  };
};

/** Plans from awkward places: a corner victim, a victim beside the Queen, a crowded square, the player behind Black. */
const awkward: PhoenixPlanInput[] = [
  input(),
  input({ stone: at(0, 8, 0), chest: at(0, 8, 0.6) }),
  input({ stone: at(4, 2, 0), chest: at(4, 2, 0.7), queen: at(3, 1, 0) }),
  input({ viewer: { x: 0, y: 6.4, z: -8.6 }, queen: at(3, 8, 0), stone: at(3, 2, 0), chest: at(3, 2, 0.62) }),
  input({ stone: at(7, 5, 0), chest: at(7, 5, 0.9), standing: [square(6, 5), square(7, 4), square(7, 6), square(6, 6), square(6, 4)] }),
  input({ brief: true }),
];

test("the rite keeps its time: the talons close between one and a half and three seconds, the body is down by seven, the sun out with it", () => {
  for (const brief of [false, true]) {
    const T = phoenixTimeline(brief);
    const order = [T.gather[0], T.pen[0], T.pen[1], T.flare, T.burst[1], T.open[1], T.dive[0], T.strikeAt, T.carry[1], T.release, T.sunburst, T.gutter[0], T.gutter[1], T.duration];
    for (let i = 1; i < order.length; i += 1) assert.ok(order[i] >= order[i - 1], `beat ${i} of ${brief ? "brief" : "full"} is out of order`);
    assert.ok(T.strikeAt >= 1.5 && T.strikeAt <= 3, `strike at ${T.strikeAt}`);
    assert.ok(T.duration <= 8, `done at ${T.duration}`);
    assert.ok(T.burst[0] < T.flare + 0.05 && T.burst[0] > T.pen[1] - 0.05, "the bird comes as the seal is whole and flares");
    assert.equal(T.sunburst, T.leave[1]);
    assert.equal(T.strikeAt, T.dive[1]);
    assert.equal(T.release, T.hover[1]);
    // The body is held long enough for the fire to catch on it and be seen burning in the grip.
    if (!brief) assert.ok(T.release - T.strikeAt >= 2, `held ${(T.release - T.strikeAt).toFixed(2)} s`);
  }
  assert.ok(phoenixTimeline(true).duration < phoenixTimeline(false).duration, "the brief form is shorter");
  for (const p of awkward.slice(0, 5)) {
    const plan = planPhoenix(p), T = plan.timeline;
    // The body falls from the hold to its stone, as the match drops it: down between five and seven seconds from the call.
    const fall = Math.sqrt((2 * (plan.hold.y - (p.chest.y - p.stone.y) - p.stone.y)) / 9.8);
    assert.ok(Math.abs(plan.landAt - (T.release + fall)) < 1e-9);
    assert.ok(plan.landAt >= 5 && plan.landAt <= 7, `down at ${plan.landAt.toFixed(2)}`);
    // The match hands the camera on a quarter of a second after the body is down: the sun has guttered out by then.
    assert.ok(T.gutter[1] <= plan.landAt + 0.25 + 0.1, `the sun gutters out at ${T.gutter[1]}, the body is down at ${plan.landAt.toFixed(2)}`);
  }
});

test("its talons close on the victim's chest at the strike, as it swoops on along its heading", () => {
  for (const p of awkward) {
    const plan = planned(p), T = plan.timeline;
    assert.ok(distance(phoenixPosition(plan, T.strikeAt), plan.strike) < 1e-9, "the body where the plan says");
    if (!p.brief) assert.ok(distance(socketAt(plan, T.strikeAt), p.chest) < 1e-3, `the talons ${distance(socketAt(plan, T.strikeAt), p.chest).toFixed(4)} from the chest`);
    // The body is above and behind the talons, well above every head round about.
    assert.ok(plan.strike.y - p.chest.y > 1.2, `the body ${(plan.strike.y - p.chest.y).toFixed(2)} over the chest`);
    const v = phoenixVelocity(plan, T.strikeAt), speed = Math.hypot(v.x, v.y, v.z);
    assert.ok(p.brief ? speed > 2 && speed < 6 : speed > 5 && speed < 10, `strike speed ${speed.toFixed(2)}`);
    assert.ok(Math.abs(Math.hypot(plan.heading.x, plan.heading.z) - 1) < 1e-9 && plan.heading.y === 0);
    assert.ok((v.x * plan.heading.x + v.z * plan.heading.z) / Math.hypot(v.x, v.z) > 0.999999, "along its heading");
    assert.ok(v.y >= 0, "level at the bottom of the swoop, or already climbing");
    // The swoop is a swoop: it starts well above and comes down fast.
    if (!p.brief) {
      assert.ok(phoenixPosition(plan, T.dive[0]).y - plan.strike.y > 2.5, "it swoops from well above");
      assert.ok(phoenixVelocity(plan, (T.dive[0] + T.strikeAt) / 2).y < -3, "and comes down fast");
    }
  }
});

test("it carries the body up to a hover over the square, lets it go there, and the body falls back onto its own stone", () => {
  for (const p of awkward.slice(0, 5)) {
    const plan = planned(p), T = plan.timeline, size = PHOENIX_SIZE;
    // Carried up: the talons rise from the chest to the hold, and hold there. Never lower than it stood, so its feet never meet the board.
    assert.ok(socketAt(plan, T.carry[1]).y > p.chest.y + 2, "carried up");
    for (let t = T.strikeAt; t < T.release; t += 1 / 120) assert.ok(socketAt(plan, t).y >= p.chest.y - 0.02, `the body down to ${(socketAt(plan, t).y - p.chest.y).toFixed(3)} at ${t.toFixed(3)}`);
    for (const t of [T.hover[0] + 0.3, (T.hover[0] + T.hover[1]) / 2, T.release - 0.05]) {
      const socket = socketAt(plan, t);
      assert.ok(distance(socket, plan.hold) < 0.6, `held ${distance(socket, plan.hold).toFixed(2)} from the hold at ${t.toFixed(2)}`);
    }
    // Over the victim's square, near enough that the fall comes down on it, and high: the body hangs well clear of the board.
    assert.ok(flatDistance(plan.hold, p.stone) <= size.hover.on * TILE + 0.3, "over the square");
    assert.ok(plan.hold.y - p.boardTop > 3, "high over the board");
    // The body hangs under the bird: the talons a hang's length under the body.
    const pose = phoenixPose(plan, phoenixWingbeats(T), (T.hover[0] + T.hover[1]) / 2);
    assert.ok(Math.abs(pose.centre[1] - pose.socket[1] - size.hang * TILE / 1.02) < 0.5, `hangs ${(pose.centre[1] - pose.socket[1]).toFixed(2)} under the body`);
  }
});

test("it comes out of the seal: behind its plane before the burst, through it during, and clear after", () => {
  for (const p of awkward) {
    const plan = planPhoenix(p), T = plan.timeline, { centre, normal } = plan.seal;
    const side = (t: number) => dot({ x: phoenixPosition(plan, t).x - centre.x, y: phoenixPosition(plan, t).y - centre.y, z: phoenixPosition(plan, t).z - centre.z }, normal);
    assert.ok(side(0) < -1.5 && side(T.burst[0]) < -1.5, "it waits behind the seal");
    assert.ok(side(T.burst[1]) > 1.5, "and is through it by the end of the burst");
    // It comes through the seal's middle, not round its edge.
    for (let t = T.burst[0]; t <= T.burst[1]; t += 1 / 120) {
      const q = phoenixPosition(plan, t), d = side(t);
      const inPlane = { x: q.x - normal.x * d - centre.x, y: q.y - normal.y * d - centre.y, z: q.z - normal.z * d - centre.z };
      if (Math.abs(d) < 0.6) assert.ok(Math.hypot(inPlane.x, inPlane.y, inPlane.z) < plan.seal.radius * 0.5, `through the middle at ${t.toFixed(2)}`);
    }
    // The seal hangs high in the sky over and beyond the Queen, faces down at the board and leans to the player.
    assert.ok(flatDistance(centre, p.queen) < 4.5 && centre.y - p.boardTop > 7, `the seal at ${centre.y.toFixed(1)}, ${flatDistance(centre, p.queen).toFixed(1)} from the Queen`);
    const toViewer = { x: p.viewer.x - p.queen.x, y: 0, z: p.viewer.z - p.queen.z };
    assert.ok(dot(normal, toViewer) > 0 && normal.y < -0.45, "it faces down and leans toward the player");
    assert.ok(Math.hypot(centre.x, centre.z) <= p.hall - PHOENIX_SIZE.seal.wall + 1e-6, "inside the hall");
    // The pens start at its lowest point.
    for (let a = 0.1; a < Math.PI * 2; a += 0.3) assert.ok(sealPoint(plan, 0).y <= sealPoint(plan, a).y + 1e-9);
    // It comes down out of the sky to the swoop: it never dips below where it has to climb back to.
    let lowest = Infinity, climb = 0;
    for (let t = T.burst[0]; t <= T.dive[0]; t += 1 / 120) { const y = phoenixPosition(plan, t).y; lowest = Math.min(lowest, y); climb = Math.max(climb, y - lowest); }
    assert.ok(climb < 0.4, `it climbs back ${climb.toFixed(2)} before the swoop`);
  }
});

test("it never comes down among the figures: only its talons reach the victim", () => {
  for (const p of awkward.slice(0, 5)) {
    const plan = planned(p), T = plan.timeline;
    for (let t = T.burst[1]; t <= T.duration; t += 1 / 120) assert.ok(phoenixPosition(plan, t).y - p.boardTop > 1.9, `its body down to ${phoenixPosition(plan, t).y.toFixed(2)} at ${t.toFixed(2)}`);
  }
});

test("it flies no faster than a swoop, and is continuous", () => {
  for (const p of awkward) {
    const plan = planned(p), T = plan.timeline;
    let last = phoenixPosition(plan, 0), lastV = phoenixVelocity(plan, 0);
    for (let t = 1 / 480; t <= T.duration; t += 1 / 480) {
      const q = phoenixPosition(plan, t), v = phoenixVelocity(plan, t);
      assert.ok(Math.hypot(v.x, v.y, v.z) < 26, `speed ${Math.hypot(v.x, v.y, v.z).toFixed(1)} at ${t.toFixed(2)}`);
      assert.ok(distance(q, last) < 26 / 480 + 1e-9, `jumps at ${t.toFixed(3)}`);
      if (t > T.burst[0] + 0.01 && t < T.sunburst - 0.01) assert.ok(distance(v, lastV) < 0.6, `velocity jumps at ${t.toFixed(3)}`);
      last = q; lastV = v;
    }
  }
});

test("it rises to the sun over where it let go and stops there, inside the hall", () => {
  for (const p of awkward) {
    const plan = planned(p), T = plan.timeline;
    assert.ok(distance(phoenixPosition(plan, T.sunburst), plan.sun) < 1e-9);
    assert.ok(distance(phoenixPosition(plan, T.duration), plan.sun) < 1e-9, "and stays there");
    assert.ok(plan.sun.y > plan.release.y && flatDistance(plan.sun, plan.release) < 0.5, "over where it let go");
    assert.ok(Math.hypot(plan.sun.x, plan.sun.z) <= p.hall - PHOENIX_SIZE.wall + 1e-6, "inside the hall");
    const v = phoenixVelocity(plan, T.sunburst - 0.01);
    assert.ok(Math.hypot(v.x, v.y, v.z) < 1, "nearly still as it becomes the sun");
  }
});

test("it faces where it flies and banks into its turns, rears to the player in its hover, and stands upright as it becomes the sun", () => {
  for (const p of awkward.slice(0, 4)) {
    const plan = planned(p), T = plan.timeline;
    for (let t = 0; t <= T.duration; t += 0.01) {
      const f = phoenixFrame(plan, t);
      for (const axis of [f.forward, f.up, f.left]) assert.ok(Math.abs(Math.hypot(axis.x, axis.y, axis.z) - 1) < 1e-6);
      assert.ok(Math.abs(dot(f.forward, f.up)) < 1e-6 && Math.abs(dot(f.forward, f.left)) < 1e-6 && Math.abs(dot(f.up, f.left)) < 1e-6, "an orthonormal frame");
    }
    // In the swoop and as the talons close, the beak leads.
    for (const t of [T.dive[0] + 0.2, T.strikeAt]) {
      const f = phoenixFrame(plan, t), v = phoenixVelocity(plan, t), s = Math.hypot(v.x, v.y, v.z);
      assert.ok(dot(f.forward, v) / s > 0.98, `beak along the flight at ${t}`);
    }
    // Hovering, reared up with its breast to the player; as the sun, upright.
    const toViewer = { x: plan.toViewer.x, y: 0, z: plan.toViewer.z };
    const hover = (T.hover[0] + T.hover[1]) / 2, reared = phoenixFrame(plan, hover);
    assert.equal(phoenixDisplay(plan, hover), 1);
    assert.ok(reared.forward.y > 0.6, "reared up");
    assert.ok(dot(reared.up, toViewer) < -0.5, "its back to the far side, its breast to the player");
    assert.ok(phoenixFrame(plan, T.sunburst - 0.02).forward.y > 0.95, "upright as the sun");
    // It banks: somewhere in the approach its back is well over to one side.
    let bank = 0;
    for (let t = T.approach[0] + 0.2; t < T.dive[0]; t += 0.02) bank = Math.max(bank, Math.abs(phoenixFrame(plan, t).up.y - 1));
    assert.ok(bank > 0.12, `banks ${bank.toFixed(2)}`);
  }
});

test("the wings beat slow and heavy: never coming through the seal or in the swoop, hard while it carries, and the amount never jumps", () => {
  for (const brief of [false, true]) {
    const T = phoenixTimeline(brief), beats = phoenixWingbeats(T);
    assert.ok(beats.length >= (brief ? 2 : 4), `${beats.length} beats`);
    for (let i = 0; i < beats.length; i += 1) {
      const beat = beats[i];
      assert.ok(beat.period >= 0.45, "a great bird beats slowly");
      if (i > 0) assert.ok(beat.time >= beats[i - 1].time + beats[i - 1].period - 1e-9, `beat ${i} overlaps`);
      assert.ok(beat.time >= T.open[0], "none before the wings are open");
      assert.ok(beat.time + beat.period <= T.dive[0] + 0.03 || beat.time >= T.strikeAt, `beat ${i} is in the swoop`);
      assert.ok(beat.time + beat.period <= T.sunburst, "none once it is the sun");
    }
    if (!brief) {
      const carrying = beats.filter((beat) => beat.time >= T.strikeAt && beat.time < T.release);
      assert.ok(carrying.length >= 3 && carrying.every((beat) => beat.power >= 1.3), "it beats hard with the body in its talons");
      assert.ok(carrying[carrying.length - 1].time + carrying[carrying.length - 1].period <= T.release + 1e-9, "and lets go at the end of a beat");
    }
    let previous = phoenixFlap(beats, 0).amount;
    for (let t = 0.005; t <= T.duration; t += 0.005) {
      const now = phoenixFlap(beats, t).amount;
      assert.ok(Math.abs(now - previous) < 0.1, `flap amount jumps at ${t.toFixed(3)}`);
      previous = now;
    }
  }
});

test("the tail lies along the path it has flown: the arc length runs forward and back", () => {
  const plan = planned(input());
  let last = -1;
  for (let t = plan.arc.start; t <= plan.timeline.duration; t += 0.05) { const arc = phoenixArc(plan, t); assert.ok(arc >= last - 1e-12); last = arc; }
  for (const t of [1, 2, 2.5, 3, 4]) assert.ok(Math.abs(phoenixTimeAtArc(plan, phoenixArc(plan, t)) - t) < 0.01, `round trip at ${t}`);
  // Before the burst the path runs on behind the seal: there is a whole streamer's length of it to stream out of.
  assert.ok(phoenixArc(plan, plan.timeline.burst[0]) > 3.0 * plan.bird);
});

test("a rite is the same for a seed, its approach swings either way across seeds, and the talons find the chest whatever the seed", () => {
  const a = planned(input({ seed: 42 })), b = planned(input({ seed: 42 }));
  for (let t = 0; t <= a.timeline.duration; t += 0.1) assert.deepEqual(phoenixPosition(a, t), phoenixPosition(b, t));
  assert.deepEqual(phoenixPosition(a, 2.3), phoenixPosition(a, 2.3), "no hidden state");
  const sides = new Set<number>();
  for (let seed = 1; seed <= 24; seed += 1) sides.add(planPhoenix(input({ seed })).side);
  assert.deepEqual([...sides].sort(), [-1, 1]);
  for (let seed = 1; seed <= 6; seed += 1) { const plan = planned(input({ seed })); assert.ok(distance(socketAt(plan, plan.timeline.strikeAt), plan.chest) < 1e-3); }
});

test("it asks for its sounds and its shakes once each, in order, and none shake in the brief form", () => {
  for (const p of [input(), input({ brief: true })]) {
    const plan = planned(p), events = phoenixEvents(plan);
    for (let i = 1; i < events.length; i += 1) assert.ok(events[i].at >= events[i - 1].at);
    for (const e of events) {
      if (e.cue) assert.match(e.cue, /^rite\.phoenix\.(cry|wingbeat|dive|ignite|sunburst)$/);
      assert.ok(e.at >= 0 && e.at <= plan.timeline.duration);
      if (p.brief) assert.equal(e.shake, 0);
    }
    const cues = events.map((e) => e.cue);
    for (const cue of ["rite.phoenix.cry", "rite.phoenix.wingbeat", "rite.phoenix.dive", "rite.phoenix.ignite", "rite.phoenix.sunburst"]) assert.ok(cues.includes(cue as never), cue);
    assert.equal(cues.filter((cue) => cue === "rite.phoenix.cry").length, 2, "it cries out of the seal and over its prey");
    const ignite = events.find((e) => e.cue === "rite.phoenix.ignite")!;
    assert.equal(ignite.at, plan.timeline.strikeAt);
    assert.equal(ignite.where, "victim");
  }
});

test("the camera is told its beats from the player's side: the call, the seizing, the burning in the sky, the body up close, the fall", () => {
  const home = { position: { x: 0, y: 6.4, z: 8.6 }, target: { x: 0, y: 0.9, z: 0.4 } };
  for (const p of awkward) {
    const plan = planned(p), T = plan.timeline, shots = phoenixShots(plan, p.queen);
    // The brief form has no close look: the body burns where it stands.
    assert.equal(shots.length, p.brief ? 4 : 5);
    const fall = shots.length - 1;
    assert.equal(shots[0].from, 0);
    for (let i = 1; i < shots.length; i += 1) assert.ok(shots[i].from >= shots[i - 1].from + 0.6, "a camera move (0.95 s) is not cut off by the next before it is well under way");
    assert.ok(shots[1].from >= T.burst[1] && shots[1].from <= T.open[1], "it holds the seal until the bird is out of it, and moves on to the seizing as it cries");
    assert.ok(shots[2].from >= T.strikeAt && shots[2].from <= T.carry[1] - (p.brief ? 0 : 0.3), "and up to the burning once the talons have closed");
    assert.ok((p.brief || shots[fall].from <= T.release) && shots[fall].from > shots[2].from + 0.9, "and down for the fall as it lets go");
    for (const shot of shots) {
      assert.ok(shot.frame.length >= (shot.close ? 2 : 3));
      const view = riteShot(shot.frame, { home, boardTop: 0, aspect: 16 / 9, fov: 46, radius: 10.6, close: shot.close === true });
      assert.ok(view.position.y >= 1.4 - 1e-9 && Math.hypot(view.position.x, view.position.z) <= 10.6 + 1e-6);
    }
    assert.equal(phoenixShotAt(shots, 0), 0);
    assert.equal(phoenixShotAt(shots, T.dive[0]), 1);
    assert.equal(phoenixShotAt(shots, T.hover[0] + 0.2), 2, "the whole bird as it cries over the body");
    assert.equal(phoenixShotAt(shots, T.duration), fall);
    // The call holds the Queen and the seal; the seizing the victim; the burning the body in the sky; the fall the stone.
    assert.ok(shots[0].frame.some((q) => flatDistance(q, p.queen) < 1e-9 && q.y < 1.2) && shots[0].frame.some((q) => distance(q, plan.seal.centre) < 1e-9));
    assert.ok(shots[1].frame.some((q) => distance(q, p.chest) < 1e-9));
    assert.ok(shots[2].frame.some((q) => q.y < plan.hold.y && flatDistance(q, plan.hold) < 1e-9) && (p.brief || shots[2].frame.every((q) => q.y > p.boardTop + 1)));
    assert.ok(shots[fall].frame.some((q) => distance(q, p.stone) < 1e-9));
    if (!p.brief) {
      // The close look: the body in the talons, up close and from under it, through the hover's last beat.
      const close = shots[3];
      assert.ok(close.close && (close.look ?? 0) < 0, "up close, from under it");
      assert.ok(close.frame.every((q) => flatDistance(q, plan.hold) < 0.5 * plan.unit && q.y > plan.hold.y), "on the body, which hangs over the grip");
      assert.ok(close.from >= T.hover[0] + 0.3 && close.from < T.release, "after the whole bird has cried, before it lets go");
      assert.ok(shots[fall].from - close.from >= 1.2, "held long enough for a quick move in and a clear look at the body");
      assert.equal(phoenixShotAt(shots, T.release - 0.4), 3);
      const near = riteShot(close.frame, { home, boardTop: 0, aspect: 16 / 9, fov: 46, radius: 10.6, close: true, look: close.look, facing: close.facing });
      const wide = riteShot(shots[2].frame, { home, boardTop: 0, aspect: 16 / 9, fov: 46, radius: 10.6 });
      assert.ok(distance(near.position, near.target) < 0.6 * distance(wide.position, wide.target), "much nearer than the whole bird's shot");
      // From behind the bird and under it, between its legs (in front the legs hide the body, from the player's side
      // the wing and the streamers do): the eye is on the side away from the heading, or held off the wall nearer in.
      assert.ok(close.facing && flatDistance(close.facing, { x: -plan.heading.x, z: -plan.heading.z }) < 1e-9, "watched from behind the bird");
      const behind = (near.target.x - near.position.x) * plan.heading.x + (near.target.z - near.position.z) * plan.heading.z;
      assert.ok(behind >= -1e-9, "never from in front, where the legs hide it");
      assert.ok(near.position.y < near.target.y, "from under it");
    }
  }
});

test("each moment of the rite: written, flared, struck on the frame and not before, the body down and burning the stone, a sun that gutters, and done", () => {
  for (const p of [input(), input({ brief: true })]) {
    const plan = planned(p), T = plan.timeline, first = phoenixMoment(plan, 0);
    assert.equal(first.struck, false); assert.equal(first.done, false); assert.equal(first.sun, 0); assert.equal(first.flash, 0); assert.equal(first.landed, false);
    assert.equal(phoenixMoment(plan, T.strikeAt - 1e-6).struck, false);
    assert.equal(phoenixMoment(plan, T.strikeAt).struck, true);
    assert.equal(phoenixMoment(plan, plan.landAt - 1e-6).landed, false);
    assert.equal(phoenixMoment(plan, plan.landAt).landed, true);
    assert.equal(phoenixMoment(plan, T.duration - 1e-6).done, false);
    const last = phoenixMoment(plan, T.duration);
    assert.equal(last.done, true);
    assert.ok(last.sun < 1e-6 && last.seal < 1e-6 && last.washHeat < 1e-3 && last.scorch < 1e-6 && last.hand < 1e-6);
    assert.ok(phoenixMoment(plan, (T.shine[0] + T.shine[1]) / 2).sun > 0.99, "the sun stands");
    assert.ok(phoenixMoment(plan, T.gutter[0] + 0.7 * (T.gutter[1] - T.gutter[0])).sunHeat < phoenixMoment(plan, T.shine[1]).sunHeat, "and cools as it gutters");
    if (!p.brief) {
      assert.ok(phoenixMoment(plan, T.flare).flare > 0.95 && phoenixMoment(plan, T.flare + 0.5).flare < 0.05, "the flare is a flash");
      assert.ok(phoenixMoment(plan, T.strikeAt).flash > 0.99, "and so are the talons closing");
      assert.ok(phoenixMoment(plan, T.pen[0] + 0.5 * (T.pen[1] - T.pen[0])).pen > 0.45, "the pens write at one speed");
      assert.ok(phoenixMoment(plan, (T.hover[0] + T.hover[1]) / 2).pool > 0.99, "its light pools under its hover");
      assert.ok(phoenixMoment(plan, plan.landAt + 0.15).washHeat > 0.5, "the stone burns as the body comes down");
    } else {
      for (let t = 0; t <= T.duration; t += 0.01) { const m = phoenixMoment(plan, t); assert.equal(m.flash, 0); assert.equal(m.flare, 0); }
    }
    // The light is asked for all through, and never wildly.
    for (let t = 0.05; t < T.gutter[1] - 0.3; t += 0.05) { const m = phoenixMoment(plan, t); assert.ok(m.glow > 0.05 && m.glow < 9, `glow ${m.glow} at ${t.toFixed(2)}`); }
  }
});

test("what it throws loose is within the budget, born in the rite, and over the board", () => {
  for (const tier of ["low", "medium", "high", "ultra"] as const) {
    const p = input(), plan = planned(p), budget = PHOENIX_BUDGET[tier], layout = plumeLayout(budget, plan.seed, plan.bird, plan.unit);
    const loose = phoenixParticles(plan, budget, layout, phoenixWingbeats(plan.timeline), { x: p.queen.x, y: 1.3, z: p.queen.z });
    const total = budget.embers + budget.sparks * 2.5 + budget.rain + 12;
    assert.ok(loose.light.length <= total, `${tier}: ${loose.light.length} lights`);
    assert.ok(loose.smoke.length <= budget.smoke * 1.5 + 1, `${tier}: ${loose.smoke.length} puffs`);
    for (const particle of [...loose.light, ...loose.smoke]) {
      assert.ok(particle.birth >= 0 && particle.birth + particle.life <= plan.timeline.duration + 1e-9, `${tier}: born ${particle.birth}, lives ${particle.life}`);
      assert.ok(particle.anchored || particle.origin.y >= p.boardTop - 1e-9, `${tier}: born under the board`);
      assert.ok(Number.isFinite(particle.velocity.x + particle.velocity.y + particle.velocity.z));
    }
  }
  // A smaller tier throws less.
  const plan = planned(input()), count = (tier: "low" | "ultra") => phoenixParticles(plan, PHOENIX_BUDGET[tier], plumeLayout(PHOENIX_BUDGET[tier], 1, plan.bird, plan.unit), phoenixWingbeats(plan.timeline), { x: 0, y: 1, z: 0 }).light.length;
  assert.ok(count("low") * 2.5 < count("ultra"));
});

test("the burning in the sky holds the whole bird, seen from under the body so it hangs against the sky", () => {
  const home = { position: { x: 0, y: 6.4, z: 8.6 }, target: { x: 0, y: 0.35, z: 0 } };
  const toPixels = (view: { position: P; target: P; fov: number }, q: P) => {
    const f = { x: view.target.x - view.position.x, y: view.target.y - view.position.y, z: view.target.z - view.position.z }, fl = Math.hypot(f.x, f.y, f.z);
    const fw = { x: f.x / fl, y: f.y / fl, z: f.z / fl }, rl = Math.hypot(fw.z, fw.x), right = { x: -fw.z / rl, y: 0, z: fw.x / rl };
    const up = { x: right.y * fw.z - right.z * fw.y, y: right.z * fw.x - right.x * fw.z, z: right.x * fw.y - right.y * fw.x };
    const d = { x: q.x - view.position.x, y: q.y - view.position.y, z: q.z - view.position.z }, depth = dot(d, fw), focal = 360 / Math.tan((view.fov / 2) * Math.PI / 180);
    return { x: 640 + (dot(d, right) / depth) * focal, y: 360 - (dot(d, up) / depth) * focal, depth };
  };
  for (const p of awkward.filter((q) => !q.brief)) {
    const plan = planned(p), shot = phoenixShots(plan, p.queen)[2];
    assert.equal(shot.look, PHOENIX_HOVER_SHOT.look, "the burning names how it is seen");
    const view = riteShot(shot.frame, { home, boardTop: 0, aspect: 16 / 9, fov: 46, radius: 10.6, look: shot.look });
    assert.ok(view.position.y < plan.hold.y - 0.5, `the eye (${view.position.y.toFixed(2)}) stands under the burning body (${plan.hold.y.toFixed(2)})`);
    // The wings, nine units to either side of the bird across the player's view, are in the frame; so is the body.
    const side = { x: plan.toViewer.z, z: -plan.toViewer.x }, span = PHOENIX_SIZE.wingspan / 2;
    for (const sign of [1, -1]) {
      const tip = toPixels(view, { x: plan.hover.x + side.x * span * sign, y: plan.hover.y, z: plan.hover.z + side.z * span * sign });
      assert.ok(tip.depth > 0 && tip.x > 0 && tip.x < 1280 && tip.y > 0 && tip.y < 720, `a wingtip at ${tip.x.toFixed(0)}, ${tip.y.toFixed(0)}`);
    }
    const body = toPixels(view, plan.hold);
    assert.ok(body.x > 320 && body.x < 960 && body.y > 240 && body.y < 640, `the body at ${body.x.toFixed(0)}, ${body.y.toFixed(0)}`);
  }
  // The brief form, which carries nothing, keeps the shot's own choice.
  assert.equal(phoenixShots(planned(input({ brief: true })), input().queen)[2].look, undefined);
});
