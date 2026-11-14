/**
 * The downfall, as rules: how a beaten army learns that it is beaten, and how its sovereign yields.
 *
 * Chess decides what happens. This decides how it is shown: who learns first, who kneels and who bows, when a
 * hand opens and lets its weapon fall, where each weapon comes to rest, how the light leaves that side of the
 * hall, and when the victors answer. The King is never slain: he realizes, his defiance breaks, his weapon falls
 * and he goes down on one knee.
 *
 * Pure: no three.js, no clocks, no randomness. The same final position and result always give the same plan,
 * so a replay stages the ending exactly as the match did. Read by `downfallStage.ts` (the scene side) and by
 * `downfallCamera.ts` (the shots).
 */
import type { EndReason, Faction, PieceKind } from "../../core/types";

export type DownfallKind = "checkmate" | "resignation" | "timeout";

/** Which endings are staged as a downfall. Draws and stalemates keep their own quieter ending. */
export function downfallKind(reason: EndReason | string | null | undefined): DownfallKind | null {
  return reason === "checkmate" || reason === "resignation" || reason === "timeout" ? reason : null;
}

/** When each beat begins, in seconds of the scene's clock from the moment the mating move has resolved. */
export interface DownfallTimeline {
  readonly kind: DownfallKind;
  /** The King learns it (checkmate), or makes his choice (resignation), or hears that time is gone (timeout). */
  readonly realize: number;
  /** The realization reaches the nearest of his army... */
  readonly spread: number;
  /** ...and the farthest of them by here. */
  readonly spreadEnd: number;
  /** The victors answer from here. */
  readonly victors: number;
  /** Cut to the King alone (checkmate); null when the yield is watched in one shot. */
  readonly alone: number | null;
  /** His defiance breaks: the chest falls and the head goes down. */
  readonly breaks: number;
  /** His hand opens and his weapon falls. */
  readonly drop: number;
  /** He steps back and begins to sink... */
  readonly kneel: number;
  /** ...and is down on one knee. */
  readonly knelt: number;
  /** The long, slow hold on the kneeling King. */
  readonly hold: number;
  /** The pull back to the board. */
  readonly final: number;
  /** The sequence is over: the results may be shown. */
  readonly end: number;
}

/**
 * A kneel, in three parts: the front foot steps forward when the kneel would not fit on the square where the figure
 * stands (otherwise the body only begins to lower); the rear foot steps back, the hips going down with it; then the
 * sink onto the knee.
 */
export const KNEEL_FRONT = 0.4;
export const KNEEL_STEP = 0.6;
export const KNEEL_SINK = 1.2;
export const KNEEL_TOTAL = KNEEL_FRONT + KNEEL_STEP + KNEEL_SINK;

export const DOWNFALL_TIMELINES: Readonly<Record<DownfallKind, DownfallTimeline>> = {
  // 14.65 s: the King realizes; the army learns from him outward; then the King alone, breaking and kneeling.
  checkmate: { kind: "checkmate", realize: 0, spread: 1.6, spreadEnd: 4.3, victors: 2.3, alone: 5, breaks: 5.55, drop: 6.4, kneel: 6.75, knelt: 6.75 + KNEEL_TOTAL, hold: 9.15, final: 13.05, end: 14.65 },
  // 7.2 s: the King chose this. He lets his weapon fall and kneels at once; his army follows in a quick wave.
  resignation: { kind: "resignation", realize: 0, spread: 1.2, spreadEnd: 2.3, victors: 1.7, alone: null, breaks: 0.5, drop: 0.95, kneel: 1.3, knelt: 1.3 + KNEEL_TOTAL, hold: 3.6, final: 5.7, end: 7.2 },
  // 7.4 s: as a resignation, after a beat in which he looks up because his time is gone.
  timeout: { kind: "timeout", realize: 0, spread: 1.3, spreadEnd: 2.4, victors: 1.8, alone: null, breaks: 0.75, drop: 1.15, kneel: 1.5, knelt: 1.5 + KNEEL_TOTAL, hold: 3.8, final: 5.9, end: 7.4 },
};

