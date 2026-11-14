/**
 * Combat Impact Resolver: what a weapon met, and whether it went in.
 *
 * Pure. The contact anchor (from the choreography's contact cue) plus the
 * defender's rig give a surface; the weapon and the blow's power decide
 * whether that surface is breached. The rules that never bend:
 *  - a shield never bleeds: wood splinters, iron sparks;
 *  - armor without a breach never bleeds;
 *  - only a killing contact breaches: a block or a glance stays on the surface.
 *
 * Region tables are per figure: each kingdom fields its own six, and each is
 * authored from what that figure is seen to wear (docs/play/GORE_SYSTEM.md,
 * "What each figure wears"). The two Pawns keep the ids of the combat-v1 clip
 * library they were first authored with: "wp" (Aethelgard) and "bp" (Solforiz).
 * A kingdom the tables do not know resolves through a table per piece class.
 */
import type { GoreAnchor, GoreEvent, GoreKind, GoreKingdom, GoreWeapon, ImpactSurface, ShieldMaterial, SurfaceMaterial } from "./GoreTypes";

export interface RigRegion {
  material: SurfaceMaterial;
  flesh: boolean;
  /** 0 (bare cloth) to 1 (solid plate): what a blow must overcome to reach flesh. */
  armor: number;
  /** Visible surface outside the anchor bone, in squares. */
  surfaceOffset: number;
}

/**
 * Where a limb comes off (death/sever severableLimbs): a head at the top of the neck, an arm at the shoulder, a
 * forearm at the elbow, a leg at the hip, a shin at the knee.
 */
export type CutRegion = "neck" | "arm" | "forearm" | "leg" | "shin";
export const CUT_REGIONS: readonly CutRegion[] = ["neck", "arm", "forearm", "leg", "shin"];

export type RigRegions = Readonly<Record<"torso" | "head", RigRegion>> & {
  readonly shield: ShieldMaterial | null;
  /**
   * What is worn where each limb comes off, its outermost layer all round the limb: what a cut there shows in
   * section. A pauldron on the shoulder of a cloth sleeve does not make the arm plate; a full rerebrace does.
   */
  readonly cut: Readonly<Record<CutRegion, SurfaceMaterial>>;
};

type Worn = SurfaceMaterial;
const region = (material: SurfaceMaterial, armor: number, surfaceOffset: number): RigRegion => ({ material, flesh: true, armor, surfaceOffset });
const cut = (neck: Worn, arm: Worn, forearm: Worn, leg: Worn, shin: Worn): RigRegions["cut"] => ({ neck, arm, forearm, leg, shin });
const PLATE_ALL = cut("plate", "plate", "plate", "plate", "plate");
const CLOTH_ALL = cut("cloth", "cloth", "cloth", "cloth", "cloth");

/**
 * Every figure's table, by id: "wp" and "bp" for the two Pawns, `<kingdom>.<kind>` for the rest. Torso and head
 * answer a blow (a killing blow finds the gaps in plate, so plate a sword can open sits at 0.7 to 0.8; a Rook's and
 * a sovereign's at 1.1 to 1.3, which only a point or a heavy head gets through); `cut` answers a limb taken off.
 */
