"""Stage: role props for the village smith.

* Cross-pein hammer: Poly Haven CC0 model by Tics, imported unchanged except for a
  cleaned stamp and pivot placement.
* Tongs, workpiece, anvil and stump: original Crownfall geometry with procedural
  materials. Workplace props are placed relative to the resident root in the
  work pose; hand props are re-parented to the hand bones by the motion stage.
"""
import math
import os

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector

from scene import triangle_count, vertex_array


def _mesh_from_bm(bm, name):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    obj = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(obj)
    for p in obj.data.polygons:
        p.use_smooth = True
    return obj


def _material(name, colour, metallic, roughness, emission=None, strength=0.0):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    b = mat.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*colour, 1.0)
    b.inputs["Metallic"].default_value = metallic
    b.inputs["Roughness"].default_value = roughness
    if emission:
        b.inputs["Emission Color"].default_value = (*emission, 1.0)
        b.inputs["Emission Strength"].default_value = strength
    return mat


def _worn_material(name, base, dark, metallic, rough, rough_var=0.15, scale=60.0, dark_amount=0.6, edge_light=None):
    """Procedural worn surface baked into the props atlas: two-tone noise (rust and scale on iron, grain on wood,
    soot on stone) and roughness that varies with it; edge_light brightens convex edges (worn metal)."""
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    b = nt.nodes["Principled BSDF"]
    tc = nt.nodes.new("ShaderNodeTexCoord")
    noise = nt.nodes.new("ShaderNodeTexNoise")
    noise.inputs["Scale"].default_value = scale
    noise.inputs["Detail"].default_value = 6.0
    noise.inputs["Roughness"].default_value = 0.62
    nt.links.new(tc.outputs["Object"], noise.inputs["Vector"])
    fine = nt.nodes.new("ShaderNodeTexNoise")
    fine.inputs["Scale"].default_value = scale * 6.0
    fine.inputs["Detail"].default_value = 3.0
    nt.links.new(tc.outputs["Object"], fine.inputs["Vector"])
    ramp = nt.nodes.new("ShaderNodeMapRange")
    ramp.inputs["From Min"].default_value = 0.42
    ramp.inputs["From Max"].default_value = 0.62
    nt.links.new(noise.outputs["Fac"], ramp.inputs["Value"])
    mix = nt.nodes.new("ShaderNodeMix")
    mix.data_type = "RGBA"
    mix.inputs[6].default_value = (*base, 1.0)
    mix.inputs[7].default_value = (*dark, 1.0)
    k = nt.nodes.new("ShaderNodeMath")
    k.operation = "MULTIPLY"
    k.inputs[1].default_value = dark_amount
    nt.links.new(ramp.outputs["Result"], k.inputs[0])
    nt.links.new(k.outputs[0], mix.inputs[0])
    out_col = mix.outputs[2]
    if edge_light is not None:
        geo = nt.nodes.new("ShaderNodeNewGeometry")
        edge = nt.nodes.new("ShaderNodeMapRange")
        edge.inputs["From Min"].default_value = 0.5
        edge.inputs["From Max"].default_value = 0.56
        nt.links.new(geo.outputs["Pointiness"], edge.inputs["Value"])
        mix2 = nt.nodes.new("ShaderNodeMix")
        mix2.data_type = "RGBA"
        nt.links.new(out_col, mix2.inputs[6])
        mix2.inputs[7].default_value = (*edge_light, 1.0)
        nt.links.new(edge.outputs["Result"], mix2.inputs[0])
        out_col = mix2.outputs[2]
    fine_k = nt.nodes.new("ShaderNodeMix")
    fine_k.data_type = "RGBA"
    fine_k.blend_type = "MULTIPLY"
    fine_k.inputs[0].default_value = 0.25
    nt.links.new(out_col, fine_k.inputs[6])
    nt.links.new(fine.outputs["Color"], fine_k.inputs[7])
    nt.links.new(fine_k.outputs[2], b.inputs["Base Color"])
    r = nt.nodes.new("ShaderNodeMapRange")
    r.inputs["To Min"].default_value = rough - rough_var
    r.inputs["To Max"].default_value = rough + rough_var
    nt.links.new(noise.outputs["Fac"], r.inputs["Value"])
    nt.links.new(r.outputs["Result"], b.inputs["Roughness"])
    b.inputs["Metallic"].default_value = metallic
    return mat


