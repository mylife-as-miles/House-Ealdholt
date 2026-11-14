// Contact foam: where anything stands in the water (the Observatory's columns, the Stair's islet
// piers, sea stacks, the Span's feet, fallen blocks...) the surface gets a ring of foam and small
// ripples drifting away from it — computed once, generically, after every module has loaded.
//
// A thin slab of the scene around the waterline (y in [-1.6, 1.4]) is rendered top-down in white
// with an orthographic projection *sheared* in four directions (plus straight down): a vertical
// wall is edge-on from straight above and would leave no pixels, but under a shear its slab
// segment projects to a sliver of width ~slab height. The union is read back, turned into a
// distance field (two-pass chamfer, metres) and uploaded as a small R8 texture.

import * as THREE from 'crownfall-world-three';

export function bakeContact(ctx, { x0, z0, x1, z1, res = 2.5, skip = () => false }) {
  const { renderer, scene } = ctx;
  const t0 = performance.now();
  const W = Math.min(2048, Math.ceil((x1 - x0) / res));
  const H = Math.min(2048, Math.ceil((z1 - z0) / res));
  const rt = new THREE.WebGLRenderTarget(W, H, { type: THREE.UnsignedByteType, depthBuffer: true, generateMipmaps: false });
  const cam = new THREE.Camera();
  cam.matrixAutoUpdate = false;
  cam.matrixWorldAutoUpdate = false;
  cam.matrixWorld.identity();
  cam.matrixWorldInverse.identity();
  const hw = (x1 - x0) / 2;
  const hh = (z1 - z0) / 2;
  const cx = (x0 + x1) / 2;
  const cz = (z0 + z1) / 2;
  const yLo = -1.6;
  const yHi = 1.4;
  const setShear = (kx, kz) => {
    // clip = ((x + kx*y - cx)/hw, (z + kz*y - cz)/hh, slab depth, 1)
    cam.projectionMatrix.set(
      1 / hw, kx / hw, 0, -cx / hw,
      0, kz / hh, 1 / hh, -cz / hh,
      0, 2 / (yHi - yLo), 0, -(yHi + yLo) / (yHi - yLo),
      0, 0, 0, 1,
    );
    cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();
  };

  const white = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, fog: false });
  const hidden = [];
  for (const c of scene.children) {
    if (!c.visible) continue;
    if (c.isLight || skip(c)) {
      if (!c.isLight) {
        c.visible = false;
        hidden.push(c);
      }
    }
  }
  const prevTarget = renderer.getRenderTarget();
  const prevOverride = scene.overrideMaterial;
  const prevAutoClear = renderer.autoClear;
  const prevClear = new THREE.Color();
  renderer.getClearColor(prevClear);
  const prevAlpha = renderer.getClearAlpha();
  const shadowAuto = renderer.shadowMap.autoUpdate;
  renderer.shadowMap.autoUpdate = false;
  scene.overrideMaterial = white;
  renderer.autoClear = false;
  renderer.setRenderTarget(rt);
  renderer.setClearColor(0x000000, 1);
  renderer.clear(true, true, false);
  const k = 0.9;
  for (const [kx, kz] of [[0, 0], [k, 0], [-k, 0], [0, k], [0, -k]]) {
    setShear(kx, kz);
    renderer.clear(false, true, false);
    renderer.render(scene, cam);
  }
  const px = new Uint8Array(W * H * 4);
  renderer.readRenderTargetPixels(rt, 0, 0, W, H, px);
  renderer.setRenderTarget(prevTarget);
  renderer.setClearColor(prevClear, prevAlpha);
  renderer.autoClear = prevAutoClear;
  renderer.shadowMap.autoUpdate = shadowAuto;
  scene.overrideMaterial = prevOverride;
  for (const c of hidden) c.visible = true;
  rt.dispose();
  white.dispose();

  // distance field (metres) from the covered texels
  const N = W * H;
  const d = new Float32Array(N);
  let covered = 0;
  for (let i = 0; i < N; i++) {
    const on = px[i * 4] > 127;
    d[i] = on ? 0 : 1e9;
    if (on) covered++;
  }
  const D1 = res;
  const D2 = res * Math.SQRT2;
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      const o = j * W + i;
      let v = d[o];
      if (i > 0 && d[o - 1] + D1 < v) v = d[o - 1] + D1;
      if (j > 0) {
        if (d[o - W] + D1 < v) v = d[o - W] + D1;
        if (i > 0 && d[o - W - 1] + D2 < v) v = d[o - W - 1] + D2;
        if (i < W - 1 && d[o - W + 1] + D2 < v) v = d[o - W + 1] + D2;
      }
      d[o] = v;
    }
  }
  for (let j = H - 1; j >= 0; j--) {
    for (let i = W - 1; i >= 0; i--) {
      const o = j * W + i;
      let v = d[o];
      if (i < W - 1 && d[o + 1] + D1 < v) v = d[o + 1] + D1;
      if (j < H - 1) {
        if (d[o + W] + D1 < v) v = d[o + W] + D1;
        if (i < W - 1 && d[o + W + 1] + D2 < v) v = d[o + W + 1] + D2;
        if (i > 0 && d[o + W - 1] + D2 < v) v = d[o + W - 1] + D2;
      }
      d[o] = v;
    }
  }
  // encode 0..25.5 m in a byte; covered texels read slightly negative-ish (0)
  const enc = new Uint8Array(N);
  for (let i = 0; i < N; i++) enc[i] = Math.min(255, Math.round(d[i] * 10));
  const tex = new THREE.DataTexture(enc, W, H, THREE.RedFormat, THREE.UnsignedByteType);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.NoColorSpace;
  tex.name = 'water-contact';
  tex.needsUpdate = true;
  // uv = (xz - origin) * inv; the shader multiplies the texel by 25.5 to get metres
  const xf = new THREE.Vector4(x0, z0, 1 / (W * res), 1 / (H * res));
  return { tex, xf, stats: { W, H, covered, ms: Math.round(performance.now() - t0) } };
}
