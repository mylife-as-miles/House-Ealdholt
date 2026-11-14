/**
 * How the match moves the arena's air.
 *
 * The air of the arena (the ash, the embers, the low mist; main game/src/play/arena-air.ts) used to drift on fixed
 * clocks, whatever the figures did in it. This is what it answers to instead, as plain arithmetic with no Three.js:
 *
 *  - the wind ({@link airWind}): one slow gusting signal that everything hanging in the air follows together;
 *  - the disturbance field ({@link createAirDisturbance}): a short, fixed list of the pushes the match has just
 *    given the air (a step, a blow, a body reaching the stone, a spell breaking), each with a place, a reach and a
 *    life. A shader reads the list as uniform arrays and works out every flake's answer itself, so an impulse costs
 *    the page one write when it is made and nothing after.
 *
 * Lengths are metres, as in the look's files (a tile is 2.35 m; arena-physics.ts turns the board's units into
 * them). Times are seconds of the arena's own clock, which the match holds (pause) and slows (a fatality) with its own.
 */

/** What the match did to the air. */
export type AirImpulseKind =
  /** A foot set down: a walk across the board, a step in a fight. */
  | "step"
  /** A figure arriving on its square with its weight. */
  | "land"
  /** Steel stopped: a blow on a shield, a parry, a shield bash, a glance off armour. */
  | "clash"
  /** The blow that kills. */
  | "blow"
  /** A body, or a piece of one, reaching the stone. */
  | "fall"
  /** A blow carried into the floor: the ground wave, an aftershock, a crown falling. */
  | "slam"
  /** A powder weapon: the blast at the muzzle, the ball going in. */
  | "shot"
  /** A spell breaking on its target. */
  | "spell"
  /** A rite over the fallen: the Claiming, a Queen's summon. */
  | "rite";

export interface AirImpulseShape {
  /** Metres the air is pushed outward at its centre. */
  push: number;
  /** Metres it reaches. */
  radius: number;
  /** Seconds until the air has settled. */
  life: number;
  /** Metres the ash lying on the stone is thrown along it. */
  throw: number;
  /** Metres that ash is lifted. */
  lift: number;
  /** The share of a slot's flakes it raises, 0 to 1. */
  flakes: number;
  /** The share of those that leave glowing, 0 to 1. */
  heat: number;
  /** How far it thins the low mist round the board's foot, 0 (not at all) to 1. */
  mist: number;
}

/**
 * Each kind at power 1. A step only parts what is at the foot; a blow throws a ring a tile wide; a body puffs the
 * dust up more than out; a spell or a rite pushes hardest and reaches the dais floor. The ash that lies in this
 * arena has live embers in it: every impulse turns some up, and the hotter the event the more of what it raises glows.
 */
export const AIR_IMPULSES: Readonly<Record<AirImpulseKind, AirImpulseShape>> = {
  step: { push: 0.25, radius: 1.0, life: 1.3, throw: 0.5, lift: 0.25, flakes: 0.12, heat: 0.1, mist: 0 },
  land: { push: 0.5, radius: 1.8, life: 1.8, throw: 1.2, lift: 0.5, flakes: 0.4, heat: 0.15, mist: 0 },
  clash: { push: 0.6, radius: 2.0, life: 1.6, throw: 1.6, lift: 0.7, flakes: 0.45, heat: 0.3, mist: 0 },
  blow: { push: 1.0, radius: 2.8, life: 2.2, throw: 2.3, lift: 1.0, flakes: 0.8, heat: 0.4, mist: 0 },
  fall: { push: 0.8, radius: 3.0, life: 2.6, throw: 1.8, lift: 1.5, flakes: 1, heat: 0.2, mist: 0.3 },
  slam: { push: 1.4, radius: 4.5, life: 2.8, throw: 3.0, lift: 1.4, flakes: 1, heat: 0.35, mist: 0.6 },
  shot: { push: 0.9, radius: 2.5, life: 1.8, throw: 2.0, lift: 0.8, flakes: 0.5, heat: 0.5, mist: 0 },
  spell: { push: 1.8, radius: 5.5, life: 3.2, throw: 3.6, lift: 2.2, flakes: 1, heat: 0.7, mist: 0.8 },
  rite: { push: 2.2, radius: 7.0, life: 4.0, throw: 4.2, lift: 3.0, flakes: 1, heat: 0.6, mist: 1 },
};

/** How many impulses the air remembers at once: the size of the uniform arrays a shader holds them in. */
export const AIR_SLOTS = 12;
/** Seconds an impulse takes to come on: the air is not moved in one frame. */
export const AIR_RISE = 0.12;
/** The least and the most an event's power may scale its kind by. */
export const AIR_POWER = { min: 0.25, max: 1.6 } as const;
/** Seconds the mist takes to answer an impulse. */
const MIST_RISE = 0.5;
/** Two reports of one event (the same kind, this close in metres and seconds) are one impulse: the stronger. */
const SAME_EVENT = { metres: 0.6, seconds: 0.1 };

