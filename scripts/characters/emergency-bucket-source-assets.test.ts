import test from 'node:test';
import assert from 'node:assert/strict';
import {measurePublishedEmergencyBucketPose} from './measure-emergency-bucket-pose.mts';
import {emergencyBucketPose0} from '../../main game/src/legacy/aethelgard/emergency-action-visuals';

for(const id of ['ealdholt-brewster','ealdholt-swineherd','ealdholt-hall-groom']){
 test(`published ${id} carry pose retains its exact original bucket mouth/handle and file identities`,async()=>{
  const measured=await measurePublishedEmergencyBucketPose(id),pose=emergencyBucketPose0(id,measured.files);
  assert.ok(pose);assert.equal(pose.sampleSeconds,0);assert.equal(pose.clipId,'carry_bucket_walk');
  assert.equal(measured.referenceMaximumError,0);assert.deepEqual(pose.mouth,measured.mouth);assert.deepEqual(pose.handle,measured.handle);
  assert.equal(Object.keys(measured.files).length,4);
  for(const file of Object.keys(measured.files))assert.equal(emergencyBucketPose0(id,{...measured.files,[file]:'0'.repeat(64)}),null,'A different source cannot borrow this pose.');
 });
}
