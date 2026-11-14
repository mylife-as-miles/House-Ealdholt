import assert from "node:assert/strict";
import test from "node:test";
import { QUALITY_ORDER } from "../../web/src/scene/quality";
import {
  FLIPBOOK_BUDGET,
  FLIPBOOK_FIELD,
  FLIPBOOK_FOREVER,
  FLIPBOOK_QUEST_BUDGET,
  FLIPBOOK_STRIDE,
  FlipbookPool,
  flipbookCell,
  flipbookDuration,
  flipbookEnvelope,
  flipbookFrame,
  type FlipbookClip,
  type FlipbookSpawn,
} from "../../web/src/scene/vfx/flipbookCore";
import { VFX_ATLASES, VFX_RECIPES, type VfxEffectId } from "../../web/src/scene/vfx/library";

const ONCE: FlipbookClip = { frames: 8, fps: 16, loop: false };
const LOOP: FlipbookClip = { frames: 8, fps: 16, loop: true };
const AT: FlipbookSpawn = { x: 1, y: 2, z: 3, size: 1.5 };

// ---------------------------------------------------------------- frame selection

test("a one-shot starts on frame 0, blends forward and holds its last frame", () => {
  assert.deepEqual(flipbookFrame(ONCE, 0), { index: 0, next: 1, blend: 0, done: false });
  const mid = flipbookFrame(ONCE, 2.5 / 16);
  assert.equal(mid.index, 2);
  assert.equal(mid.next, 3);
  assert.ok(Math.abs(mid.blend - 0.5) < 1e-9);
  // On the last frame there is nothing to blend towards.
  const last = flipbookFrame(ONCE, 7.6 / 16);
  assert.deepEqual([last.index, last.next, last.blend, last.done], [7, 7, 0, false]);
  // Past the end it stays on the last frame and reports done.
  const over = flipbookFrame(ONCE, 3);
  assert.deepEqual([over.index, over.next, over.blend, over.done], [7, 7, 0, true]);
  assert.equal(flipbookFrame(ONCE, 8 / 16).done, true);
  assert.equal(flipbookFrame(ONCE, 7.99 / 16).done, false);
});

test("a loop wraps, and its last frame blends back into its first", () => {
  const wrap = flipbookFrame(LOOP, 7.25 / 16);
  assert.deepEqual([wrap.index, wrap.next], [7, 0]);
  assert.ok(Math.abs(wrap.blend - 0.25) < 1e-9);
  const again = flipbookFrame(LOOP, (8 * 5 + 3) / 16);
  assert.deepEqual([again.index, again.next, again.done], [3, 4, false]);
  // A loop is never done, however long it has run.
  assert.equal(flipbookFrame(LOOP, 1e5).done, false);
});

test("frame offset shifts the start, a negative age clamps to the start, fps overrides the clip", () => {
  assert.equal(flipbookFrame(LOOP, 0, 16, 5).index, 5);
  assert.equal(flipbookFrame(LOOP, 0, 16, 13).index, 5);
  assert.equal(flipbookFrame(ONCE, -4).index, 0);
  assert.equal(flipbookFrame(ONCE, 0.25, 32).index, 7);
  assert.equal(flipbookFrame(ONCE, 0.25, 8).index, 2);
  assert.equal(flipbookFrame(ONCE, 10, 0).index, 0);
});

