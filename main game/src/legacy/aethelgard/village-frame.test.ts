import assert from 'node:assert/strict';
import test from 'node:test';
import {createVillageDiagnosticsReporter, createVillageFrameGuard, villageFrameInterval, villageFrameLimit} from './village-frame';

test('a throw in the frame body stops the loop once and reports the error', () => {
  const failures: unknown[] = []; let runs = 0;
  const guard = createVillageFrameGuard(now => { runs++; if (now === 2) throw Error('update failed'); }, error => failures.push(error));
  guard.run(1); guard.run(2); guard.run(3); guard.run(4);
  assert.equal(runs, 2, 'no frame body runs after the failure');
  assert.equal(failures.length, 1); assert.match(String(failures[0]), /update failed/);
  assert.equal(guard.failed, true); assert.equal(guard.failure, failures[0]);
});

test('a failing error reporter does not escape the animation frame', () => {
  const guard = createVillageFrameGuard(() => { throw Error('frame'); }, () => { throw Error('panel'); });
  const original = console.error; let logged = 0; console.error = () => { logged++; };
  try { assert.doesNotThrow(() => guard.run(0)); } finally { console.error = original; }
  assert.equal(logged, 1); assert.equal(guard.failed, true);
});

test('camera motion honours the player limit; ambient animation alone runs at 30 Hz', () => {
  for (const frameLimit of [0, 60, 120, 144]) {
    assert.equal(villageFrameLimit({frameLimit, ambientAnimation: true, cameraMoving: true}), frameLimit);
    assert.equal(villageFrameLimit({frameLimit, ambientAnimation: false, cameraMoving: true}), frameLimit);
    assert.equal(villageFrameLimit({frameLimit, ambientAnimation: true, cameraMoving: false}), frameLimit ? Math.min(frameLimit, 30) : 30);
    assert.equal(villageFrameLimit({frameLimit, ambientAnimation: false, cameraMoving: false}), frameLimit ? Math.min(frameLimit, 120) : 0);
  }
  assert.equal(villageFrameLimit({frameLimit: 24, ambientAnimation: true, cameraMoving: false}), 24, 'a lower player limit always wins');
  assert.equal(villageFrameLimit({frameLimit: Number.NaN, ambientAnimation: false, cameraMoving: true}), 0);
  assert.equal(villageFrameInterval(0), 0); assert.ok(Math.abs(villageFrameInterval(60) - (1000 / 60 - 1)) < 1e-9);
});

test('release diagnostics refresh at most every interval and skip unchanged values', () => {
  let writes = 0; const values: Record<string, string> = {};
  const dataset = new Proxy(values, {set(target, key, value) { writes++; target[key as string] = value; return true; }}) as unknown as DOMStringMap;
  const report = createVillageDiagnosticsReporter({dataset}, 500);
  let due = 0;
  for (let now = 0; now <= 2100; now += 16) { if (report.begin(now)) { due++; report.set('frames', String(Math.floor(now / 1000))); report.wrote(now); } }
  assert.equal(due, 5, `refreshed ${due} times in 2.1 seconds of 60 Hz frames`);
  assert.equal(writes, 3, 'unchanged values are not rewritten'); assert.equal(values.frames, '2');
  values.frames = 'changed elsewhere'; report.set('frames', '2'); assert.equal(values.frames, '2', 'compares with the live attribute');
  const every = createVillageDiagnosticsReporter({dataset}, 0); assert.equal(every.begin(1), true); every.wrote(1); assert.equal(every.begin(1.5), true);
});
