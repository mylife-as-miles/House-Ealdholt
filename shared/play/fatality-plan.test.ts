import assert from "node:assert/strict";
import test from "node:test";
import { beatsBetween, BODY_FALL, closeShotWaits, FATALITY, FATALITY_SECONDS, fatalityPlays, limbLanding, sceneSecondsAt, sequenceSeconds, SEVER_CUT, severCutPlays, severFrame, timeScaleAt, woundFrame, WOUND_LOOK, woundLookFrame, woundLookPlays, woundShot, WOUND_SHOT, type FatalityBeat } from "../../web/src/scene/fatality/fatalityPlan";
import { limbLaunch } from "../../web/src/scene/death/sever/severPlan";
import { DuelCameraTimeline, type DuelShot } from "../../web/src/scene/combat/duelCamera";
import { RITE_SHOT, riteShot, shotTurn } from "../../web/src/scene/rites/riteShot";
import { goreShow, type KillMoment, type TierSettings } from "../../web/src/scene/gore/goreTiers";

const at = (violence: TierSettings["violence"], extra: Partial<TierSettings> = {}): TierSettings =>
  ({ violence, reducedMotion: false, captureCinematics: true, ...extra });
const MATE: KillMoment = { attacker: "q", victim: "p", style: "spell", mate: true };

test("the slow motion: a quarter of real time for about a second, eased in and out, and nothing jumps", () => {
  assert.equal(timeScaleAt(-1), 1);
  assert.equal(timeScaleAt(0), 1);
  assert.equal(timeScaleAt(FATALITY.easeIn + FATALITY.hold / 2), FATALITY.slow);
  assert.equal(timeScaleAt(FATALITY_SECONDS + 1), 1);
  assert.ok(FATALITY.slow >= 0.2 && FATALITY.slow <= 0.3, "about a quarter");
  // About a second held near the slowest, real time.
  let slowFor = 0, last = 1;
  for (let t = 0; t < 3; t += 1 / 240) {
    const scale = timeScaleAt(t);
    if (scale <= FATALITY.slow + 0.05) slowFor += 1 / 240;
    assert.ok(Math.abs(scale - last) < 0.06, `no jump at ${t.toFixed(3)}: ${last} to ${scale}`);
    assert.ok(scale >= FATALITY.slow - 1e-9 && scale <= 1, "never slower than the slowest, never faster than real time");
    last = scale;
  }
  assert.ok(slowFor > 0.85 && slowFor < 1.3, `held slow for ${slowFor.toFixed(2)} s`);
  // Eased: slowing down, then speeding up, never the other way inside either ramp.
  for (let t = 0; t < FATALITY.easeIn; t += 0.01) assert.ok(timeScaleAt(t + 0.01) <= timeScaleAt(t) + 1e-12);
  const out = FATALITY.easeIn + FATALITY.hold;
  for (let t = out; t < out + FATALITY.easeOut; t += 0.01) assert.ok(timeScaleAt(t + 0.01) >= timeScaleAt(t) - 1e-12);
});

test("the kill goes on, slowed: about half a second of it is seen in the second and a half the beat takes", () => {
  const real = FATALITY.easeIn + FATALITY.hold + FATALITY.easeOut;
  const scene = sceneSecondsAt(real);
  assert.ok(scene > 0.35 && scene < 0.7, `${scene.toFixed(3)} scene seconds in ${real.toFixed(2)} real`);
  // The film harness steps the engine at 30 frames a second; the engine's own sum agrees with the plan's.
  let stepped = 0, seconds = -1;
  for (let frame = 0; frame < 90; frame += 1) {
    seconds = seconds < 0 ? 0 : seconds + 1 / 30;
    stepped += (1 / 30) * timeScaleAt(seconds);
  }
  assert.ok(Math.abs(stepped - sceneSecondsAt(90 / 30)) < 0.05, `${stepped.toFixed(3)} against ${sceneSecondsAt(3).toFixed(3)}`);
});