def import_hammer(ph_dir):
    path = os.path.join(ph_dir, "cross_pein_hammer", "cross_pein_hammer_1k.gltf")
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    new = [o for o in bpy.data.objects if o not in before]
    meshes = [o for o in new if o.type == "MESH"]
    bpy.ops.object.select_all(action="DESELECT")
    for o in meshes:
        o.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    if len(meshes) > 1:
        bpy.ops.object.join()
    hammer = bpy.context.view_layer.objects.active
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    for o in new:
        if o is not hammer and o.name in bpy.data.objects:
            bpy.data.objects.remove(o)
    hammer.name = "prop_hammer"
    hammer.parent = None
    # Canonical frame: handle along +Y with the butt at y=0 and the head at the far end, striking face
    # toward -Z. The first version picked the head end from the spread of the outermost 15 percent of
    # vertices; the steel head holds 60 percent of this asset's vertices, so both percentile sets lay in
    # the head and the test flipped the hammer: the hand closed on the head and the butt struck the anvil.
    # Both ends are now judged by geometry, within a fixed distance of each end.
    co = vertex_array(hammer)
    centre = co.mean(axis=0)
    pts = co - centre
    _, _, vt = np.linalg.svd(pts, full_matrices=False)
    axis = vt[0]
    proj = pts @ axis
    length = float(proj.max() - proj.min())
    band = 0.1 * length

    def perpendicular_extent(sel):
        q = pts[sel] - np.outer(proj[sel], axis)
        q = q - q.mean(axis=0)
        return float(np.ptp(q @ np.linalg.svd(q, full_matrices=False)[2][0]))
    if perpendicular_extent(proj < proj.min() + band) > perpendicular_extent(proj > proj.max() - band):
        axis, proj = -axis, -proj  # the head (widest across the handle) belongs at the far end
    head_sel = proj > proj.max() - band
    hp = pts[head_sel] - np.outer(proj[head_sel], axis)
    hp_c = hp - hp.mean(axis=0)
    _, _, vt2 = np.linalg.svd(hp_c, full_matrices=False)
    face = vt2[0]  # the head's long axis, across the handle
    # Of the head's two ends the striking face is square; the cross pein is a wedge, thin along the handle.
    along = hp_c @ face
    ends = []
    for sign in (1.0, -1.0):
        sel = along * sign > np.abs(along).max() * 0.75
        ends.append(float(np.ptp(proj[head_sel][sel])))
    if ends[1] > ends[0]:
        face = -face
    y = Vector(axis).normalized()
    z = -Vector(face).normalized()
    x = y.cross(z).normalized()
    z = x.cross(y).normalized()
    rot = Matrix((x, y, z)).transposed()  # columns are the new axes in old space
    butt = centre + axis * proj.min()
    m = (Matrix.Translation(Vector(butt)) @ rot.to_4x4()).inverted()
    hammer.data.transform(m)
    hammer.data.update()
    co = vertex_array(hammer)
    head = co[co[:, 1] > length - band]
    face_pts = head[head[:, 2] < head[:, 2].min() + 0.004]
    hammer["face_local"] = [float(v) for v in face_pts.mean(axis=0)]
    hammer["head_centre_local"] = [float(v) for v in head.mean(axis=0)]
    return hammer, length


