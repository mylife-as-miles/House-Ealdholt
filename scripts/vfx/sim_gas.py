"""Simulate one of Crownfall's own dust and smoke effects with Blender's Mantaflow gas solver and render it
to linear premultiplied RGBA frames (npy), in the layout pack.py reads (f000.npy ... and render.json).

usage: python sim_gas.py <effect> <outdir> [key=value ...]
  effect: fallDust | stepDust | musket | mist   (the presets below; key=value overrides a preset entry)
  preview=1 renders small and fast (128 px, 12 samples) for tuning.

Everything is CPU: Mantaflow in replay mode (each frame is solved as the scene steps to it), Cycles with
OpenImageDenoise. The simulation cache goes to <outdir>/_cache and is deleted at the end.
The presets are the provenance of the atlases: main game/public/assets/play/vfx/manifest.json records them."""
import bpy, sys, json, os, math, shutil, time
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import manta_bases
manta_bases.repair()   # bpy-as-a-module ships Mantaflow's classes without their parents' methods

PRESETS = {
    # A body hitting the stone: a thin sheet thrown out radially along the floor from under it, which curls
    # at its rim and thins. An open ring of fine dust, not a cloud: nothing is emitted upwards.
    'fallDust': dict(
        domain=(4.4, 4.4, 1.1), res=128, noise=2, fps=24, frames=34, warm=1,
        vorticity=0.55, alpha=-1.5, beta=0.0, dissolve=22, noise_strength=1.3, noise_pos=2.4,
        emitters=[
            dict(kind='ring', radius=(0.42, 0.26), height=0.08, z=0.05, on=(1, 3), density=1.0, normal=6.0, random=1.0, tex=0.9),
        ],
        forces=[
            # the slap of the body: air driven out sideways from the line of the impact, for a third of a second
            dict(type='FORCE', shape='LINE', at=(0, 0, 0), falloff=1.0, keys=[(1, 54), (5, 20), (10, 0)]),
            dict(type='TURBULENCE', size=0.3, keys=[(1, 0.8)]),
            # fine dust has no lift of its own: a steady settling draught keeps the sheet on the floor
            dict(type='WIND', rot=(180, 0, 0), keys=[(1, 0), (4, 0), (8, 1.8)]),
        ],
        frame=dict(side=3.3, cx=0.0, bottom=-0.07), density=20.0, anisotropy=0.3, samples=48, res_px=256),
    # A foot scuffing the stone: the same slap, smaller and to one side, gone in half a second. Simulated at the
    # fall's scale (the solver is steadier there) and framed tightly: the recipe's size makes it small.
    'stepDust': dict(
        domain=(4.4, 4.4, 1.1), res=128, noise=2, fps=30, frames=18, warm=1,
        vorticity=0.55, alpha=-1.5, beta=0.0, dissolve=14, noise_strength=1.3, noise_pos=2.4,
        emitters=[
            dict(kind='ring', radius=(0.3, 0.2), height=0.08, z=0.05, on=(1, 2), density=1.0, normal=5.0, random=1.0, tex=0.7),
        ],
        forces=[
            dict(type='FORCE', shape='LINE', at=(0, 0, 0), falloff=1.0, keys=[(1, 34), (4, 12), (8, 0)]),
            dict(type='WIND', rot=(0, 90, 0), keys=[(1, 10), (6, 0)]),           # the foot's own direction
            dict(type='TURBULENCE', size=0.3, keys=[(1, 0.9)]),
            dict(type='WIND', rot=(180, 0, 0), keys=[(1, 0), (3, 0), (6, 1.0)]),
        ],
        frame=dict(side=1.3, cx=0.05, bottom=-0.03), density=20.0, anisotropy=0.3, samples=48, res_px=256),
    # A musket's discharge seen down the line of the shot, so one sprite is right for a shot in any direction
    # (the recipe throws several along the barrel): a jet that blooms, rolls, then hangs and drifts as haze.
    'musket': dict(
        domain=(3.0, 3.6, 3.0), res=80, noise=2, fps=13, frames=48, warm=1,
        vorticity=0.7, alpha=0.0, beta=0.35, dissolve=70, noise_strength=1.6, noise_pos=2.0, floor=False,
        emitters=[
            dict(kind='disc', radius=(0.09, 0.09), z=1.25, y=1.3, on=(1, 4), density=1.0, coord=(0.0, -4.0, 0.0), random=1.5, tex=0.25, temperature=0.4),
        ],
        forces=[
            dict(type='WIND', rot=(90, 0, 0), keys=[(1, 30), (4, 10), (7, 0)]),   # the blast, towards the camera
            dict(type='TURBULENCE', size=0.45, keys=[(1, 5), (8, 2.5), (20, 1.4)]),
        ],
        frame=dict(side=2.6, cx=0.0, bottom=-0.05, pivot_z=1.25), density=11.0, anisotropy=0.35, samples=48, res_px=256),
    # Solforiz's dark mist: cold heavy vapour welling up round the feet and creeping outward over the floor,
    # densest at the stone. Emitted continuously; the atlas is a loop cut from the settled flow.
    'mist': dict(
        domain=(5.0, 5.0, 1.2), res=96, noise=2, fps=12, frames=50, warm=45,
        vorticity=0.45, alpha=-0.5, beta=0.0, dissolve=9, noise_strength=1.2, noise_pos=2.2,
        emitters=[
            dict(kind='ring', radius=(0.34, 0.34), height=0.2, z=0.12, on=(1, 9999), density=0.55, normal=0.95, random=0.5, tex=0.8, texanim=True),
        ],
        forces=[
            dict(type='FORCE', shape='LINE', at=(0, 0, 0), falloff=1.0, keys=[(1, 2.5)]),    # the creep outward
            dict(type='TURBULENCE', size=0.4, keys=[(1, 2.0)]),                                # what makes it roll
            dict(type='WIND', rot=(180, 0, 0), keys=[(1, 0.15)]),
        ],
        frame=dict(side=3.7, cx=0.0, bottom=-0.08), density=16.0, anisotropy=0.2, samples=48, res_px=256),
}

