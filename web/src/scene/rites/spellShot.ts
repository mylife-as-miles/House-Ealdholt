/**
 * The shot a spell from the library takes (sceneEngine playSpellCinematic): what each of its beats keeps in frame,
 * and from where. No Three.js in here, so the node tests reach it (shared/play/spell-shot.test.ts).
 *
 * One shot, in beats:
 *
 *   shoulder  a spell whose travel is the show (vfx/spells/spell.ts SpellEntry.travels: the Lance's beam, the Storm
 *             bolt): over the caster's shoulder, the hand where it gathers at one side of the frame and the piece it
 *             is cast at down the line. Only where that line runs away from the player's view, so the board does not
 *             turn round under them; anywhere else the cast opens on the gather.
 *   gather    the piece and the air over it, close (rites/riteShot.ts `close`) and looking down over the figures
 *             round it: where the spell gathers, the Unmaking's rune, the crown's frozen disc, the portal's ring, the
 *             pillar's thread. The shoulder beat moves on to it as the spell leaves the hand, following it to the piece.
 *   strike    as the blow lands: in on the body where it burns, fades or is run through (nothing throws it); out over
 *             the ground round it where it bursts, held until its pieces have settled.
 *
 * In the first filmings the gather shot held the caster, the piece and 2.4 units of air over it from the player's
 * side: the hall's wall stopped the eye, the lens widened, and the piece's square was about 50 pixels of 720, so no
 * gathering read; and a burning body was watched from where a thrown one would have been. Each close beat is taken
 * from the side the fewest figures stand in front of (the fatality's sight test, fatality/fatalityPlan.ts): in a first
 * filming a Solforiz Pawn and its sword stood in front of the Glacial crown, and the Frost line's own row of ice hid
 * the body it ran through.
 */
import { blocked, type Point, type Standing } from "../fatality/fatalityPlan";
import { riteShot, turnHome, type RiteShotView } from "./riteShot";

export const SPELL_SHOT = {
  /**
   * The gather: the least it frames round the piece (a radius, rites/riteShot.ts closeReach), the squares of ground
   * it keeps round the piece's square, and the air over the piece's head where the spell names none (SpellEntry.air).
   */
  reach: 1.2, ground: 0.8, air: 0.6,
  /**
   * Degrees the beats look down, the first preferred: over the figures round the piece, as a fatality's shot does,
   * and not flat across the board, where the hall and its sky fill the top of the frame. And the turns (radians) they
   * may take off the shot's own (rites/riteShot.ts shotTurn), the first preferred.
   */
  downs: [24, 36], turns: [0, 0.35, -0.35, 0.7, -0.7, 1.05, -1.05],
  /**
   * A body that burns or fades where it stands: how far over its head the frame reaches, the squares of ground round
   * its feet it collapses onto, the least it frames, and the seconds the shot takes to come in on it.
   */
  burnOver: 0.35, burnRound: 0.8, burnReach: 0.95, burnIn: 0.8,
  /** A body run through, held up where it was struck: over its head, the squares of ice round its feet, and the seconds to come in. */
  pierceOver: 0.3, pierceRound: 0.45, pierceIn: 0.5,
  /** A body that bursts: the air over the blow, the squares beyond it and behind it its pieces may cross, and the seconds to move out. */
  burstOver: 1.7, thrown: 1.6, behind: 0.6, burstOut: 0.8,
  /**
   * Over the shoulder: how far behind the caster and to one side the eye stands and how far over its head; the lens
   * (degrees); how far down the line from the hand to the piece it looks (a share of the way); and the seconds the
   * shot takes to follow the spell from the hand to the piece. It is taken only while its view runs this close to
   * the player's own (the cosine between them).
   */
  back: 1.4, side: 0.62, rise: 0.38, lens: 41, aim: 0.65, follow: 0.6, facing: 0.3,
  /**
   * Seconds the shot holds on a body once it is down before the Claiming may take it. A burnt body smoulders on as a
   * husk (death/burn) while the Claiming begins, which crumbles it as its unmaking: in the first filming of the Lance
   * the shot held two seconds on the husk and its scar before the claim.
   */
  husk: 0.45,
} as const;

/** What the gather keeps in frame: the piece's square and the ground round it, and the piece up to `air` over its head. */
export function gatherFrame(stone: Point, height: number, air: number, tile: number): Point[] {
  const round = SPELL_SHOT.ground * tile, top = stone.y + height + Math.max(0, air);
  return [
    { ...stone }, { x: stone.x, y: top, z: stone.z },
    { x: stone.x + round, y: stone.y, z: stone.z }, { x: stone.x - round, y: stone.y, z: stone.z },
    { x: stone.x, y: stone.y, z: stone.z + round }, { x: stone.x, y: stone.y, z: stone.z - round },
  ];
}

