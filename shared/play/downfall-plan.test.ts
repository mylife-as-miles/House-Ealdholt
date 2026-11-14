/**
 * The downfall's pure half (web/src/scene/downfall): who learns first, who kneels, when hands open, where every
 * weapon comes to rest, and the shots. Board positions are the scene's own (board.ts squareToWorld: TILE 1.02,
 * White at +z).
 */
import assert from "node:assert/strict";
import test from "node:test";
import { Chess } from "chess.js";
import {
  DOWNFALL_TIMELINES, KNEEL_TOTAL, downfallBeat, downfallKind, hash01, placeFallenProps, planDownfall,
  type DownfallFigure, type DownfallPlan, type FallenPropInput,
} from "../../web/src/scene/downfall/downfallPlan";
import { frameOf, kneelProgress, planDownfallCamera, type CameraPose, type DownfallCameraInput } from "../../web/src/scene/downfall/downfallCamera";

const TILE = 1.02;
const HEIGHT = { p: 0.78, r: 0.98, n: 1.0, b: 1.04, q: 1.32, k: 1.48 } as const;
const at = (square: string) => ({ x: ("abcdefgh".indexOf(square[0]) - 3.5) * TILE, z: (3.5 - (Number(square[1]) - 1)) * TILE });
function board(moves: string[]): { figures: DownfallFigure[]; game: Chess } {
  const game = new Chess();
  for (const move of moves) game.move(move);
  const figures: DownfallFigure[] = [];
  for (const row of game.board()) for (const cell of row) if (cell) figures.push({ id: `id-${cell.square}`, square: cell.square, kind: cell.type, color: cell.color, ...at(cell.square) });
  return { figures, game };
}
const FOOL = ["f3", "e5", "g4", "Qh4#"];
const SCHOLAR = ["e4", "e5", "Bc4", "Nc6", "Qh5", "Nf6", "Qxf7#"];

test("only checkmate, resignation and time losses are staged as a downfall; draws keep their own ending", () => {
  assert.equal(downfallKind("checkmate"), "checkmate");
  assert.equal(downfallKind("resignation"), "resignation");
  assert.equal(downfallKind("timeout"), "timeout");
  for (const reason of ["stalemate", "threefold", "insufficient", "fiftymove", "draw", "objective", null, undefined]) assert.equal(downfallKind(reason), null);
  assert.ok(DOWNFALL_TIMELINES.checkmate.end > 14 && DOWNFALL_TIMELINES.checkmate.end < 15, "the checkmate's downfall runs under fifteen seconds");
  assert.ok(DOWNFALL_TIMELINES.resignation.end <= 7.5 && DOWNFALL_TIMELINES.timeout.end <= 7.5, "the yield is the short version");
  for (const timeline of Object.values(DOWNFALL_TIMELINES)) {
    assert.ok(timeline.realize <= timeline.spread && timeline.spread < timeline.spreadEnd, `${timeline.kind}: the realization reaches the army after the King`);
    assert.ok(timeline.breaks < timeline.drop && timeline.drop < timeline.kneel && timeline.kneel < timeline.knelt && timeline.knelt <= timeline.hold, `${timeline.kind}: break, drop, kneel, hold in order`);
    assert.equal(timeline.knelt, timeline.kneel + KNEEL_TOTAL);
    assert.ok(timeline.hold < timeline.final && timeline.final < timeline.end, `${timeline.kind}: the long hold, then the pull back`);
  }
  const mate = DOWNFALL_TIMELINES.checkmate;
  assert.equal(mate.alone, 5);
  assert.ok(mate.final - mate.hold >= 3.5, "the hold on the kneeling King is long");
  assert.deepEqual([0.5, 2, 5.2, 5.8, 6.5, 7.5, 10, 13.5].map(time => downfallBeat(mate, time)),
    ["realize", "collapse", "alone", "breaks", "falls", "kneels", "hold", "final-shot"]);
  assert.deepEqual([0.2, 0.7, 1.2, 2, 4, 6].map(time => downfallBeat(DOWNFALL_TIMELINES.resignation, time)),
    ["realize", "breaks", "falls", "kneels", "hold", "final-shot"]);
});

