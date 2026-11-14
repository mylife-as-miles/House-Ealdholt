import {AdditiveBlending,BufferAttribute,BufferGeometry,Color,DynamicDrawUsage,Group,NormalBlending,Points,ShaderMaterial,Sphere,Vector3,Vector4,type Object3D} from 'three';
import {clampGardenUnit,createGardenParticlePool,gardenSmooth,GARDEN_PARTICLE_SOURCE,type GardenLifeFrame} from '../../../../shared/legacy/aethelgard/environment/garden-particles';
export {createGardenSoundscape} from '../../../../shared/legacy/aethelgard/environment/garden-soundscape';
export type {GardenSoundscapeFrame} from '../../../../shared/legacy/aethelgard/environment/garden-soundscape';
export type EaldholtGardenLifeFrame = GardenLifeFrame;

/** MIT port of Solstice's garden emitters, copyright (c) 2026 SamG-Coder.
 * Pinned 03f0aef9c0f032105c973b97005a482e639032f2:
 * crates/solstice-render/particles/{motes,fireflies}.particles and
 * crates/solstice-render/shaders/particles/draw.wgsl (blob, camera fade).
 * Full notice: shared/legacy/aethelgard/environment/LICENSE.solstice.txt.
 * A fixed pool, existing source transform and clock replace its GPU scheduler.
 * Individual particle lighting and soft scene-depth sampling are omitted.
 */
