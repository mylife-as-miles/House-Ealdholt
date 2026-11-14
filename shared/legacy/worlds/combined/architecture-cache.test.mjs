// CPU-only regression. Run from the repository root:
// node --loader ./shared/legacy/worlds/golden-temple/cpu-loader.mjs --test shared/legacy/worlds/combined/architecture-cache.test.mjs
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import * as THREE from 'crownfall-world-three';
import { createArchitectureKit } from './architecture.js';
import { buildHouse } from '../athenaion/vendor/city/buildings.js';
import { GeoBuilder } from '../athenaion/vendor/city/geobuilder.js';
import { RNG } from '../athenaion/vendor/core/rng.js';
import { terracottaMaterial } from '../athenaion/vendor/materials/terracotta.js';

function geometrySignature(group) {
  const hash = createHash('sha256');
  group.traverse(object => {
    if (!object.isMesh) return;
    for (const [name, attribute] of Object.entries(object.geometry.attributes).sort(([a], [b]) => a.localeCompare(b))) {
      hash.update(`${name}:${attribute.itemSize}:${attribute.count}`);
      hash.update(new Uint8Array(attribute.array.buffer, attribute.array.byteOffset, attribute.array.byteLength));
    }
    if (object.geometry.index) {
      const array = object.geometry.index.array;
      hash.update(new Uint8Array(array.buffer, array.byteOffset, array.byteLength));
    }
  });
  return hash.digest('hex');
}

function disposeCallerGeometry(group) {
  const geometries = new Set();
  group.traverse(object => { if (object.geometry) geometries.add(object.geometry); });
  for (const geometry of geometries) geometry.dispose();
}

test('100 different cursor IDs per tool share a bounded source prototype and match the committed asset', () => {
  const kit = createArchitectureKit({ THREE, profile: 'quest' });
  const tools = [
    { kind: 'cottage', width: 8, depth: 7 },
    { kind: 'storehouse', width: 10, depth: 8 },
    { kind: 'pavilion', width: 4, depth: 4, height: 5 },
  ];
  try {
    for (const [toolIndex, tool] of tools.entries()) {
      const preview = kit.build({ ...tool, id: 'preview' });
      const assetId = preview.userData.sourceAssetId;
      const signature = geometrySignature(preview);
      const prototypeCount = kit.stats().prototypes;
      const materialCount = kit.stats().ownedMaterials;
      assert.equal(prototypeCount, toolIndex + 1);
      const material = preview.children.find(object => object.isMesh).material;
      try {
        for (let cursor = 0; cursor < 100; cursor++) {
          // This is the renderer's cursor-dependent ID shape, including negative coordinates.
          const group = kit.build({ ...tool, id: `estate-${tool.kind}-${cursor - 50}-${cursor * 2 - 100}` });
          try {
            assert.equal(group.userData.sourceAssetId, assetId);
            assert.equal(geometrySignature(group), signature);
            assert.equal(kit.stats().prototypes, prototypeCount, 'moving the cursor does not allocate another source prototype');
            assert.equal(kit.stats().ownedMaterials, materialCount, 'moving the cursor does not allocate cached materials');
            const mesh = group.children.find(object => object.isMesh);
            assert.equal(mesh.material, material, 'the kit retains its cached material ownership');
            assert.notEqual(mesh.geometry, preview.children.find(object => object.isMesh).geometry, 'each delivered geometry remains caller owned');
          } finally { disposeCallerGeometry(group); }
        }
        const committed = kit.build({ ...tool, id: `estate-${toolIndex + 1}` });
        try {
          assert.equal(committed.userData.sourceAssetId, assetId);
          assert.equal(geometrySignature(committed), signature);
          assert.equal(kit.stats().prototypes, prototypeCount);
          assert.equal(kit.stats().ownedMaterials, materialCount);
        } finally { disposeCallerGeometry(committed); }
      } finally { disposeCallerGeometry(preview); }
    }
    assert.equal(kit.stats().prototypes, 3, '300 cursor positions retain only the three requested archetypes');
  } finally { kit.dispose(); }
});

