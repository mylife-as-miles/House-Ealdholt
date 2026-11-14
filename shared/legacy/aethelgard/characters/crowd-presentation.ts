/**
 * Crowd prop presentation contract: which shared prop-kit nodes a crowd resident shows while each clip plays, and the
 * offline envelopes its actor owner can use as given.
 *
 * WORKING PLACEHOLDER, Claude's character-art contract (motion and runtime fixer, 8 November 2026; see
 * docs/legacy/claude-integration/characters/population-README.md). `scripts/characters/crowd_motion_publish.ts` writes
 * a `presentation` block and `envelopes` into every published crowd resident JSON from the clip library manifest
 * (grips: `kitMatrix`, parts, workplace positions, `hidesRestProps`), the prop kits and the art registry (worn props at
 * rest, goods `placedWith` a workplace prop, carry goods that `replace` a clip prop, the stool under seated clips). The
 * desktop and Quest crowd adapters attach clones of the named kit nodes and toggle them with the playing motion:
 *
 * - `held`: a kit node under a bone with a bone-local matrix (column-major, glTF axes; the archetype's body scale is in
 *   the matrix, the resident's placement scale comes from the actor placement);
 * - `placed`: a kit node under the resident's model root with a root-frame matrix (workplace props, the resident's goods
 *   on them, the stool of seated clips). Work enter and exit show the work loop's placed props; sit down and stand up
 *   show the stool;
 * - `rest`: worn props under `hips` or `spine_03` while no playing clip holds the same prop or hides it (`hidesRest`).
 *
 * Pure and deterministic: no three, DOM, timers, clock reads, randomness or scene access. ES2020.
 */
import type { CrowdClipPlan, CrowdOwnerMotion } from './crowd-binding';

export const CROWD_PRESENTATION_STATUS = 'working-placeholder' as const;
export const CROWD_PRESENTATION_VERSION = 1 as const;

/** One kit node to attach: under `bone` (held, rest) or the model root (`bone: null`, placed). */
export interface CrowdPropPlacement {
  readonly prop: string;
  readonly kit: string;
  readonly node: string;
  readonly bone: string | null;
  /** Local matrix, column-major, 16 numbers. */
  readonly matrix: readonly number[];
}
export interface CrowdClipPresentation {
  readonly held: readonly CrowdPropPlacement[];
  readonly placed: readonly CrowdPropPlacement[];
  /** Worn props hidden while this clip plays. */
  readonly hidesRest: readonly string[];
}
export interface CrowdPresentationJson {
  readonly version: typeof CROWD_PRESENTATION_VERSION;
  /** Kit id to file path (relative to the shared `aethelgard/characters/` folder). */
  readonly kits: Readonly<Record<string, string>>;
  readonly rest: readonly CrowdPropPlacement[];
  readonly clips: Readonly<Record<string, CrowdClipPresentation>>;
}
export type CrowdPresentation = CrowdPresentationJson;

