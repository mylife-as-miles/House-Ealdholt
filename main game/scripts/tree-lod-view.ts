/** Desktop-only, stationary asset comparison. Native-resolution materials do
 * not make this a Native runtime or physical-headset performance test. */
import {
  ACESFilmicToneMapping, Box3, Color, DataTexture, DirectionalLight,
  EquirectangularReflectionMapping, FloatType, HemisphereLight, LinearFilter,
  LinearSRGBColorSpace, Mesh, MeshStandardMaterial, PCFSoftShadowMap,
  PerspectiveCamera, PlaneGeometry, PMREMGenerator, RGBAFormat, Scene,
  SRGBColorSpace, Texture, Vector3, WebGLRenderer,
  type Material, type Object3D,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

export type TreeLodViewId = 'quarter' | 'front';
export type TreeLodLook = 'material' | 'clay';
export interface TreeLodComparison {
  readonly stats: Record<string, unknown>;
  dispose(): void;
}

/** A spatially uniform neutral linear radiance field. It owns no downloaded
 * HDR, directional cloud pattern, scene reflection or compensation for foliage. */
function neutralEnvironment(): DataTexture {
  const data = new Float32Array(32 * 16 * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = data[i + 1] = data[i + 2] = .6; data[i + 3] = 1;
  }
  const texture = new DataTexture(data, 32, 16, RGBAFormat, FloatType);
  texture.colorSpace = LinearSRGBColorSpace;
  texture.mapping = EquirectangularReflectionMapping;
  texture.minFilter = texture.magFilter = LinearFilter;
  texture.generateMipmaps = false; texture.needsUpdate = true;
  return texture;
}

export async function createTreeLodView(
  host: HTMLElement, modelUrl: string, view: TreeLodViewId = 'quarter', look: TreeLodLook = 'material',
): Promise<TreeLodComparison> {
  const url = new URL(modelUrl);
  if (!['http:', 'https:'].includes(url.protocol) || !['127.0.0.1', 'localhost'].includes(url.hostname)
    || url.username || url.password || url.search || url.hash || !url.pathname.endsWith('.glb')) throw Error('Expected a private loopback GLB URL.');
  if (!['quarter', 'front'].includes(view)) throw Error('Unsupported matched asset view.');
  if (!['material', 'clay'].includes(look)) throw Error('Unsupported asset comparison look.');
  const scene = new Scene(); scene.background = new Color('#bdc5c6');
  const camera = new PerspectiveCamera(40, host.clientWidth / host.clientHeight, .1, 250);
  camera.position.fromArray(view === 'front' ? [0, 10.4, 43] : [30, 16, 30]);
  const target = new Vector3(0, 10.4, 0); camera.lookAt(target);
  const renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(1); renderer.setSize(host.clientWidth, host.clientHeight);
  renderer.outputColorSpace = SRGBColorSpace; renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1; renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFSoftShadowMap;
  host.appendChild(renderer.domElement);
  const panorama = neutralEnvironment(), pmrem = new PMREMGenerator(renderer);
  const environment = pmrem.fromEquirectangular(panorama); pmrem.dispose();
  scene.environment = environment.texture; scene.environmentIntensity = 1;
  const fill = new HemisphereLight('#d4d4d4', '#777777', .18); scene.add(fill);
  const sun = new DirectionalLight('#fff0da', 2.6);
  sun.target.position.set(0, 8, 0); sun.position.set(-65, 117, 50); sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048); sun.shadow.camera.left = sun.shadow.camera.bottom = -25;
  sun.shadow.camera.right = sun.shadow.camera.top = 25;
  sun.shadow.camera.near = 1; sun.shadow.camera.far = 250;
  sun.shadow.bias = -.00004; sun.shadow.normalBias = .025;
  sun.shadow.camera.updateProjectionMatrix(); scene.add(sun, sun.target);
  const floorGeometry = new PlaneGeometry(100, 100);
  const floorMaterial = new MeshStandardMaterial({ color: '#737971', roughness: .96, metalness: 0 });
  const floor = new Mesh(floorGeometry, floorMaterial); floor.rotation.x = -Math.PI / 2;
  floor.position.y = -.03; floor.receiveShadow = true; floor.castShadow = false; scene.add(floor);
  let model: Object3D | null = null, disposed = false;
  function dispose(): void {
    if (disposed) return; disposed = true;
    const geometries = new Set<Mesh['geometry']>(), materials = new Set<Material>(), textures = new Set<Texture>(), images = new Set<ImageBitmap>();
    model?.traverse(object => {
      if (!(object instanceof Mesh)) return;
      geometries.add(object.geometry);
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        materials.add(material);
        for (const value of Object.values(material)) if (value instanceof Texture && value !== environment.texture) textures.add(value);
      }
    });
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
    for (const texture of textures) { if (texture.source?.data instanceof ImageBitmap) images.add(texture.source.data); texture.dispose(); }
    for (const image of images) image.close();
    scene.clear(); model = null; floorGeometry.dispose(); floorMaterial.dispose();
    sun.shadow.map?.dispose(); environment.dispose(); panorama.dispose();
    renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove();
  }
  try {
    const response = await fetch(url);
    if (!response.ok) throw Error(`Private asset unavailable (${response.status}).`);
    const gltf = await new GLTFLoader().parseAsync(await response.arrayBuffer(), new URL('.', url).href);
    model = gltf.scene; scene.add(model);
    if (gltf.animations.length) throw Error('Comparison requires the stationary tree prototypes.');
    const bounds = new Box3().setFromObject(model);
    if (bounds.isEmpty() || ![...bounds.min.toArray(), ...bounds.max.toArray()].every(Number.isFinite)) throw Error('Invalid tree prototype bounds.');
    let modelTriangles = 0, componentCount = 0;
    const materialNames = new Set<string>(), textureDimensions = new Map<string, { width: number; height: number }>();
    model.traverse(object => {
      if (!(object instanceof Mesh)) return;
      componentCount++; modelTriangles += (object.geometry.index?.count ?? object.geometry.getAttribute('position').count) / 3;
      object.castShadow = object.receiveShadow = true;
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        materialNames.add(material.name);
        for (const value of Object.values(material)) if (value instanceof Texture) {
          const image = value.image as { width?: number; height?: number } | undefined;
          textureDimensions.set(value.name || value.uuid, { width: image?.width ?? 0, height: image?.height ?? 0 });
        }
      }
    });
    if (componentCount !== 3 || materialNames.size !== 3) throw Error('Expected every original bark/decoration/canopy component.');
    if (look === 'clay') {
      const clayMaterials = new Set<MeshStandardMaterial>();
      model.traverse(object => {
        if (!(object instanceof Mesh)) return;
        for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
          if (!(material instanceof MeshStandardMaterial) || clayMaterials.has(material)) continue;
          clayMaterials.add(material);
          const compile = material.onBeforeCompile;
          material.roughness = .9; material.metalness = 0;
          material.onBeforeCompile = function (shader, currentRenderer) {
            compile.call(this, shader, currentRenderer);
            if (!shader.fragmentShader.includes('#include <color_fragment>')) throw Error('Clay comparison requires standard PBR colour.');
            // Preserve the source cutout alpha, UVs and surface normals while
            // removing base-colour differences from this diagnostic only.
            shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb = vec3(0.55);');
          };
          material.customProgramCacheKey = () => ':ealdholt-tree-comparison-clay:v1';
          material.needsUpdate = true;
        }
      });
    }
    renderer.render(scene, camera);
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    renderer.render(scene, camera);
    return { stats: {
      label: 'Desktop software asset comparison; actual map sizes are recorded, not Native runtime/headset proof',
      asset: url.pathname.split('/').at(-1), view, look, modelTriangles, completeComponents: componentCount,
      materialNames: [...materialNames], originalMapsAlphaAndMaterialsUnmodified: look === 'material',
      rootFrame: model.matrix.toArray(), sourceLocalBounds: { min: bounds.min.toArray(), max: bounds.max.toArray() },
      camera: { position: camera.position.toArray(), target: target.toArray(), fov: 40, aspect: camera.aspect },
      viewport: { width: host.clientWidth, height: host.clientHeight }, floorY: -.03,
      lights: { keyIntensity: 2.6, keyPosition: sun.position.toArray(), keyTarget: sun.target.position.toArray(), hemisphereIntensity: .18, environmentLinearGray: .6 },
      rendererTotalsAcrossPasses: { ...renderer.info.render }, rendererMemory: { ...renderer.info.memory },
      textures: [...textureDimensions].map(([name, dimensions]) => ({ name, ...dimensions })),
    }, dispose };
  } catch (error) { dispose(); throw error; }
}
