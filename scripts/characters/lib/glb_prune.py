"""Post-process an exported resident GLB's animations (original Crownfall code, export stage; standard library + numpy).

Blender's exporter with forced sampling writes every joint's translation, rotation and scale for every frame of every
clip: 192 channels per clip, about 87 percent of them constant at the rest pose. The face clips also keyed every body
joint at rest, so playing one over a body clip pulled the body toward the rest pose, and the dense keys made the
actor owner's envelope qualification sample hundreds of keys per joint. This pass:

* removes channels whose values all equal the node's rest transform (behaviour is unchanged: a joint no clip keys
  stays at, or blends back to, its original state in three.js's mixer); rotations are compared after normalising,
  since float32 storage alone puts a quaternion's length about 6e-8 off one, which exceeded the 0.03 degree test;
* drops face-joint channels from body clips and body-joint channels from face clips (the motion stage keys them
  apart; anything else is exporter noise, which left 0.01 to 0.03 degree lower-lid channels in some body clips);
* drops keys that linear (slerp for rotations) interpolation of their neighbours reproduces within a tolerance
  (0.05 degrees, 0.1 mm), keeping the first and last key so loops still close exactly;
* rewrites the binary buffer without the unused data and reports channel and key counts per clip.
"""
import json
import math
import struct

import numpy as np

COMPONENT = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
WIDTH = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT2": 4, "MAT3": 9, "MAT4": 16}


def _read(path):
    with open(path, "rb") as handle:
        data = handle.read()
    jlen = struct.unpack_from("<I", data, 12)[0]
    js = json.loads(data[20:20 + jlen])
    off = 20 + jlen
    blen = struct.unpack_from("<I", data, off)[0]
    return js, bytearray(data[off + 8:off + 8 + blen])


def _write(path, js, binary):
    jb = json.dumps(js, separators=(",", ":")).encode("utf-8")
    jb += b" " * ((4 - len(jb) % 4) % 4)
    binary = bytes(binary) + b"\0" * ((4 - len(binary) % 4) % 4)
    total = 12 + 8 + len(jb) + 8 + len(binary)
    with open(path, "wb") as handle:
        handle.write(struct.pack("<III", 0x46546C67, 2, total))
        handle.write(struct.pack("<II", len(jb), 0x4E4F534A))
        handle.write(jb)
        handle.write(struct.pack("<II", len(binary), 0x004E4942))
        handle.write(binary)


def _accessor(js, binary, index):
    a = js["accessors"][index]
    bv = js["bufferViews"][a["bufferView"]]
    dt = np.dtype(COMPONENT[a["componentType"]])
    w = WIDTH[a["type"]]
    start = bv.get("byteOffset", 0) + a.get("byteOffset", 0)
    stride = bv.get("byteStride", 0)
    if stride and stride != dt.itemsize * w:
        raw = np.frombuffer(bytes(binary[start:start + stride * a["count"]]), dtype=np.uint8).reshape(a["count"], stride)
        return raw[:, :dt.itemsize * w].copy().view(dt).reshape(a["count"], w).astype(np.float64)
    return np.frombuffer(bytes(binary[start:start + dt.itemsize * w * a["count"]]), dtype=dt).reshape(a["count"], w).astype(np.float64)


def _slerp(q0, q1, t):
    d = float(np.dot(q0, q1))
    if d < 0:
        q1, d = -q1, -d
    if d > 0.9995:
        q = q0 + (q1 - q0) * t
        return q / np.linalg.norm(q)
    th = math.acos(min(1.0, d))
    s = math.sin(th)
    return (math.sin((1 - t) * th) * q0 + math.sin(t * th) * q1) / s


def _reduce(times, values, path, rot_tol, pos_tol):
    """Indices of keys to keep so interpolation reproduces every dropped key within tolerance."""
    n = len(times)
    if n <= 2:
        return list(range(n))
    keep = [0]
    i = 0
    while i < n - 1:
        j = i + 1
        while j + 1 < n:
            ok = True
            for k in range(i + 1, j + 1):
                t = (times[k] - times[i]) / (times[j + 1] - times[i])
                if path == "rotation":
                    q = _slerp(values[i], values[j + 1], t)
                    d = abs(float(np.dot(q, values[k])))
                    err = math.degrees(2 * math.acos(min(1.0, d)))
                    ok = err <= rot_tol
                else:
                    p = values[i] + (values[j + 1] - values[i]) * t
                    ok = float(np.max(np.abs(p - values[k]))) <= pos_tol
                if not ok:
                    break
            if not ok:
                break
            j += 1
        keep.append(j)
        i = j
    return keep