test("every frame of every atlas is reachable and inside the grid", () => {
  const out = { index: 0, next: 0, blend: 0, done: false };
  for (const atlas of Object.values(VFX_ATLASES)) {
    assert.ok(atlas.frames <= atlas.cols * atlas.rows, atlas.id);
    assert.ok(atlas.frames > atlas.cols * (atlas.rows - 1), `${atlas.id} has an empty row`);
    const seen = new Set<number>();
    const steps = atlas.frames * 4;
    for (let i = 0; i < steps; i++) {
      flipbookFrame(atlas, (i / 4 + 0.01) / atlas.fps, atlas.fps, 0, out);
      seen.add(out.index);
      assert.ok(out.index >= 0 && out.index < atlas.frames && out.next >= 0 && out.next < atlas.frames);
      assert.ok(out.blend >= 0 && out.blend < 1);
      const [u, v] = flipbookCell(out.index, atlas.cols, atlas.rows);
      assert.ok(u >= 0 && u + 1 / atlas.cols <= 1 + 1e-9 && v >= 0 && v + 1 / atlas.rows <= 1 + 1e-9);
    }
    assert.equal(seen.size, atlas.frames, atlas.id);
  }
  assert.deepEqual(flipbookCell(0, 8, 6), [0, 0]);
  assert.deepEqual(flipbookCell(9, 8, 6), [1 / 8, 1 / 6]);
  assert.deepEqual(flipbookCell(47, 8, 6), [7 / 8, 5 / 6]);
});

test("frame selection writes into the caller's object", () => {
  const out = { index: 0, next: 0, blend: 0, done: false };
  assert.equal(flipbookFrame(ONCE, 0.2, 16, 0, out), out);
  assert.equal(out.index, 3);
});

test("the envelope is zero outside the life and fades at both ends", () => {
  assert.equal(flipbookEnvelope(-0.1, 2, 0.5, 0.5), 0);
  assert.equal(flipbookEnvelope(2, 2, 0.5, 0.5), 0);
  assert.equal(flipbookEnvelope(1, 2, 0.5, 0.5), 1);
  assert.equal(flipbookEnvelope(0.25, 2, 0.5, 0), 0.5);
  assert.equal(flipbookEnvelope(1.75, 2, 0, 0.5), 0.5);
  assert.equal(flipbookEnvelope(0, 2, 0, 0), 1);
  assert.equal(flipbookDuration(ONCE), 0.5);
  assert.equal(flipbookDuration(ONCE, 4), 2);
});

// ---------------------------------------------------------------- pooling

test("a spawn fills one slot in the documented layout and allocates nothing", () => {
  const pool = new FlipbookPool(ONCE, 4);
  const buffer = pool.data;
  assert.equal(buffer.length, 4 * FLIPBOOK_STRIDE);
  const handle = pool.spawn(10, { ...AT, delay: 0.5, vy: 0.2, growth: 0.3, rotation: 1, spin: 2, flip: true, alpha: 0.7, r: 0.1, g: 0.2, b: 0.3, additive: 1, fadeIn: 0.1, fadeOut: 0.2, soft: 0.15, mono: 1, frameOffset: 2 });
  assert.ok(handle >= 0);
  assert.equal(pool.data, buffer, "the buffer is never replaced");
  assert.equal(pool.active, 1);
  const o = (handle % pool.capacity) * FLIPBOOK_STRIDE;
  const read = (field: number, n = 4) => Array.from(buffer.subarray(o + field, o + field + n), (v) => Math.round(v * 1e4) / 1e4);
  assert.deepEqual(read(FLIPBOOK_FIELD.transform), [1, 2, 3, 1.5]);
  assert.deepEqual(read(FLIPBOOK_FIELD.motion), [0, 0.2, 0, 0.3]);
  // Six of the eight frames are left after an offset of two.
  assert.deepEqual(read(FLIPBOOK_FIELD.timing), [10.5, 16, 0.375, 2]);
  assert.deepEqual(read(FLIPBOOK_FIELD.look), [1, 2, -1, 0.7]);
  assert.deepEqual(read(FLIPBOOK_FIELD.tint), [0.1, 0.2, 0.3, 1]);
  assert.deepEqual(read(FLIPBOOK_FIELD.fade), [0.1, 0.2, 0.15, 1]);
  assert.deepEqual([pool.dirtyFrom, pool.dirtyTo], [handle % pool.capacity, (handle % pool.capacity) + 1]);
  pool.flushed();
  assert.ok(pool.dirtyFrom >= pool.dirtyTo);
});

