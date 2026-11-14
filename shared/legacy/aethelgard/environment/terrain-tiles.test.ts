import assert from 'node:assert/strict';
import test from 'node:test';
import {partitionAuthoredTerrain, demandTerrainTiles} from './terrain-tiles';

function grid() {
  const positions: number[] = [], indices: number[] = [];
  for (let z = 0; z <= 16; z++) for (let x = 0; x <= 16; x++) positions.push(x * 4, Math.sin(x * .2) + Math.cos(z * .2), z * 4);
  for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
    const a = z * 17 + x, b = a + 1, c = a + 17, d = c + 1; indices.push(a, c, b, b, c, d);
  }
  return {positions: new Float32Array(positions), indices: new Uint32Array(indices), cellMetres: 16};
}

test('authored tiles preserve every source triangle, winding, heights and input buffers', () => {
  const input = grid(), beforeP = input.positions.slice(), beforeI = input.indices.slice();
  const layout = partitionAuthoredTerrain(input), all = layout.tiles.flatMap(t => {
    const tris: string[] = []; for (let i = 0; i < t.indices.length; i += 3) tris.push(Array.from(t.indices.subarray(i, i + 3)).join(':')); return tris;
  });
  const source: string[] = []; for (let i = 0; i < input.indices.length; i += 3) source.push(Array.from(input.indices.subarray(i, i + 3)).join(':'));
  assert.equal(layout.tiles.length, 16); assert.equal(layout.sourceTriangles, 512);
  assert.deepEqual(all.sort(), source.sort()); assert.deepEqual(input.positions, beforeP); assert.deepEqual(input.indices, beforeI);
  assert.deepEqual(partitionAuthoredTerrain(input), layout);
});

test('every cross-page edge is locked on both sides for mixed terrain levels', () => {
  const layout = partitionAuthoredTerrain(grid()), edgeOwners = new Map<string, number[]>();
  layout.tiles.forEach((t, page) => {
    for (let i = 0; i < t.indices.length; i += 3) for (let e = 0; e < 3; e++) {
      const a = t.indices[i + e], b = t.indices[i + (e + 1) % 3], k = [a, b].sort((a, b) => a - b).join(':');
      const owners = edgeOwners.get(k) ?? []; if (!owners.includes(page)) owners.push(page); edgeOwners.set(k, owners);
    }
  });
  let shared = 0;
  for (const [k, owners] of edgeOwners) if (owners.length > 1) {
    shared++; for (const page of owners) for (const vertex of k.split(':').map(Number)) assert.ok(layout.tiles[page].borderVertices.includes(vertex));
  }
  assert.ok(shared > 10);
});

test('measured water and protected gameplay pages retain exact terrain detail', () => {
  const input = grid(), layout = partitionAuthoredTerrain({...input, protectedBounds: [{min: [0, -4, 0], max: [15, 4, 15]}]});
  const demand = demandTerrainTiles(layout, [{position: [2000, 5, 2000], velocity: [0, 0, 0]}]);
  assert.equal(demand.find(t => t.id === '0:0')!.level, 0);
  assert.equal(demand.find(t => t.id === '3:3')!.level, 2);
});

test('teleport, high cameras, movement prediction and both XR eyes select coherent residency', () => {
  const layout = partitionAuthoredTerrain(grid()), policy = {nearMetres: 8, middleMetres: 24, preloadSeconds: 1, retainMultiplier: 1.25};
  const start = demandTerrainTiles(layout, [{position: [0, 3, 0], velocity: [0, 0, 0]}], policy);
  const moved = demandTerrainTiles(layout, [{position: [64, 3, 64], velocity: [0, 0, 0]}], policy);
  assert.equal(start.find(t => t.id === '0:0')!.level, 0); assert.equal(start.find(t => t.id === '3:3')!.level, 2);
  assert.equal(moved.find(t => t.id === '3:3')!.level, 0); assert.equal(moved.length, layout.tiles.length);
  const flight = demandTerrainTiles(layout, [{position: [0, 1000, 0], velocity: [0, 0, 0]}], policy);
  assert.ok(flight.every(t => t.level === 2));
  const eyes = demandTerrainTiles(layout, [{position: [0, 3, 0], velocity: [0, 0, 0]}, {position: [64, 3, 64], velocity: [0, 0, 0]}], policy);
  assert.equal(eyes.find(t => t.id === '0:0')!.level, 0); assert.equal(eyes.find(t => t.id === '3:3')!.level, 0);
  const preload = demandTerrainTiles(layout, [{position: [0, 3, 0], velocity: [64, 0, 64]}], policy);
  assert.equal(preload.find(t => t.id === '0:0')!.level, 0); assert.equal(preload.find(t => t.id === '3:3')!.level, 0);
});

test('invalid terrain and unbounded tile domains fail without silently altering source geography', () => {
  const input = grid(); assert.throws(() => partitionAuthoredTerrain({...input, cellMetres: 0}));
  assert.throws(() => partitionAuthoredTerrain({...input, indices: new Uint32Array([0, 1, 9999])}));
  assert.throws(() => partitionAuthoredTerrain({...input, positions: new Float32Array([0, 0, 0, 100000, 0, 100000, 4, 0, 4]), indices: new Uint32Array([0, 1, 2])}), /budget/);
  assert.throws(() => demandTerrainTiles(partitionAuthoredTerrain(input), []));
});
