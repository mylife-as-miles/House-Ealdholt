"""Clip-library manifest (original Crownfall code, motion builder): what each clip is, what it joins, how it binds.

Per clip: duration, frame count, loop flag, kind, the hub pose or clip it starts from and ends on, in-place root
travel (stride, speed, per-frame travel for start and stop clips), stance windows, props it expects (prop id, bone,
hand-local grip in glTF axes), workplace props in the resident root frame, events, and measured quality from the
authored frames (sole penetration, slide of planted sole points, seam, largest joint speed jump). All distances are at
placement scale 1: multiply root travel, stride and speed by the resident's placementScale.
"""
import math

from mathutils import Matrix

import crowd_skeleton as cs
import motion_library as ML

FPS = 30
# Blender (+Z up, -Y forward) to glTF (+Y up, +Z forward): the export converts at the root joint only, so bone-local
# grips are identical; world (root frame) points convert with this matrix.
B2G = Matrix(((1, 0, 0, 0), (0, 0, 1, 0), (0, -1, 0, 0), (0, 0, 0, 1)))


# Kit prop frames (scripts/characters/lib/crowd_props.py: origin at the main grip, shaft along +Z, working end up, in
# Blender axes; the export turns +Z into +Y in the vertex data) mapped onto this library's contract frames
# (motion_roles.PROP_CONTRACTS: origin at the butt, +Y along the shaft to the working end, -Z the working face).
# Each entry: images of the kit's X, Y and Z axes in the contract frame, and the kit origin's position in the contract
# frame (reference-scale metres, aligned at the end that makes contact: the head of a tool, the butt of a grounded spear,
# staff or crook, the grip of a stick). Props not listed are not reconciled (see KIT_MISMATCH).
X, Y, Z = (1, 0, 0), (0, 1, 0), (0, 0, 1)
NX, NY, NZ = (-1, 0, 0), (0, -1, 0), (0, 0, -1)
KIT_ALIGN = {
    "hoe": ((NX, Z, Y), (0.0, 1.25 - 0.6075, 0.0)),
    "axe": ((NZ, NX, Y), (0.0, 0.8 - 0.35, 0.0)),
    "broom": ((X, Z, NY), (0.0, 1.3 - 1.0, 0.0)),
    "spear": ((X, NZ, Y), (0.0, 1.0, 0.0)),
    "crook": ((X, NZ, Y), (0.0, 0.95, 0.0)),
    "walking-staff": ((X, NZ, Y), (0.0, 1.0, 0.0)),
    "ladle": ((X, NZ, Y), (0.0, 0.4, 0.0)),
    "oven-peel": ((X, NZ, Y), (0.0, 0.7, 0.0)),
    "mallet": ((NZ, NX, Y), (0.0, 0.18, 0.0)),
    "chisel": ((X, NZ, Y), (0.0, 0.06, 0.0)),
    "cleaver": ((NZ, NX, Y), (0.0, 0.08, 0.0)),
    "sickle": ((NZ, NX, Y), (0.0, 0.06, 0.0)),
    "whittling-knife": ((NZ, NX, Y), (0.0, 0.05, 0.0)),
    "awl": ((X, NY, NZ), (0.0, 0.0, 0.0)),
    "bow": ((X, NZ, Y), (0.0, 0.0, 0.0)),
    "book": ((NX, Z, Y), (0.0, 0.0, 0.0)),
    "wax-tablet": ((NX, Z, Y), (0.0, 0.0, 0.0)),
    "tally-sticks": ((X, NZ, Y), (0.0, 0.0, 0.0)),
    "arrow-bundle": ((X, NZ, Y), (0.0, 0.37, 0.0)),
    "candle-rod": ((Y, NX, Z), (0.0, 0.25, 0.0)),
    "water-yoke": ((Y, NX, Z), (0.0, 0.0, 0.0)),
    "walking-stick": ((X, Y, Z), (0.0, 0.0, 0.0)),
    "crutch": ((X, Y, Z), (0.0, 0.0, 0.0)),
    "bucket": ((X, Y, Z), (0.0, 0.0, 0.0)), "small-bucket": ((X, Y, Z), (0.0, 0.0, 0.0)), "basket": ((X, Y, Z), (0.0, 0.0, 0.0)),
    "feed-basket": ((X, Y, Z), (0.0, 0.0, 0.0)), "bowl": ((X, Y, Z), (0.0, 0.0, 0.0)), "sack": ((X, Y, Z), (0.0, 0.0, 0.0)),
    "seed-bag": ((X, Y, Z), (0.0, 0.0, 0.0)), "linen-bundle": ((X, Y, Z), (0.0, 0.0, 0.0)), "kindling-bundle": ((X, Y, Z), (0.0, 0.0, 0.0)),
    "pebbles": ((X, Y, Z), (0.0, 0.0, 0.0)),
    # art fixer, 8 November: modelled in their contract frames by crowd_props (CONTRACT_FRAME and the two-handed props'
    # parts, nodes prop_<id>_<part> matching each grip's `part`), so the alignment is the identity
    "saw": ((X, Y, Z), (0.0, 0.0, 0.0)), "plane": ((X, Y, Z), (0.0, 0.0, 0.0)), "hammer-small": ((X, Y, Z), (0.0, 0.0, 0.0)),
    "mortar-pestle": ((X, Y, Z), (0.0, 0.0, 0.0)), "carding-combs": ((X, Y, Z), (0.0, 0.0, 0.0)),
    "distaff": ((X, Y, Z), (0.0, 0.0, 0.0)), "hide-scraper": ((X, Y, Z), (0.0, 0.0, 0.0)), "washing-board": ((X, Y, Z), (0.0, 0.0, 0.0)),
    "straw-bundle": ((X, Y, Z), (0.0, 0.0, 0.0)), "rope-coil": ((X, Y, Z), (0.0, 0.0, 0.0)), "twisting-stick": ((X, Y, Z), (0.0, 0.0, 0.0)),
    "hide-bundle": ((X, Y, Z), (0.0, 0.0, 0.0)), "shaft-bundle": ((X, Y, Z), (0.0, 0.0, 0.0)), "osier-armful": ((X, Y, Z), (0.0, 0.0, 0.0)),
}
# Every role-loop prop is reconciled: the art fixer modelled the kit side in the contract frames (8 November) and the
# motion fixer authored the remaining grips (carding cards per hand, distaff, hide scraper, washing beetle, pebbles, the
# pruner's basket, straw sheaf, rope coil and twisting stick; 8 November). A prop that cannot be matched again is listed
# here with what the kit must change, and the clip carries kitMismatch instead of kitMatrix.
KIT_MISMATCH = {}
CINV = Matrix(((1, 0, 0, 0), (0, 0, -1, 0), (0, 1, 0, 0), (0, 0, 0, 1)))  # glTF (x, y, z) -> Blender (x, -z, y)


