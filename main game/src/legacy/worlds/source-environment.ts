import * as T from 'three';
import type { DesktopLegacyEnvironment,DesktopLegacyEnvironmentOptions,DesktopEnvironmentQuality } from '../environment-contract';
import type { LandmarkId } from '../../../../shared/legacy/types';
import type { LegacySceneState,LandmarkDescriptor } from '../../../../shared/legacy/environment-contract';
import { LEGACY_COPY } from '../../../../shared/legacy/content/copy';
import { buildSourceWorld } from '../../../../shared/legacy/worlds';
import type { SourceWorld } from '../../../../shared/legacy/worlds';
import { dressWorld,disposeSourceTree } from '../../../../shared/legacy/worlds/dressing.js';
import type { WorldDressing } from '../../../../shared/legacy/worlds/dressing.js';
import { WORLD_KINGDOM_STYLE } from '../../../../shared/legacy/worlds/crownfall';
import { CameraRig } from '../environment/cameraRig';
import { LandmarkPicker } from '../environment/picking';
import type { LandmarkBuild } from '../../../../shared/legacy/environment/build/buildBannerhold';
import type { CameraFraming } from '../../../../shared/legacy/environment/blueprint/types';
import { SceneExplorationController } from '../../../../shared/legacy/exploration/controller';
import { SettlementEnvironmentController } from '../../../../shared/legacy/environment/settlement/controller';
import type { SettlementSnapshot,SettlementTool } from '../../../../shared/legacy/settlement/contract';
import type { LegacyExplorationSnapshot, ExplorationPoint } from '../../../../shared/legacy/exploration/contract';
import { createExplorationFigure } from '../../../../shared/legacy/exploration/figures.js';
import { FramePacing } from '../frame-pacing';
import { ShadowRefresh } from '../shadow-refresh';

/** Source worlds build their geometry for one profile at creation; Low uses the lighter Quest profile. */
export function sourceGeometryProfile(preset:DesktopEnvironmentQuality['preset']):'desktop'|'quest'{return preset==='low'?'quest':'desktop';}

