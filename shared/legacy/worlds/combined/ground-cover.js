import { SETTLEMENT_SUN_DIRECTION } from '../../environment/settlement/lighting.ts';
/** Compact actual Monolith vegetation. Host-authored placement and palette only;
 * the pinned source geometry, attributes, instancing and wind remain in use. */
import * as THREE from 'crownfall-world-three';
import { grassTuft,reeds,shrub } from '../monolithwilds/src/world/vegetation-geo.js';
import { vegMaterial,createVegShared } from '../monolithwilds/src/world/vegetation-material.js';
import { InstBuf } from '../monolithwilds/src/world/vegetation-lod.js';
import { worldNoise,createRng } from '../monolithwilds/src/core/noise.js';
import { createSourceTransform } from '../monolithwilds/source-transform.js';
import { planGroundCover } from './ground-cover-layout.ts';

const SOURCE={repository:'https://github.com/Leonxlnx/monolithwilds',commit:'02dbcd3e790c21861dfecb47f4d9e23cccee35ec',license:'MIT',path:'src/world/vegetation-geo.js'};
export function createSourceGroundCover({THREE:consumer,groundAt}){
 if(consumer.Object3D!==THREE.Object3D)throw new Error('Ground-cover source namespace mismatch');
 const root=new THREE.Group();root.name='Actual Monolith source ground cover';root.userData.sourceAssetId='monolith-ground-cover';root.userData.sourceAsset={...SOURCE,generator:'grassTuft/reeds/shrub'};root.userData.sourceProvenance=[{id:'monolith-ground-cover',...SOURCE,generator:'grassTuft/reeds/shrub'}];
 const camera=new THREE.PerspectiveCamera(),time=new THREE.Vector4(0,0,.25,0),env={keyDir:new THREE.Vector3(...SETTLEMENT_SUN_DIRECTION),sun:{color:new THREE.Color('#fff0d2'),intensity:1.4},palette:{hemiIntensity:.65},hemi:{color:new THREE.Color('#b8cad4')},night:0};
 const shared=createVegShared({camera,env,atmosphereUniforms:{uAtmoTime:{value:time}}}),geometries=new Set(),materials=new Set(),plan=planGroundCover();
 const grass=grassTuft(worldNoise,createRng('combined-ground-grass')),reed=reeds(worldNoise,createRng('combined-ground-reeds')),bush=shrub(worldNoise,createRng('combined-ground-shrub'));
 // A taller actual source reed silhouette stays inside the same XZ exclusion.
 // Preserve source topology/wind/part identity and transform its normal frame
 // and source-space part anchors together with the vertical fit.
 for(const geometry of reed.lods){const position=geometry.attributes.position,normal=geometry.attributes.normal,part=geometry.attributes.aVeg2;for(let i=0;i<position.count;i++){position.setY(i,position.getY(i)*1.5);const n=new THREE.Vector3(normal.getX(i),normal.getY(i)/1.5,normal.getZ(i)).normalize();normal.setXYZ(i,n.x,n.y,n.z);part.setX(i,part.getX(i)*1.5);}geometry.computeBoundingBox();geometry.computeBoundingSphere();geometry.userData.sourceHeightScale=1.5;}
 for(const geometry of [grass,...reed.lods,...bush.lods])geometries.add(geometry);
 const recipes=[['grass','grassTuft',grass,plan.grass,.9],['reeds-hero','reeds',reed.lods[0],plan.reedsHero,3.6],['reeds-far','reeds',reed.lods[1],plan.reedsFar,3.6],['shrub','shrub',bush.lods[1],plan.shrubs,2]];
 const info=[];
 for(const [name,generator,geometry,sites,height] of recipes){
  const pair=vegMaterial(shared,{name:'Crownfall source '+name,tints:[[1.15,1.03,.76],[1.45,1.12,.66],[1.65,1.19,.78]],shape:[0,0,.035,.012],taper:[0,height],form:[0,0,0,height],near:[0,0],light:[.55,.4,1,0],detail:[5,.25,4,.2],dist:[1e5,2e5,1,1e5],roughness:.96});
  for(const material of [pair.material,pair.depth]){material.fog=false;materials.add(material);}
  const buffer=new InstBuf(geometry,pair.material,pair.depth,sites.length,{castShadow:false,receiveShadow:true,name:'Actual Monolith source '+name+' ground cover'});geometries.add(buffer.geo);
  geometry.computeBoundingBox();const minY=Math.max(0,geometry.boundingBox.min.y),bounds=new THREE.Box3(),maxRadius=name==='grass'?.45:name==='reeds-hero'?1.23:name==='reeds-far'?.56:1.39;
  buffer.begin();for(const site of sites){const y=groundAt(site.x,site.z)-minY*site.scale;buffer.push1(new Float32Array([site.x,y,site.z,site.scale,site.yaw,site.seed,0,worldNoise.noise2(site.x*.031,site.z*.031)*.25+.5]),0);const radius=maxRadius*site.scale;bounds.expandByPoint(new THREE.Vector3(site.x-radius,y+geometry.boundingBox.min.y*site.scale-.03,site.z-radius));bounds.expandByPoint(new THREE.Vector3(site.x+radius,y+geometry.boundingBox.max.y*site.scale+.03,site.z+radius));}buffer.end();
  buffer.geo.boundingBox=bounds;buffer.geo.boundingSphere=bounds.getBoundingSphere(new THREE.Sphere());buffer.mesh.raycast=()=>{};buffer.mesh.userData.sourceAssetId='monolith-ground-'+name;buffer.mesh.userData.sourceAsset={...SOURCE,generator,...(name.startsWith('reeds')?{sourceHeightScale:1.5}:{})};buffer.mesh.userData.sourceProvenance=[{id:buffer.mesh.userData.sourceAssetId,...SOURCE,generator}];buffer.mesh.userData.groundCoverSites=sites;
  root.add(buffer.mesh);info.push({name,generator,count:sites.length,sourceTriangles:buffer.tris,triangles:buffer.tris*sites.length,castsShadow:false});
 }
 root.updateMatrixWorld(true);const transform=createSourceTransform(root,camera),inverse=new THREE.Matrix4(),eye=new THREE.Vector3();let disposed=false,reduced=false;
 return {root,getInfo(){return{included:!disposed&&root.children.length>0,sites:info,triangles:info.reduce((sum,entry)=>sum+entry.triangles,0),drawCalls:info.filter(entry=>entry.count>0).length,source:SOURCE};},update(dt,viewCamera){if(disposed)return;if(!reduced)time.x+=Math.max(0,Math.min(.1,dt));root.updateWorldMatrix(true,false);inverse.copy(root.matrixWorld).invert();if(viewCamera){viewCamera.getWorldPosition(eye);eye.applyMatrix4(inverse);}camera.position.copy(eye);shared.update();transform(inverse,eye);},setReducedMotion(value){reduced=value;time.z=value?-.3:.25;},dispose(){if(disposed)return;disposed=true;root.removeFromParent();root.clear();for(const geometry of geometries)geometry.dispose();for(const material of materials)material.dispose();geometries.clear();materials.clear();}};
}
