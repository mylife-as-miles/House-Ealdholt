/** Shorthand shared by the catalog files. Everything it returns is plain data. */
import type { ActorAction, At, ClipRequest, Cue, DuelPoint } from "../choreography";

export type ActorCue = Cue<ActorAction<DuelPoint, At>>;
/** Relative to where the attacker's weapon reaches the defender from. */
export const standoff = (along = 0, side = 0): DuelPoint => ({ ref: "standoff", along, side });
/** Relative to the defender's own spot. */
export const ground = (along = 0, side = 0): DuelPoint => ({ ref: "defender", along, side });
export const ORIGIN = { point: { ref: "origin" } as DuelPoint };
export const HIS = {
  weapon: { actor: "attacker", anchor: "weaponTip" }, shield: { actor: "attacker", anchor: "shieldFace" },
  torso: { actor: "attacker", anchor: "torso" }, head: { actor: "attacker", anchor: "head" }, feet: { actor: "attacker", anchor: "ground" },
} as const;
export const HERS = {
  weapon: { actor: "defender", anchor: "weaponTip" }, shield: { actor: "defender", anchor: "shieldFace" },
  torso: { actor: "defender", anchor: "torso" }, head: { actor: "defender", anchor: "head" }, feet: { actor: "defender", anchor: "ground" },
} as const;

/** An authored attack clip, its contact landing on `on`. Required: without it the engine falls back. */
export const blow = (id: string, from: At, on: At, events: readonly string[] = ["impact", "contact"]): ActorCue =>
  ({ at: from, do: "clip", clip: { role: "attack", prefer: [id], required: true }, sync: { events, to: on } });
/** A defender's guard: its own class clip if it has one, the Pawn library's, else a procedural block. */
export const guard = (from: At, on: At, prefer: readonly string[] = ["defend.block", "defend.parry"]): ActorCue =>
  ({ at: from, do: "clip", clip: { role: "block", prefer, fallbacks: [{ pose: "block", strength: 1 }] }, sync: { events: ["guard", "evade"], to: on } });
export const hitBy = (prefer: readonly string[], pose: "recoil" | "stagger" = "stagger"): ClipRequest => ({ role: "hit", prefer, fallbacks: [{ pose }] });
