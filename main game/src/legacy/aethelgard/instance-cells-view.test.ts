import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { Box3, BoxGeometry, BufferGeometry, DataTexture, Frustum, Group, InstancedMesh, Matrix4, MeshBasicMaterial, MeshStandardMaterial, PerspectiveCamera, PlaneGeometry, ShaderMaterial, Vector3, type Material, type Object3D, type Texture } from 'three';
import { createEaldholtInstanceCells, createEaldholtInstanceCellsAsync, type EaldholtInstanceCellLayer, type EaldholtInstanceCells } from './instance-cells-view';
import { createEaldholtFoliageDensity } from './foliage-density';
import { applyEaldholtNeutralFill } from './neutral-fill';
import {
  applyEaldholtDensityOrder, createEaldholtDensityOrder, createEaldholtInstanceCellSelector, extractEaldholtFrustumPlanes, EALDHOLT_INSTANCE_CELL_ATTRIBUTE,
  EALDHOLT_INSTANCE_CELL_PROFILES, EALDHOLT_INSTANCE_CELL_SHADER_KEY, type EaldholtInstanceCellKindRule,
} from '../../../../shared/legacy/aethelgard/environment/instance-cells';

const rule: EaldholtInstanceCellKindRule = { nominalSize: .5, cellSize: 16, hysteresis: .1,
  bands: [{ pixels: 40, lod: 0, density: 1 }, { pixels: 16, lod: 1, density: .6 }, { pixels: 7, lod: 2, density: .3 }] };
const roomy = { budgets: { low: { draws: 1e6, triangles: 1e12 }, medium: { draws: 1e6, triangles: 1e12 }, high: { draws: 1e6, triangles: 1e12 } } };
type Fill = { readonly materialCount: number; dispose(): void };
// Desktop takes (root); Quest also binds an optional world environment. One call shape serves both copies.
const neutralFill = applyEaldholtNeutralFill as unknown as (root: Object3D, environment?: Texture | null) => Fill;

function fixture(density?: unknown) {
  const box = new BoxGeometry(.6, .6, .6).translate(0, .3, 0), card = new PlaneGeometry(.8, .5).translate(0, .25, 0);
  const far = new PlaneGeometry(.7, .4), tiny = new PlaneGeometry(.5, .3);
  const leaf = new MeshStandardMaterial({ name: 'review-leaf' }), stem = new MeshStandardMaterial({ name: 'review-stem' });
  const side = 32, grid = new Float32Array(side * side * 16), m = new Matrix4(), q = new Matrix4();
  let i = 0;
  for (let gx = 0; gx < side; gx++) for (let gz = 0; gz < side; gz++, i++) {
    m.makeRotationY((i * 2.399) % (Math.PI * 2)).multiply(q.makeScale(.8 + (i % 5) * .1, .9 + (i % 3) * .2, .8 + (i % 5) * .1));
    m.setPosition(gx * 4 + .5, (gx + gz) % 4 * .1, gz * 4 + 1.5); m.toArray(grid, i * 16);
  }
  const matrices = applyEaldholtDensityOrder(grid, createEaldholtDensityOrder(grid, 5));
  const layer: EaldholtInstanceCellLayer = { id: 'review-grass', kind: 'groundcover', rule, matrices, density,
    lods: [[{ geometry: box, material: leaf }, { geometry: card, material: stem }], [{ geometry: far, material: leaf }], [{ geometry: tiny, material: leaf }]] };
  const borrowed = [box, card, far, tiny, leaf, stem];
  let borrowedDisposals = 0;
  for (const item of borrowed) item.addEventListener('dispose', () => { borrowedDisposals++; });
  return { layer, borrowed, leaf, stem, get borrowedDisposals() { return borrowedDisposals; },
    cleanup() { for (const item of borrowed) item.dispose(); } };
}
function camera(eye: Vector3, target: Vector3, near = .1, far = 1000) {
  const result = new PerspectiveCamera(60, 16 / 9, near, far);
  result.position.copy(eye); result.lookAt(target); result.updateMatrixWorld(true);
  return result;
}
const meshes = (cells: EaldholtInstanceCells) => cells.object.children as InstancedMesh[];
const meshesOf = (cells: EaldholtInstanceCells, cell: number) => meshes(cells).filter(mesh => mesh.userData.crownfallInstanceCell.cell === cell);
/** What each mesh draws: count and the borrowed position buffer it points at. */
const state = (cells: EaldholtInstanceCells) => meshes(cells).map(mesh => mesh.visible ? `${mesh.count}:${mesh.geometry.getAttribute('position').array.length}` : '-');

