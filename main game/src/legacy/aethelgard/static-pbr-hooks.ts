import {Material, MeshPhysicalMaterial, MeshStandardMaterial} from 'three';
import {EALDHOLT_NEUTRAL_FILL_CACHE_KEY,patchEaldholtNeutralFill} from '../../../../shared/legacy/aethelgard/environment/neutral-fill';

const defaultCompile=Material.prototype.onBeforeCompile,defaultRender=Material.prototype.onBeforeRender,defaultKey=Material.prototype.customProgramCacheKey;
interface Signature {compile:Material['onBeforeCompile'];render:Material['onBeforeRender'];key:Material['customProgramCacheKey'];version:number}
interface Proof extends Signature {base:MeshStandardMaterial;baseSignature:Signature}
const neutralProofs=new WeakMap<MeshStandardMaterial,Proof>();
const signature=(material:Material):Signature=>({compile:material.onBeforeCompile,render:material.onBeforeRender,key:material.customProgramCacheKey,version:material.version});
const matches=(material:Material,proof:Signature)=>material.onBeforeCompile===proof.compile&&material.onBeforeRender===proof.render
  &&material.customProgramCacheKey===proof.key&&material.version===proof.version;
/** Only actual default PBR callbacks or the fragment-only wrapper constructed
 * below are recognized. Public userData labels confer no static-vertex proof. */
export function hasKnownStaticPbrHooks(material:Material,depth=0):material is MeshStandardMaterial {
  if(depth>8||!(material instanceof MeshStandardMaterial)||material.displacementMap
    ||(material.constructor!==MeshStandardMaterial&&material.constructor!==MeshPhysicalMaterial)
    ||material.type!==(material.constructor===MeshPhysicalMaterial?'MeshPhysicalMaterial':'MeshStandardMaterial')
    ||Reflect.get(material,'isShaderMaterial')===true||Reflect.get(material,'isRawShaderMaterial')===true)return false;
  const defines=material.defines;if(!defines)return false;
  for(const name in defines)if((name!=='STANDARD'&&name!=='PHYSICAL')||defines[name]!=='')return false;
  const proof=neutralProofs.get(material);
  if(proof)return matches(material,proof)&&matches(proof.base,proof.baseSignature)&&hasKnownStaticPbrHooks(proof.base,depth+1);
  return material.onBeforeCompile===defaultCompile&&material.onBeforeRender===defaultRender&&material.customProgramCacheKey===defaultKey;
}

/** This is the existing neutral-fill hook factory, not a generic trust setter.
 * Rendering remains unchanged even when the arbitrary prior chain is unproven;
 * only architecture truncation is held in that case. Call after needsUpdate. */
export function installNeutralFillMaterialHooks(original:MeshStandardMaterial,material:MeshStandardMaterial):void {
  const trusted=hasKnownStaticPbrHooks(original),baseSignature=signature(original),compile=original.onBeforeCompile,key=original.customProgramCacheKey;
  material.onBeforeCompile=function(shader,renderer){compile.call(this,shader,renderer);patchEaldholtNeutralFill(shader);};
  material.customProgramCacheKey=function(){return key.call(original)+EALDHOLT_NEUTRAL_FILL_CACHE_KEY;};
  material.onBeforeRender=original.onBeforeRender;
  if(trusted&&original!==material)neutralProofs.set(material,{...signature(material),base:original,baseSignature});
}
