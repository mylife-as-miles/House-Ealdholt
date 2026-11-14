import assert from 'node:assert/strict';
import test from 'node:test';
import { controllerDevice, promptLabel } from './input-prompts';
import { DEFAULT_BINDINGS } from './settings-types';

test('keyboard prompts reflect remapped controls and the working reset shortcut', () => {
  assert.equal(promptLabel('select', 'keyboard', DEFAULT_BINDINGS), 'Enter');
  assert.equal(promptLabel('back', 'keyboard', DEFAULT_BINDINGS), 'Esc');
  assert.equal(promptLabel('previousTab', 'keyboard', { ...DEFAULT_BINDINGS, previousTab: 'KeyZ' }), 'Z');
  assert.equal(promptLabel('reset', 'keyboard', DEFAULT_BINDINGS), 'F9');
});

test('standard physical buttons use each detected controller family labels', () => {
  for (const [id, device, select, back, shoulder] of [
    ['Xbox Wireless Controller', 'xbox', 'A', 'B', 'LB'],
    ['DualSense (Vendor: 054c)', 'playstation', '×', '○', 'L1'],
    ['Nintendo Switch Pro Controller', 'nintendo', 'B', 'A', 'L'],
  ] as const) {
    assert.equal(controllerDevice(id), device);
    assert.equal(promptLabel('select', device, DEFAULT_BINDINGS), select);
    assert.equal(promptLabel('back', device, DEFAULT_BINDINGS), back);
    assert.equal(promptLabel('previousTab', device, DEFAULT_BINDINGS), shoulder);
  }
});
