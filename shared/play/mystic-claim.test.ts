import { test } from "node:test";
import assert from "node:assert/strict";
import { CLAIM_CLOSE, CLAIM_SHOT, CLAIM_WEIGHT, castHold, claimCloseShot, claimIsWatched, claimMoments, claimMomentsBetween, claimShot, claimState, keepInFrame, claimTimeline, returnHold, returnMoments, returnMomentsBetween, returnState, skyHold, threadFar } from "../../web/src/scene/vfx/mystic/claimPlan";
import { DuelCameraTimeline, type DuelShot } from "../../web/src/scene/combat/duelCamera";

const kinds = ["p", "n", "b", "r", "q"] as const;
const sample = (timeline: ReturnType<typeof claimTimeline>, step = 1 / 60) => {
  const states = [];
  for (let t = 0; t <= timeline.total + 0.2; t += step) states.push({ t, ...claimState(timeline, t) });
  return states;
};

test("the ritual runs in order: mark, thread, touch, unmaking, soul, release", () => {
  for (const kind of kinds) {
    const t = claimTimeline(kind);
    assert.ok(t.mark[0] > 0.2, "the body lies still before anything is drawn");
    assert.ok(t.mark[0] < t.mark[1] && t.thread[0] < t.thread[1]);
    assert.ok(t.thread[0] > t.mark[0], "the thread comes after the pen has started");
    assert.ok(t.thread[1] >= t.mark[1], "it lands on a finished sigil");
    assert.ok(t.unmake[0] >= t.thread[1], "nothing is unmade before the thread touches");
    assert.ok(t.soul[0] > t.unmake[0] && t.soul[0] < t.unmake[1], "the soul leaves while the body is going");
    assert.ok(t.soul[1] > t.unmake[1], "and reaches the hand after the body has gone");
    assert.ok(t.release[0] >= t.soul[1], "the thread holds until the soul is in the hand");
    assert.equal(t.release[1], t.total);
  }
});

test("a heavier piece is taken more slowly, and none takes long", () => {
  const totals = kinds.map((kind) => claimTimeline(kind).total);
  assert.ok(totals[0] < totals[1] && totals[1] <= totals[2] && totals[2] < totals[3] && totals[3] < totals[4]);
  assert.equal(claimTimeline("p").total, 3.5);
  assert.ok(claimTimeline("q").total < 5, "even a Queen is gone inside five seconds");
  assert.equal(CLAIM_WEIGHT.p, 1);
});

test("every envelope stays in range, starts from nothing and ends with nothing", () => {
  for (const kind of kinds) for (const brief of [false, true]) {
    const timeline = claimTimeline(kind, brief), states = sample(timeline);
    for (const s of states) {
      for (const key of ["sigilDrawn", "sigilGlow", "reach", "power", "shaft", "rise", "unmade", "hand"] as const) {
        assert.ok(s[key] >= 0 && s[key] <= 1, `${key} ${s[key]} at ${s.t.toFixed(2)} (${kind}${brief ? ", brief" : ""})`);
      }
      assert.ok(s.soul === null || (s.soul >= 0 && s.soul <= 1));
    }
    const first = states[0], last = states.at(-1)!;
    assert.equal(first.power, 0); assert.equal(first.shaft, 0); assert.equal(first.unmade, 0); assert.equal(first.sinceTouch, -1);
    assert.equal(last.done, true); assert.equal(last.unmade, 1);
    assert.ok(last.power < 1e-6 && last.shaft < 1e-6 && last.rise < 1e-6 && last.sigilGlow < 0.16 && last.soul === null);
  }
});

test("the body is never unmade before the thread touches it, and only ever further", () => {
  for (const kind of kinds) for (const brief of [false, true]) {
    const timeline = claimTimeline(kind, brief);
    let before = 0;
    for (const s of sample(timeline)) {
      if (s.sinceTouch < 0) assert.equal(s.unmade, 0, `unmade before the touch at ${s.t.toFixed(2)}`);
      assert.ok(s.unmade >= before - 1e-12);
      before = s.unmade;
    }
  }
});

