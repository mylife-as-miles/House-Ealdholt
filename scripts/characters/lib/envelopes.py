"""Per-clip animated envelopes for each exported level (original Crownfall code, export stage, round 2).

Codex's actor owner qualified every clip at setup by skinning the whole mesh at every key and midpoint: 20 to 25 s per
LOD0 resident and 2 to 6 s per LOD1/Quest one on an idle machine (round 2 critic), repeated at every level swap.
Here the pipeline measures each clip's envelope offline, the way the owner would, and the manifest carries it
(`envelopes[level][clip]`); integration patch 5 lets the owner check such an envelope at a few times instead.

For every body clip and every frame (30 fps) each level's meshes are skinned in numpy from the clip's own pose
(the NLA action's keys through the rig's forward kinematics, four influences as exported), every vertex a face morph
can move is padded by the sum of its 16 largest shape-key deltas (any mix of up to 16 channels with influences within
0..1; the face contract drives at most 14 at once), and the box over all
frames is widened by half the largest distance any vertex moves between two frames (the between-frame margin).
Boxes are in the glTF model frame (Y up, +Z forward: x, z, -y of Blender).
"""
import bpy
import numpy as np
from mathutils import Quaternion, Vector

import motion as mo

# evaluateFacePose (shared/legacy/aethelgard/characters/face-performance.ts) sets at most 14 morph channels at once: two
# blinks, a brow raise, up to eight expression channels and up to three overlapping visemes; 16 leaves a margin
MAX_ACTIVE_MORPHS = 16


def _skin_data(obj, bone_index):
    """Rest positions (armature space), the four strongest joints and their normalized weights, and the morph pad."""
    me = obj.data
    n = len(me.vertices)
    co = np.empty(n * 3, dtype=np.float64)
    me.vertices.foreach_get("co", co)
    co = co.reshape(n, 3)
    mw = np.array(obj.matrix_world)
    co = co @ mw[:3, :3].T + mw[:3, 3]
    names = {g.index: g.name for g in obj.vertex_groups}
    J = np.zeros((n, 4), dtype=np.int32)
    W = np.zeros((n, 4), dtype=np.float64)
    for v in me.vertices:
        ws = sorted(((g.weight, bone_index[names[g.group]]) for g in v.groups
                     if g.weight > 0 and names[g.group] in bone_index), reverse=True)[:4]
        total = sum(w for w, _ in ws)
        for k, (w, j) in enumerate(ws):
            J[v.index, k] = j
            W[v.index, k] = w / total if total > 0 else 0.0
    pad = np.zeros(n)
    if me.shape_keys and len(me.shape_keys.key_blocks) > 1:
        basis = me.shape_keys.key_blocks[0]
        b = np.empty(n * 3)
        basis.data.foreach_get("co", b)
        b = b.reshape(n, 3)
        lens = []
        for kb in me.shape_keys.key_blocks[1:]:
            k = np.empty(n * 3)
            kb.data.foreach_get("co", k)
            lens.append(np.linalg.norm(k.reshape(n, 3) - b, axis=1))
        lens = np.sort(np.array(lens), axis=0)[::-1]
        # the face contract drives at most MAX_ACTIVE_MORPHS channels at once: the sum of a vertex's largest deltas
        # bounds any such mix with influences in 0..1 (the same rule as integration patch 5)
        pad = lens[:MAX_ACTIVE_MORPHS].sum(axis=0) * float(np.linalg.norm(mw[:3, :3], axis=0).max())
    return co, J, W, pad


def _clip_matrices(arm, action, order, rest_inv):
    """Skinning matrices (pose times inverse rest, armature space) of every bone at every frame of an action, from
    Blender's own evaluation of the armature (meshes are hidden meanwhile so only the rig is evaluated)."""
    scene = bpy.context.scene
    ad = arm.animation_data
    ad.action = action
    f0, f1 = (int(round(x)) for x in action.frame_range)
    pbs = [arm.pose.bones[b] for b in order]
    out = []
    for f in range(f0, f1 + 1):
        scene.frame_set(f)
        out.append(np.einsum("bij,bjk->bik", np.array([np.array(pb.matrix) for pb in pbs]), rest_inv))
    return out


def measure(arm, levels, skip_prefix="face_"):
    """levels: {level id: [mesh objects]}. Returns {level: {clip: {min, max, frames, marginMetres}}} (glTF frame)."""
    rig = mo.Rig(arm)
    order = rig.order
    bone_index = {b: i for i, b in enumerate(order)}
    rest_inv = np.array([np.array(rig.rest[b].inverted()) for b in order])
    data = {lv: [_skin_data(o, bone_index) for o in objs] for lv, objs in levels.items()}
    ad = arm.animation_data
    out = {lv: {} for lv in levels}
    hidden = [(o, o.hide_viewport) for o in bpy.data.objects if o.type == "MESH"]
    saved_action = ad.action if ad else None
    muted = [(t, t.mute) for t in ad.nla_tracks] if ad else []
    for t, _m in muted:
        t.mute = True
    for o, _h in hidden:
        o.hide_viewport = True
    try:
        tracks = [t for t in (ad.nla_tracks if ad else []) if not t.name.startswith(skip_prefix) and t.strips]
        clip_mats = {t.name: _clip_matrices(arm, t.strips[0].action, order, rest_inv) for t in tracks}
    finally:
        for o, h in hidden:
            o.hide_viewport = h
        for t, m in muted:
            t.mute = m
        if ad:
            ad.action = saved_action
    for name, mats in clip_mats.items():
        for lv, meshes in data.items():
            lo, hi = np.full(3, np.inf), np.full(3, -np.inf)
            margin = 0.0
            for co, J, W, pad in meshes:
                prev = None
                hom = np.hstack([co, np.ones((len(co), 1))])
                for M in mats:
                    p = np.zeros((len(co), 3))
                    for k in range(4):
                        p += W[:, k:k + 1] * np.einsum("nij,nj->ni", M[J[:, k]][:, :3, :], hom)
                    lo = np.minimum(lo, (p - pad[:, None]).min(axis=0))
                    hi = np.maximum(hi, (p + pad[:, None]).max(axis=0))
                    if prev is not None:
                        margin = max(margin, float(np.linalg.norm(p - prev, axis=1).max()) * 0.5)
                    prev = p
            m = margin + 0.005
            # Blender (x, y, z) -> glTF (x, z, -y)
            out[lv][name] = {"min": [round(float(lo[0] - m), 4), round(float(lo[2] - m), 4), round(float(-hi[1] - m), 4)],
                                   "max": [round(float(hi[0] + m), 4), round(float(hi[2] + m), 4), round(float(-lo[1] + m), 4)],
                                   "frames": len(mats), "marginMetres": round(m, 4)}
    return out
