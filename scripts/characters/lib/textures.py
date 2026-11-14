"""Stage: baked texture atlases and final materials (original procedural work over CC0 sources).

* Skin: MakeHuman's CC0 diffuse re-baked into a repacked atlas (head enlarged), with
  weathering, painted scalp/stubble bases, pores and age-line bump, roughness and AO.
* Eyes and mouth: MakeHuman's CC0 eye, teeth and tongue maps packed into one atlas.
* Cloth: Poly Haven CC0 fabrics, recoloured and worn procedurally, baked into one atlas.
* Groom: the strand atlas from the groom stage (alpha mask, vertex-coloured).
The result is four meshes and four materials: Body, Clothes, EyesMouth, Groom.
"""
import math
import os

import bpy
import numpy as np

from scene import array_from_image, image_from_array, select_only, vertex_array


# ------------------------------------------------------------------ node helpers

class Nodes:
    def __init__(self, mat):
        mat.use_nodes = True
        self.mat = mat
        self.nt = mat.node_tree
        self.bsdf = self.nt.nodes["Principled BSDF"]

    def new(self, kind, **props):
        node = self.nt.nodes.new(kind)
        for k, v in props.items():
            setattr(node, k, v)
        return node

    def link(self, a, b):
        self.nt.links.new(a, b)

    def value(self, v):
        node = self.new("ShaderNodeValue")
        node.outputs[0].default_value = v
        return node.outputs[0]

    def math(self, op, a, b=None, clamp=False):
        node = self.new("ShaderNodeMath", operation=op, use_clamp=clamp)
        for idx, x in enumerate((a, b)):
            if x is None:
                continue
            if isinstance(x, (int, float)):
                node.inputs[idx].default_value = x
            else:
                self.link(x, node.inputs[idx])
        return node.outputs[0]

    def mix(self, a, b, factor, blend="MIX"):
        node = self.new("ShaderNodeMix", data_type="RGBA", blend_type=blend)
        for idx, x in ((6, a), (7, b)):
            if isinstance(x, (tuple, list)):
                node.inputs[idx].default_value = (*x, 1.0) if len(x) == 3 else x
            else:
                self.link(x, node.inputs[idx])
        if isinstance(factor, (int, float)):
            node.inputs[0].default_value = factor
        else:
            self.link(factor, node.inputs[0])
        return node.outputs[2]

    def attr(self, name, channel=None):
        node = self.new("ShaderNodeAttribute", attribute_name=name, attribute_type="GEOMETRY")
        if channel is None:
            return node.outputs["Color"]
        if channel == "A":
            return node.outputs["Alpha"]
        sep = self.new("ShaderNodeSeparateColor")
        self.link(node.outputs["Color"], sep.inputs[0])
        return sep.outputs["RGB".index(channel)]

    def obj_coords(self, scale=1.0, stretch=(1.0, 1.0, 1.0)):
        tc = self.new("ShaderNodeTexCoord")
        mp = self.new("ShaderNodeMapping")
        mp.inputs["Scale"].default_value = (scale * stretch[0], scale * stretch[1], scale * stretch[2])
        self.link(tc.outputs["Object"], mp.inputs["Vector"])
        return mp.outputs["Vector"]

    def noise(self, scale, detail=2.0, roughness=0.5, stretch=(1, 1, 1), output="Fac"):
        node = self.new("ShaderNodeTexNoise")
        node.inputs["Scale"].default_value = 1.0
        node.inputs["Detail"].default_value = detail
        node.inputs["Roughness"].default_value = roughness
        self.link(self.obj_coords(scale, stretch), node.inputs["Vector"])
        return node.outputs[output]

    def voronoi(self, scale, output="Distance", feature="F1"):
        node = self.new("ShaderNodeTexVoronoi", feature=feature)
        node.inputs["Scale"].default_value = 1.0
        self.link(self.obj_coords(scale), node.inputs["Vector"])
        return node.outputs[output]

    def ramp(self, x, lo, hi):
        node = self.new("ShaderNodeMapRange", clamp=True)
        self.link(x, node.inputs["Value"])
        node.inputs["From Min"].default_value = lo
        node.inputs["From Max"].default_value = hi
        return node.outputs["Result"]

    def image(self, img, vector=None, box=False, colorspace=None):
        node = self.new("ShaderNodeTexImage")
        node.image = img
        if colorspace:
            img.colorspace_settings.name = colorspace
        if box:
            node.projection = "BOX"
            node.projection_blend = 0.3
        if vector is not None:
            self.link(vector, node.inputs["Vector"])
        return node

    def uv(self, name):
        node = self.new("ShaderNodeUVMap", uv_map=name)
        return node.outputs["UV"]

    def ao(self, distance):
        node = self.new("ShaderNodeAmbientOcclusion", samples=8)
        node.inputs["Distance"].default_value = distance
        return node.outputs["AO"]


def new_target(name, size, colorspace, fill=(0.5, 0.5, 0.5, 1.0)):
    img = bpy.data.images.new(name, width=size, height=size, alpha=False, float_buffer=False)
    img.colorspace_settings.name = colorspace
    img.generated_color = fill
    return img


def bake(objects, kind, images_by_material, samples=1, margin=12, **extra):
    """Bake one pass of the given objects into the image node marked active in each material."""
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = samples
    scene.render.bake.margin = margin
    scene.render.bake.margin_type = "EXTEND"
    for mat, img in images_by_material.items():
        nt = mat.node_tree
        node = next((n for n in nt.nodes if n.type == "TEX_IMAGE" and n.label == "BAKE_TARGET"), None)
        if node is None:
            node = nt.nodes.new("ShaderNodeTexImage")
            node.label = "BAKE_TARGET"
        node.image = img
        nt.nodes.active = node
    # Only opaque, self-occluding layers take part: groom cards must never stamp AO into skin or cloth.
    hidden = [o for o in bpy.data.objects if o.type == "MESH" and o.get("crownfall_part") in ("groom", "hair", "beard", "brows", "prop")
              and not o.hide_render and o not in objects]
    for o in hidden:
        o.hide_render = True
    try:
        select_only(objects)
        bpy.ops.object.bake(type=kind, use_clear=False, margin=margin, **extra)
    finally:
        for o in hidden:
            o.hide_render = False


def bake_selected_to_active(sources, target, kind, images_by_material, extra, samples=2, margin=8, cage=0.012, reach=0.03):
    """Bake the look of the source meshes onto the target's active UV map (LOD transfer)."""
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = samples
    scene.render.bake.margin = margin
    scene.render.bake.margin_type = "EXTEND"
    for mat, img in images_by_material.items():
        nt = mat.node_tree
        node = next((n for n in nt.nodes if n.type == "TEX_IMAGE" and n.label == "BAKE_TARGET"), None) or nt.nodes.new("ShaderNodeTexImage")
        node.label = "BAKE_TARGET"
        node.image = img
        nt.nodes.active = node
    hidden = [o for o in bpy.data.objects if o.type == "MESH" and o not in sources and o is not target and not o.hide_render]
    for o in hidden:
        o.hide_render = True
    try:
        bpy.ops.object.select_all(action="DESELECT")
        for o in sources:
            o.select_set(True)
        target.select_set(True)
        bpy.context.view_layer.objects.active = target
        bpy.ops.object.bake(type=kind, use_clear=False, margin=margin, use_selected_to_active=True,
                            cage_extrusion=cage, max_ray_distance=reach, **extra)
    finally:
        for o in hidden:
            o.hide_render = False


def kept_uv_faces(obj):
    """Per-face flags of faces whose UVMap came with the piece (generated grids: capes, shawls). Faces with
    no UV area (rim strips the solidify modifier copied the flag onto) are unwrapped with the rest."""
    me = obj.data
    attr = me.attributes.get("crownfall_keep_uv")
    flags = np.zeros(len(me.polygons), dtype=np.int32)
    if attr is None or attr.domain != "FACE" or "UVMap" not in me.uv_layers:
        return flags > 0
    attr.data.foreach_get("value", flags)
    uv = np.zeros(len(me.loops) * 2)
    me.uv_layers["UVMap"].data.foreach_get("uv", uv)
    uv = uv.reshape(-1, 2)
    for p in me.polygons:
        if not flags[p.index]:
            continue
        pts = uv[p.loop_start:p.loop_start + p.loop_total]
        area = 0.5 * abs(np.dot(pts[:, 0], np.roll(pts[:, 1], 1)) - np.dot(pts[:, 1], np.roll(pts[:, 0], 1)))
        if area < 1e-9:
            flags[p.index] = 0
    return flags > 0


def smooth_kept_grid(obj):
    """Clear the sharp flag on edges between faces of a kept grid (capes, shawls): hanging cloth has no real
    creases there, and a flat-shaded face reads as a block. Returns the number of edges cleared."""
    me = obj.data
    keep = kept_uv_faces(obj)
    sharp = me.attributes.get("sharp_edge")
    if sharp is None or not keep.any():
        return 0
    flags = np.zeros(len(me.edges), dtype=bool)
    sharp.data.foreach_get("value", flags)
    count = np.zeros(len(me.edges), dtype=np.int32)
    key_to_edge = {e.key: e.index for e in me.edges}
    for p in me.polygons:
        if keep[p.index]:
            for k in p.edge_keys:
                count[key_to_edge[k]] += 1
    clear = flags & (count >= 2)
    flags[clear] = False
    sharp.data.foreach_set("value", flags)
    me.update()
    return int(clear.sum())


