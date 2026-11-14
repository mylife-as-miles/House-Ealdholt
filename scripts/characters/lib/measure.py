"""Measure a GLB: triangles, vertices, materials, joints, morph targets, textures, clips and bytes.

Pure Python standard library; usable inside Blender or standalone:
    python3 scripts/characters/lib/measure.py FILE.glb
Texture memory is an estimate for decoded RGBA8 with a full mip chain (4/3 of the base
level); it is not a GPU measurement and ignores any runtime compression.
"""
import json
import struct
import sys

COMPONENT_BYTES = {5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4}


def _image_size(data):
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return struct.unpack(">II", data[16:24])
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        kind = data[12:16]
        if kind == b"VP8X":
            w = 1 + int.from_bytes(data[24:27], "little")
            h = 1 + int.from_bytes(data[27:30], "little")
            return w, h
        if kind == b"VP8L":
            bits = int.from_bytes(data[21:25], "little")
            return 1 + (bits & 0x3FFF), 1 + ((bits >> 14) & 0x3FFF)
        if kind == b"VP8 ":
            w, h = struct.unpack("<HH", data[26:30])
            return w & 0x3FFF, h & 0x3FFF
    if data[:2] == b"\xff\xd8":
        i = 2
        while i < len(data):
            marker, length = data[i + 1], struct.unpack(">H", data[i + 2:i + 4])[0]
            if marker in (0xC0, 0xC2):
                h, w = struct.unpack(">HH", data[i + 5:i + 9])
                return w, h
            i += 2 + length
    return None, None


def read_glb(path):
    with open(path, "rb") as handle:
        blob = handle.read()
    magic, version, length = struct.unpack("<III", blob[:12])
    if magic != 0x46546C67:
        raise ValueError("not a GLB file")
    json_len = struct.unpack("<I", blob[12:16])[0]
    doc = json.loads(blob[20:20 + json_len])
    bin_chunk = b""
    off = 20 + json_len
    if off < len(blob):
        bin_len = struct.unpack("<I", blob[off:off + 4])[0]
        bin_chunk = blob[off + 8:off + 8 + bin_len]
    return doc, bin_chunk, len(blob), json_len


def _accessor_max(doc, index):
    acc = doc["accessors"][index]
    return acc.get("max", [0])[0]


def glb_facts(path):
    doc, binary, size, json_len = read_glb(path)
    meshes = []
    triangles = vertices = 0
    max_morphs = 0
    for mesh in doc.get("meshes", []):
        for prim in mesh["primitives"]:
            count = doc["accessors"][prim["indices"]]["count"] if "indices" in prim else doc["accessors"][prim["attributes"]["POSITION"]]["count"]
            tris = count // 3 if prim.get("mode", 4) == 4 else 0
            verts = doc["accessors"][prim["attributes"]["POSITION"]]["count"]
            morphs = len(prim.get("targets", []))
            max_morphs = max(max_morphs, morphs)
            triangles += tris
            vertices += verts
            meshes.append({"mesh": mesh.get("name"), "material": doc["materials"][prim["material"]]["name"] if "material" in prim else None,
                           "triangles": tris, "vertices": verts, "morphTargets": morphs, "attributes": sorted(prim["attributes"]),
                           "morphNormals": any("NORMAL" in t for t in prim.get("targets", []))})
    images = []
    for img in doc.get("images", []):
        data = b""
        if "bufferView" in img:
            bv = doc["bufferViews"][img["bufferView"]]
            data = binary[bv.get("byteOffset", 0):bv.get("byteOffset", 0) + bv["byteLength"]]
        w, h = _image_size(data)
        images.append({"name": img.get("name"), "mime": img.get("mimeType"), "bytes": len(data), "width": w, "height": h,
                       "decodedRgba8WithMipsBytes": int(w * h * 4 * 4 / 3) if w and h else None})
    animations = []
    for anim in doc.get("animations", []):
        duration = 0.0
        interp = set()
        paths = set()
        for sampler in anim["samplers"]:
            duration = max(duration, _accessor_max(doc, sampler["input"]))
            interp.add(sampler.get("interpolation", "LINEAR"))
        for ch in anim["channels"]:
            paths.add(ch["target"]["path"])
        animations.append({"name": anim.get("name"), "seconds": round(duration, 4), "channels": len(anim["channels"]),
                           "interpolations": sorted(interp), "paths": sorted(paths)})
    materials = [{"name": m.get("name"), "alphaMode": m.get("alphaMode", "OPAQUE"), "doubleSided": m.get("doubleSided", False)}
                 for m in doc.get("materials", [])]
    joints = max((len(s["joints"]) for s in doc.get("skins", [])), default=0)
    return {"file": path.split("/")[-1], "bytes": size, "jsonBytes": json_len, "binaryBytes": len(binary),
            "triangles": triangles, "vertices": vertices, "meshes": meshes, "materials": materials,
            "materialCount": len(materials), "joints": joints, "maxMorphTargets": max_morphs,
            "images": images, "textureBytes": sum(i["bytes"] for i in images),
            "decodedTextureBytesEstimate": sum(i["decodedRgba8WithMipsBytes"] or 0 for i in images),
            "animations": animations, "extensionsUsed": doc.get("extensionsUsed", []),
            "extensionsRequired": doc.get("extensionsRequired", []), "nodes": len(doc.get("nodes", []))}


if __name__ == "__main__":
    for p in sys.argv[1:]:
        print(json.dumps(glb_facts(p), indent=1))
