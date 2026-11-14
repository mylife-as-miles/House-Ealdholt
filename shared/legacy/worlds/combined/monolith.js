import { SETTLEMENT_SUN_DIRECTION } from '../../environment/settlement/lighting.ts';
/** Selected actual Monolith Wilds generators. MIT pinned source: ../monolithwilds/PROVENANCE.md.
 * The full basin/streamer is deliberately not instantiated. Original geometry,
 * per-vertex wind attributes and source procedural material code remain live. */
import * as THREE from 'crownfall-world-three';
import { rockShape, rockGeometry } from '../monolithwilds/src/world/rocks-geo.js';
import { RuinBuilder } from '../monolithwilds/src/world/ruins-builder.js';
import { archPoints, voussoirs, mat } from '../monolithwilds/src/world/ruins-parts.js';
import { aspen, spireConifer, parasolPine } from '../monolithwilds/src/world/vegetation-geo.js';
import { vegMaterial, createVegShared, LOOK } from '../monolithwilds/src/world/vegetation-material.js';
import { InstBuf } from '../monolithwilds/src/world/vegetation-lod.js';
import { createMaterialLibrary } from '../monolithwilds/src/core/materials.js';
import { createRng, worldNoise } from '../monolithwilds/src/core/noise.js';
import { createSourceTransform } from '../monolithwilds/source-transform.js';
import { sourceShoreSites } from './shore-layout.ts';
import { sourceShoreRockAnchor } from './shore-rock-anchor.ts';
import { settlementSiteFree } from '../../environment/settlement/layout.ts';
import { forestProtectedLots,forestGroveColour,forestTintRamp,patchForestCanopyMaterial,planForestCanopy } from './forest-canopy.ts';

/** Palette/proportion adaptation of the actual source trees. Source wind/part
 * channels remain; anchors/normals follow the same trunk-coordinate mapping. */
function autumnTree(geometry,H,name){
 const position=geometry.attributes.position,normal=geometry.attributes.normal,leaf=geometry.attributes.aVeg,part=geometry.attributes.aVeg2,color=geometry.attributes.color;
 const pivot=H*(name==='spire'?.2:.42),compression=name==='spire'?.75:.42,newHeight=H-pivot*(1-compression),warp=y=>y<pivot?y*compression:y-pivot*(1-compression),base=new THREE.Color(name==='aspen'?'#aa5126':name==='parasol'?'#b56b2d':'#625b32');
 let luminance=0,count=0;for(let i=0;i<position.count;i++)if(leaf.getX(i)>.5){luminance+=color.getX(i)*.2126+color.getY(i)*.7152+color.getZ(i)*.0722;count++;}const mean=luminance/Math.max(1,count);
 for(let i=0;i<position.count;i++){
  const oldY=position.getY(i),vertical=oldY<pivot?compression:1,widen=name==='spire'?1:1.12;
  position.setXYZ(i,position.getX(i)*widen,warp(oldY),position.getZ(i)*widen);
  const n=new THREE.Vector3(normal.getX(i)/widen,normal.getY(i)/vertical,normal.getZ(i)/widen).normalize();normal.setXYZ(i,n.x,n.y,n.z);
  part.setX(i,warp(part.getX(i)));leaf.setY(i,Math.pow(Math.max(0,warp(oldY)/newHeight),1.6));
  if(leaf.getX(i)>.5){const l=color.getX(i)*.2126+color.getY(i)*.7152+color.getZ(i)*.0722,shade=Math.max(.58,Math.min(1.4,l/Math.max(.001,mean)));color.setXYZ(i,base.r*shade,base.g*shade,base.b*shade);}
 }
 geometry.computeBoundingBox();geometry.computeBoundingSphere();geometry.userData.crownfallAutumn={sourceGeometry:true,leafPalette:name==='spire'?'bronze':'copper-rust',trunkCompression:compression,sourceHeight:H,height:newHeight};return newHeight;
}