test('cells share one owned matrix and rank buffer per cell, one mesh per material slot, and full bounds over every LOD and region instance', () => {
  const f = fixture();
  try {
    const cells = createEaldholtInstanceCells([f.layer], { profile: 'desktop', quality: 'high', index: roomy, shares: 'fixed' });
    assert.equal(cells.cellCount, 4 + 16 + 64); assert.equal(cells.instanceCount, 1024);
    // Level 0 reaches LOD0 (leaf + stem slots); coarser levels reach only the leaf slot.
    assert.equal(cells.meshCount, 64 * 2 + 16 + 4);
    const stored = (level: number) => { let total = 0; for (let c = 0; c < cells.cellCount; c++) if (cells.index.cellLevel[c] === level) total += cells.index.cellInstances[c]; return total; };
    assert.equal(cells.ownedInstanceBytes, (stored(0) + stored(1) + stored(2)) * (64 + 8), 'matrices plus rank attributes, each level storing only its prefix');
    assert.equal(cells.ownedMaterialCount, 2 + 2, 'one patched clone per borrowed material plus one depth material per slot');
    const v = new Vector3(), m = new Matrix4(), sizes = cells.index.layers[0].settings.levelSizes, origin = cells.index.layers[0].origin;
    for (let c = 0; c < cells.cellCount; c++) {
      const group = meshesOf(cells, c), level = cells.index.cellLevel[c];
      const rank = group[0].geometry.getAttribute(EALDHOLT_INSTANCE_CELL_ATTRIBUTE);
      assert.ok(group.every(mesh => mesh.instanceMatrix === group[0].instanceMatrix && mesh.geometry.getAttribute(EALDHOLT_INSTANCE_CELL_ATTRIBUTE) === rank
        && !mesh.visible && mesh.count === 0 && !mesh.matrixAutoUpdate && mesh.customDepthMaterial !== undefined));
      assert.equal(group[0].instanceMatrix.count, cells.index.cellInstances[c]); assert.equal(rank.count, cells.index.cellInstances[c]);
      for (let k = 0; k < rank.count; k++) assert.equal(rank.getX(k), cells.index.order[cells.index.cellStart[c] + k], 'the attribute carries the global priority rank');
      // Brute force: every vertex of every LOD of every instance in the cell's region lies inside each mesh's box.
      for (let i = 0; i < 1024; i++) {
        m.fromArray(f.layer.matrices, i * 16);
        if (Math.floor((m.elements[12] - origin[0]) / sizes[level]) !== cells.index.cellX[c] || Math.floor((m.elements[14] - origin[1]) / sizes[level]) !== cells.index.cellZ[c]) continue;
        for (const lod of f.layer.lods) for (const part of lod) {
          const position = part.geometry.getAttribute('position');
          for (let p = 0; p < position.count; p++) {
            v.fromBufferAttribute(position, p).applyMatrix4(m);
            for (const mesh of group) assert.ok(mesh.boundingBox!.distanceToPoint(v) < 1e-6 && mesh.boundingSphere!.distanceToPoint(v) < 1e-6);
          }
        }
      }
    }
    assert.ok(f.borrowed.every(item => !(item instanceof BufferGeometry) || item.boundingBox === null), 'borrowed geometry caches stay untouched');
    // Wrappers share the borrowed buffers; they never copy vertex data.
    const leafMesh = meshes(cells).find(mesh => mesh.userData.crownfallInstanceCell.level === 0 && mesh.userData.crownfallInstanceCell.slot === 0)!;
    assert.equal(leafMesh.geometry.getAttribute('position'), f.layer.lods[0][0].geometry.getAttribute('position'));
    assert.notEqual(leafMesh.geometry, f.layer.lods[0][0].geometry);
    const placement = new Box3().setFromObject(cells.object);
    assert.ok(placement.min.x <= .5 - .45 && placement.max.x >= 124.5 + .4 && placement.max.z >= 125.5 + .4);
    assert.deepEqual(cells.bounds!.min, placement.min.toArray());
    const info = cells.object.userData.crownfallInstanceCells;
    assert.equal(info.schema, 2); assert.equal(info.layers[0].levels, 3); assert.equal(info.layers[0].castShadow, false); assert.equal(info.layers[0].alphaMips, true);
    cells.dispose();
  } finally { f.cleanup(); }
});