/** The name of the beat at `time`, for the camera, diagnostics and tests. */
export type DownfallBeat = "realize" | "collapse" | "alone" | "breaks" | "falls" | "kneels" | "hold" | "final-shot";
export function downfallBeat(timeline: DownfallTimeline, time: number): DownfallBeat {
  if (time >= timeline.final) return "final-shot";
  if (time >= timeline.hold) return "hold";
  if (time >= timeline.kneel) return "kneels";
  if (time >= timeline.drop) return "falls";
  if (time >= timeline.breaks && (timeline.alone === null || time >= timeline.alone)) return "breaks";
  if (timeline.alone !== null && time >= timeline.alone) return "alone";
  if (time >= timeline.spread) return "collapse";
  return "realize";
}

export interface DownfallFigure {
  /** Stable for the life of the figure (the scene uses its container's uuid). */
  readonly id: string;
  readonly square: string;
  readonly kind: PieceKind;
  readonly color: Faction;
  /** Board position, world units. */
  readonly x: number;
  readonly z: number;
}

export interface DownfallInput {
  readonly reason: DownfallKind;
  readonly winner: Faction;
  /** Every figure still standing on the board. */
  readonly figures: readonly DownfallFigure[];
  /** The square of the piece giving check (checkmate), what the King looks at when he realizes. */
  readonly threat?: string | null;
  readonly squareSize: number;
  /**
   * The match's own draw for its ending (shared/play/replay-show.ts showSeed): with the squares, the plan's only
   * variety, so the live game and its replay stage the same ending and another match another. 0: the squares alone.
   */
  readonly seed?: number;
}

export type DefeatGesture = "kneel" | "bow";
export type Side = "left" | "right";

export interface DefeatRole {
  readonly id: string;
  readonly square: string;
  readonly kind: PieceKind;
  readonly royal: boolean;
  readonly gesture: DefeatGesture;
  /** The leg that goes back and down to the stone. */
  readonly rearSide: Side;
  /** The realization reaches this figure: its idle stops and it looks up. */
  readonly start: number;
  /** Its hands open and what they hold falls. */
  readonly drop: number;
  /** The step back that begins its kneel (kneelers), or the moment it bows (the rest). */
  readonly kneel: number;
  /** Its defiance breaks (the King); for the rest, the moment its head goes down. */
  readonly breaks: number;
  /** What it looks to first: its King, or for the King the piece that gives check. */
  readonly glance: { readonly x: number; readonly z: number } | null;
  /** 0..1, from its square: where its slow breath begins. */
  readonly phase: number;
  /** The window in which its ring, crest and rim light fade. */
  readonly dim: { readonly from: number; readonly to: number };
}

export type VictorGesture = "raise" | "relief" | "composed" | "sovereign";

export interface VictorRole {
  readonly id: string;
  readonly square: string;
  readonly kind: PieceKind;
  readonly gesture: VictorGesture;
  readonly start: number;
  /** The beaten King, whom the victorious sovereign and his Queen watch. */
  readonly look: { readonly x: number; readonly z: number } | null;
  /** The victorious sovereign's slow nod during the hold. */
  readonly nod: number | null;
  readonly phase: number;
}

export interface DownfallShade {
  /** Where the light begins to leave: the beaten King's square. */
  readonly x: number;
  readonly z: number;
  /** +1 when the beaten side stands at +z (White), -1 at -z (Black). */
  readonly side: 1 | -1;
  readonly from: number;
  /** World units a second at which the dark spreads outward. */
  readonly speed: number;
  /** How much of the light leaves the stone there (0..1). */
  readonly strength: number;
  /** World units over which its edge softens. */
  readonly soft: number;
}

