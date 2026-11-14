import assert from 'node:assert/strict';
import test from 'node:test';
import { localId } from './records';

test('local ids are unique and do not need crypto.randomUUID (plain-http LAN pages, M-14)', () => {
  const crypto = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  try {
    Object.defineProperty(globalThis, 'crypto', { value: {}, configurable: true });
    const ids = new Set(Array.from({ length: 200 }, () => localId('match')));
    assert.equal(ids.size, 200);
    for (const id of ids) assert.match(id, /^match-[a-z0-9]+-[a-z0-9]+-[a-z0-9]+$/);
  } finally {
    if (crypto) Object.defineProperty(globalThis, 'crypto', crypto);
  }
  assert.match(localId('replay'), /^replay-[0-9a-f-]{36}$/);
});
