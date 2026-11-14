export type PieceColor = 'w' | 'b';
export type PieceType = 'p' | 'n' | 'b' | 'r' | 'q' | 'k';
export type PlaybackSpeed = .5 | 1 | 2 | 4;
export type ReplayResult = '1-0' | '0-1' | '1/2-1/2' | '*';
export type RecordSource = 'computer' | 'import' | 'match';

export interface RecordedMatch {
  readonly id: string;
  readonly mode: 'classic' | 'local-duel' | 'chapters' | 'online-duel' | 'ai-battle';
  readonly setting: 'scene-01' | 'scene-02';
  readonly pieces: 'crownfall-v1';
  readonly white: string;
  readonly black: string;
  readonly reason: string;
}

export interface ShowcasePiece {
  readonly id: string;
  readonly color: PieceColor;
  readonly type: PieceType;
  readonly square: string;
}

export interface ShowcaseMove {
  readonly choreography?: import("../play/combat-sequences").CombatSequence;
  readonly from: string;
  readonly to: string;
  readonly san: string;
  readonly color: PieceColor;
  readonly piece: PieceType;
  readonly captured?: PieceType;
  readonly promotion?: PieceType;
  readonly flags: string;
}

export interface ShowcaseFrame {
  readonly ply: number;
  readonly fen: string;
  readonly turn: PieceColor;
  readonly check: boolean;
  readonly pieces: readonly ShowcasePiece[];
  readonly move: ShowcaseMove | null;
}

/** Compact persisted entry. Heavy render frames are built only when opened. */
export interface ReplayEntry {
  readonly id: string;
  readonly title: string;
  readonly source: RecordSource;
  readonly match?: RecordedMatch;
  readonly arena: number;
  readonly createdAt: string;
  readonly pgn: string;
  readonly seed?: number;
  readonly result: ReplayResult;
  /** Non-terminal PGNs may report resignation; this is a supplied claim, not a computed win. */
  readonly declaredResult?: ReplayResult;
  readonly plies: number;
}

export interface ShowcaseRecord extends ReplayEntry {
  readonly initialFen: string;
  readonly moves: readonly string[];
  readonly frames: readonly ShowcaseFrame[];
  readonly termination: 'checkmate' | 'draw' | 'move-limit' | 'imported' | 'recorded';
}

export interface ShowcaseSnapshot {
  readonly phase: 'idle' | 'generating' | 'opening' | 'ready' | 'error';
  readonly progress: number;
  readonly record: ShowcaseRecord | null;
  readonly frame: ShowcaseFrame | null;
  readonly ply: number;
  readonly playing: boolean;
  readonly speed: PlaybackSpeed;
  readonly arena: number;
  readonly library: readonly ReplayEntry[];
  readonly storage: 'saved' | 'session' | 'corrupt' | 'loading';
  readonly message: string;
  readonly error: string;
  readonly ended: boolean;
  readonly saved: boolean;
}

export interface ShowcaseOperation {
  readonly ok: boolean;
  readonly message: string;
  readonly entry?: ReplayEntry;
}

export interface ShowcaseStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface GenerationOptions {
  seed?: number;
  arena?: number;
  maxPlies?: number;
  signal?: AbortSignal;
}