test('every cell mesh states its layer kind, shadow permission and alpha-mip eligibility for the caller (kindOf, collectModel)', () => {
  const f = fixture();
  try {
    const kinds = [
      { kind: 'groundcover', castShadow: false, alphaMips: true }, { kind: 'understory', castShadow: true, alphaMips: true },
      { kind: 'rock', castShadow: true, alphaMips: false }, { kind: 'debris', castShadow: true, alphaMips: true },
    ] as const;
    const layers: EaldholtInstanceCellLayer[] = kinds.map(k => ({ ...f.layer, id: `review-${k.kind}`, kind: k.kind }));
    // Explicit per-layer values win over the kind defaults.
    layers.push({ ...f.layer, id: 'review-rock-no-shadow', kind: 'rock', castShadow: false }, { ...f.layer, id: 'review-ferns-opaque', kind: 'understory', alphaMips: false });
    const expected = new Map<string, { kind: string; castShadow: boolean; alphaMips: boolean }>(kinds.map(k => [`review-${k.kind}`, { ...k }]));
    expected.set('review-rock-no-shadow', { kind: 'rock', castShadow: false, alphaMips: false });
    expected.set('review-ferns-opaque', { kind: 'understory', castShadow: true, alphaMips: false });
    const cells = createEaldholtInstanceCells(layers, { profile: 'desktop', quality: 'high', index: roomy, shares: 'fixed' });
    const seen = new Set<string>();
    for (const mesh of meshes(cells)) {
      const info = mesh.userData.crownfallInstanceCell, want = expected.get(info.layer);
      assert.ok(want, info.layer); seen.add(info.layer);
      assert.deepEqual({ kind: info.kind, castShadow: info.castShadow, alphaMips: info.alphaMips }, want, info.layer);
      // The caller decides casting by distance and its shadow budgets; the view never casts on its own.
      assert.equal(mesh.castShadow, false); assert.equal(mesh.receiveShadow, true);
    }
    assert.equal(seen.size, expected.size);
    cells.dispose();
  } finally { f.cleanup(); }
});

