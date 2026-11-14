import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultHeraldry } from '../content/heraldry';
import { LEGACY_STORAGE_KEY, saveLegacy } from '../domain/persistence';
import { reduceLegacy } from '../domain/reducer';
import { createLegacyState } from '../domain/state';
import { AUTUMN_LANDMARK_FOOTPRINTS } from '../environment/settlement/layout';
import type { SettlementLayout, SettlementPlacement } from '../settlement/contract';
import { SettlementEditor } from '../settlement/editor';
import type { SettlementEditorOptions } from '../settlement/editor';
import { MAX_SETTLEMENT_PLACEMENTS, parseSettlementLayout, settlementStorageKey } from '../settlement/storage';
import type { SettlementStorage } from '../settlement/storage';
import type { SettlementSurface } from '../settlement/validation';

const BANNER = 'test-banner';
const WORLD = 'bannerhold';
const KEY = settlementStorageKey(BANNER, WORLD);

class MemoryStorage implements SettlementStorage {
  readonly items = new Map<string, string>();
  readonly writes: string[] = [];
  readonly removals: string[] = [];
  failReads = false;
  failWrites = false;
  getItem(key: string): string | null {
    if (this.failReads) throw new Error('storage is blocked');
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.writes.push(key);
    if (this.failWrites) throw new Error('device quota exceeded');
    this.items.set(key, value);
  }
  removeItem(key: string): void {
    this.removals.push(key);
    this.items.delete(key);
  }
}

function surface(extra: Partial<SettlementSurface> = {}): SettlementSurface {
  return {
    bounds: { minX: -60, maxX: 60, minZ: -60, maxZ: 60 },
    groundAt: () => 0,
    dryAt: () => true,
    obstacles: [],
    paths: [],
    ...extra,
  };
}

function editor(extra: Partial<SettlementEditorOptions> = {}) {
  const storage = extra.storage ?? new MemoryStorage();
  return {
    storage,
    controller: new SettlementEditor({
      bannerId: BANNER, worldId: WORLD, surface: surface(),
      storage, initialCursor: [20, 20], ...extra,
    }),
  };
}

function placement(extra: Partial<SettlementPlacement> = {}): SettlementPlacement {
  return { id: 'placed-1', kind: 'cottage', x: 20, z: 20, width: 8, depth: 7, rotation: 0, crop: null, ...extra };
}

function layout(placements: readonly SettlementPlacement[] = [placement()]): SettlementLayout {
  return { version: 1, bannerId: BANNER, worldId: WORLD, placements };
}

function saved(storage: MemoryStorage): SettlementLayout {
  const raw = storage.items.get(KEY);
  assert.ok(raw, 'a committed estate has its own stored value');
  const parsed = parseSettlementLayout(raw, BANNER, WORLD);
  assert.ok(parsed, 'the saved estate remains valid on reload');
  return parsed;
}

test('a cottage preview requires an explicit commit and round trips through separate estate storage', () => {
  const storage = new MemoryStorage();
  const { controller } = editor({ storage });
  assert.equal(controller.setSettlementTool('cottage'), true);
  assert.equal(controller.getSettlementSnapshot().preview?.valid, true);
  assert.equal(controller.getSettlementSnapshot().placements.length, 0);
  assert.deepEqual(storage.writes, []);
  assert.equal(controller.commitSettlementPlacement(), true);
  const state = controller.getSettlementSnapshot();
  assert.equal(state.tool, null);
  assert.equal(state.preview, null);
  assert.equal(state.placements.length, 1);
  assert.equal(state.selectedId, state.placements[0].id);
  assert.equal(state.placements[0].kind, 'cottage');
  assert.deepEqual(storage.writes, [KEY]);
  assert.deepEqual(saved(storage).placements, state.placements);
  const reloaded = editor({ storage }).controller.getSettlementSnapshot();
  assert.deepEqual(reloaded.placements, state.placements);
  assert.equal(reloaded.storageError, null);
  assert.equal(reloaded.tool, null, 'reloading does not restart placement mode');
});

