"""Stage: hair, beard and brow cards bound to the head, plus skin paint masks."""
import bpy
import numpy as np

import groom
from scene import image_from_array


def run(ctx):
    pieces = groom.build(bpy.data.objects["Body"], bpy.data.objects["Rig"], ctx["src"], ctx["recipe"], ctx["out"], ctx["report"])
    atlas = np.load(ctx["out"] + "/textures/strands.npy")
    img = image_from_array("strands", atlas, colorspace="sRGB")
    mat = bpy.data.materials.new("hair")
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = img
    col = nt.nodes.new("ShaderNodeVertexColor")
    col.layer_name = "Col"
    mul = nt.nodes.new("ShaderNodeMix")
    mul.data_type = "RGBA"
    mul.blend_type = "MULTIPLY"
    mul.inputs["Factor"].default_value = 1.0
    nt.links.new(tex.outputs["Color"], mul.inputs[6])
    nt.links.new(col.outputs["Color"], mul.inputs[7])
    nt.links.new(mul.outputs[2], bsdf.inputs["Base Color"])
    nt.links.new(tex.outputs["Alpha"], bsdf.inputs["Alpha"])
    bsdf.inputs["Roughness"].default_value = 0.55
    mat.surface_render_method = "DITHERED"
    mat.use_backface_culling = False
    for o in pieces.values():
        o.data.materials.clear()
        o.data.materials.append(mat)
