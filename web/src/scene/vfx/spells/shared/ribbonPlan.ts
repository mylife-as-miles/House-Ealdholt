// Adapted from LinearAbiltyCastingThreeJS (MIT). Copyright (c) 2026 mohamedachrefelouafi. See public/licenses/achrefelouafi-vfx-MIT.txt.
/**
 * The arithmetic of a ribbon in parameter space. No Three.js in here, so the node tests reach it
 * (shared/play/spell-ribbon.test.ts); shared/ribbon.ts draws what this lays out.
 *
 * A ribbon is a strip cut once along `t` (0 where it starts, 1 where it ends) with two vertices at every cut, one
 * on each edge (`side` -1 and 1). A vertex carries nothing else. Where it is in the world is decided by a curve
 * function in the vertex shader, so one strip can be a filament of lightning, a streamer wound round a lance or the
 * streak a falling spark leaves, and many of them are one instanced draw: an instance is a strand, and all a strand
 * owns is four numbers of its own.
 *
 * The layout (a strip of `(t, side)` and an instance per strand) is the reference's `createBoltRibbonGeometry`.
 * The kink below is its Storm Lance's: value noise joined by straight lines, because the corners are what make a
 * filament read as lightning, and a smooth ramp would round them off. Ours is seeded, and it can keep one strand's
 * shape while the others change (see {@link strandShape}).
 */

/** A seeded 0..1 sequence: the same seed gives the same dice on every machine and in every capture. */
export function dice(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const smoothstep = (from: number, to: number, value: number) => { const t = clamp01((value - from) / (to - from)); return t * t * (3 - 2 * t); };

/** How many vertices and indices one strand of `segments` cuts has. */
export function ribbonSize(segments: number): { vertices: number; indices: number } {
  return { vertices: (segments + 1) * 2, indices: segments * 6 };
}

/** The strip's vertices as `(t, side, 0)`: all a vertex knows is how far along it is and which edge it is on. */
export function ribbonVertices(segments: number): Float32Array {
  const out = new Float32Array((segments + 1) * 6);
  for (let i = 0; i <= segments; i += 1) { out[i * 6] = i / segments; out[i * 6 + 1] = -1; out[i * 6 + 3] = i / segments; out[i * 6 + 4] = 1; }
  return out;
}

/** Two triangles between each pair of cuts. */
export function ribbonIndex(segments: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < segments; i += 1) { const a = i * 2; out.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  return out;
}

/**
 * What each strand owns: `x` is its place in the bundle (0 for the first, 1 for the last; 0 when it is alone), and
 * `y`, `z`, `w` are its own dice.
 */
export function strandSeeds(seed: number, strands: number): Float32Array {
  const random = dice(seed), out = new Float32Array(strands * 4);
  for (let i = 0; i < strands; i += 1) {
    out[i * 4] = strands > 1 ? i / (strands - 1) : 0;
    out[i * 4 + 1] = random(); out[i * 4 + 2] = random(); out[i * 4 + 3] = random();
  }
  return out;
}

/** A hash of one number to 0..1. The shader's is the same expression; they need not agree to the last bit. */
export function hash1(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

/**
 * Value noise joined by straight lines, -1..1: its graph is a zigzag with a corner at every whole number. That is
 * the kink of a filament; smoothing the ramp would make a wobbling tube of it.
 */
export function linearNoise(x: number, seed: number): number {
  const i = Math.floor(x), f = x - i;
  return (hash1(i + seed) + (hash1(i + 1 + seed) - hash1(i + seed)) * f) * 2 - 1;
}

/**
 * How far a filament stands off its axis at `t`, in two directions square to it, before it is scaled: `octaves`
 * layers of {@link linearNoise}, each twice as fine and `falloff` as large as the last. `corners` is how many kinks
 * the coarsest layer puts along the whole length, so a long cast has longer legs, not more of them.
 */
export function kink(t: number, seed: number, corners: number, octaves = 3, falloff = 0.5): { x: number; y: number } {
  let x = 0, y = 0, amplitude = 1, frequency = corners;
  for (let i = 0; i < octaves; i += 1) {
    x += amplitude * linearNoise(t * frequency, seed + 13 * i);
    y += amplitude * linearNoise(t * frequency, seed + 71.3 + 13 * i);
    amplitude *= falloff; frequency *= 2;
  }
  return { x, y };
}

/**
 * How much of its kink and fan a filament is allowed at `t`: none where it leaves the hand, and none where it
 * lands when `converge` is 1, so a bolt strikes what it was aimed at. `pinch` is how much of the length each end
 * takes to open.
 */
export function pinned(t: number, pinch: number, converge = 1): number {
  const open = smoothstep(0, pinch, t), close = smoothstep(0, pinch, 1 - t);
  return open * (1 + (close - 1) * clamp01(converge));
}

/**
 * Which shape a strand wears on re-strike `tick`. Lightning re-strikes down the channel it has already burnt: the
 * first strand (the channel) keeps its shape for `keep` ticks and only then finds a new one, while the filaments
 * round it are thrown away and solved again on every tick.
 */
export function strandShape(strand: number, tick: number, keep: number): number {
  return strand === 0 ? Math.floor(tick / Math.max(1, keep)) : tick;
}

/**
 * The least half-width a ribbon may be drawn at a distance `depth` from the eye, so a filament seen from the
 * player's high camera never thins to less than `pixels` on screen. `pixel` is the size of one pixel at unit
 * distance (2 tan(fov / 2) / height).
 */
export function pixelFloor(pixel: number, pixels: number, depth: number): number {
  return pixel * pixels * 0.5 * Math.max(0, depth);
}

/**
 * How bright a ribbon is across its width (`side` -1..1). A filled thread of light is brightest down its middle;
 * a sheath (a hollow shell of light seen from outside) is brightest at its limbs, where the eye looks along the
 * wall, and that is what lets a core show inside it.
 */
export function acrossProfile(side: number, kind: "thread" | "shell", sharp = 2): number {
  const d = clamp01(Math.abs(side));
  if (kind === "thread") return (1 - d) ** sharp;
  // the chord through a thin shell grows toward the limb and is cut off softly at the edge
  return Math.min(1, 0.32 / Math.sqrt(Math.max(1e-4, 1 - d * d))) * (1 - smoothstep(0.86, 1, d));
}

export { clamp01, smoothstep };
