import { test } from "node:test";
import assert from "node:assert/strict";
import {
  boundaryLoops, buildPool, buildRiver, buildSheetPart, chooseGlowSources, cutStrip, distanceToLoop, drapeStrip, insideLoop, ladderRails,
  mergeSurfaces, plainSurface, poolShape, readSheet, refineStrip, riverFalls, scatterOnSurface, seeded, sheetGlowSources, sheetHeightLookup,
  stripFlow, weld, type GlowSource, type Strip, type Vec3,
} from "./arena-lava-geometry";
import { createGround, poolGround, rasterTriangle } from "./arena-lava-ground";
import { CRUST_REACH, growCrust } from "./arena-lava-crust";

/** A flat fan like the look's pools: one inner point and a rim, every face with its own corners. */
function fan(points: number, radius: number, level: number) {
  const positions: number[] = [];
  for (let i = 0; i < points; i++) {
    const a = (i / points) * Math.PI * 2, b = ((i + 1) / points) * Math.PI * 2;
    positions.push(0, level, 0, Math.cos(a) * radius, level, Math.sin(a) * radius, Math.cos(b) * radius, level, Math.sin(b) * radius);
  }
  return weld(positions, null);
}

/** A ladder like the look's rivers, its quads listed out of order and each with its own corners. */
function ladder(middle: Vec3[], halfWidth: number) {
  const left = middle.map((p): Vec3 => [p[0], p[1], p[2] - halfWidth]), right = middle.map((p): Vec3 => [p[0], p[1], p[2] + halfWidth]);
  const positions: number[] = [];
  const order = middle.slice(1).map((_, i) => i).sort((a, b) => ((a * 7) % 5) - ((b * 7) % 5));
  for (const i of order) positions.push(...left[i], ...right[i], ...right[i + 1], ...left[i], ...right[i + 1], ...left[i + 1]);
  return { mesh: weld(positions, null), left, right };
}

test("welds a flat-shaded pool and finds its one outline", () => {
  const mesh = fan(12, 3, 0.5);
  assert.equal(mesh.points.length, 13);
  const loops = boundaryLoops(mesh.triangles);
  assert.equal(loops.length, 1);
  assert.equal(loops[0].length, 12);
  const shape = poolShape(mesh)!;
  assert.equal(shape.rim.length, 12);
  assert.deepEqual(shape.centre, [0, 0.5, 0]);
  assert.ok(Math.abs(shape.area - 0.5 * 12 * 9 * Math.sin(Math.PI / 6)) < 1e-3);
});

test("a rebuilt pool keeps its footprint and cools toward its shore", () => {
  const shape = poolShape(fan(16, 4, 1))!;
  const pool = buildPool(shape, { seed: 11 });
  const vertices = pool.positions.length / 3;
  let onRim = 0;
  for (let i = 0; i < vertices; i++) {
    const x = pool.positions[i * 3], z = pool.positions[i * 3 + 2], shore = pool.state[i * 4 + 1];
    assert.equal(pool.positions[i * 3 + 1], 1);
    assert.ok(insideLoop(x, z, shape.rim) || distanceToLoop(x, z, shape.rim) < 1e-3, "inside the look's rim");
    assert.ok(Math.abs(shore - distanceToLoop(x, z, shape.rim)) < 1e-5);
    if (shore < 1e-3) {
      onRim++;
      assert.ok(Math.hypot(pool.flow[i * 3], pool.flow[i * 3 + 1]) < 1e-6, "the crust does not move at the shore");
    }
  }
  assert.equal(onRim, 32, "the outer ring is the rim, with a point between each two of its corners");
  // the crust drifts away from where the lava wells up
  for (let i = 0; i < vertices; i++) {
    const dx = pool.positions[i * 3] - pool.upwelling[0], dz = pool.positions[i * 3 + 2] - pool.upwelling[2];
    assert.ok(pool.flow[i * 3] * dx + pool.flow[i * 3 + 1] * dz >= -1e-9);
  }
  assert.ok(pool.index.every((v) => v < vertices));
});

