// Adapted from SamuraiThirdPersonTemplateThreeJS (MIT). Copyright (c) 2026 mohamedachrefelouafi. See public/licenses/achrefelouafi-vfx-MIT.txt.
/**
 * Korvenia's summons, as a timeline: what the shadow army is doing at each moment, what it is drawn with at each
 * tier, where the seal opens and what comes through it. No Three.js in here, so the node tests reach it
 * (shared/play/rite-shadow.test.ts); shadow/shadowRite.ts draws what this decides.
 *
 * The beats, on one clock from the Queen's call:
 *
 *   seal      the Queen lifts her armillary wand; a seal of brass rings and turning wheels is written on the stone
 *             behind the victim, one turn round by a pen, and gaslit fog pours out of it across the board
 *   rise      her own soldiers stand up out of the fog as shadows, one after another, all round the victim
 *   charge    they march, then charge, and close a ring round the victim; each levels sabre or bayonet at it
 *   colossus  one of her cuirassiers climbs out of the seal as a shadow four times a man's height
 *   blow      it brings its sabre down on the victim: the stone cracks out from the blow, slabs of it are thrown
 *             up, violet lightning comes down the blade, dust rolls out across the board (`strikeAt`)
 *   leave     the colossus sinks back through the seal; the soldiers burn away upward in violet
 *   heal      the slabs lie back in their places, the cracks cool and close, the fog thins, the seal is gone
 *
 * From the reference (Shadows, Judgement): a shadow is one of the army's own figures in a black, rimmed material
 * that burns away upward; something vast comes through a seal as though the seal were a hole, and sits on what it
 * struck for a moment before it withdraws. Ours: a whole army on a crowded board (armies/crowdPlan.ts), the seal is
 * clockwork, and the board must be whole again when the rite is done.
 */
import type { QualityPreset } from "../../quality";
import type { Point } from "../../vfx/mystic/beamPlan";
import { crowdBudget, dice, type Flat } from "../armies/crowdPlan";

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const smooth = (from: number, to: number, value: number) => { const t = clamp01((value - from) / (to - from)); return t * t * (3 - 2 * t); };

/** Korvenia's gilt and brass: the seal's metal, the soldiers' eyes, the gaslight in the fog. */
export const SHADOW_GOLD = 0xffc45e;
export const SHADOW_GOLD_HOT = 0xfff0cf;
export const SHADOW_BRASS = 0xb98a3e;
export const SHADOW_GASLIGHT = 0xffa95a;
/**
 * The fog the seal pours over the board, inky as the Solforiz mist is (vfx/library.ts), so the shadows stand on darkness:
 * pale, it lay over half the board as a lavender wash and took the dark squares out. `fog` and `deep` are the ground
 * fog's two tones and `hot`, `mid` and `cool` the puffs poured out of the seal, as hex colours; `cover` is the most of
 * the stone one sheet of it hides. Only the gaslight near the seal lights it.
 */
export const SHADOW_FOG = { fog: 0x4a4258, deep: 0x1e1a26, hot: 0x5c5270, mid: 0x3a3346, cool: 0x1e1a26, cover: 0.6 } as const;

export interface ShadowBudget {
  /** Soldiers lent by the match: fusiliers (musket and bayonet) and cuirassiers (sabre). */
  fusiliers: number;
  cuirassiers: number;
  /** Silhouettes of the army standing back in the fog: drawn, not lent. */
  silhouettes: number;
  /** Puffs of fog, of smoke trailing the soldiers, and of dust from the blow: the layers that are matter. */
  fog: number;
  smoke: number;
  dust: number;
  /** Embers as the shadows burn away, and sparks from the blow. */
  embers: number;
  sparks: number;
  /** Slabs of the board thrown up, and loose stone thrown out. */
  slabs: number;
  shrapnel: number;
  /** Lightning down the blade, and arcs running out along the cracks. */
  bolts: number;
  arcs: number;
}

/** What the shadow army is drawn with at each tier. The lowest has no bloom and no lights. */
export const SHADOW_BUDGET: Readonly<Record<QualityPreset, ShadowBudget>> = {
  low: { fusiliers: 3, cuirassiers: 2, silhouettes: 6, fog: 24, smoke: 40, dust: 14, embers: 70, sparks: 40, slabs: 7, shrapnel: 10, bolts: 1, arcs: 2 },
  medium: { fusiliers: 5, cuirassiers: 3, silhouettes: 12, fog: 40, smoke: 90, dust: 24, embers: 150, sparks: 80, slabs: 11, shrapnel: 20, bolts: 2, arcs: 3 },
  high: { fusiliers: 8, cuirassiers: 4, silhouettes: 20, fog: 56, smoke: 160, dust: 34, embers: 240, sparks: 130, slabs: 15, shrapnel: 32, bolts: 3, arcs: 4 },
  ultra: { fusiliers: 10, cuirassiers: 6, silhouettes: 28, fog: 76, smoke: 240, dust: 44, embers: 340, sparks: 180, slabs: 20, shrapnel: 46, bolts: 3, arcs: 6 },
};

