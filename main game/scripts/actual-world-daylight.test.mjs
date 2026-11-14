import test from 'node:test';
import assert from 'node:assert/strict';
import { actualWorldDaylight, daylightInspectionTiming, daylightInspectionWorkDeadline } from './actual-world-daylight.mjs';
const clock=(seconds,day=3,hour=18,minute=0)=>({day,hour,minute,cloudMotionSeconds:(day*1440+hour*60+minute)*seconds});
test('the actual 96-minute saved day uses 16x with a forecast covering the night',()=>{
  const result=daylightInspectionTiming(clock(4));
  assert.equal(result.speed,16);assert.equal(result.secondsPerWorldMinute,4);
  assert.equal(result.minutesToMorning,840);assert.equal(result.timeout,330000);
  assert.ok(result.timeout>840*4/16*1000);
});
test('a 24-minute day uses the gentler 4x with the same morning budget',()=>{
  const result=daylightInspectionTiming(clock(1));
  assert.equal(result.speed,4);assert.equal(result.timeout,330000);
});
test('clock-date rollover and fractional display rounding retain bounded timing',()=>{
  assert.equal(daylightInspectionTiming(clock(4,1,23,30)).minutesToMorning,510);
  const env=clock(4);env.cloudMotionSeconds+=3.99;
  assert.equal(daylightInspectionTiming(env).speed,16);
  assert.equal(daylightInspectionTiming(clock(100)).timeout,600000);
  assert.equal(daylightInspectionTiming(clock(.5,1,7,59)).timeout,180000);
});
test('missing, stopped or inconsistent clock data is not a licence to stage daytime',()=>{
  for(const value of [null,{},clock(0),clock(NaN),clock(4,-1),clock(4,1,24),clock(4,1,2,60),clock(4,0,0,0)]) {
    assert.throws(()=>daylightInspectionTiming(value),/clock/);
  }
});
test('the work cutoff reserves restoration time after both dispatch and morning polling',()=>{
  const timing=daylightInspectionTiming(clock(4)),now=1000000;
  assert.throws(()=>daylightInspectionWorkDeadline(timing,now,now+540000),/Reserve time/);
  const deadline=now+610000,workEnd=daylightInspectionWorkDeadline(timing,now,deadline);
  assert.equal(workEnd,deadline-200000);
  assert.ok(now+timing.actionTimeout+timing.timeout<workEnd);
  assert.ok(timing.actionTimeout<timing.cleanupReserve);
});
test('fully lit late afternoon is actual daylight without manufacturing a morning',()=>{
  assert.equal(actualWorldDaylight({hour:16,minute:48,daylight:1}),true);
  assert.equal(actualWorldDaylight({hour:5,minute:47,daylight:.011}),false);
  assert.equal(actualWorldDaylight({daylight:NaN}),false);
});
test('reported saved pace is authoritative and a large resident projection is never accelerated further',()=>{
  const result=daylightInspectionTiming(clock(1),{millisecondsPerWorldMinute:4000,pendingMilliseconds:12000});
  assert.equal(result.speed,16);assert.equal(result.paceSource,'reported-population-clock');assert.equal(result.pendingWorldMinutes,3);
  assert.throws(()=>daylightInspectionTiming(clock(4),{millisecondsPerWorldMinute:4000,pendingMilliseconds:3761626}),/simulation catch-up/);
  assert.throws(()=>daylightInspectionTiming(clock(4),{millisecondsPerWorldMinute:0}),/clock pace/);
});
