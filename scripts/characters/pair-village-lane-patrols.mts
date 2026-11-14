/** Finalize two already source-certified private candidates. Pairing adds no
 * geometry, placement, route, pose or saved-world migration. Node-only tool. */
import fs from 'node:fs';
import crypto from 'node:crypto';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {parseArgs} from 'node:util';
import {createEaldholtVillageSite,validateVillageSiteRigidClearance,applyVillageSiteRigidClearance,type VillageSiteNavigationAllocation} from '../../shared/legacy/aethelgard/characters/village-site.ts';
import {privateSourceOutput,RELEASED_SOURCE_SHA256} from './village-source-authoring.mts';
const sha=(bytes:string|Uint8Array)=>crypto.createHash('sha256').update(bytes).digest('hex');
export function pairedPatrolAllocation(desktopRevision:string,questRevision:string):VillageSiteNavigationAllocation{
  if(![desktopRevision,questRevision].every(v=>/^[a-f0-9]{64}$/u.test(v)))throw Error('Pair exact source-content revisions.');
  // The content revisions exclude pairing. The generation hashes those two
  // revisions; final file digests are computed afterward and never fed back.
  const generation=sha(JSON.stringify({schemaVersion:1,kind:'paired-lane-patrol-allocation-v1',desktopRevision,questRevision}));
  return Object.freeze({generation,desktopRevision,questRevision});
}
export function pairVillageLanePatrols(values:Record<string,string|undefined>){
  if(!values['desktop-site']||!values['quest-site']||!values['desktop-sha256']||!values['quest-sha256']||!values['output-dir'])throw Error('Provide both certified candidates, their exact --desktop-sha256/--quest-sha256 and a new private --output-dir.');
  const dir=privateSourceOutput(values['output-dir']),inputs=Object.fromEntries((['desktop','quest'] as const).map(profile=>{
    const file=resolve(values[`${profile}-site`]!),bytes=fs.readFileSync(file),hash=sha(bytes);
    if(hash!==values[`${profile}-sha256`])throw Error('Exact certified candidate input digest mismatch.');
    const raw=JSON.parse(bytes.toString());if(raw.binding?.navigationAllocation||raw.certificate?.navigationAllocation)throw Error('Pairing never rewrites an already paired candidate.');
    return[profile,{file,bytes,hash,raw}];
  }));
  const allocation=pairedPatrolAllocation(inputs.desktop.raw.binding.navigationRevision,inputs.quest.raw.binding.navigationRevision),outputs=[];
  for(const profile of ['desktop','quest'] as const){
    const input=inputs[profile],raw=input.raw;
    if(raw.binding.sourceSha256!==RELEASED_SOURCE_SHA256[profile]||raw.binding.profile!==profile)throw Error('The declared profile needs its exact original source model identity.');
    const data={...raw,binding:{...raw.binding,navigationAllocation:allocation},certificate:{...raw.certificate,navigationAllocation:allocation},
      pairedPatrolProvenance:{schemaVersion:1,kind:'pairing-only-no-geometry-change',baseCandidateSha256:input.hash,allocation}};
    const site=createEaldholtVillageSite({profile,modelSha256:RELEASED_SOURCE_SHA256[profile],binding:data.binding,certificate:data.certificate,placeBindings:data.placeBindings,residentPlaceBindings:data.residentPlaceBindings});
    const rigid=applyVillageSiteRigidClearance(site,validateVillageSiteRigidClearance(site,data.rigidSourceClearance));
    if(!site.navigationAllocation||site.patrols?.length!==2||rigid.anchors.length!==site.anchors.length||rigid.routes.length!==site.routes.length)throw Error('The complete certified patrol source must survive pairing unchanged.');
    const unpaired=JSON.parse(JSON.stringify(data));delete unpaired.binding.navigationAllocation;delete unpaired.certificate.navigationAllocation;delete unpaired.pairedPatrolProvenance;
    if(JSON.stringify(unpaired)!==JSON.stringify(raw))throw Error('Pairing changed original source-authoring data.');
    const bytes=Buffer.from(JSON.stringify(data)),file=resolve(dir,`${profile}-guard-lane-patrol-v1.json`);
    if(fs.existsSync(file))throw Error('Choose a new private pair output; never overwrite a source package.');
    outputs.push({profile,file,bytes,sha256:sha(bytes),baseCandidateFile:input.file,baseCandidateSha256:input.hash,originalGeometryAndBindingsUnchanged:true});
  }
  const manifestFile=resolve(dir,'paired-patrol-allocation.json');if(fs.existsSync(manifestFile))throw Error('Choose an unused pair manifest destination.');
  for(const input of Object.values(inputs))if(sha(fs.readFileSync(input.file))!==input.hash)throw Error('Certified input changed during pairing.');
  fs.mkdirSync(dir,{recursive:true,mode:0o700});
  for(const output of outputs)fs.writeFileSync(output.file,output.bytes,{flag:'wx',mode:0o600});
  const manifest={schemaVersion:1,status:'private-paired-candidate-not-active',allocation,
    derivation:'SHA-256 of JSON.stringify({schemaVersion:1,kind:"paired-lane-patrol-allocation-v1",desktopRevision,questRevision}); revisions exclude pairing; final file digests are not inputs.',
    outputs:outputs.map(({bytes,...output})=>({...output,bytes:bytes.length})),sourceProofs:'Original certified candidate proofs remain unchanged alongside the v3 inputs; pairing modifies metadata identity only.',
    limitations:['No source GLB, original candidate, save, application configuration, scene or pose is written.','Only a fresh unbound world or a world already bound to this exact complete pair can use these sites.','Standing-watch transitions remain held; no idle or work permission is added.']};
  fs.writeFileSync(manifestFile,JSON.stringify(manifest,null,2),{flag:'wx',mode:0o600});return manifest;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){const{values}=parseArgs({options:{'desktop-site':{type:'string'},'quest-site':{type:'string'},'desktop-sha256':{type:'string'},'quest-sha256':{type:'string'},'output-dir':{type:'string'}}});console.log(JSON.stringify(pairVillageLanePatrols(values),null,2));}