test("the thread comes down once, the light then runs back up it, and the soul climbs to the hand", () => {
  const timeline = claimTimeline("p"), states = sample(timeline);
  let reach = 0;
  for (const s of states) { assert.ok(s.reach >= reach - 1e-12); reach = s.reach; }
  const touch = states.find((s) => s.sinceTouch >= 0)!;
  assert.ok(Math.abs(touch.t - timeline.thread[1]) < 1 / 30 && touch.reach > 0.99);
  assert.equal(states.find((s) => s.t > timeline.thread[1] + 0.3)!.flow, -1);
  assert.equal(states[0].flow, 1);
  const climbing = states.filter((s) => s.soul !== null);
  assert.ok(climbing.length > 20);
  assert.ok(climbing[0].soul! > 0.95, "it starts at the body");
  assert.ok(climbing.at(-1)!.soul! < 0.1, "and ends at the hand");
  for (let i = 1; i < climbing.length; i += 1) assert.ok(climbing[i].soul! <= climbing[i - 1].soul! + 1e-12);
  // it is fastest into the hand
  const half = climbing[Math.floor(climbing.length / 2)].soul!;
  assert.ok(half > 0.6, `halfway through its climb it has covered under half the thread (${half.toFixed(2)})`);
  const arrival = states.find((s) => Math.abs(s.t - timeline.soul[1]) < 1 / 120)!;
  assert.ok(arrival.hand > 0.95, "the hand flares as it closes on the soul");
});

test("the brief form draws nothing that travels and is over in about a second", () => {
  const timeline = claimTimeline("q", true), states = sample(timeline);
  assert.equal(timeline.brief, true); assert.equal(timeline.total, 1.1);
  assert.deepEqual(claimTimeline("p", true), timeline, "it is the same length for every piece");
  for (const s of states) {
    assert.equal(s.sigilDrawn, 1, "no pen: the sigil is simply there");
    assert.equal(s.reach, 1, "the thread does not come down: it is there or it is not");
    assert.equal(s.soul, null);
    assert.ok(s.power <= 0.6);
  }
  assert.ok(states.some((s) => s.shaft > 0.9) && states.some((s) => s.unmade > 0.5));
});

// ------------------------------------------------------------------ in a match

test("the match hears of each moment once, in order, however the frames fall", () => {
  for (const kind of kinds) for (const brief of [false, true]) {
    const timeline = claimTimeline(kind, brief);
    const order = claimMoments(timeline).map(({ moment }) => moment);
    assert.deepEqual(order, ["thread", "touch", "soul", "gone", "arrive", "done"]);
    const at = Object.fromEntries(claimMoments(timeline).map(({ moment, at }) => [moment, at]));
    assert.equal(claimState(timeline, at.gone).unmade, 1, "gone is the moment the body is fully unmade");
    assert.ok(claimState(timeline, at.touch).sinceTouch >= 0);
    for (const step of [1 / 144, 1 / 60, 1 / 30, 0.1, 0.37, 5]) {
      const heard: string[] = [];
      let clock = 0;
      while (clock < timeline.total + 1) { heard.push(...claimMomentsBetween(timeline, clock, clock + step)); clock += step; }
      assert.deepEqual(heard, order, `at a ${step.toFixed(3)} s frame`);
    }
  }
  // the brief form's thread is there from the first frame: a moment at 0 is still heard
  assert.equal(claimMomentsBetween(claimTimeline("p", true), 0, 1 / 60)[0], "thread");
});

test("with nobody to hold it, the thread comes from high above the far side of the board", () => {
  for (const stone of [{ x: -3.5, y: 0.9, z: 3.5 }, { x: 0, y: 0.9, z: 0 }, { x: 3.5, y: 0.9, z: -3.5 }]) {
    const hold = skyHold(stone);
    assert.ok(hold.y - stone.y > 15, "far above any frame the player keeps");
    assert.ok(hold.z < stone.z, "behind the body, as the sorcerer would be");
    assert.ok(Math.abs(hold.x) <= Math.abs(stone.x), "leaning in over the board, not out of it");
  }
});

test("a long thread is drawn larger at its far end, within bounds", () => {
  const body = { x: 0, y: 1, z: 0 };
  assert.equal(threadFar({ x: 0, y: 3, z: 0 }, body), 1);
  const far = threadFar({ x: 5, y: 5.4, z: -36.6 }, body);
  assert.ok(far > 3.5 && far <= 4.5, `the sorcerer's hand, ${far.toFixed(2)}`);
  assert.equal(threadFar({ x: 0, y: 400, z: 0 }, body), 4.5);
});

