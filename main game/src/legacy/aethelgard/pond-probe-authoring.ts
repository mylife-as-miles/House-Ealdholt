import {
  Color, CubeCamera, FloatType, HalfFloatType, InstancedMesh, LinearFilter, LinearSRGBColorSpace,
  Matrix4, Mesh, NoToneMapping, OrthographicCamera, PlaneGeometry, Quaternion, RGBAFormat,
  Scene, ShaderMaterial, SkinnedMesh, Vector3, Vector4, WebGLCubeRenderTarget, WebGLRenderTarget,
  type Object3D, type WebGLRenderer,
} from 'three';
import { EALDHOLT_POND_PROBE, ealdholtWaterSourceName, isEaldholtPondProbeSurface,
  type EaldholtPondProbeProfile } from '../../../../shared/legacy/aethelgard/environment/pond-probe';
import { encodeEaldholtProbeHdr } from '../../../../shared/legacy/aethelgard/environment/pond-probe-hdr';
import { EALDHOLT_BANK_ART_VERSION } from '../../../../shared/legacy/aethelgard/environment/river-surface';

/** Public renderer state only. This function refuses an immersive renderer;
 * neither the authoring path nor runtime should toggle XR to take a probe. */
export function withEaldholtProbeCaptureState<T>(renderer: WebGLRenderer, surfaces: readonly Object3D[], operation: () => T): T {
  if (renderer.xr.enabled || renderer.xr.isPresenting) throw Error('Pond probes must be authored on a separate non-XR Desktop renderer.');
  const target = renderer.getRenderTarget(), face = renderer.getActiveCubeFace(), mip = renderer.getActiveMipmapLevel();
  const viewport = renderer.getViewport(new Vector4()).clone(), scissor = renderer.getScissor(new Vector4()).clone();
  const scissorTest = renderer.getScissorTest(), clearColor = renderer.getClearColor(new Color()).clone(), clearAlpha = renderer.getClearAlpha();
  const toneMapping = renderer.toneMapping, exposure = renderer.toneMappingExposure, colorSpace = renderer.outputColorSpace;
  const autoClear = renderer.autoClear, autoColor = renderer.autoClearColor, autoDepth = renderer.autoClearDepth, autoStencil = renderer.autoClearStencil;
  const visible = surfaces.map(surface => surface.visible);
  try {
    for (const surface of surfaces) surface.visible = false;
    renderer.toneMapping = NoToneMapping; renderer.toneMappingExposure = 1; renderer.outputColorSpace = LinearSRGBColorSpace;
    renderer.autoClear = renderer.autoClearColor = renderer.autoClearDepth = renderer.autoClearStencil = true;
    renderer.setScissorTest(false);
    return operation();
  } finally {
    for (let i = 0; i < surfaces.length; i++) surfaces[i].visible = visible[i];
    renderer.toneMapping = toneMapping; renderer.toneMappingExposure = exposure; renderer.outputColorSpace = colorSpace;
    renderer.autoClear = autoClear; renderer.autoClearColor = autoColor; renderer.autoClearDepth = autoDepth; renderer.autoClearStencil = autoStencil;
    renderer.setRenderTarget(target, face, mip); renderer.setViewport(viewport); renderer.setScissor(scissor); renderer.setScissorTest(scissorTest);
    renderer.setClearColor(clearColor, clearAlpha);
  }
}

export interface EaldholtPondProbeCaptureOptions {
  readonly authoringOnly: true;
  readonly sourceModel: Object3D;
  readonly profile: EaldholtPondProbeProfile;
  readonly modelSha256: string;
  readonly lightingVersion: string;
  /** Art version of the outer valley the capture sees (the valley handle's artVersion); defaults to the borrowed-map valley. */
  readonly valleyArtVersion?: string;
}
export interface EaldholtPondProbeCapture {
  readonly hdrBytes: Uint8Array;
  readonly metadata: {
    readonly version: 1; readonly format: 'radiance-rgbe'; readonly profile: EaldholtPondProbeProfile;
    readonly modelSha256: string; readonly lightingVersion: string;
    readonly width: number; readonly height: number; readonly cubeFaceSize: number;
    readonly sourcePosition: readonly [number, number, number];
    readonly sourceAxes: true; readonly hiddenWaterSurfaceCount: number;
    readonly neutralFillAlreadyBaked: true; readonly realtime: false;
    /** The outer valley the capture saw; runtimes warn when it differs from the current art. */
    readonly valleyArtVersion: string;
  };
}

