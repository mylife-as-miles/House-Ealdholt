// Small offline writer for static, source-derived regional prototypes. Runtime
// loading remains owned by each app's existing Three/AssetManager path.
import {writeFile} from 'node:fs/promises';
export function createStaticGlb(materials, images = []) {
  const json = {asset:{version:'2.0',generator:'Crownfall source-derived regional bake'},scene:0,scenes:[{nodes:[]}],
    nodes:[],meshes:[],materials,accessors:[],bufferViews:[],buffers:[{byteLength:0}],
    ...(images.length?{images:images.map(uri=>({uri})),textures:images.map((_,source)=>({source,sampler:0})),samplers:[{magFilter:9729,minFilter:9987,wrapS:10497,wrapT:10497}]}:{})};
  const chunks = []; let length = 0;
  function array(values, size, position = false) {
    const bytes = Buffer.from(values.buffer, values.byteOffset, values.byteLength), pad = (4 - length % 4) % 4;
    if (pad) {chunks.push(Buffer.alloc(pad));length+=pad;}
    const view=json.bufferViews.length;json.bufferViews.push({buffer:0,byteOffset:length,byteLength:bytes.length});chunks.push(bytes);length+=bytes.length;
    const componentType=values instanceof Float32Array?5126:values instanceof Uint16Array?5123:5125;
    const accessor={bufferView:view,componentType,count:values.length/size,type:['','SCALAR','VEC2','VEC3','VEC4'][size]};
    if(position){const min=Array(size).fill(Infinity),max=Array(size).fill(-Infinity);for(let i=0;i<values.length;i++){const k=i%size;min[k]=Math.min(min[k],values[i]);max[k]=Math.max(max[k],values[i]);}Object.assign(accessor,{min,max});}
    json.accessors.push(accessor);return json.accessors.length-1;
  }
  function geometry(g, material) {
    const attributes={};
    for(const [key,name] of Object.entries({position:'POSITION',normal:'NORMAL',uv:'TEXCOORD_0',color:'COLOR_0'})){
      const a=g.getAttribute(key);if(a){const values=Float32Array.from(a.array);if(a.isInterleavedBufferAttribute)throw Error('Offline GLB requires packed arrays.');attributes[name]=array(values,a.itemSize,key==='position');}
    }
    const indices=g.index?Uint32Array.from(g.index.array):Uint32Array.from({length:g.getAttribute('position').count},(_,i)=>i);
    const id=json.meshes.length;json.meshes.push({primitives:[{attributes,indices:array(indices,1),material}]});return id;
  }
  function group(name, extras={}) {const id=json.nodes.length;json.nodes.push({name,children:[],extras});json.scenes[0].nodes.push(id);return id;}
  function mesh(parent,name,g,material,matrix) {const id=json.nodes.length;json.nodes.push({name,mesh:geometry(g,material),...(matrix?{matrix:Array.from(matrix)}:{})});json.nodes[parent].children.push(id);return id;}
  /** Optional canonical image/mip payload. Existing mesh-only byte layout is
   * unchanged; callers explicitly own every declared view and MIME contract. */
  function blob(data) {
    const bytes=Buffer.from(data.buffer,data.byteOffset,data.byteLength),pad=(4-length%4)%4;
    if(pad){chunks.push(Buffer.alloc(pad));length+=pad;}
    const id=json.bufferViews.length;json.bufferViews.push({buffer:0,byteOffset:length,byteLength:bytes.length});chunks.push(bytes);length+=bytes.length;return id;
  }
  async function save(path) {
    json.buffers[0].byteLength=length;const raw=Buffer.from(JSON.stringify(json)),jp=(4-raw.length%4)%4,bp=(4-length%4)%4;
    const header=Buffer.alloc(20);header.writeUInt32LE(0x46546c67,0);header.writeUInt32LE(2,4);header.writeUInt32LE(12+8+raw.length+jp+8+length+bp,8);header.writeUInt32LE(raw.length+jp,12);header.writeUInt32LE(0x4e4f534a,16);
    const bh=Buffer.alloc(8);bh.writeUInt32LE(length+bp,0);bh.writeUInt32LE(0x004e4942,4);
    await writeFile(path,Buffer.concat([header,raw,Buffer.alloc(jp,32),bh,...chunks,Buffer.alloc(bp)]));
  }
  return {json,group,mesh,blob,save};
}
