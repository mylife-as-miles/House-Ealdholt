import {RIVER_BROAD_FIELD_GLSL} from './river-broad-field';
interface Shader { uniforms:Record<string,{value:unknown}>; vertexShader:string; fragmentShader:string }

/** A live material program identity, never a terrain/occupancy/bake identity. */
export const EALDHOLT_RIVER_FLOW_PROGRAM_KEY = ':ealdholt-downstream-river-flow:v7-bounded-2d-broad';

/** Crownfall's authored channel opens west. Continuous source X and the actual
 * signed bank offset keep the pattern continuous between channel sections.
 * BakedVoxelLighting's two advected layers and unresolved-roughness treatment
 * inform this sampler-free adaptation; see RIVER_FLOW_SURFACE.md. Neither the
 * source pond nor the sea opts into the channel field. No bathymetry is inferred. */
export function patchEaldholtRiverFlow(shader:Shader):void {
  if (/^\s*#define CROWNFALL_DOWNSTREAM_FLOW\b/m.test(shader.fragmentShader)) return;
  if (!shader.fragmentShader.includes('vEaldholtWaterSourcePosition')
    || !/^\s*#define CROWNFALL_COASTAL_WATER_SHORE_COLOR\b/m.test(shader.fragmentShader)) {
    throw Error('River flow requires existing source-space water and shore attributes.');
  }
  for (const seam of ['#include <common>', '#include <normal_fragment_maps>', '#include <lights_physical_fragment>']) {
    if (shader.fragmentShader.split(seam).length !== 2) throw Error('River flow requires the standard PBR surface path.');
  }
  shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
#define CROWNFALL_DOWNSTREAM_FLOW
vec2 cfRiverSourceGradient(vec2 p, float value) {
  vec2 dx = dFdx(p), dy = dFdy(p);
  float det = dx.x * dy.y - dx.y * dy.x;
  if (abs(det) <= .00000001) return vec2(0.);
  return vec2(dFdx(value) * dy.y - dFdy(value) * dx.y, dFdy(value) * dx.x - dFdx(value) * dy.x) / det;
}
vec2 cfDownstream(vec2 p, float across) {
  float slope = cfRiverSourceGradient(p, p.y - across).x;
  return normalize(vec2(-1., -clamp(slope, -3., 3.)));
}
float cfRiverBandVisibility(float phase) {
  float footprint = max(abs(dFdx(phase)), abs(dFdy(phase)));
  return 1. - smoothstep(.45, 1.6, footprint);
}
${RIVER_BROAD_FIELD_GLSL}
// xy: derivative of a bounded height field in channel coordinates; z: broken
// crest mask; w: unresolved fraction. Analytic gradients include crest bending.
vec4 cfRiverLayer(vec2 q) {
  float driftB = dot(q, vec2(-.21, .29)) + 1.7;
  float b = q.x * 3.7 - q.y * 1.15 + .8 * sin(driftB + .9);
  vec2 gradientB = vec2(3.7, -1.15) + vec2(-.21, .29) * (.8 * cos(driftB + .9));
  vec4 broad = cfRiverBroad(q);
  float visibleA = broad.w, visibleB = cfRiverBandVisibility(b);
  vec2 slope = broad.xy + gradientB * cos(b) * .0032 * visibleB;
  float crests = smoothstep(.3, .8, .5 + .25 * broad.z + .25 * sin(b)) * visibleA * visibleB;
  return vec4(slope, crests, 1. - .5 * (visibleA + visibleB));
}
vec4 cfRiverSurface(vec2 p, vec2 shore, float time, float contact) {
  float bank = max(0., shore.y - abs(shore.x));
  float speed = mix(.25, 1.15, smoothstep(0., 4., bank));
  vec2 coord = vec2(-p.x, shore.x);
  // Short dual-phase advection prevents indefinite stretching where the real
  // bank slows the flow. A phase resets only while its blend weight is zero.
  float phase = fract(time / 6.), other = fract(phase + .5);
  float blend = 1. - abs(phase * 2. - 1.);
  // Source-X metres/second, not constant arc-length speed. Keeping advection
  // independent of the derivative-built tangent makes phase filtering strictly
  // first order; GLSL does not define derivatives of derivative-built values.
  float velocity = speed;
  vec4 a = cfRiverLayer(coord - vec2(phase * 6. * velocity, 0.));
  vec4 b = cfRiverLayer(coord - vec2(other * 6. * velocity, 0.));
  vec4 field = mix(b, a, blend);
  // across = source Z - authored centre(source X). Its actual tangent, not a
  // rotating world-position dot product, transforms the local height gradient.
  vec2 flow = cfDownstream(p, shore.x);
  vec2 slope = vec2(-field.x - (flow.y / flow.x) * field.y, field.y);
  // The bank speed varies across the surface. Include that advection gradient
  // rather than changing height while leaving a straight, incoherent normal.
  float ageGradient = mix(b.x * other * 6., a.x * phase * 6., blend);
  // Half-width and signed across are the original linear strip varyings. The
  // exact smoothstep speed derivative is zero outside the 0..4m bank ramp;
  // sign(0)=0 chooses the symmetric derivative at the channel-centre cusp.
  vec2 bankGradient = cfRiverSourceGradient(p, shore.y) - sign(shore.x) * cfRiverSourceGradient(p, shore.x);
  float bankSpeedT = clamp(bank / 4., 0., 1.);
  float bankSpeedShear = (6. * .9 / 4.) * bankSpeedT * (1. - bankSpeedT);
  slope -= bankGradient * bankSpeedShear * ageGradient;
  float contactGain = 1. - contact;
  float foam = (1. - smoothstep(.15, 1.3, bank)) * field.z * .23 * contactGain;
  return vec4(slope * contactGain, foam, field.w * contactGain);
}`);
  // Colour/shore/contact and map/weather roughness are already evaluated by
  // this standard seam. Do not prepend work at color_fragment: another patch
  // may declare the contact scalar immediately after that include.
  shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
vec4 ealdholtRiverField = vec4(0.);
if (vEaldholtWaterShore.y > 0.) {
  ealdholtRiverField = cfRiverSurface(vEaldholtWaterSourcePosition.xz, vEaldholtWaterShore, uEaldholtRippleTime, ealdholtShoreContact);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.48, .52, .48), ealdholtRiverField.z);
  normal = normalize(normal + mat3(viewMatrix) * mat3(uEaldholtWaterSourceRotation) * vec3(-ealdholtRiverField.x, 0., -ealdholtRiverField.y));
}`);
  shader.fragmentShader = shader.fragmentShader.replace('#include <lights_physical_fragment>', `
if (vEaldholtWaterShore.y > 0.) {
  // Unresolved ripples broaden the reflection instead of leaving alternating
  // subpixel glints. Never lower map/weather/contact roughness already applied.
  roughnessFactor = max(roughnessFactor, .24 + .07 * ealdholtRiverField.w);
}
#include <lights_physical_fragment>`);
}