test("the beats come once each, in order, at any frame rate: the close shot on the blow, the way back, the end", () => {
  for (const fps of [24, 30, 60, 144]) {
    const heard: { beat: FatalityBeat; at: number }[] = [];
    let before = -1;
    for (let frame = 0; frame < fps * 3; frame += 1) {
      const now = before < 0 ? 0 : before + 1 / fps;
      for (const beat of beatsBetween(before, now)) heard.push({ beat, at: now });
      before = now;
    }
    assert.deepEqual(heard.map(item => item.beat), ["close", "back", "end"], `${fps} fps`);
    assert.equal(heard[0].at, 0, "the close shot is asked for on the frame of the blow");
    assert.ok(heard[1].at >= FATALITY.backAt && heard[1].at < FATALITY.backAt + 1 / fps + 1e-9);
    assert.ok(heard[2].at >= FATALITY_SECONDS);
  }
  // The camera is back before the director lets go.
  assert.ok(FATALITY.backAt + FATALITY.backSeconds <= FATALITY_SECONDS + 1e-9);
  // ...and it goes back while the scene is still slow or easing out, not long after.
  assert.ok(FATALITY.backAt < FATALITY.easeIn + FATALITY.hold + FATALITY.easeOut);
});

test("only a kill whose tier shows a fatality plays one, and never in a fight hurried past", () => {
  assert.equal(fatalityPlays(goreShow(MATE, at("full"), "high"), false), true);
  assert.equal(fatalityPlays(goreShow(MATE, at("full"), "low"), false), true, "Low plays it, without its fluid");
  assert.equal(fatalityPlays(goreShow(MATE, at("full"), "high"), true), false, "a skipped fight");
  assert.equal(fatalityPlays(goreShow(MATE, at("cinematic"), "high"), false), false);
  assert.equal(fatalityPlays(goreShow(MATE, at("minimal"), "high"), false), false);
  assert.equal(fatalityPlays(goreShow(MATE, at("full", { reducedMotion: true }), "high"), false), false);
  assert.equal(fatalityPlays(goreShow(MATE, at("full", { captureCinematics: false }), "high"), false), false);
  assert.equal(fatalityPlays(goreShow(MATE, at("full", { tactical: true }), "high"), false), false);
  assert.equal(fatalityPlays(goreShow(MATE, at("full", { menuBoard: true }), "high"), false), false);
  assert.equal(fatalityPlays(goreShow({ ...MATE, victim: "k" }, at("full"), "high"), false), false, "a King is never taken");
  assert.equal(fatalityPlays(goreShow({ attacker: "p", victim: "p", style: "melee" }, at("full"), "ultra"), false), false, "an ordinary duel");
});

test("the close shot frames the wound on a long lens, near, from the player's side", () => {
  const home = { position: { x: 0, y: 6.4, z: 8.6 }, target: { x: 0, y: 0.9, z: 0.4 } };
  for (const height of [0.78, 1.32]) {
    const wound = { x: 1.2, y: height * 0.62, z: -1.5 };
    const view = riteShot(woundFrame(wound, height), { home, boardTop: 0, aspect: 16 / 9, fov: FATALITY.lens, radius: 10.6, close: true, closeReach: FATALITY.reach });
    const distance = Math.hypot(view.position.x - wound.x, view.position.y - wound.y, view.position.z - wound.z);
    assert.ok(distance >= RITE_SHOT.close - 1e-6 && distance < RITE_SHOT.close + 1.2, `the eye stands ${distance.toFixed(2)} from the wound`);
    assert.equal(view.fov, FATALITY.lens);
    // What the frame shows of the figure: much less than all of it, its chest at least.
    const shown = 2 * distance * Math.tan((view.fov / 2) * Math.PI / 180);
    assert.ok(shown < height * 1.8 && shown > height * 0.5, `${shown.toFixed(2)} of a ${height} figure in frame`);
    assert.ok(view.position.z > wound.z, "from the player's side");
    assert.ok(view.position.y > wound.y, "looking a little down on it");
  }
  // Without the reach, the close shot is the old one: nothing changes for the spells that use it.
  const wound = { x: 0, y: 0.5, z: 0 };
  const plain = riteShot(woundFrame(wound, 0.78), { home, boardTop: 0, aspect: 16 / 9, fov: 46, radius: 10.6, close: true });
  const same = riteShot(woundFrame(wound, 0.78), { home, boardTop: 0, aspect: 16 / 9, fov: 46, radius: 10.6, close: true, closeReach: RITE_SHOT.closeReach });
  assert.deepEqual(plain, same);
});

