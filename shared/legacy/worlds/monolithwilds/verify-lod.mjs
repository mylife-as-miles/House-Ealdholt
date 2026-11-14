// Regression tests for Monolith's source LOD, on small fixtures and on the real built world in both
// geometry profiles. CPU only: no GPU, pixel, frame-rate or headset claim.
// Run: CROWNFALL_THREE_MODULE=<consuming Three module file URL> node verify-lod.mjs
// CROWNFALL_LOD_FIXTURES_ONLY=1 skips the two real world builds.
// Geometry is compared by identity with assert.ok: assert.equal's failure diff on whole buffers runs out of memory.
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
if(!process.env.CROWNFALL_THREE_MODULE)throw Error('Set CROWNFALL_THREE_MODULE to the consuming Three module file URL');
const observed=[];
registerHooks({
  resolve(specifier,context,next){return next(specifier==='crownfall-world-three'?process.env.CROWNFALL_THREE_MODULE:specifier,context);},
  // Test-only wrapper so the real build can be compared with its own geometry before LOD.
  load(url,context,next){
    const result=next(url,context);
    if(!/monolithwilds\/source-lod\.js$/.test(url))return result;
    const source=Buffer.from(result.source).toString('utf8');
    assert.ok(source.includes('export async function applySourceLod('),'source-lod.js exports applySourceLod');
    return{...result,source:source.replace('export async function applySourceLod(','async function lodUnderTest(')+`
export async function applySourceLod(root,profile){
  const meshes=[];root.traverse(o=>{if(o.isMesh&&!o.isBatchedMesh&&o.geometry?.attributes.position)meshes.push(o);});
  const before=new Map();for(const{geometry:g}of meshes)if(!before.has(g))before.set(g,{attributes:{...g.attributes},index:g.index,instanced:g.isInstancedBufferGeometry});
  const report=await lodUnderTest(root,profile);
  globalThis.__monolithLodObservations?.push({profile,meshes,before,report});
  return report;
}`};
  },
});
globalThis.__monolithLodObservations=observed;
const T=await import('crownfall-world-three');
const {applySourceLod,CELL_METRES}=await import('./source-lod.js');
const pass=message=>console.log(`PASS ${message}`);
const rooted=(...meshes)=>{const root=new T.Group();root.add(...meshes);return root;};
const triangles=g=>(g.index?g.index.count:g.attributes.position.count)/3;
const standard=()=>new T.MeshStandardMaterial();
const large=()=>new T.PlaneGeometry(80,80,120,120);
const merged=(parts)=>{
  const position=[],normal=[],uv=[],index=[];let base=0;
  for(const part of parts){
    const p=part.attributes.position,n=part.attributes.normal,u=part.attributes.uv;
    for(let i=0;i<p.count;i++){position.push(p.getX(i),p.getY(i),p.getZ(i));normal.push(n.getX(i),n.getY(i),n.getZ(i));uv.push(u.getX(i),u.getY(i));}
    for(let i=0;i<part.index.count;i++)index.push(base+part.index.getX(i));
    base+=p.count;
  }
  const g=new T.BufferGeometry();
  g.setAttribute('position',new T.Float32BufferAttribute(position,3));g.setAttribute('normal',new T.Float32BufferAttribute(normal,3));g.setAttribute('uv',new T.Float32BufferAttribute(uv,2));g.setIndex(index);
  return g;
};
const boxAt=(w,h,d,x,y,z,segments=1)=>new T.BoxGeometry(w,h,d,segments,segments,segments).translate(x,y,z);
const extentOf=(g,keep)=>{const p=g.attributes.position,ix=g.index,box=new T.Box3(),v=new T.Vector3();for(let i=0;i<ix.count;i++){const k=ix.getX(i);v.fromBufferAttribute(p,k);if(keep(v))box.expandByPoint(v);}return box;};
const surfaceArea=g=>{const p=g.attributes.position,ix=g.index,a=new T.Vector3(),b=new T.Vector3(),c=new T.Vector3();let s=0;for(let i=0;i<ix.count;i+=3){a.fromBufferAttribute(p,ix.getX(i));b.fromBufferAttribute(p,ix.getX(i+1));c.fromBufferAttribute(p,ix.getX(i+2));s+=b.sub(a).cross(c.sub(a)).length()/2;}return s;};

