import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { Box3, BufferGeometry, Group, Mesh, MeshStandardMaterial, PlaneGeometry } from 'three';
import { createEaldholtRiverValley } from './river-valley';
import { createEaldholtDistantCoastPreview } from './distant-coast-preview';
import { createEaldholtWoodlandPlacements, createEaldholtWoodlandSupportIndex } from '../../../../shared/legacy/aethelgard/environment/river-woodland';
const fixture = () => {
  const root = new Group(), geometry = new PlaneGeometry(150, 150, 12, 12); geometry.rotateX(-Math.PI / 2);
  const material = new MeshStandardMaterial(), source = new Mesh(geometry, material); source.name = 'LandscapeComponent_0'; source.position.set(25, 2, 25); root.add(source);
  const valley = createEaldholtRiverValley(root, undefined, { profile: 'desktop' }); root.add(valley.object); return { root, geometry, material, valley };
};
const snapshot = (geometry: BufferGeometry) => ({ index: Array.from(geometry.index!.array), attributes: Object.fromEntries(Object.entries(geometry.attributes).map(([name, attribute]) => [name, Array.from(attribute.array)])) });
const bytes = (geometry: BufferGeometry) => {
  const arrays = new Set<ArrayBufferView>();
  for (const attribute of Object.values(geometry.attributes)) if ('array' in attribute) arrays.add(attribute.array);
  if (geometry.index) arrays.add(geometry.index.array);
  return [...arrays].reduce((sum, array) => sum + array.byteLength, 0);
};
const meshes = (object: Group | ReturnType<typeof createEaldholtDistantCoastPreview>['object']) => object.children.filter(value => value instanceof Mesh) as Mesh[];
const edgeKey = (a: number[], b: number[]) => [a.join(':'), b.join(':')].sort().join('|');
function boundary(geometry: BufferGeometry) {
  const position = geometry.getAttribute('position'), index = geometry.index!, edges = new Map<string, { count: number; a: number[]; b: number[] }>();
  for (let i = 0; i < index.count; i += 3) for (let e = 0; e < 3; e++) {
    const a = index.getX(i + e), b = index.getX(i + (e + 1) % 3), pa = [position.getX(a), position.getY(a), position.getZ(a)], pb = [position.getX(b), position.getY(b), position.getZ(b)], key = edgeKey(pa, pb);
    const previous = edges.get(key); if (previous) previous.count++; else edges.set(key, { count: 1, a: pa, b: pb });
  }
  assert.ok([...edges.values()].every(edge => edge.count <= 2), 'no nonmanifold owned edge'); return [...edges.values()].filter(edge => edge.count === 1);
}
function copiedVertices(source: BufferGeometry, owned: BufferGeometry, points: number[][]) {
  const at = (geometry: BufferGeometry) => {
    const position = geometry.getAttribute('position'), result = new Map<string, number[]>();
    for (let i = 0; i < position.count; i++) { const key = [position.getX(i), position.getY(i), position.getZ(i)].join(':'), found = result.get(key); if (found) found.push(i); else result.set(key, [i]); }
    return result;
  };
  const original = at(source), added = at(owned), names = Object.keys(source.attributes);
  const contract = (geometry: BufferGeometry, id: number) => names.flatMap(name => { const attribute = geometry.getAttribute(name); return Array.from(attribute.array.slice(id * attribute.itemSize, (id + 1) * attribute.itemSize)); });
  for (const key of new Set(points.map(point => point.join(':')))) {
    const expected = original.get(key)!;
    assert.ok(added.get(key)?.some(id => expected.some(sourceId => contract(owned, id).every((value, i) => value === contract(source, sourceId)[i]))), `copied seam preserves every source attribute: ${key}`);
  }
}

/** Signed transverse distance to the actual paired water edges, independent of
 * the land tessellation. Negative values are inside the water footprint. */
