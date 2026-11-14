/**
 * The phoenix's model and its rig, as numbers: which bones are which, where in its flight clip the wings are, how
 * much of the clip's deep stroke there is room for near the board, and where on the bird its fire stands. Pure, no
 * Three.js, so the node tests reach it (shared/play/rite-phoenix-model.test.ts); phoenix/model.ts poses the model.
 *
 * The model is "phoenix bird" by NORBERTO-3D (CC BY 4.0), the creator's choice, shipped as
 * "main game/public/models/crownfall-phoenix.glb" (its CREDITS.md says what was changed). In the GLB the bird faces +Z
 * with its back +Y and its left wing +X, the middle of its trunk at the origin, scaled so its wings span about twenty
 * units at their widest through its one clip, "Take 001": four identical wingbeats in 3.33 s, the wings highest at
 * the start of each beat and lowest 44% of the way through it.
 */
import type { PhoenixFlap } from "./phoenixFlight";
import { PHOENIX_DOWNSTROKE } from "./phoenixFlight";

/** The GLB, under the page's base. */
export const PHOENIX_MODEL_URL = "models/crownfall-phoenix.glb";

/** The model's measures, in scene units for a board whose square is 1.02 (scaled with the tile). */
export const PHOENIX_MODEL = {
  /** Its wings at their widest through the clip, tip to tip. */
  span: 20,
  /** One wingbeat of the clip in seconds, and how many the clip holds. */
  beat: 10 / 12,
  beats: 4,
  /** Share of the clip's beat spent on the downstroke, and where in the beat its wings are level on the way down. */
  downstroke: 0.44,
  level: 0.36,
  /** How far under its trunk the wingtips reach at the bottom of the clip's stroke. */
  drop: 8.8,
  /** From midway between its feet down to where its closed toes hold a body. */
  grip: 0.3,
  /** Nothing of the bird is let nearer the board than this. */
  floor: 0.4,
} as const;

/** The bones the rite poses, by name in the GLB. */
export const PHOENIX_BONES = {
  root: "b_Root_01",
  spine: "B_Spine_02",
  neck: ["b_Neck_0_03", "b_Neck_1_04", "b_Neck_2_05"],
  head: "b_Head_06",
  jaw: "B_Jaw_07",
  pelvis: "B_Pelvis_028",
  tail: ["B_Tail_0_029", "B_Tail_1_030", "B_Tail_2_031", "B_Tail_3_032", "B_Tail_4_033", "B_Tail_5_034"],
  /** Per wing (left first): the arm out to the wingtip, and the trailing chain the secondaries hang from. */
  wings: [
    { sign: 1, arm: ["B_Left_Wing_0_070", "B_Left_Wing_1_071", "B_Left_Wing_2_072", "B_Left_Wing_6_073", "B_Left_Wing_7_074", "B_Left_Wing_8_075"], trail: ["B_Left_Wing_1_071", "B_Left_Wing_3_076", "B_Left_Wing_4_077", "B_Left_Wing_5_078"] },
    { sign: -1, arm: ["B_Right_Wing_0_079", "B_Right_Wing_1_080", "B_Right_Wing_2_084", "B_Right_Wing_6_085", "B_Right_Wing_7_086", "B_Right_Wing_8_087"], trail: ["B_Right_Wing_1_080", "B_Right_Wing_3_081", "B_Right_Wing_4_082", "B_Right_Wing_5_083"] },
  ],
  /** Per leg (left first): thigh, calf, foot. The foot is one bone: its toes close together. */
  legs: [
    { sign: 1, bones: ["B_Left_Thigh_035", "B_Left_Calf_036", "b_Left_Foot_037"] },
    { sign: -1, bones: ["B_Right_Thigh_038", "B_Right_Calf_00", "b_Right_Foot_039"] },
  ],
  /** The two plumes of its crest, the plumes under its breast, and the long plumes of its tail, each root to tip. */
  crest: [["B_Hair_44_011", "B_Hair_45_012", "B_Hair_46_013", "B_Hair_47_014"], ["B_Hair_3_015", "B_Hair_4_016", "B_Hair_5_017", "B_Hair_6_018"]],
  breast: [["B_Hair_7_019", "B_Hair_8_020", "B_Hair_9_021"], ["B_Hair_10_022", "B_Hair_11_023", "B_Hair_12_024"], ["B_Hair_13_025", "B_Hair_14_026", "B_Hair_15_027"]],
  plumes: [
    ["B_Hair_22_040", "B_Hair_23_041", "B_Hair_24_042", "B_Hair_25_043", "B_Hair_26_044", "B_Hair_27_045"],
    ["B_Hair_28_046", "B_Hair_29_047", "B_Hair_30_048", "B_Hair_31_049", "B_Hair_32_050", "B_Hair_33_051"],
    ["B_Hair_34_057", "B_Hair_35_058", "B_Hair_36_059", "B_Hair_37_060", "B_Hair_38_061"],
    ["B_Hair_39_052", "B_Hair_40_053", "B_Hair_41_054", "B_Hair_42_055", "B_Hair_43_056"],
    ["B_Hair_16_065", "B_Hair_17_066", "B_Hair_18_067"],
    ["B_Hair_19_062", "B_Hair_20_063", "B_Hair_21_064"],
  ],
} as const;

