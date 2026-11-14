/** Original Crownfall procedural VFX, not recovered Unreal flame particles.
 * Anchors use the source GLB campfire meshes; model coordinates are Y-up metres.
 * The optional point lights are new local fill, not imported smithy lights.
 * Flame bases clear the measured source log tops (1.18943m cooking,
 * 1.38645m smithies). A combustion field's bright root must start above its
 * opaque fuel bed; the previous decorative cards started inside the logs. */
export const EALDHOLT_FIRE_ANCHORS = Object.freeze([
  Object.freeze({ id: "cooking-hearth", position: [13.6683969, 1.20, 26.7691231] as const, width: .76, height: .76, phase: .3 }),
  Object.freeze({ id: "north-smithy", position: [18.3009338, 1.40, 63.9788742] as const, width: 1.14, height: 1.38, phase: 2.1 }),
  Object.freeze({ id: "west-smithy", position: [-8.83292007, 1.40, 9.47131443] as const, width: 1.14, height: 1.38, phase: 4.2 }),
  Object.freeze({ id: "east-smithy", position: [56.3578758, 1.40, 64.1532516] as const, width: 1.14, height: 1.38, phase: 6.4 }),
]);

/** Three crossed quads per hearth: four hearths cost only 24 triangles.
 * Reduced motion freezes time; neither the fill nor overall emission flashes. */
export const EALDHOLT_FIRE_VERTEX = /* glsl */ `
  uniform float uTime;
  uniform float uPhase;
  varying vec2 vFlameUv;
  void main() {
    vFlameUv = uv;
    vec3 p = position;
    p.x += sin(uv.y * 5.5 - uTime * 1.4 + uPhase) * .045 * uv.y * uv.y;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;

export const EALDHOLT_FIRE_FRAGMENT = /* glsl */ `
  uniform float uTime;
  uniform float uPhase;
  varying vec2 vFlameUv;
  void main() {
    vec2 p = vFlameUv;
    float t = uTime + uPhase;
    float bend = sin(p.y * 8.0 - t * 1.35) * .055 * p.y;
    float x = p.x - .5 - bend;
    float turbulence = sin(x * 27.0 + p.y * 13.0 - t * 1.9)
      * sin(x * 11.0 - p.y * 18.0 + t * 1.3);
    float width = mix(.38, .012, pow(p.y, .72));
    float edge = abs(x) + turbulence * .028 * p.y;
    float envelope = 1.0 - smoothstep(width * .48, width, edge);
    float root = smoothstep(.0, .09, p.y);
    float tip = 1.0 - smoothstep(.79, 1.0, p.y);
    float alpha = envelope * root * tip * .66;
    if (alpha < .018) discard;
    float core = (1.0 - smoothstep(.0, width * .58, abs(x)))
      * (1.0 - smoothstep(.16, .75, p.y));
    vec3 ember = vec3(1.0, .12, .012);
    vec3 gold = vec3(1.0, .58, .065);
    vec3 hot = vec3(1.0, .91, .54);
    vec3 color = mix(ember, gold, envelope * .78);
    color = mix(color, hot, core);
    gl_FragColor = vec4(color * 1.1, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;
