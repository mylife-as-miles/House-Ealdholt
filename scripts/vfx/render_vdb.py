"""Render an OpenVDB sequence to linear premultiplied RGBA frames (npy) with Cycles on the CPU.
usage: python -I render_vdb.py <config.json>
Untrusted input: VDB files are only read as data by Blender's OpenVDB reader."""
import bpy, sys, json, os, math, time
import numpy as np
from mathutils import Vector, Matrix

cfg = json.load(open(sys.argv[1]))
out = cfg['out']; os.makedirs(out, exist_ok=True)
files = cfg['files']                      # ordered list of vdb paths
res = cfg.get('res', 256)
samples = cfg.get('samples', 64)
mode = cfg['mode']                        # 'fire' | 'smoke' | 'explosion'
up_rot = cfg.get('rot_x_deg', 90.0)
target = cfg.get('target_size', 2.0)      # longest sim extent mapped to this many metres

bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
sc.render.engine = 'CYCLES'
cy = sc.cycles
cy.device = 'CPU'; cy.samples = samples; cy.use_adaptive_sampling = False
cy.use_denoising = True; cy.denoiser = 'OPENIMAGEDENOISE'
cy.volume_bounces = cfg.get('volume_bounces', 3); cy.max_bounces = 6
cy.transparent_max_bounces = 8
cy.volume_biased = cfg.get("biased", True)
try: cy.volume_step_rate = cfg.get("step_rate", 1.0)
except Exception: pass
sc.render.threads_mode = 'FIXED'; sc.render.threads = cfg.get('threads', 4)
sc.render.film_transparent = True
sc.render.resolution_x = res; sc.render.resolution_y = res; sc.render.resolution_percentage = 100
sc.render.image_settings.file_format = 'OPEN_EXR'
sc.render.image_settings.color_mode = 'RGBA'
sc.render.image_settings.color_depth = '32'
sc.view_settings.view_transform = 'Standard'

# world: neutral ambient
w = bpy.data.worlds.new('w'); sc.world = w; w.use_nodes = True
bg = w.node_tree.nodes['Background']
bg.inputs[0].default_value = (1, 1, 1, 1); bg.inputs[1].default_value = cfg.get('ambient', 0.6)
if cfg.get('sun', 3.0) > 0:
    sd = bpy.data.lights.new('sun', 'SUN'); sd.energy = cfg.get('sun', 3.0); sd.angle = math.radians(20)
    so = bpy.data.objects.new('sun', sd); sc.collection.objects.link(so)
    # key from upper-left-front (camera looks along +Y)
    so.rotation_euler = (math.radians(50), 0, math.radians(-35))

# material
mat = bpy.data.materials.new('vol'); mat.use_nodes = True
nt = mat.node_tree; nt.nodes.clear()
o = nt.nodes.new('ShaderNodeOutputMaterial')
def attr(name):
    n = nt.nodes.new('ShaderNodeAttribute'); n.attribute_name = name; return n
def mathn(op, a, b=None):
    n = nt.nodes.new('ShaderNodeMath'); n.operation = op
    for i, v in enumerate((a, b)):
        if v is None: continue
        if isinstance(v, (int, float)): n.inputs[i].default_value = v
        else: nt.links.new(v, n.inputs[i])
    return n.outputs[0]
grids = cfg['grids']
shaders = []
if grids.get('density'):
    d = mathn('MULTIPLY', attr(grids['density']).outputs['Fac'], cfg.get('density', 10.0))
    s = nt.nodes.new('ShaderNodeVolumeScatter'); s.inputs['Color'].default_value = (*cfg.get('albedo', (0.85, 0.85, 0.85)), 1)
    s.inputs['Anisotropy'].default_value = cfg.get('anisotropy', 0.2)
    nt.links.new(d, s.inputs['Density']); shaders.append(s.outputs[0])
    if cfg.get('absorb', 0.0) > 0:
        a = nt.nodes.new('ShaderNodeVolumeAbsorption'); a.inputs['Color'].default_value = (0.2, 0.2, 0.2, 1)
        nt.links.new(mathn('MULTIPLY', d, cfg['absorb']), a.inputs['Density']); shaders.append(a.outputs[0])