test('update applies the shared selection to visibility, counts and LOD buffers, never to materials or instance data', () => {
  const f = fixture();
  try {
    const cells = createEaldholtInstanceCells([f.layer], { profile: 'desktop', quality: 'high', index: roomy, shares: 'fixed' });
    const parent = new Group(); parent.position.set(3, -1, 2); parent.rotation.y = .3; parent.add(cells.object); parent.updateMatrixWorld(true);
    const materials = meshes(cells).map(mesh => mesh.material);
    const view = camera(new Vector3(60, 2, 60), new Vector3(140, 0, 120));
    const before = meshes(cells).map(mesh => [mesh.instanceMatrix.version, mesh.instanceMatrix.array.slice()] as const);
    assert.equal(cells.update(view), true);
    assert.equal(cells.update(view), false, 'an unchanged view changes nothing');
    // Independent expectation: the shared selector fed by three's own transforms.
    const reference = createEaldholtInstanceCellSelector(cells.index, { quality: 'high' });
    const eye = cells.object.worldToLocal(new Vector3().setFromMatrixPosition(view.matrixWorld));
    const clip = new Matrix4().multiplyMatrices(view.projectionMatrix, view.matrixWorldInverse).multiply(cells.object.matrixWorld);
    reference.update(eye.x, eye.y, eye.z, clip.elements);
    let visible = 0;
    const levels = new Set<number>();
    for (let c = 0; c < cells.cellCount; c++) {
      const group = meshesOf(cells, c), lod = reference.lod[c];
      if (lod < 0) { assert.ok(group.every(mesh => !mesh.visible)); continue; }
      visible++; levels.add(cells.index.cellLevel[c]);
      const parts = f.layer.lods[lod];
      for (const mesh of group) {
        const slot = mesh.userData.crownfallInstanceCell.slot, part = slot === 0 ? parts[0] : lod === 0 ? parts[1] : undefined;
        assert.equal(mesh.visible, part !== undefined);
        if (part) { assert.equal(mesh.geometry.getAttribute('position'), part.geometry.getAttribute('position')); assert.equal(mesh.count, reference.count[c]); }
      }
    }
    assert.ok(visible > 3 && levels.size >= 2, 'near cells split while farther ones draw at coarser levels');
    assert.equal(cells.diagnostics.visibleCells, visible);
    assert.equal(cells.diagnostics.drawCalls, meshes(cells).filter(mesh => mesh.visible).length);
    // Walk through every band: buffers swap, materials are slot constants.
    for (let step = 0; step < 30; step++) { view.position.set(60 - step * 4, 2 + step, 60 - step * 3); view.updateMatrixWorld(true); cells.update(view); }
    assert.ok(meshes(cells).every((mesh, i) => mesh.material === materials[i]), 'mesh.material never changes after creation');
    view.lookAt(60.01, 500, 60); view.updateMatrixWorld(true);
    assert.equal(cells.update(view), true);
    assert.ok(meshes(cells).every(mesh => !mesh.visible));
    meshes(cells).forEach((mesh, i) => { assert.equal(mesh.instanceMatrix.version, before[i][0]); assert.deepEqual(mesh.instanceMatrix.array, before[i][1]); });
    cells.dispose();
  } finally { f.cleanup(); }
});

test('later material passes survive: neutral fill clones stay assigned across band changes and disposal restores the owned clones', () => {
  const f = fixture();
  try {
    const cells = createEaldholtInstanceCells([f.layer], { profile: 'desktop', quality: 'high', index: roomy, shares: 'fixed' });
    const model = new Group(); model.add(cells.object); model.updateMatrixWorld(true);
    const owned = meshes(cells).map(mesh => mesh.material as Material);
    const environment = new DataTexture(new Uint8Array(4), 1, 1);
    const fill = neutralFill(model, environment);
    assert.ok(fill.materialCount >= 2);
    const filled = meshes(cells).map(mesh => mesh.material as MeshStandardMaterial);
    assert.ok(filled.every((material, i) => material !== owned[i] && /_NeutralFill$/.test(material.name)), 'neutral fill replaced every cell material');
    const envMaps = filled.map(material => material.envMap);
    const view = camera(new Vector3(-20, 3, -20), new Vector3(60, 0, 60));
    let shown = 0, lodChanges = 0;
    const geometryBefore = meshes(cells).map(mesh => mesh.geometry.getAttribute('position'));
    for (let step = 0; step < 40; step++) {
      view.position.set(-20 + step * 3, 3, -20 + step * 3); view.updateMatrixWorld(true);
      cells.update(view);
      shown = Math.max(shown, meshes(cells).filter(mesh => mesh.visible).length);
      meshes(cells).forEach((mesh, i) => {
        assert.equal(mesh.material, filled[i], `step ${step}: mesh ${i} keeps the neutral fill clone`);
        assert.equal((mesh.material as MeshStandardMaterial).envMap, envMaps[i]);
        if (mesh.geometry.getAttribute('position') !== geometryBefore[i]) lodChanges++;
      });
    }
    assert.ok(shown > 5 && lodChanges > 0, `${shown} meshes shown, ${lodChanges} LOD buffer swaps`);
    fill.dispose();
    assert.ok(meshes(cells).every((mesh, i) => mesh.material === owned[i]), 'disposing neutral fill restores the owned clones');
    let ownedDisposals = 0;
    for (const material of new Set(owned)) material.addEventListener('dispose', () => { ownedDisposals++; });
    cells.dispose();
    assert.equal(ownedDisposals, 2); assert.equal(f.borrowedDisposals, 0);
    environment.dispose();
  } finally { f.cleanup(); }
});

