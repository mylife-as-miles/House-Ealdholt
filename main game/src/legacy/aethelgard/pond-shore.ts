import { Box3, ClampToEdgeWrapping, DataTexture, InstancedMesh, LinearMipmapLinearFilter, LinearFilter,
  Matrix4, Mesh, MeshStandardMaterial, NoColorSpace, RGBAFormat, SkinnedMesh, UnsignedByteType, Vector3,
  type Material, type Object3D } from 'three';
import { isEaldholtPondProbeSurface } from '../../../../shared/legacy/aethelgard/environment/pond-probe';
import { EALDHOLT_POND_SHORE, qualifyEaldholtPondShore, createEaldholtPondShoreField,
  type PondShoreOutline } from '../../../../shared/legacy/aethelgard/environment/pond-shore';

type Role = 'pond' | 'terrain' | 'groundcover';
type Shader = { uniforms: Record<string, { value: unknown }>; vertexShader: string; fragmentShader: string };
type Assignment = { mesh: Mesh; original: Material | Material[]; assigned: Material | Material[]; slots: Material[] };
export interface EaldholtPondShore {
  readonly outline: PondShoreOutline;
  readonly materialCount: number; readonly pondMaterials: number; readonly terrainMaterials: number; readonly groundcoverMaterials: number;
  readonly textureCount: 1; readonly textureBytes: number; readonly extraDrawCalls: 0; readonly extraTriangles: 0;
  readonly field: { readonly width: number; readonly height: number; readonly bounds: { readonly min: readonly number[]; readonly max: readonly number[] }; readonly channels: Readonly<Record<string, string>>; readonly contact: ReturnType<typeof createEaldholtPondShoreField>['contact'] };
  readonly diagnostics: readonly { readonly mesh: string; readonly material: string; readonly reason: string }[];
  readonly frameValid: boolean;
  readonly disposed: boolean;
  dispose(): void;
}

function staticGeometry(mesh: Mesh): string | null {
  if (mesh instanceof SkinnedMesh || mesh.morphTargetInfluences?.length || mesh.geometry.morphAttributes.position?.length) return 'deformed geometry is unsupported';
  if ((mesh as Mesh & { isBatchedMesh?: boolean }).isBatchedMesh) return 'batched geometry is unsupported';
  const position = mesh.geometry.getAttribute('position');
  if (!position || position.itemSize !== 3 || !Number.isSafeInteger(position.count)) return 'finite XYZ positions are required';
  return null;
}

/** Drawn references only, in the model root's source-metre frame. The root's
 * complete world inverse removes Native presentation tilt/zoom/translation. */
function sourceTriangles(root: Object3D, inverseRoot: Matrix4, role: 'pond' | 'terrain', signal?: AbortSignal,
  bounds?: { min: readonly number[]; max: readonly number[] }): number[] {
  const result: number[] = [], point = new Vector3(), actorFrame = new Matrix4(), instance = new Matrix4();
  root.traverse(object => {
    if (!(object instanceof Mesh)) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    const selected = (material: Material) => roleOf(object, material, root) === role;
    if (!materials.some(selected)) return;
    signal?.throwIfAborted(); const unsupported = staticGeometry(object); if (unsupported) throw Error('Pond shore: ' + unsupported);
    const geometry = object.geometry, position = geometry.getAttribute('position'), index = geometry.index, count = index?.count ?? position.count;
    const draw = geometry.drawRange, groups = Array.isArray(object.material) ? geometry.groups : [{ start: 0, count, materialIndex: 0 }];
    const offsets: number[] = [], seen = new Set<number>();
    for (const group of groups) {
      const material = materials[group.materialIndex ?? 0]; if (!material) throw Error('Pond draw material is unavailable.');
      if (!selected(material)) continue;
      const start = Math.max(0, draw.start, group.start), end = Math.min(count, draw.start + draw.count, group.start + group.count);
      if (!Number.isInteger(start) || !Number.isInteger(end) || start % 3 || (end - start) % 3) throw Error('Pond requires complete drawn triangles.');
      for (let i = start; i < end; i += 3) { if (seen.has(i)) throw Error('Pond draw groups overlap.'); seen.add(i); offsets.push(i); }
    }
    const actors = object instanceof InstancedMesh ? object.count : 1;
    if (!Number.isSafeInteger(actors) || actors < 0 || object instanceof InstancedMesh && actors > object.instanceMatrix.count) throw Error('Pond instance capacity is invalid.');
    for (let actor = 0; actor < actors; actor++) {
      actorFrame.multiplyMatrices(inverseRoot, object.matrixWorld);
      if (object instanceof InstancedMesh) { object.getMatrixAt(actor, instance); actorFrame.multiply(instance); }
      if (!actorFrame.elements.every(Number.isFinite) || actorFrame.determinant() <= 0) throw Error('Pond transform must be finite and positive.');
      if (bounds) {
        const box = localBounds(object).applyMatrix4(actorFrame);
        if (box.max.x < bounds.min[0] || box.min.x > bounds.max[0] || box.max.z < bounds.min[1] || box.min.z > bounds.max[1]) continue;
      }
      for (const offset of offsets) {
        const triangle: number[] = [];
        for (let corner = 0; corner < 3; corner++) {
          const id = index ? index.getX(offset + corner) : offset + corner;
          if (!Number.isInteger(id) || id < 0 || id >= position.count) throw Error('Pond draw index is invalid.');
          point.fromBufferAttribute(position, id).applyMatrix4(actorFrame); triangle.push(point.x, point.y, point.z);
        }
        if (bounds && (Math.max(triangle[0], triangle[3], triangle[6]) < bounds.min[0]
          || Math.min(triangle[0], triangle[3], triangle[6]) > bounds.max[0]
          || Math.max(triangle[2], triangle[5], triangle[8]) < bounds.min[1]
          || Math.min(triangle[2], triangle[5], triangle[8]) > bounds.max[1])) continue;
        result.push(...triangle);
      }
    }
  });
  return result;
}

