import test from 'node:test';
import assert from 'node:assert/strict';
import {recoveryWorkParkingObstruction} from './village-recovery-work-parking';
import {EALDHOLT_SOURCE_REFUGE_CANDIDATE as refuges} from './ealdholt-emergency-refuge-candidate';
import {EALDHOLT_WOOD_WORKPLACE_CANDIDATE as work} from './ealdholt-wood-workplace-candidate';
import type {VillageSitePoint} from './village-site';
const points:Record<string,VillageSitePoint>={
 'ealdholt-baker':[-1.3000000000000007,1,27.499999999999996],
 'ealdholt-east-farmer-partner':[-3.1000000000000014,1.004562829399191,27.499999999999996],
 'ealdholt-guard-recruit':[-4.900000000000002,1,30.099999999999994],
 'ealdholt-guard-serjeant':[-6.699999999999999,1.0497035506195687,30.099999999999994],
};
test('actual previous parking blocks the complete measured work volume or approach, even before a worker arrives',()=>{
 for(const[residentId,p]of Object.entries(points)){const row=refuges.assignments.find(a=>a.residentId===residentId)!;assert.notEqual(recoveryWorkParkingObstruction(p,row.body,residentId,refuges.sourceSha256,'desktop'),null,residentId);}
});
test('the operator may start on his own exact certified refuge; another parked resident cannot consume that approach',()=>{
 const row=refuges.assignments.find(a=>a.residentId===work.residentId)!;
 assert.equal(row.certificateSha256,'3c9a845158746bbc86b8cdd19558ec385a6bd752c06c4d17ffa04764db5536f9');
 assert.equal(recoveryWorkParkingObstruction(work.recoveryApproach.sourceGroundPoint,row.body,row.residentId,refuges.sourceSha256,'desktop'),null);
 assert.equal(recoveryWorkParkingObstruction(work.recoveryApproach.sourceGroundPoint,row.body,'another-resident',refuges.sourceSha256,'desktop'),'recovery-route');
 assert.equal(recoveryWorkParkingObstruction(work.workPoint,row.body,row.residentId,refuges.sourceSha256,'desktop'),'work-volume','An operator name cannot waive a workpiece-sized solid volume.');
});
test('all15 future source proposals keep the actual timber operation and both source approaches usable',()=>{
 assert.equal(refuges.assignments.length,15);
 for(const a of refuges.assignments){const route=refuges.routes.find(r=>r.id===a.routeId)!;assert.equal(recoveryWorkParkingObstruction(route.points[route.points.length-1],a.body,a.residentId,refuges.sourceSha256,'desktop'),null,a.residentId);}
});