function bankDistance(source: Mesh[]) {
  const sections = (mesh: Mesh, axis: 0 | 2) => {
    const p = mesh.geometry.getAttribute('position'), result: number[][][] = [];
    for (let i = 0; i < p.count; i += 2) result.push([[p.getX(i), p.getZ(i)], [p.getX(i + 1), p.getZ(i + 1)]]);
    return result.sort((a, b) => a[0][axis === 0 ? 0 : 1] - b[0][axis === 0 ? 0 : 1]);
  };
  const river = sections(source[1], 0), sea = sections(source[2], 2);
  return (x: number, z: number) => {
    let distance = Infinity;
    for (let i = 1; i < river.length; i++) {
      const a = river[i - 1], b = river[i];
      if (x < a[0][0] || x > b[0][0]) continue;
      const t = (x - a[0][0]) / (b[0][0] - a[0][0]);
      distance = Math.max(a[0][1] + t * (b[0][1] - a[0][1]) - z, z - a[1][1] - t * (b[1][1] - a[1][1])); break;
    }
    for (let i = 1; i < sea.length; i++) {
      const a = sea[i - 1][1], b = sea[i][1];
      if (z < a[1] || z > b[1]) continue;
      distance = Math.min(distance, x - a[0] - (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1])); break;
    }
    return distance;
  };
}
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

test('Desktop diagnostic borrows materials, preserves input bytes and exposes its actual far geometry bounds', () => {
  const f = fixture(), originalMeshes = meshes(f.valley.object), originalGeometry = originalMeshes.map(mesh => mesh.geometry), originals = originalGeometry.map(snapshot);
  let borrowedDisposals = 0; for (const mesh of originalMeshes) { mesh.geometry.addEventListener('dispose', () => borrowedDisposals++); if (!Array.isArray(mesh.material)) mesh.material.addEventListener('dispose', () => borrowedDisposals++); }
  const handle = createEaldholtDistantCoastPreview(f.valley.object), owned = meshes(handle.object);
  assert.equal(handle.object.parent, null); assert.equal(handle.drawCalls, 2); assert.ok(handle.triangles >= 2000 && handle.triangles <= 6000); assert.ok(handle.bufferBytes <= 512 * 1024);
  assert.equal(owned[0].material, originalMeshes[0].material); assert.equal(owned[1].material, originalMeshes[2].material);
  assert.ok(handle.bounds.min[0] < -1000 && handle.bounds.min[2] < -1000 && handle.bounds.max[0] > 1000 && handle.bounds.max[2] > 1000);
  assert.deepEqual(originalGeometry.map(snapshot), originals, 'all original generated buffers stay untouched while its clone is installed');
  assert.notEqual(originalMeshes[0].geometry, originalGeometry[0]);
  assert.equal(handle.bufferBytes, owned.reduce((sum, mesh) => sum + bytes(mesh.geometry), 0) + bytes(originalMeshes[0].geometry));
  const bounds = new Box3().setFromObject(handle.object); assert.deepEqual(bounds.min.toArray(), handle.bounds.min); assert.deepEqual(bounds.max.toArray(), handle.bounds.max);
  for (const mesh of owned) {
    const g = mesh.geometry, positions = g.getAttribute('position'), normals = g.getAttribute('normal');
    assert.equal(mesh.userData.iwsdkPreviewBounds, undefined); assert.equal(mesh.castShadow, false); assert.ok(g.boundingSphere!.radius > 600);
    for (let i = 0; i < positions.count; i++) { assert.ok([positions.getX(i), positions.getY(i), positions.getZ(i)].every(Number.isFinite)); assert.ok(Math.abs(Math.hypot(normals.getX(i), normals.getY(i), normals.getZ(i)) - 1) < .00001); }
    for (const name of ['normal', 'color', 'uv', 'uv1', 'uv2', 'uv3']) assert.equal(g.getAttribute(name).count, positions.count);
  }
  let ownedDisposals = 0; for (const geometry of [...owned.map(mesh => mesh.geometry), originalMeshes[0].geometry]) geometry.addEventListener('dispose', () => ownedDisposals++);
  f.valley.object.add(handle.object); handle.dispose(); handle.dispose(); assert.equal(handle.object.parent, null); assert.equal(ownedDisposals, 3); assert.equal(borrowedDisposals, 0);
  assert.deepEqual(originalMeshes.map(mesh => mesh.geometry), originalGeometry, 'dispose restores the borrowed generated geometry');
  f.valley.dispose(); f.geometry.dispose(); f.material.dispose();
});