test('owned clones chain the original compile hook and inject per-instance thinning; depth materials thin the same way', () => {
  const f = fixture();
  try {
    let originalCompiles = 0;
    f.leaf.onBeforeCompile = () => { originalCompiles++; };
    f.leaf.customProgramCacheKey = () => 'review-leaf-key';
    const cells = createEaldholtInstanceCells([f.layer], { profile: 'desktop', quality: 'high', index: roomy, shares: 'fixed' });
    const leaf = meshes(cells).find(mesh => mesh.userData.crownfallInstanceCell.slot === 0)!;
    const clone = leaf.material as MeshStandardMaterial;
    assert.notEqual(clone, f.leaf); assert.equal(clone.name, f.leaf.name, 'names survive for name-based passes');
    assert.equal(clone.customProgramCacheKey(), 'review-leaf-key' + EALDHOLT_INSTANCE_CELL_SHADER_KEY);
    const shader = { vertexShader: '#include <common>\nvoid main() {\n#include <beginnormal_vertex>\n#include <begin_vertex>\n}', fragmentShader: '', uniforms: {} as Record<string, { value: unknown }> };
    clone.onBeforeCompile(shader as unknown as Parameters<Material['onBeforeCompile']>[0], {} as Parameters<Material['onBeforeCompile']>[1]);
    assert.equal(originalCompiles, 1, 'the borrowed hook still runs');
    assert.match(shader.vertexShader, /ealdholtCellScale/);
    assert.ok(shader.uniforms.uEaldholtCellEye && shader.uniforms.uEaldholtCellKnotR);
    const depth = leaf.customDepthMaterial!, depthShader = { vertexShader: '#include <common>\nvoid main() {\n#include <begin_vertex>\n}', fragmentShader: '', uniforms: {} as Record<string, { value: unknown }> };
    depth.onBeforeCompile(depthShader as unknown as Parameters<Material['onBeforeCompile']>[0], {} as Parameters<Material['onBeforeCompile']>[1]);
    assert.equal(depthShader.uniforms.uEaldholtCellEye, shader.uniforms.uEaldholtCellEye, 'shadow and main passes share one layer state');
    cells.dispose();
    assert.throws(() => createEaldholtInstanceCells([{ ...f.layer, lods: [[{ geometry: f.layer.lods[0][0].geometry, material: new ShaderMaterial() }]] }],
      { profile: 'desktop', quality: 'low' }), /standard mesh materials/);
  } finally { f.cleanup(); }
});

