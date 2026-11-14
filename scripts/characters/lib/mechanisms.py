"""Animated work props (original Crownfall code, motion stage): the child's bellows and the spinner's drop spindle.

The first work loops moved only the body: the bellows lever rode rigidly in the child's right hand (its pivot drifted
2 to 3 cm off the post), its far end lifted up to 12 cm off a static chain and the bellows boards never moved; the
spindle was one rigid prop at the fibre hand that never turned. Here the mechanisms are keyed per frame from the same
clip and exported as an animation of the same name in the set's props GLB (NLA track = clip name):

* bellows: the lever rotates about its pivot on the post (the child's hands are solved onto its crossbar, so the pivot
  is exact), the chain runs from the lever's back end to the bellows' top board, which hinges at the nozzle end as the
  chain lifts it, and each leather pleat stretches with the opening above it;
* spindle: the spindle hangs plumb from the yarn in the fibre hand (its local transform under the hand socket undoes
  the hand's rotation) and spins, faster after each twirl, a whole number of turns per loop so the loop closes.
The integration plays the props clip of the same name, on the props attached to the resident, at the body clip's time.
"""
import math

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Quaternion, Vector

FPS = 30


def key_object(obj, clip, matrices):
    """Key an object's local transform (loc, quaternion, scale) per frame on an NLA track named `clip`."""
    if obj.animation_data is None:
        obj.animation_data_create()
    action = bpy.data.actions.new(f"{obj.name}_{clip}")
    obj.animation_data.action = action
    obj.rotation_mode = "QUATERNION"
    prev = None
    for i, m in enumerate(matrices):
        loc, rot, scale = m.decompose()
        if prev is not None and prev.dot(rot) < 0:
            rot = -rot
        prev = rot
        obj.location, obj.rotation_quaternion, obj.scale = loc, rot, scale
        obj.keyframe_insert("location", frame=i)
        obj.keyframe_insert("rotation_quaternion", frame=i)
        obj.keyframe_insert("scale", frame=i)
    track = obj.animation_data.nla_tracks.new()
    track.name = clip
    strip = track.strips.new(clip, 0, action)
    strip.name = clip
    obj.animation_data.action = None
    loc, rot, scale = matrices[0].decompose()
    obj.location, obj.rotation_quaternion, obj.scale = loc, rot, scale


def _split(obj, select_face, name):
    """Move the faces where select_face(poly) is true into a new object (same materials, UVs, origin)."""
    me = obj.data
    bm = bmesh.new()
    bm.from_mesh(me)
    keep = [f for f in bm.faces if not select_face(f)]
    move = [f for f in bm.faces if select_face(f)]
    if not move:
        bm.free()
        return None
    new_me = me.copy()
    new_me.name = name
    bm2 = bmesh.new()
    bm2.from_mesh(new_me)
    bm2.faces.ensure_lookup_table()
    ids = {f.index for f in move}
    bmesh.ops.delete(bm2, geom=[f for f in bm2.faces if f.index not in ids], context="FACES")
    bm2.to_mesh(new_me)
    bm2.free()
    bmesh.ops.delete(bm, geom=move, context="FACES")
    bm.to_mesh(me)
    bm.free()
    me.update()
    new = bpy.data.objects.new(name, new_me)
    bpy.context.scene.collection.objects.link(new)
    new.matrix_world = obj.matrix_world.copy()
    for k in ("crownfall_part", "placement"):
        if k in obj:
            new[k] = obj[k]
    new["mechanism"] = True
    return new


def _components(obj):
    """Split an object into its loose parts; returns the new objects (the original keeps one part)."""
    bpy.ops.object.select_all(action="DESELECT")
    obj.hide_set(False)
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    before = set(bpy.data.objects)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.separate(type="LOOSE")
    bpy.ops.object.mode_set(mode="OBJECT")
    new = [o for o in bpy.data.objects if o not in before]
    for i, o in enumerate(new):
        o.name = f"{obj.name}_{i + 1}"
        o.data.name = o.name
        for k in ("crownfall_part", "placement", "mechanism"):
            if k in obj:
                o[k] = obj[k]
    return new


