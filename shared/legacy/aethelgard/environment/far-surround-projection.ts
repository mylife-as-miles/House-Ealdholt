import { EALDHOLT_FAR_COAST_SAMPLE_LIMIT, EALDHOLT_FAR_CHANNEL_SAMPLE_LIMIT,
  sampleEaldholtFarGeography, type EaldholtFarProjectionPacket } from './far-surround';
import { EALDHOLT_WATER_LOOK } from './water-look';
import { EALDHOLT_CLOUDS } from './atmosphere';
import { EALDHOLT_VILLAGE_DAYLIGHT } from './daylight';
import { EALDHOLT_FAR_BOUNDARY_SAMPLES, sampleEaldholtFarBoundaryField, type EaldholtFarBoundary } from './far-projection-boundary';
export const EALDHOLT_FAR_SOURCE_SUN = EALDHOLT_VILLAGE_DAYLIGHT.sunOffset;
/** Native viewport review found visible sea/land joins. Keep the candidate
 * out of runtime and matching probe authoring until that interface qualifies. */
export const EALDHOLT_NATIVE_FAR_PROJECTION_READY: boolean = false;

export interface EaldholtFarProjectionData {
  readonly coast: Float32Array; readonly channel: Float32Array;
  readonly coastCount: number; readonly channelCount: number;
  readonly seaLevel: number; readonly origin: readonly [number, number];
  readonly localXZ: readonly [number, number, number, number];
  readonly landField: readonly [number, number, number, number, number];
}
export interface EaldholtFarProjectionDiagnostics {
  readonly enabled: true; readonly nonSolid: true; readonly localPlacementEligible: false;
  readonly drawCallsAdded: 0; readonly textureBytesAdded: 0; readonly borrowedGrassMap: boolean;
  readonly grassTileMetres: number; readonly grassSourceAssetId: string | null; readonly grassScaleAssumed: boolean;
  readonly axes: 'source:+X-east/-Z-north'; readonly localBounds: EaldholtFarProjectionPacket['localBounds'];
  readonly boundary: { readonly samples: number; readonly cpuBytes: number; readonly maximumQuantizationError: number; readonly setupMilliseconds: number; readonly mainlandSamples: number; readonly waterSamples: number; readonly transitionMetres: 64 };
}
/** Immutable intake copy; arrays are packed before rendering, never per eye. */
export function createEaldholtFarProjectionData(packet: EaldholtFarProjectionPacket): EaldholtFarProjectionData {
  if (packet.geography.mainlandRelief) throw Error('Native projection is unqualified for layered mainland.');
  const g = packet.geography, coastCount = g.coastSamples.length / 2, channelCount = g.channelSamples.length / 4;
  if (g.version !== 1 || g.axes !== 'source:+X-east/-Z-north' || !Number.isInteger(coastCount) || !Number.isInteger(channelCount)
    || coastCount < 2 || coastCount > EALDHOLT_FAR_COAST_SAMPLE_LIMIT || channelCount < 2 || channelCount > EALDHOLT_FAR_CHANNEL_SAMPLE_LIMIT) throw Error('Invalid far projection geography.');
  const f = g.landField, values = [g.seaLevel, g.sourceEnvelope.minX, g.sourceEnvelope.minZ,
    f.baseHeight, f.xAmplitude, f.zAmplitude, f.xScale, f.zScale, ...packet.localBounds.min, ...packet.localBounds.max];
  if (!values.every(Number.isFinite) || f.xScale <= 0 || f.zScale <= 0
    || packet.localBounds.min.some((v, i) => v >= packet.localBounds.max[i])) throw Error('Invalid far projection frame.');
  const coast = new Float32Array(Math.ceil(EALDHOLT_FAR_COAST_SAMPLE_LIMIT / 2) * 4);
  const channel = new Float32Array(EALDHOLT_FAR_CHANNEL_SAMPLE_LIMIT * 4);
  for (const [source, stride, target] of [[g.coastSamples, 2, coast], [g.channelSamples, 4, channel]] as const) {
    for (let i = 0; i < source.length; i++) {
      if (!Number.isFinite(source[i]) || i % stride === 0 && i && source[i] <= source[i - stride]) throw Error('Unordered/nonfinite far projection samples.');
      target[i] = source[i];
    }
  }
  for (let i = 0; i < channelCount; i++) if (channel[i * 4 + 1] >= channel[i * 4 + 2]) throw Error('Invalid far projection river shores.');
  return { coast, channel, coastCount, channelCount, seaLevel: g.seaLevel,
    localXZ: [packet.localBounds.min[0], packet.localBounds.max[0], packet.localBounds.min[2], packet.localBounds.max[2]],
    origin: [g.sourceEnvelope.minX, g.sourceEnvelope.minZ], landField: [f.baseHeight, f.xAmplitude, f.zAmplitude, f.xScale, f.zScale] };
}

