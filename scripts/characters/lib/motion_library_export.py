"""Clip-library export (original Crownfall code, motion builder).

One clips-only GLB per body archetype: the archetype's 64-joint skeleton as nodes (no mesh) and every library clip as
a named animation of body-joint rotations plus the hips translation (face joints and the root never keyed), pruned like
the household clips (glb_prune: rest-constant channels and keys that interpolation reproduces dropped). The manifest
lists every clip's duration, loop flag, kind, the poses it joins, root travel, contacts, props, events and measured
quality; provenance lists the 100STYLE takes (CC BY 4.0) with SHA-256 and the published files' SHA-256.
"""
import hashlib
import json
import math
import os

import bpy
from mathutils import Quaternion

import glb_prune
import motion as mo

FPS = 30
# pruning tolerance: keys that linear interpolation reproduces within 0.08 degrees / 0.3 mm are dropped (the household
# files use 0.03 degrees / 0.1 mm at conversation range; crowd clips are seen from isometric and Quest standing distance)
ROT_TOL_DEG, POS_TOL = 0.08, 3e-4


def continuous(frames):
    """Keep each joint's quaternion on one hemisphere frame to frame (linear tracks never take the long way round)."""
    prev = {}
    for rot, _loc in frames:
        for b, q in list(rot.items()):
            p = prev.get(b)
            if p is not None and p.dot(q) < 0:
                q = Quaternion((-q.w, -q.x, -q.y, -q.z))
                rot[b] = q
            prev[b] = q
    return frames


def body_bones(arm):
    return {b.name for b in arm.data.bones if not b.name.startswith("face_") and b.name != "root"}


def write_all(L):
    bones = body_bones(L.arm)
    written = []
    for name in L.order:
        frames = continuous(L.clips[name])
        for rot, loc in frames:  # only body joints and the hips translation
            for b in [b for b in rot if b not in bones]:
                del rot[b]
            for b in [b for b in loc if b != "hips"]:
                del loc[b]
        written.append(mo.write_clip(L.arm, name, frames, FPS, bones=bones))
    return written


def export_library(L, path):
    """Armature-only GLB with the NLA tracks as named clips, pruned. Returns prune statistics."""
    bpy.ops.object.select_all(action="DESELECT")
    for o in bpy.data.objects:
        o.hide_set(False)
    L.arm.select_set(True)
    bpy.context.view_layer.objects.active = L.arm
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=path, export_format="GLB", use_selection=True,
        export_animations=True, export_animation_mode="NLA_TRACKS", export_force_sampling=True,
        export_optimize_animation_size=True, export_reset_pose_bones=True, export_rest_position_armature=True,
        export_anim_slide_to_zero=True, export_morph=False, export_skins=True, export_def_bones=False,
        export_yup=True, export_apply=False, export_extras=False, export_cameras=False, export_lights=False)
    stats = glb_prune.prune(path, rot_tol_deg=ROT_TOL_DEG, pos_tol=POS_TOL)
    stats["_compact"] = compact(path)
    return stats


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def read_glb(path):
    with open(path, "rb") as f:
        data = f.read()
    n = int.from_bytes(data[12:16], "little")
    js = json.loads(data[20:20 + n])
    return js, data


def glb_facts(path):
    """Per-clip byte estimate (accessor bytes of each animation), node names, rest TRS of the skeleton."""
    js, data = read_glb(path)
    acc_bytes = []
    for a in js["accessors"]:
        width = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}[a["type"]]
        acc_bytes.append(a["count"] * width * 4)
    import numpy as np
    bin_off = 20 + int.from_bytes(data[12:16], "little") + 8
    ctype = {5126: (np.float32, 4), 5122: (np.int16, 2)}

    def first_last(i):
        a = js["accessors"][i]
        bv = js["bufferViews"][a["bufferView"]]
        dt, size = ctype[a["componentType"]]
        w = {"SCALAR": 1, "VEC3": 3, "VEC4": 4}[a["type"]]
        start = bin_off + bv.get("byteOffset", 0) + a.get("byteOffset", 0)
        arr = np.frombuffer(data[start:start + a["count"] * w * size], dtype=dt).reshape(a["count"], w).astype(np.float64)
        if a.get("normalized"):
            arr = arr / 32767.0
        return arr[0], arr[-1]
    clips = {}
    for anim in js.get("animations", []):
        seam_deg, seam_cm = 0.0, 0.0
        for ch in anim["channels"]:
            q0, q1 = first_last(anim["samplers"][ch["sampler"]]["output"])
            if ch["target"]["path"] == "rotation":
                d = abs(float(np.dot(q0 / np.linalg.norm(q0), q1 / np.linalg.norm(q1))))
                seam_deg = max(seam_deg, math.degrees(2.0 * math.acos(min(1.0, d))))
            else:
                seam_cm = max(seam_cm, float(np.linalg.norm(q0 - q1)) * 100.0)
        used = set()
        for s in anim["samplers"]:
            used.add(s["input"])
            used.add(s["output"])
        times = [js["accessors"][s["input"]].get("max", [0])[0] for s in anim["samplers"]]
        clips[anim["name"]] = {"channels": len(anim["channels"]), "bytes": sum(acc_bytes[i] for i in used),
                               "seconds": round(max(times) if times else 0.0, 4),
                               "fileSeamDegrees": round(seam_deg, 4), "fileSeamCm": round(seam_cm, 4)}
    nodes = js["nodes"]
    skeleton = {n["name"]: {"t": [round(v, 6) for v in n.get("translation", [0, 0, 0])],
                            "r": [round(v, 6) for v in n.get("rotation", [0, 0, 0, 1])]} for n in nodes if "name" in n}
    return {"bytes": len(data), "clips": clips, "nodes": len(nodes), "skeleton": skeleton,
            "skeletonSha256": hashlib.sha256(json.dumps(skeleton, sort_keys=True).encode()).hexdigest()}