test("the hands stay raised from the cast until the thread lets go", () => {
  for (const kind of kinds) {
    const t = claimTimeline(kind);
    assert.ok(Math.abs(1 + castHold(t, 1) - t.release[0]) < 1e-9);
    assert.ok(castHold(t, 1) > t.soul[1] - 1 - 1e-9, "past the soul's arrival");
  }
  assert.ok(castHold(claimTimeline("p", true), 1) >= 0.2, "the brief form still asks for a moment");
});

test("the camera watches the first claim of a match and every piece above a Pawn", () => {
  assert.equal(claimIsWatched("p", 0), true);
  assert.equal(claimIsWatched("p", 1), false);
  assert.equal(claimIsWatched("p", 7), false);
  for (const kind of ["n", "b", "r", "q"] as const) assert.equal(claimIsWatched(kind, 5), true);
});

test("the claim shot holds the body, the thread and the holder's face in one frame", () => {
  const hand = { x: 2.1, y: 5.2, z: -36 }, face = { x: 5.2, y: 7.4, z: -37 };
  const boardTop = 0.9, radius = 10.6;
  const degrees = 180 / Math.PI;
  for (const body of [{ x: -3.5, y: 1.1, z: 3.5 }, { x: 0.5, y: 1.1, z: -0.5 }, { x: 3.5, y: 1.1, z: -3.5 }, { x: -3.5, y: 1.1, z: -3.5 }, { x: 3.5, y: 1.1, z: 3.5 }]) {
    const shot = claimShot({ body, hand, face, boardTop, aspect: 16 / 9, radius });
    assert.ok(Math.hypot(shot.position.x, shot.position.z) <= radius + 1e-9, "inside the hall");
    assert.ok(Math.abs(shot.position.y - (boardTop + CLAIM_SHOT.height)) < 1e-9, "above the heads of the pieces");
    assert.ok(shot.position.z > body.z, "behind the body, on the side away from the holder");
    assert.ok(shot.fov >= CLAIM_SHOT.fov[0] && shot.fov <= CLAIM_SHOT.fov[1]);
    // where each thing falls in the frame: angles off the view's axis, against half the lens
    const view = { x: shot.target.x - shot.position.x, y: shot.target.y - shot.position.y, z: shot.target.z - shot.position.z };
    const yaw = Math.atan2(view.x, -view.z), pitch = Math.atan2(view.y, Math.hypot(view.x, view.z));
    const half = shot.fov / 2, halfWide = Math.atan(Math.tan((half / degrees)) * (16 / 9)) * degrees;
    for (const [name, point] of Object.entries({ body: { ...body, y: boardTop }, hand, face })) {
      const to = { x: point.x - shot.position.x, y: point.y - shot.position.y, z: point.z - shot.position.z };
      const up = (Math.atan2(to.y, Math.hypot(to.x, to.z)) - pitch) * degrees;
      const across = (Math.atan2(to.x, -to.z) - yaw) * degrees;
      assert.ok(Math.abs(up) < half - 2, `${name} is ${up.toFixed(1)} degrees off the axis in a ${shot.fov.toFixed(0)} degree lens`);
      assert.ok(Math.abs(across) < halfWide - 4, `${name} is ${across.toFixed(1)} degrees to the side`);
    }
    const low = Math.atan2(boardTop - shot.position.y, Math.hypot(body.x - shot.position.x, body.z - shot.position.z)) - pitch;
    assert.ok(low < 0, "the body lies in the lower half");
  }
});