test('all three formerly open sea edges and the inland river seam join actual source edges', () => {
  const f = fixture(), source = meshes(f.valley.object), handle = createEaldholtDistantCoastPreview(f.valley.object), owned = meshes(handle.object);
  const sourceSea = boundary(source[2].geometry), xs = source[2].geometry.getAttribute('position'), minX = Math.min(...Array.from({ length: xs.count }, (_, i) => xs.getX(i)));
  const sourceSeaZ = Array.from({ length: xs.count }, (_, i) => xs.getZ(i)), minZ = Math.min(...sourceSeaZ), maxZ = Math.max(...sourceSeaZ);
  const addedWater = new Set(boundary(owned[1].geometry).map(edge => edgeKey(edge.a, edge.b)));
  const expected = sourceSea.filter(edge => edge.a[0] === minX && edge.b[0] === minX || edge.a[2] === minZ && edge.b[2] === minZ || edge.a[2] === maxZ && edge.b[2] === maxZ);
  for (const edge of expected) assert.ok(addedWater.has(edgeKey(edge.a, edge.b)), 'an actual source sea edge must be copied exactly');
  copiedVertices(source[2].geometry, owned[1].geometry, expected.flatMap(edge => [edge.a, edge.b]));
  const riverEdges = boundary(source[1].geometry), endX = Math.max(...riverEdges.flatMap(edge => [edge.a[0], edge.b[0]])), end = riverEdges.find(edge => edge.a[0] === endX && edge.b[0] === endX)!;
  assert.ok(addedWater.has(edgeKey(end.a, end.b))); assert.equal(handle.joins.riverSegments, 1);
  copiedVertices(source[1].geometry, owned[1].geometry, [end.a, end.b]);
  const shore = owned[1].geometry.getAttribute('ealdholtWaterHalfWidth'); assert.ok(Array.from(shore.array).some(value => value === -1)); assert.ok(Array.from(shore.array).some(value => value > 0));
  handle.dispose(); f.valley.dispose(); f.geometry.dispose(); f.material.dispose();
});

test('mainland seams preserve the real north/east/south boundary and never fill the source village', () => {
  const f = fixture(), source = meshes(f.valley.object), handle = createEaldholtDistantCoastPreview(f.valley.object), owned = meshes(handle.object);
  const addedLand = new Set(boundary(owned[0].geometry).map(edge => edgeKey(edge.a, edge.b)));
  const position = source[0].geometry.getAttribute('position'), minZ = Math.min(...Array.from({ length: position.count }, (_, i) => position.getZ(i))), maxX = Math.max(...Array.from({ length: position.count }, (_, i) => position.getX(i)));
  let joined = 0; const copied: number[][] = [];
  for (const edge of boundary(source[0].geometry)) {
    // Check all north/east edges and the complete south contour inland of the
    // coast transition. Existing coastline clipping detail is not new mainland.
    const outer = [edge.a, edge.b].every(p => p[2] === minZ) || [edge.a, edge.b].every(p => p[0] === maxX)
      || [edge.a, edge.b].every(p => p[2] >= 169.999 && p[0] >= -50);
    if (!outer) continue;
    assert.ok(addedLand.has(edgeKey(edge.a, edge.b)), `every real outer mainland segment must join without a T-junction: ${edgeKey(edge.a, edge.b)}`); joined++; copied.push(edge.a, edge.b);
  }
  assert.ok(joined > 100); assert.ok(handle.joins.landSegments >= joined);
  copiedVertices(source[0].geometry, owned[0].geometry, copied);
  for (const mesh of owned) {
    const geometry = mesh.geometry, positions = geometry.getAttribute('position'), index = geometry.index!;
    for (let i = 0; i < index.count; i += 3) {
      const ids = [index.getX(i), index.getX(i + 1), index.getX(i + 2)], x = ids.reduce((n, id) => n + positions.getX(id) / 3, 0), z = ids.reduce((n, id) => n + positions.getZ(id) / 3, 0);
      assert.ok(!(x > -50 && x < 100 && z > -50 && z < 100), 'no new geometry may blanket the original village');
    }
  }
  handle.dispose(); f.valley.dispose(); f.geometry.dispose(); f.material.dispose();
});

