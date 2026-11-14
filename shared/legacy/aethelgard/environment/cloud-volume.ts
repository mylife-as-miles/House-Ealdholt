export {CLOUD_DENSITY_VERSION,CLOUD_DENSITY_CHANNELS,CLOUD_FIELD_LAYOUT,cloudDensity,cloudOccurrenceByte,cloudDensityByteLength,cloudDensityCacheMetadata,createCloudDensityVolume,finalizeCloudOccurrence,validateCloudDensityVolume} from './cloud-density-source';
export const CLOUD_SAMPLING_VERSION='occurrence-rg8-world-sun-v3';
/** CPU audit counterpart of the live GLSL transfer, not another bake. */
export function cloudCoverageDensity(density:number,occurrence:number,coverage:number){
 const c=Math.max(0,Math.min(1,coverage)),smooth=(a:number,b:number,v:number)=>{const t=Math.max(0,Math.min(1,(v-a)/(b-a)));return t*t*(3-2*t);};
 return Math.max(0,density-(.5-c)*.48)*smooth(0,.08,density)*smooth(occurrence-.05,occurrence+.05,-.05+1.1*c);
}
/** Sky, water, directional shadows and live GI borrow this same moving field.
 * The existing source-density edge guard remains: weather never fills air. */
export const CLOUD_SAMPLE_GLSL=`
uniform highp sampler3D cfCloudDensity;
uniform float cfEnvironmentSeconds;
uniform vec2 cfCloudOffset;
uniform float cfCloudCoverage;
uniform vec3 cfWorldSun;
uniform float cfSurfaceWeatherEnabled;
uniform float cfCloudGlobalTransmission;
uniform float cfCloudLightingEnabled;
uniform mat4 cfCloudSourceToWorld;
vec3 cfCloudWorldPoint(vec3 source){return(cfCloudSourceToWorld*vec4(source,1.)).xyz;}
float cfCloudSample(vec3 p){
 if(p.y<0.||p.y>1.)return 0.;
 vec2 field=texture(cfCloudDensity,vec3(fract(p.x),p.y,fract(p.z))).rg;
 float c=clamp(cfCloudCoverage,0.,1.),occurrence=smoothstep(field.g-.05,field.g+.05,mix(-.05,1.05,c));
 return max(0.,field.r-(.5-c)*.48)*smoothstep(0.,.08,field.r)*occurrence;
}
float cfCloudShadow(vec3 point){
 if(cfWorldSun.y<.035||cfSurfaceWeatherEnabled<.5||point.y>=1270.)return 1.;float depth=0.;
 float bottom=max(650.,point.y),span=1270.-bottom;
 for(int i=0;i<4;i++){float height=bottom+(float(i)+.5)*span/4.;vec2 xz=point.xz+cfWorldSun.xz*(height-point.y)/cfWorldSun.y+cfCloudOffset;
 depth+=cfCloudSample(vec3(xz.x/6000.,(height-650.)/620.,xz.y/6000.));}
 return exp(-depth*(span/4.)*.009/cfWorldSun.y);
}
float cfCloudSunTransmission(vec3 point){return mix(1.,cfCloudShadow(point),.65);}
// All materials retain the global weather baseline. Only a prepared local
// cloud shader replaces it with spatial transmission; failed/pending draws
// remain correctly dimmed, and the receiver/source never applies both terms.
float cfCloudSunGain(vec3 point){return cfCloudLightingEnabled<.5?1.:cfCloudSunTransmission(point)/max(.01,cfCloudGlobalTransmission);}
`;
