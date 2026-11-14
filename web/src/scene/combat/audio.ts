/**
 * The combat audio cue layer: what each cue name means, how loud it sits, and
 * the rules that hold for every fight whatever the sequence data says.
 *
 * One layer per fight. It owns three guarantees:
 *  - `decisive` is the existing killing strike (audio.strike with its flesh
 *    layer, after the plea is cut) and it sounds at most once per fight;
 *  - nothing that belongs to the exchange (clashes, efforts, bracing) sounds
 *    after the kill, so the wound and the death cry are never talked over;
 *  - the same cue cannot machine-gun (a minimum gap per cue).
 *
 * The bank is the seam for the combat-sound agent: implement `cue` on
 * audioManager for the thirteen exchange cues and the stand-ins fall away.
 * Until then `whoosh` and `bodyFall` map onto today's bladeWhoosh / bodyFall
 * and the clash cues are silent (the engine's sparks still show the contact).
 */
import { AUDIO_CUES, type AudioCue } from "./choreography";

export type ExchangeCue = Exclude<AudioCue, "decisive">;
export interface CueOptions { volume: number; pan: number }

export interface CombatSoundBank {
  /** Cut the live plea, then audio.strike(attackerKind, { flesh, pan, volume }).
   * The death cry follows from the engine's slay(), as it does today. */
  kill(options: CueOptions): void;
  /** A real recording for the cue. Return false if there is none yet. */
  cue?(name: ExchangeCue, options: CueOptions): boolean;
  /** Stand-in: audio.bladeWhoosh({ pan, volume, weight }). */
  whoosh?(options: CueOptions & { weight: number }): void;
  /** Stand-in: audio.bodyFall(volume, kind). */
  bodyFall?(options: CueOptions & { weight: number }): void;
}

export interface CueSpec {
  /** Mix level before the sequence's own volume. */
  gain: number;
  /** Seconds before the same cue may sound again. */
  gap: number;
  /** exchange cues stop at the kill; aftermath cues are the body and the victor. */
  phase: "exchange" | "kill" | "aftermath";
  /** Takes to record, so back-to-back fights do not repeat a sample. */
  takes: number;
  brief: string;
}

export const CUE_SPECS: Readonly<Record<AudioCue, CueSpec>> = {
  "clash.shield.wood": { gain: 0.8, gap: 0.09, phase: "exchange", takes: 4, brief: "Spear or blade stopped by a hide-and-wood shield: a dull knock with a short rattle." },
  "clash.shield.iron": { gain: 0.85, gap: 0.09, phase: "exchange", takes: 4, brief: "Steel on an iron-faced shield: a bright ring, short decay." },
  "clash.parry.steel": { gain: 0.8, gap: 0.09, phase: "exchange", takes: 4, brief: "Weapon turned aside by a weapon: a scrape that ends in a click." },
  "bash.shield": { gain: 0.75, gap: 0.12, phase: "exchange", takes: 3, brief: "A shield driven into a body or another shield: low thud, armour shifting." },
  "effort.light": { gain: 0.5, gap: 0.25, phase: "exchange", takes: 5, brief: "A short exhale on a quick thrust or shove. No words." },
  "effort.heavy": { gain: 0.6, gap: 0.35, phase: "aftermath", takes: 4, brief: "A strained grunt: a heavy swing, or a soldier spent after a hard kill." },
  brace: { gain: 0.45, gap: 0.3, phase: "exchange", takes: 3, brief: "Feet set and gear settling as a shield comes up." },
  recoil: { gain: 0.5, gap: 0.2, phase: "exchange", takes: 3, brief: "Boots scraping back half a pace after a stopped blow." },
  stagger: { gain: 0.4, gap: 0.25, phase: "exchange", takes: 3, brief: "A stumble: two uneven steps and a caught breath." },
  "whoosh.light": { gain: 0.3, gap: 0.12, phase: "exchange", takes: 4, brief: "A spear or light blade through the air." },
  "whoosh.heavy": { gain: 0.65, gap: 0.18, phase: "exchange", takes: 3, brief: "A hammer, a shield or a great blade coming round." },
  decisive: { gain: 1, gap: Infinity, phase: "kill", takes: 0, brief: "The existing killing strike with its flesh layer. Never a new recording, never twice." },
  "fall.light": { gain: 0.8, gap: 0.5, phase: "aftermath", takes: 3, brief: "A footsoldier's body reaching the stone." },
  "fall.heavy": { gain: 0.8, gap: 0.5, phase: "aftermath", takes: 3, brief: "An armoured or large body going down, with the floor answering." },
};

/** The most the killing strike is handed to the mixer at (every other cue stops at 1). */
export const KILL_CEILING = 1.6;

export class CombatAudioLayer {
  private killed = false;
  private readonly last = new Map<AudioCue, number>();
  /** Every cue that sounded, in order: for replays, tests and diagnostics. */
  readonly played: { cue: AudioCue; at: number }[] = [];

  constructor(private readonly bank: CombatSoundBank, private readonly master = 1) {}

  get hasKilled(): boolean { return this.killed; }

  /** `now` is the fight's clock in seconds. Returns whether the cue sounded. */
  play(cue: AudioCue, now: number, options: Partial<CueOptions> = {}): boolean {
    const spec = CUE_SPECS[cue];
    if (!spec || !AUDIO_CUES.includes(cue)) return false;
    if (cue === "decisive" ? this.killed : this.killed && spec.phase === "exchange") return false;
    const before = this.last.get(cue);
    if (before !== undefined && now - before < spec.gap) return false;
    const sound: CueOptions = {
      // Only the killing strike may sit above full level: it is the loudest hit of the fight.
      volume: Math.max(0, Math.min(cue === "decisive" ? KILL_CEILING : 1, spec.gain * (options.volume ?? 1) * this.master)),
      pan: Math.max(-1, Math.min(1, options.pan ?? 0)),
    };
    if (cue === "decisive") { this.killed = true; this.bank.kill(sound); }
    else if (!this.bank.cue?.(cue, sound)) {
      if (cue === "whoosh.light" || cue === "whoosh.heavy") this.bank.whoosh?.({ ...sound, weight: cue === "whoosh.heavy" ? 0.85 : 0.3 });
      else if (cue === "fall.light" || cue === "fall.heavy") this.bank.bodyFall?.({ ...sound, weight: cue === "fall.heavy" ? 1 : 0.5 });
      else return false;
    }
    this.last.set(cue, now);
    this.played.push({ cue, at: now });
    return true;
  }
}
