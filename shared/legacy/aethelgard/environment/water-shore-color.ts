import type { EaldholtCoastalShape } from './coastal-valley';

export const EALDHOLT_WATER_SHORE_CACHE_KEY = ':ealdholt-original-shore-colour:v3-contact';
export const EALDHOLT_WATER_SHORE_ATTRIBUTES = Object.freeze({ across: 'ealdholtWaterAcross', halfWidth: 'ealdholtWaterHalfWidth' });
export const EALDHOLT_WATER_SHORE_LOOK = Object.freeze({
  shallowLinearColor: [.035, .078, .084] as readonly [number, number, number], strength: .6,
  startMetres: .15, endMetres: 6,
  // Lateral contact only: these are the existing wet-soil palette and a rougher
  // water skin at a real bank. They do not describe an inferred bottom depth.
  contactLinearColor: [.063, .0486, .0324] as readonly [number, number, number],
  contactMetres: 1.35, contactStrength: .92, contactRoughness: .62,
});
export interface EaldholtWaterShoreAttributes {
  /** Channel: signed cross-channel offset. Sea: distance to actual coast. */
  across: Float32Array;
  /** Channel: positive bank half-width. Sea: -1 (one-sided coast distance). */
  halfWidth: Float32Array;
}
export interface EaldholtCoastalWaterShoreAttributes {
  channel: EaldholtWaterShoreAttributes;
  sea: EaldholtWaterShoreAttributes;
  byteLength: number;
}
type Surface = { readonly positions: Float32Array };
type Segment = readonly [ax: number, az: number, bx: number, bz: number];
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
// GLSL does not implicitly convert an integer literal for float overloads.
const glslFloat = (value: number) => Number.isInteger(value) ? `${value}.0` : `${value}`;
const tolerance = .0005;

function validateShape(shape: EaldholtCoastalShape): void {
  if (![shape.coastX, shape.seaLevel, shape.mouthLowZ, shape.mouthHighZ, shape.seaMinX, shape.seaMinZ, shape.seaMaxZ].every(Number.isFinite)
    || shape.seaMinX >= shape.coastX || shape.seaMinZ >= shape.seaMaxZ || shape.mouthLowZ >= shape.mouthHighZ
    || shape.mouthLowZ < shape.seaMinZ || shape.mouthHighZ > shape.seaMaxZ) throw Error('Invalid coastal water shore envelope.');
  for (const [samples, stride] of [[shape.coastSamples, 2], [shape.channelSamples, 4]] as const) {
    if (!(samples instanceof Float32Array) || samples.length < stride * 2 || samples.length % stride) throw Error('Incomplete coastal water samples.');
    for (let i = 0; i < samples.length; i++) if (!Number.isFinite(samples[i]) || (i >= stride && i % stride === 0 && samples[i] <= samples[i - stride])) throw Error('Coastal water samples must be finite and ordered.');
  }
  if (Math.abs(shape.coastSamples[0] - shape.seaMinZ) > tolerance
    || Math.abs(shape.coastSamples[shape.coastSamples.length - 2] - shape.seaMaxZ) > tolerance
    || Math.abs(shape.channelSamples[0] - shape.coastX) > tolerance) throw Error('Coastal water samples do not cover their envelope.');
}
function rowValue(samples: Float32Array, stride: number, coordinate: number, offset: number): number {
  if (coordinate <= samples[0]) return samples[offset];
  const last = samples.length - stride;
  if (coordinate >= samples[last]) return samples[last + offset];
  for (let i = stride; i < samples.length; i += stride) if (coordinate <= samples[i]) {
    return mix(samples[i - stride + offset], samples[i + offset], (coordinate - samples[i - stride]) / (samples[i] - samples[i - stride]));
  }
  return samples[last + offset];
}
function coastalSegments(shape: EaldholtCoastalShape): Segment[] {
  const result: Segment[] = [], samples = shape.coastSamples;
  for (let i = 2; i < samples.length; i += 2) {
    const za = samples[i - 2], xa = samples[i - 1], zb = samples[i], xb = samples[i + 1];
    // Clip OUT the opening: the sea/channel seam is not a physical coastline.
    for (const [low, high] of [[za, Math.min(zb, shape.mouthLowZ)], [Math.max(za, shape.mouthHighZ), zb]]) {
      if (high <= low) continue;
      result.push([mix(xa, xb, (low - za) / (zb - za)), low, mix(xa, xb, (high - za) / (zb - za)), high]);
    }
  }
  return result;
}
function distanceToCoast(x: number, z: number, segments: readonly Segment[]): number {
  // A fully open edge has no shore colour. This finite sentinel saturates only
  // the colour approximation; it does not invent a sea bed or physical depth.
  let distance = 1e6;
  for (const [ax, az, bx, bz] of segments) {
    const dx = bx - ax, dz = bz - az, length = dx * dx + dz * dz;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / length));
    distance = Math.min(distance, Math.hypot(x - ax - t * dx, z - az - t * dz));
  }
  return distance;
}
function validateSurface(surface: Surface): number {
  if (!(surface.positions instanceof Float32Array) || surface.positions.length < 12 || surface.positions.length % 6 || surface.positions.length / 3 > 65535
    || !surface.positions.every(Number.isFinite)) throw Error('Expected a finite paired coastal water strip.');
  return surface.positions.length / 3;
}

