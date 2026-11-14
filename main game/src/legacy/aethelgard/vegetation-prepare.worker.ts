import {prepareGeneratedFoliageNormals,type QualifiedGeneratedFoliageNormalInput} from '../../../../shared/legacy/aethelgard/environment/generated-foliage-normal';
// No Three dependency or source-object mutation in the worker. Meshoptimizer
// produces derived indices only; source GLB attributes remain authoritative.
import {MeshoptSimplifier} from 'meshoptimizer';
import {simplifyVegetationIndices} from '../../../../shared/legacy/aethelgard/environment/vegetation-simplify';
import {buildVegetationAtlasMips, type VegetationAtlasRecord} from '../../../../shared/legacy/aethelgard/environment/vegetation-atlas';
import {buildGrassGroundField} from '../../../../shared/legacy/aethelgard/environment/grass-ground-field';
import {buildPackedVegetationGeometry} from '../../../../shared/legacy/aethelgard/environment/vegetation-packed-geometry';

type FoliageNormal={id:number;kind:'foliage-normal';input:QualifiedGeneratedFoliageNormalInput};
type Simplify = {id: number; kind: 'simplify'; positions: Float32Array; attributes: Float32Array; indices: Uint32Array; stride: number; ratio: number; error: number; foliage: boolean; attributeWeights: number[]};
type Mips = {id: number; kind: 'mips'; input: Omit<VegetationAtlasRecord, 'mips'> & {colour: Uint8Array; normal: Uint8Array}};
type Ground = {id: number; kind: 'ground'; input: Parameters<typeof buildGrassGroundField>[0]};
type Packed = Parameters<typeof buildPackedVegetationGeometry>[0] & {id: number; kind: 'packed'};
self.onmessage = async ({data}: MessageEvent<Simplify | Mips | Ground | Packed | FoliageNormal>) => {
  try {
    if (data.kind === 'foliage-normal') {
      const record=await prepareGeneratedFoliageNormals(data.input);
      self.postMessage({id:data.id,record},{transfer:record.mips.map(mip=>mip.rgba.buffer)});
    } else if (data.kind === 'packed') {
      const result = await buildPackedVegetationGeometry(data, MeshoptSimplifier);
      self.postMessage({id: data.id, ...result}, {transfer: [result.positions.buffer, result.indices.buffer, ...result.attributes.map(a => a.values.buffer)]});
    } else if (data.kind === 'ground') {
      const field = buildGrassGroundField(data.input);
      self.postMessage({id: data.id, field}, {transfer: [field.colour.buffer, field.normal.buffer, field.height.buffer]});
    } else if (data.kind === 'mips') {
      const record = buildVegetationAtlasMips(data.input);
      self.postMessage({id: data.id, record}, {transfer: record.mips.flatMap(m => [m.colour.buffer, m.normal.buffer])});
    } else {
      const {indices, error} = await simplifyVegetationIndices(data, MeshoptSimplifier);
      self.postMessage({id: data.id, indices, error}, {transfer: [indices.buffer]});
    }
  } catch (cause) { self.postMessage({id: data.id, error: cause instanceof Error ? cause.message : String(cause)}); }
};
