import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { patchEaldholtGroundAlbedoShader, readEaldholtGroundAlbedoManifest } from '../aethelgard/environment/ground-albedo-detail';

test('ground albedo uses actual owned manifest linear means and rejects guessed or external entries',async()=>{
  const source=JSON.parse(await readFile(new URL('../../../main game/public/assets/legacy/environment/textures/manifest.json',import.meta.url),'utf8'));
  const parsed=readEaldholtGroundAlbedoManifest(source);
  assert.equal(parsed.earth.meanLuminance,source.sets.earth.meanLuminance);assert.equal(parsed.rock.meanLuminance,source.sets.rock.meanLuminance);
  assert.equal(parsed.earth.meanLuminance,.0432);assert.equal(parsed.rock.meanLuminance,.0311);
  for(const mean of [undefined,0,-1,NaN,Infinity,1.2]){
    const invalid=structuredClone(source);invalid.sets.earth.meanLuminance=mean;
    assert.throws(()=>readEaldholtGroundAlbedoManifest(invalid),/Invalid owned earth/);
  }
  const external=structuredClone(source);external.sets.rock.files.albedo_512.file='https://example.invalid/texture.webp';
  assert.throws(()=>readEaldholtGroundAlbedoManifest(external),/Invalid owned rock/);
});

test('ground shader retains atlas and roughness chunks and samples linear detail once on the existing tiled UV',()=>{
  const texture={},shader={uniforms:{} as Record<string,{value:unknown}>,fragmentShader:'#include <common>\n#include <map_fragment>\n#include <roughnessmap_fragment>\n#include <lights_physical_fragment>'};
  patchEaldholtGroundAlbedoShader(shader,texture,.0432);const first=shader.fragmentShader;
  assert.ok(first.includes('#include <map_fragment>'));assert.ok(first.includes('#include <roughnessmap_fragment>'));
  assert.ok(first.indexOf('texture2D(uEaldholtGroundAlbedoDetail')>first.indexOf('#include <roughnessmap_fragment>'));
  assert.ok(first.indexOf('diffuseColor.rgb *=')<first.indexOf('#include <lights_physical_fragment>'));
  assert.match(first,/texture2D\(uEaldholtGroundAlbedoDetail, vRoughnessMapUv\)/);assert.match(first,/, \.56, 1\.55\)/);
  assert.doesNotMatch(first,/pow\(|sRGBToLinear|sRGBTransferEOTF/);
  assert.equal(shader.uniforms.uEaldholtGroundAlbedoDetail.value,texture);assert.equal(shader.uniforms.uEaldholtGroundAlbedoMean.value,.0432);
  patchEaldholtGroundAlbedoShader(shader,texture,.0432);assert.equal(shader.fragmentShader,first);
  assert.throws(()=>patchEaldholtGroundAlbedoShader({uniforms:{},fragmentShader:'custom unlit shader'},texture,.1),/standard PBR/);
});

test('photographic manifest selects matching Desktop and Quest map profiles without altering the fallback API',async()=>{
  const manifest=JSON.parse(await readFile(new URL('../../../main game/public/assets/legacy/environment/aethelgard/textures/manifest.json',import.meta.url),'utf8'));
  const desktop=readEaldholtGroundAlbedoManifest(manifest,'desktop'),quest=readEaldholtGroundAlbedoManifest(manifest,'quest');
  assert.equal(desktop.earth.size,1024);assert.equal(desktop.earth.normal?.size,1024);assert.equal(desktop.rock.orm?.size,1024);
  assert.equal(quest.earth.size,512);assert.equal(quest.earth.normal?.size,256);assert.equal(quest.rock.orm?.size,256);
  assert.equal(quest.earth.meanLuminance,manifest.sets.earth.profiles.quest.meanLuminance);assert.match(quest.earth.source!,/Poly Haven CC0/);
  assert.equal(quest.earth.photographic,true);assert.equal(desktop.rock.photographic,true);
  const invalid=structuredClone(manifest);invalid.sets.rock.profiles.quest.files.normal.file='external.png';
  assert.throws(()=>readEaldholtGroundAlbedoManifest(invalid,'quest'),/Invalid photographic rock normal/);
});

test('photographic soil retains source grass coverage while replacing atlas grit with linear photo colour',()=>{
  const source='#include <common>\n#include <map_fragment>\n#include <roughnessmap_fragment>\n#include <lights_physical_fragment>';
  const earth={uniforms:{},fragmentShader:source},rock={uniforms:{},fragmentShader:source},fallback={uniforms:{},fragmentShader:source};
  patchEaldholtGroundAlbedoShader(earth,{},.0533,true,'earth');
  patchEaldholtGroundAlbedoShader(rock,{},.1254,true,'rock');
  patchEaldholtGroundAlbedoShader(fallback,{},.0432);
  assert.match(earth.fragmentShader,/textureLod\(map, vMapUv, max\(2\.75, ealdholtAtlasDerivativeLod\)\)/);
  assert.match(earth.fragmentShader,/dFdx\(vMapUv\) \* ealdholtAtlasSize/);
  assert.match(earth.fragmentShader,/dFdy\(vMapUv\) \* ealdholtAtlasSize/);
  assert.match(earth.fragmentShader,/ealdholtSoilGain = clamp\(mix\(1\., ealdholtGroundDetailLuminance \/ uEaldholtGroundAlbedoMean, \.35\), \.7, 1\.35\)/);
  assert.match(earth.fragmentShader,/mix\(ealdholtPhotographicSurface, ealdholtAtlasMacro \* ealdholtPhotoGain, ealdholtExistingGrass\)/);
  assert.match(rock.fragmentShader,/ealdholtPhotoChroma \* ealdholtMacroLuminance/);
  assert.doesNotMatch(rock.fragmentShader,/ealdholtExistingGrass/);
  assert.doesNotMatch(rock.fragmentShader,/ealdholtSoilGain/);
  assert.doesNotMatch(fallback.fragmentShader,/ealdholtAtlasMacro|ealdholtPhotoChroma/);
  for(const shader of [earth,rock,fallback]){
    assert.match(shader.fragmentShader,/#include <map_fragment>/);
    assert.doesNotMatch(shader.fragmentShader,/sRGBToLinear|sRGBTransferEOTF|noise|discard/);
  }
});
