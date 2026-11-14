import { Box3, Mesh, SkinnedMesh, Texture, type Object3D, type Skeleton } from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { EALDHOLT_RESIDENT_PREVIEW_ID, loadVerifiedResidentPreviewGlb,
  type EaldholtResidentPreviewInput } from '../../../../shared/legacy/aethelgard/resident-preview-input';
import { createEaldholtResidentActors, type EaldholtResidentActors } from './resident-actors';
import { assertResidentPreviewTextures } from '../../../../shared/legacy/aethelgard/resident-preview-textures';

type Template = Pick<GLTF, 'scene' | 'animations'>;

/** Private proof coordinates are source metres, never a transform correction. */
export function ealdholtResidentPreviewSourceBounds(source: Object3D): Box3 {
  if (source.position.lengthSq() > 1e-16 || source.quaternion.angleTo(source.quaternion.clone().identity()) > 1e-8
    || Math.abs(source.scale.x - 1) > 1e-8 || Math.abs(source.scale.y - 1) > 1e-8 || Math.abs(source.scale.z - 1) > 1e-8) {
    throw Error('Resident preview requires the unchanged unit source root.');
  }
  source.updateMatrixWorld(true);
  if (source.parent || source.matrixWorld.elements.some((value, i) => !Number.isFinite(value)
    || Math.abs(value - (i % 5 === 0 ? 1 : 0)) > 1e-8)) throw Error('Resident preview requires the unchanged unit source matrix.');
  const bounds = new Box3().setFromObject(source);
  if (bounds.isEmpty() || ![...bounds.min.toArray(), ...bounds.max.toArray()].every(Number.isFinite)) throw Error('Resident preview source bounds are invalid.');
  return bounds;
}

export function assertEaldholtResidentPreviewContained(source: Box3, envelope: Box3): void {
  for (let axis = 0; axis < 3; axis++) {
    if (envelope.min.getComponent(axis) < source.min.getComponent(axis) - 1e-5
      || envelope.max.getComponent(axis) > source.max.getComponent(axis) + 1e-5) {
      throw Error('Resident preview idle envelope lies outside the unchanged source village.');
    }
  }
}

export interface EaldholtStandingResidentPreview {
  readonly object: EaldholtResidentActors['object']; readonly bounds: Box3;
  readonly meshes: ReadonlySet<Mesh>; readonly disposed: boolean;
  /** Presentation delta only. The caller supplies active frames; no world clock. */
  update(deltaSeconds: number, reducedMotion: boolean): void;
  dispose(): void;
}

/** Each parse is privately owned; actor clones borrow its immutable resources. */
export function disposeEaldholtResidentTemplate(template: Template): void {
  const geometries = new Set<Mesh['geometry']>(), materials = new Set<import('three').Material>();
  const textures = new Set<Texture>(), skeletons = new Set<Skeleton>(), images = new Set<ImageBitmap>();
  template.scene.traverse(node => {
    if (!(node instanceof Mesh)) return;
    geometries.add(node.geometry);
    if (node instanceof SkinnedMesh) skeletons.add(node.skeleton);
    for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
      materials.add(material);
      for (const value of Object.values(material)) if (value instanceof Texture) textures.add(value);
    }
  });
  for (const skeleton of skeletons) skeleton.dispose();
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) material.dispose();
  for (const texture of textures) {
    const image: unknown = texture.source?.data;
    if (typeof ImageBitmap !== 'undefined' && image instanceof ImageBitmap) images.add(image);
    texture.dispose();
  }
  for (const image of images) image.close();
  template.scene.removeFromParent();
}

/** Takes ownership even on qualification failure. No fallback resident or placement. */
export function createEaldholtStandingResidentPreview(template: Template,
  input: EaldholtResidentPreviewInput): EaldholtStandingResidentPreview {
  let actors: EaldholtResidentActors | null = null;
  try {
    const clips = template.animations.filter(clip => clip.name === input.idleClip);
    if (clips.length !== 1) throw Error('Resident preview requires exactly one named neutral idle clip.');
    actors = createEaldholtResidentActors(template, [{ residentId: EALDHOLT_RESIDENT_PREVIEW_ID,
      position: input.position, yawRadians: input.yawRadians, scale: 1 }], { clips: { idle: clips[0] } });
    const min = actors.bounds.min, max = actors.bounds.max;
    if (input.idleEnvelope.min.some((value, axis) => Math.abs(min.getComponent(axis) - value) > 1e-5)
      || input.idleEnvelope.max.some((value, axis) => Math.abs(max.getComponent(axis) - value) > 1e-5)) {
      throw Error('Resident preview complete idle envelope differs from its private proof.');
    }
    const ownedActors = actors, meshes = new Set<Mesh>();
    ownedActors.object.traverse(node => {
      if (node instanceof Mesh) { meshes.add(node); node.castShadow = true; node.receiveShadow = true; }
    });
    const frame = { clockSeconds: 0, paused: false, reducedMotion: false,
      residents: [{ residentId: EALDHOLT_RESIDENT_PREVIEW_ID, motion: 'idle' as const }] };
    let disposed = false;
    return { object: ownedActors.object, bounds: ownedActors.bounds, meshes,
      get disposed() { return disposed; },
      update(deltaSeconds, reducedMotion) {
        if (disposed) return;
        frame.reducedMotion = reducedMotion; ownedActors.update(deltaSeconds, frame);
      },
      dispose() {
        if (disposed) return; disposed = true;
        ownedActors.dispose(); disposeEaldholtResidentTemplate(template); meshes.clear();
      } };
  } catch (error) { actors?.dispose(); disposeEaldholtResidentTemplate(template); throw error; }
}

/** The parser receives the same exact bounded bytes that passed SHA verification. */
export async function loadEaldholtStandingResidentPreview(input: EaldholtResidentPreviewInput,
  signal: AbortSignal): Promise<EaldholtStandingResidentPreview> {
  const bytes = await loadVerifiedResidentPreviewGlb(input.actor, signal);
  signal.throwIfAborted();
  const template = await new GLTFLoader().parseAsync(bytes, new URL('.', input.actor.url).href);
  if (signal.aborted) { disposeEaldholtResidentTemplate(template); signal.throwIfAborted(); }
  try { assertResidentPreviewTextures(template); }
  catch (error) { disposeEaldholtResidentTemplate(template); throw error; }
  return createEaldholtStandingResidentPreview(template, input);
}
