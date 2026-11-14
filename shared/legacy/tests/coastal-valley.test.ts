import assert from 'node:assert/strict';
import test from 'node:test';
import { collectEaldholtTerrainEdges, sampleEaldholtRiverPalette, createEaldholtRiverValleyBuffers, type EaldholtTerrainEdges, type EaldholtValleyMesh } from '../aethelgard/environment/river-valley';
import { refineEaldholtCoastalTransitions, sampleEaldholtCoastalShoreDistance, createEaldholtCoastalValleyBuffers, createEaldholtCoastalInspectionView, sampleEaldholtCoastalWater, sampleEaldholtCoastalWetness } from '../aethelgard/environment/coastal-valley';
import { ealdholtRiverMaterialWeights } from '../aethelgard/environment/river-surface';
import { sampleEaldholtWoodlandSupport } from '../aethelgard/environment/river-woodland';
const fixture = (): EaldholtTerrainEdges => {
  const edge = [[-10, 2], [0, 2.2], [10, 2]] as const;
  return { minX: -10, maxX: 10, minZ: -10, maxZ: 10, west: edge, east: edge, north: edge, south: edge };
};
const points = (mesh: EaldholtValleyMesh) => Array.from({ length: mesh.positions.length / 3 }, (_, i) => Array.from(mesh.positions.subarray(i * 3, i * 3 + 3)));
const surface = (mesh: EaldholtValleyMesh) => ({ positions: mesh.positions, indices: mesh.indices });

for (const profile of ['quest', 'desktop'] as const) test(`${profile}: coastal surround preserves immutable base/source joins and fits geometry budgets`, () => {
  const source = fixture(), base = createEaldholtRiverValleyBuffers(source, profile), before = structuredClone(base), result = createEaldholtCoastalValleyBuffers(source, profile, base);
  assert.deepEqual(base, before); assert.equal(result.sourceJoinVertices, base.sourceJoinVertices); assert.equal(result.water, result.channel);
  assert.ok(result.triangles < 15000); assert.ok(result.bufferBytes < 1024 * 1024);
  const originalJoin = points(base.land).filter(([x, , z]) => ((x === source.minX || x === source.maxX) && z >= source.minZ && z <= source.maxZ) || ((z === source.minZ || z === source.maxZ) && x >= source.minX && x <= source.maxX));
  const available = new Set(points(result.land).map(p => p.join(':'))); assert.ok(originalJoin.length > 8); for (const point of originalJoin) assert.ok(available.has(point.join(':')), `source join moved: ${point}`);
  for (const mesh of [result.land, result.channel, result.sea]) {
    assert.ok([...mesh.positions, ...mesh.normals, ...mesh.uv, ...mesh.colours].every(Number.isFinite));
    for (let i = 0; i < mesh.positions.length; i += 3) { assert.ok(mesh.normals[i + 1] > 0); assert.ok(Math.abs(Math.hypot(...mesh.normals.subarray(i, i + 3)) - 1) < 1e-5); assert.ok(Math.abs(mesh.uv[i / 3 * 2] - mesh.positions[i] / 2) < 1e-5); assert.ok(Math.abs(mesh.uv[i / 3 * 2 + 1] + mesh.positions[i + 2] / 2) < 1e-5); }
    for (let i = 0; i < mesh.indices.length; i += 3) {
      const ids = Array.from(mesh.indices.subarray(i, i + 3)); assert.ok(ids.every(id => id < mesh.positions.length / 3)); const p = ids.map(id => mesh.positions.subarray(id * 3, id * 3 + 3)), x = p.reduce((n, v) => n + v[0] / 3, 0), z = p.reduce((n, v) => n + v[2] / 3, 0);
      assert.ok(!(x > source.minX + 1e-5 && x < source.maxX - 1e-5 && z > source.minZ + 1e-5 && z < source.maxZ - 1e-5), 'no generated land/water may blanket the source village');
    }
    for (const point of points(mesh)) for (let c = 0; c < 3; c++) assert.ok(point[c] >= result.bounds.min[c] && point[c] <= result.bounds.max[c]);
  }
});