test('source pavilion and masonry arch preserve their protected footprint and rotation on reload', () => {
  const storage = new MemoryStorage();
  const { controller } = editor({ storage });
  for (const [kind, width, depth, x] of [['pavilion', 4, 4, 20], ['ruin-arch', 8, 3, -20]] as const) {
    assert.equal(controller.setSettlementTool(kind), true);
    controller.setSettlementCursor(x, 20);
    controller.rotateSettlementPreview();
    const preview = controller.getSettlementSnapshot().preview!;
    assert.deepEqual([preview.kind, preview.width, preview.depth, preview.rotation], [kind, width, depth, 1]);
    assert.equal(preview.valid, true);
    assert.equal(preview.crop, null, 'v1 compatibility never introduces farming content');
    assert.equal(controller.commitSettlementPlacement(), true);
  }
  const placements = controller.getSettlementSnapshot().placements;
  assert.deepEqual(editor({ storage }).controller.getSettlementSnapshot().placements, placements);
  assert.deepEqual(placements.map(p => p.kind), ['pavilion', 'ruin-arch']);
  controller.setSettlementTool('cottage');
  controller.setSettlementCursor(20, 20);
  assert.equal(controller.getSettlementSnapshot().preview?.valid, false, 'source pavilion occupies its saved lot');
  assert.equal(controller.commitSettlementPlacement(), false);
  assert.deepEqual(saved(storage).placements, placements);
});

test('bounds, water within the footprint, steep ground and blocked terrain prevent placement', async (t) => {
  const cases: readonly { name: string; ground: SettlementSurface; cursor: readonly [number, number]; reason: RegExp }[] = [
    { name: 'the full footprint must fit inside the boundary', ground: surface(), cursor: [58, 0], reason: /boundary/i },
    // The centre and both outer X edges are dry; a wet strip crosses the interior.
    { name: 'dry centre and corners do not excuse water inside a plot', ground: surface({ dryAt: (x) => x <= 11 || x >= 13 }), cursor: [10, 0], reason: /dry ground/i },
    { name: 'a steep footprint is rejected', ground: surface({ groundAt: (x) => x * .5 }), cursor: [0, 0], reason: /steep/i },
    { name: 'renderer ground clearance is respected', ground: surface({ clearAt: () => false }), cursor: [0, 0], reason: /clear ground/i },
  ];
  for (const entry of cases) await t.test(entry.name, () => {
    const storage = new MemoryStorage();
    const { controller } = editor({ storage, surface: entry.ground, initialCursor: entry.cursor });
    controller.setSettlementTool('cottage');
    assert.equal(controller.getSettlementSnapshot().preview?.valid, false);
    assert.match(controller.getSettlementSnapshot().preview?.reason ?? '', entry.reason);
    assert.equal(controller.commitSettlementPlacement(), false);
    assert.equal(controller.getSettlementSnapshot().placements.length, 0);
    assert.deepEqual(storage.writes, []);
  });
});

test('rotated building collision follows the occupied shape rather than its axis aligned bounding box', () => {
  const { controller } = editor({
    surface: surface({ obstacles: [{ x: 0, z: 0, width: 14, depth: 2, yaw: Math.PI / 4 }] }),
  });
  controller.setSettlementTool('pavilion');
  controller.setSettlementCursor(5, 5);
  assert.equal(controller.getSettlementSnapshot().preview?.valid, true, 'the empty corner of a rotated bounding box remains usable');
  controller.setSettlementCursor(5, -5);
  assert.equal(controller.getSettlementSnapshot().preview?.valid, false, 'the actual diagonal building arm is occupied');
  assert.match(controller.getSettlementSnapshot().preview?.reason ?? '', /building/i);
});

test('quarter turn source arch rotation changes path clearance across its whole rectangle', () => {
  const storage = new MemoryStorage();
  const { controller } = editor({ storage, surface: surface({ paths: [{ points: [[-30, 0], [30, 0]], width: 2 }] }) });
  controller.setSettlementTool('ruin-arch');
  controller.rotateSettlementPreview();
  controller.setSettlementCursor(0, 4);
  assert.equal(controller.getSettlementSnapshot().preview?.valid, false, 'the long occupied shape crosses a path even though its centre is clear');
  assert.match(controller.getSettlementSnapshot().preview?.reason ?? '', /paths/i);
  assert.equal(controller.commitSettlementPlacement(), false);
  assert.deepEqual(storage.writes, []);
  assert.equal(controller.rotateSettlementPreview(), true);
  assert.equal(controller.getSettlementSnapshot().preview?.valid, true);
  assert.equal(controller.commitSettlementPlacement(), true);
  assert.equal(saved(storage).placements[0].rotation, 2);
});

