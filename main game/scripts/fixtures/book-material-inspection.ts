import * as THREE from 'three';
import { createAtlasBook } from '../../src/chronicles/scene/atlas-book';

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setSize(1200, 1000); renderer.setPixelRatio(1);
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.12;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene(); scene.background = new THREE.Color('#19130f');
const hemisphere = new THREE.HemisphereLight('#e3d5bd', '#2a1d10', 1.15);
const key = new THREE.DirectionalLight('#ffe2bd', 1.9); key.position.set(-.4, 1, .5); scene.add(hemisphere, key);
const camera = new THREE.PerspectiveCamera(36, 1.2, .01, 10);
const book = createAtlasBook(1, .746, 8, render, renderer); scene.add(book.group); book.open(false, true);
const target = new THREE.Vector3(book.centerX, .06, 0);
function render() { renderer.render(scene, camera); }
(window as any).bookTexturesReady = () => {
  let loaded = true;
  book.group.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    const material = object.material as THREE.MeshStandardMaterial;
    for (const texture of [material.map, material.normalMap, material.roughnessMap]) {
      if (!texture?.image?.complete || !texture.image.naturalWidth) loaded = false;
    }
  });
  return loaded;
};
(window as any).inspectBook = (view: string) => {
  if (view === 'front') { camera.position.set(target.x, 1.18, .50); camera.lookAt(target); }
  if (view === 'quarter') { camera.position.set(target.x + .9, .9, .9); camera.lookAt(target); }
  if (view === 'spine') { camera.position.set(target.x - .9, .36, .55); camera.lookAt(target); }
  if (view === 'close') { camera.position.set(target.x + .34, .33, .59); camera.lookAt(target.x + .18, .065, .33); }
  render(); return { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, textures: renderer.info.memory.textures };
};
(window as any).inspectBook('front');
