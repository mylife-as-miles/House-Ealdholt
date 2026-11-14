import type{Camera,MeshStandardMaterial,Object3D,Scene,WebGLRenderer}from'three';
export const NATURAL_RIPARIAN_SHADER_MARKER='CROWNFALL_NATURAL_RIPARIAN_SOURCE_V1';
/** A stable marker identifies our queued program errors without swallowing
 * unrelated live-scene failures. It changes no PBR calculation. */
export function markNaturalRiparianMaterial(material:MeshStandardMaterial){
 const prior=material.onBeforeCompile;material.onBeforeCompile=function(shader,renderer){prior.call(this,shader,renderer);shader.vertexShader='#define '+NATURAL_RIPARIAN_SHADER_MARKER+'\n'+shader.vertexShader;shader.fragmentShader='#define '+NATURAL_RIPARIAN_SHADER_MARKER+'\n'+shader.fragmentShader;};
}
/** r185 compileAsync waits for parallel completion, not successful linking.
 * Inspect public renderer program records and the actual GL LINK_STATUS before
 * publishing source ownership; no hidden render or private properties access. */
export async function compileNaturalRiparianPrograms(renderer:WebGLRenderer,preview:Object3D,camera:Camera,scene:Scene,materials:readonly MeshStandardMaterial[]){
 const gl=renderer.getContext(),debug=renderer.debug,previous=debug.onShaderError,previousCheck=debug.checkShaderErrors;let failure='';
 const onError:NonNullable<typeof previous>=(context,program,vertex,fragment)=>{
  if((context.getShaderSource(vertex)??'').includes(NATURAL_RIPARIAN_SHADER_MARKER)||(context.getShaderSource(fragment)??'').includes(NATURAL_RIPARIAN_SHADER_MARKER))failure=context.getProgramInfoLog(program)||'Natural bank source shader failed.';
  previous?.call(debug,context,program,vertex,fragment);
 };
 debug.onShaderError=onError;debug.checkShaderErrors=true;
 try{
  await renderer.compileAsync(preview,camera,scene);
  if(failure)throw Error(failure);if(gl.isContextLost())throw Error('Natural bank shader context was lost.');
  const keys=materials.map(m=>m.customProgramCacheKey()),verified=new Set<string>();
  for(const record of renderer.info.programs??[])for(const key of keys){
   if(record.cacheKey!==key&&!record.cacheKey.endsWith(','+key))continue;
   if(!record.program||gl.getProgramParameter(record.program,gl.LINK_STATUS)!==true)throw Error(record.program?gl.getProgramInfoLog(record.program)||'Natural bank source program did not link.':'Natural bank source program is unavailable.');
   verified.add(key);
  }
  if(verified.size!==new Set(keys).size||!verified.size)throw Error('No complete verified natural bank source programs.');
 }finally{if(debug.onShaderError===onError)debug.onShaderError=previous;debug.checkShaderErrors=previousCheck;}
}