export interface AirImpulse {
  kind: AirImpulseKind;
  /** Where, in metres. */
  x: number; y: number; z: number;
  /** How hard, about 1 (a strike's power, a dust cue's strength). */
  power?: number;
  /** Seconds from now until it happens (a body that will reach the stone at the end of its topple). */
  delay?: number;
}

/**
 * How much of an impulse is left `age` seconds after it began, 0 to 1: it comes on over {@link AIR_RISE} and dies
 * away with no step at either end (value and slope both reach 0 at `life`). The shaders hold the same formula
 * (arena-physics.ts AIR_MOTION_GLSL).
 */
export function airEnvelope(age: number, life: number): number {
  if (!(age > 0) || !(life > 0) || age >= life) return 0;
  const rise = Math.min(1, age / AIR_RISE), left = 1 - age / life;
  return rise * rise * (3 - 2 * rise) * left * left;
}

/** The field: what a shader reads, and the one place impulses are added. */
export interface AirDisturbance {
  readonly slots: number;
  /** Per slot: x, y, z (metres), radius (metres). */
  readonly a: Float32Array;
  /** Per slot: the time it begins, push (metres), life (seconds), throw (metres). A life of 0 is an empty slot. */
  readonly b: Float32Array;
  /** Per slot: lift (metres), share of flakes raised, share that glow, how far it thins the mist. */
  readonly c: Float32Array;
  /** Counts up each time the arrays change, so they are uploaded only then. */
  readonly version: number;
  /** Adds an impulse at the arena's time `now`. Returns its slot, or -1 when it was not worth one. */
  push(impulse: AirImpulse, now: number): number;
  /** One past the last slot still to be read at `now` (0 when the air is at rest): the shaders' loop bound. */
  live(now: number): number;
  /** How far the air at a point is pushed at `now`, in metres: what the ash's shader works out for a flake. */
  pushAt(x: number, y: number, z: number, now: number, out?: [number, number, number]): [number, number, number];
  /** The impulse that thins the mist most at `now` (x, z, radius it has rolled out to, amount 0 to 1), or amount 0. */
  mistAt(now: number, out?: [number, number, number, number]): [number, number, number, number];
  /** Empties the field at once: a new board, or a clock that has gone back. */
  clear(): void;
}

const finite = (value: number) => typeof value === "number" && Number.isFinite(value);

export function createAirDisturbance(slots = AIR_SLOTS): AirDisturbance {
  const a = new Float32Array(slots * 4), b = new Float32Array(slots * 4), c = new Float32Array(slots * 4);
  const kinds: (AirImpulseKind | null)[] = Array.from({ length: slots }, () => null);
  let version = 0;
  /** What a slot still has to give at `now`: its push, as much as is left of it (all of it before it has begun). */
  const weight = (slot: number, now: number): number => {
    const life = b[slot * 4 + 2];
    if (life <= 0) return 0;
    const age = now - b[slot * 4];
    if (age >= life) return 0;
    return b[slot * 4 + 1] * (age <= 0 ? 1 : Math.max(airEnvelope(age, life), 0.05 * (1 - age / life)));
  };
  const write = (slot: number, impulse: AirImpulse, shape: AirImpulseShape, power: number, start: number) => {
    const reach = Math.sqrt(power);
    a.set([impulse.x, impulse.y, impulse.z, shape.radius * reach], slot * 4);
    b.set([start, shape.push * power, shape.life, shape.throw * power], slot * 4);
    c.set([shape.lift * power, shape.flakes, shape.heat, shape.mist * Math.min(1, power)], slot * 4);
    kinds[slot] = impulse.kind;
    version += 1;
  };
  return {
    slots, a, b, c,
    get version() { return version; },
    push(impulse, now) {
      const shape = AIR_IMPULSES[impulse.kind];
      if (!shape || !finite(impulse.x) || !finite(impulse.y) || !finite(impulse.z) || !finite(now)) return -1;
      const asked = impulse.power ?? 1, delay = impulse.delay ?? 0;
      if (!finite(asked) || asked <= 0 || !finite(delay)) return -1;
      const power = Math.min(AIR_POWER.max, Math.max(AIR_POWER.min, asked)), start = now + Math.max(0, delay);
      let free = -1, weakest = -1, least = Infinity;
      for (let slot = 0; slot < slots; slot++) {
        const left = weight(slot, now);
        if (left <= 0) { if (free < 0) free = slot; continue; }
        // the same event told twice (a fall's burst and its smoke) is one impulse, the stronger of the two
        if (kinds[slot] === impulse.kind && Math.abs(b[slot * 4] - start) <= SAME_EVENT.seconds
          && Math.hypot(a[slot * 4] - impulse.x, a[slot * 4 + 1] - impulse.y, a[slot * 4 + 2] - impulse.z) <= SAME_EVENT.metres) {
          if (shape.push * power > b[slot * 4 + 1]) write(slot, impulse, shape, power, b[slot * 4]);
          return slot;
        }
        if (left < least) { least = left; weakest = slot; }
      }
      // the lowest free slot, so the shaders' loop stays short; with none free, the one with least left to give
      // makes way, but only for something stronger than what it still has (a step never ends a spell's wave early)
      if (free < 0) {
        if (weakest < 0 || least >= shape.push * power) return -1;
        free = weakest;
      }
      write(free, impulse, shape, power, start);
      return free;
    },
    live(now) {
      let count = 0;
      for (let slot = 0; slot < slots; slot++) if (b[slot * 4 + 2] > 0 && now < b[slot * 4] + b[slot * 4 + 2]) count = slot + 1;
      return count;
    },
    pushAt(x, y, z, now, out = [0, 0, 0]) {
      out[0] = out[1] = out[2] = 0;
      for (let slot = 0; slot < slots; slot++) {
        const life = b[slot * 4 + 2], age = now - b[slot * 4];
        if (life <= 0 || age <= 0 || age >= life) continue;
        let dx = x - a[slot * 4], dy = y - a[slot * 4 + 1], dz = z - a[slot * 4 + 2];
        const radius = a[slot * 4 + 3], distance = Math.hypot(dx, dy, dz);
        const amount = b[slot * 4 + 1] * airEnvelope(age, life) * Math.exp(-(distance * distance) / (radius * radius));
        // outward, and lifted as well as parted: the stone is under it, so the air goes up
        dy = dy * 0.5 + 0.35 * distance + 1e-4;
        const length = Math.hypot(dx, dy, dz);
        out[0] += dx / length * amount; out[1] += dy / length * amount; out[2] += dz / length * amount;
      }
      return out;
    },
    mistAt(now, out = [0, 0, 1, 0]) {
      out[0] = out[1] = 0; out[2] = 1; out[3] = 0;
      for (let slot = 0; slot < slots; slot++) {
        const life = b[slot * 4 + 2], age = now - b[slot * 4], thin = c[slot * 4 + 3];
        if (life <= 0 || thin <= 0 || age <= 0 || age >= life) continue;
        // slower to come on than the push itself: the wave has the board to cross before it reaches the mist
        const come = Math.min(1, age / MIST_RISE), left = 1 - age / life;
        const amount = Math.min(0.85, thin * come * come * (3 - 2 * come) * left * left * 1.6);
        if (amount <= out[3]) continue;
        // the hole rolls outward as it fills
        out[0] = a[slot * 4]; out[1] = a[slot * 4 + 2]; out[2] = a[slot * 4 + 3] * (1 + 1.5 * age / life); out[3] = amount;
      }
      return out;
    },
    clear() {
      if (!kinds.some((kind) => kind !== null)) return;
      a.fill(0); b.fill(0); c.fill(0); kinds.fill(null);
      version += 1;
    },
  };
}

