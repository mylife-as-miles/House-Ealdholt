// Rebuilds actual BakedVoxelLighting growth geometry as ordinary glTF assets.
// MIT source is supplied explicitly; no reference world or renderer is imported.
import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import {resolve,dirname,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import sharp from 'sharp';
import {createStaticGlb} from './glb-writer.mjs';
import {buildRegionalRootContacts} from './build-regional-root-contact.mjs';
const reference=resolve(process.argv[2]??'/workspace/references/BakedVoxelLighting');
const output=resolve(process.argv[3]??'main game/public/assets/legacy/environment/aethelgard/regional-v1');
const work=resolve(process.argv[4]??'/workspace/private-assets/crownfall/regional-build');
const revision=execFileSync('git',['-C',reference,'rev-parse','HEAD'],{encoding:'utf8'}).trim();
if(revision!=='22f3dc468c951707ef46e07113758336e98257d5')throw Error('Review and pin a changed growth source before rebuilding.');
const require=createRequire(resolve('main game/package.json')),threeFile=join(dirname(require.resolve('three')),'three.module.js');
const T=await import(pathToFileURL(threeFile).href),vendor=join(work,'growth-source');
await mkdir(vendor,{recursive:true});await mkdir(join(output,'textures'),{recursive:true});
await writeFile(join(vendor,'package.json'),'{"type":"module"}\n');
const sourceHashes={};
for(const name of ['growth.js','plant-growth.js','plant-appearance.js','wood-union.js','plant-catalog.js']){
 let code=await readFile(join(reference,'src',name),'utf8');sourceHashes[name]=createHash('sha256').update(code).digest('hex');
 code=code.replaceAll('"three/webgpu"',JSON.stringify(pathToFileURL(threeFile).href));
 code=code.replace(/"(three\/addons\/[^"]+)"/g,(_,id)=>JSON.stringify(pathToFileURL(require.resolve(id)).href));
 await writeFile(join(vendor,name),code);
}
const habitat=await readFile(join(reference,'src/habitat.js'),'utf8');
await writeFile(join(vendor,'habitat.js'),habitat.slice(habitat.indexOf('export const smooth'),habitat.indexOf('// Static habitat potential')));
const decoder=await readFile(join(reference,'src/texture-pixels-worker.js'),'utf8');
await writeFile(join(vendor,'fill.js'),'export '+decoder.slice(decoder.indexOf('function fillTransparent'),decoder.indexOf('// Only two decode')));
const {fillTransparent}=await import(pathToFileURL(join(vendor,'fill.js')).href);
const {growPlant}=await import(pathToFileURL(join(vendor,'growth.js')).href);
const names=['bark','bark-birch','bark-ash','oak','birch','ash','pine','hazel','bramble'];
const images=[],imageIndices=new Map(),textureHashes={};
for(const name of names){
 const source=await readFile(join(reference,'public/textures',name+'.png'));
 const {data,info}=await sharp(source).ensureAlpha().resize(512,512).raw().toBuffer({resolveWithObject:true});
 fillTransparent(data,info.width,info.height);
 const image=await sharp(data,{raw:{width:info.width,height:info.height,channels:4}}).png().toBuffer();
 const relative='textures/'+name+'.png';await writeFile(join(output,relative),image);imageIndices.set(name,images.length);images.push(relative);
 textureHashes[name]={sourceSha256:createHash('sha256').update(source).digest('hex'),sha256:createHash('sha256').update(image).digest('hex'),bytes:image.length};
}
const materials=[];
function material(name,wood,leaf,shrub=false){
 const colour=new T.Color(leaf?0xf4f5ec:shrub?0xb4aa93:name==='birch'?0xf2f0e7:name==='pine'?0xc6b09b:0xe2d8c6).toArray();
 const id=materials.length;materials.push({name:leaf?name+' foliage':name+' bark',doubleSided:leaf,alphaMode:leaf?'MASK':'OPAQUE',...(leaf?{alphaCutoff:.4}:{}),
  pbrMetallicRoughness:{baseColorFactor:[...colour,1],baseColorTexture:{index:imageIndices.get(leaf?name:wood)},metallicFactor:0,roughnessFactor:leaf?.86:1}});return id;
}
const families=['oak','birch','ash','pine'],prototypes=[];
function leaves(items){
 const positions=[],normals=[],uv=[],colours=[],indices=[],o=new T.Object3D(),p=new T.Vector3(),n=new T.Vector3();
 for(const leaf of items){o.position.fromArray(leaf.p);o.rotation.fromArray([...leaf.r,'XYZ']);o.scale.fromArray(leaf.s);o.updateMatrix();const nm=new T.Matrix3().getNormalMatrix(o.matrix),c=new T.Color(leaf.c),at=positions.length/3;
  for(const [x,y,u,v] of [[-.5,.5,0,1],[.5,.5,1,1],[-.5,-.5,0,0],[.5,-.5,1,0]]){
   p.set(x,y,0).applyMatrix4(o.matrix);positions.push(...p.toArray());n.set(x*.7,y*.7,.7).normalize().applyMatrix3(nm).normalize();
   if(leaf.n)n.multiplyScalar(.45).addScaledVector(new T.Vector3(...leaf.n),.55).normalize();normals.push(...n.toArray());uv.push(u,1-v);colours.push(c.r,c.g,c.b);
  }indices.push(at,at+2,at+1,at+2,at+3,at+1);
 }
 const g=new T.BufferGeometry();for(const [key,values,size] of [['position',positions,3],['normal',normals,3],['uv',uv,2],['color',colours,3]])g.setAttribute(key,new T.Float32BufferAttribute(values,size));g.setIndex(indices);return g;
}
const desktop=createStaticGlb(materials,images),native=createStaticGlb(materials,images);
for(let type=0;type<7;type++){
 const shrub=type>=4,species=shrub?type-4:type,name=shrub?['hazel','bramble','ash'][species]:families[species],wood=shrub?'bark-ash':['bark','bark-birch','bark-ash','bark'][species];
 const barkIndex=material(name,wood,false,shrub),leafIndex=material(name,wood,true,shrub);
 for(let age=0;age<(shrub?1:3);age++){
  const seed=type*71+age*13+17,id=shrub?['hazel','bramble','elder'][species]:'tree-'+name+'-'+age;
  console.log('GROW',id);const plant=growPlant(seed,species,shrub,shrub?1:age),foliage=leaves(plant.leaves);
  const box=new T.Box3();for(const geometry of [plant.high,foliage]){geometry.computeBoundingBox();box.union(geometry.boundingBox);}
  const offset=new T.Matrix4().makeTranslation(0,-box.min.y,0);
  for(const [writer,geometry] of [[desktop,plant.high],[native,plant.low]]){
   const group=writer.group(id,{crownfallElderbloom:{kind:shrub?'shrub':'tree'},source:'BakedVoxelLighting',species,age,seed});
   writer.mesh(group,id+' bark',geometry,barkIndex,offset.elements);writer.mesh(group,id+' foliage',foliage,leafIndex,offset.elements);
  }
  prototypes.push({id,species,age,shrub,seed,height:box.max.y-box.min.y,canopyRadius:Math.hypot(Math.max(Math.abs(box.min.x),Math.abs(box.max.x)),Math.max(Math.abs(box.min.z),Math.abs(box.max.z))),
   highTriangles:plant.high.index.count/3,lowTriangles:plant.low.index.count/3,foliageTriangles:foliage.index.count/3});
  for(const geometry of [plant.high,plant.low,plant.farWood,foliage])geometry.dispose();
 }
}
await desktop.save(join(output,'vegetation-desktop.glb'));await native.save(join(output,'vegetation-quest.glb'));
const files={};for(const name of ['vegetation-desktop.glb','vegetation-quest.glb']){const data=await readFile(join(output,name));files[name]={bytes:data.length,sha256:createHash('sha256').update(data).digest('hex')};}
await writeFile(join(output,'vegetation.manifest.json'),JSON.stringify({schema:1,source:{repository:'https://github.com/SamG-Coder/BakedVoxelLighting',revision,license:'MIT',sourceHashes},textures:textureHashes,files,prototypes},null,2)+'\n');
await copyFile(join(reference,'LICENSE'),join(output,'LICENSE.BakedVoxelLighting.txt'));
await copyFile(join(reference,'docs/asset-prompts.md'),join(output,'VEGETATION_TEXTURE_PROVENANCE.md'));
const litterSource=await readFile(join(reference,'public/textures/woodland-litter.png'));
const litter=await sharp(litterSource).resize(512,512).png().toBuffer(),litterPath=join(output,'textures/woodland-litter.png');
await writeFile(litterPath,litter);
await writeFile(litterPath+'.provenance.json',JSON.stringify({source:'https://github.com/SamG-Coder/BakedVoxelLighting/blob/'+revision+'/public/textures/woodland-litter.png',license:'MIT',sourceSha256:createHash('sha256').update(litterSource).digest('hex'),sha256:createHash('sha256').update(litter).digest('hex'),bytes:litter.length},null,2)+'\n');
console.log('COMPLETE',JSON.stringify(files));

if(output===resolve('main game/public/assets/legacy/environment/aethelgard/regional-v1')){
 const metadata=prototypes.map(({id,height,canopyRadius,shrub})=>({id,height,canopyRadius,shrub}));
 await writeFile(resolve('shared/legacy/aethelgard/environment/regional-assets.ts'),'/** Offline conversion metadata; regenerate with scripts/environment/build-regional-vegetation.mjs. */\nexport const REGIONAL_ASSET_PATH = "assets/legacy/environment/aethelgard/regional-v1/";\nexport const REGIONAL_VEGETATION_SOURCE_SHA256 = '+JSON.stringify(files['vegetation-desktop.glb'].sha256)+';\nexport const REGIONAL_VEGETATION_PROTOTYPES = '+JSON.stringify(metadata,null,2)+' as const;\n');
 await buildRegionalRootContacts(output,resolve('shared/legacy/aethelgard/environment/regional-root-contact-data.ts'));
}
