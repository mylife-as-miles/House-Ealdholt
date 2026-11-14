import {
  DataTexture, DoubleSide, EquirectangularReflectionMapping, FloatType, Group, LinearSRGBColorSpace, Mesh, MeshBasicMaterial, MeshPhysicalMaterial,
  PerspectiveCamera, PlaneGeometry, REVISION, RGBAFormat, Scene, Vector3, Vector4, WebGLRenderer, WebGLRenderTarget,
  type Texture,
} from 'three';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { createEaldholtCardinalProbePixels, EALDHOLT_PROBE_CARDINAL_RADIANCE, scoreEaldholtCardinalProbeSample, type EaldholtProbeCardinal } from '../../../../shared/legacy/aethelgard/environment/pond-probe-calibration';
import { type EaldholtPondProbeIdentity, type EaldholtPondProbeProfile } from '../../../../shared/legacy/aethelgard/environment/pond-probe';
import { applyEaldholtBorrowedPondProbe } from './pond-probe-texture';
import { captureEaldholtPondProbe, inspectEaldholtPondProbeSurfaces } from './pond-probe-authoring';

/** Created only by a separate authoring runner. Keeping construction here
 * prevents another app's Vite/Three aliases from supplying the renderer. */
export function createEaldholtPondProbeCalibrationRenderer(): WebGLRenderer {
  return new WebGLRenderer({ antialias: false, alpha: false });
}

function assertCalibrationRenderer(renderer: WebGLRenderer): void {
  if (REVISION !== '185' || !(renderer instanceof WebGLRenderer)) throw Error('Expected Desktop three r185 and its own renderer namespace.');
  if (renderer.xr.enabled || renderer.xr.isPresenting) throw Error('Run cardinal calibration on a separate non-XR renderer.');
  if (!renderer.extensions.has('EXT_color_buffer_float')) throw Error('Float calibration readback is unavailable.');
}

/** A separate original asset/engine diagnostic, never an app/XR capture hook.
 * Root supplies a dedicated non-XR renderer and owns browser/GPU execution. */
export function runEaldholtPondProbeCalibration(renderer: WebGLRenderer, profile: EaldholtPondProbeProfile = 'quest') {
  assertCalibrationRenderer(renderer);
  const panorama = createEaldholtCardinalProbePixels(profile), texture = new DataTexture(panorama.data, panorama.width, panorama.height, RGBAFormat, FloatType);
  texture.mapping = EquirectangularReflectionMapping; texture.colorSpace = LinearSRGBColorSpace; texture.flipY = false; texture.generateMipmaps = false; texture.needsUpdate = true;
  const identity: EaldholtPondProbeIdentity = { version: 1, profile, modelSha256: '1'.repeat(64), lightingVersion: 'cardinal-procedural-r1',
    sourceAxes: true, neutralFillAlreadyBaked: true, realtime: false };
  try { return { ...sampleCalibrationTexture(renderer, texture, identity), mode: 'procedural' as const }; }
  finally { texture.dispose(); }
}

/** The eight GPU checks are shared by direct procedural and exported-file
 * paths. The texture stays borrowed here; the outer authoring function owns it. */