test('band distances follow the real focal length, and shares follow measured headroom unless pinned', () => {
  const f = fixture();
  try {
    const cells = createEaldholtInstanceCells([f.layer], { profile: 'desktop', quality: 'medium' });
    const view = camera(new Vector3(-10, 4, -10), new Vector3(60, 0, 60));
    cells.update(view, 1080);
    const focal = 1080 / 2 / Math.tan(30 * Math.PI / 180), desktop = EALDHOLT_INSTANCE_CELL_PROFILES.desktop;
    assert.ok(Math.abs(cells.diagnostics.actualFocalPixels - focal) < 1e-6);
    assert.ok(Math.abs(cells.diagnostics.distanceScale - desktop.focalPixels / focal / desktop.tierScale.medium) < 1e-9);
    cells.update(view, 2160);
    assert.ok(Math.abs(cells.diagnostics.distanceScale - desktop.focalPixels / (focal * 2) / desktop.tierScale.medium) < 1e-9, 'a sharper image moves every band outward');
    // Headroom: the share starts at the floor and follows the rest of the scene.
    assert.equal(cells.diagnostics.shareDraws, desktop.headroom.floor.medium.draws);
    assert.equal(cells.observeFrame(120 + cells.diagnostics.drawCalls, 300_000 + cells.diagnostics.triangles), true);
    assert.equal(cells.diagnostics.shareDraws, Math.min(desktop.budgets.medium.draws, Math.floor(200 * .9 - 120)));
    assert.equal(cells.diagnostics.headroomBaseDraws, 120);
    assert.equal(cells.setShare({ draws: 5, triangles: 1000 }), true);
    assert.equal(cells.observeFrame(10, 10), false, 'a pinned share ignores observations');
    assert.equal(cells.diagnostics.shareDraws, 5);
    cells.setShare(null);
    assert.equal(cells.setQuality('high'), true);
    assert.ok(cells.diagnostics.shareDraws >= desktop.headroom.floor.high.draws);
    const fixed = createEaldholtInstanceCells([f.layer], { profile: 'desktop', quality: 'low', shares: 'fixed' });
    assert.equal(fixed.observeFrame(500, 2e6), false); assert.equal(fixed.diagnostics.shareDraws, desktop.budgets.low.draws);
    fixed.setQuality('high'); assert.equal(fixed.diagnostics.shareDraws, desktop.budgets.high.draws, 'fixed shares follow the tier cap');
    assert.equal(cells.setFrustumMargin(24), true); assert.equal(cells.setFrustumMargin(null), true);
    cells.dispose(); fixed.dispose();
  } finally { f.cleanup(); }
});

test('authored density tiers thin far bands; the nearest band keeps full density on every tier', () => {
  const f = fixture({ schema: 1, family: 'review-grass-v1', components: 2, counts: { low: 256, medium: 640, high: 1000 } });
  try {
    const cells = createEaldholtInstanceCells([f.layer], { profile: 'desktop', quality: 'low', index: roomy, shares: 'fixed' });
    const overview = camera(new Vector3(64, 30, -6), new Vector3(64, 0, 64));
    cells.update(overview);
    const submitted = () => meshes(cells).filter(mesh => mesh.visible && mesh.userData.crownfallInstanceCell.slot === 0).reduce((sum, mesh) => sum + mesh.count, 0);
    const low = submitted();
    assert.equal(cells.setQuality('low'), false);
    assert.equal(cells.setQuality('high'), true); cells.update(overview);
    const high = submitted();
    assert.ok(low > 0 && high > low * 1.5, `tiers change far density (${low} -> ${high})`);
    assert.equal(cells.diagnostics.tier, 'high');
    assert.throws(() => createEaldholtInstanceCells([{ ...f.layer, density: { schema: 1, family: 'x', components: 1, counts: { low: 1, medium: 2, high: 3 } } }],
      { profile: 'desktop', quality: 'low' }), /components/);
    cells.dispose();
  } finally { f.cleanup(); }
});

test('a scaled, rotated miniature selects exactly what the same view selects at full scale', () => {
  const f = fixture();
  try {
    const full = createEaldholtInstanceCells([f.layer], { profile: 'desktop', quality: 'medium', index: roomy, shares: 'fixed' });
    const mini = createEaldholtInstanceCells([f.layer], { profile: 'desktop', quality: 'medium', index: roomy, shares: 'fixed' });
    const pivot = new Group(); pivot.position.set(.3, 1, -3.8); pivot.rotation.set(.5, .7, 0); pivot.scale.setScalar(.02 * 1.3);
    pivot.add(mini.object); pivot.updateMatrixWorld(true);
    const eye = new Vector3(20, 12, -30), target = new Vector3(64, 0, 64);
    full.update(camera(eye, target), 1080);
    const scale = .02 * 1.3, miniCamera = new PerspectiveCamera(60, 16 / 9, .1 * scale, 1000 * scale);
    const local = new Matrix4().lookAt(eye, target, new Vector3(0, 1, 0)).setPosition(eye);
    miniCamera.matrixAutoUpdate = false;
    miniCamera.matrix.multiplyMatrices(pivot.matrixWorld, local).multiply(new Matrix4().makeScale(1 / scale, 1 / scale, 1 / scale));
    miniCamera.updateMatrixWorld(true);
    mini.update(miniCamera, 1080);
    assert.deepEqual(state(mini), state(full));
    assert.ok(state(full).some(item => item !== '-'));
    // The shader sees the same layer-local eye and scale in both.
    assert.ok(Math.abs(mini.diagnostics.distanceScale - full.diagnostics.distanceScale) < 1e-12);
    full.dispose(); mini.dispose();
  } finally { f.cleanup(); }
});

