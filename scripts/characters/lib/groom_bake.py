"""Bake hair cards into textures for the LOD1 and Quest levels (original Crownfall code).

Round 2 of the critic loop: at LOD1 and Quest the brow, lash and beard cards were dropped and the scalp cards thinned,
so the smith lost his beard and heavy brows, the child's crown read bald and the levels looked like different people
from LOD0. Here the LOD0 cards themselves are rasterised, in their own draw order (inner cards first), into texture
space: every card vertex is projected onto a target surface (the LOD0 skin, or a hair shell offset over the scalp),
each card triangle is drawn in that surface's atlas with the strand atlas sampled through the card's own coordinates,
multiplied by the card's vertex colour and composited over what lies beneath with its alpha. Brows, lashes, beard
and stubble become part of the LOD skin; long hair becomes the texture of a shell that keeps the hair's volume, with a
few silhouette cards kept on top.
"""
import math

import bmesh
import bpy
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

from scene import array_from_image, vertex_array


def srgb_to_linear(c):
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def linear_to_srgb(c):
    c = np.clip(c, 0.0, 1.0)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(c, 1.0 / 2.4) - 0.055)


class SurfaceUV:
    """Nearest-point lookup of a target surface's texture coordinates (one UV layer), with UV islands."""

    def __init__(self, obj, uv_layer, face_filter=None):
        me = obj.data
        me.calc_loop_triangles()
        self.co = vertex_array(obj)
        tris = [t for t in me.loop_triangles if face_filter is None or face_filter[t.polygon_index]]
        self.tri_v = np.array([t.vertices[:] for t in tris], dtype=np.int64)
        loops = np.array([t.loops[:] for t in tris], dtype=np.int64)
        uv = np.zeros(len(me.loops) * 2)
        me.uv_layers[uv_layer].data.foreach_get("uv", uv)
        self.tri_uv = uv.reshape(-1, 2)[loops]
        self.tri_poly = np.array([t.polygon_index for t in tris], dtype=np.int64)
        self.tree = BVHTree.FromPolygons([tuple(c) for c in self.co], self.tri_v.tolist(), all_triangles=True)
        e1 = self.tri_uv[:, 1] - self.tri_uv[:, 0]
        e2 = self.tri_uv[:, 2] - self.tri_uv[:, 0]
        a2 = 0.5 * np.abs(e1[:, 0] * e2[:, 1] - e1[:, 1] * e2[:, 0])
        p = self.co[self.tri_v]
        a3 = 0.5 * np.linalg.norm(np.cross(p[:, 1] - p[:, 0], p[:, 2] - p[:, 0]), axis=1)
        self.density = np.sqrt(a2 / np.maximum(a3, 1e-12))  # atlas units per metre

    def lookup(self, points, max_distance=0.05, outside_only=True):
        """(uv Nx2, triangle index N (-1 = none), distance N) for each point. With outside_only a point takes the
        nearest triangle it lies in front of (a beard card beside the lips must land on the outer lip, not on the
        inner mouth or a lid's inner surface just behind it)."""
        n = len(points)
        uv = np.zeros((n, 2))
        tri = np.full(n, -1, dtype=np.int64)
        dist = np.full(n, np.inf)
        for i, p in enumerate(points):
            q = Vector(p)
            loc, nrm, ti, d = self.tree.find_nearest(q, max_distance)
            if loc is None:
                continue
            if outside_only and (q - loc).dot(nrm) < -1e-4:
                best = None
                for loc2, nrm2, ti2, d2 in self.tree.find_nearest_range(q, max_distance):
                    if (q - loc2).dot(nrm2) >= -1e-4 and (best is None or d2 < best[3]):
                        best = (loc2, nrm2, ti2, d2)
                if best is None:
                    continue
                loc, nrm, ti, d = best
            a, b, c = self.co[self.tri_v[ti]]
            w = _bary(np.asarray(loc), a, b, c)
            uv[i] = w @ self.tri_uv[ti]
            tri[i] = ti
            dist[i] = d
        return uv, tri, dist


def _bary(p, a, b, c):
    v0, v1, v2 = b - a, c - a, p - a
    d00, d01, d11 = v0 @ v0, v0 @ v1, v1 @ v1
    d20, d21 = v2 @ v0, v2 @ v1
    den = d00 * d11 - d01 * d01
    if abs(den) < 1e-20:
        return np.array([1.0, 0.0, 0.0])
    v = (d11 * d20 - d01 * d21) / den
    w = (d00 * d21 - d01 * d20) / den
    out = np.clip(np.array([1.0 - v - w, v, w]), 0.0, 1.0)
    return out / out.sum()