function sampleCalibrationTexture(renderer: WebGLRenderer, texture: Texture, identity: EaldholtPondProbeIdentity) {
  const image = texture.image as { width: number; height: number };
  const scene = new Scene(), root = new Group(), geometry = new PlaneGeometry(4, 4);
  const source = new MeshPhysicalMaterial({ color: 0xffffff, metalness: 1, roughness: 0, toneMapped: false, side: DoubleSide }); source.name = 'Crownfall_Pond_Water_Review';
  const pond = new Mesh(geometry, source); pond.rotation.x = -Math.PI / 2; root.add(pond); scene.add(root);
  let binding: ReturnType<typeof applyEaldholtBorrowedPondProbe>;
  try { binding = applyEaldholtBorrowedPondProbe(root, texture, { identity, expected: identity }); }
  catch (error) { geometry.dispose(); source.dispose(); throw error; }
  const camera = new PerspectiveCamera(40, 1, .1, 30), basePosition = new Vector3(0, 2, 5), up = new Vector3(0, 1, 0);
  const target = new WebGLRenderTarget(32, 32, { type: FloatType, format: RGBAFormat, colorSpace: LinearSRGBColorSpace, generateMipmaps: false });
  const pixels = new Float32Array(32 * 32 * 4), viewport = renderer.getViewport(new Vector4()).clone(), scissor = renderer.getScissor(new Vector4()).clone();
  const previousTarget = renderer.getRenderTarget(), face = renderer.getActiveCubeFace(), mip = renderer.getActiveMipmapLevel(), scissorTest = renderer.getScissorTest();
  const cases: { pose: string; rootYaw: number; cameraYaw: number; position?: [number, number, number]; expected: EaldholtProbeCardinal }[] = [
    { pose: 'identity', rootYaw: 0, cameraYaw: 0, expected: '-Z' },
    { pose: 'root-quarter-turn-fixed-camera', rootYaw: Math.PI / 2, cameraYaw: 0, expected: '+X' },
    { pose: 'camera-and-root-quarter-turn', rootYaw: Math.PI / 2, cameraYaw: Math.PI / 2, expected: '-Z' },
    { pose: 'source-positive-x', rootYaw: 0, cameraYaw: 0, position: [-5, 2, 0], expected: '+X' },
    { pose: 'source-negative-x', rootYaw: 0, cameraYaw: 0, position: [5, 2, 0], expected: '-X' },
    { pose: 'source-positive-z', rootYaw: 0, cameraYaw: 0, position: [0, 2, -5], expected: '+Z' },
    { pose: 'source-positive-y', rootYaw: 0, cameraYaw: 0, position: [0, 5, .01], expected: '+Y' },
    { pose: 'source-negative-y', rootYaw: 0, cameraYaw: 0, position: [0, -5, .01], expected: '-Y' },
  ];
  const samples: ({ pose: string; expected: EaldholtProbeCardinal; linearRgb: [number, number, number] } & ReturnType<typeof scoreEaldholtCardinalProbeSample>)[] = [];
  try {
    renderer.setRenderTarget(target); renderer.setViewport(0, 0, 32, 32); renderer.setScissorTest(false);
    for (const test of cases) {
      root.rotation.set(0, test.rootYaw, 0);
      if (test.position) camera.position.fromArray(test.position); else camera.position.copy(basePosition).applyAxisAngle(up, test.cameraYaw);
      camera.lookAt(0, 0, 0);
      binding.update(); pixels.fill(NaN); renderer.clear(true, true, true); renderer.render(scene, camera);
      renderer.readRenderTargetPixels(target, 0, 0, 32, 32, pixels);
      const linearRgb: [number, number, number] = [0, 0, 0];
      for (let y = 15; y <= 17; y++) for (let x = 15; x <= 17; x++) for (let channel = 0; channel < 3; channel++) linearRgb[channel] += pixels[(y * 32 + x) * 4 + channel] / 9;
      samples.push({ pose: test.pose, expected: test.expected, linearRgb, ...scoreEaldholtCardinalProbeSample(linearRgb, test.expected) });
    }
    const quarterTurnCovarianceError = Math.max(...samples[0].normalized.map((value, channel) => Math.abs(value - samples[2].normalized[channel])));
    return { passed: samples.every(sample => sample.passed) && quarterTurnCovarianceError < .02,
      namespace: 'three', threeRevision: REVISION, profile: identity.profile, textureWidth: image.width, textureHeight: image.height,
      samples, quarterTurnCovarianceError,
      limitations: 'Procedural float equirectangular texture and metallic mirror pond only. Does not validate actual SDK HDR-loader orientation, real pond parallax, XR/UI input or headset performance.' };
  } finally {
    renderer.setRenderTarget(previousTarget, face, mip); renderer.setViewport(viewport); renderer.setScissor(scissor); renderer.setScissorTest(scissorTest);
    binding.dispose(); geometry.dispose(); source.dispose(); target.dispose();
  }
}

