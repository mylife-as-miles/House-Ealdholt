import test from 'node:test';
import assert from 'node:assert/strict';
import { createPopulationPreparationWindow } from './population-preparation';

test('first residents can prepare between completed world submissions without an unbounded loading gate', () => {
  const gate=createPopulationPreparationWindow(), waiting={selected:2,ready:0,loading:11};
  assert.equal(gate.defer(0,null),false);
  assert.equal(gate.defer(10,waiting),true);
  assert.equal(gate.defer(1000,waiting),true);
  assert.equal(gate.defer(1510,waiting),false);
  assert.equal(gate.status,'budget-expired');
  assert.equal(gate.defer(5000,waiting),false,'An unavailable asset must not freeze the environment.');
  assert.deepEqual(waiting,{selected:2,ready:0,loading:11},'Preparation owns no population mutation.');
});
test('a ready body releases the world immediately and a new confirmed entry gets its own bounded opportunity', () => {
  const gate=createPopulationPreparationWindow();
  assert.equal(gate.defer(0,{selected:0,ready:0,loading:8}),false,'Offscreen prefetch alone must not hold a world frame.');
  assert.equal(gate.defer(1,{selected:1,ready:0,loading:2}),true);
  assert.equal(gate.defer(20,{selected:1,ready:1,loading:1}),false);
  assert.equal(gate.status,'ready');
  assert.equal(gate.defer(30,{selected:2,ready:0,loading:2}),false,'Later camera changes do not reopen the first-entry gate.');
  gate.reset();assert.equal(gate.defer(100,{selected:1,ready:0,loading:1}),true);
});