effect, out = sys.argv[1], sys.argv[2]
P = dict(PRESETS[effect])
for kv in sys.argv[3:]:
    k, v = kv.split('=', 1); P[k] = json.loads(v)
preview = bool(P.get('preview'))
os.makedirs(out, exist_ok=True)
cache = os.path.join(out, '_cache'); shutil.rmtree(cache, ignore_errors=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
sc.render.fps = P['fps']; sc.frame_start = 1; sc.frame_end = P['frames'] + P['warm'] + 1

# ---- domain: floor at z = 0
dx, dy, dz = P['domain']
bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, dz / 2)); dom = bpy.context.object
dom.scale = (dx, dy, dz); bpy.ops.object.transform_apply(scale=True)
d = dom.modifiers.new('fluid', 'FLUID'); d.fluid_type = 'DOMAIN'; d = d.domain_settings
d.domain_type = 'GAS'; d.resolution_max = P['res'] // (2 if preview else 1); d.use_adaptive_domain = False
d.cache_type = 'REPLAY'; d.cache_directory = cache; d.cache_frame_start = 1; d.cache_frame_end = sc.frame_end
for side in ('front', 'back', 'left', 'right', 'top'): setattr(d, 'use_collision_border_' + side, False)
d.use_collision_border_bottom = P.get('floor', True)
d.alpha = P['alpha']; d.beta = P['beta']; d.vorticity = P['vorticity']
d.use_dissolve_smoke = P['dissolve'] > 0; d.dissolve_speed = max(1, P['dissolve']); d.use_dissolve_smoke_log = True
d.use_noise = P['noise'] > 1; d.noise_scale = max(1, P['noise']); d.noise_strength = P['noise_strength']; d.noise_pos_scale = P['noise_pos']
d.time_scale = P.get('time_scale', 1.0); d.cfl_condition = 3.0; d.timesteps_max = 6; d.timesteps_min = 1

# ---- emitters
def keyframe(settings, prop, pairs):
    for f, v in pairs:
        setattr(settings, prop, v); settings.keyframe_insert(prop, frame=f)
