/**
 * URLs of the AI-generated assets used by the game.
 * Models are loaded straight from R2 by GLTFLoader. Swapping in higher-quality
 * glTF characters is a one-line change per entry (see README). The match audio
 * is no longer hosted: it is bundled (web/src/audio/gambit-assets.ts).
 */

import type { Faction, PieceKind } from "../core/types";
import type { ArmSculptSource } from "../scene/armoury";
import type { ShotModelSource } from "../scene/gunfire";
import type { WeaponId } from "../scene/weapons";

const MODEL_BASE = "https://r2-pub.rork.com/generated-3d-models/g9111r67kl6tq85g540sd";
/**
 * Kwind-09 is served with the game rather than from the generator: `main game/public/models/kwind09`, made from
 * ChatGPT references, Meshy models, rigs and library clips (see that folder's README). The legacy web shell does
 * The legacy web shell serves this folder through web/vite.config.ts (sharedArmyModels).
 */
const KWIND_BASE = "/models/kwind09";
/**
 * Korvenia, the Grand Duchy under the eclipse, is served with the game the same way:
 * `main game/public/models/korvenia` (see that folder's README). It replaced the generator-hosted Grande Armée
 * figures on 10 November 2026; the props, gun scenes and voices are unchanged.
 */
const KORVENIA_BASE = "/models/korvenia";
/**
 * Solforiz, the Scorched Caliphate, the same way: `main game/public/models/solforiz` (see that folder's README).
 * It replaced the generator-hosted sun-empire figures on 10 November 2026, with new props in weapons.ts.
 */
const SOLFORIZ_BASE = "/models/solforiz";

/**
 * One army's sculpts. Every skin is a whole civilisation with its own roster of
 * six figures; a missing entry falls back to the other side's sculpt and then to
 * a procedural figure, so the board always fills.
 */
type Roster<T> = Partial<Record<PieceKind, T>>;

/**
 * Which weapon family arms a skin's figures. The figures are always generated
 * unarmed (held props break auto-rigging), so the arms are separate objects
 * parented to the hand bones — built from primitives in `scene/weapons.ts` or,
 * for the Grande Armée, generated sculpts of the real thing (see
 * {@link ARM_SCULPTS}).
 */
export type ArsenalId = "kingdom" | "sun" | "empire" | "kwind";

/** Selectable army skins. Either side of the board can wear any of them. */
export type ArmySkinId = "ivory" | "sun" | "empire" | "kwind";

/** Static (unrigged) sculpt per kind — the fallback when a rig fails to load. */
const STILL_MODELS: Record<ArmySkinId, Roster<string>> = {
  ivory: {
    k: `${MODEL_BASE}/704a772c-4a50-4619-b5ad-6e2bbf9703b8.glb`,
    q: `${MODEL_BASE}/13928f19-23a3-46ba-9879-aacca58f2886.glb`,
    b: `${MODEL_BASE}/6c99342a-e9a5-4959-a59b-c207e15a5c72.glb`,
    n: `${MODEL_BASE}/43f08150-5463-4112-9949-2e1a9a9a6bd2.glb`,
    r: `${MODEL_BASE}/211b0ba5-2c7f-44ff-8143-b625bca41df1.glb`,
    p: `${MODEL_BASE}/36d8c7d4-2f42-4672-8908-e9298fce9b69.glb`,
  },
  // Solforiz, the Scorched Caliphate: each figure with its idle pose baked in (no skeleton).
  sun: {
    k: `${SOLFORIZ_BASE}/k-still.glb`,
    q: `${SOLFORIZ_BASE}/q-still.glb`,
    b: `${SOLFORIZ_BASE}/b-still.glb`,
    n: `${SOLFORIZ_BASE}/n-still.glb`,
    r: `${SOLFORIZ_BASE}/r-still.glb`,
    p: `${SOLFORIZ_BASE}/p-still.glb`,
  },
  // Korvenia: each figure with its idle pose baked in (no skeleton), so a failed rig never shows a T-pose.
  empire: {
    k: `${KORVENIA_BASE}/k-still.glb`,
    q: `${KORVENIA_BASE}/q-still.glb`,
    b: `${KORVENIA_BASE}/b-still.glb`,
    n: `${KORVENIA_BASE}/n-still.glb`,
    r: `${KORVENIA_BASE}/r-still.glb`,
    p: `${KORVENIA_BASE}/p-still.glb`,
  },
  // Kwind-09: each figure with its idle pose baked in (no skeleton), so a failed rig never shows a T-pose.
  kwind: {
    k: `${KWIND_BASE}/k-still.glb`,
    q: `${KWIND_BASE}/q-still.glb`,
    b: `${KWIND_BASE}/b-still.glb`,
    n: `${KWIND_BASE}/n-still.glb`,
    r: `${KWIND_BASE}/r-still.glb`,
    p: `${KWIND_BASE}/p-still.glb`,
  },
};

