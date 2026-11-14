import assert from 'node:assert/strict';
import test from 'node:test';
import type { VillageResidentAvailability } from '../../../../../shared/legacy/aethelgard/characters/village-resident-availability';
import { describeResidentFollowTrace } from './resident-follow-trace';

const residentId = 'ealdholt-garrison-spearman';
const qualified: VillageResidentAvailability = { residentId, position: [5, 0, 7], body: 'qualified', reason: null,
  bodyReady: true, drawnFrame: 152, renderFrame: 152 };

test('the selected resident trace identifies a matching real camera submission in the completed canvas frame', () => {
  const before = JSON.stringify(qualified), trace = describeResidentFollowTrace(residentId, qualified, 152, 19);
  assert.equal(trace.residentId, residentId); assert.equal(trace.body, 'qualified');
  assert.deepEqual(trace.sourcePosition, [5, 0, 7]); assert.equal(trace.bodyReady, true);
  assert.equal(trace.submittedResidentId, residentId); assert.equal(trace.submittedFrame, 152);
  assert.equal(trace.rendererFrame, trace.submittedFrame); assert.equal(trace.availabilityFrame, trace.submittedFrame);
  assert.equal(trace.canvasFrame, 19); assert.equal(trace.submissionCamera, 'main');
  assert.equal(JSON.stringify(qualified), before);
});

test('known placement, a loaded body, a different resident or an earlier frame cannot claim a current submitted figure', () => {
  for (const value of [null, { ...qualified, residentId: 'ealdholt-spearman-husband' },
    { ...qualified, body: 'pending' as const }, { ...qualified, body: 'held' as const, reason: 'activity-unavailable' },
    { ...qualified, bodyReady: false }, { ...qualified, drawnFrame: null }, { ...qualified, drawnFrame: 151 },
    { ...qualified, renderFrame: 151 }]) {
    const trace = describeResidentFollowTrace(residentId, value, 152, 19);
    assert.equal(trace.submittedResidentId, null); assert.equal(trace.submittedFrame, null); assert.equal(trace.submissionCamera, null);
  }
  assert.equal(describeResidentFollowTrace(residentId, qualified, NaN, 19).submittedResidentId, null);
  const none = describeResidentFollowTrace(null, qualified, 152, 19);
  assert.equal(none.body, null); assert.equal(none.sourcePosition, null); assert.equal(none.submittedResidentId, null);
});