if grids.get('emit'):
    # scalar driver (flames or temperature) -> normalised -> colour ramp -> emission
    t = mathn('MULTIPLY', attr(grids['emit']).outputs['Fac'], cfg.get('emit_scale', 1.0))
    ramp = nt.nodes.new('ShaderNodeValToRGB')
    stops = cfg.get('ramp', [[0.0, [0, 0, 0]], [0.15, [0.6, 0.05, 0.0]], [0.45, [1.0, 0.35, 0.03]], [0.8, [1.0, 0.75, 0.25]], [1.0, [1.0, 0.95, 0.8]]])
    cr = ramp.color_ramp
    while len(cr.elements) < len(stops): cr.elements.new(0.5)
    for el, (pos, col) in zip(cr.elements, stops):
        el.position = pos; el.color = (*col, 1)
    nt.links.new(t, ramp.inputs[0])
    e = nt.nodes.new('ShaderNodeEmission'); nt.links.new(ramp.outputs['Color'], e.inputs['Color'])
    st = mathn('MULTIPLY', mathn('POWER', mathn('MINIMUM', t, cfg.get('emit_clamp', 4.0)), cfg.get('emit_pow', 1.5)), cfg.get('emit_strength', 20.0))
    nt.links.new(st, e.inputs['Strength']); shaders.append(e.outputs[0])
    if cfg.get('emit_absorb', 0.0) > 0:
        a = nt.nodes.new('ShaderNodeVolumeAbsorption'); a.inputs['Color'].default_value = (0.05, 0.03, 0.02, 1)
        nt.links.new(mathn('MULTIPLY', t, cfg['emit_absorb']), a.inputs['Density']); shaders.append(a.outputs[0])
cur = shaders[0]
for s in shaders[1:]:
    add = nt.nodes.new('ShaderNodeAddShader'); nt.links.new(cur, add.inputs[0]); nt.links.new(s, add.inputs[1]); cur = add.outputs[0]
nt.links.new(cur, o.inputs['Volume'])

def load(path):
    v = bpy.data.volumes.new('v'); v.filepath = path
    ob = bpy.data.objects.new('v', v); sc.collection.objects.link(ob)
    v.materials.append(mat); v.grids.load()
    return ob
def unload(ob):
    v = ob.data; bpy.data.objects.remove(ob); bpy.data.volumes.remove(v)

