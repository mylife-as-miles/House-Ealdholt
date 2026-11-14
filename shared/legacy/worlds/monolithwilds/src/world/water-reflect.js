// Planar reflections for the Mirror.
//
// A Reflector-style mirrored camera renders into a mipmapped HDR target, with an oblique near
// plane at the water level so nothing below the surface leaks in. Two modes:
//
//   full  (quality.reflections, q=high; half resolution) the sky, the terrain, the landmarks and
//         our own falls. Vegetation, scattered rocks/ruins and small life are hidden for the pass
//         (they are still implied by the terrain colour beneath them); shadow maps are not
//         re-rendered; the pass is skipped when no water is in view.
//   sky   (medium; quarter resolution) only the sky dome: clouds, stars, aurora and moon in the
//         Mirror for the price of one small sky pass. The terrain comes from the surface shader's
//         height-field march instead.
//
// The atmosphere (height fog, the sky's haze band) is evaluated from the camera position; the
// mirrored camera sits as far below the water as the real one is above it, where the air is far
// denser. For the pass the atmosphere's reference height is lowered by the camera height, so the
// air is integrated as if from the water surface (and restored afterwards).

import * as THREE from 'crownfall-world-three';

export function createPlanarReflection(ctx, { level = 0, scale = 0.5, keep = [], skyOnly = false } = {}) {
  const { renderer, scene, camera } = ctx;
  const rt = new THREE.WebGLRenderTarget(4, 4, {
    type: THREE.HalfFloatType,
    minFilter: THREE.LinearMipmapLinearFilter,
    magFilter: THREE.LinearFilter,
    generateMipmaps: true,
    depthBuffer: true,
    stencilBuffer: false,
  });
  rt.texture.name = 'water-planar';
  const reflCam = new THREE.PerspectiveCamera();
  reflCam.matrixAutoUpdate = true;
  const textureMatrix = new THREE.Matrix4();
  const plane = new THREE.Plane();
  const normal = new THREE.Vector3(0, 1, 0);
  const mirrorPos = new THREE.Vector3(0, level, 0);
  const camPos = new THREE.Vector3();
  const rot = new THREE.Matrix4();
  const lookAt = new THREE.Vector3();
  const view = new THREE.Vector3();
  const target = new THREE.Vector3();
  const clip = new THREE.Vector4();
  const q = new THREE.Vector4();
  const size = new THREE.Vector2();
  const frustum = new THREE.Frustum();
  const projView = new THREE.Matrix4();
  const hidden = [];
  const keepSet = new Set(keep);
  const landmarkSet = new Set();
  let landmarkCount = -1;
  let maxMip = 5;

  function resize() {
    renderer.getDrawingBufferSize(size);
    const w = Math.max(4, Math.round(size.x * scale));
    const h = Math.max(4, Math.round(size.y * scale));
    if (rt.width !== w || rt.height !== h) rt.setSize(w, h);
    maxMip = Math.max(0, Math.floor(Math.log2(Math.min(w, h))) - 3);
  }
  resize();
  ctx.onResize(resize);

  function isReflected(obj) {
    if (obj.isLight || obj.isCamera) return true;
    if (keepSet.has(obj)) return true;
    const n = obj.name || '';
    if (n === 'sky' || n === 'terrain') return true;
    if (landmarkSet.has(obj)) return true;
    return false;
  }

  /** Render the reflection; returns false when skipped. bounds: Box3 of the water to test. */
  function render(bounds, hide = []) {
    camPos.setFromMatrixPosition(camera.matrixWorld);
    if (camPos.y <= level + 0.5) return false;
    projView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(projView);
    if (bounds) {
      let seen = false;
      for (let i = 0; i < bounds.length && !seen; i++) seen = frustum.intersectsBox(bounds[i]);
      if (!seen) return false;
    }

    // mirrored camera (see three/examples Reflector)
    rot.extractRotation(camera.matrixWorld);
    lookAt.set(0, 0, -1).applyMatrix4(rot).add(camPos);
    view.subVectors(mirrorPos, camPos).reflect(normal).negate().add(mirrorPos);
    target.subVectors(mirrorPos, lookAt).reflect(normal).negate().add(mirrorPos);
    reflCam.position.copy(view);
    reflCam.up.set(0, 1, 0).applyMatrix4(rot).reflect(normal);
    reflCam.lookAt(target);
    reflCam.near = camera.near;
    reflCam.far = camera.far;
    reflCam.fov = camera.fov;
    reflCam.aspect = camera.aspect;
    reflCam.updateMatrixWorld();
    reflCam.projectionMatrix.copy(camera.projectionMatrix);

    textureMatrix.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
    textureMatrix.multiply(reflCam.projectionMatrix).multiply(reflCam.matrixWorldInverse);

    // oblique near plane = the water plane (Lengyel)
    plane.setFromNormalAndCoplanarPoint(normal, mirrorPos).applyMatrix4(reflCam.matrixWorldInverse);
    clip.set(plane.normal.x, plane.normal.y, plane.normal.z, plane.constant);
    const e = reflCam.projectionMatrix.elements;
    q.x = (Math.sign(clip.x) + e[8]) / e[0];
    q.y = (Math.sign(clip.y) + e[9]) / e[5];
    q.z = -1;
    q.w = (1 + e[10]) / e[14];
    clip.multiplyScalar(2 / clip.dot(q));
    e[2] = clip.x;
    e[6] = clip.y;
    e[10] = clip.z + 1 - 0.0005;
    e[14] = clip.w;
    reflCam.projectionMatrixInverse.copy(reflCam.projectionMatrix).invert();

    // what goes into the mirror
    const sky = ctx.sky?.mesh;
    if (skyOnly && !sky) return false;
    hidden.length = 0;
    if (!skyOnly) {
      if (ctx.landmarks.length !== landmarkCount) {
        landmarkCount = ctx.landmarks.length;
        landmarkSet.clear();
        for (let i = 0; i < landmarkCount; i++) if (ctx.landmarks[i].object) landmarkSet.add(ctx.landmarks[i].object);
      }
      const kids = scene.children;
      for (let i = 0; i < kids.length; i++) {
        const c = kids[i];
        if (c.visible && !isReflected(c)) {
          c.visible = false;
          hidden.push(c);
        }
      }
      for (let i = 0; i < hide.length; i++) {
        const o = hide[i];
        if (o.visible) {
          o.visible = false;
          hidden.push(o);
        }
      }
    }

    // integrate the air from the water surface, not from the mirrored camera deep below it
    const atmo = ctx.atmo;
    const fz = atmo.fog.z;
    atmo.fog.z = fz - (camPos.y - level);
    // the sky draws stars / sun / cloud detail at its pixel footprint: give it this target's
    // (coarser) pixels, or the stars fall between the samples and vanish from the Mirror
    const pixU = ctx.sky?.uniforms?.uPixelAngle;
    const pix = pixU ? pixU.value : 0;
    if (pixU) pixU.value = pix / scale;
    const shadowAuto = renderer.shadowMap.autoUpdate;
    const shadowNeeds = renderer.shadowMap.needsUpdate;
    renderer.shadowMap.autoUpdate = false;
    renderer.shadowMap.needsUpdate = false;
    const prevTarget = renderer.getRenderTarget();
    const prevXr = renderer.xr.enabled;
    renderer.xr.enabled = false;

    renderer.setRenderTarget(rt);
    renderer.clear();
    // sky mode: the dome alone (its onBeforeRender centres it on the mirrored camera)
    renderer.render(skyOnly ? sky : scene, reflCam);
    renderer.setRenderTarget(prevTarget);

    renderer.xr.enabled = prevXr;
    renderer.shadowMap.autoUpdate = shadowAuto;
    renderer.shadowMap.needsUpdate = shadowNeeds;
    atmo.fog.z = fz;
    if (pixU) pixU.value = pix;
    for (let i = 0; i < hidden.length; i++) hidden[i].visible = true;
    hidden.length = 0;
    return true;
  }

  return {
    texture: rt.texture,
    textureMatrix,
    get maxMip() {
      return maxMip;
    },
    render,
    dispose() {
      rt.dispose();
    },
  };
}