/**
 * Where in its beat the clip is to be for the plan's wingbeat (0 is the top of the stroke, 1 the end of the beat):
 * the plan's downstroke mapped onto the clip's, so the clip's wings are lowest when the plan's are. Between beats
 * the wings rest level; raised, they are held at the top of the stroke (thrown up over its back as it seizes the
 * piece, and coming through the seal); flared, at the level of the upstroke, spread wide.
 */
export function clipShare(flap: PhoenixFlap, shape: { raise: number; fold: number; flare: number }): number {
  const D = PHOENIX_DOWNSTROKE, C = PHOENIX_MODEL.downstroke;
  const p = Math.min(1, Math.max(0, flap.phase));
  const beat = p < D ? (p / D) * C : C + ((p - D) / (1 - D)) * (1 - C);
  // easing into a beat comes up from level to the top; out of one, down from the top to level
  let share = flap.amount >= 1 ? beat : PHOENIX_MODEL.level * (1 - flap.amount);
  // held up: raised or folded back for the dive and the seal; flared wide as it brakes and rears
  const up = Math.max(shape.raise, shape.fold);
  share = share * (1 - up);
  share = share + (FLARE_SHARE - share) * shape.flare * (1 - up);
  return share;
}

/** Where in the clip's beat the wings are spread widest, on the way up. */
export const FLARE_SHARE = 0.84;

/**
 * How much of the clip's stroke there is room for at `height` over the board: the stroke reaches PHOENIX_MODEL.drop
 * under the trunk at the bottom, so low down it is drawn in toward level (0.35 at the least). 1 is all of it.
 */
export function strokeRoom(height: number, unit: number): number {
  const room = (height - PHOENIX_MODEL.floor * unit) / (PHOENIX_MODEL.drop * unit);
  return Math.min(1, Math.max(0.35, room));
}

/** A flame standing on the model: between two bones (or past the last, along it), a share of the way, its size and heat. */
export interface ModelFlame {
  from: string;
  to: string;
  /** 0..1 between the two bones; above 1 runs on past `to` along the line from `from`. */
  at: number;
  size: number;
  heat: number;
  frame: number;
  seed: number;
}

/**
 * Where the fire stands on the model: along each wing's arm and out past its tip over the primaries, along the
 * trailing chain over the secondaries, along the crest, the breast plumes, the tail and its long plumes and out past
 * their ends, and on the thighs. `count` is the tier's budget (PHOENIX_BUDGET.blaze); `dice` the rite's.
 */
export function modelFlames(count: number, dice: () => number, unit: number): ModelFlame[] {
  const chains: { bones: readonly string[]; share: number; past: number; size: [number, number] }[] = [];
  for (const wing of PHOENIX_BONES.wings) {
    chains.push({ bones: wing.arm, share: 0.17, past: 1.9, size: [1.2, 2.2] });
    chains.push({ bones: wing.trail, share: 0.1, past: 1.6, size: [1.1, 1.9] });
  }
  chains.push({ bones: PHOENIX_BONES.tail, share: 0.08, past: 1.3, size: [1.2, 2] });
  for (const plume of PHOENIX_BONES.plumes) chains.push({ bones: plume, share: 0.035, past: 1.4, size: [0.9, 1.6] });
  for (const plume of PHOENIX_BONES.crest) chains.push({ bones: plume, share: 0.02, past: 1.3, size: [0.6, 1.0] });
  for (const plume of PHOENIX_BONES.breast) chains.push({ bones: plume, share: 0.012, past: 1.2, size: [0.7, 1.1] });
  for (const leg of PHOENIX_BONES.legs) chains.push({ bones: leg.bones.slice(0, 2), share: 0.015, past: 1, size: [0.8, 1.2] });
  const total = chains.reduce((sum, chain) => sum + chain.share, 0);
  const flames: ModelFlame[] = [];
  for (const chain of chains) {
    const n = Math.max(1, Math.round((count * chain.share) / total));
    const segments = chain.bones.length - 1;
    for (let i = 0; i < n; i += 1) {
      // spread along the chain and out past its last bone, more of them toward its end
      const along = Math.pow((i + dice()) / n, 0.8) * (segments + chain.past - 1);
      const segment = Math.min(segments - 1, Math.floor(along));
      flames.push({
        from: chain.bones[segment], to: chain.bones[segment + 1], at: along - segment,
        size: (chain.size[0] + (chain.size[1] - chain.size[0]) * dice()) * unit, heat: 0.66 + 0.14 * dice(), frame: Math.floor(dice() * 64), seed: dice(),
      });
    }
  }
  return flames;
}