/** The colossus is a figure too: one is held back from the match's limit for it. */
export const COLOSSUS_RESERVE = 1;

/** The soldiers at a tier: as many as the shared crowd budget allows, fusiliers and cuirassiers in this tier's share. */
export function shadowCounts(quality: QualityPreset): ShadowBudget {
  const base = SHADOW_BUDGET[quality], troops = crowdBudget(quality, COLOSSUS_RESERVE).troops;
  const cuirassiers = Math.min(base.cuirassiers, Math.round(troops * base.cuirassiers / (base.fusiliers + base.cuirassiers)));
  return { ...base, fusiliers: troops - cuirassiers, cuirassiers };
}

/** The clock, in seconds from the call. */
export const SHADOW_TIMING = {
  /** The pen goes once round the seal; the fog pours from a little after it starts. */
  seal: 0, sealDrawn: 0.75, fog: 0.15,
  /** The soldiers rise: the first at `from`, the last by `from + spread`, each taking `length`. */
  rise: { from: 0.4, spread: 0.55, length: 0.55 },
  /** They close the ring between `first` and `first + spread`. */
  arrive: { first: 1.7, spread: 0.45 },
  /** Each levels its weapon at the victim this long after it arrives (and up to `thrustSpread` later). */
  thrust: 0.08, thrustSpread: 0.25,
  /** The colossus climbs out of the seal, stands, and winds up. */
  colossus: 1.2, stands: 2.2, windup: 2.42,
  /** The blow. */
  strike: 2.85,
  /** It sits on what it struck, then sinks back through the seal. */
  withdraw: 3.45, gone: 4.55,
  /** The soldiers burn away: the first at `from`, the last by `from + spread`, each taking `length`. */
  burn: { from: 3.55, spread: 0.8, length: 0.85 },
  /** The seal closes; the cracks heal; the fog is gone. */
  sealClose: 4.5, sealGone: 5.4, healFrom: 4.6, healed: 6.5, fogGone: 6.6,
  /** Nothing is left. */
  done: 6.9,
} as const;

/** How far the blow's front runs across the board, and how long it takes. */
export const SHADOW_BLAST = { reach: 3.2, spread: 0.7, inner: 0.72, outer: 2.6 } as const;

export interface ColossusSpot {
  /** The seal's centre on the stone, and its radius. */
  at: Flat;
  radius: number;
  /** The unit way from the seal to the victim: the colossus faces it. */
  facing: Flat;
  /** How near the nearest piece standing is to the seal's centre. */
  room: number;
}

export interface ColossusInput {
  victim: Flat;
  viewer: Flat;
  standing: readonly Flat[];
  /** Half the board's width. */
  half: number;
  tile: number;
}

/**
 * Where the seal opens: behind the victim as the player sees it, so the colossus towers over the victim in the
 * shot rather than hiding it, about two squares off, on the board, and where the fewest pieces stand. When the
 * victim is at the far edge it opens to one side.
 */
export function placeColossus(input: ColossusInput): ColossusSpot {
  const { victim, viewer, standing, half, tile } = input;
  let away = { x: victim.x - viewer.x, z: victim.z - viewer.z };
  const length = Math.hypot(away.x, away.z);
  away = length > 1e-6 ? { x: away.x / length, z: away.z / length } : { x: 0, z: -1 };
  const radius = 1.45 * tile;
  let best: ColossusSpot | null = null, bestScore = -Infinity;
  for (const turn of [0, 0.35, -0.35, 0.7, -0.7, 1.05, -1.05, 1.45, -1.45]) {
    const c = Math.cos(turn), s = Math.sin(turn), way = { x: away.x * c - away.z * s, z: away.x * s + away.z * c };
    for (const reach of [1.9, 2.2, 1.6, 2.6].map((r) => r * tile)) {
      const at = { x: victim.x + way.x * reach, z: victim.z + way.z * reach };
      // the colossus is a body: its middle must stand on the board, its seal may run off it
      const off = Math.max(0, Math.abs(at.x) - (half - 0.35), Math.abs(at.z) - (half - 0.35));
      let room = Infinity;
      for (const piece of standing) room = Math.min(room, Math.hypot(piece.x - at.x, piece.z - at.z));
      // a piece inside the colossus's waist is the one thing that must not happen; after that, room, then the shot
      const score = Math.min(room, 1.2) * 3 - (room < 0.65 ? 6 : 0) - Math.abs(turn) * 0.9 - off * 8 - Math.abs(reach - 2 * tile) * 0.5;
      if (score > bestScore) {
        bestScore = score;
        const facing = { x: victim.x - at.x, z: victim.z - at.z }, d = Math.hypot(facing.x, facing.z) || 1;
        best = { at, radius, facing: { x: facing.x / d, z: facing.z / d }, room };
      }
    }
  }
  return best!;
}