export interface CrowdEnvelopeJson { readonly min: readonly [number, number, number]; readonly max: readonly [number, number, number] }
export interface CrowdPublishedEnvelopes {
  readonly byClip: Readonly<Record<string, CrowdEnvelopeJson>>;
  /** The publisher checked every envelope against the skinned mesh sampled densely (envelopeGate.pass). */
  readonly gated: boolean;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const NAME = /^[a-z][a-z0-9_-]*$/;

function placement(v: unknown, what: string, boneRequired: boolean | null): CrowdPropPlacement {
  if (!isObj(v)) throw new Error(`${what} must be an object.`);
  const { prop, kit, node, bone, matrix } = v;
  if (typeof prop !== 'string' || !NAME.test(prop) || typeof kit !== 'string' || !NAME.test(kit)) throw new Error(`${what} needs a prop and a kit.`);
  if (typeof node !== 'string' || !/^prop_[a-z0-9_]+$/.test(node)) throw new Error(`${what} needs a kit node.`);
  if (bone !== null && (typeof bone !== 'string' || !/^[a-z][a-z0-9_]*$/.test(bone))) throw new Error(`${what} has an invalid bone.`);
  if (boneRequired === true && bone === null) throw new Error(`${what} rides a bone.`);
  if (boneRequired === false && bone !== null) throw new Error(`${what} is placed in the root frame.`);
  if (!Array.isArray(matrix) || matrix.length !== 16 || !matrix.every(x => typeof x === 'number' && Number.isFinite(x))) throw new Error(`${what} needs a 16-number matrix.`);
  if (matrix[3] !== 0 || matrix[7] !== 0 || matrix[11] !== 0 || matrix[15] !== 1) throw new Error(`${what} matrix must be affine.`);
  return Object.freeze({ prop, kit, node, bone: bone as string | null, matrix: Object.freeze(matrix.slice()) });
}

/** Reads a resident JSON's `presentation` block; null when the resident has none (published before 8 November). */
export function parseCrowdPresentation(json: unknown): CrowdPresentation | null {
  if (json === undefined || json === null) return null;
  if (!isObj(json) || json.version !== CROWD_PRESENTATION_VERSION) throw new Error('Crowd presentation has an unknown version.');
  const kits = json.kits, rest = json.rest, clips = json.clips;
  if (!isObj(kits) || !Array.isArray(rest) || !isObj(clips)) throw new Error('Crowd presentation needs kits, rest and clips.');
  const kitOut: Record<string, string> = {};
  for (const [k, path] of Object.entries(kits)) {
    if (!NAME.test(k) || typeof path !== 'string' || !/^crowd-v1\/props\/[a-z0-9-]+\.glb$/.test(path)) throw new Error(`Crowd presentation kit ${k} has an invalid file.`);
    kitOut[k] = path;
  }
  const known = (p: CrowdPropPlacement) => { if (!kitOut[p.kit]) throw new Error(`Crowd presentation prop ${p.prop} names kit ${p.kit} without a file.`); return p; };
  const restOut = rest.map((p, i) => known(placement(p, `rest[${i}]`, true)));
  const clipOut: Record<string, CrowdClipPresentation> = {};
  for (const [name, c] of Object.entries(clips)) {
    if (!/^[a-z][a-z0-9_]*$/.test(name) || !isObj(c) || !Array.isArray(c.held) || !Array.isArray(c.placed) || !Array.isArray(c.hidesRest)) throw new Error(`Crowd presentation clip ${name} is invalid.`);
    clipOut[name] = Object.freeze({
      held: Object.freeze(c.held.map((p, i) => known(placement(p, `${name}.held[${i}]`, true)))),
      placed: Object.freeze(c.placed.map((p, i) => known(placement(p, `${name}.placed[${i}]`, false)))),
      hidesRest: Object.freeze(c.hidesRest.map(h => { if (typeof h !== 'string' || !NAME.test(h)) throw new Error(`Crowd presentation clip ${name} hides an invalid prop.`); return h; })),
    });
  }
  return Object.freeze({ version: CROWD_PRESENTATION_VERSION, kits: Object.freeze(kitOut), rest: Object.freeze(restOut), clips: Object.freeze(clipOut) });
}

/** Reads a resident JSON's `envelopes` and `envelopeGate`; null when absent. */
export function parseCrowdPublishedEnvelopes(envelopes: unknown, gate: unknown): CrowdPublishedEnvelopes | null {
  if (envelopes === undefined || envelopes === null) return null;
  if (!isObj(envelopes)) throw new Error('Crowd envelopes must be an object.');
  const out: Record<string, CrowdEnvelopeJson> = {};
  for (const [name, e] of Object.entries(envelopes)) {
    if (!/^[a-z][a-z0-9_]*$/.test(name) || !isObj(e) || !Array.isArray(e.min) || !Array.isArray(e.max) || e.min.length !== 3 || e.max.length !== 3) throw new Error(`Crowd envelope ${name} is invalid.`);
    const min = e.min as number[], max = e.max as number[];
    if (![...min, ...max].every(v => typeof v === 'number' && Number.isFinite(v)) || !min.every((v, i) => v < max[i])) throw new Error(`Crowd envelope ${name} must be a finite box.`);
    out[name] = Object.freeze({ min: Object.freeze([min[0], min[1], min[2]]) as unknown as readonly [number, number, number], max: Object.freeze([max[0], max[1], max[2]]) as unknown as readonly [number, number, number] });
  }
  return Object.freeze({ byClip: Object.freeze(out), gated: isObj(gate) && gate.pass === true });
}

/**
 * Every clip a resident's presenter may plan (the publisher writes presentation and envelopes for these): idle, talk and
 * walk with the walk's start and stop, every role clip with its enter and exit (walk-like role clips without them), and
 * the seated set. Only names the library has.
 */
export function crowdPresentationClipNames(motion: { readonly idle: string; readonly talk: string; readonly walk: string; readonly roleClips: readonly string[] },
  library: ReadonlySet<string>, clipSpec: (name: string) => { readonly kind: string; readonly travels?: true } | null): readonly string[] {
  const out: string[] = [];
  const add = (n: string) => { if (library.has(n) && out.indexOf(n) < 0) out.push(n); };
  add(motion.idle); add(motion.talk); add(motion.walk);
  add(motion.walk === 'walk' ? 'walk_start' : `${motion.walk}_start`); add(motion.walk === 'walk' ? 'walk_stop' : `${motion.walk}_stop`);
  for (const r of motion.roleClips) {
    add(r);
    const spec = clipSpec(r);
    const walkLike = r === 'guard_patrol_walk' || !!spec?.travels || spec?.kind === 'carry' || spec?.kind === 'locomotion';
    if (!walkLike) { add(`${r}_enter`); add(`${r}_exit`); }
  }
  add('sit'); add('sit_down'); add('stand_up');
  return out;
}

/** Attachments of one actor set and which of them show for each planned owner motion. */
export interface CrowdPropPlan {
  /** Unique attachments (rest props first). */
  readonly attachments: readonly CrowdPropPlacement[];
  /** Per planned owner motion: indices of `attachments` visible while it plays. */
  readonly visible: Readonly<Partial<Record<CrowdOwnerMotion, readonly number[]>>>;
  /** Kit ids the attachments need. */
  readonly kits: readonly string[];
}

const key = (p: CrowdPropPlacement) => `${p.kit}|${p.node}|${p.bone ?? '-'}|${p.matrix.join(',')}`;

/**
 * The prop plan of one clip plan: rest props, and for every planned motion the held and placed props of its clip. Work
 * enter and exit also show the work loop's placed props (the resident steps up to its workplace), sit down and stand up
 * show their stool. A rest prop is hidden while the playing clip holds the same prop or lists it in `hidesRest`.
 */
export function planCrowdProps(presentation: CrowdPresentation | null, plan: CrowdClipPlan): CrowdPropPlan {
  const attachments: CrowdPropPlacement[] = [], index = new Map<string, number>();
  const add = (p: CrowdPropPlacement) => { const k = key(p); let i = index.get(k); if (i === undefined) { i = attachments.length; attachments.push(p); index.set(k, i); } return i; };
  const visible: Partial<Record<CrowdOwnerMotion, readonly number[]>> = {};
  if (!presentation) return Object.freeze({ attachments: Object.freeze([]), visible: Object.freeze({}), kits: Object.freeze([]) });
  const rest = presentation.rest.map(add);
  const workClip = plan.clips.work ? presentation.clips[plan.clips.work] : undefined;
  for (const [motion, name] of Object.entries(plan.clips) as [CrowdOwnerMotion, string][]) {
    const c = presentation.clips[name];
    const shown: number[] = [];
    const heldProps = new Set<string>();
    for (const p of c?.held ?? []) { shown.push(add(p)); heldProps.add(p.prop); }
    for (const p of c?.placed ?? []) shown.push(add(p));
    if ((motion === 'workEnter' || motion === 'workExit') && workClip) for (const p of workClip.placed) { const i = add(p); if (shown.indexOf(i) < 0) shown.push(i); }
    const hides = new Set(c?.hidesRest ?? []);
    presentation.rest.forEach((p, k) => { if (!heldProps.has(p.prop) && !hides.has(p.prop)) shown.push(rest[k]); });
    visible[motion] = Object.freeze(shown.sort((a, b) => a - b));
  }
  const kits = [...new Set(attachments.map(a => a.kit))].sort();
  return Object.freeze({ attachments: Object.freeze(attachments), visible: Object.freeze(visible), kits: Object.freeze(kits) });
}
