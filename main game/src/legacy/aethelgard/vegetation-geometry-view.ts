import {BufferGeometry, type InstancedBufferAttribute} from 'three';

/** A draw-local fade stream over shared static buffers. Removing the borrowed
 * bindings before disposal is essential: Three otherwise deletes those VBOs
 * while another cell or the source owner still uses them. */
export function createVegetationGeometryView(source: BufferGeometry, range: InstancedBufferAttribute) {
  if (source.hasAttribute('crownfallLodRange')) throw Error('Vegetation geometry is already a draw view.');
  const geometry = new BufferGeometry(), names = Object.keys(source.attributes);
  for (const name of names) geometry.setAttribute(name, source.getAttribute(name));
  geometry.setIndex(source.index); geometry.setAttribute('crownfallLodRange', range);
  geometry.boundingBox = source.boundingBox?.clone() ?? null; geometry.boundingSphere = source.boundingSphere?.clone() ?? null;
  for (const group of source.groups) geometry.addGroup(group.start, group.count, group.materialIndex);
  geometry.setDrawRange(source.drawRange.start, source.drawRange.count); let disposed = false;
  return {geometry, dispose() {
    if (disposed) return; disposed = true;
    for (const name of names) geometry.deleteAttribute(name); geometry.setIndex(null); geometry.dispose();
  }};
}
