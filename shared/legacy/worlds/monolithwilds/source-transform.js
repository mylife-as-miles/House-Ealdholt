// Source-space procedural shading for a world that can be displayed as a Quest
// miniature. Only this world's source shader statements are rewritten: Three's
// projection/model-view/shadow chunks and global ShaderChunk remain unchanged.
import * as THREE from 'crownfall-world-three';
import { expandAtmosphere } from './src/core/atmosphere.js';

export function createSourceTransform(root, sourceCamera) {
  const fromWorld={value:new THREE.Matrix4()},toWorld={value:new THREE.Matrix4()},eye={value:sourceCamera.position.clone()};
  const head='uniform mat4 uMwSourceFromWorld;\nuniform mat4 uMwWorldFromSource;\nuniform vec3 uMwSourceCamera;\n';
  const patchText=(text)=>{
    const saved=[];
    const recover=/cameraPosition\s*\+\s*transpose\s*\(\s*mat3\s*\(\s*viewMatrix\s*\)\s*\)\s*\*\s*mvPosition\.xyz/g;
    text=text.replace(recover,m=>`__MW_REAL_RECOVER_${saved.push(m)-1}__`);
    text=text.replace(/\bcameraPosition\b/g,'uMwSourceCamera');
    // These source literals produce procedural coordinates, not raster positions.
    text=text.replace(/\(modelMatrix\s*\*\s*vec4\((transformed|loomP),\s*1\.0\)\)/g,'(uMwSourceFromWorld * modelMatrix * vec4($1, 1.0))');
    text=text.replace(/transpose\s*\(\s*mat3\s*\(\s*viewMatrix\s*\)\s*\)\s*\*\s*transformedNormal/g,'mat3(uMwSourceFromWorld) * transpose(mat3(viewMatrix)) * transformedNormal');
    // Ambient life computes wp directly in source metres rather than through
    // modelMatrix. Apply the miniature root only for its raster projection.
    text=text.replace(/viewMatrix\s*\*\s*vec4\(wp,\s*1\.0\)/g,'viewMatrix * uMwWorldFromSource * vec4(wp, 1.0)');
    // Water's source-space depth bias is transformed back for real rasterization.
    text=text.replace(/mvPosition\s*=\s*viewMatrix\s*\*\s*vec4\(biased,\s*1\.0\)/g,'mvPosition = viewMatrix * uMwWorldFromSource * vec4(biased, 1.0)');
    text=text.replace(/viewMatrix\s*\*\s*vec4\((wN|gN|N|uTerrSunDir),\s*0\.0\)/g,'viewMatrix * uMwWorldFromSource * vec4($1, 0.0)');
    return head+text.replace(/__MW_REAL_RECOVER_(\d+)__/g,(_,i)=>`(uMwSourceFromWorld * vec4(${saved[+i]}, 1.0)).xyz`);
  };
  const seen=new Set();
  root.traverse(o=>{
    for(const m of [...(o.material?(Array.isArray(o.material)?o.material:[o.material]):[]),o.customDepthMaterial,o.customDistanceMaterial].filter(Boolean)){
      if(seen.has(m))continue;seen.add(m);
      const previous=m.onBeforeCompile, cache=m.customProgramCacheKey.bind(m);
      m.customProgramCacheKey=()=>cache()+'|crownfall-monolith-source-v2';
      m.onBeforeCompile=(shader,renderer)=>{
        previous.call(m,shader,renderer);
        if(m.fog!==false)expandAtmosphere(shader);
        Object.assign(shader.uniforms,{uMwSourceFromWorld:fromWorld,uMwWorldFromSource:toWorld,uMwSourceCamera:eye});
        shader.vertexShader=patchText(shader.vertexShader);
        shader.fragmentShader=patchText(shader.fragmentShader);
      };
      m.needsUpdate=true;
    }
  });
  return (matrix,position)=>{fromWorld.value.copy(matrix);toWorld.value.copy(matrix).invert();eye.value.copy(position);};
}
