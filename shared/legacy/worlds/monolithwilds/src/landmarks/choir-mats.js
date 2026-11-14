// Choir materials: obsidianGlyph variants patched so that
//  - the inscription bands read the baked per-stone coordinate `choirUv` (bands follow each stone
//    and start just under its crown, whatever its height, lean or motion);
//  - glyph brightness travels in slow waves outward from the centre (the giant sings first and the
//    choir answers ring by ring) — faint by day, the protagonist at night;
//  - the moving variant animates in the vertex shader (yaw about a per-stone pivot + bob), while
//    all procedural surface detail stays in the rest pose (object space), so nothing swims and no
//    per-frame JS is needed. A matching depth material keeps the shadows in step.

import * as THREE from 'crownfall-world-three';

const UV_PARS = 'attribute vec2 choirUv;\nvarying vec2 vChoirUv;\n';
const ANIM_PARS = 'attribute vec4 choirAnim;\nattribute vec2 choirBob;\nuniform vec4 uChoirT;\n';

function animBlock(withNormal) {
  return /* glsl */ `
  {
    float chA = choirAnim.w * uChoirT.x + choirAnim.z;
    float chC = cos(chA);
    float chS = sin(chA);
    vec2 chD = transformed.xz - choirAnim.xy;
    transformed.xz = choirAnim.xy + vec2(chC * chD.x - chS * chD.y, chS * chD.x + chC * chD.y);
    transformed.y += choirBob.x * sin(uChoirT.x * choirBob.y + choirAnim.z * 3.7);
    mvPosition = modelViewMatrix * vec4(transformed, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    ${withNormal ? `#ifndef FLAT_SHADED
    vec3 chN = objectNormal;
    chN.xz = vec2(chC * chN.x - chS * chN.z, chS * chN.x + chC * chN.z);
    vNormal = normalize(normalMatrix * chN);
    #endif` : ''}
  }
`;
}

// Outward travelling crest (~18 m/s, ~210 m apart) over a slower swell; per-glyph shimmer.
const PULSE = /* glsl */ `
    float chDist = length(vMwPos.xz - uChoirC);
    float chWave = 0.5 + 0.5 * sin(uMwTime.x * 0.55 - chDist * 0.03);
    float chSwell = 0.5 + 0.5 * sin(uMwTime.x * 0.21 - chDist * 0.0105 + 1.7);
    float pulse = 0.035 + 1.5 * pow(chWave, 8.0) + 0.12 * chSwell;
    pulse *= 0.82 + 0.18 * sin(uMwTime.x * 0.9 + cellId * 6.2831);
`;

/**
 * @param {object} ctx
 * @param {{local?: boolean, anim?: boolean, center?: number[], intensity?: number}} o
 */
export function choirGlyphMaterial(ctx, { local = false, anim = false, center = [0, 0], intensity = 2.3 } = {}) {
  const mat = ctx.materials.create('obsidianGlyph', {
    local,
    sparkle: 0.5,
    glyphs: { cell: 1.15, band: 14, height: 3.4, intensity, color: '#5fe6ff' },
  });
  const time = mat.userData.mwUniforms.uMwTime.value;
  const uniforms = {
    uChoirC: { value: new THREE.Vector2(center[0], center[1]) },
    uChoirT: { value: time },
  };
  const base = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => {
    base(shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    let vs = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${UV_PARS}${anim ? ANIM_PARS : ''}`)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvChoirUv = choirUv;');
    if (anim) vs = vs.replace('#include <logdepthbuf_vertex>', `${animBlock(true)}\n#include <logdepthbuf_vertex>`);
    shader.vertexShader = vs;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec2 uChoirC;\nvarying vec2 vChoirUv;')
      .replace('float bandCoord = uv.y / uMwGlyph.y;', 'uv = vChoirUv;\n    float bandCoord = uv.y / uMwGlyph.y;')
      .replace(/float pulse = [^;]*;/, PULSE)
      // by day the glyphs are etched (frosted grey on polished black) and barely glow
      .replace('float glow = uMwGlyph.w * (0.18 + 1.8 * uMwTime.y) * pulse;', 'float glow = uMwGlyph.w * (0.02 + 1.96 * uMwTime.y) * pulse;')
      .replace('albedo *= 1.0 - 0.7 * g;', 'albedo = mix(albedo, vec3(0.075, 0.08, 0.085), g * 0.85);\n    rough = mix(rough, 0.7, g);');
  };
  mat.userData.choir = uniforms;
  return mat;
}

/** Shadow depth material for the animated stones (same vertex motion). */
export function choirDepthMaterial(time) {
  const mat = new THREE.MeshDepthMaterial();
  const uniforms = { uChoirT: { value: time } };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${ANIM_PARS}`)
      .replace('#include <logdepthbuf_vertex>', `${animBlock(false)}\n#include <logdepthbuf_vertex>`);
  };
  mat.customProgramCacheKey = () => 'choir-depth-anim';
  return mat;
}
