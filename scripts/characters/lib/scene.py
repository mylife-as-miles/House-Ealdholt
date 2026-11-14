"""Small Blender helpers shared by the resident pipeline stages (original code)."""
import bmesh
import bpy
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree


def to_blender(c):
    """MakeHuman decimetres (+Y up, +Z forward) to Blender metres (+Z up, -Y forward)."""
    return (c[0] * 0.1, -c[2] * 0.1, c[1] * 0.1)


def to_blender_array(coords):
    out = np.empty_like(coords)
    out[:, 0] = coords[:, 0] * 0.1
    out[:, 1] = -coords[:, 2] * 0.1
    out[:, 2] = coords[:, 1] * 0.1
    return out


def link(obj, collection=None):
    (collection or bpy.context.scene.collection).objects.link(obj)
    return obj


def new_mesh(name, verts, faces, uvs=None, face_uvs=None, smooth=True, uv_name="UVMap"):
    """verts: Nx3 Blender coords; faces: lists of vertex indices; uvs + face_uvs: per-face uv index lists."""
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(map(float, v)) for v in verts], [], [list(f) for f in faces])
    if uvs is not None and face_uvs is not None:
        layer = me.uv_layers.new(name=uv_name)
        data = np.zeros(len(me.loops) * 2)
        for poly, fuv in zip(me.polygons, face_uvs):
            for k in range(poly.loop_total):
                t = fuv[k]
                u, v = uvs[t] if t >= 0 else (0.0, 0.0)
                data[(poly.loop_start + k) * 2] = u
                data[(poly.loop_start + k) * 2 + 1] = v
        layer.data.foreach_set("uv", data)
    me.validate(clean_customdata=False)
    if smooth:
        me.polygons.foreach_set("use_smooth", [True] * len(me.polygons))
    obj = bpy.data.objects.new(name, me)
    link(obj)
    return obj


def vertex_array(obj, shape_key=None):
    me = obj.data
    n = len(me.vertices)
    out = np.zeros(n * 3)
    if shape_key is None:
        me.vertices.foreach_get("co", out)
    else:
        me.shape_keys.key_blocks[shape_key].data.foreach_get("co", out)
    return out.reshape(n, 3)


def set_vertex_array(obj, coords):
    obj.data.vertices.foreach_set("co", np.asarray(coords, dtype=np.float64).ravel())
    obj.data.update()


def normals_array(obj):
    me = obj.data
    n = len(me.vertices)
    out = np.zeros(n * 3)
    me.vertices.foreach_get("normal", out)
    return out.reshape(n, 3)


def triangle_count(obj):
    return sum(len(p.vertices) - 2 for p in obj.data.polygons)


def weights_of(obj):
    """Per-vertex dict bone -> weight for an object's vertex groups."""
    names = {g.index: g.name for g in obj.vertex_groups}
    out = [dict() for _ in obj.data.vertices]
    for v in obj.data.vertices:
        for g in v.groups:
            if g.weight > 0:
                out[v.index][names[g.group]] = g.weight
    return out


def assign_weights(obj, per_vertex, armature, max_influences=4):
    """Replace vertex groups with normalized top-N bone weights and add an armature modifier."""
    for g in list(obj.vertex_groups):
        obj.vertex_groups.remove(g)
    groups = {}
    for bone in armature.data.bones:
        groups[bone.name] = obj.vertex_groups.new(name=bone.name)
    by_bone = {}
    for index, bw in enumerate(per_vertex):
        items = sorted(((b, w) for b, w in bw.items() if w > 1e-6 and b in groups), key=lambda kv: -kv[1])[:max_influences]
        total = sum(w for _, w in items)
        if total <= 0:
            raise RuntimeError(f"{obj.name}: vertex {index} has no bone influence")
        for bone, w in items:
            by_bone.setdefault((bone, round(w / total, 6)), []).append(index)
    for (bone, w), indices in by_bone.items():
        groups[bone].add(indices, w, "REPLACE")
    mod = next((m for m in obj.modifiers if m.type == "ARMATURE"), None) or obj.modifiers.new("Armature", "ARMATURE")
    mod.object = armature
    obj.parent = armature
    obj.matrix_parent_inverse.identity()


