import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {link,lstat,mkdir,mkdtemp,open,readFile,realpath,rm,stat,unlink,writeFile} from 'node:fs/promises';
import {basename,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const MODEL='elderbloom-village-desktop-coastal-full-woodland-candidate-v5.glb';
const EXPECTED={bytes:174285136,sha256:'3b02834505642a5a9e7535e92812df8e565b99005e9921d41be83be4f5da3b28'};
const CHUNK_BYTES=16*1024*1024;
async function fileHash(path){const h=createHash('sha256');for await(const data of createReadStream(path))h.update(data);return h.digest('hex');}
async function matches(path,bytes,sha){const s=await lstat(path);return s.isFile()&&!s.isSymbolicLink()&&s.size===bytes&&await fileHash(path)===sha;}
async function existingMatches(path,data){try{const s=await lstat(path);return s.isFile()&&!s.isSymbolicLink()&&s.size===data.length&&(await readFile(path)).equals(data);}catch(e){if(e.code==='ENOENT')return null;throw e;}}
/** Build all pieces in a temporary sibling directory. Existing files are never
 * overwritten; an identical set can be reused. Remove only a separately
 * verified output copy after all files and the manifest are durable. */
export async function splitVillageModel({input,outputDir,expected=EXPECTED,chunkBytes=CHUNK_BYTES,removeModelCopy=false}){
 if(!input||!outputDir||!Number.isSafeInteger(expected.bytes)||expected.bytes<1||!/^[a-f0-9]{64}$/.test(expected.sha256)||!Number.isSafeInteger(chunkBytes)||chunkBytes<1||chunkBytes>CHUNK_BYTES)throw Error('Invalid input or model identity.');
 const source=await realpath(input), sourceInfo=await stat(source), name=basename(source),output=resolve(outputDir),copy=join(output,name);
 if(!/^[A-Za-z0-9._-]+\.glb$/.test(name)||!sourceInfo.isFile()||sourceInfo.size!==expected.bytes||await fileHash(source)!==expected.sha256)throw Error('Source village size or SHA-256 does not match.');
 await mkdir(output,{recursive:true});
 if(removeModelCopy){const copyInfo=await lstat(copy);if(!copyInfo.isFile()||copyInfo.isSymbolicLink()||copyInfo.dev===sourceInfo.dev&&copyInfo.ino===sourceInfo.ino||!await matches(copy,expected.bytes,expected.sha256))throw Error('Output model is not a separate verified copy; it was not removed.');}
 const stage=await mkdtemp(join(output,'.village-chunks-')), parts=[];let fd;
 try{
  fd=await open(source,'r');let offset=0,index=0;const reassembled=createHash('sha256');
  while(offset<expected.bytes){const length=Math.min(chunkBytes,expected.bytes-offset),buffer=Buffer.allocUnsafe(length);let read=0;
   while(read<length){const part=await fd.read(buffer,read,length-read,offset+read);if(!part.bytesRead)throw Error('Source village ended unexpectedly.');read+=part.bytesRead;}
   reassembled.update(buffer);const file=`${name}.part-${String(index).padStart(3,'0')}`,sha256=createHash('sha256').update(buffer).digest('hex');await writeFile(join(stage,file),buffer,{flag:'wx',mode:0o600});parts.push({file,bytes:length,sha256});offset+=length;index++;
  }
  await fd.close();fd=null;if(reassembled.digest('hex')!==expected.sha256)throw Error('Split chunks do not match the source SHA-256.');
  // Recheck the source after reading so a concurrent replacement cannot result in a manifest for mixed bytes.
  if(!await matches(source,expected.bytes,expected.sha256))throw Error('Source village changed during splitting.');
  const manifest={version:1,model:name,bytes:expected.bytes,sha256:expected.sha256,chunkBytes,chunks:parts};
  const manifestName=`${name}.chunks.json`,manifestBytes=Buffer.from(JSON.stringify(manifest,null,2)+'\n');await writeFile(join(stage,manifestName),manifestBytes,{flag:'wx',mode:0o600});
  for(const part of parts){try{const s=await lstat(join(output,part.file));if(!s.isFile()||s.isSymbolicLink()||!await matches(join(output,part.file),part.bytes,part.sha256))throw Error(`Existing chunk differs: ${part.file}`);}catch(e){if(e.code!=='ENOENT')throw e;}}
  const old=await existingMatches(join(output,manifestName),manifestBytes);if(old===false)throw Error('Existing chunk manifest differs; it was not overwritten.');
  for(const file of [...parts.map(p=>p.file),manifestName]){try{await link(join(stage,file),join(output,file));}catch(e){if(e.code!=='EEXIST')throw e;}}
  // Validate the published set again (including a possible concurrent writer).
  for(const part of parts)if(!await matches(join(output,part.file),part.bytes,part.sha256))throw Error('Output chunk verification failed.');
  if(!await existingMatches(join(output,manifestName),manifestBytes))throw Error('Output manifest verification failed.');
  if(removeModelCopy){const copyInfo=await lstat(copy);if(!copyInfo.isFile()||copyInfo.isSymbolicLink()||copyInfo.dev===sourceInfo.dev&&copyInfo.ino===sourceInfo.ino||!await matches(copy,expected.bytes,expected.sha256))throw Error('Output model changed and was not removed.');await unlink(copy);}
  return {manifest:join(output,manifestName),parts:parts.length,bytes:expected.bytes,sha256:expected.sha256,removedOutputCopy:removeModelCopy};
 } finally{if(fd)await fd.close();await rm(stage,{recursive:true,force:true});}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2);if(args.includes('--help')){console.log('Usage: node scripts/split-village-model.mjs --input <verified-private-model.glb> --output-dir <build/legacy/elderbloom> [--remove-model-copy]');process.exit(0);}
 if(args.length<4||args[0]!=='--input'||args[2]!=='--output-dir'||args.length>5||args.length===5&&args[4]!=='--remove-model-copy'||basename(args[1])!==MODEL){console.error('Use --help for usage; only the verified desktop model is supported.');process.exitCode=1;}
 else splitVillageModel({input:args[1],outputDir:args[3],removeModelCopy:args[4]==='--remove-model-copy'}).then(result=>console.log(JSON.stringify(result))).catch(e=>{console.error(e.message);process.exitCode=1;});
}
