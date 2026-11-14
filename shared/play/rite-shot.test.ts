import { test } from "node:test";
import assert from "node:assert/strict";
import { RITE_SHOT, riteShot, shotTurn, turnHome, type RiteShotInput, type RiteShotView } from "../../web/src/scene/rites/riteShot";

type P = { x: number; y: number; z: number };
const sub = (a: P, b: P): P => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const dot = (a: P, b: P) => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a: P, b: P): P => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const unit = (a: P): P => { const l = Math.hypot(a.x, a.y, a.z); return { x: a.x / l, y: a.y / l, z: a.z / l }; };
const DEG = 180 / Math.PI;

/** Degrees each point sits off the view's axis, up and across, in a frame of this aspect. */
function inFrame(view: RiteShotView, aspect: number, points: readonly P[]): { ok: boolean; worst: string } {
  const forward = unit(sub(view.target, view.position));
  const right = unit(cross(forward, { x: 0, y: 1, z: 0 }));
  const up = cross(right, forward);
  const half = view.fov / 2, halfWide = Math.atan(Math.tan(half / DEG) * aspect) * DEG;
  let worst = "";
  for (const p of points) {
    const d = sub(p, view.position);
    const z = dot(d, forward), ay = Math.atan2(dot(d, up), z) * DEG, ax = Math.atan2(dot(d, right), z) * DEG;
    if (z <= 0 || Math.abs(ay) > half * 0.98 || Math.abs(ax) > halfWide * 0.98) worst = `point ${JSON.stringify(p)} is ${ay.toFixed(1)} up and ${ax.toFixed(1)} across in a ${view.fov.toFixed(1)} degree lens`;
  }
  return { ok: worst === "", worst };
}

const white: RiteShotInput = { home: { position: { x: 0, y: 6.4, z: 8.6 }, target: { x: 0, y: 0.9, z: 0.4 } }, boardTop: 0, aspect: 16 / 9, fov: 46, radius: 10.6 };
const black: RiteShotInput = { ...white, home: { position: { x: 0, y: 6.4, z: -8.6 }, target: { x: 0, y: 0.9, z: -0.4 } } };

const BEATS: Record<string, P[]> = {
  call: [{ x: 2, y: 1.2, z: 0.5 }, { x: 0, y: 1, z: -0.5 }, { x: 0, y: 5, z: -0.5 }],
  hover: [{ x: 0, y: 3.6, z: -3.7 }, { x: 0, y: 5.6, z: -3.7 }, { x: 4, y: 6, z: -3.7 }, { x: -4, y: 6, z: -3.7 }],
  landing: [{ x: 0, y: 0, z: -0.5 }, { x: 0, y: 1.5, z: -0.5 }],
  "near corner": [{ x: 3.5, y: 0, z: 3.5 }, { x: 3.5, y: 1.6, z: 3.5 }, { x: 2.5, y: 1.2, z: 2.5 }],
  "far corner": [{ x: -3.5, y: 0, z: -3.5 }, { x: -3.5, y: 1.6, z: -3.5 }],
  wide: [{ x: -3.5, y: 0, z: -3.5 }, { x: 3.5, y: 0, z: 3.5 }, { x: 0, y: 7, z: 0 }],
};

test("whatever the rite names is in the frame, from the player's own side, above the stone and inside the hall", () => {
  for (const [side, input] of Object.entries({ white, black })) {
    const homeDir = unit({ x: input.home.position.x - input.home.target.x, y: 0, z: input.home.position.z - input.home.target.z });
    for (const [name, points] of Object.entries(BEATS)) {
      const view = riteShot(points, input);
      const seen = inFrame(view, input.aspect, points);
      assert.ok(seen.ok, `${side}, ${name}: ${seen.worst}`);
      assert.ok(view.position.y >= input.boardTop + RITE_SHOT.floor - 1e-9, `${side}, ${name}: the eye stays above the stone`);
      assert.ok(Math.hypot(view.position.x, view.position.z) <= input.radius + 1e-6, `${side}, ${name}: inside the hall`);
      assert.ok(dot(sub(view.position, view.target), homeDir) > 0, `${side}, ${name}: on the player's side of what it watches`);
      assert.ok(view.fov >= input.fov - 1e-9 && view.fov <= RITE_SHOT.widest + 1e-9, `${side}, ${name}: a lens between the match's and the widest`);
    }
  }
});

test("it looks down over the board and up at something high in the sky", () => {
  const board = riteShot(BEATS.landing, white), sky = riteShot(BEATS.hover, white);
  assert.ok(board.target.y < board.position.y, "down at a body on the stone");
  assert.ok(sky.target.y > sky.position.y, "up at a wyvern in a hover");
});

test("kept near by the wall, it widens the lens rather than lose what it watches", () => {
  const near = riteShot(BEATS["near corner"], { ...white, radius: 6 });
  assert.ok(Math.hypot(near.position.x, near.position.z) <= 6 + 1e-6);
  assert.ok(near.fov > white.fov, `a wider lens (${near.fov.toFixed(1)})`);
  assert.ok(inFrame(near, white.aspect, BEATS["near corner"]).ok);
  // and with room to stand back, it keeps the match's own lens
  assert.equal(riteShot(BEATS.landing, white).fov, white.fov);
});