function localBounds(mesh: Mesh): Box3 {
  if (mesh.geometry.boundingBox) return mesh.geometry.boundingBox.clone();
  const box = new Box3(), point = new Vector3(), position = mesh.geometry.getAttribute('position');
  for (let i = 0; i < position.count; i++) box.expandByPoint(point.fromBufferAttribute(position, i));
  return box;
}

function actorRootUnsupported(mesh: Mesh, root: Object3D): string | null {
  let metadata: Record<string, unknown> | null = null;
  for (let node: Object3D | null = mesh; node && node !== root; node = node.parent) {
    const tag = node.userData.crownfallElderbloom;
    if (tag?.kind === 'groundcover') { metadata = tag; break; }
  }
  if (!metadata || metadata.referenceDetail !== true || !Number.isSafeInteger(metadata.sourceInstances) || Number(metadata.sourceInstances) < 1) return 'retained per-actor root metadata is unavailable';
  if (!(mesh instanceof InstancedMesh) && metadata.sourceInstances !== 1) return 'baked multi-actor groundcover has no per-clump root';
  if (mesh instanceof InstancedMesh && Number(metadata.sourceInstances) < mesh.count) return 'instance roots exceed their retained source pool';
  const box = localBounds(mesh);
  if (!Number.isFinite(box.min.y) || Math.abs(box.min.y) > .02) return 'groundcover local origin is not qualified near the stem base';
  return null;
}

function roleOf(mesh: Mesh, material: Material, root: Object3D): Role | null {
  if (isEaldholtPondProbeSurface(material)) return 'pond';
  for (let node: Object3D | null = mesh; node && node !== root; node = node.parent) {
    const kind = node.userData.crownfallElderbloom?.kind;
    if (kind === 'tree' || /BlackAlder|(?:^|[_ -])tree(?:[_ -]|$)/i.test(node.name)) return null;
    if (kind === 'terrain' || /^LandscapeComponent_\d+(?:_\d+)?$/.test(node.name)) return 'terrain';
    if (kind === 'groundcover' || /Grass_Clumps|(?:^|[_ -])flower[_ -]|SM_vmcob|SM_vgzte/i.test(node.name)) return 'groundcover';
  }
  return null;
}

