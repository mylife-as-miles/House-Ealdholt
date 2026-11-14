/**
 * Burn marks: what an explosion leaves on the stone, and how long it stays.
 *
 * A spell breaking on its target and a field gun's round going into the floor
 * each leave one mark, in the look of the army that made it:
 *
 *  - Solforiz fire: blackened char, soot thrown downrange, embers in the cracks
 *    that glow orange and cool to dark;
 *  - Aethelgard witchfire: a pale, cold sear with a cyan residue at its rim;
 *  - Kwind-09 arc: Lichtenberg scars branching out from the strike, with a
 *    blue-violet afterglow that fades;
 *  - Korvenia's field gun: a dark blast crater, crushed stone round its lip and
 *    soot sprayed the way the shot was going;
 *  - Korvenia's spells (hex): the empire's brand burnt into the stone, a cog's
 *    rim round a lozenge, with violet embers in its strokes that cool to dark.
 *
 * Every mark ends at the board's edge: none is drawn over the rail.
 *
 * Everything that decides whether a mark appears, how big it is and when it
 * goes is here as plain data and arithmetic with no Three.js, so the node tests
 * reach it (shared/play/scorch.test.ts). scorch.ts draws what this plans.
 *
 * The lifecycle is the blood's (gore/GoreLedger.ts): a mark stays for the match,
 * goes with its ply on Undo, and everything goes on a new game. Past the
 * preset's cap the oldest mark fades out. Violence Intensity is not consulted:
 * none of this is blood.
 */
import type { QualityPreset } from "../quality";
import type { VfxArmy, VfxFlags, VfxTint } from "./wiring";

/** What made the explosion. */
export type ScorchSource = "spell" | "gun";

/** The five looks, in the order the shader numbers them. */
export const SCORCH_KINDS = ["fire", "frost", "arc", "crater", "hex"] as const;
export type ScorchKind = (typeof SCORCH_KINDS)[number];

/**
 * The burn a spell leaves, by the caster's army: Korvenia's Lance and Unmaking (and its Queen's Snare) leave
 * `hex`. A library spell leaves one where its entry's `mark` says so (spells/spell.ts): under the blow, or for
 * Aethelgard's two spells, which run the piece through on ice, as their ice melts off the stone (`thaw`).
 */
export const SPELL_SCORCH: Readonly<Record<VfxArmy, ScorchKind>> = {
  sun: "fire",
  ivory: "frost",
  kwind: "arc",
  empire: "hex",
};

/** The mark an explosion leaves: a gun's is always the crater, a spell's follows its army. */
export function scorchKind(source: ScorchSource, army: VfxArmy): ScorchKind {
  return source === "gun" ? "crater" : SPELL_SCORCH[army];
}

export interface ScorchLook {
  /** Which of the shader's shapes: 0 char and soot, 1 frost sear, 2 branching scars, 3 crater, 4 a brand. */
  shape: 0 | 1 | 2 | 3 | 4;
  /** The burnt heart of the mark (linear albedo: the scene's light does the rest). */
  char: VfxTint;
  /** The body round it: soot, or the frost's pale bloom. */
  soot: VfxTint;
  /** The rim: ash for fire, cyan residue for witchfire, crushed stone for the crater. */
  rim: VfxTint;
  /** What glows while the mark is fresh: embers, residue, afterglow. */
  glow: VfxTint;
  /** Seconds the glow takes to cool to nothing. */
  cool: number;
  /** Glow that never cools (the witchfire's residue), as a share of the fresh glow. */
  residue: number;
  /** Radius of the mark for a blast of power 1, in squares. */
  size: number;
  /** How much further the soot is thrown downrange than upwind. */
  throw: number;
  /** Opacity of the mark at its heart. */
  cover: number;
  /** Surface roughness: char is dead matt, the frost sear a little glassy. */
  roughness: number;
  /** How much of the stone's own reflection is left: soot has none, so char stays black in a bright arena. */
  shine: number;
}

