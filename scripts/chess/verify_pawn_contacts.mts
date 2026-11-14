/** Headless checks against original source skins and the actual equipped props.
 * This measures rig/IK compatibility; it is not a rendered arena screenshot. */
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
import * as THREE from '../../web/node_modules/three/build/three.module.js';
import {GLTFLoader} from '../../web/node_modules/three/examples/jsm/loaders/GLTFLoader.js';
import {attachWeapons} from '../../web/src/scene/weapons';
import {ContactIK} from '../../web/src/scene/contactIK';
import {LivingPieceRig} from '../../web/src/scene/livingPieceRig';
const args=process.argv.slice(2),arg=(name:string)=>{const i=args.indexOf(name);return i>=0?args[i+1]:undefined;};
const input=arg('--sources'),output=arg('--report'),socketOutput=arg('--export-sockets');
if(!input||(!output&&!socketOutput))throw new Error('Supply --sources and --report or --export-sockets');
const rows=JSON.parse(await readFile(input,'utf8'));
/** Each Pawn class: the side its props are painted for, its arsenal, and the opponent it is measured against.
 * Libraries follow the army skin, not the board colour. Korvenia (ep) and Kwind-09 (kp) spar with the
 * shield-bearing Aethelgard Pawn, so their attacks are fitted to a real guard. */
