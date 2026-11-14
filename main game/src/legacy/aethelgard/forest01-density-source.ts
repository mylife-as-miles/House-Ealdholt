import {FOREST01_DENSITY_WALKING} from '../../../../shared/legacy/aethelgard/environment/forest01-density-walking-data';
import {Matrix4,Vector3} from 'three';
import type {NormalizedRealisticTreeSource} from './realistic-tree-source';
import {REALISTIC_FOREST01_FAMILY} from './realistic-tree-source';
import {FOREST01_DENSITY_LOD,forest01DensityWoodIndices,matchesForest01DensityNormalization,validForest01DensityWalkingProof} from '../../../../shared/legacy/aethelgard/environment/forest01-density-lod';
import {REGIONAL_ROOT_CONTACTS} from '../../../../shared/legacy/aethelgard/environment/regional-root-contact-data';
/** Proof payload only. Extra draw admission separately verifies the exact
 * worker wood output against this fixed source-index manifest. The primary
 * cohort, contact ring, captures and static occupancy retain canonical parts. */
export function forest01DensityWalkingSource(source:NormalizedRealisticTreeSource|null|undefined){
 if(!source||source.family!==REALISTIC_FOREST01_FAMILY||source.variant!==1||source.sourceSha256!==FOREST01_DENSITY_LOD.sourceSha256||source.parts.length!==3)return undefined;
 if(!matchesForest01DensityNormalization(source.normalization.elements)||source.parts.some(part=>!part.frame.equals(new Matrix4())))return undefined;
 const wood=source.parts.filter(part=>!part.foliage);
 if(wood.length!==2||wood[0].geometry.getAttribute('position')?.count!==3030||wood[1].geometry.getAttribute('position')?.count!==3795)return undefined;
 const radius=REGIONAL_ROOT_CONTACTS['tree-oak-1'].radius,triangles:number[]=[],point=new Vector3(),frame=new Matrix4();
 for(let part=0;part<2;part++){
  const sourcePart=wood[part],positions=sourcePart.geometry.getAttribute('position'),indices=forest01DensityWoodIndices(part as 0|1);
  frame.multiplyMatrices(source.normalization,sourcePart.frame);
  for(let at=0;at<indices.length;at+=3){const triangle=[0,1,2].map(k=>point.fromBufferAttribute(positions,indices[at+k]).applyMatrix4(frame).toArray());
   if(triangle.some(p=>Math.hypot(p[0],p[2])>radius+1e-7))for(const p of triangle)triangles.push(...p);
  }
 }
 const proof={version:FOREST01_DENSITY_LOD.version,producer:FOREST01_DENSITY_WALKING.producer,normalization:source.normalization.elements.slice(),triangles:Float64Array.from(triangles)};
 return validForest01DensityWalkingProof(proof)?proof:undefined;
}