test("the realization spreads through the beaten army from its King outward, and every figure is accounted for", () => {
  const { figures } = board(SCHOLAR);
  const plan = planDownfall({ reason: "checkmate", winner: "w", figures, threat: "f7", squareSize: TILE })!;
  assert.ok(plan);
  assert.equal(plan.loser, "b");
  assert.equal(plan.king.square, "e8"); assert.equal(plan.king.royal, true); assert.equal(plan.king.gesture, "kneel");
  assert.equal(plan.king.start, 0, "the King learns it first");
  assert.deepEqual(plan.king.glance, at("f7"), "he looks at the piece that gives check");
  assert.equal(plan.victorKing?.square, "e1");
  assert.deepEqual(plan.victorKing?.look, at("e8"), "the victorious sovereign watches him");
  assert.ok(plan.victorKing!.nod! > plan.timeline.hold && plan.victorKing!.nod! < plan.timeline.final, "and nods once during the hold");
  const beaten = figures.filter(figure => figure.color === "b" && figure.kind !== "k");
  assert.equal(plan.defeated.length, beaten.length);
  assert.equal(plan.victors.length, figures.filter(figure => figure.color === "w" && figure.kind !== "k").length);
  const king = at("e8");
  const distance = (square: string) => Math.hypot(at(square).x - king.x, at(square).z - king.z) / TILE;
  for (const role of plan.defeated) {
    assert.ok(role.start >= plan.timeline.spread - 1e-9 && role.start <= plan.timeline.spreadEnd + 1e-9, `${role.square} learns within the spread`);
    assert.ok(role.drop > role.start && role.kneel > role.drop, `${role.square}: the hands open before the step back`);
    assert.ok(role.kneel >= role.start + 0.45, `${role.square}: its stance has settled before its legs are measured`);
    assert.equal(role.gesture, role.kind === "q" ? "bow" : "kneel");
    assert.deepEqual(role.glance, king, "each looks to its King first");
    assert.ok(role.dim.from >= role.start && role.dim.to > role.dim.from);
  }
  // Nearest first: a figure two squares farther never learns before a nearer one (the jitter is a fraction of a square).
  for (const a of plan.defeated) for (const b of plan.defeated) if (distance(b.square) > distance(a.square) + 2) assert.ok(b.start > a.start, `${a.square} before ${b.square}`);
  assert.ok(plan.king.dim.from >= plan.timeline.breaks, "the King's crest fades only as his defiance breaks");
  assert.ok(plan.king.dim.to - plan.king.dim.from >= 2.5, "slowly: it fades, it does not pop");
  assert.equal(plan.shade.side, -1, "the light leaves Black's half");
});

test("the plan is the same every time for the same ending, whatever the figures' ids", () => {
  const { figures } = board(FOOL);
  const one = planDownfall({ reason: "checkmate", winner: "b", figures, threat: "h4", squareSize: TILE })!;
  const two = planDownfall({ reason: "checkmate", winner: "b", figures: figures.map(figure => ({ ...figure })), threat: "h4", squareSize: TILE })!;
  assert.deepEqual(one, two);
  const renamed = planDownfall({ reason: "checkmate", winner: "b", figures: figures.map(figure => ({ ...figure, id: `other-${figure.square}` })), threat: "h4", squareSize: TILE })!;
  const timing = (plan: DownfallPlan) => [plan.king, ...plan.defeated].map(role => [role.square, role.start, role.drop, role.kneel, role.rearSide, role.gesture]);
  assert.deepEqual(timing(renamed), timing(one));
  assert.equal(renamed.key, one.key);
  assert.ok(hash01("e2:wave") >= 0 && hash01("e2:wave") < 1);
  assert.equal(planDownfall({ reason: "checkmate", winner: "b", figures: figures.filter(figure => !(figure.kind === "k" && figure.color === "w")), threat: null, squareSize: TILE }), null, "no beaten King, nothing to stage");
});

