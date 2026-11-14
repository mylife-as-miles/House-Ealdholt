// Verification only: keep the imported source in the desktop Three namespace.
export async function resolve(specifier,context,nextResolve){
  if(specifier==='crownfall-world-three')return {url:new URL('../../../../main%20game/node_modules/three/build/three.module.js',import.meta.url).href,shortCircuit:true};
  if(specifier==='crownfall-world-bvh')return {url:new URL('../../../../main%20game/node_modules/three-mesh-bvh/src/index.js',import.meta.url).href,shortCircuit:true};
  return nextResolve(specifier,context);
}
