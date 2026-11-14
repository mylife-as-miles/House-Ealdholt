// STABLE FALLBACK sky for testing (modules=sky-basic). Do not edit; frozen copy of the placeholder.
import * as THREE from 'crownfall-world-three';

export async function build(ctx) {
  const { env } = ctx;
  const uniforms = {
    uZenith: { value: new THREE.Color() },
    uHorizon: { value: new THREE.Color() },
    uSunDir: { value: new THREE.Vector3() },
    uSunColor: { value: new THREE.Color() },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    side: THREE.BackSide,
    depthWrite: false,
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uZenith, uHorizon, uSunDir, uSunColor;
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        float h = max(d.y, 0.0);
        vec3 col = mix(uHorizon, uZenith, pow(h, 0.45));
        if (d.y < 0.0) col = uHorizon * 0.8;
        float s = max(dot(d, uSunDir), 0.0);
        col += uSunColor * (pow(s, 900.0) * 30.0 + pow(s, 12.0) * 0.35);
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(10000, 32, 16), mat);
  sky.frustumCulled = false;
  sky.renderOrder = -1;
  sky.name = 'sky';
  ctx.scene.add(sky);
  ctx.scene.background = null;
  const sync = () => {
    uniforms.uZenith.value.copy(env.palette.zenith);
    uniforms.uHorizon.value.copy(env.palette.horizon);
    uniforms.uSunDir.value.copy(env.sunDir);
    uniforms.uSunColor.value.copy(env.palette.sun);
  };
  sync();
  env.onChange(sync);
  return {
    update() {
      sky.position.copy(ctx.camera.position);
    },
  };
}