test("a kill watched up close comes in nearer than any other shot, and keeps the whole body and the ice round it in frame", () => {
  // A Knight run through on a square near the middle: the figure from the stone to over its head, and the ice round its feet.
  const body: P[] = [
    { x: 0.5, y: 0, z: -1.5 }, { x: 0.5, y: 1.35, z: -1.5 },
    { x: 0.96, y: 0, z: -1.5 }, { x: 0.04, y: 0, z: -1.5 }, { x: 0.5, y: 0, z: -1.04 }, { x: 0.5, y: 0, z: -1.96 },
  ];
  for (const input of [white, black]) {
    const close = riteShot(body, { ...input, close: true }), usual = riteShot(body, input);
    const far = (view: RiteShotView) => Math.hypot(view.position.x - view.target.x, view.position.y - view.target.y, view.position.z - view.target.z);
    assert.ok(far(close) < far(usual) - 1, `nearer (${far(close).toFixed(2)} against ${far(usual).toFixed(2)})`);
    assert.ok(far(close) >= RITE_SHOT.close - 1e-9, "but never nearer than the close limit");
    const seen = inFrame(close, input.aspect, body);
    assert.ok(seen.ok, seen.worst);
    assert.ok(close.position.y >= input.boardTop + RITE_SHOT.floor - 1e-9, "the eye stays above the stone");
  }
  // Nothing else changes: a shot not asked to come close is the shot it was.
  for (const points of Object.values(BEATS)) assert.deepEqual(riteShot(points, { ...white, close: false }), riteShot(points, white));
});

test("the same points give the same shot", () => {
  assert.deepEqual(riteShot(BEATS.call, white), riteShot(BEATS.call, white));
});

test("a spell's shot turns off the line from caster to piece when it would look straight along it", () => {
  // Black's Queen on d8 casting at d5: seen from Black's seat she stands in front of what she casts at.
  const queen = { x: -0.5, y: 0, z: -3.5 }, pawn = { x: -0.5, y: 0, z: -0.5 };
  const turn = shotTurn(black.home, queen, pawn);
  assert.ok(Math.abs(turn) > 0.5 && Math.abs(turn) <= RITE_SHOT.turn + 1e-9, `turns well off the file (${turn.toFixed(2)} rad)`);
  const turned = turnHome(black.home, turn);
  const view = { x: turned.position.x - turned.target.x, z: turned.position.z - turned.target.z };
  const along = Math.abs(view.z) / Math.hypot(view.x, view.z);
  assert.ok(along < 0.9, "the turned view no longer runs down the file");
  assert.ok(Math.abs(Math.hypot(view.x, view.z) - Math.hypot(black.home.position.x - black.home.target.x, black.home.position.z - black.home.target.z)) < 1e-9, "it keeps its distance");
  assert.equal(turned.position.y, black.home.position.y, "and its height");
  // Dead along the file on the board's left half: the eye swings toward the middle, not out to the wall.
  const eyeX = turned.position.x;
  assert.ok(Math.abs(eyeX) <= Math.abs(turnHome(black.home, -turn).position.x) + 1e-9, "toward the middle of the hall");
  // A diagonal across the view needs no turn; a line along it from the other end turns too.
  assert.equal(shotTurn(white.home, { x: -3.5, y: 0, z: 0.5 }, { x: 3.5, y: 0, z: 0.5 }), 0, "a line across the view is left alone");
  assert.ok(Math.abs(shotTurn(white.home, { x: 0.5, y: 0, z: -3.5 }, { x: 0.5, y: 0, z: 2.5 })) > 0.5, "a piece in front of its caster turns as well");
  // Slightly off the line, it turns the way the line already leans.
  const leaning = shotTurn(white.home, { x: 0, y: 0, z: 3.5 }, { x: 0.9, y: 0, z: -1.5 });
  const after = (angle: number) => { const h = turnHome(white.home, angle); const v = unit({ x: h.position.x - h.target.x, y: 0, z: h.position.z - h.target.z }); const l = unit({ x: 0.9, y: 0, z: -5 }); return Math.abs(dot(v, l)); };
  assert.ok(after(leaning) < after(-leaning), "away from the line, not across it");
  // Nothing to turn for: a caster on the piece's own square, or no view.
  assert.equal(shotTurn(white.home, pawn, pawn), 0);
});

test("a turned shot still frames what it names, from inside the hall", () => {
  const queen = { x: -0.5, y: 1.5, z: -3.5 }, pawn = { x: -0.5, y: 0.62, z: -0.5 };
  const points = [queen, { x: -0.5, y: 0, z: -3.5 }, { x: -0.5, y: 0, z: -0.5 }, { x: -0.5, y: 3, z: -0.5 }];
  const turn = shotTurn(black.home, queen, pawn);
  const view = riteShot(points, { ...black, home: turnHome(black.home, turn) });
  const framed = inFrame(view, black.aspect, points);
  assert.ok(framed.ok, framed.worst);
  assert.ok(Math.hypot(view.position.x, view.position.z) <= black.radius + 1e-6, "inside the hall");
});

test("a beat may name the side it is watched from: the eye stands on that side of what it frames, whatever the player's side", () => {
  const points = [{ x: 1, y: 4.2, z: -1 }, { x: 1, y: 2.6, z: -1 }];
  for (const facing of [{ x: 0, z: -1 }, { x: 1, z: 0 }, { x: -0.6, z: 0.8 }]) {
    const view = riteShot(points, { ...white, close: true, look: -4, facing });
    const ahead = (view.position.x - view.target.x) * facing.x + (view.position.z - view.target.z) * facing.z;
    const flat = Math.hypot(view.position.x - view.target.x, view.position.z - view.target.z);
    assert.ok(ahead > 0.99 * flat * Math.hypot(facing.x, facing.z), `on the ${JSON.stringify(facing)} side`);
    assert.ok(inFrame(view, white.aspect, points).ok, inFrame(view, white.aspect, points).worst);
  }
  // Without it, the player's side as before.
  const home = riteShot(points, { ...white, close: true });
  assert.ok(home.position.z > home.target.z);
});