/**
 * Rigged (skinned) sculpts plus their skeletal clips. The plain GLBs above have
 * no skeleton, so an animated piece must render the rigged variant and play the
 * clips on a mixer bound to it. Kinds missing here fall back to the static GLB
 * with procedural idle motion.
 */
export interface PieceAnimationSet {
  /** Rigged GLB — the visual for animated pieces. */
  rigged: string;
  /** Looping combat stance. */
  idle?: string;
  /** One-shot strike played when this figure captures. */
  attack?: string;
  /** One-shot death played when this figure is captured. */
  death?: string;
  /**
   * Looping in-place stride played while the figure marches to its square.
   * In-place variants only: the board move is driven by the container tween,
   * so a clip carrying root translation would double the travel.
   */
  walk?: string;
  /** Looping in-place run — the knight's charge through its leap. */
  run?: string;
  /**
   * One-shot drill played after a shot: powder, ball, ramrod. Only the
   * gunpowder army carries one — a swordsman has nothing to reload.
   */
  reload?: string;
  /**
   * Looping sight picture held before the shot: the arm comes up, the barrel is
   * levelled on the body and the head sights along it. Only the gunpowder army
   * carries one — it is what makes a kill at range read as aimed.
   */
  aim?: string;
  /**
   * One-shot change of stance between the knee and the feet: the clip starts on
   * one knee and ends standing at full height. Only a figure that fights from a
   * kneel needs it, and it is played in *both* directions — forwards to come up
   * off the knee once the shot is over, backwards to go down onto it in the
   * first place (see `PieceView.playKneel`). One download, two motions, and the
   * kneel he rises out of is by construction the kneel he dropped into.
   */
  rise?: string;
  /** Optional PR #3 Blender marker sidecars; only list actually exported files. */
  events?: Partial<Record<"idle" | "attack" | "death" | "walk" | "run" | "reload" | "aim" | "rise", string>>;
}

