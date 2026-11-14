// Environment lighting from the sky: renders the sky (SKY_ENV variant: no sun disk — the key light
// carries the sun — plus a dark earthy lower hemisphere) into a small cube map, prefilters it with
// PMREMGenerator and installs it as scene.environment (reflections on obsidian/bronze/water + IBL).
//
// Updates are amortised: one cube face per frame, then the PMREM pass on the 7th frame, so a
// running time-lapse never hitches. Discontinuous jumps (setHour, first frame, screenshot mode)
// rebuild synchronously so the lighting is never stale in a still.

import * as THREE from 'crownfall-world-three';

export function createSkyEnvironment(ctx, envMaterial, { size = 128, periodic = true } = {}) {
  const { renderer, scene, camera } = ctx;

  const cubeRT = new THREE.WebGLCubeRenderTarget(size, {
    type: THREE.HalfFloatType,
    generateMipmaps: false,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    depthBuffer: false,
  });
  const envScene = new THREE.Scene();
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), envMaterial);
  mesh.frustumCulled = false;
  envScene.add(mesh);

  const cubeCam = new THREE.CubeCamera(0.1, 10, cubeRT);
  cubeCam.coordinateSystem = renderer.coordinateSystem;
  cubeCam.updateCoordinateSystem();
  const faces = cubeCam.children;

  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileCubemapShader();
  let pmremRT = null;
  let face = 6; // 6 = idle
  let queued = false;
  let lastPos = new THREE.Vector3(1e9, 0, 0);
  let lastTime = -1e9;

  function place() {
    // the probe sits at the camera: clouds / haze band are position dependent
    cubeCam.position.copy(camera.position);
    cubeCam.updateMatrixWorld(true);
    // the unit sky sphere must surround the probe (near 0.1 / far 10), so it travels with it
    mesh.position.copy(camera.position);
    mesh.updateMatrixWorld(true);
    lastPos.copy(camera.position);
  }

  function renderFace(i) {
    renderer.setRenderTarget(cubeRT, i);
    renderer.render(envScene, faces[i]);
  }

  function finish() {
    pmremRT = pmrem.fromCubemap(cubeRT.texture, pmremRT);
    if (scene.environment !== pmremRT.texture) scene.environment = pmremRT.texture;
  }

  const api = {
    get texture() {
      return pmremRT ? pmremRT.texture : null;
    },
    /** Rebuild all faces now (a few ms on a GPU). */
    refreshNow(elapsed = lastTime) {
      const prevTarget = renderer.getRenderTarget();
      const prevFace = renderer.getActiveCubeFace();
      const prevMip = renderer.getActiveMipmapLevel();
      place();
      for (let i = 0; i < 6; i++) renderFace(i);
      finish();
      renderer.setRenderTarget(prevTarget, prevFace, prevMip);
      face = 6;
      queued = false;
      lastTime = elapsed;
    },
    /** Ask for an amortised rebuild (starts at the next update, or after the current one). */
    request() {
      if (face < 6) queued = true;
      else face = 0;
    },
    /** Per frame: advance an amortised rebuild; also refresh slowly for cloud drift / travel. */
    update(elapsed) {
      if (face === 6) {
        const moved = lastPos.distanceToSquared(camera.position) > 450 * 450;
        if (queued || (periodic && (moved || elapsed - lastTime > 12))) {
          queued = false;
          face = 0;
        } else return;
      }
      const prevTarget = renderer.getRenderTarget();
      const prevFace = renderer.getActiveCubeFace();
      const prevMip = renderer.getActiveMipmapLevel();
      if (face === 0) place();
      if (face < 6) {
        renderFace(face);
        face++;
      }
      if (face === 6) {
        finish();
        lastTime = elapsed;
      }
      renderer.setRenderTarget(prevTarget, prevFace, prevMip);
    },
  };
  return api;
}
