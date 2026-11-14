/** Seeded transient material responses. Blood, injuries and canonical outcomes
 * belong to their existing owners; this planner cannot change them. */
export type ContactMaterial = 'steel' | 'iron' | 'wood' | 'stone' | 'cloth' | 'flesh' | 'water';
export type ContactFxQuality = 'low' | 'medium' | 'high' | 'ultra';
export interface FxPoint { readonly x: number; readonly y: number; readonly z: number }
export interface ContactFxInput {
  readonly id: string; readonly seed: number; readonly point: FxPoint; readonly normal: FxPoint;
  readonly material: ContactMaterial; readonly quality: ContactFxQuality; readonly strength: number;
  readonly groundY: number; readonly reducedMotion?: boolean;
}
export interface ContactParticle {
  readonly origin: FxPoint; readonly velocity: FxPoint; readonly colour: readonly [number, number, number];
  readonly seconds: number; readonly gravity: number; readonly drag: number; readonly size: number;
  readonly groundY: number; readonly kind: 0 | 1 | 2 | 3;
}
const COUNTS = { low: 6, medium: 12, high: 20, ultra: 28 } as const;
const PROFILES: Record<ContactMaterial, { colour: readonly [number, number, number]; kind: 0 | 1 | 2 | 3; speed: number; life: number; size: number }> = {
  steel: { colour: [1, .69, .28], kind: 0, speed: 1.6, life: .38, size: .025 },
  iron: { colour: [1, .52, .17], kind: 0, speed: 1.35, life: .32, size: .028 },
  wood: { colour: [.36, .23, .12], kind: 1, speed: .95, life: .65, size: .045 },
  stone: { colour: [.49, .46, .39], kind: 2, speed: .55, life: .58, size: .08 },
  cloth: { colour: [.39, .34, .27], kind: 2, speed: .25, life: .32, size: .05 },
  flesh: { colour: [0, 0, 0], kind: 2, speed: 0, life: 0, size: 0 },
  water: { colour: [.52, .64, .68], kind: 3, speed: .75, life: .52, size: .035 },
};
function finitePoint(value: FxPoint): boolean { return !!value && Number.isFinite(value.x) && Number.isFinite(value.y) && Number.isFinite(value.z); }
/** Missing sockets, unresolved guards and visibly separated weapons do not
 * justify an impact. Units match the existing Play board's world coordinates. */
export function contactEvidenceUsable(from: FxPoint | null, to: FxPoint | null, shield: boolean, facing: boolean | null): boolean {
  return !!from && !!to && finitePoint(from) && finitePoint(to) && (!shield || facing === true)
    && Math.hypot(from.x - to.x, from.y - to.y, from.z - to.z) <= .18;
}
export function contactEventSeed(seed: number, id: string): number {
  let value = seed >>> 0;
  for (let i = 0; i < id.length; i++) value = Math.imul(value ^ id.charCodeAt(i), 16777619) >>> 0;
  return value;
}
export function contactRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => { state = (state + 0x6d2b79f5) >>> 0; let t = Math.imul(state ^ state >>> 15, state | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
export function planContactParticles(input: ContactFxInput): readonly ContactParticle[] {
  if (!input || typeof input.id !== 'string' || !input.id || input.id.length > 256 || !Number.isSafeInteger(input.seed) ||
      input.seed < 0 || input.seed > 0xffffffff || !finitePoint(input.point) || !finitePoint(input.normal) ||
      !Number.isFinite(input.strength) || !Number.isFinite(input.groundY) ||
      !Object.prototype.hasOwnProperty.call(PROFILES, input.material) || !Object.prototype.hasOwnProperty.call(COUNTS, input.quality)) {
    throw new Error('A contact effect needs a bounded authored event and finite surface data.');
  }
  if (input.reducedMotion || input.material === 'flesh' || input.strength <= 0) return [];
  const length = Math.hypot(input.normal.x, input.normal.y, input.normal.z);
  if (length < 1e-8) return [];
  const n = { x: input.normal.x / length, y: input.normal.y / length, z: input.normal.z / length };
  const tangent = Math.abs(n.y) < .9 ? { x: -n.z, y: 0, z: n.x } : { x: 1, y: 0, z: 0 };
  const tLength = Math.hypot(tangent.x, tangent.y, tangent.z); tangent.x /= tLength; tangent.y /= tLength; tangent.z /= tLength;
  const bitangent = { x: n.y * tangent.z - n.z * tangent.y, y: n.z * tangent.x - n.x * tangent.z, z: n.x * tangent.y - n.y * tangent.x };
  const profile = PROFILES[input.material], random = contactRandom(input.seed), strength = Math.min(2, input.strength);
  const count = Math.max(1, Math.min(COUNTS[input.quality], Math.round(COUNTS[input.quality] * Math.min(1, strength))));
  return Array.from({ length: count }, () => {
    const theta = random() * Math.PI * 2, spread = .12 + random() * .72;
    const x = Math.cos(theta) * spread, y = Math.sin(theta) * spread, speed = profile.speed * (.45 + random() * .7) * Math.sqrt(strength);
    return Object.freeze({ origin: Object.freeze({ x: input.point.x + n.x * .003, y: Math.max(input.groundY, input.point.y + n.y * .003), z: input.point.z + n.z * .003 }),
      velocity: Object.freeze({ x: (n.x + tangent.x * x + bitangent.x * y) * speed,
        y: (n.y + tangent.y * x + bitangent.y * y) * speed + .18, z: (n.z + tangent.z * x + bitangent.z * y) * speed }),
      colour: profile.colour, seconds: profile.life * (.75 + random() * .5), gravity: 3.4,
      drag: profile.kind === 2 ? 3 : .8, size: profile.size * (.7 + random() * .6), groundY: input.groundY, kind: profile.kind });
  });
}
/** Closed-form motion: independent of frame partition, with a flat-surface
 * contact clamp. Callers supply the actual board/surface height. */
export function sampleContactParticle(particle: ContactParticle, seconds: number): { position: FxPoint; opacity: number } {
  if (!Number.isFinite(seconds) || seconds < 0) return { position: particle.origin, opacity: 0 };
  const t = Math.min(seconds, particle.seconds), travel = particle.drag > 0 ? (1 - Math.exp(-particle.drag * t)) / particle.drag : t;
  return { position: { x: particle.origin.x + particle.velocity.x * travel,
    y: Math.max(particle.groundY, particle.origin.y + particle.velocity.y * travel - .5 * particle.gravity * t * t),
    z: particle.origin.z + particle.velocity.z * travel }, opacity: seconds >= particle.seconds ? 0 : Math.pow(1 - t / particle.seconds, 1.5) };
}
