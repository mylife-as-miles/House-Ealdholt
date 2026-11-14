import { stageReflectionPixels } from '../../../shared/showcase/stage-reflections';
import { applyStageSurface, createStageSurface, updateStageSurface } from '../../../shared/showcase/stage-surface';
import * as THREE from 'three';
import type { ShowcaseFrame } from '../../../shared/showcase/types';
import { buildStageBlueprint } from '../../../shared/showcase/stage-data';
import type { StageGeometry, StageQuality, StageView } from '../../../shared/showcase/stage-data';
import { StageGraph } from '../../../shared/showcase/stage-graph';
import { stageParticlePositions, STAGE_PARTICLE_VERTEX, STAGE_PARTICLE_FRAGMENT } from '../../../shared/showcase/stage-particles';
import { nextRenderTimestamp, normalizeFrameLimit, scaledPixelRatio } from '../effects/render-controls';
export interface ShowcaseStagePreferences {quality:StageQuality;renderScale:number;frameLimit:0|30|60|120;reducedMotion:boolean;}
export interface ShowcaseStageOptions extends ShowcaseStagePreferences {onFailure?:()=>void;}
function geometry(data:StageGeometry):THREE.BufferGeometry {
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(new Float32Array(data.positions),3));g.setAttribute('normal',new THREE.BufferAttribute(new Float32Array(data.normals),3));
  const values=new Float32Array(data.colors);for(let i=0;i<values.length;i++){const c=values[i];values[i]=c<=.04045?c/12.92:Math.pow((c+.055)/1.055,2.4);}
  g.setAttribute('color',new THREE.BufferAttribute(values,3));g.setIndex(data.indices);g.computeBoundingSphere();return g;
}
function createModel(quality:StageQuality){
  const root=new THREE.Group(),backdrop=new THREE.Group();root.add(backdrop);
  const reflection=new THREE.DataTexture(stageReflectionPixels(),128,64,THREE.RGBAFormat,THREE.UnsignedByteType);reflection.mapping=THREE.EquirectangularReflectionMapping;reflection.colorSpace=THREE.SRGBColorSpace;reflection.needsUpdate=true;
  const blueprint=buildStageBlueprint(quality),surface=createStageSurface();
  const geometries=new Map(Object.entries(blueprint.geometries).map(([key,value])=>[key,geometry(value)]));
  const materials=new Map(Object.entries(blueprint.materials).map(([key,value])=>[key,new THREE.MeshStandardMaterial({
    envMap:reflection,envMapIntensity:.62,color:value.color,metalness:value.metalness,roughness:value.roughness,emissive:value.emissive??0,emissiveIntensity:.45,vertexColors:true,
    transparent:value.opacity!==undefined,opacity:value.opacity??1,depthWrite:value.opacity===undefined,
  })]));
  for(const [key,material] of materials){material.onBeforeCompile=shader=>applyStageSurface(shader,key,surface);material.customProgramCacheKey=()=>`crownfall-stage-surface-v1-${key}`;}
  const graph=new StageGraph({add(key,material,name,isBackdrop){const mesh=new THREE.Mesh(geometries.get(key)!,materials.get(material)!);mesh.name=name;mesh.userData.showcaseBackdrop=!!isBackdrop;(isBackdrop?backdrop:root).add(mesh);return mesh;},remove(node){(node as THREE.Mesh).removeFromParent();},geometry(node,key){(node as THREE.Mesh).geometry=geometries.get(key)!;}},quality,blueprint);
  updateStageSurface(surface,graph.motion.actors);
  const pg=new THREE.BufferGeometry();pg.setAttribute('position',new THREE.BufferAttribute(stageParticlePositions(quality),3));
  const pm=new THREE.ShaderMaterial({uniforms:{uTime:{value:0}},vertexShader:STAGE_PARTICLE_VERTEX,fragmentShader:STAGE_PARTICLE_FRAGMENT,transparent:true,depthWrite:false,blending:THREE.AdditiveBlending});
  const particles=new THREE.Points(pg,pm);root.add(particles);
  return {root,graph,update(delta:number,reduced:boolean){graph.update(delta);updateStageSurface(surface,graph.motion.actors);particles.visible=!reduced&&quality!=='low';pm.uniforms.uTime.value=graph.motion.time;},
    dispose(){graph.dispose();root.removeFromParent();for(const g of geometries.values())g.dispose();for(const m of materials.values())m.dispose();pg.dispose();pm.dispose();reflection.dispose();root.clear();}};
}
export function createShowcaseStage(host:HTMLElement,options:ShowcaseStageOptions){
  let preferences={...options},disposed=false,paused=false,failed=false,frame:ShowcaseFrame|null=null,arena=0,view:StageView='cinematic';
  const renderer=new THREE.WebGLRenderer({alpha:true,antialias:options.quality!=='low',powerPreference:'low-power'});
  renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.05;
  renderer.setClearColor(0x0a1419,1);renderer.domElement.style.width='100%';renderer.domElement.style.height='100%';renderer.domElement.setAttribute('aria-hidden','true');host.appendChild(renderer.domElement);
  const scene=new THREE.Scene();scene.fog=new THREE.FogExp2(0x0a1419,.16);
  const camera=new THREE.PerspectiveCamera(36,1,.03,20),target=new THREE.Vector3(0,.10,-.04);
  scene.add(new THREE.HemisphereLight(0xb7d6d0,0x322820,1.5));
  const key=new THREE.DirectionalLight(0xffddb1,3.4);key.position.set(-.7,1.4,.7);scene.add(key);
  const rim=new THREE.DirectionalLight(0x7fc7cc,2.3);rim.position.set(.7,.9,-.8);scene.add(rim);
  let model=createModel(preferences.quality);scene.add(model.root);model.graph.setReducedMotion(preferences.reducedMotion);
  const setCamera=()=>{
    camera.clearViewOffset();camera.fov=36;
    if(view==='board'){camera.position.set(0,1.75,.20);target.set(0,.02,-.02);}
    else if(view==='side'){camera.position.set(1.30,.82,.82);target.set(0,.055,-.02);}
    else{camera.position.set(.86,.78,1.20);target.set(0,.055,-.05);}
    camera.lookAt(target);camera.updateMatrixWorld();camera.updateProjectionMatrix();model.root.updateMatrixWorld(true);
    // One deterministic fit on view/resize, never an animated camera or per-frame search.
    let left=Infinity,right=-Infinity,bottom=Infinity,top=-Infinity;const point=new THREE.Vector3();
    model.root.traverse(object=>{if(!(object instanceof THREE.Mesh)||!object.visible||object.userData.showcaseBackdrop)return;const position=object.geometry.getAttribute('position');for(let i=0;i<position.count;i++){
      point.fromBufferAttribute(position,i).applyMatrix4(object.matrixWorld).project(camera);left=Math.min(left,point.x);right=Math.max(right,point.x);bottom=Math.min(bottom,point.y);top=Math.max(top,point.y);
    }});
    if(Number.isFinite(left)){
      const fit=Math.max((right-left)/(2*.92),(top-bottom)/(2*.87));camera.fov=THREE.MathUtils.radToDeg(2*Math.atan(Math.tan(THREE.MathUtils.degToRad(36)/2)*fit));camera.updateProjectionMatrix();
      const width=Math.max(1,host.clientWidth),height=Math.max(1,host.clientHeight);camera.setViewOffset(width,height,(left+right)/fit*width/4,-(top+bottom)/fit*height/4,width,height);
    }
  };
  const resize=()=>{if(disposed)return;const width=Math.max(1,host.clientWidth),height=Math.max(1,host.clientHeight);renderer.setPixelRatio(scaledPixelRatio(window.devicePixelRatio,preferences.renderScale));renderer.setSize(width,height,false);camera.aspect=width/height;camera.updateProjectionMatrix();setCamera();};
  const observer=new ResizeObserver(resize);observer.observe(host);resize();
  let raf=0,last=performance.now(),rendered=0;
  const tick=(now:number)=>{if(disposed)return;raf=requestAnimationFrame(tick);const delta=Math.min(.1,(now-last)/1000);last=now;if(paused||failed)return;const next=nextRenderTimestamp(now,rendered,normalizeFrameLimit(preferences.frameLimit));if(next===null)return;const elapsed=(now-rendered)/1000;rendered=next;model.update(Math.min(.1,Math.max(delta,elapsed)),preferences.reducedMotion);renderer.render(scene,camera);};
  const contextLost=(event:Event)=>{event.preventDefault();if(!failed){failed=true;options.onFailure?.();}};renderer.domElement.addEventListener('webglcontextlost',contextLost);
  raf=requestAnimationFrame(tick);
  return {
    setFrame(value:ShowcaseFrame|null){if(!disposed){frame=value;model.graph.setFrame(value);}},
    setArena(value:number){if(!disposed){arena=value;model.graph.setArena(value);setCamera();}},
    setView(value:StageView){if(!disposed){view=value;setCamera();}},
    setPreferences(value:Partial<ShowcaseStagePreferences>){
      if(disposed)return;const oldQuality=preferences.quality;preferences={...preferences,...value};
      if(preferences.quality!==oldQuality){model.dispose();model=createModel(preferences.quality);scene.add(model.root);model.graph.setFrame(frame);model.graph.setArena(arena);}
      model.graph.setReducedMotion(preferences.reducedMotion);model.graph.setPaused(paused);model.update(0,preferences.reducedMotion);resize();
    },
    setPaused(value:boolean){paused=value;model.graph.setPaused(value);last=performance.now();rendered=last;},
    getStats(){const stats=model.graph.getStats();return {...stats,draws:stats.draws+(!preferences.reducedMotion&&preferences.quality!=='low'?1:0),particles:preferences.reducedMotion||preferences.quality==='low'?0:preferences.quality==='high'?56:28,rendererCalls:renderer.info.render.calls,rendererTriangles:renderer.info.render.triangles,paused,contextLost:failed,pixelRatio:renderer.getPixelRatio(),view};},
    dispose(){if(disposed)return;disposed=true;cancelAnimationFrame(raf);observer.disconnect();renderer.domElement.removeEventListener('webglcontextlost',contextLost);model.dispose();renderer.dispose();renderer.forceContextLoss();renderer.domElement.remove();scene.clear();},
  };
}
