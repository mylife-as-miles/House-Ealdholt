import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {communityWoodCrowdMeta,COMMUNITY_WOOD_CLIP,COMMUNITY_WOOD_ENTER,COMMUNITY_WOOD_EXIT} from './community-wood-presentation';
import {CODEX_OWNER_MOTIONS,parseCrowdResidentMeta,planCrowdClips} from './crowd-binding';
import {planCrowdProps} from './crowd-presentation';
import {EALDHOLT_WOOD_WORKPLACE_CANDIDATE as evidence} from './ealdholt-wood-workplace-candidate';
import {EALDHOLT_SOURCE_REFUGE_CANDIDATE as refuges} from './ealdholt-emergency-refuge-candidate';

const root=new URL('../../../../main game/public/assets/legacy/environment/aethelgard/characters/',import.meta.url);
function meta(id:string){return parseCrowdResidentMeta(JSON.parse(readFileSync(new URL('crowd-v1/residents/'+id+'.json',root),'utf8')),id);}

test('community task derives only the actual Mason presentation and leaves original work and metadata intact',()=>{
 const original=meta('ealdholt-master-mason'),before=JSON.stringify(original),derived=communityWoodCrowdMeta(original);
 assert.equal(JSON.stringify(original),before);assert.notStrictEqual(derived,original);
 assert.deepEqual(derived.motion.roleClips,[...original.motion.roleClips,COMMUNITY_WOOD_CLIP]);
 assert.equal(derived.residentId,original.residentId);assert.equal(derived.placementScale,original.placementScale);
 for(const role of original.motion.roleClips)assert.strictEqual(derived.presentation!.clips[role],original.presentation!.clips[role]);
 assert.equal(new Set(derived.props.map(p=>p.id)).size,derived.props.length);
 const other=meta('ealdholt-woodcutter');assert.strictEqual(communityWoodCrowdMeta(other),other);
});

test('temporary wood animation uses exact compatible published donor grips, all three real clips and measured bounds',()=>{
 const derived=communityWoodCrowdMeta(meta('ealdholt-master-mason')),donor=meta('ealdholt-woodcutter');
 const manifest=JSON.parse(readFileSync(new URL('crowd-v1/clips/manifest.json',root),'utf8'));
 const names=Object.keys(manifest.libraries['adult-male'].clips),plan=planCrowdClips(derived,names,{roleClip:COMMUNITY_WOOD_CLIP},CODEX_OWNER_MOTIONS.patched);
 assert.equal(plan.unpresentable,null);assert.equal(plan.clips.work,COMMUNITY_WOOD_CLIP);assert.equal(plan.clips.workEnter,COMMUNITY_WOOD_ENTER);assert.equal(plan.clips.workExit,COMMUNITY_WOOD_EXIT);
 for(const clip of[COMMUNITY_WOOD_CLIP,COMMUNITY_WOOD_ENTER,COMMUNITY_WOOD_EXIT]){
  assert.deepEqual(derived.presentation!.clips[clip],donor.presentation!.clips[COMMUNITY_WOOD_CLIP]);
  const bound=derived.envelopes!.byClip[clip],actual=evidence.workClipMeasurements[clip as keyof typeof evidence.workClipMeasurements],scale=derived.placementScale;
  assert.ok(bound.max[0]*scale>=actual.radiusMetres-1e-12);assert.ok(bound.max[1]*scale>=actual.heightMetres-1e-12);assert.ok(bound.min[1]*scale<=actual.minimumBodyYMetres);
 }
 const props=planCrowdProps(derived.presentation,plan);assert.ok(JSON.stringify(props).includes('prop_axe'));assert.ok(JSON.stringify(props).includes('prop_chopping_block'));
 for(const[path,sha]of Object.entries(evidence.workFiles))assert.equal(createHash('sha256').update(readFileSync(new URL(path,root))).digest('hex'),sha,path);
 assert.deepEqual(manifest.libraries['adult-male'].clips[COMMUNITY_WOOD_CLIP].events.impactSeconds,[1.12]);
});

test('incorrect actor scale and conflicting prop identity are held instead of borrowing another body contract',()=>{
 const original=meta('ealdholt-master-mason');
 assert.throws(()=>communityWoodCrowdMeta({...original,placementScale:1}),/exact published Mason/);
 assert.throws(()=>communityWoodCrowdMeta({...original,props:[...original.props,{id:'axe',kit:'wrong',socket:'hand_r'}]}),/conflicts/);
});

test('recovery work pins the actual reached Mason refuge and the complete source contract',()=>{
 const assignment=refuges.assignments.find(row=>row.residentId==='ealdholt-master-mason')!,refuge=refuges.routes.find(row=>row.id===assignment.routeId)!,recovery=evidence.recoveryApproach;
 assert.equal(recovery.refugeId,'ealdholt-refuge-ealdholt-master-mason');assert.equal(recovery.certificateSha256,assignment.certificateSha256);
 assert.equal(recovery.fromAnchorId,assignment.routeId+'-stand');assert.deepEqual(recovery.sourceGroundPoint,refuge.points[refuge.points.length-1]);
 assert.deepEqual(recovery.routePoints[0],recovery.sourceGroundPoint);assert.deepEqual(recovery.routePoints[recovery.routePoints.length-1],evidence.workPoint);assert.ok(recovery.routePoints.length<=256);
 const{certificateSha256,...contract}=evidence;assert.equal(createHash('sha256').update(JSON.stringify(contract)).digest('hex'),certificateSha256);
});