test("the claim shot keeps the fallen's strongest mourner in frame, turning and widening no more than it must", () => {
  const hand = { x: 2.1, y: 5.2, z: -36 }, face = { x: 5.2, y: 7.4, z: -37 }, boardTop = 0.9, aspect = 16 / 9, degrees = 180 / Math.PI;
  const across = (shot: { position: { x: number; z: number }; target: { x: number; z: number } }, point: { x: number; z: number }) => {
    const view = Math.atan2(shot.target.x - shot.position.x, shot.target.z - shot.position.z);
    const to = Math.atan2(point.x - shot.position.x, point.z - shot.position.z) - view;
    return Math.atan2(Math.sin(to), Math.cos(to)) * degrees;
  };
  const halfWide = (fov: number) => Math.atan(Math.tan(fov / degrees / 2) * aspect) * degrees;
  for (const body of [{ x: -3.5, y: 1.1, z: 3.5 }, { x: 0.5, y: 1.1, z: -0.5 }, { x: 3.5, y: 1.1, z: 2.5 }]) {
    const plain = claimShot({ body, hand, face, boardTop, aspect, radius: 10.6 });
    // A mourner already inside the frame changes nothing.
    assert.deepEqual(claimShot({ body, hand, face, boardTop, aspect, radius: 10.6, keep: { x: body.x, y: 1.6, z: body.z - 0.5 } }), plain);
    // One at the body's side, out at the frame's edge or past it: turned to, the body and the thread still in.
    for (const side of [-1, 1]) {
      const mourner = { x: body.x + side * 2.6, y: 1.6, z: body.z + 2.2 };
      const kept = claimShot({ body, hand, face, boardTop, aspect, radius: 10.6, keep: mourner });
      const half = halfWide(kept.fov);
      assert.ok(Math.abs(across(kept, mourner)) < half - 4, `the mourner ${across(kept, mourner).toFixed(1)} degrees across a ${(2 * half).toFixed(0)} degree frame`);
      for (const point of [body, hand]) assert.ok(Math.abs(across(kept, point)) < half - 4, `the body and the thread stay in (${across(kept, point).toFixed(1)})`);
      assert.ok(kept.fov >= plain.fov && kept.fov <= CLAIM_SHOT.fov[1], "opened no wider than the claim's widest lens");
      assert.deepEqual(kept.position, plain.position, "from the same place");
    }
  }
  // Too far round for any lens: turned only as far as keeps the body in.
  const body = { x: 0.5, y: 1.1, z: -0.5 }, plain = claimShot({ body, hand, face, boardTop, aspect, radius: 10.6 });
  const behind = keepInFrame(plain, { x: plain.position.x + 6, y: 1.6, z: plain.position.z + 1 }, aspect);
  assert.equal(behind.fov, CLAIM_SHOT.fov[1]);
  assert.ok(Math.abs(across(behind, body)) <= halfWide(behind.fov) - 6 + 1e-6, "the body at most at the frame's kept edge");
});

test("the second beat stays where the first stood and puts the holder's hand and face in a long lens", () => {
  const hand = { x: 2.1, y: 6.6, z: -36 }, face = { x: 5.2, y: 7.4, z: -37 };
  const degrees = 180 / Math.PI;
  for (const body of [{ x: -3.5, y: 1.1, z: 3.5 }, { x: 0.5, y: 1.1, z: -0.5 }, { x: 3.5, y: 1.1, z: -3.5 }]) {
    const wide = claimShot({ body, hand, face, boardTop: 0.9, aspect: 16 / 9, radius: 10.6 });
    const reach = Math.hypot(wide.target.x - wide.position.x, wide.target.y - wide.position.y, wide.target.z - wide.position.z);
    const close = claimCloseShot({ eye: wide.position, hand, face, reach });
    assert.deepEqual(close.position, wide.position, "the eye does not move: only the lens and the aim do");
    assert.ok(close.fov < wide.fov / 2, `a much longer lens (${close.fov.toFixed(1)} against ${wide.fov.toFixed(1)})`);
    assert.ok(close.fov >= CLAIM_CLOSE.fov[0] && close.fov <= CLAIM_CLOSE.fov[1]);
    const far = Math.hypot(close.target.x - close.position.x, close.target.y - close.position.y, close.target.z - close.position.z);
    assert.ok(Math.abs(far - reach) < 1e-9, "the target stays as near as the first beat's: orbit limits measure to it");
    const view = { x: close.target.x - close.position.x, y: close.target.y - close.position.y, z: close.target.z - close.position.z };
    const yaw = Math.atan2(view.x, -view.z), pitch = Math.atan2(view.y, Math.hypot(view.x, view.z));
    const half = close.fov / 2, halfWide = Math.atan(Math.tan(half / degrees) * (16 / 9)) * degrees;
    for (const [name, point] of Object.entries({ hand, face })) {
      const to = { x: point.x - close.position.x, y: point.y - close.position.y, z: point.z - close.position.z };
      const up = (Math.atan2(to.y, Math.hypot(to.x, to.z)) - pitch) * degrees, across = (Math.atan2(to.x, -to.z) - yaw) * degrees;
      assert.ok(Math.abs(up) < half * 0.8, `${name} is ${up.toFixed(1)} degrees off the axis in a ${close.fov.toFixed(1)} degree lens`);
      assert.ok(Math.abs(across) < halfWide * 0.8, `${name} is ${across.toFixed(1)} degrees to the side`);
      assert.ok(up > 0, `${name} sits in the upper half, with the body of the figure under it`);
    }
  }
});