test("defaults: white, opaque, the clip's rate, one pass for a one-shot and forever for a loop", () => {
  const once = new FlipbookPool(ONCE, 2), loop = new FlipbookPool(LOOP, 2);
  once.spawn(0, AT);
  loop.spawn(0, AT);
  assert.equal(once.data[FLIPBOOK_FIELD.timing + 2], 0.5);
  assert.equal(loop.data[FLIPBOOK_FIELD.timing + 2], FLIPBOOK_FOREVER);
  assert.deepEqual(Array.from(once.data.subarray(FLIPBOOK_FIELD.look, FLIPBOOK_FIELD.look + 8)), [0, 0, 1, 1, 1, 1, 1, 0]);
  // A faster rate shortens a one-shot's life to match.
  const fast = new FlipbookPool(ONCE, 1);
  fast.spawn(0, { ...AT, fps: 32 });
  assert.equal(fast.data[FLIPBOOK_FIELD.timing + 2], 0.25);
});

test("one-shots free their slot when they finish; loops stay until released", () => {
  const once = new FlipbookPool(ONCE, 3);
  const a = once.spawn(0, AT), b = once.spawn(0.2, AT);
  assert.equal(once.expire(0.49), 2);
  assert.ok(once.alive(a, 0.49));
  assert.equal(once.expire(0.5), 1);
  assert.ok(!once.alive(a, 0.5) && once.alive(b, 0.5));
  assert.equal(once.expire(0.7), 0);

  const loop = new FlipbookPool(LOOP, 3);
  const fire = loop.spawn(0, AT);
  assert.equal(loop.expire(3600), 1);
  assert.equal(loop.release(fire, 3600, 0.5), true);
  const o = (fire % loop.capacity) * FLIPBOOK_STRIDE;
  assert.equal(loop.data[o + FLIPBOOK_FIELD.timing + 2], 3600.5);
  assert.equal(loop.data[o + FLIPBOOK_FIELD.fade + 1], 0.5);
  assert.equal(loop.expire(3600.4), 1);
  assert.equal(loop.expire(3600.5), 0);
  assert.equal(loop.release(fire, 3601), false, "the sprite has already gone");
});

test("a delayed sprite holds its slot until its own end", () => {
  const pool = new FlipbookPool(ONCE, 1);
  pool.spawn(0, { ...AT, delay: 1 });
  assert.equal(pool.expire(1.2), 1);
  assert.equal(pool.expire(1.5), 0);
});

test("freed slots are reused and capacity is never exceeded", () => {
  const pool = new FlipbookPool(ONCE, 4);
  const buffer = pool.data;
  for (let wave = 0; wave < 50; wave++) {
    const now = wave;
    for (let i = 0; i < 4; i++) assert.ok(pool.spawn(now, AT) >= 0);
    assert.equal(pool.active, 4);
    assert.equal(pool.expire(now + 0.6), 0);
  }
  assert.equal(pool.stolen, 0);
  assert.equal(pool.data, buffer);
  assert.equal(pool.data.length, 4 * FLIPBOOK_STRIDE);
});

test("a full pool replaces its oldest one-shot, and a stale handle cannot touch the newcomer", () => {
  const pool = new FlipbookPool({ frames: 8, fps: 1, loop: false }, 3);
  const first = pool.spawn(0, AT), second = pool.spawn(1, AT), third = pool.spawn(2, AT);
  const fourth = pool.spawn(3, { ...AT, x: 9 });
  assert.equal(pool.active, 3);
  assert.equal(pool.stolen, 1);
  assert.equal(fourth % pool.capacity, first % pool.capacity, "the oldest slot was taken");
  assert.notEqual(fourth, first);
  assert.equal(pool.alive(first, 3), false);
  assert.equal(pool.release(first, 3), false);
  assert.equal(pool.data[(fourth % pool.capacity) * FLIPBOOK_STRIDE], 9);
  assert.ok(pool.alive(second, 3) && pool.alive(third, 3) && pool.alive(fourth, 3));
});

