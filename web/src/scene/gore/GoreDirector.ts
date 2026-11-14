/**
 * The Gore Director: what one weapon contact leaves visible. Pure and
 * deterministic: the same {@link GoreEvent} always yields the same
 * {@link GorePlan}, so a replay shows the same wound and the same stains, and
 * Undo followed by the same capture puts them back exactly.
 *
 * It decides nothing about the game. The capture, the fight and its outcome
 * are already fixed when an event reaches it. And it records nothing about
 * the character: in Classic play blood is presentation, never an injury.
 *
 * Stains are planned, never collided. Every droplet flies the closed-form
 * path of ballistics.ts, so the planner knows where each one meets the board
 * and marks the stone there; the renderer never tests a particle against it.
 */
import { GORE_GRAVITY, flightVelocity, landingTime, type Launch } from "./ballistics";
import { goreBudget } from "./GoreQuality";
import { GORE_PROFILES } from "./GoreProfiles";
import { goreShow } from "./goreTiers";
import { GORE_VERSION, type GoreEvent, type GorePlan, type PoolPlan, type SplashPlan, type SprayPlan, type StainPlan, type Vec3 } from "./GoreTypes";
import { resolveImpact } from "./ImpactResolver";
import { planWoundMask } from "./woundMaskPlan";

export const DEFAULT_BOARD = { top: 0, tile: 1.02, squares: 8 } as const;

/** One droplet of a spray. `expandSpray` reuses a single instance: copy what you keep. */
export interface Droplet extends Launch {
  index: number;
  /** 0: a drop that flies and lands. 1: mist that hangs and fades. */
  kind: 0 | 1;
  /** Seconds after the contact at which it leaves. */
  delay: number;
  /** Seconds it is in the air: until it lands, or until mist has faded. */
  life: number;
  /** Radius, world units. */
  size: number;
  lands: boolean;
  landX: number; landZ: number;
  /** 0..1, for the shape of whatever it leaves. */
  shape: number;
}