def bellows(recipe, lever_world, clip="work_bellows"):
    """Key the bellows mechanism from the clip's per-frame lever matrices (Blender, resident root frame)."""
    lv, bw = recipe["props"]["lever"], recipe["props"]["bellows"]
    pivot = Vector(lv["pivot"])
    back = lv.get("backLength", 0.36)
    bx, bz = bw["back"], bw["base"]
    length = bw["length"]
    by = pivot.y - back
    lever = bpy.data.objects["prop_bellows_lever"]
    body = bpy.data.objects["prop_bellows"]
    chain = bpy.data.objects["prop_bellows_chain"]
    for o in (lever, chain):
        o["placement"] = "workplace"
        o["mechanism"] = True
        o.pop("grip_bone", None)
        o.pop("grip_matrix", None)
    # the top board (wood above the base) and the leather pleats leave the static bellows body
    mats = body.data.materials

    def is_lid(f):
        m = mats[f.material_index].name if f.material_index < len(mats) and mats[f.material_index] else ""
        return "wood" in m and (body.matrix_world @ f.calc_center_median()).z > bz + 0.08
    lid = _split(body, is_lid, "prop_bellows_lid")

    def is_pleat(f):
        m = mats[f.material_index].name if f.material_index < len(mats) and mats[f.material_index] else ""
        return "leather" in m
    pleats_obj = _split(body, is_pleat, "prop_bellows_pleats")
    pleats = [pleats_obj] + (_components(pleats_obj) if pleats_obj is not None else [])
    # hinge: the lid's front (nozzle end) lower edge; the chain lifts the lid near its back end
    co = np.array([list(lid.matrix_world @ v.co) for v in lid.data.vertices])
    front = co[co[:, 0] > co[:, 0].max() - 0.01]
    hinge = Vector((float(co[:, 0].max()), by, float(front[:, 2].min())))
    attach0 = Vector((bx + 0.06, by, float(co[co[:, 0] < co[:, 0].min() + 0.03][:, 2].max())))
    d = hinge.x - attach0.x
    far0 = lever_world[0] @ Vector((0.0, -back, 0.0))
    chain_len = (far0 - attach0).length
    # the chain mesh becomes a unit tube along +Y from its origin, scaled to the span each frame
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=6, radius1=0.008, radius2=0.008, depth=1.0,
                          matrix=Matrix.Translation((0.0, 0.5, 0.0)) @ Matrix.Rotation(math.radians(90), 4, "X"))
    mat_list = list(chain.data.materials)
    old_me = chain.data
    chain.data = bpy.data.meshes.new("prop_bellows_chain")
    bm.to_mesh(chain.data)
    bm.free()
    for m in mat_list:
        chain.data.materials.append(m)
    # copy the chain's UVs crudely: a single layer is enough for the atlas bake
    if not chain.data.uv_layers:
        chain.data.uv_layers.new(name="UVMap")
    bpy.data.meshes.remove(old_me)
    rest_lid = lid.matrix_world.copy()
    lever_m, lid_m, chain_m, pleat_m = [], [], [], {p.name: [] for p in pleats}
    pleat_info = []
    for p in pleats:
        pc = np.array([list(p.matrix_world @ v.co) for v in p.data.vertices])
        pleat_info.append((p, float(pc[:, 0].mean()), float(pc[:, 2].min()), float(pc[:, 2].max()), p.matrix_world.copy()))
    angles = []
    for m in lever_world:
        lever_m.append(m.copy())
        far = m @ Vector((0.0, -back, 0.0))
        # the chain stays taut: the lid's attachment keeps its length from the lever's back end
        lift = max(0.0, (far.z - far0.z))
        a = math.asin(max(0.0, min(0.5, lift / max(0.05, d))))
        angles.append(a)
        rot = Matrix.Translation(hinge) @ Matrix.Rotation(a, 4, "Y") @ Matrix.Translation(-hinge)
        lid_m.append(rot @ rest_lid)
        attach = rot @ attach0
        span = attach - far
        y_axis = span.normalized()
        x_axis = y_axis.cross(Vector((0.0, 0.0, 1.0)))
        x_axis = x_axis.normalized() if x_axis.length > 1e-6 else Vector((1.0, 0.0, 0.0))
        z_axis = x_axis.cross(y_axis).normalized()
        basis = Matrix((x_axis, y_axis, z_axis)).transposed().to_4x4()
        chain_m.append(Matrix.Translation(far) @ basis @ Matrix.Diagonal((1.0, span.length, 1.0, 1.0)))
        for p, px, z0, z1, rest in pleat_info:
            # the opening above each pleat grows with its distance from the hinge
            grow = (hinge.x - px) * math.sin(a)
            k = (z1 - z0 + grow) / max(1e-3, z1 - z0)
            s = Matrix.Translation((0.0, 0.0, z0)) @ Matrix.Diagonal((1.0, 1.0, k, 1.0)) @ Matrix.Translation((0.0, 0.0, -z0))
            pleat_m[p.name].append(s @ rest)
    key_object(lever, clip, lever_m)
    key_object(lid, clip, lid_m)
    key_object(chain, clip, chain_m)
    for p in pleats:
        key_object(p, clip, pleat_m[p.name])
    return {"lidMaxDegrees": round(math.degrees(max(angles)), 1), "chainLengthMetres": round(chain_len, 3),
            "hingeBlender": [round(v, 3) for v in hinge], "mechanismNodes": [lever.name, lid.name, chain.name] + [p.name for p in pleats]}