const ANIMATED_MODELS: Record<ArmySkinId, Roster<PieceAnimationSet>> = {
  ivory: {
  // The crown stands at full height and judges rather than brawls.
  k: {
    rigged: `${MODEL_BASE}/704a772c-4a50-4619-b5ad-6e2bbf9703b8-rigged.glb`,
    idle: `${MODEL_BASE}/704a772c-4a50-4619-b5ad-6e2bbf9703b8-anim-idle.glb`,
    attack: `${MODEL_BASE}/704a772c-4a50-4619-b5ad-6e2bbf9703b8-anim-sword-judgment.glb`,
    death: `${MODEL_BASE}/704a772c-4a50-4619-b5ad-6e2bbf9703b8-anim-dead.glb`,
    // A plain, upright stride: the catwalk strut read as a swagger on a king,
    // so the crown now walks normally and the slow cadence in GAITS supplies the
    // gravitas. Alternative on the same rig:
    // `...-anim-spear-walk-inplace.glb` (weapon-forward march).
    walk: `${MODEL_BASE}/704a772c-4a50-4619-b5ad-6e2bbf9703b8-anim-casual-walk-inplace.glb`,
  },
  q: {
    rigged: `${MODEL_BASE}/13928f19-23a3-46ba-9879-aacca58f2886-rigged.glb`,
    idle: `${MODEL_BASE}/13928f19-23a3-46ba-9879-aacca58f2886-anim-idle.glb`,
    attack: `${MODEL_BASE}/13928f19-23a3-46ba-9879-aacca58f2886-anim-charged-spell-cast.glb`,
    death: `${MODEL_BASE}/13928f19-23a3-46ba-9879-aacca58f2886-anim-dying-backwards.glb`,
    // Natural stride instead of the old red-carpet walk, whose crossed steps and
    // hip sway looked wrong under a battle gown.
    // Alternative: `...-anim-spear-walk-inplace.glb`.
    walk: `${MODEL_BASE}/13928f19-23a3-46ba-9879-aacca58f2886-anim-casual-walk-inplace.glb`,
  },
  b: {
    rigged: `${MODEL_BASE}/6c99342a-e9a5-4959-a59b-c207e15a5c72-rigged.glb`,
    idle: `${MODEL_BASE}/6c99342a-e9a5-4959-a59b-c207e15a5c72-anim-combat-stance.glb`,
    attack: `${MODEL_BASE}/6c99342a-e9a5-4959-a59b-c207e15a5c72-anim-sword-judgment.glb`,
    death: `${MODEL_BASE}/6c99342a-e9a5-4959-a59b-c207e15a5c72-anim-dead.glb`,
    walk: `${MODEL_BASE}/6c99342a-e9a5-4959-a59b-c207e15a5c72-anim-spear-walk-inplace.glb`,
  },
  n: {
    rigged: `${MODEL_BASE}/43f08150-5463-4112-9949-2e1a9a9a6bd2-rigged.glb`,
    idle: `${MODEL_BASE}/43f08150-5463-4112-9949-2e1a9a9a6bd2-anim-combat-stance.glb`,
    attack: `${MODEL_BASE}/43f08150-5463-4112-9949-2e1a9a9a6bd2-anim-charged-slash.glb`,
    death: `${MODEL_BASE}/43f08150-5463-4112-9949-2e1a9a9a6bd2-anim-dying-backwards.glb`,
    walk: `${MODEL_BASE}/43f08150-5463-4112-9949-2e1a9a9a6bd2-anim-confident-strut-inplace.glb`,
    // Carried through the leap, so the rider is charging rather than floating.
    run: `${MODEL_BASE}/43f08150-5463-4112-9949-2e1a9a9a6bd2-anim-standard-forward-charge-inplace.glb`,
  },
  r: {
    rigged: `${MODEL_BASE}/211b0ba5-2c7f-44ff-8143-b625bca41df1-rigged.glb`,
    idle: `${MODEL_BASE}/211b0ba5-2c7f-44ff-8143-b625bca41df1-anim-combat-stance.glb`,
    attack: `${MODEL_BASE}/211b0ba5-2c7f-44ff-8143-b625bca41df1-anim-heavy-hammer-swing.glb`,
    death: `${MODEL_BASE}/211b0ba5-2c7f-44ff-8143-b625bca41df1-anim-knock-down.glb`,
    // Full plate: an ordinary stride played at the guardian's slow cadence reads
    // as a heavy tread, where the hunched orc walk read as a monster.
    // Alternative: `...-anim-carry-heavy-object-walk-inplace.glb` (laden trudge).
    walk: `${MODEL_BASE}/211b0ba5-2c7f-44ff-8143-b625bca41df1-anim-casual-walk-inplace.glb`,
  },
  p: {
    rigged: `${MODEL_BASE}/36d8c7d4-2f42-4672-8908-e9298fce9b69-rigged.glb`,
    idle: `${MODEL_BASE}/36d8c7d4-2f42-4672-8908-e9298fce9b69-anim-combat-stance.glb`,
    attack: `${MODEL_BASE}/36d8c7d4-2f42-4672-8908-e9298fce9b69-anim-thrust-slash.glb`,
    death: `${MODEL_BASE}/36d8c7d4-2f42-4672-8908-e9298fce9b69-anim-knock-down.glb`,
    walk: `${MODEL_BASE}/36d8c7d4-2f42-4672-8908-e9298fce9b69-anim-spear-walk-inplace.glb`,
  },
  },
  // Solforiz, the Scorched Caliphate (10 November 2026). One 24-bone Meshy humanoid rig per figure; the clips are
  // skeleton-only files bound by bone name. The roles are the old sun empire's: the queen and the oracle cast,
  // everyone else closes and strikes.
  sun: {
    // The Scorched Sovereign brings the sunblade down in judgement.
    k: solforizSet("k"),
    // The Ash Matriarch burns her charge out of the censer (Charged Spell Cast).
    q: solforizSet("q"),
    // The Sulfur Oracle throws the alembic's fire (Charged Spell Cast 1).
    b: solforizSet("b"),
    // The Dune Reaver's charged slash with the hooked cleaver; he alone carries a run.
    n: { ...solforizSet("n"), run: `${SOLFORIZ_BASE}/n-run.glb` },
    // The Furnace Bastion swings the piston maul.
    r: solforizSet("r"),
    // The Ash Legionnaire thrusts with the spear; the duel library `bp` is baked from this rig and these clips.
    p: solforizSet("p"),
  },
  // Korvenia, the Grand Duchy under the eclipse. One 24-bone Meshy humanoid rig per figure; the clips are
  // skeleton-only files bound by bone name. The roles are the Grande Armée's, unchanged: pistols for the crown,
  // a kneeling marksman, a sabre, the field gun and the musket line.
  empire: {
    // The Sovereign Grand Duke never brawls and never closes: the pistol comes up, is held on the man (aim) and
    // fired from where he stands. No reload: `playReload` returns 0 and the fight skips the beat.
    k: korveniaSet("k", ["aim", "attack"]),
    // The Archmagistra fights with powder rather than witchfire: aim, the shot from the shoulder at full height,
    // then fresh powder and ball, still on her feet. The sword stays in her other hand.
    q: korveniaSet("q", ["aim", "attack", "reload"]),
    // The Astral Marksman stands at the ready between turns (Lower Weapon, Look, Raise), goes down on one knee
    // around the shot (rise, played backwards then forwards, see PieceAnimationSet.rise), aims from the knee and
    // fires out of that held aim, then reloads on the knee. No `attack`: a standing shot between a kneeling aim
    // and a kneeling reload made the old marksman stand up to fire and drop back down twice per shot.
    b: korveniaSet("b", ["aim", "rise", "reload"]),
    // The Eclipse Cuirassier: a cavalryman on foot, the sabre's charged slash; he alone carries a run.
    n: korveniaSet("n", ["attack", "run"]),
    // The Battery Magister lays the gun it hauls and serves it: its strike is the step in to the trail and the
    // shove on the lanyard (the gun is towed, never carried), then a kneeling reload at the muzzle.
    r: korveniaSet("r", ["attack", "reload"]),
    // The Violet Fusilier: musket into the shoulder (aim), the volley, a standing reload. Pawn against Pawn
    // fixes bayonets instead: the duel library `ep` was baked from this rig's thrust (`p-thrust.glb`).
    p: korveniaSet("p", ["aim", "attack", "reload"]),
  },
  // Kwind-09, the Kwind Zaibatsu. Every figure shares one 24-bone Meshy humanoid rig, so the clips are
  // skeleton-only files that bind onto the rigged figure by bone name. They fight with arc-tech and steam, not
  // powder: the casters (queen and bishop) throw the engine's spell, everyone else closes and strikes.
  kwind: {
    // The Chairman passes judgement with his arc cane: the same verdict clip the Aethelgard crown uses.
    k: kwindSet("k"),
    // The Charter Holder discharges her gauntlets through the charge rod (Charged Spell Cast).
    q: kwindSet("q"),
    // The Signal Officer throws a signal burst from the mast of his staff; he dies electrocuted.
    b: kwindSet("b"),
    // The Expressway Courier fights with his feet: a lunging roundhouse from the steam-vent boots, empty-handed.
    // He alone carries a run, for the leap.
    n: { ...kwindSet("n"), run: `${KWIND_BASE}/n-run.glb` },
    // The Foundry Bulwark brings the steam maul down in a charged ground slam.
    r: kwindSet("r"),
    // The Levy Trooper thrusts with the shock pike.
    p: kwindSet("p"),
  },
};

