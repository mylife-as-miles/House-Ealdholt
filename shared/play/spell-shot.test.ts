import { test } from "node:test";
import assert from "node:assert/strict";
import { RITE_SHOT, riteShot, shotTurn, turnHome, type RiteShotView } from "../../web/src/scene/rites/riteShot";
import { blocked, type Standing } from "../../web/src/scene/fatality/fatalityPlan";
import { BURN_BUDGET } from "../../web/src/scene/death/burn/burnPlan";
import { SPELL_SHOT, bodyFrame, bodySights, burstFrame, gatherFrame, gatherSights, rowScreen, shoulderShot, spellShot, type SpellShotInput } from "../../web/src/scene/rites/spellShot";

type P = { x: number; y: number; z: number };
const TILE = 1.02, H = 720, W = 1280;
const sq = (name: string): P => ({ x: ("abcdefgh".indexOf(name[0]) - 3.5) * TILE, y: 0, z: -(Number(name[1]) - 4.5) * TILE });
const sub = (a: P, b: P): P => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const dot = (a: P, b: P) => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a: P, b: P): P => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const unit = (a: P): P => { const l = Math.hypot(a.x, a.y, a.z); return { x: a.x / l, y: a.y / l, z: a.z / l }; };

/** Where a point lands in a 1280 by 720 frame (pixels, y down), and whether it is in front of the eye. */
function project(view: RiteShotView, p: P): { x: number; y: number; ahead: boolean } {
  const forward = unit(sub(view.target, view.position)), right = unit(cross(forward, { x: 0, y: 1, z: 0 })), up = cross(right, forward);
  const d = sub(p, view.position), z = dot(d, forward), f = (H / 2) / Math.tan((view.fov / 2) * Math.PI / 180);
  return { x: W / 2 + (dot(d, right) / z) * f, y: H / 2 - (dot(d, up) / z) * f, ahead: z > 0 };
}
const inFrame = (view: RiteShotView, p: P) => { const at = project(view, p); return at.ahead && at.x >= 0 && at.x <= W && at.y >= 0 && at.y <= H; };
/** How tall a square of the board looks where `at` stands, in pixels of 720. */
const squarePx = (view: RiteShotView, at: P) => (TILE / Math.hypot(view.position.x - at.x, view.position.y - at.y, view.position.z - at.z)) / (2 * Math.tan((view.fov / 2) * Math.PI / 180)) * H;

const white = { position: { x: 0, y: 6.4, z: 8.6 }, target: { x: 0, y: 0.35, z: 0 } };
const black = { position: { x: 0, y: 6.4, z: -8.6 }, target: { x: 0, y: 0.35, z: 0 } };
const base = (home: typeof white): Omit<SpellShotInput, "base" | "close" | "standing" | "sights"> => ({ home, boardTop: 0, aspect: 16 / 9, fov: 46, radius: 10.6 });
const PAWN = 0.78, BISHOP = 1.04, QUEEN = 1.32;

/** The casts the tests look at: a Bishop's and a Queen's, from each side's seat. */
const CASTS: [string, string, string, typeof white][] = [["f1", "a6", "f1-a6", white], ["c1", "g5", "c1-g5", white], ["d1", "h5", "d1-h5", white], ["d1", "d7", "d1-d7", white], ["c8", "h3", "c8-h3", black], ["c8", "h3", "c8-h3 from White's seat", white]].map(([c, v, label, home]) => [c as string, v as string, label as string, home as typeof white]);