for n, e in enumerate(P['emitters']):
    rx, ry = e['radius']
    if e['kind'] == 'ring':
        # an open band, normals outward: with normal velocity the gas leaves radially along the floor
        bpy.ops.mesh.primitive_cylinder_add(vertices=48, radius=1, depth=e['height'], end_fill_type='NOTHING', location=(e.get('x', 0), e.get('y', 0), e['z']))
    else:
        bpy.ops.mesh.primitive_circle_add(vertices=24, radius=1, fill_type='NGON', location=(e.get('x', 0), e.get('y', 0), e['z']), rotation=(math.radians(90), 0, 0))
    ob = bpy.context.object; ob.scale = (rx, ry if e['kind'] == 'ring' else rx, 1 if e['kind'] == 'ring' else rx)
    bpy.ops.object.transform_apply(scale=True)
    ob.hide_render = True
    f = ob.modifiers.new('fluid', 'FLUID'); f.fluid_type = 'FLOW'; f = f.flow_settings
    f.flow_type = 'SMOKE'; f.flow_behavior = 'INFLOW'; f.flow_source = 'MESH'; f.surface_distance = 1.0; f.volume_density = 0.0
    f.temperature = e.get('temperature', 0.0); f.subframes = 2
    f.use_initial_velocity = True; f.velocity_normal = e.get('normal', 0.0); f.velocity_coord = e.get('coord', (0, 0, 0)); f.velocity_random = e.get('random', 0.0)
    if e.get('tex'):
        tex = bpy.data.textures.new('breakup%d' % n, 'CLOUDS'); tex.noise_scale = e['tex'] * 0.35; tex.noise_depth = 3; tex.contrast = 2.2; tex.intensity = 0.85
        f.use_texture = True; f.noise_texture = tex; f.texture_size = 1.0
        if e.get('texanim'):
            # a continuous emitter must not print the same pattern for ever: slide the breakup through the band
            keyframe(f, 'texture_offset', [(1, 0.0), (sc.frame_end, 2.0)])
            for fc in f.id_data.animation_data.action.fcurves if hasattr(f.id_data.animation_data.action, 'fcurves') else []:
                for kp in fc.keyframe_points: kp.interpolation = 'LINEAR'
    a, b = e['on']; dens = e['density']
    keyframe(f, 'density', [(a - 1, 0.0), (a, dens), (min(b, sc.frame_end), dens), (min(b, sc.frame_end) + 1, 0.0)] if b < 9000 else [(1, dens)])

# ---- force fields: what carries the gas once it has left the emitter
for n, fo in enumerate(P.get('forces', [])):
    bpy.ops.object.effector_add(type=fo['type'], location=fo.get('at', (0, 0, 0)), rotation=[math.radians(a) for a in fo.get('rot', (0, 0, 0))])
    eo = bpy.context.object; eo.field.shape = fo.get('shape', 'POINT'); eo.field.falloff_power = fo.get('falloff', 0.0)
    if fo['type'] == 'TURBULENCE': eo.field.size = fo.get('size', 0.5); eo.field.flow = fo.get('flow', 0.0); eo.field.noise = fo.get('noise', 1.0)
    if 'max' in fo: eo.field.use_max_distance = True; eo.field.distance_max = fo['max']
    for f, v in fo['keys']:
        eo.field.strength = v; eo.field.keyframe_insert('strength', frame=f)

# ---- look: scattering only, lit white, so the game's tint is the colour
mat = bpy.data.materials.new('gas'); mat.use_nodes = True; nt = mat.node_tree; nt.nodes.clear()
o = nt.nodes.new('ShaderNodeOutputMaterial'); at = nt.nodes.new('ShaderNodeAttribute'); at.attribute_name = 'density'
mul = nt.nodes.new('ShaderNodeMath'); mul.operation = 'MULTIPLY'; mul.inputs[1].default_value = P['density']
s = nt.nodes.new('ShaderNodeVolumeScatter'); s.inputs['Color'].default_value = (0.85, 0.85, 0.85, 1); s.inputs['Anisotropy'].default_value = P['anisotropy']
nt.links.new(at.outputs['Fac'], mul.inputs[0]); nt.links.new(mul.outputs[0], s.inputs['Density']); nt.links.new(s.outputs[0], o.inputs['Volume'])
dom.data.materials.append(mat)