test('the optional estate style leaves the pinned source city geometry byte identical when absent', () => {
  // Recorded before introducing the default-off Crownfall hook. These exercise
  // one-storey, compact and larger original source lots, including encoded channels.
  const fixtures = [
    { w: 8, d: 7, seed: 23, hash: '44d50b3f8dbcafdab2ce79b41b1479a305fd7a57ebd944fcd432efa2efb0cb4f' },
    { w: 6, d: 8, seed: 139, hash: '7f3e2a72f2f029c97812b415ee40703c083a3a0918980067587d0bb1f25fc110' },
    { w: 11, d: 8, seed: 29, hash: '89f9f888f572538e4c1f2aa41587be802706aa58ff17c9d862a9bb8348160d5e' },
  ];
  for (const fixture of fixtures) {
    const B = { plaster: new GeoBuilder({ aFac: 4, aSty: 4 }), roof: new GeoBuilder({ aRoof: 4 }), stone: new GeoBuilder({ aSt: 4 }), wood: new GeoBuilder({ aW: 4 }), gold: new GeoBuilder({}) };
    const context = { B, ground: () => 0, gardens: [], slots: { urn: [], tree: [] }, district: () => ({ centre: .1, harbour: .1, edge: .9 }) };
    buildHouse(context, { x: 0, z: 0, w: fixture.w, d: fixture.d, rot: 0, seed: .314159, row: false }, new RNG(fixture.seed));
    const hash = createHash('sha256');
    for (const [part, builder] of Object.entries(B)) {
      const geometry = builder.toGeometry(); hash.update(part);
      for (const [name, attribute] of Object.entries(geometry.attributes).sort(([a], [b]) => a.localeCompare(b))) {
        hash.update(name);
        hash.update(new Uint8Array(attribute.array.buffer, attribute.array.byteOffset, attribute.array.byteLength));
      }
      if (geometry.index) {
        const array = geometry.index.array;
        hash.update(new Uint8Array(array.buffer, array.byteOffset, array.byteLength));
      }
      geometry.dispose();
    }
    assert.equal(hash.digest('hex'), fixture.hash, `${fixture.w} by ${fixture.d} original source lot`);
  }
});

test('estate source houses retain broad protected footprints, steep real roofs and encoded facade detail', () => {
  const kit = createArchitectureKit({ THREE, profile: 'quest' });
  try {
    for (const spec of [
      { id: 'cottage-12', kind: 'cottage', width: 6, depth: 7, height: 8.5 },
      { id: 'cottage-01', kind: 'cottage', width: 7, depth: 8, height: 8.7 },
      { id: 'preview', kind: 'cottage', width: 8, depth: 7 },
      { id: 'preview', kind: 'storehouse', width: 10, depth: 8 },
      { id: 'herald-lodge', kind: 'herald', width: 10, depth: 7, height: 9.2 },
      ...Array.from({ length: 8 }, (_, i) => ({ id: `cottage-${i + 13}`, kind: 'cottage', width: 6, depth: 6, height: 8.5 })),
    ]) {
      const group = kit.build(spec);
      try {
        assert.ok(group.userData.sourceFit.wallWidthCoverage >= .75);
        assert.ok(group.userData.sourceFit.wallDepthCoverage >= .7);
        const box = new THREE.Box3().setFromObject(group);
        assert.ok(Math.max(Math.abs(box.min.x), Math.abs(box.max.x)) <= spec.width / 2 + 1e-5);
        assert.ok(Math.max(Math.abs(box.min.z), Math.abs(box.max.z)) <= spec.depth / 2 + 1e-5);
        let tiledVertices = 0, facadeVertices = 0, quoinVertices = 0;
        group.traverse(object => {
          if (!object.isMesh) return;
          const geometry = object.geometry, roof = geometry.attributes.aRoof, facade = geometry.attributes.aSty;
          if (roof) for (let i = 0; i < roof.count; i++) {
            // The source chimney has its own shallow 0.3m cap; test the main
            // pitched planes rather than reclassifying that authored detail.
            if (Math.round(roof.getW(i)) !== 0 || roof.getY(i) < .5) continue;
            const pitch = Math.acos(Math.min(1, Math.abs(geometry.attributes.normal.getY(i)))) * 180 / Math.PI;
            assert.ok(pitch >= 37.99 && pitch <= 48.01, `source roof pitch ${pitch}`);
            tiledVertices++;
          }
          if (facade) {
            assert.equal(geometry.attributes.aFac.itemSize, 4);
            assert.equal(facade.itemSize, 4);
            for (let i = 0; i < facade.count; i++) {
              const palette = (facade.getX(i) * 7.13) % 1;
              const [low, high] = { lime: [.18, .4], ochre: [.4, .54], sand: [.65, .79] }[group.userData.sourceCrownfallArchitecture.plasterFamily];
              assert.ok(palette >= low - .0001 && palette < high + .0001);
              if ((Math.round(facade.getW(i)) & 4) !== 0) quoinVertices++;
              facadeVertices++;
            }
          }
        });
        assert.ok(tiledVertices > 0, 'the source roof contains real pitched surfaces');
        assert.ok(facadeVertices > 0, 'the original procedural facade channels remain present');
        assert.ok(quoinVertices >= 12, 'actual main walls retain encoded corner quoins; chimney/gable faces retain their source flags');
      } finally { disposeCallerGeometry(group); }
    }
  } finally { kit.dispose(); }
});

