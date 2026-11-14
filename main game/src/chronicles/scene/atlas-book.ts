import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import {
  ATLAS_BOOK, ATLAS_BOOK_GLSL, atlasBookCenterX, atlasBookInteractive, atlasBookParts, createAtlasBookState,
  dragAtlasBook, releaseAtlasBook, setAtlasBookOpen, stepAtlasBook, type AtlasBookState,
} from '../../../../shared/chronicles/archive/book';
import { ATLAS_BOOK_MATERIALS } from '../../../../shared/chronicles/archive/book-materials';
import { atlasBookSurfaces } from '../../../../shared/chronicles/archive/book-surface';

export interface AtlasBook {
  group: THREE.Group; state: AtlasBookState;
  readonly centerX: number;
  uniforms: Record<string, THREE.IUniform>;
  apply(material: THREE.Material): void;
  update(delta: number, still: boolean): boolean;
  open(value: boolean, still: boolean): void;
  drag(angle: number, delta: number): void;
  release(): void;
  interactive(): boolean;
  dispose(): void;
}
/** A bound volume, with actual page edges, protective covers and a flexible mapped leaf. */
export function createAtlasBook(width: number, depth: number, anisotropy = 4, onTextureReady = () => {}, renderer?: THREE.WebGLRenderer): AtlasBook {
  const group = new THREE.Group(); group.name = 'Chronicles bound atlas';
  const state = createAtlasBookState();
  const uniforms = {
    uBookCurve: { value: state.curve }, uBookAngle: { value: state.angle },
    uBookRelief: { value: state.relief }, uBookWidth: { value: width },
  };
  const leftPivot = new THREE.Group(), left = new THREE.Group(), right = new THREE.Group(), spine = new THREE.Group();
  leftPivot.name = 'Cover hinge'; left.name = 'Left cover and page block'; right.name = 'Right cover and page block'; spine.name = 'Flexible spine';
  leftPivot.position.y = ATLAS_BOOK.hinge * width; left.position.y = -ATLAS_BOOK.hinge * width;
  leftPivot.add(left); group.add(leftPivot, right, spine);
  let disposed = false;
  const loader = new THREE.TextureLoader();
  const root = `${import.meta.env.BASE_URL.replace(/\/$/, '')}${ATLAS_BOOK_MATERIALS.root}`;
  const load = (file: string, color = false) => {
    const texture = loader.load(root + file, () => { if (!disposed) onTextureReady(); });
    if (color) texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = anisotropy;
    return texture;
  };
  const color = load(ATLAS_BOOK_MATERIALS.color, true), normal = load(ATLAS_BOOK_MATERIALS.normal), orm = load(ATLAS_BOOK_MATERIALS.orm);
  const material = new THREE.MeshStandardMaterial({
    name: 'Atlas leather, aged bronze and paper • baked PBR',
    map: color, normalMap: normal, roughnessMap: orm, metalnessMap: orm, aoMap: orm,
    roughness: 1, metalness: 1, aoMapIntensity: .7,
  });
  // A small, object-local reflection probe gives the metal real highlights without relighting the map.
  let reflection: THREE.WebGLRenderTarget | null = null;
  if (renderer) {
    const room = new RoomEnvironment(), generator = new THREE.PMREMGenerator(renderer);
    reflection = generator.fromScene(room, .04, .1, 100, { size: 64 });
    material.envMap = reflection.texture; material.envMapIntensity = .65;
    room.dispose(); generator.dispose();
  }
  const parts = atlasBookParts(depth / width), geometries: THREE.BufferGeometry[] = [];
  for (const surface of atlasBookSurfaces(parts, width, depth)) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(surface.positions, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(surface.normals, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(surface.uvs, 2));
    geometry.setIndex(new THREE.BufferAttribute(surface.indices, 1));
    const mesh = new THREE.Mesh(geometry, material); mesh.name = `${surface.side} ${surface.family}`;
    mesh.castShadow = true; mesh.receiveShadow = true; geometry.computeBoundingSphere();
    (surface.side === 'left' ? left : surface.side === 'right' ? right : spine).add(mesh); geometries.push(geometry);
  }
  const update = (delta: number, still: boolean) => {
    const moving = stepAtlasBook(state, delta, still);
    uniforms.uBookAngle.value = state.angle; uniforms.uBookRelief.value = state.relief;
    leftPivot.rotation.z = state.angle;
    const closed = Math.abs(state.angle) / Math.PI;
    spine.scale.y = 1 + closed * 1.4; spine.position.y = closed * .075 * width;
    return moving;
  };
  update(0, false);
  return {
    group, state, uniforms,
    get centerX() { return atlasBookCenterX(state, parts) * width; },
    apply(material) {
      const prior = material.onBeforeCompile;
      material.onBeforeCompile = (shader, renderer) => {
        prior.call(material, shader, renderer); Object.assign(shader.uniforms, uniforms);
        shader.vertexShader = ATLAS_BOOK_GLSL + shader.vertexShader
          .replace('#include <begin_vertex>', 'vec3 transformed = atlasBookPosition(position);')
          .replace('#include <beginnormal_vertex>', 'vec3 objectNormal = atlasBookNormal(normal, position.x);');
      };
      material.customProgramCacheKey = () => 'crownfall-physical-atlas-book-v1';
    },
    update,
    open(value, still) { setAtlasBookOpen(state, value, still); update(0, still); },
    drag(angle, delta) { dragAtlasBook(state, angle, delta); update(0, false); },
    release() { releaseAtlasBook(state); },
    interactive: () => atlasBookInteractive(state),
    dispose() { disposed = true; for (const geometry of geometries) geometry.dispose(); material.dispose(); color.dispose(); normal.dispose(); orm.dispose(); reflection?.dispose(); },
  };
}