/** One Solforiz figure: its rigged sculpt and the four clips every figure carries. */
function solforizSet(kind: PieceKind): PieceAnimationSet {
  const clip = (name: string) => `${SOLFORIZ_BASE}/${kind}-${name}.glb`;
  return { rigged: clip("rigged"), idle: clip("idle"), attack: clip("attack"), death: clip("death"), walk: clip("walk") };
}

/** One Korvenia figure: its rigged sculpt, idle, death and walk, and the clips its role adds. */
function korveniaSet(kind: PieceKind, extra: ("aim" | "attack" | "reload" | "rise" | "run")[]): PieceAnimationSet {
  const clip = (name: string) => `${KORVENIA_BASE}/${kind}-${name}.glb`;
  const set: PieceAnimationSet = { rigged: clip("rigged"), idle: clip("idle"), death: clip("death"), walk: clip("walk") };
  for (const name of extra) set[name] = clip(name);
  return set;
}

/** One Kwind-09 figure: its rigged sculpt and the four clips every figure carries. */
function kwindSet(kind: PieceKind): PieceAnimationSet {
  const clip = (name: string) => `${KWIND_BASE}/${kind}-${name}.glb`;
  return { rigged: clip("rigged"), idle: clip("idle"), attack: clip("attack"), death: clip("death"), walk: clip("walk") };
}

