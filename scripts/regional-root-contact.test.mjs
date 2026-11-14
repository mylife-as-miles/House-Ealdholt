import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {readRegionalWoodRoots,combineRegionalRootContacts} from './environment/build-regional-root-contact.mjs';
test('committed root contacts exactly match the unchanged Desktop and Quest wood geometry',async()=>{
 const base=new URL('../main game/public/assets/legacy/environment/aethelgard/regional-v1/',import.meta.url);
 const files=['vegetation-desktop.glb','vegetation-quest.glb'],bytes=await Promise.all(files.map(file=>readFile(new URL(file,base))));
 const actual=combineRegionalRootContacts(bytes.map(readRegionalWoodRoots));
 const source=await readFile(new URL('../shared/legacy/aethelgard/environment/regional-root-contact-data.ts',import.meta.url),'utf8');
 const stored=JSON.parse(source.slice(source.indexOf(' = {',source.indexOf('export const REGIONAL_ROOT_CONTACTS'))+3).trim().replace(/;$/,''));
 assert.deepEqual(actual,stored);
 const hashes=Object.fromEntries(files.map((file,i)=>[file,createHash('sha256').update(bytes[i]).digest('hex')]));
 const manifest=JSON.parse(await readFile(new URL('vegetation.manifest.json',base),'utf8'));
 for(const file of files){assert.equal(hashes[file],manifest.files[file].sha256);assert.ok(source.includes(hashes[file]));}
 assert.ok(stored.bramble.baseY>.17);
});
