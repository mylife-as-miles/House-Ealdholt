/**
 * The visual language of a heavy blow.
 *
 * A footsoldier's kill is sparks and a shove; the ranks above it hit hard
 * enough to leave something behind — steel cutting the air, a wave rolling out
 * across the stone, or a column of light dropped on the condemned before the
 * crown even swings. Each helper takes its objects from a small pool, animates them
 * off the caller's tween clock and hands them back, so nothing here needs a
 * slot in the frame loop, and a long match does not make and free a material per blow (A-26).
 */

import * as THREE from "three";

import type { SpellLight } from "./spells";
import { crescentTexture, factionRingTexture, pillarTexture, shockwaveTexture } from "./textures";
import { Ease, type TweenManager } from "./tween";

let crescentMap: THREE.CanvasTexture | null = null;
let waveMap: THREE.CanvasTexture | null = null;
let pillarMap: THREE.CanvasTexture | null = null;
let sealMap: THREE.CanvasTexture | null = null;
let waveGeometry: THREE.PlaneGeometry | null = null;
let pillarGeometry: THREE.CylinderGeometry | null = null;

function sharedCrescentMap(): THREE.CanvasTexture {
  if (!crescentMap) crescentMap = crescentTexture();
  return crescentMap;
}

function sharedWaveMap(): THREE.CanvasTexture {
  if (!waveMap) waveMap = shockwaveTexture();
  return waveMap;
}

function sharedPillarMap(): THREE.CanvasTexture {
  if (!pillarMap) pillarMap = pillarTexture();
  return pillarMap;
}

function sharedSealMap(): THREE.CanvasTexture {
  if (!sealMap) sealMap = factionRingTexture("sunburst");
  return sealMap;
}

function sharedWaveGeometry(): THREE.PlaneGeometry {
  if (!waveGeometry) waveGeometry = new THREE.PlaneGeometry(2, 2);
  return waveGeometry;
}

function sharedPillarGeometry(): THREE.CylinderGeometry {
  if (!pillarGeometry) pillarGeometry = new THREE.CylinderGeometry(1, 1, 1, 28, 1, true);
  return pillarGeometry;
}

/** A pooled disc: an additive, two-sided plane or column, its map and colour set by whoever takes it. */
type Disc = THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
const spareDiscs: Disc[] = [];
const spareSlashes: THREE.Sprite[] = [];
/** Spares kept of each: a few blows' worth (a blow uses up to three discs). */
const SPARES = 12;

function takeDisc(geometry: THREE.BufferGeometry, map: THREE.Texture, color: number, opacity: number): Disc {
  const disc = spareDiscs.pop() ?? new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  }));
  disc.geometry = geometry;
  disc.material.map = map;
  disc.material.color.set(color);
  disc.material.opacity = opacity;
  disc.position.set(0, 0, 0); disc.rotation.set(0, 0, 0); disc.scale.set(1, 1, 1);
  return disc;
}

function releaseDisc(disc: Disc): void {
  disc.removeFromParent();
  if (spareDiscs.length < SPARES) spareDiscs.push(disc); else disc.material.dispose();
}

/** How many discs and slashes wait to be reused: for the pooling test. */
export function strikeSpares(): { discs: number; slashes: number } { return { discs: spareDiscs.length, slashes: spareSlashes.length }; }

/** Frees the shared maps and geometry (scene teardown). */
export function disposeStrikeAssets(): void {
  for (const disc of spareDiscs.splice(0)) disc.material.dispose();
  for (const slash of spareSlashes.splice(0)) slash.material.dispose();
  crescentMap?.dispose();
  waveMap?.dispose();
  pillarMap?.dispose();
  sealMap?.dispose();
  waveGeometry?.dispose();
  pillarGeometry?.dispose();
  crescentMap = null;
  waveMap = null;
  pillarMap = null;
  sealMap = null;
  waveGeometry = null;
  pillarGeometry = null;
}

export interface SlashOptions {
  /** Colour of the steel — cold white for a blade, gold for the crown. */
  color: number;
  /** Width of the arc in world units. */
  size: number;
  /** In-plane angle of the swing, in radians. */
  tilt?: number;
  /** How long the arc stays on screen. */
  life?: number;
}

/**
 * The cut itself: a crescent of light thrown through the body on the frame the
 * blade lands, swinging a little further and stretching as it fades — a
 * billboard, so it reads from any camera angle on the board.
 */