test("a shot can move on to a second view and still go home exactly", () => {
  const home = { position: { x: 0, y: 6.4, z: 8.6 }, target: { x: 0, y: 0.9, z: 0.4 }, fov: 46.6 };
  const first = { position: { x: -1.3, y: 4, z: 4.4 }, target: { x: -0.6, y: 2.6, z: -1.5 }, fov: 49 };
  const second = { position: { ...first.position }, target: { x: -0.4, y: 4.3, z: -1.6 }, fov: 13 };
  const shot: DuelShot = { ...first, push: first.position, killSeen: true, side: 1, lean: 0, pitch: 0, distance: 0, occlusion: 0, fill: 0, confined: false };
  const timeline = new DuelCameraTimeline(home, shot, { easeIn: 1, easeOut: 1 });
  const run = (seconds: number) => { let pose = timeline.current; for (let t = 0; t < seconds - 1e-9; t += 1 / 60) pose = timeline.update(1 / 60); return pose; };
  assert.ok(Math.abs(run(1.1).fov - 49) < 1e-6, "at the first view");
  timeline.moveTo(second, 0.6);
  const mid = run(0.3);
  assert.ok(mid.fov < 49 && mid.fov > 13, "on its way");
  const there = run(0.4);
  assert.ok(Math.abs(there.fov - 13) < 1e-6 && Math.abs(there.target.y - 4.3) < 1e-6, "at the second view");
  assert.deepEqual(there.position, first.position);
  assert.equal(timeline.phase, "hold");
  timeline.release();
  run(1.1);
  assert.equal(timeline.done, true);
  assert.deepEqual(timeline.current, home, "home is the player's view, value for value");
  // once it is leaving, a late second beat does not pull it back
  const leaving = new DuelCameraTimeline(home, shot, { easeIn: 0.2, easeOut: 1 });
  leaving.update(0.3); leaving.release(); leaving.moveTo(second, 0.5);
  assert.equal(leaving.phase, "out");
});

test("a shot that still holds the camera when the turn passes ends on the next player's side", () => {
  const home = { position: { x: 0, y: 6.4, z: 8.6 }, target: { x: 0, y: 0.9, z: 0.4 }, fov: 46.6 };
  const other = { position: { x: 0, y: 6.4, z: -7.8 }, target: { ...home.target }, fov: 46.6 };
  const view = { position: { x: -1.3, y: 4, z: 4.4 }, target: { x: -0.6, y: 2.6, z: -1.5 }, fov: 49 };
  const shot: DuelShot = { ...view, push: view.position, killSeen: true, side: 1, lean: 0, pitch: 0, distance: 0, occlusion: 0, fill: 0, confined: false };
  const run = (timeline: DuelCameraTimeline, seconds: number) => { let pose = timeline.current; for (let t = 0; t < seconds - 1e-9; t += 1 / 60) pose = timeline.update(1 / 60); return pose; };
  // told while it holds: nothing moves until it lets go, and then it goes to the other side
  const held = new DuelCameraTimeline(home, shot, { easeIn: 0.5, easeOut: 1 });
  run(held, 0.6);
  held.rehome(other);
  assert.deepEqual(run(held, 0.2).position, view.position, "the shot is not cut into");
  held.release();
  run(held, 1.1);
  assert.deepEqual(held.current, other);
  // told while it is already going back: it turns for the other side from where it is, without a jump
  const leaving = new DuelCameraTimeline(home, shot, { easeIn: 0.5, easeOut: 1 });
  run(leaving, 0.6); leaving.release();
  const before = run(leaving, 0.5);
  leaving.rehome(other, 1);
  const after = leaving.update(1 / 60);
  assert.ok(Math.hypot(after.position.x - before.position.x, after.position.y - before.position.y, after.position.z - before.position.z) < 0.2, "no jump");
  run(leaving, 1.1);
  assert.deepEqual(leaving.current, other);
  // told after it is home: nothing to do
  const done = new DuelCameraTimeline(home, shot, { easeIn: 0.2, easeOut: 0.2 });
  run(done, 0.3); done.release(); run(done, 0.3);
  done.rehome(other);
  assert.deepEqual(done.current, home);
});