test("a full pool keeps its loops while there is a one-shot to replace", () => {
  const pool = new FlipbookPool(LOOP, 3);
  const fire = pool.spawn(0, AT);
  const puffA = pool.spawn(1, { ...AT, life: 5 });
  pool.spawn(2, { ...AT, life: 5 });
  const puffC = pool.spawn(3, { ...AT, life: 5 });
  assert.equal(puffC % pool.capacity, puffA % pool.capacity);
  assert.ok(pool.alive(fire, 3));
  // Only loops left: the oldest loop goes.
  const loops = new FlipbookPool(LOOP, 2);
  const one = loops.spawn(0, AT), two = loops.spawn(1, AT), three = loops.spawn(2, AT);
  assert.ok(!loops.alive(one, 2) && loops.alive(two, 2) && loops.alive(three, 2));
});

test("clear empties the pool and hides every slot on the GPU copy", () => {
  const pool = new FlipbookPool(LOOP, 4);
  const handles = [pool.spawn(0, AT), pool.spawn(0, AT), pool.spawn(0, AT)];
  pool.flushed();
  pool.clear();
  assert.equal(pool.active, 0);
  for (const handle of handles) {
    assert.equal(pool.data[(handle % pool.capacity) * FLIPBOOK_STRIDE + FLIPBOOK_FIELD.timing + 2], 0, "life 0 draws nothing");
    assert.equal(pool.alive(handle, 0), false);
  }
  assert.deepEqual([pool.dirtyFrom, pool.dirtyTo], [0, 3]);
  assert.ok(pool.spawn(1, AT) >= 0);
});

test("dispose stops everything: no spawns, no releases, nothing alive", () => {
  const pool = new FlipbookPool(LOOP, 4);
  const handle = pool.spawn(0, AT);
  pool.dispose();
  assert.equal(pool.active, 0);
  assert.equal(pool.spawn(1, AT), -1);
  assert.equal(pool.release(handle, 1), false);
  assert.equal(pool.alive(handle, 1), false);
  assert.equal(pool.expire(2), 0);
  pool.dispose();
});

test("a pool with no budget refuses politely", () => {
  const pool = new FlipbookPool(ONCE, 0);
  assert.equal(pool.spawn(0, AT), -1);
  assert.equal(pool.expire(1), 0);
  pool.clear();
});

// ---------------------------------------------------------------- budgets and recipes

test("budgets grow with the preset and Quest stays on the small atlases", () => {
  let previous = 0;
  for (const preset of QUALITY_ORDER) {
    const budget = FLIPBOOK_BUDGET[preset];
    assert.ok(budget.instances >= previous && budget.instances > 0, preset);
    previous = budget.instances;
  }
  assert.equal(FLIPBOOK_BUDGET.low.tier, "quest");
  assert.equal(FLIPBOOK_BUDGET.high.tier, "desktop");
  assert.equal(FLIPBOOK_QUEST_BUDGET.tier, "quest");
  assert.equal(FLIPBOOK_QUEST_BUDGET.softDepth, false);
});

test("every recipe fits the smallest budget and uses real atlases", () => {
  const smallest = Math.min(FLIPBOOK_QUEST_BUDGET.instances, ...QUALITY_ORDER.map((preset) => FLIPBOOK_BUDGET[preset].instances));
  for (const [name, parts] of Object.entries(VFX_RECIPES)) {
    assert.ok(parts.length > 0, name);
    const perAtlas = new Map<VfxEffectId, number>();
    for (const part of parts) {
      const atlas = VFX_ATLASES[part.effect];
      assert.ok(atlas, `${name} uses ${part.effect}`);
      assert.ok(part.size > 0 && part.tint.length === 3);
      assert.ok((part.frameOffset ?? 0) < atlas.frames);
      perAtlas.set(part.effect, (perAtlas.get(part.effect) ?? 0) + 1);
    }
    // Four of the same recipe at once (a volley) still fit without replacing each other.
    for (const [effect, count] of perAtlas) assert.ok(count * 4 <= smallest, `${name} needs ${count} ${effect} sprites`);
  }
});