test('static shore wetness follows the actual widened banks and leaves distant low ground dry', () => {
  const result = createEaldholtCoastalValleyBuffers(fixture(), 'quest'), { shape } = result;
  assert.equal(result.landWetness.length, result.land.positions.length / 3);
  assert.ok([...result.landWetness].every(value => value >= 0 && value <= 1 && Number.isFinite(value)));
  assert.ok([...result.landWetness].some(value => value > .99)); assert.ok([...result.landWetness].some(value => value === 0));
  const z = (shape.mouthLowZ + shape.mouthHighZ) / 2;
  assert.equal(sampleEaldholtCoastalWetness(shape, shape.coastX - 2, shape.seaLevel - .2, z), 1);
  assert.equal(sampleEaldholtCoastalWetness(shape, shape.sourceMaxX, shape.seaLevel + .4, shape.sourceMinZ), 0, 'low ground far from water must remain dry');
  assert.equal(sampleEaldholtCoastalWetness(shape, shape.coastX + .1, shape.seaLevel + 2, shape.mouthLowZ - 1), 0, 'dry hillside must not receive a wetness stripe');
});

test('inlet widens away from the fixed near bank and connects to finite nonoverlapping sea', () => {
  const source = fixture(), base = createEaldholtRiverValleyBuffers(source, 'quest'), result = createEaldholtCoastalValleyBuffers(source, 'quest', base), { shape } = result, channel = result.channel.positions;
  const near = channel[2], far = channel[5], end = channel.length - 6;
  assert.equal(channel[0], shape.coastX); assert.equal(channel[1], shape.seaLevel); assert.equal(channel[4], shape.seaLevel);
  assert.ok(far - near > (channel[end + 5] - channel[end + 2]) * 2, 'broad inlet must continue as a narrower river');
  for (let i = 6; i < channel.length; i += 6) { const original = points(base.water).find(p => p[0] === channel[i]); assert.ok(original); assert.equal(channel[i + 2], original[2], 'near/north bank must stay fixed'); assert.equal(channel[i + 1], original[1]); }
  for (const point of points(result.channel)) assert.ok(point[0] >= shape.coastX);
  for (const point of points(result.sea)) assert.ok(point[0] <= shape.coastX);
  for (const z of [near, (near + far) / 2, far]) {
    const ocean = sampleEaldholtWoodlandSupport(surface(result.sea), shape.coastX - .001, z), river = sampleEaldholtWoodlandSupport(surface(result.channel), shape.coastX + .001, z + (z === far ? -.01 : z === near ? .01 : 0));
    assert.ok(ocean && river); assert.ok(Math.abs(ocean.height - shape.seaLevel) < 1e-6); assert.ok(Math.abs(river.height - shape.seaLevel) < 1e-4);
  }
  assert.equal(sampleEaldholtCoastalWater(shape, shape.seaMinX - 1, near), null);
  assert.equal(sampleEaldholtCoastalWater(shape, shape.coastX - 1, shape.seaMaxZ + 1), null);
});

test('coastal bank meets water gently and the widened mouth has submerged support', () => {
  const result = createEaldholtCoastalValleyBuffers(fixture(), 'quest'), { shape } = result;
  const z = (shape.mouthLowZ + shape.mouthHighZ) / 2;
  for (const x of [shape.coastX + .2, shape.coastX + 2, shape.coastX + 5]) {
    const water = sampleEaldholtCoastalWater(shape, x, z); if (!water) continue;
    const land = sampleEaldholtWoodlandSupport(surface(result.land), x, z); assert.ok(land); assert.ok(land.height < water.level - .03, 'the mouth must be water rather than land painted blue');
  }
  const dryZ = shape.sourceMinZ;
  const coastRow = Array.from({ length: shape.coastSamples.length / 2 }, (_, i) => [shape.coastSamples[i * 2], shape.coastSamples[i * 2 + 1]]).sort((a, b) => Math.abs(a[0] - dryZ) - Math.abs(b[0] - dryZ))[0];
  const edge = sampleEaldholtWoodlandSupport(surface(result.land), coastRow[1] + .01, coastRow[0]); assert.ok(edge); assert.ok(Math.abs(edge.height - shape.seaLevel) < .03, 'shore must not be a high vertical wall');
  const inland = sampleEaldholtWoodlandSupport(surface(result.land), coastRow[1] + 5, coastRow[0]); assert.ok(inland); assert.ok(inland.height > shape.seaLevel + .05);
});


