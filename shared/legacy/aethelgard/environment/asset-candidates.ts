/**
 * Ealdholt environment asset candidates: licence and fit vetting, metadata only.
 *
 * The creator asked for the House Ealdholt environment to draw on Poly Haven's
 * CC0 collections "A Verdant Trail" (verdant_trail) and "Namaqualand"
 * (namaqualand), five Hugging Face dataset re-uploads and one GitHub
 * repository. This module records what each source is, its licence as stated
 * and as verified at the original publisher, and an assessment of every asset
 * in both Poly Haven collections against an environment role.
 *
 * WORKING PLACEHOLDER. Roles, recommendations, reasons and the licence policy
 * are working assessments pending creator approval: not canon, not final art
 * direction. Nothing here is integrated. This module downloads, loads and
 * renders nothing, and no asset file was added to the repository. A
 * 'recommended' entry has passed licence and fit review on paper only; it has
 * not been rendered, measured or checked on a headset.
 *
 * Recommendation levels:
 * - 'recommended': licence-clean and on theme; needs only the standard intake
 *   in docs/legacy/environment/ASSET_SOURCES_2026-11.md (1024 px Desktop and
 *   512 px Quest textures, quantisation-only gltfpack, simplified Quest levels,
 *   provenance JSON) followed by the usual review captures.
 * - 'conditional': usable only after the condition named in its reason, such
 *   as a comparison capture, a re-authored Quest version or a creator decision.
 * - 'rejected': do not use for this role.
 *
 * Facts were read live on 2026-11-06; the plan document lists what was and was
 * not verified. Pure data plus a strict validator: no fetch, clock, randomness,
 * storage or renderer.
 */
import { placeDataArray, placeDataRecord, placeId } from '../place-use';

/** The day every fact below was read from its live source. */
export const EALDHOLT_ASSET_VERIFIED_ON = '2026-11-06' as const;
export type EaldholtAssetVerifiedOn = typeof EALDHOLT_ASSET_VERIFIED_ON;

export type EaldholtAssetRole =
  | 'meadow-grass-cover'
  | 'shrubs-undergrowth'
  | 'trees-deadwood'
  | 'boulders-lichen-rock'
  | 'ground-path-materials'
  | 'riverbank-sand-gravel'
  | 'sky-hdri';

export const EALDHOLT_ASSET_ROLES: readonly EaldholtAssetRole[] = Object.freeze([
  'meadow-grass-cover',
  'shrubs-undergrowth',
  'trees-deadwood',
  'boulders-lichen-rock',
  'ground-path-materials',
  'riverbank-sand-gravel',
  'sky-hdri',
] as const);

/**
 * What each role covers. Descriptive scope only: where anything is placed
 * follows the creator's private working map, never this manifest.
 */
export const EALDHOLT_ASSET_ROLE_SCOPE: Readonly<Record<EaldholtAssetRole, string>> = Object.freeze({
  'meadow-grass-cover': 'Grass ground and low flowering cover for meadows, verges and fallow ground.',
  'shrubs-undergrowth': 'Low shrubs and undergrowth for banks, woodland edges and slopes.',
  'trees-deadwood': 'Trees, fallen logs, roots and branches for the woodland floor and banks.',
  'boulders-lichen-rock': 'Boulders, fieldstone and lichened rock surfaces for outcrops and crags.',
  'ground-path-materials': 'Earth, trodden paths and yard ground.',
  'riverbank-sand-gravel': 'Sand and gravel for river banks, shallows and shore strips.',
  'sky-hdri': 'Sky and image-based light for the late-afternoon cold-upland atmosphere in '
    + 'NATION_AETHELGARD.md: a low sun from the south-west (bearing 235°, elevation 14°) under a broken '
    + 'cloud ceiling, with mist along the river.',
});

export type EaldholtLicenceId =
  | 'CC0-1.0'
  | 'CC-BY-4.0'
  | 'CC-BY-NC-4.0'
  | 'Apache-2.0'
  | 'MIT'
  | 'BSD-2-Clause'
  | 'BSD-3-Clause'
  | 'BSD-3-Clause-Clear'
  | 'per-model'
  | 'unknown';

export const EALDHOLT_LICENCE_IDS: readonly EaldholtLicenceId[] = Object.freeze([
  'CC0-1.0', 'CC-BY-4.0', 'CC-BY-NC-4.0', 'Apache-2.0', 'MIT', 'BSD-2-Clause', 'BSD-3-Clause',
  'BSD-3-Clause-Clear', 'per-model', 'unknown',
] as const);

/**
 * Licences an asset may carry and still be 'recommended'. WORKING POLICY
 * pending creator confirmation: CC0, and CC BY 4.0 with its attribution
 * recorded. Non-commercial, per-model, software-licensed and unknown terms are
 * never recommended. The validator reads this constant, never the input data.
 */
export const EALDHOLT_RECOMMENDABLE_LICENCES: readonly EaldholtLicenceId[] = Object.freeze(['CC0-1.0', 'CC-BY-4.0'] as const);

/** Licences that forbid commercial use. */
const NON_COMMERCIAL_LICENCES: readonly EaldholtLicenceId[] = Object.freeze(['CC-BY-NC-4.0'] as const);

/** Licences whose terms require credit or notice retention. */
const NOTICE_LICENCES: readonly EaldholtLicenceId[] = Object.freeze([
  'CC-BY-4.0', 'CC-BY-NC-4.0', 'Apache-2.0', 'MIT', 'BSD-2-Clause', 'BSD-3-Clause', 'BSD-3-Clause-Clear',
] as const);

export type EaldholtAssetRecommendation = 'recommended' | 'conditional' | 'rejected';
const RECOMMENDATIONS: readonly EaldholtAssetRecommendation[] = Object.freeze(['recommended', 'conditional', 'rejected'] as const);

export type EaldholtAssetSourceId =
  | 'polyhaven-verdant-trail'
  | 'polyhaven-namaqualand'
  | 'hf-codepawl-simready-glb'
  | 'hf-codepawl-abo-glb'
  | 'hf-codepawl-ct-anatomy-glb'
  | 'hf-codepawl-menagerie-glb'
  | 'hf-codepawl-scanned-objects-glb'
  | 'github-codepawl-spume';

const SOURCE_IDS: readonly EaldholtAssetSourceId[] = Object.freeze([
  'polyhaven-verdant-trail',
  'polyhaven-namaqualand',
  'hf-codepawl-simready-glb',
  'hf-codepawl-abo-glb',
  'hf-codepawl-ct-anatomy-glb',
  'hf-codepawl-menagerie-glb',
  'hf-codepawl-scanned-objects-glb',
  'github-codepawl-spume',
] as const);

export type EaldholtAssetSourceKind = 'polyhaven-collection' | 'dataset-reupload' | 'tool-repository';
const SOURCE_KINDS: readonly EaldholtAssetSourceKind[] = Object.freeze(['polyhaven-collection', 'dataset-reupload', 'tool-repository'] as const);

export type EaldholtThematicFit = 'close' | 'partial' | 'off-theme' | 'not-an-asset';
const THEMATIC_FITS: readonly EaldholtThematicFit[] = Object.freeze(['close', 'partial', 'off-theme', 'not-an-asset'] as const);

/** One listed source and its licence-risk findings. */
export interface EaldholtAssetSource {
  readonly id: EaldholtAssetSourceId;
  readonly kind: EaldholtAssetSourceKind;
  /** The title the source publishes. */
  readonly title: string;
  readonly url: string;
  /** Immutable revision read on the verification day, where the host exposes one. */
  readonly revision: string | null;
  /** The licence the distributor states. */
  readonly statedLicence: EaldholtLicenceId;
  /** The licence found at the original publisher. */
  readonly upstreamLicence: EaldholtLicenceId;
  readonly upstreamLicenceVerified: boolean;
  /** The original publisher and where its terms were read. */
  readonly upstream: string;
  /** What was read to verify the upstream licence, and how far it reaches. */
  readonly upstreamEvidence: string;
  readonly nonCommercial: boolean;
  readonly attributionRequired: boolean;
  /** Required credit or notice; null when the licence requires none. */
  readonly attribution: string | null;
  /** Risks other than the licence itself: trademarks, sensitive data, formats. */
  readonly risks: readonly string[];
  readonly thematicFit: EaldholtThematicFit;
  readonly recommendation: EaldholtAssetRecommendation;
  readonly reason: string;
  readonly verifiedOn: EaldholtAssetVerifiedOn;
}

/** The asset ids a Poly Haven collection listed on the verification day. */
export interface EaldholtCollectionSnapshot {
  readonly source: EaldholtAssetSourceId;
  /** The collection id in the Poly Haven API. */
  readonly collectionId: string;
  readonly name: string;
  readonly datePublished: string;
  readonly api: string;
  /** In the order the API listed them. */
  readonly assetIds: readonly string[];
}

