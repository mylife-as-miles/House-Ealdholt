import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { createEaldholtCoastalValleyBuffers } from '../aethelgard/environment/coastal-valley';
import { createEaldholtCoastalWaterShoreAttributes } from '../aethelgard/environment/water-shore-color';
import { ealdholtTriangleShoreDistanceSquared, createEaldholtOuterContinuationBuffers, type EaldholtOuterContinuationInput } from '../aethelgard/environment/outer-continuation';
function fixture(profile: 'desktop' | 'quest') {
  const edge = [[-50, 2], [0, 3], [50, 3], [100, 2]] as const, sourceEnvelope = { minX: -50, maxX: 100, minZ: -50, maxZ: 100 };
  const valley = createEaldholtCoastalValleyBuffers({ ...sourceEnvelope, west: edge, east: edge, north: edge, south: edge }, profile);
  const shore = createEaldholtCoastalWaterShoreAttributes(valley.shape, valley.channel, valley.sea);
  const input: EaldholtOuterContinuationInput = { profile, sourceEnvelope, fullBounds: { min: valley.bounds.min, max: [valley.bounds.max[0], 20, valley.bounds.max[2]] },
    land: { ...valley.land, wetness: valley.landWetness }, channel: valley.channel, sea: { ...valley.sea, ...shore.sea } };
  return { valley, input };
}
for (const profile of ['desktop', 'quest'] as const) test(`${profile}: exact seams, source UVs and physical coast distance without borrowed mutation`, () => {
  const { valley, input } = fixture(profile), before = structuredClone(input), data = createEaldholtOuterContinuationBuffers(input);
  assert.deepEqual(input, before); assert.deepEqual(data, createEaldholtOuterContinuationBuffers(input));
  assert.ok(data.triangles > 320 && data.triangles <= 640); assert.ok(data.bufferBytes < 65536);
  assert.equal(data.landContourRows, data.landform.addedVertices?4:3);
  assert.ok(data.landform.protectedTriangles>0);
  assert.equal(data.southWidth, profile === 'quest' ? 32 * 30 / 70 : 32); assert.equal(data.westWidth, profile === 'quest' ? 20 : 90);
  assert.equal(data.bounds.min[0], Math.fround(input.sea.positions[0] - data.westWidth));
  for (const [kind, original] of [['land', input.land], ['sea', input.sea]] as const) {
    const output = data[kind]; let seams = 0, outer = 0;
    output.sourceVertex.forEach((id, at) => {
      assert.ok(output.normals[at * 3 + 1] > 0);
      assert.ok(Math.abs(output.uv[at * 2] - output.positions[at * 3] / 2) < .00005);
      assert.ok(Math.abs(output.uv[at * 2 + 1] + output.positions[at * 3 + 2] / 2) < .00005);
      if (id < 0) { outer++; return; } seams++;
      for (const name of ['positions', 'normals', 'colours'] as const) for (let k = 0; k < 3; k++) assert.equal(output[name][at * 3 + k], original[name][id * 3 + k]);
      for (let k = 0; k < 2; k++) assert.equal(output.uv[at * 2 + k], original.uv[id * 2 + k]);
      if (kind === 'land') assert.equal(data.land.wetness[at], input.land.wetness[id]);
      else { assert.equal(data.sea.across[at], input.sea.across[id]); assert.equal(data.sea.halfWidth[at], input.sea.halfWidth[id]); }
    });
    assert.ok(seams > 20 && outer > 20);
    for (let at = 0; at < output.indices.length; at += 3) {
      const [a, b, c] = Array.from(output.indices.slice(at, at + 3)), p = output.positions;
      assert.ok((p[b * 3 + 2] - p[a * 3 + 2]) * (p[c * 3] - p[a * 3]) - (p[b * 3] - p[a * 3]) * (p[c * 3 + 2] - p[a * 3 + 2]) > 0);
    }
  }
  const oracle = createEaldholtCoastalWaterShoreAttributes({ ...valley.shape, seaMinX: data.bounds.min[0] }, valley.channel, data.sea);
  assert.deepEqual(data.sea.across, oracle.sea.across); assert.deepEqual(data.sea.halfWidth, oracle.sea.halfWidth);
  if (profile === 'quest') for (let i = 0; i < data.land.positions.length; i += 3) assert.ok(data.land.positions[i + 2] <= input.fullBounds.max[2], 'compact dry extension stays in the old Z envelope');
});
for (const profile of ['desktop', 'quest'] as const) test(`${profile}: three welded dry contours have rolling relief and an irregular bounded perimeter`, () => {
  const { input } = fixture(profile), { land, southWidth } = createEaldholtOuterContinuationBuffers(input);
  const columns = new Map<number, number[]>(), edges = new Map<string, number>();
  land.sourceVertex.forEach((_, id) => {
    const x = land.positions[id * 3], column = columns.get(x) ?? [];
    column.push(id); columns.set(x, column);
  });
  let complete = 0, rolling = 0, maximumBend = 0; const depths: number[] = [];
  for (const column of columns.values()) {
    column.sort((a, b) => land.positions[a * 3 + 2] - land.positions[b * 3 + 2]);
    if (column.length < 4) continue;
    assert.ok(column.length===4||column.length===5, 'adjacent strips share contour vertices'); column.splice(4); complete++;
    assert.ok(land.sourceVertex[column[0]] >= 0, 'first row is the exact existing seam');
    const [x, y, z] = Array.from(land.positions.slice(column[0] * 3, column[0] * 3 + 3));
    const depth = land.positions[column[3] * 3 + 2] - z; depths.push(depth);
    assert.ok(depth > 0 && depth <= southWidth + .00005);
    assert.ok(column.slice(1).every(id => land.sourceVertex[id] === -1 && land.wetness[id] === 0));
    for (let row = 1; row < 4; row++) {
      const at = column[row] * 3;
      assert.equal(land.positions[at], x);
      assert.ok(land.positions[at + 2] > land.positions[column[row - 1] * 3 + 2]);
      assert.ok(land.positions[at + 2] > input.sourceEnvelope.maxZ, 'outside-only mainland extension');
      assert.ok(land.positions[at + 1] >= input.fullBounds.min[1] && land.positions[at + 1] <= input.fullBounds.max[1]);
      assert.ok(land.positions[at + 1] > input.sea.positions[1] + .1, 'dry relief does not invent a new waterline');
    }
    const middle = land.positions[column[1] * 3 + 1], end = land.positions[column[3] * 3 + 1];
    if (Math.abs(middle - (y + (end - y) / 3)) > .01) rolling++;
    for (let row = 1; row < 3; row++) maximumBend = Math.max(maximumBend, Math.abs(land.positions[column[row] * 3 + 1] - (y + (end - y) * row / 3)));
  }
  assert.ok(complete > 40 && rolling > 35, 'broad curved profiles replace the flat single-row apron');
  assert.ok(maximumBend > (profile === 'quest' ? 1.8 : 3), 'shallow macro relief has real height, independent of surface colour');
  assert.ok(Math.max(...depths) - Math.min(...depths) > southWidth * .1, 'outer silhouette is not a uniform straight offset');
  for (let at = 0; at < land.indices.length; at += 3) for (let j = 0; j < 3; j++) {
    const a = land.indices[at + j], b = land.indices[at + (j + 1) % 3], key = a < b ? `${a}:${b}` : `${b}:${a}`;
    edges.set(key, (edges.get(key) ?? 0) + 1);
  }
  const boundary = new Map<number, number[]>();
  for (const [key, count] of edges) {
    assert.ok(count <= 2, 'no overlapping or nonmanifold contour edges');
    if (count !== 1) continue;
    const [a, b] = key.split(':').map(Number);
    boundary.set(a, [...(boundary.get(a) ?? []), b]); boundary.set(b, [...(boundary.get(b) ?? []), a]);
  }
  assert.equal(land.sourceVertex.length - edges.size + land.indices.length / 3, 1, 'one connected disk without cracks or holes');
  for (const neighbours of boundary.values()) assert.equal(neighbours.length, 2, 'only the outside perimeter remains open');
  const visited = new Set<number>(), pending = [boundary.keys().next().value!];
  while (pending.length) { const id = pending.pop()!; if (visited.has(id)) continue; visited.add(id); pending.push(...boundary.get(id)!); }
  assert.equal(visited.size, boundary.size, 'all strips share a single outside boundary');
});
for (const profile of ['desktop', 'quest'] as const) test(`${profile}: complete sea buffers remain byte-for-byte identical to the original single-row continuation`, () => {
  const { input } = fixture(profile), { sea } = createEaldholtOuterContinuationBuffers(input), hash = createHash('sha256');
  for (const key of ['positions', 'normals', 'colours', 'uv', 'indices', 'sourceVertex', 'across', 'halfWidth'] as const) {
    const a = sea[key]; hash.update(key); hash.update(new Uint8Array(a.buffer, a.byteOffset, a.byteLength));
  }
  const expected = profile === 'desktop' ? '176a04caa4079bf3e964dcc9acba5e9a0017d98e68e582f8e481e73ed523e67f'
    : '1aadc52e798b76c394b0cc6a2e68b9ad5ab94b87880d14a43af5ebe4c433ea28';
  assert.equal(hash.digest('hex'), expected);
});
for (const profile of ['desktop', 'quest'] as const) test(`${profile}: rolling contours respect a tight, non-float32 height ceiling`, () => {
  const { input: original } = fixture(profile), positions=Float32Array.from(original.land.positions),normals=new Float32Array(positions.length);
  // A flat dry source seam makes the generated rise, rather than an unrelated
  // tall inland vertex, exercise the narrow representable height envelope.
  for(let at=0;at<positions.length;at+=3){positions[at+1]=2;normals[at+1]=1;}
  const input={...original,land:{...original.land,positions,normals}},ceiling=2.037001;
  const fullBounds = { min: input.fullBounds.min, max: [input.fullBounds.max[0], ceiling, input.fullBounds.max[2]] as const };
  const { land } = createEaldholtOuterContinuationBuffers({ ...input, fullBounds }); let highest = -Infinity;
  land.sourceVertex.forEach((source, id) => {
    if (source >= 0) return;
    const [x, y, z] = Array.from(land.positions.slice(id * 3, id * 3 + 3)); highest = Math.max(highest, y);
    assert.ok(y >= fullBounds.min[1] && y <= ceiling, 'float32 rounding stays inside the real height envelope');
    assert.ok(x >= fullBounds.min[0] && x <= fullBounds.max[0]);
    if (profile === 'quest') assert.ok(z >= fullBounds.min[2] && z <= fullBounds.max[2], 'all Native contours stay within the existing complete land footprint');
  });
  assert.ok(highest > ceiling - .0002, 'fixture actually exercises the height clamp');
});
test('unknown projected UVs or wrong sea shore attributes fail before mutation', () => {
  const { input } = fixture('desktop'), uv = Float32Array.from(input.land.uv); uv[0] += .2;
  assert.throws(() => createEaldholtOuterContinuationBuffers({ ...input, land: { ...input.land, uv } }), /source frame/);
  const across = Float32Array.from(input.sea.across); across[0] += 1;
  assert.throws(() => createEaldholtOuterContinuationBuffers({ ...input, sea: { ...input.sea, across } }), /physical coastline/);
});