function patchShore(shader: Shader, uniforms: Record<string, { value: unknown }>, role: Role): void {
  if (shader.fragmentShader.includes('CROWNFALL_POND_SHORE')) return;
  const required = [[shader.vertexShader, '#include <common>'], [shader.vertexShader, '#include <begin_vertex>'],
    [shader.fragmentShader, '#include <common>'], [shader.fragmentShader, '#include <metalnessmap_fragment>'],
    ...(role === 'groundcover' ? [[shader.fragmentShader, '#include <alphatest_fragment>']] : [])];
  if (required.some(([source, chunk]) => !source.includes(chunk))) throw Error('Pond shore requires standard PBR shader chunks.');
  Object.assign(shader.uniforms, uniforms);
  const rootVarying = role === 'groundcover' ? '\nvarying vec3 vEaldholtPondShoreActorRoot;' : '';
  shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>
varying vec3 vEaldholtPondShoreSource;
uniform mat4 uEaldholtPondShoreWorldToSource;${rootVarying}`);
  shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
vec4 ealdholtShorePosition = vec4(transformed, 1.);
#ifdef USE_INSTANCING
  ealdholtShorePosition = instanceMatrix * ealdholtShorePosition;
#endif
vEaldholtPondShoreSource = (uEaldholtPondShoreWorldToSource * modelMatrix * ealdholtShorePosition).xyz;
${role === 'groundcover' ? `vec4 ealdholtShoreActor = vec4(0., 0., 0., 1.);
#ifdef USE_INSTANCING
  ealdholtShoreActor = instanceMatrix * ealdholtShoreActor;
#endif
vEaldholtPondShoreActorRoot = (uEaldholtPondShoreWorldToSource * modelMatrix * ealdholtShoreActor).xyz;` : ''}`);
  shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
#define CROWNFALL_POND_SHORE
varying vec3 vEaldholtPondShoreSource;${rootVarying}
uniform sampler2D uEaldholtPondShoreField;
uniform vec4 uEaldholtPondShoreBounds;
uniform float uEaldholtPondShoreHeight;
uniform float uEaldholtPondShoreEnabled;
vec4 ealdholtPondShoreMask(vec3 sourcePoint) {
  vec2 uv = (sourcePoint.xz - uEaldholtPondShoreBounds.xy) / uEaldholtPondShoreBounds.zw;
  if (uEaldholtPondShoreEnabled < .5 || any(lessThan(uv, vec2(0.))) || any(greaterThan(uv, vec2(1.)))) return vec4(0.);
  return texture2D(uEaldholtPondShoreField, uv);
}`);
  const effect = role === 'pond' ? `
// Art-directed diffuse shallow appearance; no bathymetry, specular or Fresnel change.
vec3 ealdholtShoreFace = normalize(cross(dFdx(vEaldholtPondShoreSource), dFdy(vEaldholtPondShoreSource)));
float ealdholtShoreTop = step(.99999, abs(ealdholtShoreFace.y)) * (1. - step(.00011, abs(vEaldholtPondShoreSource.y - uEaldholtPondShoreHeight)));
float ealdholtShallow = ealdholtPondShoreMask(vEaldholtPondShoreSource).g * ealdholtShoreTop;
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.044, .071, .065), .22 * ealdholtShallow);`
    : role === 'terrain' ? `
float ealdholtShoreHeightGate = 1. - smoothstep(.15, .5, abs(vEaldholtPondShoreSource.y - uEaldholtPondShoreHeight));
float ealdholtDamp = ealdholtPondShoreMask(vEaldholtPondShoreSource).r * ealdholtShoreHeightGate;
diffuseColor.rgb *= mix(vec3(1.), vec3(.73, .75, .72), ealdholtDamp);
roughnessFactor = mix(roughnessFactor, min(roughnessFactor, .54), .65 * ealdholtDamp);` : '';
  if (effect) shader.fragmentShader = shader.fragmentShader.replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>' + effect);
  if (role === 'groundcover') shader.fragmentShader = shader.fragmentShader.replace('#include <alphatest_fragment>', `
// Every vertex of a retained actor shares this root: remove a complete
// selected clump, never only stems. Higher/dry bank roots remain untouched.
float ealdholtShoreRootHeight = vEaldholtPondShoreActorRoot.y - uEaldholtPondShoreHeight;
float ealdholtShoreRootGate = step(-.02, ealdholtShoreRootHeight) * step(ealdholtShoreRootHeight, .12);
float ealdholtShoreBreak = ealdholtPondShoreMask(vEaldholtPondShoreActorRoot).b * ealdholtShoreRootGate;
if (ealdholtShoreBreak > .25) discard;
#include <alphatest_fragment>`);
}