test("a pool is held only where there is ground under it, and its shore is where rock stands in it", () => {
  const shape = poolShape(fan(16, 4, 1))!;
  const ground = createGround(-5, -5, 5, 5, 0.1);
  // a floor half a metre under the lava for x < 1, nothing beyond; a block standing in the lava round (-2, 0)
  rasterTriangle(ground, -6, 0.5, -6, 1, 0.5, -6, 1, 0.5, 6);
  rasterTriangle(ground, -6, 0.5, -6, 1, 0.5, 6, -6, 0.5, 6);
  rasterTriangle(ground, -2.5, 2, -0.5, -1.5, 2, -0.5, -1.5, 2, 0.5);
  rasterTriangle(ground, -2.5, 2, -0.5, -1.5, 2, 0.5, -2.5, 2, 0.5);
  const made = poolGround(ground, shape.level, 3);
  assert.ok(made.held(-1, 2) > 1.5 && made.held(2.5, 0) < -1, "held over the floor, not beyond it");
  assert.ok(Math.abs(made.rock(-1, 0) - 0.5) < 0.12 && made.rock(-2, 0) === 0);
  const pool = buildPool(shape, { seed: 3, ground: made });
  let left = 0, shown = 0;
  for (let i = 0; i < pool.positions.length / 3; i++) {
    const x = pool.positions[i * 3], shore = pool.state[i * 4 + 1];
    if (x > 1.2) { assert.ok(shore < 0, "left out where nothing holds it"); left++; }
    if (x < 0.8 && shore > 0) shown++;
  }
  assert.ok(left > 50 && shown > 200);
  assert.ok(pool.upwelling[0] < 1 && made.rock(pool.upwelling[0], pool.upwelling[2]) > 0.5, "lava wells up in the open");
});

test("reads a ladder as its two rails whatever order its faces are in", () => {
  const middle: Vec3[] = [[0, 2, 0], [2, 2, 0.3], [4, 1.5, 0.2], [4.3, -4, 0.2], [6, -4.2, 0], [9, -4.1, -0.4]];
  const { mesh, left } = ladder(middle, 0.7);
  const rails = ladderRails(mesh)!;
  assert.equal(rails.left.length, 6);
  for (let i = 0; i < 6; i++) {
    const mid: Vec3 = [(rails.left[i][0] + rails.right[i][0]) / 2, (rails.left[i][1] + rails.right[i][1]) / 2, (rails.left[i][2] + rails.right[i][2]) / 2];
    const match = middle.find((p) => Math.hypot(p[0] - mid[0], p[1] - mid[1], p[2] - mid[2]) < 1e-4);
    assert.ok(match, "each rung joins the two rails across the river");
  }
  // the rungs come in order along the river, from one end or the other
  const xs = rails.left.map((p) => p[0]);
  assert.ok(xs.every((x, i) => i === 0 || x > xs[i - 1]) || xs.every((x, i) => i === 0 || x < xs[i - 1]));
  assert.ok(left.length === 6);
});