test('fixed lots expose three native low-rise roof forms with shared finishes after the original tile shader', () => {
  const kit = createArchitectureKit({ THREE, profile: 'quest' });
  const roofs = new Set(), families = new Map(), materialIds = new Set();
  const shaderFor = material => {
    const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader };
    material.onBeforeCompile(shader, {});
    return shader;
  };
  try {
    for (let i = 1; i <= 20; i++) {
      const group = kit.build({ id: `cottage-${String(i).padStart(2, '0')}`, kind: 'cottage', width: 6, depth: 6, height: 8.5 });
      try {
        const style = group.userData.sourceCrownfallArchitecture;
        roofs.add(style.roof); assert.equal(style.storeys, 1);
        assert.equal(style.allowRoofExtra, false, 'compact lots cannot acquire a source belvedere or tower');
        group.traverse(object => {
          if (!object.geometry?.attributes.aRoof) return;
          const material = object.material, shader = shaderFor(material);
          materialIds.add(material.uuid);
          families.set(material.userData.crownfallRoofFamily, shader.uniforms.uCrownfallRoofTint.value.toArray());
          assert.ok(shader.fragmentShader.indexOf('Crownfall roof finish:') > shader.fragmentShader.indexOf('diffuseColor.rgb = col;'));
          for (const sourceDetail of ['roofProfile', 'large-scale patchy weathering', 'cgBump', 'roughnessFactor', 'cgAO']) assert.ok(shader.fragmentShader.includes(sourceDetail), sourceDetail);
          assert.ok(shader.fragmentShader.includes('fwidth(estateCourse)'), 'broad courses are filtered rather than adding aerial aliasing');
          assert.equal(material.userData.crownfallRoofFamily, style.roofFamily);
        });
      } finally { disposeCallerGeometry(group); }
    }
    assert.deepEqual([...roofs].sort(), ['gableX', 'gableZ', 'hip']);
    assert.deepEqual([...families.keys()].sort(), ['copper', 'patina', 'slate']);
    assert.equal(new Set([...families.values()].map(value => value.join(','))).size, 3);
    assert.equal(materialIds.size, 3, 'the full village shares exactly three roof batches');
    const sourceShader = shaderFor(terracottaMaterial());
    assert.ok(!sourceShader.fragmentShader.includes('uCrownfallRoofTint'), 'the borrowed upstream material remains unchanged');
    assert.equal(kit.stats().ownedMaterials, 5, 'three shared roof finishes plus existing plaster and stone; no per-house materials');
  } finally { kit.dispose(); }
});

test('repeated kit lifecycles retain identical source hall and pavilion geometry without cached ornament drift', () => {
  const expected = new Map();
  for (let cycle = 0; cycle < 4; cycle++) {
    const kit = createArchitectureKit({ THREE, profile: 'quest' });
    try {
      for (const spec of [
        { id: 'banner-hall', kind: 'hall', width: 20, depth: 14, height: 16.5 },
        { id: 'preview', kind: 'pavilion', width: 4, depth: 4, height: 5 },
      ]) {
        const group = kit.build(spec);
        try {
          const signature = geometrySignature(group), bounds = new THREE.Box3().setFromObject(group);
          if (cycle === 0) expected.set(spec.kind, { signature, min: bounds.min.toArray(), max: bounds.max.toArray() });
          else {
            assert.equal(signature, expected.get(spec.kind).signature, `${spec.kind} geometry must not inherit earlier source-template translations`);
            assert.deepEqual(bounds.min.toArray(), expected.get(spec.kind).min);
            assert.deepEqual(bounds.max.toArray(), expected.get(spec.kind).max);
          }
          let triangles = 0, draws = 0;
          group.traverse(object => { if (object.isMesh) { draws++; triangles += (object.geometry.index?.count ?? object.geometry.attributes.position.count) / 3; } });
          if (spec.kind === 'pavilion') assert.ok(triangles <= 24000);
          else {
            assert.equal(draws, 9, 'the approach shares existing source material buckets');
            assert.ok(group.userData.sourceProvenance.some(source => source.generator.includes('original Crownfall')));
            assert.ok(Math.max(Math.abs(bounds.min.x), Math.abs(bounds.max.x)) <= 10);
            assert.ok(Math.max(Math.abs(bounds.min.z), Math.abs(bounds.max.z)) <= 7);
          }
        } finally { disposeCallerGeometry(group); }
      }
    } finally { kit.dispose(); }
  }
});
