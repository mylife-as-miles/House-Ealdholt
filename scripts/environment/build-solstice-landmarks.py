"""Convert Solstice's CC0 cove kit and MIT temple recipe to Crownfall GLBs.
Run with Blender --background --factory-startup --python this_file -- SOURCE OUT.
The original village is never opened or edited by this offline build.
"""
import bpy, math, os, sys, json, hashlib, shutil
from mathutils import Matrix, Vector
from pathlib import Path
args=sys.argv[sys.argv.index('--')+1:]; source=Path(args[0]); out=Path(args[1]);out.mkdir(parents=True,exist_ok=True)
def reset():
 bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
 for collection in [bpy.data.meshes,bpy.data.materials,bpy.data.images]:
  for value in list(collection):
   if value.users==0:collection.remove(value)
def export(name,objects):
 # Merge static draw batches by source material; retain source meshes so the
 # second export derives independently from the same authored geometry.
 batches={};copies=[]
 for original in objects:
  obj=original.copy();obj.data=original.data.copy();bpy.context.collection.objects.link(obj)
  key=tuple(m.name for m in obj.data.materials);batches.setdefault(key,[]).append(obj)
 for key,parts in batches.items():
  bpy.ops.object.select_all(action='DESELECT')
  for obj in parts:obj.select_set(True)
  bpy.context.view_layer.objects.active=parts[0];bpy.ops.object.join();copies.append(parts[0])
  parts[0].name=name.replace('.glb','')+' / '+str(key[0] if key else 'stone')
 bpy.ops.object.select_all(action='DESELECT')
 for obj in copies:obj.select_set(True)
 limit=256 if 'quest' in name else 512
 for image in bpy.data.images:
  if image.size[0]>limit or image.size[1]>limit:
   factor=limit/max(image.size);image.scale(max(1,round(image.size[0]*factor)),max(1,round(image.size[1]*factor)))
 bpy.ops.export_scene.gltf(filepath=str(out/name),export_format='GLB',use_selection=True,export_animations=False,export_cameras=False,export_lights=False,export_extras=True)
 for obj in copies:bpy.data.objects.remove(obj,do_unlink=True)
def simplify(obj,target):
 faces=sum(len(p.vertices)-2 for p in obj.data.polygons)
 if faces<=target:return
 bpy.context.view_layer.objects.active=obj;obj.select_set(True)
 if obj.data.shape_keys:obj.shape_key_clear()
 modifier=obj.modifiers.new('Source silhouette LOD','DECIMATE');modifier.ratio=max(.001,target/faces)
 bpy.ops.object.modifier_apply(modifier=modifier.name);obj.select_set(False)
def fort():
 reset();scene=(source/'scenes/cove.txt').read_text();cache={};made=[]
 # Keep the actual authored fort, furnishings and landward cliff cluster. The
 # ship/water are separate from the fort asset, so Crownfall owns sea level.
 for line in scene.splitlines():
  fields=line.split()
  if not fields or fields[0] not in ['part','model']:continue
  kind,path=fields[:2];name=Path(path).stem
  if kind=='model' and name not in ['coastal_cliff_04','gothic_statue','horse_statue_01','marble_bust_01','wooden_barrels_01']:continue
  offset=3 if kind=='part' else 2
  x,y,z,yaw,scale=fields[offset:offset+5]
  if y.startswith('ground'):y='0'
  x,y,z,yaw,scale=map(float,[x,y,z,yaw,scale])
  if name=='coastal_cliff_04' and x>0:continue
  if name not in cache:
   before=set(bpy.data.objects);bpy.ops.import_scene.gltf(filepath=str(source/'target/scan'/name/(name+'.gltf')))
   imported=[o for o in bpy.data.objects if o not in before];cache[name]=imported
   for o in imported:o.hide_render=True;o.select_set(False)
  imported=cache[name]
  if kind=='part':
   matches=[o for o in imported if o.name.split('.')[0] in [fields[2],name+'_'+fields[2]]]
   if len(matches)!=1:raise ValueError('Missing exact source fort part: '+fields[2])
   parent=matches[0];pieces=[o for o in [parent,*parent.children_recursive] if o.type=='MESH'];pivot=parent.matrix_world.translation.copy()
  else:pieces=[o for o in imported if o.type=='MESH'];pivot=Vector((0,0,0))
  transform=Matrix.Translation((x,-z,y))@Matrix.Rotation(math.radians(yaw),4,'Z')@Matrix.Scale(scale,4)@Matrix.Translation(-pivot)
  for original in pieces:
   mesh=original.copy();mesh.data=original.data.copy();bpy.context.collection.objects.link(mesh);mesh.parent=None
   mesh.matrix_world=transform@original.matrix_world;mesh.hide_render=False;mesh['source_model']=name
   simplify(mesh,10000 if name=='coastal_cliff_04' else 6000);made.append(mesh)
 # Delete import templates, retaining only independent output meshes/materials.
 for objects in cache.values():
  for obj in objects:bpy.data.objects.remove(obj,do_unlink=True)
 export('western-fort-desktop.glb',made)
 for obj in made:simplify(obj,3000 if obj.get('source_model')=='coastal_cliff_04' else 1200)
 export('western-fort-quest.glb',made)
 print('FORT-COMPLETE',len(made),flush=True)