res = 128 if preview else P['res_px']; samples = 12 if preview else P['samples']
sc.render.engine = 'CYCLES'; cy = sc.cycles
cy.device = 'CPU'; cy.samples = samples; cy.use_adaptive_sampling = False
cy.use_denoising = True; cy.denoiser = 'OPENIMAGEDENOISE'
cy.volume_bounces = 2; cy.max_bounces = 6; cy.transparent_max_bounces = 8
try: cy.volume_step_rate = 1.0 if not preview else 2.0
except Exception: pass
sc.render.threads_mode = 'FIXED'; sc.render.threads = P.get('threads', 4)
sc.render.film_transparent = True; sc.render.use_persistent_data = True
sc.render.resolution_x = res; sc.render.resolution_y = res; sc.render.resolution_percentage = 100
sc.render.image_settings.file_format = 'OPEN_EXR'; sc.render.image_settings.color_mode = 'RGBA'; sc.render.image_settings.color_depth = '32'
sc.view_settings.view_transform = 'Standard'
w = bpy.data.worlds.new('w'); sc.world = w; w.use_nodes = True
bg = w.node_tree.nodes['Background']; bg.inputs[0].default_value = (1, 1, 1, 1); bg.inputs[1].default_value = 0.6
sd = bpy.data.lights.new('sun', 'SUN'); sd.energy = 3.0; sd.angle = math.radians(20)
so = bpy.data.objects.new('sun', sd); sc.collection.objects.link(so); so.rotation_euler = (math.radians(50), 0, math.radians(-35))

# ---- camera: orthographic, level with the floor, looking along +Y; a fixed square frame
fr = P['frame']; side = fr['side']; cz = fr['bottom'] + side / 2
cam_d = bpy.data.cameras.new('c'); cam_d.type = 'ORTHO'; cam_d.ortho_scale = side; cam_d.clip_start = 0.01; cam_d.clip_end = 200
cam = bpy.data.objects.new('c', cam_d); sc.collection.objects.link(cam); sc.camera = cam
cam.location = (fr['cx'], -50, cz); cam.rotation_euler = (math.radians(90), 0, 0)
pivot_v = (fr.get('pivot_z', 0.0) - fr['bottom']) / side

tmp = os.path.join(out, '_tmp.exr'); sc.render.filepath = tmp
meta = dict(side_m=side, scale=1.0, sim_units_per_frame_side=side, pivot_v=pivot_v, res=res, samples=samples, frames=P['frames'],
            cfg=dict(effect=effect, solver='Blender %s Mantaflow gas, replay cache' % bpy.app.version_string, **{k: v for k, v in P.items() if k not in ('preview',)}))
json.dump(meta, open(os.path.join(out, 'render.json'), 'w'), indent=1)
t0 = time.time(); first = P['warm'] + 1
for f in range(1, sc.frame_end + 1):
    ts = time.time(); sc.frame_set(f)     # replay mode: this solves the frame
    print('SOLVED', f, '%.1fs' % (time.time() - ts), flush=True)
    i = f - first - 1
    if i < 0 or i >= P['frames']: continue
    if P.get('only') and i not in P['only']: continue
    if P.get('quick'):
        # tuning only: no render, the solver's own density summed along the view (y) as a rough picture
        de = dom.evaluated_get(bpy.context.evaluated_depsgraph_get()).modifiers['fluid'].domain_settings
        g = np.array(de.density_grid, dtype=np.float32); r3 = np.array(de.domain_resolution)[::-1]
        g = g.reshape(tuple(r3 * round((g.size / r3.prod()) ** (1 / 3))))   # z, y, x; the noise grid when there is one
        a = 1 - np.exp(-g.sum(1) * P['density'] * dy / g.shape[1]); a = a[::-1]
        np.save(os.path.join(out, 'f%03d.npy' % i), np.stack([a * 0.8] * 3 + [a], -1).astype(np.float16))
        json.dump(dict(domain=P['domain'], grid=list(g.shape)), open(os.path.join(out, 'quick.json'), 'w'))
        continue
    bpy.ops.render.render(write_still=True)
    img = bpy.data.images.load(tmp); img.colorspace_settings.name = 'Non-Color'
    a = np.empty(res * res * 4, dtype=np.float32); img.pixels.foreach_get(a); bpy.data.images.remove(img)
    np.save(os.path.join(out, 'f%03d.npy' % i), a.reshape(res, res, 4)[::-1].astype(np.float16))
    print('FRAME', i, P['frames'], '%.1fs' % (time.time() - t0), flush=True)
if os.path.exists(tmp): os.remove(tmp)
shutil.rmtree(cache, ignore_errors=True)
print('DONE', flush=True)
os._exit(0)   # Mantaflow's teardown in the bpy module can crash on exit; everything is already written