const SOURCE={repository:'https://github.com/Leonxlnx/monolithwilds',commit:'02dbcd3e790c21861dfecb47f4d9e23cccee35ec',license:'MIT'};
export function createMonolithKit({THREE:consumer,profile='desktop',quality='medium',groundAt,shoreAt,treeSites=[]}){
 if(consumer.Object3D!==THREE.Object3D)throw new Error('Combined Monolith kit namespace mismatch');
 const root=new THREE.Group();root.name='Actual Monolith source forest, shore and ruin';root.userData.sourceAsset={...SOURCE,generator:'rocks-geo + vegetation-geo + ruins-parts'};
 root.userData.sourceAssetId='monolith-source-landscape-kit';root.userData.sourceProvenance=[{id:'monolith-forest',...SOURCE,path:'src/world/vegetation-geo.js',generator:'aspen/parasolPine/spireConifer'},{id:'monolith-shore',...SOURCE,path:'src/world/rocks-geo.js',generator:'rockShape/rockGeometry'},{id:'monolith-ruin',...SOURCE,path:'src/world/ruins-parts.js',generator:'archPoints/voussoirs'}];
 const ownedGeometry=new Set(),ownedMaterial=new Set(),time=new THREE.Vector4(0,0,.25,0),camera=new THREE.PerspectiveCamera();
 const env={keyDir:new THREE.Vector3(...SETTLEMENT_SUN_DIRECTION),sun:{color:new THREE.Color('#fff0d2'),intensity:1.4},palette:{hemiIntensity:.65},hemi:{color:new THREE.Color('#b8cad4')},night:0};
 const shared=createVegShared({camera,env,atmosphereUniforms:{uAtmoTime:{value:time}}});
 const retain=g=>{ownedGeometry.add(g);return g;},material=m=>{m.fog=false;ownedMaterial.add(m);return m;};
 const library=createMaterialLibrary(),stone=material(library.create('stone',{color:'#a7aaa0',blocks:[1.4,.65],mortar:.045,macroScale:11,bump:.55,mossAmount:.28,glyphs:null}));stone.userData.mwUniforms.uMwTime.value=time;
 const rock=material(library.create('rock',{color:'#8f9998',macroScale:7,bump:.65,mossAmount:.25,glyphs:null}));rock.userData.mwUniforms.uMwTime.value=time;
 // Original source rock recipes, deterministically scaled into the actual shore.
 const rng=createRng('combined-monolith-forest'),kinds=['block','slab','shard'],shoreSites=sourceShoreSites();
 for(let kindIndex=0;kindIndex<kinds.length;kindIndex++){
  const geometry=retain(rockGeometry(rockShape('crownfall-source-'+kinds[kindIndex],kinds[kindIndex]),profile==='quest'?1:2));
  geometry.computeBoundingBox();const localBounds=geometry.boundingBox;
  const sites=shoreSites.filter(site=>site.kind===kinds[kindIndex]);
  const mesh=new THREE.InstancedMesh(geometry,rock,sites.length),transform=new THREE.Object3D();
  sites.forEach((site,i)=>{const groundY=groundAt(site.x,site.z),anchorY=sourceShoreRockAnchor({groundY,previousAnchorY:groundY-.2,scale:site.scale,radius:site.radius,localMinY:localBounds.min.y,localMaxY:localBounds.max.y});transform.position.set(site.x,anchorY,site.z);transform.rotation.y=site.yaw;transform.scale.setScalar(site.scale);transform.updateMatrix();mesh.setMatrixAt(i,transform.matrix);});
  mesh.instanceMatrix.needsUpdate=true;mesh.name='Monolith source '+kinds[kindIndex]+' shoreline';mesh.castShadow=profile!=='quest';mesh.receiveShadow=true;mesh.userData.sourceAsset={...SOURCE,generator:'rockShape/rockGeometry',kind:kinds[kindIndex]};mesh.userData.sourceAssetId='monolith-shore-'+kinds[kindIndex];mesh.userData.sourceProvenance=[{id:mesh.userData.sourceAssetId,...SOURCE,path:'src/world/rocks-geo.js',generator:'rockShape/rockGeometry'}];root.add(mesh);
 }
 // A source masonry arch is centered within the existing War Record footprint.
 // It does not introduce a new obstacle outside that already protected envelope.
 function buildRuin(spec){
  const ruin=new RuinBuilder();ruin.setGround(0);voussoirs(ruin,stone,mat(0,1.7,0),archPoints('pointed',6,3.5,14),{depth:1.1,thick:.55,gap:.035,jit:.025});ruin.box(stone,mat(-3.3,0,0),.9,1.7,1.3);ruin.box(stone,mat(3.3,0,0),.9,1.7,1.3);
  const group=ruin.build({name:'Actual Monolith source voussoir arch',castShadow:profile!=='quest'}),bounds=new THREE.Box3().setFromObject(group),size=bounds.getSize(new THREE.Vector3()),center=bounds.getCenter(new THREE.Vector3()),scale=Math.min(spec.width/size.x,spec.depth/size.z,spec.height?spec.height/size.y:Infinity)*.94;
  group.traverse(o=>{if(!o.geometry)return;o.geometry.translate(-center.x,-bounds.min.y,-center.z);o.geometry.scale(scale,scale,scale);o.geometry.computeBoundingBox();o.geometry.computeBoundingSphere();});
  group.userData.sourceAsset={...SOURCE,generator:'RuinBuilder/archPoints/voussoirs'};group.userData.sourceAssetId='monolith-voussoir-arch';group.userData.sourceProvenance=[{id:'monolith-voussoir-arch',...SOURCE,path:'src/world/ruins-parts.js',generator:'RuinBuilder/archPoints/voussoirs'}];return group;
 }
 const arch=buildRuin({width:8,depth:3});arch.position.set(-19,groundAt(-19,-7),-7);arch.rotation.y=.18;arch.userData.landmark='war-record';arch.traverse(o=>{if(o.geometry)retain(o.geometry);});root.add(arch);
 const limit=profile==='quest'?330:quality==='low'?530:760,sites=treeSites.slice(0,limit),heroSites=new Set(sites.filter(site=>settlementSiteFree(site.x,site.z,4.5)).slice(0,15)),protectedLots=forestProtectedLots();
 const recipes=[['aspen',aspen,0,site=>heroSites.has(site)],['aspen',aspen,1,(site,i)=>!heroSites.has(site)&&i%20<16],['parasol',parasolPine,1,(site,i)=>!heroSites.has(site)&&i%20>=16&&i%20<19],['spire',spireConifer,1,(site,i)=>!heroSites.has(site)&&i%20===19]];
 for(const [name,generate,lod,accept] of recipes){
  const source=generate(worldNoise,createRng('combined-source-'+name)),geometry=source.lods[lod],height=autumnTree(geometry,source.H,name);
  for(const g of source.lods)retain(g);
  const look=LOOK[name],shape=[look.shape[0],look.shape[1],look.shape[2]*.65,look.shape[3]*.6],pair=vegMaterial(shared,{name:'Crownfall '+name,...look,tints:forestTintRamp(THREE,name),shape,taper:[look.taper[0],height],form:[look.form[0]*.35,look.form[1],look.form[2]*.42,height],near:[0,0],dist:[1e5,2e5,1,1e5]});
  patchForestCanopyMaterial(pair.material);patchForestCanopyMaterial(pair.depth);
  material(pair.material);material(pair.depth);
  const entries=sites.filter(accept),buffer=new InstBuf(geometry,pair.material,pair.depth,entries.length,{castShadow:profile!=='quest',name:'Actual Monolith source '+name+' LOD'+lod+' edge forest'});retain(buffer.geo);
  const position=geometry.attributes.position,leaf=geometry.attributes.aVeg;let prototypeRadius=0,prototypeMinY=Infinity,prototypeMaxY=-Infinity,maxFlutter=0;
  for(let i=0;i<position.count;i++){prototypeRadius=Math.max(prototypeRadius,Math.hypot(position.getX(i),position.getZ(i)));prototypeMinY=Math.min(prototypeMinY,position.getY(i));prototypeMaxY=Math.max(prototypeMaxY,position.getY(i));maxFlutter=Math.max(maxFlutter,leaf.getZ(i));}
  const bounds=new THREE.Box3(),widths=new Float32Array(buffer.cap).fill(1),plans=[];buffer.begin();for(const site of entries){
   const y=groundAt(site.x,site.z),scale=site.scale*(name==='spire'?.33:name==='parasol'?.4:.56),variation=1+Math.abs(shape[0]),shapeRadius=prototypeRadius*variation*(1+Math.abs(look.taper[0])*.5)*scale;
   const wind=1.15*.55*Math.abs(shape[2])+Math.SQRT2*maxFlutter*Math.abs(shape[3])*.55,drift=(Math.SQRT2*Math.abs(shape[1])*Math.max(0,prototypeMaxY)+wind)*variation*scale;
   const plan=planForestCanopy(site.x,site.z,shapeRadius,drift,protectedLots,name==='spire'?1:1.5),seed=rng(),colour=forestGroveColour(site.x,site.z,rng(),worldNoise.noise2);widths[buffer.n]=plan.width;
   buffer.push1(new Float32Array([site.x,y,site.z,scale,site.yaw,seed,0,colour]),0);plans.push({...plan,x:site.x,z:site.z,shapeRadius,drift});
   const radius=plan.radius+.05;bounds.expandByPoint(new THREE.Vector3(site.x-radius,y+prototypeMinY*scale*(1+Math.abs(shape[0])*.5)-.1,site.z-radius));bounds.expandByPoint(new THREE.Vector3(site.x+radius,y+prototypeMaxY*scale*(1+Math.abs(shape[0])*.5)+.1,site.z+radius));
  }buffer.end();buffer.geo.setAttribute('aCanopyWidth',new THREE.InstancedBufferAttribute(widths,1));buffer.geo.boundingBox=bounds;buffer.geo.boundingSphere=bounds.getBoundingSphere(new THREE.Sphere());
  buffer.mesh.userData.canopyPlans=plans;
  buffer.mesh.userData.sourceAsset={...SOURCE,generator:name,sourceLod:lod,palette:'dark-rust-copper-gold',hero:lod===0,preservedAttributes:['aVeg','aVeg2','aInstA','aInstB'],canopy:{attribute:'aCanopyWidth',maximum:name==='spire'?1:1.5,branchGapMultiplier:.35}};buffer.mesh.userData.sourceAssetId='monolith-forest-'+name+'-lod'+lod;buffer.mesh.userData.sourceProvenance=[{id:buffer.mesh.userData.sourceAssetId,...SOURCE,path:'src/world/vegetation-geo.js',generator:name}];buffer.mesh.raycast=()=>{};root.add(buffer.mesh);
 }
 root.updateMatrixWorld(true);const setSourceTransform=createSourceTransform(root,camera),inverse=new THREE.Matrix4(),eye=new THREE.Vector3();let reduced=false,disposed=false;
 return{root,buildRuin,update(dt,viewCamera){if(disposed)return;if(!reduced)time.x+=Math.max(0,Math.min(.1,dt));root.updateWorldMatrix(true,false);inverse.copy(root.matrixWorld).invert();if(viewCamera){viewCamera.getWorldPosition(eye);eye.applyMatrix4(inverse);}camera.position.copy(eye);shared.update();setSourceTransform(inverse,eye);},setReducedMotion(value){reduced=value;shared.uniforms.uVegTime.value.z=value?-.3:.25;},dispose(){if(disposed)return;disposed=true;root.removeFromParent();root.clear();for(const g of ownedGeometry)g.dispose();for(const m of ownedMaterial)m.dispose();ownedGeometry.clear();ownedMaterial.clear();}};
}