# pass 1: union bbox (in raw sim units)
rot = Matrix.Rotation(math.radians(up_rot), 4, 'X')
lo = Vector((1e9,) * 3); hi = Vector((-1e9,) * 3)
fixed = cfg.get('frame_box')
if not fixed:
    for p in files[::max(1, len(files) // 16)] + [files[-1]]:
        ob = load(p)
        if len(ob.data.grids):
            for c in ob.bound_box:
                q = rot @ Vector(c)
                if abs(q.x) < 1e7:
                    for i in range(3): lo[i] = min(lo[i], q[i]); hi[i] = max(hi[i], q[i])
        unload(ob)
    print('BBOX', tuple(lo), tuple(hi))
else:
    lo = Vector(fixed[0]); hi = Vector(fixed[1])
ext = hi - lo
k = target / max(ext.x, ext.z)
side = max(ext.x, ext.z) * k * cfg.get('margin', 1.06)
cx = (lo.x + hi.x) / 2 * k; cy_ = (lo.y + hi.y) / 2 * k
ground = lo.z * k
anchor = cfg.get('anchor', 'ground')      # ground: frame bottom sits at sim floor; centre: bbox centre
cz = ground + side / 2 - (cfg.get('margin', 1.06) - 1) * side / 2 if anchor == 'ground' else (lo.z + hi.z) / 2 * k
cam_d = bpy.data.cameras.new('c'); cam_d.type = 'ORTHO'; cam_d.ortho_scale = side
cam_d.clip_start = 0.01; cam_d.clip_end = 1000
cam = bpy.data.objects.new('c', cam_d); sc.collection.objects.link(cam); sc.camera = cam
pitch = math.radians(cfg.get('pitch_deg', 0.0))   # look slightly down for board-like view
dist = 50
cam.location = (cx, cy_ - dist * math.cos(pitch), cz + dist * math.sin(pitch))
cam.rotation_euler = (math.radians(90) - pitch, 0, 0)

tmp = os.path.join(out, '_tmp.exr')
def shoot(p, r, smp):
    sc.render.resolution_x = r; sc.render.resolution_y = r; cy.samples = smp
    ob = load(p)
    ob.matrix_world = Matrix.Scale(k, 4) @ rot
    sc.render.filepath = tmp
    bpy.ops.render.render(write_still=True)
    unload(ob)
    img = bpy.data.images.load(tmp); img.colorspace_settings.name = 'Non-Color'
    a = np.empty(r * r * 4, dtype=np.float32); img.pixels.foreach_get(a)
    bpy.data.images.remove(img)
    return a.reshape(r, r, 4)[::-1]

fr = cfg.get('frame')
if fr:
    # explicit framing (metres after scaling), measured from an earlier render of the same simulation
    k = fr['scale']; side = fr['side']; cx = fr['cx']; cz = fr['cz']; ground = fr['ground']
    cam_d.ortho_scale = side; cam.location = (cx, cy_ - dist, cz)
    print('FRAME_OVERRIDE', fr, flush=True)
elif cfg.get('fit', True) and pitch == 0:
    # low-res prepass: tighten the square frame around what is actually visible
    r = 64; x0 = y0 = r; x1 = y1 = 0
    for p in files[::max(1, len(files) // 10)] + [files[-1]]:
        a = shoot(p, r, 12)
        m = (a[..., 3] > 0.03) | (a[..., :3].max(-1) > cfg.get('fit_rgb', 0.05))
        ys, xs = np.nonzero(m)
        if len(xs): x0 = min(x0, xs.min()); x1 = max(x1, xs.max() + 1); y0 = min(y0, ys.min()); y1 = max(y1, ys.max() + 1)
    px = side / r
    wl, wr = cx - side / 2 + x0 * px, cx - side / 2 + x1 * px
    wt, wb = cz + side / 2 - y0 * px, cz + side / 2 - y1 * px
    mg = cfg.get('margin', 1.06)
    side = max(wr - wl, wt - wb) * mg + 2 * px
    cx = (wl + wr) / 2
    if anchor == 'ground':
        pad = (mg - 1) * side / 2 + px
        cz = wb - pad + side / 2; ground = wb
    else:
        cz = (wt + wb) / 2; ground = cz - side / 2
    cam_d.ortho_scale = side
    cam.location = (cx, cy_ - dist, cz)
    print('FIT side', side, 'cx', cx, 'cz', cz, flush=True)
meta = dict(side_m=side, scale=k, sim_units_per_frame_side=side / k, bbox_lo=list(lo), bbox_hi=list(hi), pivot_v=(ground - (cz - side / 2)) / side, res=res, samples=samples, frames=len(files), cfg=cfg)
json.dump(meta, open(os.path.join(out, 'render.json'), 'w'), indent=1)
t0 = time.time()
for i, p in enumerate(files):
    dst = os.path.join(out, 'f%03d.npy' % i)
    if os.path.exists(dst): continue
    np.save(dst, shoot(p, res, samples).astype(np.float16))
    print('FRAME', i, len(files), '%.1fs' % (time.time() - t0), flush=True)
if os.path.exists(tmp): os.remove(tmp)
print('DONE')