/** Bounded CPU companion for geometric ray/edge tests, not a visual proof. */
export function traceEaldholtFarProjection(packet: EaldholtFarProjectionPacket, origin: readonly number[], ray: readonly number[], boundary?: EaldholtFarBoundary): { point: readonly number[]; kind: 'sea' | 'channel' | 'mainland'; distance: number } | null {
  if (packet.geography.mainlandRelief) throw Error('Native projection is unqualified for layered mainland.');
  if (origin.length !== 3 || ray.length !== 3 || ![...origin, ...ray].every(Number.isFinite)) throw Error('Invalid far projection ray.');
  const length = Math.hypot(...ray); if (length < 1e-12) return null;
  const d = ray.map(n => n / length), g = packet.geography, p = [0, 0, 0];
  const fieldAt = (x: number, z: number) => sampleEaldholtFarBoundaryField(packet, boundary, x, z);
  const at = (t: number) => { for (let i = 0; i < 3; i++) p[i] = origin[i] + d[i] * t; };
  const bounds = packet.localBounds, inside = (q: readonly number[]) => q[0] >= bounds.min[0] && q[0] <= bounds.max[0] && q[2] >= bounds.min[2] && q[2] <= bounds.max[2];
  let entry = -1e6 - 1, exit = 1e6 + 1;
  for (const axis of [0, 2]) {
    if (Math.abs(d[axis]) < 1e-9) { if (origin[axis] < bounds.min[axis] || origin[axis] > bounds.max[axis]) { entry = 1; exit = -1; break; } }
    else { const a = (bounds.min[axis] - origin[axis]) / d[axis], b = (bounds.max[axis] - origin[axis]) / d[axis]; entry = Math.max(entry, Math.min(a, b)); exit = Math.min(exit, Math.max(a, b)); }
  }
  const afterExit = exit + .002 / Math.max(Math.abs(d[0]), Math.abs(d[2]), 1e-9);
  let start = inside(origin) ? afterExit : 0;
  for (let pass = 0; pass < 2; pass++) {
    if (start >= 1e6) return null;
    if (start > 0) { at(start); const field = fieldAt(p[0], p[2]); if (!inside(p) && p[1] <= field.level) return { point: [...p], kind: field.kind, distance: start }; }
    if (Math.abs(d[1]) < 1e-5) return null;
    let t = Math.max(start, Math.min(1e6, (g.seaLevel - origin[1]) / d[1])), desired = t;
    for (let i = 0; i < 3; i++) { at(t); desired = (fieldAt(p[0], p[2]).level - origin[1]) / d[1]; t = Math.max(start, Math.min(1e6, desired)); }
    if (desired < start || t <= 0 || desired > 1e6) return null; at(t);
    if (!inside(p)) return { point: [...p], kind: fieldAt(p[0], p[2]).kind, distance: t };
    if (exit < Math.max(entry, 0)) return null; start = afterExit;
  }
  return null;
}

/** Shared by Native and Desktop quest-profile pond authoring. The backing
 * sphere adds no solid terrain, navigation, picking or framing envelope. */
