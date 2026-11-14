import type {VegetationShader} from './vegetation-shaders';
/** Triplanar albedo prevents steep ridges stretching a horizontal texture.
 * Existing PBR roughness/normal maps, shadows and tone mapping remain intact. */
export function patchRegionalRidgeShader(shader:VegetationShader,uniforms:Record<string,{value:unknown}>){
 const vertex='#include <begin_vertex>',map='#include <color_fragment>',tone='#include <tonemapping_fragment>';
 for(const [source,seam]of [[shader.vertexShader,vertex],[shader.fragmentShader,map],[shader.fragmentShader,tone]])if(source.split(seam).length!==2)throw Error('Unsupported regional ridge shader.');
 Object.assign(shader.uniforms,uniforms);
 shader.vertexShader='varying vec3 vRidgeSource; varying vec3 vRidgeNormal;\n'+shader.vertexShader;
 shader.vertexShader=shader.vertexShader.replace(vertex,vertex+'\nvRidgeSource=position;vRidgeNormal=normal;');
 shader.fragmentShader='varying vec3 vRidgeSource;varying vec3 vRidgeNormal;uniform vec3 cfRegionalHazeColour;uniform float cfRegionalRockMean;uniform float cfRegionalSourceDistanceScale;uniform float cfRegionalHazeLength;\n'+shader.fragmentShader;
 shader.fragmentShader=shader.fragmentShader.replace(map,`${map}
#ifdef USE_MAP
vec3 ridgeWeights=pow(abs(normalize(vRidgeNormal)),vec3(4.));ridgeWeights/=max(dot(ridgeWeights,vec3(1.)),.0001);
vec3 ridgeStone=texture2D(map,vRidgeSource.yz/4.).rgb*ridgeWeights.x+texture2D(map,vRidgeSource.xz/4.).rgb*ridgeWeights.y+texture2D(map,vRidgeSource.xy/4.).rgb*ridgeWeights.z;
vec3 ridgeTint=vec3(1.);
#if defined(USE_COLOR) || defined(USE_COLOR_ALPHA)
ridgeTint=vColor.rgb;
#endif
float ridgeSnow=smoothstep(.48,.72,max(ridgeTint.r,max(ridgeTint.g,ridgeTint.b)));
diffuseColor.rgb=diffuse*mix(ridgeTint*ridgeStone/cfRegionalRockMean,vec3(.72,.78,.83),ridgeSnow);
#endif`);
 shader.fragmentShader=shader.fragmentShader.replace(tone,`
float regionalHaze=clamp(1.-exp(-length(vViewPosition)*cfRegionalSourceDistanceScale/max(cfRegionalHazeLength,1000.)),0.,.72);
gl_FragColor.rgb=mix(gl_FragColor.rgb,cfRegionalHazeColour,regionalHaze);
${tone}`);
}