test('overlapping placed buildings are rejected until the preview moves to clear ground', () => {
  const { controller } = editor();
  controller.setSettlementTool('cottage');
  assert.equal(controller.commitSettlementPlacement(), true);
  controller.setSettlementTool('storehouse');
  assert.equal(controller.getSettlementSnapshot().preview?.valid, false);
  assert.match(controller.getSettlementSnapshot().preview?.reason ?? '', /another placement/i);
  assert.equal(controller.commitSettlementPlacement(), false);
  controller.setSettlementCursor(-20, 20);
  assert.equal(controller.getSettlementSnapshot().preview?.valid, true);
  assert.equal(controller.commitSettlementPlacement(), true);
  const [first, second] = controller.getSettlementSnapshot().placements;
  assert.notEqual(first.id, second.id);
  assert.equal(second.kind, 'storehouse');
});

test('source building dimensions and rotation survive reload and selected removal', () => {
  const storage = new MemoryStorage();
  const { controller } = editor({ storage });
  controller.setSettlementTool('storehouse');
  controller.rotateSettlementPreview();
  assert.equal(controller.commitSettlementPlacement(), true);
  const building = controller.getSettlementSnapshot().placements[0];
  assert.deepEqual([building.width, building.depth, building.rotation, building.crop], [10, 8, 1, null]);
  const reloaded = editor({ storage }).controller;
  assert.equal(reloaded.selectSettlementPlacement(building.id), true);
  assert.equal(reloaded.getSettlementSnapshot().selectedId, building.id);
  assert.equal(reloaded.deleteSettlementPlacement(), true);
  assert.deepEqual(saved(storage).placements, []);
});

test('unavailable tools and nonfinite cursor values leave a valid building preview intact', () => {
  const storage = new MemoryStorage();
  const { controller } = editor({ storage });
  controller.setSettlementTool('cottage');
  const before = controller.getSettlementSnapshot().preview;
  for (const tool of ['field', 'castle', ''] as const) {
    assert.equal(controller.setSettlementTool(tool as never), false);
    assert.deepEqual(controller.getSettlementSnapshot().preview, before);
  }
  for (const [x, z] of [[NaN, 0], [0, Infinity]]) {
    assert.equal(controller.setSettlementCursor(x, z), false);
    assert.deepEqual(controller.getSettlementSnapshot().preview, before);
  }
  assert.deepEqual(storage.writes, []);
});

test('cancel and invalid commit never write or remove a pending plot', () => {
  const storage = new MemoryStorage();
  const { controller } = editor({ storage, surface: surface({ obstacles: [{ x: 0, z: 0, width: 10, depth: 10 }] }) });
  controller.setSettlementTool('cottage');
  assert.equal(controller.getSettlementSnapshot().preview?.valid, true);
  controller.cancelSettlementPlacement();
  assert.equal(controller.getSettlementSnapshot().preview, null);
  assert.equal(controller.commitSettlementPlacement(), false);
  controller.setSettlementTool('cottage');
  controller.setSettlementCursor(0, 0);
  assert.equal(controller.commitSettlementPlacement(), false);
  assert.match(controller.getSettlementSnapshot().message ?? '', /building/i);
  assert.equal(controller.getSettlementSnapshot().placements.length, 0);
  assert.deepEqual(storage.writes, []);
  assert.deepEqual(storage.removals, []);
});

test('removal only deletes placed objects and leaves all four fixed landmarks unchanged', () => {
  const storage = new MemoryStorage();
  const landmarksBefore = JSON.stringify(AUTUMN_LANDMARK_FOOTPRINTS);
  const { controller } = editor({ storage });
  controller.setSettlementTool('cottage');
  controller.commitSettlementPlacement();
  const id = controller.getSettlementSnapshot().selectedId!;
  for (const landmark of AUTUMN_LANDMARK_FOOTPRINTS) {
    assert.equal(controller.selectSettlementPlacement(landmark.id), false);
    assert.equal(controller.deleteSettlementPlacement(landmark.id), false);
  }
  assert.equal(controller.deleteSettlementPlacement('unknown-placement'), false);
  assert.equal(controller.getSettlementSnapshot().placements.length, 1);
  assert.equal(controller.deleteSettlementPlacement(id), true);
  assert.deepEqual(saved(storage).placements, []);
  assert.equal(controller.getSettlementSnapshot().selectedId, null);
  assert.equal(JSON.stringify(AUTUMN_LANDMARK_FOOTPRINTS), landmarksBefore);
});