// Geometry that the shader or material reads as more than a surface keeps every source vertex.
for(const mode of ['custom shader','transparent','alpha test','per-vertex payload','interleaved position','multiple materials','texture']){
  const geometry=large();let material=standard();
  if(mode==='custom shader')material=new T.ShaderMaterial();
  if(mode==='transparent')material.transparent=true;
  if(mode==='alpha test')material.alphaTest=.5;
  if(mode==='per-vertex payload')geometry.setAttribute('aFall',new T.BufferAttribute(new Float32Array(geometry.attributes.position.count*4),4));
  if(mode==='interleaved position'){const p=geometry.attributes.position,a=new Float32Array(p.count*5);for(let i=0;i<p.count;i++){a[i*5+1]=p.getX(i);a[i*5+2]=p.getY(i);a[i*5+3]=p.getZ(i);}geometry.setAttribute('position',new T.InterleavedBufferAttribute(new T.InterleavedBuffer(a,5),3,1));}
  if(mode==='multiple materials')material=[standard(),standard()];
  if(mode==='texture')material.map=new T.Texture();
  const position=geometry.attributes.position,index=geometry.index;
  await applySourceLod(rooted(new T.Mesh(geometry,material)),'quest');
  assert.ok(geometry.attributes.position===position,`${mode}: positions must be preserved`);
  assert.ok(geometry.index===index,`${mode}: faces must be preserved`);
}
pass('shader, transparent, alpha-tested, textured, multi-material and payload geometry keeps its source vertices');

// A plain surface does reduce, or the guards would be hiding a LOD that no longer works.
{
  const geometry=large(),source=triangles(geometry);
  await applySourceLod(rooted(new T.Mesh(geometry,standard())),'quest');
  assert.ok(triangles(geometry)<source*.5,'plain surfaces must reduce');
  pass(`plain surface reduces ${source} to ${triangles(geometry)} triangles`);
}

// The ruin case. Small buildings merged into a kilometres-wide mesh keep their own shape: the cell is
// metric, not a fraction of the mesh's bounds.
{
  const spots=[[-2400,-2400],[2400,-2400],[-2400,2400],[2400,2400]];
  const geometry=merged(spots.map(([x,z])=>boxAt(8,14,5,x,7,z,8)));
  await applySourceLod(rooted(new T.Mesh(geometry,standard())),'quest');
  for(const [x,z] of spots){
    const box=extentOf(geometry,v=>Math.hypot(v.x-x,v.z-z)<40),size=box.getSize(new T.Vector3());
    assert.ok(size.x>=8*.75&&size.y>=14*.75&&size.z>=5*.75,`building at ${x},${z} collapsed to ${size.toArray()}`);
  }
  pass('small buildings in a kilometres-wide merged mesh keep their extent in every axis');
}

// The dome case. Faces never bridge surfaces that do not touch, however close they sit.
{
  const a=new T.PlaneGeometry(40,40,60,60),b=new T.PlaneGeometry(40,40,60,60).translate(0,0,.0001);
  const geometry=merged([a,b]);
  await applySourceLod(rooted(new T.Mesh(geometry,standard())),'quest');
  const p=geometry.attributes.position,ix=geometry.index;
  let second=0;
  for(let i=0;i<ix.count;i+=3){
    const z=[p.getZ(ix.getX(i)),p.getZ(ix.getX(i+1)),p.getZ(ix.getX(i+2))];
    assert.ok(Math.max(...z)-Math.min(...z)<1e-7,'a face bridges two surfaces that do not touch');
    if(z[0]>5e-5)second++;
  }
  assert.ok(second>0,'the second surface must survive');
  pass('faces never bridge surfaces that do not touch');
}

// Thin connected beams keep their area instead of folding to a line. Tiny blocks are never erased.
{
  const beam=new T.BoxGeometry(60,.4,.4,60,1,1);
  const area=surfaceArea(beam);
  await applySourceLod(rooted(new T.Mesh(beam,standard())),'quest');
  assert.ok(surfaceArea(beam)>area*.7,`thin beam lost its area: ${surfaceArea(beam)} of ${area}`);
  const parts=[];for(let i=0;i<40;i++)parts.push(boxAt(.3,.3,.3,i*3,0,0,3));
  parts.push(new T.PlaneGeometry(400,400,40,40));
  const field=merged(parts);
  await applySourceLod(rooted(new T.Mesh(field,standard())),'quest');
  for(let i=0;i<40;i++){const box=extentOf(field,v=>Math.abs(v.x-i*3)<.4&&Math.abs(v.y)<.4&&Math.abs(v.z)<.4);assert.ok(!box.isEmpty(),`block ${i} was erased`);}
  pass('thin beams keep their area and tiny blocks are never erased');
}