test("the close shot looks past the figures round the wound: on a full board it turns or climbs until the wound is clear", () => {
  const TILE = 1.02, FILES = "abcdefgh";
  const at = (square: string) => ({ x: (FILES.indexOf(square[0]) - 3.5) * TILE, z: (3.5 - (Number(square[1]) - 1)) * TILE });
  const heights: Record<string, number> = { p: 0.78, r: 0.98, n: 1.0, b: 1.04, q: 1.32, k: 1.48 };
  // The Scholar's mate as the Queen's spell lands on f7: every figure but the victim, the Queen still on h5.
  const board = "a8r c8b d8q e8k f8b h8r a7p b7p c7p d7p g7p h7p c6n f6n e5p h5q c4b e4p a2p b2p c2p d2p f2p g2p h2p a1r b1n c1b e1k g1n h1r";
  const standing = board.split(" ").map(item => ({ ...at(item.slice(0, 2)), radius: TILE * 0.27, height: heights[item[2]] }));
  const victim = at("f7"), wound = { x: victim.x, y: 0.78 * 0.62, z: victim.z + 0.06 };
  const input = { wound, height: 0.78, home: { position: { x: 0, y: 6.4, z: 8.6 }, target: { x: 0, y: 0.35, z: 0 } }, from: { ...at("h5"), y: 0 }, to: { ...victim, y: 0 }, boardTop: 0, aspect: 16 / 9, radius: 10.6, standing };
  const shot = woundShot(input);
  assert.equal(shot.occlusion, 0, `the wound is seen whole: ${JSON.stringify({ turn: shot.turn, down: shot.down })}`);
  // The plain shot, straight from the player's side at the usual steepness, would have looked through the f6 Knight.
  const plain = riteShot(woundFrame(wound, 0.78), { home: input.home, boardTop: 0, aspect: 16 / 9, fov: FATALITY.lens, radius: 10.6, close: true, closeReach: FATALITY.reach });
  const f6 = standing.find(s => Math.abs(s.x - at("f6").x) < 1e-6 && Math.abs(s.z - at("f6").z) < 1e-6)!;
  const t = ((f6.x - plain.position.x) * (wound.x - plain.position.x) + (f6.z - plain.position.z) * (wound.z - plain.position.z)) / ((wound.x - plain.position.x) ** 2 + (wound.z - plain.position.z) ** 2);
  assert.ok(t > 0 && t < 1, "the Knight stands between the player's side and the wound");
  // Still near: the frame is the wound and a little round it.
  const distance = Math.hypot(shot.view.position.x - wound.x, shot.view.position.y - wound.y, shot.view.position.z - wound.z);
  assert.ok(distance < 3.8, `${distance.toFixed(2)} from the wound`);
  // On an empty board nothing is in the way: the preferred shot, the first turn at the usual steepness.
  const open = woundShot({ ...input, standing: [] });
  assert.deepEqual([open.occlusion, open.down, open.turn], [0, WOUND_SHOT.downs[0], shotTurn(input.home, input.from, input.to) + WOUND_SHOT.turns[0]]);
});

test("a tier 2 kill that takes a limb off gets the cut: close on the body and the limb's flight, held, in the scene's own time", () => {
  const execution: KillMoment = { attacker: "n", victim: "n", style: "melee", weapon: "axe" };
  const full = goreShow(execution, at("full"), "high");
  assert.deepEqual([full.tier, full.sever], [2, true]);
  assert.equal(severCutPlays(full, false), true);
  assert.equal(severCutPlays(full, true), false, "not in a fight hurried past");
  assert.equal(severCutPlays(goreShow(execution, at("cinematic"), "high"), false), false, "no sever below Full, so no cut");
  assert.equal(severCutPlays(goreShow(MATE, at("full"), "high"), false), false, "a fatality keeps its whole sequence");
  // No slow motion; the close shot on the blow, the way back after about a second and a half, then the end.
  for (let t = 0; t < 3; t += 0.05) assert.equal(timeScaleAt(t, "cut"), 1);
  const heard: { beat: FatalityBeat; at: number }[] = [];
  let before = -1;
  for (let frame = 0; frame < 120; frame += 1) {
    const now = before < 0 ? 0 : before + 1 / 30;
    for (const beat of beatsBetween(before, now, "cut")) heard.push({ beat, at: now });
    before = now;
  }
  assert.deepEqual(heard.map(item => item.beat), ["close", "back", "end"]);
  assert.ok(Math.abs(heard[1].at - SEVER_CUT.hold) < 1 / 30 + 1e-9 && SEVER_CUT.hold >= 1.3 && SEVER_CUT.hold <= 1.7, "held about 1.5 s");
  assert.ok(Math.abs(heard[2].at - sequenceSeconds("cut")) < 1 / 30 + 1e-9);
});