def smooth(a,b,x):
 t=max(0,min(1,(x-a)/(b-a)));return t*t*(3-2*t)
def random(seed,lane):
 v=(seed*374761393+lane*668265263)&0xffffffff;v=((v^(v>>13))*1274126177)&0xffffffff;return ((v^(v>>16))&0xffffffff)/4294967296
def surface(name,vertices,faces):
 mesh=bpy.data.meshes.new(name);mesh.from_pydata(vertices,[],faces);mesh.update()
 obj=bpy.data.objects.new(name,mesh);bpy.context.collection.objects.link(obj)
 for poly in mesh.polygons:poly.use_smooth=True
 return obj
def column(radial,rows):
 vertices=[];faces=[];height=7.5
 for row in range(rows+1):
  t=row/rows;shaft=.62-.14*t+.022*math.sin(t*math.pi);radius=shaft+smooth(.885,.955,t)*.26+smooth(.955,.958,t)*.05
  fluting=1-smooth(.87,.885,t);square=smooth(.953,.957,t)
  for col in range(radial):
   u=col/radial;theta=u*math.tau;c,s=math.cos(theta),math.sin(theta);phase=(u*20)%1-.5
   flute=math.sqrt(max(0,1-(phase*2)**2))*.045*fluting;shaped=radius*(1+(1/max(abs(c),abs(s))-1)*square)
   erosion=.009*math.sin(theta*7+t*41)+.004*math.sin(theta*31-t*89)
   r=shaped-flute+erosion;vertices.append((r*c,-r*s,t*height))
 for row in range(rows):
  for col in range(radial):
   a=row*radial+col;b=row*radial+(col+1)%radial;faces.append((a,b,b+radial,a+radial))
 faces.extend([tuple(reversed(range(radial))),tuple(rows*radial+i for i in range(radial))]);return surface('Solstice fluted column',vertices,faces)