export const EALDHOLT_FAR_PROJECTION_GLSL = `
uniform mat4 uEaldholtDomeToSource;
uniform vec4 uEaldholtFarCoast[${Math.ceil(EALDHOLT_FAR_COAST_SAMPLE_LIMIT / 2)}];
uniform vec4 uEaldholtFarChannel[${EALDHOLT_FAR_CHANNEL_SAMPLE_LIMIT}];
uniform int uEaldholtFarCoastCount;
uniform int uEaldholtFarChannelCount;
uniform float uEaldholtFarSeaLevel;
uniform vec2 uEaldholtFarOrigin;
uniform vec3 uEaldholtFarLandAmplitude;
uniform vec2 uEaldholtFarLandScale;
uniform vec4 uEaldholtFarLocalXZ;
uniform vec2 uEaldholtFarBoundaryRange;
uniform float uEaldholtFarBoundaryTextureSize;
uniform vec3 uEaldholtFarSourceSun;
uniform sampler2D uEaldholtFarGrass;
uniform float uEaldholtFarHasGrass;
uniform float uEaldholtFarGrassTile;
vec2 ealdholtFarCoastRow(int id) {
  vec4 row = uEaldholtFarCoast[id / 2];
  return id - (id / 2) * 2 == 0 ? row.xy : row.zw;
}
float ealdholtFarCoastX(float z) {
  int lo = 0; int hi = uEaldholtFarCoastCount - 1;
  for (int step = 0; step < 7; step++) {
    int mid = (lo + hi) / 2;
    if (z < ealdholtFarCoastRow(mid).x) hi = mid; else lo = mid;
  }
  vec2 a = ealdholtFarCoastRow(lo), b = ealdholtFarCoastRow(hi);
  return mix(a.y, b.y, clamp((z - a.x) / max(b.x - a.x, .00001), 0., 1.));
}
vec3 ealdholtFarChannelRow(float x) {
  int lo = 0; int hi = uEaldholtFarChannelCount - 1;
  for (int step = 0; step < 7; step++) {
    int mid = (lo + hi) / 2;
    if (x < uEaldholtFarChannel[mid].x) hi = mid; else lo = mid;
  }
  vec4 a = uEaldholtFarChannel[lo], b = uEaldholtFarChannel[hi];
  return mix(a.yzw, b.yzw, clamp((x - a.x) / max(b.x - a.x, .00001), 0., 1.));
}
`;

