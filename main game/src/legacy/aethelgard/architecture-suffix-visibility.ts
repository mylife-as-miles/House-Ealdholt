import {Box3, BufferAttribute, Frustum, InstancedMesh, Matrix4, MeshStandardMaterial, Object3D, PerspectiveCamera, Sphere,
  WebGLCoordinateSystem, type Camera, type Scene, type WebGLRenderer} from 'three';
import {createArchitectureSuffixRenderScope} from '../../../../shared/legacy/aethelgard/environment/architecture-suffix-render-scope';
import {staticSourceBounds} from './static-source-bounds';
import {hasKnownStaticPbrHooks} from './static-pbr-hooks';

// Exact source proof: node1289 contains16 positive instances plus an ordinary
// repaired child1303. This first slice never touches that child or other cells.
const SOURCE = '3b02834505642a5a9e7535e92812df8e565b99005e9921d41be83be4f5da3b28';
const NAME = 'duvar_cell_-1_0', COUNT = 16, TRIANGLES = 17781;
export function createAuthoredArchitectureSuffixVisibility(options: {
  sourceRoot: Object3D; sourceSha256?: string; renderer: WebGLRenderer; scene: Scene; camera: Camera;
  active?(): boolean;
}) {
  let scopeStats: ReturnType<typeof createArchitectureSuffixRenderScope>['stats'] | null = null, registeredCount = 0;
  const stats = {version: 'duvar-source-suffix-v1', status: 'held', reason: '', sourceSha256: options.sourceSha256 ?? '',
    source: NAME, sourceInstances: 0, retainedMatrixBytes: 0, actorBounds: 0, maximumBoundsTests: COUNT,
    boundsTests: 0, get prefixInstances() {return registeredCount - (scopeStats?.lastOmittedInstances ?? 0);},
    get potentialOmittedTriangles() {return (scopeStats?.lastOmittedInstances ?? 0) * TRIANGLES;},
    get scope() {return scopeStats;}};
  const fallback = (reason: string) => {stats.reason = reason; return {stats, dispose() {stats.status = 'disposed';}};};
  if (options.sourceSha256 !== SOURCE) return fallback('unqualified-source-retains-full-rendering');
  const candidate = options.sourceRoot.getObjectByName(NAME);
  if (!(candidate instanceof InstancedMesh)) return fallback('missing-qualified-instance-cell');
  const source = candidate, geometry = source.geometry, candidatePosition = geometry.getAttribute('position'), candidateIndex = geometry.index;
  const attribute = source.instanceMatrix;
  if (source.userData.crownfallElderbloom?.kind !== 'architecture' || source.count !== COUNT || attribute.count !== COUNT
    || !(attribute.array instanceof Float32Array) || attribute.array.length !== COUNT * 16
    || !(candidatePosition instanceof BufferAttribute) || candidatePosition.count !== 10450 || !candidateIndex || candidateIndex.count !== TRIANGLES * 3
    || geometry.drawRange.start !== 0 || geometry.drawRange.count < candidateIndex.count || geometry.groups.length
    || source.instanceColor || source.morphTexture || Object.keys(geometry.morphAttributes).length
    || Object.values(geometry.attributes).some(a => a === null || typeof a !== 'object' || 'isInstancedBufferAttribute' in a)
    || Array.isArray(source.material) || source.onBeforeRender !== Object3D.prototype.onBeforeRender) return fallback('unsupported-source-attributes');
  const position = candidatePosition, index = candidateIndex;
  const material = source.material;
  if (!hasKnownStaticPbrHooks(material)) return fallback('untrusted-material-hooks-retain-full-rendering');
  const materialVersion = material.version, compile = material.onBeforeCompile, render = material.onBeforeRender, key = material.customProgramCacheKey;
  const matrixArray = attribute.array, matrices = new Float32Array(matrixArray), positionArray = position.array, indexArray = index.array;
  const attributes = new Map(Object.entries(geometry.attributes));
  const matrixVersion = attribute.version, positionVersion = position.version, indexVersion = index.version;
  if (!matrices.every(Number.isFinite)) return fallback('invalid-source-matrices');
  const matrix = new Matrix4(), projection = new Matrix4(), frustum = new Frustum(), box = new Box3();
  const local = staticSourceBounds(geometry), actorBounds: Box3[] = [], full = new Box3();
  for (let id = 0; id < COUNT; id++) {
    const b = local.clone().applyMatrix4(matrix.fromArray(matrices, id * 16));
    if (b.isEmpty() || ![...b.min.toArray(), ...b.max.toArray()].every(Number.isFinite)) return fallback('invalid-source-bounds');
    actorBounds.push(b); full.union(b);
  }
  // A renderer computing its first instance bound while count is trimmed would
  // permanently omit later actors. Populate any missing bound from ALL actors
  // before installing the scope, without touching borrowed geometry bounds.
  const priorBox = source.boundingBox, priorSphere = source.boundingSphere;
  const ownedBox = priorBox ? null : full.clone(), ownedSphere = priorSphere ? null : full.getBoundingSphere(new Sphere());
  if (ownedBox) source.boundingBox = ownedBox; if (ownedSphere) source.boundingSphere = ownedSphere;
  let disposed = false, invalidSource = false;
  const restoreBounds = () => {
    if (ownedBox && source.boundingBox === ownedBox) source.boundingBox = priorBox;
    if (ownedSphere && source.boundingSphere === ownedSphere) source.boundingSphere = priorSphere;
  };
  function sourceUnchanged() {
    if (invalidSource) return false;
    let valid = source.geometry === geometry && geometry.getAttribute('position') === position && geometry.index === index
      && position.array === positionArray && index!.array === indexArray && position.version === positionVersion && index!.version === indexVersion
      && source.instanceMatrix === attribute && attribute.array === matrixArray && attribute.array.length === matrices.length && attribute.version === matrixVersion
      && attribute.count === COUNT && geometry.drawRange.start === 0 && geometry.drawRange.count >= index!.count
      && !geometry.groups.length && !source.instanceColor && !source.morphTexture && source.onBeforeRender === Object3D.prototype.onBeforeRender;
    let attributeCount = 0;
    for (const name in geometry.attributes) {attributeCount++; if (attributes.get(name) !== geometry.attributes[name]) valid = false;}
    if (attributeCount !== attributes.size) valid = false;
    for (const _name in geometry.morphAttributes) valid = false;
    for (let i = 0; valid && i < matrices.length; i++) valid = attribute.array[i] === matrices[i];
    if (!valid) {invalidSource = true; restoreBounds(); stats.reason = 'changed-source-retains-full-rendering';}
    return valid;
  }
  function staticMaterial() {
    return source.material === material && material.version === materialVersion && material.onBeforeCompile === compile
      && material.onBeforeRender === render && material.customProgramCacheKey === key && hasKnownStaticPbrHooks(material)
      && material instanceof MeshStandardMaterial && !material.transparent && material.opacity === 1 && material.alphaTest === 0
      && !material.displacementMap && !material.userData.crownfallWindBinding && !source.userData.crownfallVegetationWind;
  }
  function heldReason() {
    stats.boundsTests = 0;
    if (disposed || options.active && !options.active()) return 'inactive-full-source';
    if (options.renderer.xr?.isPresenting !== false) return 'xr-full-source';
    if (options.renderer.shadowMap?.enabled !== false) return 'shadow-full-source';
    if (options.renderer.getRenderTarget() !== null) return 'offscreen-full-source';
    if (!(options.camera instanceof PerspectiveCamera) || 'isArrayCamera' in options.camera
      || options.camera.coordinateSystem !== WebGLCoordinateSystem) return 'unsupported-camera-full-source';
    if (!staticMaterial()) return 'unsupported-material-full-source';
    return null;
  }
  const scope = createArchitectureSuffixRenderScope({renderer: options.renderer, scene: options.scene, camera: options.camera,
    heldReason, bindings: [{source, selectPrefix() {
      if (!sourceUnchanged()) return null;
      source.updateWorldMatrix(true, false); options.camera.updateWorldMatrix(true, false);
      if (!source.matrixWorld.elements.every(Number.isFinite) || !options.camera.projectionMatrix.elements.every(Number.isFinite)
        || !options.camera.matrixWorldInverse.elements.every(Number.isFinite) || Math.abs(source.matrixWorld.determinant()) < 1e-12) {
        stats.reason = 'invalid-transform-full-source'; return null;
      }
      projection.multiplyMatrices(options.camera.projectionMatrix, options.camera.matrixWorldInverse);
      frustum.setFromProjectionMatrix(projection);
      let prefix = COUNT;
      for (; prefix > 0; prefix--) {
        stats.boundsTests++;
        box.copy(actorBounds[prefix - 1]).applyMatrix4(source.matrixWorld).expandByScalar(.02);
        if (frustum.intersectsBox(box)) break;
      }
      return prefix;
    }}]});
  scopeStats = scope.stats; stats.sourceInstances = registeredCount = COUNT; stats.retainedMatrixBytes = matrices.byteLength; stats.actorBounds = COUNT;
  stats.status = scope.stats.status === 'ready' ? 'ready' : 'held'; if (stats.status === 'held') stats.reason = scope.stats.reason;
  return {stats, dispose() {if (disposed) return; disposed = true; scope.dispose(); restoreBounds(); stats.status = 'disposed';}};
}
export type AuthoredArchitectureSuffixVisibility = ReturnType<typeof createAuthoredArchitectureSuffixVisibility>;