/** The actual source world is the environment. No Bannerhold settlement is built here. */
export class SourceDesktopEnvironment implements DesktopLegacyEnvironment {
  private shaderFailure:string|null=null;private renderer:T.WebGLRenderer;private environmentMap:T.WebGLRenderTarget|null=null;
  private scene=new T.Scene();private staging=new T.Scene();private rig=new CameraRig(1);
  private asset:SourceWorld|null=null;private dressing:WorldDressing|null=null;
  private picker:LandmarkPicker|null=null;private markers=new Map<LandmarkId,T.Mesh>();
  private quality:DesktopEnvironmentQuality;private state:LegacySceneState;private reduced:boolean;
  private paused=false;private disposed=false;private dirty=true;private frame=0;private last=0;private time=0;private rendered=0;
  private width=1;private height=1;private sized='';private observer:ResizeObserver|null=null;
  /** Intervals between frames rendered back to back, for the automatic step-down; JS submission is kept beside them. */
  private pacing=new FramePacing();
  /** The shadow map is redrawn at most every other rendered frame, and a skipped redraw is always made up. */
  private shadows=new ShadowRefresh();private sun:T.DirectionalLight|null=null;private contextLost=false;
  private framing='establishing';private geometryProfile:'desktop'|'quest';
  /** Renderer counts of the last rendered frame, across every pass. */
  private frameCounts={calls:0,triangles:0,shadow:{calls:0,triangles:0},offscreen:{calls:0,triangles:0}};
  private hover:LandmarkId|null=null;private focus:LandmarkId|null=null;
  private pointer={down:false,x:0,y:0,moved:0,id:0,pan:false};
  private point=new T.Vector3();private identity=new T.Matrix4();
  private exploration:SceneExplorationController;
  private estate:SettlementEnvironmentController;
  private explorer:ReturnType<typeof createExplorationFigure<typeof T>>|null=null;
  private routeHints:T.LineSegments|null=null;private groundRay=new T.Raycaster();
  private buildStarted=0;
  private progressLabel='';private progressAt=0;
  private progress(label:string){const now=performance.now();if(label===this.progressLabel&&now-this.progressAt<5000)return;this.progressLabel=label;this.progressAt=now;if(new URLSearchParams(location.search).has('legacyStats'))console.info('[Legacy source]',this.o.layout,label,Math.round(now-this.buildStarted)+'ms');}
  constructor(private o:DesktopLegacyEnvironmentOptions){
    this.exploration=new SceneExplorationController(o.state);this.estate=new SettlementEnvironmentController(o.state,o.layout??'bannerhold',null);
    this.quality={...o.quality};this.state=o.state;this.reduced=o.reducedMotion;this.hover=o.highlight??null;this.geometryProfile=sourceGeometryProfile(this.quality.preset);
    this.renderer=new T.WebGLRenderer({antialias:true,powerPreference:'high-performance'});
    this.renderer.debug.onShaderError=(gl,program,vertex,fragment)=>{this.shaderFailure=[gl.getProgramInfoLog(program),gl.getShaderInfoLog(vertex),gl.getShaderInfoLog(fragment)].filter(Boolean).join('\n');console.error('Crownfall source shader:',this.shaderFailure);};
    this.renderer.outputColorSpace=T.SRGBColorSpace;this.renderer.toneMapping=T.ACESFilmicToneMapping;
    this.renderer.shadowMap.type=T.PCFSoftShadowMap;this.renderer.shadowMap.enabled=this.quality.preset!=='low';
    this.renderer.domElement.style.cssText='display:block;width:100%;height:100%;touch-action:none;outline:none';
    this.renderer.domElement.tabIndex=0;this.renderer.domElement.setAttribute('aria-label','Crownfall environment');
    o.container.append(this.renderer.domElement);this.rig.reducedMotion=this.reduced;this.measurePasses();this.resize();
    this.renderer.domElement.addEventListener('webglcontextlost',this.lost);
  }
  /** The profile this world's geometry was built for; a preset that needs the other one needs a new world. */
  get geometry():'desktop'|'quest'{return this.geometryProfile;}
  /** Three's automatic reset discards everything before a nested render, such as a planar mirror. The adapter owns the reset so a frame reports all of its passes. */
  private measurePasses(){
    const r=this.renderer,counts=r.info.render,shadowMap=r.shadowMap,drawShadows=shadowMap.render,draw=r.render;r.info.autoReset=false;
    const add=(to:{calls:number;triangles:number},calls:number,triangles:number)=>{to.calls+=counts.calls-calls;to.triangles+=counts.triangles-triangles;};
    shadowMap.render=(lights,scene,camera)=>{const calls=counts.calls,triangles=counts.triangles;drawShadows.call(shadowMap,lights,scene,camera);add(this.frameCounts.shadow,calls,triangles);};
    r.render=(scene,camera)=>{const offscreen=r.getRenderTarget()!==null,calls=counts.calls,triangles=counts.triangles;draw.call(r,scene,camera);if(offscreen)add(this.frameCounts.offscreen,calls,triangles);};
  }
  async init(){
    this.buildStarted=performance.now();this.progress('build started');
    const layout=this.o.layout;if(!layout||layout==='bannerhold')throw Error('A source environment must be selected.');
    this.staging.fog=new T.FogExp2('#b9c9d1',.00012);
    try{
      this.asset=await buildSourceWorld(layout,{THREE:T,renderer:this.renderer,scene:this.staging,camera:this.rig.camera,profile:this.geometryProfile,nationId:this.state.nationId,onProgress:label=>{if(this.disposed)throw Error('Environment creation cancelled');this.progress(label??'building');}});
      this.progress('geometry and navigation built');
      this.progress(`navigation ready: ${this.asset.exploration?.graph.nodes.length??0} nodes / ${this.asset.exploration?.graph.edges.length??0} edges / ${Object.keys(this.asset.exploration?.fastTravel??{}).length} hubs`);
      if(this.disposed){this.releaseAsset();return;}
      const root=this.asset.root as T.Object3D;
      if(!(root instanceof T.Object3D))throw Error('Source world uses a different Three runtime');
      this.scene.add(root);
      const sourceScene=root as T.Scene, lighting=this.asset.lighting;
      this.scene.background=sourceScene.background??new T.Color(lighting?.skyColor??'#aebfca');
      this.scene.fog=sourceScene.fog??new T.FogExp2(lighting?.skyColor??'#aebfca',1/Math.max(1200,this.asset.extent.width*3));
      let ambient=false,directional=false;
      root.traverse(x=>{if(!(x as T.Light).isLight || (x as T.Light).intensity<=0)return;if((x as T.HemisphereLight).isHemisphereLight||(x as T.AmbientLight).isAmbientLight)ambient=true;if((x as T.DirectionalLight).isDirectionalLight)directional=true;});
      if(!ambient)this.scene.add(new T.HemisphereLight(lighting?.skyColor??'#c4d4df',lighting?.groundColor??'#485144',2.2));
      if(!directional){
        const sun=new T.DirectionalLight(lighting?.sunColor??'#fff1d4',lighting?.sunIntensity??3.2);
        const d=lighting?.sunDirection??[-.4,1,.5];sun.target.position.fromArray(this.asset.view.target);sun.position.fromArray(d).normalize().multiplyScalar(400).add(sun.target.position);this.sun=sun;this.applySunShadow();const r=Math.max(40,Math.min(200,this.asset.extent.width*.65));Object.assign(sun.shadow.camera,{left:-r,right:r,top:r,bottom:-r,near:.1,far:Math.max(1000,r*8)});sun.shadow.camera.updateProjectionMatrix();sun.shadow.bias=-.00015;sun.shadow.normalBias=.025;this.scene.add(sun,sun.target);
      }
      this.renderer.toneMappingExposure=lighting?.exposure??1.15;
      const skyScene=new T.Scene();skyScene.background=this.scene.background;
      root.traverse(o=>{if((o as T.Mesh).isMesh&&/sky/i.test(o.name)&&o.children.length===0)skyScene.add(o.clone());});
      if(skyScene.children.length){
        this.progress('lighting environment map');
        const pmrem=new T.PMREMGenerator(this.renderer);
        try{this.environmentMap=pmrem.fromScene(skyScene,.03,.1,Math.max(14000,this.asset.extent.width*5),{size:128});this.scene.environment=this.environmentMap.texture;this.scene.environmentIntensity=1;}finally{pmrem.dispose();skyScene.clear();}
      }
      this.dressing=dressWorld(T,this.asset,this.state);
      const routes=this.asset.exploration??null;this.exploration.configure(this.state,routes);
      if(routes){
        this.explorer=createExplorationFigure(T,{atlas:this.dressing.texture});root.add(this.explorer.root);
        const nodes=new Map(routes.graph.nodes.map(node=>[node.id,node.position]));
        const positions=routes.graph.edges.flatMap(edge=>{const a=nodes.get(edge.from)!,b=nodes.get(edge.to)!;return[a.x,a.y+.05,a.z,b.x,b.y+.05,b.z];});
        const geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.Float32BufferAttribute(positions,3));
        this.routeHints=new T.LineSegments(geometry,new T.LineBasicMaterial({color:'#c29c58',transparent:true,opacity:.3,depthWrite:false}));this.routeHints.visible=false;root.add(this.routeHints);
        this.rig.setCollisionWorld(routes.cameraColliders??[],routes.sampleGround);
      }
      const view=this.asset.view;
      this.rig.setPanBounds({minX:this.asset.extent.center[0]-this.asset.extent.width/2,maxX:this.asset.extent.center[0]+this.asset.extent.width/2,minZ:this.asset.extent.center[2]-this.asset.extent.depth/2,maxZ:this.asset.extent.center[2]+this.asset.extent.depth/2});
      this.rig.camera.far=Math.max(14000,this.asset.extent.width*5);this.rig.camera.near=.1;
      const make=(id:CameraFraming['id'],position:readonly[number,number,number],target:readonly[number,number,number],fov=view.fov):CameraFraming=>({id,label:id,position,target,fovDeg:fov,orbit:{yawDeg:[-40,40],pitchDeg:[2,65],distance:[Math.max(3,new T.Vector3().fromArray(position).distanceTo(new T.Vector3().fromArray(target))*.45),Math.max(12,new T.Vector3().fromArray(position).distanceTo(new T.Vector3().fromArray(target))*1.8)]},composition:'Source world framing',transitionSeconds:1.2});
      this.rig.addFraming(make('establishing',view.position,view.target));
      this.rig.addFraming(make('founding',view.position,view.target));
      const direction=new T.Vector3().fromArray(view.position).sub(new T.Vector3().fromArray(view.target)).normalize();
      const builds:LandmarkBuild[]=[];
      for(const l of this.asset.landmarks){
        const p=new T.Vector3().fromArray(l.position),distance=Math.max(12,Math.min(300,this.asset.extent.width*.075));
        const eye=p.clone().addScaledVector(direction,distance);eye.y=Math.max(eye.y,p.y+distance*.25);
        this.rig.addFraming(make(`landmark:${l.id}`,eye.toArray(),l.position,45));
        const radius=Math.max(3,this.asset.extent.width*.012);
        builds.push({id:l.id,label:LEGACY_COPY.landmarks[l.id].title,anchor:l.position,pickCenter:l.position,pickRadius:radius,cameraId:`landmark:${l.id}`,bounds:{min:[p.x-radius,p.y-radius,p.z-radius],max:[p.x+radius,p.y+radius,p.z+radius]}});
        const marker=new T.Mesh(new T.RingGeometry(radius*.8,radius,48),new T.MeshBasicMaterial({color:'#efa844',side:T.DoubleSide,transparent:true,opacity:.8,depthWrite:false}));marker.rotation.x=-Math.PI/2;marker.position.copy(p);marker.visible=false;this.scene.add(marker);this.markers.set(l.id,marker);
      }
      const representative=this.asset.landmarks.find(l=>l.id==='muster-grounds')!;
      const p=new T.Vector3().fromArray(representative.position);const e=p.clone().addScaledVector(direction,Math.max(9,this.asset.extent.width*.02));e.y+=3;this.rig.addFraming(make('representative',e.toArray(),p.toArray(),42));
      this.picker=new LandmarkPicker([],builds);this.rig.focus('establishing',true);this.applyState();
      // From the first frame on the shadow map is redrawn only when shadows.frame() asks for it.
      this.renderer.shadowMap.autoUpdate=false;this.shadows.invalidate();
      this.bind();this.resize();this.refresh();this.progress('first draw started');this.render(0);this.progress('first draw complete');this.dirty=this.rig.transitioning;if(this.shaderFailure)throw Error('Source world shader compilation failed: '+this.shaderFailure);this.o.onReady?.();this.frame=requestAnimationFrame(this.tick);
    }catch(e){this.releaseAsset();disposeSourceTree(this.staging);throw e;}
  }
  private releaseAsset(){this.explorer?.dispose();this.explorer=null;if(this.routeHints){this.routeHints.removeFromParent();this.routeHints.geometry.dispose();(this.routeHints.material as T.Material).dispose();this.routeHints=null;}this.dressing?.dispose();this.dressing=null;if(this.asset){this.asset.dispose?.();disposeSourceTree(this.asset.root);this.asset=null;}}
  private render(delta:number){
    if(!this.asset)return;const counts=this.renderer.info.render,frame=this.frameCounts;this.renderer.info.reset();frame.shadow.calls=frame.shadow.triangles=frame.offscreen.calls=frame.offscreen.triangles=0;
    this.exploration.update(delta);const exploration=this.exploration.getSnapshot();this.explorer?.update(exploration,delta,this.reduced);if(this.routeHints)this.routeHints.visible=exploration.enabled&&exploration.available;
    this.rig.apply(delta,this.reduced);if(!this.reduced)this.time+=delta;this.asset.setSourceTransform?.(this.identity,this.rig.camera.position);this.asset.update?.(this.time,this.reduced?0:delta);
    this.dressing?.update(this.time,!this.reduced);
    // A frame is drawn only when something changed or animates, so any rendered frame may have moved a caster.
    if(this.renderer.shadowMap.enabled&&this.shadows.frame(true))this.renderer.shadowMap.needsUpdate=true;
    this.renderer.render(this.scene,this.rig.camera);
    frame.calls=counts.calls;frame.triangles=counts.triangles;
  }
  // Paused, hidden and idle (reduced-motion, nothing changed) frames interrupt the pacing run; frame-limit skips do not.
  private tick=(now:number)=>{if(this.disposed)return;this.frame=requestAnimationFrame(this.tick);if(this.paused||document.hidden||this.contextLost){this.last=0;this.pacing.interrupt();return;}if(this.reduced&&!this.dirty&&this.exploration.getSnapshot().status!=='moving'){this.pacing.interrupt();return;}if(this.quality.frameLimit&&now-this.rendered<1000/this.quality.frameLimit-1)return;const dt=this.last?Math.min(.05,(now-this.last)/1000):0;this.last=now;const t=performance.now();this.render(dt);this.dirty=this.rig.transitioning||(this.renderer.shadowMap.enabled&&this.shadows.owed);this.rendered=now;this.pacing.rendered(now,performance.now()-t);};
  private lost=(event:Event)=>{event.preventDefault();if(this.contextLost||this.disposed)return;this.contextLost=true;this.pacing.interrupt();const error=new Error('The graphics context was lost.');if(this.o.onError)this.o.onError(error);else console.warn(`My Legacy: the ${this.o.layout} environment stopped (${error.message}).`);};
  setState(state:LegacySceneState){const changed=state!==this.state&&JSON.stringify(state)!==JSON.stringify(this.state);this.state=state;this.exploration.setState(state);this.estate.setState(state);if(!changed)return;this.dirty=true;this.shadows.invalidate();this.applyState();}
  getSettlementSnapshot(){return this.estate.getSettlementSnapshot();}
  subscribeSettlement(listener:(snapshot:SettlementSnapshot)=>void){return this.estate.subscribeSettlement(listener);}
  setSettlementTool(tool:SettlementTool|null){return this.estate.setSettlementTool(tool);}
  setSettlementCursor(x:number,z:number){return this.estate.setSettlementCursor(x,z);}
  moveSettlementCursor(dx:number,dz:number){return this.estate.moveSettlementCursor(dx,dz);}
  rotateSettlementPreview(){return this.estate.rotateSettlementPreview();}
  commitSettlementPlacement(){return this.estate.commitSettlementPlacement();}
  cancelSettlementPlacement(){this.estate.cancelSettlementPlacement();}
  selectSettlementPlacement(id:string|null){return this.estate.selectSettlementPlacement(id);}
  deleteSettlementPlacement(id?:string){return this.estate.deleteSettlementPlacement(id);}
  getExplorationSnapshot(){return this.exploration.getSnapshot();}
  setExplorationMember(id:string){const before=this.exploration.getSnapshot().location;this.dirty=true;const changed=this.exploration.setMember(id),after=this.exploration.getSnapshot().location;if(changed&&before&&after&&Math.hypot(before.x-after.x,before.y-after.y,before.z-after.z)>80)this.rig.frameTarget(after,true);return changed;}
  travelToLandmark(id:LandmarkId){this.dirty=true;return this.exploration.travel(id);}
  moveToPoint(point:ExplorationPoint){this.dirty=true;return this.exploration.moveToPoint(point);}
  fastTravelToLandmark(id:LandmarkId){const moved=this.exploration.fastTravel(id);if(moved){this.dirty=true;const p=this.exploration.getSnapshot().location;if(p)this.rig.frameTarget(p,true);}return moved;}
  cancelTravel(){this.exploration.cancel();}
  setExplorationEnabled(enabled:boolean){this.dirty=true;this.exploration.setEnabled(enabled);}
  subscribeExploration(listener:(snapshot:LegacyExplorationSnapshot)=>void){return this.exploration.subscribe(listener);}
  private applyState(){this.dressing?.setState(this.state);const style=WORLD_KINGDOM_STYLE[this.state.nationId];this.scene.traverse(o=>{if((o as T.HemisphereLight).isHemisphereLight)(o as T.HemisphereLight).groundColor.set(style.ground);});}
  getLandmarks():LandmarkDescriptor[]{return this.asset?.landmarks.map(l=>({id:l.id,label:LEGACY_COPY.landmarks[l.id].title,position:l.position}))??[];}
  focusLandmark(id:LandmarkId|null){this.focus=id;this.refresh();}
  private frameOn(framing:string){if(framing===this.framing)return;this.framing=framing;this.dirty=true;this.rig.focus(framing,this.reduced);}
  highlightLandmark(id:LandmarkId|null){this.hover=id;this.refresh();}
  private refresh(){for(const[id,m]of this.markers){const visible=id===this.hover||id===this.focus;if(m.visible!==visible){m.visible=visible;this.dirty=true;}}}
  projectLandmark(id:LandmarkId){const i=this.asset?.landmarks.findIndex(l=>l.id===id)??-1;if(i<0)return null;const index=['banner-hall','muster-grounds','war-record','heralds-station'].indexOf(id);return{x:this.width*(.14+index*.24),y:this.height*.83,visible:true,docked:true};}
  nudgeOrbit(yaw:number,pitch:number,zoom=0){this.dirty=true;this.rig.nudge(yaw,pitch,zoom);}
  // An explicit reset undoes any orbit, so it always counts as a change.
  resetView(){this.framing='establishing';this.dirty=true;this.rig.focus('establishing',this.reduced);}
  inspectRepresentative(){this.frameOn('representative');}
  // Resuming redraws once in case the canvas was out of the page while paused. Pausing changes nothing visible.
  setPaused(v:boolean){this.exploration.setPaused(v);if(v===this.paused)return;this.paused=v;this.last=0;if(!v)this.dirty=true;}
  setReducedMotion(v:boolean){if(v===this.reduced)return;this.dirty=true;this.reduced=v;this.rig.reducedMotion=v;}
  // A preset change updates the sun's shadow here; geometry built for the other profile needs a new world,
  // which CollectionDesktopEnvironment builds (see sourceGeometryProfile).
  setQuality(q:DesktopEnvironmentQuality){const preset=this.quality.preset;this.quality={...q};const shadows=q.preset!=='low';if(this.renderer.shadowMap.enabled!==shadows){this.renderer.shadowMap.enabled=shadows;this.dirty=true;}if(q.preset!==preset)this.applySunShadow();this.resize();}
  private applySunShadow(){const sun=this.sun;if(!sun)return;const size=this.quality.preset==='high'?2048:1024;sun.castShadow=this.quality.preset!=='low';if(sun.shadow.mapSize.x!==size||sun.shadow.mapSize.y!==size){sun.shadow.mapSize.set(size,size);sun.shadow.map?.dispose();sun.shadow.map=null;}this.shadows.invalidate();this.dirty=true;}
  // Three's setSize clears the drawing buffer, so skip it unless the size or ratio really changed.
  resize(){const r=this.o.container.getBoundingClientRect(),width=Math.max(1,r.width),height=Math.max(1,r.height),ratio=Math.min(devicePixelRatio||1,this.quality.preset==='high'?2:1.25)*this.quality.renderScale/100,size=`${width}x${height}@${ratio}`;if(size===this.sized)return;this.sized=size;this.dirty=true;this.width=width;this.height=height;this.renderer.setPixelRatio(ratio);this.renderer.setSize(width,height,false);this.rig.resize(width/height);}
  getStats(){
    const info=this.renderer.info,f=this.frameCounts,c=this.renderer.domElement;
    return{
      sourceWorld:this.asset?.sourceWorld===true,world:this.o.layout,
      navigation:{nodes:this.asset?.exploration?.graph.nodes.length??0,edges:this.asset?.exploration?.graph.edges.length??0,hubs:Object.keys(this.asset?.exploration?.fastTravel??{}).length},
      triangles:f.triangles,drawCalls:f.calls,statsScope:'last rendered frame, all passes' as const,
      passes:{shadow:{...f.shadow},offscreen:{...f.offscreen},main:{calls:f.calls-f.shadow.calls-f.offscreen.calls,triangles:f.triangles-f.shadow.triangles-f.offscreen.triangles}},
      geometries:info.memory.geometries,textures:info.memory.textures,
      frameTimesMs:this.pacing.frameIntervals(),frameTimesMeasure:'frame-interval' as const,submissionTimesMs:this.pacing.submissionTimes(),shadowRedraws:this.shadows.counts(),
      render:{preset:this.quality.preset,renderScale:this.quality.renderScale,geometryProfile:this.geometryProfile,pixelRatio:this.renderer.getPixelRatio(),canvas:[c.width,c.height] as const,reflectionTarget:this.asset?.reflectionTarget?.()??null},
    };
  }
  private pick(e:PointerEvent){const r=this.renderer.domElement.getBoundingClientRect();return this.picker?.pick(this.rig.camera,e.clientX-r.left,e.clientY-r.top,r.width,r.height)??null;}
  private down=(e:PointerEvent)=>{this.pointer={down:true,x:e.clientX,y:e.clientY,moved:0,id:e.pointerId,pan:e.button!==0||e.shiftKey};this.renderer.domElement.setPointerCapture(e.pointerId);};
  private move=(e:PointerEvent)=>{if(this.pointer.down){const dx=e.clientX-this.pointer.x,dy=e.clientY-this.pointer.y;this.pointer.x=e.clientX;this.pointer.y=e.clientY;this.pointer.moved+=Math.abs(dx)+Math.abs(dy);this.dirty=true;if(this.pointer.pan)this.rig.panPixels(dx,dy,this.height);else this.rig.orbitBy(-dx*.16,dy*.12);}else{const id=this.pick(e);if(id!==this.hover){this.hover=id;this.o.onLandmarkHover(id);this.refresh();}}};
  private up=(e:PointerEvent)=>{if(e.pointerId!==this.pointer.id)return;this.pointer.down=false;if(this.renderer.domElement.hasPointerCapture(e.pointerId))this.renderer.domElement.releasePointerCapture(e.pointerId);if(this.pointer.moved<6&&!this.pointer.pan){const id=this.pick(e);if(this.exploration.getSnapshot().enabled&&this.asset){if(id)this.travelToLandmark(id);else{const r=this.renderer.domElement.getBoundingClientRect();this.groundRay.setFromCamera(new T.Vector2((e.clientX-r.left)/r.width*2-1,-(e.clientY-r.top)/r.height*2+1),this.rig.camera);const nodes=this.asset.exploration?.graph.nodes??[];let best:ExplorationPoint|null=null,bestDistance=Infinity;for(const node of nodes){this.point.set(node.position.x,node.position.y,node.position.z);const along=this.point.clone().sub(this.groundRay.ray.origin).dot(this.groundRay.ray.direction);if(along<=0)continue;const distance=this.groundRay.ray.distanceSqToPoint(this.point);if(distance<bestDistance&&distance<2.4*2.4){best=node.position;bestDistance=distance;}}if(best)this.moveToPoint(best);}}else if(id)this.o.onLandmarkSelect(id);}};
  private cancel=()=>{this.pointer.down=false;};private leave=()=>{this.hover=null;this.o.onLandmarkHover(null);this.refresh();};
  private wheel=(e:WheelEvent)=>{e.preventDefault();this.dirty=true;this.rig.orbitBy(0,0,Math.exp(Math.max(-1,Math.min(1,e.deltaY*.0015))));};
  private contextMenu=(event:MouseEvent)=>{event.preventDefault();};
  private bind(){const c=this.renderer.domElement;c.addEventListener('contextmenu',this.contextMenu);c.addEventListener('pointerdown',this.down);c.addEventListener('pointermove',this.move);c.addEventListener('pointerup',this.up);c.addEventListener('pointercancel',this.cancel);c.addEventListener('pointerleave',this.leave);c.addEventListener('wheel',this.wheel,{passive:false});this.observer=new ResizeObserver(()=>this.resize());this.observer.observe(this.o.container);}
  dispose(){if(this.disposed)return;this.disposed=true;this.exploration.dispose();this.estate.dispose();cancelAnimationFrame(this.frame);this.observer?.disconnect();const c=this.renderer.domElement;c.removeEventListener('contextmenu',this.contextMenu);c.removeEventListener('pointerdown',this.down);c.removeEventListener('pointermove',this.move);c.removeEventListener('pointerup',this.up);c.removeEventListener('pointercancel',this.cancel);c.removeEventListener('pointerleave',this.leave);c.removeEventListener('wheel',this.wheel);c.removeEventListener('webglcontextlost',this.lost);this.releaseAsset();this.environmentMap?.dispose();disposeSourceTree(this.scene);this.renderer.dispose();this.renderer.forceContextLoss();c.remove();}
}
