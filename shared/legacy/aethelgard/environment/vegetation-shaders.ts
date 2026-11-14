/** r185 GLSL adaptation of BakedVoxelLighting's per-actor impostors and
 * complementary fade ranges (MIT). Object normals remain relightable. */
export interface VegetationShader {
  uniforms: Record<string, {value: unknown}>; vertexShader: string; fragmentShader: string;
}
function seam(source: string, token: string, replacement: string): string {
  if (source.split(token).length !== 2) throw Error('Unsupported vegetation shader seam: ' + token);
  return source.replace(token, replacement);
}
export function patchVegetationFade(shader: VegetationShader, cellUniform = false): void {
  shader.vertexShader = (cellUniform ? 'uniform' : 'attribute') + ' vec2 crownfallLodRange; varying vec2 vCrownfallLodRange;\n' + shader.vertexShader;
  shader.vertexShader = seam(shader.vertexShader, '#include <begin_vertex>', '#include <begin_vertex>\nvCrownfallLodRange=crownfallLodRange;');
  shader.fragmentShader = 'varying vec2 vCrownfallLodRange;\n' + shader.fragmentShader;
  shader.fragmentShader = seam(shader.fragmentShader, '#include <alphatest_fragment>', `#include <alphatest_fragment>
if(vCrownfallLodRange.y<=vCrownfallLodRange.x) discard;
if(vCrownfallLodRange.x>0.||vCrownfallLodRange.y<1.) {
 float crownfallDoor=fract(sin(dot(floor(gl_FragCoord.xy),vec2(12.9898,78.233)))*43758.5453);
 if(crownfallDoor<vCrownfallLodRange.x||crownfallDoor>=vCrownfallLodRange.y) discard;
}`);
}
export function patchVegetationImpostor(shader: VegetationShader, orthogonalSourceFrame = false, elevated?:{canopy?:boolean;coverage?:boolean}): void {
  shader.vertexShader = `uniform vec3 crownfallSourceEye;
uniform vec3 crownfallAtlasCentre;
uniform vec2 crownfallAtlasExtent;
uniform float crownfallAtlasViews;
varying vec2 vCrownfallAtlasView;
varying mat3 vCrownfallAtlasNormal;
${elevated?'uniform float crownfallElevatedEnabled; uniform vec3 crownfallElevationCentre;':''}
` + shader.vertexShader;
  shader.vertexShader = seam(shader.vertexShader, '#include <begin_vertex>', `#include <begin_vertex>
${orthogonalSourceFrame ? `
vec3 crownfallDelta=crownfallSourceEye-instanceMatrix[3].xyz;
vec3 crownfallScale2=vec3(dot(instanceMatrix[0].xyz,instanceMatrix[0].xyz),dot(instanceMatrix[1].xyz,instanceMatrix[1].xyz),dot(instanceMatrix[2].xyz,instanceMatrix[2].xyz));
vec3 crownfallLocalEye=vec3(dot(crownfallDelta,instanceMatrix[0].xyz),dot(crownfallDelta,instanceMatrix[1].xyz),dot(crownfallDelta,instanceMatrix[2].xyz))/crownfallScale2-crownfallAtlasCentre;
` : `vec3 crownfallEye=(inverse(modelMatrix)*vec4(cameraPosition,1.)).xyz;
vec3 crownfallLocalEye=(inverse(instanceMatrix)*vec4(crownfallEye,1.)).xyz-crownfallAtlasCentre;`}
float crownfallYaw=atan(crownfallLocalEye.x,crownfallLocalEye.z);
float crownfallView=mod(crownfallYaw/6.28318530718*crownfallAtlasViews+crownfallAtlasViews,crownfallAtlasViews);
vCrownfallAtlasView=${elevated?.canopy?'vec2(0.)':'vec2(floor(crownfallView),fract(crownfallView))'};
vCrownfallAtlasNormal=${orthogonalSourceFrame ? 'normalMatrix*mat3(instanceMatrix)' : 'transpose(inverse(mat3(modelViewMatrix)*mat3(instanceMatrix)))'};
transformed=crownfallAtlasCentre+${elevated?.canopy?'vec3(position.x*crownfallAtlasExtent.x,0.,-position.y*crownfallAtlasExtent.y)':'vec3(position.x*crownfallAtlasExtent.x*cos(crownfallYaw),position.y*crownfallAtlasExtent.y,-position.x*crownfallAtlasExtent.x*sin(crownfallYaw))'};
${elevated?`vec3 crownfallElevationEye=crownfallLocalEye+crownfallAtlasCentre-crownfallElevationCentre;
float crownfallCanopyWeight=smoothstep(.35,.85,max(0.,crownfallElevationEye.y)/max(length(crownfallElevationEye.xz),.01))*crownfallElevatedEnabled;
vCrownfallLodRange=${elevated.coverage?(elevated.canopy?'vec2(crownfallLodRange.x,mix(crownfallLodRange.x,crownfallLodRange.y,crownfallCanopyWeight))':'vec2(mix(crownfallLodRange.x,crownfallLodRange.y,crownfallCanopyWeight),crownfallLodRange.y)'):(elevated.canopy?'vec2(0.,crownfallCanopyWeight)':'vec2(crownfallCanopyWeight,1.)')};`:''}`);
  shader.fragmentShader = `uniform sampler2D crownfallAtlasNormalMap;
uniform float crownfallAtlasViews;
uniform vec2 crownfallAtlasGrid;
uniform vec2 crownfallAtlasPixels;
uniform float crownfallAtlasMaximumMip;
varying vec2 vCrownfallAtlasView;
varying mat3 vCrownfallAtlasNormal;
vec2 crownfallAtlasUV(float view,vec2 sourceUV){
 vec2 inset=.75/(crownfallAtlasPixels/crownfallAtlasGrid);
 return (vec2(mod(view,crownfallAtlasGrid.x),floor(view/crownfallAtlasGrid.x))+mix(inset,1.-inset,sourceUV))/crownfallAtlasGrid;
}
vec4 crownfallAtlasSample(sampler2D channel,vec2 a,vec2 b,float lod){
 vec4 first=textureLod(channel,a,lod),second=textureLod(channel,b,lod);
 float weight0=first.a*(1.-vCrownfallAtlasView.y),weight1=second.a*vCrownfallAtlasView.y;
 return vec4((first.rgb*weight0+second.rgb*weight1)/max(weight0+weight1,.00001),weight0+weight1);
}
` + shader.fragmentShader;
  shader.fragmentShader = seam(shader.fragmentShader, '#include <map_fragment>', `
vec2 crownfallUV0=crownfallAtlasUV(vCrownfallAtlasView.x,vMapUv);
vec2 crownfallUV1=crownfallAtlasUV(mod(vCrownfallAtlasView.x+1.,crownfallAtlasViews),vMapUv);
vec2 crownfallDx=dFdx(crownfallUV0*crownfallAtlasPixels),crownfallDy=dFdy(crownfallUV0*crownfallAtlasPixels);
float crownfallMip=clamp(.5*log2(max(dot(crownfallDx,crownfallDx),dot(crownfallDy,crownfallDy))),0.,crownfallAtlasMaximumMip);
diffuseColor*=crownfallAtlasSample(map,crownfallUV0,crownfallUV1,crownfallMip);`);
  shader.fragmentShader = seam(shader.fragmentShader, '#include <normal_fragment_maps>', `#include <normal_fragment_maps>
vec3 crownfallObjectNormal=crownfallAtlasSample(crownfallAtlasNormalMap,crownfallUV0,crownfallUV1,crownfallMip).rgb*2.-1.;
normal=normalize(vCrownfallAtlasNormal*normalize(crownfallObjectNormal));
nonPerturbedNormal=normal;`);
}