export const EALDHOLT_FAR_PROJECTION_SURFACE_GLSL = `
float ealdholtBoundaryHeight(float id) {
  float width = uEaldholtFarBoundaryTextureSize;
  vec2 uv = (vec2(mod(id, width), floor(id / width)) + .5) / width;
  // G/B carry a16bit code. Base LOD and exact texel centres prevent mip or
  // byte-carry interpolation; cloud coverage reads the unchanged R channel.
  vec2 bytes = floor(textureLod(uEaldholtCloudNoise, uv, 0.).gb * 255. + .5);
  return uEaldholtFarBoundaryRange.x + (bytes.x * 256. + bytes.y) / 65535. * uEaldholtFarBoundaryRange.y;
}
float ealdholtBoundaryLand(vec2 p, float analytical) {
  vec2 low = uEaldholtFarLocalXZ.xz, high = uEaldholtFarLocalXZ.yw;
  vec2 q = clamp(p, low, high), delta = p - q;
  float edge = abs(delta.x) >= abs(delta.y) ? (delta.x < 0. ? 0. : 1.) : (delta.y < 0. ? 2. : 3.);
  if (delta.x == 0. && delta.y == 0.) {
    vec4 distances = vec4(p.x - low.x, high.x - p.x, p.y - low.y, high.y - p.y);
    float nearest = distances.x; edge = 0.;
    if (distances.y < nearest) { nearest = distances.y; edge = 1.; }
    if (distances.z < nearest) { nearest = distances.z; edge = 2.; }
    if (distances.w < nearest) edge = 3.;
  }
  float t = edge < 2. ? (q.y - low.y) / (high.y - low.y) : (q.x - low.x) / (high.x - low.x);
  float f = clamp(t * ${EALDHOLT_FAR_BOUNDARY_SAMPLES - 1}., 0., ${EALDHOLT_FAR_BOUNDARY_SAMPLES - 1}.), a = floor(f);
  float height = mix(ealdholtBoundaryHeight(edge * ${EALDHOLT_FAR_BOUNDARY_SAMPLES}. + a), ealdholtBoundaryHeight(edge * ${EALDHOLT_FAR_BOUNDARY_SAMPLES}. + min(a + 1., ${EALDHOLT_FAR_BOUNDARY_SAMPLES - 1}.)), f - a);
  return mix(height, analytical, smoothstep(0., 64., length(delta)));
}
// Exact coast/river/lowland field from the one canonical geography packet.
vec2 ealdholtFarField(vec2 p) {
  if (p.x <= ealdholtFarCoastX(p.y)) return vec2(0., uEaldholtFarSeaLevel);
  if (p.x >= uEaldholtFarChannel[0].x) {
    vec3 river = ealdholtFarChannelRow(p.x);
    if (p.y >= river.x && p.y <= river.y) return vec2(1., river.z);
  }
  vec2 phase = (p - uEaldholtFarOrigin) / uEaldholtFarLandScale;
  float height = uEaldholtFarSeaLevel + uEaldholtFarLandAmplitude.x
    + uEaldholtFarLandAmplitude.y * sin(phase.x) + uEaldholtFarLandAmplitude.z * cos(phase.y);
  return vec2(2., ealdholtBoundaryLand(p, height));
}
bool ealdholtInsideFarLocal(vec2 p) {
  return p.x >= uEaldholtFarLocalXZ.x && p.x <= uEaldholtFarLocalXZ.y
    && p.y >= uEaldholtFarLocalXZ.z && p.y <= uEaldholtFarLocalXZ.w;
}
vec2 ealdholtFarLocalInterval(vec2 origin, vec2 direction) {
  vec2 interval = vec2(-1000001., 1000001.);
  vec2 low = uEaldholtFarLocalXZ.xz, high = uEaldholtFarLocalXZ.yw;
  for (int axis = 0; axis < 2; axis++) {
    if (abs(direction[axis]) < .000000001) {
      if (origin[axis] < low[axis] || origin[axis] > high[axis]) return vec2(1., -1.);
    } else {
      float a = (low[axis] - origin[axis]) / direction[axis];
      float b = (high[axis] - origin[axis]) / direction[axis];
      interval.x = max(interval.x, min(a, b)); interval.y = min(interval.y, max(a, b));
    }
  }
  return interval;
}
float ealdholtFarDistance(vec3 origin, vec3 direction) {
  vec2 interval = ealdholtFarLocalInterval(origin.xz, direction.xz);
  float afterExit = interval.y + .002 / max(max(abs(direction.x), abs(direction.z)), .000000001);
  float start = ealdholtInsideFarLocal(origin.xz) ? afterExit : 0.;
  // At most two domains: an outside eye may hit BEFORE local entry. Only a
  // candidate inside that interval skips to its exit. Never fill local skies.
  for (int pass = 0; pass < 2; pass++) {
    if (start >= 1000000.) return -1.;
    if (start > 0.) {
      vec3 atExit = origin + direction * start;
      if (!ealdholtInsideFarLocal(atExit.xz) && atExit.y <= ealdholtFarField(atExit.xz).y) return start;
    }
    if (abs(direction.y) < .00001) return -1.;
    float distance = clamp((uEaldholtFarSeaLevel - origin.y) / direction.y, start, 1000000.);
    float desired = distance;
    for (int step = 0; step < 3; step++) {
      vec3 p = origin + direction * distance;
      desired = (ealdholtFarField(p.xz).y - origin.y) / direction.y;
      distance = clamp(desired, start, 1000000.);
    }
    if (desired < start || desired > 1000000. || distance <= 0.) return -1.;
    if (!ealdholtInsideFarLocal((origin + direction * distance).xz)) return distance;
    if (interval.y < max(interval.x, 0.)) return -1.;
    start = afterExit;
  }
  return -1.;
}
vec4 ealdholtProjectFar(vec3 domePoint, vec3 domeObserver, vec3 skyColour) {
  vec3 origin = (uEaldholtDomeToSource * vec4(domeObserver, 1.)).xyz;
  vec3 direction = normalize(mat3(uEaldholtDomeToSource) * (domePoint - domeObserver));
  float distance = ealdholtFarDistance(origin, direction);
  if (distance <= 0.) return vec4(0.);
  vec3 p = origin + direction * distance;
  vec2 field = ealdholtFarField(p.xz);
  if (field.x < 1.5) {
    float fresnel = pow(1. - clamp(abs(direction.y), 0., 1.), 4.);
    float ripples = sin(p.x * .17 + p.z * .13 + uEaldholtCloudTime * .35)
      * sin(p.z * .11 - p.x * .07 - uEaldholtCloudTime * .21);
    vec3 colour = mix(vec3(${EALDHOLT_WATER_LOOK.linearBaseColor.join(', ')}), skyColour * .65, .32 + fresnel * .57);
    return vec4(colour * (1. + ripples * .035), 1.);
  }
  vec2 phase = (p.xz - uEaldholtFarOrigin) / uEaldholtFarLandScale;
  vec3 normal = normalize(vec3(-uEaldholtFarLandAmplitude.y / uEaldholtFarLandScale.x * cos(phase.x),
    1., uEaldholtFarLandAmplitude.z / uEaldholtFarLandScale.y * sin(phase.y)));
  vec3 sun = normalize(uEaldholtFarSourceSun);
  float light = .56 + .44 * max(0., dot(normal, sun));
  float broad = texture2D(uEaldholtCloudNoise, p.xz * .0023).r;
  vec3 ground = vec3(.063, .080, .034);
  if (uEaldholtFarHasGrass > .5) ground = texture2D(uEaldholtFarGrass, vec2(p.x, -p.z) / uEaldholtFarGrassTile).rgb;
  return vec4(ground * light * (.78 + broad * .44), 1.);
}
`;

