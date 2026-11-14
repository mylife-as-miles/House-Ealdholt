import type {QualifiedGeneratedFoliageNormalInput,prepareGeneratedFoliageNormals} from '../../../../shared/legacy/aethelgard/environment/generated-foliage-normal';
import type {VegetationAtlasRecord} from '../../../../shared/legacy/aethelgard/environment/vegetation-atlas';
import type {GrassGroundField, GrassGroundPatch} from '../../../../shared/legacy/aethelgard/environment/grass-ground-field';
import type {buildPackedVegetationGeometry} from '../../../../shared/legacy/aethelgard/environment/vegetation-packed-geometry';
export function createVegetationPreparationWorker(signal: AbortSignal) {
  const worker = new Worker(new URL('./vegetation-prepare.worker.ts', import.meta.url), {type: 'module', name: 'Crownfall vegetation preparation'});
  let serial = 0, disposed = false;
  const pending = new Map<number, {resolve: (value: any) => void; reject: (reason: unknown) => void}>();
  const dispose = () => {
    if (disposed) return; disposed = true; worker.terminate();
    for (const job of pending.values()) job.reject(Error('Vegetation preparation cancelled.'));
    pending.clear(); signal.removeEventListener('abort', dispose);
  };
  worker.onmessage = ({data}) => {
    const job = pending.get(data.id); if (!job) return; pending.delete(data.id);
    if (typeof data.error === 'string') job.reject(Error(data.error)); else job.resolve(data);
  };
  worker.onerror = event => {
    for (const job of pending.values()) job.reject(Error(event.message || 'Vegetation preparation worker failed.'));
    pending.clear(); dispose();
  };
  signal.addEventListener('abort', dispose, {once: true});
  function run<T>(data: object, transfer: Transferable[]): Promise<T> {
    if (signal.aborted || disposed) return Promise.reject(Error('Vegetation preparation retired.'));
    if (pending.size >= 16) return Promise.reject(Error('Vegetation preparation worker backlog exceeded.'));
    const id = serial++;
    return new Promise<T>((resolve, reject) => {pending.set(id, {resolve, reject}); worker.postMessage({...data, id}, transfer);});
  }
  return {
    simplify(input: {positions: Float32Array; attributes: Float32Array; indices: Uint32Array; stride: number; ratio: number; error: number; foliage: boolean; attributeWeights: number[]}) {
      return run<{indices: Uint32Array; error: number}>({kind: 'simplify', ...input}, [input.positions.buffer, input.attributes.buffer, input.indices.buffer]);
    },
    packed(input: Parameters<typeof buildPackedVegetationGeometry>[0]) {
      return run<Awaited<ReturnType<typeof buildPackedVegetationGeometry>>>({kind: 'packed', ...input}, [input.positions.buffer, input.attributes.buffer, input.indices.buffer]);
    },
    async mips(input: Omit<VegetationAtlasRecord, 'mips'> & {colour: Uint8Array; normal: Uint8Array}) {
      const {record} = await run<{record: VegetationAtlasRecord}>({kind: 'mips', input}, [input.colour.buffer, input.normal.buffer]); return record;
    },
    async ground(input: {resolution: number; bounds: readonly [number, number, number, number]; patches: readonly GrassGroundPatch[]}) {
      // Source atlas channels stay resident; structured clone preserves shared
      // patch-image references without detaching live GPU texture backing data.
      const {field} = await run<{field: GrassGroundField}>({kind: 'ground', input}, []); return field;
    },
    async foliageNormals(input:QualifiedGeneratedFoliageNormalInput) {
      const {record}=await run<{record:Awaited<ReturnType<typeof prepareGeneratedFoliageNormals>>}>({kind:'foliage-normal',input},[input.rgba.buffer]);return record;
    },
    dispose,
  };
}
export type VegetationPreparationWorker = ReturnType<typeof createVegetationPreparationWorker>;