test("the gather frames the piece and its air close, not the whole way from the caster: its square is far larger than it was", () => {
  for (const [c, v, label, home] of CASTS) {
    const caster = sq(c), stone = sq(v), turn = shotTurn(home, caster, stone);
    // As it was: the caster's hand and feet, the piece, and 2.4 units of air over the point a bolt strikes.
    const before = riteShot([{ x: caster.x, y: 1.65, z: caster.z }, caster, stone, { ...stone, y: 3.02 }], { home: turnHome(home, turn), boardTop: 0, aspect: 16 / 9, fov: 46, radius: 10.6 });
    for (const air of [SPELL_SHOT.air, PORTAL_AIR]) {
      const frame = gatherFrame(stone, PAWN, air, TILE);
      const shot = spellShot(frame, { ...base(home), base: turn, close: true, reach: SPELL_SHOT.reach, standing: [], sights: gatherSights(stone, PAWN, TILE) });
      const now = squarePx(shot.view, stone), was = squarePx(before, stone);
      assert.ok(was < 90, `${label}: the old shot's square was small (${was.toFixed(0)} px)`);
      // Two to four times, where the caster stood on the player's side and the old shot had to reach back to it.
      assert.ok(now > 120 && now > (dot(sub(stone, caster), sub(home.target, home.position)) > 0 ? 2 : 1.6) * was, `${label}, air ${air}: the square is ${now.toFixed(0)} px, against ${was.toFixed(0)}`);
      for (const p of frame) assert.ok(inFrame(shot.view, p), `${label}, air ${air}: ${JSON.stringify(p)} in frame`);
      assert.equal(shot.view.fov, 46, `${label}: on the match's lens, not widened against the wall`);
      assert.equal(shot.down, SPELL_SHOT.downs[0], `${label}: with nothing in the way, it looks down at its preferred steepness`);
      assert.ok(shot.view.position.y > shot.view.target.y, `${label}: it looks down at the piece`);
      assert.ok(Math.hypot(shot.view.position.x, shot.view.position.z) <= 10.6 + 1e-6, `${label}: inside the hall`);
      assert.ok(shot.view.position.y >= RITE_SHOT.floor - 1e-9, `${label}: above the stone`);
    }
  }
});

/** The air the fire portal and the sun pillar keep over the piece (vfx/spells/portal/index.ts, vfx/spells/sun/index.ts). */
const PORTAL_AIR = 2.2;

test("a spell's air keeps what it hangs over the piece in frame: a Queen's fire portal, whole", () => {
  // A Queen's portal (vfx/spells/portal/firePortalPlan.ts firePortalSize at power 1.75): its centre 2.75 over the stone,
  // 0.88 of a square behind the piece, 0.68 across.
  for (const [c, v, label, home] of CASTS) {
    const caster = sq(c), stone = sq(v), turn = shotTurn(home, caster, stone);
    const away = unit({ x: stone.x - caster.x, y: 0, z: stone.z - caster.z }), centre = { x: stone.x + away.x * 0.88 * TILE, y: 2.75, z: stone.z + away.z * 0.88 * TILE };
    const ring = [{ ...centre, y: centre.y + 0.68 }, { ...centre, y: centre.y - 0.68 }, { x: centre.x - away.z * 0.68, y: centre.y, z: centre.z + away.x * 0.68 }, { x: centre.x + away.z * 0.68, y: centre.y, z: centre.z - away.x * 0.68 }];
    const shot = spellShot(gatherFrame(stone, PAWN, PORTAL_AIR, TILE), { ...base(home), base: turn, close: true, reach: SPELL_SHOT.reach, standing: [], sights: [] });
    for (const p of ring) assert.ok(inFrame(shot.view, p), `${label}: the portal's ring at ${JSON.stringify(p)} is in frame`);
  }
});