# sticks are solved at the archetype's own length (manifest stick.lengthMetres): the kit stick is scaled to it, not by k
KIT_SHAFT_BELOW_GRIP = {"walking-stick": 0.85, "crutch": 1.2}


def kit_matrix(prop, contract_matrix_flat, k, length=None):
    """Bone-local matrix for the kit's prop node as exported (glTF vertex axes), column-major: the clip's contract grip,
    times the archetype scale k (tools scale with the body like the contract), times the kit-to-contract alignment,
    times the glTF-to-Blender axis change of the kit's vertex data."""
    if prop not in KIT_ALIGN or contract_matrix_flat is None:
        return None
    (ax, ay, az), o = KIT_ALIGN[prop]
    A = Matrix(((ax[0], ay[0], az[0], o[0]), (ax[1], ay[1], az[1], o[1]), (ax[2], ay[2], az[2], o[2]), (0, 0, 0, 1)))
    m = contract_matrix_flat
    M = Matrix(((m[0], m[4], m[8], m[12]), (m[1], m[5], m[9], m[13]), (m[2], m[6], m[10], m[14]), (m[3], m[7], m[11], m[15])))
    S = Matrix.Scale(length / KIT_SHAFT_BELOW_GRIP[prop] if prop in KIT_SHAFT_BELOW_GRIP and length else k, 4)
    K = M @ S @ A @ CINV
    return [round(v, 6) for col in K.transposed() for v in col]


def to_gltf_point(p):
    v = B2G @ p.to_4d() if hasattr(p, "to_4d") else B2G @ __import__("mathutils").Vector((p[0], p[1], p[2], 1.0))
    return [round(v.x, 4), round(v.y, 4), round(v.z, 4)]


def clip_travel(L, name):
    meta = L.meta[name]
    if meta.get("gait") and meta["gait"] in L.gaits:
        _w, trav, _win = L.gaits[meta["gait"]]
        return trav, True
    if meta.get("travelOf") and meta["travelOf"] in L.gaits:
        _w, trav, _win = L.gaits[meta["travelOf"]]
        return trav, True
    if "rootTravelMetres" in meta:
        return meta["rootTravelMetres"], False
    return None, meta.get("loop", False)