test("its variety comes from the match's seed: the same seed stages the same ending, another seed another, on the same board facts", () => {
  const { figures } = board(SCHOLAR);
  const plan = (seed?: number) => planDownfall({ reason: "checkmate", winner: "w", figures, threat: "f7", squareSize: TILE, seed })!;
  const timing = (p: DownfallPlan) => [p.king, ...p.defeated].map(role => [role.square, role.start, role.drop, role.kneel, role.rearSide]);
  const facts = (p: DownfallPlan) => [p.king, ...p.defeated].map(role => [role.square, role.gesture]).sort();
  assert.deepEqual(plan(0x5eed1234), plan(0x5eed1234));
  assert.notDeepEqual(timing(plan(0x5eed1234)), timing(plan(0x0badf00d)));
  assert.notEqual(plan(0x5eed1234).key, plan(0x0badf00d).key);
  assert.deepEqual(facts(plan(0x5eed1234)), facts(plan(0x0badf00d)), "who kneels and who bows is the board's");
  assert.deepEqual(plan(0), plan(undefined), "no seed: the squares alone");
  for (const seed of [1, 0x5eed1234, 0xffffffff]) {
    const p = plan(seed);
    for (const role of p.defeated) assert.ok(role.start >= p.timeline.spread && role.start <= p.timeline.spreadEnd + 1e-9, `${seed}: ${role.square} learns within the wave`);
  }
});

test("a resignation and a time loss are the short version, and the King looks at the victor rather than a checking piece", () => {
  const { figures } = board(["e4", "e5", "Nf3", "Nc6"]);
  for (const reason of ["resignation", "timeout"] as const) {
    const plan = planDownfall({ reason, winner: "b", figures, threat: null, squareSize: TILE })!;
    assert.equal(plan.timeline.alone, null, "watched in one shot");
    assert.deepEqual(plan.king.glance, at("e8"));
    for (const role of plan.defeated) assert.equal(role.glance, null);
    assert.ok(Math.max(...plan.defeated.map(role => role.kneel)) < plan.timeline.hold, "the army is down before the hold");
    assert.ok(plan.shade.strength < 0.3, "a quieter fall of the light");
  }
});

test("each fallen weapon rests beside its owner on the side of the hand that held it, clear of every foot and of other weapons", () => {
  const { figures } = board(SCHOLAR);
  const plan = planDownfall({ reason: "checkmate", winner: "w", figures, threat: "f7", squareSize: TILE })!;
  const facing = { x: 0, z: 1 }; // Black faces +z
  const props: FallenPropInput[] = [];
  for (const role of [plan.king, ...plan.defeated]) {
    const where = at(role.square), height = HEIGHT[role.kind];
    props.push({ key: `${role.square}:0`, ...where, facing, hand: 1, length: 0.95 * height, width: 0.07, height, rear: role.gesture === "kneel" ? (role.rearSide === "right" ? 1 : -1) : 0 });
    if (role.kind === "p" || role.kind === "n") props.push({ key: `${role.square}:1`, ...where, facing, hand: -1, length: 0.32, width: 0.3, height, rear: role.gesture === "kneel" ? (role.rearSide === "right" ? 1 : -1) : 0 });
  }
  const feet = figures.map(figure => ({ ...at(figure.square), r: 0.12 * HEIGHT[figure.kind] }));
  const placed = placeFallenProps(props, feet);
  assert.equal(placed.length, props.length);
  assert.deepEqual(placeFallenProps(props, feet), placed, "the same board gives the same resting places");
  const right = { x: -facing.z, z: facing.x };
  for (const spot of placed) {
    const prop = props.find(entry => entry.key === spot.key)!;
    const offset = (spot.x - prop.x) * right.x + (spot.z - prop.z) * right.z;
    assert.ok(Math.sign(offset) === prop.hand, `${spot.key} lies on its hand's side`);
    assert.ok(Math.abs(offset) <= 0.5, `${spot.key} lies beside its owner (${offset.toFixed(2)})`);
    assert.ok(spot.clearance >= 0.03, `${spot.key} is clear of feet, its owner's knee and other weapons (${spot.clearance.toFixed(3)})`);
    assert.ok(Number.isFinite(spot.yaw));
  }
  // With room to spare it lies along the way its owner faced: turned only as far as it must be.
  const lone = placeFallenProps([{ key: "k", x: 0, z: 0, facing, hand: 1, length: 1, width: 0.06, height: 1.48, rear: -1 }], []);
  assert.ok(Math.abs(Math.sin(lone[0].yaw - Math.atan2(facing.x, facing.z))) < 1e-9, "parallel to the facing when nothing is in the way");
});

