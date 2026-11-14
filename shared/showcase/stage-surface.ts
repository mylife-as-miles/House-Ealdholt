import type { PiecePose } from './stage-data';
export interface StageSurfaceState {positions:Float32Array;count:{value:number};}
interface StageShader {vertexShader:string;fragmentShader:string;uniforms:Record<string,{value:unknown}>;}
export function createStageSurface():StageSurfaceState {return {positions:new Float32Array(64*3),count:{value:0}};}
/** A bounded receiving-surface occlusion field, not a transparent shadow card. */
export function updateStageSurface(state:StageSurfaceState,actors:readonly PiecePose[]):void {
  let count=0;for(let i=0;i<actors.length&&count<64;i++){const a=actors[i];if(!a.visible)continue;const j=count++*3;state.positions[j]=a.x;state.positions[j+1]=a.z;state.positions[j+2]=a.scale*Math.max(0,1-(a.y-.075)*6);}
  state.count.value=count;
}
/** Original procedural fine grain and subtle cut-stone veins; no downloaded textures. */
export function applyStageSurface(shader:StageShader,key:string,state:StageSurfaceState):void {
  shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nvarying vec3 vStageLocal;')
    .replace('#include <begin_vertex>','#include <begin_vertex>\nvStageLocal = position;');
  const contacts=key==='tile',backdrop=key==='backdrop';
  shader.fragmentShader=shader.fragmentShader.replace('#include <common>',`#include <common>
    varying vec3 vStageLocal;
    ${contacts?'uniform vec3 uStageContacts[64]; uniform int uStageContactCount;':''}
  `);
  const strength=key==='piece'?.018:key==='brass'?.045:key==='wood'?.11:.075;
  const grain=`
    float stageGrain = sin(vStageLocal.x * 591. + sin(vStageLocal.z * 443.) * 1.8 + vStageLocal.y * 241.) * .5 + .5;
    float stageVein = pow(abs(sin(vStageLocal.x * 37. + sin(vStageLocal.z * 21.) * 2.4)), 18.);
    diffuseColor.rgb *= 1. - ${strength.toFixed(3)} * stageGrain ${key==='tile'||key==='stone'?' - .045 * stageVein':''};
  `;
  const edge=backdrop?'diffuseColor.a *= 1. - smoothstep(.67, 1., max(abs(vStageLocal.x) / 1.4, abs(vStageLocal.z + .45) / 1.05));':'';
  const occlusion=contacts?`
    float stageContact = 1.;
    for(int i=0;i<64;i++) { if(i>=uStageContactCount) break;
      vec2 delta = vStageLocal.xz - uStageContacts[i].xy;
      float footprint = (1. - smoothstep(.00042,.00255,dot(delta,delta))) * uStageContacts[i].z;
      stageContact *= 1. - footprint * .48;
    }
    outgoingLight *= stageContact;
  `:backdrop?'outgoingLight *= .42 + .58 * exp(-dot(vStageLocal.xz - vec2(0.,-.15), vStageLocal.xz - vec2(0.,-.15)) * 1.15);':'';
  shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>\n${grain}\n${edge}`)
    .replace('#include <roughnessmap_fragment>',`#include <roughnessmap_fragment>\nroughnessFactor = clamp(roughnessFactor * (.94 + .12 * stageGrain), .08, 1.);`)
    .replace('#include <opaque_fragment>',`${occlusion}\n#include <opaque_fragment>`);
  if(contacts){shader.uniforms.uStageContacts={value:state.positions};shader.uniforms.uStageContactCount=state.count;}
}
