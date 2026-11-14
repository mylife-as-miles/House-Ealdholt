// Crownfall-local attribute-preserving buffer utilities. These use the adapter's
// Three namespace, avoiding the upstream addon's second Three runtime in IWSDK.
import * as THREE from 'crownfall-world-three';
export function mergeGeometries(geometries, useGroups = false) {
  if (!geometries.length) return null;
  const out = new THREE.BufferGeometry(), names=Object.keys(geometries[0].attributes);
  let vertices=0,indexCount=0;
  for(const g of geometries){vertices+=g.attributes.position.count;indexCount+=g.index?g.index.count:g.attributes.position.count;}
  for(const name of names){
    const sample=geometries[0].getAttribute(name), merged=new sample.array.constructor(vertices*sample.itemSize);let offset=0;
    for(const g of geometries){const a=g.getAttribute(name);if(!a||a.itemSize!==sample.itemSize||a.normalized!==sample.normalized)throw Error(`Cannot merge attribute ${name}`);merged.set(a.array,offset);offset+=a.array.length;}
    out.setAttribute(name,new THREE.BufferAttribute(merged,sample.itemSize,sample.normalized));
  }
  const indices=new Uint32Array(indexCount);let vertex=0,k=0;
  for(let group=0;group<geometries.length;group++){const g=geometries[group],count=g.index?g.index.count:g.attributes.position.count,start=k;for(let i=0;i<count;i++)indices[k++]=vertex+(g.index?g.index.getX(i):i);if(useGroups)out.addGroup(start,count,group);vertex+=g.attributes.position.count;}
  out.setIndex(new THREE.BufferAttribute(indices,1));return out;
}
export function mergeVertices(geometry,tolerance=1e-4){
  const names=Object.keys(geometry.attributes), arrays=Object.fromEntries(names.map(n=>[n,[]])), table=new Map(), indices=[],source=geometry.index;
  const count=source?source.count:geometry.attributes.position.count, tol=Math.max(tolerance,Number.EPSILON);
  for(let i=0;i<count;i++){
    const index=source?source.getX(i):i;let key='';
    for(const n of names){const a=geometry.attributes[n];for(let c=0;c<a.itemSize;c++)key+=Math.round(a.getComponent(index,c)/tol)+',';}
    let found=table.get(key);if(found===undefined){found=table.size;table.set(key,found);for(const n of names){const a=geometry.attributes[n];for(let c=0;c<a.itemSize;c++)arrays[n].push(a.getComponent(index,c));}}indices.push(found);
  }
  const out=new THREE.BufferGeometry();for(const n of names){const a=geometry.attributes[n];out.setAttribute(n,new THREE.BufferAttribute(new a.array.constructor(arrays[n]),a.itemSize,a.normalized));}out.setIndex(indices);return out;
}
