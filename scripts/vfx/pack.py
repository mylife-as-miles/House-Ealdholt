"""Linear premultiplied frames (npy, from render_vdb.py) -> flipbook atlases (WebP, straight alpha).
usage: python3 -I pack.py <spec.json> <outdir>
spec: {id, src, kind: fire|smoke|explosion, frames, cols, loop, crossfade, exposure, fade_tail, ...}"""
import json, os, sys
import numpy as np
from PIL import Image, ImageFilter

spec = json.load(open(sys.argv[1])); outdir = sys.argv[2]; os.makedirs(outdir, exist_ok=True)
src = spec['src']; meta = json.load(open(os.path.join(src, 'render.json')))
n_src = meta['frames']; res = meta['res']
raw = [np.load(os.path.join(src, 'f%03d.npy' % i)).astype(np.float32) for i in range(n_src)]
raw = [np.nan_to_num(np.clip(a, 0, None)) for a in raw]

N = spec['frames']; K = spec.get('crossfade', 0)
first = spec.get('first', 0)
if spec['loop']:
    # frames first..first+N-1, with the last K blended towards the K frames that precede `first`,
    # so frame N-1 flows into frame 0.
    assert first >= K and first + N <= n_src, (first, K, N, n_src)
    frames = []
    for i in range(N):
        a = raw[first + i]
        j = i - (N - K)
        if j >= 0:
            w = (j + 1) / (K + 1); a = a * (1 - w) + raw[first - K + j] * w
        frames.append(a)
else:
    assert first + N <= n_src
    frames = [raw[first + i] for i in range(N)]

kind = spec['kind']; ex = spec.get('exposure', 1.0)
def srgb(x): return np.where(x <= 0.0031308, x * 12.92, 1.055 * np.power(np.maximum(x, 1e-8), 1 / 2.4) - 0.055)
def blur(a, r):
    if r <= 0: return a
    n = max(1, int(r * 3 + 0.5)); x = np.arange(-n, n + 1); k = np.exp(-x * x / (2 * r * r)); k /= k.sum()
    p = np.pad(a, n, mode='edge')
    p = sum(k[i] * p[i:i + a.shape[0], :] for i in range(2 * n + 1))
    return sum(k[i] * p[:, i:i + a.shape[1]] for i in range(2 * n + 1)).astype(np.float32)

out = []   # display-referred premultiplied RGB (sRGB-encoded straight colour is derived at the end) + alpha
for i, a in enumerate(frames):
    rgb = a[..., :3] * ex; al = np.clip(a[..., 3], 0, 1)
    al = blur(al, spec.get('alpha_blur', 0.0))
    if kind == 'smoke':
        # neutral: keep only luminance of the lit albedo, straight colour = premult / alpha
        lum = rgb @ np.array([0.2126, 0.7152, 0.0722], np.float32)
        st = np.where(al > 1e-3, lum / np.maximum(al, 1e-3), 0)
        st = np.clip(st, 0, 1) ** spec.get('gamma', 1.0)
        st = blur(st, spec.get('colour_blur', 0.0))
        col = np.repeat(st[..., None], 3, 2); alpha = al * spec.get('alpha_gain', 1.0)
        alpha = np.clip(alpha, 0, 1)
    else:
        # emissive: filmic shoulder per channel (hot cores roll off to yellow-white)
        if spec.get('tone') == 'palette':
            # soot is lit to ~0.5 while the fireball's emission runs into the hundreds, and the render's own
            # colour ramp is saturated there. Recolour by log brightness: thin edges red, thick core white-hot.
            m = rgb.max(-1); lo, hi = spec.get('fire_lo', 2.0), spec.get('fire_hi', 1200.0)
            t = np.clip((np.log10(np.maximum(m, 1e-6)) - np.log10(lo)) / (np.log10(hi) - np.log10(lo)), 0, 1)
            stops = np.array(spec.get('palette', [[0, 0.5, 0.07, 0.02], [0.3, 0.95, 0.3, 0.04], [0.6, 1.0, 0.66, 0.16], [0.88, 1.0, 0.9, 0.55], [1, 1.0, 0.98, 0.86]]))
            fire = np.stack([np.interp(t, stops[:, 0], stops[:, c]) for c in (1, 2, 3)], -1)
            w = np.clip((m - 0.9) / (lo * 1.5 - 0.9), 0, 1); w = (w * w * (3 - 2 * w))[..., None]
            disp = (1 - np.exp(-np.minimum(rgb, 4.0) * spec.get('soot_gain', 0.7))) * (1 - w) + fire * w
        else:
            disp = 1 - np.exp(-rgb)
        peak = disp.max(-1)
        alpha = np.clip(np.maximum(al, peak * spec.get('glow_alpha', 1.0)), 0, 1)
        col = np.where(alpha[..., None] > 1e-3, disp / np.maximum(alpha[..., None], 1e-3), 0)
        col = np.clip(col, 0, 1)
    if not spec['loop']:
        tail = spec.get('fade_tail', 0); head = spec.get('fade_head', 0)
        if tail and i >= N - tail: alpha = alpha * ((N - i) / (tail + 1))
        if head and i < head: alpha = alpha * ((i + 1) / (head + 1))
    alpha = np.where(alpha < spec.get('alpha_floor', 0.004), 0, alpha)
    out.append((col, alpha))