// Hard edges stay hard and do not open: every weld keeps its normal sector and shares its position.
{
  const geometry=new T.BoxGeometry(60,60,60,60,60,60),before=triangles(geometry);
  await applySourceLod(rooted(new T.Mesh(geometry,standard())),'quest');
  assert.ok(triangles(geometry)<before,'a subdivided box must reduce');
  const n=geometry.attributes.normal;
  for(let i=0;i<n.count;i++)assert.ok(Math.max(Math.abs(n.getX(i)),Math.abs(n.getY(i)),Math.abs(n.getZ(i)))>.999,'a hard-edge normal was averaged');
  const p=geometry.attributes.position,ix=geometry.index,edges=new Map(),key=i=>`${p.getX(i)},${p.getY(i)},${p.getZ(i)}`;
  for(let i=0;i<ix.count;i+=3)for(let k=0;k<3;k++){
    const a=key(ix.getX(i+k)),b=key(ix.getX(i+(k+1)%3)),edge=a<b?`${a}|${b}`:`${b}|${a}`;edges.set(edge,(edges.get(edge)||0)+1);
  }
  for(const [edge,count] of edges)assert.ok(count%2===0,`crack along ${edge}`);
  pass('hard edges keep their normals and the welded box stays closed');
}

// Runtime LOD chains place their instances later, so their scale is unknown at build time.
{
  const prototype=new T.SphereGeometry(1,40,30),position=prototype.attributes.position,mesh=new T.InstancedMesh(prototype,standard(),8);
  mesh.instanceMatrix.setUsage(T.DynamicDrawUsage);mesh.count=0;
  await applySourceLod(rooted(mesh),'quest');
  assert.ok(prototype.attributes.position===position,'a prototype placed at runtime must be preserved');
  pass('prototypes placed at runtime keep their source vertices');
}

// A large instance needs finer source geometry for the same metric error.
{
  const prototype=()=>new T.PlaneGeometry(1,1,160,160),scaled=new T.InstancedMesh(prototype(),standard(),1),unit=new T.InstancedMesh(prototype(),standard(),1);
  scaled.setMatrixAt(0,new T.Matrix4().makeScale(400,1,400));unit.setMatrixAt(0,new T.Matrix4().makeScale(10,1,10));
  await applySourceLod(rooted(scaled),'quest');await applySourceLod(rooted(unit),'quest');
  assert.ok(triangles(scaled.geometry)>triangles(unit.geometry),'large instances need finer source geometry');
  pass('instance scale keeps finer source geometry on large instances');
}

if(process.env.CROWNFALL_LOD_FIXTURES_ONLY)process.exit(0);

