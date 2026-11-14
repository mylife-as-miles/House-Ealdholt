/** Moon regolith/phase and galactic-band composition adapted from Solstice
 * 9d57b5be (MIT), sky/bodies.wgsl and sky/milky_way.wgsl. See LICENSE.solstice.txt.
 * This bounded analytic fallback has no texture, bake or per-pixel noise loop. */
export const WORLD_CELESTIAL_SHADER_VERSION='calendar-celestial-v2';
export const WORLD_CELESTIAL_GLSL=`
uniform vec3 cfWorldMoon;
uniform float cfMoonIllumination;
uniform float cfMoonVisibility;
uniform float cfMoonWashout;
uniform float cfNightVisibility;
uniform vec2 cfStarRotation;

vec3 cfCelestialFrame(vec3 ray){
 float c=cfStarRotation.x,s=cfStarRotation.y;
 return vec3(c*ray.x+s*ray.z,ray.y,-s*ray.x+c*ray.z);
}
// Galactic pole/centre: Solstice's J2000 reference frame. A compact analytic
// band and dust lane replace its expensive baked fractal sky in this backend.
vec3 cfGalacticBand(vec3 c){
 vec3 g=vec3(dot(c,vec3(-.0548756,-.8734371,-.4838350)),dot(c,vec3(.4941094,-.4448296,.7469822)),dot(c,vec3(-.8676661,-.1980764,.4559838)));
 float latitude=asin(clamp(g.z,-1.,1.)),longitude=atan(g.y,g.x),centre=.5+.5*cos(longitude);
 float width=.07+.07*pow(centre,4.),disc=exp(-pow(latitude/width,2.))*(.2+.8*pow(centre,2.5));
 float mottling=.65+.18*sin(longitude*18.+g.y*27.)+.12*sin(longitude*43.-g.x*19.);
 float lane=.012+.018*sin(longitude*8.);
 float dust=exp(-pow((latitude-lane)/.018,2.))*(.45+.2*sin(longitude*23.));
 float bulge=exp(-pow(longitude/.30,2.)-pow(latitude/.20,2.));
 return mix(vec3(.58,.69,.9),vec3(.95,.79,.59),pow(centre,3.))*(disc*mottling+bulge*.45)*(1.-clamp(dust,0.,.85));
}
float cfStarHash(vec2 p,float face){return fract(sin(dot(p,vec2(127.1,311.7))+face*71.3)*43758.5453);}
vec3 cfStarField(vec3 c,float band){
 vec3 a=abs(c);vec2 uv;float face;
 if(a.x>a.y&&a.x>a.z){uv=c.zy/a.x;face=c.x>0.?1.:2.;}
 else if(a.y>a.z){uv=c.xz/a.y;face=c.y>0.?3.:4.;}
 else{uv=c.xy/a.z;face=c.z>0.?5.:6.;}
 vec2 grid=uv*145.,base=floor(grid-.5);float radius=clamp(length(fwidth(grid))*.5,.055,.32);
 vec3 colour=vec3(0.);
 // Four neighbouring cells keep soft stars intact at cell boundaries. No
 // octaves, twinkle timer, catalogue texture or new GPU resources are needed.
 for(int i=0;i<4;i++){
  vec2 cell=base+vec2(float(i-2*(i/2)),float(i/2));float h=cfStarHash(cell,face);
  if(h<1.-mix(.004,.014,band))continue;
  vec2 centre=.25+.5*vec2(fract(h*97.31),fract(h*63.17)),q=grid-cell-centre;
  float spot=exp(-dot(q,q)/(radius*radius));
  colour+=mix(vec3(.72,.83,1.),vec3(1.,.87,.68),fract(h*41.63))*spot*(.22+.78*fract(h*83.29));
 }
 return colour;
}
vec4 cfMoonBody(vec3 ray){
 float toward=dot(ray,cfWorldMoon);if(toward<.9995||cfMoonVisibility<=0.)return vec4(0.);
 vec3 axis=abs(cfWorldMoon.y)>.98?vec3(1.,0.,0.):vec3(0.,1.,0.);
 vec3 east=normalize(cross(axis,cfWorldMoon)),north=cross(cfWorldMoon,east);
 // Slightly enlarged for the existing small game canvas:1.43degree diameter.
 vec2 q=vec2(dot(ray,east),dot(ray,north))/.0125;float r2=dot(q,q),aa=max(fwidth(r2),.015),alpha=1.-smoothstep(1.-aa,1.+aa,r2);
 float z=sqrt(max(0.,1.-r2));vec3 normal=east*q.x+north*q.y-cfWorldMoon*z;
 float mu=max(dot(normal,cfWorldSun),0.),regolith=2.*mu/max(mu+z,.0001);
 float seas=.72+.10*sin(q.x*9.+q.y*4.)*sin(q.y*11.-q.x*3.);
 float earthshine=.018*pow(1.-cfMoonIllumination,2.);
 vec3 colour=vec3(.62,.69,.80)*seas*(regolith+earthshine);
 return vec4(colour*cfMoonVisibility,alpha*cfMoonVisibility);
}
vec3 cfCelestialSky(vec3 ray){
 // The moon can be visible in daylight and twilight. Only the star field and
 // Milky Way wait for darkness; the phase and horizon still gate the disc.
 vec4 moon=cfMoonBody(ray);
 if(cfNightVisibility<.0001)return moon.rgb*moon.a;
 vec3 c=cfCelestialFrame(ray),galaxy=cfGalacticBand(c);
 float horizon=smoothstep(.015,.22,ray.y),band=clamp(max(galaxy.r,max(galaxy.g,galaxy.b)),0.,1.);
 vec3 stars=cfStarField(c,band)*.60*(1.-.65*cfMoonWashout),milky=galaxy*.065*(1.-.94*cfMoonWashout);
 return (stars+milky)*horizon*(1.-moon.a)*cfNightVisibility+moon.rgb*moon.a;
}
`;