function nearField(mesh: Mesh, inverseRoot: Matrix4, field: ReturnType<typeof createEaldholtPondShoreField>): boolean {
  const local = localBounds(mesh);
  if (local.isEmpty() || ![...local.min.toArray(), ...local.max.toArray()].every(Number.isFinite)) return false;
  const source = new Box3(), actor = new Box3(), frame = new Matrix4(), instance = new Matrix4();
  const count = mesh instanceof InstancedMesh ? mesh.count : 1;
  if (!Number.isSafeInteger(count) || count < 0 || mesh instanceof InstancedMesh && count > mesh.instanceMatrix.count) return false;
  for (let i = 0; i < count; i++) {
    frame.multiplyMatrices(inverseRoot, mesh.matrixWorld);
    if (mesh instanceof InstancedMesh) { mesh.getMatrixAt(i, instance); frame.multiply(instance); }
    if (!frame.elements.every(Number.isFinite) || frame.determinant() <= 0) return false;
    actor.copy(local).applyMatrix4(frame); source.union(actor);
  }
  return !source.isEmpty() && source.max.x >= field.bounds.min[0] && source.min.x <= field.bounds.max[0]
    && source.max.z >= field.bounds.min[1] && source.min.z <= field.bounds.max[1]
    && source.max.y >= field.waterHeight - .5 && source.min.y <= field.waterHeight + .5;
}

const shoreOwners = new WeakMap<Mesh, object>();
/** Own only this optional material/field layer. Apply after neutral fill and
 * before planar reflection; dispose after planar and before neutral fill. */
