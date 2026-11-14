import assert from 'node:assert/strict';
import test from 'node:test';
import { createEaldholtFoliageDensityWithAdapter, readEaldholtFoliageDensity, validateEaldholtFoliageComponents } from '../aethelgard/environment/foliage-density';

const valid = () => ({ schema: 1, family: 'field04', components: 3, counts: { low: 0, medium: 12, high: 20 } });

test('metadata copies authored prefixes and rejects invalid schemas, counts and family identities', () => {
  const original = valid(), parsed = readEaldholtFoliageDensity(original);
  original.counts.high = 999; assert.equal(parsed.counts.high, 20);
  assert.ok(Object.isFrozen(parsed)); assert.ok(Object.isFrozen(parsed.counts));
  for (const input of [null, {}, { ...valid(), schema: 2 }, { ...valid(), family: '' }, { ...valid(), family: 'bad\nname' }, { ...valid(), components: 0 }, { ...valid(), components: 1.5 },
    { ...valid(), counts: { low: -1, medium: 12, high: 20 } }, { ...valid(), counts: { low: 0, medium: 21, high: 20 } }, { ...valid(), counts: { low: 0, medium: NaN, high: 20 } }, { ...valid(), counts: { low: 0, medium: 12, high: Infinity } }]) assert.throws(() => readEaldholtFoliageDensity(input), /foliage/);
});

test('complete family capacity and geometry validation is independent of engine or source placements', () => {
  const tag = readEaldholtFoliageDensity(valid()), component = { capacity: 20, initialCount: 20, trianglesPerActor: 120, draws: 1, completeGeometry: true };
  validateEaldholtFoliageComponents(tag, [component, component, component]);
  for (const infos of [[component, component], [component, { ...component, capacity: 19 }, component], [component, { ...component, initialCount: 12 }, component], [component, { ...component, completeGeometry: false }, component], [component, { ...component, trianglesPerActor: 0 }, component]]) assert.throws(() => validateEaldholtFoliageComponents(tag, infos), /foliage/);
});

test('setup failure restores all owned state and releases claims before another attempt', () => {
  type Node = { children: Node[]; tag?: unknown; count?: number; bound?: number; visible?: boolean };
  const a: Node = { children: [], count: 20, bound: 7, visible: true }, b: Node = { children: [], count: 20, bound: 9, visible: false }, c: Node = { children: [], count: 20, bound: 11, visible: true };
  const root: Node = { children: [a, b, c], tag: valid() }; let failure = true;
  const adapter = {
    children: (node: Node) => node.children, metadata: (node: Node) => node.tag,
    component: (node: Node) => typeof node.count === 'number' ? node : null, drawable: () => false,
    inspect: (node: Node) => ({ capacity: 20, initialCount: node.count!, trianglesPerActor: 12, draws: 1, completeGeometry: true }),
    snapshot: (node: Node) => ({ count: node.count, bound: node.bound, visible: node.visible }),
    primeHighBounds: (node: Node) => { node.bound = 100; if (node === b && failure) throw Error('Synthetic bounds failure'); },
    select: (node: Node, count: number) => { node.count = count; node.visible = count > 0; },
    restore: (node: Node, snapshot: { count?: number; bound?: number; visible?: boolean }) => { Object.assign(node, snapshot); },
  };
  assert.throws(() => createEaldholtFoliageDensityWithAdapter(root, 'low', adapter), /Synthetic/);
  assert.deepEqual([a, b, c].map(node => [node.count, node.bound, node.visible]), [[20, 7, true], [20, 9, false], [20, 11, true]]);
  failure = false;
  const recovered = createEaldholtFoliageDensityWithAdapter(root, 'low', adapter);
  assert.deepEqual([a.count, b.count, c.count], [0, 0, 0]);
  recovered.dispose(); assert.deepEqual([a, b, c].map(node => [node.count, node.bound, node.visible]), [[20, 7, true], [20, 9, false], [20, 11, true]]);
});
