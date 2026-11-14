/**
 * A PieceView as the Combat Director's stage sees it (see engineStage.ts).
 * Every motion here is a tween on the scene's own TweenManager, which runs on
 * the same frame delta as both mixers and the pair's CombatSession, and every
 * tween checks `live()` so nothing moves a figure once its fight is over.
 */
import * as THREE from "three";
import { TILE } from "../board";
import { PIECE_MODEL_ORIENTATION } from "../../assets/generated";
import type { PieceView } from "../pieces";
import { Ease, type TweenManager } from "../tween";
import type { StageFigure } from "./engineStage";
import type { Vec3 } from "./runner";
import { TRAVEL_CLIPS, travelHeading } from "./travelClips";

const vector = (point: Vec3) => new THREE.Vector3(point.x, point.y, point.z);
const plain = (point: THREE.Vector3): Vec3 => ({ x: point.x, y: point.y, z: point.z });

export interface FigureOptions {
  tweens: TweenManager;
  /** False under reduced motion or on a rig with no legs: travel is a slide. */
  onFoot: boolean;
  /** One boot on the stone during a walk or a run. */
  footfall?(index: number): void;
}

function travelClip(piece: PieceView, delta: THREE.Vector3, gait: "step" | "dodge"): string | null {
  const facing = piece.visual.getWorldDirection(new THREE.Vector3());
  const id = TRAVEL_CLIPS[gait][travelHeading({ x: facing.x, z: facing.z }, { x: delta.x, z: delta.z })];
  return piece.hasCombatVariant(id) ? id : null;
}

export function pieceFigure(piece: PieceView, options: FigureOptions): StageFigure {
  const scratch = new THREE.Vector3();
  /** The speed the clip now playing was last given, and the ease towards a new one. */
  let clipRate = 1, rateToken = 0;
  return {
    position: () => plain(piece.container.position),
    forward: () => {
      // PieceView rotates its visual, not its board anchor. Use the classified
      // source-model front instead of assuming every imported rig faces +Z.
      const axis=PIECE_MODEL_ORIENTATION.localFrontAxis as string;
      const direction=axis==='positiveX'?[1,0,0]:axis==='negativeX'?[-1,0,0]:axis==='positiveY'?[0,1,0]
        :axis==='negativeY'?[0,-1,0]:axis==='positiveZ'?[0,0,1]:axis==='negativeZ'?[0,0,-1]:null;
      if(!direction)return null;
      piece.visual.updateWorldMatrix(true,false);
      scratch.set(direction[0],direction[1],direction[2]).transformDirection(piece.visual.matrixWorld);
      return scratch.lengthSq()>1e-9?plain(scratch):null;
    },
    clip: id => piece.combatClipInfo(id),
    play: (id, rate, fade, from = 0) => {
      rateToken += 1; clipRate = rate;
      // Only a guard keeps the shield steered at the opponent: a blow, a stagger or a broken guard has the arm to itself.
      if (!id.startsWith("defend.") && id !== "ready.guard") piece.lowerGuard();
      piece.playCombatClip(id, rate, fade, from);
    },
    rate: (rate, ease, live) => {
      const token = ++rateToken, start = clipRate;
      if (ease <= 0) { clipRate = rate; piece.setCombatClipRate(rate); return; }
      void options.tweens.to({ duration: ease, easing: Ease.linear, onUpdate: t => {
        if (!live() || token !== rateToken) return;
        clipRate = start + (rate - start) * t; piece.setCombatClipRate(clipRate);
      } });
    },
    clipTime: () => piece.combatClipTime(),
    drive: seconds => piece.driveThrust(seconds),
    meet: on => piece.meetWeapon(on),
    brace: toward => piece.braceForImpact(vector(toward)),
    flinch: (direction, strength) => piece.flinch(vector(direction), strength),
    place: at => {
      piece.haltTravel();
      piece.container.position.copy(vector(at));
      if (piece.isMarching) piece.stopMarch(0.1);
      piece.stepTo(1);
      piece.setTravelling(false);
    },
    travel: (to, { duration, gait, arc }, live) => {
      piece.haltTravel();
      const from = piece.container.position.clone(), target = vector(to);
      const distance = from.distanceTo(target);
      const stride = gait === "walk" ? "walk" : gait === "step" || gait === "dodge" ? null : "run";
      // A step or a dodge is taken on its own clip where the rig has one: the figure is carried along the
      // clip's floor travel with its feet locked by the clip's own plants, so nothing slides.
      if ((gait === "step" || gait === "dodge") && options.onFoot && distance > 0.02) {
        const id = travelClip(piece, target.clone().sub(from), gait);
        if (id && piece.playTravelClip(id, target, duration)) { piece.setTravelling(false); return; }
      }
      const steps = Math.max(2, Math.round(distance / TILE * 2));
      const marching = !!stride && options.onFoot && distance > TILE * 0.2 && piece.hasClip(stride) && piece.startMarch(stride, steps / duration);
      // He goes where he is looking, whether or not this rig has the stride to march there on.
      if (stride && distance > 0.02) void piece.turnTowards(target, options.tweens, marching ? Math.min(0.12, duration * 0.4) : Math.min(0.25, duration * 0.6));
      // A step is taken, not slid: one foot is lifted and set down, then the other, while the body crosses.
      const stepping = (gait === "step" || gait === "dodge") && options.onFoot && distance > 0.02 && piece.beginStep(target.clone().sub(from));
      if (!stepping) piece.setTravelling(true);
      let next = 0.34;
      void options.tweens.to({
        duration,
        // A step is a shove of the body that settles; a march holds its pace.
        easing: marching ? Ease.linear : stepping ? Ease.inOutCubic : Ease.outCubic,
        onUpdate: t => {
          if (!live()) return;
          piece.container.position.lerpVectors(from, target, t);
          piece.container.position.y = THREE.MathUtils.lerp(from.y, target.y, t) + Math.sin(Math.PI * t) * arc * TILE;
          if (stepping) piece.stepTo(t);
          if (marching && piece.isMarching) for (; t * steps >= next && next <= steps; next += 1) options.footfall?.(Math.round(next));
        },
      }).then(() => {
        if (!live()) return;
        piece.container.position.copy(target);
        // An attack launched during the run has already taken the body over.
        if (marching && piece.isMarching) piece.stopMarch(0.12);
        if (stepping) piece.stepTo(1); else piece.setTravelling(false);
      });
    },
    face: (toward, duration) => {
      const point = vector(toward);
      if (duration <= 0) piece.faceTowards(point);
      else void piece.turnTowards(point, options.tweens, duration);
    },
    anchor: name => {
      if (name === "ground") return plain(piece.container.position);
      const socket = piece.sampleCombatSocket(name, scratch);
      return socket ? plain(socket) : null;
    },
    aimWeapon: at => piece.setContactAim(at === "shieldFace" ? "shield" : at === "weaponTip" ? "weapon" : null),
  };
}