function cameraInput(moves: string[], winner: "w" | "b", reason: "checkmate" | "resignation" = "checkmate"): { input: DownfallCameraInput; plan: DownfallPlan } {
  const { figures, game } = board(moves);
  const threat = reason === "checkmate" ? game.attackers(game.board().flat().find(cell => cell?.type === "k" && cell.color === game.turn())!.square, winner)[0] ?? null : null;
  const plan = planDownfall({ reason, winner, figures, threat, squareSize: TILE })!;
  const king = figures.find(figure => figure.id === plan.king.id)!, victor = figures.find(figure => figure.id === plan.victorKing?.id)!;
  const kneels = new Set(plan.defeated.filter(role => role.gesture === "kneel").map(role => role.id));
  return {
    plan,
    input: {
      plan,
      king: { x: king.x, z: king.z, facing: { x: 0, z: plan.loser === "w" ? -1 : 1 }, height: HEIGHT.k },
      victor: { x: victor.x, z: victor.z, height: HEIGHT.k },
      army: figures.filter(figure => figure.color === plan.loser).map(figure => ({ x: figure.x, z: figure.z })),
      standing: figures.filter(figure => figure !== king).map(figure => ({ x: figure.x, z: figure.z, height: HEIGHT[figure.kind], kneels: kneels.has(figure.id) })),
      origin: { position: { x: 0, y: 6.4, z: winner === "w" ? 8.6 : 8.6 }, target: { x: 0, y: 0, z: 0 }, fov: 46 },
      lens: 46, aspect: 16 / 9, reach: 10.5,
    },
  };
}

const finitePose = (pose: CameraPose) => [pose.position.x, pose.position.y, pose.position.z, pose.target.x, pose.target.y, pose.target.z, pose.fov].every(Number.isFinite);