/** An asset the Ealdholt environment already uses: a reference point, never a candidate. */
export interface EaldholtInUseAsset {
  readonly assetId: string;
  readonly role: EaldholtAssetRole;
  readonly sourceUrl: string;
  readonly licence: EaldholtLicenceId;
  /** Repository path of its committed provenance record. */
  readonly provenance: string;
  readonly note: string;
}

export type EaldholtAlphaMode = 'OPAQUE' | 'MASK' | 'BLEND';
const ALPHA_MODES: readonly EaldholtAlphaMode[] = Object.freeze(['OPAQUE', 'MASK', 'BLEND'] as const);

export interface EaldholtModelFacts {
  readonly kind: 'model';
  /** Triangles counted from the index accessors of the published 1k glTF: one mesh per variant, no LOD levels. */
  readonly gltfTriangles: number;
  /** Mesh variants in that glTF. */
  readonly gltfMeshes: number;
  /** Distinct alpha modes of its materials. */
  readonly alphaModes: readonly EaldholtAlphaMode[];
}

export interface EaldholtTextureFacts {
  readonly kind: 'texture';
  /** Physical tile edge in metres, from the API's dimensions in millimetres. */
  readonly tileMetres: number;
}

export type EaldholtHdriTimeOfDay = 'sunrise' | 'morning' | 'midday' | 'afternoon' | 'sunset' | 'night';
export type EaldholtHdriWeather = 'clear' | 'partly_cloudy' | 'overcast' | 'fog';
export type EaldholtHdriContrast = 'low' | 'medium' | 'high';
const TIMES_OF_DAY: readonly EaldholtHdriTimeOfDay[] = Object.freeze(['sunrise', 'morning', 'midday', 'afternoon', 'sunset', 'night'] as const);
const WEATHERS: readonly EaldholtHdriWeather[] = Object.freeze(['clear', 'partly_cloudy', 'overcast', 'fog'] as const);
const CONTRASTS: readonly EaldholtHdriContrast[] = Object.freeze(['low', 'medium', 'high'] as const);

export interface EaldholtHdriFacts {
  readonly kind: 'hdri';
  /** The API's own capture attributes. */
  readonly timeOfDay: EaldholtHdriTimeOfDay;
  readonly weather: EaldholtHdriWeather;
  readonly contrast: EaldholtHdriContrast;
  /**
   * Rough sun elevation in degrees, from the brightest region of the published
   * 1600 × 800 tonemapped preview. An estimate, not a measurement. null when
   * that region is not the sun (overcast, dawn) or the preview was not inspected.
   */
  readonly sunElevationEstimateDegrees: number | null;
}

export type EaldholtAssetFacts = EaldholtModelFacts | EaldholtTextureFacts | EaldholtHdriFacts;

export interface EaldholtAssetCandidate {
  /** Manifest id: `polyhaven:<assetId>` for Poly Haven assets. */
  readonly id: string;
  readonly source: EaldholtAssetSourceId;
  /** The asset id at the source. */
  readonly assetId: string;
  /** The name the source publishes. */
  readonly name: string;
  readonly role: EaldholtAssetRole;
  readonly sourceUrl: string;
  readonly licence: EaldholtLicenceId;
  readonly upstreamLicenceVerified: boolean;
  readonly nonCommercial: boolean;
  readonly attributionRequired: boolean;
  readonly attribution: string | null;
  /** Credited creators as the source lists them (credit appreciated even when not required). */
  readonly authors: readonly string[];
  readonly verifiedOn: EaldholtAssetVerifiedOn;
  readonly facts: EaldholtAssetFacts;
  readonly suitability: string;
  readonly recommendation: EaldholtAssetRecommendation;
  readonly reason: string;
  /** Only 'candidate' exists: integration is a separate, reviewed step. */
  readonly status: 'candidate';
}

export interface EaldholtAssetCandidateManifest {
  readonly schema: 1;
  /** Every assessment awaits creator approval. */
  readonly status: 'working-placeholder';
  readonly snapshotDate: EaldholtAssetVerifiedOn;
  readonly collections: readonly EaldholtCollectionSnapshot[];
  readonly sources: readonly EaldholtAssetSource[];
  readonly inUse: readonly EaldholtInUseAsset[];
  readonly candidates: readonly EaldholtAssetCandidate[];
}

export type EaldholtAssetManifestResult =
  | { readonly ok: true; readonly manifest: EaldholtAssetCandidateManifest }
  | { readonly ok: false; readonly error: string };

/**
 * Strictly validate untrusted manifest data and return a new, deeply frozen
 * copy. Plain data only: accessors, custom prototypes, extra or missing fields
 * and sparse arrays are refused without being invoked. Input order is kept and
 * the input is never changed or frozen. Errors name the failing field path.
 */
export function validateAssetCandidates(input: unknown): EaldholtAssetManifestResult {
  try {
    const result: EaldholtAssetManifestResult = { ok: true, manifest: parseManifest(input) };
    return Object.freeze(result);
  } catch (cause) {
    const error = cause instanceof Error ? cause.message : 'Invalid asset candidate manifest.';
    return Object.freeze({ ok: false as const, error });
  }
}

// ---------------------------------------------------------------------------
// Strict readers. Each restates place-use's generic errors with a field path.

const SHORT_TEXT = 200;
const LONG_TEXT = 900;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;
const HTTPS_URL = /^https:\/\/[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i;
const REVISION = /^[0-9a-f]{40}$/;
const REPOSITORY_PATH = /^[A-Za-z0-9][A-Za-z0-9 ._/-]*$/;

function problem(path: string, message: string): Error {
  return Error(`${path}: ${message}`);
}

/** Exact keys, enumerable data properties only: no accessor, prototype or hook is invoked. */
function exact(value: unknown, path: string, keys: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  let record: Record<string, unknown>;
  try {
    record = placeDataRecord(value, keys, optional);
  } catch {
    throw problem(path, `expected plain data with the fields ${keys.join(', ')}`);
  }
  // placeDataRecord has already refused accessors, symbols and unknown keys.
  for (const key of Reflect.ownKeys(record)) {
    if (!Object.prototype.propertyIsEnumerable.call(record, key)) throw problem(path, 'every field must be an enumerable data property');
  }
  return record;
}

/** A copy of a dense plain array, so each element is read once and the values checked are the values kept. */
function entries(value: unknown, path: string, min: number, max: number): unknown[] {
  let list: readonly unknown[];
  try {
    list = placeDataArray(value);
  } catch {
    throw problem(path, 'expected a dense plain array');
  }
  if (list.length < min || list.length > max) throw problem(path, `expected ${min} to ${max} entries`);
  return list.slice();
}

function text(value: unknown, path: string, max: number): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > max || value.trim() !== value || CONTROL_CHARACTERS.test(value)) {
    throw problem(path, `expected trimmed single-line text of 1 to ${max} characters`);
  }
  return value;
}

function identifier(value: unknown, path: string): string {
  try {
    return placeId(value);
  } catch {
    throw problem(path, 'expected an identifier of letters, digits and . _ : -');
  }
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], path: string): T {
  if (typeof value !== 'string' || allowed.indexOf(value as T) === -1) throw problem(path, `expected one of ${allowed.join(', ')}`);
  return value as T;
}

function flag(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') throw problem(path, 'expected true or false');
  return value;
}

function httpsUrl(value: unknown, path: string): string {
  const url = text(value, path, 300);
  if (!HTTPS_URL.test(url)) throw problem(path, 'expected an https URL');
  return url;
}

function count(value: unknown, path: string, max: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > max) throw problem(path, `expected an integer from 1 to ${max}`);
  return value;
}

function measure(value: unknown, path: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw problem(path, `expected a finite number from ${min} to ${max}`);
  return value;
}

/** A calendar date as YYYY-MM-DD, checked without any clock. */
function isoDate(value: unknown, path: string): string {
  const date = text(value, path, 10);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) throw problem(path, 'expected a date as YYYY-MM-DD');
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12 || day < 1 || day > days[month - 1]) throw problem(path, 'expected a real calendar date');
  return date;
}

function verifiedOn(value: unknown, path: string): EaldholtAssetVerifiedOn {
  if (isoDate(value, path) !== EALDHOLT_ASSET_VERIFIED_ON) throw problem(path, `expected ${EALDHOLT_ASSET_VERIFIED_ON}, the day these facts were read`);
  return EALDHOLT_ASSET_VERIFIED_ON;
}

function nullableText(value: unknown, path: string, max: number): string | null {
  return value === null ? null : text(value, path, max);
}

function distinct(values: readonly string[], path: string, what: string): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) throw problem(path, `duplicate ${what} ${value}`);
    seen.add(value);
  }
}