/** Runtime-only geometry intake. Returned buffers are newly owned and contain
 * two scalar floats per water vertex (8bytes); the inputs remain unchanged.
 * Across/half-width interpolation gives a continuous bank distance even when
 * every channel vertex lies on a shore. No open end or outer sea edge is used
 * as a shoreline. This is a shallow-colour approximation, not depth optics. */
export function createEaldholtCoastalWaterShoreAttributes(
  shape: EaldholtCoastalShape, channel: Surface, sea: Surface,
): EaldholtCoastalWaterShoreAttributes {
  validateShape(shape);
  const channelVertices = validateSurface(channel), seaVertices = validateSurface(sea);
  if (channelVertices !== shape.channelSamples.length / 2 || seaVertices !== shape.coastSamples.length) throw Error('Coastal strips and paired shape samples disagree.');
  const channelAttributes = { across: new Float32Array(channelVertices), halfWidth: new Float32Array(channelVertices) };
  for (let i = 0, row = 0; i < channel.positions.length; i += 6, row += 4) {
    const p = channel.positions, samples = shape.channelSamples, x = p[i], low = samples[row + 1], high = samples[row + 2], level = samples[row + 3];
    if (!(high > low) || Math.abs(x - samples[row]) > tolerance || Math.abs(p[i + 3] - x) > tolerance
      || Math.abs(p[i + 1] - level) > tolerance || Math.abs(p[i + 4] - level) > tolerance
      || Math.abs(p[i + 2] - low) > tolerance || Math.abs(p[i + 5] - high) > tolerance) throw Error('Channel vertices must match their actual paired banks.');
    const width = (high - low) / 2, index = i / 3;
    channelAttributes.across[index] = -width; channelAttributes.across[index + 1] = width;
    channelAttributes.halfWidth[index] = channelAttributes.halfWidth[index + 1] = width;
  }
  const seaAttributes = { across: new Float32Array(seaVertices), halfWidth: new Float32Array(seaVertices) }, segments = coastalSegments(shape);
  seaAttributes.halfWidth.fill(-1);
  for (let i = 0; i < sea.positions.length; i += 3) {
    const x = sea.positions[i], y = sea.positions[i + 1], z = sea.positions[i + 2];
    if (x < shape.seaMinX - tolerance || x > rowValue(shape.coastSamples, 2, z, 1) + tolerance
      || z < shape.seaMinZ - tolerance || z > shape.seaMaxZ + tolerance || Math.abs(y - shape.seaLevel) > tolerance) throw Error('Sea vertices exceed their actual coastal support.');
    seaAttributes.across[i / 3] = distanceToCoast(x, z, segments);
  }
  return { channel: channelAttributes, sea: seaAttributes,
    byteLength: channelAttributes.across.byteLength + channelAttributes.halfWidth.byteLength + seaAttributes.across.byteLength + seaAttributes.halfWidth.byteLength };
}

/** Mirrors the arithmetic used after perspective-correct interpolation. */
export function ealdholtWaterShoreDistance(across: number, halfWidth: number): number {
  if (!Number.isFinite(across) || !Number.isFinite(halfWidth) || (halfWidth <= 0 && halfWidth !== -1)) throw Error('Invalid interpolated water shore attributes.');
  return Math.max(0, halfWidth < 0 ? across : halfWidth - Math.abs(across));
}
export interface EaldholtWaterShoreColorShader { uniforms: Record<string, { value: unknown }>; vertexShader: string; fragmentShader: string }

