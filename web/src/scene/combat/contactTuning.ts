/**
 * Fits a plan's weapon contacts to the two rigs that will perform it.
 *
 * A sequence says "the spear meets the shield at `clash`" and "the spear meets
 * the body at `decisive`". Whether it does depends on the reach of this rig's
 * clip from where this capture puts the fighters. Before the fight starts, each
 * weapon contact is swept (sweptContact.ts) from the poses the stage reports,
 * and the plan is adjusted, never the clips:
 *
 *  - the attacker's last step before the contact is lengthened or shortened so
 *    the weapon, at full reach, arrives on the surface it is meant for;
 *  - the attack clip's sync moment is moved by the few hundredths between the
 *    steel arriving and the clip's authored contact frame, so the marker (and
 *    with it the sound, the sparks and the kill) fires as the steel arrives.
 *
 * It returns the forecast for each contact: the time, point, surface normal and
 * anchor the sweep expects. The stage keeps them for diagnostics; a wound or
 * blood effect can be placed from the same data.
 *
 * Pure: the rigs are reached only through {@link PoseProbe}.
 */
import type { Actor, BoardPoint, ContactAction, Planned } from "./choreography";
import type { CombatPlan } from "./director";
import type { ClipInfo } from "./runner";
import { aimCorrection, blockHolds, placeLocal, sweepWeapon, turnLocal, type SweptContact, type TargetSample, type Vec3, type WeaponSample } from "./sweptContact";

/** A rig's pose at one moment, in the figure's own frame: z ahead of it, x to its left, y up from its feet. */
export interface LocalPose { time: number; grip: Vec3; tip: Vec3; torso: Vec3; shield: Vec3 | null; shieldNormal: Vec3 | null }

export interface PoseProbe {
  /** The clip the stage will play for a request (as CombatActor.clip). */
  clip(actor: Actor, role: Parameters<import("./runner").CombatActor["clip"]>[0], prefer: readonly string[]): ClipInfo | null;
  /** The rig posed at moments of a clip, or as it stands for `null`. Empty when the rig cannot be sampled. */
  pose(actor: Actor, clip: string | null, times: readonly number[]): LocalPose[];
  /** World position of a plan point. */
  place(point: BoardPoint): Vec3;
  /** One square in world units. A board offset (file, rank) is (file, 0, -rank) squares in the world. */
  tile: number;
}

export interface ContactForecast {
  id: string;
  /** Plan seconds of the contact. */
  at: number;
  wanted: "shield" | "torso";
  /** The sweep as the sequence was authored, and after the fit. Null when the rigs could not be sampled. */
  before: SweptContact | null;
  after: SweptContact | null;
  /** Squares the attacker's step was moved along the blow (+ closer). */
  shift: number;
  /** Squares it was moved across the blow (+ to the attacker's left), so the weapon's line runs through the target. */
  across: number;
  /** Seconds the clip's sync moment was moved so the steel arrives on the marker (negative: the marker waits for a weapon that is held out). */
  lead: number;
  /** The pose the struck fighter was read in: the clip he will be in at that moment and how far into it (null: as he stands). */
  stance?: { clip: string | null; time: number };
  /** Who was moved to make it meet, when it was not the striker: the struck fighter's own step back gave instead. */
  moved?: Actor;
  /** A blow meant for the shield: true when the sweep meets the shield first and it faces the blow. */
  blocked?: boolean;
}

export const CONTACT_FIT = {
  /** The body the weapon must enter: an upright capsule around the spine. */
  torsoRadius: 0.06,
  /** How deep past the spine line the tip is aimed at full reach (negative: short of it). */
  torsoDepth: -0.01,
  shieldRadius: 0.17,
  shieldDepth: 0.01,
  /** Most a step may be moved along and across the blow, in squares. */
  maxShift: 0.24, maxAcross: 0.2,
  /** Most a sync moment may be moved, in seconds. */
  maxLead: 0.1,
  /** Clip seconds sampled before and after the authored contact. */
  before: 0.16, after: 0.05, step: 1 / 60,
  /** A weapon that moves less than `heldOut` in the samples after its contact is being held out; the marker then waits `settle` seconds. */
  settle: 0.03, heldOut: 0.06,
} as const;

const near = (a: number, b: number) => Math.abs(a - b) < 0.02;
/** The guard a duellist stands in between clips, where the rig has it. */
const REST_GUARD = "ready.guard";