test("over the shoulder: behind the caster, its hand at one side and the piece down the line, only where the line runs away from the player", () => {
  for (const [c, v, label, home, height] of [["f1", "a6", "Bishop f1-a6", white, BISHOP], ["d1", "d7", "Queen d1-d7", white, QUEEN], ["c1", "g5", "Bishop c1-g5", white, BISHOP], ["c8", "h3", "Black's Bishop from Black's seat", black, BISHOP]] as const) {
    const caster = sq(c), stone = sq(v), line = unit({ x: stone.x - caster.x, y: 0, z: stone.z - caster.z });
    const hand = { x: caster.x + line.x * 0.25, y: height * 0.95, z: caster.z + line.z * 0.25 }, chest = { ...stone, y: PAWN * 0.62 };
    const shot = shoulderShot({ caster, height, hand, chest, home, boardTop: 0, radius: 10.6, standing: [] });
    assert.ok(shot, `${label}: a shoulder beat`);
    const back = sub(shot!.position, caster);
    assert.ok(dot(back, line) < -1, `${label}: the eye stands behind the caster`);
    assert.ok(shot!.position.y > caster.y + height, `${label}: and over its head`);
    const eyeSide = Math.sign(back.x * -line.z + back.z * line.x), homeSide = Math.sign((home.position.x - caster.x) * -line.z + (home.position.z - caster.z) * line.x);
    assert.equal(eyeSide, homeSide, `${label}: over the shoulder on the player's side`);
    const at = project(shot!, hand), piece = project(shot!, chest);
    assert.ok(inFrame(shot!, hand) && Math.abs(at.x - W / 2) > W * 0.12, `${label}: the hand in frame, to one side (${at.x.toFixed(0)}, ${at.y.toFixed(0)})`);
    assert.ok(inFrame(shot!, chest) && Math.abs(piece.x - W / 2) < W * 0.2, `${label}: the piece in frame, near the middle (${piece.x.toFixed(0)}, ${piece.y.toFixed(0)})`);
    assert.ok(inFrame(shot!, { ...stone, y: PAWN }) && inFrame(shot!, stone), `${label}: the whole of the piece`);
    assert.ok(Math.hypot(shot!.position.x, shot!.position.z) <= 10.6, `${label}: inside the hall`);
  }
  // A line that runs toward the player, or across their view: no shoulder beat, the cast opens on the gather.
  const toward = shoulderShot({ caster: sq("c8"), height: BISHOP, hand: { ...sq("c8"), y: 1 }, chest: { ...sq("h3"), y: 0.5 }, home: white, boardTop: 0, radius: 10.6, standing: [] });
  assert.equal(toward, null, "Black's Bishop seen from White's seat");
  const across = shoulderShot({ caster: sq("a1"), height: QUEEN, hand: { ...sq("a1"), y: 1.2 }, chest: { ...sq("h1"), y: 0.5 }, home: white, boardTop: 0, radius: 10.6, standing: [] });
  assert.equal(across, null, "a Queen casting along her own rank");
  // A figure standing behind the caster's shoulder on the player's side: the other shoulder.
  const caster = sq("f1"), stone = sq("a6"), line = unit({ x: stone.x - caster.x, y: 0, z: stone.z - caster.z });
  const hand = { x: caster.x + line.x * 0.25, y: 1, z: caster.z + line.z * 0.25 }, chest = { ...stone, y: 0.5 };
  const open = shoulderShot({ caster, height: BISHOP, hand, chest, home: white, boardTop: 0, radius: 10.6, standing: [] })!;
  const mid = { x: (open.position.x + hand.x) / 2, z: (open.position.z + hand.z) / 2 };
  const crowded = shoulderShot({ caster, height: BISHOP, hand, chest, home: white, boardTop: 0, radius: 10.6, standing: [{ ...mid, radius: 0.3, height: 1.48 }] })!;
  assert.ok(Math.hypot(crowded.position.x - open.position.x, crowded.position.z - open.position.z) > 1, "it moves to the other shoulder");
});

test("a close beat turns off a figure standing in front of what it watches, as the fatality's shot on the wound does", () => {
  // A Glacial crown on f7, Black's figures round it, seen from White's seat: one of them straight in front, in the
  // way of the shot the turn would take on its own.
  const caster = sq("h5"), stone = sq("f7"), turn = shotTurn(white, caster, stone);
  const frame = bodyFrame(stone, PAWN, SPELL_SHOT.pierceOver, SPELL_SHOT.pierceRound * TILE), sights = bodySights(stone, PAWN);
  const open = spellShot(frame, { ...base(white), base: turn, close: true, standing: [], sights });
  assert.equal(open.turn, turn, "with nothing in the way it keeps its own turn");
  // Stand a Knight on the next square toward that eye.
  const eye = open.view.position, toward = unit({ x: eye.x - stone.x, y: 0, z: eye.z - stone.z });
  const knight: Standing = { x: stone.x + toward.x * TILE, z: stone.z + toward.z * TILE, radius: TILE * 0.27, height: 1.0 };
  assert.ok(blocked(open.view.position, sights, [knight], 0) > 0.5, "the Knight hides the body from the shot it would have taken");
  const turned = spellShot(frame, { ...base(white), base: turn, close: true, standing: [knight], sights });
  assert.equal(turned.occlusion, 0, `a clear view instead (turned ${turned.turn.toFixed(2)}, down ${turned.down})`);
  for (const p of frame) assert.ok(inFrame(turned.view, p), `still frames ${JSON.stringify(p)}`);
  assert.ok(Math.hypot(turned.view.position.x, turned.view.position.z) <= 10.6 + 1e-6, "inside the hall");
});

