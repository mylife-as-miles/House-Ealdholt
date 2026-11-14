/** Publish only a completed, independently measured additive guard asset into
 * this checkout. Old clip libraries, residents, sites and saves stay byte exact. */
import fs from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {parseArgs} from 'node:util';
import {EALDHOLT_POPULATION_ASSET_SHA256 as original} from '../../shared/legacy/aethelgard/characters/population-asset-integrity.ts';

const repo=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const sha=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
const {values}=parseArgs({options:{'addon-dir':{type:'string'},'measurement-dir':{type:'string'}}});
if(!values['addon-dir']||!values['measurement-dir'])throw Error('Need --addon-dir and --measurement-dir.');
const addon=resolve(values['addon-dir']),measured=resolve(values['measurement-dir']);
const provenance=JSON.parse(fs.readFileSync(resolve(addon,'provenance.json'),'utf8'));
const proofBytes=fs.readFileSync(resolve(measured,'measurement.json')),proof=JSON.parse(proofBytes.toString());
if(proof.method!=='actual-platform-animationmixer-full-skin-and-held-spear-v1'||proof.fps!==60||proof.paddingMetres!==.05
  ||!proof.completed||proof.pass!==true||!['desktop','quest'].every(p=>proof.platforms[p]?.pass===true))throw Error('Both actual platform proofs must pass.');
if(proof.generator?.sha256!==sha(fs.readFileSync(resolve(repo,'scripts/characters/measure-guard-watch-addon.mts'))))throw Error('Measurement generator changed after its proof.');
for(const platform of ['desktop','quest']){
 const identities=proof.platforms[platform].sourceModuleSha256;
 if(!identities||Object.keys(identities).length!==4)throw Error('Actual caller/correction/owner and IK source identities are required.');
 for(const [path,hash]of Object.entries(identities)){
  if(typeof path!=='string'||path.includes('..')||path.startsWith('/')||sha(fs.readFileSync(resolve(repo,path)))!==hash)
   throw Error('Measured runtime source changed: '+path);
 }
}
const raw=fs.readFileSync(resolve(addon,provenance.output.file));
if(sha(raw)!==provenance.output.sha256||sha(raw)!==proof.addon.sha256||raw.length!==proof.addon.bytes)throw Error('Measured additive bytes changed.');
const characterRoot=resolve(repo,'main game/public/assets/legacy/environment/aethelgard/characters');
for(const [path,hash]of Object.entries(proof.sources))if(original[path]!==hash
  ||sha(fs.readFileSync(resolve(characterRoot,path)))!==hash||provenance.sources[path]!==hash)throw Error('An original source changed: '+path);
const folder='crowd-v1/addons/guard-watch-compact-v1',destination=resolve(characterRoot,folder);
if(fs.existsSync(destination))throw Error('Additive publish destination already exists; do not overwrite it.');
const sources:Record<string,string>={...proof.sources};
const outputs:Record<string,Buffer>={
 [folder+'/'+provenance.output.file]:raw,
 [folder+'/provenance.json']:fs.readFileSync(resolve(addon,'provenance.json')),
 [folder+'/measurement.json']:proofBytes,
};
for(const [path,bytes]of Object.entries(outputs))sources[path]=sha(bytes);
const spec={version:1,residentId:'ealdholt-garrison-spearman',file:folder+'/'+provenance.output.file,sources,
 soles:provenance.soles,grips:provenance.grips,handoff:provenance.handoff,
 seconds:proof.seconds,fadeSeconds:proof.fadeSeconds,measurements:Object.fromEntries(['desktop','quest'].map(platform=>{
  const p=proof.platforms[platform];return[platform,{clips:p.clips,blends:p.blends,maximumHandGapMetres:p.maximumHandGapMetres,
   maximumGripAngleDegrees:p.maximumGripAngleDegrees,maximumFootCorrectionMetres:p.maximumFootCorrectionMetres,fps:60,includesActualSkinAndHeldSpear:true}];}))};
const registryPath=resolve(repo,'shared/legacy/aethelgard/characters/population-asset-integrity.ts');
const registrySource=fs.readFileSync(registryPath,'utf8');
if(Object.keys(outputs).some(path=>Object.hasOwn(original,path)))throw Error('Addon paths are not new.');
const registry={...original,...Object.fromEntries(Object.entries(outputs).map(([path,b])=>[path,sha(b)]))};
const sorted=Object.fromEntries(Object.entries(registry).sort(([a],[b])=>a<b?-1:a>b?1:0));
const replacement=registrySource.replace(/Object\.freeze\(\{[\s\S]*\}\);/,`Object.freeze(${JSON.stringify(sorted,null,2)});`);
if(replacement===registrySource)throw Error('Registry generation seam not found.');
const publishedPath=resolve(repo,'shared/legacy/aethelgard/characters/guard-watch-published.ts');
const publishedSource=fs.readFileSync(publishedPath,'utf8');
const pending='export const PUBLISHED_GUARD_WATCH: PublishedGuardWatch | null = null;';
if(!publishedSource.includes(pending))throw Error('Expected explicit unqualified guard-art hold before first publication.');
const data='function freeze<T>(v:T):T { if(v && typeof v==="object") { for(const c of Object.values(v))freeze(c); Object.freeze(v); } return v; }\n'
 +'export const PUBLISHED_GUARD_WATCH: PublishedGuardWatch | null = freeze('+JSON.stringify(spec,null,2)+');';
fs.mkdirSync(destination,{recursive:true});
for(const [path,bytes]of Object.entries(outputs))fs.writeFileSync(resolve(characterRoot,path),bytes,{flag:'wx'});
fs.writeFileSync(resolve(destination,'SOURCES.md'),'# Guard watch additive clips\n\nOriginal Crownfall compact keyframes and spear handoff. The original body and base loops remain unchanged.\n\nMakeHuman geometry: CC0. 100STYLE: Ian Mason, Sebastian Starke and Taku Komura (2022), CC BY 4.0, doi:10.1145/3522618. Derived published patrol pose and unchanged watch-loop joins. The complete retained notices and licence texts are in ../../clips/SOURCES.md and the existing character source folders.\n\nmeasurement.json records both actual platform CPU skin/held-prop and blend tests. It certifies no new world anchor, occupation completion, Quest hardware performance or rendered visual score.\n');
fs.writeFileSync(registryPath,replacement);fs.writeFileSync(publishedPath,publishedSource.replace(pending,data));
console.log(JSON.stringify({folder,digests:Object.fromEntries(Object.entries(outputs).map(([p,b])=>[p,{bytes:b.length,sha256:sha(b)}])),originalSourceCount:Object.keys(original).length}));