export const SCORCH_LOOK: Readonly<Record<ScorchKind, ScorchLook>> = {
  fire: { shape: 0, char: [0.008, 0.007, 0.006], soot: [0.036, 0.03, 0.025], rim: [0.3, 0.28, 0.26], glow: [1, 0.36, 0.05], cool: 4.2, residue: 0, size: 0.64, throw: 0.55, cover: 0.99, roughness: 0.96, shine: 0.12 },
  frost: { shape: 1, char: [0.2, 0.25, 0.3], soot: [0.74, 0.86, 0.92], rim: [0.3, 0.82, 1], glow: [0.3, 0.82, 1], cool: 3.4, residue: 0.07, size: 0.62, throw: 0.3, cover: 0.86, roughness: 0.38, shine: 1 },
  arc: { shape: 2, char: [0.014, 0.012, 0.03], soot: [0.07, 0.06, 0.1], rim: [0.34, 0.3, 0.5], glow: [0.3, 0.16, 1], cool: 4.5, residue: 0, size: 0.6, throw: 0.4, cover: 0.98, roughness: 0.9, shine: 0.2 },
  crater: { shape: 3, char: [0.006, 0.006, 0.006], soot: [0.03, 0.027, 0.024], rim: [0.4, 0.38, 0.35], glow: [1, 0.3, 0.04], cool: 2.2, residue: 0, size: 0.6, throw: 1, cover: 0.99, roughness: 0.94, shine: 0.1 },
  hex: { shape: 4, char: [0.02, 0.01, 0.03], soot: [0.08, 0.05, 0.1], rim: [0.42, 0.28, 0.5], glow: [0.5, 0.12, 1], cool: 4.5, residue: 0, size: 0.6, throw: 0.4, cover: 0.98, roughness: 0.9, shine: 0.2 },
};

export interface ScorchBudget {
  /** Marks kept per match; past it the oldest fades. */
  marks: number;
  /** Shader detail: 0 is one noise octave and two branch levels with no relief; 2 is everything. */
  detail: 0 | 1 | 2;
}

export const SCORCH_BUDGET: Readonly<Record<QualityPreset, ScorchBudget>> = {
  low: { marks: 6, detail: 0 },
  medium: { marks: 12, detail: 1 },
  high: { marks: 20, detail: 2 },
  ultra: { marks: 28, detail: 2 },
};

/** The menu's background board keeps this many marks, whatever the preset allows. */
export const SCORCH_MENU_MARKS = 3;
/** ...and draws them this faint. */
export const SCORCH_MENU_ALPHA = 0.45;
/** Seconds an over-cap mark takes to fade out. */
export const SCORCH_FADE_SECONDS = 2.5;
/** Extra slots so marks that are fading out still draw while new ones arrive. */
export const SCORCH_FADING_SLOTS = 4;
/** Instances the mesh is built with: the largest preset's marks plus the fading ones. Nothing grows in a match. */
export const SCORCH_SLOTS = Math.max(...Object.values(SCORCH_BUDGET).map(budget => budget.marks)) + SCORCH_FADING_SLOTS;
/** The quad is this many radii wide, so the soot thrown downrange has room. */
export const SCORCH_MARGIN = 2.1;
/** Largest radius of any mark, in squares. */
export const SCORCH_MAX_RADIUS = 0.9;

export interface ScorchEvent {
  /** `scorchSeed(fightSeed)`: the same game leaves the same mark. */
  seed: number;
  /** The ply that made it: what Undo removes it by. */
  ply: number;
  source: ScorchSource;
  /** The army of the caster or the gun crew. */
  army: VfxArmy;
  /** A spell's blast, a gun's blast: about 1 for a Bishop's bolt, about 2 for the Queen's or the field gun. */
  power: number;
  /** A ground ring rolled out from the blast (the sorceress's), in world units; 0 for none. */
  ring?: number;
  /** Where the explosion met the stone. */
  at: { x: number; z: number };
  /** The way the blast was travelling, along the floor (from the caster to the target). */
  direction: { x: number; z: number };
  /** The side of a square, in world units. */
  tile: number;
  flags: VfxFlags;
}

