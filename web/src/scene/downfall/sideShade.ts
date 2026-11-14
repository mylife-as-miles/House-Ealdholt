import * as THREE from "three";
import type { DownfallShade } from "./downfallPlan";

/**
 * The light leaving the beaten side of the board. A sheet laid on the stone that multiplies what is under it
 * by less than one: a darkening that spreads outward from the beaten King's square with the realization,
 * deepening over his half of the board and fading to nothing at the middle line and the board's edge, so the
 * victors' half and the hall beyond keep their light. It casts nothing and lights nothing: removing the sheet
 * puts every pixel back exactly as it was, so nothing of it can carry into the next game.
 */
export class SideShade {
  readonly mesh: THREE.Mesh;
  private readonly material: THREE.ShaderMaterial;

  /** @param half half the board's width (world units), @param y the stone's height */
  constructor(half: number, y: number) {
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uCentre: { value: new THREE.Vector2() },
        uRadius: { value: 0 },
        uSoft: { value: 1 },
        uStrength: { value: 0 },
        uSide: { value: 1 },
        uHalf: { value: half },
      },
      vertexShader: /* glsl */`
        varying vec2 vWorld;
        void main() {
          vec4 world = modelMatrix * vec4(position, 1.0);
          vWorld = world.xz;
          gl_Position = projectionMatrix * viewMatrix * world;
        }`,
      fragmentShader: /* glsl */`
        uniform vec2 uCentre;
        uniform float uRadius, uSoft, uStrength, uSide, uHalf;
        varying vec2 vWorld;
        void main() {
          float reached = 1.0 - smoothstep(uRadius - uSoft, uRadius + uSoft, distance(vWorld, uCentre));
          // Nothing on the victors' half; the full dark a square and a half into the beaten one.
          float beaten = smoothstep(-0.25, 1.6, vWorld.y * uSide);
          float inside = 1.0 - smoothstep(uHalf - 0.45, uHalf + 0.02, max(abs(vWorld.x), abs(vWorld.y)));
          float shade = clamp(uStrength * reached * beaten * inside, 0.0, 0.9);
          gl_FragColor = vec4(vec3(1.0 - shade), 1.0);
        }`,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      // dst * src: a pure darkening, whatever the target's format.
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.ZeroFactor,
      blendDst: THREE.SrcColorFactor,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -4,
      fog: false,
      toneMapped: false,
    });
    const geometry = new THREE.PlaneGeometry(half * 2 + 0.2, half * 2 + 0.2);
    geometry.rotateX(-Math.PI / 2);
    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.name = "downfall_shade";
    this.mesh.position.y = y;
    // After the board and its contact shadows, before the team rings that sit just above.
    this.mesh.renderOrder = 2;
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    this.mesh.visible = false;
  }

  /** How far the dark has spread at `time` (downfall clock seconds). */
  set(shade: DownfallShade, time: number): void {
    const u = this.material.uniforms;
    const t = time - shade.from;
    u.uCentre.value.set(shade.x, shade.z);
    u.uRadius.value = Math.max(0, t) * shade.speed;
    u.uSoft.value = shade.soft;
    u.uSide.value = shade.side;
    const rise = Math.min(1, Math.max(0, t / 2.2));
    u.uStrength.value = shade.strength * rise * rise * (3 - 2 * rise);
    this.mesh.visible = t > 0;
  }

  /** Read back for tests and diagnostics. */
  get strength(): number { return this.material.uniforms.uStrength.value as number; }
  get radius(): number { return this.material.uniforms.uRadius.value as number; }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