export function applyEaldholtPondShore(root: Object3D, options: { signal?: AbortSignal } = {}): EaldholtPondShore {
  options.signal?.throwIfAborted(); root.updateWorldMatrix(true, true);
  if (!root.matrixWorld.elements.every(Number.isFinite) || root.matrixWorld.determinant() <= 0) throw Error('Pond root transform must be finite and positive.');
  const worldToSource = new Matrix4().copy(root.matrixWorld).invert();
  const outline = qualifyEaldholtPondShore(sourceTriangles(root, worldToSource, 'pond', options.signal));
  const margin = EALDHOLT_POND_SHORE.outsideMetres;
  const bounds = { min: [outline.bounds.min[0] - margin, outline.bounds.min[1] - margin], max: [outline.bounds.max[0] + margin, outline.bounds.max[1] + margin] };
  const terrain = sourceTriangles(root, worldToSource, 'terrain', options.signal, bounds);
  if (!terrain.length) throw Error('Pond shore requires drawn Landscape contact support.');
  const field = createEaldholtPondShoreField(outline, terrain);
  if (field.byteLength > 96 * 1024 || field.data.length !== field.width * field.height * 4) throw Error('Pond shore field exceeds its RGBA8 budget.');
  const token = {}, assignments: Assignment[] = [], reserved = new Set<Mesh>(), owned = new Set<MeshStandardMaterial>();
  const inverse = new Map<Material, Material>(), cache = new Map<Material, Map<Role, MeshStandardMaterial>>();
  const diagnostics: { mesh: string; material: string; reason: string }[] = [], counts = { pond: 0, terrain: 0, groundcover: 0 };
  let texture: DataTexture | null = null, disposed = false, frameValid = true;
  const enabled = { value: 1 };
  function refreshFrame(): void {
    root.updateWorldMatrix(true, false);
    frameValid = root.matrixWorld.elements.every(Number.isFinite) && root.matrixWorld.determinant() > 0;
    enabled.value = frameValid ? 1 : 0;
    if (frameValid) worldToSource.copy(root.matrixWorld).invert();
  }
  function release(): void {
    let failure: unknown;
    for (const assignment of assignments) try {
      const current = assignment.mesh.material;
      const pristine = current === assignment.assigned && (!Array.isArray(current) || current.length === assignment.slots.length && current.every((m, i) => m === assignment.slots[i]));
      if (pristine) assignment.mesh.material = assignment.original;
      else if (Array.isArray(current)) {
        const restored = current.map(material => inverse.get(material) ?? material);
        if (restored.some((material, i) => material !== current[i])) assignment.mesh.material = restored;
      } else if (inverse.has(current)) assignment.mesh.material = inverse.get(current)!;
    } catch (error) { failure ??= error; }
    for (const material of [...owned]) try { owned.delete(material); material.dispose(); } catch (error) { failure ??= error; }
    if (texture) { const current = texture; texture = null; try { current.dispose(); } catch (error) { failure ??= error; } }
    for (const mesh of reserved) if (shoreOwners.get(mesh) === token) shoreOwners.delete(mesh);
    reserved.clear(); assignments.length = 0; inverse.clear(); cache.clear();
    if (failure) throw failure;
  }
  try {
    texture = new DataTexture(field.data, field.width, field.height, RGBAFormat, UnsignedByteType);
    texture.name = 'Owned Ealdholt pond shore linear masks'; texture.colorSpace = NoColorSpace; texture.flipY = false;
    texture.wrapS = texture.wrapT = ClampToEdgeWrapping; texture.magFilter = LinearFilter; texture.minFilter = LinearMipmapLinearFilter;
    texture.unpackAlignment = 1; texture.generateMipmaps = false;
    texture.mipmaps = field.mipmaps.map(level => ({ data: level.data, width: level.width, height: level.height })); texture.needsUpdate = true;
    const uniforms = { uEaldholtPondShoreField: { value: texture }, uEaldholtPondShoreWorldToSource: { value: worldToSource },
      uEaldholtPondShoreBounds: { value: [field.bounds.min[0], field.bounds.min[1], field.bounds.max[0] - field.bounds.min[0], field.bounds.max[1] - field.bounds.min[1]] },
      uEaldholtPondShoreHeight: { value: outline.height }, uEaldholtPondShoreEnabled: enabled };
    root.traverse(object => {
      if (!(object instanceof Mesh)) return;
      options.signal?.throwIfAborted();
      const original = object.material, slots = Array.isArray(original) ? [...original] : [original];
      const next = slots.map(material => {
        const role = roleOf(object, material, root); if (!role) return material;
        const reason = staticGeometry(object) ?? (!(material instanceof MeshStandardMaterial) ? 'non-PBR material' : material.displacementMap ? 'displaced geometry' : null)
          ?? (role === 'groundcover' && (material.alphaTest <= 0 || material.transparent || material.alphaHash || object.castShadow) ? 'groundcover requires an ordinary non-shadow-casting alpha mask' : null);
        const rootReason = role === 'groundcover' && !reason ? actorRootUnsupported(object, root) : null;
        if (reason || rootReason) { diagnostics.push({ mesh: object.name, material: material.name, reason: reason ?? rootReason! }); return material; }
        if (!nearField(object, worldToSource, field)) return material;
        if (shoreOwners.has(object) && shoreOwners.get(object) !== token) throw Error('Pond shore ownership is already active.');
        if (!reserved.has(object)) { shoreOwners.set(object, token); reserved.add(object); }
        let byRole = cache.get(material); if (!byRole) { byRole = new Map(); cache.set(material, byRole); }
        const existing = byRole.get(role); if (existing) return existing;
        const clone = material.clone() as MeshStandardMaterial;
        if (clone === material || !(clone instanceof MeshStandardMaterial)) throw Error('Pond shore requires an independent PBR clone.');
        owned.add(clone); inverse.set(clone, material);
        const compile = material.onBeforeCompile, render = material.onBeforeRender, key = material.customProgramCacheKey;
        clone.onBeforeCompile = function (shader, renderer) { compile.call(this, shader, renderer); patchShore(shader, uniforms, role); };
        clone.onBeforeRender = function (renderer, scene, camera, geometry, mesh, group) { render.call(this, renderer, scene, camera, geometry, mesh, group); refreshFrame(); };
        clone.customProgramCacheKey = () => key.call(material) + ':ealdholt-pond-shore:v2-contact-root:' + role;
        clone.userData = { ...clone.userData, crownfallPondShore: { role, artDirectedAppearance: true, recoveredDepth: false,
          rootLocalProjection: true, contactDriven: true, wholeClumpRoot: role === 'groundcover' } };
        clone.needsUpdate = true; byRole.set(role, clone); counts[role]++; return clone;
      });
      if (!next.some((material, i) => material !== slots[i])) return;
      if (object.material !== original || Array.isArray(original) && original.some((material, i) => material !== slots[i])) throw Error('Pond shore assignment changed during staging.');
      const assigned = Array.isArray(original) ? next : next[0]; object.material = assigned;
      assignments.push({ mesh: object, original, assigned, slots: next.slice() });
    });
    options.signal?.throwIfAborted();
    if (!counts.pond) throw Error('Qualified pond has no supported drawn PBR surface.');
    return { outline, materialCount: owned.size, pondMaterials: counts.pond, terrainMaterials: counts.terrain, groundcoverMaterials: counts.groundcover,
      textureCount: 1, textureBytes: field.byteLength, extraDrawCalls: 0, extraTriangles: 0,
      field: { width: field.width, height: field.height, bounds: field.bounds, channels: field.channels, contact: field.contact }, diagnostics: Object.freeze(diagnostics),
      get frameValid() { return frameValid; }, get disposed() { return disposed; }, dispose() { if (disposed) return; disposed = true; release(); } };
  } catch (error) { try { release(); } catch (cleanupFailure) { throw Object.assign(Error('Pond shore setup and cleanup failed.'), { cause: error, cleanupFailure }); } throw error; }
}