test('the inland channel continues through a submerged bed, rather than ending against a new land dam', () => {
  const f = fixture(), source = meshes(f.valley.object), handle = createEaldholtDistantCoastPreview(f.valley.object), [land, water] = meshes(handle.object);
  const existing = source[1].geometry.getAttribute('position'), endX = Math.max(...Array.from({ length: existing.count }, (_, i) => existing.getX(i)));
  const positions = water.geometry.getAttribute('position'), half = water.geometry.getAttribute('ealdholtWaterHalfWidth'), rows = new Map<number, number[]>();
  for (let i = 0; i < positions.count; i++) if (positions.getX(i) > endX && half.getX(i) > 0) { const x = positions.getX(i), row = rows.get(x); if (row) row.push(i); else rows.set(x, [i]); }
  assert.equal(rows.size, 8);
  for (const [x, ids] of rows) {
    assert.equal(ids.length, 2); const z = (positions.getZ(ids[0]) + positions.getZ(ids[1])) / 2;
    const p = land.geometry.getAttribute('position'), indices = land.geometry.index!; let height = -Infinity;
    // The near-village vegetation sampler deliberately rejects giant distant
    // triangles. Inspect this bounded diagnostic mesh directly instead.
    for (let i = 0; i < indices.count; i += 3) {
      const a = indices.getX(i), b = indices.getX(i + 1), c = indices.getX(i + 2), dx1 = p.getX(b) - p.getX(a), dz1 = p.getZ(b) - p.getZ(a), dx2 = p.getX(c) - p.getX(a), dz2 = p.getZ(c) - p.getZ(a), determinant = dx1 * dz2 - dx2 * dz1;
      if (Math.abs(determinant) < 1e-9) continue;
      const u = ((x - p.getX(a)) * dz2 - (z - p.getZ(a)) * dx2) / determinant, v = (dx1 * (z - p.getZ(a)) - dz1 * (x - p.getX(a))) / determinant;
      if (u < -.00001 || v < -.00001 || u + v > 1.00001) continue;
      height = Math.max(height, p.getY(a) + u * (p.getY(b) - p.getY(a)) + v * (p.getY(c) - p.getY(a)));
    }
    assert.ok(Number.isFinite(height)); assert.ok(height < positions.getY(ids[0]) - .1, 'water must continue over submerged real geometry');
  }
  handle.dispose(); f.valley.dispose(); f.geometry.dispose(); f.material.dispose();
});

