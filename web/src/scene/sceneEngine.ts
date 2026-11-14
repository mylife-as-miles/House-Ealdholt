import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

import { ARMY_SKINS, SHOT_MODELS, type ArmySkinId, type ArsenalId, type GunVoice } from "../assets/generated";
import type { GameController } from "../core/gameController";
import type { Faction, GameResult, GameSnapshot, MoveEvent, PieceKind, SquareId } from "../core/types";
import { audio, type FootstepTimbre, type PleaHandle } from "../audio/audioManager";
import { captureLayers, pleaWait, type FleshFamily } from "../../../shared/play/gambit-sound";
import * as gambitSound from "../../../shared/play/gambit-sound";
import type { ArenaTheme } from "./arena";
import { ARENA_LOOKS, DEFAULT_ARENA } from "./arena";
import { Battlefield } from "./battlefield";
import { JungleOverlay } from "./jungle";
import { BOARD_TOP, BoardView, type HighlightKind, TILE, squareToWorld, worldToSquare } from "./board";
import { BoardVoices } from "./boardVoices";
import { CastleHall, buildEnvironmentMap } from "./environment";
import { describeGpu, probeGpu, reflectionProbeWorks, type GpuReport } from "./diagnostics";
import { CheckAlarm } from "./alarm";
import { EffectsSystem, ShakeSystem } from "./effects";
import {
  FACTION_ACCENT,
  PIECE_HEIGHT,
  PieceFactory,
  PieceView,
  type ClipName,
  type MarchClip,
  type TemplateKey,
} from "./pieces";
import { PostFX } from "./postfx";
import { QUALITY_SETTINGS, type QualityPreset } from "./quality";
import { nextRenderTimestamp, scaledPixelRatio, type FrameLimit } from "../../../shared/menu/render-resolution";
import { releaseContextWhenDetached } from "./contextRelease";
import { AMMUNITION, type AmmoKind } from "./ammunition";
import { disposeShatterAssets, impactDust, spawnImpactShatter, type ImpactBody } from "./shatter";
import {
  GUN_LOOK,
  disposeGunAssets,
  flyShot,
  primeShotModel,
  spawnMuzzleFlash,
  spawnPowderCloud,
} from "./gunfire";
import { SpellLightPool, SpellOrb, spellLookFor, type SpellLight, type SpellLook } from "./spells";
import {
  disposeStrikeAssets,
  spawnConquestClaim,
  spawnGroundWave,
  spawnPillar,
  spawnSlash,
} from "./strikes";
import { CombatCancelled, PairedCombatDirector, stageCombatPair, type CombatSession } from "./pairedCombat";
import { combatSeed, type CombatPlan } from "./combat/director";
import { DuelCameraTimeline, rankDuelShots, type CameraPose, type DuelKill, type DuelShot } from "./combat/duelCamera";
import { CONTACT_FIT, tuneContacts, type ContactForecast } from "./combat/contactTuning";
import { placeLocal, turnLocal } from "./combat/sweptContact";
import { blowSide, deathTiming, directionalReaction, fallHeading, planKnockback, DEATH_WEIGHT } from "./combat/deathWeight";
import { EngineCombatStage, type StageHost } from "./combat/engineStage";
import { GoreSystem } from "./gore/GoreSystem";
import { goreSeed, impactIdOf, type GoreEvent, type GoreIntensity, type GoreKind, type GorePlan } from "./gore/GoreTypes";
import { goreBudget, goreShow, type GoreShow, type KillMoment, type TierSettings } from "./gore/goreTiers";
import { planGore } from "./gore/GoreDirector";
import { killMoment } from "./gore/killMoment";
import { FatalityDirector, type Fatality, type FatalityStats } from "./fatality/FatalityDirector";
import { FATALITY, SEVER_CUT, WOUND_LOOK, WOUND_SHOT, closeShotWaits, fatalityPlays, limbLanding, severCutPlays, severFrame, woundFrame, woundLookFrame, woundLookPlays, woundShot, type FatalityBeat } from "./fatality/fatalityPlan";
import { XrayLayer, type XrayStats } from "./fatality/xray";
import { FluidBlood, type FluidLight, type FluidStats } from "./fatality/fluid";
import { pourShares, stumpStart, stumpWound, type StumpChance } from "./fatality/stumpPlan";
import { channelLength } from "./fatality/anatomyPlan";
import { ScorchMarks, type ScorchStats } from "./vfx/scorch";
import { DeathPhysics } from "./death/physics/DeathPhysics";
import { ragdollWanted } from "./death/ragdoll/ragdollGate";
import { WEAPON_CUT, limbLaunch, planSevers, weaponOf, woundSevers, type SeverCut, type SeverLimb, type SeverRule } from "./death/sever/severPlan";
import { scorchSeed, type ScorchEvent, type ScorchSource } from "./vfx/scorchPlan";
import { regionsOf, resolveImpact } from "./gore/ImpactResolver";
import { burnsOrFades, deathCause, deathStyle, riteDeathStyle, type DeathCause, type DeathStyle } from "./death/deathStyle";
import { BurningBodies } from "./death/burn/burningBodies";
import { planFade } from "./death/burn/burnPlan";
import { FlipbookSystem, type VfxPlayOptions } from "./vfx/flipbook";
import { CombatFlourish, weaponEdge, type FlourishStats, type HandSampler } from "./vfx/flourish/flourish";
import { blowAccent } from "./moments/momentPlan";
import { PROCEDURAL_SHARE, STEP_DUST_GAP, dustShade, hidesContact, seatFromEye, stoneUnder, vfxCue, vfxGlow, vfxLight, type VfxArmy, type VfxDetail, type VfxFlags, type VfxMoment } from "./vfx/wiring";
import { AIR_OF_MOMENT, stirAir, type AirSink } from "./vfx/airWiring";
import type { AirImpulseKind } from "../../../shared/play/air-disturbance";
import { Claiming, type ClaimHandle, type Claimant } from "./vfx/mystic/claiming";
import { canMake, spellEntry } from "./vfx/spells/library";
import type { SpellEntry, SpellWound } from "./vfx/spells/spell";
import { chooseSpell, type SpellId } from "./vfx/spells/spellbook";
import { SpellStage, type SpellEvents, type SpellFlight } from "./vfx/spells/stage";
import { riteFor } from "./rites/library";
import type { RiteDeath, RiteEffect, RiteEntry, RiteState, RiteTroop } from "./rites/rite";
import { RITE_SHOT, riteShot, shotTurn, turnHome, type RiteShotView } from "./rites/riteShot";
import { SPELL_SHOT, bodyFrame, bodySights, burstFrame, gatherFrame, gatherSights, rowScreen, shoulderShot, spellShot } from "./rites/spellShot";
import { CLAIM_LINGER, claimCloseShot, claimIsWatched, claimShot } from "./vfx/mystic/claimPlan";
import { VFX_RECIPES, type VfxEffectId } from "./vfx/library";
import { finishPrograms, materialsOf } from "./programWarm";
import { missingClips, pawnCombatant } from "./combat/pawnDuel";
import { CombatFeel } from "./combat/feelLayer";
import { pieceFigure } from "./combat/pieceFigure";
import { CombatControl, runCombat } from "./combat/runner";
import { KINGDOM_SHIELD } from "./combat/choreography";
import { contactEventSeed, contactEvidenceUsable, type ContactMaterial } from "../../../shared/play/contact-vfx";
import { dryContactMaterial } from "./vfx/contactMaterial";
import { BoardReactionDirector, type BoardObserver, type BoardReactionEvent } from "./boardReactionDirector";
import { boardRoyalThreat } from "./boardRoyalState";
import { cursorHome, heldTapOutcome, premoveReach, stepCursor, tapAction, type CursorDirection, type InputPhase, type QueuedAim, type TapAction } from "./boardInput";
import { rayOnBody, resolvePick, type FigureHit } from "./boardPick";
import { CheckmatePresentation } from "./checkmatePresentation";
import { MatchOpeningTimeline, musterReveal, type OpeningShot } from "./matchOpening";
import { MusterEffects } from "./musterEffects";
import { MysticLanding } from "./vfx/mystic/landing";
import { BEAM_BUDGET } from "./vfx/mystic/beamPlan";
import { KnightVaultEffects, type VaultFxStats } from "./finisher/knightVaultVfx";
import {
  VAULT_LOOK, VAULT_RING_RADIUS, VAULT_TIMING, planKnightVault, strikeTiming, vaultLanding, vaultLift, vaultPose, vaultShots,
  type VaultArmy, type VaultContext, type VaultCue, type VaultKind, type VaultPlan, type VaultShotName,
} from "./finisher/knightVaultPlan";
import { DEFAULT_PROMOTION_FOCUS, focusEase, isPromotionChoice, promotionFocusLook, stepPromotionFocus, type PromotionChoice } from "./promotion/promotionChoice";
import { CHOICE_FIGURE, CHOICE_SPACING, PROMOTION_LOOK, arrivalFrame, choiceStage, choiceStaged, clearestFacing, columnPower, cuesBetween, figureFormed, figureLift, landingSquash, pawnLift, pawnUnmade, planPromotion, PROMOTION_TIMING, type PromotionPlan, type PromotionRank } from "./promotion/promotionPlan";
import type { CombatSequence } from "../../../shared/play/combat-sequences";
import { BattleBonds, HOME_FACING, type BattleEmotionEvent } from "./battleBonds";
import { readBattle, startingFen, type BattleMorale, type BattleStory } from "../../../shared/play/battle-memory";
import { DownfallStage } from "./downfall/downfallStage";
import { DOWNFALL_TIMELINES, downfallBeat, downfallKind, type DownfallPlan } from "./downfall/downfallPlan";
import { MomentDirector, type MomentEvent, type MomentScreen, type MomentSignals } from "./moments/MomentDirector";
import type { BlowPlan, MomentGrade } from "./moments/momentPlan";
import { storyRenown, writeChronicle, type Chronicle } from "../../../shared/play/chronicle";
import { capturesBefore, checkRunAt, encodeVoiceLine, lastSpellBefore, pawnOrigins, showRandom, showSeed, takenThrough, voiceLinesFromComment, withSeededRandom, type SpellHistoryRules } from "../../../shared/play/replay-show";
import { Ease, type Easing, TweenManager, holdWaits, wait } from "./tween";
import {
  HALL_INNER_RADIUS,
  frameShot,
  lensCeiling,
  nudgeOrbit,
  orbitLimits,
  readViewport,
  seatAzimuth,
  type Framing,
  type OrbitLimits,
  type ViewportProfile,
} from "./viewport";

export type CameraPreset = "white" | "black" | "top" | "cinematic";

/**
 * How the camera behaves during a computer-vs-computer showcase.
 *
 * - `still` holds one framing and never moves on its own.
 * - `orbit` drifts slowly around the board (the old behaviour).
 * - `follow` keeps the figure on the move — and the fight it walks into —
 *   centred in frame, pulling in tighter for the kill.
 */
export type ShowcaseCamera = "still" | "orbit" | "follow";

/** What became of a piece held, or a move queued, while the board was busy (SceneCallbacks.onMoveQueued). */
export type QueuedEnd = "played" | "refused" | "let-go";

export interface SceneCallbacks {
  onLoadProgress: (ratio: number) => void;
  onReady: () => void;
  onPromotionOpen: (open: boolean) => void;
  /** The picker's focus moved (promotion/promotionChoice.ts): the HUD's panel highlights the same row. */
  onPromotionFocus?: (kind: PieceKind) => void;
  onQualityAdjusted: (preset: QualityPreset) => void;
  onFps: (fps: number) => void;
  onContextLost: () => void;
  onCameraFlipped?: (flipped: boolean) => void;
  /** A Combat Director fight took or left the stage: while one is on, `skipCombat()` does something. */
  onCombatActive?: (active: boolean) => void;
  onTacticalView?: (active: boolean) => void;
  onConclusionState?: (active: boolean) => void;
  /**
   * The chronicle of a battle that has ended (shared/play/chronicle.ts), written by the ending (playEndCinematic) from
   * the record, the live game's and a replay's alike; null when the board leaves that ending for a new game.
   */
  onChronicle?: (chronicle: Chronicle | null) => void;
  /**
   * A piece was pressed while the board was busy and waits (`to` null), was told where to go, or waits no longer
   * (null, with what became of it: it was let go, or its queued move was played or refused). While it is not null,
   * `cancelKeyboardSelection()` has something to let go of.
   */
  onMoveQueued?: (move: { from: SquareId; to: SquareId | null } | null, ended?: QueuedEnd) => void;
  /**
   * Fired when the engine had to drop part of the pipeline to get a picture on
   * screen. `safe` is true once it has fallen all the way back to safe
   * rendering, so the UI can persist that choice for the next visit.
   */
  onRenderFallback?: (message: string, safe: boolean) => void;
}

interface CameraShot {
  position: THREE.Vector3;
  target: THREE.Vector3;
}

const CAMERA_SHOTS: Record<CameraPreset, CameraShot> = {
  white: { position: new THREE.Vector3(0, 6.4, 8.6), target: new THREE.Vector3(0, 0.35, 0) },
  black: { position: new THREE.Vector3(0, 6.4, -8.6), target: new THREE.Vector3(0, 0.35, 0) },
  top: { position: new THREE.Vector3(0, 12.4, 0.35), target: new THREE.Vector3(0, 0.2, 0) },
  cinematic: { position: new THREE.Vector3(9.6, 3.6, 6.8), target: new THREE.Vector3(-0.4, 0.5, -0.4) },
};

/**
 * The showcase framing: higher and further back than the cinematic shot, so the
 * whole board reads at once and no figure is seen through the haze at floor
 * level. This is the angle a still showcase holds for the entire duel.
 */
const SHOWCASE_SHOT: CameraShot = {
  position: new THREE.Vector3(7.1, 6.5, 8.2),
  target: new THREE.Vector3(0, 0.35, 0),
};

/** Three named silhouettes used only by the authored title tableau. */
const MENU_TABLEAU = new Map<SquareId, { position: THREE.Vector3; facing: THREE.Vector3 }>([
  ["e5", { position: new THREE.Vector3(0.2, 0, 0.15), facing: new THREE.Vector3(-0.15, 0, 1) }],
  ["c3", { position: new THREE.Vector3(-1.7, 0, -0.8), facing: new THREE.Vector3(0.2, 0, 1) }],
  ["f6", { position: new THREE.Vector3(1.75, 0, -1.15), facing: new THREE.Vector3(-0.35, 0, 1) }],
]);

/** What the follow camera looks at between moves. */
const BOARD_FOCUS = new THREE.Vector3(0, 0.45, 0);

/**
 * How far the follow rig leans towards the action, as a fraction of the way from
 * the board centre to the figure being followed.
 *
 * A full chase (1) puts the figure dead centre, but it also drags the eye a full
 * board-width sideways — straight into the hall wall on every near-side move.
 * Leaning keeps the whole position in frame and the rig in open air.
 */
const FOLLOW_LEAN = 0.72;

/**
 * How much of its distance the follow rig gives up before it starts to climb,
 * when the hall has run out of room behind the action. A step closer costs the
 * picture far less than a climb towards a top-down view does.
 */
const FOLLOW_GIVE = 0.18;

/** Clearance held between the follow rig's eye and the hall wall. */
const FOLLOW_WALL_MARGIN = 0.4;

/**
 * The flat tactical map: high above the board, dead centre and shot through a
 * narrow lens so the squares read as a grid instead of a receding perspective.
 */
const TACTICAL_SHOT: CameraShot = {
  position: new THREE.Vector3(0, 22, 0.55),
  target: new THREE.Vector3(0, 0, 0),
};
const TACTICAL_FOV = 28;
const DEFAULT_FOV = 46;

/**
 * The window the shots above were authored against. Every framing is re-solved
 * for the surface actually being drawn into (`scene/viewport.ts`) — a phone held
 * upright needs a different distance, elevation and lens to see the same board.
 */
const AUTHORED_VIEW: ViewportProfile = {
  width: 1440,
  height: 900,
  aspect: 1.6,
  handheld: false,
  portrait: false,
};

const PROMOTION_CHOICES: PieceKind[] = ["q", "r", "b", "n"];

/**
 * When the frame is sampled for the black-screen watchdog, in seconds since the
 * first frame. The first check is late enough that the hall is standing and the
 * intro has moved off its opening frame.
 */
const DARK_FRAME_CHECKS = [2, 3.4, 4.8, 6.2, 8];

/**
 * How each rank sounds when it goes down: the court and the big bodies die
 * louder and a shade lower, footsoldiers thinner and higher.
 */
/** How long after the blow a rigidly toppled body (no death clip) is down on the stone. */
const TOPPLE_LANDING_SECONDS = 0.45;

/**
 * How far along the floor, away from the camera, each flipbook effect is seated from the point it marks
 * (world units; negative is towards the camera). Dust goes behind the figure it belongs to, so the body
 * stands whole in front of it and the sprite's plane does not slice through it or cover a wound. A spell
 * burst goes in front of its target, so the fire is whole.
 */
const VFX_SEAT = { fall: 0.3, step: 0.1, bash: 0.14, mist: 0.12, slam: 0.3, spell: -0.28 } as const;
/**
 * The flipbook atlases the captures use: fetched behind the game, and their layers built under a match's loading screen.
 * Not the scuff: step dust is a puff of the powder smoke now (vfx/library.ts `stepDust`), and nothing else draws it.
 */
const CAPTURE_VFX: readonly VfxEffectId[] = ["dust", "smokePuff", "explosion", "flare", "smoke", "fire"];
/** A directed fight: seconds from the start of the fall to the body on the floor. */
const DIRECTED_FALL_SECONDS = 1;
/**
 * A directed fight: how bright the shock ring on the struck tile is drawn, against a plain capture's: not at all. The
 * duel camera stands close. At full strength the ring under the victim was the brightest thing in the shot, and even
 * at 0.22 it was an orange smear on the stone beside the body (the VFX audit's duel, 2.8 s): a blade going into a
 * body does not light the floor. The tiles still jolt.
 */
const DIRECTED_RING = 0;
/**
 * The widest an impact's flash is drawn: its scale in effects.spawnFlash, about a square and a half across while it is
 * bright. It holds the stone's flash under any blow (strikeImpact) and the gun's at the body. At its old 4 the field
 * gun's flash washed the whole impact flat orange-white for a fifth of a second (the VFX audit's field gun, 1.8 s); a
 * heavier blow jolts the tiles and shakes the camera harder instead.
 */
const IMPACT_GLOW = 1.45;

/**
 * What a round tears out of a figure dressed in cloth, in its kingdom's own colours (impactBody), read off the
 * figures: Aethelgard's cleric in cream wool and gold over buff leather; Solforiz's robes in sand, ochre and rust with
 * their brass; Korvenia's violet and cream with gilt braid; Kwind-09's charcoal quilting with verdigris and brass.
 */
const CLOTH_DEBRIS: Readonly<Record<ArmySkinId, readonly number[]>> = {
  ivory: [0xe9e2cf, 0xd2c6a6, 0xb89a52, 0x8a6a3e],
  sun: [0xd9b77c, 0xb5824a, 0x8e2f22, 0x6b4a2c, 0xa8873c],
  empire: [0x4b1f6e, 0x6a3a8f, 0xe8dcc0, 0xb08a3c, 0x2a1640],
  kwind: [0x2e2f2c, 0x45473f, 0x5f8a7c, 0x8c6a3a, 0x6b3a22],
};
/** The longest a conquest ring waits for the view to be home (claimRing), in seconds. */
const CLAIM_RING_WAIT = 6;
/** A directed fight: the hit and the death are blended in over this long, not cut to. */
const DIRECTED_BLEND = 0.18;
/** A directed fight: how briskly the killer walks onto the square (glide's `hurry`). */
const DIRECTED_CLAIM_HURRY = 2;
/** A directed fight: the most the blow is held back for a plea still being spoken. */
const DIRECTED_PLEA_HOLD = 0.4;
/** Frame-time multiplier while a skipped fight plays out its ending. */
const SKIP_HURRY = 3;
/**
 * A quiet move asked to hurry (SceneEngine.hurryMove): how many times faster what is left of its walk, and of a
 * duel's turn to the next player, runs. The same pace a skipped fight plays out at: quick, and still seen to happen.
 */
const WALK_HURRY = 3;
/** Where motion is reduced a hurried move is cut: its tweens are given this many times the frame's time, and end in it. */
const HURRY_CUT = 1000;
/** Nowhere: where a piece that is not held may be told to go (SceneEngine.heldReach). */
const NO_SQUARES: ReadonlySet<SquareId> = new Set();
/**
 * A body run through by a spell: the seconds its death jolts on before it is held where it was struck, and the
 * longest it is held up if the spell never lets go.
 */
const PIERCE_JOLT = 0.12;
const PIERCE_HOLD = 4;
/** Seconds a summon's victim stands with a limb just severed before its body bursts, so the sever is seen. */
const SEVER_BEFORE_BURST = 1.1;

/**
 * What a summon's blow does to the body, by how the piece dies under it (rites/rite.ts RiteDeath): talons and teeth
 * go in, fire sears, a body torn apart or thrown down is crushed. Never the Queen's own weapon.
 */
const RITE_FLESH: Readonly<Record<RiteDeath, FleshFamily>> = { held: "stab", "held-burn": "blast", burn: "blast", burst: "crush", thrown: "crush" };

/**
 * The spell whose gathering a Queen's call is heard by, as she summons (vfx/spells/spellbook.ts): none for Solforiz,
 * whose call is the generic gathering of fire.
 */
const SUMMON_GATHER: Partial<Record<VfxArmy, SpellId>> = { ivory: "frost-line", empire: "unmaking", kwind: "storm-bolt" };

/** The hotseat view's swing back to the side to move after Undo. */
const UNDO_SWING_SECONDS = 0.6;

const CRY_WEIGHT: Record<PieceKind, { volume: number; rate: number }> = {
  k: { volume: 1.1, rate: 0.94 },
  q: { volume: 1.05, rate: 0.98 },
  r: { volume: 1, rate: 0.92 },
  b: { volume: 0.92, rate: 1 },
  n: { volume: 0.95, rate: 1.01 },
  p: { volume: 0.85, rate: 1.05 },
};

/**
 * The colour of the motes a body leaves behind as it burns away: cold
 * soul-light for the ivory kingdom, live embers for the Sun Empire.
 */
const EMBER_COLOR: Record<Faction, number> = {
  w: 0xbcd8ff,
  b: 0xff8a3c,
};

/**
 * How heavy each rank feels against the board — drives the pitch, ring and
 * loudness of the wooden knock when a figure is lifted or set down.
 */
const WOOD_WEIGHT: Record<PieceKind, number> = {
  k: 1,
  q: 0.88,
  r: 0.82,
  b: 0.52,
  n: 0.58,
  p: 0.3,
};

/** How one rank crosses the board on its own legs. */
interface Gait {
  /** Footfalls put down per square of travel — the length of the stride. */
  stepsPerTile: number;
  /** Footfalls per second — the cadence of the march. */
  cadence: number;
  /** What the boot sounds like against the stone. */
  timbre: FootstepTimbre;
  /** Loudness of one footfall. */
  volume: number;
}

/**
 * The twelve figures do not walk alike. Footsoldiers take short, quick, scuffing
 * steps; the tower guardians tread slowly in full plate; the crown crosses the
 * board at a deliberate pace that nothing on the board hurries.
 */
const GAITS: Record<PieceKind, Gait> = {
  k: { stepsPerTile: 1.55, cadence: 1.85, timbre: "regal", volume: 1 },
  q: { stepsPerTile: 1.7, cadence: 2.1, timbre: "regal", volume: 0.88 },
  r: { stepsPerTile: 1.5, cadence: 1.95, timbre: "plate", volume: 1.12 },
  b: { stepsPerTile: 1.9, cadence: 2.45, timbre: "leather", volume: 0.78 },
  n: { stepsPerTile: 2, cadence: 2.9, timbre: "plate", volume: 0.95 },
  p: { stepsPerTile: 2, cadence: 2.7, timbre: "scuff", volume: 0.72 },
};

/**
 * The two ranks that never touch what they kill: the sorceress queen and the
 * staff-bearing mage. Both open the fight from where they stand, throwing a
 * ball of fire down the line, and only walk onto the square once the body on it
 * has burned away. Under the Grande Armée's arsenal the same two ranks keep the
 * distance but trade the fire for powder (see {@link attackStyle}).
 */
const RANGED_KINDS: PieceKind[] = ["q", "b"];

/**
 * How a rank opens a fight, once its army's arsenal is taken into account.
 *
 * - `melee` — walk in and strike (see {@link STRIKES}).
 * - `spell` — gather fire on the spot and throw it (see {@link SPELLS}).
 * - `gun` — level a barrel and fire (see {@link GUNS}).
 *
 * Korvenia is the one army that fights with powder: its Emperor settles matters
 * with a flintlock, its line infantry with a musket volley and its battery with
 * the field gun it hauls. The cuirassier still closes, sabre first. Its commander
 * and its marshal are the exception: the army's two occultists cast, through the
 * armillary wand and the seal lantern (see vfx/spells/spellbook.ts).
 */
type AttackStyle = "melee" | "spell" | "gun";

const GUNPOWDER_KINDS: PieceKind[] = ["k", "r", "p"];

function attackStyle(kind: PieceKind, arsenal: ArsenalId): AttackStyle {
  if (arsenal === "empire" && GUNPOWDER_KINDS.includes(kind)) return "gun";
  return RANGED_KINDS.includes(kind) ? "spell" : "melee";
}

/**
 * How a charging killer comes up into its guard (playCaptureCinematic): over its last two footfalls, or its whole
 * charge when that is shorter, but never more slowly than this many seconds.
 */
const GUARD_RISE = { steps: 2, seconds: 0.8 } as const;

/**
 * How one rank's blow is staged. The shape of a hand-to-hand kill never changes
 * — charge, square up, strike, crumble — but its weight does, and it climbs
 * with rank: a footsoldier stabs and moves on, a rider cuts on the charge, a
 * tower guardian puts the floor out of shape, and the crown calls the light
 * down before it swings.
 */
interface StrikeProfile {
  /** Degrees of lens punch-in held over the beat. */
  zoom: number;
  /** March-speed multiplier on the run into the stand-off. */
  charge: number;
  /** Held breath between arriving and swinging. */
  wind: number;
  /** Scales the flash, the sparks, the board hit and the camera kick. */
  power: number;
  /** Loudness of the swing through the air; 0 keeps the wind-up silent. */
  swing: number;
  /** 0 = a light blade, 1 = a siege weapon being hauled round. */
  heft: number;
  /** Arc of steel left hanging where the blade went through. */
  slash: { size: number; color: number } | null;
  /** Wave rolling out across the stone, for a blow that reaches the floor. */
  wave: { radius: number; color: number } | null;
  /** Column of light dropped on the condemned before the blow. */
  pillar: { radius: number; color: number } | null;
  /** Dust torn up along the line of a charge. */
  wake: boolean;
  /** Second tremor a beat after the strike; 0 leaves the hall still. */
  aftershock: number;
  /** Hitstop on the frame of contact, before the body starts to go down. */
  hold: number;
}

/**
 * The six blows, in order of what the rank is worth. The footsoldier's line is
 * the original beat and is deliberately left untouched — everything above it is
 * measured against it.
 */
const STRIKES: Record<PieceKind, StrikeProfile> = {
  p: {
    zoom: 5.5,
    charge: 1.35,
    wind: 0.1,
    power: 1,
    swing: 0,
    heft: 0,
    slash: null,
    wave: null,
    pillar: null,
    wake: false,
    aftershock: 0,
    hold: 0,
  },
  // The rider arrives faster than it can be answered and cuts on the way past.
  n: {
    zoom: 7.2,
    charge: 1.75,
    wind: 0.04,
    power: 1.35,
    swing: 0.7,
    heft: 0.3,
    slash: { size: 1.7, color: 0xfff3d8 },
    wave: null,
    pillar: null,
    wake: true,
    aftershock: 0.12,
    hold: 0.05,
  },
  // The mage only ever fights at range; this is a safety net, not a beat.
  b: {
    zoom: 6,
    charge: 1.4,
    wind: 0.12,
    power: 1.15,
    swing: 0.45,
    heft: 0.15,
    slash: { size: 1.2, color: 0xd8e6ff },
    wave: null,
    pillar: null,
    wake: false,
    aftershock: 0,
    hold: 0.03,
  },
  // Plate and a hammer: slow in, and the stone takes most of the blow.
  r: {
    zoom: 8.6,
    charge: 1.1,
    wind: 0.24,
    power: 1.8,
    swing: 1,
    heft: 0.95,
    slash: null,
    wave: { radius: 3.2, color: 0xffa257 },
    pillar: null,
    wake: false,
    aftershock: 0.3,
    hold: 0.09,
  },
  // Never reached — the sorceress burns her victims from her own square.
  q: {
    zoom: 8,
    charge: 1.3,
    wind: 0.16,
    power: 1.6,
    swing: 0.6,
    heft: 0.35,
    slash: { size: 1.5, color: 0xffe0b0 },
    wave: null,
    pillar: null,
    wake: false,
    aftershock: 0.14,
    hold: 0.06,
  },
  // An execution, not a fight: the light comes down, the bell rings, then gold.
  k: {
    zoom: 11,
    charge: 1.2,
    wind: 0.3,
    power: 2.25,
    swing: 1,
    heft: 0.7,
    slash: { size: 2, color: 0xffdf9a },
    wave: { radius: 3.7, color: 0xffcf7a },
    pillar: { radius: 0.6, color: 0xffe3a8 },
    wake: false,
    aftershock: 0.34,
    hold: 0.13,
  },
};

/**
 * How big a capture reads, by what was taken — not by who took it.
 *
 * This is the one weight on the board that belongs to the *victim*: a pawn
 * trading itself off and a queen going down are the same choreography, and the
 * only thing that can tell them apart at the moment the square changes hands is
 * how much noise and light the claim is allowed to make. Ordered as the ranks
 * are actually valued, so the ear reads the exchange without checking the tray.
 */
const CONQUEST_WEIGHT: Record<PieceKind, number> = {
  p: 0.16,
  n: 0.42,
  b: 0.46,
  r: 0.64,
  q: 0.88,
  k: 1,
};

/** How much fire a caster throws, and what it does when it lands. */
interface SpellProfile {
  /** Degrees of lens punch-in held over the beat. */
  zoom: number;
  /** Seconds of wind-up added on top of the cast clip. */
  gather: number;
  /** Size of the ball held at the head of the staff. */
  orb: number;
  /** How many bolts go down the line. */
  bolts: number;
  /** Scales the blast at the far end. */
  blast: number;
  /** Radius of the fire rolled out across the square; 0 for none. */
  ring: number;
}

/** The mage: one bolt, thrown clean. */
const MAGE_SPELL: SpellProfile = { zoom: 4.5, gather: 0, orb: 0.42, bolts: 1, blast: 1, ring: 0 };

/**
 * The sorceress: a longer, heavier gather and a volley of three — two leaders
 * that break on the body and a killing bolt behind them that takes the square
 * with it.
 */
const QUEEN_SPELL: SpellProfile = { zoom: 7.5, gather: 0.28, orb: 0.66, bolts: 3, blast: 1.75, ring: 3.4 };

function spellProfile(kind: PieceKind): SpellProfile {
  return kind === "q" ? QUEEN_SPELL : MAGE_SPELL;
}

/**
 * How one barrel behaves. Everything scales off the bore: a flintlock pistol is
 * a crack and a puff of smoke, a musket puts a man down, and a field gun
 * rearranges the square it is laid on.
 */
interface GunProfile {
  /** Degrees of lens punch-in held over the beat. */
  zoom: number;
  /** Held breath between levelling the barrel and firing. */
  aim: number;
  /** Which recorded barrel this rank fires (see `GUN_AUDIO_URLS`). */
  voice: GunVoice;
  /**
   * Lock time: seconds from the trigger breaking to the main charge lighting.
   *
   * Real, and audible. A flintlock takes 40-70ms to get from the sear releasing
   * to the ball moving — sear, flint on frizzen, pan flash, then the barrel — and
   * a field gun touched off at the vent takes longer still. The engine plays the
   * mechanical half of the shot this far ahead of the report so the ear can hear
   * the trigger being pulled and then hear the gun answer it.
   */
  lock: number;
  /**
   * How long the firing drill is allowed to take, in seconds, and the fraction
   * of it at which the ball leaves the muzzle.
   *
   * Firearm clips are drills, not swings: the arm comes up, the barrel is
   * levelled, the head goes down to the sights and only then does the hammer
   * fall. Played at a swordsman's length the whole thing is over in a third of a
   * second and the shot looks like a flash appearing out of a stance — which is
   * exactly what it used to look like. Each barrel therefore names its own
   * readable length and its own moment of ignition.
   */
  drill: { seconds: number; impact: number };
  /** 0 = pistol lock, 0.5 = musket, 1 = field gun — drives the whole mix. */
  calibre: number;
  /**
   * Width of the muzzle flash, as a multiple of the round's *rendered* diameter
   * (`ball` × the ammunition's `gauge`) rather than as an absolute size.
   *
   * This has to be a ratio, not a number of world units. The rounds are drawn at
   * a legible gauge — 1.7–2.6× the true bore — and when the flash was authored
   * independently the two drifted apart: a sculpted Minié bullet came out of a
   * flame barely three ball-widths across, so the projectile out-shone the charge
   * that launched it. Tie the flame to the same number that sizes the ball and a
   * bigger round always gets a bigger flash, for free.
   *
   * Real black powder vents roughly 4–8 bore diameters of flame; a clean-burning
   * rifled barrel sits at the bottom of that range and a field gun at the top.
   */
  flare: number;
  /**
   * Which round is rammed down this barrel (see `scene/ammunition.ts`). It
   * decides the shape of the thing that crosses the board, whether it flies a
   * true line or wanders, and whether it arrives cold or still glowing.
   */
  ammo: AmmoKind;
  /** Diameter of the bore in world units — the round is scaled off it. */
  ball: number;
  /**
   * Seconds the ball spends crossing one tile.
   *
   * Nothing here is muzzle velocity: a real ball crosses eight squares of this
   * hall in about a hundredth of a second, which is one frame, which is why the
   * shot could not be seen at all. These are film speeds — slow enough to pick
   * the round up as it leaves the bore and follow it into the body, fast enough
   * that it still reads as shot rather than as a thrown stone. The order between
   * barrels is kept true: rifled fastest, field gun slowest.
   */
  speed: number;
  /** Puffs in the bank of smoke left hanging in front of the barrel. */
  smoke: number;
  /**
   * Colour of the powder smoke, or null to take the faction's livery tint. A
   * rifled barrel fires a small, tight-patched charge that burns almost
   * completely, so its smoke is pale ash grey where a smoothbore's is soot.
   */
  smokeTint: number | null;
  /** How thick the bank reads. 1 = a musket volley; below that it is sheer. */
  smokeDensity: number;
  /** Fine-grain powder: paler, threadier puffs that lift and tear apart fast. */
  fineSmoke: boolean;
  /**
   * Seconds from the hammer falling to the last thread of the bank dissolving.
   *
   * Powder smoke is the slowest thing a gun produces — the flash is three frames
   * and the ball is half a second, but the cloud is still drifting over the
   * square long after both. This used to be derived from the calibre and then
   * *shortened* for a rifled barrel, which had the marksman's shot clearing the
   * air almost before the body fell. It is now stated per barrel, and every one
   * of them outlives its own shot.
   */
  smokeHang: number;
  /**
   * Seconds the bore keeps trickling smoke after the shot, and how many wisps
   * come out of it. Unlike the bank — which is made once and left hanging in
   * the air where it was fired — this is emitted at the *live* muzzle, so it
   * follows the barrel as the man lowers his weapon. 0 for none.
   */
  boreSmoke: { seconds: number; wisps: number };
  /** Scales the hit at the far end: flash, sparks, tile strike and shake. */
  blast: number;
  /** How far the body is thrown back by the shot, in tiles. */
  kick: number;
  /** How far a towed gun rolls back on its wheels, in figure heights. */
  recoil: number;
  /** Wave rolled out across the stone where the shot lands; null for none. */
  wave: { radius: number; color: number } | null;
  /** Hitstop on the frame the ball arrives. */
  hold: number;
  /** Second tremor a beat after the shot; 0 leaves the hall still. */
  aftershock: number;
  /**
   * Whether the shot is taken standing or from one knee, and — for a kneeling
   * gunner — how long the drop onto the stone takes.
   *
   * This is not decoration: it decides *which pose the gun is fired from*. A
   * standing gunner plays his firing drill, because every one of those clips
   * starts and ends on its feet, so the drill agrees with the stance around it.
   * A kneeling gunner has no such clip — the generator's kneeling-looking take
   * measures as a stand-crouch-stand cycle whose ignition frame lands with the
   * man upright (see the marksman's note in `assets/generated.ts`) — so he holds
   * his kneeling aim through the trigger, the report and the recoil, reloads
   * still on the knee, and only rises once the body is cleared. One stance per
   * shot: nobody bobs up and down mid-kill.
   */
  stance: { kneel: false } | { kneel: true; drop: number };
}

/**
 * The barrels of the Grande Armée, in order of what they are worth.
 *
 * The pistol is deliberately the quietest kill on the board — the Emperor does
 * not need spectacle — and the field gun is by far the loudest thing in the
 * hall, louder even than the crown's judgement.
 */
const GUNS: Record<PieceKind, GunProfile> = {
  // Officer's flintlock: raised, fired, done. No smoke bank worth the name.
  k: {
    zoom: 7,
    aim: 0.34,
    voice: "pistol",
    // A well-tuned duelling lock: the fastest ignition in the hall.
    lock: 0.042,
    // A quick draw is meant to be quick, but the pistol still has to be seen to
    // come up and be pointed before it goes off.
    drill: { seconds: 1.15, impact: 0.5 },
    calibre: 0.06,
    flare: 4.4,
    ammo: "pistolBall",
    ball: 0.055,
    speed: 0.1,
    smoke: 5,
    smokeTint: null,
    smokeDensity: 0.85,
    fineSmoke: false,
    smokeHang: 1.7,
    boreSmoke: { seconds: 0.7, wisps: 3 },
    blast: 1.1,
    kick: 0.05,
    recoil: 0,
    wave: null,
    hold: 0.06,
    aftershock: 0,
    // Settled where he stands: the Emperor does not kneel to shoot a man.
    stance: { kneel: false },
  },
  // Charleville musket: shouldered, a hard crack and a bank of white smoke.
  p: {
    zoom: 5.5,
    aim: 0.3,
    voice: "musket",
    // A service musket lock, coarse-primed: slower than an officer's pistol.
    lock: 0.058,
    // Musket off the shoulder, levelled, fired: the report lands past halfway.
    drill: { seconds: 1.3, impact: 0.56 },
    calibre: 0.44,
    flare: 4.7,
    // .69 of soft lead — the fattest small-arms round on the board, and the one
    // that bellies furthest off the line of sight.
    ammo: "musketBall",
    ball: 0.078,
    speed: 0.108,
    smoke: 8,
    smokeTint: null,
    smokeDensity: 1,
    fineSmoke: false,
    smokeHang: 2.5,
    boreSmoke: { seconds: 1, wisps: 4 },
    blast: 1,
    kick: 0.07,
    recoil: 0,
    wave: null,
    hold: 0.05,
    aftershock: 0,
    // The line fires standing, shoulder to shoulder — that is what a line is.
    stance: { kneel: false },
  },
  // Field gun: the crew stands clear, the piece rolls back and the stone rings.
  r: {
    zoom: 10,
    aim: 0.42,
    voice: "cannon",
    // Not a lock at all: a portfire brought down to the vent, the priming taking,
    // then the charge. By far the longest wait between the order and the boom.
    lock: 0.12,
    // The crew steps in to the trail and leans on the lanyard — unhurried.
    drill: { seconds: 1.25, impact: 0.52 },
    calibre: 1,
    // The heaviest charge in the hall, and the widest sheet of flame with it.
    flare: 6,
    // Solid iron, straight out of the sand mould and still hot from the bore.
    ammo: "roundShot",
    // The one round on the board heavy enough to watch travel on its own merits.
    ball: 0.17,
    speed: 0.125,
    smoke: 14,
    smokeTint: null,
    smokeDensity: 1.15,
    fineSmoke: false,
    smokeHang: 3.8,
    boreSmoke: { seconds: 1.6, wisps: 6 },
    blast: 2.1,
    kick: 0.04,
    recoil: 0.19,
    wave: { radius: 3.6, color: 0xffb271 },
    hold: 0.12,
    aftershock: 0.32,
    // The crew serves the piece on its feet; only the reload goes to a knee.
    stance: { kneel: false },
  },
  // Rifled long arm, fired from one knee: the longest held breath on the board
  // and the flattest, fastest ball. Less flame and less smoke than the line's
  // musket — a marksman is a single clean crack, not a volley. Its charge is
  // small and tightly patched, so it burns clean: the bank off this barrel is
  // pale ash grey, sheer enough to see the target through, and gone in a beat.
  b: {
    // Framed like every other shot in the hall. This used to be the hardest
    // punch-in on the board, paced to a full-screen sight picture that closed
    // over the interface; both are gone. The kill is now watched from the same
    // distance as the line infantry's volley — the man kneeling in frame is the
    // thing to look at, not a lens effect wrapped around him.
    zoom: 5.5,
    // The held breath *after* he is down and before the trigger — the drop onto
    // the knee is now a beat of its own (see `stance.drop`), so this no longer
    // has to cover it.
    aim: 0.55,
    voice: "rifle",
    // A marksman's piece, hand-fitted and finely primed — a fast lock, because a
    // slow one throws the shot off at the range he is expected to hit at.
    lock: 0.038,
    // Still the longest wait on the board between the barrel coming up and the
    // hammer falling. No clip is retimed by these numbers any more — the kneeling
    // shot is fired out of a held aim rather than out of a drill (see `stance`) —
    // so they are now purely the *beat*: 1.02s of held sights before the shot.
    drill: { seconds: 1.7, impact: 0.6 },
    calibre: 0.5,
    // A small, tightly patched charge burning almost completely: the least flame
    // of any barrel on the board, in keeping with its pale ash smoke.
    flare: 4.9,
    // The only round in the army with rifling behind it: conical, spun hard,
    // and dead straight where every ball on the board wanders.
    ammo: "minieBullet",
    ball: 0.05,
    // Flattest and fastest thing fired in the hall, as rifling should be.
    speed: 0.082,
    // The marksman's signature. A rifled charge makes far less smoke than the
    // line's musket, so the answer is never to make it *thicker* — it is to make
    // more of it, thinner, and let it stand in the air long enough to watch it
    // come apart. Pale ash grey, sheer enough to read the board through, and the
    // bore goes on smoking in his hands for a beat and a half after the crack.
    smoke: 12,
    smokeTint: 0xdfe4ea,
    smokeDensity: 0.74,
    fineSmoke: true,
    smokeHang: 3.2,
    boreSmoke: { seconds: 1.5, wisps: 6 },
    blast: 1.2,
    kick: 0.06,
    recoil: 0,
    wave: null,
    hold: 0.08,
    aftershock: 0,
    // The one man on the board who fights off the stone. 0.85s is what going
    // down on a knee under arms actually takes — the rise clip run backwards
    // covers it, so the knee plants instead of the body sinking.
    stance: { kneel: true, drop: 0.85 },
  },
  // The commander's flintlock: the Emperor's own weapon, held a beat longer.
  // She takes the shot standing at full height with the Marengo sword still in
  // her left hand, so the drill is unhurried and the report is a shade fuller
  // than his — an order being carried out, not a duel being won.
  q: {
    zoom: 7.5,
    aim: 0.4,
    voice: "pistol",
    lock: 0.046,
    drill: { seconds: 1.35, impact: 0.54 },
    calibre: 0.12,
    flare: 4.6,
    ammo: "pistolBall",
    ball: 0.058,
    speed: 0.096,
    smoke: 6,
    smokeTint: null,
    smokeDensity: 0.9,
    fineSmoke: false,
    smokeHang: 1.9,
    boreSmoke: { seconds: 0.8, wisps: 3 },
    blast: 1.25,
    kick: 0.055,
    recoil: 0,
    wave: null,
    hold: 0.07,
    aftershock: 0,
    // Standing at full height, sword still in her left hand.
    stance: { kneel: false },
  },
  n: {
    zoom: 6,
    aim: 0.16,
    voice: "musket",
    // A carbine lock, worked from the saddle: quick and a little rough.
    lock: 0.052,
    drill: { seconds: 1.1, impact: 0.5 },
    calibre: 0.4,
    flare: 4.6,
    // A cavalry carbine: the same ball as the line, off a shorter barrel.
    ammo: "musketBall",
    ball: 0.072,
    speed: 0.106,
    smoke: 6,
    smokeTint: null,
    smokeDensity: 1,
    fineSmoke: false,
    smokeHang: 2.1,
    boreSmoke: { seconds: 0.8, wisps: 4 },
    blast: 1,
    kick: 0.06,
    recoil: 0,
    wave: null,
    hold: 0.05,
    aftershock: 0,
    // A cavalryman does not kneel; he barely stops moving.
    stance: { kneel: false },
  },
};

/**
 * How wide the flame off a given barrel is drawn, in world units.
 *
 * The single source of truth for the size of a shot: the round's rendered
 * diameter (bore × the legibility gauge from `ammunition.ts`) times the barrel's
 * own {@link GunProfile.flare}. Everything at the muzzle — the flash, the ember
 * shower, and how far clear of the bore the ball is spawned — is scaled off this
 * one number, so a change to a round's gauge can never leave its flash behind.
 */
function muzzleFlare(gun: GunProfile): number {
  return gun.ball * AMMUNITION[gun.ammo].gauge * gun.flare;
}

/**
 * Spine samples in a round's streak, read off the particle budget.
 *
 * The trail is geometry rebuilt every frame, so its cost is the sample count and
 * nothing else. Even the floor value still draws a readable streak — the shape
 * of the path is carried by a handful of rings; the rest is smoothness on the
 * curve a wandering ball flies.
 */
function trailRings(budget: number): number {
  if (budget >= 60) return 26;
  if (budget >= 34) return 20;
  return 12;
}

/**
 * The hall's own air, in world units per second.
 *
 * Barely a breath — a couple of centimetres a second — but it is what turns a
 * powder bank from a cloud that dims where it was made into one that is *carried
 * off the square*. Every gun on the board shares it, so smoke from both armies
 * drifts the same way and the board reads as one room.
 */
const HALL_DRAFT = new THREE.Vector3(0.075, 0.012, -0.045);

/**
 * A marching distance profile: a short push-off, a long stretch at constant
 * speed, then a brief settle. The stride clock runs at a fixed cadence, so an
 * eased-all-the-way curve (what a sliding piece uses) would leave the feet
 * visibly skating at both ends of the move.
 *
 * @param ramp fraction of the move spent accelerating, and again decelerating
 */
function strideEasing(ramp: number): Easing {
  const r = Math.min(0.4, Math.max(0.02, ramp));
  // Distance covered by the ramp-up + cruise + ramp-down, before normalising.
  const span = 1 - r;
  return (t: number): number => {
    if (t <= r) return t * t * 0.5 / r / span;
    if (t >= 1 - r) {
      const rest = 1 - t;
      return (span - rest * rest * 0.5 / r) / span;
    }
    return (t - r * 0.5) / span;
  };
}

/**
 * Owns every three.js object. The chess core drives it through events and the
 * animator hook; React only calls the small imperative API at the bottom.
 */
/** A rigged figure's hips bone and how it lies in its bind pose (for the promotion picker's facing): null for a still model. */
function promotionHips(visual: THREE.Object3D): { bone: THREE.Object3D; rest: THREE.Matrix4; mesh: THREE.SkinnedMesh } | null {
  let found: { bone: THREE.Object3D; rest: THREE.Matrix4; mesh: THREE.SkinnedMesh } | null = null;
  visual.traverse((node) => {
    const mesh = node as THREE.SkinnedMesh;
    if (found || !mesh.isSkinnedMesh || !mesh.skeleton) return;
    const index = mesh.skeleton.bones.findIndex((bone) => /hips|pelvis/i.test(bone.name));
    if (index < 0) return;
    // The bone's bind pose in the mesh's own space: what the clip turns it away from.
    const rest = new THREE.Matrix4().copy(mesh.bindMatrixInverse).multiply(new THREE.Matrix4().copy(mesh.skeleton.boneInverses[index]!).invert());
    found = { bone: mesh.skeleton.bones[index]!, rest, mesh };
  });
  return found;
}

const hipsScratch = { a: new THREE.Matrix4(), q: new THREE.Quaternion(), v: new THREE.Vector3(), s: new THREE.Vector3(), f: new THREE.Vector3() };
/** The heading (radians about the vertical) of a bone axis in a world matrix: its local Z, or its local X where Z stands up. */
function boneHeading(matrix: THREE.Matrix4, axis: "z" | "x"): number {
  const { q, v, s, f } = hipsScratch;
  matrix.decompose(v, q, s);
  f.set(axis === "x" ? 1 : 0, 0, axis === "z" ? 1 : 0).applyQuaternion(q);
  return Math.atan2(f.x, f.z);
}
/** How far (radians, about the vertical) a clip has turned a figure's hips from their bind pose, as the world sees it. */
function hipsTurn(hips: { bone: THREE.Object3D; rest: THREE.Matrix4; mesh: THREE.SkinnedMesh }): number {
  // Both read as the figure stands now: the slot may have been turned since either was last drawn.
  hips.bone.updateWorldMatrix(true, false);
  hips.mesh.updateWorldMatrix(true, false);
  const restWorld = hipsScratch.a.multiplyMatrices(hips.mesh.matrixWorld, hips.rest);
  // Read along whichever bone axis lies flattest in the bind pose (a hips bone's own up is often its local Y or Z).
  restWorld.decompose(hipsScratch.v, hipsScratch.q, hipsScratch.s);
  const z = hipsScratch.f.set(0, 0, 1).applyQuaternion(hipsScratch.q);
  const axis: "z" | "x" = Math.abs(z.y) < 0.7 ? "z" : "x";
  const rest = boneHeading(restWorld, axis);
  const now = boneHeading(hips.bone.matrixWorld, axis);
  return Math.atan2(Math.sin(now - rest), Math.cos(now - rest));
}

export class SceneEngine {
  /**
   * The arena's look pipeline (main game/src/play/battlefield-look.ts), when it draws the frame. `exposure` is what
   * it shows the frame at: it turns the renderer's tone mapping off, draws the scene untoned and grades it at that.
   */
  private battlefieldRenderer: { render(delta: number): void; resize(): void; dispose(): void; exposure(): number; setBrightness(value: number): void; setResolutionScale(scale: number): void; setQuality(quality: 'auto' | 'low' | 'medium' | 'high'): void; compile?(object: THREE.Object3D): Promise<unknown>; disturb?: AirSink; setMoment?(grade: MomentGrade): void } | null = null;
  getBattlefieldContext() { return { renderer: this.renderer, scene: this.scene, camera: this.camera, host: this.canvas.parentElement! }; }
  setBattlefieldRenderer(pipeline: NonNullable<SceneEngine['battlefieldRenderer']>) {
    this.battlefieldRenderer?.dispose(); this.battlefieldRenderer = pipeline;
    this.postfx.setPreset('low');
    // The match's arena is set under its loading screen: fetch and compile the death physics (Jolt, ~3 MB of
    // WebAssembly) now, where the physics deaths are wanted, rather than on the first death that asks for it.
    if (!this.menuPresentation && !this.attract && ragdollWanted(this.goreIntensity, this.reducedMotion)) this.deathPhysics?.preload();
    // ...and build what the match first shows mid-game, as this pipeline draws it (see warmEffects). In development,
    // `?warm=0` leaves it out, for measuring what it saves.
    const measuring = (import.meta as { env?: { DEV?: boolean } }).env?.DEV && typeof location !== "undefined" && new URLSearchParams(location.search).get("warm") === "0";
    if (pipeline.compile && !this.menuPresentation && !this.attract && !measuring) this.effectsWarm = this.warmEffects(pipeline.compile);
  }

  /** What a match first shows mid-game, being built under its loading screen: see {@link warmEffects}. */
  private effectsWarm: Promise<void> = Promise.resolve();
  /** Held, never drawn, so the programs of passing effects (sparks, flashes, rings) are kept between captures. */
  private readonly programKeepers: THREE.Material[] = [];
  /** Resolves once the match's effects are built (see warmEffects), or after `limit` ms: the loading screen waits on it. */
  effectsReady(limit = 15000): Promise<void> {
    return Promise.race([this.effectsWarm, new Promise<void>(resolve => setTimeout(resolve, limit))]);
  }

  /**
   * Under the loading screen, once the arena has set the renderer up: builds the programs of what a match first shows
   * mid-game, as the arena draws them (`compile`: into its own target, with its lights and shadow type), on the
   * driver's worker threads, and puts the flipbook atlases on the GPU. Built on the frame each first appeared, the
   * blood stains froze the first kill for three to six seconds (a lit material, and the arena has many lights: on
   * ANGLE one such program takes seconds to build); the droplets, the wound marks, the dust, the trails and the atlases
   * were stalls of a tenth of a second to one through the first fight. Warmed: the gore, the effects (sparks, contact
   * flashes, weapon trails), every flipbook layer the captures use, the burns, the rituals that take the fallen, the
   * spell stage, a fatality's layers, and keepers for the effects that make and free a material each time (effects.ts
   * sparks, flashes and smoke, strikes.ts slashes, waves, claims and pillars: a freed material frees its program, and
   * the next one built it again).
   */
  private warmEffects(build: (object: THREE.Object3D) => Promise<unknown>): Promise<void> {
    // Built, then finished: the driver asked after each program as its first draw would (see finishPrograms). Only
    // built, the first kill still waited on its programs' link on SwiftShader (no KHR_parallel_shader_compile).
    const compile = (object: THREE.Object3D): Promise<unknown> => {
      const materials = materialsOf(object);
      return build(object).then(() => { if (!this.disposed) finishPrograms(this.renderer, materials); });
    };
    // three.js r185 draws a PCFSoftShadowMap as PCF from the first shadow render on; a program built before it would be
    // keyed for basic shadows and never used. Set as it will be drawn, so what is built here is what the match draws.
    if (this.renderer.shadowMap.type === THREE.PCFSoftShadowMap) this.renderer.shadowMap.type = THREE.PCFShadowMap;
    const vfx = this.vfx;
    const atlases = vfx?.prepare(CAPTURE_VFX) ?? Promise.resolve([]);
    const built: Promise<unknown>[] = [];
    if (this.gore) built.push(this.gore.warm(compile));
    for (const root of [this.effects.group, vfx?.group, this.scorch?.object, this.claiming.object, this.spells?.object, this.fatality?.root, this.fluid?.object]) {
      if (root) built.push(compile(root));
    }
    // The keepers: one of each kind of throwaway material, with what decides its program (a map, blending, sides, and
    // the geometry's normals: a burst's points have none, a ring's plane has them).
    const map = new THREE.DataTexture(new Uint8Array(4), 1, 1);
    const keepers = new THREE.Group();
    const spark = new THREE.PointsMaterial({ map, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    const sprite = new THREE.SpriteMaterial({ map, transparent: true, depthWrite: false });
    const ring = new THREE.MeshBasicMaterial({ map, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    const points = new THREE.BufferGeometry().setAttribute("position", new THREE.BufferAttribute(new Float32Array(3), 3));
    const plane = new THREE.PlaneGeometry(1, 1);
    keepers.add(new THREE.Points(points, spark), new THREE.Sprite(sprite), new THREE.Mesh(plane, ring));
    this.programKeepers.push(spark, sprite, ring);
    built.push(compile(keepers));
    points.dispose(); plane.dispose();
    // The atlases go up one a frame (each is a 2048-wide image decoded on upload), drawn first otherwise mid-fight.
    const uploaded = atlases.then(async (textures) => {
      for (const texture of textures) {
        if (this.disposed) return;
        this.renderer.initTexture(texture);
        await new Promise(resolve => requestAnimationFrame(resolve));
      }
    });
    return Promise.all([...built, uploaded]).then(() => undefined, (error) => { console.warn("[scene] effects not warmed; they build when first shown", error); });
  }
  setBattlefieldQuality(quality: 'auto' | 'low' | 'medium' | 'high') { this.battlefieldRenderer?.setQuality(quality); }
  private renderer: THREE.WebGLRenderer;
  private renderScale: number | null = null;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  /**
   * The procedural world: the hall, the siege beyond it and the Sun Temple's rainforest. Built when the engine first
   * runs without an arena of its own ({@link stageWorld}), never where a baked arena is staged (the match, the
   * showcase), and freed when one arrives (A-29): hidden, it used to be built, updated every frame and kept.
   */
  private hall: CastleHall | null = null;
  private battlefield: Battlefield | null = null;
  /** Rainforest dressing — only staged by the Sun Temple map. */
  private jungle: JungleOverlay | null = null;
  private board = new BoardView();
  private effects = new EffectsSystem();
  /** Blood: spray, wounds, stains and pools (docs/play/GORE_SYSTEM.md). Created with the renderer's first preset. */
  private gore: GoreSystem | null = null;
  private goreIntensity: GoreIntensity = "cinematic";
  /**
   * Burn marks: what a spell's burst and the field gun's round leave on the stone (vfx/scorchPlan.ts decides,
   * vfx/scorch.ts draws). They live and die as the blood does: for the match, until Undo or a new game.
   */
  private scorch: ScorchMarks | null = null;
  /** Ragdoll deaths and burst bodies (web/src/scene/death). Null only after dispose. */
  private deathPhysics: DeathPhysics | null = null;
  /**
   * How a captured piece dies (death/deathStyle.ts): what killed each victim, as its cinematic says before the
   * death (a victim nobody spoke for died by steel), and whether the physics deaths (death/physics: ragdoll,
   * exploding body) are there to be asked for.
   */
  private readonly killedBy = new WeakMap<PieceView, DeathCause>();
  private get physicsDeaths(): boolean { return this.deathPhysics?.stats.ready ?? false; }
  /** What kind of kill each victim's is (gore/goreTiers.ts KillMoment), set when its capture begins ({@link recordKill}). */
  private readonly kills = new WeakMap<PieceView, KillMoment>();
  /**
   * How much of each victim's death is shown (gore/goreTiers.ts): the moment of its capture, capped by the settings
   * and scaled by the preset, kept at the capture ({@link recordKill}). Every system that draws gore asks for it
   * through {@link goreShowOf}.
   */
  private readonly goreShows = new WeakMap<PieceView, GoreShow>();
  /**
   * Cinematic fatalities (gore tier 3, fatality/): the directed sequence round a fatal kill's killing blow, its slow
   * motion (the time scale every system's delta is given in {@link frame}), and what it draws. Null only after dispose.
   */
  private fatality: FatalityDirector | null = null;
  /**
   * Cinematic moments (moments/, docs/play/MOMENTS.md): a killing blow's hit-stop (a time scale on every system's delta,
   * as the fatality's slow motion is), its black and white, ripple, fringe and lens kick; a spell's darkness; the dread
   * of a check; the defeat grade. The grade goes to whichever pipeline draws the frame.
   */
  private readonly moments = new MomentDirector();
  /** The fatality's X-ray (fatality/xray.ts): the skeleton through a ghost of the skin, the fracture and the wound channel. */
  private xray: XrayLayer | null = null;
  /**
   * A fatality's fluid blood (fatality/fluid.ts): GPU particles poured from the wound, drawn as one liquid surface,
   * running on its own on the scene's clock until it has landed and run; its stains and pool go to the gore system.
   * Null where the GPU cannot draw it; empty on Low.
   */
  private fluid: FluidBlood | null = null;
  /**
   * The share of a fatality's fluid kept for a stump (fatality/stumpPlan.ts): the victim whose limb is off or may still
   * come off, the capture's ply and seed, the particles kept, the figure's height, the gore plan the marks are filed
   * under, and the board it was kept on. The first stump takes it ({@link pourStump}); a new fatality replaces it.
   */
  private stumpPour: { victim: PieceView; ply: number; seed: number; count: number; height: number; plan: GorePlan; revision: number } | null = null;
  private readonly fluidLit: FluidLight = { direction: new THREE.Vector3(0, 1, 0), colour: new THREE.Color(), ambient: new THREE.Color(), gain: 1 };
  private readonly fatalityShake = new THREE.Vector3();
  /**
   * The fatality's close shot on the wound, while it holds the camera: the shot it cut into, and what that shot was
   * framing (to go back to), or `own` when no shot held the camera and the fatality took one of its own.
   */
  private fatalityShot: { timeline: DuelCameraTimeline; back: CameraPose | null; own: boolean } | null = null;
  /** The burning body and the Minimal fade of a fire kill (death/burn). Created with the renderer's first preset. */
  private burning: BurningBodies | null = null;
  /** Reused by every burn, so laying one allocates nothing. */
  private readonly scorchEvent: ScorchEvent = {
    seed: 0, ply: 0, source: "spell", army: "sun", power: 1, ring: 0, at: { x: 0, z: 0 }, direction: { x: 0, z: 0 }, tile: TILE,
    flags: { quality: "low", reducedMotion: false, tactical: false, menuBoard: false },
  };
  /**
   * Smoke, fire, bursts and dust from the flipbook atlases (docs/play/VFX_LIBRARY.md). One for the scene;
   * what plays where is decided by vfx/wiring.ts. Created with the renderer's first preset.
   */
  private vfx: FlipbookSystem | null = null;
  /**
   * The flourishes of a kill (vfx/flourish): the killing swing's crescent of light, its flakes and chips, a spell's or a
   * summon's sigil, a caster's gathering ribbons. `flourish.timeScale` is the hook a hit-stop sets to hang them.
   */
  private flourish: CombatFlourish | null = null;
  /** The Knight's vault's ink, light, flakes and ring (finisher/knightVaultVfx.ts). */
  private vaultFx: KnightVaultEffects | null = null;
  /**
   * The plain cinematic's killing swing being traced for its light arc, from its strike until meleeContact draws it as
   * the blow lands; the sprite crescent is not drawn over it. Null when there is none (no weapon, no flourishes).
   */
  private meleeArc: string | null = null;
  private readonly flourishAt = new THREE.Vector3();
  /** Reused by every flipbook spawn, so a spawn allocates nothing. */
  private readonly vfxAt = new THREE.Vector3();
  private readonly vfxOptions: VfxPlayOptions = {};
  private readonly vfxFlags: VfxFlags = { quality: "low", reducedMotion: false, tactical: false, menuBoard: false };
  private readonly vfxDetail: VfxDetail = {};
  /** The defender of the directed duel on stage: step dust keeps clear of the sight line to its torso. */
  private vfxDuelVictim: PieceView | null = null;
  private readonly vfxContact = new THREE.Vector3();
  private readonly vfxPoint = new THREE.Vector3();
  /** Where a boot came down, for its dust and for the arena's air (footfall). */
  private readonly airFoot = new THREE.Vector3();
  /** Pieces of burst bodies that have reached the stone on this board: each one's dust has its own seed. */
  private landingDusts = 0;
  private readonly vfxTint = new THREE.Color();
  private readonly vfxColour = new THREE.Color();
  /** The figure whose killing blow has just sprayed blood, until its fight is over. */
  private bleeding: PieceView | null = null;
  /** Each army taking the field in its own kingdom's manner during the match opening (see {@link MusterEffects}). */
  private readonly musterEffects = new MusterEffects();
  /** Red light over whichever king is in check (see {@link CheckAlarm}). */
  private alarm = new CheckAlarm();
  /**
   * The only point lights sorcery is ever allowed to use. They are added to the
   * scene once and reused, because every change to the scene's light count makes
   * three.js recompile every material in the hall — the sorceress' three-bolt
   * volley used to do that eight times in a second and hang the tab.
   */
  private spellLights: SpellLightPool;
  private shake = new ShakeSystem();
  private tweens = new TweenManager();
  private readonly combatDirector = new PairedCombatDirector();
  /** The Combat Director fight on stage, if any: cancel and skip reach it here. */
  private combatControl: CombatControl | null = null;
  /** Frame time is multiplied by this while a skipped fight plays out what is left of it. */
  private combatHurry = 1;
  /** True once the fight on stage has landed its killing blow. */
  private combatKilled = false;
  /** Hit-stop, the struck body's shudder, the camera kick and weapon trails (combat/feel.ts, combat/feelLayer.ts). */
  private readonly combatFeel = new CombatFeel({
    effects: this.effects, shake: this.shake, group: this.effects.group,
    lowDetail: () => this.preset === "low", reducedMotion: () => this.reducedMotion,
    // The fights' weapon trails are the killing swing's light arcs (vfx/flourish, from the weapon sockets); the feel layer
    // adds the rest.
    trails: false,
  });
  /** Set when a duel shot handed the view straight to the next player's side: the turn swing is then not owed. */
  private duelHandover = false;
  /** Bodies still leaving the board after their killer has taken the square. */
  private readonly clearing = new Map<PieceView, Promise<void>>();
  /** The close-in shot of a directed duel, from its first frame until the player's view is back. */
  private duelCamera: {
    timeline: DuelCameraTimeline;
    /** `conclusionCameraRevision` when the shot took the camera: any newer camera owner ends it. */
    revision: number;
    /** `lensFov` when the shot was planned. */
    lens: number;
    /** The lens the shot is asking for this frame, before the fight's own punch. */
    fov: number;
    /** The fight's lens punch in degrees, added on top. */
    punch: () => number;
    /** True when the shot watches a claim (see {@link watchClaim}): the fight that came before it does not release it. */
    rite?: true;
  } | null = null;
  /** The rituals that take the fallen (vfx/mystic/claiming.ts): every body leaves the board through one. */
  private readonly claiming = new Claiming();
  /** A body whose fight kept its shot on it, for the claim's shot to take over from (see the fight's `claim`). */
  private claimShotOwed: PieceView | null = null;
  /** The Queen's summon now on the board (rites/rite.ts), the piece it is killing, and what it last said. One at a time. */
  private rite: {
    effect: RiteEffect; victim: PieceView; state: RiteState | null; light: ReturnType<SpellLightPool["acquire"]>; asked: boolean;
    struck: (landed: boolean) => void; released: () => void; done: () => void; wasStruck: boolean; wasReleased: boolean;
    /** Figures of the Queen's army lent to it (RiteCast.muster), animated here and freed with it. */
    troops: PieceView[];
    /** Its shot, while it holds the camera, and the beat that shot is on. */
    camera: DuelCameraTimeline | null; shot: number;
    /** Whether the piece goes limp in the rite's grip (`held`) rather than dying by a death of its own. */
    carried: boolean;
    /** The killer, and the gore system's impacts the rite's wounds opened: their pools are laid where the body comes to rest. */
    attacker: PieceView; impacts: string[];
    /** What its tearings may take off (death/sever/severPlan.ts), decided when it was called, and how many limbs they have. */
    sever: SeverRule; severed: number;
    /** The first wound it opened, where it was and the way its blood went: where a fatality holds the blow. */
    opened: { at: THREE.Vector3; direction: THREE.Vector3 } | null;
  } | null = null;
  /** A death decided for a victim by something other than its killer's weapon: a summon's (death/deathStyle.ts riteDeathStyle). */
  private readonly forcedDeath = new WeakMap<PieceView, DeathStyle>();
  /** The library spells now in the air (vfx/spells/stage.ts). The spell each kingdom cast last is read from the history (drawSpell). */
  private spells: SpellStage | null = null;
  private releaseGameEvents: (() => void)[] = [];
  private readonly boardReactions = new BoardReactionDirector("medium", TILE);
  private reactionStateKey = "";
  /** The battle's memory, read from the move list: what each moment means, and the army's morale (battleBonds.ts). */
  private readonly battleBonds = new BattleBonds();
  private readonly conclusion = new CheckmatePresentation();
  /** A checkmate, resignation or time loss: the beaten army's collapse and its King's yielding (scene/downfall). */
  // The downfall's sounds go to the match's one mixer, each at the frame it happens, panned from where it happens
  // (none from the menu's background game, or from a replay's ending staged without sound).
  private downfallHeard = true;
  private readonly downfall = new DownfallStage(this.scene, {
    // Each choice the mixer makes for them (which take, its pitch, which line) is drawn from the match's own seed, as
    // the spoken lines are (voiced), so a replay's ending sounds as the game's did.
    drop: (kind, { salt, pan, volume }) => {
      if (!this.downfallHeard || this.silentBoard()) return;
      this.downfallTrace(`drop ${kind} ${salt}`);
      this.voiced(`downfall ${salt}`, () => audio.weaponDrop(kind, { pan, volume }));
    },
    kneel: ({ salt, pan, volume }) => {
      if (!this.downfallHeard || this.silentBoard()) return;
      this.downfallTrace(salt);
      this.voiced(`downfall ${salt}`, () => audio.kneel({ pan, volume }));
    },
    armyLine: (side, event, options) => {
      if (!this.downfallHeard || this.silentBoard()) return null;
      const kingdom = audio.kingdomOf(side), voice = `${kingdom}_${options.voice}`;
      // A voice that has no line for this ends the army's line with another of its voices rather than silence.
      const own = gambitSound.downfallClips(kingdom, event).some(id => id.startsWith(`${voice}_`));
      const length = this.voiced(`downfall ${options.salt}`, () => audio.armyLine(side, event, { pan: options.pan, ...(own ? { voice } : {}) }));
      if (length !== null) this.downfallTrace(`${options.salt} ${side} ${options.voice}`);
      return length;
    },
    pan: (x, z) => this.stereoPan(new THREE.Vector3(x, 0.5, z)),
  });
  /** The performance before the first move, while it holds the camera (playMatchOpening). */
  private matchOpening: { timeline: MatchOpeningTimeline; shot: number; onShot?: (index: number) => void; reveal: Map<PieceView, number>; resolve(completed: boolean): void; clock: number; held: boolean;
    /** While held: the moments its camera visits in turn (each shot's start, middle and end), the next, and how many
     * full rounds it has made. */
    warm: { moments: number[]; next: number; rounds: number } } | null = null;
  private conclusionCameraRevision = 0;
  private conclusionViewActive = false;
  private factory = new PieceFactory();
  private postfx: PostFX;

  private pieces = new Map<SquareId, PieceView>();
  private captured: PieceView[] = [];
  /**
   * The captures played in this game, oldest first: the ply that made each and the piece it took. An Undo that
   * takes one back returns its piece by the Claiming run backwards ({@link returnTaken}).
   */
  private taken: { ply: number; square: SquareId; kind: PieceKind; color: Faction }[] = [];
  /** The shot a spell from the library has taken, while it holds the camera. */
  private spellCamera: DuelCameraTimeline | null = null;
  /**
   * Whether the spell's shot opened over the caster's shoulder (rites/spellShot.ts): it moves on to the piece as the
   * spell leaves the hand, to see it arrive, not once the blow has landed.
   */
  private spellShoulder = false;
  /**
   * The shot a duel, a spell or a summon has taken: no rank crest floats in it, from the moment it takes the camera
   * until it is home again or a newer shot that took the camera from it has come in (closeShotHolds). A duel's too: as
   * its camera dived in, the two fighters' crests hung large in the frame until they left the top of it (the hit
   * effects agent's duel film, 0.6 s).
   */
  private castShot: DuelCameraTimeline | null = null;
  /** A fatality's or a sever's own close shot on its way home: still close until it is back (closeShotHolds). */
  private closeShotGoingHome: DuelCameraTimeline | null = null;
  /** How far the shot now held is turned off the player's side (rites/riteShot.ts shotTurn), for its later beats. */
  private shotTurnNow = 0;
  /** Bodies a spell has run through and holds up (vfx/spells/spell.ts `pierce`): the spell, and the wounds it opened. */
  private readonly pierced = new Map<PieceView, { flight: SpellFlight; impacts: string[] }>();
  /** Pieces an Undo is returning now, and the ritual returning each. */
  private readonly returning = new Map<PieceView, ClaimHandle>();
  /**
   * Figures mid-move. They are removed from `pieces` for the duration of the
   * animation, so without this set their mixers would never be ticked and the
   * strike / death clips would sit frozen on their first frame.
   */
  private motion = new Set<PieceView>();
  /**
   * Bumped every time the board is rebuilt from the chess core (quality change,
   * undo, new game). A move animation that was already running is holding views
   * that no longer exist, so it checks this after every await and bails out
   * instead of putting a dead figure back on a square — an orphan left standing
   * in the hall was the ghost model seen after an automatic graphics downgrade.
   */
  private boardRevision = 0;
  /** The piece now begging under its killer, cut off when the blow lands. */
  private livePlea: PleaHandle | null = null;
  /** Bodies that have already cried out (see {@link lastCry}). */
  private readonly cried = new WeakSet<PieceView>();
  /** The pieces' own voices: what they say about what happens to them, the hand that moves them, their gear. */
  private readonly voices = new BoardVoices({
    silent: () => this.silentBoard(),
    snapshot: () => this.controller.getSnapshot(),
    pieceAt: (square) => this.pieces.get(square),
    pieces: () => this.pieces.entries(),
    pan: (position) => this.stereoPan(position),
    onScreen: (position) => { const at = position.clone().project(this.camera); return at.z < 1 && Math.abs(at.x) <= 1.05 && Math.abs(at.y) <= 1.05; },
    kingdom: (side) => this.factory.getSkins()[side],
    // The match record keeps each line that sounded; a replay says exactly what its record kept (shared/play/replay-show.ts).
    spoke: (line) => this.controller.annotate(encodeVoiceLine(line)),
    recorded: (ply) => this.controller.getSnapshot().replay ? voiceLinesFromComment(this.controller.getReplayComment(ply)) : null,
  });
  /** Move animations currently in flight. */
  private movesInFlight = 0;
  /** A rebuild waiting for the board to go quiet (see {@link setQuality}). */
  private rebuildPending = false;
  /** Armies the player has asked for, applied by {@link syncArmies}. */
  private wantedSkins: Record<Faction, ArmySkinId> | null = null;
  /** True while the sculpts are being swapped, so requests queue instead of racing. */
  private swappingArmies = false;
  private promotionGroup: THREE.Group | null = null;
  private promotionViews: PieceView[] = [];
  /** Each candidate on the picker, for its focus look: its slot, its figure and its own pedestal material. */
  private promotionSlots: { kind: PromotionChoice; slot: THREE.Group; view: PieceView; pedestal: THREE.MeshStandardMaterial; lift: number; turn: number; opacity: number; glow: number; hips: { bone: THREE.Object3D; rest: THREE.Matrix4; mesh: THREE.SkinnedMesh } | null }[] = [];
  /** The candidate the player is about to choose (promotion/promotionChoice.ts); the Queen as the picker opens. */
  private promotionFocus: PromotionChoice = DEFAULT_PROMOTION_FOCUS;
  /** The kingdom colour the focused candidate's pedestal glows in. */
  private promotionGlow = new THREE.Color();
  /** Answers the promotion picker: a piece, or no move at all ("back": the player backed out; "gone": the game moved on under it). */
  private promotionResolve: ((answer: PieceKind | "back" | "gone") => void) | null = null;
  /** Where the picker floats while its close shot holds (promotion/promotionPlan.ts choiceStage); null over the middle of the board. */
  private promotionAnchor: { position: THREE.Vector3; scale: number } | null = null;
  /** The picker's close shot, kept for the move it chooses to carry on into the arrival (see {@link runPromotion}). */
  private promotionShot: { timeline: DuelCameraTimeline; revision: number; facing: { x: number; z: number } } | null = null;
  /** What a promotion sequence has standing in the scene, for a rebuilt board to take down (see {@link endPromotionStage}). */
  private promotionStage: { landing: MysticLanding; light: SpellLight | null } | null = null;
  /** The chosen figure's kingdom sigil and motes as it forms in the column (the match opening's effect, for one figure). */
  private readonly promotionForm = new MusterEffects();
  /** The side the promotion's close shot looks from: the new figure forms facing it. */
  private promotionFacingNow: { x: number; z: number } | null = null;

  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private boardPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

  private selected: SquareId | null = null;
  private hoveredPiece: PieceView | null = null;
  private pointerDownAt: { x: number; y: number; square: SquareId | null } | null = null;
  private legalTargets = new Map<SquareId, boolean>();
  /** With a Pawn in hand that may capture in passing: the square of the Pawn it would take, and where it lands if it does. */
  private passingVictims = new Map<SquareId, SquareId>();
  /**
   * A piece pressed while a move was on stage: it is selected when the board is free (boardInput.ts). Told where to
   * go as well (`to`), it is a queued move: played when the board is free if it is legal then, refused if it is not.
   */
  private heldTap: { square: SquareId; piece: PieceView; to: SquareId | null } | null = null;
  /** Where the held piece may be told to go (heldReach), for the position and the piece it was worked out for. */
  private heldReachCache: { key: string; squares: ReadonlySet<SquareId> } | null = null;
  /** The part of a move that a press may hurry is on stage: a walk with no fight in it, a duel's turn to the next player. */
  private quietStage = false;
  /** How fast that part runs: 1, or WALK_HURRY once it has been asked to hurry (hurryMove). */
  private walkHurry = 1;
  /** The figures walking in it (the piece moved, a castling Rook): their legs keep step with the hurried walk. */
  private readonly hurried = new Set<PieceView>();
  /** A mouse press that picked a piece up, and may be carrying it to its destination. */
  private drag: { from: SquareId; x: number; y: number; moving: boolean } | null = null;
  /** The keyboard's cursor. The pointer moves it too, so the keys go on from where the pointer was. */
  private cursorSquare: SquareId = cursorHome("w");
  /** Hot seat: where each player's keys last left the cursor. */
  private cursorSeats: Record<Faction, SquareId> = { w: cursorHome("w"), b: cursorHome("b") };
  /** The cursor on the board was put there by the keys (or a controller), not by the pointer. */
  private cursorByKeys = false;
  private cursorForward = new THREE.Vector3();
  private previewing = false;

  private lastFrameTime = 0;
  /** Held by the match's pause menu (setHeld): the scene keeps drawing, but its time stands still. */
  private held = false;
  private heldDrawnAt = 0;
  private elapsed = 0;
  private frameId = 0;
  private running = false;
  private disposed = false;
  private frameErrors = 0;
  /** The player's frame-rate cap (Settings, Video); 0 draws at the display rate (A-09). */
  private frameLimit: FrameLimit = 0;
  private lastDrawnAt = 0;
  /** How many times the frame has been sampled for the black-screen check. */
  private darkFrameChecks = 0;
  /** How far the engine has already fallen back (see `escalateFallback`). */
  private fallbackStage = 0;
  /** What this driver is, and what it can do. */
  private gpu: GpuReport;
  /**
   * Safe rendering: no composer, no reflection probe, no shadow maps. Every one
   * of those has been seen to render an all-black hall on Mesa drivers, so this
   * is the switch that always gets a picture up.
   */
  private safeMode = false;
  /** Player-side exposure multiplier, for screens that read too dark. */
  private brightness = 1;
  private openingExposure = 1;
  /** The probe currently lighting the scene, kept so it can be disposed. */
  private environmentMap: THREE.Texture | null = null;
  private bakedWorld: THREE.Group | null = null;
  private bakedViolet = false;
  /**
   * Null until the probe has been tested on this driver, then false forever if
   * the test failed — there is no point rebuilding it on every arena change.
   */
  private environmentUsable: boolean | null = null;
  /** Stands in for the probe's ambient contribution when the probe is off. */
  private ambientFallback: THREE.AmbientLight;

  private preset: QualityPreset;
  private arena: ArenaTheme = DEFAULT_ARENA;
  /** Travels with the camera so the near face of every figure stays readable. */
  private cameraLamp: THREE.DirectionalLight;
  private captureCinematics = true;
  private rotateBoard = true;
  private rankBadges = true;
  /** Whether a close shot has hidden the rank crests (closeShotBadges, closeShotHolds). */
  private badgesHiddenForShot = false;
  private interactive = true;
  private attract = false;
  /** Authored title tableau; never a live or paused match. */
  private menuPresentation = false;
  private reducedMotion = false;
  private campaignBattle = false;
  /** Computer-vs-computer showcase: crisp grade and a chosen camera behaviour. */
  private showcase = false;
  private showcaseCamera: ShowcaseCamera = "follow";
  private showcaseOrbitSpeed = 0.32;
  /** Elapsed time of the last manual camera drag (auto orbit yields to it). */
  private lastManualCameraAt = -999;
  /** The figure the follow camera is tracking, if any. */
  private followPiece: PieceView | null = null;
  /** A fixed point the follow camera holds when no figure is moving. */
  private followPoint: THREE.Vector3 | null = null;
  /** Radius multiplier: a fight pulls the rig in closer than a plain march. */
  private followTightness = 1;
  /** The eased point actually being framed, so a jumping focus never snaps. */
  private followedFocus = new THREE.Vector3(0, 0.45, 0);
  /** Azimuth, elevation and distance the follow camera holds. */
  private followRig = new THREE.Spherical(7.6, 0.92, Math.PI * 0.32);
  private followOffset = new THREE.Spherical();
  private scratchFocus = new THREE.Vector3();
  private scratchLean = new THREE.Vector3();
  private scratchDesired = new THREE.Vector3();
  /** True while the engine itself is moving the camera (never counts as input). */
  private cameraDriven = false;
  /** True while a scripted camera move (intro, dolly, preset) is running. */
  private cameraScripted = false;
  private introPlaying = false;
  private introSkipped = false;
  private orbiting = false;
  /** The turn of the view under way (orbitBy, resetView), for what has to follow it. */
  private orbitRun: Promise<void> | null = null;
  /** That turn is Flip board's own; and a Flip board pressed during another turn waits for it to end. */
  private flipping = false;
  private flipWaiting = false;
  private cameraFlipped = false;
  /** Flat top-down map: sculpts swap for counters and the world is struck. */
  private tactical = false;
  /** The 3D framing to drop back into when the map is folded away. */
  private tacticalReturn: CameraShot | null = null;
  /** Dressing hidden while the map is up, so it can be put back exactly. */
  private struck: THREE.Object3D[] = [];

  /** The surface being drawn into: its shape decides the whole framing. */
  private view: ViewportProfile = AUTHORED_VIEW;
  /** True once the first real framing has been solved for the live viewport. */
  private viewportFitted = false;
  /**
   * The lens the current framing asks for. Battle beats punch in *from* this
   * rather than from a constant, so a phone's wider framing keeps its punch and
   * a mid-fight rotation never restores the wrong lens.
   */
  private lensFov = DEFAULT_FOV;
  /** Distance the current framing settled on — drives the orbit and follow rigs. */
  private fitRadius = 10.5;
  /** The *authored* shot the camera was last sent to, re-solved on every resize. */
  private framedShot: CameraShot = CAMERA_SHOTS.white;
  /** Orbit and tap tolerances for this viewport. */
  private limits: OrbitLimits = orbitLimits(AUTHORED_VIEW, 10.5);

  private fpsSamples: number[] = [];
  private autoAdjusted = false;
  private lastFpsReport = 0;

  constructor(
    private canvas: HTMLCanvasElement,
    private controller: GameController,
    private callbacks: SceneCallbacks,
    preset: QualityPreset,
    arena: ArenaTheme = DEFAULT_ARENA,
  ) {
    this.preset = preset;
    this.arena = arena;
    const look = ARENA_LOOKS[arena];
    const settings = QUALITY_SETTINGS[preset];

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: settings.msaaSamples > 0,
      powerPreference: "high-performance",
      alpha: false,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, settings.maxPixelRatio));
    this.renderer.shadowMap.enabled = settings.shadows;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.gpu = probeGpu(this.renderer);
    console.info(`[scene] gpu: ${describeGpu(this.gpu)}`);
    this.applyExposure(look.exposure * (this.campaignBattle ? 1.08 : 1));

    this.scene.background = new THREE.Color(look.background);
    // Thinner, warmer haze than a sealed hall would use: the siege camps and
    // the armies beyond the broken wall have to read through it.
    this.scene.fog = new THREE.FogExp2(look.fog.color, look.fog.density);

    this.camera = new THREE.PerspectiveCamera(DEFAULT_FOV, 1, 0.1, 260);
    this.camera.position.copy(CAMERA_SHOTS.white.position);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.07;
    // Distances, elevation limits and rotate speed all come from the viewport —
    // see `applyOrbitLimits`, called from the resize handler below.
    this.controls.enablePan = false;
    this.controls.target.copy(CAMERA_SHOTS.white.target);
    this.controls.autoRotateSpeed = 0.45;

    this.scene.add(this.board.group);
    this.board.applyArena(look);
    this.scene.add(this.effects.group);
    this.scene.add(this.claiming.object);
    // Burns lie under the blood: a pool runs over the scorch it crosses.
    this.scorch = new ScorchMarks(this.preset, { top: BOARD_TOP, tile: TILE });
    this.scene.add(this.scorch.object);
    // The renderer paints the wound masks every wounded figure wears (gore/WoundMasks.ts).
    this.gore = new GoreSystem({ quality: this.preset, intensity: this.goreIntensity, board: { top: BOARD_TOP, tile: TILE }, renderer: this.renderer });
    this.scene.add(this.gore.root);
    // Ragdolls and burst bodies. Jolt is fetched in the background once a match is in play; until it lands, deaths fall as they always did.
    this.deathPhysics = new DeathPhysics({
      quality: this.preset, groundY: BOARD_TOP, tile: TILE, gore: this.gore,
      // The pieces of a burst body land on cues the game already has (the gore splat, and the thump of a thrown body
      // for the trunk), behind the same gate as every other gore sound.
      onLanding: (at, trunk) => {
        const gore = captureLayers({ silentBoard: this.silentBoard(), spell: false }).gore;
        if (gore && trunk) audio.bodyFall(.35);
        if (gore) audio.goreSplat({ pan: this.stereoPan(at), volume: trunk ? .7 : .4 });
        this.landingDust(at, trunk);
      },
    });
    this.scene.add(this.deathPhysics.root);
    this.vfx = new FlipbookSystem({ baseUrl: `${(import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? "/"}assets/play/vfx/`, quality: this.preset, groundY: BOARD_TOP });
    this.scene.add(this.vfx.group);
    this.flourish = new CombatFlourish({ quality: this.preset, boardTop: BOARD_TOP });
    this.scene.add(this.flourish.object);
    this.vaultFx = new KnightVaultEffects({ quality: this.preset, boardTop: BOARD_TOP });
    this.scene.add(this.vaultFx.object);
    this.burning = new BurningBodies({
      effects: this.effects, flipbook: () => this.vfx, glow: () => vfxGlow(this.displayExposure()),
      light: (colour, distance) => this.spellLights.acquire(colour, distance), eye: () => this.camera.position,
      particles: () => QUALITY_SETTINGS[this.preset].captureParticles,
    });
    this.scene.add(this.musterEffects.group);
    this.scene.add(this.promotionForm.group);
    this.scene.add(this.alarm.group);
    // Three slots: the gathering fire, the killing bolt and a judgement column
    // can all be alight at once. Anything beyond that goes unlit rather than
    // growing the set. Presets without post-processing stay entirely unlit.
    this.spellLights = new SpellLightPool(this.scene, settings.postFx ? 3 : 0);
    // A library spell borrows one of them for as long as it burns, and shakes the camera only where motion is wanted.
    this.spells = new SpellStage({
      lend: (colour, reach) => this.spellLights.acquire(colour, reach),
      shake: amount => { if (!this.reducedMotion) this.shake.add(amount); },
    });
    this.scene.add(this.spells.object);
    // A fatal kill's directed sequence: it tells the engine its beats (the close shot, the impact, the way back).
    this.xray = new XrayLayer(() => vfxGlow(this.displayExposure()));
    // The fluid runs on its own clock once poured: the director only starts it, on the blow.
    if (FluidBlood.supports(this.renderer)) {
      this.fluid = new FluidBlood(this.renderer, { capacity: goreBudget(3, this.preset).fluid, top: BOARD_TOP, sink: this.gore, light: () => this.fluidLight() });
      this.scene.add(this.fluid.object);
    }
    const pour = { object: new THREE.Group(), begin: (fatality: Fatality) => this.pourFatality(fatality), update: () => undefined, end: () => undefined, dispose: () => undefined };
    this.fatality = new FatalityDirector({ beat: (beat, fatality) => this.fatalityBeat(beat, fatality) }, [this.xray, pour]);
    this.scene.add(this.fatality.root);

    // A soft lamp parented to the camera: whichever way the board is turned,
    // the faces and shields pointing at the player are never in shadow.
    this.cameraLamp = new THREE.DirectionalLight(look.lamp.color, look.lamp.intensity);
    this.cameraLamp.position.set(0, 1.5, 2.5);
    this.camera.add(this.cameraLamp);
    this.camera.add(this.cameraLamp.target);
    this.cameraLamp.target.position.set(0, 0, -1);
    this.scene.add(this.camera);

    // Skylight stand-in: silent while the reflection probe is doing its job,
    // turned up the moment the probe is dropped so nothing goes unlit.
    this.ambientFallback = new THREE.AmbientLight(look.environment.top, 0);
    this.scene.add(this.ambientFallback);
    // The reflection probe is the procedural world's: built with it (stageWorld), not for a baked arena that drops it.

    this.postfx = new PostFX(this.renderer, this.scene, this.camera);
    this.postfx.setGrade(look.grade);
    this.postfx.setBloom(look.bloom);
    this.postfx.setPreset(preset);

    this.bindEvents();
    this.factory.onClip((keys, name, clip) => this.adoptClip(keys, name, clip));
    this.factory.onCombatLibrary((keys, library) => {
      for (const piece of this.allPieces()) if (keys.includes(`${piece.color}${piece.kind}`)) piece.installCombatLibrary(library);
    });
    this.bindGameController();
    this.handleResize();
    // [battle memory] The voices ask who a fallen comrade was to each witness: the memory knows companions the board cannot.
    this.voices.witnessKind = (facts, witness) => this.battleBonds.witnessKind(this.controller.getSnapshot(), facts, witness);
    this.voices.avenged = (facts) => this.battleBonds.avenged(this.controller.getSnapshot(), facts);
  }

  // ---------------------------------------------------------------- lifecycle

  private bindGameController(): void {
    this.unbindGameController();
    this.releaseGameEvents = [
      this.controller.setAnimator(event => this.animateMove(event)),
      this.controller.on("state", snapshot => this.onState(snapshot)),
      this.controller.on("reset", () => {
        this.downfall.reset();
        // A picker left open belongs to the game that is gone (so with Undo and the game's end, below): it used to
        // stand over the new board, and a piece chosen from it then was played there if the move happened to be legal.
        this.promotionResolve?.("gone");
        this.voices.interrupt();
        this.taken = [];
        this.gore?.reset();
        this.fluid?.reset();
        this.scorch?.reset();
        this.deathPhysics?.clear();
        this.rebuildPieces();
        // Audio observes the new snapshot, which is published after reset. So does the keyboard's cursor.
        queueMicrotask(() => { if (!this.disposed) { this.beginGameSound(); this.homeCursor(); } });
      }),
      this.controller.on("rewind", () => {
        this.promotionResolve?.("gone");
        this.voices.interrupt();
        // Undo: the blood of the plies taken back goes with them, before their figures are rebuilt.
        this.gore?.undoTo(this.controller.getSnapshot().sanList.length);
        // ...and a fatality's fluid, with the stains and the pool it left.
        this.fluid?.undoTo(this.controller.getSnapshot().sanList.length);
        // ...and so do their burns.
        this.scorch?.undoTo(this.controller.getSnapshot().sanList.length);
        // ...and any body still falling leaves the physics world, with the pieces of a burst; the figures themselves are rebuilt whole.
        this.deathPhysics?.undoTo(this.controller.getSnapshot().sanList.length);
        // The pieces those plies took come back: the ritual that took each runs backwards over it.
        const plies = this.controller.getSnapshot().sanList.length;
        const returned = this.taken.filter((entry) => entry.ply > plies);
        this.taken = this.taken.filter((entry) => entry.ply <= plies);
        this.rebuildPieces();
        this.returnTaken(returned);
        // The snapshot of the position gone back to is published after the rewind.
        queueMicrotask(() => { if (!this.disposed) this.restoreAfterUndo(this.controller.getSnapshot()); });
      }),
      this.controller.on("replaySeek", ({ ply }) => this.seekReplayBoard(ply)),
      this.controller.on("illegal", ({ from }) => this.rejectMove(from)),
      this.controller.on("move", event => this.voices.moved(event)),
      // The board is free again: the next player finds the cursor where they left it, and a piece they pressed
      // while the move was on stage is picked up, or played if it was told where to go. That waits a moment: the
      // game says what follows the move (its end, the computer's turn) only after this event, and a queued move
      // played from inside it would be made before a draw the last move brought about was declared.
      this.controller.on("settled", (event) => {
        this.voices.settled();
        this.seatCursor();
        queueMicrotask(() => { if (!this.disposed) this.boardSettled(event); });
      }),
      this.controller.on("gameover", () => {
        // Nothing stays in hand over a finished game (a resignation or the clock can end it with a piece picked up),
        // and the promotion picker does not stand over its result.
        this.promotionResolve?.("gone");
        this.dropHeldTap();
        if (this.selected) this.clearSelection();
        if (!this.campaignBattle) void this.playEndCinematic();
      }),
    ];
  }

  private unbindGameController(): void { for (const release of this.releaseGameEvents.splice(0)) release(); }

  async load(options: { warmClips?: boolean } = {}): Promise<void> {
    // Disposed mid-load, the factory calls its downloads off (A-07) and its load fails: nobody is waiting for it then.
    try { await this.factory.load((done, total) => this.callbacks.onLoadProgress(done / total)); } catch (error) { if (this.disposed) return; throw error; }
    if (this.disposed) return;
    this.rebuildPieces();
    this.callbacks.onReady();
    this.preloadVfx();
    // The magazine, fetched behind the game: one sculpt per round in the army's
    // barrels, a couple of thousand triangles each, and none of them needed until
    // somebody pulls a trigger. Until a sculpt lands the round is turned
    // procedurally instead (`scene/ammunition.ts`), so the first shot of a game is
    // never a blank.
    for (const source of SHOT_MODELS) void primeShotModel(source);
    // The rigs and their stances are in; the strikes, deaths and strides come
    // down behind the game so the first move never waits on seventy GLBs.
    if (options.warmClips !== false) this.warmAnimations();
  }

  /** Start background combat-clip downloads after the selected world is ready. */
  warmAnimations(): Promise<void> { return this.disposed ? Promise.resolve() : this.factory.warmClips(); }

  /**
   * A clip finished downloading after the board was already standing: hand it to
   * every figure of that roster on the board, in the tray and mid-move, so a
   * piece built during the opening is not left without a strike for the game.
   */
  private adoptClip(keys: TemplateKey[], name: ClipName, clip: THREE.AnimationClip): void {
    const wanted = new Set<TemplateKey>(keys);
    const install = (piece: PieceView): void => {
      if (wanted.has(`${piece.color}${piece.kind}`)) piece.installClip(name, clip);
    };
    for (const piece of this.pieces.values()) install(piece);
    for (const piece of this.motion) install(piece);
    for (const piece of this.captured) install(piece);
    for (const piece of this.promotionViews) install(piece);
  }

  start(): void {
    if (this.running) return;
    this.stageWorld();
    this.running = true;
    this.lastFrameTime = performance.now();
    const loop = (now: number): void => {
      if (!this.running) return;
      this.frameId = requestAnimationFrame(loop);
      // A frame limit skips animation frames between draws; time still flows, as frame() reads the real clock.
      const drawAt = nextRenderTimestamp(now, this.lastDrawnAt, this.frameLimit);
      if (drawAt === null) return;
      this.lastDrawnAt = drawAt;
      // Held (the pause menu), nothing moves: the picture is drawn again only twice a second (a resize or a settings
      // change still shows), so the menu over it has the machine to itself.
      if (this.held && performance.now() - this.heldDrawnAt < 500) return;
      if (this.held) this.heldDrawnAt = performance.now();
      try {
        this.frame();
      } catch (error) {
        this.frameErrors += 1;
        if (this.frameErrors <= 3) console.error("[scene] frame failed", error);
        // A misbehaving effect must never take the whole hall down with it.
        if (this.frameErrors === 3) this.postfx.forceDirect("repeated frame errors");
      }
    };
    this.frameId = requestAnimationFrame(loop);
  }

  private frame(): void {
    const now = performance.now();
    // The player's own clock: what the camera of a fatality and the frame-rate watch run on.
    // Held (the pause menu), no time passes at all: a fight, a fatality's slow motion, a rite, the arena's lava and its
    // flock all stand where they are, and go on from there when let go.
    const real = this.held ? 0 : Math.min(0.05, Math.max(0, (now - this.lastFrameTime) / 1000)) * this.combatHurry;
    // A replay's transport (pause, speed) runs the scene's own time; the frame-rate watch keeps the player's.
    const played = real * this.replayTimeScale;
    // A fatality's slow motion (fatality/fatalityPlan.ts) is the scene's own time scale: every system below is given
    // this delta, tweens, mixers, physics, blood, effects, spells and the rite alike. Sound keeps its own clock.
    const slow = this.fatality?.advance(played) ?? 1;
    // Two hit-stops hold the board on a blow: the combat feel's on every contact (combat/feel.ts) and the killing
    // moment's under its black and white (moments/). They start on the same contact, so the stronger of the two
    // holds at each instant rather than their product: one freeze, never a doubled stall. Both clocks run every frame.
    const hold = this.combatFeel.timeScale(played, this.combatHurry > 1 || this.reducedMotion);
    const moment = this.moments.advance(played, real);
    // While a fatality is slowing the scene the fatality has the time to itself.
    const delta = played * (slow < 1 ? slow : Math.min(hold, moment));
    this.lastFrameTime = now;
    this.elapsed += delta;

    // A quiet move asked to hurry (hurryMove): its tweens (the walk, a castling Rook's, the turn to the next player)
    // and the legs of the figure walking run ahead of the scene's clock. Nothing else on the board or round it is
    // hurried. Where motion is reduced there is no walk to show quickly, and what is left of the move is cut.
    const pace = this.walkHurry > 1 ? (this.reducedMotion ? HURRY_CUT : this.walkHurry) : 1;
    this.tweens.update(delta * pace);
    if (!this.reducedMotion && this.hall) {
      this.hall.update(delta);
      this.battlefield?.update(delta, this.camera);
      this.jungle?.update(delta, this.camera);
    }
    this.board.update(delta);
    this.effects.setContactProjectionScale(this.renderer.domElement.height * .5 * this.camera.projectionMatrix.elements[5]);
    this.effects.update(delta);
    this.alarm.update(delta);
    if (this.reducedMotion) this.shake.offset.set(0, 0, 0);
    // The camera's kicks and shudder run on the player's clock (a paused replay holds them) while a hit-stop holds the board.
    else this.shake.update(delta, played);

    this.downfall.update(delta);
    for (const piece of this.pieces.values()) piece.update(delta, this.elapsed);
    for (const piece of this.motion) piece.update(this.walkHurry > 1 && this.hurried.has(piece) ? delta * this.walkHurry : delta, this.elapsed);
    for (const piece of this.captured) piece.update(delta, this.elapsed);
    for (const piece of this.promotionViews) piece.update(delta, this.elapsed);
    // Settle this frame's defensive sockets before the attacker's correction.
    for (const piece of this.allPieces()) if (piece.isCombatDefender) piece.resolveContacts();
    for (const piece of this.allPieces()) if (!piece.isCombatDefender) piece.resolveContacts();
    // The shudder runs on the player's clock through a hold; a paused replay holds it too (played).
    this.combatFeel.update(played, delta);
    this.combatDirector.update(delta);
    // Blood runs on the same delta as the fight that draws it.
    this.gore?.update(delta);
    // So do smoke and dust: a skipped fight hurries them with it.
    this.vfx?.update(delta);
    // And a fatality's fluid: it pours, arcs and lands in the slow motion.
    this.fluid?.update(delta);
    // A burning body is lit from its bones as this frame has posed them.
    this.burning?.update(delta);
    // And the embers of a burn cool on it, in this arena's exposure.
    if (this.scorch) { this.scorch.setGlow(vfxGlow(this.displayExposure())); this.scorch.update(delta); }
    // After the pieces have animated: a ragdoll's bones are written over the clip's. A menu board never fetches Jolt.
    this.deathPhysics?.update(delta, !this.menuPresentation && !this.attract && ragdollWanted(this.goreIntensity, this.reducedMotion));
    // The rituals over the fallen run on the fight's clock too: a skipped fight hurries its claim.
    this.claiming.update(delta, this.camera, this.renderer.domElement.height, vfxGlow(this.displayExposure()));
    this.spells?.update(delta, this.camera, this.renderer.domElement.height, vfxGlow(this.displayExposure()));
    this.updateRite(delta);
    // The flourishes trace the blades as this frame has posed them (the pieces after contact IK, a rite's troops after the
    // rite has moved them), and draw on the frame's own exposure (vfx/flourish).
    this.flourish?.update(delta, this.camera, this.renderer.domElement.height, vfxGlow(this.displayExposure()), vfxLight(this.displayExposure()));
    // The Knight's vault's ink wings follow the figure as this frame has posed it; its flakes hang in the hit-stop with the rest.
    if (this.vaultFx) { this.vaultFx.setGain(vfxGlow(this.displayExposure())); this.vaultFx.update(delta, this.camera); }
    // A fatality's anatomy follows the body as this frame has posed it: clip, ragdoll and the rite's grip.
    this.fatality?.update(delta, played, this.camera);
    // A fatality's close shot moves on the player's clock: the camera comes in on the wound while the kill is slowed.
    this.updateDuelCamera(this.fatality?.holdsCamera ? played : delta);
    this.closeShotBadges(this.closeShotHolds());
    this.updateMatchOpening();
    this.boardReactions.update(delta);
    this.conclusion.update(delta, this.boardRevision);
    // A promotion's column: its light runs on the scene's clock (the sequence itself is a tween, see runPromotion).
    if (this.promotionStage) { this.promotionStage.landing.update(delta, this.camera, this.renderer.domElement.height); this.promotionStage.landing.setGain(vfxGlow(this.displayExposure())); }

    if (this.promotionGroup) {
      this.updatePromotionFocus(delta);
      if (this.tactical) {
        // Lay the picker flat so the four candidates face the overhead camera.
        this.promotionGroup.scale.setScalar(1);
        this.promotionGroup.position.set(0, 3.4, 0);
        this.promotionGroup.rotation.set(-Math.PI / 2, 0, 0);
      } else if (this.promotionAnchor) {
        // Staged over the far square, under its close shot: smaller, turned to the eye, and the lens held on it.
        const anchor = this.promotionAnchor.position;
        this.promotionGroup.scale.setScalar(this.promotionAnchor.scale);
        this.promotionGroup.rotation.set(0, 0, 0);
        this.promotionGroup.position.copy(anchor);
        this.promotionGroup.lookAt(this.camera.position.x, anchor.y, this.camera.position.z);
        this.postfx.setCinematic(true, this.camera.position.distanceTo(anchor));
      } else {
        this.promotionGroup.scale.setScalar(1);
        this.promotionGroup.rotation.set(0, 0, 0);
        this.promotionGroup.position.set(0, 2.6, 0);
        this.promotionGroup.lookAt(this.camera.position.x, 2.6, this.camera.position.z);
      }
    }

    if (this.tactical) this.alignTokens();

    // Auto orbit for the attract loop, and for a showcase only when the viewer
    // has actually asked for one. Never fight the hand on the mouse: a drag
    // suspends it for a few seconds.
    const orbitIdle = this.elapsed - this.lastManualCameraAt > 3.2;
    const showcaseOrbit = this.showcase && this.showcaseCamera === "orbit" && orbitIdle;
    this.controls.autoRotate = !this.reducedMotion && !this.tactical && !this.conclusion.active && !this.duelCamera && (this.attract || showcaseOrbit);
    this.controls.autoRotateSpeed = this.attract ? 0.45 : this.showcaseOrbitSpeed;

    // The follow camera writes the camera itself, so `change` events fired by
    // the controls below must not be mistaken for the viewer grabbing the view.
    this.cameraDriven = this.updateFollowCamera(delta);
    this.controls.update();
    this.cameraDriven = false;
    this.confineCamera();

    // A fatality's close shot is a long lens held on the slowed blow: the blow's shake, made for the player's wide view
    // and lasting four times as long in the slow motion, would throw it about. It is held to a tremor.
    const shake = this.fatalityShake.copy(this.shake.offset).multiplyScalar(this.fatality?.holdsCamera ? FATALITY.shake : 1);
    this.camera.position.add(shake);
    // A killing blow's lens kick rides on the shot for this frame's drawing only (moments/), and the moment's grade
    // goes to whichever pipeline draws it, with the contact point where this camera sees it.
    const lens = this.kickMomentLens();
    try {
      this.pushMomentGrade();
      // The fluid's surface is made from the camera as it draws this frame.
      this.fluid?.prepare(this.camera);
      if (this.battlefieldRenderer) this.battlefieldRenderer.render(delta);
      else this.postfx.render(delta);
    } finally {
      if (lens !== null) { this.camera.fov = lens; this.camera.updateProjectionMatrix(); }
    }
    this.camera.position.sub(shake);

    this.guardAgainstBlackFrames();
    // Frames, not the board's clock: a hit-stop would read as a burst of thousands of frames a second.
    this.sampleFps(real);
  }

  /**
   * Black-screen watchdog.
   *
   * Several driver stacks — Mesa's software rasterisers above all, which is what
   * a Linux box without working hardware acceleration falls back to — render an
   * all-black hall while the interface above it is perfectly fine. The cause is
   * never the same twice: sometimes the composer returns an empty buffer,
   * sometimes the reflection probe samples as NaN and poisons every lit
   * surface, sometimes it is the shadow maps.
   *
   * So rather than guessing, the frame itself is sampled five times over the
   * first seconds and each failed sample drops one more layer, in increasing
   * order of how much it costs to lose.
   */
  private guardAgainstBlackFrames(): void {
    if (this.darkFrameChecks >= DARK_FRAME_CHECKS.length) return;
    if (this.elapsed < DARK_FRAME_CHECKS[this.darkFrameChecks]) return;
    if (typeof document !== "undefined" && document.hidden) return;
    this.darkFrameChecks += 1;
    if (!this.isFrameBlack()) {
      // A picture is on screen — stand the watchdog down for good.
      this.darkFrameChecks = DARK_FRAME_CHECKS.length;
      return;
    }
    this.escalateFallback();
  }

  /**
   * Reads five small patches spread across the frame (centre plus the four
   * quadrants). Every one of them has to come back black before anything is
   * dropped, so a dark corner or a night-time arena never triggers this.
   */
  private isFrameBlack(): boolean {
    const gl = this.renderer.getContext();
    const { width, height } = this.renderer.domElement;
    const span = 6;
    if (width < span * 4 || height < span * 4) return false;
    const spots: [number, number][] = [
      [0.5, 0.5],
      [0.28, 0.32],
      [0.72, 0.32],
      [0.28, 0.7],
      [0.72, 0.7],
    ];
    const pixels = new Uint8Array(span * span * 4);
    for (const [u, v] of spots) {
      try {
        gl.readPixels(
          Math.floor(width * u - span / 2),
          Math.floor(height * v - span / 2),
          span,
          span,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          pixels,
        );
      } catch {
        return false;
      }
      for (let i = 0; i < pixels.length; i += 4) {
        if (pixels[i] > 10 || pixels[i + 1] > 10 || pixels[i + 2] > 10) return false;
      }
    }
    return true;
  }

  /** Drops the next layer of the pipeline and tells the interface why. */
  private escalateFallback(): void {
    this.fallbackStage += 1;
    switch (this.fallbackStage) {
      case 1:
        if (this.postfx.isBypassed) {
          this.escalateFallback();
          return;
        }
        this.postfx.setBypassed(true);
        this.report("Post-processing produced an empty frame on this driver — cinematic effects turned off.", false);
        return;
      case 2:
        if (this.environmentUsable === false) {
          this.escalateFallback();
          return;
        }
        this.environmentUsable = false;
        this.applyEnvironment();
        this.report("This driver cannot sample the reflection probe — switched to plain skylight.", false);
        return;
      default:
        if (this.safeMode) {
          console.warn("[scene] still rendering black after every fallback", describeGpu(this.gpu));
          this.darkFrameChecks = DARK_FRAME_CHECKS.length;
          return;
        }
        this.setSafeMode(true);
        this.report("Switched to safe rendering — your graphics driver could not draw the full scene.", true);
        return;
    }
  }

  private report(message: string, safe: boolean): void {
    console.warn(`[scene] ${message} (${describeGpu(this.gpu)})`);
    this.callbacks.onRenderFallback?.(message, safe);
  }

  // -------------------------------------------------------------- render health

  /** Tone mapping exposure, with the player's brightness on top of the theme. */
  private applyExposure(base = this.baseExposure()): void {
    if (this.bakedWorld) base = 5;
    this.renderer.toneMappingExposure = base * this.brightness * this.openingExposure * (this.safeMode ? 1.2 : 1);
  }

  private baseExposure(): number {
    const look = ARENA_LOOKS[this.arena];
    return this.tactical ? look.exposure * 1.12 : look.exposure;
  }

  /**
   * (Re)builds the reflection probe for the current arena, self-tests it once on
   * this driver, and falls back to a plain ambient skylight if it cannot be
   * trusted. A NaN probe blacks out every lit surface in the hall, so this is
   * the single most likely cause of an all-black scene.
   */
  private applyEnvironment(): void {
    if (this.bakedWorld) {
      this.scene.environment = null;
      this.ambientFallback.intensity = 0.45;
      return;
    }
    const look = ARENA_LOOKS[this.arena];
    const previous = this.environmentMap;
    this.environmentMap = null;
    this.scene.environment = null;
    previous?.dispose();

    const allowed = !this.safeMode && this.environmentUsable !== false && this.gpu.halfFloatBuffer;
    if (allowed) {
      try {
        const map = buildEnvironmentMap(this.renderer, look);
        if (this.environmentUsable === null) {
          this.environmentUsable = reflectionProbeWorks(this.renderer, map);
          if (!this.environmentUsable) console.warn("[scene] reflection probe renders black — using ambient skylight");
        }
        if (this.environmentUsable) {
          this.environmentMap = map;
          this.scene.environment = map;
          this.scene.environmentIntensity = look.environment.intensity;
        } else {
          map.dispose();
        }
      } catch (error) {
        this.environmentUsable = false;
        console.warn("[scene] could not build the reflection probe", error);
      }
    }

    // Without a probe the ambient term has to come from somewhere, or armour and
    // marble read as pure silhouettes.
    const lit = this.environmentMap !== null;
    this.ambientFallback.color.setHex(look.environment.top).lerp(new THREE.Color(look.environment.warm), 0.4);
    this.ambientFallback.intensity = lit ? 0 : look.environment.intensity * 1.15;
    this.refreshMaterials();
  }

  /**
   * Forces a shader rebuild on every material in the scene. Needed whenever the
   * shadow map is switched on or off at runtime, which otherwise leaves stale
   * programs behind.
   */
  private refreshMaterials(): void {
    this.scene.traverse((object) => {
      const material = (object as THREE.Mesh).material;
      if (!material) return;
      if (Array.isArray(material)) material.forEach((entry) => (entry.needsUpdate = true));
      else material.needsUpdate = true;
    });
  }

  private sampleFps(delta: number): void {
    if (delta <= 0) return;
    this.fpsSamples.push(1 / delta);
    if (this.fpsSamples.length > 120) this.fpsSamples.shift();
    if (this.elapsed - this.lastFpsReport < 1) return;
    this.lastFpsReport = this.elapsed;
    const average = this.fpsSamples.reduce((sum, value) => sum + value, 0) / this.fpsSamples.length;
    this.callbacks.onFps(Math.round(average));

    // One automatic step down if the detected preset is clearly too heavy.
    if (this.battlefieldRenderer || this.autoAdjusted || this.elapsed < 8 || this.fpsSamples.length < 100) return;
    if (average >= 40) return;
    const order: QualityPreset[] = ["low", "medium", "high", "ultra"];
    const index = order.indexOf(this.preset);
    if (index <= 0) {
      this.autoAdjusted = true;
      return;
    }
    this.autoAdjusted = true;
    const next = order[index - 1];
    this.setQuality(next);
    this.callbacks.onQualityAdjusted(next);
  }

  // ------------------------------------------------------------------- pieces

  private rebuildPieces(): void {
    // A replay's seek (seekReplayBoard) keeps each figure standing idle where the new position still has it, so the
    // figures that did not move do not pop (their idle phase and breath go on). Taken before anything is torn down.
    const standing = this.keepStanding ? this.standingFor(this.controller.getBoard()) : null;
    // Any beat still running belongs to the old board: invalidate it first so it
    // cannot re-register the figure it is carrying once its awaits resolve.
    this.boardRevision += 1;
    this.combatControl?.cancel();
    this.combatDirector.cancelAll();
    this.effects.clear();
    // A fatality belongs to the figure it was playing on: the scene's time is its own again, and the figure whole.
    this.fatality?.cancel(); this.fatalityShot = null;
    // So do the moments (moments/): no hit-stop, grade or darkened hall outlives the board they were played on.
    this.moments.reset();
    // Its fluid stops where it is; what it left on the stone stays.
    this.fluid?.stop();
    this.combatHurry = 1; this.combatKilled = false; this.duelHandover = false; this.clearing.clear();
    this.combatFeel.clear();
    // The fight is gone: its close-in gives the player's view back before anything newer frames the board.
    this.snapDuelCamera();
    this.cancelEndFraming();
    // The beaten figures and the weapons they let fall are freed below; their shade comes off the stone now. A replay's
    // seek forgets the ending too: played on from there, the replay stages it again as the game did.
    if (this.keepStanding) this.downfall.reset(); else this.downfall.cancel();
    // The battle's chronicle belongs to its ending: a board no longer over (a new game, an Undo, a seek back) has none.
    if (this.controller.getSnapshot().status !== "over") this.callbacks.onChronicle?.(null);
    this.boardReactions.reset(); this.boardReactions.setQuality(this.preset); this.reactionStateKey = "";
    this.rebuildPending = false;
    // Wounds ride on these figures' bones: take them off before the figures are freed.
    this.gore?.releaseFigures();
    // Smoke and dust belong to the move that raised them: a rebuilt board (Undo, a new game, a new army) starts clear.
    this.vfx?.clear(); this.vfxDuelVictim = null;
    // So do the flourishes: no arc, flake, chip, sigil or ribbon outlives the board it was raised on.
    this.flourish?.clear(); this.vaultFx?.clear();
    // A ritual belongs to the body it was taking: the bodies are about to be freed. A spell in the air goes with them.
    this.claiming.clear();
    this.returning.clear();
    this.claimShotOwed = null;
    // A promotion's light and its forming figure's sigil belong to the board it was played on.
    this.endPromotionStage();
    this.promotionShot = null;
    this.spells?.clear();
    this.endRite();
    // So does a burn: Undo, a new game or a new army puts back unburnt figures, and nothing waits on a husk.
    this.burning?.reset();
    for (const [square, piece] of this.pieces) if (standing?.get(square) !== piece) piece.dispose();
    // Figures mid-march, mid-strike or mid-death are not in `pieces` — without
    // this they would stay in the scene forever as a frozen double of the figure
    // the rebuild puts back on their square.
    for (const piece of this.motion) piece.dispose();
    for (const piece of this.captured) piece.dispose();
    this.pieces.clear();
    this.motion.clear();
    this.hoveredPiece = null;
    this.followPiece = null;
    this.captured = [];
    this.selected = null;
    // A move queued for the old board is not played on the new one (Undo, a new game): its piece is gone with it.
    if (this.heldTap) { this.heldTap = null; this.board.setQueued(null); this.callbacks.onMoveQueued?.(null, "let-go"); }
    this.heldReachCache = null;
    this.drag = null;
    this.legalTargets.clear();
    this.passingVictims.clear();
    this.board.clearHighlights();
    if (!this.factory.isReady) return;

    const settings = QUALITY_SETTINGS[this.preset];
    for (const entry of this.controller.getBoard()) {
      const still = standing?.get(entry.square);
      if (still) { this.pieces.set(entry.square, still); continue; }
      const tableau = this.menuPresentation ? MENU_TABLEAU.get(entry.square) : null;
      if (this.menuPresentation && !tableau) continue;
      const view = this.factory.create(entry.kind, entry.color, {
        contactShadows: settings.contactShadows,
        idleAnimation: settings.idleAnimations,
        rankBadge: this.menuPresentation ? false : this.rankBadges,
        dynamicMotion: !this.menuPresentation && !this.reducedMotion,
      });
      if (this.tactical) view.setFlat(true);
      if (tableau) {
        view.container.position.copy(tableau.position);
        view.setFacing(tableau.facing);
        view.setPresentationLook(true);
        view.setBadgeEnabled(false);
      } else {
        view.container.position.copy(squareToWorld(entry.square));
        view.setPresentationLook(false);
      }
      this.scene.add(view.container);
      this.pieces.set(entry.square, view);
    }
    this.layTrays();
    // Each footsoldier speaks in the voice its starting file gave it, whatever rebuilt the board (an Undo, a replay's seek).
    this.voices.restoreSlots(pawnOrigins(this.controller.getSnapshot().pgn));
    this.syncBoardReactions(this.controller.getSnapshot());
    this.restageDownfall();
  }

  private trayPosition(color: Faction, index: number): THREE.Vector3 {
    const column = Math.floor(index / 8);
    const row = index % 8;
    const side = color === "b" ? 1 : -1;
    const x = side * (TILE * 4 + 0.95 + column * 0.62);
    const z = -TILE * 3.2 + row * 0.92;
    return new THREE.Vector3(x, 0, z);
  }

  private async sendToTray(piece: PieceView): Promise<void> {
    this.motion.delete(piece);
    const index = this.captured.filter((entry) => entry.color === piece.color).length;
    this.captured.push(piece);
    // The fallen figure stands back up once it reaches the tray.
    piece.resetPose();
    const destination = this.trayPosition(piece.color, index);
    piece.container.scale.setScalar(0.55);
    piece.container.position.copy(destination);
    piece.setOpacity(0);
    await this.tweens.to({
      duration: 0.5,
      easing: Ease.outCubic,
      onUpdate: (t) => piece.setOpacity(t * 0.95),
    });
  }

  // ---------------------------------------------------------------- animation

  private async animateMove(event: MoveEvent): Promise<void> {
    this.movesInFlight += 1;
    try {
      await this.runMove(event);
    } catch (error) {
      // A move that broke part-way leaves its figures wherever it stopped, and the game goes on from the position it
      // has: the board is stood up again from the game (M-20). A beat cut short by a new board has nothing to mend.
      // The game controller still hears the error and logs it.
      if (!this.disposed && !(error instanceof CombatCancelled)) this.rebuildPieces();
      throw error;
    } finally {
      this.movesInFlight -= 1;
      // A skipped fight hurries everything up to here, the turn swing included.
      this.combatHurry = 1;
      // So does a quiet move asked to hurry, and no longer.
      this.quietStage = false; this.walkHurry = 1; this.hurried.clear();
      // A quality change that arrived mid-fight was held back; run it now.
      if (this.movesInFlight === 0 && this.rebuildPending) this.rebuildPieces();
    }
  }

  /**
   * True when the board has been rebuilt under a running beat, which means every
   * view that beat is holding has already been disposed.
   */
  private isStale(revision: number): boolean {
    return revision !== this.boardRevision || this.disposed;
  }

  /**
   * After an await in a capture scene (M-20): the board the scene was begun on has been replaced (Undo, a new game, a
   * rebuild), so it stops there instead of sounding, striking or claiming into the new one. The scenes run inside
   * runMove's try, which lets a stale beat end quietly.
   */
  private stopIfStale(revision: number): void {
    if (this.isStale(revision)) throw new CombatCancelled();
  }

  private async runMove(event: MoveEvent): Promise<void> {
    const piece = this.pieces.get(event.from);
    if (!piece) return;
    const revision = this.boardRevision;
    // The arrival shot a promoting Pawn's walk has taken, if it took one (see runPromotion).
    let promotionCamera: DuelCameraTimeline | null = null;

    this.clearSelection();
    this.board.clearHighlights();
    this.pieces.delete(event.from);
    this.motion.add(piece);

    const victim = event.capture ? this.pieces.get(event.capture.square) : null;
    if (event.capture) this.pieces.delete(event.capture.square);
    if (victim) this.motion.add(victim);
    // A piece its player pressed while waiting, and which is now being taken, is no longer waiting for anything. If
    // it had been told where to go, that move is refused here, as it is being taken, not when the fight is over.
    if (victim && victim === this.heldTap?.piece) {
      const queued = this.heldTap.to !== null;
      if (queued) audio.blip("deny");
      this.dropHeldTap(queued ? "refused" : "let-go");
    }
    // A piece an Undo is still returning is whole before it moves or is taken again.
    this.finishReturn(piece);
    if (victim) this.finishReturn(victim);
    if (event.capture) this.taken.push({ ply: this.controller.getSnapshot().sanList.length, ...event.capture });

    const from = squareToWorld(event.from);
    const to = squareToWorld(event.to);
    piece.clearBoardReaction(); victim?.clearBoardReaction();
    this.dispatchBoardReaction({ id: `move:${revision}:${this.controller.getSnapshot().fen}`, type: "move-started", point: to,
      primary: [piece.container.uuid, ...(victim ? [victim.container.uuid] : [])], victimColor: event.capture?.color });

    // Showcase follow camera: ride with the figure that is on the move, and
    // sit in a shade closer when it is walking into a fight.
    this.focusPiece(piece, victim ? 0.86 : 0.98);

    if (victim) {
      const strikeSquare = event.capture ? event.capture.square : event.to;
      // The ply that takes it: the history its claim, plea and spell are read against (see claimIsWatched).
      this.takenOn.set(victim, this.controller.getSnapshot().moves.length - 1);
      // What kind of moment this kill is decides how much of it is shown (gore/goreTiers.ts): kept for every gore system to ask.
      const opening = attackStyle(piece.kind, piece.arsenal);
      this.showTrace("capture", { attacker: piece.color + piece.kind, victim: victim.color + victim.kind, style: opening, directed: event.combat?.kind === "sequence" ? event.combat.record : null,
        staged: this.captureCinematics && !this.reducedMotion && !this.tactical });
      this.recordKill(piece, victim, event, opening === "spell" && this.summonFor(piece, victim) ? "summon" : opening, event.combat?.kind === "sequence");
      // A Knight's signature finisher, on some of its melee kills (finisher/knightVaultPlan.ts): the form it takes here.
      const vault = this.knightVaultFor(piece, victim, event);
      // The battle beat is a camera performance — it has no meaning on the map.
      if (this.captureCinematics && !this.reducedMotion && !this.tactical) {
        // The strike and the fall are the whole beat: make sure both figures
        // actually hold those clips before the fight starts.
        await this.armCombat(piece, victim);
        if (this.isStale(revision)) return;
        const pair = this.combatDirector.begin(piece, victim, () => !this.isStale(revision));
        piece.configureCombat(victim, event.choreography);
        victim.configureCombat(piece, event.choreography, true);
        try {
          // Casters burn their victims and gunners shoot them, both from where
          // they stand; everyone else has to walk into the blow. A directed duel
          // (Pawn takes Pawn) comes first for anyone who closes, so Korvenia's line
          // infantry fixes bayonets for it and keeps the musket for every other kill.
          const style = attackStyle(piece.kind, piece.arsenal);
          // A Queen who takes anything larger than a Pawn calls on what her kingdom keeps (rites/); if that
          // cannot be had, she casts as her Bishop does.
          const summon = style === "spell" ? this.summonFor(piece, victim) : null;
          if (summon && await this.playSummonCinematic(summon, piece, victim, from, to, strikeSquare, pair))
            { /* the rite killed it */ }
          else if (style === "spell") {
            // A summon that could not be had: she casts instead, and the moment is a spell's.
            if (summon) this.recordKill(piece, victim, event, "spell");
            await this.playSpellCinematic(piece, victim, from, to, strikeSquare, pair);
          } else if (event.combat?.kind === "sequence" && await this.playDirectedCombat(event.combat, piece, victim, from, to, strikeSquare, pair, revision))
            { /* the director fought it */ }
          else {
            // A duel the director handed back is fought as any other capture, with the rank's own weapon.
            if (event.combat?.kind === "sequence") this.recordKill(piece, victim, event, style);
            if (style === "gun") await this.playGunCinematic(piece, victim, from, to, strikeSquare);
            else if (vault?.mode === "full") await this.playKnightVault(piece, victim, from, to, strikeSquare, pair, vault.context);
            else await this.playCaptureCinematic(piece, victim, from, to, strikeSquare, pair, event.choreography);
          }
        } catch (error) {
          if (this.isStale(revision)) return;
          // A broken effect must never strand a figure in the middle of a fight:
          // finish the kill the plain way so the board stays consistent.
          console.warn("[scene] battle beat failed", error);
          this.camera.fov = this.lensFov;
          this.camera.updateProjectionMatrix();
          piece.setStrikeTilt(0);
          if (!victim.isSlain) await this.crumble(victim, from);
        } finally {
          piece.clearCombatTargets(); victim.clearCombatTargets();
          pair.close();
        }
      } else {
        const approach = squareToWorld(event.from);
        this.wake(victim);
        await this.glide(piece, from, to, event.kind === "n");
        // A Knight's vault under Reduced Motion: its ordinary leap, then a slow, dim ring and a few flakes settling round it.
        if (vault?.mode === "calm") this.calmVault(piece, to, vault.context);
        // No fight to watch (reduced motion): the same small flash a directed kill keeps.
        this.strikeImpact(strikeSquare, 0.8 * 0.45);
        // ...and, under Reduced Motion alone, the gentle form of the killing blow's grade (moments/): no time, no lens.
        if (this.reducedMotion && this.captureCinematics && !this.tactical) this.momentBlow(victim, piece, victim.combatPoint(new THREE.Vector3()), true);
        // No battle beat, but still a killing: the blow and the flesh it goes into, then the fall.
        this.livePlea?.cut();
        audio.strike(piece.kind, {
          pan: this.stereoPan(victim.container.position),
          volume: 0.8,
          flesh: captureLayers({ silentBoard: this.silentBoard(), spell: false }).flesh,
        });
        // A capture the Director would have fought (reduced motion, tactical map, cinematics off) still marks
        // the stone: nothing flies, the stains and the pool are simply there.
        if (event.combat?.kind === "sequence") this.drawBlood(event.combat, piece, victim, to.clone().sub(approach), event.combat.power, true);
        // So does a spell or the field gun: no burst is shown, the burn it would have left is simply there, cold.
        const style = attackStyle(piece.kind, piece.arsenal);
        if (style === "spell") { const spell = spellProfile(piece.kind); this.burnStone("spell", this.spellArmy(piece), victim.container.position, approach, spell.blast, spell.ring, true); }
        else if (style === "gun" && GUNS[piece.kind].wave) this.burnStone("gun", this.spellArmy(piece), victim.container.position, approach, GUNS[piece.kind].blast, 0, true);
        this.killedBy.set(victim, deathCause(style, piece.kind, GUNS[piece.kind].wave !== null));
        await this.crumble(victim, approach);
      }
      if (this.isStale(revision)) return;
      this.reactToImpact(victim.container.position, .65, victim, piece, "ally-fallen");
      // A directed fight frees the board when the square is taken; the body may still be on its way off it.
      const leaving = this.clearing.get(victim);
      this.clearing.delete(victim);
      if (leaving) void leaving.then(() => { if (!this.isStale(revision)) void this.sendToTray(victim); }, () => undefined);
      else void this.sendToTray(victim);
    } else {
      // No fight in this move: from here to its end a press may ask it to hurry (hurryMove).
      this.quietStage = true;
      this.hurried.add(piece);
      // A Pawn walking onto the far rank: the camera comes in on the square as it goes (the picker's shot, carried on).
      if (event.promotion && this.promotionPlanFor(event).camera) promotionCamera = this.promotionArrival(event);
      await this.glide(piece, from, to, event.kind === "n");
      audio.play("place", 0.55);
    }

    if (this.isStale(revision)) return;
    piece.container.position.copy(to);
    this.motion.delete(piece);
    this.pieces.set(event.to, piece);
    // The move is over: hold on the square that was just taken.
    this.focusPoint(to, 1);
    // Taking the square: dust ring, tile dip and the figure settling its weight.
    // Softer after a kill — the strike already shook the stone.
    this.landOn(piece, event.to, victim ? 0.7 : event.kind === "n" ? 1.25 : 1);
    this.voices.landed(event);
    // ...and if that square was somebody else's, it is now claimed.
    if (victim) this.claimSquare(piece, event.to, victim.kind);
    // Arrived: face the enemy side again rather than holding the march heading.
    // A promoting figure is about to be replaced, so it is left alone.
    if (!event.promotion) void piece.turnHome(this.tweens, 0.3);
    // [battle memory] A fallen ally avenged: the avenger's own moment, now it stands on the square it took.
    if (victim && !event.promotion) this.honourAvenger();

    if (event.rook) {
      const rook = this.pieces.get(event.rook.from);
      if (rook) {
        rook.clearBoardReaction();
        this.pieces.delete(event.rook.from);
        this.motion.add(rook);
        this.hurried.add(rook);
        // The tower walks its own path after the king has taken its square, so
        // castling reads as two moves rather than one synchronised slide.
        await this.glide(rook, squareToWorld(event.rook.from), squareToWorld(event.rook.to), false);
        if (this.isStale(revision)) return;
        this.motion.delete(rook);
        this.pieces.set(event.rook.to, rook);
        audio.play("place", 0.4);
        this.landOn(rook, event.rook.to, 0.85);
        this.voices.rookLanded(event);
        void rook.turnHome(this.tweens, 0.3);
      }
    }

    if (event.promotion) {
      await this.runPromotion(event, piece, revision, promotionCamera);
      if (this.isStale(revision)) return;
    }

    this.board.setHighlight(event.from, "last");
    this.board.setHighlight(event.to, "last");

    if (event.isCheck) {
      // Checks in a row are the game's, read from its ledger (an Undo, or a replay seeked here, counts the same).
      const ledger = this.controller.getSnapshot().moves, checkRun = checkRunAt(ledger, ledger.length - 1);
      const king: Faction = event.color === "w" ? "b" : "w";
      let kingAt = to;
      for (const [square, view] of this.pieces) if (view.kind === "k" && view.color === king) kingAt = squareToWorld(square);
      if (this.silentBoard()) audio.play("check", 0.55);
      // A mated King does not murmur that it is not yet his time: he says his defeat in the ending (endGame).
      else this.voiced("check", () => audio.check(king, this.stereoPan(kingAt), event.isGameOver ? Infinity : checkRun));
      // The alarm was already lit by the state publish, but the *declaration* is
      // this beat — the moment the move actually lands on the board — so the
      // surge and the rumble are fired from here rather than from `onState`.
      // A rumble, not a jolt: nothing struck the camera, the hall reacted. Kept
      // deliberately faint and short — enough to be felt at the edge of
      // attention, not enough to move the board under the player's eye.
      this.alarm.strike();
      this.shake.tremor(0.16, 0.6);
      // The dread grade comes in on the same beat (moments/); the state takes it away when the check is answered.
      this.moments.setCheck(king);
    }

    if (
      this.rotateBoard &&
      !this.tactical &&
      this.controller.getSnapshot().mode === "hotseat" &&
      !event.isGameOver
    ) {
      // A duel shot has already carried the view round to the player who moves next.
      if (this.duelHandover) this.duelHandover = false;
      // A shot that still holds the camera (a claim being watched, or the fight's own kept for it) is not cut
      // into: it ends on the next player's side instead.
      else if (this.duelCamera) this.duelCamera.timeline.rehome(this.turnedView(this.duelCamera.timeline.home));
      else {
        // The turn to the next player may be hurried too, after a fight as after a walk.
        this.quietStage = true;
        await this.swingCamera();
      }
    }
    this.duelHandover = false;
  }

  /**
   * Both fighters are handed the clips their beat is built on. They are fetched
   * in the background at start-up, but a request dropped during the opening
   * burst would otherwise leave a figure that kills without ever swinging — so
   * a capture asks for them again here, behind a ceiling that keeps a bad
   * network from stopping the game.
   */
  private async armCombat(attacker: PieceView, victim: PieceView): Promise<void> {
    const ready = attacker.hasClip("attack") && (victim.hasClip("death") || !victim.hasAnimations)
      && (attacker.kind !== "p" || attacker.hasCombatVariant("attack.thrust"))
      && (victim.kind !== "p" || victim.hasCombatVariant("death.front"));
    if (ready) return;
    await Promise.race([
      Promise.all([
        this.factory.ensureClip(attacker.color, attacker.kind, "attack"),
        this.factory.ensureClip(victim.color, victim.kind, "death"),
        this.factory.ensureCombatLibrary(attacker.color, attacker.kind),
        this.factory.ensureCombatLibrary(victim.color, victim.kind),
      ]),
      wait(2.4),
    ]);
  }

  /**
   * Hands a figure the stride it is about to move on. The strides are warmed in
   * the background, so without this the first move of a game was made before the
   * walk clip had landed and the figure slid across the board on its stance —
   * which read as a rank having lost its animation altogether. Capped, so a slow
   * network costs the move a fraction of a second rather than stalling the board.
   *
   * @returns whether the clip is now bound to this figure
   */
  private async armStride(piece: PieceView, name: MarchClip): Promise<boolean> {
    if (piece.hasClip(name)) return true;
    await Promise.race([this.factory.ensureClip(piece.color, piece.kind, name), wait(0.6)]);
    return piece.hasClip(name);
  }

  /**
   * Moving a figure between two squares. A rigged sculpt turns to face its
   * destination, crosses the distance on its own legs and puts a real footfall
   * down on every step: the walk clip is retimed to the cadence of its rank, so
   * the skeleton and the stride clock that fires the footstep sounds and the
   * grit puffs are the same clock — nothing skates.
   *
   * The knight keeps its leap and runs through the air instead of walking.
   * Sculpts with no rig (and the low preset, where skeletal animation is off)
   * keep the old smooth slide, but still step audibly so the board is not silent.
   *
   * @param hurry cadence multiplier — above 1 the figure presses forward, which
   *   is what a charge into a standoff needs.
   * @param arrive told the move's length (seconds) and its footfalls a second as
   *   the figure sets off, so the caller can time something to its last steps.
   */
  private async glide(piece: PieceView, from: THREE.Vector3, to: THREE.Vector3, arc: boolean, hurry = 1, arrive?: (seconds: number, stepRate: number) => void) {
    const settings = QUALITY_SETTINGS[this.preset];
    const distance = from.distanceTo(to);
    const gait = GAITS[piece.kind];
    // Walking is not a luxury the graphics preset gets to take away: a march is
    // one mixer for a second or two, the same cost as the strike and the death
    // clips that already play on every preset. Only the flat tactical map (where
    // no sculpt is on screen) and a sculpt with no rig at all fall back to a slide.
    // Reduced motion keeps the one moving figure off its legs, as it keeps the
    // living reactions off the rest.
    const wantsLegs = !this.tactical && !this.reducedMotion && piece.hasAnimations;
    // The stride has to be in hand *before* the move is staged, not merely
    // downloaded at some point: the opening move is made seconds after the board
    // stands up, which is exactly when the stride clips are still in the air.
    const clip: MarchClip =
      wantsLegs && arc && (await this.armStride(piece, "run")) ? "run" : "walk";
    const onFoot = wantsLegs && (clip === "run" || (await this.armStride(piece, "walk")));

    // Longer moves take more steps rather than a faster slide.
    const tiles = Math.max(0.6, distance / TILE);
    const steps = Math.max(2, Math.round(tiles * gait.stepsPerTile * (arc ? 0.8 : 1)));
    const cadence = gait.cadence * hurry * (arc ? 1.5 : 1);
    const time = onFoot
      ? THREE.MathUtils.clamp(steps / cadence, 0.34, 2.4)
      : Math.min(0.72, 0.24 + distance * 0.055) / hurry;
    // The realised cadence, after the clamp — this is what the legs must match.
    const stepRate = steps / time;
    const height = arc ? 0.85 + distance * 0.08 : 0.06;
    const trails = settings.captureParticles >= 34 && distance > TILE * 0.6;
    let nextTrail = 0.18;
    // A fraction of a step, so the first boot lands just after the push-off
    // instead of on the frame the figure starts to move.
    let nextStep = 0.34;

    if (arc) {
      // Kicking off: grit thrown back off the tile the rider leaves behind.
      piece.flareAura(0.4);
      this.effects.spawnBurst(from.clone().setY(BOARD_TOP + 0.06), 0xc7ac82, trails ? 10 : 5, {
        speed: 1.4,
        life: 0.4,
      });
    } else if (onFoot) {
      // Nobody walks backwards: square up on the destination before setting off.
      await piece.turnTowards(to, this.tweens, Math.min(0.22, 0.5 / cadence));
    }

    const marching = onFoot && piece.startMarch(clip, stepRate);
    arrive?.(time, stepRate);
    // A ground march holds a constant speed through the middle of the move; a
    // slide and a leap keep their eased curves.
    const easing: Easing = arc
      ? Ease.inOutCubic
      : marching
        ? strideEasing(Math.min(0.3, 1.1 / steps))
        : Ease.inOutQuart;

    await this.tweens.to({
      duration: time,
      easing,
      onUpdate: (t) => {
        piece.container.position.lerpVectors(from, to, t);
        piece.container.position.y = from.y + Math.sin(Math.PI * t) * height;
        // Footfalls: the boot itself, plus the grit it lifts off the stone. The
        // rider is in the air, so its run makes no contact until it lands.
        if (!arc && steps > 0) {
          const taken = t * steps;
          while (taken >= nextStep && nextStep <= steps) {
            this.footfall(piece, gait, Math.round(nextStep), trails);
            nextStep += 1;
          }
        }
        // A thin wake of dust follows a sliding figure or a leaping rider.
        if (trails && !marching && t >= nextTrail && t < 0.88) {
          nextTrail += arc ? 0.2 : 0.24;
          this.effects.spawnSmoke(piece.container.position.clone().setY(BOARD_TOP + 0.07), {
            count: 2,
            radius: 0.22,
            scale: arc ? 0.4 : 0.3,
            growth: 2.1,
            life: 0.55,
            speed: 0.3,
            rise: 0.1,
            color: 0x9d9078,
            opacity: arc ? 0.24 : 0.16,
          });
        }
      },
    });
    piece.container.position.copy(to);
    if (marching) piece.stopMarch(0.2);
    if (arc) this.shake.add(0.05);
  }

  /**
   * One boot going down mid-march: the step itself, panned to where the figure
   * is on screen and pitch-jittered so a long march never turns metronomic,
   * plus a small puff of grit lifted exactly where the foot struck.
   */
  private footfall(piece: PieceView, gait: Gait, index: number, dust: boolean): void {
    const at = piece.container.position;
    if (this.voices.stepHeard(at)) audio.footstep({
      pan: this.stereoPan(at),
      timbre: this.voices.stepTimbre(piece, gait.timbre),
      // Alternating feet are never quite equal, and neither are two steps.
      volume: gait.volume * (index % 2 === 0 ? 1 : 0.93),
      jitter: (this.showDice(`step ${piece.color}${piece.kind} ${index}`)() - 0.5) * 0.16,
    });
    // Under the boot that came down, where the rig has feet: the lower of the two on this frame. A figure with no
    // legs to read (a slide, the low preset) keeps the middle of its base.
    const foot = piece.lowerFoot(this.airFoot) ?? at;
    // The ash lying on the tile is parted by it too, whatever the preset draws on the stone.
    this.stirAir("step", foot.x, BOARD_TOP, foot.z, gait.volume);
    if (!dust) return;
    // A small, low scuff that reads on the dark stone for a breath and settles: lighter than the stone, low and wide
    // rather than rising (at 0.15 and the stone's own colour it was never seen).
    this.effects.spawnSmoke(this.airFoot.set(foot.x, BOARD_TOP + 0.05, foot.z), {
      count: 3,
      radius: 0.12,
      scale: 0.2 + gait.volume * 0.1,
      growth: 2.6,
      life: 0.65,
      speed: 0.32,
      rise: 0.04,
      color: 0xc2b498,
      opacity: 0.34,
    });
  }

  /**
   * The arrival beat on a destination square: a dust ring rolls out from under
   * the figure, the tile dips, the team aura flares and the body takes the
   * weight with a short squash that springs back. `weight` scales the whole
   * thing — a knight dropping out of its arc lands harder than a bishop slid
   * across the board, and a victor stepping onto a corpse lands softer still.
   */
  private landOn(piece: PieceView, square: SquareId, weight = 1): void {
    const settings = QUALITY_SETTINGS[this.preset];
    const heavy = piece.kind === "k" || piece.kind === "q" || piece.kind === "r";
    const strength = Math.min(1.6, weight * (heavy ? 1.18 : 0.92));
    const centre = squareToWorld(square, BOARD_TOP + 0.05);

    this.board.land(square, FACTION_ACCENT[piece.color], strength);
    this.woodKnock(piece, centre, strength);
    this.landingSteps(piece, centre, strength);
    piece.flareAura(Math.min(1, 0.8 * strength));
    if (strength > 0.9) this.shake.add(0.035 * strength);
    this.stirAir("land", centre.x, BOARD_TOP, centre.z, strength);

    const grit = Math.max(5, Math.round(settings.captureParticles * 0.2 * strength));
    this.effects.spawnBurst(centre, 0xd9bd8e, grit, { speed: 1.15 * strength, life: 0.45 });
    if (settings.captureParticles >= 34) {
      this.effects.spawnSmoke(centre.clone().setY(BOARD_TOP + 0.08), {
        count: Math.max(2, Math.round(grit * 0.25)),
        radius: 0.42,
        scale: 0.42,
        growth: 2.5,
        life: 0.75,
        speed: 0.6 * strength,
        rise: 0.1,
        color: 0xa2947c,
        opacity: 0.26,
      });
    }

    void this.settle(piece, strength);
  }

  /**
   * The soft wooden tock of a figure meeting the board, panned to the square it
   * lands on. Heavier ranks knock lower and longer; a light touch-down (a victor
   * stepping onto a cleared square) barely registers.
   */
  private woodKnock(piece: PieceView, at: THREE.Vector3, strength: number): void {
    // The hand lets a living figure go; the menu's board keeps its wooden knock.
    if (this.voices.setDown(piece, strength)) return;
    audio.woodTap({
      pan: this.stereoPan(at),
      weight: WOOD_WEIGHT[piece.kind],
      volume: Math.min(1.05, 0.5 + strength * 0.42),
    });
  }

  /**
   * Boots taking the square. Everyone puts one foot down as they arrive; the
   * rider drops out of its leap onto both, a beat apart, which is what makes
   * the landing read as weight rather than a touch-down.
   */
  private landingSteps(piece: PieceView, at: THREE.Vector3, strength: number): void {
    const gait = GAITS[piece.kind];
    if (!this.voices.stepHeard(at)) return;
    const pan = this.stereoPan(at);
    const timbre = this.voices.stepTimbre(piece, gait.timbre);
    const volume = gait.volume * Math.min(1.4, 0.85 + strength * 0.45);
    audio.footstep({ pan, timbre, volume });
    if (piece.kind !== "n") return;
    audio.footstep({ pan, timbre, volume: volume * 1.15, delay: 0.07, jitter: -0.09 });
  }

  /**
   * The square changing hands.
   *
   * Every kill on this board already had a *violent* punctuation — the blow, the
   * cry, the body thrown clear — but the thing that actually wins a game of
   * chess happened silently: a figure stepped onto a square that belonged to
   * somebody else and the board sounded exactly as it does on a quiet move.
   * This is that moment given its own beat, and it is deliberately small: the
   * fight was the spectacle, this is the full stop after it.
   *
   * Three things, all keyed to what was taken rather than to who took it (see
   * {@link CONQUEST_WEIGHT}), so trading a pawn never sounds like felling a queen:
   *
   * - the claim signature — a boot on the stone under a rising brass motif;
   * - the victor's colours closing inward over the tile it has just cleared;
   * - the figure itself drawing up to its full height on the new square.
   */
  private claimSquare(victor: PieceView, square: SquareId, taken: PieceKind): void {
    const weight = CONQUEST_WEIGHT[taken];
    const accent = FACTION_ACCENT[victor.color];
    const centre = squareToWorld(square, BOARD_TOP + 0.032);

    audio.conquest({
      pan: this.stereoPan(centre),
      weight,
      volume: 0.78 + weight * 0.3,
    });

    void this.claimRing(victor, square, centre, accent, weight);

    // The team ring under the figure answers its own colour arriving.
    victor.flareAura(Math.min(1.5, 1 + weight * 0.5));
    void this.drawUp(victor, weight);
  }

  /**
   * The victor's colours closing in over the square it has taken (strikes.ts spawnConquestClaim), and the chips of the
   * old occupant's tile thrown up with a warm flash as the mark seals.
   *
   * It is drawn for the player's seat, where it spans two squares, and waits for the view to be home. From a shot
   * nearer the board the same ring spanned three squares and lay over the body beside the tile (the VFX audit's duel,
   * 4.4-4.8 s); drawn at 4/7 of its size, it still swept across the body filling a look at it (vfx-blows' first
   * preview, 4.2 s); and a square is mostly taken while the Claiming's shot is looking up at the sorcerer, where it
   * was not seen at all (vfx-blows' Glacial crown and field gun takes). The claim is still heard as the square is
   * taken. If the view is not home within CLAIM_RING_WAIT, the ring is drawn at 4/7 under a shot that holds the board,
   * and not at all under a close shot (closeShotHolds); nor once the square has changed hands or the board been rebuilt.
   */
  private async claimRing(victor: PieceView, square: SquareId, centre: THREE.Vector3, accent: number, weight: number): Promise<void> {
    const revision = this.boardRevision;
    for (let waited = 0; this.duelCamera !== null || this.closeShotHolds(); waited += 0.05) {
      if (waited >= CLAIM_RING_WAIT) { if (this.closeShotHolds()) return; break; }
      await this.tweens.to({ duration: 0.05, easing: Ease.linear, onUpdate: () => undefined });
      // Taken back, or retaken (a promotion keeps the colour).
      if (this.isStale(revision) || this.disposed || this.pieces.get(square)?.color !== victor.color) return;
    }
    const settings = QUALITY_SETTINGS[this.preset];
    const scale = this.duelCamera !== null ? 4 / 7 : 1;
    void spawnConquestClaim(this.scene, this.tweens, centre, {
      color: accent,
      radius: TILE * (2.1 + weight * 0.7),
      height: BOARD_TOP + 0.028,
      weight,
      scale,
    });
    // The chips are fired on a short delay, so they land with the ring closing, not with the footfall.
    const chips = Math.max(4, Math.round(settings.captureParticles * (0.16 + weight * 0.16)));
    await wait(0.26);
    if (this.disposed || this.isStale(revision)) return;
    this.effects.spawnBurst(centre.clone().setY(BOARD_TOP + 0.1), accent, chips, {
      speed: 0.9 + weight * 0.7,
      life: 0.6,
      gravity: 2.6,
      radius: 0.34,
      size: 0.1,
      growth: 0.6,
      rise: 0.5,
      drag: 1.2,
    });
    this.effects.spawnFlash(centre.clone().setY(BOARD_TOP + 0.18), (1.1 + weight * 0.9) * scale, 0.26);
  }

  /**
   * The victor drawing itself up on the square it has taken: the shoulders come
   * back off the blow for a beat and spring level again. Driven off the runtime
   * node rather than a clip, so every figure gets it — rigged or not, and
   * whichever of the three battle beats it just finished.
   *
   * Deliberately a *lean*, not a pose: it has to finish inside the pause before
   * the opponent replies, or the board reads as waiting for a victory dance.
   */
  private async drawUp(piece: PieceView, weight: number): Promise<void> {
    const lean = 0.045 + weight * 0.055;
    await this.tweens.to({
      duration: 0.13,
      easing: Ease.outCubic,
      onUpdate: (t) => piece.setStrikeTilt(-lean * t),
    });
    await this.tweens.to({
      duration: 0.5,
      easing: Ease.outElastic,
      onUpdate: (t) => piece.setStrikeTilt(-lean * (1 - t)),
    });
    piece.setStrikeTilt(0);
  }

  /** Knees taking the load: a fast compression that springs back out. */
  private async settle(piece: PieceView, strength: number): Promise<void> {
    const depth = Math.min(1, 0.5 + strength * 0.45);
    await this.tweens.to({
      duration: 0.09,
      easing: Ease.outCubic,
      onUpdate: (t) => piece.setSquash(depth * t),
    });
    await this.tweens.to({
      duration: this.reducedMotion ? 0.1 : 0.24,
      easing: Ease.outCubic,
      onUpdate: (t) => piece.setSquash(depth * (1 - t)),
    });
    piece.setSquash(0);
  }

  /**
   * The hand-to-hand battle beat: charge, square up, strike, crumble. How hard
   * it hits is read out of {@link STRIKES} for the attacking rank, so the same
   * choreography carries a footsoldier's stab and a royal execution without
   * either one borrowing the other's weight.
   */
  private async playCaptureCinematic(
    attacker: PieceView,
    victim: PieceView,
    from: THREE.Vector3,
    to: THREE.Vector3,
    strikeSquare: SquareId,
    pair: CombatSession,
    choreography?: CombatSequence,
  ): Promise<void> {
    const revision = this.boardRevision;
    const base = STRIKES[attacker.kind];
    const force = choreography?.hit === "hit.heavy" ? 1.25 : choreography?.hit === "hit.medium" ? 1.05 : .85;
    const profile = choreography ? { ...base, power: base.power * force, hold: Math.max(base.hold, (force - .65) * .14) } : base;
    const victimSpot = victim.container.position.clone();
    const reach = attacker.preferredContactReach() ?? TILE * .52;
    const { standoff, direction: blow, focus } = stageCombatPair(from, victimSpot, to, reach);
    this.focusPoint(focus, .68);
    const punch = this.lensPunch(profile.zoom);
    void this.tweens.to({
      duration: .22, easing: Ease.outCubic,
      onUpdate: t => { this.camera.fov = this.lensFov - punch * t; this.camera.updateProjectionMatrix(); },
    });
    victim.braceForImpact(standoff);
    // The defender wakes as its killer comes for it, and begs.
    this.wake(victim);
    // The killing swing's light arc (vfx/flourish), traced from the strike.
    const arc = `${this.boardRevision}:melee`;
    this.meleeArc = null;
    const feel = this.combatFeel.begin();
    await pair.melee({
      approachAttacker: () => {
        // The killer smears as it charges into the blow (vfx/flourish), until its blow lands (meleeContact).
        this.flourishing()?.beginSmear(`${this.boardRevision}:lunge`, out => attacker.combatPoint(out), this.spellArmy(attacker), this.flourishSeed("smear"));
        // It comes up into its guard over the last steps of the charge, its legs still running (an upper-body layer,
        // animation/upperBodyLayer.ts), and arrives ready rather than walking in with idle arms and winding up after.
        return this.glide(attacker, from, standoff, attacker.kind === "n", profile.charge, (seconds, stepRate) => {
          const rise = Math.min(seconds, GUARD_RISE.steps / Math.max(stepRate, 1e-3), GUARD_RISE.seconds);
          attacker.raiseGuard({ delay: seconds - rise, fade: rise, variant: choreography?.attack });
        });
      },
      faceDefender: () => victim.turnTowards(standoff, this.tweens, .3),
      faceAttacker: () => attacker.faceTowards(victimSpot),
      wind: profile.wind,
      prepare: async () => {
        if (profile.pillar) await this.passSentence(victim, victimSpot, profile.pillar, QUALITY_SETTINGS[this.preset].postFx, pair);
        // The killer stands over it until its last word is said, then swings.
        await this.letThemBeg(0.35);
        this.stopIfStale(revision);
      },
      strike: () => {
        const timing = attacker.hasCombatVariant(choreography?.attack ?? "") || attacker.hasClip("attack") ? attacker.playAttack({ variant: choreography?.attack }) : null;
        // The killing swing is traced from its first frame, unseen, and drawn as a light arc as it lands (meleeContact).
        this.meleeArc = this.traceKillingSwing(arc, attacker, victim) ? arc : null;
        if (choreography && timing?.duration) {
          const first = timing.events?.find(event => event.name === "clash" || event.name === "feint");
          victim.playDefense(choreography.defense, first?.time ?? timing.impact);
        }
        // The weapon's trail through the drive, and a glint as the killing blow starts (combat/feel.ts). A rank's
        // generic clip carries no `ready` frame: its wind-up is taken as the first stretch of the way to the blow.
        const swung = !!timing && timing.duration > 0 && timing.impact > 0;
        const ready = swung ? Math.min(timing.impact * .8, timing.events?.find(event => event.name === "ready")?.time ?? timing.impact * .4) : 0;
        // The guard it charged in holding gives way to the blow by the blow's own wind-up: the blow keeps its timing.
        attacker.lowerGuardInto(swung ? ready : .15);
        if (feel && swung) {
          this.combatFeel.swing(attacker, timing.impact - ready + .12, ready);
          this.combatFeel.glint(attacker, .55, ready);
        }
        return timing;
      },
      exchange: event => {
        if (event.name === "clash") {
          const at = victim.shieldContact(new THREE.Vector3());
          this.effects.spawnFlash(at, .9, .12);
          this.effects.spawnBurst(at, 0xffd48d, 8, { speed: 1.2, life: .25 });
          victim.playReaction("hit.light");
          this.shake.add(.04);
          this.stirAir("clash", at.x, at.y, at.z, .8);
          // The stopped blow holds the board an instant and rings through the shield (combat/feel.ts).
          if (this.combatFeel.impact("clash", victim, blow, profile.power, attacker.kind)) this.combatFeel.sparks(at, new THREE.Vector3(-blow.z, .3, blow.x), 6, 0xffd48d, 2.2, .6);
        }
      },
      swing: () => {
        if (profile.swing > 0) audio.bladeWhoosh({ pan: this.stereoPan(standoff), volume: profile.swing, weight: profile.heft });
      },
      fallbackStrike: () => this.lunge(attacker, blow, profile.heft),
      contact: () => this.meleeContact(attacker, victim, victimSpot, standoff, blow, strikeSquare, profile),
      hold: Math.max(profile.hold, victim.reactionLead()),
      recover: fallback => {
        if (fallback) this.recover(attacker, blow, profile.heft);
        if (profile.aftershock > 0) void this.aftershock(strikeSquare, profile.aftershock);
      },
      fall: () => this.slay(victim, blow, true, pair),
      advance: async () => {
        attacker.clearCombatTargets();
        this.flourish?.stopArc(arc);
        void this.tweens.to({
          duration: .45, easing: Ease.outCubic,
          onUpdate: t => { this.camera.fov = this.lensFov - punch * (1 - t); this.camera.updateProjectionMatrix(); },
        });
        await Promise.all([this.banish(victim, blow), this.glide(attacker, standoff, to, false, 1.5)]);
        this.stopIfStale(revision);
        // The arrival itself is punctuated by the claim beat (see `claimSquare`),
        // not by the generic set-down clack a quiet move gets.
        if (choreography) attacker.playReaction("recovery.victory");
      },
    });
  }

  // ---------------------------------------------------------------- the Knight's vault (finisher/)

  /**
   * Whether this capture is a Knight's vault, and in which form (finisher/knightVaultPlan.ts vaultMode): the rule reads
   * the game's history and one draw of the match's show dice for this ply, so the same game always plays it on the same
   * captures. Null for anything but a Knight's capture (no dice are drawn for it).
   */
  private knightVaultFor(attacker: PieceView, victim: PieceView, event: MoveEvent): { mode: VaultPlan["mode"]; context: VaultContext } | null {
    if (attacker.kind !== "n") return null;
    const snapshot = this.controller.getSnapshot();
    const style = attackStyle(attacker.kind, attacker.arsenal);
    const context: VaultContext = {
      attacker: attacker.kind as VaultKind, victim: victim.kind as VaultKind, side: attacker.color, style,
      directed: event.combat?.kind === "sequence", summon: style === "spell" && this.summonFor(attacker, victim) !== null,
      menuBoard: this.menuPresentation || this.attract || this.silentBoard(), tactical: this.tactical,
      cinematics: this.captureCinematics && !this.introPlaying, reducedMotion: this.reducedMotion, quality: this.preset,
      // The capture itself is already the last move of the history.
      history: snapshot.moves.slice(0, -1).map(move => ({ color: move.color, kind: move.kind as VaultKind, capture: move.capture, captured: (move.captured ?? null) as VaultKind | null })),
      roll: this.showDice("knight vault")(),
    };
    const plan = planKnightVault(context);
    this.showTrace("knight-vault", { mode: plan.mode, reason: plan.reason, roll: +context.roll.toFixed(4) });
    return { mode: plan.mode, context };
  }

  /**
   * The Knight's vault under Reduced Motion (knightVaultPlan.ts `calm`): it has made its ordinary leap onto the square;
   * a slow, dim ring of its kingdom's light runs out round it and a few flakes settle. Nothing flashes, the camera and
   * the stone keep still, and the move does not wait on it.
   */
  private calmVault(attacker: PieceView, at: THREE.Vector3, context: VaultContext): void {
    const fx = this.vaultFx, plan = planKnightVault(context);
    if (!fx || plan.mode !== "calm") return;
    const look = VAULT_LOOK[this.spellArmy(attacker) as VaultArmy];
    const centre = new THREE.Vector3(at.x, BOARD_TOP, at.z);
    fx.beginRing(centre, look, { radius: VAULT_RING_RADIUS * 0.8, seconds: plan.ring.to - plan.ring.from, calm: true });
    fx.swirl(centre, plan.fx.ringFlakes, look, this.flourishSeed("vault calm"), { calm: true, radius: 0.32, seconds: 0.3 });
  }

  /**
   * A Knight's signature finisher (finisher/knightVaultPlan.ts): it charges in under a wide shot and whirls a slash
   * that staggers the piece, then, under a straight cut to a low moving shot, vaults up and over it, weapon held
   * overhead and ink wings sweeping up either side; two lines of blade-light cross at the top, it comes down behind
   * the piece turned back to it and drives its blade through. The board holds on the blow (combat/feel.ts) with the
   * flakes hanging in the air; a front shot holds its turn to the eye with the body falling behind it, and a wide shot
   * its kingdom's ring running out round its feet. The body dies by the ordinary paths (slay, its blood and wound),
   * the Claiming takes it as it takes any other, and the Knight walks onto the square it captured.
   */
  private async playKnightVault(
    attacker: PieceView, victim: PieceView, from: THREE.Vector3, to: THREE.Vector3, strikeSquare: SquareId, pair: CombatSession, context: VaultContext,
  ): Promise<void> {
    const revision = this.boardRevision;
    const fx = this.vaultFx;
    const army = this.spellArmy(attacker) as VaultArmy, look = VAULT_LOOK[army];
    const victimSpot = victim.container.position.clone();
    const reach = attacker.preferredContactReach() ?? TILE * .52;
    const { standoff, direction: blow, focus } = stageCombatPair(from, victimSpot, to, reach);
    const standing = [...this.pieces.values(), ...this.motion].filter(piece => piece !== attacker && piece !== victim && !piece.isSlain)
      .map(piece => ({ x: piece.container.position.x, z: piece.container.position.z, radius: TILE * .27, height: PIECE_HEIGHT[piece.kind] }));
    const landed = vaultLanding({ standoff, victim: victimSpot, reach, edge: TILE * 4 - .12, obstacles: standing }).point;
    const landing = new THREE.Vector3(landed.x, from.y, landed.z);
    const victimHeight = PIECE_HEIGHT[victim.kind] * Math.max(.2, victim.container.scale.y);
    const lift = vaultLift(victimHeight);
    // The Knight's own strike, fitted to the landing: held overhead through the air, driven in from the landing.
    const clip = attacker.hasCombatVariant("attack.strike") ? "attack.strike" : "attack";
    const info = attacker.combatClipInfo(clip);
    const timing = info ? strikeTiming(info.events, info.duration) : null;
    const plan = planKnightVault(context, timing?.lead);
    // Away from the Knight as it strikes from behind: the line the body is run through along and falls along.
    const through = victimSpot.clone().sub(landing).setY(0);
    if (through.lengthSq() < 1e-6) through.copy(blow);
    through.normalize();
    const across = new THREE.Vector3(-blow.z, 0, blow.x);
    const up = new THREE.Vector3(0, 1, 0);
    const pan = () => this.stereoPan(attacker.container.position);
    const cue = (name: string, volume: number) => { if (gambitSound.combatCueAllowed(name, { silentBoard: this.silentBoard() })) audio.cue(name, { volume, pan: pan() }); };
    const sound = (name: VaultCue) => {
      if (name === "whoosh.light") audio.bladeWhoosh({ pan: pan(), volume: .85, weight: .35 });
      else if (name === "stagger") cue("stagger", .9);
      else if (name === "effort.heavy") cue("effort.heavy", .8);
      else if (name === "whoosh.heavy") audio.bladeWhoosh({ pan: pan(), volume: 1, weight: .85 });
      else if (name === "blade-light") audio.bladeWhoosh({ pan: pan(), volume: .7, weight: .1 });
      else if (name === "ring") cue("whoosh.light", .5);
    };
    const flourish = this.flourishing();
    const hue = this.blowHue(attacker, victim);
    const seed = (salt: string) => this.flourishSeed(`vault ${salt}`);

    // The camera: every shot framed for this board now (knightVaultPlan.ts vaultShots), taken under the duel shot's own
    // conditions; a cut is a move of no length on the same timeline, so the way home is the one every fight takes.
    const taking = plan.camera ? this.riteCameraHome() : null;
    const shots = taking ? vaultShots({
      start: from, standoff, victim: victimSpot, landing, attackerHeight: PIECE_HEIGHT[attacker.kind], victimHeight, lift,
      home: taking.home, aspect: this.camera.aspect, fov: this.lensFov, boardTop: BOARD_TOP, radius: HALL_INNER_RADIUS - FOLLOW_WALL_MARGIN, obstacles: standing,
    }) : null;
    const camera = taking && shots ? this.takeRiteCamera(taking, this.riteView(shots.wide), VAULT_TIMING.easeIn) : null;
    // No rank crest floats in it (closeShotHolds).
    if (camera) this.castShot = camera;
    const owns = () => !!camera && this.duelCamera?.timeline === camera && !camera.leaving && !this.isStale(revision);
    const cut = (name: VaultShotName, ease: number) => { if (shots && owns() && !this.fatalityShot) camera!.moveTo(this.riteView(shots[name]), ease); };
    if (!camera) this.focusPoint(focus, .68);
    this.showTrace("knight-vault-play", { army, landing: [+landing.x.toFixed(3), +landing.z.toFixed(3)], lift: +lift.toFixed(3), clip, timing, camera: !!camera, total: plan.total });

    let blood: GorePlan | null = null, concluded = false, handed = false;
    const lights: SpellLight[] = [];
    const flareLight = (at: THREE.Vector3, colour: number, intensity: number, seconds: number) => {
      if (!plan.fx.light) return;
      const light = this.spellLights.acquire(colour, 4.5);
      if (!light) return;
      lights.push(light);
      light.set(at, intensity);
      void this.tweens.to({ duration: seconds, easing: Ease.outCubic, onUpdate: t => light.set(at, intensity * (1 - t)) }).then(() => light.release());
    };
    try {
      victim.braceForImpact(standoff);
      this.wake(victim);
      const feel = this.combatFeel.begin();
      const begun = pair.elapsedSeconds;
      // In on its own leap, coming up into its guard as it goes (as every charge does).
      await pair.stage("approach", () => Promise.all([
        this.glide(attacker, from, standoff, true, STRIKES.n.charge, (seconds, stepRate) => {
          const rise = Math.min(seconds, GUARD_RISE.steps / Math.max(stepRate, 1e-3), GUARD_RISE.seconds);
          attacker.raiseGuard({ delay: seconds - rise, fade: rise });
        }),
        victim.turnTowards(standoff, this.tweens, .3),
      ]));
      attacker.faceTowards(victimSpot);
      await this.letThemBeg(.3, .5);
      this.stopIfStale(revision);
      // Squared up in its guard until the reference's lead-in has run (VAULT_TIMING.leadIn): the leap and the plea count.
      await pair.wait(Math.max(0, VAULT_TIMING.leadIn - (pair.elapsedSeconds - begun)));
      if (this.isStale(revision)) throw new CombatCancelled();
      const t0 = pair.elapsedSeconds;
      const until = (at: number) => pair.wait(Math.max(0, t0 + at - pair.elapsedSeconds));

      // ---- the whirl
      await pair.stage("anticipate", async () => {
        sound("whoosh.light");
        const spin = plan.spin.to - plan.spin.from;
        if (timing && info) attacker.playUpper(clip, { owner: "vault", fade: .08, from: timing.hold, hold: Math.min(info.duration, timing.contact + .05), rate: (timing.contact - timing.hold) / (spin * .7) });
        const facing = blow.clone();
        void this.tweens.to({
          duration: spin, easing: Ease.inOutCubic,
          onUpdate: t => { if (!attacker.isSlain) attacker.setFacing(facing.copy(blow).applyAxisAngle(up, Math.PI * 2 * t), false); },
        });
        if (feel) this.combatFeel.swing(attacker, spin * .8, .04, .8);
        // Its crescent of light round it, through the piece (vfx/flourish).
        const chest = attacker.combatPoint(new THREE.Vector3());
        flourish?.slash(`${revision}:vault-spin`, chest.clone().setY(chest.y + .05), across.clone().negate(), blow, army,
          { radius: .66, thickness: .3, sweep: 5.4, seconds: spin * .72 }, seed("spin"), hue);
        await until(plan.staggerAt);
        // The piece reels from it: struck, not killed.
        sound("stagger");
        victim.takeHit(blow, .55);
        const struck = victim.combatPoint(new THREE.Vector3());
        if (flourish) flourish.shatter(struck, { x: victimSpot.x, y: BOARD_TOP, z: victimSpot.z }, blow, army, .65, seed("stagger"), this.camera.position, hue);
        fx?.spray(struck, blow, plan.fx.staggerFlakes, look, seed("stagger flakes"), { speed: 1.7, life: 1 });
        if (plan.fx.shake) this.shake.add(.05);
        this.stirAir("clash", struck.x, struck.y, struck.z, .7);
        await until(plan.spin.to);
      });

      // ---- the vault
      await pair.stage("strike", async () => {
        attacker.setFacing(blow, false);
        await until(plan.crouch.from);
        sound("effort.heavy");
        // The spring loads: knees down, weapon going up overhead (its strike's wind-up, held, over whatever the legs do).
        const crouch = plan.crouch.to - plan.crouch.from;
        void this.tweens.to({ duration: crouch, easing: Ease.outCubic, onUpdate: t => attacker.setSquash(.7 * t) });
        if (timing) attacker.playUpper(clip, { owner: "vault", fade: .12, from: 0, hold: timing.hold, rate: Math.max(.6, timing.hold / (crouch + .22)) });
        await until(plan.crouch.from + .04);
        cut("vault", 0);
        await until(plan.vault.from);
        attacker.setSquash(0);
        sound("whoosh.heavy");
        cut("drift", plan.apexAt - plan.vault.from);
        const seconds = plan.vault.to - plan.vault.from;
        attacker.setAirborne(true);
        const stride = await this.armStride(attacker, "run");
        this.stopIfStale(revision);
        if (stride) attacker.startMarch("run", 3.2);
        // Two strokes of ink sweep up either side of it (finisher/knightVaultVfx.ts).
        if (plan.fx.wings) fx?.beginWings(out => attacker.isSlain ? null : attacker.combatPoint(out), look, seconds * .8);
        // Streaks of light across it as it flies (the match's dice place them; their number is the preset's).
        const dice = this.showDice("vault streaks");
        const path = (u: number) => {
          const pose = vaultPose(u, lift);
          return standoff.clone().lerp(landing, pose.progress).setY(from.y + pose.height + PIECE_HEIGHT[attacker.kind] * .6);
        };
        for (let i = 0; i < plan.fx.streaks; i += 1) {
          const delay = seconds * (.08 + .72 * (i + dice() * .6) / Math.max(1, plan.fx.streaks));
          const centre = path(Math.min(1, delay / seconds + .06));
          const angle = (dice() - .5) * 1.4;
          const direction = across.clone().multiplyScalar(Math.cos(angle)).addScaledVector(up, Math.sin(angle)).addScaledVector(blow, (dice() - .5) * .6).normalize();
          const length = .9 + dice() * .8;
          const offset = direction.clone().multiplyScalar((dice() - .5) * .4).addScaledVector(up, (dice() - .5) * .5);
          fx?.streak(centre.clone().add(offset).addScaledVector(direction, -length / 2), centre.clone().add(offset).addScaledVector(direction, length / 2), look,
            { width: .02 + dice() * .016, life: .16 + dice() * .1, delay });
        }
        const facing = blow.clone();
        const flight = this.tweens.to({
          duration: seconds, easing: Ease.linear,
          onUpdate: u => {
            if (attacker.isSlain) return;
            const pose = vaultPose(u, lift);
            attacker.container.position.lerpVectors(standoff, landing, pose.progress);
            attacker.container.position.y = from.y + pose.height;
            // Arched back over the top, and turned round on the way down to face the piece it lands behind.
            attacker.setStrikeTilt(-.3 * pose.arch);
            attacker.setFacing(facing.copy(blow).applyAxisAngle(up, Math.PI * pose.turn), false);
          },
        });
        await until(plan.crossAt);
        // ---- rising: two blades of light cross in an X; the camera cuts to the close shot over the strike after the top.
        sound("blade-light");
        const top = attacker.combatPoint(new THREE.Vector3()).addScaledVector(up, .3);
        const eye = shots && owns() ? new THREE.Vector3(shots.drift.position.x, shots.drift.position.y, shots.drift.position.z) : this.camera.position.clone();
        if (plan.fx.cross) fx?.cross(top, eye, look, { size: 1.5, life: .36 });
        if (plan.fx.flash) this.effects.spawnFlash(top, 1.5, .14, look.core);
        flareLight(top, look.edge, 3.2, .4);
        // On the way down, the cut to the close shot over the strike.
        await until(plan.apexAt + VAULT_TIMING.strikeCut);
        cut("strike", 0);
        await flight;
        this.stopIfStale(revision);
        await until(plan.landAt);
        if (this.isStale(revision)) throw new CombatCancelled();
        // ---- down behind it, and the blade driven in.
        attacker.container.position.copy(landing);
        attacker.setAirborne(false);
        attacker.stopMarch(.08);
        attacker.setStrikeTilt(0);
        fx?.endWings(.18);
        attacker.faceTowards(victimSpot);
        this.woodKnock(attacker, landing, .8);
        this.landingSteps(attacker, landing, .8);
        this.effects.spawnBurst(landing.clone().setY(BOARD_TOP + .06), 0xd9bd8e, 8, { speed: 1, life: .4 });
        this.stirAir("land", landing.x, BOARD_TOP, landing.z, .9);
        if (plan.fx.shake) this.shake.add(.04);
        if (timing && attacker.hasCombatVariant(clip)) {
          attacker.playVariant(clip, timing.rate, .1, timing.hold);
          // Driven in where it stands: the clip's own step is given back to the pelvis, not taken across the stone.
          attacker.haltTravel();
        } else if (attacker.hasClip("attack")) attacker.playAttack({ seconds: Math.max(.3, (plan.strikeAt - plan.landAt) / .45), impactAt: .45 });
        if (feel) { this.combatFeel.swing(attacker, plan.strikeAt - plan.landAt + .1, 0, 1); this.combatFeel.glint(attacker, .55, 0); }
        await until(plan.strikeAt);
      });

      // ---- the blow: the ordinary kill, its blood and its hit-stop, and the flakes hanging in it.
      await pair.stage("contact", () => {
        const profile: StrikeProfile = { ...STRIKES.n, slash: null, wake: false, aftershock: 0 };
        blood = this.drawBlood({ seed: combatSeed(this.controller.getSnapshot().sanList, "vault") }, attacker, victim, through, profile.power, false);
        this.bleeding = blood?.sprays.length ? victim : null;
        this.meleeContact(attacker, victim, victimSpot, landing, through, strikeSquare, profile, false, blood?.silent === null);
        this.strikeSound(attacker.kind, this.stereoPan(victimSpot), .95);
        const entered = blood?.wound?.point;
        const wound = entered ? new THREE.Vector3(entered.x, entered.y, entered.z) : this.chestWound(victim, through);
        this.fatalityBlow(victim, attacker, wound, through);
        this.flourishKill(null, attacker, victim, entered ? wound : null, through, profile.power);
        // The spray of flakes out of the far side of the body, drifting: it hangs in the hit-stop.
        fx?.spray(victim.combatPoint(new THREE.Vector3()), through, plan.fx.sprayFlakes, look, seed("spray"), { speed: 2.6, life: 1.5, drag: 3.2, gravity: .55 });
        flareLight(victim.combatPoint(new THREE.Vector3()), look.core, 2.2, .3);
      });
      const falling = this.slay(victim, through, true, pair, false, () => {
        if (this.isStale(revision) || !blood) return;
        const at = victim.combatPoint(new THREE.Vector3());
        this.gore?.land(blood.impactId, { x: at.x, z: at.z });
      });
      falling.catch(() => undefined);

      await pair.stage("fall", async () => {
        // ---- the pose: wrenched free, turned to the eye, the body falling behind it.
        await until(plan.pose.from);
        cut("pose", 0);
        const eye = shots ? new THREE.Vector3(shots.pose.position.x, 0, shots.pose.position.z) : this.camera.position.clone().setY(0);
        attacker.playIdle(.45);
        // To the eye, and a little past it to its own left, so its sword side comes forward and its shield does not
        // fill the frame (a figure faces +z with its left hand at +x: up crossed with its facing).
        const toEye = eye.clone().sub(landing).setY(0);
        if (toEye.lengthSq() > 1e-6) {
          toEye.normalize();
          const left = new THREE.Vector3().crossVectors(up, toEye);
          void attacker.turnTowards(landing.clone().add(toEye.addScaledVector(left, .55)), this.tweens, .42);
        }
        void this.drawUp(attacker, .6);
        // ---- the ring: back wide, flakes swirl at its feet and its light runs out round it. A fatality's close shot on
        // the wound, if one took the camera, is let finish first.
        await until(plan.ring.from);
        for (let waited = 0; this.fatalityShot && waited < 3; waited += .1) await pair.wait(.1);
        cut("ring", 0);
        const feet = new THREE.Vector3(landing.x, BOARD_TOP, landing.z);
        fx?.swirl(feet, plan.fx.ringFlakes, look, seed("swirl"), { seconds: plan.swirl.to - plan.swirl.from, radius: .48 });
        await until(plan.expand.from);
        sound("ring");
        fx?.beginRing(feet, look, { radius: VAULT_RING_RADIUS, seconds: plan.expand.to - plan.expand.from });
        attacker.flareAura(1.3);
        await until(plan.release);
        await falling;
      });
      // The claim's shot takes over from this one where the claim will be watched; otherwise the view goes home now.
      if (camera && this.duelCamera?.timeline === camera && this.claimIsWatched(victim)) { this.claimShotOwed = victim; handed = true; }
      else if (camera && this.duelCamera?.timeline === camera) this.releaseDuelCamera();
      await pair.stage("advance", async () => {
        attacker.clearCombatTargets();
        await Promise.all([
          (async () => { if (blood) this.gore?.bodyGone((blood as GorePlan).impactId); await this.banish(victim, through); })(),
          this.glide(attacker, landing, to, false, 1.4),
        ]);
      });
      concluded = true;
    } finally {
      fx?.endWings(.15);
      this.flourish?.stopArc(`${revision}:vault-spin`);
      attacker.setAirborne(false); attacker.setStrikeTilt(0); attacker.setSquash(0);
      attacker.stopUpper(.2, { owner: "vault" });
      for (const light of lights) light.release();
      if (this.bleeding === victim) this.bleeding = null;
      // Cut short (Undo, reset, a failed stage): its blood does not outlive it, and nothing will take the shot over.
      if (!concluded && blood) this.gore?.cancel((blood as GorePlan).impactId);
      if (!concluded && this.claimShotOwed === victim) this.claimShotOwed = null;
      if (!handed && camera && this.duelCamera?.timeline === camera && !this.isStale(revision)) this.releaseDuelCamera();
    }
  }

  /**
   * Pawn takes Pawn as the Combat Director planned it (web/src/scene/combat):
   * the plan's timeline is run on this pair's session clock through
   * {@link EngineCombatStage}, whose host below is bound to the same private
   * beats the plain cinematic uses. Returns false, having touched nothing,
   * when either rig lacks the authored clips the plan is built on (an army
   * with no combat-v1 library): the caller then plays today's cinematic.
   */
  private async playDirectedCombat(
    plan: CombatPlan, attacker: PieceView, victim: PieceView, from: THREE.Vector3, to: THREE.Vector3,
    strikeSquare: SquareId, pair: CombatSession, revision: number,
  ): Promise<boolean> {
    const library = plan.animationLibrary ?? "crownfall-pawn-combat-1";
    if (!attacker.selectCombatLibrary(library) || !victim.selectCombatLibrary(library)) return false;
    if (missingClips(plan, { attacker: id => attacker.hasCombatVariant(id), defender: id => victim.hasCombatVariant(id) })) return false;
    const authored = plan;
    const vector = (point: { x: number; y: number; z: number }) => new THREE.Vector3(point.x, point.y, point.z);
    const victimSpot = victim.container.position.clone();
    // Where the killing blow is thrown from: the reach the finishing clip itself records at its contact frame on this rig.
    const reach = this.finisherReach(plan, attacker) ?? attacker.preferredContactReach() ?? TILE * .52;
    const { standoff, direction, focus } = stageCombatPair(from, victimSpot, to, reach);
    const references = { origin: from, defender: victimSpot, destination: to, standoff };
    const base = STRIKES[attacker.kind];
    const profile: StrikeProfile = { ...base, power: plan.power, hold: Math.max(base.hold, (plan.power - .65) * .14) };
    const blow = direction.clone();
    // What the killing blow left, if it drew blood: undone with the fight if the fight is cut short.
    let blood: GorePlan | null = null, concluded = false;
    const cameraRevision = this.conclusionCameraRevision;
    const ownsCamera = () => !this.isStale(revision) && cameraRevision === this.conclusionCameraRevision;
    // The lens punch is kept as degrees off rest, so it rides on whatever lens the duel shot holds.
    let punch = 0;
    const lens = (degrees: number) => {
      punch = degrees;
      if (!ownsCamera()) return;
      this.camera.fov = (this.duelCamera?.fov ?? this.lensFov) + punch; this.camera.updateProjectionMatrix();
    };
    // Browser checks may leave an array here to be told what the fight did, and when on its own clock.
    const sink = (globalThis as { __crownfallCombatTrace?: unknown[] & { clock?: () => number } }).__crownfallCombatTrace;
    let began = 0;
    let effectNumber = 0;
    // The killer's light arc: only its killing swing is drawn (see `phase` below).
    const trailIds = [`${revision}:attacker`] as const;
    let tracingWeapons = false;
    const stopTrails = () => { for (const id of trailIds) this.flourish?.stopArc(id); tracingWeapons = false; };
    const clock = () => Math.round((pair.elapsedSeconds - began) * 1000) / 1000;
    const trace = (what: string, detail?: unknown) => { if (Array.isArray(sink)) sink.push({ what, detail, at: clock(), sequence: authored.sequenceId }); };
    // The plan is fitted to these two rigs before anything moves: each weapon contact is swept from the poses the
    // clips will reach, the attacker's last step is set so the steel arrives, and the marker is put on that moment.
    const fighters = { attacker, defender: victim };
    /** Clip seconds at which each death clip puts the body on the floor, measured once before the fight. */
    const floors = new Map<string, number | null>();
    const authoredDeath = authored.resolution.death.prefer?.[0];
    if (authoredDeath) floors.set(authoredDeath, victim.deathFloorTime(authoredDeath));
    let forecasts: ContactForecast[] = [];
    try {
      const fitted = tuneContacts(authored, {
        clip: (actor, role, prefer) => {
          for (const id of prefer) { const held = fighters[actor].combatClipInfo(id); if (held) return held; }
          return role === "attack" || role === "death" ? fighters[actor].combatClipInfo(role) : null;
        },
        pose: (actor, clip, times) => fighters[actor].sampleCombatPose(clip, times),
        place: point => { const at = references[point.ref]; return { x: at.x + point.file * TILE, y: at.y, z: at.z - point.rank * TILE }; },
        tile: TILE,
      });
      plan = fitted.plan; forecasts = fitted.forecasts;
    } catch (error) { console.warn("[scene] contact fit failed; the fight plays as authored", error); }
    // Where the killing blow will land and what of the two bodies stands round it then: the duel shot is chosen to see it.
    let kill: DuelKill | undefined;
    try { kill = this.forecastKill(plan, forecasts, attacker, victim, references); } catch (error) { console.warn("[scene] kill forecast failed; the shot is chosen without it", error); }
    const figure = (piece: PieceView) => pieceFigure(piece, {
      tweens: this.tweens, onFoot: piece.hasAnimations,
      footfall: index => this.footfall(piece, GAITS[piece.kind], index, false),
    });
    // The combat feel layer (combat/feel.ts): hit-stops hold the whole board, the killing blow is wound up.
    const feel = this.combatFeel.begin();
    const blowLine = () => victim.container.position.clone().sub(attacker.container.position).setY(0);
    const host: StageHost = {
      ...(feel ? { feel: { worldHitstop: true, windup: true } } : {}),
      swing: (role, clip, options) => { if (feel && role === "attacker") this.combatFeel.swingClip(attacker, clip, options.rate, options.from, options.killing); },
      clock: { now: () => pair.elapsedSeconds, wait: seconds => pair.wait(seconds) },
      attacker: figure(attacker), defender: figure(victim),
      reference: ref => references[ref],
      offset: (file, rank) => ({ x: file * TILE, y: 0, z: -rank * TILE }),
      pan: at => this.stereoPan(vector(at)),
      sounds: {
        kill: sound => { trace("strike", sound.volume); this.strikeSound(attacker.kind, sound.pan, sound.volume); },
        // The exchange recordings are the sound agent's: used as soon as the mixer has them.
        // Both are feature-detected, so this builds before and after they land.
        cue: (name, sound) => {
          // Shield into shield: the stone under the two of them answers with a small puff, behind their feet.
          if (name === "bash.shield" && !this.combatKilled
            && this.playVfx("bash", this.onStone(this.vfxContact.copy(attacker.container.position).lerp(victim.container.position, .5)), null, VFX_SEAT.bash)) trace("vfx", "bash");
          // The menu board keeps steel and bodies and drops voices: a cue the rule
          // refuses counts as handled, so no stand-in sounds in its place.
          const allowed = (gambitSound as Record<string, unknown>)["combatCueAllowed"];
          if (typeof allowed === "function" && (allowed as (cue: string, context: { silentBoard: boolean }) => boolean)(name, { silentBoard: this.silentBoard() }) === false) return true;
          const mixer = audio as unknown as { cue?: (name: string, options: { volume: number; pan: number }) => unknown };
          return typeof mixer.cue === "function" && mixer.cue(name, sound) === true;
        },
        whoosh: sound => audio.bladeWhoosh({ pan: sound.pan, volume: sound.volume, weight: sound.weight }),
        bodyFall: sound => audio.bodyFall(sound.volume, victim.kind),
      },
      phase: (phase, marker) => {
        pair.phase = phase; trace("marker", marker);
        // The killer's steel is traced from the first beat but drawn only as the killing blow lands, as a crescent of light
        // along the swing that brought it home (vfx/flourish/arcs.ts): an arc on every step and parry would smear them all.
        if ((phase === "anticipate" || phase === "strike" || phase === "contact") && !tracingWeapons && !this.isStale(revision))
          tracingWeapons = this.traceKillingSwing(trailIds[0], attacker, victim);
        if (phase === "contact" && tracingWeapons) this.flourish?.revealArc(trailIds[0]);
        else if (phase === "fall" || phase === "advance") stopTrails();
      },
      // One effect per contact type (docs/play/CONTACT_VFX.md). This observation owns one of them: a blow that
      // glances off intact armour. A blow stopped on a shield or parried belongs to the block gate (`effect` below,
      // with its clash sound), a shield bash and the stone to the flipbooks, flesh to the Gore Director.
      contactResolved: event => {
        if (this.isStale(revision) || !event.to || !event.from || this.reducedMotion
          || event.fromAnchor !== "weaponTip" || (event.toAnchor !== "torso" && event.toAnchor !== "head")
          || !contactEvidenceUsable(event.from, event.to, false, event.facingGuard)) return;
        const target = event.toActor === "attacker" ? attacker : victim;
        const source = event.fromActor === "attacker" ? attacker : victim;
        const skins = this.factory.getSkins();
        let material: ContactMaterial | null = "flesh";
        // Authored Pawn rig tables distinguish intact armour from a breach.
        // Later piece classes need their own reviewed weapon/region bindings.
        if (source.kind === "p" && target.kind === "p") material = dryContactMaterial({
          attacker: { kind: source.kind, kingdom: skins[source.color], weapon: "spear" },
          defender: { kind: target.kind, kingdom: skins[target.color], shield: pawnCombatant(target.color, skins[target.color]).shield },
          power: plan.power, outcome: Math.abs(event.atSeconds - plan.markers.decisive) < 1e-6 ? "kill" : "glance",
          contact: { anchor: event.toAnchor },
        });
        // Flesh stays with the Gore Director, including armour-breach checks.
        if (!material || material === "flesh") return;
        const normal = vector(event.from).sub(vector(event.to));
        if (normal.lengthSq() < 1e-8) normal.copy(source.container.position).sub(target.container.position);
        this.effects.spawnContact({ id: `${revision}:${plan.record}:${event.id}`, seed: contactEventSeed(event.seed, event.id),
          point: event.to, normal, material, quality: this.preset, strength: 1, groundY: BOARD_TOP,
          reducedMotion: this.reducedMotion });
        this.stirAir("clash", event.to.x, event.to.y, event.to.z, .7);
        trace("material-contact", { id: event.id, material });
      },
      camera: (point, tightness, fov, duration, live) => {
        if (!ownsCamera()) return;
        this.focusPoint(vector(point), tightness);
        const start = punch, end = this.lensPunch(fov);
        if (duration <= 0) lens(end);
        else void this.tweens.to({ duration, easing: Ease.outCubic, onUpdate: t => { if (live()) lens(THREE.MathUtils.lerp(start, end, t)); } });
      },
      effect: (fx, at, strength, cue) => {
        const point = vector(at);
        if (fx === "sparks") {
          // A blow stopped on a shield, already passed by the stage's block gate (the steel was there; the clash
          // sound follows the same gate). One material response, by what stopped it: sparks and a glint off an
          // iron face, chips off a wooden one, and steel on steel for a Pawn with no shield, who parries.
          // (Steel struck anywhere else, which only the sequences no live capture plays yet ask for, sparks as steel.)
          const skins = this.factory.getSkins(), where = cue && "actor" in cue.where ? cue.where : null;
          const holder = where?.actor === "attacker" ? attacker : victim;
          const material: ContactMaterial | null = where && where.anchor !== "shieldFace" ? "steel"
            : (holder.kind === "p" ? pawnCombatant(holder.color, skins[holder.color]).shield : KINGDOM_SHIELD[skins[holder.color]]) ?? "steel";
          if (this.reducedMotion) return;
          const id = `${revision}:${plan.record}:block-${effectNumber++}`;
          const normal = (holder === victim ? attacker : victim).container.position.clone().sub(holder.container.position).setY(0);
          if (normal.lengthSq() < 1e-8) normal.set(0, 1, 0);
          if (material !== "wood") this.effects.spawnFlash(point, .9 * strength, .12);
          if (this.effects.spawnContact({ id, seed: contactEventSeed(plan.seed, id.slice(id.indexOf(":") + 1)), point: at, normal, material,
            quality: this.preset, strength, groundY: BOARD_TOP, reducedMotion: this.reducedMotion })) trace("material-contact", { id: "block", material });
          // The air takes the stopped blow whatever the shield is made of.
          this.stirAir("clash", point.x, point.y, point.z, strength);
          // The swing's trail ends on the shield (combat/feel.ts); the material contact above throws the sparks.
          if (feel) this.combatFeel.endSwing(attacker, .04);
          return;
        }
        if (fx === "flash" && !this.reducedMotion) this.effects.spawnFlash(point, 1.4 * strength, .16);
        else if (fx === "dust") {
          const id = `${revision}:${plan.record}:effect-${effectNumber++}`;
          // The new flipbook owns authored step dust where enabled. The small
          // deterministic surface pool is the existing renderer's bounded fallback.
          if (this.duelDustIsFlipbook()) { if (this.duelStepDust(point.x, point.z, strength)) trace("vfx", "dust"); return; }
          this.effects.spawnContact({ id, seed: contactEventSeed(plan.seed, id.slice(id.indexOf(':') + 1)),
            point: point.setY(BOARD_TOP + .02), normal: { x: 0, y: 1, z: 0 }, material: "stone", quality: this.preset,
            strength, groundY: BOARD_TOP, reducedMotion: this.reducedMotion });
          // (the flipbook's step above tells the air itself, in playVfx)
          this.stirAir("step", point.x, BOARD_TOP, point.z, strength);
        } else if (fx === "shake" && !this.reducedMotion) this.shake.add(strength);
        else if (fx === "hitstop") {
          // The feel layer holds the whole board, this fight's clock with it, and shudders the body that took the blow.
          const shape = feel ? this.combatFeel.impact("clash", victim, blowLine(), plan.power, attacker.kind) : null;
          if (shape) trace("feel", { blow: "clash", freeze: shape.freeze });
          else { attacker.holdContact(strength); victim.holdContact(strength); }
        }
      },
      impact: power => {
        // The killer has come round the shield: the blow travels the line they stand on now.
        const line = victim.container.position.clone().sub(attacker.container.position).setY(0);
        if (line.lengthSq() > 1e-6) blow.copy(line.normalize());
        // Which side of him it comes in on decides how he takes it and how he falls: never chance.
        const facing = victim.visual.getWorldDirection(new THREE.Vector3());
        const side = blowSide({ x: facing.x, z: facing.z }, { x: blow.x, z: blow.z });
        const reaction = directionalReaction(side.side, { hit: plan.resolution.hit.prefer?.[0] ?? "", death: plan.resolution.death.prefer?.[0] ?? "" }, id => victim.hasCombatVariant(id));
        const death = victim.combatClipInfo(reaction.death);
        // Timed to the moment the body is on the floor, which a clip that rolls on afterwards marks later.
        if (death && !floors.has(death.id)) floors.set(death.id, victim.deathFloorTime(death.id));
        const floor = death ? floors.get(death.id) ?? null : null;
        const timing = death ? deathTiming(floor === null ? death : { ...death, events: { ...death.events, land: floor } }, DIRECTED_FALL_SECONDS) : null;
        victim.setCombatReaction({
          fade: DIRECTED_BLEND, ...(reaction.hit ? { hit: reaction.hit } : {}), ...(reaction.death ? { death: reaction.death } : {}),
          ...(timing ? { deathRate: timing.rate, deathFrom: timing.from } : {}), ...(floor === null ? {} : { deathFloor: floor }), rootLimit: DEATH_WEIGHT.cap * TILE * .6,
        });
        this.combatKilled = true;
        trace("impact", power);
        trace("reaction", { side: side.side, degrees: Math.round(side.degrees), ...reaction, deathRate: timing?.rate, deathFrom: timing?.from });
        // Where the fit forecast the spear going in, if it found the torso: the wound and the spray start there.
        const struck = forecasts.find(item => item.id === "kill")?.after;
        blood = this.drawBlood(plan, attacker, victim, blow, power, false, struck && struck.hit && struck.anchor === "torso" ? struck : null);
        this.bleeding = blood?.sprays.length ? victim : null;
        if (blood) trace("gore", { impact: blood.impactId, silent: blood.silent, surface: blood.surface.material, stains: blood.stains.length });
        this.meleeContact(attacker, victim, victim.container.position.clone(), standoff, blow, strikeSquare, { ...profile, power }, false, blood?.silent === null);
        if (feel) trace("feel", { blow: "kill", power });
        if (ownsCamera()) this.duelCamera?.timeline.push();
        // A fatal kill holds its killing contact (fatality/): where the spear went in, along the line it travels.
        const entered = blood?.wound?.point;
        this.fatalityBlow(victim, attacker, entered ? vector(entered) : victim.combatPoint(new THREE.Vector3()).addScaledVector(blow, -0.04), blow);
        // The kill throws its flakes and chips, and its light arc parts round the wound (vfx/flourish).
        this.flourishKill(tracingWeapons ? trailIds[0] : null, attacker, victim, entered ? vector(entered) : null, blow, power);
      },
      fall: (silent, _resolution, down) => {
        trace("fall", silent);
        // The pool starts where the body lies when it lands, on the frame of the landing sound.
        const landed = () => {
          if (this.isStale(revision)) return;
          trace("landed"); down();
          if (!blood) return;
          const at = victim.combatPoint(new THREE.Vector3());
          this.gore?.land(blood.impactId, { x: at.x, z: at.z });
        };
        return this.slay(victim, blow, true, pair, silent, landed);
      },
      // The wound leaves with the body; the blood on the stone stays.
      clear: () => { if (this.isStale(revision)) throw new CombatCancelled(); trace("clear"); if (blood) this.gore?.bodyGone(blood.impactId); return this.banish(victim, blow); },
      // The body is down: the camera goes home, or straight round to whoever moves next, as the killer takes the square.
      claim: () => {
        trace("claim");
        if (ownsCamera()) {
          // A look at the body first, near enough to see its wound (fatality/fatalityPlan.ts WOUND_LOOK); its back
          // beat sends the camera home where nothing takes it over.
          const looked = this.lookAtWound(victim, attacker);
          if (looked) trace("look");
          // The camera stays with a body the sorcerer is about to be seen taking, while it comes to rest: the
          // claim's shot takes over from this one instead of the view going home and coming straight back.
          if (this.duelCamera && !this.duelCamera.rite && this.claimIsWatched(victim)) this.claimShotOwed = victim;
          else if (!looked) this.releaseDuelCamera();
        }
        return this.glide(attacker, attacker.container.position.clone(), to, false, DIRECTED_CLAIM_HURRY);
      },
      landing: () => victim.deathPlan()?.land ?? NaN,
      hurry: () => { trace("hurry"); this.combatHurry = SKIP_HURRY; },
      finish: () => {
        attacker.clearCombatTargets();
        attacker.setStrikeTilt(0);
        const start = punch;
        void this.tweens.to({ duration: .45, easing: Ease.outCubic, onUpdate: t => lens(THREE.MathUtils.lerp(start, 0, t)) });
      },
    };
    // Both strides in hand before the fight's clock starts, as glide would fetch them.
    await Promise.all([this.armStride(attacker, "run"), this.armStride(attacker, "walk")]);
    if (this.isStale(revision)) throw new CombatCancelled();
    if (ownsCamera()) this.focusPoint(focus, .68);
    victim.braceForImpact(standoff);
    // The defender wakes as its killer comes for it, and begs; the fight gives it
    // until the killing blow, and the killer holds a moment longer if it needs it:
    // but only a moment, the fight itself is the wait.
    this.wake(victim);
    await this.letThemBeg(plan.markers.decisive, DIRECTED_PLEA_HOLD);
    if (this.isStale(revision)) throw new CombatCancelled();
    const stage = new EngineCombatStage(host), control = new CombatControl();
    this.combatControl = control; this.combatKilled = false; this.combatHurry = 1;
    this.callbacks.onCombatActive?.(true);
    // Both are alive to each other from here: eyes, breath and weight follow the opponent until one is down.
    attacker.engageDuel(victim); victim.engageDuel(attacker);
    // Step dust: each fighter's feet report where they come down, and one faint puff answers, at most every STEP_DUST_GAP.
    this.vfxDuelVictim = victim;
    const steps = (last = -1) => (x: number, z: number) => {
      const now = pair.elapsedSeconds;
      if (now - last >= STEP_DUST_GAP && this.duelStepDust(x, z)) { last = now; trace("vfx", "step"); }
    };
    attacker.onFootDown(steps()); victim.onFootDown(steps());
    // The killer smears as it lunges into the blow (vfx/flourish): faint brush strokes behind it, gone as the blow lands.
    this.flourishing()?.beginSmear(`${revision}:lunge`, out => attacker.combatPoint(out), this.spellArmy(attacker), this.flourishSeed("smear"));
    began = pair.elapsedSeconds;
    if (Array.isArray(sink)) sink.clock = clock;
    trace("begin", plan.record);
    trace("forecast", forecasts);
    if (ownsCamera()) {
      const shot = this.beginDuelCamera(attacker, victim, from, standoff, victimSpot, direction, () => punch, plan.markers.clash, kill);
      if (shot) trace("camera", shot);
    }
    try {
      const outcome = await runCombat(plan, stage, control);
      if (outcome.status === "fallback") return false;
      if (outcome.status === "cancelled") throw new CombatCancelled();
      // The killer takes the square as soon as the body is on the floor; the body leaves it behind him.
      await stage.aftermath();
      if (this.isStale(revision)) throw new CombatCancelled();
      this.clearing.set(victim, stage.cleared());
      this.combatDiagnostics = {
        sequence: plan.sequenceId, record: plan.record, status: outcome.status, seconds: outcome.elapsed,
        sounded: stage.status.sounded.map(item => ({ cue: item.cue, at: item.at })), contacts: outcome.contacts,
        rates: outcome.rates ?? [], forecasts, blocks: stage.status.blocks.map(item => ({ ...item })),
      };
      trace("done", this.combatDiagnostics);
      concluded = true;
    } finally {
      stopTrails();
      // Cut short (Undo, reset, a failed stage): this fight's blood does not outlive it.
      if (!concluded && blood) this.gore?.cancel((blood as GorePlan).impactId);
      attacker.onFootDown(null); victim.onFootDown(null);
      if (this.vfxDuelVictim === victim) this.vfxDuelVictim = null;
      if (this.bleeding === victim) this.bleeding = null;
      if (this.combatControl === control) { this.combatControl = null; this.combatKilled = false; this.callbacks.onCombatActive?.(false); }
      // Cut short, nothing will come to take the shot over.
      if (!concluded && this.claimShotOwed === victim) this.claimShotOwed = null;
      // However the fight ended, a shot it still holds goes home, unless it is kept for the claim. (A replaced
      // board has already taken it back.)
      if (ownsCamera() && !this.duelCamera?.rite && this.claimShotOwed !== victim) this.duelCamera?.timeline.release();
    }
    if (!victim.isSlain) await this.crumble(victim, from);
    return true;
  }

  /**
   * The killing blow as the fitted plan forecasts it, for the duel camera: the
   * point the weapon enters and, as segments with a radius, the killer's trunk,
   * shield and weapon arm at the finishing clip's contact frame and the
   * victim's own trunk. Both stand where the plan's last moves before the blow
   * put them. Undefined when the rigs cannot be sampled.
   */
  private forecastKill(
    plan: CombatPlan, forecasts: readonly ContactForecast[], attacker: PieceView, victim: PieceView,
    references: Record<"origin" | "defender" | "destination" | "standoff", THREE.Vector3>,
  ): DuelKill | undefined {
    const decisive = plan.markers.decisive;
    const stand = (cues: CombatPlan["attacker"], rest: THREE.Vector3) => {
      let spot = { x: rest.x, y: rest.y, z: rest.z };
      for (const cue of cues) if (cue.do === "move" && cue.at < decisive - 1e-6) { const at = references[cue.to.ref]; spot = { x: at.x + cue.to.file * TILE, y: at.y, z: at.z - cue.to.rank * TILE }; }
      return spot;
    };
    const killer = stand(plan.attacker, references.standoff), struck = stand(plan.defender, references.defender);
    let finisher: { id: string; time: number } | null = null;
    for (const cue of plan.attacker) {
      if (cue.do !== "clip" || cue.clip.role !== "attack" || !cue.sync || Math.abs(cue.sync.to - decisive) > .12 * plan.timeScale) continue;
      const id = cue.clip.prefer?.find(name => attacker.hasCombatVariant(name)), info = id ? attacker.combatClipInfo(id) : null;
      const time = info ? cue.sync.events.map(name => info.events[name]).find(value => value !== undefined) : undefined;
      if (id && time !== undefined) finisher = { id, time };
    }
    const blow = finisher as { id: string; time: number } | null;
    const read = forecasts.find(item => item.id === "kill")?.stance;
    const pose = blow ? attacker.sampleCombatPose(blow.id, [blow.time])[0] : undefined;
    // The victim as the fit read him: in the clip he will be in when the blow lands.
    const stance = (read?.clip ? victim.sampleCombatPose(read.clip, [read.time])[0] : undefined) ?? victim.sampleCombatPose(null, [0])[0];
    if (!pose || !stance) return undefined;
    const line = { x: struck.x - killer.x, z: struck.z - killer.z }, back = { x: -line.x, z: -line.z };
    if (Math.hypot(line.x, line.z) < 1e-6) return undefined;
    const his = (local: { x: number; y: number; z: number }) => placeLocal(local, killer, line);
    const hers = (local: { x: number; y: number; z: number }) => placeLocal(local, struck, back);
    const height = PIECE_HEIGHT[attacker.kind], tall = PIECE_HEIGHT[victim.kind];
    const bodies: DuelKill["bodies"][number][] = [
      // His trunk and head, the arm behind the spear (the left of a figure is +x, so the spear shoulder is at -x), and his shield.
      { a: his({ x: pose.torso.x, y: height * .15, z: pose.torso.z }), b: his({ x: pose.torso.x, y: height * .95, z: pose.torso.z }), radius: height * .2 },
      { a: his({ x: pose.torso.x - height * .16, y: pose.torso.y + height * .12, z: pose.torso.z }), b: his(pose.grip), radius: height * .09 },
      ...(pose.shield && pose.shieldNormal ? [{ a: his(pose.shield), b: his(pose.shield), radius: CONTACT_FIT.shieldRadius * 1.15, normal: turnLocal(pose.shieldNormal, line) }] : []),
      // The victim's own body hides a wound on its far side, and so does the shield he is still holding.
      { a: hers({ x: stance.torso.x, y: tall * .15, z: stance.torso.z }), b: hers({ x: stance.torso.x, y: tall * .95, z: stance.torso.z }), radius: tall * .1 },
      // (Drawn larger than the disc a blow is stopped by: its rim and what hangs from it hide the wound as well.)
      ...(stance.shield && stance.shieldNormal ? [{ a: hers(stance.shield), b: hers(stance.shield), radius: CONTACT_FIT.shieldRadius * 1.7, normal: turnLocal(stance.shieldNormal, back) }] : []),
    ];
    const swept = forecasts.find(item => item.id === "kill")?.after;
    const chest = hers(stance.torso), length = Math.hypot(line.x, line.z);
    // Without a sweep: the near face of the chest, on the line the blow travels.
    const contact = swept && swept.hit && swept.anchor === "torso" ? { x: swept.point.x, y: swept.point.y, z: swept.point.z }
      : { x: chest.x - line.x / length * tall * .12, y: chest.y, z: chest.z - line.z / length * tall * .12 };
    return { contact, bodies, victimAt: struck };
  }

  /**
   * How far from the defender the attacker stands for the killing blow: the
   * weapon tip's distance ahead of the figure at the finishing clip's `contact`
   * frame, read from the rig itself, less the depth the steel goes in. Null
   * when the plan has no authored finisher on this rig.
   */
  private finisherReach(plan: CombatPlan, attacker: PieceView): number | null {
    let reach: number | null = null;
    for (const cue of plan.attacker) {
      if (cue.do !== "clip" || cue.clip.role !== "attack" || !cue.sync || Math.abs(cue.sync.to - plan.markers.decisive) > .12 * plan.timeScale) continue;
      const id = cue.clip.prefer?.find(name => attacker.hasCombatVariant(name));
      const info = id ? attacker.combatClipInfo(id) : null;
      const moment = info ? cue.sync.events.map(name => info.events[name]).find(time => time !== undefined) : undefined;
      if (!id || moment === undefined) continue;
      const pose = attacker.sampleCombatPose(id, [moment])[0];
      if (pose && Number.isFinite(pose.tip.z) && pose.tip.z > TILE * .25) reach = pose.tip.z + CONTACT_FIT.torsoRadius + CONTACT_FIT.torsoDepth;
    }
    return reach;
  }

  /**
   * The killing blow of a directed Pawn duel, handed to the Gore Director: spray,
   * wound and stains from this frame, the pool when the body lands. Presentation
   * only. Other pieces get their own injury styles in later milestones.
   */
  private drawBlood(
    plan: Pick<CombatPlan, "seed">, attacker: PieceView, victim: PieceView, blow: THREE.Vector3, power: number, still = false,
    struck: { point: { x: number; y: number; z: number }; normal: { x: number; y: number; z: number } } | null = null,
  ): GorePlan | null {
    if (!this.gore || blow.lengthSq() < 1e-8) return null;
    const skins = this.factory.getSkins();
    const anchors = victim.goreAnchors(), dir = blow.clone().setY(0).normalize();
    // A Pawn duel is fought with the spear (Korvenia's line fixes bayonets for it); a rank duel with the figure's own
    // steel, as killWeapon (gore/killMoment.ts) names it for the tiers.
    const weapon = attacker.kind === "p" ? "spear" : weaponOf(attacker.arsenal, attacker.kind);
    const surface = resolveImpact({
      attacker: { kind: attacker.kind, kingdom: skins[attacker.color], weapon }, defender: { kind: victim.kind, kingdom: skins[victim.color] },
      power, outcome: "kill", contact: { anchor: "torso" },
    });
    // The torso bone lies inside the body: the wound sits on the surface the spear came through.
    const torso = victim.combatPoint(new THREE.Vector3());
    const point = torso.clone().addScaledVector(dir, -surface.surfaceOffset * TILE);
    const normal = dir.clone().negate();
    // The swept-contact forecast is made before the fight: it is used while the body is still about where it was read.
    if (struck && torso.distanceTo(struck.point as THREE.Vector3) < TILE * 0.3) {
      point.set(struck.point.x, struck.point.y, struck.point.z);
      const out = new THREE.Vector3(struck.normal.x, struck.normal.y, struck.normal.z);
      if (out.lengthSq() > 1e-6 && out.normalize().dot(normal) > 0.2) normal.copy(out);
    }
    const ply = this.controller.getSnapshot().sanList.length;
    const blood = this.gore.begin({
      impactId: impactIdOf(ply, "kill"), seed: goreSeed(plan.seed, "kill"), ply,
      attacker: { kind: attacker.kind, kingdom: skins[attacker.color], weapon },
      defender: { kind: victim.kind, kingdom: skins[victim.color] },
      contact: { point, normal, direction: dir, anchor: "torso" },
      // Only a directed duel is drawn here, and every one ends in the kill: the Pawns' and the ranks' alike.
      power, outcome: "kill", killer: attacker.combatPoint(new THREE.Vector3()),
      moment: this.killMoment(victim, "melee"),
      // With no fight on screen there is nothing for a spray to be in step with.
      flags: this.goreFlags(still),
    }, still ? {} : {
      wound: anchors.torso, weapon: attacker.goreAnchors().weapon, defender: victim.container, attacker: attacker.container,
      // Marks on the spear face the side the player is watching from.
      facing: this.camera.position.clone().sub(point).normalize(),
    });
    if (still && blood.silent === null) {
      // No death to wait for: the pool is under where the figure stood, and nothing rides on a body that crumbles.
      this.gore.land(blood.impactId, { x: victim.container.position.x, z: victim.container.position.z });
      this.gore.bodyGone(blood.impactId);
    }
    return blood;
  }

  /**
   * What kind of kill this is, for the gore tier (gore/goreTiers.ts): how it is dealt, whether the capture mates,
   * and whether the victim was the last piece its side had beside its King. Read off the position the capture made.
   */
  private killMoment(victim: PieceView, style: KillMoment["style"]): Pick<KillMoment, "style" | "mate" | "last"> {
    const snapshot = this.controller.getSnapshot();
    const mate = snapshot.status === "over" && snapshot.result?.reason === "checkmate";
    const last = !this.controller.getBoard().some(entry => entry.color === victim.color && entry.kind !== "k");
    return { style, mate, last };
  }

  /** The flags every gore event carries. `still`: no fight is on screen, so nothing is in step with a spray. */
  private goreFlags(still = false): GoreEvent["flags"] {
    return { menuBoard: this.silentBoard(), reducedMotion: this.reducedMotion || still, tactical: this.tactical, captureCinematics: this.captureCinematics };
  }

  /**
   * The ball's wound: drawn through the gore system as a killing blow (spray, a wound where it went in, stains,
   * and a pool where the body comes to rest), which answers to the Violence setting itself. A ball that does not
   * get through (a pistol on plate) draws none. Returns the impact, for the pool and the banishing.
   */
  private gunWound(attacker: PieceView, victim: PieceView, aim: THREE.Vector3, power: number, roundShot: boolean): string | null {
    if (!this.gore) return null;
    const flat = aim.clone().setY(0);
    if (flat.lengthSq() < 1e-8) return null;
    flat.normalize();
    const skins = this.factory.getSkins();
    const shooter = { kind: attacker.kind, kingdom: skins[attacker.color], weapon: "musket" as const };
    const struck = { kind: victim.kind, kingdom: skins[victim.color] };
    const surface = resolveImpact({ attacker: shooter, defender: struck, power, outcome: "kill", contact: { anchor: "torso" } });
    // The near face of the chest, toward the gun: the torso bone lies inside the body.
    const point = victim.combatPoint(new THREE.Vector3()).addScaledVector(flat, -surface.surfaceOffset * TILE);
    const ply = this.controller.getSnapshot().sanList.length;
    const plan = this.gore.begin({
      impactId: impactIdOf(ply, "shot"), seed: goreSeed(ply * 7919 + 17, "shot"), ply,
      attacker: shooter, defender: struck,
      // A ball goes in small; solid shot tears through.
      wound: roundShot ? "burst" : "pierce",
      moment: this.killMoment(victim, "gun"),
      contact: { point, normal: flat.clone().negate(), direction: flat, anchor: "torso" },
      power: THREE.MathUtils.clamp(power, 0, 2), outcome: "kill", killer: attacker.combatPoint(new THREE.Vector3()),
      flags: this.goreFlags(),
    }, { wound: victim.goreAnchors().torso, defender: victim.container, facing: this.camera.position.clone().sub(point).normalize() });
    return plan.silent === null ? plan.impactId : null;
  }

  /**
   * The burn an explosion leaves where it met the stone (vfx/scorchPlan.ts): a spell's by the caster's army,
   * the field gun's crater. `from` is where the blast came from, so the soot is thrown on past `at`. Seeded
   * from the move record, as the fights are, so the same game leaves the same mark; filed under the ply, so
   * Undo takes it back. `still` lays it cold (no fight was shown). `sanList` is the record it is filed under: the
   * board's now, or the move's own for a mark laid late (an ice spell's, as its ice melts). Allocates nothing.
   */
  private burnStone(source: ScorchSource, army: ArmySkinId, at: THREE.Vector3, from: THREE.Vector3, power: number, ring = 0, still = false,
    sanList: readonly string[] = this.controller.getSnapshot().sanList): void {
    const scorch = this.scorch;
    if (!scorch || this.disposed) return;
    const event = this.scorchEvent, flags = this.vfxFlagsNow();
    event.seed = scorchSeed(combatSeed(sanList)); event.ply = sanList.length;
    event.source = source; event.army = army; event.power = power; event.ring = ring;
    event.at.x = at.x; event.at.z = at.z;
    event.direction.x = at.x - from.x; event.direction.z = at.z - from.z;
    event.flags.quality = flags.quality; event.flags.tactical = flags.tactical; event.flags.menuBoard = flags.menuBoard;
    event.flags.reducedMotion = flags.reducedMotion || still;
    scorch.burn(event);
  }

  /** The burn marks on the board now, for browser checks: none after an Undo of the only spell capture. */
  getScorchStats(): ScorchStats | null { return this.scorch ? this.scorch.stats : null; }

  /** What the Knight's vault has in the air now, for browser checks: all zero once a board is rebuilt. */
  getVaultStats(): VaultFxStats | null { return this.vaultFx ? this.vaultFx.stats : null; }

  /** How much blood a capture shows: minimal, cinematic or full. Applies from the next capture. */
  /**
   * Plays the flipbook effect a moment of a capture gets (vfx/wiring.ts decides which, and how much, from the
   * preset, reduced motion, the tactical map and the menu's board). `seat` moves the spawn point along the
   * floor away from the camera (towards it when negative), so dust stands behind its figure and a burst in
   * front of it. Returns whether anything was played, so the caller can thin the procedural smoke it replaces.
   * Allocates nothing.
   */
  private playVfx(moment: VfxMoment, at: THREE.Vector3, detail: VfxDetail | null = null, seat = 0, direction: THREE.Vector3 | null = null, delay = 0, tint: number | null = null): boolean {
    // The arena's air is told of the moment whether or not this preset draws a flipbook for it, on the same delay.
    const air = AIR_OF_MOMENT[moment];
    if (air) this.stirAir(air, at.x, at.y, at.z, detail?.power ?? 1, delay);
    const vfx = this.vfx;
    if (!vfx || this.disposed) return false;
    const cue = vfxCue(moment, this.vfxFlagsNow(), detail ?? undefined);
    if (!cue) return false;
    const point = this.vfxAt.copy(at);
    if (seat !== 0) seatFromEye(point, this.camera.position, seat);
    if (moment === "step" || moment === "bash") {
      // The duel camera is close in on the blow: no dust between the lens and where the spear goes in.
      const victim = this.vfxDuelVictim;
      if (victim && this.duelCamera && hidesContact(this.camera.position, victim.combatPoint(this.vfxContact), point, VFX_RECIPES[cue.recipe][0].size * cue.scale)) return false;
    }
    const options = this.vfxOptions;
    options.scale = cue.scale; options.alpha = cue.alpha; options.parts = cue.parts; options.still = cue.still;
    options.life = cue.life > 0 ? cue.life : undefined;
    options.direction = direction ?? undefined; options.delay = delay;
    // A livery colour gives its hue, not its darkness: the scene's light (below) decides how bright the smoke is.
    // Dust takes its shade from the stone it rises from instead (wiring.ts dustShade): darker over a pale square.
    const shade = dustShade(cue.recipe, stoneUnder(point.x, point.z, TILE));
    if (shade) this.vfxTint.setRGB(shade[0], shade[1], shade[2]);
    else if (tint !== null) { const hue = this.vfxTint.setHex(tint); hue.multiplyScalar(1 / Math.max(hue.r, hue.g, hue.b, 1e-3)); }
    options.tint = shade || tint !== null ? this.vfxTint : undefined;
    // A spell burst comes in its army's colour (vfx/wiring.ts): every layer of it, in place of the recipe's own.
    options.colour = cue.colour ? this.vfxColour.setRGB(cue.colour[0], cue.colour[1], cue.colour[2]) : undefined;
    // Seated in this arena's light: read at the spawn, so a brightness change or a new arena is followed.
    options.light = vfxLight(this.displayExposure(), moment);
    options.glow = vfxGlow(this.displayExposure());
    vfx.play(cue.recipe, point, options);
    return true;
  }

  /**
   * The atlases the captures use, fetched behind the game so the first musket's smoke is on time
   * (about 2.5 MB on the desktop presets, with the `fire` a burning body is lit with). Atlases already loaded are left alone.
   */
  private preloadVfx(): void {
    void this.vfx?.preload(CAPTURE_VFX);
  }

  /** The one detail record every flipbook cue is asked with, refilled in place. */
  private vfxFor(power: number, army?: ArmySkinId, source?: "melee" | "gun", seconds?: number): VfxDetail {
    const detail = this.vfxDetail;
    detail.power = power; detail.army = army; detail.source = source; detail.seconds = seconds;
    return detail;
  }

  /** A point on the stone under `at`, in a scratch vector: where ground effects are spawned. */
  private onStone(at: THREE.Vector3): THREE.Vector3 {
    return this.vfxPoint.set(at.x, BOARD_TOP, at.z);
  }

  /**
   * A foot set down in a directed duel (a step, a dodge, the hop back off a bash): one faint puff under it.
   * Nothing from the killing blow on: the camera is on the wound and then on the body.
   */
  private duelStepDust(x: number, z: number, strength = 0.5): boolean {
    if (this.combatKilled) return false;
    return this.playVfx("step", this.vfxPoint.set(x, BOARD_TOP, z), this.vfxFor(strength), VFX_SEAT.step);
  }

  /** Whether step dust in a duel is drawn from the flipbook under the present settings. */
  private duelDustIsFlipbook(): boolean {
    return !!this.vfx && vfxCue("step", this.vfxFlagsNow()) !== null;
  }

  /** The settings every flipbook cue is decided under, refilled in place. */
  private vfxFlagsNow(): VfxFlags {
    const flags = this.vfxFlags;
    flags.quality = this.preset; flags.reducedMotion = this.reducedMotion; flags.tactical = this.tactical;
    flags.menuBoard = this.menuPresentation || this.attract || this.silentBoard();
    return flags;
  }

  /**
   * Tells the arena's air what has just happened on the board (vfx/airWiring.ts): the desktop arena's ash and embers
   * part round it and the ash lying on the stone is thrown up (main game/src/play/arena-physics.ts). `x`, `y`, `z`
   * are the board's own units; `power` is the event's (a strike's power, a dust cue's strength); `delay` is seconds
   * until it happens. Nothing is told under reduced motion, on the flat map, on the menu's board, or where the
   * arena has no air to move (the baked arena, Quest). The arena keeps its clock from this engine's frame delta, so
   * what is stirred holds with the pause menu and slows with a fatality.
   */
  private stirAir(kind: AirImpulseKind, x: number, y: number, z: number, power = 1, delay = 0): boolean {
    const sink = this.battlefieldRenderer?.disturb;
    if (!sink || this.disposed) return false;
    return stirAir(sink, this.vfxFlagsNow(), kind, x, y, z, power, delay);
  }

  /**
   * A piece of a burst body, or a limb, reaching the stone (death/physics): it left blood there and raised no dust.
   * One puff from the stone's own material pool (vfx/contactEffects.ts, which owns surface dust where no flipbook
   * plays), seeded from the move record like the fight's, and the ash round it is stirred. The trunk lands harder.
   */
  private landingDust(at: THREE.Vector3, trunk: boolean): void {
    const strength = trunk ? 0.8 : 0.35;
    this.stirAir("fall", at.x, BOARD_TOP, at.z, strength);
    if (this.reducedMotion || this.tactical) return;
    const id = `${this.boardRevision}:landing-${this.landingDusts++}`;
    this.effects.spawnContact({ id, seed: contactEventSeed(combatSeed(this.controller.getSnapshot().sanList), id),
      point: { x: at.x, y: BOARD_TOP + .02, z: at.z }, normal: { x: 0, y: 1, z: 0 }, material: "stone", quality: this.preset,
      strength, groundY: BOARD_TOP, reducedMotion: this.reducedMotion });
  }

  /** Flipbook sprites alive now, and the slots the preset gives each atlas: for browser checks (0 alive after an Undo). */
  getVfxStats(): { active: number; budget: number } | null {
    return this.vfx ? { active: this.vfx.active, budget: this.vfx.capacity } : null;
  }
  /** The flourishes alive now (arcs, sparks, chips, sigils, gathers), for browser checks: all 0 after an Undo. */
  getFlourishStats(): FlourishStats | null { return this.flourish ? this.flourish.stats : null; }

  setViolenceIntensity(intensity: GoreIntensity): void { this.goreIntensity = intensity; this.gore?.setIntensity(intensity); }
  /** What the death physics holds now, for browser checks: no world and nothing falling after an Undo. */
  getDeathStats(): DeathPhysics["stats"] | null { return this.deathPhysics?.stats ?? null; }
  /** What the gore system holds now, for browser checks: nothing after an Undo of the only capture. */
  getGoreStats(): (GoreSystem["stats"] & { report: GoreSystem["decalReport"] }) | null { return this.gore ? { ...this.gore.stats, report: this.gore.decalReport.slice() } : null; }

  /** The last Combat Director fight this board played, for tests and bug reports. */
  getCombatDiagnostics(): typeof this.combatDiagnostics { return this.combatDiagnostics; }
  private combatDiagnostics: {
    sequence: string; record: string; status: string; seconds: number;
    sounded: { cue: string; at: number }[]; contacts: { id: string; error: number | null }[];
    /** Every clip the runner started, with the multiple of its natural speed it was given. */
    rates: { actor: string; clip: string; at: number; rate: number }[];
    /** What the swept-contact fit expected of each weapon contact (time, point, normal, anchor). */
    forecasts: ContactForecast[];
    /** Each stopped blow: steel-to-shield distance when it should land, and whether it counted. */
    blocks: { at: number; distance: number | null; held: boolean }[];
  } | null = null;

  /**
   * The body's own motion under the killing blow, from the hit to the floor
   * (web/src/scene/combat/deathWeight.ts): thrown a short way by the impulse
   * with its feet off the stone, turned by the off-centre part of it, knees
   * giving, rocked back over its heels, and one bounce where it lands. It
   * never lands in a square somebody is standing on.
   */
  private knockDown(victim: PieceView, blow: THREE.Vector3, death: number, pair?: CombatSession): void {
    const plan = victim.deathPlan();
    const spot = victim.container.position;
    // Every figure still standing, the killer included, is ground the body may not land on.
    const occupied: { x: number; z: number }[] = [];
    for (const piece of [...this.pieces.values(), ...this.motion]) if (piece !== victim && !piece.isSlain) occupied.push({ x: piece.container.position.x, z: piece.container.position.z });
    const heading = fallHeading({ x: spot.x, z: spot.z }, { x: blow.x, z: blow.z }, occupied, { reach: PIECE_HEIGHT[victim.kind] * .85, tile: TILE });
    // Where the weapon met the body, off its centre line: that part of the impulse turns it.
    const facing = victim.visual.getWorldDirection(new THREE.Vector3());
    const left = new THREE.Vector3(facing.z, 0, -facing.x);
    const killer = victim.combatOpponent;
    const struck = killer ? killer.weaponContact(new THREE.Vector3()).sub(victim.combatPoint(new THREE.Vector3())) : null;
    const knock = planKnockback({
      blow: heading.blocked ? { x: blow.x, z: blow.z } : heading, power: heading.blocked ? .3 : this.combatKilled ? 1 : .9,
      hitToLand: plan ? plan.land : death * .8, offCentre: struck ? THREE.MathUtils.clamp(struck.dot(left), -.2, .2) : 0,
      tile: TILE, clipTravel: DEATH_WEIGHT.cap * TILE * .6,
    });
    const sink = (globalThis as { __crownfallCombatTrace?: unknown[] }).__crownfallCombatTrace;
    // How this death goes is one decision (death/deathStyle.ts). A body that bursts (Full, under the field gun or a
    // Queen's spell) is cut where it stands and its pieces thrown from the blast; one that cannot be cut falls instead.
    const style = this.deathStyleOf(victim);
    if (style === "explode") {
      const chest = victim.combatPoint(new THREE.Vector3());
      const snapshot = this.controller.getSnapshot();
      if (this.deathPhysics?.explode(victim, { x: chest.x - blow.x * 0.3, y: BOARD_TOP + 0.4, z: chest.z - blow.z * 0.3 }, this.killedBy.get(victim)?.source === "fieldGun" ? 1.5 : 1.2, {
        ply: snapshot.sanList.length, standing: occupied, kingdom: this.factory.getSkins()[victim.color],
        flags: { menuBoard: this.silentBoard(), reducedMotion: this.reducedMotion, tactical: this.tactical },
      })) {
        if (Array.isArray(sink)) sink.push({ what: "burst", detail: { direction: { x: blow.x, z: blow.z } }, at: pair?.elapsedSeconds ?? 0 });
        return;
      }
    }
    // The ragdoll takes the fall when physics has loaded and the settings allow one: thrown along the same free heading,
    // struck where the weapon met the body. Otherwise the hand-animated fall below, unchanged.
    if ((style === "ragdoll" || style === "explode") && this.deathPhysics?.fall(victim, {
      direction: heading.blocked ? { x: blow.x, z: blow.z } : heading, power: heading.blocked ? .3 : this.combatKilled ? 1 : .9,
      point: (killer ? killer.weaponContact(new THREE.Vector3()) : victim.combatPoint(new THREE.Vector3())).toArray(), height: PIECE_HEIGHT[victim.kind], standing: occupied,
    })) {
      if (Array.isArray(sink)) sink.push({ what: "ragdoll", detail: { turned: heading.turned, blocked: heading.blocked, direction: { x: heading.x, z: heading.z } }, at: pair?.elapsedSeconds ?? 0 });
      return;
    }
    // Turned off the blow line to find free ground: the body turns with it, so the clip falls that way too.
    const turn = heading.turned * Math.PI / 180;
    const rest = victim.visual.quaternion.clone(), spun = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0), across = new THREE.Vector3(knock.direction.z, 0, -knock.direction.x);
    const revision = this.boardRevision;
    const live = () => victim.isSlain && !this.isStale(revision);
    let landed = false;
    void this.tweens.to({
      duration: knock.rest, easing: Ease.linear,
      onUpdate: t => {
        if (!live()) return;
        const pose = knock.at(t * knock.rest);
        if (!landed && t * knock.rest >= knock.land) {
          // The floor answers the body the moment it arrives.
          landed = true;
          const floor = victim.combatPoint(new THREE.Vector3()).setY(BOARD_TOP + .08);
          this.effects.spawnBurst(floor, 0x9c8a6a, 10, { speed: 1.1, life: .5 });
          this.shake.add(.05);
          this.stirAir("fall", floor.x, BOARD_TOP, floor.z, .6);
        }
        victim.runtime.position.set(pose.x, pose.y, pose.z);
        victim.runtime.quaternion.setFromAxisAngle(across, pose.lean);
        victim.visual.quaternion.copy(rest).premultiply(spun.setFromAxisAngle(up, pose.twist - turn * Math.min(1, t * knock.rest / .3)));
      },
    });
    if (Array.isArray(sink)) sink.push({ what: "knockdown", detail: { travel: knock.travel, land: knock.land, turned: heading.turned, blocked: heading.blocked, direction: knock.direction }, at: pair?.elapsedSeconds ?? 0 });
  }

  /** Lets go of the duel shot: home, or in a hotseat game straight round to the side of the player who moves next. */
  private releaseDuelCamera(rite = false): void {
    const duel = this.duelCamera;
    // A shot that watches a claim is let go by the claim, not by the fight that came before it.
    if (!duel || duel.timeline.leaving || (duel.rite === true) !== rite) return;
    const snapshot = this.controller.getSnapshot();
    // A claim's shot ends where it was told to: the view it left, or the next player's once the move is over
    // (see animateMove). Only the fight's own shot hands the view over as it lets go.
    const handover = !rite && this.rotateBoard && !this.tactical && snapshot.mode === "hotseat" && snapshot.status === "playing";
    if (!handover) { duel.timeline.release(); return; }
    duel.timeline.release(this.turnedView(duel.timeline.home));
    this.duelHandover = true;
  }

  /** A view turned a half turn about its own target: the same turn the swing to the next player makes. */
  private turnedView(home: CameraPose): CameraPose {
    return {
      position: { x: 2 * home.target.x - home.position.x, y: home.position.y, z: 2 * home.target.z - home.position.z },
      target: { ...home.target }, fov: home.fov,
    };
  }

  /** The killing blow as it is heard: the plea is cut, then steel, and under it the flesh it goes into. */
  private strikeSound(attacker: PieceKind, pan: number, volume: number): void {
    this.livePlea?.cut();
    // The menu's background game keeps to steel.
    audio.strike(attacker, {
      pan,
      volume,
      flesh: captureLayers({ silentBoard: this.silentBoard(), spell: false }).flesh,
    });
  }

  /** One contact marker drives the weapon effects, defender and witnesses. */
  private meleeContact(
    attacker: PieceView, victim: PieceView, victimSpot: THREE.Vector3,
    standoff: THREE.Vector3, direction: THREE.Vector3, strikeSquare: SquareId, profile: StrikeProfile,
    sound = true, bled = false,
  ): void {
    const settings = QUALITY_SETTINGS[this.preset];
    const blow = direction;
    const impact = victim.combatPoint(new THREE.Vector3());
    const power = profile.power;
    // The plain cinematic's killing swing, traced since its strike, is drawn as a light arc as it lands (vfx/flourish).
    const arc = sound ? this.meleeArc : null;
    this.meleeArc = null;
    if (arc) this.flourish?.revealArc(arc);
    // The lunge is over: it smears no more.
    this.flourish?.endSmear();
    // A blade or an axe may take a limb off as it kills (death/sever), on the frame it lands, before the body cries.
    this.severByBlow(attacker, victim, blow, power);
    victim.takeHit(blow, power);
    attacker.holdContact(profile.hold);
    // The board holds on the blow, the body shudders along it and the camera is kicked (combat/feel.ts).
    const felt = !!this.combatFeel.impact("kill", victim, blow, power, attacker.kind);
    if (felt) this.combatFeel.endSwing(attacker, 0.06);
    this.reactToImpact(victimSpot, power, victim, attacker);
    // A Combat Director fight has just sounded this blow through its own audio layer.
    if (sound) this.strikeSound(attacker.kind, this.stereoPan(victimSpot), Math.min(1, 0.85 * power));
    // The cry answers the wound a beat later, whatever the defender's body does before it falls.
    this.lastCry(victim);
    // The board itself is capped: past a point the tiles stop reading as stone.
    // A directed fight is watched from close in: the stone's own flash is cut down with the blow's.
    this.strikeImpact(strikeSquare, Math.min(1.5, power) * (sound ? 1 : 0.45), bled, sound ? 1 : DIRECTED_RING);
    if (sound) {
      this.effects.spawnFlash(impact, Math.min(4.4, 2.2 * power), 0.24);
      // With the feel layer on, part of the same sparks leave along the blow, out of the far side of the body.
      const sparks = Math.round(settings.captureParticles * power), along = felt ? Math.round(sparks * 0.4) : 0;
      this.effects.spawnBurst(impact, 0xffc978, sparks - along, {
        speed: 3.4 * (0.9 + power * 0.1),
        life: 0.75,
      });
      if (along) this.combatFeel.sparks(impact, blow, along, 0xffd08a, 3.6 * (0.9 + power * 0.1), 0.4);
    } else if (!bled) {
      // A directed kill is watched from close in: a full flash on the contact frame hides the
      // weapon going in. Without blood to mark the blow it keeps a small one, two frames late.
      void this.tweens.to({ duration: 0.07, onUpdate: () => undefined }).then(() => {
        if (this.disposed) return;
        this.effects.spawnFlash(victim.combatPoint(new THREE.Vector3()), Math.min(1.6, 0.8 * power), 0.1);
      });
      this.effects.spawnBurst(impact, 0xffc978, Math.round(settings.captureParticles * power * 0.35), { speed: 3, life: 0.5 });
    }
    // Where the blow drew blood, the weapon entering and the spray are the impact: no flash, no sparks.
    this.shake.add(Math.min(1, 0.55 * power));
    // The air round the two of them takes it either way.
    this.stirAir("blow", impact.x, impact.y, impact.z, power);
    // The plain cinematic's strike (the director's fight holds its own killing contact): a fatal kill holds it
    // (fatality/), the blow going in at the chest along the line it is thrown.
    if (sound) this.fatalityBlow(victim, attacker, this.chestWound(victim, blow), blow);

    // Steel: the cut hangs in the air for a couple of frames after the blade, unless a light arc was drawn along it.
    if (profile.slash && !arc) {
      void spawnSlash(this.scene, this.tweens, impact, {
        color: profile.slash.color,
        size: profile.slash.size,
        tilt: -0.55 - this.showDice("slash")() * 0.35,
      });
    }

    // Weight: a blow that carries into the floor sends a wave across the stone.
    if (profile.wave) {
      audio.groundSlam({ pan: this.stereoPan(victimSpot), volume: Math.min(1, power * 0.6) });
      void spawnGroundWave(this.scene, this.tweens, victimSpot, {
        color: profile.wave.color,
        radius: profile.wave.radius,
        height: BOARD_TOP + 0.03,
        echo: profile.aftershock > 0.2,
      });
      // The floor throws its dust up with the wave: more of it the harder the blow.
      const dusted = this.playVfx("slam", this.onStone(victimSpot), this.vfxFor(power, undefined, "melee"), VFX_SEAT.slam);
      this.effects.spawnSmoke(victimSpot.clone().setY(BOARD_TOP + 0.14), {
        count: Math.max(dusted ? 2 : 4, Math.round(settings.captureParticles * 0.3 * (dusted ? PROCEDURAL_SHARE : 1))),
        radius: 0.5,
        scale: 0.8,
        growth: 3.2,
        life: 1.2,
        speed: 2.4,
        rise: 0.1,
        color: 0x9c8f7d,
        opacity: dusted ? 0.34 : 0.5,
      });
    }

    // The plain cinematic's kill throws its flakes and chips (the director's fight throws its own, at its wound).
    if (sound) this.flourishKill(arc, attacker, victim, null, blow, power);

    // A charge does not stop where it strikes: dust keeps going past the body.
    if (profile.wake) {
      this.effects.spawnSmoke(standoff.clone().setY(BOARD_TOP + 0.12), {
        count: Math.max(3, Math.round(settings.captureParticles * 0.2)),
        radius: 0.34,
        scale: 0.6,
        growth: 2.8,
        life: 0.9,
        speed: 0.8,
        rise: 0.15,
        color: 0xa5977f,
        opacity: 0.4,
        drift: direction.clone().multiplyScalar(2.1),
      });
    }

  }

  /**
   * The crown's prerogative: before the blow, a column of light is dropped on
   * the condemned, a bell is rung over it, and motes are drawn up off the stone
   * around its feet. Nothing else on the board is allowed this beat.
   */
  private async passSentence(
    victim: PieceView,
    at: THREE.Vector3,
    pillar: { radius: number; color: number },
    withLight: boolean,
    pair: CombatSession,
  ): Promise<void> {
    const settings = QUALITY_SETTINGS[this.preset];
    audio.judgementToll({ pan: this.stereoPan(at), volume: 0.95 });
    void spawnPillar(this.scene, this.tweens, at, {
      color: pillar.color,
      radius: pillar.radius,
      height: 5.6,
      floor: BOARD_TOP,
      hold: 0.46,
      light: withLight ? this.spellLights.acquire(pillar.color, 5.2) : null,
    });
    // Light pulling the dust up off the floor around the condemned.
    this.effects.spawnBurst(at.clone().setY(BOARD_TOP + 0.1), 0xffe6b4, Math.round(settings.captureParticles * 0.4), {
      speed: 0.5,
      life: 1,
      gravity: -1.6,
      radius: pillar.radius * 0.9,
      size: 0.08,
      growth: 0.4,
      drag: 1.4,
      rise: 0.7,
    });
    victim.flareAura(0.8);
    await pair.wait(0.36);
  }

  /**
   * The stone still moving after a heavy blow: a second, softer kick through the
   * tiles and a low cloud of grit rolling off the square.
   */
  private async aftershock(square: SquareId, strength: number): Promise<void> {
    const revision = this.boardRevision;
    await wait(0.18);
    if (this.isStale(revision)) return;
    const settings = QUALITY_SETTINGS[this.preset];
    this.shake.add(strength);
    this.board.impact(square, 0xffa457, strength * 0.7);
    const ground = squareToWorld(square, BOARD_TOP + 0.06);
    this.stirAir("slam", ground.x, BOARD_TOP, ground.z, 0.4 + strength);
    this.effects.spawnBurst(ground, 0xd8b285, Math.round(settings.captureParticles * 0.3), {
      speed: 1.4,
      life: 0.9,
      gravity: 2.2,
      radius: 0.55,
    });
  }

  /**
   * The caster's beat. Nothing about this fight is fought at arm's length: the
   * sorceress and the mage stay on their own square, level the staff down the
   * line, gather fire at the crystal and throw it. The target burns where it
   * stands — and only once the body is gone does the caster walk the whole
   * distance and take the square, footsteps and all.
   */
  private async playSpellCinematic(
    attacker: PieceView,
    victim: PieceView,
    from: THREE.Vector3,
    to: THREE.Vector3,
    strikeSquare: SquareId,
    pair: CombatSession,
  ): Promise<void> {
    // En passant aside, the victim stands on the destination square; either way
    // the fire flies at the body, and the blast throws it away from the caster.
    const victimSpot = victim.container.position.clone();
    const blow = victimSpot.clone().sub(from).setY(0);
    if (blow.lengthSq() < 1e-6) blow.copy(to.clone().sub(from).setY(0));
    if (blow.lengthSq() < 1e-6) blow.set(0, 0, 1);
    blow.normalize();

    const spell = spellProfile(attacker.kind);
    this.combatFeel.begin();
    this.killedBy.set(victim, deathCause("spell", attacker.kind));
    const revision = this.boardRevision;
    const army = this.spellArmy(attacker);
    const impact = victimSpot.clone().setY(0.62);
    // A caster whose kingdom's page has a spell that is built casts it (vfx/spells); the rest throw the plain bolt.
    const drawn = this.drawSpell(attacker, strikeSquare);
    // A spell from the library takes a shot of its own (rites/spellShot.ts), as a summon does: the piece and the air
    // over it, close, where the spell gathers, or first over the caster's shoulder where its travel is the show; then
    // in on the body as the blow lands (castDrawnSpell). Under the duel shot's own conditions: none under reduced
    // motion or on the map. No rank crest floats in it (closeShotHolds).
    const shot = drawn ? this.beginSpellCamera(drawn, attacker, victim) : null;
    this.spellCamera = shot;
    if (shot) this.castShot = shot;
    let handed = false;
    // Otherwise a duel at range: hold both ends of the bolt in frame.
    if (!shot) this.focusPoint(from.clone().lerp(victimSpot, 0.55), 0.92);
    const punch = shot ? 0 : this.lensPunch(spell.zoom);
    if (punch) void this.tweens.to({
      duration: 0.28,
      easing: Ease.outCubic,
      onUpdate: (t) => {
        this.camera.fov = this.lensFov - punch * t;
        this.camera.updateProjectionMatrix();
      },
    });

    try {
      // The caster levels its staff; the target sees what is coming for it.
      victim.braceForImpact(from);
      await pair.stage("approach", () => Promise.all([
        attacker.turnTowards(victimSpot, this.tweens, 0.34),
        victim.turnTowards(from, this.tweens, 0.32),
      ]));
      attacker.faceTowards(victimSpot);
      this.wake(victim);

      let cast: ReturnType<PieceView["playAttack"]> | null = null;
      if (drawn) {
        cast = await this.castDrawnSpell(drawn, attacker, victim, impact, blow, strikeSquare, spell, pair);
      } else {
        // The strike clip doubles as the incantation: fire builds at the crystal
        // right up to the frame the clip would have landed its blow. The sorceress
        // holds hers longer, and holds far more of it.
        cast = attacker.hasClip("attack") ? attacker.playAttack() : null;
        const baseGather = (cast && cast.duration > 0 ? Math.max(0.34, cast.impact) : 0.55) + spell.gather;
        // A begging victim holds the fire a little longer, so its words are said before the bolt.
        const gather = baseGather + pleaWait(this.livePlea?.secondsToLastWord() ?? 0, baseGather + 0.3);
        // No cast clip on this rig: the body does the casting instead of the
        // skeleton — it leans back over the fire it is gathering.
        const byHand = !cast || cast.duration <= 0;
        // A Solforiz caster stands in dark mist while the fire is gathered: it curls up round the feet and is gone with the bolt.
        this.playVfx("mist", this.onStone(attacker.container.position), this.vfxFor(1, army, undefined, gather), VFX_SEAT.mist);
        if (byHand) void this.castWind(attacker, gather);
        // Ribbons of the kingdom's light spiral in to the hand as the fire is gathered (vfx/flourish).
        const gathering = `${this.boardRevision}:bolt`;
        this.flourishing()?.beginGather(gathering, this.castHand(attacker), gather, army, this.flourishSeed("gather"));
        // The hall darkens as the fire gathers, until just after it bursts (moments/).
        this.moments.darken(true);
        await pair.stage("strike", () => this.gatherSpell(attacker, gather, spell.orb));
        this.flourish?.endGather(gathering);
        // ...and throws itself after the bolt as it leaves the staff.
        if (byHand) this.castRelease(attacker, blow);

        await pair.stage("flight", async () => {
          if (spell.bolts > 1) {
            // A volley: leaders go first and break on the body, the killing bolt lands
            // behind them and is the one that takes the square.
            const leaders: Promise<void>[] = [];
            for (let i = 0; i < spell.bolts - 1; i += 1) {
              leaders.push(this.throwFireball(attacker, impact, { size: 0.34, delay: i * 0.11, leader: true, clock: pair }));
            }
            await pair.wait(0.18);
            await this.throwFireball(attacker, impact, { size: 0.64, clock: pair });
            this.stopIfStale(revision);
            await Promise.all(leaders);
          } else {
            await this.throwFireball(attacker, impact, { clock: pair });
          }
          this.stopIfStale(revision);
        });
        await pair.stage("contact", () => {
          this.livePlea?.cut();
          this.moments.struck();
          victim.takeHit(blow);
          // The bolt lands: a short hold, the body shudders, the camera is pushed along the line it flew (combat/feel.ts).
          this.combatFeel.impact("blast", victim, blow, 1, attacker.kind);
          this.reactToImpact(victimSpot, 1, victim, attacker);
          this.spellBurst(attacker, impact, strikeSquare, spell.blast, spell.ring);
          this.stampBlow(attacker, victim, blow, spell.blast);
          // A fatal bolt holds the moment it bursts on the body (fatality/).
          this.fatalityBlow(victim, attacker, this.chestWound(victim, blow), blow);
        });
      }

      // Dead before the caster has taken a single step: or held up on what ran it through, until the spell lets go.
      const pinned = this.pierced.get(victim);
      await pair.stage("fall", () => pinned ? this.letPiercedFall(victim, pinned, blow, pair) : this.spellDeath(victim, blow, pair));
      this.pierced.delete(victim);

      if (punch) void this.tweens.to({
        duration: 0.45,
        easing: Ease.outCubic,
        onUpdate: (t) => {
          this.camera.fov = this.lensFov - punch * (1 - t);
          this.camera.updateProjectionMatrix();
        },
      });
      // The claim's shot takes over from the spell's where the claim will be watched; otherwise the player's view
      // comes back now.
      if (shot && this.duelCamera?.timeline === shot && this.claimIsWatched(victim)) { this.claimShotOwed = victim; handed = true; }

      // The body is cleared off the board, and only then is the square walked to.
      await pair.stage("advance", async () => {
        // The spell's shot stays until what it threw has come to rest (death/physics): a body that burst at Full was
        // left mid-flight in the first filming of the sun pillar. The Claiming waits for the same before it begins.
        if (!handed) { await this.untilSettled(victim, revision); this.stopIfStale(revision); this.letSpellCameraGo(); }
        await this.banish(victim, blow);
        this.stopIfStale(revision);
        if (cast) attacker.playIdle(0.2);
        this.focusPiece(attacker, 0.94);
        await this.glide(attacker, from, to, false, 1.15);
      });
      await pair.stage("complete", () => {});
    } finally {
      // However it ended, a shot not handed to the claim goes home, and the hall's light comes back.
      if (!handed) this.letSpellCameraGo();
      if (this.claimShotOwed === victim && this.isStale(revision)) this.claimShotOwed = null;
      this.moments.darken(false);
    }
  }

  /**
   * Takes the camera for a spell from the library (rites/spellShot.ts): over the caster's shoulder where the spell's
   * travel is the show and the line runs away from the player, else on the piece and the air over it where it
   * gathers, from the side the fewest figures stand in front of. Under the duel shot's own conditions.
   */
  private beginSpellCamera(entry: SpellEntry, attacker: PieceView, victim: PieceView): DuelCameraTimeline | null {
    this.spellShoulder = false;
    const taking = this.riteCameraHome();
    if (!taking) return null;
    const spot = victim.container.position, feet = attacker.container.position, height = PIECE_HEIGHT[victim.kind];
    const stone = { x: spot.x, y: BOARD_TOP, z: spot.z };
    const gather = spellShot(gatherFrame(stone, height, entry.air ?? SPELL_SHOT.air, TILE), {
      home: taking.home, base: shotTurn(taking.home, feet, spot), boardTop: BOARD_TOP, aspect: this.camera.aspect, fov: this.lensFov,
      radius: HALL_INNER_RADIUS - FOLLOW_WALL_MARGIN, close: true, reach: SPELL_SHOT.reach,
      standing: this.spellStanding(entry, attacker, victim), sights: gatherSights(stone, height, TILE),
    });
    this.shotTurnNow = gather.turn;
    // The caster has yet to turn on the piece: where it will hold the spell, at the height it holds it now.
    const line = spot.clone().sub(feet).setY(0);
    if (line.lengthSq() > 1e-8) line.normalize();
    const hand = { x: feet.x + line.x * 0.2, y: attacker.castOrigin().y, z: feet.z + line.z * 0.2 };
    const shoulder = entry.travels ? shoulderShot({
      caster: { x: feet.x, y: BOARD_TOP, z: feet.z }, height: PIECE_HEIGHT[attacker.kind], hand, chest: victim.combatPoint(new THREE.Vector3()),
      home: taking.home, boardTop: BOARD_TOP, radius: HALL_INNER_RADIUS - FOLLOW_WALL_MARGIN, standing: this.spellStanding(entry, attacker, victim, false),
    }) : null;
    this.spellShoulder = shoulder !== null;
    return this.takeRiteCamera(taking, this.riteView(shoulder ?? gather.view), 1.1);
  }

  /**
   * The spell's shot moves on to the body (rites/spellShot.ts strike): in close where it burns, fades or is run
   * through, from the side the fewest figures stand in front of, and out over the ground round it where it bursts.
   * Called as the blow lands, or, for a shot that opened over the caster's shoulder, as the spell leaves the hand.
   */
  private spellStrikeBeat(entry: SpellEntry, attacker: PieceView, victim: PieceView, impact: THREE.Vector3, blow: THREE.Vector3, seconds?: number): void {
    const shot = this.spellCamera;
    if (!shot || this.duelCamera?.timeline !== shot) return;
    const spot = victim.container.position, stone = { x: spot.x, y: BOARD_TOP, z: spot.z }, height = PIECE_HEIGHT[victim.kind];
    // A body run through is held up where it was struck; one that burns or fades goes down where it stands. Neither is
    // thrown, so neither needs the ground a burst body's pieces cross.
    const style = entry.death === "pierce" ? "pierce" : this.deathStyleOf(victim);
    const where = style === "pierce" ? { frame: bodyFrame(stone, height, SPELL_SHOT.pierceOver, SPELL_SHOT.pierceRound * TILE), close: true, reach: RITE_SHOT.closeReach, in: SPELL_SHOT.pierceIn }
      : style === "burn" || style === "fade" ? { frame: bodyFrame(stone, height, SPELL_SHOT.burnOver, SPELL_SHOT.burnRound * TILE), close: true, reach: SPELL_SHOT.burnReach, in: SPELL_SHOT.burnIn }
        : { frame: burstFrame(stone, { x: impact.x, y: impact.y, z: impact.z }, { x: blow.x, z: blow.z }, TILE), close: false, reach: undefined, in: SPELL_SHOT.burstOut };
    const choice = spellShot(where.frame, {
      home: shot.home, base: this.shotTurnNow, boardTop: BOARD_TOP, aspect: this.camera.aspect, fov: this.lensFov, radius: HALL_INNER_RADIUS - FOLLOW_WALL_MARGIN,
      close: where.close, ...(where.reach !== undefined ? { reach: where.reach } : {}), standing: this.spellStanding(entry, attacker, victim), sights: bodySights(stone, height),
    });
    this.shotTurnNow = choice.turn;
    shot.moveTo(this.riteView(choice.view), seconds ?? where.in);
  }

  /**
   * What may stand in the way of a spell's close beat (rites/spellShot.ts): every other figure standing, the caster
   * among them unless `caster` is false, and the row of solids the spell raises along the line (SpellEntry.row).
   */
  private spellStanding(entry: SpellEntry, attacker: PieceView, victim: PieceView, caster = true): { x: number; z: number; radius: number; height: number }[] {
    const standing = [...this.pieces.values(), ...this.motion].filter(piece => piece !== victim && !piece.isSlain && (caster || piece !== attacker))
      .map(piece => ({ x: piece.container.position.x, z: piece.container.position.z, radius: TILE * 0.27, height: PIECE_HEIGHT[piece.kind] }));
    if (entry.row) standing.push(...rowScreen(attacker.container.position, victim.container.position, TILE));
    return standing;
  }

  /**
   * A spell's victim dies where it stands (slay): it burns, fades or bursts. Its fall is over a moment after the body
   * is down ({@link SPELL_SHOT}.husk), not when death/burn has let the husk smoulder its while: the Claiming begins as it
   * smoulders on, and crumbles it as its unmaking. A board replaced under what is still to come ends it quietly.
   */
  private async spellDeath(victim: PieceView, blow: THREE.Vector3, pair: CombatSession): Promise<void> {
    let down = (): void => {};
    const landed = new Promise<void>(resolve => { down = resolve; });
    const dying = this.slay(victim, blow, true, pair, false, () => down());
    dying.catch(() => undefined);
    await Promise.race([dying, landed.then(() => pair.wait(SPELL_SHOT.husk))]);
  }

  /** Lets the spell's shot go home, if it still holds the camera. */
  private letSpellCameraGo(): void {
    const camera = this.spellCamera;
    this.spellCamera = null; this.spellShoulder = false;
    if (camera && this.duelCamera?.timeline === camera) this.releaseDuelCamera();
  }

  /**
   * The gunpowder beat. The Grande Armée never walks into a fight it can settle
   * from where it stands: the barrel is levelled, the hammer goes back, the
   * shot crosses the board flat and fast, and the body is already down and
   * cleared before the shooter takes a single step onto the square. Which
   * barrel is doing the talking is read out of {@link GUNS} for the rank — the
   * Emperor's flintlock, the line's musket, or the battery's field gun.
   */
  private async playGunCinematic(
    attacker: PieceView,
    victim: PieceView,
    from: THREE.Vector3,
    to: THREE.Vector3,
    strikeSquare: SquareId,
  ): Promise<void> {
    // Timed by the wall clock and the tweens, not the pair's beats: each await is followed by a check of the board (M-20).
    const revision = this.boardRevision;
    const gun = GUNS[attacker.kind];
    const settings = QUALITY_SETTINGS[this.preset];
    const look = GUN_LOOK[attacker.color];
    this.killedBy.set(victim, deathCause("gun", attacker.kind, gun.wave !== null));
    this.combatFeel.begin();

    // En passant aside the victim stands on the destination square; either way
    // the ball flies at the body and throws it away from the shooter.
    const victimSpot = victim.container.position.clone();
    const blow = victimSpot.clone().sub(from).setY(0);
    if (blow.lengthSq() < 1e-6) blow.copy(to.clone().sub(from).setY(0));
    if (blow.lengthSq() < 1e-6) blow.set(0, 0, 1);
    blow.normalize();

    // A duel at range: hold both ends of the shot in frame.
    this.focusPoint(from.clone().lerp(victimSpot, 0.55), 0.92);
    const punch = this.lensPunch(gun.zoom);

    void this.tweens.to({
      duration: 0.26,
      easing: Ease.outCubic,
      onUpdate: (t) => {
        this.camera.fov = this.lensFov - punch * t;
        this.camera.updateProjectionMatrix();
      },
    });

    // The barrel comes round; the target sees what is pointed at it.
    await Promise.all([
      attacker.turnTowards(victimSpot, this.tweens, 0.32),
      victim.turnTowards(from, this.tweens, 0.32),
    ]);
    this.stopIfStale(revision);
    attacker.faceTowards(victimSpot);

    // Lock, ramrod or linstock: the mechanical tick that says "firearm".
    audio.gunLock({
      pan: this.stereoPan(from),
      weight: gun.calibre,
      volume: 0.5 + gun.calibre * 0.5,
    });

    // ---- going down on the knee ----------------------------------------
    // A kneeling gunner gets there before anything else happens, and he gets
    // there on an articulated clip (the rise run backwards) rather than by being
    // blended downwards, so the knee plants on the stone instead of the whole
    // body sinking through it.
    const kneeling = gun.stance.kneel;
    if (kneeling) {
      const drop = attacker.playKneel(gun.stance.drop);
      if (drop > 0) {
        // The knee and the hand taking the weight of the rifle, on the frame the
        // stone is actually reached.
        audio.footstep({
          pan: this.stereoPan(from),
          timbre: "scuff",
          volume: 0.42,
          delay: drop * 0.82,
          jitter: -0.3,
        });
        await wait(drop);
        this.stopIfStale(revision);
      }
    }

    // ---- taking aim ----------------------------------------------------
    // The weapon comes up and is held on the body. A rig that carries a sight
    // picture loops it here; one that does not leans into the shot by hand, so
    // every gunner is visibly aiming before anything is fired.
    const aiming = attacker.playAim(kneeling ? 0.3 : 0.18);
    if (!aiming) {
      void this.tweens.to({
        duration: Math.max(0.12, gun.aim),
        easing: Ease.outCubic,
        onUpdate: (t) => attacker.setStrikeTilt(-0.1 * t),
      });
    }
    await wait(gun.aim);
    this.stopIfStale(revision);

    // ---- the drill -----------------------------------------------------
    // A standing gunner plays his firing clip at its own readable length (see
    // GunProfile.drill) and the shot leaves on the frame the hammer falls, not
    // halfway through the wind-up.
    //
    // A kneeling gunner plays no firing clip at all, on purpose: every shooting
    // take the generator produces starts and ends on its feet, so playing one out
    // of a kneel had him stand up to fire and drop back down afterwards — the
    // bobbing this branch exists to stop. He fires out of the held kneel, and the
    // whole shot (trigger, report, recoil) is timed off the drill numbers rather
    // than off a clip. A rig whose clip never arrived levels the barrel by hand.
    const fire = !kneeling && attacker.hasClip("attack")
      ? attacker.playAttack({ seconds: gun.drill.seconds, impactAt: gun.drill.impact })
      : null;
    const byHand = !fire || fire.duration <= 0;
    // Without a clip the beat still keeps the barrel's authored spacing: the
    // marksman's held sights are a second of stillness, not a third of one.
    const untilShot = byHand
      ? Math.max(0.24, gun.drill.seconds * gun.drill.impact * (kneeling ? 1 : 0.32))
      : fire.impact;
    if (byHand) {
      // The lean is no longer awaited: the two waits below own the clock, so the
      // trigger and the report keep their spacing whether or not a clip arrived.
      // A kneeling shooter is braced against his own leg, so he settles onto the
      // sights instead of leaning into them.
      const settle = kneeling ? -0.05 : -0.14 * (aiming ? 1 : 0.6);
      void this.tweens.to({
        duration: untilShot,
        easing: Ease.outCubic,
        onUpdate: (t) => attacker.setStrikeTilt(settle - (kneeling ? 0.02 : 0.06) * t),
      });
    }

    // ---- the trigger ---------------------------------------------------
    // A muzzle-loader is two sounds, not one. The sear breaks, the flint rakes
    // the frizzen and the pan flashes; the charge in the barrel lights one lock
    // time later. So the mechanical half is played `gun.lock` seconds *before*
    // the report, and the report itself still lands on the authored ignition
    // frame alongside the muzzle flash. That is what makes the shot audibly
    // belong to the finger that pulled it rather than merely happening near it.
    const lock = Math.min(gun.lock, untilShot * 0.5);
    await wait(untilShot - lock);
    this.stopIfStale(revision);
    audio.triggerPull({
      pan: this.stereoPan(attacker.muzzleOrigin()),
      weight: gun.calibre,
      volume: 0.8 + gun.calibre * 0.4,
    });
    await wait(lock);
    this.stopIfStale(revision);

    // ---- the shot ------------------------------------------------------
    const muzzle = attacker.muzzleOrigin();
    const chest = victimSpot.clone().setY(0.58);
    const line = chest.clone().sub(muzzle);
    const distance = Math.max(0.001, line.length());
    const aim = line.divideScalar(distance);

    audio.gunshot({
      pan: this.stereoPan(muzzle),
      weight: gun.calibre,
      volume: 1,
      voice: gun.voice,
    });
    this.shake.add(Math.min(1, 0.3 + gun.calibre * 0.7));

    // Flame width is read off the round that is about to leave the bore, so the
    // charge always out-shines its own projectile.
    const flame = muzzleFlare(gun);
    void spawnMuzzleFlash(this.scene, this.tweens, muzzle, {
      look,
      size: flame,
      direction: aim,
      // Held a shade longer than before: the flash now has an ignition plateau to
      // sit on, and a couple of extra frames is the difference between a shot you
      // see and a shot you only hear.
      life: 0.12 + gun.calibre * 0.07,
      // A wider sheet of flame throws light further into the hall, so the
      // borrowed slot's reach grows with the charge rather than staying fixed.
      light: settings.postFx ? this.spellLights.acquire(look.light, 4.4 + flame * 2.6) : null,
    });
    // A smoothbore leaves soot in the faction's livery tint; the marksman's
    // rifled barrel leaves pale ash grey you can see the hall through.
    const powder = gun.smokeTint ?? look.smoke;
    // The billow itself is the flipbook's: a baked puff at the muzzle that drifts down the line of fire, in the
    // barrel's own powder colour, sized by the bore. Where it plays, the sprite bank thins to a haze under it.
    const billow = this.playVfx("musket", muzzle, this.vfxFor(gun.calibre), 0, aim, 0, powder);
    void spawnPowderCloud(this.scene, this.tweens, muzzle, {
      look,
      size: 0.34 + gun.calibre * 0.7,
      direction: aim,
      count: Math.max(billow ? 2 : 3, Math.round(gun.smoke * (settings.captureParticles >= 34 ? 1 : 0.55) * (billow ? PROCEDURAL_SHARE : 1))),
      life: gun.smokeHang,
      tint: powder,
      density: gun.smokeDensity * (billow ? 0.7 : 1),
      fine: gun.fineSmoke,
      // Carried off the square by the hall's air and rolled out along the stone
      // rather than sinking through it.
      draft: HALL_DRAFT,
      floor: BOARD_TOP + 0.05,
    });
    // The bore goes on smoking in his hands after the crack — emitted at the live
    // muzzle, so it stays with the barrel as the weapon comes down.
    this.boreTrickle(attacker, gun, powder);
    // Sparks and burning grains thrown out of the pan and the bore. Sized off the
    // flame rather than off a constant, so the grains stay in scale with it: a
    // field gun throws visible embers, a pistol lock throws a pinch of them.
    this.effects.spawnBurst(muzzle, look.ball, Math.round(settings.captureParticles * 0.44 * (0.5 + gun.calibre)), {
      speed: 2.6 + gun.calibre * 3,
      life: 0.55,
      gravity: 2.4,
      radius: 0.06 + flame * 0.06,
      size: 0.07 + flame * 0.055,
      drag: 2.4,
    });

    // Recoil: the body rocks back off the shot, and a towed gun runs back on
    // its wheels before the crew heaves it up to the mark again.
    this.kickBack(attacker, blow, gun);

    // Shot travels flat: no arc, no easing. Which round crosses the hall — a cast
    // lead ball that wanders, a rifled Minié that does not, or a glowing lump of
    // iron — is read off the barrel's loadout.
    //
    // The round leaves from just clear of the bore rather than from the muzzle
    // point itself: started dead on the muzzle it spawns inside the flash and the
    // powder bank, and the first third of its flight is invisible.
    // With a bigger flame this offset has to grow with it, or the round spends its
    // opening frames inside the fire it was launched by.
    const clear = muzzle.clone().addScaledVector(aim, Math.min(0.42, flame * 0.44));
    const smoking = settings.captureParticles >= 34;
    let nextWisp = 0.12;
    await flyShot(this.scene, this.tweens, clear, chest, {
      look,
      ammo: gun.ammo,
      size: gun.ball,
      flight: THREE.MathUtils.clamp((distance / TILE) * gun.speed, 0.17, 0.58),
      light: gun.ammo === "roundShot" && settings.postFx ? this.spellLights.acquire(0xff7a2e, 3.2) : null,
      // The streak along the path the round flew — the thing that makes a shot
      // followable rather than merely audible. Its spine resolution is the one
      // cost that scales with the preset.
      trailDetail: trailRings(settings.captureParticles),
      onTrail: (at, t) => {
        if (!smoking || t < nextWisp) return;
        nextWisp += 0.22;
        this.effects.spawnSmoke(at.clone(), {
          count: 1,
          radius: 0.06,
          scale: (0.2 + gun.calibre * 0.22) * (gun.fineSmoke ? 0.75 : 1),
          growth: 2.4,
          life: gun.fineSmoke ? 0.34 : 0.5,
          speed: 0.2,
          rise: gun.fineSmoke ? 0.3 : 0.16,
          color: powder,
          opacity: 0.2,
        });
      },
    });
    this.stopIfStale(revision);

    // ---- the hit -------------------------------------------------------
    const power = gun.blast;
    // The ball arriving, ahead of the generic capture hit: whine into a thud.
    audio.ballImpact({ pan: this.stereoPan(chest), volume: Math.min(1.1, 0.7 + gun.calibre * 0.5) });
    audio.play("capture", Math.min(1, 0.7 * power));
    // A short hold as it goes in, the body shuddering along the line of fire (combat/feel.ts).
    this.combatFeel.impact("shot", victim, aim, power, attacker.kind);
    this.strikeImpact(strikeSquare, Math.min(1.5, power));
    this.effects.spawnFlash(chest, Math.min(IMPACT_GLOW, 1.9 * power), 0.2);

    // The ball's wound, its spray and its stains (gore/), as any other blow's. A body the field gun bursts (Full)
    // bleeds from its pieces instead (death/gibs).
    const shot = this.deathStyleOf(victim) === "explode" ? null : this.gunWound(attacker, victim, aim, power, gun.ammo === "roundShot");
    if (shot) this.bleeding = victim;

    // The moment itself: the body breaks open where the round went in. Which
    // debris comes off it is read off the victim rather than off the shooter:
    // steel spall off plate or mail, or torn cloth in the victim's own colours
    // (impactBody). The round decides how hard: a pistol ball barely marks the
    // stone, a six-pounder guts it.
    const round = AMMUNITION[gun.ammo];
    const { body, palette } = this.impactBody(victim);
    const violence = round.shatter * (0.75 + power * 0.25);
    void spawnImpactShatter(this.scene, this.tweens, chest, {
      body,
      palette,
      along: aim,
      power: violence,
      floor: BOARD_TOP,
      through: round.through,
      budget: Math.round(settings.captureParticles * 0.85),
      light: settings.postFx ? this.spellLights.acquire(0xffd7a0, 3.4) : null,
    });
    // A thinner warm burst on top of the debris: the powder that came with the
    // round, not the round itself.
    this.effects.spawnBurst(chest, look.flash, Math.round(settings.captureParticles * 0.34 * power), {
      speed: 3.6 * (0.9 + power * 0.1),
      life: 0.45,
      gravity: 2.2,
      radius: 0.1,
      drag: 2.6,
    });
    // The haze the wreckage lifts is the colour of what just broke.
    this.effects.spawnSmoke(chest, {
      count: Math.max(2, Math.round(settings.captureParticles * 0.14 * power)),
      radius: 0.24 * power,
      scale: 0.45 * power,
      growth: 2.6,
      life: 0.9,
      speed: 1,
      rise: 0.5,
      color: impactDust(body),
      opacity: 0.4,
    });
    this.shake.add(Math.min(1, 0.3 * power));
    this.stirAir("shot", chest.x, chest.y, chest.z, power);
    // A fatal shot holds the moment the round goes in (fatality/).
    this.fatalityBlow(victim, attacker, this.chestWound(victim, aim), aim);

    // Solid shot does not stay in the man it hits. A six-pound lump of iron
    // carries clean through and goes on to skip off the stone behind him, which
    // is the one thing that tells the eye this was a cannon and not a big musket.
    if (gun.ammo === "roundShot") {
      const beyond = chest.clone().addScaledVector(aim, TILE * 1.7).setY(BOARD_TOP + 0.05);
      void (async () => {
        await flyShot(this.scene, this.tweens, chest, beyond, {
          look,
          ammo: gun.ammo,
          size: gun.ball,
          flight: 0.24,
          light: null,
          trailDetail: trailRings(settings.captureParticles),
        });
        if (this.isStale(revision)) return;
        audio.ballImpact({ pan: this.stereoPan(beyond), volume: 0.42 });
        // Hot iron on flagstone: the ricochet throws stone chips and a long
        // shower of sparks that skitter away across the floor.
        void spawnImpactShatter(this.scene, this.tweens, beyond, {
          body: "flagstone",
          // Skipping off the floor, so the spall comes up out of the stone.
          along: aim.clone().setY(-0.75).normalize(),
          power: 1.5,
          floor: BOARD_TOP,
          through: false,
          budget: Math.round(settings.captureParticles * 0.5),
          light: null,
        });
        this.effects.spawnSmoke(beyond, {
          count: 2,
          radius: 0.2,
          scale: 0.5,
          growth: 2.8,
          life: 0.8,
          speed: 0.9,
          rise: 0.35,
          color: 0x9a8f7e,
          opacity: 0.3,
        });
      })();
    }

    // A field gun does not stop at the body: the stone takes the rest of it.
    if (gun.wave) {
      audio.groundSlam({ pan: this.stereoPan(victimSpot), volume: Math.min(1, power * 0.5) });
      void spawnGroundWave(this.scene, this.tweens, victimSpot, {
        color: gun.wave.color,
        radius: gun.wave.radius,
        height: BOARD_TOP + 0.03,
        echo: true,
      });
      // The field gun's round goes into the stone: a powder blast behind the body, sized by the shot.
      const blasted = this.playVfx("slam", this.onStone(victimSpot), this.vfxFor(power, undefined, "gun"), VFX_SEAT.slam);
      // ...and leaves its crater there, the soot thrown on the way the shot was going.
      this.burnStone("gun", this.spellArmy(attacker), victimSpot, attacker.container.position, gun.blast);
      this.effects.spawnSmoke(victimSpot.clone().setY(BOARD_TOP + 0.12), {
        count: Math.max(blasted ? 2 : 4, Math.round(settings.captureParticles * 0.28 * (blasted ? PROCEDURAL_SHARE : 1))),
        radius: 0.52,
        scale: 0.8,
        growth: 3.2,
        life: 1.3,
        speed: 2.2,
        rise: 0.1,
        color: 0x9c8f7d,
        opacity: blasted ? 0.34 : 0.5,
      });
    }

    if (gun.hold > 0) await wait(gun.hold);
    this.stopIfStale(revision);
    if (gun.aftershock > 0) void this.aftershock(strikeSquare, gun.aftershock);

    // The sight picture stops sweeping the moment the shot is away: a man who
    // has fired watches what he hit. The kneel is held — nothing about the body
    // changes between the report and the man across the board going down.
    if (aiming) attacker.setAimDrift(0.18);

    // Shot dead where it stood, before the shooter has moved a boot. Its blood pools where it lands.
    try {
      await this.slay(victim, blow, false, undefined, false, () => {
        if (!shot) return;
        const at = victim.combatPoint(new THREE.Vector3());
        this.gore?.land(shot, { x: at.x, z: at.z });
      });
    } finally { if (this.bleeding === victim) this.bleeding = null; }
    // banish reads the board it starts on: begun after an Undo, it would claim this body on the new board.
    this.stopIfStale(revision);

    void this.tweens.to({
      duration: 0.45,
      easing: Ease.outCubic,
      onUpdate: (t) => {
        this.camera.fov = this.lensFov - punch * (1 - t);
        this.camera.updateProjectionMatrix();
      },
    });

    // The body is cleared while the gun is served again — nobody advances on a
    // square with an empty barrel. A kneeling gunner reloads *on the knee* he
    // fired from and is not stood up by that beat.
    if (shot) this.gore?.bodyGone(shot);
    await Promise.all([this.banish(victim, blow), this.reload(attacker, gun)]);
    this.stopIfStale(revision);

    // ...then, and only then, he comes up off the stone.
    if (kneeling) await this.riseToFeet(attacker, from);
    this.stopIfStale(revision);

    // ...and only now is the square walked to.
    this.focusPiece(attacker, 0.94);
    await this.glide(attacker, from, to, false, 1.1);
  }

  /**
   * Up off the knee, once the shot is over and the body is gone.
   *
   * This is deliberately its own beat rather than a side effect of the reload or
   * of the march: the whole point of the kneeling shot is that the man holds one
   * stance from the moment he goes down until the moment there is nothing left to
   * shoot at. Standing up is the *reward* for that, so it is allowed the time it
   * takes and is heard — the boot taking his weight as the leg straightens.
   *
   * A rig whose rise clip has not landed falls back to a long crossfade into the
   * stance, which is slower than the old 0.22s snap and reads as getting up
   * rather than as popping upright.
   */
  private async riseToFeet(attacker: PieceView, at: THREE.Vector3): Promise<void> {
    const pan = this.stereoPan(at);
    const length = attacker.playRise(0.95);
    if (length <= 0) {
      attacker.playIdle(0.5);
      await wait(0.4);
      return;
    }
    audio.footstep({ pan, timbre: "scuff", volume: 0.5, delay: length * 0.55, jitter: -0.2 });
    await wait(length);
    // The clip is clamped on its standing frame, so the stance blends out of a
    // body that is already on its feet.
    attacker.playIdle(0.2);
  }

  /**
   * The barrel still smoking after the shot.
   *
   * The powder bank is made once, at the point the gun was fired, and left in
   * the air — which is right, because air does not follow a man around. But a
   * fouled bore keeps venting for a second or two afterwards, and *that* smoke
   * belongs to the weapon: it has to come out of the muzzle wherever the muzzle
   * has got to. So the wisps are emitted on a clock, each one reading
   * {@link PieceView.muzzleOrigin} at the moment it is made, and the thread of
   * smoke visibly trails the barrel as the marksman brings his rifle down out of
   * the kneel.
   *
   * Each wisp is thinner and slower than the last: the bore is cooling.
   */
  private boreTrickle(attacker: PieceView, gun: GunProfile, tint: number): void {
    const settings = QUALITY_SETTINGS[this.preset];
    // The lowest preset has no budget for smoke that is not part of the kill.
    if (settings.captureParticles < 34 || gun.boreSmoke.wisps <= 0) return;
    const { seconds, wisps } = gun.boreSmoke;
    const width = 0.1 + gun.calibre * 0.18;
    let next = 0;
    void this.tweens.to({
      duration: seconds,
      easing: (t: number) => t,
      onUpdate: (t: number) => {
        if (t < next) return;
        next += 1 / wisps;
        // 0 on the frame after the shot, 1 as the bore goes cold.
        const cooling = Math.min(1, t);
        this.effects.spawnSmoke(attacker.muzzleOrigin(), {
          count: 1,
          radius: width * 0.5,
          scale: width * (0.7 + cooling * 0.75),
          growth: 2.9,
          // The last threads hang around longest — they have the least to lose.
          life: (gun.fineSmoke ? 0.85 : 1.1) * (0.8 + cooling * 0.7),
          // Barely pushed: this is leaking out of the bore, not being blown out.
          speed: 0.16 * (1 - cooling * 0.5),
          rise: (gun.fineSmoke ? 0.34 : 0.24) * (1 - cooling * 0.3),
          color: tint,
          opacity: (gun.fineSmoke ? 0.2 : 0.28) * (1 - cooling * 0.55),
          drift: HALL_DRAFT,
        });
      },
    });
  }

  /**
   * Recoil. The shooter rocks back off the shot and settles; a towed gun runs
   * back hard on its wheels and is heaved up to the mark again, which is what
   * sells the weight of the charge more than any amount of smoke.
   */
  private kickBack(attacker: PieceView, blow: THREE.Vector3, gun: GunProfile): void {
    const reach = TILE * gun.kick;
    void (async () => {
      await this.tweens.to({
        duration: 0.07,
        easing: Ease.outQuint,
        onUpdate: (t) => {
          attacker.runtime.position.x = -blow.x * reach * t;
          attacker.runtime.position.z = -blow.z * reach * t;
          attacker.setStrikeTilt(-0.16 * t);
        },
      });
      await this.tweens.to({
        duration: 0.34,
        easing: Ease.outCubic,
        onUpdate: (t) => {
          attacker.runtime.position.x = -blow.x * reach * (1 - t);
          attacker.runtime.position.z = -blow.z * reach * (1 - t);
          attacker.setStrikeTilt(-0.16 * (1 - t));
        },
      });
      attacker.runtime.position.x = 0;
      attacker.runtime.position.z = 0;
      attacker.setStrikeTilt(0);
    })();

    if (gun.recoil <= 0 || !attacker.hasTrain) return;
    this.gunRecoil(attacker, gun);
  }

  /**
   * A field gun going off. The piece is not nudged — it is thrown: the wheels
   * leave the stone, the muzzle jumps, the carriage runs back the length of its
   * own trail, drops, rolls a little further, and is only then heaved up to the
   * mark again. Dust is hammered out from under the wheels on the frame it
   * fires, and the stone is heard taking the shock of the recoil a moment after
   * the report itself.
   */
  private gunRecoil(attacker: PieceView, gun: GunProfile): void {
    const settings = QUALITY_SETTINGS[this.preset];
    const carriage = attacker.trainOrigin();
    if (carriage) {
      const pan = this.stereoPan(carriage);
      // The trail slamming back over the stone, just behind the report.
      audio.groundSlam({ pan, volume: 0.34, delay: 0.05 });
      // ...and the wheels coming down again at the end of the run-back.
      audio.footstep({ pan, timbre: "plate", volume: 0.5, delay: 0.2, jitter: -0.18 });
      this.effects.spawnSmoke(carriage.clone().setY(BOARD_TOP + 0.05), {
        count: Math.max(3, Math.round(settings.captureParticles * 0.2)),
        radius: 0.34,
        scale: 0.5,
        growth: 2.8,
        life: 1,
        speed: 1.5,
        rise: 0.08,
        color: 0x9c8f7d,
        opacity: 0.42,
      });
      this.effects.spawnBurst(carriage.clone().setY(BOARD_TOP + 0.04), 0xc7ac82, Math.round(settings.captureParticles * 0.2), {
        speed: 2.6,
        life: 0.5,
        gravity: 3.2,
        radius: 0.16,
        size: 0.06,
        drag: 2.6,
      });
    }

    void (async () => {
      // The charge takes it: back and up in under a tenth of a second.
      await this.tweens.to({
        duration: 0.07,
        easing: Ease.outQuint,
        onUpdate: (t) => attacker.setTrainRecoil(gun.recoil * t, t),
      });
      // The wheels find the stone again while the piece is still running back.
      await this.tweens.to({
        duration: 0.22,
        easing: Ease.outCubic,
        onUpdate: (t) =>
          attacker.setTrainRecoil(gun.recoil * (1 + t * 0.14), Math.pow(1 - t, 1.6)),
      });
      // Then the crew heaves it up to the mark: slow, as it would be.
      await this.tweens.to({
        duration: 0.86,
        easing: Ease.inOutCubic,
        onUpdate: (t) => attacker.setTrainRecoil(gun.recoil * 1.14 * (1 - t)),
      });
      attacker.setTrainRecoil(0);
    })();

    // The hall takes the recoil a beat after the shot, not with it.
    void (async () => {
      await wait(0.06);
      this.shake.add(0.34);
    })();
  }

  /**
   * Serving the piece again after a shot: the drill clip if the rig carries one,
   * with the ramrod and the lock heard over it. Kept to the length of the body
   * being cleared away, so the beat costs the fight nothing.
   *
   * A standing gunner is handed back to his stance at the end of it. A kneeling
   * one is **not**: his reload is authored on the knee, and standing him up here
   * would put a stance change in the middle of the beat that is supposed to be
   * the one thing he does without moving. He is stood up afterwards, once, by
   * {@link SceneEngine.riseToFeet}.
   */
  private async reload(attacker: PieceView, gun: GunProfile): Promise<void> {
    if (!attacker.hasClip("reload")) return;
    const pan = this.stereoPan(attacker.container.position);
    const length = attacker.playReload();
    if (length <= 0) return;
    audio.gunLock({ pan, weight: gun.calibre, volume: 0.42, delay: length * 0.28 });
    audio.gunLock({ pan, weight: gun.calibre * 0.6, volume: 0.32, delay: length * 0.62 });
    await wait(Math.min(length, 0.95));
    if (!gun.stance.kneel) attacker.playIdle(0.22);
  }

  /** Caster with no clip: the shoulders go back over the gathering fire. */
  private async castWind(attacker: PieceView, duration: number): Promise<void> {
    await this.tweens.to({
      duration: Math.max(0.14, duration * 0.85),
      easing: Ease.outCubic,
      onUpdate: (t) => attacker.setStrikeTilt(-0.22 * t),
    });
  }

  /** The release: the staff comes down and the body follows the bolt out. */
  private castRelease(attacker: PieceView, direction: THREE.Vector3): void {
    const reach = TILE * 0.2;
    const push = (offset: number, tilt: number) => {
      attacker.runtime.position.x = direction.x * offset;
      attacker.runtime.position.z = direction.z * offset;
      attacker.setStrikeTilt(tilt);
    };
    void (async () => {
      await this.tweens.to({
        duration: 0.14,
        easing: Ease.outQuint,
        onUpdate: (t) => push(reach * t, THREE.MathUtils.lerp(-0.22, 0.26, t)),
      });
      await this.tweens.to({
        duration: 0.38,
        easing: Ease.outCubic,
        onUpdate: (t) => push(reach * (1 - t), 0.26 * (1 - t)),
      });
      push(0, 0);
    })();
  }

  /** The army a caster fights for: what its whole spell is coloured by, whichever side of the board it plays. */
  private spellArmy(caster: PieceView): ArmySkinId {
    return this.factory.getSkins()[caster.color];
  }

  /** The look of a caster's spell (orb, light, motes, trail, ring), by its army and never by its side. */
  private spellLook(caster: PieceView): SpellLook {
    return spellLookFor(this.factory.getSkins(), caster.color);
  }

  /** How bright a ball of fire is drawn in this arena's exposure, so its colour is not clipped away (as the bursts). */
  private spellGlow(): number {
    return vfxGlow(this.displayExposure());
  }

  /**
   * The exposure the frame is shown at, which everything that is light itself is drawn against (vfx/wiring.ts vfxGlow
   * and vfxLight). Under the arena's look pipeline that is the pipeline's grade, about 1: the renderer's own exposure,
   * 5 in an arena with baked lighting, is never applied there, and drawing fire against it left every spell, summon,
   * burn and the Claiming at about a third of its brightness in both 360 arenas. Without the pipeline (the baked arena
   * it falls back to, and every other arena) it is the renderer's.
   */
  private displayExposure(): number {
    return this.battlefieldRenderer ? this.battlefieldRenderer.exposure() : this.renderer.toneMappingExposure;
  }

  /** A spell colour laid on the stone (the shock ring, the bloom on the struck tile, the sorceress's ring), held to this arena's exposure so it stays a colour. */
  private spellTone(color: number): number {
    return this.vfxColour.setHex(color).multiplyScalar(this.spellGlow()).getHex();
  }

  // ------------------------------------------------------------------ flourishes (vfx/flourish)

  /** The flourishes, where they may be drawn now: none under reduced motion, on the tactical map or on the menu's board. */
  private flourishing(): CombatFlourish | null {
    if (!this.flourish || this.reducedMotion || this.tactical || this.menuPresentation || this.attract || this.silentBoard()) return null;
    return this.flourish;
  }

  /**
   * The dice of one flourish (the scatter of its shards, the sparks its arc sheds, its starburst's fan, its ribbons'
   * spirals), drawn from the match's own show dice for this ply (showDice): a replay draws the very same, another match
   * other ones. What a flourish is (which sigil, an arc's path and side, how many shards) is never left to dice: it follows
   * from the kingdom, the blade's own swing, the blow and the preset.
   */
  private flourishSeed(salt: string): number {
    return Math.floor(this.showDice(`flourish ${salt}`)() * 0x100000000) >>> 0;
  }

  /**
   * The one hue a killing blow's black and white keeps (moments/momentPlan.ts blowAccent), for the colour a flourish of
   * that blow is kept in (vfx/flourish/flourishPlan.ts keptLook): worked out from the very armies and side the blow's
   * moment is (momentBlow), so a flourish struck before the moment begins, or traced long before, agrees with it.
   */
  private blowHue(attacker: PieceView, victim: PieceView): number {
    return blowAccent(this.spellArmy(attacker), this.spellArmy(victim), victim.color, this.blowPalette(attacker, victim)).hue;
  }

  /**
   * Starts tracing a killer's blade for its killing swing's light arc, unseen until the blow lands: the tip of its weapon
   * and a point half way back along it to the hand, after animation and contact IK. False for a figure with no weapon
   * (a Kwind-09 courier kicks), or where no flourish may be drawn. Only the killer's blade is traced; `victim` gives the
   * blow's kept colour.
   */
  private traceKillingSwing(id: string, attacker: PieceView, victim: PieceView): boolean {
    const flourish = this.flourishing();
    if (!flourish || !attacker.goreAnchors().weapon) return false;
    return flourish.beginArc(id, weaponEdge(() => attacker.goreAnchors().weapon), this.spellArmy(attacker), this.flourishSeed("arc"), 1, this.blowHue(attacker, victim));
  }

  /**
   * A kill's flakes and chips, in the killer's colours: out of the wound (or the chest), thrown on along the blow, and
   * chips torn up from the stone under the victim. The killer's light arc, if one is drawn, parts round the wound.
   */
  private flourishKill(arc: string | null, attacker: PieceView, victim: PieceView, wound: THREE.Vector3 | null, blow: THREE.Vector3, power: number): void {
    const flourish = this.flourishing();
    if (!flourish) return;
    const at = wound ? this.flourishAt.copy(wound) : victim.combatPoint(this.flourishAt);
    if (arc) flourish.clearArcAround(arc, at, 0.2);
    const stone = victim.container.position;
    flourish.shatter(at, { x: stone.x, y: BOARD_TOP, z: stone.z }, blow, this.spellArmy(attacker), THREE.MathUtils.clamp(power, 0.6, 1.8), this.flourishSeed("shatter"), this.camera.position, this.blowHue(attacker, victim));
  }

  /**
   * A spell's blow: the caster's sigil stamped behind the victim, facing the eye, with its starburst; for Solforiz, blades
   * of crystalline fire round the body; and the blow's flakes and chips.
   */
  private stampBlow(caster: PieceView, victim: PieceView, blow: THREE.Vector3, power: number): void {
    const flourish = this.flourishing();
    if (!flourish) return;
    const army = this.spellArmy(caster), chest = victim.combatPoint(this.flourishAt), stone = victim.container.position, hue = this.blowHue(caster, victim);
    flourish.stamp(chest, this.camera.position, army, power, this.flourishSeed("sigil"), hue);
    // Solforiz's fire breaks as crystalline blades of flame round the body, never across it
    if (army === "sun") flourish.flare(chest, this.camera.position, army, power, this.flourishSeed("flare"), hue);
    flourish.shatter(chest, { x: stone.x, y: BOARD_TOP, z: stone.z }, blow, army, Math.min(1.8, power), this.flourishSeed("shatter"), this.camera.position, hue);
  }

  /**
   * Starts tracing the blade of a figure a rite borrowed and made a giant of (the shadow colossus: a troop scaled past
   * twice a man's size, with a weapon socket), unseen until its blow lands. The arc is thickened with it. Null where the
   * rite has no such figure, or no flourish may be drawn.
   */
  private traceRiteBlade(id: string, lent: readonly PieceView[], army: ArmySkinId, queen: PieceView, victim: PieceView): string | null {
    const flourish = this.flourishing();
    const giant = lent.find(view => view.container.scale.x > 2 && view.goreAnchors().weapon) ?? null;
    if (!flourish || !giant) return null;
    const scale = Math.min(2.2, giant.container.scale.x / 2);
    return flourish.beginArc(id, weaponEdge(() => giant.goreAnchors().weapon), army, this.flourishSeed("rite arc"), scale, this.blowHue(queen, victim)) ? id : null;
  }

  /**
   * A summon's killing strike, as a crescent of light: along the real blade where one was traced (`traced`: the shadow
   * colossus's sabre), else swept through the victim's chest by a virtual blade: the colossus's sabre down from over its
   * seal, talons raking (the wyvern's and the phoenix's), the dead clawing (Kwind-09's). Then the Queen's sigil stamped
   * where it struck, and the shards.
   */
  private summonFlourish(entry: RiteEntry, queen: PieceView, victim: PieceView, blow: THREE.Vector3, traced: string | null = null): void {
    const flourish = this.flourishing();
    if (!flourish) return;
    const chest = victim.combatPoint(new THREE.Vector3()), up = new THREE.Vector3(0, 1, 0), forward = blow.clone().setY(0);
    if (forward.lengthSq() < 1e-6) forward.set(0, 0, -1);
    forward.normalize();
    const side = new THREE.Vector3().crossVectors(up, forward).normalize(), seed = this.flourishSeed("summon"), hue = this.blowHue(queen, victim);
    const id = `${this.boardRevision}:summon`;
    if (traced) {
      // the giant's own steel, drawn as it lands, parting round the wound
      flourish.revealArc(traced);
      flourish.clearArcAround(traced, chest, 0.3);
    } else if (entry.army === "empire") {
      // the colossus's sabre: down from above and behind, over the seal, through the body and on
      const from = up.clone().multiplyScalar(0.82).addScaledVector(forward, -0.57), toward = up.clone().multiplyScalar(0.57).addScaledVector(forward, 0.82);
      flourish.slash(id, chest.clone().addScaledVector(up, 0.12).addScaledVector(forward, -0.08), from, toward, entry.army, { radius: 0.95, thickness: 0.38, sweep: 2.25, seconds: 0.15 }, seed, hue);
    } else {
      // talons, or the dead's claws: parallel rakes across the chest, down and on along the blow
      const rakes = entry.army === "kwind" ? 2 : 3;
      const from = up.clone().multiplyScalar(0.92).addScaledVector(forward, -0.38), toward = forward.clone().multiplyScalar(0.92).addScaledVector(up, 0.38);
      for (let k = 0; k < rakes; k += 1) {
        const at = chest.clone().addScaledVector(side, (k - (rakes - 1) / 2) * 0.09).addScaledVector(forward, -0.05).addScaledVector(up, 0.06);
        flourish.slash(`${id}:${k}`, at, from, toward, entry.army, { radius: 0.46, thickness: 0.11, sweep: 1.85, seconds: 0.11 + 0.025 * k }, seed + k, hue);
        flourish.clearArcAround(`${id}:${k}`, chest, 0.16);
      }
    }
    flourish.clearArcAround(id, chest, 0.18);
    flourish.stamp(chest, this.camera.position, entry.army, 1.5, seed ^ 0x5a5a, hue);
    if (entry.army === "sun") flourish.flare(chest, this.camera.position, entry.army, 1.5, seed ^ 0x1f1f, hue);
    const stone = victim.container.position;
    flourish.shatter(chest, { x: stone.x, y: BOARD_TOP, z: stone.z }, forward, entry.army, 1.5, seed ^ 0x3c3c, this.camera.position, hue);
  }

  /**
   * Where a caster's gathering ribbons spiral in to: the focus of its staff or wand (weapons.ts `focus_`, the prop's own
   * casting point), found once, then sampled every frame without allocating; the figure's own cast origin otherwise.
   */
  private castHand(caster: PieceView): HandSampler {
    const focus = caster.goreAnchors().weapon?.parent?.children.find(child => child.name.startsWith("focus_")) ?? null;
    if (focus) return out => focus.getWorldPosition(out);
    return out => out.copy(caster.castOrigin());
  }

  // ------------------------------------------------------------------ summons

  /** The summon a Queen's capture gets: her kingdom's, for any piece larger than a Pawn. Null when it is not built. */
  private summonFor(attacker: PieceView, victim: PieceView): RiteEntry | null {
    return this.summons(attacker.kind, victim.kind, this.spellArmy(attacker)) ? riteFor(this.spellArmy(attacker)) : null;
  }

  /** Whether a capture is a Queen's summon: hers, of anything larger than a Pawn, where her kingdom has one built. */
  private summons(attacker: PieceKind, victim: PieceKind, army: ArmySkinId): boolean {
    if (attacker !== "q" || victim === "p" || victim === "k") return false;
    // Not in the menu's background game: nothing there takes the camera or carries a body.
    if (this.silentBoard() || this.menuPresentation || this.attract) return false;
    return riteFor(army) !== null;
  }

  /**
   * A Queen's summon (rites/rite.ts). She stands where she is and calls; what comes kills the piece in its own
   * way, and may carry the body before it lets it fall. The rite only draws what it brings: the kill, the body,
   * the blood, the sound and the shake are the match's, on the frames the rite names. Afterwards the body lies
   * on the board and is taken like any other, and the Queen walks to the square. False when the rite cannot be
   * had (its model would not load): nothing has happened yet, and the caller casts a spell instead.
   */
  private async playSummonCinematic(
    entry: RiteEntry, attacker: PieceView, victim: PieceView, from: THREE.Vector3, to: THREE.Vector3, strikeSquare: SquareId, pair: CombatSession,
  ): Promise<boolean> {
    const revision = this.boardRevision;
    const victimSpot = victim.container.position.clone();
    const blow = victimSpot.clone().sub(from).setY(0);
    if (blow.lengthSq() < 1e-6) blow.set(0, 0, -1);
    blow.normalize();
    const standing: { x: number; z: number }[] = [];
    for (const piece of [...this.pieces.values(), ...this.motion]) if (piece !== victim && !piece.isSlain) standing.push({ x: piece.container.position.x, z: piece.container.position.z });
    const lent: PieceView[] = [];
    // Kept here as well as on the rite: what came may have gone before the body is down.
    const impacts: string[] = [];
    const effect = entry.make({
      queen: { x: from.x, y: BOARD_TOP, z: from.z }, hand: out => out.copy(attacker.castOrigin()),
      victim: victim.kind, victimHeight: PIECE_HEIGHT[victim.kind], stone: { x: victimSpot.x, y: BOARD_TOP, z: victimSpot.z },
      chest: out => victim.combatPoint(out), standing,
      viewer: { x: this.camera.position.x, y: this.camera.position.y, z: this.camera.position.z },
      muster: (kind, count) => this.musterTroops(attacker.color, kind, count, lent),
      violence: this.goreIntensity,
      army: this.spellArmy(attacker), look: this.spellLook(attacker), quality: this.preset, brief: false,
      seed: this.controller.getSnapshot().moves.length * 7919 + strikeSquare.charCodeAt(0) * 31 + strikeSquare.charCodeAt(1),
      boardTop: BOARD_TOP, tile: TILE, hall: HALL_INNER_RADIUS,
    });
    // What it brings must be there to be seen; a rite that cannot be had within a few seconds is not waited for.
    const had = await Promise.race([effect.ready.then(() => true, () => false), new Promise<boolean>(resolve => setTimeout(() => resolve(false), 6000))]);
    if (!had || this.isStale(revision)) {
      effect.dispose();
      for (const troop of lent) { troop.container.removeFromParent(); troop.dispose(); }
      if (this.isStale(revision)) throw new CombatCancelled();
      return false;
    }
    effect.setGain(this.spellGlow());
    this.scene.add(effect.object);
    // A blade of our own in what came (the shadow colossus's sabre, a figure of the Queen's army four times a man's
    // height) is traced unseen from now, so its killing stroke leaves its arc along the real steel (vfx/flourish).
    const riteBlade = this.traceRiteBlade(`${revision}:rite-blade`, lent, entry.army, attacker, victim);
    let struck: (landed: boolean) => void = () => {}, released = () => {}, done = () => {};
    const whenStruck = new Promise<boolean>(resolve => { struck = resolve; });
    const whenReleased = new Promise<void>(resolve => { released = resolve; });
    const whenDone = new Promise<void>(resolve => { done = resolve; });
    // How the piece dies under it, in the Violence setting's form.
    const style = riteDeathStyle(effect.death, {
      intensity: this.goreIntensity, reducedMotion: this.reducedMotion, physics: this.physicsDeaths,
      tactical: this.tactical, menuBoard: this.menuPresentation || this.attract || this.silentBoard(),
    });
    const carried = style === "held" || style === "held-burn";
    this.showTrace("rite", { id: entry.id, death: effect.death, style, seed: this.controller.getSnapshot().moves.length * 7919 + strikeSquare.charCodeAt(0) * 31 + strikeSquare.charCodeAt(1) });
    // Set alight in the grip as it is taken (a phoenix's talons): it burns as it is carried, and lies a husk.
    const aflame = style === "held-burn";
    this.endRite();
    this.rite = {
      effect, victim, state: null, light: null, asked: false, struck, released, done, wasStruck: false, wasReleased: false, troops: lent, camera: null, shot: -1, carried, attacker, impacts,
      // What its tearings may take off is decided once, as it is called (death/sever/severPlan.ts).
      sever: this.riteSevers(effect.death, attacker, victim), severed: 0, opened: null,
    };
    // The camera watches it beat by beat (RiteState.frame), from the player's side.
    const first = effect.update(0, this.camera, this.renderer.domElement.height);
    const camera = this.beginRiteCamera(first.frame, { from, to: victimSpot });
    if (camera && this.rite) { this.rite.camera = camera; this.rite.shot = first.shot; }
    // No rank crest floats in it (closeShotHolds).
    if (camera) this.castShot = camera;
    let handed = false;
    try {
      // The Queen turns on the piece and calls; the piece sees what is coming for it.
      victim.braceForImpact(from);
      await pair.stage("approach", () => Promise.all([attacker.turnTowards(victimSpot, this.tweens, 0.34), victim.turnTowards(from, this.tweens, 0.32)]));
      attacker.faceTowards(victimSpot);
      this.wake(victim);
      const pan = this.stereoPan(attacker.container.position);
      const cast = attacker.arsenal !== "empire" && attacker.hasClip("attack") ? attacker.playAttack() : null;
      if (!cast || cast.duration <= 0) void this.castWind(attacker, Math.min(1.2, effect.strikeAt));
      // She gathers her kingdom's own magic as she calls, not always fire: the gathering of the spell her page opens
      // with (cold wind for Aethelgard, the void's breath for Korvenia, current for Kwind-09); Solforiz's is fire.
      const calling = { pan, duration: Math.min(1.4, effect.strikeAt), volume: 1.3 };
      const gathering = SUMMON_GATHER[entry.army];
      if (!gathering || !audio.spellGather(gambitSound.spellCue(gathering, "gather"), calling)) audio.spellCharge(calling);
      attacker.flareAura(1.3);
      // Her kingdom's light spirals in to her hand while she calls (vfx/flourish).
      this.flourishing()?.beginGather(`${revision}:summon`, this.castHand(attacker), calling.duration, entry.army, this.flourishSeed("gather"));
      // The hall darkens from her call until just after what she called strikes (moments/): less than for a spell, as it
      // holds for the whole rite and the rite is what is watched.
      this.moments.darken(true, true);

      const landed = await pair.stage("strike", () => whenStruck);
      if (!landed) throw new CombatCancelled();
      // Away from whatever dealt the blow.
      const dealt = this.rite?.state?.blow;
      if (dealt) {
        const away = victimSpot.clone().sub(new THREE.Vector3(dealt.from.x, victimSpot.y, dealt.from.z)).setY(0);
        if (away.lengthSq() > 1e-6) blow.copy(away.normalize());
      }
      await pair.stage("contact", () => {
        this.livePlea?.cut();
        this.moments.struck();
        victim.takeHit(blow);
        this.reactToImpact(victimSpot, 1, victim, attacker);
        // What came drew its own blow (talons, fire, the shadow's blast, the dead's hands): the match adds the stone's
        // jolt under it in the kingdom's light and the camera's kick, but no white flash on the wound and no
        // forge-orange sparks, which were a blade's second blow on top of it (as the spells' was, spellBurst).
        this.board.impact(strikeSquare, this.spellTone(this.spellLook(attacker).light), 1.3, 0, 0);
        this.shake.add(0.22 * 1.3);
        // What came strikes as a crescent of light, and the Queen's sigil is stamped where it struck (vfx/flourish).
        this.flourish?.endGather(`${revision}:summon`);
        this.summonFlourish(entry, attacker, victim, blow, riteBlade);
        // Not the Queen's own steel: what came dealt the blow, and is heard by its own sounds (the rite's strike
        // cue). The body takes it as it dies under it: talons go in, fire sears, a tearing apart crushes.
        const flesh = captureLayers({ silentBoard: this.silentBoard(), spell: false }).flesh;
        if (flesh) audio.fleshWound(RITE_FLESH[effect.death], { pan: this.stereoPan(victimSpot) });
        if (carried) {
          // Dead in its grip: limp from here, wherever it is carried.
          this.lastCry(victim);
          this.cried.delete(victim);
          victim.playDeath();
          if (aflame) this.burnInGrip(victim, blow);
        }
        // A fatal summon holds its struck frame (fatality/): where its first wound opened, else at the chest.
        const opened = this.rite?.victim === victim ? this.rite.opened : null;
        if (opened) this.fatalityBlow(victim, attacker, opened.at.clone(), opened.direction.clone(), true);
        else this.fatalityBlow(victim, attacker, this.chestWound(victim, blow), blow);
      });
      await pair.stage("fall", async () => {
        if (carried) {
          // It is let go (or was never lifted), and comes to the stone.
          await Promise.race([whenReleased, whenDone]);
          if (this.isStale(revision)) throw new CombatCancelled();
          await this.dropBody(victim, victimSpot, blow, standing, pair);
          if (aflame) {
            // It lies where it came down, a husk, and smoulders a while before the square is taken.
            await this.untilSettled(victim, revision);
            if (this.isStale(revision)) throw new CombatCancelled();
            await pair.wait(Math.min(0.8, this.burning?.landHeld(victim) ?? 0));
          }
          return;
        }
        // A death of its own, in its own form: burnt, torn apart, thrown down.
        this.killedBy.set(victim, { source: effect.death === "burn" ? "spell" : "melee", by: "q" });
        if (!carried) this.forcedDeath.set(victim, style as DeathStyle);
        // A limb just taken off (death/sever) is seen to come away, and the stump to spurt, before the body bursts:
        // the undead army and the shadow colossus sever on their killing blow and then tear the body apart.
        if (style === "explode" && (this.deathPhysics?.severs.without(victim).length ?? 0) > 0) await pair.wait(SEVER_BEFORE_BURST);
        await this.slay(victim, blow, true, pair);
      });
      // The rite's blood pools where the body has come to rest.
      this.landRiteWounds(victim, impacts);
      // The claim's shot takes over from this one where the claim will be watched; otherwise the player's view
      // comes back now.
      if (this.rite?.camera && this.duelCamera?.timeline === this.rite.camera && this.claimIsWatched(victim)) { this.claimShotOwed = victim; handed = true; }
      // The body is taken where it lies, and only then is the square walked to. What came may still be leaving.
      await pair.stage("advance", async () => {
        if (!handed) this.letRiteCameraGo();
        await this.banish(victim, blow);
        this.stopIfStale(revision);
        if (cast) attacker.playIdle(0.2);
        this.focusPiece(attacker, 0.94);
        await this.glide(attacker, from, to, false, 1.15);
      });
      await pair.stage("complete", () => {});
      return true;
    } finally {
      // However it ended, a shot not handed to the claim goes home, and the hall's light comes back.
      if (!handed) this.letRiteCameraGo();
      if (this.claimShotOwed === victim && this.isStale(revision)) this.claimShotOwed = null;
      // and the giant's blade is no longer traced (its arc, if drawn, fades as it would)
      if (riteBlade) this.flourish?.stopArc(riteBlade);
      this.moments.darken(false);
    }
  }

  /**
   * Takes the camera for a summon or a spell, framing what it names (rites/riteShot.ts), under the duel shot's own
   * conditions. `aim` is a caster and the piece it casts at: the shot turns off the line between them where it would
   * otherwise look straight along it, and keeps that turn ({@link shotTurnNow}) for its later beats.
   */
  private beginRiteCamera(
    frame: readonly { x: number; y: number; z: number }[], aim?: { from: THREE.Vector3; to: THREE.Vector3 },
    options: { close?: boolean; lens?: number; reach?: number; easeIn?: number; turn?: number; down?: number } = {},
  ): DuelCameraTimeline | null {
    if (frame.length === 0) return null;
    const taking = this.riteCameraHome();
    if (!taking) return null;
    this.shotTurnNow = options.turn ?? (aim ? shotTurn(taking.home, aim.from, aim.to) : 0);
    const shot = this.riteDuelShot(frame, taking.home, this.shotTurnNow, options.close ?? false, options.lens, options.reach, options.down);
    return this.takeRiteCamera(taking, shot, options.easeIn ?? 1.1);
  }

  /**
   * Whether a summon's or a spell's shot may take the camera now, under the duel shot's own conditions, and if so
   * where the camera is and the view the shot goes home to: the player's, or the one a shot still easing home remembers.
   */
  private riteCameraHome(): { here: CameraPose; home: CameraPose } | null {
    if (!this.captureCinematics || this.reducedMotion || this.tactical || this.menuPresentation || this.attract || this.introPlaying) return null;
    let previous = this.duelCamera;
    if (previous && previous.revision !== this.conclusionCameraRevision) { this.endDuelCamera(false); previous = null; }
    if (!previous && (this.cameraScripted || this.conclusionViewActive)) return null;
    const here: CameraPose = { position: this.camera.position.clone(), target: this.controls.target.clone(), fov: previous?.fov ?? this.lensFov };
    return { here, home: previous ? previous.timeline.home : here };
  }

  /** Takes the camera from where it is (`taking`, from riteCameraHome) into `shot`, over `easeIn` seconds. */
  private takeRiteCamera(taking: { here: CameraPose; home: CameraPose }, shot: DuelShot, easeIn: number): DuelCameraTimeline {
    const timeline = new DuelCameraTimeline({ ...taking.home, fov: this.lensFov }, shot, { from: taking.here, easeIn, easeOut: 1.2 });
    this.duelCamera = { timeline, revision: this.conclusionCameraRevision, lens: this.lensFov, fov: taking.here.fov, punch: () => 0 };
    this.controls.enabled = false;
    this.cameraScripted = true;
    this.controls.minDistance = Math.min(this.controls.minDistance, .5);
    // It may have to look up at something in the sky.
    this.controls.maxPolarAngle = Math.PI - 0.05;
    return timeline;
  }

  /**
   * The duel shot that frames a summon's or a spell's beat, from the player's side of it, turned by `turn` radians;
   * `close` for a kill watched up close (rites/riteShot.ts), on `lens` (degrees; the match's own by default),
   * framing no less than `reach` round what it watches and looking `down` that many degrees (a fatality's shot on
   * the wound), or `look` that many degrees down at what it frames whatever its height (a summon's beat that names it),
   * from `facing` (a flat direction from what it frames) where the beat names a side other than the player's.
   */
  private riteDuelShot(frame: readonly { x: number; y: number; z: number }[], home: CameraPose, turn = 0, close = false, lens = this.lensFov, reach?: number, down?: number, look?: number, facing?: { x: number; z: number }): DuelShot {
    return this.riteView(riteShot(frame, {
      home: turnHome(home, turn), boardTop: BOARD_TOP, aspect: this.camera.aspect, fov: lens, radius: HALL_INNER_RADIUS - FOLLOW_WALL_MARGIN, close,
      ...(reach !== undefined ? { closeReach: reach } : {}), ...(down !== undefined ? { down } : {}), ...(look !== undefined ? { look } : {}),
      ...(facing ? { facing } : {}),
    }));
  }

  /** A view of rites/riteShot.ts (or rites/spellShot.ts) as a duel shot the camera's timeline can hold. */
  private riteView(view: RiteShotView): DuelShot {
    return { ...view, push: view.position, killSeen: true, side: 1, lean: 0, pitch: 0, distance: 0, occlusion: 0, fill: 0, confined: false };
  }

  /** Lets the summon's shot go home, if it still holds the camera. */
  private letRiteCameraGo(): void {
    const camera = this.rite?.camera ?? null;
    if (this.rite) this.rite.camera = null;
    if (camera && this.duelCamera?.timeline === camera) this.releaseDuelCamera();
  }

  /**
   * Lends a summon `count` figures of the Queen's army (rites/rite.ts RiteTroop): made here, hidden until the rite
   * places them, animated every frame with the rite, freed with it. No badge, no ring under them.
   */
  private musterTroops(color: Faction, kind: PieceKind, count: number, lent: PieceView[]): RiteTroop[] {
    const settings = QUALITY_SETTINGS[this.preset];
    const room = Math.max(0, Math.min(Math.floor(count), 24 - lent.length));
    const troops: RiteTroop[] = [];
    for (let index = 0; index < room; index += 1) {
      const view = this.factory.create(kind, color, { contactShadows: settings.contactShadows, idleAnimation: true, rankBadge: false, dynamicMotion: false });
      view.setBadgeEnabled(false);
      view.setPresentationLook(true);
      view.container.visible = false;
      this.scene.add(view.container);
      lent.push(view);
      // Their strides are fetched now; a stride asked for before it arrives is simply not played.
      void this.armStride(view, "run"); void this.armStride(view, "walk");
      troops.push({
        object: view.container,
        height: PIECE_HEIGHT[kind],
        play: (clip, rate = 1.6) => {
          if (clip === "idle") { view.stopMarch(0.2); view.playIdle(0.2); return 1; }
          if (clip === "walk" || clip === "run") return view.startMarch(clip, rate) ? 1 : 0;
          if (clip === "attack") return view.hasClip("attack") ? view.playAttack().duration : 0;
          return view.playDeath();
        },
        setOpacity: value => view.setOpacity(value),
        setDissolve: value => view.setDissolve(value),
      });
    }
    return troops;
  }

  /**
   * A body set alight in a summon's grip (rites/rite.ts `held-burn`): it chars and burns as it is carried, in the
   * Queen's kingdom's fire (death/burn), and is let fall by {@link dropBody} like any other held body.
   */
  private burnInGrip(victim: PieceView, blow: THREE.Vector3): void {
    this.burning?.igniteHeld(victim, blow, {
      quality: this.preset, reducedMotion: false, source: "spell", army: this.factory.getSkins()[victim.color === "w" ? "b" : "w"],
      height: PIECE_HEIGHT[victim.kind], seed: combatSeed(this.controller.getSnapshot().sanList, "burn"),
    });
  }

  /**
   * A body let go in the air comes down: as a ragdoll where physics has loaded and the settings allow one,
   * otherwise straight down onto its own square, where its death clip has it lying. A body that was never
   * lifted is already there.
   */
  private async dropBody(victim: PieceView, home: THREE.Vector3, blow: THREE.Vector3, standing: readonly { x: number; z: number }[], pair: CombatSession): Promise<void> {
    const start = victim.container.position.clone();
    const height = start.y - home.y;
    if (height < 0.05 && start.distanceToSquared(home) < 0.01) return;
    if (ragdollWanted(this.goreIntensity, this.reducedMotion) && this.physicsDeaths && this.deathPhysics?.fall(victim, {
      direction: { x: blow.x, z: blow.z }, power: 0.15, point: victim.combatPoint(new THREE.Vector3()).toArray(), height: PIECE_HEIGHT[victim.kind], standing: [...standing],
    })) return;
    const turned = victim.container.quaternion.clone(), upright = new THREE.Quaternion();
    // Free fall from where it was let go, drifting back over its own square.
    const seconds = Math.max(0.25, Math.sqrt(2 * Math.max(0, height) / 9.8));
    await this.tweens.to({
      duration: seconds, easing: Ease.linear,
      onUpdate: t => {
        victim.container.position.set(THREE.MathUtils.lerp(start.x, home.x, t), start.y - height * t * t, THREE.MathUtils.lerp(start.z, home.z, t));
        victim.container.quaternion.slerpQuaternions(turned, upright, Math.min(1, t * 1.4));
      },
    });
    // A board replaced during the fall has cancelled this pair: nothing lands on the new one.
    if (pair.phase === "cancelled") return;
    victim.container.position.copy(home); victim.container.quaternion.copy(upright);
    if (!this.silentBoard()) audio.bodyFall(1, victim.kind);
    this.shake.add(0.14);
    this.effects.spawnBurst(home.clone().setY(BOARD_TOP + 0.1), 0x9c8a6a, 22, { speed: 1.6, life: 0.7 });
    this.stirAir("fall", home.x, BOARD_TOP, home.z, 1.2);
    await pair.wait(0.25);
  }

  /** Advances the summon on the board: carries the body where it is held, and acts on what the rite says this frame. */
  private updateRite(delta: number): void {
    const rite = this.rite;
    if (!rite) return;
    const state = rite.effect.update(delta, this.camera, this.renderer.domElement.height);
    rite.state = state;
    rite.effect.setGain(this.spellGlow());
    for (const troop of rite.troops) troop.update(delta, this.elapsed);
    // A new beat: the camera moves on to frame it.
    if (rite.camera && state.shot !== rite.shot && state.frame.length > 0) {
      rite.shot = state.shot;
      if (this.duelCamera?.timeline === rite.camera) {
        const view = this.riteDuelShot(state.frame, rite.camera.home, 0, state.close === true, this.lensFov, undefined, undefined, state.look, state.facing);
        // A fatality holds the close shot on the wound: the rite's new beat is where the view goes back to after it.
        if (this.fatalityShot?.timeline === rite.camera) this.fatalityShot.back = view;
        // A close beat (the phoenix's body in its talons) is a straight cut: a move into it passed through the bird's
        // flames and feathers on the way, and the whole beat holds the body. The other beats keep their moves.
        else rite.camera.moveTo(view, state.close ? 0 : 0.95);
      } else rite.camera = null;
    }
    if (state.struck && !rite.wasStruck) {
      rite.wasStruck = true; rite.struck(true);
      // The summon's killing stroke: the hardest push the air is given.
      const at = rite.victim.combatPoint(this.riteChest);
      this.stirAir("rite", at.x, at.y, at.z, 1);
    }
    if (rite.carried && state.hold && !state.released) {
      // The chest goes where the rite holds it; the figure's own origin is at its feet.
      const victim = rite.victim, hold = state.hold;
      const up = this.riteUp.set(hold.up.x, hold.up.y, hold.up.z).normalize();
      const forward = this.riteForward.set(hold.forward.x, hold.forward.y, hold.forward.z);
      const side = this.riteSide.crossVectors(up, forward);
      if (side.lengthSq() > 1e-8) {
        side.normalize(); forward.crossVectors(side, up);
        victim.container.quaternion.setFromRotationMatrix(this.riteBasis.makeBasis(side, up, forward));
      }
      victim.container.updateMatrixWorld(true);
      const chest = victim.combatPoint(this.riteChest).sub(victim.container.position);
      victim.container.position.set(hold.position.x - chest.x, hold.position.y - chest.y, hold.position.z - chest.z);
    }
    if (state.released && !rite.wasReleased) { rite.wasReleased = true; rite.released(); }
    const gore = captureLayers({ silentBoard: this.silentBoard(), spell: false }).gore && this.goreIntensity !== "minimal";
    for (const wound of state.wounds) {
      this.riteWound(rite, wound);
      // A tearing from the killing blow on may take a limb with it (death/sever), while the budget lasts.
      if (woundSevers(rite.sever, { struck: rite.wasStruck, power: wound.power }, rite.severed) && this.severAt(rite.victim, wound.at, wound.direction, wound.power, rite.sever, rite.severed)) rite.severed += 1;
      // Its sound stays behind the same gate as every other wound (shared/play/gambit-sound.ts).
      const at = this.riteChest.set(wound.at.x, wound.at.y, wound.at.z);
      if (gore) audio.goreSplat({ pan: this.stereoPan(at), volume: Math.min(1, 0.6 * wound.power) });
    }
    for (const sound of state.sounds) this.riteSound(sound.cue, this.riteChest.set(sound.at.x, sound.at.y, sound.at.z), sound.volume);
    if (state.shake > 0 && !this.reducedMotion) this.shake.add(state.shake);
    if (state.glow && !rite.asked) { rite.asked = true; rite.light = this.spellLights.acquire(state.glow.colour, state.glow.reach); }
    if (rite.light) rite.light.set(state.glow ? this.riteForward.set(state.glow.position.x, state.glow.position.y, state.glow.position.z) : this.riteForward, state.glow ? state.glow.intensity * this.spellGlow() : 0);
    if (state.done) { rite.done(); this.endRite(); }
  }
  /**
   * A wound a rite opens, drawn as a killing blow through the gore system (gore/): the spray, a wound on the body,
   * stains, and later a pool where the body comes to rest. The system answers to the Violence setting itself.
   */
  private riteWound(rite: NonNullable<SceneEngine["rite"]>, wound: { at: { x: number; y: number; z: number }; direction: { x: number; y: number; z: number }; power: number; kind?: GoreEvent["wound"] }): void {
    if (!this.gore) return;
    const skins = this.factory.getSkins(), victim = rite.victim;
    const direction = new THREE.Vector3(wound.direction.x, wound.direction.y, wound.direction.z);
    if (direction.lengthSq() < 1e-8) return;
    direction.normalize();
    const ply = this.controller.getSnapshot().sanList.length, id = `rite-${rite.impacts.length}`;
    const plan = this.gore.begin({
      impactId: impactIdOf(ply, id), seed: goreSeed(ply * 7919 + rite.impacts.length, id), ply,
      // The rite's later wounds keep the blood of its earlier ones.
      follows: rite.impacts.length > 0,
      attacker: { kind: rite.attacker.kind as GoreKind, kingdom: skins[rite.attacker.color], weapon: wound.power > 1 ? "axe" : "sword" },
      defender: { kind: victim.kind as GoreKind, kingdom: skins[victim.color] },
      // Talons pierce, jaws bite, the dead tear, the colossus's sabre cuts (rites/rite.ts RiteWound).
      wound: wound.kind ?? "slash",
      moment: this.killMoment(victim, "summon"),
      contact: { point: { ...wound.at }, normal: { x: -direction.x, y: -direction.y, z: -direction.z }, direction: { x: direction.x, y: direction.y, z: direction.z }, anchor: "torso" },
      power: THREE.MathUtils.clamp(wound.power, 0, 2), outcome: "kill",
      flags: this.goreFlags(),
    }, { wound: victim.goreAnchors().torso, defender: victim.container, facing: this.camera.position.clone().sub(new THREE.Vector3(wound.at.x, wound.at.y, wound.at.z)).normalize() });
    rite.impacts.push(plan.impactId);
    // Where a fatality holds the blow: the first wound, before the struck frame is acted on, or read again just after it.
    const at = new THREE.Vector3(wound.at.x, wound.at.y, wound.at.z);
    rite.opened ??= { at, direction: direction.clone() };
    this.fatality?.refine(victim, at, direction);
  }

  /** The rite's blood comes to rest with the body: pools where it lies. */
  private landRiteWounds(victim: PieceView, impacts: readonly string[]): void {
    const at = victim.combatPoint(new THREE.Vector3());
    for (const id of impacts) this.gore?.land(id, { x: at.x, z: at.z });
  }

  // ---------------------------------------------------------------- dismemberment (death/sever, docs/play/GORE_SYSTEM.md)

  /** The settings the gore tiers are capped by (gore/goreTiers.ts): the match's Violence, motion, staging, map and board. */
  private tierSettings(): TierSettings {
    return {
      violence: this.goreIntensity, reducedMotion: this.reducedMotion, captureCinematics: this.captureCinematics, tactical: this.tactical,
      menuBoard: this.menuPresentation || this.attract || this.silentBoard(),
    };
  }

  /**
   * A duel's killing blow, on the frame it lands (the plain fight's contact, a directed fight's impact): whether it takes
   * a limb off and, if it does, the limb. A limb comes off only where the gore tiers allow it (an execution or a
   * fatality, at Full), the physics deaths are there, and the killer's weapon cuts: a blade's slash or an axe's cleave
   * (death/sever/severPlan.ts). Returns the limb taken, or null.
   */
  private severByBlow(attacker: PieceView, victim: PieceView, blow: THREE.Vector3, power: number): string | null {
    const moment = this.kills.get(victim);
    if (!moment || moment.style !== "melee" || !this.deathPhysics) return null;
    const sanList = this.controller.getSnapshot().sanList;
    const rule = planSevers({ show: this.goreShowOf(victim), physics: this.physicsDeaths, cut: WEAPON_CUT[moment.weapon ?? "fist"], by: "duel", seed: combatSeed(sanList, "sever") });
    if (!woundSevers(rule, { struck: true, power }, 0)) return null;
    // Where the steel is on the frame it lands; a weapon that is nowhere near (a fallback lunge) cuts at the near side of the chest.
    const chest = victim.combatPoint(new THREE.Vector3()), steel = attacker.weaponContact(new THREE.Vector3());
    if (steel.distanceTo(chest) > PIECE_HEIGHT[victim.kind] * 0.6) steel.copy(chest).addScaledVector(blow, -PIECE_HEIGHT[victim.kind] * 0.12);
    return this.severAt(victim, steel, blow, power, rule, 0);
  }

  /** What a summon's tearings may take off: decided once, as it is called. A burning or a knockdown takes nothing. */
  private riteSevers(death: RiteDeath, attacker: PieceView, victim: PieceView): SeverRule {
    const cut: SeverCut = death === "held-burn" || death === "burn" ? "burn" : death === "thrown" ? "crush" : "tear";
    // A summon's kill is recorded as one (recordKill): the one accessor answers for it.
    const recorded = this.kills.get(victim);
    const show = recorded?.style === "summon" ? this.goreShowOf(victim) : goreShow({ ...(recorded ?? { attacker: attacker.kind, victim: victim.kind }), style: "summon" }, this.tierSettings(), this.preset);
    return planSevers({ show, physics: this.physicsDeaths, cut, by: "summon", seed: combatSeed(this.controller.getSnapshot().sanList, "sever") });
  }

  /** Takes the limb nearest `at` off `victim`, thrown along `direction` (death/sever). The limb's name, or null when none came off. */
  private severAt(victim: PieceView, at: { x: number; y: number; z: number }, direction: { x: number; y: number; z: number }, power: number, rule: SeverRule, index: number): string | null {
    const physics = this.deathPhysics;
    if (!physics) return null;
    const standing: { x: number; z: number }[] = [];
    for (const piece of [...this.pieces.values(), ...this.motion]) if (piece !== victim && !piece.isSlain) standing.push({ x: piece.container.position.x, z: piece.container.position.z });
    const limb = physics.sever(victim, {
      point: { x: at.x, y: at.y, z: at.z }, direction: { x: direction.x, y: direction.y, z: direction.z }, power, ply: this.controller.getSnapshot().sanList.length,
      seed: rule.seed, index, standing, kingdom: this.factory.getSkins()[victim.color], intensity: this.goreIntensity,
      flags: { menuBoard: this.silentBoard(), reducedMotion: this.reducedMotion, tactical: this.tactical }, tier: rule.tier,
    });
    const sink = (globalThis as { __crownfallCombatTrace?: unknown[] }).__crownfallCombatTrace;
    if (limb && Array.isArray(sink)) sink.push({ what: "severed", detail: { limb, index }, at: 0 });
    // The one seam from the sever to the camera: a limb that came off in an execution is watched (fatality/ SEVER_CUT).
    if (limb) this.severCut(victim, limb, at, direction, power, rule.seed, index);
    // And in a fatality, its fluid pours from the stump too, where it kept a share for one (fatality/stumpPlan.ts).
    if (limb) this.pourStump(victim, limb);
    return limb;
  }

  private readonly riteUp = new THREE.Vector3();
  private readonly riteForward = new THREE.Vector3();
  private readonly riteSide = new THREE.Vector3();
  private readonly riteChest = new THREE.Vector3();
  private readonly riteBasis = new THREE.Matrix4();

  /**
   * A sound a rite asks for, by name: a take of the summon's own cue where the bank has one (gambit-sound.ts
   * RITE_CUE_TAKES, cut from public-domain recordings), else a stand-in. A bite and a tearing are also heard in the
   * body, behind the gore gate.
   */
  private riteSound(cue: string, at: THREE.Vector3, volume: number): void {
    if (this.silentBoard()) return;
    const pan = this.stereoPan(at);
    const voiced = audio.cue(cue, { volume, pan });
    // A bite crunches and a tearing rips, under the wet of the wound each opens (behind the gore gate), whether or
    // not the summon has a voice for it (the wyvern growls as it bites).
    const flesh = captureLayers({ silentBoard: this.silentBoard(), spell: false }).flesh;
    if (cue.endsWith(".bite")) { if (flesh) audio.fleshWound("crush", { pan, volume: 0.85 * volume }); }
    else if (cue.endsWith(".tear")) { if (flesh) audio.fleshWound("slash", { pan, volume: 0.8 * volume }); }
    if (voiced) return;
    // Until a summon has sounds of its own: its wings, and its rush as it seizes the piece, are heard as heavy air.
    if (cue.endsWith(".wingbeat")) audio.bladeWhoosh({ pan, volume: 0.9 * volume, weight: 1 });
    else if (cue.endsWith(".strike")) audio.bladeWhoosh({ pan, volume: 1.25 * volume, weight: 1 });
  }

  /** Ends the summon on the board, if there is one: whatever waited on it is told it did not land. */
  private endRite(): void {
    const rite = this.rite;
    if (!rite) return;
    this.rite = null;
    rite.light?.release();
    rite.effect.object.removeFromParent();
    rite.effect.dispose();
    for (const troop of rite.troops) { troop.container.removeFromParent(); troop.dispose(); }
    if (!rite.wasStruck) rite.struck(false);
    rite.released(); rite.done();
  }

  /**
   * The spell this caster's capture gets from its kingdom's page (vfx/spells/spellbook.ts), or null when nothing
   * on the page is built yet. The same position always draws the same spell, and a kingdom does not cast the
   * same one twice running while its page offers another.
   */
  private drawSpell(caster: PieceView, square: SquareId): SpellEntry | null {
    if (!this.spells) return null;
    const army = this.spellArmy(caster), moves = this.controller.getSnapshot().moves;
    // The spell this kingdom cast last is read from the game's history, by the same rules, so an Undo or a replay
    // seeked to any ply draws what the game drew (shared/play/replay-show.ts lastSpellBefore).
    const id = this.spellDraw(army, caster.kind, moves.length, square, lastSpellBefore(moves, moves.length - 1, army, this.spellHistory()));
    this.showTrace("spell", id);
    return id ? spellEntry(id) : null;
  }

  /** The spell a cast draws: the same position always draws the same spell, and never the kingdom's last twice running. */
  private spellDraw(army: ArmySkinId, kind: PieceKind, plies: number, square: SquareId, last: SpellId | null): SpellId | null {
    return chooseSpell(army, kind, plies * 7919 + square.charCodeAt(0) * 31 + square.charCodeAt(1), { last, canMake });
  }

  /** How the history's casts are read: a caster's capture, unless it is a Queen's summon (summonFor). */
  private spellHistory(): SpellHistoryRules<SpellId> {
    const skins = this.factory.getSkins();
    return {
      army: color => skins[color],
      casts: move => attackStyle(move.kind, ARMY_SKINS[skins[move.color]].arsenal) === "spell" && !this.summons(move.kind, move.captured ?? "p", skins[move.color]),
      draw: (move, index, last) => this.spellDraw(skins[move.color], move.kind, index + 1, move.to, last),
    };
  }

  /**
   * A spell from the library in place of the plain bolt. The spell draws its own gathering, travel and blow; the
   * match times the caster's body to it, sounds it, strikes the victim on the frame the blow lands and marks the
   * stone. Returns the cast clip it played, if the rig has one.
   */
  private async castDrawnSpell(
    entry: SpellEntry, attacker: PieceView, victim: PieceView, impact: THREE.Vector3, blow: THREE.Vector3,
    strikeSquare: SquareId, spell: SpellProfile, pair: CombatSession,
  ): Promise<ReturnType<PieceView["playAttack"]> | null> {
    const stage = this.spells;
    if (!stage) return null;
    const army = this.spellArmy(attacker), queen = attacker.kind === "q";
    // A begging victim holds the cast a little: its words are said before the blow.
    const hold = pleaWait(this.livePlea?.secondsToLastWord() ?? 0, 0.9);
    if (hold > 0) await pair.wait(hold);
    // The hall darkens as the spell gathers, until just after its blow (moments/): its own light is what is left.
    this.moments.darken(true);
    // A spell that runs the piece through is no fire kill: the body is held up on what pierced it, and bleeds.
    const pierce = entry.death === "pierce", impacts: string[] = [];
    if (pierce) this.killedBy.set(victim, { source: "melee", by: attacker.kind });
    // A spell that runs the piece through is aimed at the figure's own chest, so a Pawn is not run through the
    // head nor a King through the hips; the rest aim where a bolt would strike.
    const aim = pierce ? victim.combatPoint(new THREE.Vector3()) : impact;
    // The first wound a piercing spell opens is where its blow went in (a fatality holds it there).
    let opened: SpellWound | null = null;
    const events: SpellEvents = {};
    if (pierce) events.wound = wound => { opened ??= wound; this.spellWound(attacker, victim, wound, impacts); };
    if (entry.mark === "thaw") {
      // An ice spell leaves its kingdom's sear as its ice melts off the stone, not under the blow: laid then, filed under
      // this move. A board that has moved on by then (an Undo, the next move) is left as it is.
      const record = [...this.controller.getSnapshot().sanList], revision = this.boardRevision;
      const at = impact.clone(), from = attacker.container.position.clone();
      events.thaw = () => {
        if (this.isStale(revision) || this.controller.getSnapshot().sanList.length !== record.length) return;
        this.burnStone("spell", army, at, from, spell.blast, spell.ring, false, record);
      };
    }
    const flight = stage.cast(entry, {
      origin: out => out.copy(attacker.castOrigin()),
      target: { x: aim.x, y: aim.y, z: aim.z }, stone: { x: aim.x, y: BOARD_TOP, z: aim.z },
      army, look: this.spellLook(attacker), caster: attacker.kind, power: queen ? 1.75 : 1, quality: this.preset,
      // Reduced motion and fast play take the spell's short form: nothing rushes, flashes or shakes.
      brief: this.reducedMotion || this.combatHurry > 1,
      seed: this.controller.getSnapshot().moves.length * 7919 + strikeSquare.charCodeAt(0) * 31 + strikeSquare.charCodeAt(1),
      boardTop: BOARD_TOP, tile: TILE, violence: this.goreIntensity,
    }, events);
    if (pierce) this.pierced.set(victim, { flight, impacts });
    // The spell leaves the hand a moment before it lands: the caster's body is timed to that moment.
    const release = Math.max(0.1, flight.effect.strikeAt - 0.16);
    const pan = this.stereoPan(attacker.container.position);
    // Korvenia's two casters have only their firing clips, made for a levelled barrel: their bodies cast by hand.
    let cast = attacker.arsenal !== "empire" && attacker.hasClip("attack") ? attacker.playAttack() : null;
    const byHand = !cast || cast.duration <= 0;
    // The cast clip is retimed, within reason, so its release is the spell's.
    if (cast && !byHand && cast.impact > 0) cast = attacker.playAttack({ seconds: cast.duration * THREE.MathUtils.clamp(release / cast.impact, 0.7, 1.6) });
    // The spell's own sounds where the bank has them (gambit-sound.ts SPELL_CUE_TAKES), else the generic fire.
    if (!audio.spellGather(gambitSound.spellCue(entry.id, "gather"), { pan, duration: release, volume: queen ? 1.3 : 1 }))
      audio.spellCharge({ pan, duration: release, volume: queen ? 1.3 : 1 });
    attacker.flareAura(queen ? 1.2 : 0.8);
    // A Solforiz caster stands in dark mist while the spell is gathered, as under the plain bolt.
    this.playVfx("mist", this.onStone(attacker.container.position), this.vfxFor(1, army, undefined, release), VFX_SEAT.mist);
    if (byHand) void this.castWind(attacker, release);
    // Ribbons of the kingdom's light spiral in to the hand as the spell is gathered (vfx/flourish).
    const gathering = `${this.boardRevision}:cast`;
    this.flourishing()?.beginGather(gathering, this.castHand(attacker), release, army, this.flourishSeed("gather"));
    await pair.stage("strike", () => pair.wait(release));
    this.flourish?.endGather(gathering);
    if (byHand) this.castRelease(attacker, blow);
    // A shot over the caster's shoulder follows the spell down the line as it leaves the hand.
    if (this.spellShoulder) this.spellStrikeBeat(entry, attacker, victim, impact, blow, SPELL_SHOT.follow);
    if (!audio.cue(gambitSound.spellCue(entry.id, "cast"), { pan, volume: queen ? 1.2 : 1 })) audio.spellCast({ pan, volume: queen ? 1.2 : 1 });
    // The blow lands when the spell says so; a board replaced under it ends the fight.
    const landed = await pair.stage("flight", () => flight.struck);
    if (!landed) throw new CombatCancelled();
    await pair.stage("contact", () => {
      this.livePlea?.cut();
      this.moments.struck();
      // The spell's shot moves in on the body as the blow lands, to see how it dies (one over the caster's shoulder
      // is already on its way).
      if (!this.spellShoulder) this.spellStrikeBeat(entry, attacker, victim, impact, blow);
      victim.takeHit(blow);
      this.reactToImpact(victim.container.position.clone(), 1, victim, attacker);
      this.spellBurst(attacker, impact, strikeSquare, spell.blast, spell.ring, entry);
      // The caster's sigil stamped behind the body, with its starburst, and the blow's flakes and chips (vfx/flourish).
      this.stampBlow(attacker, victim, blow, queen ? 1.75 : 1);
      if (pierce) {
        // Run through: it dies on what pierced it, and is held where it was struck until the spell lets it go.
        this.lastCry(victim);
        victim.playDeath();
        const revision = this.boardRevision;
        void pair.wait(PIERCE_JOLT).then(() => { if (!this.isStale(revision) && this.pierced.has(victim)) victim.holdPose(true); }, () => undefined);
      }
      // A fatal spell holds its blow (fatality/): where it ran the piece through, or where it burst on it. A blade
      // whose wound is not yet told comes, as the piercing spells' do, in at the belly and up out of the back.
      const wound = opened as SpellWound | null;
      if (wound) this.fatalityBlow(victim, attacker, new THREE.Vector3(wound.at.x, wound.at.y, wound.at.z), new THREE.Vector3(wound.direction.x, wound.direction.y, wound.direction.z), true);
      else if (pierce) this.fatalityBlow(victim, attacker, this.chestWound(victim, blow), blow.clone().setY(0).normalize().multiplyScalar(0.55).add(new THREE.Vector3(0, 0.84, 0)));
      else this.fatalityBlow(victim, attacker, this.chestWound(victim, blow), blow);
    });
    return cast;
  }

  /**
   * A body run through by a spell (vfx/spells/spell.ts `pierce`) hangs on what pierced it until the spell lets go
   * (at most {@link PIERCE_HOLD} seconds), then falls: thrown as a ragdoll where the physics deaths have loaded and
   * the Violence setting throws bodies, else its own death runs on from where it was held. Its blood pools where it
   * comes to rest.
   */
  private async letPiercedFall(victim: PieceView, pinned: { flight: SpellFlight; impacts: string[] }, blow: THREE.Vector3, pair: CombatSession): Promise<void> {
    const revision = this.boardRevision;
    await Promise.race([pinned.flight.released, pair.wait(PIERCE_HOLD)]);
    if (this.isStale(revision)) throw new CombatCancelled();
    victim.holdPose(false);
    const standing: { x: number; z: number }[] = [];
    for (const piece of [...this.pieces.values(), ...this.motion]) if (piece !== victim && !piece.isSlain) standing.push({ x: piece.container.position.x, z: piece.container.position.z });
    const thrown = ragdollWanted(this.goreIntensity, this.reducedMotion) && this.physicsDeaths && this.deathPhysics?.fall(victim, {
      direction: { x: blow.x, z: blow.z }, power: 0.2, point: victim.combatPoint(new THREE.Vector3()).toArray(), height: PIECE_HEIGHT[victim.kind], standing,
    });
    if (!thrown) {
      // Its own death runs on from where it was held, to the stone.
      await pair.wait(Math.max(0.35, victim.deathPlan()?.land ?? 0.6));
      if (!this.silentBoard()) audio.bodyFall(1, victim.kind);
    }
    await this.untilSettled(victim, revision);
    if (this.isStale(revision)) throw new CombatCancelled();
    this.landRiteWounds(victim, pinned.impacts);
  }

  /**
   * A wound a spell opens as it runs the piece through: drawn through the gore system as a killing thrust (the
   * spray, a wound on the body, stains), which answers to the Violence setting itself. The spell's later wounds
   * keep the blood of its earlier ones.
   */
  private spellWound(attacker: PieceView, victim: PieceView, wound: SpellWound, impacts: string[]): void {
    if (!this.gore) return;
    const direction = new THREE.Vector3(wound.direction.x, wound.direction.y, wound.direction.z);
    if (direction.lengthSq() < 1e-8) return;
    direction.normalize();
    const skins = this.factory.getSkins();
    const ply = this.controller.getSnapshot().sanList.length, id = `spell-${impacts.length}`;
    const plan = this.gore.begin({
      impactId: impactIdOf(ply, id), seed: goreSeed(ply * 7919 + impacts.length, id), ply, follows: impacts.length > 0,
      attacker: { kind: attacker.kind as GoreKind, kingdom: skins[attacker.color], weapon: "spear" },
      defender: { kind: victim.kind as GoreKind, kingdom: skins[victim.color] },
      // Only a spell that runs the piece through reports wounds: each is a blade going in or coming out.
      wound: "pierce",
      moment: this.killMoment(victim, "spell"),
      contact: { point: { ...wound.at }, normal: { x: -direction.x, y: -direction.y, z: -direction.z }, direction: { x: direction.x, y: direction.y, z: direction.z }, anchor: "torso" },
      power: THREE.MathUtils.clamp(wound.power, 0, 2), outcome: "kill",
      flags: this.goreFlags(),
    }, { wound: victim.goreAnchors().torso, defender: victim.container, facing: this.camera.position.clone().sub(new THREE.Vector3(wound.at.x, wound.at.y, wound.at.z)).normalize() });
    impacts.push(plan.impactId);
    // A wound that opens just after the blow is where a fatality's blow really went.
    this.fatality?.refine(victim, new THREE.Vector3(wound.at.x, wound.at.y, wound.at.z), direction);
  }

  /**
   * The wind-up: a ball of fire drawn together at the head of the staff, fed by
   * embers pulled in out of the air around it, over a rising charge in the mix.
   * The fire is repositioned every frame from the prop's own casting point, so
   * it stays in the crystal however the casting arm swings.
   */
  private async gatherSpell(attacker: PieceView, duration: number, size: number): Promise<void> {
    const settings = QUALITY_SETTINGS[this.preset];
    const look = this.spellLook(attacker);
    const orb = new SpellOrb(look, size, this.spellLights.acquire(look.light, 4.6), this.spellGlow());
    orb.group.position.copy(attacker.castOrigin());
    this.scene.add(orb.group);

    audio.spellCharge({ pan: this.stereoPan(orb.group.position), duration, volume: size * 2 });
    attacker.flareAura(Math.min(1.2, size * 1.4));

    const motes = Math.max(3, Math.round(settings.captureParticles * 0.14 * (size * 2.4)));
    let nextMote = 0.14;
    try {
      await this.tweens.to({
        duration,
        easing: Ease.linear,
        onUpdate: (t) => {
          const at = attacker.castOrigin();
          orb.group.position.copy(at);
          // Slow to catch, then it runs away with itself.
          orb.setIntensity(t * t * 1.15);
          orb.animate(this.elapsed);
          if (t >= nextMote) {
            nextMote += 0.16;
            // Motes falling inward: thrown out wide, dragged back by the pull.
            this.effects.spawnBurst(at, look.ember, motes, {
              speed: 0.55,
              life: 0.45,
              gravity: -1.1,
              radius: 0.36,
              size: 0.075,
              growth: 0.28,
              drag: 2.6,
              rise: 0.2,
            });
          }
        },
      });
    } finally {
      orb.dispose();
    }
  }

  /**
   * One bolt: a flat, fast arc from the staff to the target's chest, shedding
   * embers and a thin trail of smoke the whole way. Longer shots take
   * proportionally longer, so the distance across the board is felt.
   *
   * A `leader` is one of the smaller balls the sorceress sends ahead of the
   * killing bolt — it is thrown off-centre, breaks on the body on its own and
   * never takes the square with it.
   */
  private async throwFireball(
    attacker: PieceView,
    target: THREE.Vector3,
    options: { size?: number; delay?: number; leader?: boolean; clock?: CombatSession } = {},
  ): Promise<void> {
    const revision = this.boardRevision;
    if (options.delay && options.delay > 0) await (options.clock?.wait(options.delay) ?? wait(options.delay));
    if (this.isStale(revision)) return;
    const settings = QUALITY_SETTINGS[this.preset];
    const look = this.spellLook(attacker);
    const start = attacker.castOrigin();
    const size = options.size ?? 0.52;
    const leader = options.leader === true;
    // Leaders come in off the shoulder rather than straight down the line.
    const aim = target.clone();
    if (leader) {
      const side = new THREE.Vector3(0, 1, 0).cross(target.clone().sub(start).setY(0).normalize());
      const dice = this.showDice(`volley ${options.delay ?? 0}`);
      aim.addScaledVector(side, (dice() - 0.5) * 0.5).setY(target.y + (dice() - 0.4) * 0.3);
    }
    const distance = start.distanceTo(aim);
    const flight = THREE.MathUtils.clamp(distance * 0.1, 0.22, 0.62);
    const lift = 0.1 + distance * 0.05;
    const motes = Math.max(3, Math.round(settings.captureParticles * 0.16 * (leader ? 0.6 : 1)));
    const smoking = settings.captureParticles >= 34 && !leader;

    // Only the killing bolt lights the hall: the leaders it is sent ahead of
    // would be fighting over the same three slots for a few frames each.
    const orb = new SpellOrb(look, size, leader ? null : this.spellLights.acquire(look.light, 4.6), this.spellGlow());
    orb.group.position.copy(start);
    orb.setIntensity(1);
    this.scene.add(orb.group);

    audio.spellCast({ pan: this.stereoPan(start), volume: leader ? 0.5 : 1 });
    this.shake.add(leader ? 0.04 : 0.08);

    const at = new THREE.Vector3();
    let nextTrail = 0;
    try {
      await this.tweens.to({
        duration: flight,
        easing: Ease.linear,
        onUpdate: (t) => {
          at.lerpVectors(start, target, t);
          at.y += Math.sin(Math.PI * t) * lift;
          orb.group.position.copy(at);
          // It tightens and brightens as it closes on the body.
          orb.setIntensity(1 + t * 0.4);
          orb.animate(this.elapsed);
          // A bolt still in the air when the board is replaced sheds nothing more onto the new one.
          if (t >= nextTrail && !this.isStale(revision)) {
            nextTrail += 0.1;
            this.effects.spawnBurst(at.clone(), look.ember, motes, {
              speed: 0.7,
              life: 0.65,
              gravity: -0.4,
              radius: 0.12,
              size: 0.09,
              growth: 0.35,
              drag: 2.2,
              rise: 0.1,
            });
            if (smoking) {
              this.effects.spawnSmoke(at.clone(), {
                count: 2,
                radius: 0.12,
                scale: 0.32,
                growth: 2.6,
                life: 0.6,
                speed: 0.25,
                rise: 0.18,
                color: look.smoke,
                opacity: 0.22,
              });
            }
          }
        },
      });
    } finally {
      orb.dispose();
    }
    if (this.isStale(revision)) return;

    // A leader breaks on its own: a small clap of fire, no square taken.
    if (leader) {
      audio.spellImpact({ pan: this.stereoPan(aim), volume: 0.4 });
      this.effects.spawnFlash(aim, 1.5, 0.2, look.core);
      this.effects.spawnBurst(aim, look.core, Math.round(settings.captureParticles * 0.35), {
        speed: 2.8,
        life: 0.45,
        gravity: 1.8,
        radius: 0.12,
      });
      this.shake.add(0.14);
    }
  }

  /**
   * The bolt breaking open on the body: a hard white flash, a shell of fire
   * thrown outward, embers left hanging on the air and the square itself struck
   * as hard as any blade would have struck it. `scale` is how much fire the
   * caster put behind it, and `ring` rolls the blast out across the stone — the
   * sorceress leaves one, the mage does not.
   */
  private spellBurst(caster: PieceView, at: THREE.Vector3, square: SquareId, scale = 1, ring = 0, drawn: SpellEntry | null = null): void {
    const settings = QUALITY_SETTINGS[this.preset];
    const army = this.spellArmy(caster);
    const look = this.spellLook(caster);

    // The fire goes into a body: the flesh under the killing bolt, never under a leader's splash. It takes the place
    // of the sword clang that used to mark the kill; the menu's background game keeps the clang and hears no flesh.
    const layers = captureLayers({ silentBoard: this.silentBoard(), spell: true });
    if (layers.steel) audio.play("capture", Math.min(1, 0.5 * scale));
    if (drawn?.death === "pierce") {
      // A spell that runs the piece through lands with its own blow (a crack of ice), never a fireball's burst, and
      // the flesh of a stab under it.
      audio.cue(gambitSound.spellCue(drawn.id, "strike"), { pan: this.stereoPan(at), volume: Math.min(layers.flesh ? 1 : 1.4, scale) });
      if (layers.flesh) audio.fleshWound("stab", { pan: this.stereoPan(at), volume: Math.min(1.3, scale) });
    } else {
      // Under a wound the burst stays at the mage's size, so the sorceress's death cry still rises over her own fire.
      // A library spell lands with its own blow where the bank has one; the plain bolt, and a spell without, burst as fire.
      if (!drawn || !audio.cue(gambitSound.spellCue(drawn.id, "strike"), { pan: this.stereoPan(at), volume: Math.min(layers.flesh ? 1 : 1.4, scale) }))
        audio.spellImpact({ pan: this.stereoPan(at), volume: Math.min(layers.flesh ? 1 : 1.4, scale) });
      if (layers.flesh) audio.fleshBlast({ pan: this.stereoPan(at), volume: scale });
    }
    // The air takes the blast, whichever spell draws it: the hardest push a fight gives it.
    this.stirAir("spell", at.x, at.y, at.z, scale);
    if (drawn) {
      // A library spell draws its own blow, ring and sparks, and shakes the camera itself: the match adds only the
      // stone's jolt under it, with no ring and no flare, and what it leaves on the stone, where the spell leaves any.
      // (The plain bolt's strike on top of it was a second blow: the big blue ring round the Glacial crown, and a
      // warm flash on the wound of either ice spell.)
      this.board.impact(square, look.light, Math.min(1.5, 1.1 * scale), 0, 0);
      if (drawn.mark === "burn") this.burnStone("spell", army, at, caster.container.position, scale, ring);
      return;
    }
    // The plain bolt: the square is struck in the spell's own light, not in the forge-orange a blade strikes it with.
    this.strikeImpact(square, Math.min(1.5, 1.1 * scale), false, 1, this.spellTone(look.light), look.ember, this.spellTone(look.core));
    this.effects.spawnFlash(at, Math.min(6, 3.4 * scale), 0.3, look.core);
    this.effects.spawnBurst(at, look.core, Math.round(settings.captureParticles * scale), {
      speed: 4.4 * (0.9 + scale * 0.1),
      life: 0.55,
      gravity: 2.6,
      radius: 0.1,
    });
    this.effects.spawnBurst(at, look.ember, Math.round(settings.captureParticles * 0.7 * scale), {
      speed: 1.5,
      life: 1.5,
      gravity: -0.7,
      radius: 0.3 * scale,
      size: 0.1,
      growth: 0.38,
      drag: 1.6,
      rise: 0.5,
    });
    // The burst itself: fire for Solforiz, the arcane burst in the army's colour for the others (vfx/wiring.ts), erupting from the
    // stone of the target's square, a little towards the camera so the body does not cut it. The smoke lobes thin under it.
    const burst = this.playVfx("spell", this.onStone(at), this.vfxFor(scale, army), VFX_SEAT.spell);
    // What it leaves on the stone under the body: this army's burn, on the frame of the burst.
    this.burnStone("spell", army, at, caster.container.position, scale, ring);
    this.effects.spawnSmoke(at, {
      count: Math.max(burst ? 2 : 3, Math.round(settings.captureParticles * 0.22 * scale * (burst ? PROCEDURAL_SHARE : 1))),
      radius: 0.34 * scale,
      scale: 0.7 * scale,
      growth: 2.8,
      life: 1.1,
      speed: 1.2,
      rise: 0.6,
      color: look.smoke,
      opacity: burst ? 0.38 : 0.55,
    });
    this.shake.add(Math.min(1, 0.6 * scale));

    if (ring > 0) {
      // Fire thrown out flat across the square, and the floor answering it.
      audio.groundSlam({ pan: this.stereoPan(at), volume: 0.5 });
      void spawnGroundWave(this.scene, this.tweens, at, {
        color: this.spellTone(look.flame),
        radius: ring,
        height: BOARD_TOP + 0.03,
        life: 0.62,
        echo: true,
      });
      this.effects.spawnBurst(at.clone().setY(BOARD_TOP + 0.12), look.ember, Math.round(settings.captureParticles * 0.5), {
        speed: 3.6,
        life: 0.9,
        gravity: 1.2,
        radius: 0.2,
        size: 0.1,
        growth: 0.5,
        drag: 1.8,
      });
    }
  }

  /**
   * The strike for a figure with no attack clip — an unrigged sculpt, or one
   * whose clip never arrived. It winds up away from its target, leaning back and
   * twisting out of line, then unloads everything forward and brings the blow
   * over the top; it resolves exactly as the blow lands, so the impact beat the
   * caller plays is unchanged. The tilt is held through {@link PieceView} so the
   * skeleton, which owns the pose on a rigged sculpt, cannot wipe the swing.
   *
   * @param heft 0 = a light blade, 1 = a siege weapon hauled round
   */
  private async lunge(attacker: PieceView, direction: THREE.Vector3, heft = 0): Promise<void> {
    const reach = TILE * (0.36 + heft * 0.1);
    const wind = -reach * 0.45;
    const twist = 0.44 + heft * 0.22;
    const chop = 0.3 + heft * 0.14;
    const push = (offset: number, yaw: number, tilt: number) => {
      attacker.runtime.position.x = direction.x * offset;
      attacker.runtime.position.z = direction.z * offset;
      attacker.runtime.rotation.y = yaw;
      attacker.setStrikeTilt(tilt);
    };

    // Weight shifts back onto the rear foot, shoulders turning out of line and
    // the weapon taken back behind the body.
    await this.tweens.to({
      duration: 0.2 + heft * 0.14,
      easing: Ease.outCubic,
      onUpdate: (t) => push(wind * t, -twist * t, -0.18 * t),
    });
    // Then everything unloads forward at once and the blow comes over the top.
    await this.tweens.to({
      duration: 0.11,
      easing: Ease.inCubic,
      onUpdate: (t) =>
        push(
          THREE.MathUtils.lerp(wind, reach, t),
          THREE.MathUtils.lerp(-twist, 0.3, t),
          THREE.MathUtils.lerp(-0.18, chop, t),
        ),
    });
  }

  /** Coming out of a lunge: the body unwinds back over its own square. */
  private recover(attacker: PieceView, direction: THREE.Vector3, heft = 0): void {
    const reach = TILE * (0.36 + heft * 0.1);
    const chop = 0.3 + heft * 0.14;
    void this.tweens.to({
      duration: 0.32 + heft * 0.1,
      easing: Ease.outCubic,
      onUpdate: (t) => {
        attacker.runtime.position.x = direction.x * reach * (1 - t);
        attacker.runtime.position.z = direction.z * reach * (1 - t);
        attacker.runtime.rotation.y = 0.3 * (1 - t);
        attacker.setStrikeTilt(chop * (1 - t));
      },
    });
  }

  /** Witnesses turn toward a nearby clash without leaving their legal squares. */
  private reactToImpact(point: THREE.Vector3, power: number, victim?: PieceView, attacker?: PieceView, type: "capture-impact" | "ally-fallen" = "capture-impact"): void {
    this.dispatchBoardReaction({ id: `${type}:${this.boardRevision}:${this.controller.getSnapshot().fen}`, type, point,
      focus: attacker?.container.position, victimColor: victim?.color, power,
      primary: [...(victim ? [victim.container.uuid] : []), ...(attacker ? [attacker.container.uuid] : [])] });
    // [battle memory] The fall's meaning, told as the body comes down: for the voices, under any motion setting.
    if (type === "ally-fallen" && !this.menuPresentation && !this.silentBoard()) this.battleBonds.tell(this.controller.getSnapshot(), this.boardRevision);
  }

  /**
   * The moment of a capture (gore/killMoment.ts), from the move record and the position after it, and what it shows
   * under the match's settings and preset: kept for the victim, for every gore system to ask ({@link goreShowOf}).
   * Called as the capture begins, and again if the cinematic changes how the blow is dealt (a summon that could not
   * be had, a duel the director handed back).
   */
  private recordKill(attacker: PieceView, victim: PieceView, event: MoveEvent, style: KillMoment["style"], directed = false): GoreShow {
    const snapshot = this.controller.getSnapshot();
    const moment = killMoment({
      attacker: attacker.kind, arsenal: attacker.arsenal, victim: victim.kind, victimColor: victim.color, style, directed,
      san: event.san, fenAfter: snapshot.fen, mate: snapshot.moves[snapshot.moves.length - 1]?.mate,
    });
    const show = goreShow(moment, this.tierSettings(), this.preset);
    this.kills.set(victim, moment);
    this.goreShows.set(victim, show);
    this.lastKill = { moment, show };
    this.showTrace("kill", { style: moment.style, weapon: moment.weapon ?? null, mate: !!moment.mate, last: !!moment.last, tier: show.tier, fatality: show.fatality, sever: show.sever, fluid: show.fluid });
    return show;
  }

  /**
   * What this victim's death shows, system by system (gore/goreTiers.ts GoreShow): the wound masks (`cuts`), sprays
   * and stains, severing and opened wounds, trails and what lingers, and the fatality (`fatality`, `fluid`). The one
   * place every gore system asks. A victim whose capture was never recorded (none in a real match) is taken for an
   * ordinary kill by steel under the settings now.
   */
  private goreShowOf(victim: PieceView): GoreShow {
    return this.goreShows.get(victim) ?? goreShow({ attacker: "p", victim: victim.kind, style: "melee" }, this.tierSettings(), this.preset);
  }

  /** The last capture's moment and what it shows, for browser checks. */
  private lastKill: { moment: KillMoment; show: GoreShow } | null = null;
  getKillStats(): { moment: KillMoment; show: GoreShow } | null { return this.lastKill ? { moment: { ...this.lastKill.moment }, show: { ...this.lastKill.show, budget: { ...this.lastKill.show.budget } } } : null; }

  // ------------------------------------------------------------------ moments

  /**
   * A killing blow has landed at `point` (where it went in): its moment begins (moments/MomentDirector.ts blow), weighed
   * by the kill this capture recorded and coloured by the attacker's kingdom. `gentle` is Reduced Motion's form. None in
   * a fight the player is hurrying past, on the map or on the menu's board.
   */
  private momentBlow(victim: PieceView, attacker: PieceView, point: THREE.Vector3, gentle = false): void {
    if (this.disposed || this.combatHurry > 1) return;
    this.syncMomentFlags();
    const kill = this.kills.get(victim), skins = this.factory.getSkins(), palette = this.blowPalette(attacker, victim);
    this.moments.blow({
      attacker: attacker.kind, victim: victim.kind, style: kill?.style ?? "melee",
      attackerArmy: skins[attacker.color], victimArmy: skins[victim.color], victimSide: victim.color,
      mate: kill?.mate === true, last: kill?.last === true, gentle,
      ...(palette ? { palette } : {}),
    }, point);
  }

  /**
   * A spell's or a summon's own colours, for the colour the killing blow's black and white keeps (blowAccent): the sun's
   * gold core as well as its red. The moment and the flourishes' kept colour (blowHue) both take them. None for steel.
   */
  private blowPalette(attacker: PieceView, victim: PieceView): number[] | undefined {
    const style = this.kills.get(victim)?.style;
    if (style !== "spell" && style !== "summon") return undefined;
    const look = this.spellLook(attacker);
    return [look.core, look.flame, look.ember, look.light];
  }

  /** What the moments may show: nothing on the map or the menu's board, only gentle grades under Reduced Motion. */
  private syncMomentFlags(): void {
    this.moments.setFlags({ reducedMotion: this.reducedMotion, tactical: this.tactical, menuBoard: this.menuPresentation || this.attract || this.silentBoard() });
    this.momentCheck(this.controller.getSnapshot());
  }

  /**
   * A King in check, for the dread grade and its signal: lifted as soon as the check is answered or the game is over,
   * put up once the move that gave it has landed (the move's own declaration beat puts it up first, in animateMove).
   */
  private momentCheck(snapshot: GameSnapshot): void {
    if (!snapshot.inCheck || snapshot.status !== "playing") this.moments.setCheck(null);
    else if (!snapshot.busy) this.moments.setCheck(snapshot.turn);
  }

  /** The lens kick for this frame's drawing, scaled to the lens in force; returns the lens to put back, or null. */
  private kickMomentLens(): number | null {
    const kick = this.moments.lensKick(this.camera.fov / DEFAULT_FOV);
    if (!(kick > 0)) return null;
    const lens = this.camera.fov;
    this.camera.fov = Math.max(4, lens - kick);
    this.camera.updateProjectionMatrix();
    return lens;
  }

  private readonly momentProbe = new THREE.Vector3();
  private readonly momentScreen: MomentScreen = { x: 0.5, y: 0.5, behind: false };
  /** Where the camera, as it draws this frame, sees a world point (moments/MomentDirector.ts compose). */
  private readonly projectMoment = (point: { x: number; y: number; z: number }): MomentScreen => {
    const at = this.momentProbe.set(point.x, point.y, point.z).project(this.camera);
    this.momentScreen.x = at.x * 0.5 + 0.5; this.momentScreen.y = at.y * 0.5 + 0.5; this.momentScreen.behind = at.z > 1;
    return this.momentScreen;
  };

  /** This frame's moment grade, to whichever pipeline draws it. */
  private pushMomentGrade(): void {
    this.camera.updateMatrixWorld();
    const grade = this.moments.compose(this.projectMoment, this.camera.aspect);
    if (this.battlefieldRenderer) this.battlefieldRenderer.setMoment?.(grade);
    else this.postfx.setMoment(grade);
  }

  /**
   * Told of each cinematic moment as it begins and ends (moments/MomentDirector.ts MomentEvent): a killing blow (its
   * weight, contact point, accent hue and hit-stop), its end, a spell's darkness, a King's check (the music's director
   * listens for `dread`), the defeat grade, and a reset. Returns the way to stop listening.
   */
  onMoment(listener: (event: MomentEvent) => void): () => void { return this.moments.onMoment(listener); }

  /**
   * The moments now (MomentSignals): the hit-stop's time scale this frame and whether it holds (effects that run on a
   * clock of their own hang on it), the blow playing, the hall's darkness, the dread of a check and the defeat grade.
   */
  getMomentSignals(): MomentSignals { return this.moments.signals; }

  /**
   * The defeat grade: `side`'s kingdom colour and the hall's light drained by `amount` (0 to 1), easing there over
   * `seconds` (1.6 by default); the winner's colour is spared. `null` eases it away. Undo, a new game, a rebuilt board
   * and Skip ending take it away; tactical view and the menu's board never show it.
   */
  setDefeatGrade(side: Faction | null, amount = 1, seconds?: number): void {
    const skins = this.factory.getSkins();
    if (!side) { this.moments.setDefeat(null, null, 0, seconds); return; }
    this.moments.setDefeat({ side, army: skins[side] }, skins[side === "w" ? "b" : "w"], amount, seconds);
  }

  /** The moments for browser checks: the signals, the blow's plan and this frame's grade. */
  getMomentStats(): { signals: MomentSignals; plan: BlowPlan | null; grade: MomentGrade } {
    return { signals: this.moments.signals, plan: this.moments.playing, grade: { ...this.moments.grade } };
  }

  // --------------------------------------------------------------- fatalities

  /**
   * The killing blow of a capture has landed, on the frame every cinematic strikes on (the duel's killing contact,
   * the melee strike, the shot, a spell's blow, a summon's struck frame). Where the kill's tier shows a fatality
   * ({@link goreShowOf}), its directed sequence begins round the blow (fatality/FatalityDirector.ts); the cinematic
   * itself plays on, slowed. `point` is where the blow went in and `direction` the line it travels (either way
   * along it); `exact` when they are a wound the kill opened itself, which nothing later reads again.
   */
  private fatalityBlow(victim: PieceView, attacker: PieceView, point: THREE.Vector3, direction: THREE.Vector3, exact = false): void {
    // Every killing blow is a moment (moments/): its hit-stop, black and white, ripple and kick, from where it went in.
    this.momentBlow(victim, attacker, point);
    const director = this.fatality, show = this.goreShowOf(victim);
    if (!director || this.disposed || !fatalityPlays(show, this.combatHurry > 1)) return;
    const snapshot = this.controller.getSnapshot();
    director.begin({ victim, attacker, point, direction, exact, show, ply: snapshot.sanList.length, seed: combatSeed(snapshot.sanList, "fatality") });
    this.showTrace("fatality", { kind: "fatality", seed: combatSeed(snapshot.sanList, "fatality"), tier: show.tier });
  }

  /** Where a blow along `blow` meets the front of the chest: the torso bone lies inside the body, the wound on its surface. */
  private chestWound(victim: PieceView, blow: THREE.Vector3): THREE.Vector3 {
    const along = blow.clone();
    if (along.lengthSq() < 1e-8) along.set(0, 0, -1);
    return victim.combatPoint(new THREE.Vector3()).addScaledVector(along.normalize(), -0.08 * PIECE_HEIGHT[victim.kind]);
  }

  /** A beat of the fatality playing (fatality/fatalityPlan.ts): the close shot and the low impact on the blow, then the way back. */
  private fatalityBeat(beat: FatalityBeat, fatality: Fatality): void {
    if (beat === "close") {
      // Sound keeps its own clock: one low impact from the bank under a fatality's blow, the blow's own sounds as they
      // were. A sever's cut is heard by its own sounds alone.
      if (fatality.kind === "fatality" && !this.silentBoard()) audio.groundSlam({ pan: this.stereoPan(fatality.point), volume: FATALITY.impact });
      this.closeOnWound(fatality);
    } else if (fatality.kind === "look" && beat === "back") this.leaveLook(this.claimShotOwed === fatality.victim);
    else this.leaveWound(fatality.kind === "cut" ? SEVER_CUT.backSeconds : fatality.kind === "look" ? WOUND_LOOK.backSeconds : FATALITY.backSeconds);
  }

  /**
   * A limb has come off (death/sever, through {@link severAt}): in an execution (tier 2) the camera cuts in close on the
   * body and where the limb flies, holds about a second and a half, and goes home or hands over to the Claiming's shot
   * (fatality/fatalityPlan.ts SEVER_CUT). No slow motion and no X-ray: those stay a fatality's, which keeps its whole
   * sequence. Where the limb comes down is the sever's own throw (severPlan.ts limbLaunch, with the same seed and index).
   */
  private severCut(victim: PieceView, limb: SeverLimb, at: { x: number; y: number; z: number }, direction: { x: number; y: number; z: number }, power: number, seed: number, index: number): void {
    const director = this.fatality, show = this.goreShowOf(victim);
    if (!director || this.disposed || director.active || !severCutPlays(show, this.combatHurry > 1)) return;
    const { velocity } = limbLaunch([direction.x, direction.y, direction.z], power, seed, index, limb);
    const from = { x: at.x, y: at.y, z: at.z }, throwing = { x: velocity[0], y: velocity[1], z: velocity[2] };
    const landing = limbLanding(from, throwing, BOARD_TOP);
    const rise = Math.max(0, throwing.y) / 9.81;
    const apex = { x: from.x + throwing.x * rise, y: from.y + throwing.y * rise * 0.5, z: from.z + throwing.z * rise };
    const height = PIECE_HEIGHT[victim.kind] * Math.max(0.2, victim.container.scale.y), stone = victim.container.position;
    const snapshot = this.controller.getSnapshot();
    director.begin({
      kind: "cut", frame: severFrame({ x: stone.x, y: BOARD_TOP, z: stone.z }, height, from, landing, apex),
      victim, attacker: victim.combatOpponent ?? victim, point: new THREE.Vector3(at.x, at.y, at.z), direction: new THREE.Vector3(direction.x, direction.y, direction.z),
      show, ply: snapshot.sanList.length, seed,
    });
  }

  /**
   * The close shot on the wound (rites/riteShot.ts `close`, on a long lens), turned off the line of the blow so the
   * wound channel is seen along its length. It cuts into the shot that holds the camera (the duel's, the spell's or
   * the rite's), remembering what that shot was framing; with none, the fatality takes a shot of its own.
   */
  private closeOnWound(fatality: Fatality): void {
    const { victim, attacker } = fatality;
    const height = PIECE_HEIGHT[victim.kind], chest = victim.combatPoint(new THREE.Vector3());
    // A spell raises its own shapes round the piece (a crown of ice, a pillar of sun): a long lens on the wound looks only
    // at them. The X-ray's bones are drawn over them, so a spell's fatality frames the trunk, head to hips, on a shorter
    // lens (FATALITY.spellLens), and the skeleton fills the shot.
    const spell = this.kills.get(victim)?.style === "spell";
    // A sever's cut frames the body and the limb's flight on the match's own lens; a look, the body where it lies and
    // its wound; a fatality the wound, on a long one.
    const cut = fatality.kind === "cut" && fatality.frame, look = fatality.kind === "look" && fatality.frame;
    const frame = cut || look ? [...fatality.frame!] : spell ? this.trunkFrame(chest, height) : woundFrame(fatality.point, height, chest);
    const lens = cut ? this.lensFov : look ? WOUND_LOOK.lens : spell ? FATALITY.spellLens : FATALITY.lens;
    const reach = cut ? RITE_SHOT.closeReach : look ? WOUND_LOOK.reach : spell ? FATALITY.spellReach : FATALITY.reach;
    const seconds = cut ? SEVER_CUT.closeSeconds : look ? WOUND_LOOK.closeSeconds : FATALITY.closeSeconds;
    // No rank crest floats in a close shot (closeShotHolds): they come back with the view.
    const from = attacker.container.position.clone(), to = victim.container.position.clone();
    const held = this.duelCamera?.revision === this.conclusionCameraRevision && !this.duelCamera.timeline.leaving ? this.duelCamera : null;
    const home = held ? held.timeline.home : { position: this.camera.position.clone(), target: this.controls.target.clone(), fov: this.lensFov };
    // Of the turns and steepnesses it may take, the one the fewest figures stand in front of (fatality/fatalityPlan.ts woundShot).
    const standing = [...this.pieces.values(), ...this.motion].filter(piece => piece !== victim && !piece.isSlain)
      .map(piece => ({ x: piece.container.position.x, z: piece.container.position.z, radius: TILE * 0.27, height: PIECE_HEIGHT[piece.kind] }));
    // And it looks down more steeply over them.
    const choice = woundShot({
      wound: fatality.point, height, home, from, to, boardTop: BOARD_TOP, aspect: this.camera.aspect, radius: HALL_INNER_RADIUS - FOLLOW_WALL_MARGIN, standing, chest,
      ...(cut ? { frame, lens, reach, downs: SEVER_CUT.downs } : look ? { frame, lens, reach, downs: WOUND_LOOK.downs } : spell ? { downs: WOUND_SHOT.spellDowns } : {}),
    });
    if (held) {
      this.fatalityShot = { timeline: held.timeline, back: held.timeline.aim, own: false };
      held.timeline.moveTo(this.riteDuelShot(frame, home, choice.turn, true, lens, reach, choice.down), seconds);
      return;
    }
    const timeline = this.beginRiteCamera(frame, { from, to }, { close: true, lens, reach, easeIn: seconds, turn: choice.turn, down: choice.down });
    if (timeline) this.fatalityShot = { timeline, back: null, own: true };
  }

  /**
   * The view goes back from the wound: to what the kill's own shot was framing (the Claiming's shot may then take
   * over from it, as it does after any spell or summon), or home, if the fatality's shot was its own.
   */
  private leaveWound(seconds: number = FATALITY.backSeconds): void {
    const shot = this.fatalityShot;
    this.fatalityShot = null;
    if (!shot) return;
    // The crests wait for it to come back, or for a shot that has taken the camera from it to come in (closeShotHolds).
    if (shot.own || this.duelCamera?.timeline !== shot.timeline) this.closeShotGoingHome = shot.timeline;
    if (this.duelCamera?.timeline !== shot.timeline || shot.timeline.leaving) return;
    if (shot.own) shot.timeline.release(undefined, seconds);
    else if (shot.back) shot.timeline.moveTo(shot.back, seconds);
  }

  /**
   * An ordinary fight's look at the body (fatality/fatalityPlan.ts WOUND_LOOK): when the body is down and the duel's
   * shot still holds the camera, the camera comes in on it where it lies, framing its joints as they are now and the
   * wound painted into it (gore/WoundMasks.ts woundOf), holds a moment, and goes home or on to the Claiming. Not where
   * a fatality or a sever's cut has already shown the body, nor in a fight hurried past. True when it begins.
   */
  private lookAtWound(victim: PieceView, attacker: PieceView): boolean {
    const director = this.fatality, duel = this.duelCamera;
    if (!director || director.active || this.disposed || !duel || duel.rite || duel.revision !== this.conclusionCameraRevision || duel.timeline.leaving) return false;
    const show = this.goreShowOf(victim);
    if (!woundLookPlays(show, this.combatHurry > 1)) return false;
    const joints: { x: number; y: number; z: number }[] = [];
    victim.visual.updateMatrixWorld(true);
    victim.visual.traverse(node => { if ((node as THREE.Bone).isBone && joints.length < 64) { const at = node.getWorldPosition(new THREE.Vector3()); joints.push({ x: at.x, y: at.y, z: at.z }); } });
    const point = new THREE.Vector3(), normal = new THREE.Vector3();
    const wounded = this.gore?.woundOf(victim, point, normal) ?? false;
    if (!wounded) victim.combatPoint(point);
    const height = PIECE_HEIGHT[victim.kind] * Math.max(0.2, victim.container.scale.y);
    const snapshot = this.controller.getSnapshot();
    return director.begin({
      kind: "look", frame: woundLookFrame(joints, point, height),
      victim, attacker, point, direction: wounded && normal.lengthSq() > 1e-8 ? normal.clone().negate() : point.clone().sub(attacker.container.position),
      show, ply: snapshot.sanList.length, seed: combatSeed(snapshot.sanList, "look"),
    });
  }

  /**
   * The look's back beat: the camera goes home from the body, or, where the Claiming's shot is owed this body, stays on
   * it until that shot takes over (no swing back to the fight's own framing in between). The crests wait either way
   * (closeShotHolds).
   */
  private leaveLook(kept: boolean): void {
    const shot = this.fatalityShot;
    this.fatalityShot = null;
    if (!shot) return;
    // The crests wait for it, or for a shot that has already taken the camera from it to come in (closeShotHolds).
    this.closeShotGoingHome = shot.timeline;
    if (this.duelCamera?.timeline !== shot.timeline || shot.timeline.leaving) return;
    if (!kept) this.releaseDuelCamera();
  }

  /** What a spell's fatality keeps in frame: the trunk round the chest, from the hips to over the head, and its width. */
  private trunkFrame(chest: THREE.Vector3, height: number): { x: number; y: number; z: number }[] {
    const up = height * 0.45, side = height * 0.28;
    return [
      { x: chest.x, y: chest.y, z: chest.z }, { x: chest.x, y: chest.y + up, z: chest.z }, { x: chest.x, y: Math.max(BOARD_TOP, chest.y - up), z: chest.z },
      { x: chest.x + side, y: chest.y, z: chest.z }, { x: chest.x - side, y: chest.y, z: chest.z }, { x: chest.x, y: chest.y, z: chest.z + side }, { x: chest.x, y: chest.y, z: chest.z - side },
    ];
  }

  /**
   * Whether a close shot holds the camera now: a fatality's, a sever's or a look's on the wound, until its camera is home
   * again or the shot that took the camera from it has come in (fatality/fatalityPlan.ts closeShotWaits; the crests came
   * back large as it began to leave, in the first filming of a Knight's cleaver); or a spell's or a summon's own shot,
   * on the same terms, from the moment it takes the camera (rites/spellShot.ts: a spell's beats are all close). In
   * their first filmings the undead army and the Snare stood behind a row of crests.
   */
  private closeShotHolds(): boolean {
    if (this.fatalityShot) return true;
    const home = this.closeShotGoingHome;
    if (home) {
      if (closeShotWaits(home, this.duelCamera?.timeline)) return true;
      this.closeShotGoingHome = null;
    }
    const cast = this.castShot;
    if (cast && closeShotWaits(cast, this.duelCamera?.timeline)) return true;
    this.castShot = null;
    return false;
  }

  /**
   * Hides every rank crest while a close shot holds the camera (they float over the figures and fill a close frame),
   * and gives them back, as the player has them set, when it lets go or is cut short. Called every frame with
   * {@link closeShotHolds}; it touches the crests only when that changes.
   */
  private closeShotBadges(hidden: boolean): void {
    if (hidden === this.badgesHiddenForShot) return;
    this.badgesHiddenForShot = hidden;
    const visible = !hidden && this.rankBadges && !this.menuPresentation;
    for (const piece of this.pieces.values()) piece.setBadgeEnabled(visible);
    for (const piece of this.motion) piece.setBadgeEnabled(visible);
    for (const piece of this.captured) piece.setBadgeEnabled(visible);
  }

  /** The fatality director now, for browser checks: whether one plays, its clock, the time scale and its beats. */
  getFatalityStats(): FatalityStats | null { return this.fatality?.stats ?? null; }
  /** The fatality's X-ray now, for browser checks: whether it shows, its bones, what broke and its fragments. */
  getXrayStats(): XrayStats | null { return this.xray?.stats ?? null; }
  /** A fatality's fluid now, for browser checks: whether this GPU draws it, its budget, what pours and what it has left. */
  getFluidStats(): FluidStats | null { return this.fluid?.stats ?? null; }

  /**
   * The fatality's fluid blood (fatality/fluid.ts), where its tier affords it (`fluid`: none on Low): out of the
   * far wound along the blow and back out of where it went in, as many drops as the preset's budget. Its stains and
   * pool are filed in the gore system under an impact of their own, so Undo takes them back with the capture. A
   * stump shares the budget (fatality/stumpPlan.ts): one already off pours with the wound ({@link pourStump}), and
   * one a summon may still tear off has its share kept until it comes.
   */
  private pourFatality(fatality: Fatality): void {
    const fluid = this.fluid, victim = fatality.victim, attacker = fatality.attacker;
    this.stumpPour = null;
    if (!fluid || !fatality.show.fluid || this.silentBoard()) return;
    const height = PIECE_HEIGHT[victim.kind] * Math.max(0.2, victim.container.scale.y);
    const chest = victim.combatPoint(new THREE.Vector3());
    const skins = this.factory.getSkins(), point = fatality.point, direction = fatality.direction;
    const plan = planGore({
      impactId: impactIdOf(fatality.ply, "fatality.fluid"), seed: fatality.seed, ply: fatality.ply, follows: true,
      attacker: { kind: attacker.kind as GoreKind, kingdom: skins[attacker.color], weapon: "spear" },
      defender: { kind: victim.kind as GoreKind, kingdom: skins[victim.color] },
      contact: { point: { x: point.x, y: point.y, z: point.z }, normal: { x: -direction.x, y: -direction.y, z: -direction.z }, direction: { x: direction.x, y: direction.y, z: direction.z }, anchor: "torso" },
      power: 1.6, outcome: "kill", intensity: this.goreIntensity, quality: this.preset,
      flags: { menuBoard: false, reducedMotion: this.reducedMotion, tactical: this.tactical }, board: { top: BOARD_TOP, tile: TILE },
    });
    // The wound rides on the torso bone: a body carried off or falling takes it, and the pour, with it.
    const torso = victim.goreAnchors().torso, revision = this.boardRevision;
    const onBone = torso ? point.clone().applyMatrix4(torso.matrixWorld.clone().invert()) : null;
    const follow = torso && onBone ? () => (this.isStale(revision) || !victim.container.parent ? null : onBone.clone().applyMatrix4(torso.matrixWorld)) : undefined;
    // A limb already off (a duel's blow and the dead's killing tearing take it on this frame, before the fatality
    // begins), or one the summon's tearings to come may take: the stump's share is kept from the wound's.
    const stumps = this.deathPhysics?.severs.stumps(victim) ?? [], rite = this.rite;
    const chance: StumpChance = stumps.length ? "off" : rite && rite.victim === victim && rite.severed < rite.sever.limbs ? "may" : "none";
    const shares = pourShares(fatality.show, chance);
    const poured = fluid.burst({
      entry: { x: point.x, y: point.y, z: point.z }, direction: { x: direction.x, y: direction.y, z: direction.z },
      depth: channelLength(point, direction, chest, height), height, seed: fatality.seed, count: shares.wound, ply: fatality.ply, plan,
      ...(follow ? { follow } : {}),
    });
    if (!poured || shares.stump <= 0) return;
    this.stumpPour = { victim, ply: fatality.ply, seed: fatality.seed, count: shares.stump, height, plan, revision };
    if (stumps[0]) this.pourStump(victim, stumps[0].limb);
  }

  /**
   * A fatality's fluid pours from a stump as well as from the wound (fatality/stumpPlan.ts), with the share of the
   * budget kept for it: from the moment its limb came off (with the wound, when that was first), out of the cut along
   * the stump's own bone, and riding on that bone as the body falls or is carried. The first stump of the fatality's
   * victim takes the share, or lets it lapse if it comes too late; a sever without a fatality keeps its spurts alone.
   */
  private pourStump(victim: PieceView, limb: SeverLimb): void {
    const kept = this.stumpPour, fluid = this.fluid;
    if (!kept || kept.victim !== victim) return;
    this.stumpPour = null;
    const cut = this.deathPhysics?.severs.stumps(victim).find(stump => stump.limb === limb), clock = fluid?.clock ?? null;
    if (!fluid || !cut || clock === null || this.isStale(kept.revision) || stumpStart(clock, kept.count) === null) return;
    // Where the limb was (its folded bone's joint), and the way it went: the stump's own bone, as its spurts take them.
    const joint = cut.joint.getWorldPosition(new THREE.Vector3());
    const axis = cut.axis.clone().applyQuaternion(cut.bone.getWorldQuaternion(new THREE.Quaternion())).normalize();
    const wound = stumpWound({ joint, axis, radius: cut.radius }, kept.height, kept.seed);
    // The stump rides on the bone it hangs from: a body falling, or carried off, takes the pour with it.
    const bone = cut.bone, revision = kept.revision;
    const onBone = new THREE.Vector3(wound.entry.x, wound.entry.y, wound.entry.z).applyMatrix4(bone.matrixWorld.clone().invert());
    fluid.pour({
      entry: wound.entry, direction: wound.direction, depth: 0, height: wound.height, seed: wound.seed, stump: { radius: wound.radius },
      count: kept.count, ply: kept.ply, plan: kept.plan,
      follow: () => (this.isStale(revision) || !victim.container.parent ? null : onBone.clone().applyMatrix4(bone.matrixWorld)),
    });
  }

  /** The fluid's light: the camera's lamp (from above and behind the player), the arena's air, at the exposure lit things are drawn at. */
  private fluidLight(): FluidLight {
    const lit = this.fluidLit, look = ARENA_LOOKS[this.arena];
    this.cameraLamp.getWorldPosition(lit.direction);
    lit.direction.sub(this.cameraLamp.target.getWorldPosition(this.vfxPoint)).normalize();
    lit.colour.setHex(look.lamp.color).multiplyScalar(1.2);
    lit.ambient.setHex(look.fog.color).multiplyScalar(0.6).addScalar(0.05);
    lit.gain = vfxLight(this.displayExposure());
    return lit;
  }

  /**
   * How this victim dies (death/deathStyle.ts): from what killed it, the Violence setting, reduced motion and
   * whether the physics deaths are there. The flat map and the menu's board keep the authored death.
   */
  private deathStyleOf(victim: PieceView): DeathStyle {
    const forced = this.forcedDeath.get(victim);
    if (forced) return forced;
    return deathStyle(this.killedBy.get(victim) ?? { source: "melee", by: "p" }, {
      intensity: this.goreIntensity, reducedMotion: this.reducedMotion, physics: this.physicsDeaths,
      tactical: this.tactical, menuBoard: this.menuPresentation || this.attract || this.silentBoard(),
    });
  }

  /**
   * The death of a fire kill (a spell, the field gun). At Minimal: a short flash, and the body fades with no char
   * and no gore. At Cinematic and Full the body burns (death/burn): the fire catches where it was hit and
   * spreads, the skin chars, the figure staggers and flails, collapses over its burn mark and lies smouldering
   * as a husk until {@link banish} clears it. Takes the place of the whole of {@link slay} for these kills.
   */
  private async burnOrFade(style: "burn" | "fade", victim: PieceView, blow: THREE.Vector3, alreadyHit: boolean, pair?: CombatSession, silentFall = false, onLanded?: () => void): Promise<void> {
    const burning = this.burning;
    if (!burning) return;
    const revision = this.boardRevision;
    const spell = this.killedBy.get(victim)?.source === "spell";
    // The killer's army: its colour of fire.
    const army = this.factory.getSkins()[victim.color === "w" ? "b" : "w"];
    const pan = this.stereoPan(victim.container.position);
    // With no fight shown (reduced motion, cinematics off) the killer already stands on the square: the calm
    // version, with no stagger and no flames, as the burn mark under it was laid cold.
    const calm = this.reducedMotion || !this.captureCinematics;
    if (!alreadyHit) {
      victim.takeHit(blow);
      this.reactToImpact(victim.container.position, 1, victim);
    }
    this.lastCry(victim);
    this.cried.delete(victim);
    if (style === "fade") {
      // What leaves a body as it is cleared leaves this one as it fades.
      if (!this.silentBoard()) audio.soulRelease(pan);
      victim.playDeath();
      await burning.fade(victim, planFade(calm), spell ? spellLookFor(this.factory.getSkins(), victim.color === "w" ? "b" : "w").core : 0xfff0c8);
      if (this.isStale(revision)) return;
      onLanded?.();
      return;
    }
    await burning.burn(victim, blow, {
      quality: this.preset, reducedMotion: calm, source: spell ? "spell" : "gun", army,
      height: PIECE_HEIGHT[victim.kind], seed: combatSeed(this.controller.getSnapshot().sanList, "burn"),
    }, {
      wait: seconds => pair?.wait(seconds) ?? wait(seconds),
      stale: () => this.isStale(revision),
      topple: () => this.topple(victim, blow, 0.55),
      // A spell's fire catching is the bolt's own breath, quieter. The field gun's is heard in its blast: the audio
      // layer has no sound of natural fire catching, and none of anything burning.
      ignited: () => { if (spell && !calm && !this.silentBoard()) audio.spellCast({ pan, volume: 0.5 }); },
      falling: () => { if (!silentFall) audio.bodyFall(0.8, victim.kind); },
      landed: () => {
        onLanded?.();
        this.playVfx("fall", this.onStone(victim.combatPoint(this.vfxContact)), null, VFX_SEAT.fall);
        if (!calm) this.shake.add(0.05);
      },
    });
  }

  /**
   * How a burnt husk leaves the stone: it crumbles to ash and embers where it lies, never lifted and never
   * thrown. A body that faded has already gone. This is the one place to change when bodies come to be unmade
   * where they lie by other means.
   */
  private async clearHusk(victim: PieceView): Promise<void> {
    const burning = this.burning;
    if (!burning) return;
    if (burning.isHusk(victim) && !this.silentBoard()) audio.soulRelease(this.stereoPan(victim.container.position));
    await burning.crumble(victim);
  }

  /** Bodies burning, lying as husks, crumbling and fading now, for browser checks: all 0 after an Undo. */
  getBurnStats(): BurningBodies["stats"] | null { return this.burning ? this.burning.stats : null; }

  /** Directional flinch, existing death clip, then the existing body hold. */
  private async slay(victim: PieceView, blow: THREE.Vector3, alreadyHit = false, pair?: CombatSession, silentFall = false, onLanded?: () => void): Promise<void> {
    // A fire kill burns or fades (death/burn); every other style falls as below (`ragdoll` and `explode` are death/physics's to take).
    const style = this.deathStyleOf(victim);
    if (burnsOrFades(style) && this.burning) return this.burnOrFade(style, victim, blow, alreadyHit, pair, silentFall, onLanded);
    const revision = this.boardRevision;
    const settings = QUALITY_SETTINGS[this.preset];
    if (!alreadyHit) {
      victim.takeHit(blow);
      this.reactToImpact(victim.container.position, 1, victim);
    }
    // A Combat Director fight sounds the body reaching the stone on its own cue.
    if (!silentFall) audio.bodyFall(0.8, victim.kind);
    // What the blow tore loose reaches the stone when the body does: after the cry, not under it.
    const gore = captureLayers({ silentBoard: this.silentBoard(), spell: false }).gore;
    const gorePan = this.stereoPan(victim.container.position);
    const chest = victim.container.position.clone().setY(0.5);
    this.lastCry(victim);
    // A figure brought back by Undo may die again, and cries again.
    this.cried.delete(victim);
    // A blow that drew real blood (the Gore Director's spray) does not also throw the old red sparks.
    if (this.bleeding !== victim) this.effects.spawnBurst(chest, 0xff5a3a, Math.round(settings.captureParticles * 0.5), {
      speed: 2.8,
      life: 0.55,
    });

    if (!victim.hasAnimations) {
      // A rigid topple has no landing frame of its own to wait for: the body is down by here.
      if (gore) audio.goreSplat({ pan: gorePan, delay: TOPPLE_LANDING_SECONDS });
      this.playVfx("fall", this.onStone(victim.container.position), null, VFX_SEAT.fall, null, TOPPLE_LANDING_SECONDS);
      await this.topple(victim, blow, 0.55);
      return;
    }

    const death = victim.playDeath();
    if (death <= 0) {
      if (gore) audio.goreSplat({ pan: gorePan, delay: TOPPLE_LANDING_SECONDS });
      this.playVfx("fall", this.onStone(victim.container.position), null, VFX_SEAT.fall, null, TOPPLE_LANDING_SECONDS);
      await this.topple(victim, blow, 0.55);
      return;
    }

    // Knocked off its feet by the blow and brought down by its own weight.
    this.knockDown(victim, blow, death, pair);
    // A ragdoll comes down where and when physics brings it down: its dust rises on the frame its trunk first meets
    // the stone, under it. (On the death clip's planned landing, below, it was half a second late and wherever the
    // torso was in the air then: the VFX audit's duel, the body down at 3.4 s and its dust at 3.9 s.)
    const thrown = this.deathPhysics?.onTrunkDown(victim, at => { if (!this.isStale(revision) && victim.isSlain) this.fallDust(at); }) ?? false;

    // An authored death reaches the stone before the clip has played out: the fight's own measure of when
    // (the clip starts part-way in and runs faster than authored), else the whole clip.
    const landing = Math.min(death, victim.deathPlan()?.land ?? death);
    await (pair?.wait(landing) ?? wait(landing));
    // A death begun on a board since replaced lands nowhere (M-20): its sound and dust would fall on the new one.
    if (this.isStale(revision)) return;
    // The body is down: blood and torn flesh reach the stone with it.
    if (gore) audio.goreSplat({ pan: gorePan });
    onLanded?.();
    // Dust kicked up as the body lands, then a beat to let the fall register: from under where the body lies, on the
    // frame of the gore sound and the pool, when the death clip has the fall.
    if (!thrown) this.fallDust(victim.combatPoint(new THREE.Vector3()));
    if (death > landing) await (pair?.wait(death - landing) ?? wait(death - landing));
    await (pair?.wait(0.14) ?? wait(0.14));
  }

  /**
   * Dust kicked up by a body reaching the stone at `at`: the flipbook sheet rolling out from under it (seated behind
   * it, in the shade of the stone), and the older sprite grit and lobes, thinned where the flipbook plays.
   */
  private fallDust(at: THREE.Vector3): void {
    const settings = QUALITY_SETTINGS[this.preset];
    const dusted = this.playVfx("fall", this.onStone(at), null, VFX_SEAT.fall);
    const lobes = dusted ? PROCEDURAL_SHARE : 1;
    this.effects.spawnBurst(new THREE.Vector3(at.x, 0.16, at.z), 0x9c8a6a, 24, {
      speed: 1.3,
      life: 0.8,
    });
    this.effects.spawnSmoke(new THREE.Vector3(at.x, 0.12, at.z), {
      count: Math.max(dusted ? 2 : 3, Math.round(settings.captureParticles * 0.16 * lobes)),
      radius: 0.42,
      scale: 0.7,
      growth: 2.2,
      life: 1,
      speed: 0.8,
      rise: 0.2,
      color: 0x8f8172,
      opacity: dusted ? 0.3 : 0.5,
    });
  }

  /**
   * The exit: the Claiming (vfx/mystic). A fallen figure is never lifted off the stone. A sigil is drawn round it
   * where it lies, a thread of light comes down to it from the hand of the sorcerer who stands over the board
   * (from the sky, in an arena without one), the body is unmade under a shaft of light and rises as embers in its
   * army's colour, and its soul goes up the thread. Resolves when the body is gone; the thread lets go after.
   */
  private async banish(victim: PieceView, _blow: THREE.Vector3): Promise<void> {
    const revision = this.boardRevision;
    // A body that burned lies as a husk, and is claimed like any other: the husk crumbles as its unmaking. One
    // that faded (the Minimal death) has already gone, and nothing lies there to be taken.
    const husk = this.burning?.isHusk(victim) ?? false;
    if (!husk && this.burning?.owns(victim)) {
      if (this.claimShotOwed === victim) { this.claimShotOwed = null; this.releaseDuelCamera(); }
      return this.clearHusk(victim);
    }
    const settings = QUALITY_SETTINGS[this.preset];
    // A body still falling (a ragdoll, the pieces of a burst) comes to rest first: the sigil is drawn where it lies.
    await this.untilSettled(victim, revision);
    if (this.isStale(revision)) return;
    // The fight may have kept its shot on this body for the claim's shot to take over from.
    const owed = this.claimShotOwed === victim;
    if (owed) this.claimShotOwed = null;
    const lying = victim.combatPoint(new THREE.Vector3());
    const stone = { x: lying.x, y: BOARD_TOP + 0.012, z: lying.z }, body = { x: lying.x, y: BOARD_TOP + 0.2, z: lying.z };
    // Fast play, a skipped fight, the map and reduced motion take the short form: nothing travels.
    const brief = this.reducedMotion || !this.captureCinematics || this.tactical || this.combatHurry > 1;
    const silent = this.silentBoard(), pan = this.stereoPan(victim.container.position);
    const motes = Math.max(3, Math.round(settings.captureParticles * 0.14));
    let shed = 0.1;
    let watch: { rise(seconds: number): void; leave(): void } | null = null;
    let crumbling: Promise<void> | null = null;
    const watched = !brief && this.claimIsWatched(victim);
    let hand: number | null = null;
    const handle = this.claiming.begin({
      kind: victim.kind, body, stone, soul: EMBER_COLOR[victim.color], quality: this.preset, brief,
      // Where the camera will watch, the thread is held in a hand the camera can see.
      ...(watched ? { pick: (hands: readonly THREE.Vector3[]) => (hand = this.pickClaimHand(body, hands)) } : {}),
      unmake: amount => {
        if (this.isStale(revision)) return;
        // A husk comes apart by its own clock (death/burn), begun as the unmaking begins.
        if (husk) { if (amount > 0 && !crumbling) crumbling = this.burning?.crumble(victim) ?? null; return; }
        // Two layers of leaving, as before: the surface burns open through its noise while what is left thins.
        victim.setDissolve(amount);
        victim.setOpacity(1 - 0.75 * THREE.MathUtils.smoothstep(amount, 0.35, 1));
        if (brief || amount < shed || amount >= 1) return;
        shed += 0.11;
        // Embers in the fallen army's colour, peeled off the burn edge and drawn up the shaft.
        this.effects.spawnBurst(new THREE.Vector3(body.x, BOARD_TOP + 0.16 + amount * 0.3, body.z), EMBER_COLOR[victim.color], motes, {
          speed: 0.4, life: 1.7, gravity: -0.7, radius: 0.32, size: 0.085, growth: 0.3, drag: 1.7, rise: 0.55,
        });
      },
      // The gathering swell crests as the thread lands; what leaves the body is heard as it goes.
      onThread: seconds => { if (!silent && !brief) audio.spellCharge({ pan, volume: 0.45, duration: seconds }); },
      onTouch: () => {
        if (brief || this.isStale(revision)) return;
        this.shake.add(0.04);
        // The thread landing on the body: the air round it is drawn up with what leaves.
        this.stirAir("rite", stone.x, BOARD_TOP, stone.z, 0.5);
        this.effects.spawnBurst(new THREE.Vector3(stone.x, BOARD_TOP + 0.08, stone.z), 0xb9c9bd, Math.round(settings.captureParticles * 0.25), { speed: 1.4, life: 0.5 });
      },
      // The camera rides up the thread with the soul, to the one who takes it.
      onSoul: () => { if (!silent) audio.soulRelease(pan); watch?.rise(handle.timeline.soul[1] - handle.timeline.soul[0]); },
      // Home again once the soul is in the hand: the thread letting go is seen from the player's own seat.
      onArrive: () => { const shot = watch; if (shot) void this.tweens.to({ duration: CLAIM_LINGER, easing: Ease.linear, onUpdate: () => undefined }).then(() => shot.leave()); },
    });
    watch = watched ? this.watchClaim(handle, body) : null;
    this.showTrace("claimed", { victim: victim.color + victim.kind, watched, hand, brief, shot: watch !== null }, (this.takenOn.get(victim) ?? this.controller.getSnapshot().moves.length - 1) + 1);
    // Kept, and not taken over after all: the fight's shot goes home now.
    if (owed && !watch) this.releaseDuelCamera();
    await handle.gone;
    if (this.isStale(revision)) return;
    // The husk's own crumbling hides it; a body that never began to (a ritual cut short) is cleared the old way.
    if (husk) { await (crumbling ?? this.clearHusk(victim)); return; }
    victim.setDissolve(1);
    victim.setOpacity(0);
  }

  /**
   * Waits for physics to finish with a body (death/physics): a ragdoll takes two or three seconds to lie still,
   * and a ritual begun under a falling body would mark the wrong stone. Never longer than a ragdoll may run.
   */
  private async untilSettled(victim: PieceView, revision: number): Promise<void> {
    for (let waited = 0; waited < 4.5 && this.deathPhysics && !this.deathPhysics.settled(victim) && !this.isStale(revision); waited += 0.05) {
      await this.tweens.to({ duration: 0.05, easing: Ease.linear, onUpdate: () => undefined });
    }
  }

  /** Who stands over the board and takes the fallen: the arena's sorcerer, when the arena has one. Null gives the threads back to the sky. */
  setClaimant(claimant: Claimant | null): void { this.claiming.setClaimant(claimant); }

  /**
   * The Claiming taken back: each piece an Undo has put back on its square is returned by the ritual that took
   * it, run backwards. The sorcerer raises its hands, the thread stands again, the soul comes down it into the
   * square, the embers fall back in, and the piece is remade from its heart outward; then the thread goes back up
   * into the hand. The camera stays where the player has it. Not on the menu's board.
   */
  private returnTaken(entries: readonly { square: SquareId; kind: PieceKind; color: Faction }[]): void {
    if (!entries.length || this.menuPresentation || this.attract) return;
    const settings = QUALITY_SETTINGS[this.preset];
    const brief = this.reducedMotion || !this.captureCinematics || this.tactical || this.combatHurry > 1;
    const silent = this.silentBoard();
    const motes = Math.max(3, Math.round(settings.captureParticles * 0.14));
    for (const entry of entries) {
      const view = this.pieces.get(entry.square);
      if (!view || view.kind !== entry.kind || view.color !== entry.color) continue;
      const revision = this.boardRevision;
      const at = view.container.position, chest = view.combatPoint(new THREE.Vector3());
      const stone = { x: at.x, y: BOARD_TOP + 0.012, z: at.z }, body = { x: chest.x, y: chest.y, z: chest.z };
      const pan = this.stereoPan(at);
      let shed = 0.9;
      view.setDissolve(1);
      view.setOpacity(0);
      const handle = this.claiming.restore({
        kind: view.kind, body, stone, soul: EMBER_COLOR[view.color], quality: this.preset, brief,
        remake: amount => {
          if (this.isStale(revision)) return;
          view.setDissolve(amount);
          view.setOpacity(1 - 0.75 * THREE.MathUtils.smoothstep(amount, 0.35, 1));
          if (brief || amount > shed || amount <= 0) return;
          shed -= 0.11;
          // Embers in its army's colour, coming down the shaft and into the body as it is remade.
          this.effects.spawnBurst(new THREE.Vector3(body.x, BOARD_TOP + 0.55 + amount * 0.6, body.z), EMBER_COLOR[view.color], motes, {
            speed: 0.25, life: 0.8, gravity: 1.4, radius: 0.34, size: 0.08, growth: 0.3, drag: 2.2,
          });
        },
        onThread: () => { if (!silent && !brief) audio.spellCharge({ pan, volume: 0.35, duration: 0.6 }); },
        onSoul: () => { if (!silent && !brief) audio.soulRelease(pan); },
        onHome: () => {
          if (brief || this.isStale(revision)) return;
          this.shake.add(0.03);
          this.stirAir("rite", stone.x, BOARD_TOP, stone.z, 0.4);
          this.effects.spawnBurst(new THREE.Vector3(stone.x, BOARD_TOP + 0.08, stone.z), 0xb9c9bd, Math.round(settings.captureParticles * 0.2), { speed: 1.2, life: 0.45 });
        },
      });
      this.returning.set(view, handle);
      void handle.gone.then(() => { if (this.returning.get(view) === handle) this.returning.delete(view); });
    }
  }

  /** Makes a piece an Undo is returning whole at once (it is about to move, or be taken again). */
  private finishReturn(view: PieceView): void {
    const handle = this.returning.get(view);
    if (!handle) return;
    this.returning.delete(view);
    this.claiming.complete(handle);
  }

  /** Rituals now under way, for browser checks: no claims after an Undo, and a return for each piece it gave back. */
  getClaimStats(): { active: number; begun: number; held: boolean; returning: number } {
    return { active: this.claiming.active, begun: this.claiming.begun, held: this.claiming.held, returning: this.claiming.returning };
  }

  /**
   * Whether the camera will leave the player's view for the claim about to begin: the first of a match and every
   * piece above a Pawn, under the duel shot's own conditions, and only when somebody stands over the board.
   */
  private claimIsWatched(victim: PieceView): boolean {
    // The claims before this one are the captures before the ply that took this body (the history's, not this
    // board's: an Undo or a replay seeked here counts them the same).
    const taken = this.takenOn.get(victim) ?? this.controller.getSnapshot().moves.length - 1;
    if (!this.claiming.held || !claimIsWatched(victim.kind, capturesBefore(this.controller.getSnapshot().moves, taken))) return false;
    return this.captureCinematics && !this.reducedMotion && !this.tactical && !this.menuPresentation && !this.attract && !this.introPlaying;
  }

  /**
   * Which of the hands that could hold a thread the claim shot would see: the arena stands things between the
   * board and the sorcerer (the great skull, the broken columns), and from behind a body at the board's edge
   * one of them can hide a hand. The first hand whose shot sees both the hand and the face is taken, else the
   * one that sees more.
   */
  private pickClaimHand(body: { x: number; y: number; z: number }, hands: readonly THREE.Vector3[]): number {
    const face = this.claiming.face(new THREE.Vector3());
    if (!face) return 0;
    let best = 0, most = -1;
    for (const [index, hand] of hands.entries()) {
      const shot = claimShot({ body, hand, face, boardTop: BOARD_TOP, aspect: this.camera.aspect, radius: HALL_INNER_RADIUS - FOLLOW_WALL_MARGIN });
      const seen = (this.sightClear(shot.position, hand) ? 2 : 0) + (this.sightClear(shot.position, face) ? 1 : 0);
      if (seen === 3) return index;
      if (seen > most) { best = index; most = seen; }
    }
    return best;
  }

  /** Whether nothing of the arena stands between an eye and a point far from it. Living figures are not counted. */
  private sightClear(eye: { x: number; y: number; z: number }, point: THREE.Vector3): boolean {
    const world = this.bakedWorld;
    if (!world) return true;
    const from = new THREE.Vector3(eye.x, eye.y, eye.z), to = point.clone().sub(from);
    const distance = to.length();
    // Stop short of the point: it is a hand or a face, and the figure it belongs to is not in its own way.
    const ray = new THREE.Raycaster(from, to.normalize(), 1, Math.max(1, distance - 3.5));
    const solid: THREE.Object3D[] = [];
    world.traverseVisible(node => { const mesh = node as THREE.Mesh; if (mesh.isMesh && !(node as THREE.SkinnedMesh).isSkinnedMesh) solid.push(mesh); });
    return ray.intersectObjects(solid, false).length === 0;
  }

  /**
   * Lifts the camera to watch a claim, in two beats: from behind the body, the body low in the frame and the one
   * who holds its thread rising over it; then, as the soul leaves the body, up the thread on a long lens to the
   * hand it arrives in. See {@link claimIsWatched} for when. Returns the second beat and what lets the shot go, or
   * null when something else already scripts the camera.
   */
  /**
   * The head of the figure grieving hardest for the fallen just now (the reactions' strongest grief or mourning), for
   * the claim's shot to keep in frame; null when no one grieves.
   */
  private mournerHead(): { x: number; y: number; z: number } | null {
    const id = this.boardReactions.mourner();
    if (!id) return null;
    for (const piece of this.pieces.values()) {
      if (piece.container.uuid !== id || piece.isSlain) continue;
      const at = piece.container.position;
      return { x: at.x, y: BOARD_TOP + piece.standingHeight * 0.85, z: at.z };
    }
    return null;
  }

  /** The claim shot being watched, while its first beat holds: a grief that begins under it is turned toward. */
  private claimWatch: { keep(head: { x: number; y: number; z: number }): void } | null = null;

  private watchClaim(handle: ClaimHandle, body: { x: number; y: number; z: number }): { rise(seconds: number): void; leave(): void } | null {
    if (handle.timeline.brief) return null;
    // A fight's shot still easing home keeps the home it remembered: that is the player's view, not where it is now.
    let previous = this.duelCamera;
    if (previous && previous.revision !== this.conclusionCameraRevision) { this.endDuelCamera(false); previous = null; }
    if (!previous && (this.cameraScripted || this.conclusionViewActive)) return null;
    const face = this.claiming.face(new THREE.Vector3());
    if (!face) return null;
    const here: CameraPose = { position: this.camera.position.clone(), target: this.controls.target.clone(), fov: previous?.fov ?? this.lensFov };
    const home: CameraPose = previous ? previous.timeline.home : here;
    const hand = handle.hand(new THREE.Vector3());
    // A companion grieving beside the body stays in the shot with it (the strongest grief, as it stands now).
    const framing = { body, hand, face, boardTop: BOARD_TOP, aspect: this.camera.aspect, radius: HALL_INNER_RADIUS - FOLLOW_WALL_MARGIN };
    const pose = claimShot({ ...framing, keep: this.mournerHead() });
    const shot: DuelShot = { ...pose, push: pose.position, killSeen: true, side: 1, lean: 0, pitch: 0, distance: 0, occlusion: 0, fill: 0, confined: false };
    const timeline = new DuelCameraTimeline({ ...home, fov: this.lensFov }, shot, { from: here, easeIn: 1.15, easeOut: 1.25 });
    this.duelCamera = { timeline, revision: this.conclusionCameraRevision, lens: this.lensFov, fov: here.fov, punch: () => 0, rite: true };
    this.controls.enabled = false;
    this.cameraScripted = true;
    this.controls.minDistance = Math.min(this.controls.minDistance, .5);
    // The orbit limits keep a hand from looking up from under the board; the second beat looks up at the holder's face.
    this.controls.maxPolarAngle = Math.PI - 0.05;
    const revision = this.boardRevision;
    const ours = () => !this.isStale(revision) && this.duelCamera?.timeline === timeline;
    const reach = Math.hypot(pose.target.x - pose.position.x, pose.target.y - pose.position.y, pose.target.z - pose.position.z);
    // A grief that begins while the first beat holds (the fall is told after the body is down): the view turns to it.
    const watch = { keep: (head: { x: number; y: number; z: number }) => { if (ours()) timeline.moveTo(claimShot({ ...framing, keep: head }), 0.9); } };
    this.claimWatch = watch;
    const done = () => { if (this.claimWatch === watch) this.claimWatch = null; };
    return {
      // Where the hand and the face are now: the hands have come up since the shot was planned.
      rise: seconds => { done(); if (ours()) timeline.moveTo(claimCloseShot({ eye: pose.position, hand: handle.hand(hand), face: this.claiming.face(face) ?? face, reach }), seconds); },
      leave: () => { done(); if (ours()) this.releaseDuelCamera(true); },
    };
  }

  /**
   * The board's voices stay out of the menu's background game: its figures
   * fight in silence but for steel and stone.
   */
  private silentBoard(): boolean {
    return this.controller.getSnapshot().mode === "attract";
  }

  /** A new game: the bell and the board remembering. (Who has died, and the run of checks, are read from the history.) */
  private beginGameSound(): void {
    const snapshot = this.controller.getSnapshot();
    this.livePlea = null;
    // A replay rings its bell when it is played from its first move (ringReplayBell), not as it opens.
    if (snapshot.status === "playing" && snapshot.sanList.length === 0 && !this.silentBoard() && !snapshot.replay) { this.voiced("gambit", () => audio.beginGambit()); this.voices.gameBegins(); }
  }

  /**
   * The doomed piece comes to itself as its killer comes for it. Not every
   * piece wakes in time; the first to die in a game always does.
   */
  private wake(victim: PieceView): void {
    this.livePlea?.cut();
    this.livePlea = null;
    if (this.silentBoard()) return;
    const snapshot = this.controller.getSnapshot();
    // The first to die in a game always wakes: the first capture in its history, however this board got here.
    const taken = this.takenOn.get(victim) ?? snapshot.moves.length - 1;
    this.livePlea = this.voiced("plea", () => audio.pleaFor(victim.color, victim.kind, {
      voice: this.voices.voiceOf(victim),
      pan: this.stereoPan(victim.container.position),
      first: capturesBefore(snapshot.moves, taken) === 0,
      speed: snapshot.mode === "demo" ? snapshot.demo?.speed ?? 1 : 1,
    }));
    this.showTrace("plea", this.livePlea ? { clip: this.livePlea.clip, voice: this.livePlea.voice } : null);
  }

  /** Holds the blow until the begging piece has said its last word, within the grace. */
  private async letThemBeg(windup: number, cap = Infinity): Promise<void> {
    const plea = this.livePlea;
    if (!plea) return;
    const extra = Math.min(cap, pleaWait(plea.secondsToLastWord(), windup));
    if (extra > 0) await wait(extra);
  }

  /**
   * The figure's own dying voice. Each rank in each army has its own recorded
   * cry, panned to where the body is on screen and pitch-jittered so repeats
   * never sound identical; heavier ranks die louder and a touch lower.
   */
  /**
   * The dying voice, once per body: the plea is cut and the same person cries
   * out a beat after the wound. A paired melee calls this on the contact
   * itself, because the defender then staggers through an authored hit
   * reaction before it falls and the cry must not wait for that; every other
   * death reaches it from {@link slay}.
   */
  private lastCry(victim: PieceView): void {
    if (this.cried.has(victim)) return;
    this.cried.add(victim);
    const plea = this.livePlea;
    this.livePlea = null;
    plea?.cut();
    // A body whose head the blow took off (death/sever) makes no cry.
    if (this.deathPhysics?.severs.without(victim).includes("head")) return;
    this.cryOut(victim, victim.container.position.clone().setY(0.5), plea?.voice);
  }

  private cryOut(victim: PieceView, chest: THREE.Vector3, voice?: string): void {
    const weight = CRY_WEIGHT[victim.kind], dice = this.showDice("cry");
    this.voiced("cry", () => audio.deathCry(victim.color, victim.kind, {
      voice: voice ?? this.voices.voiceOf(victim),
      pan: this.stereoPan(chest),
      volume: weight.volume,
      rate: weight.rate * (0.95 + dice() * 0.1),
      // A beat after the blow: the plea is cut, the wound is heard alone, then the scream.
      delay: 0.15 + dice() * 0.07,
    }));
  }

  /** Where a world point sits across the screen, as a -1..1 stereo position. */
  private stereoPan(position: THREE.Vector3): number {
    const projected = position.clone().project(this.camera);
    if (!Number.isFinite(projected.x)) return 0;
    return Math.max(-1, Math.min(1, projected.x));
  }

  /** Rigid topple for sculpts with no skeleton: knocked over, face down. */
  private async topple(victim: PieceView, blow: THREE.Vector3, duration: number): Promise<void> {
    const start = victim.container.position.clone();
    const axis = new THREE.Vector3(blow.z, 0, -blow.x).normalize();
    const fallen = new THREE.Quaternion().setFromAxisAngle(axis, -Math.PI * 0.46);
    const rest = victim.container.quaternion.clone();
    const target = fallen.multiply(rest);
    await this.tweens.to({
      duration,
      easing: Ease.outBounce,
      onUpdate: (t) => {
        victim.container.quaternion.slerpQuaternions(rest, target, t);
        victim.container.position.y = start.y + Math.sin(Math.PI * t) * 0.06;
        victim.container.position.x = start.x + blow.x * t * 0.12;
        victim.container.position.z = start.z + blow.z * t * 0.12;
      },
    });
    this.effects.spawnBurst(start.clone().setY(0.12), 0x9c8a6a, 22, { speed: 1.4, life: 0.7 });
    await wait(0.2);
    victim.container.quaternion.copy(rest);
    victim.container.position.copy(start);
  }

  /**
   * Board-level hit feedback on the square being taken: a white flash decaying
   * into a shockwave ring, the tiles jolting out of place, sparks off the stone
   * and a short camera kick. A library spell draws its own blow and is given
   * only the jolt (see spellBurst).
   */
  private strikeImpact(square: SquareId, strength: number, bled = false, ring = 1, glow = 0xff7a3a, sparks = 0xffb066, flare = 0xfff3d2): void {
    const settings = QUALITY_SETTINGS[this.preset];
    // Where the blow drew blood the stone still jolts, and rings where a ring is asked for, but nothing white covers
    // the wound. (A directed fight asks for none: DIRECTED_RING.)
    this.board.impact(square, glow, strength, bled ? 0 : Math.min(1, strength), ring, flare);
    this.shake.add(0.22 * strength);
    if (bled) return;
    const ground = squareToWorld(square, BOARD_TOP + 0.05);
    this.effects.spawnFlash(ground.clone().setY(BOARD_TOP + 0.18), Math.min(IMPACT_GLOW, 1.5 * strength), 0.2);
    this.effects.spawnBurst(ground, sparks, Math.round(settings.captureParticles * 0.45 * strength), {
      speed: 2.1,
      life: 0.5,
    });
  }

  /**
   * What a round finds when it arrives: what the victim is seen to wear on its body (its armour table,
   * gore/ImpactResolver.ts). Plate or mail answers as steel, spall and sparks: the Aethelgard footman's mail, the
   * cuirassier's breastplate, the Foundry Bulwark's plate. Anything else tears as cloth, in its own kingdom's colours
   * (CLOTH_DEBRIS): the Solforiz robes in sand and rust, Kwind-09's quilted coats in charcoal, a cleric's white robe.
   */
  private impactBody(victim: PieceView): { body: ImpactBody; palette?: readonly number[] } {
    const kingdom = this.factory.getSkins()[victim.color];
    const worn = regionsOf(victim.kind as GoreKind, kingdom).torso.material;
    if (worn === "plate" || worn === "mail" || worn === "iron" || worn === "steel") return { body: "plate" };
    return { body: "uniform", palette: CLOTH_DEBRIS[kingdom] };
  }

  /**
   * Death without the cinematic: the figure still plays its death clip and is
   * knocked off its feet, just without the camera work and the stand-off.
   */
  private async crumble(victim: PieceView, killer: THREE.Vector3): Promise<void> {
    const blow = victim.container.position.clone().sub(killer).setY(0);
    if (blow.lengthSq() < 1e-6) blow.set(0, 0, 1);
    blow.normalize();
    victim.faceTowards(killer);
    const revision = this.boardRevision;
    await this.slay(victim, blow);
    // banish reads the board it starts on: begun after an Undo, it would claim the old body on the new board.
    if (this.isStale(revision)) return;
    await this.banish(victim, blow);
  }

  private async rejectMove(square: SquareId): Promise<void> {
    const piece = this.pieces.get(square);
    audio.blip("deny");
    // The refusal is heard either way; the shake is motion, and is left out where motion is reduced.
    if (!piece || this.reducedMotion) return;
    await this.tweens.to({
      duration: 0.32,
      easing: Ease.linear,
      onUpdate: (t) => {
        piece.runtime.position.x = Math.sin(t * Math.PI * 6) * 0.07 * (1 - t);
      },
    });
    piece.runtime.position.x = 0;
  }

  // ------------------------------------------------------------------- camera

  /**
   * A battle beat's lens punch, scaled to the framing in force. A phone frames
   * the board through a much wider lens, so a fixed 6° push-in would barely
   * register there; the punch is a proportion of the shot, not a constant.
   */
  private lensPunch(degrees: number): number {
    return degrees * (this.lensFov / DEFAULT_FOV);
  }

  async moveCameraTo(shot: CameraShot, duration = 1.1): Promise<void> {
    this.cancelEndFraming();
    if (this.reducedMotion) {
      this.camera.position.copy(shot.position);
      this.controls.target.copy(shot.target);
      this.camera.lookAt(shot.target);
      this.captureFollowRig();
      return;
    }
    const fromPosition = this.camera.position.clone();
    const fromTarget = this.controls.target.clone();
    this.controls.enabled = false;
    this.cameraScripted = true;
    try {
      await this.tweens.to({
        duration,
        easing: Ease.inOutCubic,
        onUpdate: (t) => {
          this.camera.position.lerpVectors(fromPosition, shot.position, t);
          this.controls.target.lerpVectors(fromTarget, shot.target, t);
        },
      });
    } finally {
      this.cameraScripted = false;
      this.captureFollowRig();
    }
    this.controls.enabled = this.interactive && !this.menuPresentation && !this.attract;
  }

  // -------------------------------------------------------------- duel camera

  /**
   * Closes the match camera in on a directed duel (web/src/scene/combat/duelCamera.ts
   * plans the shot and times the move). The player's view is remembered and
   * handed back exactly: by the fight when the body is down, at once on skip
   * and on any board rebuild. Orbit controls are off for as long as it lasts.
   *
   * Not taken at all with capture cinematics off, with reduced motion, on the
   * tactical map, on the menu's background board, or while something else is
   * already scripting the camera. Returns the shot, or null when none is taken.
   */
  private beginDuelCamera(
    attacker: PieceView, victim: PieceView, from: THREE.Vector3, standoff: THREE.Vector3, victimSpot: THREE.Vector3,
    blow: THREE.Vector3, punch: () => number, approach: number, kill?: DuelKill,
  ): DuelShot | null {
    if (!this.captureCinematics || this.reducedMotion || this.tactical || this.menuPresentation || this.attract || this.introPlaying) return null;
    // A shot still easing home keeps the home it remembered: that is the player's view, not where it is now.
    let previous = this.duelCamera;
    if (previous && previous.revision !== this.conclusionCameraRevision) { this.endDuelCamera(false); previous = null; }
    if (!previous && (this.cameraScripted || this.conclusionViewActive)) return null;
    const here: CameraPose = { position: this.camera.position.clone(), target: this.controls.target.clone(), fov: previous?.fov ?? this.lensFov };
    const home: CameraPose = previous ? previous.timeline.home : here;
    const ranked = rankDuelShots({
      attackerStart: from, standoff, victim: victimSpot, blow: { x: blow.x, z: blow.z },
      attackerHeight: PIECE_HEIGHT[attacker.kind], victimHeight: PIECE_HEIGHT[victim.kind],
      fov: this.lensFov, aspect: this.camera.aspect,
      camera: { position: home.position, target: home.target },
      ...(kill ? { kill } : {}),
      bounds: { floor: BOARD_TOP, radius: HALL_INNER_RADIUS - FOLLOW_WALL_MARGIN },
      obstacles: [...this.pieces.values()].map(piece => ({
        x: piece.container.position.x, z: piece.container.position.z, radius: TILE * .27, height: PIECE_HEIGHT[piece.kind],
      })),
    });
    const shot = ranked[0].shot;
    // Browser checks are told every shot that was weighed, so a forecast of what hides the kill can be held against the drawn frame.
    const sink = (globalThis as { __crownfallCombatTrace?: unknown[] }).__crownfallCombatTrace;
    if (Array.isArray(sink) && kill) sink.push({ what: "shots", detail: { kill, ranked: ranked.map(item => ({ cost: item.cost, side: item.shot.side, lean: item.shot.lean, pitch: item.shot.pitch, seen: item.shot.killSeen, occlusion: item.shot.occlusion, position: item.shot.position })) }, at: 0 });
    this.duelCamera = {
      timeline: new DuelCameraTimeline({ ...home, fov: this.lensFov }, shot, { from: here, easeIn: THREE.MathUtils.clamp(approach * .9, .6, .9) }),
      revision: this.conclusionCameraRevision, lens: this.lensFov, fov: here.fov, punch,
    };
    // No rank crest floats in it (closeShotHolds).
    this.castShot = this.duelCamera.timeline;
    this.controls.enabled = false;
    this.cameraScripted = true;
    // The orbit limits keep a hand from burying the camera in the front rank; this shot stands closer than that.
    this.controls.minDistance = Math.min(this.controls.minDistance, .5);
    return shot;
  }

  /** Moves the duel shot along by the frame's delta: the same delta the fight's clock is given. */
  private updateDuelCamera(delta: number): void {
    const duel = this.duelCamera;
    if (!duel) return;
    // Something newer owns the camera (a preset, the map, the checkmate tableau): leave it be.
    if (duel.revision !== this.conclusionCameraRevision || this.disposed) { this.endDuelCamera(false); return; }
    if (this.reducedMotion || this.tactical || this.menuPresentation) duel.timeline.snap();
    const pose = duel.timeline.update(delta), done = duel.timeline.done;
    this.camera.position.set(pose.position.x, pose.position.y, pose.position.z);
    this.controls.target.set(pose.target.x, pose.target.y, pose.target.z);
    // A resize may have changed the rest lens under the shot: follow it.
    duel.fov = done ? this.lensFov : pose.fov + (this.lensFov - duel.lens);
    const fov = duel.fov + duel.punch();
    if (fov !== this.camera.fov) { this.camera.fov = fov; this.camera.updateProjectionMatrix(); }
    if (done) this.endDuelCamera(true);
  }

  /** Puts the player's view back this instant, if a duel shot still holds the camera. */
  private snapDuelCamera(): void {
    const duel = this.duelCamera;
    if (!duel) return;
    duel.timeline.snap();
    this.updateDuelCamera(0);
  }

  /** Lets go of the camera. `owned` is false when something newer has taken it: then only our own limits are undone. */
  private endDuelCamera(owned: boolean): void {
    this.duelCamera = null;
    this.applyOrbitLimits();
    if (!owned) return;
    this.cameraScripted = false;
    this.captureFollowRig();
    this.controls.enabled = this.interactive && !this.menuPresentation && !this.attract && !this.introPlaying;
  }

  // ------------------------------------------------------------ follow camera

  /**
   * The showcase follow camera. It holds one angle and one distance — whatever
   * the viewer last left the view on — and only ever slides that rig sideways
   * to keep the action in frame, so the board never spins under the fight.
   *
   * @returns true while the engine is the one writing the camera.
   */
  private updateFollowCamera(delta: number): boolean {
    if (!this.showcase || this.showcaseCamera !== "follow") return false;
    if (this.tactical || this.orbiting || this.cameraScripted || this.introPlaying) return false;
    // A hand on the mouse always wins; tracking resumes a couple of seconds later.
    if (this.elapsed - this.lastManualCameraAt < 2.4) return false;

    const subject = this.followPiece?.container.position ?? this.followPoint ?? BOARD_FOCUS;
    // Lean towards the action instead of sitting rigidly behind it: the eye
    // covers a fraction of the board rather than all of it, which both keeps the
    // rest of the position in shot and keeps the rig clear of the hall.
    this.scratchFocus
      .copy(BOARD_FOCUS)
      .addScaledVector(this.scratchLean.copy(subject).sub(BOARD_FOCUS), FOLLOW_LEAN)
      .setY(THREE.MathUtils.clamp(subject.y + 0.45, 0.35, 1.1));
    this.followedFocus.lerp(this.scratchFocus, 1 - Math.exp(-delta * 3.6));

    const desired = this.solveFollowEye(
      THREE.MathUtils.clamp(
        this.followRig.radius * this.followTightness,
        this.limits.minDistance,
        this.limits.maxDistance,
      ),
    );
    const smooth = 1 - Math.exp(-delta * 2.4);
    this.camera.position.lerp(desired, smooth);
    this.controls.target.lerp(this.followedFocus, smooth);
    return true;
  }

  /**
   * The eye the follow rig is asking for, already solved to stand inside the
   * hall.
   *
   * This is what stops the showcase camera shuddering. The rig is anchored on
   * the action, so tracking anything on the near half of the board asks for an
   * eye behind the wall — and correcting that on the *camera*, after the
   * smoothing has already run (which is all {@link confineCamera} can do), puts
   * a hard projection in the loop: every frame the chase steps outward and the
   * wall shoves it back, and the height is re-derived through a square root each
   * time. Measured against a figure marching down the near file, that doubled
   * the camera's mean frame-to-frame jerk and spiked it to half a percent of
   * screen height in single frames — a visible shudder on almost every move.
   *
   * So the wall is solved here instead, before anything moves: the rig's ground
   * reach is cut to whatever the hall actually has room for, paid for first out
   * of distance and only then out of elevation. The result is a legal target for
   * the same exponential smoothing, `confineCamera` never fires while following,
   * and the eye ends up *lower* than the old clamp left it.
   */
  private solveFollowEye(radius: number): THREE.Vector3 {
    const focus = this.followedFocus;
    const { phi, theta } = this.followRig;
    const room = HALL_INNER_RADIUS - FOLLOW_WALL_MARGIN;
    // How far the eye may travel along the rig's heading before it leaves the
    // hall: the positive root of |focus + reach · heading| = room.
    const towards = Math.sin(theta) * focus.x + Math.cos(theta) * focus.z;
    const span = towards * towards - (focus.x * focus.x + focus.z * focus.z) + room * room;
    const available = span <= 0 ? 0 : Math.max(0, Math.sqrt(span) - towards);
    const reach = Math.min(radius * Math.sin(phi), available);
    // Pay in distance first, down to the floor; the elevation covers the rest.
    const pulled = THREE.MathUtils.clamp(
      reach / Math.max(1e-3, Math.sin(phi)),
      Math.max(this.limits.minDistance, radius * (1 - FOLLOW_GIVE)),
      radius,
    );
    this.followOffset.set(
      pulled,
      Math.max(this.limits.minPolarAngle, Math.asin(THREE.MathUtils.clamp(reach / pulled, 0, 1))),
      theta,
    );
    return this.scratchDesired.setFromSpherical(this.followOffset).add(focus);
  }

  /**
   * Remembers the angle and distance the view is currently sitting at, so the
   * follow camera tracks the action from wherever the viewer put the camera
   * rather than snapping back to a canned shot.
   */
  private captureFollowRig(): void {
    const offset = this.scratchDesired.copy(this.camera.position).sub(this.controls.target);
    if (offset.lengthSq() < 1e-4) return;
    const spherical = new THREE.Spherical().setFromVector3(offset);
    this.followRig.phi = spherical.phi;
    this.followRig.theta = spherical.theta;
    this.followRig.radius = THREE.MathUtils.clamp(
      spherical.radius / Math.max(0.4, this.followTightness),
      this.limits.minDistance + 0.9,
      Math.max(13, this.fitRadius * 1.05),
    );
  }

  /** Follow-camera subject: the figure currently crossing the board. */
  private focusPiece(piece: PieceView | null, tightness = 1): void {
    this.followPiece = piece;
    if (piece) this.followPoint = null;
    this.followTightness = tightness;
  }

  /** Follow-camera subject: a fixed point — the fight, or the square taken. */
  private focusPoint(point: THREE.Vector3 | null, tightness = 1): void {
    this.followPiece = null;
    this.followPoint = point ? point.clone() : null;
    this.followTightness = tightness;
  }

  setCameraPreset(preset: CameraPreset): void {
    // Picking a 3D shot always folds the flat map away first.
    if (this.tactical) {
      this.setTacticalView(false, CAMERA_SHOTS[preset]);
      return;
    }
    this.framedShot = CAMERA_SHOTS[preset];
    const framing = this.framingFor(this.framedShot);
    this.adoptFraming(framing);
    void this.moveCameraTo(framing);
  }

  // --------------------------------------------------------- tactical 2D view

  /** True while the board is being read as a flat overhead map. */
  isTacticalView(): boolean {
    return this.tactical;
  }

  /**
   * Folds the hall away and reads the board as a 2D map: the camera climbs to
   * a narrow-lens overhead shot, every figure is replaced by a flat counter
   * stamped with its rank, and the world around the board is struck so nothing
   * can stand between the player and a square.
   */
  setTacticalView(active: boolean, exitShot?: CameraShot): void {
    if (this.tactical === active) return;
    this.cancelEndFraming();
    this.tactical = active;
    this.syncMomentFlags();
    this.gore?.setTactical(active);
    // Nothing drifts over the map: what is in the air goes, and nothing new is raised while it is up.
    if (active) this.vfx?.clear();
    if (active) this.flourish?.clear();
    if (active) this.vaultFx?.clear();
    this.boardReactions.reset(); this.reactionStateKey = "";
    this.callbacks.onTacticalView?.(active);

    if (active) {
      this.tacticalReturn = {
        position: this.camera.position.clone(),
        target: this.controls.target.clone(),
      };
      this.strikeWorld();
      this.applyTacticalAtmosphere();
      for (const piece of this.allPieces()) piece.setFlat(true);
      this.alignTokens();

      this.controls.enableRotate = false;
      this.controls.autoRotate = false;
      this.framedShot = TACTICAL_SHOT;
      void this.flyTo(this.framingFor(TACTICAL_SHOT));
      return;
    }

    const look = ARENA_LOOKS[this.arena];
    this.restoreWorld();
    (this.scene.background as THREE.Color).setHex(look.background);
    const fog = this.scene.fog as THREE.FogExp2 | null;
    if (fog) fog.density = look.fog.density;
    this.applyExposure(look.exposure * (this.campaignBattle ? 1.08 : 1));
    for (const piece of this.allPieces()) piece.setFlat(false);
    this.syncBoardReactions(this.controller.getSnapshot());

    this.controls.enableRotate = true;
    const shot = exitShot ?? this.tacticalReturn ?? CAMERA_SHOTS.white;
    this.tacticalReturn = null;
    this.framedShot = shot;
    void this.flyTo(this.framingFor(shot));
  }

  /** Camera move that also eases the lens between the 3D and map framings. */
  private async flyTo(framing: Framing): Promise<void> {
    this.cancelEndFraming();
    const fromPosition = this.camera.position.clone();
    const fromTarget = this.controls.target.clone();
    const fromFov = this.camera.fov;
    const fov = framing.fov;
    this.lensFov = fov;
    this.fitRadius = framing.radius;
    this.applyOrbitLimits();
    this.controls.enabled = false;
    this.cameraScripted = true;
    await this.tweens.to({
      duration: 0.95,
      easing: Ease.inOutCubic,
      onUpdate: (t) => {
        this.camera.position.lerpVectors(fromPosition, framing.position, t);
        this.controls.target.lerpVectors(fromTarget, framing.target, t);
        this.camera.fov = fromFov + (fov - fromFov) * t;
        this.camera.updateProjectionMatrix();
      },
    });
    this.camera.fov = fov;
    this.camera.updateProjectionMatrix();
    this.cameraScripted = false;
    this.captureFollowRig();
    this.controls.enabled = this.interactive;
  }

  /** A dark, theme-tinted void: no haze, nothing to read but the board. */
  private applyTacticalAtmosphere(): void {
    const look = ARENA_LOOKS[this.arena];
    (this.scene.background as THREE.Color).setHex(look.background).multiplyScalar(0.16);
    const fog = this.scene.fog as THREE.FogExp2 | null;
    if (fog) fog.density = 0;
    this.applyExposure(look.exposure * 1.12);
  }

  /**
   * Hides the staged world while keeping every light burning — the board still
   * has to be lit by the same key, fill and torches it had a moment ago.
   */
  private strikeWorld(): void {
    if (this.bakedWorld) this.bakedWorld.visible = false;
    for (const world of [this.hall, this.battlefield, this.jungle]) {
      for (const child of world?.group.children ?? []) {
        if ((child as THREE.Light).isLight || !child.visible) continue;
        child.visible = false;
        this.struck.push(child);
      }
    }
  }

  private restoreWorld(): void {
    if (this.bakedWorld) this.bakedWorld.visible = true;
    for (const object of this.struck) object.visible = true;
    this.struck = [];
  }

  /**
   * Spins every counter so its stamped rank stays upright on screen, whichever
   * way the map has been turned.
   */
  private alignTokens(): void {
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.camera.quaternion);
    const yaw = Math.atan2(-up.x, -up.z);
    for (const piece of this.allPieces()) piece.setTokenYaw(yaw);
  }

  /** Every figure the engine currently owns, wherever it is in its life. */
  private *allPieces(): Generator<PieceView> {
    for (const piece of this.pieces.values()) yield piece;
    for (const piece of this.motion) yield piece;
    for (const piece of this.captured) yield piece;
  }

  /**
   * Orbit the camera around the board centre by `deltaTheta` radians, keeping
   * the current distance and elevation so the framing never jumps.
   */
  private orbitBy(deltaTheta: number, duration: number): Promise<void> {
    if (this.orbiting) return Promise.resolve();
    return this.trackOrbit(this.turnView(deltaTheta, duration));
  }

  /** Notes a turn of the view as the one under way, so what must follow it can wait for it (swingCamera, flipCamera). */
  private trackOrbit(run: Promise<void>): Promise<void> {
    const tracked = run.finally(() => { if (this.orbitRun === tracked) this.orbitRun = null; });
    this.orbitRun = tracked;
    return tracked;
  }

  private async turnView(deltaTheta: number, duration: number): Promise<void> {
    this.orbiting = true;
    const target = this.controls.target.clone();
    const spherical = new THREE.Spherical().setFromVector3(this.camera.position.clone().sub(target));
    const startTheta = spherical.theta;
    const wasEnabled = this.controls.enabled, heldByScript = this.viewHeldByScript();
    this.controls.enabled = false;
    try {
      await this.tweens.to({
        // Where motion is reduced the view is simply on the other side (as moveCameraTo puts it): a half turn of
        // the whole picture is the largest motion a match has, and a duel made one after every move.
        duration: this.reducedMotion ? 0 : duration,
        easing: Ease.inOutCubic,
        onUpdate: (t) => {
          spherical.theta = startTheta + deltaTheta * t;
          this.camera.position.copy(target.clone().add(new THREE.Vector3().setFromSpherical(spherical)));
          this.camera.lookAt(target);
        },
      });
    } finally {
      this.orbiting = false;
      this.controls.enabled = this.viewFreeAfterTurn(wasEnabled, heldByScript);
    }
  }

  /** The view is held, for now, by a scripted camera or the opening (each hands it back when it ends). */
  private viewHeldByScript(): boolean { return !this.controls.enabled && (this.cameraScripted || this.introPlaying); }

  /**
   * Whether a hand may turn the view as a turn of it ends (turnView, resetView): if it was free when the turn began,
   * or was held only by a scripted camera that has ended meanwhile, and never while a script still holds it. Taken
   * as it stood at the start (M-22), a flip pressed while the camera was being moved left the view locked for the
   * match, and one begun just before a script would have freed it in the middle of that script.
   */
  private viewFreeAfterTurn(wasEnabled: boolean, heldByScript: boolean): boolean {
    if (this.cameraScripted || this.introPlaying) return false;
    return (wasEnabled || heldByScript) && this.interactive && !this.menuPresentation && !this.attract;
  }

  /**
   * HUD control: spin the view a half turn so the player can read the board
   * from the opponent's side. Works from any preset or hand-dragged angle.
   */
  flipCamera(): void {
    if (this.flipWaiting) return;
    const under = this.orbitRun;
    if (under) {
      // A flip's own turn is under way: a second press is not a second flip. Any other turn (a duel's to the next
      // player, the view being put back) is followed by this one: the press used to be dropped.
      if (this.flipping) return;
      this.flipWaiting = true;
      void under.then(() => { this.flipWaiting = false; if (!this.disposed) this.flipCamera(); });
      return;
    }
    if (this.orbiting) return;
    this.cameraFlipped = !this.cameraFlipped;
    this.callbacks.onCameraFlipped?.(this.cameraFlipped);
    this.flipping = true;
    void this.orbitBy(Math.PI, 0.95).finally(() => { this.flipping = false; });
  }

  /** The view may be turned by hand: the moments a drag of the mouse turns it. */
  private get viewFree(): boolean {
    return this.controls.enabled && !this.orbiting && !this.cameraScripted && !this.cameraDriven && !this.introPlaying;
  }

  /**
   * Turns, tilts and pulls the view from the keys or a controller's right stick, within the limits the mouse has
   * (viewport.ts, nudgeOrbit). `yaw` and `pitch` in radians, `zoom` as the share of the distance to close.
   */
  nudgeCamera(yaw: number, pitch: number, zoom: number): void {
    if (!this.viewFree) return;
    const target = this.controls.target;
    const now = new THREE.Spherical().setFromVector3(this.scratchDesired.copy(this.camera.position).sub(target));
    const next = nudgeOrbit(now, yaw, pitch, zoom, this.controls);
    this.camera.position.setFromSphericalCoords(next.radius, next.phi, next.theta).add(target);
    this.camera.lookAt(target);
    // The view is the player's, as after a drag: nothing automatic takes it back at once, and what follows the
    // play follows it from here.
    this.lastManualCameraAt = this.elapsed;
    this.captureFollowRig();
  }

  /**
   * Puts the view back where the game frames the board (its own distance and height) on the side it now stands
   * on, after the player has turned or pulled it away. It swings there; where motion is reduced it is simply there.
   */
  resetView(): void {
    // Not while a move is on stage: a duel's swing to the next player must not find the view already turning.
    if (!this.viewFree || this.tactical || this.movesInFlight > 0) return;
    // What is left of a drag's momentum is spent now (the controls drop it when they are not damping), so the view
    // does not drift on from where it is put.
    this.controls.enableDamping = false;
    this.controls.update();
    this.controls.enableDamping = true;
    const framing = this.framingFor(this.framedShot);
    const target = this.controls.target;
    const from = new THREE.Spherical().setFromVector3(this.camera.position.clone().sub(target));
    const home = new THREE.Spherical().setFromVector3(framing.position.clone().sub(framing.target));
    const theta = seatAzimuth(from.theta, home.theta);
    const place = (t: number) => {
      this.camera.position
        .setFromSphericalCoords(THREE.MathUtils.lerp(from.radius, home.radius, t), THREE.MathUtils.lerp(from.phi, home.phi, t), THREE.MathUtils.lerp(from.theta, theta, t))
        .add(target);
      this.camera.lookAt(target);
    };
    if (this.reducedMotion) {
      place(1);
      this.captureFollowRig();
      return;
    }
    this.orbiting = true;
    const wasEnabled = this.controls.enabled, heldByScript = this.viewHeldByScript();
    this.controls.enabled = false;
    // Noted as the turn under way: a move made in the same moment waits for it before its own swing (swingCamera).
    void this.trackOrbit(this.tweens.to({ duration: 0.45, easing: Ease.inOutCubic, onUpdate: place }).finally(() => {
      this.orbiting = false;
      this.controls.enabled = this.viewFreeAfterTurn(wasEnabled, heldByScript);
      this.captureFollowRig();
    }));
  }

  /** True when the view currently sits on the far side of its starting shot. */
  isCameraFlipped(): boolean {
    return this.cameraFlipped;
  }

  /**
   * Hotseat: swing the camera round the board between turns. A turn of the view already under way is waited for
   * first. Flip board pressed in the last moment of a move used to leave this swing out (one turn is never started
   * over another), so the next player sat on the wrong side of the board, and "flipped" said the opposite of what
   * was on screen from then on. Now the flip ends and the swing follows it.
   */
  private async swingCamera(): Promise<void> {
    while (this.orbitRun && !this.disposed) await this.orbitRun;
    await this.orbitBy(Math.PI, 1.15);
  }

  async playIntro(): Promise<void> {
    if (this.introPlaying) return;
    this.introPlaying = true;
    this.introSkipped = false;
    this.interactive = false;
    this.controls.enabled = false;
    if (this.reducedMotion) {
      const shot = this.menuPresentation ? this.menuShot() : CAMERA_SHOTS.white;
      this.camera.position.copy(shot.position);
      this.controls.target.copy(shot.target);
      this.introPlaying = false;
      this.controls.enabled = false;
      return;
    }
    this.postfx.setCinematic(true, 7);

    // The fly-in is a performance and keeps its authored path, but the shot it
    // lands on is the one the player will play from — so that one is solved for
    // the screen like every other framing.
    this.framedShot = CAMERA_SHOTS.white;
    const rest = this.framingFor(CAMERA_SHOTS.white);
    this.adoptFraming(rest);
    const path: CameraShot[] = [
      { position: new THREE.Vector3(13.5, 2.1, 12.5), target: new THREE.Vector3(5, 3.2, 3.5) },
      { position: new THREE.Vector3(8.5, 2.4, 10.5), target: new THREE.Vector3(0, 1.4, 0) },
      { position: new THREE.Vector3(2.6, 4.2, 9.6), target: new THREE.Vector3(0, 0.6, 0) },
      this.menuPresentation ? this.menuShot() : rest,
    ];
    this.camera.position.copy(path[0].position);
    this.controls.target.copy(path[0].target);

    for (let i = 1; i < path.length; i += 1) {
      if (this.introSkipped) break;
      await this.moveCameraTo(path[i], i === path.length - 1 ? 1.45 : 1.2);
      this.controls.enabled = false;
    }

    const finalShot = this.menuPresentation ? this.menuShot() : rest;
    this.camera.position.copy(finalShot.position);
    this.controls.target.copy(finalShot.target);
    this.postfx.setCinematic(false);
    this.introPlaying = false;
    this.interactive = !this.menuPresentation;
    this.controls.enabled = this.interactive;
  }

  /**
   * The performance before a match's first move: scripted shots (shared/play/match-opening.ts decides them) that end
   * on the framing the match is played from. An army that a shot musters is absent until that shot, then burns in
   * along its ranks. Resolves true if it played through, false if it was skipped or could not play (reduced motion,
   * the flat map, another performance on stage). Either way the camera ends at rest with both armies standing.
   */
  playMatchOpening(shots: readonly OpeningShot[], preset: CameraPreset, onShot?: (index: number) => void, options: { held?: boolean } = {}): Promise<boolean> {
    this.framedShot = CAMERA_SHOTS[preset];
    const rest = this.framingFor(this.framedShot);
    this.adoptFraming(rest);
    if (this.matchOpening || this.introPlaying) return Promise.resolve(false);
    if (this.disposed || this.reducedMotion || this.tactical || shots.length === 0) {
      this.camera.position.copy(rest.position); this.controls.target.copy(rest.target); this.captureFollowRig();
      return Promise.resolve(false);
    }
    this.cancelEndFraming();
    this.introPlaying = true; this.cameraScripted = true; this.controls.enabled = false;
    const timeline = new MatchOpeningTimeline(shots, { position: [rest.position.x, rest.position.y, rest.position.z], target: [rest.target.x, rest.target.y, rest.target.z], fov: rest.fov });
    // An army that a shot musters takes the field in its own kingdom's manner (a rematch's opening musters none).
    if (shots.some((shot) => shot.muster)) this.musterEffects.begin(this.factory.getSkins());
    return new Promise((resolve) => {
      const moments: number[] = [];
      let at = 0;
      for (const shot of shots) { moments.push(at + 0.04, at + shot.seconds * 0.5, at + Math.max(0.04, shot.seconds - 0.04)); at += shot.seconds; }
      this.matchOpening = { timeline, shot: -1, onShot, reveal: new Map(), resolve, clock: performance.now(), held: options.held ?? false, warm: { moments, next: 0, rounds: 0 } };
      this.updateMatchOpening();
    });
  }

  /**
   * Holds the opening on its present moment, or lets it run again. The match screen starts it held, on its first
   * frame, while the loading screen is still up, so that frame's work is done unseen and none of the opening is spent
   * before it can be watched. While it is held every figure stands solid with its crest, so the shaders for all of
   * them (their shadows and crests too) are built then. Built when each first appeared, they stalled the picture as
   * each army took the field, and for up to 0.6 s as the match began and the crests came back. The armies leave the
   * field when it is let go.
   */
  holdMatchOpening(held: boolean): void {
    const opening = this.matchOpening;
    if (!opening || opening.held === held) return;
    opening.held = held;
    // Let go, it starts from its first frame, wherever the visits left its camera.
    if (!held) { opening.timeline.seek(0); opening.clock = performance.now(); }
  }

  /** True once a held opening's camera has visited every shot (see holdMatchOpening): what it will show has been
   * drawn. */
  get matchOpeningWarm(): boolean { return (this.matchOpening?.warm.rounds ?? 0) > 0; }

  /** Ends the opening this instant: the camera at rest, both armies standing. */
  skipMatchOpening(): void {
    if (!this.matchOpening) return;
    this.matchOpening.timeline.skip();
    this.updateMatchOpening(false);
  }

  /** True while the opening holds the camera and `skipMatchOpening()` would act. */
  get matchOpeningActive(): boolean { return this.matchOpening !== null; }

  /**
   * Moves the opening along. It keeps real time rather than the frame's delta, which is capped at a twentieth of a
   * second: on a slow machine that cap would play the whole opening in slow motion. One long frame (shaders being
   * built) still moves it by no more than a quarter of a second.
   */
  private updateMatchOpening(completed = true): void {
    const opening = this.matchOpening;
    if (!opening) return;
    const now = performance.now(), delta = opening.held ? 0 : Math.min(0.25, Math.max(0, (now - opening.clock) / 1000));
    opening.clock = now;
    // Held, its camera visits one of the shots' moments each frame: whatever the opening will show is drawn (its
    // shaders built, its textures sent to the card) under the loading screen. Drawn as it first came into view, the
    // arena's dark end stalled the picture just as White's army began to form.
    const warm = opening.warm;
    if (opening.held && !this.disposed) { if (warm.next >= warm.moments.length) { warm.next = 0; warm.rounds += 1; } }
    const sample = this.disposed ? opening.timeline.skip() : opening.held ? opening.timeline.seek(warm.moments[warm.next++] ?? 0) : opening.timeline.update(delta);
    // Each army as far onto the field as its wave has run. Only figures whose state changes are touched. A figure not
    // yet begun is simply not drawn; one that is forming burns in. (Not setOpacity: making a figure's materials
    // transparent asks for new shader variants, which stalls the picture for seconds the first time.) Held, they all
    // stand as they are (see holdMatchOpening).
    for (const [square, piece] of opening.held ? [] : this.pieces) {
      const reveal = musterReveal(sample.muster[piece.color], square.charCodeAt(0) - 97, piece.kind === "p", sample.musterFrom[piece.color]);
      const before = opening.reveal.get(piece);
      // No crests over the figures while the camera is among them.
      if (before === undefined) piece.setBadgeEnabled(false);
      opening.reveal.set(piece, reveal);
      if (reveal === (before ?? 1)) continue;
      piece.container.visible = reveal > 0; piece.setFormation(reveal);
      if (!sample.done) {
        // Its kingdom's manner of taking the field: its sigil on the tile, its motes in the air and its ember on the
        // burning edge.
        const style = this.musterEffects.track(square, piece.color, piece.container.position.x, piece.container.position.z, PIECE_HEIGHT[piece.kind], reveal, opening.timeline.time);
        if (style) piece.setDissolveEmber(style.ember, style.emberGain);
      }
      // The moment it stands whole, its ground lights (not when the opening is cut short: then all stand at once).
      if (reveal >= 1 && !sample.done) piece.flareAura(0.9);
    }
    if (!sample.done) {
      this.musterEffects.update(opening.timeline.time);
      // The shots stand closer, further and lower than a hand on the view may go (set each frame: a resize puts the
      // player's limits back).
      this.controls.minDistance = 0.2; this.controls.maxDistance = 400;
      this.controls.minPolarAngle = 0.01; this.controls.maxPolarAngle = Math.PI - 0.01;
      this.camera.position.set(sample.position[0], sample.position[1], sample.position[2]);
      this.controls.target.set(sample.target[0], sample.target[1], sample.target[2]);
      if (sample.fov !== this.camera.fov) { this.camera.fov = sample.fov; this.camera.updateProjectionMatrix(); }
      this.setOpeningExposure(sample.exposure);
      this.postfx.setCinematic(sample.focus !== null, sample.focus ?? undefined);
      if (sample.shot !== opening.shot && !opening.held) {
        opening.shot = sample.shot;
        try { opening.onShot?.(sample.shot); } catch (error) { console.error("[scene] opening shot listener failed", error); }
      }
      return;
    }
    // Over: the framing the match is played from, solved afresh in case the screen changed meanwhile. Whatever of the
    // kingdoms' effects is still in the air goes at once, and every burning edge takes its side's ember again.
    this.matchOpening = null;
    this.musterEffects.clear();
    this.setOpeningExposure(1);
    for (const piece of this.pieces.values()) { piece.setBadgeEnabled(this.rankBadges && !this.menuPresentation); piece.setDissolveEmber(null); }
    const rest = this.framingFor(this.framedShot);
    this.adoptFraming(rest);
    this.camera.position.copy(rest.position); this.controls.target.copy(rest.target);
    this.postfx.setCinematic(false);
    this.introPlaying = false; this.cameraScripted = false;
    this.captureFollowRig();
    this.controls.enabled = this.interactive && !this.menuPresentation && !this.attract;
    opening.resolve(completed && !this.disposed);
  }

  /** Cuts a Combat Director fight to its killing blow. The capture still resolves in full. */
  skipCombat(): void {
    const control = this.combatControl;
    if (!control) return;
    // Before the blow: the fight cuts to it. After it, or asked a second time: what is left plays out fast.
    if (this.combatKilled || control.skipping) this.combatHurry = SKIP_HURRY;
    control.skip();
    // ...and a fatality playing on the blow gives the scene its own time back, as does the blow's hit-stop (moments/).
    this.fatality?.cancel(); this.fatalityShot = null;
    this.moments.hurry();
    // A hit-stop still holding ends now, and the blow the skip lands on gets no slow motion (combat/feel.ts).
    this.combatFeel.skip();
    // The player asked to get on with it: the view is theirs again at once.
    this.snapDuelCamera();
  }

  /** True while a Combat Director fight is on stage and `skipCombat()` would act. */
  get combatActive(): boolean { return this.combatControl !== null; }

  skipIntro(): void {
    if (!this.introPlaying) return;
    this.introSkipped = true;
    this.tweens.cancelAll();
  }

  /**
   * The ending, for the live game's gameover and a replay's (playReplayEnding) alike: the closing sound, and for a
   * checkmate, a resignation or a time loss the downfall (scene/downfall), staged from the final position and the
   * match's seed, so a replay shows it as the game did; draws keep their quieter ending.
   */
  private async playEndCinematic(playAudio = true): Promise<void> {
    const snapshot = this.controller.getSnapshot();
    const result = snapshot.result;
    if (!result) return;
    const kind = downfallKind(result.reason);
    const staged = !!kind && !!result.winner && !this.tactical && !this.menuPresentation && !this.attract;
    const timeline = staged && !this.reducedMotion ? DOWNFALL_TIMELINES[kind!] : null;
    if (playAudio && !this.silentBoard()) this.voiced("ending", () => audio.endGame(result, snapshot.mode === "ai" ? snapshot.playerColor : null,
      timeline ? { sting: timeline.end - 0.4 } : {}));
    this.tellChronicle(snapshot, result);
    // The map holds its framing: no dolly, no depth of field.
    if (this.tactical) return;
    if (staged) {
      this.syncBoardReactions(snapshot);
      this.downfallHeard = playAudio;
      const plan = this.stageDownfall(snapshot, this.reducedMotion);
      if (plan) { await this.presentDownfall(plan); return; }
    }

    const loser: Faction | null = result.winner ? (result.winner === "w" ? "b" : "w") : null;
    let focus = new THREE.Vector3(0, 0.6, 0);
    if (loser) {
      for (const [square, piece] of this.pieces) {
        if (piece.kind === "k" && piece.color === loser) {
          focus = squareToWorld(square, 0.7);
          break;
        }
      }
    }
    this.postfx.setCinematic(true, Math.max(4, this.camera.position.distanceTo(focus) * 0.55));
    const direction = this.camera.position.clone().sub(focus).normalize();
    const shot: CameraShot = {
      position: focus.clone().add(direction.clone().multiplyScalar(3.4)).setY(1.9),
      target: focus,
    };
    this.shake.add(0.35);
    await this.moveCameraTo(shot, this.reducedMotion ? 0 : 1.35);
  }

  /**
   * Stages the downfall of the side that lost (scene/downfall/downfallStage.ts): the plan comes from the final
   * position alone, so a replay of the record stages the same ending. `instant` puts the final tableau down at once.
   */
  private stageDownfall(snapshot: GameSnapshot, instant: boolean): DownfallPlan | null {
    const result = snapshot.result;
    const kind = downfallKind(result?.reason);
    if (!result?.winner || !kind) return null;
    const threat = kind === "checkmate" ? boardRoyalThreat(snapshot.fen, snapshot.moves)?.attackers[0] ?? null : null;
    const at = (v: THREE.Vector3) => ({ x: v.x, y: v.y, z: v.z });
    // The check is over: the red square under the King goes, his own ring fades with his defiance.
    this.board.clearHighlights(["check"]);
    const plan = this.downfall.begin({
      reason: kind, winner: result.winner, threat, squareSize: TILE, ground: BOARD_TOP, instant, key: `${result.reason}:${snapshot.fen}`, seed: this.downfallSeed(),
      figures: [...this.pieces].map(([square, view]) => ({ square, view })),
      camera: { origin: { position: at(this.camera.position), target: at(this.controls.target), fov: this.camera.fov }, lens: this.lensFov, aspect: this.camera.aspect, reach: HALL_INNER_RADIUS - 0.5,
        sight: this.arenaSight() },
    });
    // What was staged, for a browser check comparing a live ending with its replay.
    if (plan) this.showTrace("downfall", { key: plan.key, instant, roles: [plan.king, ...plan.defeated].map(role => `${role.square} ${role.gesture} ${role.rearSide} ${role.start.toFixed(3)} ${role.drop.toFixed(3)}`) });
    return plan;
  }

  /** The downfall's shots ask whether the arena (not the figures) stands between an eye and a point. */
  private arenaSight(): ((eye: { x: number; y: number; z: number }, point: { x: number; y: number; z: number }) => boolean) | undefined {
    const world = this.bakedWorld;
    if (!world) return undefined;
    const solid: THREE.Object3D[] = [];
    world.traverseVisible(node => { const mesh = node as THREE.Mesh; if (mesh.isMesh && !(node as THREE.SkinnedMesh).isSkinnedMesh) solid.push(mesh); });
    const ray = new THREE.Raycaster(), from = new THREE.Vector3(), to = new THREE.Vector3();
    return (eye, point) => {
      from.set(eye.x, eye.y, eye.z); to.set(point.x, point.y, point.z).sub(from);
      const distance = to.length();
      if (distance < 1e-3) return true;
      ray.set(from, to.normalize()); ray.near = 0; ray.far = Math.max(0, distance - 0.4);
      return ray.intersectObjects(solid, false).length === 0;
    };
  }

  /**
   * The match's own draw for its downfall (shared/play/replay-show.ts showSeed): the plan's small variety (the wave's
   * unevenness, which knee goes down, who answers for the victors and in which voice) comes from it and the final
   * position, so a replay stages the ending the game staged. 0 for a record without a seed: the position alone.
   */
  private downfallSeed(): number {
    const seed = this.matchSeed();
    return seed === null ? 0 : showSeed(seed, this.controller.getSnapshot().sanList, "downfall");
  }

  /** Tells a browser check comparing a live ending with its replay what the downfall played, and when (showTrace). */
  private downfallTrace(what: string): void {
    this.showTrace("downfall-sound", `${this.downfall.clock.time.toFixed(2)} ${what}`);
  }

  /** The battle's chronicle, from its record, for the results (the match's panel, a replay's end). */
  private tellChronicle(snapshot: GameSnapshot, result: GameResult): void {
    if (!this.callbacks.onChronicle) return;
    const skins = this.factory.getSkins();
    let chronicle: Chronicle | null = null;
    try {
      // The battle memory's own story (shared/play/battle-memory.ts), read from the moves at the ply the game ended on,
      // a replay's included: the renowned, the companions parted and the avengers, as the battlefield showed them.
      const story = readBattle(snapshot.moves, startingFen(snapshot.pgn)).story();
      chronicle = writeChronicle({ pgn: snapshot.pgn, result, sides: { w: gambitSound.KINGDOM_NAMES[skins.w], b: gambitSound.KINGDOM_NAMES[skins.b] } }, storyRenown(story), story);
    } catch (cause) { console.warn("[ending] chronicle unavailable", cause); }
    this.callbacks.onChronicle(chronicle);
  }


  /** A rebuilt board (another army, a new preset) that is still the same ending stands in its final tableau again. */
  private restageDownfall(): void {
    const snapshot = this.controller.getSnapshot();
    if (snapshot.status !== "over" || !snapshot.result || this.tactical || this.menuPresentation) return;
    if (this.downfall.stagedKey === `${snapshot.result.reason}:${snapshot.fen}`) this.stageDownfall(snapshot, true);
  }

  /** The camera through the downfall's shots, with the results held back until it ends (or is skipped). */
  private async presentDownfall(plan: DownfallPlan): Promise<void> {
    if (this.reducedMotion) {
      // No travel: the tableau is already down; one cut to the board, and the results at once.
      const pose = this.downfall.cameraAt(plan.timeline.end);
      if (pose) await this.moveCameraTo({ position: new THREE.Vector3(pose.position.x, pose.position.y, pose.position.z), target: new THREE.Vector3(pose.target.x, pose.target.y, pose.target.z) }, 0);
      return;
    }
    const revision = this.boardRevision, cameraRevision = ++this.conclusionCameraRevision;
    this.cameraScripted = true; this.controls.enabled = false;
    // The close shots stand nearer and lower than the player may.
    this.controls.minDistance = Math.min(this.controls.minDistance, .4);
    this.controls.minPolarAngle = 0; this.controls.maxPolarAngle = Math.PI - 0.05;
    this.conclusionViewActive = true;
    this.callbacks.onConclusionState?.(true);
    const kingView = this.pieces.get(plan.king.square) ?? null;
    const king = kingView?.container.position.clone() ?? new THREE.Vector3();
    // In the close shot only the beaten King's crest stays (it fades with him there); the others would fill the frame.
    // In the hold, faded, his goes too; on the board's wide view they all come back.
    let crestMode: "all" | "king" | "none" = "all";
    const crests = (mode: "all" | "king" | "none") => {
      if (mode === crestMode) return;
      crestMode = mode;
      const shown = this.rankBadges && !this.menuPresentation && !this.badgesHiddenForShot;
      for (const piece of this.pieces.values()) piece.setBadgeEnabled(shown && (mode === "all" || (mode === "king" && piece === kingView)));
    };
    const timeline = plan.timeline;
    // The defeat grade (moments/): the beaten side's colour and the hall's light drain as the realization spreads
    // through his army, and come back as the view pulls back to the board for the results.
    const grade = { on: false, off: false };
    const regrade = (time: number) => {
      if (!grade.on && time >= timeline.spread && time < timeline.final) {
        grade.on = true;
        // A supporting grade (moments/momentPlan.ts DEFEAT): the shade over the beaten half says which side fell.
        this.setDefeatGrade(plan.loser, plan.kind === "checkmate" ? 0.6 : 0.45, timeline.spreadEnd - timeline.spread);
      }
      if (grade.on && !grade.off && time >= timeline.final) { grade.off = true; this.setDefeatGrade(null, 0, timeline.end - timeline.final); }
    };
    try {
      await this.conclusion.start(revision, sample => {
        if (this.isStale(revision)) return;
        regrade(sample.time);
        if (cameraRevision !== this.conclusionCameraRevision) return;
        crests(sample.time < (timeline.alone ?? timeline.hold) || sample.time >= timeline.final ? "all" : sample.time < timeline.hold ? "king" : "none");
        const pose = this.downfall.cameraAt(sample.time);
        if (!pose) return;
        this.camera.position.set(pose.position.x, pose.position.y, pose.position.z);
        this.controls.target.set(pose.target.x, pose.target.y, pose.target.z);
        if (Math.abs(this.camera.fov - pose.fov) > 1e-4) { this.camera.fov = pose.fov; this.camera.updateProjectionMatrix(); }
        this.postfx.setCinematic(true, Math.max(1.5, this.camera.position.distanceTo(king)));
      }, { duration: plan.timeline.end, phaseAt: time => downfallBeat(plan.timeline, time) });
    } finally {
      if (!this.isStale(revision)) crests("all");
      if (!this.isStale(revision) && grade.on && !grade.off) this.setDefeatGrade(null);
      if (!this.isStale(revision)) {
        if (cameraRevision === this.conclusionCameraRevision && this.conclusionViewActive) {
          this.conclusionViewActive = false;
          this.releaseConclusionCamera();
          this.controls.enabled = this.interactive; this.captureFollowRig();
          this.postfx.setCinematic(false); this.callbacks.onConclusionState?.(false);
        }
        if (this.rebuildPending && this.movesInFlight === 0) this.rebuildPieces();
      }
    }
  }

  /** The lens and the orbit limits the player had before a conclusion took the camera. */
  private releaseConclusionCamera(): void {
    this.cameraScripted = false;
    if (this.camera.fov !== this.lensFov) { this.camera.fov = this.lensFov; this.camera.updateProjectionMatrix(); }
    this.applyOrbitLimits();
  }

  /**
   * Straight to the end of the ending: every figure down, every weapon on the stone, the final view and the results.
   * Whatever a blow, a spell or the defeat grade left on the frame eases out with it (moments/).
   */
  skipEndCinematic(): void {
    this.downfall.skip();
    this.conclusion.skip();
    this.moments.settle();
  }
  private cancelEndFraming(): void {
    this.conclusionCameraRevision++; this.conclusion.cancel();
    if (this.conclusionViewActive) {
      this.conclusionViewActive = false;
      this.releaseConclusionCamera();
      this.controls.enabled = this.interactive && !this.menuPresentation && !this.attract;
      this.postfx.setCinematic(false); this.callbacks.onConclusionState?.(false);
    }
  }

  async playMissionResolution(result: GameResult): Promise<void> {
    if (result.winner === "w") audio.play("fanfare", 0.62);
    else audio.blip("deny");
    await this.playEndCinematic(false);
    if (!this.reducedMotion) await wait(0.78);
    this.postfx.setCinematic(false);
  }

  // ---------------------------------------------------------------- promotion

  private buildPromotionPicker(color: Faction): void {
    // A picker left standing goes first; the staging just set for this one (stagePromotionChoice) stays.
    const anchor = this.promotionAnchor;
    this.closePromotionPicker();
    this.promotionAnchor = anchor;
    const group = new THREE.Group();
    const pedestalGeometry = new THREE.CylinderGeometry(0.42, 0.5, 0.2, 20);
    const pedestalMaterial = new THREE.MeshStandardMaterial({
      color: 0x3a332a,
      roughness: 0.5,
      metalness: 0.7,
      emissive: 0x2a1c08,
      emissiveIntensity: 0.5,
    });
    // Each pedestal has its own copy, so the one in focus can glow alone; the picker owns only these (M-12): the
    // figures on them share their sculpts with the board.
    const materials = PROMOTION_CHOICES.map(() => pedestalMaterial.clone());
    group.userData.pedestal = { geometry: pedestalGeometry, material: pedestalMaterial, materials };
    this.promotionFocus = DEFAULT_PROMOTION_FOCUS;
    this.promotionGlow.setHex(PROMOTION_LOOK[this.factory.getSkins()[color] as VfxArmy].glow);
    // Staged over the far square the candidates stand closer together and larger on their pedestals (choiceStage).
    const staged = this.promotionAnchor !== null;
    const spacing = staged ? CHOICE_SPACING : 1.35, size = staged ? CHOICE_FIGURE : 0.78;

    PROMOTION_CHOICES.forEach((kind, index) => {
      const slot = new THREE.Group();
      slot.position.set((index - 1.5) * spacing, 0, 0);
      const pedestal = new THREE.Mesh(pedestalGeometry, materials[index]);
      pedestal.position.y = -0.1;
      pedestal.userData.promotion = kind;
      slot.add(pedestal);

      const view = this.factory.create(kind, color, {
        contactShadows: false,
        idleAnimation: true,
        rankBadge: false,
        // No glances of its own: the focus decides where each one looks.
        dynamicMotion: false,
      });
      view.container.scale.setScalar(size);
      // Facing out of the picker, toward the eye it is turned to.
      view.setFacing(new THREE.Vector3(0, 0, 1));
      for (const mesh of view.hitMeshes) mesh.userData.promotion = kind;
      slot.add(view.container);
      this.promotionViews.push(view);
      const look = promotionFocusLook(kind === this.promotionFocus, this.reducedMotion);
      this.promotionSlots.push({ kind: kind as PromotionChoice, slot, view, pedestal: materials[index]!, ...look, hips: promotionHips(view.visual) });
      group.add(slot);
    });
    this.applyPromotionFocus(1);

    group.position.set(0, 2.6, 0);
    if (this.promotionAnchor) { group.position.copy(this.promotionAnchor.position); group.scale.setScalar(this.promotionAnchor.scale); }
    this.scene.add(group);
    this.promotionGroup = group;
    this.postfx.setCinematic(true, this.camera.position.distanceTo(group.position));
    this.callbacks.onPromotionOpen(true);
    this.callbacks.onPromotionFocus?.(this.promotionFocus);
  }

  /** Eases each candidate toward its focus look (promotion/promotionChoice.ts): every frame while the picker is up. */
  private updatePromotionFocus(delta: number): void {
    this.applyPromotionFocus(focusEase(delta, this.reducedMotion));
  }

  /** Moves each candidate `amount` of the way to its look, and draws it: lift, turn, how solid, the pedestal's glow. */
  private applyPromotionFocus(amount: number): void {
    for (const entry of this.promotionSlots) {
      const look = promotionFocusLook(entry.kind === this.promotionFocus, this.reducedMotion);
      entry.lift += (look.lift - entry.lift) * amount;
      entry.turn += (look.turn - entry.turn) * amount;
      entry.opacity += (look.opacity - entry.opacity) * amount;
      entry.glow += (look.glow - entry.glow) * amount;
      entry.view.container.position.y = entry.lift;
      // The others turn a quarter away toward the middle of the row; the focused one looks straight out.
      const index = PROMOTION_CHOICES.indexOf(entry.kind);
      // An idle that swings the whole body round (a Queen's) is held facing the way the figure stands: the slot takes
      // back what the clip has turned the hips away from their bind pose, so "turned to the camera" stays so.
      entry.slot.rotation.y = entry.turn * (index < 1.5 ? 1 : -1) - (entry.hips ? hipsTurn(entry.hips) : 0);
      entry.view.setOpacity(entry.opacity);
      entry.pedestal.emissive.setHex(0x2a1c08).lerp(this.promotionGlow, entry.glow);
      entry.pedestal.emissiveIntensity = 0.5 + entry.glow * 1.1;
    }
  }

  /**
   * Focuses a candidate on the picker (the pointer over it or its row in the HUD's panel, a browser check): it lifts,
   * turns to the camera and its pedestal glows, the HUD highlights its row. Nothing is chosen. Ignored with no picker up.
   */
  focusPromotion(kind: PieceKind): void {
    if (!this.promotionGroup || !isPromotionChoice(kind) || kind === this.promotionFocus) return;
    this.promotionFocus = kind;
    audio.blip("hover");
    this.callbacks.onPromotionFocus?.(kind);
  }

  /** Moves the picker's focus `step` candidates along, wrapping round (the arrows, the controller's d-pad). */
  movePromotionFocus(step: number): void {
    if (!this.promotionGroup) return;
    this.focusPromotion(stepPromotionFocus(this.promotionFocus, step));
  }

  /** Chooses the candidate in focus (Enter, Space, the controller's select). */
  confirmPromotion(): void {
    if (!this.promotionGroup) return;
    this.chooseKeyboardPromotion(this.promotionFocus);
  }

  /** The candidate in focus while the picker is up; null without one. */
  get promotionFocused(): PieceKind | null {
    return this.promotionGroup ? this.promotionFocus : null;
  }

  /** The candidate under the pointer on the picker: its figure or its pedestal. */
  private promotionUnderPointer(): PieceKind | undefined {
    if (!this.promotionGroup) return undefined;
    const meshes: THREE.Object3D[] = [];
    this.promotionGroup.traverse((node) => {
      if ((node as THREE.Mesh).isMesh) meshes.push(node);
    });
    for (const hit of this.raycaster.intersectObjects(meshes, false)) {
      for (let node: THREE.Object3D | null = hit.object; node; node = node.parent) {
        const kind = node.userData.promotion as PieceKind | undefined;
        if (kind) return kind;
      }
    }
    return undefined;
  }

  /**
   * The choice staged (promotion/promotionPlan.ts choiceStage): the camera comes in close on the Pawn and the square it
   * is about to take, and the picker floats over that square, beyond the Pawn, small enough that the Pawn stands clear
   * under it. Only where the sequence after it could take the camera; anywhere else the picker floats over the middle
   * of the board as it always has. Nothing about the choice itself changes: keys, pointer, controller and Back.
   */
  private stagePromotionChoice(from: SquareId, to: SquareId, color: Faction): void {
    this.promotionAnchor = null;
    this.promotionShot = null;
    if (!this.captureCinematics || this.reducedMotion || this.tactical) return;
    const context = { reducedMotion: this.reducedMotion, tactical: this.tactical, menuBoard: this.menuPresentation || this.attract, cinematics: this.captureCinematics, replay: !!this.controller.getSnapshot().replay };
    if (!choiceStaged(context) || this.introPlaying) return;
    const pawn = squareToWorld(from), square = squareToWorld(to);
    const facing = clearestFacing(color, square, this.promotionObstacles([from, to]));
    const stage = choiceStage({ pawn, square, side: color, boardTop: BOARD_TOP, edge: TILE * 4, facing, aspect: this.camera.aspect });
    const timeline = this.takePromotionCamera(stage.frame, stage.facing, PROMOTION_TIMING.easeIn, 12);
    if (!timeline) return;
    this.promotionShot = { timeline, revision: this.boardRevision, facing };
    this.promotionAnchor = { position: new THREE.Vector3(stage.anchor.x, stage.anchor.y, stage.anchor.z), scale: stage.scale };
    this.board.setHighlight(to, "promote");
  }

  /** The figures standing round the board, but those on `except`, as the close shots look past them (clearestFacing). */
  private promotionObstacles(except: readonly SquareId[]): { x: number; z: number; height: number }[] {
    const out: { x: number; z: number; height: number }[] = [];
    for (const [square, piece] of this.pieces) {
      if (except.includes(square) || piece.isSlain) continue;
      out.push({ x: piece.container.position.x, z: piece.container.position.z, height: PIECE_HEIGHT[piece.kind] });
    }
    return out;
  }

  /** Lets the picker's close shot go home, if nothing has taken the camera from it (Back, or a move that was refused). */
  private releasePromotionShot(): void {
    const shot = this.promotionShot;
    this.promotionShot = null;
    if (shot && this.duelCamera?.timeline === shot.timeline) shot.timeline.release();
  }

  /**
   * Takes the camera for a promotion's close shot (the choice, the arrival), framing `frame` from `facing` on the match's
   * lens and looking `look` degrees down at it, under the duel shot's own conditions (riteCameraHome). Null when it may not.
   */
  private takePromotionCamera(frame: readonly { x: number; y: number; z: number }[], facing: { x: number; z: number }, easeIn: number, look: number): DuelCameraTimeline | null {
    const taking = this.riteCameraHome();
    if (!taking) return null;
    const shot = this.riteDuelShot(frame, taking.home, 0, true, this.lensFov, undefined, undefined, look, facing);
    return this.takeRiteCamera(taking, shot, easeIn);
  }

  private closePromotionPicker(): void {
    this.promotionAnchor = null;
    if (this.promotionGroup) {
      this.scene.remove(this.promotionGroup);
      // Only the pedestal is the picker's own. Disposing every geometry in the group deleted the sculpts, discs and
      // weapons the figures share with the board, which were then uploaded again on the next frame (M-12).
      const pedestal = this.promotionGroup.userData.pedestal as { geometry: THREE.BufferGeometry; material: THREE.Material } | undefined;
      pedestal?.geometry.dispose();
      pedestal?.material.dispose();
      for (const material of (this.promotionGroup.userData.pedestal as { materials?: THREE.Material[] } | undefined)?.materials ?? []) material.dispose();
      this.promotionGroup = null;
    }
    this.promotionSlots = [];
    for (const view of this.promotionViews) view.dispose();
    this.promotionViews = [];
    this.postfx.setCinematic(false);
    this.callbacks.onPromotionOpen(false);
  }

  private requestPromotion(color: Faction): Promise<PieceKind | "back" | "gone"> {
    this.buildPromotionPicker(color);
    return new Promise((resolve) => {
      this.promotionResolve = (answer) => {
        this.promotionResolve = null;
        this.closePromotionPicker();
        resolve(answer);
      };
    });
  }

  /**
   * Backs out of the promotion picker: no move is made, and the Pawn is in hand again as it was before its
   * destination was pressed (Escape, a controller's back button, the mouse's other button, the HUD's Back). The
   * picker used to take nothing but a piece for an answer, so a press on the wrong square had to be played, and so
   * had a queued move that asked on its own when the board came free.
   */
  cancelPromotion(): void {
    if (!this.promotionResolve) return;
    audio.blip("press");
    this.promotionResolve("back");
  }

  /** The promotion sequence this move gets on this board now (promotion/promotionPlan.ts). */
  private promotionPlanFor(event: MoveEvent): PromotionPlan {
    const snapshot = this.controller.getSnapshot();
    return planPromotion({
      army: this.factory.getSkins()[event.color] as VfxArmy, rank: (event.promotion ?? "q") as PromotionRank, side: event.color, quality: this.preset,
      reducedMotion: this.reducedMotion, tactical: this.tactical, menuBoard: this.menuPresentation || this.attract || this.silentBoard(),
      replay: !!snapshot.replay, cinematics: this.captureCinematics && !this.introPlaying, hurried: this.combatHurry > 1 || this.walkHurry > 1, capture: !!event.capture,
    });
  }

  /**
   * The camera comes in close on the far square (promotion/promotionPlan.ts arrivalFrame): the picker's shot carried on
   * from the choice where it still holds, otherwise a shot of its own taken from wherever the camera is (a fight's shot,
   * the player's view). Returns the shot, or null when none may be taken.
   */
  private promotionArrival(event: MoveEvent): DuelCameraTimeline | null {
    const square = squareToWorld(event.to);
    const frame = arrivalFrame(square, BOARD_TOP, undefined, PIECE_HEIGHT[(event.promotion ?? "q") as PieceKind]);
    const choice = this.promotionShot;
    this.promotionShot = null;
    if (choice && choice.revision === this.boardRevision && this.duelCamera?.timeline === choice.timeline && !choice.timeline.leaving) {
      // From the side the choice was watched from: the camera only comes in.
      choice.timeline.moveTo(this.riteDuelShot(frame, choice.timeline.home, 0, true, this.lensFov, undefined, undefined, 6, choice.facing), PROMOTION_TIMING.easeIn);
      this.promotionFacingNow = choice.facing;
      return choice.timeline;
    }
    const facing = clearestFacing(event.color, square, this.promotionObstacles([event.from, event.to]));
    this.promotionFacingNow = facing;
    return this.takePromotionCamera(frame, facing, PROMOTION_TIMING.easeIn, 6);
  }

  /**
   * Waits for a capture's claim to be done with the camera before the promotion takes it: the claim's shot watching the
   * sorcerer take the body, or the fight's shot kept for that claim to take over. Never longer than a claim runs.
   */
  private async untilClaimLetsGo(revision: number): Promise<void> {
    const holding = () => this.claimShotOwed !== null || (this.duelCamera?.rite === true && !this.duelCamera.timeline.leaving);
    for (let waited = 0; waited < 6 && holding() && !this.isStale(revision); waited += 0.05) {
      await this.tweens.to({ duration: 0.05, easing: Ease.linear, onUpdate: () => undefined });
    }
  }

  /**
   * The Pawn on the far rank becomes what was chosen (promotion/promotionPlan.ts has the beats and the forms). The move
   * is already made: this only shows it, and a rebuilt board (Undo, a new game, a seek) stops it where it is, the
   * board as the game has it. The Pawn and the new figure ride in `motion` until the landing, so a rebuild frees both.
   */
  private async runPromotion(event: MoveEvent, pawn: PieceView, revision: number, arrival: DuelCameraTimeline | null): Promise<void> {
    const plan = this.promotionPlanFor(event);
    const kind = (event.promotion ?? "q") as PieceKind;
    this.showTrace("promotion", { mode: plan.mode, reason: plan.reason, kingdom: plan.look.kingdom, rank: kind, camera: plan.camera, total: plan.total });
    if (plan.mode === "plain") { this.releasePromotionShot(); await this.plainPromotion(event, pawn, revision); return; }
    const to = squareToWorld(event.to);
    const settings = QUALITY_SETTINGS[this.preset];
    const view = this.factory.create(kind, event.color, {
      contactShadows: settings.contactShadows,
      idleAnimation: settings.idleAnimations,
      rankBadge: this.rankBadges,
      dynamicMotion: !this.menuPresentation && !this.reducedMotion,
    });
    view.container.position.copy(to);
    view.setBadgeEnabled(false);
    this.scene.add(view.container);
    this.pieces.delete(event.to);
    this.motion.add(pawn);
    this.motion.add(view);
    pawn.clearBoardReaction();
    // From here to its end a press may ask it to hurry, as a quiet move's walk (hurryMove).
    this.quietStage = true;
    const pan = this.stereoPan(to);
    let landed = false, pawnGone = false, released = false;
    const land = () => {
      if (landed) return;
      landed = true;
      this.motion.delete(view);
      this.pieces.set(event.to, view);
      view.container.position.copy(to);
      view.container.scale.setScalar(1);
      view.setAirborne(false);
      view.setBadgeEnabled(this.rankBadges);
    };
    const unmakePawn = () => {
      if (pawnGone) return;
      pawnGone = true;
      this.motion.delete(pawn);
      pawn.dispose();
    };

    if (plan.mode === "calm") {
      // Reduced motion: a crossfade on the square. Nothing rises, nothing flies, the camera stays.
      this.releasePromotionShot();
      view.setOpacity(0);
      let clock = -1;
      await this.tweens.to({
        duration: plan.total, easing: Ease.linear,
        onUpdate: (value) => {
          if (this.isStale(revision)) return;
          const t = value * plan.total;
          for (const cue of cuesBetween(plan, clock, t)) {
            if (cue === "promote") audio.promote(pan);
            else if (cue === "land") { land(); this.landOn(view, event.to, plan.weight); }
            else if (cue === "speak") this.voices.promoted(event);
          }
          clock = t;
          if (!pawnGone) pawn.setOpacity(1 - pawnUnmade(plan, t));
          view.setOpacity(figureFormed(plan, t));
        },
      });
      if (this.isStale(revision)) return;
      unmakePawn();
      land();
      view.setOpacity(1);
      return;
    }

    // The full form, or the brief one: the column, the Pawn lifted and unmade, the figure formed and dropped.
    let camera = arrival;
    if (!camera && plan.camera) {
      // After a fight: its claim has the camera first.
      await this.untilClaimLetsGo(revision);
      if (this.isStale(revision)) return;
      camera = this.promotionArrival(event);
      // The camera comes in on the square before the light stands up in its way.
      if (camera) await this.tweens.to({ duration: PROMOTION_TIMING.comeIn, easing: Ease.linear, onUpdate: () => undefined });
      if (this.isStale(revision)) return;
    } else if (!plan.camera) this.releasePromotionShot();
    const look = plan.look;
    const height = PIECE_HEIGHT[kind];
    pawn.setTravelling(true);
    pawn.setDissolveEmber(look.burn, look.burnGain);
    view.setDissolveEmber(look.burn, look.burnGain);
    view.setFormation(0);
    view.setAirborne(true);
    view.container.visible = false;
    // It forms facing the camera that watches it come (or the promoting player's side), and turns to the enemy as it lands.
    const faced = camera ? this.promotionFacingNow : null;
    if (faced) view.setFacing(new THREE.Vector3(faced.x, 0, faced.z), false);
    view.container.position.y = BOARD_TOP + plan.lift;
    const dice = this.showDice(`promotion ${event.to}`);
    const landing = plan.column ? new MysticLanding({
      budget: BEAM_BUDGET[plan.particles.budget], look: { core: look.core, glow: look.glow, ember: look.ember },
      radius: 1.05, height: 4.4, seed: Math.floor(dice() * 0x7fffffff),
    }) : null;
    if (landing) {
      landing.setCentre({ x: to.x, y: BOARD_TOP, z: to.z });
      landing.setSigil(0, 0); landing.setShaft(0); landing.setRise(0); landing.setBurst(-1);
      landing.setGain(vfxGlow(this.displayExposure()));
      this.scene.add(landing.object);
    }
    const light = plan.light ? this.spellLights.acquire(look.glow, 4.5) : null;
    this.endPromotionStage();
    if (landing) this.promotionStage = { landing, light };
    else light?.release();
    if (plan.sigil) {
      this.promotionForm.begin(this.factory.getSkins());
      this.promotionForm.showParticles(plan.motes);
    }
    const lightAt = new THREE.Vector3(to.x, BOARD_TOP + plan.lift + 0.7, to.z);
    const centre = new THREE.Vector3();
    let clock = -1;
    const step = (t: number) => {
      if (this.isStale(revision)) return;
      for (const cue of cuesBetween(plan, clock, t)) {
        if (cue === "promote") audio.promote(pan);
        else if (cue === "charge") { if (!this.silentBoard()) audio.spellCharge({ pan, volume: 0.5, duration: plan.form.to - plan.ignite.from }); }
        else if (cue === "stand") {
          // Whole in the light: a flare off it, and its kingdom's embers thrown from it.
          centre.set(to.x, BOARD_TOP + plan.lift + height * 0.55, to.z);
          this.effects.spawnFlash(centre, plan.mode === "full" ? 1.6 : 0.9, 0.3);
          if (plan.particles.stand > 0) this.effects.spawnBurst(centre, look.ember, plan.particles.stand, { speed: 1.4, life: 0.7, gravity: 0.6, radius: 0.25, size: 0.07, drag: 1.4 });
        } else if (cue === "land") {
          land();
          if (faced) void view.turnHome(this.tweens, 0.5);
          // The weight of it: the stone takes it, the dust goes up, the light is thrown out over the board as a ring.
          this.landOn(view, event.to, plan.weight);
          this.shake.add(plan.shake);
          centre.set(to.x, BOARD_TOP + 0.12, to.z);
          if (plan.particles.landing > 0) this.effects.spawnBurst(centre, look.ember, plan.particles.landing, { speed: 1.9, life: 0.65, gravity: 2.2, radius: 0.32, size: 0.08, rise: 0.4, drag: 1.1 });
          if (!this.silentBoard()) audio.conquest({ pan, weight: 0.55, volume: 0.75 });
          // The witnesses: the other army turns to what has come among them, warily; its own look.
          this.dispatchBoardReaction({ id: `promoted:${revision}:${this.controller.getSnapshot().fen}`, type: "move-started", point: to, focus: to,
            primary: [view.container.uuid], meaning: { feared: true, side: event.color } });
        } else if (cue === "speak") this.voices.promoted(event);
      }
      clock = t;
      const power = columnPower(plan, t);
      if (landing) {
        landing.setShaft(power * 1.7);
        landing.setSigil(0, power * 0.9);
        landing.setRise(plan.mode === "full" ? power : power * 0.4);
        landing.setBurst(landed ? t - plan.landAt : -1);
      }
      light?.set(lightAt, power * 6 * this.spellGlow());
      if (!pawnGone) {
        const lift = pawnLift(plan, t);
        pawn.container.position.y = BOARD_TOP + lift;
        if (lift > 0.005) pawn.setAirborne(true);
        const unmade = pawnUnmade(plan, t);
        pawn.setDissolve(unmade);
        if (unmade >= 1) unmakePawn();
      }
      const formed = figureFormed(plan, t);
      if (formed > 0) view.container.visible = true;
      view.setFormation(formed);
      if (!landed) view.container.position.y = BOARD_TOP + figureLift(plan, t);
      const squash = landingSquash(plan, t);
      view.container.scale.set(1 + 0.05 * squash, 1 - 0.07 * squash, 1 + 0.05 * squash);
      if (plan.sigil) {
        this.promotionForm.track(event.to, event.color, to.x, to.z, height, formed, t, plan.lift);
        this.promotionForm.update(t);
      }
      // Home again a little before the move lets go: in a game for two, round to the side of the one who moves next.
      if (camera && !released && t >= plan.release) {
        released = true;
        if (this.duelCamera?.timeline === camera) this.releaseDuelCamera();
      }
    };
    try {
      await this.tweens.to({ duration: plan.total, easing: Ease.linear, onUpdate: (value) => step(value * plan.total) });
    } finally {
      // A rebuilt board (or a newer promotion) has already taken down whatever stage is no longer this one's.
      if (landing && this.promotionStage?.landing === landing) this.endPromotionStage();
      else if (!landing) light?.release();
    }
    if (this.isStale(revision)) return;
    unmakePawn();
    land();
    view.setFormation(1);
    view.setDissolveEmber(null);
    view.container.visible = true;
    if (camera && !released && this.duelCamera?.timeline === camera) this.releaseDuelCamera();
  }

  /** The old swap, for the menu's board, a replay and the tactical map: the Pawn goes, the new figure fades in where it stood. */
  private async plainPromotion(event: MoveEvent, piece: PieceView, revision: number): Promise<void> {
    const to = squareToWorld(event.to);
    piece.dispose();
    this.pieces.delete(event.to);
    const view = this.factory.create((event.promotion ?? "q") as PieceKind, event.color, {
      contactShadows: QUALITY_SETTINGS[this.preset].contactShadows,
      idleAnimation: QUALITY_SETTINGS[this.preset].idleAnimations,
      rankBadge: this.rankBadges,
      dynamicMotion: !this.menuPresentation && !this.reducedMotion,
    });
    if (this.tactical) view.setFlat(true);
    view.container.position.copy(to);
    view.container.scale.setScalar(0.94);
    view.setOpacity(0.2);
    this.scene.add(view.container);
    this.pieces.set(event.to, view);
    audio.promote(this.stereoPan(to));
    this.voices.promoted(event);
    this.effects.spawnBurst(to.clone().setY(0.4), FACTION_ACCENT[event.color], 40, { speed: 2.6, life: 0.8 });
    this.effects.spawnFlash(to.clone().setY(0.6), 2.4, 0.4);
    await this.tweens.to({
      duration: this.reducedMotion ? 0.14 : 0.44,
      easing: Ease.outCubic,
      onUpdate: (t) => {
        view.container.scale.setScalar(0.94 + t * 0.06);
        view.setOpacity(0.2 + t * 0.8);
      },
    });
    if (this.isStale(revision)) return;
    view.container.scale.setScalar(1);
    this.landOn(view, event.to, 1.3);
  }

  /** Takes down what a promotion has standing in the scene: its column, its borrowed light, its forming figure's sigil. */
  private endPromotionStage(): void {
    const stage = this.promotionStage;
    this.promotionStage = null;
    stage?.landing.dispose();
    stage?.light?.release();
    this.promotionForm?.clear();
  }

  // -------------------------------------------------------------- interaction

  private bindEvents(): void {
    this.controls.addEventListener("start", this.onManualCamera);
    this.controls.addEventListener("change", this.onManualCameraChange);
    this.controls.addEventListener("end", this.onManualCameraEnd);
    this.canvas.addEventListener("pointermove", this.onPointerMove);
    // Ahead of the camera controls' own listener on the canvas: a press that picks a piece up is the board's alone.
    this.canvas.addEventListener("pointerdown", this.onPointerDown, { capture: true });
    window.addEventListener("pointerup", this.onPointerUp);
    window.addEventListener("pointercancel", this.onPointerUp);
    this.canvas.addEventListener("contextmenu", this.onContextMenu);
    window.addEventListener("resize", this.handleResize);
    this.canvas.addEventListener("webglcontextlost", this.onContextLost);
    this.canvas.addEventListener("webglcontextrestored", this.onContextRestored);
  }

  private updatePointer(event: PointerEvent): void {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.pointer, this.camera);
  }

  /**
   * Resolves what the pointer is over.
   *
   * Figures are life-size humans, so a sculpt covers the squares *behind* it on
   * screen. Testing the tiles alone therefore hands back the wrong square as
   * soon as the player clicks a figure's body — the click silently lands two
   * ranks further up the board. Every figure carries an invisible collider, far
   * wider than the figure, and the ray is tested against those as well as the tiles.
   *
   * Which of them the press is meant for is decided in boardPick.ts: the figure
   * the pointer is really on, a lit destination seen past a collider, and only
   * then the collider nearest the camera.
   */
  private pickTarget(exclude?: PieceView | null): { square: SquareId | null; piece: PieceView | null } {
    const colliders: THREE.Mesh[] = [];
    for (const piece of this.pieces.values()) {
      if (piece === exclude) continue;
      colliders.push(...piece.hitMeshes);
    }
    const tileHit = this.raycaster.intersectObjects(this.board.tiles, false)[0] ?? null;
    const figures: FigureHit[] = [];
    for (const hit of this.raycaster.intersectObjects(colliders, false)) {
      if (tileHit && hit.distance > tileHit.distance) break;
      const piece = (hit.object.userData.piece as PieceView | undefined) ?? null;
      const square = piece ? this.squareOf(piece) : null;
      if (!piece || !square || figures.some((figure) => figure.square === square)) continue;
      figures.push({ square, body: this.onFigure(piece) });
    }
    const tile = tileHit
      ? ((tileHit.object.userData.square as SquareId | undefined) ?? null)
      : this.squareUnderRay();

    const snapshot = this.controller.getSnapshot();
    const phase = this.inputPhase(snapshot);
    const mover = this.inputMover(snapshot);
    // While waiting, the squares the held piece may be told to go to are wanted as a selected piece's moves are.
    const reach = phase === "waiting" ? this.heldReach() : null;
    const wanted = (candidate: SquareId) => (phase === "open" ? this.destinationOf(candidate) !== null : reach !== null && reach.has(candidate));
    let square = resolvePick({
      figures,
      tile,
      wanted,
      own: (candidate) => phase !== "closed" && this.pieces.get(candidate)?.color === mover,
    });
    // The piece in hand is left out above so that it never hides a square it can go to (a Pawn stands right in
    // front of the square it promotes on). Anywhere else on it, the pointer is on the piece itself: a press there
    // lets it go, where it used to be answered by whatever stood behind its head.
    const inHand = this.selected ?? this.heldTap?.square ?? null;
    if (exclude && inHand && this.pieces.get(inHand) === exclude && !(square && wanted(square)) && this.onFigure(exclude)) {
      square = inHand;
    }
    return { square, piece: square ? (this.pieces.get(square) ?? null) : null };
  }

  /** The piece in hand, or the one held for when the board is free: left out of the pick so it hides no square of its own. */
  private get pieceAside(): PieceView | null {
    const square = this.selected ?? this.heldTap?.square ?? null;
    return square ? (this.pieces.get(square) ?? null) : null;
  }

  /** The pointer's ray passes through this figure itself (boardPick.ts), not only its collider. */
  private onFigure(piece: PieceView): boolean {
    return rayOnBody(this.raycaster.ray, piece.container.position, piece.kind);
  }

  /** Whether the board can be played now, will be when the move on stage is over, or cannot be (boardInput.ts). */
  private inputPhase(snapshot: GameSnapshot): InputPhase {
    if (!this.interactive || this.promotionGroup || snapshot.status !== "playing" || snapshot.paused) return "closed";
    if (snapshot.mode === "attract" || snapshot.mode === "demo") return "closed";
    return this.controller.isHumanTurn() ? "open" : "waiting";
  }

  /** The side whose pieces a player may pick up: the side to move, or against the computer always the player's. */
  private inputMover(snapshot: GameSnapshot): Faction {
    return snapshot.mode === "hotseat" ? snapshot.turn : snapshot.playerColor;
  }

  /** What a press on a square means now (boardInput.ts), with the board's own facts filled in. */
  private readTap(square: SquareId | null): TapAction {
    const snapshot = this.controller.getSnapshot();
    const phase = this.inputPhase(snapshot);
    const mover = this.inputMover(snapshot);
    // A press on the Pawn a capture in passing takes is a press on the square its captor lands on.
    if (square && phase === "open") square = this.destinationOf(square) ?? square;
    const piece = square ? (this.pieces.get(square) ?? null) : null;
    // The other side's move is being shown: the position the mover plays from is on the board, and what is legal
    // in it is known (not so while the computer thinks, or while the player's own move is on stage).
    const sure = phase === "waiting" && snapshot.turn === mover;
    return tapAction({
      phase,
      mover,
      square,
      piece: piece?.color ?? null,
      selected: this.selected,
      legal: square !== null && this.legalTargets.has(square),
      moves: square && (phase === "open" || sure) && piece?.color === mover ? this.controller.legalTargets(square).length : 0,
      held: this.heldTap?.square ?? null,
      queued: this.heldTap?.to ?? null,
      reach: phase === "waiting" && square !== null && this.heldReach().has(square),
      sure,
    });
  }

  /**
   * Where the held piece may be told to go. Once the position it will be played from is on the board (the other
   * side's move is being shown) these are its legal moves; before that (the computer is thinking, the player's own
   * move is on stage) they are every square a piece of its kind could reach (boardInput.ts, premoveReach), and
   * whether the move is legal is settled when the board is free.
   */
  private heldReach(): ReadonlySet<SquareId> {
    const held = this.heldTap;
    if (!held) return NO_SQUARES;
    const snapshot = this.controller.getSnapshot();
    const key = `${snapshot.fen} ${held.square}`;
    if (this.heldReachCache?.key !== key) {
      const squares = snapshot.turn === this.inputMover(snapshot)
        ? this.controller.legalTargets(held.square).map((target) => target.to)
        : premoveReach(held.piece.kind, held.piece.color, held.square);
      this.heldReachCache = { key, squares: new Set(squares) };
    }
    return this.heldReachCache.squares;
  }

  /** Carries a press out, and hands it back for whoever has to say what was done (the keyboard's announcements). */
  private performTap(action: TapAction): TapAction {
    switch (action.type) {
      case "select": {
        const piece = this.pieces.get(action.square);
        if (piece) this.selectWithTap(action.square, piece);
        break;
      }
      case "move":
        void this.commitMove(action.from, action.to);
        break;
      case "deselect":
        this.clearSelection();
        break;
      case "reject":
        void this.rejectMove(action.from);
        // While waiting it is the held piece that refuses: the squares' own markers belong to the move on stage.
        if (this.heldTap) this.dropHeldTap();
        else this.clearSelection();
        this.recallCheck();
        break;
      case "stuck":
        void this.rejectMove(action.square);
        this.recallCheck();
        break;
      case "hold":
        this.holdTap(action.square);
        break;
      case "queue":
        this.queueMove(action.to);
        break;
      case "release":
        this.dropHeldTap();
        break;
      case "hurry":
        this.hurryMove();
        break;
      case "none":
        break;
    }
    return action;
  }

  /** A refused press while the King stands in check says why: the King's marker catches the eye again. */
  private recallCheck(): void {
    const threatened = this.threatenedKing(this.controller.getSnapshot());
    if (threatened) this.board.flare(threatened.square);
  }

  /** Pressed while a move was on stage: the figure answers at once, as under the pointer, and waits. */
  private holdTap(square: SquareId): void {
    this.dropHeldTap();
    const piece = this.pieces.get(square);
    if (!piece) return;
    this.heldTap = { square, piece, to: null };
    piece.setHovered(true);
    // Its square is framed in dashes: it waits, and may be told where to go (queueMove).
    this.board.setQueued(square);
    this.callbacks.onMoveQueued?.({ from: square, to: null });
    audio.woodTap({ pan: this.stereoPan(piece.container.position), weight: WOOD_WEIGHT[piece.kind], volume: 0.5, lift: true });
  }

  /**
   * The held piece is told where to go: with it a whole move is queued, and both its squares are marked. It is
   * played by {@link releaseHeldTap} when the board is free, through the same door as a move made then
   * (commitMove), so a Pawn that reaches the last rank still asks what it is to become.
   */
  private queueMove(to: SquareId): void {
    const held = this.heldTap;
    if (!held) return;
    held.to = to;
    this.board.setQueued(held.square, to);
    this.callbacks.onMoveQueued?.({ from: held.square, to });
    // The tick of a piece set down, quietly, where it is to go.
    audio.woodTap({ pan: this.stereoPan(squareToWorld(to)), weight: WOOD_WEIGHT[held.piece.kind], volume: 0.5 });
  }

  private dropHeldTap(ended: QueuedEnd = "let-go"): void {
    const held = this.heldTap;
    if (!held) return;
    this.heldTap = null;
    this.heldReachCache = null;
    this.board.setQueued(null);
    this.callbacks.onMoveQueued?.(null, ended);
    if (held.piece !== this.hoveredPiece) held.piece.setHovered(false);
  }

  /**
   * The move on stage has settled: a piece pressed meanwhile is picked up now, if its player may move. One that was
   * also told where to go is played, if that move is legal in the position now on the board; if it is not, or the
   * piece has been taken, it is refused as any move is. Returns whether a queued move was played.
   */
  private releaseHeldTap(): boolean {
    const held = this.heldTap;
    if (!held) return false;
    const snapshot = this.controller.getSnapshot();
    const phase = this.inputPhase(snapshot);
    const mover = this.inputMover(snapshot);
    // The figure itself, still on its square: one taken meanwhile is not on the board, whoever stands there now.
    const piece = this.pieces.get(held.square) === held.piece ? held.piece : null;
    const targets = phase === "open" && piece?.color === mover ? this.controller.legalTargets(held.square) : [];
    const to = held.to ?? null;
    const aim: QueuedAim = to === null ? "none" : targets.some((target) => target.to === to) ? "legal" : "illegal";
    const outcome = heldTapOutcome(phase, mover, piece?.color ?? null, targets.length, aim);
    if (outcome === "keep") return false;
    this.dropHeldTap(outcome === "play" ? "played" : outcome === "refuse" ? "refused" : "let-go");
    if (outcome === "select" && piece) this.selectWithTap(held.square, piece);
    else if (outcome === "play" && to) void this.commitMove(held.square, to);
    else if (outcome === "refuse") {
      // The piece itself refuses if it still stands; one that was taken is only heard.
      if (piece) void this.rejectMove(held.square);
      else audio.blip("deny");
      this.recallCheck();
    }
    return outcome === "play";
  }

  /**
   * A move has settled and the game has said what follows it. What was pressed meanwhile is acted on, and a player
   * who may now move, with nothing queued to play at once, hears that the board is theirs.
   */
  private boardSettled(event: MoveEvent): void {
    if (this.releaseHeldTap()) return;
    const snapshot = this.controller.getSnapshot();
    // A check has its own bell, and it is rung at this same moment.
    if (this.inputPhase(snapshot) === "open" && !event.isCheck && !this.silentBoard()) audio.turnCue(snapshot.turn);
  }

  /**
   * Asks the move on stage to get on with it: what is left of a quiet walk (a castling Rook's too) and of a duel's
   * turn to the next player plays out at WALK_HURRY times its pace, and where motion is reduced is cut. A fight is
   * not hurried from here: a directed one has its own Skip. Returns whether there was anything to hurry.
   */
  hurryMove(): boolean {
    if (!this.quietStage || this.walkHurry > 1 || this.combatHurry > 1 || this.held) return false;
    this.walkHurry = WALK_HURRY;
    return true;
  }

  private squareUnderRay(): SquareId | null {
    const point = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(this.boardPlane, point)) return null;
    return worldToSquare(point.x, point.z);
  }

  private squareOf(piece: PieceView): SquareId | null {
    for (const [square, view] of this.pieces) {
      if (view === piece) return square;
    }
    return null;
  }

  private onPointerMove = (event: PointerEvent): void => {
    if (!this.interactive) return;
    this.updatePointer(event);

    if (this.promotionGroup) {
      this.board.setHover(null);
      // Over a candidate: it takes the focus.
      const kind = this.promotionUnderPointer();
      if (kind) this.focusPromotion(kind);
      this.canvas.style.cursor = kind ? "pointer" : "default";
      return;
    }

    // Once a figure is selected (or held for when the board is free), ignore its
    // tall collider while aiming at a destination. Otherwise a pawn can physically
    // cover the promotion square behind it in a low camera view, making the legal
    // tile impossible to tap.
    const { square: hoveredSquare, piece } = this.pickTarget(this.pieceAside);
    const snapshot = this.controller.getSnapshot();
    // A figure answers the pointer while a move is still on stage too: it can be pressed then (see holdTap).
    const canTouch = piece !== null && this.inputPhase(snapshot) !== "closed" && piece.color === this.inputMover(snapshot);

    if (this.hoveredPiece && this.hoveredPiece !== piece) {
      // A held figure keeps its answer when the pointer leaves it.
      if (this.hoveredPiece !== this.heldTap?.piece) this.hoveredPiece.setHovered(false);
      this.hoveredPiece = null;
    }
    if (canTouch && piece) {
      if (this.hoveredPiece !== piece) audio.blip("hover");
      piece.setHovered(true);
      this.hoveredPiece = piece;
    }

    this.board.setHover(hoveredSquare);
    // The keys go on from where the pointer is.
    if (hoveredSquare) this.cursorSquare = hoveredSquare;
    this.cursorByKeys = false;
    const drag = this.drag;
    if (drag && !drag.moving && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) > this.limits.tapSlop) drag.moving = true;
    this.canvas.style.cursor = drag?.moving
      ? "grabbing"
      : canTouch || (hoveredSquare !== null && (this.selected ? this.destinationOf(hoveredSquare) !== null : this.heldReach().has(hoveredSquare)))
        ? "pointer"
        : "default";
  };

  private onPointerDown = (event: PointerEvent): void => {
    if (!this.interactive || event.button !== 0) return;
    this.updatePointer(event);

    if (this.promotionGroup) {
      const kind = this.promotionUnderPointer();
      if (kind && this.promotionResolve) {
        audio.blip("press");
        this.promotionResolve(kind);
      }
      return;
    }

    const aside = this.pieceAside;
    const { square } = this.pickTarget(aside);

    // A mouse or a pen picks a piece up as it is pressed, and may carry the press on to the piece's destination
    // (press, drag, let go). So may a press on the piece already in hand. That press is the board's: the camera
    // controls never hear of it, so the view holds still under the drag. A finger plays by tapping as before, so a
    // swipe that begins on a figure still turns the camera. While the board is busy it is the same with the piece
    // held for when it is free: pressed, it may be carried to where it is to go.
    const mouse = event.pointerType !== "touch";
    const action = mouse ? this.readTap(square) : null;
    const carried = this.selected ?? this.heldTap?.square ?? null;
    const inHand = mouse && aside !== null && carried !== null && this.inputPhase(this.controller.getSnapshot()) !== "closed" && this.onFigure(aside);
    if (inHand || action?.type === "select" || action?.type === "hold") {
      event.stopImmediatePropagation();
      // The page's own listener, which wakes the sound on a first press, does not hear this press either.
      void audio.unlock();
      // Picked up now, on the press. A press on the piece already in hand waits to see what it becomes: carried,
      // it is a drag; let go where it was made, it is the click it always was (see onPointerUp).
      if (inHand) this.pointerDownAt = { x: event.clientX, y: event.clientY, square };
      else {
        this.pointerDownAt = null;
        this.performTap(action!);
      }
      const from = this.selected ?? this.heldTap?.square ?? null;
      if (from) this.drag = { from, x: event.clientX, y: event.clientY, moving: false };
      // The drag is followed off the canvas, over the HUD.
      try { this.canvas.setPointerCapture(event.pointerId); } catch { /* a pointer that is already gone */ }
      return;
    }

    // Every other press only records where it was made: it is acted on when it is released, so a press that
    // turns into a camera orbit can be discarded.
    this.pointerDownAt = { x: event.clientX, y: event.clientY, square };
  };

  private onPointerUp = (event: PointerEvent): void => {
    const drag = this.drag;
    const down = this.pointerDownAt;
    this.drag = null;
    this.pointerDownAt = null;
    if (!this.interactive || event.type === "pointercancel") return;

    if (drag) {
      this.canvas.style.cursor = "pointer";
      if (drag.moving) {
        // Carried to a square it can go to, the piece is played there; let go anywhere else it stays in hand.
        // Over the HUD (the drag is followed there) the press is not on the board at all.
        const held = this.heldTap?.square === drag.from;
        if ((this.selected !== drag.from && !held) || this.canvas.ownerDocument.elementFromPoint(event.clientX, event.clientY) !== this.canvas) return;
        this.updatePointer(event);
        const { square } = this.pickTarget(this.pieces.get(drag.from) ?? null);
        // A held piece carried while the board is busy is told where to go, and waits there as it would after two presses.
        if (held) { if (square && square !== drag.from && this.heldReach().has(square) && this.inputPhase(this.controller.getSnapshot()) === "waiting") this.queueMove(square); }
        else {
          const to = this.destinationOf(square);
          if (to && this.controller.isHumanTurn()) void this.commitMove(drag.from, to);
        }
        return;
      }
      // Never carried: a click. One that picked the piece up has done all it does; one on the piece already in
      // hand is read below, like any other.
      if (!down) return;
    } else {
      if (!down) return;
      // A press that travelled was the camera being swung around, not a tap on a
      // square, so it must never move a figure or change the selection. A finger
      // is allowed more slop than a mouse — a tap on glass always drifts a little.
      if (Math.hypot(event.clientX - down.x, event.clientY - down.y) > this.limits.tapSlop) return;
    }

    this.updatePointer(event);
    this.performTap(this.readTap(this.pickTarget(this.pieceAside).square));
  };

  /** The mouse's other button lets go of the piece in hand (or the one held, and the move queued for it), as Escape does. */
  private onContextMenu = (event: MouseEvent): void => {
    event.preventDefault();
    if (!this.interactive) return;
    // Over the promotion picker it backs out of the promotion.
    if (this.promotionResolve) this.cancelPromotion();
    else if (this.pieceInHand) this.cancelKeyboardSelection();
  };

  /** Selecting by tap: the figure stands to attention with a dry wooden tick. */
  private selectWithTap(square: SquareId, piece: PieceView): void {
    this.select(square);
    // A living figure is taken by the unseen hand; the menu's board keeps its wooden tick.
    if (!this.voices.lift(piece)) audio.woodTap({
      pan: this.stereoPan(piece.container.position),
      weight: WOOD_WEIGHT[piece.kind],
      volume: 0.8,
      lift: true,
    });
    // It is a person, not a carving: sometimes it draws breath as it is chosen.
    if (!this.silentBoard()) audio.breath(this.stereoPan(piece.container.position));
  }

  private async commitMove(from: SquareId, to: SquareId): Promise<void> {
    let promotion: PieceKind | undefined;
    if (this.controller.isPromotion(from, to)) {
      const color = this.controller.getSnapshot().turn;
      this.clearSelection();
      // The choice is staged over the far square first (its close shot, the picker's place over it).
      this.stagePromotionChoice(from, to, color);
      const answer = await this.requestPromotion(color);
      // Backed out of: nothing is played, and the Pawn is in hand again. The game moved on under the picker (it
      // ended, was taken back or begun again): nothing is played, and nothing is picked up on the new board.
      if (answer === "gone") { this.promotionShot = null; return; }
      if (answer === "back") {
        // The close shot goes home with it.
        this.releasePromotionShot();
        if (this.controller.isHumanTurn() && this.pieces.get(from)?.color === color) this.select(from);
        return;
      }
      promotion = answer;
    }
    const ok = await this.controller.tryMove(from, to, promotion);
    // The move's own sequence carries the picker's shot on and lets it go; one still holding here was never taken up.
    if (promotion) this.releasePromotionShot();
    if (!ok) void this.rejectMove(from);
  }

  private select(square: SquareId): void {
    this.previewing = false;
    this.clearSelection();
    const piece = this.pieces.get(square);
    if (!piece) return;
    this.selected = square;
    piece.setSelected(true);
    this.board.setHighlight(square, "select");

    // Legal squares ripple outward from the piece so the fan of options reads
    // as one motion instead of 20 markers blinking on at once.
    const origin = squareToWorld(square);
    const targets = this.controller.legalTargets(square).map((target) => ({
      ...target,
      distance: squareToWorld(target.to).distanceTo(origin),
    }));
    targets.sort((a, b) => a.distance - b.distance);
    for (const target of targets) {
      this.legalTargets.set(target.to, target.capture);
      const delay = Math.min(target.distance * 0.02, 0.14);
      // Colour-coded by move type: red for captures, violet for promotions,
      // azure for castling, emerald for a quiet advance.
      const kind: HighlightKind = target.capture
        ? "capture"
        : target.promotion
          ? "promote"
          : target.castle
            ? "castle"
            : "move";
      this.board.setHighlight(target.to, kind, target.capture || target.promotion, delay);
      // A capture in passing takes a Pawn that does not stand where its captor lands. That Pawn is marked too,
      // with a mark of its own, and a press on it is the capture (destinationOf): it is the piece being taken.
      if (target.enPassant) {
        this.passingVictims.set(target.enPassant, target.to);
        this.board.setHighlight(target.enPassant, "enpassant", true, delay);
      }
    }

    // Everything the piece cannot reach falls into shadow so the lit squares
    // are unmistakable even when several of them share a colour.
    this.board.setShroud([square, ...targets.map((target) => target.to), ...this.passingVictims.keys()], square);
    if (targets.length > 0) audio.blip("hover");
  }

  private clearSelection(): void {
    if (this.selected) {
      const piece = this.pieces.get(this.selected);
      piece?.setSelected(false);
    }
    this.selected = null;
    this.legalTargets.clear();
    this.passingVictims.clear();
    this.previewing = false;
    this.board.setShroud(null);
    this.restoreBaseHighlights();
  }

  /**
   * The square a press on `square` sends the piece in hand to: the square itself if the piece may go there, the
   * square it lands on if a Pawn taken in passing stands on `square`, else null.
   */
  private destinationOf(square: SquareId | null): SquareId | null {
    if (!square) return null;
    return this.legalTargets.has(square) ? square : (this.passingVictims.get(square) ?? null);
  }

  /** Re-lights the ambient markers (last move, check) after a transient state. */
  private restoreBaseHighlights(): void {
    this.board.clearHighlights();
    const snapshot = this.controller.getSnapshot();
    if (snapshot.lastMove) {
      this.board.setHighlight(snapshot.lastMove.from, "last");
      this.board.setHighlight(snapshot.lastMove.to, "last");
    }
    this.applyCheckHighlight(snapshot);
  }

  /**
   * Lights the two squares of a move picked from the move ledger. Ignored while
   * a piece is selected so it never fights the legal-move markers.
   */
  previewMove(move: { from: SquareId; to: SquareId } | null): void {
    if (this.selected) return;
    if (!move) {
      if (!this.previewing) return;
      this.previewing = false;
      this.restoreBaseHighlights();
      return;
    }
    this.board.clearHighlights();
    this.board.setHighlight(move.from, "hint", true);
    this.board.setHighlight(move.to, "hint", true);
    this.previewing = true;
  }

  private applyCheckHighlight(snapshot: GameSnapshot): void {
    for (const piece of this.pieces.values()) piece.setAlarm(0);
    const threatened = this.threatenedKing(snapshot);
    // The alarm is driven off the *state*, not off the move that caused it, so it
    // is also right after an undo, a rebuild or a mid-game graphics change — and
    // it always stands down when the king walks out of check.
    this.alarm.setThreat(threatened ? squareToWorld(threatened.square) : null);
    if (!threatened) return;
    threatened.piece.setAlarm(1);
    this.board.setHighlight(threatened.square, "check", true);
  }

  /** The king currently in check, if the game is still being played. */
  private threatenedKing(snapshot: GameSnapshot): { square: SquareId; piece: PieceView } | null {
    if (!snapshot.inCheck || snapshot.status !== "playing") return null;
    for (const [square, piece] of this.pieces) {
      if (piece.kind === "k" && piece.color === snapshot.turn) return { square, piece };
    }
    return null;
  }

  private dispatchBoardReaction(event: BoardReactionEvent): void {
    if (this.reducedMotion || this.tactical || this.menuPresentation) return;
    const roster: BoardObserver[] = [];
    const views = new Map<string, PieceView>();
    for (const [square, piece] of this.pieces) {
      if (piece.isSlain) continue;
      views.set(piece.container.uuid, piece);
      roster.push({ id: piece.container.uuid, square, kind: piece.kind, color: piece.color, point: piece.container.position, facing: HOME_FACING[piece.color] });
    }
    // [battle memory] What the moment means to each witness: a companion, a stranger, the King's guard.
    const meaning = event.meaning ?? this.battleBonds.meaning(event.type, this.controller.getSnapshot(), roster);
    const plan = this.boardReactions.plan(meaning ? { ...event, meaning } : event, roster);
    for (const id of plan.release) views.get(id)?.clearBoardReaction();
    for (const reaction of plan.reactions) views.get(reaction.id)?.applyBoardReaction(reaction.cue);
    // A claim being watched turns to the one who grieves (the fall is told once the body is down, often under it).
    if (event.type === "ally-fallen" && this.claimWatch) { const head = this.mournerHead(); if (head) this.claimWatch.keep(head); }
  }

  private syncBoardReactions(snapshot: GameSnapshot): void {
    if (this.reducedMotion || this.tactical || this.menuPresentation || snapshot.busy) return;
    const key = `${this.boardRevision}:${snapshot.status}:${snapshot.fen}`;
    if (key === this.reactionStateKey) return;
    this.reactionStateKey = key;
    // [battle memory] The army's morale in every figure's carriage and breath; a figure just placed takes it at once.
    this.battleBonds.applyMoods(snapshot, this.pieces);
    const released = new Set(this.boardReactions.releaseRoyal());
    const mate = snapshot.status === "over" && snapshot.result?.reason === "checkmate";
    for (const piece of this.pieces.values()) {
      if (released.has(piece.container.uuid)) piece.clearBoardReaction();
      piece.setBattlefieldQuiet(mate);
    }
    if ((!snapshot.inCheck || snapshot.status !== "playing") && !mate) return;
    const threat = boardRoyalThreat(snapshot.fen, snapshot.moves);
    if (!threat) return;
    const king = this.pieces.get(threat.kingSquare), attacker = this.pieces.get(threat.attackers[0]);
    if (!king) return;
    this.dispatchBoardReaction({ id: `royal:${key}`, type: mate ? "checkmate" : "check", point: king.container.position,
      focus: attacker?.container.position, kingId: king.container.uuid, victimColor: king.color, checks: threat.checks });
  }

  private onState(snapshot: GameSnapshot): void {
    this.applyCheckHighlight(snapshot);
    this.syncBoardReactions(snapshot);
    this.momentCheck(snapshot);
    // [battle memory] Both armies' morale for the score, once each move has settled.
    if (!this.menuPresentation && !this.silentBoard()) this.battleBonds.publishMorale(snapshot);
    const intensity = snapshot.inCheck ? 1 : snapshot.captured.length >= 12 ? 0.6 : 0;
    audio.setIntensity(intensity);
    // The adaptive score hears every state the board publishes (web/src/audio/scorePlayer.ts).
    audio.matchState(snapshot);
  }

  // ------------------------------------------------------------ battle memory (battleBonds.ts)

  /** The avenger of a fallen ally, standing on the square it took, looks to where they fell; those who knew them answer. */
  private honourAvenger(): void {
    if (this.reducedMotion || this.tactical || this.menuPresentation) return;
    const snapshot = this.controller.getSnapshot();
    const moment = this.battleBonds.avenging(snapshot, [...this.pieces].map(([square, piece]) => ({ id: piece.container.uuid, square })));
    const avenger = moment ? this.pieces.get(moment.avenger) : undefined;
    if (!moment || !avenger) return;
    this.dispatchBoardReaction({ id: `avenged:${this.boardRevision}:${snapshot.fen}`, type: "avenged", point: squareToWorld(moment.fellAt),
      focus: avenger.container.position, victimColor: avenger.color, meaning: moment.meaning });
  }

  /** Each fall's meaning as its body comes down, and each vengeance: for the voices. Returns the unsubscribe. */
  onBattleEmotion(listener: (event: BattleEmotionEvent) => void): () => void { return this.battleBonds.onEmotion(listener); }

  /** Both armies' morale each time a move has settled (or an Undo or a new game changed it): for the score. Returns the unsubscribe. */
  onBattleMorale(listener: (morale: BattleMorale) => void): () => void { return this.battleBonds.onMorale(listener); }

  /** Both armies' morale as the board shows it now. */
  getBattleMorale(): BattleMorale { return this.battleBonds.morale(this.controller.getSnapshot()); }

  /** The bonds broken, the renowned and the avengers of the game so far: for the end-of-battle story. */
  getBattleStory(): BattleStory { return this.battleBonds.story(this.controller.getSnapshot()); }

  // ------------------------------------------------------------------ options

  /** The caller owns and disposes imported scenery. Board coordinates stay unchanged. */
  setBakedWorld(group: THREE.Group, violet: boolean): void {
    this.bakedWorld?.removeFromParent();
    this.bakedWorld = group;
    this.bakedViolet = violet;
    this.scene.add(group);
    this.dropWorld();
    this.camera.layers.enable(1);
    this.camera.far = 1600;
    this.camera.updateProjectionMatrix();
    this.renderer.toneMapping = THREE.AgXToneMapping;
    this.applyBakedAtmosphere();
    // Baked occlusion already exists; do not multiply another SSAO pass over it.
    this.postfx.setPreset(this.preset === "high" || this.preset === "ultra" ? "medium" : this.preset);
    this.postfx.setBloom({ strength: 0.3, radius: 0.45, threshold: 1.4 });
    this.postfx.setGrade({ strength: 0.3, grain: 0, vignette: 0.3, lift: 0 });
    this.cameraLamp.intensity = 0.8;
    this.applyEnvironment();
    this.applyExposure();
  }

  /**
   * Builds the procedural world (hall, siege, rainforest) and its reflection probe, once, unless a baked arena is
   * staged: called as the engine starts and by whatever shows the world before then (the menu presentation).
   */
  private stageWorld(): void {
    if (this.hall || this.bakedWorld || this.disposed) return;
    const look = ARENA_LOOKS[this.arena];
    this.hall = new CastleHall(this.preset, look);
    this.battlefield = new Battlefield(this.preset, look);
    this.jungle = new JungleOverlay(this.preset, look);
    this.scene.add(this.hall.group, this.battlefield.group, this.jungle.group);
    if (this.tactical) this.strikeWorld();
    if (!this.environmentMap) this.applyEnvironment();
  }

  /** A baked arena has arrived: the procedural world and its probe are freed, not kept hidden. */
  private dropWorld(): void {
    for (const world of [this.hall, this.battlefield, this.jungle]) {
      if (!world) continue;
      world.group.removeFromParent();
      world.dispose();
    }
    this.hall = this.battlefield = this.jungle = null;
    this.struck = [];
    this.environmentMap?.dispose();
    this.environmentMap = null;
  }

  /** The arena's own board in place of the procedural one; the board takes ownership. `null` restores the procedural board. */
  setBakedBoard(model: THREE.Object3D | null): void {
    this.board.setBakedBoard(model);
  }

  private applyBakedAtmosphere(): void {
    this.scene.background = new THREE.Color(this.bakedViolet ? 0x100c24 : 0x2b2622);
    this.scene.fog = new THREE.FogExp2(this.bakedViolet ? 0x211631 : 0x302624, 0.0018);
  }

  /**
   * Switches the map the board is staged in. Every subsystem repaints in place
   * — no geometry is rebuilt — so the change lands within a single frame even
   * mid-game, and only the reflection probe is regenerated.
   */
  setArena(theme: ArenaTheme): void {
    if (this.bakedWorld) return;
    if (theme === this.arena) return;
    this.arena = theme;
    const look = ARENA_LOOKS[theme];

    this.applyExposure(look.exposure * (this.campaignBattle ? 1.08 : 1));
    (this.scene.background as THREE.Color).setHex(look.background);
    const fog = this.scene.fog as THREE.FogExp2 | null;
    if (fog) {
      fog.color.setHex(look.fog.color);
      fog.density = look.fog.density;
    }

    this.hall?.applyArena(look);
    this.battlefield?.applyArena(look);
    this.jungle?.applyArena(look);
    this.board.applyArena(look);
    this.postfx.setGrade(look.grade);
    this.postfx.setBloom(look.bloom);

    this.cameraLamp.color.setHex(look.lamp.color);
    this.cameraLamp.intensity = look.lamp.intensity * (this.campaignBattle ? 1.5 : 1);

    // Re-stage the strike against the new dressing, then put the void back.
    if (this.tactical) {
      this.restoreWorld();
      this.strikeWorld();
      this.applyTacticalAtmosphere();
    }

    this.applyEnvironment();
    if (this.menuPresentation) this.setMenuPresentation(true, false);
  }

  /** The map currently staged. */
  getArena(): ArenaTheme {
    return this.arena;
  }

  setQuality(preset: QualityPreset): void {
    if (preset === this.preset) return;
    this.preset = preset;
    this.gore?.setQuality(preset);
    this.scorch?.setQuality(preset);
    // A fatality's fluid has the preset's budget (none on Low: the plain sprays stand in).
    this.fluid?.setCapacity(goreBudget(3, preset).fluid);
    this.deathPhysics?.setQuality(preset);
    // A preset on the other atlas size drops the loaded ones: fetch the new set now, not on the next capture.
    this.vfx?.setQuality(preset); this.preloadVfx();
    this.flourish?.setQuality(preset); this.vaultFx?.setQuality(preset);
    this.boardReactions.setQuality(preset); this.reactionStateKey = "";
    for (const piece of this.pieces.values()) piece.clearBoardReaction();
    this.syncBoardReactions(this.controller.getSnapshot());
    const settings = QUALITY_SETTINGS[preset];
    this.renderer.setPixelRatio(this.pixelRatio());
    this.renderer.shadowMap.enabled = settings.shadows && !this.safeMode;
    this.hall?.applyQuality(preset);
    this.battlefield?.applyQuality(preset);
    this.jungle?.applyQuality(preset);
    this.postfx.setPreset(this.bakedWorld && (preset === "high" || preset === "ultra") ? "medium" : preset);
    this.handleResize();
    // Rebuilding the figures mid-fight would tear down the ones that are
    // marching, striking or dying and cut their beat short, so an automatic
    // downgrade (which usually fires *because* a fight is on screen) waits for
    // the board to go quiet. The rebuild then runs from `animateMove`.
    if (this.movesInFlight > 0 || this.conclusion.active) this.rebuildPending = true;
    else this.rebuildPieces();
    if (this.tactical) {
      this.restoreWorld();
      this.strikeWorld();
    }
  }

  /**
   * Safe rendering. Drops the three things that have been seen to render an
   * all-black scene on Linux/Mesa drivers — the post-processing composer, the
   * reflection probe and the shadow maps — and lifts the exposure a touch to
   * make up for the lost ambient. Fully reversible.
   */
  setSafeMode(active: boolean): void {
    if (this.safeMode === active) return;
    this.safeMode = active;
    this.postfx.setBypassed(active);
    this.renderer.shadowMap.enabled = !active && QUALITY_SETTINGS[this.preset].shadows;
    // A probe that was never tested deserves another chance when safe mode is
    // switched off by hand; one that failed its self-test stays off.
    this.applyEnvironment();
    this.applyExposure();
    this.refreshMaterials();
  }

  isSafeMode(): boolean {
    return this.safeMode;
  }

  /** Player-side exposure multiplier (0.6–1.8) for screens that read too dark. */
  setBrightness(value: number): void {
    const clamped = Math.min(1.8, Math.max(0.6, value));
    if (Math.abs(clamped - this.brightness) < 0.001) return;
    this.brightness = clamped;
    this.battlefieldRenderer?.setBrightness(clamped * this.openingExposure);
    this.applyExposure();
  }

  /** The match opening's lift on the exposure, over the player's brightness (1 outside it). Both renderers take it as
   * a uniform, so changing it rebuilds nothing. */
  private setOpeningExposure(lift: number): void {
    if (Math.abs(lift - this.openingExposure) < 0.001) return;
    this.openingExposure = lift;
    this.battlefieldRenderer?.setBrightness(this.brightness * lift);
    this.applyExposure();
  }

  /** One line naming the driver, for the settings panel and bug reports. */
  getGpuSummary(): string {
    return describeGpu(this.gpu);
  }

  /**
   * Musters a different army on one or both sides. The sculpts have to be
   * re-downloaded, so the swap runs in the background: any beat in flight is
   * allowed to finish, every standing figure comes down (its geometry belongs to
   * a template about to be freed), the new rosters load, and the board is stood
   * back up. A request arriving during a swap replaces the pending one.
   */
  setArmySkins(skins: Record<Faction, ArmySkinId>): void {
    this.wantedSkins = { w: skins.w, b: skins.b };
    this.controller.setCombatArmies(skins);
    // Korvenia's powder army fires recorded barrels: start streaming them before the first volley.
    if (skins.w === "empire" || skins.b === "empire") audio.primeGunfire();
    // Each side speaks in its kingdom's voices: they come down now, before the first move.
    if (!this.silentBoard()) audio.setKingdoms(skins);
    void this.syncArmies();
  }

  /** The army each side is currently mustering. */
  getArmySkins(): Record<Faction, ArmySkinId> {
    return this.factory.getSkins();
  }

  private async syncArmies(): Promise<void> {
    if (this.swappingArmies) return;
    this.swappingArmies = true;
    try {
      while (!this.disposed) {
        const wanted = this.wantedSkins;
        this.wantedSkins = null;
        if (!wanted || !this.factory.setSkins(wanted)) break;

        // A figure caught mid-march would be holding a sculpt that is about to
        // be freed, so the fight on screen finishes first.
        while (this.movesInFlight > 0 && !this.disposed) await wait(0.1);
        if (this.disposed) return;

        // Stale first, so the rebuild only tears the old army down.
        this.factory.markStale();
        this.rebuildPieces();
        try {
          await this.factory.reload();
        } catch (error) {
          console.warn("[scene] could not muster the new army", error);
        }
        if (this.disposed) return;
        this.rebuildPieces();
        const skins = this.factory.getSkins();
        if (skins.w === "empire" || skins.b === "empire") audio.primeGunfire();
        void this.factory.warmClips();
      }
    } finally {
      this.swappingArmies = false;
    }
  }

  /** Rebuilds every figure from the chess core (used after undo). */
  resync(): void {
    this.rebuildPieces();
    const snapshot = this.controller.getSnapshot();
    if (snapshot.lastMove) {
      this.board.setHighlight(snapshot.lastMove.from, "last");
      this.board.setHighlight(snapshot.lastMove.to, "last");
    }
    this.applyCheckHighlight(snapshot);
  }

  /**
   * What a taken-back move leaves behind besides the figures: any plea still in
   * the air and, in a hotseat game, the side of the board the view stands on.
   * (Who has died is read from the history, so the first to die pleads again.)
   */
  private restoreAfterUndo(snapshot: ReturnType<GameController["getSnapshot"]>): void {
    this.livePlea?.cut();
    this.livePlea = null;
    if (!this.rotateBoard || this.tactical || snapshot.mode !== "hotseat" || snapshot.status !== "playing" || this.orbiting || this.introPlaying || this.conclusionViewActive) return;
    // White plays from +z, black from -z; "Flip board" swaps them.
    const wanted = (snapshot.turn === "w" ? 1 : -1) * (this.cameraFlipped ? -1 : 1);
    const side = this.camera.position.z - this.controls.target.z;
    if (Math.abs(side) > 1e-3 && Math.sign(side) !== wanted) void this.orbitBy(Math.PI, UNDO_SWING_SECONDS);
  }

  // ------------------------------------------------------------------ replays

  /** The ply (0-based move index) each victim was taken on: its claim and its plea are read against the history before it. */
  private readonly takenOn = new WeakMap<PieceView, number>();
  /** A replay transport's scale on the scene's time: 0 holds the scene still (pause), 2 plays it twice as fast. */
  private replayTimeScale = 1;
  /** Set for the rebuild a replay's seek asks for: figures standing still where they were are kept (rebuildPieces). */
  private keepStanding = false;
  /** Spoken lines, for browser checks comparing a live game with its replay (`__crownfallCombatTrace`). */
  private readonly releaseVoiceTrace = audio.onVoiceLine(event => { if (event.type === "line") this.showTrace("voice", { clip: event.clip }); });

  /**
   * A replay jumped to another ply (GameController.seekReplay): the board is put at that ply at once. Figures that did
   * not move stay standing as they are; the rest are put on their squares; the trays hold what had been taken by then
   * (rebuildPieces lays them from the history). Whatever was being performed stops, its plea, effects, spells, summon,
   * claim and fatality with it. The marks on the stone of later plies go, as an Undo takes them back (blood, fluid,
   * burns, bodies and limbs); those of the plies up to here stay as this viewing drew them. A fight this viewing
   * jumped over leaves none: no stain is invented for it (docs/PLAY_REPLAYS.md).
   */
  private seekReplayBoard(ply: number): void {
    this.livePlea?.cut();
    this.livePlea = null;
    this.voices.interrupt();
    this.gore?.undoTo(ply);
    this.fluid?.undoTo(ply);
    this.scorch?.undoTo(ply);
    this.deathPhysics?.undoTo(ply);
    const snapshot = this.controller.getSnapshot();
    this.taken = [];
    snapshot.moves.slice(0, ply).forEach((move, index) => {
      if (move.capture && move.captured) this.taken.push({ ply: index + 1, square: move.to, kind: move.captured, color: move.color === "w" ? "b" : "w" });
    });
    this.keepStanding = true;
    try { this.rebuildPieces(); } finally { this.keepStanding = false; }
    if (snapshot.lastMove) {
      this.board.setHighlight(snapshot.lastMove.from, "last");
      this.board.setHighlight(snapshot.lastMove.to, "last");
    }
    this.applyCheckHighlight(snapshot);
  }

  /** The figures standing idle on squares where `board` has the same piece: kept by a replay's seek, made whole, overlays released. */
  private standingFor(board: readonly { square: SquareId; kind: PieceKind; color: Faction }[]): Map<SquareId, PieceView> {
    const kept = new Map<SquareId, PieceView>();
    for (const entry of board) {
      const piece = this.pieces.get(entry.square);
      // A figure the downfall has posed (kneeling, its weapons on the stone, its light gone) is built again instead.
      if (!piece || piece.kind !== entry.kind || piece.color !== entry.color || piece.isSlain || piece.inDownfall) continue;
      this.finishReturn(piece);
      piece.clearBoardReaction();
      piece.clearCombatTargets();
      piece.setStrikeTilt(0);
      piece.container.position.copy(squareToWorld(entry.square));
      kept.set(entry.square, piece);
    }
    return kept;
  }

  /** The trays beside the board as the game's history has filled them: every piece taken so far, in the order it fell. */
  private layTrays(): void {
    if (this.menuPresentation || !this.factory.isReady) return;
    const settings = QUALITY_SETTINGS[this.preset];
    for (const { kind, color } of takenThrough(this.controller.getSnapshot().moves, Infinity)) {
      const view = this.factory.create(kind, color, {
        contactShadows: settings.contactShadows, idleAnimation: settings.idleAnimations, rankBadge: this.rankBadges, dynamicMotion: !this.reducedMotion,
      });
      if (this.tactical) view.setFlat(true);
      // As sendToTray leaves a fallen figure: standing again, small and a little faded, in its side's row.
      view.container.scale.setScalar(0.55);
      view.container.position.copy(this.trayPosition(color, this.captured.filter(entry => entry.color === color).length));
      view.setOpacity(0.95);
      this.scene.add(view.container);
      this.captured.push(view);
    }
  }

  /** The end of a replay as the live game showed it on gameover: the closing sound, and checkmate's framing. */
  playReplayEnding(): Promise<void> {
    return this.campaignBattle ? Promise.resolve() : this.playEndCinematic();
  }

  /**
   * The mixer's memory of the game as it stood at `ply`, for a replay opened or seeked there: a new game's state (the
   * board's voices awake again after an ending, nothing said yet), then one soul for each piece the history has taken,
   * so the hall of the fallen is as loud as it was. Makes no sound: a replay's transport calls it with the mix faded out.
   */
  restoreReplaySound(ply: number): void {
    if (this.silentBoard()) return;
    this.livePlea?.cut();
    this.livePlea = null;
    this.voices.interrupt();
    this.voiced("gambit", () => audio.beginGambit());
    for (let fallen = capturesBefore(this.controller.getSnapshot().moves, ply); fallen > 0; fallen -= 1) audio.soulRelease(0);
  }

  /** The bell and the whisper that opened the game, for a replay played from its first move. */
  ringReplayBell(): void {
    if (this.silentBoard()) return;
    this.voiced("gambit", () => audio.beginGambit());
    // ...and the murmurs its record kept, when they were said (BoardVoices in a replay).
    this.voices.gameBegins();
  }

  /** A replay's transport on the scene's time: 0 holds it still, 1 is as it was played, 2 twice as fast. Sound keeps its own clock. */
  setReplayTimeScale(scale: number): void {
    this.replayTimeScale = Number.isFinite(scale) ? Math.max(0, Math.min(8, scale)) : 1;
  }

  /** Every clip and authored combat library a replay's fights may ask for, fetched before it plays, within `seconds`. */
  async prepareReplay(seconds = 20): Promise<void> {
    const libraries = (["w", "b"] as const).flatMap(color => (["p", "n", "b", "r", "q", "k"] as const).map(kind => this.factory.ensureCombatLibrary(color, kind)));
    await Promise.race([Promise.all([this.warmAnimations(), ...libraries]), wait(seconds)]);
  }

  /**
   * Nothing of the last move is still going on: no figure mid-move or mid-death, no body being claimed, no shot on its
   * way home, no fatality or summon. The board as a player saw it before moving again: a replay waits for it.
   */
  get replaySettled(): boolean {
    return this.movesInFlight === 0 && this.motion.size === 0 && this.claiming.active === 0 && !this.duelCamera && !this.rite
      && !(this.fatality?.stats.active ?? false) && !this.conclusionViewActive && !this.voices.busy;
  }

  /** A replay's Skip: a Combat Director fight cuts to its killing blow (skipCombat); any other move on stage plays out fast. */
  skipMove(): void {
    if (this.combatControl) { this.skipCombat(); return; }
    if (this.movesInFlight === 0) return;
    this.combatHurry = SKIP_HURRY;
    this.fatality?.cancel(); this.fatalityShot = null;
    // A blow's moment is cut short as a skipped fight's is (moments/).
    this.moments.hurry();
    this.snapDuelCamera();
  }

  /**
   * Runs a spoken line's choice on the match's own draw for this ply (shared/play/replay-show.ts): the live game and its
   * replay say the same words. An older record has no seed, and its lines are drawn fresh.
   */
  private voiced<T>(salt: string, speak: () => T): T {
    const seed = this.matchSeed();
    return seed === null ? speak() : withSeededRandom(showSeed(seed, this.controller.getSnapshot().sanList, salt), speak);
  }

  /** The match's own dice for one choice of this ply (a slash's tilt, a step's pitch); fresh ones for an older record. */
  private showDice(salt: string): () => number {
    const seed = this.matchSeed();
    return seed === null ? Math.random : showRandom(showSeed(seed, this.controller.getSnapshot().sanList, salt));
  }

  /** The match's seed, or null where there is none (an older replay; a controller stand-in in a unit test). */
  private matchSeed(): number | null {
    return this.controller.getMatchSeed?.() ?? null;
  }

  /** Tells a browser check what a capture's show chose, with the (1-based) ply it belongs to. */
  private showTrace(what: string, detail: unknown, ply?: number): void {
    const sink = (globalThis as { __crownfallCombatTrace?: unknown[] }).__crownfallCombatTrace;
    if (Array.isArray(sink)) sink.push({ what, detail, at: 0, ply: ply ?? this.controller.getSnapshot().moves.length });
  }

  setCaptureCinematics(enabled: boolean): void {
    this.captureCinematics = enabled;
  }

  setCampaignBattle(active: boolean): void {
    this.campaignBattle = active;
    const look = ARENA_LOOKS[this.arena];
    this.postfx.setClarity(active || this.showcase || this.attract);
    if (!this.menuPresentation && !this.tactical) {
      this.applyExposure(look.exposure * (active ? 1.08 : 1));
      this.cameraLamp.intensity = look.lamp.intensity * (active ? 1.5 : 1);
    }
  }

  /**
   * Holds the scene where it is, and lets it go again (the match's pause menu). While held the frame is still drawn, but
   * the scene's clock gives every system a delta of 0, the fatality's and the fight's own clocks included, and the
   * timed waits of the scene's choreography (tween.ts wait) stand still with it. Sound already started plays out.
   */
  setHeld(held: boolean): void {
    if (this.held === held) return;
    this.held = held;
    holdWaits(held);
    // The match score draws back while the match is held (web/src/audio/scorePlayer.ts).
    audio.holdMatch(held);
  }

  get isHeld(): boolean { return this.held; }

  setReducedMotion(active: boolean): void {
    if (this.reducedMotion === active) return;
    this.reducedMotion = active;
    this.syncMomentFlags();
    this.effects.setReducedMotion(active);
    // Whatever is swirling stops at once.
    if (active) this.vfx?.clear();
    if (active) this.flourish?.clear();
    if (active) this.vaultFx?.clear();
    this.board.setReducedMotion(active);
    this.boardReactions.reset(); this.reactionStateKey = "";
    for (const piece of this.allPieces()) piece.setDynamicMotionEnabled(!active && !this.menuPresentation);
    if (active) {
      this.downfall.skip();
      this.conclusion.skip();
      this.skipCombat();
      // No slow motion and no X-ray under reduced motion: a fatality playing ends at once.
      this.fatality?.cancel(); this.fatalityShot = null;
      this.controls.autoRotate = false;
      this.postfx.setCinematic(false);
      this.shake.offset.set(0, 0, 0);
      this.combatFeel.clear();
      if (this.introPlaying) this.skipIntro();
    }
    if (!active) this.syncBoardReactions(this.controller.getSnapshot());
  }

  setRotateBoard(enabled: boolean): void {
    this.rotateBoard = enabled;
  }

  /** Floating rank crests above every figure on the board. */
  setRankBadges(enabled: boolean): void {
    if (this.rankBadges === enabled) return;
    this.rankBadges = enabled;
    // Turned on in a close shot, they wait for the view to come back (closeShotBadges).
    const visible = enabled && !this.menuPresentation && !this.badgesHiddenForShot;
    for (const piece of this.pieces.values()) piece.setBadgeEnabled(visible);
    for (const piece of this.motion) piece.setBadgeEnabled(visible);
    for (const piece of this.captured) piece.setBadgeEnabled(visible);
  }

  /**
   * Showcase presentation for computer-vs-computer duels.
   *
   * The viewer is only ever watching here, so the picture is tuned for reading
   * the board rather than for atmosphere: no depth of field at all (that soft
   * wash was blurring the whole hall), grain, vignette and bloom pulled back,
   * and one held framing instead of a permanent orbit. The camera behaviour is
   * the viewer's choice — see {@link ShowcaseCamera}.
   */
  setShowcase(active: boolean, camera: ShowcaseCamera = "follow", orbitSpeed = 0.32): void {
    const changed = this.showcase !== active;
    this.showcase = active;
    this.showcaseOrbitSpeed = orbitSpeed;
    this.showcaseCamera = camera;
    // A showcase is watched, never squinted at: keep it sharp.
    this.postfx.setCinematic(false);
    this.postfx.setClarity(active || this.campaignBattle);
    if (!active) {
      this.controls.autoRotate = false;
      this.focusPoint(null);
      return;
    }
    if (camera !== "orbit") this.controls.autoRotate = false;
    if (changed && !this.tactical) {
      this.followedFocus.copy(BOARD_FOCUS);
      this.framedShot = SHOWCASE_SHOT;
      const framing = this.framingFor(SHOWCASE_SHOT);
      this.adoptFraming(framing);
      void this.moveCameraTo(framing, 1.4);
    }
  }

  /** Switches the showcase camera between a held angle, an orbit and following. */
  setShowcaseCamera(camera: ShowcaseCamera): void {
    if (this.showcaseCamera === camera) return;
    this.showcaseCamera = camera;
    if (camera !== "orbit") this.controls.autoRotate = false;
    if (camera === "follow") {
      // Track from wherever the view is sitting right now.
      this.captureFollowRig();
      this.followedFocus.copy(this.controls.target);
    }
  }

  /** The showcase camera behaviour currently in force. */
  getShowcaseCamera(): ShowcaseCamera {
    return this.showcaseCamera;
  }

  setAttract(active: boolean): void {
    this.attract = active;
    this.syncMomentFlags();
    this.postfx.setCinematic(false);
    this.postfx.setClarity(active || this.showcase || this.campaignBattle);
    if (active) {
      this.controls.enabled = false;
      this.framedShot = CAMERA_SHOTS.cinematic;
      const framing = this.framingFor(CAMERA_SHOTS.cinematic);
      this.adoptFraming(framing);
      void this.moveCameraTo(framing, 2);
    } else {
      this.controls.enabled = this.interactive;
    }
  }

  private menuShot(): CameraShot {
    const portrait = this.camera.aspect < 0.82;
    return portrait
      ? { position: new THREE.Vector3(0.2, 5.7, 10.2), target: new THREE.Vector3(0, 0.85, -0.15) }
      : { position: new THREE.Vector3(6.9, 4.2, 9.4), target: new THREE.Vector3(0, 0.9, -0.25) };
  }

  /**
   * A fixed title tableau with its own cast, camera, materials and light rig.
   * It intentionally does not run a chess match behind the interface.
   */
  setMenuPresentation(active: boolean, moveCamera = true): void {
    if (this.menuPresentation === active && !active) return;
    this.menuPresentation = active;
    const look = ARENA_LOOKS[this.arena];
    this.attract = false;
    this.syncMomentFlags();
    this.controls.autoRotate = false;
    this.clearSelection();
    this.board.clearHighlights();
    this.board.setHover(null);
    this.board.setShroud(null);
    this.board.setPresentationMode(active);
    this.stageWorld();
    this.hall?.setPresentationMode(active);
    this.postfx.setClarity(!active && (this.campaignBattle || this.showcase || this.attract));
    this.postfx.setMenuPresentation(active);

    if (active) {
      if (this.battlefield) this.battlefield.group.visible = false;
      if (this.jungle) this.jungle.group.visible = false;
      this.applyExposure(0.96);
      (this.scene.background as THREE.Color).setHex(0x08090c);
      const fog = this.scene.fog as THREE.FogExp2 | null;
      if (fog) {
        fog.color.setHex(0x111319);
        fog.density = 0.0115;
      }
      this.cameraLamp.color.setHex(0xffe0b6);
      this.cameraLamp.intensity = 0.12;
      this.controls.enabled = false;
      if (moveCamera && !this.introPlaying) void this.moveCameraTo(this.menuShot(), 1.2);
    } else {
      if (this.battlefield) {
        this.battlefield.applyArena(look);
        this.battlefield.group.visible = true;
      }
      this.jungle?.applyArena(look);
      this.applyExposure(look.exposure * (this.campaignBattle ? 1.08 : 1));
      (this.scene.background as THREE.Color).setHex(look.background);
      const fog = this.scene.fog as THREE.FogExp2 | null;
      if (fog) {
        fog.color.setHex(look.fog.color);
        fog.density = look.fog.density;
      }
      this.cameraLamp.color.setHex(look.lamp.color);
      this.cameraLamp.intensity = look.lamp.intensity * (this.campaignBattle ? 1.5 : 1);
      this.controls.enabled = this.interactive && !this.introPlaying;
    }

    this.rebuildPieces();
  }

  setInteractive(interactive: boolean): void {
    this.interactive = interactive;
    this.controls.enabled = interactive && !this.introPlaying && !this.attract && !this.menuPresentation;
    if (!interactive) {
      this.dropHeldTap();
      this.drag = null;
      this.clearSelection();
      this.hoveredPiece?.setHovered(false);
      this.hoveredPiece = null;
    }
  }

  /** Caps how often the arena is drawn, as the menu's renderers do: 30, 60 or 120 frames a second, or 0 for the display rate. */
  setFrameLimit(limit: number): void {
    this.frameLimit = limit === 30 || limit === 60 || limit === 120 ? limit : 0;
  }

  /**
   * The canvas's pixel ratio: the player's render scale, never above the preset's own cap (A-10), so Low on a
   * high-density screen stays at one pixel per CSS pixel and the automatic step-down lowers resolution too.
   */
  private pixelRatio(): number {
    const cap = QUALITY_SETTINGS[this.preset].maxPixelRatio;
    const scaled = this.renderScale === null ? window.devicePixelRatio : scaledPixelRatio(window.devicePixelRatio, this.renderScale);
    return Math.min(scaled, cap);
  }

  /** Change rendering resolution without restarting the match or its clocks. */
  setRenderScale(scale: number): void {
    this.renderScale = Number.isFinite(scale) ? Math.max(50, Math.min(100, scale)) : 100;
    this.battlefieldRenderer?.setResolutionScale(this.renderScale);
    this.handleResize();
  }

  handleResize = (): void => {
    const parent = this.canvas.parentElement;
    const width = parent?.clientWidth ?? window.innerWidth;
    const height = parent?.clientHeight ?? window.innerHeight;
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
    if (this.renderScale !== null) this.renderer.setPixelRatio(this.pixelRatio());
    this.renderer.setSize(width, height, false);
    this.postfx.setSize(width, height);
    this.applyViewport(width, height);
    this.battlefieldRenderer?.resize();
    if (this.menuPresentation && !this.cameraScripted && !this.introPlaying) {
      const shot = this.menuShot();
      this.camera.position.copy(shot.position);
      this.controls.target.copy(shot.target);
      this.camera.lookAt(shot.target);
    }
  };

  /** Keyboard counterpart to pointer hover, kept separate from selection. */
  setKeyboardCursor(square: SquareId): void {
    if (!this.interactive || this.promotionGroup) return;
    this.cursorSquare = square;
    this.cursorByKeys = true;
    // Where the keys leave the cursor is where their player finds it again (seatCursor).
    this.cursorSeats[this.inputMover(this.controller.getSnapshot())] = square;
    this.board.setHover(square);
  }

  /** The square the keyboard's cursor is on. */
  get keyboardCursor(): SquareId {
    return this.cursorSquare;
  }

  /**
   * One step of the keyboard's cursor (a controller's too), as the player sees the board: Up is away from them
   * wherever the camera stands (boardInput.ts). Returns the square it is now on.
   */
  moveKeyboardCursor(direction: CursorDirection): SquareId {
    if (!this.interactive || this.promotionGroup) return this.cursorSquare;
    const forward = this.camera.getWorldDirection(this.cursorForward);
    // Straight down (the map) there is no forward along the ground: the top of the picture stands in for it.
    if (Math.hypot(forward.x, forward.z) < 0.05) forward.setFromMatrixColumn(this.camera.matrixWorld, 1);
    this.setKeyboardCursor(stepCursor(this.cursorSquare, direction, forward.x, forward.z));
    return this.cursorSquare;
  }

  /** Enter on a square: the cursor's own unless one is given. Hands back what the press did (boardInput.ts). */
  activateKeyboardSquare(square: SquareId = this.cursorSquare): TapAction {
    if (!this.interactive || this.promotionGroup) return { type: "none" };
    this.setKeyboardCursor(square);
    return this.performTap(this.readTap(square));
  }

  /** A piece is in hand, or held for when the board is free: Escape has something to let go of. */
  get pieceInHand(): boolean {
    return this.selected !== null || this.heldTap !== null;
  }

  cancelKeyboardSelection(): void {
    this.dropHeldTap();
    this.drag = null;
    // With a move on stage and nothing selected there is nothing of a selection's to put out, and the squares'
    // markers are that move's: relit now they showed where it ends before its piece had arrived.
    if (this.selected || this.movesInFlight === 0) this.clearSelection();
  }

  /** A new game: the cursor starts in front of the King of whoever plays first from this seat. */
  private homeCursor(): void {
    this.cursorSeats = { w: cursorHome("w"), b: cursorHome("b") };
    this.cursorSquare = this.cursorSeats[this.inputMover(this.controller.getSnapshot())];
    if (this.cursorByKeys) this.board.setHover(this.cursorSquare);
  }

  /**
   * Hot seat, played from the keys or a controller: each player finds the cursor where they last left it, on their
   * own side of the board. A cursor the pointer is leading stays under the pointer.
   */
  private seatCursor(): void {
    const snapshot = this.controller.getSnapshot();
    if (snapshot.mode !== "hotseat" || snapshot.status !== "playing" || !this.cursorByKeys) return;
    this.cursorSquare = this.cursorSeats[snapshot.turn];
    this.board.setHover(this.cursorSquare);
  }

  chooseKeyboardPromotion(kind: PieceKind): void {
    if (!this.promotionResolve || !PROMOTION_CHOICES.includes(kind)) return;
    audio.blip("press");
    this.promotionResolve(kind);
  }

  // ------------------------------------------------------------- screen fitting

  /**
   * Re-solve the framing for the surface actually on screen: the lens, the orbit
   * limits, and — when the *shape* of the screen changed rather than just its
   * size — the shot itself.
   *
   * A browser toolbar sliding away only changes the height by a few percent, and
   * re-flying the camera for that would fight the player's own zoom, so the shot
   * is only re-solved when the aspect really moved (a rotation, a phone/desktop
   * switch, a window drag).
   */
  private applyViewport(width: number, height: number): void {
    const previous = this.view;
    this.view = readViewport(width, height);
    const reshaped =
      !this.viewportFitted ||
      previous.portrait !== this.view.portrait ||
      previous.handheld !== this.view.handheld ||
      Math.abs(previous.aspect - this.view.aspect) > 0.06;

    const framing = this.framingFor(this.framedShot);
    this.adoptFraming(framing);
    if (!reshaped) return;

    const first = !this.viewportFitted;
    this.viewportFitted = true;
    this.reframeCamera(framing, first ? 0 : 0.7);
  }

  /** Solves an authored shot for the live viewport. */
  private framingFor(shot: CameraShot): Framing {
    const base = this.tactical ? TACTICAL_FOV : DEFAULT_FOV;
    return frameShot(shot.position, shot.target, this.view, {
      fov: base,
      maxFov: lensCeiling(this.view, base),
      // The map is read from straight above, so it may climb much further out.
      maxDistance: this.tactical ? 30 : 19,
    });
  }

  /** Takes on a framing's lens and reach without moving the camera. */
  private adoptFraming(framing: Framing): void {
    this.lensFov = framing.fov;
    this.fitRadius = framing.radius;
    this.camera.fov = framing.fov;
    this.camera.updateProjectionMatrix();
    this.applyOrbitLimits();
  }

  private applyOrbitLimits(): void {
    this.limits = orbitLimits(this.view, this.fitRadius);
    this.controls.rotateSpeed = this.limits.rotateSpeed;
    this.controls.minPolarAngle = this.limits.minPolarAngle;
    this.controls.maxPolarAngle = this.limits.maxPolarAngle;
    if (this.tactical) {
      this.controls.minDistance = Math.min(11, this.fitRadius * 0.62);
      this.controls.maxDistance = Math.max(34, this.fitRadius * 1.5);
      return;
    }
    this.controls.minDistance = this.limits.minDistance;
    this.controls.maxDistance = this.limits.maxDistance;
  }

  /**
   * Puts the camera on a solved framing while keeping the side of the board the
   * player was watching from — a rotation re-frames the board, it never spins it.
   */
  private reframeCamera(framing: Framing, duration: number): void {
    if (this.introPlaying || this.cameraScripted) return;
    const current = new THREE.Spherical().setFromVector3(
      this.scratchDesired.copy(this.camera.position).sub(this.controls.target),
    );
    const wanted = new THREE.Spherical().setFromVector3(framing.position.clone().sub(framing.target));
    if (current.radius > 1e-3) wanted.theta = current.theta;
    wanted.makeSafe();
    const position = new THREE.Vector3().setFromSpherical(wanted).add(framing.target);
    if (duration <= 0) {
      this.camera.position.copy(position);
      this.controls.target.copy(framing.target);
      this.captureFollowRig();
      return;
    }
    void this.moveCameraTo({ position, target: framing.target.clone() }, duration);
  }

  /**
   * The camera is never allowed out of the hall.
   *
   * Orbit controls can only cap angle and distance independently, so a framing
   * that needs to sit further back — which is exactly what a narrow screen needs
   * — walks the camera straight out through the colonnade at radius 12.5, and
   * the pillars and curtain wall end up standing in front of the board. Any
   * ground reach past the pillars is converted into height here instead, every
   * frame, so the view climbs over the hall rather than backing into it.
   */
  private confineCamera(): void {
    // The intro deliberately flies in from outside the walls.
    if (this.introPlaying || this.cameraScripted) return;
    const ground = Math.hypot(this.camera.position.x, this.camera.position.z);
    if (ground <= HALL_INNER_RADIUS) return;
    const target = this.controls.target;
    const distance = this.camera.position.distanceTo(target);
    const scale = HALL_INNER_RADIUS / ground;
    this.camera.position.x *= scale;
    this.camera.position.z *= scale;
    const flat = Math.hypot(this.camera.position.x - target.x, this.camera.position.z - target.z);
    // Climb by whatever the pull-back was worth, so the framing keeps its size.
    this.camera.position.y = target.y + Math.sqrt(Math.max(0.25, distance * distance - flat * flat));
  }

  private onManualCamera = (): void => {
    this.lastManualCameraAt = this.elapsed;
  };

  /** Damping keeps firing `change` after a drag; only count real user input. */
  private onManualCameraChange = (): void => {
    if (this.controls.autoRotate || this.orbiting || this.cameraDriven || this.cameraScripted) return;
    this.lastManualCameraAt = this.elapsed;
  };

  /** The angle and distance the viewer just chose become the follow rig. */
  private onManualCameraEnd = (): void => {
    this.captureFollowRig();
  };

  private onContextLost = (event: Event): void => {
    event.preventDefault();
    this.running = false;
    cancelAnimationFrame(this.frameId);
    this.callbacks.onContextLost();
  };

  private onContextRestored = (): void => {
    this.postfx.setPreset(this.preset);
    this.handleResize();
    this.start();
  };

  dispose(): void {
    this.releaseVoiceTrace();
    this.disposed = true;
    // Left from the pause menu: the timed waits are shared by every scene, so the next one must not find them held.
    this.setHeld(false);
    // An opening still on stage ends here, so whoever awaits it is let go.
    this.updateMatchOpening(false);
    this.battlefieldRenderer?.dispose(); this.battlefieldRenderer = null;
    // Leaving the match: every moment at rest, a last word to whoever listened (a check's dread ends), nobody listening.
    this.moments.dispose(); this.postfx.disposeMoments();
    this.claiming.dispose();
    this.spells?.dispose(); this.spells = null;
    this.fatality?.dispose(); this.fatality = null; this.fatalityShot = null; this.xray = null;
    this.fluid?.dispose(); this.fluid = null;
    this.endRite();
    this.bakedWorld?.removeFromParent();
    this.bakedWorld = null;
    this.disposed = true;
    this.gore?.dispose();
    this.scorch?.dispose(); this.scorch = null;
    this.deathPhysics?.dispose(); this.deathPhysics = null;
    this.burning?.dispose(); this.burning = null;
    this.vfx?.dispose(); this.vfx = null;
    this.flourish?.dispose(); this.flourish = null;
    this.vaultFx?.dispose(); this.vaultFx = null;
    for (const material of this.programKeepers.splice(0)) { (material as THREE.MeshBasicMaterial).map?.dispose(); material.dispose(); }
    this.duelCamera = null;
    this.combatControl?.cancel();
    this.unbindGameController();
    this.combatDirector.cancelAll();
    this.cancelEndFraming();
    this.downfall.dispose();
    this.boardReactions.reset();
    this.voices.dispose();
    this.running = false;
    cancelAnimationFrame(this.frameId);
    this.tweens.cancelAll();
    this.controls.removeEventListener("start", this.onManualCamera);
    this.controls.removeEventListener("change", this.onManualCameraChange);
    this.controls.removeEventListener("end", this.onManualCameraEnd);
    this.canvas.removeEventListener("pointermove", this.onPointerMove);
    this.canvas.removeEventListener("pointerdown", this.onPointerDown, { capture: true });
    window.removeEventListener("pointerup", this.onPointerUp);
    window.removeEventListener("pointercancel", this.onPointerUp);
    this.canvas.removeEventListener("contextmenu", this.onContextMenu);
    window.removeEventListener("resize", this.handleResize);
    this.canvas.removeEventListener("webglcontextlost", this.onContextLost);
    this.canvas.removeEventListener("webglcontextrestored", this.onContextRestored);
    this.closePromotionPicker();
    for (const piece of this.pieces.values()) piece.dispose();
    for (const piece of this.captured) piece.dispose();
    this.pieces.clear();
    this.captured = [];
    this.combatFeel.dispose();
    this.effects.dispose();
    this.musterEffects.dispose();
    this.endPromotionStage();
    this.promotionForm.dispose();
    this.alarm.dispose();
    this.spellLights.dispose();
    disposeStrikeAssets();
    disposeGunAssets();
    disposeShatterAssets();
    this.board.dispose();
    this.hall?.dispose();
    this.battlefield?.dispose();
    this.jungle?.dispose();
    this.factory.dispose();
    this.environmentMap?.dispose();
    this.environmentMap = null;
    this.scene.environment = null;
    this.postfx.dispose();
    this.controls.dispose();
    this.renderer.dispose();
    releaseContextWhenDetached(this.canvas, this.renderer.getContext());
  }
}