test('frustum planes from plain matrices agree with three', () => {
  const view = camera(new Vector3(3, 4, 5), new Vector3(-20, 1, 9));
  const matrix = new Matrix4().multiplyMatrices(view.projectionMatrix, view.matrixWorldInverse);
  const ours = extractEaldholtFrustumPlanes(matrix.elements, new Float64Array(24)), theirs = new Frustum().setFromProjectionMatrix(matrix);
  theirs.planes.forEach((plane, p) => {
    for (const [k, value] of [plane.normal.x, plane.normal.y, plane.normal.z, plane.constant].entries()) assert.ok(Math.abs(ours[p * 4 + k] - value) < 1e-9);
  });
});

test('dispose releases owned buffers, wrappers and materials only; nesting in a foliage family is refused', () => {
  const f = fixture();
  try {
    const cells = createEaldholtInstanceCells([f.layer], { profile: 'quest', quality: 'high' });
    const root = new Group(), woodland = new Group(), tree = new InstancedMesh(new BoxGeometry(), new MeshBasicMaterial(), 4);
    woodland.userData.crownfallFoliageDensity = { schema: 1, family: 'review-woodland-v1', components: 1, counts: { low: 1, medium: 2, high: 4 } };
    woodland.add(tree); root.add(woodland, cells.object);
    const density = createEaldholtFoliageDensity(root, 'low');
    assert.equal(tree.count, 1);
    assert.ok(meshes(cells).every(mesh => mesh.count === 0 && !mesh.visible));
    cells.update(camera(new Vector3(64, 20, -40), new Vector3(64, 0, 64)));
    density.dispose(); tree.geometry.dispose(); (tree.material as MeshBasicMaterial).dispose(); tree.dispose();
    let meshDisposals = 0, wrapperDisposals = 0, materialDisposals = 0;
    const wrappers = meshes(cells).map(mesh => mesh.geometry), owned = new Set<Material>();
    for (const mesh of meshes(cells)) {
      mesh.addEventListener('dispose', () => { meshDisposals++; });
      owned.add(mesh.material as Material); owned.add(mesh.customDepthMaterial!);
    }
    for (const wrapper of new Set(wrappers)) wrapper.addEventListener('dispose', () => {
      // Only the owned rank attribute is left for three to release.
      assert.deepEqual(Object.keys(wrapper.attributes), [EALDHOLT_INSTANCE_CELL_ATTRIBUTE]); assert.equal(wrapper.index, null);
      wrapperDisposals++;
    });
    for (const material of owned) material.addEventListener('dispose', () => { materialDisposals++; });
    const meshCount = cells.meshCount;
    cells.dispose(); cells.dispose();
    assert.equal(meshDisposals, meshCount); assert.equal(wrapperDisposals, meshCount); assert.equal(materialDisposals, cells.ownedMaterialCount);
    assert.equal(cells.disposed, true); assert.equal(cells.object.parent, null); assert.equal(cells.object.children.length, 0);
    assert.equal(f.borrowedDisposals, 0, 'borrowed geometry and materials survive');
    assert.ok(f.layer.lods[0][0].geometry.getAttribute('position'), 'borrowed attributes are intact');
    assert.equal(cells.update(camera(new Vector3(), new Vector3(0, 0, -1))), false);
    const nested = createEaldholtInstanceCells([f.layer], { profile: 'desktop', quality: 'low' });
    woodland.add(nested.object);
    assert.throws(() => nested.update(camera(new Vector3(), new Vector3(0, 0, -1))), /nested inside an authored foliage family/);
    nested.dispose();
  } finally { f.cleanup(); }
});

