"""Readers for MakeHuman hm08 CC0 data files.

Original Crownfall code. It reads the CC0 data that MakeHuman publishes (base
mesh, shape targets, rig and weight JSON, mhclo/mhmat/proxy assets and the
faceunits/visemes packs). It does not import or execute MPFB2 or MakeHuman
program code. MakeHuman units are decimetres with +Y up and +Z forward.
"""
import gzip
import json
import os

import numpy as np


def read_text(path):
    if path.endswith(".gz"):
        with gzip.open(path, "rt", encoding="utf-8") as handle:
            return handle.read()
    with open(path, encoding="utf-8", errors="replace") as handle:
        return handle.read()


def load_target(path):
    """Return (indices int32[N], deltas float64[N,3]) for a .target or .target.gz file."""
    idx, delta = [], []
    for line in read_text(path).splitlines():
        if not line or line[0] == "#":
            continue
        parts = line.split()
        if len(parts) < 4:
            continue
        idx.append(int(parts[0]))
        delta.append((float(parts[1]), float(parts[2]), float(parts[3])))
    return np.asarray(idx, dtype=np.int64), np.asarray(delta, dtype=np.float64).reshape(-1, 3)


def load_obj(path):
    """Minimal OBJ reader: vertices, uvs and faces with group names (1-based OBJ indices made 0-based)."""
    verts, uvs, faces = [], [], []
    group = None
    with open(path, encoding="utf-8", errors="replace") as handle:
        for line in handle:
            if line.startswith("v "):
                p = line.split()
                verts.append((float(p[1]), float(p[2]), float(p[3])))
            elif line.startswith("vt "):
                p = line.split()
                uvs.append((float(p[1]), float(p[2])))
            elif line.startswith("g "):
                group = line.split(None, 1)[1].strip()
            elif line.startswith("f "):
                vi, ti = [], []
                for token in line.split()[1:]:
                    parts = token.split("/")
                    vi.append(int(parts[0]) - 1)
                    ti.append(int(parts[1]) - 1 if len(parts) > 1 and parts[1] else -1)
                faces.append((vi, ti, group))
    return np.asarray(verts, dtype=np.float64), uvs, faces


def load_mhclo(path):
    """Read an mhclo/proxy fitting file: per-vertex base-mesh references, scale references and material."""
    info = {"refs": [], "scales": {}, "delete": [], "path": path}
    mode = None
    base = os.path.dirname(path)
    with open(path, encoding="utf-8", errors="replace") as handle:
        for raw in handle:
            line = raw.strip()
            if not line or line.startswith("#"):
                continue
            parts = line.split()
            key = parts[0]
            if key in ("x_scale", "y_scale", "z_scale"):
                info["scales"][key] = (int(parts[1]), int(parts[2]), float(parts[3]))
                mode = None
            elif key == "obj_file":
                info["obj"] = os.path.join(base, parts[1])
            elif key == "material":
                info["material"] = os.path.normpath(os.path.join(base, parts[1]))
            elif key in ("verts", "delete_verts"):
                mode = key
            elif mode == "verts" and key.lstrip("-").isdigit():
                if len(parts) == 1:
                    info["refs"].append(((int(parts[0]),), (1.0,), (0.0, 0.0, 0.0)))
                else:
                    info["refs"].append(((int(parts[0]), int(parts[1]), int(parts[2])),
                                         (float(parts[3]), float(parts[4]), float(parts[5])),
                                         (float(parts[6]), float(parts[7]), float(parts[8]))))
            elif mode == "delete_verts" and key.lstrip("-").isdigit():
                info["delete"].extend(int(p) for p in parts if p.lstrip("-").isdigit())
            else:
                mode = None
    return info


def proxy_arrays(info):
    """Vectorized form of the mhclo references: (indices[M,3], weights[M,3], offsets[M,3])."""
    m = len(info["refs"])
    idx = np.zeros((m, 3), dtype=np.int64)
    wts = np.zeros((m, 3))
    off = np.zeros((m, 3))
    for n, (i, w, o) in enumerate(info["refs"]):
        idx[n, :len(i)] = i
        wts[n, :len(w)] = w
        off[n] = o
    return idx, wts, off


def fit_proxy_fast(info, arrays, coords):
    idx, wts, off = arrays
    scales = info["scales"]
    s = np.array([abs(coords[scales[k][0]][a] - coords[scales[k][1]][a]) / scales[k][2]
                  for a, k in enumerate(("x_scale", "y_scale", "z_scale"))])
    return (coords[idx] * wts[:, :, None]).sum(axis=1) + off * s


def load_mhmat(path):
    material = {}
    with open(path, encoding="utf-8", errors="replace") as handle:
        for raw in handle:
            line = raw.strip()
            if not line or line.startswith("#") or line.startswith("//"):
                continue
            parts = line.split(None, 1)
            if len(parts) == 2:
                material[parts[0]] = parts[1]
    return material