/** The wind at a moment: what it has carried the air by, and how fast it blows. Metres and metres a second. */
export interface AirWind {
  /** How far the wind has carried the air since the arena's clock began (x, z): for what drifts and wraps (ash, mist). */
  driftX: number; driftZ: number;
  /** The gusts' share of that: how far the air stands from where a steady wind would have left it. It stays within a
   * couple of metres, for what must not drift away (the ember column leans by it). */
  gustX: number; gustZ: number;
  /** The wind now. */
  speedX: number; speedZ: number;
}

/**
 * The steady wind (what the ash always drifted at), the gusts along it and the wind across it. Each gust is a slow
 * sine with its own period, none a multiple of another, so the pattern does not come round within a match.
 */
export const AIR_WIND = {
  along: 0.25,
  gusts: [{ share: 0.5, period: 23 }, { share: 0.3, period: 9.1 }],
  across: [{ speed: 0.18, period: 31, phase: 0 }, { speed: 0.08, period: 13.7, phase: 1.3 }],
} as const;

/**
 * The wind `time` seconds into the arena's clock: a pure function of the time, so a clock held (pause), slowed (a
 * fatality) or stopped at 0 (reduced motion) holds, slows or stills the wind with it. At 0 nothing has drifted.
 */
export function airWind(time: number, out: AirWind = { driftX: 0, driftZ: 0, gustX: 0, gustZ: 0, speedX: 0, speedZ: 0 }): AirWind {
  const t = finite(time) ? time : 0;
  let speedX = AIR_WIND.along, gustX = 0, speedZ = 0, gustZ = 0;
  for (const gust of AIR_WIND.gusts) {
    const rate = 2 * Math.PI / gust.period;
    speedX += AIR_WIND.along * gust.share * Math.sin(rate * t);
    gustX += AIR_WIND.along * gust.share * (1 - Math.cos(rate * t)) / rate;
  }
  for (const cross of AIR_WIND.across) {
    const rate = 2 * Math.PI / cross.period;
    speedZ += cross.speed * Math.sin(rate * t + cross.phase);
    gustZ += cross.speed * (Math.cos(cross.phase) - Math.cos(rate * t + cross.phase)) / rate;
  }
  out.speedX = speedX; out.speedZ = speedZ; out.gustX = gustX; out.gustZ = gustZ;
  out.driftX = AIR_WIND.along * t + gustX; out.driftZ = gustZ;
  return out;
}