def tongs(length=0.46):
    """Two forged arms crossing at a rivet; jaws closed on a small bar. Handle along +Y from the grip."""
    def arm(sign):
        pts = [(0.012 * sign, -0.02, 0.0), (0.010 * sign, 0.12, 0.0), (0.006 * sign, 0.27, 0.0), (0.0, 0.32, 0.0),
               (-0.006 * sign, 0.37, 0.004), (-0.004 * sign, 0.43, 0.008), (0.0, 0.46, 0.006)]
        curve = bpy.data.curves.new(f"tong_arm_{sign}", "CURVE")
        curve.dimensions = "3D"
        curve.bevel_depth = 0.0055
        curve.bevel_resolution = 1
        sp = curve.splines.new("POLY")
        sp.points.add(len(pts) - 1)
        for p, c in zip(sp.points, pts):
            p.co = (c[0], c[1] * length / 0.46, c[2], 1.0)
        obj = bpy.data.objects.new(f"tong_arm_{sign}", curve)
        bpy.context.scene.collection.objects.link(obj)
        dg = bpy.context.evaluated_depsgraph_get()
        me = bpy.data.meshes.new_from_object(obj.evaluated_get(dg))
        bpy.data.objects.remove(obj)
        mobj = bpy.data.objects.new(f"tong_arm_{sign}", me)
        bpy.context.scene.collection.objects.link(mobj)
        return mobj
    a, b = arm(1), arm(-1)
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=10, radius1=0.008, radius2=0.008, depth=0.022)
    rivet = _mesh_from_bm(bm, "tong_rivet")
    rivet.location = (0.0, 0.32 * length / 0.46, 0.0)
    bpy.ops.object.select_all(action="DESELECT")
    for o in (a, b, rivet):
        o.select_set(True)
    bpy.context.view_layer.objects.active = a
    bpy.ops.object.transform_apply(location=True)
    bpy.ops.object.join()
    t = bpy.context.view_layer.objects.active
    t.name = "prop_tongs"
    for p in t.data.polygons:
        p.use_smooth = True
    return t


def workpiece():
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co = Vector((v.co.x * 0.016, v.co.y * 0.2, v.co.z * 0.014))
    bmesh.ops.bevel(bm, geom=bm.edges[:], offset=0.002, segments=1, affect="EDGES")
    obj = _mesh_from_bm(bm, "prop_workpiece")
    return obj