/** Full ORIGINAL synthetic file path: six linear-radiance basic planes ->
 * half-float CubeCamera -> shared RGBE writer -> Blob HDRLoader.loadAsync ->
 * public PBR local-probe binding. No source assets, Native capture, XR state
 * changes, texture flip corrections or neutral-fill patching are involved. */
export async function runEaldholtPondProbeCaptureCalibration(renderer: WebGLRenderer, profile: EaldholtPondProbeProfile = 'quest') {
  assertCalibrationRenderer(renderer);
  const scene = new Scene(), root = new Group(), pondGeometry = new PlaneGeometry(4, 4), wallGeometry = new PlaneGeometry(16.04, 16.04);
  const pondMaterial = new MeshPhysicalMaterial({ color: 0xffffff, metalness: 1, roughness: 0, toneMapped: false, side: DoubleSide });
  pondMaterial.name = 'Crownfall_Pond_Water_Review';
  const pond = new Mesh(pondGeometry, pondMaterial); pond.rotation.x = -Math.PI / 2; root.add(pond); scene.add(root);
  const center = inspectEaldholtPondProbeSurfaces(root).sourcePosition;
  const faces: readonly [EaldholtProbeCardinal, readonly [number, number, number]][] = [
    ['+X', [1, 0, 0]], ['-X', [-1, 0, 0]], ['+Y', [0, 1, 0]], ['-Y', [0, -1, 0]], ['+Z', [0, 0, 1]], ['-Z', [0, 0, -1]],
  ];
  const wallMaterials: MeshBasicMaterial[] = [];
  let capture: ReturnType<typeof captureEaldholtPondProbe>;
  try {
    for (const [cardinal, axis] of faces) {
      const material = new MeshBasicMaterial({ side: DoubleSide, toneMapped: false });
      material.color.setRGB(...EALDHOLT_PROBE_CARDINAL_RADIANCE[cardinal], LinearSRGBColorSpace); wallMaterials.push(material);
      const wall = new Mesh(wallGeometry, material); wall.name = 'Original synthetic cardinal ' + cardinal;
      if (axis[1]) wall.up.set(0, 0, 1);
      wall.position.copy(center).addScaledVector(new Vector3(...axis), 8); wall.lookAt(center); root.add(wall);
    }
    capture = captureEaldholtPondProbe(renderer, scene, { authoringOnly: true, sourceModel: root, profile,
      modelSha256: '1'.repeat(64), lightingVersion: 'cardinal-capture-r1' });
    if (!pond.visible) throw Error('Synthetic pond visibility was not restored after capture.');
  } finally {
    root.clear(); scene.clear(); pondGeometry.dispose(); wallGeometry.dispose(); pondMaterial.dispose();
    for (const material of wallMaterials) material.dispose();
  }
  const url = URL.createObjectURL(new Blob([new Uint8Array(capture.hdrBytes)], { type: 'image/vnd.radiance' }));
  let texture: Texture | undefined;
  try {
    texture = await new HDRLoader().loadAsync(url);
    // HDRLoader returns an owned HDR texture. Configure its intended reflection
    // role only; preserve the loader's actual flipY/type/colour-space settings.
    texture.mapping = EquirectangularReflectionMapping;
    const result = sampleCalibrationTexture(renderer, texture, capture.metadata);
    return { ...result, mode: 'capture' as const,
      pipeline: 'Original six basic planes -> CubeCamera half-float -> RGBE HDR -> Blob HDRLoader.loadAsync -> local PBR binding',
      captureMetadata: capture.metadata, hdrBytes: capture.hdrBytes,
      loaderSettings: { flipY: texture.flipY, type: texture.type, colorSpace: texture.colorSpace, mapping: texture.mapping },
      neutralFillAppliedToMirror: false,
      limitations: 'Original synthetic Desktop capture/export/load calibration only. Not village reflection, actual Native AssetManager HDR loading, World/XR/UI input, real pond parallax or headset performance proof.' };
  } finally { texture?.dispose(); URL.revokeObjectURL(url); }
}
