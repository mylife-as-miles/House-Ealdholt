import { Box3, BufferAttribute, BufferGeometry, InstancedMesh, Matrix4, Mesh, Vector3, type Object3D } from 'three';
import { createEaldholtBankLandformBuffers, type EaldholtLandformRect, type EaldholtLandformLand, type EaldholtRiparianCorridor } from '../../../../shared/legacy/aethelgard/environment/bank-landform';
export interface EaldholtBankLandform {
  readonly trianglesAdded:number;readonly drawCallsAdded:0;readonly bufferBytes:number;readonly bufferBytesAdded:number;
  readonly bounds:{readonly min:readonly[number,number,number];readonly max:readonly[number,number,number]};
  readonly protectedFootprints:readonly EaldholtLandformRect[];readonly movedVertices:number;readonly maximumRaise:number;
  readonly riparianCorridor?:EaldholtRiparianCorridor;
  dispose():void;
}
const bases=new WeakMap<BufferGeometry,BufferGeometry>();
/** Own only replacement land buffers. Existing woodland supplies complete
 * HIGH support guards; explicit null shapes terrain before generated woodland,
 * retaining the real Landscape and exterior authored actor supports instead.
 * Call before final bounds/material adaptation and dispose before the valley. */
export function createEaldholtBankLandform(modelRoot:Object3D,valley:Object3D,woodland:Object3D|{readonly object:Object3D}|null,options:{profile?:'desktop'|'quest'}={}):EaldholtBankLandform {
  const profile=options.profile??'desktop';
  const riparianCorridor=woodland===null?Object.freeze({width:profile==='quest'?18:26,blendWidth:profile==='quest'?8:12}):undefined;
  if(valley.userData.crownfallRiverValley?.profile!==profile)throw Error('Landform profile must match its existing valley.');
  modelRoot.updateWorldMatrix(true,true);valley.updateWorldMatrix(true,true);
  const inverseRoot=new Matrix4().copy(modelRoot.matrixWorld).invert();
  const valleyFrame=valley.parent?new Matrix4().multiplyMatrices(inverseRoot,valley.matrixWorld):valley.matrix.clone(),rootToValley=valleyFrame.clone().invert();
  const land=valley.children.find(o=>o instanceof Mesh&&/outside village valley/.test(o.name));
  const channel=valley.children.find(o=>o instanceof Mesh&&/regional river surface/.test(o.name)),sea=valley.children.find(o=>o instanceof Mesh&&/open sea surface/.test(o.name));
  if(!(land instanceof Mesh)||!(channel instanceof Mesh)||!(sea instanceof Mesh))throw Error('Landform requires all three coastal surfaces.');
  for(const mesh of [land,channel,sea])if(!mesh.matrix.equals(new Matrix4()))throw Error('Landform expects valley-local surface buffers.');
  const base:BufferGeometry=bases.get(land.geometry)??land.geometry,p=base.getAttribute('position');
  const point=new Vector3(),sourceBounds=new Box3(),frame=new Matrix4();
  modelRoot.traverse(o=>{if(!(o instanceof Mesh)||!/^LandscapeComponent_\d+(?:_\d+)?$/.test(o.name))return;
    frame.multiplyMatrices(rootToValley,inverseRoot).multiply(o.matrixWorld);const a=o.geometry.getAttribute('position');
    for(let i=0;i<a.count;i++)sourceBounds.expandByPoint(point.fromBufferAttribute(a,i).applyMatrix4(frame));});
  if(sourceBounds.isEmpty())throw Error('Landform requires the actual source Landscape envelope.');
  const actorBounds:Box3[]=[],instance=new Matrix4();
  if(woodland!==null){
    const forest='object'in woodland?woodland.object:woodland;forest.updateWorldMatrix(true,true);
    const parts:InstancedMesh[]=[];forest.traverse(o=>{if(o instanceof InstancedMesh)parts.push(o);});
    const count=parts[0]?.instanceMatrix.count??0;
    if(!count||parts.some(o=>o.instanceMatrix.count!==count))throw Error('Landform requires complete baseline woodland instance pools.');
    for(let i=0;i<count;i++)actorBounds.push(new Box3());
    for(const part of parts){const a=part.geometry.getAttribute('position'),local=new Box3();for(let i=0;i<a.count;i++)local.expandByPoint(point.fromBufferAttribute(a,i));
      const partFrame=forest.parent?new Matrix4().multiplyMatrices(rootToValley,inverseRoot).multiply(part.matrixWorld):part.matrixWorld.clone();
      for(let i=0;i<count;i++){part.getMatrixAt(i,instance);actorBounds[i].union(local.clone().applyMatrix4(frame.multiplyMatrices(partFrame,instance)));}}
  }else{
    // This is an actual immutable source guard, not a placeholder forest. The
    // shared source guard already protects its faces; retaining the rectangle
    // also makes that ownership explicit to later continuity passes.
    actorBounds.push(sourceBounds.clone());
    const generated=(o:Object3D)=>{for(let owner:Object3D|null=o;owner&&owner!==modelRoot;owner=owner.parent)
      if(owner===valley||owner.userData.crownfallRiverWoodland||owner.userData.crownfallRiverMargin||owner.userData.crownfallWoodlandUnderstory||owner.userData.crownfallWoodlandPrototype)return true;return false;};
    modelRoot.traverse(o=>{
      if(!(o instanceof Mesh)||generated(o)||/^LandscapeComponent_\d+(?:_\d+)?$/.test(o.name))return;
      const a=o.geometry.getAttribute('position');if(!a)return;
      const localBounds=new Box3();for(let i=0;i<a.count;i++)localBounds.expandByPoint(point.fromBufferAttribute(a,i));
      if(localBounds.isEmpty())return;
      const actorFrame=new Matrix4().multiplyMatrices(rootToValley,inverseRoot).multiply(o.matrixWorld),copies=o instanceof InstancedMesh?o.instanceMatrix.count:1;
      for(let i=0;i<copies;i++){
        frame.copy(actorFrame);if(o instanceof InstancedMesh){o.getMatrixAt(i,instance);frame.multiply(instance);}
        const bounds=localBounds.clone().applyMatrix4(frame);
        // Interior authored actors are already protected by the complete
        // Landscape envelope. Only genuine exterior supports need extra boxes.
        if(bounds.min.x>=sourceBounds.min.x&&bounds.max.x<=sourceBounds.max.x&&bounds.min.z>=sourceBounds.min.z&&bounds.max.z<=sourceBounds.max.z)continue;
        actorBounds.push(bounds);
      }
    });
  }
  // Remove display-frame inversion roundoff at ten-micrometre precision; the
  // shared support guard still extends a conservative .8m beyond each box.
  const local=(v:number)=>Math.round(v*1e5)/1e5;
  const protectedFootprints=actorBounds.map(b=>({minX:local(b.min.x),maxX:local(b.max.x),minZ:local(b.min.z),maxZ:local(b.max.z)}));
  const attr=(name:string,size:number)=>{const a=base.getAttribute(name);if(!a||a.itemSize!==size||a.count!==p.count)throw Error(`Incomplete landform attribute ${name}.`);return a.array;};
  const source:EaldholtLandformLand={positions:p.array,normals:attr('normal',3),colours:attr('color',3),uv:attr('uv',2),wetness:attr('ealdholtShoreWetness',1),indices:base.index?.array??[]};
  const surface=(mesh:Mesh)=>({positions:mesh.geometry.getAttribute('position').array,indices:mesh.geometry.index?.array??[]});
  const data=createEaldholtBankLandformBuffers({land:source,water:[surface(channel),surface(sea)],sourceEnvelope:{minX:local(sourceBounds.min.x),maxX:local(sourceBounds.max.x),minZ:local(sourceBounds.min.z),maxZ:local(sourceBounds.max.z)},protectedFootprints,profile,riparianCorridor});
  const geometry=new BufferGeometry(),uv=new BufferAttribute(data.uv,2);
  geometry.setAttribute('position',new BufferAttribute(data.positions,3));geometry.setAttribute('normal',new BufferAttribute(data.normals,3));geometry.setAttribute('color',new BufferAttribute(data.colours,3));
  for(const name of ['uv','uv1','uv2','uv3'])geometry.setAttribute(name,uv);
  geometry.setAttribute('ealdholtShoreWetness',new BufferAttribute(data.wetness,1));geometry.setIndex(new BufferAttribute(data.indices,1));geometry.computeBoundingBox();geometry.computeBoundingSphere();
  geometry.userData.crownfallBankLandform={schema:1,profile,sourceGeometryUntouched:true,riparianCorridor:riparianCorridor??null,woodlandSupport:woodland===null?'final-terrain':'baseline-woodland',authoredActorGuards:woodland===null?actorBounds.length-1:0,trianglesAdded:data.trianglesAdded,drawCallsAdded:0,bufferBytes:data.bufferBytes,protectedFootprints:protectedFootprints.length,movedVertices:data.movedVertices,maximumRaise:data.maximumRaise};
  const arrays=new Set<ArrayBufferView>([...Object.values(base.attributes).map(a=>a.array),base.index!.array]),oldBytes=[...arrays].reduce((n,a)=>n+a.byteLength,0);
  bases.set(geometry,base);land.geometry=geometry;let disposed=false;
  return{trianglesAdded:data.trianglesAdded,drawCallsAdded:0,bufferBytes:data.bufferBytes,bufferBytesAdded:data.bufferBytes-oldBytes,bounds:data.bounds,protectedFootprints,riparianCorridor,movedVertices:data.movedVertices,maximumRaise:data.maximumRaise,
    dispose(){if(disposed)return;disposed=true;if(land.geometry===geometry)land.geometry=base;bases.delete(geometry);geometry.dispose();}};
}
