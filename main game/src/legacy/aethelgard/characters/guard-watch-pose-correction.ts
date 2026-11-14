import {Matrix4,Quaternion,Vector3,type Object3D} from 'three';
import {solveGuardTwoBone,type GuardPoint} from '../../../../../shared/legacy/aethelgard/characters/guard-watch-ik';
import type {PublishedGuardWatch} from '../../../../../shared/legacy/aethelgard/characters/guard-watch-published';
import {GUARD_WATCH_HELPER} from '../../../../../shared/legacy/aethelgard/characters/guard-watch-dwell';

/** Post-mixer presentation constraints on the real clone. Base TRS is restored
 * before every mixer call so its unchanged-value cache cannot accumulate IK. */
export function createGuardWatchPoseCorrection(model:Object3D,spec:Pick<PublishedGuardWatch,'soles'|'grips'|'handoff'|'seconds'>){
 const inverse=new Matrix4(),point=new Vector3(),a=new Vector3(),b=new Vector3(),c=new Vector3(),target=new Vector3();
 const q=new Quaternion(),parentQ=new Quaternion(),worldQ=new Quaternion(),handMatrix=new Matrix4(),right=new Matrix4(),left=new Matrix4();
 const pos=new Vector3(),pos2=new Vector3(),scale=new Vector3(),scale2=new Vector3(),quat=new Quaternion(),quat2=new Quaternion();
 const helper=model.getObjectByName(GUARD_WATCH_HELPER);
 if(!helper||helper.children.some(n=>n.name!=='prop_spear'))throw Error('Guard spear helper is missing or contains an unsupported object.');
 const nodes=['thigh_l','calf_l','foot_l','thigh_r','calf_r','foot_r'].map(name=>model.getObjectByName(name));
 const hands={l:model.getObjectByName('hand_l'),r:model.getObjectByName('hand_r')};
 if(nodes.some(n=>!n)||!hands.l||!hands.r)throw Error('Guard correction requires its exact published foot/hand skeleton.');
 const bones=nodes as Object3D[],base=bones.map(n=>n.quaternion.clone());
 const helperBase={position:helper.position.clone(),quaternion:helper.quaternion.clone(),scale:helper.scale.clone()};
 let applied=false,maximumLift=0;
 const vec=(p:GuardPoint)=>new Vector3().fromArray(p);
 function rotateTo(node:Object3D,child:Object3D,end:GuardPoint){
  node.getWorldPosition(a);child.getWorldPosition(b);target.copy(vec(end).applyMatrix4(model.matrixWorld));
  b.sub(a).normalize();target.sub(a).normalize();q.setFromUnitVectors(b,target);
  node.getWorldQuaternion(worldQ);worldQ.premultiply(q);
  node.parent!.getWorldQuaternion(parentQ);node.quaternion.copy(parentQ.invert().multiply(worldQ));model.updateWorldMatrix(true,true);
 }
 return{
  restore(){if(!applied)return;for(let i=0;i<bones.length;i++)bones[i].quaternion.copy(base[i]);
   helper.position.copy(helperBase.position);helper.quaternion.copy(helperBase.quaternion);helper.scale.copy(helperBase.scale);applied=false;},
  apply(motion:string,time:number){
   if(!['walk','work','workEnter','workExit'].includes(motion)||!Number.isFinite(time)||time<0)return{ok:false,reason:'guard-evaluated-pose-unavailable',maximumLift};
   for(let i=0;i<bones.length;i++)base[i].copy(bones[i].quaternion);
   helperBase.position.copy(helper.position);helperBase.quaternion.copy(helper.quaternion);helperBase.scale.copy(helper.scale);applied=true;
   model.updateWorldMatrix(true,true);inverse.copy(model.matrixWorld).invert();
   for(const [index,side]of ['l','r'].entries()){
    const upper=bones[index*3],lower=bones[index*3+1],foot=bones[index*3+2];let minimum=Infinity;
    for(const support of spec.soles[side as 'l'|'r']){
     const node=model.getObjectByName(support.bone);if(!node)return{ok:false,reason:'guard-sole-node-unavailable',maximumLift};
     point.fromArray(support.point).applyMatrix4(node.matrixWorld).applyMatrix4(inverse);minimum=Math.min(minimum,point.y);
    }
    const lift=Math.max(0,.003-minimum);maximumLift=Math.max(maximumLift,lift);
    if(!Number.isFinite(lift)||lift>.12)return{ok:false,reason:'guard-foot-correction-out-of-range',maximumLift};
    if(lift<1e-6)continue;
    upper.getWorldPosition(a).applyMatrix4(inverse);lower.getWorldPosition(b).applyMatrix4(inverse);foot.getWorldPosition(c).applyMatrix4(inverse);
    target.copy(c);target.y+=lift;
    const solved=solveGuardTwoBone(a.toArray() as [number,number,number],b.toArray() as [number,number,number],c.toArray() as [number,number,number],target.toArray() as [number,number,number]);
    if(!solved)return{ok:false,reason:'guard-foot-ik-unreachable',maximumLift};
    const heldFoot=new Quaternion();foot.getWorldQuaternion(heldFoot);
    rotateTo(upper,lower,solved.elbow);rotateTo(lower,foot,solved.tip);
    foot.parent!.getWorldQuaternion(parentQ);foot.quaternion.copy(parentQ.invert().multiply(heldFoot));model.updateWorldMatrix(true,true);
   }
   // One real spear is controlled by the evaluated holding hand(s), not a
   // schedule point or an independently guessed helper trajectory.
   right.multiplyMatrices(hands.r!.matrixWorld,handMatrix.fromArray(spec.grips.r));
   left.multiplyMatrices(hands.l!.matrixWorld,handMatrix.fromArray(spec.grips.l));
   const phase=motion==='workExit'?1-time/spec.seconds:time/spec.seconds;
   let weight=motion==='walk'?0:motion==='work'?1:(phase-spec.handoff.leftClosedByPhase)/(spec.handoff.rightReleaseAfterPhase-spec.handoff.leftClosedByPhase);
   weight=Math.max(0,Math.min(1,weight));weight=weight*weight*(3-2*weight);
   right.decompose(pos,quat,scale);left.decompose(pos2,quat2,scale2);
   handMatrix.compose(pos.lerp(pos2,weight),quat.slerp(quat2,weight),scale.lerp(scale2,weight));
   handMatrix.premultiply(inverse);handMatrix.decompose(helper.position,helper.quaternion,helper.scale);model.updateWorldMatrix(true,true);
   return{ok:true,reason:null,maximumLift};
  }
 };
}

