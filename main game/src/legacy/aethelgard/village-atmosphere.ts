import { BackSide, DataTexture, Group, InstancedMesh, LinearFilter, LinearMipmapLinearFilter, Matrix4, Mesh, NoColorSpace, RepeatWrapping, RGBAFormat, ShaderMaterial, SphereGeometry, UnsignedByteType, Vector3, type Object3D, type Texture } from 'three';
import { createEaldholtCloudPixels, EALDHOLT_CLOUDS, EALDHOLT_CLOUD_VERTEX, EALDHOLT_CLOUD_FRAGMENT } from '../../../../shared/legacy/aethelgard/environment/atmosphere';
import { createEaldholtFarProjectionData, EALDHOLT_FAR_SOURCE_SUN, EALDHOLT_FAR_ATMOSPHERE_VERTEX, EALDHOLT_FAR_ATMOSPHERE_FRAGMENT, type EaldholtFarProjectionDiagnostics } from '../../../../shared/legacy/aethelgard/environment/far-surround-projection';
import type { EaldholtFarProjectionPacket } from '../../../../shared/legacy/aethelgard/environment/far-surround';
import { createEaldholtFarBoundary, packEaldholtFarBoundary } from '../../../../shared/legacy/aethelgard/environment/far-projection-boundary';
import type { EaldholtWoodlandSurface } from '../../../../shared/legacy/aethelgard/environment/river-woodland';

function farTerrain(source: Object3D): EaldholtWoodlandSurface[] {
  source.updateWorldMatrix(true, true);
  const inverse = source.matrixWorld.clone().invert(), identity = new Matrix4(), point = new Vector3(), instance = new Matrix4(), surfaces: EaldholtWoodlandSurface[] = [];
  source.traverse(object => {
    if (!(object instanceof Mesh) || !(object.userData.crownfallElderbloom?.kind === 'terrain' || /^LandscapeComponent_\d+(?:_\d+)?$/.test(object.name))) return;
    const p = object.geometry.getAttribute('position'); if (!p) throw Error('Far boundary terrain has no positions.');
    const base = new Matrix4().multiplyMatrices(inverse, object.matrixWorld);
    if (base.elements.every((v, i) => Math.abs(v - identity.elements[i]) < 1e-11)) base.identity();
    const count = object instanceof InstancedMesh ? object.instanceMatrix.count : 1;
    for (let copy = 0; copy < count; copy++) {
      const frame = base.clone(); if (object instanceof InstancedMesh) { object.getMatrixAt(copy, instance); frame.multiply(instance); }
      const positions = new Float64Array(p.count * 3);
      for (let i = 0; i < p.count; i++) { point.fromBufferAttribute(p, i).applyMatrix4(frame); positions[i * 3] = point.x; positions[i * 3 + 1] = point.y; positions[i * 3 + 2] = point.z; }
      surfaces.push({ positions, indices: object.geometry.index?.array ?? Uint32Array.from({ length: p.count }, (_, i) => i) });
    }
  });
  return surfaces;
}

export interface EaldholtAtmosphere {
  readonly object: Object3D;
  readonly drawCalls: number;
  readonly triangles: number;
  readonly textureBytesWithMipsEstimate: number;
  readonly sourceBounds: { readonly center: readonly [number, number, number]; readonly radius: number; readonly upperHemisphereOnly: boolean };
  readonly farProjection: EaldholtFarProjectionDiagnostics | null;
  update(elapsedSeconds: number, animated: boolean): void;
  dispose(): void;
}

/** Parentless source-metre sky dome. Add after measuring the village bounds;
 * the transparent sky is excluded from framing, picking and shadow casting.
 * No global background, lighting, camera, render target or source asset changes. */