export interface DownfallPlan {
  readonly kind: DownfallKind;
  readonly timeline: DownfallTimeline;
  readonly winner: Faction;
  readonly loser: Faction;
  readonly king: DefeatRole;
  readonly victorKing: VictorRole | null;
  /** The beaten army apart from its King, nearest to him first. */
  readonly defeated: readonly DefeatRole[];
  /** The victors apart from their King. */
  readonly victors: readonly VictorRole[];
  readonly shade: DownfallShade;
  /** The squares, so a replay can check it is staging the same ending. */
  readonly key: string;
}

/** A repeatable 0..1 from a string (FNV-1a): the plan's only variety, and it comes from the board. */
export function hash01(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return (h >>> 0) / 4294967296;
}

/** Seconds a square farther from the King the realization takes to arrive. */
const SPREAD_RATE = 0.5;
const RANK_ORDER: Readonly<Record<PieceKind, number>> = { k: 0, q: 1, r: 2, b: 3, n: 4, p: 5 };

export function planDownfall(input: DownfallInput): DownfallPlan | null {
  const timeline = DOWNFALL_TIMELINES[input.reason];
  const winner = input.winner, loser: Faction = winner === "w" ? "b" : "w";
  const unit = Math.max(1e-6, input.squareSize);
  const kingFigure = input.figures.find(figure => figure.kind === "k" && figure.color === loser);
  if (!kingFigure) return null;
  const victorFigure = input.figures.find(figure => figure.kind === "k" && figure.color === winner) ?? null;
  const at = (figure: DownfallFigure) => ({ x: figure.x, z: figure.z });
  const threatFigure = input.threat ? input.figures.find(figure => figure.square === input.threat) ?? null : null;
  const mate = input.reason === "checkmate";
  const seed = (input.seed ?? 0) >>> 0;
  const draw = (text: string) => hash01(seed ? `${seed.toString(16)}|${text}` : text);

  const king: DefeatRole = {
    id: kingFigure.id, square: kingFigure.square, kind: "k", royal: true, gesture: "kneel",
    // His weapon hand is the right: the left knee goes down, so the hand that let the weapon fall rests on the
    // raised right knee beside it.
    rearSide: "left",
    start: timeline.realize, drop: timeline.drop, kneel: timeline.kneel, breaks: timeline.breaks,
    glance: threatFigure ? at(threatFigure) : victorFigure ? at(victorFigure) : null,
    phase: draw(`${kingFigure.square}:breath`),
    // His crest and ring do not go with the first of his army: they fade while he breaks and kneels.
    dim: { from: timeline.breaks, to: timeline.knelt },
  };

  const army = input.figures.filter(figure => figure.color === loser && figure.id !== kingFigure.id);
  const distance = (figure: DownfallFigure) => Math.hypot(figure.x - kingFigure.x, figure.z - kingFigure.z) / unit;
  const raw = army.map(figure => ({ figure, d: distance(figure), jitter: (draw(`${figure.square}:wave`) - 0.5) * 0.16 }))
    .sort((a, b) => a.d - b.d || a.figure.square.localeCompare(b.figure.square));
  const latest = Math.max(0, ...raw.map(entry => SPREAD_RATE * entry.d + entry.jitter));
  // The farthest learns by spreadEnd however wide the army stands.
  const squeeze = latest > timeline.spreadEnd - timeline.spread ? (timeline.spreadEnd - timeline.spread) / latest : 1;
  const defeated: DefeatRole[] = raw.map(({ figure, d, jitter }) => {
    const start = timeline.spread + Math.max(0, SPREAD_RATE * d + jitter) * squeeze;
    const hands = (mate ? 0.2 : 0.12) + draw(`${figure.square}:grip`) * 0.12;
    const drop = start + hands;
    const gesture: DefeatGesture = figure.kind === "q" ? "bow" : "kneel";
    return {
      id: figure.id, square: figure.square, kind: figure.kind, royal: false, gesture,
      rearSide: draw(`${figure.square}:knee`) < 0.5 ? "left" : "right",
      start, drop,
      // The hands open before the step back: the weapon is down before the knee is.
      kneel: drop + (mate ? 0.3 : 0.22),
      breaks: start + (mate ? 0.45 : 0.25),
      glance: mate ? at(kingFigure) : null,
      phase: draw(`${figure.square}:breath`),
      dim: { from: start + 0.1, to: start + 1.7 },
    };
  });

  const look = at(kingFigure);
  const victorKing: VictorRole | null = victorFigure ? {
    id: victorFigure.id, square: victorFigure.square, kind: "k", gesture: "sovereign", start: timeline.victors,
    look, nod: timeline.hold + (mate ? 1.4 : 0.8), phase: draw(`${victorFigure.square}:breath`),
  } : null;
  const victors: VictorRole[] = input.figures.filter(figure => figure.color === winner && figure.kind !== "k")
    .sort((a, b) => RANK_ORDER[a.kind] - RANK_ORDER[b.kind] || a.square.localeCompare(b.square))
    .map(figure => {
      const gesture: VictorGesture = figure.kind === "q" ? "composed" : figure.kind === "b" ? "relief" : "raise";
      return {
        id: figure.id, square: figure.square, kind: figure.kind, gesture,
        start: timeline.victors + draw(`${figure.square}:answer`) * 0.6,
        look: figure.kind === "q" ? look : null, nod: null, phase: draw(`${figure.square}:breath`),
      };
    });

  const shade: DownfallShade = {
    x: kingFigure.x, z: kingFigure.z, side: loser === "w" ? 1 : -1,
    from: mate ? timeline.spread - 0.2 : timeline.spread - 0.4,
    speed: 2.4 * unit, strength: mate ? 0.34 : 0.24, soft: 1.4 * unit,
  };
  const key = `${input.reason}:${winner}:${seed.toString(16)}:${input.figures.map(figure => `${figure.color}${figure.kind}${figure.square}`).sort().join(",")}`;
  return { kind: input.reason, timeline, winner, loser, king, victorKing, defeated, victors, shade, key };
}