const CLASSES:Record<string,{faction:'w'|'b';arsenal:'kingdom'|'sun'|'empire'|'kwind';opponent:string}>={
 wp:{faction:'w',arsenal:'kingdom',opponent:'bp'},bp:{faction:'b',arsenal:'sun',opponent:'wp'},
 ep:{faction:'b',arsenal:'empire',opponent:'wp'},kp:{faction:'b',arsenal:'kwind',opponent:'wp'},
};
const classes=(arg('--classes')??'wp,bp').split(',');
const libraryDir=arg('--library-dir')??'web/src/assets/chess/combat-v1';
for(const key of classes)if(!CLASSES[key])throw new Error('Unknown Pawn class '+key);
async function load(path:string,strip=false){
 const buffer=await readFile(path);let data:Uint8Array=buffer;
 if(strip){
  const length=buffer.readUInt32LE(12),doc=JSON.parse(buffer.subarray(20,20+length).toString());
  delete doc.images;delete doc.textures;delete doc.materials;
  for(const mesh of doc.meshes??[])for(const primitive of mesh.primitives)delete primitive.material;
  for(const key of ['extensionsUsed','extensionsRequired'])if(doc[key])doc[key]=doc[key].filter((name:string)=>name!=='EXT_texture_webp');
  let encoded=Buffer.from(JSON.stringify(doc));encoded=Buffer.concat([encoded,Buffer.alloc((4-encoded.length%4)%4,32)]);
  const bin=buffer.subarray(20+length),header=Buffer.alloc(20);header.writeUInt32LE(0x46546c67,0);header.writeUInt32LE(2,4);header.writeUInt32LE(20+encoded.length+bin.length,8);header.writeUInt32LE(encoded.length,12);header.writeUInt32LE(0x4e4f534a,16);
  data=Buffer.concat([header,encoded,bin]);
 }
 return new GLTFLoader().parseAsync(data.buffer.slice(data.byteOffset,data.byteOffset+data.byteLength) as ArrayBuffer,'');
}
async function actor(key:string){
 const source=rows.find((r:any)=>r.class===key&&r.role==='rigged');
 const gltf=await load(source.path,true),model=gltf.scene,frame=new THREE.Group();
 const bounds=new THREE.Box3().setFromObject(model),size=bounds.getSize(new THREE.Vector3()),center=bounds.getCenter(new THREE.Vector3());
 const unit=size.y,scale=.7/unit;model.scale.setScalar(scale);model.position.set(-center.x*scale,-bounds.min.y*scale,-center.z*scale);frame.add(model);
 const idle=await load(rows.find((r:any)=>r.class===key&&r.role==='idle').path,true),mixer=new THREE.AnimationMixer(model);
 const initial=mixer.clipAction(idle.animations[0]);initial.play();mixer.update(0);
 // Libraries follow the source army, not the board colour. The kingdom merge
 // made the loadout explicit; otherwise the Solforiz rig gets medieval props.
 const arms=attachWeapons(model,'p',CLASSES[key].faction,unit,bounds.min.y,CLASSES[key].arsenal);
 // A shieldless Pawn (Korvenia's musket, Kwind-09's shock pike) guards and bashes with the left forearm: a socket at
 // the left hand, its normal set to the figure's front in the idle pose, stands in for the shield.
 if(!arms.shield){
  const hand=model.getObjectByName('LeftHand')!,guard=new THREE.Object3D();guard.name='forearm_guard';hand.add(guard);
  model.updateMatrixWorld(true);
  const front=new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,0,1),new THREE.Vector3(0,0,1).applyQuaternion(model.getWorldQuaternion(new THREE.Quaternion())));
  guard.quaternion.copy(hand.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(front));
  // Where a shield's face would be: about 11.5% of the body height out from the fist, as on the original Pawns.
  const forward=new THREE.Vector3(0,0,1).applyQuaternion(model.getWorldQuaternion(new THREE.Quaternion()));
  guard.position.copy(hand.worldToLocal(hand.getWorldPosition(new THREE.Vector3()).addScaledVector(forward,.115*unit*scale)));
  arms.shield=guard;
 }
 const ik=new ContactIK(frame,model,arms.contact,arms.shield);
 const baseline=new Map<string,THREE.Vector3>();model.traverse(node=>{if((node as THREE.Bone).isBone)baseline.set(node.name,node.getWorldPosition(new THREE.Vector3()));});
 // A class not baked yet has no library: socket export bootstraps from its idle torso.
 const library=resolve(libraryDir,key+'.glb');
 const clips=(socketOutput&&!args.includes('--calibrate-defenses'))||!existsSync(library)?null:await load(library),rig=new LivingPieceRig(model,model);
 const sample=(id:string,time:number)=>{ik.restore();rig.restore();mixer.stopAllAction();const action=mixer.clipAction(clips!.animations.find(c=>c.name===id)!);action.reset().setLoop(THREE.LoopOnce,1).play();action.clampWhenFinished=true;mixer.setTime(time);frame.updateMatrixWorld(true);};
 if(clips){sample('attack.thrust',0);let poseError=0;model.traverse(node=>{const point=baseline.get(node.name);if(point)poseError=Math.max(poseError,point.distanceTo(node.getWorldPosition(new THREE.Vector3())));});assert.ok(poseError<.001,`${key}: Blender/source pose disagreement ${poseError}`);}
 return{frame,model,ik,rig,arms,sample,clips,scale,unit,center,baseY:bounds.min.y,sourceSha256:source.sha256};
}
if(socketOutput){
 const sockets:Record<string,unknown>={};
 for(const key of classes){
  const a=await actor(key),b=await actor(CLASSES[key].opponent);a.ik.restore();a.rig.restore();b.ik.restore();b.rig.restore();
  a.frame.rotation.y=0;b.frame.rotation.y=Math.PI;a.frame.updateMatrixWorld(true);b.frame.updateMatrixWorld(true);
  const reach=a.ik.preferredReach()!,threat=new THREE.Vector3(0,0,-reach);
  const raw=(point:THREE.Vector3)=>[point.x/a.scale+a.center.x,point.y/a.scale+a.baseY,(point.z+reach)/a.scale+a.center.z];
  const bodyTarget=raw(b.ik.torsoPoint(new THREE.Vector3()));
  // The blocking hand pose is authored independently of attack socket targets,
  // so calibrating it cannot feed back into its own bake.
  if(b.clips)b.sample('defend.block',14/30);
  b.rig.brace(threat);b.rig.apply(1/60,0,false,false);
  const guard=b.ik.torsoPoint(new THREE.Vector3()),forward=threat.clone().sub(guard).setY(0).normalize();
  guard.addScaledVector(forward,.15);guard.x+=forward.z*.08;guard.z-=forward.x*.08;
  const incoming=a.frame.getWorldPosition(new THREE.Vector3());incoming.z-=reach;
  b.ik.apply(0,'plant',null,0,guard,.8,undefined,incoming);
  const local=(boneName:string,point:THREE.Object3D)=>point.getWorldPosition(new THREE.Vector3()).applyMatrix4(a.model.getObjectByName(boneName)!.matrixWorld.clone().invert()).toArray();
  const shieldNormalLocal=a.arms.shield!.getWorldDirection(new THREE.Vector3()).applyQuaternion(a.model.getObjectByName('LeftHand')!.getWorldQuaternion(new THREE.Quaternion()).invert()).normalize().toArray();
  sockets[key]={sourceSha256:a.sourceSha256,normalizationScale:a.scale,standoffUnits:reach,
   weaponLocal:local('RightHand',a.arms.contact!),shieldLocal:local('LeftHand',a.arms.shield!),shieldNormalLocal,
   bodyTarget,shieldTarget:raw(b.ik.shieldPoint(new THREE.Vector3())!)};
 }
 await writeFile(socketOutput,JSON.stringify({version:1,archetypes:sockets},null,2));console.log('Exported original prop sockets:',socketOutput);process.exit(0);
}
const measurements=[];
for(const attackerKey of classes){
 const defenderKey=CLASSES[attackerKey].opponent,a=await actor(attackerKey),b=await actor(defenderKey);
 const reach=a.ik.preferredReach()!;a.frame.position.z=-reach;b.frame.rotation.y=Math.PI;
 for(const [attack,defense] of [['attack.thrust','defend.parry'],['attack.bash-thrust','defend.block'],['attack.feint-step','defend.evade']]){
  const clip=a.clips!.animations.find(c=>c.name===attack)!,index=a.clips!.animations.indexOf(clip),meta=a.clips!.parser.json.animations[index].extras.crownfall;
  const defenseIndex=b.clips!.animations.findIndex(c=>c.name===defense),defenseMeta=b.clips!.parser.json.animations[defenseIndex].extras.crownfall;
  const first=meta.markers.find((m:any)=>m.name==='clash'||m.name==='feint')??meta.markers.find((m:any)=>m.name==='contact');
  const guard=defenseMeta.markers.find((m:any)=>m.name==='guard'||m.name==='evade');
  const rate=THREE.MathUtils.clamp(guard.time/first.time,.35,2.5);
  for(const marker of meta.markers.filter((m:any)=>m.name==='contact'||m.name==='clash')){
   a.sample(attack,marker.time);
   const clash=meta.markers.find((m:any)=>m.name==='clash');
   if(clash&&marker.time>clash.time)b.sample('hit.light',marker.time-clash.time);
   else b.sample(defense,Math.min(defenseMeta.duration,marker.time*rate));
   b.rig.brace(a.frame.position);b.rig.apply(1/60,0,false,false);
   const shieldGoal=b.ik.torsoPoint(new THREE.Vector3()),forward=a.frame.position.clone().sub(shieldGoal).setY(0).normalize();
   shieldGoal.addScaledVector(forward,.15);shieldGoal.x+=forward.z*.08;shieldGoal.z-=forward.x*.08;
   const incomingBefore=a.frame.getWorldPosition(new THREE.Vector3()).sub(b.ik.shieldPoint(new THREE.Vector3())!).setY(0).normalize();
   const shieldBeforeDot=b.arms.shield!.getWorldDirection(new THREE.Vector3()).dot(incomingBefore);
   b.ik.apply(0,defense==='defend.evade'?'ground':'plant',null,0,shieldGoal,.8,undefined,a.frame.position);
   const isClash=marker.name==='clash',target=isClash?b.ik.shieldPoint(new THREE.Vector3())!:b.ik.torsoPoint(new THREE.Vector3()),tip=isClash?a.arms.shield!:a.arms.contact!;
   const before=tip.getWorldPosition(new THREE.Vector3()).distanceTo(target);
   a.ik.apply(0,attack==='attack.thrust'?'plant':'ground',isClash?null:target,isClash?0:1,isClash?target:null,1);
   const after=tip.getWorldPosition(new THREE.Vector3()).distanceTo(target);
   const normal=b.arms.shield!.getWorldDirection(new THREE.Vector3()),incoming=a.frame.getWorldPosition(new THREE.Vector3()).sub(b.ik.shieldPoint(new THREE.Vector3())!).setY(0).normalize();
   measurements.push({archetype:attackerKey,attack,cue:marker.name,standoffUnits:reach,markerFrame:marker.frame,markerSeconds:marker.time,errorBeforeUnits:before,errorAfterUnits:after,defenderShieldBeforeFacingDot:shieldBeforeDot,defenderShieldFacingDot:normal.dot(incoming)});
   if(!args.includes('--diagnose'))assert.ok(Number.isFinite(after)&&after<.005,`${attackerKey} ${attack} ${marker.name}: socket residual ${after}`);
   if(!args.includes('--diagnose')&&isClash)assert.ok(normal.dot(incoming)>.75,`${attackerKey}: blocking shield is not facing the incoming strike`);
  }
 }
}
await writeFile(output!,JSON.stringify({scope:'Original source skinned figures and actual weapon geometry; board-world units; no render/arena claim',passed:measurements.every(m=>m.errorAfterUnits<.005),measurements},null,2));
console.log(JSON.stringify(measurements,null,2));