export interface ScorchMark {
  /** Unique within a match: `scorchIdOf(ply)`. */
  id: string;
  ply: number;
  kind: ScorchKind;
  x: number; z: number;
  /** World radius of the burnt body; soot is thrown beyond it. */
  radius: number;
  /** Turn about the vertical that points the quad's +x downrange. */
  rotation: number;
  /** 0 to 1: seeds every noise in the shader. */
  shape: number;
  /** Multiplies the mark's opacity (the menu's board is faint). */
  alpha: number;
  /** Embers, residue pulse and afterglow play. False: the mark is simply there, cold (reduced motion, the tactical map). */
  glow: boolean;
  /** Marks this board may keep: the preset's, or the menu's lower one. */
  cap: number;
}

export const scorchIdOf = (ply: number): string => `${ply}:burn`;

/** FNV-1a mix of the fight's seed and "burn": the scheme the blood uses (gore/GoreTypes.ts `goreSeed`), on its own stream. */
export function scorchSeed(fightSeed: number): number {
  let hash = (0x811c9dc5 ^ (fightSeed >>> 0)) >>> 0;
  hash = Math.imul(hash, 0x01000193) >>> 0;
  for (const char of "burn") { hash ^= char.charCodeAt(0); hash = Math.imul(hash, 0x01000193) >>> 0; }
  return hash >>> 0;
}

/** The Combat Director's generator (mulberry32), kept local so this file imports nothing from combat. */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

/** How much bigger than a power-1 burn a blast of `power` leaves, with a little more for a ground ring. */
export function scorchScale(power: number, ring = 0): number {
  return clamp(0.72 + 0.28 * power, 0.8, 1.32) * (ring > 0 ? 1.1 : 1);
}

/**
 * The mark one explosion leaves. Pure: the same event plans the same mark.
 *
 * The rules, as for the smoke (wiring.ts), except that a mark is information and not motion:
 *  - the tactical map shows it, cold;
 *  - reduced motion shows it, cold: no embers, no afterglow;
 *  - the menu's background board keeps it faint, and few of them;
 *  - the low preset keeps fewer and draws them simpler (see {@link SCORCH_BUDGET});
 *  - Violence Intensity is not consulted.
 */
export function planScorch(event: ScorchEvent): ScorchMark {
  const kind = scorchKind(event.source, event.army);
  const look = SCORCH_LOOK[kind];
  const rnd = random(event.seed);
  const shape = rnd();
  const menu = event.flags.menuBoard;
  const size = look.size * scorchScale(event.power, event.ring) * (0.95 + 0.1 * rnd()) * (menu ? 0.9 : 1);
  const length = Math.hypot(event.direction.x, event.direction.z);
  // No direction to speak of (a blast straight down): the seed turns the mark instead.
  const heading = length > 1e-6 ? Math.atan2(-event.direction.z, event.direction.x) : rnd() * Math.PI * 2;
  const turn = (rnd() - 0.5) * 0.3;
  // Never dead centre: a burn stamped square on its tile reads as a sticker.
  const offset = 0.05 * event.tile, angle = rnd() * Math.PI * 2;
  return {
    id: scorchIdOf(event.ply), ply: event.ply, kind,
    x: event.at.x + Math.cos(angle) * offset, z: event.at.z + Math.sin(angle) * offset,
    radius: Math.min(SCORCH_MAX_RADIUS, size) * event.tile,
    rotation: heading + turn,
    shape,
    alpha: menu ? SCORCH_MENU_ALPHA : 1,
    glow: !(event.flags.reducedMotion || event.flags.tactical),
    cap: menu ? Math.min(SCORCH_MENU_MARKS, SCORCH_BUDGET[event.flags.quality].marks) : SCORCH_BUDGET[event.flags.quality].marks,
  };
}

/**
 * The marks on the board: a fixed pool of typed arrays, written in place, so laying a mark allocates
 * nothing. Dense: removal swaps the last mark into the hole. The renderer only uploads these arrays.
 */
export class ScorchBuffer {
  /** x, z, radius, rotation. */
  readonly place: Float32Array;
  /** shape, birth, kind, alpha. */
  readonly look: Float32Array;
  /** fadeAt (-1: staying), fadeSeconds, glow (1 or 0), unused. */
  readonly life: Float32Array;
  count = 0;
  /** Bumped by every change: the renderer uploads when it moves. */
  version = 0;
  private readonly plies: Int32Array;
  private readonly serial: Float64Array;
  private next = 0;

