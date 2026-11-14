import {BufferAttribute,BufferGeometry,Color,LineSegments,Matrix4,Mesh,PerspectiveCamera,PlaneGeometry,ShaderMaterial,Vector2,Vector3,type Camera,type Object3D} from 'three';
import type {WorldEnvironmentState} from '../../../../shared/legacy/aethelgard/environment/world-environment-state';
/** Ealdholt's rain, entirely on the GPU: fixed geometry moved in the vertex shader, never physics bodies and never
 * re-uploaded particle positions.
 * - A volume of streaks around the camera that reaches down toward the ground, lit by the sky and faded with distance.
 * - A screen-space sheet of falling streaks in three depths, so rain still reads from the high overview where the
 *   volume around the eye is far above the village.
 * Rain falls at its own pace while the village clock runs at any speed (My Legacy's observer can run time 4x or 16x);
 * when the observer holds time, it hangs in the air. */
const VOLUME_WIDTH=56,VOLUME_HEIGHT=40,STREAK_LENGTH=.9,FALL_METRES_PER_SECOND=11;
export function createWorldRain(source:Object3D,camera:Camera,native=false){
 const drops=native?96:2400,positions=new Float32Array(drops*6),seeds=new Float32Array(drops*6);
 const rand=(i:number,lane:number)=>{let h=Math.imul(i+173,lane*374761393);h=Math.imul(h^(h>>>13),1274126177);return((h^(h>>>16))>>>0)/4294967296;};
 for(let i=0;i<drops;i++)for(let end=0;end<2;end++){const at=i*6+end*3;positions.set([0,end*STREAK_LENGTH,0],at);seeds.set([rand(i,1),rand(i,2),rand(i,3)],at);}
 const geometry=new BufferGeometry();geometry.setAttribute('position',new BufferAttribute(positions,3));geometry.setAttribute('cfRainSeed',new BufferAttribute(seeds,3));
 const eye=new Vector3(),inverse=new Matrix4(),colour=new Color(.62,.68,.74);
 const uniforms={cfRainTime:{value:0},cfRainIntensity:{value:0},cfRainEye:{value:eye},cfRainWind:{value:new Vector3()},cfRainColour:{value:colour}};
 const material=new ShaderMaterial({name:'Ealdholt GPU rain streaks',uniforms,transparent:true,depthWrite:false,
 vertexShader:`attribute vec3 cfRainSeed;uniform float cfRainTime;uniform vec3 cfRainEye;uniform vec3 cfRainWind;varying float vFade;
 void main(){
  float fall=${(FALL_METRES_PER_SECOND/VOLUME_HEIGHT).toFixed(4)}*(.85+cfRainSeed.z*.3);
  vec3 p=position+vec3((cfRainSeed.x-.5)*${VOLUME_WIDTH.toFixed(1)},fract(cfRainSeed.y-cfRainTime*fall)*${VOLUME_HEIGHT.toFixed(1)}-${(VOLUME_HEIGHT*.8).toFixed(1)},(cfRainSeed.z-.5)*${VOLUME_WIDTH.toFixed(1)});
  p.xz+=cfRainWind.xz*(p.y/${VOLUME_HEIGHT.toFixed(1)});
  float d=length(p);vFade=smoothstep(${(VOLUME_WIDTH*.5).toFixed(1)},6.,d)*smoothstep(.8,2.6,d);
  p+=cfRainEye;gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.);}`,
 fragmentShader:`uniform vec3 cfRainColour;uniform float cfRainIntensity;varying float vFade;void main(){gl_FragColor=vec4(cfRainColour,cfRainIntensity*.6*vFade);\n#include <tonemapping_fragment>\n#include <colorspace_fragment>\n}`});
 const object=new LineSegments(geometry,material);object.name='Ealdholt local rain';object.frustumCulled=false;object.visible=false;object.raycast=()=>{};object.userData.iwsdkPreviewBounds='exclude';source.add(object);
 // The screen sheet: one full-screen triangle pair drawn after the world, streaks hashed per column in three depths.
 const sheetUniforms={cfSheetTime:{value:0},cfSheetIntensity:{value:0},cfSheetColour:{value:new Color()},cfSheetSlant:{value:0},cfSheetAspect:{value:new Vector2(1,1)}};
 const sheetMaterial=new ShaderMaterial({name:'Ealdholt rain sheet',uniforms:sheetUniforms,transparent:true,depthTest:false,depthWrite:false,toneMapped:false,
 vertexShader:`varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}`,
 fragmentShader:`uniform float cfSheetTime;uniform float cfSheetIntensity;uniform vec3 cfSheetColour;uniform float cfSheetSlant;uniform vec2 cfSheetAspect;varying vec2 vUv;
 float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
 float layer(vec2 uv,float columns,float rows,float speed,float width,float seed){
  vec2 q=vec2(uv.x*cfSheetAspect.x+uv.y*cfSheetSlant,uv.y)*vec2(columns,rows);
  float column=floor(q.x),r=hash(vec2(column,seed)),y=q.y+cfSheetTime*speed*(.8+.4*r)+r*9.;
  float cell=floor(y),t=fract(y),present=step(.42,hash(vec2(column*1.7+cell,seed+3.)));
  float along=smoothstep(0.,.18,t)*(1.-smoothstep(.42,.7,t));
  float across=1.-smoothstep(width*.35,width,abs(fract(q.x)-.5-(hash(vec2(column,cell+seed))-.5)*.6));
  return present*along*across;}
 void main(){
  float rain=layer(vUv,190.,7.,1.9,.16,1.)*.45+layer(vUv,105.,4.5,2.7,.13,2.)*.7+layer(vUv,52.,2.6,3.8,.1,3.);
  float a=clamp(rain*cfSheetIntensity*.3,0.,.5);gl_FragColor=vec4(cfSheetColour,a);\n#include <colorspace_fragment>\n}`});
 const sheet=new Mesh(new PlaneGeometry(2,2),sheetMaterial);sheet.name='Ealdholt rain sheet';sheet.frustumCulled=false;sheet.visible=false;sheet.renderOrder=1000;sheet.raycast=()=>{};sheet.userData.iwsdkPreviewBounds='exclude';
 if(!native)source.add(sheet);
 const stats={drops,gpuAnimated:true,active:false,roofOcclusion:false,screenSheet:!native,rainSeconds:0};let disposed=false;
 // Rain keeps its own time: it advances in real seconds while the village clock moves at any speed, and stops while it is held.
 let rainSeconds=0,lastAnimation=Number.NaN,lastReal=0;
 return{stats,update(state:WorldEnvironmentState|null,animationSeconds:number,reducedMotion:boolean){
  if(disposed)return;const active=!!state&&state.rain>.08;object.visible=active;sheet.visible=active&&!native;stats.active=active;
  const now=performance.now()/1000;
  if(!reducedMotion&&Number.isFinite(lastAnimation)&&animationSeconds!==lastAnimation)rainSeconds+=Math.min(.25,Math.max(0,now-lastReal));
  lastAnimation=animationSeconds;lastReal=now;stats.rainSeconds=rainSeconds;
  if(!active||!state)return;
  source.updateWorldMatrix(true,false);inverse.copy(source.matrixWorld).invert();camera.getWorldPosition(eye).applyMatrix4(inverse);
  const strength=state.windStrength,lit=.35+.65*state.daylight;
  uniforms.cfRainTime.value=rainSeconds;uniforms.cfRainIntensity.value=state.rain;
  uniforms.cfRainWind.value.set(state.wind[0]*(1+strength*4),0,state.wind[1]*(1+strength*4));
  colour.setRGB(...state.skyHorizon).lerp(new Color(.86,.9,.95),.45).multiplyScalar(lit);
  sheetUniforms.cfSheetTime.value=rainSeconds;sheetUniforms.cfSheetIntensity.value=state.rain;sheetUniforms.cfSheetColour.value.copy(colour);
  sheetUniforms.cfSheetSlant.value=-state.wind[0]*(.06+strength*.14);
  sheetUniforms.cfSheetAspect.value.set(camera instanceof PerspectiveCamera?camera.aspect:1,1);
 },dispose(){if(disposed)return;disposed=true;object.removeFromParent();sheet.removeFromParent();geometry.dispose();material.dispose();sheet.geometry.dispose();sheetMaterial.dispose();}};
}
export type WorldRain=ReturnType<typeof createWorldRain>;
