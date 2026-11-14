/** Shared combustion slice sampling. The rendering compatibility backend is
 * explicitly2.5D: one depth-tested card with8 front-to-back depth samples.
 * Opaque geometry occludes at the card plane; this is not scene-depth-aware
 * volumetric raymarching and must not be described as such in diagnostics. */
export const PROCEDURAL_FIRE_SAMPLE_GLSL = /* glsl */ `
  uniform sampler2D cfFireAtlas;
  uniform sampler2D cfFireBlackbody;
  uniform vec3 cfFireGrid;
  uniform vec2 cfFireTiles;
  uniform float cfFireSupported;
  uniform vec3 cfFireFallbackColor;
  vec4 cfFireSlice(vec2 uv, float slice) {
    vec2 tile = vec2(mod(slice,cfFireTiles.x),floor(slice/cfFireTiles.x));
    vec2 texel = vec2(.5) + clamp(uv,0.0,1.0)*(cfFireGrid.xy-1.0);
    return texture2D(cfFireAtlas,(tile*cfFireGrid.xy+texel)/(cfFireTiles*cfFireGrid.xy));
  }
  vec4 cfFireVoxel(vec3 p) {
    if(any(lessThan(p,vec3(0.0)))||any(greaterThan(p,vec3(1.0))))return vec4(0.0);
    float z=p.z*(cfFireGrid.z-1.0), a=floor(z), b=min(a+1.0,cfFireGrid.z-1.0);
    return mix(cfFireSlice(p.xy,a),cfFireSlice(p.xy,b),fract(z));
  }
  // Returns LINEAR PREMULTIPLIED radiance+opacity. Callers doing tone mapping
  // or output encoding must unassociate RGB first and premultiply afterwards.
  vec4 cfSampleCombustionFire(vec2 uv,float phase,float intensity) {
    if(intensity<=0.0)return vec4(0.0);
    if(cfFireSupported<.5){
      float width=mix(.38,.015,pow(clamp(uv.y,0.0,1.0),.7));
      float a=(1.0-smoothstep(width*.45,width,abs(uv.x-.5)))*smoothstep(0.0,.08,uv.y)*(1.0-smoothstep(.75,1.0,uv.y))*.65;
      a*=clamp(intensity,0.0,1.0);return vec4(cfFireFallbackColor*a,a);
    }
    float angle=phase*.47, cs=cos(angle), sn=sin(angle), transmit=1.0;
    vec3 radiance=vec3(0.0);
    for(int tap=0;tap<8;tap++) {
      vec3 p=vec3(uv,(float(tap)+.5)/8.0);
      vec2 q=p.xz-.5;p.xz=vec2(cs*q.x-sn*q.y,sn*q.x+cs*q.y)+.5;
      vec4 field=cfFireVoxel(p);
      float temperature=293.0+1807.0*field.r;
      float reaction=field.b, soot=field.g*2.0, density=max(intensity,0.0);
      // Leon Lin renderer.js defaults: sootAbs4,sootEmit10,emitK4.
      // Emission/extinction source function is therefore10*blackbody,
      // rather than silently omitting the sourced optical calibration.
      float extinction=soot*4.0*density+1e-6;
      float alpha=1.0-exp(-extinction/8.0);
      float lut=clamp((temperature-400.0)/2000.0,0.0,1.0);
      vec3 thermal=exp2(texture2D(cfFireBlackbody,vec2(lut,.75)).rgb*16.0)-1.0;
      vec3 emission=temperature>900.0?soot*10.0*4.0*thermal*density:vec3(0.0);
      emission+=vec3(.15,.3,1.0)*pow(reaction,1.6)*(.05/3.0)*exp(-soot*2.0)*density;
      radiance+=transmit*alpha*(emission/extinction);
      transmit*=1.0-alpha;
    }
    return vec4(radiance,1.0-transmit);
  }
`;
export const PROCEDURAL_FIRE_CARD_VERTEX = /* glsl */ `
  varying vec2 vFireUv;
  void main(){
    vFireUv=uv;
    vec4 center=modelViewMatrix*vec4(0.0,0.0,0.0,1.0);
    vec3 up=modelViewMatrix[1].xyz;
    vec3 right=cross(up,vec3(0.0,0.0,1.0));
    right=length(right)>.00001?normalize(right):vec3(1.0,0.0,0.0);
    center.xyz+=right*position.x*length(modelViewMatrix[0].xyz)+up*position.y;
    gl_Position=projectionMatrix*center;
  }
`;
export const PROCEDURAL_FIRE_CARD_FRAGMENT = /* glsl */ `
  varying vec2 vFireUv;
  uniform float cfFireIntensity;
  uniform float cfFirePhase;
  ${PROCEDURAL_FIRE_SAMPLE_GLSL}
  void main(){
    vec4 flame=cfSampleCombustionFire(vFireUv,cfFirePhase,cfFireIntensity);
    if(flame.a<.003)discard;
    gl_FragColor=vec4(flame.rgb/max(flame.a,.00001),flame.a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    gl_FragColor.rgb*=gl_FragColor.a;
  }
`;
