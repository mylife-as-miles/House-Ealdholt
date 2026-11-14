import json, sys, os, re
# mkcfg.py out.json vdbdir outdir mode n_frames first_sim_frame last_sim_frame key=value...
out, vdbdir, outdir, mode, n, s, e = sys.argv[1:8]
n, s, e = int(n), int(s), int(e)
num = lambda f: int(re.findall(r'(\d+)\.vdb$', f)[0])
have = {num(f): f for f in os.listdir(vdbdir) if f.endswith('.vdb')}
idx = [round(s + (e - s) * i / (n - 1)) for i in range(n)] if n > 1 else [s]
miss = [i for i in idx if i not in have]
if miss: raise SystemExit('missing sim frames %s' % miss)
cfg = dict(out=outdir, files=[os.path.join(vdbdir, have[i]) for i in idx], mode=mode, source_frames=idx)
for kv in sys.argv[8:]:
    k, v = kv.split('=', 1); cfg[k] = json.loads(v)
json.dump(cfg, open(out, 'w'), indent=1)