def _sample(img, u, v):
    """Bilinear sample of an RGBA float array (rows top to bottom) at texture coordinates (v up)."""
    h, w = img.shape[:2]
    x = np.clip(u, 0.0, 1.0) * (w - 1)
    y = np.clip(1.0 - v, 0.0, 1.0) * (h - 1)
    x0 = np.floor(x).astype(np.int64)
    y0 = np.floor(y).astype(np.int64)
    x1 = np.minimum(x0 + 1, w - 1)
    y1 = np.minimum(y0 + 1, h - 1)
    fx = (x - x0)[:, None]
    fy = (y - y0)[:, None]
    top = img[y0, x0] * (1 - fx) + img[y0, x1] * fx
    bot = img[y1, x0] * (1 - fx) + img[y1, x1] * fx
    return top * (1 - fy) + bot * fy


def card_triangles(cards, face_ok=None):
    """Triangles of a card mesh in face order: (vertex ids, loop ids) plus per-vertex colour (linear RGB)."""
    me = cards.data
    me.calc_loop_triangles()
    tris = [t for t in me.loop_triangles if face_ok is None or face_ok[t.polygon_index]]
    tris.sort(key=lambda t: t.polygon_index)  # faces were sorted from the head outward for blended drawing
    tv = np.array([t.vertices[:] for t in tris], dtype=np.int64).reshape(-1, 3)
    tl = np.array([t.loops[:] for t in tris], dtype=np.int64).reshape(-1, 3)
    uv = np.zeros(len(me.loops) * 2)
    me.uv_layers[0].data.foreach_get("uv", uv)
    col = np.ones((len(me.vertices), 3))
    attr = me.color_attributes.get("Col")
    if attr is not None and attr.domain == "POINT":
        c = np.zeros(len(me.vertices) * 4, dtype=np.float32)
        attr.data.foreach_get("color", c)
        col = c.reshape(-1, 4)[:, :3].astype(np.float64)
    return tv, uv.reshape(-1, 2)[tl], col


def rasterize(target_rgb, target_alpha, pts_uv, pts_ok, tris, tri_uv, vcol, strands, alpha_gain=1.0,
              island_of_tri=None, max_uv_span=None):
    """Composite card triangles (in order) into target_rgb (H, W, 3, linear) and target_alpha (H, W) in place.
    pts_uv: target-atlas coordinates of every card vertex; tri_uv: strand-atlas coordinates per triangle corner;
    strands: strand atlas RGBA (linear RGB). A triangle whose corners land far apart in the target atlas (across a
    seam) is skipped. Returns the number of triangles drawn."""
    H, W = target_rgb.shape[:2]
    drawn = 0
    for k in range(len(tris)):
        ids = tris[k]
        if not all(pts_ok[ids]):
            continue
        P = pts_uv[ids]
        if max_uv_span is not None and np.ptp(P, axis=0).max() > max_uv_span[k]:
            continue
        X = P[:, 0] * W - 0.5
        Y = (1.0 - P[:, 1]) * H - 0.5
        x0, x1 = int(max(0, math.floor(X.min()))), int(min(W - 1, math.ceil(X.max())))
        y0, y1 = int(max(0, math.floor(Y.min()))), int(min(H - 1, math.ceil(Y.max())))
        if x1 < x0 or y1 < y0:
            continue
        den = (Y[1] - Y[2]) * (X[0] - X[2]) + (X[2] - X[1]) * (Y[0] - Y[2])
        if abs(den) < 1e-9:
            continue
        gx, gy = np.meshgrid(np.arange(x0, x1 + 1), np.arange(y0, y1 + 1))
        gx = gx.ravel().astype(np.float64)
        gy = gy.ravel().astype(np.float64)
        w0 = ((Y[1] - Y[2]) * (gx - X[2]) + (X[2] - X[1]) * (gy - Y[2])) / den
        w1 = ((Y[2] - Y[0]) * (gx - X[2]) + (X[0] - X[2]) * (gy - Y[2])) / den
        w2 = 1.0 - w0 - w1
        inside = (w0 >= -0.02) & (w1 >= -0.02) & (w2 >= -0.02)
        if not inside.any():
            continue
        w = np.stack([w0[inside], w1[inside], w2[inside]], axis=1)
        suv = w @ tri_uv[k]
        s = _sample(strands, suv[:, 0], suv[:, 1])
        c = w @ vcol[ids]
        a = np.clip(s[:, 3] * alpha_gain, 0.0, 1.0)
        px = gx[inside].astype(np.int64)
        py = gy[inside].astype(np.int64)
        rgb = s[:, :3] * c
        target_rgb[py, px] = target_rgb[py, px] * (1.0 - a[:, None]) + rgb * a[:, None]
        target_alpha[py, px] = target_alpha[py, px] + a * (1.0 - target_alpha[py, px])
        drawn += 1
    return drawn


