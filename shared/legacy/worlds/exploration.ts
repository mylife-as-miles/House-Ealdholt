import type { LandmarkId } from '../types';
import type { Collider } from '../environment/kernel/mesh';
import type { ExplorationPoint, RouteNode, RouteEdge } from '../exploration/contract';
import type { ExplorationRouteData } from '../exploration/controller';

interface SourceNavigation {
  groundAt(x: number, z: number): number;
  dryAt(x: number, z: number): boolean;
  clearAt(x: number, y: number, z: number): boolean;
  cameraColliders?: readonly Collider[];
  landmarks: readonly { id: LandmarkId; position: readonly [number, number, number] }[];
}

/** Local walking hubs on source ground. Distant sites require explicit fast travel.
 * No edge spans a valley, lake, cliff or untested gap. Geometry clearance and the
 * source's own water/height functions are mandatory, never replaced with a plane.
 */
export function createTerrainHubs(input: SourceNavigation): ExplorationRouteData | null {
  const nodes: RouteNode[] = [], edges: RouteEdge[] = [];
  const destinations: Record<string, string> = {}, fastTravel: Partial<Record<LandmarkId, string>> = {};
  const cache = new Map<string, boolean>();
  function groundPoint(x: number, z: number): ExplorationPoint { return { x, y: input.groundAt(x, z), z }; }
  function terrainSafe(point: ExplorationPoint): boolean {
    const { x, y, z } = point;
    if (![x,y,z].every(Number.isFinite) || Math.abs(y - input.groundAt(x,z)) > .2 || !input.dryAt(x,z)) return false;
    const key = `${x.toFixed(4)},${z.toFixed(4)}`;
    const cached = cache.get(key); if (cached !== undefined) return cached;
    const r = .42;
    const samples = [[x,z],[x+r,z],[x-r,z],[x,z+r],[x,z-r]];
    const safe = samples.every(([px,pz]) => input.dryAt(px,pz)
      && Math.abs(input.groundAt(px,pz)-y) <= .3
      && input.clearAt(px,input.groundAt(px,pz),pz));
    cache.set(key,safe); return safe;
  }
  function segmentSafe(from: ExplorationPoint, to: ExplorationPoint): boolean {
    const distance = Math.hypot(to.x-from.x,to.z-from.z);
    if (distance < .001 || Math.abs(to.y-from.y) / distance > .5) return false;
    const count = Math.max(2,Math.ceil(distance/.6));
    for(let i=0;i<=count;i++) {
      const t=i/count, point=groundPoint(from.x+(to.x-from.x)*t,from.z+(to.z-from.z)*t);
      // Session interpolation must stay on the visible terrain, not pass through it.
      if (Math.abs(point.y-(from.y+(to.y-from.y)*t))>.22 || !terrainSafe(point)) return false;
    }
    return true;
  }
  for (const landmark of input.landmarks) {
    const [lx,,lz]=landmark.position;
    let centre: ExplorationPoint | null = null;
    // Ground outside an occupied landmark, not the roof or a manufactured floor.
    search: for(const radius of [10,18,28,42,64,90]) for(let step=0;step<12;step++) {
      const angle=step*Math.PI/6, candidate=groundPoint(lx+Math.cos(angle)*radius,lz+Math.sin(angle)*radius);
      if(!terrainSafe(candidate)) continue;
      const neighbours=[[3,0],[-3,0],[0,3],[0,-3]].filter(([dx,dz])=>segmentSafe(candidate,groundPoint(candidate.x+dx,candidate.z+dz)));
      if(neighbours.length>=3) { centre=candidate;break search; }
    }
    if(!centre) continue;
    const grid=new Map<string,RouteNode>();
    for(let ix=-2;ix<=2;ix++) for(let iz=-2;iz<=2;iz++) {
      const position=groundPoint(centre.x+ix*3,centre.z+iz*3);
      if(!terrainSafe(position)) continue;
      const node={id:`${landmark.id}:${ix}:${iz}`,position};grid.set(`${ix}:${iz}`,node);
    }
    const hubEdges: RouteEdge[]=[];
    for(let ix=-2;ix<=2;ix++) for(let iz=-2;iz<=2;iz++) {
      const node=grid.get(`${ix}:${iz}`);if(!node) continue;
      for(const [dx,dz] of [[1,0],[0,1]]) {
        const next=grid.get(`${ix+dx}:${iz+dz}`);
        if(next&&segmentSafe(node.position,next.position)) hubEdges.push({from:node.id,to:next.id});
      }
    }
    const start=grid.get('0:0');if(!start) continue;
    const reachable=new Set([start.id]);let changed=true;
    while(changed){changed=false;for(const edge of hubEdges)if(reachable.has(edge.from)!==reachable.has(edge.to)){reachable.add(edge.from);reachable.add(edge.to);changed=true;}}
    if(reachable.size<4) continue;
    for(const node of grid.values())if(reachable.has(node.id)){nodes.push(node);destinations[`route:${node.id}`]=node.id;}
    edges.push(...hubEdges.filter(edge=>reachable.has(edge.from)&&reachable.has(edge.to)));
    // Arrival is at a separate approach node within the local hub.
    const approach=[...grid.values()].filter(node=>reachable.has(node.id)).sort((a,b)=>Math.hypot(a.position.x-lx,a.position.z-lz)-Math.hypot(b.position.x-lx,b.position.z-lz))[0];
    destinations[landmark.id]=approach.id;fastTravel[landmark.id]=start.id;
  }
  if(!nodes.length) return null;
  return { graph:{nodes,edges},safety:{isPointSafe:terrainSafe,isSegmentSafe:segmentSafe},destinations,startNode:nodes.find(node=>node.id.endsWith(':0:0'))?.id??nodes[0].id,fastTravel, sampleGround:input.groundAt, cameraColliders:input.cameraColliders?.filter(collider=>nodes.some(node=>Math.hypot(node.position.x-collider.center[0],node.position.z-collider.center[2])<30+Math.hypot(collider.halfExtents[0],collider.halfExtents[2]))) };
}