export const RIG_REGIONS: Readonly<Record<string, RigRegions>> = {
  // ---- Aethelgard
  // Line infantry: a short-sleeved mail shirt over a quilted gambeson, a kettle hat over a bare face, cloth
  // trousers and wrapped hose; an iron-faced round shield.
  wp: { torso: region("mail", 0.35, 0.11), head: region("plate", 0.8, 0.08), shield: "iron", cut: cut("cloth", "mail", "cloth", "cloth", "cloth") },
  // The castle guard: full plate under a crenellated great helm, a mail skirt at the hips; a painted tower shield.
  "ivory.r": { torso: region("plate", 1.3, 0.16), head: region("plate", 1.3, 0.1), shield: "wood", cut: PLATE_ALL },
  // The plumed knight: full plate and an armet, a tabard over it; a painted heater shield.
  "ivory.n": { torso: region("plate", 0.8, 0.13), head: region("plate", 0.8, 0.09), shield: "wood", cut: PLATE_ALL },
  // The hooded cleric: a white robe over a mail hauberk (its sleeves show at the shoulder), a hood over a bare face,
  // leather bracers, tall boots.
  "ivory.b": { torso: region("cloth", 0.35, 0.11), head: region("cloth", 0.15, 0.09), shield: null, cut: cut("cloth", "mail", "cloth", "cloth", "cloth") },
  // The warrior queen: a plate cuirass, plated arms and greaves, a skirt over bare thighs, her head bare under a tiara.
  "ivory.q": { torso: region("plate", 0.8, 0.11), head: region("skin", 0.1, 0.09), shield: null, cut: cut("skin", "plate", "plate", "cloth", "plate") },
  // The king: full plate under a cape and tabard, his head bare under the crown.
  "ivory.k": { torso: region("plate", 1.1, 0.14), head: region("skin", 0.1, 0.1), shield: null, cut: cut("skin", "plate", "plate", "plate", "plate") },
  // ---- Solforiz
  // The Ash Legionnaire: a turban and a brass respirator, a leather-and-bronze vest under a scarf, arms and legs in
  // wrappings; a leather-faced board shield on a copper rim.
  bp: { torso: region("cloth", 0.15, 0.1), head: region("cloth", 0.2, 0.08), shield: "wood", cut: CLOTH_ALL },
  // The Furnace Bastion: a sealed iron helm and heavy plate under its boilers, robes hanging over plated legs; a
  // riveted steel tower shield.
  "sun.r": { torso: region("plate", 1.3, 0.16), head: region("plate", 1.3, 0.1), shield: "iron", cut: PLATE_ALL },
  // The Dune Reaver: a turban, goggles and a spiked face wrap, a leather lamellar under a mantle, wrapped arms in
  // leather bracers, robes and boots; a leather-faced buckler. No mail anywhere.
  "sun.n": { torso: region("cloth", 0.35, 0.13), head: region("cloth", 0.3, 0.09), shield: "wood", cut: CLOTH_ALL },
  // The Sulfur Oracle: a hood and a respirator, robes and a harness, bronze greaves under the hem.
  "sun.b": { torso: region("cloth", 0.15, 0.11), head: region("cloth", 0.15, 0.09), shield: null, cut: cut("cloth", "cloth", "cloth", "cloth", "plate") },
  // The Ash Matriarch: a tall headdress and a veil, a copper breastplate, cloth sleeves with copper vambraces, a long
  // skirt over copper greaves.
  "sun.q": { torso: region("plate", 0.7, 0.11), head: region("cloth", 0.2, 0.09), shield: null, cut: cut("cloth", "cloth", "plate", "cloth", "plate") },
  // The Scorched Sovereign: a gilded sun helm and mask, gilded plate under the cape.
  "sun.k": { torso: region("plate", 1.1, 0.14), head: region("plate", 1, 0.1), shield: null, cut: PLATE_ALL },
  // ---- Korvenia: wool and braid; only the cuirassier wears steel.
  // The Violet Fusilier: a shako, a high-collared coat with crossbelts, breeches and boots.
  "empire.p": { torso: region("cloth", 0.2, 0.1), head: region("cloth", 0.2, 0.08), shield: null, cut: CLOTH_ALL },
  // The Battery Magister: a fur busby, a coat under a leather apron, gloves and boots.
  "empire.r": { torso: region("cloth", 0.3, 0.16), head: region("cloth", 0.25, 0.1), shield: null, cut: CLOTH_ALL },
  // The Eclipse Cuirassier: a steel helmet and a steel cuirass over the coat; cloth sleeves, breeches, jackboots.
  "empire.n": { torso: region("plate", 0.8, 0.13), head: region("plate", 0.8, 0.09), shield: null, cut: CLOTH_ALL },
  // The Astral Marksman: a bicorne, a long coat and a cravat.
  "empire.b": { torso: region("cloth", 0.15, 0.11), head: region("cloth", 0.15, 0.09), shield: null, cut: CLOTH_ALL },
  // The Archmagistra: a gown with a standing collar, her head bare under a circlet.
  "empire.q": { torso: region("cloth", 0.2, 0.11), head: region("skin", 0.1, 0.09), shield: null, cut: CLOTH_ALL },
  // The Grand Duke: a braided uniform coat and a cape, his head bare under the crown.
  "empire.k": { torso: region("cloth", 0.3, 0.14), head: region("skin", 0.1, 0.1), shield: null, cut: CLOTH_ALL },
  // ---- Kwind-09
  // The Levy Trooper: a steel helmet and a gas mask, a quilted greatcoat with plates on the shoulders, boots.
  "kwind.p": { torso: region("cloth", 0.3, 0.1), head: region("plate", 0.6, 0.08), shield: null, cut: CLOTH_ALL },
  // The Foundry Bulwark: sealed powered plate from helm to boots.
  "kwind.r": { torso: region("plate", 1.3, 0.16), head: region("plate", 1.3, 0.1), shield: null, cut: PLATE_ALL },
  // The Expressway Courier: a visored helmet, light plates over a padded suit, padded sleeves and trousers, steel
  // knee cops over the vent boots.
  "kwind.n": { torso: region("plate", 0.55, 0.13), head: region("plate", 0.7, 0.09), shield: null, cut: cut("cloth", "cloth", "cloth", "cloth", "plate") },
  // The Signal Officer: bare-headed under a headset, a long coat and a harness.
  "kwind.b": { torso: region("cloth", 0.25, 0.11), head: region("skin", 0.1, 0.09), shield: null, cut: CLOTH_ALL },
  // The Charter Holder: a fitted high-collared coat, the charge gauntlets on her forearms, her head bare.
  "kwind.q": { torso: region("cloth", 0.2, 0.11), head: region("skin", 0.1, 0.09), shield: null, cut: cut("cloth", "cloth", "plate", "cloth", "cloth") },
  // The Chairman: a heavy coat with plated shoulders, his head bare.
  "kwind.k": { torso: region("cloth", 0.3, 0.14), head: region("skin", 0.1, 0.1), shield: null, cut: CLOTH_ALL },
};