test('owned coast has projecting headlands, recessed coves and separate substantial rolling land masses', () => {
  const f = fixture(), source = meshes(f.valley.object), handle = createEaldholtDistantCoastPreview(f.valley.object), [land, water] = meshes(handle.object);
  const originalSea = source[2].geometry.getAttribute('position'), seaZ = Array.from({ length: originalSea.count }, (_, i) => originalSea.getZ(i)), minZ = Math.min(...seaZ), maxZ = Math.max(...seaZ), level = originalSea.getY(0);
  const landEdges = new Set(boundary(land.geometry).map(edge => edgeKey(edge.a, edge.b)));
  const shores = boundary(water.geometry).filter(edge => landEdges.has(edgeKey(edge.a, edge.b)));
  for (const direction of [-1, 1]) {
    const edges = shores.filter(edge => [edge.a, edge.b].every(point => direction < 0 ? point[2] <= minZ : point[2] >= maxZ));
    assert.ok(edges.length >= 12, 'both owned coastlines have enough real shape samples');
    const points = [...new Map(edges.flatMap(edge => [edge.a, edge.b]).map(point => [point.join(':'), point])).values()].sort((a, b) => direction * (a[2] - b[2]));
    const xs = points.map(point => point[0]), endpoint = xs[0];
    assert.ok(Math.min(...xs) < endpoint - 25 && Math.max(...xs) > endpoint + 25, 'coast has both projecting and recessed ground');
    assert.ok(Math.max(...xs) - Math.min(...xs) > 160, 'large headland silhouettes cannot collapse into a straight band');
    assert.ok(points.every(point => point[1] === level), 'all owned coastal land joins its water at the real sea level');
  }
  const position = land.geometry.getAttribute('position'), normal = land.geometry.getAttribute('normal'), wet = land.geometry.getAttribute('ealdholtShoreWetness');
  const interior = Array.from({ length: position.count }, (_, i) => i).filter(i => (position.getZ(i) < minZ - 200 || position.getZ(i) > maxZ + 200 || position.getX(i) > 450) && wet.getX(i) < .1);
  const heights = interior.map(i => position.getY(i));
  assert.ok(interior.length > 500, 'the geometry budget samples primary relief rather than only distant polygon corners');
  assert.ok(Math.max(...heights) > 65 && Math.max(...heights) < 105, 'substantial rounded land replaces the flat apron without a mountain wall');
  assert.ok(Math.max(...heights) - Math.min(...heights) > 50);
  assert.ok(interior.filter(i => Math.hypot(normal.getX(i), normal.getZ(i)) > .08).length > 150, 'large relief has actual sloping geometry and normals');
  const sourceLand = source[0].geometry.getAttribute('position');
  const landMinZ = Math.min(...Array.from({ length: sourceLand.count }, (_, i) => sourceLand.getZ(i)));
  const landMaxZ = Math.max(...Array.from({ length: sourceLand.count }, (_, i) => sourceLand.getZ(i)));
  const landMaxX = Math.max(...Array.from({ length: sourceLand.count }, (_, i) => sourceLand.getX(i)));
  const local = interior.filter(i => position.getX(i) < landMaxX + 350);
  const northPeak = Math.max(...local.filter(i => position.getZ(i) < landMinZ - 100 && position.getZ(i) > landMinZ - 650).map(i => position.getY(i)));
  const southPeak = Math.max(...local.filter(i => position.getZ(i) > landMaxZ + 100 && position.getZ(i) < landMaxZ + 650).map(i => position.getY(i)));
  assert.ok(northPeak > 70 && southPeak > 45 && northPeak - southPeak > 10, 'nearer north/south land masses have different heights, not a uniform surrounding ridge');
  assert.ok(local.filter(i => position.getY(i) > 35).length > 100, 'primary raised land remains near the original envelope, rather than only at the far cap');
  const repeated = createEaldholtDistantCoastPreview(f.valley.object);
  assert.deepEqual(meshes(repeated.object).map(mesh => snapshot(mesh.geometry)), [land, water].map(mesh => snapshot(mesh.geometry)), 'owned geometry is deterministic');
  repeated.dispose(); handle.dispose(); f.valley.dispose(); f.geometry.dispose(); f.material.dispose();
});