test("an ordinary fight's look at the body: wherever a wound is shown, never hurried, in real time, short", () => {
  const duel: KillMoment = { attacker: "p", victim: "p", style: "melee", weapon: "spear" };
  assert.equal(woundLookPlays(goreShow(duel, at("full"), "high"), false), true);
  assert.equal(woundLookPlays(goreShow(duel, at("cinematic"), "high"), false), true, "Cinematic paints the wound too");
  assert.equal(woundLookPlays(goreShow(duel, at("minimal"), "high"), false), false, "Minimal shows none");
  assert.equal(woundLookPlays(goreShow(duel, at("full"), "high"), true), false, "hurried past");
  assert.equal(woundLookPlays(goreShow(duel, at("full", { tactical: true }), "high"), false), false, "the map");
  // No slow motion; it comes in at once, goes back after its hold, and lets go once it is back.
  for (const t of [0.1, 0.5, 1, 1.5]) assert.equal(timeScaleAt(t, "look"), 1);
  assert.deepEqual(beatsBetween(-1, 0, "look"), ["close"]);
  assert.deepEqual(beatsBetween(0, WOUND_LOOK.hold, "look"), ["back"]);
  assert.deepEqual(beatsBetween(WOUND_LOOK.hold, sequenceSeconds("look"), "look"), ["end"]);
  assert.ok(sequenceSeconds("look") < 2, `it holds the match up ${sequenceSeconds("look")} s at most`);
  // What it frames: the wound and the joints of the body near it, not the whole of the body lying there.
  const wound = { x: 0, y: 0.15, z: 0 };
  const joints = [{ x: 0.1, y: 0.12, z: 0.05 }, { x: -0.2, y: 0.1, z: 0 }, { x: 0.75, y: 0.1, z: 0.1 }];
  const frame = woundLookFrame(joints, wound, 0.78);
  assert.deepEqual(frame[0], wound);
  assert.equal(frame.length, 3, "the far foot is left out");
  assert.ok(frame.every(p => Math.hypot(p.x - wound.x, p.y - wound.y, p.z - wound.z) <= 0.78 * WOUND_LOOK.near + 1e-9));
});

test("the cut also keeps every way the body may fall: a ring round the stone, most of its height out", () => {
  const stone = { x: 0.5, y: 0, z: -1 }, cut = { x: 0.5, y: 0.85, z: -1 }, landing = { x: 1.5, y: 0, z: -1 };
  const frame = severFrame(stone, 1.0, cut, landing);
  const ring = frame.filter(p => p.y === stone.y && Math.abs(Math.hypot(p.x - stone.x, p.z - stone.z) - BODY_FALL) < 1e-9);
  assert.equal(ring.length, 6);
  // Toward the camera as much as away from it: whichever way the body goes down, it lies inside.
  for (const way of [{ x: 0, z: -1 }, { x: 0, z: 1 }, { x: 1, z: 0 }, { x: -1, z: 0 }]) {
    assert.ok(ring.some(p => ((p.x - stone.x) * way.x + (p.z - stone.z) * way.z) / BODY_FALL > 0.85), JSON.stringify(way));
  }
});