test("lava runs downhill, faster where steeper, and keeps going on the level beyond a fall", () => {
  // level, a sheer drop of 6 m, then level again
  const middle: Vec3[] = [];
  for (let x = 0; x <= 4; x += 0.4) middle.push([x, 3, 0]);
  for (let y = 2.6; y >= -3; y -= 0.4) middle.push([4, y, 0]);
  for (let x = 4.4; x <= 9; x += 0.4) middle.push([x, -3, 0]);
  const flow = stripFlow(middle, { still: 0.5, fall: 4 });
  assert.ok(Array.from(flow.speed).every((v) => v > 0), "one way from top to bottom");
  const top = flow.speed[2], drop = flow.speed[18], foot = flow.speed[middle.length - 2];
  assert.ok(Math.abs(top - 0.5) < 1e-6 && Math.abs(foot - 0.5) < 1e-6 && Math.abs(drop - 4) < 1e-6);
  assert.ok(flow.steep[18] === 1 && flow.steep[2] === 0);
  // the pattern's place grows downstream, eight times slower per metre in the fall: the crust is stretched there
  for (let i = 1; i < middle.length; i++) assert.ok(flow.travel[i] > flow.travel[i - 1]);
  const perMetreLevel = (flow.travel[2] - flow.travel[1]) / (flow.arc[2] - flow.arc[1]);
  const perMetreFall = (flow.travel[19] - flow.travel[18]) / (flow.arc[19] - flow.arc[18]);
  assert.ok(Math.abs(perMetreLevel / perMetreFall - 8) < 1e-3);
  assert.ok(Array.from(flow.fresh).every((v) => v === 0), "nothing wells up or lands along a one-way river");
  // and the same river read from its other end runs the other way
  const back = stripFlow([...middle].reverse(), { still: 0.5, fall: 4 });
  assert.ok(Array.from(back.speed).every((v) => v < 0));
});

test("lava wells up at a crest and runs down both sides", () => {
  const middle: Vec3[] = [];
  for (let i = 0; i <= 20; i++) middle.push([i * 0.4, 5 - Math.abs(i - 10) * 0.3, 0]);
  const flow = stripFlow(middle);
  assert.ok(flow.speed[3] < 0 && flow.speed[17] > 0);
  assert.equal(new Set(Array.from(flow.run)).size, 2);
  const crest = Array.from(flow.fresh).indexOf(Math.max(...Array.from(flow.fresh)));
  assert.ok(Math.abs(crest - 10) <= 1 && flow.fresh[crest] === 1 && flow.fresh[0] === 0 && flow.fresh[20] === 0);
  // on each side the pattern starts at the crest
  assert.ok(flow.travel[0] > flow.travel[5] && flow.travel[20] > flow.travel[15]);
});

test("a river is cut where it goes under another surface, and ends on that surface", () => {
  const middle: Vec3[] = [];
  for (let i = 0; i <= 30; i++) middle.push([i * 0.5, 4 - i * 0.4, 0]);
  const strip: Strip = { left: middle.map((p): Vec3 => [p[0], p[1], -1]), right: middle.map((p): Vec3 => [p[0], p[1], 1]) };
  const pieces = cutStrip(strip, (p) => p[1] < -2);
  assert.equal(pieces.length, 1);
  assert.ok(!pieces[0].cutStart && pieces[0].cutEnd);
  const last = pieces[0].strip.left[pieces[0].strip.left.length - 1];
  assert.ok(Math.abs(last[1] + 2) < 1e-3, "its last rung is at the surface it goes under");
  assert.ok(pieces[0].strip.left.every((p) => p[1] >= -2 - 1e-3));
  // under in the middle: two stretches
  const two = cutStrip(strip, (p) => p[1] < 1 && p[1] > -1);
  assert.equal(two.length, 2);
  assert.ok(two[0].cutEnd && two[1].cutStart && !two[0].cutStart && !two[1].cutEnd);
});