export function createEaldholtGardenLife(root:Object3D,options:{anchor:readonly[number,number,number];native?:boolean}) {
  const object=new Group();object.name='Ealdholt Solstice garden life';object.position.set(...options.anchor);object.visible=false;
  object.userData.crownfallGardenLife={source:GARDEN_PARTICLE_SOURCE,sourceRoot:root.uuid,anchor:[...options.anchor]};
  const viewport=new Vector4(),moteCount=options.native?28:64,fireflyCount=options.native?20:40;
  let seed=0x51c57ace;for(const value of options.anchor)seed=Math.imul(seed^Math.round(value*1000),16777619);
  const stats={source:GARDEN_PARTICLE_SOURCE,status:'awaiting-frame',capacity:moteCount+fireflyCount,motes:0,fireflies:0,moteOpacity:0,fireflyOpacity:0,animationSeconds:0,needsAnimation:false,drawCalls:0,disposed:false};
  function make(kind:'motes'|'fireflies',count:number) {
    const firefly=kind==='fireflies',pool=createGardenParticlePool(kind,count,seed^(firefly?0x89abdef:0x421ab3));
    const geometry=new BufferGeometry(),position=new BufferAttribute(pool.positions,3).setUsage(DynamicDrawUsage),alpha=new BufferAttribute(pool.alpha,1).setUsage(DynamicDrawUsage);
    geometry.setAttribute('position',position);geometry.setAttribute('gardenSize',new BufferAttribute(pool.sizes,1));geometry.setAttribute('gardenAlpha',alpha);
    // Include source-space movement without expanding the village's authored bounds.
    geometry.boundingSphere=new Sphere(new Vector3(0,3,0),44);
    const material=new ShaderMaterial({transparent:true,depthWrite:false,depthTest:true,toneMapped:true,
      blending:firefly?AdditiveBlending:NormalBlending,
      uniforms:{gardenOpacity:{value:0},gardenColour:{value:new Color().setRGB(firefly?.72:1,firefly?1:.96,firefly?.22:.84)},gardenViewport:{value:1},gardenBrightness:{value:firefly?.6:1}},
      vertexShader:`attribute float gardenSize;attribute float gardenAlpha;
        uniform float gardenViewport;varying float lifeAlpha;varying float nearFade;
        void main(){vec4 eye=modelViewMatrix*vec4(position,1.);
          float scale=length(modelViewMatrix[0].xyz);
          gl_PointSize=clamp(2.*gardenSize*scale*projectionMatrix[1][1]*gardenViewport/max(.001,-eye.z),1.,12.);
          gl_Position=projectionMatrix*eye;lifeAlpha=gardenAlpha;
          nearFade=clamp((-eye.z-.01)/max(2.*gardenSize*scale,.2*scale),0.,1.);
        }`,
      fragmentShader:`uniform float gardenOpacity;uniform float gardenBrightness;uniform vec3 gardenColour;
        varying float lifeAlpha;varying float nearFade;
        void main(){vec2 corner=gl_PointCoord*2.-1.;
          float shape=max(1.-dot(corner,corner),0.);shape*=shape;
          float alpha=clamp(lifeAlpha*shape*nearFade*gardenOpacity,0.,1.);
          if(alpha<.001)discard;gl_FragColor=vec4(gardenColour*gardenBrightness,alpha);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`});
    const points=new Points(geometry,material);points.name='Ealdholt garden '+kind;points.castShadow=false;points.receiveShadow=false;points.visible=false;
    points.userData.iwsdkPreviewBounds='exclude';points.userData.crownfallGardenLife=true;
    points.onBeforeRender=renderer=>{renderer.getCurrentViewport(viewport);material.uniforms.gardenViewport.value=Math.max(1,viewport.w);};
    object.add(points);
    return {pool,points,material,geometry,position,alpha};
  }
  // Caller owns parenting so the native adapter can attach to its established
  // miniature source frame without a transient scene-space placement.
  const motes=make('motes',moteCount),fireflies=make('fireflies',fireflyCount);
  return {object,stats,
    update(frame:EaldholtGardenLifeFrame) {
      if(stats.disposed)return false;
      const active=frame.active!==false&&!frame.reducedMotion,day=clampGardenUnit(frame.daylight),rain=clampGardenUnit(frame.rain??0),calm=1-gardenSmooth(.25,.65,clampGardenUnit(frame.windStrength));
      stats.moteOpacity=active?gardenSmooth(.35,.75,day)*(1-gardenSmooth(.02,.3,rain))*calm*.65:0;
      stats.fireflyOpacity=active?(1-gardenSmooth(.08,.42,day))*(1-gardenSmooth(.1,.6,rain)):0;
      motes.material.uniforms.gardenOpacity.value=stats.moteOpacity;fireflies.material.uniforms.gardenOpacity.value=stats.fireflyOpacity;
      motes.points.visible=stats.moteOpacity>.002;fireflies.points.visible=stats.fireflyOpacity>.002;object.visible=motes.points.visible||fireflies.points.visible;
      const moving=active&&frame.paused!==true;
      motes.pool.update(frame,moving&&motes.points.visible);fireflies.pool.update(frame,moving&&fireflies.points.visible);
      if(motes.points.visible){motes.position.needsUpdate=true;motes.alpha.needsUpdate=true;}
      if(fireflies.points.visible){fireflies.position.needsUpdate=true;fireflies.alpha.needsUpdate=true;}
      stats.motes=motes.points.visible?moteCount:0;stats.fireflies=fireflies.points.visible?fireflyCount:0;
      stats.drawCalls=Number(motes.points.visible)+Number(fireflies.points.visible);stats.needsAnimation=moving&&object.visible;
      stats.animationSeconds=Number.isFinite(frame.animationSeconds)?frame.animationSeconds:0;
      stats.status=!active?'inactive':frame.paused?'paused':object.visible?'active':'weather-held';
      return stats.needsAnimation;
    },
    dispose() {
      if(stats.disposed)return;stats.disposed=true;stats.status='disposed';stats.needsAnimation=false;stats.motes=stats.fireflies=stats.drawCalls=0;
      object.visible=false;object.removeFromParent();
      for(const layer of [motes,fireflies]){layer.points.onBeforeRender=()=>{};layer.geometry.dispose();layer.material.dispose();}
      object.clear();
    }
  };
}