test('inlet inspection keeps actual water ahead and observes from supported dry far-bank land for each profile', () => {
  const targets=[];
  for (const profile of ['quest','desktop'] as const) {
    const result=createEaldholtCoastalValleyBuffers(fixture(),profile), {shape}=result, view=createEaldholtCoastalInspectionView(shape);
    const target=sampleEaldholtCoastalWater(shape,view.target[0],view.target[2]);
    const camera=sampleEaldholtCoastalWater(shape,view.position[0],view.position[2]);
    const support=sampleEaldholtWoodlandSupport(surface(result.land),view.position[0],view.position[2]);
    assert.equal(target?.kind,'channel'); assert.equal(camera,null,'the observer must stay on the far bank rather than in the channel');
    assert.ok(support); assert.ok(support.height>(target?.level??Infinity)+.18,'the opposite-bank support must be dry');
    assert.ok(view.position[0]>view.target[0]); assert.ok(view.position[2]>view.target[2],'both the inlet and source-side woodland must be ahead');
    assert.ok(view.position[1]>support.height+4); assert.ok(view.target[0]>shape.coastX,'the open sea is beyond the target, not a substitute for the river');
    assert.ok(view.target.every(Number.isFinite)); targets.push(view.target[2]);
  }
  assert.ok(Math.abs(targets[1]-targets[0])>10,'Desktop and smaller Native channels need different physical anchors.');
});