def anvil(face_height):
    """Horned smith's anvil (original): a side profile with face, waist and splayed feet extruded through a width
    that narrows at the waist, a tapering horn with a curved underside, a stepped table and a heel with a hardy
    hole; edges bevelled. Face top at z=0 (placed at face_height)."""
    # side profile (x along the anvil, z up): heel at +x, horn at -x
    prof = [(0.17, 0.0), (0.17, -0.07), (0.1, -0.09), (0.07, -0.14), (0.085, -0.2), (0.15, -0.23), (0.15, -0.255),
            (-0.15, -0.255), (-0.15, -0.23), (-0.085, -0.2), (-0.07, -0.14), (-0.1, -0.09), (-0.12, -0.07), (-0.12, -0.012),
            (-0.105, -0.012), (-0.105, 0.0)]
    bm = bmesh.new()
    half_w = lambda z: 0.055 if z > -0.09 else (0.04 if z > -0.19 else 0.075)
    front = [bm.verts.new((x, -half_w(z), z)) for x, z in prof]
    back = [bm.verts.new((x, half_w(z), z)) for x, z in prof]
    n = len(prof)
    bm.faces.new(front[::-1])
    bm.faces.new(back)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((front[i], front[j], back[j], back[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    # horn: a cone from the table end, its underside curving up toward the tip
    rings = 7
    horn = []
    for k in range(rings + 1):
        t = k / rings
        r = 0.042 * (1 - t) ** 0.9 + 0.004
        cx = -0.115 - 0.17 * t
        cz = -0.042 + 0.022 * t * t
        ring = []
        for a in range(10):
            ang = 2 * math.pi * a / 10
            ring.append(bm.verts.new((cx, r * math.cos(ang), cz + r * math.sin(ang) * (0.8 if math.sin(ang) < 0 else 1.0))))
        horn.append(ring)
    for k in range(rings):
        for a in range(10):
            b2 = (a + 1) % 10
            bm.faces.new((horn[k][a], horn[k][b2], horn[k + 1][b2], horn[k + 1][a]))
    bm.faces.new(horn[-1])
    bm.faces.new(horn[0][::-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    bmesh.ops.bevel(bm, geom=[e for e in bm.edges if e.calc_length() > 0.02 and e.calc_face_angle(0.0) > 0.6],
                    offset=0.004, segments=2, affect="EDGES")
    # hardy hole: a dark square inset on the heel of the face
    for f in bm.faces:
        c = f.calc_center_median()
        if f.normal.z > 0.95 and c.z > -0.002 and c.x > 0.12:
            res = bmesh.ops.inset_region(bm, faces=[f], thickness=0.012, depth=-0.006)
            break
    obj = _mesh_from_bm(bm, "prop_anvil")
    for p in obj.data.polygons:
        p.use_smooth = p.area < 0.002
    obj.location = (0.0, 0.0, face_height)
    return obj


def stump(height, radius=0.2):
    bm = bmesh.new()
    rng = np.random.default_rng(5)
    r = bmesh.ops.create_cone(bm, cap_ends=True, segments=18, radius1=radius, radius2=radius * 0.94, depth=height)
    for v in r["verts"]:
        ang = math.atan2(v.co.y, v.co.x)
        k = 1.0 + 0.05 * math.sin(3 * ang + 0.7) + 0.03 * math.sin(7 * ang + 2.0)
        v.co = Vector((v.co.x * k, v.co.y * k, v.co.z + height / 2))
    obj = _mesh_from_bm(bm, "prop_stump")
    return obj


def build(arm, recipe, ph_dir, report):
    spec = recipe["props"]
    hammer, hammer_len = import_hammer(ph_dir)
    t = tongs(spec["tongsLength"])
    w = workpiece()
    face_h = spec["anvilFaceHeight"]
    a = anvil(0.0)
    s = stump(face_h - 0.255)
    a.location = (0.0, 0.0, face_h)
    # worn surfaces, baked into the props atlas: forge scale and rust on the iron, a dull worked face (not
    # polished: it read as a mirror), end grain and soot on the stump
    iron = _worn_material("iron", (0.075, 0.071, 0.067), (0.11, 0.06, 0.035), 0.75, 0.66, 0.12, 45.0, 0.55,
                          edge_light=(0.2, 0.195, 0.19))
    face = _worn_material("anvil_face", (0.24, 0.235, 0.228), (0.12, 0.115, 0.11), 0.85, 0.42, 0.1, 90.0, 0.45)
    hot = _material("hot_iron", (0.3, 0.08, 0.02), 0.6, 0.45, emission=(1.0, 0.32, 0.06), strength=2.5)
    wood = _worn_material("stump_wood", (0.15, 0.105, 0.07), (0.05, 0.04, 0.032), 0.0, 0.85, 0.08, 18.0, 0.6)
    for obj, mats in ((t, [iron]), (a, [iron]), (w, [iron, hot]), (s, [wood])):
        obj.data.materials.clear()
        for m in mats:
            obj.data.materials.append(m)
    # the hot end of the workpiece (far from the tongs) glows
    for poly in w.data.polygons:
        poly.material_index = 1 if poly.center.y > 0.06 else 0
    for poly in a.data.polygons:
        if poly.normal.z > 0.9 and poly.center.z > -0.005:
            if len(a.data.materials) < 2:
                a.data.materials.append(face)
            poly.material_index = 1
    report["props"] = {"hammerLength": round(hammer_len, 3), "anvilFaceHeight": face_h,
                       # prop frame: butt at the origin, handle along +Y, striking face toward -Z (metres)
                       "hammerFaceLocal": [round(v, 4) for v in hammer["face_local"]],
                       "hammerHeadCentreLocal": [round(v, 4) for v in hammer["head_centre_local"]],
                       "triangles": {o.name: triangle_count(o) for o in (hammer, t, w, a, s)}}
    for o in (hammer, t, w, a, s):
        o["crownfall_part"] = "prop"
    return {"hammer": hammer, "tongs": t, "workpiece": w, "anvil": a, "stump": s}