test('failed device storage is disclosed while a session placement remains usable', () => {
  const storage = new MemoryStorage();
  const { controller } = editor({ storage });
  storage.failWrites = true;
  controller.setSettlementTool('cottage');
  assert.equal(controller.commitSettlementPlacement(), true, 'an in-memory placement can still be made');
  const state = controller.getSettlementSnapshot();
  assert.equal(state.placements.length, 1);
  assert.match(state.storageError ?? '', /could not be saved.*session/i);
  assert.doesNotMatch(state.message ?? '', /\bsaved\b/i);
  assert.equal(storage.items.has(KEY), false);
  storage.failWrites = false;
  controller.setSettlementTool('storehouse');
  controller.setSettlementCursor(-20, 20);
  controller.commitSettlementPlacement();
  assert.equal(controller.getSettlementSnapshot().storageError, null);
  assert.equal(saved(storage).placements.length, 2, 'a later successful write includes session changes');
  storage.failReads = true;
  assert.match(editor({ storage }).controller.getSettlementSnapshot().storageError ?? '', /could not be read/i);
  assert.match(editor({ storage: null }).controller.getSettlementSnapshot().storageError ?? '', /unavailable/i);
});

test('malformed and cross banner or world saves are rejected without changing their bytes', async (t) => {
  const valid = layout();
  const corrupt: readonly { name: string; value: unknown }[] = [
    { name: 'invalid JSON', value: '{broken' },
    { name: 'future version', value: { ...valid, version: 2 } },
    { name: 'different banner', value: { ...valid, bannerId: 'another-banner' } },
    { name: 'different world', value: { ...valid, worldId: 'golden-temple' } },
    { name: 'unknown kind', value: layout([placement({ kind: 'castle' as never })]) },
    { name: 'invalid building dimensions', value: layout([placement({ width: 200 })]) },
    { name: 'building cannot carry crop content', value: layout([placement({ crop: 'unknown' as never })]) },
    { name: 'invalid rotation', value: layout([placement({ rotation: 4 as never })]) },
    { name: 'nonfinite position', value: layout([placement({ x: NaN })]) },
    { name: 'duplicate ids', value: layout([placement(), placement({ x: -20 })]) },
    { name: 'too many placements', value: layout(Array.from({ length: MAX_SETTLEMENT_PLACEMENTS + 1 }, (_, i) => placement({ id: `placed-${i}` }))) },
  ];
  for (const entry of corrupt) await t.test(entry.name, () => {
    const raw = typeof entry.value === 'string' ? entry.value : JSON.stringify(entry.value);
    assert.equal(parseSettlementLayout(raw, BANNER, WORLD), null);
    const storage = new MemoryStorage();
    storage.items.set(KEY, raw);
    const state = editor({ storage }).controller.getSettlementSnapshot();
    assert.deepEqual(state.placements, []);
    assert.match(state.storageError ?? '', /could not be read/i);
    assert.equal(storage.items.get(KEY), raw);
    assert.deepEqual(storage.writes, []);
    assert.deepEqual(storage.removals, []);
  });
  const storage = new MemoryStorage();
  storage.items.set(KEY, JSON.stringify(valid));
  assert.deepEqual(editor({ storage, bannerId: 'another-banner' }).controller.getSettlementSnapshot().placements, []);
  assert.deepEqual(editor({ storage, worldId: 'golden-temple' }).controller.getSettlementSnapshot().placements, []);
  assert.notEqual(settlementStorageKey('banner.one', 'bannerhold'), settlementStorageKey('banner', 'bannerhold'));
});

test('older mixed estate saves drop retired fields while retaining building identity and exact house bytes', () => {
  const storage = new MemoryStorage();
  const cottage = placement({ id: 'estate-7' });
  const storehouse = placement({ id: 'estate-8', kind: 'storehouse', x: -20, width: 10, depth: 8, rotation: 1 });
  const historicalField = { id: 'field-01', kind: 'field', x: 0, z: -20, width: 12, depth: 8, rotation: 0, crop: 'oats' };
  const raw = JSON.stringify({ version: 1, bannerId: BANNER, worldId: WORLD, placements: [historicalField, cottage, storehouse] });
  storage.items.set(KEY, raw);
  storage.items.set(LEGACY_STORAGE_KEY, 'existing private house bytes');
  assert.deepEqual(parseSettlementLayout(raw, BANNER, WORLD)?.placements, [cottage, storehouse]);
  const { controller } = editor({ storage });
  assert.deepEqual(controller.getSettlementSnapshot().placements, [cottage, storehouse]);
  assert.equal(controller.getSettlementSnapshot().storageError, null);
  assert.equal(storage.items.get(KEY), raw, 'reading a retired field does not silently rewrite device data');
  assert.deepEqual(storage.writes, []);
  assert.equal(controller.selectSettlementPlacement('field-01'), false);
  assert.equal(controller.selectSettlementPlacement('estate-8'), true);
  assert.equal(controller.deleteSettlementPlacement(), true);
  assert.deepEqual(saved(storage).placements, [cottage]);
  assert.equal(storage.items.get(LEGACY_STORAGE_KEY), 'existing private house bytes');
  assert.deepEqual(editor({ storage }).controller.getSettlementSnapshot().placements, [cottage]);
});

