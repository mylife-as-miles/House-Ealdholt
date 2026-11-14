import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { link, mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const files=[
 ['private-assets/elderbloom/ealdholt-population-desktop-fresh-exterior-v4-tall-commuting.json','fc60a1d43098bdb633b696fc92ea4751120f5741e671a699384bf39f7b676475','e5d57ded21f3bc2c2ac398bb6a8a063c8a7a8333'],
 ['main game/public/assets/legacy/ealdholt-loading.webp','cd323b1beba7b0817a4aade6720ef8b5a276e26ee254247a29665ca38d7c0a90','a874e86b26fe2c1a0b9d5d9c3e8a003c3b1823ac'],
 ['main game/public/video/crownfall-ealdholt-opening.mp4','cabfcb4780ee7a27675122c9350d257d351e3c7b257da8c18a0d62dfa698fa9e','1d505fd66431b333a7e22cf48265cce0cfb54077',13820923],
 ...[
 ['cyning-slieht.mp3','feed6d0e751e1bed883c7f86e62527a0d89d5af31b2dcb27d15b4251b900986b','2370b335d6a6fc17666711c7ec208e865ce5ba74'],
 ['krom-shahid.mp3','4a8a88685f4494b0f693d2409c5b210c3f85eb01e445f76fc12ad5d9dec34aab','47be1a049ff1263b5dc82ffef78166ff523f60ff'],
 ['la-felure-demure.mp3','d961f13a2207179d8b008f03fe466d7722694ea3a6c6b36c5fbbea8579afcba2','4d312d776b8be8877841f1600331879a7fd79aef'],
 ['le-roi-muet.mp3','1f0c2ffed5eebd12efb7a10af94df4fec465d4cc4bc1d48c49156bf7fb7d7379','add88859b7e25c339c73fd68efabe21582217834'],
 ['sanguis-et-terra.mp3','234f9f2af1889a25803143bc4ec2b50f5ed2caefd2e82d6e2ca71da5f9ff5a68','fba6df09a72d16d4839137d7334a358d662438f2'],
 ['slay-the-iron-slave.mp3','05f48d646dc3ab035c5652770f6a604bfa1561c3734c570318440f4f3fd5f17c','12026757b43b89465c0355e82ffaef73c685701d'],
 ].map(([name,hash,blob])=>['main game/public/audio/soundtrack/'+name,hash,blob]),
];
async function digest(file){const hash=createHash('sha256');for await(const b of createReadStream(file))hash.update(b);return hash.digest('hex');}
async function matches(file,expected,expectedBytes){const metadata=await stat(file);return metadata.isFile()&&(expectedBytes===undefined||metadata.size===expectedBytes)&&await digest(file)===expected;}
for(const [target,expected,blob,expectedBytes] of files){
 const dest=resolve(root,target);await mkdir(dirname(dest),{recursive:true});
 let exists=true;try{await stat(dest);}catch(error){if(error.code!=='ENOENT')throw error;exists=false;}
 if(exists){if(!await matches(dest,expected,expectedBytes))throw Error('Existing file has a different size or hash; it was not overwritten: '+target);console.log('Verified '+target);continue;}
 const tmpDir=await mkdtemp(dest+'.download-'),tmp=resolve(tmpDir,'asset');
 try{
  // The 13.8 MB film is returned as base64 JSON, which exceeds 16 MiB.
  const encoded=execFileSync('gh',['api',`repos/mylife-as-miles/Crownfall/git/blobs/${blob}`,'--jq','.content'],{encoding:'utf8',maxBuffer:32*1024*1024,stdio:['ignore','pipe','inherit']});
  await writeFile(tmp,Buffer.from(encoded.replace(/\s/g,''),'base64'),{flag:'wx',mode:0o600});
  if(!await matches(tmp,expected,expectedBytes))throw Error('Downloaded file has the wrong size or SHA-256: '+target);
  // A hard link in the same directory creates the destination atomically and
  // cannot overwrite a file created after the initial existence check.
  try{await link(tmp,dest);console.log('Downloaded and verified '+target);}
  catch(error){if(error.code!=='EEXIST'||!await matches(dest,expected,expectedBytes))throw error;console.log('Verified existing '+target);}
 }finally{await rm(tmpDir,{recursive:true,force:true});}
}