def bleed(col, alpha, it=6):
    """Spread colour into fully transparent texels so bilinear filtering and mips do not pull in black."""
    c = col * (alpha[..., None] > 0); m = (alpha > 0).astype(np.float32)
    for _ in range(it):
        acc = np.zeros_like(c); cnt = np.zeros_like(m)
        for dy, dx in ((0, 1), (0, -1), (1, 0), (-1, 0), (1, 1), (1, -1), (-1, 1), (-1, -1)):
            acc += np.roll(c * m[..., None], (dy, dx), (0, 1)); cnt += np.roll(m, (dy, dx), (0, 1))
        new = (m == 0) & (cnt > 0)
        c[new] = acc[new] / cnt[new][..., None]; m[new] = 1
    return c

def cell_rgba(col, alpha, size):
    if size != col.shape[0]:
        f = col.shape[0] // size
        pm = (col * alpha[..., None]).reshape(size, f, size, f, 3).mean((1, 3))
        al = alpha.reshape(size, f, size, f).mean((1, 3))
        col = np.where(al[..., None] > 1e-4, pm / np.maximum(al[..., None], 1e-4), 0); alpha = al
        alpha = np.where(alpha < 0.004, 0, alpha)
    col = bleed(np.clip(col, 0, 1), alpha)
    enc = srgb(col) if kind == 'smoke' or spec.get('encode_srgb', True) else col
    # zero the outermost texel ring so neighbouring cells never bleed into each other
    alpha = alpha.copy(); alpha[0, :] = alpha[-1, :] = 0; alpha[:, 0] = alpha[:, -1] = 0
    return np.concatenate([enc, alpha[..., None]], -1)

cols = spec['cols']; rows = -(-N // cols)
if spec.get('pivot_from_content'):
    # lowest row that holds real content in any frame becomes the ground line
    low = max((np.nonzero((al > 0.12).any(1))[0].max() for _, al in out if (al > 0.12).any()), default=res - 1)
    meta['pivot_v'] = (res - 1 - low) / res
result = dict(id=spec['id'], frames=N, cols=cols, rows=rows, loop=spec['loop'], fps=spec['fps'],
              pivot=[0.5, round(float(meta['pivot_v']), 4)] if spec.get('anchor', 'ground') == 'ground' else [0.5, 0.5],
              additive=spec.get('additive', 0.0), kind=kind, files={}, bytes={})
bf = spec.get('bottom_fade', 0)
if bf:
    # the simulation's emitter leaves a hard flat base: ease the lowest part of the frame in from the ground line
    yy = (res - 1 - np.arange(res)) / res
    t = np.clip((yy - meta['pivot_v']) / bf, 0, 1); ramp = (t * t * (3 - 2 * t))[:, None]
    out = [(col, alpha * ramp) for col, alpha in out]
ef = spec.get('edge_fade', 0)
if ef:
    # thin haze amplified by alpha_gain can reach the cell's border, which then shows as a square: ease all four sides out
    xx = (np.arange(res) + 0.5) / res; t = np.clip(np.minimum(xx, 1 - xx) / ef, 0, 1); r1 = t * t * (3 - 2 * t)
    out = [(col, alpha * r1[None, :] * r1[:, None]) for col, alpha in out]
sf = spec.get('side_fade', 0)
if sf:
    # a flow that runs on past the frame (a ground mist) must not end at the cell's edge: ease it out towards both sides
    xx = (np.arange(res) + 0.5) / res; t = np.clip(np.minimum(xx, 1 - xx) / sf, 0, 1); ramp = (t * t * (3 - 2 * t))[None, :]
    out = [(col, alpha * ramp) for col, alpha in out]
for tier, size in (('desktop', res), ('quest', res // 2)):
    atlas = np.zeros((rows * size, cols * size, 4), np.float32)
    for i, (col, alpha) in enumerate(out):
        r, c = divmod(i, cols)
        atlas[r * size:(r + 1) * size, c * size:(c + 1) * size] = cell_rgba(col, alpha, size)
    im = Image.fromarray((np.clip(atlas, 0, 1) * 255 + 0.5).astype(np.uint8), 'RGBA')
    name = '%s-%d.webp' % (spec['id'], size)
    q = spec.get('quality', 82)
    im.save(os.path.join(outdir, name), 'WEBP', quality=q, alpha_quality=spec.get('alpha_quality', 90), method=6, exact=True)
    result['files'][tier] = name; result['bytes'][tier] = os.path.getsize(os.path.join(outdir, name))
    result.setdefault('cell', {})[tier] = size
    result.setdefault('atlas', {})[tier] = [cols * size, rows * size]
    if spec.get('keep_png'): im.save(os.path.join(outdir, '%s-%d.png' % (spec['id'], size)))
result['render'] = dict(samples=meta['samples'], cell_px=res, source_frames=meta['cfg'].get('source_frames'),
                        loop_first=first, crossfade=K, exposure=ex,
                        sim_units_across_cell=round(meta['sim_units_per_frame_side'], 2),
                        settings={k: v for k, v in meta['cfg'].items() if k not in ('files', 'out', 'source_frames')},
                        pack_spec={k: v for k, v in spec.items() if k not in ('src', 'id')})
json.dump(result, open(os.path.join(outdir, spec['id'] + '.json'), 'w'), indent=1)
print(spec['id'], result['bytes'], result['pivot'], rows, 'rows')