/** Build-time capsule clearance against the actual source meshes. This is geometry
 * validation, not a replacement for the SDK's hand/pointer interaction system. */
export interface SourceClearance { (x: number,y: number,z: number): boolean; colliders: Collider[] }
export function createSourceClearance(T: any, root: any, regions: readonly { position: readonly [number,number,number] }[] = [], BVH?: any): SourceClearance {
  root.updateMatrixWorld(true);
  const candidates: { mesh: any; box: any }[]=[];
  const collisionMaterial=new T.MeshBasicMaterial({side:T.DoubleSide});
  const nearRegion=(box:any)=>!regions.length||regions.some(({position:[x,,z]})=>{
    const dx=Math.max(box.min.x-x,0,x-box.max.x),dz=Math.max(box.min.z-z,0,z-box.max.z);
    return dx*dx+dz*dz<110*110;
  });
  root.traverse((mesh: any)=>{
    if(!mesh.isMesh || !mesh.geometry || mesh.visible===false) return;
    let part=mesh, names='';while(part&&part!==root){names+=' '+part.name;part=part.parent;}
    // Terrain is checked by the source heightfield; water by dryAt. Atmosphere,
    // particles and cloth never serve as architectural capsule obstacles.
    if(/terrain|ground|sky|atmosphere|cloud|water|pond|mist|foam|spray|bird|banner|cloth|leaves|foliage|needles|petal|tuft|grass|shrub|fern|blossom|ivy|reed|lotus|flower|pollen|firefl|ripple|splash/i.test(names)) return;
    const mats=Array.isArray(mesh.material)?mesh.material:[mesh.material];
    if(mats.every((material:any)=>material?.transparent&&material.opacity<.65)) return;
    if(mesh.isInstancedMesh) {
      // Expand once during build. A query never invokes InstancedMesh.raycast,
      // which would scan every forest instance for every capsule sample.
      const local=new T.Matrix4(), transform=new T.Matrix4();
      if(!mesh.geometry.boundingBox)mesh.geometry.computeBoundingBox();
      for(let i=0;i<mesh.count;i++){
        mesh.getMatrixAt(i,local);transform.multiplyMatrices(mesh.matrixWorld,local);
        const box=mesh.geometry.boundingBox.clone().applyMatrix4(transform);
        if(!nearRegion(box))continue;
        const proxy=new T.Mesh(mesh.geometry,collisionMaterial);
        proxy.matrixAutoUpdate=false;proxy.matrixWorld.copy(transform);
        if(!box.isEmpty())candidates.push({mesh:proxy,box});
      }
    }else{
      const box=new T.Box3().setFromObject(mesh);
      if(!box.isEmpty()&&nearRegion(box)){
        const proxy=mesh.isBatchedMesh?mesh:new T.Mesh(mesh.geometry,collisionMaterial);
        if(proxy!==mesh){proxy.matrixAutoUpdate=false;proxy.matrixWorld.copy(mesh.matrixWorld);}
        candidates.push({mesh:proxy,box});
      }
    }
  });
  const cells=new Map<string, {mesh:any;box:any}[]>(), large: {mesh:any;box:any}[]=[];
  const cellSize=8;
  for(const entry of candidates){
    const b=entry.box,x0=Math.floor(b.min.x/cellSize),x1=Math.floor(b.max.x/cellSize),z0=Math.floor(b.min.z/cellSize),z1=Math.floor(b.max.z/cellSize);
    if((x1-x0+1)*(z1-z0+1)>64){large.push(entry);continue;}
    for(let ix=x0;ix<=x1;ix++)for(let iz=z0;iz<=z1;iz++){
      const key=`${ix}:${iz}`,cell=cells.get(key);if(cell)cell.push(entry);else cells.set(key,[entry]);
    }
  }
  const ray=new T.Raycaster(), origin=new T.Vector3(), direction=new T.Vector3();
  const trees=new WeakMap<object,any>(), inverse=new T.Matrix4(), localRay=new T.Ray(), hitPoint=new T.Vector3();
  const hits: any[]=[];
  const test=(x:number,y:number,z:number,dx:number,dy:number,dz:number,length:number)=>{
    ray.set(origin.set(x,y,z),direction.set(dx,dy,dz));ray.near=.015;ray.far=length;
    const nearby=new Set(large);
    for(let ix=Math.floor((x-length)/cellSize);ix<=Math.floor((x+length)/cellSize);ix++)for(let iz=Math.floor((z-length)/cellSize);iz<=Math.floor((z+length)/cellSize);iz++)for(const entry of cells.get(`${ix}:${iz}`)??[])nearby.add(entry);
    for(const entry of nearby){
      const b=entry.box;
      if(x+length<b.min.x||x-length>b.max.x||z+length<b.min.z||z-length>b.max.z||y+length<b.min.y||y-length>b.max.y)continue;
      if(BVH&&!entry.mesh.isBatchedMesh){
        const geometry=entry.mesh.geometry;
        let tree=trees.get(geometry);
        if(!tree){tree=new BVH(geometry,{indirect:true,targetLeafSize:16,verbose:false});trees.set(geometry,tree);}
        inverse.copy(entry.mesh.matrixWorld).invert();localRay.copy(ray.ray).applyMatrix4(inverse);
        const hit=tree.raycastFirst(localRay,T.DoubleSide);
        if(hit&&hitPoint.copy(hit.point).applyMatrix4(entry.mesh.matrixWorld).distanceTo(origin)<=length)return false;
      }else{
        hits.length=0;ray.intersectObject(entry.mesh,false,hits);
        if(hits.length)return false;
      }
    }
    return true;
  };
  const clear: SourceClearance = Object.assign((x:number,y:number,z:number)=>test(x,y+1.7,z,0,-1,0,1.4)
    && test(x,y+.7,z,1,0,0,.48)&&test(x,y+.7,z,-1,0,0,.48)
    && test(x,y+.7,z,0,0,1,.48)&&test(x,y+.7,z,0,0,-1,.48), {colliders: candidates.filter(({mesh,box})=>!mesh.isInstancedMesh && box.max.x-box.min.x<80 && box.max.z-box.min.z<80).map(({box})=>({center:[(box.min.x+box.max.x)/2,(box.min.y+box.max.y)/2,(box.min.z+box.max.z)/2] as [number,number,number],halfExtents:[(box.max.x-box.min.x)/2,(box.max.y-box.min.y)/2,(box.max.z-box.min.z)/2] as [number,number,number],yaw:0,landmark:null,blocksCamera:true})) });
  return clear;
}
