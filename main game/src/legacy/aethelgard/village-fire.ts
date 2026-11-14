import { Group, Object3D, PointLight, type WebGLRenderer } from 'three';
import { EALDHOLT_FIRE_ANCHORS } from '../../../../shared/legacy/aethelgard/environment/village-fire';
import { createProceduralFireRuntime, type ProceduralFireRuntime, type ProceduralFireWeather } from './procedural-fire-runtime';
export type EaldholtFireWeather = ProceduralFireWeather;
export interface EaldholtVillageFire {
  readonly rootObject3D:Object3D; readonly triangleCount:number; readonly runtime:ProceduralFireRuntime;
  /** Existing elapsed world seconds; no effect owns world burning/damage. */
  update(time:number,reducedMotion:boolean,extinguished?:(p:readonly[number,number,number])=>boolean,weather?:EaldholtFireWeather|null):void;
  dispose():void;
}
/** Four measured source anchors, one shared combustion field, one camera-facing
 * card per hearth. Original night lighting/GI and model resources stay owned by
 * their existing callers; these optional constant fills retain their old values. */
export function createEaldholtVillageFire(options:{readonly pointLights?:boolean;readonly renderer?:Pick<WebGLRenderer,'capabilities'|'getContext'>}={}):EaldholtVillageFire {
  const rootObject3D=new Group(),runtime=createProceduralFireRuntime({renderer:options.renderer}),hearths:Group[]=[];
  rootObject3D.name='House Ealdholt Procedural Hearths';rootObject3D.userData.iwsdkPreviewBounds='exclude';
  rootObject3D.userData.provenance='MIT Leon Lin procedural-fire combustion adaptation; measured Crownfall anchors';
  for(const anchor of EALDHOLT_FIRE_ANCHORS){
    const hearth=new Group();hearth.name='Hearth '+anchor.id;hearth.position.set(anchor.position[0],anchor.position[1],anchor.position[2]);
    const flame=runtime.createFlame({width:anchor.width,height:anchor.height,phase:anchor.phase});flame.name=anchor.id+' combustion';hearth.add(flame);
    if(options.pointLights!==false){const light=new PointLight(0xffa23a,3.5,4.2,2);light.name=anchor.id+' warm fill';
      light.position.y=anchor.height*.42;light.castShadow=false;hearth.add(light);}
    rootObject3D.add(hearth);hearths.push(hearth);
  }
  let disposed=false;
  return {rootObject3D,runtime,triangleCount:EALDHOLT_FIRE_ANCHORS.length*2,
    update(time,reducedMotion,extinguished,weather){
      if(disposed)return;runtime.update(time,reducedMotion,weather);
      for(let i=0;i<hearths.length;i++)hearths[i].visible=!extinguished?.(EALDHOLT_FIRE_ANCHORS[i].position);
    },
    dispose(){if(disposed)return;disposed=true;rootObject3D.removeFromParent();rootObject3D.clear();runtime.dispose();},
  };
}