// ---------------------------------------------------------------- where the weapons come to rest

/** One weapon leaving a hand: its owner's square, the way the owner faces, and the weapon's own size. */
export interface FallenPropInput {
  readonly key: string;
  readonly x: number;
  readonly z: number;
  /** The way the owner faces on the board (unit, xz). */
  readonly facing: { readonly x: number; readonly z: number };
  /** The hand it falls from: +1 the owner's right, -1 its left. */
  readonly hand: 1 | -1;
  /** Its long extent and its width across, world units. */
  readonly length: number;
  readonly width: number;
  /** The owner's height (world units): its footprint scales with it. */
  readonly height: number;
  /**
   * The owner's leg the plan sends back to the stone (+1 right, -1 left), or 0 when it does not kneel. Its stance may
   * kneel on the other knee (downfallPose.ts takes the foot already behind), so either shin is kept clear.
   */
  readonly rear: 1 | -1 | 0;
}

export interface FallenPlacement {
  readonly key: string;
  /** Where its middle comes to rest, world units. */
  readonly x: number;
  readonly z: number;
  /** The direction its long axis lies along: radians about the vertical, 0 along +z, as atan2(dx, dz). */
  readonly yaw: number;
  /** How far it lies from anything else on the stone (negative: it could not be kept clear). */
  readonly clearance: number;
}

export interface FootCircle { readonly x: number; readonly z: number; readonly r: number; }
interface Capsule { ax: number; az: number; bx: number; bz: number; r: number; }

function segmentDistance(a: Capsule, b: Capsule): number {
  // Closest distance between two segments in the plane (sampled finely enough for short props).
  const steps = 12;
  let best = Infinity;
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps, px = a.ax + (a.bx - a.ax) * t, pz = a.az + (a.bz - a.az) * t;
    const dx = b.bx - b.ax, dz = b.bz - b.az, length = dx * dx + dz * dz;
    const u = length < 1e-12 ? 0 : Math.max(0, Math.min(1, ((px - b.ax) * dx + (pz - b.az) * dz) / length));
    best = Math.min(best, Math.hypot(px - (b.ax + dx * u), pz - (b.az + dz * u)));
  }
  return best;
}