test("the shots frame the King: realizing, alone, and kneeling with the victorious sovereign behind him", () => {
  for (const [moves, winner] of [[SCHOLAR, "w"], [FOOL, "b"]] as const) {
    const { input, plan } = cameraInput([...moves], winner);
    const camera = planDownfallCamera(input);
    const { shots } = camera;
    const head = { x: input.king.x, y: input.king.height * 0.85, z: input.king.z };
    for (const [name, pose] of [["realize", shots.realize], ["alone", shots.alone!], ["hold", shots.hold[0]], ["hold end", shots.hold[1]]] as const) {
      assert.ok(finitePose(pose), `${name} is finite`);
      assert.ok(Math.hypot(pose.position.x, pose.position.z) <= 10.5 + 1e-9, `${name} stays inside the hall`);
      const kneelingHead = { ...head, y: name.startsWith("hold") ? input.king.height * 0.5 : head.y };
      const seen = frameOf(pose, 16 / 9, kneelingHead);
      assert.ok(seen.ahead && Math.abs(seen.x) < 0.85 && Math.abs(seen.y) < 0.9, `${name}: the King is in frame (${seen.x.toFixed(2)}, ${seen.y.toFixed(2)})`);
    }
    assert.ok(shots.alone!.fov < input.lens, "alone: a longer lens");
    assert.ok(Math.hypot(shots.alone!.position.x - input.king.x, shots.alone!.position.z - input.king.z) < 2.5 * input.king.height, "alone: close to him");
    // Standing, from his knees (or, framed close where others crowd him, his chest) to the crest over his head (it
    // fades while he breaks); on his knee, all of him.
    const close = shots.alone!.fov < Math.min(input.lens, 30) - 1e-9;
    const knees = frameOf(shots.alone!, 16 / 9, { x: input.king.x, y: input.king.height * (close ? 0.52 : 0.25), z: input.king.z });
    const crest = frameOf(shots.alone!, 16 / 9, { x: input.king.x, y: input.king.height * 1.33, z: input.king.z });
    assert.ok(knees.y > -1 && crest.y < 1, `alone: his ${close ? "chest" : "knees"} and the crest over his head are in frame (${knees.y.toFixed(2)}, ${crest.y.toFixed(2)})`);
    const down = camera.at(plan.timeline.knelt + 0.1);
    const feet = frameOf(down, 16 / 9, { x: input.king.x, y: 0.02, z: input.king.z }), bowed = frameOf(down, 16 / 9, { x: input.king.x, y: input.king.height * 0.66, z: input.king.z });
    assert.ok(feet.y > -1 && bowed.y < 1, `alone, kneeling: his knee on the stone and his bowed head are in frame (${feet.y.toFixed(2)}, ${bowed.y.toFixed(2)})`);
    if (shots.victorInHold) {
      const seen = frameOf(shots.hold[0], 16 / 9, { x: input.victor!.x, y: input.victor!.height * 0.9, z: input.victor!.z });
      assert.ok(seen.ahead && Math.abs(seen.x) < 0.85, "the victor stands in the hold's frame");
    }
    const final = camera.at(plan.timeline.end);
    assert.ok(Math.abs(final.position.y - 6.8) < 1e-6, "the final view is the board's wide view, as before");
    assert.equal(final.fov, input.lens, "on the match's own lens");
    // Continuous but for the two planned cuts (to the King alone, and to the hold).
    let previous = camera.at(0);
    assert.ok(Math.hypot(previous.position.x - input.origin.position.x, previous.position.y - input.origin.position.y, previous.position.z - input.origin.position.z) < 1e-6, "it starts from the player's view");
    for (let time = 1 / 60; time <= plan.timeline.end; time += 1 / 60) {
      const pose = camera.at(time);
      assert.ok(finitePose(pose), `finite at ${time.toFixed(2)}`);
      const jump = Math.hypot(pose.position.x - previous.position.x, pose.position.y - previous.position.y, pose.position.z - previous.position.z);
      const cut = [plan.timeline.alone!, plan.timeline.hold].some(at => Math.abs(time - at) < 1 / 60 + 1e-9);
      if (!cut) assert.ok(jump < 0.35, `no jump at ${time.toFixed(2)} (${jump.toFixed(3)})`);
      previous = pose;
    }
  }
});

test("the King's close shot and the hold are taken from where no one stands before him and few crowd him", () => {
  for (const [moves, winner] of [[SCHOLAR, "w"], [FOOL, "b"]] as const) {
    const { input } = cameraInput([...moves], winner);
    const { shots } = planDownfallCamera(input);
    const eyeTo = (pose: CameraPose, spot: { x: number; z: number }) => Math.hypot(spot.x - pose.position.x, spot.z - pose.position.z);
    for (const [name, pose, top] of [["alone", shots.alone!, input.king.height], ["hold", shots.hold[0], input.king.height * 0.62]] as const) {
      const kingX = [0.02, top].map(y => frameOf(pose, 16 / 9, { x: input.king.x, y, z: input.king.z }).x);
      const half = 0.24 * input.king.height / (eyeTo(pose, input.king) * Math.tan(pose.fov * Math.PI / 360) * 16 / 9);
      const [k0, k1] = [Math.min(...kingX) - half, Math.max(...kingX) + half];
      for (const figure of input.standing) {
        if (input.victor && Math.hypot(figure.x - input.victor.x, figure.z - input.victor.z) < 1e-3) continue;
        if (figure.kneels || eyeTo(pose, figure) >= eyeTo(pose, input.king) - 0.15) continue;
        const at = frameOf(pose, 16 / 9, { x: figure.x, y: figure.height * 0.5, z: figure.z });
        if (!at.ahead) continue;
        const w = 0.24 * figure.height / (eyeTo(pose, figure) * Math.tan(pose.fov * Math.PI / 360) * 16 / 9);
        assert.ok(at.x + w <= k0 || at.x - w >= k1, `${moves.at(-1)} ${name}: a figure still standing at (${figure.x.toFixed(2)}, ${figure.z.toFixed(2)}) is not before the King`);
      }
    }
  }
});