def split_spindle_yarn(drop):
    """Round 2: the yarn leaves the spindle node as its own node (prop_spindle_yarn, same grip, origin at the yarn top,
    the thread running down -Z), so a clip can let it pay out and wind in: the spinner drops the spindle from her girdle
    and winds it back up in work_enter and work_exit. In the work loop it follows the spindle exactly."""
    obj = bpy.data.objects.get("prop_spindle")
    if obj is None or bpy.data.objects.get("prop_spindle_yarn") is not None:
        return bpy.data.objects.get("prop_spindle_yarn")
    yarn = _split(obj, lambda f: all(v.co.z > -drop + 0.002 for v in f.verts), "prop_spindle_yarn")
    if yarn is not None:
        yarn.pop("mechanism", None)
        yarn["grip_like"] = "prop_spindle"
        yarn["yarn_length"] = drop - 0.004
    return yarn


def key_spindle_and_yarn(clip, spindle_local, yarn_local):
    """Key the spindle and its yarn (hand-local matrices per frame) on NLA tracks named `clip`."""
    key_object(bpy.data.objects["prop_spindle"], clip, spindle_local)
    yarn = bpy.data.objects.get("prop_spindle_yarn")
    if yarn is not None:
        key_object(yarn, clip, yarn_local)


def spindle_plumb(rig, frames, grip_l, clip):
    """Key the spindle plumb under the fibre hand through a work transition (round 2: work_enter, work_exit), without
    spinning: same rule as the work loop's clip, so the spindle hangs from the yarn wherever the hand carries it."""
    obj = bpy.data.objects["prop_spindle"]
    out = []
    for rot, loc in frames:
        pose = rig.fk(rot, loc)
        top = (pose["hand_l"] @ grip_l).translation
        out.append(pose["hand_l"].inverted() @ Matrix.Translation(top))
    key_object(obj, clip, out)
    return {"spindleClip": clip}


def spindle(rig, frames, grip_l, spec, twirl_seconds, clip="work_spindle", base_rev_s=1.6, boost_rev_s=2.4):
    """Key the spindle under the fibre hand: plumb from the yarn, spinning (a whole number of turns per loop)."""
    obj = bpy.data.objects["prop_spindle"]
    n = len(frames)
    T = (n - 1) / FPS
    # angular speed: a steady spin plus a boost that decays after the twirl; scaled to whole turns per loop
    w = []
    for i in range(n):
        t = i / FPS
        dt = (t - twirl_seconds) % T
        w.append(base_rev_s + boost_rev_s * math.exp(-dt / 1.2))
    total = sum(w[:-1]) / FPS
    k = max(1, round(total)) / total
    angle, angles = 0.0, []
    for i in range(n):
        angles.append(angle)
        angle += 2 * math.pi * w[i] * k / FPS
    pose0 = rig.fk(*frames[0])
    world0 = pose0["hand_l"] @ grip_l
    r0 = world0.to_3x3()
    out = []
    for i, (rot, loc) in enumerate(frames):
        pose = rig.fk(rot, loc)
        top = (pose["hand_l"] @ grip_l).translation  # the yarn leaves the fist here
        world = Matrix.Translation(top) @ (Matrix.Rotation(angles[i], 3, "Z") @ r0).to_4x4()
        out.append(pose["hand_l"].inverted() @ world)
    out[-1] = out[0].copy()
    key_spindle_and_yarn(clip, out, out)
    return {"turnsPerLoop": max(1, round(total)), "spinRevPerSecond": [round(min(w) * k, 2), round(max(w) * k, 2)]}
