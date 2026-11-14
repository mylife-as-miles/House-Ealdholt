import { AUTUMN_SETTLEMENT_BUILDINGS, SETTLEMENT_OPEN_GROUND, SETTLEMENT_MEADOW_CLEARINGS } from '../../environment/settlement/layout';

export interface ForestProtectedLot { x: number; z: number; width: number; depth: number; yaw?: number }
export interface ForestCanopyPlan { width: number; clearance: number; radius: number; margin: number }
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

/** Read the canonical lots when the kit is built, including any newly authored
 * houses. Canopies may cover paths, but never obscure a house or authored builder clearing. */
export function forestProtectedLots(): readonly ForestProtectedLot[] {
  return [
    ...AUTUMN_SETTLEMENT_BUILDINGS,
    ...SETTLEMENT_OPEN_GROUND,
    ...SETTLEMENT_MEADOW_CLEARINGS,
  ];
}

export function forestLotClearance(x: number, z: number, lots: readonly ForestProtectedLot[]): number {
  let clearance = Infinity;
  for (const lot of lots) {
    const c = Math.cos(lot.yaw ?? 0), s = Math.sin(lot.yaw ?? 0), dx = x - lot.x, dz = z - lot.z;
    const localX = Math.abs(c * dx - s * dz) - lot.width / 2;
    const localZ = Math.abs(s * dx + c * dz) - lot.depth / 2;
    clearance = Math.min(clearance, Math.hypot(Math.max(0, localX), Math.max(0, localZ)));
  }
  return clearance;
}

/** shapeRadius bounds the fully retained source geometry, its width/taper
 * variation and scale. Drift bounds source lean, sway and flutter separately;
 * those displacements must not be multiplied away when a canopy is narrowed. */
export function planForestCanopy(x: number, z: number, shapeRadius: number, drift: number, lots: readonly ForestProtectedLot[], maximum = 1.5): ForestCanopyPlan {
  const margin = .3, clearance = forestLotClearance(x, z, lots);
  const width = clamp((clearance - margin - drift) / Math.max(.001, shapeRadius), 0, maximum);
  return { width, clearance, radius: shapeRadius * width + drift, margin };
}

/** A broad, coherent colour field uses the source world's deterministic noise;
 * a small per-tree variation keeps groves from becoming uniform bands. The
 * fractional value preserves the source instance attribute's form-code bits. */
export function forestGroveColour(x: number, z: number, variation: number, noise: (x: number, z: number) => number): number {
  return clamp(.5 + .68 * noise(x * .035 + 17, z * .035 - 31) + .17 * noise(x * .12 - 4, z * .12 + 7) + (variation - .5) * .08, .025, .975);
}

/** These are linear multipliers into the source geometry's adapted leaf base,
 * rather than a second unbounded light or a replacement foliage material. */
export function forestTintRamp(T: any, species: string): number[][] {
  const base = new T.Color(species === 'aspen' ? '#aa5126' : species === 'parasol' ? '#b56b2d' : '#625b32');
  const colours = species === 'spire' ? ['#354a3a', '#52604a', '#797545'] : ['#6b3e2c', '#a65e30', '#b69047'];
  return colours.map(hex => {
    const colour = new T.Color(hex);
    return [colour.r / Math.max(.001, base.r), colour.g / Math.max(.001, base.g), colour.b / Math.max(.001, base.b)];
  });
}

/** Extend the actual source shaders before its source-space camera wrapper.
 * The same instance attribute drives colour and shadow positions. Source wind,
 * pruning, shape variation and normal-frame rotation remain intact. */
export function patchForestCanopyMaterial(material: any): void {
  const previous = material.onBeforeCompile, key = material.customProgramCacheKey.bind(material);
  material.customProgramCacheKey = () => key() + '|crownfall-site-canopy-v1';
  material.onBeforeCompile = (shader: any, renderer: any) => {
    previous.call(material, shader, renderer);
    const position = 'vec3 p = position;';
    if (!shader.vertexShader.includes(position)) throw new Error('The source forest position hook changed');
    shader.vertexShader = 'attribute float aCanopyWidth;\n' + shader.vertexShader.replace(position, position + '\n  p.xz *= aCanopyWidth;');
    const normal = 'vec3 objectNormal = vec3( normal );';
    if (shader.vertexShader.includes(normal)) {
      shader.vertexShader = shader.vertexShader.replace(normal, normal + '\nobjectNormal.xz /= max(aCanopyWidth, 1e-4);\nobjectNormal *= inversesqrt(max(dot(objectNormal, objectNormal), 1e-12));');
    }
  };
  material.needsUpdate = true;
}