/**
 * The magazine, sculpt by sculpt: every round the Grande Armée fires is a real
 * mesh, not a glowing dot, so a shot crossing the hall reads as a piece of metal
 * turning in the air.
 *
 * One sculpt per round in the barrel — the officer's cast lead pistol ball, the
 * line's battered .69 Charleville ball, the marksman's rifled Minié bullet and
 * the battery's pitted iron round shot. Every one of them comes back from the
 * generator as *directionless* (a body of revolution has no intrinsic front), so
 * the loader takes each sculpt's own measured long axis as the nose rather than
 * inventing a yaw correction — see `scene/gunfire.ts`. A sculpt that has not
 * arrived yet is forged procedurally in `scene/ammunition.ts`, so nobody ever
 * fires a blank while a download is in flight.
 */
export const SHOT_MODELS: ShotModelSource[] = [
  // Officer's flintlock: small, barely out of round, mould seam still on it.
  { ammo: "pistolBall", url: `${MODEL_BASE}/49825d82-a7a6-4658-98e0-0c86275128d5.glb` },
  // .69 soft lead, dented flat in places by the ramrod and stained with fouling.
  { ammo: "musketBall", url: `${MODEL_BASE}/737c408d-b677-4be0-a805-02354f7f3532.glb` },
  // The only conical round in the army: ogive nose, grease grooves, hollow base.
  { ammo: "minieBullet", url: `${MODEL_BASE}/76d56227-19ad-46cf-b9e8-b84f93bef133.glb` },
  // Six pounds of sand-cast iron, pockmarked and seamed round its middle.
  { ammo: "roundShot", url: `${MODEL_BASE}/dca2d8a4-736e-4e04-ace0-691ae325a730.glb` },
];

/**
 * The Napoleonic arms, sculpt by sculpt.
 *
 * A fantasy blade can be built from boxes and cylinders because nobody can check
 * it. The Grande Armée's arms cannot: a Charleville musket, an An XI cuirassier
 * sword and a flintlock pistol are documented objects, and a primitive
 * approximation of one reads as a toy in a hand that is otherwise a real sculpt.
 * Each entry is a generated mesh of the actual weapon, fitted into the prop frame
 * by `scene/armoury.ts` — which *measures* each model rather than trusting its
 * pose, because the generator hands these back lying along the diagonal of their
 * own bounding box.
 *
 * `grip` and `muzzle` are fractions of the weapon's length up from the butt — the
 * two things no measurement can find, since nothing in a mesh says "trigger".
 * Both were read off each sculpt's own cross-section profile (the bulge of the
 * lock on a firearm, the gap between pommel and guard on a blade) and land within
 * a couple of percent of the hand-built props they replace.
 *
 * A weapon with no entry here — every medieval and Sun Empire arm, and the
 * battery's towed field gun — is still built from primitives, and so is any of
 * these whose download fails: a plain musket beats an unarmed soldier.
 */