function textList(value: unknown, path: string, min: number, max: number, maxLength: number): readonly string[] {
  const list = entries(value, path, min, max).map((item, index) => text(item, `${path}[${index}]`, maxLength));
  distinct(list, path, 'entry');
  return Object.freeze(list);
}

interface LicenceTerms {
  readonly licence: EaldholtLicenceId;
  readonly upstreamLicenceVerified: boolean;
  readonly nonCommercial: boolean;
  readonly attributionRequired: boolean;
  readonly attribution: string | null;
  readonly recommendation: EaldholtAssetRecommendation;
}

/** The licence rules shared by sources and candidates. */
function checkLicenceTerms(terms: LicenceTerms, path: string): void {
  if (NON_COMMERCIAL_LICENCES.indexOf(terms.licence) !== -1 && !terms.nonCommercial) {
    throw problem(`${path}.nonCommercial`, `${terms.licence} forbids commercial use and must be flagged non-commercial`);
  }
  if (NOTICE_LICENCES.indexOf(terms.licence) !== -1 && !terms.attributionRequired) {
    throw problem(`${path}.attributionRequired`, `${terms.licence} requires attribution`);
  }
  if (terms.attributionRequired && terms.attribution === null) {
    throw problem(`${path}.attribution`, 'attribution text must be recorded when attribution is required');
  }
  if (!terms.attributionRequired && terms.attribution !== null) {
    throw problem(`${path}.attribution`, 'attribution text is recorded only when the licence requires it');
  }
  if (terms.recommendation !== 'recommended') return;
  if (EALDHOLT_RECOMMENDABLE_LICENCES.indexOf(terms.licence) === -1) {
    throw problem(`${path}.recommendation`, `${terms.licence} is not a licence that may be recommended`);
  }
  if (!terms.upstreamLicenceVerified) {
    throw problem(`${path}.recommendation`, 'an entry whose upstream licence is unverified cannot be recommended');
  }
  if (terms.nonCommercial) throw problem(`${path}.recommendation`, 'a non-commercial entry cannot be recommended');
}

// ---------------------------------------------------------------------------
// Section parsers.

const SOURCE_FIELDS = Object.freeze([
  'id', 'kind', 'title', 'url', 'revision', 'statedLicence', 'upstreamLicence', 'upstreamLicenceVerified', 'upstream',
  'upstreamEvidence', 'nonCommercial', 'attributionRequired', 'attribution', 'risks', 'thematicFit', 'recommendation',
  'reason', 'verifiedOn',
]);

function parseSource(value: unknown, path: string): EaldholtAssetSource {
  const record = exact(value, path, SOURCE_FIELDS);
  const revision = record.revision;
  if (revision !== null && (typeof revision !== 'string' || !REVISION.test(revision))) {
    throw problem(`${path}.revision`, 'expected null or a 40-character hexadecimal revision');
  }
  const source: EaldholtAssetSource = {
    id: oneOf(record.id, SOURCE_IDS, `${path}.id`),
    kind: oneOf(record.kind, SOURCE_KINDS, `${path}.kind`),
    title: text(record.title, `${path}.title`, SHORT_TEXT),
    url: httpsUrl(record.url, `${path}.url`),
    revision: revision as string | null,
    statedLicence: oneOf(record.statedLicence, EALDHOLT_LICENCE_IDS, `${path}.statedLicence`),
    upstreamLicence: oneOf(record.upstreamLicence, EALDHOLT_LICENCE_IDS, `${path}.upstreamLicence`),
    upstreamLicenceVerified: flag(record.upstreamLicenceVerified, `${path}.upstreamLicenceVerified`),
    upstream: text(record.upstream, `${path}.upstream`, LONG_TEXT),
    upstreamEvidence: text(record.upstreamEvidence, `${path}.upstreamEvidence`, LONG_TEXT),
    nonCommercial: flag(record.nonCommercial, `${path}.nonCommercial`),
    attributionRequired: flag(record.attributionRequired, `${path}.attributionRequired`),
    attribution: nullableText(record.attribution, `${path}.attribution`, LONG_TEXT),
    risks: textList(record.risks, `${path}.risks`, 0, 12, LONG_TEXT),
    thematicFit: oneOf(record.thematicFit, THEMATIC_FITS, `${path}.thematicFit`),
    recommendation: oneOf(record.recommendation, RECOMMENDATIONS, `${path}.recommendation`),
    reason: text(record.reason, `${path}.reason`, LONG_TEXT),
    verifiedOn: verifiedOn(record.verifiedOn, `${path}.verifiedOn`),
  };
  checkLicenceTerms({ ...source, licence: source.upstreamLicence }, path);
  if (source.recommendation === 'recommended') {
    if (source.statedLicence !== source.upstreamLicence) {
      throw problem(`${path}.recommendation`, 'a source whose stated licence differs from its upstream licence cannot be recommended');
    }
    if (source.thematicFit !== 'close' && source.thematicFit !== 'partial') {
      throw problem(`${path}.recommendation`, `a source rated ${source.thematicFit} cannot be recommended`);
    }
  }
  return Object.freeze(source);
}

const COLLECTION_FIELDS = Object.freeze(['source', 'collectionId', 'name', 'datePublished', 'api', 'assetIds']);

function parseCollection(value: unknown, path: string): EaldholtCollectionSnapshot {
  const record = exact(value, path, COLLECTION_FIELDS);
  const assetIds = entries(record.assetIds, `${path}.assetIds`, 1, 200).map((item, index) => identifier(item, `${path}.assetIds[${index}]`));
  distinct(assetIds, `${path}.assetIds`, 'asset id');
  return Object.freeze({
    source: oneOf(record.source, SOURCE_IDS, `${path}.source`),
    collectionId: identifier(record.collectionId, `${path}.collectionId`),
    name: text(record.name, `${path}.name`, SHORT_TEXT),
    datePublished: isoDate(record.datePublished, `${path}.datePublished`),
    api: httpsUrl(record.api, `${path}.api`),
    assetIds: Object.freeze(assetIds),
  });
}

const IN_USE_FIELDS = Object.freeze(['assetId', 'role', 'sourceUrl', 'licence', 'provenance', 'note']);

function parseInUse(value: unknown, path: string): EaldholtInUseAsset {
  const record = exact(value, path, IN_USE_FIELDS);
  const provenance = text(record.provenance, `${path}.provenance`, 300);
  if (!REPOSITORY_PATH.test(provenance) || provenance.split('/').some(part => part === '..' || part === '.' || part === '')) {
    throw problem(`${path}.provenance`, 'expected a relative repository path');
  }
  return Object.freeze({
    assetId: identifier(record.assetId, `${path}.assetId`),
    role: oneOf(record.role, EALDHOLT_ASSET_ROLES, `${path}.role`),
    sourceUrl: httpsUrl(record.sourceUrl, `${path}.sourceUrl`),
    licence: oneOf(record.licence, EALDHOLT_LICENCE_IDS, `${path}.licence`),
    provenance,
    note: text(record.note, `${path}.note`, LONG_TEXT),
  });
}

const FACT_FIELDS: Readonly<Record<EaldholtAssetFacts['kind'], readonly string[]>> = Object.freeze({
  model: Object.freeze(['kind', 'gltfTriangles', 'gltfMeshes', 'alphaModes']),
  texture: Object.freeze(['kind', 'tileMetres']),
  hdri: Object.freeze(['kind', 'timeOfDay', 'weather', 'contrast', 'sunElevationEstimateDegrees']),
});
const FACT_KINDS: readonly EaldholtAssetFacts['kind'][] = Object.freeze(['model', 'texture', 'hdri'] as const);
const ANY_FACT_FIELD = Object.freeze(['gltfTriangles', 'gltfMeshes', 'alphaModes', 'tileMetres', 'timeOfDay', 'weather',
  'contrast', 'sunElevationEstimateDegrees']);

function parseFacts(value: unknown, path: string): EaldholtAssetFacts {
  // Read the discriminant only after the descriptor check, then demand that kind's exact fields.
  const loose = exact(value, path, ['kind'], ANY_FACT_FIELD);
  const kind = oneOf(loose.kind, FACT_KINDS, `${path}.kind`);
  const record = exact(value, path, FACT_FIELDS[kind]);
  if (kind === 'model') {
    const alphaModes = entries(record.alphaModes, `${path}.alphaModes`, 1, ALPHA_MODES.length)
      .map((item, index) => oneOf(item, ALPHA_MODES, `${path}.alphaModes[${index}]`));
    distinct(alphaModes, `${path}.alphaModes`, 'alpha mode');
    return Object.freeze({
      kind,
      gltfTriangles: count(record.gltfTriangles, `${path}.gltfTriangles`, 50000000),
      gltfMeshes: count(record.gltfMeshes, `${path}.gltfMeshes`, 1000),
      alphaModes: Object.freeze(alphaModes),
    });
  }
  if (kind === 'texture') {
    return Object.freeze({ kind, tileMetres: measure(record.tileMetres, `${path}.tileMetres`, 0.01, 1000) });
  }
  const sun = record.sunElevationEstimateDegrees;
  return Object.freeze({
    kind,
    timeOfDay: oneOf(record.timeOfDay, TIMES_OF_DAY, `${path}.timeOfDay`),
    weather: oneOf(record.weather, WEATHERS, `${path}.weather`),
    contrast: oneOf(record.contrast, CONTRASTS, `${path}.contrast`),
    sunElevationEstimateDegrees: sun === null ? null : measure(sun, `${path}.sunElevationEstimateDegrees`, -90, 90),
  });
}

