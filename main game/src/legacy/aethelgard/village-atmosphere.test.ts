import assert from 'node:assert/strict';
import test from 'node:test';
import { Group, Matrix4, Mesh, MeshBasicMaterial, PerspectiveCamera, PlaneGeometry, Scene, ShaderMaterial, Texture, Vector3 } from 'three';
import { createEaldholtAtmosphere } from './village-atmosphere';
import { EALDHOLT_FAR_LAND_FIELD, type EaldholtFarProjectionPacket } from '../../../../shared/legacy/aethelgard/environment/far-surround';
import { EALDHOLT_FAR_ATMOSPHERE_FRAGMENT } from '../../../../shared/legacy/aethelgard/environment/far-surround-projection';
import { EALDHOLT_CLOUD_FRAGMENT } from '../../../../shared/legacy/aethelgard/environment/atmosphere';

test('model-local clouds own one light-free draw, pause uniforms and dispose once', () => {
  const clouds = createEaldholtAtmosphere({ profile: 'desktop' });
  const mesh = clouds.object.children[0] as Mesh;
  const material = mesh.material as ShaderMaterial;
  assert.equal(clouds.drawCalls, 1); assert.equal(clouds.object.parent, null);
  assert.ok(clouds.triangles <= 800); assert.ok(clouds.textureBytesWithMipsEstimate <= 350000);
  assert.deepEqual(clouds.sourceBounds, { center: [25, 0, 25], radius: 550, upperHemisphereOnly: true });
  assert.equal(material.depthWrite, false); assert.equal(material.transparent, true);
  assert.equal(material.fragmentShader, EALDHOLT_CLOUD_FRAGMENT); assert.equal(clouds.farProjection, null);
  assert.equal(mesh.castShadow, false); assert.equal(mesh.receiveShadow, false);
  assert.equal(mesh.userData.iwsdkPreviewBounds, 'exclude');
  const time = material.uniforms.uEaldholtCloudTime;
  clouds.update(12, true); assert.equal(time.value, 12);
  clouds.update(30, false); assert.equal(time.value, 12);
  clouds.update(Number.NaN, true); assert.equal(time.value, 12);
  let disposals = 0;
  material.addEventListener('dispose', () => disposals++);
  mesh.geometry.addEventListener('dispose', () => disposals++);
  material.uniforms.uEaldholtCloudNoise.value.addEventListener('dispose', () => disposals++);
  clouds.dispose(); clouds.dispose(); assert.equal(disposals, 3);
  clouds.update(40, true); assert.equal(time.value, 12); assert.equal(clouds.object.children.length, 0);
});

test('quest-profile authoring shares the Native full-sphere projection and preserves borrowed resources', () => {
  const packet: EaldholtFarProjectionPacket = { geography: { version: 1, axes: 'source:+X-east/-Z-north', landField: EALDHOLT_FAR_LAND_FIELD,
    coastSamples: new Float32Array([-100, -60, 100, -60]), channelSamples: new Float32Array([0, -8, 8, 1, 100, -8, 8, 1]),
    seaLevel: 1, sourceEnvelope: { minX: 0, maxX: 100, minZ: 0, maxZ: 100 }, riverJoinX: 100, riverFarX: 10000 }, localBounds: { min: [-100, 0, -100], max: [200, 20, 200] } };
  const source = new Group(), scene = new Scene(), anchor = new Group(), grass = new Texture(); scene.add(source, anchor);
  const terrainGeometry = new PlaneGeometry(300, 300).rotateX(-Math.PI / 2).translate(50, 5, 50), terrainMaterial = new MeshBasicMaterial(), terrain = new Mesh(terrainGeometry, terrainMaterial); terrain.name = 'LandscapeComponent_0'; source.add(terrain);
  source.position.set(-25, 0, -25); source.rotation.set(.3, .7, 0); source.scale.setScalar(.02);
  const sky = createEaldholtAtmosphere({ profile: 'quest', farProjection: { source, packet, grassMap: grass, grassTileMetres: 1.4, grassSourceAssetId: 'Grass001' } }); anchor.add(sky.object);
  const mesh = sky.object.children[0] as Mesh, material = mesh.material as ShaderMaterial;
  assert.equal(material.fragmentShader, EALDHOLT_FAR_ATMOSPHERE_FRAGMENT); assert.equal(sky.sourceBounds.upperHemisphereOnly, false); assert.equal(sky.triangles, 720);
  assert.equal(material.uniforms.uEaldholtFarGrass.value, grass); assert.equal(sky.farProjection?.nonSolid, true); assert.equal(sky.farProjection?.textureBytesAdded, 0);
  const observer = material.uniforms.uEaldholtCloudObserver.value as Vector3, transform = material.uniforms.uEaldholtDomeToSource.value as Matrix4;
  for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
    const camera = new PerspectiveCamera(); camera.rotation.y = yaw; camera.position.set(3, 1.1, -4); camera.updateMatrix(); camera.matrixWorld.copy(camera.matrix); scene.updateMatrixWorld(true);
    const before = camera.matrixWorld.clone(); mesh.onBeforeRender({} as never, scene, camera, mesh.geometry, material, {} as never);
    assert.deepEqual(material.uniforms.uEaldholtFarSourceSun.value, [65, 109, 50]);
    assert.deepEqual(camera.matrixWorld.elements, before.elements); assert.equal(material.uniforms.uEaldholtDomeToSource.value, transform);
    const expected = new Vector3().setFromMatrixPosition(before).applyMatrix4(source.matrixWorld.clone().invert());
    assert.ok(observer.clone().applyMatrix4(transform).distanceTo(expected) < 1e-10);
  }
  let borrowedDisposals = 0; grass.addEventListener('dispose', () => borrowedDisposals++); sky.dispose(); sky.dispose(); assert.equal(borrowedDisposals, 0); grass.dispose();
  const noGrass = createEaldholtAtmosphere({ profile: 'quest', farProjection: { source, packet } });
  const noGrassMaterial = (noGrass.object.children[0] as Mesh).material as ShaderMaterial;
  assert.equal(noGrassMaterial.uniforms.uEaldholtFarGrass.value, noGrassMaterial.uniforms.uEaldholtCloudNoise.value, 'reuse existing sampler fallback');
  assert.equal(noGrassMaterial.uniforms.uEaldholtFarHasGrass.value, 0); noGrass.dispose(); terrainGeometry.dispose(); terrainMaterial.dispose();
});
