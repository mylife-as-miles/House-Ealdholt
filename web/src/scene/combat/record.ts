/**
 * How a fight travels with its move.
 *
 * The Pawn foundation already records its choice in the move's PGN comment as
 * `[%cfcombat 1 <library> <attack> <defense> <hit> <death>]`
 * (shared/play/combat-sequences.ts), and every replay is rebuilt from the PGN,
 * so that token already survives storage, import and export. The director does
 * not invent a second carrier:
 *
 *  - a Pawn-vs-Pawn sequence that *is* one of the foundation's three tuples is
 *    recorded as that very version-1 token (see `recordOf` in director.ts);
 *  - everything the version-1 tuple cannot say (other classes, underdog
 *    variants, signatures, rites) is recorded as version 2 of the same token: `[%cfcombat 2 <sequence-id> <l|r> <seed>]`.
 *
 * The foundation's parser only accepts version 1 and its controller strips
 * `[%cfcombat ...]` of any version before writing a new one, so old builds
 * ignore a version-2 token and play their plain cinematic.
 *
 * Pure encode/decode only. Wiring is two lines for the integrator:
 * gameController.commit writes `plan.record` with `withCombatRecord`, and
 * shared/showcase/records.ts reads it with `combatRecordFromComment`.
 *
 * `packCombatTrack`/`unpackCombatTrack` are the alternative if the lead would
 * rather keep PGN comments untouched: one optional array beside the PGN,
 * indexed by ply, ignored when it does not match the validated move list.
 */
export interface CombatRecord {
  version: 2;
  sequence: string;
  /** The open flank the director chose: +1 the attacker's right, -1 its left. */
  side: 1 | -1;
  seed: number;
}

const SEQUENCE = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/;
const TOKEN = /\[%cfcombat\s+2\s+([a-z][a-z0-9.-]{0,47})\s+([lr])\s+([0-9a-f]{1,8})\s*\]/;
const ANY_TOKEN = /\s*\[%cfcombat[^\]]*\]/g;

export function encodeCombatRecord(record: Omit<CombatRecord, "version">): string {
  if (!SEQUENCE.test(record.sequence) || record.sequence.length > 48) throw new Error("Unrecordable combat sequence id");
  if (!Number.isInteger(record.seed) || record.seed < 0 || record.seed > 0xffffffff) throw new Error("Unrecordable combat seed");
  return `[%cfcombat 2 ${record.sequence} ${record.side === 1 ? "r" : "l"} ${record.seed.toString(16)}]`;
}

/** The version-2 record inside a PGN comment (or a bare token), else null. */
export function combatRecordFromComment(comment: string | null | undefined): CombatRecord | null {
  const match = typeof comment === "string" ? TOKEN.exec(comment) : null;
  if (!match || !SEQUENCE.test(match[1])) return null;
  return { version: 2, sequence: match[1], side: match[2] === "r" ? 1 : -1, seed: parseInt(match[3], 16) };
}

/** Replaces whatever combat token a comment carries, keeping the rest of it. */
export function withCombatRecord(comment: string | null | undefined, token: string): string {
  const rest = (comment ?? "").replace(ANY_TOKEN, "").trim();
  return [rest, token].filter(Boolean).join(" ");
}

/** One entry per ply, "" where no fight was recorded; trailing blanks dropped. */
export function packCombatTrack(tokens: readonly (string | null | undefined)[]): string[] {
  const track = tokens.map(token => token ?? "");
  while (track.length && !track[track.length - 1]) track.pop();
  return track;
}

/** Null unless the value is a well-formed track for a replay of `plies` moves. */
export function unpackCombatTrack(value: unknown, plies: number): (string | null)[] | null {
  if (!Array.isArray(value) || value.length > plies) return null;
  const track: (string | null)[] = [];
  for (const item of value) {
    if (item === "") { track.push(null); continue; }
    if (typeof item !== "string" || item.length > 160 || !/^\[%cfcombat [^\]\n{}]*\]$/.test(item)) return null;
    track.push(item);
  }
  while (track.length < plies) track.push(null);
  return track;
}
