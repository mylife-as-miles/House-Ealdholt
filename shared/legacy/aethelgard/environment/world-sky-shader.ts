import {CLOUD_SAMPLE_GLSL} from './cloud-volume';
import {WORLD_CELESTIAL_GLSL} from './world-celestial-shader';
/** Beer/powder cloud integration adapted from BakedVoxelLighting cloudTrace.
 * Reduced fixed step counts are backend budgets, never physical weather claims. */
export function worldSkyShader(steps:number){
 if(!Number.isInteger(steps)||steps<4||steps>64)throw Error('Invalid cloud ray budget.');
 return CLOUD_SAMPLE_GLSL+WORLD_CELESTIAL_GLSL+`
uniform vec3 cfSkyZenith;uniform vec3 cfSkyHorizon;uniform vec3 cfSunColour;
uniform vec3 cfCloudEye;uniform float cfDaylight;uniform float cfRain;
float cfPhase(float cosine,float g){float g2=g*g;return(1.-g2)/pow(max(1.+g2-2.*g*cosine,.0001),1.5);}
vec3 cfSky(vec3 ray){
 ray=normalize(ray);vec3 sky=mix(cfSkyHorizon,cfSkyZenith,pow(clamp(ray.y,0.,1.),.48));
 float cosine=dot(ray,cfWorldSun),sunDisc=smoothstep(.99975,.9999,cosine)*smoothstep(-.02,.06,cfWorldSun.y);
 sky+=cfSunColour*(sunDisc*3.+pow(max(cosine,0.),64.)*.22*cfDaylight);
 float twilight=(1.-smoothstep(.10,.30,abs(cfWorldSun.y)))*smoothstep(-.18,.015,cfWorldSun.y);
 float dawnFacing=pow(max(dot(normalize(vec3(ray.x,0.,ray.z)+vec3(.000001)),normalize(vec3(cfWorldSun.x,0.,cfWorldSun.z)+vec3(.000001))),0.),6.);
 sky+=vec3(.22,.065,.018)*twilight*exp(-max(ray.y,0.)*7.)*dawnFacing;
 sky+=cfCelestialSky(ray);
 if(ray.y<.035)return sky;
 float start=max(0.,(650.-cfCloudEye.y)/ray.y),end=min(11000.,(1270.-cfCloudEye.y)/ray.y);
 if(end<=start)return sky;
 float stepSize=(end-start)/float(${steps}),transmission=1.;vec3 colour=vec3(0.);
 float phase=mix(cfPhase(cosine,.62),cfPhase(cosine,-.22),.3);
 float jitter=fract(sin(dot(ray.xz,vec2(127.1,311.7)))*43758.5453);
 for(int i=0;i<${steps};i++){
  vec3 p=cfCloudEye+ray*(start+(float(i)+jitter)*stepSize);p.xz+=cfCloudOffset;
  vec3 q=(p-vec3(0.,650.,0.))/vec3(6000.,620.,6000.);float density=cfCloudSample(q);if(density<.004)continue;
  float depth=0.;for(int tap=1;tap<=3;tap++)depth+=cfCloudSample(q+cfWorldSun*(float(tap)*110.)/vec3(6000.,620.,6000.));
  float beer=exp(-depth*.9),powder=1.-exp(-density*1.8),alpha=1.-exp(-density*stepSize*.009);
  vec3 ambient=mix(vec3(.12,.15,.21),vec3(.44,.52,.66),pow(clamp(q.y,0.,1.),1.6))*mix(.035,1.,cfDaylight);
  ambient+=vec3(.018,.024,.035)*cfMoonIllumination*cfMoonVisibility*(1.-cfDaylight);
  vec3 direct=cfSunColour*(beer*mix(.55,1.,powder)*phase*.62+pow(beer,.25)*.12)*cfDaylight;
  colour+=transmission*alpha*(ambient+direct)*(1.-cfRain*.15);transmission*=1.-alpha;if(transmission<.015)break;
 }
 float fade=smoothstep(.035,.085,ray.y);return mix(sky,colour+sky*transmission,fade);
}
`;
}
