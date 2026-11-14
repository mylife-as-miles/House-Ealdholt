import { Mesh, MeshStandardMaterial, type Material, type Object3D } from 'three';
import { EALDHOLT_NEUTRAL_FILL_STRENGTH } from '../../../../shared/legacy/aethelgard/environment/neutral-fill';
import { skipsEaldholtProbeNeutralFill } from '../../../../shared/legacy/aethelgard/environment/pond-probe';
import {installNeutralFillMaterialHooks} from './static-pbr-hooks';

export interface EaldholtNeutralFill {
  readonly materialCount:number;
  readonly extraDrawCalls:0;readonly extraTextureBytes:0;
  dispose():void;
}

/** Apply after all model-local surface/water adapters. Dispose FIRST, before
 * their owners, to restore exact material assignments. Cached sources, maps,
 * environment bindings/intensities and global lights remain borrowed/intact. */
export function applyEaldholtNeutralFill(root:Object3D):EaldholtNeutralFill {
  const replacements=new Map<Material,MeshStandardMaterial>();
  const assignments:{mesh:Mesh;original:Material|Material[];assigned:Material|Material[]}[]=[];
  function adapt(original:Material):Material {
    if(!(original instanceof MeshStandardMaterial)||skipsEaldholtProbeNeutralFill(original.userData))return original;
    const cached=replacements.get(original);if(cached)return cached;
    const material=original.clone();
    material.name=original.name+'_NeutralFill';
    // Water's render hook refreshes its source-metre ripple frame; cloning a
    // standard/physical material does not copy callback properties by itself.
    material.userData={...material.userData,crownfallNeutralIbl:{linearMix:EALDHOLT_NEUTRAL_FILL_STRENGTH,luminancePreserved:true,globalSceneUnchanged:true}};
    material.needsUpdate=true;installNeutralFillMaterialHooks(original,material);replacements.set(original,material);return material;
  }
  function release():void {
    for(const {mesh,original,assigned}of assignments)if(mesh.material===assigned)mesh.material=original;
    for(const material of replacements.values())material.dispose();replacements.clear();assignments.length=0;
  }
  try {root.traverse(object=>{
    if(!(object instanceof Mesh))return;
    const original=object.material,assigned=Array.isArray(original)?original.map(adapt):adapt(original);
    const changed=Array.isArray(original)&&Array.isArray(assigned)?original.some((m,i)=>m!==assigned[i]):original!==assigned;
    if(changed){object.material=assigned;assignments.push({mesh:object,original,assigned});}
  });}catch(error){release();throw error;}
  let disposed=false;
  return {materialCount:replacements.size,extraDrawCalls:0,extraTextureBytes:0,dispose(){
    if(disposed)return;disposed=true;
    release();
  }};
}