/**
 * What a beat on a body that dies where it stands keeps in frame: the figure from the stone to `over` above its head,
 * and `round` of ground round its feet (scene units): the ice of a body run through, the stone a burning one falls on.
 */
export function bodyFrame(stone: Point, height: number, over: number, round: number): Point[] {
  const top = stone.y + height + over;
  return [
    { ...stone }, { x: stone.x, y: top, z: stone.z },
    { x: stone.x + round, y: stone.y, z: stone.z }, { x: stone.x - round, y: stone.y, z: stone.z },
    { x: stone.x, y: stone.y, z: stone.z + round }, { x: stone.x, y: stone.y, z: stone.z - round },
  ];
}

/**
 * What the beat on a body that bursts keeps in frame: its square, the air over the blow, and the ground its pieces
 * may cross, beyond it along the blow (`blow`, a unit vector on the board) and a little behind it.
 */
export function burstFrame(stone: Point, impact: Point, blow: { x: number; z: number }, tile: number): Point[] {
  const thrown = SPELL_SHOT.thrown * tile, behind = SPELL_SHOT.behind * tile;
  return [
    { ...stone }, { x: impact.x, y: impact.y + SPELL_SHOT.burstOver, z: impact.z },
    { x: stone.x + blow.x * thrown, y: stone.y, z: stone.z + blow.z * thrown },
    { x: stone.x - blow.x * behind, y: stone.y, z: stone.z - blow.z * behind },
  ];
}

/** What the gather wants seen: the piece's chest and head, and the stone round its feet where a spell writes or freezes. */
export function gatherSights(stone: Point, height: number, tile: number): Point[] {
  const round = 0.45 * tile, y = stone.y + 0.02;
  return [
    { x: stone.x, y: stone.y + height * 0.62, z: stone.z }, { x: stone.x, y: stone.y + height * 0.95, z: stone.z },
    { x: stone.x + round, y, z: stone.z }, { x: stone.x - round, y, z: stone.z }, { x: stone.x, y, z: stone.z + round }, { x: stone.x, y, z: stone.z - round },
  ];
}

/** What a beat on the body wants seen: its chest, its head and its belly. */
export function bodySights(stone: Point, height: number): Point[] {
  return [0.62, 0.92, 0.4].map(share => ({ x: stone.x, y: stone.y + height * share, z: stone.z }));
}

/**
 * A row of solids a spell raises along the stone from the caster to the piece (SpellEntry.row: the Frost line's ice),
 * as figures standing in the way of a close beat: it starts half a square out from the caster, rises along the line
 * and stops half a square short of the piece's square, there as tall as a figure on a long line and low on a short
 * one (vfx/spells/frost/frostPlan.ts frostLine, frostSpikes).
 */
export function rowScreen(caster: Point, stone: Point, tile: number): Standing[] {
  const dx = stone.x - caster.x, dz = stone.z - caster.z, reach = Math.hypot(dx, dz);
  const lead = Math.min(0.5 * tile, 0.3 * reach), length = reach - lead, room = length - 0.5 * tile;
  if (reach < 1e-6 || room <= 0) return [];
  const row: Standing[] = [];
  for (let i = 1; i <= 6; i += 1) {
    const at = (i / 6) * room, along = at / length;
    row.push({ x: caster.x + (dx / reach) * (lead + at), z: caster.z + (dz / reach) * (lead + at), radius: 0.22 * tile, height: 0.2 + 0.85 * along ** 1.3 });
  }
  return row;
}

export interface SpellShotInput {
  /** The player's view, and the turn the shot takes off it before any other (rites/riteShot.ts shotTurn, or the beat before's). */
  home: { position: Point; target: Point };
  base: number;
  boardTop: number;
  /** The frame's width over its height, and the match's lens (degrees, vertical). */
  aspect: number;
  fov: number;
  /** How far from the board's centre the eye may stand. */
  radius: number;
  /** A close beat (rites/riteShot.ts `close`), and the least it frames round what it watches; a burst's is not close. */
  close: boolean;
  reach?: number;
  /** Everything that may stand in the way (the other figures, a row of ice), and the points the beat wants seen. */
  standing: readonly Standing[];
  sights: readonly Point[];
  /** The turns off `base` and the steepnesses to try, the first preferred: {@link SPELL_SHOT}'s by default. */
  turns?: readonly number[];
  downs?: readonly number[];
}

