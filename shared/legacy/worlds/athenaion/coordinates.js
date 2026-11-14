/** Source metre coordinates are kept local to this world's materials. Raster
 * projection/model-view matrices stay native, including XR eye transforms. */
export function patchSourceMaterial(material,inverse,forward,eye,seen,atmosphere={},atmosphereGlsl=''){
  if(!material||seen.has(material))return;seen.add(material);
  const decorate=shader=>{
    shader.uniforms.uCrownSourceInverse=inverse;shader.uniforms.uCrownSourceMatrix=forward;shader.uniforms.uCrownSourceCamera=eye;
    Object.assign(shader.uniforms,atmosphere);
    const head='\nuniform mat4 uCrownSourceInverse;\nuniform mat4 uCrownSourceMatrix;\nuniform vec3 uCrownSourceCamera;\nmat3 crownSourceRotation(){return mat3(normalize(uCrownSourceMatrix[0].xyz),normalize(uCrownSourceMatrix[1].xyz),normalize(uCrownSourceMatrix[2].xyz));}\n';
    const convert=(source,vertex)=>{
      source=source.replace(/\bcameraPosition\b/g,'uCrownSourceCamera');
      // Source water replaces fog_fragment before this adapter runs, using the
      // source atmosphere installer's varying. Bind it to our local metre-space
      // varying instead of installing or depending on global fog chunks.
      source=source.replace(/\bvAtmoWorldPos\b/g,'vCrownSourcePosition');
      source=source.replace('viewMatrix * vec4( cgBump, 0.0 )','viewMatrix * vec4( crownSourceRotation() * cgBump, 0.0 )');
      source=source.replace(/\(vec4\(normal, 0\.0\) \* viewMatrix\)\.xyz/g,'normalize(mat3(uCrownSourceInverse) * (vec4(normal, 0.0) * viewMatrix).xyz)');
      if(!material.isShaderMaterial){
        source='varying vec3 vCrownSourcePosition;\n'+source;
        if(vertex)source=source.replace('#include <worldpos_vertex>',`#include <worldpos_vertex>\n{vec4 cp=vec4(transformed,1.0);\n#ifdef USE_BATCHING\ncp=batchingMatrix*cp;\n#endif\n#ifdef USE_INSTANCING\ncp=instanceMatrix*cp;\n#endif\nvCrownSourcePosition=(modelMatrix*cp).xyz;}`);
        else if(material.fog!==false)source=source.replace('#include <fog_pars_fragment>',`#include <fog_pars_fragment>\n${atmosphereGlsl.replace(/\bcameraPosition\b/g,'uCrownSourceCamera')}`).replace('#include <fog_fragment>','gl_FragColor.rgb=atmoApply(gl_FragColor.rgb,vCrownSourcePosition);');
      }
      if(vertex){
        source=source.replace(/\bmodelMatrix\b/g,'(uCrownSourceInverse * modelMatrix)');
        if(material.isShaderMaterial)source=source.replace('vDir = position;','vDir = normalize(mat3(uCrownSourceInverse) * position);');
        // Particle sheets construct positions directly in authored source metres.
        source=source.replace(/projectionMatrix\s*\*\s*viewMatrix\s*\*/g,'projectionMatrix * viewMatrix * uCrownSourceMatrix *');
      }
      return head+source;
    };
    shader.vertexShader=convert(shader.vertexShader,true);shader.fragmentShader=convert(shader.fragmentShader,false);
  };
  if(material.isShaderMaterial){decorate(material);material.needsUpdate=true;return;}
  const before=material.onBeforeCompile,oldKey=material.customProgramCacheKey?.bind(material);
  material.onBeforeCompile=function(shader,renderer){if(before)before.call(this,shader,renderer);decorate(shader);};
  material.customProgramCacheKey=()=>`${oldKey?oldKey():''}|crownfall-source-metres-v1`;
  material.needsUpdate=true;
}