export interface ColossusPose {
  /** How far up out of the seal it has come, 0 (under the stone) to 1 (standing waist-deep in it). */
  risen: number;
  /** How far it leans toward the victim, radians: back for the wind-up, over for the blow. */
  lean: number;
  /** True from the frame it begins to climb until it has sunk away. */
  shown: boolean;
}

/** What the colossus is doing at `t`. */
export function colossusPose(t: number): ColossusPose {
  const T = SHADOW_TIMING;
  if (t < T.colossus || t >= T.gone) return { risen: 0, lean: 0, shown: false };
  const climb = smooth(T.colossus, T.stands, t), sink = smooth(T.withdraw, T.gone, t);
  // a slow heave up out of the seal, a lean back as the blade goes up, over and down on the blow, and a rocking
  // settle on what it struck before it goes back down
  const back = smooth(T.windup - 0.25, T.windup + 0.25, t) * (1 - smooth(T.strike - 0.22, T.strike - 0.02, t));
  const over = smooth(T.strike - 0.24, T.strike, t) * (1 - smooth(T.withdraw - 0.1, T.withdraw + 0.5, t));
  const rock = t > T.strike ? Math.sin((t - T.strike) * 14) * Math.exp(-(t - T.strike) * 6) * 0.05 : 0;
  return { risen: climb * (1 - sink), lean: -0.16 * back + 0.42 * over + rock - 0.12 * sink, shown: true };
}

export interface ShadowEnvelope {
  /** How much of the seal the pen has written, 0..1, how brightly it burns, and how far it has opened (its radius, 0..1). */
  sealDrawn: number;
  sealGlow: number;
  sealOpen: number;
  /** How thick the fog lies, 0..1. */
  fog: number;
  /** The gaslight's flicker, about 1. */
  flicker: number;
  /** Seconds since the blow (-1 before), the white flash on it, how hot the cracks still are, and how much scar is left. */
  since: number;
  flash: number;
  heat: number;
  scar: number;
  /** Camera shake this frame. */
  shake: number;
  /** The light the rite asks for: how strong, and 0 at the seal to 1 at the blow. */
  light: number;
  lightAt: number;
  done: boolean;
}

/** The rite's envelopes at `t`: one clock handed to every layer, the light and the camera. */
export function shadowEnvelope(t: number, seed: number, brief = false): ShadowEnvelope {
  const T = SHADOW_TIMING;
  const since = t >= T.strike ? t - T.strike : -1;
  const blow = since >= 0 ? Math.exp(-since / 0.11) : 0;
  // gaslight never burns steady: two slow beats and a quick stutter
  const flicker = 0.82 + 0.1 * Math.sin(t * 7.3 + seed) + 0.06 * Math.sin(t * 17.9 + seed * 2.1) + (Math.sin(t * 41 + seed * 3.7) > 0.93 ? -0.12 : 0);
  const sealDrawn = smooth(T.seal, T.sealDrawn, t);
  const closing = smooth(T.sealClose, T.sealGone, t);
  const sealGlow = (0.35 + 0.45 * smooth(T.colossus - 0.2, T.stands, t) + 0.8 * blow) * (1 - closing) * (t < T.sealGone ? 1 : 0);
  const fog = smooth(T.fog, T.fog + 1.1, t) * (1 - smooth(T.healFrom - 0.4, T.fogGone, t));
  const heat = since < 0 ? 0 : Math.exp(-since / 0.9);
  const scar = since < 0 ? 0 : 1 - smooth(T.healFrom, T.healed, t);
  const rumble = (t > T.colossus && t < T.stands ? 0.035 : 0) + (t > T.withdraw && t < T.gone ? 0.025 : 0);
  const shake = brief ? 0 : Math.min(0.9, 0.85 * blow + rumble + (since >= 0 && since < 1 ? 0.06 * Math.exp(-since * 2) : 0));
  const light = t >= T.done ? 0 : since < 0 ? (0.5 + 0.5 * sealDrawn) * flicker * (0.6 + 0.4 * smooth(T.colossus, T.stands, t)) : (1 + 4 * blow) * Math.max(0.3, heat) * flicker * (1 - smooth(T.healFrom, T.healed, t));
  return {
    sealDrawn, sealGlow, sealOpen: smooth(T.seal, T.sealDrawn + 0.15, t) * (1 - 0.35 * closing), fog, flicker, since, flash: brief ? 0 : 2.2 * blow,
    heat, scar, shake, light: brief ? Math.min(light, 1) : light, lightAt: since < 0 ? 0 : 1, done: t >= T.done,
  };
}