export const EALDHOLT_FAR_ATMOSPHERE_VERTEX = `varying vec3 vEaldholtSkyPosition;
void main() {
  vEaldholtSkyPosition = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.);
}`;
export const EALDHOLT_FAR_ATMOSPHERE_FRAGMENT = `
uniform sampler2D uEaldholtCloudNoise;
uniform float uEaldholtCloudTime;
uniform vec3 uEaldholtCloudObserver;
varying vec3 vEaldholtSkyPosition;
${EALDHOLT_FAR_PROJECTION_GLSL}
${EALDHOLT_FAR_PROJECTION_SURFACE_GLSL}
void main() {
  // Clouds remain in the upright backing dome, geography uses SOURCE metres.
  vec3 direction = normalize(vEaldholtSkyPosition - uEaldholtCloudObserver);
  vec3 sky = mix(vec3(.49, .66, .74), vec3(.16, .39, .66), smoothstep(0., .85, max(0., direction.y)));
  vec4 projected = ealdholtProjectFar(vEaldholtSkyPosition, uEaldholtCloudObserver, sky);
  vec3 colour = projected.rgb;
  if (projected.a < .5) {
    float elevation = asin(clamp(direction.y, -1., 1.));
    vec2 domain = vec2((atan(direction.z, direction.x) / 6.28318530718 + .5) * 4., elevation * .95492965855);
    vec2 drift = vec2(${EALDHOLT_CLOUDS.windX}, ${EALDHOLT_CLOUDS.windZ}) * uEaldholtCloudTime;
    float broad = texture2D(uEaldholtCloudNoise, domain + drift).r;
    float detail = texture2D(uEaldholtCloudNoise, domain * 2. - drift * .38 + vec2(.27, .43)).r;
    float density = smoothstep(.48, .67, broad * .8 + detail * .2);
    float fade = smoothstep(.10, .30, max(0., direction.y)) * (1. - smoothstep(.90, 1., direction.y));
    float light = smoothstep(.42, .70, broad + (detail - .5) * .2);
    colour = mix(sky, mix(vec3(.54, .63, .70), vec3(.91, .93, .93), light), density * fade * .64);
  }
  gl_FragColor = vec4(colour, 1.);
  #include <colorspace_fragment>
}`;