test('the bank clone preserves contacts and topology while shallow relief stays inside the exposed shore corridor', () => {
  const f = fixture(), source = meshes(f.valley.object), original = source[0].geometry, before = snapshot(original);
  const protectedPoints = new Set(boundary(original).flatMap(edge => [edge.a, edge.b]).map(point => point.join(':')));
  const p = original.getAttribute('position'), wet = original.getAttribute('ealdholtShoreWetness');
  const waterEdges = source.slice(1).flatMap(mesh => boundary(mesh.geometry));
  const nearWater = (x: number, z: number) => waterEdges.some(({ a, b }) => {
    const dx = b[0] - a[0], dz = b[2] - a[2], length = dx * dx + dz * dz;
    const t = length ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[2]) * dz) / length)) : 0;
    return Math.hypot(x - a[0] - t * dx, z - a[2] - t * dz) <= .499;
  });
  const level = Math.max(...source.slice(1).flatMap(mesh => {
    const position = mesh.geometry.getAttribute('position'); return Array.from({ length: position.count }, (_, i) => position.getY(i));
  }));
  const handle = createEaldholtDistantCoastPreview(f.valley.object), clone = source[0].geometry;
  assert.notEqual(clone, original);
  const extraTriangles = (clone.index!.count - original.index!.count) / 3;
  assert.ok(extraTriangles > 500 && extraTriangles <= 1800);
  assert.deepEqual(snapshot(original), before, 'the borrowed buffers themselves remain immutable');
  const q = clone.getAttribute('position'), normal = clone.getAttribute('normal'), colour = clone.getAttribute('color');
  let protectedCount = 0, moved = 0, recoloured = 0, maxRaise = 0;
  const ratios: number[] = [];
  for (let i = 0; i < p.count; i++) {
    assert.equal(q.getX(i), p.getX(i)); assert.equal(q.getZ(i), p.getZ(i), 'the XZ footprint cannot overlap the village or water');
    const raise = q.getY(i) - p.getY(i); assert.ok(raise >= 0 && raise <= 2.6); maxRaise = Math.max(maxRaise, raise);
    if (raise > .00001) moved++;
    const fixed = protectedPoints.has([p.getX(i), p.getY(i), p.getZ(i)].join(':')) || nearWater(p.getX(i), p.getZ(i)) || wet.getX(i) >= .99;
    if (fixed) {
      protectedCount++;
      for (const [name, expected] of Object.entries(original.attributes)) {
        const actual = clone.getAttribute(name);
        for (let c = 0; c < expected.itemSize; c++) assert.equal(actual.getComponent(i, c), expected.getComponent(i, c), `exact protected ${name} at vertex ${i}`);
      }
    }
    const old = original.getAttribute('color');
    if (colour.getX(i) !== old.getX(i) || colour.getY(i) !== old.getY(i) || colour.getZ(i) !== old.getZ(i)) { recoloured++; ratios.push(colour.getY(i) / colour.getX(i)); }
    assert.ok([q.getY(i), colour.getX(i), colour.getY(i), colour.getZ(i), normal.getX(i), normal.getY(i), normal.getZ(i)].every(Number.isFinite));
    assert.ok(normal.getY(i) > 0 && Math.abs(Math.hypot(normal.getX(i), normal.getY(i), normal.getZ(i)) - 1) < .0001);
  }
  assert.ok(protectedCount > 100 && moved > 100 && recoloured > 300);
  assert.ok(maxRaise > .5, 'the accepted broad R4 interior relief remains present');
  assert.ok(Math.max(...ratios) - Math.min(...ratios) > .35, 'dry interior contains clustered earth and vegetation transitions');
  for (const name of ['uv', 'uv1', 'uv2', 'uv3']) assert.deepEqual(Array.from(clone.getAttribute(name).array).slice(0, before.attributes[name].length), before.attributes[name]);
  assert.deepEqual(boundary(clone).map(edge => edgeKey(edge.a, edge.b)).sort(), boundary(original).map(edge => edgeKey(edge.a, edge.b)).sort(), 'no new boundary edges, holes or T-junctions');
  assert.ok(bytes(clone) - bytes(original) <= 54000);
  const actualFaces = new Set(Array.from({ length: clone.index!.count / 3 }, (_, i) => Array.from(clone.index!.array.slice(i * 3, i * 3 + 3)).join(':')));
  for (let i = 0; i < original.index!.count; i += 3) {
    const ids = [original.index!.getX(i), original.index!.getX(i + 1), original.index!.getX(i + 2)];
    if (ids.every(id => wet.getX(id) >= .8)) assert.ok(actualFaces.has(ids.join(':')), 'contact faces retain exact indices');
  }
  const area = (geometry: BufferGeometry) => {
    const p = geometry.getAttribute('position'), index = geometry.index!; let sum = 0;
    for (let i = 0; i < index.count; i += 3) {
      const a = index.getX(i), b = index.getX(i + 1), c = index.getX(i + 2);
      const up = (p.getZ(b) - p.getZ(a)) * (p.getX(c) - p.getX(a)) - (p.getX(b) - p.getX(a)) * (p.getZ(c) - p.getZ(a));
      assert.ok(up > 0, 'every actual face is finite and upward'); sum += up / 2;
    }
    return sum;
  };
  assert.ok(Math.abs(area(clone) - area(original)) < .0001, 'the original outside-only footprint has neither gaps nor overlapping added coverage');
  const finalSupport = createEaldholtWoodlandSupportIndex([{ positions: q.array, indices: clone.index!.array }]);
  const oldSupport = createEaldholtWoodlandSupportIndex([{ positions: q.array.slice(0, p.count * 3), indices: original.index!.array }]);
  const distance = bankDistance(source);
  let raisedSupports = 0, gentleSupports = 0, bankRaise = 0;
  for (let i = p.count; i < q.count; i++) {
    const x = q.getX(i), z = q.getZ(i), support = finalSupport.sample(x, z), previous = oldSupport.sample(x, z);
    assert.ok(support && previous, 'all new transverse samples have actual old and final land support');
    assert.ok(Math.abs(support.height - q.getY(i)) < .0001, 'woodland and margin samplers see the installed final bank');
    const d = distance(x, z), raise = support.height - previous.height;
    if (d < .5 - .0001 || d > 4 + .0001) assert.ok(Math.abs(raise) < .0001, 'outside the corridor, subdivisions interpolate the unchanged R4 faces');
    // Original corridor vertices can also be raised, so their old coarse
    // interpolation can lie above a newly refined point. Both are bounded.
    else { assert.ok(Math.abs(raise) < .461); if (raise > .05) raisedSupports++; bankRaise = Math.max(bankRaise, raise); }
    if (support.slope < 1) gentleSupports++;
    const uv = clone.getAttribute('uv'), wetness = clone.getAttribute('ealdholtShoreWetness').getX(i);
    assert.ok(Math.abs(uv.getX(i) - x / 2) < .00001 && Math.abs(uv.getY(i) + z / 2) < .00001);
    assert.ok(Number.isFinite(support.height) && normal.getY(i) > 0 && wetness >= 0 && wetness <= 1);
  }
  assert.ok(raisedSupports > 50 && bankRaise > .2 && gentleSupports > (q.count - p.count) * .9, 'the narrow bank gains shallow supported rolls');
  assert.equal(handle.object.userData.crownfallDistantCoastPreview.foregroundClone.drawCallsAdded, 0);
  assert.equal(handle.object.userData.crownfallDistantCoastPreview.foregroundClone.trianglesAdded, extraTriangles);
  handle.dispose(); assert.equal(source[0].geometry, original);
  f.valley.dispose(); f.geometry.dispose(); f.material.dispose();
});