/** A kingdom the figure tables do not know (none the game fields): one table per piece class. */
const GENERIC: Readonly<Record<GoreKind, RigRegions>> = {
  p: { torso: region("cloth", 0.2, 0.1), head: region("cloth", 0.3, 0.08), shield: null, cut: CLOTH_ALL },
  n: { torso: region("mail", 0.55, 0.13), head: region("plate", 0.85, 0.09), shield: null, cut: cut("plate", "mail", "mail", "mail", "mail") },
  b: { torso: region("cloth", 0.15, 0.11), head: region("cloth", 0.15, 0.09), shield: null, cut: CLOTH_ALL },
  r: { torso: region("plate", 1.3, 0.16), head: region("plate", 1.3, 0.1), shield: null, cut: PLATE_ALL },
  q: { torso: region("cloth", 0.25, 0.11), head: region("cloth", 0.2, 0.09), shield: null, cut: CLOTH_ALL },
  k: { torso: region("plate", 1.1, 0.14), head: region("plate", 1, 0.1), shield: null, cut: PLATE_ALL },
};

/** The region table a defender resolves through: its figure's own table, or its piece class's (what a cut through it shows: death/sever). */
export function regionsOf(kind: GoreKind, kingdom: GoreKingdom): RigRegions {
  const authored = rigOf(kind, kingdom);
  return authored ? RIG_REGIONS[authored] : GENERIC[kind];
}

/** How well a weapon gets through armor: a point concentrates the blow, a blunt head spreads it. */
export const WEAPON_PENETRATION: Readonly<Record<GoreWeapon, number>> = {
  spear: 1, lance: 1.15, sword: 0.75, axe: 0.9, mace: 0.5, staff: 0.3, musket: 1.4, fist: 0.15,
};

/** The id of a defender's own table ("wp", "bp", "sun.n"...), or null for a kingdom the tables do not know. */
export function rigOf(kind: GoreKind, kingdom: GoreKingdom): string | null {
  if (kind === "p" && kingdom === "ivory") return "wp";
  if (kind === "p" && kingdom === "sun") return "bp";
  const id = `${kingdom}.${kind}`;
  return id in RIG_REGIONS ? id : null;
}

export type ImpactQuery = Pick<GoreEvent, "attacker" | "defender" | "power" | "outcome"> & { contact: { anchor: GoreAnchor } };

export function resolveImpact(query: ImpactQuery): ImpactSurface {
  const { defender, attacker } = query, anchor = query.contact.anchor;
  const authored = rigOf(defender.kind, defender.kingdom);
  const regions = authored ? RIG_REGIONS[authored] : GENERIC[defender.kind];
  const rig = authored ?? `generic.${defender.kind}`;
  const dry = (region: GoreAnchor, material: SurfaceMaterial, response: ImpactSurface["response"]): ImpactSurface =>
    ({ rig, region, material, flesh: false, breached: false, response, surfaceOffset: 0 });

  if (anchor === "shield") {
    // What the defender actually carries wins over the rig's default.
    const held = defender.shield === undefined ? regions.shield : defender.shield;
    const material: ShieldMaterial = held ?? "wood";
    return dry("shield", material, material === "wood" ? "splinters" : "sparks");
  }
  if (anchor === "weapon") return dry("weapon", "steel", "sparks");
  if (anchor === "ground") return dry("ground", "stone", "none");

  const region = regions[anchor];
  const reach = WEAPON_PENETRATION[attacker.weapon] * Math.max(0, query.power);
  const breached = query.outcome === "kill" && region.flesh && reach >= region.armor;
  const hard = region.material === "mail" || region.material === "plate";
  return {
    rig, region: anchor, material: region.material, flesh: region.flesh, breached,
    response: breached ? "blood" : hard ? "sparks" : "none",
    surfaceOffset: region.surfaceOffset,
  };
}
