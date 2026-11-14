import test from 'node:test';
import assert from 'node:assert/strict';
import { integratedGraphics, nextBattlefieldScale } from './battlefield-graphics';
test('auto chooses conservative features for integrated or software graphics', () => {
  for (const name of ['Intel UHD 630', 'ANGLE (Intel Iris Xe)', 'AMD Radeon(TM) Graphics', 'SwiftShader']) assert.equal(integratedGraphics(name), true);
  for (const name of ['NVIDIA Quadro T1000', 'NVIDIA RTX 4060', 'AMD Radeon RX 6800']) assert.equal(integratedGraphics(name), false);
});
test('dynamic resolution has hysteresis and respects a manually selected upper bound', () => {
  assert.equal(nextBattlefieldScale(1, 30), .85);
  assert.equal(nextBattlefieldScale(.5, 20), .5);
  assert.equal(nextBattlefieldScale(.75, 50), .75);
  assert.equal(nextBattlefieldScale(.9, 60, .9), .9);
  assert.equal(nextBattlefieldScale(.5, 60), .54);
  assert.equal(nextBattlefieldScale(.8, NaN), .8);
});
test('medium on integrated graphics adapts no lower than its floor, and the floor never exceeds the chosen scale', () => {
  assert.equal(nextBattlefieldScale(.75, 20, .9, .7), .7);
  assert.equal(nextBattlefieldScale(.7, 20, .9, .7), .7);
  assert.equal(nextBattlefieldScale(.6, 20, .6, .7), .6);
  assert.equal(nextBattlefieldScale(.7, 60, .9, .7), .7 * 1.08);
});