test("a rebuilt river stays inside its width, stands off the ground, and gives a fall a body", () => {
  const middle: Vec3[] = [[0, 3, 0], [4, 3, 0], [4.2, -3, 0], [9, -3, 0]];
  const strip = refineStrip({ left: middle.map((p): Vec3 => [p[0], p[1], -0.8]), right: middle.map((p): Vec3 => [p[0], p[1], 0.8]) }, 0.4);
  assert.ok(strip.left.length > 30);
  const river = buildRiver(strip, { across: 9, lift: 0.1 });
  const rows = strip.left.length;
  assert.equal(river.positions.length / 3, rows * 9);
  let furthestOut = 0;
  for (let i = 0; i < rows * 9; i++) {
    assert.ok(Math.abs(river.positions[i * 3 + 2]) <= 0.8 + 1e-6, "no wider than the look's river");
    assert.ok(river.flow[i * 3 + 2] === 1 && river.flow[i * 3] === 0, "a river's crust scrolls along it");
    furthestOut = Math.max(furthestOut, river.positions[i * 3]);
  }
  // half way down the fall the middle stands out from the rock face (x = 4.1 there) by about 0.45 of the half width
  const row = river.middle.findIndex((p) => p[1] < 0.2);
  const mid = (row * 9 + 4) * 3, edge = row * 9 * 3;
  assert.ok(river.positions[mid] - river.middle[row][0] > 0.3, "the fall's middle stands out");
  assert.ok(river.positions[edge] - river.middle[row][0] < 0.12, "its edges stay at the rock");
  assert.ok(river.state[(row * 9 + 4) * 4 + 2] === 1, "and the shader is told it is a fall");
  // on the level the lava lies a little above the ground, highest in the middle
  assert.ok(river.positions[4 * 3 + 1] > river.positions[1] && river.positions[1] >= 3.1 - 1e-6);
  // banks are shore, the middle is not
  assert.ok(river.state[(5 * 9) * 4 + 1] === 0 && river.state[(5 * 9 + 4) * 4 + 1] > 0.7);
});

test("a river's level stretches are laid on the ground between its rungs, and its falls are left hanging", () => {
  // rungs every 2 m on ground that dips half a metre between them; then a drop of 5 m
  const middle: Vec3[] = [[0, 1, 0], [2, 1, 0], [4, 1, 0], [4.2, -4, 0], [6, -4, 0]];
  const strip = refineStrip({ left: middle.map((p): Vec3 => [p[0], p[1], -0.5]), right: middle.map((p): Vec3 => [p[0], p[1], 0.5]) }, 0.5);
  const ground = (x: number) => (x <= 4.1 ? 1 - 0.5 * Math.abs(Math.sin((x * Math.PI) / 2)) : -4);
  const draped = drapeStrip(strip, (x) => ground(x));
  for (let i = 0; i < draped.left.length; i++) {
    const [x, y] = draped.left[i], before = strip.left[i][1];
    if (before === 1 && x < 3.7) assert.ok(Math.abs(y - ground(x)) < 1e-9, "on the ground");
    if (before < 0.5 && before > -3.5) assert.equal(y, before, "the fall is not pulled back to the rock");
    assert.equal(draped.left[i][0], strip.left[i][0]);
  }
  // ground too far from the strip is something else (a ledge above, a pit below): the strip keeps its height
  const far = drapeStrip(strip, () => 9);
  assert.deepEqual(far.left, strip.left);
});

test("a river knows its falls and where its lava lands", () => {
  const middle: Vec3[] = [];
  for (let x = 0; x <= 4; x += 0.4) middle.push([x, 3, 0]);
  for (let y = 2.6; y >= -5; y -= 0.4) middle.push([4, y, 0]);
  const strip: Strip = { left: middle.map((p): Vec3 => [p[0], p[1], -0.8]), right: middle.map((p): Vec3 => [p[0], p[1], 0.8]) };
  // the river goes under a lake at -3
  const [piece] = cutStrip(strip, (p) => p[1] < -3);
  const river = buildRiver(piece.strip, { cutStart: piece.cutStart, cutEnd: piece.cutEnd });
  assert.equal(river.landings.length, 1);
  assert.ok(Math.abs(river.landings[0].position[1] + 3) < 1e-2 && river.landings[0].steep === 1);
  const falls = riverFalls(river);
  assert.equal(falls.length, 1);
  assert.ok(falls[0].top[1] > 2 && Math.abs(falls[0].foot[1] + 3) < 0.5 && falls[0].footAtEnd);
  // fresh lava at the foot, none at the top of the level stretch
  const across = river.positions.length / 3 / river.middle.length, last = river.middle.length - 1;
  assert.ok(river.state[(last * across + 4) * 4 + 3] === 1 && river.state[(2 * across + 4) * 4 + 3] === 0);
  // read from the other end, the lava still lands at the lake
  const back = cutStrip({ left: [...strip.left].reverse(), right: [...strip.right].reverse() }, (p) => p[1] < -3)[0];
  const reversed = buildRiver(back.strip, { cutStart: back.cutStart, cutEnd: back.cutEnd });
  assert.equal(reversed.landings.length, 1);
  assert.ok(Math.abs(reversed.landings[0].position[1] + 3) < 1e-2);
});

