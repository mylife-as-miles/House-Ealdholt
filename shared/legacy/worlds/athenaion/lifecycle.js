// Disposal is also needed before a failed asynchronous build can return an asset.
// The host's renderer/camera and children present before this build remain owned by the host.
export function releaseOwnedWorld({root,staging,initialChildren,materials=[],resources=[],releasers=[]}){
  const geometries=new Set(),ownedMaterials=new Set(materials),textures=new Set(),errors=[];
  const roots=new Set([root,...staging.children.filter(child=>!initialChildren.has(child))]);
  const gather=object=>{
    if(object.geometry)geometries.add(object.geometry);
    for(const material of object.material?(Array.isArray(object.material)?object.material:[object.material]):[])ownedMaterials.add(material);
    if(object.customDepthMaterial)ownedMaterials.add(object.customDepthMaterial);
  };
  for(const object of roots)object.traverse(gather);
  for(const material of ownedMaterials){
    for(const value of Object.values(material))if(value?.isTexture)textures.add(value);
    for(const uniform of Object.values(material.uniforms??{}))if(uniform?.value?.isTexture)textures.add(uniform.value);
  }
  const run=fn=>{try{fn();}catch(error){errors.push(error);}};
  for(const release of releasers)run(release);
  for(const resource of new Set([...resources,...textures,...ownedMaterials,...geometries]))if(resource?.dispose)run(()=>resource.dispose());
  for(const object of roots){run(()=>object.removeFromParent?.());run(()=>object.clear?.());}
  return errors;
}