export async function spawnSlash(
  scene: THREE.Object3D,
  tweens: TweenManager,
  at: THREE.Vector3,
  options: SlashOptions,
): Promise<void> {
  const life = options.life ?? 0.22;
  const tilt = options.tilt ?? -0.7;
  const sprite = spareSlashes.pop() ?? new THREE.Sprite(new THREE.SpriteMaterial({
    map: sharedCrescentMap(),
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
  }));
  const material = sprite.material;
  material.map = sharedCrescentMap();
  material.color.set(options.color);
  material.opacity = 1;
  material.rotation = tilt;
  sprite.position.copy(at);
  sprite.renderOrder = 8;
  sprite.frustumCulled = false;
  sprite.scale.set(options.size * 0.72, options.size * 0.72, 1);
  scene.add(sprite);

  try {
    await tweens.to({
      duration: life,
      easing: Ease.outCubic,
      onUpdate: (t) => {
        // Opens fast, keeps travelling as it thins out.
        const spread = options.size * (0.72 + t * 0.66);
        sprite.scale.set(spread, spread * (1 - t * 0.22), 1);
        material.rotation = tilt + t * 0.85;
        material.opacity = t < 0.18 ? t / 0.18 : Math.pow(1 - (t - 0.18) / 0.82, 1.6);
      },
    });
  } finally {
    sprite.removeFromParent();
    if (spareSlashes.length < SPARES) spareSlashes.push(sprite); else material.dispose();
  }
}

export interface GroundWaveOptions {
  color: number;
  /** Radius the wave reaches, in world units. */
  radius: number;
  /** Height of the plane above the floor. */
  height: number;
  life?: number;
  /** Second, wider echo rolling out behind the first. */
  echo?: boolean;
}

/**
 * Force going into the floor: a ring of light rolling outward from the point of
 * impact and dying as it widens. What a hammer or a sceptre leaves behind — a
 * blade never gets one.
 */
export async function spawnGroundWave(
  scene: THREE.Object3D,
  tweens: TweenManager,
  at: THREE.Vector3,
  options: GroundWaveOptions,
): Promise<void> {
  const life = options.life ?? 0.5;
  const ring = takeDisc(sharedWaveGeometry(), sharedWaveMap(), options.color, 0.95);
  const material = ring.material;
  ring.rotation.x = -Math.PI / 2;
  ring.rotation.z = Math.random() * Math.PI;
  ring.position.set(at.x, options.height, at.z);
  ring.renderOrder = 7;
  ring.scale.setScalar(0.18);
  scene.add(ring);

  const echo = options.echo === true ? takeDisc(sharedWaveGeometry(), sharedWaveMap(), options.color, 0.5) : null;
  const echoMaterial = echo?.material ?? null;
  if (echo) {
    echo.rotation.copy(ring.rotation);
    echo.scale.copy(ring.scale);
    echo.renderOrder = ring.renderOrder;
    echo.position.set(at.x, options.height + 0.004, at.z);
    scene.add(echo);
  }

  try {
    await tweens.to({
      duration: life,
      easing: Ease.linear,
      onUpdate: (t) => {
        const eased = 1 - Math.pow(1 - t, 2.4);
        ring.scale.setScalar(0.18 + eased * options.radius * 0.5);
        material.opacity = Math.pow(1 - t, 1.6) * 0.95;
        ring.rotation.z += 0.006;
        if (echo && echoMaterial) {
          // The echo leaves later and travels further, so the stone reads as
          // still ringing after the blow.
          const lag = Math.max(0, (t - 0.22) / 0.78);
          const spread = 1 - Math.pow(1 - lag, 2.2);
          echo.scale.setScalar(0.18 + spread * options.radius * 0.76);
          echoMaterial.opacity = Math.pow(1 - lag, 2) * 0.45;
        }
      },
    });
  } finally {
    releaseDisc(ring);
    if (echo) releaseDisc(echo);
  }
}

export interface ConquestClaimOptions {
  /** The victor's colours — the whole point is *whose* square this now is. */
  color: number;
  /** How wide the ring starts, in world units, before it closes. */
  radius: number;
  /** Height of the discs above the floor. */
  height: number;
  /** 0 a footsoldier was taken, 1 the crown: scales the hold and the size. */
  weight?: number;
  /**
   * How large it is drawn, against its size from the player's seat (1): where the loop starts, the army's mark, and
   * how far both drift out as they let go. The loop still closes onto the figure's own ring. A shot nearer the board
   * than the player's seat passes less (sceneEngine claimSquare): drawn for the seat, the mark spanned three squares
   * there and lay over the body beside the tile.
   */
  scale?: number;
}

/**
 * The brightest the loop and the army's mark are drawn, added over the stone. Halved by the VFX audit (from 0.95
 * and 0.7): in the side's bright UI colour, the ring was the brightest thing in a close shot.
 */
const CLAIM_LOOP_PEAK = 0.475, CLAIM_SEAL_PEAK = 0.35;

/**
 * A square taken off the enemy.
 *
 * Every other ring on this board travels *outward* — blows, landings, waves.
 * This one closes **inward**: a wide loop of the victor's colour drawn tight
 * around the tile, brightening as it converges, snapping shut into the army's
 * own mark and letting go. The reversed motion is the signature. Nothing else
 * in the game moves that way, so a claimed square cannot be mistaken for an
 * impact even at the edge of vision.
 *
 * Two throwaway discs on the caller's tween clock, disposed on the way out —
 * cheap enough to run on every graphics preset.
 */