export const ARM_SCULPTS: Partial<Record<WeaponId, ArmSculptSource>> = {
  // Charleville Model 1777, bayonet fixed. Measured profile: butt plate at one
  // end, the lock's bulge at 0.22 of the length, bayonet socket at 0.80, point
  // at the far end — the longest silhouette on the board.
  musketBayonet: {
    url: `${MODEL_BASE}/bc6b8c09-5d21-440c-b145-eee190c2e0cf.glb`,
    length: 0.86,
    grip: 0.19,
    // The bore, not the bayonet point: the flash has to leave the barrel.
    muzzle: 0.8,
    family: "firearm",
  },
  // 1793 Versailles rifled carbine: cheek piece, leaf sight, no bayonet.
  marksmanRifle: {
    url: `${MODEL_BASE}/4fb92659-06c6-4bbe-b0d3-ed21f37c2c8b.glb`,
    length: 0.85,
    grip: 0.3,
    muzzle: 0.985,
    family: "firearm",
  },
  // An XI heavy cavalry sword: straight blade, four-branch brass bowl guard.
  cavalrySabre: {
    url: `${MODEL_BASE}/ebf0edf9-d446-4fa7-a0a7-d1db4e6123ed.glb`,
    length: 0.63,
    grip: 0.11,
    family: "blade",
  },
  // A general officer's dress sabre: gilt hilt, blued and gilt-etched blade.
  //
  // Length is the real object against the man carrying it, not a guess: an
  // officer's dress sabre runs about 95cm overall, and Napoléon stood 1.69m —
  // 1.75m to the crown of the bicorne this sculpt wears. That is 0.54, and it
  // puts the Emperor's blade *shorter* than the trooper's An XI (0.63) rather
  // than the longest steel on the board.
  imperialSabre: {
    url: `${MODEL_BASE}/47492c2e-f774-49e0-b2ef-113a02132a50.glb`,
    length: 0.54,
    grip: 0.11,
    family: "blade",
  },
  // The presentation sword: ivory grip, laurelled bow, eagle's head pommel.
  // This one arrives hilt-last; the fitter finds the point without being told.
  // A court sword is the longest, straightest blade worn at the imperial court
  // and still only about a metre overall — 0.58 of the figure wearing it.
  marengoSword: {
    url: `${MODEL_BASE}/307d49bd-b8c8-44b5-9837-bd55d8c849b6.glb`,
    length: 0.58,
    grip: 0.13,
    family: "blade",
  },
  // An XIII officer's flintlock pistol, gilt-mounted, muzzle-first in the file.
  officerPistol: {
    url: `${MODEL_BASE}/ff7079b3-d6d5-44a9-a43a-0bf4d3a2954d.glb`,
    length: 0.27,
    grip: 0.15,
    muzzle: 0.98,
    family: "firearm",
  },
};

/**
 * Orientation verdict reported by the generator for every sculpt:
 * hasIntrinsicFront = true, front = +Z, up = +Y.
 */
export const PIECE_MODEL_ORIENTATION = {
  localFrontAxis: "positiveZ",
  localUpAxis: "positiveY",
} as const;

// Match audio is bundled with the game: web/src/audio/gambit-assets.ts (made from web/sound-design/gambit).
const CRY_BASE = "https://r2-pub.rork.com/generated-audio/g9111r67kl6tq85g540sd";

/**
 * One death cry per figure per army. They are voiced in character — the ivory
 * kingdom dies like medieval Europeans, the Sun Empire like jaguar/eagle
 * warriors, the Grande Armée like men who have just been shot — so the ear can
 * tell what just fell, and which army it belonged to, without looking at the
 * board. The queens are the exception: breathy sighs and gasps, not shrieks.
 * Every clip is generated at a true one-second length, so the mixer plays them
 * back at their natural pitch instead of speeding a longer take up.
 * Loaded lazily after the mixer unlocks (they are only needed on a capture).
 */