test('incomplete parts, reserved names and mismatched slot layouts are refused before any mesh is built', () => {
  const f = fixture();
  try {
    const empty = new BufferGeometry();
    assert.throws(() => createEaldholtInstanceCells([{ ...f.layer, lods: [[{ geometry: empty, material: new MeshStandardMaterial() }]] }], { profile: 'desktop', quality: 'low' }), /complete/);
    const grouped = new BoxGeometry(); grouped.clearGroups(); grouped.addGroup(0, 6, 0);
    assert.throws(() => createEaldholtInstanceCells([{ ...f.layer, lods: [[{ geometry: grouped, material: [new MeshStandardMaterial()] }]] }], { profile: 'desktop', quality: 'low' }), /groups/);
    assert.throws(() => createEaldholtInstanceCells([{ ...f.layer, matrices: new Float32Array(15) }], { profile: 'desktop', quality: 'low' }), /16 values/);
    assert.throws(() => createEaldholtInstanceCells([{ ...f.layer, lods: [[]] }], { profile: 'desktop', quality: 'low' }), /at least one part/);
    const bare = new PlaneGeometry(); bare.deleteAttribute('uv');
    assert.throws(() => createEaldholtInstanceCells([{ ...f.layer, lods: [[{ geometry: f.layer.lods[0][0].geometry, material: f.leaf }], [{ geometry: bare, material: f.leaf }]] }],
      { profile: 'desktop', quality: 'low' }), /attribute layouts/);
    empty.dispose(); grouped.dispose(); bare.dispose();
  } finally { f.cleanup(); }
});

test('the stepwise build yields between chunks, matches the synchronous view and cleans up when aborted', async () => {
  const f = fixture();
  try {
    let yields = 0;
    const control = { yieldToMain: async () => { yields++; }, instancesPerStep: 256, cellsPerStep: 8 };
    const stepped = await createEaldholtInstanceCellsAsync([f.layer], { profile: 'desktop', quality: 'high', index: roomy, shares: 'fixed' }, control);
    const direct = createEaldholtInstanceCells([f.layer], { profile: 'desktop', quality: 'high', index: roomy, shares: 'fixed' });
    assert.ok(yields >= 10, `${yields} yields`);
    assert.deepEqual(stepped.index, direct.index); assert.equal(stepped.meshCount, direct.meshCount);
    assert.ok(stepped.longestBuildStepMilliseconds <= stepped.buildMilliseconds + 1e-9);
    const view = camera(new Vector3(-10, 4, -10), new Vector3(60, 0, 60));
    stepped.update(view, 1080); direct.update(view, 1080);
    assert.deepEqual(state(stepped), state(direct));
    stepped.dispose(); direct.dispose();
    const abort = new AbortController();
    await assert.rejects(createEaldholtInstanceCellsAsync([f.layer], { profile: 'desktop', quality: 'high' },
      { signal: abort.signal, yieldToMain: async () => { abort.abort(); } }), /abort/i);
  } finally { f.cleanup(); }
});

test('Desktop and Quest adapter copies differ only in their three import', () => {
  const root = new URL('../../../../', import.meta.url);
  const read = (path: string) => readFileSync(new URL(path, root), 'utf8').replace(/from '(three|@iwsdk\/core)';/g, "from 'THREE';");
  for (const file of ['instance-cells-view.ts', 'instance-cells-view.test.ts'])
    assert.equal(read(`main game/src/legacy/aethelgard/${file}`), read(`main-game-vr/src/legacy/aethelgard/${file}`), `${file} copies diverge`);
});