def library_manifest(L, facts, wanted):
    clips = {}
    for name in L.order:
        frames = L.clips[name]
        meta = dict(L.meta[name])
        trav, cyc = clip_travel(L, name)
        q = ML.clip_quality(L, name, frames, travel=trav, cyclic=bool(meta.get("loop")))
        entry = {"seconds": round((len(frames) - 1) / FPS, 4), "frames": len(frames), "loop": bool(meta.pop("loop")),
                 "kind": meta.pop("kind"), "quality": q}
        rep = L.rep.get(name, {})
        for key in ("strideMetres", "speedMetresPerSecond", "stanceWindows", "source", "stanceShare"):
            if key in rep:
                entry[key] = rep[key]
        if meta.get("gait") == name and "contactFrames" in rep:
            entry["contactFrames"] = rep["contactFrames"]
        entry.update(ML_round(meta))
        for pr in entry.get("props", []) or []:
            km = kit_matrix(pr["prop"], pr.get("matrix"), L.k, pr.get("lengthMetres"))
            if km is not None:
                pr["kitMatrix"] = km
            elif pr["prop"] in KIT_MISMATCH:
                pr["kitMismatch"] = KIT_MISMATCH[pr["prop"]]
        if name in facts["clips"]:
            entry["bytes"] = facts["clips"][name]["bytes"]
            entry["channels"] = facts["clips"][name]["channels"]
            if entry["loop"]:  # the loop seam as published: first against last key of every channel in the GLB
                q["seamDegrees"] = facts["clips"][name]["fileSeamDegrees"]
                q["seamHipsCm"] = facts["clips"][name]["fileSeamCm"]
        clips[name] = entry
    missing = [c for c in wanted if c not in clips]
    hubs = {"hub": "first frame of idle: idle, idle_b, talk, talk_b, look_around, walk/walk_b/walk_c start and stop and every "
                   "standing work loop's enter and exit begin or end on it"}
    if getattr(L, "hub_stick", None) is not None:
        hubs["hub_stick"] = "first frame of idle_stick (walking stick planted beside the left foot): walk_stick start and stop, talk_stick, look_around_stick"
    if getattr(L, "sit", None) is not None:
        hubs["sit"] = "first frame of sit (seated on the stool): sit_down ends and stand_up starts on it; seated work loops enter and exit from it"
    out = {
        "archetype": L.archetype,
        "status": "working-placeholder",
        "file": f"crowd-clips-{L.archetype}-v1.glb",
        "fps": FPS,
        "referenceSkeleton": {"builder": "scripts/characters/lib/crowd_skeleton.py build_reference", **L.info,
                              "joints": 64, "skeletonSha256": facts["skeletonSha256"],
                              "binding": "Crowd residents of this archetype are bound to exactly this skeleton (same rest TRS on every "
                                         "body joint); the actor template is {scene: resident.scene, animations: library.animations}; "
                                         "placement.scale = the resident's placementScale restores its stature and scales root travel."},
        "hubs": hubs,
        "seat": getattr(L, "seat", None),
        "stick": ML_round({k: v for k, v in (getattr(L, "stick", None) or {}).items() if k != "grip"}) or None,
        "clipCount": len(clips),
        "clips": clips,
        "missingFromPopulation": missing,
        "bytes": facts["bytes"],
        "props": getattr(L, "prop_contracts", {}),
        "propBinding": ("Each clip's props list the prop id, the bone it rides and `matrix` (bone-local, column-major) for the "
                        "contract frame of PROP_CONTRACTS (origin at the butt, +Y along the shaft, -Z the working face, Blender "
                        "axes = glTF joint-local axes). `kitMatrix` is the same grip for the crowd prop kit's node as exported "
                        "(crowd-v1/props: origin at the main grip, shaft +Z in Blender, vertex data in glTF axes), scaled by the "
                        "archetype's body scale: set it as the prop node's local matrix under the named bone. Props without "
                        "kitMatrix carry kitMismatch (what the kit must change) or need no grip (workplace props)."),
    }
    return out


def ML_round(v, nd=4):
    if isinstance(v, float):
        return round(v, nd) if math.isfinite(v) else None
    if isinstance(v, dict):
        return {k: ML_round(x, nd) for k, x in v.items()}
    if isinstance(v, (list, tuple)):
        return [ML_round(x, nd) for x in v]
    if hasattr(v, "to_tuple"):
        return [round(x, nd) for x in v]
    return v
