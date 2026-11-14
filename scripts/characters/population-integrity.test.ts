import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { EALDHOLT_POPULATION_ASSET_SHA256 as hashes } from '../../shared/legacy/aethelgard/characters/population-asset-integrity';
import { EALDHOLT_VILLAGE_POPULATION } from '../../shared/legacy/aethelgard/characters/village-population';
import { getPopulationArt } from '../../shared/legacy/aethelgard/characters/village-population-art';
const root=join(import.meta.dirname,'../../main game/public/assets/legacy/environment/aethelgard/characters');
function files(folder:string,prefix=''):string[] {
  return readdirSync(folder,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(join(folder,e.name),prefix+e.name+'/')
    :/\.(?:glb|json)$/.test(e.name)?[prefix+e.name]:[]);
}
test('trusted population identities cover every published metadata/model/library/kit byte',()=>{
  assert.deepEqual(Object.keys(hashes).sort(),files(root).sort());
  for(const [file,expected]of Object.entries(hashes)) {
    assert.ok(!file.includes('..')&&!file.startsWith('/'));
    assert.equal(createHash('sha256').update(readFileSync(join(root,file))).digest('hex'),expected,file);
  }
});
test('all 100 residents have integrity-bound art including their metadata and shared motion',()=>{
  const relative=(path:string)=>{assert.ok(path.startsWith('aethelgard/characters/'));return path.slice('aethelgard/characters/'.length);};
  assert.equal(EALDHOLT_VILLAGE_POPULATION.residents.length,100);
  for(const resident of EALDHOLT_VILLAGE_POPULATION.residents) {
    const art=getPopulationArt(resident.id)!;assert.ok(art,resident.id);
    assert.ok(hashes[relative(art.manifest)],resident.id+' metadata');
    for(const level of art.levels)assert.equal(hashes[relative(level.path)],level.sha256,resident.id+' model');
    if(art.clipLibrary)assert.equal(hashes[relative(art.clipLibrary.path)],art.clipLibrary.sha256,resident.id+' library');
  }
});
