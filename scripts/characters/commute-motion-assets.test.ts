import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync,existsSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {bakeVillageCommuteMotion,privateCommuteOutput,readPinnedCharacterAsset,selectCommuteMotionClips} from './bake-village-commute-motion.mts';
import {getPopulationArt} from '../../shared/legacy/aethelgard/characters/village-population-art.ts';
import {validateCompleteCommuteBake,validateFreshCommuteBake,prepareFreshCommuteMotionSite,prepareCommuteMotionSite,auditCommuteEnvelopeCapabilities,integrateVillageCommuteMotion} from './integrate-village-commute-motion.mts';
import {parsePopulationMotionEvidence} from '../../shared/legacy/aethelgard/characters/population-motion-clearance.ts';
import {validatePublicWellInventory,validatePublicSiteManifest,reassignVillagePublicSites} from './reassign-village-public-sites.mts';

const repository=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const assets=resolve(repository,'main game/public/assets/legacy/environment/aethelgard/characters');
const sha=(data:Buffer|string)=>createHash('sha256').update(data).digest('hex');
const temp=(work:(root:string)=>void)=>{const root=mkdtempSync(resolve(tmpdir(),'crownfall-commute-test-'));try{work(root);}finally{rmSync(root,{recursive:true,force:true});}};

test('portable bake checks actual pinned metadata before accepting an asset',()=>temp(root=>{
 const relative='crowd-v1/clips/manifest.json',source=readFileSync(resolve(assets,relative)),target=resolve(root,relative);
 mkdirSync(dirname(target),{recursive:true});writeFileSync(target,source);
 assert.deepEqual(readPinnedCharacterAsset(root,relative),source);
 writeFileSync(target,Buffer.concat([source,Buffer.from('\n')]));
 assert.throws(()=>readPinnedCharacterAsset(root,relative),/Raw pinned asset changed/);
 assert.throws(()=>readPinnedCharacterAsset(root,'../../package.json'),/Unregistered character asset/);
 assert.throws(()=>readPinnedCharacterAsset(root,relative,1),/byte budget/);
}));

test('private output cannot overwrite the checkout, its symlink alias or source asset tree',()=>temp(root=>{
 assert.throws(()=>privateCommuteOutput(resolve(repository,'artifacts/commutes'),assets),/outside the checkout/);
 assert.throws(()=>privateCommuteOutput(resolve(repository,'..private-motion'),assets),/outside the checkout/);
 assert.throws(()=>privateCommuteOutput(resolve(assets,'derived'),assets),/read-only source asset tree/);
 const alias=resolve(root,'checkout-alias');symlinkSync(repository,alias,'dir');
 assert.throws(()=>privateCommuteOutput(resolve(alias,'derived'),assets),/outside the checkout/);
 assert.equal(privateCommuteOutput(resolve(root,'output'),assets),resolve(root,'output'));
}));