/** How far above the victim every beat's frame reaches (rites/riteShot.ts looks down from the centre of what it frames). */
export const SKY = 3.2;

/** The beats the camera watches, and when each begins. */
export const SHADOW_SHOTS = { call: 0, army: 0.5, colossus: 1.45, after: 3.6 } as const;

/** The beat the camera is on at `t`. */
export function shadowShot(t: number): number {
  const S = SHADOW_SHOTS;
  return t >= S.after ? 3 : t >= S.colossus ? 2 : t >= S.army ? 1 : 0;
}

export interface ShotInput {
  queen: Point;
  victim: Point;
  seal: Flat;
  /** Where the soldiers rise, and the ring they close. */
  spawns: readonly Flat[];
  /** How tall the colossus stands above the stone. */
  colossus: number;
  boardTop: number;
}

/** What each beat keeps in frame: where things will be through it, not only where they are. */
export function shadowFrames(input: ShotInput): Point[][] {
  const { queen, victim, seal, spawns, colossus, boardTop } = input;
  const top = boardTop;
  const up = (p: Flat, y: number): Point => ({ x: p.x, y: top + y, z: p.z });
  const victimFlat = { x: victim.x, z: victim.z };
  // every beat keeps a point well above the victim: the shot then stands high enough to look over the pieces
  // between it and the player instead of through them
  const sky = up(victimFlat, SKY);
  const call = [up(queen, 1.3), up(victimFlat, 0.9), up(seal, 0.1), up(seal, 1.0), sky];
  // the army rising and closing: every place one rises, a soldier's height over it, and the victim
  const army = [up(victimFlat, 0), up(victimFlat, 1.3), ...spawns.map((s) => up(s, 1.0)), sky];
  // the colossus over the victim: its crown, the seal under it, and the ring
  const towering = [up(victimFlat, 0), up(seal, Math.max(colossus + 0.3, SKY)), up(seal, 0), up({ x: victim.x + (victim.x - seal.x) * 0.45, z: victim.z + (victim.z - seal.z) * 0.45 }, 0.4)];
  // after the blow: the broken stone round the victim and the shadows burning away on it
  const after = [up(victimFlat, 0), up(victimFlat, 1.4), up({ x: victim.x + 1.6, z: victim.z }, 0), up({ x: victim.x - 1.6, z: victim.z }, 0), up({ x: victim.x, z: victim.z + 1.6 }, 0), up({ x: victim.x, z: victim.z - 1.6 }, 0), sky];
  return [call, army, towering, after];
}

export interface SoldierBeat {
  /** When it levels its weapon at the victim, and when it begins to burn away. */
  thrust: number;
  burn: number;
}

/** When each of `count` soldiers thrusts, given when each arrives, and when each burns away. Seeded. */
export function soldierBeats(arrivals: readonly number[], seed: number): SoldierBeat[] {
  const T = SHADOW_TIMING, random = dice(seed ^ 0x5ad0);
  return arrivals.map((arrive, i) => ({
    thrust: Math.min(T.strike - 0.15, arrive + T.thrust + T.thrustSpread * random()),
    burn: T.burn.from + T.burn.spread * ((i * 0.618 + random() * 0.4) % 1),
  }));
}

/** How far a soldier has burnt away at `t`, 0 whole to 1 gone. */
export function burnt(t: number, beat: SoldierBeat): number {
  return clamp01((t - beat.burn) / SHADOW_TIMING.burn.length);
}

/**
 * The jolt the blow gives a soldier standing in the ring, `since` seconds after it: thrown back and leaning away,
 * then standing again. Radians of lean and board units of push, both 0 before the blow.
 */
export function recoil(since: number, distance: number): { lean: number; push: number } {
  if (since < 0) return { lean: 0, push: 0 };
  const near = 1 / (1 + distance * 1.2);
  const kick = since * Math.exp(1 - since / 0.09) / 0.09;
  const back = Math.exp(-since / 0.35);
  return { lean: -0.38 * near * Math.min(1, kick) * back, push: 0.22 * near * (1 - Math.exp(-since / 0.06)) * Math.exp(-since / 1.4) };
}