export function createEaldholtAtmosphere(options: {
  center?: readonly [number, number, number]; radius?: number; profile?: 'desktop' | 'quest';
  farProjection?: { source: Object3D; packet: EaldholtFarProjectionPacket; grassMap?: Texture | null; grassTileMetres?: number; grassSourceAssetId?: string };
} = {}): EaldholtAtmosphere {
  const radius = options.radius ?? EALDHOLT_CLOUDS.radius;
  const center: readonly [number, number, number] = options.center ?? [25, 0, 25];
  if (!Number.isFinite(radius) || radius <= 0 || center.some(value => !Number.isFinite(value))) throw Error('Invalid cloud dome envelope.');
  const far = options.farProjection, data = far ? createEaldholtFarProjectionData(far.packet) : null;
  const tile = far?.grassTileMetres ?? 2;
  if (far && (!Number.isFinite(tile) || tile <= 0)) throw Error('Invalid borrowed far grass scale.');
  const quest = options.profile === 'quest', size = quest ? 128 : EALDHOLT_CLOUDS.textureSize;
  const boundary = far ? createEaldholtFarBoundary(far.packet, farTerrain(far.source)) : undefined;
  const pixels = createEaldholtCloudPixels(size); if (boundary) packEaldholtFarBoundary(pixels, boundary);
  const texture = new DataTexture(pixels, size, size, RGBAFormat, UnsignedByteType);
  texture.name = 'Crownfall seamless procedural cloud coverage'; texture.colorSpace = NoColorSpace;
  texture.wrapS = texture.wrapT = RepeatWrapping; texture.magFilter = LinearFilter;
  texture.minFilter = LinearMipmapLinearFilter; texture.generateMipmaps = true; texture.needsUpdate = true;
  const time = { value: 0 };
  const observer = new Vector3(), worldToDome = new Matrix4(), domeToSource = new Matrix4();
  const uniforms: ShaderMaterial['uniforms'] = { uEaldholtCloudNoise: { value: texture }, uEaldholtCloudTime: time };
  if (data) Object.assign(uniforms, {
    uEaldholtCloudObserver: { value: observer }, uEaldholtDomeToSource: { value: domeToSource },
    uEaldholtFarCoast: { value: data.coast }, uEaldholtFarChannel: { value: data.channel },
    uEaldholtFarCoastCount: { value: data.coastCount }, uEaldholtFarChannelCount: { value: data.channelCount },
    uEaldholtFarSeaLevel: { value: data.seaLevel }, uEaldholtFarOrigin: { value: data.origin },
    uEaldholtFarLocalXZ: { value: data.localXZ }, uEaldholtFarSourceSun: { value: EALDHOLT_FAR_SOURCE_SUN },
    uEaldholtFarBoundaryRange: { value: [boundary!.minimum, boundary!.range] }, uEaldholtFarBoundaryTextureSize: { value: size },
    uEaldholtFarLandAmplitude: { value: data.landField.slice(0, 3) }, uEaldholtFarLandScale: { value: data.landField.slice(3) },
    uEaldholtFarGrass: { value: far?.grassMap ?? texture }, uEaldholtFarHasGrass: { value: far?.grassMap ? 1 : 0 }, uEaldholtFarGrassTile: { value: tile },
  });
  const material = new ShaderMaterial({
    name: 'Crownfall lightweight drifting clouds',
    uniforms,
    vertexShader: far ? EALDHOLT_FAR_ATMOSPHERE_VERTEX : EALDHOLT_CLOUD_VERTEX,
    fragmentShader: far ? EALDHOLT_FAR_ATMOSPHERE_FRAGMENT : EALDHOLT_CLOUD_FRAGMENT,
    side: BackSide, transparent: true, depthWrite: false, depthTest: true, toneMapped: false,
  });
  const geometry = new SphereGeometry(radius, quest ? 24 : 32, far ? (quest ? 16 : 12) : (quest ? 8 : 12), 0, Math.PI * 2, 0, far ? Math.PI : Math.PI / 2);
  const mesh = new Mesh(geometry, material); mesh.name = 'Ealdholt cloud coverage dome';
  mesh.renderOrder = -10; mesh.castShadow = false; mesh.receiveShadow = false;
  if (far) {
    mesh.raycast = () => {}; // The visual surround never becomes a picking solid.
    mesh.onBeforeRender = (_renderer, _scene, camera) => {
      if (disposed) return;
      observer.setFromMatrixPosition(camera.matrixWorld).applyMatrix4(worldToDome.copy(mesh.matrixWorld).invert());
      domeToSource.copy(far.source.matrixWorld).invert().multiply(mesh.matrixWorld);
      material.uniformsNeedUpdate = true;
    };
  }
  mesh.userData.iwsdkPreviewBounds = 'exclude';
  const object = new Group(); object.name = 'House Ealdholt Atmosphere'; object.position.set(...center);
  object.userData.iwsdkPreviewBounds = 'exclude'; object.add(mesh);
  object.userData.crownfallAtmosphere = { kind: 'texture-backed-sky-dome', volumetric: false, castsCloudShadows: false };
  const farProjection: EaldholtFarProjectionDiagnostics | null = far ? {
    enabled: true, nonSolid: true, localPlacementEligible: false, drawCallsAdded: 0, textureBytesAdded: 0,
    borrowedGrassMap: !!far.grassMap, grassTileMetres: tile, grassSourceAssetId: far.grassSourceAssetId ?? null, grassScaleAssumed: far.grassTileMetres === undefined,
    axes: 'source:+X-east/-Z-north', localBounds: { min: [...far.packet.localBounds.min], max: [...far.packet.localBounds.max] },
    boundary: { samples: 1024, cpuBytes: boundary!.heights.byteLength, maximumQuantizationError: boundary!.maximumQuantizationError, setupMilliseconds: boundary!.setupMilliseconds, mainlandSamples: boundary!.mainlandSamples, waterSamples: boundary!.waterSamples, transitionMetres: 64 },
  } : null;
  if (farProjection) object.userData.crownfallAtmosphere.farProjection = farProjection;
  let disposed = false;
  return { object, drawCalls: 1, triangles: geometry.index!.count / 3,
    sourceBounds: { center, radius, upperHemisphereOnly: !far }, farProjection,
    textureBytesWithMipsEstimate: Math.ceil(size * size * 4 * 4 / 3),
    update(elapsedSeconds, animated) {
      if (disposed || !animated || !Number.isFinite(elapsedSeconds)) return;
      time.value = Math.max(0, elapsedSeconds);
    },
    dispose() {
      if (disposed) return; disposed = true;
      object.removeFromParent(); object.clear(); geometry.dispose(); material.dispose(); texture.dispose();
    },
  };
}