def strand_atlas(groom):
    nodes = groom.data.materials[0].node_tree.nodes
    img = next(n.image for n in nodes if n.type == "TEX_IMAGE")
    arr = array_from_image(img).astype(np.float64)
    arr[..., :3] = srgb_to_linear(arr[..., :3])
    return arr


def groom_kinds(groom):
    kind = groom.data.attributes.get("groom_kind")
    vals = np.zeros(len(groom.data.polygons), dtype=np.int32)
    if kind is not None and kind.domain == "FACE":
        kind.data.foreach_get("value", vals)
    return vals


def bake_cards_into_skin(albedo_srgb, skin, groom, kinds=(0, 1, 2, 3), uv_layer="AtlasUV", alpha_gain=1.15,
                         max_distance=0.03, kind_tone=None, kind_alpha=None):
    """Skin albedo (H, W, 4 sRGB, rows top to bottom) with the chosen card kinds painted in, scalp hair first. Painted
    flat, light hair matched the skin and read as a bald crown at LOD (the child), so `kind_tone` (colour factor) and
    `kind_alpha` (alpha gain) may be set per kind: by default scalp hair is a little darker and denser. Returns
    (image, stats)."""
    kind_tone = {0: 0.84} if kind_tone is None else kind_tone
    kind_alpha = {0: 1.6} if kind_alpha is None else kind_alpha
    out = albedo_srgb
    totals = {"cardTriangles": 0, "drawn": 0, "coveredTexels": 0}
    for group in ([0], [kk for kk in kinds if kk != 0]):
        group = [kk for kk in group if kk in kinds]
        if not group:
            continue
        out, st = _bake_kinds(out, skin, groom, group, uv_layer, kind_alpha.get(group[0], alpha_gain) if len(group) == 1 else alpha_gain,
                              max_distance, kind_tone.get(group[0], 1.0) if len(group) == 1 else 1.0)
        for key in totals:
            totals[key] += st[key]
    return out, totals


def _bake_kinds(albedo_srgb, skin, groom, kinds, uv_layer, alpha_gain, max_distance, tone):
    surf = SurfaceUV(skin, uv_layer)
    k = groom_kinds(groom)
    ok_face = np.isin(k, np.array(kinds))
    tris, tri_uv, vcol = card_triangles(groom, ok_face)
    vcol = vcol * tone
    pts = vertex_array(groom)
    used = np.unique(tris.ravel()) if len(tris) else np.zeros(0, dtype=np.int64)
    pts_uv = np.zeros((len(pts), 2))
    pts_ok = np.zeros(len(pts), dtype=bool)
    pts_tri = np.full(len(pts), -1, dtype=np.int64)
    if len(used):
        uv, ti, d = surf.lookup(pts[used], max_distance)
        pts_uv[used] = uv
        pts_ok[used] = ti >= 0
        pts_tri[used] = ti
    # skip triangles whose corners land far apart in the atlas (across a seam): allow 3x the local density
    span = np.full(len(tris), np.inf)
    for i, ids in enumerate(tris):
        if (pts_tri[ids] < 0).any():
            continue
        d3 = max(np.linalg.norm(pts[ids[a]] - pts[ids[b]]) for a, b in ((0, 1), (1, 2), (0, 2)))
        dens = float(np.median(surf.density[pts_tri[ids]]))
        span[i] = 3.0 * dens * d3 + 0.004
    rgb = srgb_to_linear(albedo_srgb[..., :3].astype(np.float64))
    alpha = np.zeros(rgb.shape[:2])
    strands = strand_atlas(groom)
    drawn = rasterize(rgb, alpha, pts_uv, pts_ok, tris, tri_uv, vcol, strands, alpha_gain, max_uv_span=span)
    out = albedo_srgb.copy()
    out[..., :3] = linear_to_srgb(rgb)
    return out, {"cardTriangles": int(len(tris)), "drawn": int(drawn), "coveredTexels": int((alpha > 0.3).sum())}
