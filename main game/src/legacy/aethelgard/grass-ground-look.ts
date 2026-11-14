/** Source footprint field on the existing Landscape materials. It adds no
 * terrain, plants or collisions, and never paints buildings, roads or water
 * meshes. Only the source plants' captured alpha footprints affect the ground. */
import {DataTexture, FloatType, LinearFilter, LinearMipmapLinearFilter, LinearSRGBColorSpace, Matrix4, Mesh,
  MeshStandardMaterial, NearestFilter, RedFormat, RGBAFormat, Vector3, Vector4, type Camera, type Object3D} from 'three';
import type {WorldPreparationQueue} from '../../../../shared/legacy/aethelgard/environment/world-preparation-queue';
import type {VegetationPreparationWorker} from './vegetation-worker';
import type {VegetationCellHlod} from './vegetation-cell-hlod';

export function createGrassGroundLook(source: Object3D, cells: readonly VegetationCellHlod[], options: {
  worker: VegetationPreparationWorker; queue: WorldPreparationQueue; signal: AbortSignal;
  renderer: {initTexture(texture: DataTexture): void}; changed(): void; native?: boolean;
}) {
  const controller = new AbortController(), signal = controller.signal, abort = () => controller.abort();
  options.signal.addEventListener('abort', abort, {once: true}); if (options.signal.aborted) abort();
  const assignments: {mesh: Mesh; original: Mesh['material']; assigned: Mesh['material']}[] = [];
  const materials = new Map<MeshStandardMaterial, MeshStandardMaterial>(), textures: DataTexture[] = [];
  const inverse = {value: new Matrix4()}, eye = {value: new Vector3()}, bounds = {value: new Vector4()}, projection = {value: 1};
  let disposed = false;
  const stats = {status: 'preparing' as 'preparing' | 'ready' | 'error' | 'empty', error: '', patches: 0, texturesBytes: 0, materials: 0};
  function bind(original: MeshStandardMaterial) {
    const cached = materials.get(original); if (cached) return cached;
    const material = original.clone(), compile = original.onBeforeCompile, key = original.customProgramCacheKey;
    material.onBeforeCompile = function(shader, renderer) {
      compile.call(this, shader, renderer);
      Object.assign(shader.uniforms, {crownfallGrassSourceInverse: inverse, crownfallGrassEye: eye, crownfallGrassBounds: bounds,
        crownfallGrassProjection: projection, crownfallGrassColour: {value: textures[0]}, crownfallGrassNormal: {value: textures[1]}, crownfallGrassHeight: {value: textures[2]}});
      const vertex = '#include <worldpos_vertex>', colour = '#include <color_fragment>', normal = '#include <normal_fragment_maps>';
      if ([vertex].some(token => shader.vertexShader.split(token).length !== 2) || [colour, normal].some(token => shader.fragmentShader.split(token).length !== 2)) throw Error('Unsupported source grass terrain shader.');
      shader.vertexShader = 'uniform mat4 crownfallGrassSourceInverse; varying vec3 vCrownfallGrassPosition;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace(vertex, vertex + '\nvCrownfallGrassPosition=(crownfallGrassSourceInverse*modelMatrix*vec4(transformed,1.)).xyz;');
      shader.fragmentShader = `uniform sampler2D crownfallGrassColour; uniform sampler2D crownfallGrassNormal; uniform sampler2D crownfallGrassHeight;
uniform mat4 crownfallGrassSourceInverse; uniform vec3 crownfallGrassEye; uniform vec4 crownfallGrassBounds;
uniform float crownfallGrassProjection; varying vec3 vCrownfallGrassPosition;\n` + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace(colour, colour + `
vec2 crownfallGrassUV=(vCrownfallGrassPosition.xz-crownfallGrassBounds.xy)/crownfallGrassBounds.zw;
vec4 crownfallGrassSample=texture2D(crownfallGrassColour,clamp(crownfallGrassUV,0.,1.));
float crownfallGrassInside=step(0.,crownfallGrassUV.x)*step(0.,crownfallGrassUV.y)*step(crownfallGrassUV.x,1.)*step(crownfallGrassUV.y,1.);
float crownfallGrassHeightMatch=1.-smoothstep(.35,.65,abs(vCrownfallGrassPosition.y-texture2D(crownfallGrassHeight,clamp(crownfallGrassUV,0.,1.)).r));
float crownfallGrassElevation=smoothstep(.45,.8,abs(vCrownfallGrassPosition.y-crownfallGrassEye.y)/max(1.,distance(vCrownfallGrassPosition,crownfallGrassEye)));
float crownfallGrassWeight=crownfallGrassInside*crownfallGrassHeightMatch*crownfallGrassSample.a*smoothstep(mix(142.,35.,crownfallGrassElevation),mix(168.,65.,crownfallGrassElevation),distance(vCrownfallGrassPosition,crownfallGrassEye)*crownfallGrassProjection);
diffuseColor.rgb=mix(diffuseColor.rgb,crownfallGrassSample.rgb,crownfallGrassWeight*.8);`);
      shader.fragmentShader = shader.fragmentShader.replace(normal, normal + `
vec3 crownfallGrassN=texture2D(crownfallGrassNormal,clamp(crownfallGrassUV,0.,1.)).rgb*2.-1.;
vec3 crownfallGrassViewN=normalize(mat3(viewMatrix)*transpose(mat3(crownfallGrassSourceInverse))*crownfallGrassN);
normal=normalize(mix(normal,crownfallGrassViewN,crownfallGrassWeight*.15));`);
    };
    material.customProgramCacheKey = () => key.call(original) + ':source-grass-ground-v2-elevation';
    material.onBeforeRender = original.onBeforeRender; materials.set(original, material); return material;
  }
  const preparation = (async () => {
    const patches = (await Promise.all(cells.map(cell => cell.groundPatches))).flat(); signal.throwIfAborted();
    if (!patches.length) {stats.status = 'empty'; return;}
    source.updateWorldMatrix(true, true);
    const fieldBounds: [number, number, number, number] = [Infinity, Infinity, -Infinity, -Infinity];
    for (const patch of patches) {
      const m = patch.matrix, b = patch.bounds;
      for (let corner = 0; corner < 4; corner++) {
        const x = corner & 1 ? b[2] : b[0], z = corner & 2 ? b[3] : b[1], wx = m[0] * x + m[8] * z + m[12], wz = m[2] * x + m[10] * z + m[14];
        fieldBounds[0] = Math.min(fieldBounds[0], wx); fieldBounds[1] = Math.min(fieldBounds[1], wz);
        fieldBounds[2] = Math.max(fieldBounds[2], wx); fieldBounds[3] = Math.max(fieldBounds[3], wz);
      }
    }
    const field = await options.worker.ground({resolution: options.native ? 256 : 512, bounds: fieldBounds, patches}); signal.throwIfAborted();
    for (const [channel, pixels] of [field.colour, field.normal].entries()) {
      const texture = new DataTexture(pixels, field.resolution, field.resolution, RGBAFormat); textures.push(texture);
      texture.magFilter = LinearFilter; texture.minFilter = LinearMipmapLinearFilter; texture.generateMipmaps = true;
      if (channel === 0) texture.colorSpace = LinearSRGBColorSpace; texture.needsUpdate = true;
      const bytes = Math.ceil(pixels.byteLength * 4 / 3); stats.texturesBytes += bytes;
      await options.queue.enqueue({bytes, signal, priority: () => 90, work: () => options.renderer.initTexture(texture)});
    }
    const height = new DataTexture(field.height, field.resolution, field.resolution, RedFormat, FloatType); textures.push(height);
    height.magFilter = height.minFilter = NearestFilter; height.generateMipmaps = false; height.needsUpdate = true;
    stats.texturesBytes += field.height.byteLength;
    await options.queue.enqueue({bytes: field.height.byteLength, signal, priority: () => 90, work: () => options.renderer.initTexture(height)});
    signal.throwIfAborted(); if (disposed) return;
    bounds.value.set(field.bounds[0], field.bounds[1], field.bounds[2] - field.bounds[0], field.bounds[3] - field.bounds[1]);
    source.traverse(object => {if (object instanceof Mesh && /LandscapeComponent/.test(object.name)) {
      const original = object.material, assigned = Array.isArray(original) ? original.map(m => m instanceof MeshStandardMaterial ? bind(m) : m) : original instanceof MeshStandardMaterial ? bind(original) : original;
      assignments.push({mesh: object, original, assigned}); object.material = assigned;
    }});
    if (!assignments.length) throw Error('Source grass field has no compatible authored terrain material.');
    stats.patches = field.sourcePatches; stats.materials = materials.size; stats.status = 'ready';
    for (const cell of cells) cell.groundReady(); options.changed();
  })().catch(cause => {if (!disposed && !signal.aborted) {stats.status = 'error'; stats.error = cause instanceof Error ? cause.message : String(cause); options.changed();}});
  return {stats, preparation,
    update(camera: Camera, quality: 'low' | 'medium' | 'high') {
      source.updateWorldMatrix(true, false); inverse.value.copy(source.matrixWorld).invert();
      eye.value.setFromMatrixPosition(camera.matrixWorld).applyMatrix4(inverse.value);
      projection.value = 1 / Math.max(1e-6, Math.abs(camera.projectionMatrix.elements[5])) / Math.tan(Math.PI / 6)
        / ((quality === 'low' ? .7 : quality === 'high' ? 1.25 : 1) * (options.native ? .65 : 1));
    },
    dispose() {
      if (disposed) return; disposed = true; controller.abort(); options.signal.removeEventListener('abort', abort);
      for (const entry of assignments) if (entry.mesh.material === entry.assigned) entry.mesh.material = entry.original;
      void preparation.then(() => {for (const material of materials.values()) material.dispose(); for (const texture of textures) texture.dispose();});
    },
  };
}
export type GrassGroundLook = ReturnType<typeof createGrassGroundLook>;