test('dry land attributes and woodland placement preserve the accepted R4 checkpoint', () => {
  const f = fixture(), source = meshes(f.valley.object), originalCount = source[0].geometry.getAttribute('position').count;
  const distance = bankDistance(source), handle = createEaldholtDistantCoastPreview(f.valley.object), clone = source[0].geometry;
  const p = clone.getAttribute('position'), outside: number[][] = [];
  for (let i = 0; i < originalCount; i++) {
    const d = distance(p.getX(i), p.getZ(i)); if (d >= .5 && d <= 4) continue;
    outside.push(Object.values(clone.attributes).flatMap(attribute => Array.from(attribute.array.slice(i * attribute.itemSize, (i + 1) * attribute.itemSize))));
  }
  // First generated from the e85a400 fixture (1615 dry vertices, 88 trees).
  // Regenerated after two intended checkpoints moved the fixture: 44afdda
  // refines the inlet bank along distance contours (1940 -> 3752 land vertices),
  // and 55b9843/330f43a spread and split the woodland placement streams.
  // All attributes are checked, including woodland normals.
  assert.equal(outside.length, 3109);
  assert.equal(digest(outside), 'f49b1cf9ac7fda12642a548c08b0d82dd4c9165f575863af58592348343233b2');
  const surface = (geometry: BufferGeometry) => ({ positions: geometry.getAttribute('position').array, indices: geometry.index!.array });
  const placements = createEaldholtWoodlandPlacements({ land: surface(clone), water: surface(source[1].geometry), extraWater: [surface(source[2].geometry)],
    village: { minX: -50, maxX: 100, minZ: -50, maxZ: 100 }, canopyRadius: 4, maximumTrees: 100, profile: 'desktop' });
  assert.equal(placements.length, 100);
  assert.equal(digest(placements.map(placement => Object.values(placement).map(value => Math.round(value * 1e4)))),
    '7ad1f04f80061f95c13ea013415a1b160207f63b1f2df5c2d494a366cee15300', 'the same roots, scale, yaw and accepted crowns as the current checkpoint');
  handle.dispose(); f.valley.dispose(); f.geometry.dispose(); f.material.dispose();
});

