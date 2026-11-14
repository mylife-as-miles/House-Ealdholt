/** Remove unused vertices from a derived LOD without changing its triangles or
 * any retained source attribute. Source IDs remain available for exact remap. */
export function compactVegetationIndices(indices: Uint32Array, vertexCount: number) {
  if (!Number.isSafeInteger(vertexCount) || vertexCount < 1 || vertexCount > 500000 ||
      indices.length % 3 || indices.length > 1500000) throw Error('Invalid vegetation index budget.');
  const remap = new Int32Array(vertexCount).fill(-1), source = new Uint32Array(Math.min(indices.length, vertexCount));
  const compact = new Uint32Array(indices.length); let count = 0;
  for (let i = 0; i < indices.length; i++) {
    const id = indices[i]; if (id >= vertexCount) throw Error('Derived vegetation index exceeds the source vertex pool.');
    if (remap[id] === -1) {remap[id] = count; source[count++] = id;}
    compact[i] = remap[id];
  }
  return {indices: compact, sourceVertices: source.slice(0, count)};
}
