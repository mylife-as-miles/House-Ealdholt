// Only resources created for this source world are collected. The consuming
// renderer/camera and global Three tables are never traversed or disposed.
export function disposeGeneratedWorld(root,ctx){
  const seen=new WeakSet(),resources=new Set();
  function collect(value){
    if(!value||typeof value!=='object'||ArrayBuffer.isView(value)||seen.has(value))return;
    seen.add(value);
    if(value.isTexture){resources.add(value);collect(value.userData?.renderTarget);return;}
    if(value.isRenderTarget||value.isWebGLRenderTarget||value.isBufferGeometry){resources.add(value);return;}
    if(value.isObject3D)return;
    if(value.isMaterial){resources.add(value);for(const v of Object.values(value))collect(v);return;}
    if(Array.isArray(value)){for(const v of value)collect(v);return;}
    if(value instanceof Map){for(const v of value.values())collect(v);return;}
    for(const v of Object.values(value))if(typeof v==='object')collect(v);
  }
  root.traverse(o=>{collect(o.geometry);collect(o.material);collect(o.customDepthMaterial);collect(o.customDistanceMaterial);collect(o.shadow?.map);});
  for(const system of [ctx.terrain,ctx.water,ctx.sky,ctx.vegetation])collect(system);
  for(const r of resources)r.dispose();
  root.clear();
}
