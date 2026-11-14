import assert from 'node:assert/strict';
import test from 'node:test';
import {BufferAttribute, BufferGeometry} from 'three';
import {staticSourceBounds} from './static-source-bounds';
test('many authored cells share source measurements, own returned boxes and invalidate on source revision', () => {
  const geometry = new BufferGeometry(), positions = new BufferAttribute(new Float32Array([0, 0, 0, 2, 8, 4]), 3); geometry.setAttribute('position', positions);
  let reads = 0; const get = positions.getX.bind(positions); positions.getX = i => {reads++; return get(i);};
  const first = staticSourceBounds(geometry); first.min.set(-99, -99, -99);
  for (let i = 0; i < 1035; i++) assert.equal(staticSourceBounds(geometry).min.x, 0);
  assert.equal(reads, 2); positions.setY(1, 12); positions.needsUpdate = true;
  assert.equal(staticSourceBounds(geometry).max.y, 12); assert.equal(reads, 4);
  geometry.dispose();
});