const CANDIDATE_FIELDS = Object.freeze([
  'id', 'source', 'assetId', 'name', 'role', 'sourceUrl', 'licence', 'upstreamLicenceVerified', 'nonCommercial',
  'attributionRequired', 'attribution', 'authors', 'verifiedOn', 'facts', 'suitability', 'recommendation', 'reason', 'status',
]);

function parseCandidate(value: unknown, path: string): EaldholtAssetCandidate {
  const record = exact(value, path, CANDIDATE_FIELDS);
  if (record.status !== 'candidate') {
    throw problem(`${path}.status`, "expected 'candidate': nothing in this manifest is integrated");
  }
  const candidate: EaldholtAssetCandidate = {
    id: identifier(record.id, `${path}.id`),
    source: oneOf(record.source, SOURCE_IDS, `${path}.source`),
    assetId: identifier(record.assetId, `${path}.assetId`),
    name: text(record.name, `${path}.name`, SHORT_TEXT),
    role: oneOf(record.role, EALDHOLT_ASSET_ROLES, `${path}.role`),
    sourceUrl: httpsUrl(record.sourceUrl, `${path}.sourceUrl`),
    licence: oneOf(record.licence, EALDHOLT_LICENCE_IDS, `${path}.licence`),
    upstreamLicenceVerified: flag(record.upstreamLicenceVerified, `${path}.upstreamLicenceVerified`),
    nonCommercial: flag(record.nonCommercial, `${path}.nonCommercial`),
    attributionRequired: flag(record.attributionRequired, `${path}.attributionRequired`),
    attribution: nullableText(record.attribution, `${path}.attribution`, LONG_TEXT),
    authors: textList(record.authors, `${path}.authors`, 1, 8, SHORT_TEXT),
    verifiedOn: verifiedOn(record.verifiedOn, `${path}.verifiedOn`),
    facts: parseFacts(record.facts, `${path}.facts`),
    suitability: text(record.suitability, `${path}.suitability`, LONG_TEXT),
    recommendation: oneOf(record.recommendation, RECOMMENDATIONS, `${path}.recommendation`),
    reason: text(record.reason, `${path}.reason`, LONG_TEXT),
    status: 'candidate',
  };
  checkLicenceTerms(candidate, path);
  if ((candidate.role === 'sky-hdri') !== (candidate.facts.kind === 'hdri')) {
    throw problem(`${path}.role`, 'sky-hdri is the role for HDRIs, and HDRIs fill only that role');
  }
  return Object.freeze(candidate);
}

/** Cross-references a candidate can only be checked against once every section is parsed. */
function checkCandidateReferences(
  candidate: EaldholtAssetCandidate,
  path: string,
  source: EaldholtAssetSource | undefined,
  snapshot: EaldholtCollectionSnapshot | undefined,
  inUseIds: ReadonlySet<string>,
): void {
  if (!source) throw problem(`${path}.source`, `no source record for ${candidate.source}`);
  if (source.kind === 'tool-repository') throw problem(`${path}.source`, 'a tool repository supplies no asset candidates');
  if (candidate.licence !== source.upstreamLicence) {
    throw problem(`${path}.licence`, `must match the source's upstream licence, ${source.upstreamLicence}`);
  }
  if (candidate.upstreamLicenceVerified && !source.upstreamLicenceVerified) {
    throw problem(`${path}.upstreamLicenceVerified`, 'cannot be verified beyond its source');
  }
  if (source.kind === 'polyhaven-collection') {
    if (!snapshot || snapshot.assetIds.indexOf(candidate.assetId) === -1) {
      throw problem(`${path}.assetId`, `${candidate.assetId} is not listed in the recorded ${source.title} collection snapshot`);
    }
    if (candidate.sourceUrl !== `https://polyhaven.com/a/${candidate.assetId}`) {
      throw problem(`${path}.sourceUrl`, 'expected the Poly Haven asset page for this asset id');
    }
    if (candidate.id !== `polyhaven:${candidate.assetId}`) {
      throw problem(`${path}.id`, `expected polyhaven:${candidate.assetId}`);
    }
  }
  if (inUseIds.has(candidate.assetId)) {
    throw problem(`${path}.assetId`, `${candidate.assetId} is already in use; in-use assets are reference points, not candidates`);
  }
  if (candidate.recommendation === 'recommended' && source.recommendation === 'rejected') {
    throw problem(`${path}.recommendation`, 'a rejected source cannot supply a recommended asset');
  }
}

const MANIFEST_FIELDS = Object.freeze(['schema', 'status', 'snapshotDate', 'collections', 'sources', 'inUse', 'candidates']);

function parseManifest(value: unknown): EaldholtAssetCandidateManifest {
  const record = exact(value, 'manifest', MANIFEST_FIELDS);
  if (record.schema !== 1) throw problem('manifest.schema', 'expected schema 1');
  if (record.status !== 'working-placeholder') {
    throw problem('manifest.status', "expected 'working-placeholder': these assessments await creator approval");
  }
  verifiedOn(record.snapshotDate, 'manifest.snapshotDate');

  const sources = entries(record.sources, 'manifest.sources', 1, SOURCE_IDS.length)
    .map((item, index) => parseSource(item, `sources[${index}]`));
  distinct(sources.map(source => source.id), 'manifest.sources', 'source id');
  const sourceById = new Map(sources.map(source => [source.id, source] as const));

  const collections = entries(record.collections, 'manifest.collections', 0, 8)
    .map((item, index) => parseCollection(item, `collections[${index}]`));
  distinct(collections.map(snapshot => snapshot.source), 'manifest.collections', 'snapshot for source');
  distinct(collections.map(snapshot => snapshot.collectionId), 'manifest.collections', 'collection id');
  collections.forEach((snapshot, index) => {
    if (sourceById.get(snapshot.source)?.kind !== 'polyhaven-collection') {
      throw problem(`collections[${index}].source`, 'a snapshot must belong to a Poly Haven collection source');
    }
  });
  const snapshotBySource = new Map(collections.map(snapshot => [snapshot.source, snapshot] as const));
  for (const source of sources) {
    if (source.kind === 'polyhaven-collection' && !snapshotBySource.has(source.id)) {
      throw problem('manifest.collections', `missing the asset snapshot for ${source.id}`);
    }
  }

  const inUse = entries(record.inUse, 'manifest.inUse', 0, 64).map((item, index) => parseInUse(item, `inUse[${index}]`));
  distinct(inUse.map(asset => asset.assetId), 'manifest.inUse', 'asset id');
  const inUseIds = new Set(inUse.map(asset => asset.assetId));

  const candidates = entries(record.candidates, 'manifest.candidates', 0, 400)
    .map((item, index) => parseCandidate(item, `candidates[${index}]`));
  distinct(candidates.map(candidate => candidate.id), 'manifest.candidates', 'candidate id');
  distinct(candidates.map(candidate => `${candidate.source} ${candidate.assetId}`), 'manifest.candidates', 'source and asset pair');
  candidates.forEach((candidate, index) => {
    checkCandidateReferences(candidate, `candidates[${index}]`, sourceById.get(candidate.source),
      snapshotBySource.get(candidate.source), inUseIds);
  });

  return Object.freeze({
    schema: 1 as const,
    status: 'working-placeholder' as const,
    snapshotDate: EALDHOLT_ASSET_VERIFIED_ON,
    collections: Object.freeze(collections),
    sources: Object.freeze(sources),
    inUse: Object.freeze(inUse),
    candidates: Object.freeze(candidates),
  });
}

// ---------------------------------------------------------------------------
// Manifest data, read live on 2026-11-06. Poly Haven facts come from
// api.polyhaven.com (collections, info and files endpoints) and the published
// 1k glTF JSON; no texture, mesh or HDR bytes were downloaded.

