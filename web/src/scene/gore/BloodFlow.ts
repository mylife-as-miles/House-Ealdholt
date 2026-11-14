/**
 * Blood that keeps moving after the blow: the slow drops that fall from the
 * wound while the defender staggers and goes down, and the pool that spreads
 * under the body from the moment it lands.
 *
 * Both reuse the shared pools: a drip is a droplet in BloodParticles, a pool is
 * an instance in BloodDecals whose shader spreads it over `grow` seconds,
 * unevenly and further along the lines between squares (no scaling circle).
 * Trails and streaks that follow animated bones are Milestone 03.
 */
import type { BloodDecals } from "./BloodDecals";
import type { ParticleBackend } from "./BloodParticles";
import { expandSpray, type Droplet } from "./GoreDirector";
import type { PoolPlan, SprayPlan } from "./GoreTypes";

export class BloodFlow {
  constructor(private readonly particles: ParticleBackend, private readonly decals: BloodDecals, private readonly top: number) {}

  private base = 0;
  private readonly emit = (droplet: Droplet) => { this.particles.emit(droplet, droplet.delay - this.base); };

  /** A planned spray or drip leaves now. */
  release(spray: SprayPlan): void {
    // The ledger has already waited `spray.delay`: only each droplet's own jitter remains.
    this.base = spray.delay;
    expandSpray(spray, this.top, this.emit);
  }

  pool(impactId: string, pool: PoolPlan, at: { x: number; z: number }): void {
    this.decals.add(impactId, {
      kind: 1, x: at.x, z: at.z, radius: pool.maxRadius, rotation: pool.shape * Math.PI * 2,
      shape: pool.shape, stretch: 1, grow: pool.grow, grooveBias: pool.grooveBias,
    });
  }
}