def temple():
 reset();made=[]
 def mat(name,colour,roughness):
  value=bpy.data.materials.new(name);value.diffuse_color=(*colour,1);value.use_nodes=True;node=value.node_tree.nodes.get('Principled BSDF');node.inputs['Base Color'].default_value=(*colour,1);node.inputs['Roughness'].default_value=roughness;return value
 sandstone=mat('Solstice weathered sandstone',(.43,.39,.30),1);marble=mat('Solstice aged marble',(.64,.62,.56),.9)
 bpy.ops.mesh.primitive_cube_add(size=1);block=bpy.context.object;block.name='Source rounded masonry block';bevel=block.modifiers.new('Rounded stone edges','BEVEL');bevel.width=.022;bevel.segments=2;bpy.ops.object.modifier_apply(modifier=bevel.name)
 block.data.materials.append(sandstone);col=column(80,40);col.data.materials.append(marble)
 def put(template,name,x,y,z,sx=1,sy=1,sz=1,yaw=0,fallen=0,material=None):
  obj=template.copy();obj.data=template.data;bpy.context.collection.objects.link(obj);obj.name=name
  obj.matrix_world=Matrix.Translation((x,-z,y))@Matrix.Rotation(yaw,4,'Z')@Matrix.Rotation(fallen,4,'Y')@Matrix.Diagonal((sx,sz,sy,1))
  if material is not None:
   obj.data=obj.data.copy();obj.data.materials.clear();obj.data.materials.append(material)
  made.append(obj);return obj
 for level,inset in [(0,0),(1,.7),(2,1.4)]:
  hx,hz=10.5-inset,19.5-inset;x=-hx
  while x<hx-.001:
   width=min(2,hx-x);z=-hz
   while z<hz-.001:
    depth=min(2.4,hz-z);put(block,'Stepped temple foundation',x+width/2,.2+level*.4,z+depth/2,width*.995,.4,depth*.995,material=marble if level==2 else None);z+=depth
   x+=width
 positions=[]
 for i in range(6):
  x=-8.25+16.5*i/5;positions.extend([(x,-17.25),(x,17.25)])
 for i in range(1,11):
  z=-17.25+34.5*i/11;positions.extend([(-8.25,z),(8.25,z)])
 for i,(x,z) in enumerate(positions):
  fallen=i in [3,14,21];direction=1 if x>0 else -1
  put(col,'Fallen column drum' if fallen else 'Fluted peristyle column',x+(direction*3 if fallen else 0),1.1 if fallen else 1.2,z,yaw=random(i,6)*math.tau,fallen=-direction*1.53 if fallen else 0)
 def beam(a,b,index):
  x,z=(a[0]+b[0])/2,(a[1]+b[1])/2;dx,dz=b[0]-a[0],b[1]-a[1]
  put(block,'Broken entablature',x,9.1,z,math.hypot(dx,dz)+.1,.8,1.15,yaw=math.atan2(-dz,dx),material=marble)
 for i in range(5):
  x0=-8.25+16.5*i/5;x1=-8.25+16.5*(i+1)/5;beam((x0,17.25),(x1,17.25),i)
  if i!=1:beam((x0,-17.25),(x1,-17.25),i+50)
 for i in range(11):
  z0=-17.25+34.5*i/11;z1=-17.25+34.5*(i+1)/11
  if i!=5:beam((8.25,z0),(8.25,z1),i+100)
  if i!=8:beam((-8.25,z0),(-8.25,z1),i+150)
 def wall(a,b,seed):
  dx,dz=b[0]-a[0],b[1]-a[1];length=math.hypot(dx,dz);yaw=math.atan2(-dz,dx)
  for course in range(10):
   distance=-.875 if course%2 else 0;index=0
   while distance<length:
    size=1.75*(.86+random(seed+course*1000+index,1)*.28);lo=max(0,distance);hi=min(length,distance+size)
    if hi-lo>.12:
     t=(hi+lo)/2/length;put(block,'Cella masonry course',a[0]+dx*t,1.2+(course+.5)*.82,a[1]+dz*t,hi-lo,.82*.99,.9,yaw=yaw)
    distance+=size;index+=1
 for a,b,seed in [((-5,-12),(-5,12),1000),((5,-12),(5,12),2000),((-5,-12),(5,-12),3000),((-5,12),(-1.6,12),4000),((1.6,12),(5,12),5000)]:wall(a,b,seed)
 put(block,'Chamber doorway lintel',0,7.35,12,3.3,1.1,.9)
 for i in range(20):
  if i%5!=2:put(block,'Partly open chamber roof',0,9.8,-11.4+i*1.2,11.2,.7,1.1)
 bpy.data.objects.remove(block,do_unlink=True);bpy.data.objects.remove(col,do_unlink=True)
 export('temple-ruins-desktop.glb',made)
 for obj in made:
  if 'column' in obj.name.lower():obj.data=obj.data.copy();simplify(obj,1600)
 export('temple-ruins-quest.glb',made);print('TEMPLE-COMPLETE',len(made),flush=True)
fort();temple()
manifest={'schema':1,'source':{'repository':'https://github.com/SamG-Coder/solstice','revision':'32e0279901379592fff06a785fcc0d45a7cbe17d','codeLicense':'MIT','fortModels':'Poly Haven CC0'},'files':{}}
for path in [*out.glob('western-fort-*.glb'),*out.glob('temple-ruins-*.glb')]:
 data=path.read_bytes();manifest['files'][path.name]={'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()}
(out/'landmarks.manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')

shutil.copyfile(source/'LICENSE',out/'LICENSE.Solstice.txt')
(out/'LANDMARK_PROVENANCE.md').write_text("Adapted from SamG-Coder/solstice at 32e0279901379592fff06a785fcc0d45a7cbe17d (MIT). Temple: apps/bake/src/scene.rs and meshes.rs. Fort: scenes/cove.txt, using Poly Haven CC0 modular_fort_01, coastal_cliff_04, gothic_statue, horse_statue_01, marble_bust_01, wooden_barrels_01. Sources: https://polyhaven.com/a/ followed by each asset ID. Licence: https://polyhaven.com/license . No reference terrain, sea, ship or Rust renderer is imported. Background scenery with no canonical names or collision authority.\n")
