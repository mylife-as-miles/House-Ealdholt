"""Pack Crownfall's own four simulations (sim_gas.py) into their atlases with pack.py.
usage: python3 pack_sims.py <frames root> <outdir> [id ...]
<frames root> holds one folder of frames per effect, as sim_gas.py wrote them: fallDust/, stepDust/, musket/, mist/."""
import json, os, subprocess, sys

root, out = sys.argv[1], sys.argv[2]
SPECS = {
    # atlas id: (sim_gas.py effect, pack.py spec)
    'dust': ('fallDust', dict(kind='smoke', frames=32, cols=8, loop=False, fps=24, fade_tail=9, bottom_fade=0.012, alpha_gain=1.0)),
    'scuff': ('stepDust', dict(kind='smoke', frames=16, cols=8, loop=False, fps=30, fade_tail=5, bottom_fade=0.012, alpha_gain=1.0)),
    'smokePuff': ('musket', dict(kind='smoke', frames=48, cols=8, loop=False, fps=13, fade_tail=12, alpha_gain=3.0, edge_fade=0.2, colour_blur=1.5, alpha_blur=0.6, quality=50, alpha_quality=60)),
    'smoke': ('mist', dict(kind='smoke', frames=40, cols=8, loop=True, first=10, crossfade=10, fps=12, bottom_fade=0.012, alpha_gain=1.0, side_fade=0.16, colour_blur=1.0, quality=55, alpha_quality=70)),
}
here = os.path.dirname(os.path.abspath(__file__)); os.makedirs(out, exist_ok=True)
for atlas in sys.argv[3:] or SPECS:
    effect, spec = SPECS[atlas]
    path = os.path.join(out, atlas + '.spec.json')
    json.dump(dict(id=atlas, src=os.path.join(root, effect), **spec), open(path, 'w'))
    subprocess.run([sys.executable, '-I', os.path.join(here, 'pack.py'), path, out], check=True)
    os.remove(path)
