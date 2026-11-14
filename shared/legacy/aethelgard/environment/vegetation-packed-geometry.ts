import {FOREST01_DENSITY_LOD,selectForest01DensityIndices} from './forest01-density-lod';
import {simplifyVegetationIndices, type VegetationSimplifier, type VegetationSimplifyInput} from './vegetation-simplify';
import {compactVegetationIndices} from './vegetation-indexing';

/** Worker-only remapping: keep every source channel and return small,
 * transferable owned arrays rather than copying dense LODs on the UI thread. */
export async function buildPackedVegetationGeometry(input: VegetationSimplifyInput & {
  channels: readonly {name: string; size: number}[]; profile?: typeof FOREST01_DENSITY_LOD.version;
}, simplifier: VegetationSimplifier) {
  if (!input.channels.length || input.channels.some(channel => !/^[a-zA-Z][a-zA-Z0-9_]*$/.test(channel.name) ||
      channel.name === 'position' || !Number.isSafeInteger(channel.size) || channel.size < 1 || channel.size > 4) ||
      new Set(input.channels.map(c => c.name)).size !== input.channels.length ||
      input.channels.reduce((sum, c) => sum + c.size, 0) !== input.stride) throw Error('Invalid source vegetation channels.');
  if (input.profile !== undefined && input.profile !== FOREST01_DENSITY_LOD.version) throw Error('Unknown vegetation geometry profile.');
  const {indices, error} = input.profile === FOREST01_DENSITY_LOD.version ? await selectForest01DensityIndices(input) : await simplifyVegetationIndices(input, simplifier);
  const compact = compactVegetationIndices(indices, input.positions.length / 3);
  const positions = new Float32Array(compact.sourceVertices.length * 3);
  const attributes = input.channels.map(channel => ({name: channel.name, size: channel.size,
    values: new Float32Array(compact.sourceVertices.length * channel.size)}));
  const bounds = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (let i = 0; i < compact.sourceVertices.length; i++) {
    const source = compact.sourceVertices[i];
    for (let c = 0; c < 3; c++) {
      const value = input.positions[source * 3 + c]; positions[i * 3 + c] = value;
      bounds[c] = Math.min(bounds[c], value); bounds[c + 3] = Math.max(bounds[c + 3], value);
    }
    let offset = source * input.stride;
    for (const attribute of attributes) for (let c = 0; c < attribute.size; c++) attribute.values[i * attribute.size + c] = input.attributes[offset++];
  }
  return {positions, attributes, indices: compact.indices, bounds, error, sourceTriangles: input.indices.length / 3};
}