export async function spawnConquestClaim(
  scene: THREE.Object3D,
  tweens: TweenManager,
  at: THREE.Vector3,
  options: ConquestClaimOptions,
): Promise<void> {
  const weight = Math.max(0, Math.min(1, options.weight ?? 0.4));
  const scale = Math.max(0.2, Math.min(1, options.scale ?? 1));
  const spin = Math.random() * Math.PI;

  const loop = takeDisc(sharedWaveGeometry(), sharedWaveMap(), options.color, 0);
  const loopMaterial = loop.material;
  loop.rotation.x = -Math.PI / 2;
  loop.rotation.z = spin;
  loop.position.set(at.x, options.height, at.z);
  loop.renderOrder = 7;
  scene.add(loop);

  // The army's own mark, waiting under the loop for it to arrive.
  const seal = takeDisc(sharedWaveGeometry(), sharedSealMap(), options.color, 0);
  const sealMaterial = seal.material;
  seal.rotation.x = -Math.PI / 2;
  seal.rotation.z = -spin;
  seal.position.set(at.x, options.height + 0.004, at.z);
  seal.renderOrder = 8;
  const mark = (0.9 + weight * 0.2) * scale;
  seal.scale.setScalar(mark);
  scene.add(seal);

  const wide = Math.max(0.4, options.radius * 0.5 * scale);
  const tight = 0.42 + weight * 0.12;

  try {
    // Drawn in: fast at first, arriving softly, so the eye follows it home.
    await tweens.to({
      duration: 0.3 + weight * 0.1,
      easing: Ease.outCubic,
      onUpdate: (t) => {
        loop.scale.setScalar(wide + (tight - wide) * t);
        loopMaterial.opacity = CLAIM_LOOP_PEAK * (0.2 + 0.8 * t);
        loop.rotation.z = spin + t * 0.5;
        // The mark comes up to meet it over the second half of the closing.
        sealMaterial.opacity = Math.max(0, (t - 0.45) / 0.55) * CLAIM_SEAL_PEAK;
      },
    });
    // Shut: a single bright beat on the tile, then gone.
    await tweens.to({
      duration: 0.34 + weight * 0.16,
      easing: Ease.outQuint,
      onUpdate: (t) => {
        loop.scale.setScalar(tight * (1 + t * 0.7 * scale));
        loopMaterial.opacity = Math.pow(1 - t, 1.7) * CLAIM_LOOP_PEAK;
        seal.scale.setScalar(mark * (1 + t * 0.35 * scale));
        sealMaterial.opacity = Math.pow(1 - t, 1.4) * CLAIM_SEAL_PEAK;
      },
    });
  } finally {
    releaseDisc(loop);
    releaseDisc(seal);
  }
}

export interface PillarOptions {
  color: number;
  /** Radius of the column at the floor. */
  radius: number;
  /** How far it climbs out of frame. */
  height: number;
  /** Floor level the column stands on. */
  floor: number;
  /** How long it holds over the condemned before it lets go. */
  hold: number;
  /**
   * A light borrowed from the scene's spell-light pool, or null to run the
   * column unlit. Never create one here: changing the scene's light count
   * recompiles every material in the hall.
   */
  light: SpellLight | null;
}

/**
 * Judgement: a column of light dropped straight down onto a square, held while
 * the sentence is carried out, then pulled back up into nothing. Reserved for
 * the crown — nothing else on the board is allowed to summon it.
 */
export async function spawnPillar(
  scene: THREE.Object3D,
  tweens: TweenManager,
  at: THREE.Vector3,
  options: PillarOptions,
): Promise<void> {
  const column = takeDisc(sharedPillarGeometry(), sharedPillarMap(), options.color, 0);
  const material = column.material;
  column.renderOrder = 6;
  column.position.set(at.x, options.floor + options.height * 0.5, at.z);
  column.scale.set(options.radius, options.height, options.radius);
  scene.add(column);

  const light = options.light;
  const lightAt = new THREE.Vector3(at.x, options.floor + 0.9, at.z);

  const setSpread = (radius: number, opacity: number): void => {
    column.scale.set(radius, options.height, radius);
    material.opacity = opacity;
    light?.set(lightAt, opacity * 9);
  };

  try {
    // Slams down wide, then snaps tight around the body.
    await tweens.to({
      duration: 0.16,
      easing: Ease.outQuint,
      onUpdate: (t) => setSpread(options.radius * (2.4 - t * 1.4), t * 0.95),
    });
    // Held: the light breathes rather than sitting there as a decal.
    await tweens.to({
      duration: Math.max(0.05, options.hold),
      easing: Ease.linear,
      onUpdate: (t) => {
        const pulse = 1 + Math.sin(t * Math.PI * 6) * 0.06;
        setSpread(options.radius * pulse, 0.95 - t * 0.12);
      },
    });
    // Withdrawn upward, thinning as it goes.
    await tweens.to({
      duration: 0.32,
      easing: Ease.inCubic,
      onUpdate: (t) => {
        column.scale.set(options.radius * (1 - t * 0.55), options.height, options.radius * (1 - t * 0.55));
        material.opacity = 0.83 * (1 - t);
        light?.set(lightAt, 7.5 * (1 - t));
      },
    });
  } finally {
    releaseDisc(column);
    light?.release();
  }
}