const DEATH_CRIES: Record<ArmySkinId, Record<PieceKind, string>> = {
  ivory: {
    k: `${CRY_BASE}/c4d801f3-b8e7-42bb-b046-6b21e9ec40a5.mp3`,
    q: `${CRY_BASE}/e01a2d0f-2b13-426b-89b4-d40e67d4b16f.mp3`,
    b: `${CRY_BASE}/4ca6a216-52fc-4882-b51a-9a44d188edac.mp3`,
    n: `${CRY_BASE}/ebb33bba-cf2b-481f-aec6-4465a6a35253.mp3`,
    r: `${CRY_BASE}/f9d84835-112f-46de-951b-052f867814da.mp3`,
    p: `${CRY_BASE}/e4caca0d-8f61-4228-b349-025ae499cde5.mp3`,
  },
  sun: {
    k: `${CRY_BASE}/7efd7eb4-936a-4488-83ae-e0ebea314601.mp3`,
    // Young female voice — a plain drawn-out "ahhhh" scream cut by a gasp.
    q: `${CRY_BASE}/6fe2ac5d-b4e4-4655-9354-cfbb117bc7f5.mp3`,
    b: `${CRY_BASE}/6ae51ccd-12c2-4002-875d-ec4c1d907227.mp3`,
    n: `${CRY_BASE}/a66374c2-9253-4f07-8202-1001ccf6ba69.mp3`,
    r: `${CRY_BASE}/6107aca9-aa81-45ff-a3d5-eda9d457fc3b.mp3`,
    // Deep male voice — a rising shout cut short by the death gasp.
    p: `${CRY_BASE}/ffa27c35-53ff-4f3a-a71e-285aff8a2a4b.mp3`,
  },
  // The Grande Armée dies its own death. Where the ivory kingdom roars and the
  // Sun Empire shrieks, a powder army takes the ball and goes quiet fast: these
  // are all impact reactions — the air punched out first, the voice second.
  empire: {
    // Napoléon: a commanding grunt of shock bitten off through clenched teeth.
    // He does not scream; the coat closes on it.
    k: `${CRY_BASE}/dd0626e5-1b47-4d72-800b-503ae732f16d.mp3`,
    // Imperial Commander: sharp indrawn breath, then a low pained gasp fading —
    // held together rather than shrieked, unlike the two sorceress queens.
    q: `${CRY_BASE}/bbae4ca6-bb5c-46b5-be77-b2a4e6bfc890.mp3`,
    // Marshal-Tirailleur: hit on the knee he fires from — a clipped grunt and a
    // rasp low to the ground.
    b: `${CRY_BASE}/203b9d42-08e3-43e5-96e3-9c7653f419db.mp3`,
    // Cuirassier: a furious bellow boxed in by the steel helmet, ending wet.
    n: `${CRY_BASE}/f2391f92-4656-4dd2-bb62-8975ca2926a8.mp3`,
    // Artillery Guard: the heaviest man on the board — a deep winded groan
    // sagging in pitch as the weight goes down.
    r: `${CRY_BASE}/1dc52c19-e964-4089-a111-d0b1122b4198.mp3`,
    // Line Infantry: young, thin, panicked — a rising cry snapped short.
    p: `${CRY_BASE}/d32a7184-f41f-4ad9-a61b-a4dc386648e2.mp3`,
  },
  // Kwind-09 has no voices of its own yet. Until they are recorded, each figure borrows its Grande Armée
  // counterpart's impact cry: the air punched out of a body behind a gas mask suits them better than a roar.
  kwind: {
    k: `${CRY_BASE}/dd0626e5-1b47-4d72-800b-503ae732f16d.mp3`,
    q: `${CRY_BASE}/bbae4ca6-bb5c-46b5-be77-b2a4e6bfc890.mp3`,
    b: `${CRY_BASE}/203b9d42-08e3-43e5-96e3-9c7653f419db.mp3`,
    n: `${CRY_BASE}/f2391f92-4656-4dd2-bb62-8975ca2926a8.mp3`,
    r: `${CRY_BASE}/1dc52c19-e964-4089-a111-d0b1122b4198.mp3`,
    p: `${CRY_BASE}/d32a7184-f41f-4ad9-a61b-a4dc386648e2.mp3`,
  },
};

/** One selectable civilisation: sculpts, clips, arms, names and voices. */
export interface ArmySkin {
  id: ArmySkinId;
  /** The kingdom that fields this army; also the name of the side wearing it. */
  label: string;
  /** One line of flavour under the name. */
  blurb: string;
  /** Rank names, longest to shortest silhouette — used by the crests. */
  ranks: Record<PieceKind, string>;
  /** Procedural weapon family the figures are armed from. */
  arsenal: ArsenalId;
  /**
   * The side this army was painted for. When both sides wear the same skin the
   * native one keeps its own textures and the other is re-tinted into livery,
   * so the two armies never become indistinguishable.
   */
  native: Faction;
  still: Roster<string>;
  animated: Roster<PieceAnimationSet>;
  cries: Record<PieceKind, string>;
}

