import type {EaldholtFarGeography} from './far-surround';
import type {RegionalPrototype,RegionalWorldLayout} from './regional-world-layout';
import {EALDHOLT_REGIONAL_WORLD as policy} from './regional-world-policy';
import type {VegetationShader} from './vegetation-shaders';
export const REGIONAL_FOREST_FLOOR_VERSION='canopy-area-v3';
export const REGIONAL_FOREST_FLOOR_MATERIAL_VERSION='channel-contact-herb-gaps-v1';
/** Run after the existing ground photo-layer builder, which deliberately
 * consumes map/roughness chunks and reconstructs albedo after color_fragment. */
export function patchRegionalForestFloor(shader:VegetationShader,uniforms:Record<string,{value:unknown}>){
 const vertex='#include <project_vertex>',fragment='#include <metalnessmap_fragment>';
 if(shader.vertexShader.split(vertex).length!==2||shader.fragmentShader.split(fragment).length!==2)throw Error('Unsupported forest-floor PBR shader.');
 Object.assign(shader.uniforms,uniforms);
 shader.vertexShader='uniform mat4 cfForestToSource; varying vec3 vForestSource;\n'+shader.vertexShader;
 shader.vertexShader=shader.vertexShader.replace(vertex,'vForestSource=(cfForestToSource*modelMatrix*vec4(transformed,1.)).xyz;\n'+vertex);
 shader.fragmentShader='uniform sampler2D cfForestLitterCover; uniform vec4 cfForestBounds; varying vec3 vForestSource;\n'+shader.fragmentShader;
 shader.fragmentShader=shader.fragmentShader.replace(fragment,`
vec2 forestUv=(vForestSource.xz-cfForestBounds.xy)/cfForestBounds.zw;
float forestInside=step(0.,forestUv.x)*step(forestUv.x,1.)*step(0.,forestUv.y)*step(forestUv.y,1.);
// Cover retains the old clamped, bilinear, unmipped field. Litter retains
// repeating RGB and its ordinary derivative-selected mip chain.
vec2 forestHalfTexel=.5/vec2(textureSize(cfForestLitterCover,0));
float forestCover=textureLod(cfForestLitterCover,clamp(forestUv,forestHalfTexel,1.-forestHalfTexel),0.).a*forestInside;
#if defined(CROWNFALL_BANK_SOURCE_CONTACT) && defined(USE_MAP)
// Keep the existing source-ground contacts and broken meadow patches readable.
// All controls are zero outside the local channel; canopy fields never change.
forestCover*=1.-ealdholtContactReach*max(ealdholtEdge.y,.65*smoothstep(.3,.7,ealdholtFine)*ealdholtMeadowW);
#endif
diffuseColor.rgb=mix(diffuseColor.rgb,texture2D(cfForestLitterCover,vForestSource.xz/2.8).rgb,forestCover*.92);
`+fragment);
}
/** A stable canopy footprint, not a second ambient-light term. It chooses
 * litter versus meadow albedo only on added terrain outside the settlement. */
export function regionalForestFloorField(g:EaldholtFarGeography,layout:RegionalWorldLayout,prototypes:readonly RegionalPrototype[],size=512){
 const s=g.sourceEnvelope,minX=s.minX-450,minZ=s.minZ-policy.forestExtent.north,width=s.maxX+policy.forestExtent.east-minX,depth=s.maxZ+policy.forestExtent.south-minZ;
 const field=new Float32Array(size*size),data=new Uint8Array(size*size);
 for(let at=0;at<layout.placements.length;at+=6){const[x,,z,,scale,variant]=layout.placements.subarray(at,at+6),p=prototypes[variant];if(p.shrub)continue;
  const cx=(x-minX)/width*size-.5,cz=(z-minZ)/depth*size-.5;
  const sourceRx=p.canopyRadius*scale/width*size,sourceRz=p.canopyRadius*scale/depth*size;
  const rx=Math.max(.8,sourceRx),rz=Math.max(.8,sourceRz);
  // Keep sub-pixel crowns sampleable without turning every small tree into
  // a full-strength, several-pixel litter patch. Conserve projected canopy
  // area when the raster support is wider than the source crown.
  const coverage=Math.min(1,sourceRx*sourceRz/(rx*rz));
  for(let iz=Math.max(0,Math.floor(cz-rz));iz<=Math.min(size-1,Math.ceil(cz+rz));iz++)for(let ix=Math.max(0,Math.floor(cx-rx));ix<=Math.min(size-1,Math.ceil(cx+rx));ix++){
   const d=Math.hypot((ix-cx)/rx,(iz-cz)/rz);if(d<1.2)field[iz*size+ix]+=Math.max(0,1-d/1.2)*.85*coverage;
  }
 }
 for(let z=0;z<size;z++)for(let x=0;x<size;x++){const px=minX+(x+.5)/size*width,pz=minZ+(z+.5)/size*depth;data[z*size+x]=px>s.minX-.5&&px<s.maxX+.5&&pz>s.minZ-.5&&pz<s.maxZ+.5?0:Math.round(Math.min(1,field[z*size+x])*255);}
 return{data,size,bounds:[minX,minZ,width,depth] as const};
}
