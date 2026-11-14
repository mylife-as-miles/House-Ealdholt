import assert from 'node:assert/strict';
import test from 'node:test';
import { createProceduralFireRuntime as desktopRuntime } from '../../../../main game/src/legacy/aethelgard/procedural-fire-runtime';
import { createProceduralFireRuntime as nativeRuntime } from '../../../../main-game-vr/src/legacy/aethelgard/procedural-fire-runtime';
import { createEaldholtVillageFire as desktopFire } from '../../../../main game/src/legacy/aethelgard/village-fire';
import { createEaldholtVillageFire as nativeFire } from '../../../../main-game-vr/src/legacy/aethelgard/village-fire';
import { EALDHOLT_FIRE_ANCHORS } from './village-fire';

for(const [platform,create] of [['Desktop',desktopRuntime],['Native',nativeRuntime]] as const){
  test(platform+' shares one actual field across materials, holds clocks/context, and disposes owned resources exactly once',()=>{
    let lost=false;const renderer={capabilities:{maxTextureSize:2048},getContext:()=>({isContextLost:()=>lost})};
    const runtime=create({renderer:renderer as never}),a=runtime.createFlame({width:1,height:2,intensity:.5}),b=runtime.createFlame({width:2,height:3,intensity:2});
    assert.strictEqual(a.material.uniforms.cfFireAtlas,b.material.uniforms.cfFireAtlas);assert.strictEqual(a.geometry,b.geometry);
    assert.equal(a.material.uniforms.cfFireIntensity.value,.5);assert.equal(b.material.uniforms.cfFireIntensity.value,2);
    assert.equal(a.material.premultipliedAlpha,true);assert.equal(a.material.depthWrite,false);assert.equal(a.material.depthTest,true);
    assert.equal(a.geometry.index!.count,6);assert.equal(runtime.diagnostics.representation,'slice-card-2.5d');
    const atlas=runtime.uniforms.cfFireAtlas.value,initialVersion=atlas.version;
    assert.equal(runtime.diagnostics.prewarmSteps,24);assert.equal(runtime.diagnostics.steps,24,'prewarm steps remain honestly counted');
    const initialBytes=new Uint8Array(atlas.image.data as Uint8Array);let reactedHotCells=0,fullBurnCells=0;
    for(let i=0;i<initialBytes.length;i+=4){const temperature=293+1807*initialBytes[i]/255;if(temperature>1200)reactedHotCells++;if(temperature>1400)fullBurnCells++;}
    assert.ok(reactedHotCells>20,'initial frozen field contains a spatial volume of luminous reacted gas, not only cool opaque fuel');
    assert.ok(fullBurnCells>0,'bounded chemistry retains a full burning region above1400K');
    runtime.update(0,true);runtime.update(100,true);assert.equal(atlas.version,initialVersion,'first and later Hold frames freeze a visible initial atlas');
    assert.deepEqual(atlas.image.data,initialBytes);assert.equal(runtime.diagnostics.steps,24,'Hold does not keep prewarming');
    runtime.update(100,false);runtime.update(100.09,false);assert.equal(atlas.version,initialVersion+1);
    runtime.update(100.09,false);assert.equal(atlas.version,initialVersion+1,'borrowed owners cannot step the same scene timestamp twice');
    lost=true;runtime.update(100.2,false);assert.equal(runtime.diagnostics.contextHeld,true);assert.equal(atlas.version,initialVersion+1);
    lost=false;runtime.update(100.21,false);assert.equal(atlas.version,initialVersion+1,'context recovery does not replay skipped time');
    let textureDisposals=0,geometryDisposals=0,materialDisposals=0;
    atlas.addEventListener('dispose',()=>textureDisposals++);runtime.uniforms.cfFireBlackbody.value.addEventListener('dispose',()=>textureDisposals++);
    a.geometry.addEventListener('dispose',()=>geometryDisposals++);a.material.addEventListener('dispose',()=>materialDisposals++);b.material.addEventListener('dispose',()=>materialDisposals++);
    runtime.dispose();runtime.dispose();assert.equal(textureDisposals,2);assert.equal(geometryDisposals,1);assert.equal(materialDisposals,2);
    const uploads=runtime.diagnostics.uploads;assert.equal(runtime.update(101,false),false);assert.equal(runtime.diagnostics.uploads,uploads);
    assert.throws(()=>runtime.createMaterial(),/disposed/);
  });
  test(platform+' capability fallback is explicit and retains a static physical-color pilot',()=>{
    const renderer={capabilities:{maxTextureSize:8},getContext:()=>({isContextLost:()=>false})},runtime=create({renderer:renderer as never});
    const material=runtime.createMaterial();assert.equal(runtime.diagnostics.capability,'static-pilot');assert.equal(material.uniforms.cfFireSupported.value,0);
    assert.ok(material.uniforms.cfFireFallbackColor.value.x>0);runtime.update(0,false);runtime.update(1,false);assert.equal(runtime.diagnostics.steps,0);runtime.dispose();
    const collapsed=create({renderer:{...renderer,capabilities:{maxTextureSize:32}} as never});
    assert.equal(collapsed.diagnostics.capability,'collapsed-rgba8');assert.equal(collapsed.uniforms.cfFireGrid.value.z,1);
    assert.equal(collapsed.diagnostics.atlasBytes,16*24*4);collapsed.dispose();
  });
}
for(const [platform,create,lightCount] of [['Desktop',desktopFire,4],['Native',nativeFire,0]] as const){
  test(platform+' replaces crossed hearth quads with four source-anchored cards, preserves lights and explicit extinguishing',()=>{
    const fire=create(),group=fire.rootObject3D;assert.equal(group.children.length,4);assert.equal(fire.triangleCount,8);
    let lights=0,meshes=0;group.traverse(object=>{if('isPointLight' in object)lights++;if('isMesh' in object)meshes++;});assert.equal(lights,lightCount);assert.equal(meshes,4);
    for(let i=0;i<4;i++)assert.deepEqual(group.children[i].position.toArray(),[...EALDHOLT_FIRE_ANCHORS[i].position]);
    const weather={wind:[1,0] as const,windStrength:.5,rain:.3},before=JSON.stringify(weather);let calls=0;
    fire.update(0,true,p=>{calls++;return p===EALDHOLT_FIRE_ANCHORS[1].position;},weather);
    assert.equal(calls,4);assert.equal(group.children[1].visible,false);assert.equal(group.children[0].visible,true);assert.equal(fire.runtime.diagnostics.steps,24);assert.equal(fire.runtime.diagnostics.prewarmSteps,24);
    fire.update(1,true,()=>false,weather);assert.equal(group.children[1].visible,true,'extinction remains caller-owned and can explicitly change');
    assert.equal(JSON.stringify(weather),before);fire.dispose();fire.dispose();fire.update(2,false,()=>{throw Error('disposed effect queried canonical fire');});
    assert.equal(group.children.length,0);assert.equal(fire.runtime.diagnostics.disposed,true);
  });
}