export const ARMY_SKINS: Record<ArmySkinId, ArmySkin> = {
  ivory: {
    id: "ivory",
    label: "Aethelgard",
    blurb: "Medieval Europe — plate, heater shields and witchfire.",
    ranks: { k: "King", q: "Queen", b: "Bishop", n: "Knight", r: "Rook", p: "Pawn" },
    arsenal: "kingdom",
    native: "w",
    still: STILL_MODELS.ivory,
    animated: ANIMATED_MODELS.ivory,
    cries: DEATH_CRIES.ivory,
  },
  sun: {
    id: "sun",
    label: "Solforiz",
    blurb: "The Scorched Caliphate — copper, sulfur and furnace steel under a burning sun.",
    ranks: { k: "King", q: "Queen", b: "Bishop", n: "Knight", r: "Rook", p: "Pawn" },
    arsenal: "sun",
    native: "b",
    still: STILL_MODELS.sun,
    animated: ANIMATED_MODELS.sun,
    cries: DEATH_CRIES.sun,
  },
  empire: {
    id: "empire",
    label: "Korvenia",
    blurb: "The Grand Duchy under the eclipse — violet, ivory and gold; pistols, rifles, muskets and cannon.",
    ranks: { k: "King", q: "Queen", b: "Bishop", n: "Knight", r: "Rook", p: "Pawn" },
    arsenal: "empire",
    native: "b",
    still: STILL_MODELS.empire,
    animated: ANIMATED_MODELS.empire,
    cries: DEATH_CRIES.empire,
  },
  kwind: {
    id: "kwind",
    label: "Kwind-09",
    blurb: "The Kwind Zaibatsu — soot, verdigris, sodium lamps and arc-tech.",
    ranks: { k: "King", q: "Queen", b: "Bishop", n: "Knight", r: "Rook", p: "Pawn" },
    arsenal: "kwind",
    native: "b",
    still: STILL_MODELS.kwind,
    animated: ANIMATED_MODELS.kwind,
    cries: DEATH_CRIES.kwind,
  },
};

/** Presentation order of the skins in the settings panel. */
/** Presentation order of the skins in the legacy shell's muster. The generated armies' models are served to it
 * from the main game's public folder (web/vite.config.ts, sharedArmyModels). */
export const ARMY_SKIN_ORDER: ArmySkinId[] = ["ivory", "sun", "empire", "kwind"];

/** Which army each side musters until the player says otherwise. */
export const DEFAULT_ARMY_SKINS: Record<Faction, ArmySkinId> = { w: "ivory", b: "sun" };

/**
 * Black powder, recorded rather than synthesised. Each barrel has its own take:
 * the synthesised voices in the mixer are still played underneath for the
 * sub-bass and the timing, but what the ear hears on top is a real report.
 * Streamed lazily after the mixer unlocks — only the Grande Armée needs them.
 *
 * These four barrels were re-recorded to start *on the transient*. The previous
 * set was generated as ordinary sound effects, which meant each one opened with
 * room tone before the shot: the Charleville had 54ms of silence in front of its
 * crack and the rifled barrel did not peak until 171ms in. Played from sample
 * zero on the frame the hammer fell, the report therefore arrived three to ten
 * frames *after* the muzzle flash — the shot was seen, then heard. The mixer now
 * also finds each take's true onset at decode time (see `analyseTake`), so a
 * regenerated clip that still carries a lead-in is trimmed rather than trusted.
 */
export const GUN_AUDIO_URLS = {
  /** The Emperor's flintlock: a dry, bright crack. */
  pistol: `${CRY_BASE}/a8cbcada-acce-4a51-8690-974d0e50a68a.mp3`,
  /** A Charleville musket in a stone hall: crack over a chest thump. */
  musket: `${CRY_BASE}/b042be28-3bb5-48e8-b0a5-ef7a1fbec2d5.mp3`,
  /** The marksman's rifled barrel: a tighter, thinner whip-crack. */
  rifle: `${CRY_BASE}/9ab8b947-9b2c-4cfc-8b26-653be55a6451.mp3`,
  /** The battery: a boom with the carriage running back over stone under it. */
  cannon: `${CRY_BASE}/65e94019-873c-478d-a688-e76d01bb73a3.mp3`,
  /** The ball arriving: ricochet whine cut short by a thud into a body. */
  impact: `${CRY_BASE}/a0f8c443-5140-41f8-b21c-770450ae9751.mp3`,
} as const;

/** Which recorded barrel each rank of the Grande Armée fires. */
export type GunVoice = "pistol" | "musket" | "rifle" | "cannon";
