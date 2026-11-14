"""Assemble the provenance manifest from the packer's per-atlas JSON. usage: manifest.py <packed dir> <out manifest.json>
An atlas with no JSON in <packed dir> keeps the entry it already has in <out manifest.json>, so a re-bake of
some atlases does not need the others' sources."""
import json, os, sys
src, dst = sys.argv[1], sys.argv[2]
PAGE = 'https://jangafx.com/software/embergen/download/free-vdb-animations'
packs = [
 dict(name='SmallCampfireVDB.zip', url='https://www.mediafire.com/file/9xx9icyomy2txv7/SmallCampfireVDB.zip/file', bytes=62400968,
      sha256='fce2ad670a4738957f15b742410162e26bb84790e8bddb72ec2a4bd64bcebe30', grids=['density', 'flames'], vdb_frames=200,
      license_file_sha256='64473bdcf2041c5d4f2580ffdddc15d0c20e2440bed4119d032a3ec92363a21c'),
 dict(name='Fire_01.rar', url='https://www.mediafire.com/file/j9yvua10nfvhkvu/Fire_01.rar/file', bytes=67880563,
      sha256='c130c42bf2ffc52254691e2d870c5c54cfda40e73bde4831d1603ccee94fb681', grids=['flames', 'temperature'], vdb_frames=101,
      license_file_sha256='094b20f5c01aa6c1afc88216dec286f5e681fb1d3861c356ccb237b13f42cb0a'),
 dict(name='GroundExplosionVDB.zip', url='https://www.mediafire.com/file/vm64xg0vta64qgl/GroundExplosionVDB.zip/file', bytes=694118838,
      sha256='47c2c1d352b3c0dce31e462d09ede9f8bc95b5333ca9764564073b02113dc7b9', grids=['density', 'flames'], vdb_frames=200,
      license_file_sha256='64473bdcf2041c5d4f2580ffdddc15d0c20e2440bed4119d032a3ec92363a21c'),
]
origin = dict(fire=('SmallCampfireVDB.zip', 'flames grid only, emissive'), flare=('Fire_01.rar', 'flames grid only, emissive'),
              explosion=('GroundExplosionVDB.zip', 'flames emissive plus density as soot'))
# Crownfall's own simulations: sim_gas.py <effect>, packed by pack_sims.py. No outside source.
own = dict(dust=('fallDust', 'a body hitting the stone: a thin radial sheet along the floor'),
           scuff=('stepDust', 'a foot scuffing the stone: one small low kick'),
           smokePuff=('musket', 'a musket discharge seen down the line of the shot: jet, bloom, hanging haze'),
           smoke=('mist', 'a low ground mist creeping outward, a loop cut from the settled flow'))
SIM = 'own-simulation'
before = {a['id']: a for a in json.load(open(dst))['atlases']} if os.path.exists(dst) else {}
atlases = []
for i in ('fire', 'smoke', 'flare', 'explosion', 'dust', 'scuff', 'smokePuff'):
    p = os.path.join(src, i + '.json')
    if not os.path.exists(p):
        atlases.append(before[i]); continue
    a = json.load(open(p))
    if i in own:
        a['pack'] = SIM; a['sim'] = 'scripts/vfx/sim_gas.py ' + own[i][0]; a['pass'] = own[i][1] + ', density only, lit white'
    else:
        a['pack'], a['pass'] = origin[i]
    for tier, f in a['files'].items(): assert os.path.getsize(os.path.join(src, f)) == a['bytes'][tier]
    atlases.append(a)
m = dict(
 about='Flipbook atlases. fire, flare and explosion are baked from JangaFX EmberGen VDB simulations (CC0); dust, scuff, smokePuff and smoke are Crownfall\'s own Mantaflow simulations. See docs/play/VFX_LIBRARY.md.',
 license='CC0-1.0',
 own_simulations=dict(
   id=SIM, license='Made for Crownfall with the scripts in this repository; no third-party data. The JangaFX licence above covers only the three packs.',
   solver='Blender 5.2.3 as a Python module (bpy), Mantaflow gas solver on the CPU, replay cache, wavelet noise at twice the base grid',
   scripts=['scripts/vfx/sim_gas.py', 'scripts/vfx/manta_bases.py', 'scripts/vfx/pack_sims.py', 'scripts/vfx/pack.py', 'scripts/vfx/manifest.py'],
   reproduce='python sim_gas.py <effect> <frames>/<effect> for fallDust, stepDust, musket and mist; python3 pack_sims.py <frames> <packed>; python3 manifest.py <packed> manifest.json. Each atlas records its preset (render.settings) and pack_spec below.',
   note='manta_bases.py repairs a fault in the bpy module (Mantaflow classes built without their parents\' methods); the stand-alone Blender program does not need it. Mantaflow is multithreaded: a re-run gives the same motion, not the same bytes.'),
 source=dict(page=PAGE, retrieved='2026-11-10', page_sha256='86ebb2c650b08fa971ed36397a3b38d7adc687416e4dad66e34c5c859fb18d33',
   statement='We have generated numerous volumetric simulations with EmberGen and exported them as VDBs for you to use in your own projects (Blender, Houdini, Octane, Arnold, etc). These free VDB simulations are licensed as CC0 (Public Domain) so you are free to use them however you want!',
   pack_readme='You are free to use these VDBs in any project however you please, both commercially and non-commercially, and we\'ve licensed them under CC0 - Public Domain (read more in LICENSE.txt).',
   pack_license='Each archive carries LICENSE.txt, the CC0 1.0 Universal legal code headed "Creative Commons - Public Domain - CC0: https://creativecommons.org/publicdomain/zero/1.0/". A copy is at main game/public/licenses/JangaFX-EmberGen-VDB-CC0.txt.',
   author='JangaFX (EmberGen)'),
 packs=packs,
 pipeline=dict(
   renderer='Blender 5.2.3 as a Python module (bpy), Cycles on the CPU, OpenImageDenoise, transparent film, 32-bit float EXR',
   camera='orthographic, level with the ground, square frame fitted to the visible volume by a 64 px prepass',
   lighting='smoke and dust: white world (0.6) plus a white sun (3.0, 50 degrees elevation, from upper left); fire: emission only, no lights',
   sampling='fire: 96 samples; smoke, dust and explosion: 64 samples, ray-marched volumes (step rate 3), 2 volume bounces',
   colour='smoke and dust keep luminance only (neutral grey) and are sRGB-encoded; fire is tone-mapped per channel with 1 - exp(-x) and its alpha is max(coverage, brightest channel); the explosion fireball is recoloured from log brightness through a fire palette because its emission saturates the render ramp',
   scripts='scripts/vfx/ (render_vdb.py for the VDB packs, sim_gas.py for the own simulations, pack.py, manifest.py and helpers); each atlas records its render settings and pack_spec below',
   packing='256 px cells (desktop) and a 2x box downsample to 128 px (Quest), straight alpha, colour bled into empty texels, outer texel ring of every cell cleared, lossy WebP with exact RGB under alpha',
   loops='the last frames cross-fade into the frames that precede the first, so the final frame flows into frame 0',
   ktx2='not produced: the repository has a KTX2 loader but no encoder (toktx or basisu) to make one with'),
 atlases=atlases)
json.dump(m, open(dst, 'w'), indent=1); open(dst, 'a').write('\n')
print('total bytes', sum(sum(a['bytes'].values()) for a in atlases))