test('whole-triangle guard catches a shoreline inside a face with distant vertices',()=>{
  assert.equal(ealdholtTriangleShoreDistanceSquared([[-20,-20],[20,-20],[0,30]],[[[0,-2],[0,2]]]),0);
  assert.equal(ealdholtTriangleShoreDistanceSquared([[0,20],[10,20],[0,30]],[[[-20,0],[20,0]]]),400);
});
for(const profile of ['desktop','quest']as const)test(`${profile}: final landform diagnostics and recomputed bounds stay finite and truthful`,()=>{
  const {input}=fixture(profile),data=createEaldholtOuterContinuationBuffers(input),d=data.landform;
  const finite=(value:unknown):void=>{if(typeof value==='number')assert.ok(Number.isFinite(value));else if(value&&typeof value==='object')Object.values(value).forEach(finite);};finite(data.landform);
  assert.ok(d.minimumChangedShoreDistance===null||d.minimumChangedShoreDistance>d.protectedShoreWidth);
  assert.equal(d.projectedAreaAdded>0,d.addedTriangles>0);assert.equal(data.landContourRows,d.addedVertices?4:3);
  assert.equal(d.extraGpuBytes,d.addedVertices*48+d.addedTriangles*6);
  const all=[...Array.from(data.land.positions),...Array.from(data.sea.positions)];for(let k=0;k<3;k++){
    const values=all.filter((_,i)=>i%3===k);assert.equal(data.bounds.min[k],Math.min(...values));assert.equal(data.bounds.max[k],Math.max(...values));
  }
  assert.equal(d.protectedShoreWidth,6,'relief uses its own whole-face corridor');
  assert.equal(d.mode,'relief');assert.ok(d.movedVertices>0&&d.maximumRaise!>.5);assert.equal(d.maximumLower,0,'the broad relief pass adds positive rises');
  if(profile==='desktop')assert.equal(d.addedVertices,0);
  else{assert.ok(d.addedVertices>0&&d.addedTriangles>0,'Native shapes existing apron and retains its bounded continuation');assert.ok(d.maximumExtension<=12);}
});