def unwrap_without_overlaps(obj, margin=0.004, passes=4):
    """Smart-project, then re-project any overlapping faces (folds, rims) into their own islands and repack.
    Faces flagged crownfall_keep_uv keep their own grid UVs and are only packed with the rest."""
    import bmesh
    keep = kept_uv_faces(obj)
    select_only([obj])
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.context.scene.tool_settings.use_uv_select_sync = True
    # select in face mode through bmesh: face flags set in object mode were overridden by the vertex
    # selection on entering edit mode, and the projection overwrote the kept grids
    bpy.context.tool_settings.mesh_select_mode = (False, False, True)
    bm = bmesh.from_edit_mesh(obj.data)
    bm.faces.ensure_lookup_table()
    for f in bm.faces:
        f.select_set(False)
    for f in bm.faces:
        if not keep[f.index]:
            f.select_set(True)
    bm.select_flush_mode()
    bmesh.update_edit_mesh(obj.data)
    if keep.any():
        selected = sum(1 for f in bm.faces if f.select)
        if selected != int((~keep).sum()):
            raise RuntimeError(f"kept-UV selection failed: {selected} selected, {int((~keep).sum())} expected")
    bpy.ops.uv.smart_project(angle_limit=1.15, island_margin=margin, area_weight=0.0, scale_to_bounds=False)
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.select_all(action="SELECT")
    bpy.ops.uv.pack_islands(rotate=True, margin=margin, scale=True)
    remaining = 0
    for _ in range(passes):
        bpy.ops.mesh.select_all(action="DESELECT")
        bpy.ops.uv.select_overlap()
        bm = bmesh.from_edit_mesh(obj.data)
        bm.faces.ensure_lookup_table()
        for f in bm.faces:  # kept grids are never re-projected face by face
            if f.select and keep[f.index]:
                f.select_set(False)
        bmesh.update_edit_mesh(obj.data)
        remaining = sum(1 for f in bm.faces if f.select)
        if remaining == 0:
            break
        # overlaps left after projection are folds inside one island: give each overlapping face its own
        # small island; seams stay limited to those faces
        bpy.ops.uv.lightmap_pack(PREF_CONTEXT="SEL_FACES", PREF_PACK_IN_ONE=True, PREF_NEW_UVLAYER=False,
                                 PREF_BOX_DIV=12, PREF_MARGIN_DIV=0.2)
        # lightmap pack fills the whole square on top of the existing islands: repack everything before
        # testing again, or every island it lands on is flagged next pass and the atlas cascades into one
        # island per face (measured: 6,009 islands using 2.7% of the square on a clothing set)
        bpy.ops.mesh.select_all(action="SELECT")
        bpy.ops.uv.select_all(action="SELECT")
        bpy.ops.uv.pack_islands(rotate=True, margin=margin, scale=True)
    # re-projected islands come back at their own scale: equalize texel density, then pack once
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.select_all(action="SELECT")
    bpy.ops.uv.average_islands_scale()
    bpy.ops.uv.pack_islands(rotate=True, margin=margin, scale=True)
    bpy.ops.mesh.select_all(action="DESELECT")
    bpy.ops.uv.select_overlap()
    remaining = sum(1 for f in bmesh.from_edit_mesh(obj.data).faces if f.select)
    bpy.context.tool_settings.mesh_select_mode = (True, False, False)
    bpy.ops.object.mode_set(mode="OBJECT")
    return remaining


