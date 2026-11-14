import assert from 'node:assert/strict';
import test from 'node:test';
import {MeshoptSimplifier} from 'meshoptimizer';
import {partitionAuthoredTerrain} from './terrain-tiles';
import {deriveAuthoredTerrainTile} from './terrain-derived-geometry';

test('real simplification preserves cross-tile seams and all retained PBR and shoreline channels', async () => {
  const p: number[] = [], a: number[] = [], ix: number[] = [], n = 32;
  for (let z = 0; z <= n; z++) for (let x = 0; x <= n; x++) {
    p.push(x, .03 * Math.sin(x * .1) * Math.cos(z * .1), z);
    a.push(0, 1, 0, x / n, z / n, x % 2 ? .25 : .75);
  }
  for (let z = 0; z < n; z++) for (let x = 0; x < n; x++) {const v = z * (n + 1) + x; ix.push(v, v + n + 1, v + 1, v + 1, v + n + 1, v + n + 2);}
  const positions = new Float32Array(p), attributes = new Float32Array(a), indices = new Uint32Array(ix), old = positions.slice();
  const channels = [{name: 'normal', size: 3}, {name: 'uv', size: 2}, {name: 'ealdholtShoreWetness', size: 1}], layout = partitionAuthoredTerrain({positions, indices, cellMetres: 16});
  let reduced = 0;
  for (const tile of layout.tiles) {
    const result = await deriveAuthoredTerrainTile({positions, attributes, channels}, tile, 2, MeshoptSimplifier);
    reduced += result.indices.length;
    const vertices = new Set<string>();
    for (let i = 0; i < result.positions.length / 3; i++) {
      const v = Array.from(result.positions.subarray(i * 3, i * 3 + 3)); vertices.add(v.join(':'));
      const source = Math.round(v[2]) * (n + 1) + Math.round(v[0]);
      assert.deepEqual(v, Array.from(positions.subarray(source * 3, source * 3 + 3)));
      let offset = source * 6;
      for (const channel of result.attributes) for (let c = 0; c < channel.size; c++) assert.equal(channel.values[i * channel.size + c], attributes[offset++]);
    }
    for (const id of tile.borderVertices) assert.ok(vertices.has(Array.from(positions.subarray(id * 3, id * 3 + 3)).join(':')));
  }
  assert.ok(reduced < indices.length * .8); assert.deepEqual(positions, old);
  const tile = {...layout.tiles[0], preserveDetail: true};
  const protectedResult = await deriveAuthoredTerrainTile({positions, attributes, channels}, tile, 2, MeshoptSimplifier);
  assert.equal(protectedResult.indices.length, tile.indices.length);
});