// ------------------------------------------------------------------ taken back (an Undo)

test("a claim taken back is the ritual run backwards, and ends with the body whole", () => {
  for (const kind of kinds) for (const brief of [false, true]) {
    const t = claimTimeline(kind, brief);
    for (let s = 0; s <= t.total; s += 0.05) {
      const back = returnState(t, s), forward = claimState(t, t.total - s);
      for (const key of ["sigilDrawn", "sigilGlow", "reach", "power", "shaft", "rise", "unmade", "hand"] as const) {
        assert.ok(Math.abs(back[key] - forward[key]) < 1e-9, `${kind}${brief ? " brief" : ""}: ${key} at ${s.toFixed(2)}s is the ritual's at ${(t.total - s).toFixed(2)}s`);
      }
    }
    assert.equal(returnState(t, 0).unmade, 1, "it starts with nothing of the body");
    assert.equal(returnState(t, 0).done, false, "and is not over before it starts");
    assert.equal(returnState(t, t.total).unmade, 0, "it ends with the body whole");
    assert.equal(returnState(t, t.total).done, true);
    let last = 1;
    for (let s = 0; s <= t.total + 0.1; s += 1 / 60) {
      const { unmade } = returnState(t, s);
      assert.ok(unmade <= last + 1e-9, "the body is only ever remade, never unmade again");
      last = unmade;
    }
  }
});

test("a returning soul comes out of the hand and down the thread into the body", () => {
  for (const kind of kinds) {
    const t = claimTimeline(kind);
    const seen: number[] = [];
    for (let s = 0; s <= t.total; s += 1 / 120) { const { soul } = returnState(t, s); if (soul !== null) seen.push(soul); }
    assert.ok(seen.length > 10, `${kind}: the soul is seen travelling`);
    assert.ok(seen[0] < 0.1, "it starts at the hand (0)");
    assert.ok(seen[seen.length - 1] > 0.9, "and ends at the body (1)");
    for (let i = 1; i < seen.length; i += 1) assert.ok(seen[i] >= seen[i - 1] - 1e-9, "it only comes down");
    // fastest out of the hand, slowest into the body: the climb's own easing, backwards
    const third = Math.floor(seen.length / 3);
    assert.ok(seen[third] - seen[0] > seen[seen.length - 1] - seen[seen.length - 1 - third], "it slows as it reaches the body");
  }
});

test("a return's moments come in order: the thread, the soul leaving the hand, home, whole, done", () => {
  for (const kind of kinds) {
    const t = claimTimeline(kind);
    const moments = returnMoments(t);
    assert.deepEqual(moments.map(({ moment }) => moment), ["thread", "soul", "home", "whole", "done"], kind);
    const at = Object.fromEntries(moments.map(({ moment, at }) => [moment, at]));
    assert.equal(at.thread, 0, "the thread stands as soon as the hands are up");
    assert.ok(Math.abs(at.home - (t.total - t.soul[0])) < 1e-6 && Math.abs(at.whole - (t.total - t.unmake[0])) < 1e-6);
    assert.ok(returnState(t, at.whole).unmade < 1e-6, "whole means whole");
    assert.ok(returnState(t, at.home - 0.01).soul !== null && returnState(t, at.home + 0.01).soul === null, "home is where the soul stops");
    // read frame by frame, every moment is heard once
    const heard: string[] = [];
    for (let s = 1 / 30, last = 0; s <= t.total + 0.05; last = s, s += 1 / 30) heard.push(...returnMomentsBetween(t, last, s));
    assert.deepEqual(heard, ["thread", "soul", "home", "whole", "done"]);
  }
  const brief = claimTimeline("p", true);
  assert.deepEqual(returnMoments(brief).map(({ moment }) => moment), ["thread", "soul", "home", "whole", "done"], "the brief form has the same moments, the soul's two together");
});

test("the holder keeps its hands up for a return until the thread is back in the hand", () => {
  for (const kind of kinds) {
    const t = claimTimeline(kind);
    const hold = returnHold(t);
    assert.ok(Math.abs(hold - (t.total - t.thread[0])) < 1e-9, kind);
    assert.ok(returnState(t, hold - 0.05).reach > 0, "the thread is still out while the hands are up");
    assert.equal(returnState(t, hold + 0.01).reach, 0, "and back in the hand when they come down");
  }
});