  constructor(readonly slots: number = SCORCH_SLOTS) {
    this.place = new Float32Array(slots * 4);
    this.look = new Float32Array(slots * 4);
    this.life = new Float32Array(slots * 4);
    this.plies = new Int32Array(slots);
    this.serial = new Float64Array(slots);
  }

  /** Marks that are staying (not fading out). */
  get staying(): number {
    let n = 0;
    for (let i = 0; i < this.count; i += 1) if (this.life[i * 4] < 0) n += 1;
    return n;
  }

  plyOf(index: number): number { return this.plies[index]; }
  kindOf(index: number): ScorchKind { return SCORCH_KINDS[Math.round(this.look[index * 4 + 2])]; }
  fading(index: number): boolean { return this.life[index * 4] >= 0; }

  /**
   * Lays a mark at `now` on the mark clock. Playing ply N means nothing from N or later can still be on the
   * board (Undo then the same capture, or a replay stepping back), so those go first; then the oldest marks
   * fade until this one fits under its cap.
   */
  lay(mark: ScorchMark, now: number): void {
    this.undoTo(mark.ply - 1);
    const cap = Math.min(mark.cap, this.slots - 1);
    if (cap <= 0) return;
    this.trim(cap - 1, now);
    if (this.count >= this.slots) this.removeAt(this.oldest(false));
    const i = this.count;
    this.count += 1;
    this.place[i * 4] = mark.x; this.place[i * 4 + 1] = mark.z; this.place[i * 4 + 2] = mark.radius; this.place[i * 4 + 3] = mark.rotation;
    this.look[i * 4] = mark.shape; this.look[i * 4 + 1] = now; this.look[i * 4 + 2] = SCORCH_KINDS.indexOf(mark.kind); this.look[i * 4 + 3] = mark.alpha;
    this.life[i * 4] = -1; this.life[i * 4 + 1] = SCORCH_FADE_SECONDS; this.life[i * 4 + 2] = mark.glow ? 1 : 0; this.life[i * 4 + 3] = 0;
    this.plies[i] = mark.ply; this.serial[i] = this.next;
    this.next += 1; this.version += 1;
  }

  /** Fades the oldest marks until no more than `cap` are staying (a lower preset, the menu's board). */
  trim(cap: number, now: number): void {
    while (this.staying > Math.max(0, cap)) {
      const i = this.oldest(true);
      if (i < 0) return;
      this.life[i * 4] = now; this.version += 1;
    }
  }

  /** Undo: keeps what plies 1..ply left and removes everything later, at once, without a fade. Returns how many went. */
  undoTo(ply: number): number {
    let removed = 0;
    for (let i = this.count - 1; i >= 0; i -= 1) if (this.plies[i] > ply) { this.removeAt(i); removed += 1; }
    return removed;
  }

  /** Frees the marks whose fade has finished. */
  update(now: number): void {
    for (let i = this.count - 1; i >= 0; i -= 1) {
      const fadeAt = this.life[i * 4];
      if (fadeAt >= 0 && now >= fadeAt + this.life[i * 4 + 1]) this.removeAt(i);
    }
  }

  /** A new game: nothing remains. */
  clear(): void {
    if (this.count) this.version += 1;
    this.count = 0;
  }

  private oldest(stayingOnly: boolean): number {
    let found = -1;
    for (let i = 0; i < this.count; i += 1) {
      if (stayingOnly && this.life[i * 4] >= 0) continue;
      if (found < 0 || this.serial[i] < this.serial[found]) found = i;
    }
    return found;
  }

  private removeAt(i: number): void {
    if (i < 0 || i >= this.count) return;
    const last = this.count - 1;
    if (i !== last) {
      for (let k = 0; k < 4; k += 1) {
        this.place[i * 4 + k] = this.place[last * 4 + k];
        this.look[i * 4 + k] = this.look[last * 4 + k];
        this.life[i * 4 + k] = this.life[last * 4 + k];
      }
      this.plies[i] = this.plies[last]; this.serial[i] = this.serial[last];
    }
    this.count = last; this.version += 1;
  }
}