/** Bounds are measured from private runtime geometry, never a checked-in source
 * array. Do not mutate borrowed geometry by computing/storing its bounding box.
 * Mixed-material meshes are refused rather than hiding adjacent opaque parts. */
export function inspectEaldholtPondProbeSurfaces(sourceModel: Object3D): {
  surfaces: Object3D[]; sourcePosition: Vector3; worldScale: number; sourceOrientation: Quaternion;
} {
  sourceModel.updateWorldMatrix(true, true);
  const inverseRoot = new Matrix4().copy(sourceModel.matrixWorld).invert(), matrix = new Matrix4(), instance = new Matrix4(), point = new Vector3();
  const minimum = new Vector3(Infinity, Infinity, Infinity), maximum = new Vector3(-Infinity, -Infinity, -Infinity);
  const surfaces: Object3D[] = []; let pondVertices = 0;
  sourceModel.traverse(object => {
    if (!(object instanceof Mesh)) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    const water = materials.map(material => ['Crownfall_Pond_Water_Review', 'Crownfall_Trough_Water_Review'].includes(ealdholtWaterSourceName(material)));
    if (!water.some(Boolean)) return;
    if (!water.every(Boolean)) throw Error('Split mixed opaque/water groups before authoring a pond probe.');
    surfaces.push(object);
    if (!materials.some(isEaldholtPondProbeSurface)) return;
    const positions = object.geometry.getAttribute('position');
    if (!positions || positions.itemSize !== 3 || object instanceof SkinnedMesh || object.morphTargetInfluences?.length) throw Error('Pond probe requires a static verified pond surface.');
    const count = object instanceof InstancedMesh ? object.count : 1;
    for (let actor = 0; actor < count; actor++) {
      matrix.copy(object.matrixWorld);
      if (object instanceof InstancedMesh) { object.getMatrixAt(actor, instance); matrix.multiply(instance); }
      matrix.premultiply(inverseRoot);
      for (let i = 0; i < positions.count; i++) {
        point.fromBufferAttribute(positions, i).applyMatrix4(matrix);
        if (![point.x, point.y, point.z].every(Number.isFinite)) throw Error('Pond source bounds are not finite.');
        minimum.min(point); maximum.max(point); pondVertices++;
      }
    }
  });
  if (!pondVertices) throw Error('Verified pond surface is absent; no probe was captured.');
  const scale = sourceModel.getWorldScale(new Vector3()), worldScale = scale.x;
  if (Math.min(scale.x, scale.y, scale.z) <= 0 || Math.max(Math.abs(scale.y - worldScale), Math.abs(scale.z - worldScale)) > worldScale * 1e-6) {
    throw Error('Authoring requires a positive uniform source-model scale.');
  }
  const sourceOrientation = sourceModel.getWorldQuaternion(new Quaternion());
  const reconstructed = new Matrix4().compose(sourceModel.getWorldPosition(new Vector3()), sourceOrientation, scale);
  if (sourceModel.matrixWorld.elements.some((v, i) => !Number.isFinite(v) || Math.abs(v - reconstructed.elements[i]) > 1e-5)) {
    throw Error('Authoring requires a rigid source frame without shear or reflection.');
  }
  const sourcePosition = minimum.add(maximum).multiplyScalar(.5); sourcePosition.y = maximum.y + .04;
  return { surfaces, sourcePosition, worldScale, sourceOrientation };
}

/** One-shot PRIVATE authoring only, after full scene assembly and neutral
 * lighting. Root must prepare static vegetation visibility/shadow coverage
 * before calling. No scene, camera or renderer is exposed through the result.
 * Requires EXT_color_buffer_float for an honest linear radiance readback. */
