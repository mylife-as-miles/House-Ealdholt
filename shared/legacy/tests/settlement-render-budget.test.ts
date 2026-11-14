import assert from 'node:assert/strict';
import test from 'node:test';
import { ESTATE_RENDER_LIMIT, settlementRenderCost } from '../settlement/budget';
import { SettlementEditor } from '../settlement/editor';
import { MAX_SETTLEMENT_PLACEMENTS } from '../settlement/storage';

const surface = { bounds: { minX: -200, maxX: 200, minZ: -200, maxZ: 200 }, groundAt: () => 0, dryAt: () => true, obstacles: [], paths: [] };

test('detailed source buildings stop before exhausting the shared scene allowance and recover after removal', () => {
  let writes = 0;
  const editor = new SettlementEditor({ bannerId: 'test', worldId: 'bannerhold', surface, storage: { getItem: () => null, setItem: () => { writes++; } } });
  for (let i = 0; i < 3; i++) {
    editor.setSettlementTool('pavilion'); editor.setSettlementCursor(i * 12, 0);
    assert.equal(editor.commitSettlementPlacement(), true);
  }
  editor.setSettlementTool('pavilion'); editor.setSettlementCursor(60, 0);
  const before = editor.getSettlementSnapshot().placements;
  assert.match(editor.getSettlementSnapshot().preview?.reason ?? '', /detail limit/);
  assert.equal(editor.commitSettlementPlacement(), false);
  assert.deepEqual(editor.getSettlementSnapshot().placements, before);
  assert.equal(writes, 3);
  editor.deleteSettlementPlacement(before[0].id);
  assert.equal(editor.getSettlementSnapshot().preview?.valid, true, 'removing a source structure restores room');
  assert.equal(editor.commitSettlementPlacement(), true);
  assert.equal(editor.getSettlementSnapshot().placements.length, 3);
});

test('draw allowance limits cheaper source buildings without discarding committed geometry on reload', () => {
  const values = new Map<string, string>(); let writes = 0;
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { writes++; values.set(key, value); } };
  const options = { bannerId: 'test', worldId: 'bannerhold' as const, surface, storage };
  const editor = new SettlementEditor(options);
  let rejected = false;
  for (let i = 0; i < MAX_SETTLEMENT_PLACEMENTS; i++) {
    editor.setSettlementTool('cottage'); editor.setSettlementCursor(-98 + (i % 10) * 14, -56 + Math.floor(i / 10) * 14);
    const state = editor.getSettlementSnapshot();
    if (!state.preview?.valid) {
      assert.match(state.preview?.reason ?? '', /detail limit/);
      const attempted = settlementRenderCost([...state.placements, state.preview!]);
      assert.ok(attempted.draws > ESTATE_RENDER_LIMIT.draws);
      assert.ok(attempted.triangles < ESTATE_RENDER_LIMIT.triangles, 'the independent draw allowance is the limiting factor');
      assert.equal(editor.commitSettlementPlacement(), false); rejected = true; break;
    }
    assert.equal(editor.commitSettlementPlacement(), true);
  }
  assert.equal(rejected, true);
  const committed = editor.getSettlementSnapshot().placements;
  assert.ok(committed.length > 0 && committed.length < MAX_SETTLEMENT_PLACEMENTS);
  assert.equal(writes, committed.length, 'a rejected preview never writes a partial layout');
  assert.deepEqual(new SettlementEditor(options).getSettlementSnapshot().placements, committed);
});
