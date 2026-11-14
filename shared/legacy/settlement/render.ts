import type { MeshBuffer } from '../environment/kernel';
import { buildSettlementBuilding } from '../environment/settlement/buildings';
import { settlementHeight } from '../environment/settlement/layout';
import { SETTLEMENT_MATERIALS } from '../environment/settlement/materials';
import { createSettlementSelection } from '../environment/settlement/selection';
import type { SettlementBuilding, SettlementPlacement, SettlementSnapshot, SettlementSourceAsset } from './contract';
export interface SettlementRenderedPlacement extends SettlementPlacement { visible:boolean; meshCount:number; assetId:string|null; sources:readonly SettlementSourceAsset[]; renderSignature:string; bounds:{min:readonly number[];max:readonly number[]} }
export interface SettlementRenderInfo { placements:readonly SettlementRenderedPlacement[]; preview:{visible:boolean;valid:boolean;kind:string;meshCount:number;assetId:string|null;sources:readonly SettlementSourceAsset[];renderSignature:string;bounds:{min:readonly number[];max:readonly number[]}}|null }
/** Uses the consumer's Three namespace. Batched by material, with triangle ranges
 * retained for real object picking; source geometry remains addressable. */
export function createSettlementRenderer(T:any,options:{groundAt:(x:number,z:number)=>number;previewGroundAt?:(x:number,z:number)=>number;miniature?:boolean;materialFor?:(key:string)=>any;runtimeBuildingFactory?:(spec:{id:string;kind:SettlementBuilding;width:number;depth:number;height?:number})=>any}){
  const root=new T.Group();root.name='Estate placed buildings';
  const placed=new T.Group(),ghost=new T.Group(),grid=new T.Group();grid.name='Contextual estate placement grid';grid.visible=false;placed.name='Saved estate placements';ghost.name='Current placement preview';root.add(placed,ghost,grid);
  const owned=new Set<any>(),materialCache=new Map<string,any>();
  const ghostMaterial=new T.MeshBasicMaterial({color:'#83e7ff',transparent:true,opacity:.3,depthWrite:false,side:T.DoubleSide,toneMapped:false});owned.add(ghostMaterial);
  const gridMaterial=new T.LineBasicMaterial({color:'#c6d9d2',transparent:true,opacity:.16,depthWrite:false,toneMapped:false});owned.add(gridMaterial);let gridKey='';
  let placementSignature='',previewSignature='',selectionSignature='',selected:any=null,rendered:SettlementRenderedPlacement[]=[],previewInfo:SettlementRenderInfo['preview']=null;
  function materialFor(key:string){
    if(materialCache.has(key))return materialCache.get(key);
    let material:any=null;try{material=options.materialFor?.(key);}catch{/* Unknown optional surface uses the owned palette. */}
    if(!material){const def=SETTLEMENT_MATERIALS.find(m=>m.key===key),color=def?.color??'#b5a17b';material=options.miniature?new T.MeshBasicMaterial({color,vertexColors:true}):new T.MeshStandardMaterial({color,vertexColors:true,roughness:.9,metalness:.02});owned.add(material);}
    materialCache.set(key,material);return material;
  }
  function buffers(p:SettlementPlacement,preview=false):MeshBuffer[]{
    const ground=preview?(options.previewGroundAt??options.groundAt):options.groundAt;
    if(p.kind==='pavilion'||p.kind==='ruin-arch')throw new Error(`The ${p.kind} source kit is unavailable.`);
    const meshes=buildSettlementBuilding({id:p.id,x:p.x,z:p.z,width:p.width,depth:p.depth,eaves:p.kind==='storehouse'?4.3:3.7,roofHeight:p.kind==='storehouse'?4.3:5,yaw:p.rotation*Math.PI/2,roof:p.kind==='storehouse'?'rust':'blue',landmark:null});
    const dy=ground(p.x,p.z)-settlementHeight(p.x,p.z);
    if(Math.abs(dy)>1e-6)for(const mesh of meshes)for(let i=1;i<mesh.positions.length;i+=3)mesh.positions[i]+=dy;
    return meshes;
  }
  function clear(group:any){for(const child of [...group.children]){
    if(child.userData.crownfallRuntimeGeometry){const geometries=new Set<any>();child.traverse((node:any)=>{if(node.geometry)geometries.add(node.geometry);});for(const geometry of geometries)geometry.dispose();}
    else child.geometry?.dispose();group.remove(child);
  }}
  function assemble(group:any,items:{id:string;mesh:MeshBuffer}[],preview=false){
    const batches=new Map<string,{id:string;mesh:MeshBuffer}[]>();
    for(const item of items){const key=preview?'preview':item.mesh.material;const list=batches.get(key);if(list)list.push(item);else batches.set(key,[item]);}
    for(const [key,list] of batches){
      const vertices=list.reduce((n,{mesh})=>n+mesh.positions.length/3,0),triangles=list.reduce((n,{mesh})=>n+mesh.indices.length,0);
      const positions=new Float32Array(vertices*3),normals=new Float32Array(vertices*3),colors=new Float32Array(vertices*3),uvs=new Float32Array(vertices*2),indices=new Uint32Array(triangles),ranges:{id:string;from:number;to:number}[]=[];
      let vertex=0,index=0;
      for(const {id,mesh} of list){positions.set(mesh.positions,vertex*3);normals.set(mesh.normals,vertex*3);uvs.set(mesh.uvs,vertex*2);if(mesh.colors)colors.set(mesh.colors,vertex*3);else colors.fill(1,vertex*3,vertex*3+mesh.positions.length);
        const first=index/3;for(let i=0;i<mesh.indices.length;i++)indices[index+i]=mesh.indices[i]+vertex;ranges.push({id,from:first,to:(index+mesh.indices.length)/3});index+=mesh.indices.length;vertex+=mesh.positions.length/3;}
      const geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.BufferAttribute(positions,3));geometry.setAttribute('normal',new T.BufferAttribute(normals,3));geometry.setAttribute('uv',new T.BufferAttribute(uvs,2));geometry.setAttribute('color',new T.BufferAttribute(colors,3));geometry.setIndex(new T.BufferAttribute(indices,1));geometry.computeBoundingBox();geometry.computeBoundingSphere();
      const mesh=new T.Mesh(geometry,preview?ghostMaterial:materialFor(key));mesh.name=preview?'Placement ghost':`Placed estate ${key}`;mesh.castShadow=!preview&&!options.miniature;mesh.receiveShadow=!preview;mesh.userData.placementRanges=ranges;
      if(preview){mesh.raycast=()=>{};mesh.renderOrder=2;}group.add(mesh);
    }
  }
  function syncGrid(preview:SettlementSnapshot['preview']){
    grid.visible=!!preview;if(!preview)return;
    const x=Math.round(preview.x/8)*8,z=Math.round(preview.z/8)*8,key=`${x}:${z}`;if(key===gridKey)return;gridKey=key;clear(grid);
    const ground=options.previewGroundAt??options.groundAt,points:number[]=[],minX=Math.max(-88,x-32),maxX=Math.min(88,x+32),minZ=Math.max(-88,z-32),maxZ=Math.min(88,z+32);
    const segment=(ax:number,az:number,bx:number,bz:number)=>points.push(ax,ground(ax,az)+.045,az,bx,ground(bx,bz)+.045,bz);
    for(let px=minX;px<=maxX;px++)for(let pz=minZ;pz<maxZ;pz+=2)segment(px,pz,px,Math.min(maxZ,pz+2));
    for(let pz=minZ;pz<=maxZ;pz++)for(let px=minX;px<maxX;px+=2)segment(px,pz,Math.min(maxX,px+2),pz);
    const geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.Float32BufferAttribute(points,3));const lines=new T.LineSegments(geometry,gridMaterial);lines.name='One metre ground grid';lines.raycast=()=>{};grid.add(lines);
  }
  function geometrySignature(parts:{array:ArrayLike<number>;label:string}[],materials:any[]=[]){
    let hash=2166136261;const feed=(v:number)=>{hash=Math.imul(hash^(v|0),16777619)>>>0;};
    for(const part of parts){for(let i=0;i<part.label.length;i++)feed(part.label.charCodeAt(i));feed(part.array.length);for(let i=0;i<part.array.length;i++)feed(Math.round(part.array[i]*1e5));}
    for(const material of materials){if(material?.color)for(const channel of ['r','g','b'])feed(Math.round(material.color[channel]*1e6));for(const value of [material?.roughness,material?.metalness,material?.opacity])if(typeof value==='number')feed(Math.round(value*1e6));}
    return hash.toString(16).padStart(8,'0');
  }
  function sourceBuilding(p:SettlementPlacement,preview=false){
    if(!options.runtimeBuildingFactory)return null;
    // A preview and its committed object use the same deterministic source variant.
    const node=options.runtimeBuildingFactory({id:`estate-${p.kind}-${p.x}-${p.z}`,kind:p.kind,width:p.width,depth:p.depth});
    node.name=`Placed ${p.kind}`;node.position.set(p.x,(preview?(options.previewGroundAt??options.groundAt):options.groundAt)(p.x,p.z),p.z);node.rotation.y=p.rotation*Math.PI/2;node.userData.placementId=p.id;node.userData.crownfallRuntimeGeometry=true;
    if(preview)node.traverse((child:any)=>{if(child.isMesh){child.material=ghostMaterial;child.raycast=()=>{};child.castShadow=false;}});
    return node;
  }
  function runtimeEvidence(node:any,p:SettlementPlacement):SettlementRenderedPlacement{
    node.updateMatrixWorld(true);const box=new T.Box3(),inverse=new T.Matrix4().copy(placed.matrixWorld).invert(),relative=new T.Matrix4();let meshCount=0;const parts:{array:ArrayLike<number>;label:string}[]=[],materials:any[]=[];
    node.traverse((mesh:any)=>{if(!mesh.isMesh||!mesh.geometry)return;meshCount++;const geometry=mesh.geometry;if(!geometry.boundingBox)geometry.computeBoundingBox();relative.multiplyMatrices(inverse,mesh.matrixWorld);box.union(geometry.boundingBox.clone().applyMatrix4(relative));for(const key of Object.keys(geometry.attributes).sort())parts.push({label:key,array:geometry.attributes[key].array});if(geometry.index)parts.push({label:'index',array:geometry.index.array});parts.push({label:'transform',array:relative.elements});materials.push(...(Array.isArray(mesh.material)?mesh.material:[mesh.material]));});
    return {...p,visible:meshCount>0&&node.visible,meshCount,assetId:node.userData.sourceAssetId??null,sources:node.userData.sourceProvenance??[],renderSignature:geometrySignature(parts,materials),bounds:{min:box.min.toArray(),max:box.max.toArray()}};
  }
  function bounds(items:MeshBuffer[]){const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];for(const mesh of items)for(let i=0;i<mesh.positions.length;i+=3)for(let axis=0;axis<3;axis++){min[axis]=Math.min(min[axis],mesh.positions[i+axis]);max[axis]=Math.max(max[axis],mesh.positions[i+axis]);}return {min,max};}
  return {
    root,
    sync(snapshot:SettlementSnapshot){
      const signature=JSON.stringify(snapshot.placements);
      if(signature!==placementSignature){
        placementSignature=signature;clear(placed);const items:{id:string;mesh:MeshBuffer}[]=[];rendered=[];
        for(const p of snapshot.placements){const runtime=sourceBuilding(p);if(runtime){placed.add(runtime);rendered.push(runtimeEvidence(runtime,p));continue;}const source=buffers(p);for(const mesh of source)items.push({id:p.id,mesh});rendered.push({...p,visible:source.some(mesh=>mesh.indices.length>0),meshCount:source.length,assetId:null,sources:[],renderSignature:geometrySignature(source.flatMap(mesh=>[{label:'position',array:mesh.positions},{label:'normal',array:mesh.normals},{label:'uv',array:mesh.uvs},{label:'index',array:mesh.indices},...(mesh.colors?[{label:'color',array:mesh.colors}]:[])]),source.map(mesh=>materialFor(mesh.material))),bounds:bounds(source)});}
        assemble(placed,items);
      }
      syncGrid(snapshot.preview);
      const preview=snapshot.preview,newPreview=JSON.stringify(preview&&[preview.kind,preview.x,preview.z,preview.width,preview.depth,preview.rotation]);
      if(newPreview!==previewSignature){previewSignature=newPreview;clear(ghost);previewInfo=null;
        if(preview&&Number.isFinite(preview.x)&&Number.isFinite(preview.z)&&Math.abs(preview.x)<1e5&&Math.abs(preview.z)<1e5){const runtime=sourceBuilding(preview,true);if(runtime){ghost.add(runtime);const info=runtimeEvidence(runtime,preview);previewInfo={visible:info.visible,valid:preview.valid,kind:preview.kind,meshCount:info.meshCount,assetId:info.assetId,sources:info.sources,renderSignature:info.renderSignature,bounds:info.bounds};}else{const source=buffers(preview,true);assemble(ghost,source.map(mesh=>({id:'preview',mesh})),true);previewInfo={visible:ghost.children.length>0,valid:preview.valid,kind:preview.kind,meshCount:ghost.children.length,assetId:null,sources:[],renderSignature:geometrySignature(source.flatMap(mesh=>[{label:'position',array:mesh.positions},{label:'index',array:mesh.indices}])),bounds:bounds(source)};}}
      }
      ghost.visible=!!preview;ghostMaterial.color.set(preview?.valid?'#83e7ff':'#d87856');if(previewInfo)previewInfo.valid=preview?.valid??false;
      const selection=preview??snapshot.placements.find(p=>p.id===snapshot.selectedId),selectionGround=preview?(options.previewGroundAt??options.groundAt):options.groundAt,next=JSON.stringify(selection&&[selection.id,selection.x,selection.z,selection.width,selection.depth,selection.rotation]);
      if(next!==selectionSignature){selectionSignature=next;selected?.dispose();selected=null;
        if(selection){selected=createSettlementSelection(T,[{id:selection.id,center:[selection.x,selectionGround(selection.x,selection.z),selection.z],width:selection.width,depth:selection.depth,yaw:selection.rotation*Math.PI/2}],{sampleGround:selectionGround});selected.setSelected(selection.id);selected.setReducedMotion(true);root.add(selected.root);}
      }
      if(selected&&preview)selected.root.traverse((object:any)=>{if(object.material?.color)object.material.color.set(preview.valid?'#a5edff':'#e39171');});
    },
    pick(raycaster:any):string|null {
      const hit=raycaster.intersectObject(placed,true)[0];if(!hit||typeof hit.faceIndex!=='number')return null;
      let node=hit.object;while(node&&node!==placed){if(node.userData.placementId)return node.userData.placementId;node=node.parent;}
      return hit.object.userData.placementRanges?.find((range:{id:string;from:number;to:number})=>hit.faceIndex>=range.from&&hit.faceIndex<range.to)?.id??null;
    },
    getRenderInfo():SettlementRenderInfo{return {placements:rendered.map(p=>({...p,bounds:{min:[...p.bounds.min],max:[...p.bounds.max]}})),preview:previewInfo?{...previewInfo,bounds:{min:[...previewInfo.bounds.min],max:[...previewInfo.bounds.max]}}:null};},
    dispose(){selected?.dispose();selected=null;clear(placed);clear(ghost);clear(grid);root.removeFromParent();root.clear();for(const material of owned)material.dispose();owned.clear();materialCache.clear();rendered=[];},
  };
}