test("the cut frames the body and where the limb comes down, as the sever throws it", () => {
  // Knight takes Knight (b1c3 g8f6 c3d5 f6d5): Solforiz's cleaver on Aethelgard's Knight on d5, from f6.
  const TILE = 1.02, FILES = "abcdefgh";
  const square = (s: string) => ({ x: (FILES.indexOf(s[0]) - 3.5) * TILE, y: 0, z: (3.5 - (Number(s[1]) - 1)) * TILE });
  const victim = square("d5"), killer = square("f6");
  const blow = { x: victim.x - killer.x, y: 0, z: victim.z - killer.z }, l = Math.hypot(blow.x, blow.z);
  const cut = { x: victim.x - blow.x / l * 0.12, y: 0.85, z: victim.z - blow.z / l * 0.12 };
  const { velocity } = limbLaunch([blow.x / l, 0, blow.z / l], 1.1, 77, 0, "head");
  const landing = limbLanding(cut, { x: velocity[0], y: velocity[1], z: velocity[2] }, 0);
  // Where gravity brings it down: on the stone, a square or so away along the blow.
  const away = Math.hypot(landing.x - victim.x, landing.z - victim.z);
  assert.ok(away > 0.3 && away < 2.6 * TILE, `${away.toFixed(2)} from the body`);
  assert.equal(landing.y, 0);
  const t = (velocity[1] + Math.sqrt(velocity[1] ** 2 + 2 * 9.81 * cut.y)) / 9.81;
  assert.ok(Math.abs(cut.y + velocity[1] * t - 0.5 * 9.81 * t * t) < 1e-9, "it comes down on the stone");
  // The close shot keeps the body and the landing in frame, from the player's side.
  const frame = severFrame(victim, 1.0, cut, landing);
  const home = { position: { x: 0, y: 6.4, z: 8.6 }, target: { x: 0, y: 0.35, z: 0 } };
  const shot = woundShot({ frame, lens: 46, reach: RITE_SHOT.closeReach, downs: SEVER_CUT.downs, wound: cut, height: 1.0, home, from: killer, to: victim, boardTop: 0, aspect: 16 / 9, radius: 10.6, standing: [] });
  const view = shot.view, fwd = { x: view.target.x - view.position.x, y: view.target.y - view.position.y, z: view.target.z - view.position.z };
  const fl = Math.hypot(fwd.x, fwd.y, fwd.z);
  for (const p of frame) {
    const d = { x: p.x - view.position.x, y: p.y - view.position.y, z: p.z - view.position.z }, dl = Math.hypot(d.x, d.y, d.z);
    const angle = Math.acos((d.x * fwd.x + d.y * fwd.y + d.z * fwd.z) / (dl * fl)) * 180 / Math.PI;
    assert.ok(angle < view.fov * 0.5 * 16 / 9, `${JSON.stringify(p)} is ${angle.toFixed(1)} degrees off the view`);
  }
  assert.ok(view.position.z > victim.z, "from the player's side");
  const distance = Math.hypot(view.position.x - victim.x, view.position.z - victim.z);
  assert.ok(distance < 8, `close: ${distance.toFixed(2)} from the body (the player's view is about 10)`);
});

test("the crests wait while a close shot's camera comes home, and while a shot that took the camera from it comes in", () => {
  const pose = (x: number) => ({ position: { x, y: 2, z: 4 }, target: { x, y: 0, z: 0 }, fov: 30 });
  const shot = (x: number): DuelShot => ({ ...pose(x), push: pose(x).position, killSeen: true, side: 1, lean: 0, pitch: 0, distance: 0, occlusion: 0, fill: 0, confined: false });
  const look = new DuelCameraTimeline(pose(0), shot(1), { easeIn: 0.4, easeOut: 0.6 });
  look.update(0.5);
  assert.equal(look.phase, "hold");
  assert.equal(closeShotWaits(look, look), true, "kept on the body for the Claiming");
  look.release();
  look.update(0.3);
  assert.equal(closeShotWaits(look, look), true, "on its way home");
  // The Claiming's shot takes the camera on the way, from where the look has got to.
  const claim = new DuelCameraTimeline(pose(0), shot(3), { from: look.current, easeIn: 1.15 });
  claim.update(0.5);
  assert.equal(closeShotWaits(look, claim), true, "the Claiming's shot still coming in from the close view");
  claim.update(0.7);
  assert.equal(claim.phase, "hold");
  assert.equal(closeShotWaits(look, claim), false, "come in: the crests come back");
  assert.equal(closeShotWaits(look, null), false, "home, and nothing holds the camera");
});