def fill_gutters(img, obj, uv_name, margin=12):
    """Fill the atlas outside every UV island (beyond the bake's own margin) with the colour of the nearest
    islands by push-pull. The decimated levels keep the LOD0 coordinates, and a triangle that still spans
    two islands samples whatever lies between them: the grey atlas fill read as pale patches under the
    LOD1 and Quest eyes and as light slivers on their garments. Returns the number of texels filled."""
    from PIL import Image, ImageDraw
    w, h = img.size
    me = obj.data
    uv = np.zeros(len(me.loops) * 2)
    me.uv_layers[uv_name].data.foreach_get("uv", uv)
    uv = uv.reshape(-1, 2)
    raster = Image.new("L", (w, h), 0)
    draw = ImageDraw.Draw(raster)
    for p in me.polygons:
        pts = [(float(uv[l, 0] * w), float((1.0 - uv[l, 1]) * h)) for l in range(p.loop_start, p.loop_start + p.loop_total)]
        draw.polygon(pts, fill=255, outline=255)
    known = np.asarray(raster) > 0
    for _ in range(margin):  # texels the bake margin already extended
        pad = np.pad(known, 1)
        known = known | pad[:-2, 1:-1] | pad[2:, 1:-1] | pad[1:-1, :-2] | pad[1:-1, 2:]
    arr = array_from_image(img)
    rgb = arr[..., :3].astype(np.float64)
    levels = []
    c, wt = rgb * known[..., None], known.astype(np.float64)
    while c.shape[0] > 1 and c.shape[1] > 1 and c.shape[0] % 2 == 0 and c.shape[1] % 2 == 0:
        levels.append((c, wt))
        hh, ww = c.shape[:2]
        c = c.reshape(hh // 2, 2, ww // 2, 2, 3).sum(axis=(1, 3))
        wt = wt.reshape(hh // 2, 2, ww // 2, 2).sum(axis=(1, 3))
    col = c / np.maximum(wt, 1e-9)[..., None]
    for c, wt in reversed(levels):
        up = np.repeat(np.repeat(col, 2, axis=0), 2, axis=1)
        col = np.where((wt > 0)[..., None], c / np.maximum(wt, 1e-9)[..., None], up)
    filled = int((~known).sum())
    arr[..., :3] = np.where(known[..., None], rgb, col).astype(np.float32)
    img.pixels.foreach_set(np.ascontiguousarray(arr[::-1]).astype(np.float32).ravel())
    return filled


def bake_positions(obj, size, uv_name="AtlasUV"):
    """Object-space position of every texel of obj's atlas (float RGBA image), for texel-exact paint masks."""
    mat = bpy.data.materials.new("position_bake")
    n = Nodes(mat)
    geo = n.new("ShaderNodeNewGeometry")
    n.link(geo.outputs["Position"], n.bsdf.inputs["Emission Color"])
    n.bsdf.inputs["Emission Strength"].default_value = 1.0
    img = bpy.data.images.new("position_bake", width=size, height=size, alpha=True, float_buffer=True)
    img.colorspace_settings.name = "Non-Color"
    saved = list(obj.data.materials)
    obj.data.materials.clear()
    obj.data.materials.append(mat)
    obj.data.uv_layers.active = obj.data.uv_layers[uv_name]
    try:
        bake([obj], "EMIT", {mat: img}, samples=1, margin=8)
    finally:
        obj.data.materials.clear()
        for m in saved:
            obj.data.materials.append(m)
    px = np.zeros(size * size * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    bpy.data.images.remove(img)
    return px.reshape(size, size, 4)[..., :3]  # rows bottom to top, like Blender pixels


def paint_brows(albedo, body, arm, recipe):
    """Paint the brow base into the baked skin atlas per texel. A vertex-colour mask cannot hold a brow: the
    brow is about 8 mm tall and the hm08 brow ridge has vertices every 4 to 6 mm, so after smoothing the mask
    peaked at 0.36 and the painted brow vanished (no brows at all at LOD1 and Quest, which have no brow cards)."""
    s = recipe["skin"]
    amount = s.get("browPaint", 0.0)
    if amount <= 0:
        return 0
    import groom as gr
    size = albedo.size[0]
    pos = bake_positions(body, size)
    bones = arm.data.bones

    class _HF:  # the head frame _BrowShape needs
        eye_l = np.array(bones["face_eye_l"].head_local)
        eye_r = np.array(bones["face_eye_r"].head_local)
    shape = gr._BrowShape(recipe["groom"]["brows"], _HF)
    mask = np.zeros(pos.shape[:2], dtype=np.float32)
    flow_noise = np.zeros(pos.shape[:2], dtype=np.float32)
    for eye, sgn in ((_HF.eye_l, 1.0), (_HF.eye_r, -1.0)):
        x, y, z = pos[..., 0], pos[..., 1], pos[..., 2]
        front = y < eye[1] + 0.02
        t = ((x - eye[0]) * sgn - shape.inner) / shape.span
        tc = np.clip(t, 0.0, 1.0)
        centre = eye[2] + shape.above + shape.arch * np.sin(tc * np.pi) - shape.slope * tc
        head = 0.7 + 0.3 * np.sin(np.clip(tc / 0.16, 0, 1) * np.pi / 2)
        half = 0.5 * shape.thick * (1.0 - 0.62 * tc) * head
        v = (z - centre) / np.maximum(half, 1e-4)  # -1 lower edge .. +1 upper edge
        ends = np.clip((t + 0.06) / 0.12, 0, 1) * np.clip((1.04 - t) / 0.18, 0, 1)
        body_m = np.clip((1.15 - np.abs(v)) / 0.45, 0.0, 1.0) * ends * front
        # hair strokes: stripes across the growth direction (up at the head of the brow, out along the tail)
        ang = np.where(tc < 0.14, np.radians(70.0), np.radians(30.0) * (1 - v) * 0.5 - np.radians(16.0) * (1 + v) * 0.5)
        across = (-np.sin(ang)) * (x - eye[0]) * sgn + np.cos(ang) * (z - centre)
        stripes = 0.5 + 0.5 * np.sin(across * 2 * np.pi / 0.00075 + np.sin(tc * 37.0) * 2.0)
        sel = body_m > mask
        mask = np.where(sel, body_m, mask)
        flow_noise = np.where(sel, stripes, flow_noise)
    # dense hair: a brow reads dark because the strands cover most of the skin in its body (mixed linearly, a
    # 50 percent cover of near-black hair still reads as light tan)
    a = (mask * amount * (0.72 + 0.28 * flow_noise)).astype(np.float32)
    px = np.zeros(size * size * 4, dtype=np.float32)
    albedo.pixels.foreach_get(px)
    px = px.reshape(size, size, 4)
    col = np.array(s["browColour"], dtype=np.float32)  # linear, as the shader mixes
    lin = np.where(px[..., :3] <= 0.04045, px[..., :3] / 12.92, ((px[..., :3] + 0.055) / 1.055) ** 2.4)
    lin = lin * (1 - a[..., None]) + col[None, None, :] * a[..., None]
    px[..., :3] = np.where(lin <= 0.0031308, lin * 12.92, 1.055 * np.power(np.maximum(lin, 0), 1 / 2.4) - 0.055)
    albedo.pixels.foreach_set(px.ravel())
    albedo.update()
    return int((a > 0.05).sum())


def flatten_normal_outliers(img, z_flat=0.45, z_keep=0.7, grow=2):
    """Flatten tangent-space texels tilted far past any real skin or weave detail. Bump driven by
    object-space noise over tiny compressed faces (mouth and eye corners, nose bridge) bakes normals
    that point sideways or backwards; rendered, they read as light flakes with dark rims. Texels with
    z below z_flat (grown by `grow` pixels to take their rims) become flat, texels between z_flat and
    z_keep are blended toward flat, and everything above z_keep is untouched. Returns the number of
    texels that changed."""
    arr = array_from_image(img)
    n = arr[..., :3] * 2.0 - 1.0
    z = n[..., 2]
    w = np.clip((z_keep - z) / max(1e-6, z_keep - z_flat), 0.0, 1.0)
    core = z < z_flat
    for _ in range(grow):
        pad = np.pad(core, 1, mode="edge")
        core = core | pad[:-2, 1:-1] | pad[2:, 1:-1] | pad[1:-1, :-2] | pad[1:-1, 2:]
    w = np.maximum(w, core.astype(np.float32))
    changed = int((w > 0).sum())
    if changed:
        flat = np.array([0.0, 0.0, 1.0], dtype=np.float32)
        out = n * (1.0 - w[..., None]) + flat * w[..., None]
        out /= np.maximum(np.linalg.norm(out, axis=-1, keepdims=True), 1e-6)
        arr[..., :3] = (out + 1.0) * 0.5
        img.pixels.foreach_set(np.ascontiguousarray(arr[::-1]).astype(np.float32).ravel())
    return changed


def clamp_normal_map(img, min_z=0.35):
    """Keep tangent-space normals in the front hemisphere. Bump detail driven by masks that change within
    one small face (mouth corners, nose bridge) can tilt the baked normal past 90 degrees; rendered, those
    texels read as light flakes with dark rims. Returns the number of texels changed."""
    arr = array_from_image(img)
    n = arr[..., :3] * 2.0 - 1.0
    low = n[..., 2] < min_z
    count = int(low.sum())
    if count:
        xy = n[..., :2][low]
        length = np.linalg.norm(xy, axis=1, keepdims=True)
        xy = np.where(length > 1e-6, xy / np.maximum(length, 1e-6), 0.0) * np.sqrt(1.0 - min_z * min_z)
        n[..., :2][low] = xy
        n[..., 2][low] = min_z
        arr[..., :3] = (n + 1.0) * 0.5
        img.pixels.foreach_set(np.ascontiguousarray(arr[::-1]).astype(np.float32).ravel())
    return count


def save_png(img, path):
    img.filepath_raw = path
    img.file_format = "PNG"
    img.save()


# ------------------------------------------------------------------ skin

def _landmarks(body, arm):
    v = vertex_array(body)
    b = arm.data.bones
    eye_l, eye_r = np.array(b["face_eye_l"].head_local), np.array(b["face_eye_r"].head_local)
    eye = (eye_l + eye_r) / 2
    face = v[(v[:, 2] < eye[2] + 0.01) & (v[:, 2] > eye[2] - 0.06) & (np.abs(v[:, 0]) < 0.012)]
    nose = face[np.argmin(face[:, 1])]
    return v, eye_l, eye_r, eye, nose


def weather_masks(body, arm, spec, mouth_corners=None, lips_bottom_z=None):
    """Per-vertex weathering masks from head landmarks: three colour attributes for the bake.

    Landmark offsets scale with the eye spacing (children and smaller heads) and every regional mask has
    a soft edge: binary masks ended in hard, mesh-shaped lines (a lighter patch around a child's mouth and
    chin where the freckle/pore mask stopped). Mouth corners come from the lip region when it is given."""
    v, eye_l, eye_r, eye, nose = _landmarks(body, arm)
    k = float(np.linalg.norm(eye_l - eye_r)) / 0.064
    gauss = lambda c, r: np.exp(-np.sum((v - c) ** 2, axis=1) / (2 * (r * k) ** 2))
    soft = lambda x, lo, hi: np.clip((x - lo) / max(1e-6, hi - lo), 0.0, 1.0)
    cheek_l = eye_l + np.array([0.012, -0.004, -0.032]) * k
    cheek_r = eye_r + np.array([-0.012, -0.004, -0.032]) * k
    ear_l = np.array([eye_l[0] + 0.07 * k, eye[1] + 0.085 * k, eye[2] - 0.005 * k])
    ear_r = np.array([eye_r[0] - 0.07 * k, eye[1] + 0.085 * k, eye[2] - 0.005 * k])
    ruddy = np.clip(gauss(nose, 0.016) * 1.0 + (gauss(cheek_l, 0.02) + gauss(cheek_r, 0.02)) * 0.75
                    + (gauss(ear_l, 0.02) + gauss(ear_r, 0.02)) * 0.6 + gauss(eye + np.array([0, -0.01, 0.05]) * k, 0.035) * 0.25, 0, 1)
    weights = [{g.group: g.weight for g in vert.groups} for vert in body.data.vertices]
    names = {g.index: g.name for g in body.vertex_groups}
    limb = np.array([sum(w for gi, w in wv.items() if names[gi].split("_")[0] in ("forearm", "hand", "thumb", "index", "middle", "ring", "pinky")) for wv in weights])
    front = soft(eye[1] + 0.06 * k - v[:, 1], 0.0, 0.02 * k)
    grime = np.clip(limb * spec["handGrime"] + soft(eye[2] - 0.09 * k - v[:, 2], 0.0, 0.03 * k) * spec["neckGrime"], 0, 1)
    burn = np.clip((gauss(cheek_l + np.array([0.008, 0, 0.006]) * k, 0.012) + gauss(cheek_r + np.array([-0.008, 0, 0.004]) * k, 0.012)) * 1.2 + limb * 0.8, 0, 1)
    rel_z = v[:, 2] - eye[2]
    forehead = (soft(rel_z, 0.018 * k, 0.03 * k) * soft(0.066 * k - rel_z, 0.0, 0.012 * k)
                * soft(0.055 * k - np.abs(v[:, 0]), 0.0, 0.012 * k) * soft(eye[1] + 0.02 * k - v[:, 1], 0.0, 0.01 * k))
    corners = gauss(eye_l + np.array([0.03, 0.012, -0.002]) * k, 0.011) + gauss(eye_r + np.array([-0.03, 0.012, -0.002]) * k, 0.011)
    if mouth_corners is not None and lips_bottom_z is not None:
        mouth_l = np.array(mouth_corners[0]) + np.array([0.004, 0.003, 0.0])
        mouth_r = np.array(mouth_corners[1]) + np.array([-0.004, 0.003, 0.0])
        chin_z = float(lips_bottom_z) - 0.04 * k
    else:
        mouth_l = nose + np.array([0.026, 0.02, -0.035]) * k
        mouth_r = nose + np.array([-0.026, 0.02, -0.035]) * k
        chin_z = eye[2] - 0.12 * k
    wing_l, wing_r = nose + np.array([0.017, 0.012, -0.008]) * k, nose + np.array([-0.017, 0.012, -0.008]) * k

    def seg_dist(a, b):
        ab = b - a
        t = np.clip(((v - a) @ ab) / (ab @ ab), 0, 1)
        return np.linalg.norm(v - (a + np.outer(t, ab)), axis=1)
    fold = np.exp(-np.minimum(seg_dist(wing_l, mouth_l), seg_dist(wing_r, mouth_r)) ** 2 / (2 * (0.004 * k) ** 2))
    under = gauss(eye_l + np.array([0.004, -0.004, -0.016]) * k, 0.010) + gauss(eye_r + np.array([-0.004, -0.004, -0.016]) * k, 0.010)
    tzone = np.clip(gauss(nose, 0.02) + forehead * 0.7, 0, 1)
    face = soft(v[:, 2], chin_z - 0.03 * k, chin_z) * front
    w1 = np.stack([ruddy, grime, burn, np.ones(len(v))], axis=1).astype(np.float32)
    w2 = np.stack([forehead, np.clip(corners, 0, 1), np.clip(fold + under * 0.7, 0, 1), np.ones(len(v))], axis=1).astype(np.float32)
    w3 = np.stack([tzone, face, lid_mask(body, v), np.ones(len(v))], axis=1).astype(np.float32)
    w4 = np.stack(orbital_masks(body, v, eye_l, eye_r, k), axis=1).astype(np.float32)
    for name, data in (("Weather1", w1), ("Weather2", w2), ("Weather3", w3), ("Weather4", w4)):
        attr = body.data.color_attributes.get(name) or body.data.color_attributes.new(name, "FLOAT_COLOR", "POINT")
        attr.data.foreach_set("color", data.ravel())


def lid_mask(body, v):
    """Where the blink morphs move the skin (the upper and lower lids), softened over the mesh; zero when the
    body carries no blink morph. Stored in Weather3.B for the lid tone correction in the skin bake."""
    keys = body.data.shape_keys
    names = [n for n in ("eyeBlinkLeft", "eyeBlinkRight") if keys is not None and n in keys.key_blocks]
    if not names:
        return np.zeros(len(v))
    basis = vertex_array(body, keys.key_blocks[0].name)
    mag = np.zeros(len(v))
    for name in names:
        mag = np.maximum(mag, np.linalg.norm(vertex_array(body, name) - basis, axis=1))
    if mag.max() <= 0:
        return np.zeros(len(v))
    mask = np.clip((mag / mag.max() - 0.04) / 0.3, 0.0, 1.0)
    edges = np.zeros(len(body.data.edges) * 2, dtype=np.int64)
    body.data.edges.foreach_get("vertices", edges)
    edges = edges.reshape(-1, 2)
    count = np.bincount(edges.ravel(), minlength=len(v)).astype(np.float64)
    for _ in range(3):
        acc = np.zeros(len(v))
        np.add.at(acc, edges[:, 0], mask[edges[:, 1]])
        np.add.at(acc, edges[:, 1], mask[edges[:, 0]])
        mask = np.where(count > 0, 0.5 * mask + 0.5 * acc / np.maximum(count, 1), mask)
    return mask


def _blink_magnitude(body, v):
    keys = body.data.shape_keys
    names = [n for n in ("eyeBlinkLeft", "eyeBlinkRight") if keys is not None and n in keys.key_blocks]
    if not names:
        return np.zeros(len(v))
    basis = vertex_array(body, keys.key_blocks[0].name)
    mag = np.zeros(len(v))
    for name in names:
        mag = np.maximum(mag, np.linalg.norm(vertex_array(body, name) - basis, axis=1))
    return mag / mag.max() if mag.max() > 0 else mag


def orbital_masks(body, v, eye_l, eye_r, k):
    """Masks for the eye area (Weather4): R the orbital area from the lid margin up to the brow, G the upper-lid
    crease, B the lash line of both lids, A the inner margin of the lower lid (the waterline).

    MakeHuman's CC0 diffuse paints the whole area between the lids and the brows warmer and darker than the
    forehead; recolouring only the lids toward 'the skin round the eye' kept that orange-brown band, which read
    as eyeshadow on the elder and the smith. The orbital area now takes the forehead's colour (lid_tone), the
    crease and lash line are drawn from the blink morph so a closed lid shows them, and the waterline, which
    showed as a bright white margin under each iris when looking down, is toned down."""
    mag = _blink_magnitude(body, v)
    orbital = np.zeros(len(v))
    crease = np.zeros(len(v))
    for e, sgn in ((eye_l, 1.0), (eye_r, -1.0)):
        rel = v - e
        front = np.clip((e[1] + 0.006 * k - v[:, 1]) / (0.006 * k), 0.0, 1.0)
        # from the lash line up to the middle of the brow, where the brow covers the mask's edge (a taller
        # ellipse left a pale halo round each brow)
        dx = (rel[:, 0] - sgn * 0.002 * k) / (0.024 * k)
        dz = (rel[:, 2] - 0.0075 * k) / (0.0115 * k)
        r = np.sqrt(dx * dx + dz * dz)
        upper = np.clip((rel[:, 2] + 0.003 * k) / (0.004 * k), 0.0, 1.0)
        orbital = np.maximum(orbital, np.clip((1.0 - r) / 0.5, 0.0, 1.0) * upper * front)
        near = (np.linalg.norm(rel, axis=1) < 0.03 * k) & (rel[:, 2] > 0.002 * k)
        crease = np.maximum(crease, near * np.exp(-((mag - 0.11) / 0.045) ** 2) * front)
    lash = np.clip((mag - 0.72) / 0.18, 0.0, 1.0)
    waterline = np.zeros(len(v))
    eyes = bpy.data.objects.get("Eyes")
    if eyes is not None:
        from mathutils.kdtree import KDTree
        ev = vertex_array(eyes)
        kd = KDTree(len(ev))
        for i, c in enumerate(ev):
            kd.insert(c, i)
        kd.balance()
        for i, p in enumerate(v):
            if min(np.linalg.norm(p - eye_l), np.linalg.norm(p - eye_r)) > 0.03:
                continue
            _co, _j, d = kd.find(p)
            centre = eye_l if p[0] > 0 else eye_r
            if p[2] < centre[2] - 0.001 and d < 0.0022:
                waterline[i] = float(np.clip((0.0022 - d) / 0.0012, 0.0, 1.0))
            if d < 0.0016 and p[2] >= centre[2] - 0.001:
                lash[i] = max(lash[i], 0.6)
    return [orbital, crease, lash, waterline]


def lid_tone(body, mh_diffuse, eyes):
    """Tone of the skin round the eyes and the mean luminance of MakeHuman's upper lids, for the lid recolour.

    The CC0 diffuse paints the lids darker and redder than the surrounding skin (the elder's lids average
    sRGB 0.74/0.46/0.39 against 0.81/0.60/0.51). Open, that reads as a warm crease; closed by the blink
    morph the lid stretches over the eye and the colour became a brown band like eyeshadow on every
    resident. A per-channel gain (the first fix) over-corrected the light lid margins and the eye-opening
    texels into a pale yellow-green crescent, so the bake now keeps each lid texel's luminance relative to
    the lids' mean (clamped) and takes its colour from the still skin round the eye. Measured per resident
    from the diffuse at the lid vertices (Weather3.B above 0.6) and at still skin within 4.5 cm of the eyes,
    in front of them. Returns linear RGB of the still skin and the lids' linear luminance, or None."""
    me = body.data
    if "Weather3" not in me.color_attributes or "UVMap" not in me.uv_layers:
        return None
    w3 = np.zeros(len(me.vertices) * 4, dtype=np.float32)
    me.color_attributes["Weather3"].data.foreach_get("color", w3)
    mask = w3.reshape(-1, 4)[:, 2]
    if mask.max() < 0.6:
        return None
    img = array_from_image(mh_diffuse)[..., :3]
    H, W = img.shape[:2]
    uvl = me.uv_layers["UVMap"].data
    loop_vert = np.zeros(len(me.loops), dtype=np.int64)
    me.loops.foreach_get("vertex_index", loop_vert)
    uv = np.zeros(len(me.loops) * 2)
    uvl.foreach_get("uv", uv)
    uv = uv.reshape(-1, 2)
    vert_uv = np.zeros((len(me.vertices), 2))
    vert_uv[loop_vert] = uv
    v = vertex_array(body)
    near = np.zeros(len(v), dtype=bool)
    for e in eyes:
        d = v - np.asarray(e)
        near |= (np.linalg.norm(d, axis=1) < 0.045) & (d[:, 1] < 0.0)
    lids, still = near & (mask > 0.6), near & (mask < 0.02)
    if "Weather4" in me.color_attributes:
        w4 = np.zeros(len(me.vertices) * 4, dtype=np.float32)
        me.color_attributes["Weather4"].data.foreach_get("color", w4)
        orb = w4.reshape(-1, 4)[:, 0]
        eye_c = np.mean(np.asarray(eyes), axis=0)
        rel = v - eye_c
        # reference: the forehead above the brows and the upper cheeks below the eye bags, not the orbital
        # area itself (whose warm tint is what the recolour removes)
        forehead = (rel[:, 2] > 0.036) & (rel[:, 2] < 0.058) & (np.abs(rel[:, 0]) < 0.035) & (rel[:, 1] < -0.005)
        cheek = np.zeros(len(v), dtype=bool)
        for e in eyes:
            d = v - np.asarray(e)
            cheek |= (d[:, 2] < -0.028) & (d[:, 2] > -0.045) & (np.abs(d[:, 0]) < 0.014) & (d[:, 1] < 0.0)
        if forehead.sum() > 10:
            still = forehead  # the cheeks are ruddier: the forehead is the tone the brow-to-lid area should take
        lids = lids | (orb > 0.5)
    if lids.sum() < 10 or still.sum() < 10:
        return None
    px = lambda sel: img[np.clip(((1 - vert_uv[sel, 1]) * (H - 1)).astype(int), 0, H - 1),
                         np.clip((vert_uv[sel, 0] * (W - 1)).astype(int), 0, W - 1)]
    lin = lambda c: np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
    luma = np.array([0.2126, 0.7152, 0.0722])
    still_lin = lin(px(still)).mean(axis=0)
    lid_lum = float((lin(px(lids)) @ luma).mean())
    return {"skin": tuple(float(c) for c in still_lin), "lidLuminance": lid_lum}


def repack_skin_uv(body, head_scale):
    """Copy MakeHuman UVs to 'AtlasUV', normalize island texel density, enlarge the head, repack."""
    me = body.data
    src = me.uv_layers["UVMap"]
    dst = me.uv_layers.get("AtlasUV") or me.uv_layers.new(name="AtlasUV")
    data = np.zeros(len(src.data) * 2)
    src.data.foreach_get("uv", data)
    dst.data.foreach_set("uv", data)
    me.uv_layers.active = dst
    select_only([body])
    # MakeHuman's layout already favours the head; keep its relative island scales and
    # enlarge the head islands further before packing the survivors into the full square.
    co = vertex_array(body)
    z_head = np.percentile(co[:, 2], 99.9) - 0.30
    uv = np.zeros(len(dst.data) * 2)
    dst.data.foreach_get("uv", uv)
    uv = uv.reshape(-1, 2)
    head_loops = np.zeros(len(uv), dtype=bool)
    for poly in me.polygons:
        if poly.center.z > z_head:
            head_loops[poly.loop_start:poly.loop_start + poly.loop_total] = True
    c = uv[head_loops].mean(axis=0)
    uv[head_loops] = c + (uv[head_loops] - c) * head_scale
    dst.data.foreach_set("uv", uv.ravel())
    separate_overlapping_faces(body, "AtlasUV")
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.select_all(action="SELECT")
    bpy.ops.uv.pack_islands(rotate=True, margin=0.006, scale=True, shape_method="CONCAVE")
    bpy.ops.object.mode_set(mode="OBJECT")


def separate_overlapping_faces(obj, layer_name):
    """MakeHuman's inner-lip and mouth-corner faces overlap the outer face in UV space; baked into a shared
    atlas they stamp light patches around the mouth. Give every overlapping face its own island (the bake
    samples the source texture through the original UVs, so the target layout is free), scaled to the
    texel density of the rest of the mesh, before the atlas is packed."""
    import bmesh
    select_only([obj])
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.context.scene.tool_settings.use_uv_select_sync = True
    bpy.ops.mesh.select_all(action="DESELECT")
    bpy.ops.uv.select_overlap()
    bm = bmesh.from_edit_mesh(obj.data)
    picked = [f.index for f in bm.faces if f.select]
    bpy.ops.object.mode_set(mode="OBJECT")
    if not picked:
        return 0
    me = obj.data
    layer = me.uv_layers[layer_name]  # mode switches invalidate layer references: look it up again
    uv = np.zeros(len(layer.data) * 2)
    layer.data.foreach_get("uv", uv)
    uv = uv.reshape(-1, 2)
    co = vertex_array(obj)

    def areas(faces):
        a3 = a2 = 0.0
        for fi in faces:
            poly = me.polygons[fi]
            loops = list(range(poly.loop_start, poly.loop_start + poly.loop_total))
            vs = [co[me.loops[l].vertex_index] for l in loops]
            us = [uv[l] for l in loops]
            for k in range(1, len(vs) - 1):
                a3 += np.linalg.norm(np.cross(vs[k] - vs[0], vs[k + 1] - vs[0])) * 0.5
                d1, d2 = us[k] - us[0], us[k + 1] - us[0]
                a2 += abs(d1[0] * d2[1] - d1[1] * d2[0]) * 0.5
        return a3, a2
    others = [p.index for p in me.polygons if p.index not in set(picked)]
    o3, o2 = areas(others)
    density = o2 / max(o3, 1e-12)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="DESELECT")
    bpy.ops.object.mode_set(mode="OBJECT")
    for fi in picked:
        me.polygons[fi].select = True
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.uv.lightmap_pack(PREF_CONTEXT="SEL_FACES", PREF_PACK_IN_ONE=True, PREF_NEW_UVLAYER=False, PREF_BOX_DIV=12, PREF_MARGIN_DIV=0.2)
    bpy.ops.object.mode_set(mode="OBJECT")
    layer = me.uv_layers[layer_name]
    uv = np.zeros(len(layer.data) * 2)
    layer.data.foreach_get("uv", uv)
    uv = uv.reshape(-1, 2)
    p3, p2 = areas(picked)
    k = math.sqrt(density * p3 / max(p2, 1e-12))
    loops = [l for fi in picked for l in range(me.polygons[fi].loop_start, me.polygons[fi].loop_start + me.polygons[fi].loop_total)]
    centre = uv[loops].mean(axis=0)
    uv[loops] = centre + (uv[loops] - centre) * k + np.array([1.2, 0.0])  # beside the atlas until packed
    layer.data.foreach_set("uv", uv.ravel())
    return len(picked)


def skin_material(body, src, recipe, mh_diffuse, lid=None):
    s = recipe["skin"]
    mat = bpy.data.materials.new("skin_bake")
    n = Nodes(mat)
    base = n.image(mh_diffuse, n.uv("UVMap"), colorspace="sRGB").outputs["Color"]
    if lid is not None:  # the lids take the tone of the skin round the eye, keeping their own shading (see lid_tone)
        bw = n.new("ShaderNodeRGBToBW")
        n.link(base, bw.inputs[0])
        rel = n.math("MAXIMUM", n.math("MINIMUM", n.math("DIVIDE", bw.outputs[0], max(1e-4, lid["lidLuminance"])),
                                       s.get("lidShadeMax", 1.1)), s.get("lidShadeMin", 0.55))
        grey = n.new("ShaderNodeCombineColor")
        for k in range(3):
            n.link(rel, grey.inputs[k])
        toned = n.mix(tuple(lid["skin"]), grey.outputs[0], 1.0, "MULTIPLY")
        area = n.attr("Weather3", "B")
        if "Weather4" in body.data.color_attributes:
            area = n.math("MAXIMUM", area, n.attr("Weather4", "R"))
        base = n.mix(base, toned, n.math("MULTIPLY", area, s.get("lidCorrection", 0.85)))
    if "Weather4" in body.data.color_attributes:
        # a soft crease line and a darker lash line (both show on a closed lid) and a toned-down waterline
        base = n.mix(base, n.mix(base, (0.55, 0.42, 0.38), 1.0, "MULTIPLY"), n.math("MULTIPLY", n.attr("Weather4", "G"), s.get("lidCrease", 0.35)))
        base = n.mix(base, tuple(s.get("lashLineColour", (0.12, 0.08, 0.07))), n.math("MULTIPLY", n.attr("Weather4", "B"), s.get("lashLine", 0.45)))
        base = n.mix(base, tuple(s.get("waterlineColour", (0.42, 0.24, 0.22))), n.math("MULTIPLY", n.attr("Weather4", "A"), s.get("waterline", 0.8)))
    ruddy, grime, burn = n.attr("Weather1", "R"), n.attr("Weather1", "G"), n.attr("Weather1", "B")
    forehead, corners, folds = n.attr("Weather2", "R"), n.attr("Weather2", "G"), n.attr("Weather2", "B")
    tzone, facemask = n.attr("Weather3", "R"), n.attr("Weather3", "G")
    scalp, beard, brow = n.attr("GroomMask", "R"), n.attr("GroomMask", "G"), n.attr("GroomMask", "B")
    # overall tone toward a weathered northern labourer
    col = n.mix(base, tuple(s["toneTint"]), s["toneAmount"], "MULTIPLY")
    blotch = n.noise(60.0, 3.0, 0.6)
    col = n.mix(col, tuple(s["ruddyTint"]), n.math("MULTIPLY", ruddy, n.ramp(blotch, 0.25, 0.75)), "MULTIPLY")
    freckle = n.ramp(n.noise(900.0, 1.0, 0.4), 0.62, 0.7)
    col = n.mix(col, tuple(s["freckleColour"]), n.math("MULTIPLY", n.math("MULTIPLY", freckle, facemask), s["freckles"]))
    # stubble roots and painted short crop beneath the cards
    dots = n.ramp(n.voronoi(1400.0), 0.0, 0.62)
    stub = n.math("MULTIPLY", beard, n.math("SUBTRACT", 1.0, dots))
    col = n.mix(col, tuple(s["stubbleColour"]), n.math("MULTIPLY", stub, s["stubble"]))
    col = n.mix(col, tuple(s["beardShadow"]), n.math("MULTIPLY", beard, s["beardShadowAmount"]))
    strands = n.ramp(n.noise(700.0, 2.0, 0.7, stretch=(1.0, 1.0, 0.25)), 0.3, 0.7)
    col = n.mix(col, tuple(s["scalpColour"]), n.math("MULTIPLY", n.math("POWER", scalp, 0.6), n.math("ADD", 0.78, n.math("MULTIPLY", strands, 0.22))))
    brow_strands = n.ramp(n.noise(1500.0, 2.0, 0.7, stretch=(0.35, 1.0, 1.0)), 0.25, 0.75)
    # thresholded, not a square root: the root lifted the mask's smoothed tail (0.02 to 0.07 on the upper
    # lids) to a 15 to 25 percent mix of the dark brow colour, a warm band across both lids
    # the brow mask is a 0..1 shape matching the cards; the paint is only a light tone of the brow colour under
    # them (the earlier 45 to 60 percent band read as a painted strip running toward the temples)
    # (the brow base itself is painted per texel after the bake: paint_brows)
    # grime on the working hands and forearms, small healed burn marks
    grime_n = n.ramp(n.noise(140.0, 4.0, 0.65), 0.35, 0.8)
    col = n.mix(col, tuple(s["grimeColour"]), n.math("MULTIPLY", n.math("MULTIPLY", grime, grime_n), 0.55))
    spots = n.ramp(n.voronoi(260.0, "Distance"), 0.06, 0.03)
    col = n.mix(col, tuple(s["burnColour"]), n.math("MULTIPLY", n.math("MULTIPLY", burn, spots), s["burns"]))
    # No baked ambient occlusion by default: its rays hit the teeth, tongue and eyes and the compressed
    # faces at the lip and eye corners, and stamped grey shards and a grime-like ring around the mouth
    # and under the eyes (seen in the household renders). The MakeHuman diffuse already carries soft
    # cavity shading.
    if s.get("aoAmount", 0.0) > 0.0:
        ao = n.ao(0.012)
        col = n.mix(col, n.mix((1, 1, 1), ao, 1.0), s["aoAmount"], "MULTIPLY")
    n.link(col, n.bsdf.inputs["Base Color"])
    # roughness: oily T-zone, drier cheeks, stubble and scalp matte
    rough = n.math("ADD", s["roughness"], n.math("MULTIPLY", tzone, -0.12))
    rough = n.math("ADD", rough, n.math("MULTIPLY", n.math("ADD", beard, scalp), 0.12))
    rough = n.math("ADD", rough, n.math("MULTIPLY", grime, 0.1), clamp=True)
    n.link(rough, n.bsdf.inputs["Roughness"])
    # height detail: pores (face), fine grain, forehead lines, eye-corner lines, deeper folds
    pores = n.ramp(n.voronoi(1100.0), 0.0, 0.35)
    grain = n.noise(2600.0, 2.0, 0.5)
    lines_f = n.new("ShaderNodeTexWave", wave_type="BANDS", bands_direction="Z")
    lines_f.inputs["Scale"].default_value = 1.0
    lines_f.inputs["Distortion"].default_value = 7.0
    lines_f.inputs["Detail"].default_value = 1.5
    n.link(n.obj_coords(70.0, (1.0, 1.0, 1.0)), lines_f.inputs["Vector"])
    lines_c = n.new("ShaderNodeTexWave", wave_type="RINGS", rings_direction="SPHERICAL")
    lines_c.inputs["Scale"].default_value = 1.0
    lines_c.inputs["Distortion"].default_value = 1.5
    n.link(n.obj_coords(160.0), lines_c.inputs["Vector"])
    h = n.math("MULTIPLY", n.math("MULTIPLY", pores, facemask), 0.5)
    h = n.math("ADD", h, n.math("MULTIPLY", grain, 0.25))
    h = n.math("ADD", h, n.math("MULTIPLY", n.math("MULTIPLY", lines_f.outputs["Color"], forehead), s["foreheadLines"]))
    h = n.math("ADD", h, n.math("MULTIPLY", n.math("MULTIPLY", lines_c.outputs["Color"], corners), s["eyeLines"]))
    h = n.math("SUBTRACT", h, n.math("MULTIPLY", folds, s["foldDepth"]))
    bump = n.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = s["bumpStrength"]
    bump.inputs["Distance"].default_value = 0.0015
    n.link(h, bump.inputs["Height"])
    n.link(bump.outputs["Normal"], n.bsdf.inputs["Normal"])
    return mat


# ------------------------------------------------------------------ eyes and mouth atlas

def _enlarge_pupils(im, scale, sclera_shade=0.0, sclera_lift=1.0, sclera_warm=(1.0, 1.0, 1.0), limbus=0.0):
    """Widen the pupils of a MakeHuman eye texture by a radial remap inside each iris (the limbal ring stays).
    In the soft northern daylight the CC0 textures' small pupils read as pinpoints in pale irises. Round 2: the
    sclera is lifted and warmed (it rendered a dull grey) and a soft dark limbal ring drawn at the iris edge."""
    if abs(scale - 1.0) < 1e-3 and sclera_shade <= 0 and sclera_lift == 1.0 and limbus <= 0:
        return im
    from PIL import Image
    arr = np.asarray(im, dtype=np.float32)
    H, W = arr.shape[:2]
    lum = arr.mean(axis=2)
    out = arr.copy()
    yy, xx = np.mgrid[0:H, 0:W]
    for cx_f, cy_f in ((0.29, 0.70), (0.71, 0.29)):  # the two eye discs of the MakeHuman layout (image rows down)
        cx, cy = int(cx_f * W), int(cy_f * H)
        win = 0.12 * W
        sel = (np.abs(xx - cx) < win) & (np.abs(yy - cy) < win)
        dark = sel & (lum < 40)
        if dark.sum() < 20:
            continue
        py, px = yy[dark].mean(), xx[dark].mean()
        p_r = math.sqrt(dark.sum() / math.pi)
        iris_r = p_r * 3.0
        r = np.hypot(xx - px, yy - py)
        zone = r < iris_r
        p_new = p_r * scale
        src_r = np.where(r < p_new, r / p_new * p_r, p_r + (r - p_new) / (iris_r - p_new) * (iris_r - p_r))
        ang = np.arctan2(yy - py, xx - px)
        sx = np.clip(px + src_r * np.cos(ang), 0, W - 1).astype(int)
        sy = np.clip(py + src_r * np.sin(ang), 0, H - 1).astype(int)
        out[zone] = arr[sy[zone], sx[zone]]
        if sclera_lift != 1.0:  # the whole sclera, lighter and a touch warmer (not white: it sits in the lids' shade)
            scl = (r >= iris_r * 1.04) & (r < iris_r * 4.2)
            out[scl] = out[scl] * sclera_lift * np.array(sclera_warm)
        if sclera_shade > 0:  # the sclera dims away from the iris, so the eyeball sits in the socket's shade
            ring = (r >= iris_r) & (r < iris_r * 3.4)
            k = np.clip((r - iris_r) / (iris_r * 2.2), 0.0, 1.0)
            out[ring] = out[ring] * (1.0 - sclera_shade * k[ring])[:, None] * np.array([1.0, 0.985, 0.97])
        if limbus > 0:  # a soft dark ring where the iris meets the sclera
            g = np.exp(-((r - iris_r * 0.97) / (iris_r * 0.07)) ** 2)
            near = r < iris_r * 1.5
            out[near] = out[near] * (1.0 - limbus * g[near])[:, None]
    return Image.fromarray(np.clip(out, 0, 255).astype("uint8"))


def eyes_mouth_atlas(src, recipe, objects, size):
    """Pack eye, teeth and tongue maps into one atlas and remap each mesh's UVs into its cell."""
    from PIL import Image, ImageEnhance
    sysdir = src["systemAssets"]
    cells = {"Eyes": (0.0, 0.5, 0.5, 1.0), "Teeth": (0.5, 0.5, 1.0, 1.0), "Tongue": (0.0, 0.0, 0.5, 0.5)}
    lod_cells = {"TeethLow": cells["Teeth"]}  # LOD-only arches share the teeth cell
    files = {"Eyes": os.path.join(sysdir, "eyes", "materials", recipe["parts"]["eyeTexture"]),
             "Teeth": os.path.join(sysdir, "teeth", "teeth_base", "teeth.png"),
             "Tongue": os.path.join(sysdir, "tongue", "tongue01", "tongue01_diffuse.png")}
    atlas = Image.new("RGB", (size, size), (120, 70, 70))
    rough = Image.new("L", (size, size), 140)
    e = recipe["eyes"]
    for name, (u0, v0, u1, v1) in cells.items():
        im = Image.open(files[name]).convert("RGB")
        if name == "Eyes":
            im = ImageEnhance.Color(im).enhance(e["saturation"])
            arr = np.asarray(im, dtype=np.float32) / 255.0
            # darken the iris more than the sclera (low-saturation, high-luminance texels stay brighter)
            lum = arr.mean(axis=2, keepdims=True)
            iris = np.clip((0.78 - lum) / 0.3, 0, 1)
            arr = arr * np.array(e["tint"]) * (e["brightness"] - iris * e["irisDarken"])
            im = Image.fromarray((np.clip(arr, 0, 1) * 255).astype("uint8"))
        w, h = int((u1 - u0) * size), int((v1 - v0) * size)
        if name == "Teeth":  # drawn for the authored arches (teeth.py): crowns, gaps, gums, throat
            import teeth as teeth_lib
            t_rgb, t_rough = teeth_lib.teeth_texture(w, recipe.get("teeth", {}))
            atlas.paste(Image.fromarray((np.clip(t_rgb, 0, 1) * 255).astype("uint8")), (int(u0 * size), int((1 - v1) * size)))
            rough.paste(Image.fromarray((np.clip(t_rough, 0, 1) * 255).astype("uint8")), (int(u0 * size), int((1 - v1) * size)))
            continue
        if name == "Eyes":
            im = _enlarge_pupils(im, e.get("pupilScale", 1.0), e.get("scleraShade", 0.0), e.get("scleraLift", 1.18),
                                 tuple(e.get("scleraWarm", (1.0, 0.975, 0.935))), e.get("limbus", 0.35))
        if name == "Tongue":  # the CC0 tongue is a bright pink; inside the mouth it sits in shade
            arr = np.asarray(im, dtype=np.float32) * np.array(recipe.get("teeth", {}).get("tongueShade", (0.44, 0.31, 0.31)))
            im = Image.fromarray(np.clip(arr, 0, 255).astype("uint8"))
        atlas.paste(im.resize((w, h), Image.LANCZOS), (int(u0 * size), int((1 - v1) * size)))
        r = {"Eyes": 18, "Teeth": 80, "Tongue": 110}[name]
        rough.paste(r, (int(u0 * size), int((1 - v1) * size), int(u0 * size) + w, int((1 - v1) * size) + h))
    for obj in objects:
        u0, v0, u1, v1 = cells.get(obj.name) or lod_cells[obj.name]
        uv = obj.data.uv_layers.active.data
        co = np.zeros(len(uv) * 2)
        uv.foreach_get("uv", co)
        co = co.reshape(-1, 2)
        co[:, 0] = u0 + np.clip(co[:, 0], 0, 1) * (u1 - u0)
        co[:, 1] = v0 + np.clip(co[:, 1], 0, 1) * (v1 - v0)
        uv.foreach_set("uv", co.ravel())
    rgb = np.asarray(atlas, dtype=np.float32) / 255.0
    orm = np.dstack([np.ones(rgb.shape[:2]), np.asarray(rough, dtype=np.float32) / 255.0, np.zeros(rgb.shape[:2]), np.ones(rgb.shape[:2])])
    return np.dstack([rgb, np.ones(rgb.shape[:2])]), orm


# ------------------------------------------------------------------ cloth

def fabric_material(name, spec, ph_dir, fabric_stats):
    """Bake-time material: recoloured box-projected fabric, wear masks, weave and fold bump."""
    mat = bpy.data.materials.new("bake_" + name)
    n = Nodes(mat)
    fid = spec["fabric"]
    diff_path, arm_path = fabric_stats[fid]["diff"], fabric_stats[fid]["arm"]
    vec = n.obj_coords(1.0 / spec["tileMetres"])
    diff = n.image(bpy.data.images.load(diff_path, check_existing=True), vec, box=True, colorspace="sRGB")
    armt = n.image(bpy.data.images.load(arm_path, check_existing=True), vec, box=True, colorspace="Non-Color")
    lum = n.new("ShaderNodeRGBToBW")
    n.link(diff.outputs["Color"], lum.inputs[0])
    detail = n.math("POWER", n.math("DIVIDE", lum.outputs[0], fabric_stats[fid]["meanLum"]), spec.get("contrast", 1.0))
    col = n.mix(tuple(spec["colour"]), (1, 1, 1), 0.0)
    col = n.mix(col, n.mix((0, 0, 0), (1, 1, 1), detail), 1.0, "MULTIPLY")
    # uneven dye and fading
    fade = n.ramp(n.noise(spec.get("fadeScale", 7.0), 3.0, 0.6), 0.3, 0.75)
    col = n.mix(col, tuple(spec.get("fadeColour", spec["colour"])), n.math("MULTIPLY", fade, spec.get("fade", 0.25)))
    # grime rising from the hem and dirt in folds
    sep = n.new("ShaderNodeSeparateXYZ")
    tc = n.new("ShaderNodeTexCoord")
    n.link(tc.outputs["Object"], sep.inputs[0])
    low = n.ramp(sep.outputs["Z"], spec.get("grimeTop", 0.5), spec.get("grimeBottom", 0.0))
    dirt = n.math("MULTIPLY", low, n.ramp(n.noise(25.0, 4.0, 0.65), 0.25, 0.8))
    col = n.mix(col, tuple(spec.get("grimeColour", (0.09, 0.075, 0.06))), n.math("MULTIPLY", dirt, spec.get("grime", 0.35)))
    if spec.get("scorch"):
        sc = spec["scorch"]
        burn = n.math("MULTIPLY", n.ramp(sep.outputs["Z"], sc["zLow"], sc["zHigh"]), n.ramp(n.noise(sc["scale"], 5.0, 0.7), sc["threshold"], sc["threshold"] + 0.08))
        col = n.mix(col, tuple(sc["colour"]), n.math("MULTIPLY", burn, sc["amount"]))
    if spec.get("bands"):
        bd = spec["bands"]
        wave = n.new("ShaderNodeTexWave", wave_type="BANDS", bands_direction="DIAGONAL")
        wave.inputs["Scale"].default_value = 1.0
        wave.inputs["Distortion"].default_value = 0.6
        n.link(n.obj_coords(bd["scale"], (1.0, 1.0, 1.0)), wave.inputs["Vector"])
        edge = n.ramp(wave.outputs["Fac"], 0.85, 1.0)
        col = n.mix(col, tuple(bd["colour"]), n.math("MULTIPLY", edge, bd["amount"]))
        n.bands_height = edge
    rough_marks = []
    for k, mk in enumerate(spec.get("marks", [])):
        col, m = _mark(n, sep, col, mk, k)
        if mk.get("roughOffset"):
            rough_marks.append((m, mk["roughOffset"]))
    ao = n.ao(0.04)
    col = n.mix(col, n.mix((1, 1, 1), ao, 1.0), spec.get("ao", 0.55), "MULTIPLY")
    n.link(col, n.bsdf.inputs["Base Color"])
    sep_arm = n.new("ShaderNodeSeparateColor")
    n.link(armt.outputs["Color"], sep_arm.inputs[0])
    rough = n.math("ADD", n.math("MULTIPLY", sep_arm.outputs[1], spec.get("roughScale", 1.0)), spec.get("roughOffset", 0.0))
    rough = n.math("ADD", rough, n.math("MULTIPLY", dirt, 0.1), clamp=True)
    for m, offset in rough_marks:
        rough = n.math("ADD", rough, n.math("MULTIPLY", m, offset), clamp=True)
    n.link(rough, n.bsdf.inputs["Roughness"])
    weave = n.math("MULTIPLY", lum.outputs[0], spec.get("weave", 1.0))
    folds = n.noise(spec.get("foldScale", 18.0), 2.0, 0.5, stretch=(1.0, 1.0, spec.get("foldStretch", 0.3)))
    h = n.math("ADD", weave, n.math("MULTIPLY", folds, spec.get("foldDepth", 1.5)))
    if spec.get("bands"):
        h = n.math("ADD", h, n.math("MULTIPLY", n.bands_height, -1.2))
    bump = n.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = spec.get("bump", 0.35)
    bump.inputs["Distance"].default_value = 0.002
    n.link(h, bump.inputs["Height"])
    n.link(bump.outputs["Normal"], n.bsdf.inputs["Normal"])
    return mat


def _mark(n, sep, col, mk, index):
    """Wear and dye marks in object space: patch (darned square), blob (soft area), band (height window),
    noise (thresholded stains) and stripes (woven bands). Returns the new colour and the mark mask."""
    shape = mk["shape"]
    x, y, z = sep.outputs["X"], sep.outputs["Y"], sep.outputs["Z"]
    if shape in ("patch", "blob"):
        cx, cy, cz = mk["centre"]
        sx, sy, sz = mk["size"]
        dx = n.math("ABSOLUTE", n.math("DIVIDE", n.math("SUBTRACT", x, cx), sx / 2))
        dy = n.math("ABSOLUTE", n.math("DIVIDE", n.math("SUBTRACT", y, cy), sy / 2))
        dz = n.math("ABSOLUTE", n.math("DIVIDE", n.math("SUBTRACT", z, cz), sz / 2))
        if shape == "patch":
            d = n.math("MAXIMUM", n.math("MAXIMUM", dx, dy), dz)
            m = n.ramp(d, 1.0, 0.9)
            seam = n.math("MULTIPLY", n.ramp(d, 1.02, 0.97), n.ramp(d, 0.92, 0.97))
            col = n.mix(col, tuple(mk["colour"]), n.math("MULTIPLY", m, mk.get("amount", 0.9)))
            col = n.mix(col, tuple(c * 0.5 for c in mk["colour"]), n.math("MULTIPLY", seam, 0.6))
            return col, m
        d = n.math("SQRT", n.math("ADD", n.math("ADD", n.math("MULTIPLY", dx, dx), n.math("MULTIPLY", dy, dy)), n.math("MULTIPLY", dz, dz)))
        m = n.math("MULTIPLY", n.ramp(d, 1.0, 0.3), n.ramp(n.noise(18.0, 3.0, 0.6), 0.25, 0.6))
    elif shape == "band":
        window = n.math("MULTIPLY", n.ramp(z, mk["zLow"] - 0.01, mk["zLow"] + 0.01), n.ramp(z, mk["zHigh"] + 0.01, mk["zHigh"] - 0.01))
        m = n.math("MULTIPLY", window, n.ramp(n.noise(mk.get("scale", 10.0), 4.0, 0.65), mk.get("threshold", 0.4), mk.get("threshold", 0.4) + 0.15))
    elif shape == "noise":
        noise = n.noise(mk.get("scale", 10.0), 4.0, 0.7)
        if mk.get("seed"):
            noise = n.noise(mk.get("scale", 10.0) * 1.37 + mk["seed"], 4.0, 0.7)
        m = n.ramp(noise, mk.get("threshold", 0.65), mk.get("threshold", 0.65) + mk.get("soft", 0.06))
        if "zLow" in mk:
            m = n.math("MULTIPLY", m, n.math("MULTIPLY", n.ramp(z, mk["zLow"], mk["zLow"] + 0.03), n.ramp(z, mk["zHigh"], mk["zHigh"] - 0.03)))
        if mk.get("front"):  # optional: only on the front of the figure (Blender -Y), fading out across the sides
            m = n.math("MULTIPLY", m, n.ramp(y, mk.get("frontFrom", 0.03), mk.get("frontTo", -0.05)))
    elif shape == "gradient":
        # soft dusting rising from the hem (zLow, full) to nothing at zHigh, optionally on the front only, broken by a
        # low-frequency noise (crowd flour and stone dust, art fixer 8 November; the household marks never use it)
        m = n.ramp(z, mk["zHigh"], mk["zLow"])
        if mk.get("front"):
            m = n.math("MULTIPLY", m, n.ramp(y, mk.get("frontFrom", 0.03), mk.get("frontTo", -0.05)))
        m = n.math("MULTIPLY", m, n.math("ADD", 0.6, n.math("MULTIPLY", n.noise(mk.get("scale", 6.0), 2.0, 0.5), 0.4)))
    elif shape == "stripes":
        axis = {"x": x, "y": y, "z": z}[mk.get("axis", "z")]
        wave = n.math("SINE", n.math("MULTIPLY", axis, mk.get("scale", 100.0)))
        m = n.ramp(wave, 1.0 - 2 * mk.get("duty", 0.35), 1.0 - 2 * mk.get("duty", 0.35) + 0.15)
    else:
        raise ValueError(shape)
    col = n.mix(col, tuple(mk["colour"]), n.math("MULTIPLY", m, mk.get("amount", 0.8)))
    return col, m


def mean_luminance(path):
    from PIL import Image
    im = np.asarray(Image.open(path).convert("RGB").resize((256, 256)), dtype=np.float32) / 255.0
    lin = np.where(im <= 0.04045, im / 12.92, ((im + 0.055) / 1.055) ** 2.4)
    return float((lin @ np.array([0.2126, 0.7152, 0.0722])).mean())


def join(objects, name):
    select_only(objects)
    bpy.ops.object.join()
    obj = bpy.context.view_layer.objects.active
    obj.name = name
    obj.data.name = name
    return obj


def final_material(name, base_img, orm_img=None, normal_img=None, alpha=False, double_sided=False, vertex_colour=False,
                   roughness=0.6, specular=0.5, alpha_cutoff=0.35):
    mat = bpy.data.materials.new(name)
    n = Nodes(mat)
    tex = n.image(base_img, colorspace="sRGB")
    colour = tex.outputs["Color"]
    if vertex_colour:
        vc = n.new("ShaderNodeVertexColor", layer_name="Col")
        colour = n.mix(colour, vc.outputs["Color"], 1.0, "MULTIPLY")
    n.link(colour, n.bsdf.inputs["Base Color"])
    if alpha == "blend":
        # alpha blend (glTF BLEND): minified fine strands keep their coverage instead of vanishing
        n.link(tex.outputs["Alpha"], n.bsdf.inputs["Alpha"])
        mat.surface_render_method = "BLENDED"
    elif alpha:
        # alpha clip (glTF MASK): sorting-free, depth-writing cards for coarse hair
        clip = n.math("GREATER_THAN", tex.outputs["Alpha"], alpha_cutoff)
        n.link(clip, n.bsdf.inputs["Alpha"])
        mat.surface_render_method = "DITHERED"
    if orm_img is not None:
        orm = n.image(orm_img, colorspace="Non-Color")
        sep = n.new("ShaderNodeSeparateColor")
        n.link(orm.outputs["Color"], sep.inputs[0])
        n.link(sep.outputs[1], n.bsdf.inputs["Roughness"])
        n.link(sep.outputs[2], n.bsdf.inputs["Metallic"])
    else:
        n.bsdf.inputs["Roughness"].default_value = roughness
    if normal_img is not None:
        nm = n.image(normal_img, colorspace="Non-Color")
        nmap = n.new("ShaderNodeNormalMap")
        n.link(nm.outputs["Color"], nmap.inputs["Color"])
        n.link(nmap.outputs["Normal"], n.bsdf.inputs["Normal"])
    n.bsdf.inputs["Specular IOR Level"].default_value = specular
    mat.use_backface_culling = not double_sided
    return mat


# ------------------------------------------------------------------ round 2: per-texel face refinement

def bake_vertex_scalars(obj, size, values, uv_name="AtlasUV"):
    """Per-texel interpolation of up to three per-vertex scalars (N x 3), baked as emission like bake_positions.
    Returns (H, W, 3) with rows bottom to top (Blender pixel order)."""
    me = obj.data
    vals = np.zeros((len(me.vertices), 4), dtype=np.float32)
    vals[:, :values.shape[1]] = values
    vals[:, 3] = 1.0
    attr = me.color_attributes.new("_texel_scalars", "FLOAT_COLOR", "POINT")
    attr.data.foreach_set("color", vals.ravel())
    mat = bpy.data.materials.new("scalar_bake")
    n = Nodes(mat)
    n.link(n.attr("_texel_scalars"), n.bsdf.inputs["Emission Color"])
    n.bsdf.inputs["Emission Strength"].default_value = 1.0
    img = bpy.data.images.new("scalar_bake", width=size, height=size, alpha=True, float_buffer=True)
    img.colorspace_settings.name = "Non-Color"
    saved = list(me.materials)
    me.materials.clear()
    me.materials.append(mat)
    me.uv_layers.active = me.uv_layers[uv_name]
    try:
        bake([obj], "EMIT", {mat: img}, samples=1, margin=8)
    finally:
        me.materials.clear()
        for m in saved:
            me.materials.append(m)
        me.color_attributes.remove(me.color_attributes["_texel_scalars"])
    px = np.zeros(size * size * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    bpy.data.images.remove(img)
    return px.reshape(size, size, 4)[..., :3]


def _lin(c):
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def _srgb(c):
    c = np.clip(c, 0.0, 1.0)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(c, 1.0 / 2.4) - 0.055)


def refine_face_texels(albedo, body, arm, recipe):
    """Round 2 corrections of the baked skin atlas, per texel from baked positions and vertex scalars:

    * mouth: the bag behind the lips (crownfall_mouth_bag faces) darkens with depth toward the throat, so an open
      mouth shows a shaded cavity instead of the lit pink skin texels behind a black occluder card;
    * eye area: the lid-to-brow area takes the tone of the forehead and upper cheek by a per-channel gain that is
      re-measured until the hue and value differences fall inside a gate (the orange-brown band still read as
      eyeshadow on three residents);
    * upper lids: the part that stretches over the eye in a blink is evened toward its own mean colour (the closed
      lid showed a smeared brown band), keeping the crease and the lash line.
    Returns a report of the measured differences."""
    s = recipe["skin"]
    size = albedo.size[0]
    me = body.data
    co = vertex_array(body)
    bones = arm.data.bones
    eye_l, eye_r = np.array(bones["face_eye_l"].head_local), np.array(bones["face_eye_r"].head_local)
    k = float(np.linalg.norm(eye_l - eye_r)) / 0.064
    # per-vertex scalars: blink magnitude, mouth-bag flag, lip flag
    blink = _blink_magnitude(body, co)
    bag_v = np.zeros(len(co), dtype=np.float32)
    a = me.attributes.get("crownfall_mouth_bag")
    if a is not None and a.domain == "FACE":
        flags = np.zeros(len(me.polygons), dtype=np.int32)
        a.data.foreach_get("value", flags)
        for p in me.polygons:
            if flags[p.index]:
                bag_v[list(p.vertices)] = 1.0
    lips_v = np.zeros(len(co), dtype=np.float32)
    a = me.attributes.get("crownfall_lips")
    if a is not None and a.domain == "POINT":
        lv = np.zeros(len(co), dtype=np.int32)
        a.data.foreach_get("value", lv)
        lips_v = lv.astype(np.float32)
    scal = bake_vertex_scalars(body, size, np.stack([blink, bag_v, lips_v], axis=1))
    pos = bake_positions(body, size)
    px = np.zeros(size * size * 4, dtype=np.float32)
    albedo.pixels.foreach_get(px)
    px = px.reshape(size, size, 4)
    lin = _lin(px[..., :3].astype(np.float64))
    covered = np.abs(pos).sum(axis=2) > 1e-6
    rep = {}
    # ---- mouth cavity
    lip_front = float(co[lips_v > 0.5][:, 1].min()) if (lips_v > 0.5).any() else None
    if lip_front is not None and (bag_v > 0).any():
        bag = (scal[..., 1] > 0.5) & covered
        depth = pos[..., 1] - lip_front
        t = np.clip((depth - 0.009) / 0.04, 0.0, 1.0)
        t = t * t * (3 - 2 * t)
        shade = (0.6 * (1.0 - t) + 0.07 * t)[..., None]
        dark = np.array(s.get("cavityColour", (0.05, 0.014, 0.013)))
        new = lin * shade * (1.0 - t[..., None]) + dark * t[..., None]
        lin = np.where(bag[..., None], new, lin)
        rep["cavityTexels"] = int(bag.sum())
    # ---- eye area tone gate
    x, y, z = pos[..., 0], pos[..., 1], pos[..., 2]
    eye_c = (eye_l + eye_r) / 2
    orb = np.zeros((size, size))
    for e, sgn in ((eye_l, 1.0), (eye_r, -1.0)):
        dx = ((x - e[0]) - sgn * 0.002 * k) / (0.025 * k)
        dz = ((z - e[2]) - 0.0075 * k) / (0.0125 * k)
        r = np.sqrt(dx * dx + dz * dz)
        upper = np.clip(((z - e[2]) + 0.003 * k) / (0.004 * k), 0.0, 1.0)
        front = np.clip((e[1] + 0.006 * k - y) / (0.006 * k), 0.0, 1.0)
        orb = np.maximum(orb, np.clip((1.0 - r) / 0.45, 0.0, 1.0) * upper * front)
    orb *= covered * (scal[..., 2] < 0.5)
    lash = np.clip((scal[..., 0] - 0.78) / 0.12, 0.0, 1.0)  # the lash line stays as drawn
    orb *= 1.0 - lash
    rel = pos - eye_c
    forehead = covered & (rel[..., 2] > 0.036 * k) & (rel[..., 2] < 0.058 * k) & (np.abs(rel[..., 0]) < 0.035 * k) & (rel[..., 1] < -0.005)
    cheek = np.zeros_like(forehead)
    for e in (eye_l, eye_r):
        d = pos - e
        cheek |= covered & (d[..., 2] < -0.028 * k) & (d[..., 2] > -0.045 * k) & (np.abs(d[..., 0]) < 0.014 * k) & (d[..., 1] < 0.0)
    if forehead.sum() > 50 and (orb > 0.5).sum() > 50:
        target = 0.72 * np.median(lin[forehead], axis=0) + 0.28 * (np.median(lin[cheek], axis=0) if cheek.sum() > 50 else np.median(lin[forehead], axis=0))
        # the orbital hollow is shaded by the brow and the lid fold in every light: a texel tone equal to the forehead
        # still rendered as an orange-brown band (the round 2 critic read it as eyeshadow), so the target is a little
        # lighter and less saturated than the forehead (a first pass at 0.25 desaturation and 1.07 lift rendered as a
        # grey band at close range)
        grey = target.mean()
        target = (target + (grey - target) * s.get("orbitalDesaturate", 0.08)) * s.get("orbitalLift", 1.04)
        luma = np.array([0.2126, 0.7152, 0.0722])

        def diff(img):
            m = np.median(img[orb > 0.5], axis=0)
            lum_d = float((m @ luma) / max(1e-6, target @ luma) - 1.0)
            ch_t = target / max(1e-6, target.sum())
            ch_m = m / max(1e-6, m.sum())
            return lum_d, float(np.abs(ch_m - ch_t).max())
        before = diff(lin)
        gate_v, gate_c = s.get("orbitalValueGate", 0.03), s.get("orbitalChromaGate", 0.008)
        passes = 0
        for passes in range(1, 5):
            m = np.median(lin[orb > 0.5], axis=0)
            g = np.clip(target / np.maximum(m, 1e-6), 0.75, 1.35)
            lin = lin * (1.0 + (g - 1.0) * orb[..., None])
            lv, lc = diff(lin)
            if abs(lv) <= gate_v and lc <= gate_c:
                break
        after = diff(lin)
        rep["orbital"] = {"valueDiffBefore": round(before[0], 4), "chromaDiffBefore": round(before[1], 4),
                          "valueDiffAfter": round(after[0], 4), "chromaDiffAfter": round(after[1], 4), "passes": passes,
                          "gate": {"value": gate_v, "chroma": gate_c}}
    # ---- upper lids evened (the part that stretches over the eye when it closes)
    lid = np.clip((scal[..., 0] - 0.1) / 0.2, 0.0, 1.0) * (1.0 - np.clip((scal[..., 0] - 0.85) / 0.1, 0.0, 1.0))
    lid *= covered * (pos[..., 2] > np.minimum(eye_l[2], eye_r[2]) - 0.002)
    if (lid > 0.5).sum() > 20:
        for e in (eye_l, eye_r):
            side = (np.sign(pos[..., 0]) == np.sign(e[0])) & (lid > 0.5)
            if side.sum() < 10:
                continue
            mean = np.median(lin[side], axis=0)
            if "orbital" in rep and forehead.sum() > 50:
                # the lid takes most of the orbital target tone (its own median read brown when stretched closed)
                mean = mean * 0.4 + target * 0.6
            w = (lid * (np.sign(pos[..., 0]) == np.sign(e[0])) * s.get("lidEven", 0.88))[..., None]
            lin = lin * (1.0 - w) + mean * w
        rep["lidTexelsEvened"] = int((lid > 0.5).sum())
    px[..., :3] = _srgb(lin).astype(np.float32)
    albedo.pixels.foreach_set(px.ravel())
    albedo.update()
    return rep


def flatten_lid_normals(normal_img, body, amount=0.85):
    """Flatten the tangent-space normal map over the upper lids (round 2): with the lid closed by the blink morph, the
    lid's pores and crease relief stretched into vertical streaks. Returns the texels changed."""
    size = normal_img.size[0]
    co = vertex_array(body)
    blink = _blink_magnitude(body, co)
    if blink.max() <= 0:
        return 0
    arm = bpy.data.objects["Rig"]
    eye_z = min(arm.data.bones["face_eye_l"].head_local.z, arm.data.bones["face_eye_r"].head_local.z)
    upper = (co[:, 2] > eye_z - 0.002).astype(np.float32)
    scal = bake_vertex_scalars(body, size, np.stack([blink, upper, np.zeros(len(co))], axis=1))
    lid = np.clip((scal[..., 0] - 0.12) / 0.2, 0.0, 1.0) * (1.0 - np.clip((scal[..., 0] - 0.85) / 0.1, 0.0, 1.0)) * np.clip(scal[..., 1], 0, 1)
    px = np.zeros(size * size * 4, dtype=np.float32)
    normal_img.pixels.foreach_get(px)
    px = px.reshape(size, size, 4)
    flat = np.array([0.5, 0.5, 1.0], dtype=np.float32)
    w = (lid * amount)[..., None]
    px[..., :3] = px[..., :3] * (1.0 - w) + flat * w
    normal_img.pixels.foreach_set(px.ravel())
    normal_img.update()
    return int((lid > 0.5).sum())
