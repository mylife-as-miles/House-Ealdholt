import {PROCEDURAL_FIRE_SAMPLE_GLSL} from '../environment/procedural-fire-shader';

export const BUILDING_DISASTER_VERTEX=/* glsl */`
attribute vec4 cfDisasterPosition;
attribute vec2 cfDisasterValue;
uniform float cfDisasterScale;
uniform float cfDisasterSeconds;
uniform vec2 cfDisasterWind;
varying vec2 vUv;
varying float vStrength;
varying float vSeed;
void main(){
 vUv=uv;vStrength=cfDisasterValue.x;vSeed=cfDisasterValue.y;
 vec3 p=cfDisasterPosition.xyz;
 float size=cfDisasterPosition.w;
 #ifdef CF_DISASTER_SMOKE
 float age=fract(cfDisasterSeconds*.065+vSeed);
 p.y+=age*24.;p.xz+=cfDisasterWind*age*age*12.;
 size*=mix(.7,2.8,age);vStrength*=smoothstep(0.,.1,age)*(1.-age);
 #endif
 vec4 center=modelViewMatrix*vec4(p,1.);
 center.xy+=position.xy*size*cfDisasterScale;
 gl_Position=projectionMatrix*center;
}`;
export const BUILDING_DISASTER_FIRE=/* glsl */`
varying vec2 vUv;varying float vStrength;varying float vSeed;
${PROCEDURAL_FIRE_SAMPLE_GLSL}
void main(){
 vec4 f=cfSampleCombustionFire(vUv,vSeed*6.283,vStrength);
 if(f.a<.003)discard;
 gl_FragColor=vec4(f.rgb/max(f.a,.00001),f.a);
 #include <tonemapping_fragment>
 #include <colorspace_fragment>
 gl_FragColor.rgb*=gl_FragColor.a;
}`;
export const BUILDING_DISASTER_SMOKE=/* glsl */`
uniform float cfDisasterDaylight;
varying vec2 vUv;varying float vStrength;varying float vSeed;
void main(){
 float r=length(vUv-.5);
 float a=(1.-smoothstep(.22,.5,r))*vStrength*.48;
 if(a<.003)discard;
 vec3 c=mix(vec3(.035,.027,.022),vec3(.20,.18,.16),cfDisasterDaylight);
 gl_FragColor=vec4(c,a);
 #include <tonemapping_fragment>
 #include <colorspace_fragment>
}`;
