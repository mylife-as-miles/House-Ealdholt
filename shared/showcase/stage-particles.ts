import type { StageQuality } from './stage-data';
export function stageParticlePositions(quality:StageQuality):Float32Array {
  const count=quality==='high'?56:quality==='medium'?28:0,positions=new Float32Array(count*3);
  for(let i=0;i<count;i++){positions[i*3]=Math.sin(i*127.17)*.49;positions[i*3+1]=.12+((i*47)%101)/101*.38;positions[i*3+2]=-.52+((i*31)%101)/101*.22;}
  return positions;
}
export const STAGE_PARTICLE_VERTEX=`
  uniform float uTime; varying float vAlpha;
  void main(){vec3 p=position;p.x+=sin(uTime*.3+position.y*27.)*.008;p.y+=sin(uTime*.24+position.x*21.)*.012;
  vec4 mv=modelViewMatrix*vec4(p,1.);gl_Position=projectionMatrix*mv;gl_PointSize=clamp(4./max(.1,-mv.z),1.,4.);vAlpha=.22+.12*sin(position.y*98.+uTime*.7);}
`;
export const STAGE_PARTICLE_FRAGMENT=`
  varying float vAlpha;void main(){float d=length(gl_PointCoord-.5);float alpha=exp(-d*d*32.)*vAlpha;if(alpha<.012)discard;gl_FragColor=vec4(.48,.83,.76,alpha);}
`;
