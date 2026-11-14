// STABLE FALLBACK terrain for testing (modules=terrain-basic). Do not edit; frozen copy of the placeholder.
import * as THREE from 'crownfall-world-three';

export async function build(ctx) {
  const { heightAt, layout } = ctx;
  const half = layout.WORLD.half;
  const N = 640;
  const geo = new THREE.PlaneGeometry(half * 2, half * 2, N, N);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    pos.setY(i, heightAt(x, z));
  }
  geo.computeVertexNormals();
  const nrm = geo.attributes.normal;
  const grass = new THREE.Color('#5d6b35');
  const rock = new THREE.Color('#7a7065');
  const sand = new THREE.Color('#b8a37c');
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const slope = 1 - nrm.getY(i);
    c.copy(grass).lerp(rock, THREE.MathUtils.smoothstep(slope, 0.18, 0.35));
    if (y < 4) c.lerp(sand, THREE.MathUtils.smoothstep(4 - y, 0, 3));
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }));
  mesh.receiveShadow = true;
  mesh.castShadow = true;
  mesh.name = 'terrain';
  ctx.scene.add(mesh);
  return {};
}