class SurfaceBinding:
    """Bind points to the nearest triangle of a source mesh to transfer weights and shape-key deltas."""

    def __init__(self, source):
        self.source = source
        me = source.data
        me.calc_loop_triangles()
        self.verts = vertex_array(source)
        self.tris = np.array([t.vertices[:] for t in me.loop_triangles], dtype=np.int64)
        self.tree = BVHTree.FromPolygons([tuple(v) for v in self.verts], [tuple(t) for t in self.tris], all_triangles=True)
        self.weights = weights_of(source)

    def bind(self, points, max_distance=1.0):
        out = []
        for p in points:
            hit = self.tree.find_nearest(Vector(p), max_distance)
            if hit[0] is None:
                raise RuntimeError("Surface binding found no source triangle")
            loc, _normal, tri, _dist = hit
            a, b, c = (self.verts[i] for i in self.tris[tri])
            out.append((tri, _barycentric(np.asarray(loc), a, b, c)))
        return out

    def transfer_weights(self, binding):
        result = []
        for tri, bary in binding:
            acc = {}
            for vid, w in zip(self.tris[tri], bary):
                for bone, bw in self.weights[vid].items():
                    acc[bone] = acc.get(bone, 0.0) + bw * w
            result.append(acc)
        return result

    def transfer_shape_keys(self, target, binding, min_delta=2e-4):
        """Add the source's shape keys to target as barycentric blends of source deltas."""
        keys = self.source.data.shape_keys
        if not keys:
            return 0
        basis = vertex_array(self.source, keys.key_blocks[0].name)
        tri_ids = np.array([b[0] for b in binding], dtype=np.int64)
        bary = np.array([b[1] for b in binding])
        corners = self.tris[tri_ids]
        base = vertex_array(target)
        if not target.data.shape_keys:
            target.shape_key_add(name="Basis", from_mix=False)
        added = 0
        for kb in keys.key_blocks[1:]:
            delta = vertex_array(self.source, kb.name) - basis
            moved = (delta[corners] * bary[:, :, None]).sum(axis=1)
            if np.abs(moved).max() < min_delta:
                continue
            sk = target.shape_key_add(name=kb.name, from_mix=False)
            sk.data.foreach_set("co", (base + moved).ravel())
            added += 1
        if added == 0 and len(target.data.shape_keys.key_blocks) == 1:
            target.shape_key_clear()
        return added


def _barycentric(p, a, b, c):
    v0, v1, v2 = b - a, c - a, p - a
    d00, d01, d11 = v0 @ v0, v0 @ v1, v1 @ v1
    d20, d21 = v2 @ v0, v2 @ v1
    den = d00 * d11 - d01 * d01
    if abs(den) < 1e-18:
        return np.array([1.0, 0.0, 0.0])
    v = (d11 * d20 - d01 * d21) / den
    w = (d00 * d21 - d01 * d20) / den
    bary = np.clip(np.array([1.0 - v - w, v, w]), 0.0, 1.0)
    return bary / bary.sum()


def delete_faces(obj, face_indices):
    """Delete faces (and resulting loose vertices) while keeping shape keys and weights for the rest."""
    me = obj.data
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.faces.ensure_lookup_table()
    doomed = [bm.faces[i] for i in sorted(set(face_indices))]
    bmesh.ops.delete(bm, geom=doomed, context="FACES_ONLY")
    loose = [v for v in bm.verts if not v.link_faces]
    bmesh.ops.delete(bm, geom=loose, context="VERTS")
    bm.to_mesh(me)
    bm.free()
    me.update()


def select_only(objs):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]


def image_from_array(name, rgba, colorspace="sRGB"):
    """Create a Blender image from a float array (H, W, 4) in 0..1, rows top to bottom."""
    h, w = rgba.shape[:2]
    img = bpy.data.images.new(name, width=w, height=h, alpha=True, float_buffer=False)
    img.colorspace_settings.name = colorspace
    img.pixels.foreach_set(np.ascontiguousarray(rgba[::-1]).astype(np.float32).ravel())
    img.pack()
    return img


def array_from_image(img):
    w, h = img.size
    data = np.zeros(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(data)
    return data.reshape(h, w, 4)[::-1]


def apply_modifier(obj, mod):
    with bpy.context.temp_override(object=obj, active_object=obj):
        bpy.ops.object.modifier_apply(modifier=mod.name)


def decimated_copy_with_binding(obj, ratio, armature, name=None):
    """Decimate a skinned mesh that carries shape keys: decimate a key-free copy, then transfer the
    original's skin weights and shape keys through nearest-triangle binding (rigid parts like teeth)."""
    me = obj.data.copy()
    low = bpy.data.objects.new(name or obj.name + "_low", me)
    bpy.context.scene.collection.objects.link(low)
    if me.shape_keys:
        low.shape_key_clear()
    for m in list(low.modifiers):
        low.modifiers.remove(m)
    mod = low.modifiers.new("Decimate", "DECIMATE")
    mod.ratio = ratio
    apply_modifier(low, mod)
    binding = SurfaceBinding(obj)
    bind = binding.bind(vertex_array(low), max_distance=0.05)
    assign_weights(low, binding.transfer_weights(bind), armature)
    binding.transfer_shape_keys(low, bind)
    return low


def strip_color_attributes(obj, keep=()):
    for attr in list(obj.data.color_attributes):
        if attr.name not in keep:
            obj.data.color_attributes.remove(attr)


def resized_image(img, size, name, colorspace):
    """New packed image resampled (Lanczos) from img; keeps alpha."""
    from PIL import Image
    arr = array_from_image(img)
    if arr.shape[0] == size:
        out = arr
    else:
        pil = Image.fromarray((np.clip(arr, 0, 1) * 255).astype("uint8"), "RGBA").resize((size, size), Image.LANCZOS)
        out = np.asarray(pil, dtype=np.float32) / 255.0
    return image_from_array(name, out, colorspace)
