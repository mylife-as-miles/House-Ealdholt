import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { combatSeed } from "../../web/src/scene/combat/director";
import { goreSeed } from "../../web/src/scene/gore/GoreTypes";
import { QUALITY_ORDER, type QualityPreset } from "../../web/src/scene/quality";
import { SPELL_LOOK } from "../../web/src/scene/spellLook";
import {
  SCORCH_BUDGET,
  SCORCH_FADE_SECONDS,
  SCORCH_FADING_SLOTS,
  SCORCH_KINDS,
  SCORCH_LOOK,
  SCORCH_MARGIN,
  SCORCH_MAX_RADIUS,
  SCORCH_MENU_ALPHA,
  SCORCH_MENU_MARKS,
  SCORCH_SLOTS,
  SPELL_SCORCH,
  ScorchBuffer,
  planScorch,
  scorchIdOf,
  scorchKind,
  scorchScale,
  scorchSeed,
  type ScorchEvent,
  type ScorchMark,
} from "../../web/src/scene/vfx/scorchPlan";
import { SPELL_BURST_COLOUR, type VfxArmy, type VfxFlags } from "../../web/src/scene/vfx/wiring";

const ARMIES: VfxArmy[] = ["ivory", "sun", "empire", "kwind"];
const TILE = 1.02;
const GAME = ["e4", "d5", "Bb5+", "c6", "Bxc6+"];
const FIGHT = combatSeed(GAME);
const match = (quality: QualityPreset = "high", over: Partial<VfxFlags> = {}): VfxFlags => ({ quality, reducedMotion: false, tactical: false, menuBoard: false, ...over });
const blast = (over: Partial<ScorchEvent> = {}): ScorchEvent => ({
  seed: scorchSeed(FIGHT), ply: GAME.length, source: "spell", army: "sun", power: 1, ring: 0,
  at: { x: -1.53, z: -2.55 }, direction: { x: -3.06, z: -3.06 }, tile: TILE, flags: match(), ...over,
});
const at = (ply: number, over: Partial<ScorchEvent> = {}): ScorchMark => planScorch(blast({ ply, seed: scorchSeed(FIGHT + ply), ...over }));
const plies = (buffer: ScorchBuffer, stayingOnly = false): number[] => {
  const found: number[] = [];
  for (let i = 0; i < buffer.count; i += 1) if (!stayingOnly || !buffer.fading(i)) found.push(buffer.plyOf(i));
  return found.sort((a, b) => a - b);
};
const luminance = (c: readonly [number, number, number]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

test("the same game leaves the same burn, and another game another", () => {
  assert.deepEqual(planScorch(blast()), planScorch(blast()));
  assert.equal(scorchSeed(FIGHT), scorchSeed(combatSeed([...GAME])), "seeded from the move record, as the fights are");
  assert.notEqual(scorchSeed(FIGHT), scorchSeed(combatSeed([...GAME.slice(0, -1), "Bxd7+"])));
  // Its own stream: the burn never draws the numbers the blood of the same fight draws.
  assert.notEqual(scorchSeed(FIGHT), goreSeed(FIGHT, "kill"));
  assert.equal(scorchSeed(FIGHT), goreSeed(FIGHT, "burn"), "the blood's own mix, under its own name");
  const other = planScorch(blast({ seed: scorchSeed(FIGHT + 1) }));
  const mark = planScorch(blast());
  assert.notEqual(other.shape, mark.shape);
  assert.notDeepEqual([other.x, other.z, other.rotation], [mark.x, mark.z, mark.rotation]);
  // The planner keeps no state between calls.
  for (let i = 0; i < 5; i += 1) planScorch(blast({ seed: i }));
  assert.deepEqual(planScorch(blast()), mark);
});

test("each army burns the stone its own way", () => {
  assert.deepEqual(SPELL_SCORCH, { sun: "fire", ivory: "frost", kwind: "arc", empire: "hex" });
  for (const army of ARMIES) {
    assert.equal(planScorch(blast({ army })).kind, SPELL_SCORCH[army], army);
    // The field gun leaves its crater whoever's livery the crew wears.
    assert.equal(scorchKind("gun", army), "crater");
    assert.equal(planScorch(blast({ army, source: "gun" })).kind, "crater");
  }
  assert.deepEqual(Object.keys(SCORCH_LOOK).sort(), [...SCORCH_KINDS].sort());
  // Five shapes in the shader, one to each look: Korvenia's hex is its own brand, not Kwind-09's arc in violet.
  assert.deepEqual(SCORCH_KINDS.map(kind => SCORCH_LOOK[kind].shape), [0, 1, 2, 3, 4]);
  assert.equal(new Set(SCORCH_KINDS.map(kind => SCORCH_LOOK[kind].shape)).size, SCORCH_KINDS.length, "no look borrows another's shape");

  const { fire, frost, arc, crater, hex } = SCORCH_LOOK;
  // Solforiz: blackened char, embers that glow orange and cool over 3 to 5 seconds.
  assert.ok(luminance(fire.char) < 0.02 && luminance(fire.soot) < 0.06);
  assert.ok(fire.glow[0] > fire.glow[1] && fire.glow[1] > fire.glow[2], "orange");
  assert.ok(fire.cool >= 3 && fire.cool <= 5);
  assert.equal(fire.residue, 0, "embers go dark");
  // Aethelgard: pale and cold, cyan at the rim, a residue that stays. Frost-burn, not soot.
  assert.ok(luminance(frost.soot) > 0.6, "pale");
  assert.ok(frost.soot[2] > frost.soot[0] && frost.rim[2] > frost.rim[1] && frost.rim[1] > frost.rim[0], "cold, cyan rim");
  assert.ok(luminance(frost.char) > luminance(fire.char) * 8, "a sear, not char");
  assert.ok(frost.residue > 0 && frost.residue < 0.2, "faint");
  assert.ok(frost.roughness < fire.roughness, "glassy where fire is matt");
  // Soot has no shine, so char stays black in a bright arena; the frost keeps the stone's.
  for (const kind of SCORCH_KINDS) assert.ok(kind === "frost" ? SCORCH_LOOK[kind].shine === 1 : SCORCH_LOOK[kind].shine <= 0.2, kind);
  // Kwind-09: scars with a blue-violet afterglow that fades.
  assert.ok(arc.glow[2] > arc.glow[0] && arc.glow[0] > arc.glow[1], "blue-violet");
  assert.equal(arc.residue, 0, "the afterglow fades");
  assert.ok(arc.cool >= 3 && arc.cool <= 5);
  // Korvenia's field gun: darker than a fire's char, and its soot thrown hardest downrange.
  assert.ok(luminance(crater.char) < luminance(fire.char) && luminance(crater.soot) < luminance(fire.soot), "darker");
  for (const kind of SCORCH_KINDS) if (kind !== "crater") assert.ok(crater.throw > SCORCH_LOOK[kind].throw, `more directional than ${kind}`);
  assert.ok(hex.glow[0] > arc.glow[0], "violet where the arc is blue");
});

test("a burn glows in the colour of the spell that made it", () => {
  const hue = (hex: number): [number, number, number] => [(hex >> 16 & 255) / 255, (hex >> 8 & 255) / 255, (hex & 255) / 255];
  const strongest = (c: readonly number[]) => c.indexOf(Math.max(...c));
  const weakest = (c: readonly number[]) => c.indexOf(Math.min(...c));
  for (const army of ARMIES) {
    const glow = SCORCH_LOOK[SPELL_SCORCH[army]].glow, flame = hue(SPELL_LOOK[army].flame);
    assert.equal(strongest(glow), strongest(flame), `${army}: the orb's strongest channel`);
    assert.equal(weakest(glow), weakest(flame), `${army}: the orb's weakest channel`);
    const burst = SPELL_BURST_COLOUR[army];
    if (burst) assert.equal(strongest(glow), strongest(burst), `${army}: the burst's hue`);
  }
});

test("a burn is sized by the blast: the Queen's bigger than a Bishop's, and bigger again for her ring", () => {
  // The profiles in sceneEngine.ts: MAGE_SPELL blast 1, no ring; QUEEN_SPELL blast 1.75, ring 3.4; the field gun's blast 2.1.
  for (const army of ARMIES) {
    const bishop = planScorch(blast({ army, power: 1 })), queen = planScorch(blast({ army, power: 1.75, ring: 3.4 }));
    assert.ok(queen.radius > bishop.radius * 1.25, `${army}: ${queen.radius} > ${bishop.radius}`);
    assert.ok(planScorch(blast({ army, power: 1.75 })).radius < queen.radius, "the ring adds to it");
    for (const mark of [bishop, queen]) {
      // The piece that made the capture then stands on the square, on its own disc (0.95 across): the burn has to show round it.
      assert.ok(mark.radius >= 0.55 * TILE, "wider than the disc of the piece that will stand on it");
      assert.ok(mark.radius <= SCORCH_MAX_RADIUS * TILE);
      // The whole quad, soot included, stays within the squares round the one that was struck.
      assert.ok(mark.radius * SCORCH_MARGIN <= 2 * TILE);
    }
  }
  assert.ok(scorchScale(1.75, 3.4) > scorchScale(1.75) && scorchScale(1.75) > scorchScale(1));
  assert.ok(scorchScale(99) <= 1.32 && scorchScale(0) >= 0.8, "bounded");
  const gun = planScorch(blast({ source: "gun", army: "empire", power: 2.1 }));
  assert.ok(gun.radius > planScorch(blast({ power: 1 })).radius);
});

test("the soot is thrown the way the blast was going, from just off the centre of the square", () => {
  const downrange = (mark: ScorchMark) => ({ x: Math.cos(mark.rotation), z: -Math.sin(mark.rotation) });
  for (const direction of [{ x: 1, z: 0 }, { x: 0, z: -3 }, { x: -2, z: 2 }, { x: 0.5, z: 4 }]) {
    for (let seed = 1; seed < 20; seed += 1) {
      const mark = planScorch(blast({ direction, seed: scorchSeed(seed) }));
      const length = Math.hypot(direction.x, direction.z), way = downrange(mark);
      const dot = (way.x * direction.x + way.z * direction.z) / length;
      assert.ok(dot > Math.cos(0.16), `within nine degrees of the blast (${dot})`);
      const off = Math.hypot(mark.x - blast().at.x, mark.z - blast().at.z);
      assert.ok(off > 0.01 * TILE && off < 0.06 * TILE, "off centre, on its square");
    }
  }
  // A blast straight down has no direction: the mark is still laid, turned by its seed.
  const down = planScorch(blast({ direction: { x: 0, z: 0 } }));
  assert.ok(Number.isFinite(down.rotation));
  assert.deepEqual(down, planScorch(blast({ direction: { x: 0, z: 0 } })));
});

test("reduced motion and the tactical map show the mark, cold", () => {
  const live = planScorch(blast());
  assert.equal(live.glow, true);
  for (const flags of [match("high", { reducedMotion: true }), match("high", { tactical: true }), match("low", { reducedMotion: true, tactical: true })]) {
    const still = planScorch(blast({ flags }));
    assert.equal(still.glow, false, "no embers, no afterglow");
    // The mark is information: same place, same size, same opacity as with motion on.
    assert.deepEqual({ ...still, glow: true, cap: live.cap }, live);
    assert.equal(still.alpha, 1);
  }
  // A cold mark is laid cold: the shader reads this flag, and nothing else animates it.
  const buffer = new ScorchBuffer();
  buffer.lay(planScorch(blast({ flags: match("high", { reducedMotion: true }) })), 12);
  assert.equal(buffer.life[2], 0);
  buffer.lay(planScorch(blast({ ply: 9 })), 12);
  assert.equal(buffer.life[4 + 2], 1);
});

test("the menu's board keeps a few faint marks", () => {
  for (const quality of QUALITY_ORDER) {
    const menu = planScorch(blast({ flags: match(quality, { menuBoard: true }) })), played = planScorch(blast({ flags: match(quality) }));
    assert.equal(menu.alpha, SCORCH_MENU_ALPHA);
    assert.ok(menu.alpha < 0.6 && menu.alpha > 0.2, "faint, not gone");
    assert.ok(menu.radius < played.radius);
    assert.equal(menu.cap, SCORCH_MENU_MARKS);
    assert.ok(menu.cap < played.cap, quality);
    assert.equal(menu.kind, played.kind);
  }
  const buffer = new ScorchBuffer();
  for (let ply = 1; ply <= 9; ply += 1) buffer.lay(at(ply, { flags: match("ultra", { menuBoard: true }) }), ply);
  assert.equal(buffer.staying, SCORCH_MENU_MARKS);
  assert.deepEqual(plies(buffer, true), [7, 8, 9]);
});

test("Violence Intensity has no say", () => {
  const source = readFileSync(fileURLToPath(new URL("../../web/src/scene/vfx/scorchPlan.ts", import.meta.url)), "utf8");
  assert.ok(!/from ["'][^"']*gore/.test(source), "the planner imports nothing from the gore system");
  assert.ok(!("intensity" in blast()));
});

test("each preset keeps its own number of marks, fewer and simpler on low", () => {
  let last = 0;
  for (const quality of QUALITY_ORDER) {
    const budget = SCORCH_BUDGET[quality];
    assert.ok(budget.marks >= last, quality);
    last = budget.marks;
    assert.equal(planScorch(blast({ flags: match(quality) })).cap, budget.marks);
  }
  assert.ok(SCORCH_BUDGET.low.marks < SCORCH_BUDGET.high.marks);
  assert.equal(SCORCH_BUDGET.low.detail, 0);
  assert.ok(SCORCH_BUDGET.high.detail > SCORCH_BUDGET.low.detail);
  assert.equal(SCORCH_SLOTS, SCORCH_BUDGET.ultra.marks + SCORCH_FADING_SLOTS, "the pool holds the largest preset and the marks fading out of it");
});

test("past the cap the oldest mark fades, then frees its slot", () => {
  for (const quality of QUALITY_ORDER) {
    const cap = SCORCH_BUDGET[quality].marks, buffer = new ScorchBuffer();
    for (let ply = 1; ply <= cap; ply += 1) buffer.lay(at(ply, { flags: match(quality) }), ply);
    assert.equal(buffer.staying, cap);
    assert.equal(buffer.count, cap);
    buffer.lay(at(cap + 1, { flags: match(quality) }), 100);
    assert.equal(buffer.staying, cap, "still at the cap");
    assert.equal(buffer.count, cap + 1, "the oldest is still drawn while it fades");
    assert.deepEqual(plies(buffer, true), Array.from({ length: cap }, (_, i) => i + 2), "ply 1 is the one fading");
    buffer.update(100 + SCORCH_FADE_SECONDS * 0.5);
    assert.equal(buffer.count, cap + 1, "half way through its fade");
    buffer.update(100 + SCORCH_FADE_SECONDS + 0.01);
    assert.equal(buffer.count, cap);
    assert.deepEqual(plies(buffer), Array.from({ length: cap }, (_, i) => i + 2));
  }
});

test("laying marks never grows the pool", () => {
  const buffer = new ScorchBuffer();
  const arrays = [buffer.place, buffer.look, buffer.life], sizes = arrays.map(array => array.length);
  // A long game with every capture a spell, and nobody waiting for a fade to finish.
  for (let ply = 1; ply <= 400; ply += 1) {
    buffer.lay(at(ply, { flags: match("ultra") }), ply * 0.01);
    assert.ok(buffer.count <= SCORCH_SLOTS);
    assert.ok(buffer.staying <= SCORCH_BUDGET.ultra.marks);
  }
  assert.deepEqual([buffer.place, buffer.look, buffer.life], arrays, "the same arrays");
  assert.deepEqual(arrays.map(array => array.length), sizes);
  assert.equal(buffer.plyOf(buffer.count - 1), 400, "the newest is always kept");
});

test("a lower preset fades the oldest marks down to its cap", () => {
  const buffer = new ScorchBuffer();
  for (let ply = 1; ply <= SCORCH_BUDGET.high.marks; ply += 1) buffer.lay(at(ply), ply);
  buffer.trim(SCORCH_BUDGET.low.marks, 50);
  assert.equal(buffer.staying, SCORCH_BUDGET.low.marks);
  assert.deepEqual(plies(buffer, true), Array.from({ length: SCORCH_BUDGET.low.marks }, (_, i) => SCORCH_BUDGET.high.marks - SCORCH_BUDGET.low.marks + 1 + i), "the newest stay");
  buffer.update(50 + SCORCH_FADE_SECONDS + 0.01);
  assert.equal(buffer.count, SCORCH_BUDGET.low.marks);
});

test("Undo removes the burns of the plies taken back, at once", () => {
  const buffer = new ScorchBuffer();
  for (const ply of [3, 8, 11, 14]) buffer.lay(at(ply), ply);
  assert.deepEqual(plies(buffer), [3, 8, 11, 14]);
  const before = buffer.version;
  // Against the engine, an Undo takes back the reply and the move: two plies.
  assert.equal(buffer.undoTo(12), 1);
  assert.deepEqual(plies(buffer), [3, 8, 11], "no fade: it is gone on the frame");
  assert.ok(buffer.version > before, "the renderer uploads");
  assert.equal(buffer.undoTo(12), 0, "nothing more to take back");
  assert.equal(buffer.undoTo(7), 2);
  assert.deepEqual(plies(buffer), [3]);
  // What stayed is untouched.
  const kept = at(3);
  assert.deepEqual([buffer.place[0], buffer.place[1], buffer.place[2], buffer.place[3]], [kept.x, kept.z, kept.radius, kept.rotation].map(Math.fround));
  assert.equal(buffer.kindOf(0), "fire");
  buffer.undoTo(0);
  assert.equal(buffer.count, 0);
  assert.equal(scorchIdOf(11), "11:burn");
});

test("Undo then the same capture leaves one mark, not two", () => {
  const buffer = new ScorchBuffer();
  buffer.lay(at(5), 1);
  buffer.lay(at(9), 2);
  // Played again without the rewind having been seen (a replay stepping back): ply 9 and later go first.
  buffer.lay(at(9, { army: "kwind" }), 3);
  assert.deepEqual(plies(buffer), [5, 9]);
  assert.equal(buffer.kindOf(buffer.count - 1), "arc");
  buffer.lay(at(7, { army: "ivory" }), 4);
  assert.deepEqual(plies(buffer), [5, 7], "a line played from ply 7 leaves nothing of the old ply 9");
});

test("a new game leaves nothing", () => {
  const buffer = new ScorchBuffer();
  for (let ply = 1; ply <= 30; ply += 1) buffer.lay(at(ply), ply);
  assert.ok(buffer.count > SCORCH_BUDGET.high.marks, "some still fading");
  const before = buffer.version;
  buffer.clear();
  assert.equal(buffer.count, 0);
  assert.equal(buffer.staying, 0);
  assert.ok(buffer.version > before);
  buffer.clear();
  // And the next match starts from an empty board.
  buffer.lay(at(2), 0);
  assert.deepEqual(plies(buffer), [2]);
});

test("the engine lays a burn beside each explosion, and takes it back with the blood", () => {
  const engine = readFileSync(fileURLToPath(new URL("../../web/src/scene/sceneEngine.ts", import.meta.url)), "utf8");
  const after = (needle: string, then: string, within = 400) => {
    const i = engine.indexOf(needle);
    assert.ok(i >= 0, `sceneEngine.ts has ${needle}`);
    assert.ok(engine.slice(i, i + needle.length + within).includes(then), `${then} follows ${needle}`);
  };
  // On the frame of the burst and of the gun's blast.
  after(`this.playVfx("spell", this.onStone(at), this.vfxFor(scale, army), VFX_SEAT.spell);`, `this.burnStone("spell", army, at,`);
  after(`this.playVfx("slam", this.onStone(victimSpot), this.vfxFor(power, undefined, "gun"), VFX_SEAT.slam);`, `this.burnStone("gun",`);
  // Undo, a new game, the end of the scene: wherever the blood goes, the burns go.
  after("this.gore?.undoTo(this.controller.getSnapshot().sanList.length);", "this.scorch?.undoTo(this.controller.getSnapshot().sanList.length);");
  after("this.gore?.reset();", "this.scorch?.reset();", 60);
  after("this.gore?.dispose();", "this.scorch?.dispose();", 60);
  after("this.gore?.setQuality(preset);", "this.scorch?.setQuality(preset);", 60);
  // Seeded from the move record, filed under the ply.
  assert.ok(engine.includes("event.seed = scorchSeed(combatSeed(sanList)); event.ply = sanList.length;"));
});

test("the marks are drawn in code, under the blood, lit like the board", () => {
  const shader = readFileSync(fileURLToPath(new URL("../../web/src/scene/vfx/scorch.ts", import.meta.url)), "utf8");
  const blood = readFileSync(fileURLToPath(new URL("../../web/src/scene/gore/BloodDecals.ts", import.meta.url)), "utf8");
  assert.ok(!/TextureLoader|\.png|\.jpg|\.webp|\.ktx2/.test(shader), "no texture");
  assert.ok(shader.includes("new THREE.MeshStandardMaterial(") && shader.includes("onBeforeCompile"), "the board's own lighting");
  assert.ok(shader.includes("new THREE.InstancedMesh(") && shader.includes("SCORCH_SLOTS"), "one pooled mesh");
  const order = (source: string) => Number(/renderOrder = (\d+)/.exec(source)![1]);
  const lift = (source: string) => Number(/const LIFT = ([\d.]+)/.exec(source)![1]);
  assert.ok(order(shader) < order(blood), "drawn before the blood");
  assert.ok(lift(shader) < lift(blood), "and lying under it");
});
