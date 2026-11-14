import assert from "node:assert/strict";
import { test } from "node:test";
import { musterReveal, type OpeningPose, type OpeningShot, type OpeningVector } from "../../web/src/scene/matchOpening";
import type { MatchConfig } from "./match";
import { buildMatchOpening } from "./match-opening";

const duel: MatchConfig = { mode: "local-duel", setting: "scene-01", difficulty: "medium", playerColor: "w", clockMinutes: null, armies: { w: "empire", b: "kwind" } };
const classic = (playerColor: "w" | "b"): MatchConfig => ({ mode: "classic", setting: "scene-02", difficulty: "hard", playerColor, clockMinutes: 5, armies: { w: "ivory", b: "sun" } });

// Where a point lands in a pose's picture: -1 to 1 across its width and up its height, for a screen of this shape. The
// shots keep their lens on every screen, so a narrower one sees less to the sides (the engine's camera: up is +y).
const WIDE = 16 / 9, SQUARE = 4 / 3;
/** The top of the picture under the letterbox (MatchOpening.css: each bar is 10.5% of the height). */
const UNDER_BAR = 1 - 2 * 0.105;
function project(pose: OpeningPose, aspect: number, point: OpeningVector): [number, number] {
  const sub = (a: OpeningVector, b: OpeningVector): OpeningVector => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const dot = (a: OpeningVector, b: OpeningVector) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const unit = (a: OpeningVector): OpeningVector => { const n = Math.hypot(...a); return [a[0] / n, a[1] / n, a[2] / n]; };
  const forward = unit(sub(pose.target, pose.position)), right = unit([-forward[2], 0, forward[0]]);
  const up: OpeningVector = [right[1] * forward[2] - right[2] * forward[1], right[2] * forward[0] - right[0] * forward[2], right[0] * forward[1] - right[1] * forward[0]];
  const offset = sub(point, pose.position), depth = dot(offset, forward), lens = Math.tan(((pose.fov ?? 46) * Math.PI) / 360);
  return [dot(offset, right) / depth / (lens * aspect), dot(offset, up) / depth / lens];
}
/** A shot's pose part of the way along its line (the eases only change when it gets there). */
function along(shot: OpeningShot, t: number): OpeningPose {
  const from = shot.from, to = shot.to as OpeningPose, mix = (a: number, b: number) => a + (b - a) * t;
  return { position: [0, 1, 2].map((i) => mix(from.position[i]!, to.position[i]!)) as unknown as OpeningVector,
    target: [0, 1, 2].map((i) => mix(from.target[i]!, to.target[i]!)) as unknown as OpeningVector, fov: mix(from.fov ?? 46, to.fov ?? 46) };
}
// The eclipse as the battlefield look draws it on both battlefields: a sphere at the look's CFCL_Eclipse_Body (main
// game/src/play/battlefield-look.ts), in a world scaled by 1/2.3. Violet Night's ring of light reaches about one and a
// half of its radii above its middle.
const ECLIPSE: OpeningVector = [6.85, 41.52, -200.72], ECLIPSE_RADIUS = 21.76;

test("the whole opening: the arena, each army taking the field, the two against each other, then the match's own view", () => {
  const plan = buildMatchOpening(duel, "full");
  assert.deepEqual(plan.beats.map((beat) => beat.id), ["arena", "white", "black", "versus", "begin"]);
  assert.equal(plan.shots.length, 5);
  assert.ok(plan.seconds >= 9 && plan.seconds <= 12, `a short opening, not ${plan.seconds}s`);
  assert.deepEqual(plan.beats.map((beat) => beat.at), plan.beats.map((_, index) => plan.shots.slice(0, index).reduce((sum, shot) => sum + shot.seconds, 0)));
  // Both armies are absent until their own shot, and it ends where the match is played from.
  assert.deepEqual(plan.shots.map((shot) => shot.muster?.side ?? null), [null, "w", "b", null, null]);
  assert.equal(plan.shots[plan.shots.length - 1]!.to, "rest");
  assert.equal(plan.battlefield.title, "Eclipse");
  assert.equal(plan.mode, "Local Duel");
});

test("each kingdom is named by the army it fields, with who leads it", () => {
  const plan = buildMatchOpening(duel, "full");
  assert.deepEqual(plan.kingdoms.w, { side: "w", army: "empire", name: "Korvenia", detail: "Muskets, rifles and cannon", role: "Player 1" });
  assert.deepEqual(plan.kingdoms.b, { side: "b", army: "kwind", name: "Kwind-09", detail: "Arc-tech, shock pikes and steam", role: "Player 2" });
  const first = buildMatchOpening(classic("w"), "full");
  assert.deepEqual([first.kingdoms.w.role, first.kingdoms.b.role, first.kingdoms.w.name, first.kingdoms.b.name], ["You", "Computer", "Aethelgard", "Solforiz"]);
  assert.equal(first.battlefield.title, "Violet Night");
});

test("each army is filmed from in front of its own ranks, ending before its King and Queen", () => {
  const plan = buildMatchOpening(duel, "full");
  for (const [index, side] of [[1, 1], [2, -1]] as const) {
    const shot = plan.shots[index]!, from = shot.from, to = shot.to as OpeningPose;
    // The camera stands on the board, nearer the middle than the Pawns, looking at the back rank.
    for (const pose of [from, to]) {
      assert.ok(Math.abs(pose.position[2]) < 2, "before the Pawns");
      assert.ok(pose.target[2] * side > 3, "looking at the back rank");
      assert.ok(pose.position[1] > 0.6 && pose.position[1] < 1.6, "at the height of a figure");
    }
    assert.ok(Math.abs(to.position[0]) < 2 && Math.abs(to.target[0]) < 1.5, "it ends by the middle files");
    assert.equal(shot.muster?.from, "flanks");
  }
});