test("the Frost line's own row of ice counts as standing in the way of the body it runs through", () => {
  const caster = sq("f1"), stone = sq("a6"), row = rowScreen(caster, stone, TILE);
  assert.ok(row.length > 0, "a row");
  const line = unit({ x: stone.x - caster.x, y: 0, z: stone.z - caster.z });
  for (const solid of row) {
    const along = dot(sub({ ...solid, y: 0 }, caster), line);
    assert.ok(along > 0 && along < Math.hypot(stone.x - caster.x, stone.z - caster.z) - 0.4 * TILE, "between the caster and the piece, short of its square");
  }
  assert.ok(row[row.length - 1].height > row[0].height && row[row.length - 1].height > PAWN, "rising to a figure's height near the piece");
  // Seen from straight down the line behind the caster, it hides the body; a beat chosen with it in mind does not look through it.
  const along = Math.atan2(-line.x, -line.z) - Math.atan2(white.position.x - white.target.x, white.position.z - white.target.z);
  const frame = bodyFrame(stone, PAWN, SPELL_SHOT.pierceOver, SPELL_SHOT.pierceRound * TILE), sights = bodySights(stone, PAWN);
  const down = spellShot(frame, { ...base(white), base: along, turns: [0], downs: [24], close: true, standing: [], sights });
  assert.ok(blocked(down.view.position, sights, row, 0) > 0.3, "looking down the row, the ice is in front of the body");
  const chosen = spellShot(frame, { ...base(white), base: along, close: true, standing: row, sights });
  assert.equal(chosen.occlusion, 0, "a beat chosen with the row in mind sees the body");
  // Next to its caster the row is a stub, low enough to look over.
  for (const solid of rowScreen(sq("e4"), sq("f5"), TILE)) assert.ok(solid.height < 0.6, `a stub (${solid.height.toFixed(2)})`);
});

test("a body that dies where it stands is watched nearer than the gather; one that bursts, from further out with the ground its pieces cross", () => {
  for (const [c, v, label, home] of CASTS) {
    const caster = sq(c), stone = sq(v), turn = shotTurn(home, caster, stone), blow = unit({ x: stone.x - caster.x, y: 0, z: stone.z - caster.z });
    const gather = spellShot(gatherFrame(stone, PAWN, SPELL_SHOT.air, TILE), { ...base(home), base: turn, close: true, reach: SPELL_SHOT.reach, standing: [], sights: [] });
    const burnFrame = bodyFrame(stone, PAWN, SPELL_SHOT.burnOver, SPELL_SHOT.burnRound * TILE);
    const burn = spellShot(burnFrame, { ...base(home), base: turn, close: true, reach: SPELL_SHOT.burnReach, standing: [], sights: [] });
    const frame = burstFrame(stone, { ...stone, y: 0.62 }, { x: blow.x, z: blow.z }, TILE);
    const burst = spellShot(frame, { ...base(home), base: turn, close: false, standing: [], sights: [] });
    const g = squarePx(gather.view, stone), b = squarePx(burn.view, stone), x = squarePx(burst.view, stone);
    assert.ok(b > g * 1.1, `${label}: a burning body nearer than the gather (${b.toFixed(0)} against ${g.toFixed(0)} px)`);
    assert.ok(x < g, `${label}: a burst further out (${x.toFixed(0)} px)`);
    for (const p of burnFrame) assert.ok(inFrame(burn.view, p), `${label}: the burning body and the stone it falls on, ${JSON.stringify(p)}`);
    for (const p of frame) assert.ok(inFrame(burst.view, p), `${label}: where its pieces may go, ${JSON.stringify(p)}`);
  }
});

test("the same cast gives the same shot", () => {
  const input: SpellShotInput = { ...base(white), base: 0.2, close: true, reach: SPELL_SHOT.reach, standing: [{ x: 0, z: 0, radius: 0.3, height: 1 }], sights: gatherSights(sq("d5"), PAWN, TILE) };
  assert.deepEqual(spellShot(gatherFrame(sq("d5"), PAWN, 0.6, TILE), input), spellShot(gatherFrame(sq("d5"), PAWN, 0.6, TILE), input));
  const shoulder: Parameters<typeof shoulderShot>[0] = { caster: sq("f1"), height: BISHOP, hand: { ...sq("f1"), y: 1 }, chest: { ...sq("a6"), y: 0.5 }, home: white, boardTop: 0, radius: 10.6, standing: [] };
  assert.deepEqual(shoulderShot(shoulder), shoulderShot(shoulder));
});

test("a burnt body is held a moment once it is down, not for the whole of its smoulder, before the Claiming takes it", () => {
  for (const quality of ["low", "medium", "high", "ultra"] as const) {
    assert.ok(SPELL_SHOT.husk > 0.2 && SPELL_SHOT.husk < BURN_BUDGET[quality].smoulder * 0.6, `${quality}: ${SPELL_SHOT.husk} s against a ${BURN_BUDGET[quality].smoulder} s smoulder`);
  }
});

