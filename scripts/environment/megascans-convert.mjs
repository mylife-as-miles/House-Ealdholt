/** Explicit offline CLI; the bounded child owns native/WASM encoder memory and job time. */
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import{readFile}from'node:fs/promises';
import{convertTextureSet}from'./megascans-texture-set.mjs';
import {convertMegascans} from './megascans-pipeline.mjs';
const names={input:'input',provenance:'provenance',output:'output','draco-module':'dracoModule','ktx-bin':'ktxBin','asset-root':'assetRoot'};
const args=process.argv.slice(2),worker=args[0]==='--worker';if(worker)args.shift();
if(!args.length||args.includes('--help')){console.log('Offline private GLB + Draco + KTX2 conversion.\nnode scripts/environment/megascans-convert.mjs --input ORIGINAL.glb --provenance SOURCE.json --output NEW_PRIVATE_DIRECTORY --draco-module /tools/draco3d/draco3d.js --ktx-bin /tools/KTX-Software/bin\nNo downloads/default sources. Preserve originals. FBX/OBJ mesh authoring must be reviewed first. For explicit material/decal/atlas/brush descriptors, also provide --asset-root SOURCE_DIRECTORY; no GLB is produced.');process.exit(0);}
try{
 const options={};for(let i=0;i<args.length;i+=2){const key=names[args[i].slice(2)];if(!args[i].startsWith('--')||!key||!args[i+1]||args[i+1].startsWith('--')||options[key])throw Error('Unknown, duplicate or incomplete argument.');options[key]=resolve(args[i+1]);}for(const key of ['input','provenance','output','ktxBin'])if(!options[key])throw Error('Missing explicit '+key+'.');
 if(worker){const metadata=JSON.parse(await readFile(options.provenance,'utf8'));if(metadata.assetKind==='mesh'&&!options.dracoModule)throw Error('Mesh mode requires --draco-module.');const m=metadata.assetKind==='mesh'?await convertMegascans(options):await convertTextureSet(options);console.log(JSON.stringify({manifest:options.output+'/manifest.json',assetKind:m.assetKind??'mesh',geometry:m.geometry?.length??false,textures:m.textures.length,metrics:m.metrics}));}
 else{const job=promisify(execFile)(process.execPath,['--max-old-space-size=1536',fileURLToPath(import.meta.url),'--worker',...args],{detached:true,maxBuffer:4*1024*1024});const timer=setTimeout(()=>{try{process.kill(-job.child.pid,'SIGKILL');}catch{}},300000);try{const result=await job;process.stdout.write(result.stdout);if(result.stderr)process.stderr.write(result.stderr);}finally{clearTimeout(timer);}}
}catch(error){console.error(error.stderr||error.stack||error);process.exitCode=1;}