def prune(path, rot_tol_deg=0.05, pos_tol=1e-4, keep_face_only=("face_",)):
    js, binary = _read(path)
    if not js.get("animations"):
        return {}
    nodes = js["nodes"]
    stats = {}
    new_accessors = {}  # (anim, sampler) -> (times, values) arrays to write
    for anim in js["animations"]:
        face_clip = anim["name"].startswith(keep_face_only)
        channels, samplers = [], []
        n_keys = 0
        duration = max(float(_accessor(js, binary, s["input"])[-1, 0]) for s in anim["samplers"])
        before = len(anim["channels"])
        for ch in anim["channels"]:
            smp = anim["samplers"][ch["sampler"]]
            node = nodes[ch["target"]["node"]]
            path_name = ch["target"]["path"]
            times = _accessor(js, binary, smp["input"])[:, 0]
            values = _accessor(js, binary, smp["output"])
            if path_name == "rotation":
                values = values / np.linalg.norm(values, axis=1, keepdims=True)
            rest = {"translation": node.get("translation", [0, 0, 0]), "rotation": node.get("rotation", [0, 0, 0, 1]),
                    "scale": node.get("scale", [1, 1, 1])}[path_name]
            rest = np.array(rest, dtype=np.float64)
            if path_name == "rotation":
                rest = rest / np.linalg.norm(rest)
                dots = np.abs(values @ rest)
                at_rest = bool(np.all(dots > math.cos(math.radians(rot_tol_deg) / 2)))
            else:
                at_rest = bool(np.all(np.abs(values - rest) <= pos_tol))
            if at_rest:
                continue
            if face_clip != node.get("name", "").startswith("face_"):
                continue  # face clips drive the face joints only; body clips never drive them
            if smp.get("interpolation", "LINEAR") == "LINEAR":
                keep = _reduce(times, values, path_name, rot_tol_deg, pos_tol)
            else:
                keep = list(range(len(times)))
            t2, v2 = times[keep], values[keep]
            samplers.append({"interpolation": smp.get("interpolation", "LINEAR"), "_t": t2, "_v": v2, "_w": values.shape[1]})
            channels.append({"sampler": len(samplers) - 1, "target": dict(ch["target"])})
            n_keys += len(keep)
        if not channels:  # a clip needs at least one track over its full duration: keep the hips rotation at rest
            hips = next(i for i, nd in enumerate(nodes) if nd.get("name") == "hips")
            r = np.array([nodes[hips].get("rotation", [0, 0, 0, 1])] * 2, dtype=np.float64)
            samplers.append({"interpolation": "LINEAR", "_t": np.array([0.0, duration]), "_v": r, "_w": 4})
            channels.append({"sampler": 0, "target": {"node": hips, "path": "rotation"}})
            n_keys = 2
        anim["channels"], anim["samplers"] = channels, samplers
        stats[anim["name"]] = {"channels": len(channels), "channelsBefore": before, "keys": n_keys}
    # rebuild accessors and buffer views: keep everything that is not animation data, then append the new animation data
    used_acc = set()
    for mesh in js.get("meshes", []):
        for prim in mesh["primitives"]:
            used_acc |= set(prim["attributes"].values())
            if "indices" in prim:
                used_acc.add(prim["indices"])
            for tgt in prim.get("targets", []):
                used_acc |= set(tgt.values())
    for skin in js.get("skins", []):
        if "inverseBindMatrices" in skin:
            used_acc.add(skin["inverseBindMatrices"])
    used_bv = {js["accessors"][a]["bufferView"] for a in used_acc if "bufferView" in js["accessors"][a]}
    for a in used_acc:
        sp = js["accessors"][a].get("sparse")
        if sp:
            used_bv.add(sp["indices"]["bufferView"])
            used_bv.add(sp["values"]["bufferView"])
    for img in js.get("images", []):
        if "bufferView" in img:
            used_bv.add(img["bufferView"])
    out = bytearray()
    bv_map, new_bvs = {}, []
    for old in sorted(used_bv):
        bv = dict(js["bufferViews"][old])
        start = bv.get("byteOffset", 0)
        chunk = binary[start:start + bv["byteLength"]]
        out += b"\0" * ((4 - len(out) % 4) % 4)
        bv["byteOffset"] = len(out)
        out += chunk
        bv_map[old] = len(new_bvs)
        new_bvs.append(bv)
    acc_map, new_acc = {}, []
    for old in sorted(used_acc):
        a = dict(js["accessors"][old])
        if "bufferView" in a:
            a["bufferView"] = bv_map[a["bufferView"]]
        if "sparse" in a:
            sp = json.loads(json.dumps(a["sparse"]))
            sp["indices"]["bufferView"] = bv_map[sp["indices"]["bufferView"]]
            sp["values"]["bufferView"] = bv_map[sp["values"]["bufferView"]]
            a["sparse"] = sp
        acc_map[old] = len(new_acc)
        new_acc.append(a)

    def add_accessor(arr, typ):
        nonlocal out
        data = np.ascontiguousarray(arr, dtype=np.float32)
        out += b"\0" * ((4 - len(out) % 4) % 4)
        bv = {"buffer": 0, "byteOffset": len(out), "byteLength": data.nbytes}
        out += data.tobytes()
        new_bvs.append(bv)
        acc = {"bufferView": len(new_bvs) - 1, "componentType": 5126, "count": int(data.shape[0]), "type": typ}
        if typ == "SCALAR":
            acc["min"] = [float(data.min())]
            acc["max"] = [float(data.max())]
        new_acc.append(acc)
        return len(new_acc) - 1
    for mesh in js.get("meshes", []):
        for prim in mesh["primitives"]:
            prim["attributes"] = {k: acc_map[v] for k, v in prim["attributes"].items()}
            if "indices" in prim:
                prim["indices"] = acc_map[prim["indices"]]
            if "targets" in prim:
                prim["targets"] = [{k: acc_map[v] for k, v in t.items()} for t in prim["targets"]]
    for skin in js.get("skins", []):
        if "inverseBindMatrices" in skin:
            skin["inverseBindMatrices"] = acc_map[skin["inverseBindMatrices"]]
    for img in js.get("images", []):
        if "bufferView" in img:
            img["bufferView"] = bv_map[img["bufferView"]]
    for anim in js["animations"]:
        for smp in anim["samplers"]:
            t, v, w = smp.pop("_t"), smp.pop("_v"), smp.pop("_w")
            smp["input"] = add_accessor(t.reshape(-1, 1), "SCALAR")
            smp["output"] = add_accessor(v, {3: "VEC3", 4: "VEC4"}[w])
    js["accessors"], js["bufferViews"] = new_acc, new_bvs
    js["buffers"] = [{"byteLength": len(out) + (4 - len(out) % 4) % 4}]
    _write(path, js, out)
    return stats