test("the player's army is on the left of the versus shot, and the opening ends on their side of the board", () => {
  const white = buildMatchOpening(classic("w"), "full"), black = buildMatchOpening(classic("b"), "full");
  assert.deepEqual([white.preset, white.left], ["white", "w"]);
  assert.deepEqual([black.preset, black.left], ["black", "b"]);
  // Looking across the board from +x, White (at +z) is on the left; from -x, Black is.
  const versus = (plan: typeof white) => plan.beats.find((beat) => beat.id === "versus")!.shot.to as OpeningPose;
  assert.ok(versus(white).position[0] > 6);
  assert.ok(versus(black).position[0] < -6);
  assert.deepEqual([black.kingdoms.b.role, black.kingdoms.w.role], ["You", "Computer"]);
  // A duel is always seen from player one's side.
  assert.deepEqual([buildMatchOpening({ ...duel, playerColor: "b" }, "full").preset, buildMatchOpening(duel, "full").left], ["white", "w"]);
});

test("a rematch plays only the two armies against each other and the turn to the match", () => {
  const plan = buildMatchOpening(duel, "short");
  assert.deepEqual(plan.beats.map((beat) => beat.id), ["versus", "begin"]);
  assert.ok(plan.seconds < 5);
  // No army is hidden: both stand from the first frame.
  assert.ok(plan.shots.every((shot) => !shot.muster));
  assert.equal(plan.shots[1]!.path, "orbit");
});

test("the arena holds the eclipse whole under the letterbox all the way in, and the board right of the middle", () => {
  const arena = buildMatchOpening(duel, "full").shots[0]!;
  for (const t of [0, 0.5, 1]) for (const aspect of [WIDE, SQUARE]) {
    const pose = along(arena, t), [x, y] = project(pose, aspect, ECLIPSE);
    // One radius of it, as a share of the picture's half-height.
    const radius = ECLIPSE_RADIUS / Math.hypot(...ECLIPSE.map((v, i) => v - pose.position[i]!)) / Math.tan(((pose.fov ?? 46) * Math.PI) / 360);
    assert.ok(y + 1.5 * radius <= UNDER_BAR, `its ring under the upper bar ${t} of the way in, not up to ${(y + 1.5 * radius).toFixed(2)}`);
    assert.ok(Math.abs(x) + radius < 0.9, "well inside the picture's width");
    // The board's left edge stays right of the middle: the battlefield's name stands on the left.
    for (const z of [-4.6, 4.6]) assert.ok(project(pose, aspect, [-4.6, 0, z])[0] > -0.12, `the board right of the middle ${t} of the way in`);
  }
});

test("each army's King and Queen stand whole at the end of its shot, on a 4:3 screen too, and clear of the name's half", () => {
  const plan = buildMatchOpening(duel, "full");
  for (const [index, side] of [[1, 1], [2, -1]] as const) {
    const end = plan.shots[index]!.to as OpeningPose, rank = 3.57 * side;
    // The two of them (the King on the e-file, the Queen on the d-file), feet to crown, with their arms and weapons.
    const corners = ([[0.51, 1.48], [-0.51, 1.32]] as const).flatMap(([file, height]) => [-0.42, 0.42].flatMap((reach) => [0, height].map((y): OpeningVector => [file + reach, y, rank])));
    for (const corner of corners) {
      const across = project(end, SQUARE, corner)[0], up = project(end, WIDE, corner)[1];
      assert.ok(Math.abs(across) < 0.97, `inside a 4:3 picture, not at ${across.toFixed(2)}`);
      assert.ok(up < UNDER_BAR, "under the upper bar");
    }
    // White's name stands on the left of the picture and Black's on the right; the King and Queen keep to the other half.
    const nearest = Math.min(...corners.map((corner) => project(end, WIDE, corner)[0] * side));
    assert.ok(nearest > 0.02, `clear of the name's half on 16:9, not at ${nearest.toFixed(2)}`);
  }
});

test("each army stands whole, its King and Queen last, three quarters of a second before its shot cuts away", () => {
  const plan = buildMatchOpening(duel, "full");
  for (const index of [1, 2]) {
    const shot = plan.shots[index]!, { start = 0.08, end = 0.9, from } = shot.muster!;
    // The first point of the wave at which every figure on every file stands whole.
    let wave = 0;
    while (wave < 1 && Array.from({ length: 8 }, (_, file) => file).some((file) => musterReveal(wave, file, false, from) < 1 || musterReveal(wave, file, true, from) < 1)) wave = Math.min(1, wave + 0.002);
    assert.ok(musterReveal(wave - 0.01, 3, false, from) < 1, "the King and Queen are the last to stand");
    const whole = (start + wave * (end - start)) * shot.seconds;
    assert.ok(shot.seconds - whole >= 0.7, `whole ${(shot.seconds - whole).toFixed(2)}s before the cut`);
  }
});

test("the versus shot holds both armies whole on a wide screen, and both Kings and Queens on a 4:3 one", () => {
  for (const plan of [buildMatchOpening(classic("w"), "full"), buildMatchOpening(classic("b"), "full"), buildMatchOpening(duel, "short")]) {
    const pose = plan.beats.find((beat) => beat.id === "versus")!.shot.to as OpeningPose;
    for (const x of [-3.92, 3.92]) for (const z of [-3.92, 3.92]) assert.ok(Math.abs(project(pose, WIDE, [x, 0.5, z])[0]) <= 1, `the corner figure at ${x}, ${z} in the picture`);
    for (const x of [-0.93, 0.93]) for (const z of [-3.57, 3.57]) assert.ok(Math.abs(project(pose, SQUARE, [x, 1, z])[0]) < 0.95, "the Kings and Queens in a 4:3 picture");
  }
});