test("surfaces merge into one, and an unknown lava mesh is kept as it is", () => {
  const a = buildPool(poolShape(fan(8, 2, 0))!, { rings: 3 }), b = buildPool(poolShape(fan(8, 1, 5))!, { rings: 3 });
  const merged = mergeSurfaces([a, b]);
  const va = a.positions.length / 3;
  assert.equal(merged.positions.length, a.positions.length + b.positions.length);
  assert.equal(merged.index.length, a.index.length + b.index.length);
  assert.equal(merged.index[a.index.length], b.index[0] + va);
  assert.equal(merged.positions[va * 3 + 1], 5);
  const plain = plainSurface([0, 1, 0, 2, 1, 0, 0, 1, 2], null, null, 0.6);
  assert.deepEqual(Array.from(plain.index), [0, 1, 2]);
  assert.deepEqual(Array.from(plain.pattern), [0, 0, 2, 0, 0, 2]);
  assert.ok(Math.abs(plain.state[0] - 0.6) < 1e-6 && plain.state[1] > 5 && plain.flow.every((v) => v === 0));
});

test("the abyss blends its parts' heats across their seam and runs down its own slope", () => {
  // two parts side by side on a sheet that slopes down toward +x; the left hot, the right cold
  const part = (x0: number, heat: number) => {
    const positions: number[] = [], index: number[] = [];
    for (let j = 0; j <= 6; j++) for (let i = 0; i <= 6; i++) positions.push(x0 + i, -0.1 * (x0 + i), j);
    for (let j = 0; j < 6; j++) for (let i = 0; i < 6; i++) {
      const a = j * 7 + i;
      index.push(a, a + 7, a + 1, a + 1, a + 7, a + 8);
    }
    return { positions: Float32Array.from(positions), index: Uint32Array.from(index), heat };
  };
  const parts = [part(0, 1), part(6, 0.2)];
  const sheet = readSheet(parts, { blend: 2, fastest: 0.5 });
  assert.equal(sheet.welded.points.length, 13 * 7, "the seam's points are shared");
  const at = (x: number, z: number) => sheet.welded.points.findIndex((p) => p[0] === x && p[2] === z);
  assert.ok(sheet.heat[at(1, 3)] > 0.95 && sheet.heat[at(11, 3)] < 0.25);
  assert.ok(sheet.heat[at(6, 3)] > 0.45 && sheet.heat[at(6, 3)] < 0.75, "half way between at the seam");
  assert.ok(sheet.heat[at(5, 3)] > sheet.heat[at(6, 3)] && sheet.heat[at(6, 3)] > sheet.heat[at(7, 3)]);
  const v = at(3, 3);
  assert.ok(sheet.flow[v * 2] > 0.2 && Math.abs(sheet.flow[v * 2 + 1]) < 1e-6, "downhill is +x");
  const surface = buildSheetPart(sheet, 0, parts[0], 0.5);
  assert.equal(surface.positions.length, parts[0].positions.length);
  assert.deepEqual(Array.from(surface.index), Array.from(parts[0].index));
  assert.ok(surface.pattern[2] === 0.5, "the pattern is the ground plane, scaled");
  const height = sheetHeightLookup(sheet.welded.points, 2);
  assert.ok(Math.abs(height(4.2, 3)! + 0.4) < 0.05 && height(40, 3) === null);
});

