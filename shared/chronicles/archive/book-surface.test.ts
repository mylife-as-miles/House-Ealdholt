import assert from 'node:assert/strict';
import test from 'node:test';
import { atlasBookParts } from './book';
import { ATLAS_BOOK_MATERIALS } from './book-materials';
import { atlasBookSurfaces } from './book-surface';

test('bevelled book surfaces have finite attributes, outward triangles and padded atlas UVs', () => {
  const surfaces = atlasBookSurfaces(atlasBookParts(.746), 1, .746);
  let triangles = 0;
  for (const surface of surfaces) {
    const { positions: p, normals: n, uvs: uv, indices } = surface;
    triangles += indices.length / 3;
    assert.equal(p.length, n.length); assert.equal(uv.length, p.length / 3 * 2);
    assert.ok(p.every(Number.isFinite) && n.every(Number.isFinite) && uv.every(Number.isFinite));
    const [x, y, w, h] = ATLAS_BOOK_MATERIALS.islands[surface.family], size = ATLAS_BOOK_MATERIALS.size;
    for (let i = 0; i < uv.length; i += 2) {
      assert.ok(uv[i] >= x / size - 1e-6 && uv[i] <= (x + w) / size + 1e-6);
      assert.ok(uv[i + 1] >= 1 - (y + h) / size - 1e-6 && uv[i + 1] <= 1 - y / size + 1e-6);
    }
    for (let i = 0; i < indices.length; i += 3) {
      const a = indices[i] * 3, b = indices[i + 1] * 3, c = indices[i + 2] * 3;
      const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
      const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
      const dot = (uy * vz - uz * vy) * (n[a] + n[b] + n[c])
        + (uz * vx - ux * vz) * (n[a + 1] + n[b + 1] + n[c + 1])
        + (ux * vy - uy * vx) * (n[a + 2] + n[b + 2] + n[c + 2]);
      assert.ok(dot > 0, `${surface.side} ${surface.family}: inverted or collapsed face`);
    }
  }
  assert.equal(surfaces.length, 8); assert.ok(triangles < 8000);
});

test('desktop and table-scale geometry retain the same UVs and proportions', () => {
  const parts = atlasBookParts(.746), desktop = atlasBookSurfaces(parts, 1, .746), quest = atlasBookSurfaces(parts, .95, .746 * .95);
  desktop.forEach((surface, index) => {
    assert.deepEqual(surface.uvs, quest[index].uvs);
    surface.positions.forEach((value, i) => assert.ok(Math.abs(value * .95 - quest[index].positions[i]) < 1e-7));
  });
});