export interface SpellShot {
  /** The turn off the player's side (radians, as rites/riteShot.ts turnHome takes it), and how steeply it looks down (degrees). */
  turn: number;
  down: number;
  view: RiteShotView;
  /** The share of the sight lines to what it wants seen that something standing blocks, 0 to 1. */
  occlusion: number;
}

/**
 * A beat of the spell's shot: of the turns and steepnesses it may take, the one the fewest things stand in front of,
 * nearest the preferred (as fatality/fatalityPlan.ts woundShot chooses its shot on the wound).
 */
export function spellShot(frame: readonly Point[], input: SpellShotInput): SpellShot {
  const turns = input.turns ?? SPELL_SHOT.turns, downs = input.downs ?? SPELL_SHOT.downs;
  let best: (SpellShot & { cost: number }) | null = null;
  for (const [order, offset] of turns.entries()) for (const [steep, down] of downs.entries()) {
    const turn = input.base + offset;
    const view = riteShot(frame, {
      home: turnHome(input.home, turn), boardTop: input.boardTop, aspect: input.aspect, fov: input.fov, radius: input.radius,
      close: input.close, ...(input.reach !== undefined ? { closeReach: input.reach } : {}), down,
    });
    const occlusion = input.sights.length > 0 ? blocked(view.position, input.sights, input.standing, input.boardTop) : 0;
    const cost = occlusion * 10 + order * 0.25 + steep * 0.6;
    if (!best || cost < best.cost - 1e-9) best = { turn, down, view, occlusion, cost };
  }
  const { cost: _cost, ...shot } = best!;
  return shot;
}

export interface ShoulderInput {
  /** The caster: the stone under it, how tall it stands, and where the spell gathers (its hand, its staff's head). */
  caster: Point;
  height: number;
  hand: Point;
  /** The piece's chest. */
  chest: Point;
  /** The player's view: the shoulder its eye is on comes first, and a line that runs toward it gets no shoulder beat. */
  home: { position: Point; target: Point };
  boardTop: number;
  /** How far from the board's centre the eye may stand. */
  radius: number;
  /** Every other figure standing, the caster not: it is what the shot is over. */
  standing: readonly Standing[];
}

/**
 * Over the caster's shoulder ({@link SPELL_SHOT}): the eye behind the caster and to one side, over its head, looking
 * down the line from its hand toward the piece, on a lens a little longer than the match's. Of its two shoulders,
 * the one on the player's side, unless the other sees the hand and the piece more clearly. Null where the line runs
 * toward the player or across their view ({@link SPELL_SHOT}.facing): taken from behind the caster that shot would
 * turn the board round under them, and the cast opens on the gather instead.
 */
export function shoulderShot(input: ShoulderInput): RiteShotView | null {
  const { caster, hand, chest, home } = input;
  const dx = chest.x - caster.x, dz = chest.z - caster.z, reach = Math.hypot(dx, dz);
  const vx = home.target.x - home.position.x, vz = home.target.z - home.position.z, view = Math.hypot(vx, vz);
  if (reach < 1e-6 || view < 1e-6) return null;
  const ax = dx / reach, az = dz / reach;
  if ((ax * vx + az * vz) / view < SPELL_SHOT.facing) return null;
  // The shoulder on the side of the player's eye first.
  let sx = -az, sz = ax;
  if (sx * (home.position.x - caster.x) + sz * (home.position.z - caster.z) < 0) { sx = -sx; sz = -sz; }
  const target = {
    x: hand.x + (chest.x - hand.x) * SPELL_SHOT.aim, y: hand.y + (chest.y - hand.y) * SPELL_SHOT.aim, z: hand.z + (chest.z - hand.z) * SPELL_SHOT.aim,
  };
  const y = Math.max(input.boardTop + 1.4, caster.y + input.height + SPELL_SHOT.rise);
  let best: { view: RiteShotView; cost: number } | null = null;
  for (const [order, side] of [1, -1].entries()) {
    const position = { x: caster.x - ax * SPELL_SHOT.back + sx * side * SPELL_SHOT.side, y, z: caster.z - az * SPELL_SHOT.back + sz * side * SPELL_SHOT.side };
    if (Math.hypot(position.x, position.z) > input.radius) continue;
    const cost = blocked(position, [hand, chest], input.standing, input.boardTop) * 10 + order;
    if (!best || cost < best.cost) best = { view: { position, target, fov: SPELL_SHOT.lens }, cost };
  }
  return best?.view ?? null;
}