function sampleAttributes(mesh:EaldholtValleyMesh,wetness:Float32Array,x:number,z:number) {
  const p=mesh.positions,ix=mesh.indices;
  for(let i=0;i<ix.length;i+=3){const ids=[ix[i],ix[i+1],ix[i+2]],a=ids[0]*3,b=ids[1]*3,c=ids[2]*3,dx=p[b]-p[a],dz=p[b+2]-p[a+2],ex=p[c]-p[a],ez=p[c+2]-p[a+2],det=dx*ez-ex*dz;
    if(Math.abs(det)<1e-12)continue;const u=((x-p[a])*ez-(z-p[a+2])*ex)/det,v=(dx*(z-p[a+2])-dz*(x-p[a]))/det;
    if(u< -1e-7||v< -1e-7||u+v>1.0000001)continue;const weights=[1-u-v,u,v];
    const get=(values:ArrayLike<number>,size:number,off:number)=>ids.reduce((sum,id,j)=>sum+weights[j]*values[id*size+off],0);
    const normal=[0,1,2].map(k=>get(mesh.normals,3,k)),ny=normal[1]/Math.hypot(...normal);
    return{y:get(p,3,1),palette:[0,1,2].map(k=>get(mesh.colours,3,k)),wet:get(wetness,1,0),ny};
  }
  throw Error('Missing transition support.');
}
function topology(mesh:EaldholtValleyMesh){
  const edges=new Map<string,number>();let area=0;
  for(let i=0;i<mesh.indices.length;i+=3){const ids=Array.from(mesh.indices.subarray(i,i+3)),p=ids.map(id=>mesh.positions.subarray(id*3,id*3+3));
    const up=(p[1][2]-p[0][2])*(p[2][0]-p[0][0])-(p[1][0]-p[0][0])*(p[2][2]-p[0][2]);assert.ok(up>0);area+=up/2;
    for(let j=0;j<3;j++){const [a,b]=[ids[j],ids[(j+1)%3]].sort((a,b)=>a-b),key=`${a}:${b}`;edges.set(key,(edges.get(key)??0)+1);}
  }
  assert.ok([...edges.values()].every(count=>count<=2));
  return{area,boundary:[...edges].filter(([,count])=>count===1).map(([key])=>key.split(':').map(Number).map(id=>Array.from(mesh.positions.slice(id*3,id*3+3)).join(':')).sort().join('|')).sort()};
}
test('nearly coincident Float32 coast cuts weld into manifold banks for a translated/scaled source grid', () => {
  const edges = collectEaldholtTerrainEdges(visit => {
    for (let row = 0; row <= 4; row++) for (let col = 0; col <= 4; col++) {
      const y = 10 - row * 5;
      visit(4 + (-10 + col * 5) * 1.1, 2 + Math.fround(y * Math.cos(Math.PI / 2)), -2 - y * 1.2);
    }
  });
  const before = structuredClone(edges), coast = createEaldholtCoastalValleyBuffers(edges, 'quest');
  topology(coast.land); assert.deepEqual(edges, before);
  assert.equal(coast.shape.sourceMinX, edges.minX); assert.equal(coast.shape.sourceMaxZ, edges.maxZ);
});
for(const profile of ['desktop','quest']as const)test(`${profile}: barycentric soil/turf and wetness agree with the physical shore beyond the damp edge`,()=>{
  const {shape}=createEaldholtCoastalValleyBuffers(fixture(),profile),p:number[]=[],n:number[]=[],uv:number[]=[],colours:number[]=[],indices:number[]=[];
  function banks(x:number){const rows=shape.channelSamples;for(let i=4;i<rows.length;i+=4)if(x>=rows[i-4]&&x<=rows[i]){const t=(x-rows[i-4])/(rows[i]-rows[i-4]);return[rows[i-3]+(rows[i+1]-rows[i-3])*t,rows[i-2]+(rows[i+2]-rows[i-2])*t];}throw Error('Unsupported test column.');}
  for(const side of [-1,1]){const start=p.length/3,centre=banks(20)[side<0?0:1],length=Math.hypot(1,.18);
    for(const distance of [1.8,20])for(const x of [19,20,21]){const z=banks(x)[side<0?0:1]+side*distance,y=shape.seaLevel+.45+.18*(side*(z-centre)-1.8);
      p.push(x,y,z);n.push(0,1/length,-side*.18/length);uv.push(x/2,-z/2);colours.push(...sampleEaldholtRiverPalette(x,z,distance,1/length));}
    for(let col=0;col<2;col++)for(const ids of [[start+col,start+col+3,start+col+1],[start+col+1,start+col+3,start+col+4]]){
      const[a,b,c]=ids.map(id=>id*3),up=(p[b+2]-p[a+2])*(p[c]-p[a])-(p[b]-p[a])*(p[c+2]-p[a+2]);indices.push(...(up>0?ids:[ids[0],ids[2],ids[1]]));}
  }
  const coarse:EaldholtValleyMesh={positions:Float32Array.from(p),normals:Float32Array.from(n),uv:Float32Array.from(uv),colours:Float32Array.from(colours),indices:Uint16Array.from(indices)},before=structuredClone(coarse);
  const refined=refineEaldholtCoastalTransitions(coarse,shape),wet=(mesh:EaldholtValleyMesh)=>Float32Array.from({length:mesh.positions.length/3},(_,i)=>sampleEaldholtCoastalWetness(shape,mesh.positions[i*3],mesh.positions[i*3+1],mesh.positions[i*3+2]));
  const oldWet=wet(coarse),newWet=wet(refined);assert.deepEqual(coarse,before);
  const oldTopology=topology(coarse),newTopology=topology(refined);assert.deepEqual(newTopology.boundary,oldTopology.boundary);assert.ok(Math.abs(newTopology.area-oldTopology.area)<.00005);
  for(const key of ['positions','normals','uv','colours']as const)assert.deepEqual(Array.from(refined[key]).slice(0,coarse[key].length),Array.from(coarse[key]),'every original seam tuple stays exact');
  let comparisons=0;
  for(const side of [-1,1])for(const distance of [6,10,15]){const x=20.17,z=banks(x)[side<0?0:1]+side*distance,a=sampleAttributes(coarse,oldWet,x,z),b=sampleAttributes(refined,newWet,x,z);
    const exactWet=sampleEaldholtCoastalWetness(shape,x,b.y,z),shore=sampleEaldholtCoastalShoreDistance(shape,x,z).distance;
    const exact=ealdholtRiverMaterialWeights(sampleEaldholtRiverPalette(x,z,shore,b.ny),b.ny,b.y-shape.seaLevel,exactWet),actual=ealdholtRiverMaterialWeights(b.palette,b.ny,b.y-shape.seaLevel,b.wet);
    assert.ok(Math.abs(b.y-a.y)<.00002,'refinement cannot change the crown support plane');assert.ok(Math.abs(b.wet-exactWet)<.005,'dampness cannot stretch across an entire dry bank face');
    // Four finite contours approximate the nonlinear turf knee on a curved
    // mouth; the dry10/15m region has the tighter classification tolerance.
    assert.ok(Math.abs(actual.grass-exact.grass)<(distance===6?.12:.04),'barycentric material reference '+JSON.stringify({profile,side,distance,actual,exact}));
    if(distance===6)assert.ok(b.wet<a.wet-.05&&actual.grass>ealdholtRiverMaterialWeights(a.palette,a.ny,a.y-shape.seaLevel,a.wet).grass+.3);
    comparisons++;
  }
  assert.equal(comparisons,6);
});