test('wrong source-evidence hash fails without creating output or loading a model',async()=>{
 const root=mkdtempSync(resolve(tmpdir(),'crownfall-commute-test-'));
 try{const file=resolve(root,'prior.json'),out=resolve(root,'output');writeFileSync(file,JSON.stringify({schemaVersion:1,method:'cpu-sampled-skin-and-props-v1',fps:60,paddingMetres:.05,residents:{}}));
  await assert.rejects(bakeVillageCommuteMotion(['--assets-root',assets,'--source-evidence',file,'--source-evidence-sha256','0'.repeat(64),'--output-dir',out]),/source evidence SHA-256/);
  assert.equal(existsSync(out),false);
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('fresh origin cannot be mixed with prior inputs, and absent origin or unknown scope writes nothing',async()=>{
 const root=mkdtempSync(resolve(tmpdir(),'crownfall-fresh-motion-test-'));
 try{
  const out=resolve(root,'output'),base=['--assets-root',assets,'--output-dir',out];
  for(const prior of [['--source-evidence',resolve(root,'missing.json')],['--source-evidence-sha256','0'.repeat(64)]]){
   await assert.rejects(bakeVillageCommuteMotion([...base,'--fresh',...prior]),/Fresh motion sampling cannot include prior evidence/);
  }
  await assert.rejects(bakeVillageCommuteMotion(base),/Choose --fresh or supply both prior evidence inputs/);
  await assert.rejects(bakeVillageCommuteMotion([...base,'--fresh','--clip-scope','invented']),/Unknown motion clip scope/);
  assert.equal(existsSync(out),false);
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('routine selection includes declared social/work/seated transitions, never an unrelated occupation',()=>{
 const art=getPopulationArt('ealdholt-house-steward')!;
 const names=['idle','walk_b','walk_b_start','walk_b_stop','talk','sit_down','sit','stand_up','work_tally','work_tally_enter','work_tally_exit','work_address','work_read','work_sow'];
 const commute=selectCommuteMotionClips(art,null,names,'commute'),routine=selectCommuteMotionClips(art,null,names,'routine');
 assert.deepEqual(commute,['idle','walk_b','walk_b_start','walk_b_stop']);
 for(const name of ['talk','work_tally','work_tally_enter','work_tally_exit','work_address','work_read','sit_down','sit','stand_up'])assert.ok(routine.includes(name),name);
 assert.equal(routine.includes('work_sow'),false);assert.equal(routine.includes('work_read_enter'),false);
});

test('fresh actual-asset sampling has no invented prior and real joint/skin measurements survive a legacy commute merge', {timeout:120000},async()=>{
 const root=mkdtempSync(resolve(tmpdir(),'crownfall-fresh-motion-real-'));
 try{
  const fresh=resolve(root,'fresh'),resident='ealdholt-house-steward';
  const first=await bakeVillageCommuteMotion(['--assets-root',assets,'--fresh','--only',resident,'--levels','crowd','--output-dir',fresh,'--max-ms','60000','--max-heap-mib','512']);
  assert.equal(first.completed,true);assert.deepEqual(first.errors,[]);
  assert.equal(first.provenanceMode,'fresh-measured');assert.equal(first.sourceEvidence,null);assert.equal(first.sourceEvidenceSha256,null);
  assert.equal(first.selection.fullPopulation,false);assert.equal(first.selection.clipScope,'routine');assert.equal(first.rows.length,1);
  assert.equal(first.siteClearance,'not-measured-by-animation-envelope-bake');
  const file=resolve(fresh,'commute-motion-evidence.json'),bytes=readFileSync(file),evidence=parsePopulationMotionEvidence(JSON.parse(bytes.toString()));
  const level=evidence.residents[resident].levels.crowd!;
  for(const name of ['idle','walk_b','walk_b_start','walk_b_stop','talk','work_tally','work_tally_enter','work_tally_exit','sit'])assert.ok(level.clips[name],name);
  const walk=first.rows[0].clips.find((clip:any)=>clip.name==='walk_b');
  assert.ok(walk.samples>2&&walk.skinnedVertexSamples>1000&&walk.crossChecks>=3);assert.ok(walk.largestReferenceError<=1e-8);
  assert.equal(walk.jointTrajectories.method,'sampled-joint-centres-not-contact-proof');
  for(const name of ['root','foot_l','foot_r']){
   const joint=walk.jointTrajectories.joints.find((row:any)=>row.name===name);assert.ok(joint,name);
   assert.ok([...joint.minimum,...joint.maximum,...joint.first,...joint.last,joint.travelMetres].every(Number.isFinite));
  }
  assert.ok(walk.jointTrajectories.joints.find((row:any)=>row.name==='foot_l').travelMetres>.01,'actual walking foot joint must move');
  assert.throws(()=>validateCompleteCommuteBake(bytes,first),/all100 residents/,'a measured pilot cannot qualify the whole population');
  const merge=resolve(root,'merge'),second=await bakeVillageCommuteMotion(['--assets-root',assets,'--source-evidence',file,'--source-evidence-sha256',sha(bytes),'--only',resident,'--levels','crowd','--output-dir',merge,'--max-ms','60000','--max-heap-mib','512']);
  assert.equal(second.completed,true);assert.equal(second.provenanceMode,'merge-prior');assert.equal(second.sourceEvidenceSha256,sha(bytes));assert.equal(second.selection.clipScope,'commute');
  assert.equal(second.rows[0].clips.some((clip:any)=>clip.name==='work_tally'),false,'commute default must retain rather than silently resample prior work');
  const merged=parsePopulationMotionEvidence(JSON.parse(readFileSync(resolve(merge,'commute-motion-evidence.json'),'utf8')));
  assert.deepEqual(merged.residents[resident].levels.crowd!.clips.work_tally,level.clips.work_tally);
  assert.deepEqual(merged.residents[resident].levels.crowd!.clips.talk,level.clips.talk);
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('completed partial batches and mismatched reports cannot masquerade as100-resident integration',()=>{
 const bytes=Buffer.from(JSON.stringify({schemaVersion:1,method:'cpu-sampled-skin-and-props-v1',fps:60,paddingMetres:.05,residents:{}}));
 const report={completed:true,method:'cpu-sampled-skin-and-props-v1',fps:60,paddingMetres:.05,rows:[],errors:[],outputSha256:sha(bytes)};
 assert.throws(()=>validateCompleteCommuteBake(bytes,report),/all100 residents/);
 assert.throws(()=>validateCompleteCommuteBake(bytes,{...report,outputSha256:'0'.repeat(64)}),/does not match evidence/);
});

test('public authoring requires the matching source profile and actual named well inventory',()=>{
 assert.throws(()=>validatePublicWellInventory({binding:{profile:'quest',sourceSha256:'a'.repeat(64)}},'desktop','a'.repeat(64)),/source profile and identity/);
 assert.throws(()=>validatePublicWellInventory({binding:{profile:'desktop',sourceSha256:'a'.repeat(64)},lifeSite:{sourceModelSha256:'a'.repeat(64),sourceOriginalBuffersUnchanged:true,functionalObjectInventory:[]}},'desktop','a'.repeat(64)),/Actual source-named well bounds/);
});

test('fresh integration rejects old-world inputs, absent explicit mode and unpinned candidate bytes before output',async()=>{
 const root=mkdtempSync(resolve(tmpdir(),'crownfall-fresh-integrate-test-'));
 try{
  const out=resolve(root,'output'),base=['--assets-root',assets,'--motion',resolve(root,'missing-motion.json'),'--motion-report',resolve(root,'missing-report.json'),'--output-dir',out];
  await assert.rejects(integrateVillageCommuteMotion([...base,'--fresh-candidate','--source-evidence',resolve(root,'missing-prior.json')]),/cannot include prior-world inputs/);
  await assert.rejects(integrateVillageCommuteMotion([...base,'--profile','desktop']),/explicit --fresh-candidate mode/);
  const site=resolve(root,'candidate.json');writeFileSync(site,'{}');
  await assert.rejects(integrateVillageCommuteMotion([...base,'--fresh-candidate','--profile','desktop','--site-candidate',site,'--site-candidate-sha256','0'.repeat(64),
   '--source-model',resolve(root,'missing.glb'),'--source-model-sha256','a'.repeat(64),'--motion-sha256','b'.repeat(64),'--motion-report-sha256','c'.repeat(64)]),/Fresh site candidate SHA-256/);
  const model=resolve(root,'mismatched.glb'),header=Buffer.alloc(20);header.writeUInt32LE(0x46546c67,0);header.writeUInt32LE(2,4);header.writeUInt32LE(20,8);writeFileSync(model,header);
  await assert.rejects(integrateVillageCommuteMotion([...base,'--fresh-candidate','--profile','desktop','--site-candidate',site,'--site-candidate-sha256',sha('{}'),
   '--source-model',model,'--source-model-sha256','0'.repeat(64),'--motion-sha256','b'.repeat(64),'--motion-report-sha256','c'.repeat(64)]),/Original source model SHA-256/);
  assert.equal(existsSync(out),false);
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('fresh source candidates must explicitly retain their new-world-only identity and actual model/profile',()=>{
 const pins={sourceModelSha256:'a'.repeat(64),siteCandidateSha256:'b'.repeat(64),motionSha256:'c'.repeat(64),motionReportSha256:'d'.repeat(64)};
 const marker={status:'new-measured-candidate',identity:'new-source-candidate:unit-rejection',freshWorldsOnly:true,previousPackageRecovered:false,sourceModelSha256:pins.sourceModelSha256,
  sourceMeasurement:{sourceSha256:pins.sourceModelSha256,sourceOriginalBuffersUnchanged:true}};
 const raw={authoringCandidate:marker,binding:{profile:'desktop',sourceSha256:pins.sourceModelSha256}};
 assert.throws(()=>prepareFreshCommuteMotionSite({},null,'desktop',pins),/Fresh source candidate/);
 for(const change of [{freshWorldsOnly:false},{previousPackageRecovered:true},{sourceModelSha256:'0'.repeat(64)}]){
  assert.throws(()=>prepareFreshCommuteMotionSite({...raw,authoringCandidate:{...marker,...change}},null,'desktop',pins),/Fresh source candidate/);
 }
 assert.throws(()=>prepareFreshCommuteMotionSite(raw,null,'quest',pins),/Fresh source candidate/);
 assert.throws(()=>prepareFreshCommuteMotionSite({...raw,motionEvidence:{}},null,'desktop',pins),/without prior motion bindings/);
 assert.throws(()=>prepareFreshCommuteMotionSite(raw,null,'desktop',{...pins,motionSha256:''}),/exact input SHA-256/);
 assert.throws(()=>validateFreshCommuteBake(Buffer.from('{}'),{provenanceMode:'merge-prior'}),/explicit fresh measured bake/);
});

const freshFixture=process.env.CROWNFALL_FRESH_COMMUTE_FIXTURE;
test('actual fresh candidate integration preserves original site bytes and holds unsupported envelopes',
 {skip:!freshFixture&&'Set CROWNFALL_FRESH_COMMUTE_FIXTURE to a completed fresh candidate integration directory.'},async()=>{
 const root=resolve(freshFixture!),summary=JSON.parse(readFileSync(resolve(root,'fresh-commute-integration-report.json'),'utf8'));
 assert.equal(summary.freshWorldsOnly,true);assert.equal(summary.sourceEvidence,null);assert.equal(summary.savedStateChanged,false);assert.equal(summary.configurationChanged,false);
 const motionBytes=readFileSync(summary.motion.path),report=JSON.parse(readFileSync(summary.bakeReport.path,'utf8')),evidence=validateFreshCommuteBake(motionBytes,report);
 assert.equal(Object.keys(evidence.residents).length,100);assert.equal(report.rows.length,108);
 const candidateBytes=readFileSync(summary.candidate.path),raw=JSON.parse(candidateBytes.toString()),profile=summary.profiles[0].profile;
 assert.equal(sha(candidateBytes),summary.candidate.sha256);assert.equal(sha(motionBytes),summary.motion.sha256);
 const output=JSON.parse(readFileSync(resolve(root,summary.profiles[0].output.filename),'utf8')),nonMotion={...output};delete nonMotion.motionEvidence;delete nonMotion.freshMotionProvenance;
 assert.deepEqual(nonMotion,raw);assert.equal(output.freshMotionProvenance.freshWorldsOnly,true);assert.equal(output.freshMotionProvenance.priorEvidence,null);
 assert.equal(output.freshMotionProvenance.sourceModelSha256,summary.sourceModel.sha256);
 const prepared=prepareCommuteMotionSite(output,output.motionEvidence,profile),capabilities=auditCommuteEnvelopeCapabilities(prepared.site,evidence,profile);
 assert.equal(capabilities.ordinaryWalk.total,100);assert.equal(capabilities.ordinaryWalk.qualified,100);
 if(prepared.site.capsule.height===3.5){assert.equal(capabilities.movingRolePlans.total,40);assert.equal(capabilities.movingRolePlans.qualified,40);assert.deepEqual(capabilities.movingRolePlans.held,[]);}
 else assert.ok(capabilities.movingRolePlans.held.some(row=>row.clip==='guard_patrol_walk'&&row.reason==='motion-proxy-budget-exceeded:crowd:guard_patrol_walk'));
 const unreported=JSON.parse(JSON.stringify(report));unreported.rows[0].clips.pop();
 assert.throws(()=>validateFreshCommuteBake(motionBytes,unreported),/clips not measured/);
 const contactClaim=JSON.parse(JSON.stringify(report));contactClaim.rows[0].clips[0].jointTrajectories.method='measured-equipment-contact';
 assert.throws(()=>validateFreshCommuteBake(motionBytes,contactClaim),/joint-centre trajectories/);
 const invalidBounds=JSON.parse(JSON.stringify(report)),joint=invalidBounds.rows[0].clips[0].jointTrajectories.joints[0];joint.maximum[0]=joint.minimum[0]-.1;
 assert.throws(()=>validateFreshCommuteBake(motionBytes,invalidBounds),/leaves its measured bounds/);
 const partialSkin=JSON.parse(JSON.stringify(report));partialSkin.rows[0].clips[0].skinnedVertexSamples--;
 assert.throws(()=>validateFreshCommuteBake(motionBytes,partialSkin),/every sampled skinned vertex/);
 const out=resolve(mkdtempSync(resolve(tmpdir(),'crownfall-fresh-pins-')),'output');
 try{
  await assert.rejects(integrateVillageCommuteMotion(['--assets-root',assets,'--fresh-candidate','--profile',profile,'--site-candidate',summary.candidate.path,'--site-candidate-sha256','0'.repeat(64),
   '--source-model',summary.sourceModel.path,'--source-model-sha256',summary.sourceModel.sha256,'--motion',summary.motion.path,'--motion-sha256',summary.motion.sha256,
   '--motion-report',summary.bakeReport.path,'--motion-report-sha256',summary.bakeReport.sha256,'--output-dir',out]),/Fresh site candidate SHA-256/);
  assert.equal(existsSync(out),false);
 }finally{rmSync(dirname(out),{recursive:true,force:true});}
 assert.equal(sha(readFileSync(summary.candidate.path)),summary.candidate.sha256);
});

const fixture=process.env.CROWNFALL_COMMUTE_MOTION_FIXTURE;
test('actual private source proofs retain safety holds while all ordinary gaits become qualified',
 {skip:!fixture&&'Set CROWNFALL_COMMUTE_MOTION_FIXTURE to a completed portable integration output.'},()=>{
 const root=resolve(fixture!),report=JSON.parse(readFileSync(resolve(root,'commute-integration-report.json'),'utf8'));
 const motionBytes=readFileSync(report.motion.path),bakeReport=JSON.parse(readFileSync(report.bakeReport.path,'utf8'));
 const evidence=validateCompleteCommuteBake(motionBytes,bakeReport);assert.equal(Object.keys(evidence.residents).length,100);
 const poisoned=JSON.parse(JSON.stringify(bakeReport));poisoned.rows[0].clips[0].largestReferenceError=1e-5;
 assert.throws(()=>validateCompleteCommuteBake(motionBytes,poisoned),/skinning cross-checks/);
  const duplicate=JSON.parse(JSON.stringify(bakeReport));duplicate.rows[0].clips.push(duplicate.rows[0].clips[0]);
  assert.throws(()=>validateCompleteCommuteBake(motionBytes,duplicate),/measured clips/);
 for(const profile of ['desktop','quest'] as const){
  const data=JSON.parse(readFileSync(resolve(root,profile+'-commute-sites.json'),'utf8'));
  const prepared=prepareCommuteMotionSite(data,data.motionEvidence,profile);assert.deepEqual(prepared.data,data);
  const capabilities=auditCommuteEnvelopeCapabilities(prepared.site,parsePopulationMotionEvidence(data.motionEvidence),profile);
  assert.equal(capabilities.ordinaryWalk.total,100);assert.equal(capabilities.ordinaryWalk.qualified,100);
  const patrols=capabilities.movingRolePlans.held.filter(row=>row.clip==='guard_patrol_walk');
  assert.equal(patrols.length,10);assert.ok(patrols.every(row=>row.reason==='motion-proxy-budget-exceeded:crowd:guard_patrol_walk'));
 }
});

test('portable integration refuses wrong prior provenance without writing output',
 {skip:!fixture&&'Set CROWNFALL_COMMUTE_MOTION_FIXTURE to a completed portable integration output.'},async()=>{
 const root=mkdtempSync(resolve(tmpdir(),'crownfall-commute-test-'));
 try{const source=resolve(fixture!),summary=JSON.parse(readFileSync(resolve(source,'commute-integration-report.json'),'utf8')),
   prior=JSON.parse(readFileSync(summary.bakeReport.path,'utf8')),out=resolve(root,'output');
  await assert.rejects(integrateVillageCommuteMotion(['--assets-root',assets,'--source-evidence',prior.sourceEvidence,'--source-evidence-sha256','0'.repeat(64),
   '--motion',summary.motion.path,'--motion-report',summary.bakeReport.path,'--desktop',resolve(source,'desktop-commute-sites.json'),'--quest',resolve(source,'quest-commute-sites.json'),'--output-dir',out]),/Original source evidence/);
  assert.equal(existsSync(out),false);
 }finally{rmSync(root,{recursive:true,force:true});}
});

const publicFixture=process.env.CROWNFALL_PUBLIC_SITE_FIXTURE;
test('portable public authoring exactly reproduces measured v5 allocation without changing geometry or named homes',
 {skip:!publicFixture&&'Set CROWNFALL_PUBLIC_SITE_FIXTURE to completed source-backed public-site output.'},()=>{
 const root=resolve(publicFixture!),summary=JSON.parse(readFileSync(resolve(root,'public-sites-report.json'),'utf8'));
 const expected={desktop:'e04c1fd0de4f9e05398be949eeaa7ffa67ee7a0ad3a4ac6ec8d830613b47b643',quest:'36d0ce7121a125367ea0313e244e2c461884b3c9081302053d6deb06f7c760cf'};
 for(const profile of ['desktop','quest'] as const){
  const bytes=readFileSync(resolve(root,`ealdholt-population-${profile}-life-sites-v5.json`));assert.equal(sha(bytes),expected[profile]);
  const data=JSON.parse(bytes.toString()),input=summary.inputs.find((row:any)=>row.profile===profile),before=JSON.parse(readFileSync(input.site.path,'utf8')),inventory=JSON.parse(readFileSync(input.inventory.path,'utf8'));
  const site=validatePublicSiteManifest(data,profile),wells=validatePublicWellInventory(inventory,profile,site.sourceSha256);
  for(const field of ['binding','certificate','rigidSourceClearance','placeBindings','motionEvidence','workplaceAnchors'])assert.deepEqual(data[field],before[field]);
  assert.deepEqual(data.lifeSite.households.find((home:any)=>home.placeId==='smithy-house').sourceDoor,before.lifeSite.households.find((home:any)=>home.placeId==='smithy-house').sourceDoor);
  const report=summary.profiles.find((row:any)=>row.profile===profile);assert.equal(report.homeBound,100);assert.equal(report.workBound,54);assert.equal(report.homeWorkConnected,54);assert.equal(report.distinctCommutes,16);
  for(const change of data.lifeSite.publicAuthoring.changes){
   assert.equal(change.capacity,1);if(!change.toAnchorId)continue;
   assert.ok(before.residentPlaceBindings.some((row:any)=>row.placeId===change.placeId&&row.status==='mapped-exterior'&&row.anchorId===change.toAnchorId),'Original public category must be retained.');
   const anchor=site.anchors.find(row=>row.id===change.toAnchorId);assert.ok(anchor?.standingOnly);
   if(change.placeId==='village-well'){assert.ok(change.wellService.length>0);assert.ok(wells.some(well=>Math.hypot((well.min[0]+well.max[0])/2-anchor.sourceGroundPoint[0],(well.min[2]+well.max[2])/2-anchor.sourceGroundPoint[2])<=8));}
  }
  const broken=JSON.parse(bytes.toString());broken.certificate.sourceOriginalBuffersUnchanged=false;assert.throws(()=>validatePublicSiteManifest(broken,profile));
 }
 assert.ok(summary.capacity.every((row:any)=>row.simultaneousCapacityPerSlot===1));
});

test('unapproved functional inventory bytes fail before public-authoring output is created',
 {skip:!publicFixture&&'Set CROWNFALL_PUBLIC_SITE_FIXTURE to completed source-backed public-site output.'},async()=>{
 const root=mkdtempSync(resolve(tmpdir(),'crownfall-public-sites-test-'));
 try{const summary=JSON.parse(readFileSync(resolve(publicFixture!,'public-sites-report.json'),'utf8')),desktop=summary.inputs.find((row:any)=>row.profile==='desktop'),quest=summary.inputs.find((row:any)=>row.profile==='quest'),out=resolve(root,'output');
  await assert.rejects(reassignVillagePublicSites(['--desktop',desktop.site.path,'--quest',quest.site.path,'--desktop-inventory',desktop.inventory.path,'--desktop-inventory-sha256',desktop.inventory.sha256,'--quest-inventory',quest.inventory.path,'--quest-inventory-sha256','0'.repeat(64),'--output-dir',out]),/Functional inventory SHA-256/);
  assert.equal(existsSync(out),false);
 }finally{rmSync(root,{recursive:true,force:true});}
});