test('foreground ownership is non-cumulative and disposal never overwrites another geometry owner', () => {
  const f = fixture(), source = meshes(f.valley.object)[0], original = source.geometry, before = snapshot(original);
  const first = createEaldholtDistantCoastPreview(f.valley.object), firstClone = source.geometry;
  const second = createEaldholtDistantCoastPreview(f.valley.object), secondClone = source.geometry;
  assert.notEqual(secondClone, firstClone); assert.deepEqual(snapshot(secondClone), snapshot(firstClone), 'nested diagnostics always clone the unchanged base');
  first.dispose(); assert.equal(source.geometry, secondClone, 'the first diagnostic cannot overwrite the second owner');
  second.dispose(); assert.equal(source.geometry, original, 'the final owner restores the actual borrowed base');
  const third = createEaldholtDistantCoastPreview(f.valley.object), replacement = original.clone();
  let replacementDisposals = 0; replacement.addEventListener('dispose', () => replacementDisposals++);
  source.geometry = replacement; third.dispose();
  assert.equal(source.geometry, replacement); assert.equal(replacementDisposals, 0);
  assert.deepEqual(snapshot(original), before);
  source.geometry = original; replacement.dispose(); f.valley.dispose(); f.geometry.dispose(); f.material.dispose();
});

test('both supported reach limits keep real geometry within the two-draw diagnostic budget', () => {
  const f = fixture();
  for (const reachMetres of [900, 3000]) {
    const handle = createEaldholtDistantCoastPreview(f.valley.object, { reachMetres });
    assert.equal(handle.drawCalls, 2); assert.ok(handle.triangles >= 2000 && handle.triangles <= 6000); assert.ok(handle.bufferBytes <= 512 * 1024);
    assert.ok(handle.object.userData.crownfallDistantCoastPreview.foregroundClone.extensionBytes < 256 * 1024);
    assert.equal(handle.reachMetres, reachMetres); assert.equal(handle.object.userData.crownfallDistantCoastPreview.georeferenced, false);
    for (const mesh of meshes(handle.object)) boundary(mesh.geometry);
    const bounds = new Box3().setFromObject(handle.object); assert.deepEqual(bounds.min.toArray(), handle.bounds.min); assert.deepEqual(bounds.max.toArray(), handle.bounds.max);
    handle.dispose();
  }
  f.valley.dispose(); f.geometry.dispose(); f.material.dispose();
});

test('Native intake and invalid reach/attributes fail without changing borrowed geometry or disposing it', () => {
  const f = fixture(), source = meshes(f.valley.object), before = source.map(mesh => snapshot(mesh.geometry));
  for (const reachMetres of [0, 650, 899, 3001, NaN, Infinity]) assert.throws(() => createEaldholtDistantCoastPreview(f.valley.object, { reachMetres }), /reach/);
  f.valley.object.userData.crownfallRiverValley.profile = 'quest'; assert.throws(() => createEaldholtDistantCoastPreview(f.valley.object), /Desktop-only/);
  f.valley.object.userData.crownfallRiverValley.profile = 'desktop';
  const attribute = source[2].geometry.getAttribute('ealdholtWaterHalfWidth'); source[2].geometry.deleteAttribute('ealdholtWaterHalfWidth');
  assert.throws(() => createEaldholtDistantCoastPreview(f.valley.object), /vertex contract/); source[2].geometry.setAttribute('ealdholtWaterHalfWidth', attribute);
  assert.deepEqual(source.map(mesh => snapshot(mesh.geometry)), before);
  f.valley.dispose(); f.geometry.dispose(); f.material.dispose();
});