export function captureEaldholtPondProbe(renderer: WebGLRenderer, scene: Scene, options: EaldholtPondProbeCaptureOptions): EaldholtPondProbeCapture {
  if (options.authoringOnly !== true || !/^[a-f0-9]{64}$/i.test(options.modelSha256) || !options.lightingVersion.trim()) {
    throw Error('Private authoring and explicit source hash/lighting version are required.');
  }
  if (renderer.xr.enabled || renderer.xr.isPresenting) throw Error('Pond probes must be authored on a separate non-XR Desktop renderer.');
  if (!renderer.extensions.has('EXT_color_buffer_float')) throw Error('Float render-target readback is unavailable; no HDR probe was captured.');
  const settings = EALDHOLT_POND_PROBE[options.profile];
  if (!settings) throw Error('Unknown pond-probe profile.');
  const { surfaces, sourcePosition, worldScale, sourceOrientation } = inspectEaldholtPondProbeSurfaces(options.sourceModel);
  const cube = new WebGLCubeRenderTarget(settings.cubeFaceSize, { type: HalfFloatType, format: RGBAFormat,
    minFilter: LinearFilter, magFilter: LinearFilter, colorSpace: LinearSRGBColorSpace, generateMipmaps: false });
  const camera = new CubeCamera(.03 * worldScale, 1200 * worldScale, cube);
  camera.position.copy(sourcePosition).applyMatrix4(options.sourceModel.matrixWorld); camera.quaternion.copy(sourceOrientation);
  const output = new WebGLRenderTarget(settings.width, settings.height, { type: FloatType, format: RGBAFormat,
    minFilter: LinearFilter, magFilter: LinearFilter, colorSpace: LinearSRGBColorSpace, depthBuffer: false, generateMipmaps: false });
  const geometry = new PlaneGeometry(2, 2), material = new ShaderMaterial({
    uniforms: { uPondProbeCube: { value: cube.texture } }, toneMapped: false, depthTest: false, depthWrite: false,
    vertexShader: 'varying vec2 vProbeUv; void main(){vProbeUv=uv;gl_Position=vec4(position.xy,0.,1.);}',
    fragmentShader: `uniform samplerCube uPondProbeCube; varying vec2 vProbeUv;
      void main(){float longitude=(vProbeUv.x*2.-1.)*3.141592653589793;
      float latitude=(vProbeUv.y-.5)*3.141592653589793; float r=cos(latitude);
      vec3 direction=vec3(r*cos(longitude),sin(latitude),r*sin(longitude));
      gl_FragColor=vec4(textureCube(uPondProbeCube,direction).rgb,1.);}`,
  });
  const copyScene = new Scene(), copyCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 1); copyScene.add(new Mesh(geometry, material));
  const pixels = new Float32Array(settings.width * settings.height * 4);
  // A failed public readback can log an error rather than throw. Leaving NaNs
  // untouched makes the strict encoder reject it instead of exporting black.
  pixels.fill(NaN);
  try {
    withEaldholtProbeCaptureState(renderer, surfaces, () => {
      camera.update(renderer, scene);
      renderer.setRenderTarget(output); renderer.setViewport(0, 0, settings.width, settings.height); renderer.setScissorTest(false);
      renderer.render(copyScene, copyCamera);
      renderer.readRenderTargetPixels(output, 0, 0, settings.width, settings.height, pixels);
    });
    return { hdrBytes: encodeEaldholtProbeHdr(pixels, settings.width, settings.height, 'bottom-up'), metadata: {
      version: 1, format: 'radiance-rgbe', profile: options.profile, modelSha256: options.modelSha256,
      lightingVersion: options.lightingVersion, ...settings,
      sourcePosition: [sourcePosition.x, sourcePosition.y, sourcePosition.z], sourceAxes: true,
      hiddenWaterSurfaceCount: surfaces.length, neutralFillAlreadyBaked: true, realtime: false, valleyArtVersion: options.valleyArtVersion ?? EALDHOLT_BANK_ART_VERSION,
    } };
  } finally { geometry.dispose(); material.dispose(); output.dispose(); cube.dispose(); }
}
