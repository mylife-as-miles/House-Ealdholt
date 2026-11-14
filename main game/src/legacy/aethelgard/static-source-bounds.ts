import {Box3, InterleavedBufferAttribute, Vector3, type BufferGeometry} from 'three';
const cache = new WeakMap<BufferGeometry, {attribute: object; version: number; bounds: Box3}>();
/** HLOD accepts static geometry only. Reuse the qualified GLB accessor box at
 * version zero; otherwise measure once per attribute revision. Never mutate a
 * borrowed box when applying an actor/component transform. */
export function staticSourceBounds(geometry: BufferGeometry): Box3 {
  const p = geometry.getAttribute('position'); if (!p) throw Error('Source geometry has no positions.');
  const version = p instanceof InterleavedBufferAttribute ? p.data.version : p.version, prior = cache.get(geometry);
  if (prior?.attribute === p && prior.version === version) return prior.bounds.clone();
  const bounds = version === 0 && geometry.boundingBox ? geometry.boundingBox.clone() : new Box3(), point = new Vector3();
  if (bounds.isEmpty()) for (let i = 0; i < p.count; i++) bounds.expandByPoint(point.fromBufferAttribute(p, i));
  if (bounds.isEmpty() || ![...bounds.min.toArray(), ...bounds.max.toArray()].every(Number.isFinite)) throw Error('Invalid static source bounds.');
  cache.set(geometry, {attribute: p, version, bounds}); return bounds.clone();
}