type PolyHavenSourceId = 'polyhaven-verdant-trail' | 'polyhaven-namaqualand';
type PolyHavenEntry = Pick<EaldholtAssetCandidate,
  'assetId' | 'name' | 'role' | 'authors' | 'facts' | 'suitability' | 'recommendation' | 'reason'>;

/** Poly Haven entries share the CC0 terms verified on the source records below. */
function polyHaven(source: PolyHavenSourceId, entry: PolyHavenEntry): EaldholtAssetCandidate {
  return {
    id: `polyhaven:${entry.assetId}`,
    source,
    assetId: entry.assetId,
    name: entry.name,
    role: entry.role,
    sourceUrl: `https://polyhaven.com/a/${entry.assetId}`,
    licence: 'CC0-1.0',
    upstreamLicenceVerified: true,
    nonCommercial: false,
    attributionRequired: false,
    attribution: null,
    authors: entry.authors,
    verifiedOn: EALDHOLT_ASSET_VERIFIED_ON,
    facts: entry.facts,
    suitability: entry.suitability,
    recommendation: entry.recommendation,
    reason: entry.reason,
    status: 'candidate',
  };
}

function model(gltfTriangles: number, gltfMeshes: number, alphaModes: readonly EaldholtAlphaMode[]): EaldholtModelFacts {
  return { kind: 'model', gltfTriangles, gltfMeshes, alphaModes };
}

function texture(tileMetres: number): EaldholtTextureFacts {
  return { kind: 'texture', tileMetres };
}

function hdri(
  timeOfDay: EaldholtHdriTimeOfDay,
  weather: EaldholtHdriWeather,
  contrast: EaldholtHdriContrast,
  sunElevationEstimateDegrees: number | null,
): EaldholtHdriFacts {
  return { kind: 'hdri', timeOfDay, weather, contrast, sunElevationEstimateDegrees };
}

const POLY_HAVEN_TERMS = 'The licence page (https://polyhaven.com/license) reads "Our assets are all licensed as CC0"; '
  + 'the API terms (Poly-Haven/Public-API ToS.md) confirm that downloaded or self-hosted CC0 assets carry no attribution '
  + 'requirement. Collection listing, per-asset info and file lists read from api.polyhaven.com.';

const POLY_HAVEN_RISKS = [
  'Software that calls the live API must send a unique User-Agent or Referer and show a visible credit; self-hosted copies need neither.',
  'Site content such as preview renders is not CC0 and must not be redistributed.',
];

const VERDANT_TRAIL = 'polyhaven-verdant-trail';
const NAMAQUALAND = 'polyhaven-namaqualand';