/** Compose on the owned regional river/sea PBR material only. The real lateral
 * distance drives a wet-soil contact colour and a rougher reflection at banks;
 * it is not interpreted as bottom depth. Three's dielectric Fresnel/IOR and
 * normal/ripple path stay intact, as do source pond materials. No extra sampler,
 * opacity, discard, depth pass, geometry change or per-frame CPU work. */
export function patchEaldholtWaterShoreColor(shader: EaldholtWaterShoreColorShader): void {
  // The weather hook contains an #ifdef for this feature before it is applied.
  // Only our actual definition proves that declarations and uniforms exist.
  if (/^\s*#define CROWNFALL_COASTAL_WATER_SHORE_COLOR\b/m.test(shader.fragmentShader)) return;
  for (const [source, seam] of [[shader.vertexShader, '#include <common>'], [shader.vertexShader, '#include <begin_vertex>'],
    [shader.fragmentShader, '#include <common>'], [shader.fragmentShader, '#include <color_fragment>'],
    [shader.fragmentShader, '#include <roughnessmap_fragment>'], [shader.fragmentShader, '#include <lights_physical_fragment>']]) {
    if (source.split(seam).length !== 2) throw Error('Coastal shore colour requires the standard PBR colour path.');
  }
  shader.uniforms.uEaldholtShallowLinearColor = { value: [...EALDHOLT_WATER_SHORE_LOOK.shallowLinearColor] };
  shader.uniforms.uEaldholtShoreContactLinearColor = { value: [...EALDHOLT_WATER_SHORE_LOOK.contactLinearColor] };
  shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>
attribute float ealdholtWaterAcross;
attribute float ealdholtWaterHalfWidth;
varying vec2 vEaldholtWaterShore;`);
  shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
vEaldholtWaterShore = vec2(ealdholtWaterAcross, ealdholtWaterHalfWidth);`);
  shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
#define CROWNFALL_COASTAL_WATER_SHORE_COLOR
uniform vec3 uEaldholtShallowLinearColor;
uniform vec3 uEaldholtShoreContactLinearColor;
varying vec2 vEaldholtWaterShore;`);
  shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
float ealdholtBankDistance = max(vEaldholtWaterShore.y - abs(vEaldholtWaterShore.x), 0.);
float ealdholtCoastDistance = max(vEaldholtWaterShore.x, 0.);
float ealdholtShoreDistance = mix(ealdholtCoastDistance, ealdholtBankDistance, step(0., vEaldholtWaterShore.y));
float ealdholtShallowColour = (1. - smoothstep(${glslFloat(EALDHOLT_WATER_SHORE_LOOK.startMetres)}, ${glslFloat(EALDHOLT_WATER_SHORE_LOOK.endMetres)}, ealdholtShoreDistance)) * ${glslFloat(EALDHOLT_WATER_SHORE_LOOK.strength)};
// A finite pixel footprint keeps a thin contact band from flickering at Low's
// coarse resolution; it never expands a water mesh or creates an open-edge band.
float ealdholtContactWidth = max(${glslFloat(EALDHOLT_WATER_SHORE_LOOK.contactMetres)}, min(fwidth(ealdholtShoreDistance), ${glslFloat(EALDHOLT_WATER_SHORE_LOOK.endMetres)}));
float ealdholtShoreContact = 1. - smoothstep(0., ealdholtContactWidth, ealdholtShoreDistance);
diffuseColor.rgb = mix(diffuseColor.rgb, uEaldholtShallowLinearColor, ealdholtShallowColour);
diffuseColor.rgb = mix(diffuseColor.rgb, uEaldholtShoreContactLinearColor, ealdholtShoreContact * ${glslFloat(EALDHOLT_WATER_SHORE_LOOK.contactStrength)});`);
  shader.fragmentShader = shader.fragmentShader.replace('#include <lights_physical_fragment>', `
// Preserve dielectric Fresnel instead of adding a camera-facing painted glint.
// Apply after map/weather roughness, regardless of patch composition order,
// but before Three assembles the physical material used by its lighting.
roughnessFactor = mix(roughnessFactor, max(roughnessFactor, ${glslFloat(EALDHOLT_WATER_SHORE_LOOK.contactRoughness)}), ealdholtShoreContact);
#include <lights_physical_fragment>`);
}