/**
 * Where each falling weapon comes to rest: beside its owner on the side of the hand that held it, lying along the
 * way the owner faces where it can, turned off that line only as far as it must to stay clear of every foot on
 * the board, of its owner's own kneeling leg and of the weapons already down. Deterministic: the same board gives
 * the same resting places, in the order given.
 */
export function placeFallenProps(props: readonly FallenPropInput[], feet: readonly FootCircle[]): FallenPlacement[] {
  const placed: Capsule[] = [];
  const out: FallenPlacement[] = [];
  const YAWS = [0, 0.32, -0.32, 0.62, -0.62, 0.95, -0.95, 1.3, -1.3, 1.57];
  for (const prop of props) {
    const fx = prop.facing.x, fz = prop.facing.z;
    // The owner's right, seen from above: the facing turned a quarter clockwise about +y.
    const rx = -fz, rz = fx;
    const h = prop.height, half = prop.length / 2, w = prop.width / 2;
    const own: Capsule[] = [{ ax: prop.x, az: prop.z, bx: prop.x, bz: prop.z, r: 0.13 * h }];
    if (prop.rear) for (const side of [1, -1]) {
      const lateral = 0.07 * h * side;
      own.push({ ax: prop.x + rx * lateral - fx * 0.08 * h, az: prop.z + rz * lateral - fz * 0.08 * h,
        bx: prop.x + rx * lateral - fx * 0.42 * h, bz: prop.z + rz * lateral - fz * 0.42 * h, r: 0.07 * h });
    }
    const others: Capsule[] = feet
      .filter(foot => Math.hypot(foot.x - prop.x, foot.z - prop.z) > 1e-3)
      .map(foot => ({ ax: foot.x, az: foot.z, bx: foot.x, bz: foot.z, r: foot.r }));
    let best: (FallenPlacement & { cost: number }) | null = null;
    for (const lateral of [0.17 * h + w + 0.03, 0.17 * h + w + 0.09, 0.17 * h + w + 0.16]) {
      for (const forward of [0.04 * h, -0.06 * h, 0.14 * h]) {
        for (const turn of YAWS) {
          // The long axis, turned outward from the facing on the hand's side first.
          const angle = Math.atan2(fx, fz) + turn * prop.hand;
          const dx = Math.sin(angle), dz = Math.cos(angle);
          const cx = prop.x + rx * lateral * prop.hand + fx * forward, cz = prop.z + rz * lateral * prop.hand + fz * forward;
          const body: Capsule = { ax: cx - dx * half, az: cz - dz * half, bx: cx + dx * half, bz: cz + dz * half, r: w };
          let clearance = Infinity;
          for (const other of [...own, ...others, ...placed]) clearance = Math.min(clearance, segmentDistance(body, other) - other.r - body.r);
          const cost = Math.abs(turn) * 0.16 + lateral * 0.5 + Math.abs(forward) * 0.3;
          const fits = clearance >= 0.03;
          const better = !best ? true
            : fits !== best.clearance >= 0.03 ? fits
            : fits ? cost < best.cost - 1e-9
            : clearance > best.clearance + 1e-9;
          if (better) best = { key: prop.key, x: cx, z: cz, yaw: angle, clearance, cost };
        }
      }
    }
    if (!best) continue;
    const dx = Math.sin(best.yaw), dz = Math.cos(best.yaw);
    placed.push({ ax: best.x - dx * half, az: best.z - dz * half, bx: best.x + dx * half, bz: best.z + dz * half, r: w });
    out.push({ key: best.key, x: best.x, z: best.z, yaw: best.yaw, clearance: best.clearance });
  }
  return out;
}