const MANIFEST_DATA: EaldholtAssetCandidateManifest = {
  schema: 1,
  status: 'working-placeholder',
  snapshotDate: EALDHOLT_ASSET_VERIFIED_ON,
  collections: [
    {
      source: VERDANT_TRAIL,
      collectionId: 'verdant_trail',
      name: 'A Verdant Trail',
      datePublished: '2024-02-06',
      api: 'https://api.polyhaven.com/collections',
      assetIds: [
        'shrub_01', 'coastal_cliff_02', 'kloofendal_28d_misty', 'dead_tree_trunk_02', 'coast_sand_01', 'boulder_01',
        'shrub_02', 'coastal_cliff_04', 'lichen_rock', 'kloofendal_overcast', 'dry_branches_medium_01',
        'sand_rocks_small_01', 'kloofendal_48d_partly_cloudy', 'root_cluster_02', 'rock_face_03',
      ],
    },
    {
      source: NAMAQUALAND,
      collectionId: 'namaqualand',
      name: 'Namaqualand',
      datePublished: '2024-10-08',
      api: 'https://api.polyhaven.com/collections',
      assetIds: [
        'rogland_moonlit_night', 'dead_quiver_branch_01', 'dry_quiver_leaf', 'othonna_cerarioides',
        'leipoldtia_schultzei', 'quiver_tree_01', 'klippad_dawn_2', 'goegap_road', 'wild_rooibos_bush',
        'bark_debris_01', 'dead_quiver_trunk', 'rock_face', 'namaqualand_boulder_02', 'namaqualand_boulder_03',
        'searsia_lucida',
      ],
    },
  ],
  sources: [
    {
      id: VERDANT_TRAIL,
      kind: 'polyhaven-collection',
      title: 'A Verdant Trail',
      url: 'https://polyhaven.com/collections/verdant_trail',
      revision: null,
      statedLicence: 'CC0-1.0',
      upstreamLicence: 'CC0-1.0',
      upstreamLicenceVerified: true,
      upstream: 'Poly Haven, the original publisher.',
      upstreamEvidence: POLY_HAVEN_TERMS,
      nonCommercial: false,
      attributionRequired: false,
      attribution: null,
      risks: POLY_HAVEN_RISKS,
      thematicFit: 'partial',
      recommendation: 'recommended',
      reason: 'South African grassveld with green shrubs, deadwood and lichened rock: the closer of the two collections to a '
        + 'temperate meadow and woodland edge. Use per asset. It holds no grass ground material, so the canonical leafy_grass stays.',
      verifiedOn: EALDHOLT_ASSET_VERIFIED_ON,
    },
    {
      id: NAMAQUALAND,
      kind: 'polyhaven-collection',
      title: 'Namaqualand',
      url: 'https://polyhaven.com/collections/namaqualand',
      revision: null,
      statedLicence: 'CC0-1.0',
      upstreamLicence: 'CC0-1.0',
      upstreamLicenceVerified: true,
      upstream: 'Poly Haven, the original publisher.',
      upstreamEvidence: POLY_HAVEN_TERMS,
      nonCommercial: false,
      attributionRequired: false,
      attribution: null,
      risks: POLY_HAVEN_RISKS,
      thematicFit: 'partial',
      recommendation: 'conditional',
      reason: 'Arid Karoo scrub and succulents in flower. Selective use only: boulders, rock surfaces and flower accents, '
        + 'each after a comparison capture. Its trees, shrubs, deadwood and night sky are rejected.',
      verifiedOn: EALDHOLT_ASSET_VERIFIED_ON,
    },
    {
      id: 'hf-codepawl-simready-glb',
      kind: 'dataset-reupload',
      title: 'codepawl/simready-glb',
      url: 'https://huggingface.co/datasets/codepawl/simready-glb',
      revision: 'fe284e105db3a58c18f590bf2d7425c968a7bbb1',
      statedLicence: 'CC-BY-4.0',
      upstreamLicence: 'CC-BY-4.0',
      upstreamLicenceVerified: true,
      upstream: 'NVIDIA SimReady assets: https://huggingface.co/datasets/nvidia/simready-assets',
      upstreamEvidence: 'Upstream dataset card and Hub licence tag read cc-by-4.0 at revision '
        + '7879e0e50423290300ac20ecd6e727325f680b60. Two of the 2,595 per-asset .metadata/LICENSE.txt files were sampled; '
        + 'both are the CC BY 4.0 legal code.',
      nonCommercial: false,
      attributionRequired: true,
      attribution: 'NVIDIA SimReady assets, CC BY 4.0 (https://huggingface.co/datasets/nvidia/simready-assets); converted by '
        + 'CodePawl. Changes must be indicated.',
      risks: [
        'Geometry uses EXT_meshopt_compression and textures EXT_texture_webp. Quest would need a re-export, because IWSDK '
          + 'configures only Draco and KTX2 decoders.',
        'Only 2 of 2,595 per-asset licence files were sampled.',
      ],
      thematicFit: 'off-theme',
      recommendation: 'rejected',
      reason: 'Industrial and household simulation props: food and kitchenware, boxes and pallets, tools, vehicle parts, '
        + 'medical and factory equipment. Nothing fits a clan steading.',
      verifiedOn: EALDHOLT_ASSET_VERIFIED_ON,
    },
    {
      id: 'hf-codepawl-abo-glb',
      kind: 'dataset-reupload',
      title: 'codepawl/abo-glb',
      url: 'https://huggingface.co/datasets/codepawl/abo-glb',
      revision: 'c7c8293fed3b7ab122ef5d7896521a187e0962d7',
      statedLicence: 'CC-BY-4.0',
      upstreamLicence: 'CC-BY-4.0',
      upstreamLicenceVerified: true,
      upstream: 'Amazon Berkeley Objects: https://amazon-berkeley-objects.s3.amazonaws.com/index.html',
      upstreamEvidence: 'The official dataset page states CC BY 4.0 and asks that credit for the data go to Amazon.com. '
        + 'This is a dataset-level statement; per-model files were not checked.',
      nonCommercial: false,
      attributionRequired: true,
      attribution: 'Amazon Berkeley Objects, data by Amazon.com, CC BY 4.0; converted by CodePawl. Changes must be indicated.',
      risks: [
        'The models are real branded retail products; product designs and brand names belong to their owners.',
        'Geometry uses EXT_meshopt_compression, so Quest would need a re-export.',
      ],
      thematicFit: 'off-theme',
      recommendation: 'rejected',
      reason: 'Modern furniture, rugs, lamps and home decor from a retail catalogue.',
      verifiedOn: EALDHOLT_ASSET_VERIFIED_ON,
    },
    {
      id: 'hf-codepawl-ct-anatomy-glb',
      kind: 'dataset-reupload',
      title: 'codepawl/ct-anatomy-glb',
      url: 'https://huggingface.co/datasets/codepawl/ct-anatomy-glb',
      revision: '406d50df3885c11f71b2088c85e9c6d397583e0e',
      statedLicence: 'CC-BY-4.0',
      upstreamLicence: 'CC-BY-4.0',
      upstreamLicenceVerified: true,
      upstream: 'TotalSegmentator dataset v2.0.1, University Hospital Basel: https://doi.org/10.5281/zenodo.10047292',
      upstreamEvidence: 'The Zenodo record for version 2.0.1 lists the licence cc-by-4.0 with open access.',
      nonCommercial: false,
      attributionRequired: true,
      attribution: 'TotalSegmentator dataset v2.0.1, Wasserthal et al., University Hospital Basel, CC BY 4.0; meshes by '
        + 'CodePawl. Changes must be indicated.',
      risks: [
        'The meshes are smoothed segmentations of real, de-identified patients from clinical CT scans.',
        'The card limits use to visualisation, education and graphics.',
        'Geometry uses EXT_meshopt_compression, so Quest would need a re-export.',
      ],
      thematicFit: 'off-theme',
      recommendation: 'rejected',
      reason: 'Human internal anatomy from clinical scans has no place in the steading, and patient-derived bodies '
        + 'would be inappropriate set dressing.',
      verifiedOn: EALDHOLT_ASSET_VERIFIED_ON,
    },
    {
      id: 'hf-codepawl-menagerie-glb',
      kind: 'dataset-reupload',
      title: 'codepawl/menagerie-glb',
      url: 'https://huggingface.co/datasets/codepawl/menagerie-glb',
      revision: '5b62741d22a86a06116023a9079a3af99b22f4a1',
      statedLicence: 'per-model',
      upstreamLicence: 'per-model',
      upstreamLicenceVerified: true,
      upstream: 'MuJoCo Menagerie (Google DeepMind) at commit b0655057a9df2abe39ea7fc989914ba6f248301c: '
        + 'https://github.com/google-deepmind/mujoco_menagerie',
      upstreamEvidence: 'Each of the 79 per-model licences in the card\'s LICENSES.md (Apache-2.0 35, BSD-3-Clause 25, '
        + 'MIT 14, BSD-2-Clause 4, BSD-3-Clause-Clear 1) matches a licence text in that model\'s directory section of the '
        + 'upstream root LICENSE at that commit. Four upstream directories carry two licence texts. No non-commercial '
        + 'wording was found.',
      nonCommercial: false,
      attributionRequired: true,
      attribution: 'Per model: keep each model\'s LICENSE and copyright notice (MuJoCo Menagerie and the original robot authors).',
      risks: [
        'Robot names, product names and logos are trademarks of their owners.',
        'Four upstream directories mix two licences, so each file needs its own check.',
        'Geometry uses EXT_meshopt_compression, so Quest would need a re-export.',
      ],
      thematicFit: 'off-theme',
      recommendation: 'rejected',
      reason: 'Modern robot arms, hands, humanoids, quadrupeds and drones.',
      verifiedOn: EALDHOLT_ASSET_VERIFIED_ON,
    },
    {
      id: 'hf-codepawl-scanned-objects-glb',
      kind: 'dataset-reupload',
      title: 'codepawl/scanned-objects-glb',
      url: 'https://huggingface.co/datasets/codepawl/scanned-objects-glb',
      revision: 'fdb214f6ea18996f2d45e05df74c5d9696c3f7a2',
      statedLicence: 'CC-BY-4.0',
      upstreamLicence: 'CC-BY-4.0',
      upstreamLicenceVerified: true,
      upstream: 'Google Scanned Objects on Gazebo Fuel, owner GoogleResearch: https://app.gazebosim.org/GoogleResearch/fuel/models',
      upstreamEvidence: 'The Fuel API lists 1,033 GoogleResearch models, and every one carries '
        + '"Creative Commons Attribution 4.0 International".',
      nonCommercial: false,
      attributionRequired: true,
      attribution: 'Google Scanned Objects by Google Research (Copyright 2020 Google LLC), CC BY 4.0; converted by CodePawl. '
        + 'Changes must be indicated.',
      risks: [
        'Scans of retail products carry third-party brands, logos and packaging art.',
        'Geometry uses EXT_meshopt_compression, so Quest would need a re-export.',
      ],
      thematicFit: 'off-theme',
      recommendation: 'rejected',
      reason: 'Modern household products, packaging, shoes and toys.',
      verifiedOn: EALDHOLT_ASSET_VERIFIED_ON,
    },
    {
      id: 'github-codepawl-spume',
      kind: 'tool-repository',
      title: 'codepawl/spume',
      url: 'https://github.com/codepawl/spume',
      revision: 'fe0d277f2c22cf86a133246e91505718143af450',
      statedLicence: 'Apache-2.0',
      upstreamLicence: 'Apache-2.0',
      upstreamLicenceVerified: true,
      upstream: 'CodePawl, the original author; the README states the code is original.',
      upstreamEvidence: 'LICENSE at that commit is the Apache License 2.0 text and pyproject.toml declares Apache-2.0. Its '
        + 'NVIDIA Warp dependency reports Apache-2.0 in PyPI metadata (version 1.19.0).',
      nonCommercial: false,
      attributionRequired: true,
      attribution: 'Spume, Copyright 2026 CodePawl, Apache-2.0. The notice applies if its code is redistributed.',
      risks: [
        'Needs an NVIDIA GPU through NVIDIA Warp; the README says two GPU runs agree closely, not bit for bit.',
        'Output is one GLB per frame plus spray point data, far heavier than the analytic water in use.',
      ],
      thematicFit: 'not-an-asset',
      recommendation: 'conditional',
      reason: 'An offline FLIP liquid solver, not an asset library. At most an optional offline tool for reference bakes of '
        + 'splashing water; never a runtime dependency, and any baked result would need conversion before Quest use.',
      verifiedOn: EALDHOLT_ASSET_VERIFIED_ON,
    },
  ],
  inUse: [
    {
      assetId: 'leafy_grass',
      role: 'meadow-grass-cover',
      sourceUrl: 'https://polyhaven.com/a/leafy_grass',
      licence: 'CC0-1.0',
      provenance: 'main game/public/assets/legacy/environment/aethelgard/textures/grass-leafy-v1/provenance.json',
      note: 'Canonical outer-valley grass ground: Desktop 1024 px, Quest 512 px. The handoff notes it still reads too tan and flat.',
    },
    {
      assetId: 'stony_dirt_path',
      role: 'ground-path-materials',
      sourceUrl: 'https://polyhaven.com/a/stony_dirt_path',
      licence: 'CC0-1.0',
      provenance: 'main game/public/assets/legacy/environment/aethelgard/textures/provenance.json',
      note: 'Photographic earth layer: Desktop 1024 px; Quest 512 px colour and 256 px data maps.',
    },
    {
      assetId: 'rock_surface',
      role: 'boulders-lichen-rock',
      sourceUrl: 'https://polyhaven.com/a/rock_surface',
      licence: 'CC0-1.0',
      provenance: 'main game/public/assets/legacy/environment/aethelgard/textures/provenance.json',
      note: 'Photographic rock layer, at the same sizes as the earth layer.',
    },
  ],
  candidates: [
    // A Verdant Trail, in the order the collection lists them.
    polyHaven(VERDANT_TRAIL, {
      assetId: 'shrub_01',
      name: 'Shrub 01',
      role: 'meadow-grass-cover',
      authors: ['Rico Cilliers'],
      facts: model(156012, 1, ['MASK']),
      suitability: 'Lush green shrub with small white flower clusters, tagged meadow and ground cover. It reads as a '
        + 'flowering meadow-edge clump, not grass: one 156,012-triangle alpha-tested clump.',
      recommendation: 'conditional',
      reason: 'Alpha-tested leaf cards simplify poorly, so Quest needs re-authored cards or a billboard, and the clumps need '
        + 'a comparison capture over the canonical leafy_grass ground.',
    }),
    polyHaven(VERDANT_TRAIL, {
      assetId: 'coastal_cliff_02',
      name: 'Coastal Cliff 02',
      role: 'boulders-lichen-rock',
      authors: ['Rob Tuytel'],
      facts: model(943284, 1, ['OPAQUE']),
      suitability: 'Sea-worn cliff about 41 m long with layered strata and a grassy top; 943,284 triangles in one mesh.',
      recommendation: 'conditional',
      reason: 'Distant rock-face dressing only, after heavy simplification: unsimplified it is 3.8 times the whole Quest '
        + 'in-view budget of 250k triangles. Placement follows the creator\'s private map; imported landforms establish no geography.',
    }),
    polyHaven(VERDANT_TRAIL, {
      assetId: 'kloofendal_28d_misty',
      name: 'Kloofendal 28d Misty',
      role: 'sky-hdri',
      authors: ['Greg Zaal', 'Jenelle van Heerden'],
      facts: hdri('morning', 'fog', 'medium', 29),
      suitability: 'Fog and soft, partly cloudy light over a rocky grassland hilltop; the mist hides the horizon in the '
        + 'published preview. The closest of the six to the mist and broken cloud the design sheet asks for.',
      recommendation: 'conditional',
      reason: 'A morning capture with the sun near 29° against the sheet\'s 14°: clamp its sun so the key light stays the only '
        + 'sun, and compare it with the current original procedural panorama, because its tan lower hemisphere could warm '
        + 'ground the handoff already calls too tan.',
    }),
    polyHaven(VERDANT_TRAIL, {
      assetId: 'dead_tree_trunk_02',
      name: 'Dead Tree Trunk 02',
      role: 'trees-deadwood',
      authors: ['Jenelle van Heerden', 'Rico Cilliers'],
      facts: model(83128, 1, ['OPAQUE']),
      suitability: 'Fallen, decayed log about 4 m long with rough bark, lichen and a broken stub; fits woodland floor and bank debris.',
      recommendation: 'recommended',
      reason: 'On theme and CC0. Standard intake: 83,128 triangles is a third of the Quest in-view budget, so Quest needs a '
        + 'simplified level.',
    }),
    polyHaven(VERDANT_TRAIL, {
      assetId: 'coast_sand_01',
      name: 'Coast Sand 01',
      role: 'riverbank-sand-gravel',
      authors: ['Rob Tuytel'],
      facts: texture(15),
      suitability: 'Damp brown sand with scattered pebbles and gravel. A 15 m aerial tile, so texel density is low up close.',
      recommendation: 'recommended',
      reason: 'Suits bank and shore strips with the same 1k colour, OpenGL normal and ARM intake as leafy_grass. Keep it to '
        + 'mid-distance banks or add a finer detail map for close views.',
    }),
    polyHaven(VERDANT_TRAIL, {
      assetId: 'boulder_01',
      name: 'Boulder 01',
      role: 'boulders-lichen-rock',
      authors: ['Rico Cilliers'],
      facts: model(66122, 1, ['OPAQUE']),
      suitability: 'Weathered boulder about 1.3 × 1.8 × 1.0 m with subtle lichen and mineral streaks; reads as a fieldstone or moraine boulder.',
      recommendation: 'recommended',
      reason: 'On theme and CC0. Standard intake with a simplified Quest level and instancing: ten unsimplified copies would be '
        + '661,220 triangles, 2.6 times the Quest in-view budget.',
    }),
    polyHaven(VERDANT_TRAIL, {
      assetId: 'shrub_02',
      name: 'Shrub 02',
      role: 'shrubs-undergrowth',
      authors: ['Rico Cilliers'],
      facts: model(27254, 4, ['MASK']),
      suitability: 'Four low green shrub variants with narrow leaves, 27,254 triangles in total, alpha-tested; suits '
        + 'riverbank and woodland-edge undergrowth.',
      recommendation: 'recommended',
      reason: 'Lush, light and CC0. Standard intake, keeping alpha-tested (not blended) materials for Quest.',
    }),
    polyHaven(VERDANT_TRAIL, {
      assetId: 'coastal_cliff_04',
      name: 'Coastal Cliff 04',
      role: 'boulders-lichen-rock',
      authors: ['Rob Tuytel', 'Rico Cilliers'],
      facts: model(1537926, 1, ['OPAQUE']),
      suitability: 'Weathered coastal cliff about 87 m long with eroded ledges and a grassy top; 1,537,926 triangles in one mesh.',
      recommendation: 'conditional',
      reason: 'As for Coastal Cliff 02: distant dressing only, after heavy simplification (6.2 times the Quest in-view '
        + 'budget unsimplified), placed by the creator\'s private map.',
    }),
    polyHaven(VERDANT_TRAIL, {
      assetId: 'lichen_rock',
      name: 'Lichen Rock',
      role: 'boulders-lichen-rock',
      authors: ['Rico Cilliers'],
      facts: texture(2),
      suitability: 'Rugged weathered rock with pale-green lichen and moss patches, a 2 m tile.',
      recommendation: 'recommended',
      reason: 'Adds the lichened stone the in-use rock_surface lacks, through the standard texture intake, for new crag and '
        + 'boulder surfaces. Replacing rock_surface itself needs a comparison capture first.',
    }),
    polyHaven(VERDANT_TRAIL, {
      assetId: 'kloofendal_overcast',
      name: 'Kloofendal Overcast',
      role: 'sky-hdri',
      authors: ['Greg Zaal'],
      facts: hdri('afternoon', 'overcast', 'low', null),
      suitability: 'Soft overcast afternoon light over a grassland hilltop; the published preview shows suburban housing and '
        + 'a city along the horizon.',
      recommendation: 'conditional',
      reason: 'Diffuse lighting input only: never a visible background or a source for calm-water reflections, where the '
        + 'modern skyline would show.',
    }),
    polyHaven(VERDANT_TRAIL, {
      assetId: 'dry_branches_medium_01',
      name: 'Dry Branches Medium 01',
      role: 'trees-deadwood',
      authors: ['Rico Cilliers'],
      facts: model(16803, 3, ['OPAQUE']),
      suitability: 'Three gnarled dry branches with cracked bark, 16,803 triangles in total; suits woodpiles, kindling and '
        + 'forest-floor scatter.',
      recommendation: 'recommended',
      reason: 'Light, generic and CC0; standard intake.',
    }),
    polyHaven(VERDANT_TRAIL, {
      assetId: 'sand_rocks_small_01',
      name: 'Sand Rocks Small 01',
      role: 'riverbank-sand-gravel',
      authors: ['Rob Tuytel', 'Rico Cilliers'],
      facts: model(739469, 1, ['OPAQUE']),
      suitability: 'Sandy shore patch about 4.6 × 3.9 m with weathered boulders and pebbles; 739,469 triangles in one mesh.',
      recommendation: 'conditional',
      reason: 'Gravel-bar dressing only after heavy simplification, or an offline source for a baked bank texture: '
        + 'unsimplified it is three times the Quest in-view budget.',
    }),
    polyHaven(VERDANT_TRAIL, {
      assetId: 'kloofendal_48d_partly_cloudy',
      name: 'Kloofendal 48d Partly Cloudy',
      role: 'sky-hdri',
      authors: ['Greg Zaal'],
      facts: hdri('midday', 'partly_cloudy', 'high', 48),
      suitability: 'Bright midday sky with cumulus over rocky hills; suburban houses and roofs show below the horizon in the '
        + 'published preview.',
      recommendation: 'rejected',
      reason: 'A high midday sun near 48° contradicts the late-afternoon low sun, and the modern housing would show in any '
        + 'visible or reflected use.',
    }),
    polyHaven(VERDANT_TRAIL, {
      assetId: 'root_cluster_02',
      name: 'Root Cluster 02',
      role: 'trees-deadwood',
      authors: ['Jenelle van Heerden'],
      facts: model(339641, 8, ['OPAQUE']),
      suitability: 'Eight weathered dead-tree root pieces for forest-floor dressing; 339,641 triangles, the largest piece 213,939.',
      recommendation: 'conditional',
      reason: 'On theme, but every piece needs heavy simplification before Quest use. Start with Desktop close-up dressing '
        + 'and a simplification check.',
    }),
    polyHaven(VERDANT_TRAIL, {
      assetId: 'rock_face_03',
      name: 'Rock Face 03',
      role: 'boulders-lichen-rock',
      authors: ['Dario Barresi', 'Rico Cilliers'],
      facts: texture(2.7),
      suitability: 'Cracked, eroded rock face in variegated browns, a 2.7 m tile.',
      recommendation: 'conditional',
      reason: 'Overlaps the in-use rock_surface; adopt only if a comparison capture shows the crags read better.',
    }),

    // Namaqualand, in the order the collection lists them.
    polyHaven(NAMAQUALAND, {
      assetId: 'rogland_moonlit_night',
      name: 'Rogland Moonlit Night',
      role: 'sky-hdri',
      authors: ['Greg Zaal'],
      facts: hdri('night', 'partly_cloudy', 'high', null),
      suitability: 'Moonlit desert night with the Milky Way over arid rocky ground.',
      recommendation: 'rejected',
      reason: 'The design sheet has no night state; adding one would be a new atmosphere decision for the creator.',
    }),
    polyHaven(NAMAQUALAND, {
      assetId: 'dead_quiver_branch_01',
      name: 'Dead Quiver Branch 01',
      role: 'trees-deadwood',
      authors: ['Greg Zaal', 'Jenelle van Heerden'],
      facts: model(14834, 1, ['OPAQUE']),
      suitability: 'Dried branch of an arid, aloe-like Karoo tree.',
      recommendation: 'rejected',
      reason: 'A distinctive arid form, and Dry Branches Medium 01 already covers the role. Namaqualand use is limited to rocks and flowers.',
    }),
    polyHaven(NAMAQUALAND, {
      assetId: 'dry_quiver_leaf',
      name: 'Dry Quiver Leaf',
      role: 'trees-deadwood',
      authors: ['Greg Zaal', 'Rico Cilliers'],
      facts: model(78720, 2, ['OPAQUE']),
      suitability: 'Dried leaf litter from the same arid, aloe-like tree.',
      recommendation: 'rejected',
      reason: 'Desert leaf litter does not belong on a cold upland floor.',
    }),
    polyHaven(NAMAQUALAND, {
      assetId: 'othonna_cerarioides',
      name: 'Othonna Cerarioides',
      role: 'shrubs-undergrowth',
      authors: ['James Ray Cock', 'Jenelle van Heerden'],
      facts: model(118149, 7, ['MASK', 'OPAQUE']),
      suitability: 'Karoo succulent shrub with dense upright stems and leathery leaves.',
      recommendation: 'rejected',
      reason: 'The succulent silhouette reads as arid scrub; Shrub 02 covers undergrowth.',
    }),
    polyHaven(NAMAQUALAND, {
      assetId: 'leipoldtia_schultzei',
      name: 'Leipoldtia Schultzei',
      role: 'meadow-grass-cover',
      authors: ['Jenelle van Heerden'],
      facts: model(385504, 3, ['BLEND']),
      suitability: 'Low spreading succulent with vivid purple flowers; three variants, 385,504 triangles, alpha-blended materials.',
      recommendation: 'conditional',
      reason: 'Only as sparse wildflower accents at mid or far distance, the selective flower use Namaqualand allows. It needs '
        + 'alpha-tested instead of blended materials for Quest, heavy simplification and a comparison capture, and is never a dominant cover.',
    }),
    polyHaven(NAMAQUALAND, {
      assetId: 'quiver_tree_01',
      name: 'Quiver Tree 01',
      role: 'trees-deadwood',
      authors: ['James Ray Cock', 'Dario Barresi', 'Rico Cilliers'],
      facts: model(150124, 1, ['BLEND', 'OPAQUE']),
      suitability: 'Iconic desert aloe tree with succulent rosettes, about 2.7 m tall.',
      recommendation: 'rejected',
      reason: 'Its silhouette contradicts a cold upland valley.',
    }),
    polyHaven(NAMAQUALAND, {
      assetId: 'klippad_dawn_2',
      name: 'Klippad Dawn 2',
      role: 'sky-hdri',
      authors: ['Greg Zaal'],
      facts: hdri('sunrise', 'partly_cloudy', 'low', null),
      suitability: 'Low-contrast dawn under a broken cloud ceiling, the sun at the horizon, over arid rocky hills strewn with boulders.',
      recommendation: 'conditional',
      reason: 'Its cloud structure is the closest to the sheet\'s broken ceiling, but the sun sits lower than 14° and the arid '
        + 'lower hemisphere tints the light: a lighting or sky reference only, after a comparison capture.',
    }),
    polyHaven(NAMAQUALAND, {
      assetId: 'goegap_road',
      name: 'Goegap Road',
      role: 'sky-hdri',
      authors: ['Greg Zaal', 'James Ray Cock'],
      facts: hdri('sunset', 'partly_cloudy', 'high', 7),
      suitability: 'A low sun near 7° over an arid flower field; an asphalt road fills the lower hemisphere.',
      recommendation: 'rejected',
      reason: 'The road would appear in any reflection or visible use, and the scene is arid.',
    }),
    polyHaven(NAMAQUALAND, {
      assetId: 'wild_rooibos_bush',
      name: 'Wild Rooibos Bush',
      role: 'shrubs-undergrowth',
      authors: ['James Ray Cock', 'Jenelle van Heerden'],
      facts: model(27519, 5, ['BLEND', 'OPAQUE']),
      suitability: 'Low, dried, multi-stemmed desert bush with needle-like leaves.',
      recommendation: 'rejected',
      reason: 'Desert scrub with blended materials; Shrub 02 covers undergrowth, and Namaqualand use is limited to rocks and flowers.',
    }),
    polyHaven(NAMAQUALAND, {
      assetId: 'bark_debris_01',
      name: 'Bark Debris 01',
      role: 'trees-deadwood',
      authors: ['Greg Zaal', 'Jenelle van Heerden'],
      facts: model(193406, 4, ['OPAQUE']),
      suitability: 'Weathered Karoo sticks for desert ground cover; 193,406 triangles.',
      recommendation: 'rejected',
      reason: 'Arid debris at a high triangle cost; the Verdant Trail deadwood covers the role.',
    }),
    polyHaven(NAMAQUALAND, {
      assetId: 'dead_quiver_trunk',
      name: 'Dead Quiver Trunk',
      role: 'trees-deadwood',
      authors: ['James Ray Cock', 'Dario Barresi', 'Rico Cilliers'],
      facts: model(17978, 1, ['OPAQUE']),
      suitability: 'Decayed trunk of the arid, aloe-like tree, about 2 m long.',
      recommendation: 'rejected',
      reason: 'Distinctive arid bark; Dead Tree Trunk 02 covers fallen logs.',
    }),
    polyHaven(NAMAQUALAND, {
      assetId: 'rock_face',
      name: 'Rock Face',
      role: 'boulders-lichen-rock',
      authors: ['Greg Zaal', 'Dario Barresi'],
      facts: texture(2.38),
      suitability: 'Weathered reddish-brown cliff stone with cracks and crevices, a 2.38 m tile.',
      recommendation: 'conditional',
      reason: 'Selective rock use: its warm reddish hue reads arid beside lichened stone, so adopt it only for crag variation '
        + 'after a comparison capture.',
    }),
    polyHaven(NAMAQUALAND, {
      assetId: 'namaqualand_boulder_02',
      name: 'Namaqualand Boulder 02',
      role: 'boulders-lichen-rock',
      authors: ['Greg Zaal', 'Rico Cilliers'],
      facts: model(97964, 1, ['OPAQUE']),
      suitability: 'Group of layered, weathered sandstone boulders about 2.5 × 1.2 × 0.9 m; 97,964 triangles.',
      recommendation: 'conditional',
      reason: 'Selective rock use: check the warm sandstone layering beside lichened boulders in a comparison capture, then '
        + 'simplify for Quest.',
    }),
    polyHaven(NAMAQUALAND, {
      assetId: 'namaqualand_boulder_03',
      name: 'Namaqualand Boulder 03',
      role: 'boulders-lichen-rock',
      authors: ['Jenelle van Heerden', 'Dario Barresi'],
      facts: model(64826, 1, ['OPAQUE']),
      suitability: 'Rough brown boulder about 2.4 × 3.1 × 1.5 m; 64,826 triangles.',
      recommendation: 'conditional',
      reason: 'Selective rock use, with the same comparison and simplification conditions as Namaqualand Boulder 02.',
    }),
    polyHaven(NAMAQUALAND, {
      assetId: 'searsia_lucida',
      name: 'Searsia Lucida',
      role: 'shrubs-undergrowth',
      authors: ['James Ray Cock', 'Jenelle van Heerden'],
      facts: model(377192, 7, ['BLEND', 'OPAQUE']),
      suitability: 'Twiggy Karoo shrub with dense leathery leaves; 377,192 triangles with blended materials.',
      recommendation: 'rejected',
      reason: 'An arid shrub at a high cost; Shrub 02 covers undergrowth.',
    }),
  ],
};

const SHIPPED = validateAssetCandidates(MANIFEST_DATA);
if (!SHIPPED.ok) throw Error(`The shipped Ealdholt asset candidate manifest is invalid: ${SHIPPED.error}`);

/**
 * The vetted manifest: a deeply frozen copy that passed validateAssetCandidates
 * when this module loaded. WORKING PLACEHOLDER pending creator approval;
 * nothing in it is integrated.
 */
export const EALDHOLT_ASSET_CANDIDATE_MANIFEST: EaldholtAssetCandidateManifest = SHIPPED.manifest;