// The real world in both profiles. Offscreen GPU bakes are stubbed; they do not feed the geometry LOD sees.
const gradient={addColorStop(){}};
const canvas=()=>{const element={width:1,height:1,style:{},getContext(){return context;},addEventListener(){},removeEventListener(){}},target={canvas:element,measureText:t=>({width:String(t).length*8}),createLinearGradient:()=>gradient,createRadialGradient:()=>gradient,createConicGradient:()=>gradient,createPattern:()=>({}),getImageData:(x,y,w,h)=>({data:new Uint8ClampedArray(w*h*4),width:w,height:h}),createImageData:(w,h)=>({data:new Uint8ClampedArray(w*h*4),width:w,height:h}),putImageData(){}},context=new Proxy(target,{get(t,k){return k in t?t[k]:()=>{};},set(t,k,v){t[k]=v;return true;}});return element;};
globalThis.document={createElement:name=>{if(name!=='canvas')throw Error(`Unexpected DOM element: ${name}`);return canvas();}};
globalThis.window={location:{search:''},innerHeight:480};globalThis.location=window.location;
const renderer=new Proxy({domElement:{width:640,height:480,addEventListener(){},removeEventListener(){}},coordinateSystem:T.WebGLCoordinateSystem,xr:{enabled:false},shadowMap:{autoUpdate:false},capabilities:{isWebGL2:true},toneMappingExposure:1,autoClear:true,getContext(){return{getExtension:()=>null,RENDERER:0,getParameter:()=>'CPU LOD verification'};},getDrawingBufferSize(v){return v.set(640,480);},getSize(v){return v.set(640,480);},getPixelRatio(){return 1;},getRenderTarget(){return null;},getActiveCubeFace(){return 0;},getActiveMipmapLevel(){return 0;},getClearColor(c){return c.set(0);},getClearAlpha(){return 1;},readRenderTargetPixels(rt,x,y,w,h,data){data.fill(0);},compileAsync:async()=>{}},{get(t,k){return k in t?t[k]:()=>{};},set(t,k,v){t[k]=v;return true;}});
const {buildWorld}=await import('./build.js');
const SOURCE_ONLY=/^(water-|life-|sky$)|:falls$|:mist$|^veg:|^loom:threads$/;
for(const profile of ['quest','desktop']){
  observed.length=0;
  const world=await buildWorld({THREE:T,scene:new T.Scene(),renderer,camera:new T.PerspectiveCamera(55,16/9,1,20000),profile,nationId:'korvenia'});
  const {meshes,before,report}=observed[0];
  const cell=CELL_METRES[profile];let welded=0,checked=0,falls=0;
  for(const mesh of meshes){
    const g=mesh.geometry,source=before.get(g);
    if(SOURCE_ONLY.test(mesh.name||'')&&source){
      assert.ok(g.attributes.position===source.attributes.position,`${profile} ${mesh.name}: source vertices must be kept`);
      assert.ok(g.index===source.index,`${profile} ${mesh.name}: source faces must be kept`);
      if(/falls$/.test(mesh.name))falls++;
    }
    if(!source||g.attributes.position===source.attributes.position)continue;
    source.checked=(source.checked||0)+1;if(source.checked>1)continue;
    welded++;
    // Every welded position is a source vertex, and every face stays on one source surface.
    const p=source.attributes.position,parent=new Int32Array(p.count),find=i=>{while(parent[i]!==i){parent[i]=parent[parent[i]];i=parent[i];}return i;},exact=new Map(),key=(a,i)=>`${a.getX(i)},${a.getY(i)},${a.getZ(i)}`;
    for(let i=0;i<p.count;i++){parent[i]=i;const k=key(p,i),seen=exact.get(k);if(seen===undefined)exact.set(k,i);else parent[find(i)]=find(seen);}
    const ix=source.index,corner=i=>ix?ix.getX(i):i,total=ix?ix.count:p.count;
    for(let i=0;i<total;i+=3){parent[find(corner(i+1))]=find(corner(i));parent[find(corner(i+2))]=find(corner(i));}
    const q=g.attributes.position,out=g.index;
    for(let i=0;i<out.count;i+=3){
      const [a,b,c]=[out.getX(i),out.getX(i+1),out.getX(i+2)].map(v=>exact.get(key(q,v)));
      assert.ok(a!==undefined&&b!==undefined&&c!==undefined,`${profile} ${mesh.name}: welded vertex left the source surface`);
      assert.ok(find(a)===find(b)&&find(b)===find(c),`${profile} ${mesh.name}: a face bridges surfaces that do not touch`);
    }
    // Every source surface of at least one cell keeps its extent, up to the welding tolerance.
    const low=new Map(),high=new Map(),seenLow=new Map(),seenHigh=new Map(),expand=(mapLow,mapHigh,id,i,a)=>{let l=mapLow.get(id),h=mapHigh.get(id);if(!l){l=[Infinity,Infinity,Infinity];h=[-Infinity,-Infinity,-Infinity];mapLow.set(id,l);mapHigh.set(id,h);}const v=[a.getX(i),a.getY(i),a.getZ(i)];for(let k=0;k<3;k++){l[k]=Math.min(l[k],v[k]);h[k]=Math.max(h[k],v[k]);}};
    for(let i=0;i<p.count;i++)expand(low,high,find(i),i,p);
    for(let i=0;i<out.count;i++){const v=out.getX(i);expand(seenLow,seenHigh,find(exact.get(key(q,v))),v,q);}
    let scale=1;if(mesh.isInstancedMesh){const m=mesh.instanceMatrix.array;for(let i=0;i<mesh.count;i++){const o=i*16;scale=Math.max(scale,Math.hypot(m[o],m[o+1],m[o+2]),Math.hypot(m[o+4],m[o+5],m[o+6]),Math.hypot(m[o+8],m[o+9],m[o+10]));}}
    const local=cell/scale;
    for(const [id,l] of low){
      const h=high.get(id),size=[h[0]-l[0],h[1]-l[1],h[2]-l[2]];
      if(Math.max(...size)<1e-3)continue;
      const kept=seenLow.get(id);assert.ok(kept,`${profile} ${mesh.name}: a source surface ${size.map(v=>v.toFixed(2))} was erased`);
      const keptHigh=seenHigh.get(id);
      for(let k=0;k<3;k++)assert.ok(size[k]-(keptHigh[k]-kept[k])<=Math.max(size[k]*.25,2*local*Math.SQRT2)+1e-3,`${profile} ${mesh.name}: a surface lost its extent on axis ${k}: ${size[k]} to ${keptHigh[k]-kept[k]}`);
      checked++;
    }
  }
  assert.ok(falls>=4,`${profile}: the waterfall ribbons must be present and kept`);
  assert.ok(report.lodTriangles<report.sourceTriangles,`${profile}: LOD must still reduce the world`);
  const stats=world.sourceStats();
  assert.ok(stats.trianglesByPart.orrery>0,`${profile}: the orrery must be in the triangle count`);
  pass(`${profile} world: ${welded} welded geometries and ${checked} source surfaces keep their shape; ${report.sourceTriangles} to ${report.lodTriangles} triangles; ${JSON.stringify(report.refused)}`);
  world.dispose();
}