/** The plan fitted to the rigs, and what the sweep forecasts for each weapon contact. The input plan is not modified. */
export function tuneContacts(plan: CombatPlan, probe: PoseProbe): { plan: CombatPlan; forecasts: ContactForecast[] } {
  const tuned: CombatPlan = { ...plan, attacker: plan.attacker.map(cue => ({ ...cue })), defender: plan.defender.map(cue => ({ ...cue })) };
  const forecasts: ContactForecast[] = [];
  const other = (actor: Actor): Actor => actor === "attacker" ? "defender" : "attacker";
  const standing = (actor: Actor, time: number): { index: number; point: BoardPoint } => {
    let index = -1;
    tuned[actor].forEach((cue, i) => { if (cue.do === "move" && cue.at < time - 1e-6) index = i; });
    const cue = index >= 0 ? tuned[actor][index] : null;
    return { index, point: cue && cue.do === "move" ? cue.to : { ref: actor === "attacker" ? "standoff" : "defender", file: 0, rank: 0 } };
  };
  for (const contact of plan.contacts as Planned<ContactAction>[]) {
    if (contact.from.anchor !== "weaponTip" || (contact.to.anchor !== "shieldFace" && contact.to.anchor !== "torso")) continue;
    const striker = contact.from.actor, struck = other(striker);
    // The attack whose blow this contact is: its sync (or, for a two-blow clip, its first blow) lands on the contact.
    let found: { index: number; clip: ClipInfo; event: number; first: boolean } | null = null;
    tuned[striker].forEach((cue, index) => {
      if (cue.do !== "clip" || cue.clip.role !== "attack") return;
      const clip = probe.clip(striker, cue.clip.role, cue.clip.prefer ?? []);
      if (!clip) return;
      if (cue.via && near(cue.via.to, contact.at) && clip.events[cue.via.event] !== undefined) found = { index, clip, event: clip.events[cue.via.event] as number, first: true };
      else if (cue.sync && near(cue.sync.to, contact.at)) {
        const event = cue.sync.events.map(name => clip.events[name]).find(time => time !== undefined);
        if (event !== undefined) found = { index, clip, event, first: false };
      }
    });
    const blow = found as { index: number; clip: ClipInfo; event: number; first: boolean } | null;
    const wanted: "shield" | "torso" = contact.to.anchor === "shieldFace" ? "shield" : "torso";
    const forecast: ContactForecast = { id: contact.id, at: contact.at, wanted, before: null, after: null, shift: 0, across: 0, lead: 0 };
    forecasts.push(forecast);
    if (!blow) continue;
    const times: number[] = [];
    for (let time = Math.max(0, blow.event - CONTACT_FIT.before); time <= Math.min(blow.clip.duration, blow.event + CONTACT_FIT.after) + 1e-9; time += CONTACT_FIT.step) times.push(time);
    const swing = probe.pose(striker, blow.clip.id, times);
    // The defender as it will be at that moment: on its guard's own guard frame, or as it stands.
    let guard: { id: string; time: number } | null = null;
    for (const cue of tuned[struck]) {
      if (cue.do !== "clip" || !cue.sync || !near(cue.sync.to, contact.at)) continue;
      const clip = probe.clip(struck, cue.clip.role, cue.clip.prefer ?? []);
      const event = clip ? cue.sync.events.map(name => clip.events[name]).find(time => time !== undefined) : undefined;
      if (clip && event !== undefined) guard = { id: clip.id, time: event };
    }
    if (!guard) {
      // No guard is timed to this blow: he is wherever the last clip he was given has got to, or back in his guard.
      let last: { clip: ClipInfo; time: number } | null = null;
      for (const cue of tuned[struck]) {
        if (cue.do !== "clip" || cue.at > contact.at - 1e-6) continue;
        const clip = probe.clip(struck, cue.clip.role, cue.clip.prefer ?? []);
        if (clip) last = { clip, time: (contact.at - cue.at) * (cue.rate ?? 1) / plan.timeScale };
      }
      const playing = last as { clip: ClipInfo; time: number } | null;
      const rest = probe.clip(struck, "idle", [REST_GUARD]);
      if (playing && playing.time <= playing.clip.duration + 0.2) guard = { id: playing.clip.id, time: Math.min(playing.time, playing.clip.duration - 1e-3) };
      else if (rest) guard = { id: rest.id, time: 0 };
    }
    const held = guard as { id: string; time: number } | null;
    const stance = probe.pose(struck, held ? held.id : null, [held ? held.time : 0])[0];
    if (!swing.length || !stance) continue;
    forecast.stance = { clip: held ? held.id : null, time: held ? held.time : 0 };
    const feet = standing(striker, contact.at), ground = standing(struck, contact.at);
    const stood = probe.place(ground.point);
    const sweep = (from: Vec3, there: Vec3 = stood): { contact: SweptContact | null; weapon: WeaponSample[]; target: TargetSample[]; line: { x: number; z: number } } => {
      const line = { x: there.x - from.x, z: there.z - from.z }, back = { x: -line.x, z: -line.z };
      const weapon = swing.map(pose => ({ time: pose.time, grip: placeLocal(pose.grip, from, line), tip: placeLocal(pose.tip, from, line) }));
      const spine = (height: number) => placeLocal({ x: stance.torso.x, y: stance.torso.y * height, z: stance.torso.z }, there, back);
      const target: TargetSample[] = [{
        time: blow.event, torso: { base: spine(0.55), top: spine(1.5), radius: CONTACT_FIT.torsoRadius },
        shield: wanted === "shield" && stance.shield && stance.shieldNormal ? { centre: placeLocal(stance.shield, there, back), normal: turnLocal(stance.shieldNormal, back), radius: CONTACT_FIT.shieldRadius } : null,
      }];
      return { contact: sweepWeapon(weapon, target), weapon, target, line };
    };
    const here = probe.place(feet.point);
    const first = sweep(here);
    forecast.before = first.contact;
    const length = Math.hypot(first.line.x, first.line.z);
    if (length < 1e-6) continue;
    const want = wanted === "shield" && first.target[0].shield ? "shield" : "torso";
    const correction = aimCorrection(first.weapon, first.target, first.line, want, want === "shield" ? CONTACT_FIT.shieldDepth : CONTACT_FIT.torsoRadius + CONTACT_FIT.torsoDepth);
    const shift = Math.max(-CONTACT_FIT.maxShift, Math.min(CONTACT_FIT.maxShift, correction.along / probe.tile));
    const across = Math.max(-CONTACT_FIT.maxAcross, Math.min(CONTACT_FIT.maxAcross, correction.across / probe.tile));
    // Along the blow, and to the attacker's left of it (the left of a figure facing along (x, z) is (z, -x)).
    const dx = (first.line.x * shift + first.line.z * across) / length, dz = (first.line.z * shift - first.line.x * across) / length;
    const moved = { x: here.x + dx * probe.tile, y: here.y, z: here.z + dz * probe.tile };
    const step = feet.index >= 0 ? tuned[striker][feet.index] : null;
    const fits = !!step && step.do === "move" && Math.abs(shift) + Math.abs(across) > 1e-4;
    // The striker's step may already be spoken for: an earlier blow of his was fitted from that same spot (a bash
    // before the thrust). Then it is the struck fighter's own move in between, the pace he is knocked back, that gives.
    const earlier = step ? (plan.contacts as Planned<ContactAction>[]).some(other => other.from.actor === striker && other.at < contact.at - 1e-6 && other.at > step.at + 1e-6) : false;
    const given = earlier && ground.index >= 0 ? tuned[struck][ground.index] : null;
    let fitted = first;
    if (fits && earlier) {
      if (given && given.do === "move") {
        given.to = { ...given.to, file: given.to.file - dx, rank: given.to.rank + dz };
        forecast.shift = shift; forecast.across = across; forecast.moved = struck;
        fitted = sweep(here, { x: stood.x - dx * probe.tile, y: stood.y, z: stood.z - dz * probe.tile });
      }
    } else if (fits && step && step.do === "move") {
      step.to = { ...step.to, file: step.to.file + dx, rank: step.to.rank - dz };
      forecast.shift = shift; forecast.across = across;
      fitted = sweep(moved);
    }
    forecast.after = fitted.contact;
    if (wanted === "shield") forecast.blocked = blockHolds(fitted.contact);
    // The steel arrives a little before the clip's own contact frame: the marker is given that moment.
    const cue = tuned[striker][blow.index];
    if (fitted.contact?.hit && cue.do === "clip") {
      let lead = Math.max(0, Math.min(CONTACT_FIT.maxLead, blow.event - fitted.contact.time));
      // A fast thrust covers a hand's breadth in a frame: timed to the instant it touches, the frame the marker fires on
      // may still show it short. Where the clip holds the weapon out after its contact, the marker is put a moment
      // after the touch instead, so the steel is seen in before the hit is heard.
      const reach = swing.find(pose => pose.time >= blow.event - 1e-6), after = swing[swing.length - 1];
      const heldOut = !blow.first && !!reach && after.time >= blow.event + CONTACT_FIT.settle && Math.hypot(after.tip.x - reach.tip.x, after.tip.y - reach.tip.y, after.tip.z - reach.tip.z) < CONTACT_FIT.heldOut;
      if (heldOut) lead -= CONTACT_FIT.settle;
      if (Math.abs(lead) > 1e-3) {
        if (blow.first && cue.via) cue.via = { ...cue.via, to: cue.via.to + lead };
        else if (cue.sync) cue.sync = { ...cue.sync, to: cue.sync.to + lead };
        forecast.lead = lead;
      }
    }
  }
  return { plan: tuned, forecasts };
}