test('saved placements cannot impersonate any of the four fixed landmark ids', () => {
  for (const landmark of AUTUMN_LANDMARK_FOOTPRINTS) {
    assert.equal(parseSettlementLayout(JSON.stringify(layout([placement({ id: landmark.id })])), BANNER, WORLD), null, landmark.id);
  }
});

test('estate edits preserve the exact chess authoritative house save and progression bytes', () => {
  const at = '2026-02-01T10:00:00.000Z';
  const founded = reduceLegacy(createLegacyState({ at }), {
    type: 'found-banner', name: 'House Ashgrove', nationId: 'solforiz',
    heraldry: defaultHeraldry('solforiz'), motto: null, at, seed: 11,
  });
  assert.equal(founded.error, null);
  const house = founded.state;
  const storage = new MemoryStorage();
  assert.deepEqual(saveLegacy(storage, house), { ok: true });
  const bytes = storage.items.get(LEGACY_STORAGE_KEY);
  const stateBytes = JSON.stringify(house);
  storage.writes.length = 0;
  const { controller } = editor({ storage, bannerId: house.banner!.id });
  controller.setSettlementTool('cottage');
  controller.commitSettlementPlacement();
  const cottage = controller.getSettlementSnapshot().selectedId!;
  controller.setSettlementTool('storehouse');
  controller.setSettlementCursor(-20, 20);
  controller.rotateSettlementPreview();
  controller.commitSettlementPlacement();
  controller.deleteSettlementPlacement(cottage);
  assert.equal(controller.getSettlementSnapshot().placements.length, 1);
  assert.equal(storage.items.get(LEGACY_STORAGE_KEY), bytes);
  assert.equal(JSON.stringify(house), stateBytes);
  assert.ok(storage.writes.length > 0);
  assert.ok(storage.writes.every(key => key === settlementStorageKey(house.banner!.id, WORLD)));
  assert.deepEqual(storage.removals, []);
});

test('unfounded banners and unavailable surfaces cannot enter placement mode', () => {
  const storage = new MemoryStorage();
  const unfounded = editor({ storage, bannerId: null }).controller;
  assert.equal(unfounded.getSettlementSnapshot().available, false);
  assert.match(unfounded.getSettlementSnapshot().reason ?? '', /found your banner/i);
  assert.equal(unfounded.setSettlementTool('cottage'), false);
  const unavailable = editor({ storage, surface: null }).controller;
  assert.equal(unavailable.getSettlementSnapshot().available, false);
  assert.equal(unavailable.setSettlementTool('pavilion'), false);
  assert.equal(unavailable.commitSettlementPlacement(), false);
  assert.deepEqual(storage.writes, []);
});

test('a plot outside the platform view cannot be placed until it is visible and explicitly committed', () => {
  const storage = new MemoryStorage();
  const offscreenReason = 'Move the plot into view before placing it.';
  const { controller } = editor({ storage, previewGuard: () => offscreenReason });
  assert.equal(controller.setSettlementTool('cottage'), true);
  const hidden = controller.getSettlementSnapshot();
  assert.equal(hidden.available, true, 'the estate and flat dry plot are otherwise usable');
  assert.equal(hidden.preview?.valid, false);
  assert.equal(hidden.preview?.reason, offscreenReason);
  assert.equal(controller.commitSettlementPlacement(), false);
  assert.deepEqual(controller.getSettlementSnapshot().placements, []);
  assert.deepEqual(storage.writes, []);

  controller.setPreviewGuard(() => null);
  assert.equal(controller.getSettlementSnapshot().preview?.valid, true);
  assert.deepEqual(controller.getSettlementSnapshot().placements, [], 'bringing the ghost into view does not place it automatically');
  assert.deepEqual(storage.writes, []);
  assert.equal(controller.commitSettlementPlacement(), true);
  assert.equal(controller.getSettlementSnapshot().placements.length, 1);
  assert.deepEqual(storage.writes, [KEY]);
  assert.equal(saved(storage).placements[0].kind, 'cottage');
});