test("the lava's lights are the stretches that matter most to the board", () => {
  const sources: GlowSource[] = [];
  for (let i = 0; i < 20; i++) sources.push({ kind: "pool", position: [20 + i * 5, 0, 0], radius: 3, power: 30 });
  sources.push({ kind: "abyss", position: [300, -6, 0], radius: 10, power: 300 });
  const chosen = chooseGlowSources(sources, 12);
  assert.equal(chosen.length, 12);
  assert.ok(chosen.every((s) => s.kind === "pool" && s.position[0] <= 75), "the nearest pools, not a far glow of ten times the light");
  assert.equal(chooseGlowSources(sources.slice(0, 3), 12).length, 3);
});

test("the abyss's hot stretches near the board are gathered into a few lights", () => {
  const positions: number[] = [], index: number[] = [];
  // a ring of hot lava 20 to 30 m out, in quads
  for (let i = 0; i < 40; i++) {
    const a = (i / 40) * Math.PI * 2, b = ((i + 1) / 40) * Math.PI * 2, at = positions.length / 3;
    positions.push(Math.cos(a) * 20, -6, Math.sin(a) * 20, Math.cos(a) * 30, -6, Math.sin(a) * 30, Math.cos(b) * 30, -6, Math.sin(b) * 30, Math.cos(b) * 20, -6, Math.sin(b) * 20);
    index.push(at, at + 1, at + 2, at, at + 2, at + 3);
  }
  const sheet = readSheet([{ positions: Float32Array.from(positions), index: Uint32Array.from(index), heat: 1 }], { blend: 0 });
  const glows = sheetGlowSources(sheet, { count: 4, within: 55 });
  assert.equal(glows.length, 4);
  const area = glows.reduce((sum, g) => sum + Math.PI * g.radius * g.radius, 0);
  assert.ok(Math.abs(area - Math.PI * (900 - 400)) < 60, "together they stand for the whole ring");
  for (const glow of glows) {
    const r = Math.hypot(glow.position[0], glow.position[2]);
    assert.ok(r > 15 && r < 30 && glow.position[1] === -6);
  }
});

test("scatters places over a surface by its area", () => {
  const shape = poolShape(fan(16, 4, 1))!;
  const pool = buildPool(shape, { seed: 2 });
  const places = scatterOnSurface(pool, 400, seeded(4));
  assert.equal(places.length, 400);
  assert.ok(places.every((p) => p.position[1] === 1 && insideLoop(p.position[0], p.position[2], shape.rim)));
  const inner = places.filter((p) => Math.hypot(p.position[0], p.position[2]) < 2).length;
  assert.ok(inner > 60 && inner < 150, "about a quarter of them in the inner quarter of the area");
});

test("the crust texture is the same every time, tiles, and is mostly plates between thin cracks", () => {
  const a = growCrust({ size: 128, seed: 5, spacings: [40, 20, 10] }), b = growCrust({ size: 128, seed: 5, spacings: [40, 20, 10] });
  assert.deepEqual(a.data, b.data);
  const size = a.size;
  const texels = (channel: number, x: number, y: number) => {
    const v = a.data[(((y + size) % size) * size + ((x + size) % size)) * 4 + channel] / 255;
    return v * v * CRUST_REACH[channel];
  };
  let cracked = 0, wide = 0, worst = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = texels(0, x, y);
      if (d < 1) cracked++;
      if (texels(1, x, y) < 1) wide++;
      // a distance cannot change by much more than a texel from one texel to the next, across the tile's edge too
      worst = Math.max(worst, Math.abs(d - texels(0, x + 1, y)), Math.abs(d - texels(0, x, y + 1)));
      assert.ok(texels(1, x, y) >= d - 0.6, "the wide cracks are among all the cracks");
    }
  }
  assert.ok(worst < 1.6, `distances are continuous (${worst.toFixed(2)})`);
  assert.ok(cracked / (size * size) > 0.08 && cracked / (size * size) < 0.4);
  assert.ok(wide > 0 && wide < cracked * 0.7);
});