def round_floats(v, nd=4):
    if isinstance(v, float):
        return round(v, nd)
    if isinstance(v, dict):
        return {k: round_floats(x, nd) for k, x in v.items()}
    if isinstance(v, (list, tuple)):
        return [round_floats(x, nd) for x in v]
    return v


def compact(path):
    """Shrink a pruned clips GLB without changing what plays: identical key-time arrays are shared between samplers, and
    rotation outputs are stored as normalized signed 16-bit (glTF 2.0 core allows normalized SHORT rotation outputs;
    three.js GLTFLoader dequantizes them). Rotation error <= 1/32767 per quaternion component (about 0.004 degrees).
    Returns (bytes before, bytes after)."""
    import struct
    import numpy as np
    before = os.path.getsize(path)
    js, binary = glb_prune._read(path)
    acc_of = lambda i: glb_prune._accessor(js, binary, i)
    keep_acc = {skin["inverseBindMatrices"] for skin in js.get("skins", []) if "inverseBindMatrices" in skin}
    out = bytearray()
    new_bvs, new_acc, acc_map = [], [], {}
    for old in sorted(keep_acc):
        a = dict(js["accessors"][old])
        bv = dict(js["bufferViews"][a["bufferView"]])
        start = bv.get("byteOffset", 0)
        chunk = binary[start:start + bv["byteLength"]]
        out += b"\0" * ((4 - len(out) % 4) % 4)
        bv["byteOffset"] = len(out)
        out += chunk
        new_bvs.append(bv)
        a["bufferView"] = len(new_bvs) - 1
        acc_map[old] = len(new_acc)
        new_acc.append(a)
    times_cache = {}

    def add(data, comp, typ, normalized=False, minmax=False):
        nonlocal out
        out += b"\0" * ((4 - len(out) % 4) % 4)
        new_bvs.append({"buffer": 0, "byteOffset": len(out), "byteLength": data.nbytes})
        out += data.tobytes()
        acc = {"bufferView": len(new_bvs) - 1, "componentType": comp, "count": int(data.shape[0]), "type": typ}
        if normalized:
            acc["normalized"] = True
        if minmax:
            acc["min"] = [float(data.min())]
            acc["max"] = [float(data.max())]
        new_acc.append(acc)
        return len(new_acc) - 1
    nodes = js["nodes"]
    for anim in js.get("animations", []):
        for ch in anim["channels"]:
            smp = anim["samplers"][ch["sampler"]]
            if "_done" in smp:
                continue
            t = np.ascontiguousarray(acc_of(smp["input"])[:, 0], dtype=np.float32)
            key = t.tobytes()
            if key not in times_cache:
                times_cache[key] = add(t, 5126, "SCALAR", minmax=True)
            v = acc_of(smp["output"])
            if ch["target"]["path"] == "rotation":
                v = v / np.linalg.norm(v, axis=1, keepdims=True)
                q = np.ascontiguousarray(np.clip(np.round(v * 32767.0), -32767, 32767), dtype=np.int16)
                out_i = add(q, 5122, "VEC4", normalized=True)
            else:
                out_i = add(np.ascontiguousarray(v, dtype=np.float32), 5126, {3: "VEC3", 4: "VEC4"}[v.shape[1]])
            smp["input"], smp["output"] = times_cache[key], out_i
            smp["_done"] = True
        for smp in anim["samplers"]:
            smp.pop("_done", None)
    for skin in js.get("skins", []):
        if "inverseBindMatrices" in skin:
            skin["inverseBindMatrices"] = acc_map[skin["inverseBindMatrices"]]
    js["accessors"], js["bufferViews"] = new_acc, new_bvs
    js["buffers"] = [{"byteLength": len(out) + (4 - len(out) % 4) % 4}]
    glb_prune._write(path, js, out)
    return before, os.path.getsize(path)