test("alone means alone: crowded at both shoulders, the King is framed close; the hold is never on his back", () => {
  // Scholar's mate: his own Queen bows at one shoulder, the mating Queen stands at the other.
  const { input, plan } = cameraInput(SCHOLAR, "w");
  const camera = planDownfallCamera(input);
  const alone = camera.shots.alone!;
  assert.ok(alone.fov < 30, "the close framing, on a longer lens");
  for (const figure of input.standing) {
    const at = frameOf(alone, 16 / 9, { x: figure.x, y: figure.height * (figure.kneels ? 0.35 : 0.5), z: figure.z });
    assert.ok(!at.ahead || Math.abs(at.x) > 1 || Math.abs(at.y) > 1, `nobody else in his frame (one at ${figure.x.toFixed(2)}, ${figure.z.toFixed(2)})`);
  }
  // It draws back to the whole of him as he goes down: the lens and the distance of the wider framing on his knee.
  const down = camera.at(plan.timeline.knelt + 0.1);
  assert.ok(Math.abs(down.fov - Math.min(input.lens, 30)) < 1e-6, "on his knee: the wider lens");
  // The hold: side-on or nearer, never round behind him, in every mate here.
  for (const [moves, winner] of [[SCHOLAR, "w"], [FOOL, "b"]] as const) {
    const { input: seen } = cameraInput([...moves], winner);
    const hold = planDownfallCamera(seen).shots.hold[0];
    const azimuth = Math.atan2(hold.position.x - seen.king.x, hold.position.z - seen.king.z), facing = Math.atan2(seen.king.facing.x, seen.king.facing.z);
    const round = Math.abs(Math.atan2(Math.sin(azimuth - facing), Math.cos(azimuth - facing)));
    assert.ok(round <= 2.0 + 1e-9, `${moves.at(-1)}: the hold ${(round * 180 / Math.PI).toFixed(0)} degrees round from his facing`);
  }
});

test("the close shot follows the King's head down as he kneels", () => {
  const { input, plan } = cameraInput(SCHOLAR, "w");
  const camera = planDownfallCamera(input);
  const standing = camera.at(plan.timeline.breaks), kneeling = camera.at(plan.timeline.knelt + 0.1);
  assert.equal(kneelProgress(plan, plan.timeline.kneel), 0);
  assert.equal(kneelProgress(plan, plan.timeline.knelt), 1);
  assert.ok(kneeling.target.y < standing.target.y - 0.25, "the aim comes down with him");
});

test("a resignation is watched in one shot that pushes in while he kneels", () => {
  const { input, plan } = cameraInput(["e4", "e5", "Nf3", "Nc6"], "b", "resignation");
  const camera = planDownfallCamera(input);
  assert.equal(camera.shots.collapse, null); assert.equal(camera.shots.alone, null);
  const early = camera.at(1.4), late = camera.at(plan.timeline.hold - 0.01);
  const distance = (pose: CameraPose) => Math.hypot(pose.position.x - input.king.x, pose.position.z - input.king.z);
  assert.ok(distance(late) < distance(early), "it pushes in");
});

test("no shot sees the King through the arena's stone or stands inside it", () => {
  const { input, plan } = cameraInput(SCHOLAR, "w");
  // A wall of stone behind Black's back rank (the skull's side of the arena): nothing beyond z = -4.6 sees the board.
  const sight = (eye: { z: number }) => eye.z > -4.6;
  const camera = planDownfallCamera({ ...input, sight });
  const { shots } = camera;
  for (const [name, pose] of [["realize", shots.realize], ["collapse", shots.collapse!], ["alone", shots.alone!], ["hold", shots.hold[0]], ["hold end", shots.hold[1]], ["final", shots.final]] as const) {
    assert.ok(pose.position.z > -4.6, `${name} stands clear of the stone (z ${pose.position.z.toFixed(2)})`);
  }
  for (let time = 0; time <= plan.timeline.end; time += 0.25) assert.ok(finitePose(camera.at(time)));
});
