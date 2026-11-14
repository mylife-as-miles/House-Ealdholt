import assert from 'node:assert/strict';
import test from 'node:test';
import {BoxGeometry, DataTexture, Matrix4, MeshStandardMaterial} from 'three';
import {createVegetationBakeIdentity} from './vegetation-bake-identity';
test('persistent capture identity survives new runtime UUIDs and invalidates actual geometry, texture pixels and material inputs', async () => {
  const image = () => new DataTexture(new Uint8Array([40, 100, 20, 255]), 1, 1);
  const a = new BoxGeometry(), b = new BoxGeometry(), mat = new MeshStandardMaterial({map: image()}), twin = new MeshStandardMaterial({map: image()});
  const hash = createVegetationBakeIdentity(), part = (geometry = a, material = mat) => [{geometry, material, frame: new Matrix4(), foliage: true}];
  const key = await hash(part()); assert.equal(await hash(part(b, twin)), key);
  mat.envMapIntensity = .01; assert.equal(await hash(part()), key, 'live lighting must not invalidate unlit captures');
  mat.map!.repeat.x = 2; assert.notEqual(await hash(part()), key, 'sampler transforms can change without a pixel-upload version'); mat.map!.repeat.x = 1;
  mat.color.setRGB(.5, .8, .5); assert.notEqual(await hash(part()), key); mat.color.setRGB(1, 1, 1);
  const pixels = (mat.map!.image as {data: Uint8Array}).data;
  pixels[0] = 41; mat.map!.needsUpdate = true; assert.notEqual(await hash(part()), key);
  pixels[0] = 40; mat.map!.needsUpdate = true; assert.equal(await hash(part()), key);
  const p = a.getAttribute('position'); p.setX(0, p.getX(0) + .1); p.needsUpdate = true; assert.notEqual(await hash(part()), key);
  a.dispose(); b.dispose(); mat.map!.dispose(); twin.map!.dispose(); mat.dispose(); twin.dispose();
});


test('generated-only normal generator identity invalidates captures independently of lighting and leaves untagged source records unchanged',async()=>{
 const geometry=new BoxGeometry(),map=new DataTexture(new Uint8Array([128,128,255,255]),1,1),material=new MeshStandardMaterial({normalMap:map}),parts=[{geometry,material,frame:new Matrix4(),foliage:true}],hash=createVegetationBakeIdentity();
 const original=await hash(parts);material.userData.worldClock=123;assert.equal(await hash(parts),original);
 material.userData.crownfallGeneratedFoliageNormalIdentity='linear-alpha-v1:oak:128:pinned-pixels';const generated=await hash(parts);assert.notEqual(generated,original);
 material.userData.worldClock=500;material.envMapIntensity=.2;assert.equal(await hash(parts),generated);
 material.userData.crownfallGeneratedFoliageNormalIdentity='linear-alpha-v2:oak:128:pinned-pixels';assert.notEqual(await hash(parts),generated);
 delete material.userData.crownfallGeneratedFoliageNormalIdentity;assert.equal(await hash(parts),original);geometry.dispose();map.dispose();material.dispose();
});