/** Stateless hash to [0, 1): a droplet's numbers depend only on (seed, index, channel). */
export function hash01(seed: number, index: number, channel: number): number {
  let h = (seed ^ Math.imul(index + 1, 0x9e3779b1) ^ Math.imul(channel + 1, 0x85ebca6b)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const scratch: Droplet = {
  index: 0, kind: 0, delay: 0, life: 0, size: 0, lands: false, landX: 0, landZ: 0, shape: 0,
  origin: { x: 0, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, drag: 1,
};
const landed: Vec3 = { x: 0, y: 0, z: 0 };
const TAU = Math.PI * 2;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

/**
 * Every droplet of a spray, in order, with its landing already solved.
 * Allocates nothing: the visitor receives one reused {@link Droplet}.
 */
export function expandSpray(spray: SprayPlan, top: number, visit: (droplet: Droplet) => void): void {
  const a = spray.axis;
  // An orthonormal frame around the axis.
  let ux = a.z, uy = 0, uz = -a.x;
  let length = Math.hypot(ux, uz);
  if (length < 1e-4) { ux = 1; uz = 0; length = 1; }
  ux /= length; uz /= length;
  const vx = a.y * uz - a.z * uy, vy = a.z * ux - a.x * uz, vz = a.x * uy - a.y * ux;
  const total = spray.droplets + spray.mist, d = scratch;
  for (let i = 0; i < total; i += 1) {
    const mist = i >= spray.droplets;
    const theta = spray.spread * Math.pow(hash01(spray.seed, i, 0), 0.7) * (mist ? 1.5 : 1), phi = TAU * hash01(spray.seed, i, 1);
    const sin = Math.sin(theta), cos = Math.cos(theta), cu = Math.cos(phi) * sin, cv = Math.sin(phi) * sin;
    const size = lerp(spray.size[0], spray.size[1], Math.pow(hash01(spray.seed, i, 3), 2));
    const speed = lerp(spray.speed[0], spray.speed[1], hash01(spray.seed, i, 2)) * (mist ? 0.4 : 1);
    d.index = i; d.kind = mist ? 1 : 0;
    d.delay = spray.delay + hash01(spray.seed, i, 4) * (mist ? 0.03 : 0.07);
    d.size = mist ? size * 4.5 : size;
    d.shape = hash01(spray.seed, i, 5);
    // The finer the droplet, the sooner the air stops it.
    d.drag = mist ? 5 : clamp(0.014 / size, 1, 4);
    d.origin.x = spray.origin.x; d.origin.y = spray.origin.y; d.origin.z = spray.origin.z;
    d.velocity.x = (a.x * cos + ux * cu + vx * cv) * speed;
    d.velocity.y = (a.y * cos + uy * cu + vy * cv) * speed;
    d.velocity.z = (a.z * cos + uz * cu + vz * cv) * speed;
    const flight = mist ? -1 : landingTime(d, top);
    d.lands = flight > 0;
    d.life = d.lands ? flight : mist ? 0.45 + 0.35 * d.shape : 0;
    if (d.lands) {
      const k = (1 - Math.exp(-d.drag * flight)) / d.drag;
      d.landX = d.origin.x + d.velocity.x * k; d.landZ = d.origin.z + d.velocity.z * k;
    } else { d.landX = d.origin.x; d.landZ = d.origin.z; }
    visit(d);
  }
}

const unit = (v: Vec3, fallback: Vec3): Vec3 => {
  const length = Math.hypot(v.x, v.y, v.z);
  return length > 1e-6 && Number.isFinite(length) ? { x: v.x / length, y: v.y / length, z: v.z / length } : fallback;
};

function silentPlan(event: GoreEvent, surface: GorePlan["surface"], silent: GorePlan["silent"]): GorePlan {
  return {
    version: GORE_VERSION, impactId: event.impactId, ply: event.ply, seed: event.seed >>> 0, surface, silent,
    sprays: [], stains: [], wound: null, pool: null, weaponStain: null, splashes: [], consequence: "presentation",
  };
}

export function planGore(event: GoreEvent): GorePlan {
  const surface = resolveImpact(event);
  // The menu's background game shows nothing; a King is never captured, so there is no checkmate gore.
  if (event.flags.menuBoard) return silentPlan(event, surface, "menu");
  if (event.defender.kind === "k") return silentPlan(event, surface, "king");
  if (!surface.breached) return silentPlan(event, surface, "no-breach");

  const seed = event.seed >>> 0;
  const top = event.board?.top ?? DEFAULT_BOARD.top, tile = event.board?.tile ?? DEFAULT_BOARD.tile;
  const half = (event.board?.squares ?? DEFAULT_BOARD.squares) * tile / 2;
  const budget = goreBudget(event.quality, event.intensity), profile = GORE_PROFILES[event.attacker.weapon];
  const { reducedMotion, tactical } = event.flags;
  /** Nothing flies; what would have landed is simply there. */
  const still = reducedMotion || tactical;
  const power = clamp(Number.isFinite(event.power) ? event.power : 1, 0.3, 2);
  const point = event.contact.point;
  const dir = unit(event.contact.direction, { x: 0, y: 0, z: 1 });
  const normal = unit(event.contact.normal, { x: -dir.x, y: -dir.y, z: -dir.z });
  const flat = unit({ x: dir.x, y: 0, z: dir.z }, { x: 0, y: 0, z: 1 });
  const side = { x: flat.z, y: 0, z: -flat.x };
  const roll = (channel: number) => hash01(seed, 0x7fff, channel);

  // ---- sprays: the first burst along the blow, a weaker second pulse, slow drips from the wound.
  const lean = (roll(0) - 0.5) * 0.3;
  const axis = unit({
    x: dir.x * profile.along + normal.x * profile.out + side.x * lean,
    y: dir.y * profile.along + normal.y * profile.out + profile.up,
    z: dir.z * profile.along + normal.z * profile.out + side.z * lean,
  }, { x: 0, y: 1, z: 0 });
  const count = Math.min(budget.maxDroplets, Math.round(budget.droplets * (0.55 + 0.45 * power)));
  const second = budget.spurt ? Math.round(count * 0.25) : 0;
  const energy = 0.75 + 0.25 * power;
  const size: readonly [number, number] = [profile.size[0] * tile, profile.size[1] * tile];
  const sprays: SprayPlan[] = [];
  if (count > 0) {
    sprays.push({
      id: "spray", seed: (seed ^ 0x51ed270b) >>> 0, delay: 0, origin: { ...point }, axis, spread: profile.spread,
      droplets: count - second, mist: budget.mist, speed: [profile.speed[0] * energy, profile.speed[1] * energy], size,
    });
    if (second > 0) {
      sprays.push({
        id: "spurt", seed: (seed ^ 0x2f6b9d35) >>> 0, delay: 0.16, origin: { ...point }, axis, spread: profile.spread * 0.8,
        droplets: second, mist: 0, speed: [profile.speed[0] * energy * 0.6, profile.speed[1] * energy * 0.6], size,
      });
    }
    for (let i = 0; i < budget.drips; i += 1) {
      // The body gives ground and sinks as it bleeds: each drop leaves a little further back and lower.
      const back = (0.05 + 0.07 * i) * tile, height = Math.max(top + 0.12 * tile, point.y - (point.y - top) * 0.1 * i);
      sprays.push({
        id: "drip", seed: (seed ^ Math.imul(i + 1, 0x68e31da4)) >>> 0, delay: 0.3 + 0.24 * i + 0.1 * roll(10 + i),
        origin: { x: point.x + dir.x * back, y: height, z: point.z + dir.z * back },
        axis: { x: 0, y: -1, z: 0 }, spread: 0.5, droplets: 1, mist: 0, speed: [0.1, 0.45], size: [size[0] * 1.2, size[0] * 1.8],
      });
    }
  }

  // ---- stains: one under the wound, the rest where the heaviest droplets come down.
  const stains: StainPlan[] = [];
  const inside = (x: number, z: number, radius: number) => Math.abs(x) <= half - radius && Math.abs(z) <= half - radius;
  const contactRadius = budget.stainRadius * tile * (event.intensity === "minimal" ? 1 : 0.85);
  const under = { x: clamp(point.x + flat.x * 0.1 * tile, -half + contactRadius, half - contactRadius), z: clamp(point.z + flat.z * 0.1 * tile, -half + contactRadius, half - contactRadius) };
  stains.push({
    at: still ? 0 : Math.sqrt(2 * Math.max(0, point.y - top) / GORE_GRAVITY), x: under.x, z: under.z,
    radius: contactRadius, rotation: TAU * roll(1), stretch: 1, shape: roll(2), source: "contact",
  });
  const wanted = budget.stains - 1;
  if (wanted > 0) {
    const best: StainPlan[] = [];
    const weight: number[] = [];
    for (const spray of sprays) {
      if (spray.id === "drip") continue;
      expandSpray(spray, top, droplet => {
        if (!droplet.lands) return;
        const radius = clamp(droplet.size * 7, 0.05 * tile, budget.stainRadius * tile) * (0.85 + 0.3 * droplet.shape);
        if (!inside(droplet.landX, droplet.landZ, radius)) return;
        // Keep the marks apart: two droplets in one place are one stain.
        for (const other of best) if (Math.hypot(other.x - droplet.landX, other.z - droplet.landZ) < 0.16 * tile) return;
        if (Math.hypot(under.x - droplet.landX, under.z - droplet.landZ) < 0.16 * tile) return;
        if (best.length >= wanted && droplet.size <= weight[weight.length - 1]) return;
        flightVelocity(droplet, droplet.life, landed);
        const run = Math.hypot(landed.x, landed.z);
        const stain: StainPlan = {
          at: still ? 0 : droplet.delay + droplet.life, x: droplet.landX, z: droplet.landZ, radius,
          rotation: run > 1e-6 ? Math.atan2(-landed.z, landed.x) : TAU * droplet.shape,
          stretch: 1 + Math.min(1.4, run * 0.45), shape: droplet.shape, source: "spray",
        };
        let slot = best.length;
        while (slot > 0 && weight[slot - 1] < droplet.size) slot -= 1;
        best.splice(slot, 0, stain); weight.splice(slot, 0, droplet.size);
        if (best.length > wanted) { best.pop(); weight.pop(); }
      });
    }
    best.sort((a, b) => a.at - b.at);
    stains.push(...best);
  }

  // ---- the pool under the body, from the landing on.
  let pool: PoolPlan | null = null;
  if (budget.pool && !tactical) {
    const maxRadius = budget.poolRadius * profile.pool * tile * (0.8 + 0.25 * Math.min(1.6, power));
    const reach = half - maxRadius * 0.5;
    const rest = event.rest ?? { x: point.x + flat.x * 0.45 * tile, z: point.z + flat.z * 0.45 * tile };
    pool = {
      x: clamp(rest.x + (roll(3) - 0.5) * 0.1 * tile, -reach, reach), z: clamp(rest.z + (roll(4) - 0.5) * 0.1 * tile, -reach, reach),
      delay: reducedMotion ? 0 : 0.12, grow: reducedMotion || !budget.poolAnimated ? 0 : event.intensity === "full" ? 9 : 7,
      maxRadius, grooveBias: 0.5, shape: roll(5),
    };
  }

  // ---- what comes back at the killer: the spearhead first, then the armour facing the wound, then the shaft.
  // Each is a droplet of the plan (direction and size fixed here); where the armour ones land is where that
  // droplet first meets the attacker's body as it stands on the contact frame.
  const splashes: SplashPlan[] = [];
  if (budget.weaponStain !== "none" && !tactical) {
    for (let i = 0; i < budget.splashes; i += 1) {
      const a = hash01(seed, 0x6000 + i, 0), b = hash01(seed, 0x6000 + i, 1), c = hash01(seed, 0x6000 + i, 2);
      if (i % 2 === 0) {
        splashes.push({
          target: "weapon", at: 0, direction: { x: 0, y: 0, z: 0 }, along: (i === 0 ? 0.03 + 0.05 * a : 0.16 + 0.14 * a) * tile,
          size: (i === 0 ? 0.034 : 0.024) * tile * (0.85 + 0.3 * b), shape: c,
        });
      } else {
        // Back out of the wound, at the killer's chest and the arms in front of it.
        const aim = event.killer
          ? unit({ x: event.killer.x - point.x, y: event.killer.y - point.y, z: event.killer.z - point.z }, normal)
          : unit({ x: normal.x - dir.x * 0.4, y: normal.y + 0.1, z: normal.z - dir.z * 0.4 }, normal);
        // A small scatter only: a killer in mid-thrust stands side-on and is a narrow target.
        const back = unit({ x: aim.x + side.x * (a - 0.5) * 0.1, y: aim.y + (b - 0.5) * 0.12, z: aim.z + side.z * (a - 0.5) * 0.1 }, aim);
        splashes.push({ target: "attacker", at: still ? 0 : 0.07, direction: back, along: 0, size: 0.04 * tile * (0.8 + 0.4 * c), shape: c });
      }
    }
  }

  // The wound's own frame on the surface: x to the right, y up the body, z out of it.
  const right = unit({ x: normal.z, y: 0, z: -normal.x }, side);
  const rise = { x: normal.y * right.z - normal.z * right.y, y: normal.z * right.x - normal.x * right.z, z: normal.x * right.y - normal.y * right.x };
  const offset = { x: (roll(6) - 0.5) * 0.03 * tile, y: (roll(7) - 0.5) * 0.03 * tile, z: 0 };

  // What the wound paints into the figure's own mask, at the tier this kill is (goreTiers.ts).
  const woundKind = event.wound ?? profile.wound;
  const woundSize = profile.woundSize * tile * (0.75 + 0.25 * Math.min(1.5, power));
  const bleed = reducedMotion ? 0 : event.intensity === "full" ? 4 : 2.5;
  const show = goreShow(
    { attacker: event.attacker.kind, victim: event.defender.kind, style: event.moment?.style ?? "melee", weapon: event.attacker.weapon, mate: event.moment?.mate, last: event.moment?.last },
    { violence: event.intensity, reducedMotion, captureCinematics: event.flags.captureCinematics ?? true, tactical, menuBoard: event.flags.menuBoard },
    event.quality,
  );
  const mask = show.cuts ? planWoundMask({
    kind: woundKind, size: woundSize, power, intensity: event.intensity, quality: event.quality, tier: show.tier, mask: show.budget.mask,
    interiors: show.interiors, fabric: show.fabric, bleed, seed: (seed ^ 0x3c6ef372) >>> 0,
  }) : null;

  return {
    version: GORE_VERSION, impactId: event.impactId, ply: event.ply, seed, surface, silent: null,
    sprays: still ? [] : sprays,
    stains,
    wound: budget.wound && !tactical ? {
      kind: woundKind, anchor: event.contact.anchor, offset,
      point: { x: point.x + right.x * offset.x + rise.x * offset.y, y: point.y + right.y * offset.x + rise.y * offset.y, z: point.z + right.z * offset.x + rise.z * offset.y },
      normal, size: woundSize, shape: roll(8), bleed,
      bind: budget.skinWound ? "skin" : "bone",
      mask,
    } : null,
    pool,
    splashes,
    weaponStain: budget.weaponStain !== "none" && !tactical
      ? { anchor: "weapon", point: { ...point }, size: 0.032 * tile, shape: roll(9), linger: budget.weaponStain === "lingering" ? null : 6 } : null,
    consequence: "presentation",
  };
}