for(const profile of ['desktop','quest']as const)test(`${profile}: middle mainland rises taper continuously from the exact source join`,()=>{
  const {input:original}=fixture(profile),positions=Float32Array.from(original.land.positions),normals=new Float32Array(positions.length);
  for(let at=0;at<positions.length;at+=3){positions[at+1]=2;normals[at+1]=1;}
  const input={...original,land:{...original.land,positions,normals}},data=createEaldholtOuterContinuationBuffers(input),land=data.land;
  const coastX=Math.max(...Array.from({length:input.sea.positions.length/6},(_,i)=>input.sea.positions[i*6+3])),columns=new Map<number,number[]>();
  land.sourceVertex.forEach((_,id)=>{const x=land.positions[id*3],ids=columns.get(x)??[];ids.push(id);columns.set(x,ids);});
  let centralRises=0;
  for(const[x,ids]of columns){const u=(x-coastX)/(input.fullBounds.max[0]-coastX);if(u<.4||u>.55)continue;
    ids.sort((a,b)=>land.positions[a*3+2]-land.positions[b*3+2]);if(ids.length<4)continue;
    const seam=ids[0],first=ids[1],end=ids.at(-1)!;assert.ok(land.sourceVertex[seam]>=0);assert.equal(land.positions[seam*3+1],2);
    const rise=land.positions[end*3+1]-2,firstRise=land.positions[first*3+1]-2;
    assert.ok(rise>.5,'the middle mainland is a positive broad rise, not the old lowered swale');
    assert.ok(firstRise>=0&&firstRise<rise*.8,'the first dry ring joins gradually instead of acquiring a full-height hinge');centralRises++;
  }
  assert.ok(centralRises>=5,'the rise spans multiple connected columns');
  assert.ok(data.triangles<=640&&data.bufferBytes<=65536,'the physical correction adds no draw or unbounded terrain cost');
});