def fit_proxy(info, coords):
    """MakeHuman's three-vertex fitting rule: barycentric position plus a scaled offset."""
    scales = info["scales"]

    def scale(key, axis):
        a, b, den = scales[key]
        return abs(coords[a][axis] - coords[b][axis]) / den

    s = np.array([scale("x_scale", 0), scale("y_scale", 1), scale("z_scale", 2)])
    out = np.zeros((len(info["refs"]), 3))
    for n, (idx, wts, off) in enumerate(info["refs"]):
        acc = np.zeros(3)
        for i, w in zip(idx, wts):
            acc += coords[i] * w
        out[n] = acc + np.asarray(off) * s
    return out


# ------------------------------------------------------------------ macro shaping

def _macro_weights(value, kind):
    v = min(1.0, max(0.0, value))
    if kind == "gender":
        return {"female": 1 - v, "male": v}
    if kind == "age":
        if v < 0.1875:
            return {"baby": 1 - v / 0.1875, "child": v / 0.1875}
        if v < 0.5:
            t = (v - 0.1875) / 0.3125
            return {"child": 1 - t, "young": t}
        t = (v - 0.5) * 2
        return {"young": 1 - t, "old": t}
    if kind in ("muscle", "weight"):
        lo, mid, hi = (("minmuscle", "averagemuscle", "maxmuscle") if kind == "muscle"
                       else ("minweight", "averageweight", "maxweight"))
        if v < 0.5:
            return {lo: 1 - 2 * v, mid: 2 * v}
        return {mid: 2 - 2 * v, hi: 2 * v - 1}
    if kind == "height":
        return {"minheight": 1 - 2 * v} if v < 0.5 else {"maxheight": 2 * v - 1}
    if kind == "proportions":
        return {"uncommonproportions": 1 - 2 * v} if v < 0.5 else {"idealproportions": 2 * v - 1}
    raise ValueError(kind)


def age_slider(years):
    """MakeHuman age slider: 0 = 1 year, 0.1875 = 11, 0.5 = 25, 1 = 90 years."""
    if years < 11:
        return max(0.0, (years - 1) / 10 * 0.1875)
    if years < 25:
        return 0.1875 + (years - 11) / 14 * 0.3125
    return min(1.0, 0.5 + (years - 25) / 130)


def macro_targets(data_dir, macro):
    """Weighted macro target list following MakeHuman's macro modifier combination rules."""
    tdir = os.path.join(data_dir, "targets", "macrodetails")
    g = _macro_weights(macro["gender"], "gender")
    a = _macro_weights(age_slider(macro["ageYears"]), "age")
    mu = _macro_weights(macro["muscle"], "muscle")
    w = _macro_weights(macro["weight"], "weight")
    h = _macro_weights(macro["height"], "height")
    pr = _macro_weights(macro["proportions"], "proportions")
    families = macro["macroShapeFamilies"]
    total = sum(families.values()) or 1.0
    out = []
    for fam, fw in families.items():
        for gk, gw in g.items():
            for ak, aw in a.items():
                weight = fw / total * gw * aw
                if weight > 1e-4:
                    out.append((os.path.join(tdir, f"{fam}-{gk}-{ak}.target.gz"), weight))
    for gk, gw in g.items():
        for ak, aw in a.items():
            for mk, mw in mu.items():
                for wk, ww in w.items():
                    base = gw * aw * mw * ww
                    if base < 1e-4:
                        continue
                    out.append((os.path.join(tdir, f"universal-{gk}-{ak}-{mk}-{wk}.target.gz"), base))
                    for hk, hw in h.items():
                        if hw * base > 1e-4:
                            out.append((os.path.join(tdir, "height", f"{gk}-{ak}-{mk}-{wk}-{hk}.target.gz"), base * hw))
                    if ak != "baby":
                        for pk, pw in pr.items():
                            if pw * base > 1e-4:
                                out.append((os.path.join(tdir, "proportions", f"{gk}-{ak}-{mk}-{wk}-{pk}.target.gz"), base * pw))
    return out


def apply_targets(coords, weighted_paths, data_dir, warnings):
    applied = []
    for path, weight in weighted_paths:
        if not os.path.exists(path):
            warnings.append("missing target " + os.path.relpath(path, data_dir))
            continue
        idx, delta = load_target(path)
        np.add.at(coords, idx, delta * weight)
        applied.append([os.path.relpath(path, data_dir), round(float(weight), 4)])
    return applied


def load_rig(data_dir, rig_name):
    with open(os.path.join(data_dir, "rigs", "standard", f"rig.{rig_name}.json")) as handle:
        rig = json.load(handle)
    with open(os.path.join(data_dir, "rigs", "standard", f"weights.{rig_name}.json")) as handle:
        weights = json.load(handle)
    return rig, weights


def load_region_faces(data_dir, layer):
    """Face indices of an MPFB uv layer region (e.g. scalp_solid, face_solid, lips_solid)."""
    path = os.path.join(data_dir, "uv_layers", layer + ".json.gz")
    with gzip.open(path, "rt", encoding="utf-8") as handle:
        data = json.load(handle)
    return sorted(int(k) for k in data.keys())


def load_vertex_groups(data_dir):
    with open(os.path.join(data_dir, "mesh_metadata", "basemesh_vertex_groups.json")) as handle:
        raw = json.load(handle)
    out = {}
    for name, ranges in raw.items():
        ids = []
        for lo, hi in ranges:
            ids.extend(range(lo, hi + 1))
        out[name] = ids
    return out
